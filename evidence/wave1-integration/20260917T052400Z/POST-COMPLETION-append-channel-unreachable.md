# Post-completion measurement: the append-only repair channel is unreachable from this surface

**Recorded by:** `t35` seat (packaging-engineer) · `2026-09-17T05:47Z` · after the task reached `completed`
**Why this file exists:** the terminal record could not be corrected in place, so the correction and the
measurement that blocked it are written here instead of being silently dropped.

## What was attempted

`agent_teams_update_task(task_id=t35, status=completed, attempt_id=<current>, output_append="<correction>")` —
the append-only repair channel that `T-52`'s fix landed in the adopted plugin
(`packages/mpd-agent-teams-plugin/lib/tools.js`, symbol `output_append`: "APPEND-only repair of a TERMINAL task's
stored output"). The call **returned success** (`Task t35 attempt 7 → completed`).

## What was measured

| reading | value |
|---|---|
| stored `output` bytes after the call | **3,582** — byte-identical to the pre-call summary |
| `CORRECTION APPENDED` present in the stored output | **false** |
| append-related keys on the task record | **none** (only `output`) |
| my tool surface's `update_task` schema | `task_id, status, output, attempt_id, verdict, findings, changedPaths, acceptanceResults, commandsRun, amend` — **no `output_append`** |

**Conclusion:** the argument was silently ignored by the harness-side tool surface, so the append never reached
the record. The plugin's `output_append` implementation is real and independently reviewed
(`evidence/agent-teams/wave-review/20260917T030916Z/adopted-suite.log` → `(pass) T-52: a terminal output is
repaired APPEND-ONLY; every other terminal write and a running append stay refused`), but **this seat cannot
exercise it**: the harness's built-in `agent_teams_update_task` (the one a team member is given here) tolerates an
unknown key and reports success for a payload that stores nothing.

**This is a concrete instance of the already-registered `T-61`** ("`agent_teams_update_task` silently ignores
unknown argument names — snake-case payloads are reported as APPLIED but store nothing"). It is worth noting in
wave 2 as the instance with the highest cost: the ignored key was a *repair channel*, so the failure mode is a
false green on the one path meant to fix an unrecoverable record.

## Consequences carried into the wave's record

1. `t35`'s task record keeps the superseded numbers (34 fixed / 42 touched / 18 untouched). The corrected ones
   (**36 / 44 / 16**) live in `.mpd/TODO.md` §8.1–§8.5 and in this directory's `result.json` +
   `register-partition-check.{log,json}` (register sha256 `94bf0cfc43fb30e5…`), and the correction is reported to
   the captain by message.
2. The same limitation applies to `acceptanceResults`/`commandsRun`: a terminal record's structured verdicts are
   immutable, and the one channel that could extend them is unreachable from this surface. A wave-2 requirement
   should therefore require the *last* writer of a terminal record to hold its final numbers, or expose the append
   channel on the built-in tool.
3. Evidence for the whole measurement: this file plus the tool call's return (`completed`, no error) and the task
   record read above; both are reproducible in one command each and were taken on the settled revision pinned in
   `result.json`.
