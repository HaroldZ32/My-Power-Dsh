# mpd-team-watchdog

[中文](./README.zh-CN.md)

A DSH cordis plugin that watches an AgentTeams team for a **wedged turn**: a member
(or the captain) that stops stepping without ever finishing. It writes a per-step and
per-tool **heartbeat**, turns silence into a **WARN**, three consecutive WARNs for the
same task+attempt into an **ESCALATE**, keeps a restorable **scene snapshot**, and
records a durable, preserving **hold** for the affected team only.

This package is the **core** of that capability. It is deliberately narrow: it owns
the writers, the machine, the store and its own actions. Wiring the adopted dispatch
gates that honour a hold, and the Web/TUI surfaces that show it, belong to later
tasks.

## Why it exists

The measured incident this row was built for: a member's last artifact write was
observed at 16:32:37, the runtime kept reporting `running` with no stray child, and the
human noticed at 16:52:49 — roughly twenty minutes of a team nobody was driving. The
two mechanisms that existed would each have stayed silent: the provider's `idleWatchdog`
arms only while a stream is outstanding, and the scheduler's idle edge never fired
because the runtime still said `running`. A process-level tick that reads a durable
per-agent heartbeat is the only witness that survives that shape.

## Where the state lives

Everything is under the **calling session's workspace** (resolved per call through the
adapter — never cached, never `process.cwd()` by assumption), beside the adopted team
record. The adopted `team.json` keeps its single writer (`state.js`); this package only
ever reads it.

```
<workspace>/<stateDir>/<teamId>/team.json                          adopted, READ-ONLY here
<workspace>/<stateDir>/watchdog/heartbeat/<memberKey>.jsonl        one stamp per line
<workspace>/<stateDir>/watchdog/scene/<teamId>/<iso>.json          one immutable file per incident
<workspace>/<stateDir>/watchdog/scene/<teamId>/latest.json         the pointer a restart reads
<workspace>/<stateDir>/watchdog/hold/<teamId>.json                 the durable hold sidecar
<workspace>/<stateDir>/watchdog/incidents.jsonl                    one record per WARN/ESCALATE
<workspace>/<stateDir>/watchdog/read-watermark.json                per-reader acknowledgement
```

`<stateDir>` defaults to `.mpd/team` (the same default the adopted plugin uses) and is
configurable on the row.

## The heartbeat

| Moment | Harness signal | Stamp |
|---|---|---|
| every model step | `agent/pre-step` | `{kind:'step', at, member, taskId, attemptId, …}` |
| a tool call is DISPATCHED | the adapter's PRE hook (`onPreToolExecute` → `tools/pre-execute`) | `{kind:'tool-start', at, tool, callId, …}` |
| a tool call COMPLETED | the adapter's POST hook (`onPostToolExecute`) | `{kind:'tool', at, tool, callId, ok, …}` |
| turn start | `agent/session-start` (or the first step) | `{kind:'turn-start', …}` |
| turn end | `agent/turn-stopping` | `{kind:'turn-end', …}` |

Members **and the captain** are stamped by the same code path: the member name (or
`captain`) is resolved against the team record by agent id / `captainSessionId`, and the
task is the member's current non-terminal task. An agent that belongs to no team in the
workspace is still stamped, under a per-session key — the file keys stay disjoint.

Heartbeat files are rotated at `turn-end`: the last `keepGenerations` (default 3)
generations survive, so a long-running member cannot grow its file without bound.

### Honest bound on the step stamp

`agent/pre-step` fires **before** the model call for that step, so a `step` stamp means
"a step began", not "the model answered". A stream that stalls mid-step still shows a
recent stamp. The residual blind spot is one step wide and is stated rather than hidden;
staleness is computed from the newest stamp of ANY kind, and a genuinely wedged turn
produces no further step either.

The tool heartbeat is a **PAIR**, and the pair is what makes a long call readable:

* `tool-start` is stamped by the adapter's PRE hook (`onPreToolExecute`, the harness's
  `tools/pre-execute` waterfall) **before the call dispatches**, and carries the tool name and
  the harness `callId`. The hook is **observe-only**: the adapter owns `next()` and returns the
  gate decision verbatim, so installing it changes nothing about the call — proven in
  `packages/mpd-dsh-adapter-plugin/test/adapter.test.ts` on a real cordis waterfall and a real
  command, and again in `evidence/team-watchdog/long-tool-false-positive/` (`observe-only-real-call.mjs`).
  A harness without the event bus degrades to a no-op with a warning, never a failed row.
* `tool` is stamped by `onPostToolExecute` when the call **completes** (the W-9 semantics are
  unchanged: completion, never before dispatch). The two are matched by `callId`.

A `tool-start` with no matching `tool` is an **OPEN call**: the silence rule treats it as
explained activity (r6) for at most `toolInFlightMaxMs`, and the honest limit below applies.

### The in-flight bound (r6) and what it costs

A member inside one long call — a real build, a lane that boots a `dsh`, a slow test — used to be
indistinguishable from a wedged one, because nothing stamps between the call's dispatch and its
completion. The tick then WARNed and, on the third observation, **paused a healthy team**
(measured: the watchdog held this repository's own team while a lane ran).

While an open call is younger than `toolInFlightMaxMs` (default `900000`, i.e. 10× the frozen
threshold) the candidate is neither WARNed nor ESCALATED and the streak is reset; the member is
watched again the moment the call completes. Past the bound the entry **stops suppressing** and is
reported **once** per task+attempt as a `tool-expired` incident — WARN-class only: no scene, no
hold, never an escalate, because a very long call and a hang inside a tool are indistinguishable
from the stamp stream and pausing on a guess is the defect this bound exists to fix.

* Lifecycle: opened by `tool-start`, closed by the `tool` stamp of the same `callId`. A `deny`
  opens nothing (the call never dispatches). A call that throws still gets a POST (the harness
  routes tool failures through `tools/post-execute`) and clears itself; a call killed by a process
  death, a pre-dispatch cancellation or a pipeline failure leaves no POST and is bounded by
  `toolInFlightMaxMs`.
* The state is **durable** (it lives in the same JSONL heartbeat file), so it survives a restart —
  a call that was open when the process died is reported once when the bound passes, instead of
  being forgotten.
* `toolInFlightMaxMs: 0` disables the suppression entirely (the pre-r6, POST-only behaviour); it is
  the fixture's own falsifier.

## The WARN → ESCALATE machine

```
OBSERVE (every tickIntervalMs)
  silence = now - newestStamp(owner, task)
  if an OPEN tool call for this task is younger than toolInFlightMaxMs:
      EXPLAINED -> no WARN, no ESCALATE, streak reset (past the bound: ONE tool-expired record)
  else if the owner's turn is expected in flight AND silence > warnSilenceMs:
      WARN(task, attemptId)     -> scene snapshot + incident
      streak[task+attempt] += 1
      if streak >= warnStreakToEscalate:
          ESCALATE(task, attemptId) -> scene + HOLD(team) + incident
          the key is then DONE: no fourth WARN, no second ESCALATE
  else:
      streak[task+attempt] = 0
```

The streak is keyed `<taskId>\0<attemptId>`, so a retry with a fresh attempt starts
clean. **A silence candidate is not every non-terminal task.** Candidacy is ONE
disjunction — *the task was handed to somebody at some point*:

* **a dispatch is on record** — a non-empty `attemptId`, written by the adopted scheduler at
  dispatch (`beginTaskAttempt(task, member)` in `lib/scheduler.js`, before the ticket reaches
  the member) and reused by the member's own `claim_task`; or
* **the task carries a stamp of its own**, of ANY generation, because a stamped task WAS
  worked on. This half reads the team-scoped stamps *unfiltered* on purpose: the W11-2 slice
  described below answers "is the CURRENT generation silent", not "was this task ever handed
  out", so a task whose attempt was revoked after it had been worked on stays observable. A
  stamp naming ANOTHER team says nothing about this task and cannot make it a candidate.

A task with neither was never handed to anybody: the normal state of a plan still `staged` and
awaiting the user's approval in the Web panel, of a task correctly blocked on unfinished
dependencies, and of one the scheduler has not reached yet. It is not observed at all —
`never-started` is DEFINED as a *claimed* task whose owner never stamped, and a task nobody
owns cannot be a wedge either. Without this rule a 12-task staged plan wrote **12**
`never-started` incidents and printed **12** console lines on EVERY host start (measured
2026-09-16); with it, zero, while a dispatched task whose owner never stamped is still
reported.

**The machine then reads the candidate**: a `claimed` task whose owner is legitimately between
turns is silent by design, and three WARNs against it would escalate a healthy team, so the
newest stamp decides — a `turn-end` newest stamp withholds the observation, no stamp for the
CURRENT generation is reported `never-started` (a dispatch observation that never escalates),
and anything else is measured against `warnSilenceMs`.

### The knobs

The `mpd` settings namespace is the live authority; the row config is the defaults
layer. All of them are re-read **on every tick** and on `settings/document-updated`, so a
live edit takes effect without a host restart, and a cadence change replaces the single
tick interval. The per-tick re-read is deliberate: the `mpd` namespace is registered
*deferred* (mpd-config parks its registration on the settings service), so a row that
applied first would otherwise sit on its own defaults until somebody edited settings.

| Knob | Default | Meaning |
|---|---|---|
| `watchdog.warnSilenceMs` | `90000` | silence beyond this is a WARN |
| `watchdog.tickIntervalMs` | `15000` | tick cadence; **clamped** when `>= warnSilenceMs` |
| `watchdog.warnStreakToEscalate` | `3` | consecutive WARNs for one task+attempt before ESCALATE |
| `watchdog.actionOnEscalate` | `pause` | `pause` persists the hold; `warn-only` only records |
| `watchdog.enabled` | `true` | kill switch (`MPD_DSH_TEAM_WATCHDOG=off` forces it off) |
| `watchdog.toolInFlightMaxMs` | `900000` | how long an OPEN tool call explains silence away; `0` disables the suppression (r6) |

The first five are declared in `mpd-config`'s schema and in the Web card's own
`FIELDS` list, **in those packages, not here**; `toolInFlightMaxMs` is read through the same
namespace and is *not* in that declaration yet — because schemastery keeps unknown
keys it is readable and settable from the namespace (and from the row config) regardless,
and it simply is not rendered in the two front doors until the declaration lands.

## The scene snapshot

One immutable file per incident plus a `latest.json` pointer, written temp+rename so a
torn read is impossible, and skipped entirely when the bytes are identical (a second
write of the same state changes nothing). The field set is exactly:

```
{ schemaVersion, at, reason:'warn'|'escalate', cause:{kind:'silence', ms},
  team:{ id, name, phase, halted, haltedAt, hold },
  tasks:[{ id, status, assignee, attempt, attemptId, lastSeen, streak }],
  members:[{ id, name, status, unread, currentTask, lastSeen }],
  mailbox:{ <reader>: watermark },
  parkedAttempts:{ <memberId>: <attemptId> },
  incidents:[{ id, kind, at, taskId, attemptId, scene }] }
```

If the scene location is unwritable the failure is **loud and non-fatal**: a named
warning carries the path and the errno, the hold is still attempted, and the incident is
still recorded — because a user who cannot get the scene must still learn that the team
is held.

Two fields are honest projections rather than the adopted plugin's own state:

* `members[].unread` mirrors the adopted unread predicate (`state.js:845-855`) because no
  adapter seam exposes it.
* `parkedAttempts` is the **durable** projection (assignee → attemptId of every
  non-terminal task). The adopted scheduler's in-process `Map` is not reachable through
  the adapter, and the design already treats this field as advisory.

## The hold, the incidents and the watermark

* `hold/<teamId>.json` = `{id, teamId, since, cause, taskId, attemptId, sceneAt}`. It is
  written temp+rename, idempotent by `id`, and it is a **preserving** hold: it exists to
  stop NEW dispatch into one team, never to cancel work. It is NOT `agent_teams_halt`
  (which cancels every non-terminal task).
* `incidents.jsonl` = one record per WARN/ESCALATE with its cause, its task/attempt and
  the path of the scene it wrote, plus `hold: 'applied' | 'not-applied' | 'not-requested'`.
  The WARN-class observations `never-started` and `tool-expired` (r6) live on the same
  surface, with `scene: null` and `hold: 'not-requested'` — they are replayed by the same
  readers and can never produce a hold.
* `read-watermark.json` = `{<reader>: <lastAckedIncidentTs>}`. Only an explicit
  acknowledgement moves a watermark forward, so without one the replay is permanent
  re-display — by design, and stated.

A team that is already held gets **no second scene and no second hold**; the incident is
still recorded.

## Hold enforcement — the reader w7 consults

**Option (b), named explicitly** (the plan's AMENDMENT 2, A2-1): a bare sidecar CANNOT
enforce the pause, because `state.js` owns `team.json` and every reader path goes through
`readTeam`, so the scheduler's three decline gates are blind to a sidecar. This package
therefore keeps the sidecar as the **durable, authoritative** record **and publishes a
stable synchronous reader** as the `mpdWatchdog` service. The adopted locked-path write of
option (a) is w7's business, not this package's.

The exact call shape a gate must use:

```js
const watchdog = ctx.get("mpdWatchdog", false)          // undefined when this row is absent
const hold = watchdog?.isHeld(teamId, workspace)         // synchronous, never throws
if (hold?.held) return noteDispatchDecline(/* … */, "held by the team watchdog")
```

The reader's contract:

| Member | Signature | Meaning |
|---|---|---|
| `isHeld` | `(teamId, workspace?) => { held, holdId, at, reason, taskId, attemptId, workspace, source }` | the answer a gate branches on (`held` is the only field it MUST test) |
| `holds` | `(teamId, workspace?) => boolean` | the terse form |
| `list` | `() => Array<{workspace, teamId, holdId, since, cause, taskId, attemptId}>` | read-only diagnostics |
| `hydrate` | `(roots?) => number` | re-scan the hold directories; called at apply and on demand |
| `hydratedRoots` | `() => string[]` | which workspaces have been scanned |
| `gateCall` | `string` | the documented gate expression, so the contract travels with the code |

Three properties a gate can rely on, each stated rather than implied:

* **Fail-open.** When this row is absent the service is absent, `isHeld` is never called and
  dispatch behaves EXACTLY as it does today. The watchdog can only ever ADD a decline; it can
  never keep a team stopped because its own row failed to load. Every member is non-throwing
  for the same reason — a decline gate runs inside the scheduler's hot path.
* **Cross-process.** The map is hydrated at apply from every hold file under the roots this
  process knows, and updated on every hold/resume this process performs. A team the map does
  not know is answered by ONE small file read, which is how a SECOND process learns of a hold
  the first one wrote (it does not need a restart, and it does not need the writer to be
  alive).
* **Pass the workspace.** One host serves many sessions, and a team id is only unique inside
  its workspace; `isHeld(teamId)` without one answers from memory and is correct only on a
  single-workspace host.

## The plugin's own actions

Registered through the adapter's tool seam, so w7 can drive them and this package never
touches the adopted plugin:

| Action | Contract |
|---|---|
| `session-watchdog-hold` | persist the preserving hold for one team; returns `applied:false` (never a throw) when it could not be written, so no caller can report a pause that did not land |
| `session-watchdog-resume` | clear it; a team that is not held is a **no-op** (`reason:'not-held'`), never an error |
| `session-watchdog-status` | read-only: the hold, heartbeat tails, incidents and watermarks for this workspace |

The tick routes its own ESCALATE hold through `session-watchdog-hold` via the adapter's
internal tool seam (falling back to a direct write, with a warning, only when the seam is
unreachable).

## Fail-safe

* the tick body never throws out: any error is caught, counted and logged;
* exactly ONE interval owns the cadence, cleared through `ctx.effect`;
* a tick that starts while the previous one still runs is **skipped**, never queued;
* a tick with no state change writes nothing (no write loop);
* an unwritable heartbeat or scene location degrades to a counted failure and a named
  warning;
* an idempotent hold is never announced as applied when it could not be persisted.

## NOT-CLAIMED (what this package deliberately does not do)

* **No dispatch gate.** Honouring the hold in the adopted scheduler's decline sites, and
  the tool-boundary guard that denies a claim while a team is held, are **w7's** work. This
  row lands the hold, its durable record and the reader that makes it enforceable; nothing in
  the adopted tree is edited.
* **No notification surface.** The Web banner/activity record and the TUI status row and
  dialog are later tasks. The notice-of-record here is the durable incident record, which
  those three readers consume.
* **No wedge detection INSIDE a hanging tool.** The r6 in-flight rule explains a long call away;
  a member wedged *inside* one is reported (a `tool-expired` incident once the bound passes) and
  never escalated or paused. Stated in the bound section above, and it is the price of not pausing
  healthy teams for running real work.
* **`toolInFlightMaxMs` is not in the front-door declaration yet.** It is read through the `mpd`
  namespace and the row config like the other knobs, but `mpd-config`'s schema/`FIELDS` row lives in
  that package, so the two front doors do not render it until that declaration lands.
* **An in-flight turn is not aborted.** The hold stops new dispatch; only a real chat
  interrupt ends a wedged turn. A member that recovers after ESCALATE finds the team held
  and cannot advance it — which is the intended outcome.
* **No real-wedge verification here.** The unit suite drives the machine with an injected
  clock and a stub adapter; the fault-injection and live-wedge lanes are other tasks.
* `parkedAttempts` and `unread` are the projections described above.

## Verify

```
bun run typecheck
bun test packages/mpd-team-watchdog-plugin
node scripts/verify-rows-parity.mjs
bun skills/dsh-qa/scripts/bundle-lifecycle.mjs
node skills/dsh-qa/scripts/preset-conformance.mjs
```

## Files

| Path | Role |
|---|---|
| `src/index.ts` | the cordis row: `name` / `Config` / `apply`, alone |
| `src/engine.ts` | the writers, the tick and the WARN/ESCALATE fan-out |
| `src/machine.ts` | the knobs and the WARN→ESCALATE arithmetic |
| `src/store.ts` | the heartbeat files, their rotation and atomic writes |
| `src/team.ts` | the READ-ONLY view over the adopted team record |
| `src/scene.ts` | the scene document, its atomic write and the unread mirror |
| `src/sidecars.ts` | the hold, the incident log and the read watermark |
| `src/actions.ts` | the three tool actions |
| `src/paths.ts` | every path, resolved per call |
