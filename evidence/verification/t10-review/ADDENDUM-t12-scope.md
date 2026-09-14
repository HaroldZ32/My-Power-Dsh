# t10 scope-correction addendum — t12 judged from raw output (Reviewer, 2026-09-11T04:10Z)

The captain's scope correction adds **t12** to the reviewed change set. t12 was already inside my
reviewed set: I re-anchored the whole review on the post-t12 tree (HEAD `98680b1` + t12's 11:57 dist
repair) and the review's criterion-6 evidence is **my own** full rebuild sweep
(`dist-consistency-full.txt`). This addendum closes the two t12 claims I had verified only indirectly.

**Verdict is unchanged: `needs_revision`** — the blocking findings F1 (cocotb lane venv root) and F2
(hashline guard path base) are independent of t12, and t12's own work is judged correct below.

**Anchor note:** this addendum judges the revision as it stood at 04:07–04:09Z. At 04:10Z a **repair of
F1/F2 went in flight** by another member: `packages/mpd-verif-plugin/src/{venv,regress,sim}.ts`
(mtime 12:10:13 local) and `packages/mpd-hashline-plugin/src/index.ts` (12:10:51) now carry
`requireCocotbVenv(undefined, exec)` / `venvStatus(override, exec)` and a `sessionPath(fp, dsh, exec)`
guard base. Those edits are **outside the revision this verdict applies to** and belong to the next
review gate, not to this one.

## (a) t12 claim "it edited NO src" — CONFIRMED (mtime window, robust)
t12 rebuilt its four dists at `2026-09-11 11:57:28`. A filesystem sweep for any `*/src/*.ts` modified
inside `11:57:00–11:59:00` returns **empty**. All changed-src mtimes fall in two clusters: `11:07–11:24`
(t3/t4/t7) and `12:10:13 / 12:10:51` (the post-t10 repair noted above). Nothing belongs to t12.
(The earlier `find … -newer sweep.mjs` probe was empty when run at 04:08Z and is now polluted by that
later repair, so the mtime-window proof is the one used here.)

## (b) t12 claim "all 16 packages fresh afterwards" — CONFIRMED (my own rebuild)
`bun build packages/<p>/src/index.ts --target node --format esm` for every package with a
`dist/index.js`, run from the repo root: **16/16 BYTE-IDENTICAL**, including the four t12-repaired
ones (`dist-consistency-full.txt`).

## (c) t12 claim "the four now inline the post-fix adapter" — CONFIRMED
HEAD state (before t12) vs worktree (after):
```
                workspaceRootOf(HEAD)   workspaceRootOf(now)   sessionCwdOf(now)   banner(now)
mpd-tools-plugin        0                      2                     3             // packages/mpd-tools-plugin/src/index.ts
mpd-roles-plugin        0                      2                     3             // packages/mpd-roles-plugin/src/index.ts
mpd-bootstrap-plugin    0                      2                     3             // packages/mpd-bootstrap-plugin/src/index.ts
mpd-qa-roles-probe      0                      2                     3             // packages/mpd-dsh-adapter-plugin/src/index.ts
```
So all four were genuinely stale before (pre-fix adapter inlined) and are fresh after.

## (d) t12's measured deviation (repo-root build form) — JUDGED CORRECT
```
repo-root form  (cwd=repo root, entry 'packages/mpd-roles-plugin/src/index.ts'):
  banner '// packages/mpd-roles-plugin/src/index.ts'   byte-identical to committed: YES
package-dir form (cwd=packages/mpd-roles-plugin, entry 'src/index.ts'):
  banner '// src/index.ts'                             byte-identical: NO
  non-banner diff lines vs committed: 0
```
The committed convention records the repo-relative entry path in the banner, so only the repo-root
form reproduces the committed bytes; the package-dir form leaves the historical `// src/index.ts`
banner and would keep those four flagged STALE under a banner-strict comparison. The deviation from
the contract's named form is therefore the correct call, and the full 16/16 result confirms it.
(One probe of this check was first run with the wrong cwd and is superseded; the numbers above are the
corrected pair, reproduced in `ADDENDUM-t12-scope-raw.txt`.)

## (e) "banner-only" wording — CORRECTION (evidence precision, not a defect)
The roles-dist banner normalization is real and cosmetic, but the roles `dist/index.js` change is
**not** banner-only. Stripping all `^//` lines from `git show HEAD:...roles/dist/index.js` vs the
worktree still leaves the newly inlined adapter block:
```
> function sessionCwdOf(agent) { ... }
> function workspaceRootOf(exec) { ... }
> function workspaceRootsOf(agents) { ... }
>   const workspaceRoot = (exec) => workspaceRootOf(exec);
>   const workspaceRootsAll = () => workspaceRootsOf(service("agents"));
```
plus the `resolve` -> `resolve2` import rename that the inlining requires. That content change is
exactly t12's purpose (refresh a stale inlined adapter) and is correct; the wording "a BANNER-ONLY
diff" (captain brief, and t12's `rebuiltInPlace[].diffStat`) overstates it. Recommended wording for
the consolidation: "roles dist = stale-adapter refresh + banner normalization", not "banner-only".
No repair required; this does not change the verdict.

## (f) Vendor lock — CONFIRMED, not re-pinned
`node scripts/verify-vendor.mjs` on this tree: `[verify-vendor] PASS`, exit 0, `asset OK: skills 365
files`; the treeSha is still `ea1f001f…` as independently re-derived by the script's own algorithm
(`vendor-lock-derivation.txt`). F5 (the `skills/dsh-qa/scripts/workmate-library.mjs` edit) is treated
as captain-ratified, per the brief.

## (g) Declared-but-unmatched paths
t3 (`compile.ts`, `test/helpers.ts`, `test/index.test.ts`, `test/lossless.test.ts`), t4
(`test/tool-schema.test.ts`, `evidence/hashline/**`) and t7 (the migrated `src/index.ts` files,
`skills/dsh-qa/scripts/workmate-library.mjs`, `evidence/session-workspace-root/**`) were treated as
in-scope evidence throughout this review, never as unauthorized edits.

## (h) Scratch
No scratch left: `git status --porcelain | grep -E 't10-role|\.t10'` is empty; the F1 reproduction
removed its workspace (`cleanup=removed`).
