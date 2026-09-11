# Wave-3 review round 2 (t10) — Reviewer

- task: t10 (kind review, round 2) / assignee: Reviewer / attempt: 1
- **verdict: pass**
- reviewed task: t9 (repair round 2) fixing T7-F1 / T7-F2 from `REVIEW.md` (round 1, same directory)
- revised revision: applier `scripts/patch-agent-teams-fixes.mjs` (582 lines), registry `mpd-deltas.js` (12 context-pair entries, 0 anchor keys), `lib/tools.js` (attempt-id recovery phrase), two test files
- evidence: this directory (`orphan-rows-round2.log`, `f3-refusal-round2.log`, `gate-*-round2*.log`, `work/mount-round2/`)

## T7-F1 — OLD-format-registry guard: CLOSED

`assertRegistryFormat(entries = MPD_DELTAS)` is the first statement of `applyAgentTeamsFixes`
(applier:378-385, called at :393) and refuses when any entry carries
`anchor`/`anchorOccurrence`/`anchorMarker` **or** lacks a non-empty
`beforeContext`/`afterContext` pair. Verified by my own harness against the real applier:

- R6 (old registry + one missing region, `--write`): exit 1 with exactly
  `[patch-agent-teams-fixes] FAIL: lib/mpd-deltas.js is in the OLD anchor format — run: node scripts/patch-agent-teams-fixes.mjs --write-registry (one-time migration)` — **no bare TypeError**.
- R8 (migration stays usable, the placement justification): old registry + `--write-registry`
  → exit 0 with 12 regenerated context-pair entries and no old keys; the following `--check`
  exits 0 and both adopted files are still byte-identical to canonical.
- t9's `check4j` agrees: `check_exit 1, write_exit 1, migrate_exit 0, post_check_exit 0,
  names_migration true, bare_typeerror_present false, adopted_files_untouched true,
  migrated_entries_with_pair 12, residual_old_keys 0`.

## T7-F2 — drifted-body orphan row: CLOSED

The applier now branches on `findRegion`'s orphan **before** the drop (applier:415-439):
`reBracketOrphan` is taken only for a byte-equal body; `found.orphan === "end"` (begin
survived, end gone) with a drifted body throws `driftedOrphanError` (:362-366) in BOTH
`--check` (:418-420) and `--write` (:436-438), naming the region AND the begin marker's
line with the remedy. Drop+heal is reachable only for `orphan === "begin"` with nothing
survived. My matrix (repaired applier, real registry):

| row | canon | measured round 2 |
|---|---|---|
| R1 inverted pair | `half-open` only here | exit 1, exactly that wording |
| R2 begin present/end absent, byte-equal | re-bracket | exit 0, byte-identical |
| **R3 drifted (`--write`)** | FAIL region + line + remedy | exit 1: `delta "…" in <file>: the begin marker at line 1431 has no end marker and the surviving lines are NOT the registered block — … restore the marked region, or fix it and run: … --write-registry` |
| **R3b drifted (`--check`)** | same | exit 1, same diagnosis (no `--write` advice) |
| **R3c drifted by deletion** | same | exit 1, byte-untouched |
| R4 end present/begin absent, byte-equal | re-bracket | exit 0, byte-identical |
| R5 nothing survived | drop orphan end + heal | exit 0, byte-identical |
| R7 decisive strip-both | byte identity | exit 0, both files byte-identical, `--check` 0 |
| R8 migration | usable | exit 0, 12 pairs, `--check` 0 |

**My whole matrix is 10/10 passing** (`orphan-rows-round2.log`, `orphan-rows.result.json`).
t9's `check4k` extends it to all 12 regions: R3 refused 12/12 naming region+line+remedy with
the file byte-untouched, R5 heals byte-identically 12/12, and the silent-relocation
precondition is empty. All five canon rows have fixtures (`t9 R1`–`t9 R5`) and the rows table
is recorded in the evidence README.

## Regression and rule checks (round 2)

- F3 durability still OBSERVED: my re-materialize fixture → exit 1 naming delta,
  `pathMatchesScope` and line 977 with the fixture sha unchanged (`f3-refusal-round2.log`,
  `work/f3-pre-r2.txt` == `work/f3-post-r2.txt`).
- `bun test packages`: **376 pass / 0 fail** (82 files; +10 tests). Plugin suite **116/0**,
  self-fix suite **53/0** (all five row fixtures + 4-way shared-seam matrix + two
  replacement-shape refusals), `update-task-diagnostics` **6/0** (the recovery phrase now
  reads `… then repeat this update with attempt_id="<value>"`, the canon's shape).
- `bun run typecheck` exit 0; `node scripts/patch-agent-teams-fixes.mjs --check` exit 0
  (12 regions).
- Mounted boot on the repaired tree (check5-mount re-run by me, sandbox DSH_HOME/HOME/ws):
  **0 apply-crash signatures**, probe DONE, **14/14 agent-teams tools** incl.
  `agent_teams_task_contract`; isolation assertions 0 leaks; no `--dump-config` cited.
- Vendor/re-pin: my audit re-run 6/6 — the repair touched **no** `skills/**` file, so the
  wave still carries exactly ONE re-pin (treeSha `3259d07a…` recomputed with verify-vendor's
  own algorithm, `VENDOR_LOCK` diff touches only the skills entry).
- Repair footprint (mtime scan): exactly the five in-scope files — applier, registry,
  `lib/tools.js`, and the two test files. Nothing outside t9's declared scope; no stray or
  partial evidence directories; no secrets.

## Informational for t8 (not findings)

- `check5-mount.sh` resolves its probe as `$EV/drivers/agent-teams-mount-probe.mjs`, so
  re-running it with `EV_OUT` pointed at a bare directory fails loudly (ERR_MODULE_NOT_FOUND,
  2 signature hits) — stage a `drivers/` copy or run it in place. My first re-run hit this;
  the corrected run above is the evidence.
- Round-1 non-blocking items stand for t8: re-pack `dist/mpd-package` (R1), stage the
  untracked layer (R4), widen R1's packed-artifact assertion to the launchers and
  `skills/dsh-qa` scripts, and the two cosmetic empty dirs under t4's `mcp-run/`.
