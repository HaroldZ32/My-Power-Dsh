# t13 — repair of the three t8 findings (adopted-tooling durability)

Repairs the findings that made t8 FAIL. Each finding below states the pre-fix behaviour, the
fix, and the raw log that proves it.

> **A `dsh` restart is still required for the new semantics to act on a live session.**
> This harness has no module hot reload: the running plugin keeps the PRE-FIX
> `repairScopeFromFindings`/matcher until the process restarts, so every claim here is proven by
> direct module import and by the guard CLI, never by a live completion gate. The isolated
> mounted boot (below) proves registration, not the new semantics.

## F1 (high) — the generated repair scope now CARVES the required path out of the inherited prohibition

Pre-fix: `repairScopeFromFindings` dropped a finding's file from `inScope` when the source
`outOfScope` covered it but KEPT the prohibition, so the finding's required edit stayed
`out_of_scope` (the t13 shape: `AGENTS.md` required by t10's finding, forbidden by t7's contract).
The function's own doc comment claimed the opposite mechanism, and the self-fix test's comment
claimed "no longer out_of_scope" above an assertion expecting `out_of_scope`.

Fix: the covering patterns are carved out of the generated `outOfScope` and the file is admitted
to `inScope`; prohibitions no finding touches are preserved; admissions are deduplicated and a
path the source already declared does not get a second entry. `contractContradiction` still
rejects an unsatisfiable contract, so the generated scope passes its own create-time gate.

Proof — `f1/real-inputs-replay.log`, real archived inputs (team `mpd-default-7332aba4`, its t7 +
t10, re-read from `.mpd/team/archive/mpd-default-7332aba4/team.json`):

| path | classified |
|---|---|
| `AGENTS.md` (finding F3 requires it; t7 forbade it) | `in_scope` |
| `packages/mpd-verif-plugin/src/venv.ts` (finding F1) | `in_scope` |
| `VENDOR_LOCK.json` (no finding requires it) | `out_of_scope` |
| `presets/mpd/agent.cordis.yml` (no finding requires it) | `out_of_scope` |

plus a falsifiable test built from the same inputs
(`DEFECT 2 fix, REAL wave-1 inputs …` in `f2/self-fix-suite.log`). The doc comment now describes
the carve-out, and the contradicting test comment/assertion pair was corrected to assert
`in_scope`.

## F2 (medium) — every behaviour-changing adopted line is inside a registered region

The verifier named three unmarked groups; all three now sit inside registered regions, and the
registry was regenerated so the guard can detect and restore them:

| region | lines | covers |
|---|---|---|
| `mpd-delta scope-glob` | 102-195 | `pathMatchesScope` + the glob helpers (the whole marked function, so a re-materialize cannot leave a stray upstream copy behind) |
| `mpd-delta scope-overlap` | 244-262 | `inScopeOverlap` rewrite |
| `mpd-delta scope-overlap-normalize` | 263-269 | `normalizeScopePattern` |
| `mpd-delta create-contract-gate` | 417-426 | the create-time contradiction gate in `validateCreateTask` |
| `mpd-delta contract-contradiction` | 276-375 | unchanged from t4 |
| `mpd-delta repair-scope` / `repair-scope-fields` | 714-732 | F1's generated scope |

`f2/region-inventory.log` lists all 9 regions with their spans and insertion anchors. The F2
sweep test (`f2/self-fix-suite.log`) diffs the working tree against the pre-delta revision with a
real LCS line diff and asserts that every ADDED line is inside a region, a marker, or prose —
zero executable lines outside a region.

Two guard-side defects found while closing F2 and fixed in the same pass:
- `writeRegistry` used to pick an anchor that could live INSIDE another region (the old
  `scope-glob` anchor was `pathMatchesScopeNormalized`, a helper declared by the neighbouring
  `scope-glob-core` region), so a dropped region took its own anchor with it and the heal did
  nothing. Anchors are now selected outside every region span.
- `--write-registry` no longer also runs a same-process verification (the freshly written registry
  is only visible to a new process, which otherwise produced a confusing mismatch).

## F3 (high) — the heal path refuses instead of emitting an unimportable module

Pre-fix: `applyAgentTeamsFixes({ write: true })` (what `vendor-agent-teams.mjs` runs)
inserted a region before its anchor without checking that the file still carried the declaration
the region replaces, so a hand re-materialize exited 0 twice and left a module with two
`export function pathMatchesScope` that failed to import.

Fix: before inserting, the applier refuses when any module-scope name the region declares is
still declared OUTSIDE every existing region (occurrences inside regions — the regions healed in
the same pass — are expected); after writing, it re-validates the whole healed file (each region
present exactly once, no region-declared name declared outside its region). The module-scope
restriction matters: an earlier draft matched a nested loop local (`const key`) and refused a
valid heal. `vendor-agent-teams.mjs` now turns that refusal into a failed run (`process.exit(1)`)
instead of a green "applied".

Proof — `f3/hand-rematerialize.log`:

| step | pre-fix | post-fix |
|---|---|---|
| `--write` on the re-materialized tree | exit 0 + broken module | **exit 1**, names `pathMatchesScope` and line 102, explains the module would fail to import |
| `--check` after | exit 0 | **exit 1** (region MISSING, verify-only) |
| resulting file | two declarations, unimportable | **byte-identical to the input**, exactly 1 declaration |

A clean re-materialize still heals: `F3: a clean (region-carrying) tree still heals successfully`
in `f2/self-fix-suite.log` restores all regions and verifies byte-identical on the next pass.

## Regression and mount evidence

| gate | result | log |
|---|---|---|
| `bun test packages/mpd-agent-teams-plugin` | 87 pass / 0 fail | `gates/plugin-suite.log` |
| `bun test packages/mpd-agent-teams-plugin/self-fix-tests` | 30 pass / 0 fail | `f2/self-fix-suite.log` |
| `bun test packages` | 340 pass / 0 fail (38 files) | `gates/full-suite.log` |
| `bun run typecheck` | exit 0 | `gates/typecheck.log` |
| guard `--check` on the live tree | 9 regions, already applied | `gates/guard-driver-rerun.log` |
| t8 mount driver re-run (isolated DSH_HOME + HOME + workspace, probe row) | **14/14 agent-teams tools, `agent_teams_task_contract=REGISTERED`, 0 apply-crash signatures**, probe reached DONE | `gates/mount-driver-rerun.raw.json` |

The mount driver's own `passed:false` is its workspace-isolation counter
(`new_team_dirs_in_real_workspace=1`): the flagged record is
`.mpd/team/mpd-default-587132ea`, created by captain session `session-8954c880-eee` (a concurrent
teammate), **not** by this boot — the boot's own leak counters are 0
(`real_workspace_session_keys_in_sandbox=0`). That workspace-isolation item belongs to t7/t9, not
to this repair.

Two verifier-driver expectations are stale against this repair (the driver hard-codes `7 regions`
and mutates `scope-glob-core`, which no longer exists after the glob regions were merged): `S1`
prints `9` and `S5` skips its mutation. The in-region drift case the driver intends is verified
directly instead: mutating one line inside the `scope-glob` region makes `--check` exit 1 naming
the exact line, while the pristine file still exits 0 — see `gates/guard-driver-rerun.log` and the
self-fix suite's region-content assertions.

## Not touched

`skills/**`, `VENDOR_LOCK.json`, `AGENTS.md`, `packages/mpd-verif-plugin/**`,
`packages/mpd-bundle/cordis.patch.yml`. `scripts/vendor-agent-teams.mjs` was executed only through
the `--write` guard path in sandboxes; the live tree's `_deps/` was never rewritten by this task.
