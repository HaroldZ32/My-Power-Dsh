# t29 — repair r2: t19's SEVEN findings closed on lane A (R1/R2 by the captain's scope ruling; R3–R7 by repair)

**Task:** `t29` (repair, round 2, attempt `86274e1c-e6d1-43e5-8d5e-aaf2758b216d`), source task `t13`,
reason task `t19` (rev-A, `needs_revision`). **Verify (contract):**
`bun test ./packages/mpd-agent-teams-plugin` → **269 pass / 0 fail / 2380 expect() calls / 40 files,
exit 0**.

Read first, not summarized: the review's own record at
`evidence/review/wave2b-laneA/20260917T142959Z/` (`README.md`, `result.json`, `PIN.txt`,
`my-arm-before-revert.out.txt`, `my-adversarial.mjs`). The captain's rulings are COPIED into
`captain-rulings.md` in this directory (T-90: the artifact is the anchor, the id is provenance).

| finding | what the review measured | what this repair does | reading |
|---|---|---|---|
| **R1** [blocker] | 10 of the 13 rows have no deliverable | **scope ruling** (item 1): those rows are separate tasks; t29 closes the findings only. t27 has since landed T-13/T-27/T-44 | `captain-rulings.md` |
| **R2** [high] | T-13/T-27/T-44 may not be closed by rule | **landed by `t27`** as deliverable + verify + review (its own task, its own evidence); nothing here closes a row by rule | `evidence/agent-teams/wave2b-laneA/20260917T1455Z/README.md` |
| **R3** [medium] | a 2-cycle returns `[]` from `unresolvedDependencies` and reads as an ordinary park | **EXTEND (ruling 2):** `lib/state.js` now has `phantomDependencies()` + `dependencyCycle()`, the reader returns phantoms ∪ cycle members, and the note reports the cycle **as itself**: `[unresolved dep: cycle c2→c1→c2]` | `arm-cycle-before.out.txt` / `arm-cycle-after.out.txt` |
| **R4** [medium] | the committed red side was the SUPERSEDED design's log (7 failures, an assertion the shipped driver does not contain) | **ruling 3:** the committed driver's own revert-state run is stored (`arm-before-committed.out.txt`, **6 failures**, exit 1) and the stale log is KEPT, labelled by `arm-before-SUPERSEDED.md`, which quotes the replaced assertion. The pre-extension driver bytes are preserved as `arm.mjs.pre-cycle-extension` (hash `36de7d01…`, the review's pin), so the pair stays reproducible after `arm.mjs` gained the cycle arm | the three files in `…141608Z/` |
| **R5** [low] | `verifyCovered`'s fallback was LENGTH-only: a `reported` entry for a DIFFERENT command covered the required one | **NAME matching (ruling 4)** under a normalised comparison; the refusal names the near-miss: `no entry for bun run x; nearest provided: "SOME OTHER COMMAND" (matched 0 of 1)` | `repair-arms-before.out.txt` / `repair-arms-after.out.txt` |
| **R6** [low] | `acceptanceCovered` had the same fallback: a 9-item payload whose ninth item is a DIFFERENT NAME was ACCEPTED | **NAME reading (ruling 5)**: the whole function is one region, the fallback requires the names one-for-one under the normalised comparison; the near-miss is named: `no entry for item-9; nearest provided: "item-9-UNDER-A-DIFFERENT-NAME" (matched 8 of 9)` | the same two logs |
| **R7** [low] | the `reported` status was undiscoverable: the `commandsRun` description still read `status:"passed"\|"failed"` | **description extended (ruling 6)** inside `mpd-delta reported-red-description`, naming `reported` + its required `reason` label; read back from the REGISTERED tool's parameters | the same two logs |

## Both readings, kept

| pair | before (reverted `lib/`, from `git HEAD`, scratch outside the workspace, deleted in-call) | after (worktree) |
|---|---|---|
| row driver `arm.mjs` (T-64 cycle arm added) | `arm-cycle-before.out.txt` — **RED-SIDE FAILURES: 10, exit 1** (the 6 t13-era reds + 4 cycle arms: the reader and the three note assertions) | `arm-cycle-after.out.txt` — **0, exit 0** |
| committed driver, PRE-extension (`arm.mjs.pre-cycle-extension`, `36de7d01…`) | `arm-before-committed.out.txt` — **6 failures, exit 1** (R4's reproducible red side) | — |
| repair arms `repair-arms.mjs` (R5/R6/R7) | `repair-arms-before.out.txt` — **6 failures, exit 1** | `repair-arms-after.out.txt` — **0, exit 0** |

The negative controls the rulings demanded are IN those arms: a wrong-command `reported` entry of the
right count no longer covers (R5), a wrong-named ninth item of the right count is refused (R6), a
paraphrased criterion (case + whitespace) still passes (R6 control), the legitimate
`passed`+`reported` pair still covers (R5 control), a genuinely `failed` command still fails (R5
control), and a satisfied linear chain is not called a cycle (R3 control).

## Registry family — one change, count cited by row id + region ids + sha, never inherited

- **three NEW regions:** `mpd-delta coverage-name-match` + `mpd-delta acceptance-name-match`
  (`lib/quality-gates.js`, the shared normalised NAME comparison) and
  `mpd-delta reported-red-description` (`lib/tools.js`);
- **modified in place** under their existing ids: `mpd-delta dependency-failed-unblock` (`lib/state.js`),
  `mpd-delta coverage-gap-text`, `mpd-delta reported-red-coverage` (`lib/quality-gates.js`);
- `--write-registry` → `--check` **exit 0** at **96 regions across 10 adopted files**
  (`registry-check.log`); registry revision `lib/mpd-deltas.js` =
  `464610bcad077c85aaeb98469a45c399fd08dd38ce9004e7bae45c59ad8d66c0`;
- the count sentence in `agent-references/agent-teams-deltas.md` (`4d6cedd8…`) moved in the SAME change
  (93/10 → **96/10**) with the t29 provenance clause, and `bun run verify:docs` is **PASS** with
  `carried **96**/10 vs derived 96/10` and the derived D-range still `A1–D42`.

**A REGISTRY TRAP MEASURED HERE, and the reason two `--check`-green states were not enough:** the first
`acceptance-name-match` region wrapped only the two fallback lines INSIDE `acceptanceCovered`. The
registry was internally consistent (`--check` green) and `verify:docs` green — but the region-SPLIT
function left the region-stripped skeleton with a mangled body, so the strip/heal cycle could no longer
place `reported-red-coverage` (nor `acceptance-name-match`), and `registry-context-heal` +
`scope-glob-and-contract` went **6 tests red** (269 → 263 pass). Wrapping the WHOLE function in the one
region fixed it (**21/21** heal tests green). Both placement rules — never NEST a region, never SPLIT a
function — are now recorded in the deltas doc beside the count, with their measurements.

## Revisions (pinned; a citation is a hash + a moment)

| artefact | revision (this repair) | review pin (`PIN.txt`) |
|---|---|---|
| `lib/state.js` | `85e579acf1441870335ba5a4f5e25e5ea92ac7394ed60ef24891afd7da926336` | `e9c90db3…` |
| `lib/quality-gates.js` | `01ea2f92319a732f42d5a956c947b9b00fdba20640ec8c8ed77a037ae12ce929` | `a05c2a24…` |
| `lib/tools.js` | `39d77fe6826d19375ea682dfc21aeb42995f1ff818aeb5d1e0ac96b1c1455ea1` | `2e01e874…` (t13-era) |
| `lib/mpd-deltas.js` | `464610bcad077c85aaeb98469a45c399fd08dd38ce9004e7bae45c59ad8d66c0` | `6ceff2ef…` |
| `agent-references/agent-teams-deltas.md` | `4d6cedd8fff33c803a73409f3fe2d02e718d84ae02a20aef22afb6e892b467f6` | `a2120d45…` |
| `…141608Z/arm.mjs` (extended) | `4a2a875abc72a08f39f2c0a210372ce5ad30e69cee7f150f5498ae8673ec66b0` | `36de7d01…` (preserved as `arm.mjs.pre-cycle-extension`) |

## Bounds — what this repair did NOT verify

- **No repo-wide aggregate was run** (the forbidden five: `verify:gates`, `test:qa`, `test:qa:all`,
  `verify-dist-fresh`, `typecheck`; also not `verify-vendor`/`verify-pack-closure`).
- **The ten unimplemented rows are NOT closed here** — the captain's scope ruling; they live in their
  own tasks and nothing in this task claims their readings.
- `packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json` and `.mpd/plans/**` are untouched.
- The **`test/**` hop was not needed and was not requested**: the two `test/**` pins that the first
  attempt reddened (the read-only-surface parameter pin, and the t41 scratch-neutralisation literal)
  were satisfied by design changes in scope — the batch riding on the existing argument (t27) and the
  unknown-id text being single-sourced (t27).
- The cycle reader is bounded and deterministic (a depth-bounded walk per candidate root, phantoms and
  cyles only); **deep cycles beyond the task list are not explored**, by construction.
- `bun run verify:docs` was used (the contract names it as the derived-arm check); it is not one of the
  forbidden aggregates.

## Files

`lib/state.js`, `lib/quality-gates.js`, `lib/tools.js`, `lib/mpd-deltas.js` (regenerated),
`agent-references/agent-teams-deltas.md`, `…141608Z/{arm.mjs, arm.mjs.pre-cycle-extension,
arm-before-committed.out.txt, arm-before-SUPERSEDED.md, arm-cycle-before.out.txt,
arm-cycle-after.out.txt}`, and this directory (`README.md`, `result.json`, `captain-rulings.md`,
`repair-arms.mjs`, `repair-arms-before.out.txt`, `repair-arms-after.out.txt`, `registry-write.log`,
`registry-check.log`, `suite-plugin-after.log`, `gate-verify-docs.log`).
