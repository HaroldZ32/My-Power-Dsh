# FINAL verdict — Docker acceptance on `2a22837a` (dsh-tui 0.16.1 + harness 0.2.1-rc.2)

Verified: `git rev-parse HEAD` = `2a22837a117f4ed32796ee53b8969379ef0fce3b`, tree clean apart from this
lane's own `evidence/**`. Lane evidence: `evidence/docker/client-install/2026-10-18T08-40-51Z/`.
Unit suite re-run by this lane on this tree: `bun test packages` → **2013 pass, 3 skip, 0 fail** (125 files).

## The assertion record (deciding artifacts)

- `result.json`: `ok: true`, `summary: {total 118, passed 84, failed 0, null 34, failedNames: []}`.
- Pin: `harness.installed/expected = 0.2.1-rc.2`, `harness.version = {ok:true, raw:"0.2.1-rc.2"}`.
- TUI, on dsh-tui **0.16.1**: `tui.hostInstall=true` (`version=0.16.1`), `tui.pluginAddHost=true`
  (`exit=0` — the step that killed the 0.15.0 lane at `tui-lane.sh:182`), `tui.boot=true`
  (`tmux=new-session-ok ready=chat-screen`), `tui.mergedPanelOpens=true` + `tui.mergedPanelOrder=true`
  (`panelSeam=present … TITLE_HITS=2 SUB_HITS=2 TEAM_HITS=2 CONTROL_HITS=0`, pre-key capture),
  `tui.hostDashboardKeyIntact=true`, `tui.laneExit=true` (`records=21`). `tui.hostPeerBound` is ABSENT
  (self-disarmed on a supporting host), exactly as designed.
- `pack.staticCoherence` (`drifted=none`) and `pack.distFreshRebuild` (`rebuildBun=…/bun-pinned/bin/bun`,
  `exactMatch=true`) green; `ui.mpdSettingsSection=true` (`opened-by=launcher Account menu`);
  `qa.readonlyDeny=true` (`exit=0`, `mutationMechanism:"child-scope"`).

## The exit code — still 3, and it is the credential, not the product

`driver.json`: `exitCode: 3`, `unmeasured: ["ui.replyRendered"]`, `requiredPrefixes: ["ui."]`,
`browserEnabled: true`, `liveRequested: false`; `driver-run` status 0 (the container itself passed).
The driver promotes a passing container to exit 3 when a REQUIRED arm is unmeasured, and `ui.replyRendered`
cannot be measured without a forwarded credential (`MISSING_CREDENTIAL` in the turn's own panel).
The last exit-0 source lane (`2026-10-16T10-04-20Z`) ran `liveRequested: true, exitCode: 0`.

**So: the ASSERTIONS are green; the PROCESS still exits 3.** A zero exit needs `--live` with a key (or
`--no-browser` to drop the required `ui.` prefix, which would leave zero reds on this run — 84/0 with no
required ui arm). `complete: false` is expected (34 nulls) and is NOT the acceptance predicate for a
single invocation; `ok` + an empty FAILED list is, provided the nulls are declared.

## Verdict

- **PASS on the Docker acceptance claim for `2a22837a`** — no failing assertion, the harness pin exact,
  the TUI genuinely exercised on 0.16.1, both pack assertions green with the pinned toolchain.
- **The PASS is bounded by the exit code**: the command on this machine without a credential exits 3 by
  the driver's own required-arm rule. The PR must not print "GREEN" without that sentence.
- Remaining bounds: no credential → `live.*`, `ui.replyRendered`, native `TeamExecutor` INCONCLUSIVE;
  one `request/header` per session → read-only/persona findings describe the child's FIRST assembly;
  `preset-mpd` pending on `mpd-headless` is cross-version profile composition; the container's resolved
  `cordis` is unprinted (closure 4.0.5, inference); bare `bun test` sweeps `evidence/**` while
  `bun test packages` is green; `preset-conformance` cannot validate a hoisted closure layout; the run's
  harness install travelled on `registry.npmmirror.com` (named explicitly) — an environmental bound.
