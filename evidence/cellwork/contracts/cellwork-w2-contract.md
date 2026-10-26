# Wave 2 frozen contract — cellwork core (`mpd-cellwork-plugin`)

Frozen: 2026-10-26T08:18:00Z · owner: captain · basis: `.mpd/plans/cellwork.md` §4 (esp. §4.2–§4.12)
and the user's eight clauses in §1.

A Wave-2 verifier works from THIS contract, the plan, the package README and the documentation band —
never from `packages/mpd-cellwork-plugin/src/**` before a FAIL is recorded. Blindness is prose; the
verdict must cite documents and `mpd_verify_*` evidence ids.

## B1 — Command surface (`/cellwork` ONLY)

- Registered through the adapter as `name: "cellwork"` with a non-empty `input.hint`. No alias, no
  second spelling, no `cell-work`.
- Empty/whitespace input → `{kind:"error"}` and NO cell state written, nothing submitted.
- Non-empty input → writes a cell record (phase `requirements`, id `cell-<UTC instant>`, captain
  session id) and submits exactly ONE activation directive as the invoking agent's own next user turn,
  with a producer-owned message source kind `mpd-cellwork`.
- NO other entry point starts the mode: no tool action, no event gesture, no preset or config flag.
- A second `/cellwork` while a cell is active for the same workspace/session REFUSES, naming the
  active cell id; it never creates a second cell.

## B2 — Dispatch-only captain guard

- Installed once per plugin, keyed by `agent.session.id` plus the active cell state; a session with no
  cell is untouched (allow).
- **Captain allowlist**: `cellwork_*` (except `cellwork_handoff`), `agent_teams_*`,
  `ask_user_question`, `todo_write`, `mpd_memory_*`. Everything else is denied with ONE teaching
  paragraph that names the allowed surface and `cellwork_stop`.
- **Verifier mode**: deny `write`, `edit`, `mpd_hashline_edit`, `mcp__ast_grep__rewrite`,
  `mcp__ast_grep__scan`, `mcp__lsp__rename_symbol*`; allow read/grep/glob, bash, `mpd_verify_*`.
- **Checkpoint mode**: allow ONLY `cellwork_handoff`, `cellwork_context`, `cellwork_status`; deny
  everything else.
- **Subcaptain**: the captain dispatch allowlist plus its own work tools.
- `cellwork_stop` clears the mode; afterwards the same session is unaffected.
- Declared bounds (README): process-wide, dispatch-time only, no coverage of a row calling a service
  directly.

## B3 — State

- `<ws>/.mpd/cellwork/<cellId>/{state.json, journal.jsonl, requirements.md, split/<rev>.json,
  contracts/<taskKey>.md, handoff/<member>-<n>.md}`.
- Workspace root through `dsh.workspaceRoot(exec)` — never `process.cwd()`, never a cached const;
  atomic writes (tmp + rename); the journal is append-only.
- State is versioned. A corrupt or unparsable state is a REFUSAL naming the path — never a silent
  reset. Nothing is written outside the cell directory except the team board and the verify plane.

## B4 — Planner and the Socratic relay

- `cellwork_start` stages and approves a one-member team (`cell-planner`) with one requirements task.
  The member prompt carries: the planner persona TEXT, the Socratic protocol (one question at a time,
  reflect the answer back, surface edge cases, agree a definition of done), the relay protocol, and its
  available tools (`cellwork_recon`, mail, `cellwork_requirements`).
- The planner reaches the user ONLY through the captain: planner → `cellwork_send`/mail → captain →
  `ask_user_question` → captain → mail back. The captain authors nothing and answers nothing itself.
- `requirements.md` lives under the cell dir. `cellwork_requirements {action:"finalize"|"update"}`
  validates the required sections (goal, non-goals, users/consumers, constraints, acceptance criteria,
  open questions). `finalize` refuses without them. `update` bumps the revision and marks the current
  split STALE.

## B5 — Planner reconnaissance (user clause 8)

- `cellwork_recon` is callable ONLY by the planner or a subcaptain; a different caller or a stopped
  cell is refused with a teaching message.
- It spawns a ONE-SHOT read-only child through the adapter's direct start path with `label` exactly
  `Explorer` or `Researcher`, an explicit absolute `maxDepth = cellwork.depth.max`, and the persona
  text in the prompt; the report is the tool result and is journaled in the cell.
- A composition without the child-persona seam is a DECLARED prose-only bound (README), never a silent
  claim of mechanical read-only.

## B6 — Split and the measured budget

- `cellwork_split {action:"submit"}` accepts tasks `{key, subject, description, kind, ownerRole,
  writeScopes, blockedBy, inputs[], verify}` plus the split's revision.
- The plugin MEASURES (never trusts a self-reported number): `fs.stat` on every declared input path;
  sample the first 16 KiB of each file for a CJK ratio; price via the configurable ratios; add the
  measured fixed overhead, per-block framing overhead and the output reserve; store the breakdown.
- Window = the adapter's catalog projection (`contextWindow`), with provenance recorded:
  `catalog` | `observed` | `override`. A route with no readable window makes its tasks `uncertified` —
  NEVER a guessed window, no literal in source. A config override is the only certification path and is
  recorded as `override`.
- ACCEPT iff `estimate <= floor(window * windowFraction)` AND
  `estimate + modelMaxTokens + compactionHeadroom <= window`.
- REFUSE returns a per-task breakdown (bytes → tokens, budget, excess) and says what to cut; the
  splitter may resubmit.
- Graph validation before acceptance: every task answers `blocked_by` or `independent:true`;
  acyclic; overlapping write scopes only with a dependency path; verifier ≠ writer; every `verify:true`
  task has exactly one review task owned by a DIFFERENT declared role; every owner role exists in the
  roster or is a cell role.

## B7 — Activate

- `cellwork_activate` is captain-only and requires an ACCEPTED split of the CURRENT revision; a stale
  split is refused unless the caller passes the revision explicitly.
- It writes one contract doc per code task, adds members (persona TEXT injected — team members get no
  roster persona) and tasks to the LIVE team record, makes every review task `blocked_by` its work
  task, and opens one verify loop per code task (`mpd_verify_open`, contract path, scope) BEFORE
  dispatch. It never re-creates the team.
- Dispatch pairs ONLY the declared owner. A busy owner is REPORTED, never substituted; no fallback for
  any task (this is the platform behaviour cellwork must not inherit).

## B8 — Checkpoint → handoff → compaction → promotion

- Host-plane `agent/pre-step`: for an active member whose ratio is >= `checkpointRatio` (observed
  window; `usedTokens = projectedTokens ?? pressureTokens`), inject ONE checkpoint message at that step
  and flip the session to checkpoint mode. Re-injection is suppressed per checkpoint. Before the first
  observed window nothing is triggered (never guess).
- `cellwork_handoff` validates the sections (task, state, decisions, artifacts, verified facts, open
  questions, next step), writes `handoff/<member>-<n>.md`, marks handoff-ready; the directive tells the
  agent to end its turn.
- On `agent/turn-stopping` with handoff-ready, a bounded idle barrier calls the MEMBER's own compaction
  engine (`compactionEngineForAgent`) with a REAL `AbortSignal`. Success → subcaptain mode + promotion
  directive. `null`/busy/error after the retries → dispose the activation and start a FRESH child whose
  prompt is the handoff (reseed), then the same directive.
- `cellwork_subteam` refuses `depth + 1 > cellwork.depth.max` and registers the subcell (parentCellId,
  depth); the sub-team is staged by the promoted agent with `agent_teams_plan` and `parent_team_id`.
- The captain is never checkpointed (declared bound).

## B9 — Mail

- Intra-team mail is the existing `agent_teams_mail` (unchanged). `cellwork_send` / `cellwork_inbox`
  address a cell member by name or `captain`, deliver through the harness transport, and journal the
  message with a `cell:<cellId>` stamp. A transport failure leaves the row undelivered and is surfaced
  on `cellwork_supervise` — mail is durable, wake-up is best-effort.
- A member messages any member of its own team without the captain; cross-subcell delivery resolves by
  the cell tree.

## B10 — Stop

- `cellwork_stop` archives the cell (no deletion), clears the mode and the guard; it REFUSES while a
  cell task is `in_progress` unless `force:true`, and the forced stop is journaled.

## Gates the verifier must run

- Offline unit tests (mock ctx/adapter) covering B1–B10 surfaces: command result shapes, guard
  decisions per mode, state atomicity/corruption, requirements validation, estimator arithmetic with an
  INJECTED window (123456 → budget 30864), measured-input refusal with a breakdown, graph validation
  refusals, activate ordering, checkpoint injection suppression, compaction signal, reseed path, depth
  fence, mail addressing.
- `bun run typecheck`, `bun run verify:comments`, `bun run verify:docs`, `bun test packages`.
- A MOUNTED boot in an isolated `DSH_HOME` proving `/cellwork` registration, a captain guard denial, and
  `cellwork_start` staging (never `--dump-config`, which composes only).
- A source scan for the forbidden literals `1_000_000` / `262144` in the new package: 0 hits.
- Evidence under `evidence/cellwork/core/<timestamp>/` plus the verify-plane evidence ids.

## Declared bounds

- Guard: process-wide, dispatch-time, no service-plane coverage.
- Verification blindness stays PROSE (as the repository states).
- The planner's questions are relayed by the captain; a direct child→user question is not the accepted
  path in v1.
- The 1/4 rule is a certified ESTIMATE (±25% English prose; CJK deliberately punitive), not a
  measurement.
- No live-LLM end-to-end run is claimed in this wave; the mounted boot proves registration and guard
  behaviour, the unit suite proves the protocol logic.
