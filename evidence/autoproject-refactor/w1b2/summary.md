# W1-B2 — cut autoproject's independence, weaken the directive

Lane: Deep Worker (board row **T7**). Contract: `.mpd/plans/autoproject-refactor.md` §2-D3/D5, §4.2, §4.3,
C2/C3/C4/C6, §7, plus the T7 dispatch text. Wave scope: `packages/mpd-autoproject-plugin/{src,test}` ONLY.
`dist/` was deliberately **not** rebuilt and no git command was run (the captain integrates).

## 1. What changed (file → symbol)

**New `src/directive.ts`** — the two prompt texts, held apart from the engine:
- `AUTOPROJECT_ACTIVATION_DIRECTIVE` — new head
  `AUTOPROJECT ACTIVATION (user-invoked; execute autonomously, and stop for a human ONLY at the three decision points below)`.
  The four autonomy clauses ("ask the user nothing", "no user confirmation", "never stop early to ask the
  user", "never ask the user for approval") are DELETED; ONE closing clause `7. WHEN YOU STOP` names
  exactly three decision points: (a) escalation fired and `autoproject.escalate.mode` is `ask`;
  (b) a credential/secret/external capability is absent; (c) the next write would leave the declared scope.
  Clause 3 now bounds the self-approval ("ONLY when the write scope is inside the declared scope AND the
  gate verdict is mechanical; otherwise ONE `ask_user_question`"), clause 4 names the engine's escalation,
  clause 5 makes an out-of-scope fix a decision point, clause 6 requires a **recorded verify PASS**.
- `DIRECTIVE` — the child-round head: "ULTRAWORK DISCIPLINE" → "AUTOPROJECT ROUND (fixed policy; one round
  of an automated MPD session)", standalone-autonomy framing dropped, a `Toolchain:` clause points the
  child at `mpd_role_spawn` / `mpd_verify_*` / `mpd_boulder_*`, and it states the two tokens the ENGINE
  parses: `recommendation`'s first line `STATUS: continue|complete|blocked`, and evidence attribution
  `<key>:: <proof>`.
- `ADVERSARIAL_CATEGORIES` — `.persona` → `.angleId` (same five angle strings, typed `AdversarialAngle`).

**New `src/escalation.ts`** (pure, no adapter/fs) — `EscalationConfig`/`ESCALATION_DEFAULTS`,
`escalationReader` + `resolveEscalationConfig` (knobs read PER CALL, outside `SETTINGS_KNOBS`),
`evaluateEscalation` (S1–S7; `escalate = S2 || S3 || count(S1,S4,S5,S6,S7) >= 2`), `recommendationStatus`,
`recommendationVerdict`, `reviewRequired`, `evidenceAttribution`, `topLevelScope`, `criterionLabel`,
`stripChecklistSections`, `emitPlanMarkdown`.

**New `src/engine.ts`** — `runAutoproject`, the four cuts:
1. **ROSTER ROUTING.** `PERSONAS` and the `provider`/`model`/`reviewerModel` config leaves are DELETED
   (also from `mergedConfig`). Every child is `dsh.executeTool({name:"mpd_role_spawn", arguments:{role,
   task, context}})` (`consult`). Role map: `Planner` · `Plan Reviewer` · round `Deep Worker`(heavy) /
   `Senior Engineer`(light+plan) / `Junior Engineer`(other) · `Reviewer` for verification and for THREE
   quality lanes · `Architect` for the five angles (angle text in `context`). An unconfigured role is
   journaled as `route-unconfigured:<Role>` and the run continues.
2. **VERIFY PLANE.** `mpd_verify_open {writer:"delegate", writer_id:<role · runId>, writer_reason,
   scope, contract?}` → the Reviewer consult is told to `mpd_verify_seat` → `mpd_verify_evidence
   {kind:"gate"}` → `mpd_verify_record {sources, evidence_ids}`; the engine then reads
   `<workspace>/.mpd/verify/records/*.json` (`verifyPassRecorded`) and reports `complete` ONLY on a
   recorded `PASS`. A claimed PASS with no record ends `blocked`. `ledger.jsonl` stays a JOURNAL.
3. **BOULDER LEDGER.** `mpd_boulder_start {planPath}` at plan creation, `mpd_boulder_task_timer`
   `start`/`end` per criterion at the round boundaries, `mpd_boulder_complete` only for a completed run.
   The plan's `## TODOs` section is EMITTED from the criteria (`emitPlanMarkdown`), never the planner's
   prose, so `mpd_boulder_plan_progress` reports exactly as many items as criteria exist.
4. **ESCALATION.** `considerEscalation` at every round boundary and after verification:
   `.mpd/autoproject/<id>/escalation.json` `{version,at,mode,signals,objective,planFile,criteria,evidence,
   scope,roundsUsed,mandate,handoff}`, `state.status="escalated"`, goal LEFT ARMED (no `finishGoal` call);
   `off` journals `suppressed` and takes no consequence; `ask` → `/cellwork <objective>` instruction;
   `auto` → `cellwork_open` when registered, else the instruction (both recorded).

**Also in `./engine.ts`** — the PLAN GATE is a real gate: a run whose plan review never approved cannot be
reported `complete`, however clean its rounds are (`planReviewOk` in the completion predicate), while a
plan-less run has no plan gate at all (an APPROVED gate, not a failing one).

**`src/index.ts`** — now the ROW only: tool/command/gesture registration + the mechanical team gate. The
tool body is `runAutoproject(args, exec, {dsh, ctx, config: cfg})`. Deleted here: `REPORT_SCHEMA`,
`CRITERIA_STATES`, `PERSONAS`, `ADVERSARIAL_CATEGORIES`, `DIRECTIVE`, `AUTOPROJECT_ACTIVATION_DIRECTIVE`,
`spawnChild`, `upsertCriteria`, `allClean`, `goalBridge`/`anchorGoal`/`finishGoal`, `planRoot`/`stateRoot`/
`writeJson`. `gateTrailerText` lost its "no user confirmation" sentence; the command description and usage
line lost "fully autonomously". `AUTOPROJECT_ACTIVATION_DIRECTIVE` is re-exported from the package entry,
so every existing importer keeps resolving it.

**New directive head sha256** (recorded in `activation-head.sha256`, READ by the suite):
`f0e4db568c61e0c6f3dab0ef6125dc2bc97b2ada14c29a1e3488fb3c18d64dc7`

## 2. Tests re-pinned / added

`test/engine.test.ts` — REWRITTEN (13 arms). The fake registry runs the package's own boulder tools for
real and POISONS the subagent seam (it throws), so a direct spawn reddens instead of passing quietly:
(1) every child is one `mpd_role_spawn` with no `provider`/`model`/`persona` key, role map asserted;
(2) `complete` requires a recorded PASS — the "claims PASS, no record" arm ends `blocked`/`reject`;
(3) boulder start/complete + a `start` AND `end` timer per criterion, and the emitted checklist read by
the REAL `mpd_boulder_plan_progress` equals the criteria count; (4) the pure predicate's combinations and
the three modes, including "escalated leaves the goal armed" (`goalFinishes === []`); (5) unconfigured-role
degrade; plus the plan-gate arm (a rejected plan keeps a clean-round run from completing), the
declared-output-schema arms and the pure readers.

`test/commands.test.ts` — the "six autonomy behaviours in order" arm is rewritten to the bounded policy
(eight clause heads, the three decision points, the four deleted clauses asserted ABSENT), the QA-probe arm
names the two probes the skills lane must re-pin with their exact replacement regexes, and the head-hash arm
now reads `evidence/autoproject-refactor/w1b2/activation-head.sha256` instead of hashing the constant
against itself (the former tautology).

## 3. Gates run (command + observed result)

| Command | Result |
|---|---|
| `bun test packages/mpd-autoproject-plugin` | **40 pass / 0 fail**, 359 `expect()` calls, exit 0 (`tests.log`) |
| `bunx tsgo --noEmit` | errors ONLY in `packages/mpd-memory-plugin/src/index.ts` (a PARALLEL lane's in-flight edit; 8 at my first run, 1 at my last); ZERO in `packages/mpd-autoproject-plugin/**` (`typecheck.log`) |
| `bun run verify:comments` | **VERDICT: PASS** — every declaration in the family documented, exit 0 (`comments.log`) |
| `git status packages/mpd-autoproject-plugin/dist` | `dist/index.js` mtime **17:39:11**, before this task began — NOT rebuilt, by contract |

## 4. What I could NOT prove (honest bounds)

1. **`bun run typecheck` is NOT green repo-wide**, but every remaining error is in
   `packages/mpd-memory-plugin/src/index.ts` (wave W3-D in flight in this shared checkout). My package
   contributes zero errors. The acceptance line "typecheck green" is therefore met for THIS scope only.
2. **No real boot.** `dist/` was not rebuilt and no dsh boot was run (both out of scope by contract), so
   nothing here proves the row MOUNTS or that `mpd_role_spawn` is really registered in a live composition;
   the `hasTool` guard is exercised only against the unit double.
3. **The QA probes in `skills/**` are now stale — a SKILLS-LANE edit is REQUIRED** (I cannot write
   `skills/**`): `skills/dsh-qa/scripts/autoproject-command.ts` still ships
   `HEAD_PROBE = /ask the user nothing/` and `CLAUSE_PROBES.loop = /LOOP TO COMPLETION[\s\S]{0,120}never
   stop early to ask the user/`. Both described clauses were deleted by this wave, so the real QA case
   `autoproject-command` will FAIL until that lane re-pins them. The exact replacement regexes are asserted
   in `test/commands.test.ts` ("the QA probes a weaker head retires…").
4. **The escalation scope is DERIVED, not declared**: the tool has no `scope` argument, so the verify
   loop's `scope` and S6 both read `topLevelScope(evidence)` — the distinct first path segments of the
   evidence entries the rounds recorded. A run that evidences no workspace-relative path gets an empty
   scope, which the verify plane reads as "the whole workspace".
5. **S1 and S5 read the same number** in this model (rounds do not add criteria), so they fire together
   only above `criteriaMax`; the two thresholds stay separate (`12` vs `8`) and each remains individually
   observable.
6. `packages/mpd-autoproject-plugin/README.md` still documents the OLD engine — a docs-fold item for the
   docs wave (W5), outside this task's write scope.
7. **The whole package directory is UNTRACKED in git** (`?? packages/mpd-autoproject-plugin/`): W1-B1 moved
   it with a plain `mv`, so integration must stage with `git add -A` (plan §9 F3) or the wave's source and
   evidence vanish from the commit.
8. No boot, no `verify:rows`, no `preset-conformance` and no Docker lane were run — the contract keeps
   `dist/` and the mount/integration gates with the captain, and this task touched no row, preset or
   manifest.
