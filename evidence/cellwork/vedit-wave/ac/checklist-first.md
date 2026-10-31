# R1 acceptance checklist — lanes A + C (written from the frozen contract BEFORE any diff)

Basis: `.mpd/plans/cellwork-vedit-wave.md` §1 defects, §2 frozen interfaces (C1, C2, C6, C7, C8, C11,
C12), §3 lane table, §4 gates, §6 bounds, §7 rulings (R1–R8). Written before reading any lane diff or
lane report; the proving commands are filled in only by MY probes and the gates, never by the lanes' tests.

## Lane A — `packages/mpd-cellwork-plugin/src/{dispatch,protocol,protocol-core,mail}.ts` (C6, C7, D6)

- **A1 (C6)** `cellwork_dispatch` accepts `reassign?: Array<{task_id, owner}>`; for each pair, BEFORE the
  dispatch pass: the row is CLAIMED through the board (`claimant: owner`), the journal records
  `task-reassigned`, then the normal dispatch message is delivered to that member. A failure is
  REPORTED in the result, never thrown.
- **A2 (C6/C7)** the pass NEVER messages a fenced member, even when that member owns a ready row; the row
  stays `pending`.
- **A3 (C7)** the fenced predicate is TRUE on any of the three signals: `mode === "checkpoint"`,
  `handoffReady === true`, `record.fenced === true`.
- **A4 (C7)** a skipped fenced owner is REPORTED with a reason naming the member AND the repair
  (`reassign`), and the row keeps `pending`.
- **A5 (C7)** when the compaction barrier GIVES UP (all `compactionRetries` refused), the member record
  gains `fenced: true` + `fencedReason`, the journal gets `checkpoint-unrecoverable`, and
  `cellwork_supervise` lists the fenced member TOGETHER WITH the rows it owns.
- **A6 (C7)** a SECOND `cellwork_handoff` is REFUSED while a handoff already waits for the barrier (the
  refusal says the handoff is written / end the turn) — this is the livelock removal.
- **A7 (D6)** `cellwork_send` writes the durable mail row BEFORE any wake attempt; if the append FAILS,
  NO wake goes out.
- **A8 (D6, §6 bounds)** the log format is the declared one: `send` rows carry `wakeSent: false`, the wake
  outcome is a separate `wake` record (`t:"wake"`, `sent`, optional `reason`, `at`), and a fold reads an
  OLDER log (a pre-`wake` row keeps its own `wakeSent`).
- **A9 (R4)** lane A WRITES `fenced`/`fencedReason` from the barrier path and READS them in the predicate.
- **A10 (scope)** lane A edited only its declared files, and its three new tests are its own claims.

## Lane C — `packages/mpd-cellwork-plugin/src/{activate,staging,flow,index,state}.ts` (C1-activate, C2-caller, C8, C11, C12; R4, R2)

- **C1 (C1-activate)** activate raises ONE member per DISTINCT declared `member` (not one per ownerRole);
  several tasks may share one member, and several members may share one ownerRole — the latter must raise
  SEVERAL members (real parallelism).
- **C2 (C1-activate)** contracts name BOTH the owner role and the member.
- **C3 (C2-caller)** `cellwork_activate` passes the owning member's SESSION ID as `writer_id` (the id the
  cell record stores for that member) — a display name is never acceptable there — and records
  `writer_reason = "member: <name>"`.
- **C4 (C2-caller)** the opened loop file shows `writer.id` = that session id (NOT the `delegate:pending`
  placeholder) and `writer.reason` names the member.
- **C5 (C8)** one activation pass journals ONE full `cell-activation-partial` row, persisted when the pass
  FAILS; per-artifact progress is `cell-activation-progress` (stage + key + ordinal/total), never a
  re-serialised whole state.
- **C6 (C8)** every row of a pass carries a non-decreasing timestamp (the pass instant) → the journal is
  monotonic (the final `activate` row may not predate the rows above it).
- **C7 (C8/C12)** the resume contract is unchanged in substance: a re-run converges and adds no duplicate
  member, task or verify loop.
- **C8 (C11)** `cellwork_status` reports a DIVERGENCE list — live-roster members the cell record never
  learned, and cell-record members the live roster no longer has — and never mutates. `cellwork_supervise`
  is NOT in this item; its existing lossless-output test must keep passing.
- **C9 (C11, D2/D3)** staging records the staged SPLIT ticket's BOARD ID on the cell record
  (`splitTaskId`), and looks the split ticket up BY THAT ID FIRST, by owner second.
- **C10 (C11, D2/D3)** a missing/ownerless split ticket is a HARD error naming the repair verb
  `agent_teams_task {action:"claim", claimant:"cell-splitter"}`; staging REPAIRS a lost owner itself by
  claiming the row for `cell-splitter`.
- **C11 (C12)** a test fails activation at EACH stage (contract, member, task, verify loop, dispatch),
  re-runs `cellwork_activate`, and asserts convergence: no duplicate member/task/loop, final phase
  `executing`, `activatedRevision` set (D1).
- **C12 (R4)** `state.ts`'s `CellMemberRecord` gains `fenced?: boolean` + `fencedReason?: string`, and
  `normalizeMember` PRESERVES both (a field it drops on read would evaporate).
- **C13 (R2)** `staging.ts` imports `PLANNER_RECON_LINES` from `prompts.ts` and spreads it inside
  `plannerPrompt` ONLY; the splitter prompt is unchanged.
- **C14 (R6)** `test/activate-resume.test.ts` carries EXACTLY the two allowed edits: (i) the `ActivateDeps`
  `checkpoint` → `progress` dependency rename, (ii) the D7 block that now asserts ONE whole-state partial
  row + ≥10 progress rows. Every other assertion in that file is untouched.
- **C15 (scope)** lane C edited only its declared files (plus the R6 test edit above).

## Cross-cutting

- **X1** every changed file under `packages/mpd-cellwork-plugin/**` belongs to a declared lane scope
  (A/B/C/E) — a file outside every scope is a finding (attribution is the captain's, but the FILE SET is
  checkable).
- **X2** no lane weakened a test that encodes behaviour the contract does NOT change (R5/R6 audit).
- **G1** `.toolchain/node_modules/.bin/bun test packages/mpd-cellwork-plugin` exit 0.
- **G2** `node scripts/verify-comment-coverage.ts` exit 0.
- **P1** my own probes (never the lanes' tests): fence on all three signals (A2/A3), reassign ordering +
  never-fenced (A1/A2), durable-first ordering with a FAILING append (A7), one-partial + monotonic
  timestamps + resume convergence (C5/C6/C11), split-ticket owner repair + splitTaskId lookup (C9/C10),
  multi-member raise (C1), writer_id = session id + reason (C3/C4), status divergence non-mutating (C8).
