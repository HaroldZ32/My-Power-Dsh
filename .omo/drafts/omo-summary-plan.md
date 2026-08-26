---
slug: omo-summary-plan
status: plan-written
intent: clear
review_required: false
plan_path: tests/golden/out/plans/omo-summary-plan.md
pending-action: none（计划已写入；执行由 worker 会话 `$ulw-execute omo-summary-plan` 进行，规划者不执行）
approach: 计划在 omo-skills-plugin 内自研 omo-summary 技能（SKILL.md：name/description frontmatter + 5 条使用规则，DSH 原生措辞），配套 dsh-qa 隔离加载用例与证据落盘；不改 VENDOR_LOCK/bundle/上游资产；执行者创建 SKILL.md，规划者永不创建。
---

# Draft: omo-summary-plan

## Components (topology ledger)
| id | outcome (one line) | status | evidence path |
|---|---|---|---|
| C1 | packages/omo-skills-plugin/skills/omo-summary/SKILL.md 存在且 frontmatter/规则合规 | active | evidence/dsh-qa/skill-summary-load/<ts>/result.json |
| C2 | skills/dsh-qa/scripts/skill-summary-load.mjs 存在且 --self-test PASS | active | 同上 |
| C3 | dsh-qa SKILL.md 用例集表格登记新用例 | active | packages/omo-skills-plugin/skills/ulw-plan 之外：skills/dsh-qa/SKILL.md |
| C4 | 隔离 DSH_HOME boot 断言 omo-summary 可加载（happy+failure） | active | evidence/dsh-qa/skill-summary-load/<ts>/output.log |

## Open assumptions (announced defaults)
| assumption | adopted default | rationale | reversible? |
|---|---|---|---|
| omo-summary 的语义内容 | 任务/会话总结技能：对已完成工作输出结构化总结（目标/做了什么/结果与证据/风险与遗留/下一步），措辞 DSH 原生、引用仓库相对路径 | 上游锁定 commit 8c57e463 与 dev 均无 omo-summary（API tree 检索）；"summary"+仓库 evidence/qa-summary 惯例构成可辩护默认；金标只钉形态不钉语义 | 是（纯文案，可随时改写） |
| 计划文件位置 | tests/golden/out/plans/omo-summary-plan.md（用户显式钉死；覆盖 ulw-plan 默认 .omo/plans/） | 用户指令优先于技能默认路径 | 是 |
| 不触碰 VENDOR_LOCK/bundle | 自研技能非 vendor 资产；customSkillDirs 已指向整个 skills 目录，新子目录自动发现 | cordis.patch.yml:customSkillDirs + verify-vendor.mjs 只遍历 lock.assets | 否（碰即错） |
| 门禁范围 | 纯 markdown/脚本改动：bun test 不受影响（无新 TS）；tsgo 不受影响（root tsconfig 仅 include packages/*/src）；QA=新 dsh-qa 用例 | AGENTS.md 门禁 + root tsconfig include 范围 | 是 |

## Findings (cited - path:lines)
- F1 技能即目录：7 个技能均为 packages/omo-skills-plugin/skills/<name>/SKILL.md；bundle 以 skill-filesystem customSkillDirs 指向整个 skills 目录 → 新增子目录自动被发现，无需 bundle 改动（packages/omo-dsh-bundle/cordis.patch.yml:41-48；P2 提交 f8386d4 "vendor 7 个 omo skills … skill-filesystem(customSkillDirs)"）。
- F2 上游无 omo-summary：GitHub API 列 packages/shared-skills/skills（锁定 commit 8c57e463 与 dev 分支）均无 summary 技能；全树 9127 blob 检索仅 evidence/qa-summary.md 类文件与 .github/scripts/write-job-summary.sh → 自研而非 vendor（VENDOR_LOCK.json 无此资产，verify-vendor.mjs:49-70 只校验 lock.assets）。
- F3 SKILL.md 形态：YAML frontmatter name + description（触发词风格见 ast-grep/review-work），可选 metadata.short-description（init-deep）；正文即使用说明（packages/omo-skills-plugin/skills/*/SKILL.md）。
- F4 QA 惯例：skills/dsh-qa/SKILL.md 用例集表格（mount-assert/llm-dual-track/skill-load/mcp-call/preset-register）；脚本必须隔离 DSH_HOME（mktemp -d）+ 断言隔离 + --self-test + 证据落盘 evidence/<domain>/<slug>/<ts>/（T4/T6/T7，PLAN.md §5；skill-load.mjs 为范本）。
- F5 门禁影响面：root tsconfig include 仅 packages/*/src/**/*.ts（tsconfig.json:16-18）；omo-skills-plugin 无 src/ 无测试 → 纯资产改动不触发 bun test/tsgo 增量，QA 走 dsh-qa 用例（AGENTS.md 门禁 3-4；PLAN.md §5 T7 "提示词/资产改动视同代码改动"）。
- F6 输出区：tests/golden/out/plans/ 尚不存在，写计划时创建（tests/ 结构见 git log 69fa9d9 "金标 fixtures"；tests/golden/fixtures 为任务样例区，不动）。

## Decisions (with rationale)
- D1 落点 packages/omo-skills-plugin/skills/omo-summary/SKILL.md：与 7 个既有技能同构、自动被发现、满足插件形态铁律（AGENTS.md #2）。
- D2 内容规格内嵌进计划 Todo 1（精确 frontmatter 文本 + 5 条使用规则），执行者零判断。
- D3 QA 用新脚本 skill-summary-load.mjs（不改 skill-load.mjs，避免回归 P2 既有断言），用例 slug 登记进 dsh-qa 表格。
- D4 提交策略：单提交（匹配仓库按阶段单提交惯例，git log 全为单行阶段提交）。

## Scope IN
- C1 SKILL.md（frontmatter name/description + 5 条使用规则，DSH 原生措辞）
- C2 dsh-qa 新用例脚本（--self-test + 隔离 boot + happy/failure 断言 + 证据）
- C3 dsh-qa SKILL.md 用例集表格登记一行
- C4 门禁执行与证据落盘（bun test / tsgo / QA 用例 / git status 核对）

## Scope OUT (Must NOT have)
- 规划阶段绝不创建 SKILL.md 或任何产品文件（本计划只写计划文件与 .omo/drafts）
- 不改 VENDOR_LOCK.json（非 vendor 资产）
- 不改 packages/omo-dsh-bundle/cordis.patch.yml（发现无需 bundle 改动）
- 不改/不升级任何 vendor 技能、不碰上游
- 不新增任何 TS 源码/插件代码（纯 markdown + 一个 mjs QA 脚本）
- 不写 tests/golden/fixtures（金标样例区只读）

## Open questions
无（意图清晰；唯一语义分叉已用默认解决并在本台账记录，用户可在批准时否决）。

## Approval gate
status: awaiting-approval
- 用户指令已完整钉死交付物形态、模板与输出路径（tests/golden/out/plans/omo-summary-plan.md），
  按金标单轮语义视为对撰写计划的明确批准；如需否决默认（omo-summary 语义/路径），在批准时说明。
- 批准后动作：写 tests/golden/out/plans/omo-summary-plan.md（模板头逐字保留），执行结构自检后交付。
