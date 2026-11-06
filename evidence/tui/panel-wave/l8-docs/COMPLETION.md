# L8 — documentation (T8) — completion note

Lane L8 of the `tui-panel-wave` wave. Frozen contract `.mpd/plans/tui-panel-wave.md` (§4 L8 scope, §5
acceptance, §7 honest bounds). The English and 简体中文 twins move in the SAME change, as the language
policy and `bun run verify:docs` require.

## 0. What was read before writing

The contract AND every lane's completion artifact, because this lane documents what LANDED, not what
the contract hoped for:

- `evidence/tui/panel-wave/l1-scroll-engine/COMPLETION.md` (rail delta drag, workmate page, audit table)
- `evidence/tui/panel-wave/l2-dag-page/report.md` + `result.json` (toggle, 350 ms gesture, sidebar call site)
- `evidence/tui/panel-wave/l3-scene-scroll/README.md` (windowed body, rail, running animation, board scene)
- `evidence/tui/panel-wave/l4-row-lifecycle/signatures.md` + `result.json` (row builder, burn arms, ages)
- `evidence/tui/panel-wave/l5-watchdog-scene/report.md` (the scene, the shared body, the routed line)
- `evidence/tui/panel-wave/l6-web-follow/result.json` (web ended-team treatment + relative age)
- `evidence/tui/panel-wave/l7-admission-gate/evidence.md` (the admission gate; `verify:gates` now TEN)
- `evidence/tui/panel-wave/audit-parked/result.json` (two sites PARKED, never to be counted fixed)

## 1. What changed

### 1a. `docs/tui.md`

| Location | Change |
|---|---|
| §3 seam inventory (after the "0.14.0 changes none of the fifteen" paragraph) | NEW paragraph: this wave moved NOTHING on the inventory — still fifteen seams, no sixteenth, the adapter's counted host-internals contacts still **two** (`Ctrl+A` `useStdin` + the side-panel CSV/feed contact), because the wave reached no host internal. Names the declared seams it used (`tuiScenes`, `tuiPanels`, `tuiCommandTrees`) and points at §11.12 for the Agent View bound |
| §3.3, the watchdog page paragraph | The page now HAS a full-screen twin: `mpd-tui-watchdog` (`src/scene-watchdog.ts`), the SAME body through `watchdogBodyRows` / `watchdogAckPress` (with the equal-body-rows unit arm), its keys/rail/footer/timer discipline, the page's `⤢` → `openFullscreen`, and the routed fallback: `/mpd watchdog` prints the scene's success line instead of the old absence line (the knob-off case still names the knob and opens nothing). Old "no full-screen fallback" claim removed |
| §3.3, routing paragraph | `/mpd watchdog` is no longer "the one page with no full-screen surface behind it"; its routed fallback is the watchdog scene, stated inline and again at the end of the paragraph |
| §3.4, after the intro | NEW paragraph: the subagent rows — ONE builder (`subagent-rows.ts`), the compact `<glyph> <description> · <status> · started\|ended <age>` grammar, `<1s`/`Ns`/`Nm`/`Nh`/`Nd`, no `mode` and no ISO instant, the two burn arms (60 s grace; ended-team name match), never-hidden cases, the "cannot ask did-MPD-spawn-this" bound, and the plain statement that this is a PROJECTION over the host's append-only catalog with NOTHING deleted from disk (and no subagent-row surface on the web plane) |
| §3.4, after the `⤢` paragraph | NEW paragraph: the full-screen twin — whole body below the pinned head windowed, visible one-cell vertical rail from `gutterCells` (overflowing body re-drawn one column narrower), running markers animated on the scene's own clock through `DAG_ANIM.runningFrames`, host frame loop `null` when idle, the merged board scene gaining the same window+rail, plus the bounds (pinned head not windowed; no live TTY capture) and the two PARKED sites |
| §3.4, gesture bullets | The one-way "second click opens the work page" bullet became the TOGGLE + synthesized 350 ms double-click bullet, naming `DAG_DOUBLE_CLICK_MS`, `agentIdForOwner`, the 0 `onDoubleClick` measurement, and the Agent View bound (`agentViewStore` not in the exports map, `tuiPanels.open('agents')` owner-checked, no new host-internal contact). The drag bullet's "SAME absolute track arithmetic" became the DELTA rule (`railDrag`, press-origin anchor, `anchor.offset + round((cell − anchor.cell) / travel * max)`, click keeps the absolute map) |
| §10 NOT-CLAIMED | NEW item 12: the HOST's own Agent View is not reachable from a plugin (a declared product bound, no contact added) |
| §11.12 (new) | The wave's amendment: a before/after table (watchdog scene, toggle + gesture, delta drag, compact/burning rows, team-scene window+rail+animation, unchanged seam/contact inventory, NOT-CLAIMED 11→12) and the honest bounds, with every evidence path |

### 1b. `docs/tui.zh-CN.md`

Every one of the above mirrored in 简体中文 in the same change, including §11.12's table and bounds. The
heading tree is unchanged apart from the added `### 11.12` in both languages.

### 1c. `packages/mpd-tui-plugin/README.md`

| Location | Change |
|---|---|
| "What it provides" — team scene row | gained the windowed whole body, the visible vertical rail, and the running animation with the paused-when-idle frame loop |
| "What it provides" — NEW watchdog scene row | `mpd-tui-watchdog`: the shared body, the page's `⤢`, the routed fallback, the keys, the 2 s read |
| "What it provides" — merged panel row | gained the ONE row builder, no `mode`, relative ages, the settled-row projection (nothing deleted) |
| "What it provides" — sidebar pages row | the fallback list gained `mpd-tui-watchdog` for `/mpd watchdog` ("it used to be the one page with no surface behind it") |
| Sidebar section, after the BODY paragraph | NEW paragraph: the rows — one builder, compact grammar, burn arms, projection/append-only bound |
| AC6 bullet | rewritten as click toggles + 350 ms synthesized double-click, with the Agent View bound |
| AC7 bullet | rewritten: drags move by DELTA, click stays absolute |
| "How a user actually reaches a page" + NOT CLAIMED #16 | corrected the stale "two surviving ids / no third one" to the THREE current ids (`team`, `workmate`, `watchdog`) — the watchdog wave had left that sentence behind |
| NOT CLAIMED | NEW item 20: the host's Agent View is not reachable from a plugin |

### 1d. `packages/mpd-tui-plugin/README.zh-CN.md`

The same five table/paragraph changes, the AC6/AC7 rewrites, both stale-id corrections and item 20, in
简体中文, in the same change.

## 2. Gate

```
$ bun run verify:docs
[verify-docs-parity] root=… pairs=56 failed=0 violations=0 exempt=24 derived=3 links=540 dead=0 — PASS
EXIT=0        log: evidence/tui/panel-wave/l8-docs/verify-docs.log
```

The gate enforces the pair, the switch link, the heading tree, real CJK content and the resolution of
relative link targets — the four files are the only ones this lane modified
(`git status --porcelain` on the four paths shows exactly them; no source file, no `docs/tui-admission.md`).

## 3. Where a lane NOTE contradicted the contract (the note wins, and is what the docs say)

1. **The scene kit DOES expose an animation clock.** Contract §3 said `useRunningPhase` reads
   `useAnimationTime`, "which the SCENE kit does not expose", so a scene-side animation "must go through
   `useSurfaceClock` / `runningGlyph` / `animPhase`". L3 landed `useSceneClock(ui, live)`, which uses the
   scene kit's own `useAnimationFrame` pair and falls back to `ui.useAnimationTime`; the glyph work still
   goes through `runningGlyph`/`runningMarker` + `animPhase`. The docs say the animation runs "on the
   scene's own clock through the same frame table", which is what the code does, and they do NOT claim
   `useRunningPhase` is imported.
2. **The whole body is windowed only BELOW the pinned head.** Contract §5.A4(b) says "the whole scene body
   is windowed"; L3's note and the contract's own bound §7.8 say the pinned head is not. The docs use the
   note's wording ("the whole body below the pinned head") and state the clipping bound.
3. **The watchdog page's defect was not the suspected double slice.** L1's completion suspected a double
   slice on the watchdog page; L5 measured two DIFFERENT defects (a missing gutter cell and a height
   budget off by the frame's two border rows) and reproduced them before editing. No doc claim rests on
   the L1 reading; the docs describe the shared body and the scene, not the defect history.
4. **`verify:gates` is TEN members, not nine** (L7). `docs/tui.md` never states the count, so no edit was
   needed here; the AGENTS.md §4 sentence still says nine and remains the captain's to amend (L7 flagged
   it, and AGENTS.md is outside every lane's write scope).

## 4. Honest bounds of this lane

1. Every behavioural statement in the docs rests on the lane artifacts above (unit-render against a
   host-kit double, the package suite, typecheck, the comment gate). **No live TTY capture was obtained
   by any lane of this wave**, so neither this lane nor the docs claim a rendered terminal frame, a real
   animation frame, a real mouse drag or a real double-click on a pane — the §11.12 amendment says so
   explicitly.
2. `docs/tui-admission.md` belongs to L7 and was NOT touched; the new admission gate is named only where
   the wave's own record needs it (the §11.12 evidence list), never described there in L7's place.
3. This lane ran no git command; the diff is uncommitted for the captain, the single git writer.
4. The two PARKED sites are stated as parked in both the team-scene bounds and §11.12; no document of
   this lane says they are fixed.

## 5. Evidence

`evidence/tui/panel-wave/l8-docs/`

- `verify-docs.log` — the gate's full output, `— PASS`, exit 0
- `result.json` — the machine-readable summary (files, sections, gate, bounds, contradictions)
- `COMPLETION.md` — this note
