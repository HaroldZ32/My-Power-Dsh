# L1 — scroll engine (T1) — completion note

Lane L1 of the `tui-panel-wave` wave. Frozen contract: `.mpd/plans/tui-panel-wave.md` (§2 helper
freeze, §4 one-file-one-owner, §5.A2, §6 gates). Scope actually written:

- `packages/mpd-tui-plugin/src/panel-core.ts`
- `packages/mpd-tui-plugin/src/panel-workmate.ts`
- `packages/mpd-tui-plugin/test/panel-scroll.test.ts` (new)

NOT touched (per the captain's scope amendment and the contract's ONE-file-ONE-owner note):
`panel-watchdog.ts` (L5), `panel-dag.ts` (L2), `scenes.ts` (L3), `subagent-scene.ts` (L4),
`index.ts` / any scene file (L5). No git command was run.

## 1. What changed

### 1a. `panel-workmate.ts` — the reported "all the text disappears" (three defects, one edit each)

1. **Double slice removed.** The page sliced its own window into ONE wrapper element and handed the
   one-element array to `panelViewportBody`, which sliced it AGAIN at the same offset: at every offset
   above zero the body was empty while the footer still printed a position. It now passes the FULL
   child list plus a `rowWrapper` (`panel-workmate.ts:528` `wheelBound`, `:535` the body call — the
   same shape `panel-dag.ts:1670` and `panel-watchdog.ts:437` already use).
2. **Gutter cell reserved.** `contentCols` was `panelContentWidth(measured.cols)`; the rows and the
   one-cell rail are row SIBLINGS inside `panelViewportBody`, so the interior laid out one cell too
   wide. It is now `Math.max(1, panelContentWidth(measured.cols) - 1)` (`panel-workmate.ts:386`), the
   DAG page's own rule (`panel-dag.ts:1165`).
3. **Wheel swallowed.** The body's wheel handler called the scroller only, so one tick could reach the
   chat behind the panel. The wrapper now calls `swallowWheelEvent(event)` before `scroller.onWheel`
   (`panel-workmate.ts:528`), matching `panel-dag.ts:1658-1659`. The frame's own handler keeps its
   existing swallow (`:544`).

### 1b. `panel-core.ts` — the shared rails now move by the pointer's DELTA

- New `PanelRailAxis` / `PanelRailPhase` types and ONE new handle method
  `PanelViewport.railDrag(axis, phase, cell, travel)` (`panel-core.ts` `railDrag` on the handle).
  `start` only ANCHORS at the PRESS ORIGIN + current offset; `move`/`end` commit
  `anchor.offset + round((cell - anchor.cell) / travel * max)`. The anchor lives in two hook refs
  (`rowDrag` / `colDrag`) so it survives the re-render the first move causes — a per-render closure
  would lose it and fall back to the old jump.
- The anchor is the PRESS ORIGIN, not where `dragstart` fires: measured against the installed host
  (`lib/types/ink/events/drag-event.js`), a drag session "stays dormant until the first drag motion —
  `dragstart` fires then", so that event's `localRow` is already a cell or more from the finger-down
  point. `localStartCell` derives the press cell from the event's absolute pair (`localRow +
  (startRow − row)`, the host's own `localRow = row − rect.y` relation), so the gesture's first motion
  is counted instead of dropped — a one-cell drag moves one step. Events without those absolute fields
  (hand-driven rails) anchor at their own local cell.
- `viewportGutter` (`:1281`, scrub `:1305`) and `viewportRail` (`:1353`, scrub `:1373`) bind phase
  handlers instead of wiring the same absolute commit into all three. A page callback
  (`onTrackClick`) still owns its own mapping for click AND drag; a CLICK still maps ABSOLUTELY through
  `railOffset` (unchanged semantics), which is also the documented fallback for a drag whose `start`
  never arrived (a hand-driven rail).
- **Frozen signatures untouched**: `usePanelViewport`, `panelViewportBody`, `clampScroll`,
  `gutterCells`, `gutterCellsX`, `viewportGutter`, `viewportRail`, `railOffset`, `railTravel`,
  `localCell`, `panelContentWidth`, `panelScrollGesture`, `useRunningPhase`, `usePanelTick`, `textRow`,
  `panelFrame`, `panelText`, `clampRowSpans`, `swallowWheelEvent`, `normalizeWheelDelta` — no rename,
  no reorder, no removed parameter, no changed parameter meaning. The only addition is the new
  `railDrag` member on the returned handle (existing call sites compile unchanged).

## 2. Unit tests — FAIL before, PASS after

`packages/mpd-tui-plugin/test/panel-scroll.test.ts` (new, 7 tests, one per defect plus a negative control):

| arm | defect it pins | pre-fix | post-fix |
|---|---|---|---|
| (a) body at offset 1 | empty body (double slice) | FAIL | PASS |
| (a) NEGATIVE CONTROL | the OLD one-element call shape empties the body (reproduced on the current helper) | PASS (control) | PASS |
| (b) interior − 1 | 38-cell rows beside the rail at 40 columns | FAIL | PASS |
| (c) vertical grab | absolute map commits 60 where the press origin says 45; a one-cell drag must move one step, not jump | FAIL | PASS |
| (c) horizontal grab | absolute map commits 80 where the press origin says 77; a one-cell drag must move one step, not jump | FAIL | PASS |
| (d) body wheel | `stopPropagation` never called | FAIL | PASS |
| (d) frame wheel | pinned chrome stays contained (existing behaviour) | PASS | PASS |

How the red evidence was produced WITHOUT shipping the defect: the two source files were backed up,
the four pre-fix hunks were re-applied mechanically (the exact inverse of the fix), the SAME final test
file was run, and the fixed files were restored byte-identically (sha256 verified against the backup).
The exact reverted hunks are in `red/reverted-hunks.patch`.

Commands and observed results (logs under `evidence/tui/panel-wave/l1-scroll-engine/`):

```
$ bun test packages/mpd-tui-plugin/test/panel-scroll.test.ts     # pre-fix code, final tests
 2 pass / 5 fail        exit 1        red/panel-scroll-red.log
$ bun test packages/mpd-tui-plugin/test/panel-scroll.test.ts     # fixed code
 7 pass / 0 fail        exit 0        green/panel-scroll-green.log
```

## 3. Gates

| gate | command | observed |
|---|---|---|
| package tests (§6) | `bun test packages/mpd-tui-plugin` | **661 pass, 0 fail, 1 skip** — 662 tests / 29 files, exit 0 (`full-suite.log`) |
| typecheck (§6) | `bun run typecheck` | **exit 0, no errors** (`typecheck.log`). An earlier snapshot had one error in L3's `test/scene-scroll.test.ts`; L3 fixed it, and this lane's three files never reported one |
| comments (§6) | `node scripts/verify-comment-coverage.ts --file <each of my 3 files>`; then the repo-wide run | **3 × PASS** (`comments-scoped.log`); the repo-wide run is **PASS** too at this snapshot (`comments-repo.log`). Earlier repo-wide snapshots had violations only in other lanes' files (`scripts/verify-tui-admission.ts` L7, `test/subagent-rows.test.ts` L4) |
| docs (§6) | `bun run verify:docs` | not run — this lane changed no doc |
| dist freshness | — | INT's by contract §4 (a lane `src` edit reddens it by design) |

The package suite and the root typecheck were both green at the time of this note (2026-11-06 ~23:44
+08). Other lanes edit the same checkout, so INT's full sweep remains the authoritative final run;
this lane's targeted suites were also run individually and green: `panel.test.ts` 23/23,
`panel-dag.test.ts` 85/85, `panel-legend-mount.test.ts` 5/5, `panel-visibility.test.ts` 44/44,
`panel-scroll.test.ts` 7/7.

## 4. Certification pass — every scroll site (contract §5.A2 / D6)

Audit snapshot: 2026-11-06 23:41 +08 (line numbers are the state at that moment; `scenes.ts` and
`subagent-scene.ts` were being edited by L3/L4 concurrently, so symbols are cited alongside lines).

| site | owner | disposition | evidence (file:line) |
|---|---|---|---|
| **vertical gutter** (sidebar pages) | L1 — mine | **FIXED** | `panel-core.ts` `viewportGutter:1281`, `railDrag:1145`; the reservation now matches on the workmate page (`panel-workmate.ts:386`) |
| **horizontal rail** (sidebar + DAG page) | L1 — mine | **FIXED** | `panel-core.ts` `viewportRail:1353`, `railDrag:1145`; the DAG page consumes it at `panel-dag.ts:1552-1561` |
| **workmate sidebar page** | L1 — mine | **FIXED** | double slice `panel-workmate.ts:528-535`; gutter `:386`; wheel `:528` |
| **watchdog sidebar page** | L5 | **REPORTED — NOT EDITED** | defect: `panel-watchdog.ts:264` `contentCols = panelContentWidth(measured.cols)` — no gutter cell subtracted (same class as the workmate defect this lane fixed; the DAG page subtracts it at `panel-dag.ts:1165`). Its body/wheel shape is already the repaired one (`panel-watchdog.ts:428` `wheelBound` with `swallowWheelEvent`, `:437` `panelViewportBody(kit, children, viewport, true, wheelBound)`), and its rails are the shared `panel-core` ones, so the delta fix reaches it without an edit. L5 owes the one-line width fix. |
| **DAG sidebar page** | L2 | **CERTIFIED — no defect in this class** | gutter reserved (`panel-dag.ts:1165`); full-list + `rowWrapper` body (`:1670`); wheel swallowed (`:1658-1659`); vertical gutter from `panel-core` and horizontal rail from `core.viewportRail` (`:1552-1561`) — both now delta-driven |
| **team scene** (`mpd-tui-team`) | L3 | **CERTIFIED — repaired in L3's lane** | whole body windowed, not just the drawing: `scenes.ts` `windowedBody:515`, call `:1299`; vertical rail `gutterColumn:487` + `gutterCells`; horizontal rail `gutterCellsX:1071`; wheel normalises both deltas `:1275` (scroll state `:837`, clamp `:1173`). This lane's `gutterCells`/`gutterCellsX` are the shared helpers, unchanged |
| **merged board scene** (`mpd-tui-board`) | L3 | **CERTIFIED — repaired in L3's lane** | it HAD no scroll at all (contract §3 audit item); it now windows its own lines and binds a wheel: `scenes.ts` `createBoardComponent:550`, `scrollState:616`, `scrollMax:666`, `onWheel:754`, `windowedBody(...):768`. At my first read (23:30) this component had zero scroll references; L3 landed the fix at 23:40 |
| **subagents scene** (`mpd-tui-subagents`) | L4 | **CERTIFIED, with one REPORTED observation** | horizontal rail present and shared (`subagent-scene.ts:1478` `gutterCellsX`); the DAG's vertical window starts at `graphYAt` (`:1462`) but the loop is UNCAPPED (`index < view.lines.length`), so the rows below it are host-clipped, and there is NO vertical scrollbar (`gutterCells` is not imported here) and NO `onWheel` handler — the scene scrolls the DAG and the detail by keys only (`:1256`, `:1260`, key hint at `:857` "↑↓ scroll"). Not the sidebar defect class; reported to L4 as an observation, not edited. NOTE: the file was being rewritten by L4 during this audit; these lines are the 23:41 state |
| **teammates scene** | — | **N/A — no such scene id exists** | registered ids are `mpd-tui-board`, `mpd-tui-team`, `mpd-tui-plan` (`scenes.ts:80-84`, registrations `:1831-1833`) plus the subagents scene. The teammates surface is the team scene's roster section, drawn inside that scene's now-windowed body (`scenes.ts:1051-1053` roster chunks feed `head`), so it is covered by the team-scene row above |
| **plan scene** (`mpd-tui-plan`, extra observation) | L3 | **REPORTED — not in D6's list** | a scrollable full-screen body with NO visible scrollbar: `scenes.ts` `createPlanComponent:1356`, `scrollState:1435`, `visible = body.slice(scroll, scroll + measured.window):1700`, no `gutterCells` anywhere in the component. Same class as the team scene's missing rail; L3 owns `scenes.ts` |

## 5. Honest bounds

1. **No live TTY capture** of any of this. The proof is unit-render against a host-kit double plus the
   package suite; no rendered terminal frame is claimed (contract §7.1).
2. The **watchdog page's gutter cell is still open** (L5): reported above, not edited — the contract's
   ONE-file-ONE-owner rule forbids this lane touching it.
3. The **subagents scene's missing vertical scrollbar / uncapped graph window** is a finding for L4,
   outside this lane's scope and acceptance criteria.
4. The **plan scene's missing scrollbar** is an observation for L3; D6 did not list it.
5. The full-package suite and typecheck results are a snapshot while L3/L4 still edit their files;
   INT's sweep is the final word. At this snapshot both were green.
6. `railDrag` is a NEW member on `PanelViewport`; that is additive, but a verifier should confirm no
   page constructs a `PanelViewport` literal (none does — `usePanelViewport` is the only producer).

## 6. Evidence

`evidence/tui/panel-wave/l1-scroll-engine/`

- `red/panel-scroll-red.log` — final tests against the pre-fix code: 2 pass / 5 fail
- `red/reverted-hunks.patch` — the exact pre-fix hunks the red run used
- `green/panel-scroll-green.log` — final tests against the fixed code: 7 pass / 0 fail
- `full-suite.log` — `bun test packages/mpd-tui-plugin`: 660 pass, 0 fail, 1 skip
- `typecheck.log` — root typecheck: one error, outside this lane
- `comments-scoped.log` — the three lane files: 3 × PASS
- `comments-repo.log` — repo-wide comment gate: violations only in other lanes' files
