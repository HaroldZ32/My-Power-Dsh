# Review CR-code2 — the fork-bound wording fix (T28): documentation only

- Reviewer: `rev-consume` (Reviewer) · row **T29** · wave 0.17.2 team · CodeRabbit round 1, docs Nit
- Loop: `loop-20261103T080819-5165ba` · contract `.mpd/plans/vedit-p0-followup.md` (frozen)
- Fix evidence: `evidence/cellwork/vedit-p0/followup/codereview/fork-bound/` (REPORT, before/after greps,
  corrected excerpts, tree state)
- My evidence: this directory (`01`..`04`)
- No code was edited; the only writes are this directory and the loop record.

## Assessment

**Risk level: LOW (none — documentation).** The Nit I raised in review CR-code (N1) is closed: the T22
REPORT's fork-bound sentence now states what the code does — the churn heal SKIPS any session the identity
plane names as a member, so a fork whose title names a seat is NEVER healed on that record and stays
identified as that seat (seat-blocked, fail-closed, borrowing no Lead ancestry) for as long as the title
keeps naming one — and the N6 README wording (EN and zh-CN) in the same report was restated consistently,
so the release docs can be copied verbatim without re-introducing the deferred-heal implication. The old
phrases ("until then", "still read as that seat", "until the heal records it") are gone from the T22
REPORT (scoped grep: exit 1, no matches). T28's own tree-state log records the src/test hashes at its run,
and its delta is the report file only. The one divergence in the tree NOW — `team-store.ts`'s hash — is
T31's separate comment-only edit (verified in review-cr-code3), not T28's.

## Judgment

- **The corrected fork-bound sentence — YES, and it is accurate.** It says the `healLeadBinding` skip
  ("the heal is SKIPPED for any session the identity plane names as a member") is the mechanism, a
  seat-naming fork is "NEVER healed on that record", it "stays identified as that seat (seat-blocked,
  fail-closed: it can borrow no Lead ancestry) for as long as the title keeps naming one". That matches
  `memberIdentityOf` (a `named` session → `callerIdentity` ancestry `[]`) and `healLeadBinding` (a `named`
  session returns the record untouched). The correction is marked in place ("CORRECTED 2026-11-03, T28")
  rather than silently rewritten — appropriate for an evidence report.
- **The N6 wording is consistent.** The EN clause and its zh-CN twin say the same thing as the bound:
  the new id is recorded only when the churn heal runs, the heal skips a session the identity plane names
  as a member, such a fork is NEVER healed and stays identified as that seat, fail-closed. The T22
  report's earlier line ("not recorded until its heal writes `leadHistory` … still read as that seat") is
  gone from the N6 block.
- **The old phrase is gone from the report.** My scoped grep on the T22 REPORT for "until the heal records
  it|until its heal writes|until then|still read as that seat|not recorded until its heal" exits 1 (no
  matches); `01-doc-verification.log`. The phrase still lives in two legitimate places: the T22
  `diff.patch` (the historical patch artifact of that row) and T28's/T30's own evidence logs (which quote
  it to explain the fix), plus my T24 review (which raised it).
- **Documentation only.** T28's `05-tree-state.log` pins the four touched src/test files (team-actions,
  team-store, identity-plane, codereview-cr1); my re-hash shows team-actions/identity/cr1 IDENTICAL to
  that state and team-store equal to T30's after-comment hash — the only change since T28 is T31's
  comment-only edit. The shared gates on this tree are green (603/0/2905/42; the CR1 and auth probes still
  pass), which is consistency, not a code claim.

## Findings

None. The documentation Nit is closed as asked.

## Declined to judge

- **The src comment at `team-store.ts` (~1297)** carried the same deferred-heal imprecision. It was
  out of T28's scope by the captain's ruling and is fixed separately by T30 — reviewed under T31
  (`review-cr-code3`), PASS. Not counted against T28.
- **The old phrase in `t22-identity-and-journal/diff.patch`** is the historical patch artifact of the T22
  row, not the report; rewrites of evidence patches are not owed. Not judged.
- The recorder flattens severities to `minor`; this report's ranking is authoritative.

## Verdict

**Approve.** The fork-bound and N6 wording now state the heal's skip and its permanent, fail-closed
consequence; the stale phrase is gone from the report; nothing but documentation changed.

## Bounds of this review

- Documentation-only row: no code behaviour is claimed beyond the shared gates (package 603 pass / 0 fail
  / 2905 expect / 42 files; typecheck and comment-coverage green on the loop). No dist build (the captain
  integrates) and no live harness mount were part of this row.
- I read the T22 REPORT (bounds + N6 blocks), T28's REPORT and its greps/tree state; I did not re-read
  unrelated evidence or the whole working-tree diff.
- No credentials, tokens or connection strings were encountered.

## Evidence index (this directory)

| file | what it proves |
|---|---|
| `01-doc-verification.log` | current hashes vs T28's tree state, file mtimes, and the scoped greps: the T22 REPORT carries none of the old phrases (grep exit 1) |
| `02-package-tests.log` | shared-tree sanity: `bun test packages/mpd-team-core-plugin` — 603 pass / 0 fail / 2905 expect / 42 files |
| `03-cr1-probe.log` | the CR1 behaviour probe still passes on this tree |
| `04-auth-probe.log` | my original T12 auth probe still passes on this tree |
