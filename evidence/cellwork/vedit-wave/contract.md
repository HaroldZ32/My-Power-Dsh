# Wave contract — cellwork defects observed in the VEdit project

**Status:** FROZEN at wave start (2026-10-31, branch `fix/cellwork-vedit-wave` off `dev` @ `56873072`).
**Audience:** the writers of this wave AND the verifiers who judge them. A verifier works from THIS
document plus the repository documentation — never from the implementation.

## 0. Why this wave exists

The VEdit project (`/home/haroldzhao/MyProj/DshProj/VEdit`) ran two cell-work sessions on
`@mpd-dsh/mpd@0.16.3`. Provenance of the evidence:

- active cell `cell-20261031T014507403Z` (phase `executing`, 48 tasks, 33 verify loops): journal 223 rows,
  mail 29 rows, 3 handoffs, state.json; files under `<VEdit>/.mpd/cellwork/`.
- archived cell `cell-20261030T020634155Z`: journal 81 rows, mail 28 rows, state.json.
- verify plane: `<VEdit>/.mpd/verify/{loops,records,evidence}/`.
- The installed bundle is the PUBLISHED 0.16.3 file set (pnpm tarball, `@mpd-dsh/mpd@0.16.3`, sha512 in
  `/home/haroldzhao/.dsh/profiles/dsh-tui/pnpm-lock.yaml`) and its cellwork dist carries the same
  markers at the same dist offsets as this checkout's `dist/`. **So every defect below is a LIVE defect
  of the code in this branch, not a stale-build artifact.**

## 1. Defects (each one is an acceptance item)

| id | defect (observed) | where the evidence is |
|---|---|---|
| D1 | `cellwork_activate` could not resume after a mid-activation failure; the loop-open leg was the failing stage and the retry refused earlier ("already on the roster"), leaving the cell wedged in phase `split` forever | cell-…0634155Z/state.json (`activatedRevision: null`, `phase: stopped`) + memory note `cellwork-activate-wedge-mvucodq6.md` |
| D2 | a cellwork-staged SPLIT ticket reached the board with NO owner → dispatch refused it forever ("no declared owner"), and it can never be completed (owner-only verb); the captain minted a duplicate ticket and told everyone to ignore the ghost | team record `team-20261031014509049-t5fa-002.json` (T2: no `owner`, `status: pending`, `attempt: 3`), cell mail.jsonl:22, journal.jsonl:37 |
| D3 | the same missing owner also blinded the STALE machinery: a requirements bump could not find the split ticket, so it neither marked the split stale nor re-dispatched it | journal.jsonl:31 `{"event":"requirements-update",…,"splitTaskId":"","redispatchable":false}` |
| D4 | dispatch kept pairing a member that had reached its CONTEXT CHECKPOINT, and re-delivered the same ticket up to 4×; the member's claim was refused by the guard, so the row never left `pending` | journal.jsonl:202/206/209/212 (T17 ×4), :208 (checkpoint), handoff/Senior Engineer-2.md:4 |
| D5 | when compaction/reseed was refused, the member stayed fenced-but-owning and wrote 3 handoffs in 7 minutes (livelock); 10 tickets ended "owned by nobody who could claim them", recoverable only by hand | journal.jsonl:217/222 (`no-engine; the reseed failed: …`, `attempts: 3`), handoffs 1–3, state.json `mode: checkpoint, handoffReady: true` |
| D6 | `cellwork_send` attempted the recipient's WAKE-UP before the durable mail row was written, contradicting its own "durable first" contract; a failed append can leave a delivered wake for a row that never landed | `packages/mpd-cellwork-plugin/src/protocol.ts` (wake block before the append) — doc/comment say the opposite |
| D7 | one activation wrote 119 `cell-activation-partial` journal rows, each re-serialising the whole accumulated state (≈40 % of a 490 KB journal), and the final `activate` row carried a timestamp EARLIER than the rows above it | journal.jsonl:46–167 |
| D8 | a REFUSED split left no artifact on disk: the journal recorded only counts, and the breakdown was overwritten by the later accepted resubmission | journal.jsonl:38 (`findings:1`), `split/` holds only `2.json` |
| D9 | the requirements validator treated a `###` subheading as the END of its parent section, so a legitimate document was refused as "empty section"; both cells' documents are still shaped around that bug | cell-…0634155Z/mail.jsonl:17, `requirements.ts` body-scan |
| D10 | activate raises at most ONE member per declared owner role, so 12 tickets of one role queue on one session — "parallel on the graph, serial in reality"; the captain worked around it by inventing 5 new role names | team record 13 members (Qt Build Engineer, Probe Engineer, Workspace Engineer A/B/C, Overlay Engineer); activate.ts role de-duplication |
| D11 | the cell record's member table (7) diverged from the live roster (13) with NO reconciliation surface, so `cellwork_status`/`supervise` under-report who exists | cell-…07403Z/state.json vs team record |
| D12 | every activate-opened verify loop carries the literal writer placeholder `delegate:pending`, so the law's same-agent refusal can never fire and a PASS record cannot name its writer | 33 loop files + 6 records under `<VEdit>/.mpd/verify/` |
| D13 | the verify gate table is a frozen 10-id list with NO per-project extension point, so a Rust project cannot certify a gate without shipping a fake `package.json`; 3 ids ENOENT before the project script runs | `<VEdit>/.mpd/verify/evidence/ev-20261030T022645-ea116d.log` (`error: Script not found "verify:gates"`), cell-…0634155Z/mail.jsonl:19 |
| D14 | the captain could not read a SIBLING project's `AGENT.md`; the refusal text also under-advertises the band (it omits `AGENT.md`/`CLAUDE.md` and spells `README*.md` as if it were a glob) | the guard's own refusal, observed live in a `mpd` top-level session |
| D15 | the cell PLANNER can neither consult read-only specialists reliably nor is it discouraged from doing reconnaissance itself: `mpd_role_spawn` forwards NO `maxDepth`, so a nested planner's child is refused by the host's depth default — which is exactly why `cellwork_recon` exists; nothing restricts the planner's own source reads | `packages/mpd-roles-plugin/src/index.ts` spawn spec; `packages/mpd-cellwork-plugin/src/recon.ts` header |

## 2. Frozen interfaces (writers implement EXACTLY these; verifiers judge these)

Global code rules for every lane (AGENTS.md §6): TypeScript with erasable syntax only, relative
specifiers carry `.ts`, `import type` for types, English-only comments, **every declaration carries a
precise comment and every named function writes its parameter and return types** (`verify:comments` is a
gate), minimal diffs, no speculative refactor, tests in the package's `test/` directory.

### C1 — a split task may declare its MEMBER (D10)
- Task input field: `member?: string` (one spelling only).
- Absent ⇒ today's behaviour: the member name IS `ownerRole`.
- Present ⇒ the board member name is `member`; `ownerRole` is still validated against the roster/cell
  roles (role existence unchanged). Several tasks MAY share one `member`; several `member`s MAY share one
  `ownerRole` (that is the point: same role, several members, real parallelism).
- Validation (new findings, `code` strings fixed): `member-invalid` when the name is empty, longer than
  64 chars, or contains a control character / path separator; `member-role-conflict` when two tasks name
  the same `member` with DIFFERENT `ownerRole`s.
- `self-review` (writer ≠ verifier) compares the RESOLVED member names when both sides declare one, and
  falls back to comparing `ownerRole` otherwise.
- activate raises ONE member per distinct `member`; contracts name both the owner role and the member.

### C2 — `mpd_verify_open` may name the loop's WRITER (D12)
- New optional parameter `writer_id?: string` (trimmed, non-empty, ≤ 200 chars).
- With `writer:"delegate"` and a `writer_id`, the loop's `writer.id` IS that value (no placeholder).
  Absent ⇒ unchanged `delegate:pending`.
- With `writer:"self"` and a `writer_id` ⇒ refusal (a `writer_id` describes a delegated loop).
- **The value is an AGENT IDENTITY, not a display name.** `mpd_verify_record` refuses a verdict when
  `record.writerId === record.verifierId`, and the verifier id it stores is the CALLING SESSION's id — so a
  member NAME in `writer_id` would never equal it and the refusal would stay dead. Therefore:
  `cellwork_activate` passes the owning member's **session id** (the id the cell record stores for that
  member) as `writer_id`, and records the human name in the loop's `writer.reason` as
  `member: <name>` (an additional optional `writer_reason?: string` parameter on `mpd_verify_open`, stored
  on `writer.reason` when given; `writer:"delegate"` only).
- Acceptance: a loop opened with `writer_id: <session S>` plus a verdict recorded by session S is refused
  with the `same-agent` reason; the same loop recorded by a DIFFERENT session is accepted; and the loop
  file shows `writer.reason` naming the member.

### C3 — a project may declare/override its GATES (D13)
- Project file at the WORKSPACE ROOT: `mpd-gates.json`. Absent ⇒ today's frozen table, unchanged.
- Shape:
  `{"version":1,"gates":{"<id>":{"cmd"?:string,"argv":[string,…]}}}` — `cmd` defaults to `argv.join(" ")`.
- Rules: `version` optional and must be `1`; id matches `^[a-z][a-z0-9-]{0,31}$`; `argv` is 1..32
  non-empty strings of ≤ 4096 chars; unknown top-level keys, unknown entry keys, a non-array `argv`, or a
  missing/empty `argv` ⇒ the gate call REFUSES with ONE sentence naming the file and the problem and does
  NOT silently fall back; ≤ 32 entries.
- Resolution: project entry first, frozen table second; a project entry ADDS a new id or OVERRIDES an
  existing one. `argv[0]` is the program (PATH or absolute), spawned with `shell:false`, `cwd` = the
  workspace, the existing `gateTimeoutMs` timeout.
- The recorded evidence log header names the EFFECTIVE `cmd` (so a PASS says which command ran).

### C4 — the CAPTAIN may read project instruction files anywhere (D14)
- Readable by the captain, ADDITIONALLY to today's band: any file whose BASENAME is `AGENT.md`,
  `AGENTS.md` or `CLAUDE.md`, at any depth inside the workspace **and outside the workspace root** (a
  sibling project's instruction file is the motivating case).
- Everything else is unchanged: source paths stay refused, `..` segments stay refused, only `read`,
  `grep`, `glob` are intercepted.
- The refusal text is corrected to advertise the TRUE band, including `AGENT.md`/`CLAUDE.md` and the fact
  that only `README.md` + `README.zh-CN.md` are admitted (there is no `README*` glob).

### C5 — the cell PLANNER delegates its reconnaissance (D15)
- `mpd_role_spawn` forwards an explicit `maxDepth` = the caller's recorded delegation depth + 1, so a
  nested caller's consult is a LEAF and is never refused by the host's depth default. A top-level caller
  keeps today's behaviour (`maxDepth` = 1).
- A cellwork seat in mode `member` whose name is `cell-planner` gets ONE new rule: `read`/`grep`/`glob`
  are refused on source paths. Readable: the same documentation band prefixes, the three instruction-file
  basenames at any depth, and paths outside the workspace root for those basenames. The refusal TEACHES
  the two delegation routes (`cellwork_recon` with `Explorer`/`Researcher`, and `mpd_role_spawn` with a
  read-only roster role) and says why.
- The planner prompt tells it to delegate reconnaissance and not to read source itself.
- The cellwork band lists MUST equal `mpd-roles`' exported `CAPTAIN_READABLE_PREFIXES` /
  `CAPTAIN_READABLE_ROOT_FILES` / `ROOT_LICENSE_PATTERN` semantics — pinned by a parity test that imports
  both modules (no runtime cross-package import).

### C6 — `cellwork_dispatch {reassign}` (D4, D5)
- New optional parameter `reassign?: Array<{task_id: string, owner: string}>`.
- For each pair, BEFORE the dispatch pass: claim the row for that member through the board
  (`agent_teams_task {action:"claim", task_id, claimant: owner}`), journal `task-reassigned`, then deliver
  the normal dispatch message to that member. A failure is REPORTED in the result, never thrown.
- The pass must never message a member that is fenced (see C7), even if that member owns a ready row.

### C7 — a fenced member is reported, never messaged (D4, D5)
- A member is FENCED when its recorded `mode` is `checkpoint`, or `handoffReady` is true, or the record's
  new `fenced` flag is true.
- dispatch skips a fenced owner with a reason naming the member and the repair (`reassign`), and keeps the
  row pending.
- When the compaction barrier gives up (all `compactionRetries` attempts refused), the member's record
  gains `fenced: true` + `fencedReason`, the journal gets `checkpoint-unrecoverable`, and
  `cellwork_supervise` lists fenced members together with the rows they own.
- A SECOND `cellwork_handoff` is refused while a handoff is already waiting for the barrier (reason: the
  handoff is written, end the turn), which removes the 3-handoffs-in-7-minutes livelock.

### C8 — one activation pass journals ONE partial row (D7)
- Per-artifact progress is journaled as a compact delta (`cell-activation-progress` with stage + key +
  ordinal/total); the FULL partial snapshot is persisted ONCE, when the pass fails.
- Every row of a pass carries a non-decreasing timestamp (the pass's instant), so the journal is
  monotonic.
- The resume contract is unchanged in substance: a re-run converges and adds no duplicate member, task or
  loop (see C12).

### C9 — a refused split always leaves its findings (D8)
- Every refused submission writes `split/<revision>.refused.json` with `accepted:false` and the full
  finding list; an accepted verdict is never overwritten.
- The `split-refused` journal row carries the findings (not just counts).

### C10 — a `###` subheading belongs to its parent section (D9)
- A section body runs until the next heading of the SAME OR HIGHER level, so `###` (and deeper) headings
  stay inside it.
- A section whose body is only whitespace is still "missing or empty".

### C11 — the cell record reconciles with the live roster (D11)
- `cellwork_status` reports a divergence list: live roster members the cell record never learned, and
  cell-record members the live roster no longer has. It never mutates. (`cellwork_supervise` is not in
  this item — its fenced-member list is C7, and its existing lossless-output test must keep passing.)
- Staging records the staged split ticket's BOARD ID on the cell record (`splitTaskId`), and looks the
  split ticket up by that id first, by owner second. A missing/ownerless split ticket is reported as a
  hard error naming the repair verb (`agent_teams_task {action:"claim", claimant:"cell-splitter"}`), and
  staging repairs a lost owner itself by claiming the row for `cell-splitter` (D2, D3).

### C12 — activation resume is proven end to end (D1)
- A test fails activation at EACH stage (contract, member, task, verify loop, dispatch), re-runs
  `cellwork_activate`, and asserts convergence with no duplicate member/task/loop and a final phase
  `executing` with `activatedRevision` set.

## 3. Lanes (disjoint write scopes)
| lane | member (role) | files it may write | contract items |
|---|---|---|---|
| A `cellwork-runtime` | Senior Engineer | `packages/mpd-cellwork-plugin/src/dispatch.ts`, `protocol.ts`, `protocol-core.ts`, `mail.ts`, `packages/mpd-cellwork-plugin/test/dispatch-fenced.test.ts`, `test/mail-order.test.ts`, `test/dispatch-reassign.test.ts` | C6, C7, D6 |
| B `cellwork-graph` | Senior Engineer | `packages/mpd-cellwork-plugin/src/split.ts`, `requirements.ts`, `packages/mpd-cellwork-plugin/test/split-refused.test.ts`, `test/requirements-subheadings.test.ts` | C1 (validation half), C9, C10 |
| C `cellwork-activate` | Senior Engineer | `packages/mpd-cellwork-plugin/src/activate.ts`, `staging.ts`, `flow.ts`, `index.ts`, `state.ts`, `packages/mpd-cellwork-plugin/test/activate-resume-e2e.test.ts`, `test/split-task-owner.test.ts`, `test/status-reconcile.test.ts` | C1 (activate half), C2 (caller side), C8, C11, C12 |
| D `verify-planes` | Senior Engineer | `packages/mpd-verify-plugin/src/gates.ts`, `tools.ts`, `ledger.ts`, `index.ts`, `packages/mpd-verify-plugin/test/gates-project.test.ts`, `test/open-writer-id.test.ts` | C2 (server half), C3 |
| E `roles-captain` | Senior Engineer | `packages/mpd-roles-plugin/src/captain-investigation.ts`, `index.ts`, `packages/mpd-roles-plugin/test/captain-instruction-files.test.ts`, `test/role-spawn-maxdepth.test.ts`, `packages/mpd-cellwork-plugin/src/guard.ts`, `prompts.ts`, `packages/mpd-cellwork-plugin/test/planner-guard.test.ts`, `test/band-parity.test.ts` | C4, C5 |
| F `wave-docs` | Senior Engineer | `docs/**`, `packages/mpd-cellwork-plugin/README.md`, `packages/mpd-verify-plugin/README.md`, `packages/mpd-roles-plugin/README.md`, `README.md`, `README.zh-CN.md`, `CHANGELOG.md` | every item, documented bilingually |
| R1 `reviewer-cellwork` | Reviewer | `evidence/cellwork/vedit-wave/**` | verdicts on A + C |
| R2 `reviewer-planes` | Reviewer | `evidence/cellwork/vedit-wave/**` | verdicts on B + D + E, then the wave sweep |

**Derived surfaces belong to the captain's integration step** (AGENTS.md T-88): `packages/*/dist/**`,
`dist/mpd-package/**`, `VENDOR_LOCK.json`. No lane builds dist.

## 4. Gates every lane must leave green

- `bun test packages/<its package>` (the pinned toolchain binary is `.toolchain/node_modules/.bin/bun`).
- `node scripts/verify-comment-coverage.ts` (the comments rule is a standing gate).
- Its own new tests must FAIL before the fix (state the observed red in the lane report whenever the
  defect is unit-testable).

## 5. Wave gates (captain, after the lanes land)

`node scripts/verify-dist-fresh.ts` (after rebuilding every touched package with the pinned toolchain),
`bun run typecheck`, `bun test packages/mpd-cellwork-plugin packages/mpd-verify-plugin packages/mpd-roles-plugin`,
`bun run verify:docs`, `bun run verify:comments`, `bun run verify:manifest`, `bun run verify:rows`,
`node scripts/verify-no-host-override.ts`, `node skills/dsh-qa/scripts/preset-conformance.ts` (REQUIRED —
three tool schemas change: `cellwork_dispatch`, `mpd_verify_open`, plus the split task input).

## 6. Honest bounds (do not overclaim)
- The cellwork guard reads a TOOL CALL's arguments: reaching a source path through `bash` (`cat`, `rg`) is
  NOT blocked, for the captain or the planner. The rule is stated, the tool boundary is what is enforced.
- Paths are judged by SPELLING: symlinks are never resolved.
- A recon consult's mechanical read-only deny depends on the roster's child-persona seam resolving the
  label; on a composition without that seam the discipline is the persona TEXT in the prompt (the result
  already reports `personaInjected`).
- `mpd_verify_record`'s same-agent refusal compares STRINGS: naming a real writer makes it meaningful,
  never unforgeable.
- Nothing here makes `bash` unavailable to a member; the verifier role keeps `bash` by design.
- A project-declared gate is only as honest as the project's own `mpd-gates.json`: the file can point a
  gate id at anything. What the plugin owes is that the EVIDENCE names the effective command, so a reader
  can see what actually ran. The frozen table stays the fallback only when the file is absent.
- Tests and probes must never leave a `mpd-gates.json` in THIS repository's root: the file is resolved
  from the calling session's workspace, so a stray one would silently override this repo's own gates.
  Every test/probe creates it under `mkdtemp`, never in the checkout.
- **The cell MAIL LOG FORMAT changed** (lane A, D6): `send` rows now always carry `wakeSent: false` and the
  wake outcome is a separate `wake` record (`t:"wake"`, `sent`, `reason?`, `at`), so "durable first, wake
  second" is observable in the log instead of inferred. A fold in THIS build reads an older log correctly (a
  pre-`wake` row keeps its own `wakeSent`). A reader from a PREVIOUS build would read a new row as "not
  woken" — a one-bundle-workspace bound, stated rather than hidden. Lane F documents it.
- **A reassignment changes what the same pass reports** (lane A, C6): after `cellwork_dispatch {reassign}`
  the target member OWNS an in-flight row, so other ready rows for it are reported BUSY (one task per
  member per pass) instead of being queued — the documented dispatch rule, not a regression. Lane F
  documents it.
- The captain and planner guards judge a path by its SPELLING and now allow `..` hops ONLY for the three
  instruction basenames (`AGENT.md`/`AGENTS.md`/`CLAUDE.md`); every other `..` is still refused.

## 7. Captain rulings (part of the contract — verifiers judge these too)

**R1 (scope, lane E).** Lane E may additionally edit
`packages/mpd-roles-plugin/test/captain-investigation.test.ts`, and ONLY the lines that encode the
pre-C4 "instruction files only at the root" behaviour: one nested `AGENTS.md` assertion flipped to
allowed, plus that assertion's title/comment. This is a contract-SUPERSEDED assertion, not a test weakened
to obtain a pass. The verifier must confirm: (a) the nested `README.md` refusal is still asserted, (b) no
other assertion in that file moved, (c) the file's remaining cases still fail for their original reasons.

**R2 (the planner prompt, lanes E + C).** The planner prompt lives in
`packages/mpd-cellwork-plugin/src/staging.ts` (`plannerPrompt`), which belongs to LANE C. Lane E therefore
EXPORTS the guidance from its own file `src/prompts.ts` as `PLANNER_RECON_LINES: readonly string[]` (with
its declaration comment), and LANE C adds the import + the spread inside `plannerPrompt` only. Neither
lane edits the other's file, and the splitter prompt is unchanged.

**R3 (recorded defect D16).** `agent_teams_mail`'s undelivered bound is counted workspace-wide by member
id, while `summary` is team-scoped; a retired team's backlog therefore blocks mail in a fresh team whose
member ids restart at `M1`. Board task T10 (owner `team-mail`) fixes it; its review is T11.

**R4 (the fenced field, lanes A + C).** `CellMemberRecord` lives in `state.ts` (LANE C) and
`normalizeMember` drops unknown member keys on every read — so a field written by another lane would
evaporate on the next read. Therefore the member record gains `fenced?: boolean` + `fencedReason?: string`
and `normalizeMember` preserves both (lane C, 2–3 lines with comments), while LANE A writes them from the
barrier path in `protocol.ts` and reads them in its fenced predicate. This ONE record shape is the only
coupling between A and C; neither lane edits the other's file. The two lanes may land in either order —
`bun test` strips types, so the cross-lane typecheck dependency is only closed at the captain's
integration step, and each lane must SAY that its typecheck depends on the other lane in its report.

**R5 (the superseded test, restated).** A test that encodes behaviour the frozen contract CHANGES may be
updated by the lane that owns the behaviour, and only at the assertion that encodes it — recorded per
instance as R1 above. Any further loosening needs a new ruling from the captain.

**R6 (an API change invalidates an existing test).** Three cellwork lanes share one package, so a signature
change in `activate.ts` / `dispatch.ts` / `split.ts` can break an EXISTING test (`test/activate-resume.test.ts`,
`test/flow.test.ts`, `test/cellwork.test.ts`) that no lane owns. Ruling: the lane whose src change breaks an
existing test updates ONLY the call sites/assertions that are a direct consequence of its own change, states
every such edit in its report, and never touches an assertion that is not a consequence. The reviewer
confirms each edit follows the contract rather than weakening a check. Mid-wave, the repo-wide `bun run
typecheck` is EXPECTED to be red from sibling lanes: a lane reports the errors it caused and the ones it
fixed, and the captain closes the rest at integration — nobody "fixes" a sibling lane's files to get green.

**R7 (review finding H1 on D16 — UPHELD against the code, not against the wording).** T11's reviewer proved
that a `read`/`ack` does NOT release the undelivered bound: `undeliveredOf` filters on `deliveredAt` only
while `markRead` sets `readAt`. The captain's T10 acceptance text said a read/ack frees exactly one slot —
and it should, because "ack the backlog" is the ONE release valve an operator has (the captain tried it live
today and it did nothing). RULING: the bound, `summary`'s `undelivered` and the `unread` branch all count
TEAM-scoped rows that are NEITHER delivered NOR acknowledged, through ONE shared predicate (no third
spelling). Consequences to pin: a full current-team inbox still refuses at the bound value 8 with the exact
same sentence; an ack frees exactly one slot per acked row; delivery frees exactly one slot; an unstamped
legacy row counts for nobody; a retired team's rows count for nobody. The fix is folded into the in-flight
mail task rather than opening a second concurrent edit of the same file, and the mail review (T14) verifies
this leg in addition to its own two items.

**R8 (a scope extension, recorded).** Lane C also rewords the stale `recon.ts` header paragraph, because
it is inside that package and in no lane's declared scope. Comment only.

**R9 (evidence hygiene — a scratch copy must never be committed inside the checkout).** A reviewer's
red-first comparison may COPY a package tree, but the copy lives under `mktemp -d` and only its LOG lands
under `evidence/`. Reason, observed in this wave: a copy at
`evidence/cellwork/vedit-wave/mail/prefix-family/packages/…` was picked up by a repository-root
`bun test` (the runner discovers `*.test.ts` under the cwd, AGENTS.md §11 warns about exactly this), so
27 stale test files ran and produced 5 reds that looked like regressions in `mpd-team-core-plugin` while
the package itself was green. The prescribed invocation is `bun test packages/<pkg>` (one package), and
`evidence/**` must stay free of runnable test trees.
