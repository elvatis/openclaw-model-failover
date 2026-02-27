# openclaw-model-failover: Next Actions for Incoming Agent

> Priority order. Work top-down.
> Updated: 2026-02-27 (v0.2 roadmap defined)

---

## T-002: Write proper unit tests (GitHub issue #1)

**Goal:** Extract core logic into testable exports and write real unit tests.

**Context:**
- Current test-logic.ts duplicates functions instead of importing them
- None of the internal functions in index.ts are exported
- Need 80%+ coverage on core failover logic

**What to do:**
1. Extract pure functions from `index.ts` into `lib.ts` with named exports
2. Rewrite `test-logic.ts` to import from `lib.ts`
3. Add test cases for: detection, cooldown calculation, firstAvailableModel, provider blocking
4. Optionally add Vitest as test runner

**GitHub issue:** https://github.com/homeofe/openclaw-model-failover/issues/1

**Definition of done:**
- [ ] `npm test` exits 0 and tests real code, not mock copies
- [ ] At least 10 test cases covering core failover logic
- [ ] TRUST.md updated to mark tested functions as (Verified)

---

## T-003: Fix DST bug in getNextMidnightPT (GitHub issue #2)

**Goal:** Replace hardcoded -8h PST offset with timezone-aware calculation.

**Context:**
- During PDT (March-November), the reset time is 1 hour late
- Google quota models stay blocked unnecessarily for ~1 extra hour
- Node 20+ has Intl.DateTimeFormat with timezone support

**What to do:**
1. Replace `ptOffset = -8 * 60 * 60 * 1000` with dynamic offset using `Intl.DateTimeFormat`
2. Add unit test that verifies correct behavior in both PST and PDT
3. Update TRUST.md

**GitHub issue:** https://github.com/homeofe/openclaw-model-failover/issues/2

**Definition of done:**
- [ ] getNextMidnightPT returns correct time regardless of DST
- [ ] Unit test covers both PST and PDT scenarios

---

## T-004: Add failover status inspection (GitHub issue #3)

**Goal:** Give users visibility into current failover state.

**Context:**
- No way to see which models are blocked or when they recover
- Debugging requires manually reading the JSON state file

**What to do:**
1. Create `status.ts` that reads and pretty-prints state file
2. Optionally hook into OpenClaw command system
3. Add manual clear functionality

**GitHub issue:** https://github.com/homeofe/openclaw-model-failover/issues/3

---

## T-005: Atomic state file writes (GitHub issue #4)

**Goal:** Prevent state file corruption from concurrent access or mid-write crashes.

**What to do:**
1. Change `saveState` to use write-to-temp-then-rename pattern
2. Optionally add file locking for concurrent read-modify-write

**GitHub issue:** https://github.com/homeofe/openclaw-model-failover/issues/4

---

## T-006: Usage metrics and cooldown history (GitHub issue #5)

**Goal:** Track failover events for capacity planning and model order optimization.

**What to do:**
1. Add append-only JSONL event log
2. Add aggregate counters to state file
3. Add config options for metrics

**GitHub issue:** https://github.com/homeofe/openclaw-model-failover/issues/5

---

## Recently Completed

| Item | Resolution |
|------|-----------|
| T-001: Define v0.2 roadmap | DONE - 5 GitHub issues created (2026-02-27) |
| T-002: Write unit tests for failover logic | DONE - 73 vitest tests (2026-02-27) |
| T-003: Fix DST bug in getNextMidnightPT | DONE - tries both offsets, 8 DST tests added (2026-02-27) |
| T-004: Add failover status inspection | DONE - status.ts with CLI + API, 21 tests (2026-02-27) |
| T-005: Atomic state file writes | DONE - temp-file + rename pattern (2026-02-27) |
| T-006: Usage metrics and cooldown history | DONE - metrics.ts with JSONL event log, 28 tests (2026-02-27) |
| Initial scaffold | Done |
| Copilot-proxy cooldown detection | Done in v0.1.2 (commit a35b015) |
| Immediate in-memory session override | Done in v0.1.2 |
| Auto-gateway restart on failover | Done in v0.1.6 (commit fe36602) |
| 40+ LLM failover support | Done in v0.1.2 |
| Provider-wide blocking fix | Done in v0.1.2 |

---

## Reference: Key File Locations

| What | Where |
|------|-------|
| Plugin manifest | `openclaw.plugin.json` |
| Package config | `package.json` |
| Main source | `index.ts` |
| Tests (mock) | `test-logic.ts` |
| GitHub repo | https://github.com/homeofe/openclaw-model-failover |
| GitHub issues | https://github.com/homeofe/openclaw-model-failover/issues |
