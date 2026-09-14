# mpd-qa-roles-probe

**中文** | [English](./README.md)

仅用于 QA 的探针插件（从不随 bundle 发布）：由 QA overlay（`tests/overlays/roles-probe.yml`）挂载，以在真实启动中断言：(1) `mpd` preset 解析为 unmounted-broken，(2) `mpdRoles` 名册返回完整的 11 角色专家名册。失败时以非零退出，从而让 QA 用例捕获回归。

## 它做什么

`inject: ["agentPresets"]`；在 apply 时解析 `mpd` preset，打印 `PRESET_MPD=ok|broken|fail` + `ROSTER=<ids…>`，然后设置进程退出码。

## 用法

仅由 `skills/dsh-qa/scripts/preset-register.mjs` 使用。构建：

```bash
bun build src/index.ts --target node --format esm --outfile dist/index.js
```
