# ADDENDUM to t74 — the FALSIFICATION CRITERION, stated and checked (both clauses refuted)
# docs-gate-engineer · 2026-09-17T05:44Z · parent files in this dir are byte-untouched by this addendum.
# Requested by the fix's author (qa-lane-engineer): state the criterion that would have refuted the repair.

## THE CRITERION (author's claim, restated so it can fail)
> The ladder makes the label name the STEP the lane's own evidence marks failed. The fix is **REFUTED** if
> (a) an independent replay of the recorded bytes yields anything other than `reason=step:archive` with
> `unauthorized` confined to `alsoDetected`, **or** (b) the pre-existing arm `fx-401` (fence text, **no** step
> map) no longer reads `reason=unauthorized`. Together those two are the whole claim: *same text, two labels,
> decided by the lane's own structure.*

## CLAUSE (a) — CHECKED, NOT REFUTED
My own fixture (NOT the author's): `evidence/dsh-qa/suite-runner/20260917T053605Z-t74-reason-ladder-verify/replay/`
— my mini-manifest + my lane re-emitting the RECORDED log `…/t26-attempt7/c13-agent-teams-adopt/lanes/agent-teams-adopt.log`
(973 B) and exiting 1.
recorded stdout line (`output.log:8`, byte-equal in `replay.log:4`):
```
[mpd-qa:(only)] FAIL case=replay-adopt reason=step:archive prereq="the lane's own evidence marks step `archive` as failed" signature=../../../../plan-c/c1-team/2026-09-17T04-49-06.038Z/result.json:null also=unauthorized exit=1 evidence=../../../../plan-c/c1-team/2026-09-17T04-49-06.038Z/web.log log=evidence/dsh-qa/suite-runner/20260917T053605Z-t74-reason-ladder-verify/replay/out/lanes/replay-adopt.log ms=38
```
structured record (`replay/evidence/dsh-qa/suite-runner/20260917T053605Z-t74-reason-ladder-verify/replay/out/result.json`,
`complete:true`, `exitCode:1`): `signature = {code: step:archive, label: "the lane's own evidence marks step
\`archive\` as failed", file: "../../../../plan-c/c1-team/2026-09-17T04-49-06.038Z/result.json", line: null}` and
`alsoDetected = [{code: unauthorized, file: "(the lane's own stdout)", line: 11}]` ⇒ the fence appears **only**
under `alsoDetected`, never as the reason. The two signature shapes also differ structurally: the step signature
names the lane's own evidence FILE with `line: null`, the fence signature a stdout LINE (11).
**Clause (a) holds.**

## CLAUSE (b) — CHECKED, NOT REFUTED
`node scripts/run-qa-lanes.mjs --self-test` → **exit 0**, and the assertion that would fail loudly if the
pre-existing arm had moved is in the self-test body:
`if (byCase["fx-401"].reason !== "unauthorized") failures.push(…)` — a marker-less 401 with **no** step map still
classifies as `unauthorized`. The same run also asserts `fx-both.reason === "unauthorized"` with
`alsoDetected[0].code === "absent-credentials"` (the co-detected prerequisite is surfaced, not swallowed), and
the rung-2 arm `fx-expected-fence` (`reason=step:archive`, `signature.code=step:archive`, fence in
`alsoDetected`, verdict still `fail`). **Clause (b) holds.**

## THE DISCRIMINATION, IN ONE LINE
`fx-401` and `fx-expected-fence` print the SAME fence text; the first has no step map (⇒ `unauthorized`), the
second's map marks `archive` failed (⇒ `step:archive`). Same text, two labels — which is the repair's claim.

## NOTES CARRIED FROM THE AUTHOR'S MESSAGE (both verified here)
- The runner writes its `result.json` under `--root`, not under the cwd — I hit the same trap on my first read
  (the file was nested under `<fixture>/evidence/…`), so the acceptance's "quote the command and output" uses the
  one-line runner summary, which is emitted to stdout regardless.
- The live lane is GREEN today (author: 77,649 ms) and is **explicitly not the fix**: the subject is the LABEL on
  the recorded failing bytes, so the proof is the replay above, not a live pass.
- Neutrality pairs re-measured here and identical to the author's: runner
  `f60ef2b54ff7bb5dd776b99b9934261ec671ed2eeee40c46f712f907833e0f2e` →
  `6bea2b38de2a4ac76ddb672b25bdc5f226e870bdd45cafb9026ae9e3c9c9ded0` (44,774 B); corpus
  `68318157344aafecabb641b9d947d0f17ab6a4bce5c399b486f18790cc7e3a9c` / 323 (LF, "in sync: no change");
  `VENDOR_LOCK.json` `6ca531d2b20afb19cdc336fa90fcbb7509d2237cfaea62adb2850325d6134992`, mtime `13:24:25`
  (pre-dating the `13:29:36` runner edit), with `find skills VENDOR_LOCK.json -newermt 13:29:36` → empty.
