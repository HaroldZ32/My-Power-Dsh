# Wave contract — cellwork: elastic seats, parallel planning, and a raised concurrency budget

**Status:** FROZEN 2026-11-11 by the captain, from the field evidence recorded in §0. The writers implement
THIS document; the verifiers judge from THIS document plus the repository documentation, never from the
implementation first.

**Branch:** `feature/cellwork-elastic-planning` off `dev` @ `a6d489b8`.

---

## 0. Why this wave exists (field evidence, VEdit)

The VEdit project ran a cell on `@mpd-dsh/mpd@0.18.1` (the running profile IS 0.18.1: its cellwork
`dist/index.js` carries `cellwork_recon`, `cellwork_delegate` and `cellwork_consult`). The cell
`cell-20261110T144859762Z` reached `phase: executing` with **32 tasks and exactly one seat per role**, and
the journal's last dispatch event is `{"pairs":1,"skipped":30}`.

Root causes, each proven at file:line:

| # | Defect | Evidence |
|---|---|---|
| F1 | **The splitter is never told the `member` field exists.** `cellwork_split`'s schema accepts an optional `member` (`split.ts:51-60`), and `resolvedMember = task.member ?? task.ownerRole` (`split.ts:245-246`); `activate.ts:242-247` then says "without one, the role spelling IS the member". The splitter's prompt field list (`staging.ts:234-247`) omits `member` entirely, so **all 32 tasks carried `member === ownerRole`**, deduped to 4 members → 4 execution seats. | `VEdit/.mpd/cellwork/cell-20261110T144859762Z/split/1.json` (32/32 same-name), `activate.ts:474-480`, `activate.ts:543-546` |
| F2 | **Seats are created once, at activation, and never grow.** `cellwork_activate` materialises one member per distinct name; there is no runtime verb that adds an execution seat, and the cell captain is forbidden to delegate (`guard.ts:62`). So a 32-task board with a 4-seat roster can never exceed 4 concurrent tasks. | `activate.ts:543-556`, `guard.ts:40-62`, `protocol.ts:1053-1077` |
| F3 | **A BUSY role seat reports instead of growing.** `planDispatch`'s owner-only decision refuses to substitute a busy owner (`dispatch.ts:282-283`). With one seat per role that is a hard throughput ceiling: at 15:51:41 three tasks were ready, two of them (T10, T11) sat on the single `Deep Worker` seat, so only the one idle `Reviewer` seat could be paired. | `dispatch.ts:251-287`; skip decomposition 25 blocked + 3 already-dispatched + 2 BUSY |
| F4 | **The planning phase is exactly two seats.** `stagePlanningTeam` raises `cell-planner` + `cell-splitter` from one hardcoded array (`staging.ts:385-393`); the planner's own protocol says "Ask ONE question at a time" (`staging.ts:176`), and nothing tells either planning seat to fan work out. | `staging.ts:24-39`, `:385-393` |
| F5 | **The concurrency budget is 8, in two layers that fail differently.** The HOST caps live children per activation tree with `maxActiveSubagents` (default **8**, `.volatile()`, sampled per admission) and **throws `ACTIVATION_LIMIT_REACHED`** when full — it never queues. MPD's own `MPD_DSH_CONSULT_MAX` (default **8**) queues. MPD **does not catch the host refusal**: `spawn-async.ts:746-748` records the consult `failed`. Raising only the MPD number converts "queued" into "failed". | host `dsh-subagent/lib/index.js:1052-1053,1682-1683,2992-2995`; `spawn-async.ts:40,291-301,348-363` |
| F6 | **A cell's `state.teamId` can point at the requirements shell**, not the execution board: `state.teamId` is written at staging and activation appends to the same team only when it reuses it. In VEdit, `state.teamId` named a 2-task requirements team while the 32-task board lived in a different team file. | `VEdit` state.json vs `team-20261110153651601-uiku-00a.json`; `index.ts:597`, `activate.ts:421-422` |

### 0.1 The user's ruling for this wave (binding)

> "cellwork 用于大型工程，为了效率必须追求极致的并行程度，别整省 token 的事… 规划期间就多起 agent，
> 最好能突破预设的 8 个上限… splitter 的提示词里也要写清楚：不要为了省 token 而减少 agent。"

So: **parallelism is the objective; token economy is explicitly NOT a constraint of this wave's design**,
and every prompt that can influence seat/lane count must say so in those terms.

---

## 1. Goal

1. A cell's execution width must be able to grow **at runtime** to match its ready frontier, without a
   re-split and without the captain delegating.
2. The planning phase must be able to run **several agents at once**, and both planning prompts must
   instruct maximum fan-out rather than serial, token-frugal behaviour.
3. The concurrency budget must be **raised to 32 by default for cellwork**, the host refusal must become
   a **retryable queue signal** instead of a failure, and the host half must be **named in the operator
   surface** because the bundle cannot set it.
4. The splitter must be told about `member`, and a single-name-per-role graph must produce a **warning**.
5. The three shared-infrastructure defects the user accepted are fixed: `state.teamId`, the duplicated
   handoff contract, the stale dispatch wording.

## 2. Non-goals

- **No second concurrency registry, no second cap object.** The `mpdConsults` service stays the ONE
  supervisor; a per-call budget is an argument to it, not a new instance.
- **No change to the host.** `maxActiveSubagents` is the user's one-time Settings action
  (Settings → Subagent limits, 32–64); the bundle must never id-target a host row
  (`verify-no-host-override`), and `~/.dsh` is read-only to the agent sandbox.
- **No multi-splitter lane.** One `latestSplit` and one `splitRevision` are the acceptance contract
  (`flow.ts:909,1047`, `flow.ts:919-920`); splitting the splitter is a later feature.
- No change to `cellwork_split`'s refusal rules, the verify plane, the compaction barrier, or the mail
  store.
- No re-pin of `VENDOR_LOCK.json` (no `skills/**` change in this wave).

## 3. Configuration (read per call, never cached at apply time)

All keys live under `cellwork.*` in `mpd.jsonc` / the `mpd` settings namespace, resolved through the same
resolver `config.ts` already uses. Every key is OPTIONAL; the listed value is the default.

| Key | Default | Meaning / bounds |
|---|---|---|
| `cellwork.seats.maxPerRole` | `8` | Seats sharing one base role (`Senior Engineer`, `Senior Engineer-2`, …). `1..32`. `1` disables growth. |
| `cellwork.seats.max` | `32` | Total execution seats in one cell (planning seats excluded). `1..64`. |
| `cellwork.consultMax` | `32` | The cellwork plane's per-start budget handed to the ONE shared supervisor. `MPD_DSH_CONSULT_MAX`, when set, still wins. `1..256`. |
| `cellwork.planning.analysts` | `2` | Extra planning seats (`cell-analyst-<n>`). `0..8`. `0` = today's two-seat planning. |
| `cellwork.delegate.maxTasks` | `32` | Per-call bound of `cellwork_delegate` (was the literal 16). `1..64`. |
| `cellwork.recon.maxQuestions` | `16` | Per-call bound of `cellwork_recon` (was the literal 8). `1..64`. |

A malformed value falls back to the default with ONE log line; it never refuses a cell.

### 3.5 Ownership and write scopes (the board refuses unexplained overlap)

`packages/mpd-cellwork-plugin/src/config.ts` is a SHARED file: **one task owns ALL SIX keys above**
(T0, the wave's first task). Every other task only READS them, so config.ts is never edited twice.

| Task | Kind | Owner | Scope | Depends on |
|---|---|---|---|---|
| T0 keys | work | cap-junior | `packages/mpd-cellwork-plugin/src/config.ts` | root |
| T1 §4 + §7.1 | work | seat-senior | `packages/mpd-cellwork-plugin/src/{elastic.ts,protocol.ts,activate.ts,state.ts,index.ts}` + `test/elastic-seats.test.ts` | T0 |
| T2 §5 | work | plan-senior | `packages/mpd-cellwork-plugin/src/{staging.ts,prompts.ts,split.ts}` + `test/planning-fanout.test.ts` | T0 |
| T3 §6 | work | cap-junior | `packages/mpd-roles-plugin/src/{spawn-async.ts,consults.ts,index.ts}` + `packages/mpd-cellwork-plugin/src/{consults.ts,recon.ts,flow.ts}` + `packages/mpd-roles-plugin/test/cap-queue.test.ts` | T0 |
| T4 §7.2–§7.4 | integration | side-junior | `packages/mpd-cellwork-plugin/src/{handoff.ts,guard.ts,flow.ts}`, `packages/mpd-team-core-plugin/src/{team-handoff.ts,index.ts,team-journal.ts}`, `packages/*/dist/**`, `dist/mpd-package/**`, `packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts`, `docs/cellwork.md`, `docs/cellwork.zh-CN.md`, `README.md`, `README.zh-CN.md`, `packages/*/README.md` | T1, T2, T3 |

**`packages/mpd-cellwork-plugin/src/flow.ts` is T3's** (it holds the per-call config reader
`configService()`, the two tool-description literals `1..16` / `1..8`, and the wiring into
`startDelegation` / `runRecon`). T1 and T2 must NOT edit it: if their work genuinely needs a line there,
they mail T3 (member `junior-engineer-2`) the exact hunk and declare it in their report; a hunk that
arrives too late is applied by T4 (the integration task) with the same declaration. This keeps ONE writer
on the shared file, which is the same rule §3.5 applies to `config.ts`.

Two rendering duties live with **T1** because it owns `cellwork/index.ts`: the seat projection (§4.2)
AND the concurrency line (§6.3). T3 exposes the DATA (the effective budget and a host-refusal counter on
the consult/state surface it owns); T1 renders it and must degrade to printing the budget alone when that
data is absent — neither task may block on the other.

---

## 4. Workstream W1 — elastic execution seats (F2, F3)

### 4.1 Behaviour

On every dispatch pass (`cellwork_dispatch` and the activation's initial pass), for each **ready** task
whose declared owner names a **live member that is not idle** (BUSY / holding another claim):

1. Resolve the member's **base** and **role**: `base` = the owner name with a trailing `-<n>` (n ≥ 2)
   removed; `role` = a roster role whose spelling (case/space/hyphen-insensitive) equals `base`, else the
   growth is REFUSED for that task with a named reason (`owner base "<base>" is not a roster role`).
2. Reuse an **existing idle seat** named `<base>-<n>` (smallest n) owned by the same role when one exists.
3. Otherwise create one: `agent_teams_plan {action:"add_member", member:{name:"<base>-<n>", role, description, prompt}}`
   against the LIVE team (the same seam `activate.ts:452`/`staging.ts:306` already use), then record the
   seat in the cell state (the same shape `activate.ts:505-525` writes) and journal
   `{"event":"seat-grown","task":"T10","name":"Deep Worker-2","role":"Deep Worker","reason":"owner-busy"}`.
4. Claim the task for that seat in the SAME pass through the existing repair verb
   `agent_teams_dispatch {action:"run", reassign:[{task_id, owner}]}`, so the pair is real, not a claim
   that the seat may never receive.

**Caps.** Growth stops at `cellwork.seats.maxPerRole` seats per base and `cellwork.seats.max` execution
seats per cell. A capped task keeps today's BUSY skip but the reason MUST name the cap and its value, e.g.
`declared owner "Deep Worker" is BUSY and the seat cap (cellwork.seats.maxPerRole=8) is reached`.

**Never grows** for: a planning seat (`cell-planner`, `cell-splitter`, `cell-analyst-*`), a verifier-only
seat, a seat whose owner `mode` is `checkpoint`/fenced, a blocked task, a task already claimed, or a
captain-session-claimed row.

**Idempotency (must be provable).** Two passes over the same board must not create a second seat for the
same base when an idle one exists; a seat name is never duplicated on the roster; a crash between
`add_member` and the cell-record write must not wedge the cell (the next pass adopts the live roster row —
the adoption path at `caller.ts:414`/`activate.ts:509,522-524` already exists).

**Ordering within a pass.** Growth happens BEFORE pairing, so the freshly created seats are eligible in
that same pass. The pass remains "one task per seat" (`dispatch.ts:282`); a grown seat takes ONE task.

### 4.2 Observability

- `cellwork_status` lists each execution seat with `name`, `role`, `mode`, `adopted?`, and the two caps
  plus `grown` counters.
- `cellwork_supervise` reports `seats: {execution, planning, cap, capPerRole, grown}` and, when a growth
  was refused by a cap, the same reason string the journal carries.

### 4.3 Journal append cost (bounded fix, same package)

`state.ts:496-506` re-reads the WHOLE journal to count lines on every append. At 32 concurrent agents this
is O(n) per row. The append path must stop reading the file to produce the line number: keep a monotonic
counter on the cell record (or an O(1) `stat`-based size check) and keep the returned cursor semantically
identical to today's. Existing journals must keep working (a cell whose counter is absent derives it once).

### 4.4 Acceptance (W1)

1. A cell whose split declares one name per role, with 4 ready tasks on the same role and one live BUSY
   seat, grows seats and dispatches MORE THAN ONE task in that pass (proven by a deterministic unit test
   over a fake plane plus the real cell state file).
2. Caps: `maxPerRole=2` on the same fixture creates exactly one extra seat and reports the cap; a second
   pass creates nothing.
3. Reuse: a pass that finds `<role>-2` idle pairs to it instead of creating `<role>-3`.
4. Every growth writes ONE `seat-grown` journal row and one roster member; a growth refused by a cap
   writes no member and reports the cap.
5. Non-roster bases, planning seats, fenced/checkpoint seats and claimed rows never grow (one arm each).
6. `cellwork_status` / `cellwork_supervise` carry the caps and the grown count.
7. The journal cursor stays monotonic and equal to the number of rows for both a fresh cell and a legacy
   cell with an existing journal.

---

## 5. Workstream W2 — parallel planning + splitter discipline (F1, F4)

### 5.1 Planning fan-out

When `cellwork.planning.analysts = K > 0`, `cellwork_start` stages, in the SAME plan and the SAME approve:

- `cell-planner` (role `Planner`) — unchanged identity, because guard/recon/flow key on that name
  (`guard.ts:140,457,490`, `recon.ts:179`, `flow.ts:402,447,449`);
- `cell-splitter` (role `Lead`) — unchanged identity (`flow.ts:919`, `split.ts:36`, `staging.ts:643`);
- `cell-analyst-1 … cell-analyst-K`, roles alternating `Explorer` and `Researcher` (both read-only roster
  roles), one board task each: `kind:"work"`, `owner:"cell-analyst-<i>"`, `blocked_by: []`,
  subject `analysis-<i>`, whose text charges it to reconnoitre the objective and MAIL its findings to
  `cell-planner` and `cell-splitter` (read-only roles may not write files).

The **split task** is `blocked_by` the requirements task AND every `analysis-<i>` task, so the splitter
wakes only when the analysis lanes are done. The requirements task stays `blocked_by: []` and planner-owned
(unchanged).

A failed/abandoned analysis lane must not wedge the cell: the captain can complete or cancel it, and
`cellwork_supervise` reports an analysis lane that has not settled. (Declared bound: no automatic
timeout — the captain decides.)

Planning seats are recorded in `cell.members` as they are today (no new field is required) but they are
NEVER growth bases and NEVER counted against `cellwork.seats.max`.

### 5.2 Prompts (binding text, both must be implemented)

`plannerPrompt` (`staging.ts:162-207`) must gain a MAXIMUM-PARALLELISM section that says, in substance:

- fan analysis out across `cell-analyst-*` and `cellwork_delegate`; run independent investigations
  concurrently, never one-at-a-time;
- **do not reduce the number of agents to save tokens — more agents is the default**;
- "Ask ONE question at a time" STAYS and applies only to the USER interview, never to agent delegation.

`splitterPrompt` (`staging.ts:215-266`) must:

- add `member` to the literal field list (`staging.ts:234-247`) and explain: absent ⇒ the role spelling IS
  the member (one seat per role); present ⇒ that name IS the seat, so several seats may share one
  `ownerRole` — **this is the parallelism switch**;
- require that tasks which can be ready at the same time on the same `ownerRole` declare DIFFERENT
  `member` names, and state the per-role/per-cell seat caps so the splitter aims below them;
- state the no-token-saving rule verbatim in effect ("never reduce the number of agents or lanes to save
  tokens; a larger, more parallel graph is the goal");
- keep the budget section but say it bounds ONE task's size, never the task COUNT or the agent count.

### 5.3 Split-time warning

`cellwork_split {action:"submit"}` gains a NON-BLOCKING warning list. Compute, per `ownerRole`, the
**ready-frontier width** = the maximum number of that role's tasks that can be ready simultaneously in the
graph (a conservative antichain width; the implementation may use "tasks with no dependency path between
them" and MUST state its rule in a comment). When width > the number of distinct declared `member` names
for that role, emit a warning naming the role, the width, the declared names, and the fix ("declare
`member` names `<role>-2`, `<role>-3`, …"). Warnings never refuse; they ride on the accepted verdict and
are journaled with the split.

### 5.4 Acceptance (W2)

1. `cellwork_start` with `cellwork.planning.analysts=3` stages 5 members and 5 tasks, the split task
   blocked by requirements + 3 analysis tasks, and ONE approve.
2. `analysts=0` reproduces today's 2-member, 2-task staging byte-for-byte in shape (existing test
   `test/flow.test.ts:640` still passes or is updated with the reason).
3. The splitter prompt text contains `member` in the field list and the no-token-saving sentence; the
   planner prompt contains the fan-out sentence (both asserted by a test, both languages are NOT required
   for prompts — prompts are agent-facing English).
4. A graph where 4 independent tasks share `ownerRole: "Reviewer"` with one `member` name yields ONE
   warning naming Reviewer, width 4 and the single name; a graph with 4 distinct member names yields none;
   a graph with 4 tasks chained in a line yields none.
5. A failed analysis lane does not block `cellwork_start`'s completion path; `cellwork_supervise` reports
   it.

---

## 6. Workstream W3 — the raised concurrency budget (F5)

### 6.1 The host refusal becomes queue

In the ONE supervisor (`spawn-async.ts`), a spawn that fails with `ACTIVATION_LIMIT_REACHED` (detected on
the error `code` AND, defensively, on the message text) must NOT be recorded `failed`:

- release the MPD slot, put the consult back at the FRONT of the FIFO queue, and retry after a bounded
  backoff (`250ms`, doubling, capped at `4s`, at most `8` attempts), so a rising host cap admits it;
- after the attempts are exhausted, fail the consult with the SAME error code and a message that names the
  host setting: `maxActiveSubagents` under Settings → Subagent limits (32–64 for cellwork);
- journal/telemetry: the retry count is visible on the consult record (`hostRetries`) and the final
  failure is distinguishable from a real child error.

### 6.2 Budget plumbing (one registry, one counter)

- `mpdConsults.start` gains an OPTIONAL `maxConcurrent?: number` (the interface in
  `packages/mpd-roles-plugin/src/consults.ts` and the supervisor's `ConsultStartInput`), forwarded to the
  same `acquire()`; no new registry, no second counter.
- `cellwork` passes `cellwork.consultMax` (default 32) at every start (`recon.ts`, `consults.ts`).
- Precedence: an explicit `MPD_DSH_CONSULT_MAX` env value ≥ the requested budget wins; below it, the env
  value also wins (it is the operator's hard cap). Document this precedence in one comment and in the docs.
- Per-call bounds raised: `cellwork_delegate` 16 → `cellwork.delegate.maxTasks` (default 32);
  `cellwork_recon` 8 → `cellwork.recon.maxQuestions` (default 16).

### 6.3 Operator surface

`cellwork_status` (and the `cellwork_supervise` sweep) must print the effective consult budget and, when a
spawn was refused by the host at least once in this cell, ONE line telling the operator to raise
`maxActiveSubagents` (32–64) in Settings → Subagent limits — because the bundle may not set it. The
RENDERING is T1's (it owns `cellwork/index.ts`); T3 supplies the data and T1 degrades to the budget line
alone when the host-refusal data is absent.

### 6.4 Acceptance (W3)

1. A fake spawner that throws `ACTIVATION_LIMIT_REACHED` for the first 3 attempts then succeeds: the
   consult settles, `hostRetries=3`, and it is NOT recorded failed. Exhausting the attempts fails with the
   named host setting in the message.
2. `mpdConsults.start({maxConcurrent: 32})` admits 32 concurrent children under a global default of 8,
   through the SAME supervisor instance (assert the instance identity / a single `active` counter).
3. `MPD_DSH_CONSULT_MAX=4` still caps the cellwork start at 4 (env wins).
4. `cellwork_delegate` accepts 32 tasks and refuses 33 whole-call; `cellwork_recon` accepts 16 questions
   and refuses 17.
5. `cellwork_status` prints the budget and the Settings advice line.

---

## 7. Workstream W4 — the accepted shared-infrastructure defects + docs (F6)

**Ownership:** §7.1 is T1's (T1 owns `state.ts`/`index.ts`/`activate.ts`); §7.2–§7.4 are T4's (the
integration task, which also owns every `dist/**` rebuild).

### 7.1 `state.teamId` must name the board the cell is working on

**Field report (VEdit, 2026-11-11).** The operator's own words: "`state.json` 的 teamId 指向 `-008`，而真实
执行板是 `-00a`。后果：`cellwork_status` / `cellwork_supervise` 一直给我看的是那个已结束的规划团队——
「2 members / 2 tasks」是假的，我一直在用一个错的视角监督这个 cell。而 `cellwork_dispatch` 反而工作
正常（它走的是 plane，能正确找到 `-00a`）。" So writing the right id at activation is NOT enough: the
STATUS VIEW must resolve the execution team through the SAME resolution the dispatch path uses, or the
operator keeps supervising the wrong board.

- At activation, the cell record's `teamId` becomes the team the execution board actually lives on; the
  staging team id is preserved as `planningTeamId` (new optional field).
- `cellwork_status` and `cellwork_supervise` MUST resolve the board they report from through the same
  path the dispatch pass uses (the team plane / the cell's activated task ids / the live record), and
  MUST NOT present a planning team whose tasks are not this cell's activated tasks. A disagreement
  between `teamId` and that resolution is reported explicitly with BOTH ids and the resolution used —
  never silently preferred.
- A legacy cell (VEdit's live one included) must show the REAL board with no re-activation, no state
  rewrite and no migration: the resolution wins, `teamId` is only the fast path.

### 7.1a The FULL affected-surface list (from VEdit's own evidence file, 2026-11-11)

VEdit's `mpd-bug-1-state-teamid-mwawu1yy.md` proves the write side and enumerates EIGHT readers of
`cell.teamId`. §7.1 above covers the first two; this section is binding for the rest.

**Root cause (code-confirmed).** `state.teamId` has exactly two writers: cell creation writes `""`
(`state.ts:385`) and `cellwork_start` staging writes it (`index.ts:589/597`). **`cellwork_activate` only
READS it** (`activate.ts:421`, `:750`) and never assigns. So whenever activation lands the board on a
DIFFERENT team, the cell record can never learn the id. And that path is the bundle's NORM: the splitter
submitting its last board row makes the planning team clean-terminal, the re-team gate ends it 170 ms
later, and activation then builds a fresh execution team — while `state.teamId` stays on the dead one.

| # | Reader | Observed failure | Owner |
|---|---|---|---|
| 1 | `cellwork_status` (`index.ts:484/496`) | reports the ended planning team (2 members / 2 tasks) — a false view | T1 |
| 2 | `cellwork_supervise` (`protocol.ts:1217`) | same; execution seats' mode / context ratio / plane-side fences are all invisible | T1 |
| 3 | activate's cancel path (`activate.ts:750`) | dropped rows all come back `skipped` with `ok:true` — a silent no-op that reports success | T1 |
| 4 | `cellwork_stop` live-task guard (`index.ts:692`) | `liveTasks(dead team)` is empty, so a non-forced stop is NOT refused while tasks run; stop also never touches any team, so the team and its members keep running | T1 |
| 5 | `cellwork_context` (`protocol.ts:1372`) | plane reading missing → silently degrades | T1 |
| 6 | `caller.ts:324` seat resolution | execution seats' plane-side fence/checkpoint invisible | T1 |
| 7 | `flow.ts:447/458/479` (requirements finalize, re-split ticket) | the NEXT requirements update's re-split path breaks there | T4 (flow.ts is T3's for §6 edits; this wiring lands last) |
| 8 | activate's live-roster seed (`activate.ts:504/587`) | a re-split's reconcile cannot see the execution team's existing seats, so it believes it must raise 5 new ones → `add_member` answers "already on the roster" → **the re-split fails** | T1 |

**ONE resolver, exported once.** T1 adds the resolution to `state.ts` (the record's own module) as a
single exported function whose contract is "the team this cell's board is CURRENTLY on": fast path
`teamId`, verified against the live record / the cell's `activatedTasks` / the plane, with the
`planningTeamId` fallback for legacy cells. Every site above reads THAT function — never
`cell.teamId` directly. T3 adds `caller.ts`-style import wiring only where a module cannot reach it
(a declared gap + the exact hunk), and T4 finishes `flow.ts` after T1 lands.

**Conflict reporting.** When the fast path and the resolution disagree, the surface names BOTH ids and
which resolution won. No silent preference, ever.

**Legacy cells (VEdit's live one included) must work with NO migration and NO state rewrite.**

**`cellwork_stop` scope (product decision, so the verifier is not guessing).** Its live-task guard must
run against the RESOLVED team (site 4). It does NOT end the execution team by itself — an operator may want
the board for forensics — but it MUST print the execution team id it is leaving behind together with the
exact retry verb `agent_teams_control {action:"end", team_id:"<id>"}`. VEDIT measured the alternative: a
stopped cell whose team and members kept running with nothing in the answer saying so.

### 7.1b `agent_teams_plan {action:"add_member"}` drops `role` on the mid-run arm

VEDIT's record: its two mid-run members (`Reviewer 2` / `Reviewer 3`) carry **no `role` field**, while the
approve-time members do — so route resolution (role → description head → name) falls through entirely and
both inherited the captain's route. This matters to THIS wave directly: §4.1's seat growth creates seats
through exactly that mid-run arm, so a grown `<role>-2` may arrive with no role and mis-route.

Requirement (T4): make the mid-run arm persist the member's `role` exactly as the approve-time arm does,
and add an arm proving it (a mid-run add_member followed by a read of the member record). If the loss turns
out to be on the plan-store side rather than the executor side, fix it there and say which.

### 7.1c `rev 2` cannot grow seats — the operator guidance and the docs must say so

VEDIT measured this: `cellwork_activate` raises seats only for `fresh` tasks (`activate.ts:474-480`),
keeps existing rows on their old board ids (`:615-619`), and never rewrites an owner — so a re-split that
keeps keys is a **silent no-op for assignments**; and `activate` refuses outright when
`acceptedRevision === activatedRevision` (`:1056-1060`). A new revision can only come from the planner's
`cellwork_requirements update`.

Consequence for this wave: §4's runtime growth and T4's docs must NOT tell operators to "re-split to get
more seats". The workable growth paths are (a) automatic seat growth at dispatch, and (b) a mid-run
`agent_teams_plan {action:"add_member"}` (measured working twice on VEdit). `splitterPrompt`'s parallelism
guidance stays about member NAMES at split time; it must not imply that re-splitting re-seats a live board.

### 7.2 One handoff contract

`packages/mpd-cellwork-plugin/src/handoff.ts` and
`packages/mpd-team-core-plugin/src/team-handoff.ts` are two copies of the same seven-section document
(`handoff.ts:24-32` vs `team-handoff.ts:27`); `team-handoff.ts:6-11` already CLAIMS the merge happened.
Now it must: cellwork imports the team-core validator, the duplicate section list is deleted, and the
frozen cross-package coupling inventory (`packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts:346-361`)
is updated DELIBERATELY with the new edge plus a one-line reason. Behaviour must be identical: the existing
handoff tests pass unmodified, and a validation error still names the same missing section.

### 7.3 Stale wording

`cellwork/guard.ts:272-274` (and any copy) must stop claiming `agent_teams_dispatch` "falls back to roster
order": the tool is owner-only by default (`index.ts:2904`, `dispatch.ts:425`).

### 7.4 Documentation (bilingual, docs gate)

`docs/cellwork.md` + `docs/cellwork.zh-CN.md` (and `README.md` + `README.zh-CN.md` only if they state the
old numbers) must carry, in both languages and with the same meaning:

- the six new keys with defaults and bounds;
- elastic seats: what grows, when, the caps, what never grows;
- planning analysts and the splitter's `member` rule (the warning's text);
- the concurrency model: our budget 32 default, the host's `maxActiveSubagents` 8 default **with the
  one-time Settings action (32–64)**, and that a host refusal is retried/queued rather than failed;
- the honest bound: the host's live-slot count is NOT observable, so the queue cannot know the exact
  margin.

### 7.5 Acceptance (W4)

1. An activated cell's `state.teamId` equals the id of the team holding its execution tasks; `planningTeamId`
   equals the staging team; a legacy fixture with the old shape still renders.
2. Exactly ONE seven-section handoff contract remains in the tree; the coupling inventory lists
   `cellwork → team-core/team-handoff` with its reason and the inventory test passes.
3. No occurrence of the stale "falls back to roster order" claim in `packages/**/src`.
4. `bun run verify:docs` is green and both languages state the same six keys and the same host caveat.

---

## 8. Gates (a verifier runs them; the captain does not)

For every workstream: `bun run typecheck`, `bun run verify:comments`, `node scripts/verify-dist-fresh.ts`
(the integration task rebuilds every touched package with the PINNED toolchain
`.toolchain/node_modules/.bin/bun`), `bun run verify:rows`, `bun run verify:manifest`, `bun run verify:docs`
(for W4), plus the deterministic package tests (`bun test packages/mpd-cellwork-plugin`,
`bun test packages/mpd-roles-plugin`, `bun test packages/mpd-team-core-plugin`) and the two mount lanes
(`node skills/dsh-qa/scripts/preset-conformance.ts`, `bun skills/dsh-qa/scripts/bundle-lifecycle.ts`).

Dist discipline: writers do NOT build `dist/`; the integration task (W4) owns `packages/*/dist/**` and
`dist/mpd-package/**` and rebuilds after every other task has landed (T-88: a derived surface belongs to
the integration task's scope at creation).

## 9. Verification split

- Writers: W1, W2, W3, W4 as staged. Each reports file-by-file with the exact commands it ran and the
  observed result. No writer records a verdict.
- Verifiers: a DIFFERENT Reviewer per workstream, working from THIS document + the docs + gate evidence,
  never from the implementation first. A FAIL bounces back as a repair to the same writer.
- Captain: integrates, rebuilds nothing by hand beyond the integration task's own scope, commits on
  `feature/cellwork-elastic-planning` (single git writer), opens the bilingual PR, waits for CodeRabbit.

## 10. Declared bounds

1. The host's live-slot count is not observable; the queue can be right about OUR budget and wrong about
   the host's remaining capacity — hence the retry-with-backoff rather than an exact reservation.
2. `cellwork.seats.max=32` is above the host default 8: a cell that uses it WILL retry until the operator
   raises `maxActiveSubagents`. That is by design and must be said in the docs, not hidden.
3. Analysis lanes have no automatic timeout; an abandoned lane is the captain's to close.
4. Multi-lane splitting is out of scope; the single split revision stands.
5. **A repair row's verdict lives in its verify LOOP, not on a second board row.** The four review rows
   (R1–R4) judge the four WORK streams; a repair opened from a finding is closed by its own loop record
   (and the writer's completion note), because a parallel "review of the repair" row would double-count the
   same verdict and drift out of sync with the loop. Both are written records with the same guarantees; the
   reviewer is told this explicitly so it does not wait for a row that will never appear.
6. **The stale-blocker guard recognizes exactly two spellings** (`blockedBy`, `blocked_by`). A carried
   split row exposing any OTHER spelling is UNPROVEN and does not wedge the plan — the deliberate trade is
   "unproven beats wedged". The guard therefore cannot catch a stale blocker written in an unrecognized
   dialect; that bound is stated in the code comment and pinned by an arm.
