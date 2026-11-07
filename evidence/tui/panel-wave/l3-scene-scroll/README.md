# L3 — team scene window: visible scrollbar, whole-body reachability, running animation

Lane L3 of `feature/tui-panel-wave` (frozen contract `.mpd/plans/tui-panel-wave.md`, §5.A4; user clause 4:
「独立主面板的 DAG 图如果上下超长会显示不全且没有滚轴，并且主面板没有运行动画」).

Write scope used: `packages/mpd-tui-plugin/src/scenes.ts`,
`packages/mpd-tui-plugin/test/scene-scroll.test.ts` (new). `scene-visuals.test.ts` was NOT modified — no
existing arm needed re-baselining.

## What changed

`scenes.ts` — `createTeamComponent` (scene `mpd-tui-team`), plus the board scene's audit repair:

1. **The body is one window, not one drawing slice.** `drawAt(contentCols)` now returns the pinned header,
   the rows BELOW the drawing (rail, legend, state key, detail, problems, notice) and a per-row drawing
   builder. The vertical offset is clamped over `graphLines + tail.length` against the terminal's real row
   count (`measured.rows − 2 border − header − 1 footer`), so the last row of the scene body is reachable.
   Previously only `view.lines` was sliced; roster/legend/detail/footer were pushed unconditionally and the
   host clipped them.
2. **A visible vertical scrollbar**, drawn from the FROZEN `gutterCells` helper (`panel-core.ts`, signature
   untouched) as a one-cell column beside the body (`windowedBody` / `gutterColumn` in `scenes.ts`). The
   rail appears only when the content overflows; the thumb tracks the clamped offset.
3. **The gutter owns a column.** Because a rail costs a cell, an overflowing body is re-drawn ONE COLUMN
   NARROWER (`drawAt(measured.cols - 1)`) so the drawing/roster/legend never exceed the frame's interior.
   A body that fits renders through the original width and is byte-for-byte what it was before.
4. **Running markers animate on the scene's OWN clock.** `useSceneClock(ui, live)` mirrors
   `subagent-scene.ts`'s `useSurfaceClock` but passes `null` (the documented PAUSE) when nothing runs;
   `phase = animPhase(clock.time)`; `runningGlyph(phase)` advances the drawing's contract glyph exactly as
   `panel-dag.ts` does (first occurrence, running spans only), and the roster's running member uses
   `runningMarker(phase)` — the same `DAG_ANIM.runningFrames` table. `useRunningPhase` is NOT imported.
5. **Board scene audit (FIXED in this file).** `createBoardComponent` had NO scroll at all: every
   `boardLines` row was pushed and the host clipped the tail. It now owns an offset state, answers
   `⇧↑↓ / PgUp / PgDn / Home / End` plus the wheel (through `normalizeWheelDelta`/`wheelInvertOn`), and
   draws through the same `windowedBody`/`gutterCells` rail. Its title/meta/rule and footer stay pinned.

## Audit lines for the two other scenes (contract §5.A4 item 5)

- **Merged board scene (`mpd-tui-board`, `scenes.ts` `createBoardComponent`) — FIXED.** It had no scroll:
  the body was `rows.map(surfaceBodyRow)` pushed unconditionally under three pinned chrome rows. Fixed by
  the window + rail described above (item 5). Proven by
  `test/scene-scroll.test.ts` → "the merged board scene windows its body too": at 100×12 the board draws a
  `gutterCells` rail, the first line ("workspace") is on screen at the top while "workmates" is not, `End`
  reaches "workmates", and the rail's cells change between the two offsets.
- **Merged subagents/teammates scene (`mpd-tui-subagents`, `subagent-scene.ts`) — CERTIFIED (not fixed;
  that file is lane L4's scope, contract §4).** It windows the DAG on both axes — the vertical offset is
  `subagent-scene.ts:1087-1091`, clamped at `:1167` (`dagYMax`), applied at `:1460-1471` — and it draws the
  horizontal rail from `gutterCellsX` at `:1478`. It has NO whole-body vertical gutter: only
  `gutterCellsX` is imported (`:95`), and every non-graph row (team rows, legend, detail, hints) is pushed
  into `children` after the drawing with no window, so on a short terminal the host clips those rows with
  no rail to say so. That is the same defect class this lane fixed in `scenes.ts`; it is reported to L4 /
  the captain as a finding rather than edited across the scope boundary.

## Windowed rows, stated exactly

Pinned (never scroll): team scene — title, optional `scope`, tally, roster chunks, optional `hold`, the
`task dependency graph` header, and the key-hint footer. Board scene — title, meta, rule, footer.
Windowed: team scene — the DAG drawing rows and every row below it (horizontal rail, legend, state key,
detail, problems, notice). Board scene — every `boardLines` row.

## Gates (observed)

| Gate | Command | Result |
|---|---|---|
| Package tests | `bun test packages/mpd-tui-plugin` | **662 pass, 0 fail**, 1 pre-existing skip (`EXIT=0`) — `tests.log` |
| Typecheck | `bun run typecheck` | `tsgo --noEmit`, no output (`EXIT=0`) — `typecheck.log` |
| Declaration comments | `bun run verify:comments` | `VERDICT: PASS — every declaration … full signature` (`EXIT=0`) — `comments.log` |

The new `test/scene-scroll.test.ts` (6 arms) proves the contract's three unit-test demands: different
rendered rows at offset 0 vs `End` (and the composed state-key's last line is the window's last body row);
scrollbar cells differ between two offsets with the thumb moving down; two phases (0 and
`DAG_ANIM.intervalMs`) draw different glyphs for a running row through `DAG_ANIM.runningFrames`. It also
asserts the host frame loop is `null` (paused) when nothing runs and `DAG_ANIM.intervalMs` when a task runs.

## Honest bounds

- **No live TTY capture** (contract §7.1). The proof is a rendered element tree from a host double, the
  package suite and the gates — a real terminal frame is not claimed.
- The board scene's window is proven at 100×12 (the board's ~10 lines overflow a 12-row terminal). Its
  scroll gestures are exercised through the scene's registered key handler; a live wheel over a real board
  is not captured.
- `dist/` was not rebuilt and `manifest`/`dist-fresh` were not run: `packages/*/dist/**` is the INTEGRATION
  task's derived surface (T-88), and this lane's `src` edit reddens `verify-dist-fresh` by design.
- The merged subagents scene's clipping is CERTIFIED, not fixed (its file belongs to L4).
