# Cell-work mode (`/cellwork`)

**English** | [中文](./cellwork.zh-CN.md)

Cell-work is the **command-triggered, dispatch-only captain mode**. One session becomes a small
delivery organisation: a planner settles the requirements with you, a splitter cuts the work into
tasks priced against the executing model's own context window, workers execute each task under a
frozen acceptance contract, and a verifier that is never the writer judges that contract — while the
captain only dispatches, relays, records and stops.

Nothing in the bundle starts the mode except the `/cellwork` command: no tool, no event gesture, no
preset flag. Every other surface (tools, listeners, rows) is inert until the command runs and a cell
exists.

The package contract — every tool's exact behaviour, the guard table, the config knobs — is in the
[`mpd-cellwork-plugin` README](../packages/mpd-cellwork-plugin/README.md). This page is the
task-oriented account: how to drive the mode, what it measures, and what it does not promise.

## The single trigger

- `/cellwork <objective>` registers through the adapter as `cellwork` — no alias, no second spelling,
  and no substitution with another command name.
- The handler writes exactly ONE cell record — `<workspace>/.mpd/cellwork/cell-<UTC instant>/state.json`,
  phase `requirements`, carrying the captain's own session id — and then submits exactly ONE activation
  directive as the invoking agent's own next user turn (producer tag `mpd-cellwork`). The directive
  starts the requirements phase; the command does not drive the phases itself.
- An empty or whitespace-only objective returns a usage error and writes **no** cell state at all.
- A second `/cellwork` while a cell is active in the same workspace is REFUSED, and the refusal names
  the active cell id: one cell at a time, because two cells would fight over one team board. Stop the
  active cell with `cellwork_stop` before starting another.
- A composition with no live turn surface does not keep a half-started cell: the record the command
  just wrote is archived immediately with `stopReason: "no-live-turn-surface"`, and no session is
  fenced.

## The four phases

1. **requirements** — `cellwork_start` opens the active cell's requirements phase (it never creates a
   cell). The planner runs the Socratic protocol: it mails the captain a structured question envelope,
   the captain calls `ask_user_question` on the main page and mails the answers back, and the planner
   repeats until it is satisfied. It then writes `requirements.md` and calls
   `cellwork_requirements {action:"finalize"}`. The planner is the ONLY agent that shapes the
   requirements; the captain is a relay, never an author.
2. **split** — the splitter submits a graph through `cellwork_split {action:"submit"}`. The plugin
   validates it (every task declares its dependency answer, the graph is acyclic, write scopes are
   ordered, the planned verifier differs from the writer) and prices every task against the model
   budget; an accepted graph is the only input `cellwork_activate` accepts. A refusal returns a
   per-task breakdown that tells the splitter how much to cut.
3. **executing** — `cellwork_activate` adds the split's members and tasks to the live team record,
   writes one frozen contract per code task, opens one verify loop per code task **before** the
   dispatch pass, and dispatches. Members receive their persona text in the member prompt; the team
   itself provides no roster persona. The captain supervises on every wake-up.
4. **re-split** — `cellwork_requirements {action:"update"}` bumps the requirements revision and marks
   the split stale. The planner re-settles what changed, the splitter re-submits a revision, and
   `cellwork_activate` adds only the new or changed work to the SAME team: the team id and the cell id
   do not change, work the new revision drops is marked `cancelled` (never deleted), and the split
   task is re-dispatched rather than duplicated. Activating a stale split is REFUSED unless the caller
   names the revision explicitly.

### Re-split in detail

A revision is not a rewrite of the team; it is a delta applied to the live record:

- **Same-revision activation is REFUSED.** Activating the revision the cell already recorded is a no-op
  request and is refused outright; every submission must carry a revision GREATER than the recorded
  one, so revisions move forward only.
- **Kept rows are reused, and their contracts are NOT rewritten.** A task that survives the revision
  keeps its board row and the frozen contract its verify loop was opened with — the verifier still
  judges the acceptance criteria that were frozen before the work started.
- **Dropped rows are marked `cancelled`, never deleted.** They stay in the cell record as history, and
  dispatch skips them.
- **The splitter keeps a live row to re-dispatch on.** Activation closes the split task it consumed; a
  later requirements change opens a REPLACEMENT splitter row, so the split work is re-dispatched
  through the board rather than duplicated as a second split task.

The team id and the cell id do not change, so the cell's journal, mail and board stay one continuous
history.

## Tool surface

| Tool | Caller | What it does |
|---|---|---|
| (the `/cellwork` command) | you | writes the one cell record and submits the one activation directive |
| `cellwork_start` | captain | opens the requirements phase of the active cell; validates cell and caller, stamps `startedAt`, journals it |
| `cellwork_status` | captain, member | phase, objective, captain, requirements/split revisions, members and their modes, injected checkpoints, live team counts, the caller's own seat and the on-disk paths |
| `cellwork_requirements` | planner | `finalize` a requirements document, or `update` it — an update bumps the revision and marks the split stale |
| `cellwork_recon` | planner, subcaptain | one-shot READ-ONLY consult (Explorer/Researcher) raised through the direct start path with the role name as its label and an explicit absolute depth cap, so the consult is a read-only leaf; the report is returned and journaled |
| `cellwork_split` | splitter | `submit` a graph so the plugin can measure it, or `show` the last verdict |
| `cellwork_activate` | captain | materialise an accepted split on the live team record, write contracts, open verify loops, dispatch |
| `cellwork_dispatch` | captain | one owner-only dispatch pass over the team board |
| `cellwork_supervise` | captain | read-only sweep: pending checkpoints, compactions, promotions, stale splits, unread mail, and every UNDELIVERED mail row |
| `cellwork_context` | member | the caller's own live occupancy, the window it was measured against, and that window's provenance |
| `cellwork_handoff` | member | write and validate the checkpoint handoff document; marks the checkpoint ready |
| `cellwork_subteam` | promoted subcaptain | register a sub-cell, enforce the depth cap, return the sub-captain directive |
| `cellwork_send` | any cell agent | cell-aware addressing (member, captain, another sub-cell) plus transport delivery and a journal row |
| `cellwork_inbox` | any cell agent | read and acknowledge the caller's unread cell mail |
| `cellwork_stop` | captain | end the mode: archive the cell (no deletion), clear the guard, give the tools back; REFUSED while a board task is `claimed`/`in_progress` unless `force:true`, and a forced stop is journaled as such |

The one-call view for a bystander is `cellwork_status`; everything else either mutates the cell record
or returns a verdict about it.

## The four guard modes

ONE `tools.guard` predicate is installed per plugin. It resolves the calling session and looks it up
in the live cell tree: a session in no cell is untouched, which is what makes the mode free while it
is off. The predicate fires at **dispatch** time only.

| Caller | Allowed | Refused |
|---|---|---|
| captain | `cellwork_*` except `cellwork_handoff`, plus `agent_teams_*`, `ask_user_question`, `todo_write`, `mpd_memory_*` | everything else — no file edit, no shell, no `read`/`grep`/`glob`, no verification |
| verifier | `read`, `grep`, `glob`, `bash` (the gates), `mpd_verify_*` | `write`, `edit`, `mpd_hashline_edit`, `mcp__ast_grep__rewrite`, `mcp__ast_grep__scan`, `mcp__lsp__rename_symbol`, `mcp__lsp__rename_symbol_strict` |
| member at its context checkpoint | `cellwork_handoff`, `cellwork_context`, `cellwork_status` | everything else — the agent cannot keep working even if it ignores the prose |
| subcaptain | the captain allowlist MINUS `cellwork_start` / `cellwork_stop`, PLUS `cellwork_subteam`, `cellwork_activate`, `cellwork_dispatch`, `cellwork_supervise` | every file-work tool: a subcaptain is a mini-captain and dispatches, it does not implement |
| ordinary member | everything it needs to work | nothing — it is a normal worker |

Every refusal is ONE teaching paragraph: what was refused, the calls that replace it, and
`cellwork_stop` as the way out. Stopping the cell removes the seat, so the same session is unguarded
again.

## The context budget: measured, never guessed

The mode makes two different promises about context, and they use two different fractions:

- **Split time** — no task may be estimated at more than **1/4 of the window** it will run against
  (`windowFraction`, default `0.25`).
- **Runtime** — an active member at **1/2 of its OBSERVED window** (`checkpointRatio`, default `0.5`)
  is checkpointed at its next step boundary.

Neither fraction multiplies a literal: the **window itself is read**.

### The window is read from the model

- **At split time** the plugin asks the adapter's model catalog for the route's own window and output
  cap (`resolveModelInfo(provider, model).context.contextWindow` / `maxOutputTokens`), and records the
  provenance `catalog`.
- **At runtime** the pressure reading comes from the host's token meter (`contextPressure`), which
  reports the window the model actually declared in `request/context`; the provenance is `observed`.
- A route whose window cannot be read is **`uncertified`**, not silently budgeted with a guess. The
  only way to certify such a route is to set `windowOverride` deliberately, and every verdict then
  records the provenance `override`.

A larger model window therefore raises both the split budget and the checkpoint trigger with no code
change and no configuration change.

### The cost estimate and the acceptance rule

There is no tokenizer in the deployment, so the plugin computes a deliberately conservative estimate
from measured bytes and configurable ratios:

```text
estimate = fixedOverhead[route]                    # config, seeded from a measured 28,544-token
         + ceil(asciiChars  / asciiCharsPerToken)  # session; shipped default 32,000
         + ceil(cjkChars    / cjkCharsPerToken)    # ascii 3 chars/token, cjk 1 char/token
         + 4 * contentBlocks + 4                   # harness structural overhead
         + measuredInputs
         + ceil(toolSchemaChars / asciiCharsPerToken) + 4
         + outputReserveTokens                     # default 8,192, capped by the model's maxTokens

measuredInputs = Σ over the task's declared input paths
                 stat(path).size, CJK ratio sampled from the first 16 KiB
                 tokens = bytes * (1 - cjkRatio) / 3 + bytes * cjkRatio / 3 + 4

accept  iff  estimate <= floor(window * windowFraction)
        and  estimate + modelMaxTokens + compactionHeadroom <= window
```

The "grab real data, compute it in the program" rule is the second line: a task that declares a 2 MB
file is refused with the number in front of it — `file X = 2,097,152 bytes ≈ 699,051 tokens > budget
250,000` — instead of a hand-wave, and an accepted task is priced against files that were really
`stat`-ed.

The second acceptance clause keeps room for the model's maximum output plus the harness compaction
headroom (default 65,536 tokens), so an accepted task cannot force the harness into a compaction
mid-task by output alone.

### What the numbers are worth

The 1/4 rule is a **certified estimate, not a measurement**. Its declared error bound is **±25% for
English prose**; CJK is priced deliberately punitively (about three UTF-8 bytes per character at one
token per character) so that a Chinese-heavy task is cut smaller, never larger. Every split verdict
says `estimate`, and a route that cannot be read says `uncertified` rather than pretending.

## Checkpoint → handoff → compaction → promotion

A member that reaches the checkpoint ratio does not "try to be brief"; the mode takes its tools away
and hands the work to a successor. The sequence is mechanical:

1. **Detect** — the host-plane row's `agent/pre-step` listener resolves the calling agent, reads the
   context pressure, and for an active cell member at or above `checkpointRatio` records
   `checkpoint injected` and returns an `enter` decision carrying one extra message:
   `[mpd-cellwork] CONTEXT CHECKPOINT … stop work, call cellwork_handoff, end your turn`.
2. **Stop** — the same mode switch flips the session into `checkpoint`, and the guard refuses every
   tool except `cellwork_handoff`, `cellwork_context` and `cellwork_status`. Prose is the explanation;
   the guard is the enforcement.
3. **Handoff** — `cellwork_handoff` validates the required sections (task, state, decisions,
   artifacts, verified facts, open questions, next step), writes `handoff/<member>-<n>.md`, journals
   it and marks the checkpoint `handoff-ready`. The directive tells the agent to end its turn and do
   nothing else.
4. **Compact** — on `agent/turn-stopping` the plugin schedules a barrier that waits for the agent to be
   idle (`compactionRetries` bounded retries, `idleBarrierDelayMs` between them) and then calls the
   agent's own compaction engine with a real `AbortController` signal. The outcome is classified and
   journaled: a `null` result (no safe useful range), a `busy` agent and an `error` are all recorded,
   so a retry budget running out is never a silent no-op.
5. **Promote or reseed** — on a successful compaction the session's mode becomes `subcaptain` and it
   receives the promotion directive (depth + 1, the remaining scope taken from the handoff, the
   sub-team protocol). If there is no safe range, or compaction fails, the activation is disposed and
   a fresh child is started with the handoff text as its prompt plus the same promotion directive.
6. **Sub-team** — the promoted agent registers its sub-cell with `cellwork_subteam` and leads its own
   plan. `cellwork_subteam` refuses when `depth + 1 > depthMax` (default 3) and returns the exact
   bound; the direct start path passes the same depth as an absolute `maxDepth`, so the harness cap
   and the cell cap agree. Sub-teams run the identical phases and rules, and `cellwork_supervise`
   sweeps the whole cell tree.

The captain is not a member and is never checkpointed in v1.

## Nested DAG: subcells as group boxes

A promoted subcaptain raises a sub-team, and the shared graph draws that subcell as a BOX whose interior is
the subcell's own DAG. The rule lives in the model (`packages/mpd-graph-core`, whose README pair states it in
full); this section records what cellwork owes it and what a reader may expect to see.

- **One box per subcell.** The box is a node of the PARENT frame — its id is the sub-team's id, and its
  `dependencies` are the blockers attached to its border — while its interior holds the sub-team's own
  tasks, ranked as their own model.
- **External edges attach to the frame.** A dependency with one endpoint inside the box and the other
  outside is re-anchored to the box, where the box is the innermost frame containing the inside endpoint; a
  line therefore never escapes a box. An edge fully inside keeps its two tasks, an edge between two boxes
  becomes box→box, and the box's spawn edge is DERIVED from the task that raised the subcell rather than
  authored anywhere.
- **The recursion is the model's, not a second concept.** A subcell may hold subcells: each frame is ranked
  on its own and the nesting repeats to the depth cap above. Ids must be unique across the whole tree,
  because the id is the join key both renderers draw by — the team plane's own spelling for a reused task
  number is `<teamId>::<taskId>`.

**The seam is implicit derivation, and it has no argument to forget.** `cellwork_subteam` stamps the parent
cell's LIVE team id on the new cell as `CellState.parentTeamId` and journals `subcell-created` with it; the
sub-team itself is staged with NO `parent_team_id`. The team plane derives the link AT APPROVAL from the
parent team's own roster (`deriveParentTeam`), because the session that stages a sub-team is already a
member of the parent team — the record already knows. That is why the nesting cannot drift: there is no
second value to keep in sync. The same code refuses a parent that does not record the session as its Lead
or as a member, and refuses a `parentTeamId` chain that comes back to itself, so the projection
(`mpdTeams.graph(workspace, teamId)`) can follow `parentTeamId` into nested groups recursively without
risking a loop.

**Both delivered surfaces draw those boxes.** The TUI panel draws them in its character grid — a
second one-cell glyph family, a frame spanning its interior's rows, ports for arriving edges versus
crossings for passing ones, a group hit identity, and a collapse-not-half width guard
(`packages/mpd-tui-plugin/README.md`, "Nested groups: subcells as boxes"). The web DAG draws the same
model through the frame channel: a `.mpd-dag-group` layer between the edges and the cards, one frame
per group with a published rect (`data-mpd-group`), an inner DAG planned RECURSIVELY inside each box at
absolute canvas coordinates (a box is sized by its interior plus padding), a box→box or box→task edge
terminated on the frame's border port, a per-frame overlap audit whose union is served, and a
`data-mpd-cards` layer for the interior. The BUILT `client.js` carries the channel, and a flat board
renders through the untouched flat path (byte-identical by construction). The three web bounds are in
"Declared bounds".

## Cell-aware mail

Agents in a cell talk to each other without routing through the user interface or through the captain:

- **Intra-team** mail is the existing `agent_teams_mail` (member ↔ member, no captain in the path).
- **Member ↔ captain and cross-cell** mail is `cellwork_send`. It resolves the recipient in the cell tree
  — a member name, the literal `captain`, or the cross-cell form `"<cellId>/<captain|member>"`, where
  `<cellId>` must be a sub-cell THIS cell registered or this cell's parent (`cell.subcellIds` /
  `cell.parentCellId`); anything else is refused as `"not in this cell's tree"`. A send appends the row
  to the TARGET cell's `mail.jsonl` — for a cross-cell send, the RECIPIENT cell's file, where that
  cell's `cellwork_inbox` reads it — and the SENDER's journal records the send under a `cell:<cellId>`
  stamp with `toCell:<target>`.
- Mail is **durable first, woken best-effort**. A row whose wake-up never went out stays UNDELIVERED
  (`unreadMail` plus the `wakeFailures[]` rows, each `{id,to,subject,reason}`); `cellwork_inbox` reads
  and acknowledges unread rows, and `cellwork_supervise` surfaces both the unread count and every
  undelivered row — not only the pending board. A cross-cell row is durable-only (no wake-up is
  attempted across cells) and shows on the recipient cell's sweep. A member → captain row is read by
  the captain's inbox because the captain is not a mailbox member and the Lead handle cannot be woken
  directly.

## State on disk

Everything lives under the workspace, in gitignored runtime state:

`<workspace>/.mpd/cellwork/<cell-id>/`

| Path | Content |
|---|---|
| `state.json` | the cell record: phase, captain session, depth, parent cell, team id, planner/splitter handles, members and their modes, split revision, checkpoints, journal cursor |
| `journal.jsonl` | append-only transitions: phase, dispatch, checkpoint, compaction, promotion, refusal |
| `mail.jsonl` | the cell's own mail rows — a same-cell send, or a cross-cell send addressed to this cell; written by the sender, read here by `cellwork_inbox` |
| `requirements.md` | the validated requirements document, revisioned; a change bumps the revision and marks the split stale |
| `split/<rev>.json` | the splitter's proposal plus the plugin's measured estimates and accept/refuse verdict |
| `contracts/<taskKey>.md` | the frozen acceptance contract handed to the verifier |
| `handoff/<member>-<n>.md` | the structured handoff document, one per checkpoint |

Cell ids are `cell-<UTC instant>`; a sub-cell records its `parentCellId` and `depth`. The root is
resolved through `dsh.workspaceRoot(exec)` on every call — never `process.cwd()`, never a cached
constant — and writes go through a temporary file plus a rename in the same directory, so a reader
sees the previous record or the new one, never a half-written file.

The record is **versioned**. A corrupt, unparsable or future-version state is a REFUSAL naming the
absolute path — never a silent reset and never an overwrite. Stopping ARCHIVES: the directory stays,
the record says `stopped`, and a later `/cellwork` mints a new cell id.

## Configuration

Every number is a knob read as `cellwork.<key>`. **Precedence is project file > row config > shipped
default**: `<workspace>/.mpd/mpd.jsonc` wins over the bundle patch's `config:` block, which wins over
the documented default. A value that is not a finite number inside its rule is replaced by the default
and reported on the row's log line (`<workspace>/.mpd/logs/mpd-cellwork.log`).

`depthMax` 3 · `checkpointRatio` 0.5 · `windowFraction` 0.25 · `fixedOverheadTokens` 32000 ·
`fixedOverheadByRoute` {} · `toolSchemaChars` 0 · `outputReserveTokens` 8192 ·
`compactionHeadroomTokens` 65536 · `compactionRetries` 3 · `idleBarrierDelayMs` 200 ·
`asciiCharsPerToken` 3 · `cjkCharsPerToken` 1 · `contractGates` [] · `windowOverride` null.

The model's context window is NOT a knob: it is read from the catalog at split time and from the
observed token meter at runtime, with the provenance recorded. `windowOverride` exists only so a route
whose window cannot be read can be certified deliberately, and it is recorded as an override.

## Declared bounds

- **The guard is process-wide and dispatch-time only.** It cannot see intent, it cannot stop a model
  from attempting a forbidden name, and a row that calls a service directly instead of going through a
  tool is not covered. A cell record that cannot be read releases every caller — a guard cannot
  enforce a mode it cannot see — and the refusal then surfaces on the command and `cellwork_status`
  with the record's path.
- **The 1/4 budget is an estimate** with the declared ±25% English bound and deliberately punitive CJK
  pricing; it is not a measurement of the model's tokenizer, because the deployment ships none.
- **The mount is proven by an overlay.** On this machine a plain link-profile boot still resolves a
  stale `@mpd-dsh/mpd` package, so the mount proof supplies the row through a `--patch` overlay with an
  absolute module path and proves the row APPLIES under a real isolated boot. The bundle wiring — that
  the shipped patch layer is the source — rests on `verify:rows` and `verify:manifest`, not on that
  boot.
- **Pack closure is green since the Wave-5 re-pack.** `verify-pack-closure --require-packed` reports
  622/622 content files byte-identical with 0 drift (pack stamp 2026-10-26T12:23:55Z), and the packed
  artifact carries the new package.
- **Concurrent children are capped by the harness.** `maxActiveSubagents` (the subagent plugin's
  settings field, default 8, no upper bound) limits how many member sessions stay resident, so a cell
  larger than the cap cannot raise them all at once. For cellwork raise it to **32–64** in
  **Settings → Subagent limits** (it persists into the active profile's Cordis patch); the bundle
  cannot set it — a shipped patch row must never id-target a host-owned row — and the agent sandbox
  cannot write `~/.dsh`, so this is a one-time user step.
- **No live-LLM end-to-end cell run is claimed.** The unit suite proves the command surface, the guard
  decisions per mode, the state store, the estimator arithmetic and the protocol logic against a fake
  context; the Wave-3 QA cases prove that the command is registered and that its handler submits the
  directive, and reproduce the mount. Neither is a model-driven run.
- **Mail wake-up is best-effort.** Delivery is durable: a member → captain row waits in the journal
  until the captain polls `cellwork_inbox`. Only a recipient with an executable handle can be woken.
- **Reseed is best-effort.** The native backend exposes no dispose for a settled activation, so the old
  child is interrupted best-effort and the fresh handle is recorded on the cell.
- **Checkpoints need an observed window.** No observation means no checkpoint: the ratio is never
  applied to a guessed window.
- **Cancellation lives on the cell record, not the team plane.** The team plane exposes no cancel verb: a
  task dropped by a later split revision is marked `cancelled` in the cell record (`state.json:
  cancelledTasks`, key → board id), and its board row stays VISIBLE on the board. Dispatch skips it only
  because cellwork's own dispatch pass reads the cell record — a bare board read still shows the row.
- **The depth fence is three levels by default.** A promoted subcaptain can raise a sub-team, and
  `cellwork_subteam` refuses past `depthMax`; the nesting capability itself rests on the adapter's
  direct start path with an explicit absolute `maxDepth`, recorded as a source read in the capability
  spike (`evidence/cellwork/capability-spike/`).
- **`parent_team_id` is implicit, not a knob.** A sub-team's parent is DERIVED by the team plane at
  approval from the parent team's roster (`deriveParentTeam`); `cellwork_subteam` stamps the resulting
  parent team id on the cell record and passes no parent id at all, so there is no argument for a caller to
  get wrong — and no way to point a sub-team at a team that does not record the session as a member.
- **The web nested frame ships with three stated bounds.** (1) A cyclic dependency INSIDE one frame is
  not routed on the web canvas: the witness is named in `nestedBackEdges` while the flat path draws it
  on the left. (2) Nested columns are packed in rank order and top-aligned — no barycentre relaxation
  (the flat path keeps its own relaxation). (3) The hover halo covers the ROOT frame's cards; an
  interior card keeps its own tone. The `nestedBackEdges` witness list is wired and documented but no
  arm populates a witness yet: the bound is DECLARED, and a cyclic-interior arm would seal it.
- **Blindness stays prose**, exactly as this repository states it: cellwork wires the contract, the
  loop and the verdict, and does not pretend to observe what a verifier read.

## Tests and evidence

- `bun test packages/mpd-cellwork-plugin` — offline, no harness, no network; every arm runs through
  the adapter entry points the host uses (`apply`, the captured command definition, the captured tool
  definitions and the ONE installed guard predicate) in a fresh temporary workspace.
- The mount proof, the capability spike and the wave verdicts live under
  `evidence/cellwork/` — each directory carries its `result.json` plus that lane's own artifacts: a
  report for a read-only spike, logs for a run.
- `bun run verify:docs`, `bun run verify:rows`, `bun run verify:manifest` and `node
  scripts/verify-dist-fresh.ts` are the gates a cellwork change must keep green.

For the exact tool parameters, the refusal texts and the per-arm test list, use the package README
pair; for how the mode was designed and what each wave delivered, see the plan and contracts under
`.mpd/plans/` in the repository.
