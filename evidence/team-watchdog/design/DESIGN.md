<!--
PROVENANCE — added by task t56 (Lead). The text following this comment is a VERBATIM transcription.
source task   : t52 (team mpd-default)
author        : Architect (read-only role: the deliverable existed only in its task completion output)
repo revision : ebd1fa7d5015bea5a907c5f4292d369a2dc613fc  (git rev-parse HEAD, read-only)
transcribed by: t56 (Lead) on 20260915T154132Z — verbatim transcription by this task: no rewriting, summarising,
                reordering, formatting or typo fixes. Any apparent error is left exactly as the author
                wrote it and is reported in t56's completion output instead of being edited here.
-->
# t52 — Watchdog design freeze (w1). Per-step/tool heartbeat, WARN→ESCALATE machine, restorable scene, preserving hold, dual-door notice

Read-only role honoured: **no file written, no write tool called.** This text is the deliverable; a writer task persists it verbatim to `evidence/team-watchdog/design/DESIGN.md`. Every code site below was re-read on this tree before being cited (`scheduler.js`, `tools.js`, `state.js`, `snapshot.js`, `capabilities.js`, the adapter surface, the three OUR settings files); the dossier's measurements are cited, never re-derived.

Labels: **[M]** measured by me on this tree or by the dossier (cited) · **[D]** design decision · **[GAP]** something the plan does not settle, with my proposed answer · **[NOT-CLAIMED]** honestly unavailable.

---

## 0. Shape, and the one decision that conditions everything

**A new plugin row, `packages/mpd-team-watchdog-plugin/`, with ZERO adopted-code edits.** The heartbeat writer, the tick, the state machine, the scene store, the hold, the resume and the notification fan-out all live in OUR package. The ONLY adopted-code touch is §6's ADDITIVE decline gate; the tool-boundary guards are ADDITIVE and (see §6) can be avoided entirely for v1.

**The condition that conditions everything [GAP-1].** A task's silence is only diagnostic **while a turn is expected to be in flight**. A task `claimed` by a member who is legitimately idle (waiting, or between turns) is silent by design, and three consecutive WARNs against it would escalate a healthy team. Therefore:

- The silence candidate set is **not** "every non-terminal task"; it is **every task whose owner has an attempt expected in flight**, which the tick derives from the member's live turn state, not from wall-clock alone.
- Concretely: a task is a candidate when its `assignee` designates a member whose current attempt id equals the task's `attemptId` **and** whose heartbeat shows at least one stamp for that task in this generation (i.e. the turn actually started). A claimed task that has never produced a stamp is reported `never-started` after `warnSilenceMs` — a distinct, non-escalating observation with its own notice text, because "the member never picked it up" is a dispatch problem, not a wedge.
- Without this precondition the machine's arithmetic (three consecutive WARNs) escalates healthy idle teams. I am recording it as a **GAP in the plan** and providing the fix here rather than silently deviating: AC-3/AC-4's fixtures must therefore drive a task that HAS stamped at least once.

---

## 1. Heartbeat

### 1.1 Who writes it

| Writer | What it stamps | Where the code lives |
|---|---|---|
| **The new plugin's step listener** | one stamp per `agent/pre-step` for the agent that is stepping, attributed to that agent's member-or-captain identity **and to the task that member currently owns** | our `packages/mpd-team-watchdog-plugin/src/heartbeat.js`, subscribed in `apply()` |
| **The new plugin's adapter POST hook** | one stamp per completed tool call, `kind:'tool'` | our plugin calling `dsh.onPostToolExecute(...)` |
| **The new plugin's turn listeners** | `turn-start` on `agent/session-start` / first `agent/pre-step`, and `turn-end` on `agent/turn-stopping` | same module |
| **The captain** | exactly the same three writers — the captain is an agent like any member, so its own turn produces `step`/`tool`/`turn-end` stamps under its captain identity | no special path |

**[M] Reachability.** `agent/pre-step` is an ordinary Cordis waterfall the harness dispatches on the per-agent dispatcher (`$H/dsh-agent-loop/lib/index.js:894`); `agent/session-start` is at `:1720`, `agent/turn-stopping` at `:967`, `agent/status` at `:781`. The adopted plugin already listens to `agent/session-start` on a plain row context (`capabilities.js:110`), so a NEW row can subscribe to the same family without any adopted edit — this is the dossier's `D§a` + the `W-2` resolution, which I re-checked by reading the same site.

**[M] Tool stamps are POST.** The adapter exposes `onPostToolExecute` (`packages/mpd-dsh-adapter-plugin/src/index.ts:274`, impl `:535`) and `executeTool`/`toolRuntime().execute` (`:279`, impl `:564`), plus the read-only `guardTool` (`:273`, impl `:529`). `guardTool`'s contract is "read only, never mutate" (AGENTS.md §6), so a heartbeat MUST NOT be written there. A pre-dispatch stamp therefore needs the declared adapter extension to `tools/execute` (§5-H1b / W-9) and is **NOT-CLAIMED for v1**; AC-2 asserts the POST stamp only.

### 1.2 Exactly when

| Moment | Trigger | Stamp |
|---|---|---|
| per **model step** | `agent/pre-step` fires (per STEP, not per frame) | `{kind:'step', at, member, taskId, attemptId, turnId}` |
| per **tool call** | the adapter's POST waterfall fires for a completed call | `{kind:'tool', at, tool, callId?, ok, member, taskId, attemptId}` |
| turn **start** | first `agent/pre-step` of a generation (or `agent/session-start`) | `{kind:'turn-start', …}` |
| turn **end** | `agent/turn-stopping` | `{kind:'turn-end', …}` |

**[M] Honest bound on the step stamp.** `agent/pre-step` is dispatched by the loop *before* the model call for that step, so a `step` stamp means "a step began", not "the model answered". A stream that stalls mid-step therefore still shows a recent `step` stamp — the exact wedge this wave exists for. **The design does not pretend otherwise:** staleness is computed from the **newest stamp of ANY kind**, and the incident's symptom (a member silent for ~20 minutes) is caught because no further `pre-step` fires either once the turn is wedged before its next step. The residual blind spot — a step that begins and its model call then hangs forever — is stated in AC-15's terms as a known false-negative window of one step, and it is why the `assistant-stream` frame event is listed as an optional refinement in §9 rather than claimed.

### 1.3 Where it is stored, and who owns it

**[D] A per-member append-only heartbeat file beside the team state, NOT inside `team.json`.** `packages/mpd-agent-teams-plugin/lib/state.js` keeps **sole ownership of `team.json`** (`D§d`, and the plan's §5-H2b requires the same separation for the hold); writing heartbeats into it would create a second writer on an adopted file's byte surface and a write loop under a per-step cadence.

- Path: `<stateRoot>/watchdog/heartbeat/<member>.jsonl` where `<stateRoot>` is the adopted plugin's resolved team state root (`config.stateDir`, default `.mpd/team`).
- Owner: **the member's own writer** (one file per member, so writers never contend). The captain writes `<member>.jsonl` under its captain identity via the same code.
- Shape: one JSON object per line, §1.2's fields, appended with `appendFileSync` under the plugin's own tiny queue; the reader takes the LAST line with a matching `taskId`/`attemptId`.
- **Rotation:** the file is truncated at `turn-end` for that generation after the reader has consumed it (keep the last N=3 generations); unbounded growth is prevented by `ctx.effect` cleanup plus the per-turn truncation. Growth is therefore bounded by generation count × steps, and the AC-15 write-count assertion covers it.

**[M] The reader.** The tick lives in the same plugin and the same process, so it reads what it wrote; a FRESH process reads the same files from disk, which is what AC-5's restart assertion exercises.

### 1.4 What a reader can conclude

- **A recent stamp of any kind** ⇒ the owner is alive *enough*: the turn is stepping or a tool just returned.
- **No stamp for > `warnSilenceMs` while a turn is expected in flight** ⇒ the owner is silent: the wedge candidate (§3).
- **A `turn-end` and then silence** ⇒ the turn completed; the member is between turns and NOT a candidate (§0/GAP-1).
- **A `step` stamp but no `tool`/`turn-end` for long** ⇒ the current step is hung — the residual blind spot from §1.2, reported as `stalled-step` (an observation, not an escalation).
- **Nothing at all for a task that was claimed** ⇒ `never-started` (§0), a dispatch problem.

**The worked example, from the measured incident [M, `D§f`].** Last artifact write 16:32:37.003; threshold crossed 16:34:07; the runtime kept reporting `running` with no stray child. Under this design the tick would have seen the last stamp at ~16:32:37, WARNed at ~16:34:07 (latency bounded by `tickIntervalMs`), repeated at ~16:34:2x and ~16:36, and ESCALATED at ~16:37 — roughly **15 minutes before the human noticed at 16:52:49** — and the two intervening WARNs are the grace window in which a merely-slow member recovers with no pause at all. The provider `idleWatchdog` (armed only while a stream is outstanding) and the scheduler idle edge (the runtime still said `running`) would each have fired nothing, as measured.

---

## 2. State machine

```
OBSERVE (tick every tickIntervalMs)
  silence = now - newestStamp(owner, task)
  if owner has a turn expected in flight AND silence > warnSilenceMs:
      WARN(task, attemptId)  -> snapshot + notice(WARN)
      streak[task] += 1
      if streak[task] >= warnStreakToEscalate:
          ESCALATE(task, attemptId) -> scene + HOLD(team) + notice(ESCALATE)
          streak[task] = 0
  else:
      streak[task] = 0            # any stamp, or no expected turn, resets
```

**[D] The WARN is per TASK+attempt**, as D2 states ("the same task WARNing three consecutive times"), and the streak is keyed `<taskId>\0<attemptId>` so a retry (new `attemptId`) starts clean. Exactly one ESCALATE per task+attempt (AC-4), and no fourth WARN after it.

### 2.1 The knobs — exact paths, defaults, readers

| Knob (namespace `mpd`) | Type | Default | Read by | Effect |
|---|---|---|---|---|
| `watchdog.warnSilenceMs` | number | `90000` | the **tick** | silence beyond this ⇒ WARN |
| `watchdog.tickIntervalMs` | number | `15000` | the **tick** scheduler | cadence; **must be < `warnSilenceMs`** (a startup assertion fails loudly otherwise, because the D2 arithmetic depends on it) |
| `watchdog.warnStreakToEscalate` | number | `3` | the **escalator** | consecutive WARNs for one task+attempt ⇒ ESCALATE |
| `watchdog.actionOnEscalate` | select `pause` \| `warn-only` | `pause` | the **escalator** | `warn-only` records and notifies but never holds the team |
| `watchdog.enabled` | boolean | `true` | the **tick + writers** | the AC-10 kill switch (an env `MPD_DSH_TEAM_WATCHDOG=off` also forces off, for a lane that cannot patch settings) |

**[D] Live tuning — the AMEND-1 requirement.** The namespace is registered `applies:"restart"` (`packages/mpd-config-plugin/src/index.ts:511`), so the tick **re-reads its five knobs on `settings/document-updated`** for the `mpd` namespace (the bridge subscribes to exactly that event at `:478`) and keeps the re-read values in memory. Caching at `apply()` would make raising `warnSilenceMs` take effect only after a host restart, which AC-11 falsifies. The re-read is also performed once at `apply()` so the tick has values when no document-updated has fired.

**[M] Where the knobs are declared (three OUR files, none adopted).** `packages/mpd-config-plugin/src/settings-schema.ts` holds `SETTINGS_NS = "mpd"` (`:11`), `SettingsSchema`, `SETTINGS_KNOBS` (`:53`) and `BRIDGE_DISCLOSURE` (`:27`); `packages/mpd-tui-plugin/src/settings.ts` derives its section from `SETTINGS_KNOBS`; and `packages/mpd-bundle-plugin/src/settings-card.js` keeps its **OWN** `FIELDS` list (`:46`, "the SAME fields the TUI `/settings` section declares") and must gain the same five rows. The "same path" is single-NAMESPACE, not single-list — the plan's AMEND-1 says this and the code confirms it.

---

## 3. Scene snapshot

### 3.1 What is captured, and where

**[D] Path and naming:** `<stateRoot>/watchdog/scene/<teamId>/<ISO-basic-ts>.json` — one immutable file per ESCALATE, plus `<stateRoot>/watchdog/scene/<teamId>/latest.json` (the pointer a fresh process reads first). The incident record (§5) carries the timestamp so a reader can walk from notice → scene.

**[D] Fields (AC-5's list, and nothing else):**

```
{ schemaVersion: 1, at, reason: 'escalate', cause: {kind:'silence', ms},
  team: { id, name, phase, halted, haltedAt, hold:{id, since, cause, taskId, attemptId} | null },
  tasks: [ { id, status, assignee, attempt, attemptId, parkedAttempt, lastSeen, streak } ],
  members: [ { id, name, status, unread, currentTask, lastSeen } ],
  mailbox: { <member>: watermark },      // the read watermark (§5.3)
  parkedAttempts: { <memberId>: <attemptId> },   // from memory, flagged as such
  incidents: [ { id, kind:'warn'|'escalate', at, taskId, attemptId, scene? } ] }
```

**[D] Idempotence + atomicity (AC-6).** Temp+`rename` in the same directory for the pointer; the timestamped file is written once and never rewritten. A second ESCALATE for an already-held team writes **no** second scene and no second hold (§7 idempotence). A write of identical state changes no bytes.

**[D] Snapshot cannot be written.** The failure is **loud and non-fatal**: a named warning (`team-watchdog: scene write failed at <path>: <errno>`), the hold **still attempted**, and the incident recorded in the in-memory ring + the notice. The order matters — §7: the notice is attempted even when the scene failed, because a user who cannot get the scene must still learn the team is held.

### 3.2 "Continue this attempt" vs "start fresh", per task state [GAP-2]

The plan's H1 gives the durable rule (`same attemptId` + same `attempt` ⇒ resume; different/incremented ⇒ fresh — `state.js:167-195`, only the current `attemptId` is accepted by `update_task`). What it does not settle is the **per-state table a resume actually consults**, and this is where a wrong answer silently loses work. My design freezes it:

| Task state at scene time | Resume decision | Basis / consequence |
|---|---|---|
| **`pending`** | the task was never begun: the hold left it `pending`, so resume simply allows dispatch again. **Neither branch applies** — no attempt exists to continue. | `parkedAttempts.delete` path (`scheduler.js:620-630` else-branch sets `pending`, clears `attemptId`). |
| **`claimed`** | **continue** iff the scene's `attemptId` still equals `team.json`'s current `attemptId` (nobody re-claimed it). A mismatch ⇒ **fresh** (`beginTaskAttempt` → `attempt+1`). | `state.js:167-195`; the mismatch is the honest evidence that another writer acted. |
| **`running`** | **continue** on the same rule as `claimed`. The distinction from `claimed` is bookkeeping only (both may hold a live capability). | same |
| **`failed`** | **never resumed by the watchdog**: a terminal task is out of the machine's scope, and AGENTS.md §12's rule (a failed dependency pins its dependents) means the watchdog must not resurrect it. Resume leaves it failed and reports it as `not-resumed:terminal`. | `TERMINAL_TASK_STATUSES` in the adopted code; §12 |
| **`cancelled`/`completed`** | never resumed; if the team was held by hand (`halted`) the watchdog does not touch it at all. | §5-H2b: `agent_teams_resume` stays untouched for hand-halted teams. |

**[D] The two branches, and the honest limit.** `parkedAttempts` is an in-process `Map` (`scheduler.js:397`) whose cold-process behaviour the adopted comment states explicitly ("A cold process starts with an empty map, so durable open attempts are still recovered after restart"). Therefore:

- **Park survived (same process):** resume re-arms through the existing machinery with the **same `attemptId`**.
- **Process died mid-hold:** the Map is gone, so resume **mints a fresh attempt** for a task that was `claimed`/`running` — the branch AC-8 requires to be witnessed, and the one that can lose the in-flight context. The scene's `parkedAttempts` is therefore recorded as **advisory, never authoritative**, and the resume logs which branch it took. This is the plan's H1 consequence; I am making it an explicit, logged, per-task outcome rather than an inference.

---

## 4. The preserving hold (D3, §5-H2b), and the gap it leaves

### 4.1 The hold

**[D] A durable `watchdogHold` sidecar beside `team.json`**, written by the new plugin, so `state.js` keeps sole ownership of `team.json` (§5-H2b). Shape: `<stateRoot>/watchdog/hold/<teamId>.json` = `{id, teamId, since, cause, taskId, attemptId, sceneAt}`. Written temp+rename, idempotent by `id`.

**[D] The decline gates are ADDITIVE, and I verified their shape.** The scheduler already declines dispatch at three sites and each is itself an ADDITIVE region:
- `scheduler.js:422-423` — `if (team.halted === true) return noteDispatchDecline(..., 'the team is halted')` inside `#region mpd-delta kick-team-decline-logs`;
- `scheduler.js:454-455` — `if (team === undefined || team.halted === true || team.phase === 'staged') return` inside the member queue;
- `scheduler.js:490-491` — the same test on the re-read team inside `#region mpd-delta kick-member-locked-decline-logs`.

**[M] The gate the hold must join, and why a new region is still ADDITIVE.** The hold test is a NEW guard of the same form (`if (hold !== undefined) return noteDispatchDecline(..., 'held by the team watchdog')`) placed **adjacent to** an existing gate, inside an existing ADDITIVE region's neighbourhood. Adding lines is what ADDITIVE means: a hand re-materialise leaves the region's context pair satisfiable and `--write` re-applies it. I specifically reject Option (b) from §5-H2b (reusing `halted` and dropping the mass cancel) because it would **replace** lines inside `haltTeamWork` — REPLACEMENT-shaped ⇒ the heal refuses loudly (D13/D14 class), which §4 forbids for a new capability.

**[M] `haltTeamWork` is not the pause — verified, not assumed.** `tools.js:239-248` cancels every non-terminal task (`cancelUnfinishedTask(task, 'Stopped from the captain chat.')`, incrementing `cancelledTasks`), and `agent_teams_resume`'s description states verbatim *"Does not recreate cancelled tasks; only still-pending work is scheduled"* (`tools.js:2216-2218`). A pause built on it destroys exactly the work AC-17 protects, which is why AC-17's negative control (`--case pause-preserves-halt-control`) must redden.

**[D] Tool-boundary guards: ADDITIVE, and v1 can ship without them.** §5-H2b requires guards because a member already holding an attempt can still call `agent_teams_update_task` while the team is held. **[M] The guard sites today** are `tools.js:111` (plan-edit refusal), `:228` (captain-path halted read), `:1139` (create_task), `:1991` (wake/send), and **`agent_teams_claim_task` has NO halted guard** (`:1343`). Guarding claim/update means new `throw`s of the same shape as `:1991` — ADDITIVE. My design, however, **prefers ZERO adopted tool edits in v1** and puts the same protection in our own package: the watchdog row registers its own tool-boundary guard through the adapter's `guardTool` seam (`packages/mpd-dsh-adapter-plugin/src/index.ts:273`, contractually read-only), which can DENY `agent_teams_claim_task`/`agent_teams_update_task` while a hold exists for the calling session's team. `guardTool` returning a string denies (AGENTS.md §6), and a read-only check against the hold sidecar satisfies its "read only, never mutate" contract exactly. §6 records both options; the guard-by-region is the fallback if the adapter-side deny proves insufficient.

**[D] Resume (one action).** `session-watchdog-resume` clears the hold sidecar and then re-arms still-claimed attempts through the EXISTING parked-attempt machinery (`scheduler.js:397`, `:515-548`, `:620-630`) rather than `resumeTeamState` alone (`quality-gates.js:839-852` only flips the flag). A second resume for a non-held team is a **no-op**, not an error (AC-8).

### 4.2 Authority: how the tick performs the pause

**[D, adopting §5-H2c] The tick calls our own `session-watchdog-hold` action through the adapter's internal tool seam** — `dsh.toolRuntime().execute({name:'session-watchdog-hold', …})` (`packages/mpd-dsh-adapter-plugin/src/index.ts:279`, impl `:564`) — and **never** `agent_teams_halt`, and never by impersonating captain identity. **Carried consequence, stated:** the hold is therefore **not a captain declaration**; no `update-task`-style identity gate may be assumed for it, and the resume's mirror is `session-watchdog-resume`.

### 4.3 The gap this design must name [GAP-3]

**[GAP] The hold stops DISPATCH; it does not stop a turn already in flight.** All three decline gates are dispatch-side, and the tool-boundary guards are call-side. Nothing in the frozen plan releases or aborts the wedged member's *active* turn — and by definition there is one, because that is why we escalated.

Consequences I am freezing rather than hiding:
1. **The held attempt remains owned by the wedged turn.** A resume cannot re-dispatch it while the original capability is live; the parked machinery's own guard (`recoverOwned`: `owned.attemptId !== parkedAttemptId`, `scheduler.js:516-518`) is about *different* attempts, not about a live owner. So the honest v1 behaviour is: **the scene and the notice are what the user acts on**, and the hold prevents *new* work from being dispatched into a team nobody is driving.
2. **A member that recovers after ESCALATE** finds the team held: `agent_teams_claim_task`/`update_task` are denied by §4.1's guard, so it cannot advance the task — which is the correct outcome (the user decides), and it is also why the guard matters more than it first appears.
3. **What the design will NOT do:** abort another agent's turn. That needs harness support (a kernel-level cancel) that is not in the plan and not measured; adopting it would be a REPLACEMENT-shaped edit plus an unmeasured API. It is therefore **NOT-CLAIMED (W-10, new)** with the reason recorded, and the acceptance language "what happens to an in-flight member turn" is answered as: **it is left untouched and cannot advance, by design; only a real chat interrupt ends it.**
4. **A live turn that keeps stepping** (a member that was merely slow) will clear its own streak and, if it then tries to write, be denied — the design prefers a blocked write the user can see over a silently cancelled one.

---

## 5. Notification (D4) and unread replay

### 5.1 Web — banner at the TOP of the AgentTeams panel + one activity record

**[M] The seam.** `packages/mpd-bundle-plugin/src/team-page.js` renders from a module-level `store` fed by the shared polling controller (`:98-110`), and the client is rebuilt by `node scripts/build-mpd-client.mjs`. The banner is **not** a string in the source: the stuck state is added to the payload the panel consumes (`store.watchdog = {held, teamId, since, cause, incidentId}`) and the panel's render function receives it and renders the banner as the FIRST element of the panel body. The activity record is a second field in the same payload (`store.watchdogActivity[]`). AC-12 asserts the render function receives the value and the payload contains the record — a pixel render is **out of scope (W-4)** and must be reported not-claimed.

### 5.2 TUI — status-line row + dialog/notice

**[M] The seam.** `packages/mpd-tui-plugin/src/status.ts` is the status publisher the plan names. The row is published through the existing `tuiStatus` publisher (the same mechanism the bundle already uses for its status line), and the notice is raised through `tuiDialogs` (the mediated dialog surface the plugin already soft-probes). AC-13 asserts the RENDERED pane carries the notice text while the condition lasts and that it is ABSENT after resume.

### 5.3 Unread replay — the durable part that closes the "seen gap"

**[D] Records + watermark, in a dedicated file:** `<stateRoot>/watchdog/incidents.jsonl` (one record per incident: `{id, teamId, kind, at, cause, scene, acknowledgedBy?}`) and `<stateRoot>/watchdog/read-watermark.json` (`{ <reader>: <lastAckedIncidentTs> }`). This is the mailbox-unread **shape the plan cites** — a record per item plus a per-reader watermark, the pattern `snapshot.js` uses for mail unread counts (`:49-56` builds `unreadByMember`, `:84` exposes `unread` per member).

**[M] The three readers the plan names, verified:** the Web panel's first poll (`team-page.js:101-165` polling controller), the TUI status publisher's `publish()` interval (`mpd-tui-plugin/src/status.ts`), and the plugin's session-start attach (`capabilities.js:110`, `ctx.on('agent/session-start', ({agent}) => attach(agent))`).

**[D] Clearance:** ONLY an explicit acknowledge (TUI dialog, or the Web banner's acknowledge control) advances the reader's watermark. Consequence stated honestly, per the plan: **without an acknowledge the replay is permanent re-display by design** — it is not a bug, and AC-14 asserts exactly that behaviour plus the survival of the flag across a process restart and its absence on a second start after acknowledgement.

**[D] What survives an outright kill:** the last scene file, `hold/<teamId>.json`, `incidents.jsonl` and the watermark — all plain files written temp+rename. Who notices: the next start, through all three readers (the watermark is unchanged because nobody acknowledged).

---

## 6. Delta discipline — every adopted touch, and its re-materialise consequence

**[D] Preferred: ZERO adopted edits.** Every heartbeat/tick/scene/hold/notice writer lives in `packages/mpd-team-watchdog-plugin/`. The only files outside it are OUR files: the three settings files (§2.1), the bundle patch row, `team-page.js` + the rebuilt `client.js`, the new lanes + SKILL.md rows.

| # | Change | Kind | Re-materialise consequence |
|---|---|---|---|
| 1 | `scheduler.js` — the hold decline gate beside `:422-423`, `:454-455`, `:490-491` | **ADDITIVE region** (new guard lines, existing context pairs intact) | upstream re-materialise ⇒ `--write` **self-heals**; `--check` clean after the wave's single `--write-registry` |
| 2 | `tools.js` — hold guards on `claim_task` (`:1343`) and `update_task` | **ADDITIVE** — but **NOT REQUIRED in v1** (§4.1: the adapter's `guardTool` deny covers it) | if omitted: **zero adopted edits**; if added: self-heals like #1 |
| 3 | Everything else | **new local module / OUR files** | a re-materialise cannot touch it (the file is not upstream), so **it survives verbatim** |

**Forbidden here [D]:** any REPLACEMENT-shaped edit (e.g. editing `haltTeamWork` to drop its cancel loop) — the heal REFUSES loudly after a human re-vendor (D13/D14 class) and §4 bans it for a new capability. **Also forbidden:** touching `state.js`'s ownership of `team.json`, and hand-editing `lib/mpd-deltas.js` (registry regeneration only, via `--write-registry`).

**Files that must NOT touch adopted code at all:** the heartbeat writer, the tick, the scene store, the hold sidecar, the notification fan-out, the TUI/Web surfaces, and the lanes.

---

## 7. Fail-safe (H3 / AC-15)

| Requirement | Design |
|---|---|
| **No unbounded timer chain** | exactly ONE `setInterval` for the tick and ONE for the TUI publish interval, both created in `apply()` and cleared in `ctx.effect(...)` cleanup — the existing adopted precedent is the one-shot `surfacePoll` (`packages/mpd-agent-teams-plugin/lib/index.js:537-547`), and the new row may call `ctx.setInterval` itself (the harness loads the timer plugin when `ctx.get('timer')` is undefined). The scene write is event-driven (on ESCALATE), never timer-driven, so there is no periodic write loop. AC-15 asserts a bounded timer count over a run window. |
| **No throw out of a timer callback** | the tick body is wrapped: any throw is caught, counted (`watchdog: tick threw N times`), and the tick returns; a throwing settings re-read or scene write degrades to a warning. AC-15 asserts a throwing callback is caught and counted, never propagated. |
| **No write loop** | writes happen ONLY on WARN/ESCALATE/ack/resume (§3/§4/§5); a tick with no state change writes nothing, and a second ESCALATE for a held team writes nothing. AC-15 asserts write count per state change. |
| **Unwritable scene location degrades LOUDLY** | the named warning, the hold still attempted, the notice still published (§3.1) — never a silent death. |
| **Idempotent hold, never announced as applied when it could not be persisted** | the hold is written temp+rename and only then announced; if persistence fails, the incident records `hold: 'not-applied'` and the notice says the team could NOT be held, rather than claiming it was. |
| **Outright process kill** | what survives: last scene, `hold/<teamId>.json`, `incidents.jsonl`, the read watermark. Who notices: the next start, via §5.3's three readers. What is LOST: `parkedAttempts` (in-process `Map`, `scheduler.js:397`) ⇒ the fresh-branch resume of §3.2, logged per task. |

---

## 8. Fault-injection verification plan (W-3: no real wedge needed)

All cases run through the fixture harness (`w8`), never through a real provider wedge (**W-3**). Each names the observation that PROVES the behaviour and its negative control.

| Case | Injection | Observation that proves it | Negative control |
|---|---|---|---|
| **stub-member** (AC-1) | a stub member whose turn starts and then stops stepping | ≥ 3 distinct `lastSeen` values with monotonic timestamps across one turn, read FROM DISK while the turn is running | with no stub (no injection) the lane must FAIL as vacuous |
| **tool-stamps** (AC-2) | four witnesses: member-with-tool, captain-with-tool, member-no-tool, captain-no-tool | a `kind:'tool'` stamp whose `at` lands AFTER the call returned, plus a no-tool turn proving the step path is independent; **no pre-call claim** | a lane asserting a pre-call stamp must redden (W-9) |
| **warn-90s** (AC-3) | scaled threshold or injected `now()` | WARN within `threshold + 5 s`, snapshot with §3.1's fields | `enabled:false` ⇒ no WARN, no scene, no hold (AC-10) |
| **escalate-3x** (AC-4) | three consecutive silences for one task+attempt | exactly ONE ESCALATE; its predecessors recorded as WARNs with snapshot paths; no fourth WARN | a retry with a NEW `attemptId` must start a clean streak (no escalate) |
| **pause-scope** (AC-7) | two teams in one workspace, one escalated | team A stops dispatching while team B keeps dispatching in the same window; **no `cancelledTasks` in A**, and A's task records are byte-identical apart from the new hold fields | a second workspace's team must be unaffected |
| **pause-preserves** (AC-17) | a `claimed`/`running` task when the hold lands | status, `assignee` and `attemptId` byte-identical after ESCALATE; still resumable | **halt-control**: the same fixture driven through `haltTeamWork` MUST redden (task `cancelled`, `cancelledTasks ≥ 1`) |
| **resume** (AC-8) | resume after a hold | hold cleared, task re-dispatched; **same `attemptId`** when the park survived (same process) and **fresh `attempt`** when it did not (cold process); a second resume is a no-op | resuming a team that was never held does nothing and errors nothing |
| **captain-wedge** (AC-9) | the captain's own turn silent past the threshold | the tick fires **without any captain turn**, the scene lands, the escalation is recorded, and the notice survives a process restart | with the tick disabled, nothing fires |
| **scene-restart** (AC-5) | write a scene, kill the process, start fresh | the fresh process prints exactly §3.1's fields | a scene with a field missing must fail the read-back |
| **ack-replay** (AC-14) | one incident, no acknowledge, restart | all three readers surface it; flag survives restart; after an explicit acknowledge a second start surfaces nothing | without an acknowledge the second start MUST surface it again (the stated permanence) |

**[D] The lane-level honesty rule (AC-15/§3.1) applies to every row above:** a lane that asserts "the writer was called" is not evidence. The proof is a file that exists and parses with a FRESH process reading the fields back, a notice the render function RECEIVES, and a task record whose bytes are unchanged.

---

## 9. Design vs plan — where the plan is wrong or underspecified, with the basis

| # | Plan text | Status | Basis (measured) |
|---|---|---|---|
| **F-a** | §3 AC-3/AC-4 escalate on silence for "the task", with no precondition that a turn is expected in flight | **UNDERSPECIFIED — design adds §0/GAP-1** | A `claimed` task owned by a legitimately idle member is silent by design; three consecutive WARNs would escalate a healthy team. The candidate set must be "owner has an attempt expected in flight", and `never-started` must be a separate, non-escalating observation. |
| **F-b** | §5-H1/H2b: the hold stops dispatch and "re-arms still-claimed attempts" on resume | **INCOMPLETE — GAP-3** | All three decline sites are dispatch-side (`scheduler.js:422-423`, `:454-455`, `:490-491`), and the tool guards are call-side; nothing releases the *live* wedged turn. So v1 cannot guarantee a re-dispatch of the held attempt in the same process, and must not claim to. The design answers acceptances 4 with "the turn is left untouched and cannot advance; only a real chat interrupt ends it" and records the abort as NOT-CLAIMED (W-10). |
| **F-c** | §5-H1 treats `parkedAttempts` as the resume vehicle | **CORRECT but needs the branch made explicit per state** | `scheduler.js:397` is an in-process `Map` whose own comment says a cold process starts empty; §3.2's per-state table and the logged branch (same vs fresh) close it. |
| **F-d** | §5-H2b: the pause "must" carry tool-boundary guards, citing `tools.js:1343` | **SOFTENED — v1 can avoid the adopted edit** | The adapter's `guardTool` seam (`mpd-dsh-adapter-plugin/src/index.ts:273`, contractually read-only) can deny `claim_task`/`update_task` while a hold exists, so the guards are optional in v1 and the preferred delta count stays at ONE region (or zero). |
| **F-e** | §5-H2c: the hold "is not a captain declaration" | **CONFIRMED, and load-bearing for §7** | Because it is not a captain declaration, the hold must be announced only after it is persisted; §7's idempotence rule is what stops a failed write from being reported as an applied hold. |
| **F-f** | §9 W-5: the 90 s threshold's false-positive budget is unproven | **CONFIRMED and reinforced by F-a** | Combined with F-a this is the design's single largest correctness risk: without the in-flight precondition, 90 s is aggressive; with it, a slow-but-alive member recovers in the WARN grace window (the incident's arithmetic in §8 of the plan). |
| **F-g** | §3 AC-2's step stamp is read as "the model is working" | **HONEST BOUND stated** | `agent/pre-step` fires before the step's model call (`$H/dsh-agent-loop/lib/index.js:894`), so a stalled stream still shows a recent step stamp; §1.2 states the one-step blind spot and the `assistant-stream` refinement is left as an optional, unclaimed improvement. |

**No contradiction with D0–D5** was found: the design keeps the team-only blast radius (D3) via a preserving hold, both front doors plus replay (D4), captain coverage by a process-level tick (D5), per-step and per-tool heartbeats for members and the captain (D1), and the four frozen knobs in the `mpd` namespace with live tuning (D2, AMEND-1).

---

## 10. NOT-CLAIMED (this design adds two to the plan's list)

- **W-10 (new) — the watchdog does not abort an in-flight turn.** No harness-level turn cancel is measured or available to a bundle row; the hold stops dispatch and denies writes, and only a real chat interrupt ends a wedged turn. Related: `w8`'s "no real wedge is reproducible" caveat (W-3) means the pause is exercised against an injected fixture only (W-8).
- **W-11 (new) — no pre-call tool stamp.** The POST stamp is the deliverable (AC-2); a pre-dispatch stamp requires the adapter's `tools/execute` extension (§5-H1b, W-9) and is not claimed.
- Unchanged from the plan and honoured here: W-1 (no implementation), W-2 (resolved by measurement), W-3, W-4 (no browser render), W-5 (90 s frozen by the user, false-positive budget unproven), W-6 (pause authority settled), W-7 (engine skew), W-8 (preserving pause unexercised against a real wedge).

---

**Design summary for the writer task:** the design satisfies all eight contracted items, keeps the adopted-delta footprint at ONE ADDITIVE region (zero if the adapter-side deny suffices), and reports seven findings against the plan (F-a…F-g), of which **F-a** (silence is only diagnostic while a turn is expected in flight) and **F-b/GAP-3** (the hold cannot release a live wedged turn) are material enough that the captain may want an amendment before w3 starts.