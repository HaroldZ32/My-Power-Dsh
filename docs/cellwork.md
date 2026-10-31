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
   requirements; the captain is a relay, never an author. The plan is delegated too: the planner's
   `read`/`grep`/`glob` are refused on a source path (its band is the next section), and it works
   through `cellwork_recon` or `mpd_role_spawn` instead. A section's body runs until the next heading
   of the SAME or a HIGHER level, so a `###` subheading and its text belong to the parent section
   instead of truncating it; a section whose body is only whitespace is still refused as missing or
   empty.
2. **split** — the splitter submits a graph through `cellwork_split {action:"submit"}`. The plugin
   validates it (every task declares its dependency answer, the graph is acyclic, write scopes are
   ordered, the planned verifier differs from the writer) and prices every task against the model
   budget; an accepted graph is the only input `cellwork_activate` accepts. A refusal returns a
   per-task breakdown that tells the splitter how much to cut, persists its full finding list at
   `split/<revision>.refused.json` beside the accepted record, and carries the findings on the
   `split-refused` journal row — a refusal therefore always has an artifact on disk.
   Each task may also declare `member`, the board member it is raised for; omitted, the member name IS
   `ownerRole`. Several tasks may share one member and several members may share one owner role —
   that is how one role gets real parallel seats, because activation raises ONE member per distinct
   `member`. An unusable name is refused as `member-invalid` (empty, longer than 64 characters, or
   carrying a control character or a path separator), one member declared under two DIFFERENT owner
   roles is refused as `member-role-conflict`, and the `self-review` rule compares the RESOLVED
   member names when both sides declare one (falling back to the owner role otherwise).
3. **executing** — `cellwork_activate` adds the split's members and tasks to the live team record,
   writes one frozen contract per code task, opens one verify loop per code task **before** the
   dispatch pass, and dispatches. Members receive their persona text in the member prompt; the team
   itself provides no roster persona. The captain supervises on every wake-up. A failure part-way does
   not wedge the cell: the artifacts already created are checkpointed and the phase is left as it was —
   `split` for a first activation, still `executing` for a partial re-split — so the SAME accepted
   revision resumes (below).
4. **re-split** — `cellwork_requirements {action:"update"}` bumps the requirements revision and marks
   the split stale. The planner re-settles what changed, the splitter re-submits a revision, and
   `cellwork_activate` adds only the new or changed work to the SAME team: the team id and the cell id
   do not change, work the new revision drops is marked `cancelled` (never deleted), and the split
   task is re-dispatched rather than duplicated. Activating a stale split is REFUSED unless the caller
   names the revision explicitly.

### A failed activation resumes

Activation is a sequence of mutations, not one transaction: contracts, members, board tasks, verify loops,
then the dispatch pass. Each artifact is checkpointed as it is created — the in-flight revision
(`activationInFlight`), the members raised, the board ids minted and the loop ids opened — and the phase
is left where it was: `split` for an activation that began from `split`, while a partial RE-SPLIT of an
executing cell keeps `executing`, because the phase never regresses. A run that fails part-way is
therefore resumable, not a wedge. Each frozen contract names both the owner role and the resolved board
member (`Owner: **<role>** (member `<name>`)`), and activation raises one member per distinct `member` —
so twelve tasks of one role no longer queue behind a single session.

The journal of a pass is COMPACT, and it is the pass's own instant. Each artifact adds ONE
`cell-activation-progress` row as it is created (stage, key, ordinal, total); the FULL accumulated
snapshot is persisted ONCE — as the `cell-activation-partial` row — when the pass fails, and every row
of one pass carries the same non-decreasing timestamp, so the journal is monotonic. The VEdit journal
showed what the older shape cost: 119 full snapshots, ~40 % of a 490 KB journal, with the final row
stamped EARLIER than the rows above it.

A retry of the SAME accepted revision resumes from that record: members are reconciled against the live team
roster (a name already on the roster is reused instead of re-raised), a recorded board id is reused per split
key, and a verify loop is opened for every code task that does not have one yet — not only for the tasks the
retry newly creates. A KEPT task from a cell activated before this rule existed has no `activatedLoops`
entry, so a frozen contract that already names a loop id counts as armed: that task is skipped and its
contract is NOT rewritten (only a task with no loop, or whose contract still carries the pre-loop
placeholder, gets one). `activatedRevision` is set only after the dispatch pass succeeds, so another failure
leaves another resumable record.

A NEWER accepted revision SUPERSEDES an older in-flight partial: the pass is journaled
(`activation-in-flight-superseded`, naming both revisions and stating that the older partial is abandoned),
and the newer split's materialisation reconciles the recorded rows — a kept key reuses its board id, while
dropped work is cancelled per the re-split rules — so the older artifacts are neither duplicated nor lost.
Only an accepted revision LOWER than the in-flight one is refused (a lower revision cannot supersede), with
the existing teaching error, alongside an already-materialised revision and a stale split.

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
- **The split ticket is found by its recorded id, and a lost owner is repaired.** Staging records the
  staged split ticket's BOARD id on the cell record (`splitTaskId`) and every later lookup tries that
  id first, the owner second — a requirements bump can therefore mark the split stale and re-dispatch
  the SAME row. A missing or ownerless ticket is a hard error naming the repair, and staging repairs
  a lost owner itself by claiming the row for `cell-splitter`
  (`agent_teams_task {action:"claim", claimant:"cell-splitter"}`) instead of minting a duplicate.

The team id and the cell id do not change, so the cell's journal, mail and board stay one continuous
history.

## Fenced members and reassignment

A member can reach a state where it must not be woken: its recorded `mode` is `checkpoint`, or it wrote
a handoff that is still waiting for the compaction barrier, or the barrier gave up after its retry
budget (`compactionRetries`) and marked it `fenced: true` with a `fencedReason`. ONE predicate reads the
three signals, and a fenced member is never messaged.

- **Dispatch skips a fenced owner and leaves the row pending.** The skip reason names the member, the
  cause and the repair; no other member is substituted.
- **`cellwork_dispatch {reassign:[{task_id, owner}]}` is the repair.** For each pair, BEFORE the pass,
  the row is claimed on the board for that member, journaled as `task-reassigned` (from → to), then
  delivered the normal dispatch message. Every outcome is reported (`reassigned` plus one line per
  unreadable entry in `reassignInvalid`) and nothing is thrown. A terminal row is never reopened, an
  unknown member is never substituted, and a fenced TARGET is refused — pick an unfenced member.
- **A reassignment changes what the same pass reports.** The target now OWNS an in-flight row, so its
  OTHER ready rows are reported BUSY by that pass (one task per member per pass) instead of being
  queued. That is the existing dispatch rule, not a regression: run another pass later.
- **A second handoff is refused while the first waits for the barrier.** `cellwork_handoff` answers
  "END YOUR TURN": the barrier reads only the latest ordinal, so a second document costs continuity
  instead of saving it (the VEdit livelock wrote three in seven minutes).
- **A given-up barrier records its consequence.** The member gets `fenced: true` + `fencedReason`, the
  journal gets a `checkpoint-unrecoverable` row naming the repair, and `cellwork_supervise` lists every
  fenced member together with the OPEN board rows it still owns.

**The generic team verb carries a hazard cell mode does not.** `agent_teams_dispatch` pairs a ready task
with its declared owner but FALLS BACK TO ROSTER ORDER when that owner is busy. During this very wave
it handed a REVIEW task to the member that had WRITTEN the reviewed lanes; the captain released the
pairing immediately, restored the row to the independent reviewer, and the writer disclosed it had only
run `git diff --stat`, a marker grep and a directory listing before it was stopped — no verdict
existed, so no contaminated judgement was recorded. `cellwork_dispatch` is OWNER-ONLY and never
substitutes. Outside cell mode, **wait for the declared owner or reassign deliberately**
(`agent_teams_task {action:"release"}`, then a fresh pairing), and never treat review-by-writer as a
merely theoretical risk.

## Tool surface

| Tool | Caller | What it does |
|---|---|---|
| (the `/cellwork` command) | you | writes the one cell record and submits the one activation directive |
| `cellwork_start` | captain | opens the requirements phase of the active cell; validates cell and caller, stamps `startedAt`, journals it |
| `cellwork_status` | captain, member | phase, objective, captain, requirements/split revisions, members and their modes, injected checkpoints, live team counts, the recorded split-ticket board id, the cell-record vs live-roster divergence (`missingFromCell` / `missingFromTeam` / `inSync`), the caller's own seat and the on-disk paths |
| `cellwork_requirements` | planner | `finalize` a requirements document, or `update` it — an update bumps the revision and marks the split stale; a section body runs to the next heading of the same or a higher level, so `###` subheadings stay inside their parent |
| `cellwork_recon` | planner, subcaptain | one-shot READ-ONLY consult (Explorer/Researcher) raised through the direct start path with the role name as its label and an explicit absolute depth cap, so the consult is a read-only leaf; the report is returned and journaled |
| `cellwork_split` | splitter | `submit` a graph so the plugin can measure it (each task may declare its board `member`), or `show` the last verdict; every refusal persists its findings at `split/<revision>.refused.json` |
| `cellwork_activate` | captain | materialise an accepted split on the live team record, write contracts (owner role AND member), raise one member per distinct `member`, open verify loops, dispatch; a failed pass is checkpointed and the SAME revision resumes it, while a newer accepted revision supersedes an older in-flight one; the answer's `reused` list names the members resolved from the cell record or the live roster instead of raised |
| `cellwork_dispatch` | captain | one owner-only dispatch pass over the team board; a busy, absent or fenced owner is reported and the row left pending; `reassign` hands named rows to another member FIRST (board claim → `task-reassigned` journal → delivery), the repair for a fenced owner |
| `cellwork_supervise` | captain | read-only sweep: pending checkpoints, compactions, promotions, stale splits, unread mail, every UNDELIVERED mail row, and every fenced member with the open rows it still owns; every projection is lossless JSON, with no `undefined` own key |
| `cellwork_context` | member | the caller's own live occupancy, the window it was measured against, and that window's provenance |
| `cellwork_handoff` | member | write and validate the checkpoint handoff document; marks the checkpoint ready; a SECOND document is refused while the first still waits for the barrier |
| `cellwork_subteam` | promoted subcaptain | register a sub-cell, enforce the depth cap, return the sub-captain directive |
| `cellwork_send` | any cell agent | cell-aware addressing (member, captain, another sub-cell) plus transport delivery and a journal row — the durable row lands first, and the wake-up attempt is appended after it as a separate `wake` record |
| `cellwork_inbox` | any cell agent | read and acknowledge the caller's unread cell mail |
| `cellwork_stop` | captain | end the mode: archive the cell (no deletion), clear the guard, give the tools back; REFUSED while a board task is `claimed`/`in_progress` unless `force:true`, and a forced stop is journaled as such |

The one-call view for a bystander is `cellwork_status`; everything else either mutates the cell record
or returns a verdict about it.

## The guard modes

ONE `tools.guard` predicate is installed per plugin. It resolves the calling session and looks it up
in the live cell tree: a session in no cell is untouched, which is what makes the mode free while it
is off. The predicate fires at **dispatch** time only.

| Caller | Allowed | Refused |
|---|---|---|
| captain | `cellwork_*` except `cellwork_handoff`, plus `agent_teams_*`, `ask_user_question`, `todo_write`, `mpd_memory_*`, and the ONE loop opener `mpd_verify_open` (exact name only) | everything else — no file edit, no shell, no `read`/`grep`/`glob`, and no verification beyond opening a loop: binding a seat, recording a verdict, evidence and escape stay refused |
| verifier | `read`, `grep`, `glob`, `bash` (the gates), `mpd_verify_*` | `write`, `edit`, `mpd_hashline_edit`, `mcp__ast_grep__rewrite`, `mcp__ast_grep__scan`, `mcp__lsp__rename_symbol`, `mcp__lsp__rename_symbol_strict` |
| member at its context checkpoint | `cellwork_handoff`, `cellwork_context`, `cellwork_status` | everything else — the agent cannot keep working even if it ignores the prose |
| subcaptain | the captain allowlist MINUS `cellwork_start` / `cellwork_stop`, PLUS `cellwork_subteam`, `cellwork_activate`, `cellwork_dispatch`, `cellwork_supervise` | every file-work tool: a subcaptain is a mini-captain and dispatches, it does not implement |
| planner (`cell-planner`) | `read`/`grep`/`glob` inside the documentation band: `.mpd/**`, `docs/**`, `evidence/**`, `agent-references/**`; any `AGENT.md`/`AGENTS.md`/`CLAUDE.md` by BASENAME at any depth, also outside the workspace root; and at the workspace root only `README.md`, `README.zh-CN.md`, `CHANGELOG.md`, `LICENSE*.md` | a SOURCE path — the refusal names the two delegation routes (`cellwork_recon` with `Explorer`/`Researcher`, `mpd_role_spawn` with a read-only roster role) and says why. A path is judged by its SPELLING (symlinks are never resolved), and a `..` segment is allowed ONLY in an instruction-file spelling |
| ordinary member | everything it needs to work | nothing — it is a normal worker |

Every refusal is ONE teaching paragraph: what was refused, the calls that replace it, and
`cellwork_stop` as the way out. Stopping the cell removes the seat, so the same session is unguarded
again.

Two rows are the repository's reconnaissance rule rather than a cellwork invention. The planner's band
is the SAME band the top-level `mpd` captain keeps, and a parity test imports both lists so they cannot
drift apart. Inside a cell the planner's reconnaissance is DELEGATED: `cellwork_recon` forwards an
absolute depth cap, and `mpd_role_spawn` forwards the caller's own recorded delegation depth + 1, so a
nested consult is a LEAF instead of being refused by a host depth default it cannot see. The cell
captain sits at the opposite end — its read surface is the cell record, through these tools — while
OUTSIDE cell mode the `mpd` captain's band now admits `AGENT.md`/`AGENTS.md`/`CLAUDE.md` at any depth,
including a sibling project's, and still refuses every source path.

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
- **The log FORMAT changed, and the change is ONE-WAY.** A `send` row now always carries
  `wakeSent: false`, and the wake-up outcome is appended AFTER it as a separate `wake` record
  (`t:"wake"`, `sent`, `reason?`, `at`), so "durable first, wake second" is observable in the log
  instead of inferred. This build folds an OLDER log correctly (a pre-`wake` row keeps its own
  `wakeSent`), but a reader from a PREVIOUS build would read a new row as "not woken". State it rather
  than hide it.

## State on disk

Everything lives under the workspace, in gitignored runtime state:

`<workspace>/.mpd/cellwork/<cell-id>/`

| Path | Content |
|---|---|
| `state.json` | the cell record: phase, captain session, depth, parent cell, team id, planner/splitter handles, the staged split ticket's board id (`splitTaskId`), members and their modes (with the optional `fenced`/`fencedReason` marker), split revision, checkpoints, journal cursor, and the two optional in-flight activation fields — `activationInFlight` (the accepted revision whose materialisation is running) and `activatedLoops` (split key → verify-loop id) |
| `journal.jsonl` | append-only transitions: phase, dispatch, checkpoint, compaction, promotion, refusal, and the supersession rows (`split-superseded`, `activation-in-flight-superseded`); an activation pass writes one compact `cell-activation-progress` row per artifact and a single full `cell-activation-partial` row on failure, and the repair rows are `task-reassigned`, `dispatch-reassign` and `checkpoint-unrecoverable` |
| `mail.jsonl` | the cell's own mail rows — a same-cell send, or a cross-cell send addressed to this cell; written by the sender, read here by `cellwork_inbox`; a `send` row is followed by a separate `wake` record stating what the wake-up attempt did |
| `requirements.md` | the validated requirements document, revisioned; a change bumps the revision and marks the split stale |
| `split/<rev>.json` | the splitter's proposal plus the plugin's measured estimates and accept/refuse verdict |
| `split/<rev>.refused.json` | the full finding list of a REFUSED submission at that revision, written beside an accepted record, never on top of it |
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
- **The mail log format is ONE-WAY compatible.** As the mail section states: a `send` row now carries
  `wakeSent: false` and the outcome is a following `wake` record. This build folds an older log
  correctly; a reader from a PREVIOUS build reads a new row as "not woken".
- **A reassignment takes the target BUSY for that pass.** After `cellwork_dispatch {reassign}` the
  target member OWNS an in-flight row, so its OTHER ready rows are reported BUSY by the same pass (the
  documented one-task-per-member-per-pass rule) instead of being queued. That is the rule, not a
  regression; run another pass when the first is done.
- **Reconnaissance is refused by SPELLING, not by resolution.** The captain and planner guards judge
  the string the tool call carried: symlinks are never resolved, and reaching a source path through
  `bash` (`cat`, `rg`) is not intercepted. A `..` hop is admitted ONLY when the basename is
  `AGENT.md`, `AGENTS.md` or `CLAUDE.md` (that is exactly how a sibling project's instruction file is
  read); every other `..` stays refused.
- **The generic team verb is the hazard cell mode removes.** `agent_teams_dispatch` pairs a ready task
  with its declared owner but FALLS BACK TO ROSTER ORDER when that owner is busy; during this wave it
  handed a REVIEW task to the member that had written the reviewed lanes (released immediately, no
  verdict recorded). Cell dispatch is owner-only and never substitutes — outside cell mode, wait for
  the declared owner, or release and reassign deliberately. Review-by-writer is not a theoretical risk.
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
- **The verify-loop producer is the captain's own live session.** The loop records that session truthfully;
  the cell id survives only as DATA on the frozen contract (a `producer: cellwork:<cellId>` line), never as a
  fabricated session. `mpd_verify_open` — that exact name — is the ONLY `mpd_verify_*` entry on the captain
  allowlist: binding a seat, recording a verdict, taking evidence and escaping stay refused, so a
  `writer:"self"` loop the captain opens is inert (`mpd_verify_seat` refuses the loop's own writer). With no
  live caller agent, activation refuses before writing anything. The loop also NAMES its writer: activation
  passes the owning member's session id as `writer_id` and records the human name as `member: <name>` in the
  loop's `writer.reason`, so `mpd_verify_record`'s same-agent refusal compares two real agent keys instead of
  the `delegate:pending` placeholder. The comparison is a STRING comparison — it makes the rule meaningful,
  never unforgeable.
- **The resume is not a transaction.** The per-artifact checkpoint shrinks the residual window to one
  board/verify call plus one cell-record write. A duplicate board row is possible only if the task was created
  and its checkpoint write failed; it is detectable but not deletable — the team plane has no cancel verb.
- **Blindness stays prose**, exactly as this repository states it: cellwork wires the contract, the
  loop and the verdict, and does not pretend to observe what a verifier read.

## Tests and evidence

- `bun test packages/mpd-cellwork-plugin` — offline, no harness, no network; every arm runs through
  the adapter entry points the host uses (`apply`, the captured command definition, the captured tool
  definitions and the ONE installed guard predicate) in a fresh temporary workspace. The suite also
  exercises activation resume: a failure injected after the second member, the second task and the second
  loop, and at dispatch, each followed by a retry that reuses the recorded artifacts.
- The wave's defect arms are their own files: `activate-resume-e2e` (a failure at EACH of the five
  stages, then convergence with no duplicate), `split-refused`, `requirements-subheadings`,
  `dispatch-fenced`, `dispatch-reassign`, `mail-order`, `planner-guard`, `band-parity`,
  `split-task-owner` and `status-reconcile`; the verify side adds `gates-project` and
  `open-writer-id`, and the roster side adds `captain-instruction-files` and
  `role-spawn-maxdepth`.
- The mount proof, the capability spike and the wave verdicts live under
  `evidence/cellwork/` — each directory carries its `result.json` plus that lane's own artifacts: a
  report for a read-only spike, logs for a run.
- `bun run verify:docs`, `bun run verify:rows`, `bun run verify:manifest` and `node
  scripts/verify-dist-fresh.ts` are the gates a cellwork change must keep green.

For the exact tool parameters, the refusal texts and the per-arm test list, use the package README
pair; for how the mode was designed and what each wave delivered, see the plan and contracts under
`.mpd/plans/` in the repository.
