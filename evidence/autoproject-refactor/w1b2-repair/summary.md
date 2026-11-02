# R-W1B2 repair — S5 dropped, a DECLARED scope, the writer-id bound recorded

Repair of the R-W1B2 FAIL (`evidence/autoproject-refactor/w1b2/verdict.md`, board task T8) for board row
**T31**. Scope: `packages/mpd-autoproject-plugin/{src,test}` ONLY. `dist/` NOT rebuilt (still 17:39); no git
command run. The captain's ruling is implemented verbatim, not re-litigated.

## B1 — S5 is DELETED from the predicate

`escalation.ts`:
- the module header table is the new frozen predicate
  `escalate = S2 || S3 || count(S1, S4, S6, S7) >= 2`, with the retired row removed;
- the header now CARRIES THE REASON (the checklist is emitted FROM the criteria by CUT 3, so the engine fed
  one number twice and a 13-criteria run escalated on one fact) and states the id rule: **ids are the wire
  vocabulary — a reader must tolerate an id going ABSENT, never see S6/S7 renumber**;
- `EscalationInput.checklist` is GONE (no consumer), the S5 evaluation line is gone, `evaluateEscalation`'s
  counter comment names `S1/S4/S6/S7`;
- `EscalationConfig.tasksMax` is RETAINED with a comment saying why: `autoproject.escalate.tasksMax` is
  named by the plan's knob list, so a `.mpd/mpd.jsonc` that sets it must still parse — but NO signal reads
  it, and reading it would be the defect.

`engine.ts`: `considerEscalation` no longer passes `checklist` at all.

## B2 — a DECLARED write scope

- `mpd_autoproject` gains `scope?: string[]` ("The caller's DECLARED write scope (workspace-relative
  paths)…"), declared in the tool's `parameters` (pinned by an arm, so a caller can see it).
- `declaredScopeOf(value)` normalizes it: non-empty strings, trimmed, de-duplicated; an ABSENT, empty or
  non-array value answers `null`, so an empty declaration cannot silently mean "the whole workspace" — the
  fallback stays in force instead.
- When present the declared list is the scope for **S6** (`topLevelScope(declared).length`), for the
  **verify loop's authorising `scope`**, and for the **hand-off** (`escalation.json.scope` and the
  `cellwork_open` argument). When absent, the evidence derivation is unchanged.
- `escalation.json` gains **`scopeSource: "declared" | "evidence"`**, and the ledger records it ONCE per run
  (`{"lane":"scope","verdict":"…"}`), stamped at the first boundary — so a run that never escalates is
  still auditable for what it believed its scope was.
- Nothing is invented: with no declaration the artifact carries the derived trees and says `evidence`.

## B3 — the writer-id bound, RECORDED

`engine.ts`, at the `mpd_verify_open` call, ONE comment states the bound: `mpd_verify_open` documents
`writer_id` as the member's AGENT KEY, the engine cannot know one (`mpd_role_spawn` answers the fixed
`REPORT_SCHEMA`, C6, and a one-shot child's session is disposed with its report), so the value is a LABEL —
it identifies the SEAT CLASS (role + run), never the agent instance — and the loop's same-agent arm is
INERT for an autoproject loop, whose verification independence therefore rests only on the verifier being a
different seat (it is a `Reviewer` consult, so it holds).

Recorded in BOTH places the ruling names:
- `escalation.json` gains `writer: { id, role, runId, bound: "label-not-agent-key" }`;
- one ledger line at loop open: `{"lane":"verify-writer","verdict":"<Role>","detail":"writer_id=… runId=… bound=label-not-agent-key …"}`.

## The artifact shape now

```json
{ "version":1, "at":"…", "mode":"ask|auto", "signals":[{"id":"S2","value":1,"threshold":1}],
  "objective":"…", "planFile":"…|null", "criteria":[…], "evidence":[…],
  "scope":["…"], "scopeSource":"declared|evidence",
  "writer":{"id":"Deep Worker · autoproject-xxxxxxxx","role":"Deep Worker","runId":"autoproject-xxxxxxxx","bound":"label-not-agent-key"},
  "roundsUsed":2, "mandate":{"source":"autoproject","runId":"…","planFile":"…"},
  "handoff":{"path":"instruction|cellwork_open"} }
```

## Gates (command + observed result)

| Command | Result |
|---|---|
| `bun test packages/mpd-autoproject-plugin` | **45 pass / 0 fail**, 414 `expect()` calls, exit 0 (`tests.log`) |
| `bunx tsgo --noEmit` | **0 errors**, exit 0 (`typecheck.log`) |
| `bun run verify:comments` | **VERDICT: PASS**, exit 0 (`comments.log`) |

## The repair arms (each falsifiable — how)

`test/engine.test.ts`, five new arms + the re-pinned pure one:

- **(a) a 13-criteria run with no other signal does NOT escalate — engine boundary.**
  BEFORE (`evidence/autoproject-refactor/w1b2/probe-s1s5-collapse.log`):
  `criteria=13 checklist=13 -> {"escalate":true,"signals":[{"id":"S1","value":13,"threshold":12},{"id":"S5","value":13,"threshold":8}]}`.
  AFTER (this arm): the run ends **`complete`** and `escalation.json` does NOT exist, with the ledger still
  carrying `"lane":"scope","verdict":"evidence"`. *Falsifiable:* restoring S5 (or feeding the predicate a
  second counter from the criteria) escalates that run again and the arm reddens.
- **(b) the same run escalates once a SECOND counter fires** — `escalate.ledgerBytesMax: 1` makes S4 fire;
  the artifact's ids are exactly `["S1","S4"]`. *Falsifiable:* without the second counter it is (a).
- **(c) a DECLARED scope drives S6** — three declared trees with `scopePathsMax: 2` → S6 fires; the same run
  without the declaration derives an empty scope and completes. The artifact reads `scopeSource:"declared"`,
  `scope` equals the declared list, ids `["S1","S6"]`. The arm also asserts the `scope` parameter is in the
  tool's declared `parameters`. *Falsifiable:* dropping the declared wiring falls back to evidence → no S6.
- **(d) absent `scope` keeps the fallback, `scopeSource:"evidence"`** — an S2-only run; the ledger has
  exactly ONE `"lane":"scope"` line.
- **(e) the retired id never appears and every renderer consumes a list without it** — a grid over the
  boundary inputs (single signals, pairs, all) never yields `S5` and every id ∈ {S1,S2,S3,S4,S6,S7}; then a
  produced S2-only run's `escalation.json` (`["S2"]`), its ledger line (`S2=1/1`, no `S5=`) and the report
  text (`escalated [S2]`) all render that list.

The pure-predicate arm was re-pinned: `calm` lost `checklist`, "ONE counter is not enough" now covers S1,
the two-counter case is `criteria 13 + ledger over cap` → `["S1","S4"]`, and it asserts no `S5` can appear.

## What I could NOT prove

1. **No live boot / no dist rebuild** (out of scope by contract): the run-time behaviour is proved through
   the shipped handlers in a sandbox, not through a mounted row.
2. **The artifact's real consumer (cellwork) is wave W2's**: `scopeSource` and `writer` are written and
   read back by this package's own arms; nothing here proves W2's `cellwork_open` interprets them.
3. The `mode:"off"` reading is untouched (nit 1 of the verdict): `off` still writes no artifact.
