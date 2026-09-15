# mpd-tui — `@mpd-dsh/mpd` 的 DSH-TUI 界面

[English](./README.md)

`packages/mpd-tui-plugin` 为 `@mpd-dsh/mpd` 插件包提供 TUI 原生界面。它是单个
Cordis 插件行（`mpd-tui`），其模块说明符由 bundle patch 持有：

```text
@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js
```

本包**故意不包含 `cordis.patch.yml`**：行由 bundle patch
（`packages/mpd-bundle/cordis.patch.yml`）持有，二次挂载会重复 loader entry id
（loader 会直接拒绝重复项）。

## 提供的能力

| 接缝 | 宿主服务 | 用户得到什么 |
|---|---|---|
| 状态行 | `ctx.tuiStatus` | 提示框上方一个键控的 `mpd` 贡献：`mpd: team … · boulder … · plans … · workmates …` |
| 条目渲染器 | `ctx.tuiRenderers` | 本包的 log-only 会话事件（`agent-teams/*`、`mpd-tui/board-opened`）渲染为纯文本行，实时与回放同路径 |
| 设置区块 | `ctx.tuiSettingsSections` | 把 mpd.jsonc 的可调项声明为 `/settings` 中可编辑的字段 —— **未与文件打通**；每个字段的提示在界面上直接写明（见"明确不声明"第 2 条） |
| 全屏场景 | `ctx.tuiScenes` | 团队与任务账本、boulder 工作账本、计划、workmate 库 |
| 命令树 | `ctx.tuiCommandTrees` | `/mpd board`、`/mpd status`、`/mpd workmates` 补全 |
| 快捷键 | `ctx.tuiShortcuts` | `alt+m` 打开面板 · `alt+w` workmate 选择器 · `alt+r` 立即刷新状态行 |
| 对话框 | `ctx.tuiDialogs` | 托管式 workmate 选择器（`select`） |
| 决策事件 | `tuiPluginHost.subscribeDecision` | 已尝试注册、预期被拒绝、**未激活**（见下） |

支撑面（不属于上述七个接缝）：harness 命令注册表上的 `/mpd` 命令、`mpd` 设置
命名空间注册、以及 log-only 的 `mpd-tui/board-opened` 会话记录。

面板是 web 专有界面（agent-teams 侧边栏、workmate 标签页、bundle 浮层）的
TUI 原生等价物。它**只读**状态：

- `<workspace>/.mpd/team/<teamId>/team.json`（取最新记录）
- `<workspace>/.mpd/boulder.json`
- `<workspace>/.mpd/plans/*.md`
- `$HOME/.mpd/workmate/<key>/meta.json`（用户级 workmate 库）

所有路径每次调用都解析到**发起会话的工作区**（
`packages/mpd-dsh-adapter-plugin` 的 `workspaceRoot` / `workspaceRootsAll`），
绝不使用 dsh 进程的 cwd。

## 静态资产

- `themes/mpd-tui.json` —— 一套深色 TUI 主题（部分配色的覆盖）。主题接缝本就是
  静态资产：把文件复制到 `~/.dsh-tui/themes/` 即可选用。本行**不**代为安装。
- `skills/mpd-tui/SKILL.md` —— 仅为资产，见"明确不声明"第 4 条。

## 插件契约

- 纯 ESM，相对导入带 `.js` 后缀；
- `name` / `Config`（类型）/ `Config`（schemastery schema）/ `apply`，**无默认导出**；
- 每个配置键在 schema 与解析器中都带默认值；
- 清理由 `ctx.effect` 持有；
- 每个可选服务都用 `ctx.get(id, false)` 软探测并降级告警——服务缺席时 `apply`
  绝不抛错，因此该行在 web 组合中是惰性的，在 `dsh-tui` 组合中才真正生效。

harness 接缝（tools、skills、agent registry、subagents）不在此处直连：它们统一
走 `packages/mpd-dsh-adapter-plugin`。`tui*` 服务、`ctx.commands` 与
`ctx.settings` 是宿主服务，按宿主文档惯用法直接软探测。

### 配置键

| 键 | 默认 | 作用 |
|---|---|---|
| `statusLine` | `true` | 发布键控状态贡献 |
| `statusIntervalMs` | `3000` | 刷新间隔；`0` 表示仅手动（`alt+r`、`/mpd status`） |
| `renderers` | `true` | 注册条目渲染器 |
| `settingsSection` | `true` | 声明 `/settings` 区块（并注册 `mpd` 命名空间） |
| `scene` | `true` | 注册面板场景 |
| `commandTrees` | `true` | 注册 `/mpd` 补全树 |
| `commands` | `true` | 注册 `/mpd` 命令（面板的打开入口） |
| `shortcuts` | `true` | 注册快捷键 |
| `dialogs` | `true` | 启用托管对话框门面 |
| `sessionEvents` | `true` | 追加 log-only 的 `mpd-tui/board-opened` 记录，且仅在事件类型已验证被可达的 `dsh-session` 副本认识之后 |
| `decisionEvents` | `true` | 尝试托管式决策事件注册（预期被拒绝） |
| `logPrefix` | `"mpd-tui"` | 诊断标签 |

### 诊断

`stdout` 保持安静（TUI 帧占用它）：诊断走 `ctx.logger`；只有在没有 logger 时才
写 `stderr`，且 `debug` 需 `DSH_TUI_DEBUG` 打开。每次启动汇总一行：

```text
[mpd-tui] mpd TUI surfaces: tuiStatus, tuiScenes, tuiDialogs, tuiRenderers, tuiSettingsSections, tuiCommandTrees, tuiShortcuts, commands · skipped: …
[mpd-tui] no DSH-TUI service is composed in this profile (web composition?): every mpd TUI surface was skipped
```

## 明确不声明（NOT CLAIMED）

1. **决策事件接缝（`tui.dsh/v1alpha1#DecisionEvents`）已就绪但未激活。** 对
   profile 安装的插件而言，admission 由 token 把关且不可达（宿主 `b246411` 修订
   的 `src/dsh-adapter/plugin-host.ts`：公开 `admit()` 抛错、`admitInternal` 需要
   未导出的 token、`getHostAdmission*` 无生产调用者），因此身份断言先于任何策略
   判定抛错。本插件据此对四个拦截点（`tui/input`、`tui/rewind-prompt`、
   `tui/session-switch`、`tui/compact`）尝试托管注册、把拒绝视为预期结果、**只
   告警一次**，并且不注册任何东西。它绝不调用 `admit`/`admitInternal`，绝不使用
   测试专用 token，绝不伪造身份。**不声明任何输入 / rewind / 会话切换 / 压缩
   拦截能力。**
2. **`/settings` 区块未与 `.mpd/mpd.jsonc` 打通。** 字段声明的是真实的 mpd.jsonc
   可调项（`hashline.maxDiffChars`、`commentChecker.autoCheck`、`ulw.maxRounds`、
   `memory.vcs`、`team.stateDir`、`boulder.dir`），而区块在 harness 设置命名空间
   `mpd` 下编辑它们（本插件注册该命名空间，以免界面把它显示为不可用）。mpd 各
   插件读的是 `.mpd/mpd.jsonc`（经 `packages/mpd-config-plugin`），**不是** harness
   设置文档：保存的编辑落在设置文档里，**不会**改写 `.mpd/mpd.jsonc`。**这一点在
   界面上也写明，而不只是写在这里**：每个字段提示都是
   `mpd.jsonc <键> — not bridged: a save here does not rewrite .mpd/mpd.jsonc`。
   打通二者是**已命名的后续工作 `mpd-settings-bridge`**（由设置区块回写项目/用户
   JSONC），不是本次交付的行为。
3. **web 专有界面在 TUI 中没有渲染面。** agent-teams 侧边栏、workmate 标签页与
   bundle 浮层（`dsh.client.platform = web`）在 TUI 中不渲染。面板、状态行与
   对话框是**等价物**，不是像素或功能对齐声明。web profile 未受影响。
4. **随包技能仅为资产。** `skills/mpd-tui/SKILL.md` 随包分发，但技能语料由
   `mpd-bootstrap` 从 `<bundle>/skills` 提供；本包内这份副本并未由该行注册。
5. **引擎版本偏差。** 宿主会提示 dsh 引擎比其 UI 验证版本更新；验证针对已安装
   引擎进行，而非该修订。
6. **宿主内部门禁不等于本插件的合规结论。** 宿主自带的 `verify:plugin-*` 套件验证
   的是宿主的插件子系统；即便全绿也不构成对本插件的合规判定。

## 构建与测试

```sh
bun build packages/mpd-tui-plugin/src/index.ts --target node --format esm \
  --outfile packages/mpd-tui-plugin/dist/index.js
bun test packages/mpd-tui-plugin
bun run typecheck
```

`dist/index.js` 使用仓库既有工具链（bun，无联网步骤）构建，且自包含：运行时仅需
Node 内建模块。`Config` schema 来自本包已 vendor 的 schemastery
（`packages/mpd-agent-teams-plugin/_deps/schemastery`）——本包不声明自己的依赖。
该 vendor 副本是本包唯一一个指向**包目录**的相对说明符（经其自身 `package.json`
解析，其中同时给出 `exports.import` 与 `types`）；`src/` 中每一个相对**文件**导入
都带显式后缀（`.js`），而构建产物已把 vendor 副本内联，因此发布产物中不含任何
相对说明符。

## 许可证

不变：沿用仓库许可证（`LICENSE.md`，SUL-1.0）。本包不主张任何许可证变更。
