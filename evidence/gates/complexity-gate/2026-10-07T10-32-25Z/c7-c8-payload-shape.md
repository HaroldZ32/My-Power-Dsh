# C7 / C8 evidence: the payload shape the gate can read, and the spurious shell it produced

Lane C (Junior Engineer), wave `de-vendor-and-verify-law`, 2026-10-07 (UTC). Every claim below quotes
a command that was run in this checkout, or a source line read from the INSTALLED harness.

## C8 — the marker EXISTS: an inbound agent message is a user-role message with a producer-owned `source.kind`

The captain's reproducer, read from disk:

```
$ cat .mpd/team/archive/plan-20261007102357/plan.json
{ "planId": "plan-20261007102357",
  "sessionId": "48289c1b-20a7-4fce-bf1f-656ad67e99e9",
  "name": "Agent c5a03efa-8ba4-4b95-8035-7ba16c0618c5 sent a message:",
  "description": "Staged mechanically by the mpd session-start complexity gate on complexity signals C. … Goal excerpt: Agent c5a03efa-… sent a message: [T1 — Plan review verdict: **PASS**] … 1. REFERENCES RES…",
  "members": [], "tasks": [], "stagedAt": "2026-10-07T10:23:57.052Z" }
```

That is a 0-member / 0-task SHELL staged for a session that was **already leading**
`team-20261007102205` (`.mpd/team/teams/team-20261007102205.json`: `leadSessionId` = the same
`48289c1b-…`, `phase: "active"`, `members.length: 7` — measured with
`node -e "const d=require('./.mpd/team/teams/team-20261007102205.json'); …"`), from a message written by
the Plan Reviewer, not by the human.

The delivery shape, quoted from the INSTALLED harness (v0.2.0-rc.2,
`<node>/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`):

```
# dsh-experimental-agent-team/lib/index.js, dispatchOnce() — the LEAD's message is a USER message
const source = { kind: "team-message", teamId: TeamId(root.id), messageId: message.id,
                 senderId: message.senderId, senderName: message.senderName };
const input = createUserMessage({ content, source });
root.steer(input);

# dsh-acp/lib/index.js:~834 — the HUMAN turn, tagged by the CLI bridge
const message = createUserMessage({ content, source: { kind: "user" } });

# dsh-api-session-controller/lib/index.js:~857 — the WEB/RPC human turn (kind is `user`)
const source = { kind: "user", rpcId: request.requestId, … };

# dsh-agent-preset-registry/lib/typert.host.js:551 — MessageSourceMap, the kind VOCABULARY
user | user-rpc | model | tool | system-prompt | model-selection | user-approval | ptc-mode |
tool-registry | agent-message | subagent-settled | skill-invocation | cordis-host-runner | goal |
schedule | compact-checkpoint | session-reference | user-question-reply
AgentMessageSource = { kind: 'agent-message'; form: 'relay'; senderSessionId: SessionId }
```

So a sender marker EXISTS and is used — no honest bound has to be written for this arm. The rule
implemented in `latestUserMessage` (packages/mpd-roles-plugin/src/complexity-gate.ts) is:

- the LAST message whose `source.kind === "user"` (`HUMAN_SOURCE_KIND`) is the goal;
- a message carrying ANY OTHER producer-owned kind is skipped;
- a message with NO source kind stays eligible — the fallback for a host that tags nothing.

Falsifiability is asserted in three places: `team-plane.test.ts` (the `team-message`/`agent-message`/
`runtime-context` exclusions beside the SAME text tagged `user`), the QA case's direction 6, and — for
the WIRING — the "already leading a team" arm, which drives the real step listener.

## C7 — the guard reads the TEAM RECORD, not a heuristic

`readLeadingTeam(workspace, sessionId)` (packages/mpd-roles-plugin/src/complexity-gate.ts) lists
`<workspace>/.mpd/team/teams/*.json` and answers `leading` only when a record's `leadSessionId` equals
THIS session's id AND its `members[]` is non-empty. A 0-member record is the staged SHELL, so the gate
may still stage for it; a missing directory, malformed JSON and an empty session id all answer
`{leading:false, members:0}` (never a throw).

The wiring (`packages/mpd-roles-plugin/src/session-gate.ts`) checks it BEFORE the predicate and
injects NO notice on that path, in any mode — a session already leading a team needs no instruction to
stage one, and the advisory text's "stage a team yourself" would contradict the one-team rule. The
session is NOT marked `acted`, so the record is re-read on the next step and a session whose team ends
is judged again.

Measured arms (all in `packages/mpd-roles-plugin/test/team-plane.test.ts`,
`bun test packages/mpd-roles-plugin/test/team-plane.test.ts` → 51 pass / 0 fail):

| Arm | Record | Expected | Observed |
|---|---|---|---|
| guard | `leadSessionId = this session`, 3 members | no stage, no notice | `{out: undefined, toolCalls: 0}` |
| twin | `leadSessionId = another session`, 3 members | stages | `toolCalls: 1` |
| twin | `leadSessionId = this session`, 0 members (SHELL) | stages | `toolCalls: 1` |
| baseline | no team at all | stages | `toolCalls: 1` |

The guard's LIMIT, stated rather than implied: it reads the record of the workspace the SESSION
resolves to. A team whose record lives in another workspace is not visible to it — the same bound the
boulder read (signal D) has always had.
