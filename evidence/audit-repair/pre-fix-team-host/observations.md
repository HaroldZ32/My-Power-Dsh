# Live team approval and dispatch on the pre-repair host

Observed in the active DSH Web session on November 22, 2026, before installing any repair. The checkout was on the v0.21.0 tree at `124d4591`, identical to merge `e86764c0`. Eight legitimate specialist consultations occupied the host's eight child slots. No pre-existing team was used for this probe.

| Public action | Observed return |
|---|---|
| `agent_teams_plan` status before staging | `value is not lossless JSON` |
| Create `team-agent-delivery-check` | Plan `plan-20261122155831746-t0uo-001` staged. |
| Add reviewer `invocation-check` and one task owned by it | Staged one member and one task. |
| Approve | `approved ... 0 member(s), 0 task(s) — STOPPED at member mpd-team-runtime-review: subagent limit reached (active child limit: 8)`; the planner had mapped the role to a reusable workmate. |
| Status after approval | `members 0 · tasks 1 · hold none`; `T1` was pending and its owner was `mpd-team-runtime-review`. |
| Owner dispatch dry-run | `declared owner "mpd-team-runtime-review" is not on this team's roster — the row stays pending` |
| Same-plan approval preview | `plan ... is already approved` |

The rejection of a ninth concurrent child is expected. Losing the ability to resume the plan after this refusal is the failure reproduced here. This recording does not establish the cause of any earlier, unrecorded user session. The below-capacity activation and delivery flow requires separate evidence from the repaired build.
