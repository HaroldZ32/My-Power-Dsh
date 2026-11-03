# T30 — the deferred-heal claim in the `team-store.ts` doc comment is corrected

- Wave: 0.17.2 team · row **T30** (comment-only repair; source row T28) · loop `loop-20261103T080819-5165ba`
- Basis: the src-comment FLAG in `../fork-bound/REPORT.md` (raised by T28, itself from T24's N1)
- Owner: `se-consume` (Senior Engineer) · Date: 2026-11-03
- Evidence: this directory (`evidence/cellwork/vedit-p0/followup/codereview/fork-bound-src/`)
- **Comment-only change.** No behaviour, no test change.

## What changed

`packages/mpd-team-core-plugin/src/team-store.ts`, the `memberIdentityOf` doc block (~line 1297), said:

```
 * THE BOUND: a FORKED Lead's NEW id is not recorded until its heal writes `leadHistory`, so a fork whose
 * title names a seat is still read as that seat until then (the T12 residual) — a separate discriminator,
 * not a fact this arm can decide.
```

That "until then" implied the heal would eventually run — but `healLeadBinding` SKIPS any session
`memberIdentityOf` names as a member, so a fork whose title names a seat is NEVER healed on that record.
The comment now states what the code does:

```
 * THE BOUND: a FORKED Lead's NEW id is recorded only when the churn heal runs, and the heal SKIPS any
 * session this predicate names as a member — so a fork whose title names a seat is NEVER healed on that
 * record: it stays identified as that seat (seat-blocked, fail-closed, borrowing no Lead ancestry) while
 * its title keeps naming one. That is the T12 residual — a separate discriminator, not a fact this arm
 * can decide.
```

The substance is unchanged and was already fail-closed (no authority leak); only the sentence was loose.
The wording now matches the corrected T22 REPORT and the N6 README clause (`../fork-bound/REPORT.md`,
`../t22-identity-and-journal/REPORT.md`).

## Comment-only, checkable

`01-comment-diff.log` is a `diff -u` of the pre-edit snapshot (`00-team-store.before.ts`) against the
current file: **three comment lines removed, five comment lines added, nothing else** — no code line
touched. `05-after-grep.log` shows the old phrases (`until its heal`, `still read as that seat`, `until
then`) are GONE from `packages/mpd-team-core-plugin/src/` (grep exit 1), and records the before/after
sha256 of the file (`06edf44c…` → `46117455…`).

## Gates (all exit 0, logs here)

| Gate | Command | Observed |
|---|---|---|
| Comments | `node scripts/verify-comment-coverage.ts` | `… VERDICT: PASS …`, **exit 0** — `02-comments.log` |
| Package tests | `bun test packages/mpd-team-core-plugin` | **603 pass / 0 fail**, 2905 expect(), 42 files — `03-package-tests.log`, exit 0 (IDENTICAL to the T22 run: no test or behaviour changed) |
| Typecheck (extra) | `bun run typecheck` | `tsgo --noEmit`, no output, **exit 0** — `04-typecheck.log` |

No git write; no dist build.

## Evidence index

| file | what it shows |
|---|---|
| `00-team-store.before.ts` / `00-before.log` | the pre-edit file and the old comment with its sha256 |
| `01-comment-diff.log` | `diff -u before current` — comment lines only |
| `02-comments.log` | the standing declaration gate PASS |
| `03-package-tests.log` | 603/0 — the same counts as T22, proving the tree is otherwise identical |
| `04-typecheck.log` | typecheck exit 0 |
| `05-after-grep.log` | old phrase gone from src + the after sha256 |

## Bounds

- Comment-only: the gates above prove the tree still compiles and the suite is unchanged; they do not
  re-prove the identity behaviour, which T12/T16/T22 already established and which this edit cannot alter.
- `../review-cr-code/REPORT.md` (the historical T24 review) still quotes the old sentence by design — it is
  the Nit's evidence and was not rewritten.
