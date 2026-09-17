# Wave-2b lane A (t13) — CLOSED ROWS, ARMS, AND THE NAMED REMAINDER

**Seat:** `agent-teams-engineer` (lane A) · **attempt** `ed738bdf-87a3-460f-9354-3403d6215699` · **t13**, kind=implementation.
**Contract:** `evidence/requirements/wave2b-laneA/20260917T1405Z-wave2b-laneA-acceptance.md` (14 rows; T-11 is the A/2 carrier, created only after A-1 is terminal — NOT this task).
**Plan of record:** `.mpd/plans/friction-p2-wave-2b.md`, body sha `0dd3d2fd4744802d37031477…`, §4/§5/§6/§7/§8/§9 + A2.3/A3.

## 1. VERDICT, STATED FIRST

**Three of the thirteen rows are CLOSED with their red side on disk: T-87, T-84, T-64.** Ten are **NOT closed** and are reported
PARTIAL below with the uncovered half named — not smoothed. The task therefore FAILS its criterion 1 (the frozen acceptance's
14 rows are not all satisfied); what lands is a verified subset plus a resumable plan for the rest.

**No claim in this file is inherited.** Every reading was taken at its own revision with the commands below, and both the RED
and the GREEN side of each control are on disk (`arm-before.out.txt` / `arm-after.out.txt`).

## 2. THE THREE CLOSED ROWS — deliverable → observable → decisive → negative control

### T-87 — the completion refusals NAME the unmatched item(s) and the count (register §8.6)
- **DELIVERABLE:** both refusals carry the gap report. Regions: `mpd-delta coverage-gap-text` (the reporter),
  `mpd-delta completion-coverage-refusals` (both refusal bodies) in `lib/quality-gates.js`.
- **OBSERVABLE / DECISIVE:** a NINE-item acceptance (the contract's own length) completes; an EIGHT-item payload — the
  display-join shape the row's repro describes — is refused with `— no entry for item-9 (matched 8 of 9)`.
- **NEG CONTROL (red side, `arm-before.out.txt`):** before the fix the SAME payload was refused **without naming anything**
  (`…for every acceptance item`, 2 FAIL lines). The control is the reading, not the prose.
- **Bounded:** a payload with a genuinely wrong item is still refused (the validator is not weakened into acceptance) — the
  driver's EIGHT-item case is exactly that shape.

### T-84 — a red the contract requires to be REPORTED gets a ledger surface (register §8.6)
- **DELIVERABLE:** the third command status `reported`, LABELLED by a required `reason`. Regions:
  `mpd-delta reported-red-coverage` (`verifyCovered`), `mpd-delta reported-red-status` (`COMMAND_RESULT_STATUSES` +
  `isCommandResult`) in `lib/quality-gates.js`; `mpd-delta reported-red-parse` (tool path) and
  `mpd-delta reported-red-schema` (parameter enum + `reason`) in `lib/tools.js`.
- **OBSERVABLE / DECISIVE:** a `verification` task whose verify names one command COMPLETES with
  `{command, status:'reported', reason:'…'}` and no `failed` command; the recorded entry validates as a command result.
- **NEG CONTROL (the one that matters):** the same payload with `status:'failed'` still returns
  `verify failure must fail the task` + `requiredStatus:'failed'` — a reported-red surface is NOT a bypass. A `reported`
  entry WITHOUT a `reason` is refused (`isCommandResult` false) — the ledger cannot be anonymous.
- **Bounded:** the gate cannot verify that a red WAS required; the label is the seat's declaration, which is what the row asks
  for (a surface, not a proof).

### T-64 — an unresolvable dependency is reported AS ITSELF (register §8.6)
- **DELIVERABLE:** `unresolvedDependencies()` + `unresolvedDependencyNote()` in `lib/state.js` (inside the EXISTING
  `mpd-delta dependency-failed-unblock` region — no new id), and the note is printed by `renderStatus` in `lib/tools.js`
  (import region `mpd-delta unresolved-dependency-import`, ADDITIVE).
- **OBSERVABLE / DECISIVE:** a dependency list naming `t99-phantom` yields that id from the reader and the note
  `[unresolved dep: t99-phantom]` — the id, never a generic park.
- **NEG CONTROL:** a LIVE satisfied dependency is not reported as **blocking** (the legitimate state is not erased); the
  two-bucket return shape of `dependencyStates` is deliberately UNCHANGED, because four pins assert it exactly and **three of
  them live in `test/**`, outside this lane's write set** — that is why the new bucket is a READER, not a third key.
- **Bound:** the panel snapshot (`lib/snapshot.js`) is a HOP (§1 hop 1) and was NOT touched; the model-facing status text is.

## 3. THE NAMED REMAINDER — ten rows, each with the half that is NOT done

| row | what exists now | the uncovered half (why it is PARTIAL) |
|---|---|---|
| **T-06** | nothing | the monotone revision token needs `lib/state.js` write-path work AND (if the panel must carry it) the `lib/snapshot.js` HOP — no token written, no driver |
| **T-08** | nothing | one id-allocation scheme across the plan-seed path and `create_task` needs both seeding paths read together; not attempted (M) |
| **T-11** | **BY DESIGN OUT OF THIS TASK** | the A/2 carrier: the plan creates it only after A-1 is TERMINAL (plan §6) |
| **T-13** | nothing | the `deferred` kind must agree with the kind enum, the gate predicates and the dispatch filter; the dispatch filter was not surveyed — not attempted (M) |
| **T-14** | nothing | the evidence-filling helper consumed by BOTH render sites; neither site changed |
| **T-15** | nothing | `coverageOf` typed shape + the clause-id builder; the schema was not touched |
| **T-27** | nothing | the batch contract read; no sibling tool, no driver |
| **T-42** | nothing | one plan format across the session-start path and the DAG seed; both paths not compared |
| **T-44** | nothing | the text-surface approval path + its non-captain refusal; `lib/command.js` not touched |
| **T-92** | nothing | the absence-pin half (comments stripped before matching) plus the audit driver; the `test/**` half of the 42 assertions is HOP 2. NOTE: lane A's §8 audit is the instrument to reuse |
| **T-93** | nothing | the register MINT (T-93's row text) and the routing fix in the generator; lane A's §4f is the measured mechanism |

The three integration-only surfaces named by the acceptance (§7.4) were **not** touched: `packages/*/dist/**`,
`dist/mpd-package/**`, `VENDOR_LOCK.json`. No git command was run.

## 4. THE REGISTRY (row id + region ids + registry sha — never inherited)

`node scripts/patch-agent-teams-fixes.mjs --write-registry` → **`registry regenerated … (88 regions)`**;
`--check` → **`already applied: 88 mpd delta region(s) across 9 adopted file(s)`** (exit 0).
Registry sha256 (16): **`6ceff2ef931ba43c`**. The seven new regions are the six named above plus… precisely:
`coverage-gap-text`, `completion-coverage-refusals`, `reported-red-coverage`, `reported-red-status` (quality-gates.js);
`unresolved-dependency-import`, `reported-red-parse`, `reported-red-schema` (tools.js). Count moved **81 → 88**.
The counting sentence in `agent-references/agent-teams-deltas.md` moved in the same change (`bun run verify:docs` PASS,
`carried 88/9 vs derived 88/9`), and the seven regions are documented there in prose rather than as new D-rows: the D-range is
a DERIVED value carried by `AGENTS.md` and `agent-references/index.md`, BOTH outside this lane's write set, and minting D43+
would have reddened that gate on paths the lane may not edit. The doc already records the same "count ahead of the row list"
state for t19/t20/t36. **That two-file pointer update is a HOP REQUEST for the captain** (exact text: change `A1–D42` →
`A1–D42 + the seven t13 regions` in `AGENTS.md` ×2 and `agent-references/index.md` ×1, or mint D43–D45 and update all three).

## 5. THE RUNS (full output on disk, never a `tail`)

| # | command | reading |
|---|---|---|
| 1 | `node evidence/agent-teams/wave2b-laneA/20260917T141608Z/arm.mjs` (BEFORE the fix) | **RED-SIDE FAILURES: 7**, exit 1 — the negative controls |
| 2 | same driver, AFTER the fix | **RED-SIDE FAILURES: 0**, exit 0 — every row green AND every red case still red |
| 3 | `bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/` | **109 pass / 0 fail / 1534 expects / 15 files**, exit 0 |
| 4 | `bun test ./packages/mpd-agent-teams-plugin/` | **266 pass / 0 fail / 2275 expects / 39 files**, exit 0 |
| 5 | `node scripts/patch-agent-teams-fixes.mjs --check` | 88 regions / 9 files, exit 0 |
| 6 | `bun run verify:docs` | **PASS** — `pairs=38 failed=0 violations=0 exempt=19 derived=3`; the deltas carrier reads `carried 88/9 vs derived 88/9` |

FORBIDDEN aggregates (integration-only, plan §7.4 as strengthened by A2.1) were **not** run and are named here so no reader
infers them: `bun run verify:gates`, `bun run test:qa`, `bun run test:qa:all`, `node scripts/verify-dist-fresh.mjs`,
`bun run typecheck`, `node scripts/verify-vendor.mjs`, `node scripts/verify-pack-close.mjs`(sic: `verify-pack-closure.mjs`).

**An intermediate RED that is recorded rather than smoothed:** the first attempt added an `unresolved: []` key to
`dependencyStates`'s return, which reddened four exact-shape pins (**1** in `self-fix-tests`, **3** in `test/**`).
`test/**` is outside this lane's write set, so the design was changed to the additive READER above
(`--write-registry` re-run; all four pins green again). The failed attempt is visible in this dir's git-side history via the
later green logs — no log of the red state was kept, which is stated as a bound rather than presented as evidence.

## 6. WRITE SET AND HOPS

Touched (all inside the acceptance's file-exact set): `lib/quality-gates.js`, `lib/tools.js`, `lib/state.js`,
`lib/mpd-deltas.js` (REGENERATED, never hand-edited), `agent-references/agent-teams-deltas.md`,
`evidence/agent-teams/wave2b-laneA/20260917T141608Z/**`.
NOT touched, and named as such: `lib/snapshot.js` (T-06's panel half — HOP 1, not granted), `test/**` (T-92's pins there and
three shape pins affected by the first attempt — HOP 2, not granted), `packages/*/dist/**`, `dist/mpd-package/**`,
`VENDOR_LOCK.json`, `.mpd/plans/**`.
