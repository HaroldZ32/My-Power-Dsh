# R-W1B2 — review of the independence cuts and the weakened directive (board task T8)

Contract: `.mpd/plans/autoproject-refactor.md` §2-D3/D5, §4.2, §4.3, C3/C4/C6, §7 + the per-wave acceptance
text of board row **T7**.
Subject: the uncommitted `packages/mpd-autoproject-plugin/` (new directory — the W1-B1 rename — so a diff
against HEAD does not exist; the package is reviewed as a whole). Lane record:
`evidence/autoproject-refactor/w1b2/{summary.md,activation-head.sha256,tests.log,comments.log,typecheck.log}`.
Reviewer: Reviewer (read-only on the reviewed work — nothing here was fixed by me).
Reviewed at: 2026-11-02 ~20:09–20:25 (+08:00), against the working tree.

## Assessment (risk level: MEDIUM)

The four cuts are real and they are cut cleanly. I verified by reading the call sites, not the report:
`PERSONAS`, `provider`/`model`/`reviewerModel` and every `spawnAgent`/`subagents.start` path are GONE from
the package (the only occurrences are the comments that record the deletion), and every child — planner,
plan review, round, verification, three quality lanes, five hyperplan angles — is one
`dsh.executeTool({name:"mpd_role_spawn", arguments:{role,task,context}})`, with `route-unconfigured:<Role>`
journaled and the run continued on a roster refusal. The verify plane is genuinely the only verdict: the
engine reads the REAL `<workspace>/.mpd/verify/records/<recordId>.json` layout (I confirmed that layout and
the `PASS` spelling against 154 records on disk), a child's claimed PASS with no record ends `blocked`, and
the run's own `ledger.jsonl` is only a journal. Boulder is driven as the in-flight truth (start, a
start/end timer per criterion, complete only for a completed run), its **13 vendor files are BYTE-IDENTICAL
to the retired package** (so `.mpd/boulder.json`'s shape cannot have moved under the TUI), and the emitted
`## TODOs` form `- [ ] N. label` matches the boulder parser's `TODO_CHECKBOX_PATTERN` exactly. The directive
was weakened exactly as asked: the head is the frozen sentence, the four blanket-autonomy clauses are gone,
`7. WHEN YOU STOP` names the three decision points and nothing else, the child `DIRECTIVE` no longer claims
standalone autonomy, and the recorded head sha256 (`f0e4db56…`) is READ from evidence — I recomputed it and
it matches the shipped constant, so the former tautology is closed. The one thing that blocks the wave is
the escalation predicate's INPUTS: the engine feeds `checklist: criteria.size`, so S1 and S5 read one number
twice and a 13-criteria run supplies two counters for one condition — the frozen "two independent signals"
rule fires on a single fact, and the contract's own CUT 3 (checklist emitted FROM the criteria) is what
makes the collision unavoidable. Two smaller clauses are not met: S6 and the artifact's `scope` are derived
from EVIDENCE paths because the tool has no declared-scope input, and the verify loop's `writer_id` is a
display label because the roster tool exposes no child identity (C6).

## Findings (ranked)

### High 1 — S1 and S5 collapse into ONE condition at the engine boundary, so a 13-criteria run escalates on a single fact
- **Where:** `packages/mpd-autoproject-plugin/src/engine.ts` → `considerEscalation` (`checklist: criteria.size`
  — the only `checklist` occurrence in the file) feeding `packages/mpd-autoproject-plugin/src/escalation.ts`
  → `evaluateEscalation`, whose counter rule is `count(S1,S4,S5,S6,S7) >= 2`; the collision is forced by
  `escalation.ts` → `emitPlanMarkdown` emitting the plan checklist FROM those same criteria (CUT 3).
- **Proved:** `evidence/autoproject-refactor/w1b2/probe-s1s5-collapse.log` — the pure predicate with
  `criteria:13, checklist:3` answers `escalate:false` (one counter), while the engine's own mapping
  `criteria:13, checklist:13` answers `escalate:true` with `[S1,S5]`. Below the S1 line the pair still
  behaves (`9/9` → S5 only, no escalation).
- **Why it matters:** the composite threshold exists so that ONE over-limit number is not enough; on this
  engine a run with more than 12 criteria escalates by itself (with `mode:"ask"` it stops and asks; with
  `mode:"auto"` it hands the project to cellwork). The lane's pure-predicate test cannot see it because it
  passes a distinct checklist; no ENGINE-boundary arm covers it.
- **Why it is a contract problem, not only a code one:** the plan requires BOTH that the plan checklist be
  emitted from the planner's criteria (CUT 3) AND that S1 (criteria) and S5 (checklist) be independent
  counters (§4.3). Those two clauses cannot both hold. **Needs a captain ruling**, then a one-line code
  change and an engine-boundary test: count `S1 || S5` once, or give S5 a genuinely different measure, or
  drop S5.

### Medium 1 — S6 and the hand-off's `scope` are derived from EVIDENCE paths, not a declared write scope
- **Where:** `engine.ts` → `considerEscalation` (`scopeTrees: topLevelScope(evidence).length`), the
  `mpd_verify_open` call (`scope: topLevelScope(evidence)`), the escalation artifact's `scope`, and the
  `cellwork_open` mandate; `AutoprojectArgs` has NO scope input, so a run cannot declare one.
- **Proved:** `probe-s1s5-collapse.log` — `topLevelScope` over a doc-only evidence list returns five trees
  (`docs`, `agent-references`, `evidence`, `skills`, `packages`), so S6 counts report/documentation paths as
  "scope" and can fire on a run whose writes were narrow.
- **Why it matters:** §4.3 names "distinct top-level write-scope trees" and CUT 2 names "the declared write
  scope"; the implementation substitutes the paths children happened to cite, so both the S6 signal and the
  mandate's `scope` are a guess about what the run was allowed to touch (a run that wrote outside its brief
  cannot be detected, and a run that cited many docs can trip the signal spuriously).
- **Direction:** accept a `scope` (or read the plan's `write_scopes`) and pass it to `mpd_verify_open`, S6 and
  the mandate; keep the evidence derivation only as the fallback and say which one was used.

### Medium 2 — the verify loop's `writer_id` is a label, not an agent key
- **Where:** `engine.ts`, the `mpd_verify_open` call: `writer_id: roundRole + " · " + id`,
  `writer_reason: "member: " + roundRole`.
- **What/why:** `packages/mpd-verify-plugin/src/tools.ts` (`openTool`) documents `writer_id` as "the member's
  session id (an agent key, not a display name)" precisely so `mpd_verify_record`'s same-agent refusal
  compares REAL identities; a display name + run id is the placeholder class that guarantee excludes. The
  record's `writerId` therefore cannot be matched to any agent.
- **Bound, stated rather than hidden:** `mpd_role_spawn` returns the fixed `REPORT_SCHEMA` (C6) and exposes
  no child session id, so the engine genuinely cannot know it — the substitution is the best available label
  and the lane's summary states it. The reviewer's concern is that no test or comment records the consequence
  at the call site: the loop's same-agent arm is inert for autoproject loops, and the independence of the
  verification rests ONLY on the verifier being a different seat (it is a `Reviewer` consult, so the
  guarantee holds in practice).
- **Direction:** record the bound in the call's comment (and ideally in the summary the record keeps), or
  have the roster tool expose the child handle in a later wave.

### Nit 1 — `mode:"off"` writes no `escalation.json`
The artifact is written only for `ask`/`auto`; `off` journals `suppressed` and takes no consequence. The
plan lists the artifact without conditioning it on the mode, but the chosen reading is defensible (an `off`
run continues, and `cellwork_open` refuses a mandate with no escalation artifact on disk — writing one would
manufacture a mandate nobody issued). Disclosed in the lane's summary. Not a defect; worth a sentence in the
contract later.

### Nit 2 — a missing roster TOOL refuses the whole run
`runAutoproject` throws when `mpd_role_spawn` is not registered. The contract's tolerance covers an
UNCONFIGURED role, not an absent tool; refusing is defensible (every child would fail) and the sentence names
the fix. No change required; noted so the two failure classes are not read as one.

### Nit 3 — the `strictReview` argument is now inert
Kept for argument compatibility with the retired tool and documented as such in the schema. Honest, but a
caller who passes `strictReview:false` gets verification anyway — the description says so, so this is a
documentation choice rather than a defect.

## Declined to judge

1. **`PERSONAS`/provider/model deletion and the roster role map** — verified by reading the call sites and the
   role constants; the five-angle wave really does pass each angle as the `context` of an `Architect`
   consult.
2. **The boulder row's move** — the 13 `vendor/**` files are byte-identical to `HEAD:packages/mpd-boulder-plugin/src/vendor/**`,
   the six tool names are unchanged, and the parameter blocks carry no `type`/`enum`/`required`/`description`
   difference, so the `.mpd/boulder.json` shape and the TUI read are untouched.
3. **The two cross-package src imports** (`mpd-autoproject → mpd-roles`, `.../boulder → mpd-roles`) — NOT new
   edges: the retired `mpd-ulw-plugin` and `mpd-boulder-plugin` carried the same imports, and the coupling
   inventory was re-frozen with the moved paths (the inventory test passes, 2/2). C1's "may only shrink" is
   satisfied by a MOVE.
4. **`escalated` leaving the goal armed** — asserted by the suite (`goalFinishes === []`) and by
   `finishGoal`'s own guard (only `complete`/`blocked` transition); the run's `state.status` is written
   before that call.
5. **The directive's blocked-out `AUTONOMY` phrases in comments/tests** — they appear only as the record of
   what was deleted (and as the QA skill's `RETIRED_AUTONOMY_PHRASES`, which asserts them ABSENT).
6. **The QA skill's probe re-pin** — `skills/dsh-qa/scripts/autoproject-command.ts` now carries
   `HEAD_PROBE` = the new head regex, the new `CLAUSE_PROBES` (including `decisionPoints`) and the retired
   phrase list; the skills lane did its half, so the cross-wave note in T7 is closed on disk.
7. **Dist not rebuilt** — `packages/mpd-autoproject-plugin/dist/index.js` is stamped 17:39 while `src/` is
   19:37+, i.e. stale as the lane reported; integration owns the rebuild (T-88).
8. **The package's own README pair** — untracked and new (W5's documented scope).
9. **A live MOUNT/boot** — not run: the package is untracked and its dist is stale, so a mount would exercise
   old bytes; the tool/command/gesture registrations are exercised through `apply` in the suite instead.

## Verdict

**FAIL — request changes.** Four of the five cuts are exactly what the contract asked for, and the gates I
re-ran are green (40/40 tests, `tsgo` exit 0, scoped `verify:comments` PASS, `SETTINGS_KNOBS` still 47, the
coupling inventory green, the boulder vendor byte-identical); but the ONE independent decision the engine
keeps fires on a single condition because S1 and S5 read the same number, and two named contract clauses
(the declared write scope, the loop's writer identity) are not met — the first needs a captain ruling plus a
one-line change and an engine-boundary test, the other two a small fix or a recorded bound.

## Bounds of this review

Read: the frozen plan sections named by T7 plus the T7 contract itself; `src/directive.ts` in full; the key
regions of `src/engine.ts` (the constants and role map, `consult`, `absorb`, `considerEscalation`, the plan
phase, the round loop, the verify phase, the quality gate, the finalization, `verifyPassRecorded`,
`finishGoal`, the boulder helpers); `src/escalation.ts` (predicate, config resolution, `topLevelScope`,
`emitPlanMarkdown`); the tool/command/gesture registration and `activationDirective`/`gateTrailerText` in
`src/index.ts`; the verify plugin's `openTool` signature and the real record layout (154 files in
`.mpd/verify/records/`); the boulder parser's `TODO_CHECKBOX_PATTERN`; the engine/commands test harness and
the arms that back each acceptance item; the lane's `summary.md` and its recorded head sha256 (recomputed).
Did NOT read: the whole 51 KB `engine.ts` / 46 KB `index.ts` outside the regions above, the team-gate
implementation inside `index.ts`, `test/boulder.test.ts` in full, the 48 KB `commands.test.ts` outside the
directive arms, or any `dist/` artifact.

Ran: `bun test packages/mpd-autoproject-plugin` (40 pass, 0 fail — `test-run.log`); `bun run typecheck`
(exit 0 — `typecheck.log`); `node scripts/verify-comment-coverage.ts --only packages/mpd-autoproject-plugin`
(PASS); `bun test packages/mpd-config-plugin/test/team-models.test.ts` (21 pass — `SETTINGS_KNOBS` 47);
`bun test packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` (2 pass); the
`sha256` recomputation of the shipped activation directive (matches the recorded file); and the
S1/S5-collapse probe. Could NOT run: a real MOUNT boot or a live autoproject run (stale dist; needs an
isolated `DSH_HOME` and a real roster/verify composition — integration), the Docker lane, or a byte-diff of
the package against HEAD (the directory is new after the W1-B1 rename).
