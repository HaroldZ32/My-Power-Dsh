# mpd-config-plugin

**中文** | [English](./README.md)

Plan C / C7 —— 极简的 `mpd.jsonc` 运行时配置层。

分层（深合并，项目优先）：项目 `<workspace>/.mpd/mpd.jsonc` 与用户
`$DSH_HOME/mpd.jsonc`（回退 `~/.dsh/mpd.jsonc`）。JSONC（注释 + 尾随逗号），
采用防范原型污染的合并。

## 已知 key

- `memory.vcs`：`git | svn | both`（Plan C / C6 memory 引擎；`both` 会向两个后端各提交一次）。
  在 Settings 中同样可以直接选中 `both`：`SettingsSchema` 的 union 与 `SETTINGS_KNOBS` 的 option
  列表都已包含它。
- `agentRoutes.<Agent>.{provider,model,reasoningEffort?,fallbacks?}`：**按 AGENT** 的模型路由 ——
  模型配置的单位，每个名册成员一个条目，可带该 agent 自己的 `fallbacks` 链（见下）。没有默认层：
  未配置的条目会让该 agent 的单次 spawn 以 `AGENT_UNCONFIGURED` 被拒绝。
- `team.stateDir`、`hashline.guardEditTools/maxDiffChars/registryFile`、
  `commentChecker.autoCheck/bin`、`modelchain.<role>`、`boulder.dir`、
  `ulw.maxRounds`。

## Agent 路由（`agentRoutes`）

**每位名册成员唯一一条配置好的模型路由，就是该成员自己的条目。** 模型配置的单位是 AGENT，
**不存在持久化的槽位**：

```
agentRoutes: {
  "<Agent Name>": { provider?: string, model?: string, reasoningEffort?: string, fallbacks?: ModelRoute[] }
}
ModelRoute = { provider: string, model: string, reasoningEffort?: string }
```

键是十一个显示名（查找不区分大小写与分隔符，走**唯一**导出的成员名归一化函数 —— 它就在本包内，由解析器、
迁移写入方与每条展示路径复用）。四个分组**仅**作为 `/mpd-model` 的批量编辑分组存在：分组编辑写入每个
成员自己的条目，自身不存储任何东西。

- **没有默认层。** `agentRoutes` 子树里没有任何 `.default()`（schema 默认值会盖过用户文件，因为行配置层
  最后合并）：从未配置的工作区没有路由，未声明的 `agentRoutes` 块读出来就是**不存在**
  （`get("agentRoutes")` 为 `undefined`，`mpd_config_get` 不会凭空造一个）。
- **`teamModels` 是受容忍的遗留块**，声明为宽松节点而不是有类型的槽位树，因此既有的 profile patch 或
  行配置仍能通过校验并启动。它**只**被一次性迁移（见下）与 `mpd_config_get` 的原样透传读取：
  **永不**参与路由，本 bundle **永不**写它。
- **条目可带自己的回退链：** `fallbacks: [{provider, model, reasoningEffort?}, …]`，按优先级排列。
  它在 spawn 之前**只消费一次**：实时目录**正面列出**的第一条候选胜出（「未被列出」不等于「不可用」；
  没有任何正面列出时主路由保留），胜出者随后经过推理强度适配，格式错误的条目被丢弃并记一行日志，
  绝不致命。
- **读取是全域的（TOTAL）。** `mpdConfig.agentRouteResolutionOf(member)` 返回一个有类型的联合 ——
  `ok`（路由 + 回退链）、`unconfigured`（点名缺失的叶子）、`invalid`（点名出错的路径）或
  `unrouted`（由扩展贡献的 role；它刻意不带 `agent` 字段）—— 并且**永不抛异常**，因此展示面渲染
  `<unconfigured>` 而不是崩溃。`agentRouteOf(member)` 同样是全域的：`ok` 时给路由，否则 `undefined`。
  `slotResolutionOf` / `teamModelRouteOf` 这两个名字已**移除**。
- **不可用的路由会拒绝 spawn**，给出一个结构化的 `AGENT_UNCONFIGURED` 错误，点名该 agent、缺失的叶子
  （`agentRoutes.<Agent>.provider`、`.model`）与两条修复路径（`/mpd-model`，以及 `.mpd/mpd.jsonc` 里的
  `agentRoutes.<Agent>`），并说明未写入任何内容、未启动任何子会话。只有三条 spawn 施加者
  （`mpd_role_spawn`、`mpd_workmate_spawn`、`mpd-roster` 队友 provider）会抛出它；`unrouted` **不是**
  拒绝，因此扩展 role 保留自己的链并照常 spawn；推理强度永远不会被钳制。唯一的例外是模型能力适配：
  目录条目**完全没有**推理等级的模型不会收到任何等级，调用照常运行（适配器的 `withSupportedEffort`）。
- **初始化是文件初始化，而不是运行时默认值；而且标记带版本。** 挂载时对每个存活工作区根：
  若 `agentRoutes` 已在**任意**层声明，写入标记 `{"version": 2}`，其它什么都不改；否则若**生效**配置
  声明了 `teamModels`，按各组路由物化全部十一条 `agentRoutes` 条目（记一行日志点名遗留来源）并写入 v2
  标记；否则通过 LLM 目录从已配置的提供商中播种十一条条目 —— 模型取 `deepseek-flash` 家族（优先精确的
  `deepseek-flash`，否则取近似的 `*flash*` id），提供商取列出该模型的已配置提供商，强度 slot-1 分组为
  `max`、其余为 `high` —— 然后写入 v2 标记。只要标记**缺失**、无法解析或版本低于 2，初始化就会运行
  （v0.15.4/v0.15.5 发过无版本标记，只看存在会把那些回归的工作区搁浅），而一旦存在 v2 标记，你故意删除的
  块永远不会被重新播种。已存在的块或用户编辑永不改写；目录不可用时不写入任何内容，第一次 spawn 报告
  `AGENT_UNCONFIGURED`。
- **两个前端：** schema 为每个名册 agent 声明一行三片叶子
  （`agentRoutes.<Agent>.{provider,model,reasoningEffort}`），出现在 TUI 的 `/settings` 区块与 Web 界面
  卡片中，按四个分组标题归组（分组**仅用于显示**）；未配置的 agent 显示 `<unconfigured>` 与它缺失的叶子。
  两者都写 `agentRoutes.<Agent>.<leaf>`，都不写 `teamModels`。它们的选项列表来自实时模型目录（服务端走
  适配器的 `llmCatalog()`，Web 侧走宿主自身的客户端目录），目录不可用或降级时回退到
  `TEAM_MODEL_FALLBACK_OPTIONS` —— 因此叶子永远是选择，不是自由输入。

## 服务 / 工具

- 为其他 mpd 插件提供 `mpdConfig` 服务（`inject: ["mpdConfig"]`）：
  `get(key?)`、`reload()`、`states()`、`agentRouteResolutionOf(member)`、`agentRouteOf(member)`。
- `agentRouteResolutionOf(member)` / `agentRouteOf(member)` 是让**已保存**的 `agentRoutes` 条目
  真正生效的那两次读取。前者返回有类型、永不抛错的联合（`ok` / `unconfigured` / `invalid` /
  `unrouted`），供展示面渲染；后者在 `ok` 时返回 `{ provider, model, reasoningEffort?, fallbacks? }`，
  否则返回 `undefined`。花名册的一次性路径（`mpd_role_spawn`、`mpd_roles_list`、workmate 库与
  `mpd_modelchain_resolve`）都经此服务读取，因此保存的路由无需第二条跨包 import 即可抵达它们。
  已移除的名字 `slotResolutionOf` / `teamModelRouteOf` 不得回归。
- `mpd_config_get` / `mpd_config_reload` 工具。

## `/settings` 打通

本包承担 harness settings 打通中配置这一侧。**在用的保存路径是 ENTRY 文档；`mpd.jsonc` 回写是已退役的 legacy 路径。** TUI 的 `/settings` 区块与 Web 界面卡片都保存本行的 `mpd-config` ENTRY 文档（`ENTRY_CONFIG_ID`、`configForms.get("mpd-config")`），而该存储归**宿主**所有：本行的 `onSettingsDocumentUpdated(ENTRY_CONFIG_ID, …)` 监听器从中重新加载 `state`，并刻意**不写任何工作区文件**。`<workspace>/.mpd/mpd.jsonc` 的写入只存在于 **LEGACY** 的 `mpd` 命名空间（`SETTINGS_NS`），而钉住的 harness **拒绝**它的注册 —— `settingsModelRetired`，启动时只有一行警告："the legacy file write-back and override clearing are dormant" —— 因此在钉住的宿主上这条路径从不运行。对 `<workspace>/.mpd/mpd.jsonc` 的**手工编辑仍然会被读到**：文件层在每次解析时都会重新读取，挂载时安装的 `watchRoot` 监视器也会经同一个 150 毫秒防抖把这次编辑送进 `state`。

**读回（READ-BACK）是实时的；生效（EFFECT）按旋钮而异。** `mpd_config_get` / `mpd_config_reload` 每次调用都重读各层并立刻报告新值，但在 `apply()` 时已捕获配置的消费方仍旧按旧值行事。两组加一个特例都在此写明 —— 绝不只写好看的那一半（逐旋钮的表是 `docs/user-guide.md` §9.1）：

- **在运行中的进程里实时生效** —— 模型路由（`agentRoutes.*`、`modelchain.*`）、`team.gate` / `team.sensitivity`、`team.stateDir` 的读取方，以及两道守卫 `captain.investigation` / `delegation.gate`（每次决策都读本行自己的 `configValue`）；
- **在 `apply()` 时被捕获，因此需要下一次 `dsh` 启动** —— `hashline.*`、`commentChecker.*`、`ulw.*`、`memory.*`、`boulder.dir`、`goal.*`；
- **一个特例 —— `watchdog.*`**：它的 ROW CONFIG 是挂载时捕获的默认层，而工作区 `<workspace>/.mpd/mpd.jsonc` 的**文件层**在每次旋钮重读时都会重新读取（挂载时、`mpd` 命名空间的 `settings/document-updated` 事件上 —— 仅限 legacy 宿主 —— 以及每个 tick），因此对该文件的手工编辑**是实时生效的**。而前门 `/settings` 的保存**不会**抵达它的旋钮：引擎读取 `settingsReader("mpd")`，从不读表单保存的 `mpd-config` ENTRY 文档 —— 存下的值只是声明，旋钮值来自行配置与文件。

只保存在 settings 的编辑**绝不会丢失**：值留在宿主 settings 文档里，配置层立刻将其应用到每个工作区 —— 而且因为这条路径不写文件，它从不等候活动会话。

### LEGACY 命名空间路径（在钉住的宿主上处于 DORMANT）

以下条目描述的是 `mpd` **命名空间**桥接（`SETTINGS_NS`）—— 也就是仍提供该命名空间的宿主会执行的完整路径。钉住的 harness 拒绝这次注册，因此在本宿主上整条路径都处于休眠；它们仍被记录，因为代码仍然带着它，legacy 宿主也仍会执行它。

- **命名空间 base（由本包拥有；LEGACY）：** `baseForNamespace()` 按数量规则推导
  base —— 一个活动根 ⇒ 该工作区的 `<workspace>/.mpd/mpd.jsonc`；零个根 ⇒ 挂载时（无 exec）的根
  （`DSH_WORKSPACE_ROOT` 或进程 cwd），那里文件缺失即得到空 base（schema 默认值）——这是常规启动
  路径；多于一个根 ⇒ **不虚构任何文件 base**（`base: undefined`、原因 `ambiguous-multi-root`，
  逐一点名全部候选并由 `states()` 暴露），且该状态下的保存会被拒绝。base 在**进程生命周期内
  固定**（宿主对一次活动注册不提供注销句柄）；消费方使用的是**已解析的值**加上配置层的
  **逐次调用文件读取**，因此每个会话仍然解析自己的文件。
- **读入优先级（LEGACY 命名空间层）：** L0 schema 默认值 < L1 `$DSH_HOME/mpd.jsonc` < L2
  `<workspace>/.mpd/mpd.jsonc` < **L3 settings 用户区段**（运行期以其为准）；此后若
  文件被再次编辑，重叠的 settings 叶子会被**取消设置**，因此两个方向都不会静默丢失。
  L3 需要仍提供该命名空间的宿主；L0–L2 的**文件层**才是上面那条实时读路径。
- **回写（LEGACY，休眠）**由宿主的 `settings/document-updated(ns, revision)` 事件触发，并过滤为
  `source === 'update'`；写入持锁、对原始字节做 compare-and-swap、写同目录临时文件、
  再原子改名。**注释、键顺序与尾随逗号都保留**（在 legacy 路径上实测：一次真实启动把一个 21 行的
  JSONC 中 `hashline.maxDiffChars` 从 20000 改为 31415，其余内容未变）。
- **工作区目标（LEGACY，休眠）：** settings 路径不携带身份，因此目标集合是事件时刻的实机会话工作区
  —— 恰好一个 ⇒ 写入；**零个 ⇒ `no-live-session`**；**多个 ⇒ `ambiguous-multi-root`**
  （逐一列出候选）。两种跳过情形都**不改动任何文件**，而这次编辑**绝不丢失**：它已存入
  宿主全局 settings 文档，配置层会立刻对所有工作区生效。
- **退化目标会大声报错（LEGACY，休眠）：** 文件缺失（创建并带头部注释）、只读（`denied` + 路径 +
  errno，settings 编辑仍然成功）、并发（重试 ×3 后 `conflict`，人的文件保持原样）、
  无法解析（`unparsable`，绝不"修复"）。
- **重复键（LEGACY，休眠）：** `SET` 编辑该路径的**最后一处**，并在警告中列出所有出现行；`UNSET`
  一次由后向前的扫描删除**每一处**（留下较早的一处会让它在文件里继续生效，而 settings
  层却报告已取消）。只有无法证明的区段、被重复的中间键（`ambiguous-intermediate`）、
  无法解析的文档与只读目标才被拒绝。该规则面向用户的陈述见 `docs/tui.md` §6.5。

LEGACY 桥接的证据：`evidence/mpd-bridge/implementation/20260915T080138Z/`（两次真实启动，分别对应
一个活动根与两个活动根）、通道 `skills/dsh-qa/scripts/tui-settings-bridge.ts`、复审
`evidence/mpd-bridge/review/REREVIEW-t49.md`、裁定
`evidence/mpd-bridge/captain/RULING-duplicate-unset-FINAL.md`。

边界：bundle patch 仍是 composition 的真相；本层只向插件运行时配置喂数（外加上述 LEGACY
回写投影 —— 钉住的宿主从不运行它），绝不改动 dsh patch rows。
