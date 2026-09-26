# t44 — REVIEW r1: lane A's REMAINDER (slices ②③④ + the T-11 carrier) — VERDICT: **needs_revision**

**Seat:** watchdog-engineer. **Attempt 2**, attempt_id `407eba1b-237e-4359-a584-71f74eb601a9`.
**Review moment:** 2026-09-17T16:20:21Z (all readings below taken then; every count RE-TAKEN, none inherited).
**InScope:** `evidence/review/wave2b-laneA/**` (this record + `raw/`). Nothing packed touched; no `lib/**` edit; no manual edit.
**Subjects:** `t43` (slice ②: T-92 + P1 + P1c + F1, with P1b failed there), `t47` (P1e + the mailbox completion, 2 item statuses failed), `t48` (P1d), `t49` (P1b), `t50` (T-06), `t51` (T-93 + the read-only-seat routing root cause), `t52` (T-42), `t53` (T-11) — all terminal; `t45`/`t46` cancelled. Lane A's live acceptance is `evidence/requirements/wave2b-laneA/20260917T1405Z-wave2b-laneA-acceptance.md` (23,942 B, DO-WHEN).

---

## THE FINDING (F1) — a nested, unregistered region that NO gate can see

**`packages/mpd-agent-teams-plugin/lib/session-start.js:224`** carries a live region `mpd-delta plan-format-seed`
(`:224` → `:313 //#endregion mpd-delta plan-format-seed`) that is **nested inside** another region,
`mpd-delta session-start-gate` (`:86` → `:648 //#endregion mpd-delta session-start-gate`). It is t52's T-42 region
(the declared plan-item convention, its collision refusal and the workspace reader).

Measured at the review moment (`raw/nesting-scan.mjs`, `raw/registry-vs-markers.mjs`,
`raw/session-start-registry-vs-markers.mjs`):

| reading | value |
|---|---|
| regions in `session-start.js` (marker map) | **3** — `session-start-gate` 86, `plan-format-seed` 224, `interjection-expiry-session-start` 649 |
| registry entries for that file (`MPD_DELTAS`) | **2** — `session-start-gate`, `interjection-expiry-session-start` |
| registry overall | **118 entries / 118 ids / 10 files** (`lib/mpd-deltas.js` sha `0691215912cb4bc8eb193fa9…`) |
| live ids NOT in the registry | exactly **1**: `mpd-delta plan-format-seed` |
| registry ids without a live marker | **0** |
| whole-tree nesting scan | **exactly 1** nested child, unregistered; 0 mismatched/unclosed spans |

**Why every existing check stays green — each scans nested-unaware (all four readings reproduced by me):**

1. `node ./scripts/patch-agent-teams-fixes.mjs --check` → **exit 0**, `already applied: 118 mpd delta region(s) across 10 adopted file(s)` — it verifies the REGISTERED regions, and this one was never registered.
2. The docs gate's derived corroboration → `carried **118**/10 vs derived 118/10 … (live `//#region mpd-delta` markers agree: 118)`. I replicated its helper `liveRegionCount` verbatim (`scripts/verify-docs-parity.mjs:184-196`) on that file: it finds the FIRST `//#endregion mpd-delta session-start-gate` at **line 648**, so it treats 86–648 as ONE region, jumps to 649, and returns **2** — the nested marker is invisible, and the per-file pair (registered 2 / markers 2) reads as **agreement**. The gate's "markers agree" line is therefore a **false agreement** for exactly this fault.
3. The strip/heal suite → **21 pass / 0 fail** (`raw/heal-suite.log`) — it heals REGISTERED regions only.
4. The full plugin suite → **299 pass / 0 fail / 2755 expect() / 48 files** (`raw/plugin-suite.log`) — green, as it must be: the code IS present and working.

**The consequence:** on a hand re-materialize of `session-start.js`, the applier cannot restore a region it does not know; T-42's plan-format code would be silently absent, `--write-registry` would keep missing it (same nesting-unaware enumeration), and `--check`, `verify:docs` and the heal suite would ALL stay green. That is the exact class this wave built three checks against (t29: *a green `--check` is NOT registry health*), here defeating all three at once.

**The placement rule is the lane's own:** t43's acceptance states *"a marker is a SIBLING, never a child"*, and the applier's comments discuss sibling pairs (`scope-overlap` ⊂ …). The applier carries sibling ORDER logic (`patch-agent-teams-fixes.mjs:197-198`) but **no guard that refuses a NEW region inserted inside an existing region's span**, and no check reports the nesting.

**The lane's own account disagrees with the registry:** `agent-references/agent-teams-deltas.md:58` states the `t52` T-42 work *added* `mpd-delta plan-format-seed` and that `--write-registry` reported `113 regions` — the registry has no such entry, so the artifact a reader trusts over-claims by one region.

**REQUIRED FIX (five parts, the last one durable):**
1. Re-anchor the region as a **SIBLING** — move `plan-format-seed`'s begin/end outside `session-start-gate`'s span (`session-start.js:86-648`), e.g. after `:648`/`:649` or before `:86`.
2. Re-run `node scripts/patch-agent-teams-fixes.mjs --write-registry` and confirm the count MOVES by the previously missing entry (118 → 119 at that revision) with the registry sha beside it.
3. At that revision: `--check` green **and** the heal suite green **and** `bun run verify:docs` green with its derived arm reading true.
4. Update the deltas doc's account at `agent-references/agent-teams-deltas.md:56-58` to the regenerated counts (the t52 sentence currently over-claims).
5. **Durable half — make the fault detectable, or the next nesting slips through the same hole:** the applier's writer (or `--check`) must refuse/flag a `//#region mpd-delta` whose span lies INSIDE another region's span, and the docs gate's per-file corroboration should count with a nesting-aware scan (a stack) so a child surfaces as a mismatch instead of "agree".

---

## ITEM [3] — THE CROSS-LANE CLAUSE, WITH MY INTEREST DECLARED

**DECLARED INTEREST (required):** my own lane-C 2a control arm splices `mpd-delta ready-task-predicate`; lane A's `t27` added the sibling conjunct `!isNonDispatchableKind(task)`, which broke my three-line anchor, and I repaired the anchor in MY file under `t33`. I am therefore an **interested party** for any clause touching that predicate's text, and I judge the clause as a reviewer, not as a defending author.

**Reading (independent, at this revision):**
- `packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts`'s anchor target exists **exactly once** in `scheduler.js` (`raw/anchor-and-wiring.mjs`), so the arm still splices what it means to splice. *(An earlier probe of mine reported 0 and is WITHDRAWN inside that file: it used a literal backslash-n because `\\n` survives shell single quotes — the suite's result is the authoritative reading.)*
- **Cross-lane reading: `bun test ./packages/mpd-team-watchdog-plugin` → exit 0, 139 pass / 0 fail / 684 expect() / 13 files** (`raw/cross-lane.log`). This is the structural double-read: the captain's integration sweep re-runs `bun test ./packages`, so the clause is read by a second party regardless of my interest.
- `isTaskReady` is unchanged in shape (the dependency conjunct is intact; the t27 sibling still present), so **no existing refusal edge moved**.
- t51's replacement predicate `deliveryRoutingClass` (`scheduler.js:387`) is **consulted, not merely exported**: `scheduler.js:738` calls it inside the `mpd-delta terminal-dispatch-recheck` lock and the decline note names the class. It is keyed on **both halves** (terminality AND attempt equality), returns `reoffer-terminal-same-attempt` / `terminal-rotated` / `rotated` / `task-gone`, and by its own comment reproduces the pre-T-93 branch table — the reading agrees: the refusals it replaces were `terminal` and `rotated`, both still decided, with the class only NAMING which one fired. **This clause PASSES**, with my interest on the record.

## ITEM [4] — THE HONEST-PARTIAL TRAIL, JUDGED ON READINGS

Judged as the standard, not as a defect (terminal states read directly): `t43` `failed` with **6 of 7** item statuses passed (the P1b item failed there and was DELIVERED later by `t49` — 5/5 passed), `t47` `failed` with **4 of 6** passed (its named remainder P1d landed as `t48`, 6/6), `t13` (3 of 14, other 11 NAMED) and `t40` (deliberate partial with a per-row handover: four rows named, starting state pinned, next step per row) — while `t27`, `t29`, `t48`, `t49`, `t50`, `t51`, `t52`, `t53` closed their scopes with full payloads. The partial trail is honest by measurement: each partial names its uncovered half, and the halves appear later as their own terminal tasks. Nothing in this review fails a row for its shape.

---

## EXPLICIT BOUNDS — WHAT I DID **NOT** VERIFY (stated so nothing is implied)

With F1 standing, per-row reproduction of the remainder would have been measured on a tree the repair must move, so I stopped at the decisive failure and bound the rest:

- **NOT verified:** P1b's five arms (`t49`) · F1 (t30's note) three cases plus the revert-state arm · the per-row decisive arms for T-92 (`t43`), T-06 (`t50`), T-42 (`t52`), T-11 (`t53`), P1e (`t47`), P1d (`t48`), P1 (`t43`), P1c (`t43`). Their completion summaries are INPUT, not evidence, for this review.
- **Verified by my own readings:** the registry family end-to-end (count + sha + `--check` + heal + docs + the nesting scan); the cross-lane clause; the honest-partial trail's terminal states; and the exact mechanism of F1 with each check's blindness reproduced.
- Also recorded: the suite's `expect()` total is **2755** at this revision, matching the captain's chain's last value (2695 → 2755 at `t53`) with **no test file edited** in between by me — the movement the captain flagged as unattributed is **not** attributed by me either; it is recorded here as a movement with its measurement and no named cause.
- `t50`'s unit census correction (`members 3 / scheduler 6 / tools 20` = 29 call sites, `state.js` the definition, TWO `team.json` writers) is **NOT verified by me** in this pass (bound).

## VERIFY (my own runs, this revision)

| command | exit | reading |
|---|---|---|
| `node ./scripts/patch-agent-teams-fixes.mjs --check` | 0 | `already applied: 118 mpd delta region(s) across 10 adopted file(s)` — and blind to the nested region (F1) |
| `bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs` | 0 | 21 pass / 0 fail / 1214 expect() |
| `bun test ./packages/mpd-agent-teams-plugin` | 0 | 299 pass / 0 fail / 2755 expect() / 48 files |
| `bun run ./scripts/verify-docs-parity.mjs` | 0 | `pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS` — and its marker agreement is FALSE for the nested region (F1) |
| `bun test ./packages/mpd-team-watchdog-plugin` | 0 | 139 pass / 0 fail / 684 expect() / 13 files (the cross-lane reading) |
| `node raw/nesting-scan.mjs` | 0 | exactly one nested child, unregistered; 0 mismatched spans |
| `node raw/registry-vs-markers.mjs` | 0 | 118 registered / 119 live ids; the one extra is `mpd-delta plan-format-seed` @ `session-start.js:224` |

## RESIDUAL / ROUTING

F1 is a **high**-severity defect in the registry's coverage of the tree it claims: the region exists and works, but it is uninsured and invisible to all three checks. It is bounded, precisely located, and its fix is a re-anchor + a registry write + a doc line + a guard. **Verdict: needs_revision** — the remainder must be re-reviewed after the repair, and this review's bounds (above) name what that pass still owes.
