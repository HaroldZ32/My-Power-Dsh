# mpd-modelchain-plugin

**中文** | [English](./README.md)

为专家名册做 DeepSeek 路由解析 + 一个很小的、工作区作用域的 key/value 内存。

## 工具

| Tool | Purpose |
|---|---|
| `mpd_modelchain_resolve` | 为名册角色解析 provider/model 路由，按角色 NAME 寻址（`Senior Engineer`、`Architect`、`Plan Reviewer` 等，大小写与分隔符任意）。**对名册成员而言，agent 自己的 `agentRoutes` 条目是唯一的路由来源**：已配置的条目以它的 `provider` + `model`、按顺序的 `fallbacks` 和 `status: "configured"` 作答；被路由但**不可用**的条目（叶子缺失或格式错误）返回空的 `provider`/`model`、`chain: []`、`status: "unconfigured"`、缺失的叶子，并在 reason 里点名出问题的 `agentRoutes.<Agent>` 路径 —— **绝不**回落到内置路由。只有 `unrouted` 成员（由扩展贡献、`agentRoutes` 不决定其路由的 role）才依次落到实时的 `modelchain.<id>` overlay、它自己声明的链、以及合并后的表。**不存在槽位**：`TEAM_MODEL_SLOT_GROUPS` 只是 `/mpd-model` 的分组，用来编辑每个成员自己的条目。内部键 —— 稳定 id、legacy 的 `mpd-<id>` 形式、camelCase 链键 —— 会被**响亮拒绝**，错误中只列出名册名称；未知角色或未给出角色同样被拒绝，而不再静默地返回通用默认链。 |
| `mpd_memory_save` | Persist a key/value note in `<workspace>/.mpd/memory.json`. |
| `mpd_memory_recall` | Read notes by key/substring. |

## 服务用法

惰性地消费 roster（在执行时用 `ctx.get("mpdRoles")`——该服务由 `mpd-roles-plugin` 提供，而兄弟插件提供的服务只有在所有插件都 apply 之后才可靠可见）。正是名册让 NAME 可被解析：未挂载名册时，本工具会响亮拒绝，而不是给出一个通用路由。

## 配置

两个 key，都可选（`Config = { memoryFile?, chains? }`）：

- `memoryFile` —— 记忆存储的路径，相对调用会话的工作区根解析；缺省即工具自己使用的默认值
  `<workspace>/.mpd/memory.json`（`memoryPath`）。
- `chains` —— 一张按角色的链表（`Record<roleKey, Array<{provider, model}>>`），**逐 key** 覆盖内置的
  `DEFAULT_CHAINS`：表里没有的 key 仍由 `resolveRole` 从内置表、再到 `sisyphus` 作答。经 `mpdConfig`
  读到的实时 `modelchain.<key>` 叶子优先于两者，且按调用读取。

该行不保留其它状态；链表在每次调用时重新解析（`chainsNow`、`overlayNow`），绝不在 `apply` 时冻结。

## 用法

```text
mpd_modelchain_resolve { role: "Senior Engineer" }
#   已配置   -> { provider, model, chain: [主路由, ...fallbacks], status: "configured" }
#   不可用   -> { provider: "", model: "", chain: [], status: "unconfigured", missing: [...], reason }
mpd_memory_save { key: "goal", value: "..." }
mpd_memory_recall { key: "goal" }
```
