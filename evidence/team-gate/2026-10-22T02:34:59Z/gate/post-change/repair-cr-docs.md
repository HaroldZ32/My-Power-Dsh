# Repair — CodeRabbit doc findings F-CR1 / F-CR6 (PR #59)

Task: T8 (repair), owner docs-writer, 2026-10-22. Documentation only; no source file touched.

## F-CR1 — goal-objective fallback

**Finding.** `AGENTS.md` §1 named the approval-anchored goal objective as "the plan description"
without the missing fallback.

**Implemented behaviour (verified against the shipped tree).** `objective = plan.description ||
plan.name`: `packages/mpd-team-core-plugin/src/index.ts` computes
`const objective = plan.description !== "" ? plan.description : plan.name`, and
`packages/mpd-team-core-plugin/README.md` already prints `(objective `plan.description || plan.name`,
source `team`)`.

**Fix.** `AGENTS.md` §1 (gate bullet) now reads: "anchors a persisted goal (objective = the plan
description, falling back to the plan NAME when the description is empty, source `team`)". The same
fallback is mirrored in the two human-facing places that describe the objective:
`docs/user-guide.md` §6 ("falling back to the plan NAME when the description is empty") and
`docs/user-guide.zh-CN.md` §6 ("描述为空时回退到计划名称").

## F-CR6 — workmate zh README row untranslated

**Finding.** `packages/mpd-workmate-plugin/README.zh-CN.md` line 58 carried the English one-shot
description verbatim.

**Fix.** The row is now a faithful 简体中文 translation: 一次性（ONE-SHOT）单次咨询；以 workmate 的
人设 + 记忆 + 说明卡执行一次有界委派；走它自己的模型路由；只读 base 会禁止写入类工具；报告落定后
activation 即被释放；持久连续性保存在 workmate **记录**中，而不是子会话. The English sibling
README (`README.md`) is unchanged.

## Gates (observed, not claimed)

- `bun run verify:docs` → **exit 0**;
  `[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=49 failed=0 violations=0 exempt=24 derived=3 links=440 dead=0 — PASS`
- `node scripts/verify-manual-paths.ts` → **exit 0**;
  `[verify-manual-paths] PASS resolved=151 over-report=73 under-report=75 declared=2 (every audited path exists; the DECLARED anticipatory class is named with its reason and counted apart; the two matcher-error directions above are reported, not merged)`
- `wc -c AGENTS.md` → **59676 B**; cap **63488 B** (65536 − 2048): **margin 3812 B**,
  **5860 B** below the hard 65536 cut.

## Not touched

No `packages/**/src`, no `skills/**`, no `cordis.patch.yml`, no `scripts/**`; no git write command.
