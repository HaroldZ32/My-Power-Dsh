# omo-summary-plan - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->

**What you'll get:** 为 omo-dsh 仓库新增一个自研技能 omo-summary：一份 SKILL.md（含 name/description 头信息与 5 条使用规则），外加一个 dsh-qa 隔离加载用例（带离线自测），把"任务/会话结束后输出结构化总结"变成 agent 的一个正式技能。执行完，技能会被 DSH 自动发现并可在真实会话中加载。

**Why this approach:** 上游 oh-my-openagent（锁定 commit 与 dev 分支）都没有 omo-summary，所以这是自研新技能而非 vendor；仓库的技能目录已被 bundle 整体挂载（customSkillDirs），新技能放进 `packages/omo-skills-plugin/skills/` 即可零配置生效，并用仓库既有的 dsh-qa 纪律（隔离 + 证据落盘）验证，不改任何锁定资产。

**What it will NOT do:** 不会改 VENDOR_LOCK.json / bundle 配置 / 任何 vendor 技能；不会新增任何 TS 源码或插件代码；不碰金标样例区；规划者（Prometheus）不会创建 SKILL.md 本身——SKILL.md 由执行计划的 worker 会话创建。

**Effort:** Short
**Risk:** Low - 纯新增资产 + 一个 QA 脚本，无既有代码/配置改动面
**Decisions to sanity-check:** omo-summary 语义默认=任务/会话总结（五节结构）；输出路径按指令钉在 tests/golden/out/plans/omo-summary-plan.md（覆盖 ulw-plan 默认 .omo/plans/）。

Your next move: 批准本计划后由 worker 会话（`$ulw-execute omo-summary-plan`）执行。完整执行细节见下文。

---

> TL;DR (machine): Short effort, Low risk; 4 implementation todos + 4 final-verifier tasks; delivers SKILL.md + dsh-qa case + evidence, all additive.

## Scope
### Must have
- `packages/omo-skills-plugin/skills/omo-summary/SKILL.md`：YAML frontmatter（`name: omo-summary` + `description`）+ 正文恰含 **5 条编号使用规则**，措辞 DSH 原生（无 OpenCode-only 工具引用）。
- `skills/dsh-qa/scripts/skill-summary-load.mjs`：dsh-qa 新用例，`--self-test` 离线自测 + 隔离 DSH_HOME 真实 boot，断言 omo-summary 目录可见且内容可加载，证据落盘 `evidence/dsh-qa/skill-summary-load/<ts>/`。
- `skills/dsh-qa/SKILL.md` 用例集表格登记新行 `skill-summary-load`。
- 门禁执行：根 `bun test`、根 `bun run typecheck`（tsgo --noEmit）、新 QA 用例真实跑、`git status` 差异核对，结果与证据入库。

### Must NOT have (guardrails, anti-slop, scope boundaries)
- 规划者（本计划阶段）绝不创建 SKILL.md 或任何产品文件；只产出计划文件与 `.omo/drafts/` 草案。
- 不改 `VENDOR_LOCK.json`（omo-summary 非 vendor 资产；verify-vendor.mjs 只校验 lock.assets）。
- 不改 `packages/omo-dsh-bundle/cordis.patch.yml`（customSkillDirs 已覆盖整个 skills 目录，零 bundle 改动）。
- 不改/不升级任何已 vendor 技能（ulw-plan/init-deep/lsp-setup/git-master/review-work/programming/ast-grep）与上游仓库。
- 不新增任何 TS 源码、插件代码或 package.json 依赖；唯一新脚本是 dsh-qa 的 mjs 用例。
- 不写 `tests/golden/fixtures/`（金标样例区只读）；不创建 `.omo/plans/` 下的重复计划（规范路径由用户钉死）。
- 不做语义扩展（如多语言翻译、模板文件、web UI 集成）。

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after + dedicated QA case（仓库惯例：纯资产改动视同代码改动走 dsh-qa，PLAN.md §5 T7）；无新 TS → bun test/tsgo 零增量（root tsconfig.json:16-18 仅 include packages/*/src/**/*.ts）。
- Evidence: `evidence/dsh-qa/skill-summary-load/<ISO-ts>/result.json` + `output.log`（对齐 skills/dsh-qa/SKILL.md 铁律 3；T6 证据唯一规范路径 evidence/<域名>/<slug>/）。
- 隔离纪律（T4）：QA 脚本强制 `DSH_HOME=$(mktemp -d)` 并在脚本内断言 `env.DSH_HOME === sandbox`，绝不读写用户真实 `~/.dsh`（范本 skills/dsh-qa/scripts/skill-load.mjs:20-27：沙盒创建 :23、DSH_HOME 注入 :26、隔离断言 :27）。
- 可证明性（T5）：真实 run 断言 dsh 输出含 `omo-summary` 与至少一条使用规则文本，不允许只报"能跑通"。

## Execution strategy
### Parallel execution waves
> 目标 5-8 todos/波；本任务标准级（1-5 文件），2 个执行波 + 收尾波。
- **Wave 1**（并行）：Todo 1（SKILL.md 内容）+ Todo 2（QA 脚本）——互相独立。
- **Wave 2**：Todo 3（dsh-qa 用例登记，依赖 1、2 的命名与断言文本）。
- **Wave 3**（收尾）：Todo 4（门禁全跑 + 证据 + git 核对，依赖 1-3）。

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
- [ ] 1. 在 omo-skills-plugin 内创建自研技能 omo-summary 的 SKILL.md（内容规格内嵌，零判断）
  What to do / Must NOT do: 创建文件 `packages/omo-skills-plugin/skills/omo-summary/SKILL.md`，内容必须与下方"精确内容规格"逐字一致（仅 `description` 引号内与规则编号 1-5 文本允许原样抄录；不得增删规则条数）。Must NOT: 不创建同目录任何其他文件；不加 `metadata` 之外的新 frontmatter 键（`metadata.short-description` 可选但推荐）；正文不得出现 `task(`、`call_omo_agent`、`multi_agent`、`team_`、`background_output` 等 OpenCode/Codex 专用工具串；不改动任何既有技能文件。
  Parallelization: Wave 1 | Blocked by: 无 | Blocks: 3
  References: 目录语义 packages/omo-dsh-bundle/cordis.patch.yml:42-49（skill-filesystem 段，customSkillDirs 覆盖整个 skills 目录，新子目录自动发现）；frontmatter 风格范本 packages/omo-skills-plugin/skills/ast-grep/SKILL.md:1-4 与 packages/omo-skills-plugin/skills/review-work/SKILL.md:1-4；metadata 范本 packages/omo-skills-plugin/skills/ulw-plan/SKILL.md:1-6（frontmatter 含 metadata.short-description，:4-5）。
  Acceptance criteria (agent-executable): `test -f packages/omo-skills-plugin/skills/omo-summary/SKILL.md` 且文件 frontmatter 可解析出 `name: omo-summary` 与非空 `description`；正文含恰 5 条编号 `1.`-`5.` 使用规则；`grep -E 'task\(|call_omo_agent|multi_agent|team_|background_output' <file>` 无匹配；运行 Todo 2 的 `--self-test`（其离线 fixture 覆盖 frontmatter/规则标记检测）exit 0。
  QA scenarios (name the exact tool + invocation): happy（离线）= `node skills/dsh-qa/scripts/skill-summary-load.mjs --self-test` → exit 0，输出含 `ok: frontmatter/rule markers detected`；happy（真实）= Todo 2 真实 run 的 ok=true（见 Todo 2）；failure（离线）= `--self-test` 的负向 fixture（无 `name: omo-summary` 的字符串）必须被检测为"未加载"，检测失效则 exit 1。Evidence `evidence/dsh-qa/skill-summary-load/<ts>/result.json`、`output.log`（由 Todo 2 脚本写入）。
  Commit: Y | 并入最终提交（见 Commit strategy），不单独提交
  Recommended task executor category: writing — 纯 markdown 文案创作，内容规格已内嵌，无判断空间

  **精确内容规格（原样抄录）：**
  ```markdown
  ---
  name: omo-summary
  description: "Produce a structured summary of completed work in omo-dsh: goal, what was done, result with evidence, risks and leftovers, next steps. Trigger on 'summary' / '总结' / 'summarize' / 'wrap up' / '写个总结' / end-of-task reports. Output follows the repo evidence/qa-summary convention: 5 short sections, repo-relative paths, one screen of plain text. Never invent facts missing from the session or evidence; mark them explicitly. Must NOT modify product code."
  metadata:
    short-description: Structured end-of-task summary writer (goal / done / evidence / risks / next)
  ---

  # omo-summary

  任务/会话总结技能：对已完成的工作输出结构化总结，供交接、证据归档与后续决策使用。
  仅做只读总结，绝不修改产品代码。

  ## 使用规则

  1. **证据先行**：只总结会话内容、`evidence/<域名>/<slug>/` 与 git 历史中可引用的事实；
     未出现的结论必须显式标注"无证据"，禁止编造。
  2. **固定结构**：按「目标 / 做了什么 / 结果与证据 / 风险与遗留 / 下一步」五节输出，
     每节 1-3 行，总长不超过一屏。
  3. **路径引用**：涉及文件、证据、产物一律给仓库内相对路径（如
     `evidence/dsh-qa/skill-summary-load/…`）；给不出路径的断言一律视为无证据。
  4. **语言跟随**：用户中文→中文输出，英文→英文输出；专业术语保持原文不译。
  5. **边界**：总结是只读行为——不修改产品代码、不写证据目录以外的文件；
     总结落盘位置以用户指定为准。
  ```

- [ ] 2. 新增 dsh-qa 隔离加载用例 skill-summary-load.mjs（含 --self-test 与 happy/failure 断言）
  What to do / Must NOT do: 创建 `skills/dsh-qa/scripts/skill-summary-load.mjs`，以 `skills/dsh-qa/scripts/skill-load.mjs` 为范本改写：`JOB = "请先使用 skill 工具加载名为 omo-summary 的技能，然后引用它的名称与任意一条使用规则。不要使用 bash 等其他工具。"`；真实 run 用 `mktemp -d` 沙盒 DSH_HOME、拷贝 `~/.dsh/.credentials.yaml`、`spawnSync("dsh", ["--profile", "headless", "--patch", <repoRoot>/packages/omo-dsh-bundle/cordis.patch.yml, JOB])`，ok 条件 = `exit 0 && /omo-summary/ && /使用规则/`（输出中须含规则 1-5 任一标记文本）；证据写 `evidence/dsh-qa/skill-summary-load/<ISO-ts 无冒号>/result.json` + `output.log`；脚本内置 `--self-test`（离线）：正例 fixture（含 `name: omo-summary` 与 `使用规则` 标记）检测通过，负例 fixture（不含上述标记）必须判负。Must NOT: 修改既有 5 个 QA 脚本（mount-assert/skill-load/mcp-call/preset-register/dual-track-smoke）；不访问真实 `~/.dsh` 的读写（只读拷贝凭据）；不开网络依赖。
  Parallelization: Wave 1 | Blocked by: 无 | Blocks: 3
  References: 范本 skills/dsh-qa/scripts/skill-load.mjs（全文 45 行：--self-test :14-18、runReal 隔离 boot :20-43、沙盒创建 :23、隔离断言 :27、spawnSync --patch bundle :28-30、证据写盘 :36-37、入口分发 :44）；铁律 skills/dsh-qa/SKILL.md:13-20（隔离/可证明性/证据/--self-test 四条）；bundle patch 路径 packages/omo-dsh-bundle/cordis.patch.yml（--patch 挂载，同 skill-load.mjs:28 用法）。
  Acceptance criteria (agent-executable): `node skills/dsh-qa/scripts/skill-summary-load.mjs --self-test` exit 0；真实 run（见 QA）exit 0 且 `result.json` 中 `ok=true`；`result.json` 与 `output.log` 存在于 `evidence/dsh-qa/skill-summary-load/<ts>/`；脚本内含 `DSH_HOME` 隔离断言（`env.DSH_HOME === sandbox` 否则 exit 1）。
  QA scenarios: happy（离线）= `--self-test` exit 0；happy（真实，含 API 调用）=
  `node skills/dsh-qa/scripts/skill-summary-load.mjs` → ok=true，输出含 `skill-summary-load] PASS`，证据文件落盘；failure（离线）= `--self-test` 负例 fixture 检测失败时 exit 1（自测即失败路径证据）；failure（真实）=
  临时把 `JOB` 里的技能名改为不存在的 `omo-summary-absent` 再跑 → 脚本必须 ok=false exit 1 且 result.json 记录 `skillLoaded:false`（跑完改回原名并重跑 ok=true 留证）。Evidence `evidence/dsh-qa/skill-summary-load/<ts>/`（含上述 ok=true 与 ok=false 两轮）。
  Commit: Y | 并入最终提交
  Recommended task executor category: quick — 单文件机械改写，有现成范本与固定断言模板

- [ ] 3. 在 dsh-qa 用例集表格登记 skill-summary-load 行
  What to do / Must NOT do: 在 `skills/dsh-qa/SKILL.md` 的"用例集（随阶段扩充）"表格（当前为 mount-assert/llm-dual-track/skill-load/mcp-call/preset-register 五行）末尾追加一行：
  `| skill-summary-load | 技能 | omo-summary 目录可见 + 加载内容完整（隔离 boot 断言） | P2+（G5） |`
  Must NOT: 改写/删除既有行；不动 `skills/dsh-qa/SKILL.md` 其他章节；不动 `packages/omo-skills-plugin/README.md`（骨架占位，无技能清单）。
  Parallelization: Wave 2 | Blocked by: 1, 2 | Blocks: 4
  References: 表格位置 skills/dsh-qa/SKILL.md:22-30（用例集表头 :24-25，既有五行 :26-30）；运行章节 skills/dsh-qa/SKILL.md:32-40。
  Acceptance criteria (agent-executable): `grep -n 'skill-summary-load' skills/dsh-qa/SKILL.md` 恰命中 1 行（新行），且既有 5 行原样保留（`grep -c '^| mount-assert'` 等计数不变）。
  QA scenarios: happy = 上述 grep 断言通过；failure = 无（文档行）；回归核对 = `git diff skills/dsh-qa/SKILL.md` 仅含新增行。Evidence `evidence/dsh-qa/skill-summary-load/<ts>/result.json` 备注字段记录 diff 行数。
  Commit: Y | 并入最终提交
  Recommended task executor category: quick — 表格单行追加，机械操作

- [ ] 4. 门禁全跑与证据核对（bun test / tsgo / QA 真实 run / git status）
  What to do / Must NOT do: 依次执行并记录：① `bun test`（根，应无失败；本改动无新 TS，bun 无测试文件时 exit 0）；② `bun run typecheck`（root tsgo --noEmit，应 exit 0——root tsconfig 仅 include `packages/*/src/**/*.ts`，本改动零增量）；③ `node skills/dsh-qa/scripts/skill-summary-load.mjs`（真实隔离 run，ok=true）；④ `node skills/dsh-qa/scripts/skill-summary-load.mjs --self-test`（exit 0）；⑤ `git status --porcelain` 核对：预期仅
  `packages/omo-skills-plugin/skills/omo-summary/SKILL.md`（新）、`skills/dsh-qa/scripts/skill-summary-load.mjs`（新）、`skills/dsh-qa/SKILL.md`（改）、`evidence/dsh-qa/skill-summary-load/`（新证据），外加 `.omo/drafts/`（规划产物，可忽略）；出现任何其他路径 → 停下核对排除。⑥ 将 ①-④ 输出追加写入 `evidence/dsh-qa/skill-summary-load/<ts>/gates.log`。Must NOT: 触碰真实 `~/.dsh`；不修改 `VENDOR_LOCK.json`；不提交 `/tmp` 或沙盒外文件；不因"能跑通"替代 ③ 的断言结果。
  Parallelization: Wave 3 | Blocked by: 1, 2, 3 | Blocks: 无（收尾）
  References: 门禁 AGENTS.md 规则 3-4；根脚本 package.json:8-11（test:9 / typecheck:8 / test:qa:11）；tsconfig include 范围 tsconfig.json:13-14；证据路径约定 PLAN.md §5 T6（evidence/<域名>/<slug>/）。
  Acceptance criteria (agent-executable): ①-④ 全部 exit 0；③ 的 result.json ok=true 且两文件落盘；⑤ 差异集合与预期完全一致（超集即失败）；⑥ gates.log 存在。
  QA scenarios: happy = 全命令 exit 0 + 证据齐全 + diff 精确匹配（把 `git status --porcelain` 输出存 evidence 副本）；failure = 任一命令非 0 或 diff 超集 → 记录失败输出到 gates.log，修复后重跑全链直至全绿（两轮都留证）；隔离失败路径 = 若脚本断言到 DSH_HOME 非沙盒，立即 exit 1 且不写证据。Evidence `evidence/dsh-qa/skill-summary-load/<ts>/gates.log` + `result.json` + `output.log`。
  Commit: Y | 最终提交（见 Commit strategy）
  Recommended task executor category: quick — 命令序列机械执行 + 记录

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
- [ ] F3. Real manual QA
- [ ] F4. Scope fidelity

## Commit strategy
- 单提交收尾（匹配仓库按阶段/功能单提交惯例，git log 全为一行描述式提交）：
  `feat(skills): 自研 omo-summary 技能（SKILL.md + dsh-qa skill-summary-load 用例与证据）`
- 提交内容：`packages/omo-skills-plugin/skills/omo-summary/`、`skills/dsh-qa/scripts/skill-summary-load.mjs`、`skills/dsh-qa/SKILL.md`、`evidence/dsh-qa/skill-summary-load/`。
- 不提交：`.omo/drafts/`（规划产物）、`/tmp` 沙盒、任何 `VENDOR_LOCK.json`/bundle/上游改动（必须为零）。
- 提交前跑 `git status` 确认上述白名单精确成立（AGENTS.md 规则 1、6）。

## Success criteria
1. `packages/omo-skills-plugin/skills/omo-summary/SKILL.md` 存在，frontmatter 含 `name: omo-summary` + 非空 `description`，正文恰 5 条编号使用规则，无 OpenCode-only 工具串。
2. `node skills/dsh-qa/scripts/skill-summary-load.mjs --self-test` exit 0（正/负 fixture 双断言）。
3. 真实隔离 run ok=true，证据 `evidence/dsh-qa/skill-summary-load/<ts>/result.json` + `output.log` 落盘，`skillLoaded:true`。
4. `skills/dsh-qa/SKILL.md` 用例集表格含 skill-summary-load 行，既有行零改动。
5. 根 `bun test` 与 `bun run typecheck` exit 0；`git status --porcelain` 与预期白名单精确一致。
6. 提交为单条 feat 提交；`VENDOR_LOCK.json`、`cordis.patch.yml`、vendor 技能、上游零改动（`git diff` 验证）。
