# 上游功能差距判定表（输入 t8 技能门禁评分）

_Upstream capability-gap verdict table — t4 contract revision **R1**. Fixed 10-column judgment table. t8's own files (`verdict-table.md`, `gate-rubric.json`, `decisions.json`) are NOT this document._

Generated: 2026-09-13T14:00:29.357Z · builder: `build-r1.mjs` · task **t4**, Researcher (read-only) · upstream `d1557a4b4` = v5.0.0-beta.62 (alignment reference; local pin stays beta.20).

## Deliverable locations (absolute)

| artifact | absolute path |
|---|---|
| machine-readable rows (same id set as this table) | `/root/dshProj/my-power-dsh/evidence/omo-align/skills-gates/gap.json` |
| this table | `/root/dshProj/my-power-dsh/evidence/omo-align/skills-gates/gap-verdict-table.md` |
| raw evidence | `/root/dshProj/my-power-dsh/evidence/omo-align/skills-gates/raw/` |
| builder | `/root/dshProj/my-power-dsh/evidence/omo-align/skills-gates/build-r1.mjs` |

> 队长第三轮裁定（最终）：t4 产出双写。(1) 权威副本 = evidence/omo-align/skills-gates/{gap.json,gap-verdict-table.md}（t8 按此读取）；(2) 契约副本 = evidence/omo-align/research/skills-and-capability-gap/{gap.json,verdict-table.md}（t4 注册契约的 in-scope 路径，仅为此保留）。两份字节相同；若出现不一致，以权威副本为准并报队长。raw/ 与 builder 只在权威目录单份存在，两份文档均以绝对路径引用它们（契约副本因此仍可解析）。 The t4 terminal task record still lists the pre-correction paths (immutable) — see discrepancy X4.

**双写位置（队长第三轮最终裁定）：权威副本 vs 契约副本**

- **权威副本（t8 读取此处）**：`/root/dshProj/my-power-dsh/evidence/omo-align/skills-gates/gap.json` 与 `/root/dshProj/my-power-dsh/evidence/omo-align/skills-gates/gap-verdict-table.md`
- **契约副本**（t4 注册契约 in-scope 路径，仅为此保留）：`/root/dshProj/my-power-dsh/evidence/omo-align/research/skills-and-capability-gap/gap.json` 与 `/root/dshProj/my-power-dsh/evidence/omo-align/research/skills-and-capability-gap/verdict-table.md`
- 两份内容逐字一致（同一次构建 + 同一份字节拷贝）；若不一致，以权威副本为准并报队长。
- `raw/` 与生成器只在权威目录单份存在；两份文档都以绝对路径引用它们，契约副本仍可解析。
- 契约副本的表沿用契约里的旧文件名 `verdict-table.md`（与 t8 位于 skills-gates/ 的 `verdict-table.md` 不同目录，不冲突）。

**Revision 纪律（因 fv1 被同名覆盖而新增）**：本目录的 `gap.json` / `gap-verdict-table.md` 是**滚动 LIVE 副本**；每次构建都会另写一份**不可变快照**到 `revisions/<tag>-<UTCstamp>/`，并在 `REVISIONS.md` 记录 sha256/字节数/状态。t8 已完成的评分钉在 **fv1**（147,592 B，sha256 `148998a6…`），该版本已被我同名覆盖且 `evidence/omo-align/` 未纳入 git ⇒ **字节级不可恢复**；t8 自己的 `gate-rubric.json` / `decisions.json` 是该 revision 内容仅存的记录。详见 `REVISIONS.md`。

## Fixed columns (a row missing one fails acceptance)

`id | 领域 | 上游项 | 上游证据(file:line) | 本仓库对应物 | 本仓库证据(file:line) | 判定(applicable|adoptable|already-have|uncertain) | 语义差异要点 | 可机械验证点 | 备注`

## Row set

- **Table A** = the union of the t2 and t3 enumerations: t2 12 rows (D1..D12) + t3 10 rows (T3-01..T3-10) = 22 rows. Rows are neither merged nor dropped; same-domain pairs (D1/T3-01, D2/T3-04, D8/T3-05, D12/T3-09/10) both stay, as the union rule requires.
- **Table B** = the 10 rows named by `frozen-contract.t4Requirements.rowSet`. The union rule does not contain them, so they are kept as a separate labeled table rather than dropped (discrepancy **X2**).
- gap.json `rows` = 32 = Table A ∪ Table B, identical id sets.
- Verdict distribution: applicable=16, uncertain=13, already-have=2, adoptable=1. **adoptable rows = 1** (only those carry a falsifiable assertion).

### Table A — t2 ∪ t3 enumeration union

| id | 领域 | 上游项 | 上游证据(file:line) | 本仓库对应物 | 本仓库证据(file:line) | 判定(applicable|adoptable|already-have|uncertain) | 语义差异要点 | 可机械验证点 | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| D1-activation | 编排/团队 | 团队默认关闭 + 显式触发（team mode 关键词；mass-ulw 指针）——上游不存在会话启动默认建队 | docs/guide/team-mode.md:5-7; packages/team-core/src/config.ts:4; packages/omo-opencode/src/hooks/keyword-detector/team/default.ts:6-10; packages/omo-senpi/src/components/skill-pointers/index.ts:30-46 | 会话启动机械策略（默认 mode=auto）+ bundle 行配置 | packages/mpd-agent-teams-plugin/lib/session-start.js:229-269; packages/mpd-bundle/cordis.patch.yml:202-224 | applicable | 上游 OFF + 显式触发；本仓库在首个 agent/pre-step 无条件 provision 一个 staged 团队（默认 ON） | 把 sessionTeamPolicy.mode 置 off，在隔离 DSH_HOME 跑一个普通提示，观察 <ws>/.mpd/team/ 无新团队目录且日志无 STARTUP_NOTICE_MARKER | 来源 t2 D1；与 T3-01 同域但按并集要求保留两行（不合并、不删行） |
| D2-trigger-mechanism | 工具/路由 | 统一关键词表 + 隐藏的条件式 skill 指针（mention ≠ request） | packages/omo-senpi/src/components/skill-pointers/index.ts:30-46; packages/omo-senpi/AGENTS.md (keyword table; conditional pointer text) | null（本仓库任何插件都没有关键词/指针组件） | grep -rn 'keyword\|trigger\|detect' packages/mpd-agent-teams-plugin/lib -> 仅 UI i18n 命中（无机制） | applicable | 上游由输入文本关键词注入指针；本仓库只有模型自决 + 机械策略 + /agent-teams 手势 | 在 mpd 会话输入含 'mass ulw' 的提示，观察是否注入任何 <omo-*-pointer> 等价物（期望：无；本仓库无该机制） | 来源 t2 D2；t2 C3 是其候选方案，方案选择不属于本表 |
| D3-execution-surface | DAG/引擎 | 原生 workflow 工具 + eval cell + OMO_DAG_SDK_ROOT（run_id/attach/snapshot/wait/cancel/retry/send/amend + 日志化 resume） | packages/omo-senpi/skills/mass-ulw/SKILL.md:26-42 (eval 驱动), :48-64 (run 生命周期); packages/omo-senpi/plugin/runtime/dag/sdk.js:1-4; packages/omo-senpi/src/extension/dag-sdk-root-provisioning.ts:1-6 | DSH workflow 工具（JS agent()/pipeline()/parallel() 脚本，无 run_id/生命周期/日志）+ agent-teams 事件驱动任务板 | presets/mpd/agent.cordis.yml:349-355; packages/mpd-agent-teams-plugin/lib/scheduler.js:1-13,36-84,440-495 | uncertain | 同名不同机：上游 workflow=dag 运行引擎；本仓库 workflow=脚本扇出（阶段抛错仅该 item 变 null，无重试/修订/日志化恢复） | 对比可用动词：本仓库 workflow 工具无 run_id/retry/amend/resume 动词（读 presets/mpd/agent.cordis.yml:349-355 与工具 schema）；期望缺失，若存在则本行判定需重评 | 来源 t2 D3；判定 uncertain 的原因=上游项无法整体采纳（引擎缺失），只能改写为本地语义 |
| D4-dag-model | DAG | 一次 run 只覆盖一个 phase；node{id,category,dependsOn}；默认 fan-out→fan-in；2 节点无依赖不算 dag | packages/omo-senpi/skills/mass-ulw/SKILL.md:16-20; packages/omo-senpi/skills/mass-ulw/references/planning.md:23-25 | 共享任务板：task.dependencies[] + 拓扑依赖输出注入 | packages/mpd-agent-teams-plugin/lib/scheduler.js:1-13,36-84,440-495; packages/mpd-agent-teams-plugin/lib/scheduler.js:17-20 (2k/12k 截断) | applicable | 本仓库无 run/phase 边界与 node category 路由；依赖边与拓扑 hand-off 已存在 | 创建一个无依赖的 2 任务图并观察调度（本地允许；上游 doctrine 判为 not-a-dag）——差异可观测即判定成立 | 来源 t2 D4 |
| D5-node-contract | DAG/质量 | node prompt 契约 TASK/DELIVERABLE/SCOPE/VERIFY/STOP WHEN + dag-lint 建议性告警（从不拒绝） | packages/omo-senpi/src/components/task/dag-lint.ts:10-20 | 质量类任务契约（objective/acceptance/inScope/verify）+ 建卡时矛盾门 | packages/mpd-agent-teams-plugin/lib/quality-gates.js:391,659,769-812 | applicable | 本地对 quality kind 是机器校验（更强），但普通 work 任务只要求 subject；双方都缺 STOP WHEN 字段 | 创建 kind=work 任务且只给 subject -> 本地接受（上游 lint 会给告警）；观察是否落盘/告警 | 来源 t2 D5 |
| D6-verification | 质量 | 结果验证 doctrine：节点/run 完成声明在证据证明前一律为假；验证波产出证据 | packages/omo-senpi/skills/mass-ulw/SKILL.md:22-24; https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/omo-senpi/skills/mass-ulw/references/planning.md (verification wave section) | 机械质量门：verdict=pass 要求 + 自动 repair + 交付门 + 覆盖矩阵 | packages/mpd-agent-teams-plugin/lib/quality-gates.js:391,659,769-812; packages/mpd-agent-teams-plugin/lib/quality-gates.js:754-768 (buildCoverageMatrix) | already-have | 本地是机械门（比上游 doctrine 强）；可借鉴的是措辞/UX，不是机制 | 让一个 review 任务以 needs_revision 结束并观察其不可 completed（quality-gates.js:769-812） | 来源 t2 D6 |
| D7-goal-binding | 目标 | 每次 run 绑定 goal（create_goal），目标承载结果验证（PR #7175） | packages/omo-senpi/skills/mass-ulw/SKILL.md:22-24; https://github.com/code-yeongyu/oh-my-openagent/pull/7175 | harness goal 工具已挂载，但团队交付未绑定 goal | presets/mpd/agent.cordis.yml:221-225 (command-goal/tool-goal); packages/mpd-agent-teams-plugin/lib/quality-gates.js:769-812 (交付只看任务图) | applicable | 本地有 goal 能力但无 team→goal 绑定；团队可在无 goal 对象时完成 | 发起一个无 goal 的团队并走完交付：本地 canDeclareDelivery 通过（上游 doctrine 要求 goal 存在）——差异可复现 | 来源 t2 D7；与 frozen-contract 的四项 mass-ulw 语义无关（S1-S4 见专节） |
| D8-routing-doctrine | 路由 | team vs dag 的显式路由 doctrine（plain 研究→team；mass→dag；dag 节点不说话） | packages/shared-skills/skills/ulw-research/SKILL.md:159 (mass vs plain routing sentence) | preset 内的 small/large 规模判定（在已 provision 团队之后运行） | presets/mpd/agent.cordis.yml:80-102; packages/mpd-agent-teams-plugin/lib/session-start.js:229-269 | applicable | 本地规模判定在团队建立之后，无法阻止默认建队；也从不路由到 workflow/ultrawork 平面 | 读 preset 文本确认 sizing 段落位置在 session-start 策略之后（顺序可观测）；期望：无法阻止默认 provision | 来源 t2 D8 |
| D9-scale | DAG/容量 | mass 规模：60+ 节点波次 + 难度阶梯 category 路由 + reducer | packages/omo-senpi/skills/mass-ulw/references/planning.md (category routing ladder); packages/omo-senpi/skills/mass-ulw/SKILL.md:11-14 | maxMembers 16 / 11 人 roster / 单一模型族（deepseek-v4-flash + reasoning 档） | packages/mpd-bundle/cordis.patch.yml:208,247-266 | applicable | 不同规模类：本仓库团队是对话/验证平面；60+ 扇出应落在 workflow/subagent 平面 | 统计 roster 与 maxMembers 上限并与上游节点上限对比（读 patch 行即可复现） | 来源 t2 D9 |
| D10-recovery | 恢复 | per-run retry / send / amend + 日志化跨重启 resume | packages/omo-senpi/skills/mass-ulw/SKILL.md:66-86 | per-task attempt_id + parked attempt + captain 重派 + 冷恢复重排 + 质量门 repair 环 | packages/mpd-agent-teams-plugin/lib/scheduler.js:1-13,36-84,440-495; packages/mpd-agent-teams-plugin/lib/quality-gates.js:391,659,769-812 | applicable | 粒度不同：本地按 task 恢复且需人工审阅；上游按 run 程序化恢复，无 amend/send 等价动词 | 见 S1-S4 专节（逐项可证伪断言） | 来源 t2 D10；本行由 S1-S4 专节展开（frozen-contract 明确要求逐项报告） |
| D11-human-plane | 人机/评审 | mass-ulw 路径无人机审批（关键词后自治） | packages/omo-senpi/skills/mass-ulw/SKILL.md:19-20 (keyword 后直接定义/启动) | staged plan + Web 审批（approval=required）+ edit_plan + halt/resume + 活动面板 | packages/mpd-agent-teams-plugin/lib/index.js:100-115,233-248 | already-have | 本地是严格超集（上游无审批面）；去默认化时必须保留 | staged 团队下调用 agent_teams_approve 前成员不得启动（观察 member 状态停留在 roster 行） | 来源 t2 D11 |
| D12-skill-corpus | 技能 | mass-ulw skill + references/planning.md 随产品作为一等技能发布 | packages/omo-senpi/skills/mass-ulw/SKILL.md:1-6 (frontmatter/description); packages/omo-senpi/skills/mass-ulw/references/planning.md:1-8 | 本地语料无 mass-ulw，但 skills/ulw-execute 引用它（悬空） | skills/ulw-execute/SKILL.md:103; skills/frontend/references/design/print-paged-media.md:76 | uncertain | 缺 doctrine 且存在悬空交叉引用；是否移植/改写由 t8 门禁与用户裁决 | ls skills/ \| grep mass-ulw -> 无；grep -rn 'mass-ulw' skills/ -> 2 处引用（期望=引用存在但目标缺失） | 来源 t2 D12；技能级判定细则见 Table B 与 t4 技能清单（supportingEvidence） |
| T3-01-default-state | 编排/默认策略 | Team Mode 默认 OFF，opt-in via team_mode.enabled | packages/team-core/src/config.ts:4; docs/guide/team-mode.md:5-7; packages/omo-opencode/src/features/team-mode/AGENTS.md:7 | sessionTeamPolicy.mode=auto（bundle 行启用；插件 schema 默认已是 off） | packages/mpd-bundle/cordis.patch.yml:202-224; packages/mpd-agent-teams-plugin/lib/index.js:87-98 | adoptable | 上游默认 OFF、需显式开启；本仓库默认 ON 且机械 provision | 翻转 bundle 行的 sessionTeamPolicy.mode -> off；隔离 boot 跑普通提示；断言 .mpd/team/ 无新团队且日志无 notice；再跑一个复杂提示断言恰好产生 1 个 staged 团队 | 来源 t3 #1（与 D1 同域，按并集要求保留双行） |
| T3-02-enable-surface | 配置 | 启用面 = JSONC 配置文件（~/.omo/omo.jsonc 或 .omo/omo.jsonc）+ 重启 | docs/guide/team-mode.md:17; packages/omo-opencode/src/features/team-mode/AGENTS.md:7 | 启用面 = bundle patch 行 + installer 镜像；无用户配置平面 | packages/mpd-bundle/cordis.patch.yml:202-224; scripts/install-profile.mjs:177,261-262; packages/mpd-config-plugin/src/index.ts (mpd.jsonc 层) | applicable | 上游可由用户 JSONC 开启/关闭；本地只能改 bundle 源（用户无入口） | 在 .mpd/mpd.jsonc 写入新开关并 boot，观察策略取值随之变化（当前期望：无此键 => 改动无效，即缺口可复现） | 来源 t3 #2；D_AUTOROUTE_SPLIT 规定新键名 sessionTeamPolicy.autoRoute |
| T3-03-tool-availability | 工具 | team_* 工具仅在启用时注册；工具缺席即权威信号 | packages/omo-opencode/src/plugin/tool-registry-team-tools.ts:20-21; packages/omo-opencode/src/plugin/tool-registry.ts:69-73 | agent_teams_* 工具始终注册（插件挂载）+ usage 策略始终注入 | packages/mpd-bundle/cordis.patch.yml:202-203 (row always mounted); packages/mpd-agent-teams-plugin/lib/index.js:100-115 (usageSectionText 常驻) | applicable | 上游用工具缺席表达关闭；本地工具常驻，只能靠提示/策略收敛，"不再默认"不等于提示面安静化 | 在 sessionTeamPolicy.mode=off 下 boot 并检查 captain prompt 是否仍包含 usage 段（期望：仍包含 => 提示面未收敛，可观测） | 来源 t3 #3 |
| T3-04-activation-trigger | 路由/触发 | 显式关键词 'team mode'（主会话）或模型判断（工具存在时） | packages/omo-opencode/src/hooks/keyword-detector/team/default.ts:6-10 | 首个 agent/pre-step 机械 provision（无关键词、无规模判断） | packages/mpd-agent-teams-plugin/lib/session-start.js:229-269; packages/mpd-agent-teams-plugin/lib/session-start.js:71-84 | applicable | 本地触发与任务复杂度无关；上游触发是用户显式文本 | 对同一 revision 分别跑「含 team: 前缀」与「普通」提示，观察建队是否只在后者之外发生（期望：两侧都建队 => 触发未门控） | 来源 t3 #4；机械门定义见 frozen-contract.complexityGate |
| T3-05-auto-routing | 路由 | 上游无复杂度启发式（0 hits）；路由只存在于散文（when to use） | packages/omo-opencode/src/hooks/keyword-detector/team/default.ts:6-10; docs/guide/team-mode.md:5-7（上游仅有关键词触发，无阈值代码） | preset 有 small/large 段落，但被无条件 provision 吞没 | presets/mpd/agent.cordis.yml:80-102; packages/mpd-agent-teams-plugin/lib/session-start.js:229-269 | uncertain | 无上游项可直接采纳：复杂度门是本仓库的本地设计（必须由 frozen-contract.complexityGate 冻结，不能事后调参） | grep -rni 'complexity\|heuristic\|threshold' 上游语料（期望 0 命中，复现「无上游可抄」）；本地门的两侧测试见 T3-01 断言 | 来源 t3 #5；判定 uncertain 的原因=上游没有对应物，只能本地发明并冻结 |
| T3-06-notice-surface | 提示面 | prompts/mode/team.md + <team_mode_status> 仅在关键词后注入 | packages/prompts-core/prompts/mode/team.md:1-3 | provisionedNotice/instructNotice 对每个合格会话注入 | packages/mpd-agent-teams-plugin/lib/session-start.js:174-203 | applicable | 上游通知由触发门控；本地通知无条件注入 | 同 T3-01 的启动断言：off 模式下日志不得出现 STARTUP_NOTICE_MARKER（可 grep 会话日志） | 来源 t3 #6 |
| T3-07-member-eligibility | 成员 | 只读专家被硬拒绝为成员（成员必须能写 mailbox） | packages/team-core/src/types.ts:203-228 | mpd roster 把 6 个只读专家放进 11 人成员表（协议要求不写，但无机械限制） | packages/mpd-bundle/cordis.patch.yml:247-266; AGENTS.md §13 (read-only deny list) | applicable | 上游用机械拒绝保证成员可写；本地靠 deny list + 协议文本，语义上是有意偏差 | 检查 roster 中只读成员是否可被调度到写任务（期望：可，因为拒绝只在上游实现） | 来源 t3 #7；是否对齐需用户裁决（属可选对齐） |
| T3-08-closure | 生命周期 | 关闭不变量：所有任务终态后 lead 在同一 turn 内 shutdown + delete | packages/omo-opencode/src/features/team-mode/member-guidance.ts:38-46; packages/prompts-core/prompts/mode/team.md:1-3 | 默认团队无关闭路径，会持久残留 | packages/mpd-agent-teams-plugin/lib/session-start.js:229-269; AGENTS.md §12 (in-use gate 扫描 .mpd/team) | applicable | 上游有机械关闭序列；本地无关闭策略，"不再默认"可能变成"不再清理" | 跑完一个团队后统计 .mpd/team 下的残留团队数（t3 measured_residue=25）；期望关闭策略落地后不增长 | 来源 t3 #8；t3 测得 25 个残留团队 |
| T3-09-skill-surface | 技能 | 内置 team-mode skill 仅在启用时加载 | packages/omo-codex/plugin/components/teammode/skills/teammode/SKILL.md:1-6 | 本地 skills/ 无 team-mode 技能；团队指引在插件 usage 段 + preset persona | ls skills/ = 19 目录（无 team-mode）; packages/mpd-agent-teams-plugin/lib/index.js:100-115 | applicable | 上游有启用时可加载的技能载体；本地指引常驻在提示面 | ls skills/ \| grep -i team -> 无（期望无；若出现则本行需重评） | 来源 t3 #9；技能语料整体判定见 Table B |
| T3-10-config-fields | 配置 | team_mode 11 个字段（并发/成员上限/消息字节/墙钟/成员轮次/base_dir 等） | packages/team-core/src/config.ts:3-15 | sessionTeamPolicy 5 字段 + 行级 stateDir/memberProvider/maxMembers | packages/mpd-bundle/cordis.patch.yml:204-224; packages/mpd-agent-teams-plugin/lib/index.js:76-98 | applicable | 上游字段面更宽；本地对等字段缺失（并行度/消息字节/未读配额/墙钟/单成员轮次） | 比对两侧字段清单（读 config.ts:3-15 与 index.js:76-98 即可复现 11 vs 5+n） | 来源 t3 #10；用户裁决 4（R4F2）要求补齐缺口字段但上限沿用本地更宽松值 |

### Table B — rows named by `frozen-contract.t4Requirements.rowSet` (skill-level gate input)

| id | 领域 | 上游项 | 上游证据(file:line) | 本仓库对应物 | 本仓库证据(file:line) | 判定(applicable|adoptable|already-have|uncertain) | 语义差异要点 | 可机械验证点 | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| skills/remove-deadcode | 技能 | remove-deadcode（上游技能，载体 .agents/skills） | .agents/skills/remove-deadcode/SKILL.md:3 (frontmatter), .agents/skills/remove-deadcode/SKILL.md:1-216（文件实长 216 行，fileCount=1, dirCount=0） | null | null（本地无对应目录） | uncertain | 上游仓库内建技能，通用度较高但与本波四目标无直接关系；是否移植待 t8 门禁 | ls .agents/skills/remove-deadcode 与本地对照（可复现）；判定为 adoptable 前不得移植（本轮只读） | 来源 frozen-contract.t4Requirements.rowSet（原文 "skills/remove-deadcode"）；t4 旧 id=.agents/skills/remove-deadcode；class 分布见 supportingEvidence |
| skills/security-research | 技能 | security-research（上游技能，载体 .agents/skills） | .agents/skills/security-research/SKILL.md:3 (frontmatter), .agents/skills/security-research/SKILL.md:1-204（文件实长 204 行，fileCount=1, dirCount=0） | null | null（本地无对应目录） | uncertain | 上游仓库内建安全审计技能；本地无对应，属于新增能力槽位 | ls .agents/skills/security-research 与本地对照（可复现）；判定为 adoptable 前不得移植（本轮只读） | 来源 frozen-contract.t4Requirements.rowSet（原文 "skills/security-research"）；t4 旧 id=.agents/skills/security-research；class 分布见 supportingEvidence |
| skills/tech-debt-audit | 技能 | tech-debt-audit（上游技能，载体 .agents/skills） | .agents/skills/tech-debt-audit/SKILL.md:3 (frontmatter), .agents/skills/tech-debt-audit/SKILL.md:1-208（文件实长 208 行，fileCount=1, dirCount=0） | null | null（本地无对应目录） | uncertain | 上游仓库内建技术债审计技能；本地无对应 | ls .agents/skills/tech-debt-audit 与本地对照（可复现）；判定为 adoptable 前不得移植（本轮只读） | 来源 frozen-contract.t4Requirements.rowSet（原文 "skills/tech-debt-audit"）；t4 旧 id=.agents/skills/tech-debt-audit；class 分布见 supportingEvidence |
| omo-codex/rules | 技能/规则 | rules（上游技能，载体 packages/omo-codex） | packages/omo-codex/plugin/components/rules/skills/rules/SKILL.md:3 (frontmatter), packages/omo-codex/plugin/components/rules/skills/rules/SKILL.md:1-33（文件实长 33 行，fileCount=1, dirCount=0） | null | null（本地无对应目录） | uncertain | 上游 rules 组件：从 .omo/rules 注入项目规则；本地用 AGENTS.md 约定，机制重复 | ls packages/omo-codex/plugin/components/rules/skills/rules/ 与本地对照（可复现）；判定为 adoptable 前不得移植（本轮只读） | 来源 frozen-contract.t4Requirements.rowSet（原文 "omo-codex/rules"）；t4 旧 id=packages/omo-codex/plugin/components/rules/skills/rules/SKILL.md；class 分布见 supportingEvidence |
| omo-senpi/dag-library | DAG/技能 | dag-library（上游技能，载体 packages/omo-senpi） | packages/omo-senpi/skills/dag-library/SKILL.md:3 (frontmatter), packages/omo-senpi/skills/dag-library/SKILL.md:1-71（文件实长 71 行，fileCount=1, dirCount=0） | null | null（本地无对应目录） | uncertain | 存储并复用命名 dag 定义（$OMO_DAG_LIBRARY/.omo/dags + key 轮换）；依赖上游 run 幂等模型，本地无对应 | ls packages/omo-senpi/skills/dag-library/ 与本地对照（可复现）；判定为 adoptable 前不得移植（本轮只读） | 来源 frozen-contract.t4Requirements.rowSet（原文 "omo-senpi/dag-library"）；t4 旧 id=packages/omo-senpi/skills/dag-library/SKILL.md；class 分布见 supportingEvidence |
| omo-senpi/mass-ulw | DAG/技能 | mass-ulw（上游技能，载体 packages/omo-senpi） | packages/omo-senpi/skills/mass-ulw/SKILL.md:3 (frontmatter), packages/omo-senpi/skills/mass-ulw/SKILL.md:1-97（文件实长 97 行，fileCount=2, dirCount=1） | null | null（本地无对应目录） | uncertain | mass-ulw doctrine：一次 run 一个 phase、node 契约、goal 绑定、验证波；机制（run_id/retry/amend/send/日志）本地缺失，只能改写 | ls packages/omo-senpi/skills/mass-ulw/ 与本地对照（可复现）；判定为 adoptable 前不得移植（本轮只读） | 来源 frozen-contract.t4Requirements.rowSet（原文 "omo-senpi/mass-ulw"）；t4 旧 id=packages/omo-senpi/skills/mass-ulw/SKILL.md；class 分布见 supportingEvidence |
| skills-loader-core/dev-browser | 技能/工具 | dev-browser（上游技能，载体 packages/skills-loader-core） | packages/skills-loader-core/src/features/builtin-skills/dev-browser/SKILL.md:3 (frontmatter), packages/skills-loader-core/src/features/builtin-skills/dev-browser/SKILL.md:1-214（文件实长 214 行，fileCount=3, dirCount=1） | null | null（本地无对应目录） | uncertain | 内置浏览器自动化技能；与 local skills/ultimate-browsing 部分重叠，需人工判读后决定 adopt/skip | ls packages/skills-loader-core/src/features/builtin-skills/dev-browser/ 与本地对照（可复现）；判定为 adoptable 前不得移植（本轮只读） | 来源 frozen-contract.t4Requirements.rowSet（原文 "skills-loader-core/dev-browser"）；t4 旧 id=packages/skills-loader-core/src/features/builtin-skills/dev-browser/SKILL.md；class 分布见 supportingEvidence |
| skills-loader-core/frontend | 技能 | frontend（上游技能，载体 packages/skills-loader-core） | packages/skills-loader-core/src/features/builtin-skills/frontend/SKILL.md:3 (frontmatter), packages/skills-loader-core/src/features/builtin-skills/frontend/SKILL.md:1-155（文件实长 155 行，fileCount=1, dirCount=0） | skills/frontend/SKILL.md | skills/frontend/SKILL.md:1-152 (local counterpart) | uncertain | 内置 frontend 副本；本地已有 shared-skills 版 frontend（差异=beta.62 新增 ambience-skill.md） | ls packages/skills-loader-core/src/features/builtin-skills/frontend/ 与本地对照（可复现）；判定为 adoptable 前不得移植（本轮只读） | 来源 frozen-contract.t4Requirements.rowSet（原文 "skills-loader-core/frontend"）；t4 旧 id=packages/skills-loader-core/src/features/builtin-skills/frontend/SKILL.md；class 分布见 supportingEvidence |
| skills-loader-core/git-master | 技能 | git-master（上游技能，载体 packages/skills-loader-core） | packages/skills-loader-core/src/features/builtin-skills/git-master/SKILL.md:3 (frontmatter), packages/skills-loader-core/src/features/builtin-skills/git-master/SKILL.md:1-1108（文件实长 1108 行，fileCount=1, dirCount=0） | skills/git-master/SKILL.md | skills/git-master/SKILL.md:1-105 (local counterpart) | uncertain | 内置 git-master 副本（1108 行）；本地 skills/git-master 为 shared-skills 版（105 行），两个不同载体的取舍待判 | ls packages/skills-loader-core/src/features/builtin-skills/git-master/ 与本地对照（可复现）；判定为 adoptable 前不得移植（本轮只读） | 来源 frozen-contract.t4Requirements.rowSet（原文 "skills-loader-core/git-master"）；t4 旧 id=packages/skills-loader-core/src/features/builtin-skills/git-master/SKILL.md；class 分布见 supportingEvidence |
| skills-loader-core/security-research | 技能 | security-research（上游技能，载体 packages/skills-loader-core） | packages/skills-loader-core/src/features/builtin-skills/security-research/SKILL.md:1 (frontmatter), packages/skills-loader-core/src/features/builtin-skills/security-research/SKILL.md:1-199（文件实长 199 行，fileCount=1, dirCount=0） | null | null（本地无对应目录） | uncertain | 内置安全研究技能；与 .agents/skills/security-research 同名不同载体 | ls packages/skills-loader-core/src/features/builtin-skills/security-research/ 与本地对照（可复现）；判定为 adoptable 前不得移植（本轮只读） | 来源 frozen-contract.t4Requirements.rowSet（原文 "skills-loader-core/security-research"）；t4 旧 id=packages/skills-loader-core/src/features/builtin-skills/security-research/SKILL.md；class 分布见 supportingEvidence |

## `replacement` — which EXISTING local mechanism carries each skill's semantics (input to t8's V4 veto rule)

Rule this feeds: if a skill's only usable path requires replacing the local runner (the frozen invariant is “keep the agent-teams task-board model, add only the four S1–S4 semantics”), the mechanical verdict is `skip`. Status vocabulary: `equivalent` / `partial-equivalent` / `no-equivalent`.

| id | status | 承载机制 | 证据(file:line) | 等价性判断 |
|---|---|---|---|---|
| skills/remove-deadcode | partial-equivalent | skills/remove-ai-slops + skills/refactor（既有清理类技能） | skills/remove-ai-slops/SKILL.md:1-336; skills/refactor/SKILL.md:1-731 | 部分等价（清理类能力存在；死代码专门化没有） |
| skills/security-research | no-equivalent | null | 本地 skills/ 无安全审计技能 | 无增量（新增能力槽位） |
| skills/tech-debt-audit | no-equivalent | null | 本地 skills/ 无技术债审计技能 | 无增量（新增能力槽位） |
| omo-codex/rules | partial-equivalent | dsh-agent-instructions 指令文件约定（AGENT.md → AGENTS.md → CLAUDE.md） | presets/mpd/agent.cordis.yml:146-153 | 部分等价：项目规则注入已存在，但格式/发现路径与上游 rules-engine 不同 |
| omo-senpi/dag-library | no-equivalent | null | packages/mpd-boulder-plugin/src/index.ts:152-156（最近的本地资产：.mpd/plans 列表，文档型、不可按名重跑） | 无增量：按名复用图定义依赖 key+fingerprint 幂等与 run 句柄，本地无承载机制 |
| omo-senpi/mass-ulw | partial-equivalent | agent-teams 任务板（依赖排序/扇出/验证）+ DSH workflow 工具的 agent()/pipeline()/parallel() | packages/mpd-agent-teams-plugin/lib/scheduler.js:36-84; packages/mpd-agent-teams-plugin/lib/quality-gates.js:769-812; presets/mpd/agent.cordis.yml:349-355 | 部分等价：依赖边/拓扑 hand-off/机械验证已由任务板承载；phase 边界与 run 级动词（retry/amend/send/resume）无等价物，只能落 recoveryCoverage 的 S1-S4 四项语义 |
| skills-loader-core/dev-browser | partial-equivalent | skills/ultimate-browsing Tier-2（CloakBrowser + agent-browser CDP） | skills/ultimate-browsing/SKILL.md:87-99 | 部分等价（浏览器自动化已覆盖；驱动接口不同） |
| skills-loader-core/frontend | equivalent | skills/frontend（shared-skills 版，本地已存在） | skills/frontend/SKILL.md; raw/skill-file-diff.txt（差异=上游新增 references/design/ambience-skill.md） | 已等价（仅 beta.62 内容漂移 1 文件） |
| skills-loader-core/git-master | equivalent | skills/git-master（shared-skills 版，本地已存在） | skills/git-master/SKILL.md:1-104 | 已等价（两个不同载体：内置版 1108 行 vs 本地 105 行；取舍待 t8 判） |
| skills-loader-core/security-research | no-equivalent | null | 本地 skills/ 无安全审计技能（ls skills/ = 19 目录） | 无增量（新增能力槽位） |

Requested priority ids (mass-ulw / dag-library / hyperplan) — hyperplan is not a frozen-rowSet row, so its `replacement` lives here too:

| id | in Table B | status | 承载机制 | 证据(file:line) | 等价性判断 |
|---|---|---|---|---|---|
| omo-senpi/mass-ulw | yes | partial-equivalent | agent-teams 任务板（依赖排序/扇出/验证）+ DSH workflow 工具的 agent()/pipeline()/parallel() | packages/mpd-agent-teams-plugin/lib/scheduler.js:36-84; packages/mpd-agent-teams-plugin/lib/quality-gates.js:769-812; presets/mpd/agent.cordis.yml:349-355 | 部分等价：依赖边/拓扑 hand-off/机械验证已由任务板承载；phase 边界与 run 级动词（retry/amend/send/resume）无等价物，只能落 recoveryCoverage 的 S1-S4 四项语义 |
| omo-senpi/dag-library | yes | no-equivalent | null | packages/mpd-boulder-plugin/src/index.ts:152-156（最近的本地资产：.mpd/plans 列表，文档型、不可按名重跑） | 无增量：按名复用图定义依赖 key+fingerprint 幂等与 run 句柄，本地无承载机制 |
| omo-senpi/hyperplan | no | equivalent | mpd_ultrawork({hyperplan:true})（同 5 类对抗评审） | packages/mpd-ulw-plugin/src/index.ts:147,165,180-191; packages/mpd-ulw-plugin/README.md:19-20 | 已等价（投放方式不同：固定策略引擎 flag，而非上游的交互式技能） |

## `skillPortCost` — per-skill-tree cost bands (t8 rubric input)

Counting rule (answers t8's comparability + null-vs-0 points): scope = the skill tree itself — the upstream `SKILL.md` directory, and locally `skills/<name>/`. `fileCount: 0` means measured-empty; `null` with `status: unknown|absent` is its own band (not 0, not max cost). `harnessCoupling` is `none` only when the read-only token scan found **zero** coupling tokens; whenever `couplingMeasurement` reports hits, the band is **non-none**.

| id | upstream tree (files/dirs, status) | local tree (files/dirs, status) | harnessCoupling | couplingMeasurement | repoTouchPoints |
|---|---|---|---|---|---|
| skills/remove-deadcode | 1/0 (measured) | null/null (absent) | taskTool,categoryRouting,binaries | non-none：命中 taskTool,categoryRouting,binaries（因此按 t8 规则不得判 none） | skills/**（采纳/改写目标；单写者 + 一次 VENDOR_LOCK 重钉，D_SKILLS_WRITER） · presets/mpd/agent.cordis.yml（仅当 persona/doctrine 文本改动时） · AGENTS.md（仅当约定变化时） |
| skills/security-research | 1/0 (measured) | null/null (absent) | teamTools,categoryRouting,creds | non-none：命中 teamTools,categoryRouting,creds（因此按 t8 规则不得判 none） | skills/**（采纳/改写目标；单写者 + 一次 VENDOR_LOCK 重钉，D_SKILLS_WRITER） · presets/mpd/agent.cordis.yml（仅当 persona/doctrine 文本改动时） · AGENTS.md（仅当约定变化时） |
| skills/tech-debt-audit | 1/0 (measured) | null/null (absent) | taskTool,categoryRouting,creds,binaries | non-none：命中 taskTool,categoryRouting,creds,binaries（因此按 t8 规则不得判 none） | skills/**（采纳/改写目标；单写者 + 一次 VENDOR_LOCK 重钉，D_SKILLS_WRITER） · presets/mpd/agent.cordis.yml（仅当 persona/doctrine 文本改动时） · AGENTS.md（仅当约定变化时） |
| omo-codex/rules | 1/0 (measured) | null/null (absent) | omoDir,cliOmo | non-none：命中 omoDir,cliOmo（因此按 t8 规则不得判 none） | skills/**（采纳/改写目标；单写者 + 一次 VENDOR_LOCK 重钉，D_SKILLS_WRITER） · presets/mpd/agent.cordis.yml（仅当 persona/doctrine 文本改动时） · AGENTS.md（仅当约定变化时） |
| omo-senpi/dag-library | 1/0 (measured) | null/null (absent) | envKeyOmo,omoDir,workflowTool,dagRunId,categoryRouting,cliOmo | non-none：命中 envKeyOmo,omoDir,workflowTool,dagRunId,categoryRouting,cliOmo（因此按 t8 规则不得判 none） | skills/**（采纳/改写目标；单写者 + 一次 VENDOR_LOCK 重钉，D_SKILLS_WRITER） · presets/mpd/agent.cordis.yml（仅当 persona/doctrine 文本改动时） · AGENTS.md（仅当约定变化时） |
| omo-senpi/mass-ulw | 2/1 (measured) | null/null (absent) | envKeyOmo,workflowTool,dagRunId,goalTool,taskTool,categoryRouting,cliOmo | non-none：命中 envKeyOmo,workflowTool,dagRunId,goalTool,taskTool,categoryRouting,cliOmo（因此按 t8 规则不得判 none） | skills/**（采纳/改写目标；单写者 + 一次 VENDOR_LOCK 重钉，D_SKILLS_WRITER） · presets/mpd/agent.cordis.yml（仅当 persona/doctrine 文本改动时） · AGENTS.md（仅当约定变化时） |
| skills-loader-core/dev-browser | 3/1 (measured) | null/null (absent) | workflowTool,binaries | non-none：命中 workflowTool,binaries（因此按 t8 规则不得判 none） | skills/**（采纳/改写目标；单写者 + 一次 VENDOR_LOCK 重钉，D_SKILLS_WRITER） · presets/mpd/agent.cordis.yml（仅当 persona/doctrine 文本改动时） · AGENTS.md（仅当约定变化时） |
| skills-loader-core/frontend | 1/0 (measured) | 28/6 (measured) | workflowTool,categoryRouting,creds,binaries | non-none：命中 workflowTool,categoryRouting,creds,binaries（因此按 t8 规则不得判 none） | skills/**（采纳/改写目标；单写者 + 一次 VENDOR_LOCK 重钉，D_SKILLS_WRITER） · presets/mpd/agent.cordis.yml（仅当 persona/doctrine 文本改动时） · AGENTS.md（仅当约定变化时） |
| skills-loader-core/git-master | 1/0 (measured) | 2/1 (measured) | taskTool,categoryRouting | non-none：命中 taskTool,categoryRouting（因此按 t8 规则不得判 none） | skills/**（采纳/改写目标；单写者 + 一次 VENDOR_LOCK 重钉，D_SKILLS_WRITER） · presets/mpd/agent.cordis.yml（仅当 persona/doctrine 文本改动时） · AGENTS.md（仅当约定变化时） |
| skills-loader-core/security-research | 1/0 (measured) | null/null (absent) | omoDir,teamTools,categoryRouting,cliOmo,creds | non-none：命中 omoDir,teamTools,categoryRouting,cliOmo,creds（因此按 t8 规则不得判 none） | skills/**（采纳/改写目标；单写者 + 一次 VENDOR_LOCK 重钉，D_SKILLS_WRITER） · presets/mpd/agent.cordis.yml（仅当 persona/doctrine 文本改动时） · AGENTS.md（仅当约定变化时） |

## Falsifiable assertions for `adoptable` rows

- **T3-01-default-state** — 命令/观察：翻转 packages/mpd-bundle/cordis.patch.yml 的 sessionTeamPolicy.mode 为 off 后，在隔离 DSH_HOME + 沙箱 workspace 启动一次普通会话；期望：<ws>/.mpd/team/ 不出现新团队目录、会话日志不含 '[AgentTeams] Session-start team rule'；失败表现：仍自动建队或仍注入 notice => 默认未翻转（D_FIRST 未落地）。反向：同一 revision 下输入 complex 提示期望恰好 1 个 staged 团队 + 1 条 notice，缺任一侧即 FAIL。

## S1–S4 recovery coverage (mass-ulw semantics that t5 must implement)

frozen-contract.json t4Requirements.items[2] 要求逐项报告 retry(8)/revision(2)/resume(1)/mid-run steering(0)。这些计数来自 verdict-r3.json R3F6 记录的原始命令：grep -o -i 'retry|resume|revision|steer' evidence/omo-align/research/team-vs-mass-ulw/gap.json（t2 的 gap.json）。本节的四行就是对该缺口的补齐：现在四项各有上游证据、本地对应物、判定与可机械验证点。

| id | 领域 | 上游项 | 上游证据(file:line) | 本仓库对应物 | 本仓库证据(file:line) | 判定(applicable|adoptable|already-have|uncertain) | 语义差异要点 | 可机械验证点 | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| S1 | 恢复 | node-level retry | packages/omo-senpi/skills/mass-ulw/SKILL.md:66-80 (retry：失败/取消节点获得新尝试；已完成节点复用，绝不重跑；运行中拒绝 run_still_active) | 任务板重试：captain 重派 + 冷恢复自动重排 + 质量门 repair 环 | packages/mpd-agent-teams-plugin/lib/scheduler.js:1-13,36-84,440-495 (parked attempt / cold requeue); packages/mpd-agent-teams-plugin/lib/quality-gates.js:391,659,769-812 (repair loop) | applicable | t2 词频=8 | 命令/观察：让一个任务以 failed 终止，再对其重派；期望：同一 run 内已完成任务保持 completed 且其 output 不被重算；失败表现：已完成任务被重跑或其输出丢失。 | frozen-contract.massUlwSemantics S1 |
| S2 | 恢复 | revision without re-running completed work | packages/omo-senpi/skills/mass-ulw/SKILL.md:75-80 (amend：按 node fingerprint diff，仅变更/新增节点及其传递依赖重跑；load_skills 故意在 fingerprint 之外) | agent_teams_edit_plan（原子批量改计划）+ 依赖图重排；无 fingerprint/amend 动词 | packages/mpd-agent-teams-plugin/lib/tools.js (edit_plan); packages/mpd-agent-teams-plugin/lib/scheduler.js:36-84 | applicable | t2 词频=2 | 命令/观察：修订一个已完成的 impl 任务定义（不改其上游），期望只重跑该任务及其传递依赖、未变更的已完成节点保结果；失败表现：无关的已完成节点被重跑，或其缓存结果被丢弃。（措辞以 frozen-contract.massUlwSemantics S2 为准：传递依赖是指标） | frozen-contract.massUlwSemantics S2 |
| S3 | 恢复 | resume across restart | packages/omo-senpi/skills/mass-ulw/SKILL.md:82-86 (journaled runs：进程死亡后 run 暂停，重启即恢复并复用已完成节点输出；同 key 重发返回既有 run) | 团队状态落盘 .mpd/team/<id>/team.json + agent_teams_resume（halted→running） | packages/mpd-agent-teams-plugin/lib/quality-gates.js:813-829; packages/mpd-agent-teams-plugin/lib/state.js (team.json 持久化) | applicable | t2 词频=1 | 命令/观察：在成员运行中杀掉进程并重启会话，期望团队从持久状态继续、已完成任务不重跑；失败表现：任务全部重置或重复执行。 | frozen-contract.massUlwSemantics S3 |
| S4 | 恢复 | mid-run steering | packages/omo-senpi/skills/mass-ulw/SKILL.md:88-90 (supervising：对运行中节点用 send 明确边界纠偏；漂移在第一波纠正），:74 (send 可唤醒已完成 child 继续) | agent_teams_send_message 对运行中成员投递指引（attempt 保持，不被重开） | packages/mpd-agent-teams-plugin/lib/scheduler.js:462-490 (parked attempt); AGENTS.md §5 (不打断普通提问、pause 后同 attempt 继续) | applicable | t2 词频=0 | 命令/观察：对运行中成员发出一条纠偏消息，期望其同一 attempt 收到指引且不被重启；失败表现：成员被重启或 attempt_id 被轮换。 | frozen-contract.massUlwSemantics S4 |

## F6 — name freeze / new-name rulings

| 项 | 当前值 | 裁决 | 证据(file:line) | 备注 |
|---|---|---|---|---|
| 工具名 agent_teams_*（14 个） | create/approve/edit_plan/add_member/remove_member/create_task/reassign_task/claim_task/update_task/send_message/status/resume/delete/task_contract | 冻结不得改 | frozen-contract.manualEntryNames.tools; packages/mpd-agent-teams-plugin/lib/tool-names.js; AGENTS.md §1 命名空间例外 | 新增工具允许，改名/删除禁止 |
| 斜杠指令 /agent-teams | AGENT_TEAMS_COMMAND='agent-teams' + GESTURE /^\/agent-teams(?=$\|[\t\n\r ])/u | 冻结不得改 | packages/mpd-agent-teams-plugin/lib/command.js:3,5,26 | frozenPredicate 要求该正则与常量不变 |
| 斜杠指令 /agent-teams-<profile> | /agent-teams-mpd（由 PROFILE_COMMAND_PREFIX + profileCommandName 生成） | 冻结不得改 | packages/mpd-agent-teams-plugin/lib/command.js:12-17,75-76,95-100 | 谓词约束的是生成机制 + profiles.* 键集合不变 |
| profiles.mpd（agent-teams row 的 profile 键） | mpd | 冻结不得改 | frozen-contract.manualEntryNames.profileKey; packages/mpd-bundle/cordis.patch.yml:231-235 | 键集合变化会绕过字面量检查 |
| preset id mpd | mpd（唯一随包 preset） | 冻结不得改 | AGENTS.md §1,§8; presets/mpd/; frozen-contract.manualEntryNames.presetId | 新增 preset 允许（硅谷子包已有先例），改名禁止 |
| 状态目录 .mpd/team | stateDir: .mpd/team | 冻结不得改 | packages/mpd-bundle/cordis.patch.yml:205; AGENTS.md §12 (in-use gate 扫描) ; skills/dsh-qa/scripts/*team* | 改名会同时打断 workmate in-use 门与 QA |
| 配置字段名 sessionTeamPolicy | sessionTeamPolicy | 冻结不得改 | packages/mpd-agent-teams-plugin/lib/index.js:87-98; scripts/install-profile.mjs:177,261-262; skills/dsh-qa/scripts/session-start-team.mjs:85,87,129,133 | 字段改名会同时打断 installer 自检与 QA 断言 |
| sessionTeamPolicy 取值集合 | off \| auto \| instruct | 冻结不得改 | packages/mpd-agent-teams-plugin/lib/index.js:92; frozen-contract.frozenDecisions.D_AUTOROUTE_SPLIT（'no value removed'） | 不删除取值；新增取值（如新的 auto 语义拆分）允许 |
| 新键 sessionTeamPolicy.autoRoute | 不存在（本轮新增，默认启用） | 允许新增 | frozen-contract.frozenDecisions.D_AUTOROUTE_SPLIT | 机械门与 legacy 注入解耦 |
| 复杂度门参数（complexityGate） | 不存在（本轮新增：signals + 阈值 + 两侧测试） | 允许新增 | frozen-contract.complexityGate (trigger = matchedSignals>=2 OR anyExplicitFlag) | 冻结后不得事后调参 |
| 团队显示名 MPD Default | MPD Default | 允许重命名 | packages/mpd-bundle/cordis.patch.yml:223; skills/dsh-qa/scripts/session-start-team.mjs:85,129,133 | 仅显示名；D_FIRST 后可能不再默认 provision，改名须同步 QA 断言 |
| 证据目录命名（本波 t4 产物） | evidence/omo-align/skills-gates/ | 冻结不得改 | 队长二次裁定（路径+文件名）；frozen-contract.t4Requirements.authoritativePaths（措辞滞后，见 discrepancies） | t8 的 verdict-table.md / gate-rubric.json / decisions.json 共用该目录 |
| t2/t3 证据目录命名 | evidence/omo-align/research/{team-vs-mass-ulw,session-policy}/ | 冻结不得改 | t2/t3 契约 in-scope 与已终态产出 | 不得重命名或搬迁（否则引用断裂） |
| 人类面向台账文件名 | docs/omo-parity-ledger.md + docs/omo-parity-ledger.zh-CN.md（同提交、标题下互链） | 冻结不得改 | frozen-contract.frozenDecisions.D_LEDGER; 文件已存在 | docs/omo-parity-gap.md 与既往波次报告为历史记录，本轮不动 |
| mpd_* 工具/插件前缀 | mpd_roles_list/mpd_workmate_*/mpd_ultrawork/... | 冻结不得改 | AGENTS.md §1（命名前缀 mpd） | 上游 OMO_* 二进制环境键同样不得改名 |
| .mpd/mpd.jsonc 配置文件 | .mpd/mpd.jsonc（项目层） | 冻结不得改 | packages/mpd-config-plugin/src/index.ts; AGENTS.md §6 | 新配置键在此文件内新增 |

## F5 — candidate rows for `docs/omo-parity-ledger.md` (+ zh-CN, same commit)

Ledger naming is frozen by `D_LEDGER`; `docs/omo-parity-gap.md` and prior wave reports are historical records and stay untouched. t5 writes the ledger — the rows below are candidates only.

| id | 台账条目 | 来源行 | 建议状态 | 台账现状 |
|---|---|---|---|---|
| L-01 | 会话启动默认策略：不再自动建队（D_FIRST） | T3-01-default-state, D1-activation | 待 t5 落地；台账需记录翻转前后两侧断言 | 部分（§6 文本落点） |
| L-02 | 复杂度机械门 + autoRoute 拆分（T3-04/T3-05） | T3-04-activation-trigger, T3-05-auto-routing | 待落地；阈值/信号必须与 frozen-contract.complexityGate 逐字一致 | 已索引（§3） |
| L-03 | 通知面收敛（启动 notice 仅在触发时注入） | T3-06-notice-surface | 待落地 | 否 |
| L-04 | 工具/提示面安静化（工具常驻但 usage 段条件化） | T3-03-tool-availability | 待裁决（对齐为可选） | 否 |
| L-05 | 团队关闭/回收不变量（closure） | T3-08-closure | 待落地；t3 测得 25 个残留团队 | 否 |
| L-06 | mass-ulw 四项语义 S1-S4 | S1, S2, S3, S4, D10-recovery | S1-S4 已索引；S2 措辞需按 frozen-contract 更新（见 discrepancies X3） | 是（§4 表） |
| L-07 | 成员资格：只读专家是否可作成员（本地有意偏差） | T3-07-member-eligibility | 待用户裁决 | 否 |
| L-08 | 启用面迁到 .mpd/mpd.jsonc（用户可 off/instruct） | T3-02-enable-surface | 待落地 | 否 |
| L-09 | team_mode 配置字段缺口（并行度/消息字节/未读配额/墙钟/单成员轮次） | T3-10-config-fields | 待用户裁决（上限沿用本地更宽松值） | 否 |
| L-10 | 技能语料候选（10 个 uncertain 技能行 + D12 悬空引用） | D12-skill-corpus, T3-09-skill-surface, omo-senpi/mass-ulw, omo-senpi/dag-library | 后续波次（单写者 + 一次 VENDOR_LOCK 重钉）；D_SKILLS_WRITER 规定 t9 本波不写 skills/** | 否 |
| L-11 | 名字冻结清单（F6） | T3-01-default-state, T3-02-enable-surface | 台账 §5 已列工具/指令/键；需补 .mpd/team、sessionTeamPolicy、证据目录、台账文件名 | 部分（§5） |
| L-12 | 上游参照锁定（beta.20 基线 / beta.62 对齐参照） | D12-skill-corpus | 已冻结（D_UPSTREAM_REF），台账需标明不得重钉 VENDOR_LOCK | 部分 |

## Discrepancies requiring a captain/owner ruling

| id | severity | issue | impact | owner |
|---|---|---|---|---|
| X1 | high | frozen-contract.t4Requirements.authoritativePaths 记录的是旧路径与旧文件名（evidence/omo-align/research/skills-and-capability-gap/** 与 verdict-table.md 201 行），已被队长后续两次裁定取代（skills-gates/ + gap-verdict-table.md）。冻结文件自称 single source of truth，但该字段已过期。 | 一致性校验按冻结文件读取会找不到文件或读到 t8 的文件名。 | captain |
| X2 | high | 行集合定义冲突：队长 R1 消息要求『行集合 = t2+t3 枚举并集』，而 frozen-contract.t4Requirements.rowSet 要求 10 个技能行（skills/remove-deadcode 等）。两者互不包含。 | 本交付同时给出 Table A（并集 22 行）与 Table B（frozen rowSet 10 行），并在 gap.json 中给出同一 id 集合；若队长裁定 Table B 作废，删该节即可，不会影响 Table A。 | captain |
| X3 | medium | docs/omo-parity-ledger.md §4 的 S2 措辞沿用旧句（『re-runs only the changed task AND ITS DEPENDENTS』），而 frozen-contract.massUlwSemantics.S2 已将其精化为『传递依赖』并注明 resolves Planner R4F1；台账 O5 冲突注记因此已过时。 | t5 若不更新台账，会保留一个已解决的冲突标记并可能按旧措辞实现。 | t5 (ledger writer) |
| X4 | low | t4 终态任务记录的 changedPaths 仍指向已删除的旧目录/旧文件名（终态不可变）。 | 按任务记录核对会找不到文件；以本文件的 authoritative paths 为准。 | captain |

## Reproducibility

1. Row universe comes from t2 `dimensions`, t3 `gap_matrix`, and `frozen-contract.t4Requirements.rowSet` — nothing else is added to the row set.
2. Every upstream citation is `<path>:<line>` measured in `/root/dshProj/oh-my-openagent` @ `d1557a4b4`; every local citation is `<path>:<line>` in this working tree.
3. `node build-r1.mjs` regenerates both this table and `gap.json` from the same in-memory rows, so the id sets cannot drift.

