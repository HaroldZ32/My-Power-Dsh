// Minimal, SECRET-FREE reproduction of the credentials-staging defect that reddens
// `node skills/dsh-qa/scripts/preset-conformance.mjs` (real run) in this environment.
//
// Measured chain (evidence/dsh-qa/preset-conformance/2026-09-19T15-28-08.386Z/boot.log):
//   Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include):
//   failed to apply loader entry credentials (@deepseek-ai/dsh-credentials-local):
//   credentials-local: invalid document at /tmp/mpd-preset-main-…/home/.credentials.yaml:
//   DUPLICATE_KEY at line 9, column 1
//
// WHY: skills/dsh-qa/scripts/lib/credentials.mjs `mergeRefsEntry` looks for an EXISTING refs
// block with `/^refs:[ \t]*$/m`. The operator's real ~/.dsh/.credentials.yaml carries
// `refs: {}` (an INLINE map: 3 characters after the colon, measured), which that regex does
// NOT match; the flat-layout branch is skipped too (the document has `version:`), so the
// function falls through to its last line and APPENDS a second top-level `refs:` key — which
// the harness's strict YAML reader rejects as DUPLICATE_KEY, aborting the whole plugin tree.
//
// This file uses a SYNTHETIC document (no real credential material): one case with the
// inline `refs: {}` shape, one control with a bare `refs:` block.
import { mergeRefsEntry } from "../../../../../skills/dsh-qa/scripts/lib/credentials.ts"

const inlineShape = "version: 1\nrecords:\n  provider-a:\n    apiKey: \"REDACTED\"\nrefs: {}\n"
const blockShape = "version: 1\nrecords:\n  provider-a:\n    apiKey: \"REDACTED\"\nrefs:\n"

const countRefs = (text) => (text.match(/^refs:/gm) ?? []).length

const mergedInline = mergeRefsEntry(inlineShape, "SYNTHETIC_KEY", "REDACTED-VALUE")
const mergedBlock = mergeRefsEntry(blockShape, "SYNTHETIC_KEY", "REDACTED-VALUE")

console.log("[merge-repro] inline `refs: {}` -> top-level refs keys: " + countRefs(mergedInline)
  + (countRefs(mergedInline) === 2 ? "  <-- DUPLICATE: the harness reports DUPLICATE_KEY and the boot aborts" : ""))
console.log("[merge-repro] control bare `refs:`  -> top-level refs keys: " + countRefs(mergedBlock))
console.log("[merge-repro] merged inline document tail (keys only, values redacted):")
for (const line of mergedInline.split("\n")) {
  if (/^refs:/.test(line)) console.log("[merge-repro]   " + line.trimEnd())
}
process.exit(countRefs(mergedInline) === 2 && countRefs(mergedBlock) === 1 ? 0 : 1)
