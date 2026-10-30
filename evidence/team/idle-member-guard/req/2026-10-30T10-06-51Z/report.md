# P2a-REQ — acceptance of the frozen idle-member guard contract

**Contract:** `.mpd/plans/team-idle-member-guard.md` (FROZEN 2026-10-30; §3.1–3.3 + §3.5 required,
§3.4 lazy spawn optional).
**Row:** T5 (requirement, owner dispatch-engine). **Sampled:** 2026-10-30T10:06Z.
**Verdict: ACCEPT with SIX AMENDMENTS — no blocker stops the work; two amendments are correctness
issues that must land in the implementation (and ideally in the frozen text) before T6.**

## 1. Executability — every named file/API exists

| Contract element | Verdict |
|---|---|
| `settleMember` as the member-resolution precedent | EXISTS — `packages/mpd-team-core-plugin/src/team-store.ts` :: `settleMember(record, sessionId, now)` resolves a member by `executorRef === sessionId` |
| `dsh.guardTool(exec => string \| undefined)` | EXISTS — `packages/mpd-dsh-adapter-plugin/src/index.ts` :: `guardTool`; the registry's `guard(ToolGuard): () => void` returns a disposer, and the repo already installs several guard hooks from one apply site (`agent-references/verification-flow.md`), so the idle guard coexists with cellwork's |
| `agent/pre-step` observation | EXISTS, but see **A1** — the reliable route is per-agent registration, not a row-ctx listener |
| `agent_teams_plan` `add_member` + `approve` spawn path | EXISTS — team-core; the spawn prompt is passed at approve (see **A6**) |
| `mpdTeams` service, additive registration method | EXISTS and is ours (`MpdTeamsService`, `TEAMS_SERVICE = "mpdTeams"`); `registerControlSeat` is additive (see **A5**) |
| Board statuses `pending/claimed/in_progress/completed/failed/cancelled` | EXISTS — `team-store.ts` :: `TaskStatus`; `owner` is optional on a task |
| Live QA case apparatus | EXISTS — a real isolated boot with a local OpenAI-shaped model stub (precedent: `skills/dsh-qa/scripts/cellwork-command.ts`), plus the team tools over a stub composition (`team-dispatch-guard.ts`) |

## 2. Amendments

**A1 (correctness — pre-step registration site).** §3.1 says "a host-plane `agent/pre-step` listener in
`packages/mpd-team-core-plugin`". The adapter's own measured note on `registerAgentPreStep` records that
a listener registered on a ROW's ctx is NOT a reliable subscriber: `agent/pre-step` is dispatched through
the agent's own scope carrier and reaches a listener only when that listener's scope IS the dispatch
scope or an ancestor of it — "MEASURED 2026-09-27: the session-start gate was installed and silent on six
live boots". The bundle's own live gate solved it exactly this way
(`packages/mpd-roles-plugin/src/session-gate.ts`): `dsh.registerAgentPreStep(agent, handler)` for every
`dsh.liveAgents()` entry, plus `agent/created` / `agent/disposed` subscriptions. **The guard must use that
route**, or it may be silently inert and every member will look taskless-and-unguarded. If the frozen
text keeps "host-plane listener", the writer will implement the per-agent registration that satisfies the
intent and say so in the T6 report.

**A2 (correctness — the mark must be cleared by re-evaluation).** §3.2 lists three clear events: a
dispatch that names the member, a claim, a team stop. The cellwork P2 auto path will deliver through
`TeamExecutor.send` (`dispatchOwnerOnly`), NOT through team-core's `agent_teams_dispatch`, so team-core
never observes that dispatch. A member marked idle by its spawn turn would then keep the mark, and the
one tool it needs first — `agent_teams_task claim` — is denied: a deadlock that looks like a stuck
member. **The pre-step must re-evaluate BOTH ways on every step** (no open task → mark + inject once; an
open task → CLEAR the mark and inject nothing), with the three explicit clear events kept as
optimisations. Required unit arm: "marked member + an assigned `pending` task + pre-step → mark cleared,
tools allowed".

**A3 (field naming).** `TeamMemberRecord` carries `executorRef` only — there is no `sessionId` field on
the member row, and `settleMember` matches `executorRef` and accepts a task owner spelled either
`member.name` or `member.executorRef`. §3.1 should say `executorRef` and use that dual owner spelling.
The clause "the member is the task's declared verifier with a `review` task in those states" names no
board field: the reviewer IS the review task's `owner`, so the owner rule already covers it. Either drop
the clause or define the field it means.

**A4 (idle-terminal set).** §3.1 says a member whose only task is `completed`/`cancelled` is idle. The
board also has `failed`; a member whose only task FAILED has nothing to do and must be marked idle too.
Add `failed` (or say "any terminal status").

**A5 (scope of §3.5).** `registerControlSeat` is a new method on `MpdTeamsService`; the cellwork callers
(dispatcher at staging, subcaptain at promotion) do not exist yet — P2 is still a DRAFT contract with no
code. P2a's checkable acceptance is therefore the team-core API plus the unit arm "an unregistered
`cell-*` name is NOT exempt"; the cellwork registration lands in P2. State that, or the P2a verifier will
look for a caller that is not there.

**A6 (spawn preamble site).** `add_member` stores the member's prompt on the staged plan; the text is
handed to the executor at `approve`. §3.3 should name the site (approve/spawn) so the writer does not
prepend it in a place that the executor never reads.

**A7 (live case feasibility — risk, not blocker).** The QA apparatus can boot a real DSH offline with a
local model stub, but the P2a case must raise TWO members through a real `agent_teams_plan approve` and
have the stub serve both member turns. The writer must confirm the stub can host a two-member approval;
if it cannot, the case is a SKIP and a skip is not a pass — the contract already requires the live case
as the merge gate, so this must be proven early, not at the end.

## 3. What I did not do (row constraints honoured)

No code, test, skill or doc file was edited; the implementation was not read for design. The checks above
are seam/API existence checks plus the registration precedent, which is what "missing file/API" asks for.
