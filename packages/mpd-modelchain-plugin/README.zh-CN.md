# mpd-modelchain-plugin

**中文** | [English](./README.md)

为上游 OMO 角色做 DeepSeek 路由解析 + 一个很小的、工作区作用域的 key/value 内存。

## 工具

| Tool | Purpose |
|---|---|
| `mpd_modelchain_resolve` | Resolve the provider/model route for an upstream role id (`sisyphus`, `oracle`, `atlas`, `prometheus`, `librarian`, `explore`, `metis`, `momus`, `hephaestus`, `multimodal-looker`, `sisyphus-junior`) — the roster's chain[0] (with a compatible fallback). |
| `mpd_memory_save` | Persist a key/value note in `<workspace>/.mpd/memory.json`. |
| `mpd_memory_recall` | Read notes by key/substring. |

## 服务用法

惰性地消费 roster（在执行时用 `ctx.get("mpdRoles")`——该服务由 `mpd-roles-plugin` 提供，而兄弟插件提供的服务只有在所有插件都 apply 之后才可靠可见）。

## 配置

无；该行是无状态的。

## 用法

```text
mpd_modelchain_resolve { role: "sisyphus" }   # -> { provider: "deepseek-official", model: "deepseek-v4-pro", ... }
mpd_memory_save { key: "goal", value: "..." }
mpd_memory_recall { key: "goal" }
```
