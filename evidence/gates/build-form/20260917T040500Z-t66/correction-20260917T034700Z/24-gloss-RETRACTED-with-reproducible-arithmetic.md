# RETRACTION of my "two entry banners" gloss on the 24 — with the arithmetic that IS reproducible
# docs-gate-engineer · 2026-09-17T03:57Z · sibling of RETIRE-artifact-wide-origin.md / CLASS-LABELS-two-26s.md
# (parent evidence dir left byte-untouched)

## WHAT I WROTE AND WHY IT IS WRONG
I glossed the historical figure "24 remain after dropping the first" as "26 − 2 = the two entry
banners". **RETRACTED.** There is no entry banner anywhere: line 1 of both build forms is the FIRST
BUNDLED MODULE's path comment (`// packages/mpd-dsh-adapter-plugin/src/index.ts` in the root form and
in the artifact copy; `// ../mpd-dsh-adapter-plugin/src/index.ts` in a package-directory rebuild), so
there are no two banner items to drop. The gloss was mine; the captain relayed it, and it is now
withdrawn in both places.

## WHAT IS REPRODUCIBLE (re-derived from both forms at 03:57Z, temp outfiles, no packages/** write)
  differing POSITIONS (source lines)          : 13
  diff-OUTPUT lines (one `<` + one `>` each)  : 26
  after dropping position 0 : positions 12 -> diff-output lines 24
  ⇒ **24 = 2 × (13 − 1)** — "dropping the first" removes ONE differing POSITION, and every position
    prints as TWO diff lines, so the drop is −2 even though only one item (a position) is dropped.
t60's own measurement file says the same in its own words (`two-forms-method.txt`):
  "differing lines total : 26 / differing AFTER dropping L1 : 24", with the sample printed as `<`/`>`
  pairs — i.e. the 24 was ALWAYS the post-drop diff-line count, never a comment count.

## SO THE HONEST OPTIONS FOR THE REPORT (pick one; both are true)
1. **Quote it reproduced:** "24 = 26 − 2, the `<`/`>` pair of the first differing position dropped" —
   no banner framing, arithmetically derivable from the 13/26 pair in one line.
2. **Retract the figure entirely** as historical wording from the superseded sentence, keeping only
   13 / 11 distinct / all 13 differing / diff-26. That is the captain's stated preference and it is
   safe; the only thing to avoid is presenting it as "unexplained", because it is explainable — just
   not by banners.
What must NOT happen: any text saying "24 remain after dropping the two entry banners" or otherwise
explaining the −2 by banners. That was my error and this file is its retraction.

## CONSOLIDATED COUNT STORY (three seats, one origin)
- one build = **13 path comments / 11 distinct module paths**, all 13 rewritten between the forms;
- the **26** in circulation = the comment-list `diff` (13 removed + 13 added) — the only origin that
  survives every convention and the only one §6 quotes;
- the artifact-wide **26** exists only as a path-comment subset sum across the two stored copies
  (13 + 13; 29 by all `^//` lines) — retired as an ORIGIN of §6's number, kept as a class-labelled fact;
- the **24** = the post-drop diff-line count (2 × 12), once wrongly glossed by me as "two entry banners".
