# NESTED CORRECTION — the third direction's UNIT was files, labelled lines (t36, closing the t32 finding)

`result.json` in this directory is SEALED and is not rewritten. This note sits BESIDE it and completes
its `addendum`-class reading: the audit's `third_direction` field, added by t31/B2-F4.

## What was wrong

The field read `1 reference line(s) carry 5 A<n> token(s) (A1, A2, A3, A4, A6)`. The **1** was
computed as `rows.filter((row) => row.reference_tokens.length > 0).length` — the number of driver
FILES containing such a line — while the label said **line(s)**. A count whose unit is wrong is the
same class as the t31/B2-F1 count: a derived value that does not mean what it says.

## The re-taken number, with predicate, unit and moment

| field | value |
|---|---|
| unit | **reference LINES** — the sum, over the scanned rows, of their `reference_lines` entries that carry an `A<n>` token (the per-row `reference_lines` list already existed; no new state) |
| predicate | a line "carries a token" when it matches the checker's own `CLAIM_TOKEN` (`\bA(\d+)\b`) or `CLAIM_RANGE` (`\bA(\d+)\s*[–-]\s*A?(\d+)\b`) pattern |
| re-taken count | **2** reference lines |
| token set (unchanged) | 5 tokens — A1, A2, A3, A4, A6 |
| re-taken at | 2026-09-17T14:55Z, from the live scan in `evidence/gates/wave2b-laneB2/20260917T145530Z/driver-headers-live/result.json` |
| corpus moment | the scan's own `run_at` (recorded in that record) |
| checker revision | `53ae5cbc387c95566fadaf6697cff6b31f9e759f6cdefb9e519d99f33bc8b41f` (1230 lines, the revision this sealed record's t31 sibling pins) → `dd7ca25ba7f4820f0aadbffabf4df4af00629b70cbc019cfae420124f636bc13` (1239 lines) |

Both lines are in `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs`, verbatim:

1. `` `<workspace>/.mpd/mpd.jsonc` (t34 design §1/§2/§A.1/§D; t35 acceptance A1-A4/A6). `` — tokens A1, A2, A3, A4, A6 (the range plus the lone id).
2. `` A6 the write-back switch (`writeBack: false`, the design's key; `settingsBridge.writeBack` `` — token A6.

The other scanned driver (`skills/dsh-qa/scripts/tui-team-surface.mjs`) has 2 reference lines, neither
carrying a token — which is exactly why FILES (1) and LINES (2) diverged on this corpus.

## The rule, now applied to both counts this lane records

A derived count carries its **predicate and unit** in the same breath, or it is not recorded. The
field now states `unit: "reference LINES (not driver files): the sum, over the scanned rows, of their
\`reference_lines\` entries that carry an \`A<n>\` token"` beside the number, and the t36 record repeats
the predicate — so the two units can no longer be read for one another.
