# mpd-modelchain-plugin

**中文** | [English](./README.md)

为专家名册做 DeepSeek 路由解析 + 一个很小的、工作区作用域的 key/value 内存。

## 工具

| Tool | Purpose |
|---|---|
| `mpd_modelchain_resolve` | 为名册角色解析 provider/model 路由，按角色 NAME 寻址（`Senior Engineer`、`Architect`、`Plan Reviewer` 等，大小写与分隔符任意）。优先返回名册自身的 `chain[0]`；该角色没有自己的链时才回落到内置/已配置的链表。内部键 —— 稳定 id、legacy 的 `mpd-<id>` 形式、camelCase 链键 —— 会被**响亮拒绝**，错误中只列出名册名称；未知角色或未给出角色同样被拒绝，而不再静默地返回通用默认链。 |
| `mpd_memory_save` | Persist a key/value note in `<workspace>/.mpd/memory.json`. |
| `mpd_memory_recall` | Read notes by key/substring. |

## 服务用法

惰性地消费 roster（在执行时用 `ctx.get("mpdRoles")`——该服务由 `mpd-roles-plugin` 提供，而兄弟插件提供的服务只有在所有插件都 apply 之后才可靠可见）。正是名册让 NAME 可被解析：未挂载名册时，本工具会响亮拒绝，而不是给出一个通用路由。

## 配置

无；该行是无状态的。

## 用法

```text
mpd_modelchain_resolve { role: "Senior Engineer" }   # -> { provider: "deepseek-official", model: "deepseek-v4-flash", ... }
mpd_memory_save { key: "goal", value: "..." }
mpd_memory_recall { key: "goal" }
```
