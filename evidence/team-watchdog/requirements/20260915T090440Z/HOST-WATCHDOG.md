# t43 — Watchdog groundwork: where a hard-code heartbeat, scene snapshot and stuck notice can live, and what the Reviewer wedge proves

Task `t43` (requirements), member **Researcher** (read-only role; the ONLY writes are files in this
directory, which the task `inScope` grants explicitly). Attempt id `23b39395-6003-4e72-ab75-0f0f262386a9`.

Pins: this repo at `/root/dshProj/my-power-dsh`; installed harness
`/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` (`$H/`,
`@deepseek-ai/dsh` 0.1.5-rc.1 CLI, packages 0.1.5-rc.2); TUI host
`/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-harness-tui/dsh-tui/` (`$T/`, 0.10.1);
adopted plugin `packages/mpd-agent-teams-plugin/lib/` (`$L/`).

---

## (a) The member turn lifecycle — where it starts, steps, ends, and what is reachable

### The plugin's own pipeline

| Moment | Where | Note |
|---|---|---|
| Row apply (one per process) | `$L/index.js:140` `export function apply(ctx, config)` | installs tools `:175`, capabilities `:180`, session policy `:190`, interjection sweep `:201`, web routes `:248-523`, `internal/service` listener `:526` |
| Member spawn (continuable child of the captain) | `$L/members.js:554` `spawnMember(…)` | welcome turn built at `:577`; provider must declare `mode === 'continuable'` (`:333`, `:446`) |
| Prompt / next-turn delivery | `$L/members.js:615` `deliverToMember` → `queueMemberPrompt(ctx.subagents, captain, brandedSessionId(childId), [{type:'text',text}], signal)` (`:616-621`) | the version-dispatching seam lives in `$L/harness-compat.js` (module doc `:1-20`; public `ctx.subagents.prompt(request, signal)` on 0.1.5-rc.2+) |
| Member status / idle edge | `$L/scheduler.js:715` `ctx.on('agent/status', ({ agent, status }) => …)` | `syncMemberStatus` writes the member status into `team.json` (`:706-709`) and on an idle edge calls `runtime.kickMember(…)` (`:712-713`) |
| Turn cancellation | `$L/members.js:643-655` `interruptMember` → `ctx.subagents.interrupt(brandedSessionId(childId), { kind:'ancestor', agent: captain })` | best-effort, fire-and-return; called from halt/remove/kick at `$L/tools.js:201, 450, 971, 1044` |
| Team halt / resume | `$L/tools.js:225` `haltTeamWork`, `:188-215` drains member activations; `:2216` `agent_teams_resume` (non-empty `reason` required) | halt sets `team.halted/haltedAt` (`:249-252`) |
| Staleness concept that ALREADY exists | region `mpd-delta stale-staged-reclaim` (`$L/mpd-deltas.js`), `DEFAULT_RECLAIM_STALE_AFTER_MS = 3600000` | only for EMPTY STAGED teams older than 1 h — never for a live wedged member |

### The harness moments those hooks observe (`$H/dsh-agent-loop/lib/index.js`)

| Harness event | Emit site | Meaning / cadence |
|---|---|---|
| `agent/session-start` | `:1720` `emitAgentEvent(loopCtx, agent, "agent/session-start", { source })` | once per session start / cold resume |
| `agent/pre-step` | `:894` waterfall | **once per model step** (the step boundary) |
| `agent/assistant-stream` | `:1032` emit | **once per streamed frame** — the finest-grained progress signal the host exposes |
| `agent/turn-stopping` | `:967` serial | **turn end** |
| `agent/status` | `:781` `dispatch.emit("agent/status", { status })` when the status CHANGES | idle/running edge, not progress |

All of these ride the per-agent dispatcher `agentEvents(ctx, agent)` (`$H/dsh-agent/lib/index.js:209-219`;
`emitAgentEvent` `:248-250`), i.e. ordinary Cordis events on the agent's carrier. The adopted plugin
already listens process-wide: `$L/scheduler.js:715` (`agent/status`), `$L/session-start.js:491, 580` and
the region `mpd-delta interjection-expiry-session-start` (`agent/pre-step`, `{global:true, prepend:true}`),
`$L/capabilities.js:110` (`agent/session-start`), `$L/command.js:254` (`agent/pre-step`). A **new sibling
plugin row can listen to the same events the same way** — nothing about these seams is private.

**Reachable from a hook we add: all five moments.** The genuinely new information a watchdog needs is
*progress* (`agent/pre-step` / `agent/assistant-stream`), *turn boundaries* (`agent/turn-stopping`), and
*idle edges* (`agent/status`) — none of which is persisted today.

---

## (b) The delta constraint — region, new module, or neither

`$L/**` is adopted upstream main code adapted through delta REGIONS: registry `$L/mpd-deltas.js`
(**48** region entries, each keyed by a `beforeContext`/`afterContext` pair measured on the
region-stripped skeleton), applier `scripts/patch-agent-teams-fixes.mjs` with three modes
(`--check` default, `--write`, `--write-registry`; header `:13-18`), invoked by
`scripts/vendor-agent-teams.mjs` with `--write` (D10: a vendor run exits 1 on refusal).

Applier refusal shapes that bound every option (file:line):

| Line | Refusal |
|---|---|
| `:80` | half-open marker pair (end precedes begin) — "refusing to guess the intended span" |
| `:177` | region MISSING and its registered `afterContext` occurs ≠ 1 time outside every region — "the applier never guesses an insertion site" |
| `:191` | region MISSING and the lines before the window do not match the registered `beforeContext` — same refusal |
| `:306-307` | F3 guard: refuses to re-insert a region while the file still declares OUTSIDE any region the symbol the region re-defines |
| `:327` | post-heal validation: the region must appear exactly once |
| `:350`, `:357-360` | refuses to report success when the pair is not complete; an edited body without `--write-registry` is named explicitly |
| `:374` | orphan `begin` whose surviving lines are not the registered block → "restore the marked region, or fix it and run --write-registry" |
| `:393` | OLD anchor-format registry → run `--write-registry` |
| `:431` | verify-only mode: a dropped region fails and tells the operator to run `--write` |

For each candidate hook:

1. **Per-step heartbeat carried by the adopted plugin itself** → **(i) region**.
   A listener on `agent/pre-step` / `agent/assistant-stream` added inside `$L/index.js` (or
   `$L/scheduler.js`) is a change to an adopted file and MUST be a region. Consequence: a new region needs
   `--write-registry` once (the registry is regenerated from the marked regions); if the region is
   **purely ADDITIVE** (a new listener/import, re-defining nothing upstream), a hand re-materialise of
   upstream is self-healed by `--write` — the heal keys on the context pair and is exact under any
   insertion history (`AGENTS.md` §6, D8/D9). If instead it **replaces** an upstream declaration (the shape
   of D13/D14/`pool-capability-select`), the heal REFUSES loudly with the file byte-untouched and the
   remedy is to restore the region or re-author + `--write-registry` — a maintenance cost, not a silent
   loss.
2. **Watchdog logic, scene-snapshot writer, notice publisher, tunables, tests** → **(ii) NEW local module**.
   A brand-new file (e.g. `lib/mpd-team-watchdog.js` or a new package) is not adopted code at all: the
   delta registry never looks at it, `--check` cannot fail because of it, and a re-materialise of the
   adopted tree cannot touch it. The only coupling is the ONE install call, which must still live in an
   adopted file → a small ADDITIVE region (see 1). Keeping the *body* out of the region keeps the region
   small, which is exactly what makes the heal robust (the registry stores the whole region block).
3. **A separate bundle plugin row** (its own `packages/<name>/` mounted by
   `packages/mpd-bundle/cordis.patch.yml`) → **(ii), the strongest form**: ZERO adopted-code edits, so no
   region, no registry entry, nothing a re-materialise can drop. It reaches the turn lifecycle by listening
   to the same global agent events (a), reads team state from disk (d), and publishes through its own
   seams (e). It must still obey the repo rules: harness seams only through `mpd-dsh-adapter` (`AGENTS.md`
   §6) and workspace-scoped state resolution per call (`dsh.workspaceRoot(exec)`).
4. **Editing upstream-shaped code without a region** → **(iii) NEITHER**. `--check` fails at the next gate
   (`:431`), a vendor run exits 1 (`vendor-agent-teams.mjs`, D10), and a human re-vendor silently deletes
   the change. This is the one shape that is never acceptable.

---

## (c) What already exists — reuse instead of duplicating

**Harness timeout/watchdog primitives [MEASURED, and the key gap].**
`@deepseek-ai/dsh-timeout` already ships `deadline()`, `timeoutOf()` and a rearmable **`idleWatchdog`**
(`$H/dsh-timeout/lib/types/index.d.ts:80-89`; `IdleWatchdog` interface `:44-66` with `next()`, `pulse()`,
dispose). Its documented semantics: *"The timer exists only while `next()` is outstanding, so consumer
think time does not count as provider idle time."* Its ONLY users are the two LLM providers:
`$H/dsh-llm-deepseek/lib/index.js:1627` arms it with `connection.streamIdleTimeoutMs`, whose default is
`DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5` (5 minutes, `:1390`), code `LLM_STREAM_IDLE_TIMEOUT` (`:1411`),
raising `LlmError('DeepSeek stream idle timeout after …ms', 'TIMEOUT')` at `:1642` (config default
`:1897`).
⇒ A watchdog for **provider-stream silence** exists — and is exactly the wrong instrument for the wedge
we measured: it is armed only while a stream is outstanding, and the incident had no outstanding stream
(see (f)). There is NO timeout, watchdog or liveness check for a **member turn** anywhere.

**Plugin-side machinery to reuse (not duplicate).**

| Concern | Existing mechanism | Cite |
|---|---|---|
| Member liveness projection | `memberActivity()` maps live Agent status → `'cold' \| 'idle' \| 'busy'` | `$L/scheduler.js:184-190` |
| Idle edge → dispatch | `kickMember` on the idle edge; the scheduler is event-driven, never a polling turn | `$L/scheduler.js:712-713`, module doc `:2-12` |
| Open-attempt parking | `parkedAttempts` (in-process `Map`): an idle member's open attempt is parked and its exact capability re-dispatched | `$L/scheduler.js:397, 515-548, 624-630, 649-705` |
| Interrupt a live turn | `interruptMember` → `ctx.subagents.interrupt(…)` | `$L/members.js:643-655`; callers `$L/tools.js:201, 450, 971, 1044` |
| Pause everything (halt) | `haltTeamWork` + `stopTeamMemberActivations` (interrupts every resident member) | `$L/tools.js:188-215, 225-277` |
| Resume a halted team | `agent_teams_resume` (requires a reason; does not recreate cancelled tasks) | `$L/tools.js:2216-2235`; `resumeTeamState` `$L/quality-gates.js:839` |
| Revoke a stale capability | `activateTaskAttempt` mints a new `attemptId`; `invalidateTaskAttempt`/`cancelUnfinishedTask` clear it | `$L/state.js:167-195` |
| Retired-member deny list | `retired-members.json` + `installRetiredMemberGuard` | `$L/state.js:29`; `$L/members.js:665-680` |
| Delivery lease | `MAILBOX_DELIVERY_LEASE_MS = 60_000`, `deliveryClaimedAt` | `$L/state.js:26-27`; `$L/members.js:278` |
| Stale-state reclaim (narrow) | `findStaleStagedTeams`, 1 h default — empty staged teams ONLY | region `mpd-delta stale-staged-reclaim` |

**Where NOTHING exists today [MEASURED by grep]:** no `heartbeat`, `watchdog`, `stuck`, `liveness` or
`lastSeen` symbol anywhere in `$L/**` (excluding `mpd-deltas.js` region bodies) or in
`packages/mpd-tui-plugin/src/**`; no per-turn timer; no durable progress record; no notification on
silence. `ps` at dossier time shows no `dsh`/`node` child that could explain a wait — consistent with the
incident note ("no stray child process alive").

---

## (d) The state on disk — what a "save the scene" snapshot can capture

Owned by the adopted plugin's `state.js` (doc `:1-10`), under `<workspace>/<stateDir>/<teamId>/` with
`stateDir` = `.mpd/team`:

| Artifact | Path | Owner / writer | Content a snapshot needs |
|---|---|---|---|
| Team record | `<ws>/.mpd/team/<teamId>/team.json` | `state.js` reader `:271-299`, writer `:319-320`, atomic `:264` | `id/name/phase/createdAt/approvedAt/halted/haltedAt`, `members[]` (`id,name,role,provider,model,reasoningEffort,status,joinedAt`), `tasks[]` (`id,status,assignee,dependencies,attempt,attemptId,createdAt,updatedAt,kind,objective,acceptance,reassigning,reassignReason`), `taskSeq` — shape re-measured from the live team |
| Mailboxes | `<ws>/.mpd/team/<teamId>/inbox/<agentKey>.jsonl` | `appendMailbox` `state.js:448-454`; record `{id,from,to,content,ts}` from `createMessage` `:438-439` | per-member **watermark** (last `ts`) + unread count (`readUnreadMailbox`) |
| Retired deny list | `<ws>/.mpd/team/retired-members.json` | `state.js:29`, `$L/members.js` guard | must be preserved so a resume cannot wake a retired member |
| Member session log | `<DSH_HOME>/sessions/<projectKey>/<childSessionId>/session.v3.jsonl.zstd` | harness session store | the member's durable conversation; its mtime is the only on-disk "last activity" that survives a wedge |
| Team session events | via `appendTeamEvent(ctx, session, type, data)` | `$L/events.js:26-40` | **informational only** — omitted unless the harness's `KNOWN_SESSION_EVENT_TYPES` knows the type (`:33-38`) |
| Per-task timers | `mpd_boulder_task_timer` → `.mpd/boulder.json` | `mpd-boulder-plugin` | available as a *mechanism*, but `.mpd/boulder.json` does not exist in this workspace ⇒ not a usable heartbeat source today |

**Resume vs. start fresh — the durable rule [MEASURED].** `activateTaskAttempt` (`state.js:167-176`) mints
a NEW `attemptId` (a fresh UUID) and sets `status='claimed'`, `assignee`, clears `handoffId/output` and
bumps `updatedAt`; `beginTaskAttempt` (`:178-181`) increments `attempt` first; revocation clears
`attemptId`. Therefore: **same `attemptId` + same `attempt` number ⇒ "resume this attempt"; a different
`attemptId` (or an incremented `attempt`) ⇒ "a fresh attempt"**, and only the CURRENT `attemptId` is
accepted by `agent_teams_update_task` (an old one is a stale-attempt rejection). The captain's own wedge
handling took the fresh path: `t36` stands at `attempt: 2` with `attemptId 42e63c6f-f4ab-…` and a
`reassignReason` carrying the incident text (see (f)).

**What a snapshot must ADD to be sufficient.** Two things are NOT durable today:
(i) per-step progress (no heartbeat anywhere), and (ii) the scheduler's `parkedAttempts` map
(`scheduler.js:397`) — it lives in process memory only. A "save the scene" snapshot must persist, per
open task: the `attemptId`, the owning member, the last observed heartbeat timestamp, the mailbox
watermarks, the parked attempt id (if any), and the halt reason — otherwise a later resume cannot tell
"the same attempt is still valid" from "this attempt must be revoked and re-issued".

---

## (e) Publication surfaces for a stuck notice

**Web.**
1. The plugin's own authenticated data route **`/plugins/dsh-agent-teams/state`** (`$L/index.js:253-273`),
   registered through `authenticatedWebRoutes` (`$L/web-routes.js:73-100`; the host's browser fence, 401/403/503
   fail-closed). Payload `{teams:[…]}` from `collectTeamsActivity` (`$L/snapshot.js:131`), which already
   carries per-member `status` and `activity: working|idle|unknown` (`$L/snapshot.js:40-80`) — the very
   fields that read "running" during the wedge.
2. Sibling routes on the same server: `/plugins/dsh-agent-teams/halt` (`$L/index.js:276-329`),
   `/plan` (`:332-475`), `/assets` (`:492-523`).
3. The bundle client's team page — `packages/mpd-bundle-plugin/src/team-page.js` (polling controller
   `:101-165`, `subscribeActivitySnapshots`) renders the AgentTeams tab; a stuck banner/notice would be
   added there (client rebuild via `scripts/build-mpd-client.mjs`).
4. Host activity surfaces: the AgentTeams tab in the DSH-better-sidebar (`ctx.betterSidebar.registerTab`)
   and the harness's own subagent rows (`$H/dsh-client-ui-subagent`).

**TUI.**
1. **Toasts (the only "notice" seam):** `ctx.tuiToast.show(text, options?)` — service id **`tuiToast`**
   (`$T/lib/types/dsh-adapter/toast.d.ts:1-80`): fire-and-forget, text sanitized and capped at 200 cells,
   colors `success|warning|error`, `timeoutMs` clamped to [500, 12000] (no sticky toasts by design),
   20 toasts/minute per activation, delivered to the host sink bridged onto `channel.notify`
   (`TuiToastStore` doc `:34-52`; `show` doc `:62-76`). **Not probed by any of our packages today**
   (grep for `tuiToast` in `packages/*/src` = none).
2. **Persistent status line:** `ctx.tuiStatus.set(key, text, scoped)` — already used by our plugin
   (`packages/mpd-tui-plugin/src/status.ts:49-75`, with a published-text guard to avoid ledger churn),
   so a stuck state can hold a visible line while it lasts.
3. Also available: `tuiScenes` (full-screen board, `packages/mpd-tui-plugin/src/scenes.ts:155`),
   `tuiDialogs` (`dialogs.ts:39`), `tuiCommandTrees`, `tuiSettingsSections`.

**A user who was NOT watching — the honest answer.** A toast is transient by design: with no sink the
delivery is DROPPED (`toast.d.ts:34-52`), and there is no persistence or replay. `appendTeamEvent` is not a
fallback either, because it omits event types the harness does not know (`$L/events.js:26-40`). So the
"afterwards" requirement forces a **durable** record: either a field/record in `team.json` (read back by
the Web route and by the TUI status/section on the next render) or a dedicated state file next to it —
plus the status line for the TUI while the condition holds. A toast alone cannot satisfy "the user learns
about it afterwards".

---

## (f) The measured incident — the acceptance fixture

**Recorded verbatim on disk** (`team.json`, task `t36`, `reassignReason`):

> "The Reviewer's turn wedged: it wrote substantive evidence at 16:28 and 16:32 (two independent lane runs
> of the bridge) and then produced nothing for ~20 minutes while the runtime still showed it running, with
> no stray child process alive to explain the wait. The captain interrupted that turn; this reassignment
> revokes the stale attempt and wakes the same member with a fresh one so the review can be finished
> explicitly rather than silently stalled. Its on-disk evidence (lane-run-1, lane-run-2, the degradation
> probe) must be treated as its own partial findings, not discarded."

**Timeline (all local +0800; evidence mtimes measured, message timestamps from the mailbox JSONL):**

| Time | Event | Kind of signal |
|---|---|---|
| 16:28:25.277 | `evidence/mpd-bridge/review/lane-run-1/raw/boot-main.log` last write | progress evidence (mtime) |
| 16:28:46.566 | `lane-run-1/{output.log,result.json}` written | progress evidence |
| 16:31:45.766 | `lane-run-2.hashes-before.txt` | progress evidence |
| 16:32:12.699 | `lane-run-2/raw/boot-main.log` | progress evidence |
| 16:32:36.351-392 | `raw/degradation-probe.mjs` + `raw/degradation/*` | progress evidence |
| 16:32:36.991-37.003 | `lane-run-2/{boot-disabled.log,output.log,result.json}`, `lane-run-2.hashes-after.txt` | **last write: 16:32:37.003** |
| 16:32 → ~16:52 | **nothing written anywhere by the member** (~20 min) | **the silence** |
| 16:51:16 | captain → Reviewer addendum delivered (`ts 1789462276617`) | mailbox record |
| 16:52:34 | `t36.updatedAt` = the reassignment (attempt 2, fresh `attemptId 42e63c6f-…`) | team.json |
| 16:52:49 | captain → Reviewer: "your previous t36 turn wedged and I interrupted it" (`ts 1789462369607`) | mailbox record |
| 17:00:50 | member session log `…/33a90346-…/session.v3.jsonl.zstd` mtime (post-resume turn) | session store |

Member identity is durable and exact: the Reviewer's member record has `id 33a90346-ab14-44f1-b88f-2096c1c6cff7`,
and `$DSH_HOME/sessions/--root-dshProj-my-power-dsh--/33a90346-…/` is that member's session directory —
i.e. the wedge is attributable to a session id from the mailbox/team state alone.

**Signals that EXISTED** (so detection needed no new host surface):
1. **Artifact mtimes / last-write timestamps** — the only evidence of progress, and the exact thing a
   heartbeat is a first-class version of.
2. **Durable attempt identity** — `t36` `attempt/attemptId/updatedAt`, plus `reassignReason` (the record
   that survived the interruption).
3. **A live "running" projection** — `memberActivity`/`assembleTeamSnapshot` reported the member as
   working (`scheduler.js:184-190`, `snapshot.js:40-80`), i.e. the runtime kept saying "running" while
   nothing advanced.
4. **The member's session log** — exists and is addressable by member id (`33a90346-…`), with an mtime
   that simply stopped advancing; nobody polled it.
5. **Mailbox records with `ts`** — the delivery/interrupt trail (`reviewer.jsonl`).

**Signals that did NOT exist:**
1. **No heartbeat** — nothing recorded a per-step or per-frame progress mark; the silence could not be
   observed except by eyeballing file mtimes.
2. **No watchdog** — no timer was armed for a member turn; the only idle watchdog in the stack is
   provider-stream-scoped (`$H/dsh-llm-deepseek/lib/index.js:1627`, 5-minute default) and therefore never
   armed during the wedge.
3. **No notification** — no toast, no status-line change, no route record, no log line: when silence began,
   nothing was written; the user noticed, not the system.
4. **No durable stuck state** — `team.json` has no such field, and `appendTeamEvent` would have been
   dropped (`events.js:33-38`).
5. **No stray child process** — `ps` now shows no `dsh`/`node` helper, matching the incident note, so
   process-level liveness checks would have found nothing to kill either.

**Therefore the design could have caught it:** a heartbeat refreshed on `agent/pre-step` and
`agent/assistant-stream` (a) would have aged past any sane threshold long before 20 minutes; a watchdog
armed at turn start (`agent/status` running transition) and rearmed on each heartbeat would then have
(1) written the scene snapshot (team.json + mailbox watermarks + open `attemptId` + parked attempt),
(2) paused dispatch through the existing halt path, and (3) published a notice (TUI toast + the durable
record the Web panel and the next TUI render read). Detection latency becomes the threshold T instead of
"the user noticed" — and the measured fixture lets a later task calibrate T (the strongest available
evidence: the wedge was ≥ 19 minutes of silence after the last artifact write).

---

## RECOMMENDATION — minimal design, and who owns each piece

1. **Owner: a NEW bundle plugin row** (its own `packages/mpd-team-<name>/`, mounted by
   `packages/mpd-bundle/cordis.patch.yml`) — shape **(ii)/(b) option 3**: zero adopted-code edits, so the
   delta applier, `--check` and a re-materialise cannot touch it, and `AGENTS.md` §6 is satisfied by
   reaching harness seams through `mpd-dsh-adapter`. If the heartbeat must instead live inside the member
   turn pipeline, the ONLY acceptable form is an **ADDITIVE region** in an adopted file whose body stays a
   one-line install call into a new local module (shape (ii)/(b) option 1), with a single
   `--write-registry` follow-up; a replacement-shaped region is the D13/D14-class maintenance cost and must
   be avoided for a *new* capability.
2. **Heartbeat writer.** Listen to the already-emitted global agent events — `agent/pre-step` (per step) and
   `agent/assistant-stream` (per frame) → refresh `lastSeen` for that member; `agent/status` (running edge)
   → arm; `agent/turn-stopping` → disarm. Record the expiry onto disk so the signal survives a restart.
3. **Watchdog + threshold.** Reuse the harness's arithmetic and classification (`$H/dsh-timeout`
   `Deadline`/`timeoutOf` semantics, code-named reason) rather than inventing a timer protocol; do NOT try
   to reuse `idleWatchdog` itself — its contract is "one outstanding async-iterator demand", which is
   precisely the case the wedge is not.
4. **Save the scene.** One JSON snapshot per team next to `team.json` (owner: the new plugin; the adopted
   plugin's `state.js` keeps owning `team.json` itself): team phase/halted, per-task
   `{id, status, assignee, attempt, attemptId, lastSeen}`, per-member mailbox watermarks, the parked
   attempt ids, and the halt/stuck reason. Resume rule from the same data: same `attemptId` ⇒ resume the
   attempt; otherwise revoke + re-issue (the existing `activateTaskAttempt`/`invalidateTaskAttempt`
   semantics).
5. **Pause all tasks.** Call the EXISTING halt path rather than a second pause mechanism
   (`$L/tools.js:188-215, 225-277` sets `halted/haltedAt` and drains member activations with
   `interruptMember`). Two honest options to reach it from a new row: execute the `agent_teams_halt` tool
   through the adapter's internal tool seam, or operate directly on the same primitives (team.json halt
   fields + `ctx.subagents.interrupt`) with the watchdog as the authority — the first is preferable because
   it keeps ONE halt implementation and the existing `resume` contract.
6. **Notify.** TUI: `ctx.tuiToast.show(text, { color:'warning' })` while the incident is fresh PLUS the
   durable record so a user who was not watching still learns (the toast alone cannot satisfy that —
   §e). Web: surface the stuck state in the existing `/plugins/dsh-agent-teams/state` payload (or a sibling
   route) and render it in `packages/mpd-bundle-plugin/src/team-page.js`; keep the TUI status line
   (`packages/mpd-tui-plugin/src/status.ts:49`) holding the condition while it lasts.
7. **Keep the adopted tree honest.** Whatever wiring lands inside `$L/**` must be a registered region with
   `--write-registry` re-run, `--check` clean, and the `self-fix-tests/` suite extended the way D11/D21/D22
   did — otherwise the next vendor run drops the watchdog silently.

## NOT CLAIMED

- No code was written; every claim is a read of the installed host / this repo at the pins above.
- The harness events' payload shapes beyond the emit sites quoted were not exercised at runtime; no wedge
  was reproduced (the fixture is the recorded incident + measured mtimes).
- The exact threshold T is NOT proposed here (the fixture bounds it: the proven silence was ≥ 19 minutes;
  a later task must pick T and prove the false-positive budget).
- Whether a new plugin row can reach the halt path with captain authority without impersonating the
  captain is NOT settled here; both options and their trade-off are named, and the decision belongs to the
  implementation task.
