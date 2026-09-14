# 上游功能差距判定表（输入 t8 技能门禁评分）

_Upstream capability-gap verdict table — revision **fv5** (GO-authorized switch). Supersedes fv4 (`gap.json` sha256 `cade32a6ae0346bf…`, 82509 B). t8's own files (`verdict-table.md`, `gate-rubric.json`, `decisions.json`) are NOT this document and are not modified._

Generated: 2026-09-13T15:01:51.281Z · builder `build-r2.mjs` · Researcher (read-only).

## Revision and immutability

- This revision: `gap-r2.json` + this table. fv4 (`gap.json` `cade32a6ae0346bf…` / `gap-verdict-table.md` `81855a4fed763026…`) is **unchanged**; byte-invariance is anchored to `revisions/fv4-2026-09-13T14-00-29-361Z/manifest.json` (gap.json manifest sha256 `cade32a6ae0346bf…` = on-disk ✓).
- New immutable snapshot: `revisions/fv5-<UTCstamp>/`; a line is appended to `REVISIONS.md`.
- Never touched: `verdict-table.md` (t8), `gate-rubric.json` (t8), `decisions.json` (t8).

## Dual-write wording (corrected to match disk)

> 双写位置：权威副本 = `evidence/omo-align/skills-gates/`（`gap.json` + `gap-verdict-table.md`）；注册契约副本 = `evidence/omo-align/research/skills-and-capability-gap/`（`gap.json` 与 `verdict-table.md` **两份同哈希副本均保留**，以维持注册路径可交付；该 `verdict-table.md` 是 t4 判定表的旧文件名，t8 的技能门禁表是同名文件、位于 `skills-gates/`）。两者不一致时以权威副本为准并报队长。

- 不声称任何目录已删除。X4 已按此改写（见 discrepancies）。

## Rule input (verbatim) and the D3 rule conflict

Source: `/root/dshProj/my-power-dsh/evidence/omo-align/requirements/frozen-contract.json (31705 B, sha256 a0d28ebeaf3f204e4a33480670f44f204415b16758999ce22309a99e3c9c2d65) read at 2026-09-13T15:01:51.257Z`

- (b) D3 rule: (b) D3 RULE: D3 = 1 + (counted TRUE seam booleans), clamped to [0,3].
- seam trigger set: SEAM TRIGGER set = envKeyOmo, teamTools, dagRunId, workflowTool.
- (d) evidence quality: (d) EVIDENCE QUALITY takes precedence over (c): only a hit whose evidenceQuality = mechanism counts toward D4; a prose hit is recorded but neither scored nor able to trigger V4.
- (e) V4: (e) V4 predicate: (dagRunId AND mechanism) OR (envKeyOmo AND workflowTool AND mechanism) => the only expected hits are omo-senpi/mass-ulw and omo-senpi/dag-library.
- (f) threshold: (f) THRESHOLD: vetoes (V1 equivalent, V4 runner-replacement) apply BEFORE the threshold; total >= 15 => adapt-then-install; total < 15 => skip.

**ruleConflict-D3 — status: RESOLVED** — the GO message stated `D3 = count of TRUE seam booleans (harnessSeamChange + binaryDependency)`, while the on-disk authoritative text states `(b) D3 RULE: D3 = 1 + (counted TRUE seam booleans), clamped to [0,3].`. The captain's GO adopts the on-disk (b) formula: D3 = 1 + (counted TRUE seam booleans), clamped [0,3]. The earlier GO wording ('D3 = count of TRUE seam booleans') is superseded, so both sides now agree on the on-disk text.
Per the on-disk text's own precedence clause ('Any later message that conflicts with this text is void') and the text's '(g) THE GATE RECOMPUTES and never quotes a remembered total', this deliverable publishes BOTH calibers side by side and asserts NO winning total. The gate must recompute from the row inputs.

## Fixed columns

`id | 领域 | 上游项 | 上游证据(file:line) | 本仓库对应物 | 本仓库证据(file:line) | 判定(applicable|adoptable|already-have|uncertain) | 语义差异要点 | 可机械验证点 | 备注`

### Table A — t2 ∪ t3 enumeration union (capability layer)

| id | 领域 | 上游项 | 上游证据(file:line) | 本仓库对应物 | 本仓库证据(file:line) | 判定(applicable|adoptable|already-have|uncertain) | 语义差异要点 | 可机械验证点 | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| D1-activation | 编排/团队 | 团队默认关闭 + 显式触发（team mode 关键词；mass-ulw 指针）——上游不存在会话启动默认建队 | docs/guide/team-mode.md:5-7; packages/team-core/src/config.ts:4; packages/omo-opencode/src/hooks/keyword-detector/team/default.ts:6-10; packages/omo-senpi/src/components/skill-pointers/index.ts:30-46 | 会话启动机械策略（默认 mode=auto）+ bundle 行配置 | cordis.patch.yml::agent-teams/sessionTeamPolicy (line 242; file sha256 9ee189972b2b8706…); cordis.patch.yml::agent-teams row (line 202; file sha256 9ee189972b2b8706…); packages/mpd-agent-teams-plugin/lib/session-start.js::installSessionTeamPolicy (line 437; file sha256 1f0203c69e5e904d…); packages/mpd-agent-teams-plugin/lib/session-start.js::policyQualifies (line 251; file sha256 1f0203c69e5e904d…) | applicable | 上游 OFF + 显式触发；本仓库在首个 agent/pre-step 无条件 provision 一个 staged 团队（默认 ON） | 把 sessionTeamPolicy.mode 置 off，在隔离 DSH_HOME 跑一个普通提示，观察 <ws>/.mpd/team/ 无新团队目录且日志无 STARTUP_NOTICE_MARKER | 来源 t2 D1；与 T3-01 同域但按并集要求保留两行（不合并、不删行） |
| D2-trigger-mechanism | 工具/路由 | 统一关键词表 + 隐藏的条件式 skill 指针（mention ≠ request） | packages/omo-senpi/src/components/skill-pointers/index.ts:30-46; packages/omo-senpi/AGENTS.md (keyword table; conditional pointer text) | null（本仓库任何插件都没有关键词/指针组件） | grep -rn 'keyword\|trigger\|detect' packages/mpd-agent-teams-plugin/lib -> 仅 UI i18n 命中（无机制） | applicable | 上游由输入文本关键词注入指针；本仓库只有模型自决 + 机械策略 + /agent-teams 手势 | 在 mpd 会话输入含 'mass ulw' 的提示，观察是否注入任何 <omo-*-pointer> 等价物（期望：无；本仓库无该机制） | 来源 t2 D2；t2 C3 是其候选方案，方案选择不属于本表 |
| D3-execution-surface | DAG/引擎 | 原生 workflow 工具 + eval cell + OMO_DAG_SDK_ROOT（run_id/attach/snapshot/wait/cancel/retry/send/amend + 日志化 resume） | packages/omo-senpi/skills/mass-ulw/SKILL.md:26-42 (eval 驱动), :48-64 (run 生命周期); packages/omo-senpi/plugin/runtime/dag/sdk.js:1-4; packages/omo-senpi/src/extension/dag-sdk-root-provisioning.ts:1-6 | DSH workflow 工具（JS agent()/pipeline()/parallel() 脚本，无 run_id/生命周期/日志）+ agent-teams 事件驱动任务板 | presets/mpd/agent.cordis.yml:349-355; packages/mpd-agent-teams-plugin/lib/scheduler.js:1-13,36-84,440-495 | uncertain | 同名不同机：上游 workflow=dag 运行引擎；本仓库 workflow=脚本扇出（阶段抛错仅该 item 变 null，无重试/修订/日志化恢复） | 对比可用动词：本仓库 workflow 工具无 run_id/retry/amend/resume 动词（读 presets/mpd/agent.cordis.yml:349-355 与工具 schema）；期望缺失，若存在则本行判定需重评 | 来源 t2 D3；判定 uncertain 的原因=上游项无法整体采纳（引擎缺失），只能改写为本地语义 |
| D4-dag-model | DAG | 一次 run 只覆盖一个 phase；node{id,category,dependsOn}；默认 fan-out→fan-in；2 节点无依赖不算 dag | packages/omo-senpi/skills/mass-ulw/SKILL.md:16-20; packages/omo-senpi/skills/mass-ulw/references/planning.md:23-25 | 共享任务板：task.dependencies[] + 拓扑依赖输出注入 | packages/mpd-agent-teams-plugin/lib/scheduler.js:1-13,36-84,440-495; packages/mpd-agent-teams-plugin/lib/scheduler.js:17-20 (2k/12k 截断) | applicable | 本仓库无 run/phase 边界与 node category 路由；依赖边与拓扑 hand-off 已存在 | 创建一个无依赖的 2 任务图并观察调度（本地允许；上游 doctrine 判为 not-a-dag）——差异可观测即判定成立 | 来源 t2 D4 |
| D5-node-contract | DAG/质量 | node prompt 契约 TASK/DELIVERABLE/SCOPE/VERIFY/STOP WHEN + dag-lint 建议性告警（从不拒绝） | packages/omo-senpi/src/components/task/dag-lint.ts:10-20 | 质量类任务契约（objective/acceptance/inScope/verify）+ 建卡时矛盾门 | packages/mpd-agent-teams-plugin/lib/quality-gates.js:391,659,769-812 | applicable | 本地对 quality kind 是机器校验（更强），但普通 work 任务只要求 subject；双方都缺 STOP WHEN 字段 | 创建 kind=work 任务且只给 subject -> 本地接受（上游 lint 会给告警）；观察是否落盘/告警 | 来源 t2 D5 |
| D6-verification | 质量 | 结果验证 doctrine：节点/run 完成声明在证据证明前一律为假；验证波产出证据 | packages/omo-senpi/skills/mass-ulw/SKILL.md:22-24; https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/omo-senpi/skills/mass-ulw/references/planning.md (verification wave section) | 机械质量门：verdict=pass 要求 + 自动 repair + 交付门 + 覆盖矩阵 | packages/mpd-agent-teams-plugin/lib/quality-gates.js:391,659,769-812; packages/mpd-agent-teams-plugin/lib/quality-gates.js:754-768 (buildCoverageMatrix) | already-have | 本地是机械门（比上游 doctrine 强）；可借鉴的是措辞/UX，不是机制 | 让一个 review 任务以 needs_revision 结束并观察其不可 completed（quality-gates.js:769-812） | 来源 t2 D6 |
| D7-goal-binding | 目标 | 每次 run 绑定 goal（create_goal），目标承载结果验证（PR #7175） | packages/omo-senpi/skills/mass-ulw/SKILL.md:22-24; https://github.com/code-yeongyu/oh-my-openagent/pull/7175 | harness goal 工具已挂载，但团队交付未绑定 goal | presets/mpd/agent.cordis.yml:221-225 (command-goal/tool-goal); packages/mpd-agent-teams-plugin/lib/quality-gates.js:769-812 (交付只看任务图) | applicable | 本地有 goal 能力但无 team→goal 绑定；团队可在无 goal 对象时完成 | 发起一个无 goal 的团队并走完交付：本地 canDeclareDelivery 通过（上游 doctrine 要求 goal 存在）——差异可复现 | 来源 t2 D7；与 frozen-contract 的四项 mass-ulw 语义无关（S1-S4 见专节） |
| D8-routing-doctrine | 路由 | team vs dag 的显式路由 doctrine（plain 研究→team；mass→dag；dag 节点不说话） | packages/shared-skills/skills/ulw-research/SKILL.md:159 (mass vs plain routing sentence) | preset 内的 small/large 规模判定（在已 provision 团队之后运行） | presets/mpd/agent.cordis.yml::SESSION STARTUP RULE (line 80; file sha256 125312b54b2c20e6…); packages/mpd-agent-teams-plugin/lib/session-start.js::evaluateComplexityGate (line 157; file sha256 1f0203c69e5e904d…); packages/mpd-agent-teams-plugin/lib/session-start.js::autoRouteEnabled (line 242; file sha256 1f0203c69e5e904d…) | applicable | 本地规模判定在团队建立之后，无法阻止默认建队；也从不路由到 workflow/ultrawork 平面 | 读 preset 文本确认 sizing 段落位置在 session-start 策略之后（顺序可观测）；期望：无法阻止默认 provision | 来源 t2 D8 |
| D9-scale | DAG/容量 | mass 规模：60+ 节点波次 + 难度阶梯 category 路由 + reducer | packages/omo-senpi/skills/mass-ulw/references/planning.md (category routing ladder); packages/omo-senpi/skills/mass-ulw/SKILL.md:11-14 | maxMembers 16 / 11 人 roster / 单一模型族（deepseek-v4-flash + reasoning 档） | packages/mpd-bundle/cordis.patch.yml:208,247-266 | applicable | 不同规模类：本仓库团队是对话/验证平面；60+ 扇出应落在 workflow/subagent 平面 | 统计 roster 与 maxMembers 上限并与上游节点上限对比（读 patch 行即可复现） | 来源 t2 D9 |
| D10-recovery | 恢复 | per-run retry / send / amend + 日志化跨重启 resume | packages/omo-senpi/skills/mass-ulw/SKILL.md:66-86 | per-task attempt_id + parked attempt + captain 重派 + 冷恢复重排 + 质量门 repair 环 | packages/mpd-agent-teams-plugin/lib/scheduler.js:1-13,36-84,440-495; packages/mpd-agent-teams-plugin/lib/quality-gates.js:391,659,769-812 | applicable | 粒度不同：本地按 task 恢复且需人工审阅；上游按 run 程序化恢复，无 amend/send 等价动词 | 见 S1-S4 专节（逐项可证伪断言） | 来源 t2 D10；本行由 S1-S4 专节展开（frozen-contract 明确要求逐项报告） |
| D11-human-plane | 人机/评审 | mass-ulw 路径无人机审批（关键词后自治） | packages/omo-senpi/skills/mass-ulw/SKILL.md:19-20 (keyword 后直接定义/启动) | staged plan + Web 审批（approval=required）+ edit_plan + halt/resume + 活动面板 | packages/mpd-agent-teams-plugin/lib/index.js:100-115,233-248 | already-have | 本地是严格超集（上游无审批面）；去默认化时必须保留 | staged 团队下调用 agent_teams_approve 前成员不得启动（观察 member 状态停留在 roster 行） | 来源 t2 D11 |
| D12-skill-corpus | 技能 | mass-ulw skill + references/planning.md 随产品作为一等技能发布 | packages/omo-senpi/skills/mass-ulw/SKILL.md:1-6 (frontmatter/description); packages/omo-senpi/skills/mass-ulw/references/planning.md:1-8 | 本地语料无 mass-ulw，但 skills/ulw-execute 引用它（悬空） | skills/ulw-execute/SKILL.md:103; skills/frontend/references/design/print-paged-media.md:76 | uncertain | 缺 doctrine 且存在悬空交叉引用；是否移植/改写由 t8 门禁与用户裁决 | ls skills/ \| grep mass-ulw -> 无；grep -rn 'mass-ulw' skills/ -> 2 处引用（期望=引用存在但目标缺失） | 来源 t2 D12；技能级判定细则见 Table B 与 t4 技能清单（supportingEvidence） |
| T3-01-default-state | 编排/默认策略 | Team Mode 默认 OFF，opt-in via team_mode.enabled | packages/team-core/src/config.ts:4; docs/guide/team-mode.md:5-7; packages/omo-opencode/src/features/team-mode/AGENTS.md:7 | sessionTeamPolicy.mode=auto（bundle 行启用；插件 schema 默认已是 off） | cordis.patch.yml::agent-teams/sessionTeamPolicy (line 242; file sha256 9ee189972b2b8706…); packages/mpd-agent-teams-plugin/lib/index.js::sessionTeamPolicy (line 105; file sha256 c1b170e8c9e92dcc…); install-profile.mjs::agentTeamsRow/sessionTeamPolicy (line 183; file sha256 37e9c291930d0c07…); session-start-team.mjs::selfTest (two-sided case) (line 84; file sha256 4e37e5d56ea170d4…) | adoptable | 上游默认 OFF、需显式开启；本仓库默认 ON 且机械 provision | 翻转 bundle 行的 sessionTeamPolicy.mode -> off；隔离 boot 跑普通提示；断言 .mpd/team/ 无新团队且日志无 notice；再跑一个复杂提示断言恰好产生 1 个 staged 团队 | 来源 t3 #1（与 D1 同域，按并集要求保留双行） |
| T3-02-enable-surface | 配置 | 启用面 = JSONC 配置文件（~/.omo/omo.jsonc 或 .omo/omo.jsonc）+ 重启 | docs/guide/team-mode.md:17; packages/omo-opencode/src/features/team-mode/AGENTS.md:7 | 启用面 = bundle patch 行 + installer 镜像；无用户配置平面 | cordis.patch.yml::agent-teams/sessionTeamPolicy (line 242; file sha256 9ee189972b2b8706…); install-profile.mjs::agentTeamsRow/sessionTeamPolicy (line 183; file sha256 37e9c291930d0c07…); index.js: resolved defaults (sessionTeamPolicy block) (line 103; file sha256 c1b170e8c9e92dcc…) | applicable | 上游可由用户 JSONC 开启/关闭；本地只能改 bundle 源（用户无入口） | 在 .mpd/mpd.jsonc 写入新开关并 boot，观察策略取值随之变化（当前期望：无此键 => 改动无效，即缺口可复现） | 来源 t3 #2；D_AUTOROUTE_SPLIT 规定新键名 sessionTeamPolicy.autoRoute |
| T3-03-tool-availability | 工具 | team_* 工具仅在启用时注册；工具缺席即权威信号 | packages/omo-opencode/src/plugin/tool-registry-team-tools.ts:20-21; packages/omo-opencode/src/plugin/tool-registry.ts:69-73 | agent_teams_* 工具始终注册（插件挂载）+ usage 策略始终注入 | cordis.patch.yml::agent-teams row (line 202; file sha256 9ee189972b2b8706…); cordis.patch.yml::agent-teams/sessionTeamPolicy (line 242; file sha256 9ee189972b2b8706…); packages/mpd-agent-teams-plugin/lib/session-start.js::installSessionTeamPolicy (line 437; file sha256 1f0203c69e5e904d…) | applicable | 上游用工具缺席表达关闭；本地工具常驻，只能靠提示/策略收敛，"不再默认"不等于提示面安静化 | 在 sessionTeamPolicy.mode=off 下 boot 并检查 captain prompt 是否仍包含 usage 段（期望：仍包含 => 提示面未收敛，可观测） | 来源 t3 #3 |
| T3-04-activation-trigger | 路由/触发 | 显式关键词 'team mode'（主会话）或模型判断（工具存在时） | packages/omo-opencode/src/hooks/keyword-detector/team/default.ts:6-10 | 首个 agent/pre-step 机械 provision（无关键词、无规模判断） | packages/mpd-agent-teams-plugin/lib/session-start.js::consumeExplicitFlag (line 140; file sha256 1f0203c69e5e904d…); packages/mpd-agent-teams-plugin/lib/session-start.js::consumeFlagFromMessage (line 214; file sha256 1f0203c69e5e904d…); packages/mpd-agent-teams-plugin/lib/session-start.js::evaluateComplexityGate (line 157; file sha256 1f0203c69e5e904d…); packages/mpd-agent-teams-plugin/lib/session-start.js::installSessionTeamPolicy (line 437; file sha256 1f0203c69e5e904d…) | applicable | 本地触发与任务复杂度无关；上游触发是用户显式文本 | 对同一 revision 分别跑「含 team: 前缀」与「普通」提示，观察建队是否只在后者之外发生（期望：两侧都建队 => 触发未门控） | 来源 t3 #4；机械门定义见 frozen-contract.complexityGate |
| T3-05-auto-routing | 路由 | 上游无复杂度启发式（0 hits）；路由只存在于散文（when to use） | packages/omo-opencode/src/hooks/keyword-detector/team/default.ts:6-10; docs/guide/team-mode.md:5-7（上游仅有关键词触发，无阈值代码） | preset 有 small/large 段落，但被无条件 provision 吞没 | packages/mpd-agent-teams-plugin/lib/session-start.js::evaluateComplexityGate (line 157; file sha256 1f0203c69e5e904d…); packages/mpd-agent-teams-plugin/lib/session-start.js::autoRouteEnabled (line 242; file sha256 1f0203c69e5e904d…); packages/mpd-agent-teams-plugin/lib/index.js::sessionTeamPolicy (line 105; file sha256 c1b170e8c9e92dcc…) | uncertain | 无上游项可直接采纳：复杂度门是本仓库的本地设计（必须由 frozen-contract.complexityGate 冻结，不能事后调参） | grep -rni 'complexity\|heuristic\|threshold' 上游语料（期望 0 命中，复现「无上游可抄」）；本地门的两侧测试见 T3-01 断言 | 来源 t3 #5；判定 uncertain 的原因=上游没有对应物，只能本地发明并冻结 |
| T3-06-notice-surface | 提示面 | prompts/mode/team.md + <team_mode_status> 仅在关键词后注入 | packages/prompts-core/prompts/mode/team.md:1-3 | provisionedNotice/instructNotice 对每个合格会话注入 | packages/mpd-agent-teams-plugin/lib/session-start.js::provisionedNotice (line 356; file sha256 1f0203c69e5e904d…) / packages/mpd-agent-teams-plugin/lib/session-start.js::instructNotice (line 377; file sha256 1f0203c69e5e904d…); packages/mpd-agent-teams-plugin/lib/session-start.js::spliceNotice (line 395; file sha256 1f0203c69e5e904d…); packages/mpd-agent-teams-plugin/lib/session-start.js::consumeFlagFromMessage (line 214; file sha256 1f0203c69e5e904d…) | applicable | 上游通知由触发门控；本地通知无条件注入 | 同 T3-01 的启动断言：off 模式下日志不得出现 STARTUP_NOTICE_MARKER（可 grep 会话日志） | 来源 t3 #6 |
| T3-07-member-eligibility | 成员 | 只读专家被硬拒绝为成员（成员必须能写 mailbox） | packages/team-core/src/types.ts:203-228 | mpd roster 把 6 个只读专家放进 11 人成员表（协议要求不写，但无机械限制） | cordis.patch.yml::agent-teams row (line 202; file sha256 9ee189972b2b8706…) (roster block in the same row) | applicable | 上游用机械拒绝保证成员可写；本地靠 deny list + 协议文本，语义上是有意偏差 | 检查 roster 中只读成员是否可被调度到写任务（期望：可，因为拒绝只在上游实现） | 来源 t3 #7；是否对齐需用户裁决（属可选对齐） |
| T3-08-closure | 生命周期 | 关闭不变量：所有任务终态后 lead 在同一 turn 内 shutdown + delete | packages/omo-opencode/src/features/team-mode/member-guidance.ts:38-46; packages/prompts-core/prompts/mode/team.md:1-3 | 默认团队无关闭路径，会持久残留 | packages/mpd-agent-teams-plugin/lib/session-start.js::installSessionTeamPolicy (line 437; file sha256 1f0203c69e5e904d…); AGENTS.md §12 (in-use gate scan) — symbol-free section reference (line 353; file sha256 6767f85d7fa9f354…) | applicable | 上游有机械关闭序列；本地无关闭策略，"不再默认"可能变成"不再清理" | 跑完一个团队后统计 .mpd/team 下的残留团队数（t3 measured_residue=25）；期望关闭策略落地后不增长 | 来源 t3 #8；t3 测得 25 个残留团队 |
| T3-09-skill-surface | 技能 | 内置 team-mode skill 仅在启用时加载 | packages/omo-codex/plugin/components/teammode/skills/teammode/SKILL.md:1-6 | 本地 skills/ 无 team-mode 技能；团队指引在插件 usage 段 + preset persona | ls skills/ = 19 目录（无 team-mode）; packages/mpd-agent-teams-plugin/lib/index.js:100-115 | applicable | 上游有启用时可加载的技能载体；本地指引常驻在提示面 | ls skills/ \| grep -i team -> 无（期望无；若出现则本行需重评） | 来源 t3 #9；技能语料整体判定见 Table B |
| T3-10-config-fields | 配置 | team_mode 11 个字段（并发/成员上限/消息字节/墙钟/成员轮次/base_dir 等） | packages/team-core/src/config.ts:3-15 | sessionTeamPolicy 5 字段 + 行级 stateDir/memberProvider/maxMembers | packages/mpd-bundle/cordis.patch.yml:204-224; packages/mpd-agent-teams-plugin/lib/index.js:76-98 | applicable | 上游字段面更宽；本地对等字段缺失（并行度/消息字节/未读配额/墙钟/单成员轮次） | 比对两侧字段清单（读 config.ts:3-15 与 index.js:76-98 即可复现 11 vs 5+n） | 来源 t3 #10；用户裁决 4（R4F2）要求补齐缺口字段但上限沿用本地更宽松值 |

### Table B — rows with `rowSetSource === "frozen-contract.rowSet"` (t8 skill gate: exactly these 10)

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

## `evidenceQuality` per (row, class) — matched fragments

`mechanism` = the matched line carries tool/API/env evidence (backtick, `tool.`, `env(`, `team_create(`, `run_id`, …); `prose` = the word occurs only in prose/headings. Prose hits are recorded but never score and never trigger V4.

**skills/remove-deadcode** — upstream `.agents/skills/remove-deadcode/SKILL.md`
- `taskTool` [mechanism]: L42 "task("; L42 "subagent_type"; L42 "load_skills"
- `categoryRouting` [mechanism]: L116 "category"
- `binaries` [mechanism]: L150 "bun"; L173 "bun"; L174 "bun"

**skills/security-research** — upstream `.agents/skills/security-research/SKILL.md`
- `teamTools` [mechanism]: L51 "team_create"; L54 "team_create"
- `categoryRouting` [prose]: L34 "category"; L45 "category"; L46 "category"
- `creds` [mechanism]: L69 "credential"

**skills/tech-debt-audit** — upstream `.agents/skills/tech-debt-audit/SKILL.md`
- `taskTool` [mechanism]: L173 "task("; L173 "load_skills"; L174 "task("
- `categoryRouting` [mechanism]: L173 "category"; L174 "category"
- `creds` [mechanism]: L102 "API_KEY"; L102 "TOKEN"; L142 "token"
- `binaries` [mechanism]: L87 "bun"; L101 "Bun"

**omo-codex/rules** — upstream `packages/omo-codex/plugin/components/rules/skills/rules/SKILL.md`
- `omoDir` [mechanism]: L18 ".omo"; L30 ".omo"
- `cliOmo` [mechanism]: L18 "omo"; L30 "omo"

**omo-senpi/dag-library** — upstream `packages/omo-senpi/skills/dag-library/SKILL.md`
- `envKeyOmo` [mechanism]: L16 "OMO_DAG_LIBRARY"; L35 "OMO_DAG_SDK_ROOT"; L38 "OMO_DAG_SDK_ROOT"
- `omoDir` [mechanism]: L17 ".omo"; L18 "$HOME/.omo"; L60 ".omo"
- `workflowTool` [mechanism]: L55 "tool.workflow"; L64 "tool.workflow"; L65 "tool.workflow"
- `dagRunId` [mechanism]: L43 "run_id"; L50 "amend"; L65 "run_id"
- `categoryRouting` [mechanism]: L25 "category"; L26 "category"
- `cliOmo` [mechanism]: L17 "omo"; L18 "omo"; L60 "omo"

**omo-senpi/mass-ulw** — upstream `packages/omo-senpi/skills/mass-ulw/SKILL.md`
- `envKeyOmo` [mechanism]: L28 "OMO_DAG_SDK_ROOT"; L33 "OMO_DAG_SDK_ROOT"; L53 "OMO_DAG_SDK_ROOT"
- `workflowTool` [mechanism]: L3 "workflow"; L10 "workflow"; L14 "tool.workflow"
- `dagRunId` [mechanism]: L3 "amend"; L10 "amend"; L41 "run_id"
- `goalTool` [prose]: L10 "goal"; L24 "goal"; L24 "goal"
- `taskTool` [mechanism]: L18 "load_skills"; L80 "load_skills"
- `categoryRouting` [mechanism]: L14 "category"; L18 "category"; L20 "category"
- `cliOmo` [mechanism]: L95 "/dag"; L96 "omo"; L96 "omo"

**skills-loader-core/dev-browser** — upstream `packages/skills-loader-core/src/features/builtin-skills/dev-browser/SKILL.md`
- `workflowTool` [prose]: L8 "workflow"
- `binaries` [prose]: L24 "Chromium"; L136 "Playwright"

**skills-loader-core/frontend** — upstream `packages/skills-loader-core/src/features/builtin-skills/frontend/SKILL.md`
- `workflowTool` [prose]: L65 "workflow"; L112 "workflow"; L132 "workflow"
- `categoryRouting` [prose]: L21 "category"; L87 "category"
- `creds` [prose]: L19 "token"; L20 "token"; L32 "token"
- `binaries` [prose]: L21 "Playwright"; L21 "Chromium"; L88 "Playwright"

**skills-loader-core/git-master** — upstream `packages/skills-loader-core/src/features/builtin-skills/git-master/SKILL.md`
- `taskTool` [prose]: L3 "task("; L3 "load_skills"
- `categoryRouting` [prose]: L3 "category"

**skills-loader-core/security-research** — upstream `packages/skills-loader-core/src/features/builtin-skills/security-research/SKILL.md`
- `omoDir` [mechanism]: L10 ".omo"
- `teamTools` [mechanism]: L46 "team_create"; L49 "team_create"
- `categoryRouting` [prose]: L29 "category"; L40 "category"; L41 "category"
- `cliOmo` [mechanism]: L10 "omo"; L10 "omo"
- `creds` [mechanism]: L64 "credential"

## Three record-only booleans (Table B)

Only `harnessSeamChange` and `binaryDependency` are 'counted' seam booleans; `credentialDependency` never scores. All three are RECORD-ONLY inputs — the gate computes the score.

| id | harnessSeamChange | evidenceQuality | binaryDependency | credentialDependency | evidence (fragment + line) |
|---|---|---|---|---|---|
| skills/remove-deadcode | false | none | true | false | no seam-trigger class in the frozen class table · L35 "bunx tsc" |
| skills/security-research | true | mechanism | false | unknown (falsePositiveRisk) | teamTools: L51 "team_create" · no executable command (bun/bunx/node/npx/npm/pnpm/yarn/uv/deno/python/bash/sh or a script path) in the skill's own SKILL.md · L69 "credential" (mechanism) |
| skills/tech-debt-audit | false | none | true | unknown (falsePositiveRisk) | no seam-trigger class in the frozen class table · L87 "("bun test" · L102 "API_KEY" (mechanism) |
| omo-codex/rules | false | none | false | false | no seam-trigger class in the frozen class table · no executable command (bun/bunx/node/npx/npm/pnpm/yarn/uv/deno/python/bash/sh or a script path) in the skill's own SKILL.md |
| omo-senpi/dag-library | true | mechanism | true | false | envKeyOmo: L16 "OMO_DAG_LIBRARY" · L38 "const lib = await import(`${env("OMO_DAG_SDK_ROOT")}/library.js`)" |
| omo-senpi/mass-ulw | true | mechanism | true | false | envKeyOmo: L28 "OMO_DAG_SDK_ROOT" · L33 "const sdk = await import(`${env("OMO_DAG_SDK_ROOT")}/sdk.js`)" |
| skills-loader-core/dev-browser | false | prose | true | false | workflowTool: L8 "workflow" (prose-only, per-match classification) · L27 "./skills/dev-browser/server.sh" |
| skills-loader-core/frontend | false | prose | true | unknown (falsePositiveRisk) | workflowTool: L65 "workflow" (prose-only, per-match classification) · L93 "uv run" · L19 "token" (prose) |
| skills-loader-core/git-master | false | none | false | false | no seam-trigger class in the frozen class table · no executable command (bun/bunx/node/npx/npm/pnpm/yarn/uv/deno/python/bash/sh or a script path) in the skill's own SKILL.md |
| skills-loader-core/security-research | true | mechanism | false | unknown (falsePositiveRisk) | teamTools: L46 "team_create" · no executable command (bun/bunx/node/npx/npm/pnpm/yarn/uv/deno/python/bash/sh or a script path) in the skill's own SKILL.md · L64 "credential" (mechanism) |

## Full 10-row derivation table (so a third party can recompute from raw)

| id | classes (frozen, case-sensitive derivation) | seam(mechanism) | bin | cred | counted TRUE seam booleans | D3 (GO caliber = count) | D3 (on-disk caliber = 1+count, clamp 3) |
|---|---|---|---|---|---|---|---|
| skills/remove-deadcode | taskTool, categoryRouting, binaries | false | true | false | 1 | 1 | 2 |
| skills/security-research | teamTools, categoryRouting, creds | true | false | unknown | 1 | 1 | 2 |
| skills/tech-debt-audit | taskTool, categoryRouting, creds, binaries | false | true | unknown | 1 | 1 | 2 |
| omo-codex/rules | omoDir, cliOmo | false | false | false | 0 | 0 | 1 |
| omo-senpi/dag-library | envKeyOmo, omoDir, workflowTool, dagRunId, categoryRouting, cliOmo | true | true | false | 2 | 2 | 3 |
| omo-senpi/mass-ulw | envKeyOmo, workflowTool, dagRunId, goalTool, taskTool, categoryRouting, cliOmo | true | true | false | 2 | 2 | 3 |
| skills-loader-core/dev-browser | workflowTool, binaries | false | true | false | 1 | 1 | 2 |
| skills-loader-core/frontend | workflowTool, categoryRouting, creds, binaries | false | true | unknown | 1 | 1 | 2 |
| skills-loader-core/git-master | taskTool, categoryRouting | false | false | false | 0 | 0 | 1 |
| skills-loader-core/security-research | omoDir, teamTools, categoryRouting, cliOmo, creds | true | false | unknown | 1 | 1 | 2 |

`token SUMS are never used` (on-disk rule): the seam count vs token sum differs (git-master 0 vs 3; mass-ulw 1 vs 36). Case sensitivity: the seam/annotation class patterns are case-**sensitive**; uppercase prose such as git-master's "RESET WORKFLOW" / "Autosquash Workflow" therefore never entered the `workflowTool` class — that is why git-master carries no V4 risk. `creds`/`binaries` patterns were derived case-insensitively in the raw record; that is recorded here so nobody re-derives a different class set.

## `replacement.status` change (data change, action unchanged)

- **skills-loader-core/frontend**: `equivalent` → **`partial-equivalent`** — 部分等价（同名但内容不同 ⇒ 损失 ≠ 0）：本地 skills/frontend 151 行/28 文件 vs 上游 shared-skills 29 文件（含 +references/design/ambience-skill.md）；builtin 为另一份单文件包装（154 行/1 文件）。动作不变（门禁内本就 skip）。
  - contentDrift: 本地 SKILL.md 151 行 / sha 159c32005214c162… vs upstream(shared-skills & builtin 同) 154 行 / sha 82d4715eb56059dd…；漂移集中在 reference 文件（+ambience-skill.md）。
  - before→after (loss narrative): "0" → "content-refresh increment"; action unchanged (skip in the gate).
- **skills-loader-core/git-master**: `equivalent` → **`partial-equivalent`** — 部分等价（同名但内容不同 ⇒ 损失 ≠ 0）：本地 skills/git-master 104 行/2 文件 vs 上游 builtin 1107 行/1 文件。动作不变（门禁内本就 skip）。
  - contentDrift: 本地 SKILL.md 104 行 / 2 文件 vs 上游 builtin 1107 行 / 1 文件。
  - before→after (loss narrative): "0" → "content-refresh increment"; action unchanged (skip in the gate).

## `waveGoalMapping` (D2 caliber visibility; no score change this wave)

D2 scoring is NOT changed by this revision (t8 already scored against the fv4 keys; no re-scoring this wave). This section only states the correspondence so the caliber question is visible.
- authoritative **G1 不再默认建队** ↔ fv4 key `goal2_agentTeamsNotDefault`
- authoritative **G2 复杂任务自动调用** ↔ fv4 key `goal3_autoRouting`
- authoritative **G3 对齐 mass-ulw (S1–S4)** ↔ fv4 key `goal4_massUlwDag`
- authoritative **G4 配置平面对齐** ↔ fv4 key `(none)` — no independent fv4 key
- reverse: fv4 key `goal1_omoAlignment` ↔ (none) — umbrella item with no one-to-one authoritative goal

## `userApprovedOverrides`

- **skills/remove-deadcode** → `skip` (score 14) — source: frozen-contract (g), the authoritative text: "(g) ... t19 ... harnessSeamChange is FALSE and counted = 1 via binaryDependency => D3 = 2 ... => total 14 => skip"; alternative: GO message (D3 = count of TRUE seam booleans) => D3 = 1; the gate recomputes the total. User-approved skill; after t19’s independent measurement (no-seam-required) the action lands on skip. The score is QUOTED from the authoritative text, which also states the gate always recomputes. The user may confirm or withdraw.
- **skills/security-research** → `adapt-then-install` (score 19) — source: gate owner (t8) recomputation under (b) as reported in review; alternative: GO message (score 18). Adapt under both calibers, so the action is caliber-insensitive. The user may confirm or withdraw.
- **skills/tech-debt-audit** → `adapt-then-install` (score 18) — source: gate owner (t8) recomputation under (b) as reported in review; alternative: GO message (score 17). Adapt under both calibers. The user may confirm or withdraw.
- **skills-loader-core/security-research** → `adapt-then-install` (score 19) — source: gate owner (t8) recomputation under (b) as reported in review; raw record looked up BY PATH (its name field is empty); alternative: GO message (score 19). Adapt under both calibers. The user may confirm or withdraw.

## discrepancies

| id | severity | issue | impact | owner |
|---|---|---|---|---|
| X4 (rewritten) | low | t4 终态任务记录的 changedPaths 指向**合同旧路径**；该路径现由同哈希双写副本占用（两份均保留），**非删除状态**。 | 按终态记录核对时以本表与 authoritative paths 为准。 | captain |
| ruleConflict-D3 | resolved | GO 与磁盘权威文本的 D3 口径不一致 —— 已由 GO 采纳磁盘 (b) 式（`1 + counted`）收口。 | 双方一致；门禁按 (b) 重算，不引用记忆总分。 | captain |

## Reproducibility

1. Row set and carried sections come from fv4 (`gap.json`). 2. Class lists are the frozen `upstreamHarnessCoupling` (spelling unchanged). 3. Per-class evidence is measured on the upstream checkout (`/root/dshProj/oh-my-openagent`). 4. Anchors are `file::symbol` + line (auxiliary) + the file's sha256 at read time (table in `gap-r2.json.anchorReadTimeHashes`). 5. `build-r2.mjs` regenerates this table and `gap-r2.json` from the same in-memory rows.

