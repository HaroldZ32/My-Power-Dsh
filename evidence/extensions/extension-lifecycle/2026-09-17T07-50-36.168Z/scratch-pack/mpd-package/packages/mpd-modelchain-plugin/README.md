# mpd-modelchain-plugin

**English** | [中文](./README.zh-CN.md)

DeepSeek route resolution for the specialist roster + a tiny workspace-scoped
key/value memory.

## Tools

| Tool | Purpose |
|---|---|
| `mpd_modelchain_resolve` | Resolve the provider/model route for an upstream role id (`sisyphus`, `oracle`, `atlas`, `prometheus`, `librarian`, `explore`, `metis`, `momus`, `hephaestus`, `multimodal-looker`, `sisyphus-junior`) — the roster's chain[0] (with a compatible fallback). |
| `mpd_memory_save` | Persist a key/value note in `<workspace>/.mpd/memory.json`. |
| `mpd_memory_recall` | Read notes by key/substring. |

## Service usage

Consumes the roster lazily (`ctx.get("mpdRoles")` at execute time — the service is
provided by `mpd-roles-plugin`, and a sibling-provided service is only reliably
visible after all plugins have applied).

## Config

None; the row is stateless.

## Usage

```text
mpd_modelchain_resolve { role: "sisyphus" }   # -> { provider: "deepseek-official", model: "deepseek-v4-pro", ... }
mpd_memory_save { key: "goal", value: "..." }
mpd_memory_recall { key: "goal" }
```
