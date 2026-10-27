# user-surface gate evidence — 2026-10-27T16-33-27Z

Re-issued after the CodeRabbit **second-pass** review of PR #75 raised three findings (N1 Major,
N3 Major, N2 Minor) on the previous pair (`../2026-10-27T15-11-19Z/`, kept unrewritten as history).
The same case (`skills/dsh-qa/scripts/user-surface-mount.ts`) ran twice against the SAME installed
profile (`~/.dsh/profiles/dsh-tui`, bundle `@mpd-dsh/mpd@0.16.1`), differing only in what sits on the
loader's INSTALL ANCHOR, plus a third run of the red arm WITHOUT `--expect-red` so the exit-code
contract is measured instead of asserted.

| arm | command | exit | record |
|---|---|---|---|
| red + named cause | `node skills/dsh-qa/scripts/user-surface-mount.ts --profile ~/.dsh/profiles/dsh-tui --stale-bundle .qa-tmp/stale-0.15.5 --expect-red --evidence evidence/gates/user-surface/2026-10-27T16-33-27Z/red` | **0 = the NAMED cause reddened** (`expect-red.json` `ok:true`, `unexplained:[]`) | `red/result.json` (`ok:false`, **6 FALSE**, 33 bounds), `red/expect-red.json` |
| red, no filter | same command WITHOUT `--expect-red` (`…/red-nofilter`) | **1** — the same 6 FALSE, proving the 0 above comes from the filter and not from the run | `red-nofilter/result.json` (identical 6 FAILED names) |
| green | `node skills/dsh-qa/scripts/user-surface-mount.ts --profile ~/.dsh/profiles/dsh-tui --evidence …/green` | **0** (`ok:true`, 85 passed, 0 failed, 34 not-proven) | `green/result.json` |
| `--expect-red` on a GREEN boot | same command with `--expect-red` but NO `--stale-bundle` (`…/red-vacuous`) | **1** — prints `expect-red: the arm did NOT redden — nothing was proven, the assertions are vacuous` and `[mpd-qa] INCONCLUSIVE … reason=expect-red-not-the-named-cause`, so the CLI's non-zero branch is measured, not asserted | `red-vacuous/{result.json,expect-red.json,stdout.log}` |
| case self-test | `node skills/dsh-qa/scripts/user-surface-mount.ts --self-test` | 0 (**67 arms**, was 51) | `arms/user-surface-selftest.log` |
| lane self-test | `node scripts/docker-e2e.ts --self-test` | 0 (**238 arms**) | `arms/docker-e2e-selftest.log` |
| N3 unit demo | `node …/arms/expect-red-unit-demo.mjs` | 0 (3/3 scenarios held) | `arms/expect-red-unit-demo.log` |
| N1 mutation | guard reduced to the pre-N1 dead-fiber condition | self-test exit **1**, **5 arms FAIL** | `arms/n1-guard-disabled.log` |
| N3 mutation | classifier short-circuited to the pre-N3 rule | self-test exit **1**, **7 arms FAIL** | `arms/n3-rule-reverted.log` |
| N2 stub | `bash docker/ui/shoot-team-dag.sh` with an offline `docker` stub whose facts copy fails | **2**, `$OUT` absent (pre-fix copy: **2**, `$OUT` SURVIVES) | `gates/n2-facts-copy-failure.log` |
| typecheck | `bun run typecheck` | 0 (`tsgo --noEmit`) | `gates/typecheck.log` |
| comments | `bun run verify:comments` | 0 (`VERDICT: PASS`, 479 of 479 files, 43552 declarations) | `gates/verify-comments.log` |
| manual paths | `node scripts/verify-manual-paths.ts` | 0 (`PASS resolved=153 over-report=73 under-report=83 declared=2`) | `gates/verify-manual-paths.log` |
| shell syntax | `bash -n docker/ui/shoot-team-dag.sh` | 0 | `gates/bash-n.log` |
| vendor (expected red) | `bun run verify:vendor` | **1 — `FAIL - asset skills treeSha mismatch`**, every other asset OK (EXPECTED before the wave's single re-pin; repin NOT run) | `gates/verify-vendor.log` |

## The three new findings

| finding | fix (symbol, current line) | what now holds | arms / falsification |
|---|---|---|---|
| **N1** Major | `unappliedLabel` + the gate in `evaluateRows` — `skills/dsh-qa/scripts/lib/user-surface-eval.ts:250`, `:365-366` (`refusedSurfaceVerdict` `:284`) | the three loader facts (`disabled`, fiber `state`, `hasRuntime`) are read BEFORE either surface witness is accepted. Only `disabled=false`, `state=ACTIVE(2)`, `hasRuntime=true` may ride a sink or a registration; anything else is FALSE and `raw` quotes the refused witness (`state=`, `runtime=`, `disabled=`, `unapplied=`, `sink=`, `registrations=`). This GENERALISES F9: FAILED(3)/DISPOSED(4) is now one case of "not ACTIVE", beside pending(0/1), absent(null) and ACTIVE-without-runtime | arms `rows.pendingSinkReddens`, `rows.pendingSinkQuotesTheRefusedWitness`, `rows.disabledRegistrationReddens`, `rows.disabledRegistrationQuotesIt`, `rows.activeWithoutRuntimeReddens`, `rows.unappliedLabelOrder`; falsified in `arms/n1-guard-disabled.log` — with the gate reduced to the pre-N1 condition (dead fibers only) those **5 arms FAIL**, i.e. the two bypasses N1 names are reproduced and caught |
| **N3** Major | `classifyExpectRed` — `skills/dsh-qa/scripts/lib/user-surface-eval.ts:648`, wired at `skills/dsh-qa/scripts/user-surface-mount.ts:1140` (verdict written to `expect-red.json`) | `--expect-red` exits 0 ONLY when a NAMED cause holds: `userSurface.bundleResolution` FALSE with `source=install-anchor`, `version=<the staged stale version>` and `sameCopyDigests=false`, **or** `userSurface.profileRowListWins` FALSE with `missing=` naming `mpd-cellwork`. It ALSO refuses the verdict when any failed assertion falls outside that cause's downstream family (`userSurface.row.*`, `userSurface.command.*`, `rowsWitness`, `findings`), so a boot crash (`userSurface.probe`), a palette capture failure (`userSurface.negativeControl` / `command.*` with no box), an enumeration problem or a wrong-version/identical-copies anchor is INCONCLUSIVE → exit 1 + one sentence saying the red was not the expected one | arms `expectRed.paletteFailureIsInconclusive` (the demo: a SUCCESSFUL boot whose palette capture failed), `expectRed.paletteFailureNamesTheUnrelatedReds`, `expectRed.bootCrashIsInconclusive`, `expectRed.namedAnchorCauseHolds`, `expectRed.rowListCauseAloneHolds`, `expectRed.greenIsVacuous`, `expectRed.anchorOutOfVersionIsInconclusive`, `expectRed.identicalCopiesAreInconclusive`, `expectRed.unexpectedMissingRowIsInconclusive`, `expectRed.structuralProblemIsInconclusive`; falsified in `arms/n3-rule-reverted.log` — restoring "any red is success" makes **7 of them FAIL** |
| **N2** Minor | `docker/ui/shoot-team-dag.sh:65-70` | when the facts copy fails, `$OUT` is deleted BEFORE the script exits, and the exit code stays **2** (the contract this step always had). The success path is untouched | `gates/n2-facts-copy-failure.log`: PRE-FIX script (`git show HEAD:…`) leaves a 9-byte `out.png` behind on exit 2; the FIXED script exits 2 with `$OUT` absent; the positive control (both copies succeed) exits 0 with both files present |

## The N3 demonstration, stated as what it is

- **LIVE (not a construction):** `red/expect-red.json` is what the real v0.15.5 stale-anchor boot produced —
  `cause=stale-install-anchor:source=install-anchor,version=0.15.5,sameCopyDigests=false+profile-row-list-missing:mpd-cellwork`,
  `unexplained:[]`, exit 0; the SAME run without `--expect-red` exits **1**.
- **LIVE, the other direction:** `red-vacuous/` is a real GREEN boot run with `--expect-red` and no staged
  stale bundle — exit **1**, `expect-red.json` `ok:false green:true`, and the console carries both the
  vacuous sentence and the `INCONCLUSIVE … reason=expect-red-not-the-named-cause` marker. That measures the
  CLI's non-zero wiring on real data (the classifier's verdict → `return expectation.ok ? 0 : 1`).
- **UNIT-LEVEL (a construction, and labelled so):** the required "boot succeeded, palette capture failed"
  demonstration is `arms/expect-red-unit-demo.mjs`. It is NOT a boot: it builds three assertion sets by
  hand and feeds them to the SAME exported `classifyExpectRed` the CLI calls. Scenario A-1 (probe true,
  `bundleResolution` true, `profileRowListWins` true, `negativeControl` false, two commands with no
  palette box) returns `ok:false` with `unexplained=userSurface.negativeControl,userSurface.command.mpd,userSurface.command.ulw`
  → exit-code-as-`--expect-red` 1. Scenario A-2 (no probe record) behaves the same. Scenario B (the real
  reproduction's shape) returns `ok:true`. No booted run in this directory has a broken palette, so the
  *live* half of that clause is not measured here — the unit demo is the evidence for it.

## What the two real runs are

- **green** = the captain's machine: no `@mpd-dsh/mpd` on the global install anchor, so the loader falls
  through to the profile's copy. `bundleResolution` → `source=profile version=0.16.1 profileVersion=0.16.1
  sameCopyDigests=true`; 119 assertions, **85 passed / 0 failed / 34 not-proven**.
- **red** = the historical defect reproduced: the **v0.15.5** tag's own `cordis.patch.yml` +
  `presets/mpd.patch.yml` (both byte-identical to the tag, re-checked this pass) plus a 0.15.5-stamped
  reduced manifest, placed on a sandbox install anchor. `bundleResolution` →
  `source=install-anchor version=0.15.5 profileVersion=0.16.1 sameCopyDigests=false`; **6 FALSE**:
  `row.mpd-cellwork`, `rowsWitness`, `command.cellwork`, `command.mpd-codegraph`,
  `profileRowListWins`, `bundleResolution`. 80 passed / 33 bounds.

Witness counts (per-row): green `sink` 12 / `registration` 11 / `loader-active` 10 /
`disabled-by-design` 3 / `declared-bound` 33; red `sink` 11 / `registration` 6 / `loader-active` 15 /
`disabled-by-design` 3 / `declared-bound` 33 / `none` 1 (`mpd-cellwork`, the defect itself).

## What these runs do NOT show (stated, not glossed)

- **N1 changed no verdict in either boot, and that is the honest reading.** The green probe recorded no
  row whose sink or registration outlived a non-ACTIVE fiber (witness counts are identical to
  `../2026-10-27T15-11-19Z/`: 12/11/10/3/33), so nothing needed demoting. The repair's falsifiability
  therefore rests on the six arms and on `arms/n1-guard-disabled.log`, where removing the guard makes
  exactly the two bypasses N1 names pass again (5 arms FAIL).
- **N2's proof is an offline stub**, not a real container capture: a `docker` stub succeeds everywhere
  except the `shot-facts.json` copy. No Docker daemon, browser or UI-VIEW container was involved, and the
  real capture path is unchanged by this fix (the PNG copy and the measurement lines are untouched).
- **The stale anchor is a REPRODUCTION** (sandbox prefix + `dsh` shim + the tag's patch layers), not a real
  `npm i -g`; `red/stale-bundle-provenance.txt` states exactly which part of the defect it reproduces.
- **`--expect-red` with a palette failure was never booted** — see the unit-level note above. What IS
  measured live is the vacuous branch (`red-vacuous/`, exit 1) and the named-cause branch (`red/`, exit 0).
- The red/green pair proves MOUNT and COMMAND surfaces on the TUI plane only; a live model turn, the Web
  plane and a packed/tarball install remain outside this case (they are listed in every `result.json`
  under `doesNotProve`).

## Declared bounds (34 not-proven in green)

- **33 `declared-bound`** — the `mpd` preset's own rows (materialised per session by `dsh-agent-preset`),
  each listed by id in `userSurface.rowsDeclaredBound` AND marked per id in a TRUE
  `userSurface.bound.<id>` row. A bound is never a pass.
- **1 FINDING** — `documented-command-unreachable:mpd-codegraph`: on the fully mounted green boot the
  command reaches neither the registry nor the palette while its row is ACTIVE. Recorded non-gating under
  `NON_GATING_COMMANDS`; it GATES in the red run (incomplete composition).

## Repin needed (captain's step — NOT run here)

This wave edits three files under `skills/**`:
`skills/dsh-qa/SKILL.md`, `skills/dsh-qa/scripts/user-surface-mount.ts`,
`skills/dsh-qa/scripts/lib/user-surface-eval.ts` (`git diff --name-only`). Every `skills/**` edit
invalidates the corpus `treeSha` in `VENDOR_LOCK.json`, so `gates/verify-vendor.log` records exactly that RED
(`FAIL - asset skills treeSha mismatch`, every other asset `OK`), and it must stay red until the wave's
SINGLE re-pin lands in the same commit (AGENTS.md §9/§11).
`node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step` was **NOT** run by this lane.

## Artifacts per arm

`result.json` (verdicts + facts + bounds) · `rows.json` / `witness-table.md` (per-row witness) ·
`probe.json` + `probe.json.ticks.ndjson` (the in-process loader/registry readings over time; `probe.json.tmp`
is the probe's atomic-write staging copy) · `sinks/*.log` (the rows' own log files copied out) ·
`palette/*.pane.txt` (every command-palette capture, plus `palette-alive-before/after` around the negative
control) · `palette/tui-pane.log` (the raw ANSI stream) · `run.log` · `stdout.log` · red only:
`expect-red.json`, `stale-bundle-{provenance,sha256,package.json}`.

Shared: `arms/*.log` (the two self-tests, the N3 unit demo, the two mutation proofs and their sha256
ledger) · `gates/*.log` (the four repository gates + the N2 stub demonstration) · `case-sha256.txt`
(digests of the edited files and of the records above).
