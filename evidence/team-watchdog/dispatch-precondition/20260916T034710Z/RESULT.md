# r7 — a staged plan is not a dispatch problem (the `NEVER-STARTED` flood at host start)

**What was wrong, in one line:** the watchdog observed every non-terminal task that carried an
assignee, including tasks **nobody had been handed**, so a plan the complexity gate had only
**staged** (awaiting the user's approval in the Web panel) produced one `never-started` incident and
one console line **per task on every host start** — 12 of them, for work that had never been
dispatched and should not have been.

**What landed:** a candidacy rule in `candidateFor` (`packages/mpd-team-watchdog-plugin/src/machine.ts`):
a task is observed only when it was **handed to somebody at some point** — a dispatch is on record
(non-empty `attemptId`) **or** the task carries a stamp of its own (any generation, team-scoped).
No adopted code, no `skills/**`, no state-layout change, no new knob; the pre-existing
`warn`/`escalate`/`never-started` semantics are untouched.

---

## 1. The reproduction — the user's exact lines, from the real store

`.mpd/team/mpd-default/team.json` was a **staged** record: `phase:"staged"`,
`planReviewState:"awaiting_review"`, **no `approvedAt`**, 12 tasks, all `pending`, every task with an
assignee, **zero** `attemptId`s. The watchdog's tick reported all of them:

```
[mpd-team-watchdog] NEVER-STARTED mpd-default task=t1 member=Planner attempt=(none) — the owner never stamped this task: a dispatch problem, not a wedge; recorded for replay, NO hold, NO escalation record=/root/dshProj/my-power-dsh/.mpd/team/watchdog/incidents.jsonl
… one line per task, t1…t12 …
```

Recorded bursts in the real log (UTC): `03:41:08.696Z` (7 tasks — the captain's live process as the
tasks were created), `03:41:23.696Z` (3), `03:41:38.700Z` (2), and `03:42:33.225Z` (**12** — the next
process start re-reported the whole plan, because the machine's dedupe set is per process). The raw
records are in `before/staged-plan-burst.jsonl`; the paste the user reported is reproduced in
`before/console-lines.txt`; the whole pre-cleanup log is `before/incidents.before.jsonl`.

**Mechanism.** `candidateFor` filtered on `assignee` + non-terminal status only, and the machine
classifies "no stamp ever written for this task" as `never-started`. A staged plan has no
`attemptId` (the adopted scheduler writes it in `beginTaskAttempt(task, member)`,
`lib/scheduler.js`, **at dispatch**, before the ticket reaches the member) and no stamps, so every
task hit exactly that branch.

## 2. The rule, and how it is falsified

| Question | Answer |
|---|---|
| What makes a task observable at all? | ONE disjunction: a non-empty `attemptId` (dispatch on record) **or** any stamp of its own, of any generation, in this team |
| Why "any generation" for the stamp half? | a stamped task WAS worked on; a task whose attempt was revoked/amended after being worked on must not fall into the staged bucket. That is why the candidacy test reads the team-scoped stamps **unfiltered** — the W11-2 slice answers "is the CURRENT generation silent", not "was this task ever handed out" |
| What does an un-dispatched, never-stamped task look like? | `pending` + assignee + no attempt + no stamp: a staged plan, a task blocked on unfinished dependencies, or one the scheduler has not reached |
| Why is that not a report? | `never-started` is DEFINED as a *claimed* task whose owner never stamped; a task nobody owns cannot be `never-started` **or** a wedge, so silence/escalation must not be spent on it either |
| The falsifier | the same record with the attempt ids a real dispatch writes: **12** `never-started` records and 12 console lines come back, and a foreign-team stamp cannot make a task observable (§3 `revoked` row + the new `candidateFor` test) |
| Honest residual limits | (1) a task whose attempt was cleared **and** that carries no stamp at all (a first delivery that failed before the member's first stamp, `lib/scheduler.js:669-687`) is indistinguishable on disk from a staged task and is now silent; (2) a task the scheduler never dispatched although its dependencies were met is also silent, because `TeamTask` carries no `dependencies` — "ready but never dispatched" cannot be told from "blocked". Both are stated, not hidden; a future wave that wants (2) must read `dependencies` and require every dependency `completed` |
| What is untouched | the WARN→ESCALATE machine, the streak keys, the holds, the scenes, the r4 liveness gate (a staged team is still `fresh` and still ticked — it simply produces no candidates), the r6 in-flight rule, and the entire adopted plugin |

## 3. Before / after, on the REAL record, with the real plugin

The pre-fix dist was **byte-copied into `raw/dist-before/` before the rebuild**, so both halves mount
the real built plugin through its own `apply()`; the record is a byte copy of the real staged
`team.json`; the tick is `engine.tickOnce(Date.now())`. Driver: `raw/dispatch-precondition-before-after.mjs`,
raw values in `raw/before.json` / `raw/after.json`:

| run | dist | record shape | never-started | incidents | console lines | tick decisions | holds |
|---|---|---|---|---|---|---|---|
| BEFORE | `810e0fb3…` 125754 B | staged (real bytes) | **12** | 12 | 12 | 0 | 0 |
| BEFORE | `810e0fb3…` | + dispatch attempts (control) | 12 | 12 | 12 | 0 | 0 |
| BEFORE | `810e0fb3…` | revoked generation (t1 worked on, attempt cleared) | 12 | 12 | 12 | 0 | 0 |
| AFTER | `09ee6712…` 125566 B | staged (real bytes) | **0** | **0** | **0** | 0 | 0 |
| AFTER | `09ee6712…` | + dispatch attempts (control) | 12 | 12 | 12 | 0 | 0 |
| AFTER | `09ee6712…` | revoked generation (t1 worked on, attempt cleared) | **1** (t1) | 1 | 1 | 0 | 0 |

`never-started` still never holds and never escalates in either half (6th/8th columns), which is the
WARN-class contract it already had. The `revoked` row is the reviewer's first finding closed: only the
task that was actually worked on stays observable; the other 11 (no dispatch, no stamp) are silent.

## 4. What the user's panel showed, before and after, through the panel's own builder

`raw/panel-state.mjs` imports `buildWatchdogState` — the function the Web front door's
`/plugins/mpd-team-watchdog/state` route calls — and builds the payload the stuck-team banner
renders: `stuck = holds > 0 || any incident newer than the reader's watermark`.

| | `stuck` | `replay` | unread incidents | banner |
|---|---|---|---|---|
| BEFORE (pre-cleanup log, no watermark) | **true** | true | **42** | `warned` |
| AFTER (cleaned log + panel watermark) | **false** | false | **0** | none |

## 5. The records the defect had already written

26 `never-started` records on disk carried an **empty** attempt id — a shape the corrected candidacy
rule can no longer produce (24 from the two staged-plan bursts, plus `t83`/`t85` from earlier, the
same class). `raw/prune-defect-records.mjs` (one-off; the incident log is the only file it rewrites):

* byte-copies the log to `.mpd/team/watchdog/incidents.jsonl.bak-20260916T034935Z` **beside** it
  (and the original is also in `before/incidents.before.jsonl`, so nothing is lost);
* keeps every record the corrected rule can still produce: **4** `never-started` (with an attempt
  id), **8** `warn`, **4** `escalate` — 42 → 16 records;
* advances ONLY the Web panel's own reader key (`web-panel`, the key its ack route writes) to the
  newest remaining incident. **Stated precisely:** that marks the panel's view of *every* record at
  or below that timestamp as read — the 4 legitimate `never-started` and the 8 `warn` + 4 `escalate`
  records included, all of them already-resolved events from earlier waves (no hold is live:
  `.mpd/team/watchdog/hold/` is empty). Every record still exists in the log and in the archive; the
  panel simply starts from "read". Other readers' watermark keys are untouched (there are none), and
  a missing watermark file means "nothing acknowledged".

## 6. Gates

| Gate | Command | Result |
|---|---|---|
| Package tests | `bun test packages/mpd-team-watchdog-plugin` | **84 pass / 0 fail** (18 files; `test/dispatch-precondition.test.ts` is the new one, 6 cases) |
| Typecheck | `bun run typecheck` | exit 0 |
| Doc pairs | `bun run verify:docs` | PASS — 34 pairs, 0 failed, 0 violations |
| Vendor | `bun run verify-vendor` | PASS (no vendored asset touched) |
| QA self-tests | `bun run test:qa` | exit 0 — all self-tests passed |
| Watchdog fault lane | `bun skills/dsh-qa/scripts/team-watchdog-fault.mjs` | **PASS — 11 checks, 0 failed**; its `tool-inflight-expired` case still records `tool-expired` for `att-1`, i.e. the in-flight path is untouched by the rule |
| Watchdog heartbeat lane | `bun skills/dsh-qa/scripts/team-watchdog-heartbeat.mjs` | PASS — 13 checks, 0 failed |
| Watchdog boot lane | `bun skills/dsh-qa/scripts/team-watchdog-boot.mjs` | verdict PASS — the turn reached the MODEL call (`model-error`, no API key in this environment), i.e. no pre-step veto |

Raw logs: `gates/*.out`. The new test file is failing-first: on the pre-fix source its key assertions
are RED (`raw/red.log`: 12 incidents where 0 are expected, and `candidateFor` returning an
un-dispatched `t1`), and GREEN after the fix.

## 7. Independent review (Reviewer specialist, read-only) — findings and how each was closed

The reviewer verified the change against the code and re-ran the driver, the package suite, the
typecheck, the doc gate and the fault lane itself, and confirmed the committed dist is byte-identical
to a fresh build. It raised two defects, both closed in this revision:

| Finding | Severity | How it was closed |
|---|---|---|
| The comment promised "a stamp for the task keeps it observable … (a revoked or handoff generation)", which the W11-2 filter provably does not deliver: an attempt-cleared task with an old-generation stamp went from ONE `never-started` record to invisible (the reviewer's own probe: pre-fix 1, then 0) | high | the candidacy half now reads the **unfiltered, team-scoped** stamps (`workedOn`), so the promise holds: measured `revoked` row — BEFORE 12, AFTER 1 (the stamped task), plus two new tests (an engine case and a `candidateFor` case including the foreign-team stamp that must NOT make a task observable) |
| The README EN + zh-CN presented the rule as "two preconditions … in order", which reads as AND while the code is a disjunction, and contradicted its own "still reported" sentence | medium | both READMEs rewritten as ONE disjunctive rule with the machine's reading stated separately; `bun run verify:docs` re-run green |
| The residual-limit row did not name the rolled-back-delivery class, and the cleanup wording implied only defect records were acknowledged | low | both reworded (§2 limits, §5) |

The reviewer's explicit "do not" list (no new knob, no `phase`/`planReviewState` branch in the
watchdog, no adopted-file or delta-region edit, no change to the r2/W11-2 filters or the r4 liveness
gate, no `VENDOR_LOCK` re-pin, no deletion of other readers' watermark keys, keep
`everStampedForTask` and its machine test) is satisfied by this revision.
