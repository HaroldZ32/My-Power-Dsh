# mpd-tools-plugin

**中文** | [English](./README.md)

针对 row 工具（B1）的代理安全钩子：叠加在工具执行之上的三层防御，通过
`mpd-tools` row 配置。

## 功能

1. **写已有文件守卫**（pre-execute guard，`writeGuard`）：向内容不同的已有文件执行
   `write` 会被拒绝，并附带一条恢复提示（内容完全相同则放行；否则请改用 `edit`）。
   相对的 `file_path` 按**调用会话**的工作区解析（`workspaceRoot`：session cwd →
   `DSH_WORKSPACE_ROOT` → cwd），绝不用 dsh 进程的 cwd，因此守卫检查的正是 write 工具
   将要触碰的那个文件。
2. **工具输出截断**（post-execute waterfall）：超大的输出会被替换为以
   `truncateMaxBytes` 为上限的单个文本块——**包含横幅**，且在任何预算下都成立，所以截断
   后的输出永远不会超过上限（也不会超过它本要裁剪的原文）——保护 token 预算免受巨型工具
   输出的冲击。
3. **编辑错误恢复引导**（post-execute waterfall）：当一次编辑失败时，waterfall 会追加
   一条确定性的恢复提示（重新读取文件、重新核对精确的 old/new 字符串、重试）。

## 配置

| Key | Type | Default |
|---|---|---|
| `writeGuard` | boolean | `true` |
| `truncateMaxBytes` | number | `16384` |
| `recoveryHint` | string | built-in guidance |

## 使用

没有模型工具；这些效果会作用于本会话中的每一次工具调用。bundle row：

```yaml
- id: mpd-tools
  name: '@mpd-dsh/mpd/packages/mpd-tools-plugin/dist/index.js'
  config: { writeGuard: true, truncateMaxBytes: 8192 }
```
