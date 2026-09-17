# Nested correction: one MESSAGE mis-attributed the symbol; the artifacts do not

**Filed by:** `agent-teams-engineer` (lane A) · `2026-09-17T08:2xZ`
**Parent (byte-untouched):** this directory's `driver.mjs`, `output.log`, `result.json` (T-79 evidence, t8)
**Corrects:** my message to `Architect` about T-79(a), which wrote
"the rotation PRIMITIVE the scheduler's compose calls (`beginTaskAttempt`, `lib/scheduler.js`)".
**Leaves intact:** every artifact byte — the nit is in MESSAGE traffic, not on disk.

## The symbol map (T-55 discipline: cite the symbol, name its home)

| fact | home | proof |
|---|---|---|
| the rotation primitive `beginTaskAttempt` (and `activateTaskAttempt`, `assertTaskRearmable`) | **`packages/mpd-agent-teams-plugin/lib/state.js`** | the arm's own import: `terminal-rearm-refusal.test.mjs:29` `import { beginTaskAttempt } from "../lib/state.js"`; definitions in `lib/state.js` |
| the COMPOSE CALL SITE `const attemptId = beginTaskAttempt(task, currentMember.name)` | **`packages/mpd-agent-teams-plugin/lib/scheduler.js`** (lane C's file) | the arm's header, `terminal-rearm-refusal.test.mjs:15`, quotes it as the call site, and the T-79 acceptance (t1) named `activateTaskAttempt` in `state.js` as the root cause |
| the delivery-boundary re-check `mpd-delta terminal-dispatch-recheck` | `lib/scheduler.js` | region registered in `lib/mpd-deltas.js`; lane C / `t10` owns the delivery half |

## What the artifact text already says (so t12 chases the right file)

- `terminal-rearm-refusal.test.mjs:15` — "(`scheduler.js`: `const attemptId = beginTaskAttempt(task, currentMember.name)`)" = the call site, attributed to `scheduler.js` by that role, not as the symbol's home.
- `terminal-rearm-refusal.test.mjs:29` — imports `beginTaskAttempt` from `../lib/state.js`.
- `lib/state.js` region `mpd-delta terminal-task-rearm-refusal` — the refusal is in `beginTaskAttempt`/`activateTaskAttempt` in that file; the T-73 region in the same function names `lib/scheduler.js` only for the re-check that runs after it.
- `evidence/agent-teams/terminal-redispatch/20260917T072501Z/result.json` — "`beginTaskAttempt` (state.js — the symbol lib/scheduler.js's compose calls)".
- `agent-references/agent-teams-deltas.md` (D40 row) — quotes the call site inside lane C's file and keeps the delta in `lib/state.js`.

**Consequence:** no artifact change is required; the correction is filed here because a message is part of the record a reviewer may quote, and "a dispatch text is a claim too" (the wave's own lesson). The reviewer (`t12`) should read the symbol's home as **`lib/state.js`** and the call site as **`lib/scheduler.js`**.
