# TUI team-workflow + plan-approval surface — FROZEN CONTRACT (t1)

Status: **frozen for implementation (t2)**, produced by the Architect (read-only) under task `t1`.
This file is the interface contract. It freezes *what is built, how it is opened, what each
keystroke means, which seam each action uses, and what is explicitly NOT claimed*. It does not
implement anything and it may not be silently deviated from: a deviation found in t2 is a finding,
not a local decision.

Method note: every claim about the Web edition below was read from the named `file:line` in this
checkout. Where a claim could not be read, the contract says so instead of assuming.

---

## 1. Goal and boundary

The user is on the **Web edition** and wants the **TUI edition** to expose the same thing as a real
**interface**. The deliverable is therefore:

* a full-screen **team-workflow surface** that lets the user SEE a team's workflow, and
* a full-screen **plan-approval surface** that lets the user approve / request changes / discard a
  **staged** plan from inside the terminal UI,

both reachable from the TUI itself. A slash command is **not** the deliverable; commands are only
the *entry points* (they are how this package already opens its board scene —
`packages/mpd-tui-plugin/src/commands.ts:89-98`).

**Out of scope for the whole wave (do not touch):** `packages/mpd-agent-teams-plugin/**` (adopted
MIT main code; its plan route and runtime are the Web's, not ours), `.mpd/**` (team state is written
by the adopted plugin only), `AGENTS.md`, `VENDOR_LOCK.json`, `docs/**` (t5 owns the docs).

**The one-line architecture:** the surfaces READ the durable team record
(`<workspace>/.mpd/team/<teamId>/team.json`, read-only) and MUTATE only by calling the **adopted
agent-teams tools** through `packages/mpd-dsh-adapter-plugin`. The TUI never re-implements the
runtime the Web route drives, and never writes team state.

---

## 2. What the Web edition actually is (the parity target, with citations)

### 2.1 The Web plan panel (the approval surface)

| Web fact | Evidence (read from this checkout) |
|---|---|
| The staged-plan editor is rendered for `team.phase === "staged"` and only when the plan callbacks exist | `packages/mpd-agent-teams-plugin/lib/client.js:2437` (`team.phase === "staged" && !historic && modelDirectory !== void 0 && onContinuePlanning !== void 0 && onDiscarded !== void 0`) |
| Approve is a **single click**; it POSTs `action: "approve"` | `…/lib/client.js:1501-1516` (`const approve = async () => { … mutatePlan({ action: "approve" }) }`), button at `:1695` (`"data-plan-approve": true`) |
| Approve is DISABLED while busy, when the plan is not runnable, or while an editor has pending edits | `…/lib/client.js:1459` (`const runnable = team.members.length > 0 && team.tasks.length > 0`), `:1460` (`hasPendingEdits`), `:1696` (`disabled: busy \|\| !runnable \|\| hasPendingEdits`) |
| Continue / Return-to-chat is a **single click** (`action: "continue"`); it does not ask for a reason | `…/lib/client.js:1518-1538`, button at `:1705` (`"data-plan-continue": true`) |
| Discard is **two-step**: the first click only arms (`setDiscardArmed(true)`), the second commits (`action: "discard"`) | `…/lib/client.js:1540-1556` (discard fn), armed button `:1680-1687` (`"data-plan-discard": true` + `"data-confirming": true`), arming call `:1717` (`setDiscardArmed(true)`) |
| All three actions POST to ONE route and the browser gets the HTTP result | `…/lib/index.js:325` (route path `/plugins/dsh-agent-teams/plan`), `:371` (`if (action === 'approve')`), `:391` (`'continue'`), `:397` (`'discard')`) |
| Approve calls the adopted runtime and then STEERS the captain with a control message | `…/lib/index.js:372` (`agentTeamsRuntime.approveStagedTeam(captain, teamId)`), `:375-381` (`captain.steer(createUserMessage({ content: [{type:'text', text: stagedPlanApprovedContext(team.name)}] … }))`) |
| Discard calls `discardStagedTeam`, which `inject()`s a context message and then CANCELS the captain turn | `…/lib/tools.js:549-571` (`discardStagedTeam`) and `:577` (`captain.cancel({kind:'user'}, {keepInbox:true})`) |
| The route refuses with **409** when the captain session is not attached in this process | `…/lib/index.js:364-368` (`if (captain === undefined) … 'captain session is not attached' {writeHead(409)}`) |
| The route is **POST-only**, returns `cache-control: no-store`, and 404s a team that is not this captain's | `…/lib/index.js:326-332` (405), `:368-370` (404) |
| The same runtime has an **agent-facing tool** whose approval gate is an explicit non-empty confirmation string | `…/lib/tools.js:883-912` (`agent_teams_approve`, `confirmation: {type:'string', required:true}`, `:905-906` throws when empty, `:910` calls `approveStagedTeam`) |

### 2.2 The Web activity-panel snapshot (the workflow surface)

The panel is fed by the `/plugins/dsh-agent-teams/state` route (`…/lib/index.js:255-272`), whose
snapshot is assembled by `assembleTeamSnapshot` (`…/lib/snapshot.js:38-136`). Fields the Web panel
consumes, and the durable source each comes from:

| Snapshot field | Source in the durable record |
|---|---|
| `teamId`, `name`, `description`, `captainSessionId`, `phase` | `team.json` top level (`…/lib/snapshot.js:87-91`) |
| `planReviewState` (`awaiting_review` \| `awaiting_feedback`) — only while `phase === 'staged'` | `team.json` (`:92-93`) |
| `halted` | `team.json.halted === true` (`:94`) |
| members: `name`, `role`, `provider`, `model`, `reasoningEffort`, `status`, `activity`, `progress`, `done/total`, `currentTask`, `unread` | `team.json.members[]` + mailbox + live activity (`:56-82`) |
| tasks: `id`, `subject`, `status`, `state` (visual), `failedDependencies`, `assignee`, `model`, `dependencies`, `depth`, `kind?`, `round?`, `verdict?` | `team.json.tasks[]` (`:95-118`) |
| `messageCount`, `captainInbox` | unread mailbox records (`:119-125`) |

`halted` (`…/lib/snapshot.js:94`) is **not** the watchdog hold. The watchdog hold is a separate
durable sidecar surfaced by the `mpdWatchdog` service — the TUI already consumes it
(`packages/mpd-tui-plugin/src/watchdog.ts:31-39`, `heldTeams`).

---

## 3. The TUI surface set (frozen)

Two NEW full-screen scenes, registered through the existing `ctx.tuiScenes` seam
(`packages/mpd-tui-plugin/src/scenes.ts:146-190`), plus one extended existing scene.

### 3.1 Surface T1 — the team-workflow scene

| Property | Frozen value |
|---|---|
| Scene id | `mpd-tui-team` |
| Title | `MPD team` |
| Opened by | `/mpd team`, or the bare-`/mpd` picker entry `team`, or `a` inside the board scene (see §5.6) |
| Subject | the newest team record for the workspace, or `MPD team — (none)` when there is none |

Rendered body, in this order (each row capped and sanitized with `scalarText`, exactly like the
board — `packages/mpd-tui-plugin/src/state.ts:279-311`):

1. **Header** — `team  <name> (<id>)`, `phase <phase>`, `plan  awaiting_review|awaiting_feedback`
   when `phase === "staged"`, `captain <captainSessionId>`, `staged <approvedAt or createdAt>`.
2. **Watchdog** — `watchdog  HELD (<teamIds>)` when the `mpdWatchdog` service reports this team id
   among `heldTeams(workspace)`, else the row is omitted. Never a fabricated "ok" row.
3. **Roster** — one row per member with `status !== "removed"`:
   `<name> · <role> · <provider>/<model> · <status>` plus `done/total` task progress and
   `currentTask` when present.
4. **Task DAG** — one row per task, ordered by `depth` then creation order, indented by `depth`
   (`…/lib/snapshot.js:110` computes `depth` from the dependency graph; the TUI computes the same
   by depth-first walk of `dependencies`):
   `<indent><taskId> [<kind>] <subject> · <status>` + ` @<assignee>` + ` attempt <n>` +
   ` r<round>` when present + ` verdict <verdict>` when present + ` deps=<a,b>` when non-empty +
   ` failed-dep=<id>` for each id in `failedDependencies` + ` BLOCKED` when
   `taskVisualState(status, tasks, dependencies) === "blocked"`.
   `kind` is rendered as `-` when absent (the field is optional in the record —
   `.mpd/team/mpd-default-8d65a2b2/team.json` carries it, a hand-written fixture may not).
5. **Counts** — one line: `tasks <total> total · <completed> completed · <in-progress> … · <pending> …`
   (the same six buckets the board already counts — `state.ts:113-139`).
6. **Mailbox** — `mail <n> unread` (captain + member unread counts), and the last ≤5 captain inbox
   rows `from: <truncated content>`.
7. **Problems** — bounded notes (`≤5`) exactly like the board's problem list.

Keys (scene-owned input, `ui.useInput`, the board's pattern — `scenes.ts:91-96`):

| Key | Effect |
|---|---|
| `Esc` / `q` | close the scene |
| `r` | re-read the record immediately |
| `↑` / `k`, `↓` / `j` | scroll the body (window = terminal rows − chrome) |
| `a` | open Surface T2 (§3.2) for THIS team; only when `phase === "staged"`, otherwise a one-line notice `plan approval needs a staged team` |
| `p` | open the board scene (`tuiScenes.open("mpd-tui-board")`) |

Refresh cadence: **2000 ms**, the board's value (`scenes.ts:29`).

Honesty rule inherited from the package: a read failure renders exactly one line
`team state unreadable — <path>` and never throws (`scenes.ts:58-64` is the pattern).

### 3.2 Surface T2 — the plan-approval scene

| Property | Frozen value |
|---|---|
| Scene id | `mpd-tui-plan` |
| Title | `MPD plan approval` |
| Opened by | `/mpd plan`, or `a` in Surface T1, or the bare-`/mpd` picker entry `plan` |
| Precondition | the selected team's `phase === "staged"`; otherwise the scene opens and renders the single line `no staged plan for team <id> (phase <phase>)` and accepts only `Esc` |
| Subject | the staged plan: roster rows + the task DAG rows, plus the plan-level facts |

Body (read-only projection, same sanitization as §3.1):

1. `team <name> (<id>) · phase staged · review <planReviewState>`
2. `members <n> · tasks <n> · links <Σ dependencies>` (the Web header's own counts —
   `…/lib/client.js` `dependencyLinks`, `:1458`)
3. `runnable   yes|no` — `yes` iff `members ≥ 1 ∧ tasks ≥ 1` (the Web's gate, `:1459`)
4. `edits      pending|none` — mirrors the Web's `hasPendingEdits`; in the TUI this is ALWAYS `none`
   because the TUI has no inline editors (§7), and the row states that in its reason text.
5. Roster rows and DAG rows as in §3.1 (items 3-4), with the plan's `deps` links explicit.
6. The action block and the confirmation echo (§4).

Keys:

| Key | Effect |
|---|---|
| `Esc` | return to Surface T1 (or close, when this scene was the entry point). **Sends nothing.** |
| `r` | re-read the record |
| `↑`/`k`, `↓`/`j` | scroll |
| printable characters | appended to the confirmation echo line (this is the deliberate-consent input, §4) |
| `BSpace` | delete the last echoed character |
| `Ctrl+X` | **APPROVE** — only honoured when the echo equals the required phrase (§4) |
| `Ctrl+D` | **DISCARD** — two-step arm/confirm (§4.3) |

The scene renders, verbatim and always, the line:
`approval needs the exact team id typed below, then Ctrl+X` — the user must never have to guess.

### 3.3 Surface T3 — the board scene gains two rows (extension, not a new scene)

`packages/mpd-tui-plugin/src/state.ts:280-311` (`boardLines`) gains exactly two lines, and no other
change to the board:

* `team-plan  <awaiting_review|awaiting_feedback>` when the newest team is staged, else omitted;
* `team-hold  held (<ids>)` when the watchdog reports a hold for the workspace, else omitted.

This keeps the ONE status line honest (`mpd: team …`) while making the staged state visible without
opening a scene.

---

## 4. The approval contract (frozen semantics)

### 4.1 The phrase that must be typed

The required confirmation phrase is

```
approve <teamId>
```

built from the **durable record's own `id`** (never from user-typed input, never from a name that a
model could have echoed). For this session's real team that is `approve mpd-default-8d65a2b2`
(record read at `.mpd/team/mpd-default-8d65a2b2/team.json`).

The phrase is passed through unchanged as the tool's `confirmation` argument, which the adopted tool
requires to be non-empty (`packages/mpd-agent-teams-plugin/lib/tools.js:886`, `:905-906`).

### 4.2 Why an accidental approval is impossible (the reasoning t4 must be able to check)

Five independent barriers, each mechanically testable:

1. **Two different surfaces.** Approval is NOT on the scene the user lands on. Opening
   `/mpd team` cannot approve anything; the approval keys exist only in `mpd-tui-plan`.
2. **A deliberate typed phrase.** `Ctrl+X` is inert until the echo line exactly equals
   `approve <teamId>`. A single stray keystroke can never satisfy it (the minimum is 9 characters
   plus the id, and `BSpace` is the only editing key).
3. **No default / no prefill.** The echo starts EMPTY on every entry and on every `r` refresh. The
   scene never pre-fills the phrase, and there is no "press Enter to accept" path.
4. **Mutating keys are chords.** Approve is `Ctrl+X` and discard is `Ctrl+D`; every bare printable
   key is *consent input*, not an action. A user typing a team id into the surface can never trip an
   action, and a terminal that swallows `Ctrl+…` fails CLOSED (nothing happens) rather than open.
5. **Single-flight + re-read.** While a call is in flight the scene ignores ALL keys and renders
   `working…`; after it settles the record is re-read and the verdict is rendered. A second
   `Ctrl+X` in the same second cannot double-approve (and the adopted tool would answer
   `team is already running`/halted loudly anyway — `…/lib/tools.js:155`).

Falsifiable negative controls for t3 (each MUST redden the lane):

* N1 — park the phrase `approve <teamId>` for a DIFFERENT team id and press `Ctrl+X`: no tool call,
  no phase change, an in-scene error `confirmation does not match this team`.
* N2 — press `Ctrl+X` with an empty echo: no tool call.
* N3 — press `Ctrl+X` in the WORKFLOW scene (T1): no tool call (the key does not exist there).

### 4.3 Discard — arm then confirm

* First `Ctrl+D`: sets `discardArmed = true` for **10 s** and re-renders the action block as
  `DISCARD ARMED — press Ctrl+D again within 10s to archive this staged plan`.
* Second `Ctrl+D` inside the window: calls `agent_teams_delete`.
* Any other key, a refresh, or expiry clears the arm.
* Rationale for `10 s` + arm: it mirrors the Web's own two-step discard
  (`…/lib/client.js:1540-1556`, `setDiscardArmed` at `:1680-1682`) and it makes an accidental
  discard require two chord presses inside one window.

### 4.4 Request changes

Frozen as **a documented exit, not a call**: the approval scene does not POST a "continue". It
renders, always and verbatim:

```
to change this plan: press Esc and tell the captain what to change in the chat
```

and `Esc` returns to Surface T1 without sending anything. The reason is a measured capability gap,
not a preference: §6 shows that the Web's `continue`/`discard` runtime has **no tool surface**, and
this contract refuses to invent a third mutation path (the task brief forbids re-implementing the
runtime the Web route drives). The user's typed chat message then reaches the captain as an ordinary
user turn, and the captain revises the plan with the *existing* tool
`agent_teams_edit_plan` (`…/lib/tools.js:759-881`, whose description is literally "Use this when the
user continues chatting to change a plan that is waiting for approval").

### 4.5 Result rendering (what the user sees after an action)

| Outcome | Rendered line |
|---|---|
| approve ok | `approved: <teamId> running · members <n> · tasks <n>` and the scene re-reads the record (phase `running`) |
| approve refused | `approve failed: <tool error text, sanitized>` — the echo stays, the scene stays open, nothing was written |
| approve unavailable | `approve failed: agent_teams_approve is not registered in this composition` |
| discard ok | `discarded: team archived` (the scene then shows the "no staged plan" state) |
| discard refused | `discard failed: <tool error text, sanitized>` |

The scene NEVER claims success from the mere presence of a call: it prints the tool's own
structured result (`status`, `team_id`, `members`, `tasks` from `…/lib/tools.js:889-898`).

---

## 5. Entry points, keystrokes and registration (frozen)

### 5.1 Command grammar — `/mpd` gains two actions

Current grammar is frozen in `packages/mpd-tui-plugin/src/command-trees.ts:15`
(`["board", "workmates", "status"]`) and implemented in `commands.ts:89-102`. It becomes:

```
/mpd            -> picker (host dialog) with 5 entries
/mpd board      -> open mpd-tui-board
/mpd team       -> open mpd-tui-team          (NEW)
/mpd plan       -> open mpd-tui-plan          (NEW)
/mpd workmates  -> print the workmate list
/mpd status     -> print the status line
```

`COMMAND_ACTIONS` gains `"team"` and `"plan"`; `COMMAND_CHILDREN` gains the two rows with
descriptions and `descriptions.zh` (the existing bilingual completion pattern —
`command-trees.ts:18-22`). Unknown actions keep the existing loud usage error
(`commands.ts:101`).

### 5.2 The bare-`/mpd` picker (and the `alt+w` pattern it mirrors)

`pickAction` (`index.ts:336-345`) gains:

| id | label | description |
|---|---|---|
| `team` | `Team` | `team workflow: phase, roster, task DAG` |
| `plan` | `Plan` | `review and approve a staged plan` |

### 5.3 Shortcuts — one optional binding, degrade-safe

A new binding `alt+t` → "mpd: open the team workflow" MAY be added next to the existing three
(`packages/mpd-tui-plugin/src/shortcuts.ts:25-29`). Rules: `alt+t` is an ADDITION that must go
through the same refusal path (any refusal is a warning and the `/mpd team` command still works —
`shortcuts.ts:73-76`); the scene does not depend on it. `alt+t` is **not** part of the acceptance
criteria for the surfaces; its refusal must not fail a lane.

### 5.4 Registration shape

Both scenes register through the SAME existing seam call, in `registerScene`
(`scenes.ts:146-190`), with two additional scene ids and two component factories in the same file
plus the state readers in `state.ts`. No new service, no new inject declaration: the scenes ride
`tuiScenes`, which the row already reaches (`index.ts:267`).

The two scene components MUST follow the board component's contract verbatim
(`scenes.ts:47-119`): use `props.React` (never import React), use `props.ui.Box/Text/useInput`,
return `null` when the host kit is absent, do all I/O in `useEffect` and never in the render path,
and never write to stdout.

### 5.5 State reading (read-only)

A new pure module `packages/mpd-tui-plugin/src/team-state.ts` owns the projection:

* resolves `<workspace>/.mpd/team/**` under the SAME per-call workspace root the board uses
  (`workspaceResolver(ctx)`, `index.ts:164-184`) — never `process.cwd()` cached at module level;
* selects the newest record by `approvedAt ?? createdAt` then file size — the board's existing rule
  (`state.ts:107-109`) so the two surfaces cannot disagree about "which team";
* tolerates every optional field (`kind`, `round`, `verdict`, `approvedAt`, `planReviewState`) and
  never throws (a broken record → a bounded problem note);
* caps: `MAX_TASKS = 5000`, `MAX_TEAMS = 20`, `MAX_PROBLEMS = 5` (the board's caps, same values).
* computes `depth` by DFS over `dependencies`, treating a cycle as depth 0 for the revisited node
  and adding a `note cycle <ids>` problem line (a cycle must be visible, not hang the render).

**No write primitive may appear in the built bytes of this package.** The rule already holds
(`packages/mpd-tui-plugin/dist/index.js` contains none of
`writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|cpSync|createWriteStream`) and t2 must
keep it true; the lanes assert it from the BUILT bytes.

### 5.6 Cross-links between surfaces

* `p` inside `mpd-tui-team` → `tuiScenes.open("mpd-tui-board")` (the seam's `open` already exists —
  `scenes.ts:174-187`).
* `a` inside `mpd-tui-team` → `tuiScenes.open("mpd-tui-plan")` for the same team id.
* `a` inside `mpd-tui-board` → `mpd-tui-team` (a one-key hop from the board to the workflow view).

---

## 6. The seam every mutation uses (frozen) — and the ONE adapter gap

### 6.1 The rule

`packages/mpd-tui-plugin/src/types.ts:11-15` is binding: harness seams (tools / skills / agent
registry / subagents) NEVER appear in this package; they go through
`packages/mpd-dsh-adapter-plugin`. The two mutations therefore execute the adopted tools:

| Action | Tool (frozen) | Arguments |
|---|---|---|
| approve | `agent_teams_approve` (`…/lib/tools.js:883`) | `{ confirmation: "approve <teamId>" }` |
| discard | `agent_teams_delete` (`…/lib/tools.js:2329`) | `{}` |

`agent_teams_delete` is the adopted tool for "end and archive your team" — the same
`archiveTeamDir` outcome the Web's discard produces
(`…/lib/tools.js:2387` vs `:560` `await archiveTeamDir(stateRoot, fresh.id)`). The difference
is that the Web's discard also `inject()`s a context message and cancels the captain turn
(`…/lib/tools.js:567-577`); the TUI action does NOT, and §7 records that honestly.

### 6.2 The gap: `executeTool` cannot carry the calling agent (MEASURED)

* The adoption is by tool CALL, so the call must carry the captain's identity: every write tool
  starts with `requireCaptain(exec)` and throws
  `agent_teams tools require a calling agent (exec.agent was undefined)` when it is absent
  (`packages/mpd-agent-teams-plugin/lib/tools.js:65-71`).
* The adapter's public surface today is
  `executeTool(input: { name, arguments?, callId?, signal?, timeoutMs? })`
  (`packages/mpd-dsh-adapter-plugin/src/index.ts:316`) — **no `agent` field** — and its body passes
  exactly that shape to the harness (`…/src/index.ts:627-645`:
  `tools.execute({ name, arguments, callId, signal })`).
* The harness API does accept one: `dsh-tools` creates the execution with
  `const agent = exec.agent; … ...agent !== undefined ? { agent } : {}` and resolves the tool with
  `this.resolveExecution(exec.name, exec.agent, …)`
  (`/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js:3030-3045`, `:3190-3192`).
* Therefore, as the adapter stands, a TUI approval call would be constructed, dispatched, and fail
  with `requireCaptain`'s message — a LOUD failure, but the capability would be missing.

**Frozen adapter extension (the documented job of this package — AGENTS.md §6):**

```
executeTool(input: {
  name: string
  arguments?: unknown
  callId?: string
  signal?: AbortSignal
  timeoutMs?: number
  agent?: unknown            // NEW, optional; forwarded verbatim as `exec.agent`
}): Promise<DshToolCallResult>
```

and identically for `toolRuntime().execute(…)`. `agent` stays OPTIONAL and defaults to the current
behaviour (absent) so no existing caller changes meaning. The execution is single-source of the
agent: the TUI passes the object returned by the adapter's own public
`liveAgent(captainSessionId)` (`packages/mpd-dsh-adapter-plugin/src/index.ts:209-211`, already
public and already used for the compaction surface), or `liveAgents()[0]` when the record's
`captainSessionId` is empty. The TUI never constructs an Agent-like object itself.

**Capability honesty (frozen):** when `liveAgent(captainSessionId)` is `undefined` — the captain
session is not attached to this process, exactly the case the Web route answers with 409
(`…/lib/index.js:364-368`) — the TUI action is REFUSED with
`approve failed: the captain session <id> is not attached in this process` and renders that text.
It must not fall back to a fabricated path, must not write the record, and must not report success
from a `{ok:false}` result.

### 6.3 The second half of the Web's approve: who tells the model

The Web route steers the captain with `stagedPlanApprovedContext(team.name)`
(`…/lib/index.js:375-381`) because **the browser** receives the HTTP result. The TUI already runs
inside the captain session, so the equivalent control fact is the tool's own result, which the
adapter returns to the TUI as `{ok:true, value:{status,team_id,members,tasks}}` and which the scene
renders.

**NOT-CLAIMED #T3 (frozen):** this contract does NOT claim that the captain model receives an
automatic turn from a TUI approval. If t3's live lane measures that the captain does not react, that
is an implementation finding for t4/t5, and the honest remedy is a separately-scoped adapter seam
(a message-injection surface over `DshLiveAgent`) — NOT a hand-rolled runtime call in the TUI.

### 6.4 Verification that the mutation is REAL

Because the record is the truth source, t3 asserts the approval by the RECORD, not by the pane text:
`phase` flips `staged → running` and `approvedAt` appears in `.mpd/team/<id>/team.json`. That is a
real tool effect from a real key sequence.

---

## 7. NOT-CLAIMED (nothing here is a working feature)

1. **No parity claim, functional only.** The Web panel is a browser React component; the TUI
   surfaces are terminal text rows. Equal *facts* are claimed; equal layout, styling, animation,
   dragging, resizing, panel geometry (`…/lib/client.js` `panel-geometry.js`) and localization are
   NOT claimed.
2. **No inline plan EDITING in the TUI (frozen).** The Web can edit a staged member's provider/model
   and a task's subject/assignee/dependencies before approving (`update_member`, `update_task`,
   `add_task`, `remove_task` — `…/lib/client.js` action literals; `…/lib/index.js:405-475`). The TUI
   surfaces are READ-ONLY: they show the plan and let the user approve, discard, or leave for chat.
   The reason is stated in-surface (§4.4). Consequence to record in the ledger: a TUI user cannot
   fix a typo in a task subject without asking the captain.
3. **No "continue with a reason" call.** The Web's `continue` (`…/lib/index.js:391`) has no tool
   surface (no `agent_teams_*` tool is registered for it, `lib/tool-names.js:2-13`), and the TUI
   does not add one (§4.4).
4. **The captain model's reaction to a TUI approval is not claimed** (§6.3).
5. **No real keystroke drive in the automated sweep.** The TUI boots only on a real TTY
   (`docs/tui.md:45-47`), so the approval keystrokes are exercised in the tmux lane, which is
   excluded from `bun run test:qa` (`docs/tui.md:458-461`, NOT-CLAIMED #7 there). The pane text
   proves RENDERING; the record flip proves the ACTION.
6. **No new host seam is invented.** If `tuiScenes`/`tuiDialogs` are absent, both surfaces degrade
   to the existing "no DSH-TUI service is composed" log line (`index.ts:321-325`) and `/mpd team`
   answers the existing command error — no surface is claimed as available in a web composition.
7. **No writing of team state, ever.** The TUI package adds no write primitive; the adoption is by
   tool call only.
8. **`mpdWatchdog` absent** → the hold row is simply omitted (never rendered as "not held") —
   the same degrade rule the status line already uses (`watchdog.ts:31-39`).
9. **`alt+t`** (§5.3) is best-effort and may be refused; `/mpd team` is the guaranteed entry point.

---

## 8. The parity ledger schema (frozen for t5)

t5 produces `docs/tui-parity.md` + `docs/tui-parity.zh-CN.md` (bilingual, language switch links,
`bun run verify:docs` PASS). The ledger is ONE table with EXACTLY these columns, one row per Web
surface:

| Column | Value contract |
|---|---|
| `web_surface` | the Web surface's identity, e.g. `activity-panel/plan-approval` |
| `web_evidence` | `file:line` (or route path) in `packages/mpd-agent-teams-plugin/**` |
| `tui_status` | exactly one of `present` \| `absent` \| `not-applicable` |
| `tui_surface` | the TUI scene id + the key that reaches it (e.g. `mpd-tui-plan via Ctrl+X`), or `—` |
| `tui_evidence` | evidence path under `evidence/tui/…` proving the row, or `—` |
| `reason` | for `absent`/`not-applicable`: the frozen NOT-CLAIMED id or the measured cause. NEVER empty |

Mandatory rows (the enumeration is part of the contract — an omitted row is a defect):

| # | `web_surface` | Expected TUI disposition |
|---|---|---|
| 1 | `activity-panel/team-header` (id/name/phase) | present (§3.1 item 1) |
| 2 | `activity-panel/plan-review-state` | present (§3.1 item 1) |
| 3 | `activity-panel/roster` (per-member status/model/progress/currentTask) | present (§3.1 item 3) |
| 4 | `activity-panel/task-dag` (id/kind/status/assignee/attempt/round/verdict/deps/depth) | present (§3.1 item 4) |
| 5 | `activity-panel/failed-dependency marking` | present (§3.1 item 4, `failed-dep=`) |
| 6 | `activity-panel/message-count + captain inbox tail` | present (§3.1 item 6) |
| 7 | `activity-panel/halted flag` | absent — reason: the TUI reports the watchdog HOLD instead (§3.1 item 2); the two facts are different (`…/lib/snapshot.js:94` vs `watchdog.ts:31-39`) |
| 8 | `activity-panel/plan-approval` (approve) | present (§4.2, Ctrl+X) |
| 9 | `activity-panel/plan-discard` (two-step) | present with reduced semantics (§4.3, Ctrl+D ×2; no captain inject/cancel) |
| 10 | `activity-panel/plan-continue` (request changes) | absent — reason NOT-CLAIMED #3 / §4.4 |
| 11 | `activity-panel/plan-member-editor` | absent — NOT-CLAIMED #2 |
| 12 | `activity-panel/plan-task-editor` | absent — NOT-CLAIMED #2 |
| 13 | `activity-panel/plan-add-task` | absent — NOT-CLAIMED #2 |
| 14 | `activity-panel/plan-remove-task` | absent — NOT-CLAIMED #2 |
| 15 | `activity-panel/merge-autonomous-plan` | absent — approved-only in the TUI; reason NOT-CLAIMED #2 |
| 16 | `activity-panel/archived-teams view (?archived=1)` | absent — reason: the TUI reads the live state root only; archived teams are not projected (`…/lib/index.js:262-265`) |
| 17 | `activity-panel/panel-geometry + drag/resize` | not-applicable — a terminal scene has no floating geometry |
| 18 | `activity-panel/localization (t())` | not-applicable — the injected `tuiCommandTrees` carries `descriptions.zh` (§5.1); scene text is English-only like every other TUI surface |
| 19 | `activity-panel/member-artwork (assets route)` | not-applicable — terminal scenes render text |
| 20 | `plan-route HTTP semantics (405/409/404, no-store)` | not-applicable — the TUI does not go over HTTP; the equivalent refusals are the in-scene error lines (§4.5) + the unattached-captain refusal (§6.2) |

A row whose TUI side is missing MUST keep `absent` + a reason; dropping the row is a t3/t4 finding.

---

## 9. Implementation notes t2 must follow (not optional)

1. New files: `packages/mpd-tui-plugin/src/team-state.ts` (pure projection + the phrase builder),
   the two scene components + `registerScene` additions in `scenes.ts`, the command/picker/tree
   additions in `commands.ts` / `command-trees.ts` / `index.ts`, and the `boardLines` extra rows in
   `state.ts`.
2. Extend `packages/mpd-dsh-adapter-plugin/src/index.ts` (`executeTool` + `toolRuntime().execute`
   gain the optional `agent`) and REBUILD BOTH dists:
   `bun build packages/mpd-tui-plugin/src/index.ts --target node --format esm --outfile packages/mpd-tui-plugin/dist/index.js`
   and the same for `packages/mpd-dsh-adapter-plugin`. A stale dist is invisible in source review
   and fatal in a real boot (AGENTS.md §8: a `link:` install reads the checkout's `dist/`).
3. No `any` in new code except the host structural types the package already models this way
   (`types.ts:100-116`); no new npm dependency; no React import in `scenes.ts`.
4. Every scene text row goes through `scalarText` (`sanitize.ts`); the tool error text is sanitized
   before it is rendered (a tool error can echo model-authored content).
5. The two surfaces must appear in the package's own test suite (`packages/mpd-tui-plugin/test/`,
   bun:test) with a host double in the style of `plugin.test.ts:35-60`: assert the scene ids are
   registered, that the phrase gate is inert on a mismatch, that a refused tool result is rendered
   as a refusal, and that no write primitive is imported.
6. Evidence dir for the wave: `evidence/tui/team-surface/` (t2), `evidence/tui/team-surface-integrate/`
   (t5). The contract itself (this file) already exists.

## 10. Acceptance mapping (what a reviewer checks against the task's own criteria)

| t1 acceptance criterion | Where this file satisfies it |
|---|---|
| names the exact surfaces (panel ids, what each renders, how it is opened) and the approval flow step by step, with `file:line` citations for every Web claim | §3 (T1/T2/T3 with ids + rendering + openers), §4 (flow), §2 (every claim cited) |
| the approve path is pinned to a sanctioned seam or says loudly why not, with evidence | §6.1 (`agent_teams_approve` through the adapter), §6.2 (the measured adapter gap + the frozen extension + the loud refusal case), §6.3 |
| an explicit NOT-CLAIMED list (incl. real keystroke drive) and the parity-ledger schema (one row per Web surface: present/absent/not-applicable + reason) | §7 (9 items) and §8 (20 mandatory rows + column contract) |
| a Plan Reviewer can accept or reject it without asking a question — no undefined term, no `TBD`, no unmeasurable acceptance criterion | every open decision is fixed to one value (§3–§6); the only uncertainty is recorded as an explicit measurement obligation (§6.3, §7.5), not as an open term |

---

## AMENDMENT A1 — captain ruling, 2026-09-16 (resolves t2's finding F1)

§3.2 froze both "`r` re-reads" and "printable characters are appended to the echo", which is
self-contradictory because the required phrase `approve <teamId>` itself contains `r`. The captain
rules the coherent reading into force, exactly as t2 implemented it: **`r` re-reads only while the
echo line is EMPTY** (precisely the state barrier 3 describes), **`Ctrl+R` re-reads unconditionally**,
and **once typing has started every printable key is echo input**. No barrier is weakened: the
phrase gate, the empty-echo start, the `Ctrl+X`-only chord, single-flight and the two-inside-10 s
discard arm all stand unchanged. t4 reviews against THIS text.
