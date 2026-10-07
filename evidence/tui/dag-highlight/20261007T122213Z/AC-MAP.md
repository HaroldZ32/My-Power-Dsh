# AC1–AC8 → the artifact that proves each one

Frozen revision `14a28d8b2312b0c3c37e1e71130b4d20cc00d9957eddf243ebbaf0a12e2af7aa`
(read 12:29:33Z and 12:32:23Z, IDENTICAL — `hashes.txt`). Assembled by the captain for the reviewer;
the ARM NAMES are the lanes' own and the readings are quoted from `acceptance.log` and `gates.log`
in this directory.

| Criterion | Headless evidence (captain's instrument) | Package arms (the lanes') | Real-terminal evidence |
|---|---|---|---|
| **AC1** — a node draws `<marker> <id>` and nothing else | `PASS AC1 boxes=5/5 off-shape=0` — every box's interior, located through the drawing's OWN hit rectangles, matches `^[✓◐○✗⊘▶] <id>$` | `graph.test.ts` "AC1: a box draws EXACTLY `<marker> <id>`…"; `dag-label-parity.test.ts` "AC1: every TUI mode draws `<marker> <id>` and carries NO subject and NO ordinal fallback" | `pty-final/w220/open1.pane.txt`: `│ ✓ T1   │`, `│ ○ T2   │`, `│ ○ T3   │` |
| **AC2** — compact ROUNDED three-row box, one form per drawing | `PASS AC2 rounded=true sharpPresent=false boxRows=3` | `dag-fidelity.test.ts` "AC2: EVERY drawing reports the COMPACT three-row form…" | the same pane: `╭────────╮` / `│ ✓ T1   │` / `╰───┬────╯` |
| **AC3** — a three-wide rank draws in ≤ 40 cells | `PASS AC3 three-box rank width=36 (<=40 required)`; the arm's own control: a fourth task = 49 > 40 | `graph.test.ts` — the "AC3 · the natural-width drawing is sized by its label" describe (2 arms) | the DAG page's drawing fits its column with no horizontal rail (`vGut=false hGut=false`) |
| **AC4** — the click resolves through the hit rectangle INCLUDING the column | `PASS AC4 clicked the SECOND box of the rank at localCol=14; pinned T3=true, pinned the leftmost T2=false` — the pre-fix reading of the SAME arm was `pinned T3=false, pinned the leftmost T2=true` | `panel-dag.test.ts` AC4 ×3 (positive control; fallback + clear; the resolution rule including the pan sign) | not provable here — see the DELIVERY bound below |
| **AC5** — focus + chain BOLD, the rest dimmed | `PASS AC5 bold spans=10 dim spans=41 focusBold=true chainBold=true` | `panel.test.ts` AC5 arm (loops `DAG_TONE_THEME`, asserts `bold` exactly for focus/chain and `dimColor` exactly for dim) | colour/bold is not readable from a pane dump; the bound is stated in §11.5 |
| **AC6** — a second click opens that member's work page | `PASS AC6 pinned=true openAgentPage called with ["agent-verify"]` | `panel-dag.test.ts` AC6 ×4 (opener call; three toast cases; the same-handler double click; `agentIdForOwner` units) + `subagent-scene.test.ts` ×6 (the destructive, TTL-bounded one-shot slot and the scene's consumption of it) | not driven by this capture harness |
| **AC7** — BOTH rails scrub under a drag | `PASS AC7 two rails found; dragging the gutter on localRow moved=true, the rail on localCol moved=true` — each rail is DRIVEN ON ITS OWN AXIS, so a rail reading the wrong one cannot pass | `panel.test.ts` AC7 arms with NUMBERS: vertical `{localRow:4}` → 40, `9` → 90; horizontal `{localCol:8}` → 40, `32` → 160; no overflow → `viewportRail` returns `undefined` | not drivable by this harness (no mouse); the bound is stated |
| **AC8** — three distinct one-cell icons AND each page's own `⤢` | `PASS AC8 icons=["❖","◈","⬢"] widths=[1,1,1] distinct=true hostCollisions=[] fullscreenGlyphRendered=true fullscreenControlClicked=1` — the arm DRIVES the control and requires `openFullscreen` to be reached | `panel-visibility.test.ts`: the icon arms (each measured under OUR `cellWidth` AND the host's `stringWidth`; the host's seven built-ins read from the installed host and asserted disjoint), the click-through arm, and THE LAYOUT ARM with its negative control (`beforeRow` loses the glyph, `afterRow` keeps it) | `pty-final/w220/open1.pane.txt` line 5 ends `… MPD DAG <spaces> ⤢│` (U+2922), and the panel bar reads `≡ ▸ ◆ ❖ ‹ MPD DAG › ⬢` |

## The bound that applies to every row above

**Pointer-coordinate DELIVERY is declared, not proven** — a terminal and this host actually handing
usable `onClick`/`onDragStart` `localRow`/`localCol` to a row `Box` inside a plugin sidebar panel is not
provable by any arm in this repository. The headless arms prove RESOLUTION; the real-terminal capture
proves RENDER; neither proves DELIVERY. The host-side contract was read and quoted by the lanes (the
narrowed plugin kit keeps drag; `ink/components/Box.js` forwards the drag props; `pointer-event.js`
recomputes `localCol`/`localRow` per handler from the node's rect; `findDragTarget` walks ancestors for
`onDragStart`; a drag session opens only under the alternate screen) — reading a contract is not
observing delivery.

## The honest lesson this wave produced, recorded so it is not lost

Two of AC8's three pages' worth of FAILURE were invisible to every headless arm, including the
captain's own instrument, and were found only by a real terminal:

1. `panel-dag.ts` named `⤢` in its footer but drew no CONTROL — the captain's arm asserted the GLYPH
   renders, so it passed. Raised by the lane's own self-report.
2. That control then rendered NO CELL — its row declared `width: "100%"` inside a bordered frame that is
   itself `width: "100%"`, so the child's `100%` resolved against the frame's BORDER box and the control
   was clipped past the right border. Found by the captain's PTY capture (`pty-defect/`).

**"An arm asserts the element exists" is not evidence of layout.** The arm that closes this now renders
the REAL components through the host's own ink and asserts the glyph's position, with the pre-fix row
shape as a negative control that FAILS.
