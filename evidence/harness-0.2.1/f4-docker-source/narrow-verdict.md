# Narrow verdict — claim 4b on the third tree (Docker real-machine lane)

Code tree `2746cbb0` ("fix(qa,docker): make both instruments measure the mechanism the product actually has"),
with the evidence commit `bb360f0f` on top (verified HEAD; `git log` shows 2746cbb0 as its parent).
Lane evidence: `evidence/docker/client-install/2026-10-17T15-31-26Z/` (+ driver.json).
Wrapper: `evidence/harness-0.2.1/f4-docker-source/`.

## What the artifact says

- Pin: `harness.installed/expected = 0.2.1-rc.2`, `harness.version` = `{ok:true, raw:"0.2.1-rc.2"}`.
- Assertions: `passed 63 / failed 1 / null 54`; the single red is `tui.laneExit` (`raw: "line=182"`).
- Both previously-red instruments are GREEN with their own artifacts:
  `ui.mpdSettingsSection = true` (`raw: chars=4000 opened-by=launcher Account menu open=Account menu->General`,
  screenshots under `ui-shots/`) and `qa.readonlyDeny = true` (`exit=0`, `mutationMechanism: "child-scope"`).
- Both pack assertions are green with the pinned-toolchain witness:
  `pack.staticCoherence` (`drifted=none`, 617 files byte-identical) and `pack.distFreshRebuild`
  (`rebuildBun=/opt/toolchain/bun-pinned/bin/bun`, `rebuildBunVersion=1.4.0`, `exactMatch=true`).
- `tui.hostInstall = true` (`version=0.15.0`), i.e. the TUI HOST itself installed; the abort is the NEXT
  step, `docker/tui-lane.sh` line 182: `dsh plugin --profile dsh-tui add "@deepseek-harness-tui/dsh-tui@$TUI_VERSION"`.
- The lane's own `add-host.log` for that step was NOT captured into evidence, so the refusal TEXT is
  unproven; `tui.pluginAddHost` is null, consistent with a `set -e` abort at that command.

## The exit code — a second cause, independent of the TUI

`driver.json`: `exitCode: 3`, `unmeasured: ["ui.replyRendered"]`, `requiredPrefixes: ["ui."]`,
`browserEnabled: true`, `liveRequested: false`; the container's `driver-run` exited 1.
`ui.replyRendered` is null by design without a credential — its own reason: "DECLARED BOUND — no reply
was rendered: the turn's failure panel names the missing credential (MISSING_CREDENTIAL) and this
container stages none".

MEASURED COMPARISON, which is what makes this structural rather than a regression:
the last GREEN source lane (`evidence/docker/client-install/2026-10-16T10-04-20Z`) ran
`liveRequested: true, exitCode: 0, unmeasured: []`; both of this wave's runs ran
`liveRequested: false` and exited 3 with exactly that one unmeasured required arm.

So: **the lane's exit 0 requires a forwarded credential (`--live`), not a code change.** Without it the
required `ui.` arm is unmeasured and the lane exits 3 on ANY tree.

## Verdict

- **Claim 4b, read as "the lane ran against 0.2.1 and its assertion record is green except the
  pre-declared bound": PASS**, with `tui.laneExit` recorded as the declared R5 bound.
- **Claim 4b, read as "the lane process exits 0": FAIL**, and not because of the TUI — the exit is 3
  from the unmeasured `ui.replyRendered` (no credential staged). That reading is unreachable on this
  machine by construction.
- A green EXIT would need `--live` with a key. A deterministic way to isolate the TUI red without a
  credential is `--no-browser`, which drops the required `ui.` prefix and would leave exit 1 with
  exactly one failed assertion.
- What would settle the TUI attribution exactly: capture `$TUI_DIR/add-host.log` (the failed step's
  stderr) into the evidence dir. The step, the version and the abort are proven; the refusal TEXT is
  not, and the repo's recorded peer-refusal measurement names an earlier pin (0.11.2), not 0.15.0.

## Operational finding (this network)

The lane cannot install the harness by default here: the official registry answers metadata quickly and
blackholes the tarball, so the step dies on the 900 s budget. Exporting
`MPD_E2E_NPM_REGISTRY=https://registry.npmjs.org` arms the lane's own tarball probe, which then settles
on `registry.npmmirror.com` (`route=mirror-fallback`, ranged GET `http=206`) and the install succeeds.
Two default runs died `npm exit=124` before that knob was set. Recommended as a SEPARATE change (arm the
tarball probe by default / make the mirror fallback automatic), not folded into this wave.
