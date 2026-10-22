# Wave `tui-refresh` — evidence (branch `fix/tui-refresh`, base `46e3bf12`)

Contract: `.mpd/plans/tui-refresh.md`. Scope: `packages/mpd-tui-plugin` (+ its README pair,
`docs/tui{,.zh-CN}.md`, `agent-references/troubleshooting.md`). No git write commands were run.

## What changed, by symbol

| File | Symbol | Change |
|---|---|---|
| `src/panel-dag.ts` | `DAG_PANEL_REFRESH_MS` | 1000 → **2000** (the only MPD surface not on the shared cadence) |
| `src/panel-dag.ts` | `boxesFitPanel` (new) | a boxed drawing is chosen only when `width <= interior` AND `lines <= window` |
| `src/panel-dag.ts` | `dagPanelLayout` | uses `boxesFitPanel`; otherwise rail (or dense list on a busy board) |
| `src/panel-dag.ts` | `halfBoxRows` (new) | the drawing rows to leave blank because their box would straddle the window edge |
| `src/panel-dag.ts` | `dagFooterText` (new) | position first (vertical, then `col n/m`), compact hints; 26-cell safe |
| `src/panel-dag.ts` | `createDagPanelComponent` | window = `rows − (borders 2 + title 1 + footer 1)`; gutter cell reserved out of the content width; frame title dropped (title drawn once); wheel bound on the frame; section rule renamed `team DAG` |
| `src/panel-core.ts` | `PANEL_FRAME_BORDER_ROWS` (new), `panelFrame(…, options)`, `swallowWheelEvent` (new) | the frame's two border rows as a named constant; a frame-level wheel handler that stops propagation |
| `src/scenes.ts` | `createTeamComponent` | `scrollMax`/`scrollAt` derived per render and used by the render loop, both `hitTest`s, the wheel, `⇧↓/j`, `PgDn`, `End`, `Home` |
| `src/panel-workmate.ts` | `createWorkmatePanelComponent` | frame-level wheel containment (the sidebar's second page had the same hole) |
| `src/panel.ts` | comment | the cadence note now says 2000 ms |
| `docs/tui.md`, `docs/tui.zh-CN.md` | §3.5 (new) | refresh cadence, boxes-fit rule, `Ctrl+L`, `r`/`Home`/`g`, `DSH_TUI_DISABLE_MOUSE=1`, tmux/TERM/locale/font, clamped sidebar wheel |
| `agent-references/troubleshooting.md` | table row (new) | the same symptoms, one row |
| `README.md`, `README.zh-CN.md` | cadence + scrolling bullets | 1000 ms claims corrected; the fit rule and the chrome-wheel containment stated |

## Gates (all run from the repo root, pinned bun 1.4.0 at `.toolchain/node_modules/.bin/bun`)

| Command | Exit | Observed |
|---|---|---|
| `.toolchain/node_modules/.bin/bun test packages/mpd-tui-plugin` | 0 | `534 pass / 0 fail`, 21 files, 13,878 expect() calls, 12.38 s |
| `.toolchain/node_modules/.bin/bun run typecheck` | 0 | `$ tsgo --noEmit` (no diagnostics) |
| `.toolchain/node_modules/.bin/bun run verify:comments` | 0 | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.` |
| `.toolchain/node_modules/.bin/bun run verify:docs` | 0 | `pairs=49 failed=0 violations=0 links=440 dead=0 — PASS` |
| `node scripts/verify-dist-fresh.ts` | 0 | `ok: 33/33 targets fresh (each rebuilt twice, byte-identical)`; 1 NOT COVERED prebuilt (`mpd-mcp-codegraph/dist/serve.js`) |
| `.toolchain/node_modules/.bin/bun run verify:gates` | 0 | `PASS - 9/9 member gate(s) green` |
| `.toolchain/node_modules/.bin/bun run test:qa` | 0 | `[test:qa] all self-tests passed` |

Build: `.toolchain/node_modules/.bin/bun build packages/mpd-tui-plugin/src/index.ts --target node
--format esm --outfile packages/mpd-tui-plugin/dist/index.js` → `Bundled 36 modules`, exit 0.

## Black-box probe (`probe.ts`, package exports only)

```
cadence DAG_PANEL_REFRESH_MS=2000
cols=26 mode=rail width=26 rows=4 drawn: T1=true T2=true T3=true T4=true
cols=36 mode=boxes width=36 rows=9 drawn: T1=true T2=true T3=true T4=true
title section="team DAG"
height budget: frame=2 title=1 footer=1 => window=rows-4
footer both windows (first 26 cells): "1/31 col 1/12 · ⤢ full · ↑" cells=26
footer no window: "⤢ full · ↑↓/jk · ⏎ pin · esc · ⇧↑↓←→"
```

## Test arms added / re-pointed

Added (all in `packages/mpd-tui-plugin/test/panel-dag.test.ts` unless noted):
- `tui-refresh · the 2 s cadence` — constant assertion + REAL HOST CLOCK (intercepts `setInterval`,
  asserts the page schedules 2000 (never 1000) and that the callback fires inside a 2200 ms wait).
- `boxes are chosen only when the drawing fits the interior` — 3-sibling rank at 26 cells → rail with all
  four ids drawn, positive control at 36 → boxes; plus an invariant sweep over boards/widths/heights.
- `the page's height budget` — total rows == measured at 10/12/24/40; the gutter cell is reserved.
- `the title is drawn once` — exactly one `MPD`, on the title row, frame carries no border title.
- `the footer keeps where you are` — both windows at 26 cells; the page's own footer starts with the
  position when it overflows.
- `the vertical window never draws a half box` — `halfBoxRows` at three window placements + a page arm.
- `team-surface.test.ts` — far-edge `End` (last task visible, first gone, a 200-tick wheel run
  reproduces the same frame, `Home` returns byte-identically); `⇧↓`/`PgDn` clamp to the same maximum.

Re-pointed because the contract changed the behaviour they asserted (each carries a comment saying why):
`A REAL BOARD STILL DRAWS BOXES` (row budget 24 → 30; 24 now asserts the vertical fallback), the
animation arm (taller panel so the 12-rank fixture stays boxed), `the WHEEL IS BOUND TWICE`, the R6 frame
arm (workmate only — the DAG frame is title-less by design), T2 labels (`team DAG`), the two AC8b hint
arms (`⤢ full`), the T-P2a tick arm (1200 → 2200 ms), and the panel empty-state needle (one cell
narrower interior).

## Bounds / not proven

- **No real-terminal capture.** The 485×630 sidebar was not re-captured on a PTY: the layout, row, gutter,
  title and wheel facts are proven by the host-double arms and the probe above, not by a repainted screen.
- The whole-box boundary uses the previous render's row counts (one tick of convergence after a
  content-size change), and the very first render of a freshly mounted page has no bar to reserve.
- The horizontal window is now **unreachable** on the DAG page (a boxed drawing must fit the width), so
  its rail and `col n/m` token are exercised by unit arms only.
- `panel-workmate.ts` keeps its pre-wave height budget and full-width content (the same
  off-by-one/1-cell-overflow class as the DAG page). Only its frame wheel was added — the rest is a
  reported finding, not a change.
- The plan scene's `setScroll(scroll + 1)` remains unbounded (it has no `End` key and `slice` keeps it
  harmless). Outside this contract.
- The browser sidebar's partial-load fix is explicitly out of scope in the contract and untouched.
