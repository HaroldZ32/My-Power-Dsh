# L5 — the standalone watchdog scene, one shared body, and the page's own scroll defects

Task T7. Contract `.mpd/plans/tui-panel-wave.md` §5.A3, plus the §4 one-file-one-owner note.
Companion artifacts: `output.log` (gates + the pre-fix reproduction), `reproduction-prefix.log` (the raw
red run), `prefix-panel-watchdog.ts` (the two pre-fix formulas exactly as the red run executed them,
sha256 `18c16194225e02d17a174663f3410f3d601d3725ac7ef080c4ff925ebbd75c84`) and `fixed-panel-watchdog.ts`
(the shipped, restored source, sha256 `1f97d20a0a5c57104a700a4f10cc0f49ec223aa06780b5213f07a2a3db1ca997`,
identical to `packages/mpd-tui-plugin/src/panel-watchdog.ts` at the time of writing).

## 1. The two measured defects (reproduced BEFORE the fix)

The earlier L1 brief suspected a double slice. That was repaired in an earlier wave and is **not** the
live cause; the two defects below are, and both were reproduced in a unit render before any edit:

| defect | pre-fix number (measured) | after |
|---|---|---|
| **(a) width / gutter** — `contentCols = panelContentWidth(cols)` never subtracted the rail's cell, while `panelViewportBody(…, true, …)` draws the rail as a 1-cell SIBLING inside the frame | at 40 cols the widest drawn row was **38** (the full interior) → row + bar = interior + 1, the host WRAPS the row: the text jumps left and the frame breaks | `panelContentWidth(cols) - 1` → widest **37** |
| **(b) height off-by-one** — `windowRows = rows - PANEL_CHROME_ROWS(2) - PANEL_TITLE_ROW_ROWS(1)` forgot the frame's TWO border rows | at 20 rows the window was **17**, so the frame drew **21** lines and the host clipped the footer, losing its position token (footer read `1/23` for a 24-row band) | `rows - 2 - 1 - 1` → window **16**, frame exactly **20** |

Both now have an arm asserting the exact numbers (`widest === interior - 1`; `2 + 1 + window + 1 ===
measured.rows`), and the pre-fix run reddens exactly those two assertions plus the footer-token baseline
(`reproduction-prefix.log`). The source was restored byte-for-byte (sha256 checked in `output.log`).

## 2. One body for both surfaces (clause 3 / A3)

`panel-watchdog.ts` now exports:

- `watchdogBodyRows(input)` — every scrollable row, in draw order: absent-state sentence, header counts,
  per-team held/phase, incident title, three rows per incident (kind · age · ack state / team · task ·
  attempt / cause+ms · hold outcome · release), then the acknowledgement flash. ONE render clock per
  render, so two rows cannot disagree about "now".
- `watchdogAckPress(press)` — the acknowledgement rule (newest stamp, no-op press, failure text), shared
  by both surfaces' `a` key.

The sidebar maps each row to `textRow`; the scene maps the same row to `surfaceText`. Neither re-derives a
field, so the surfaces cannot describe one incident differently by construction — and a test renders both
from the same fixture and asserts their body rows are EQUAL in order.

## 3. The scene (`scene-watchdog.ts`, NEW)

Registers `mpd-tui-watchdog` with the page's own title. It draws the frame (border title + tone), the
pinned title row and rule, the shared body, and a pinned key-hint footer carrying the window position;
it scrolls with `⇧↑↓`, `PgUp`/`PgDn`, `Home`/`End`, `j`/`k` and the wheel (through the ONE normalising
helper), draws the vertical rail via `gutterCells`, acknowledges with `a` through the shared rule,
refreshes with `r`, and leaves with `esc`/`q`. The view is read in an EFFECT (scene red line: no
synchronous I/O on the render path) and on the page's 2 s timer; an unavailable or unreadable service
degrades to the explicit absent state.

## 4. Wiring (`index.ts`)

- The scene registers on the `scene` knob, with the same front-door closures the page uses.
- The page's `⤢` is wired through `deps.openFullscreen`; when no scene is composed the chrome row still
  draws (the shared title-row rule) but carries NO click target.
- `/mpd watchdog`'s route now calls `watchdogScene.open()` and reports `sceneOpened`.

## 5. The command line (`commands.ts` + `i18n.ts` — granted by the captain)

`PanelRoute.sceneOpened?: boolean` is OPTIONAL, so every existing route and fake keeps type-checking.
The ONE new branch sits after `opened` and fires only on `sceneOpened === true`; every other branch is
unchanged. Shipped string:

- en: `mpd watchdog: the panel could not open; opened the full-screen watchdog scene instead (esc to return)`
- zh: `mpd 看门狗：面板无法打开，已改用全屏看门狗场景（esc 返回）`

Two arms pin both directions: seam missing + scene opened → SUCCESS naming the scene (and never "no panel
seam"); seam missing + scene not opened → the old absence line still prints.

## 6. Gates (observed)

| command | result |
|---|---|
| `bun test packages/mpd-tui-plugin` | 674 pass, 1 skip, 0 fail (675 tests, 30 files), exit 0 |
| `bun run typecheck` | `tsgo --noEmit`, exit 0 |
| `bun run verify:comments` | VERDICT: PASS — 611 files / 54505 declarations, exit 0 |

## 7. Honest bounds

1. No live TTY capture of the scene; proof is unit-render + typecheck (contract §7.1).
2. The page has no scrollbar DRAG of its own: the vertical bar belongs to `panelViewportBody` and the
   drag mapping to core's `viewportRail` (L1's lane). This lane fixed the page's own width budget, its
   height budget and made sure the wheel is swallowed on both the rows and the frame.
3. The scene's timer is cleaned up on unmount (unit-tested by running the effect cleanups).
