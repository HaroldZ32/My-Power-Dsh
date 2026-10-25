# mpd-modelchain-plugin

**English** | [中文](./README.zh-CN.md)

DeepSeek route resolution for the specialist roster + a tiny workspace-scoped
key/value memory.

## Tools

| Tool | Purpose |
|---|---|
| `mpd_modelchain_resolve` | Resolve the provider/model route for a roster role, addressed by its NAME (`Senior Engineer`, `Architect`, `Plan Reviewer`, … — any case or separator spelling). Precedence is the SLOT FIRST (`slotResolutionIn`): a member the `teamModels` slots route answers from its slot ALONE — the slot's primary plus its own `fallbacks`, `status: "configured"` — and a slot that is routed but UNUSABLE (a missing or malformed leaf) answers empty `provider`/`model` with `status: "unconfigured"` and a reason naming the offending `teamModels.slotN`, never a shipped route. Only an `unrouted` member (no slot carries it, e.g. an extension role) falls through to the live `modelchain.<id>` overlay, then the roster's own `chain[0]`, then the merged shipped/configured table. An internal key — the stable id, the legacy `mpd-<id>` form, a camelCase chain key — is REFUSED with a loud error listing the roster names, and an unknown or unnamed role is refused the same way instead of silently answering the generic default. |
| `mpd_memory_save` | Persist a key/value note in `<workspace>/.mpd/memory.json`. |
| `mpd_memory_recall` | Read notes by key/substring. |

## Service usage

Consumes the roster lazily (`ctx.get("mpdRoles")` at execute time — the service is
provided by `mpd-roles-plugin`, and a sibling-provided service is only reliably
visible after all plugins have applied). The roster is what makes a NAME resolvable:
with no roster mounted the tool refuses loudly instead of answering a generic route.

## Config

Two keys, both optional (`Config = { memoryFile?, chains? }`):

- `memoryFile` — the memory store's path, resolved against the calling session's workspace root;
  absent means the default the tool itself uses, `<workspace>/.mpd/memory.json` (`memoryPath`).
- `chains` — a per-role chain table (`Record<roleKey, Array<{provider, model}>>`) that overrides the
  shipped `DEFAULT_CHAINS` **key by key**: `resolveRole` still answers a key the table does not
  carry from the shipped table, then `sisyphus`. A live `modelchain.<key>` leaf read through
  `mpdConfig` outranks both, per call.

The row keeps no other state; the chain table is re-resolved on every call (`chainsNow`,
`overlayNow`), never frozen at `apply`.

## Usage

```text
mpd_modelchain_resolve { role: "Senior Engineer" }
#   slot configured -> { provider, model, chain: [primary, ...fallbacks], status: "configured" }
#   slot unusable   -> { provider: "", model: "", chain: [], status: "unconfigured", missing: [...], reason }
mpd_memory_save { key: "goal", value: "..." }
mpd_memory_recall { key: "goal" }
```
