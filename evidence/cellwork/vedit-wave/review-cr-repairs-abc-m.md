# R1 re-review — CR repairs A, B, C and the mail repair M (T25)

**Task:** board T25 (blockedBy T18, T19, T20, T23). Basis: each repair row's frozen wording + the wave
contract. The CJK identity-key follow-up (T28) is NOT in my checklist and is NOT judged.
**Reviewer:** R1 `reviewer-cellwork`. **Writes:** this file and `ac2/` only; no src/test/docs/gate edit, no
git write. **§7 R9:** all probe workspaces are `mkdtemp`; `find evidence/cellwork/vedit-wave -name '*.test.ts'`
→ 0.

## Anchors (hash + measurement moment)

| file | sha256 | measured (UTC) |
|---|---|---|
| `packages/mpd-cellwork-plugin/src/dispatch.ts` | `cb00a9281ce9b4a5b240be15e8cf308bf43cbe54a3ef77fa642b44aabe5718af` | 06:41:20Z, stable at 06:42:22Z |
| `.../src/protocol.ts` | `f850e9f27a241edf48460c3511fc33a3485edf9cd2e769a4eadce8d6fa8c417a` | same |
| `.../src/mail.ts` | `d496546276bed1e77c5e2b309a39bea25686c07c8c87ad351049bf96066b6810` | same |
| `.../src/split.ts` | `4eb91c2e77f47dfc74e4903fd6f2020cc9d314bdfd6ee768c924988dd44ffcb0` | same (MOVED during the review: `41530667…` at 06:35:36Z → current at 06:41:20Z; see the T28 bound) |
| `.../src/flow.ts` | `4c924c2df3313f9dcb8108d76d20c4e79639adf03bf09b680a86d910ea795b62` | same |
| `.../src/staging.ts` | `3930f17e309d26f9478fca909441286192f06d82f5a97af36e18044345f1618d` | same |
| `.../src/index.ts` | `c0636ed9b36b637a1a31c303770802159856e6cf2a74e585f66e554d8cf186ea` | same |
| `.../src/activate.ts` | `34de09c3a2e0b3aa80aba53749e64fd0361e8b46ddf719aa8edd2a208574954d` | same — **identical to the T6 anchor**, i.e. the CR#5 repair did not change activation |
| `.../test/mail-order.test.ts` | `18685555a4f69b376e7bce3016faa17d7070659a1c0a04cdc37b29fd44be5112` | same |
| `packages/mpd-team-core-plugin/src/index.ts` | `ae15ed081c67040c33250cc990f18349f9bbbff06666e2bf3859c1a9122ed10a` | same |

`ac2/source-hashes.txt` is the raw list. Probes and gates were RE-RUN after the split.ts move settled.

## Method and commands actually run

Checklist written first (`ac2/checklist-first.md`). Every PASS rests on MY probe or a gate; the lanes'
tests were run but never cited as proof. Two probes: `ac2/probe-ac2.ts` (35 arms) and
`ac2/probe-mail-m.ts` (7 arms).

```
bun evidence/.../ac2/probe-ac2.ts     → exit 0, 35 PASS, "ALL ARMS PASS"
bun evidence/.../ac2/probe-mail-m.ts  → exit 0, 7 PASS,  "ALL ARMS PASS"
bun test packages/mpd-cellwork-plugin → exit 0, 172 pass / 0 fail (18 files)
bun test packages/mpd-team-core-plugin → exit 0, 407 pass / 0 fail (27 files)
node scripts/verify-comment-coverage.ts → exit 0, "VERDICT: PASS — …"
bun test packages/mpd-cellwork-plugin/test/mail-order.test.ts -t "N1" → exit 0, 2 pass (uid 1000; the permission arm and the seam arm)
```

## Checklist — one line per frozen item

| # | item | verdict | proving observation |
|---|---|---|---|
| 1 | **CR#2** — reassign to a `failed` member is refused as a REPORTED outcome, the row stays pending, the transport is not called | **PASS** | `CR2-1` outcome `claimed:false, delivered:false, reason:"…FAILED to start…"`; `CR2-3` claim seam saw only T3, transport only `h-Target`; `CR2-4` all four rows still `pending`; `CR2-6` fenced target still refused (no regression) |
| 1b | same for `provisioning` | **PASS** | `CR2-2` reason `"…is still being raised — retry…"`; `CR2-3` not claimed, not messaged |
| 2 | **CR#4** — a blank (and whitespace-only) cell `executorRef` falls through to the LIVE roster handle in BOTH the dispatch pass and the reassign path | **PASS** | `CR4-1` `handleOrNull("")/("   ")/(undefined)/(42)` → null, `" h1 "` → `"h1"`; `CR4-2` dispatch delivered both through `h-live-1`/`h-live-2`; `CR4-3` reassign delivered both through the same live handles; `CR4-4` absent on both sides still reports "no executor handle" |
| 3 | **CR#7** — the N1 end-to-end arm is skipped-as-root WITH its reason, its claims hold non-root, the seam arm is unconditional; a failed `wake`-record append reports NOT sent with its own reason while the log keeps the message | **PASS** | source: `test/mail-order.test.ts` has `process.getuid?.() === 0` → `test.skip` and the stated `" [SKIPPED as root: … seam-level N1 arm …]"`, while the seam arm is a plain `test(`; `-t "N1"` ran both arms as uid 1000 → 2 pass; probe `CR7-1` `{landed:true, wakeSent:false, wakeReason:"…transport accepted it, but its \`wake\` record could not be written…"}`; `CR7-2` order `send-row → wake → wake-record`; `CR7-3` a failed send append still attempts NOTHING; `CR7-4` control both appends → sent |
| 4 | **CR#5** — a work/review pair spelling one seat two ways is REFUSED as `self-review`; different roles → `member-role-conflict`; punctuation-only → `member-invalid`; identical spellings share one member; `activate.ts` untouched | **PASS** | `CR5-1` finding `self-review` (identity `"seat-a"` from `"Seat A"` vs `"seat-a"`); `CR5-2` `member-role-conflict`; `CR5-3` `member-invalid` for `"---"`; `CR5-4` identical spellings raise no conflict/self-review; `CR5-5` `activate.ts` sha256 equals the T6 anchor `34de09c3…`; `CR5-6` activation raises exactly one member `["Seat A"]` |
| 5 | **CR#3** — two consecutive `update`s with no splitter progress append exactly ONE replacement row and the second REUSES it (id written back); a LIVE row beats a recorded CLOSED one | **PASS** | `CR3-1` first update minted R1, board rows 1→2; `CR3-2` response `recordedSplitTaskId=R1` AND the cell record's `splitTaskId=R1`; `CR3-3` second update `splitTaskId=R1, redispatchable:true, replacementSplitTaskId:""`, still minted=1 and rows=2; `CR3-4` exactly one `split-task-replaced` journal row; `CR3-5` both `requirements-update` rows carry the recorded id, the second `redispatchable:true`; `CR3-6` a board holding a closed `T1` plus a live `R9` picks `R9` and appends nothing; `CR3-7` `recordedSplitTaskId=R9` |
| 6 | **CR#6** — a FAILED owner repair still records the ticket id and journals the error; a later ID-first lookup finds the row | **PASS** | `CR6-1` `{splitTaskId:"T9", ownerRepaired:false, repairError:"…could not be claimed (…blocked…) — repair it with …"}`; `CR6-2` the sentence names the claim verb; `CR6-3` `findSplitTicket(rows, "T9", false)` → `T9`; `CR6-4` the claim WAS attempted with `claimant:"cell-splitter"`; `CR6-5/6` staging keeps `tasks:{splitId}` + `ownerRepairError` on the refused branch, and `index.ts` journals `splitTaskId` + `ownerRepairError` on the partial/staged rows |
| 7 | **CR#9** — a supplied-but-unresolvable `member` is REFUSED naming the value and lists NO mail; member id and name still resolve; omitting `member` still reads the caller's own inbox | **PASS** | `M1-1/2/3` a member caller WITH its own mail naming `"Senior Enginerr"` → `refused:"…(members: Senior Engineer, Reviewer)"`, `messages=undefined`; `M2` member id resolves; `M3` member name resolves; `M4` no `member` → own inbox (`memberName:"Senior Engineer"`); `M5` a non-member caller with no `member` keeps the empty answer, no throw |
| 8 | **Gates** | **PASS** | the five commands quoted above, each exit 0 |

## Findings

**No Blocker, High or Medium finding.** Two observations, neither a defect:

### O1 — Observation (scope bookkeeping) — T20's declared scope did not list `index.ts`
T20's write scope names `flow.ts`, `staging.ts` and the lane's tests; the repair also touched
`packages/mpd-cellwork-plugin/src/index.ts` (the `planning-team-partial` / `planning-team-staged` journal
rows that must carry `splitTaskId` + `ownerRepairError`). The lane DECLARED it in its report, the captain
accepted the row, and I found no behavioural problem (the change is the two journal fields). Recorded so
the captain's register is exact, not as a finding against the lane.

### O2 — Bound, not a finding — `split.ts` moved during the review (T28)
`split.ts` changed from `41530667…` (06:35:36Z) to `4eb91c2e…` (06:41:20Z) while I was probing — the CJK
identity-key follow-up, which is not in my contract. I re-pinned and RE-RAN both probes and all gates on
the settled bytes; the CR#5 property still holds exactly as specified (two spellings collapsing to one
seat are refused, punctuation-only is refused, identical spellings share one member). The question of CJK
names is explicitly NOT judged here. `activate.ts` never moved (`34de09c3…`), so CR#5's "activation
untouched" holds across the drift too.

## Declined to judge (each with its reason on the same line)

- **The CJK/unicode identity-key question (T28)** — not in this contract; explicitly excluded by the T25 wording, and it moved `split.ts` under me. I judge only the stable CR#5 property.
- **T21 / T22 / T24 / T26 / T27** — other repairs, their reviews and the final sweep; not this seat.
- **The lanes' own reported red-first numbers** — claims; I ran their tests but derived every verdict from my probes.
- **The root-run branch of CR#7 at runtime** — this runner is uid 1000, so `test.skip`-as-root cannot execute here; I verified the guard's source, the stated skip reason, and that both arms run and pass non-root.
- **`bun run typecheck`** — not a T25 gate; the captain reported exactly two sibling (lane D) errors, and I did not use typecheck for any verdict.
- **dist** — the captain rebuilds; not touched by me.
- **T19's `member-role-conflict` detail wording and the other `validateGraph` codes** — only the four CR#5 properties are in this contract.
- **`findSplitTicket`'s terminal-status vocabulary, the mail bound/`isOutstanding` predicate, and the team-plane identity resolver** — unchanged by these repairs and already reviewed in T6/T14.
- **Any behaviour of the `staging`/`index` recording path beyond the two fields CR#6 names** — source-audited only where the probe cannot reach a tool harness cheaply, and labelled as such.

## Verdict

**APPROVE.** All seven CodeRabbit items are fixed as written: CR#2 and CR#4 hold on both code paths with
the row/transport facts observable, CR#7's failure is now reported honestly at the seam while its root
fragility is handled by a stated skip, CR#5 refuses the two-spellings-one-seat graph at submit time
without touching activation, CR#3 appends one replacement row and reuses it on the next bump (writing the
id back, live-before-closed), CR#6 keeps the ticket id through a refused owner repair and journals the
error so the ID-first lookup still finds the row, and CR#9 refuses an unresolvable explicit `member`
instead of answering with the caller's own inbox. Gates are green (172/407 pass, comments PASS). The two
observations are bookkeeping/bounds, not defects.

**Bounds of this review:** anchored to the hashes above (stable 06:41:20Z → 06:42:22Z after the T28 drift);
no mounted dsh boot, no Docker, no dist rebuild, no git write; I read and judged only the four repairs'
files plus the frozen board wording; probes live in `ac2/` and never inside the checkout's runnable tree
(R9); T28's CJK behaviour is out of scope and unjudged.
