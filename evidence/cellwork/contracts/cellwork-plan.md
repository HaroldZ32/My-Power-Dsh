# cell-work (v1) — implementation plan

Status: ACTIVE (requirements conference closed 2026-10-26)
Owner: captain (top-level `mpd` session)
Branch: `feature/cellwork` → PR against `dev`
Companion evidence: `evidence/cellwork/capability-spike/2026-10-26T07-30-00Z/`

cell-work is a **command-triggered mode**. Nothing in the bundle starts it except the `/cellwork`
command; every other surface (tools, events, presets) is inert until that command runs.

---

## 1. The seven user clauses → binding obligations

| # | User clause (translated) | Design obligation | Home |
|---|---|---|---|
| 1 | The captain only dispatches centrally, it may do nothing else | A mode-scoped tool guard denies every capability except cell dispatch, relay, memory and stop. No file mutation, no shell, no recon, no verification by the captain | §4.7 `installCellworkGuard` |
| 2 | A dedicated planning agent owns the Socratic requirements conversation; later requirement changes go to the same agent; its questions surface on the main page and the captain at most relays | The planner is a real, durable teammate (`cell-planner`) with the Socratic protocol in its prompt. It reaches the user only through mail → captain → `ask_user_question` → mail. The captain is a relay, never an author | §4.4 phases 1–2 |
| 3 | Once requirements are settled, summarise them into a document and hand it to a requirement splitter; split tasks very fine, each estimated at ≤ 1/4 of the executing model's context, computed programmatically from real data before running; on a requirement change the planner revises and the splitter re-splits and re-dispatches | `requirements.md` is a validated document. The splitter agent proposes the graph; the PLUGIN computes per-task estimates from measured bytes and the model's own window, and refuses over-budget tasks with a breakdown. Re-split marks the old split stale and adds work through the live team record | §4.5, §4.10 |
| 4 | Build the team, spread tasks across agents; after each unit of work every agent leaves a handoff document and compresses its context (a temporary per-agent memory system) | Every work task ends in a validated handoff doc under the cell directory, then a compaction of that agent's own history | §4.6 |
| 5 | During a task, when context use exceeds 1/2: stop work, write the handoff, compress, then become a subcaptain that builds and dispatches a next-level team under the same rules; multi-level | A host-plane pre-step checkpoint injects at the step boundary, a guard forbids all tools but `cellwork_handoff`, then compaction → promotion → sub-team, depth-capped at 3 and recorded | §4.6, §4.11 |
| 6 | Keep MPD's law: the writer and the verifier cannot be the same agent; the verifier reads the contract and docs, not the implementation | Every code-producing task gets a paired verification task owned by a DIFFERENT agent, its own frozen contract document, and a verify loop opened before dispatch | §4.8 |
| 7 | Every agent may talk to the others through mail, bypassing the user interface and the captain | Intra-team mail is the existing `agent_teams_mail`; cross-cell and member↔captain mail is `cellwork_send`, addressed by cell name and delivered through the harness transport, journaled | §4.9 |
| 8 | **(added 2026-10-26)** the planner may call secondary READ-ONLY agents for the early reconnaissance, because the mode targets larger projects | `cellwork_recon` spawns a one-shot read-only consult (Explorer/Researcher) through the direct start path, labelled with the role name so the child-persona seam applies the READONLY_DENY list mechanically, with an explicit `maxDepth` so the consult is a leaf | §4.12 |

## 2. Locked decisions (requirements conference, user-answered)

1. **Compression**: compact in place with the agent's own engine; on `null`/failure, fall back to
   retire + reseed from the handoff. Same agent is promoted to subcaptain when compaction succeeds.
2. **Depth**: 3 levels by default, proven by a boot-level capability probe; if the probe fails the
   feature degrades honestly to single level and says so (no pretended nesting).
3. **Trigger**: only the command name `cellwork` (i.e. `/cellwork`). No alias, no event gesture, no
   tool that starts the mode.
4. **Verification**: one independent verification task per code task.
5. **Rule 6 meaning**: the existing MPD law — verifier works from the frozen contract and the
   documentation, never from the implementation.
6. **Scope**: ship to PR-ready (implementation + tests + QA evidence + bilingual docs + gates + PR).
7. **Context window is READ FROM THE MODEL, never a literal** (user, 2026-10-26): runtime threshold
   uses the live token-meter projection's `contextWindow`; split-time budget uses the model catalog's
   resolved `context.window`; provenance is recorded (`observed` / `catalog` / `override`); a route
   with no readable window makes its tasks `uncertified` rather than silently budgeted with a guess.

## 3. Capability facts this plan rests on

| Fact | Evidence | Confidence | Consequence |
|---|---|---|---|
| F1 `startActivation` takes an absolute `request.maxDepth`; `spawn-in-process` declares `depthLimit: true`; the service default (1) is consulted only by the `subagent` tool | harness 0.2.1-rc.3 `dsh-subagent/lib/index.js`, `dsh-subagent-spawn-in-process/lib/index.js`, `dsh-tool-subagent/lib/index.js` | high | cellwork spawns subcaptains through the adapter's direct start path with an explicit `maxDepth = depthCap`, never through the `subagent` tool |
| F2 A host-plane row's `agent/pre-step` listener receives CHILD sessions (payload fuses the live agent) and can return `{kind:'enter', messages}` | `dsh-agent/lib/types/dispatch.js`, `dsh-scope/lib/index.js`, shipped host rows (`mpd-team-watchdog`) | high | the 1/2 checkpoint is injected at a step boundary, no polling needed for the trigger |
| F3 Live occupancy = `sessionProjections.stateOf(session,'contextPressure')` → `pressureTokens`/`projectedTokens`/`contextWindow`; reads take a Session object | `dsh-token-meter/lib/types/*`, `dsh-session-projection/lib/types/index.d.ts` | high | read through a new adapter seam with the child's `Session`; tolerate a missing `contextWindow` |
| F4 `dsh.guardTool(exec => string | undefined)` denies at dispatch; exec carries `name`, `arguments`, live `agent` | `dsh-tools/lib/index.js`, repo `installTeamDoorGuard` / `installDelegationGate` | high | the captain/verifier/checkpoint restriction is one pure predicate over tool name × session × mode |
| F5 A child's compaction engine is `agent.ctx.get('compaction')`; `compactNow(agent, signal)` is idle-only; `null` = no safe range; reseed = dispose + new activation | `dsh-compaction-basic`, repo `compactionEngineForAgent`, `evidence/omo-align/compact-hinge/result.json` | high | compaction runs after handoff at the turn boundary, with a real AbortSignal |
| F6 `mpdTeams` is read-only and the five `agent_teams_*` tools own all mutations; native executor is the default | repo `mpd-team-core-plugin` | high | cellwork drives the board through `dsh.executeTool` (inheriting every guard) and spawns through `dsh.teamExecutor()` |
| F7 Members can mail any member of their own team directly; the LEAD is not a member, so the roster does not address the captain | repo `mailbox-store.ts`, `team-lifecycle.ts` | medium-high | member↔member uses `agent_teams_mail`; member→captain uses `cellwork_send` (state-resolved id + harness transport) |
| F8 `llmCatalog()` currently drops `context.contextWindow` | `packages/mpd-dsh-adapter-plugin/src/index.ts` (`llmCatalog`) | high | Wave 1 must project the window and the model's max output tokens |
| F9 Existing defect: `mpd-team-compact` calls `compactNow(agent, undefined)`; the method's first statement is `signal.throwIfAborted()` | harness `dsh-compaction-basic/lib/index.js`, repo `mpd-team-compact-plugin/src/index.ts` | high | fix in Wave 1 so cellwork does not inherit a broken call pattern |

## 4. Architecture

### 4.1 Package and row

- New host-plane package `packages/mpd-cellwork-plugin` (`name: "mpd-cellwork"`).
- Row in `cordis.patch.yml` (host plane, inside an existing `insert:` block):
  `- id: mpd-cellwork` / `name: '@mpd-dsh/mpd/packages/mpd-cellwork-plugin/dist/index.js'` / `config: {}`.
- Mirrored in `scripts/install-profile.ts` (`rows[]`) and listed in `scripts/pack-mpd.ts`
  (`PLUGIN_PKGS`). Bilingual `README.md` + `README.zh-CN.md`.
- `inject = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_COMMANDS)`; every harness touch goes through
  `resolveDshAdapter(ctx)`.
- New adapter seams (Wave 1): `contextPressure(...)`, catalog window/maxTokens projection,
  `maxDepth` on the team spawn request. No second team store, no second mailbox store.

### 4.2 State (workspace-scoped, gitignored runtime)

`<ws>/.mpd/cellwork/<cellId>/`

| Path | Content |
|---|---|
| `state.json` | cell record: phase, captain session, depth, parent cell, team id, planner/splitter handles, members with mode, split revision, checkpoints, journal cursor |
| `journal.jsonl` | append-only transitions (phase, dispatch, checkpoint, compaction, promotion, refusal) |
| `requirements.md` | validated requirements document (revisioned; a change bumps the revision and marks the split stale) |
| `split/<rev>.json` | splitter proposal + the plugin's measured estimates and accept/refuse verdict |
| `contracts/<taskKey>.md` | the frozen acceptance contract handed to the verifier |
| `handoff/<member>-<n>.md` | handoff documents, one per checkpoint, structured and validated |

cell ids: `cell-<UTC instant>`; sub-cells record `parentCellId` and `depth`.

### 4.3 Tool surface

| Tool | Caller | Purpose |
|---|---|---|
| `cellwork_start` | captain | create the cell, stage+approve the planner team, dispatch the requirements task |
| `cellwork_status` | captain/member | phase, members, split revision, checkpoints, budget summary |
| `cellwork_context` | member | own live occupancy + the model window it was measured against + provenance |
| `cellwork_requirements` | planner | `finalize` or `update` the requirements doc; update marks the split stale |
| `cellwork_recon` | planner / subcaptain | one-shot READ-ONLY consult (Explorer/Researcher) through the direct start path: label = the role name (so the child-persona seam applies the READONLY_DENY list), explicit absolute `maxDepth` (so the consult is a leaf), report returned and journaled |
| `cellwork_split` | splitter | `submit` a graph; the plugin measures and accepts/refuses; `show` the last verdict |
| `cellwork_activate` | captain | materialise an accepted split on the live team record, open verify loops, dispatch |
| `cellwork_dispatch` | captain | one dispatch pass through the existing team board |
| `cellwork_supervise` | captain | sweep: pending checkpoints, compactions, promotions, stale splits, mail unread |
| `cellwork_handoff` | member | write + validate the handoff document; marks the checkpoint ready |
| `cellwork_subteam` | promoted subcaptain | register a sub-cell and enforce the depth cap; returns the sub-captain directive |
| `cellwork_send` | any cell agent | cell-aware addressing (member, captain, subcell) + transport + journal |
| `cellwork_inbox` | any cell agent | unread cell mail for the caller, with ack |
| `cellwork_stop` | captain | end the mode, archive the cell, restore the captain's tools |

`/cellwork <objective>` writes the cell record and submits an activation directive as the invoking
agent's own next turn (same seam as `/ulw`); an empty argument returns a usage error and starts
nothing. `/cellwork` never starts a turn by any other route.

### 4.4 Phases

1. **requirements** — `cellwork_start` stages and approves a one-member team (`cell-planner`), then
   dispatches the requirements task. The planner runs the Socratic protocol: it mails the captain a
   structured question envelope; the captain calls `ask_user_question` (surfacing on the main page)
   and mails the answers back. When the planner is satisfied it writes `requirements.md` and calls
   `cellwork_requirements {action:"finalize"}`.
2. **split** — the captain dispatches the splitter (`cell-splitter`). The splitter submits a graph:
   per task `{key, subject, description, kind, ownerRole, writeScopes, blockedBy, inputs[], verify}`.
   The plugin measures (§4.5), validates the graph (dependency answer, acyclic, write-scope ordering,
   verifier ≠ writer) and either accepts or refuses with a per-task breakdown that tells the splitter
   how much to cut. Accepted → the captain calls `cellwork_activate`.
3. **executing** — `cellwork_activate` adds the split's members and tasks to the live team record
   (persona text injected into each member prompt, because team members get no roster persona), opens
   one verify loop per code task with its frozen contract, then dispatches. The captain supervises on
   every wake-up (task completion, checkpoint, requirement change).
4. **re-split** — a user change goes to the planner; it revises `requirements.md` and calls `update`;
   the split is marked stale; the splitter re-submits; the captain re-activates through the live-record
   arms (add members/tasks, never recreate the team).
5. **stopped** — `cellwork_stop` archives the cell, clears the mode, restores the guard. Nothing is
   deleted; the handoffs and contracts stay as the record.

### 4.5 Context budget — read the model, then measure

Two different numbers, both READ, never literal:

- **Window** — runtime: `contextPressure.contextWindow` (observed by the token meter from
  `request/context`). Split time: `resolveModelInfo(provider, model).context.contextWindow` via the
  adapter's catalog projection. Provenance is stored on the verdict: `observed` | `catalog` |
  `override`. No readable window → the task is `uncertified` (not silently budgeted). A user override
  is the only way to certify such a route, and it is recorded as `override`.
- **Cost** — the plugin's conservative estimator, because the deployment ships no tokenizer and the
  harness's own 4-chars/token heuristic is documented as underpricing CJK and JSON:

```
estimate = fixedOverhead[provider/model]                 # config, seeded from a measured session (28,544 tokens), default 32,000
         + ceil(asciiChars / asciiCharsPerToken)         # default 3
         + ceil(cjkChars   / cjkCharsPerToken)           # default 1
         + 4 * contentBlocks + 4                         # harness structural overhead
         + measuredInputs                                # see below
         + ceil(toolSchemaChars / asciiCharsPerToken) + 4
         + outputReserveTokens                           # default 8,192, capped by the model's maxTokens when known

measuredInputs(task) = Σ over declared input paths:
      bytes = fs.stat(path).size
      cjkRatio sampled from the first 16 KiB of the file
      tokens = bytes * (1 - cjkRatio) / 3 + bytes * cjkRatio / 3   # UTF-8 CJK ≈ 3 bytes/char, 1 token/char
             + 4 per file (framing)

budget  = floor(window * windowFraction)                 # windowFraction default 0.25
ACCEPT iff estimate <= budget
        AND estimate + modelMaxTokens + compactionHeadroom <= window   # harness compaction default headroom 65,536
```

The measured inputs are the "grab real data, compute in the program" half of clause 3: the splitter
declares which files/artifacts a task needs and the plugin stats them; a task that declares a 2 MB
file is refused with `file X = 2,097,152 bytes ≈ 349,525 tokens > budget 250,000` instead of a
hand-wave. Every constant is a ratio knob in config; the window is not a knob.

Runtime threshold: `contextPressure` ratio ≥ `checkpointRatio` (default 0.5) of the same window. The
runtime ratio uses the observed window, so a future model with a larger window raises the trigger
automatically — no configuration change, no code change.

### 4.6 Checkpoint → handoff → compaction → subcaptain

1. **Detect** — the host-plane row's `agent/pre-step` listener resolves `payload.agent`, reads
   `contextPressure`, and if the session is an active cell member at ≥ `checkpointRatio`, records
   `checkpoint injected` and returns an `enter` decision carrying one extra message:
   `[mpd-cellwork] CONTEXT CHECKPOINT … stop work, call cellwork_handoff, end your turn`.
2. **Mechanically stop** — the same guard flips that session's mode to `checkpoint`, which denies
   every tool except `cellwork_handoff`, `cellwork_context` and `cellwork_status`. The agent cannot
   keep working even if it ignores the prose.
3. **Handoff** — `cellwork_handoff` validates sections (task, state, decisions, artifacts, verified
   facts, open questions, next step), writes `handoff/<member>-<n>.md`, journals it, marks
   `handoff-ready`. The directive tells the agent to end its turn and do nothing else.
4. **Compress** — on `agent/turn-stopping` the plugin schedules a barrier that waits for the agent to
   be idle (bounded retries), then calls `compactionEngineForAgent(sessionId).compactNow(agent,
   signal)` with a REAL `AbortController` signal. `null` / `busy` / error is classified and journaled.
5. **Promote or reseed** — success: mode becomes `subcaptain`, and the plugin sends the promotion
   directive (depth+1, the remaining scope from the handoff, the sub-team protocol). No safe range or
   failure: the activation is disposed and a fresh child is started with the handoff text as its
   prompt, seeded with the same promotion directive.
6. **Sub-team** — the promoted agent calls `agent_teams_plan` (it is the lead of its own plan) and
   `cellwork_subteam` to register the sub-cell; the plugin refuses depth > 3 and records the link.
   The sub-team runs the exact same phases and rules; the supervisor sweeps the whole cell tree.

The captain is not a member and is never checkpointed in v1 (declared bound).

### 4.7 Captain guard (dispatch only)

`installCellworkGuard(dsh)` installs one `dsh.guardTool` predicate:

- Resolve the caller's session id (`agent.session.id`) and look it up in the active cell tree.
- No cell for that session → allow (zero cost when the mode is off).
- Session is the **captain** → allow only `cellwork_*` (except `cellwork_handoff`),
  `agent_teams_*`, `ask_user_question`, `todo_write`, `mpd_memory_*`; deny everything else with one
  teaching paragraph naming the allowed surface and `/cellwork`'s contract.
- Session is a **verifier** → deny `write`, `edit`, `mpd_hashline_edit`,
  `mcp__ast_grep__rewrite/scan`, `mcp__lsp__rename_symbol*`; allow read/grep/glob, bash (gates) and
  `mpd_verify_*`.
- Session is a **member in checkpoint** → deny every tool except `cellwork_handoff`,
  `cellwork_context`, `cellwork_status`.
- Session is a **subcaptain** → the dispatcher allowlist, plus its own normal work tools.

Declared bounds (README): the guard is process-wide, fires at dispatch only, cannot see intent, and
does not cover a row calling a service directly. `cellwork_stop` restores everything.

### 4.8 Verification wiring

- Every split task with `verify: true` (all code-producing tasks) gets a `kind:"review"` task
  `blocked_by` its work task, owned by a different member; the plugin refuses a split where the
  planned verifier equals the writer.
- On activation the plugin writes `contracts/<taskKey>.md` (acceptance criteria, allowed paths, the
  gate commands, the docs the verifier may cite) and opens a loop with
  `mpd_verify_open {writer:"delegate", contract, scope}`. The verifier task instructs
  `mpd_verify_seat` → run the gates → `mpd_verify_record` with `sources` + `evidence_ids`.
- A recorded FAIL creates a `kind:"repair"` task (`sourceTaskId` = the work task) and the captain
  re-dispatches. Blindness stays PROSE, exactly as the repository states; cellwork does not pretend to
  observe it.

### 4.9 Mail

- Intra-team: the existing `agent_teams_mail` (member ↔ member, no captain in the path).
- Member ↔ captain and cross-cell: `cellwork_send`, which resolves the recipient by name in the cell
  tree, delivers through the harness transport (executor send / parent send), and journals the
  message in `<ws>/.mpd/team/mailbox.jsonl` with a `cell:<cellId>` stamp. A transport failure leaves
  the row undelivered and the captain sees it on `cellwork_supervise` — mail is durable, wake-up is
  best-effort. `cellwork_inbox` reads and acks.

### 4.10 Re-split

`cellwork_requirements {action:"update"}` bumps the requirements revision and marks the split stale.
The splitter re-submits; `cellwork_activate` with a stale-but-accepted new revision uses the
LIVE-record arms (`agent_teams_plan add_member` / `create_task`) so the team keeps running and only
new/changed work is added. Removed work is marked `cancelled`; nothing is deleted.

### 4.11 Depth fence

`cellwork_subteam` refuses when `depth + 1 > cellwork.depth.max` (default 3) and returns the exact
bound. Spawning uses the adapter's direct start path with `request.maxDepth = cellwork.depth.max`
(F1), so the harness cap and the cell cap agree. A boot-level probe proves a depth-1 member can raise
a depth-2 child; if the probe fails the feature ships single-level and the README says so.

### 4.12 Planner reconnaissance (user requirement, added 2026-10-26)

The planner — and a promoted subcaptain — may delegate the early reconnaissance to a one-shot
READ-ONLY child, because the mode targets large projects where the planning agent cannot read the
tree itself.

- Spawned through the adapter's DIRECT start path with `label` exactly the read-only roster name
  (`Explorer` or `Researcher`). That label is what `installChildPersonaSeam` resolves, so the child
  receives the roster persona AND the exported `READONLY_DENY` list mechanically, not merely by prose.
- The spawn passes an explicit absolute `request.maxDepth = cellwork.depth.max`, so a consult is a
  leaf at caller depth + 1 and can never outgrow the cell cap.
- The persona TEXT is also injected into the consult prompt: a composition without the child-persona
  seam still behaves (the deny list is then prose — a declared bound).
- One consult per call: the report is the tool result and is journaled in the cell; the planner may
  call it repeatedly. No long-lived read-only member and no extra board task.
- Only the planner and a promoted subcaptain may call it; the captain's dispatch-only allowlist does
  not include it, and a stopped cell refuses it.

Why a cellwork tool instead of `mpd_role_spawn`: the roster spawn path does not pass an explicit
`maxDepth`, so a depth-1 planner's child would hit the service default 1 and be refused
(`SubagentDepthError`). `cellwork_recon` is the only path that both raises the consult and keeps the
depth cap honest.

### 4.13 Nested DAG groups for subcells (user requirement, added 2026-10-26)

Requirement: a subcell (secondary agent cluster) renders as a BOX; the box interior is that subcell's
own normal DAG; dependencies from outside attach to the box; nesting repeats recursively.

Recon facts (2026-10-26): one SHARED FLAT model — `GraphModel = {nodes, edges, ranks, cycles, report}`
in `packages/mpd-graph-core`, with NO group/cluster/subgraph concept; both renderers are AUTHORED in
this repository — the TUI draws node boxes as GLYPHS in one character grid (`mpd-tui-plugin/src/graph.ts`
`drawBoxes`, `RANK_STRIDE 6`, 4-bit mask through `DAG_CHARS`), and the web DAG is
`mpd-bundle-plugin/src/team-view.ts`, a factory body spliced into the committed `client.js` by
`node scripts/build-mpd-client.ts`. The web client rebuild is NOT covered by `verify-dist-fresh`.
`scripts/verify-graph-model.ts` holds an independent model oracle.

Design — ONE group concept, never a parallel notion:

- **Model** (`mpd-graph-core`): additive `GraphModel.groups?: GraphGroup[]` with
  `GraphGroup = {id, label, parentId: string | null, memberIds: string[], depth, originTaskId?}` and an
  optional `group?: string` (innermost) on nodes. Plain JSON, byte-deterministic. **Attachment rule**:
  an edge with one endpoint inside group G and the other outside is re-anchored to G's frame (the
  innermost group containing the inside endpoint); an edge fully inside stays inside; an edge between
  two groups becomes group→group; the group's spawn edge (from `originTaskId`) is derived, not authored.
- **Source of truth**: additive `TeamRecord.parentTeamId?`; a promoted subcaptain stages its sub-team
  with `agent_teams_plan create {parent_team_id}` (cellwork does this through `dsh.executeTool`).
  `mpdTeams.graph(workspace, teamId)` merges descendant teams as groups (each child team's board is the
  group interior), recursively to the depth cap.
- **Ranking**: the outer model ranks GROUP PSEUDO-NODES (one per child team) so external columns stay
  correct; each group interior is ranked independently. Determinism preserved.
- **TUI**: a second glyph border family in `dag-theme.ts` (visually distinct from node borders, still
  one cell per glyph), a group rectangle spanning the interior's rows in `graph.ts`, a `groupId` hit
  identity, and a "never draw half a group" rule in `panel-dag.ts`.
- **Web**: a `.mpd-dag-group` frame in `team-view.ts`, recursive geometry kept in ONE pixel canvas so
  `overlapAudit` and the no-run-crosses-a-box proofs survive; ports on the group frame; explicit
  z-order (SVG edge layer < group frames < nodes); rebuild the client with the script and test the
  BUILT artifact.
- **Gate**: `scripts/verify-graph-model.ts` gains a group arm and a seeded negative.
- **Bounds**: the TUI stays a character grid (no host `ui.Box` per group); a group that cannot fit the
  current width degrades to the existing rail/list mode with the group COLLAPSED, never half-drawn.

## 5. Waves and tasks

Every code task is verified by a DIFFERENT agent through the verify plane; the integration (dist
fan-out, full gate sweep, commit, PR) is the captain's own work and is not a board task.

### Wave 1 — adapter seams + adjacent defect

| Task | Kind | Owner (persona) | Write scopes | Dep |
|---|---|---|---|---|
| W1-T1 context seam, catalog window, maxDepth passthrough | work | adapter-engineer (Senior Engineer) | `packages/mpd-dsh-adapter-plugin/src/**`, `packages/mpd-dsh-adapter-plugin/test/**` | root |
| W1-T2 real AbortSignal in team-compact | work | compact-engineer (Senior Engineer) | `packages/mpd-team-compact-plugin/src/**`, `packages/mpd-team-compact-plugin/test/**` | root |
| W1-T3 verify W1-T1 | review | wave1-verifier (Reviewer) | none (read + gates) | W1-T1, W1-T5 |
| W1-T4 verify W1-T2 | review | wave1-verifier (Reviewer) | none | W1-T2, W1-T6 |
| W1-T5 adapter README pair: context pressure, catalog window, maxDepth semantics | work | adapter-engineer (Senior Engineer) | `packages/mpd-dsh-adapter-plugin/README.md`, `README.zh-CN.md` | W1-T1 |
| W1-T6 compact README pair: real AbortSignal + abort classification | work | compact-engineer (Senior Engineer) | `packages/mpd-team-compact-plugin/README.md`, `README.zh-CN.md` | W1-T2 |
| W1-T7 TUI panel test: host-drift compatibility (adjacent, declared) | work | compact-engineer (Senior Engineer) | `packages/mpd-tui-plugin/test/panel-visibility.test.ts` | root |
| W1-T8 verify A5 (TUI host-drift compat) | review | wave1-verifier (Reviewer) | none | W1-T7 |

**Wave 1 addendum (2026-10-26T07:50Z, found by the verifier before any verdict):** the frozen contract
makes each package README a required citation, but the original Wave-1 table gave nobody the README
edits. The gap is closed by W1-T5/W1-T6 (bilingual pairs, same heading tree, switch link under the
title) and by re-pointing the review tasks at them, so a PASS can legitimately cite the README the same
wave produced. A verifier that finds a document gap before verdict is behaving correctly: it must not
record a FAIL for work nobody was assigned.

Acceptance: unit tests for the ratio computation against an injected window (e.g. 123,456 → budget
30,864), a missing-window case that reports `uncertified` instead of guessing, a maxDepth forwarding
test, and a compactNow-signal test that fails on the old `undefined`. Dist fan-out is rebuilt by the
captain at integration.

### Wave 2 — cellwork core

| Task | Kind | Owner | Write scopes | Dep |
|---|---|---|---|---|
| W2-T1 package skeleton, config, state store, command, guard, start/status/stop | work | core-engineer (Deep Worker) | `packages/mpd-cellwork-plugin/src/**` (new), `package.json` | W1-T1 |
| W2-T2 requirements + splitter + estimator + activate (team materialisation) + planner recon | work | split-engineer (Senior Engineer) | `packages/mpd-cellwork-plugin/src/**` | W2-T1 |
| W2-T3 dispatch, checkpoint, handoff, compaction, promotion, subteam, mail | work | protocol-engineer (Deep Worker) | `packages/mpd-cellwork-plugin/src/**` | W2-T2 |
| W2-T4 verify W2-T1 | review | w2-verifier (Reviewer) | none | W2-T1 |
| W2-T5 verify W2-T2 | review | w2-verifier (Reviewer) | none | W2-T2 |
| W2-T6 verify W2-T3 | review | w2-verifier (Reviewer) | none | W2-T3 |

Acceptance: offline tests with a mock ctx prove the command surface, the guard decisions per mode,
the estimator arithmetic with a read (injected) window, split refusal with a measured breakdown, and
live-record re-split; a mounted boot proves registration and a real `/cellwork` dispatch.

### Wave 3 — re-split, QA case, docs

| Task | Kind | Owner | Write scopes | Dep |
|---|---|---|---|---|
| W3-T1 re-split path + live-record additions + stale handling | work | split-engineer | `packages/mpd-cellwork-plugin/src/**` | W2-T3 |
| W3-T2 QA case (`cellwork-command`) + `--self-test` + SKILL.md row | work | qa-engineer (Senior Engineer) | `skills/dsh-qa/**` | W2-T3 |
| W3-T3 bilingual package README, `docs/cellwork.md` + `zh-CN`, user-guide pointer, CHANGELOG | work | docs-engineer (Deep Worker) | `docs/**`, `packages/mpd-cellwork-plugin/README*`, `CHANGELOG.md` | W2-T3 |
| W3-T4 verify W3-T1 / T2 / T3 | review | w3-verifier (Reviewer) | none | each |

### Wave 4 — nested DAG groups (user requirement, added 2026-10-26)

| Task | Kind | Owner | Write scopes | Dep |
|---|---|---|---|---|
| W4-T1 graph-core: `GraphGroup` model + per-level ranking + gate-oracle arm + README pair | work | graph-engineer (Deep Worker) | `packages/mpd-graph-core/src/**`, `test/**`, `README*`, `scripts/verify-graph-model.ts` | root |
| W4-T2 team-core: `parentTeamId`, descendant-team merge projection, `/state` model, tests | work | team-engineer (Senior Engineer) | `packages/mpd-team-core-plugin/src/**`, `test/**` | W4-T1 |
| W4-T3 TUI: group frame glyphs, group hit identity, never-half-a-group, tests | work | tui-engineer (Senior Engineer) | `packages/mpd-tui-plugin/src/**`, `test/**` | W4-T1 |
| W4-T4 web: `.mpd-dag-group` frame, recursive geometry, z-order, client rebuild + built-artifact test | work | web-engineer (Senior Engineer) | `packages/mpd-bundle-plugin/src/**`, `test/**`, `client.js` | W4-T1 |
| W4-T5 cellwork: pass `parent_team_id` when a promoted subcaptain stages its sub-team | work | split-engineer (Senior Engineer) | `packages/mpd-cellwork-plugin/src/**` | W3-T1, W4-T2 |
| W4-T6..T10 verify each work task | review | w4-verifier (Reviewer) | none | each |
| W4-T11 docs: `docs/tui-dag-renderer.md` + zh pair, `docs/cellwork.md` group section | work | docs-engineer (Deep Worker) | `docs/**` | W4-T3, W4-T4 |

Acceptance: a synthetic three-level fixture produces a deterministic model with groups; the outer rank
treats each child team as a pseudo-node; an external edge re-anchors to the group frame; the TUI draws a
distinct frame and never half a group; the web renders `.mpd-dag-group` in ONE pixel canvas with
`overlapAudit` and the no-run-crosses-a-box proofs intact, and the BUILT `client.js` carries the change;
`verify-graph-model` has a group arm and a seeded negative; README pairs green.

### Wave 5 — integration (captain)

Row + installer + `PLUGIN_PKGS` (W2-T1 covers them), pinned-toolchain rebuild of every dependent
dist, then the full gate sweep with evidence: `verify:comments`, `verify-dist-fresh`, `verify:rows`,
`verify:manifest`, `verify:docs`, `verify-no-host-override`, `verify-pack-closure`,
`install-profile --dry-run`, `preset-conformance --self-test` + real run, `bun test packages`,
`bun run typecheck`, `bun run test:qa`, the mount boot (`bundle-lifecycle`) and the cellwork command
probe. Then the bilingual PR.

## 6. Risks and declared bounds

| Risk | Mitigation | Residual (declared) |
|---|---|---|
| maxDepth is real but the composed preset never sets it; a direct spawn could be refused by a future provider | boot-level probe in Wave 2; spawn through the adapter's direct path only | if the probe fails, ship single-level and say so |
| Team members get NO roster persona and NO read-only deny list (label `"<name> · <teamId>"` is unresolved) | inject the persona TEXT into each member's prompt; cellwork's own guard marks verifier mode | the prompt, not the harness, carries the discipline |
| Compaction may return `null` at 50% | fallback reseed path is implemented and tested | a reseeded agent loses in-session nuance; the handoff is the only continuity |
| The pre-step injection depends on the model obeying; a tool guard makes it mechanical | guard denies all work tools in checkpoint mode | a tool call already in flight completes |
| `contextPressure` lags one committed event and `contextWindow` is absent before the first request | read, then act; if absent, no checkpoint (never guess) | worst case the checkpoint fires one step later |
| Mail to the captain has no roster entry | `cellwork_send` resolves the captain's id from state; transport failure stays durable and is surfaced on supervise | wake-up is best-effort; the user-facing question is still asked by the captain |
| The guard is process-wide and blind to service-plane calls | allowed surface is an allowlist; README states the bound | a row bypassing `guardTool` is out of scope |
| `agent_teams_dispatch` falls back to roster order when the declared owner is not idle (AGENTS.md §5 rule 5), which can hand a REVIEW task to its own writer (measured this wave: T8 was paired to compact-engineer, the T7 writer) | cellwork's own dispatch pairs ONLY the declared owner and refuses otherwise; wave verification is sequenced manually by the captain | the team plane's fallback remains for non-review tasks; the writer/verifier law is enforced by cellwork's dispatch plus explicit sequencing |
| The estimator has no tokenizer | conservative ASCII/3 + CJK/1 pricing; declared ±25% English / punitive CJK | the 1/4 rule is a certified estimate, not a measurement; verdicts say `estimate` |

## 7. Verification and evidence

- Wave 1 evidence: `evidence/cellwork/adapter-seams/<ts>/`.
- Wave 2/3: `evidence/cellwork/cellwork-core/<ts>/`, `evidence/cellwork/qa/<ts>/`.
- Every verdict is recorded through `mpd_verify_record` by a different agent, from the frozen
  contract in `.mpd/plans/cellwork-w<N>-contract.md` plus the documentation band.
- The capability spike lives at `evidence/cellwork/capability-spike/2026-10-26T07-30-00Z/` with the
  five facts, their sources and their confidence.

## 8. Out of scope for v1

- Git commits/pushes from inside the mode (`cellwork_stop` ends the mode so the normal captain can
  land work; a narrow commit tool is a follow-up).
- Checkpointing the captain itself.
- A web/TUI cellwork panel (the existing team surfaces keep rendering the team).
- Any second team/mail store, or any direct `ctx.tools`/`ctx.subagents` access outside the adapter.
