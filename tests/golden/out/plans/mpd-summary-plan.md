# mpd-summary-plan - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->

**What you'll get:** Add a new self-developed skill, mpd-summary, to the mpd-dsh repo: one SKILL.md (with name/description frontmatter and 5 usage rules), plus one isolated dsh-qa load case (with an offline self-test), turning "output a structured summary after a task/session ends" into a formal agent skill. Once done, the skill is auto-discovered by DSH and loadable in real sessions.

**Why this approach:** Neither upstream oh-my-openagent (the locked commit nor the dev branch) has mpd-summary, so this is a self-developed new skill rather than a vendored one; the repo's skills directory (repo-root `skills/`, provisioned into $DSH_HOME/skills by mpd-bootstrap) is already the active skill corpus, so putting the new skill under `skills/` takes effect with zero config, and it is verified with the repo's existing dsh-qa discipline (isolation + evidence written to disk) without changing any locked assets.

**What it will NOT do:** Will not change VENDOR_LOCK.json / bundle config / any vendored skills; will not add any TS source or plugin code; will not touch the golden sample area; the planner (Prometheus) will not create SKILL.md itself — SKILL.md is created by the worker session that executes the plan.

**Effort:** Short
**Risk:** Low - purely additive assets + one QA script, no existing code/config change surface
**Decisions to sanity-check:** mpd-summary semantics default to task/session summary (five-section structure); the output path is pinned by instruction to tests/golden/out/plans/mpd-summary-plan.md (overriding the ulw-plan default .mpd/plans/).

Your next move: after approving this plan, have the worker session (`$ulw-execute mpd-summary-plan`) execute it. Full execution details are below.

---

> TL;DR (machine): Short effort, Low risk; 4 implementation todos + 4 final-verifier tasks; delivers SKILL.md + dsh-qa case + evidence, all additive.

## Scope
### Must have
- `skills/mpd-summary/SKILL.md`: YAML frontmatter (`name: mpd-summary` + `description`) + body containing exactly **5 numbered usage rules**, phrased natively for DSH (no host-specific tool references).
- `skills/dsh-qa/scripts/skill-summary-load.mjs`: a new dsh-qa case, with `--self-test` offline self-test + an isolated DSH_HOME real boot, asserting that the mpd-summary directory is visible and its content is loadable, and writing evidence to `evidence/dsh-qa/skill-summary-load/<ts>/`.
- Register a new `skill-summary-load` row in the case-set table of `skills/dsh-qa/SKILL.md`.
- Gate execution: root `bun test`, root `bun run typecheck` (tsgo --noEmit), a real run of the new QA case, and `git status` diff review; results and evidence are checked in.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- The planner (this plan phase) never creates SKILL.md or any product files; it only produces the plan file and the `.mpd/drafts/` draft.
- Do not change `VENDOR_LOCK.json` (mpd-summary is not a vendored asset; verify-vendor.mjs only validates lock.assets).
- Do not change `packages/mpd-bundle/cordis.patch.yml` (mpd-bootstrap already provisions the whole repo `skills/` corpus; zero bundle changes).
- Do not change or upgrade any already-vendored skills (ulw-plan/init-deep/lsp-setup/git-master/review-work/programming/ast-grep) or the upstream repo.
- Do not add any TS source, plugin code, or package.json dependency; the only new script is the dsh-qa mjs case.
- Do not write to `tests/golden/fixtures/` (the golden sample area is read-only); do not create a duplicate plan under `.mpd/plans/` (the canonical path is pinned by the user).
- Do not extend semantics (e.g. multilingual translation, template files, web UI integration).

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after + dedicated QA case (repo convention: purely additive asset changes are treated like code changes and go through dsh-qa, PLAN.md §5 T7); no new TS → bun test/tsgo zero delta (root tsconfig.json:16-18 only includes packages/*/src/**/*.ts).
- Evidence: `evidence/dsh-qa/skill-summary-load/<ISO-ts>/result.json` + `output.log` (aligned with skills/dsh-qa/SKILL.md iron rule 3; T6's single canonical evidence path evidence/<domain>/<slug>/).
- Isolation discipline (T4): the QA script forces `DSH_HOME=$(mktemp -d)` and asserts inside the script that `env.DSH_HOME === sandbox`, never reading or writing the user's real `~/.dsh` (template skills/dsh-qa/scripts/skill-catalog-probe.mjs: sandbox creation, DSH_HOME injection, isolation assertion).
- Provability (T5): the real run asserts that dsh output contains `mpd-summary` and at least one usage-rule text; reporting only "it runs" is not allowed.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos/wave; this task is standard-tier (1-5 files), 2 execution waves + a wrap-up wave.
- **Wave 1** (parallel): Todo 1 (SKILL.md content) + Todo 2 (QA script) — independent of each other.
- **Wave 2**: Todo 3 (register the dsh-qa case, depending on the naming and assertion text from 1 and 2).
- **Wave 3** (wrap-up): Todo 4 (full gate run + evidence + git review, depending on 1-3).

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | — | 3 | 2 |
| 2 | — | 3 | 1 |
| 3 | 1, 2 | 4 | — |
| 4 | 1, 2, 3 | — | — |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [ ] 1. Create the SKILL.md for the self-developed skill mpd-summary inside the repo skills/ directory (content spec embedded, zero judgment)
  What to do / Must NOT do: Create the file `skills/mpd-summary/SKILL.md`; its content must match the "Exact content spec" below verbatim (only the text inside the `description` quotes and the rule items numbered 1-5 are allowed to be copied verbatim; do not add or remove rule items). Must NOT: do not create any other file in the same directory; do not add new frontmatter keys beyond `metadata` (`metadata.short-description` is optional but recommended); the body must not contain host-specific tool strings such as host-specific task/call fields; do not modify any existing skill files.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 3
  References: directory semantics repo-root `skills/` (mpd-bootstrap copies the corpus to $DSH_HOME/skills at boot, new subdirectories auto-provisioned); frontmatter style templates skills/ast-grep/SKILL.md:1-4 and skills/review-work/SKILL.md:1-4; metadata template skills/ulw-plan/SKILL.md:1-6 (frontmatter contains metadata.short-description, :4-5).
  Acceptance criteria (agent-executable): `test -f skills/mpd-summary/SKILL.md` and the file's frontmatter parses to `name: mpd-summary` and a non-empty `description`; the body contains exactly 5 numbered `1.`-`5.` usage rules; `grep -E 'task\(|call_mpd_agent|multi_agent|team_|background_output' <file>` has no match; running Todo 2's `--self-test` (whose offline fixtures cover frontmatter/rule-marker detection) exits 0.
  QA scenarios (name the exact tool + invocation): happy (offline) = `node skills/dsh-qa/scripts/skill-summary-load.mjs --self-test` → exit 0, output contains `ok: frontmatter/rule markers detected`; happy (real) = Todo 2's real run has ok=true (see Todo 2); failure (offline) = the negative fixture of `--self-test` (a string without `name: mpd-summary`) must be detected as "not loaded"; if detection fails, exit 1. Evidence `evidence/dsh-qa/skill-summary-load/<ts>/result.json`, `output.log` (written by the Todo 2 script).
  Commit: Y | included in the final commit (see Commit strategy), not committed separately
  Recommended task executor category: writing — purely markdown copywriting, content spec already embedded, no room for judgment

  **Exact content spec (copy verbatim):**
  ```markdown
  ---
  name: mpd-summary
  description: "Produce a structured summary of completed work in mpd-dsh: goal, what was done, result with evidence, risks and leftovers, next steps. Trigger on 'summary' / 'recap' / 'summarize' / 'wrap up' / 'write a summary' / end-of-task reports. Output follows the repo evidence/qa-summary convention: 5 short sections, repo-relative paths, one screen of plain text. Never invent facts missing from the session or evidence; mark them explicitly. Must NOT modify product code."
  metadata:
    short-description: Structured end-of-task summary writer (goal / done / evidence / risks / next)
  ---

  # mpd-summary

  A task/session summary skill: output a structured summary of completed work for handoff, evidence archiving, and later decision-making.
  Only produces read-only summaries; never modifies product code.

  ## Usage rules

  1. **Evidence first**: summarize only citable facts from session content, `evidence/<domain>/<slug>/`, and git history;
     conclusions that did not appear must be explicitly marked "no evidence"; fabrication is forbidden.
  2. **Fixed structure**: output in the five sections "Goal / What was done / Result and evidence / Risks and leftovers / Next steps",
     each section 1-3 lines, total length no more than one screen.
  3. **Path references**: for files, evidence, and artifacts, always give a repo-relative path (e.g.
     `evidence/dsh-qa/skill-summary-load/…`); assertions without a path are always treated as having no evidence.
  4. **Follow the language**: respond in Chinese for a Chinese user and in English for an English user; keep technical terms in their original form without translating them.
  5. **Boundaries**: summarizing is read-only — do not modify product code, do not write files outside the evidence directory;
     the location where the summary is written follows what the user specifies.
  ```

- [ ] 2. Add a new dsh-qa isolated load case, skill-summary-load.mjs (with --self-test and happy/failure assertions)
  What to do / Must NOT do: Create `skills/dsh-qa/scripts/skill-summary-load.mjs`, rewriting `skills/dsh-qa/scripts/skill-catalog-probe.mjs` as the template: `JOB = "First use the skill tool to load the skill named mpd-summary, then reference its name and any one usage rule. Do not use other tools such as bash."`; the real run uses an `mktemp -d` sandbox DSH_HOME, copies `~/.dsh/.credentials.yaml`, and runs `spawnSync("dsh", ["--profile", "headless", "--patch", <repoRoot>/packages/mpd-bundle/cordis.patch.yml, JOB])`; the ok condition = `exit 0 && /mpd-summary/ && /Usage rules/` (the output must contain the marker text of any of rules 1-5); evidence is written to `evidence/dsh-qa/skill-summary-load/<ISO-ts without colons>/result.json` + `output.log`; the script has a built-in `--self-test` (offline): a positive fixture (containing the `name: mpd-summary` and `Usage rules` markers) passes detection, and a negative fixture (without those markers) must be judged negative. Must NOT: modify the existing QA scripts (mount-assert/mcp-call/preset-register/dual-track-smoke/skill-catalog-probe); do not read or write the real `~/.dsh` (only copy credentials read-only); do not introduce network dependencies.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 3
  References: template skills/dsh-qa/scripts/skill-catalog-probe.mjs (self-test, isolated boot, sandbox creation, DSH_HOME injection, isolation assertion, spawnSync --patch bundle, evidence write-to-disk, entry dispatch); iron rules skills/dsh-qa/SKILL.md:13-20 (isolation/provability/evidence/--self-test, four rules); bundle patch path packages/mpd-bundle/cordis.patch.yml (--patch mount, same usage as skill-catalog-probe.mjs).
  Acceptance criteria (agent-executable): `node skills/dsh-qa/scripts/skill-summary-load.mjs --self-test` exits 0; the real run (see QA) exits 0 and `result.json` has `ok=true`; `result.json` and `output.log` exist under `evidence/dsh-qa/skill-summary-load/<ts>/`; the script contains a `DSH_HOME` isolation assertion (`env.DSH_HOME === sandbox`, otherwise exit 1).
  QA scenarios: happy (offline) = `--self-test` exits 0; happy (real, including an API call) =
  `node skills/dsh-qa/scripts/skill-summary-load.mjs` → ok=true, output contains `skill-summary-load] PASS`, evidence files written to disk; failure (offline) = `--self-test` exits 1 when its negative fixture detection fails (the self-test is itself the failure-path evidence); failure (real) =
  temporarily change the skill name in `JOB` to the nonexistent `mpd-summary-absent` and rerun → the script must be ok=false and exit 1, and result.json must record `skillLoaded:false` (afterward change the name back and rerun ok=true to keep evidence). Evidence `evidence/dsh-qa/skill-summary-load/<ts>/` (containing both the ok=true and ok=false rounds above).
  Commit: Y | included in the final commit
  Recommended task executor category: quick — mechanical rewrite of a single file, with an existing template and a fixed assertion pattern

- [ ] 3. Register the skill-summary-load row in the dsh-qa case-set table
  What to do / Must NOT do: append one row to the "Case set (expanded per phase)" table in `skills/dsh-qa/SKILL.md` (currently seventeen rows, one per scripts/*.mjs case):
  `| skill-summary-load | Skill | mpd-summary directory visible + load content complete (isolated boot assertion) | P2+ (G5) |`
  Must NOT: rewrite/delete existing rows; do not touch other sections of `skills/dsh-qa/SKILL.md`; do not touch the repo `skills/` corpus or the bundle patch.
  Parallelization: Wave 2 | Blocked by: 1, 2 | Blocks: 4
  References: table location skills/dsh-qa/SKILL.md (case-set table, one row per scripts/*.mjs); run section skills/dsh-qa/SKILL.md.
  Acceptance criteria (agent-executable): `grep -n 'skill-summary-load' skills/dsh-qa/SKILL.md` matches exactly 1 line (the new row), and the existing 5 rows are preserved unchanged (`grep -c '^| mount-assert'` and similar counts stay the same).
  QA scenarios: happy = the grep assertion above passes; failure = none (documentation row); regression check = `git diff skills/dsh-qa/SKILL.md` contains only the added row. Evidence `evidence/dsh-qa/skill-summary-load/<ts>/result.json` records the diff line count in a note field.
  Commit: Y | included in the final commit
  Recommended task executor category: quick — append a single table row, mechanical operation

- [ ] 4. Full gate run and evidence review (bun test / tsgo / real QA run / git status)
  What to do / Must NOT do: run and record in order: ① `bun test` (root, should have no failures; this change adds no new TS, bun exits 0 when there are no test files); ② `bun run typecheck` (root tsgo --noEmit, should exit 0 — root tsconfig only includes `packages/*/src/**/*.ts`, so this change has zero delta); ③ `node skills/dsh-qa/scripts/skill-summary-load.mjs` (real isolated run, ok=true); ④ `node skills/dsh-qa/scripts/skill-summary-load.mjs --self-test` (exit 0); ⑤ `git status --porcelain` review: expect only
  `skills/mpd-summary/SKILL.md` (new), `skills/dsh-qa/scripts/skill-summary-load.mjs` (new), `skills/dsh-qa/SKILL.md` (modified), `evidence/dsh-qa/skill-summary-load/` (new evidence), plus `.mpd/drafts/` (planning artifact, ignorable); if any other path appears → stop and review to exclude it. ⑥ append the ①-④ outputs to `evidence/dsh-qa/skill-summary-load/<ts>/gates.log`. Must NOT: touch the real `~/.dsh`; do not modify `VENDOR_LOCK.json`; do not commit `/tmp` or files outside the sandbox; do not substitute "it runs" for the assertion result of ③.
  Parallelization: Wave 3 | Blocked by: 1, 2, 3 | Blocks: none (wrap-up)
  References: gate rules AGENTS.md 3-4; root scripts package.json:8-11 (test:9 / typecheck:8 / test:qa:11); tsconfig include scope tsconfig.json:13-14; evidence path convention PLAN.md §5 T6 (evidence/<domain>/<slug>/).
  Acceptance criteria (agent-executable): ①-④ all exit 0; ③'s result.json has ok=true and both files are written to disk; ⑤'s diff set matches expectations exactly (a superset is a failure); ⑥ gates.log exists.
  QA scenarios: happy = all commands exit 0 + evidence complete + diff matches exactly (store a copy of the `git status --porcelain` output under evidence); failure = any command nonzero or a diff superset → record the failing output to gates.log, fix, and rerun the whole chain until all green (keep evidence from both rounds); isolation failure path = if the script asserts DSH_HOME is not the sandbox, exit 1 immediately and write no evidence. Evidence `evidence/dsh-qa/skill-summary-load/<ts>/gates.log` + `result.json` + `output.log`.
  Commit: Y | final commit (see Commit strategy)
  Recommended task executor category: quick — mechanical execution of a command sequence + recording

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
- [ ] F3. Real manual QA
- [ ] F4. Scope fidelity

## Commit strategy
- Wrap up with a single commit (matching the repo's single-commit-per-phase/feature convention; git log is all one-line descriptive commits):
  `feat(skills): self-developed mpd-summary skill (SKILL.md + dsh-qa skill-summary-load case and evidence)`
- Commit contents: `skills/mpd-summary/`, `skills/dsh-qa/scripts/skill-summary-load.mjs`, `skills/dsh-qa/SKILL.md`, `evidence/dsh-qa/skill-summary-load/`.
- Do not commit: `.mpd/drafts/` (planning artifact), the `/tmp` sandbox, any `VENDOR_LOCK.json`/bundle/upstream changes (must be zero).
- Before committing, run `git status` to confirm the allowlist above holds exactly (AGENTS.md rules 1, 6).

## Success criteria
1. `skills/mpd-summary/SKILL.md` exists, frontmatter contains `name: mpd-summary` + a non-empty `description`, the body has exactly 5 numbered usage rules, and no host-specific tool strings.
2. `node skills/dsh-qa/scripts/skill-summary-load.mjs --self-test` exits 0 (positive/negative fixture double assertion).
3. The real isolated run has ok=true, evidence `evidence/dsh-qa/skill-summary-load/<ts>/result.json` + `output.log` is written to disk, and `skillLoaded:true`.
4. The case-set table in `skills/dsh-qa/SKILL.md` contains the skill-summary-load row, with zero changes to existing rows.
5. Root `bun test` and `bun run typecheck` exit 0; `git status --porcelain` matches the expected allowlist exactly.
6. The commit is a single feat commit; `VENDOR_LOCK.json`, `cordis.patch.yml`, vendored skills, and upstream have zero changes (verified by `git diff`).
