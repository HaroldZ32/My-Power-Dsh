# L2 — DAG page: focus toggle, synthesized double-click, compact row call site

Task T6, contract `.mpd/plans/tui-panel-wave.md` §5.A7 + §5.A8, decisions D3/D4.
Companion artifact: `output.log` (raw gate output) and `result.json`.

## What changed

`packages/mpd-tui-plugin/src/panel-dag.ts`

- **Import** — the section rows now come from `subagent-rows.ts`
  (`subagentRowFilter`, `subagentSectionRows`, `type SubagentSectionRow`); `surfaceRule` still comes from
  `subagent-scene.ts`. No second row builder exists on this page.
- **`DAG_DOUBLE_CLICK_MS`** — the frozen 350 ms window, exported and pinned by a test.
- **`lastClick`** — a live `useRef` recording the node the last FOCUSING click pinned and its
  `Date.now()` instant. A ref for the same reason the pin and the cursor use one: the second click may
  arrive at a handler born in an earlier render.
- **The click handler** —
  - blank click: clears the pin and forgets the gesture (unchanged clearing, plus the gesture reset);
  - click on an UNFOCUSED node: pins it (pin + keyboard cursor) and remembers the instant;
  - click on the FOCUSED node: **unpins it** (clause 8 — the toggle's other half), clearing the keyboard
    cursor only when it names the same node so the `▶` the click set is not left behind;
  - click on the SAME node within 350 ms: **synthesized double-click** (clause 7) — the toggle is undone
    and `openAgentPage` is called through the existing `openAgentWorkPage` (owner resolved at click time).
- **The section call site** — `subagentSectionRows(panelSnapshot(host), subagentRowFilter(workflow, sessionId, now))`.
  The sidebar's burn projection is therefore **on**, with ONE render clock shared by the grace window and
  every relative age. This is what draws L4's compact rows (no `mode`, `Ns/Nm/Nh/Nd` ages).

## Tests

- `panel-dag.test.ts` — `withClock(at, body)` pins `Date.now` for one arm and restores it in `finally`, so
  the gesture is deterministic instead of scheduler-dependent. New arms: the constant is 350; click →
  focus, +400 ms → unfocus; +300 ms → undo + open; +351 ms → unfocus and NO open. The pre-existing AC6 arm
  was corrected: the jump now RELEASES the pin it consumed (it used to assert the pin was kept).
- `panel.test.ts` — `DONE_ROW` now ends 30 s before load, i.e. inside the 60 s grace window. The burn rule
  stays enabled; the arm keeps its meaning instead of being unfiltered.
- `panel-legend-mount.test.ts` — the walk's 150 ms settle plus consecutive drawing rows of one box meant
  consecutive clicks hit the SAME node, so the new gesture fired inside a key-stability arm. The walk now
  shifts the clock 400 ms per drive (restored in `finally`), and key uniqueness is asserted PER RENDER —
  the sibling list React actually keys. No assertion was loosened: every recorded render must carry the
  full legend with distinct keys, and every render that draws the pin body must key its rows distinctly.
  Measured: after the clock shift the walk still draws the pin body in TWO renders (the toggle: pin,
  release, pin, release) — reported rather than papered over; the concatenated form only passed before
  because a no-state-change click made React bail out and created no elements.

## Gates (observed)

| command | result |
|---|---|
| `bun test packages/mpd-tui-plugin` | 665 pass, 1 skip, 0 fail (666 tests, 29 files), exit 0 |
| `bun run typecheck` | `tsgo --noEmit`, exit 0 |
| `bun run verify:comments` | VERDICT: PASS — 609 files / 54307 declarations, exit 0 |

## Honest bounds

1. **What clause 7 opens is MPD's own subagent page** (`openAgentPage` → `mpd-tui-subagents`). The HOST's
   Agent View is not reachable from a plugin: `agentViewStore` is not in the host's exports map and the
   panel opener is owner-checked. No host-internal contact was added, and no surface claims otherwise.
2. The gesture is synthesized from `Date.now()` deltas; two clicks must resolve to the SAME node.
3. The burn is a draw-time projection — nothing is deleted from disk.
4. No live TTY capture of the gesture; proof is unit-render + typecheck (contract §7.1).

## Scroll audit (report only — the engine is L1's lane)

No page-local defect found on this page. `contentCols` reserves the gutter cell
(`panelContentWidth(...) - 1`, pinned by the suite's "gutter's cell is reserved" arm),
`swallowWheelEvent` is bound both on the visible row slice and on the frame, and the body is drawn by
`panel-core.ts`'s `panelViewportBody`. The pointer-drag/offset mapping is core's `viewportRail`, which L1
repairs; this page consumes it and has a one-line visual fallback for the horizontal rail only.
