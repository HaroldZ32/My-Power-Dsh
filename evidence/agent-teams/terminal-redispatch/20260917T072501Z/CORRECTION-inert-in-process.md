# Nested correction: "inert in-process" is an INFERENCE about the host, not a measurement

**Filed by:** `agent-teams-engineer` (lane A) · `2026-09-17T08:4xZ`
**Corrects:** three texts of mine that repeat the register's framing ("wave 1's fix is inert in-process")
as if the pre-restart state were measured. Raised by `watchdog-engineer` (lane C), whose `t10` instrument
measured the opposite for a FRESH process.
**Parents (byte-untouched):** `packages/mpd-agent-teams-plugin/self-fix-tests/terminal-rearm-refusal.test.mjs`
(lines 18–21 and 313–315) and `evidence/agent-teams/terminal-redispatch/20260917T072501Z/result.json`
(`honest_bound`, line 57). Both files are owned by tasks that are now TERMINAL (`t8`, `t24`), so no member
may edit them until the captain opens a repair task — this note is the correction in the meantime.

## The readings, separated

| proposition | status |
|---|---|
| in a FRESH process the wave-1 delivery re-check refuses deterministically, and the red leg appears only when the region is STRIPPED | **MEASURED** (lane C's `t10` arms: green on the real tree, exactly 1 terminal delivery on a region-stripped copy; and lane A's fresh-child-process leg for the rotation guard) |
| the T-07 RACE arm cannot place the completion before the delivery DECISION in-process | **MEASURED bound** (wave-1: `refusalsObserved=0/20`; the arm's own header calls it a real-window race) |
| the wave-2 live replays happened because the HOST process predated the fix (T-21, no hot reload) | **INFERENCE, not measurement** — a pid-namespaced sandbox cannot read the host start time (`ps -eo lstart` shows only the sandbox's own processes). Consistent with the replays; not proof of them |

## Proposed replacement text (one-line, for whoever lands the repair)

- line 20-21: "…the honest bound being that the wave-2 live replays are ATTRIBUTED to a host process that
  predates the fix (T-21's no-hot-reload class) — an inference, not a measurement; what this file measures
  is the guard's effect in a fresh process and the pre-fix behaviour on a scratch copy."
- lines 313-315: "The fresh process (a restart of the module graph) is where the guard MUST be effective:
  the live replays' cause is ATTRIBUTED to a stale host module (T-21) rather than measured, and lane C's
  `t10` arms are the instrument for the delivery half."
- `result.json` → `honest_bound`: same substitution; the register's own row wording ("the wave's fix is inert
  in-process") is quoted in `register_row` and must be read as the REGISTER's claim, which lane C's
  fresh-process measurement qualifies.

**Nothing behavioural changes:** not one assertion, not one fixture, not one reading — this note corrects
wording only, and the arm's readings stand (6/6, five determinism runs; pre-fix tree exit 1, 2 fail / 4 pass).
