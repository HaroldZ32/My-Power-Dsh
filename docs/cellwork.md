# Cell-work mode (`/cellwork`)

**English** | [中文](./cellwork.zh-CN.md)

Cell-work is the **command-triggered, dispatch-only captain mode**. One session becomes a small
delivery organisation: a planner settles the requirements with you, a splitter cuts the work into
tasks priced against the executing model's own context window, workers execute each task under a
frozen acceptance contract, and a verifier that is never the writer judges that contract, while the
captain only dispatches, relays, records and stops.

Nothing in the bundle starts the mode except the `/cellwork` command: no tool, no event gesture, no
preset flag. Every other surface (tools, listeners, rows) is inert until the command runs and a cell
exists.

The package contract (every tool's exact behaviour, the guard table, the config knobs) is in the
[`mpd-cellwork-plugin` README](../packages/mpd-cellwork-plugin/README.md). This page is the
task-oriented account: how to drive the mode, what it measures, and what it does not promise.

## The single trigger

- `/cellwork <objective>` registers through the adapter as `cellwork`: no alias, no second spelling,
  and no substitution with another command name.
- The handler writes exactly ONE cell record: `<workspace>/.mpd/cellwork/cell-<UTC instant>/state.json`,
  phase `requirements`, carrying the captain's own session id, and then submits exactly ONE activation
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

1. **requirements**: `cellwork_start` opens the active cell's requirements phase (it never creates a
   cell). It stages the planner, the splitter AND the analysis lanes: `cellwork.planning.analysts`
   (default 2, `0..8`) raises `cell-analyst-1 … K`, alternating the read-only roster roles Explorer and
   Researcher, each with ONE `analysis-<i>` board task that charges it to reconnoitre and mail its
   findings to both planning seats. The split task is blocked by the requirements task AND every
   analysis task, so the graph is drawn from evidence instead of the splitter's guesses; `0` keeps the
   original two-seat planning phase. The planner runs the Socratic protocol: it mails the captain a structured question envelope,
   the captain calls `ask_user_question` on the main page and mails the answers back, and the planner
   repeats until it is satisfied. It then writes `requirements.md` and calls
   `cellwork_requirements {action:"finalize"}`. The planner is the ONLY agent that shapes the
   requirements; the captain is a relay, never an author. The plan is delegated too: the planner's
   `read`/`grep`/`glob` are refused on a source path (its band is the next section), and it works
   through `cellwork_recon` or `mpd_role_spawn` instead. A section's body runs until the next heading
   of the SAME or a HIGHER level, so a `###` subheading and its text belong to the parent section
   instead of truncating it; a section whose body is only whitespace is still refused as missing or
   empty.
2. **split**: the splitter submits a graph through `cellwork_split {action:"submit"}`. The plugin
   validates it (every task declares its dependency answer, the graph is acyclic, write scopes are
   ordered, the planned verifier differs from the writer) and prices every task against the model
   budget; an accepted graph is the only input `cellwork_activate` accepts. A refusal returns a
   per-task breakdown that tells the splitter how much to cut, persists its full finding list at
   `split/<revision>.refused.json` beside the accepted record, and carries the findings on the
   `split-refused` journal row: a refusal therefore always has an artifact on disk.
   Each task may also declare `member`, the board member it is raised for; omitted, the member name IS
   `ownerRole`. Several tasks may share one member and several members may share one owner role,
   that is how one role gets real parallel seats, because activation raises ONE member per distinct
   `member`. A role whose ready tasks can run together but declare FEWER member names than that
   ready-frontier width is NOT refused: the verdict carries a NON-FATAL `seat-width-short` warning per
   such role, saying that one seat per role SERIALISES them, naming the members already declared and the
   fix — `declare \`member\` names "<role>-2", "<role>-3", … so each ready task runs on its OWN seat, or
   add dependency edges if they must not run together`. The warning never changes `accepted`. The seat's IDENTITY is a normalisation, not the raw string: letters and digits of ANY
   script are kept, case is folded, and every run of other characters collapses to one `-`. So
   `"Seat A"` and `"seat-a"` are one seat, `"工程师 A"` and `"工程师-a"` are one seat, and
   `"工程师甲"` and `"工程师乙"` are TWO seats: a name may be Chinese (or any script), not only
   ASCII. A name whose identity is empty (a punctuation-only `---`, an empty string) is refused as
   `member-invalid`, as is a name longer than 64 characters or one carrying a control character or a
   path separator; two tasks that resolve to the SAME seat under DIFFERENT owner roles are refused as
   `member-role-conflict`, and the `self-review` rule compares that same seat identity when both sides
   declare a member (falling back to the owner role otherwise).
3. **executing**: `cellwork_activate` adds the split's members and tasks to the live team record,
   writes one frozen contract per code task, opens one verify loop per code task **before** the
   dispatch pass, and dispatches. Members receive their persona text in the member prompt; the team
   itself provides no roster persona. The captain supervises on every wake-up. A failure part-way does
   not wedge the cell: the phase is left as it was, `split` for a first activation, still `executing`
   for a partial re-split, and a RETURNED failure persists the artifacts it created, so the SAME
   accepted revision resumes (the exact coverage is the bound below).
4. **re-split**: `cellwork_requirements {action:"update"}` bumps the requirements revision and marks
   the split stale. The planner re-settles what changed, the splitter re-submits a revision, and
   `cellwork_activate` adds only the new or changed work to the SAME team: the team id and the cell id
   do not change, work the new revision drops is marked `cancelled` (never deleted), and the split
   task is re-dispatched rather than duplicated. Activating a stale split is REFUSED unless the caller
   names the revision explicitly. **A re-split is a SCOPE change, never a RE-SEATING**: seats are
   raised for FRESH tasks only, a kept key keeps its board row AND its owner (no owner is ever
   rewritten), and activating the revision a cell already materialised is refused — so re-submitting
   the same keys to spread the work over more seats is a silent no-op for assignments. To widen a
   RUNNING board, grow seats instead (automatic elastic growth at dispatch, or a mid-run
   `agent_teams_plan {action:"add_member"}`).

### A failed activation resumes

Activation is a sequence of mutations, not one transaction: contracts, members, board tasks, verify loops,
then the dispatch pass, and the phase is left where it was: `split` for an activation that began from
`split`, while a partial RE-SPLIT of an executing cell keeps `executing`, because the phase never
regresses. Each frozen contract names both the owner role and the resolved board member
(`Owner: **<role>** (member `<name>`)`), and activation raises one member per distinct `member`, so
twelve tasks of one role no longer queue behind a single session.

What is recorded, and WHEN, is the part a reader must not overstate. While the pass runs, each artifact
adds ONE compact `cell-activation-progress` journal row (stage, key, ordinal, total) and nothing else.
The accumulated state: the in-flight revision (`activationInFlight`), the members raised, the board ids
minted (`activatedTasks`) and the loop ids opened (`activatedLoops`): is written to `state.json` ONCE,
as the `cell-activation-partial` row, and only when the pass FAILS. Every row of one pass carries the
same non-decreasing instant, so the journal is monotonic (the VEdit journal's older shape wrote 119 full
snapshots, ~40 % of a 490 KB file, with the final row stamped EARLIER than the rows above it).

The invariant that follows: a pass that RETURNS a failure is resumable with its recorded artifacts; a
process that DIES mid-pass is not, because `state.json` holds no ids for that pass, only the compact
journal rows. A retry of the same accepted revision reconciles MEMBERS by name against the live roster
(a name already on the roster is reused, never re-raised), while board tasks and verify loops are known
only through the recorded maps: a task or loop created by the dead pass is not found, so the retry
creates it again. That duplicate row/loop is detectable but not deletable: the team plane has no cancel
verb.

A retry after a returned FAILURE resumes from that record: members are reconciled against the live team
roster (a name already on the roster is reused instead of re-raised), a recorded board id is reused per split
key, and a verify loop is opened for every code task that does not have one yet, not only for the tasks the
retry newly creates. A KEPT task from a cell activated before this rule existed has no `activatedLoops`
entry, so a frozen contract that already names a loop id counts as armed: that task is skipped and its
contract is NOT rewritten (only a task with no loop, or whose contract still carries the pre-loop
placeholder, gets one). `activatedRevision` is set only after the dispatch pass succeeds, so another failure
leaves another resumable record.

A NEWER accepted revision SUPERSEDES an older in-flight partial: the pass is journaled
(`activation-in-flight-superseded`, naming both revisions and stating that the older partial is abandoned),
and the newer split's materialisation reconciles the recorded rows: a kept key reuses its board id, while
dropped work is cancelled per the re-split rules, so the older artifacts are neither duplicated nor lost.
Only an accepted revision LOWER than the in-flight one is refused (a lower revision cannot supersede), with
the existing teaching error, alongside an already-materialised revision and a stale split.

### Re-split in detail

A revision is not a rewrite of the team; it is a delta applied to the live record:

- **Same-revision activation is REFUSED.** Activating the revision the cell already recorded is a no-op
  request and is refused outright; every submission must carry a revision GREATER than the recorded
  one, so revisions move forward only.
- **A re-split CANNOT grow seats for kept work.** Seats are raised for FRESH tasks only; a kept key
  keeps its board row and its owner, and activation never rewrites an owner — so redistributing the
  same keys across more `member` names is a silent no-op for assignments. The two paths that actually
  grow execution width are the automatic elastic growth at dispatch and a mid-run
  `agent_teams_plan {action:"add_member"}` (see "Members: staged, activated or adopted").
- **Kept rows are reused, and their contracts are NOT rewritten.** A task that survives the revision
  keeps its board row and the frozen contract its verify loop was opened with: the verifier still
  judges the acceptance criteria that were frozen before the work started.
- **The activation says what it kept.** When a revision keeps tasks, `cellwork_activate` returns a
  `notice` — prose in the result, because a captain must not infer any of it from counts: how many kept
  rows were reused, that their frozen contracts are NOT rewritten (the bytes a verifier may already be
  reading stay as first frozen), that a scope expansion needs a manual re-freeze plus a new verify loop
  and belongs in a NEW split revision, and how many ready rows this activation dispatched OWNER-ONLY.
  The stage-4 exception is stated in the same notice: a kept task whose loop was never recorded is the
  ONLY case where a kept contract is rebuilt — it gains its verify loop id, and the notice names those
  keys.
- **Dropped rows are marked `cancelled`, never deleted.** They stay in the cell record as history, and
  dispatch skips them.
- **The splitter keeps ONE live row to re-dispatch on.** A requirements update looks for a LIVE splitter
  row first (the recorded id, then any live row owned by `cell-splitter`) and re-dispatches THAT row
  with the new revision; the id it ends up using is written back to the cell record's `splitTaskId`
  (the answer reports it as `recordedSplitTaskId`), so the NEXT update reuses it too. Only when the
  recorded row is terminal and
  no live row exists does the update APPEND a replacement row (same cell role, the new revision in its
  subject): the board has no reopen verb, and appending on every bump would pile up un-cancellable
  tasks. The split graph itself is never duplicated.
- **The split ticket is found by its recorded id, and a lost owner is repaired.** Staging records the
  staged split ticket's BOARD id on the cell record (`splitTaskId`) and every later lookup tries that
  id first, the owner second: a requirements bump can therefore mark the split stale and re-dispatch
  the SAME row. A missing or ownerless ticket is a hard error naming the repair, and staging repairs
  a lost owner itself by claiming the row for `cell-splitter`
  (`agent_teams_task {action:"claim", claimant:"cell-splitter"}`) instead of minting a duplicate. The
  id is recorded EVEN WHEN THAT REPAIR IS REFUSED (the journal carries `ownerRepairError` beside it), so
  the id-first lookup keeps working and the operator reads "the row is known, its owner is still
  missing" instead of losing the id with the failed claim; a successful repair is journaled as
  `splitTicketOwnerRepaired`.

The team id and the cell id do not change, so the cell's journal, mail and board stay one continuous
history.

## Members: staged, activated or adopted

A cell's `state.json` keeps a `members` table: one row per seat, carrying the role, the session and
executor handle, the mode (`member` | `checkpoint` | `subcaptain`), the handoff count and the
`handoffReady` / `fenced` flags. The guard, `cellwork_dispatch`, `cellwork_handoff`, `cellwork_context`
and the `agent/pre-step` checkpoint listener all read that ONE table.

A row reaches it in one of THREE ways:

- **Staging wrote it.** When `/cellwork` stages the planning team, the planner's and the splitter's own
  rows are recorded with that team's approval (`planning-team-staged`), so both have a seat before any
  split exists.
- **Activation put it there.** `cellwork_activate` raises one member per distinct `member` — a resumed
  pass reuses the rows the live roster already knows — which is what lets several tasks of one role run
  in parallel instead of queueing behind one session.
- **The live team record lends it.** A member staged with `agent_teams_plan {action:"add_member"}` after
  activation — or a re-raised/reseeded seat the cell row never learned — is known to the TEAM record by
  its `executorRef` but has no cell row. When such a session resolves to a seat of THIS cell's team on
  the CELLWORK VERB PATH, the row is ADOPTED before the verb runs, so `cellwork_handoff`,
  `cellwork_context`, `cellwork_status` and the checkpoint listener see the member as if activation had
  created it. The triggers are the verbs themselves, the `agent/pre-step` checkpoint listener and the
  `agent/turn-stopping` barrier listener; the TOOL GUARD is deliberately NOT one of them — its seat
  lookup is read-only, so a dispatch it permits or refuses writes nothing. The mirror is field by field
  (`name`, `role`, `sessionId` = `executorRef` = the team row's `executorRef`, `mode: "member"`,
  `handoffReady: false`, `handoffs: 0`, `joinedAt` now) and carries `adopted: true`; it is persisted once
  with a `member-adopted` journal row. Adoption is IDEMPOTENT: a second call resolves through the cell
  row and writes nothing. The `member-adopted` journal row is written only AFTER the record write
  lands, so a failed adoption leaves no history for a row that never existed. An adoption the record
  cannot PERSIST is reported instead of silently assumed: `cellwork_handoff` refuses BEFORE the team
  plane is touched and names WHICH half failed — the record could not be READ, or the write did not
  land — so a team checkpoint never exists without an adopted cell row.

Three invariants are the whole rule: an adopted row starts with `handoffReady: false` (adoption opens
the checkpoint channel; it never claims a checkpoint); the mirror never carries `fenced`; and adoption
NEVER creates it over an existing row — a fenced or checkpoint-mode row stays exactly as it is, and the
verb behaves exactly as it did before adoption existed. `adopted` is additive and preserved across reads —
including the barrier's own row rebuild — so a row that appeared after activation stays distinguishable
from one staging or activation created (its absence means staging or activation wrote the row).
**The refusal that remains:** a session that resolves to NO seat of this cell's team is refused exactly
as before — `cellwork_handoff` answers `this session belongs to no active cell` — and nothing is adopted;
the legacy `"<name>" is not a recorded cell member` survives only when the record names a seat whose row
is genuinely absent (a member key whose spelling disagrees with the recorded `name`, as in a hand-edited
or older record). The bound: adoption covers members the TEAM record already knows; a session the team
record does not carry still has no channel, by design.

**Elastic execution seats (the elastic-planning wave).** On every dispatch pass — `cellwork_dispatch`
and the activation's initial pass — a READY task whose declared owner names a LIVE member that is not
idle (BUSY, or holding another claim) may GROW a seat instead of waiting:

- the owner's BASE is its name with a trailing `-<n>` (`n >= 2`) removed, and its ROLE is the roster
  role whose spelling matches that base (case/space/hyphen-insensitive); a base that names no roster
  role REFUSES growth for that task with the reason `owner base "<base>" is not a roster role`;
- an EXISTING idle seat named `<base>-<n>` (smallest n) owned by the same role is REUSED before a new
  one is created;
- otherwise ONE seat `<base>-<n>` is appended to the live roster through
  `agent_teams_plan {action:"add_member"}` WITH its `role`, recorded on the cell record (`grown: true`),
  journaled as ONE `seat-grown` row (task, name, role, reason), and PAIRED in the SAME pass through
  `agent_teams_dispatch {action:"run", reassign:[…]}` — so the pair is real, not a claim no seat can
  ever receive.

The caps: `cellwork.seats.maxPerRole` (default 8) seats per base and `cellwork.seats.max` (default 32)
execution seats per cell. A capped task keeps the BUSY skip, and the reason MUST name the cap and its
value. Growth NEVER happens for a planning seat (`cell-planner`, `cell-splitter`, `cell-analyst-*`), a
verifier-only seat, a seat in `checkpoint` mode or fenced, a blocked task, a task already claimed, or a
row claimed by the captain. Growth is idempotent: two passes over the same board create no second seat
while an idle one exists, a name is never duplicated on the roster, and a crash between the append and
the cell-record write is repaired by the next pass adopting the live roster row. A mid-run
`add_member` that carries NO `role` is legal but the answer WARNS (one sentence) that the seat may not
match a role route — resolution also reads the description head and the member name, and neither is
guaranteed — in which case it inherits the calling session's route; passing `role` is still recommended.

## Fenced members, reassignment and the unfence lever

A member can reach a state where it must not be woken: its recorded `mode` is `checkpoint`, or it wrote
a handoff that is still waiting for the compaction barrier, or the barrier gave up after its retry
budget (`compactionRetries`) and marked it `fenced: true` with a `fencedReason`. ONE predicate reads the
three signals, and a fenced member is never messaged.

- **Dispatch skips a fenced owner and leaves the row pending.** The skip reason is the TEAM PLANE's own
  sentence: it names the member, the cause and the repair the plane recommends — `reassign` the row to
  another member (`agent_teams_dispatch {reassign:[{task_id, owner}]}`). It does NOT name `unfence`,
  which is cellwork's own lever for clearing the fence (below); no other member is substituted.
- **`cellwork_dispatch {reassign:[{task_id, owner}]}` moves the ROW.** For each pair, BEFORE the pass,
  the row is claimed on the board for that member, journaled as `task-reassigned` (from → to), then
  delivered the normal dispatch message. Every outcome is reported (`reassigned` plus one line per
  unreadable entry in `reassignInvalid`) and nothing is thrown. A terminal row is never reopened, an
  unknown member is never substituted, and a fenced TARGET is refused — unfence it first, or pick an
  unfenced member. So is a target that FAILED to start (a row claimed for it would never be picked up)
  or is still PROVISIONING (retry once it is running); the delivery goes to the freshest NON-BLANK
  handle, so an empty recorded `executorRef` falls through to the live roster's handle.
- **A give-up fence has its own lever: `cellwork_dispatch {unfence:[…]}`.** A fenced row keeps
  `handoffReady: true`, so `cellwork_handoff` refuses it as STILL WAITING for the compaction barrier,
  while the only other clearer is another SUCCESSFUL barrier that a fenced member cannot start: the
  member cannot recover by itself. The captain's `unfence` list runs BEFORE the pass, and the decision
  is made PER RECORD because the compaction barrier writes the give-up in exactly one place. A CELL row
  with `fenced: true` IS the give-up, whatever the TEAM row says: it DELETES `fenced`/`fencedReason`
  (the keys are removed, never `fenced: false` — the normalizer forbids that spelling), restores
  `mode: "member"`, sets `handoffReady: false`, keeps `handoffs` unchanged and journals
  `member-unfenced`, AND reopens the TEAM seat through the plane's `unfence` seam (the plane treats
  `mode: "checkpoint"` as closed and that seam clears it too). The answer carries
  `{member, unfenced: true, plane, planeReason?}` per cleared CELL row and reports the plane's half as
  `unfenced`, `absent` or `refused`, never claiming a reopen that did not happen.
- **A pending checkpoint is NOT a give-up.** Every handoff sets the TEAM row's `mode: "checkpoint"`
  while the compaction barrier still owes the reopen, and that row carries no `fenced` key. A seat is
  BARRIER-OWNED when ANY of these holds: the CELL row's `mode` is `checkpoint`, its `handoffReady` is
  `true`, or the TEAM row is at `mode: "checkpoint"`. Asking to unfence it WITHOUT `force` answers
  `{member, unfenced: false, reason: "checkpoint-pending", detail}` — the barrier owns that state — and
  NEITHER record is written and the seam is NOT called, including when only the CELL row shows the
  window (that case used to answer the contradictory `not-fenced`). The CELL `fenced` marker above
  outranks this: a real give-up is recovered even while its TEAM row still reads `mode: "checkpoint"`.
- **The bounded FORCED lever: `unfence: [{member, force: true}]` (R4.4, last resort).** A bare string
  keeps the unforced behaviour byte-identically, so nothing forces by accident; the object form is the
  only way to ask for the lever, and it is FAIL-CLOSED: it REFUSES outright when the recorded session is
  still a live agent (`reason: "live-session"`), and otherwise allows the clear only when a WRITTEN bound
  is reached — `barrierFailures` at `compactionRetries` (reason `retry-budget`) or a `checkpointSince`
  older than `checkpointPendingMaxMs`, default 15 minutes (reason `stale`). A missing timestamp with
  zero recorded failures is NOT a licence (`reason: "force-not-eligible"`): the timestamp may fall back
  to the last `checkpoints` entry for that session, and when neither exists nothing is eligible. A
  permitted clear deletes `fenced`/`fencedReason`/`barrierFailures`/`checkpointSince`, restores
  `mode: "member"` with `handoffReady: false`, keeps `handoffs`/`joinedAt`/`adopted`, asks the plane to
  reopen the TEAM seat best-effort, journals `member-unfenced-forced`
  (`{member, by: "captain", reason, pendingMs, barrierFailures, sessionId, liveness, plane}`) and answers
  `{member, unfenced: true, forced: true, alive, liveness, sessionId, bound, pendingMs?, plane}`. **It reopens the
  seat for REASSIGNMENT, not for work**: the context was never compacted, so a delivery would resume the
  very context the handoff document already describes.

  **THE DEAD-RESEED SEAT IS COVERED BY THE SAME PREDICATE (R5.2).** A reseed writes `subcaptain` with
  `handoffReady: false` and reopens the TEAM row to `member`, so NO checkpoint spelling holds it — and
  when the fresh child is not a live agent (`liveness: "dead"`: the registry is present, its CAPTAIN
  anchor resolves, and it answers nothing for the recorded session) no turn will ever fire for it again.
  That seat is HELD all the same, its licence is the
  PROVEN-DEAD session (`bound: "dead-session"`), and its window's stamp is still required: an unstamped
  row falls back to the retry budget and, with neither, answers `force-not-eligible`. An ABSENT registry
  — or a present one that cannot resolve the CAPTAIN anchor — is `unknown`, never dead, so nothing is
  proven and nothing is cleared. **ONE predicate decides every
  one of these answers** — `barrierOwned`, the dead-reseed shape, the live veto, the stamp, the bound —
  and `cellwork_supervise` projects the SAME reading, so the lever the sweep advertises is exactly the
  lever this verb accepts (the two used to be separate predicates, and the sweep advertised a lever the
  verb refused as `not-fenced`).
- **`not-fenced` is reported, never dressed up.** A member that NEITHER record fences AND carries no
  checkpoint window answers `{member, unfenced: false, reason: "not-fenced"}` and the record is NOT
  rewritten. A name resolves
  UNAMBIGUOUSLY — exact member key, then exact display name, then the normalized key only when it is
  non-empty and carried by EXACTLY ONE member; anything else (unknown, or ambiguous such as `1` against
  后端1/前端1) refuses the WHOLE call and names the recorded members. Nothing is cleared, written or
  dispatched, so a typo never half-applies a list.
- **The TEAM seat moves only when the composition exposes the seam.** `mpdTeamActions.unfence` reopens
  the team seat and the outcome says `plane: "unfenced"` (that seam clears both an explicit fence and
  the `mode: "checkpoint"` window); a composition without it answers `plane: "absent"` with a
  `planeReason` saying the TEAM seat was NOT reopened, so the cell-row repair stands and the answer does
  not pretend both halves landed (`plane: "refused"` carries the plane's own sentence). A fence that
  exists ONLY on the TEAM record is its own case: the seam clears it and the CELL row is left untouched,
  so the outcome carries `cellRow: "untouched"` and `unfenced` reflects the plane's half alone. `unfence`
  and `reassign` may travel in ONE call — the unfence runs first, so the pass may hand a row to the
  member it just reopened — and neither interferes; a refusal after an unfence still reports what the
  unfence changed. The lever clears records; it does not re-create a dead session.
- **A reassignment changes what the same pass reports.** The target now OWNS an in-flight row, so its
  OTHER ready rows are reported BUSY by that pass (one task per member per pass) instead of being
  queued. That is the existing dispatch rule, not a regression: run another pass later.
- **A second handoff is refused while the first waits for the barrier.** `cellwork_handoff` answers
  "END YOUR TURN": the barrier reads only the latest ordinal, so a second document costs continuity
  instead of saving it (the VEdit livelock wrote three in seven minutes).
- **A given-up barrier records its consequence.** The member gets `fenced: true` + `fencedReason`, the
  journal gets a `checkpoint-unrecoverable` row naming the repair, and `cellwork_supervise` lists every
  CLOSED seat together with the OPEN board rows it still owns, marking each as a GIVE-UP fence (the
  captain's to repair) or BARRIER-OWNED (the pending checkpoint window). A barrier-owned seat is NOT
  automatically safe: nothing supervises the barrier — no timer, no queue, no retry owner — so the sweep
  reports `barrierOwned`, `forceEligible` and `pendingMs` and names the bounded forced lever instead of
  promising that no action is needed. The unfence lever above is how the give-up consequence is
  repaired. **The retry bound**: each non-reopening barrier run increments the CELL row's
  `barrierFailures`, and the run that reaches `compactionRetries` fences the seat with a `fencedReason`
  naming the count (`N of M consecutive barrier runs did not reopen the seat`); a reopening
  (`promoted`) run deletes both `barrierFailures` and `checkpointSince`. That bound only covers a seat
  that STAYS in the window across runs — a seat whose session died starts no further run and is bounded
  by the forced lever below.

**The generic team verb is OWNER-ONLY by default; only its explicit roster mode carries a hazard that
cell mode does not.** `agent_teams_dispatch` pairs a ready task with its DECLARED OWNER, and the positional
fallback exists ONLY behind the explicit `mode:"roster"` argument. That mode is what handed a REVIEW
task to the member that had WRITTEN the reviewed lanes during the field wave; the captain released the
pairing immediately, restored the row to the independent reviewer, and the writer disclosed it had only
run `git diff --stat`, a marker grep and a directory listing before it was stopped, so no verdict
existed and no contaminated judgement was recorded. `cellwork_dispatch` is OWNER-ONLY and never
substitutes. Outside cell mode, **wait for the declared owner or reassign deliberately**
(`agent_teams_task {action:"release"}`, then a fresh pairing), and never treat review-by-writer as a
merely theoretical risk.

## Tool surface

| Tool | Caller | What it does |
|---|---|---|
| (the `/cellwork` command) | you | writes the one cell record and submits the one activation directive |
| `cellwork_start` | captain | opens the requirements phase of the active cell; validates cell and caller, stamps `startedAt`, journals it |
| `cellwork_status` | captain, member | phase, objective, captain, requirements/split revisions, members with their modes AND their seat liveness (`liveness: live | dead | unknown` from the identity registry, the shared `closed` / `forceEligible` / `forceRefusal` closure reading, and `suspect` / `deadReseed` / `unverified`), injected checkpoints, live team counts, the recorded split-ticket board id, the cell-record vs live-roster divergence (`missingFromCell` / `missingFromTeam` / `inSync`), the caller's own seat and the on-disk paths — its ONE write is ADOPTING a live team seat the record never learned, never a phase transition |
| `cellwork_requirements` | planner | `finalize` a requirements document, or `update` it: an update bumps the revision and marks the split stale; a section body runs to the next heading of the same or a higher level, so `###` subheadings stay inside their parent |
| `cellwork_recon` | planner, subcaptain | READ-ONLY consult (Explorer/Researcher) raised through `mpdConsults`, so the roles row applies its read-only deny list to the child and places it one level below the caller as a LEAF (`cellwork.depthMax` counts nested CELLS and never caps the child); `{role, task}` returns one report (the legacy shape), `{role, questions}` runs 1..`cellwork.recon.maxQuestions` (default 16) CONCURRENTLY and returns only when all are settled, one row per question; every report is journaled |
| `cellwork_delegate` | planner, subcaptain, member | start 1..`cellwork.delegate.maxTasks` (default 32) BACKGROUND consults in ONE call and return their `consultId`s immediately, before any child settles; roles are ANY roster role (writers included) and are canonicalised by the roles row; ALL-OR-NOTHING validation (an unknown role, an empty field or more tasks than that bound starts nothing); over-cap work QUEUES on the ONE shared supervisor (the per-start budget is `cellwork.consultMax`, default 32; a declared `MPD_DSH_CONSULT_MAX` wins) and the queue itself is UNBOUNDED |
| `cellwork_consult` | planner, subcaptain, member | `list` / `wait` / `collect` / `cancel` the consults THIS cell started through `cellwork_delegate`: `list` answers only this cell's ids the supervisor still knows, `wait` clamps to 1..60000 ms (default 30000) and answers `state:"running"` when the bound wins, `collect` returns the report and RELEASES the record, `cancel` interrupts and journals `consult-cancelled`; an id this cell did not start is refused with a teaching sentence |
| `cellwork_split` | splitter | `submit` a graph so the plugin can measure it (each task may declare its board `member`), or `show` the last verdict; every refusal persists its findings at `split/<revision>.refused.json`; a NON-FATAL `warnings` list names every `work`/`repair`/`integration` task with no write scopes (`write-scopes-empty`) and every owner role whose ready-frontier width exceeds its declared `member` names (`seat-width-short`), by key, and never changes `accepted` |
| `cellwork_activate` | captain | materialise an accepted split on the live team record, write contracts (owner role AND member), raise one member per distinct `member`, open verify loops, dispatch; a failed pass is checkpointed and the SAME revision resumes it, while a newer accepted revision supersedes an older in-flight one; the answer's `reused` list names the members resolved from the cell record or the live roster instead of raised, and a re-split that kept tasks also returns a `notice` (contracts not rewritten, scope expansion needs a manual re-freeze plus a new verify loop, ready rows dispatched owner-only); the OTHER ways a member row appears are staging and adoption (see "Members: staged, activated or adopted") |
| `cellwork_dispatch` | captain | one owner-only dispatch pass over the team board; a busy, absent or fenced owner is reported and the row left pending; `reassign` hands named rows to another member FIRST (board claim → `task-reassigned` journal → delivery), and `unfence` clears named members' GIVEN-UP fences BEFORE the pass (both keys deleted, `mode: member`, `handoffReady: false`, `handoffs` kept, `member-unfenced` journaled; the TEAM row only through the plane's `unfence` seam, with `plane: "absent"` reported when the composition exposes none); a PENDING/barrier-owned window (CELL `mode: checkpoint` OR `handoffReady: true`, or the TEAM row at `mode: checkpoint`, with no `fenced` flag) — and the DEAD-RESEED seat (R5.2: `subcaptain`, not handoff-ready, recorded session proven dead) — answers `checkpoint-pending` and writes nothing unless the entry asks for the FAIL-CLOSED forced lever (`{member, force: true}`: refused for a live session, allowed only at the retry budget, past `checkpointPendingMaxMs`, or ON the dead-reseed shape's proven-dead session with a recorded stamp, `bound:"dead-session"`, journaled as `member-unfenced-forced`); a plane half that ends `refused` carries `retry` (the exact `agent_teams_control {action:"unfence", member}` verb) in the answer, the journal row and the render; `rebind: [{member, handle}]` RE-POINTS a seat's TEAM `executorRef` to the handle the seat's CURRENT record names (the journal only corroborates: its latest hand-over decides only when NEITHER current row names a handle), through the record file (same compare-and-set and plane read-back as the reseed bind: a concurrent commit answers `team-record-changed` and is never overwritten), mirrors that handle into the CELL row (`sessionId`, `executorRef`, `mode: member`, `handoffReady: false`), journals `member-rebound` and reports `rebound`; the `handle` is trimmed, must be the host-minted UUID form, and must be named by a CURRENT record — the TEAM `executorRef` or the CELL row; a record written after the last hand-over with no journal row of its own is accepted and marked `handleRecordCurrent:true`/`journalHandoverOlder:true` (never `handle-superseded`, never advised backwards). A handle only an OLDER hand-over row names is refused `handle-superseded` with the superseding row named and a reconcile sentence that never chooses a direction (the journal is append-only, so an old failure sentence still quotes a child a later reseed replaced); a handle nothing current names is `handle-unevidenced` (ownership is evidence; the registry proves liveness only); every outcome reports `namedBy` (`team`/`cell`/`journal:<event>`) plus `previousSessionId`/`previousSessionIdLiveness` (`live`/`unproven`/`unknown`), a landed re-point also carries `displacedExecutorRef`/`displacedUnproven`, and every failed entry — an argument refusal included, which records the requested `handle` — is journaled `member-rebind-failed`; it never clears a fence, and `unfence` alone never re-points the handle; `not-fenced` is honest, an unknown or ambiguous name refuses the call, and the forms may travel together |
| `cellwork_supervise` | captain | read-only sweep: pending checkpoints, compactions, promotions, stale splits, unread mail, every UNDELIVERED mail row, and every CLOSED seat with the open rows it still owns — each marked `giveUp:true` (an explicit `fenced:true` on either record, repaired with `reassign` plus `unfence`) or `giveUp:false` (a held seat: a barrier-owned window, or the DEAD-RESEED shape flagged `deadReseed:true`), which also carries `barrierOwned`, `forceEligible` and `pendingMs` and names the bounded forced lever when no supervisor can reopen it; `forceEligible` is the SAME predicate `cellwork_dispatch {unfence:…, force:true}` decides with, never a second copy; a closed seat whose TEAM half is a `checkpoint` no barrier is pending for carries `retry`, the exact Lead-only verb that reopens it; a member is `suspect:true` only when a window stamp exists, the registry is PRESENT, its CAPTAIN anchor resolves, and the recorded session does not (a present registry that cannot resolve the anchor is `unknown`, which licenses nothing); an `unknown` liveness NEVER suppresses the row — a `subcaptain` that left the barrier's window with an unprovable session is listed `unverified:true` with `forceEligible:false` and its `forceRefusal`, reported as unverified instead of vanishing into health; every projection is lossless JSON, with no `undefined` own key |
| `cellwork_context` | member | the caller's own live occupancy, the window it was measured against, and that window's provenance |
| `cellwork_handoff` | member | write and validate the checkpoint handoff document; marks the checkpoint ready; a SECOND document is refused while the first still waits for the barrier; a member known only to the LIVE team record is adopted first (see "Members: staged, activated or adopted"), so it gets the same channel |
| `cellwork_subteam` | promoted subcaptain | register a sub-cell, enforce the depth cap, return the sub-captain directive |
| `cellwork_send` | any cell agent | cell-aware addressing (member, captain, another sub-cell) plus transport delivery and a journal row: the durable row lands first, and the wake-up attempt is appended after it as a separate `wake` record |
| `cellwork_inbox` | any cell agent | read and acknowledge the caller's unread cell mail |
| `cellwork_stop` | captain | end the mode: archive the cell (no deletion), clear the guard, give the tools back; REFUSED while a board task is `claimed`/`in_progress` unless `force:true`, and a forced stop is journaled as such |

The one-call view for a bystander is `cellwork_status`; it never transitions the cell, and its ONE
write is the adoption described above (the first write `cellwork_context` or `cellwork_handoff` may
perform for a member the record never learned is the same one). Every other verb either mutates the cell
record or returns a verdict about it.

## The guard modes

ONE `tools.guard` predicate is installed per plugin. It resolves the calling session and looks it up
in the live cell tree: a session in no cell is untouched, which is what makes the mode free while it
is off. The predicate fires at **dispatch** time only.

| Caller | Allowed | Refused |
|---|---|---|
| captain | `cellwork_*` except `cellwork_handoff`, `cellwork_delegate` and `cellwork_consult`, plus `agent_teams_*`, `ask_user_question`, `todo_write`, `mpd_memory_*`, and the ONE loop opener `mpd_verify_open` (exact name only) | everything else: no file edit, no shell, no `read`/`grep`/`glob`, no background consult of its own (the captain stays dispatch-only), and no verification beyond opening a loop: binding a seat, recording a verdict, evidence and escape stay refused |
| verifier | `read`, `grep`, `glob`, `bash` (the gates), `mpd_verify_*` | `write`, `edit`, `mpd_hashline_edit`, `mcp__ast_grep__rewrite`, `mcp__ast_grep__scan`, `mcp__lsp__rename_symbol`, `mcp__lsp__rename_symbol_strict`, the two bundle spawn tools `mpd_role_spawn` / `mpd_workmate_spawn`, `mpd_role_spawn_async` / `mpd_role_consult`, and this package's own `cellwork_delegate` / `cellwork_consult`: a verifier NEVER delegates, because the verdict is its own work and a FAIL is the channel back to the writer |
| member at its context checkpoint | `cellwork_handoff`, `cellwork_context`, `cellwork_status` | everything else: the agent cannot keep working even if it ignores the prose |
| subcaptain | the captain allowlist MINUS `cellwork_start` / `cellwork_stop`, PLUS `cellwork_subteam`, `cellwork_activate`, `cellwork_dispatch`, `cellwork_supervise`, `cellwork_delegate`, `cellwork_consult` | every file-work tool: a subcaptain is a mini-captain and dispatches, it does not implement |
| planner (`cell-planner`) | `read`/`grep`/`glob` inside the documentation band: `.mpd/**`, `docs/**`, `evidence/**`, `agent-references/**`; any `AGENT.md`/`AGENTS.md`/`CLAUDE.md` by BASENAME at any depth, also outside the workspace root; and at the workspace root only `README.md`, `README.zh-CN.md`, `CHANGELOG.md`, `LICENSE*.md` | a SOURCE path: the refusal names the two delegation routes (`cellwork_recon` with `Explorer`/`Researcher`, `mpd_role_spawn` with a read-only roster role) and says why. A path is judged by its SPELLING (symlinks are never resolved), and a `..` segment is allowed ONLY in an instruction-file spelling |
| ordinary member | everything it needs to work, `cellwork_delegate` and `cellwork_consult` included | nothing: it is a normal worker |

Every refusal is ONE teaching paragraph: what was refused, the calls that replace it, and
`cellwork_stop` as the way out. Stopping the cell removes the seat, so the same session is unguarded
again.

Two rows are the repository's reconnaissance rule rather than a cellwork invention. The planner's band
is the SAME band the top-level `mpd` captain keeps, and a parity test imports both lists so they cannot
drift apart. Inside a cell the planner's reconnaissance is DELEGATED, and a consult is a LEAF: the
roster's spawn tools forward the caller's recorded delegation depth + 1 AND deny both spawn tools in the
child's own scope, so the child can never delegate again; a caller already at delegation depth 2 or
deeper is refused by those TOOLS (do the work, or hand the question up). The three cellwork consult
verbs do not go through that floor: they start through the `mpdConsults` service, which places the child
at caller depth + 1 — one level below the caller, a leaf — and forwards no absolute cap.
TWO SCALES, not one. `cellwork.depthMax` (1..8, default 3) is the CELL-TREE scale: it counts nested
CELLS and teams, and `cellwork_subteam` refuses `depth + 1 > depthMax`. AGENT delegation depth is a
separate scale the harness records per session: a cell seat is a TEAM MEMBER, so the planner sits at
delegation depth 1 in the shipped topology, and the seats of a NESTED cell sit one level deeper than the
cell that raised them. The two numbers do not coincide, which is why the cell cap is never forwarded as
the child's agent cap — at the legal value `depthMax: 1` that forwarding disabled every consult. The cell
captain sits at the opposite end. Its read surface is the cell record, through these tools, while OUTSIDE cell mode the `mpd` captain's
band now admits `AGENT.md`/`AGENTS.md`/`CLAUDE.md` at any depth, including a sibling project's, and
still refuses every source path.

## Background delegation

A cell SEAT — the planner, a promoted subcaptain, an ordinary recorded member — can dispatch work that
runs in the BACKGROUND, the way the top-level captain uses `mpd_role_spawn_async` + `mpd_role_consult`.
The cell CAPTAIN deliberately cannot: its route is the board (`cellwork_split` → `cellwork_activate` →
`cellwork_dispatch`), and a captain that raised its own consults would be doing work instead of
dispatching it.

- `cellwork_delegate {tasks:[{role, task, context?}, …]}` starts 1..`cellwork.delegate.maxTasks`
  (default 32) consults in ONE pass and returns
  `{ok, started, consults:[{consultId, role, startedAt}]}` immediately — the children keep working while
  the seat continues. Roles are ANY roster role (writers included) and are canonicalised by the roles
  row's OWN resolver, so `DeepWorker`, `deep worker`, `deep-worker` and `Deep Worker` are ONE agent and
  the answer echoes the roster's own spelling. Validation is ALL-OR-NOTHING: an unknown role, an empty
  `role`/`task` or more tasks than that bound refuses the whole call and starts NOTHING. That rule covers
  VALIDATION only — a partial batch is still possible: if a start fails AFTER some children were already
  started, the answer is `ok:false` naming the ids that DID start, and those children keep running and
  stay recorded (collect them with `cellwork_consult`).
- `cellwork_consult {action, consultId?, timeoutMs?}` settles them: `list` (only the ids THIS cell
  started and the supervisor still knows), `wait` (1..60 000 ms, default 30 000 — a timed-out wait
  answers `state:"running"`, never a throw), `collect` (returns the report AND releases the record) and
  `cancel` (interrupts the child and journals `consult-cancelled`). An id this cell did not start is
  refused with a sentence that names the ownership rule and the two other channels, never "not found"
  alone.
- Both verbs go through the `mpdConsults` SERVICE the `mpd-roles` row provides over its ONE consult
  supervisor: ONE registry, ONE concurrency cap and ONE silence deadman. The cap cellwork hands that ONE
  supervisor is `cellwork.consultMax` (default 32, `1..256`), a PER-START budget — an explicitly declared
  `MPD_DSH_CONSULT_MAX` ALWAYS WINS over it, and with neither the row default is 8. Over-cap work QUEUES
  and is never refused, and the QUEUE ITSELF HAS NO LENGTH BOUND: the cap bounds ACTIVE children only. A
  HOST refusal (`ACTIVATION_LIMIT_REACHED`) is a QUEUE signal, not a failure: the MPD slot is released,
  the consult waits a bounded off-slot backoff (250 ms → 4 s), re-enters at the FRONT of the FIFO, and is
  retried up to 8 times before it settles with a sentence naming `maxActiveSubagents` in Settings →
  Subagent limits (32–64 for cellwork); `cellwork_consult {action:"list"}` reports `hostRetries` per row.
  A composition without that row is refused BY NAME; there
  is no unsupervised fallback spawn. Because ALL THREE consult verbs (the two new ones AND the legacy
  `cellwork_recon {role, task}` form) go through that service, a composition that mounts cellwork
  WITHOUT the `mpd-roles` row loses the legacy recon form too; the shipped bundle mounts both rows, so
  only a hand-built composition is affected.
- `cellwork_recon` gained the same door plus a BATCH form: `{role, questions:[…]}` asks
  1..`cellwork.recon.maxQuestions` (default 16) questions,
  runs them CONCURRENTLY and returns only when all are settled (one failing question does not cancel the
  others — its row carries the failure text and `stopReason:"failed"`). `{role, task}` keeps exactly its
  old fields, and a ONE-question batch also carries the legacy `report`/`stopReason` pair.

Delegated children remain LEAVES: the roster denies both spawn tools in every child's own scope, and a
read-only role (Explorer, Researcher) gets the read-only deny list as well.

### Consults appear on the DAG

The consults a seat starts are first-class NODES of MPD's DAG on BOTH surfaces — the TUI MPD page and
the web Team view — drawn inside the grouping box of the cell that started them, and they stay on the
graph after they settle, until that cell ends.

- **Where they live.** Each start writes ONE `running` row onto the cell's team record
  (`.mpd/team/teams/<id>.json`); the shared graph model is built from that record and cached against the
  change feed's revision, so a consult refreshes both surfaces through the SAME write → `teamStateChanged`
  → revision path a board edit uses. No second watcher, no second store, no new route.
- **They are NOT tasks.** A consult takes no `T<n>`, is never dispatched, is excluded from the board
  tallies, `readyTasks`, the clean-terminal rule and the verifier's scope, and contributes NO edge and NO
  rank: the task picture is byte-identical with and without them. It draws with the existing six-state
  tone (`interrupted` reads as `cancelled`) plus one marker — `@` on the TUI card, the same glyph on the
  web card — and its id is `C<n>`, or `<teamId>::C<n>` inside a subcell's box.
- **A settled consult is recorded WITHOUT a seat asking.** The roles row's `mpdConsults.start` takes an
  optional `onSettled` observer, fired once when the record leaves `running`; cellwork uses it to write
  the terminal row. The `wait`/`collect`/`cancel` answers write the same row as a second, idempotent
  source. `cancel` therefore shows up immediately, and a completed consult does not sit on the graph
  reporting itself as running.
- **A subcell's consults are drawn INSIDE that subcell's box**, because the projection hands each live
  child's rows to its own frame; the liveness filter that drops a finished child drops its consults with
  it.
- **`cellwork_stop` clears them** (a forced stop too): the rows are removed from the team record and the
  in-memory consult book is dropped, so a child that settles later cannot re-create a row.
- **Declared bounds.** A cell that never stops cleanly keeps its rows until they age out through the
  retention cap (50 per team, oldest SETTLED first, never a `running` row). A consult started while the
  cell has no live team (`teamId` empty, so no board was ever approved) records NOTHING — one
  `consult-unattached` journal row is the only trace, and the tool answer is unchanged. The record's
  read-modify-write has the same cross-process exposure every team write has (no compare-and-swap), a row
  stays `running` if the process dies before settlement (nothing sweeps it; the cap eventually does), and
  the TUI's host subagent strip is NOT deduped, so a running consult can appear twice — the host row
  until its 60 s grace expires, and the DAG node, which is the durable surface.

## The context budget: measured, never guessed

The mode makes two different promises about context, and they use two different fractions:

- **Split time**: no task may be estimated at more than **1/4 of the window** it will run against
  (`windowFraction`, default `0.25`).
- **Runtime**: an active member at **1/2 of its OBSERVED window** (`checkpointRatio`, default `0.5`)
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
file is refused with the number in front of it: `file X = 2,097,152 bytes ≈ 699,051 tokens > budget
250,000`: instead of a hand-wave, and an accepted task is priced against files that were really
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

1. **Detect**: the host-plane row's `agent/pre-step` listener resolves the calling agent, reads the
   context pressure, and for an active cell member at or above `checkpointRatio` records
   `checkpoint injected` and returns an `enter` decision carrying one extra message:
   `[mpd-cellwork] CONTEXT CHECKPOINT … stop work, call cellwork_handoff, end your turn`.
2. **Stop**: the same mode switch flips the session into `checkpoint`, and the guard refuses every
   tool except `cellwork_handoff`, `cellwork_context` and `cellwork_status`. Prose is the explanation;
   the guard is the enforcement.
3. **Handoff**: `cellwork_handoff` validates the required sections (task, state, decisions,
   artifacts, verified facts, open questions, next step), writes `handoff/<member>-<n>.md`, journals
   it and marks the checkpoint `handoff-ready`. The directive tells the agent to end its turn and do
   nothing else.
4. **Compact**: on `agent/turn-stopping` the listener RETURNS the barrier promise, so the host's serial
   dispatch AWAITS it instead of racing a detached one. The barrier does NOT wait for the agent to be
   idle: it makes at most `compactionRetries` attempts, sleeping `idleBarrierDelayMs` BETWEEN them (there
   is no sleep before the FIRST one), and resolves the engine from the LIVE member handle the event
   carries — through `compactionEngineForLiveAgent`, BEFORE any sleep and BEFORE the registry lookup — so
   a member already detached from `ctx.agents` still reaches its own realm's engine; only when that
   handle carries no engine does the id-keyed `compactionEngineForAgent` get a chance. The engine is
   driven with a real `AbortController` signal, and the outcome is classified and journaled: a `null`
   result (no safe useful range), a `busy` agent and an `error` are all recorded, so a retry budget
   running out is never a silent no-op. **`busy` on EVERY attempt is the host's own bound, and the
   journal says so** (R4.0): the engine's `compactNow` runs inside `agent.runMaintenance`, which refuses
   any phase but idle, while `agent/turn-stopping` is dispatched INSIDE the turn and its listeners are
   awaited — so in-place compaction cannot run at this event on this host, and waiting cannot change it
   (the host awaits the listener's promise before it can reach idle). The reseed is therefore the only
   path from this event, and the reason text records that fact instead of leaving `busy` unexplained.
5. **Promote or reseed**: the outcome union is exactly `promoted | reseeded | refused`. On a successful
   compaction the SAME member is promoted in place — no interrupt, no reseed — its session's mode becomes
   `subcaptain` and it receives the promotion directive (depth + 1, the remaining scope taken from the
   handoff, the sub-team protocol). If there is no safe range, or compaction fails, the ORIGINAL
   session is INTERRUPTED (retired through its live ancestor — the reseed path never `dispose`s it) and a
   fresh child is started with the handoff text as its prompt plus the same promotion directive — but
   never from the member's own dead Agent: the reseed parent is, in order, the member's
   recorded `parentSession` resolved live, then the cell's captain, and when neither is live the barrier
   REFUSES with the distinct reason `reseed-parent-unavailable`. The parent actually used is journaled
   (`parentSource` + `parentSessionId`), so lineage is observable rather than inferred.

   **THE RESEED BINDS ITS SEAT OR SAYS IT DID NOT (R1).** A resolved child handle is not yet a seat. Before
   anything is journaled as `reseeded`, THREE surfaces must name the fresh handle: the TEAM member row
   (`executorRef` = the new handle, `mode` back to `member`, the handoff kept as history), every
   NON-TERMINAL board row whose `owner` is the old handle OR the seat's own name (both spellings are the
   same seat), and the CELL row the barrier itself writes. A TERMINAL row — `completed`, `failed` or
   `cancelled` — records who actually did the work, so its `owner` is never rewritten. If a surface
   refuses — an unreadable roster, a roster that never carried the seat, a
   record the plane does not read back — the run is a REFUSAL: it journals `checkpoint-unrecoverable`
   with `surface` naming the failure and `retry` naming the repair, fences the CELL row, and RELEASES the
   fresh child's activation (a child nobody can address must not hold a slot) — UNLESS the refused rollback
   shows a surviving document may still name it (below). `seat-rebound` is the row
   that reports what landed. **A READ-BACK THAT REFUSES A WRITE ALREADY LANDED IS ROLLED BACK:** the bind
   restores the pre-bind TEAM row (handle AND mode) and the pre-bind board owners, but ONLY while the file
   still carries the exact bytes it wrote. If another writer committed after it, the rollback REFUSES to
   overwrite that document (`rollback: "refused"`) and the journal row says so; a rollback that cannot be
   written is `rollback: "failed"` with its sentence in `rollbackReason`. The TEAM row and the board
   owners are written through the record file and
   VERIFIED by re-reading it through `mpdTeams`, because the plane exposes no verb that re-points them —
   DECLARED BOUND: when `mpdTeamActions` grows a seat-rebind verb, that write becomes a delegation and the
   path knowledge goes away.

   **A REFUSED ROLLBACK DOES NOT RELEASE A CHILD THE SURVIVING DOCUMENT MAY NAME (A11).** The other
   writer's document is now the authority, and the ordinary concurrent shape — team-core's own
   read-modify-write — carries THIS bind's fresh `executorRef`. Releasing that child would leave the
   surviving record pointing at a released seat, which is the stranded seat this whole fix removes. So the
   release is CONDITIONAL on evidence: only a surviving document that provably names ANOTHER handle (or a
   rollback that restored the pre-bind row) releases the child. A rollback that could not be written
   (`rollback: "failed"`) is the same unproven state — its own write or re-read did not land, so no reader
   can say the record stopped naming the child — and it keeps the child too. When the surviving document
   names the fresh handle, or cannot be read at all, the child is KEPT, the run refuses with `orphanChild:
   "<handle>"` and `reconcileRequired: true`, the sentence says `BINDING KEPT`, and the journal row's
   `retry`/`repair` names the verb that RECONCILES the two records:
   `cellwork_dispatch {rebind:[{member, handle}], unfence:[member]}` — `rebind` re-points the TEAM
   `executorRef` and mirrors the handle into the CELL row, while `unfence` alone NEVER touches the handle
   and `reassign` only moves board rows.

   **THE `rebind` HANDLE IS VALIDATED, AND ITS OWN CLAIMS ARE RECORDED (R2/R3/M1/N1/F1).** `rebind` trims the
   `handle` and accepts only the host-minted session form (8-4-4-4-12 hex UUID); anything else refuses the
   WHOLE call, so no seat is half-repaired, and the argument-level `member-rebind-failed` row records the
   requested `handle` it refused (bounded, with `handleTruncated` when cut), so a typo or a truncated paste
   is reproducible from the journal. The handle must also be named by this seat's CURRENT
   record: the TEAM row's `executorRef` or the CELL member row. **The current record wins; the journal only
   corroborates** — when either current row names the requested handle it is accepted, whatever the
   append-only journal says. The journal's recency decides ONLY when neither current row names a handle;
   otherwise it may explain a refusal but never overrule the record. This keeps a record write that lands
   after the last hand-over (and carries no journal row of its own) from being vetoed by an OLDER
   `compaction`/`seat-rebound`/`member-reseeded`/`reseed-parent`/`member-rebound`/`checkpoint-unrecoverable`
   `orphanChild`/`member-adopted` row: that answer would call the record's current handle stale and advise a
   BACKWARDS re-point. When the record names the requested handle but its write provably postdates the
   journal's last hand-over, the outcome carries `handleRecordCurrent:true` and `journalHandoverOlder:true`
   instead of a refusal. A request named only by an OLDER hand-over row is refused per entry
   `reason:"handle-superseded"`, and its `supersededBy` (also in the journal row and the render) names the
   later event and handle; the refusal states what the current record names and what the journal's last
   hand-over named and NEVER chooses a direction for the operator — it asks for reconciliation. A handle
   nothing current names is `reason:"handle-unevidenced"`. Both
   outcomes carry `namedBy` — `team`, `cell`, or `journal:<event>` — so the evidence source is never a dead
   field. Each outcome also reports `previousSessionId`/`previousSessionIdLiveness` (`live` only when
   `liveAgentExact` answers, `unproven` when the seam exists and answers nothing, `unknown` when the
   composition exposes no seam), and a landed re-point that overwrote a different handle carries the SAME
   `displacedExecutorRef`/`displacedUnproven` pair as the reseed bind (N1), on the answer, the
   `member-rebound` row and the render — a live-but-replaced child stays findable and never silently lost.
   Every FAILED entry is journaled as `member-rebind-failed` (an argument-level refusal included), so an
   attempted repair is never visible only in the answer. The handle a RESEED displaces is recorded too: when
   the TEAM row already named a different non-empty `executorRef` and nothing proved that child dead (the
   re-entry guard is inert there by design), the `compaction`, `seat-rebound` and `member-reseeded` rows
   carry `displacedExecutorRef` plus `displacedUnproven`, so an overwritten child stays findable.

   **ABSENT IS NOT UNREADABLE (F1).** A cell whose workspace holds **no team record** (`ENOENT` on
   `.mpd/team/teams/<id>.json`) answers `plane: "absent"`: there is no member row and no board to bind,
   and refusing a healthy child for a plane nothing created would be the defect, not the fix. A record
   that **exists** but cannot be read — corrupt JSON, `EACCES`, a plane read that throws, or an answer
   that is not a record — is the opposite case and is a REFUSAL: `checkpoint-unrecoverable` carries
   `surface: "team-record-unreadable"`, the seat is fenced, the fresh child is released, and the
   unreadable bytes are left untouched. The distinction matters because a record read that answers
   "nothing" cannot tell the two cases apart, and treating an unreadable surface as an absent one is
   exactly how a reseed reported success while nothing was bound.

   **THE BIND IS A COMPARE-AND-SET ON THE RECORD'S BYTES (F2).** The snapshot is taken from the same
   record file the bind rewrites; immediately before the temp+rename that file is re-read and the two
   copies are compared **as whole byte strings**. ANY byte change is a refusal — not merely a change to a
   field the bind happens to watch. The fields (`revision`, `updatedAt`, the member roster's hash) are
   only how the refusal EXPLAINS what moved in its `reason` sentence: evidence, never the predicate. If
   another writer committed inside that window, the bind REFUSES with
   `surface: "team-record-changed"` and the same failure shape (no `reseeded`, fenced seat, released
   child) instead of overwriting their write. The read → compare → temp+rename sequence is ONE synchronous
   block by contract: `atomicWriteText` is synchronous, so no write can interleave inside it **in this
   process**, and no `await` may be introduced inside the window.

   **THE CAS NARROWS THE WINDOW, IT DOES NOT CLOSE IT (F2's residual).** The compare and the rename are
   two filesystem calls, so a write from ANOTHER PROCESS that commits between them — after the compare,
   before the rename — is still overwritten: the window shrinks from "the whole build" to "two adjacent
   calls", it does not disappear. The repair is team-core's seat-rebind verb: once it exists this bind
   delegates the write, the record's owner makes the read-modify-write atomic on its side, and the
   residual goes away. Until then it is DECLARED, not erased.

   **THE REPLACEMENT IS TOLD WHAT TO DO (R2).** Its first prompt carries the handoff plus the promotion
   directive, and the barrier ALSO delivers that directive to the NEW handle through the team executor's
   `send`; `member-reseeded` records `directiveDelivered` (and `directiveError` when it could not land)
   instead of leaving the seat's idleness to inference.

   **NO BRANCH IS SILENT (R4).** A record re-read failure journals `barrier-record-unreadable`; a throw
   after the seat was handed over journals `barrier-failed`, which FENCES the seat with the forced lever's
   written licence (a `checkpoint` window whose `barrierFailures` reaches the retry bound) so the captain
   can see it and `cellwork_dispatch {unfence:[{member, force:true}]}` can clear it, and that throw also
   releases the activation it created. **THE RE-READ FAILURE WRITES NOTHING:** the record could not be
   read, so the barrier has no trustworthy merge base and NEVER writes its pre-await snapshot back (that
   is the lost update this branch used to cause). The refused bytes stay untouched, the row reports
   `fenced: "not-persisted"` with `forceEligible: false` and an explicit `recovery` sentence, and it never
   pretends a fence that nothing can see; the barrier re-runs on the member's next turn-end once the named
   file is repaired. The forced lever is named CONDITIONALLY, because it has two preconditions: this run
   persisted no fence to clear, and `cellwork_dispatch {unfence:[{member, force: true}]}` needs a WRITTEN
   bound (`barrierFailures` at the retry budget, or a `checkpointSince` older than
   `checkpointPendingMaxMs`) before it is eligible at all.

   **THE RECOVERY PATH IS NOT RE-ENTERED.** A run whose spawn succeeded but whose CELL row could not be
   written leaves the TEAM row naming the LIVE fresh handle while the CELL row still names the session it
   replaced and still says `handoffReady: true`. That child's own turn-end resolves back to the seat
   through the TEAM row, so a barrier that did not ask the question would raise a SECOND child for one
   seat. When the TEAM row already names a handle the identity registry proves live and that handle is not
   the CELL row's recorded session, the run spawns nothing, rewrites nothing, and journals
   `barrier-skipped` with `branch: "reseed-already-bound"`, the handle, the recorded session and the
   `rebind` repair that reconciles the two records. An EMPTY recorded session, an equal handle and a dead
   handle never trigger the skip: only a different LIVE handle is the recovery state.

   **The barrier OWES the seat its reopen, and this is its DUTY (R4.1).** `cellwork_handoff` writes TEAM
   `mode: "checkpoint"` when the document lands, and that spelling closes the seat for the guard and for
   dispatch. A barrier run whose PERSISTED ROW reopened the CELL seat (`fenced !== true`) therefore calls
   the plane's `unfence` seam AS THE CAPTAIN (`{sessionId: cell.captainSessionId, member}` — the same
   authority the captain's own verb uses), journals `member-unfenced` with `by: "barrier"`, and reports
   the plane's half exactly as that verb does: `plane: "unfenced" | "absent" | "refused"` (with the
   plane's sentence in `planeReason`). The gate is the ROW the barrier writes, NEVER the raw outcome: a
   `reseeded` run that reaches the retry bound FENCES the CELL row on that same run and reopens nothing,
   journaling `plane-reopen-skipped` with `plane: "skipped-fenced"`, the barrier's fourth `plane` value (a
   `refused` run journals `checkpoint-unrecoverable` instead, as it always has).
   A REFUSED half is not a dead end (R5.4): the journal row also carries `retry` with the exact
   Lead-only verb that re-drives the seam — `agent_teams_control {action: "unfence", member: "<name>"}` —
   and `cellwork_supervise` reports that same verb for a TEAM `checkpoint` no barrier is pending for
   (the CELL row already left the window), so an operator is never left guessing.
   A promoted seat is open in BOTH records again; a RESEEDED one points at the fresh child, and its row
   additionally journals `member-reseeded` `{previousSessionId, newSessionId, retired, plane}` so the
   hand-over is a fact rather than an inference. The ORIGINAL session is retired with the host's
   `interrupt` TARGETING the member's own id (never the new child) and AUTHORISED BY A LIVE ANCESTOR
   (R5.1): the same session the reseed is raised under — the member's durable parent when that session is
   live, else the cell's captain — passed as the `ancestor` authority. The member's OWN handle is never
   the authority: the host keys an Agent by its session id, so that spelling IS the target and
   `dsh-subagent` refuses it as `UNAUTHORIZED "cannot interrupt itself"` BEFORE its ancestry check.
   What the record says is therefore what the host did: `retired: true` only when the target was PROVEN
   live and the host took the interrupt (`retirement: "accepted"`); `retirement: "nothing-to-retire"`
   when the identity registry holds no live agent for the recorded session (the dead-seat shape, and the
   host's own documented no-op — NEVER a retirement); `"refused"` when the host said no, with its own
   sentence in `retirementReason`; and `"unavailable"` when this composition exposes no interrupt or no
   identity seam. The reseed proceeds on every one of those answers, and the journal row
   `member-reseeded` carries `retirement`/`retirementReason` beside `retired`. **Declared bounds:** a
   host that keeps a retired session deliverable can still deliver to it — the seat record points at the
   new child, and this bundle does not invent a second revocation mechanism — and residency is proven
   through the agents registry, which is the identity the host's own authority check consults, so a live
   but NON-RESIDENT external activation would answer silently and be recorded `accepted` (this bundle
   raises LOCAL continuable children, so that is a residual of a composition it does not build).

   **A reseed is NOT proof of a working child (R4.2).** A resolved child handle is recorded as
   `reseeded`, which is honest only as "a child was started": the seat keeps its `checkpointSince` clock
   (a `promoted` outcome is the only one that clears it), and `cellwork_supervise` reports a STAMPED seat
   `suspect: true` (with `pendingMs` and `forceEligible`) only when the live registry is present, resolves
   the CAPTAIN anchor, and does not hold the recorded session. When the composition has no agents registry
   — or a present registry cannot resolve that anchor — the answer is `unknown`, NEVER "dead",
   and no seat is reported suspect on that basis. A seat whose session died is bounded by the forced
   lever below, not by the retry count: it starts no further barrier run.
6. **Sub-team**: the promoted agent registers its sub-cell with `cellwork_subteam` and leads its own
   plan. `cellwork_subteam` refuses when `depth + 1 > depthMax` (default 3) and returns the exact
   bound, reading the parent team's depth from `mpdTeams.depthBudget`; it starts NO agent — it writes
   the sub-cell record and answers the directive the promoted member then acts on. Depth has ONE story
   and TWO scales inside it: `cellwork.depthMax` is the CELL-tree bound and is NEVER forwarded as any
   agent's `maxDepth`, while an agent's cap is always its own parent session's recorded depth + 1 (the
   `spawnMaxDepthOf` rule), which is what keeps every consult and every reseed a leaf. Sub-teams run the
   identical phases and rules, and `cellwork_supervise` sweeps the whole cell tree.

The captain is not a member and is never checkpointed in v1.

## Nested DAG: subcells as group boxes

A promoted subcaptain raises a sub-team, and the shared graph draws that subcell as a BOX whose interior is
the subcell's own DAG. The rule lives in the model (`packages/mpd-graph-core`, whose README pair states it in
full); this section records what cellwork owes it and what a reader may expect to see.

- **One box per subcell.** The box is a node of the PARENT frame: its id is the sub-team's id, and its
  `dependencies` are the blockers attached to its border, while its interior holds the sub-team's own
  tasks, ranked as their own model.
- **External edges attach to the frame.** A dependency with one endpoint inside the box and the other
  outside is re-anchored to the box, where the box is the innermost frame containing the inside endpoint; a
  line therefore never escapes a box. An edge fully inside keeps its two tasks, an edge between two boxes
  becomes box→box, and the box's spawn edge is DERIVED from the task that raised the subcell rather than
  authored anywhere.
- **The recursion is the model's, not a second concept.** A subcell may hold subcells: each frame is ranked
  on its own and the nesting repeats to the depth cap above. Ids must be unique across the whole tree,
  because the id is the join key both renderers draw by: the team plane's own spelling for a reused task
  number is `<teamId>::<taskId>`.

**The seam is implicit derivation, and it has no argument to forget.** `cellwork_subteam` stamps the parent
cell's LIVE team id on the new cell as `CellState.parentTeamId` and journals `subcell-created` with it; the
sub-team itself is staged with NO `parent_team_id`. The team plane derives the link AT APPROVAL from the
parent team's own roster (`deriveParentTeam`), because the session that stages a sub-team is already a
member of the parent team: the record already knows. That is why the nesting cannot drift: there is no
second value to keep in sync. The same code refuses a parent that does not record the session as its Lead
or as a member, and refuses a `parentTeamId` chain that comes back to itself, so the projection
(`mpdTeams.graph(workspace, teamId)`) can follow `parentTeamId` into nested groups recursively without
risking a loop.

**Both delivered surfaces draw those boxes.** The TUI panel draws them in its character grid: a
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

Agents in a cell talk to each other without routing through the user interface or through the captain. The
mail itself rides ONE durable stream shared with the team plane, `<workspace>/.mpd/team/mailbox.jsonl`; the
kinds, the label rule, addressing and acknowledgement ownership are documented once in [`mail.md`](./mail.md).

- **`cellwork_send`** resolves the recipient in the cell tree: a member name, the literal `captain`, or the
  cross-cell form `"<cellId>/<captain|member>"`, where `<cellId>` must be a sub-cell THIS cell registered or
  this cell's parent (`cell.subcellIds` / `cell.parentCellId`); anything else is refused as `"not in this
  cell's tree"`. A supplied name that is neither `captain` nor a member of the TARGET cell is REFUSED: the
  answer lists that cell's members, and never quietly delivered to the caller's own inbox.
- **The backlog bound is a workspace knob, and both mail tools share it.** `mail.maxUndelivered`
  (default 8, `0` disables; an absent or unusable value falls back to 8) is read per call on the ONE
  store path behind `cellwork_send` AND `agent_teams_mail`, so the bound can never differ between them.
  A recipient at the bound is refused with its name, the count, the bound and two recovery paths —
  acknowledge the inbox (`cellwork_inbox`, `agent_teams_mail {action:"read"}`) or reassign the rows
  behind it (`cellwork_dispatch {reassign:[…]}`) — and nothing is written. An acknowledgement frees one
  slot, and so does a delivery.
- **Where a row lands.** In the workspace mailbox, stamped with the cell's `teamId` and an additive `cellId`
  the view scopes by (a cross-cell sender also stamps `fromCell`). The write goes through the shared store's
  atomic fan-out, so every rule runs before the first append. A pre-unification `<cell>/mail.jsonl` is still
  read and merged into the view in `at` order; an acknowledgement for one of THOSE rows is appended back to
  that file, while a unified row is acknowledged through the store's ownership-checked path. The SENDER's
  journal records the send under a `cell:<cellId>` stamp with `toCell:<target>`.
- **Structured mail, the same protocol.** `kind` (`message` | `question` | `answer`), inferred from `options`
  or from `selected`/`custom` when omitted; `options` + `multiSelect` for a question; `replyTo` (an answer's
  `answerTo`); `selected` (the offered labels copied VERBATIM) and/or `custom` for an answer; `questionId`
  (defaults to the question's own message id, or to the answered question's key); `broadcast: true` for one
  row per seat of the target cell, the sender excluded. An unknown label is refused WITH the valid label list.
- **Durable first, woken best-effort.** The row is written BEFORE any wake-up is attempted, and the attempt's
  outcome is a separate `wake` record (`{t:"wake", id, sent, reason?, at}`, the canonical shape, with its
  reasons, in [`mail.md`](./mail.md)). A row whose wake-up never went out stays UNDELIVERED, and
  `cellwork_supervise` surfaces both the unread count and every such row (`unreadMail` plus
  `wakeFailures[]`), not only the pending board. A cross-cell row is durable-only (no wake-up is attempted
  across cells) and shows on the recipient cell's sweep. A member → captain row is read by the captain's
  inbox because the captain is not a mailbox member and the Lead handle cannot be woken directly.
- **The log format changed, and the change is ONE-WAY.** A `send` row carries `wakeSent: false` (the legacy
  spelling) and the wake-up outcome is the separate `wake` record that follows it, so "durable first, wake
  second" is observable in the log instead of inferred. This build folds an OLDER log correctly (a pre-`wake`
  row keeps its own `wakeSent`), but a reader from a PREVIOUS build would read a new row as "not woken", and
  would not find a new row in the cell file at all, because rows written now live in the workspace mailbox.
  State it rather than hide it.

## State on disk

Everything lives under the workspace, in gitignored runtime state:

`<workspace>/.mpd/cellwork/<cell-id>/`

| Path | Content |
|---|---|
| `state.json` | the cell record: phase, captain session, depth, parent cell, team id (the EXECUTION board — the staging team is preserved as `planningTeamId` when they differ), planner/splitter handles, the staged split ticket's board id (`splitTaskId`), members and their modes (with the optional `fenced`/`fencedReason`, `adopted: true` and `grown: true` markers), split revision, checkpoints, journal cursor, and the two optional in-flight activation fields: `activationInFlight` (the accepted revision whose materialisation is running) and `activatedLoops` (split key → verify-loop id) |
| `journal.jsonl` | append-only transitions: phase, dispatch, checkpoint, compaction, promotion, refusal, and the supersession rows (`split-superseded`, `activation-in-flight-superseded`); an activation pass writes one compact `cell-activation-progress` row per artifact and a single full `cell-activation-partial` row on failure, and the repair rows are `task-reassigned`, `dispatch-reassign`, `checkpoint-unrecoverable`, `member-adopted`, `member-unfenced`, `member-rebound` (a `rebind` repair; it carries `previousSessionId`/`previousSessionIdLiveness`, `namedBy` (the evidence source: `team`/`cell`/`journal:<event>`), the F1 provenance markers `handleRecordCurrent`/`journalHandoverOlder` when the record won over an older journal row, and `displacedExecutorRef`/`displacedUnproven` when the re-point overwrote a different handle), `member-rebind-failed` (a refused `rebind` entry or argument: `reason`, the requested `handle`, `namedBy`, `previousSessionId`/`previousSessionIdLiveness`, and `supersededBy` when a later hand-over replaced it; its `detail` never chooses a direction), `seat-rebound` (the three-surface bind; it carries `displacedExecutorRef`/`displacedUnproven` when the bind overwrote a different handle), `barrier-skipped` (the `reseed-already-bound` re-entry guard), `barrier-record-unreadable` and `barrier-failed` (the two former warn-only branches) |
| `mail.jsonl` (legacy) | a PRE-unification per-cell mail log, still READ and merged into the cell view; new mail is NOT written here: it lives in the workspace store `<workspace>/.mpd/team/mailbox.jsonl`, stamped with this cell's `teamId` and `cellId` (plus `fromCell` on a cross-cell sender), read by `cellwork_inbox`, and followed there by a separate `wake` record stating what the wake-up attempt did; an acknowledgement of one of THESE legacy rows is appended back to this file, while a unified row is acknowledged in the store |
| `requirements.md` | the validated requirements document, revisioned; a change bumps the revision and marks the split stale |
| `split/<rev>.json` | the splitter's proposal plus the plugin's measured estimates and accept/refuse verdict |
| `split/<rev>.refused.json` | the full finding list of a REFUSED submission at that revision, written beside an accepted record, never on top of it |
| `contracts/<taskKey>.md` | the frozen acceptance contract handed to the verifier |
| `handoff/<member>-<n>.md` | the structured handoff document, one per checkpoint |

Cell ids are `cell-<UTC instant>`; a sub-cell records its `parentCellId` and `depth`. The root is
resolved through `dsh.workspaceRoot(exec)` on every call: never `process.cwd()`, never a cached
constant, and writes go through a temporary file plus a rename in the same directory, so a reader
sees the previous record or the new one, never a half-written file.

The record is **versioned**. A corrupt, unparsable or future-version state is a REFUSAL naming the
absolute path: never a silent reset and never an overwrite. Stopping ARCHIVES: the directory stays,
the record says `stopped`, and a later `/cellwork` mints a new cell id.

## The board the cell is working on

`state.json`'s `teamId` is a FAST PATH, never the truth on its own. Activation can land the execution
board on a team the record never learned — the planning team can go clean-terminal first and the
execution team is minted after it, which is the bundle's NORMAL path — so every reader resolves the
board through ONE rule (the exported `resolveCellTeam` in the cellwork state module):

1. the recorded `teamId`, accepted only when its record carries one of the cell's `activatedTasks` board
   ids (or when the cell has no activated ids to check);
2. otherwise the PLANE's own resolution for the cell's captain session — the exact path
   `cellwork_dispatch` uses;
3. otherwise the live team whose board carries the cell's activated task ids;
4. otherwise `planningTeamId`, the preserved staging id, as the legacy fallback.

**The fifth state is an UNVERIFIED fallback, and only a RE-SPLIT takes it.** When all four steps resolve
NOTHING and the record's `teamId` is non-empty, a re-split (a cell whose `activatedTasks` already name
board ids) still continues on the RECORDED id — an old cell may name a board no seam can read any more,
and refusing it would strand work that is otherwise resumable — but the id is TRUSTED, never verified:
the answer carries `boardNote` saying so, the same fact is journaled (`boardResolution: "unverified"`),
and the note prints the recorded id and, when the resolver saw another candidate, that id too — so both
ids are visible. The note is ADVISORY, not a refusal: it says work is appended to that record only, it
never tells the operator to run `cellwork_start` (a team id IS recorded), and an operator who sees it
should not start a new cell. An INITIAL activation never takes this path (it has no minted ids to verify
the record against), and a re-split with NO recorded id still refuses with the `cellwork_start`
instruction.

`cellwork_status`, `cellwork_supervise`, `cellwork_context`, `cellwork_stop`'s live-task guard, seat
resolution, this cell's requirements re-split path and activation's own writes all read THAT resolution,
never the raw field. Activation also PERSISTS the execution board id (`teamId`) and preserves the
staging id as `planningTeamId`, so a NEW cell's record is correct on disk; a LEGACY cell (the field's
VEdit cell included) is shown correctly with NO migration and NO state rewrite — the resolution wins,
and the stale field is only the fast path.

**Disagreement is REPORTED, never silent.** When the recorded id and the winning resolution name
different teams, the surface prints BOTH ids and which resolution won (and, for a rejected recorded id,
that its board holds none of the cell's activated tasks). `cellwork_stop` runs its live-task guard
against the RESOLVED team, so a non-forced stop is REFUSED while that board still has live tasks; and
the stop does NOT end the team by itself — its answer carries `teamId` (the execution team it leaves
running) and `endTeamCommand` (the exact retry verb
`agent_teams_control {action:"end", team_id:"<id>"}`), and the render prints both. An operator who
stops a cell and wants the agents gone must call that verb.

## Configuration

Every number is a knob read as `cellwork.<key>`. **Precedence is project file > row config > shipped
default**: `<workspace>/.mpd/mpd.jsonc` wins over the bundle patch's `config:` block, which wins over
the documented default. A value that is not a finite number inside its rule is replaced by the default
and reported on the row's log line (`<workspace>/.mpd/logs/mpd-cellwork.log`).

`depthMax` 3 · `checkpointRatio` 0.5 · `windowFraction` 0.25 · `fixedOverheadTokens` 32000 ·
`fixedOverheadByRoute` {} · `toolSchemaChars` 0 · `outputReserveTokens` 8192 ·
`compactionHeadroomTokens` 65536 · `compactionRetries` 3 · `idleBarrierDelayMs` 200 ·
`checkpointPendingMaxMs` 900000 · `asciiCharsPerToken` 3 · `cjkCharsPerToken` 1 · `contractGates` [] ·
`windowOverride` null.

The six SEATS AND CONCURRENCY keys (the elastic-planning wave) are:

| Key | Default | Bounds | Meaning |
|---|---|---|---|
| `cellwork.seats.maxPerRole` | `8` | `1..32` | seats sharing one base role (`Senior Engineer`, `Senior Engineer-2`, …); `1` disables growth |
| `cellwork.seats.max` | `32` | `1..64` | total EXECUTION seats in one cell (planning seats excluded) |
| `cellwork.consultMax` | `32` | `1..256` | the per-start budget this plane hands the ONE shared consult supervisor; an explicitly declared `MPD_DSH_CONSULT_MAX` still wins |
| `cellwork.planning.analysts` | `2` | `0..8` | extra planning lanes (`cell-analyst-1 … K`); `0` keeps the two-seat planning phase |
| `cellwork.delegate.maxTasks` | `32` | `1..64` | per-call bound of `cellwork_delegate` |
| `cellwork.recon.maxQuestions` | `16` | `1..64` | per-call bound of `cellwork_recon`'s batch form |

`seats.maxPerRole` and `seats.max` are NESTED keys: write them as `cellwork.seats.maxPerRole` /
`cellwork.seats.max` in `mpd.jsonc`, and the row config accepts either the nested object or the flat
dotted key. An out-of-range or malformed value falls back to its default with ONE log line naming the
real dotted path — it never refuses a cell.

The mail bound is the ONE knob outside this table: `mail.maxUndelivered` (default 8, `0` disables; an
absent or unusable value falls back to 8) lives under the `mail.` prefix because BOTH mail tools read it
(see "Cell-aware mail").

The model's context window is NOT a knob: it is read from the catalog at split time and from the
observed token meter at runtime, with the provenance recorded. `windowOverride` exists only so a route
whose window cannot be read can be certified deliberately, and it is recorded as an override.

## Declared bounds

- **The guard is process-wide and dispatch-time only.** It cannot see intent, it cannot stop a model
  from attempting a forbidden name, and a row that calls a service directly instead of going through a
  tool is not covered. A cell record that cannot be read releases every caller: a guard cannot
  enforce a mode it cannot see, and the refusal then surfaces on the command and `cellwork_status`
  with the record's path.
- **Adoption and unfence repair the RECORD, not the past.** Adoption covers members the TEAM record
  already knows; a session it does not carry still has no channel, by design. An UNFORCED `unfence`
  clears a GIVE-UP fence on the cell row and, when the composition exposes the
  `mpdTeamActions.unfence` seam, the TEAM row — never a pending checkpoint, which the barrier owns. The
  bounded FORCED lever (`{member, force: true}`) is the exception, and it is the one documented above:
  it reopens a barrier-owned window or a dead-reseed seat only under a written licence (the retry
  budget, the pending bound, or the proven-dead session) and never a live seat. Neither form re-creates
  a dead session, and a cell whose rows the old build already wrote is repaired only through adoption
  and unfence: its history is not rewritten.
- **The 1/4 budget is an estimate** with the declared ±25% English bound and deliberately punitive CJK
  pricing; it is not a measurement of the model's tokenizer, because the deployment ships none.
- **The mount is proven by an overlay.** On this machine a plain link-profile boot still resolves a
  stale `@mpd-dsh/mpd` package, so the mount proof supplies the row through a `--patch` overlay with an
  absolute module path and proves the row APPLIES under a real isolated boot. The bundle wiring, that
  the shipped patch layer is the source: rests on `verify:rows` and `verify:manifest`, not on that
  boot.
- **Pack closure is green since the Wave-5 re-pack.** `verify-pack-closure --require-packed` reports
  622/622 content files byte-identical with 0 drift (pack stamp 2026-10-26T12:23:55Z), and the packed
  artifact carries the new package.
- **Concurrent children are capped by the harness.** `maxActiveSubagents` (the subagent plugin's
  settings field, default 8, no upper bound) limits how many member sessions stay resident, so a cell
  larger than the cap cannot raise them all at once. For cellwork raise it to **32–64** in
  **Settings → Subagent limits** (it persists into the active profile's Cordis patch); the bundle
  cannot set it (a shipped patch row must never id-target a host-owned row) and the agent sandbox
  cannot write `~/.dsh`, so this is a one-time user step. A host slot refusal is NOT a failure: the
  consult releases the MPD slot, waits a bounded off-slot backoff (250 ms → 4 s), re-enters at the FRONT
  of the FIFO and is retried up to 8 times before it settles with a sentence naming that setting — but
  the queue can only keep ASKING; it never reserves a slot.
- **The host's live-slot count is NOT observable, and the queue is UNBOUNDED.** The supervisor can be
  exactly right about OUR budget and still wrong about the host's remaining capacity, which is why a
  refusal is retried with backoff instead of reserved. `cellwork.consultMax` bounds ACTIVE children
  only; the waiting queue has no length bound.
- **`cellwork.seats.max` (32) is above the host default 8.** A cell that grows to it WILL retry until
  the operator raises `maxActiveSubagents` (one-time: Settings → Subagent limits, 32–64). That is by
  design and said here rather than hidden.
- **Analysis lanes have no automatic timeout.** An abandoned lane is the captain's to close; a lane
  that never mails its findings is not retried by the plugin.
- **One split revision stands.** Multi-lane splitting is out of scope: a re-split is a requirements
  `update` feeding a NEW accepted revision, never two live split graphs.
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
- **The generic team verb is owner-only by default; only its explicit roster mode substitutes.**
  `agent_teams_dispatch` pairs a ready task with its DECLARED OWNER, and the positional fallback needs
  the explicit `mode:"roster"` — THAT mode handed a REVIEW task to the member that had written the
  reviewed lanes (released immediately, no verdict recorded). Cell dispatch is owner-only and never
  substitutes: outside cell mode, wait for the declared owner, or release and reassign deliberately.
  Review-by-writer is not a theoretical risk.
- **Reseed is best-effort.** The native backend exposes no dispose for a SETTLED activation, so the old
  child is interrupted best-effort; the fresh child's activation is released only when it cannot be
  handed over (no child id, a surface that refused to bind, or a throw after the spawn). What this
  guarantees is narrower and checkable: our side never claims `reseeded` while the seat is unbound, and a
  dead seat is visible and clearable.
- **Checkpoints need an observed window.** No observation means no checkpoint: the ratio is never
  applied to a guessed window.
- **Cancellation lives on the cell record, not the team plane.** The team plane exposes no cancel verb: a
  task dropped by a later split revision is marked `cancelled` in the cell record (`state.json:
  cancelledTasks`, key → board id), and its board row stays VISIBLE on the board. Dispatch skips it only
  because cellwork's own dispatch pass reads the cell record: a bare board read still shows the row.
- **The depth fence is three levels by default.** A promoted subcaptain can raise a sub-team, and
  `cellwork_subteam` refuses past `depthMax`; registering a sub-cell starts no agent at all. Every agent
  the plugin does start is forwarded an explicit `maxDepth` of **its own parent's recorded depth + 1** —
  the `spawnMaxDepthOf` rule, applied to the caller on a consult and to the LIVE parent on a compaction
  reseed — and never the cell-tree knob, so the two scales cannot be confused again. The nesting
  capability and that derivation are recorded as a source read in the capability spike
  (`evidence/cellwork/capability-spike/`).
- **`parent_team_id` is implicit, not a knob.** A sub-team's parent is DERIVED by the team plane at
  approval from the parent team's roster (`deriveParentTeam`); `cellwork_subteam` stamps the resulting
  parent team id on the cell record and passes no parent id at all, so there is no argument for a caller to
  get wrong, and no way to point a sub-team at a team that does not record the session as a member.
- **The web nested frame ships with three stated bounds.** (1) A cyclic dependency INSIDE one frame is
  not routed on the web canvas: the witness is named in `nestedBackEdges` while the flat path draws it
  on the left. (2) Nested columns are packed in rank order and top-aligned, no barycentre relaxation
  (the flat path keeps its own relaxation). (3) The hover halo covers the ROOT frame's cards; an
  interior card keeps its own tone. The `nestedBackEdges` witness list is wired and documented but no
  arm populates a witness yet: the bound is DECLARED, and a cyclic-interior arm would seal it.
- **The verify-loop producer is the captain's own live session.** The loop records that session truthfully;
  the cell id survives only as DATA on the frozen contract (a `producer: cellwork:<cellId>` line), never as a
  fabricated session. `mpd_verify_open` (that exact name) is the ONLY `mpd_verify_*` entry on the captain
  allowlist: binding a seat, recording a verdict, taking evidence and escaping stay refused, so a
  `writer:"self"` loop the captain opens is inert (`mpd_verify_seat` refuses the loop's own writer). With no
  live caller agent, activation refuses before writing anything. The loop also NAMES its writer: activation
  passes the owning member's session id as `writer_id` and records the human name as `member: <name>` in the
  loop's `writer.reason`, so `mpd_verify_record`'s same-agent refusal compares two real agent keys instead of
  the `delegate:pending` placeholder. The comparison is a STRING comparison, it makes the rule meaningful,
  never unforgeable.
- **The resume is not a transaction, and a CRASH is not a failed pass.** A RETURNED failure writes the
  full partial once before the retry can act, so that path's residual window is one board/verify call
  plus one cell-record write. A process that DIES mid-pass leaves no partial at all, only the compact
  `cell-activation-progress` rows, so every board task and verify loop that pass created is invisible
  to the retry and may be created a second time. Duplicates are detectable and not deletable (the team
  plane has no cancel verb); members are the exception, because they reconcile by name against the live
  roster.
- **Blindness stays prose**, exactly as this repository states it: cellwork wires the contract, the
  loop and the verdict, and does not pretend to observe what a verifier read.
- **A delegated WRITER works OUTSIDE the cell board.** `cellwork_delegate` gives it no frozen contract,
  no verify loop and no board row: the operator's report arrives in `cellwork_consult`, and nothing
  records it as a verdict. Board-scale work still belongs on `cellwork_split` + `cellwork_activate`;
  background delegation is for bounded side-work — research, a spike, a one-file probe.
- **The consult book is IN MEMORY.** Cellwork remembers which ids a cell started in a process-local map
  (no second store, no report, no cap), exactly as the supervisor's records are process-local: a restart
  loses both, and `cellwork_consult` then answers with the refusal that says so rather than a stale id.
  A seat may still call `mpd_role_spawn_async` / `mpd_role_consult` directly; a consult it collects that
  way simply leaves this cell's list (the next `list` prunes it).
- **Agent delegation depth and the CELL-tree depth are DIFFERENT SCALES.** `cellwork.depthMax`
  (1..8, default 3) bounds nested cells and teams — `cellwork_subteam` is its only enforcer — and it is
  NEVER passed to a consult. The three consult verbs start through the `mpdConsults` service, which
  leaves the child's agent depth to the roster's own `spawnMaxDepthOf(exec.agent)` rule (caller depth +
  1, a LEAF) and deliberately does NOT apply the roster's tool-side depth floor (a caller at delegation
  depth 2 or deeper is refused by the TOOLS). ONE consumer of that exemption exists today: cellwork,
  whose plane is bounded by `cellwork.depthMax`; a second consumer must justify the bypass.

## Tests and evidence

- `bun test packages/mpd-cellwork-plugin`: offline, no harness, no network; every arm runs through
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
  `evidence/cellwork/`: each directory carries its `result.json` plus that lane's own artifacts: a
  report for a read-only spike, logs for a run.
- `bun run verify:docs`, `bun run verify:rows`, `bun run verify:manifest` and `node
  scripts/verify-dist-fresh.ts` are the gates a cellwork change must keep green.

For the exact tool parameters, the refusal texts and the per-arm test list, use the package README
pair; for how the mode was designed and what each wave delivered, see the plan and contracts under
`.mpd/plans/` in the repository.

## Programmatic entry: `cellwork_open`

`cellwork_open {objective, mandate?}` opens a cell without the command. It refuses THREE things: a caller
that is not the captain, an already-active cell, and a `mandate` whose
`<workspace>/.mpd/autoproject/<runId>/escalation.json` is not on disk. `/cellwork` is a thin handler over
the SAME open path, so the command and the tool cannot diverge in behaviour.

The tool path cannot submit a user turn (a tool has no `invocation.submit`) so it returns the activation
directive for the caller to submit, where the command submits its own. That bound is deliberate and
stated, not hidden.

## What it delegates to the team plane

The cell-MODE engines (requirements, split, activate, recon, budget) stay in this package: they are the
workflow layer that WRITES the board. The TEAM-level logic is the team plane's, reached as services, no
cross-package import:

| Cellwork surface | Now reads or writes |
|---|---|
| `cellwork_dispatch` | the team record's dispatch pass; `reassign` goes through the team plane's own claim/journal/deliver path |
| `cellwork_context` | `mpdTeams.memberContext`: the same meter and provenance the team tool reports, with the adapter read only as the documented degradation |
| `cellwork_subteam` | `mpdTeams.depthBudget`: the parent-chain depth and the SAME `cellwork.depthMax` bound; the cell record is the fallback when the service is absent |
| handoff / checkpoint | the team plane's handoff bookkeeping and journal |

The consequence worth knowing: the board, the fence state, the occupancy reading and the depth budget have
ONE owner (the team plane). A cellwork copy that disagreed with it would be a second policy, and there is
none.

## Supervision and the force supervisor (2026-11-05)

A cell seat IS a team member, so the team watchdog's force supervisor sees it through the team record:
the seat is first sent a GRACE directive asking it to write its own handoff and end its turn (a
member-authored seven-section handoff is ADOPTED), and only an EXPIRED grace interrupts it — once —
then requeues and splits the row; `mpd-team-core` never writes the CELL record — a seat repairs its own
seat afterwards through `cellwork_dispatch` (`reassign`) or `cellwork_split`. One-shot consults are
supervised by the SILENCE consult deadman: the bound resolves from `consult.forceAfterMs` →
`watchdog.forceAfterMs` → 900000 ms (a declared `0` disables it), and any in-flight tool younger than
`watchdog.toolInFlightMaxMs`, or an OPEN `bash` call at any age, counts as activity. A verifier seat is
denied both consult tools (`mpd_role_spawn_async`, `mpd_role_consult`) so it can neither delegate nor
cancel another consult. The re-team volume counter counts cellwork's own staging calls because they
execute as the same session.
