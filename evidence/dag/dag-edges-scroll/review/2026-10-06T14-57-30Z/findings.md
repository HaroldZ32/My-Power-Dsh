# REVIEW · independent fidelity instrument + adversarial findings — wave `dag-edges-scroll`

Seat: **Reviewer** (task T6). Branch `feature/dag-edges-scroll`. No product file was written by this seat:
the two instruments are `packages/mpd-tui-plugin/test/dag-label-parity.test.ts` (WEB surface, 22 arms) and
`packages/mpd-tui-plugin/test/dag-fidelity.test.ts` (TUI surface + the WEB curve geometry, 44 arms, of
which the previous wave's arms stay in place and three were RE-POINTED under R6 — never disabled, never
deleted).

> NOTE ON THIS FILE: an earlier revision of it was corrupted in place — roughly 300 lines of UNRELATED QA
> and gate output (a `no-terminal-writes --self-test` transcript and a root `bun test` run) appeared
> spliced into the middle of it between my own writes. Nothing in this workspace should have written this
> path. The file has been rewritten from the seat's own content, and the incident is reported to the
> captain as a workspace hazard rather than quietly patched over: two writers on one path is a defect
> class this repository has a rule about.

## The command, and what it said

```
bun test packages/mpd-tui-plugin            # exit 1
 373 pass ·  6 fail · 13010 expect() calls · 379 tests across 18 files  (measured 2026-10-06T15:33Z, final)
 343 pass · 26 fail ·  9299 expect() calls · 369 tests across 18 files  (measured 2026-10-06T15:12Z, for the trend)

bun test packages/mpd-tui-plugin/test/dag-label-parity.test.ts \
         packages/mpd-tui-plugin/test/dag-fidelity.test.ts   # exit 1
  66 pass · 0 fail · 5592 expect() calls · 66 tests     (re-run after the WEB lane's mark() fix)
```

**The suite is RED, and ALL SIX remaining failures are in the lanes' own files** (the previous wave's
`panel-dag.test.ts` "scrollbar and the self-windowed viewport" block, `scene-visuals.test.ts`,
`team-surface.test.ts`, `panel.test.ts`, `graph.test.ts`). They are the mid-rebuild state of the two
lanes, and they are reported here as RED rather than smoothed over: at this instant the wave is **not
shippable**. **My own instrument contributes ZERO reds as of 15:33Z** (finding 4 is closed). The count fell
26 to 9 to 6 while both lanes kept landing, which is the honest shape of a mid-flight wave.

Baseline for comparison, taken before either lane wrote a byte (`baseline-before-lanes.log`, HEAD
`52cd964f`): **332 pass · 2 fail**. Those two pre-existing failures are BOTH in
`panel-dag.test.ts`'s viewport block, one of them a deliberately-false constant
(`BOUNDED_OFFSET_RENDERS_A_FULL_WINDOW = false`) left by the previous wave's reviewer as a defect
signature — the accumulation defect in `usePanelViewport`. That defect is squarely inside the TUI lane's
blast radius, because T4/R2 widen the same `commit`/`band` path to a second axis.

## Findings

1. **[major, FOUND AND FIXED MID-WAVE, re-verified] The TUI drawing printed `#undefined` instead of
   `#<ordinal>`.** Reproduced at 15:14Z (`recheck.log`); `layoutList`/`layoutRail`/`layoutBoxes` all
   printed `○ T1 REQ #undefined`. The composer itself was correct
   (`graphSafeLabel("冻结验收契约", 2) === "#2"`), so the ordinal was not reaching `labelOf` at the call
   sites. **This is the one class of defect that no C1/C5 arm can see** — `#undefined` is ASCII — which
   is exactly why the ordinal arms exist. Re-verified at 15:12Z: all three modes now draw `#1 #2 #3 #4`
   with zero banned characters.

2. **[major, FOUND AND FIXED MID-WAVE, re-verified] `sliceSpans` lagged `sliceCells` by one cell.**
   Measured on a real drawn row: `(offset 3, cols 2)` → `sliceSpans "  "` vs `sliceCells " T"`; `(2,3)` →
   `" ○ "` vs `"○ T"`; `(4,2)` → `" T"` vs `"T1"`. R2 freezes the two as *the same cut* in two modules,
   so one cell of disagreement is the "second scroller whose position the page cannot see" in miniature.
   Re-verified: the three offsets now agree exactly. The instrument keeps the arm that compares them
   character for character (`T3 · sliceSpans is the SAME cut`).

3. **[major, FOUND AND FIXED MID-WAVE, re-verified] The compressed 3-row box form was not selected.**
   `layoutGraphNatural(board, undefined, { rows: 5 })` reported `boxRows: 5` on a 5-rank board, where the
   freeze's rule (ROOMY iff `rows >= ranks * 8 + 2`) demands COMPRESSED. Re-verified: `rows: 5` → `3`.
   The arm drives BOTH budgets, so a layout that always answers one of the two cannot pass.

4. **[RESOLVED — the lane fixed it, and this arm was then REFORMULATED rather than merely re-run] The
   router pushed a waypoint for a lane visit that did not move the pen, so the published polyline
   carried a repeated sample.** The WEB lane replaced the unconditional push with a mark() helper and
   proved the fix the way a routing truth deserves: data-mpd-route is byte-identical BEFORE/AFTER over
   10 edge/radius rows, so the geometry did not move while the repeated vertices went 3 to 0.
   **Re-run at 15:33Z: GREEN — and the arm's OWN statement was wrong, which is the more interesting
   half.** Its remaining assertion used to be "widest chord < nodeHeight" (reasoning: a chord longer
   than a box could skip one) and that FAILED on **304.5 px**. Measured cause: the emitter samples the
   ARCS and emits every straight run as ONE L, so a rank-skipping leg IS a single long chord by design.
   Chord length was never a soundness bound: a straight chord is the drawn line and cannot skip
   anything, and the containment proof rests on the SEGMENT test rather than on spacing. The arm now
   asserts the ordered invariant (no zero-length chord, over **666 chords**) plus the one bound that is
   real — no chord leaves the canvas (304.5 px of a 936.5 px canvas) — and REPORTS the widest chord
   instead of pinning it. The retired bound and the reason it was wrong are recorded in the arm's own
   comment so the next reader does not reinstate it.

5. **[major, A FINDING ABOUT THE FREEZE, not about the code] The freeze's proposed curve-domain control
   CANNOT FIRE on this implementation.** `design-freeze.md` (b) step 5 asks for "the same route emitted
   with a deliberately huge radius that bulges a sweep into a neighbouring box". Measured on the 14-edge
   board (`probe-bulge.ts`): radius 6 → 0 invasions, 20 → 0, 60 → 0, **200 → 0**. The reason is the clamp
   the freeze itself declares one paragraph earlier — `r_i = min(radius, legIn/2, legOut/2)` — which
   bounds every fillet by the legs that carry it, so the painted polyline cannot leave its gutter however
   large the knob. That is a GOOD property, and it makes the named control unreachable. **Substituted,
   and the substitution is strictly stronger:** (a) a THREADING control — a two-sample segment that
   crosses a box's interior while both of its samples sit OUTSIDE it, which a point-only test (the shape
   of the bundle's own `entersInterior` arm) reports as clear and the segment test catches; (b) an
   ARC-SAMPLE control — a sample taken from the middle of a real `Q` fillet, displaced into a box, caught
   on DOM-measured boxes. Recommend amending the freeze to name these two and to record the clamp as the
   reason the radius control is void.

6. **[RESOLVED BY THE LANE] The previous wave's deliberate red arm was
   now one of six failures in the same block.** `panel-dag.test.ts`'s
   `BOUNDED_OFFSET_RENDERS_A_FULL_WINDOW = false` documents a real accumulation defect in
   `usePanelViewport` (`panel-core.ts`). At the measured moment the block reports six failures, the new
   ones being `when the content FITS there is no gutter`, `the WHEEL HANDLER IS BOUND ONCE`, `the
   rendered window NEVER exceeds the viewport` and `FOCUS AUTO-SCROLL`. The vertical viewport is being
   rebuilt for the second axis; whoever signs the wave off must confirm this block is green, because
   **T6's own two-axis clause sits on that primitive**.

7. **[major, LANE-OWNED, a STANDING user-mandated gate is RED] `bun run verify:comments` fails on this
   wave's own new files.** Measured: `node scripts/verify-comment-coverage.ts` exits **1**, and the only
   violations left in the whole 407-file source set are `packages/mpd-tui-adapter-plugin/src/index.ts`
   (3: `observe`, `outcome`, `stop`) and **`scripts/mpd-tui-panels.ts` (2: `writePanelsIntoDocument` has
   no parameter type; `verdict` has no declaration comment)** — the latter is UNTRACKED, i.e. a file this
   wave introduced. Nothing of mine contributes: both of my test files are clean under the same gate (I
   re-pointed them until they were). This one is easy to sign off without noticing, because `bun test`
   does not run it and the wave's own plan does not name it: **§4 lists `verify:comments` as standing,
   required on ANY source edit.**

8. **[nit, relayed and accepted pre-emptively]** `packages/mpd-bundle-plugin/test/team-view.test.ts`'s
   "no SVG" arm (`expect(SOURCE).not.toContain("createElement(" + "svg")`) is FALSE by construction once
   W1 lands. The freeze's (b) row 1 owns the replacement (drop that line, add `getComputedStyle` and
   `offsetWidth` to keep the MEASUREMENT ban at least as sharp). No action for this seat.

9. **[nit, instrument hygiene, disclosed]** The two test files duplicate a ten-line CJK predicate on
   purpose: the write scope of this review is exactly those two files plus `evidence/…/review/**`, so a
   shared helper module would have to live outside it. Both copies carry the same ranges and the same
   comment.

## The ONE thing I would change first

**Nothing of mine: the instrument is GREEN.** The one thing left in the wave is finding 5 — amend the
freeze's curve-domain control, which cannot fire on this implementation — and then confirm the lanes'
six remaining arms. The nearest-miss candidate is the arm of finding 4: it was REFORMULATED, not
relaxed, and the retired bound is recorded in place so it cannot come back.

## Clauses I could NOT falsify, and why

- **T5 (the key map: arrows move focus, Shift+arrows scroll, PgUp/PgDn, Home/End, wheel per axis)** — NOT
  COVERED. The keys are handled inside the panel component, so falsifying the map needs the panel's host
  double (the class `panel-dag.test.ts` builds for itself), which this seat did not rebuild. I could not
  prove the map and I will not claim it.
- **T6 (two-axis focus auto-scroll)** — NOT COVERED, for the same reason, and note finding 6: the
  vertical half of it is currently RED in the lane's own file.
- **T4 / R2 / R8 (one handle for both axes; the horizontal rail's thumb equals the page's `colOffset`;
  the non-DAG rows are neither panned nor cut)** — NOT COVERED. These need the same host double.
- **T2 (the `dag` panel AND the in-scene DAG both pan)** and **T1's `labelOverflow` fallback** — NOT
  COVERED as behaviour: I assert the layout-level facts (`boxRows`, the natural entry's existence), not
  the three scene call sites.
- **W7 (the tint survives as a stroke) and W2's "no DOM read"** — NOT COVERED. The tint is a rendered
  `style` read and the measurement ban is a source-shape claim; the freeze's (b) row 1 re-points the
  latter in the bundle's own file.
- **W4's byte-identity of `data-mpd-route`** — PARTIALLY covered: I assert the route marks still travel
  beside the curve (every edge has segments) and that `data-mpd-curve` carries `curve.d` verbatim, but I
  do not diff the route string against the pre-wave form.

## What the instrument DOES falsify, clause by clause

| clause | arms | state |
|---|---|---|
| C1 (WEB drawing) | 4 | GREEN — zero banned characters over the node+edge+legend scope, on a 4-task pure-Chinese board |
| C1 (TUI drawing) | 3 | GREEN — zero banned characters in all THREE modes (`boxes`/`rail`/`list`) and in the legend lines at 80/40/12 columns |
| C2 (one composer) | 1 | GREEN, behavioural — all three TUI modes and the WEB node box draw the SAME label for the same board |
| C3 (detail exempt) | 1 | GREEN — the pinned detail body still contains the exact Chinese subject, and the drawing stays clean afterwards |
| C4 (the rule) | 4 | GREEN — 13 adversarial rows incl. full-width ASCII, TAB, emoji, astral-only, punctuation-only, plus `#<ordinal>` at an ordinal the arm chooses (3, 7) |
| C5 (falsifiability) | 2 | GREEN — the pre-rule pass-through is MEASURED to violate (5 of 13 rows carry banned characters), and the rendered pre-rule drawing carries 28 |
| W3 (six steps) | 6 | GREEN — DOM boxes, layout samples, the `data-mpd-curve` === `curve.d` bridge, SEGMENT-vs-interior (541 segments, 0 invasions), a threading control, an arc-sample control, and a non-vacuity floor (555 samples, 11 curved edges) |
| W5 (arrival) | 3 | GREEN — arithmetic on both directions (forward AND same-rank/back), `points[last] === tip`, the DOM's ZERO-WIDTH `data-mpd-tip` at the same x, on a `polygon` so the path count stays exact |
| W6 (`radius = 0`) | 4 | GREEN — pure `M`/`L`, axis-aligned legs, `points` == waypoints, the knob really bends, and no degenerate chord over 666 chords (finding 4 closed) |
| T3 (the slicer) | 4 | GREEN — the exactly-`cols` postcondition swept over REAL drawn rows for every offset incl. past the end and `cols === 0`; the wide-glyph straddle cases; a naive code-point slicer REFUSED by the same check; `sliceSpans` === `sliceCells` |
| T7 (termaid glyphs) | 5 | GREEN — the `DAG_CHARS` table's members are one cell each and none is in a banned range; the four rounded corners; `graph.ts` spells no sharp node corner (its only `└` is the rail elbow the freeze declares stays sharp); exactly ONE `▼` per dependent with `┴` in the cell below it on the top border; `boxRows` 3 vs 5 under the two budgets, rounded in BOTH forms |

Reported measurements kept for the record (not pass/fail): widest published chord **2.415 px** against a
declared flattening step of 1 px — expected geometry (`ceil(span/step)` bounds the PARAMETER step, not
the chord of a `Q`/`C` arc); retired as an invariant by the captain's ruling because the SEGMENT test no
longer depends on sample density.
