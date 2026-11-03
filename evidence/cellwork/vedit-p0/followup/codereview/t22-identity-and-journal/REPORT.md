# T22 — CodeRabbit CR1 on PR #93: end-journal containment + recorded-Lead title exclusion

- Wave: 0.17.2 team · row **T22** (repair; source row T19) · loop `loop-20261103T080819-5165ba`
- Contract: `.mpd/plans/vedit-p0-followup.md` + the captain's T22 brief; CR round 1 on PR #93
- Owner: `se-consume` (Senior Engineer) · Date: 2026-11-03
- Evidence: this directory (`evidence/cellwork/vedit-p0/followup/codereview/t22-identity-and-journal/`)
  — kept in its own subdir because `../report.md` belongs to a DIFFERENT CodeRabbit row (T23, the QA lane)
- `diff.patch`: full working-tree diff of the package sources/tests (it also carries the still-uncommitted
  T8/T12/T16 deltas); this row's delta is the `endTeam` journal try/catch, the `memberIdentityOf` Lead
  guard, the two new arms and the new test file.

Both findings were VALID and are fixed — neither is reconciled as stale.

## CR1(1) — a journal failure must not fail a landed ending (FIXED)

`team-actions.ts#endTeam` persists the terminal record with `endTeamRecord` BEFORE appending the
`team-ended` journal row. The append was unguarded, so a disk failure escaped to the outer catch and:

- reported the ending as a FAILURE although the record was already `ended` on disk; and
- a retry then answered `changed:false`, so the missing history row could never be written.

**Fix:** the append is contained; its failure is reported on the row's diagnostic sink and the ending is
still reported as what it is:

```ts
if (outcome.changed) {
  try {
    appendTeamJournal(caller.workspace, { event: "team-ended", … })
  } catch (error) {
    deps.log(`team ${outcome.record.teamId} ended but its journal row was not written: ${refusalOf(error)}`)
  }
}
return { ok: true, changed: outcome.changed, … }
```

**Arm** — `test/codereview-cr1.test.ts` drives the REAL `endTeam` with the row's `TeamActionDeps`
injected (the only way to break the journal AND observe `deps.log`; the tool path's sink is a file
outside the sandbox). It makes `.mpd/team/journal.jsonl` a DIRECTORY so `appendFileSync` throws `EISDIR`
— the shape a full disk or a read-only mount produces, with no module mocking — and asserts:
the end is `ok:true` / `changed:true`; the record is `phase:"ended"` with the stamped `endedAt`; the log
line is exactly `team <id> ended but its journal row was not written: <refusal>`; the retry is
`changed:false` with the FIRST reason and instant; and the retry appends no second log line.

## CR1(2) — a RECORDED Lead is never a member by title (FIXED)

`team-store.ts#memberIdentityOf`'s ARM 3 matched the caller's session title against roster roles / seat
names. A RECORDED Lead whose persona title contains a role text then fell into that arm, so
`callerIdentity.ownMember` became a MEMBER row and the mailbox's `callerAddress` (`ownMember?.id ??
…)` addressed the captain by a member id — the Lead acting under a member identity.

**Fix:** the recorded-Lead check runs BEFORE ARM 3 and answers "not named":

```ts
// ARM 1 own id → ARM 2 recorded ancestor → then:
if (sessionId !== "" && recordNamesLead(record, [sessionId])) return { named: false }
// ARM 3 title over role/stored name
```

`recordNamesLead` covers the record's current `leadSessionId` AND its `leadHistory`, so a churned Lead
recorded there gets the same exclusion. The doc states the rule and its bound (below).

**Arms:**

- unit (`identity-plane.test.ts`): a recorded Lead's title = a roster role →
  `{ named: false, member: undefined }` for BOTH `leadSessionId` and a `leadHistory` entry; the control
  (same title, a non-Lead session) still names the seat.
- tool (`identity-plane.test.ts`): the recorded Lead calls `agent_teams_mail {action:"unread"}` with a
  persona title — the reply's `memberName` (the durable address it acted under) is the LEAD's session id,
  not the member's name.

**Non-vacuity measured** — `cr1-probe.ts` recomputes the OLD ARM 3 decision inline beside the new one:
`recordedLead:true`, `newReading:{named:false}`, **`oldArmThreeWouldName:"M1"`**, control member still
`M1`. So the arm is discriminating, not passing for the wrong reason.

## CR1 probe (both findings, same run)

`bun …/t22-identity-and-journal/cr1-probe.ts` → **`CR1 PROBE PASS`**, exit 0
(`01-cr1-probe.log`):

```json
"identity": { "recordedLead": true, "newReading": { "named": false }, "oldArmThreeWouldName": "M1",
              "churnedLeadReading": { "named": false }, "controlMemberReading": { "member": { "id": "M1", … } } },
"endJournal": { "first": { "ok": true, "changed": true, "reason": "the wave landed", … },
                "recordPhase": "ended", "recordReason": "the wave landed",
                "logLines": ["team team-… ended but its journal row was not written: EISDIR: …"],
                "retry": { "ok": true, "changed": false, "reason": "the wave landed", … } }
```

## Gates (final tree; logs here)

| Gate | Command | Observed |
|---|---|---|
| Package tests | `bun test packages/mpd-team-core-plugin` | **603 pass / 0 fail**, 2905 expect(), 42 files — `02-package-tests.log`, exit 0 |
| Touch-point arms | identity-plane + team-end + codereview-cr1 | **28 pass / 0 fail** (14 + 13 + 1), 148 expect() — `03-arms.log`, exit 0 |
| Typecheck | `bun run typecheck` | `tsgo --noEmit`, no output, **exit 0** — `04-typecheck.log` |
| Comments | `node scripts/verify-comment-coverage.ts` | `… VERDICT: PASS …`, **exit 0** — `05-comments.log` |
| CR1 probe | `bun …/cr1-probe.ts` | `CR1 PROBE PASS`, **exit 0** — `01-cr1-probe.log` |

No git write; no dist build.

## README wording for N6 (docs lane) — one added clause

The identity bullet N6 is already inserting gains the recorded-Lead exclusion (and its bound):

EN (append to the bullet):

```markdown
A RECORDED Lead is never read as a member by its title: the captain identity is checked before the title
arm, so a Lead persona that happens to contain a roster role can never be addressed by a member id. (A
FORKED Lead's new session id is recorded only when the churn heal runs — and the heal SKIPS any session
the identity plane names as a member, so a fork whose title names a seat is NEVER healed on that record
and stays identified as that seat, fail-closed, while its title keeps naming one. That is the stated
bound.)
```

zh-CN twin:

```markdown
被记录的 Lead 绝不会因为标题而被当作成员解析：队长身份在标题分支之前判定，所以队长人设里即使出现 roster role，
也绝不可能被用成员 id 寻址。（被 fork 的 Lead 的新 session id 只有在 churn heal 运行时才会被记录——而 heal 会跳过
身份面认定为成员的会话，所以标题点名席位的 fork 在该记录上**永远不会**被 heal，会一直按该席位处理（fail-closed），
只要标题还点名该席位。这是已声明的边界。）
```

No README change is owed for the journal containment: `team-journal.ts` already documents the journal as
EVIDENCE, never a source of truth, and the containment keeps that true (a failed append costs history,
never the ending or the reply).

## Bounds (stated)

- **The journal row is still missing after a failed append.** The containment reports it and cannot
  re-create it: the retry is the documented no-op (`changed:false`), so nothing re-appends the row. A
  repair/re-append verb is a separate feature; the ending itself is correct and reported.
- **The fork bound stands (CORRECTED 2026-11-03, T28):** a FORKED Lead's new session id is recorded only
  when `healLeadBinding` runs, and the heal is SKIPPED for any session the identity plane names as a
  member — so a fork whose title names a seat is **NEVER healed on that record** and stays identified as
  that seat (seat-blocked, fail-closed: it can borrow no Lead ancestry) for as long as the title keeps
  naming one. The earlier closing phrase implied the heal would eventually run and contradicted the very
  rule it stated; it is replaced here. The code comment carries the same deferred-heal imprecision and is
  FLAGGED, not edited, in `../fork-bound/REPORT.md` (T28's scope is documentation of this report only).
  That is the T12 residual, unchanged and documented at the arm.
- The recorded-Lead guard keys on `recordNamesLead` (current Lead id + `leadHistory`), so it is exact for
  every session the record has RECORDED — no title heuristics there.
- No README edit (N6), no dist build (the captain integrates), no git; verification is the real plugin +
  real store over a stub executor, plus the direct-`endTeam` arm with injected seams.
