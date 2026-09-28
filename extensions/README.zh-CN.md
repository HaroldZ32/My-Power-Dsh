# 扩展 —— bundle 自带的发现根目录

[English](./README.md)

`extensions/` 是 MPD 扩展接口（loader row `mpd-ext`，cordis 服务 `mpdExtensions`）
的 **bundle 自带发现根目录**。每个直接子目录只要携带 `mpd-ext.json` 清单，就会在
**apply 时**被发现，并走与代码面 `register(descriptor, { root })` 完全相同的校验路径。
这里不需要安装步骤、不需要 profile patch 行、也不需要重新构建：放进一个目录就是全部流程。

本目录只附带 **一个** 扩展：[`mpd-ext-example/`](./mpd-ext-example)，并且刻意处于禁用状态。

## 三个发现根目录

| 根目录 | 生命周期 | 可贡献的种类 |
|---|---|---|
| `<会话工作区>/.mpd/extensions/*/mpd-ext.json` | **每次调用** —— 从发起调用的会话工作区解析 | 仅 `skills` + `flows` |
| `~/.mpd/extensions/*/mpd-ext.json` | 主机级，在 apply 时发现 | `skills`、`flows`、`mcp`、`roles` |
| `<bundle>/extensions/*/mpd-ext.json`（本目录） | 主机级，在 apply 时发现 | `skills`、`flows`、`mcp`、`roles` |

这个划分不是形式上的。工具与技能 provider 的注册是 **进程级全局** 的，且不存在会话级
的接入点，因此项目级扩展只能贡献那些"每次调用都会重新读取"的种类。项目清单若声明
`mcp` 或 `roles`，会以 **逐个条目、附带明确原因** 的方式被拒绝 —— 绝不允许半加载。

id 相同时的优先级为 **project → user → bundle**（先到者胜）；被遮蔽的条目会被记录并由
`mpd_ext_list` 报告，既不致命也不静默。

## 附带示例

`mpd-ext-example` 声明了全部四种贡献种类，并附带一个可用的、零依赖的 stdio MCP 服务器
（[`server.ts`](./mpd-ext-example/server.ts)）。它以 `"enabled": false` 发布，因此全新
安装不会启动任何东西。

若想端到端观察整条链路，把它复制到一个可写位置，将 `"enabled"` 改为 `true`，然后重启 `dsh`：

```bash
cp -r extensions/mpd-ext-example ~/.mpd/extensions/
# 编辑 ~/.mpd/extensions/mpd-ext-example/mpd-ext.json  ->  "enabled": true
```

随后在会话中确认：

- `mpd_ext_list` —— 该扩展、它所在的 plane（`user`）以及加载状态；
- `mpd_ext_show` —— 解析后的资源根、skill/flow/role 名称，以及每个 MCP 服务器的确切状态
  （`connected`、`unavailable`、`failed`、`disabled`）；
- `mpd_flow_list` / `mpd_flow_show` —— 所贡献的 flow；
- MCP 工具 `mcp__lint-mcp__describe_extension` —— 对示例服务器的一次真实调用。

## 校验与脚手架

开发者 CLI 与运行时共享 **同一个** 校验器：`validate` 接受的清单，loader 也会接受。

```bash
bun scripts/mpd-ext.ts validate extensions/mpd-ext-example   # 通过则退出码 0，否则逐条目报错
bun scripts/mpd-ext.ts scaffold my-extension --dir /tmp/ext  # 清单 + skill + flow + role
bun scripts/mpd-ext.ts list                                  # 本主机会发现什么
bun scripts/mpd-ext.ts --self-test                           # CLI 自身的检查
```

`validate` 在任何一项有问题时以退出码 `1` 结束，并对每个条目打印一行，因此可以安全用于 CI。

## 在把扩展放到这里之前，需要知道的事

- **未知键会被拒绝，而不是被忽略。** 写错的描述符键会产生明确的逐条目错误——一个被静默
  接受却什么也不做的键，正是这套接口要消灭的失效模式。
- **stdio MCP 服务器是一个子进程。** 它只继承一小份安全环境变量（SDK 的继承列表），
  绝不会继承主机上名字形如凭据的变量；它需要什么请在该清单的 `env` 中声明。
  插件被释放时它会被回收。
- **第三方 schema 不会被静默改写。** 服务器的 `inputSchema` 会被投影到 harness 接受的
  schema 子集上，且根不是 object 时会被归一化到 object 根（每次工具调用携带的都是一个
  参数对象，因此载荷会移入单一的 `value` 属性，并且这一降级会被记录）；而超出该子集的
  `outputSchema` 只会让该工具失去 **schema**、不会失去工具本身——它会在没有
  `structuredContent` 的情况下完成注册，原因同样会被记录。
- **这种净化作用的诚实边界。** 本版 harness 在注册时校验的是 `outputSchema`，而
  `inputSchema` 是原样透传的（harness 自带的 MCP 桥接就是这么做的），因此对
  `inputSchema` 的投影是 **面向未来 harness 的纵深防御**，并非针对当前会发生的失败。
  今天真正承重的是 `outputSchema` 的"保留或丢弃"规则，且它遵循 harness 自身的姿态
  （`supportedOutputSchema`）：被 harness 拒绝的 schema 丢弃的是 **schema**、保留的是
  工具——否则该拒绝会从工具注册处抛出，进而拖垮整棵插件树。只有连 **参数** 都无法描述的
  工具才会被跳过。
- 搬运一个扩展意味着复制它的整个目录：清单中的资源引用都相对于扩展根解析，绝对路径或
  `..` 逃逸会被拒绝。

完整的作者契约见 [`packages/mpd-ext-plugin/README.md`](../packages/mpd-ext-plugin/README.md)，
开发者指南见 [`docs/extensions.md`](../docs/extensions.md)。
