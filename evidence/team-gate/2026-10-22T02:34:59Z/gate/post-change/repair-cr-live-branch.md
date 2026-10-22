# T13 — live case accepts the model-approved branch for a triggered mechanical side

Task: `T13` (repair). Scope: `skills/dsh-qa/scripts/session-start-team.ts` only.

## The false red

The live run on the CR build failed on the CJK positive side for a LEGITIMATE product behaviour, not
a gate bug:

```
fired line: signals=B/C/E mode=mechanical staged=1 plan=plan-20261022054701987-k1ob-001 sensitivity=easy
then: the model extended and APPROVED the shell as the shipped notice instructs
      stagedPlans=0, team record team-20261022055150253-k1ob-002
old problems: "a triggered mechanical side must stage EXACTLY ONE plan slot, got 0"
              "a STAGED plan is NOT a spawned team: … must hold ZERO records, got 1"
```

The old assertions contradicted the shipped gate notice, which TELLS the captain to extend and
approve the plan itself. Both fates are correct outcomes of the same fire.

## The fix (`evaluateSide` + its inputs)

- `TeamStageScan` gained `recordPlanIds`: `teamStageScan` now decodes every `.mpd/team/teams/*.json`
  and reports the `planId` each record carries (an unreadable record or one predating the field
  contributes no id, never a throw). The approval copies the shell's id into the record, which is
  what makes "the model approved THIS shell" provable.
- `LiveSideInput` gained `firedPlanId` (the plan id parsed from the row's OWN fire line);
  `SideVerdict` gained `branch: "staged" | "approved"`.
- The mechanical branch now requires, in order: the notice taxonomy clauses and exactly one notice
  plan id (unchanged); a NON-EMPTY fired plan id ("neither branch can be proven without it"); then
  EITHER
  - `stagedPlans === 1 && records === 0`, the slot carrying the fired id and 0 members / 0 tasks
    (`branch: "staged"`), OR
  - `stagedPlans === 0 && records === 1 && recordPlanIds.includes(firedPlanId)`
    (`branch: "approved"`).
  Anything else reddens with a message naming both counts, both id lists and the fired id.
- The branch is recorded in each side's `results` entry and in its `sides/<label>/<i>/notices.json`
  evidence file, and in the folded `steps.verdicts` entries for the mechanical sides.

## Non-vacuity (self-test arms, all in `--self-test`)

- PASS `staged` — one matching shell, zero records.
- PASS `approved` — no slot, one record carrying the FIRED plan id (the live CJK positive's shape).
- RED a record carrying a DIFFERENT plan id (a spawned team that is not this shell's approval).
- RED a workspace with NEITHER branch (no slot, no record) on a fire line.
- RED a fire line that names NO plan id.
- RED the staged slot naming a different id; RED a leaked notice on an untriggered side; RED the
  non-shell staged plan (pre-existing arms kept).
- The stage-scan probe now also proves `recordPlanIds` reads the field and that an absent field
  contributes nothing.

## Observed results (quoted)

$ node skills/dsh-qa/scripts/session-start-team.ts --self-test
  [session-start-team self-test] ok: … the LIVE verdict and the REAL `.mpd/team` stage scan were each
  driven offline BOTH ways (a matching shell passes as `staged`; the MODEL-APPROVED shape passes as
  `approved` only when the record carries the fired plan id; a mismatched record id, neither-branch
  workspace, missing fired id, plan-id mismatch, leaked notice and non-shell staged plan all redden) …
  selftest_exit=0

$ bun run typecheck
  $ tsgo --noEmit
  (exit 0)

## Honest bound

`--self-test` is the OFFLINE contract: it proves the two-branch verdict and every falsifier, not the
live harness behaviour. The captain reruns the live case. `dist/` NOT rebuilt.
