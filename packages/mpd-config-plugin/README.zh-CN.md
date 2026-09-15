# mpd-config-plugin

**中文** | [English](./README.md)

Plan C / C7 —— 极简的 `mpd.jsonc` 运行时配置层。

分层（深合并，项目优先）：项目 `<workspace>/.mpd/mpd.jsonc` 与用户
`$DSH_HOME/mpd.jsonc`（回退 `~/.dsh/mpd.jsonc`）。JSONC（注释 + 尾随逗号），
采用防范原型污染的合并。

## 已知 key

- `memory.vcs`：`git | svn | both`（Plan C / C6 memory 引擎）。
- `team.stateDir`、`hashline.enabled/guardEditTools`、
  `commentChecker.autoCheck/bin`、`modelchain.<role>`、`boulder.dir`、
  `ulw.maxRounds`。

## 服务 / 工具

- 为其他 mpd 插件提供 `mpdConfig` 服务（`inject: ["mpdConfig"]`）：
  `get(key?)`、`reload()`、`states()`。
- `mpd_config_get` / `mpd_config_reload` 工具。

## `/settings` 打通（回写）

本包承担 harness settings 打通中的**回写**一半：TUI 的 `/settings` 区块与 Web 界面
卡片编辑 `mpd` 设置命名空间，保存的编辑会被投影到工作区的 `<workspace>/.mpd/mpd.jsonc`。

- **命名空间 base（由本包拥有）：** `baseForNamespace()`（`src/index.ts:511`）按数量规则推导
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
  无法解析的文档与只读目标才被拒绝。

证据：`evidence/mpd-bridge/implementation/20260915T080138Z/`（两次真实启动，分别对应
一个活动根与两个活动根）、通道 `skills/dsh-qa/scripts/tui-settings-bridge.mjs`、复审
`evidence/mpd-bridge/review/REREVIEW-t49.md`、裁定
`evidence/mpd-bridge/captain/RULING-duplicate-unset-FINAL.md`。

边界：bundle patch 仍是 composition 的真相；本层只向插件运行时配置喂数（外加上述回写
投影），绝不改动 dsh patch rows。
