# P1 writer report — resumable activation, live verify producer, lossless supervise

**Contract:** `.mpd/plans/cellwork-remediation-p1.md` (FROZEN 2026-10-30). This report is the writer's
evidence for task T2; the verifier works from the contract and the docs, never from this report's reasoning.

**Branch:** `fix/cellwork-resume`. No commit, branch, switch, reset or stash was run (the captain is the
only git writer). Docs twins are docs-qa's and were left exactly as found.

**Evidence dir:** `evidence/cellwork/fix-activate/writer/20261030T094745Z/`
(`red-first.log`, `tests.log`, `typecheck.log`, `comments.log`, `docs.log`, `qa.log`, this report).

## 1. What changed (paths + symbols)

| File | Symbols | Change |
|---|---|---|
| `packages/mpd-cellwork-plugin/src/state.ts` | `CellState.activatedLoops`, `CellState.activationInFlight`, `newCellState`, `normalizeCellState` | A1: two OPTIONAL additive fields; version stays 1; an old record without them reads as `{}` / `null`. |
| `packages/mpd-cellwork-plugin/src/activate.ts` | `producerIdentity` (replaces `producerSessionId`/`producerAgent`), `ActivateDeps.checkpoint`, `ActivatePartial`, `ActivateOutcome.reused`, `buildContractDoc`, `materializeSplit` | A2/A3/A4: per-artifact checkpoint, structured partial, live-roster member seed + duplicate reconciliation, loops opened for every code task missing from `activatedLoops`, dispatch gate, dispatch-stage catch, producer recorded as data (`producer: cellwork:<cellId>`) and journaled. |
| `packages/mpd-cellwork-plugin/src/flow.ts` | `cellwork_activate` execute, `persistPartial` | A2/A3/A4: live-agent refusal before any write; different-revision in-flight refusal; checkpoint wiring; final partial persisted on failure under `cell-activation-partial`; success transition sets `phase:"executing"`, `activatedRevision`, `activationInFlight:null`, merges `activatedLoops`; result/journal carry `reused`. |
| `packages/mpd-cellwork-plugin/src/guard.ts` | `CAPTAIN_TOOL_NAMES`, `captainRefusal` | A5: exactly `mpd_verify_open` added by name; every other `mpd_verify_*` stays refused. |
| `packages/mpd-cellwork-plugin/src/protocol.ts` | `superviseTaskRow`, `cellwork_supervise` task projection | B1: conditional-spread projection — a task row without `owner` omits the key instead of carrying `undefined`. |
| `packages/mpd-cellwork-plugin/test/activate-resume.test.ts` | NEW (8 arms) | §4 arms 1–7 + the A1 tolerant-read arm. |
| `packages/mpd-cellwork-plugin/test/supervise-lossless.test.ts` | NEW (2 arms) | B1 ownerless-task arm + the B2 walk over 13 cellwork tool results. |
| `packages/mpd-cellwork-plugin/test/cellwork.test.ts` | NEW arm `A5:` | Both directions: `mpd_verify_open` allowed; `mpd_verify_seat`/`_evidence`/`_record`/`_escape` refused. |

No row, manifest, package.json, dist or docs file was touched. `git status` shows the five src files, the
three test files and docs-qa's four doc twins (not mine).

## 2. Commands and observed results

All run from the repo root, this tree, 2026-10-30 (UTC+8).

| Command | Exit | Observed |
|---|---|---|
| `bun test packages/mpd-cellwork-plugin` | **0** | 71 pass / 0 fail / 832 expect() across 5 files (60 pre-existing + 8 resume + 2 lossless + 1 A5) |
| `bun run typecheck` (`tsgo --noEmit`) | **0** | no diagnostics |
| `bun run verify:comments` | **0** | 481 files, 43891 declarations — VERDICT: PASS |
| `bun run verify:docs` | **0** | pairs=52 failed=0 violations=0 — PASS (docs-qa's drafts in the tree) |
| `bun run test:qa` | **0** | all self-tests passed |
| `bun run verify:rows` / `bun run verify:manifest` | not run | no row/manifest file changed (contract §6 says only if one changed) |
| `node scripts/verify-dist-fresh.ts` | not run | contract §6: integration-side AFTER the captain rebuilds `dist` with the pinned `./.toolchain/node_modules/.bin/bun`; no lane rebuild |

## 3. Red → green discriminator

The two new test files and the A5 arm were written and run BEFORE any implementation change (observed:
7 resume arms failing on `activationInFlight === undefined` / the propagated dispatch throw, the lossless
arm failing with `$.tasks[0].owner is undefined, which JSON cannot represent losslessly`). The bash `/tmp`
is per-call (T-23), so the red run was REPLAYED for the evidence: `red-first.log` is
`git archive HEAD packages` (the PRE-FIX sources, my edits absent) + the same three test files, run in a
scratch tree under `.mpd/tmp/` (removed afterwards). Result: **21 pass / 10 fail / exit 1**, every failing
arm one of the new ones:

```
(fail) A1–A3: a verify-loop failure records the partial in-flight state, and the retry resumes it
(fail) A2/A3: a member-raise failure records the member, and the retry reuses it instead of re-raising
(fail) A2/A3: a task-creation failure records the minted id, and the retry reuses it
(fail) A2/A3: a dispatch-stage failure records every artifact, and the retry dispatches once
(fail) A4: the verify-loop opener is the captain's live agent, and the producer survives only as data
(fail) A3: a duplicate-roster answer is resolved from the live roster, never fatal
(fail) A4: activation without a live caller agent refuses before any write
(fail) A1: a record written before the in-flight fields existed still reads
(fail) A5: the captain may open a verify loop BY EXACT NAME, and every other mpd_verify_* call stays refused
(fail) B1: cellwork_supervise walks losslessly with a task row that has no owner
```

Against the fixed sources the same files are **71 pass / 0 fail** (`tests.log`). No existing arm was
deleted or edited to pass; the only existing-test edit is the new A5 arm.

## 4. Per-contract-clause evidence

- **A1** — fields optional/additive, `CELLWORK_STATE_VERSION` unchanged; resume arm asserts the on-disk
  partial shape and the tolerant-read arm deletes both fields from a state file and reads it back.
- **A2** — arm 1 asserts the failure is persisted across MULTIPLE `cell-activation-partial` rows (>=10:
  2 contracts + 3 members + 4 tasks + 1 loop, plus the final error-carrying row), the last row carries the
  error, and `activatedRevision` stays null. `persistPartial` writes `phase` unchanged (split on the initial
  path), `activationInFlight`, members/board ids/loop ids merged.
- **A3** — arms 1–4 fail at the loop/member/task/dispatch stage and resume without a second `add_member`,
  `create_task`, `mpd_verify_open` or dispatch; arm 1 asserts only the MISSING loop is opened on the retry;
  arm 6 asserts a duplicate-roster answer resolves to the live handle `handle-live-senior` and is recorded
  in `outcome.reused`; flow refuses a different revision while one is in flight.
- **A4** — arm 5 asserts every `mpd_verify_open` agent carries `session-captain`, no call agent contains
  `cellwork:`, the contract carries `producer: cellwork:<cellId>`, and the journal carries the producer;
  arm 7 asserts the no-live-agent refusal leaves the state file byte-identical and opens nothing.
- **A5** — the new `cellwork.test.ts` arm (both directions) plus the existing `...CAPTAIN_TOOL_NAMES`
  allowed-loop.
- **A6** — no new write path: the captain guard's file-work refusals and `mpd_verify_record` refusal arms
  are unchanged and still green; the declared bound (a captain-opened self-writer loop is inert) stands.
- **B1/B2** — the ownerless-task arm is the red→green discriminator; the walk rejects `undefined` own keys,
  non-finite numbers, **negative zero** and cycles, and is applied to 13 tool results
  (`status`, `context`, `inbox`, `send`, `requirements`, `split submit`, `split show`, `activate`,
  `dispatch`, `supervise`, `handoff`, `subteam`, `stop`).

## 5. What is NOT proven (declared bounds)

1. **No live-LLM end-to-end activation** (contract §7 bound 3). The resume is proven by injected failures
   in the flow harness; a live run belongs to P2's dispatcher QA.
2. **No real boot/mount of the changed rows** — the package `dist/` is stale until the captain rebuilds it
   with the pinned toolchain; `verify-dist-fresh` is the integration step, not this lane's. No claim is
   made that a booted harness passes; only the offline suite above.
3. **The dispatch-stage arm** injects a THROW from the live-record read the dispatch stage depends on.
   `dispatchOwnerOnly` deliberately swallows per-send errors into `skipped`, so a "throwing dispatch" cannot
   be produced through the executor's send seam without faking it; the resumable behaviour the contract
   asserts (partial, then one dispatch on the retry) is what is tested.
4. **A re-split partial keeps `executing`.** The phase is never moved backwards: `phase stays split` holds
   for the activation-from-`split` case the contract targets, and a re-split of an already-executing cell
   keeps `executing` on a partial failure (the contract never asks a running cell to regress to `split`).
   Flags for the verifier/docs-qa: the docs sentence "the phase stays `split`" is written for the primary
   case only.
5. **`test:qa` is the self-test lane.** The real QA cases (`cellwork-mount`, `cellwork-command`) were not
   run: they need the rebuilt dist and an isolated boot, which the captain's integration owns.
6. **The per-artifact checkpoint is not a transaction** (contract §7 bound 1): the residual window is one
   artifact plus its record write; a duplicate board row from that window is detectable but not deletable.

## 6. Findings outside the lane's scope

- The four docs twins are docs-qa's drafts; they were READ only to check consistency. They match the
  implementation (resumable activation, `activationInFlight`/`activatedLoops`, duplicate `add_member`
  reused, `producer: cellwork:<cellId>` as data, exact `mpd_verify_open`, lossless supervise) except the
  `phase stays split` wording noted in §5.4, which is a scope-of-the-sentence nuance, not a behaviour gap.
- `packages/mpd-cellwork-plugin/dist/index.js` still carries the pre-fix code (including
  `producerAgent`); it must be rebuilt by the captain, not this lane.
