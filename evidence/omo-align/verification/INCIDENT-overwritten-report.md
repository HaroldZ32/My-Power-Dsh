# INCIDENT — the delivered t17 verification report was overwritten by its own driver

Status: **contained and repaired.** The t17 verdict (`pass`) is unchanged; the report was rebuilt
from the delivered content plus the two additive annotations that were already applied. No product
file (`packages/**`, `presets/**`, `scripts/**`, `skills/**`, `docs/**`) was touched.

## 1. What happened (measured)

| time (UTC) | event |
|---|---|
| 14:41 | Lead delivered `evidence/omo-align/verification/result.json` (≈33 KB, keys `verdict/verdictScope/captainAdjudications/assertions[10]/acceptanceResults[8]/t1CrossCheck/commandsRun/gateTable/findings[8]/residualRisks/...`) |
| 14:49:54 | `evidence/omo-align/verification/run.mjs` was executed; it wrote its own much smaller `result.json` (7,757 B / `sha256 9f8e977e9f27046b8c2bd2a96d3407ea1e7c562584b9c7eaee02fc9f320179c6`, keys `{verdict, steps, head, generatedAt}`, `verdict = needs_revision`) to the SAME name, and rewrote `output.log` |
| 14:52 | Lead fixed `run.mjs` (timestamped output path + dedupe-aware manual-entry comparison) |
| ≈14:54 | the artifact was rewritten AGAIN (7,876 B) — an in-flight process that had loaded the PRE-fix driver before the fix landed; its output path was still the delivered `result.json` |
| 14:58 | Lead restored the report and added an immutable copy |

Root cause of the red `needs_revision`: the driver's `manualEntries` step compared a constant-derived
list (`TEAM_TOOL_NAMES + MEMBER_TOOL_NAMES`, 13 entries) against the frozen 14-entry
`manualEntryNames.tools` — a comparison that can never pass because `agent_teams_task_contract` is an
mpd delta and is absent from the upstream constants. **Verified false negative**, not a real rename.

## 2. Where the copies are

| artifact | path |
|---|---|
| the exact post-overwrite state (7,757 B / `9f8e977e…`) | `raw/run-144954-overwrite-state.json` |
| the exact post-overwrite log (20,406 B) | `raw/run-144954-overwrite-output.log` |
| Reviewer's observed copy (7,508 B, also post-overwrite) | `evidence/omo-align/review/raw/verification-result-observed-144744.json` (Reviewer-owned; not touched) |
| the restored report | `result.json` (= `raw/t17-report-restored.json`, byte-identical) |
| the restored raw log | `output.log` |

Everything else in `raw/` survived untouched (hash tables, gate logs, the opt1/opt2/isolation
drivers, the config-plane log, the manual-entry log, contract snapshots, `recheck-after-go.json`).

## 3. Prevention

1. **`run.mjs` no longer writes the delivered artifacts.** It writes
   `raw/run-<stamp>.json` + `raw/run-<stamp>.output.log` and never touches `result.json` /
   `output.log`. The rule is stated in an English comment at the top of the script:
   *never overwrite a delivered/cited artifact; a re-run gets a new timestamped name.*
2. **The manual-entry comparison is dedupe-aware.** Both sides are reduced to sorted unique sets and
   a real rename now surfaces as named `missingVsContract` / `extraVsRegistered` lists instead of a
   bare `false`.
3. **An immutable copy of the report lives at `raw/t17-report-restored.json`**, so a future same-name
   writer cannot erase the content again.
4. **Belt and braces for the wave:** this is the second same-shape defect (the first was t4's input
   being overwritten by a same-named file). The general rule — *any artifact already delivered or
   cited by a downstream task must never be rewritten under the same name; re-runs use a timestamped
   name* — belongs in the wave's rules and in the ledger.

## 4. Byproduct: the overwriting run is useful corroboration

The preserved post-overwrite state is a SECOND independent driver's view of the same revision, and it
agrees with the delivered verdict everywhere except the false-negative manual-entry step:

- two-sided: `simpleTeams [0,0,0]` / `simpleNotices [false,false,false]`, `complexTeams [1,1,1]` /
  `complexNotices [true,true,true]`, `isolationAllOk: true`;
- OPT-1 driven through the **real** `agent_teams_claim_task` tool: B claimed in 13 ms with
  `failedDependencies ["A"]`; with A completed, `failedDependencies []`;
- `cSignal`: simple 1-3 all `[]`, complex 1-3 non-empty, explicit flag alone `["A"]`;
- all 9 gates exit 0 — including `bundle-lifecycle` PASS, which confirms finding F7 was a
  concurrency-only false red (the batch runner had six boots in flight).

## 5. Review finding F4 (assigned back to Lead) — disposition

- **(a) reverse-control run record:** upheld as a description of the shipped case alone, but the
  delivered evidence set already contains real runs: three real SIMPLE boots in the mandated case
  (`evidence/dsh-qa/session-start-team/2026-09-13T14-28-41.689Z`, `.../2026-09-13T14-40-32.418Z`) plus
  one independent simple boot in `raw/isolation-gate-independent.result.json`. The offline
  `gate-probe` is an ADDITIONAL falsifier, never the sole one. The restored report cites all of them
  under `A-gate-two-sided` / acceptance 1.
- **(b) S3 assertion strength:** **upheld and downgraded in writing.** `nextReadyTask` is
  module-private (`scheduler.js` exports only `DEPENDENCY_OUTPUT_MAX_CHARS`,
  `DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS`, `collectCompletedDependencyOutputs`,
  `formatDependencyOutputs`, `assignmentPrompt`, `installTeamScheduler`), no test outside
  `scheduler.js` references it, and the S3 test's inline replica uses a pre-OPT-1 readiness rule.
  S3 is therefore recorded as **source-level + predicate-level evidence, not dispatch-level** in
  `result.json` (assertion `A-s1-s4`, residual `R1`, finding `reviewF4`).
  A true dispatch-level assertion requires a product change (export `nextReadyTask`, or drive
  `installTeamScheduler`), which belongs to the implementation writer — flagged for t22.

## 6. Reproduction / audit commands

```bash
cd /root/dshProj/my-power-dsh
sha256sum evidence/omo-align/verification/result.json            # 90b76b100aaf130b92ceecac2474127f6ac64b5a26b76d459ce74fe358ae9db2
sha256sum evidence/omo-align/verification/raw/t17-report-restored.json   # identical to the above
node -e "const r=require('./evidence/omo-align/verification/result.json'); console.log(r.verdict)"   # pass
node -e "const r=require('./evidence/omo-align/verification/raw/run-144954-overwrite-state.json'); console.log(r.verdict)"  # needs_revision (the overwriting run)
grep -n "raw/run-" evidence/omo-align/verification/run.mjs        # the fixed output path
```

## 7. Reconciliation with Reviewer's observation (14:47-14:50Z window)

Reviewer's re-observation was correct FOR ITS WINDOW; the rebuild landed later (14:56:48Z). Measured facts:

| observation | artifact | size | sha256 | schema | verdict |
|---|---|---|---|---|---|
| Reviewer 14:47Z (preserved by them) | evidence/omo-align/review/raw/verification-result-observed-144744.json | 7,508 B | b73b7be8... | {verdict,steps,head,generatedAt} | needs_revision |
| 14:49:54Z (preserved here) | raw/run-144954-overwrite-state.json | 7,757 B | 9f8e977e... | {verdict,steps,head,generatedAt} | needs_revision |
| 14:56:48Z RESTORED (current) | result.json | 45,244 B | 90b76b10aaf130b92ceecac2474127f6ac64b5a26b76d459ce74fe358ae9db2 | full t17 report | **pass** |

manualEntries root cause, measured in BOTH preserved states: the reviewer copy carried 17 names with 4 duplicates
(agent_teams_claim_task/update_task/send_message/status); the 14:49 state carried the same 13 unique names; BOTH omit
agent_teams_task_contract, while the frozen manualEntryNames.tools has 14 unique entries -> the comparison can never pass.

Current re-derivation (read-only, exit 0):
  node -e "const r=require(\"./evidence/omo-align/verification/result.json\"); console.log(r.verdict, Object.keys(r).length, r.assertions.length, r.findings.length)"  # pass 26 10 9
  grep -rl "pinnedRevisionHashes\|t1CrossCheck\|residualRisks" .   # hits result.json, raw/t17-report-restored.json, INCIDENT-*.md (and review/result.json, which quotes them)

So Reviewer F3's operative claim ("verdict=pass cannot be re-derived from the artifact path it names") no longer holds;
what stands is the process lesson: the overwrite WINDOW was real, and run.mjs is fixed so a re-run cannot recreate it.

## 8. Attribution correction (authoritative, from the captain 15:02Z)

The ~14:54Z overwrite was caused by the IMPLEMENTER'S SELF-CHECK driver, not by an anonymous script:
- `evidence/omo-align/verification/run.mjs` is byte-identical to `implementer-selfcheck/run.mjs`
  (sha256 prefix `12689b82c46aa220`, 17,548 B, i.e. the copy carrying the Lead fix).
- Its FIRST revision resolved outDir to the delivered `verification/result.json` path -> that is the overwrite in section 1, occurrence 3.
- On discovering the collision the implementer stopped, relocated its artifacts to
  `verification/implementer-selfcheck/` (run.mjs + output.log + RESULT.json) and REFUSED t17 on
  separation-of-duties grounds (the t15 implementer cannot self-verify).
- `implementer-selfcheck/RESULT.json` is CORROBORATING ONLY (its own verdict string:
  "pass (corroborating; not the authoritative t17 verdict)"). It does not replace the Lead report.

The captain-verified `result.json` (sha256 `90b76b10aaf130b92ceecac2474127f6ac64b5a26b76d459ce74fe358ae9db2`)
was deliberately NOT edited to carry this correction: mutating a verified artifact would invalidate its sha,
which is the very discipline this wave is enforcing.
