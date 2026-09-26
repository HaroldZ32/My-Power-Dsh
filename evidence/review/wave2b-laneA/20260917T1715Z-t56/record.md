# t56 — REVIEW r2 of `t55` (the F1 repair) — VERDICT: **PASS**

**Seat:** watchdog-engineer. **Attempt 2**, attempt_id `043436b5-5152-467d-8bc3-275f9de3c604`.
**Review moment:** 2026-09-17T16:57:05Z → 17:0x (all readings mine, at the pins below; nothing inherited).
**Reviewed task:** `t55` (the repair of `t44`'s F1). **InScope:** `evidence/review/wave2b-laneA/**`. No `lib/**` edit, no manual edit, nothing packed touched.

**Pins at the review moment:** registry `lib/mpd-deltas.js` sha `461a425ae9eaa610832e…` · `lib/session-start.js` sha `ec795cce7e7cf4cde146…` · `agent-references/agent-teams-deltas.md` sha `dd8f1b12bc31dce2ed16…` · applier `scripts/patch-agent-teams-fixes.mjs` sha `8d6a3102eed6973dfda5…` · `MPD_DELTAS` = **119 entries / 119 ids / 10 files**.

---

## §1 F1 IS CLOSED — verified first-party, both halves

**Precondition for this review** (the manual rule I applied in round 1): the sources changed AFTER my round-1 verdict, so the subject is a MOVED REVISION and every reading was re-taken.

| reading | round 1 (the defect) | now (the repair) |
|---|---|---|
| marker map of `session-start.js` | `session-start-gate` 86–**648**, `plan-format-seed` **224**–313 (a CHILD) | `session-start-gate` 86–**558**, `plan-format-seed` **559**–648, `interjection-expiry-session-start` 649–696 — three SIBLINGS, in order |
| registry entries | 118 (no entry for the child) | **119** — the child is registered |
| live marker ids | 119 (1 unregistered) | **119** (0 unregistered) |
| nesting scan (my stack instrument) | 1 nested child, unregistered | **0 nested, 0 mismatched, 0 unclosed** |
| `--check` | exit 0 `already applied: 118` | exit 0 `already applied: **119** mpd delta region(s) across 10 adopted file(s)` |
| strip/heal suite | 21/0 (blind to it) | **21 pass / 0 fail / 1222 expect()** |
| docs gate derived arm | `carried 118/10 … markers agree: 118` — a FALSE agreement | `carried **119**/10 vs derived 119/10 … (live markers agree: **119**)` — now a TRUE one |
| count sentence in `agent-teams-deltas.md` | claimed t52 added the region (113) — doc vs registry disagreeing by one | **line 56 = 119** in the SAME change, carrying the t55 account (the cause, the re-anchor at `:559`, the registry sha) |

**THE DURABLE HALF, driven by ME on a scratch repo copy of the SHIPPED code** (`raw/guard-red-side.mjs`):
1. a faithful scratch root (`scripts/` + the `lib` tree + the deltas doc) → `--check` **exit 0, 119 regions / 10 files**;
2. the defect's EXACT shape re-created there (the parent's `#endregion` moved after the child's `#endregion`, marker count unchanged) → **`--write-registry` exit 1**, refusing by name and span:
   `FAIL: region "mpd-delta plan-format-seed" (line 558) is NESTED inside region "mpd-delta session-start-gate" (line 86) — a marker must be a SIBLING, never a child: move … (or teach the registry, every count and this scan to represent the nesting)`;
   and `--check` exit 1 on the parent's span drift — the two refusals t55 claimed, both reproduced.
   The guard is `regionSpans` (`patch-agent-teams-fixes.mjs:477`), now a **stack**, at the one place `--write-registry`, the applier and the heal path all pass through — so the silence became a refusal.

## §2 THE ROWS AND P1B — reproduced, not accepted from summaries

All eight remainder arm files, `./`-formed, at this revision: `t43-mailbox-clear-guard` **3/0** · `t47-mailbox-window` **3/0** · `t48-mailbox-gate` **3/0** · `t49-retention-prune` **4/0** · `t50-team-revision` **6/0** · `t51-reoffer-routing` **4/0** · `t52-one-plan-format` **3/0** · `t53-member-capacity` **4/0** (`raw/row-arms-dot.log`) — and T-42's arms specifically are green AFTER the re-anchor (3/0), i.e. the region moved and the code did not.

**P1b, my own run** (`raw/p1b-arms.log`): 4 pass / 0 fail, the arms being the three eligibility conditions each armed on its own · archive-first (sidecar bytes + the tombstone keeps id/ts/from/to and its read/delivery markers) · the knob (0 disables; the ACK path runs it) · and the MEASURED seeded reading printed by the arm itself: `[P1b] seeded 45 records at 1970-01-31T00:16:40.000Z → pruned 40, tombstones 40, live 5`. A seeded mailbox measurably shrank; the t43 clear guard still holds.

**Suite & the expect() movement, now ATTRIBUTED:** `bun test ./packages/mpd-agent-teams-plugin` → **299 pass / 0 fail / 2763 expect() / 48 files** (exit 0), matching t55's claim. In round 1 I recorded the movement (2755) as UNATTRIBUTED; it is now **2755 → 2763 with t55's repair**, which added the guard's arms — so this movement has a named cause, and the earlier chain's movements remain as recorded (measured, unattributed).

**t50's census arm**: the file's own header states the token is bumped in the ONE `writeTeam` funnel and it imports BOTH writers (`createTeamDir`, `writeTeam`) from `lib/state.js`, exercising each — the two-writer census is pinned by the arm, as claimed. (Bound: I read the arm, I did not re-derive the 29 call sites.)

## §3 THE CROSS-LANE CLAUSE, MY INTEREST DECLARED

**Declared interest (restated):** my 2a control arm splices `mpd-delta ready-task-predicate`; lane A's `t27` broke its anchor and I repaired it in MY file under `t33`. **Reading:** the anchor target exists **exactly once** in `scheduler.js`; `bun test ./packages/mpd-team-watchdog-plugin` → **139 pass / 0 fail / 684 expect() / 13 files** (the structural second read the captain's integration sweep repeats); `isTaskReady`'s shape unchanged; `deliveryRoutingClass` **consulted** at `scheduler.js:738`, keyed on BOTH halves. My round-1 **withdrawn probe** is carried forward in `raw/anchor-and-wiring.mjs` with the corrected rule inside it (a literal `\n` from shell single quotes is not a newline).

## §4 t30's F1 — REPRODUCED BY ME, three cases plus the revert state (round 1's bound, now closed)

`raw/t30-f1-three-cases.mjs`, importing the shipped `lib/state.js`; T depends on `B`, `B↔C` form the cycle, the cases differ only in the members' status:

| case | note (shipped) | blocking | claimable |
|---|---|---|---|
| members **PENDING** | `[unresolved dep: cycle B→C→B]` | `["B"]` | no |
| members **FAILED** | **`""`** (not emitted) | `[]` | **yes** |
| members **COMPLETED** | **`""`** (not emitted) | `[]` | yes |

**REVERT state** (a scratch copy of `lib/` with the condition `&& dependencyStates(tasks, dependencies).blocking.length > 0` removed, asserted unique before the splice): all three cases emit `[unresolved dep: cycle B→C→B]` — including the two whose `blocking` is empty — which is exactly the over-claim the defect described. The condition is load-bearing; `renderStatus` appending that note to EVERY task line is why it mattered.

## §5 THE HONEST-PARTIAL TRAIL, judged on readings

`t13` (3 of 14, the other eleven NAMED) · `t40` (deliberate partial, per-row handover) · `t43` (6 of 7, its P1b gap NAMED and later DELIVERED by `t49`) · `t47` (4 of 6, remainder landed as `t48`) · `t52` (an honest partial with its wiring-only seam named) · then `t27`, `t29`, `t48`, `t49`, `t50`, `t51`, `t53`, `t55` closed with full payloads. No row is failed for its shape; each partial's uncovered half is named and appears later as its own terminal task.

## §6 RESIDUAL NOTES AND BOUNDS (nothing hidden, nothing failed)

1. **A residual observation, NOT a finding:** the docs gate's own helper `liveRegionCount` (`verify-docs-parity.mjs:184-196`) is still nesting-unaware — the durable fix landed in the APPLIER, not in the gate. It is **non-exploitable now** because the applier refuses nesting at the chokepoint every path passes through (verified above), so a nested tree cannot exist without a loud refusal; making the gate's count nesting-aware would be defence in depth, and it is recorded here for the next wave rather than failed against this one.
2. **Bounds:** I did not re-derive t50's 29 call sites (I read its arm); the DO-WHEN's staged legs beyond the shipped arms (e.g. t52's declared wiring-only seam) remain undriven by me; the suite's earlier expect() movements (before 2755) stay as recorded measurements without a named cause by me.
3. Nothing packed touched; every write is inside `evidence/review/wave2b-laneA/**`.

## §7 VERIFY (my runs, this revision)

| command | exit | reading |
|---|---|---|
| `node ./scripts/patch-agent-teams-fixes.mjs --check` | 0 | `already applied: 119 mpd delta region(s) across 10 adopted file(s)` |
| `bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs` | 0 | 21 pass / 0 fail / 1222 expect() |
| `bun run ./scripts/verify-docs-parity.mjs` | 0 | `carried 119/10 vs derived 119/10 … markers agree: 119`; `pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS` |
| `bun test ./packages/mpd-agent-teams-plugin` | 0 | 299 pass / 0 fail / 2763 expect() / 48 files |
| `bun test ./packages/mpd-team-watchdog-plugin` | 0 | 139 pass / 0 fail / 684 expect() / 13 files (the clause; interest declared) |
| `node raw/guard-red-side.mjs` | 0 | faithful scratch copy green at 119; re-nested → `--write-registry` REFUSES by name+span, `--check` fails on drift |
| `node raw/t30-f1-three-cases.mjs` | 0 | three cases hold; revert state reddens on both non-blocking cases |
| `node raw/nesting-scan.mjs` | 0 | 0 nested, 0 mismatched, 0 unclosed |
