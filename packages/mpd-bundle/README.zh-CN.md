# mpd-bundle
**中文** | [English](./README.md)

DSH bundle 聚合包：`cordis.patch.yml` 挂载每一个 mpd-dsh plugin row — MCP servers（ast-grep/git-bash/lsp/codegraph + 远程 context7/grep.app + RTL 波形读取行 `mcp-wave-mcp`/`mcp-traceweave` — 外部工具，经 `MPD_DSH_*_BIN` 环境变量优先解析，二进制缺席时优雅降级，安装策略见 `docs/rtl-verif-guide.md`）、B/C 线 plugins（mpd-config 置顶，使 mpdConfig service 对下方 rows 可见；mpd-tools / modelchain / roles / ulw / agent-teams / hashline / boulder / comment-checker / codegraph / memory / workmate / verif）、`mpd-web-compat` 自注册行（`name: '@mpd-dsh/mpd'`——承载 bundle web client 的 loader 条目）以及 mpd-bootstrap provisioning。

该 bundle 只随附 ONE preset（`mpd`，主工作 agent；assets 位于 `packages/mpd-bootstrap-plugin/presets/mpd`）：它配置 `dsh-agent-instructions`，使用 `instructionFileCandidates: [AGENT.md, AGENTS.md, CLAUDE.md]`，使每个 project session 都尝试读取 AGENT.md，并声明 native tool presentation。OMO-origin agents 以 subagent roster（`mpd-roles-plugin`）形式存在，而非 presets。

## 会话启动团队规则（强制）

每个符合条件的会话启动时都必须进入一个 team —— 要么使用自动供应的默认团队，要么由 captain 新建一个。该规则由被采纳的 agent-teams 插件**机械式强制**（`sessionTeamPolicy` 配置，实现见 `packages/mpd-agent-teams-plugin/lib/session-start.js`），而不是仅靠提示词约束：

- 在某个还没有团队（即尚未 lead 任何 team）的会话的第一步，`mode: auto` 会自动供应**“MPD Default”**默认团队（profile `mpd`，`approval: required` —— 成员此时只是 roster 行，只有用户审阅并在 Web 计划面板批准后才会真正 spawn），并向会话注入一条启动提示，告知 captain 会话必须通过该团队运行。已有团队的会话（恢复）则直接沿用原团队。
- 适用范围：`presets: [mpd]` 覆盖 mpd preset 会话，以及没有任何 preset 的会话（headless 直跑）；subagent/成员会话（带 `parentSession`）永远不会被自动建队。
- 该策略每个会话只结算一次：会话中途被删除的团队不会被重建，之后 captain 自己新建的团队也不会被覆盖/争抢。
- `mpd` preset 的 persona 带有对应的 SESSION STARTUP RULE，使 captain 从第一轮起就以 captain 身份工作。

如需完全关闭该规则，将 `sessionTeamPolicy.mode` 设为 `off`（或删除该键）；`mode: instruct` 保留机械启动提示但不会自动创建团队。
