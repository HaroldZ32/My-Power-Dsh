# mpd-modelchain-plugin

**English** | [中文](./README.zh-CN.md)

DeepSeek route resolution for the specialist roster + a tiny workspace-scoped
key/value memory.

## Tools

| Tool | Purpose |
|---|---|
| `mpd_modelchain_resolve` | Resolve the provider/model route for a roster role, addressed by its NAME (`Senior Engineer`, `Architect`, `Plan Reviewer`, … — any case or separator spelling). **The agent's OWN `agentRoutes` entry is the first and only route source for a roster member**: a configured entry answers with its `provider` + `model`, its own `fallbacks` in order and `status: "configured"`; an entry that is routed but UNUSABLE (a missing or malformed leaf) answers empty `provider`/`model`, `chain: []`, `status: "unconfigured"`, the missing leaves, and a reason naming the offending `agentRoutes.<Agent>` path — never a shipped route. Only an `unrouted` member (an EXTENSION role, which `agentRoutes` does not decide) falls through to the live `modelchain.<id>` overlay, then its own declared chain, then the merged table. **There is no slot**: `TEAM_MODEL_SLOT_GROUPS` is only the `/mpd-model` grouping that edits each member's own entry. An internal key — the stable id, the legacy `mpd-<id>` form, a camelCase chain key — is REFUSED with a loud error listing the roster names, and an unknown or unnamed role is refused the same way instead of silently answering the generic default. |
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
#   configured      -> { provider, model, chain: [primary, ...fallbacks], status: "configured" }
#   unusable        -> { provider: "", model: "", chain: [], status: "unconfigured", missing: [...], reason }
mpd_memory_save { key: "goal", value: "..." }
mpd_memory_recall { key: "goal" }
```
