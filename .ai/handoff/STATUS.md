# openclaw-model-failover: Current State of the Nation

> Last updated: 2026-02-27 by claude-opus-4-6 (T-006: Usage metrics and cooldown history)
> Commit: pending
>
> **Rule:** This file is rewritten (not appended) at the end of every session.
> It reflects the *current* reality, not history. History lives in LOG.md.

---

<!-- SECTION: summary -->
v0.2.0 production with auto-gateway-restart on failover. 133 vitest unit tests covering all exported utilities, register() handler logic (before_model_resolve, agent_end, message_sent), DST transition edge cases, status inspection (getFailoverStatus, clearModel, clearAllModels, formatDuration, formatStatus), atomic state file writes, and usage metrics (recordEvent, loadEvents, getMetricsSummary, resetMetrics, formatMetrics, formatEvents). New metrics.ts module provides append-only JSONL event logging with per-model and per-provider aggregation for capacity planning and model order optimization.
<!-- /SECTION: summary -->

<!-- SECTION: build_health -->
## Build Health

| Check | Result | Notes |
|-------|--------|-------|
| `npm test` | Pass (133 tests) | All utilities + handlers + DST transitions + status inspection + atomic writes + usage metrics tested via vitest |
| `npm run build` | Pass | tsc --noEmit clean |
| `lint` | N/A | Not configured |

<!-- /SECTION: build_health -->

---

<!-- SECTION: current_state -->
## Current State

- **Version:** 0.2.0
- **CI:** None configured
- **Production:** Active as OpenClaw plugin
- **v0.2 Roadmap:** COMPLETE - All tasks (T-001 through T-006) done

## Key Features (v0.2.0)

- Auto-gateway restart after failover switch (`restartOnSwitch`, `restartDelayMs`)
- Copilot-proxy cooldown error detection and failover triggering
- Immediate in-memory session override for instant model switching
- Temporary unavailability detection (cooldown, 503 service unavailable)
- `unavailableCooldownMinutes` config (default 15min vs 300min for rate limits)
- Provider-wide blocking logic
- Debug logging mode with sample rate
- Supports 40+ LLM failover: Anthropic, OpenAI, Google, GitHub Copilot, Perplexity
- DST-aware midnight PT calculation (tries both UTC-7 and UTC-8 offsets)
- **Status inspection CLI** (`npx tsx status.ts`) with pretty-print, JSON, and clear commands
- **Atomic state writes** - temp-file + rename prevents corruption on crash
- **Usage metrics** - append-only JSONL event log with per-model/per-provider aggregation, CLI (`npx tsx metrics.ts`), and programmatic API

<!-- /SECTION: current_state -->

---

<!-- SECTION: what_is_missing -->
## v0.2 Roadmap - Complete

| Feature | Status | GitHub Issue | Description |
|---------|--------|-------------|-------------|
| ~~Real unit tests~~ | DONE | [#1](https://github.com/homeofe/openclaw-model-failover/issues/1) | 84 vitest tests covering utilities + handlers + DST |
| ~~DST bug~~ | DONE | [#2](https://github.com/homeofe/openclaw-model-failover/issues/2) | getNextMidnightPT now tries both offsets, verified with DST transition tests |
| ~~Status inspection~~ | DONE | [#3](https://github.com/homeofe/openclaw-model-failover/issues/3) | status.ts with CLI + programmatic API, 21 tests |
| ~~Atomic writes~~ | DONE | [#4](https://github.com/homeofe/openclaw-model-failover/issues/4) | saveState() uses temp-file + rename for crash-safe writes |
| ~~Usage metrics~~ | DONE | [#5](https://github.com/homeofe/openclaw-model-failover/issues/5) | metrics.ts with JSONL event log, aggregation, CLI, 28 tests |

<!-- /SECTION: what_is_missing -->

---

## Trust Levels

- **(Verified)**: confirmed by running code/tests
- **(Assumed)**: derived from docs/config, not directly tested
- **(Unknown)**: needs verification
