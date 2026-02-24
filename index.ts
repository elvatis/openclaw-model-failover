import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

type PluginCfg = {
  enabled?: boolean;
  modelOrder?: string[];
  cooldownMinutes?: number;
  stateFile?: string;
  patchSessionPins?: boolean;
  notifyOnSwitch?: boolean;
};

type LimitState = {
  // key: model id OR provider id (we keep it simple with model ids)
  limited: Record<
    string,
    {
      lastHitAt: number;
      nextAvailableAt: number;
      reason?: string;
    }
  >;
};

function getNextMidnightPT(): number {
  const now = new Date();
  // Pacific Time is UTC-8 (PST) or UTC-7 (PDT). 
  // Simplified: Use UTC-8 for safety (later reset is safer).
  const utcNow = now.getTime();
  const ptOffset = -8 * 60 * 60 * 1000;
  const ptTime = new Date(utcNow + ptOffset);
  
  ptTime.setUTCHours(24, 0, 0, 0); // Next midnight
  return Math.floor((ptTime.getTime() - ptOffset) / 1000);
}

function getNextMidnightUTC(): number {
  const now = new Date();
  now.setUTCHours(24, 0, 0, 0);
  return Math.floor(now.getTime() / 1000);
}

function parseWaitTime(err: string): number | undefined {
  // Common patterns: "Try again in 4m30s", "after 12:00 UTC", "retry after 60 seconds"
  const s = err.toLowerCase();
  
  // "Try again in Xm Ys"
  const matchIn = s.match(/in\s+(\d+)(m|s|h)/);
  if (matchIn) {
    const val = parseInt(matchIn[1], 10);
    const unit = matchIn[2];
    if (unit === 's') return val;
    if (unit === 'm') return val * 60;
    if (unit === 'h') return val * 3600;
  }
  
  // "Retry after X seconds"
  const matchAfter = s.match(/after\s+(\d+)\s+sec/);
  if (matchAfter) return parseInt(matchAfter[1], 10);

  return undefined;
}

function calculateCooldown(provider: string, err?: string, defaultMinutes = 60): number {
  if (!err) return defaultMinutes * 60;
  
  // 1. Try to parse specific wait time from error
  const parsed = parseWaitTime(err);
  if (parsed) return parsed;

  const text = err.toLowerCase();
  
  // 2. Google: "quota" usually means daily limit -> wait for reset
  if (provider.startsWith("google") && text.includes("quota")) {
      const reset = getNextMidnightPT();
      const wait = reset - nowSec();
      return wait > 0 ? wait : defaultMinutes * 60;
  }

  // 3. Anthropic: "daily" limit -> wait for UTC midnight
  if (provider.startsWith("anthropic") && text.includes("daily")) {
      const reset = getNextMidnightUTC();
      const wait = reset - nowSec();
      return wait > 0 ? wait : defaultMinutes * 60;
  }

  // 4. Default rolling window assumptions
  // OpenAI often rolling -> 1 hour is a safe retry for short bursts
  if (provider.startsWith("openai")) return 60 * 60; // 1h

  return defaultMinutes * 60;
}


function isRateLimitLike(err?: string): boolean {
  if (!err) return false;
  const s = err.toLowerCase();
  return (
    s.includes("rate limit") ||
    s.includes("quota") ||
    s.includes("resource_exhausted") ||
    s.includes("too many requests") ||
    s.includes("429")
  );
}

function isAuthOrScopeLike(err?: string): boolean {
  if (!err) return false;
  const s = err.toLowerCase();
  // OpenAI: "Missing scopes: api.responses.write" etc.
  return (
    s.includes("http 401") ||
    s.includes("insufficient permissions") ||
    s.includes("missing scopes") ||
    s.includes("api.responses.write") ||
    s.includes("invalid api key") ||
    s.includes("unauthorized")
  );
}

function loadState(statePath: string): LimitState {
  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("bad");
    if (!parsed.limited) parsed.limited = {};
    return parsed as LimitState;
  } catch {
    return { limited: {} };
  }
}

function saveState(statePath: string, state: LimitState) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function firstAvailableModel(order: string[], state: LimitState): string | undefined {
  const t = nowSec();
  for (const m of order) {
    const lim = state.limited[m];
    if (!lim) return m;
    if (lim.nextAvailableAt <= t) return m;
  }
  return order[order.length - 1];
}

function patchSessionModel(sessionKey: string, model: string, logger: any) {
  try {
    const sessionsPath = path.join(os.homedir(), ".openclaw/agents/main/sessions/sessions.json");
    const raw = fs.readFileSync(sessionsPath, "utf-8");
    const data = JSON.parse(raw);
    if (!data[sessionKey]) return false;
    const prev = data[sessionKey].model;
    data[sessionKey].model = model;
    fs.writeFileSync(sessionsPath, JSON.stringify(data, null, 0));
    logger?.info?.(`[model-failover] Patched session ${sessionKey} model: ${prev} -> ${model}`);
    return true;
  } catch (e: any) {
    logger?.warn?.(`[model-failover] Failed to patch sessions.json: ${e?.message ?? String(e)}`);
    return false;
  }
}

export default function register(api: any) {
  const cfg = (api.pluginConfig ?? {}) as PluginCfg;
  if (cfg.enabled === false) {
    api.logger?.info?.("[model-failover] disabled by config");
    return;
  }

  const modelOrder = (cfg.modelOrder && cfg.modelOrder.length > 0)
    ? cfg.modelOrder
    : [
      // Tier 1: Flagships
      "openai-codex/gpt-5.3-codex",
      "anthropic/claude-opus-4-6",
      "github-copilot/claude-sonnet-4.6",
      "google-gemini-cli/gemini-3-pro-preview",
      // Tier 2: Strong/Balanced
      "anthropic/claude-sonnet-4-6",
      "openai-codex/gpt-5.2",
      "google-gemini-cli/gemini-2.5-pro",
      // Tier 3: Search/Specific
      "perplexity/sonar-deep-research",
      "perplexity/sonar-pro",
      // Tier 4: Fast/Fallback
      "google-gemini-cli/gemini-2.5-flash",
      "google-gemini-cli/gemini-3-flash-preview"
    ]; 

  const cooldownMinutes = cfg.cooldownMinutes ?? 300;
  const statePath = expandHome(cfg.stateFile ?? "~/.openclaw/workspace/memory/model-ratelimits.json");
  const patchPins = cfg.patchSessionPins !== false;
  const notifyOnSwitch = cfg.notifyOnSwitch !== false;

  api.logger?.info?.(`[model-failover] enabled. order=${modelOrder.join(" -> ")}`);

  function getPinnedModel(sessionKey?: string): string | undefined {
    if (!sessionKey) return undefined;
    try {
      const sessionsPath = path.join(os.homedir(), ".openclaw/agents/main/sessions/sessions.json");
      const raw = fs.readFileSync(sessionsPath, "utf-8");
      const data = JSON.parse(raw);
      return data?.[sessionKey]?.model;
    } catch {
      return undefined;
    }
  }

  // 1) Before model resolve:
  // - default: do NOT override unless the currently pinned model is limited.
  // - optional: forceOverride=true always picks first available in modelOrder.
  api.on("before_model_resolve", (event: any, ctx: any) => {
    const state = loadState(statePath);
    const chosen = firstAvailableModel(modelOrder, state);
    if (!chosen) return;

    const forceOverride = (cfg as any).forceOverride === true;
    const pinned = getPinnedModel(ctx?.sessionKey);

    if (forceOverride) {
      return { modelOverride: chosen };
    }

    if (!pinned) {
      // no pin info; be conservative and don't override
      return;
    }

    const lim = state.limited[pinned];
    const isLimited = !!lim && lim.nextAvailableAt > nowSec();
    if (!isLimited) {
      return;
    }

    // pinned is limited -> switch to next available
    if (chosen !== pinned) {
      return { modelOverride: chosen };
    }
  });

  // 2) When agent ends with rate limit: mark current model limited + patch session pin.
  api.on("agent_end", (event: any, ctx: any) => {
    if (event?.success !== false) return;
    const err = event?.error as string | undefined;

    const isRate = isRateLimitLike(err);
    const isAuth = isAuthOrScopeLike(err);
    if (!isRate && !isAuth) return;

    const currentModel = ctx?.model || ctx?.modelId || undefined;
    const state = loadState(statePath);

    const hitAt = nowSec();
    // Auth/scope errors shouldn't be retried aggressively.
    const effectiveCooldownMin = isAuth ? Math.max(cooldownMinutes, 12 * 60) : cooldownMinutes;
    const nextAvail = hitAt + effectiveCooldownMin * 60;

    const key = (typeof currentModel === "string" && currentModel.length > 0) ? currentModel : modelOrder[0];

    // Detect provider-wide exhaustion (generic)
    const provider = key.split("/")[0];
    // If it looks like a provider prefix (no spaces, has slash), assume provider-wide block for rate limits
    const isProviderWide = isRate && provider.length > 0;

    if (isProviderWide) {
        // Block ALL models from this provider
        let blockedCount = 0;
        for (const m of modelOrder) {
            if (m.startsWith(provider + "/")) {
                state.limited[m] = {
                    lastHitAt: hitAt,
                    nextAvailableAt: nextAvail,
                    reason: `Provider ${provider} exhausted: ${err?.slice(0, 100)}`
                };
                blockedCount++;
            }
        }
        api.logger?.warn?.(`[model-failover] Provider '${provider}' exhausted. Blocked ${blockedCount} models.`);
    } else {
        // Block just this model (fallback)
        state.limited[key] = {
            lastHitAt: hitAt,
            nextAvailableAt: nextAvail,
            reason: err?.slice(0, 200),
        };
    }
    
    saveState(statePath, state);

    const fallback = firstAvailableModel(modelOrder, state);

    if (patchPins && ctx?.sessionKey && fallback) {
      patchSessionModel(ctx.sessionKey, fallback, api.logger);
    }

    if (notifyOnSwitch && ctx?.sessionKey && fallback) {
      const why = isAuth ? "auth/scope error" : "rate limit";
      api.logger?.warn?.(`[model-failover] ${why} detected. Switched future turns to ${fallback} (sessionKey=${ctx.sessionKey}).`);
    }
  });

  // 3) If we ever send the raw rate-limit error to a channel, immediately patch the session.
  api.on("message_sent", (event: any, ctx: any) => {
    const content = (event?.content ?? "") as string;
    if (!content) return;
    if (!isRateLimitLike(content) && !content.includes("API rate limit reached")) return;

    const state = loadState(statePath);
    // Assume first model in order caused it if no context model
    const currentModel = ctx?.model || ctx?.modelId || modelOrder[0];
    const hitAt = nowSec();
    const nextAvail = hitAt + calculateCooldown(provider, err, cooldownMinutes);
    
    // Check if provider-wide
    const provider = currentModel.split("/")[0];
    const isProviderWide = (provider === "openai-codex" || provider === "anthropic");

    if (isProviderWide) {
        for (const m of modelOrder) {
            if (m.startsWith(provider + "/")) {
                state.limited[m] = {
                    lastHitAt: hitAt,
                    nextAvailableAt: nextAvail,
                    reason: `Provider ${provider} exhausted (msg detect)`
                };
            }
        }
    } else {
        state.limited[currentModel] = {
            lastHitAt: hitAt,
            nextAvailableAt: nextAvail,
            reason: "outbound rate limit message observed",
        };
    }
    
    saveState(statePath, state);

    const fallback = firstAvailableModel(modelOrder, state);
    if (patchPins && ctx?.sessionKey && fallback) {
      patchSessionModel(ctx.sessionKey, fallback, api.logger);
    }
  });
}
