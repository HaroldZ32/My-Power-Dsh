CHECKER CHANGE LOG — `evidence/extensions/docs-claims/check-citations.mjs`
Declared by qa-lane-engineer (the file's only author in this wave) on the captain's request, 2026-09-17T03:40Z.

REVISION TABLE (all four measured; every change is MINE — no third party edited this file in the window)
  R0  pre-wave (git HEAD)  sha256 471aec42e0644ad28ce7bc3716ead64bffaef58bcc1b94ce9945c85597d6578e  24,021 B
  R1  sha256 5e56c82c25038b5a78878ad07a2289c7cd4e65324f04d01eacbf60c8dc72de83  25,530 B  mtime 10:34:53
      CHANGE SET 1 — T-53 output plumbing (see below). +1,509 B.
  R2  sha256 e332da7013ed828be1bf9806895fb27085f2ca43c2776e4c7d9377396bc64ed8  28,116 B  mtime 11:04:43
      CHANGE SET 2 — T-55 symbol-first verification, MID-EDIT SEQUENCE (helpers + fixtures landed first).
  R3  sha256 dfe260902b8ec1f1e8f0858126ea5466c0915563fbd231a898179f28c66da65c  30,345 B  mtime 11:07:02  [CURRENT]
      CHANGE SET 2 complete (loop branch + counter + report field).
  R2 and R3 are two snapshots of the SAME edit sequence (11:04–11:07 local), not two semantic revisions: the
  branch, the counter and the report field were written after the helper block. Whole diff vs R0: +99 −8 in 11 hunks.

CHANGE SET 1 — T-53 IMMUTABLE-BY-DEFAULT OUTPUT PLUMBING. Touches NO check rule.
  WHAT: imports the shared helper (`exitOnRefusal, refuseOverwrite, resolveOutputDir, timestamp,
        writeImmutable` from `skills/dsh-qa/scripts/lib/immutable-output.mjs`); adds `--out <dir>` /
        `--out=<dir>` (`OUT_FLAG`/`OUT_EXPLICIT`/`OUT_ROOT`); routes the `--gates` raw files under
        `OUT_ROOT/raw`; replaces the two `writeFileSync(join(HERE, …))` writes with `writeImmutable`
        into `OUT_ROOT` plus a refusal path (`exitOnRefusal`); adds the report fields `output_root` /
        `output_target`; logs `evidence -> <OUT_ROOT>`.
  WHY: T-53's acceptance names this driver — a plain run used to rewrite the canonical
       `result.json`/`output.log` next to the script on EVERY run, so a re-run silently replaced the
       artifact of record. Now a plain run lands in a fresh `runs/run-<ts>/` directory and an
       explicit `--out` whose files exist is REFUSED (exit 3).
  CHECK RULES: unchanged. No assertion, grammar, tolerance or target set moved in this set.

CHANGE SET 2 — T-55 SYMBOL-FIRST FORM MADE EXPLICIT *AND* FALSIFIABLE. This DOES change a check rule; declared.
  WHAT: new `symbolOnlyClaimCheck()` + `citedFileText()`; a new branch in the citation loop for
        `citation.kind === "path" && citation.line === undefined` (a line-less path citation that
        carries a claim must find that claim in the WHOLE cited file, else FAIL); `symbolOnlyVerified`
        counter + `symbol_only_anchors_verified` in the report; `negativeControl()`'s maker
        generalized to take the whole anchor clause + TWO new arms (`symbol-first-present` must exit 0,
        `symbol-first-absent` must exit 1) + a `reportedEvidence()` helper.
  WHY (measured, not assumed): the claim grammar has always allowed the line to be omitted
       (`CLAIM_PATTERN`'s `(?::(\d+)…)?`), but the content arm only fired for citations that CARRY a
       line — so a line-less anchor was ACCEPTED AND SILENTLY UNCHECKED. `anchor-form-experiment.mjs`,
       arm B: `` `gammaSymbol`, `src/probe.ts` `` (a symbol that exists in NO file) exited 0 before the
       change and exits 1 after. That is the "gate that lies" shape, and it is the form docs-gate-engineer
       asked about for their anchor repair.
  CHECK RULES: **changed — one NEW failure mode added, nothing removed.** Claim-less bare paths and
       every line-anchored check behave exactly as before (the branch fires only when `line === undefined`).
  DID THIS MAKE ANY PREVIOUSLY-FAILING CHECK PASS? **NO — stated in those words**, with four proofs:
       (a) every doc FAIL this wave was LINE-ANCHORED (`the cited line/range does not carry the claim … (path:line)`),
           a path the new branch cannot touch;
       (b) the `content:anchors` verdict is `unclaimedAnchors === 0` (line 465) and neither of my counters
           feeds it — a positive count cannot flip it;
       (c) the FAIL count moved 6/12 (02:35Z) → 11/12 (02:57Z) BEFORE my first symbol-first edit (11:04 local),
           and the last one cleared with the DOCS' writes (mtimes 10:45 / 10:46 / 11:12) plus t50's own re-run
           reporting `EXTENSIONS-FOR-AGENTS.md` at 0 unresolved;
       (d) the two new fixture arms pin both directions, so the added rule is falsifiable, not decorative.

BOUNDARY NOTE (captain's call): this is verification support for the line-less FORM, not a change to any
document; if the captain classifies the symbol-first form as T-72 rather than T-55 durability, the choice is
(a) keep it — strictly additive — or (b) revert change set 2 before the closing run, which restores the
silent-pass behaviour and therefore re-opens the "gate that lies" hole. I will do either on instruction.

CLOSING-RUN BINDING (verify 4 read under this revision, the captain's rule 3)
  `node evidence/extensions/docs-claims/check-citations.mjs --out evidence/dsh-qa/red-lanes/20260917T023000Z-t21/out-033846Z`
  → exit 0, `12/12 checks passed, 0 failed, 249 citation(s) resolved, 0 pending, 12 illustrative`
  checker sha256 AT THAT RUN: dfe260902b8ec1f1e8f0858126ea5466c0915563fbd231a898179f28c66da65c
  (written into that run directory as `checker-sha256.txt`; ANY later edit of the checker voids this reading,
  which is what `t54` exists to re-judge on the frozen state.)
