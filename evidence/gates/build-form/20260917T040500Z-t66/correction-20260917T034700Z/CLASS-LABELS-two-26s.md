# CLASS LABELS for the two "26"s — refinement of this directory's retirement (03:55Z)
# This does NOT rewrite the parent correction; it refines its wording, per packaging-engineer's
# class-label correction (their record: evidence/pack-closure/two-26-class-labels/20260917T034900Z/).

## THE PROBLEM WITH MY ONE-WORD "RETIRED"
The correction in this directory says the artifact-wide origin is "retired". True in the sense that
matters to §6 (it is not ONE BUILD's count), but too broad as a bare label, because the sum is real
for the class it names. Both statements must carry their unit.

## THE THREE NUMBERS, EACH WITH ITS CLASS (all verified 03:54Z, read-only)
| number | class / unit | measurement | usable for §6? |
|---|---|---|---|
| **26** | diff-OUTPUT lines: 13 differing positions × 2 sides (`<` + `>`) | both forms of `mpd-ext-plugin/src/index.ts` built to temp outfiles | **YES** — this is what §6 states |
| **26** | path-comment LINES across the artifact's TWO STORED COPIES | `packages/mpd-ext-plugin/dist/index.js` 13 (`f6097fd3383f2fa7…`, 152,855 B) + `dist/mpd-package/…/dist/validator.js` 13 (`7128166c28b1b4ce…`, 153,262 B) | NO — it is an artifact-wide sum, not one build's count |
| **29** | ALL `^//` lines across those two copies | as above + the 3-line packer shim header in `validator.js` (`:3920-3922`) | NO — same reason, and it is not a path-comment count |

## WHAT IS RETIRED, PRECISELY
Retired: using the two-copy path-comment sum (26) as the ORIGIN of §6's number — §6's sentence is
scoped "in the `mpd-ext-plugin` build", and the only reading consistent with that scope is the diff.
NOT retired: (b) as a fact about the packed artifact, correctly labelled.
§6 remains exactly as t66 landed it; no edit is owed (captain confirmed).

## THE QUOTABLE FORM (packaging-engineer's labels, adopted)
"26 path comments across the two stored copies (13 each; 11 distinct paths); `validator.js` adds the
3-line shim header, so 29 `//` lines total — and 26 diff-output lines for a single build's two forms,
which is a different 26 and the only one §6 may quote."
