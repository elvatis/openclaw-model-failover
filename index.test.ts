import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  nowSec,
  getNextMidnightPT,
  getNextMidnightUTC,
  parseWaitTime,
  calculateCooldown,
  isRateLimitLike,
  isAuthOrScopeLike,
  isTemporarilyUnavailableLike,
  loadState,
  saveState,
  firstAvailableModel,
  expandHome,
  type LimitState,
} from "./index.js";

// ---------------------------------------------------------------------------
// 1. Rate-limit detection
// ---------------------------------------------------------------------------
describe("isRateLimitLike", () => {
  it("detects 429 status code in error string", () => {
    expect(isRateLimitLike("Error: 429 Too Many Requests")).toBe(true);
  });

  it("detects quota exhaustion", () => {
    expect(isRateLimitLike("Quota exceeded for quota metric 'Queries'")).toBe(true);
  });

  it("detects 'rate limit' text", () => {
    expect(isRateLimitLike("API rate limit reached")).toBe(true);
  });

  it("detects 'resource_exhausted'", () => {
    expect(isRateLimitLike("RESOURCE_EXHAUSTED: out of capacity")).toBe(true);
  });

  it("detects 'too many requests'", () => {
    expect(isRateLimitLike("too many requests, slow down")).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isRateLimitLike("Connection refused")).toBe(false);
    expect(isRateLimitLike("ENOTFOUND")).toBe(false);
    expect(isRateLimitLike(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Auth/scope error detection
// ---------------------------------------------------------------------------
describe("isAuthOrScopeLike", () => {
  it("detects HTTP 401", () => {
    expect(isAuthOrScopeLike("HTTP 401 Unauthorized")).toBe(true);
  });

  it("detects missing scopes", () => {
    expect(isAuthOrScopeLike("Missing scopes: api.responses.write")).toBe(true);
  });

  it("detects invalid api key", () => {
    expect(isAuthOrScopeLike("Invalid API key provided")).toBe(true);
  });

  it("returns false for rate-limit errors", () => {
    expect(isAuthOrScopeLike("429 Too Many Requests")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAuthOrScopeLike(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Temporarily unavailable detection
// ---------------------------------------------------------------------------
describe("isTemporarilyUnavailableLike", () => {
  it("detects 'plugin is in cooldown'", () => {
    expect(isTemporarilyUnavailableLike("plugin is in cooldown")).toBe(true);
  });

  it("detects 'temporarily unavailable'", () => {
    expect(isTemporarilyUnavailableLike("Service temporarily unavailable")).toBe(true);
  });

  it("detects copilot-proxy mention", () => {
    expect(isTemporarilyUnavailableLike("copilot-proxy not responding")).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isTemporarilyUnavailableLike("Syntax error")).toBe(false);
    expect(isTemporarilyUnavailableLike(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. parseWaitTime
// ---------------------------------------------------------------------------
describe("parseWaitTime", () => {
  it("parses 'in Xm' format", () => {
    expect(parseWaitTime("Try again in 4m30s")).toBe(240); // 4 minutes
  });

  it("parses 'in Xs' format", () => {
    expect(parseWaitTime("Try again in 30s")).toBe(30);
  });

  it("parses 'in Xh' format", () => {
    expect(parseWaitTime("Try again in 2h")).toBe(7200);
  });

  it("parses 'after X seconds' format", () => {
    expect(parseWaitTime("Retry after 60 seconds")).toBe(60);
  });

  it("returns undefined for unparseable errors", () => {
    expect(parseWaitTime("Unknown error occurred")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Cooldown calculation
// ---------------------------------------------------------------------------
describe("calculateCooldown", () => {
  it("returns default cooldown in seconds when no error provided", () => {
    // default 60 minutes = 3600 seconds
    expect(calculateCooldown("openai", undefined, 60)).toBe(3600);
  });

  it("uses parsed wait time when error contains retry timing", () => {
    expect(calculateCooldown("openai", "Try again in 5m", 60)).toBe(300);
  });

  it("returns 1 hour for openai rolling window", () => {
    expect(calculateCooldown("openai", "rate limit exceeded")).toBe(3600);
  });

  it("returns time until PT midnight for google quota errors", () => {
    const result = calculateCooldown("google-gemini-cli", "Quota exceeded");
    const expectedApprox = getNextMidnightPT() - nowSec();
    // Allow 2 second variance for execution time
    expect(Math.abs(result - expectedApprox)).toBeLessThan(3);
  });

  it("returns time until UTC midnight for anthropic daily errors", () => {
    const result = calculateCooldown("anthropic", "daily limit exceeded");
    const expectedApprox = getNextMidnightUTC() - nowSec();
    // Allow 2 second variance
    expect(Math.abs(result - expectedApprox)).toBeLessThan(3);
  });

  it("uses custom default minutes", () => {
    expect(calculateCooldown("unknown-provider", "some error", 120)).toBe(7200);
  });
});

// ---------------------------------------------------------------------------
// 6. Model selection (firstAvailableModel)
// ---------------------------------------------------------------------------
describe("firstAvailableModel", () => {
  const modelOrder = [
    "openai-codex/gpt-5.3",
    "anthropic/claude-opus",
    "google-gemini-cli/gemini-pro",
  ];

  it("returns the first model when nothing is limited", () => {
    const state: LimitState = { limited: {} };
    expect(firstAvailableModel(modelOrder, state)).toBe("openai-codex/gpt-5.3");
  });

  it("skips limited models and returns the next available one", () => {
    const futureTs = nowSec() + 3600;
    const state: LimitState = {
      limited: {
        "openai-codex/gpt-5.3": {
          lastHitAt: nowSec(),
          nextAvailableAt: futureTs,
          reason: "rate limit",
        },
      },
    };
    expect(firstAvailableModel(modelOrder, state)).toBe("anthropic/claude-opus");
  });

  it("skips multiple limited models", () => {
    const futureTs = nowSec() + 3600;
    const state: LimitState = {
      limited: {
        "openai-codex/gpt-5.3": {
          lastHitAt: nowSec(),
          nextAvailableAt: futureTs,
        },
        "anthropic/claude-opus": {
          lastHitAt: nowSec(),
          nextAvailableAt: futureTs,
        },
      },
    };
    expect(firstAvailableModel(modelOrder, state)).toBe("google-gemini-cli/gemini-pro");
  });

  it("returns a model whose cooldown has expired", () => {
    const pastTs = nowSec() - 10; // expired 10 seconds ago
    const state: LimitState = {
      limited: {
        "openai-codex/gpt-5.3": {
          lastHitAt: nowSec() - 3600,
          nextAvailableAt: pastTs,
        },
      },
    };
    expect(firstAvailableModel(modelOrder, state)).toBe("openai-codex/gpt-5.3");
  });

  it("returns last model as ultimate fallback when all are limited", () => {
    const futureTs = nowSec() + 3600;
    const state: LimitState = {
      limited: {
        "openai-codex/gpt-5.3": { lastHitAt: nowSec(), nextAvailableAt: futureTs },
        "anthropic/claude-opus": { lastHitAt: nowSec(), nextAvailableAt: futureTs },
        "google-gemini-cli/gemini-pro": { lastHitAt: nowSec(), nextAvailableAt: futureTs },
      },
    };
    expect(firstAvailableModel(modelOrder, state)).toBe("google-gemini-cli/gemini-pro");
  });

  it("returns undefined for empty model order", () => {
    expect(firstAvailableModel([], { limited: {} })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. getNextMidnightPT - DST-aware (Issue #2 fix verification)
// ---------------------------------------------------------------------------
describe("getNextMidnightPT", () => {
  it("returns a timestamp in the future", () => {
    const midnight = getNextMidnightPT();
    expect(midnight).toBeGreaterThan(nowSec());
  });

  it("returns a timestamp no more than ~25 hours from now", () => {
    const midnight = getNextMidnightPT();
    const maxDelta = 25 * 3600; // 25 hours to account for edge cases
    expect(midnight - nowSec()).toBeLessThanOrEqual(maxDelta);
  });

  it("midnight PT corresponds to 00:00 in America/Los_Angeles", () => {
    const midnightSec = getNextMidnightPT();
    const midnightDate = new Date(midnightSec * 1000);
    // Format the timestamp in PT and check it represents midnight.
    // Intl.DateTimeFormat with hour12:false may return "24" for midnight in some
    // engines/locales (end-of-day representation), so accept both "00" and "24".
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(midnightDate);
    const hour = parts.find((p) => p.type === "hour")?.value;
    const minute = parts.find((p) => p.type === "minute")?.value;
    const second = parts.find((p) => p.type === "second")?.value;
    expect(["00", "24"]).toContain(hour);
    expect(minute).toBe("00");
    expect(second).toBe("00");
  });
});

// ---------------------------------------------------------------------------
// 8. getNextMidnightUTC
// ---------------------------------------------------------------------------
describe("getNextMidnightUTC", () => {
  it("returns a timestamp in the future", () => {
    expect(getNextMidnightUTC()).toBeGreaterThan(nowSec());
  });

  it("corresponds to 00:00:00 UTC", () => {
    const ts = getNextMidnightUTC();
    const d = new Date(ts * 1000);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9. State persistence (loadState / saveState)
// ---------------------------------------------------------------------------
describe("loadState / saveState", () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "failover-test-"));
    tmpFile = path.join(tmpDir, "state.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty state when file does not exist", () => {
    const state = loadState(path.join(tmpDir, "nonexistent.json"));
    expect(state).toEqual({ limited: {} });
  });

  it("round-trips state through save and load", () => {
    const original: LimitState = {
      limited: {
        "openai/gpt-4": {
          lastHitAt: 1000000,
          nextAvailableAt: 1003600,
          reason: "rate limit",
        },
      },
    };
    saveState(tmpFile, original);
    const loaded = loadState(tmpFile);
    expect(loaded).toEqual(original);
  });

  it("handles corrupted JSON gracefully", () => {
    fs.writeFileSync(tmpFile, "not valid json {{{");
    const state = loadState(tmpFile);
    expect(state).toEqual({ limited: {} });
  });

  it("creates parent directories when saving", () => {
    const deepPath = path.join(tmpDir, "a", "b", "c", "state.json");
    const state: LimitState = { limited: {} };
    saveState(deepPath, state);
    expect(fs.existsSync(deepPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. unavailableCooldownMinutes logic
// ---------------------------------------------------------------------------
describe("unavailableCooldownMinutes logic", () => {
  it("calculateCooldown respects custom default minutes for unavailable errors", () => {
    // When a "temporarily unavailable" error is detected, the caller passes
    // unavailableCooldownMinutes (e.g. 15) as defaultMinutes.
    // Since the error doesn't match provider-specific patterns, it falls through
    // to the generic default.
    const cooldown = calculateCooldown("some-provider", "service unavailable", 15);
    expect(cooldown).toBe(15 * 60); // 900 seconds
  });

  it("unavailable cooldown is shorter than rate-limit cooldown", () => {
    const unavailableCd = calculateCooldown("some-provider", "service unavailable", 15);
    const rateLimitCd = calculateCooldown("some-provider", "rate limit hit", 300);
    expect(unavailableCd).toBeLessThan(rateLimitCd);
  });
});

// ---------------------------------------------------------------------------
// 11. expandHome
// ---------------------------------------------------------------------------
describe("expandHome", () => {
  it("expands ~ to home directory", () => {
    expect(expandHome("~")).toBe(os.homedir());
  });

  it("expands ~/ prefix", () => {
    const result = expandHome("~/.openclaw/state.json");
    expect(result).toBe(path.join(os.homedir(), ".openclaw/state.json"));
  });

  it("returns non-tilde paths unchanged", () => {
    expect(expandHome("/tmp/state.json")).toBe("/tmp/state.json");
  });

  it("returns empty string unchanged", () => {
    expect(expandHome("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 12. Provider-wide blocking simulation (integration-like)
// ---------------------------------------------------------------------------
describe("provider-wide blocking", () => {
  it("blocks all models from the same provider on rate limit", () => {
    const modelOrder = [
      "openai-codex/gpt-5.3",
      "openai-codex/gpt-5.2",
      "anthropic/claude-opus",
      "google-gemini-cli/gemini-pro",
    ];

    const state: LimitState = { limited: {} };
    const failedModel = "openai-codex/gpt-5.3";
    const provider = failedModel.split("/")[0];
    const hitAt = nowSec();
    const nextAvail = hitAt + 3600;

    // Simulate provider-wide blocking as index.ts does in agent_end handler
    for (const m of modelOrder) {
      if (m.startsWith(provider + "/")) {
        state.limited[m] = {
          lastHitAt: hitAt,
          nextAvailableAt: nextAvail,
          reason: `Provider ${provider} exhausted`,
        };
      }
    }

    // Both openai-codex models should be blocked
    expect(state.limited["openai-codex/gpt-5.3"]).toBeDefined();
    expect(state.limited["openai-codex/gpt-5.2"]).toBeDefined();
    // Other providers should NOT be blocked
    expect(state.limited["anthropic/claude-opus"]).toBeUndefined();
    expect(state.limited["google-gemini-cli/gemini-pro"]).toBeUndefined();

    // firstAvailableModel should skip the blocked provider
    const fallback = firstAvailableModel(modelOrder, state);
    expect(fallback).toBe("anthropic/claude-opus");
  });
});
