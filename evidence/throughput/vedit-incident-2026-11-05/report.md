# VEdit throughput incident — 2026-11-04 → 2026-11-05

Agent-facing evidence record. Every number here is produced by `./scan_sessions.py`; the raw
output is `./result.json`. Nothing in this file is inferred from a model narrative.

## What was measured

Command (reproducible):

```sh
python3 scan_sessions.py \
  --sessions-root ~/.dsh/sessions/--home-haroldzhao-MyProj-DshProj-VEdit-- \
  --workspace /home/haroldzhao/MyProj/DshProj/VEdit \
  --since 2026-11-04 --until 2026-11-06
```

| Measurement | Value |
|---|---|
| Sessions created in the window | **61** (all `origin:"subagent"`, all `parent` = one captain) |
| Sessions longer than 15 min | **41 of 61** |
| Longest session | **604.5 min** (10.1 h) |
| Total child wall-clock | **40.1 h** |
| Median session | **27.5 min** |
| At the 15-minute mark, inside an in-flight `bash` | **29 of 41** (would be exempt) |
| At the 15-minute mark, inside a non-bash tool | 11 (`read` 5, `write` 2, `edit` 1, `send_message` 1, `job_output` 1, `job_kill` 1) |
| At the 15-minute mark, between tools | 1 |

Offline replay bound: the in-flight classification is reconstructed from the session log's
`tool/call` + `tool/result` pairing. The live rule is stamped by the runtime hooks, so a log whose
result frames were truncated can read as "still in flight"; treat the 29/11/1 split as indicative,
not as a conformance result.

## The serialisation proof

Consecutive one-shot child sessions, `next.createdAt − previous.lastAt`:

| previous session | duration | gap to the next child |
|---|---|---|
| `271e31f2` | 13.0 min | **0.2 min** |
| `e4ca17bb` | 4.5 min | **0.2 min** |
| `920062ee` | 5.4 min | **1.2 min** |
| `7d02f009` | 21.6 min | **0.6 min** |
| `365d65cd` | 33.7 min | **0.4 min** |
| `44b7f2ee` | 29.6 min | **0.3 min** |
| `9e52a072` | 20.2 min | **0.3 min** |

A gap of 0.2–1.2 minutes after every child means the captain was **blocked inside the tool call**
for the child's whole life and resumed only when the report settled. Negative gaps in `result.json`
belong to the team batches raised by one `approve` (e.g. four `senior-engineer-*` sessions created in
the same instant), which is the one path that already runs children concurrently.

## The re-team failure, in the records

Every team record in the VEdit workspace, from `result.json`:

| Team | Phase | `endedAt` | Members | Tasks |
|---|---|---|---|---|
| `team-20261102100601286` | active | **absent** | 14 | 43, all completed |
| `team-20261103123641462` | active | **absent** | 12 | 54, all completed |
| `team-20261104172203503` | idle | **absent** | 6 | 4, all completed |
| `team-20261105100854724` | active | **absent** | 4 | 4 `in_progress` |

A record with `members.length > 0` and no `endedAt` reads as "this session is leading a team"
(`complexity-gate.ts#readLeadingTeam`), and that answer never changes. The captain therefore could
not re-arm the gate for **47** one-shot consults after its last real team wave completed.

## The watchdog failure, in the log

`.mpd/logs/mpd-team-watchdog.log`, 2026-11-05 10:12–10:15:

```
PREDICATE FALLBACK (§4): team team-20261105100854724-yirt-002 carries no session id for task owner
3e875db1-… — the engine now runs the heartbeat rule in REPORT-ONLY mode: it may WARN … and it can
NEVER hold or escalate a team while this lasts.
NEVER-STARTED … task=T1 … attempt=3 — the owner never stamped this task: a dispatch problem, not a
wedge; recorded for replay, NO hold, NO escalation
```

The owner in that line is a **session id**, while `candidates()` looks owners up in a map keyed by
member **name**. The task was never stamped because the owner could not be found, and the engine
answered by degrading to a mode that cannot act. The user stopped the team by hand at 10:14
(`.mpd/team/hold.json`).

## Defects this evidence establishes

1. **A session cannot build a second team.** `readLeadingTeam` ignores `endedAt` and board
   terminality; settlement (`acted`) never re-arms; no mid-session volume trigger exists.
2. **One-shot consults are serial by construction.** `mpd_role_spawn` awaits
   `activation.result` inside the tool call; the harness runs tool calls from one message
   sequentially (measured in this very session: two calls in one message created children at
   18:19:57 and 18:22:27, the second at the instant the first ended).
3. **The watchdog observes but cannot act.** No interrupt/send/handoff verb; `never-started` never
   reaches `act()`; `startedAt` is dropped by the projection; the owner-identity mismatch forces
   report-only; the hold refuses NEW DISPATCH only and leaves an `in_progress` member untouched.

The fix contract for all three is `.mpd/plans/vedit-throughput-fixes.md` (frozen; §D0 records the
shared-base coverage for Agent Teams, cellwork and autoproject).
