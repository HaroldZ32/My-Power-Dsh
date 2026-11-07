# ROUTING PROOF — does `agentOptions` still select the model on harness 0.2.2-rc.1?

Status: **YES — proven end-to-end from the harness's own session logs.**

## The chain that was exercised

`mpd_role_spawn` (roster consult) → `mpd-roles-plugin` spawn spec carrying
`agentOptions: { reasoningEffort }` → `mpd-dsh-adapter-plugin::spawnAgentAsync` merges the resolved
route into `agentOptions` → `subagents.startActivation(spec)` → harness
`resolveChildAgentOptions(parent, request.agentOptions, childDepth)` → `agents.create({ agentOptions })`.

## Static half (installed 0.2.2 package source)

`.qa-tmp/dsh-022/.../@deepseek-ai/dsh-subagent/lib/index.js`:

```js
const agentOptions = resolveChildAgentOptions(parent, request.agentOptions, childDepth);
const agentProvider = agentOptions.provider;
const agentModel = agentOptions.model;
const agentReasoningEffort = agentOptions.reasoningEffort;
```

`resolveChildAgentOptions` starts from the parent's options and then spreads `...requested`, so a
request's `agentOptions.provider` / `.model` WIN over the parent's. The resolved options are handed to
`ownerCtx.agents.create({ …, agentOptions })` — the harness never rewrote routing to `agent.model` in a
way that drops `agentOptions`.

## Empirical half — a real run, read from the session store

Command (harness 0.2.2-rc.1 first on PATH):

```
PATH="$PWD/.qa-tmp/dsh-022/bin:$PATH" bun skills/dsh-qa/scripts/model-config-live-refresh.ts
```

The case's **baseline phase** really ran: the parent session records a `tool/call mpd_role_spawn`
with a NON-error result, and the spawned child session carries the route.

Sandbox route configuration (`sandbox-agentRoutes.mpd.jsonc`, written by the case before boot):

```json
{ "agentRoutes": { "Junior Engineer": { "provider": "deepseek-official", "model": "deepseek-v4-flash" } } }
```

Decoded from `.qa-model-config-live-refresh-7uC1Ro/home/sessions/**/session.v4.jsonl.zstd`
(`decoded-session-evidence.log`, produced by `probe-routing.ts` against the same store):

| session | record | observed |
|---|---|---|
| child `f583d223…` | `subagent/descriptor` | `agentProvider=deepseek-official`, `agentModel=deepseek-v4-flash` |
| child `f583d223…` | `request/header` | `model=deepseek-v4-flash`, `provider=deepseek-official`, `effort=high` |
| parent `session-7a131386…` (baseline) | `request/header` | `model=deepseek-flash` (the stub's parent route — deliberately DIFFERENT) |

The child's own `request/header.config.model` is the configured `agentRoutes` model, and it differs from
the parent's model, so the child was not inheriting the parent route: `agentOptions` selected it.

## Bound (honest)

- The live arm proves the **consult** site (`mpd-roles-plugin` → adapter `spawnAgentAsync` →
  `startActivation`). The other three `agentOptions` sites (`mpd-roster-provider-plugin::applyRoute`,
  `TeamExecutor.spawn`, `resolveRunRoute`) write the SAME request field into the SAME harness seam, and
  the seam is proven to consume it; those three were NOT separately exercised live in this wave.
- The case itself CRASHED later, in its **after-save** phase: the second parent session never produced a
  `mpd_role_spawn` tool call within 180 s (the stub-driven model step returned no tool call), so the live
  **refresh** claim (save → new route) is NOT verified on 0.2.2 in this run. That is a property of the
  case's stub choreography, not of routing: the baseline phase — the question this task asked — is
  proven. `model-config-boot.log` is the boot log of that run.
- A stub provider served the turns, so no credential was spent; the model identity is the harness's own
  recorded request header, never the model's prose.
