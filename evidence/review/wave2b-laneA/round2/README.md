# t30 — ROUND-2 REVIEW of wave-2b lane A (t13) after the t29 repair

**Seat:** `code-reviewer` · **task** `t30` (review, round 2) · **attempt** `919571c6-6774-4e8f-8e19-f9b908363c15`
**Object:** the t29 repair (`evidence/agent-teams/wave2b-laneA/20260917T145437Z/` + the extended `…141608Z/arm.mjs` and its labelled superseded log), judged against the SAME frozen acceptance (`evidence/requirements/wave2b-laneA/20260917T1405Z-…`) at the CURRENT revision.
**VERDICT: needs_revision — ONE low finding (F1) introduced by the R3 extension. Every one of round 1's seven findings is otherwise closed, and every reading I was asked to reproduce, I reproduced.**

## 1. PIN — settled (all five hashes identical at T0 and T+50 s)

| file | round 1 | round 2 (this review) |
|---|---|---|
| `lib/quality-gates.js` | `a05c2a24bec3f2f9` | **`01ea2f92319a732f`** |
| `lib/tools.js` | `2e01e8747cb18916` | `39d77fe6826d1937` |
| `lib/state.js` | `e9c90db3187aeae3` | `85e579acf1441870` |
| `lib/mpd-deltas.js` | `6ceff2ef931ba43c` | `464610bcad077c85` (matches the repair's citation) |
| `agent-references/agent-teams-deltas.md` | `a2120d45fca43ef1` | `4d6cedd8fff33c80` |

## 2. ROUND 1's SEVEN FINDINGS — DISPOSITION, EACH WITH MY OWN READING

| finding | repair | my independent reading |
|---|---|---|
| **R1** [blocker] 10 rows undelivered | captain's SCOPE ruling (copied as the artifact `captain-rulings.md`, T-90) | `captain-rulings.md` exists and says exactly that; **t29 closes findings, not rows** — and t27 has since landed T-13/T-27/T-44. Closed as a ruling, not as a claim. |
| **R2** [high] A3 rows | landed by `t27` | not re-audited here (t27 is its own task; my review of it is not this round's scope) — recorded as a bound |
| **R3** [medium] cycles unnamed | `phantomDependencies()` + `dependencyCycle()`; reader = phantoms ∪ cycle; note = `cycle c1→c2→c1` | **the named cases all work**: 2-cycle names both members, 3-cycle names three, self-dependency is a cycle, a diamond and a satisfied linear chain are NOT, a phantom id is still named. Closed — with residual F1/O1 below |
| **R4** [medium] stale red side | committed revert-state run stored; the stale log KEPT and labelled with the replaced assertion quoted; pre-extension driver preserved | **both pair members reproduced by me**: the preserved `arm.mjs.pre-cycle-extension` vs `git HEAD` bytes = **6 failures** (`arm-before-committed.out.txt`'s number) and the EXTENDED driver vs HEAD = **10** (`arm-cycle-before.out.txt`'s number). Closed |
| **R5** [low] length-only `verifyCovered` | NAME matching, normalised, near-miss named | **closed and attacked**: a wrong-named `reported` entry is REFUSED (`no entry for bun run x; nearest provided: "A COMPLETELY DIFFERENT COMMAND"`), a wrong-named `passed` entry too, the legitimate labelled red still completes, `failed` still fails the task, omitted `commandsRun` still refused, and the declared tolerance is exactly case/whitespace/trailing punctuation (`BUN RUN X` accepted, `item9` refused) |
| **R6** [low] length-only `acceptanceCovered` | NAME reading, same normalisation | **closed and attacked**: a wrong 9th NAME of the right COUNT is refused with the near-miss named; a duplicated provided name cannot cover two required names; two required with one provided entry refused; the tolerance boundaries behave as declared |
| **R7** [low] undiscoverable `reported` | description extended | read back from the driver: the `commandsRun` description now reads `{command, status:"passed"|"failed"|"reported", reason?, …}` |

**Red sides I ran MYSELF, in scratch mirrors outside the workspace (deleted after use, T-89):**

| revert performed by me | reading |
|---|---|
| ARMS A/C/D — committed extended driver at the current revision / pre-extension vs HEAD / extended vs HEAD | **0 / 6 / 10** — the repair's own pair reproduces exactly |
| ARM B — **semantic revert of the CYCLE half only** (reader = phantoms, note = no cycle) | **4 failures, all four `[T-64/cycle]` assertions**, with T-87/T-84 untouched → the sharpest red the R3 repair needed |
| ARM F — **semantic revert of the NAME match** to the withdrawn count-only reading | **4 failures**, all `[R5/green]`/`[R6/green]`, with the `failed`-command control still PASS → the R5/R6 arms are red-capable and the revert is isolated to the repaired line |
| registry TRAP arm — edit inside `coverage-name-match` with no regeneration | `--check` **FAIL red** with the precise drift message (lines 666–689, first difference at 673), exit 1 |

(The repair's own `repair-arms-before.out.txt` is a run against `git HEAD`, so its 6 failures include R7-era absences; my ARM F is the same class narrowed to the repaired line. Both are red — the counts differ because the reverted surfaces differ.)

## 3. THE DANGEROUS DIRECTION — what I tried to break, and what broke back

- **R5/R6 do not weaken the guarantee**: every "wrong name, right count" case is refused in BOTH fallbacks, the near-miss is named, and the declared paraphrase tolerance does not extend to internal punctuation. No acceptance hole found.
- **R3's reader does not over-report on well-formed graphs** (diamond, linear, satisfied chain: clean).
- **F1 [low] — the cycle half over-claims on graphs that no longer block.** Measured:

  | graph (T ← B, B↔C) | `dependencyStates(T).blocking` | `unresolvedDependencyNote(T)` |
  |---|---|---|
  | B, C both `pending` | `["B"]` | `[unresolved dep: cycle B→C→B]` ✅ correct |
  | B, C both `failed` | **`[]` (claimable — OPT-1: a failed dependency does not block)** | `[unresolved dep: cycle B→C→B]` ❌ |
  | B, C both `completed` | **`[]` (claimable)** | `[unresolved dep: cycle B→C→B]` ❌ |

  `renderStatus` appends the note to **every** task line (`lib/tools.js`, the task-line template), so the model-facing status tells a captain that a task the scheduler will happily dispatch has an unresolved dependency. A mutual pair of FAILED tasks is a natural record shape (dependencies are declared at creation; failures are ordinary), and the `completed` variant is reachable by force-completion — the very family T-79 replays. *requiredFix:* derive the cycle report from the same predicate the gate uses (report a cycle only while its members are still unsatisfied/non-terminal, or suppress the note when the task's own blocking set is empty). One condition, not a redesign.

- **O1 (observation, not a finding): transitive deadlock is not named.** With `T deps ['A']` and `A→B→C→B`, `A` is named (`[unresolved dep: cycle B→C→B]`) but `T`'s note is empty, although T can never be woken. The acceptance's observable is satisfied for every case it names (a dependency naming a nonexistent id, or a cycle through a dependency); naming T would require a reachability fixpoint, which is scope the frozen row does not ask for. Recorded so the residual is explicit.

## 4. REGISTRY FAMILY AT THE CURRENT REVISION (criterion 4)

- `node scripts/patch-agent-teams-fixes.mjs --check` → **96 regions / 10 adopted files**, exit 0; registry revision `lib/mpd-deltas.js` = `464610bcad077c85…` (the repair's citation).
- the count sentence moved IN THE SAME CHANGE: `agent-references/agent-teams-deltas.md` now reads **96** regions across **10** files (93 → 96), and `bun run verify:docs` is **PASS** with `carried 96/10 vs derived 96/10 … markers agree: 96` (derived D-range still A1–D42).
- **end-to-end edit, by me, in a scratch mirror**: a NEW **top-level** region → `--write-registry` reports **97** → `--check` green at **97** with the probe id present in the registry. (My first attempt placed the probe INSIDE an existing region and it was silently absorbed — the instrument property I recorded in t19, re-measured; a nested region is not a registered region.)
- the three regions the repair names are the ones added: `coverage-name-match`, `acceptance-name-match` (`lib/quality-gates.js`), `reported-red-description` (`lib/tools.js`).
- **their split-region trap claim** (a region that splits a function leaves the stripped skeleton unplaceable, and the heal suite catches it, 269 → 263 pass) is THEIR measurement — I did not reproduce it; recorded as an unverified claim below.

## 5. THE LANE'S VERIFY, REPRODUCED

`bun test ./packages/mpd-agent-teams-plugin` → **269 pass / 0 fail / 2380 expect() calls / 40 files**, exit 0 · `bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/` → **112 pass / 0 fail / 16 files**, exit 0 · `node scripts/patch-agent-teams-fixes.mjs --check` exit 0 · `bun run verify:docs` PASS. No repo-wide aggregate in the lane's verify; `find packages/*/dist dist/mpd-package -newermt 2026-09-17T22:55Z -type f` is **empty** (no derived surface written).

## 6. WHAT I DID NOT VERIFY (bounds)

- t27's own implementation of T-13/T-27/T-44 (R2's closure): a different task's evidence, not audited here.
- The repair's split-region/heal-suite trap measurement (§4) — I verified the parts I could (a top-level region registers; a drift reddens) but not the 263-pass claim inside a mirror.
- Whether the six other wave-2b rows the scope ruling left out have since been implemented.
- Nothing here observes a mounted `dsh` boot; all readings are module-level plus the two CLI legs.

## 7. A HARNESS LESSON OF MY OWN (recorded, not hidden)

My first probe script conflated `required` and `provided` (it built the payload from the same array it
asserted against) and reported one "BAD" that was my fixture's fault, not the code's — the corrected
driver (`round2-probes.mjs`) keeps them separate and re-ran every case. The single remaining BAD there
is O1's transitive case, which I passed the wrong dependency list to and then re-measured directly. The
stale broken output was deleted rather than left beside the good one.
