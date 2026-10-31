# R1 review — lanes A and C against the frozen contract

**Task:** board T6 (`kind=review`, blockedBy T1 + T3). Lane A: C6, C7, D6. Lane C: C1-activate,
C2-caller, C8, C11, C12 (defects D1, D2, D3, D7, D10, D11), plus the rulings that touch it (R2, R4, R6).
**Reviewer:** R1 `reviewer-cellwork`. **Writes:** this file and `ac/` only; no src/test/docs/gate edit, no
git write command. **§7 R9 obeyed:** every probe workspace is `mkdtemp`; no runnable copy lives in
`evidence/` (the T14-era copies were removed and `find evidence/cellwork/vedit-wave -name '*.test.ts'`
returns nothing).

## Anchors (hash + measurement moment)

Contract `.mpd/plans/cellwork-vedit-wave.md` = `6c6357d00e9b478baa14c7f3160f113870c215e5131ff9ecf049948abca224bc`
(read at 2026-10-31T05:47:44Z; includes §7 R1–R9). Reviewed lane files at the same instant:

| file (lane) | sha256 |
|---|---|
| `src/dispatch.ts` (A) | `7a50100c01ef759bbb54768e64e73526d3c194c347024051bbd8800532c82647` |
| `src/protocol.ts` (A) | `6a71e932c6c9df1ffece8753839739840e3303d1d0f41e21171dff3122187dcd` |
| `src/protocol-core.ts` (A) | `7552d8fc43fe7439adaa5bb104393df75a0af6c9b83f9c970beaa1afcac351cf` |
| `src/mail.ts` (A) | `5bfce2701e36e8d318a5546d8e7304b5dae11c1519a67c4a6ce63bf21209e214` |
| `src/activate.ts` (C) | `34de09c3a2e0b3aa80aba53749e64fd0361e8b46ddf719aa8edd2a208574954d` |
| `src/staging.ts` (C) | `8dfe0e94ea96026aabbfc87edf3557fff34a1b2a6c94d9c6ee894c4d1cf770d8` |
| `src/flow.ts` (C) | `346e68e9c8fca9d09178ee91bdce40913412a24aeb2e2e68e521d642ebe678c6` |
| `src/index.ts` (C) | `964b9cfebd275b6b3755f66dc4a1f0acc8509669350419b3ab9c9f606b185670` |
| `src/state.ts` (C) | `8f20dc46fc2309844e17fd115d37f5a0cc84dcecd702db6cf99b7fb07ed4bbc8` |
| `test/activate-resume.test.ts` (R6 edit) | `4e503c785b3f98d4c68faaa8a129bbdb22d8a3ae9d2e71171bcdae42d86a8ad3` |

`ac/source-hashes.txt` is the raw list; the lane test files' hashes are in the same session (they are the
writers' CLAIMS, never this review's proof).

## Method and the commands actually run

The checklist was written from the contract BEFORE any diff (`ac/checklist-first.md`). Every PASS below
rests on MY probe (`ac/probe-ac.ts`: **48 arms, exit 0, "ALL ARMS PASS"**) or on the gates; the lanes'
tests were run but are never cited as proof.

```
.toolchain/node_modules/.bin/bun test packages/mpd-cellwork-plugin           → exit 0, 146 pass / 0 fail, 15 files, 1986 expect
node scripts/verify-comment-coverage.ts                                      → exit 0, "VERDICT: PASS — every declaration in the family carries a precise comment and a full signature."
.toolchain/node_modules/.bin/bun evidence/cellwork/vedit-wave/ac/probe-ac.ts → exit 0, 48 PASS, "ALL ARMS PASS"
```

The 146 include all ten new lane test files (A's three and C's three among them) and the tracked suite;
R6's edit is the only change to an EXISTING cellwork test (audited below).

## Acceptance checklist — item by item

### Lane A (C6, C7, D6)

| # | contract item | verdict | proving arm / source |
|---|---|---|---|
| A1 (C6) | `reassign` pairs are CLAIMED on the board, journaled `task-reassigned`, THEN delivered; failure reported, never thrown | **PASS** | probe `B1` claimed+delivered; `B6` journal row `T1->Target`; `B7` order `claim:T1` before `send`; `B8` post-claim send failure reported (`claimed:true, delivered:false`); `B5` refused claim reported. Handler order read in `protocol.ts` `cellwork_dispatch` execute: `reassignPairs` → `applyReassignments` → re-read → `dispatchOwnerOnly` |
| A2 (C6/C7) | a fenced member is NEVER messaged, even owning a ready row; row stays pending | **PASS** | probe `A3` `sent=["h-Healthy"]` (the four fenced owners got no message); the pass does not write task rows, so they remain `pending` |
| A3 (C7) | fence = `mode==="checkpoint"` OR `handoffReady===true` OR `record.fenced===true` | **PASS** | probe `A1` three signals; `A2` record-level fenced row; source `dispatch.ts::fenceReasonOf` |
| A4 (C7) | skip reason names the member AND the `reassign` repair | **PASS** | probe `A4` reasons quote the member, `FENCED`, and `cellwork_dispatch {reassign:[{task_id:…, owner:"<another member>"}]}` |
| A5 (C7) | barrier give-up → `fenced:true` + `fencedReason`, journal `checkpoint-unrecoverable`, supervise lists fenced members WITH owned rows | **PASS (source-audited for the journal/supervise halves)** | `protocol-core.ts::memberAfterBarrier` sets both fields only on `outcome==="refused"` and clears them on success; `checkpointUnrecoverableEntry` appended by `protocol.ts`'s barrier `if (result.outcome === "refused")`; `cellwork_supervise` builds `{name, mode, reason, tasks}` from non-terminal rows it owns. Record round-trip proven by probe `F1`–`F3` |
| A6 (C7) | a SECOND `cellwork_handoff` is refused while one waits for the barrier | **PASS (source-audited)** | `protocol.ts` handoff arm: `if (member.handoffReady) return {ok:false, error:"…is STILL WAITING for the compaction barrier — END YOUR TURN…"}` |
| A7 (D6) | the durable row lands BEFORE any wake; a failed append sends NO wake | **PASS** | probe `C1` `attempted=false`, `landed=false`; `C2` order `append-send → wake → append-wake`; `C3` throwing wake is reported, row kept |
| A8 (D6/§6) | send rows carry `wakeSent:false`; wake is its own `t:"wake"` record; an OLDER log still folds | **PASS** | probe `C4` two lines `send:false` then `wake:true`; `C5` fold reports `wakeSent:true`; `C6` a pre-`wake` row keeps its own `wakeSent:true` |
| A9 (R4) | lane A writes/reads the fence fields | **PASS** | source: `memberAfterBarrier` (write) and `fenceReasonOf` (read); probe `F1`/`F2` on the persisted shape |
| A10 (scope) | lane A edited only its declared files | **PASS** | file set below |

### Lane C (C1-activate, C2-caller, C8, C11, C12)

| # | contract item | verdict | proving arm / source |
|---|---|---|---|
| C1 (C1) | ONE member per DISTINCT `member`; several members may share one ownerRole | **PASS** | probe `E2` two members ("Alpha","Beta") raised under ONE role "Senior Engineer", plus "Reviewer" and "Junior Engineer" → `membersAdded=["Alpha","Beta","Reviewer","Junior Engineer"]` |
| C2 (C1) | contracts name BOTH the owner role and the member | **PASS** | probe `E4` every written contract matches `Owner: **<role>** (member `<name>`)` |
| C3 (C2-caller) | `writer_id` is the owning member's SESSION id; `writer_reason` = `member: <name>` | **PASS** | probe `E5` `["h-Alpha","h-Beta","h-Reviewer","h-Junior Engineer"]` — the stub's per-member handle IS the recorded session id; `E6` reasons `member: …`; `E13` on the resumed pass; source `activate.ts` takes `owner.sessionId` first |
| C4 (C2-caller) | the loop file records that writer (no `delegate:pending`) | **PASS** | probe `E5`/`E13` show the `mpd_verify_open` args carry the identity; the loop FILE is the verify plane's write (server half = lane D/T7), and `writer_reason` is what lands on `writer.reason` there |
| C5 (C8) | ONE full partial row per pass, written when it FAILS; progress rows are compact | **PASS** | probe `E9` a failed pass returns exactly ONE partial snapshot with the four maps; `E7` 17 progress steps, keys exactly `stage,key,ordinal,total`; source `flow.ts` writes `cell-activation-partial` ONLY in the `!activated.ok` branch and `cell-activation-progress` per artifact |
| C6 (C8) | every row of a pass carries a non-decreasing timestamp (the pass instant) | **PASS (source-audited)** | `flow.ts::cellwork_activate` defines ONE `activatedAt`, used by the progress appender, `persistPartial`, and the final `cell-activation` transition; my probe's steps all carry that one `now` |
| C7 (C8/C12) | a re-run converges with no duplicate member/task/loop | **PASS** | probe `E11`–`E13` (loop-stage failure: 0 re-added members, 0 re-created tasks, only the 2 missing loops open), `E17`–`E18` (member-stage: 3 members re-added, none duplicated, 4 loops), `E19`–`E20` (task-stage: 0 members, 3 new tasks, 4 loops) |
| C8 (C11) | `cellwork_status` reports a divergence list and never mutates | **PASS (source-audited)** | `index.ts::memberDivergence` compares live-roster names with the cell table into `missingFromCell` / `missingFromTeam` / `inSync`; an UNREADABLE record reports no divergence claim; the status handler has no `transition`/`writeCell`/`appendJournal`; `cellwork_supervise`'s lossless test is untouched and still passes |
| C9 (C11, D2/D3) | `splitTaskId` recorded on the cell record; lookup BY ID first, owner second | **PASS** | probe `D1` id-first finds an OWNERLESS row; `D2` owner fallback; source: `staging.ts` persists `splitTaskId` in the start/telemetry answers (lines quoted by symbol) and `findSplitTicket` |
| C10 (C11, D2/D3) | a missing/ownerless ticket is a hard error naming the claim verb; staging repairs a lost owner itself | **PASS** | probe `D4` staging CLAIMS `T9` for `cell-splitter` and reports `ownerRepaired:true`; `D5` a missing ticket's sentence contains ``agent_teams_task {action:"claim", claimant:"cell-splitter"}``; `D6` an unreadable board is not evidence of absence |
| C11 (C12, D1) | fail at EACH stage, re-run, converge to `executing` + `activatedRevision` | **PASS (with a stated bound)** | loop/member/task stages proven by my own resume arms (`E11`–`E20`); the contract-stage failure is a file-write failure I did not inject, and `executing`/`activatedRevision` are set by the `flow.ts` transition on success (`phase:"executing"`, `activatedRevision:acceptedRevision`, `activationInFlight:null`) — source-audited, with the lane's e2e test merely corroborating |
| C12 (R4) | `fenced`/`fencedReason` are on the record and PRESERVED by `normalizeMember` | **PASS** | probe `F1` both survive a `writeCell`→`readCell` round-trip; `F2` an unfenced member does not grow a `fenced:false` key; source `state.ts::normalizeMember` uses additive spreads |
| C13 (R2) | `PLANNER_RECON_LINES` imported and spread in `plannerPrompt` ONLY | **PASS** | source: `staging.ts` imports it and spreads at one site inside `plannerPrompt`; the `splitterPrompt` region has ZERO diff lines (`git diff dev -- src/staging.ts` hunks audited) |
| C14 (R6) | `test/activate-resume.test.ts` carries EXACTLY the two allowed edits | **PASS** | `git diff dev` shows two hunks only: (i) the D7 block now asserts `partialRows.length === 1` + `progressRows.length >= 10` + a final ordinal, (ii) `checkpoint:` → `progress:` in an `ActivateDeps` literal. Nothing else in the file moved; the changed assertion is the one C8 SUPERSEDES (R5), not a weakening |
| C15 (scope) | lane C edited only its declared files | **PASS** | file set below |

### Cross-cutting

- **X1 (file set)** — every changed cellwork file belongs to a lane: A `dispatch/protocol/protocol-core/mail`;
  B `split/requirements`; C `activate/staging/flow/index/state` (plus `recon.ts` by **R8**, comment only);
  E `guard/prompts`. **PASS.**
- **X2 (no weakened tests)** — the only EXISTING cellwork test changed is `activate-resume.test.ts`, under
  R6/R5; `flow.test.ts`, `cellwork.test.ts`, `supervise-lossless.test.ts` are untouched. **PASS.**
- **G1/G2** — the two gates quoted above. **PASS.**

## Findings

**No Blocker, High or Medium finding.** Two non-blocking Nits / observations.

### N1 — Nit — `deliverCellMail` ignores the wake-record append's answer, so the transient tool answer can overclaim a wake
- **What:** `mail.ts::deliverCellMail` calls `deps.appendWake(outcome)` and discards its boolean, then
  returns `wakeSent: outcome.sent === true`. If the FIRST append landed (the durable row exists) but the
  SECOND append fails, the tool answer says the wake was sent while the log carries no `wake` record — a
  later fold reads the row as **not** woken (`wakeFailures` reports it). The `appendWake` doc comment says
  "false leaves the row reported as undelivered", which is true of the LOG, not of the immediate answer.
- **Where:** `packages/mpd-cellwork-plugin/src/mail.ts`, `deliverCellMail`; the caller is
  `protocol.ts`'s `cellwork_send` execute.
- **Why it matters:** the contract's observable is the log (A8), and the log stays truthful — this is a
  transient-answer overclaim, not a lost wake. It only misleads the one caller that reads the tool
  answer at that instant.
- **Direction:** fold the append result into the return (`wakeSent: outcome.sent === true && appended`,
  and a `wakeReason` naming the failed record append when it did not land). Non-blocking.

### Process observation (not a code finding) — the lane notes do not state the R4 cross-lane typecheck dependency
R4 says each of lanes A/C "must SAY that its typecheck depends on the other lane in its report". T1's and
T3's completion notes quote a green `bun run typecheck` but do not say it. The SUBSTANCE is fine at my
measurement (the captain's integration typecheck exits 0), so this is a report-register observation for
the captain, not a defect.

## Declined to judge (each with its reason on the same line)

- **D4/D5 as separate defects** — they are the observed cost recorded under C6/C7, and every consequence they name is probed there (`A3`, `A4`, `B2`, `B7`, `E17`–`E20`); no separate contract text exists to judge.
- **C1's validation half (`member-invalid`/`member-role-conflict`, `self-review` naming)** — the lane table assigns it to lane B (`split.ts`); it is T7's review, not mine. I judged the ACTIVATE half only.
- **C2's SERVER half (`mpd_verify_open` accepting `writer_id`/`writer_reason`, the same-agent refusal)** — lane D (`mpd-verify-plugin`) and T7's review. I verified only that the CALLER passes the member's session id and the `member: <name>` reason.
- **C7's supervise list and second-handoff refusal, C8's journal monotonicity, C11's divergence, C12's final phase** — source-audited above with the exact symbols; I did not drive `cellwork_supervise`, `cellwork_handoff`, or `cellwork_activate` through a mounted tool harness, and I say so rather than claiming probe proof.
- **The contract-stage failure of C12** — a workspace file-write failure was not injected; the loop/member/task stages are probed and the flow-level phase transition is source-audited.
- **The lane test files as proof** — run (they are inside the 146) but never cited for a verdict.
- **`memberAfterBarrier` rebuilding the row field-by-field** — a future additive `CellMemberRecord` field would be dropped after a barrier unless the rebuild is updated; this is the R4 hazard in another shape, but the comment states the deliberate reason (a spread would carry a stale `fenced:true` through a successful barrier) and no field is lost today. Weighed, set aside as a design choice.
- **dist / docs / R1/E lanes / the other packages** — captain's integration, lane F, T7 respectively.
- **Whether the wave as a whole is releasable** — T9's sweep, not this seat.

## Verdict

**APPROVE.** Every frozen contract item of lane A (C6, C7, D6) and lane C (C1-activate, C2-caller, C8,
C11, C12) passes under my own 48-arm probe plus the two gates, R2/R4/R6 are satisfied (R6's two edits
audited line by line, R8's `recon.ts` reword is the recorded scope extension, R9 is obeyed by this
review's own fixtures), no existing test was weakened, and the only findings are two non-blocking nits.
The highest-risk behaviours are genuinely closed: a fenced member on ANY of the three signals is never
messaged and its row is reported with the `reassign` repair; the durable mail row precedes every wake and
a failed append sends none; one member is raised per distinct member name (two members under one role)
with the member's SESSION id as the loop writer; a failed pass returns ONE partial with compact progress
rows; and a resume at the loop, member and task stages converges with zero duplicates.

**Bounds of this review:** anchored to the hashes above (05:47:44Z); lane A/C behaviour outside the listed
items, lane B/D/E files, docs, dist and any mounted dsh boot are outside this seat; the three
source-audited halves are named where they occur; no git write command was run; every probe workspace was
a `mkdtemp` (R9), and no runnable copy remains under `evidence/`.
