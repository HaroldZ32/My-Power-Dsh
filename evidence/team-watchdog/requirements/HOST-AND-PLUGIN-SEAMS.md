# t43 (decisions-scoped) — HOST AND PLUGIN SEAMS FOR THE HARD-CODE HEARTBEAT + WATCHDOG

Companion to the broad groundwork dossier in this directory (`20260915T090440Z/HOST-WATCHDOG.md`).
That file remains the option-space survey; **this file is the evidence aimed at the user's five
decisions** (relayed by the captain for t43, and carried verbatim below because t44/t45 quote them).
Read-only: the only writes performed are files in this directory.

Pins: repo `/root/dshProj/my-power-dsh`; harness `$H = /root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
(`@deepseek-ai/dsh` 0.1.5-rc.1, packages 0.1.5-rc.2); TUI host `$T = /root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-harness-tui/dsh-tui`
(0.10.1); adopted plugin `$L = packages/mpd-agent-teams-plugin/lib/`.

## The five user decisions, verbatim

1. **Heartbeat granularity: every model step and every tool call** (both members and the captain).
2. **Thresholds: sensible defaults AND configurable — knobs in the settings schema we just bridged**
   (the `mpd` namespace), so they appear in the TUI `/settings` screen and in the Web card through the
   SAME path, not in a side file. Working defaults: silence > 90 s ⇒ WARN + heartbeat snapshot; the
   same task triggering WARN three consecutive times ⇒ ESCALATE.
3. **Pause scope: the affected TEAM only** — scheduler halt plus members no longer claiming work, scene
   preserved, resumable by one `agent_teams_resume`. Not the whole workspace, not the session.
4. **Notification surfaces:** Web = a banner at the top of the AgentTeams panel PLUS an activity
   record; TUI = a status-line row PLUS a dialog/notice — and a user who was not watching must still
   learn about it on the next start (unread replay).
5. **Coverage: members AND the captain.** The captain cannot rescue itself while wedged, so plan for a
   process-level tick that writes the scene to disk and lets the next start (or a front door) surface it.

---

## D1 — Heartbeat at every model step and every tool call, for members AND the captain

### The two moments exist in the harness, and neither is private

| Moment | Exact site | Cadence |
|---|---|---|
| **Every model step** | `agent/pre-step` waterfall — `$H/dsh-agent-loop/lib/index.js:894` | once per step, before the model call |
| (finer, same family) streamed output | `agent/assistant-stream` — `:1032` | once per streamed frame |
| **Every tool call** | `tools/pre-execute` (`$H/dsh-tools/lib/types/index.d.ts:38`), `tools/execute` (around-dispatch, `:49`), `tools/post-execute` (`:61`), `tools/result` (`:83`, "Observe the frozen, lossless-JSON final outcome") | once per dispatched call |
| turn boundaries | `agent/turn-stopping` `:967`; `agent/status` transition `:781` | per turn / per status change |

All are ordinary Cordis events. The tool waterfalls are **scope-filtered by `dsh-scope`** — an
agent-scoped listener receives only that agent's calls, and "a plain-context guard applies globally"
(`$H/dsh-tools/lib/types/index.d.ts:612`) — so a single process-level listener can observe **both a
member's and the captain's** tool calls, which is exactly decision 5's requirement.

### Our adapter already wraps both hook families (measured)

`packages/mpd-dsh-adapter-plugin/src/index.ts`: `guardTool` (`:273`, impl `:529`) = the pre-execute
gate; `onPostToolExecute` (`:274`, impl `:535`) = the post-execute waterfall; `executeTool` (`:279`,
impl `:564`) = internal calls. `AGENTS.md` §6 fixes the rule: a plugin row must reach harness seams
**only** through this adapter. Consequence: a **NEW plugin row can stamp a heartbeat on every step
(`agent/pre-step`) and every tool call (`onPostToolExecute`) with ZERO adopted-code edits**, for members
and the captain alike — the agent is on the payload (`agent/pre-step` carries `{agent, messages, step,
signal}`; the tool waterfalls carry `exec.agent`).

Honest limits, both measured:
- The adapter exposes **post**-execute only; a *pre*-call stamp would need `guardTool`, whose contract in
  `AGENTS.md` §6 is "read only, never mutate" — writing a heartbeat there would violate the guard
  contract. If a pre-call stamp is wanted, the adapter must extend to `tools/execute`
  (`$H/dsh-tools/lib/types/index.d.ts:49`, "wrappers may change only `exec.signal`") — an adapter change
  in OUR package, no delta involvement.
- The captain's *own* wedge case (decision 5) cannot be rescued by a listener owned by the captain's
  process context alone; see D5.

**Region verdict (D1): NO adopted-code change is required.** Heartbeat = new module(s) in a new bundle
plugin row + the existing adapter hooks. Only if a stamp must be written *inside* `$L/**` (e.g. to
correlate a stamp with an attempt at the exact moment the plugin dispatches) does it become an
**ADDITIVE region** in an adopted file, with the self-heal consequence described in the groundwork
dossier (b).

### What the stamp must contain to satisfy decisions 2–3

Enough to attribute silence to a TEAM, a TASK and an ATTEMPT (decision 3 pauses a team, decision 2's
streak counts per task): `{teamId, taskId, attemptId, member, kind: 'step'|'tool', at}` — all of which
are already durable identifiers in `team.json` (see the groundwork dossier (d)); the stamp adds only the
`at` and the kind.

---

## D2 — Thresholds: knobs in the bridged `mpd` namespace

### The bridged path as it exists NOW (measured; the bridge wave landed)

| Piece | Where | Note |
|---|---|---|
| Single source of namespace + schema + knob metadata | `packages/mpd-config-plugin/src/settings-schema.ts` — `SETTINGS_NS = "mpd"` (:11), `SettingsSchema` (6 groups), `SETTINGS_KNOBS` (path/label/zh/kind/options), the two disclosure constants | module doc: "ONE source … so the two front doors cannot drift" |
| Registration (with the file-derived `base`) | `packages/mpd-config-plugin/src/index.ts:511` `dsh.settingsRegister(SETTINGS_NS, SettingsSchema, { base, applies: "restart" })`; reader `:232`/`:418`; mutate `:319`/`:463`; doc-updated subscription `:478` | design §10.1: the only module that can supply `base` |
| TUI `/settings` section fields | `packages/mpd-tui-plugin/src/settings.ts:99` — `SETTINGS_KNOBS.map(...)` | derived, so a new knob appears in the TUI automatically |
| Web card | `packages/mpd-bundle-plugin/src/settings-card.js` — its **own** `FIELDS` (:46, "The six knobs — the SAME fields the TUI `/settings` section declares"), consumed at :108/:242/:306/:350 | **a second writer for the field LIST** — a new knob must be added here too |

⇒ Adding the watchdog knobs is a three-file change in OUR packages (schema+knobs, card FIELDS, nothing in
`$L/**`), and it goes through the same namespace, the same write path and the same bridge that already
persists to `<workspace>/.mpd/mpd.jsonc`. No delta region is involved.

### Proposed knob paths (nested under a `watchdog` group) and who reads each

| Knob path | Kind | Default (to fix) | Read by |
|---|---|---|---|
| `watchdog.warnSilenceMs` | number | `90000` | the process-level tick (D5) — ages the newest heartbeat for a live team/task |
| `watchdog.tickIntervalMs` | number | `15000` (must be < `warnSilenceMs`) | the process-level tick's cadence |
| `watchdog.warnStreakToEscalate` | number | `3` | the escalator — counts consecutive WARNs **for the same task** (decision 2) |
| `watchdog.pauseOnEscalate` | boolean | `true` | the escalator — whether ESCALATE performs the team pause (decision 3) instead of warning only |
| `watchdog.actionOnEscalate` (optional, if a knob is preferred over a boolean) | select `pause` \| `warn-only` | `pause` | same reader as above; pick ONE of the two spellings when the plan freezes |

Schema consequence to note in the plan: the namespace is registered with **`applies: "restart"`**
(`index.ts:511`), so a knob change does not retro-apply to a running watchdog unless the tick re-reads on
`settings/document-updated` — the bridge already subscribes exactly that way (`index.ts:478`), so the
pattern to copy exists.

---

## D3 — Pause the affected TEAM only: what exists, and THE BLOCKER

### What already makes a pause team-scoped (all measured)

| Behaviour | Site |
|---|---|
| Scheduler dispatch declines for a halted team | `$L/scheduler.js:422-423` (`'the team is halted'`), inside region `mpd-delta kick-team-decline-logs` |
| Kick path declines on halted **or** staged | `$L/scheduler.js:454-455` |
| Re-check under the team lock (a halt that lands while a kick waits) | `$L/scheduler.js:490-491` |
| Halt is per-team state | `$L/tools.js:249-250` sets `team.halted`/`haltedAt`; appendTeamEvent `agent-teams/team-halted` `:252-255` |
| One-action resume | `$L/tools.js:2216-2235` `agent_teams_resume` (non-empty `reason`); `$L/quality-gates.js:839-852` `resumeTeamState` clears `halted`/`haltedAt` |

### THE BLOCKER for decision 3 ("scene preserved, resumable by one resume") [MEASURED]

`haltTeamWork` (`$L/tools.js:225-281`) **cancels every non-terminal task** before it halts:

```
for (const task of fresh.tasks) {                 // tools.js:241-246
    if (TERMINAL_TASK_STATUSES.includes(task.status)) continue;
    cancelUnfinishedTask(task, 'Stopped from the captain chat.');
    cancelledTasks += 1;
}
```

and it then cancels the captain's turn (`:267`) and drains every member activation (`:268`). The resume
side is explicit about the consequence: `agent_teams_resume` — *"Does not recreate cancelled tasks; only
still-pending work is scheduled"* (`$L/tools.js:2217`), and `resumeTeamState` only flips the flag
(`quality-gates.js:839-852`). `AGENTS.md` §12 records the same class of hazard for cancellations
("a cancelled dependency's downstream is CANCELED too").

⇒ **Pausing a wedged team with today's `agent_teams_halt` destroys exactly the work the watchdog exists
to protect** (the wedge's partial evidence, the open attempt of the task being reviewed), and the single
`agent_teams_resume` the user asked for would NOT bring it back. This is the one place where the
decision cannot be implemented by reuse alone.

### Also missing at the tool boundary [MEASURED]

`agent_teams_claim_task` has **no `halted` guard** in its body (`$L/tools.js:1343`, body through
`:1420`: the transitions it enforces are status/assignee rules). The `halted` guards in `tools.js` sit at
`:111` (plan approval), `:228` (halt idempotence), `:1139` (create_task without resume), `:1991`. So
"members no longer claiming work" is enforced today only by the **scheduler's dispatch decline** plus the
activation drain — a member that already holds an attempt can still call `agent_teams_update_task`.

### What the design must therefore add (options, region-scoped honestly)

- **(a) A distinct PRESERVING pause** — e.g. a durable `watchdogHold` (or `paused`) record on the team
  plus the same decline gates, leaving task statuses and attempts untouched. Requires: the durable field
  (state.js = adopted → region or a sidecar file written by the new plugin) and a decline gate wherever
  dispatch happens (the existing decline sites are already REGIONS — `mpd-delta kick-team-decline-logs`,
  `kick-member-locked-decline-logs`, `idle-edge-*` — so a new gate would follow the same ADDITIVE shape).
- **(b) Reuse `halted` but stop the mass cancel** — a REPLACEMENT-shaped change to `haltTeamWork`
  (`tools.js:241-246`): after a re-materialise the heal REFUSES loudly (D13/D14/`pool-capability-select`
  class) and the remedy is restore-or-re-author + `--write-registry`. Higher maintenance cost; only worth
  it if the team wants ONE halt semantic.
- **(c) Add the `halted` guard to `claim_task`/`update_task`** so "no longer claiming work" is true at the
  tool boundary as well as at dispatch — an ADDITIVE region each (they are new checks, not replacements).
- **Resume**: whichever pause is chosen, the one-action resume must re-arm the *still-claimed* attempts.
  The re-dispatch machinery already exists for parked attempts (`$L/scheduler.js:397`, `:515-548`,
  `:620-630`) — the plan should route the resume through it rather than through `resumeTeamState` alone.

---

## D4 — Notification surfaces and unread replay

### Web: banner + activity record

- **Banner location:** the AgentTeams panel header is rendered by our bundle client —
  `packages/mpd-bundle-plugin/src/team-page.js`: the page reads `snapshot.teams` (`:121-122`) and renders
  the panel `header` with the activity title at `:437-448`; a banner is a new element directly under that
  header, fed by a new snapshot field.
- **What the banner reads:** the snapshot assembled by `$L/snapshot.js` (`assembleTeamActivity` family,
  `:40-118`) already carries `phase`, `halted` (only when true, `:98`), per-member `activity`
  (`:71-79`) and `unread` (`:84`). The stuck/warn state must be added as a field there (e.g.
  `watchdog: {state: 'warn'|'escalated', since, taskId, attemptId, reason}`) — the panel needs no new
  transport, only a new field plus the banner element.
- **Activity record:** two honest options, both measured — (i) a durable record written by the watchdog
  next to `team.json` (a JSONL `watchdog.jsonl` or a field in the scene file) and surfaced as a snapshot
  list, or (ii) `appendTeamEvent(ctx, session, type, data)` (`$L/events.js:26-40`) — which **only emits
  when the running harness knows the type** (`:33-38`), so it cannot be the sole record. Option (i) is
  the one that survives "the user was not watching" (see replay).

### TUI: status-line row + dialog/notice

- **Status line:** the mechanism already exists end-to-end in our TUI plugin —
  `packages/mpd-tui-plugin/src/status.ts:44` takes `bridgeNotice?: () => string | undefined`, and
  `packages/mpd-tui-plugin/src/state.ts:259-275` `statusLine(state, notice)` appends the notice last;
  `packages/mpd-tui-plugin/src/index.ts:226` wires that runtime-notice path today for the settings
  bridge. A stuck state rides the SAME row (persistent while the condition holds, which the
  fire-and-forget toast cannot provide).
- **Dialog/notice:** `ctx.tuiToast.show(text, { color:'warning' })` — service id `tuiToast`
  (`$T/lib/types/dsh-adapter/toast.d.ts:1-80`; transient, ≤200 cells, 20/min, dropped with no sink) —
  plus `tuiDialogs` (`packages/mpd-tui-plugin/src/dialogs.ts:39`, `select/confirm/input`) if an
  acknowledgement is wanted.

### Unread replay on the next start

The readers that run at/after a start, measured:
1. the Web panel's first poll — `team-page.js:101-165` (polling controller + `subscribeActivitySnapshots`);
2. the TUI status publisher — the interval in `status.ts` (its `publish()` is called on mount and on the
   cadence) reading `board state` + the notice thunk;
3. the plugin's session-start path — `$L/capabilities.js:110` `ctx.on('agent/session-start', ({agent}) =>
   attach(agent))` (and the session-start notice region `mpd-delta session-start-gate` in
   `session-start.js`).

What does NOT exist: any notion of "the user has seen this notice". The **precedent to copy** is the
mailbox unread model — `snapshot.js:49-56` counts unread per member via `readUnreadMailbox` and `:84`
publishes it — so the durable watchdog record needs the same shape (a record per incident + a read
watermark), otherwise "unread replay" degrades to "always shown until acknowledged by hand".

**Region verdict (D4): none of this needs adopted-code changes** — the snapshot field, the panel banner,
the TUI status row and the durable record are all OUR packages or new files; the only adopted-code touch
would be if the notice is appended as a session event type the harness knows (option (ii) above), which is
not recommended as the primary path.

---

## D5 — Coverage including the captain: the process-level tick

- **A process-level tick already exists as a precedent, in the adopted plugin:**
  `$L/index.js:537-547` — `const surfacePoll = setInterval(() => { … }, 2000)` with
  `ctx.effect(() => clearInterval(surfacePoll))` (bounded polling for service binding; comment `:533-536`).
- **The composition-root registration pattern is already a REGION and does exactly what the watchdog
  needs:** `mpd-delta interjection-expiry-registration` (`$L/mpd-deltas.js:539-546`) installs a
  bookkeeping sweep UNCONDITIONALLY from the composition root ("not a feature of auto-routing"), and its
  tick body is the region `mpd-delta interjection-expiry-tick` (`:447-454`). A watchdog tick in the same
  place would be the same ADDITIVE shape — **but it does not have to go there at all**: a new bundle
  plugin row can call `ctx.setInterval` itself (the harness loads `@deepseek-ai/cordis-plugin-timer` when
  `ctx.get('timer')` is undefined — `@deepseek-ai/dsh/lib/profile-boot-Dk-7KqJc.js:323`), so the tick can
  live entirely in new code.
- **Why the tick is the only thing that can cover the captain:** every other hook is an event *emitted by
  the agent that is working*; a wedged captain emits nothing, so the enforcer must run on a clock owned by
  the process, not by a turn. It reads the heartbeats from disk (written by the same plugin), evaluates
  D2's thresholds, and on ESCALATE writes the scene, pauses the team (D3) and notifies (D4).
- **Open authority question (unchanged from the groundwork dossier, still unresolved):** performing the
  pause needs the captain-authority halt path (`agent_teams_halt` is a captain tool; `haltTeamWork`
  takes `input.captain`). Options: execute the tool through the adapter's internal tool seam
  (`dsh.executeTool`, adapter `:279/:564`), or operate on the same primitives directly. The plan must
  settle it; the tick cannot assume it holds captain authority.

---

## The wedge fixture, re-anchored to the new hooks

Measured incident (recorded verbatim in `.mpd/team/mpd-default/team.json`, task `t36` `reassignReason`):
the Reviewer wrote substantive evidence at 16:28 and 16:32, then produced nothing for ~20 minutes while
the runtime reported `running`, with no stray child process alive; the captain interrupted it at 16:52:49.

| Hook (this dossier) | Would it have fired during 16:32:37 → 16:52? | What it would have produced |
|---|---|---|
| `agent/pre-step` heartbeat (D1) | yes, until the wedge; then it STOPS updating | lastSeen = 16:32:37 → at 16:34:07 the age crosses 90 s |
| `tools/post-execute` heartbeat (D1) | same, per tool call | same lastSeen, on a tool-call granularity |
| process-level tick (D5) | yes — independent of any agent turn | WARN + heartbeat snapshot at ~16:34; the 2nd and 3rd consecutive WARNs for `t36` → ESCALATE at ~16:37 (≈15 min earlier than the human's discovery) |
| provider `idleWatchdog` | **NO** — armed only while a stream is outstanding (`$H/dsh-timeout/lib/types/index.d.ts:80-89`; `$H/dsh-llm-deepseek/lib/index.js:1627`, 5-min default `:1390`) | nothing, which is why the incident ran 20 minutes |
| scheduler idle edge (`agent/status`) | **NO** — the runtime kept reporting `running`, and `agent/status` fires only on a transition (`$H/dsh-agent-loop/lib/index.js:781`) | nothing |

Signals that existed then: artifact mtimes (last write 16:32:37), durable attempt identity +
`reassignReason`, the live "running" projection, the member session log, mailbox `ts` records. Signals
missing: heartbeat, watchdog, notification, durable stuck state, stray child. **Every hook this dossier
names is on the "missing" side, and each one is additive to what already exists.**

---

## What this changes relative to the groundwork dossier

1. The option space is now a **decision set**: heartbeat = per-step + per-tool-call via the adapter's
   existing hooks (zero adopted-code edits); knobs = the bridged `mpd` namespace (three files in our
   packages); pause = team-only; notice = the four named surfaces + unread replay; enforcement = a
   process-level tick.
2. **NEW BLOCKER (D3):** the existing halt CANCELS non-terminal tasks and the existing resume does not
   recreate them — the user's "scene preserved, resumable by one `agent_teams_resume`" cannot be built on
   `agent_teams_halt` as-is. The plan must choose a preserving pause (option a) or accept a
   replacement-shaped halt change (option b) plus a claim/update gate (option c).
3. **Knob placement has a measured wrinkle:** the namespace/schema/knob metadata is single-source
   (`settings-schema.ts`), the TUI derives from `SETTINGS_KNOBS`, but the **Web card keeps its own
   `FIELDS` list** (`settings-card.js:46`) — the "same path" is single-namespace, not single-list.
4. `applies: "restart"` on the namespace means knob changes need an explicit `settings/document-updated`
   re-read in the tick if live tuning is wanted.

## The three hard problems (to carry into the frozen plan)

1. **Enforcement under a wedged captain** — the tick must run on a process clock and reach the pause path
   without captain authority; the authority question is unresolved.
2. **A preserving pause** — today's halt destroys the work it should protect, and today's resume cannot
   restore it; either a new preserving state or a replacement-shaped halt change (+ `--write-registry`)
   plus tool-boundary gates, and a resume that re-arms parked attempts.
3. **Durable unread replay** — nothing records "the user saw this notice"; the mailbox-unread pattern is
   the precedent to extend, in both front doors, or "replay" degenerates into permanent re-display.

## NOT CLAIMED

- No code was written and no wedge reproduced; everything above is a read at the pins.
- The adapter's post-execute hook was not exercised at runtime; its contract is read from
  `packages/mpd-dsh-adapter-plugin/src/index.ts:273-279/:529-564` and `AGENTS.md` §6.
- The knob names and defaults in D2 are a PROPOSAL for the plan to freeze, not an implemented schema.
- The pause-authority question and the preserving-pause choice are left to the plan; both are named with
  their evidence.
