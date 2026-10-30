# P1 Amendment 2 (post-repair, bookkeeping)

The independent repair verdict `rec-20261030T121930-1ae95a` (PASS, loop
`loop-20261030T120704-d6260c`) judged the three PR #80 CodeRabbit findings **FIXED**. This amendment
records the one contract wording it supersedes and the one known bound it flagged. No shipped code or
documentation changed after the verdict (the verified revision equals the merged revision).

1. **A3's third bullet is superseded (F2).** The in-flight rule is FORWARD-ONLY: a STRICTLY GREATER
   accepted revision supersedes an older `activationInFlight` (journal `activation-in-flight-superseded`;
   the older partial is abandoned and reconciled through the existing kept/dropped/cancelled path), a
   LOWER revision is refused, and the same revision resumes. The F2 arms and the repair verdict cover it.
2. **Docs precision (verifier Nit, non-blocking).** The four P1 doc twins name the PRE-UPGRADE cell as
   the motivating case; the shipped F1 predicate is kept + contract-no-longer-placeholder (a current cell
   that lost its `activatedLoops` checkpoint after arming is also skipped). The docs do not over-claim;
   this note records the broader predicate.
