# t8 — 技能门禁评分与决策表 (skills gate: scoring + decisions)

> ## ⚑ ADDENDUM (post-completion, executed under the captain's GO)
> 本文件在 **t8 完成之后**按队长 GO 追加**受控补记**：只更新 3 个阈值行 + 3 行叙述 + `git-master`/`frontend` 纳入 + 锚点重钉；`rulesSha256` 的原规则节**未改**。
> - **权威规则** = `evidence/omo-align/requirements/frozen-contract.json::t4Requirements.residualFieldGap (a)–(i)`：`26,013 B`（队长报）→ **磁盘实测（读取时）`31,705 B / sha256 `a0d28ebeaf3f204e4a33480670f44f204415b167…`（PARSE OK）** **最终阅读记录（按 `authorityNote` 要求记录读取时的 bytes+sha）**：`31,705 B / sha256 `a0d28ebeaf3f204e4a33480670f44f204415b16758999ce22309a99e3c9c2d65`，mtime 22:38:13，PARSE OK，16 顶层键 / `t4Requirements` 14 键`；队长最终广播给出的「权威三件套」（28,243 B / `a9dfb311…`）是**早一版**——两份的 `(a)(b)(g)`、`rowSet`、`binaryDependencyRule`（含 git-master FALSE 的 worked value）**逐字相同**，因此本表分数不受影响；§4 已按 (g) 登记唯一两处 advisory 差异。；本补记实现时读的是 28,243 B / `a9dfb311…`，两份的 `(a)(b)(g)` 与 `rowSet` 条款逐字相同，最新版另新增 `harnessSeamChangeRule` / `binaryDependencyRule`（含 **B 的机械判据与 worked values**）/ `classScoring` / `authorityNote` ≡「门禁必须重读本文件并记录 bytes+sha，任何消息里的数字仅为参考」。；契约自述「凡与任何消息或本字段早前版本冲突，以本段为准」。
> - **输入 revision fv4**：`gap.json` `cade32a6ae0346bf0e01aa96fd8b28d7ab8a0167ee6f94529e1511be971ce067`（82,509 B）· `gap-verdict-table.md` `81855a4fed7630268fba86e35f28f1b36414262edc9452ff464f544915f427c8`（50,613 B）· 快照 `revisions/fv4-2026-09-13T14-00-29-361Z/manifest.json`。
> - **Rubric 1.1.0**：`gate-rubric.json` 新增 `classMapping` / `evidenceQuality` / `D3Rule` / `d4Mapping` / `threshold`（**打分前声明**）；原规则节与 `rulesSha256 = 95cfbc5a…` 保留不动，扩展摘要 `rulesSha256_v1_1_0 = 75424606dc70e6cd547e52533134c678b7a2896d423b34e6e68b2d92f325a179`。（本补记实现时读的是 28,243 B / `a9dfb311…`；其 (a)/(b)/(g) 条款与本次逐字相同，28,403 B 版另把 `rowSet` 中「Table A 为 t8 权威行集合」的 transient 措辞**宣告为文本缺陷并作废**，并确认 `rowSetSource === "frozen-contract.rowSet"` 的 10 行判定。即：本表行集合与公式在最新契约下**依旧成立**。）
> - **settled 实现哈希（`file::symbol` 约定；行号仅读时快照）**：`lib/session-start.js` 24,397 B `1f0203c69e5e904d…`（`::evaluateComplexityGate`157 / `::autoRouteEnabled`242 / `::policyQualifies`251 / `::installSessionTeamPolicy`437）· `lib/index.js` 37,783 B `c1b170e8c9e92dcc…`（`::sessionTeamPolicy-schema`105、`::usage-policy-item-5`122）· `lib/tools.js` 149,196 B `026e2ffca86e1254…`（`::agent_teams_resume`2087）· `packages/mpd-bundle/cordis.patch.yml` 21,008 B `9ee189972b2b8706…`（`::sessionTeamPolicy`242 = `mode: off` + `autoRoute: true`）· `presets/mpd/agent.cordis.yml`（`::instructionFileCandidates`161、`::tool-workflow`365）。
> - **动作集合 before→after = adapt 4 / skip 6 → adapt 3 / skip 7**（队长 GO 定版）；唯一动作变化 = `remove-deadcode`（adapt→skip）；`git-master` 13→14 动作不变（skip），**不再压线、不再进 `userApprovedOverrides`**（契约 (b) 括号判其 `counted=0`）。
> - **重算与队长预期的差异（按契约 (g)「以重算为准、列出差异 + 依据」如实登记）**：按队长本条 GO 的预期（`security-research 19` / `tech-debt-audit 18` / `git-master 14` 均已一致），仅剩两行分数差异：`dag-library` **26**（预期 23）· `mass-ulw` **25**（预期 22）——两行 `D3=3`（counted=2 触顶）且 `D4=2`；**两行都被 V4(`dagRunId`) 否决，分数不改变动作**。另登记一处**口径差异**：`git-master` 按契约 (b) **括号**（count 0）⇒ D3=1 ⇒ 14 skip；按其**字面定义**（SKILL.md 含 `make`+16 个 ```bash 块）⇒ `binaryDependency` TRUE ⇒ D3=2 ⇒ 15 adapt。本表采用括号口径（与契约 (g)、队长 GO 的预期动作集合一致）。

**实际输入路径 = `evidence/omo-align/skills-gates/gap.json` + `evidence/omo-align/skills-gates/gap-verdict-table.md`（= 队长指定的权威目录，一致）**
输入 sha256（**已 settle 的最终 revision**，45 s 窗口后复 hash 稳定，AGENTS.md §7）：`gap.json` = `148998a64a8a528e7d2d22e9f0848a67687e5ce63004cb3d669b2604a9a7d025`（147 592 B）· `gap-verdict-table.md` = `9501610f7d8a5d00f2cbee191d9c284c47656f6368f38dda0d02d7982b0ac385`（28 929 B）。
**输入中途被生产者修订**：Revision A（t8 claim 时在盘）= `gap.json` sha256 `1e143257…`、135 022 B；Revision B（`produced_at_utc = 2026-09-13T13:48:58.908Z`，即上表 sha）= 最终。已对 **10 行逐字段比对两个 revision**（耦合 H/S 清点、D4、D3 罚分、D2 最大值、P1 同名标记）⇒ **完全一致，无任何分数/否决/动作变化**；本表分数属 Revision B，A/B 同分。
搬迁记录：t8 claim 时权威目录**不存在**，t4 产出当时只在注册契约路径 `evidence/omo-align/research/skills-and-capability-gap/`；t8 执行途中该产出被**移动（非复制）**到权威目录并改名为 `gap.json` + `gap-verdict-table.md`，契约路径副本已不存在。因此「两处文件同时存在」的取一规则未被触发，也无需标注「与权威目录不一致」。

**分工（与 t4 不重复）**：`gap-verdict-table.md`（t4）= **上游功能差距判定**（64 个上游 SKILL.md 根 + 10 个功能面的 class 与证据）；本表 = **技能门禁评分与决策**（可机械套用的 rubric 打分 → 动作 → 用户裁决清单）。本表不复制 t4 的表内容，只引用其字段。

**Rubric 先成型再打分**：`gate-rubric.json` **v1.1.0**（本补记），文件 sha256 = `70bf77be513ecee264a415b01a3c397e100423223ba720f9eef84aa6dc8df868`；**原规则节与其规范摘要 `rulesSha256 = 95cfbc5a8be265cb0a2e7e7eaf0f947a18c0f8065408dc2776447049165e79fa` 原样保留、未改**（1.0.1 的维度/否决/解析序/阈值等节仍在文件中且逐字未动），新增的 1.1.0 规则节（`classMapping` / `evidenceQuality` / `D3Rule` / `d4Mapping` / `threshold`）为**打分前声明**，其扩展摘要 `rulesSha256_v1_1_0 = 75424606dc70e6cd547e52533134c678b7a2896d423b34e6e68b2d92f325a179`（可独立重算）。1.0.1 的 pre-scoring 修订（SOFT 词表补 `teamTools`/`team tools`）保持原样；1.1.0 只新增、不修改。

---

## 0. 门禁规则摘要（完整定义见 `gate-rubric.json`；此处仅供人读）

- **行集合** = t4 `gap.json` 中 `class ∈ {adoptable, uncertain}` 的行 = **10 行**（`adoptable` = 0 行，`uncertain` = 10 行）。
- **维度与权重**：`total = 3*D1 + 3*D2 + 1*D3 + 1*D4 + 2*D5`，满分 30，**阈值 X = 15**（= 50%，低于一半加权证据不值得动 `skills/**` 与一次 VENDOR_LOCK re-pin）。
  - **D1 能力影响面**：0 = 无落点/本地已等价；1 = 同名对应物内容不同（refresh 类）或既有意图的边际变体；2 = 新增一类能力；3 = 改变工作如何执行（跨任务机制）。
  - **D2 四项目标相关性**（机械）：`高=3 中=2 低=1 无=0`，取**四目标最大值**，记录 argmax。
  - **D3 移植成本**（机械，越高越便宜）：`fileTier(≤1:0,2–3:1,4–20:2,>20:3) + 2*seam + 1*bin + 1*cred` → `0 罚=3分,1 罚=2分,2–3 罚=1分,≥4 罚=0分`；`fileCount/dirCount` 双 null = 独立 `unknown-cost` 档（记 U，贡献 1，不阻断 install）。
  - **D4 上游耦合度**（机械，越高越可移植）：逐条按**已发布关键词表**分类；`none`→3；HARD=0→2；HARD=1→1；HARD≥2→0。**默认未命中 = HARD `unclassified`**（保守）；`couplingMeasurement` 存在 ⇒ 不得判 3。
  - **D5 重复/冲突度**（半机械）：`已等价→0`、`部分等价→1`、`无增量(正交)→3`、`无增量(不可用)→0`。该维度**一个维度两处呈现**：既是分数，也是本表 `重复度` 列（`已等价|部分等价|无增量` 三个冻结词为前缀，括号内区分 `正交`/`不可用`）。
- **否决 V1–V4（先于一切）**：V1 `已等价 ⇒ skip`（total 不参与）；V2 `部分等价 ⇒ 最高 adapt-then-install`；V3 要求重命名**冻结名**（`agent_teams_*` / `/agent-teams` 手势与生成式 `/agent-teams-<profile键>` 命令族 / `profiles.mpd` 键 / preset id `mpd`）⇒ skip；V4 可用路径要求**替换本仓库任务板模型/运行器** ⇒ skip。
- **解析顺序（固定，边界样本同序，禁止逐例拍脑袋）**：`预检查 P1–P3 → V1/V3/V4 → 耦合门(D4==3?) → 总量门(total≥15?) → V2 封顶`。
- **动作映射（判据式）**：veto 命中 ⇒ `skip`；`total≥15 且 D4==3` ⇒ `install`；`total≥15 且 D4<3` ⇒ `adapt-then-install`；`total<15` ⇒ `skip`。
- **边界样本规则**：不特判；先按 class 排除，再打印同一公式的反事实算术（见 §4）。
- **健全性校验（已通过）**：`install = 0` 是**合法输出**（t4 明示 `adoptable=0`，且本行集合中**没有任何一行 raw coupling == none**）；门禁不强制「至少一个 install」。

---

## 1. 固定列判定表（10 行；缺列即不通过）

| id | 上游技能/领域项 | t4 判定 | rubric 各维度得分 | 合计 | 建议动作 | 实施代价 | 与 t5 落地能力的重复度 | 不实施的损失 | 证据引用 |
|---|---|---|---|---|---|---|---|---|---|
| `skills/remove-deadcode` | 死代码清理（LSP 验证 + 原子提交） | uncertain | D1=2 D2=1 **D3=2** D4=1 D5=1 | **14**（before 18） | **skip**（before `adapt-then-install`） | 1 文件/0 目录；seam=否（t19 实测 no-seam-required） | 无增量(正交) | **归零**：t19 实测移植只需技能文本内部的工具名重写、仓库侧零改动 ⇒ 该行低于阈值；用户可在知悉后确认或撤回批准（见 §3.1） | t19 `no-seam-required`（artifact `evidence/omo-align/skill-measurements/remove-deadcode/result.json`，19,819 B / sha256 `901e7f48692fada8bb11a0a3616d6f5c607457a3…`）；契约 `residualFieldGap` (b)(g) + `binaryDependencyRule`（worked value：remove-deadcode TRUE；**git-master FALSE** —— 其 16 个 bash/make 块是教学示例）；rubric 1.1.0 `D3Rule` |
| `skills/security-research` | 3 hunter + 2 PoC 并行漏洞审计 | uncertain | D1=2 D2=1 **D3=2** D4=2 D5=3 | **19**（before 17；队长 GO 预期 19 ⇒ 一致） | **adapt-then-install** | 1 文件/0 目录；seam=是（`teamTools` 触发 + mechanism） | 无增量(正交) | **本地语料完全没有安全审计技能**：并行漏洞 hunter + 可利用性定级工作流整类缺失（唯一真实缺口） | raw `teamTools:2`；契约 (b)(c)；rubric 1.1.0 |
| `skills/tech-debt-audit` | 9 维度技术债审计 + `TECH_DEBT_AUDIT.md` | uncertain | D1=2 D2=1 **D3=2** D4=1 D5=3 | **18**（before 16；队长 GO 预期 18 ⇒ 一致） | **adapt-then-install** | 1 文件/0 目录；seam=否；bin=是（`bun`） | 无增量(正交) | 缺 9 维度技术债审计流程与 `TECH_DEBT_AUDIT.md` 工件类型 | raw `binaries:2,creds:4`；contract (b)；rubric 1.1.0 |
| `omo-codex/rules` | 上游 rules-engine 的 `.omo/rules` 注入组件 | uncertain | D1=0 D2=1 D3=1 D4=2 D5=0 | **6** | **skip（V1 已等价）** | 1 文件/0 目录；seam=否 | **已等价** | **零增量**：本地 `AGENTS.md` 指令文件机制已覆盖（`presets/mpd/agent.cordis.yml:161` `instructionFileCandidates`） | 契约 (c)软类；裁定四；rubric 1.1.0 `vetoes.V1` |
| `omo-senpi/dag-library` | 命名可重放 DAG 图库 | uncertain | D1=2 D2=3 **D3=3** D4=2 D5=3 | **26**（before 16；队长 GO 预期 23） | **skip（V4: `dagRunId`）** | 1 文件/0 目录；seam=是（`workflowTool`+`dagRunId` 机制） | 无增量(不可用) | 技能路径**损失 = 0**：加载路径即上游 run 引擎，本地无 `run_id`/幂等模型 | 契约 (e) V4 命中类 = **`dagRunId`**；rubric 1.1.0 `vetoes.V4` |
| `omo-senpi/mass-ulw` | DAG 编排教义（phase/run、retry/amend/send） | uncertain | D1=3 D2=3 **D3=3** D4=2 D5=1 | **25**（before 21；队长 GO 预期 22） | **skip（V4: `dagRunId`）** | 2 文件/1 目录；seam=是（`envKeyOmo`+`workflowTool`+`dagRunId`） | 部分等价 | 技能路径**损失 = 0**；唯一可用增量 S1–S4 归 t5/t15（S1/S4 已存在，S2/S3 由 t15 交付） | 契约 (e) V4 命中类 = **`dagRunId`**；`lib/tools.js:2087` 等 |
| `skills-loader-core/dev-browser` | 内置浏览器自动化 | uncertain | D1=1 D2=1 **D3=2** D4=1 D5=1 | **11**（before 9） | **skip** | 3 文件/1 目录；seam=否（`workflowTool` 为 prose） | 部分等价 | 内置浏览器工具面缺失，本地 `ultimate-browsing` 覆盖同类意图（增量 = 0 个新工具面） | 契约 (d) prose 命中；raw `binaries:2` |
| `skills-loader-core/frontend` | Web UI/UX 构建与打磨 | uncertain | D1=1 D2=2 **D3=2** D4=1 D5=1 | **14**（before 8） | **skip** | 1 文件/0 目录；seam=否（`workflowTool` 为 prose） | 部分等价 | 内容增量缺失：1 个 ambience/hero 段 + 1 个 reference 文件（本地 151 行 vs 上游 154 行、28 vs 29 文件）——属语料 refresh | P1 同名检查；md5 `d99cc92fc2f86e4a…`（builtin=shared-skills）、本地 `159c3200…` |
| `skills-loader-core/git-master` | git 操作纪律 | uncertain | D1=1 D2=2 **D3=1** D4=2 D5=1 | **14**（before 13） | **skip** | 1 文件/0 目录；seam=否；**B=FALSE：契约 `binaryDependencyRule` 判为 subject matter only**（`make`/`git` 代码块在教 git，非其自身工作流）⇒ counted=0（此前按字面取 B=TRUE ⇒ 15 adapt 的读法已作废） | 部分等价 | 内容深度差：本地 104 行 vs 上游 builtin 1 107 行——属 refresh/adapt 决策 | 契约 `binaryDependencyRule` worked values（`git-master FALSE — subject matter only`）+ (b) `count 0 vs sum 3`；队长 GO 14 skip（非 borderline、不入 overrides） |
| `skills-loader-core/security-research` | 小型 hunter 团队安全审计 | uncertain | D1=2 D2=1 **D3=2** D4=2 D5=3 | **19**（before 17） | **adapt-then-install** | 1 文件/0 目录；seam=是（`teamTools` 机制） | 无增量(正交) | 与 `skills/security-research` 同属安全审计缺口（去重后只计一次安装动作） | raw 按 PATH 查得（`name: `）；契约 (a) |

**动作合计**：`install = 0` · `adapt-then-install = 4`（去重后 **3** 个不同技能：`remove-deadcode`、`security-research`、`tech-debt-audit`） · `skip = 6`。
**V3 全行评估结果 = 未触发**（对照冻结名集合：`agent_teams_*` 工具名、`/agent-teams` 手势 + 生成式 `/agent-teams-<profile键>` 命令族（`lib/command.js:3-5,12-17,75-76,95-100` + `profiles.*` 键集合）、`profiles.mpd` 键、preset id `mpd`；10 行中无任何一行的可用路径要求改动上述名称）。

---

## 2. 逐项明细（每项：上游语义摘要 / 本仓库对应物 / 评分明细 / 建议动作 / 实施代价 / 风险）

### 2.1 `skills/remove-deadcode` → adapt-then-install（18/30）
- **上游语义**：以 ultrawork 模式移除未使用代码，LSP 验证安全性，原子提交；触发词 remove dead code / dead code / cleanup / remove unused。
- **本仓库对应物**：`repoCounterpart` = null（上游仓库流程）；本地相邻物 = 技能 `refactor`、`remove-ai-slops`（t4 `overlap` = "none"）。
- **评分明细**：D1=2（无对应物、构成新能力类）· D2=1（G1=低，其余 无/无/无；argmax G1）· D3=2（1 文件、无 seam、1 类二进制罚）· D4=1（HARD=1：`binaries`；SOFT=2：`taskTool`、`categoryRouting`）· D5=3（无同名本地技能 ⇒ 无增量·正交）→ **18 ≥ 15 且 D4=1<3 ⇒ adapt-then-install**（V2 未触发）。
- **实施代价**：1 文件 / 0 目录；**不动 harness seam**；依赖 LSP 二进制（本地已有 `mcp__lsp__*`）。
- **风险**：与 `refactor`/`remove-ai-slops` 触发词重叠 → 路由歧义；上游 `task(category=…)` 段落须改写为本地 subagent/agent-teams 语汇。

### 2.2 `skills/security-research`（.agents 根） → adapt-then-install（17/30）
- **上游语义**：Team-Mode 安全研究：编排 3 个漏洞 hunter + 2 个 PoC 工程师并行审计代码库、证明可利用性、归类根因、按真实可利用性定级。
- **本仓库对应物**：无（`ls skills/` 确无 security 类技能；t4 `overlap` = "none"）。
- **评分明细**：D1=2 · D2=1 · D3=1（seam + 凭据罚=3）· D4=1（HARD=1：`creds`）· D5=3 → **17** ⇒ adapt-then-install。
- **实施代价**：1 文件 / 0 目录；**动 seam**（团队工具引用 + 凭据提及）；无二进制依赖。
- **风险**：凭据前提（cred 提及）在任何部署里都可能不可满足；`team tools` 段落须映射到 agent-teams 角色；与 §2.10 近重复，双装会造成两个同义技能。

### 2.3 `skills/tech-debt-audit` → adapt-then-install（16/30）
- **上游语义**：跨 9 个维度、带文件引用的技术债审计（AST-grep/tree-sitter、grep、LSP、语言原生工具），产出 `TECH_DEBT_AUDIT.md`（严重度/工作量/优先级）。
- **本仓库对应物**：无（`overlap` = "none"）；相邻意图由 `dsh-qa`/`review-work` 部分覆盖（触发词冲突风险）。
- **评分明细**：D1=2 · D2=1 · D3=1（二进制 + 凭据罚=2）· D4=0（HARD=2：`creds`、`binaries`）· D5=3 → **16** ⇒ adapt-then-install。
- **实施代价**：1 文件 / 0 目录；不动 seam；**同时依赖二进制与凭据（本表最多的环境前提）**。
- **风险**：环境前提最多（缺任一项则该技能不可用）；审计工件格式（`TECH_DEBT_AUDIT.md`）与双语/仓库文档规则需对齐。

### 2.4 `omo-codex/rules` → skip（V1，6/30）
- **上游语义**：rules-engine 组件技能，从 `.omo/rules` 加载项目规则。
- **本仓库对应物**：`dsh-agent-instructions` 指令文件约定（`AGENTS.md`/`AGENT.md`/`CLAUDE.md`，由 `presets/mpd/agent.cordis.yml:146-153` 配置）。
- **评分明细**：D1=0（本地机制已等价）· D2=1 · D3=3（0 罚）· D4=0（HARD=2：`$HOME/.omo` 路径、`senpi CLI`）· D5=0（**已等价**）→ **V1 命中 ⇒ skip**（total 不参与）。
- **实施代价**：1 文件 / 0 目录；不动 seam。
- **不实施损失**：**零增量**（本地指令文件机制已覆盖；上游 `.omo/rules` 格式无新增能力）。
- **风险**：若强行移植，会与 `AGENTS.md` 的双语/注入规范冲突。

### 2.5 `omo-senpi/dag-library` → skip（V4，16/30）
- **上游语义**：把 DAG 定义存为 `<name>.json` 并按名重跑：`$OMO_DAG_LIBRARY`（多目录）→ `$PWD/.omo/dags` → `$HOME/.omo/dags` 首次命中生效；经 `OMO_DAG_SDK_ROOT` 的 `library.js` 加载；加载时用 `{{key}}/{{date}}/{{datetime}}` 轮换幂等键。
- **本仓库对应物**：存储可重跑定义的那一半 **null**；最近资产 = `.mpd/plans/<slug>.md` + `mpd_boulder_plans`（`packages/mpd-boulder-plugin/src/index.ts:152-156`）与 DSH `workflow` 工具（脚本每次重写，从不按名查找）。
- **评分明细**：D1=2 · D2=3（G4=高）· D3=1（seam 罚=2）· D4=0（HARD=7，含 `upstream-run-engine`×3）· D5=0（**无增量·不可用**：`couplingMeasurement` 明示 "the load path IS the run engine, so the storage half is not separable"）→ **V4 命中 ⇒ skip**。
- **实施代价**：1 文件 / 0 目录；动 seam；`portCost` 已实测（非 unknown）。
- **不实施损失**：技能路径 **损失 = 0**（其加载路径即上游 run 引擎；本 harness 无 `run_id`/journal/幂等模型，t2 D3）。「命名可重放图库」这一能力仍缺失，但其取得路径是 t5 的 S2/S3 语义或未来 `workflow` 运行生命周期，**不是**技能移植。
- **风险**：`.omo/` 命名空间与本地 `.mpd/` 约定冲突；逐字移植会记录本 harness 不存在的能力（假文档）。

### 2.6 `omo-senpi/mass-ulw` → skip（V4，21/30 — 本表最高分但被否决）
- **上游语义**：教义类技能：通过原生 `workflow` 工具驱动依赖有序的子工作，**每 phase 一个 run**，带 retry/amend/send 恢复；配套 `references/planning.md` 承载分解教义、category 路由、节点提示契约（TASK/DELIVERABLE/SCOPE/VERIFY/STOP WHEN）与验证波；每个 run 绑定 goal。2 文件/1 目录（实测）。
- **本仓库对应物**：`packages/mpd-agent-teams-plugin/lib/scheduler.js`（团队任务 DAG：依赖 + 拓扑输出交接）+ `lib/quality-gates.js`（机械验证）+ DSH `workflow` 工具（`presets/mpd/agent.cordis.yml:349-355`）。
- **评分明细**：D1=3（跨任务机制）· D2=3 · D3=1（2 文件 tier1 + seam 罚=3）· D4=0（HARD=7，含 `upstream-run-engine`×4、`service-rpc`）· D5=1（**部分等价**：概念重叠、机制不重叠）→ total 21，但 **V4 命中 ⇒ skip**（可用路径要求替换本仓库任务板模型/运行器）。
- **实施代价**：2 文件 / 1 目录；动 seam；8 类上游耦合。
- **不实施损失**：技能路径 **损失 = 0**。唯一可用增量 = 冻结契约 `massUlwSemantics` 的 S1–S4，**已归属 t5**（`frozen-contract.massUlwSemantics.policy`：保留任务板模型，只补这 4 条语义）。**当前代码实测**：S1（terminal failed 任务可重试且不丢已完成任务）与 S4（对运行中成员的定向纠偏、同一 attempt 继续）**今天已存在** —— `lib/tools.js:1199-1204`（`agent_teams_reassign_task` 支持 retry/failed 任务）、`:1236`（completed 不可变 + 不丢已完成）、`:1652-1660`（`agent_teams_send_message` 对运行中成员定向投递）、`lib/index.js:122`（纠偏继续同一 attempt；t8 时该文字在 :107）；**S2 确认缺失**：`agent_teams_update_task` 不能修改任务定义（只有 status/output/attempt_id/verdict/findings），`agent_teams_edit_plan`（`lib/tools.js:716`）只作用于**尚未批准的 staged 计划**，运行中的 DAG 无修订入口。**S3 部分存在但未经运行时验证**：团队级 resume 与冷启动恢复已存在（`agent_teams_resume`，`lib/tools.js:1907`；`lib/capabilities.js:10` "including after a cold resume in a new process"），但「按任务粒度恢复、已完成节点不重跑」这一断言**无运行时测量**（原属 t5 的验收项；**t5 已被 t15 取代并合并**（`902e019` → dev `f4f91b5`），S1–S4 由 t15 交付，运行时验证归 t17）。⇒ 若 t5 被取消，缺口是 **S2（定义修订不重跑已完成）+ S3 的任务粒度保证**，而不是本技能。
- **风险**：逐字移植会把 8 类本 harness 不存在的机制写成事实（假文档风险最高的一行）；其 `category` 路由表是**按节点的模型选择**，不是任务级自动路由（G3 只在这一点上被触及）。

### 2.7 `skills-loader-core/dev-browser` → skip（9/30）
- **上游语义**：harness 内置的浏览器自动化开发技能。3 文件/1 目录（实测）。
- **本仓库对应物**：`skills/ultimate-browsing`（最近，t4 `overlap`："partially covered"）。
- **评分明细**：D1=1（既有意图的边际变体）· D2=1 · D3=0（3 文件 + seam + 二进制罚=4）· D4=1（HARD=1：`browser binaries`）· D5=1（部分等价）→ **9 < 15 ⇒ skip**。
- **实施代价**：3 文件 / 1 目录；动 seam（内置工具注册）；依赖浏览器二进制。
- **不实施损失**：损失 = 「harness 内置浏览器工具面」缺失；本地 `ultimate-browsing` 已覆盖同类意图，**技能本身不带来新工具面**（增量 = 0）。
- **风险**：需要浏览器二进制；与 `ultimate-browsing` 的路由冲突。

### 2.8 `skills-loader-core/frontend` → skip（8/30）
- **上游语义**：构建/打磨 Web UI 与 UX（前端的通用触发词）。
- **本仓库对应物**：**P1 同名检查命中** —— `skills/frontend` 已存在（`SKILL.md` 151 行、28 文件）；上游 **builtin 与 shared-skills 两份 SKILL.md 逐字节相同**（154 行；md5 `d99cc92fc2f86e4a4f2e9554307aa0c7` = sha256 `82d4715eb56059dd…`），**builtin 为 1 文件**、29 文件属 shared-skills；本地为另一份（151 行 / md5 `0ac0d1b3f8b6d5bb…`）。t4 此行 `repoCounterpart` 写作 `null`、`overlap` 写作 "not assessed"，与磁盘事实不符（已按 P1 重新定基，未改动 t4 文件）。
- **评分明细**：D1=1（同名对应物内容不同 ⇒ refresh 类）· D2=1 · D3=0（seam+bin+cred 罚=4）· D4=0（HARD=3：`workflowTool`、`creds`、`binaries`）· D5=1（部分等价）→ **8 < 15 ⇒ skip**。
- **实施代价**：1 文件 / 0 目录；动 seam；依赖二进制与凭据。
- **不实施损失**：具体 = 本地 `frontend` 相对 beta.62 的**内容增量**：151 vs 154 行、28 vs 29 文件，差 1 个 hero/ambience 段 + 1 个 reference 文件（t4 `windowAudit`：+ambience-skill）——属 §5 的**语料 refresh**决策，不是新技能。
- **风险**：同名文件覆盖会丢掉本地已定制的中文/触发词段落（本地 description 明显更详），refresh 必须逐 diff 合并。

### 2.9 `skills-loader-core/git-master` → skip（13/30 — **边界样本：接近阈值**）
- **上游语义**：任何 git 操作的 MUST USE 技能（原子提交、rebase/squash、blame/bisect/log -S），并建议用 `task(category='quick', load_skills=['git-master'])` 节省上下文。
- **本仓库对应物**：**P1 同名检查命中** —— `skills/git-master` 已存在（104 行、2 文件）；上游 builtin 变体为 1107 行、1 文件（两者 md5 不同，builtin 是更深的另一变体）。t4 此行同样写作 `repoCounterpart: null`、"not assessed"。
- **评分明细**：D1=1（同名对应物内容不同）· D2=1 · D3=3（0 罚 —— 本表最便宜的一行）· D4=2（HARD=0、SOFT=2：`taskTool`、`categoryRouting`）· D5=1（部分等价）→ **13 < 15 ⇒ skip**。**边界说明**：它只差 2 分；若 D1 判为 2（把 1107 行变体视为新增能力类），total = 16 且 D4=2<3 ⇒ 会变成 adapt-then-install。按 D1 分档「同名对应物存在且内容不同 = 1」，结论是 skip —— 这条边界正是 P1 存在的原因，**该分歧由 P1 定基解决，不允许逐例改判**。
- **实施代价**：1 文件 / 0 目录；不动 seam；无二进制/凭据依赖。
- **不实施损失**：具体 = 上游 builtin 相对本地 104 行同名技能的内容深度差（重写/合并工作量），属 **refresh/adapt** 决策；且 builtin 依赖上游 `task(category=…)`（SOFT，可改写）。
- **风险**：同名覆盖回退风险（本地技能已被 agent 依赖）；builtin 的 `MUST USE` 语气与本地触发词策略冲突。

### 2.10 `skills-loader-core/security-research` → adapt-then-install（17/30，**与 §2.2 去重计一次**）
- **上游语义**：bundled 安全研究技能：小型 hunter 团队审计代码库漏洞。
- **本仓库对应物**：无（`overlap` = "none today; would occupy a new capability slot"）。
- **评分明细**：D1=2 · D2=1 · D3=1 · D4=1（HARD=1：`credential mention`）· D5=3 → **17** ⇒ adapt-then-install。
- **实施代价**：1 文件 / 0 目录；动 seam；凭据提及。
- **风险**：与 §2.2 近重复（203 vs 198 行、md5 不同）→ **双装 = 两个同义技能**；实施时必须二选一并说明取舍依据。

---

## 3. 重点：三个编排类技能与 t5/t2 DAG 语义的重复度（直接决定用户是否批准）

| 技能 | 与 t5 落地能力的重复度 | 是否有增量价值 | 机械依据 |
|---|---|---|---|
| `omo-senpi/mass-ulw` | **部分等价** | **无**（技能路径） | 概念重叠（依赖排序/扇出/验证）但机制不重叠：本地无 `run_id`/attach/snapshot/cancel/retry-amend-send/journal（t2 D3、t4 8 类耦合）。**V4 命中 ⇒ skip**；唯一可用增量 S1–S4 归 t5，且 **S1/S4 今天已存在**（`lib/tools.js:1199-1204,1236,1652-1660` + `lib/index.js:107`）；**S2 确认缺失**，**S3 仅团队级且无运行时验证**（`lib/tools.js:1907`、`lib/capabilities.js:10`）。 |
| `omo-senpi/dag-library` | **无增量(不可用)** | **无** | 存储可重跑定义的一半本地缺失，但 t4 `couplingMeasurement` 明示其加载路径**就是** run 引擎（不可分离）⇒ 本 harness 上无可用语义。**V4 命中 ⇒ skip**。 |
| `omo-senpi/hyperplan` | **（不在行集合）t4 class = already-have** | **无** | 本地 `mpd_ultrawork({hyperplan:true})` 已实现**同一 5 类对抗波**（`packages/mpd-ulw-plugin/src/index.ts:147`、`:165`、`:180-191`；`README.md:19-20`）。t8 建议：**只做 parity 检查（成员角色/提示词），不移植**。 |

**给用户的一句话结论**：在 t5 按冻结契约交付 S1–S4 的前提下，**移植这三个技能中的任何一个，增量价值都是 0**；真正影响能力面的是 t5 是否交付 S2/S3，而不是是否装技能。

---

### 3.1 `userApprovedOverrides`（用户显式批准过、现落到阈值线或以下的候选）

用户在需求门批准移植 3 个技能：`security-research`、`tech-debt-audit`、`remove-deadcode`。门禁**照实出分、不迁就批准**；下列行必须带分数、两套口径与「可确认或撤回」的注记：

| 行 | 用户批准 | 新口径（fv4 + rubric 1.1.0） | 旧口径（fv1 + rubric 1.0.1） | 状态 |
|---|---|---|---|---|
| `skills/remove-deadcode` | ✅ 批准 | **14 ⇒ skip**（D3=2：t19 实测 `no-seam-required` ⇒ `harnessSeamChange=false`，counted=1 经 `binaryDependency`） | 18 ⇒ adapt-then-install | **低于阈值**：需用户确认或撤回批准 |
| `skills/security-research` | ✅ 批准 | 19 ⇒ adapt-then-install | 17 ⇒ adapt-then-install | 一致 |
| `skills/tech-debt-audit` | ✅ 批准 | 18 ⇒ adapt-then-install | 16 ⇒ adapt-then-install | 一致 |

处置建议（供队长转达用户）：**`remove-deadcode` 的批准可在「口径变化 + t19 实测仓库侧零改动」的事实下撤回或保留**；`git-master` 是**未批准但压线**的行，需用户明确是否纳入后续 wave。


### 3.2 交叉核对：`gap-r2.json`（v5，记录性输入）

`evidence/omo-align/skills-gates/gap-r2.json`（`revision fv5.8`，132,739 B / sha256 `ea969037a71d4cc1f17aec2bee4e8764baa54ae7…`（读取时；此前一次读取为 132,588 B / `d2c0d752cb9bbf42…`））的 `derivationTable`（10 行）与本体门的输入**逐行比对：8/10 完全一致**（`seamTriggerMechanism` / `binaryDependency` / `countedTrueSeamBooleans` 三项全同），包括 `git-master`（seam false / B false / counted 0 ⇒ D3=1 ⇒ 14 skip）、`remove-deadcode`（B true ⇒ counted 1 ⇒ D3=2 ⇒ 14 skip）、`security-research(.agents)` 与 `loader/security-research`（seam true ⇒ counted 1）、`dev-browser`/`frontend`（seam prose ⇒ false、B true）、`rules`（counted 0）。

**两处不一致（均不影响动作，均已按契约 (g) 登记）**：
| 行 | 契约 `binaryDependencyRule` 的 worked values | `gap-r2.json` derivationTable | 本体门采用 |
|---|---|---|---|
| `omo-senpi/dag-library` | **TRUE**（"node/python harness coupling"） | `binaryDependency: false` ⇒ counted=1 | **契约 worked values（B=TRUE）⇒ counted=2 ⇒ D3=3 ⇒ total 26** |
| `omo-senpi/mass-ulw` | **TRUE**（同上） | `binaryDependency: false` ⇒ counted=1 | 同上 ⇒ **25** |
⇒ 队长 advisory 的 `23 / 22` 与 v5 的 counted=1 口径一致；本体门依契约文本重算为 **26 / 25**。**两行都被 V4(`dagRunId`) 否决，动作不受影响**；差异来源已写明，供台账择一记录。
另：v5 的 `t19` 与本表引用**同一 artifact**（`…/skill-measurements/remove-deadcode/result.json`，sha256 `901e7f48692fada8bb11a0a3616d6f5c607457a3…`）✔。

## 4. 排除行与边界样本（一行说明 + 反事实算术）

- **行集合外的 54 行**：`already-have = 29`、`not-applicable = 25`（`gap.json` 64 行 / 57 唯一 id；7 组重复 id：`skills/github-triage`、`skills/hyperplan`、`skills/pre-publish-review`、`skills/work-with-pr`、`omo-codex/ulw-plan`、`omo-senpi/init-deep`、`omo-senpi/onboarding` —— 重复全部落在被排除的类中，不影响行集合）。排除规则：`already-have` = 本地已有等价物（语料 refresh 属另一决策）；`not-applicable` = **上游自身仓库/产品流程**（作用于上游产品，非用户项目）。
- **`omo-senpi/give-me-tips`（not-applicable）为何 skip 而不是 adapt**：其内容是**另一个产品 CLI** 的讲解导览 ⇒ 本仓库**无目标面**（D1=0）。反事实算术：D1=0、D2=1、D3=2（1 文件、无 seam、凭据提及）、D4=1（HARD `credential` + SOFT `task tool`/`category`）、D5=3 ⇒ **12 < 15 ⇒ skip**。即：class 排除与总量门**两条独立理由**都指向 skip。
- **`omo-senpi/onboarding`（not-applicable）为何 skip**：上游 senpi CLI 的首启 UX（写 send-off、发凭据、介绍 `ulw`/`mass ulw`）。反事实：D1=0（无目标面）、D2=1、D3=1（seam + 凭据）、D4=0（HARD `senpi CLI` + `$HOME/.omo`）、D5=3 ⇒ **10 < 15 ⇒ skip**。
- **边界样本规则**：以上两个样本**没有特判**，它们被同一套预检查/否决/门槛处理；本表同时打印「class 排除」和「反事实分数」两个独立依据。

---

## 5. VENDOR_LOCK / 单写者 / re-pin（偏差标注）

- **配对规则（机械）**：`VENDOR_LOCK.assets.skills = { fileCount: 328, treeSha: afe718251965a933b6a15b40bbe6ebf2e5222996fecb48b05fc8e770e390fcad }`（整目录排序聚合）。任何 `skills/**` 改动都会使该 `treeSha` 失效 ⇒ 必须在**同一 commit** 重新 pin。
- **一次实施 = 1 次 re-pin**（无论装 1 个还是 N 个技能）。**顺序（固定）**：① 改 `skills/**` → ② 重算 corpus `treeSha` → ③ 同 commit 提交 `VENDOR_LOCK.json` → ④ `node scripts/verify-vendor.mjs`。
- **fileCount 是阻塞门**：`expected fileCount = 328 + N_added`（**N_added 由实施任务 t9 实测确定，t8 不猜数字**）；两值（fileCount 与重算 treeSha）必须与 verify-vendor 结果一起记录。
- **违反后果**：两个 skills 写者 ⇒ 2 次 treeSha 失效 ⇒ **2 个耦合 commit**，中间提交 `verify-vendor` 必红（AGENTS.md §9/§11）。
- **⚠️ 本 wave 的执行偏差（须用户/队长知晓）**：本 wave 的 `skills/**` 唯一写者已由 `D_SKILLS_WRITER` 定为 **t5**（仅 `skills/dsh-qa/SKILL.md` + `skills/dsh-qa/scripts/session-start-team.mjs` 两个 QA 锚点）⇒ **本 wave 的唯一一次 re-pin 已归 t5**；因此任何技能移植**不能落在本 wave**，只能作为**后续 wave**的单写者批次执行。t9 的注册契约文本仍是「本 wave 移植技能到 `skills/**` 并做 VENDOR_LOCK 配对」，与 `D_SKILLS_WRITER` 字面冲突，**建议按 frozen-contract 改写 t9 契约**（frozen-contract 自述 "task descriptions may lag it, this file may not"）。
- **输入侧偏差记录**：① 输入产出在 t8 执行途中从契约路径**搬迁**到权威目录（见文件头，两份 sha256 已钉住）；② t4 对 `skills-loader-core/frontend`、`skills-loader-core/git-master` 两行的 `repoCounterpart` 写作 `null`，与本地同名技能存在的事实不符，已由 P1 重新定基（未改动 t4 产出）；③ `gap.json` 有 7 组重复 id（不影响行集合）；④ `t5` 已被 **t15 取代并合并**（`902e019` → dev `f4f91b5`；其 `session-start`/`autoRoute`/S1–S4 已实现，运行时验证归 t17）⇒ 表中「今天已存在」的判断基于**实现已合并的工作区**（本轮补记即为该状态下的重算）。

- **settled 锚点表（本补记落笔依据；按「文件 + 符号名 + 读时 sha256」记录，行号仅辅助）**：`lib/session-start.js::evaluateComplexityGate`(157) `::autoRouteEnabled`(242) `::policyQualifies`(251) `::installSessionTeamPolicy`(437)，文件 24,397 B / `1f0203c69e5e904d…`；`lib/index.js::sessionTeamPolicy-schema`(105–113) 与 **t8 原引用对象** `::usage-policy-item-5`(122)，文件 37,783 B / `c1b170e8c9e92dcc…`；`lib/tools.js::agent_teams_resume`(2087)，文件 149,196 B / `026e2ffca86e1254…`；`packages/mpd-bundle/cordis.patch.yml::sessionTeamPolicy`(242–249，`mode: off` + `autoRoute: true`)，21,008 B / `9ee189972b2b8706…`；`presets/mpd/agent.cordis.yml::instructionFileCandidates`(161–165) 与 `::tool-workflow`(365–366)。（原 4 条历史漂移映射中，`lib/index.js` 与 `lib/tools.js` 两条已按实测更正为「两个对象」与「当前符号位置」。）
- **失败模式登记（契约 (i) 要求引用）**：本波出现「**规则文本 / 推导式 / 预先宣布的数字三者漂移**」，根因是**在公式定死之前就宣布了数字**。⇒ 门禁**必须重算并引用输入**，不得引用记忆中的总分；本表的分数全部由 fv4 输入 + rubric 1.1.0 的公式现场重算（见 §1 每行 D1–D5 与 §3.1 的口径对照），与任何消息里的历史数字不一致处以本表重算值为准。
### 5.1 技能移植的「两栏」执行口径（按队长裁定）

| 栏 | 内容 |
|---|---|
| ① 本 wave 可执行性 | **否** —— 按 `D_SKILLS_WRITER`，本 wave `skills/**` 唯一写者是 t5（仅两个 QA 锚点），**t9 本 wave 零写入**。 |
| ② 后续 wave 执行计划 | **唯一写者** → 改 `skills/**` → 重算 corpus `treeSha` → 同 commit 写入 `VENDOR_LOCK.json`（re-pin）→ `node scripts/verify-vendor.mjs` 前置；`expected fileCount = 328 + N_added`（N_added 由 t9 实测）。 |

> **待办标记（队长裁定，交接点）**：**t9 契约文本待队长改写为条件形态** —— t9 归成员所有且依赖未完成，队长无法直接改其描述字段；解除阻塞时按 `frozen-contract.D_SKILLS_WRITER` 原文改写：「本 wave 不写 `skills/**`；仅在用户批准后作为**后续 wave 的唯一 skills 写者**执行，并附 1 次 re-pin + verify-vendor 前置」。
> **`D_SKILLS_WRITER` 原文引用**：「For this wave the ONLY writer of skills/** is the implementation task t5 (Senior Engineer), limited to the two QA anchors skills/dsh-qa/SKILL.md and skills/dsh-qa/scripts/session-start-team.mjs. The skills-corpus implementation task t9 writes nothing in this wave; if the user approves corpus work it lands in a later wave with a single writer and exactly one VENDOR_LOCK re-pin.」
> **本节的时效标注**：t8 任务状态已为 `completed`（终态记录不可变）；5.1 与上面这条待办标记是**队长在 t8 完成后追加要求的合规补记**（post-completion addendum），不改动任何既有评分、动作或 pin。

---

## 6. 验收对照（本表如何满足 t8 验收条款）

| 验收条款 | 落点 |
|---|---|
| `gate-rubric.json` 可机械套用、每个维度有分档与阈值、第三方可复现同一结论 | `gate-rubric.json`（维度分档 + 关键词表 + 权重/阈值 + 否决 + 固定解析顺序 + 边界样本规则 + 健全性校验）；机制维度 D2/D3/D4 完全机械，D1/D5 半机械但分档规则与逐行证据齐备 |
| 对每一个「上游有、本仓库缺」的技能项逐条打分，结论由分数推出 | §1 表（10 行，行集合 = `class ∈ {adoptable, uncertain}`）+ §2 逐项明细（含每行 D1–D5 推导链） |
| 能解释边界样本（`give-me-tips`、`onboarding` 等为何 skip/adapt） | §4（class 排除 + 反事实算术 12/30、10/30）+ §2.9（13/30 的 2 分边界与 P1 定基） |
| `verdict-table.md` 面向人阅读：每项含上游语义摘要、本仓库对应物、评分明细、建议动作、实施代价、风险 | §2 的 10 个小节逐一满足 |
| `decisions.json` 待裁决问题 + 推荐 + 「不实施会损失什么」 | `decisions.json`（每个问题带 `lossIfNotImplemented`，并对每行给出具体损失） |
| 偏差标注：`skills/**` 的 treeSha 配对 + 单写者 ⇒ 一次实施需几次 re-pin 与顺序 | §5（1 次 re-pin、固定顺序、`expected fileCount = 328 + N_added`、t5 已占用本 wave 唯一写者位） |
