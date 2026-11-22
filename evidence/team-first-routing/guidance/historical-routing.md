# Historical routing evidence

Session `920cbcc2-8f0d-4560-8cc8-b289d40768b2`, turns 1 and 2. The v4 log was decoded read-only with the repository's `decodeSessionLog` helper in `skills/dsh-qa/scripts/lib/session-evidence.ts`. The first full sample read 1,360 concatenated frames and 2,794 records with no torn tail. The projection used event sequence numbers and UTC times. It retained only known request excerpts, public action types, call and child counts, and allowlisted outcome indicators.

The frozen creation header recorded `cordis`, delegation depth 0, at `2026-10-19T03:46:19.569Z`. The `agent-preset/selected` record at sequence 3 recorded `mpd` at `2026-10-19T03:46:46.543Z`. The startup and re-team marker strings appeared in the system persona. Neither turn recorded a `user/message` or `agent/inbox/spliced` message with a gate marker at the start of its text or an `mpd-roles` source with reason `session-start-advisory`, `re-team-trigger` or `re-team-repair`.

| UTC time on 2026-11-22 | Record |
|---|---|
| `15:34:00.996` | Audit request at seq 10 matched the opening `帮我检查当前工程的不合理点`. |
| `15:34:16.933` | `agent_teams_plan` status at seq 45 returned `value is not lossless JSON` before the first consult. |
| `15:34:38.010` to `15:34:38.158` | Five opening consult children appeared in `subagent/catalog` at seq 60–71. |
| `15:35:28.822` | Status at seq 127 returned the same serialization error. Four more async consult calls followed. Turn 1 had nine total and no plan creation, approval or dispatch. |
| `15:56:04.394` | Repair request at seq 498 matched the opening `一起解决掉吧`. The frozen repair plan assigns eight independent work groups. |
| `15:57:46.557` to `15:57:46.874` | Eight repair consult children appeared in `subagent/catalog` at seq 549–568. |
| `15:58:22.504` to `15:58:31.741` | Status at seq 578 returned the same serialization error. The plan create at seq 588 returned without a tool error. |
| `15:58:47.830` | Approval at seq 604 reported `subagent limit reached` in its payload while the harness `isError` flag was false. |
| `15:59:29.631` to `15:59:39.765` | Dispatch preview at seq 648 reported the declared owner missing. Approval retry at seq 654 returned a tool error. |

The Architect traced the creation-time exclusion to `sessionQualifies` in `packages/mpd-roles-plugin/src/complexity-gate.ts` in the pre-change checkout and confirmed it in the installed roles bundle. The published code read the immutable creation header for preset eligibility, and the gate registration, pre-step handler and completion counter all relied on that check. This explains why the session could miss the gate before sensitivity or language heuristics applied. The event projection does not reconstruct the historical `team.gate` or sensitivity configuration. The failed status, successful staging call, capacity refusal at approval and absent owner at dispatch are separate observations. The independently recorded approval payload and board state are in `evidence/audit-repair/pre-fix-team-host/observations.md`.
