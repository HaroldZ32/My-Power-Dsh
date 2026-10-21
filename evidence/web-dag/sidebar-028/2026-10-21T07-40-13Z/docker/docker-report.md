# Docker UI capture report — wave `web-dag-sidebar-028`

- Repo: `/home/haroldzhao/MyProj/DshProj/My-Power-Dsh`
- Branch / commit at capture time: `feature/web-dag-sidebar-028` / `6e89d619e26800e1770ac85f08420b4dc3c4bf85` (clean tree)
- Evidence dir (this file's directory): `evidence/web-dag/sidebar-028/2026-10-21T07-40-13Z/docker/`
- UTC window: 2026-10-21T07:40Z … 07:56Z (local 15:40 … 15:56 +08:00)
- No code, test, `package.json` or git state was modified. Only evidence files were written.

## 1. Declared command — `scripts/docker-e2e.ts` (exit 3, as declared)

```
node scripts/docker-e2e.ts --mode source --require-docker --require-browser
# exit code: 3
# driver.json: startedAt 2026-10-21T07:40:16.046Z, finishedAt 07:49:19.647Z (535 s), containerExit 1
# raw console: driver-console.log ; container artifacts: e2e/{result.json,output.log,console.log,driver.json}
```

Assertions in `e2e/result.json`: **122 total — 82 true, 2 false, 38 null**.

`ui.*` rows (browser lane, real Chromium):

| row | verdict | note |
|---|---|---|
| `ui.loads` | true | Web GUI loaded in a real browser |
| `ui.workspaceSelected` | true | composer live |
| `ui.composerPresent` | true | |
| `ui.promptSent` | true | prompt typed + sent through the UI |
| `ui.replyRendered` | **null** | **DECLARED BOUND** — no model turn: the turn panel reports `MISSING_CREDENTIAL` for `deepseek-official` |
| `ui.mpdSettingsSection` | true | |
| `ui.teamPanel` | true | roster + board shell rendered |
| `ui.noConsoleErrors` | true | |
| `ui.teamBoard` | null | not attempted: no `--team-expected` (no live team build) |

The driver converts the null to exit 3 (`unmeasured: ["ui.replyRendered"]`, `requiredPrefixes: ["ui."]`). **The lane did not pass; it declared the credential-free bound exactly as specified.**

### Two additional FALSE rows (not the declared bound)

`e2e/result.json` also carries two red pack assertions, which is why the container's own reporter exited 1:

- `pack.staticCoherence` — `15 differing file(s)` between `dist/mpd-package` and the tree it claims to be cut from: `CONTRIBUTING.md`, `CONTRIBUTING.zh-CN.md`, `agent-references/troubleshooting.md`, `cordis.patch.yml`, `docs/development.md`, `docs/development.zh-CN.md`, `docs/independence.md`, `docs/independence.zh-CN.md`, `docs/user-guide.md`, `docs/user-guide.zh-CN.md`, `packages/mpd-better-sidebar-host/README.md`, `packages/mpd-better-sidebar-host/README.zh-CN.md` (plus path list truncated in `raw`).
- `pack.distFreshRebuild` — `2 differing`: `packages/mpd-better-sidebar-host/dist/index.js`, `packages/mpd-team-core-plugin/dist/index.js`, rebuilt under the declared `bun@1.4.0` (`pack.rebuildToolchain` true, so this is staleness, not a compiler difference).

Cause: `dist/mpd-package/` on this host was packed at 12:08 local, before commit `6e89d619` (15:35) and before `HEAD~1` (12:51). It is a stale local release artifact, not a wave-code defect; repacking (`node scripts/pack-mpd.ts`) would be a separate, out-of-scope step and was **not** run.

### This lane does not produce 07/08

`scripts/docker-e2e.ts` drives the browser through `docker/lib/browser-lane.ts` and writes only `e2e/ui-shots/ui-0*.png` (login, home, prompt, reply panel, settings, team-panel shell). It **never runs `docker/ui/capture.mts`**, so the graph screenshots `07-team-graph-hover.png` / `08-dag-curve.png` come from the repository's UI-capture lane below. `e2e/ui-shots/ui-03-reply.png` is the visual proof of the declared bound (red "This turn failed … MISSING_CREDENTIAL"); `ui-05-team-panel.png` shows the empty team panel ("No team in this workspace yet") because this lane seeds no team fixture.

## 2. UI capture lane (the lane that writes 07/08)

```
# host
BUILDX_CONFIG="$PWD/.mpd/buildx" DOCKER_CONFIG="$PWD/.mpd/docker-config" \
  docker compose -f docker/ui/docker-compose.yml up -d --build      # exit 0
# image mpd-ui-view:latest built 2026-10-21T15:40:17+08:00, container ui-ui-1 recreated
docker/ui/seed-team-fixture.sh --board=normal                        # exit 0 — 6 tasks, 5 members, bound to 126 sessions
docker exec ui-ui-1 bash -lc 'MPD_UI_LANG= bash /data/run-capture.sh' # see below
```

Freshness proof (the container predated the wave commit and was rebuilt):

```
sha256(ui-ui-1:/src/packages/mpd-bundle-plugin/src/team-view.ts) = c9ee1c8f…68f07b = host file
sha256(ui-ui-1:/data/capture.mts)                               = 712dbdc1…14092f = docker/ui/capture.mts
```

### Run log

1. **Attempt 1 — exit 1**, no screenshots: `browserType.launch: … headless_shell: error while loading shared libraries: libnss3.so`. Cause: `docker/ui/entrypoint.sh` guards `playwright install-deps` on `libglib-2.0.so.0`; that library is present in the base image while `libnss3` was not, so the install was skipped after the volume-backed browser survived a container recreate (log: `ui-capture.log`).
2. Environment repair **inside the container only** (no repo edit): `npx playwright install-deps chromium` → exit 0, `libnss3.so` present, `ui-install-deps.log`.
3. **Attempt 2 — exit 0**: 18/18 checks true, 9/9 steps ok, `consoleErrors: []` (`ui-capture.log`, `ui-shots/report.json`).
4. **CJK-board capture — exit 0**: `docker exec -e MPD_UI_BOARD=cjk … run-capture.sh`, 18/18 checks true, 9/9 steps ok (`ui-capture-cjk.log`, `ui-shots-cjk/report.json`). Run because the normal board has **no completed→running edge**; the cjk board does (`T3` in_progress blocked by `T1` completed).

Toolchain inside the container: dsh `0.2.1-rc.2`, Playwright `1.49.1`, Chromium `131.0.6778.33`, Node `v24.21.0`, viewport `1600x1000`.

### Capture checks (normal board; cjk identical)

```
mpdPresetOffered true · pluginsShowsInstalledBundle true · presetsShowMpdDefault true
mpdSectionRendered true · sessionCreatedOnMpdPreset true · teamPanelShowsRoster true
teamGraphDrewEdges true · dagEdgesAreCurves true · dagOnePathPerEdge true
dagTipIsZeroWidth true · dagTipTouchesBorder true · dagDrawingHasNoCjk true
dagDetailKeepsCjk true · teamGraphEdgesResolve true · teamGraphHoverFocusChain true
teamGraphNodesDoNotOverlap true · teamGraphClickPinsDetail true · mpdControlsBound true
```

DOM geometry read by the capture (normal board): nodes `T1,T3,T2` at x=905, y=574/626/678; `T4,T5,T6` at x=1073/1241/1409, y=626; boxes 144×42; `teamNodeOverlaps: []`; edges `T4<-T1, T4<-T3, T5<-T4, T6<-T5`; `focusWhileHovered: chain`, `focusAfterLeave: none`, `detailAfterClick: T6`.

## 3. Screenshots and per-image findings

All shots are 1600×1000 PNG, freshly written 2026-10-21 15:51–15:56. `sha256` values are in §6.

Legend for the six questions: (a) frosted/translucent node cards; (b) running-node breathing glow; (c) completed→running animated flow arrow; (d) hover card near cursor with white/black/rgba styling; (e) symmetry about the horizontal midline and no overlapping connectors; (f) clipping / contrast / z-index.

### `ui-shots/07-team-graph-hover.png` (normal board, sha `9b0432df…12a56`)
- (a) Cards render near-white over a flat page backdrop; translucency cannot be *seen* over a flat background (the CSS is `rgba(255,255,255,.62)` + `backdrop-filter: blur(14px)`). The **hover card itself is visibly translucent** — the sidebar's account row shows through it.
- (b) The running node is `T2` (in_progress). It is not in T6's focus chain, so it is dimmed to `opacity .4`; its blue breathing halo is faint but present.
- (c) **Not present.** The normal fixture has no completed→running pair (running `T2` has no blocker; `T1/T3` completed → `T4` failed). The edge is absent by board construction, not by a drawing defect.
- (d) **FAIL.** The card is at the viewport's top-left corner (≈`x 14–255, y 16–117`), while the hovered/clicked node `T6` has DOM box `x 1409–1553, y 626–668` (centre ≈1481,647). Styling is correct (translucent white `rgba`, `#111` text, `rgba(17,24,39,.45)` border, 10 px backdrop blur, shadow), placement is not.
- (e) Symmetric about the horizontal midline: rank 0 spans y 574–720 (centre 647) and ranks 1–3 sit at y 626–668 (centre 647). No line crossings, but the two fan-in edges into `T4` arrive 3–4 px apart with overlapping arrowheads (see 08).
- (f) No clipping; hover card z-index is high enough to sit above the sidebar. Dimmed non-chain nodes are low-contrast by design.

### `ui-shots/08-dag-curve.png` (normal board, sha `f13f41d…dfd11e`)
- (a) Same as 07 (cards near-opaque-looking; blur unprovable on a flat backdrop).
- (b) `T2` remains dimmed (hover chain from pinned `T1`); faint halo.
- (c) **Not present** (no completed→running edge; see 07).
- (d) **FAIL** — same top-left card (≈14,16), this time describing `T1` (`completed`), far from the cursor/`T1` node.
- (e) Connector geometry from `report.json`: `T4<-T1` ends `(180,70)` and `T4<-T3` ends `(180,74)` in layout coords — two arrowheads 4 px apart on the same border. At 8× the two inbound arrowheads merge into one thick arrow, so the fan-in reads as a single dependency. No crossing lines; symmetry as in 07.
- (f) No clipping. Edge strokes are thin but legible; the dashed flow style is absent because no edge qualifies.

### `ui-shots/06b-team-board.png` / `06-team-panel.png` (normal board, no hover)
- (a) Cards read as white with a soft shadow; over the flat backdrop the 0.62-alpha fill is not visibly frosted.
- (b) **Present.** `T2` (running) shows a blue border plus a wide pale-blue outer ring at this frame (4× crop `crops/06b-t2-running-4x.png`) — the breathing glow's box-shadow, frozen mid-cycle.
- (c) Not present (no completed→running edge).
- (d) No card (no hover).
- (e) Same symmetric ranks; fan-in arrowheads at `T4` overlap as above.
- (f) No clipping/contrast/z-index defect.

### `ui-shots/01-first-run.png`, `02-home.png`, `03-plugins.png`, `04-settings-mpd.png`, `05-settings-agent-presets.png`
Not DAG surfaces, so (a)–(e) are N/A. Checked for (f): no clipping or contrast defect. `01` is the expected "Get started" credential modal; `03` lists `@mpd-dsh/mpd` installed and enabled; `04` shows the MPD settings card (`hashline.maxDiffChars=20000`, `commentChecker.autoCheck=true`, `ulw.maxRounds=6`); `05` lists `MPD (Main Working Agent)` under CUSTOM. Host-UI nit only, outside this wave: on `05` the "New task default" pill slightly overlaps the `standard` id text on the Standard-mode card.

### `ui-shots-cjk/06b-team-board.png` (cjk board, sha `7881df7…4820a7`) and `ui-shots-cjk/08-dag-curve.png` (sha `deb8df3…d04130`)
Captured to close the (c) gap, because this board contains `T3` (`in_progress`) blocked by `T1` (`completed`).
- (c) **Present.** On `T3<-T1` the still shows the blue motion-arrow polygon (the `animateMotion` overlay, `TONE.running`) plus the dashed stroke (10× crop `ui-shots-cjk/crops/06b-t1-t3-flow-10x.png`). A still proves the elements exist at that instant, never that they move.
- (a)/(b) `T3` also carries the blue breathing halo in the no-hover shot.
- (d) **FAIL** — the same top-left hover card appears after the click (cjk 08), with the CJK subject `！？。`; the pinned detail body below the graph keeps that subject verbatim (C3 OK).
- (e) No crossings; the cjk board is two-node stacks per rank (T1/T2, T3/T4, T5/T6) with the running node's halo not disturbing the row alignment. (f) No clipping.

## 4. Defects and gaps that need a repair (reported, not fixed)

1. **Hover card anchors to the viewport's top-left after a click/focus** (blocks requirement (d)).
   Both normal 07/08 and cjk 08 show the card at ≈`(14,16)`. Mechanism in `packages/mpd-bundle-plugin/src/team-view.ts`: the node has `tabIndex: 0`, a click focuses it, and `onFocus` calls `setTipState({ id, ...tipPoint(event) })`; a `FocusEvent` carries no `clientX/clientY`, so `tipPoint` falls back to `rawX = 0, rawY = 0` and returns `(14,14)`, overwriting the last pointer anchor. This is visible in a plain browser, not only under the capture driver. Suggested direction (not applied): do not overwrite the anchor on a focus event that carries no coordinates (or place the card from the node's own box on keyboard focus).
2. **Fan-in arrowheads overlap.** The normal board's `T4<-T1` and `T4<-T3` tips land at layout y 70 and 74 on `T4`'s left border; at 1× they read as one thick arrow, so the two dependencies are ambiguous. Either enforce a minimum arrival separation in the router or fan the two tips further apart on the target border.
3. **`docker/ui/entrypoint.sh` skips `playwright install-deps` on a stale-volume container.** The guard keys on `libglib-2.0.so.0`, which the base image already provides, while `libnss3.so` was missing; the capture dies at `browserType.launch`. Repaired in-container for this run; the repo-side guard should probe one of Chromium's own libraries (or always run install-deps when the browser came from the volume).
4. **The normal fixture does not exercise the flow animation.** `T2` (running) has no blocker, so 07/08 show no completed→running edge. If the wave wants the flow arrow in the canonical still set, the fixture needs a completed parent pointing at a running child (the cjk board has one).
5. **Flow dashes are crushed on short edges.** `pathLength="100"` normalises `stroke-dasharray: 6 6` to ~6 % of the path, which is ~1.4 px on the 24 px `T3<-T1` hop; the visible cue is effectively the blue motion arrow. Worth a longer edge or pixel-unit dashes if the dash pattern is meant to read.

## 5. Honest bounds

- No live model reply was produced (`MISSING_CREDENTIAL`); `ui.replyRendered` is a declared bound, and the `docker-e2e.ts` run is **not** a pass (exit 3).
- A still frame proves the **presence** of the running glow and of the flow arrow/dash elements at one instant; it cannot prove motion, tempo, or the breathing cycle.
- Frosted translucency (`backdrop-filter`) cannot be confirmed over the flat page backdrop; only the hover card's translucency is visible (background content behind it).
- The hover-card placement was captured only after a click (focus), not on a pure mouse hover; the defect is therefore proven for the click/focus path and the code path explains why a plain hover is unaffected.
- The screenshots contain no cursor glyph (headless capture), so "near the cursor" is judged from the DOM node boxes recorded in `report.json`.
- The second `pack.*` failure is stale-local-artifact evidence; no repack was performed.
- `ui-shots/` holds only the 9 files this run wrote; files left in `docker/ui/out/shots` by earlier runs were deliberately not copied. The capture runner writes into the TRACKED `docker/ui/out/shots/`; after copying, those files were restored byte-for-byte from `HEAD` (`git show HEAD:<path>`), so the working tree carries no repository modification — only the untracked evidence directories.

## 6. Inventory (sha256)

```
9b0432df77d22ef6b66487391ff1c89a593d5047e8575efdbb3c5a451d012a56  ui-shots/07-team-graph-hover.png
f13f41dc82447746ebd24eec809a1d9e2525e902ba16dca97bff65f181dfd11e  ui-shots/08-dag-curve.png
bb4433c8a07d52c5aea7bd30e28b249b67d543af11a7744de167c62dca32f1da  ui-shots/06b-team-board.png
eb0ce973b08166ebe82007bbc7879f0c973aaaa41b7393cdd3d3b2f832fb5163  ui-shots/06-team-panel.png
92242f9427b53848e04e4718cda0be24efb8a6824bda44956d78ad3accce8a61  ui-shots/01-first-run.png
6c4ccf52d4903f8a754db9729084fa1b5247abd9fe2f071ac891281b2d912ec4  ui-shots/02-home.png
f9922a61e63f52c00ee2c3ed79ca671b9181dcf3068f0401e63d208c9697f2d6  ui-shots/03-plugins.png
897672abbc67a241bff7136d256759532d0229cdd0732d7fefccb093885ba5c6  ui-shots/04-settings-mpd.png
6033beaa409e136078c12ca6c387e176c8c51832b389568e92363a3254998913  ui-shots/05-settings-agent-presets.png
a6cadfe53a16dc01d4fc5271f27bb0a16f0c4c575a9a186932e30af18454336b  ui-shots/report.json
9b2a6912ce6c3e631d146402e21893526c5e9aa9bfe4436037a1f5d43b9c567e  ui-shots-cjk/07-team-graph-hover.png
deb8df391db254db40eebd373baf65776858731a67487951b1f7e30078d04130  ui-shots-cjk/08-dag-curve.png
1a18c444cc56935edb1133a593a1f2b886833d8ee158c90c7a0334fbe9e0b903  e2e/result.json
bc77ac5e097af46a14e9d50d181c67fc8c59da97e68e84056e807ad69d298a85  e2e/driver.json
```

Logs in this directory: `driver-console.log` (declared command, EXIT=3), `ui-compose-up.log`, `ui-capture-attempt1-failure.txt` (transcribed first attempt), `ui-capture.log` (successful rerun), `ui-capture-cjk.log`, `ui-install-deps.log`.
