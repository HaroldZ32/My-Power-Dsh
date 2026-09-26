# t26 attempt 7 — CHUNK PLAN (multi-job board, amended contract)
# attempt_id 7a9fd4c2-bd21-4a8e-a1b6-466c728cf2ed · inScope evidence/dsh-qa/full-sweep · started 2026-09-17T04:40Z
#
# WHY CHUNKED: run 1 (single 33-entry job) was killed after ~17 min with 2 verdicts; run 2 died inside
# lane 1. Both were shape (a) (runner as the job's own foreground), so a job-LIFETIME bound (~17 min) is
# the control, not the wrapper trap (which is separate: `mpd-bg run` as a job's foreground kills its child).
#
# LAUNCH SHAPE: (a) — the runner IS the job's foreground, stdout+stderr to the chunk's own log under this
# dir, `run_in_background: true`. Where the pidfile ergonomics are wanted, (b) `mpd-bg run …; wait`.
#
# STITCHED-BOARD RULES (amended A1/A4/A6):
#  · run 1's two verdicts are kept and bound to the manifest pin `919656a8…`; every chunk verdict is bound
#    to the pin of the manifest on disk when that chunk started.
#  · selections are canonical-identical (`58128ebd1ed1c748`: same case, script, args) — multi-job, NOT
#    multi-selection.
#  · the board reports chunk count, lanes-run-vs-selected, per-chunk `complete`/`finishedAt`, and the
#    launch mechanism; NEVER a single-run `complete:true`.
#  · 33 selected = 27 lanes + 6 gates; the last entry overall is the `pack-closure` GATE and the last LANE
#    is `workmate-team-member` (A4).
#
# CHUNKS (25 lanes + 6 gates; run 1 already carries entries 1-2)
#  c1  extension-lifecycle, extension-mcp-bridge, extension-template, mount-assert      (likely fast)
#  c2  skill-catalog-probe, tool-output-validation, web-client-adapt, web-settings-bridge
#  c3  agent-teams-sidebar                                                              (single: unknown, web+stub)
#  c4  preset-conformance, bundle-lifecycle
#  c5  session-start-team, workmate-team-member                                         (last LANE)
#  c6  codegraph-smoke, memory-smoke, team-route-rewire, relocate-smoke
#  c7  dual-track-smoke, mcp-call
#  c8  plan-c-smoke, preset-register
#  c9  software-smoke, ultrawork-smoke
#  c10 vision-smoke, workmate-library
#  c11 qa-lane-drift, qa-runner-self-test, mpd-ext-self-test, mpd-ext-validate-example,
#      mpd-ext-validate-template, pack-closure                                          (last ENTRY)
# FAILURE RULE: a chunk that dies or times out is reported with its reading and its lanes are re-run in
# their own (smaller) chunk; any `--timeout` I pass is declared as an explicit bound, never used to hide a hang.
# TWIN-SCAN RULE: every published twin number carries the instrument's sha256_16 taken before and after.
