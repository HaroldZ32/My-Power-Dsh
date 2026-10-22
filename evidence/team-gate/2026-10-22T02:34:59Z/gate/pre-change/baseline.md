# R1 pre-change baseline (2026-10-22, Asia/Shanghai)

Captured BEFORE any R1 source edit landed. Three independent observations, in the order they were
taken. The live run was TIMEBOXED and killed mid-run (the captain's integration runs the full case
after the dist rebuild), so its bound is stated exactly.

## 1. The existing offline QA self-test — PASS

`node skills/dsh-qa/scripts/session-start-team.ts --self-test` exited 0 on the untouched tree
(observed 2026-10-22; the corpus table printed `simple=false`, `soft-complex=true`,
`explicit=true`, `cjk-positive=true signals=["E"]`, all three `cjk-negative=false`, and the FOUR
negative controls reddened). That self-test was re-run AFTER the change and its full output is at
`../post-change/self-test.log`.

## 2. The user's verbatim first message fired ZERO signals

Run against the PRE-CHANGE `packages/mpd-roles-plugin/src/complexity-gate.ts`:

```
han=77 verdict={"trigger":false,"signals":[]}
resolveGateMode(undefined)= mechanical
```

The message carries 77 Han characters (`\p{Script=Han}`, the gate's own measure — the request
described it as 139; the discrepancy does not change the diagnosis, because 77 is still above E's
60-character NORMAL bound). The message was silent ONLY because its verbs (降低/触发/创建/规范)
were outside the 24-verb lexicon — exactly the root cause the captain reported.

## 3. An isolated live boot DID mount the gate and FIRE on an unambiguous prompt

The real live case (`node skills/dsh-qa/scripts/session-start-team.ts`, isolated `DSH_HOME` +
sandbox `HOME` + sandbox workspace) was started and timeboxed. It completed the CJK positive side
and two of the three CJK negative prompts before it was killed (its end-of-run settle hash would
have been invalidated by the edits anyway; no `result.json` was written). Its PER-SIDE artifacts
survive under
`session-start-team-2026-10-22T02-34-59.451Z/sides/`, and the positive side is the required proof
that the gate fires in a real boot:

```
sides/cjk-positive/0/notices.json:
  bootLine  = "[mpd-roles] team plane: readOnlyGuard=installed deny=8 captainInvestigation=deny
               delegationGate=deny verifyGate=absent reason=withdrawn:2026-10-17-user-ruling(verify.mode)
               askUserQuestion=installed rosterSection=agent-scoped order=605 sessionGate=mechanical"
  firedLine = "[mpd-roles] session gate fired for agent "session-96a760a2-…" signals=E
               mode=mechanical staged=1 plan=plan-20261022023558115-uiv1-001"
```

Two CJK negatives (`sides/cjk-negative/0`, `/1`) carry `firedLine: ""` — mounted and silent.

BOUND: the run was killed before the remaining sides, so this is a partial live baseline, not a
full live PASS. The last full live PASS on this case is recorded at
`evidence/dsh-qa/session-start-team/2026-10-20T08-13-55.470Z/` (15 sides, `ok=true`).

## 4. The captain's own session log (reported, not measured here)

`.mpd/logs/mpd-roles.log` 2026-10-22T02:05:40Z/02:05:44Z: the gate was mounted
(`sessionGate=mechanical`) and the listener registered for the captain's session, yet the first user
message fired nothing — the same class observation 2 pins at the predicate level.
