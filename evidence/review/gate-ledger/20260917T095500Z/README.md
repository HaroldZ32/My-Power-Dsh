# REVIEWER'S OWN ARM — the "zero verify commands" gate is KIND-SPECIFIC (peer verification of lane A's claim)

**Written:** 2026-09-17 · **Reviewer:** code-reviewer · **Module:** `packages/mpd-agent-teams-plugin/lib/quality-gates.js`, imported IN PLACE, sha256 `1b0eb60e61765f5e…` (same revision lane A used)
**Arm:** `arm-review-shape.mjs` · **Raw:** `arm-full.out` · **Origin:** lane A measured the REPAIR shape (`evidence/agent-teams/repair-ledger-empty-verify/20260917T094347Z/`); this arm falsifies the generalisation and answers it for the shape MY seat uses (`kind=review`).

## The matrix (all readings from the real module)

| kind | `verify=[]` + `commandsRun` OMITTED | `verify=[]` + `commandsRun: []` | one FAILED command in `commandsRun` |
|---|---|---|---|
| implementation | **REFUSED** — "implementation completion requires a passed commandsRun entry for every verify command" | `{ok:true}` | **REFUSED** — "verify failure must fail the task", `requiredStatus:"failed"` |
| repair | **REFUSED** (same message, "repair …") | `{ok:true}` | **REFUSED** (same) |
| verification | **REFUSED** (same, "verification …") | `{ok:true}` | **REFUSED** (same) |
| integration | **REFUSED** (same, "integration …") | `{ok:true}` | **REFUSED** (same) |
| **review / requirements** (WITH a valid verdict — see precision (a)) | **`{ok:true}`** | `{ok:true}` | **`{ok:true}`** |
| **work** (the wave's plan task's real kind) and a NON-KIND value | `{ok:true}` | `{ok:true}` | `{ok:true}` |

## PRECISIONS (verified after lane A's extension over all seven kinds)

**(a) The review/requirements row carries a precondition: a valid verdict.** My payloads already supplied `verdict: 'pass'`, so the readings above are reproducible as measured — but a bare payload of that shape is REFUSED by the verdict gate that sits IN FRONT of the ledger (`arm-verdict-precondition.out`): `review … noVerdict={"ok":false,"error":"review cannot complete without verdict=pass"}` and `requirements … noVerdict={"ok":false,"error":"requirements cannot complete without verdict=pass"}`. `work` and a non-kind value are `{ok:true}` with or without a verdict.

**(b) `plan` is NOT a task kind.** `TASK_KINDS` (`lib/types.js`) = `requirements, implementation, verification, review, repair, integration, work`; the wave's plan task is `kind=work`, which is ledger-exempt. A NON-KIND value such as `plan` also returns `{ok:true}` because the COMPLETION path does not validate the kind at all (measured: `kindOf=plan → {ok:true}`); `TASK_KINDS` is enforced elsewhere (the create/validate paths reference it). The `plan` row above is therefore corrected to `work (and a non-kind value)` — right in effect, for two different reasons.

Attribution: both precisions come from lane A's extension (`evidence/agent-teams/repair-ledger-empty-verify/20260917T094347Z/arm-matrix.mjs`); I re-measured them here, so the matrix is a two-seat instrument.

Review-specific readings (same arm): **no verdict** → `{ok:false,"error":"review cannot complete without verdict=pass"}`; **`verdict=needs_revision`** → `{ok:false,"error":"review with verdict=needs_revision cannot complete"}`; **no `acceptanceResults`** → `{ok:true}`.

## What this settles

1. **Lane A's no-code exit is CONFIRMED for the kind their finding was raised on** (t3 is a `repair`) and for the whole ledger-bearing family (implementation / repair / verification / integration): the truthful payload for a seat that ran nothing is an explicit **`commandsRun: []`** — omitting the field is what produces the "unsatisfiable" refusal.
2. **The defect is scoped**: the "requires a passed commandsRun entry for every verify command" refusal exists only for those four kinds. For **review / requirements / plan** even the omitted form is accepted — so the message-only residual lane A identified cannot be hit by a review seat at all, and my own seat never had that hazard.
3. **For a review, the gate IS the verdict, exactly as the contract states**: missing verdict → refused; `needs_revision` → refused (i.e. such a payload must be submitted as a FAILED task, not a completed one). The laxer treatment of `commandsRun` and `acceptanceResults` for review/requirements/plan matches the documented contract ("review/requirements need verdict=pass to complete") and is a measured property, not a defect.
4. Consequence for a plan amendment or a t3 re-open: a ledger-bearing task must submit `commandsRun` (possibly `[]`) explicitly; a review must submit its verdict and nothing else is enforced.

## MOMENT-BOUND (the rule applied to this reading itself)

This matrix is a RECORDED DERIVED READING: it is bound to **module revision `quality-gates.js` sha256 `1b0eb60e61765f5eb55dfab94bdeed5fff916a4b8d2fb9081fde5ec9ed4f4ad6`** (the revision both seats used). If that file moves, the matrix must be RE-DERIVED — it must not be quoted into an amended plan or a repair as if it were a property of the code at some later revision. Same class as lane A's `§4g` (a gate that re-derives a value from the tree cannot be green inside the writer's window) extended to readings; instance 4 of that rule is my `t15` corpus digest, and THIS page is instance 5 — labelled rather than assumed.
