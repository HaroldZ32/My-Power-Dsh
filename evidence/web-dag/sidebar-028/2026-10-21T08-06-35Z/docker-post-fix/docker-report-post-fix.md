# Docker UI capture report — POST-FIX re-capture (wave `web-dag-sidebar-028`)

- Repo: `/home/haroldzhao/MyProj/DshProj/My-Power-Dsh`
- Commit under test: **`83796fb40d3686eef28c0a07603cf2a8dc9cad11`** — `fix(web): anchor hover card to the pointer and separate fan-in arrows`
- Evidence dir: `evidence/web-dag/sidebar-028/2026-10-21T08-06-35Z/docker-post-fix/`
- Capture window: 2026-10-21T08:06Z … 08:15Z (local 16:06 … 16:15 +08:00)
- Scope: ONLY the UI-capture lane. The 9-minute `scripts/docker-e2e.ts` run was NOT repeated.
- No code / test / `package.json` edit; no git write or commit. The runner writes into the TRACKED
  `docker/ui/out/shots/`; after copying, those files were restored byte-for-byte from `HEAD`
  (`git show HEAD:<path>`), so the tree carries only this untracked evidence directory.

## 1. Commands and exit codes

```
# 1. rebuild + recreate the UI container so it carries the new client.js
BUILDX_CONFIG="$PWD/.mpd/buildx" DOCKER_CONFIG="$PWD/.mpd/docker-config" \
  docker compose -f docker/ui/docker-compose.yml up -d --build        # exit 0 (ui-compose-up.log)
#    image mpd-ui-view:latest built 2026-10-21T16:06:38+08:00; container ui-ui-1 recreated
#    freshness: container /src/packages/mpd-bundle-plugin/client.js        = 6f517b58…51ab86a
#               container /src/packages/mpd-bundle-plugin/src/team-view.ts = 80ed7bb8…4ab414d
#               container /data/capture.mts                                = 712dbdc1…14092f
#               (all three equal the checkout at 83796fb4)

# 2. Chromium system libraries (the entrypoint guard still skips them on a recreated container)
docker exec ui-ui-1 bash -lc 'cd /data && npx playwright install-deps chromium'
#    exit 0; before: 17 shared libraries missing, libnss3.so absent
#            after : missing=0, libnss3.so present            (ui-install-deps.log)

# 3. normal board
docker/ui/seed-team-fixture.sh --board=normal                        # exit 0
docker exec -e MPD_UI_BOARD=normal ui-ui-1 bash -lc 'MPD_UI_LANG= bash /data/run-capture.sh'
#    exit 0 — 18/18 checks true, 9/9 steps ok, consoleErrors []   (ui-capture-normal.log)

# 4. cjk board (the only board with a completed -> running edge)
docker exec -e MPD_UI_BOARD=cjk ui-ui-1 bash -lc 'MPD_UI_LANG= bash /data/run-capture.sh'
#    exit 0 — 18/18 checks true, 9/9 steps ok, consoleErrors []   (ui-capture-cjk.log)
```

Capture order note: both runs write the same `docker/ui/out/shots/`, so the normal set was re-captured
AFTER the cjk run and archived as `ui-shots/` (files stamped 16:13); `ui-shots-cjk/` holds the cjk set
(stamped 16:12). The normal run logged in `ui-capture-normal.log` is that final run.

Toolchain: dsh `0.2.1-rc.2`, Playwright `1.49.1`, Chromium `131.0.6778.33`, Node `v24.21.0`, viewport 1600×1000.

## 2. Checks (identical on both boards — 18/18)

```
mpdPresetOffered true · pluginsShowsInstalledBundle true · presetsShowMpdDefault true
mpdSectionRendered true · sessionCreatedOnMpdPreset true · teamPanelShowsRoster true
teamGraphDrewEdges true · dagEdgesAreCurves true · dagOnePathPerEdge true
dagTipIsZeroWidth true · dagTipTouchesBorder true · dagDrawingHasNoCjk true
dagDetailKeepsCjk true · teamGraphEdgesResolve true · teamGraphHoverFocusChain true
teamGraphNodesDoNotOverlap true · teamGraphClickPinsDetail true · mpdControlsBound true
steps: 01-first-run … 08-dag-curve all true (9/9)
```

DOM geometry now recorded by the capture (normal board): `T4<-T1` tip `(180,62)` and `T4<-T3` tip
`(180,74)` → **12 px apart** (pre-fix capture: `(180,70)` and `(180,74)` → 4 px). cjk board: same 62/74 pair, plus
`T3<-T1` tip `(180,10)`.

## 3. The four requested visual questions

### (1) `07-team-graph-hover.png` — is the hover card beside the hovered node?

- **normal board** (`sha256 26f62e4e…3d7f4c`): **YES — the top-left defect is gone.** The card is drawn at
  ≈`x 1346–1585, y 661–767`. The hovered/clicked node is `T6`, DOM box `x 1409–1553, y 626–668`; the card is
  anchored at the pointer +14 px and clamped to the viewport's right edge, so it sits **below-left of T6**,
  overlapping T6's lower-left corner. No card at the viewport corner.
- **cjk board** (`sha256 1266a470…a55d58`): **YES.** Card at ≈`x 1326–1565, y 660–765`; hovered `T5` box is
  `x 1241–1385, y 626–668` → the card sits **below-right of T5**, overlapping its lower-right corner.
  It shows the CJK subject `构建头部与进度条`; the pinned detail body below the graph keeps the subject verbatim.
- Styling unchanged and correct: translucent white `rgba` with backdrop blur, `#111` text, dark `rgba` border,
  shadow. The card still covers a corner of its node (pointer-anchored, not edge-anchored) — acceptable as
  "beside", and no longer the (14,14) corner artifact. The built `client.js` node carries only
  `onMouseEnter` / `onMouseMove` / `onMouseLeave` / `onBlur` — the node's `onFocus` tip-anchor handler is gone
  (other `onFocus` handlers elsewhere in the client are unrelated components).

### (2) `08-dag-curve.png` / cjk `08` — are the two T4 inbound arrowheads separated (≥10 px)?

- **normal 08** (`sha256 435924df…e5fb4f`): **YES.** `report.json` tips: `T4<-T1` at y=62, `T4<-T3` at y=74 →
  **12 px apart**. The 10× crop `crops/08-t4-inbound-tips-10x.png` shows two distinct heads: the upper dark
  head (T1, inside the focus chain) and the lower pale head (T3, dimmed to opacity .4). The horizontal run
  from T3 is still faint because it is outside the hover halo, but it no longer merges with the T1 arrow.
- **cjk 08** (`sha256 52225453…ae845c`): same `62/74` pair → 12 px apart.
- Note: in BOTH 08 stills the hover card is **absent** (it was present in 07). The capture's last click in
  step 08 was on `T1` (normal), and on `T1` then `T6` (cjk); no card is visible at shot time. The exact reason
  was not instrumented (pointer/hover state after a `force` click, or a re-render clearing it) and is reported
  as an observation, not a diagnosis. The old top-left signature is absent from every 08 still; card PLACEMENT
  is proven by 07 only.

### (3) `06b-team-board.png` — stronger running glow / more visibly layered glass?

- **normal 06b** (`sha256 b77f2959…e7ea`): **YES.** `T2` (in_progress) now shows a double-ring blue halo
  (≈2 px inner + ≈9 px outer spread at the captured frame) with a blue-tinted outer shadow; pre-fix it was a
  single faint ring (`crops/06b-t2-glow-4x.png` vs the pre-fix capture).
- Glass: the node surface now reads as a gradient (bright inset highlight on the top edge, slightly blue-grey
  bottom) with a deeper drop shadow; visible at 4× and subtly at 1×. Over the flat page backdrop the
  `backdrop-filter` blur itself is still not visually provable.

### (4) cjk `06b-team-board.png` — is the completed→running dash flow readable at ~6 px?

- The built client carries no `pathLength` on the edge path (the only remaining occurrence is the repair
  comment) and the stylesheet is `.mpd-dag-flow { stroke-dasharray: 6 6; animation: mpd-dag-dash 1s linear infinite; }`.
- The cjk board's only qualifying edge is `T3<-T1` (`T1` completed → `T3` in_progress), a 24 px hop.
  Pixel scan along it: blue motion arrow at x 1049–1055, **gap x 1056–1062 (≈6–7 px)**, next stroke segment
  from x 1063 (`crops/cjk-06b-flow-dash-16x.png`). The pattern is no longer crushed to ~1.4 px.
- Honest readability bound: at 1× on this short hop the 1 px light-grey stroke reads as a faint dotted hint,
  not a bold dashed line; the blue `animateMotion` arrow is the dominant directional cue. The 6 px gap is
  measurable and clearly visible at 10–16×.

## 4. Verdict on the two reported defects

| defect | status in the stills | evidence |
|---|---|---|
| hover card parked at the viewport top-left after click/focus | **FIXED** | 07 normal + 07 cjk: card beside the node; no (14,14) card anywhere; the node's `onFocus` tip-anchor handler is gone from the built client |
| merged fan-in arrowheads into `T4` | **FIXED** | tips 12 px apart on both boards; 10× crop shows two distinct heads |

Remaining bounds (not regressions): the 08 stills carry no hover card at all, so placement is proven only by
07; the pointer-anchored card overlaps its node's corner by design; the dash flow is low-contrast on a short
light edge at 1×; the Chromium `install-deps` skip on a recreated container is still a repo-side
`docker/ui/entrypoint.sh` defect (repaired in-container only); frost/blur remains unprovable on a flat backdrop.

## 5. Inventory (sha256)

```
26f62e4ef2812ba8ef0d228913f0ad6efb69a2028a968c178444399d1c3d7f4c  ui-shots/07-team-graph-hover.png
435924df6b2d38bc726e4d40f5ab7bbcde3b5207297703331bf35ee7c8e5fb4f  ui-shots/08-dag-curve.png
b77f29599e6e515431a7765a059a842276ee6f0550b82d0cc0948ec1c073b7ea  ui-shots/06b-team-board.png
9c4b2b0897f938d5e074b7c3b980037d5328703d9611ef6a36aa3bfc6dfe2591  ui-shots/06-team-panel.png
1266a470aa244cfbd7f575261d6ea00a9329178c23bb789d570b1b30fea55d58  ui-shots-cjk/07-team-graph-hover.png
52225453db38f83064ba055b61a31345f49d098264c4f08adb510c595cae845c  ui-shots-cjk/08-dag-curve.png
```

Plus `ui-shots/{01-first-run,02-home,03-plugins,04-settings-mpd,05-settings-agent-presets}.png` (sha256 in
`ui-shots/report.json` run; same bytes as the pre-fix set for those five screens), `ui-shots/report.json`,
`ui-shots-cjk/report.json`, the two capture logs, `ui-compose-up.log`, `ui-install-deps.log`, and the
inspection crops under `crops/`.
