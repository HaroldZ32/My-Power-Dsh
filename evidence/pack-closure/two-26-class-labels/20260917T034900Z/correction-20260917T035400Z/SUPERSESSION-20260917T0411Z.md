# SUPERSESSION — the "24" is explained after all (2026-09-17T04:11Z)

This note SUPERSEDES the retraction clause in the sibling `result.json` (written 03:54Z) and every
earlier "the 24 remain figure is UNEXPLAINED" statement of mine, including the clause the captain
briefly authorised. The captain's final paragraph is canonical:

> One build = **13 path comments (11 distinct module paths)**, all 13 differing between the two
> forms. The **26** in circulation is the comment-list `diff`: 13 differing positions × 2 sides = 26
> lines (13 removed + 13 added). The **24 is reproducible as a post-drop DIFF-LINE count**: dropping
> the first differing position removes its `<` / `>` pair, so **24 = 2 × (13 − 1)** — never a comment
> count and never a banner (line 1 of BOTH forms is the first bundled module's path comment). The
> artifact-wide reading is NOT a second origin: the packed tree's `validator.js` carries 16 `^//`
> lines of which 13 are path comments (three are the packer's shim header), so it is 29 by the
> natural count and 26 only by subsetting both files to path comments — **retired as an origin, kept
> as a class-labelled fact**.

## Verified here, not inherited (04:11:45Z)

- Provenance file exists and says exactly what the captain cited:
  `evidence/gates/build-form/20260917T033500Z-t60/two-forms-method.txt` →
  line 4 `differing lines total       : 26`, line 5 `differing AFTER dropping L1 : 24`.
- Arithmetic: `13 × 2 = 26`; dropping ONE differing position removes BOTH of its diff lines
  (`<` **and** `>`), so `26 − 2 = 24 = 2 × (13 − 1)`.
- Line 1 IS a differing position between the forms:
  root `// packages/mpd-dsh-adapter-plugin/src/index.ts` vs package-dir
  `// ../mpd-dsh-adapter-plugin/src/index.ts`.

## My own error, owned

My proposed clause reasoned "dropping one line from 26 gives 25, and no two identifiable items exist
to drop". The first half is arithmetic on the wrong operation and the second half is false: the two
items are the `<`/`>` pair of the first differing position, and the operation is `26 − 2 = 24`. The
"25 not 24" layer belongs to ME, not to the captain — the wave's process section should say so.

## What still stands from the parent and its correction

- The **banner gloss is retracted** (no line is an entry banner).
- The artifact-wide reading is **retired as an origin** and kept as a **class-labelled fact**:
  `validator.js` 16 `^//` lines = 13 path comments + the 3-line shim header; 29 by the natural count,
  26 only by subsetting both files to path comments.
- §6 keeps only the 13-count and the diff-26 label; nothing in this thread touches §6's bytes.
