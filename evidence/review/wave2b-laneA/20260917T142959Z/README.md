# t19 — INDEPENDENT REVIEW of wave-2b lane A (t13): 13 rows + T-11 against the frozen acceptance

**Seat:** `code-reviewer` (reviewer, read-only on the lane's files) · **task** `t19` (kind=review) · **attempt** `673c86e0-527f-48e6-ab53-35070033a4a8`
**Object of review:** `evidence/requirements/wave2b-laneA/20260917T1405Z-wave2b-laneA-acceptance.md` (274 lines, read in full) vs the implementation
`evidence/agent-teams/wave2b-laneA/20260917T141608Z/` and the working tree.
**VERDICT: needs_revision** — the lane's own `failed` status is CORRECT and I confirm it independently; three of thirteen rows are genuinely delivered, ten are not.

## 1. PIN — settled, then re-checked (50 s)

| file | sha256 (16) | note |
|---|---|---|
| `lib/quality-gates.js` | `a05c2a24bec3f2f9` | T-87 + T-84 regions |
| `lib/tools.js` | `2e01e8747cb18916` | T-84 parse/schema + T-64 import/render |
| `lib/state.js` | `e9c90db3187aeae3` | T-64 reader (inside `dependency-failed-unblock`) |
| `lib/mpd-deltas.js` | `6ceff2ef931ba43c` | REGENERATED — equals the sha the lane cites |
| `agent-references/agent-teams-deltas.md` | `a2120d45fca43ef1` | count sentence moved here |

All five identical at T0 and T+50 s (`PIN.txt`) — every reading below is taken at THIS revision.

## 2. WHAT I REPRODUCED (criterion 1 of my contract)

| # | command (exact) | my reading | the lane's reading | match |
|---|---|---|---|---|
| 1 | `node ./evidence/agent-teams/wave2b-laneA/20260917T141608Z/arm.mjs` | **RED-SIDE FAILURES: 0**, exit 0 | 0, exit 0 | ✅ |
| 2 | `bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/` | **109 pass / 0 fail / 15 files**, exit 0 | 109 / 15 | ✅ |
| 3 | `bun test ./packages/mpd-agent-teams-plugin/` | **266 pass / 0 fail / 39 files**, exit 0 | 266 / 39 | ✅ |
| 4 | `node scripts/patch-agent-teams-fixes.mjs --check` | **88 regions / 9 files**, exit 0 | 88 / 9 | ✅ |
| 5 | `bun run verify:docs` | **PASS** `pairs=38 failed=0 violations=0 exempt=19 derived=3`; derived line reads `carried **88**/9 vs derived 88/9 … live markers agree: 88` | PASS, 88/9 | ✅ |

Full outputs kept un-tail'd: `my-arm-after.out.txt`, `my-suites.log`, `my-registry-check.log`, `my-verify-docs.log`.

## 3. NEGATIVE CONTROLS — RUN BY ME IN THEIR REVERT STATE (criterion 2)

**3.1 The lane's driver against the PRE-FIX tree.** Scratch mirror OUTSIDE the workspace (T-89), `lib/{quality-gates,state,tools}.js` restored from `git HEAD`
(`1b0eb60e…`, `6092febdb2…`, `6021bf6dfc…`), `arm.mjs` copied UNCHANGED so its relative import resolves to the reverted lib:
**RED-SIDE FAILURES: 6, exit 1** (`my-arm-before-revert.out.txt`).

**3.2 FINDING R4 — the committed red side is STALE and does not reproduce as a pair.** The lane's `arm-before.out.txt` records **7** failures including
`FAIL [T-64/green] dependencyStates names the unresolvable id separately`, but the committed `arm.mjs` asserts
`a phantom dependency still BLOCKS (nothing satisfied it - the two-bucket shape is unchanged)`. The recorded before-file is the red side of the
SUPERSEDED first design (the `unresolved: []` third key the README §5 says reddened four pins), not of the shipped design. Running the committed driver
against the pre-fix tree gives **6**, not 7. The README discloses the abandoned attempt but keeps its log as the row's red side, so the pair
(driver, before-file) is not reproducible together — and the substituted assertion (two-bucket unchanged) is exactly the one whose "before" state is
PASS, so the shipped design's red side is never demonstrated by that file.

**3.3 Registry family, end-to-end, in a scratch mirror** (`my-registry-end-to-end*.log`, `my-registry-placement.log`):
- drift inside an existing region → `--check` **RED** (`no longer matches this script's registered block … first difference at line 721`), exit 1;
- `--write-registry` → **88 regions**, exit 0; `--check` after → **GREEN**, exit 0;
- a **top-level** new marked region → `--write-registry` reports **89**, `--check` green at 89  → the edit → regenerate → check cycle WORKS;
- a region nested INSIDE an existing region is silently absorbed into that region's block (count stays 89, `--check` green) — an INSTRUMENT property
  (`writeRegistry` registers spans; a nested pair is inside the outer span), reported as an observation, not as a lane defect;
- stripping one region's end marker → `--check` **RED**, exit 1 (`partially stripped … a re-vendor dropped it`).

**3.4 Adversarial arms** (`my-adversarial.mjs` / `my-adversarial.out.txt`) — 4 of 10 probes went the other way; see findings R3/R5/R6.

## 4. THE DANGEROUS DIRECTION (criterion 3)

I attacked the three rows the lane reports CLOSED, testing what an author has a motive not to test:

- **T-84 (is `reported` a bypass?)** — a FAILED command still fails the task (`requiredStatus:'failed'`) ✅; an OMITTED `commandsRun` is still refused ✅;
  the legitimate `passed`+`reported` pair covers two commands ✅. **But R5:** a `reported` entry whose `command` does NOT name the required command
  SATISFIES coverage when the counts match (measured: `verify:["bun run x"]` + one `{command:'SOME OTHER COMMAND', status:'reported'}` → `{ok:true}`),
  because `verifyCovered`'s second branch is LENGTH-only. **Attribution, measured against HEAD:** the length fallback is PRE-EXISTING
  (`results.length === required.length && every(status==='passed')`); this lane extended it to `reported` rather than introducing it. The gate's own
  refusal text says `no entry for bun run x`, so message and predicate disagree about whether names are matched.
- **T-87 (names the item and the count)** — the 8-of-9 payload is refused with `no entry for item-9 (matched 8 of 9)` ✅ (reproduced verbatim);
  an UNPAID item (`status:'failed'`) is refused and named ✅. **R6:** a 9-item payload whose ninth item is a DIFFERENT NAME (all `passed`) is
  ACCEPTED — same pre-existing length fallback in `acceptanceCovered`; the acceptance's "a payload with a genuinely wrong item is still refused"
  therefore holds under the STATUS reading (verified) and not under the NAME reading.
- **T-64 (unresolvable dependency named as itself)** — the phantom id IS named `[unresolved dep: t-phantom]` ✅ and the two-bucket shape is unchanged ✅.
  **R3:** the acceptance's OBSERVABLE says "a dependency naming a nonexistent id **(or a cycle)**"; measured, a 2-cycle (`t1↔t2`, both pending) yields
  `unresolvedDependencies(...) = []`, the status note is `''`, and `dependencyStates` reports the cycle as an ordinary `blocking:["t2"]` — i.e. exactly
  the "reads as an ordinary parked/blocked state" the row exists to end, for the cycle half.

## 5. COMPLETENESS — INDEPENDENTLY VERIFIED, NOT INHERITED (criterion for finding R1)

Every added line of the lane's whole diff (5 files, **+203 / −11**) that carries a row id attributes to **T-64 (7), T-84 (8), T-87 (4)** — no hunk
implements any other row. `git diff HEAD --stat` + per-hunk reading confirm the ten rows (T-06, T-08, T-13, T-14, T-15, T-27, T-42, T-44, T-92, T-93)
have **no code and no driver**. The lane's own README §3 names each missing half; I verified the ABSENCE rather than reading the claim.

**Registry id-set diff (the check a count alone would hide):** HEAD registry = **81** ids, now = **88**; ADDED = exactly the seven named
(`coverage-gap-text`, `completion-coverage-refusals`, `reported-red-coverage`, `reported-red-status`, `reported-red-parse`, `reported-red-schema`,
`unresolved-dependency-import`); **REMOVED = none** (`ids-HEAD.txt` / `ids-NOW.txt`).

## 6. T-11 — NOT A FINDING, and saying so is the point

T-11 is the A/2 carrier and the plan (§6) creates it only after A-1 is **terminal**; t13 is `failed`, so its absence is COMPLIANT, not a miss.
What remains open for T-11 is the A/2 dispatch itself, which is the captain's step, not this lane's.

## 7. FINDINGS (structured; they FAIL this review)

- **R1 [blocker]** 10 of 13 rows have no deliverable → the frozen DONE-WHEN is unmet. *requiredFix:* implement the named halves per README §3 (the
  registry/round-2 mechanics are green and reusable), or have the captain amend the wave-2b DONE-WHEN with an explicit scope ruling.
- **R2 [high]** T-13 / T-27 / T-44 (the A3 rows that may NOT be closed by rule) have no deliverable at all. *requiredFix:* implement them as
  deliverable+verify+review; a ruled-form close is withdrawn by A3.
- **R3 [medium]** T-64 is reported CLOSED while the acceptance's OBSERVABLE names cycles; cycles are not detected (measured). *requiredFix:* extend the
  reader to cyclic ids + add the seeded cycle arm, or amend the observable (captain) and keep the row PARTIAL.
- **R4 [medium]** the committed red side (`arm-before.out.txt`, 7 failures) does not correspond to the committed driver; the reproducible pre-fix run of
  the shipped design is **6** failures / exit 1. *requiredFix:* store the revert-state run of the committed `arm.mjs` as the row's red side, nesting the
  superseded log beside it with the replaced assertion named.
- **R5 [low]** the LENGTH-only fallback in `verifyCovered` (pre-existing; extended to `reported`) lets a non-matching `command` satisfy coverage.
  *requiredFix:* name-match in the fallback, or state the length semantics in the region so the `no entry for <command>` message stops implying it.
- **R6 [low]** the same fallback in `acceptanceCovered` accepts a wrong-NAME item of the right count; `coverageGapText` can only fire on count/status
  mismatch. *requiredFix:* the captain states which reading the acceptance's "genuinely wrong item" control means; if the NAME reading, enforce it.

## 8. WHAT I DID **NOT** VERIFY (explicit bounds)

- No MOUNTED boot: nothing here proves the tool surface end-to-end through a real `dsh` session — the `reported-red-parse` / `reported-red-schema`
  regions were read, not driven through a tool call (the lane's own acceptance requires the driver's DECISIVE reading, which is module-level here).
- I did not run `--write-registry` in the REAL tree (it writes `lib/mpd-deltas.js`, outside my `inScope`); the end-to-end cycle was proven in a scratch
  mirror and the real tree's `--check`/sha were verified read-only.
- The forbidden aggregates (`verify:gates`, `test:qa`, `typecheck`, `verify-dist-fresh`, `verify-vendor`, `verify-pack-closure`) were NOT run; the lane
  did not run them either (correctly).
- I did not re-derive the `test/**` split (T-92's 25/17) — that row is undelivered.
- `lib/snapshot.js` (T-06's panel half) and `test/**` (hop 2) were not touched by me or the lane.
- Scratch mirrors (`/tmp/laneA-scratch*`, `/tmp/laneA-revert`) were deleted after use; the `agent-references/agent-teams-deltas.md` bytes I read are at
  the pinned revision above.
