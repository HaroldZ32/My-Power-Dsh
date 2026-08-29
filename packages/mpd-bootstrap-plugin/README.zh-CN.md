# mpd-bootstrap-plugin

**中文** | [English](./README.md)

Bundle 启动配置（provisioning）：在启动时，以幂等方式将 `mpd` preset 复制到 `$DSH_HOME/.agent-presets/`，并将技能语料库复制到 `$DSH_HOME/skills`，都加盖 bundle 版本戳，因此已安装的副本只在包版本变化时刷新。

## 它做什么

- 通过文件位置解析包根目录（不做包名解析——该插件必须能在任何安装布局下工作，包括 `link:` 检出）。
- `syncTree(presets, userPresetsDir, version, ...)` 复制匹配 `mpd`/`mpd-*` 的 preset 目录；`syncTree(skills, userSkillsDir, version)` 复制整个 `skills/` 语料库。
- 版本戳标记：当已安装的戳等于 bundle 版本时跳过复制（bump `package.json` version → `node scripts/pack-mpd.mjs` → 重启以刷新）。

## 配置

| Key | Type | Default |
|---|---|---|
| `presetsDir` | string | `<pkg-root>/presets` |
| `skipPresets` | boolean | `false` |
| `skillsDir` | string | `<pkg-root>/skills` |
| `skipSkills` | boolean | `false` |

## 为什么存在

打包的 bundle 在安装时不写入 `$DSH_HOME`；此行是唯一受过批准的、启动时写入 `$DSH_HOME` 的机制（AGENTS.md §6）。它使随附的 preset 和 skills 对所有加入该 bundle 的 profile 都可用。

## 用法

没有面向用户的工具。安装 bundle 并启动 DSH；preset 会在首次启动后出现在选择器中。
