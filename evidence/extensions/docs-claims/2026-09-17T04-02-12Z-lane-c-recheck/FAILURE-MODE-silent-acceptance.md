# The failure-mode declaration for the docs-claims driver's symbol-first branch (t21 / T-72 core)

**ADDITIVE RECORD.** `t21` is terminal (closed by captain takeover); this file is added beside the
growth accounting, not written into any closed task's artifact. Nothing here overwrites anything:
the run dir already holds `result.json`/`output.log` from the `--out` run and
`growth-accounting.{mjs,txt}`.

## What the failure mode actually was: SILENT ACCEPTANCE

A line-less anchor of the form `` `SYMBOL`, `path/to/file.ts` `` — a claim with **no line number** —
was *accepted by the gate and never checked*. The citation resolved (the path exists), the arm that
verifies content only fired for citations that CARRY a line, and so the anchor passed on presence
alone. Measured before the fix: a claim naming **`gammaSymbol`, which exists in no file, exited 0**
(the `anchor-form-experiment.mjs` arm B in `evidence/dsh-qa/red-lanes/20260917T023000Z-t21/`). That
is the "gate that lies" class this wave keeps finding: not a false FAIL, a false PASS.

## What the fix is, and what it can newly fail on

At revision **`dfe260902b8ec1f1e8f0858126ea5466c0915563fbd231a898179f28c66da65c`** (30,345 B):

- `symbolOnlyClaimCheck(citation, claims, fileText)` fires ONLY for a claim entry whose
  `path === citation.value` and whose `line`/`endLine` are both `undefined`; it then requires the
  claim's text to appear **verbatim in the whole cited file** (`citedFileText` reads the file, and
  answers `""` for a missing path, a directory or an unreadable file).
- **NEW failure modes (declared, not latent):** (1) a line-less citation whose claim is absent from
  the cited file now FAILS — the mode above; (2) claim text that is neither a symbol nor a quoted
  phrase (or shorter than 2 characters) FAILS; (3) a line-less citation to a missing/directory/
  unreadable path FAILS the claim check.
- **Unchanged:** a line-less PATH citation that carries NO claim (`return null` → the caller leaves
  it alone), and every line-anchored check.
- Pinned falsifiably by two negative-control arms — `negative-control:symbol-first-present` (exit 0)
  and `negative-control:symbol-first-absent` (exit 1, "does not contain the claim") — which is what
  makes the durable half of T-72 available in wave 1 rather than deferred.

## Cross-reference and the remaining line-anchored set

Independent re-verification under this same revision, by the lane that owns the affected document:
`evidence/gates/extensions-unanchored-refs/20260917T033233Z-recheck-dfe26090/RECHECK-t57-under-moved-driver.md`
(read on disk: it pins the driver revision and reports `EXTENSIONS-FOR-AGENTS.md` 59 citations /
55 checked / `content:anchors` 46 verified / 0 unresolved, driver exit 0, 12/12). That file's own
lesson — pin the driver revision with every reading — is why this directory exists.

**If the five remaining line-anchored refs are ever converted to the line-less form**, expect the
VERIFICATION ROUTE to change while the checked count stays put: the anchor stops being verified
against one line and starts being verified against the whole file's text. Two consequences a
conversion must measure rather than assume: (a) a converted claim whose symbol/phrase is not
verbatim in the cited file will FAIL where the line-anchored form may have passed via the line-arm,
and (b) `symbol_only_anchors_verified` in the report is the counter that must move, not the total.
That is the intended strictness of the branch, not a regression — and it is exactly why the
conversion needs a contract (docs-gate-engineer's plan) rather than a drive-by edit.
