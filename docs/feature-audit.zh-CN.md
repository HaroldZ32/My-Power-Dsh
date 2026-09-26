# 功能审计 — 上游 spec vs my-power-dsh

**中文** | [English](./feature-audit.md)

本文档是移植的**当前基线/能力对照**：AGENTS.md §1 将其引用为工程目标。历史移植规划记录
位于 `docs/plan-*`，属于 process 记录，不属于本审计范围。

审计日期：2026-08-26。基线：上游项目 8c57e46（v5.0.0-beta.20）能力面。
图例：✅ 完整 / 🟡 部分 / ❌ 缺失 / ➖ 不适用（宿主特定遗留）。

| 领域 | 上游 spec | 状态 | 位置 / 说明 |
|---|---|---|---|
| Agent roster（11） | sisyphus, sisyphus-junior, hephaestus, oracle, librarian, explore, metis, momus, atlas, multimodal-looker, prometheus | ✅ | mpd-roles-plugin roster，使用常规显示名（Senior Engineer, Junior Engineer, Deep Worker, Architect, Researcher, Explorer, Reviewer, Plan Reviewer, Lead, Vision Analyst, Planner）；一次性咨询走 `mpd_role_spawn`，队友模板由 Lead 用官方 `spawn_teammate` 按名字创建（persona 文本取自 `mpd_role_persona`） |
| 团队模式 | 11-agent 编排、mailbox、tasklist、state、worktree、tmux | ✅ | **官方** Agent Teams 插件，由本 bundle 的 `mpd-agent-team` / `mpd-tool-agent-team` / `mpd-ui-agent-team` 三行挂载（三个已声明 `dependencies`）：持久可续队友（`spawn_teammate`，fresh 或 fork）、带唤醒的持久逐成员邮箱（`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`）、带依赖与就绪判定的 compare-and-set 共享任务板（`team_task_*`），以及会话头部里的 Web 名册/任务板面板。团队状态保存在 **Lead 的会话日志**里 —— 没有 `.mpd/team` 记录，也没有 worktree 或 tmux 集成（上游的 worktree/tmux 两项记为 ➖）。已退役的内置 `dsh-agent-teams` 主体只作为来源记录保留；见下文小节 |
| Workmate 库 | 持久演化 agent 池（~/.mpd/workmate），base→instance、自反思、note 复用、重命名/删除 | ✅ | mpd-workmate-plugin：roster BASE → 独立命名 instance（persona/memory/note，大小封顶：8/8/1.5 KiB）；工作后自总结（mpd_workmate_reflect）；note 匹配复用（mpd_workmate_match，阈值 0.35——弱匹配不得强用，应新建 workmate）；一次性复用走 mpd_workmate_spawn；**重命名**（mpd_workmate_rename —— 搬移目录键 + meta + 索引键 + note 自引用 + renamedFrom，绝不重新实例化）与**删除**（mpd_workmate_delete —— 先归档到 `.archive/<key>-<stamp>/`，只有 purge + confirm === name 才彻底移除；恢复靠手动 `mv` 搬回，产品内没有恢复功能）；两种变更在该 workmate 被进行中的 spawn（或**旧版** `.mpd/team` 记录）占用时都以 409 `in-use` 拒绝并列出阻塞团队，且与变更处于同一同步块；名称仅限 ASCII `[a-z0-9_-]`（CJK/大写在任何 fs 调用前即拒绝；Unicode 延后）。路由：`POST /plugins/mpd-workmate/{rename,delete}`，遵循 §D 状态/reason 矩阵。团队参与靠**提示词**：队友之所以带着 workmate 的 persona/memory，是因为 captain 把它们放进了 `spawn_teammate` 的提示词 —— 自动 memberPersona 注入属于已退役的内置插件。库按设计位于用户 HOME（QA 用 HOME=<sandbox> 启动）。GUI：该库是一个 DSH-better-sidebar Tab（`mpd-workmate`），仅此一处 —— 浮层与页脚开关已移除，侧边栏是它唯一的宿主；该 Tab 带 zh/en 的重命名/删除控件。Evidence：evidence/plan-f/workmate-library、evidence/workmate/rename-delete-core、evidence/workmate/rename-delete-gui、evidence/workmate/rename-delete-verify |
| ultrawork / ulw loop | plan->execute->verify 纪律、模式、hashline 编辑 | ✅ | mpd_ultrawork v2 引擎：discovery waves（2 次无果即停）、逐 criterion PIN->RED->GREEN->SURFACE->CLEAN、plan gate + verification gate（最多 2 次 re-review）+ quality gate ledger、可选 hyperplan 对抗波、subagent barrier（evidence/plan-c/c2-ultrawork；确定性引擎测试）。mpd_ulw 保留为轻量别名；可作为 `/ulw <objective>` / `/ultrawork <objective>` 直接调用（等价；工作确需团队时该运行自行以 `approval="automatic"` 建队）；execute-verify 中可接 hashline/comment-checker 钩子 |
| /goal 与 goal rounds | 上游 /goal 带持久状态 | ✅ | DSH 原生 goal + tool-goal + command-goal + goal-round-driver |
| ralph loop | 全新 agent 迭代 | ✅ | DSH 原生 tool-ralph |
| plan mode | 仅规划模式 | ✅ | DSH 原生 plan-mode |
| delegate / multi-model | delegate-task 带 fallback chains | 🟡 | subagent 工具 + mpd_modelchain_resolve（11 roles，2-3 层 DeepSeek chains）。上游 model-core 更丰富的 variant/effort 映射未移植 |
| 后台 agent | 并行后台任务 | ✅ | DSH jobs + tool-jobs |
| Skills 语料 | 上游 skill corpus | ✅ | 已移植（2026-08-27）：语料随仓库发布于 `skills/`（18 个目录，含 `svn-master` 与本仓库自有的 `dsh-qa`），并以**引用**方式服务 —— `mpd-bootstrap` 通过 adapter 把 `<bundle>/skills` 注册为 `bundled` skill provider，因此不会复制进 `$DSH_HOME`；见 `docs/omo-parity-gap.md` 的 §Content gaps |
| Rules / AGENTS.md | 嵌套规则发现与注入 | ✅ | DSH agent-instructions（baseline + nested + change tracking） |
| 内置 MCPs（5） | git_bash, lsp, codegraph, context7, grep_app | ✅ | git_bash（win-gated）、lsp（8 工具）、codegraph（plugin+init）、context7、grep_app（远程行）+ 额外 ast_grep |
| Slash commands | /goal /ultrawork /team /hyperplan … | 🟡 | DSH 原生命令 + `/mpd-codegraph`、ULW 命令对 `/ulw` + `/ultrawork`（等价；目标即参数）+ TUI 的 `/mpd` 命令树；ULW 引擎同时以工具交付（`mpd_ultrawork`、`mpd_ulw` 轻量别名）。没有 `/team`，也没有 `/agent-teams` —— 团队工作由官方工具驱动 |
| hashline 哈希编辑 | 保持哈希的编辑纪律 | ✅ | mpd_hashline_read/edit/format/restore + 注册文件 post-edit guard（vendor hashline-core；evidence/plan-c/plan-c-smoke + 单元测试） |
| comment-checker | post-edit 注释检查 | ✅ | mpd_comment_check（opt-in 二进制 @code-yeongyu/comment-checker，MIT；installer --with-comment-checker；autoCheck 默认关闭；单元测试 + plan-c-smoke） |
| monitor / toast / TUI sidebar | 会话监视器 + UI | ➖ | 由 DSH session telemetry（otel）、token-meter、web GUI 取代 |
| Telemetry | posthog DAU | ✅ | 由 DSH session-telemetry-otel 取代（无 posthog） |
| 记忆引擎 | git-backed MemFS + 反思 | ✅ | mpd-memory-plugin：Markdown memo 文件（frontmatter）、journal、反思状态机（step-count/manual 触发、reservation）、VCS 抽象支持 git 与 svn 后端（memory.vcs git\|svn\|both）；工具 mpd_memory_write/read/reflect/reflect_complete/status；evidence/plan-c/c6-memory + 单元测试（git 真实提交、svn fake-CLI 接线） |
| Boulder state | 持久工作状态机 | ✅ | mpd_boulder_status/start/complete/task_timer/plan_progress/plans 于 .mpd/boulder.json（vendor boulder-state，dsh: session 前缀；evidence/plan-c/plan-c-smoke + 单元测试） |
| Config（上游 config） | 分层 config schema | ✅ | 最小 mpd.jsonc 运行时层（项目 .mpd/mpd.jsonc + 用户 $DSH_HOME/mpd.jsonc，JSONC，深合并；bundle patch 仍是组合真相；evidence/plan-c/plan-c-smoke + 单元测试） |
| LSP 工具 | diagnostics/goto/refs/rename/symbols | ✅ | mcp__lsp__*（8 工具，经离线构建的 daemon） |
| 多模态 | 图像分析模型路由 | ✅ | modality 路由实测：fixture PNG -> deepseek-v4-flash-vision-exp 官方 API -> 接地答案（evidence/plan-c/c8-vision） |
| 模型护栏 | capability 启发式/别名 | ✅ (scoped) | mpd_modelchain_resolve 中的 chains（11 roles，DeepSeek-first）。上游 model-core 深度有意跳过（用户决策：仅 DeepSeek，官方 vs 非官方 API；D-C9） |
| 宿主特定遗留 | claude-code compat loaders、opengateway、mcp-oauth、上游 CLI 运行时 | ➖ | 对 DSH bundle 有意排除 |

## 缺口闭合（Plan C waves）

- Wave A：团队采纳（dsh-agent-teams，MIT 声明，实时 mailbox/DAG 面板/归档）、hashline 插件、boulder 插件、mpd.jsonc config 层、vision e2e 证明；
- Wave B：ultrawork v2 引擎（waves/gates/ledger/hyperplan）、comment-checker 插件（opt-in 二进制）、vendor gate PASS；
- Wave C：git + svn 版本化 + 反思的记忆引擎（mpd-memory-plugin，实测 PASS + 单元测试）。
- Plan C 完成：除 model-core 深度（用户决策 D-C9）与宿主特定遗留集（有意排除）外，全部审计缺口已闭合。

## 剩余缺口 / 后续项（在 docs/plan-c.md 跟踪）

- C6（next）：git + svn 版本化 + 反思状态机的记忆引擎（用户：两种 VCS 都需要）。
- model-core 深度：有意跳过（用户决策，D-C9）。
- tmux 团队可视化：由官方 Agent Teams 面板（会话头部里的 Web 名册/任务板视图）取代。

## 已退役的 dsh-agent-teams：版本与**保留**主体尚未跟进的上游差距

**请把本节读作保留代码的历史，而不是随包能力。** 内置的 `agent-teams` 主体作为来源记录保留在
`packages/mpd-agent-teams-plugin/`，自 0.1.7-rc.2 起没有任何 loader 行挂载它 —— 那一次由官方
Agent Teams 插件取代（见上文团队模式行与 `docs/plan-0.1.7-adaptation.md`）。

保留版本为 `0.1.16-rc.3-mpd`：**0.1.14 本体** + 该宿主世代所需的上游 **0.1.16-rc.3** 增量 ——
`lib/harness-compat.js`（在 harness **0.1.5-rc.2+** 上经公开的
`ctx.subagents.prompt(request, signal)` 可续投递面进行团队投递，Alpha.2 的 `followup` 与
Alpha.5…0.1.2-rc.1 的符号键控 FIFO 队列 `Symbol.for('dsh.subagent.queuePrompt')` 仅作为
旧世代回退保留；`agent/session-start` 上的同步成员初始化从事件负载中取得 live Agent
（`setup(agent.ctx, agent)`），而不再读 `childCtx.agent` —— agent 作用域的 Cordis ctx 是代理，
读取会抛 `cannot get property "agent" without inject`（不存在 `agent` 服务；宿主注入的是复数
`agents`），且该监听器对队长自身会话同样触发，旧读法会全队中止成员初始化、使 0.1.5 团队模式
不可用；所有投递面上的退役守卫）、`lib/capabilities.js`
（按 agent 作用域的成员指令 + 禁用队长专属工具）、`lib/tool-names.js`、
`lib/web-routes.js`（浏览器鉴权闸门 + 有界 JSON body）、成员回合失败处理
（`failMemberOpenAttempt`），以及持久性修复（settled 队伍锁释放、可选任务字段空白归一化、
队长 `claim_task` 守卫、parked attempt 恢复幂等）。证据：`evidence/agent-teams/scheduler-wakeup-fix/`。

**保留**主体有两处上游增量暂未采纳（两者都不影响随包会话 —— 它们跑在官方插件上）：

| 上游增量 | 暂不采纳的原因 | 采纳所需工作 |
| --- | --- | --- |
| 浏览器 bundle 0.1.14 → 0.1.16-rc.3（`lib/client.js`） | 出货 client 是 npm 预构建产物；其增量是 client-runtime → `store`/`ui-chat`/`ui-conversation` 的导入适配，以及成员模型徽章的位置/样式调整，属 UI 打磨而非功能缺失 | 用 rc.3 构建替换 `lib/client.js`(+`.map`)，重跑 `scripts/patch-agent-teams-client.mjs`（导出桥），重钉 `test/export-bridge.test.mjs` 的 class map，并重新验证侧边栏页面一致性与 `web-client-adapt`/`agent-teams-sidebar` QA |
| 精简固定团队指令（#138） | 本仓的 usage 文本带有 MPD 专属规则（roster profile、workmate backing、Web 审批控制消息），上游的精简核心协议没有这些；改写会改变每个会话的系统提示 | 按上游精简协议重写 `usageSectionText` 并保留 MPD 规则，然后重跑能力/提示相关 QA |
