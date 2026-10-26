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
- **Who creates what (Amendment 4):** the `/cellwork` COMMAND creates the cell record and submits the
  directive. `cellwork_start` is a captain-only PHASE TRANSITION that never creates a cell (B1 forbids
  any tool from starting the mode) and, from T2 on, stages the planner and splitter. The command
  archives the cell it just created if there is no live turn surface to submit the directive.

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
- **Subcaptain**: a MINI-CAPTAIN — the captain dispatch allowlist MINUS `cellwork_start` and
  `cellwork_stop`, plus `cellwork_subteam`, `cellwork_activate`, `cellwork_dispatch` and
  `cellwork_supervise`. It gets NO file-work tools: clause 5 says the promoted agent builds and
  dispatches a next-level team "under the same rules as the main agent", and the main agent is
  dispatch-only. (Amendment 4.)
- `cellwork_stop` clears the mode; afterwards the same session is unaffected.
- Declared bounds (README): process-wide, dispatch-time only, no coverage of a row calling a service
  directly.

## B3 — State

- `<ws>/.mpd/cellwork/<cellId>/{state.json, journal.jsonl, requirements.md, split/<rev>.json,
  contracts/<taskKey>.md, handoff/<member>-<n>.md}`.
- Workspace root through `dsh.workspaceRoot(exec)` — never `process.cwd()`, never a cached const;
  atomic writes (tmp + rename); the journal is append-only.
- State is versioned. A corrupt or unparsable state is a REFUSAL naming the path — never a silent
  reset. Nothing is written outside the cell directory except the team board, the verify plane, and the
  row's own diagnostic log sink `<ws>/.mpd/logs/mpd-cellwork.log` (the repository's R5 sink: mount line
  and refused-knob lines only — Amendment 4).

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

**Amendment 3 (2026-10-26T08:30Z, captain; closes a gap found while staging Wave 2):** `cellwork_start`
stages and approves TWO members and TWO tasks, not one:

- members `cell-planner` and `cell-splitter`, both with their persona TEXT in the prompt;
- task 1 = the requirements task (owner planner), task 2 = the SPLIT task (owner splitter,
  `blocked_by` the requirements task);
- the splitter is dispatched when the requirements task completes; on a requirement update the SAME
  split task is reopened/re-dispatched with the revised requirements and the stale split revision;
- the splitter's prompt carries B6's measured-budget rule, the exact graph shape
  (`key/subject/description/kind/ownerRole/writeScopes/blockedBy/inputs[]/verify` plus one review task
  per `verify:true` task owned by a different role), and the refusal-with-breakdown protocol.

Rationale: B6 accepts a split from an agent, so the cell must CREATE that agent and give it a task;
leaving it to the captain would silently move requirement reasoning into the captain's lane, which
clause 1 forbids.

**Implementation ownership (captain ruling, 2026-10-26T08:35Z):** the STAGING above belongs to the B4
lane (Wave-2 T2, flow-engineer). The B1 lane (T1) implements `cellwork_start` as: validate input →
write the cell record → submit the activation directive → refuse a second active cell, and it exposes
the reusable helpers (cell directory, atomic write, journal append, versioned state read/write with the
corruption refusal, resolved config, caller context) as named exports. T2 then EXTENDS the same tool with
the two-member/two-task staging. The T4 verifier judges B1/B2/B3/B10 and must not fail T1 for the absent
staging; T5 judges B4.

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

## Amendments

### Amendment 4 (2026-10-26T08:48Z, captain; from the T1 implementation report)

- **Subcaptain is dispatch-only** (B2 above, corrected): the earlier "captain allowlist plus its own
  work tools" made the denial set empty, which contradicts clause 5's "same rules as the main agent".
  It now gets the mini-captain surface and NO file-work tools.
- **The command creates the cell; `cellwork_start` never does** (B1 above, clarified). The tool is a
  phase transition (and, in T2, the staging point). This resolves the captain-said/tool-did divergence
  in favour of the contract's own "no tool starts the mode".
- **The row log sink is a sanctioned exception** (B3 above): `<ws>/.mpd/logs/mpd-cellwork.log` carries at
  most the mount line and refused-knob lines; it is not cell state.
- **A corrupt cell record RELEASES the guard** — accepted. A guard cannot enforce a mode it cannot see,
  and fail-closed would lock the captain out on a damaged file; the refusal must name the absolute path
  on the command and on `cellwork_status`, and it does.
- **The cell-id collision fix is accepted as part of B3**: `freeCellId` advances the instant until the
  directory is free, so "archived, not deleted" holds even for two commands in the same millisecond,
  and an arm locks it.

### Amendment 5 (2026-10-26T09:42Z, captain; raised by w2-verifier after T5)

T3 (B8/B9) must ALSO close the two T5 findings, and T6 judges them as REQUIRED items alongside B8/B9.
The three arms and the README section below are contract items, not optional prose, so a T6 FAIL can
cite this document as its `doc_source`.

**1. README pair section (both languages, same heading tree).** Document:
- B4's relay path: planner → `cellwork_send`/mail → captain → `ask_user_question` → mail back, with the
  captain authoring nothing;
- B6's measured-budget rule: stat + 16 KiB CJK sample + configurable ratios + the adapter-read window
  with provenance, `uncertified` when no window, an over-budget refusal WITH a breakdown;
- B7's owner-only dispatch (no substitution, busy owner reported, verify loop BEFORE dispatch);
- B5's prose-only bound when the child-persona seam is absent;
- the synthetic `cellwork:<cellId>` producer used for `mpd_verify_open`;
- the single `windowOverride` and the planning-task completion identity;
- config precedence stated IDENTICALLY in both languages: project file > row config > shipped default
  (this also closes T4's NIT).

**2. Three named arms.** (a) a requirements `update` reopens/re-dispatches the SAME split task (same
task id, new revision, stale flag recomputed); (b) `cellwork_recon` REFUSES a stopped cell and the
returned report is JOURNALED (assert the journal line); (c) a prompt-level assertion that the planner
directive carries the relay protocol (captain authors nothing).

**3. T6 scope.** T6 judges B8/B9 AND the README section AND these three arms. A missing item is a
finding whose `doc_source` is this section.

### Mount proof status (2026-10-26T09:39:31Z, captain)

A real offline boot of the row NOW EXISTS and is frozen under
`evidence/cellwork/mount-proof/2026-10-26T09-39-31Z/`: a link-profile sandbox booted `dsh --profile w
--patch <overlay>` with the row's module path absolute, and the plugin wrote
`[mpd-cellwork] mounted: guard=on depthMax=3 checkpointRatio=0.5 windowFraction=0.25 windowOverride=none`.
It PROVES the row module applies and registers under a real boot. It does NOT prove the bundle's own
`cordis.patch.yml` row is the source: on this machine the bundle resolution picks a stale copy, so the
row was supplied by an overlay with an absolute module path. The bundle wiring is proven separately by
`verify:rows` / `verify:manifest` (both green). The PR states both halves and this bound.

## Gates the verifier must run

- Offline unit tests (mock ctx/adapter) covering B1–B10 surfaces: command result shapes, guard
  decisions per mode, state atomicity/corruption, requirements validation, estimator arithmetic with an
  INJECTED window (123456 → budget 30864), measured-input refusal with a breakdown, graph validation
  refusals, activate ordering, checkpoint injection suppression, compaction signal, reseed path, depth
  fence, mail addressing.
- `bun run typecheck`, `bun run verify:comments`, `bun run verify:docs`, `bun test packages`.
- Row and package gates: `bun run verify:rows`, `bun run verify:manifest`, `node scripts/verify-no-host-override.ts`, `node scripts/verify-pack-closure.ts` (the package must be in `PLUGIN_PKGS`), `node scripts/install-profile.ts --dry-run`, `node scripts/verify-dist-fresh.ts` (the new package's committed `dist/index.js` must be FRESH — each work task may rebuild ONLY its own package with the pinned toolchain).
- A MOUNTED boot in an isolated `DSH_HOME` (`bun skills/dsh-qa/scripts/bundle-lifecycle.ts`) proving the new row APPLIES without aborting — never `--dump-config`, which composes rows only. The LIVE `/cellwork` dispatch proof belongs to Wave 3's QA case; this wave proves registration at the unit boundary (the exact command definition handed to the adapter) plus the row mount.
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
