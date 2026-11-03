# mpd-cellwork-plugin
**English** | [中文](./README.zh-CN.md)

`cell-work` (v1) — the **command-triggered, dispatch-only captain mode**. Nothing in the bundle starts
it except the `/cellwork` command: no tool, no event, no preset flag. Once a cell is running, the
captain dispatches, relays and records; it never edits a file, runs a shell, does reconnaissance or
verifies work.

## The command is the only entry point

- `/cellwork <objective>` registers through the adapter as `cellwork` (no alias, no second spelling).
  The handler writes ONE cell record — `<workspace>/.mpd/cellwork/cell-<UTC instant>/state.json`, phase
  `requirements`, carrying the captain's own session id — and then submits exactly ONE activation
  directive as the invoking agent's own next user turn (producer tag `mpd-cellwork`).
- An empty or whitespace argument returns a usage error and writes **no cell state at all**.
- A second `/cellwork` while a cell is active in the same workspace is REFUSED, and the refusal names
  the active cell id: one cell at a time, because two would fight over one team board.
- A composition with no live turn surface is not left half-started: the record the command just wrote is
  archived immediately (`stopReason: "no-live-turn-surface"`) and nothing is fenced.

## The dispatch-only captain guard

ONE `tools.guard` predicate is installed per plugin, at dispatch time, for sessions a live cell knows
about. A session in no cell is untouched, which is what makes the mode free while it is off.

| Caller | Refused |
|---|---|
| captain | everything except `cellwork_*` (but NOT `cellwork_handoff`), `agent_teams_*`, `ask_user_question`, `todo_write`, `mpd_memory_*`, and the one verify-loop opener `mpd_verify_open` (that EXACT name; every other `mpd_verify_*` stays refused) |
| verifier | `write`, `edit`, `mpd_hashline_edit`, `mcp__ast_grep__rewrite`, `mcp__ast_grep__scan`, `mcp__lsp__rename_symbol`, `mcp__lsp__rename_symbol_strict`, and the two bundle spawn tools `mpd_role_spawn` / `mpd_workmate_spawn` — a verifier NEVER delegates: the verdict is its own work, and a FAIL is the channel back to the writer |
| member at its context checkpoint | everything except `cellwork_handoff`, `cellwork_context`, `cellwork_status` |
| subcaptain | a MINI-CAPTAIN: the captain allowlist MINUS `cellwork_start`/`cellwork_stop`, plus the four sub-cell verbs `cellwork_subteam`, `cellwork_activate`, `cellwork_dispatch`, `cellwork_supervise`. No file-work tool at all |
| planner (`cell-planner`) | `read`/`grep`/`glob` inside the documentation band — `.mpd/**`, `docs/**`, `evidence/**`, `agent-references/**`; any `AGENT.md`/`AGENTS.md`/`CLAUDE.md` by basename at any depth, inside or outside the workspace root; at the root only `README.md`, `README.zh-CN.md`, `CHANGELOG.md`, `LICENSE*.md` — and every other tool it needs to plan |
| ordinary member | nothing: it is a normal worker |

Every refusal is ONE teaching paragraph naming what was refused, the calls that replace it, and
`cellwork_stop` as the way out. `cellwork_stop` archives the cell, the seat disappears with it, and the
same session is unguarded again.

The planner row is the repository's reconnaissance rule, not a cellwork invention: its band is the SAME
band the top-level `mpd` captain keeps (a parity test imports both lists, so they cannot drift), a path
is judged by its SPELLING with symlinks never resolved, and a `..` segment is admitted ONLY when the
basename is one of the three instruction files — reading a sibling project's `AGENT.md` is exactly why
the hop is allowed. In a cell the planner NEVER runs reconnaissance itself, and a CONSULT IS A LEAF:
`mpd_role_spawn` forwards the caller's recorded depth + 1 and denies both spawn tools in the child's own
scope, so the child cannot delegate again; a caller already at depth 2 or deeper is refused outright.
The cell planner sits at depth 1, keeps its route, and its consult lands at depth 2 as a leaf;
`cellwork_recon` is exempt from that depth floor because its own depth is bounded by
`cellwork.depthMax`.

## State on disk

`<workspace>/.mpd/cellwork/<cell-id>/` holds `state.json` (the record), `journal.jsonl` (append-only
history), `requirements.md`, `split/<rev>.json` and `split/<rev>.refused.json`, `contracts/<taskKey>.md`
and `handoff/<member>-<n>.md`.
The root is resolved through `dsh.workspaceRoot(exec)` per call — never `process.cwd()`, never a cached
constant. Writes go through a temporary file and a rename in the same directory, so a reader sees the
previous record or the new one and never a half-written file.

The record is **versioned**, and a corrupt, unparsable or future-version state is a **REFUSAL naming the
absolute path** — never a silent reset, and never an overwrite. Stopping ARCHIVES: the directory stays,
the record says `stopped`, and a later `/cellwork` mints a new cell id.

## Tools in this package

- `cellwork_status` — phase, objective, captain, requirements/split revisions, members and their modes,
  injected checkpoints, the live team's member/task counts, the recorded split-ticket board id
  (`splitTaskId`), the cell-record vs live-roster divergence (`missingFromCell` / `missingFromTeam` /
  `inSync`, report-only), the caller's own seat and the on-disk paths.
- `cellwork_start` — opens the requirements phase of the ACTIVE cell (captain only): validates the cell
  and the caller, stamps `startedAt`, journals it. It never creates a cell; that is the command's alone.
- `cellwork_stop` — archives the cell (no deletion), clears the guard and gives the tools back. It
  REFUSES while a board task is `claimed`/`in_progress` unless `force:true`, and a forced stop is
  journaled as such.

The flow tools: `cellwork_requirements` (the planner's finalize/update; a section body runs to the next
heading of the same or a higher level, so `###` stays inside its parent), `cellwork_recon` (the
planner's one-shot read-only consult), `cellwork_split` (the splitter's measured graph — each task may
declare its board `member`, and a refusal persists its findings at `split/<rev>.refused.json`),
`cellwork_activate` (the captain's materialisation; it raises ONE member per distinct `member`, names
both the owner role and the member in each contract, and its answer's `reused` list names the members
resolved from the cell record or the live roster instead of raised).

The protocol tools: `cellwork_dispatch` (one owner-only dispatch pass, plus `reassign` hand-overs),
`cellwork_supervise` (the captain's read-only sweep, including every fenced member and the open rows it
still owns), `cellwork_context` (a member's own occupancy), `cellwork_handoff` (the checkpoint document;
a SECOND one is refused while the first waits for the barrier), `cellwork_subteam` (a subcaptain's
sub-cell registration), `cellwork_send` / `cellwork_inbox` (durable cell mail over the
workspace mailbox — `send` mints `message`/`question`/`answer` rows through the shared store, the `send`
row lands first and the wake-up attempt is a separate `wake` record; the protocol is in
[`docs/mail.md`](../../docs/mail.md)). They land on the SAME record and guard
documented here.

## Config

Every number is a knob read as `cellwork.<key>`. **Precedence is project file > row config > shipped
default**: `<workspace>/.mpd/mpd.jsonc` wins over the bundle patch's `config:` block, which wins over the
documented default. A value that is not a finite number inside its rule is REPLACED by the default and
reported on the row's log line (`<workspace>/.mpd/logs/mpd-cellwork.log`).

`depthMax` 3 · `checkpointRatio` 0.5 · `windowFraction` 0.25 · `fixedOverheadTokens` 32000 ·
`fixedOverheadByRoute` {} · `toolSchemaChars` 0 · `outputReserveTokens` 8192 ·
`compactionHeadroomTokens` 65536 · `compactionRetries` 3 · `idleBarrierDelayMs` 200 ·
`asciiCharsPerToken` 3 · `cjkCharsPerToken` 1 · `contractGates` [] · `windowOverride` null.

The mail bound is the ONE knob outside this table: `mail.maxUndelivered` (default 8, `0` disables; an
absent or unusable value falls back to 8) is a `mail.*` key because BOTH mail tools read it, and it is
enforced through the one shared store (see "Mail and reseed bounds").

The model's own context WINDOW is not a knob: it is read from the catalog at split time and from the
observed token meter at runtime, with the provenance recorded. `windowOverride` exists only so a route
whose window cannot be read can be certified deliberately, and it is recorded as an override.

## Flow rules and declared bounds

- **B4 relay.** The planner never reaches the user directly: planner → `cellwork_send`/`agent_teams_mail`
  → captain → `ask_user_question` → mail back. The captain authors nothing and answers nothing itself.
- **B6 measured budget.** Every declared input is `stat`-ed and its first 16 KiB sampled for a CJK ratio;
  the task is priced with the configurable ratios, the measured fixed overhead, block/framing overhead and
  the output reserve. The window is READ from the adapter's model catalog (provenance `catalog`), from an
  operator override (`override`), or the task is `uncertified` — never guessed. A split is accepted only
  when the estimate fits `floor(window * windowFraction)` AND leaves the model's max output plus the
  compaction headroom inside the window; an over-budget task is refused WITH its bytes → tokens breakdown.
- **Split warnings are NON-FATAL, and empty write scopes are never silent.** `cellwork_split` returns a
  `warnings` list — a channel EXCLUDED from the `accepted` predicate — naming every
  `work`/`repair`/`integration` task whose `writeScopes` is empty, by split key. A split that
  legitimately writes nothing still passes; what it refuses to do is stay SILENT. The frozen contract's
  "(none declared — this task produces no code)" line carries the recovery: ask the captain for a scope
  extension BEFORE the first write. `agent_teams_plan {action:"create_task"}` applies the same rule at
  staging time on the team plane.
- **B7 owner-only dispatch.** A ready task is paired ONLY with its declared owner; a busy, absent or
  FENCED owner is reported and the task left pending — never substituted. A member is FENCED when its
  recorded `mode` is `checkpoint`, when a handoff it wrote still waits for the compaction barrier, or
  when the barrier gave up and recorded `fenced: true` + `fencedReason`, and a fenced member is never
  messaged. `cellwork_dispatch {reassign:[{task_id, owner}]}` is the repair: for each pair, BEFORE the
  pass, the row is claimed on the board for that member, journaled as `task-reassigned` (from → to), then
  delivered — a failure is reported in `reassigned`/`reassignInvalid`, never thrown, and a terminal row,
  an unknown member or a fenced TARGET is refused; so is a target that FAILED to start (a row claimed
  for it would never be picked up) or is still PROVISIONING (retry once it is running), and the delivery
  handle is the freshest NON-BLANK one — the live roster's handle when the cell record's `executorRef`
  is empty. After a reassignment the target owns an in-flight
  row, so the SAME pass reports its OTHER ready rows BUSY (one task per member per pass): the documented
  rule, not a regression. The verify loop for every code task is opened BEFORE the dispatch pass that
  hands the work out.
- **Resumable activation, with a stated crash bound.** While a pass runs, each artifact adds ONE compact
  `cell-activation-progress` journal row (stage, key, ordinal, total) and nothing more. The accumulated
  ids — the in-flight revision (`activationInFlight`), the members raised, the board ids minted
  (`activatedTasks`) and the loop ids opened (`activatedLoops`) — are written to the cell record ONCE,
  as the `cell-activation-partial` row, and ONLY when the pass FAILS; every row of one pass shares the
  same non-decreasing instant, so the journal is monotonic (D7: 119 full snapshots were ~40 % of a
  490 KB journal, and the final row was stamped EARLIER than the rows above it). The phase never
  regresses: `split` for a first activation, `executing` for a partial RE-SPLIT.
  A retry after a RETURNED failure resumes from that record: members reconcile against the live roster
  (a duplicate `add_member` is reused, never fatal), a recorded board id is reused per split key, and a
  verify loop is opened for every code task whose split key has none yet — EXCEPT a KEPT task from a
  pre-upgrade cell whose frozen contract already names a loop id (its `activatedLoops` entry is absent):
  that contract is not rewritten and no second loop is opened. `activatedRevision` is set only after
  the dispatch pass succeeds. A NEWER accepted revision SUPERSEDES an older in-flight partial —
  journaled (`activation-in-flight-superseded`), the older partial abandoned, its recorded rows
  reconciled (kept ids reused, dropped work cancelled) — while a LOWER revision, an already-materialised
  revision and a stale split are refused with the existing teaching errors. The answer's `reused` list
  names the members resolved from the cell record or the live roster instead of raised.
  **The crash bound:** a process that DIES mid-pass leaves NO partial at all. Members still reconcile
  by name against the live roster, but board tasks and verify loops are known only through the recorded
  maps, so a task or loop created by the dead pass is created AGAIN by the retry — detectable, not
  deletable (the team plane has no cancel verb). A returned failure's residual window is one
  board/verify call plus one cell-record write; a crash's window is the whole pass.
- **A re-split states what it kept.** When a revision keeps tasks, `cellwork_activate` returns a
  `notice`: how many kept tasks reuse their live board rows, that their frozen contracts are NOT
  rewritten (the bytes a verifier may already be reading stay as first frozen), that a scope expansion
  needs a manual re-freeze plus a new verify loop and belongs in a NEW split revision, and that this
  activation dispatched the ready rows OWNER-ONLY. The stage-4 exception is stated in the same notice: a
  kept task whose loop was never recorded is the ONLY case where a kept contract is rebuilt, gaining its
  verify loop id — and the notice names those keys when it happens. The notice is prose in the result ON
  PURPOSE: a captain must not have to infer any of it from counts.
- **C1 — `member` names the seat.** A split task may declare `member`; omitted, the member name IS the
  owner role. Several tasks may share one member, and several members may share one owner role (that is
  real parallelism for one role). The seat's IDENTITY is the shared normalisation used by activation,
  split validation and dispatch: letters and digits of ANY script are kept, case is folded, and each run
  of other characters becomes one `-` — so `"Seat A"` and `"seat-a"` are ONE seat, `"工程师 A"` and
  `"工程师-a"` are ONE seat, and `"工程师甲"` / `"工程师乙"` are TWO. A name with an EMPTY identity
  (punctuation-only like `---`, or the empty string), a name longer than 64 characters, or one carrying
  a control character/path separator is refused as `member-invalid`; two tasks that resolve to the same
  seat under DIFFERENT owner roles are refused as `member-role-conflict`; `self-review` compares that
  same identity when both sides declare a member. Activation raises ONE member per distinct `member`,
  and a contract names the owner role AND the member (`Owner: **<role>** (member `<name>`)`).
- **C11 — the split ticket is found by id, and a lost owner is repaired.** Staging records the staged
  split ticket's BOARD id as `splitTaskId`; every lookup tries that id first and the owner second, so a
  requirements bump marks the split stale and re-dispatches the SAME row. A missing/ownerless ticket is
  a hard error naming the repair, and staging repairs a lost owner itself by claiming the row for
  `cell-splitter` (`agent_teams_task {action:"claim", claimant:"cell-splitter"}`) instead of minting a
  duplicate. The id is RECORDED even when that repair is refused (the journal carries
  `ownerRepairError` beside it), so the id-first lookup keeps working; a successful repair is journaled
  as `splitTicketOwnerRepaired`. On the re-split path ONE row is reused: a requirements update prefers
  a LIVE splitter row (the recorded id, then any live row owned by `cell-splitter`), writes the id it
  used back to the cell record's `splitTaskId` (reported as `recordedSplitTaskId`), and only appends a replacement — same cell role,
  new revision in the subject — when the recorded row is terminal and no live row exists.
- **The mail log format changed, one-way.** Rows now live in the WORKSPACE mailbox
  (`<workspace>/.mpd/team/mailbox.jsonl`), stamped `teamId` + `cellId` (plus `fromCell` on a cross-cell
  send), so the cell view and the team plane read one stream. A `send` row carries the legacy
  `wakeSent: false` and the wake-up outcome is a SEPARATE `wake` record (`t:"wake"`, `sent`, `reason?`,
  `at`) appended after it. This build folds an older log correctly (a pre-`wake` row keeps its own
  `wakeSent`, and a pre-unification `<cell>/mail.jsonl` is still read and merged in `at` order); a reader
  from a PREVIOUS build reads a new row as "not woken" — and does not find it in the cell file at all. A
  one-bundle-workspace bound, stated rather than hidden.
- **Lossless tool results.** Every cellwork tool result survives the harness's lossless-JSON walk: a task
  projection never carries an `undefined` own key (the optional `owner` is OMITTED, never set to `undefined`),
  and no result carries a non-finite number, a negative zero or a cycle.
- **B5 recon bound.** `cellwork_recon` raises the read-only child with the exact `Explorer`/`Researcher`
  label and an absolute depth cap, so the child-persona seam applies the roster deny list. On a composition
  WITHOUT that seam the child is read-only by PROMPT only, and the result reports `personaInjected:false`.
- **Verify-loop producer.** `mpd_verify_open` is called with the captain's LIVE agent and its own session id,
  recorded truthfully on the loop; the cell id appears only as DATA on the frozen contract
  (`producer: cellwork:<cellId>`), never as a fabricated session. `mpd_verify_open` — that exact name — is the
  ONE `mpd_verify_*` entry on the captain allowlist: `mpd_verify_seat`, `mpd_verify_evidence`,
  `mpd_verify_record` and `mpd_verify_escape` stay refused for the captain, so a `writer:"self"` loop it opens
  is inert (`mpd_verify_seat` refuses the loop's own writer). With no live caller agent, `cellwork_activate`
  refuses before any write. The loop NAMES its writer: activation passes the owning member's session id as
  `writer_id` (1..200 characters after trimming) and the human name as `writer_reason: "member: <name>"`
  (also 1..200) into `writer.reason`, so the record's same-agent refusal compares real agent keys instead of
  the `delegate:pending` placeholder. Both parameters are refused in one sentence with `writer:"self"`. The
  comparison is a STRING comparison: it makes the rule meaningful, never unforgeable.
- **One override, one identity.** `windowOverride` is a single value: it certifies ANY route the catalog
  cannot report, recorded as `override`. The planning tasks are closed under the CALLER's own identity
  (the planner/splitter), and a completion failure is journaled, never fatal to the revision.
- **Compaction is classified, never swallowed — and a member that is still reachable is compacted IN
  PLACE.** The `agent/turn-stopping` listener RETURNS the barrier promise, so the host's serial dispatch
  AWAITS it instead of racing a detached one. The barrier waits for the agent to be idle with a bounded
  retry budget (`compactionRetries`, `idleBarrierDelayMs`), then resolves the engine from the LIVE member
  handle the event carries (`compactionEngineForLiveAgent`) BEFORE any sleep and BEFORE the registry
  lookup, so a member already detached from `ctx.agents` still compacts in place; only when that handle
  carries no engine does the id-keyed `compactionEngineForAgent` get a chance. A retry delay may sit
  between attempts; there is none before the FIRST one. The engine is driven with a real
  `AbortController` signal, and the journaled reason is one of `compacted` | `no-safe-range` | `busy` |
  `aborted` | `failed` | `no-engine`; exhausting the retry budget is never a silent no-op. The outcome
  union is exactly `promoted` | `reseeded` | `refused`, and a `compacted` answer takes `promoted` on the
  SAME agent — no interrupt, no reseed.
- **Mail and reseed bounds.** Cell mail is durable first and woken best-effort. `cellwork_send` resolves
  the recipient in the cell tree — a member name, `captain`, or the cross-cell form
  `"<cellId>/<captain|member>"`, where `<cellId>` must be a sub-cell THIS cell registered or this cell's
  parent (`cell.subcellIds` / `cell.parentCellId`); anything else is refused as `"not in this cell's
  tree"`. A supplied name that is neither `captain` nor a member of the TARGET cell is REFUSED — the
  answer lists that cell's members — never quietly delivered to the caller's own inbox. A send writes
  into the WORKSPACE mailbox through the shared store's atomic fan-out, stamped with the cell's `teamId`
  and a `cellId` the view scopes by; the SENDER's journal records it under a `cell:<cellId>` stamp with
  `toCell:<target>`. `cellwork_send` also speaks the structured protocol — `kind` (inferred from
  `options` for a question, from `selected`/`custom` for an answer), `options` + `multiSelect`, `replyTo`,
  `selected`/`custom`, `questionId`, and `broadcast: true` for one row per seat of the target cell (the
  sender excluded); an unknown label is refused WITH the valid label list. A recipient with
  `mail.maxUndelivered` undelivered rows (default 8, `0` disables) is REFUSED — the bound is shared
  with `agent_teams_mail` through the one store, so switching tools is not an escape — and the refusal
  names the recipient, the count, the bound and two recovery paths: acknowledge its inbox
  (`cellwork_inbox`) or reassign the rows behind it (`cellwork_dispatch {reassign:[…]}`). A cross-cell row mirrors
  `fromCell`, is durable-only — no wake-up is attempted across cells — and appears on THAT cell's
  `cellwork_supervise`.
  The Lead has no executor handle, so a member→captain row is read by the captain's `cellwork_inbox` and
  surfaced on `cellwork_supervise`; a row whose wake-up never went out stays UNDELIVERED and is surfaced
  there too (`unreadMail` plus the `wakeFailures[]` rows, each `{id,to,subject,reason}`), not only on the
  pending board. When the compaction barrier cannot compact, the agent is reseeded from its handoff — but
  never from its own dead Agent: the reseed parent is, in order, the member's recorded `parentSession`
  resolved live, then the cell's captain, and when neither is live the barrier REFUSES with the distinct
  reason `reseed-parent-unavailable`. The parent actually used is journaled (`parentSource` +
  `parentSessionId`), so lineage is observable rather than inferred. The native backend exposes no
  dispose for the settled activation, so the old child is interrupted best-effort and the fresh handle
  is recorded on the cell.

**Config precedence, stated once for both languages:** project file (`<workspace>/.mpd/mpd.jsonc`,
`cellwork.*`) > row config (the bundle patch's `config:` block) > shipped documented default.

### Subcells render as nested groups

A subcell is drawn as a GROUP BOX in the shared DAG: the box's interior is that subcell's own graph, a
dependency from outside attaches to the box's frame instead of to a task inside it, and the nesting
recurses. This package supplies the FACT the picture is made from, not the picture itself.
`cellwork_subteam` stamps the parent cell's LIVE team id on the new cell as `CellState.parentTeamId` and
journals `subcell-created` with it, and it passes NO parent id: the team plane derives the link at approval
from the parent team's own roster (`deriveParentTeam`), because the session staging the sub-team is already
a member of it. The TUI is the surface that draws the boxes this wave; the web DAG's group frame is a
declared follow-up (`docs/cellwork.md`, "Declared bounds").

## Declared bounds

- The guard is **process-wide and dispatch-time only**. It cannot see intent, it cannot stop a model from
  attempting a name, and it covers no row that calls a service directly instead of going through a tool.
- A cell record that cannot be read releases every caller: a guard cannot enforce a mode it cannot see.
  The refusal then surfaces on the command and on `cellwork_status` with the record's path.
- **Cancellation lives on the cell record, not the team plane.** The team plane exposes no cancel verb:
  a task dropped by a later split revision is marked `cancelled` in the cell record (`state.json:
  cancelledTasks`, key → board id), and its board row stays VISIBLE on the board. Dispatch skips it only
  because cellwork's own dispatch pass reads the cell record — a bare board read still shows the row.
- Verification blindness stays PROSE, exactly as this repository states it: cellwork wires the contract,
  the loop and the verdict, and does not pretend to observe what a verifier read.
- The 1/4-of-window rule is a certified ESTIMATE from measured bytes and configurable ratios — not a
  measurement, and deliberately punitive for CJK.
- **The generic team verb is the hazard cell mode removes.** `agent_teams_dispatch` pairs a ready task
  with its declared owner but FALLS BACK TO ROSTER ORDER when that owner is busy; during this wave it
  handed a REVIEW task to the member that had WRITTEN the reviewed lanes. The captain released the
  pairing immediately, restored the row to the independent reviewer, and the writer disclosed it had
  only run `git diff --stat`, a marker grep and a directory listing before it was stopped — no verdict
  existed, so no contaminated judgement was recorded. `cellwork_dispatch` is owner-only and never
  substitutes; outside cell mode, wait for the declared owner or release and reassign deliberately.
- No live-LLM end-to-end run is claimed by this package's tests: they prove the command surface, the
  guard decisions per mode, the state store and the start/status/stop lifecycle against a fake ctx. A
  mounted boot proves that this row APPLIES; a live `/cellwork` dispatch is the QA case's proof.

## Tests

`bun test packages/mpd-cellwork-plugin` — offline, no harness, no network. Each arm runs through the
adapter entry points the host uses (`apply`, the captured command definition, the captured tool
definitions and the ONE installed guard predicate), in a fresh temp workspace. The wave's defect arms
are separate files: `activate-resume-e2e` (a failure at EACH of the five activation stages, then
convergence with no duplicate), `split-refused`, `requirements-subheadings`, `dispatch-fenced`,
`dispatch-reassign`, `mail-order`, `planner-guard`, `band-parity` and `status-reconcile`.

The seam rule for this package is the repository's: every harness touch goes through
`resolveDshAdapter(ctx)`, and the design background is in the
[plugin authoring reference](../../agent-references/plugin-authoring.md).


## The team plane it shares, and `cellwork_open` (wave W2)

**`cellwork_open {objective, mandate?}`** is the programmatic entry the autoproject escalation uses. It
REFUSES a caller that is not the captain, an already-active cell, and a `mandate` whose
`<workspace>/.mpd/autoproject/<runId>/escalation.json` is not on disk. `/cellwork` is a thin handler
over the SAME open path, so the command and the tool cannot diverge. A tool has no
`invocation.submit`, so the tool path RETURNS the activation directive instead of submitting it — a
stated bound, not a hidden one.

**The TEAM-level logic is the team plane's**, reached as services (no cross-package import):
`cellwork_context` reads `mpdTeams.memberContext`, `cellwork_subteam` reads `mpdTeams.depthBudget` (the
same `cellwork.depthMax` bound, with the cell record as the documented fallback when that service is
absent), and `cellwork_dispatch` plus the handoff path read or write the team record through
`mpdTeams` / `mpdTeamActions`. The cell-MODE engines (requirements, split, activate, recon, budget) stay
in this package: they are the workflow layer that WRITES the board.

**State on disk is unchanged and read-compatible:** `.mpd/cellwork/**` stays version 1 (no migration),
with the per-cell journal and mail. The FROZEN CONTRACT of a wave lives in the board task description,
so the row an owner claims carries the acceptance text it is judged against.
