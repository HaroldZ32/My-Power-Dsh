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

边界：bundle patch 仍是 composition 的真相；本层只向插件运行时配置喂数，绝不
改动 dsh patch rows。
