# mpd-config-plugin

**中文** | [English](./README.md)

Plan C / C7 —— 极简的 `mpd.jsonc` 运行时配置层。

分层（深合并，项目优先）：项目 `<workspace>/.mpd/mpd.jsonc` 与用户
`$DSH_HOME/mpd.jsonc`（回退 `~/.dsh/mpd.jsonc`）。JSONC（注释 + 尾随逗号），
采用防范原型污染的合并。

## 已知 key

- `memory.vcs`：`git | svn | both`（Plan C / C6 memory 引擎）。
- `teamModels.slot{1,2,3,4}.{provider,model,reasoningEffort?}`：四个团队模型槽位 ——
  每个成员类别唯一一条配置好的路由，可带该槽位自己的 `fallbacks` 链（见下）。没有默认层：
  未配置的槽位会拒绝它的 spawn。
- `team.stateDir`、`hashline.enabled/guardEditTools`、
  `commentChecker.autoCheck/bin`、`modelchain.<role>`、`boulder.dir`、
  `ulw.maxRounds`。

## 团队模型槽位（`teamModels`）

**每位名册成员唯一一条配置好的模型路由**，每个成员类别一个槽位。四个槽位、十二个叶子，
外加每个槽位自己的可选回退链：

| 槽位 | 路径 | 成员类别 |
|---|---|---|
| 1 | `teamModels.slot1.{provider,model,reasoningEffort?}` | Architect、Planner、Reviewer、Lead、Senior Engineer |
| 2 | `teamModels.slot2.{provider,model,reasoningEffort?}` | Researcher、Explorer、Plan Reviewer |
| 3 | `teamModels.slot3.{provider,model,reasoningEffort?}` | Deep Worker、Junior Engineer |
| 4 | `teamModels.slot4.{provider,model,reasoningEffort?}` | Vision Analyst（本槽位的模型**必须支持图像输入**） |

- **没有默认层。** 槽位子树里没有任何 `.default()`，`TEAM_MODEL_SLOT_DEFAULTS` 与
  `withTeamModelsDefaults` 已**删除**：从未配置的工作区没有路由，未声明的 `teamModels` 块读出来就是
  **不存在**（`get("teamModels")` 为 `undefined`，`mpd_config_get` 不会凭空造一个）。
- **没有覆盖项。** `agentRoutes` 已从 schema、knob 列表、解析器、TUI 对话框与 Web 卡片中删除。
  旧 `.mpd/mpd.jsonc` 里残留的 `agentRoutes` 块会被**忽略**且永不改写 —— 保存一个无关叶子后它逐字节不变。
- **槽位可带自己的回退链：** `fallbacks: [{provider, model, reasoningEffort?}, …]`，按优先级排列。
  它在 spawn 之前**只消费一次**：实时目录**正面列出**的第一条候选胜出（「未被列出」不等于「不可用」；
  没有任何正面列出时主路由保留），胜出者随后经过推理强度适配，格式错误的条目被丢弃并记一行日志，
  绝不致命。
- **读取是全域的（TOTAL）。** `mpdConfig.slotResolutionOf(member)` 返回一个有类型的联合 ——
  `ok`（路由 + 回退链）、`unconfigured`（点名缺失的叶子）、`invalid`（点名出错的路径）或
  `unrouted`（没有槽位托管该成员）—— 并且**永不抛异常**，因此展示面渲染 `<unconfigured>` 而不是崩溃。
  `teamModelRouteOf(member)` 同样是全域的：`ok` 时给路由，否则 `undefined`。
- **不可用的槽位会拒绝 spawn**，给出一个结构化的 `SLOT_UNCONFIGURED` 错误，点名槽位、成员、缺失的叶子
  与两条修复路径（`/mpd-model`，以及 `.mpd/mpd.jsonc` 里的 `teamModels.slotN`），并说明未写入任何内容、
  未启动任何子会话。只有三条 spawn 施加者（`mpd_role_spawn`、`mpd_workmate_spawn`、`mpd-roster`
  队友 provider）会抛出它；推理强度永远不会被钳制。唯一的例外是模型能力适配：目录条目**完全没有**
  推理等级的模型不会收到任何等级，调用照常运行（适配器的 `withSupportedEffort`）。
- **初始配置是文件初始化，而不是运行时默认值。** 若工作区的 `.mpd/mpd.jsonc` 未声明 `teamModels`，
  挂载时会**只播种一次**：通过 LLM 目录从已配置的提供商中选取 —— 模型取 `deepseek-flash` 家族
  （优先精确的 `deepseek-flash`，否则取近似的 `*flash*` id），提供商取列出该模型的已配置提供商，
  强度为 `slot1=max`、`slots 2-4=high`。写入时记一行日志；已存在的块或用户编辑永不改写；成功的播种会在
  `<ws>/.mpd/model-config-seed.json` 留下持久标记（以 `wx` 创建、永不覆盖、在任何尝试之前先检查），
  因此你故意删除的块永远不会被重新播种；目录不可用时
  不写入任何内容，第一次 spawn 报告 `SLOT_UNCONFIGURED`。
- **两个前端：** 这十二个叶子是唯一 26 行声明（`SETTINGS_KNOBS`：原有 13 个 knob、这 12 个，再加
  TUI 界面自身的一个 knob）中的 `select` 项，出现在 TUI 的 `/settings` 区块与 Web 界面卡片中；卡片的
  「当前生效」块会显示每个槽位的状态（未配置时显示 `<unconfigured>` 与缺失的叶子）。它们的选项列表来自
  实时模型目录（服务端走适配器的 `llmCatalog()`，Web 侧走宿主自身的客户端目录），目录不可用或降级时
  回退到 `TEAM_MODEL_FALLBACK_OPTIONS` —— 因此槽位永远是选择，不是自由输入。
- **重启语义：** 模型路由按次读取，所以一次保存（或监听到的文件编辑）会让下一次 spawn/解析就携带新值，
  无需重启；`mpd_config_reload` 可强制重读。

## 服务 / 工具

- 为其他 mpd 插件提供 `mpdConfig` 服务（`inject: ["mpdConfig"]`）：
  `get(key?)`、`reload()`、`states()`、`teamModelRouteOf(member)`。
- `teamModelRouteOf(member)` 是让**已保存**的 `teamModels` 槽位真正生效的那次读取：
  它按成员解析其槽位（成员表来自两个设置入口共用的唯一声明），在物化默认值之上解析，
  返回 `{ provider, model, reasoningEffort? }`；对该成员未被槽位路由的情况返回
  `undefined`；当被槽位路由的成员其槽位缺少 provider 或 model 时**抛错**并点名成员与槽位。
  花名册的一次性路径（`mpd_role_spawn`、`mpd_roles_list`、workmate 库与
  `mpd_modelchain_resolve`）都经此服务读取，因此保存的槽位无需第二条跨包 import
  即可抵达它们。
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
一个活动根与两个活动根）、通道 `skills/dsh-qa/scripts/tui-settings-bridge.ts`、复审
`evidence/mpd-bridge/review/REREVIEW-t49.md`、裁定
`evidence/mpd-bridge/captain/RULING-duplicate-unset-FINAL.md`。

边界：bundle patch 仍是 composition 的真相；本层只向插件运行时配置喂数（外加上述回写
投影），绝不改动 dsh patch rows。
