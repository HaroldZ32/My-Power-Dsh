# Review CR-code3 — the `memberIdentityOf` doc-comment fix (T30): comment-only

- Reviewer: `rev-consume` (Reviewer) · row **T31** · wave 0.17.2 team · CodeRabbit round 1, src-comment Nit
- Loop: `loop-20261103T080819-5165ba` · contract `.mpd/plans/vedit-p0-followup.md` (frozen)
- Fix evidence: `evidence/cellwork/vedit-p0/followup/codereview/fork-bound-src/` (REPORT, pre-edit snapshot,
  comment diff, comment-coverage/package/typecheck logs, after-grep)
- My evidence: this directory (`01`..`06`)
- No code was edited; the only writes are this directory and the loop record.

## Assessment

**Risk level: LOW (none — comment-only).** The flag raised by T28 (itself from my T24 N1) is closed at the
source: the `memberIdentityOf` doc block now states what the code does — a forked Lead's new id is recorded
only when the churn heal runs, the heal SKIPS any session this predicate names as a member, so a fork whose
title names a seat is NEVER healed on that record and stays identified as that seat (seat-blocked,
fail-closed, borrowing no Lead ancestry) while the title keeps naming one. The claim is a comment-only
change, and I verified that mechanically rather than trusting the report: the pre-edit snapshot's sha256
(`06edf44c…`) is exactly the hash T28's tree-state log recorded for `team-store.ts`, the `diff -u` against
the current file contains no line that is not a `*` doc-comment line, the old phrases ("until its heal",
"still read as that seat", "until then") are gone from `packages/mpd-team-core-plugin/src/` (grep exit 1),
and the package suite still reports the identical 603 pass / 0 fail / 2905 expect / 42 files with
`verify-comment-coverage` and typecheck green. The CR1 and auth probes still pass, so behaviour is
unchanged. No finding.

## Judgment

- **The corrected doc block states what the code does — YES.** The new text (verified in
  `01-comment-only-verification.log`) says: "a FORKED Lead's NEW id is recorded only when the churn heal
  runs, and the heal SKIPS any session this predicate names as a member — so a fork whose title names a
  seat is NEVER healed on that record: it stays identified as that seat (seat-blocked, fail-closed,
  borrowing no Lead ancestry) while its title keeps naming one." That matches `healLeadBinding` (returns
  the record untouched when `memberIdentityOf(...).named` is true) and `callerIdentity` (a `named` session
  borrows no ancestry). It is consistent with the corrected T22 REPORT and the N6 wording fixed by T28.
- **No "until then / still read as that seat" claim remains in src — YES.** `grep -rn "until its heal|still
  read as that seat|until then" packages/mpd-team-core-plugin/src/` exits 1 (no matches); the exact words
  survive only in historical evidence (the T22 `diff.patch`, T30's own before logs/snapshot).
- **Comment-only — YES, measured.** The pre-edit snapshot `00-team-store.before.ts` hashes to
  `06edf44c9872a06399c9e71a008d9b3885c3e0538b949a9b2ccb793a8261386f`, exactly the `team-store.ts` value in
  T28's `05-tree-state.log`; the `diff -u` of that snapshot against the current file has three removed and
  five added lines, EVERY one of them a `*` doc-comment line (my filter for non-comment changed lines
  returns nothing); the resulting file hash is `46117455…`, matching T30's after-log. No code line moved.
- **Gates green.** `bun test packages/mpd-team-core-plugin` → **603 pass / 0 fail / 2905 expect / 42
  files** — the identical counts to the T22/T28 state (nothing behavioural changed); `bun run
  verify:comments` → VERDICT PASS, exit 0; `bun run typecheck` → exit 0. Both behaviour probes still pass
  (CR1 containment/identity and the T12 auth probe).

## Findings

None.

## Declined to judge

- **"seat-blocked" is jargon**, but the same sentence glosses it ("fail-closed, borrowing no Lead
  ancestry") and the surrounding block explains the direction; a reader cannot take it as a privilege
  claim. Not judged.
- **The old comment text in `t22-identity-and-journal/diff.patch`** is the historical patch artifact of
  the T22 row; the fix's evidence keeps the before state (`00-team-store.before.ts`), so history remains
  traceable without rewriting a patch. Not judged.
- The recorder flattens severities to `minor`; this report's ranking is authoritative.

## Verdict

**Approve.** The comment now matches the code, the deferred-heal claim is gone from `src`, the change is
mechanically comment-only, and the standing gates (comment coverage, typecheck, package tests) are green.

## Bounds of this review

- Comment-only row: no behaviour is claimed beyond "the tree still tests green and the probes still pass";
  no dist build (the captain integrates) and no live harness mount was part of this row.
- I read T30's REPORT and evidence, the before/current diff, the corrected doc block, and my own gate and
  probe runs; I did not re-read unrelated packages or the whole working-tree diff.
- No credentials, tokens or connection strings were encountered.

## Evidence index (this directory)

| file | what it proves |
|---|---|
| `01-comment-only-verification.log` | before snapshot hash = T28's tree-state hash; `diff -u` has no non-comment changed line; current hash = T30's after-hash; src grep for the old phrases exits 1; the corrected doc block verbatim |
| `02-package-tests.log` | `bun test packages/mpd-team-core-plugin` — 603 pass / 0 fail / 2905 expect / 42 files (identical to T22/T28) |
| `03-typecheck.log` | `bun run typecheck` — exit 0 |
| `04-comments.log` | `bun run verify:comments` — VERDICT PASS, exit 0 |
| `05-cr1-probe.log` | the CR1 containment/identity probe still passes — behaviour unchanged |
| `06-auth-probe.log` | my original T12 auth probe still passes — identity narrowing unchanged |
| `07-dist-comment-check.log` | my check that the dist carries no src comments (`NEVER healed`/`THE BOUND`/`seat-blocked` = 0 occurrences), so this comment-only edit cannot stale the built bytes |

NOTE — the directory also carries a concurrently-written set of logs from ANOTHER seat working the same
T31 row (`01-scope-and-diffstat.log`, `02-comment-only-proof.log`, `03-dist-comments.log`,
`04-phrase-grep.log`, `05-gates.log`, `06-dist-rebuild-proof.log`, all written at 16:23–16:25, after my
report). They are not mine and I did not rely on them; my conclusions rest on `01`–`07` above. Their
`04-phrase-grep` also shows that a broad "until then" grep hits UNRELATED packages
(`mpd-bundle-plugin`'s settings copy, `mpd-tui-adapter`'s contact comment) — the fork-bound claim is the
`memberIdentityOf`/heal wording only, and that is clean in `src` (my `01`).

