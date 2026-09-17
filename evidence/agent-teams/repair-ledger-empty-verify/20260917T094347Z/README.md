# Ledger gate on a repair contract with an EMPTY `verify` list — measured, with controls

**Lane A (task-contract tooling) · measured 2026-09-17T09:43:47Z · module revision
`packages/mpd-agent-teams-plugin/lib/quality-gates.js` sha256 `1b0eb60e61765f5eb55dfab94bdeed5fff916a4b8d2fb9081fde5ec9ed4f4ad6` (unchanged from the wave-2a revision).**

## What ran

`node evidence/agent-teams/repair-ledger-empty-verify/20260917T094347Z/arm.mjs` — imports the REAL module in place (never a copy) and calls
`evaluateQualityCompletion` on a synthetic `kind=repair` task whose contract declares **zero verify
commands**, which is the shape `t3` failed on.

```
MODULE /root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib/quality-gates.js (resolved from this script, not from cwd)

A  verify=[]      + commandsRun OMITTED   (the t3 shape)
    -> {"ok":false,"error":"repair completion requires a passed commandsRun entry for every verify command"}
B  verify=[]      + commandsRun=[]        (same shape, explicit empty list)
    -> {"ok":true}
C  verify=[1 cmd] + commandsRun OMITTED   (control: the message SHOULD be about a command)
    -> {"ok":false,"error":"repair completion requires a passed commandsRun entry for every verify command"}
D  verify=[1 cmd] + that command FAILED   (control: must fail the task)
    -> {"ok":false,"error":"verify failure must fail the task","requiredStatus":"failed"}
E  verify=[1 cmd] + that command PASSED   (control: must complete)
    -> {"ok":true}
```

## The finding

1. **REPRODUCED.** Case **A** (the `t3` shape: `verify=[]`, `commandsRun` omitted) is refused with
   *"repair completion requires a passed commandsRun entry for every verify command"* — the exact
   refusal `t3` recorded. The message names commands that do not exist in the contract, which is why a
   read-only seat reads it as an unsatisfiable ledger gate.
2. **THE GATE IS SATISFIABLE — case B, exactly `{"ok":true}`.** Passing an EXPLICIT empty list
   (`commandsRun: []`) completes the task. The predicate in `evaluateQualityCompletion()` (`quality-gates.js`, revision sha256 `1b0eb60e61765f5eb55dfab94bdeed5fff916a4b8d2fb9081fde5ec9ed4f4ad6`) is
   `commands === undefined || !verifyCovered(task.verify, commands)`, and `verifyCovered([], [])` is
   **true** (an `every` over an empty requirement set). So nothing needs fabricating: a seat that ran no
   commands passes `[]`, which is the truthful report.
3. **THE TWO CONTROLS HOLD**, so the branch is not weakened: with a REAL verify command the same message
   is accurate (case **C**), a FAILED command still fails the task with
   `{"ok":false,"error":"verify failure must fail the task","requiredStatus":"failed"}` (case **D**), and
   a PASSED command still completes (case **E**).

## Remedies, cheapest first

1. **No code change — the exit for `t3` and for any future seat with this shape:** complete with
   `commandsRun: []` when the contract declares no verify command and the seat ran none. `t3` itself is
   terminal (`failed`), so the captain still has to re-open/reassign it; whoever completes it can then
   pass `[]`, or the two read-only commands if that seat has bash.
2. **Code fix in this lane (~7 lines, message-only):** split that branch so the missing-list case
   and the uncovered-command case carry DIFFERENT texts, the first saying `commandsRun` is missing and
   naming the empty-verify form as the correct payload. See `PATCH-PROPOSAL.md` (prepared, NOT applied:
   this lane holds no task in wave 2b, and the file sits inside the plan's write sets).
3. **Contract-level:** a repair handed to a mechanically read-only seat should either name a verify
   command its dispatcher will run, or state `commandsRun: []` as the expected completion payload.

---

## EXTENSION, 2026-09-17T09:52Z — the KIND MATRIX, two seats

`code-reviewer` independently measured this gate and refined it to a kind matrix
(`evidence/review/gate-ledger/20260917T095500Z/arm-full.out`). `arm-matrix.mjs` / `arm-matrix.out.txt`
in THIS directory re-derive it over all seven `TASK_KINDS` from the same module revision
(`quality-gates.js` sha256 `1b0eb60e61765f5eb55dfab94bdeed5fff916a4b8d2fb9081fde5ec9ed4f4ad6`):

| kind | `verify=[]` + `commandsRun` omitted | + `commandsRun: []` | one FAILED command |
|---|---|---|---|
| implementation · verification · **repair** · integration | **REFUSED** ("… requires a passed commandsRun entry for every verify command") | `{"ok":true}` | **REFUSED** (`verify failure must fail the task`, `requiredStatus=failed`) |
| review · requirements | REFUSED — by the **verdict** rule, not the ledger ("… cannot complete without verdict=pass") | same | same |
| **work** (and any non-kind value such as `plan`) | `{"ok":true}` | `{"ok":true}` | `{"ok":true}` |

Two precisions this adds to the first reading: (i) for `review`/`requirements` the **verdict gate sits in
front of** the ledger exemption, so the exemption is observable only with a valid verdict; (ii) **`plan` is not
a task kind** — `TASK_KINDS` is `requirements, implementation, verification, review, repair, integration, work`,
so the 2b plan task is `kind=work`, and the completion gate never validates the kind (it trusts the stored value).
