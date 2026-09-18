# mpd-bundle-plugin

**中文** | [English](./README.md)

`@mpd-dsh/mpd` bundle 自身的 main 插件和 Web 客户端界面。两个职责：

1. **Web 兼容 main**——bundle 包的 `main` / `exports["."]` 指向这里。它是一个 no-op 插件（`apply() {}`），名称为 `@mpd-dsh/mpd`。bundle patch 的 `mpd-web-compat` 自引用行（`name: '@mpd-dsh/mpd'`）加载它，这使得 loader 条目名称为**恰好** `@mpd-dsh/mpd`——这是 client-modules 为 bundle 构建 boot-graph 客户端行所要求的入口（没有它任何客户端界面都不会加载）。
2. **合并的 Web 客户端**——`client.js`（由 `scripts/build-mpd-client.mjs` 生成）作为 bundle 的 `./client` 导出被提供：
   - 逐字采用 agent-teams 的 `lib/client.js`（注册 `@nanmicoder/dsh-agent-teams`）。它严格作为**视图库**使用：由 `scripts/patch-agent-teams-client.mjs` 施加的增量导出桥接（由 `scripts/vendor-agent-teams.mjs` 重新施加）暴露其视图/store/词典/CSS，而其 `apply(ctx)` 永不被调用——正是它注册了已删除的对话内团队卡片与活动浮窗，
   - 一个 `@mpd-dsh/team-page` 注册，其 factory 为 `src/team-page.js`：**AgentTeams 页面**，作为 **DSH-better-sidebar** 的一个 Tab 注册（id `mpd-agent-teams`，order 85，`single: true`，进行中团队数角标，`autoOpenOnTeamActivity` 开关，按对话作用域）。它是唯一的团队 GUI：没有该侧边栏时只输出一条警告且不注册任何内容。页面渲染的是被删除浮窗自己的内部结构——采纳的 `panel` 类（它作用域化了每条采纳规则都读的 `--dsw-alias-*` 变量）、带标题/忙碌圆点/收起控件的 `panelHead`、`teams` 主体与采纳的空态提示——只有窗口管理器那一半（定位、拖拽/改宽、浮动外框）被去掉，
   - 一个 `@mpd-dsh/mpd` 注册，其 factory 把 workmate 库贡献为它自己的 **DSH-better-sidebar** Tab（`mpd-workmate`，order 90，`single: true`），它通过 `GET /plugins/mpd-workmate/{list,roster,get}` + `POST /plugins/mpd-workmate/init` 读取和创建 workmate，并通过 `POST /plugins/mpd-workmate/{rename,delete}` 重命名/删除 —— 按 reason 编码的拒绝分支处理（`invalid-name` / `confirm-required` / `unknown` / `collision` / `in-use`（带阻塞团队列表）），删除是显式两步（确认 → 归档，或输入名称后彻底删除），文案 zh/en。base 只按**功能名**寻址：该 Tab 渲染名称，绝不渲染名册 id（id 属内部，workmate 路由也不再携带它们）。它还注册了隐藏 `/agent-teams` 命令结果的 `conversation.chat.commandview` 空行。两个页面都**没有**浮动回退：只要有 mpd client 源注册了 `agent-teams-activity`、`conversation.chat.node`、`shell.overlay` 或 `sidebar.footer.action`，`scripts/build-mpd-client.mjs` 就会让构建失败。

**TUI 对应面。** 本客户端注册的设置卡片，与 TUI 版本渲染的 `/settings` 区块是**同一个** `mpd` settings 命名空间的两半（`packages/mpd-tui-plugin/src/settings.ts`）：两个前门的标签、提示与中文描述互为镜像，并有测试断言两份列表保持一致；两者也陈述同一句桥接披露——保存会写入 `<workspace>/.mpd/mpd.jsonc`（针对当时处于 live 的会话工作区），mpd 插件在重启后按其生效。浏览器只通过公开的 settings 接缝抵达该桥；回写本身属于 `packages/mpd-config-plugin`。改动任一半后请重建合并客户端（`node scripts/build-mpd-client.mjs`）。

**Web 卡片的团队模型选择器。** 卡片镜像 `packages/mpd-config-plugin` 中**唯一**的 25 行 knob 声明（原有 13 个 knob 加十二个 `teamModels` 槽位叶子），并把每个槽位渲染为**联动的、只可选择**的选择器：模型控件的选项是目录中的 provider/model 组合（provider 作为分组显示），推理强度控件的选项是**所选模型自身**的 effort，并在模型变化时重新推导。目录通过**受保护的探针** `ctx.get("sessions")` + `ctx.get("modelDirectories")` 获取 —— 沿用 `team-page.js` 的既有模式，绝不新增必需注入 —— 当探针缺失、没有绑定会话，或 `directoryFor` 抛错时，卡片回退到**声明**的选项列表，区块照常渲染。槽位的任何一项都不能只靠输入来设置。浏览器模块无法 import TS 声明，因此卡片镜像它，并由测试逐项固定声明元数据（path、label、zh、kind、声明选项、人类语句）。每个槽位行**以所属分组和自身的人类语句开头**：标签写明分组（`槽位 2 提供商（分析型成员）`），每个槽位的三行之上有一行分组标题与一句影响说明，人类语句以正常字号/不透明度渲染，强制披露行更暗地跟在下方。两个前门都写出点号形式的 `mpd.jsonc` key，并在该人类语句**之后**携带披露与"不会丢失"条款：TUI 构造 `<人类语句> mpd.jsonc <key> — <披露> <不会丢失>`，卡片镜像同一份声明、同一顺序。

## 配置

无。这是基础设施：自引用行在 bundle patch 中不携带任何配置。

## 重新生成客户端

```bash
node scripts/build-mpd-client.mjs   # after editing src/web-client.js or agent-teams client
node scripts/pack-mpd.mjs           # restage the bundle
```

## 文件

- `src/index.ts`——no-op main 插件。
- `src/web-client.js`——mpd 客户端 factory 主体（纯 JS，React.createElement）。
- `src/team-page.js`——AgentTeams 侧边栏页面 factory 主体（模块 id `@mpd-dsh/team-page`），以同样方式构建进 `client.js`。
- `client.js`——生成的合并客户端（已提交，镜像 vendored agent-teams 客户端工件）。
