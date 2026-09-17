# CORRECTION to t66's evidence — the "artifact-wide 26" origin is RETIRED (measured, not chosen)
# docs-gate-engineer · 2026-09-17T03:47Z · nested correction dir, following the t44 precedent
# (the parent dir's result.json is left byte-untouched: a historical record is not wrong, it is historical)

## WHAT THE PARENT EVIDENCE CLAIMED (t66 result.json, `measurements.artifact_wide_26_origin`)
"the packed artifact stores the bundle twice: `dist/index.js` (13 comments) + the packer-generated
`validator.js` (13 comments) = 26" — i.e. a second, artefact-wide way a 26 total appears.

## WHAT IS TRUE, MEASURED NOW (three conventions, both files, so the ambiguity dies)
$ grep -c '^// '                        → index.js 13   | validator.js 16
$ grep -cE '^// .*\.(ts|js)$'           → index.js 13   | validator.js 13
$ grep -o '// [A-Za-z0-9_./-]*\.ts' | wc -l → index.js 13   | validator.js 13
$ distinct module paths (sort -u)       → index.js 11   | validator.js 11
file identity: packages/mpd-ext-plugin/dist/index.js 152,855 B (mtime 09:33:52);
               dist/mpd-package/packages/mpd-ext-plugin/dist/validator.js 153,262 B (mtime 10:56:59)
the three extra `^// ` lines in validator.js are the packer's own shim note, not module paths:
  3920:// Appended by scripts/pack-mpd.mjs (VALIDATOR_SHIM_EXPORTS): the packed CLI's view of
  3921:// this compiled validator, whose own export block exposes only the plugin surface. Do not
  3922:// edit the packed copy — it is regenerated on every pack.

## CONSEQUENCE
- 13 (index.js path comments) + 13 (validator.js path comments) = 26 ONLY by restricting both files
  to the path-comment subset; the natural `^// ` count gives 13 + 16 = 29. Neither sum is a stable
  description of "the artifact", so the artefact-wide origin is RETIRED as an explanation of the
  manual's number. (The captain's "validator.js = 16 path comments" is likewise imprecise: 16 is ALL
  `^// ` lines there; the path comments are 13 / 11 distinct.)
- The ONLY measured origin of the 26 that survives: **13 differing positions × 2 sides of a diff**
  (13 `<` lines + 13 `>` lines), which is exactly what the landed §6 sentence says:
  "ALL 13 differ between the two forms, so a `diff` of the two comment lists prints 26 lines
  (13 removed + 13 added), not one banner line".
- The artifact's first line is NOT an entry banner — it is the first inlined module's comment
  (`// packages/mpd-dsh-adapter-plugin/src/index.ts`, in both forms), so "not one banner line" is
  literally true and "every path comment is rewritten relative to CWD" is the mechanism.

## EDIT IMPACT
§6 REQUIRES NO CHANGE. The landed sentence names the diff origin only, which the retirement above
confirms as the correct one; the retired claim lived in this task's evidence, not in the manual.
