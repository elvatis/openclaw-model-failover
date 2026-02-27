# openclaw-model-failover: Trust Register

> Tracks verification status of critical system properties.

---

## Confidence Levels

| Level | Meaning |
|-------|---------|
| **verified** | An agent executed code, ran tests, or observed output to confirm this |
| **assumed** | Derived from docs, config files, or chat, not directly tested |
| **untested** | Status unknown; needs verification |

---

## Build System

| Property | Status | Last Verified | TTL | Expires | Agent | Notes |
|----------|--------|---------------|-----|---------|-------|-------|
| `npm run build` passes | verified | 2026-02-27 | 7d | 2026-03-06 | claude-opus-4-6 | tsc --noEmit clean |
| `npm test` passes | verified | 2026-02-27 | 7d | 2026-03-06 | claude-opus-4-6 | 73 tests, all passing |
| TypeScript compiles | verified | 2026-02-27 | 7d | 2026-03-06 | claude-opus-4-6 | Strict mode, no errors |

---

## Plugin Behavior

| Property | Status | Last Verified | TTL | Expires | Agent | Notes |
|----------|--------|---------------|-----|---------|-------|-------|
| Copilot-proxy cooldown detected | verified | 2026-02-27 | 14d | 2026-03-13 | claude-opus-4-6 | Tested in agent_end + copilot filtering tests |
| In-memory session override works | verified | 2026-02-27 | 14d | 2026-03-13 | claude-opus-4-6 | Tested in before_model_resolve handler tests |
| Failover cascade across providers | verified | 2026-02-27 | 14d | 2026-03-13 | claude-opus-4-6 | End-to-end cascade test (section 19) |
| Provider-wide blocking correct | verified | 2026-02-27 | 14d | 2026-03-13 | claude-opus-4-6 | Tested in agent_end + message_sent handlers |
| Gateway restart scheduling | verified | 2026-02-27 | 14d | 2026-03-13 | claude-opus-4-6 | Tested with fake timers + spawn mock |

---

## Security

| Property | Status | Last Verified | TTL | Expires | Agent | Notes |
|----------|--------|---------------|-----|---------|-------|-------|
| No secrets in source | assumed | 2026-02-26 | 7d | 2026-03-05 | - | Config from OpenClaw plugin system |

---

## Update Rules (for agents)

- Change `untested` - `verified` only after **running actual code/tests**
- Never downgrade `verified` without explaining why in `LOG.md`
