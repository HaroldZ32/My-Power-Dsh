# CAPTAIN'S FINDING — the horizontal rail IS drawn, and its thumb tracks the pan

Measured 2026-10-07 by the captain directly on the verifier's own panes. Recorded because the verifier
honestly reported `hGut=false` at every width and declined to score it, and because a reader of that
report would conclude the user's "双向滚轴" had no visual affordance. **It has one.**

## The rows, verbatim, sliced to the panel's own columns

`captures/pty-fixed3/<width>/<state>.pane.txt`, the row directly beneath the DAG drawing (row 35 of the
pane in each case):

| width | `pan1` (unpanned) | `pan3` (after `⇧→`) |
|---|---|---|
| **100** | `││░█████████░░░░░░░░░░░░░░░░░░│` | `││░░░█████████░░░░░░░░░░░░░░░░│` |
| **140** | `││░░████████████████████░░░░░░░░░░░░░░░░░░░│` | `││░░░░░████████████████████░░░░░░░░░░░░░░░░│` |

`█` is the thumb and `░` the track. **The thumb MOVES between the unpanned and the panned frame at both
widths**, which is clause T4's property in its visual form: the rail is drawn from the SAME single offset
the page reads, so it cannot disagree with the drawing's position. At width 220 the same row is present.

## Why the verifier's classifier did not see it

Its `hGut` detection did not recognise the row, and its own reported reason — that both gutters come from
`gutterCells()` and that function returns empty when the content fits — is a correct statement about the
VERTICAL axis only. Read from the source:
`panel-core.ts#gutterCellsX(colOffset, contentCols, viewportCols)` returns `""` **only when the HORIZONTAL
band does not overflow**, and `panel-dag.ts` pushes it as its own row (`key: "hrail"`) beneath the drawing.
The two axes are gated independently — which is exactly what ruling R8 requires.

## What this means for the wave's claims

- **CORRECTED**: the horizontal half of the user's "双向滚轴" IS delivered AND VISIBLE, at all three width
  bands, and its thumb is provably tied to the pan position.
- **UNCHANGED and correct**: `vGut=false`. The vertical content fits the viewport, so a vertical gutter
  returning empty is the contract working, not a missing feature.
- **THE INSTRUMENT**: this is the verifier's THIRD false negative of the wave, after C1 sweeping the pinned
  detail's rows and the panel frame counted as a node box. All three are the same class — a region or a
  predicate scoped slightly wrong — and all three were found because the artefacts were kept rather than
  deleted. A classifier's `false` is a claim about the classifier as much as about the product, and this
  one is worth the same treatment its owner gave the first two.
