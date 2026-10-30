# Cellwork remediation — P1: resumable activation, live verify producer, lossless supervise

**Status:** FROZEN 2026-10-30 by the captain. This document is the ONLY contract the P1 writer and the
P1 verifier work from. The verifier must record its verdict before reading the implementation.

**Branch:** `fix/cellwork-resume` (cut from `origin/dev`). One git writer: the captain. No teammate
commits, rebases, or switches branches.

**Basis (measured, not invented):**
- VEdit workspace `.mpd/cellwork/cell-20261030T020634155Z/state.json`: `phase:"stopped"`,
  `activatedRevision:null`, `members` only `cell-planner`/`cell-splitter`, while the team record
  `team-20261030020635939-nqp1-002` carries six members and 29 completed tasks; the cell journal has
  ZERO `cell-activation` events.
- VEdit memory `.mpd/memory/agents/agent-vedit/repo/memory/cellwork-activate-wedge-mvucodq6.md`:
  `cellwork_activate could not open the verify loop for "T1": session "cellwork:cell-20261030T020634155Z"
  is not live in this store`; a retry then failed with `teammate "Senior Engineer" is already on the
  roster`; phase stayed `split`; dispatch worked but the verification law was lost.
- VEdit memory: `cellwork_supervise` returned `tool "cellwork_supervise" returned invalid output: value is
  not lossless JSON` after six members joined.
- Source recon in this repository (two independent read-only consults):
  - `packages/mpd-cellwork-plugin/src/activate.ts` :: `materializeSplit` runs contracts → members →
    tasks → verify loops → dispatch, and returns `{ok:false}` at each failure with no cell-record write;
    `flow.ts` :: `cellwork_activate` writes the cell record only after full success.
  - `activate.ts` :: `producerSessionId`/`producerAgent` fabricate `cellwork:<cellId>`, and the
    `mpd_verify_open` call passes it as the agent; the harness session store rejects a detached session.
  - `flow.ts` :: `cellwork_activate` refuses a retry only when `activatedRevision !== null`, which the
    failed pass never set; the reuse branch reads `deps.cell.members` only and never the live roster, so
    a retry re-raises members and `mpd-team-core` throws on a duplicate roster name.
  - `packages/mpd-cellwork-plugin/src/protocol.ts` :: `cellwork_supervise` maps
    `owner: task.owner` raw; `owner` is optional in the team record and the read view, and the harness
    refuses a tool result containing an `undefined` own key.

---

## 1. Goal

A `cellwork_activate` that fails part-way must leave a recorded, resumable state and a retry of the SAME
accepted revision must resume from it — not wedge the cell, not duplicate members/tasks, and not lose the
verification loop. The verify-loop producer must be a LIVE agent, not a fabricated session. Every cellwork
tool result must survive the harness's lossless-JSON walk.

## 2. Non-goals (P2/P3, do not implement here)

- Programmatic auto-dispatch, the dispatcher subagent, `agent/turn-stopping`/change-feed wiring.
- Direct mail/wake changes, inbox caps, supervise rendering/context changes (only the lossless projection
  of §4.3 is in scope).
- Workmate members, split-schema changes, budget/window changes.
- Any new tool, any tool-schema change, any config knob.

## 3. Required behaviour

### 3.1 Activation is resumable (the wedge fix)

**A1. State additions (tolerant, additive).** Extend `CellState` in
`packages/mpd-cellwork-plugin/src/state.ts` with exactly two optional fields:
- `activatedLoops?: Record<string, string>` — split task key → verify-loop id, for every loop actually
  opened.
- `activationInFlight?: number | null` — the revision whose materialisation is in progress.

Do not bump `CELLWORK_STATE_VERSION`. `readCell` must tolerate a record without the fields (old cells).
Do not reuse `activatedRevision` as the in-flight marker: `flow.ts` refuses a re-activation of an
already-materialised revision, so setting it on a partial pass would wedge the cell a third way.

**A2. Partial results.** `materializeSplit` must return a structured partial outcome on every failure
after the first mutation, in the shape of the existing `StageResult.partial` pattern
(`packages/mpd-cellwork-plugin/src/staging.ts`): the error plus the members already raised, the board ids
already minted (by split key), the loop ids already opened (by split key), and the contracts already
written. The caller `cellwork_activate` (`flow.ts`) must persist that partial with the existing
`transition`/`recordTransition` helper under a NEW event name `cell-activation-partial`:
- `phase` stays `split`;
- `activationInFlight` = the accepted revision;
- `members` = `{...state.members, ...partial.members}`;
- `activatedTasks` = `{...state.activatedTasks, ...partial.boardIds}`;
- `activatedLoops` = `{...state.activatedLoops, ...partial.loopIds}`;
- `activatedRevision` is NOT set.

The partial must be persisted incrementally — after each created member, each minted task and each opened
loop — so the residual window is one operation, not the whole materialisation. A crash between an
artifact and its checkpoint write is the only remaining window; a retry must reconcile that artifact from
the live roster/state (A4) instead of failing on a duplicate.

**A3. Retry resumes.** On entry `cellwork_activate` must:
- allow the call when `state.activationInFlight === acceptedRevision` (resume), even though
  `activatedRevision` is still null;
- keep refusing when `activatedRevision !== null` (already materialised) and when the split is stale,
  using the existing refusal texts;
- refuse with a teaching error when `activationInFlight` names a DIFFERENT revision;
- seed `existingMembers` from BOTH `state.members` AND the live team roster (`deps.recordFor(teamId)`),
  matching by member name, and reuse the live `executorRef`/session handle;
- seed `previous` (the kept-key map) from `state.activatedTasks`, so a resumed task reuses its board id;
- open a verify loop for EVERY code task whose split key is absent from `state.activatedLoops` — not only
  for `freshCode`. After opening, persist the loop id and re-write the contract with its loop id (the
  existing `withLoopId` path). This is the exact VEdit failure: the keys were in `keptKeys`, so a
  `freshCode`-driven pass would skip the missing loops.
- on a duplicate-roster error from `add_member` (`is already on the roster`), resolve the existing member
  from the live roster and continue instead of failing; record the reuse in the result.
- only after every task has a board id and every code task has a loop id, dispatch, and only after a
  successful dispatch set `phase:"executing"`, `activatedRevision: acceptedRevision`,
  `activationInFlight: null`, `activatedTasks`, `activatedLoops` and the members, under the existing
  `cell-activation` event.

**A4. Live producer.** Delete the use of `producerAgent`/`producerSessionId` for
`mpd_verify_open`. Pass the caller's LIVE agent (the captain's `exec.agent`, threaded through
`ActivateDeps` as `captainAgent`) to `mpd_verify_open`. If no live caller agent is available, refuse
`cellwork_activate` with a teaching error before any write (nothing materialised). Record the producer
identity as DATA on the frozen contract document (e.g. a `producer: cellwork:<cellId>` line) and journal
it; do not invent a fake session. The loop's recorded `sessionId` is the captain's session, truthfully.

**A5. Guard allowlist.** Add EXACTLY the name `mpd_verify_open` to `CAPTAIN_TOOL_NAMES` in
`packages/mpd-cellwork-plugin/src/guard.ts`. Do NOT add the `mpd_verify_` prefix:
`mpd_verify_seat`, `mpd_verify_evidence`, `mpd_verify_record` and `mpd_verify_escape` must stay refused
for the captain. Add an arm asserting both directions. (In-process `dsh.executeTool` IS guard-evaluated,
so without this exact entry the production call is denied.)

**A6. No regression of the law.** The captain may now OPEN a loop; it still cannot bind a seat, record a
verdict, or write files. A `writer:"self"` loop opened by the captain names the captain as writer, and
`mpd_verify_seat` refuses the loop's own writer session, so such a loop is inert. State this as a declared
bound (see §7).

### 3.2 `cellwork_supervise` is lossless

**B1.** Every task projection in the result must contain no `undefined` own key. `owner` is optional in
`packages/mpd-team-core-plugin/src/team-store.ts` and in the cellwork read view; either use the
conditional-spread idiom already used by `cellwork_dispatch`, or normalize (`owner: task.owner ?? ""`).
Audit the whole result for other optional fields and apply the same rule.

**B2.** Add a lossless walk over EVERY cellwork tool result (send, inbox, status, context, dispatch,
supervise, requirements, split, activate, subteam, stop, handoff) in a new test, modelled on
`packages/mpd-verify-plugin/test/row.test.ts` :: `losslessViolation` / the AC-D1 arm. The walk must reject
`undefined` own keys, non-finite numbers, negative zero and cycles. A result with a task that has no
`owner` must pass after the fix (and fail on the pre-fix source).

## 4. Tests the writer MUST add and run

New test files (do not grow the shared harness in a way that breaks existing arms):
- `packages/mpd-cellwork-plugin/test/activate-resume.test.ts`:
  1. **Loop-open failure, then resume.** Fail `mpd_verify_open` for the 2nd code task; assert the partial
     record exists (`phase:"split"`, `activationInFlight === revision`, members/tasks/loops recorded,
     `activatedRevision === null`), then retry with a working opener: no duplicate `add_member`, no
     duplicate `create_task`, every code task has a loop id, contracts carry the loop ids,
     `phase:"executing"`, `activationInFlight:null`, `activatedRevision` set.
  2. **Member-raise failure, then resume.** Fail after the 2nd member; assert the first member is
     recorded and reused by the retry (no duplicate add_member).
  3. **Task-creation failure, then resume.** Fail after the 2nd task; assert the minted board ids are
     reused and no duplicate task is created.
  4. **Dispatch failure, then resume.** All members/tasks/loops exist, dispatch throws; the retry resumes
     without re-raising/re-minting and dispatches once.
  5. **The opener receives the captain's live session id**, never `cellwork:`. Assert the agent passed to
     `mpd_verify_open` has the captain session id (and that the synthetic id no longer appears).
  6. **A duplicate-roster error is reused**, not fatal: seed the live roster with a member and assert the
     activation continues with its handle.
  7. **No live caller agent** refuses before any write.
  The failure injections must be able to fail on the pre-fix source (record the red-first run).
- `packages/mpd-cellwork-plugin/test/supervise-lossless.test.ts`: a board with one task lacking `owner`
  and one with it; assert `cellwork_supervise` passes the lossless walk; plus the walk over every
  cellwork tool result that can be invoked in the harness double.

Keep every existing package test green; do not delete arms. Update existing tests only where the state
shape or the producer identity genuinely changed.

## 5. Docs (a separate task, owned by docs-qa)

Update BOTH twins in the same commit:
- `packages/mpd-cellwork-plugin/README.md` + `README.zh-CN.md`: activation is resumable; the partial
  in-flight state; the producer is the captain's live session (and the captain may call
  `mpd_verify_open` — exact name — but not bind/record); `cellwork_supervise` is lossless.
- `docs/cellwork.md` + `docs/cellwork.zh-CN.md`: the `split`/`executing` phase text says a failed
  activation is resumable with the SAME revision, not a wedge; the verification-law bound (producer =
  captain, captain cannot bind/record; a self-writer loop is inert).
- Do not claim a live end-to-end test, a dispatcher, or mail changes in P1. Keep the language switch links
  and heading tree intact. Run `bun run verify:docs`.

## 6. Gates and evidence

The writer runs and records (in its report; the verifier re-runs the checkable subset):
- `bun test packages/mpd-cellwork-plugin` (0 fail; the new arms included)
- `bun run typecheck`
- `bun run verify:comments`
- `bun run verify:docs` (the docs task)
- `bun run test:qa` (if a QA case reaches the changed code; otherwise state why not)
- `bun run verify:rows` and `bun run verify:manifest` only if a row/manifest file changed (it must not)
- `node scripts/verify-dist-fresh.ts` AFTER the captain rebuilds `packages/mpd-cellwork-plugin/dist`
  with the pinned toolchain `./.toolchain/node_modules/.bin/bun` from the repo root. A lane never
  rebuilds dist; the captain's integration does.

Evidence dir (writer): `evidence/cellwork/fix-activate/<UTC timestamp>/` with `red-first.log`,
`tests.log`, `typecheck.log`, `comments.log`, `docs.log`, `qa.log` and a `report.md` naming the commands,
their observed exit codes and the red→green discriminator. The verifier writes its own
`verdict.json`/`output.log` under the same parent with a different timestamp and copies the frozen
contract into the evidence dir.

## 7. Declared bounds (carry into the PR and the README)

1. **The resume is not a transaction.** The per-artifact checkpoint shrinks the residual window to one
   board/verify call plus one cell-record write. A duplicate board row is possible only if `create_task`
   succeeded and its checkpoint write failed; the retry reconciles members by name and tasks by recorded
   key, and a duplicate is detectable but not deletable (the team plane has no cancel verb).
2. **The verify-loop producer is the captain's own session**, recorded truthfully. The captain may open a
   loop; it cannot bind a seat, record a verdict, or write, so a self-writer loop it opens is inert.
3. **No live-LLM end-to-end activation run** is claimed in P1; the resume is unit-tested with injected
   failures. A live run is the P2 dispatcher QA's subject.
4. **An already-wedged stopped cell is not migrated** (VEdit's cell is archived). The fix applies to new
   cells and to a cell whose activation failed after this change.
5. **Blindness stays prose** (the repository's standing bound); P1 changes no verification hook.

## 8. Verifier instructions (verifier-a)

1. Read THIS contract and the four doc twins FIRST. Do not read `activate.ts`/`state.ts`/`flow.ts`/
   `guard.ts`/`protocol.ts` or their tests before you record the verdict.
2. Open/accept the loop the captain opened for the P1 work task; bind your seat with `mpd_verify_seat`.
3. Run the gates you can run from the contract/docs: `bun test packages/mpd-cellwork-plugin`,
   `bun run typecheck`, `bun run verify:comments`, `bun run verify:docs`, and one `mpd_verify_evidence`
   gate; inspect the writer's evidence files are present and internally consistent.
4. Record a PASS or FAIL with `mpd_verify_record` BEFORE reading the implementation. A PASS needs
   `sources` = [this contract, the package README pair, the docs pair] and at least one gate id. A FAIL
   needs findings, each with the doc source that proves it; do not fix anything.
5. Only a recorded FAIL unlocks reading the implementation for diagnosis. A FAIL goes back to the
   captain as a repair task for the writer.
6. State the bounds: what you did not read and what you could not run.
