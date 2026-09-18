# mpd-config-plugin

**中文** | [English](./README.md)

Plan C / C7 —— 极简的 `mpd.jsonc` 运行时配置层。

分层（深合并，项目优先）：项目 `<workspace>/.mpd/mpd.jsonc` 与用户
`$DSH_HOME/mpd.jsonc`（回退 `~/.dsh/mpd.jsonc`）。JSONC（注释 + 尾随逗号），
采用防范原型污染的合并。

## 已知 key

- `memory.vcs`：`git | svn | both`（Plan C / C6 memory 引擎）。
- `teamModels.slot{1,2,3,4}.{provider,model,reasoningEffort}`：四个团队模型槽位 ——
  agent-teams 成员类别的默认路由（见下）。
- `team.stateDir`、`hashline.enabled/guardEditTools`、
  `commentChecker.autoCheck/bin`、`modelchain.<role>`、`boulder.dir`、
  `ulw.maxRounds`。

## 团队模型槽位（`teamModels`）

**agent-teams 成员的默认模型路由**，每个成员类别一个槽位。四个槽位、十二个叶子：

| 槽位 | 路径 | 默认值 | 成员类别（agent-teams `tier`） |
|---|---|---|---|
| 1 | `teamModels.slot1.{provider,model,reasoningEffort}` | `deepseek-official` / `deepseek-v4-flash` / `max` | Architect、Planner、Reviewer、Lead、Senior Engineer（`tier: 1`） |
| 2 | `teamModels.slot2.{provider,model,reasoningEffort}` | `deepseek-official` / `deepseek-v4-flash` / `high` | Researcher、Explorer、Plan Reviewer（`tier: 2`） |
| 3 | `teamModels.slot3.{provider,model,reasoningEffort}` | `deepseek-official` / `deepseek-v4-flash` / `high` | Deep Worker、Junior Engineer（`tier: 3`） |
| 4 | `teamModels.slot4.{provider,model,reasoningEffort}` | `deepseek-official` / `deepseek-v4-flash-vision-exp` / `high` | Vision Analyst（`tier: 4`） |

- **默认值只有一处字面声明**（`TEAM_MODEL_SLOT_DEFAULTS`），因此 schema 默认值与解析出的配置
  不可能漂移。
- **读取路径会物化默认值：** 一个完全没有 `.mpd/mpd.jsonc` 的工作区同样能解析出全部十二个叶子 ——
  `get("teamModels.slot2")`（以及不带 key 的 `mpd_config_get`）即返回默认值。物化结果是**新对象**：
  原始合并后的文件配置永不被改写，默认值也不会泄漏进 settings 文档的回写。
- **Vision Analyst 属于槽位 4：** 它通过 `teamModels.slot4` 路由（默认
  `deepseek-official` / `deepseek-v4-flash-vision-exp` / `high`），因此它的视觉模型和其他成员的
  路由一样可编辑 —— 并且本槽位的模型**必须支持图像输入**，因为读图正是该成员的全部价值。
- **重启语义：** 与本层其他 knob 完全一致 —— 通过 settings 文档保存的值会立即落到
  `<workspace>/.mpd/mpd.jsonc` 并由配置层应用到每个工作区，而**正在运行**的 mpd 插件仍使用它
  在 `apply()` 时读到的配置；行为变更需要重启。
- **两个前端：** 这十二个叶子是唯一 25 行声明（`SETTINGS_KNOBS`：原有 13 个 knob 加这 12 个）中的
  `select` 项，出现在 TUI 的 `/settings` 区块与 Web 界面卡片中。它们的选项列表来自实时模型目录
  （服务端走适配器的 `llmCatalog()`，Web 侧走宿主自身的客户端目录），目录不可用或降级时回退到
  `TEAM_MODEL_FALLBACK_OPTIONS` —— 因此槽位永远是选择，不是自由输入。
- **槽位损坏会大声失败：** 走槽位解析失败的成员（服务缺失、槽位缺失或不完整、模型未知、推理强度
  不受支持）会让创建团队直接失败，并指名成员与槽位，且不写入任何团队状态；推理强度**永远不会**
  被悄悄钳制。

## 服务 / 工具

- 为其他 mpd 插件提供 `mpdConfig` 服务（`inject: ["mpdConfig"]`）：
  `get(key?)`、`reload()`、`states()`。
- `mpd_config_get` / `mpd_config_reload` 工具。

## `/settings` 打通（回写）

本包承担 harness settings 打通中的**回写**一半：TUI 的 `/settings` 区块与 Web 界面
卡片编辑 `mpd` 设置命名空间，保存的编辑会被投影到工作区的 `<workspace>/.mpd/mpd.jsonc`。

- **命名空间 base（由本包拥有）：** `baseForNamespace()` 按数量规则推导
  base —— 一个活动根 ⇒ 该工作区的 `<workspace>/.mpd/mpd.jsonc`；零个根 ⇒ 挂载时（无 exec）的根
  （`DSH_WORKSPACE_ROOT` 或进程 cwd），那里文件缺失即得到空 base（schema 默认值）——这是常规启动
  路径；多于一个根 ⇒ **不虚构任何文件 base**（`base: undefined`、原因 `ambiguous-multi-root`，
  逐一点名全部候选并由 `states()` 暴露），且该状态下的保存会被拒绝。base 在**进程生命周期内
  固定**（宿主对一次活动注册不提供注销句柄），这就是界面提示写作"重启后生效"的原因；消费方使用的
  是**已解析的值**加上本层的**逐次调用文件读取**，因此每个会话仍然解析自己的文件。
- **读入优先级：** L0 schema 默认值 < L1 `$DSH_HOME/mpd.jsonc` < L2
  `<workspace>/.mpd/mpd.jsonc` < **L3 settings 用户区段**（运行期以其为准）；此后若
  文件被再次编辑，重叠的 settings 叶子会被**取消设置**，因此两个方向都不会静默丢失。
- **回写**由宿主的 `settings/document-updated(ns, revision)` 事件触发，并过滤为
  `source === 'update'`；写入持锁、对原始字节做 compare-and-swap、写同目录临时文件、
  再原子改名。**注释、键顺序与尾随逗号都保留**（实测：一次真实启动把一个 21 行的
  JSONC 中 `hashline.maxDiffChars` 从 20000 改为 31415，其余内容未变）。
- **工作区目标：** settings 路径不携带身份，因此目标集合是事件时刻的实机会话工作区
  —— 恰好一个 ⇒ 写入；**零个 ⇒ `no-live-session`**；**多个 ⇒ `ambiguous-multi-root`**
  （逐一列出候选）。两种跳过情形都**不改动任何文件**，而这次编辑**绝不丢失**：它已存入
  宿主全局 settings 文档，配置层会立刻对所有工作区生效。
- **生效时机：** 消费方在插件 `apply()` 时读取配置，因此保存的编辑在**重启后**对 mpd
  插件生效。
- **退化目标会大声报错：** 文件缺失（创建并带头部注释）、只读（`denied` + 路径 +
  errno，settings 编辑仍然成功）、并发（重试 ×3 后 `conflict`，人的文件保持原样）、
  无法解析（`unparsable`，绝不"修复"）。
- **重复键：** `SET` 编辑该路径的**最后一处**，并在警告中列出所有出现行；`UNSET`
  一次由后向前的扫描删除**每一处**（留下较早的一处会让它在文件里继续生效，而 settings
  层却报告已取消）。只有无法证明的区段、被重复的中间键（`ambiguous-intermediate`）、
  无法解析的文档与只读目标才被拒绝。该规则面向用户的陈述见 `docs/tui.md` §6.5。

证据：`evidence/mpd-bridge/implementation/20260915T080138Z/`（两次真实启动，分别对应
一个活动根与两个活动根）、通道 `skills/dsh-qa/scripts/tui-settings-bridge.mjs`、复审
`evidence/mpd-bridge/review/REREVIEW-t49.md`、裁定
`evidence/mpd-bridge/captain/RULING-duplicate-unset-FINAL.md`。

边界：bundle patch 仍是 composition 的真相；本层只向插件运行时配置喂数（外加上述回写
投影），绝不改动 dsh patch rows。
