# 用户指南

**中文** | [English](user-guide.md)

使用 my-power-dsh bundle 的人需要知道的一切，按工作流顺序排列。

## 1. 安装

### 打包 bundle（主要方式，Plan D）

```bash
# 从本仓库：先组装可安装包
node scripts/pack-mpd.mjs                          # -> dist/mpd-package/
dsh plugin --profile <mpd|web> add dist/mpd-package
# 或从任意发布位置（已打包，无需再 pack）
dsh plugin --profile web add <path-or-name-of-@mpd-dsh/mpd>
```

仓库根目录本身不可安装：它是源码 monorepo（`my-power-dsh`，没有 `dsh.bundle`），因此
`dsh plugin add .` 只会加一个普通依赖、不会加入任何行。`pack-mpd` 负责组装 `@mpd-dsh/mpd`
（各插件已构建的 dist + 采纳的 agent-teams 主代码 + skill 语料库与 presets + 合并的 web client
+ 打包形态 patch）。任何源码、dist、skill 或 preset 变更后都要重新执行。

然后启动 DSH，选择 **MPD (Main Working Agent)** 预设。

### 卸载（一条命令，无残留）

```bash
dsh plugin --profile <mpd|web> remove @mpd-dsh/mpd
```

bundle 以“整体”安装、也以“整体”卸载，且包含 skills：插件行来自 bundle patch，
`mpd` preset 由 `<bundle>/presets` 供给（patch 把 preset 名册根指向该目录），
skill 语料库由 `<bundle>/skills` 供给（`mpd-bootstrap` 行注册 `ctx.skills` provider）。
不向 `$DSH_HOME` 复制任何内容，因此卸载会连同行、preset 与 skills 一起移除——
preset 名册回到出厂状态（`default: standard`），`$DSH_HOME/skills` 与
`$DSH_HOME/.agent-presets` 保持原样。刻意保留的是**你自己的数据**：workmate 库
（`~/.mpd/workmate`）与各工作区的 `.mpd/` 状态。

从 bundle `<= 0.2.6`（会把 presets + skills 复制进 `$DSH_HOME`）升级：`>= 0.3.0`
首次启动会自行删除这些带版本戳的副本。旧式 `scripts/install-profile.mjs` 流程写入的
无版本戳副本不会被触碰——如用过该流程，请手动删除。

### 旧式安装器（仅开发/QA）

```bash
node scripts/install-profile.mjs --yes [--profile mpd|mpd-headless] [--dsh-home X] [--skip-toolchain]
node scripts/install-profile.mjs            # --dry-run 只打印计划，不写任何东西
```

QA 场景下绝不要对真实 home 运行旧式安装器（`--dsh-home` 就是为隔离 QA 准备的）。

## 2. `mpd` 预设

唯一交付的预设是 **MPD**，主工作代理。其约定：

- **每个工程指令文件**：会话开始时代理 MUST 尝试读取 `AGENT.md`（依次回退
  `AGENTS.md`、`CLAUDE.md`)—— 预设通过 `dsh-agent-instructions` 配置这些候选名。
- **原生工具呈现**：行工具（bash/read/edit/…）直接暴露。
- 预设 persona 说明了专家、团队模式与 workmate 库（见下），代理无需额外配置即可正确
  ​​路由。

## 3. 专家（roster）

11 个 OMO 起源代理是专家 subagent，**不是预设**：

| 正常名 | 稳定 id | 模型（chain[0]） | 纪律 |
|---|---|---|---|
| Architect | `oracle` | deepseek-v4-pro | 只读 |
| Researcher | `librarian` | deepseek-v4-flash | 只读 |
| Planner | `prometheus` | deepseek-v4-pro | 只读 |
| Deep Worker | `hephaestus` | deepseek-v4-flash | 工作者 |
| Senior Engineer | `sisyphus` | deepseek-v4-pro | 工作者 |
| Lead | `atlas` | deepseek-v4-pro | 工作者 |
| Explorer | `explore` | deepseek-v4-flash | 只读 |
| Reviewer | `metis` | deepseek-v4-pro | 工作者 |
| Plan Reviewer | `momus` | deepseek-v4-flash | 只读 |
| Vision Analyst | `multimodal-looker` | deepseek-v4-flash-vision-exp | 只读 |
| Junior Engineer | `sisyphus-junior` | deepseek-v4-flash | 工作者 |

单发使用：

- `mpd_roles_list` —— 列出 roster。
- `mpd_role_spawn { role, task, context? }` —— 以该专家 persona + 模型路由 spawn 一个
  subagent；只读角色在机制上禁用写工具。
- `mpd_role_persona { role }` —— 取完整 persona 文本（例如传给以文本接收 persona 的
  spawn 接口）。

## 4. Workmate 库（持久化、可演化的专家）

roster 只是 **base 模板**。当你会在跨会话复用某专家时，把它实例化为 *workmate* ——
位于 `~/.mpd/workmate/`（你的 HOME，跨工程）的持久化副本，带独立名字。

```text
mpd_workmate_init   { base: <roster id 或正常名>, name?: <独立名字>, note? }
  → 创建 ~/.mpd/workmate/<name>/{meta.json, persona.md, memory.md, note.md}
```

| 工具 | 用途 |
|---|---|
| `mpd_workmate_list` | 列实例（名字、base、uses、updatedAt、note） |
| `mpd_workmate_spawn { name, task, context? }` | 一次性复用：workmate 携带其演化的 persona + 独立 memory + note，走自身模型路由；它被指示在最终报告前调用 `mpd_workmate_reflect` |
| `mpd_workmate_reflect { name, task, outcome, persona_delta?, note? }` | 工作后自我演化：有界 memory 追加（最旧淘汰）、persona 修订合并、note 重生成、`uses++` |
| `mpd_workmate_match { task }` | 按任务对 note 打分；低于阈值 → `matched: false`，建议是**新建一个 workmate** —— 绝不强行弱匹配 | 

大小上限保证注入上下文有界：persona ≤ 8 KiB、memory ≤ 8 KiB、note ≤ 1.5 KiB。

Workmate 是你的代理的*演化记忆*：每次任务后 workmate 自己总结（通过 spawn 指令或团队
成员 persona），所以以后的会话从它上次停下的地方继续。

## 5. 团队模式（采纳的 dsh-agent-teams）

```text
agent_teams_create { name: <团队名>, description: <目标>, profile: "mpd", approval: "required" }
  → 暂存正常命名的 roster 作为队友 + 空任务 DAG
# 暂存期间：在 Web 计划面板编辑成员/任务，或用
agent_teams_add_member / agent_teams_create_task / agent_teams_edit_plan
agent_teams_approve  # 用户批准 → spawn 成员，调度器启动
# 领导者（你/captain）：
agent_teams_status / agent_teams_send_message / agent_teams_reassign_task
```

- `approval: "required"` 是两阶段流程（推荐）：在 GUI 审查计划前什么都不运行。
- `mpd` profile 是 **captain 计划**（`taskPlanning: captain`）：roster 固定，captain
  在暂存计划期间设计 DAG。
- 只读成员（Architect、Researcher、Planner、Explorer、Plan Reviewer、Vision Analyst）
  绝不编辑文件；工作者（Senior Engineer、Junior Engineer、Deep Worker、Lead、
  Reviewer）实现并验证。
- **Workmate 支撑的成员**：如果你初始化了一个 workmate（如 `alice`）并添加名为
  `alice` 的成员，该成员的系统提示自动携带 `alice` 的 persona + memory + note，并在
  每次任务后把反思写回 workmate。captain 指引：委派前检查 `mpd_workmate_match`；
  弱匹配 → 新建 workmate 而不是强行使用。

## 6. Web GUI

- **团队活动浮窗**（agent-teams）：团队运行时的实时团队树（成员、任务、活动）；从对话
  中的团队卡片打开。
- **🤖 Workmates 按钮**（侧边栏脚部）→ **Workmate 库浮窗**：列出 `~/.mpd/workmate/`
  实例（base、uses、note），并可通过表单（base + 可选 name）经 host 路由
  `/plugins/mpd-workmate/{list,init}` 新建。

## 7. 配置（`mpd.jsonc`）

`mpd-config` 把工程层 `.mpd/mpd.jsonc` 覆盖到用户层 `$DSH_HOME/mpd.jsonc`（按 key，
工程优先）。用 `mpd_config_get` / `mpd_config_reload` 查询。插件读取的 key：

| Key | 消费者 | 含义 |
|---|---|---|
| `memory.vcs` | mpd-memory | `git` / `svn` / `both` |
| `memory.dir`、`memory.agentSlug`、`memory.reflectionEvery` | mpd-memory | 记忆根、代理 slug、反思节奏 |
| `boulder.dir` | mpd-boulder | boulder 台账位置 |
| `hashline.*` | mpd-hashline | 守卫开关、diff 上限、注册文件 |
| `commentChecker.*` | mpd-comment-checker | autoCheck、binary、超时 |
| `ulw.*` | mpd-ulw | 轮数、计划/状态目录、provider/model 路由 |
| `codegraph.*` | mpd-codegraph | autoInit、binary、超时 |

## 8. 排障速查

- `mpd_role_spawn` 未知角色 → id 是 roster id（`oracle`、`sisyphus-junior`、…）；先跑
  `mpd_roles_list`。
- `mpd_workmate_*` 报 "mpdRoles service unavailable" → `mpd-roles` 行未挂载（重装
  bundle / 加行）。
- GUI 里没有团队/workmate 面板 → `mpd-web-compat` 自引用行必须存在且重装 bundle
  （`dsh plugin --profile <p> add dist/mpd-package`）。
- `MISSING_CREDENTIAL` → provider 路由需要你 DSH 凭据中的 key；本 bundle 从不配置
  key。
- AGENT.md 未注入 → 会话运行的是非 `mpd` 预设；切换预设。
