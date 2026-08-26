---
slug: omo-summary-plan
status: plan-written
intent: clear
review_required: false
plan_path: tests/golden/out/plans/omo-summary-plan.md
pending-action: none (plan already written; execution is done by the worker session `$ulw-execute omo-summary-plan`, the planner does not execute)
approach: the plan self-develops the omo-summary skill inside omo-skills-plugin (SKILL.md: name/description frontmatter + 5 usage rules, DSH-native phrasing), with a matching dsh-qa isolated load case and evidence written to disk; VENDOR_LOCK/bundle/upstream assets are not changed; the executor creates SKILL.md and the planner never does.
---

# Draft: omo-summary-plan

## Components (topology ledger)
| id | outcome (one line) | status | evidence path |
|---|---|---|---|
| C1 | packages/mpd-skills-plugin/skills/omo-summary/SKILL.md exists and frontmatter/rules compliant | active | evidence/dsh-qa/skill-summary-load/<ts>/result.json |
| C2 | skills/dsh-qa/scripts/skill-summary-load.mjs exists and --self-test PASS | active | same as above |
| C3 | dsh-qa SKILL.md case-set table registers the new case | active | outside packages/mpd-skills-plugin/skills/ulw-plan: skills/dsh-qa/SKILL.md |
| C4 | isolated DSH_HOME boot asserts omo-summary is loadable (happy+failure) | active | evidence/dsh-qa/skill-summary-load/<ts>/output.log |

## Open assumptions (announced defaults)
| assumption | adopted default | rationale | reversible? |
|---|---|---|---|
| semantic content of omo-summary | task/session summary skill: output a structured summary of completed work (goal / what was done / result and evidence / risks and leftovers / next steps), phrased natively for DSH and citing repo-relative paths | neither the upstream locked commit 8c57e463 nor dev has omo-summary (API tree search); "summary" + the repo evidence/qa-summary convention form a defensible default; the golden pass pins form but not semantics | yes (pure copy, can be rewritten anytime) |
| plan file location | tests/golden/out/plans/omo-summary-plan.md (pinned explicitly by the user; overrides the ulw-plan default .omo/plans/) | user instructions take precedence over the skill's default path | yes |
| do not touch VENDOR_LOCK/bundle | self-developed skills are not vendored assets; customSkillDirs already points to the whole skills directory, new subdirectories are auto-discovered | cordis.patch.yml:customSkillDirs + verify-vendor.mjs only walks lock.assets | no (touching is wrong) |
| gate scope | pure markdown/script changes: bun test is unaffected (no new TS); tsgo is unaffected (root tsconfig only includes packages/*/src); QA = the new dsh-qa case | AGENTS.md gate + root tsconfig include scope | yes |

## Findings (cited - path:lines)
- F1 a skill is a directory: all 7 skills are packages/mpd-skills-plugin/skills/<name>/SKILL.md; the bundle uses skill-filesystem customSkillDirs to point at the whole skills directory → a new subdirectory is auto-discovered with no bundle change (packages/mpd-bundle/cordis.patch.yml:41-48; P2 commit f8386d4 "vendor 7 omo skills … skill-filesystem(customSkillDirs)").
- F2 upstream has no omo-summary: the GitHub API lists packages/shared-skills/skills (both the locked commit 8c57e463 and the dev branch) with no summary skill; a 9127-blob whole-tree search finds only evidence/qa-summary.md-style files and .github/scripts/write-job-summary.sh → self-developed rather than vendored (VENDOR_LOCK.json has no such asset, verify-vendor.mjs:49-70 only validates lock.assets).
- F3 SKILL.md shape: YAML frontmatter name + description (trigger-word style per ast-grep/review-work), optional metadata.short-description (init-deep); the body is the usage description (packages/mpd-skills-plugin/skills/*/SKILL.md).
- F4 QA convention: the case-set table in skills/dsh-qa/SKILL.md (mount-assert/llm-dual-track/skill-load/mcp-call/preset-register); scripts must isolate DSH_HOME (mktemp -d) + assert isolation + --self-test + write evidence to evidence/<domain>/<slug>/<ts>/ (T4/T6/T7, PLAN.md §5; skill-load.mjs is the template).
- F5 gate impact surface: root tsconfig includes only packages/*/src/**/*.ts (tsconfig.json:16-18); omo-skills-plugin has no src/ and no tests → purely additive asset changes trigger no bun test/tsgo delta, and QA goes through the dsh-qa case (AGENTS.md gate 3-4; PLAN.md §5 T7 "prompt/asset changes are treated like code changes").
- F6 output area: tests/golden/out/plans/ does not exist yet and is created when writing the plan (see git log 69fa9d9 "golden fixtures" for the tests/ structure; tests/golden/fixtures is the task sample area and is not touched).

## Decisions (with rationale)
- D1 landing point packages/mpd-skills-plugin/skills/omo-summary/SKILL.md: same shape as the 7 existing skills, auto-discovered, satisfies the plugin-shape iron rule (AGENTS.md #2).
- D2 the content spec is embedded into plan Todo 1 (exact frontmatter text + 5 usage rules), so the executor has zero judgment.
- D3 QA uses a new script skill-summary-load.mjs (not modifying skill-load.mjs, to avoid regressing P2's existing assertions), and the case slug is registered in the dsh-qa table.
- D4 commit strategy: a single commit (matching the repo's single-commit-per-phase convention, git log is all one-line phase commits).

## Scope IN
- C1 SKILL.md (frontmatter name/description + 5 usage rules, DSH-native phrasing)
- C2 a new dsh-qa case script (--self-test + isolated boot + happy/failure assertions + evidence)
- C3 register one row in the dsh-qa SKILL.md case-set table
- C4 gate execution and evidence written to disk (bun test / tsgo / QA case / git status review)

## Scope OUT (Must NOT have)
- the planning phase never creates SKILL.md or any product files (this plan only writes the plan file and .omo/drafts)
- do not change VENDOR_LOCK.json (not a vendored asset)
- do not change packages/mpd-bundle/cordis.patch.yml (found that no bundle change is needed)
- do not change or upgrade any vendored skills, do not touch upstream
- do not add any TS source/plugin code (pure markdown + one mjs QA script)
- do not write tests/golden/fixtures (the golden sample area is read-only)

## Open questions
None (the intent is clear; the only semantic-derivation port is resolved with a default and recorded in this ledger, and the user can veto it at approval).

## Approval gate
status: awaiting-approval
- the user's instructions already fully pin the deliverable shape, template, and output path (tests/golden/out/plans/omo-summary-plan.md),
  treated, under the golden single-round semantics, as explicit approval to write the plan; to veto a default (omo-summary semantics/path), state it at approval time.
- post-approval action: write tests/golden/out/plans/omo-summary-plan.md (keep the template header verbatim), run a structure self-check, then deliver.
