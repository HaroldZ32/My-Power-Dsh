# STEP 2b — `tui-panels` `tuiSettingsSections`: the FROZEN patterns were stale, not the code

Lane: `tui-panels` (`skills/dsh-qa/scripts/tui-panels.ts`). The lane's third `allPatterns` entry was
`/takes effect for the mpd plugins after a restart/`.

## The measured truth (from the T8 pane, no re-run needed)

```
$ grep -a "takes effect" evidence/tui/dsh-tui-015/q-run/tui-panels.evidence/settings.pane.txt
  ╭─ MPD 插件包 · a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and takes
    effect in the RUNNING process — no restart: the config service re-resolves on every settings save and
    on a watched edit of the project file, and the model routes (teamModels, agentRoutes, modelchain) are
    read pe… ─╮
```
Source of the live string: `packages/mpd-tui-plugin/src/settings.ts` → `SECTION_NOTICE =
`${BRIDGE_DISCLOSURE} ${BRIDGE_NOT_LOST}``, with `BRIDGE_DISCLOSURE` rewritten by commit **cc5387e0**
(`fix(model-config): live-refresh model routes in-process and add per-agent route table`). The lane's
frozen literal was never updated → the stale lane, not the code.

## The two edits

1. `tui-panels.ts` — the third `tuiSettingsSections` pattern is now
   `/takes effect in the RUNNING process — no restart/` (the arm's label likewise says
   "bridge+no-restart+never-lost").
2. `tui-panels.ts` — the offline reference pane for the `settings` step (used by `--self-test`) now
   carries the SAME current `SECTION_NOTICE`, so the offline fixture models the real screen instead of
   the retired one.

## The second, MEASURED consequence of the same commit: the pane width

The rewritten disclosure is ~520 columns with the knob prefix (the old one was 315). At the lane's
320-column pane the host ellipsized it to `… are read pe…`, so the LAST frozen clause (`never lost`) was
beyond the cut:

```
$ bun skills/dsh-qa/scripts/tui-panels.ts --sandbox-root .mpd/recon/qa/tui-lanes/tui-015   # after edit 1, width 320
[tui-panels] surfaces: ... tuiSettingsSections=MISSING ...
missingPatterns: ["/never lost/"]          # the other three matched
```
So `PANE_WIDTH` was raised 0 -> 560 (documented in the constant, including why widening was chosen over
weakening the expectation: the four-clause disclosure stays asserted VERBATIM, so a regression that drops
a clause still reddens).

## Observed after both edits

```
$ bun skills/dsh-qa/scripts/tui-panels.ts --self-test
[tui-panels self-test] ok: 8 surfaces asserted, negative controls fail as required
exit=0
```
and the live re-run in `evidence/tui/dsh-tui-015/q-run/step3-final/tui-panels.log` (see `step3-lanes.md`):
`tuiSettingsSections=rendered`, with `tuiRenderers=MISSING` — the ONE pre-existing red the frozen table
expects.

## Honest bound

The 560-column widening is a LANE-SIDE parameter, not a product claim: the whole disclosure genuinely
renders at that width on the sandbox host. If a future `SECTION_NOTICE` grows past ~540 columns the arm
will go red again rather than silently pass, which is the intended behaviour.
