# mpd-modelchain-plugin

**English** | [中文](./README.zh-CN.md)

DeepSeek route resolution for the specialist roster + a tiny workspace-scoped
key/value memory.

## Tools

| Tool | Purpose |
|---|---|
| `mpd_modelchain_resolve` | Resolve the provider/model route for a roster role, addressed by its NAME (`Senior Engineer`, `Architect`, `Plan Reviewer`, … — any case or separator spelling). The roster's own `chain[0]` answers; a role carrying no chain of its own falls back to the shipped/configured table. An internal key — the stable id, the legacy `mpd-<id>` form, a camelCase chain key — is REFUSED with a loud error listing the roster names, and an unknown or unnamed role is refused the same way instead of silently answering the generic default. |
| `mpd_memory_save` | Persist a key/value note in `<workspace>/.mpd/memory.json`. |
| `mpd_memory_recall` | Read notes by key/substring. |

## Service usage

Consumes the roster lazily (`ctx.get("mpdRoles")` at execute time — the service is
provided by `mpd-roles-plugin`, and a sibling-provided service is only reliably
visible after all plugins have applied). The roster is what makes a NAME resolvable:
with no roster mounted the tool refuses loudly instead of answering a generic route.

## Config

None; the row is stateless.

## Usage

```text
mpd_modelchain_resolve { role: "Senior Engineer" }   # -> { provider: "deepseek-official", model: "deepseek-v4-flash", ... }
mpd_memory_save { key: "goal", value: "..." }
mpd_memory_recall { key: "goal" }
```
