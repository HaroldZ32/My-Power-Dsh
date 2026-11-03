# R-W1B1 — verdict on "rename ulw→autoproject (no aliases) and merge boulder into the package"

Reviewer: reviewer-a (independent of the W1-B1 writer). Judged against the frozen contract
`.mpd/plans/autoproject-refactor.md` (§2 D1/D2, §4.1, §4.2, §5 W1-B, C1, C5, C7, C8, §7) and the task's
own acceptance text — never against the writer's narrative, and every claim below was re-measured.
Measurement instant: **2026-11-02T11:40Z** (19:40 Asia/Shanghai), tree `feature/autoproject-refactor`,
uncommitted, three lanes in one worktree (W1-A in flight).

## Assessment

**Risk level: LOW for the source change, MEDIUM for the wave's evidence chain.** The rename is complete
where the contract says it must be: the plugin is `mpd-autoproject`, the tool is `mpd_autoproject`, the
alias tool and the second command are DELETED (one `registerCommand`, one gesture regex — verified in
source and asserted by a new test), `.mpd/ulw` → `.mpd/autoproject`, `ulw.*` → `autoproject.*` in place
with `SETTINGS_KNOBS` still **47** (measured at runtime, not read off the constant), and the client bundle
rebuilt with 4 `autoproject` occurrences and 0 `ulw`. Boulder is a genuine merge, not a copy-paste: the
13-file vendor tree still matches its recorded `treeSha` (the machine proof of a pure move), the six
`mpd_boulder_*` tool names and descriptions are byte-identical, the `.mpd/boulder.json` ledger path and
`boulder.dir` knob are untouched, the row registers all six from the same entry, and `packages/mpd-boulder-plugin/`
is gone with no remaining import of it anywhere. The engine is provably untouched — a rename-insensitive
diff against HEAD's ulw source leaves only the alias collapse and the boulder import, `PERSONAS` and
`dsh.spawnAgent` are intact, and there is no `mpd_role_spawn`/`agentRoutes` in the package — so the
independence cut did not leak into this wave. All measured gates are green except the two the lane
declared and correctly attributed: `verify:vendor` (the captain's single re-pin) and a stale
`preset-conformance`/mount story. The real risks are therefore not in the diff: the package's shipped
entry point is still the PRE-rename bundle, so nothing that loads this tree can prove the rename until
the captain rebuilds, and several documentation carriers (including the user guide) still promise
commands that no longer exist.

## Ranked findings

### Blocker — none
### High — none

### Medium

**M1. The shipped entry point is the pre-rename plugin, and no gate in this wave's row compares dist to src.**
`packages/mpd-autoproject-plugin/dist/index.js` is byte-identical to HEAD's `mpd-ulw-plugin/dist/index.js`
(same sha256 `897766ae…`, 138518 B), so it still registers `mpd_ultrawork` / `mpd_ulw` and the two old
commands and registers **none** of the six `mpd_boulder_*` tools. Not a lane defect — §5's C9 and the
task's hard rule both forbid a lane rebuild, and the writer declares it. What makes it High rather than a
footnote is the gate arithmetic: `verify:manifest` passes because the module PATH resolves,
`preset-conformance`'s row/config checks never load the new code, and §5's W1-B row does not list
`verify:dist-fresh` (only W0's row does). So a REAL MOUNT or Docker run taken at this instant would
exercise the OLD plugin and could come back green while proving nothing about the rename — the exact
false-green this wave cannot afford. Direction: the captain rebuilds every target with the pinned
toolchain and re-runs the mount gate BEFORE the wave is called done, and §5's W1-B row should gain
`verify:dist-fresh`. For the rebuild list: only three `packages/*/dist` files still carry a retired
identifier — autoproject (the moved bytes), config (its tool description) and verify (`DELEGATION_TOOLS`) —
plus `packages/mpd-bundle-plugin/client.js`, which was rebuilt.

**M2. `VENDOR_LOCK.json` was hand-edited inside this lane's window and the edit is not disclosed in the
lane's own bounds.**
The single changed line renames the fingerprint key `packages/mpd-boulder-plugin/src/vendor` →
`packages/mpd-autoproject-plugin/src/boulder/vendor`; the `treeSha` is unchanged and `verify-vendor`
reports that asset **OK** (13 files), which is why the writer's "everything else is green, INCLUDING the
moved boulder vendor tree" is true at all. Two problems: the file is integration-owned (§5's W5 row and
T-88 put `VENDOR_LOCK.json` on the integration task), and the sanctioned path is the DERIVED re-pin —
`node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step`, which the script refuses to a
member. A hand-edit of a fingerprinted provenance file who someone else's gate reads is how a fingerprint
silently starts describing a tree nobody fingerprinted. The content is correct; the provenance of the edit
is not. Direction: the captain's single sanctioned re-pin must supersede this line (it also fixes the
skills `treeSha` and the `client.js` sha256), and the PR should state that the key was renamed by hand
rather than by the re-pin script.

**M3. The wave's REAL MOUNT and `preset-conformance` real case have no evidence — only the offline self-test —
while the completion note reads "preset-conformance green".**
I reproduced the offline arm (`--self-test` PASS: 32 harness rows conform, mpd preset 29 child rows, row
parity 27/27, 4/4 negative controls red) and it proves the row CONFIG, not a mount. `evidence/autoproject-refactor/w1b1/`
holds no mount log and no real-case log. The writer's own §3 concedes "No REAL MOUNT boot of the merged row
was run"; the board note's summary does not carry that qualifier. §5 lists both gates for W1-B, so the wave
is not yet done by its own contract. Direction: run the real case after the rebuild (isolated `DSH_HOME` +
sandboxed `HOME` + sandbox workspace) and drop the log in the wave's evidence dir; word the board note as
"self-test green, real mount pending integration".

**M4. D1's residue rule has carriers with NO owning wave — the adapter's command-name documentation.**
`packages/mpd-dsh-adapter-plugin/src/index.ts` still explains the command contract with the retired
spellings: the `COMMAND_NAME` doc block ("`/ulw` registers as `"ulw"`", "`/ulw` and `/ultrawork` as two
separate definitions", "NO leading slash (`/ulw` registers as `"ulw"`)") and the warn-once example
`{kind:'mpd-ulw',…}`. The lane's residue log correctly lists all five as out-of-lane and assigns the
package to "W0" — but W0 (T1) is a CLOSED task whose scope was the HOME guard move, and no open wave
declares this package's src. Net effect: after the whole refactor, the adapter still documents a command
surface that does not exist. Direction: give the five comment lines a home (a two-minute edit in the
integration commit is enough), or record them as an accepted residue — but "owned by W0" is not a home.
`packages/mpd-cellwork-plugin/src/prompts.ts` has the same shape and DOES have a home (W2, next wave).
The documentation band is W5's and has its own, larger debt — listed here so it lands, not as this lane's
defect: `docs/user-guide.md` still publishes `mpd_ulw` / `mpd_ultrawork` / `/ulw` / `/ultrawork` and the
"seven commands" count as if they existed (a reader following it gets a command-not-found), and
`packages/mpd-autoproject-plugin/README.md` — which TRAVELLED with this move — is still titled
`# mpd-ulw-plugin` and documents the deleted alias as if it were live.

### Nit

**N1. Three stale counts in code prose.** `skills/dsh-qa/scripts/lib/user-surface-eval.ts` documents
`CONTRIBUTED_COMMANDS` as "The seven slash commands this bundle CONTRIBUTES" (the array has six);
`user-surface-mount.ts`'s corpus arm message says "the published seven are asserted";
`docker/lib/report.ts`'s command-arm comment says "the other five need the live `commands` registry" (with
six commands, two of them TUI-only, the answer is four). §7 makes the 7→6 drop explicit, so the prose now
contradicts the contract it documents.

**N2. The boulder merge changed six user-visible error-message prefixes.** The throw sites in
`packages/mpd-autoproject-plugin/src/boulder/index.ts` now say `mpd_boulder_start:` /
`mpd_boulder_complete:` / `mpd_boulder_task_timer:` / `mpd_boulder_plan_progress:` where the old package
said `mpd-boulder:`. Names, params, returns, descriptions and the ledger are byte-identical, so this is the
only observable text change in the merge — an improvement in diagnostics, but it is a change against a
"byte-identical behaviour" clause and nothing pins it.

**N3. `bun.lock` still declares the two retired workspaces.** `@mpd-dsh/ulw` and `@mpd-dsh/boulder` remain
in the lock. I measured `bun install --frozen-lockfile`: bun prints "skipped 2 workspaces listed in
bun.lock but not on disk" and continues, so this is not the CI breaker it looks like — but the next real
`bun install` rewrites the lock, and every frozen CI run keeps printing the note. Direction: regenerate the
lock in the integration commit.

**N4. Four files were edited beyond the declared write scopes.** `packages/mpd-config-plugin/src/index.ts`
(the `mpd_config_get` description), `packages/mpd-tui-plugin/src/settings.ts` and its `plugin.test.ts` pin,
and `packages/mpd-verify-plugin/src/observe.ts` (`DELEGATION_TOOLS`). Every edit is rename-required and
correct — leaving `mpd_ultrawork` in the delegation list would be a dead entry — and none of the four was
held by a concurrent lane (they share one mtime batch). The defect is in the scope list, not the
execution: "rename everywhere" was handed a scope that excluded four files "everywhere" reaches.

**N5. Terminology residue outside every wave's matrix:** `PLAN.md` (admitted by `files`, so packed) and
`.github/ISSUE_TEMPLATE/feature_request.yml` still name ULW/ultrawork as the feature; and the frozen
contract itself still spells `.mpd/ulw/<id>/ledger.jsonl` in §4.2 while describing the TARGET state — a
one-word fix for the captain, worth doing before the next wave reads it as the spec.

## Declined to judge

- **The directive texts keeping "ULTRAWORK DISCIPLINE" / "ULTRAWORK ACTIVATION".** T3's step 2 orders them kept VERBATIM ("the next task does that") and §4.2 rewrites both texts in the engine cut. D1's five literals are absent from src. Recorded so the next wave's owner knows the user-visible head still says ULTRAWORK until then — not a defect of this wave.
- **No dist rebuilt (25 of 34 targets stale).** The task's hard rule and C9 both assign it to the captain; the lane moved the package dir as instructed, dist travelling with it. Judged as integration state (see M1 for the gate hole it exposes).
- **`verify:vendor` RED.** Declared by the lane, owned by the captain's single re-pin (§9/§11). The moved boulder vendor asset is GREEN, which is exactly the proof the move was pure.
- **The engine cut not landing** (`mpd_role_spawn` routing, `PERSONAS` deletion, weakened prompt, escalation, head-sha pin). §4.2 makes it the NEXT task; I verified only that it did not leak in early.
- **Renaming the vendored skill names `ulw-plan` / `ulw-execute` / `ulw-research`** (and their `.mpd/ulw-execute/…` state paths documented inside them). D1 names tools, commands, state and config — not vendored skill names; a product call for the skills owner, not a lane defect.
- **The frozen UI captures** (`docker/ui/out/**/report.json`, still containing "Ultrawork 轮数" / `ulw.maxRounds`). I traced every consumer: nothing asserts those labels, and the only replay fixture is `evidence/docker/client-install/…/result.json`, remapped in memory with the evidence bytes untouched. Captures are regenerated by the capture script; inert here.
- **Scratch and runtime residue** (`.qa-tmp`, `.npm-cache`, `.research`, `packages/mpd-config-plugin/.mpd/logs/`, `tests/golden/`). Gitignored scratch, runtime logs, or the lane's declared exclusion; not shipped.
- **The changes in `packages/mpd-team-core-plugin/**` and the rest of `packages/mpd-verify-plugin/**`.** W1-A's concurrent work, outside this review's subject (only `observe.ts`'s `DELEGATION_TOOLS` line is in this lane's footprint, see N4).
- **The `docs/**` and `packages/*/README*.md` rewrites themselves.** §5 gives them to W5; only the items that now advertise a DEAD command/path are carried into M4 as must-land.

## Verdict

**PASS** — every acceptance item the lane was given is met and each was re-measured here (481/481 targeted
tests, `typecheck` 0, `verify:rows` 36 ids with `mpd-autoproject` present and `mpd-boulder` gone,
`verify:manifest` PASS with 28 resolving module paths, `verify:comments` PASS, `verify:docs` PASS, the
QA self-test suite "all self-tests passed", `docker-e2e --self-test` all arms, `preset-conformance
--self-test` PASS, installer dry-run clean), the boulder merge is fingerprint-proven byte-identical, the
engine is provably untouched, and `evidence/**` historical bytes are untouched; the Mediums are an
integration gate hole, a provenance-file provenance question, and documentation carriers — none of them a
correctness defect in the delivered source.

## Evidence measured (commands and observed results)

| Check | Command | Observed |
|---|---|---|
| residue, six retired spellings, my own grep | `grep -rIn -E 'mpd-ulw\|mpd_ultrawork\|mpd_ulw\|/ulw\b\|/ultrawork\b\|\.mpd/ulw'` over src/test/scripts/docker/patch/presets/manifests | in-lane: 1 explanatory comment (`scripts/docker-e2e.ts` replay note). Out-of-lane: 5 adapter comments + 1 cellwork comment (M4); `scripts/verify-docs-parity.ts` hits are the historical doc FILENAME, not an identifier; skills/doc band = W5 |
| packaged tests | `bun test packages/mpd-autoproject-plugin packages/mpd-config-plugin packages/mpd-bundle-plugin packages/mpd-goal-plugin` | **481 pass / 0 fail**, 27 files |
| plugin unit tests | `bun test packages/mpd-tui-plugin` | 614 pass, 1 skip, 0 fail |
| types | `bun run typecheck` | exit 0 |
| rows | `bun run verify:rows` | 36 ids; `mpd-autoproject` present; no `mpd-ulw`/`mpd-boulder` |
| manifest | `bun run verify:manifest` | PASS — 28 module paths resolve, 0 missing, 1148 packed files |
| vendor | `node scripts/verify-vendor.ts` | FAIL — 3 skills files missing (the lane's own deletions), skills `treeSha`, `client.js` sha256; boulder vendor asset **OK** (13 files, fingerprint match) |
| comments | `bun run verify:comments` | PASS — 535 files |
| docs | `bun run verify:docs` | PASS — 54 pairs, 505 links, 0 dead |
| coupling inventory | `bun packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` | **PASS** — `stale===[]`, 2 entries re-frozen in place (2→2, no growth) |
| QA self-tests | `node scripts/run-qa-selftests.ts` | "all self-tests passed" |
| docker offline arms | `node scripts/docker-e2e.ts --self-test` | "all arms passed (offline)" |
| preset offline arms | `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | PASS — 32 harness rows, 29 preset child rows, parity 27/27, 4/4 controls |
| installer | `node scripts/install-profile.ts --dry-run` | completes, row `mpd-autoproject` present, no boulder row |
| settings | runtime import of `settings-schema.ts` | `SETTINGS_KNOBS` = **47**; knob path `["autoproject","maxRounds"]`; no `ulw.*`; card FIELDS mirror it; `client.js` = 4 `autoproject`, 0 `ulw` |
| boulder merge | `treeSha` check + rename-insensitive diff vs HEAD | 13 vendor files byte-identical (same fingerprint); six tool names/descriptions identical; only diff = six error-message prefixes (N2) |
| engine untouched | `diff` of HEAD ulw src vs new src with all rename tokens normalised | residual = alias collapse (one command, one gesture regex) + `applyBoulder` import; `PERSONAS` + `dsh.spawnAgent` intact; no `mpd_role_spawn`/`agentRoutes` |
| stale dist | `sha256sum` of new dist vs `git show HEAD:…mpd-ulw-plugin/dist/index.js` | **identical** `897766ae…`; 7 retired-name hits; 0 boulder tools (M1) |
| evidence | `git status --porcelain -- evidence/` (excluding untracked) | empty — historical bytes untouched |
| lockfile | `bun install --frozen-lockfile --dry-run` | "skipped 2 workspaces listed in bun.lock but not on disk: `@mpd-dsh/boulder`, `@mpd-dsh/ulw`" (N3); the run then hit a sandbox `EROFS` writing its tempdir, so CI's exact exit code was not observed |

## Bounds of this review

**Not read in full:** the 1094-line autoproject source and the 312-line boulder module were not read line by
line; instead each was diffed against its HEAD original with every rename token normalised, leaving a
60/75-line and a 16/17-line residual that I read in full — a stronger check for "rename only" than reading,
but unchanged comment interiors were not audited. `commands.test.ts` / `engine.test.ts` were run, not read.
**Not run:** the REAL `preset-conformance` mount (it would load the stale dist, prove nothing pre-rebuild,
and writes an evidence dir outside this review's scope — deliberately left to the captain post-rebuild);
the Docker lane (no daemon in this session); any real dsh session/mount; any `packages/*/dist` rebuild (C9
and reviewer discipline); the repo-wide root `bun test` (the lane's four scoped suites plus the whole QA
self-test suite were run); no git writes.
**Not verified:** the CI exit code of `bun install --frozen-lockfile` (my sandbox denied bun its tempdir);
and I have no independent observation of the writer's "3 refusal…" class of claims beyond the gates above.
