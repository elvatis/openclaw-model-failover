import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

export function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

type PluginCfg = {
  enabled?: boolean;
  modelOrder?: string[];
  cooldownMinutes?: number;
  unavailableCooldownMinutes?: number;
  debugLogging?: boolean;
  debugLogSampleRate?: number;
  stateFile?: string;
  patchSessionPins?: boolean;
  notifyOnSwitch?: boolean;
  // If true, automatically skip github-copilot/* models unless copilot-proxy is enabled.
  requireCopilotProxyForCopilotModels?: boolean;
  // If true (default), run `openclaw gateway restart` after patching the session model so the
  // gateway picks up the change without waiting for a manual restart.
  restartOnSwitch?: boolean;
  // Delay in milliseconds before issuing the gateway restart (default: 3000).
  // Gives the current turn time to finish before the gateway is restarted.
  restartDelayMs?: number;
};

export type LimitState = {
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

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function getNextMidnightPT(): number {
  // Use Intl.DateTimeFormat to determine the current PT calendar date,
  // then find the exact UTC timestamp for midnight of the next PT day.
  // America/Los_Angeles is always UTC-7 (PDT) or UTC-8 (PST).
  // We try both offsets and verify which one actually lands on midnight
  // when formatted back in PT - this correctly handles DST transitions
  // where today's offset differs from tomorrow's.
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  const ptYear = parseInt(get("year"), 10);
  const ptMonth = parseInt(get("month"), 10);
  const ptDay = parseInt(get("day"), 10);

  // Tomorrow's calendar midnight as a naive UTC timestamp (no offset applied).
  // Date.UTC handles month/year rollover automatically (e.g. day 32 -> next month).
  const tomorrowNaiveMs = Date.UTC(ptYear, ptMonth - 1, ptDay + 1, 0, 0, 0, 0);

  // Try both possible PT offsets; the correct one produces hour 0 (or 24) in PT.
  for (const offsetHours of [8, 7]) {
    const candidate = tomorrowNaiveMs + offsetHours * 3_600_000;
    const cParts = fmt.formatToParts(new Date(candidate));
    const cHour = parseInt(
      cParts.find((p) => p.type === "hour")?.value ?? "99",
      10
    );
    // hour12:false may report midnight as "00" or "24" depending on the engine.
    if (cHour === 0 || cHour === 24) {
      return Math.floor(candidate / 1000);
    }
  }

  // Unreachable for America/Los_Angeles, but safe fallback using PST (UTC-8).
  return Math.floor((tomorrowNaiveMs + 8 * 3_600_000) / 1000);
}

export function getNextMidnightUTC(): number {
  const now = new Date();
  now.setUTCHours(24, 0, 0, 0);
  return Math.floor(now.getTime() / 1000);
}

export function parseWaitTime(err: string): number | undefined {
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

export function calculateCooldown(provider: string, err?: string, defaultMinutes = 60): number {
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


export function isRateLimitLike(err?: string): boolean {
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

export function isAuthOrScopeLike(err?: string): boolean {
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

export function isTemporarilyUnavailableLike(err?: string): boolean {
  if (!err) return false;
  const s = err.toLowerCase();
  return (
    s.includes("plugin is in cooldown") ||
    s.includes("in cooldown") ||
    s.includes("temporarily unavailable") ||
    s.includes("service unavailable") ||
    s.includes("copilot-proxy")
  );
}

export function loadState(statePath: string): LimitState {
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

export function saveState(statePath: string, state: LimitState) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  // Atomic write: write to temp file, then rename over the target.
  // This prevents corruption if the process crashes mid-write.
  const tmpPath = statePath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
    fs.renameSync(tmpPath, statePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

export function firstAvailableModel(order: string[], state: LimitState): string | undefined {
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

function loadGatewayConfig(api: any): any {
  try {
    return api?.runtime?.config?.loadConfig?.() ?? null;
  } catch {
    return null;
  }
}

function isCopilotProxyEnabled(gatewayCfg: any): boolean {
  try {
    const enabled = gatewayCfg?.plugins?.entries?.["copilot-proxy"]?.enabled;
    return enabled === true;
  } catch {
    return false;
  }
}

function isModelConfigured(gatewayCfg: any, modelId: string): boolean {
  if (!gatewayCfg) return true; // best effort
  const configured = gatewayCfg?.agents?.defaults?.models?.[modelId];
  return configured !== undefined;
}

export const DEFAULT_MODEL_ORDER = [
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
  "google-gemini-cli/gemini-3-flash-preview",
];

export const DEFAULT_STATE_FILE = "~/.openclaw/workspace/memory/model-ratelimits.json";

export default function register(api: any) {
  const cfg = (api.pluginConfig ?? {}) as PluginCfg;
  if (cfg.enabled === false) {
    api.logger?.info?.("[model-failover] disabled by config");
    return;
  }

  const modelOrder = (cfg.modelOrder && cfg.modelOrder.length > 0)
    ? cfg.modelOrder
    : DEFAULT_MODEL_ORDER; 

  const cooldownMinutes = cfg.cooldownMinutes ?? 300;
  const unavailableCooldownMinutes = cfg.unavailableCooldownMinutes ?? 15;
  const debugLogging = cfg.debugLogging === true;
  const debugLogSampleRate = Math.max(0, Math.min(1, Number(cfg.debugLogSampleRate ?? 1)));
  const statePath = expandHome(cfg.stateFile ?? DEFAULT_STATE_FILE);
  const patchPins = cfg.patchSessionPins !== false;
  const notifyOnSwitch = cfg.notifyOnSwitch !== false;

  const requireCopilotProxy = cfg.requireCopilotProxyForCopilotModels !== false;
  const restartOnSwitch = cfg.restartOnSwitch !== false;
  const restartDelayMs = cfg.restartDelayMs ?? 3000;
  const sessionForcedModel = new Map<string, string>();

  let restartPending = false;
  function scheduleGatewayRestart() {
    if (!restartOnSwitch || restartPending) return;
    restartPending = true;
    setTimeout(() => {
      restartPending = false;
      try {
        const p = spawn("openclaw", ["gateway", "restart"], { detached: true, stdio: "ignore" });
        p.unref();
        api.logger?.info?.("[model-failover] Gateway restart issued to apply session model patch.");
      } catch (e: any) {
        api.logger?.warn?.(`[model-failover] Gateway restart failed: ${e?.message ?? String(e)}`);
      }
    }, restartDelayMs);
  }

  function isCopilotEnabledNow(): boolean {
    const gatewayCfg = loadGatewayConfig(api);
    return !requireCopilotProxy || isCopilotProxyEnabled(gatewayCfg);
  }

  function effectiveOrder(): string[] {
    const gatewayCfg = loadGatewayConfig(api);
    const copilotEnabled = !requireCopilotProxy || isCopilotProxyEnabled(gatewayCfg);

    // Filter out models that are obviously not usable.
    const filtered = modelOrder.filter((m) => {
      if (m.startsWith("github-copilot/") && !copilotEnabled) return false;
      // Only try models that exist in agents.defaults.models when config is available.
      if (gatewayCfg && !isModelConfigured(gatewayCfg, m)) return false;
      return true;
    });

    // If config shape is different and filter removed everything, keep original order as a safe fallback.
    return filtered.length > 0 ? filtered : modelOrder;
  }

  function debugLog(message: string) {
    if (!debugLogging) return;
    if (debugLogSampleRate < 1 && Math.random() > debugLogSampleRate) return;
    api.logger?.info?.(`[model-failover][debug] ${message}`);
  }

  const initialCopilotEnabled = isCopilotEnabledNow();
  api.logger?.info?.(
    `[model-failover] enabled. copilotProxy=${initialCopilotEnabled ? "on" : "off"}. order=${effectiveOrder().join(" -> ")}`
  );

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
    const order = effectiveOrder();
    const chosen = firstAvailableModel(order, state);
    if (!chosen) return;

    const forceOverride = (cfg as any).forceOverride === true;
    const sessionKey = ctx?.sessionKey as string | undefined;
    if (sessionKey) {
      const forced = sessionForcedModel.get(sessionKey);
      if (forced && order.includes(forced)) {
        const forcedLimit = state.limited[forced];
        const forcedLimited = !!forcedLimit && forcedLimit.nextAvailableAt > nowSec();
        if (!forcedLimited) {
          debugLog(`session=${sessionKey} override=${forced} reason=immediate-failover-cache`);
          return { modelOverride: forced };
        }
        sessionForcedModel.delete(sessionKey);
        debugLog(`session=${sessionKey} cleared-stale-forced-model=${forced}`);
      }
    }

    const pinned = getPinnedModel(ctx?.sessionKey);

    if (forceOverride) {
      debugLog(`session=${ctx?.sessionKey ?? "n/a"} override=${chosen} reason=forceOverride`);
      return { modelOverride: chosen };
    }

    if (!pinned) {
      // no pin info; be conservative and don't override
      debugLog(`session=${ctx?.sessionKey ?? "n/a"} no-override reason=no-pinned-model`);
      return;
    }

    const copilotEnabled = isCopilotEnabledNow();
    const pinnedUnavailable =
      !order.includes(pinned) ||
      (pinned.startsWith("github-copilot/") && !copilotEnabled);

    if (pinnedUnavailable && chosen !== pinned) {
      debugLog(`session=${ctx?.sessionKey ?? "n/a"} override=${chosen} reason=pinned-unavailable pinned=${pinned}`);
      return { modelOverride: chosen };
    }

    const lim = state.limited[pinned];
    const isLimited = !!lim && lim.nextAvailableAt > nowSec();
    if (!isLimited) {
      debugLog(`session=${ctx?.sessionKey ?? "n/a"} no-override reason=pinned-available pinned=${pinned}`);
      return;
    }

    // pinned is limited -> switch to next available
    if (chosen !== pinned) {
      debugLog(`session=${ctx?.sessionKey ?? "n/a"} override=${chosen} reason=pinned-limited pinned=${pinned}`);
      return { modelOverride: chosen };
    }

    debugLog(`session=${ctx?.sessionKey ?? "n/a"} no-override reason=chosen-equals-pinned pinned=${pinned}`);
  });

  // 2) When agent ends with rate limit: mark current model limited + patch session pin.
  api.on("agent_end", (event: any, ctx: any) => {
    if (event?.success !== false) return;
    const err = event?.error as string | undefined;

    const isRate = isRateLimitLike(err);
    const isAuth = isAuthOrScopeLike(err);
    const isUnavailable = isTemporarilyUnavailableLike(err);
    if (!isRate && !isAuth && !isUnavailable) return;

    const currentModel = ctx?.model || ctx?.modelId || undefined;
    if (typeof currentModel !== "string" || currentModel.length === 0) {
      api.logger?.warn?.("[model-failover] Could not determine failed model from context; skipping limitation update.");
      return;
    }

    const state = loadState(statePath);

    const hitAt = nowSec();

    const order = effectiveOrder();
    const key = currentModel;

    // Detect provider-wide exhaustion (generic)
    const provider = key.split("/")[0];

    // Auth/scope errors shouldn't be retried aggressively.
    const defaultCooldownMin = isAuth
      ? Math.max(cooldownMinutes, 12 * 60)
      : (isUnavailable ? unavailableCooldownMinutes : cooldownMinutes);
    const nextAvail = hitAt + calculateCooldown(provider, err, defaultCooldownMin);

    // If it looks like a provider prefix (no spaces, has slash), assume provider-wide block for rate limits
    const isProviderWide = isRate && provider.length > 0;

    if (isProviderWide) {
        // Block ALL models from this provider
        let blockedCount = 0;
        for (const m of order) {
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

    const fallback = firstAvailableModel(order, state);

    if (ctx?.sessionKey && fallback) {
      sessionForcedModel.set(ctx.sessionKey, fallback);
      debugLog(`session=${ctx.sessionKey} queued-failover=${fallback} source=agent_end provider=${provider}`);
    }

    if (patchPins && ctx?.sessionKey && fallback) {
      patchSessionModel(ctx.sessionKey, fallback, api.logger);
    }

    if (notifyOnSwitch && ctx?.sessionKey && fallback) {
      const why = isAuth ? "auth/scope error" : (isUnavailable ? "temporary unavailability" : "rate limit");
      api.logger?.warn?.(`[model-failover] ${why} detected. Switched future turns to ${fallback} (sessionKey=${ctx.sessionKey}).`);
    }

    scheduleGatewayRestart();
  });

  // 3) If we ever send the raw rate-limit error to a channel, immediately patch the session.
  api.on("message_sent", (event: any, ctx: any) => {
    const content = (event?.content ?? "") as string;
    if (!content) return;
    const isRate = isRateLimitLike(content) || content.includes("API rate limit reached");
    const isUnavailable = isTemporarilyUnavailableLike(content);
    if (!isRate && !isUnavailable) return;

    const state = loadState(statePath);
    const order = effectiveOrder();

    // Only limit if we can identify the real current model.
    const currentModelRaw = ctx?.model || ctx?.modelId;
    if (typeof currentModelRaw !== "string" || currentModelRaw.length === 0) return;
    const currentModel = currentModelRaw;
    const provider = currentModel.split("/")[0];

    const hitAt = nowSec();
    const defaultCooldown = isUnavailable ? unavailableCooldownMinutes : cooldownMinutes;
    const nextAvail = hitAt + calculateCooldown(provider, content, defaultCooldown);

    // Provider-wide block (generic) for observed rate-limit messages
    const isProviderWide = isRate && provider.length > 0;
    if (isProviderWide) {
      for (const m of order) {
        if (m.startsWith(provider + "/")) {
          state.limited[m] = {
            lastHitAt: hitAt,
            nextAvailableAt: nextAvail,
            reason: `Provider ${provider} exhausted (msg detect)`,
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

    const fallback = firstAvailableModel(order, state);
    if (ctx?.sessionKey && fallback) {
      sessionForcedModel.set(ctx.sessionKey, fallback);
      debugLog(`session=${ctx.sessionKey} queued-failover=${fallback} source=message_sent provider=${provider}`);
    }
    if (patchPins && ctx?.sessionKey && fallback) {
      patchSessionModel(ctx.sessionKey, fallback, api.logger);
    }

    scheduleGatewayRestart();
  });
}
