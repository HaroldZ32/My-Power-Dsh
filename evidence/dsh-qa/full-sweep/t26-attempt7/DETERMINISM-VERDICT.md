# DETERMINISM VERDICT for `session-start-team` — live-model VARIANCE (two runs, same revision, DIFFERENT failing set)
# t26 attempt 9 · 2026-09-17T05:07Z · docs-gate-engineer

## THE TWO READINGS (identical lane, identical revision, identical manifest pin `54585cab…`)
| run | dir | verdict | simpleSide | simpleNotices | complexTeams | complexNotices | negative control | duration |
|---|---|---|---|---|---|---|---|---|
| c5  | `c5/`  | fail `exit-1` | `[0,0,0]` ok | `[false,false,false]` | **`[1,0,0]`** | `[true,true,true]` | ok | 472,514 ms |
| c5d | `c5d-session-start-team-rerun/` | fail `exit-1` | `[0,0,0]` ok | `[false,false,false]` | **`[0,0,1]`** | `[true,true,true]` | ok | 658,976 ms |

## WHAT VARIES AND WHAT DOES NOT
- **Does NOT vary:** the gate's own behaviour — all three complex prompts carry a NOTICE in BOTH runs
  (`[true,true,true]`), the simple side stages nothing and notices nothing in both (`0/0`), and the
  negative control (gate explicitly disarmed) passes in both.
- **VARIES:** WHICH complex prompt ends with a staged team — index 0 in the first run, index 2 in the
  second — while exactly ONE of three stages in each. So the failing SET flips between runs on identical
  inputs.

## VERDICT: live-model VARIANCE (per the captain's rule: flip ⇒ variance, identical ⇒ deterministic)
The lane's `complexSide.ok` requires EVERY complex prompt to stage, so both runs are red; but the
red is not reproducible at the level of detail that matters (which prompt fails), which is the signature
of a model decision rather than a product rule. **Filed as live-model variance, NOT green and NOT a wave
failure.** The residual pattern worth `t32`'s judgement — *exactly* one of three stages in both runs — is
stated as a reading, not as a conclusion about the lane's expectation or the product's staging rule.

## SUPERSEDED PARTIAL, NAMED
`c5c-session-start-team-rerun/` is the cancelled stand-down-window run (partial dir, no `result.json`);
`c5` and `c5d` are the two complete readings above.

## CONCURRENCY WINDOWS (watchdog-engineer's caution — a determinism A/B must name what else was running)
Measured with `find evidence -type f -newermt <window>` bucketed by tree:
- **`c5` (12:38–12:46 +0800):** heavily contended — `team-watchdog/lanes` (93 files), `dsh-qa/full-sweep` (75,
  my own 8-way parallel chunks), `dsh-qa/session-start-team` (32, the lane itself), plus `mcp-call`,
  `web-settings-bridge`, `bundle-lifecycle`, `llm-dual-track`, `codegraph`.
- **`c5d` (12:56–13:07 +0800):** lightly contended — `dsh-qa/session-start-team` (32, the lane itself),
  `dsh-qa/full-sweep` (12: my `c14b` agent-teams-dispatch + `c5d` logs), `packaging/t70-root-file` (4),
  `platform/pack-drift` (1), `dsh-qa/final-skills-freeze` (1).
**Consequence for the verdict: the two runs sit under DIFFERENT contention profiles and still agree on
everything the gate does (`complexNotices [true,true,true]`, simple `0/0`, negative control ok) while
differing on WHICH complex prompt stages — so contention is not the explanation for the flip; it is a
model decision.** Stated explicitly because a determinism reading is the most load-sensitive one in the set.
