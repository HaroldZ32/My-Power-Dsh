# user-surface gate — the exit-3 wiring defect (declared bounds)

Stamp: 2026-10-27T06-52-49Z (UTC). Scope: the wiring between the user-surface case
(`skills/dsh-qa/scripts/user-surface-mount.ts`) and the docker driver's required-arm gate
(`scripts/docker-e2e.ts`), plus the reporter comment that documents the contract
(`docker/lib/report.ts`) and the case description in `skills/dsh-qa/SKILL.md`. No `packages/**`
product source was touched, no judgement rule of the case was changed, and nothing was committed.

## What was wrong

The first real container run of step 14b (`evidence/docker/client-install/2026-10-27T03-58-45Z/`)
passed every arm it could measure — userSurface 52 true / **0 false** / 33 null — and the driver
still exited **3**: `requiredPrefixesFor` requires `userSurface.` in every mode, and the 33
`userSurface.row.<preset-child>` rows are `ok:null` BY DESIGN (the case grades them
`declared-bound`: materialised per session by the `mpd` preset, not individually provable from the
root loader). A null under a required prefix means "the step never ran", so 33 honest bounds were
reported as 33 missing prerequisites.

## The fix — a marker the driver can READ, not a reason string it must PARSE

The case now writes, beside each bound row, one companion assertion:

```
userSurface.row.<id>    ok: null   <- unchanged: a bound is never a pass
userSurface.bound.<id>  ok: true   <- the declaration, per id
```

`unmeasuredRequired` (the ONE place the required-arm rule lives) excuses a null row ONLY when
(a) its name is `userSurface.row.<id>` AND (b) a `userSurface.bound.<id>` row exists for the SAME
id with `ok === true`. Nothing else changed: `userSurface.` is still required in every mode, and a
`userSurface.row.<id>` that is neither TRUE nor declared bound is still exit 3.

## The fixture (input path + hash)

| | |
|---|---|
| path | `evidence/docker/client-install/2026-10-27T03-58-45Z/result.json` |
| sha256 | `9f957c83ed2eadce25dd818b25606821b10aa7a227106dc187f89ee39e443de5` |
| bytes | 147569 |
| assertions | 207 — 128 true / **1 false** (`pack.staticCoherence`) / 78 null |
| userSurface rows | 85 — 52 true / **0 false** / 33 null (all `userSurface.row.*`) |
| container driver | `driver.json`: `exitCode: 3`, `unmeasured` = those 33 names, `requiredPrefixes: ["userSurface."]`, `excludedRequired: ["ui.teamBoard"]`, `liveRequested: false`, `browserEnabled: false` |

`fixture-probe.json` records the hash, the counts, the 33 ids, and the fact that the frozen report's
own TRUE `userSurface.rowsDeclaredBound` audit row lists **exactly** those 33 ids (set equality) —
that audit row, not a hardcoded list, is what the fixture replay uses to emit the markers.

## Before / after — the two verdicts on the SAME report

Both are replayed OFFLINE through the container's own reporter (`docker/lib/report.ts`) and read by
the same `unmeasuredRequired` / `requiredArmExit` the driver runs:

| replay | rows | driver exit | required-arm gaps | false rows |
|---|---|---|---|---|
| **before** — the report exactly as recorded (no marker) | 207 | **3** | **33** | `pack.staticCoherence` |
| **after** — same report + the 33 markers the fixed case emits | 240 | **1** | **0** | `pack.staticCoherence` |
| after, with that freshness drift set aside | 240 | **0** | 0 | — |
| falsifier: one bound row turned **FALSE** (marker kept) | 240 | **1** | 0 | `userSurface.row.mpd-better-sidebar` |
| falsifier: ONE marker dropped | 239 | **3** | 1 (`userSurface.row.mpd-better-sidebar`) | — |
| falsifier: one NON-bound canonical row deleted | 240 | **3** | 1 (`userSurface.command.ulw`) | — |

So the exit code the defect produced (3) is gone, and what remains is the run's REAL red: the single
false `pack.staticCoherence` (stale `dist/mpd-package` — the captain's integration step) gives exit 1.
The two exit-3 rows are the report's own honest "this was not measured" answers, re-derived offline.

## Nothing was softened — each invariant and the arm behind it

| invariant | arm (all in `selftest-docker-e2e.log` unless noted) |
|---|---|
| `userSurface.` is required in EVERY mode, never excluded | `the userSurface prefix is required with NO flag at all` / `... in every mode` / `... never in the exclusion list` |
| an UNMARKED null is still exit 3 | `an UNMARKED null is still a missing prerequisite`, `an unmarked null is exit 3 in the shared exit composition`, `BEFORE the fix the frozen report is exit 3 with 33 unmeasured rows` |
| a FALSE row is never excused | `a FALSE user-surface row is never excused by its marker`, `a bound row turned FALSE reddens the run (exit 1, never 0 and never 3)` |
| a marker that is null/false declares nothing | `a marker that is itself null declares nothing AND is an unmeasured arm`, `a marker that is FALSE declares nothing` |
| a marker never travels to another id or another prefix | `a marker never excuses a DIFFERENT id`, `a marker never excuses a non-row prefix` |
| the marker is per id, and load-bearing | `dropping ONE marker puts exactly that row back into exit 3` |
| deleting a recorded row is caught | `deleting a non-bound row reddens the run with exit 3` |
| the reporter carries the markers and drops nothing | `the reporter carries every marker through and the one false is still the real freshness row` (240 rows, 33 markers) |
| the case emits the marker only for a real bound | `bound.markerEmitted`, `bound.markerIsTrue`, `bound.markerKeepsTheRowNull`, `bound.noMarkerOnWitnessed`, `bound.noMarkerOnFailed` (in `selftest-user-surface-mount.log`) |
| the bound list stays auditable | `its own rowsDeclaredBound row lists exactly those 33 ids` (unchanged aggregate row, still TRUE) |

## What this does NOT prove / open items

1. **No container was run here.** This session ran no Docker. The step-14b numbers (52 / 0 / 33) are
   the CAPTAIN's measured run in `evidence/docker/client-install/2026-10-27T03-58-45Z/`; a re-run of
   `node scripts/docker-e2e.ts --mode source --require-docker --no-browser` with the markers is the
   integration step and is NOT covered by this evidence. What IS proven offline: the frozen report of
   that run, replayed through the container's own reporter, yields the exits in the table above.
2. **`bun run typecheck` is RED on this working tree, outside this change** — one diagnostic in
   `skills/dsh-qa/scripts/lib/user-surface-probe.ts(269,32)`: `Property 'ticks' does not exist on type
   'ProbeConfig'` (the file, and the case that passes `ticks: 22`, are untracked in-flight files of
   this wave; neither was edited here). `typecheck.log` quotes it. Nothing in the files changed here
   produced a diagnostic.
3. **`skills/**` was edited** (`skills/dsh-qa/SKILL.md`, `skills/dsh-qa/scripts/user-surface-mount.ts`),
   so the corpus `treeSha` in `VENDOR_LOCK.json` is stale until the wave's single
   `node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step` re-pin (AGENTS.md §9/§11:
   captain's step, same commit as the change).
4. **A residual of the same family, NOT fixed here (out of scope, reported):** when a declared row is
   FALSE, the case records the affected command rows as NON-GATING findings (`ok:null`,
   `gating:false`), and `appendNdjson` deliberately does not write non-gating rows — so the reporter
   re-creates them as canonical `null` "not reached" rows and the driver would answer exit 3 instead
   of exit 1. The run is red either way (the product false is real); only the exit code's meaning
   changes. It cannot fire on a fully-mounted run (the fixture is exactly that case).
5. **`verify:vendor` exits 1** — `FAIL - asset skills treeSha mismatch` (`vendor-observation.log`).
   The three user-surface case files were already untracked in this working tree when this change
   started, and this change edits `skills/dsh-qa/SKILL.md` too, so the wave needs its ONE re-pin
   (open item 3). Recorded here so no reader mistakes this evidence for a vendor-green sweep.
6. **The working tree already carried uncommitted wave work when this change started**: the
   `userSurface.*` block in `docker/lib/report.ts` and the three untracked files under
   `skills/dsh-qa/scripts/` (`user-surface-mount.ts`, `lib/user-surface-eval.ts`,
   `lib/user-surface-probe.ts`). This change's own edits are: `declaredBoundMarker` + its emission and
   5 offline arms in `user-surface-mount.ts`; `declaredBoundIds` / `isDeclaredBoundRow` /
   `requiredArmExit` + the required-arm exception and the fixture replay arms in
   `scripts/docker-e2e.ts`; the marker comments in `docker/lib/report.ts`; one sentence and the arm
   count in `skills/dsh-qa/SKILL.md`. Nothing under `packages/**`, nothing in `VENDOR_LOCK.json`,
   nothing committed.

## Reproduction (commands and observed exits)

```
node skills/dsh-qa/scripts/user-surface-mount.ts --self-test   # exit 0 — 38 arms, 0 failed
node scripts/docker-e2e.ts --self-test                          # exit 0 — 238 arms, 0 failed
node scripts/verify-comment-coverage.ts                         # exit 0 — 479 files, PASS
.toolchain/node_modules/.bin/bun run test:qa                     # exit 0 — all self-tests passed
.toolchain/node_modules/.bin/bun run typecheck                   # exit 1 — see open item 2
```

The `[self-test] replay …` lines in `selftest-docker-e2e.log` are the readings in the table above,
printed by the arms themselves.

## Files here

| file | what it is |
|---|---|
| `README.md` | this report |
| `fixture-probe.json` | the fixture's path/sha256/counts, the 33 bound ids, the audit row, and the container driver's own before-state (`exitCode 3`, its 33 `unmeasured` names) |
| `selftest-docker-e2e.log` | the driver's full `--self-test` output (fixture replay + falsifier readings + every other arm) |
| `selftest-user-surface-mount.log` | the case's full `--self-test` output (38 arms, incl. the marker arms) |
| `test-qa.log` | `bun run test:qa` output (all QA self-tests) |
| `comment-coverage.log` | `verify:comments` output |
| `typecheck.log` | `bun run typecheck` output — the pre-existing, out-of-scope diagnostic |
| `vendor-observation.log` | `verify:vendor` output — the wave's un-repinned `skills` treeSha (captain's step) |
| `commands.txt` | the commands above with their observed exit codes |
