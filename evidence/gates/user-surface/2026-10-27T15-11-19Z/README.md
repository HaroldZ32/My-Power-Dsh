# user-surface gate evidence — 2026-10-27T15-11-19Z

Two real-machine runs of the SAME case (`skills/dsh-qa/scripts/user-surface-mount.ts`) against the SAME
installed profile (`~/.dsh/profiles/dsh-tui`, bundle `@mpd-dsh/mpd@0.16.1`), differing only in what sits
on the loader's INSTALL ANCHOR. This pair is RE-ISSUED after the CodeRabbit review of PR #75 changed the
case's SCORING SEMANTICS (F9, F11 — plus the F10 anchor guard and the F12 evidence-path alignment): the
old pair (`../2026-10-27T03-10-04Z/`) was produced by the pre-repair scoring and is kept, unrewritten, as
history.

| arm | command | exit | record |
|---|---|---|---|
| red | `node skills/dsh-qa/scripts/user-surface-mount.ts --profile ~/.dsh/profiles/dsh-tui --stale-bundle .qa-tmp/stale-0.15.5 --expect-red --evidence evidence/gates/user-surface/2026-10-27T15-11-19Z/red` | **0 = the arm reddened as required** (`--expect-red` inverts the verdict; the same run without it exits 1) | `red/result.json` (`ok:false`, **6 FALSE**, 33 bounds) |
| green | `node skills/dsh-qa/scripts/user-surface-mount.ts --profile ~/.dsh/profiles/dsh-tui --evidence evidence/gates/user-surface/2026-10-27T15-11-19Z/green` | **0** | `green/result.json` (`ok:true`, 85 passed, 0 failed, 34 not-proven) |
| case self-test | `node skills/dsh-qa/scripts/user-surface-mount.ts --self-test` | 0 (**51 arms**, was 38) | `arms/user-surface-selftest.log` |
| lane self-test | `node scripts/docker-e2e.ts --self-test` | 0 (**238 arms**) | `arms/docker-e2e-selftest.log` |
| F10 refusal (live) | `PATH=<tmp bin with dsh-tui+tmux, no dsh> node skills/dsh-qa/scripts/user-surface-mount.ts --profile ~/.dsh/profiles/dsh-tui --stale-bundle .qa-tmp/stale-0.15.5 --evidence …/refusal-f10-no-dsh` | **2** — one readable sentence, `refused.json` names an empty anchor, no `"."` copy, sandbox removed | `refusal-f10-no-dsh/{stdout.log,refused.json,run.log}` |
| typecheck | `bun run typecheck` | 0 | `gates/typecheck.log` |
| comments | `bun run verify:comments` | 0 (`VERDICT: PASS — … 43506 declaration(s)`) | `gates/verify-comments.log` |
| manual paths | `node scripts/verify-manual-paths.ts` | 0 (`PASS resolved=153 …`) | `gates/verify-manual-paths.log` |
| vendor | `bun run verify:vendor` | **1 — `FAIL - asset skills treeSha mismatch`** (EXPECTED before the wave's single re-pin; see "Repin needed") | `gates/verify-vendor.log` |

## What the two runs are

- **green** = the captain's fixed machine: no `@mpd-dsh/mpd` on the global install anchor, so
  `resolveBundleDir` falls through to the profile's 0.16.1 copy. `bundleResolution` →
  `source=profile version=0.16.1 profileVersion=0.16.1 sameCopyDigests=true`.
- **red** = the historical defect reproduced: the **v0.15.5** bundle (the tag's own `cordis.patch.yml` —
  no `mpd-cellwork` — plus `presets/mpd.patch.yml` and a 0.15.5-stamped manifest) placed as a SIBLING of
  a copied `@deepseek-ai/dsh` in a sandbox npm prefix, with that `dsh` shim first on `PATH`. The loader
  derives its anchor from the RUNNING package's own path (`INSTALL_ANCHOR` in dsh's `profile-boot`), so
  this layout resolves exactly like `npm i -g`. Provenance: `red/stale-bundle-provenance.txt`,
  `red/stale-bundle-sha256.txt`, `red/stale-bundle-package.json` — the two layers were re-verified
  BYTE-IDENTICAL to `git show v0.15.5:<path>` at run time.

  **Equivalence bound (stated, not glossed):** the reproduction does NOT run a real `npm i -g` (no
  registry in a QA sandbox), and the stale copy carries only the patch layers + a reduced manifest, not
  its old `dist` modules — irrelevant to the defect, because in the measured failure the row MODULES
  already resolved from the profile and only the row LIST came from the anchor. `red/result.json` names
  it: `userSurface.bundleResolution` → `source=install-anchor … version=0.15.5 profileVersion=0.16.1
  sameCopyDigests=false`.

## The four CodeRabbit findings this pair re-proves

| finding | file:line (after the repair) | what changed | how THIS directory proves it |
|---|---|---|---|
| **F9** Major | `skills/dsh-qa/scripts/lib/user-surface-eval.ts:295` (`evaluateRows` — the dead-fiber guard) | a row whose fiber is FAILED (3) or DISPOSED (4) is FALSE **before** any `sink` / `registration` witness is read; both refused witnesses are quoted in `raw` | arms `rows.deadFibreSinkReddens` (**the required reverse control**: state 3 + a non-empty sink ⇒ `ok:false`), `rows.deadFibreRegistrationReddens` (state 4 + a live registration ⇒ `ok:false`), `rows.deadFibreQuotesEveryWitnessItRefused`; falsified in `arms/f9-guard-disabled.log` (guard off ⇒ 3 FAILs, the reverse control reporting `ok=true witness=sink` — the exact old false pass) |
| **F11** Minor | `skills/dsh-qa/scripts/lib/user-surface-eval.ts:71` (`NON_GATING_COMMANDS`) + `:86` (`commandGates`), wired at `skills/dsh-qa/scripts/user-surface-mount.ts:916` | `mpd-codegraph` is the ONLY explicit non-gating exception; every other command failure gates on a complete composition, and the exception itself gates on an incomplete one | **green**: `command.mpd-codegraph` = `ok:null` + `gating:false` + `finding:documented-command-unreachable:mpd-codegraph`, `userSurface.findings` TRUE listing it, every other command `gating:true` and TRUE. **red**: the SAME command is `ok:false gating:true` (whitelist does not excuse a broken composition) — and `command.cellwork` is `ok:false gating:true`. Arms `command.failureGates`, `command.everyOtherCommandGates`, `command.unknownNameGates`, `command.nonGatingIsExactlyCodegraph`, `command.whitelistDoesNotExcuseABrokenComposition`; falsified in `arms/f11-old-rule.log` (3 FAILs under the pre-F11 rule) |
| **F10** Minor | `skills/dsh-qa/scripts/user-surface-mount.ts:584` (`staleAnchorRefusal`) + `:735` (the exit-2 refusal in `runReal`) | an unresolved `dsh` / empty install anchor is REFUSED with exit 2 and one readable sentence; `dirname("") === "."` is never handed to `cpSync` | arms `staleAnchor.hazardIsReal`, `staleAnchor.refusesUnresolvedDsh`, `staleAnchor.refusesEmptyAnchor`, `staleAnchor.acceptsResolvedAnchor`; falsified in `arms/f10-guard-disabled.log` (2 FAILs with the guard off). **Exercised LIVE too**: `refusal-f10-no-dsh/` is the same case run with a PATH that carries `dsh-tui` and `tmux` but no `dsh` — exit **2**, one readable sentence on stderr, `refused.json` with `pathDsh:"", pathAnchor:"", harnessSource:""` (never `"."`), and the sandbox removed |
| **F12** Minor | `skills/dsh-qa/scripts/user-surface-mount.ts:90` (`DEFAULT_EVIDENCE_ROOT`) + `skills/dsh-qa/SKILL.md:104` | the DEFAULT evidence root moved from `evidence/dsh-qa/user-surface` to `evidence/gates/user-surface` — the path the doc (and this directory) already named — and the doc now states all three real shapes: the default `<stamp>/`, a paired `--evidence …/<stamp>/red|green`, and the Docker lane's `$OUT_DIR/user-surface` | this directory IS the paired shape the doc now describes; the green run's `result.json` was written under the (new) default root's sibling by the same code path |

## Assertion → witness → red → green → user surface

Rows: one assertion per row the INSTALLED artifact declares (`userSurface.row.<id>`), 69 of them, plus one
TRUE `userSurface.bound.<id>` marker per declared bound, plus the aggregates — 119 assertions per run. The
witness class is recorded per row in `red/witness-table.md` and `green/witness-table.md`; the counts are
quoted in each `result.json` (`facts.witnessCounts`).

| assertion | witness | red | green | user surface covered |
|---|---|---|---|---|
| `userSurface.rowsEnumerated` | the artifact's own `package.json` `dsh.bundle.patch` → both layers parsed at run time | true (69 rows) | true (69 rows) | adding/deleting a row changes the assertion set by itself |
| `userSurface.row.mpd-cellwork` | loader entry for that id | **false** — "declared by the release artifact but the real boot's loader holds NO entry" | true (`sink`: its own `<ws>/.mpd/logs/mpd-cellwork.log`) | the 0.16.1 defect itself: a released row that never mounted |
| `userSurface.row.*` (68 others) | per row: `sink` 12 / `registration` 11 / `loader-active` 10 / `disabled-by-design` 3 / `declared-bound` 33 (green counts) | 33 bounds, 0 additional failures (`sink` 11 / `registration` 6 / `loader-active` 15) | same | every declared row is either proven or explicitly bounded (see the bound section) |
| `userSurface.rowsWitness` | the per-row verdicts | **false** — "1 declared row(s) are not effective: mpd-cellwork" | true — no defective row | the A-class false green (a lane that never looked at rows) |
| `userSurface.rowsDeclaredBound` | the ids graded `null` | true (33 listed) | true (33 listed) | the honest bound, per row, by id |
| `userSurface.commandCorpus` | `CONTRIBUTED_COMMANDS` vs `docs/user-guide.md` §12 | true (7/7) | true (7/7) | a case that silently asserted six commands would redden here |
| `userSurface.command.ulw` / `.ultrawork` / `.agent-teams` | live `commands` registry (agent view) **and** a palette capture | true | true | `/ulw`, `/ultrawork`, `/agent-teams` |
| `userSurface.command.cellwork` | same | **false, GATING** — neither the registry nor the palette carries it | true (registry + palette, `paletteCount=1`) | `/cellwork`, the user-visible consequence of the defect |
| `userSurface.command.mpd` / `.mpd-model` | palette (documented TUI-only) | true | true | `/mpd`, `/mpd-model` |
| `userSurface.command.mpd-codegraph` | registry + palette | **false, GATING** (composition incomplete: the whitelist does not excuse a red composition) | **null FINDING** `documented-command-unreachable:mpd-codegraph`, `gating:false` | `/mpd-codegraph` — see "Finding" below |
| `userSurface.findings` | the findings list, asserted as recorded | true — `-` (none: both failures gated) | true — 1 finding, named | a run that silently dropped a finding reddens |
| `userSurface.negativeControl` | a fabricated name must match nothing while the palette is alive either side | true (`aliveBefore=94 aliveAfter=94`) | true (`aliveBefore=95 aliveAfter=95`) | proves the palette witness discriminates (a real 0.17.0 host CLOSES the box on zero matches) |
| `userSurface.profileRowListWins` | artifact rows vs the boot's loader entries (non-preset rows) | **false** — missing `mpd-cellwork` (`bootEntries=154`) | true (`profileRows=36 bootEntries=155 missing=-`) | the upgrade path: the PROFILE's row list is the composed one |
| `userSurface.bundleResolution` | a REPLAY of `resolveBundleDir`'s precedence + layer digests | **false** — `source=install-anchor version=0.15.5 profileVersion=0.16.1 sameCopyDigests=false` | true — `source=profile version=0.16.1 … sameCopyDigests=true` | the 0.16.1 hybrid: row list from the anchor, modules from the profile |
| `userSurface.isolation` | `assertSessionsSandboxed` over the sandbox store | true | true | the run never wrote this checkout's `.mpd/`/sessions |
| `userSurface.probe` | the instrumentation row's own record | true (`loaderEntries=154 commands=33 tools=117`) | true (`loaderEntries=155 commands=33 tools=117`) | the live loader/registry read exists at all |

## What these runs do NOT show (stated, not glossed)

- **F9 changed no verdict in this boot, and that is the honest reading:** the green probe recorded zero
  rows in state 3/4 (`dead-state rows: []` over all 69 verdicts), so no row needed demoting. The repair's
  falsifiability therefore rests on the three offline arms and on `arms/f9-guard-disabled.log`, where the
  guard removed makes the reverse control report `ok=true witness=sink` — i.e. the old false pass is
  reproduced and the arm catches it.
- **F10's exit-2 refusal IS exercised live** (`refusal-f10-no-dsh/`: a PATH with `dsh-tui` + `tmux` but no
  `dsh`), and the four `staleAnchor.*` arms carry the falsifiability (`arms/f10-guard-disabled.log`). The
  residual bound: the refusal is reached AFTER the sandbox profile copy (the case resolves its subject
  before it resolves `dsh`), so a refused run still pays one copy — the sandbox is then removed and
  `refused.json` records the empty anchor. No live run here has a `dsh` whose anchor resolves to `"."`;
  that shape is refused by `staleAnchor.refusesEmptyAnchor` / `staleAnchor.refusesUnresolvedDsh`.
- The red arm is a REPRODUCTION (sandbox prefix + shim), not a real `npm i -g`; the bound above states
  exactly which part of the defect it reproduces.

## Declared bounds (34 not-proven rows in green)

- **33 `declared-bound`** — the `mpd` preset's own rows. `dsh-agent-preset` materialises preset rows
  PER SESSION, so the root loader holds their ids as data: some appear `disabled: true` (the preset's
  `plugin_manager`/`plugin_market` pair), some never appear as their own entry at all. On this plane
  their ids cannot be individually proven, so the case records `null` + the reason, lists them in
  `userSurface.rowsDeclaredBound`, and emits one TRUE `userSurface.bound.<id>` marker each (which is what
  lets `scripts/docker-e2e.ts` tell a bound from a step that never ran). **This is a bound, not a pass.**
- **1 FINDING** — see below.

## Finding (out of this wave's write scope, recorded rather than waived)

`documented-command-unreachable:mpd-codegraph`. On a FULLY mounted 0.16.1 boot (`green`), `/mpd-codegraph`
answers on NEITHER surface: the harness's per-agent command registry does not list it and the command
palette draws no row for it — while its own row is ACTIVE and its log sink shows the codegraph init
running. `docs/user-guide.md` §12 publishes it as a command on "Web + TUI". Under the F11 rule it is the
ONE explicit non-gating exception (`NON_GATING_COMMANDS`), recorded as `ok:null` + `gating:false` +
`finding:…` because repairing it needs a product-source change; in the RED run the same command is a
gating FALSE, because there the row list itself was wrong.

## Repin needed (captain's step — NOT run here)

`bun run verify:vendor` FAILS with `asset skills treeSha mismatch` because this wave edits three files
under `skills/**` (`skills/dsh-qa/SKILL.md`, `skills/dsh-qa/scripts/user-surface-mount.ts`,
`skills/dsh-qa/scripts/lib/user-surface-eval.ts` — `git diff --name-only`). Every `skills/**` edit
invalidates the corpus `treeSha` and the re-pin must land in the SAME commit as the change (AGENTS.md
§9/§11). **`node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step` is NOT run by this
lane**; the vendor gate is expected RED until the captain runs it once for the wave.

## Artifacts per arm

`result.json` (verdicts + facts + bounds) · `rows.json` / `witness-table.md` (per-row witness) ·
`probe.json` + `probe.json.ticks.ndjson` (the in-process loader/registry readings over time, so "never
composed" and "applied late" are distinguishable; `probe.json.tmp` is the probe's atomic-write staging
copy and is BYTE-IDENTICAL to `probe.json` — measured with `cmp`) · `sinks/*.log` (the row's own log files
copied out) · `palette/*.pane.txt` (every command-palette capture, plus `palette-alive-before/after`
around the negative control) · `palette/tui-pane.log` (the full raw ANSI stream the terminal received —
`lib/tui-lane.ts` writes it UNCOMPRESSED as of this run, which is why no `.gz`/`.sha256` pair sits beside
it here; the earlier `../2026-10-27T03-10-04Z/` pair carries the older gzipped form) · `run.log` (the run's
own narration) · `stdout.log` (the arm's console output, verbatim) · red only:
`stale-bundle-{provenance,sha256,package.json}`.

Shared: `arms/*.log` (the two self-tests and the three mutation proofs that show each new arm REDDENS
when its guard is removed) · `refusal-f10-no-dsh/` (the live exit-2 refusal: `stdout.log`, `refused.json`,
`run.log`) · `gates/*.log` (the four repository gates quoted in the table above).
