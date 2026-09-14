# 用户指南

**中文** | [English](user-guide.md)

使用 my-power-dsh bundle 的人需要知道的一切，按工作流顺序排列。

## 1. 安装

### 一条命令，直接在检出目录安装

```bash
cd <仓库> && dsh plugin --profile <mpd|web> add .
```

仓库根目录**就是** bundle 包（`@mpd-dsh/mpd`）：`dsh.bundle.patch`、`dsh.client` 与 `exports`
映射都在它的 manifest 里，因此这一条命令会装好全部插件行、`mpd` preset 与整个 skill 语料库。
不需要任何其他步骤——没有打包步骤，也没有复制步骤。`dsh plugin remove @mpd-dsh/mpd` 反向卸载同一单元。

### 打包产物（发布/分发）

```bash
node scripts/pack-mpd.mjs                          # -> dist/mpd-package/（可迁移）
dsh plugin --profile <mpd|web> add dist/mpd-package
# 或从任意发布位置
dsh plugin --profile web add <path-or-name-of-@mpd-dsh/mpd>
```

`pack-mpd` 用于**分发**：组装一个自包含、不依赖检出目录的 `@mpd-dsh/mpd`（各插件已构建的 dist +
采纳的 agent-teams 主代码 + skill 语料库与 presets + 合并的 web client + 打包形态 patch）。
发布、交付 tarball 或验证可迁移性时才需要；本地安装永远不需要它。

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

专家名册中的 11 个专家是专家 subagent，**不是预设**：

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
| `mpd_workmate_rename { name, new_name }` | 重命名实例（搬移其已演化的身份） |
| `mpd_workmate_delete { name, purge?, confirm? }` | 删除实例——默认先归档；只有 `purge: true` + `confirm: <name>` 才彻底移除 |

大小上限保证注入上下文有界：persona ≤ 8 KiB、memory ≤ 8 KiB、note ≤ 1.5 KiB。

Workmate 是你的代理的*演化记忆*：每次任务后 workmate 自己总结（通过 spawn 指令或团队
成员 persona），所以以后的会话从它上次停下的地方继续。

### 重命名与删除 workmate

**名称仅限 ASCII**（`[a-z0-9_-]`，小写）。`Alice`、CJK 名称、`a/b` 或 `..` 都会在一开始就被
`400 invalid-name` 拒绝——磁盘上什么都不会被改动。Unicode 名称是已列出的后续项，不是缺陷。

**重命名**（`mpd_workmate_rename { name, new_name }`）是**搬移**而不是重建：目录键、
`meta.json`、库索引、note 的自引用以及先前名称历史（`renamedFrom`）一起搬移，而 persona、
memory、使用次数与创建时间都逐字节保留。重命名到一个已存在的名称会被拒绝（`409 collision`），
重命名到当前名称同样被拒绝。

**删除**（`mpd_workmate_delete { name }`）默认**先归档**：实例移入
`~/.mpd/workmate/.archive/<name>-<stamp>/`，立即从 `list` 与 `match` 中消失，并且可以手动恢复：

```bash
mv ~/.mpd/workmate/.archive/<name>-<stamp> ~/.mpd/workmate/<name>
```

只有显式的 purge 才会销毁任何东西：`mpd_workmate_delete { name, purge: true, confirm: "<name>" }`
——必须给出确切的名称，否则调用被拒绝且什么都不删除。产品内没有恢复按钮：先归档在界面上刻意是
单向的，恢复就是上面的 `mv`。

**两种变更在该 workmate 正在被使用时都会被拒绝**——被某个团队成员占用（`.mpd/team/` 下某个
未归档的团队记录里出现了它），或被一个正在进行的 `mpd_workmate_spawn` 占用。拒绝为 `409 in-use`，
并列出阻塞的团队 id 与成员，因此可据此处理：结束/归档那些团队，然后重试。同一道门也覆盖重命名的
*目标*，所以把一个 workmate 重命名**为**某个正被团队使用的 roster 名称（例如 `architect`）也会
被同样拒绝。

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

- **AgentTeams 侧边栏页（唯一的团队界面）**：整个团队 GUI 是 **DSH-better-sidebar**
  （`dsh-better-sidebar`，社区侧边栏 bundle；Tab id `mpd-agent-teams`）中的一个 Tab。它列出
  *本对话* 的团队 —— 先进行中的（成员及其实时活动、带状态的任务行、依赖图、captain 上下文、
  停止团队控件），再已归档的 —— 并在此承载暂存计划审批编辑器，计划就在它被创建的地方审查与编辑。
  Tab 角标显示本对话进行中的团队数量，且该 Tab 为 `single: true`：切换对话时复用同一个 Tab
  而不是再开一个。团队出现时该 Tab 会自动打开一次；可在侧边栏设置页用
  **Auto-open when a team appears** 开关关闭（插件设置 `autoOpenOnTeamActivity`，默认开启）。
  该 Tab 渲染的正是被移除浮窗自己的内部结构 —— 带标题、实时活动圆点与收起控件的面板头、
  可滚动的团队主体、采纳的空态提示与归档标签 —— 因此看起来与被它取代的面板完全一致；
  收起控件关闭的就是侧栏面板本身。原来的对话内团队卡片与右上角活动浮窗**已删除**，且没有回退：
  没有 DSH-better-sidebar 的 profile 只会输出一条警告，并且完全没有团队 GUI —— 团队协作仍通过
  `agent_teams_*` 工具与 `.mpd/team` 状态进行。
- **Workmates 侧边栏页**：workmate 库作为 **DSH-better-sidebar**
  （`dsh-better-sidebar`，社区侧边栏 bundle）的第二个 Tab 注册，因此它就位于该侧边栏自己的页面
  所在之处 —— Tab 条、`+` 菜单、以及在侧边栏设置里的启用/禁用开关。页面列出
  `~/.mpd/workmate/` 实例（base、uses、更新时间、note），支持筛选、点开查看
  persona/memory/note，并通过**由 roster 填充的 base 选择器**（无需手打 id）加可选
  name/note 新建。它还可以**重命名**与**删除**所选实例 —— 删除流程是显式的（确认步骤、归档，
  以及再一步需要输入确切名称的彻底删除），两种操作都已本地化（zh/en）。数据来自 / 提交到 host
  路由 `GET /plugins/mpd-workmate/{list,roster,get}` + `POST /plugins/mpd-workmate/{init,rename,delete}`。
  侧边栏**标签栏文字**本身仍是英文 `Workmates`（有记录的延后项——标签栏文字在注册处解析，
  那里没有可用的本地化翻译函数，与 AgentTeams Tab 一致）；页面主体跟随你的语言。
- **两个页面都只在侧边栏**：都没有回退。没有 DSH-better-sidebar 时各自只输出一条警告且不注册
  任何东西，并且 bundle 不再附带 workmate 的 🤖 浮窗与侧栏脚部按钮。

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
- workmate 重命名/删除**因正在被使用而被拒绝** → `.mpd/team/` 下某个未归档的团队记录里出现了
  它，或某个 `mpd_workmate_spawn` 仍在运行。拒绝信息会列出阻塞的团队；在 AgentTeams Tab 里
  归档（或退休）那些团队并等运行中的 spawn 结束，然后重试。重命名为某个正被使用的 roster
  名称（`architect`、`lead`、…）会被同样拒绝。
- workmate 被误删 → 默认删除只是**归档**：把 `~/.mpd/workmate/.archive/<name>-<stamp>` 搬回
  `~/.mpd/workmate/<name>` 即可。产品内没有恢复功能，而 `purge`（需 `confirm: <name>`）
  无法恢复。
- workmate 名称被拒绝（`400 invalid-name`）→ 名称仅限 ASCII、小写 `[a-z0-9_-]`：大写、空格、
  标点、`/` 与 CJK 名称都会在改动任何东西之前被拒绝。请改用 ASCII 名称；Unicode 名称是已列出的
  后续项。
- 侧边栏里没有 AgentTeams Tab → 重新构建发布的 client
  （`node scripts/build-mpd-client.mjs`，然后刷新页面），并确认 profile 装有
  `dsh-better-sidebar`（没有它团队页面只输出一条警告，且没有宿主）。
- GUI 里完全没有客户端界面 → `mpd-web-compat` 自引用行必须存在且重装 bundle
  （`dsh plugin --profile <p> add dist/mpd-package`）。
- `MISSING_CREDENTIAL` → provider 路由需要你 DSH 凭据中的 key；本 bundle 从不配置
  key。
- AGENT.md 未注入 → 会话运行的是非 `mpd` 预设；切换预设。
- 侧边栏报 `cannot resolve target "…/team-activity"` → AgentTeams tab 的"自动打开"过去会给侧边栏一个
  占位文件路径；从 `dsh-better-sidebar` 0.19 起，带路径的 open 会被路由到 DSH 原生右栏，而右栏会真的解析文件。
  更新 bundle 即可（`git pull` 后执行 `dsh plugin --profile <p> add <仓库路径>`）并刷新页面 —— 现在自动打开
  不带 seed，tab 会直接打开。
- **创建 `mpd` 会话总是失败，报错为 `agent-preset/invalid … $.prefix missing required value`**
  → 已安装的 Harness 改了 `dsh-persona` 的约定（现在取 `prefix`，不再是废弃的 `text`），
  因而拒绝挂载整个预设。更新 bundle 即可（`git pull` 后执行
  `dsh plugin --profile <p> add <仓库路径>`）—— 这是 Harness 版本兼容性修复，不是你侧配置问题。
