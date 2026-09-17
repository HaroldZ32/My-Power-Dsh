# t68 PREP — converting EXTENSIONS-FOR-AGENTS.md's line anchors to the symbol-first (line-less) form
# Queued by the captain after t26; contract NOT yet claimed. This note captures the protocol so it survives context.
# Sources: qa-lane-engineer's 04:2xZ message (the measured semantics) + my own rechecks.

## SCOPE (measured on the artifact, not inherited)
`grep -nE '\.(ts|js|mjs|yml|json|md):[0-9]+' EXTENSIONS-FOR-AGENTS.md` → **12 LINES** (12, 23, 24, 25, 26, 27,
36, 42, 116, 117, 141, 233) carrying **14 distinct `path:line` tokens**. Acceptance is written to ZERO
anchors; the token count is a BOUND, not a target. Current file: `9a157363a16bfeab…` / 15,684 B.

## THE SEMANTIC CAUTION (qa-lane-engineer, measured)
- The line-less form (`` `SYMBOL`, `path/file.ts` ``) verifies against the **WHOLE cited file's text**, not a
  line. The ROUTE changes; the checked count (55) should hold.
- (a) A converted claim whose symbol/phrase is **not verbatim** in the cited file FAILS where the
  line-anchored form could pass via its line arm ⇒ **convert one anchor at a time and re-run the driver
  between them** if the arithmetic must stay clean.
- (b) The counter that must move is **`symbol_only_anchors_verified`**, NOT the total. The falsifiable half
  is the two negative-control arms: `negative-control:symbol-first-present` (exit 0) and
  `…-symbol-first-absent` (exit 1) — cite the arms, not the prose.
- An anchor left **half-converted** (symbol text with a surviving line number) stays on the OLD, rot-prone
  route — the branch only fires when the claim entry carries no `line`/`endLine`.

## DRIVER DISCIPLINE (adopted after the driver moved twice under my readings)
- Pin the driver revision BEFORE and AFTER: `sha256sum evidence/extensions/docs-claims/check-citations.mjs`.
  Last pinned: `dfe260902b8ec1f1e8f548…` (full: `dfe260902b8ec1f1e8f0858126ea5466c0915563fbd231a898179f28c66da65c`, 30,345 B).
- Run with an explicit `--out=<my own evidence dir>` (never a bare run — that writes into the driver's
  default run dir, which is t21's tree).
- Quote per-file: `EXTENSIONS-FOR-AGENTS.md — N citation(s) (checked M: path …, dir …, command …; pending,
  illustrative), 0 unresolved` + `content:anchors — K verified` + `symbol_only_anchors_verified` + exit 0.

## SEQUENCING (external)
`EXTENSIONS-FOR-AGENTS.md` became a **REQUIRED root file of the packed artifact** under `t70`
(`REQUIRED_ROOT_FILES` in `scripts/verify-pack-closure.mjs`), so **t68 must land BEFORE the re-pack** —
afterwards the artifact carries a copy and any edit is real byte drift.

## EVIDENCE SHAPE
Whole-file sha pair + reverse-substitution identity check (the wave's standard for words-only claims),
before/after citation arithmetic, the arms cited, and the driver revision pinned at both ends.
