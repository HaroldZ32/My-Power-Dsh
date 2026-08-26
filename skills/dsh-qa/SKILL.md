---
name: dsh-qa
description: "QA the omo-dsh plugin bundle against the REAL dsh binary in strict isolation. Every case must prove a plugin row is mounted (via dsh --dump-config) or a real tool call succeeds, write evidence to evidence/<domain>/<slug>/, and ship helper scripts that pass --self-test. Use whenever a bundle/plugin change, a DeepSeek route smoke, an MCP wire-up, or a preset registration needs verification."
metadata:
  short-description: Isolated QA for the omo-dsh bundle on the real DeepSeek Harness binary
---

# dsh-qa

QA 技能：在**严格隔离**的 DSH_HOME 下，用真实 `dsh` 二进制验证 omo-dsh bundle/插件行为，证据落盘
`evidence/<domain>/<slug>/`。结构与 omo 原版 `opencode-qa` / `codex-qa` / `senpi-qa` 同款。

## 铁律（不可违反）

1. **隔离**：所有用例必须先创建临时 DSH_HOME（`mktemp -d`）并在其中 boot；严禁读写用户真实 `~/.dsh`。
   脚本内必须断言隔离生效（检查 `$DSH_HOME` 指向临时目录）。
2. **可证明性**：用例必须断言"插件行已挂载"（对 `dsh --dump-config` 输出做子串/结构断言）
   或"真实调用成功"（工具/skill/MCP 实际执行并断言结果），不允许只报告"能跑通"。
3. **证据**：每个用例输出 `result.json` + 原始输出到 `evidence/<domain>/<slug>/<timestamp>/`。
4. **--self-test**：每个辅助脚本必须自带 `--self-test`（离线、无网络、无真实 API），否则视为未完成。

## 用例集（随阶段扩充）

| slug | 领域 | 断言内容 | 阶段 |
|---|---|---|---|
| mount-assert | bundle 挂载 | --dump-config 输出含/不含指定插件行 | P0 |
| llm-dual-track | DeepSeek 双轨 | deepseek-official 与 pi-ai deepseek 路由均可选头（P1 起：headless 真实任务） | P1 |
| skill-load | 技能 | skill 目录可见 + 加载内容完整 | P2 |
| mcp-call | MCP | mcp__<server>__<tool> 可调用且结果合法 | P3 |
| preset-register | 预设 | 预设/persona 注册成功且被 agent 会话解析 | P4 |

## 运行

```bash
# 全部用例（由根脚本驱动）
bun run test:qa

# 单用例：挂载断言（P0 已实现）
node skills/dsh-qa/scripts/mount-assert.mjs --self-test
node skills/dsh-qa/scripts/mount-assert.mjs --expect "name: '@deepseek-ai/dsh-llm'"
```
