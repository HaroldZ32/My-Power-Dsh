# Wave-3 review round 1 (t7) — Reviewer

- task: t7 (kind review, round 1) / assignee: Reviewer / attempt: 1
- verdict: **needs_revision**
- subject: t2 (registry redesign + marker prefix + update_task diagnostics), reviewed together with t3/t4 as one cumulative change set
- canon: `evidence/wave3/t1-requirements/20260911T081617Z/t1-decision-record.md` (full file read, not the clipped prompt copy) + the Architect's rulings in the t2 inbox (`inbox/senior-engineer.jsonl`, messages 0-2)
- revision measured: HEAD `98680b1`; registry `d3a1d4ad…` (12 regions); applier `scripts/patch-agent-teams-fixes.mjs` (536 lines)

## Verdict summary

The registry redesign itself is correct and decisive: I stripped **every** region from
**both** adopted files in the same state and one `--write` healed both byte-identically
(12/12 regions), with `--check` exit 0 afterwards (R7 below) — the property wave 2 failed.
The two `agent_teams_update_task` diagnostics are implemented and measured. F3 refuses
loudly and leaves the file byte-untouched.

Two canon rows are **not implemented as ruled**, and both were ruled binding by t1's
author. They are the reason for the non-pass verdict; the engine should open the repair +
next review, and t8 is rewired behind it.

## Findings

### T7-F1 — the OLD-format-registry guard is missing (canon ruling item 5)

`scripts/patch-agent-teams-fixes.mjs` has no check that every `MPD_DELTAS` entry carries
array `beforeContext`/`afterContext` and no `anchor`/`anchorOccurrence`/`anchorMarker`.
Measured (R6): with an old-format registry and one missing region, `--write` exits 1 with
the bare

```
Cannot read properties of undefined (reading 'length')
```

instead of the canon's named migration message. First use of the missing field is
`locateSeam` (`delta.afterContext.length`, applier lines 155/158); the guard belongs at
module load or at the top of `applyAgentTeamsFixes` (line 360).

Required: the canon message
`[patch-agent-teams-fixes] FAIL: lib/mpd-deltas.js is in the OLD anchor format — run: node scripts/patch-agent-teams-fixes.mjs --write-registry (one-time migration)`,
never falling back to the old line-keyed rule, plus a fixture.

### T7-F2 — the orphan table's drifted-body row is not implemented as ruled (canon item 4)

Canon row: `begin present + end absent + body NOT byte-equal` → **FAIL naming the region
and the line**, with the remedy (restore the marked region, or fix it and run
`--write-registry`). Measured:

| row (my fixture) | canon | measured | raw |
|---|---|---|---|
| R1 both markers, end<begin | `half-open marker pair` FAIL | exit 1, exactly that wording | orphan-rows.log |
| R2 begin present/end absent, body byte-equal | re-bracket in place | exit 0, byte-identical | orphan-rows.log |
| **R3 begin present/end absent, body drifted (`--write`)** | **FAIL naming region + line** | **exit 1, but the message is the `locateSeam` misdiagnosis: `delta "…" is MISSING … the lines before its afterContext window do not match the registered beforeContext — the adopted file drifted; refusing to place the region at a guessed site` — no line, wrong shape** | orphan-rows.log |
| **R3b same shape in `--check`** | **FAIL naming region + line** | exit 1, names the line as `partially stripped` but attributes it to *"a re-vendor dropped it; re-run with --write"* — the wrong remedy for an edited region | orphan-rows.log |
| **R3c same shape drifted by deletion** | **FAIL naming region + line** | exit 1, same misdiagnosis as R3 | orphan-rows.log |
| R4 end present/begin absent, body byte-equal | re-bracket in place | exit 0, byte-identical | orphan-rows.log |
| R5 end present/begin absent, body gone | drop the orphan end line + heal | exit 0, byte-identical | orphan-rows.log |
| R7 decisive strip-both | byte identity | exit 0, both files byte-identical, `--check` 0 | orphan-rows.log |

Code: `applyAgentTeamsFixes` lines 382-394 drop the orphan marker (`orphanAt`) whenever
`reBracketOrphan` (lines 200-219) returns `undefined`, i.e. the drifted-body row takes the
"body is gone too" path; the run then fails incidentally inside `locateSeam` (line 180).

**Precision against the captain's brief:** the outcome is *not* a measured silent deletion.
In every shape I could build the file stays byte-untouched and the exit is 1, and the
silent-heal hazard is unreachable for all 12 registered regions — no region's body tail
equals its `beforeContext` (`hazard-reachability.log`). The gap is that the canon row has
no first-class diagnosis (region + line + remedy) and no fixture; the safety currently
comes from an unrelated downstream assertion.

Required: branch on `found.orphan === "end"` before the drop — when the surviving body is
not byte-equal to the registered block, fail with the canon wording naming the region and
the orphan begin marker's line and the remedy; keep drop+heal only for the orphan-`begin`
"nothing survived" row. One fixture per canon row, and record the rows in the evidence
README.

## Verified and passing (raw artifacts named)

- **t2's acceptance criteria, traced**: decisive strip-both byte identity -> `evidence/wave3/t5-verify/20260911T083206Z/result.json` `decisive` (3 rounds, 12 regions, 0 diff lines, byte-identical) + my own R7; permanent byte assertions -> `self-fix-tests/registry-context-heal.test.mjs` (self-fix suite 43 pass / 0 fail, my run `gate-self-fix-suite.log`); marker fixtures -> t5 `markerFixtures` + `cases/*.log`; registry honesty -> t5 `registryDeterminism` (two `--write-registry` rounds byte-identical to the committed registry); gates -> `bun test packages/mpd-agent-teams-plugin` 106 pass / 0 fail (my `gate-plugin-suite.log`) and t5 `check5-mount.result.json` (14/14 tools, 0 apply-crash signatures, probe DONE); restart note -> t2 output, present.
- **Durability observed, not merely coded**: my own re-materialize fixture (scope-glob region stripped + the upstream `pathMatchesScope` restored) -> `--write` exits 1 naming the symbol and line 977, fixture sha256 unchanged (`f3-refusal.log`, `work/f3-pre.txt` == `work/f3-post.txt`); t5's vendor-level leg exits 1 with the same guard message and an unchanged sha, control exit 0.
- **update_task diagnostics**: my own run of `test/update-task-diagnostics.test.mjs` (6 pass) drives the real registered tool against a real team record — omitted `attempt_id` -> `attempt_id is required … agent_teams_claim_task`, never `stale attempt`/`stop work`; present-but-mismatched -> stale wording; omitted `status` -> rejected as required; contract marks `status` required and documents the minimal terminal call. The oversized-payload boundary is evidenced (t1's byte-identical provider stream + t5's installed-harness 16,241-byte assembly and max-token drop), not asserted.
- **Rule compliance**: adopted-plugin code is the documented adapter-seam exception; exactly ONE `VENDOR_LOCK` skills re-pin (t6 audit + `verify-vendor` exit 0); no CJK in the wave's agent-facing files; the changed human-facing READMEs (mpd-codegraph-plugin, mpd-mcp-astgrep, mpd-mcp-codegraph) moved in EN + zh-CN pairs; no `process.chdir` and no row-set `DSH_WORKSPACE_ROOT`.
- **Hygiene/security**: no stray or partial wave-3 evidence directories; scratch trees (`~/.qa-*`, `dist/`) gitignored; no credential copies and no unredacted secrets in wave-3 evidence (only `token=<redacted>`); the only cosmetic leftovers are two empty sandbox dirs under t4's `mcp-run/` (informational for t8).

## t6's R1/R4 — does t8's plan make the deliverable whole?

Yes. t8's contract already carries both: acceptance line 3 requires `npm run pack` to be
re-run if ANY dist changed and the packed dists to be shown byte-identical (R1), and
acceptance line 7 requires every untracked path to be either assigned to a commit or
explicitly justified (R4). Recommendation only: widen line 3's assertion from "dists" to
the packed launchers and `skills/dsh-qa/**` scripts too, since those are where this wave's
F-B8-1/devPatch fixes live and `pack-mpd.mjs` copies them wholesale.
