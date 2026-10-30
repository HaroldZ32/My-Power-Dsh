# P1 Amendment 1 (post-verdict, non-behavioural)

**Verdict:** `rec-20261030T095928-f96977` PASS, loop `loop-20261030T092754-5de4b8`, task T4 completed.
**Frozen contract:** `.mpd/plans/cellwork-remediation-p1.md` (copy under
`evidence/cellwork/fix-activate/verifier/20261030T095541Z/cellwork-remediation-p1.md`).

The verifier recorded two Medium findings and two Nits; neither finding is an implementation defect.
This amendment records the contract-owner dispositions. It changes no shipped behaviour and no test.

1. **A2 wording.** "Phase stays split" means the phase is LEFT UNCHANGED (it never regresses): `split`
   on a first activation, `executing` on a partial RE-SPLIT of an executing cell. The implementation and
   all four doc twins (docs-qa D1) state this; `activatedRevision` is not set by a partial pass.
2. **A3 wording.** The "already materialised" refusal is FORWARD-ONLY: a re-activation is refused when
   the accepted revision is not greater than the recorded one; a retry of the in-flight accepted
   revision is allowed by the resume arm. Implementation and docs agree.
3. **Declared arm gap (Medium, non-blocking).** No P1 arm exercises a partial RE-SPLIT resume; §4 arms
   1–7 inject on a first activation. This is a P1 declared bound. The follow-up arm belongs to P2, which
   owns the re-split/dispatch surface; the docs' generic resume sentence is scoped by this bound.
4. **Loop-scope audit (Nit).** The verify loop's declared scope omitted `test/cellwork.test.ts` (the
   contract-required A5 arm) and `dist/index.js` (the captain's pinned rebuild). Both are sanctioned by
   §4/A5 and §6; the verdict basis is unaffected. The loop record is immutable; this note is the audit
   trail.
5. **Evidence wording (Nit).** The writer's report statement about the four doc twins' mtime cannot be
   established after the fact; the docs lane's own evidence (`docs/20261030T095152Z/`) is the authority.
   No impact on the verdict.
