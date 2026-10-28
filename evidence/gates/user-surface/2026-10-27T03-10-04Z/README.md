# user-surface gate evidence — 2026-10-27T03-10-04Z

Two real-machine runs of the SAME case (`skills/dsh-qa/scripts/user-surface-mount.ts`) against the
SAME installed profile (`~/.dsh/profiles/dsh-tui`, bundle `@mpd-dsh/mpd@0.16.1`), differing only in what
sits on the loader's INSTALL ANCHOR. The red run is the point of this directory: the assertions this
wave adds go RED on the exact defect (`mpd-cellwork` never mounting) and GREEN once the anchor is clean.

| arm | command | exit | record |
|---|---|---|---|
| red | `node skills/dsh-qa/scripts/user-surface-mount.ts --profile ~/.dsh/profiles/dsh-tui --stale-bundle .qa-tmp/stale-0.15.5 --expect-red --evidence evidence/gates/user-surface/2026-10-27T03-10-04Z/red` | **0 = the arm reddened as required** (`--expect-red` inverts the verdict; the same run without it exits 1) | `red/result.json` (`ok:false`, 6 FALSE) |
| green | `node skills/dsh-qa/scripts/user-surface-mount.ts --profile ~/.dsh/profiles/dsh-tui --evidence evidence/gates/user-surface/2026-10-27T03-10-04Z/green` | **0** | `green/result.json` (`ok:true`, 52 passed, 0 failed, 34 not-proven) |
| self-test | `node skills/dsh-qa/scripts/user-surface-mount.ts --self-test` | 0 (33 arms) | `../selftest.log` |
| lane self-test | `node scripts/docker-e2e.ts --self-test` | 0 (all arms) | `../docker-e2e-selftest.log` |

## What the two runs are

- **green** = the captain's fixed machine: no `@mpd-dsh/mpd` on the global install anchor, so
  `resolveBundleDir` falls through to the profile's 0.16.1 copy.
- **red** = the historical defect reproduced: a **v0.15.5-shaped bundle** (the `v0.15.5` tag's own
  `cordis.patch.yml` — 35 rows, no `mpd-cellwork` — plus `presets/mpd.patch.yml` and a 0.15.5-stamped
  `package.json`) placed as a SIBLING of a copied `@deepseek-ai/dsh` in a sandbox npm prefix, and that
  `dsh` shim put first on `PATH`. The loader derives its anchor from the RUNNING package's own path
  (`INSTALL_ANCHOR` in dsh's `profile-boot`), so this layout resolves exactly like `npm i -g`.
  Provenance: `red/stale-bundle-provenance.txt`, `red/stale-bundle-sha256.txt`,
  `red/stale-bundle-package.json`.

  **Equivalence bound (stated, not glossed):** the reproduction does NOT run a real `npm i -g` (no
  registry in a QA sandbox), and the stale copy carries only the patch layers + manifest, not its old
  `dist` modules — irrelevant to the defect, because in the measured failure the row MODULES already
  resolved from the profile and only the row LIST came from the anchor. That is precisely what this
  layout reproduces, and `red/result.json` names it: `userSurface.bundleResolution` →
  `source=install-anchor ... version=0.15.5 profileVersion=0.16.1 sameCopyDigests=false`.

## Assertion → witness → red → green → user surface

Rows: one assertion per row the INSTALLED artifact declares (`userSurface.row.<id>`), 69 of them, plus
the aggregate. The witness class is recorded per row in `red/witness-table.md` and
`green/witness-table.md`; the counts are quoted in each `result.json` (`facts.witnessCounts`).

| assertion | witness | red | green | user surface covered |
|---|---|---|---|---|
| `userSurface.rowsEnumerated` | the artifact's own `package.json` `dsh.bundle.patch` → both layers parsed at run time | true (69 rows) | true (69 rows) | adding/deleting a row changes the assertion set by itself |
| `userSurface.row.mpd-cellwork` | loader entry for that id | **false** — "declared by the release artifact but the real boot's loader holds NO entry" | true (`sink`: its own `<ws>/.mpd/logs/mpd-cellwork.log`) | the 0.16.1 defect itself: a released row that never mounted |
| `userSurface.row.*` (68 others) | per row: `sink` 12 / `registration` 11 / `loader-active` 10 / `disabled-by-design` 3 / `declared-bound` 33 (green counts) | 33 bounds, 0 additional failures | same | every declared row is either proven or explicitly bounded (see the bound section) |
| `userSurface.rowsWitness` | the per-row verdicts | **false** — "1 declared row(s) are not effective: mpd-cellwork" | true — no defective row | the A-class false green (a lane that never looked at rows) |
| `userSurface.rowsDeclaredBound` | the ids graded `null` | true (33 listed) | true (33 listed) | the honest bound, per row, by id |
| `userSurface.commandCorpus` | `CONTRIBUTED_COMMANDS` vs `docs/user-guide.md` §12 | true (7/7) | true (7/7) | a case that silently asserted six commands would redden here |
| `userSurface.command.ulw` | live `commands` registry (agent view) **and** a palette capture | true | true | `/ulw` |
| `userSurface.command.ultrawork` | same | true | true | `/ultrawork` |
| `userSurface.command.cellwork` | same | **false** — neither the registry nor the palette carries it | true (registry + palette) | `/cellwork`, the user-visible consequence of the defect |
| `userSurface.command.agent-teams` | same | true | true | `/agent-teams` |
| `userSurface.command.mpd` | palette (documented TUI-only) | true | true | `/mpd` |
| `userSurface.command.mpd-model` | palette (documented TUI-only) | true | true | `/mpd-model` |
| `userSurface.command.mpd-codegraph` | registry + palette | **false** (gating: rows failed in this run) | **null FINDING** `documented-command-unreachable:mpd-codegraph` | `/mpd-codegraph` — see "Finding" below |
| `userSurface.negativeControl` | a fabricated name must match nothing while the palette is alive either side | true | true | proves the palette witness discriminates (a real 0.17.0 host CLOSES the box on zero matches) |
| `userSurface.profileRowListWins` | artifact rows vs the boot's loader entries (non-preset rows) | **false** — "the boot did not compose 1 profile row(s): mpd-cellwork" | true | the upgrade path: the PROFILE's row list is the one that ran |
| `userSurface.bundleResolution` | replay of `resolveBundleDir` (labelled a replay, never cited as the boot) + layer digests | **false** — `source=install-anchor version=0.15.5 ... sameCopyDigests=false` | true — `source=profile version=0.16.1 sameCopyDigests=true` | B's mechanism, named |
| `userSurface.isolation` | `assertSessionsSandboxed` over the sandbox `DSH_HOME` | true | true | the run never keys a session to this checkout |
| `userSurface.probe` | the instrumentation row's own record | true (154 entries) | true (155 entries) | the in-process loader/registry readings exist at all |

## The declared bounds (34 rows, listed by id)

- **33 `declared-bound`** — the `mpd` preset's own rows. `dsh-agent-preset` materialises preset rows
  PER SESSION, so the root loader holds their ids as data: some appear `disabled: true` (the preset's
  `plugin_manager`/`plugin_market` pair), some never appear as their own entry at all. On this plane
  their ids cannot be individually proven, so the case records `null` + the reason and lists them in
  `userSurface.rowsDeclaredBound`. **This is a bound, not a pass** — the case proves the preset itself
  mounted (`preset-mpd` ACTIVE, `agentPreset=mpd`, 117 tools offered to the model, 33 commands) and
  proves every OTHER row individually.
- **1 FINDING** — see below.

## Finding (out of this wave's write scope, recorded rather than waived)

`documented-command-unreachable:mpd-codegraph`. On a FULLY mounted 0.16.1 boot (`green`), `/mpd-codegraph`
answers on NEITHER surface: the harness's per-agent command registry does not list it and the command
palette draws no row for it — while its own row is ACTIVE and its log sink shows the codegraph init
running. `docs/user-guide.md` §12 publishes it as a command on "Web + TUI". The case records this as a
NON-GATING finding (`ok:null`, id in `userSurface.findings`) because repairing it needs a product-source
change (the row is a HOST-layer row registering through the adapter, and the registration never reaches
the session's command view); in the RED run the same command is a gating FALSE, because there the row
list itself was wrong. Nothing here is silent: the finding is printed in the run summary, named in the
record, and mirrored in `scripts/docker-e2e.ts` + `docker/lib/report.ts` comments.

## Artifacts per arm

`result.json` (verdicts + facts + bounds) · `rows.json` / `witness-table.md` (per-row witness) ·
`probe.json` + `probe.json.ticks.ndjson` (the in-process loader/registry readings over time, so "never
composed" and "applied late" are distinguishable) · `sinks/*.log` (the row's own log files copied out) ·
`palette/*.pane.txt` (every command-palette capture, plus `palette-alive-before/after` around the
negative control) · `palette/tui-pane.log.gz` + `.sha256` (the full raw ANSI stream the terminal received,
gzipped with the UNCOMPRESSED digest recorded beside it, the same shape `evidence/cellwork/diag-mount`
uses) · `run.log` (the run's own narration) · `stdout.log` (the arm's console output, verbatim).
