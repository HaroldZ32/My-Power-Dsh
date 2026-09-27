# mpd-bootstrap-plugin

**中文** | [English](./README.md)

Bundle 资产供给（provisioning），采用“引用”而非“复制”：该行通过 Harness 适配器（`mpd-dsh-adapter`）的 skill provider 把 bundle 自带的技能语料库提供给每个会话，并清理旧版本 bundle 写入用户 home 的副本。从此不再向 `$DSH_HOME` 复制任何内容——安装 bundle 即安装它的 skills，卸载 bundle 即移除它们。

## 它做什么

- 通过文件位置解析包根目录（不做包名解析——该插件必须能在任何安装布局下工作，包括 `link:` 检出与整体搬迁）。
- 经由 `mpd-dsh-adapter` 以 `<pkg-root>/skills` 为根注册技能 provider（`name: mpd-bundle`、`source: bundled`、`rank: 600 = BUNDLED_SKILL_RANK`）：目录型技能（`<name>/SKILL.md`）与平铺 `*.md` 文件，frontmatter 由**共享**解析器 `packages/mpd-ext-plugin/src/skill-frontmatter.ts` 在进程内解析（扩展的 skill 面通过同一个模块读取同一种文件格式——见该包 README）。因此语料库“恰好在该 bundle 安装期间可见”，行卸载即消失——没有版本戳，也不会留下过期副本。
- `mpd` preset 采用同一规则：bundle patch 把 `agent-presets` 名册的根指向 `<pkg-root>/presets`（见 `packages/mpd-bundle/cordis.patch.yml`）。
- 迁移旧安装：bundle `<= 0.2.6` 写入 `$DSH_HOME/skills` 与 `$DSH_HOME/.agent-presets` 的“带版本戳副本”，会在首次启动 `>= 0.3.0` 时被移除。版本戳文件即归属证明——没有版本戳的内容（例如旧版 `scripts/install-profile.mjs` 流程写入的副本）与用户自建的 skills/presets 永不删除。
- 语料库内被模型用 `write`/`edit` 修改后，下次读取目录时重新解析（`fs/observed` 失效通知）。

## 配置

| Key | Type | Default |
|---|---|---|
| `skillsDir` | string | `<pkg-root>/skills` |
| `skipSkills` | boolean | `false`（跳过注册语料库 provider） |
| `skipPresets` | boolean | `false`（跳过旧 preset 副本清理） |
| `skipLegacyCleanup` | boolean | `false`（跳过全部旧 home 副本清理） |

## 为什么存在

AGENTS.md §2 要求每个能力都是插件，§6 禁止把逻辑放在用户 home 里。以引用方式供给语料库，正是让 `dsh plugin add` / `dsh plugin remove` 成为“整体安装/整体卸载（含 skills）”的关键。

## 用法

没有面向用户的工具。安装 bundle 并启动 DSH；preset 会出现在选择器中，语料库会出现在每个会话的 skill 目录里。
