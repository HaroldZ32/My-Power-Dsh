# STEP 3 — the full 8-lane re-run against the frozen expected-status table

Driver: `evidence/tui/dsh-tui-015/q-run/run-lanes-step3-final.sh` — `run-lanes.sh` with its OUT root moved
to `q-run/step3-final/` (so the T8 baseline at `q-run/` stays byte-intact) and `--out` added for the ONE
lane whose default evidence root (`evidence/mpd-bridge/**`) is outside this task's declared write scope.
Same sandbox root, same env (`XDG_RUNTIME_DIR` in-sandbox, npmmirror registry, the sandbox profile's own
0.15.0 launcher prepended to PATH), same lane order, same commands otherwise.

`repair/step3-final-driver.log` (one line per lane, with UTC start, exit code and the evidence dir),
per-lane `step3-final/<lane>.log` + `.exit`, and the lane evidence copied to
`step3-final/<lane>.evidence/`.

| Lane | Frozen expectation | Observed on this run | exit | Verdict |
|---|---|---|---|---|
| `tui-mount` | PASS | PASS — `witness=not-materialized`, `isolationOffenders=0`, layering/statusLine/counters/rendered/rowComposed all true | 0 | **MATCHES** (with the AC-11 bound declared, see `2a-tui-mount.md`) |
| `tui-deps-ctrla` | PASS (Ctrl+A inert; R4 holds) | FAIL — the 3 pane arms, the host-contact bound and the negative control are all green; only the STORE arm is red (`no command/run with name=mpd args=/panel/`) | 1 | **RED, declared** (`2c-tui-deps-ctrla.md`): no new red, the same red as T8, drive-independent |
| `tui-panels` | `ok=false` with `tuiRenderers` ONLY (7 of 8) | exactly that: `tuiStatus/…/tuiSettingsSections/tuiDialogs` rendered, `tuiRenderers=MISSING` | 1 | **MATCHES** (`2b-tui-panels.md`) |
| `tui-team-surface` | `ok=false` with `H4` ONLY (19 of 20) | `ok=false` with **H1, H3 and H4** | 1 | **RED**: H4 is the declared pre-existing red; H1/H3 are NEW reds, cause narrowed to the plan scene's session→team resolution (`2d-boot-wall.md`) → bounce to a packages lane |
| `tui-settings-bridge` | PASS (built bytes + status-line notice) | PASS — `T1..T8` all `ok`, including `T7` | 0 | **MATCHES** (`2e-settings-bridge-t7.md`) |
| `tui-admission` | PASS, extended by C3's six grant arms | FAIL — `arm1` ✓ `arm2` ✓ `arm4` ✓ `arm5` ✓, `arm6` observed; **`arm3` only** red (ledger attribution) | 1 | **RED, declared**: arm3's expectation cannot be met on 0.15.0 (no `decision-handler` resource kind exists in the ledger; our component id appears 0 times) → bounce to a packages/host lane |
| `tui-distribution` | SKIP acceptable only if honestly re-attempted | `SKIP absent-fixture` (`vendor/meta-protocols/dsh-distribution`) | 0 | **MATCHES** |
| `tui-spec-conformance` | env red declared unless `DSH_TUI_ROOT` provided | `SKIP absent-fixture` (`dsh-ecosystem-spec/conformance/requirements-v0.15.json`) | 0 | **MATCHES** |

## Score against the acceptance rule

- **5 of 8 lanes match the frozen table** (up from 2 of 8 at T8): `tui-mount`, `tui-panels`,
  `tui-settings-bridge`, `tui-distribution`, `tui-spec-conformance`.
- **3 lanes stay red**, each with a declared cause:
  - `tui-deps-ctrla` — the same red as T8 (the lane's boot never materializes a session store; the
    expectation itself is confirmed correct by measurement). Not a new red.
  - `tui-team-surface` — H1/H3 are NEW reds: the plan scene renders `no staged plan for team (none)` while
    the same boot's status line resolves the fixture team `(workspace-level)`. `packages/**` question.
  - `tui-admission` — NEW red reduced to ONE arm (arm3): the host's effect ledger on 0.15.0 carries only
    `host`/`undeclared` pluginIds and no `decision-handler` resource kind at all. `packages/**`/host
    question.
- **NO NEW REDS is therefore NOT satisfied**: `tui-team-surface` H1/H3 and `tui-admission` arm3 are new
  relative to the frozen table, and both are outside this task's write scope (`packages/**`), so they
  BOUNCE to the captain as packages-lane candidates rather than being silenced.

## Fluxes repaired this step (all lane-side, all in `skills/dsh-qa/**`)

1. `tui-mount` AC-11 witness bounded + freshness-filtered (`2a`).
2. `tui-panels` `SECTION_NOTICE` patterns + pane width (`2b`).
3. `tui-settings-bridge` T7 attribution (`2e`).
4. `tui-admission` stderr redirect (the `park`-frame flood), `bootWaitMs` 180 s, and the
   `/plugins` → `/plugin` + `/plugin list` drive rename (`2d`) — this alone took the lane from 2/6 arms to
   5/6.
5. `tui-deps-ctrla` drive left UNCHANGED after three measured variants failed (`2c`).

## Recorded bound — `--check-drift` (two PRE-EXISTING unlisted scripts)

```
$ node scripts/run-qa-lanes.ts --check-drift
[run-qa-lanes] drift: 2 lane script(s) on disk in no manifest entry:
  skills/dsh-qa/scripts/delegation-gate.ts, skills/dsh-qa/scripts/model-config-live-refresh.ts
[run-qa-lanes] discovery: 48 lane script(s) discovered (46 listed, 2 unlisted, 19 outside every suite)
exit=1
```
Both files are TRACKED AT HEAD (`delegation-gate.ts` from `fa38425d`, `model-config-live-refresh.ts` from
`cc5387e0`) and neither is in `git show HEAD:skills/dsh-qa/cases.json` — i.e. the drift predates this wave
and is NOT introduced by this task (this task added no lane script and changed no `cases.json` row). It is
recorded as a declared bound, not repaired here (a `cases.json` row for another writer's lane would be
outside this task's edit list).
