# mpd-bundle
**中文** | [English](./README.md)

DSH bundle 聚合包：`cordis.patch.yml` 挂载每一个 mpd-dsh plugin row — MCP servers（ast-grep/git-bash/lsp/codegraph + 远程 context7/grep.app）、B/C 线 plugins（mpd-config 置顶，使 mpdConfig service 对下方 rows 可见；mpd-tools / modelchain / roles / ulw / agent-teams / hashline / boulder / comment-checker / codegraph / memory / workmate）、`mpd-web-compat` 自注册行（`name: '@mpd-dsh/mpd'`——承载 bundle web client 的 loader 条目）以及 mpd-bootstrap provisioning。

该 bundle 只随附 ONE preset（`mpd`，主工作 agent；assets 位于 `packages/mpd-bootstrap-plugin/presets/mpd`）：它配置 `dsh-agent-instructions`，使用 `instructionFileCandidates: [AGENT.md, AGENTS.md, CLAUDE.md]`，使每个 project session 都尝试读取 AGENT.md，并声明 native tool presentation。OMO-origin agents 以 subagent roster（`mpd-roles-plugin`）形式存在，而非 presets。
