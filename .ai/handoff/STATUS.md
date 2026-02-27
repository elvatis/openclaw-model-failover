# openclaw-model-failover: Current State of the Nation

> Last updated: 2026-02-27 by claude-opus-4-6 (T-002: unit tests for failover logic)
> Commit: pending
>
> **Rule:** This file is rewritten (not appended) at the end of every session.
> It reflects the *current* reality, not history. History lives in LOG.md.

---

<!-- SECTION: summary -->
v0.1.6 production with auto-gateway-restart on failover. 73 vitest unit tests covering all exported utilities and register() handler logic (before_model_resolve, agent_end, message_sent). Legacy mock-based test-logic.ts removed.
<!-- /SECTION: summary -->

<!-- SECTION: build_health -->
## Build Health

| Check | Result | Notes |
|-------|--------|-------|
| `npm test` | Pass (73 tests) | All utility functions + register() handlers tested via vitest |
| `npm run build` | Pass | tsc --noEmit clean |
| `lint` | N/A | Not configured |

<!-- /SECTION: build_health -->

---

<!-- SECTION: current_state -->
## Current State

- **Version:** 0.1.6
- **CI:** None configured
- **Production:** Active as OpenClaw plugin
- **v0.2 Roadmap:** DEFINED - 5 GitHub issues created

## Key Features (v0.1.6)

- Auto-gateway restart after failover switch (`restartOnSwitch`, `restartDelayMs`)
- Copilot-proxy cooldown error detection and failover triggering
- Immediate in-memory session override for instant model switching
- Temporary unavailability detection (cooldown, 503 service unavailable)
- `unavailableCooldownMinutes` config (default 15min vs 300min for rate limits)
- Provider-wide blocking logic
- Debug logging mode with sample rate
- Supports 40+ LLM failover: Anthropic, OpenAI, Google, GitHub Copilot, Perplexity

<!-- /SECTION: current_state -->

---

<!-- SECTION: what_is_missing -->
## What is Missing (v0.2 Roadmap)

| Gap | Severity | GitHub Issue | Description |
|-----|----------|-------------|-------------|
| ~~Real unit tests~~ | ~~DONE~~ | [#1](https://github.com/homeofe/openclaw-model-failover/issues/1) | 73 vitest tests covering utilities + handler logic |
| DST bug | HIGH | [#2](https://github.com/homeofe/openclaw-model-failover/issues/2) | getNextMidnightPT uses hardcoded PST offset, wrong during PDT |
| Status inspection | MEDIUM | [#3](https://github.com/homeofe/openclaw-model-failover/issues/3) | No way to view current failover state |
| Atomic writes | MEDIUM | [#4](https://github.com/homeofe/openclaw-model-failover/issues/4) | State file can corrupt under concurrent access |
| Usage metrics | LOW | [#5](https://github.com/homeofe/openclaw-model-failover/issues/5) | No historical data for capacity planning |

<!-- /SECTION: what_is_missing -->

---

## Trust Levels

- **(Verified)**: confirmed by running code/tests
- **(Assumed)**: derived from docs/config, not directly tested
- **(Unknown)**: needs verification
