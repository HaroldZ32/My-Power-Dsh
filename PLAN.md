# omo-dsh 移植实施计划

> 将 oh-my-openagent 的可移植能力，以 DeepSeek Harness（DSH）第三方 bundle 的形式接入，
> DeepSeek 官方 API 为主轨，实现"DeepSeek 全家桶化"。
>
> 状态：草稿 v1（待确认后进入 P0）　日期：2026-08-26

---

## 1. 目标与范围

### 1.1 背景结论（来自架构侦察）

1. omo 已完成"多宿主适配器"分层：19 个 Core 纯 TS 包 + stdio MCP + SKILL.md 技能全部宿主无关，可直接复用；
   宿主耦合集中在 omo-opencode（2787 文件/16MB）、omo-codex、omo-senpi 三个适配器。
2. DSH 扩展缝与 omo 能力一一对应：tools 管线（pre/execute/post + guard）、skills、persona/preset、
   subagent（支持 per-child persona/model/结构化输出/工具过滤）、goal/ralph/workflow、jobs、
   dsh-mcp-client、dsh-agent-instructions（AGENTS.md 注入）、compaction、storage、Web GUI。
3. DSH 已内置 DeepSeek 官方 API 适配器（dsh-llm-deepseek，默认模型 deepseek-v4-flash/pro）；
   omo 自身回退链也已有 deepseek-v4-flash 条目；DSH 的 dsh-llm-pi-ai 与 omo Senpi 版同源（pi-ai）。
4. 最大风险不在接线，而在 prompt/行为层对 DeepSeek thinking 格式的适配验证。

### 1.2 移植目标定义（本次计划的对象）

> 新建独立本地仓库 omo-dsh，交付一个可被 DSH profile 加载的 bundle 包：
> - 复用 omo 的 skills / MCP / agent 提示词资产；
> - 全部 agent 路由到 DeepSeek 官方 API（deepseek-official），pi-ai 的 deepseek 路由作为双轨兼容；
> - 首个里程碑（Track A）以最小可用闭环为界，深移植（Team Mode/ultrawork）作为后续 B 线。

### 1.3 成功标准（可测量）

| # | 标准 | 量测方式 |
|---|---|---|
| S1 | omo-dsh 仓库可复现构建出 DSH bundle | 干净目录执行 bootstrap 脚本 → dsh --dump-config 通过 |
| S2 | DeepSeek 官方路由在 headless 与 web 均可用（thinking + tool call） | dsh --profile omo-headless 冒烟 + 本 GUI 手测 |
| S3 | ≥3 个 omo skills、≥2 个 MCP、≥3 个 agent 预设跑通 | 工具/skill 目录 + 真实调用证据 |
| S4 | 金标任务通过率 ≥ 80%（含 ≥2 个硬件代码任务） | 评分 rubric 落盘 |
| S5 | 原仓库零改动、零推送；所有改动仅在 omo-dsh 新仓库 | git status 验证 + remote 检查 |
| S6 | 许可证与第三方声明合规 | LICENSE-NOTICES.md |

### 1.4 范围

**In scope（Track A）**：bundle/包结构、DeepSeek 双轨、skills 子集、MCP（ast-grep/git-bash 优先，lsp 视网络决策）、
首批 agent 预设（oracle/librarian/prometheus）+ Hephaestus 原生化最小版、行为验证与提示词迭代。

**Out of scope（明确不做）**：修改 omo 原仓库源码；移植 opencode TUI/安装器/opencode 专属钩子（tui-sidebar、
zauc-mocks、claude-code-*-loader、opengateway-provider 等）；对外发布/商用分发；B 线深移植（见 4.7）。

---

## 2. 基线、环境与硬约束

| 项 | 值 |
|---|---|
| omo 基线 | 检出 HEAD 8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29（2026-08-26），package 5.0.0-beta.20；历史快照 f3642fcd 仅供参考 |
| DSH 基线 | @deepseek-ai/dsh 0.1.1-rc.2，安装于 ~/.nvm/versions/node/v24.19.0/lib/node_modules/@deepseek-ai/dsh |
| DSH 宿主 | ~/.dsh（web profile 已含 base + web-app + dshmarket + @linxin666/dsh-web-all + nowledge-mem） |
| 工具链 | bun 1.4.0 / node v24.19.0 / pnpm / git（均可用） |
| 网络约束 | 直连 GitHub 会挂起 → 依赖安装用 bun install --ignore-scripts；omo 构建用 OMO_SKIP_MATERIALIZE=1；尽量复用已装 node_modules |
| 流程硬约束 | ① 所有改动进新建本地仓库（本仓库），严禁推送原仓库；② 每阶段 QA 证据落盘 evidence/；③ omo 源码只读，仅做 vendor 拷贝 |

---

## 3. 仓库与加载机制

### 3.1 仓库位置与隔离

仓库位于原 omo 检出的 .omo/port/omo-dsh/——原仓库 .gitignore 已忽略 .omo/*，
因此原仓库 git 状态保持完全干净，同时新仓库有独立 git 历史。

### 3.2 目录结构（P0 落地）

    omo-dsh/
    ├── PLAN.md                  # 本文件
    ├── README.md
    ├── LICENSE-NOTICES.md       # SUL-1.0 合规声明 + 第三方 notice
    ├── VENDOR_LOCK.json         # 锁定 omo commit sha + 文件数/loc 校验值
    ├── packages/
    │   └── omo-dsh/             # 唯一 npm 包 = DSH bundle
    │       ├── package.json     # 声明 "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
    │       ├── cordis.patch.yml # 插件条目：llm 双轨、mcp-client×N、技能 provider、自研插件
    │       ├── skills/          # 从 omo shared-skills vendor 的子集
    │       ├── presets/         # agent-presets/omo/*.yml（persona+prompt+tool 集）
    │       └── lib/             # 自研 cordis 插件（P4+）
    ├── profiles/
    │   ├── omo/                 # web 版 profile 模板（package.json + dsh.profile + cordis.patch.yml）
    │   └── omo-headless/        # CI 冒烟 profile 模板
    ├── scripts/                 # bootstrap / build / smoke / evidence 脚本
    ├── tests/                   # 金标任务集 + rubric + 适配日志
    └── evidence/                # 每阶段 QA 证据（与 .omo/evidence 同纪律）

### 3.3 加载机制（已核实 DSH 文档）

- bundle = npm 包，package.json 声明 "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }；
- profile = $DSH_HOME/profiles/<name>/，含 package.json（dsh.profile.bundles 有序列表）+ cordis.patch.yml；
- bundle 解析两锚：先 DSH 安装目录，再 profile 的 node_modules（dsh plugin --profile omo <pnpm args> 管理）；
- 每个 cordis.patch.yml 是 patch 层（id 级 config 覆盖为整段替换，非深合并）；
- 校验：dsh --dump-default-config / dsh --dump-config。

---

## 4. 阶段规划

### 4.1 P0 仓库与基线（预估 0.5–1 人日）

**目标**：新仓库可用、基线锁定、合规声明齐备。

**任务**
1. git init + 首提交；写入 README / PLAN / LICENSE-NOTICES（SUL-1.0：内部使用与修改允许，分发限免费非商用，保留全部 notice）。
2. 生成 VENDOR_LOCK.json：记录 omo commit sha、find packages -type f | wc -l、wc -l 校验值。
3. vendor 拷贝策略定稿：skills 子集 +（后续阶段按需）core 包源码；拷贝后跑校验脚本比对文件数/行数。
4. 建 scripts/bootstrap.mjs：从零在干净环境复现 bundle 构建（S1 的量测工具）。

**验收**：① 原仓库 git status 无任何变化；② 新仓库首提交完成；③ bootstrap 脚本在干净目录跑通（可先 stub）。

**证据**：evidence/p0/git-status-clean.txt、VENDOR_LOCK.json。

### 4.2 P1 DSH Profile 与 DeepSeek 双轨（1–2 人日）【Track A 第一步】

**目标**：DeepSeek 官方 API 在 DSH 内跑通 headless，pi-ai 轨并存可切换。

**任务**
1. 创建 profiles/omo-headless 模板（bundles: base + headless + omo-dsh）；profiles/omo（bundles: base + web-app + omo-dsh，UI 三方 bundle 由用户按需并入）。
2. bundle 的 cordis.patch.yml 挂载：
   - dsh-llm-deepseek：apiKeyEnv: DEEPSEEK_API_KEY、thinking: enabled、reasoningEffort: high；
   - dsh-llm-pi-ai：deepseek 目录路由（双轨并存，主轨=官方）。
3. 冒烟：dsh --profile omo-headless "用工具列出当前目录并回答 ok"，断言 tool call + thinking + token-meter。
4. 双轨对比：同一任务在 deepseek-official 与 pi-ai deepseek 各跑一次，记录延迟/格式/工具调用成功率。

**验收**：① 两条路由 headless 均完成任务；② --dump-config 无警告；③ 对比数据落盘。

**证据**：evidence/p1/smoke-*.log、evidence/p1/dual-track.md。

### 4.3 P2 Skills 移植（0.5–1 人日）

**目标**：omo 技能以 SKILL.md 原样进入 DSH 技能目录。

**任务**
1. 首批清单（建议）：ulw-plan、init-deep、lsp-setup、git-master、review-work、programming、ast-grep（各含 references 目录，保留相对路径语义）。
2. 校验 frontmatter 兼容：DSH 解析 name/description；metadata: 额外键的行为实测记录（若报错→剥离脚本）。
3. 通过 bundle 内 dsh-skill-filesystem 的 customSkillDirs 指向 packages/omo-dsh/skills；tool-skill 提供目录与加载。
4. 冒烟：技能目录可见、skill 工具加载一次内容完整。

**验收**：catalog 可见 + 加载正确 + 无 frontmatter 报错。

**证据**：evidence/p2/skill-catalog.txt、evidence/p2/load-sample.log。

### 4.4 P3 MCP 移植（1–2 人日）

**目标**：omo 的 stdio MCP 直接挂入 DSH。

**任务**
1. 优先序：ast-grep-mcp（对 Verilog/RTL 语法树工具价值最高）→ git-bash-mcp → lsp-tools-mcp+lsp-daemon（构建依赖 npm ci，无网风险，走决策 D2）。
2. 构建：前两者用 bun build（离线可行）；产物放 bundle 内并记录构建命令。
3. cordis.patch.yml 每服务器一行 dsh-mcp-client：transport: stdio、command: node、args: [dist/cli.js]、serverName 规范。
4. 冒烟：mcp__ast_grep__* / mcp__git_bash__* 出现在工具列表；对样例 Verilog 文件真实调用一次（含超时/重连行为记录）。

**验收**：工具可见 + 真实调用成功 + 失败重连有日志证据。

**证据**：evidence/p3/tool-list.txt、evidence/p3/verilog-sample-call.log。

### 4.5 P4 DeepSeek 预设与 agent 人格（2–4 人日）【含 Hephaestus 原生化起点】

**目标**：omo 首批 agent 以 DeepSeek 原生提示词在 DSH 落地。

**任务**
1. 首批 agent：oracle（审查，主模型 deepseek-v4-pro）、librarian（检索，v4-flash）、prometheus（规划，v4-pro）；
   从 omo builtin-agents prompt 源抽取身份段，删除 reasoning variant/multi-provider 措辞，改写为 DeepSeek thinking 语境。
2. preset 写法：agent-presets/omo/<agent>.yml（preset.yml + agent.cordis.yml 结构参照 DSH 内置 code/standard preset）：
   persona、agent-instructions、tool 集（bash/fs/skills/mcp/goal/subagent…）、tool-presentation 决策（native vs code）。
3. Hephaestus 原生化（最小版）：定义 omo-dsh 配置管理 agent——可读/改 profile 的 cordis.patch.yml、presets、模型路由、
   MCP 注册，产出 diff；DeepSeek 原生提示词；首轮只要求"读配置+解释"能力。
4. 每个预设 headless 过一道对应金标任务；建立 tests/prompt-adaptation-log.md（每次提示词改动记录原因/效果）。

**验收**：三预设 + Hephaestus 各通过 1 道金标任务；适配日志有 ≥2 次迭代记录。

**证据**：evidence/p4/preset-smoke-*.log、tests/prompt-adaptation-log.md。

### 4.6 P5 行为验证与调优（3–5 人日）

**目标**：Track A 完成定义全部达成。

**任务**
1. 金标任务集（≥8 道）：通用编码 3 道、硬件代码 2–3 道（RTL 模块+testbench、lint 清理、文档/波形说明）、工具使用 2 道。
2. 矩阵跑批：预设 × 任务；rubric（完成度 40% / 工具使用正确性 30% / 成本与时间 15% / 无越权与不诚实 15%）。
3. 提示词迭代 ≤3 轮/任务，全部记录；对失败任务做根因分类（prompt / 模型能力 / 工具接线）。
4. 输出 docs/track-a-report.md：通过率、成本汇总、遗留问题、B 线启动建议。

**验收**：S1–S6 全部达成（§1.3）。

**证据**：evidence/p5/ 全量批跑 + 报告。

### 4.7 B 线 backlog（Track A 验收后再启动，需重新排期）

| 编号 | 内容 | 预估 |
|---|---|---|
| B1 | 工具级钩子移植（write-existing-file-guard、edit-error-recovery、tool-output-truncator 等 → DSH tools/pre|post-execute + guard） | 1–2 周 |
| B2 | Team Mode 适配器：复用 team-core 领域原语，TeamSessionClient 换绑 DSH session/subagent | 2–4 周 |
| B3 | ulw-loop/ultrawork 循环纪律：在 goal-round-driver + schedule 上实现 omo 状态机 | 1–2 周 |
| B4 | memory-core / boulder-state / model-core 回退链插件化 | 按需 |

---

## 5. Track A 完成定义（DoD）

1. 干净目录执行 bootstrap → bundle 构建成功，dsh --dump-config 通过；
2. deepseek-official 在 headless 与 web 双端可用；pi-ai 双轨可切换并有对比证据；
3. ≥3 skills、≥2 MCP、≥3 预设 + Hephaestus 最小版全部跑通真实任务；
4. 金标通过率 ≥80%，全部证据在 evidence/；
5. 原仓库零改动、零推送，新仓库提交历史完整；
6. LICENSE-NOTICES 齐备，无违规分发。

---

## 6. 质量门禁

- 阶段门：上一阶段验收证据落盘前，不开下一阶段。
- 等价 QA 纪律：原项目的 opencode-qa 门禁只约束 omo-opencode 源码改动；本仓库不改 omo 源码，因此以
  "自研 cordis 插件测试 + headless 冒烟 + 证据落盘" 作为等价门禁，写入每个阶段的验收项。
- 回归：任何 bundle 改动后必须重跑 dsh --dump-config + 一次 headless 冒烟，结果追加到 evidence/。

---

## 7. 风险登记

| # | 风险 | 概率/影响 | 缓解 |
|---|---|---|---|
| R1 | omo prompt 对 DeepSeek 行为不适配（最大风险） | 高/高 | P5 专用迭代预算 + 适配日志 + 失败根因分类 |
| R2 | DeepSeek API 限流/计费失控 | 中/中 | 双轨切换 + 批跑预算上限 + 结果缓存 |
| R3 | 无网构建 lsp-daemon（npm ci） | 高/中 | 决策 D2：发布包 / 延迟 / 复用远端预构建 |
| R4 | omo 版本漂移（HEAD 8c57e46 ≠ 历史快照 f3642fc） | 高/中 | VENDOR_LOCK 锁定 + 校验脚本，不追新 |
| R5 | DSH rc 更新破坏 bundle 兼容 | 中/中 | 依赖版本固定 + --dump-config 回归 |
| R6 | SUL-1.0 许可限制 | 低/中 | 仅内部使用；notice 全保留；不对外发布 |
| R7 | 原仓库被污染/误推送 | 低/高 | 仓库放 .omo/port（已被忽略）；每阶段先 git status；不配 remote |

---

## 8. 待决决策（进入对应阶段前拍板）

| # | 决策 | 默认倾向 | 触发阶段 |
|---|---|---|---|
| D1 | profile 形态：独立 omo profile vs 直接改 web profile | 独立 omo profile，UI 三方 bundle 由用户按需并入 | P1 |
| D2 | lsp-daemon 构建策略（无网） | 若 npm ci 挂起 → 延迟 lsp 到 B 线，先交付 ast-grep+git-bash | P3 |
| D3 | 首批 agent 名单 | oracle + librarian + prometheus + hephaestus（最小版） | P4 |
| D4 | 双轨主轨 | 官方 deepseek-official 为主轨，pi-ai 为兼容轨 | P1 |
| D5 | 技能子集清单 | ulw-plan / init-deep / lsp-setup / git-master / review-work / programming / ast-grep | P2 |
| D6 | tool-presentation（native vs code mode） | 主 agent 用 code mode（run_code），轻量 agent 用 native | P4 |

---

## 9. 里程碑与工作量总表

| 阶段 | 内容 | 预估 | 退出条件 |
|---|---|---|---|
| P0 | 仓库与基线 | 0.5–1 人日 | 新仓库可复现、原仓库零改动 |
| P1 | Profile + DeepSeek 双轨 | 1–2 人日 | 官方 API headless 全通 |
| P2 | Skills | 0.5–1 人日 | 技能目录+加载验证 |
| P3 | MCP | 1–2 人日 | ast-grep/git-bash 真实调用成功 |
| P4 | 预设 + Hephaestus 最小版 | 2–4 人日 | 三预设各过 1 道金标 |
| P5 | 行为验证与调优 | 3–5 人日 | Track A DoD 全达成 |
| 合计 | | ≈ 8–15 人日 | |
| B2（最大件） | Team Mode 适配器 | 2–4 周 | 另行定义 |

---

## 10. 立即开始的第一批动作（P0 清单）

1. 本仓库 git init + 首提交（PLAN/README/LICENSE-NOTICES/VENDOR_LOCK 骨架）；
2. 确认 .omo/port/omo-dsh 不被原仓库跟踪（git status 干净）；
3. 写 VENDOR_LOCK.json 并跑通校验脚本；
4. 交付后等待用户确认 → 进入 P1（创建 profile、挂 DeepSeek 官方适配器、headless 冒烟）。
