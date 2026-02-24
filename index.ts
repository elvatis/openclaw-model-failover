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

function nowSec() {
  return Math.floor(Date.now() / 1000);
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
    : ["anthropic/claude-opus-4-6", "openai-codex/gpt-5.2", "google-gemini-cli/gemini-2.5-flash"]; 

  const cooldownMinutes = cfg.cooldownMinutes ?? 300;
  const statePath = expandHome(cfg.stateFile ?? "~/.openclaw/workspace/memory/model-ratelimits.json");
  const patchPins = cfg.patchSessionPins !== false;
  const notifyOnSwitch = cfg.notifyOnSwitch !== false;

  api.logger?.info?.(`[model-failover] enabled. order=${modelOrder.join(" -> ")}`);

  // 1) Before model resolve: if top choice is limited, override model.
  api.on("before_model_resolve", (event: any, ctx: any) => {
    const state = loadState(statePath);
    const chosen = firstAvailableModel(modelOrder, state);
    if (!chosen) return;

    // If session is pinned to something else AND our preferred isn't the same, we override.
    // This prevents being stuck on a limited provider.
    return { modelOverride: chosen };
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

    state.limited[key] = {
      lastHitAt: hitAt,
      nextAvailableAt: nextAvail,
      reason: err?.slice(0, 200),
    };
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
    // Assume first model in order caused it
    const hitAt = nowSec();
    state.limited[modelOrder[0]] = {
      lastHitAt: hitAt,
      nextAvailableAt: hitAt + cooldownMinutes * 60,
      reason: "outbound rate limit message observed",
    };
    saveState(statePath, state);

    const fallback = firstAvailableModel(modelOrder, state);
    if (patchPins && ctx?.sessionKey && fallback) {
      patchSessionModel(ctx.sessionKey, fallback, api.logger);
    }
  });
}
