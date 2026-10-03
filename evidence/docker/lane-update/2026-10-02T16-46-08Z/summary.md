# Docker lane → the wave's new contract (R5 file logs, additive-only bundle, USER-level preset)

Stamp: 2026-10-02T16-46-08Z · Scope: `docker/**` + this evidence dir · No product code changed.

## Why

`evidence/docker/client-install/2026-10-02T16-14-48Z/` was red with 6 failed assertions (46 passed,
1 null). Two wave changes broke the lane's EXPECTATIONS, not the product:

1. **R5** moved every MPD runtime diagnostic out of the terminal into
   `<workspace>/.mpd/logs/<row>.log` (`rowLogLine`, `packages/mpd-dsh-adapter-plugin/src/index.ts`,
   `agent-references/seam-adapters.md`). The console greps for the adapter's boot line and for the
   session-gate registration line therefore witnessed nothing.
2. **Strict zero-override** (user decision 2026-10-02) removed the bundle's two id-targets on the
   host preset-registry rows, so `compose.mpdRows` (which required a `default: mpd` line) and
   `tui.registryDefaultMpd` (which required the TUI registry row to carry `default: mpd`) asserted a
   contract that no longer exists — and the tui-lane then had nothing making the session resolve
   `mpd` (`tui.sessionPreset` read `standard`).

## Per-file edits

| File | Change |
|---|---|
| `docker/entrypoint.sh` | New `row_log_line <row> <ere>` helper: reads a row's OWN file log under the two workspaces this lane really has (`$WORK_DIR`, the boot process's cwd → the exec-less `rowLogLine` fallback, and `$WORK_DIR/ws`, the session workspace) and returns the line PLUS the file that carried it. `boot.adapterService` now witnesses `[mpd-dsh-adapter] mpdDsh provided` in `.mpd/logs/mpd-dsh-adapter.log` (console grep kept as the secondary witness; a line in NEITHER records false). `boot.sessionGateListener` polls BOTH places (file first, console second) and fails only when both are empty. `compose.mpdRows` keeps the row-id list and replaces the `default: mpd` expectation with the additive-only contract: the INSTALLED bundle's two shipped layers must carry zero column-0 `- id:` entries (structural, pure bash), and `node scripts/verify-no-host-override.ts` is invoked as the stronger second witness — from a byte-identical COPY of the installed layers, because in the oneclick layout the bundle sits under `node_modules` where Node refuses to strip `.ts` (see below). The `default: mpd` line count stays as an OBSERVATION with `expected 0`. |
| `docker/tui-lane.sh` | `tui.registryDefaultMpd` → `tui.presetPreference`. Before the TUI process starts the lane now PERFORMS the documented user path: writes `<HOME>/.dsh-tui/agent-preset.json` (`printf '{\n  "preset": "mpd"\n}'`, 21 bytes, hex `7b0a202022707265736574223a20226d7064220a7d`), asserts the bytes against the INSTALLED dsh-tui writer's own output (`lib/types/presetPrefs.js#writePresetPref` → `JSON.stringify({preset}, null, 2)`, reachable via the profile's `node_modules`), and asserts the host `dsh-tui-agent-preset-registry` row is UNTOUCHED by the bundle (no bundle-forced `mpd`; the host's own `default: standard` is expected and recorded; neither shipped layer column-0 id-targets the id). Header comment updated (11 → 15 assertions, accurate count of the `tui.*` records). |
| `docker/lib/report.ts` | `EXPECTED` assertion inventory: `tui.registryDefaultMpd` → `tui.presetPreference`. `proves` / `provesCompositionOnly` / `doesNotProve` updated: the gate line is now cited as file-log evidence (R5), the additive-only patch is a composition claim, and the TUI preference path is a runtime claim — plus an explicit "the bundle does not make `mpd` the deployment default" in `doesNotProve`. |
| `docker/README.md`, `docker/README.zh-CN.md` | Bilingual pair (switch link under the title, identical heading tree). Steps 8/9/12/15 restated to the new contract, the "eleven assertions" count corrected to fifteen, and a new section **The lane contract / 本 lane 遵循的契约** added: MPD diagnostics are read from `<workspace>/.mpd/logs/*.log` (R5) with the console as secondary; the bundle is additive-only (zero column-0 id-targets, `verify-no-host-override` as the second witness); the default preset is a USER-level setting the lane performs (Web: explicit `agentPreset` on `session/create`; TUI: dsh-tui's own persisted preference). |

Untouched on purpose: `cordis.patch.yml`, `presets/mpd.patch.yml`, every `packages/**` file, and the
six assertion names the brief did not ask to replace. Two README/doc statements in `presets/mpd.patch.yml`'s
header comment still describe the retired `default: mpd` id-target — product file, reported not edited.

## Proof — both lanes, final lines

```
$ node scripts/docker-e2e.ts --mode source --require-docker
[driver] ok=true complete=false passed=52 failed=0 null=1 NULL=[boot.llmTurn]
[driver] evidence -> evidence/docker/client-install/2026-10-02T16-46-05Z
(exit 0; the one null is boot.llmTurn: no credentials are staged, AGENTS.md §10)

$ node scripts/docker-e2e.ts --mode oneclick --spec github:HaroldZ32/My-Power-Dsh#feature/seam-convergence --require-docker
[driver] ok=true complete=false passed=54 failed=0 null=3 NULL=[build.bunInstall,build.dists,boot.llmTurn]
[driver] evidence -> evidence/docker/client-install-oneclick/2026-10-02T16-49-35Z
(exit 0; build.bunInstall / build.dists are "not applicable in one-click mode" by construction, and
boot.llmTurn has no credentials — every other assertion is true)
```

The two runs' key raws (from their `result.json`):

```
compose.mpdRows   rows=mpd-dsh-adapter,mpd-bootstrap,mpd-web-compat,mpd-roles,mpd-workmate layers=2
                  idTargets=0 defaultMpdLines=0 gate exit=0 subject=byte-identical
                  [verify-no-host-override] PASS: every id-target is bundle-owned (0 of 0 collide with the 185 host-declared row ids)
boot.adapterService       [mpd-dsh-adapter] mpdDsh provided (file=/work/.mpd/logs/mpd-dsh-adapter.log)
boot.sessionGateListener  [mpd-roles] session gate listener registered for agent "session-…" agentPreset=mpd
                          (file=/work/.mpd/logs/mpd-roles.log)
tui.presetPreference      pref=/root/sandbox-home/.dsh-tui/agent-preset.json hex=7b0a202022707265736574223a20226d7064220a7d
                          writerParity=identical hostRowDefault=standard bundleForcedMpdLines=0
                          shippedIdTargets=<none> layers=2/2
tui.sessionPreset         {"found":true,"sessionId":"…","agentPreset":"mpd","bytes":687}
tui.laneExit              ok=true records=15
```

The oneclick lane installs `github:HaroldZ32/My-Power-Dsh#feature/seam-convergence` — `profileDep` =
that git spec, `oneclick.filesAllowlist` true, `oneclick.distByteIdentical` true, no fatal module
signature — and the composed tree carries
`- id: mpd-tui-adapter / name: '@mpd-dsh/mpd/packages/mpd-tui-adapter-plugin/dist/index.js'`, i.e. the
new package IS packed and its row resolves. `boot.mpdTools` 6/6, `boot.presetMount` ok with
`agentPreset=mpd`, and the real TUI session on that packed install reports `agentPreset=mpd` too.

## Real findings (reported, not papered over)

1. **`node scripts/verify-no-host-override.ts` cannot run from the installed tree in oneclick mode.**
   The installed bundle lives under `node_modules`, and Node refuses type-stripping there
   (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, reproduced locally). The lane now copies the
   manifest + both layers + `scripts/` to a scratch dir, asserts the copy is byte-identical
   (`cmp`), and runs the gate there — so the stronger witness works in BOTH modes. The lane's own
   structural read (zero column-0 id-targets) remains the primary witness and needs no node.
2. **The old console-grep + `pipefail` combination turned a silent witness into a lane abort.**
   `… | grep -E 'PASS:|NOTE|…' | tail | tr` exits 1 when nothing matches, and this file's
   `trap 'on_error' ERR` then aborted the whole run (measured: oneclick
   2026-10-02T16-36-24Z, "unexpected shell failure (exit 1) near line 725", 16 passed / 30 null).
   Every new pipeline is `|| true`-guarded and the gate's output is now printed into the step log.
3. **`presets/mpd.patch.yml`'s header comment is stale** — it still says the main bundle patch
   "id-targets `agent-preset-registry` to `default: mpd`". Product file, outside this task's scope;
   flagged for the captain.

## What I could not verify / residual uncertainty

- `boot.llmTurn` stays `null` by design (no credentials staged); no live LLM turn is exercised.
- The TUI preference channel is proven for **dsh-tui 0.12.0** (the pin). A future dsh-tui release that
  moves `~/.dsh-tui/agent-preset.json` would redden `tui.presetPreference` (byte/parity clauses) and
  `tui.sessionPreset` — that is the intended falsification, but it is a forward-looking hazard.
- `tui.presetPreference`'s "host row untouched" clause reads the composed row block; if the host row
  disappeared from the composition entirely the clause would be vacuous — the strict `tui.sessionPreset`
  arm is what covers that case (no session could resolve `mpd` without the registry).
- One intermediate source run (2026-10-02T16-28-31Z) is kept as evidence of the diagnostic iteration:
  it caught the host's own `config.default: standard` and is why `tui.presetPreference` asserts
  "no bundle-forced `mpd`" instead of "no `default:` key".
