# mpd-team-watchdog

[中文](./README.zh-CN.md)

A DSH cordis plugin that watches an AgentTeams team for a **wedged turn**: a member
(or the captain) that stops stepping without ever finishing. It folds the member's own
record stream (`session/event`) into ONE of four channel states — `OUTSTANDING`,
`IN-FLIGHT`, `ALIVE`, `PARKED` — and only an `OUTSTANDING` request, unanswered past
`warnSilenceMs`, earns a **WARN**; `warnStreakToEscalate` consecutive `OUTSTANDING`
observations earn an **ESCALATE**, which persists a durable, preserving **hold** for the
affected team ONLY when the resolved `actionOnEscalate` is `pause` (the default is
`warn-only`). Every state change keeps a restorable **scene snapshot**.

The heartbeat is still written, but it is no longer the verdict: it bounds the
`tool-expired` report and remains the **report-only** fallback when the channel fold has
no evidence. **A hold stops NEW DISPATCH only** — it never declines `claim_task`,
`update_task` or a kick.

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
adapter — never cached, never `process.cwd()` by assumption). 0.1.7 retired the vendored
`agent-teams` plugin and its `<stateDir>/<teamId>/team.json`, so there is NO team file of that
shape on this path any more: the roster and the board are read LIVE, from the **MPD TEAM RECORD**
first (`mpdTeams.list(workspace)`, `.mpd/team/teams/<teamId>.json` — the AUTHORITATIVE plane, whose
`team-<stamp>` ids are the ones `agent_teams_dispatch` asks about) and from the OFFICIAL Agent Teams
readout (`dsh.teamLiveTeams()`) as the fallback for a composition that runs the official executor.
Every file below belongs to this package alone.

```
<workspace>/<stateDir>/watchdog/heartbeat/<memberKey>.jsonl        one stamp per line
<workspace>/<stateDir>/watchdog/scene/<teamId>/<iso>.json          one immutable file per incident
<workspace>/<stateDir>/watchdog/scene/<teamId>/latest.json         the pointer a restart reads
<workspace>/<stateDir>/watchdog/hold/<teamId>.json                 the durable hold sidecar
<workspace>/<stateDir>/watchdog/incidents.jsonl                    one record per WARN/ESCALATE
<workspace>/<stateDir>/watchdog/read-watermark.json                per-reader acknowledgement
```

`<stateDir>` defaults to `.mpd/team` (kept for continuity with the retired default) and is
configurable on the row. The `/watchdog/` namespace is the only thing this package writes.

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

## The channel predicate — four states, ONE authority

Wall-clock silence is no longer a verdict. Per member (per owned task + attempt) the
watchdog folds the member session's own record stream into exactly ONE state:

| State | Record-level definition (per member session) | Watchdog action |
|---|---|---|
| `OUTSTANDING` | an OPEN step (`step/start` with no `step/end`) with NO committed `assistant/message`/`assistant/attempt` for it | the ONLY warnable state: WARN once `warnSilenceMs` elapsed since the request became outstanding, ESCALATE per the ladder |
| `IN-FLIGHT` | the open step has an answer AND a `tool/call` has no matching `tool/result` | ALIVE until `toolInFlightMaxMs` past the call start, then exactly ONE `tool-expired` report (WARN-class: no scene, no hold, no escalate) |
| `ALIVE` | a committed answer, a completed step/tool result, or a turn that has not closed | never a wedge, regardless of age |
| `PARKED` | no open turn: between turns, dependency-blocked, finished-but-unupdated, staged plan, unclaimed task, or the member session is not attached | never a wedge, never a warn, never a hold |

* **The fold is the primary signal** (`session/event`, an EMIT dispatch, so a listener
  return value is ignored and no turn can be vetoed). Events used: `turn/start`,
  `turn/end`, `step/start`, `step/end`, `assistant/message`, `assistant/attempt`,
  `tool/call`, `tool/result`. An unknown (extension) event type changes no verdict.
* **ONE authority per conclusion.** The fold decides the STATE; the heartbeat stamps decide
  only the `tool-expired` BOUND and remain the fallback source below. Two sources never
  both decide one conclusion.
* **A completed step is ALIVE forever.** "How long ago" is irrelevant; only an
  `OUTSTANDING` request has a clock.
* **Streaming is not a non-response — with a signal.** While the model delivers a long
  answer, no `assistant/message` is committed yet. The `agent/assistant-stream` START frame
  (the §2 enrichment, soft-probed at apply) flips the open `(turn,step)` to `ALIVE`. **When
  that enrichment is unavailable the state honestly stays `OUTSTANDING`** and the
  `warnSilenceMs` bound is the protection: that asymmetry is stated here on purpose, and in
  the agent-facing troubleshooting reference, because it is the one place where the watchdog
  is deliberately conservative instead of silent. The same is true of a harness that never
  emits a first-token signal at all.
* **Zero attempts / never stamped is never a wedge.** A task whose owner never stamped is
  reported `never-started` (a dispatch observation) and never holds or escalates. The
  candidate precondition above is unchanged.
* **Degradation is loud, never silent (a watchdog that goes quiet is worse than a noisy
  one).** With no `session/event` seam, or with no folded event for a live member that owns
  an open attempt, the engine FALLS BACK to the heartbeat rule in **REPORT-ONLY** mode: it
  may WARN **once** per task+attempt with the cause `silence-heartbeat`, and it can NEVER
  hold or escalate. The fallback is announced with ONE warning line per process, and
  `session-watchdog-status` names the active predicate source (`channel` or `heartbeat`).
* **Waterfall safety.** The plugin may subscribe to a waterfall event only if the listener
  delegates (`return next()`), contains its own failures and is pinned by a negative-control
  test; `agent/pre-step` is the one such subscription and its discipline is unchanged. The
  fold's own subscription is an emit.

## The §3 ladder (WARN → ESCALATE)

```
OBSERVE (every tickIntervalMs) — the channel verdict decides the state
  ALIVE / PARKED      -> no WARN, no ESCALATE, streak reset (age is irrelevant)
  IN-FLIGHT           -> explained until toolInFlightMaxMs past the call start
                         (past it: ONE tool-expired record, never a hold)
  OUTSTANDING         -> silence = now - (the moment the request became outstanding)
                         if silence > warnSilenceMs:
                             WARN(task, attemptId, cause=silence-channel) -> scene + incident
                             streak[task+attempt] += 1
                             if streak >= warnStreakToEscalate:
                                 ESCALATE(task, attemptId) -> scene + HOLD(team) + incident
                                 (the hold only when actionOnEscalate === 'pause')
                                 the key is then DONE: no further WARN, no second ESCALATE
  NO CHANNEL EVIDENCE -> the heartbeat rule, REPORT-ONLY (one warn, cause=silence-heartbeat,
                         never an escalate, never a hold)
```

The streak is keyed `<teamId>\0<taskId>\0<attemptId>`, where `attemptId` is the generation
token: the OFFICIAL board's monotonic `revision` (0.1.7 replaced the retired record's attempt id
with it — see `src/team.ts`), so a re-claim or a re-open starts clean. **A silence candidate is
not every non-terminal task.** Candidacy is ONE disjunction — *the task was handed to somebody at
some point*:

* **the task is OWNED** — the official board sets `ownerName` exactly at
  `team_task_update action=claim` / `reassign`, and the projection reports that as `dispatched`;
  or
* **the task carries a stamp of its own**, of ANY generation, because a stamped task WAS
  worked on. This half reads the team-scoped stamps *unfiltered* on purpose: the W11-2 slice
  described below answers "is the CURRENT generation silent", not "was this task ever handed
  out", so a task whose owner changed after it had been worked on stays observable. A
  stamp naming ANOTHER team says nothing about this task and cannot make it a candidate.

A task with neither was never handed to anybody: it is an UNOWNED row, exactly what
`team_task_create` produces before anybody claims it, and also the normal state of a task
correctly blocked on unfinished dependencies. It is not observed at all — `never-started` is
DEFINED as a *claimed* task whose owner never stamped, and a task nobody owns cannot be a wedge
either. Without this rule a 12-task plan wrote **12** `never-started` incidents and printed
**12** console lines on EVERY host start (measured 2026-09-16); with it, zero, while a claimed
task whose owner never stamped is still reported.

**The machine then reads the candidate**: a `claimed` task whose owner is legitimately between
turns is silent by design, and three WARNs against it would escalate a healthy team, so the
newest stamp decides — a `turn-end` newest stamp withholds the observation, no stamp for the
CURRENT generation is reported `never-started` (a dispatch observation that never escalates),
and anything else is measured against `warnSilenceMs`.

**T-16 — the silence slice is GENERATION-SCOPED.** A stamp whose generation token names a
DIFFERENT revision than the task's current one belongs to a previous generation of that task and
can no longer make it silent: the candidate is reported `never-started` instead (a report that
never holds). 0.1.7 replaced the retired record's `createdAt`/`approvedAt` floor with the official
board `revision`: the official readout carries NO record timestamps at all, so `candidateFor`'s
floor is `null` (PERMISSIVE, the documented §0/A3 convention) and the revision is what scopes a
stamp to a generation. Two deliberate asymmetries stay: the bound applies to the
**silence/hold slice only** — the dispatch precondition still counts an earlier-generation stamp
as "this task was handed out" (the r7 pin), because a task nobody can see is a false negative
that no lane would ever report — and a stamp that carries NO generation token cannot contradict
the current one and is kept, since an undateable stamp must not turn the watchdog silent.

**T-20 — a member waiting on a dependency is PARKED, not silent.** A member whose only open
tasks are blocked by dependencies that are not terminal has nothing claimable: the watchdog
derives that from the live readout alone (the projection carries each task's `blockedBy` as
`dependencies`) and
suppresses the silence rule for it, reporting `PARKED`. No new member-facing wait tool exists —
the derivation is the whole mechanism. Two readings are deliberately conservative: a dependency
naming a task that is not in the record counts as unfinished (a task that cannot be shown
finished has not been shown finished), and a member with no open task is not "blocked" (there is
nothing to wait for).

### The knobs

The `mpd` settings namespace is the live authority; the row config is the defaults
layer. All of them are re-read **on every tick** and on `settings/document-updated`, so a
live edit takes effect without a host restart, and a cadence change replaces the single
tick interval. The per-tick re-read is deliberate: the `mpd` namespace is registered
*deferred* (mpd-config parks its registration on the settings service), so a row that
applied first would otherwise sit on its own defaults until somebody edited settings.

| Knob | Default | Meaning |
|---|---|---|
| `watchdog.warnSilenceMs` | `600000` | how long a request may stay `OUTSTANDING` before the FIRST warn |
| `watchdog.tickIntervalMs` | `15000` | tick cadence; **clamped** when `>= warnSilenceMs` |
| `watchdog.warnStreakToEscalate` | `6` | consecutive `OUTSTANDING` observations after the first warn before ESCALATE |
| `watchdog.actionOnEscalate` | `warn-only` | `pause` persists the hold; `warn-only` only records — a hold is OPT-IN |
| `watchdog.enabled` | `true` | kill switch (`MPD_DSH_TEAM_WATCHDOG=off` forces it off) |
| `watchdog.toolInFlightMaxMs` | `900000` | how long an OPEN tool call explains silence away; `0` disables the bound (r6) |
| `watchdog.holdTtlMs` | `900000` | the bound after which a persisted hold is auto-released with a durable `hold-auto-released` incident; `0` = never expire |

These numbers are the frozen §3 table: they appear in `machine.ts`'s `WATCHDOG_DEFAULTS`,
in this row's own `Config` schema and in the bundle patch's row config, and the three layers
must agree exactly. The declaration of the first five in `mpd-config`'s schema and in the Web
card's own `FIELDS` list belongs to **those packages, not here**; the knobs are read through
the `mpd` namespace and, because schemastery keeps unknown keys, a knob is readable and
settable from the namespace (and from this row's config) before that declaration lands.
`holdTtlMs` is declared, resolved AND consumed on this row: a hold persisted by a `pause`
escalation carries it, and T-17's auto-release path lifts the pause when the bound elapses (or
when the team produces a stamp newer than `since`), with a durable `hold-auto-released` record.
A manual hold is still cleared immediately by `session-watchdog-resume` (or by hand from the
hold sidecar).

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

Three fields are honest projections rather than the harness's own state:

* `members[].unread` is ALWAYS `null`: the durable peer mailbox lives in the Lead Session log
  (`team/message/queued` / `team/message/delivered`) and no adapter seam reports a per-member
  unread count. The retired `<teamDir>/inbox/*.jsonl` mirror is gone with the plugin that wrote
  it, and `null` — "not observable" — is the honest answer where the old reader fabricated `0`
  for a missing file.
* `parkedAttempts` is the **durable** projection (assignee → generation token of every
  non-terminal task). The scheduler's in-process `Map` is not reachable through
  the adapter, and the design already treats this field as advisory.

## The hold, the incidents and the watermark

* `hold/<teamId>.json` = `{id, teamId, since, cause, taskId, attemptId, sceneAt, ttlMs}`. It
  is written temp+rename, idempotent by `id`, and it is a **preserving** hold: it exists to
  stop NEW dispatch into one team, never to cancel work. It is the ONLY pause this bundle
  implements: 0.1.7 retired `agent_teams_halt` with the plugin that owned it, and the official
  Agent Teams service exposes no halt on any seam this plugin may call.
* **T-17 — a hold releases itself, on two bounds.** Every hold carries `ttlMs` (the resolved
  `watchdog.holdTtlMs` for a hold the watchdog raises; a manual `session-watchdog-hold` may
  override it with `ttl_ms`, and `0` means "no TTL"). A hold is auto-released when EITHER
  `now - since >= ttlMs` (`ttlMs > 0`) OR **any heartbeat stamp for that team is newer than
  `since`** — a member that demonstrably worked has disproved the wedge. Both paths write one
  durable `hold-auto-released` incident (`cause.kind: "hold-auto-released"`, `cause.release:
  "ttl" | "activity"`), log one line, and touch **no team state at all** — none is reachable:
  the official board lives in the Lead Session log and this plugin writes only its own files. The
  pause stays preserving, exactly like `session-watchdog-resume`. A hold written before this field
  existed reads as `ttlMs: 0`, so no bound is ever invented for it. The pass runs at the head
  of every tick and reads the hold **files** (the durable truth), so a process whose
  synchronous reader was never hydrated still releases an expired pause.
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

### The pause surface — one mechanism, and it is this package's hold

0.1.7 retired `agent_teams_halt` / `agent_teams_resume` with the vendored plugin that owned them,
and the official Agent Teams service exposes no halt on any seam this plugin may call. The
watchdog's own **preserving** hold is therefore the ONLY pause mechanism the bundle has. The
status view reports ONE pause state — `team-a: PAUSED — the watchdog's preserving hold (the only
pause mechanism; the official team service exposes no halt)` vs `team-a: not paused` — in the
rendered text AND as a `pause: {paused, mechanism: "watchdog-hold", implementation, halted, held}`
object per team in the JSON, whose `halted`/`held` stay diagnostics (`halted` is always `false`,
kept so a consumer's payload shape is unchanged).

### §7.2/§7.3 — the knobs' live value vs the FILE's

`.mpd/mpd.jsonc` reaches a process's `mpd` namespace **once, at mount**: a file edit is invisible
until the next `dsh` boot. The status view therefore prints, per knob, the **live** value the
process is running with and the **file** value when it differs, plus a `restartRequired` boolean
(`warnSilenceMs=7200000 (file 900000, restartRequired)`); the engine logs ONE warning per process
naming both values the first time it sees a divergence (`KNOBS DIVERGE (§7.3) … `). The file is
read from the workspace (never `DSH_HOME`) with a tolerant JSONC reader — comments, a trailing
comma, a missing file or a malformed document all degrade to "the file states nothing", which can
only ever suppress a divergence report, never invent one.

## Hold enforcement — the reader w7 consults

**Option (b), named explicitly** (the plan's AMENDMENT 2, A2-1): a bare sidecar CANNOT
enforce the pause, because `state.js` owns `team.json` and every reader path goes through
`readTeam`, so the scheduler's three decline gates are blind to a sidecar. This package
therefore keeps the sidecar as the **durable, authoritative** record **and publishes a
stable synchronous reader** as the `mpdWatchdog` service. 0.1.7 CLOSED option (a): the official
Agent Teams service has no halt field to write and no adapter seam may invent one, so the
sidecar plus this reader is the only route, and it is the one implemented here.

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
touches the team service:

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

* **No dispatch gate.** Honouring the hold in the scheduler's decline sites, and the
  tool-boundary guard that denies a claim while a team is held, are **w7's** work. This row
  lands the hold, its durable record and the reader that makes it enforceable; no harness module
  is edited.
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
* `parkedAttempts` is the projection described above, and `unread` is `null` by construction
  (the official mailbox is not observable through the adapter).
* **No team mutation, by construction.** The watch list is the MPD team record (read through the
  `mpdTeams` service) with the harness's own live readout (`dsh.teamLiveTeams()`) as the fallback —
  both are only READ; every file it writes lives under `<stateDir>/watchdog/`.

## Verify

```
bun run typecheck
bun test packages/mpd-team-watchdog-plugin
node scripts/verify-rows-parity.ts
bun skills/dsh-qa/scripts/bundle-lifecycle.ts
node skills/dsh-qa/scripts/preset-conformance.ts
```

## Files

| Path | Role |
|---|---|
| `src/index.ts` | the cordis row: `name` / `Config` / `apply`, alone |
| `src/engine.ts` | the writers, the tick and the WARN/ESCALATE fan-out |
| `src/machine.ts` | the knobs, the WARN→ESCALATE arithmetic and the §7.2 knob readings |
| `src/channel.ts` | the §1 four-state channel fold (`session/event`) |
| `src/store.ts` | the heartbeat files, their rotation and atomic writes |
| `src/team.ts` | the READ-ONLY projection of the team plane: the MPD record (`mpdTeams`) first, the official live readout (`dsh.teamLiveTeams()`) as the fallback |
| `src/scene.ts` | the scene document, its atomic write, and the honest `unread: null` |
| `src/sidecars.ts` | the hold, the incident log and the read watermark |
| `src/actions.ts` | the three tool actions |
| `src/config-file.ts` | the §7.2/§7.3 file layer of `.mpd/mpd.jsonc` (tolerant JSONC) |
| `src/holds.ts` | the synchronous hold reader the w7 gates consult |
| `src/paths.ts` | every path, resolved per call |
