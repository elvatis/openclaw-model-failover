# openclaw-model-failover: Agent Journal

> **Append-only.** Never delete or edit past entries.
> Every agent session adds a new entry at the top.
> This file is the immutable history of decisions and work done.

---

## 2026-02-27 T-006: Usage metrics and cooldown history

**Agent:** claude-opus-4-6
**Phase:** implementing
**Commit:** pending

### What was done

- Created `metrics.ts` module with append-only JSONL event logging
  - `recordEvent()` - appends structured events to JSONL file
  - `loadEvents()` - reads and parses events, skips malformed lines
  - `getMetricsSummary()` - aggregates per-model and per-provider counters with optional time filtering
  - `resetMetrics()` - clears the metrics log
  - `formatMetrics()` / `formatEvents()` - terminal-friendly output
  - CLI entry point: `npx tsx metrics.ts [--json | tail [N] | reset]`
- Integrated metrics recording into `index.ts`:
  - `agent_end` hook records error events (rate_limit, auth_error, unavailable) and failover events
  - `message_sent` hook records error events and failover events
  - New config options: `metricsEnabled` (default true), `metricsFile`
- Created `metrics.test.ts` with 28 tests covering all functions
- Updated `openclaw.plugin.json` with metrics config schema
- Version bumped to 0.2.0 (all v0.2 roadmap tasks complete)
- Total test count: 133 (84 index + 21 status + 28 metrics)
- Mocked metrics module in `index.test.ts` to prevent side effects from existing tests

### Decisions made

- Used JSONL format (one JSON object per line) for the event log - simple, append-friendly, easy to parse
- Metrics are recorded as a side-effect in the hooks rather than requiring separate infrastructure
- Failover events are separate from error events - a single rate limit hit produces both an error event and a failover event
- `metricsEnabled` defaults to true so users get metrics out of the box
- Used `fs.appendFileSync` for simplicity since each line is small and we don't need atomicity for append operations

---

## 2026-02-27 T-003: Fix DST bug in getNextMidnightPT

**Agent:** claude-opus-4-6
**Phase:** implementing
**Commit:** pending

### What was done

- Rewrote `getNextMidnightPT()` to try both possible PT offsets (UTC-7 PDT, UTC-8 PST) and verify which one produces midnight when formatted via Intl.DateTimeFormat
- Old approach: used current offset to derive tomorrow's midnight - wrong when DST transition occurs between now and tomorrow
- New approach: exhaustive check of both offsets, picking the one that verifies as midnight in PT
- Added 8 new tests covering all DST edge cases:
  - Normal PST day, normal PDT day
  - Spring forward: before transition, on transition day (bug case), after transition
  - Fall back: night before, on transition day (bug case), after transition
- Total tests: 81 (up from 73)
- Updated STATUS.md, TRUST.md, MANIFEST.json

### Decisions made

- Chose "try both offsets" approach over "guess and correct" because it's simpler, more readable, and exhaustive for America/Los_Angeles
- Hardcoding offsets 7 and 8 is acceptable since the function is specifically for PT
- Testing with vi.useFakeTimers() + vi.setSystemTime() to simulate exact DST transition moments

---

## 2026-02-27 v0.2 Roadmap Definition

**Agent:** claude-opus-4-6
**Phase:** planning
**Commit:** fe36602 + roadmap commit (TBD)

### What was done

- Committed uncommitted v0.1.6 changes (auto-gateway-restart feature: restartOnSwitch, restartDelayMs)
- Created GitHub labels: high-priority, medium-priority, low-priority
- Created 5 GitHub issues for v0.2 roadmap:
  - #1: Export internal functions and add proper unit tests (HIGH)
  - #2: Fix hardcoded PST offset in getNextMidnightPT - DST bug (HIGH)
  - #3: Add failover status inspection command (MEDIUM)
  - #4: Add atomic state file writes to prevent corruption (MEDIUM)
  - #5: Add per-model and per-provider usage metrics (LOW)
- Updated DASHBOARD.md with v0.2 issue tracker and suggested implementation order
- Updated STATUS.md to reflect roadmap is now defined
- Updated NEXT_ACTIONS.md with issue-linked tasks
- Pushed v0.1.6 commit to origin/main

### Decisions made

- Chose to focus on testability (#1) and correctness (#2) as high-priority over new features
- DST bug classified as high-priority because it affects 8 months/year
- Metrics (#5) kept low-priority since it is a nice-to-have, not a correctness issue
- Recommended doing #1 and #2 together since tests should cover the DST fix

---

## 2026-02-26 AAHP v3 Migration

**Agent:** claude-sonnet-4.6
**Phase:** implementation
**Commit:** a35b015

### What was done

- Migrated `.ai/handoff/` from minimal v1 structure to full AAHP v3
- Added section markers to STATUS.md, T-XXX IDs to NEXT_ACTIONS.md
- Created TRUST.md, CONVENTIONS.md, WORKFLOW.md, LOG-ARCHIVE.md, .aiignore, MANIFEST.json

---

## 2026-02-24 Initialized AAHP handoff structure

- Initialized AAHP handoff structure (minimal v1)
