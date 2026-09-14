# B7 — read-only .mpd/team inventory (t11)

Scanned: 2026-09-11T04:26:24.164Z · root `.mpd/team` · **19 non-archived records** · 6 archived dirs

READ-ONLY PROOF: the whole tree was hashed before and after the scan — 99 files, sha256 `f2a0f57a3e4f93d4b310624ce1ffeb5bf73b946a6b2e00d057f155934943e8e5` unchanged=True. Nothing under `.mpd/team` was created, modified, moved or deleted by this task.

> Context: the workmate in-use gate (`mpd-workmate-plugin` `busyTeams()`) scans exactly these records — `<workspace>/.mpd/team/*/team.json` (archived ones under `archive/**` have no `team.json` and are skipped). Every non-archived record whose `members[].name` sanitizes to a workmate key refuses `mpd_workmate_rename`/`mpd_workmate_delete` for that key. Measured in t8: renaming a workmate keyed `lead` was refused with 18 blocking `<teamId>/Lead` entries.

| # | teamId | phase | createdAt | members | tasks | open | statuses | last dir write | judgement |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `mpd-default` | staged | 2026-09-09T08:15:12 | 11 | 0 | 0 | - | 2026-09-09T08:15:12 | **STALE-EMPTY — staged draft, 0 tasks, never started** |
| 2 | `mpd-default-c2be0a8a` | staged | 2026-09-09T08:52:38 | 11 | 0 | 0 | - | 2026-09-09T08:52:38 | **STALE-EMPTY — staged draft, 0 tasks, never started** |
| 3 | `mpd-default-53380813` | staged | 2026-09-09T10:20:34 | 11 | 0 | 0 | - | 2026-09-09T10:20:34 | **STALE-EMPTY — staged draft, 0 tasks, never started** |
| 4 | `agent-teams-sidebar-migration` | running | 2026-09-10T01:39:05 | 11 | 10 | 1 | completed=8, failed=1, pending=1 | 2026-09-10T03:16:04 | **STUCK — phase=running but no live member sessions; cannot progress** |
| 5 | `mpd-default-c146a414` | staged | 2026-09-10T05:44:32 | 11 | 0 | 0 | - | 2026-09-10T05:44:32 | **STALE-EMPTY — staged draft, 0 tasks, never started** |
| 6 | `mpd-default-84e50f06` | staged | 2026-09-10T07:04:56 | 11 | 8 | 8 | pending=8 | 2026-09-10T07:07:23 | **STALE-WITH-OPEN-TASKS — staged, never ran, 8 task(s) still open** |
| 7 | `mpd-default-9b7de114` | staged | 2026-09-10T12:52:32 | 11 | 0 | 0 | - | 2026-09-10T12:52:32 | **STALE-EMPTY — staged draft, 0 tasks, never started** |
| 8 | `mpd-default-cc23f374` | staged | 2026-09-10T13:07:15 | 11 | 0 | 0 | - | 2026-09-10T13:07:15 | **STALE-EMPTY — staged draft, 0 tasks, never started** |
| 9 | `mpd-default-1f285182` | staged | 2026-09-10T13:08:13 | 11 | 0 | 0 | - | 2026-09-10T13:08:13 | **STALE-EMPTY — staged draft, 0 tasks, never started** |
| 10 | `mpd-default-98620900` | staged | 2026-09-10T13:08:28 | 11 | 0 | 0 | - | 2026-09-10T13:08:28 | **STALE-EMPTY — staged draft, 0 tasks, never started** |
| 11 | `mpd-default-19f64d11` | staged | 2026-09-10T13:09:15 | 11 | 0 | 0 | - | 2026-09-10T13:09:15 | **STALE-EMPTY — staged draft, 0 tasks, never started** |
| 12 | `mpd-default-4a3d20e1` | staged | 2026-09-10T13:09:31 | 11 | 0 | 0 | - | 2026-09-10T13:09:31 | **STALE-EMPTY — staged draft, 0 tasks, never started** |
| 13 | `mpd-default-47c350bf` | staged | 2026-09-10T13:18:20 | 11 | 0 | 0 | - | 2026-09-10T13:18:20 | **STALE-EMPTY — staged draft, 0 tasks, never started** |
| 14 | `mpd-default-5b99df58` | staged | 2026-09-10T13:18:26 | 11 | 0 | 0 | - | 2026-09-10T13:18:26 | **STALE-EMPTY — staged draft, 0 tasks, never started** |
| 15 | `mpd-default-b550f267` | staged | 2026-09-10T13:18:34 | 11 | 0 | 0 | - | 2026-09-10T13:18:34 | **STALE-EMPTY — staged draft, 0 tasks, never started** |
| 16 | `mpd-default-2d2445da` | staged | 2026-09-10T13:18:40 | 11 | 0 | 0 | - | 2026-09-10T13:18:40 | **STALE-EMPTY — staged draft, 0 tasks, never started** |
| 17 | `mpd-default-d3943705` | staged | 2026-09-10T13:27:35 | 11 | 0 | 0 | - | 2026-09-10T13:27:35 | **STALE-EMPTY — staged draft, 0 tasks, never started** |
| 18 | `mpd-default-7332aba4` | running | 2026-09-11T02:39:33 | 11 | 14 | 1 | completed=12, failed=1, in_progress=1 | 2026-09-11T04:26:07 | **ACTIVE — this delivery's own team (live members); DO NOT archive** |
| 19 | `mpd-default-e35e7807` | staged | 2026-09-11T03:51:32 | 11 | 0 | 0 | - | 2026-09-11T03:51:32 | **STALE-EMPTY — staged draft, 0 tasks, never started** |

Summary: 1 ACTIVE (this delivery's team) · 1 STUCK (`agent-teams-sidebar-migration`) · 1 STALE-WITH-OPEN-TASKS (`mpd-default-84e50f06`, 8 pending) · 16 STALE-EMPTY.

Note on `mpd-default-e35e7807` (created 2026-09-11T03:51:32, staged, 0 tasks): it is the +1 vs the captain's earlier measurement of 18. It was auto-provisioned by the **session-start team policy** when the t8 verifier's isolated probe boot started a turn in a session whose workspace was this repo (the probe runs with an isolated DSH_HOME but the session workspace is the real repo, so the policy wrote into the real `.mpd/team`). Recorded here for the operator; not deleted (hard constraint).

## Operator procedure (AgentTeams surface — no manual `.mpd/team` edits)

1. Open the Web GUI → **AgentTeams** tab (DSH-better-sidebar; the tab auto-opens in its own surface). Every non-archived record above is listed there; archived teams appear only under the panel's archived section.
2. For the **STUCK** record `agent-teams-sidebar-migration` (phase `running`, created 2026-09-10, 8 completed / 1 failed / 1 pending, no live member sessions): use the captain-chat **Stop team** control first (the shipped control is `teamStopButton`/"Stop team", which cancels unfinished tasks and stops resident member activations), then end/archive the team.
3. For the 16 **STALE-EMPTY** drafts and the **STALE-WITH-OPEN-TASKS** `mpd-default-84e50f06`: end/archive each team. The captain tool that performs it is `agent_teams_delete` — "End and archive your team: interrupts members and moves the current tasks and mailboxes out of active state for later inspection" — i.e. the same archive the UI drives; a same-name archive replaces its previous generation.
4. Alternative to archiving a whole team: **retire** its members. `agent_teams_remove_member` records the member ids in `.mpd/team/retired-members.json` and drops them from `team.json`, so those keys stop blocking workmate rename/delete even while the team record stays. Use it when a record must be kept for inspection but its roster names must be freed.
5. Do **not** archive `mpd-default-7332aba4` while this delivery is running — it is the live team of this session and its members' state is in use.
6. After archiving, re-run the workmate operation that was refused. Expected effect: `mpd_workmate_rename`/`mpd_workmate_delete` on roster-named keys (e.g. `lead`, `architect`) is refused only by the remaining non-archived records.

**Do not** clear these records by editing, moving or deleting files under `.mpd/team` — that state belongs to the agent-teams plugin and hand-editing it is the exact bypass the gate documentation forbids (AGENTS.md §12).
