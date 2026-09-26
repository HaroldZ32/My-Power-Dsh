# mpd-qa-roles-probe

**中文** | [English](./README.md)

仅用于 QA 的探针插件（从不随 bundle 发布）：由 QA overlay（`tests/overlays/roles-probe.yml`）挂载，以在真实启动中断言：(1) `mpd` preset 解析且挂载未损坏，(2) `mpdRoles` 名册返回完整的 11 角色专家名册。失败时以非零退出，从而让 QA 用例捕获回归。

## 它做什么

它经由 bundle 的共享适配器（`createDshAdapter` / 已挂载的 `mpdDsh`）读取每一个 Harness 接缝，并为每个主题打印一行可 grep 的输出：`PRESET_MPD=ok|broken|fail`、`PRESET_RESOLVE_POLLS`、`PRESET_PATH`、`ADAPTER_SEAMS`、`ADAPTER_TOOL_CALL`、`ROSTER` / `ROSTER_NAMES`、AgentTeams 工具注册探针、`TOOL_PARAM_SCHEMAS`、`SKILLS` / `SKILL_FIXTURE`，最后是决定进程退出码的 `PASS|FAIL` 行。

**preset 解析是有界轮询，而非单次读取（0.1.7-rc.2 行模型）。** 部署默认值位于 `agent-preset-registry` 的 `config.default`，preset 本身则是 `config.id` 匹配的 `@deepseek-ai/dsh-agent-preset` 行；因此 `resolve("mpd")` 读取的是注册表的**实时**定义映射，而该映射是在 `preset-mpd` **行 apply 时**写入的 —— loader 会让它与这个由 overlay 插入的探针行**并发** apply。单次立即读取因此会与它要查询的那一行竞争（2026-09-27 实测：其它启动断言全绿，而 `PRESET_MPD=fail:Unknown agent preset: mpd`）；只有注册表的 `not-found` 应答会被重试，且预算很短，`PRESET_RESOLVE_POLLS` 报告实际尝试次数。

`PRESET_PATH` 现在指向**提供** preset 的产物：声明该行的 bundle patch（`<bundle>/presets/mpd.patch.yml`，由探针自身的安装位置推导），并带 `trust=bundle`。已退役的目录模型在 preset 记录上不再有 `path`/`trust` 字段，返回它们就是在编造。

## 用法

由 `skills/dsh-qa/scripts/bundle-lifecycle.mjs`（启动子断言 `probePass` / `presetProbeOk`）、`skills/dsh-qa/scripts/preset-register.mjs` 与 `skills/dsh-qa/scripts/relocate-smoke.mjs` 使用。构建：

```bash
bun build packages/mpd-qa-roles-probe/src/index.ts --target node --format esm --outfile packages/mpd-qa-roles-probe/dist/index.js
```
