// t4 contract-revision R1 generator. Emits, inside evidence/omo-align/skills-gates/:
//   gap.json              — the same id set as the table, one object per row, fixed column fields
//   gap-verdict-table.md  — fixed 10-column judgment table + name-freeze table + ledger candidates + S1-S4 coverage
// Row set = union of the t2 enumeration (D1..D12) and the t3 enumeration (T3-01..T3-10),
// PLUS the rows named by frozen-contract.json t4Requirements.rowSet (kept as a separate, labeled table
// because that frozen field names 10 skill rows that the union does not contain — see discrepancies).
// Sources are read-only; only these two files are written.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const REPO = "/root/dshProj/my-power-dsh";
const UP = "/root/dshProj/oh-my-openagent";
const UP_COMMIT = "d1557a4b48fdbec06a7144fdc4afa3e65c6523ed";
const UP_VERSION = "5.0.0-beta.62";

const COLUMNS = ["id", "领域", "上游项", "上游证据(file:line)", "本仓库对应物", "本仓库证据(file:line)", "判定(applicable|adoptable|already-have|uncertain)", "语义差异要点", "可机械验证点", "备注"];

// Frequently cited anchors (all verified by reading the two checkouts).
const E = {
  upTeamOff: "docs/guide/team-mode.md:5-7",
  upTeamCfg: "packages/team-core/src/config.ts:4",
  upTeamFields: "packages/team-core/src/config.ts:3-15",
  upTeamAgents: "packages/omo-opencode/src/features/team-mode/AGENTS.md:7",
  upKeyword: "packages/omo-opencode/src/hooks/keyword-detector/team/default.ts:6-10",
  upToolGate: "packages/omo-opencode/src/plugin/tool-registry-team-tools.ts:20-21; packages/omo-opencode/src/plugin/tool-registry.ts:69-73",
  upModePrompt: "packages/prompts-core/prompts/mode/team.md:1-3",
  upConfigPlane: "docs/guide/team-mode.md:17",
  upReadonly: "packages/team-core/src/types.ts:203-228",
  upClosure: "packages/omo-opencode/src/features/team-mode/member-guidance.ts:38-46; packages/prompts-core/prompts/mode/team.md:1-3",
  upPointers: "packages/omo-senpi/src/components/skill-pointers/index.ts:30-46",
  upMassUlw: "packages/omo-senpi/skills/mass-ulw/SKILL.md",
  upPlanning: "packages/omo-senpi/skills/mass-ulw/references/planning.md",
  upDagLib: "packages/omo-senpi/skills/dag-library/SKILL.md",
  upDagSdk: "packages/omo-senpi/plugin/runtime/dag/sdk.js:1-4; packages/omo-senpi/src/extension/dag-sdk-root-provisioning.ts:1-6",
  upDagLint: "packages/omo-senpi/src/components/task/dag-lint.ts:10-20",
  upUlwResearch: "packages/shared-skills/skills/ulw-research/SKILL.md:159 (mass vs plain routing sentence)",
  upHyperplan: "packages/omo-senpi/skills/hyperplan/SKILL.md:18-31,44-46",
  localPolicy: "packages/mpd-agent-teams-plugin/lib/session-start.js:229-269",
  localQualify: "packages/mpd-agent-teams-plugin/lib/session-start.js:71-84",
  localProvision: "packages/mpd-agent-teams-plugin/lib/session-start.js:123-168",
  localNotices: "packages/mpd-agent-teams-plugin/lib/session-start.js:174-203",
  localSchema: "packages/mpd-agent-teams-plugin/lib/index.js:87-98",
  localRow: "packages/mpd-bundle/cordis.patch.yml:202-224",
  localInstaller: "scripts/install-profile.mjs:177,261-262",
  localQa: "skills/dsh-qa/scripts/session-start-team.mjs:85,87,129,133",
  localCommand: "packages/mpd-agent-teams-plugin/lib/command.js:3,5,26",
  localPreset: "presets/mpd/agent.cordis.yml:80-102",
  localScheduler: "packages/mpd-agent-teams-plugin/lib/scheduler.js:1-13,36-84,440-495",
  localGates: "packages/mpd-agent-teams-plugin/lib/quality-gates.js:391,659,769-812",
  localResume: "packages/mpd-agent-teams-plugin/lib/quality-gates.js:813-829",
  localWorkflowRow: "presets/mpd/agent.cordis.yml:349-355",
  localBundleReadme: "packages/mpd-bundle/README.md:22-42",
  localDangling: "skills/ulw-execute/SKILL.md:103; skills/frontend/references/design/print-paged-media.md:76",
};

const GH = "https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/omo-senpi/skills/";

// ── Table A part 1: the t2 enumeration (D1..D12), reproduced row-per-dimension ──────────────────
const ROWS_T2 = [
  {
    id: "D1-activation", domain: "编排/团队",
    upstreamItem: "团队默认关闭 + 显式触发（team mode 关键词；mass-ulw 指针）——上游不存在会话启动默认建队",
    upstreamEvidence: `${E.upTeamOff}; ${E.upTeamCfg}; ${E.upKeyword}; ${E.upPointers}`,
    repoCounterpart: "会话启动机械策略（默认 mode=auto）+ bundle 行配置",
    repoEvidence: `${E.localPolicy}; ${E.localRow}`,
    verdict: "applicable",
    semanticDiff: "上游 OFF + 显式触发；本仓库在首个 agent/pre-step 无条件 provision 一个 staged 团队（默认 ON）",
    mechanicalCheck: "把 sessionTeamPolicy.mode 置 off，在隔离 DSH_HOME 跑一个普通提示，观察 <ws>/.mpd/team/ 无新团队目录且日志无 STARTUP_NOTICE_MARKER",
    notes: "来源 t2 D1；与 T3-01 同域但按并集要求保留两行（不合并、不删行）",
  },
  {
    id: "D2-trigger-mechanism", domain: "工具/路由",
    upstreamItem: "统一关键词表 + 隐藏的条件式 skill 指针（mention ≠ request）",
    upstreamEvidence: `${E.upPointers}; packages/omo-senpi/AGENTS.md (keyword table; conditional pointer text)`,
    repoCounterpart: "null（本仓库任何插件都没有关键词/指针组件）",
    repoEvidence: "grep -rn 'keyword|trigger|detect' packages/mpd-agent-teams-plugin/lib -> 仅 UI i18n 命中（无机制）",
    verdict: "applicable",
    semanticDiff: "上游由输入文本关键词注入指针；本仓库只有模型自决 + 机械策略 + /agent-teams 手势",
    mechanicalCheck: "在 mpd 会话输入含 'mass ulw' 的提示，观察是否注入任何 <omo-*-pointer> 等价物（期望：无；本仓库无该机制）",
    notes: "来源 t2 D2；t2 C3 是其候选方案，方案选择不属于本表",
  },
  {
    id: "D3-execution-surface", domain: "DAG/引擎",
    upstreamItem: "原生 workflow 工具 + eval cell + OMO_DAG_SDK_ROOT（run_id/attach/snapshot/wait/cancel/retry/send/amend + 日志化 resume）",
    upstreamEvidence: `${E.upMassUlw}:26-42 (eval 驱动), :48-64 (run 生命周期); ${E.upDagSdk}`,
    repoCounterpart: "DSH workflow 工具（JS agent()/pipeline()/parallel() 脚本，无 run_id/生命周期/日志）+ agent-teams 事件驱动任务板",
    repoEvidence: `${E.localWorkflowRow}; ${E.localScheduler}`,
    verdict: "uncertain",
    semanticDiff: "同名不同机：上游 workflow=dag 运行引擎；本仓库 workflow=脚本扇出（阶段抛错仅该 item 变 null，无重试/修订/日志化恢复）",
    mechanicalCheck: "对比可用动词：本仓库 workflow 工具无 run_id/retry/amend/resume 动词（读 presets/mpd/agent.cordis.yml:349-355 与工具 schema）；期望缺失，若存在则本行判定需重评",
    notes: "来源 t2 D3；判定 uncertain 的原因=上游项无法整体采纳（引擎缺失），只能改写为本地语义",
  },
  {
    id: "D4-dag-model", domain: "DAG",
    upstreamItem: "一次 run 只覆盖一个 phase；node{id,category,dependsOn}；默认 fan-out→fan-in；2 节点无依赖不算 dag",
    upstreamEvidence: `${E.upMassUlw}:16-20; ${E.upPlanning}:23-25`,
    repoCounterpart: "共享任务板：task.dependencies[] + 拓扑依赖输出注入",
    repoEvidence: `${E.localScheduler}; packages/mpd-agent-teams-plugin/lib/scheduler.js:17-20 (2k/12k 截断)`,
    verdict: "applicable",
    semanticDiff: "本仓库无 run/phase 边界与 node category 路由；依赖边与拓扑 hand-off 已存在",
    mechanicalCheck: "创建一个无依赖的 2 任务图并观察调度（本地允许；上游 doctrine 判为 not-a-dag）——差异可观测即判定成立",
    notes: "来源 t2 D4",
  },
  {
    id: "D5-node-contract", domain: "DAG/质量",
    upstreamItem: "node prompt 契约 TASK/DELIVERABLE/SCOPE/VERIFY/STOP WHEN + dag-lint 建议性告警（从不拒绝）",
    upstreamEvidence: `${E.upDagLint}`,
    repoCounterpart: "质量类任务契约（objective/acceptance/inScope/verify）+ 建卡时矛盾门",
    repoEvidence: `${E.localGates}`,
    verdict: "applicable",
    semanticDiff: "本地对 quality kind 是机器校验（更强），但普通 work 任务只要求 subject；双方都缺 STOP WHEN 字段",
    mechanicalCheck: "创建 kind=work 任务且只给 subject -> 本地接受（上游 lint 会给告警）；观察是否落盘/告警",
    notes: "来源 t2 D5",
  },
  {
    id: "D6-verification", domain: "质量",
    upstreamItem: "结果验证 doctrine：节点/run 完成声明在证据证明前一律为假；验证波产出证据",
    upstreamEvidence: `${E.upMassUlw}:22-24; ${GH}mass-ulw/references/planning.md (verification wave section)`,
    repoCounterpart: "机械质量门：verdict=pass 要求 + 自动 repair + 交付门 + 覆盖矩阵",
    repoEvidence: `${E.localGates}; packages/mpd-agent-teams-plugin/lib/quality-gates.js:754-768 (buildCoverageMatrix)`,
    verdict: "already-have",
    semanticDiff: "本地是机械门（比上游 doctrine 强）；可借鉴的是措辞/UX，不是机制",
    mechanicalCheck: "让一个 review 任务以 needs_revision 结束并观察其不可 completed（quality-gates.js:769-812）",
    notes: "来源 t2 D6",
  },
  {
    id: "D7-goal-binding", domain: "目标",
    upstreamItem: "每次 run 绑定 goal（create_goal），目标承载结果验证（PR #7175）",
    upstreamEvidence: `${E.upMassUlw}:22-24; https://github.com/code-yeongyu/oh-my-openagent/pull/7175`,
    repoCounterpart: "harness goal 工具已挂载，但团队交付未绑定 goal",
    repoEvidence: "presets/mpd/agent.cordis.yml:221-225 (command-goal/tool-goal); packages/mpd-agent-teams-plugin/lib/quality-gates.js:769-812 (交付只看任务图)",
    verdict: "applicable",
    semanticDiff: "本地有 goal 能力但无 team→goal 绑定；团队可在无 goal 对象时完成",
    mechanicalCheck: "发起一个无 goal 的团队并走完交付：本地 canDeclareDelivery 通过（上游 doctrine 要求 goal 存在）——差异可复现",
    notes: "来源 t2 D7；与 frozen-contract 的四项 mass-ulw 语义无关（S1-S4 见专节）",
  },
  {
    id: "D8-routing-doctrine", domain: "路由",
    upstreamItem: "team vs dag 的显式路由 doctrine（plain 研究→team；mass→dag；dag 节点不说话）",
    upstreamEvidence: `${E.upUlwResearch}`,
    repoCounterpart: "preset 内的 small/large 规模判定（在已 provision 团队之后运行）",
    repoEvidence: `${E.localPreset}; ${E.localPolicy}`,
    verdict: "applicable",
    semanticDiff: "本地规模判定在团队建立之后，无法阻止默认建队；也从不路由到 workflow/ultrawork 平面",
    mechanicalCheck: "读 preset 文本确认 sizing 段落位置在 session-start 策略之后（顺序可观测）；期望：无法阻止默认 provision",
    notes: "来源 t2 D8",
  },
  {
    id: "D9-scale", domain: "DAG/容量",
    upstreamItem: "mass 规模：60+ 节点波次 + 难度阶梯 category 路由 + reducer",
    upstreamEvidence: `${E.upPlanning} (category routing ladder); ${E.upMassUlw}:11-14`,
    repoCounterpart: "maxMembers 16 / 11 人 roster / 单一模型族（deepseek-v4-flash + reasoning 档）",
    repoEvidence: "packages/mpd-bundle/cordis.patch.yml:208,247-266",
    verdict: "applicable",
    semanticDiff: "不同规模类：本仓库团队是对话/验证平面；60+ 扇出应落在 workflow/subagent 平面",
    mechanicalCheck: "统计 roster 与 maxMembers 上限并与上游节点上限对比（读 patch 行即可复现）",
    notes: "来源 t2 D9",
  },
  {
    id: "D10-recovery", domain: "恢复",
    upstreamItem: "per-run retry / send / amend + 日志化跨重启 resume",
    upstreamEvidence: `${E.upMassUlw}:66-86`,
    repoCounterpart: "per-task attempt_id + parked attempt + captain 重派 + 冷恢复重排 + 质量门 repair 环",
    repoEvidence: `${E.localScheduler}; ${E.localGates}`,
    verdict: "applicable",
    semanticDiff: "粒度不同：本地按 task 恢复且需人工审阅；上游按 run 程序化恢复，无 amend/send 等价动词",
    mechanicalCheck: "见 S1-S4 专节（逐项可证伪断言）",
    notes: "来源 t2 D10；本行由 S1-S4 专节展开（frozen-contract 明确要求逐项报告）",
  },
  {
    id: "D11-human-plane", domain: "人机/评审",
    upstreamItem: "mass-ulw 路径无人机审批（关键词后自治）",
    upstreamEvidence: `${E.upMassUlw}:19-20 (keyword 后直接定义/启动)`,
    repoCounterpart: "staged plan + Web 审批（approval=required）+ edit_plan + halt/resume + 活动面板",
    repoEvidence: "packages/mpd-agent-teams-plugin/lib/index.js:100-115,233-248",
    verdict: "already-have",
    semanticDiff: "本地是严格超集（上游无审批面）；去默认化时必须保留",
    mechanicalCheck: "staged 团队下调用 agent_teams_approve 前成员不得启动（观察 member 状态停留在 roster 行）",
    notes: "来源 t2 D11",
  },
  {
    id: "D12-skill-corpus", domain: "技能",
    upstreamItem: "mass-ulw skill + references/planning.md 随产品作为一等技能发布",
    upstreamEvidence: `${E.upMassUlw}:1-6 (frontmatter/description); ${E.upPlanning}:1-8`,
    repoCounterpart: "本地语料无 mass-ulw，但 skills/ulw-execute 引用它（悬空）",
    repoEvidence: `${E.localDangling}`,
    verdict: "uncertain",
    semanticDiff: "缺 doctrine 且存在悬空交叉引用；是否移植/改写由 t8 门禁与用户裁决",
    mechanicalCheck: "ls skills/ | grep mass-ulw -> 无；grep -rn 'mass-ulw' skills/ -> 2 处引用（期望=引用存在但目标缺失）",
    notes: "来源 t2 D12；技能级判定细则见 Table B 与 t4 技能清单（supportingEvidence）",
  },
];

// ── Table A part 2: the t3 enumeration (T3-01..T3-10) ────────────────────────────────────────────
const ROWS_T3 = [
  {
    id: "T3-01-default-state", domain: "编排/默认策略",
    upstreamItem: "Team Mode 默认 OFF，opt-in via team_mode.enabled",
    upstreamEvidence: `${E.upTeamCfg}; ${E.upTeamOff}; ${E.upTeamAgents}`,
    repoCounterpart: "sessionTeamPolicy.mode=auto（bundle 行启用；插件 schema 默认已是 off）",
    repoEvidence: `${E.localRow}; ${E.localSchema}`,
    verdict: "adoptable",
    semanticDiff: "上游默认 OFF、需显式开启；本仓库默认 ON 且机械 provision",
    mechanicalCheck: "翻转 bundle 行的 sessionTeamPolicy.mode -> off；隔离 boot 跑普通提示；断言 .mpd/team/ 无新团队且日志无 notice；再跑一个复杂提示断言恰好产生 1 个 staged 团队",
    notes: "来源 t3 #1（与 D1 同域，按并集要求保留双行）",
    falsifiableAssertion:
      "命令/观察：翻转 packages/mpd-bundle/cordis.patch.yml 的 sessionTeamPolicy.mode 为 off 后，在隔离 DSH_HOME + 沙箱 workspace 启动一次普通会话；期望：<ws>/.mpd/team/ 不出现新团队目录、会话日志不含 '[AgentTeams] Session-start team rule'；失败表现：仍自动建队或仍注入 notice => 默认未翻转（D_FIRST 未落地）。反向：同一 revision 下输入 complex 提示期望恰好 1 个 staged 团队 + 1 条 notice，缺任一侧即 FAIL。",
  },
  {
    id: "T3-02-enable-surface", domain: "配置",
    upstreamItem: "启用面 = JSONC 配置文件（~/.omo/omo.jsonc 或 .omo/omo.jsonc）+ 重启",
    upstreamEvidence: `${E.upConfigPlane}; ${E.upTeamAgents}`,
    repoCounterpart: "启用面 = bundle patch 行 + installer 镜像；无用户配置平面",
    repoEvidence: `${E.localRow}; ${E.localInstaller}; packages/mpd-config-plugin/src/index.ts (mpd.jsonc 层)`,
    verdict: "applicable",
    semanticDiff: "上游可由用户 JSONC 开启/关闭；本地只能改 bundle 源（用户无入口）",
    mechanicalCheck: "在 .mpd/mpd.jsonc 写入新开关并 boot，观察策略取值随之变化（当前期望：无此键 => 改动无效，即缺口可复现）",
    notes: "来源 t3 #2；D_AUTOROUTE_SPLIT 规定新键名 sessionTeamPolicy.autoRoute",
  },
  {
    id: "T3-03-tool-availability", domain: "工具",
    upstreamItem: "team_* 工具仅在启用时注册；工具缺席即权威信号",
    upstreamEvidence: `${E.upToolGate}`,
    repoCounterpart: "agent_teams_* 工具始终注册（插件挂载）+ usage 策略始终注入",
    repoEvidence: "packages/mpd-bundle/cordis.patch.yml:202-203 (row always mounted); packages/mpd-agent-teams-plugin/lib/index.js:100-115 (usageSectionText 常驻)",
    verdict: "applicable",
    semanticDiff: "上游用工具缺席表达关闭；本地工具常驻，只能靠提示/策略收敛，\"不再默认\"不等于提示面安静化",
    mechanicalCheck: "在 sessionTeamPolicy.mode=off 下 boot 并检查 captain prompt 是否仍包含 usage 段（期望：仍包含 => 提示面未收敛，可观测）",
    notes: "来源 t3 #3",
  },
  {
    id: "T3-04-activation-trigger", domain: "路由/触发",
    upstreamItem: "显式关键词 'team mode'（主会话）或模型判断（工具存在时）",
    upstreamEvidence: `${E.upKeyword}`,
    repoCounterpart: "首个 agent/pre-step 机械 provision（无关键词、无规模判断）",
    repoEvidence: `${E.localPolicy}; ${E.localQualify}`,
    verdict: "applicable",
    semanticDiff: "本地触发与任务复杂度无关；上游触发是用户显式文本",
    mechanicalCheck: "对同一 revision 分别跑「含 team: 前缀」与「普通」提示，观察建队是否只在后者之外发生（期望：两侧都建队 => 触发未门控）",
    notes: "来源 t3 #4；机械门定义见 frozen-contract.complexityGate",
  },
  {
    id: "T3-05-auto-routing", domain: "路由",
    upstreamItem: "上游无复杂度启发式（0 hits）；路由只存在于散文（when to use）",
    upstreamEvidence: `${E.upKeyword}; ${E.upTeamOff}（上游仅有关键词触发，无阈值代码）`,
    repoCounterpart: "preset 有 small/large 段落，但被无条件 provision 吞没",
    repoEvidence: `${E.localPreset}; ${E.localPolicy}`,
    verdict: "uncertain",
    semanticDiff: "无上游项可直接采纳：复杂度门是本仓库的本地设计（必须由 frozen-contract.complexityGate 冻结，不能事后调参）",
    mechanicalCheck: "grep -rni 'complexity|heuristic|threshold' 上游语料（期望 0 命中，复现「无上游可抄」）；本地门的两侧测试见 T3-01 断言",
    notes: "来源 t3 #5；判定 uncertain 的原因=上游没有对应物，只能本地发明并冻结",
  },
  {
    id: "T3-06-notice-surface", domain: "提示面",
    upstreamItem: "prompts/mode/team.md + <team_mode_status> 仅在关键词后注入",
    upstreamEvidence: `${E.upModePrompt}`,
    repoCounterpart: "provisionedNotice/instructNotice 对每个合格会话注入",
    repoEvidence: `${E.localNotices}`,
    verdict: "applicable",
    semanticDiff: "上游通知由触发门控；本地通知无条件注入",
    mechanicalCheck: "同 T3-01 的启动断言：off 模式下日志不得出现 STARTUP_NOTICE_MARKER（可 grep 会话日志）",
    notes: "来源 t3 #6",
  },
  {
    id: "T3-07-member-eligibility", domain: "成员",
    upstreamItem: "只读专家被硬拒绝为成员（成员必须能写 mailbox）",
    upstreamEvidence: `${E.upReadonly}`,
    repoCounterpart: "mpd roster 把 6 个只读专家放进 11 人成员表（协议要求不写，但无机械限制）",
    repoEvidence: "packages/mpd-bundle/cordis.patch.yml:247-266; AGENTS.md §13 (read-only deny list)",
    verdict: "applicable",
    semanticDiff: "上游用机械拒绝保证成员可写；本地靠 deny list + 协议文本，语义上是有意偏差",
    mechanicalCheck: "检查 roster 中只读成员是否可被调度到写任务（期望：可，因为拒绝只在上游实现）",
    notes: "来源 t3 #7；是否对齐需用户裁决（属可选对齐）",
  },
  {
    id: "T3-08-closure", domain: "生命周期",
    upstreamItem: "关闭不变量：所有任务终态后 lead 在同一 turn 内 shutdown + delete",
    upstreamEvidence: `${E.upClosure}`,
    repoCounterpart: "默认团队无关闭路径，会持久残留",
    repoEvidence: `${E.localPolicy}; AGENTS.md §12 (in-use gate 扫描 .mpd/team)`,
    verdict: "applicable",
    semanticDiff: "上游有机械关闭序列；本地无关闭策略，\"不再默认\"可能变成\"不再清理\"",
    mechanicalCheck: "跑完一个团队后统计 .mpd/team 下的残留团队数（t3 measured_residue=25）；期望关闭策略落地后不增长",
    notes: "来源 t3 #8；t3 测得 25 个残留团队",
  },
  {
    id: "T3-09-skill-surface", domain: "技能",
    upstreamItem: "内置 team-mode skill 仅在启用时加载",
    upstreamEvidence: "packages/omo-codex/plugin/components/teammode/skills/teammode/SKILL.md:1-6",
    repoCounterpart: "本地 skills/ 无 team-mode 技能；团队指引在插件 usage 段 + preset persona",
    repoEvidence: "ls skills/ = 19 目录（无 team-mode）; packages/mpd-agent-teams-plugin/lib/index.js:100-115",
    verdict: "applicable",
    semanticDiff: "上游有启用时可加载的技能载体；本地指引常驻在提示面",
    mechanicalCheck: "ls skills/ | grep -i team -> 无（期望无；若出现则本行需重评）",
    notes: "来源 t3 #9；技能语料整体判定见 Table B",
  },
  {
    id: "T3-10-config-fields", domain: "配置",
    upstreamItem: "team_mode 11 个字段（并发/成员上限/消息字节/墙钟/成员轮次/base_dir 等）",
    upstreamEvidence: `${E.upTeamFields}`,
    repoCounterpart: "sessionTeamPolicy 5 字段 + 行级 stateDir/memberProvider/maxMembers",
    repoEvidence: "packages/mpd-bundle/cordis.patch.yml:204-224; packages/mpd-agent-teams-plugin/lib/index.js:76-98",
    verdict: "applicable",
    semanticDiff: "上游字段面更宽；本地对等字段缺失（并行度/消息字节/未读配额/墙钟/单成员轮次）",
    mechanicalCheck: "比对两侧字段清单（读 config.ts:3-15 与 index.js:76-98 即可复现 11 vs 5+n）",
    notes: "来源 t3 #10；用户裁决 4（R4F2）要求补齐缺口字段但上限沿用本地更宽松值",
  },
];

// ── Table B: the rows named by frozen-contract.t4Requirements.rowSet (10 skill rows) ─────────────
const RAW = JSON.parse(readFileSync(join(HERE, "raw/upstream-skill-records.json"), "utf8"));
const rec = (path) => RAW.records.find((r) => r.file === path);
const skillRec = (root, name) => RAW.records.find((r) => r.root === root && r.name === name);
const citeOf = (r) => (r ? `${r.file}:${r.descriptionLine > 0 ? r.descriptionLine : 1}` : "n/a");
const wholeOf = (r) => (r ? `${r.file}:1-${r.lines}` : "n/a");
const localCite = (name) => {
  const f = join(REPO, "skills", name, "SKILL.md");
  return existsSync(f) ? `skills/${name}/SKILL.md:1-${readFileSync(f, "utf8").split("\n").length}` : "null";
};
// Per-skill-tree counts (scope = the skill dir itself), so rows are comparable across the table.
const countTree = (dir) => {
  let files = 0, dirs = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { dirs++; walk(join(d, e.name)); } else files++;
    }
  };
  walk(dir);
  return { files, dirs };
};
// `replacement`: which EXISTING local mechanism carries the skill's semantics — the input t8's V4
// veto rule needs (a skill whose only path requires replacing the local runner is mechanically skip).
const REPLACEMENT = {
  "omo-senpi/mass-ulw": {
    status: "partial-equivalent",
    mechanism: "agent-teams 任务板（依赖排序/扇出/验证）+ DSH workflow 工具的 agent()/pipeline()/parallel()",
    evidence: "packages/mpd-agent-teams-plugin/lib/scheduler.js:36-84; packages/mpd-agent-teams-plugin/lib/quality-gates.js:769-812; presets/mpd/agent.cordis.yml:349-355",
    equivalence: "部分等价：依赖边/拓扑 hand-off/机械验证已由任务板承载；phase 边界与 run 级动词（retry/amend/send/resume）无等价物，只能落 recoveryCoverage 的 S1-S4 四项语义",
  },
  "omo-senpi/dag-library": {
    status: "no-equivalent",
    mechanism: null,
    evidence: "packages/mpd-boulder-plugin/src/index.ts:152-156（最近的本地资产：.mpd/plans 列表，文档型、不可按名重跑）",
    equivalence: "无增量：按名复用图定义依赖 key+fingerprint 幂等与 run 句柄，本地无承载机制",
  },
  "omo-senpi/hyperplan": {
    status: "equivalent",
    mechanism: "mpd_ultrawork({hyperplan:true})（同 5 类对抗评审）",
    evidence: "packages/mpd-ulw-plugin/src/index.ts:147,165,180-191; packages/mpd-ulw-plugin/README.md:19-20",
    equivalence: "已等价（投放方式不同：固定策略引擎 flag，而非上游的交互式技能）",
  },
  "omo-codex/rules": {
    status: "partial-equivalent",
    mechanism: "dsh-agent-instructions 指令文件约定（AGENT.md → AGENTS.md → CLAUDE.md）",
    evidence: "presets/mpd/agent.cordis.yml:146-153",
    equivalence: "部分等价：项目规则注入已存在，但格式/发现路径与上游 rules-engine 不同",
  },
  "skills-loader-core/frontend": {
    status: "equivalent",
    mechanism: "skills/frontend（shared-skills 版，本地已存在）",
    evidence: "skills/frontend/SKILL.md; raw/skill-file-diff.txt（差异=上游新增 references/design/ambience-skill.md）",
    equivalence: "已等价（仅 beta.62 内容漂移 1 文件）",
  },
  "skills-loader-core/git-master": {
    status: "equivalent",
    mechanism: "skills/git-master（shared-skills 版，本地已存在）",
    evidence: "skills/git-master/SKILL.md:1-104",
    equivalence: "已等价（两个不同载体：内置版 1108 行 vs 本地 105 行；取舍待 t8 判）",
  },
  "skills-loader-core/dev-browser": {
    status: "partial-equivalent",
    mechanism: "skills/ultimate-browsing Tier-2（CloakBrowser + agent-browser CDP）",
    evidence: "skills/ultimate-browsing/SKILL.md:87-99",
    equivalence: "部分等价（浏览器自动化已覆盖；驱动接口不同）",
  },
  "skills-loader-core/security-research": { status: "no-equivalent", mechanism: null, evidence: "本地 skills/ 无安全审计技能（ls skills/ = 19 目录）", equivalence: "无增量（新增能力槽位）" },
  "skills/security-research": { status: "no-equivalent", mechanism: null, evidence: "本地 skills/ 无安全审计技能", equivalence: "无增量（新增能力槽位）" },
  "skills/tech-debt-audit": { status: "no-equivalent", mechanism: null, evidence: "本地 skills/ 无技术债审计技能", equivalence: "无增量（新增能力槽位）" },
  "skills/remove-deadcode": { status: "partial-equivalent", mechanism: "skills/remove-ai-slops + skills/refactor（既有清理类技能）", evidence: "skills/remove-ai-slops/SKILL.md:1-336; skills/refactor/SKILL.md:1-731", equivalence: "部分等价（清理类能力存在；死代码专门化没有）" },
};
// Re-exposed in fv4 at Architect's request: the four rubric fields that the R1 rebuild had collapsed
// into skillPortCost/replacement. Values are row-specific and re-derived here (the pre-R1 release
// carried a generic placeholder for rows without an override).
const OVERLAP_REL = {
  "skills/remove-deadcode": { overlap: "清理类能力部分覆盖：本地 skills/remove-ai-slops + skills/refactor；无死代码专门化", rel: { goal1_omoAlignment: "低", goal2_agentTeamsNotDefault: "无", goal3_autoRouting: "无", goal4_massUlwDag: "无" }, why: "上游仓库内建技能；与四目标无直接关系" },
  "skills/security-research": { overlap: "none（本地无安全审计技能）", rel: { goal1_omoAlignment: "低", goal2_agentTeamsNotDefault: "无", goal3_autoRouting: "无", goal4_massUlwDag: "无" }, why: "新增能力槽位，与四目标无直接关系" },
  "skills/tech-debt-audit": { overlap: "none（本地无技术债审计技能）", rel: { goal1_omoAlignment: "低", goal2_agentTeamsNotDefault: "无", goal3_autoRouting: "无", goal4_massUlwDag: "无" }, why: "新增能力槽位，与四目标无直接关系" },
  "omo-codex/rules": { overlap: "与本地 AGENTS.md 指令文件约定机制重复（presets/mpd/agent.cordis.yml:146-153）", rel: { goal1_omoAlignment: "低", goal2_agentTeamsNotDefault: "无", goal3_autoRouting: "无", goal4_massUlwDag: "无" }, why: "规则注入已被本地约定覆盖" },
  "omo-senpi/dag-library": { overlap: "本地无可按名复用的图定义；最近资产 .mpd/plans 为文档型（packages/mpd-boulder-plugin/src/index.ts:152-156）", rel: { goal1_omoAlignment: "中", goal2_agentTeamsNotDefault: "低", goal3_autoRouting: "中", goal4_massUlwDag: "高" }, why: "DAG 复用资产直接关系 goal4，但依赖上游 run 幂等模型" },
  "omo-senpi/mass-ulw": { overlap: "概念重叠（依赖排序/扇出/验证）但机制不重叠：本地无 run_id/retry/amend/send/日志（t2 D3）", rel: { goal1_omoAlignment: "高", goal2_agentTeamsNotDefault: "低", goal3_autoRouting: "中", goal4_massUlwDag: "高" }, why: "mass-ulw/DAG 对齐的参照物；其 category 路由不是任务级路由器" },
  "skills-loader-core/dev-browser": { overlap: "与 skills/ultimate-browsing 部分重叠（浏览器自动化），驱动接口不同", rel: { goal1_omoAlignment: "低", goal2_agentTeamsNotDefault: "无", goal3_autoRouting: "无", goal4_massUlwDag: "无" }, why: "开发期浏览器面，与四目标无关" },
  "skills-loader-core/frontend": { overlap: "本地已有 shared-skills 版 skills/frontend；差异=上游新增 references/design/ambience-skill.md", rel: { goal1_omoAlignment: "中", goal2_agentTeamsNotDefault: "无", goal3_autoRouting: "无", goal4_massUlwDag: "无" }, why: "仅 beta.62 内容漂移" },
  "skills-loader-core/git-master": { overlap: "本地已有 shared-skills 版 skills/git-master（105 行）vs 内置版（1108 行）", rel: { goal1_omoAlignment: "中", goal2_agentTeamsNotDefault: "无", goal3_autoRouting: "无", goal4_massUlwDag: "无" }, why: "两载体取舍待定" },
  "skills-loader-core/security-research": { overlap: "none（本地无安全审计技能；与 .agents/skills/security-research 同名不同载体）", rel: { goal1_omoAlignment: "低", goal2_agentTeamsNotDefault: "无", goal3_autoRouting: "无", goal4_massUlwDag: "无" }, why: "新增能力槽位" },
};
const portCostOf = (rr, name) => {
  const upTree = rr ? { status: "measured", fileCount: rr.fileCount, dirCount: rr.dirCount, scope: rr.dir } : { status: "unknown", fileCount: null, dirCount: null, scope: null };
  const localDir = join(REPO, "skills", name);
  const lc = existsSync(localDir) ? countTree(localDir) : null;
  const localTree = lc ? { status: "measured", fileCount: lc.files, dirCount: lc.dirs, scope: `skills/${name}/` } : { status: "absent", fileCount: null, dirCount: null, scope: `skills/${name}/` };
  const keys = rr ? Object.entries(rr.coupling).filter(([, v]) => v > 0).map(([k]) => k) : [];
  return {
    countingRule: "计数范围 = 技能树自身（上游 SKILL.md 所在目录 / 本地 skills/<name>/），跨行可比。null 与 0 语义不同：0=实测为空，null(unknown/absent)=未能只读测得或本地不存在；unknown 不是 0、也不是最高代价。",
    upstreamSkillTree: upTree,
    localSkillTree: localTree,
    harnessCoupling: keys.length === 0 ? "none" : keys,
    couplingMeasurement: keys.length === 0 ? "skill tree 内 0 个耦合 token 命中（只读扫描）" : `non-none：命中 ${keys.join(",")}（因此按 t8 规则不得判 none）`,
    repoTouchPoints: [
      "skills/**（采纳/改写目标；单写者 + 一次 VENDOR_LOCK 重钉，D_SKILLS_WRITER）",
      "presets/mpd/agent.cordis.yml（仅当 persona/doctrine 文本改动时）",
      "AGENTS.md（仅当约定变化时）",
    ],
  };
};

const FROZEN_ROWS = [
  { id: "skills/remove-deadcode", frozenKey: ".agents/skills/remove-deadcode", name: "remove-deadcode", root: ".agents/skills", domain: "技能", verdict: "uncertain", diff: "上游仓库内建技能，通用度较高但与本波四目标无直接关系；是否移植待 t8 门禁" },
  { id: "skills/security-research", frozenKey: ".agents/skills/security-research", name: "security-research", root: ".agents/skills", domain: "技能", verdict: "uncertain", diff: "上游仓库内建安全审计技能；本地无对应，属于新增能力槽位" },
  { id: "skills/tech-debt-audit", frozenKey: ".agents/skills/tech-debt-audit", name: "tech-debt-audit", root: ".agents/skills", domain: "技能", verdict: "uncertain", diff: "上游仓库内建技术债审计技能；本地无对应" },
  { id: "omo-codex/rules", frozenKey: "packages/omo-codex/plugin/components/rules/skills/rules/SKILL.md", name: "rules", root: "packages/omo-codex", domain: "技能/规则", verdict: "uncertain", diff: "上游 rules 组件：从 .omo/rules 注入项目规则；本地用 AGENTS.md 约定，机制重复" },
  { id: "omo-senpi/dag-library", frozenKey: "packages/omo-senpi/skills/dag-library/SKILL.md", name: "dag-library", root: "packages/omo-senpi", domain: "DAG/技能", verdict: "uncertain", diff: "存储并复用命名 dag 定义（$OMO_DAG_LIBRARY/.omo/dags + key 轮换）；依赖上游 run 幂等模型，本地无对应" },
  { id: "omo-senpi/mass-ulw", frozenKey: "packages/omo-senpi/skills/mass-ulw/SKILL.md", name: "mass-ulw", root: "packages/omo-senpi", domain: "DAG/技能", verdict: "uncertain", diff: "mass-ulw doctrine：一次 run 一个 phase、node 契约、goal 绑定、验证波；机制（run_id/retry/amend/send/日志）本地缺失，只能改写" },
  { id: "skills-loader-core/dev-browser", frozenKey: "packages/skills-loader-core/src/features/builtin-skills/dev-browser/SKILL.md", name: "dev-browser", root: "packages/skills-loader-core", domain: "技能/工具", verdict: "uncertain", diff: "内置浏览器自动化技能；与 local skills/ultimate-browsing 部分重叠，需人工判读后决定 adopt/skip" },
  { id: "skills-loader-core/frontend", frozenKey: "packages/skills-loader-core/src/features/builtin-skills/frontend/SKILL.md", name: "frontend", root: "packages/skills-loader-core", domain: "技能", verdict: "uncertain", diff: "内置 frontend 副本；本地已有 shared-skills 版 frontend（差异=beta.62 新增 ambience-skill.md）" },
  { id: "skills-loader-core/git-master", frozenKey: "packages/skills-loader-core/src/features/builtin-skills/git-master/SKILL.md", name: "git-master", root: "packages/skills-loader-core", domain: "技能", verdict: "uncertain", diff: "内置 git-master 副本（1108 行）；本地 skills/git-master 为 shared-skills 版（105 行），两个不同载体的取舍待判" },
  { id: "skills-loader-core/security-research", frozenKey: "packages/skills-loader-core/src/features/builtin-skills/security-research/SKILL.md", name: "security-research", root: "packages/skills-loader-core", domain: "技能", verdict: "uncertain", diff: "内置安全研究技能；与 .agents/skills/security-research 同名不同载体" },
].map((r) => {
  const rr = rec(r.frozenKey) || skillRec(r.root, r.name);
  const local = r.name === "mass-ulw" || r.name === "dag-library" ? "null" : localCite(r.name);
  return {
    id: r.id, domain: r.domain,
    upstreamItem: `${r.name}（上游技能，载体 ${r.root}）`,
    upstreamEvidence: `${citeOf(rr)} (frontmatter), ${wholeOf(rr)}（文件实长 ${rr ? rr.lines : "?"} 行，fileCount=${rr ? rr.fileCount : "?"}, dirCount=${rr ? rr.dirCount : "?"}）`,
    repoCounterpart: local === "null" ? "null" : local.split(":")[0],
    repoEvidence: local === "null" ? "null（本地无对应目录）" : `${local} (local counterpart)`,
    verdict: r.verdict,
    semanticDiff: r.diff,
    mechanicalCheck: `ls ${r.frozenKey.replace(/SKILL\.md$/, "")} 与本地对照（可复现）；判定为 adoptable 前不得移植（本轮只读）`,
    notes: `来源 frozen-contract.t4Requirements.rowSet（原文 "${r.id}"）；t4 旧 id=${r.frozenKey}；class 分布见 supportingEvidence`,
    falsifiableAssertion: null,
    replacement: REPLACEMENT[r.id] ?? null,
    skillPortCost: portCostOf(rr, r.name),
    // Re-exposed in fv4 (Architect request): rubric fields the R1 rebuild had collapsed away.
    fieldProvenance: "re-exposed in fv4; fv1 (pre-R1) values for rows without an override were generic placeholders, fv4 values are row-specific",
    upstreamHarnessCoupling: portCostOf(rr, r.name).harnessCoupling,
    couplingMeasurement: portCostOf(rr, r.name).couplingMeasurement,
    overlap: (OVERLAP_REL[r.id] ?? {}).overlap ?? "not assessed",
    relevanceToGoals: (OVERLAP_REL[r.id] ?? {}).rel ?? { goal1_omoAlignment: "低", goal2_agentTeamsNotDefault: "无", goal3_autoRouting: "无", goal4_massUlwDag: "无" },
    relevanceRationale: (OVERLAP_REL[r.id] ?? {}).why ?? "not assessed",
  };
});

// ── S1-S4 recovery coverage (frozen-contract t4Requirements.items[2]) ───────────────────────────
const RECOVERY = {
  provenance:
    "frozen-contract.json t4Requirements.items[2] 要求逐项报告 retry(8)/revision(2)/resume(1)/mid-run steering(0)。这些计数来自 verdict-r3.json R3F6 记录的原始命令：grep -o -i 'retry|resume|revision|steer' evidence/omo-align/research/team-vs-mass-ulw/gap.json（t2 的 gap.json）。本节的四行就是对该缺口的补齐：现在四项各有上游证据、本地对应物、判定与可机械验证点。",
  items: [
    {
      id: "S1", name: "node-level retry", t2Occurrences: 8,
      upstreamEvidence: `${E.upMassUlw}:66-80 (retry：失败/取消节点获得新尝试；已完成节点复用，绝不重跑；运行中拒绝 run_still_active)`,
      repoCounterpart: "任务板重试：captain 重派 + 冷恢复自动重排 + 质量门 repair 环",
      repoEvidence: `${E.localScheduler} (parked attempt / cold requeue); ${E.localGates} (repair loop)`,
      verdict: "applicable",
      assertion: "命令/观察：让一个任务以 failed 终止，再对其重派；期望：同一 run 内已完成任务保持 completed 且其 output 不被重算；失败表现：已完成任务被重跑或其输出丢失。",
    },
    {
      id: "S2", name: "revision without re-running completed work", t2Occurrences: 2,
      upstreamEvidence: `${E.upMassUlw}:75-80 (amend：按 node fingerprint diff，仅变更/新增节点及其传递依赖重跑；load_skills 故意在 fingerprint 之外)`,
      repoCounterpart: "agent_teams_edit_plan（原子批量改计划）+ 依赖图重排；无 fingerprint/amend 动词",
      repoEvidence: "packages/mpd-agent-teams-plugin/lib/tools.js (edit_plan); packages/mpd-agent-teams-plugin/lib/scheduler.js:36-84",
      verdict: "applicable",
      assertion:
        "命令/观察：修订一个已完成的 impl 任务定义（不改其上游），期望只重跑该任务及其传递依赖、未变更的已完成节点保结果；失败表现：无关的已完成节点被重跑，或其缓存结果被丢弃。（措辞以 frozen-contract.massUlwSemantics S2 为准：传递依赖是指标）",
    },
    {
      id: "S3", name: "resume across restart", t2Occurrences: 1,
      upstreamEvidence: `${E.upMassUlw}:82-86 (journaled runs：进程死亡后 run 暂停，重启即恢复并复用已完成节点输出；同 key 重发返回既有 run)`,
      repoCounterpart: "团队状态落盘 .mpd/team/<id>/team.json + agent_teams_resume（halted→running）",
      repoEvidence: `${E.localResume}; packages/mpd-agent-teams-plugin/lib/state.js (team.json 持久化)`,
      verdict: "applicable",
      assertion: "命令/观察：在成员运行中杀掉进程并重启会话，期望团队从持久状态继续、已完成任务不重跑；失败表现：任务全部重置或重复执行。",
    },
    {
      id: "S4", name: "mid-run steering", t2Occurrences: 0,
      upstreamEvidence: `${E.upMassUlw}:88-90 (supervising：对运行中节点用 send 明确边界纠偏；漂移在第一波纠正），:74 (send 可唤醒已完成 child 继续)`,
      repoCounterpart: "agent_teams_send_message 对运行中成员投递指引（attempt 保持，不被重开）",
      repoEvidence: "packages/mpd-agent-teams-plugin/lib/scheduler.js:462-490 (parked attempt); AGENTS.md §5 (不打断普通提问、pause 后同 attempt 继续)",
      verdict: "applicable",
      assertion: "命令/观察：对运行中成员发出一条纠偏消息，期望其同一 attempt 收到指引且不被重启；失败表现：成员被重启或 attempt_id 被轮换。",
    },
  ],
};

// ── F6 name freeze / new-name table ─────────────────────────────────────────────────────────────
const NAME_FREEZE = [
  { item: "工具名 agent_teams_*（14 个）", current: "create/approve/edit_plan/add_member/remove_member/create_task/reassign_task/claim_task/update_task/send_message/status/resume/delete/task_contract", decision: "冻结不得改", evidence: "frozen-contract.manualEntryNames.tools; packages/mpd-agent-teams-plugin/lib/tool-names.js; AGENTS.md §1 命名空间例外", note: "新增工具允许，改名/删除禁止" },
  { item: "斜杠指令 /agent-teams", current: "AGENT_TEAMS_COMMAND='agent-teams' + GESTURE /^\\/agent-teams(?=$|[\\t\\n\\r ])/u", decision: "冻结不得改", evidence: "packages/mpd-agent-teams-plugin/lib/command.js:3,5,26", note: "frozenPredicate 要求该正则与常量不变" },
  { item: "斜杠指令 /agent-teams-<profile>", current: "/agent-teams-mpd（由 PROFILE_COMMAND_PREFIX + profileCommandName 生成）", decision: "冻结不得改", evidence: "packages/mpd-agent-teams-plugin/lib/command.js:12-17,75-76,95-100", note: "谓词约束的是生成机制 + profiles.* 键集合不变" },
  { item: "profiles.mpd（agent-teams row 的 profile 键）", current: "mpd", decision: "冻结不得改", evidence: "frozen-contract.manualEntryNames.profileKey; packages/mpd-bundle/cordis.patch.yml:231-235", note: "键集合变化会绕过字面量检查" },
  { item: "preset id mpd", current: "mpd（唯一随包 preset）", decision: "冻结不得改", evidence: "AGENTS.md §1,§8; presets/mpd/; frozen-contract.manualEntryNames.presetId", note: "新增 preset 允许（硅谷子包已有先例），改名禁止" },
  { item: "状态目录 .mpd/team", current: "stateDir: .mpd/team", decision: "冻结不得改", evidence: "packages/mpd-bundle/cordis.patch.yml:205; AGENTS.md §12 (in-use gate 扫描) ; skills/dsh-qa/scripts/*team*", note: "改名会同时打断 workmate in-use 门与 QA" },
  { item: "配置字段名 sessionTeamPolicy", current: "sessionTeamPolicy", decision: "冻结不得改", evidence: "packages/mpd-agent-teams-plugin/lib/index.js:87-98; scripts/install-profile.mjs:177,261-262; skills/dsh-qa/scripts/session-start-team.mjs:85,87,129,133", note: "字段改名会同时打断 installer 自检与 QA 断言" },
  { item: "sessionTeamPolicy 取值集合", current: "off | auto | instruct", decision: "冻结不得改", evidence: "packages/mpd-agent-teams-plugin/lib/index.js:92; frozen-contract.frozenDecisions.D_AUTOROUTE_SPLIT（'no value removed'）", note: "不删除取值；新增取值（如新的 auto 语义拆分）允许" },
  { item: "新键 sessionTeamPolicy.autoRoute", current: "不存在（本轮新增，默认启用）", decision: "允许新增", evidence: "frozen-contract.frozenDecisions.D_AUTOROUTE_SPLIT", note: "机械门与 legacy 注入解耦" },
  { item: "复杂度门参数（complexityGate）", current: "不存在（本轮新增：signals + 阈值 + 两侧测试）", decision: "允许新增", evidence: "frozen-contract.complexityGate (trigger = matchedSignals>=2 OR anyExplicitFlag)", note: "冻结后不得事后调参" },
  { item: "团队显示名 MPD Default", current: "MPD Default", decision: "允许重命名", evidence: "packages/mpd-bundle/cordis.patch.yml:223; skills/dsh-qa/scripts/session-start-team.mjs:85,129,133", note: "仅显示名；D_FIRST 后可能不再默认 provision，改名须同步 QA 断言" },
  { item: "证据目录命名（本波 t4 产物）", current: "evidence/omo-align/skills-gates/", decision: "冻结不得改", evidence: "队长二次裁定（路径+文件名）；frozen-contract.t4Requirements.authoritativePaths（措辞滞后，见 discrepancies）", note: "t8 的 verdict-table.md / gate-rubric.json / decisions.json 共用该目录" },
  { item: "t2/t3 证据目录命名", current: "evidence/omo-align/research/{team-vs-mass-ulw,session-policy}/", decision: "冻结不得改", evidence: "t2/t3 契约 in-scope 与已终态产出", note: "不得重命名或搬迁（否则引用断裂）" },
  { item: "人类面向台账文件名", current: "docs/omo-parity-ledger.md + docs/omo-parity-ledger.zh-CN.md（同提交、标题下互链）", decision: "冻结不得改", evidence: "frozen-contract.frozenDecisions.D_LEDGER; 文件已存在", note: "docs/omo-parity-gap.md 与既往波次报告为历史记录，本轮不动" },
  { item: "mpd_* 工具/插件前缀", current: "mpd_roles_list/mpd_workmate_*/mpd_ultrawork/...", decision: "冻结不得改", evidence: "AGENTS.md §1（命名前缀 mpd）", note: "上游 OMO_* 二进制环境键同样不得改名" },
  { item: ".mpd/mpd.jsonc 配置文件", current: ".mpd/mpd.jsonc（项目层）", decision: "冻结不得改", evidence: "packages/mpd-config-plugin/src/index.ts; AGENTS.md §6", note: "新配置键在此文件内新增" },
];

// ── F5 ledger candidate rows ─────────────────────────────────────────────────────────────────────
const LEDGER = [
  { id: "L-01", item: "会话启动默认策略：不再自动建队（D_FIRST）", sourceRows: ["T3-01-default-state", "D1-activation"], suggestedStatus: "待 t5 落地；台账需记录翻转前后两侧断言", alreadyInLedger: "部分（§6 文本落点）" },
  { id: "L-02", item: "复杂度机械门 + autoRoute 拆分（T3-04/T3-05）", sourceRows: ["T3-04-activation-trigger", "T3-05-auto-routing"], suggestedStatus: "待落地；阈值/信号必须与 frozen-contract.complexityGate 逐字一致", alreadyInLedger: "已索引（§3）" },
  { id: "L-03", item: "通知面收敛（启动 notice 仅在触发时注入）", sourceRows: ["T3-06-notice-surface"], suggestedStatus: "待落地", alreadyInLedger: "否" },
  { id: "L-04", item: "工具/提示面安静化（工具常驻但 usage 段条件化）", sourceRows: ["T3-03-tool-availability"], suggestedStatus: "待裁决（对齐为可选）", alreadyInLedger: "否" },
  { id: "L-05", item: "团队关闭/回收不变量（closure）", sourceRows: ["T3-08-closure"], suggestedStatus: "待落地；t3 测得 25 个残留团队", alreadyInLedger: "否" },
  { id: "L-06", item: "mass-ulw 四项语义 S1-S4", sourceRows: ["S1", "S2", "S3", "S4", "D10-recovery"], suggestedStatus: "S1-S4 已索引；S2 措辞需按 frozen-contract 更新（见 discrepancies X3）", alreadyInLedger: "是（§4 表）" },
  { id: "L-07", item: "成员资格：只读专家是否可作成员（本地有意偏差）", sourceRows: ["T3-07-member-eligibility"], suggestedStatus: "待用户裁决", alreadyInLedger: "否" },
  { id: "L-08", item: "启用面迁到 .mpd/mpd.jsonc（用户可 off/instruct）", sourceRows: ["T3-02-enable-surface"], suggestedStatus: "待落地", alreadyInLedger: "否" },
  { id: "L-09", item: "team_mode 配置字段缺口（并行度/消息字节/未读配额/墙钟/单成员轮次）", sourceRows: ["T3-10-config-fields"], suggestedStatus: "待用户裁决（上限沿用本地更宽松值）", alreadyInLedger: "否" },
  { id: "L-10", item: "技能语料候选（10 个 uncertain 技能行 + D12 悬空引用）", sourceRows: ["D12-skill-corpus", "T3-09-skill-surface", "omo-senpi/mass-ulw", "omo-senpi/dag-library"], suggestedStatus: "后续波次（单写者 + 一次 VENDOR_LOCK 重钉）；D_SKILLS_WRITER 规定 t9 本波不写 skills/**", alreadyInLedger: "否" },
  { id: "L-11", item: "名字冻结清单（F6）", sourceRows: ["T3-01-default-state", "T3-02-enable-surface"], suggestedStatus: "台账 §5 已列工具/指令/键；需补 .mpd/team、sessionTeamPolicy、证据目录、台账文件名", alreadyInLedger: "部分（§5）" },
  { id: "L-12", item: "上游参照锁定（beta.20 基线 / beta.62 对齐参照）", sourceRows: ["D12-skill-corpus"], suggestedStatus: "已冻结（D_UPSTREAM_REF），台账需标明不得重钉 VENDOR_LOCK", alreadyInLedger: "部分" },
];

const DISCREPANCIES = [
  {
    id: "X1", severity: "high", issue: "frozen-contract.t4Requirements.authoritativePaths 记录的是旧路径与旧文件名（evidence/omo-align/research/skills-and-capability-gap/** 与 verdict-table.md 201 行），已被队长后续两次裁定取代（skills-gates/ + gap-verdict-table.md）。冻结文件自称 single source of truth，但该字段已过期。",
    impact: "一致性校验按冻结文件读取会找不到文件或读到 t8 的文件名。", owner: "captain",
  },
  {
    id: "X2", severity: "high", issue: "行集合定义冲突：队长 R1 消息要求『行集合 = t2+t3 枚举并集』，而 frozen-contract.t4Requirements.rowSet 要求 10 个技能行（skills/remove-deadcode 等）。两者互不包含。",
    impact: "本交付同时给出 Table A（并集 22 行）与 Table B（frozen rowSet 10 行），并在 gap.json 中给出同一 id 集合；若队长裁定 Table B 作废，删该节即可，不会影响 Table A。", owner: "captain",
  },
  {
    id: "X3", severity: "medium", issue: "docs/omo-parity-ledger.md §4 的 S2 措辞沿用旧句（『re-runs only the changed task AND ITS DEPENDENTS』），而 frozen-contract.massUlwSemantics.S2 已将其精化为『传递依赖』并注明 resolves Planner R4F1；台账 O5 冲突注记因此已过时。",
    impact: "t5 若不更新台账，会保留一个已解决的冲突标记并可能按旧措辞实现。", owner: "t5 (ledger writer)",
  },
  {
    id: "X4", severity: "low", issue: "t4 终态任务记录的 changedPaths 仍指向已删除的旧目录/旧文件名（终态不可变）。",
    impact: "按任务记录核对会找不到文件；以本文件的 authoritative paths 为准。", owner: "captain",
  },
];

// ── assemble rows ───────────────────────────────────────────────────────────────────────────────
const rows = [
  ...ROWS_T2.map((r) => ({ ...r, rowSetSource: "t2-enumeration", falsifiableAssertion: r.falsifiableAssertion ?? null, ledgerCandidate: true })),
  ...ROWS_T3.map((r) => ({ ...r, rowSetSource: "t3-enumeration", falsifiableAssertion: r.falsifiableAssertion ?? null, ledgerCandidate: true })),
  ...FROZEN_ROWS.map((r) => ({ ...r, rowSetSource: "frozen-contract.rowSet", ledgerCandidate: false })),
];

const byVerdict = rows.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] || 0) + 1), a), {});
const adoptable = rows.filter((r) => r.verdict === "adoptable");
// t8 explicitly asked for `replacement` on these three; hyperplan is NOT a frozen-rowSet row, so it is
// surfaced here as well instead of only living in the supporting inventory.
const PRIORITY_REPLACEMENTS = ["omo-senpi/mass-ulw", "omo-senpi/dag-library", "omo-senpi/hyperplan"].map((id) => ({
  id,
  inTableB: FROZEN_ROWS.some((r) => r.id === id),
  ...(REPLACEMENT[id] ?? { status: "not-assessed", mechanism: null, evidence: "n/a", equivalence: "n/a" }),
}));

const gap = {
  task: "t4",
  produced_by: "Researcher (read-only)",
  produced_at_utc: new Date().toISOString(),
  contract_revision: "R1 (captain ruling: fixed-column table; row set = t2+t3 enumeration union; adoptable rows need a falsifiable assertion; name-freeze table; ledger candidate rows)",
  authoritative_paths: {
    this_file: `${REPO}/evidence/omo-align/skills-gates/gap.json`,
    table: `${REPO}/evidence/omo-align/skills-gates/gap-verdict-table.md`,
    raw_dir: `${REPO}/evidence/omo-align/skills-gates/raw/`,
    builder: `${REPO}/evidence/omo-align/skills-gates/build-r1.mjs`,
    authoritative_copy: `${REPO}/evidence/omo-align/skills-gates/`,
    contract_copy: {
      gap_json: `${REPO}/evidence/omo-align/research/skills-and-capability-gap/gap.json`,
      table: `${REPO}/evidence/omo-align/research/skills-and-capability-gap/verdict-table.md`,
      note: "第三轮裁定：双写。契约副本的表沿用注册契约里的旧文件名 verdict-table.md（与 t8 的 skills-gates/verdict-table.md 不同目录，不冲突）；内容与权威副本逐字一致，由同一次 build-r1.mjs 产出 + 同一份字节拷贝生成。",
    },
    authoritative_note:
      "队长第三轮裁定（最终）：t4 产出双写。(1) 权威副本 = evidence/omo-align/skills-gates/{gap.json,gap-verdict-table.md}（t8 按此读取）；(2) 契约副本 = evidence/omo-align/research/skills-and-capability-gap/{gap.json,verdict-table.md}（t4 注册契约的 in-scope 路径，仅为此保留）。两份字节相同；若出现不一致，以权威副本为准并报队长。raw/ 与 builder 只在权威目录单份存在，两份文档均以绝对路径引用它们（契约副本因此仍可解析）。",
  },
  baseline: {
    upstream: { path: UP, commit: UP_COMMIT, version: UP_VERSION, note: "对齐参照；本地 VENDOR_LOCK 仍钉 beta.20（8c57e463e），本轮不重钉（D_UPSTREAM_REF）" },
    localRowSetSources: {
      t2: "evidence/omo-align/research/team-vs-mass-ulw/gap.json -> dimensions D1..D12",
      t3: "evidence/omo-align/research/session-policy/gap.json -> gap_matrix (10 dimensions, id minted T3-01..T3-10)",
      frozenRowSet: "evidence/omo-align/requirements/frozen-contract.json -> t4Requirements.rowSet (10 skill rows)",
    },
    method: "read-only: read/grep of both checkouts + the t2/t3 artifacts + requirements files; all counts measured; no runtime boot executed",
    limitation: "判定为源级判断，不是运行测量。每条 adoptable 行都给出可证伪断言，但断言尚未执行（t5/t6 执行）。",
  },
  columns: COLUMNS,
  columnsContract: {
    "id": "稳定行 id",
    "领域": "领域/平面",
    "上游项": "上游对应机制或条目",
    "上游证据(file:line)": "beta.62 checkout 的 file:line（或 URL）",
    "本仓库对应物": "本地对应文件/机制或 null",
    "本仓库证据(file:line)": "本地 file:line 或可复现命令",
    "判定": "applicable | adoptable | already-have | uncertain",
    "语义差异要点": "差异/缺口的一句话结论",
    "可机械验证点": "命令/观察 + 期望（判定成立与否可复现）",
    "备注": "来源行集合、冲突与限制",
  },
  rowSet: {
    t2Enumerations: ROWS_T2.map((r) => r.id),
    t3Enumerations: ROWS_T3.map((r) => r.id),
    frozenContractRowSet: FROZEN_ROWS.map((r) => r.id),
    totalRows: rows.length,
    unionRule: "Table A = t2 ∪ t3（22 行，不合并、不删行）；Table B = frozen-contract.rowSet（10 行）。两表 id 并集 = 本文件 rows 的 id 集合（一一对应）。",
  },
  verdictVocabulary: ["applicable", "adoptable", "already-have", "uncertain"],
  verdictDistribution: byVerdict,
  adoptableRows: adoptable.map((r) => ({ id: r.id, falsifiableAssertion: r.falsifiableAssertion })),
  rows,
  replacementInputs: {
    note: "t8's V4 veto rule input. `replacement` also rides on every Table B row; this section guarantees the three requested ids are present even when a skill is not a frozen-rowSet row (hyperplan).",
    vocabulary: ["equivalent", "partial-equivalent", "no-equivalent", "not-assessed"],
    items: PRIORITY_REPLACEMENTS,
  },
  recoveryCoverage: RECOVERY,
  nameFreeze: NAME_FREEZE,
  ledgerCandidates: LEDGER,
  discrepancies: DISCREPANCIES,
  supportingEvidence: {
    note: "以下不是判定表行集合，仅作证据（避免表/json 行集合膨胀）",
    priorSkillInventory: { file: "raw/upstream-skill-records.json", recordCount: RAW.recordCount, distribution: { "already-have": 29, "not-applicable": 25, uncertain: 10, adoptable: 0 } },
    functionalSurfaces: "见 raw/upstream-surfaces.txt 与 raw/local-counterparts-and-window.txt",
    windowAudit: "见 raw/beta20-to-beta62-diff.txt 与 raw/skills-drift-window.txt（含上游 Team Mode OFF 核验）",
  },
  handoffToT8: {
    scalingAdvice: [
      "Table A 的 22 行是领域级判定；Table B 的 10 行是技能级门禁输入（frozen rowSet）。",
      "只有 adoptable 行需要可证伪断言；本交付中 adoptable 行数 = 1（T3-01-default-state）。",
      "uncertain 行的原因已写在『语义差异要点』；不得据 uncertain 直接实施。",
    ],
    openQuestions: [
      "X2：Table B 是否随 R1 作废？若作废，技能级判定将以 supportingEvidence 的技能清单为依据。",
      "X1：请更新 frozen-contract.t4Requirements.authoritativePaths（旧路径/旧文件名）。",
      "mass-ulw doctrine 是否移植，是否要等 DSH workflow 工具补齐 run 生命周期（t2 D3）。",
    ],
  },
};

writeFileSync(join(HERE, "gap.json"), JSON.stringify(gap, null, 2) + "\n");

// ── render the table ────────────────────────────────────────────────────────────────────────────
const L = [];
const p = (s = "") => L.push(s);
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const tableHeader = () => {
  p(`| ${COLUMNS.join(" | ")} |`);
  p(`|${COLUMNS.map(() => "---").join("|")}|`);
};
const tableRow = (r) => {
  p(`| ${[r.id, r.domain, r.upstreamItem, r.upstreamEvidence, r.repoCounterpart, r.repoEvidence, r.verdict, r.semanticDiff, r.mechanicalCheck, r.notes].map(cell).join(" | ")} |`);
};

p("# 上游功能差距判定表（输入 t8 技能门禁评分）");
p();
p("_Upstream capability-gap verdict table — t4 contract revision **R1**. Fixed 10-column judgment table. t8's own files (`verdict-table.md`, `gate-rubric.json`, `decisions.json`) are NOT this document._");
p();
p(`Generated: ${gap.produced_at_utc} · builder: \`build-r1.mjs\` · task **t4**, Researcher (read-only) · upstream \`${UP_COMMIT.slice(0, 9)}\` = v${UP_VERSION} (alignment reference; local pin stays beta.20).`);
p();
p("## Deliverable locations (absolute)");
p();
p("| artifact | absolute path |");
p("|---|---|");
p(`| machine-readable rows (same id set as this table) | \`${gap.authoritative_paths.this_file}\` |`);
p(`| this table | \`${gap.authoritative_paths.table}\` |`);
p(`| raw evidence | \`${gap.authoritative_paths.raw_dir}\` |`);
p(`| builder | \`${gap.authoritative_paths.builder}\` |`);
p();
p(`> ${gap.authoritative_paths.authoritative_note} The t4 terminal task record still lists the pre-correction paths (immutable) — see discrepancy X4.`);
p();
p("**双写位置（队长第三轮最终裁定）：权威副本 vs 契约副本**");
p();
p(`- **权威副本（t8 读取此处）**：\`${gap.authoritative_paths.this_file}\` 与 \`${gap.authoritative_paths.table}\``);
p(`- **契约副本**（t4 注册契约 in-scope 路径，仅为此保留）：\`${gap.authoritative_paths.contract_copy.gap_json}\` 与 \`${gap.authoritative_paths.contract_copy.table}\``);
p("- 两份内容逐字一致（同一次构建 + 同一份字节拷贝）；若不一致，以权威副本为准并报队长。");
p("- `raw/` 与生成器只在权威目录单份存在；两份文档都以绝对路径引用它们，契约副本仍可解析。");
p("- 契约副本的表沿用契约里的旧文件名 `verdict-table.md`（与 t8 位于 skills-gates/ 的 `verdict-table.md` 不同目录，不冲突）。");
p();
p("**Revision 纪律（因 fv1 被同名覆盖而新增）**：本目录的 `gap.json` / `gap-verdict-table.md` 是**滚动 LIVE 副本**；每次构建都会另写一份**不可变快照**到 `revisions/<tag>-<UTCstamp>/`，并在 `REVISIONS.md` 记录 sha256/字节数/状态。t8 已完成的评分钉在 **fv1**（147,592 B，sha256 `148998a6…`），该版本已被我同名覆盖且 `evidence/omo-align/` 未纳入 git ⇒ **字节级不可恢复**；t8 自己的 `gate-rubric.json` / `decisions.json` 是该 revision 内容仅存的记录。详见 `REVISIONS.md`。");
p();
p("## Fixed columns (a row missing one fails acceptance)");
p();
p(`\`${COLUMNS.join(" | ")}\``);
p();
p("## Row set");
p();
p(`- **Table A** = the union of the t2 and t3 enumerations: t2 ${ROWS_T2.length} rows (D1..D12) + t3 ${ROWS_T3.length} rows (T3-01..T3-10) = ${ROWS_T2.length + ROWS_T3.length} rows. Rows are neither merged nor dropped; same-domain pairs (D1/T3-01, D2/T3-04, D8/T3-05, D12/T3-09/10) both stay, as the union rule requires.`);
p(`- **Table B** = the ${FROZEN_ROWS.length} rows named by \`frozen-contract.t4Requirements.rowSet\`. The union rule does not contain them, so they are kept as a separate labeled table rather than dropped (discrepancy **X2**).`);
p(`- gap.json \`rows\` = ${rows.length} = Table A ∪ Table B, identical id sets.`);
p(`- Verdict distribution: ${Object.entries(byVerdict).map(([k, v]) => `${k}=${v}`).join(", ")}. **adoptable rows = ${adoptable.length}** (only those carry a falsifiable assertion).`);
p();
p("### Table A — t2 ∪ t3 enumeration union");
p();
tableHeader();
for (const r of [...ROWS_T2, ...ROWS_T3]) tableRow(r);
p();
p("### Table B — rows named by `frozen-contract.t4Requirements.rowSet` (skill-level gate input)");
p();
tableHeader();
for (const r of FROZEN_ROWS) tableRow(r);
p();
p("## `replacement` — which EXISTING local mechanism carries each skill's semantics (input to t8's V4 veto rule)");
p();
p("Rule this feeds: if a skill's only usable path requires replacing the local runner (the frozen invariant is “keep the agent-teams task-board model, add only the four S1–S4 semantics”), the mechanical verdict is `skip`. Status vocabulary: `equivalent` / `partial-equivalent` / `no-equivalent`.");
p();
p("| id | status | 承载机制 | 证据(file:line) | 等价性判断 |");
p("|---|---|---|---|---|");
for (const r of FROZEN_ROWS) {
  const rp = r.replacement;
  p(`| ${[r.id, rp ? rp.status : "(not assessed)", rp && rp.mechanism ? rp.mechanism : "null", rp ? rp.evidence : "n/a", rp ? rp.equivalence : "n/a"].map(cell).join(" | ")} |`);
}
p();
p("Requested priority ids (mass-ulw / dag-library / hyperplan) — hyperplan is not a frozen-rowSet row, so its `replacement` lives here too:");
p();
p("| id | in Table B | status | 承载机制 | 证据(file:line) | 等价性判断 |");
p("|---|---|---|---|---|---|");
for (const q of PRIORITY_REPLACEMENTS) {
  p(`| ${[q.id, q.inTableB ? "yes" : "no", q.status, q.mechanism ?? "null", q.evidence, q.equivalence].map(cell).join(" | ")} |`);
}
p();
p("## `skillPortCost` — per-skill-tree cost bands (t8 rubric input)");
p();
p("Counting rule (answers t8's comparability + null-vs-0 points): scope = the skill tree itself — the upstream `SKILL.md` directory, and locally `skills/<name>/`. `fileCount: 0` means measured-empty; `null` with `status: unknown|absent` is its own band (not 0, not max cost). `harnessCoupling` is `none` only when the read-only token scan found **zero** coupling tokens; whenever `couplingMeasurement` reports hits, the band is **non-none**.");
p();
p("| id | upstream tree (files/dirs, status) | local tree (files/dirs, status) | harnessCoupling | couplingMeasurement | repoTouchPoints |");
p("|---|---|---|---|---|---|");
for (const r of FROZEN_ROWS) {
  const c = r.skillPortCost;
  const u = `${c.upstreamSkillTree.fileCount ?? "null"}/${c.upstreamSkillTree.dirCount ?? "null"} (${c.upstreamSkillTree.status})`;
  const l = `${c.localSkillTree.fileCount ?? "null"}/${c.localSkillTree.dirCount ?? "null"} (${c.localSkillTree.status})`;
  p(`| ${[r.id, u, l, Array.isArray(c.harnessCoupling) ? c.harnessCoupling.join(",") : c.harnessCoupling, c.couplingMeasurement, c.repoTouchPoints.join(" · ")].map(cell).join(" | ")} |`);
}
p();
p("## Falsifiable assertions for `adoptable` rows");
p();
for (const r of adoptable) {
  p(`- **${r.id}** — ${r.falsifiableAssertion}`);
}
p();
p("## S1–S4 recovery coverage (mass-ulw semantics that t5 must implement)");
p();
p(RECOVERY.provenance);
p();
tableHeader();
for (const s of RECOVERY.items) {
  p(`| ${[s.id, "恢复", `${s.name}`, s.upstreamEvidence, s.repoCounterpart, s.repoEvidence, s.verdict, `t2 词频=${s.t2Occurrences}`, s.assertion, `frozen-contract.massUlwSemantics ${s.id}`].map(cell).join(" | ")} |`);
}
p();
p("## F6 — name freeze / new-name rulings");
p();
p("| 项 | 当前值 | 裁决 | 证据(file:line) | 备注 |");
p("|---|---|---|---|---|");
for (const n of NAME_FREEZE) p(`| ${[n.item, n.current, n.decision, n.evidence, n.note].map(cell).join(" | ")} |`);
p();
p("## F5 — candidate rows for `docs/omo-parity-ledger.md` (+ zh-CN, same commit)")
p();
p("Ledger naming is frozen by `D_LEDGER`; `docs/omo-parity-gap.md` and prior wave reports are historical records and stay untouched. t5 writes the ledger — the rows below are candidates only.");
p();
p("| id | 台账条目 | 来源行 | 建议状态 | 台账现状 |");
p("|---|---|---|---|---|");
for (const g of LEDGER) p(`| ${[g.id, g.item, g.sourceRows.join(", "), g.suggestedStatus, g.alreadyInLedger].map(cell).join(" | ")} |`);
p();
p("## Discrepancies requiring a captain/owner ruling");
p();
p("| id | severity | issue | impact | owner |");
p("|---|---|---|---|---|");
for (const d of DISCREPANCIES) p(`| ${[d.id, d.severity, d.issue, d.impact, d.owner].map(cell).join(" | ")} |`);
p();
p("## Reproducibility");
p();
p("1. Row universe comes from t2 `dimensions`, t3 `gap_matrix`, and `frozen-contract.t4Requirements.rowSet` — nothing else is added to the row set.");
p("2. Every upstream citation is `<path>:<line>` measured in `/root/dshProj/oh-my-openagent` @ `d1557a4b4`; every local citation is `<path>:<line>` in this working tree.");
p("3. `node build-r1.mjs` regenerates both this table and `gap.json` from the same in-memory rows, so the id sets cannot drift.");
p();

writeFileSync(join(HERE, "gap-verdict-table.md"), L.join("\n") + "\n");

// ── revision immutability: rolling LIVE files + immutable snapshots + an index ──────────────────
const REV_TAG = process.env.MPD_T4_REV ?? "fv4";
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const stat = (file) => readFileSync(file).length;
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "Z");
const revDir = join(HERE, "revisions", `${REV_TAG}-${stamp}`);
mkdirSync(revDir, { recursive: true });
for (const f of ["gap.json", "gap-verdict-table.md"]) writeFileSync(join(revDir, f), readFileSync(join(HERE, f)));
const manifest = {
  tag: REV_TAG, writtenAt: new Date().toISOString(),
  files: Object.fromEntries(["gap.json", "gap-verdict-table.md"].map((f) => [f, { bytes: stat(join(HERE, f)), sha256: sha(join(HERE, f)) }])),
  rows: rows.length, verdictDistribution: byVerdict, adoptable: adoptable.length,
  note: "Immutable snapshot. Rebuild writes a NEW revisions/ dir; this one must never be rewritten.",
};
writeFileSync(join(revDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// derived components for re-scoring (so a third party can work from raw/ alone)
writeFileSync(join(HERE, "raw/derived-rows-fv4.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), revision: REV_TAG, sourceBuilder: "build-r1.mjs",
  note: "Derived fields for every row of the live revision (class/verdict, skillPortCost, replacement, overlap, relevanceToGoals, upstreamHarnessCoupling, couplingMeasurement, evidence). Provided because the fv1 64-item derived inventory is not recoverable.",
  rows: gap.rows, recoveryCoverage: RECOVERY, nameFreeze: NAME_FREEZE, ledgerCandidates: LEDGER,
}, null, 1) + "\n");

const HISTORY = [
  { tag: "fv1", desc: "pre-R1 t4 output: 64 skill items, classDistribution 29/25/10/0", bytes: 147592, sha: "148998a6…", status: "LOST — byte-exact unrecoverable", detail: "Overwritten in place by the R1 rebuild; evidence/omo-align/ is UNTRACKED in git (git status shows '?? evidence/omo-align/') and the builder that generated it was deleted. This is the revision t8's completed scoring was pinned to." },
  { tag: "fv2", desc: "R1 fixed-column rebuild: 32 rows (Table A 22 + Table B 10)", bytes: 56376, sha: "f08c6d09… (gap.json); table cda92397…", status: "LOST — byte-exact unrecoverable", detail: "Overwritten in place by fv3." },
  { tag: "fv3", desc: "fv2 + replacement / skillPortCost fields (Architect's rubric inputs)", bytes: 73777, sha: "not recorded", status: "LOST — byte-exact unrecoverable", detail: "Overwritten in place by fv4 (dual-write banner)." },
  { tag: "fv4", desc: "current: dual-write banner + re-exposed upstreamHarnessCoupling / couplingMeasurement / overlap / relevanceToGoals on Table B rows + revision snapshots", bytes: stat(join(HERE, "gap.json")), sha: sha(join(HERE, "gap.json")), status: "LIVE + immutable snapshot at revisions/" + `${REV_TAG}-${stamp}/`, detail: "This build also introduced the revision discipline: from now on every build writes a new immutable snapshot and never overwrites a previous one." },
];
writeFileSync(join(HERE, "REVISIONS.md"), [
  "# t4 revision index (immutability record)",
  "",
  "`gap.json` / `gap-verdict-table.md` in this directory are the **rolling LIVE copies**. Every build additionally writes an **immutable snapshot** into `revisions/<tag>-<UTCstamp>/` (with a `manifest.json` carrying bytes + sha256) and appends nothing to prior snapshots — a snapshot is never rewritten.",
  "",
  "| tag | 内容 | bytes | sha256 | 状态 |",
  "|---|---|---|---|---|",
  ...HISTORY.map((h) => `| ${h.tag} | ${h.desc} | ${h.bytes} | \`${h.sha}\` | ${h.status} |`),
  "",
  "## What t8 needs to know",
  "",
  "- t8's completed scoring is pinned to **fv1** (sha256 `148998a6…`, 147,592 B) — that revision no longer exists on disk, and its bytes cannot be recovered (untracked path, in-place overwrite, builder deleted).",
  "- t8's own `verdict-table.md` / `gate-rubric.json` / `decisions.json` remain on disk and are the only surviving record of what fv1 contained.",
  "- The current LIVE revision is **fv4**; `revisions/<tag>-<stamp>/` preserves it byte-for-byte, and `raw/derived-rows-fv4.json` carries the derived components so a re-scoring never has to reconstruct them from a lost release.",
  "- Rule adopted: a deliverable that may be scored is never overwritten in place again — new content gets a new revision tag and a new snapshot directory.",
  "",
].join("\n") + "\n");

console.log(`gap.json: ${rows.length} rows (A=${ROWS_T2.length + ROWS_T3.length}, B=${FROZEN_ROWS.length}); verdicts=${JSON.stringify(byVerdict)}; adoptable=${adoptable.length}; table lines=${L.length}`);
