# W1-C — repair the QA dispatch-guard arms for the owner-only default

Lane: Senior Engineer (board row T9), the wave's SINGLE SKILLS WRITER (`skills/**`).
Contract: `.mpd/plans/autoproject-refactor.md` §4.4 (owner-only dispatch becomes the DEFAULT; the
positional/roster fallback survives only under an explicit `mode:"roster"`) and W1-A's shipped change.

## 1. The defect this repairs

W1-A flipped `planDispatch`'s default from positional substitution to `owner-only`. Five arms in
`skills/dsh-qa/scripts/team-dispatch-guard.ts` call the pure pairing seam DIRECTLY with fixtures whose
tasks carry no `owner` (they were written to test the C7 SEAT guard, not the pairing rule). Under the
new default the pass refuses those rows for the WRONG reason ("the row declares no owner — owner-only
dispatch never substitutes a member"), so the arms stopped measuring what their names claim.

## 2. The change — mode argument only

`skills/dsh-qa/scripts/team-dispatch-guard.ts`, five call sites, one argument each:

| arm | call site | why it needs the explicit roster rule |
|---|---|---|
| (a) cross-team refusal | `const cross = planDispatch({…})` | proves the CROSS-TEAM seat guard; the fixture task has no owner, so owner-only would refuse it before the seat check |
| (b) write × read-only | `const readOnly = planDispatch({…})` | proves the WRITE-TASK-ON-READ-ONLY seat guard, same reason |
| (d) negative control | `const valid = planDispatch({…})` | must still PAIR, which owner-only cannot do without a declared owner |
| (b-real) | `const refused = planDispatch({…})` | real-store refusal arm |
| (d-real) | `const paired = planDispatch({…})` | real-store negative control |

`git diff --stat` = `1 file changed, 5 insertions(+), 5 deletions(-)`. No assertion, expected text or arm
name was touched; the shipped owner-only default is untouched (the fallback is reached only through the
explicit mode, exactly as §4.4 specifies). Nothing else under `skills/**` was edited in this task.

## 3. Sweep of `skills/dsh-qa/**` for other direct callers

`grep -rn "planDispatch\|dispatchOwnerOnly" skills/dsh-qa/` finds NO other call site: only
`team-dispatch-guard.ts` (the five above plus its import and a doc reference in `SKILL.md:135`).

Disposition of the repo-wide direct callers found while sweeping (all OUTSIDE this lane, reported only):

| caller | disposition |
|---|---|
| `packages/mpd-team-core-plugin/src/team-actions.ts` (`planDispatch({…})`) | CORRECT: it forwards the caller's `mode` and omits it otherwise, i.e. the new owner-only default — W1-A's lane |
| `packages/mpd-cellwork-plugin/src/{activate,protocol,protocol-core,dispatch}.ts` | NOT the team-store seam: they call cellwork's OWN private `dispatchOwnerOnly`, which was already owner-only by name — W2's lane, no accidental default flip |
| `packages/*/test/*.ts` fixtures | W1-A / W2 lanes own them |
| `dist/mpd-package/skills/…` and `evidence/**/probe*.ts` | a packed copy and historical probes — not live sources, not edited |

## 4. Observed results

- `bun skills/dsh-qa/scripts/team-dispatch-guard.ts --self-test` → **exit 0**,
  `SELF-TEST: PASS (17 arms: 4 C7-1..C7-3 seam assertions + 13 C7-4 arms incl. their negative controls)`,
  17 `ok  ` lines, 0 `FAIL` lines — `self-test.log`.
  Each arm still prints the sentence its claim names, e.g. arm (a) `refused a CROSS-TEAM pairing: task T1
  belongs to team-a while member "qa-reader-writer" belongs to team-b`, arm (b) `refused a
  WRITE-TASK-ON-READ-ONLY pairing: …`, arm (d) `[["T2","m-w"]]`.
- `bun run test:qa` → **exit 0**, final line `[test:qa] all self-tests passed`, ZERO
  `[test:qa] FAILED` lines — `test-qa.log`. (For contrast, the same suite on the pre-repair tree reported
  `FAIL - 1 of 55 case(s) failed` with `team-dispatch-guard.ts` as the ONLY red case; this repair is what
  turns that case green, and no other case reddened.)

## 5. What is not proven / limits

- The lane ran the OFFLINE falsifier (`--self-test`) and the offline QA sweep. The case's LIVE lane
  (`node scripts/run-qa-lanes.ts --only=team-dispatch-guard`, which needs a real `dsh`) was NOT run here;
  the live arms exercise the same registered-tool paths and would catch a composition-time regression the
  pure seam cannot see.
- `skills/**` is fingerprinted as one `VENDOR_LOCK.json` tree: this edit is part of the wave's single
  skills change and is covered by the ONE re-pin the captain runs at integration
  (`node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step`). No re-pin was run here.
