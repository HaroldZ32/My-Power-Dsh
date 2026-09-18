# mpd-dsh-adapter-plugin

**English** | [中文](./README.zh-CN.md)

The bundle's **single contact surface with DeepSeek Harness**. Every mpd plugin calls
through this adapter instead of the raw `ctx` services, so a harness release that
renames or reshapes a seam is absorbed in this one package — one file, one rebuild —
instead of across every plugin.

## Wrapped seams

| Seam | Adapter call | What it normalizes |
|---|---|---|
| `ctx.tools.register` | `registerTool(def)` / `registerTools(defs)` | default object-rooted `parameters`, default `output.render` (text block), always-object `(args, exec)` call shape, disposer pass-through |
| `ctx.tools.guard` | `guardTool(fn)` | always-object `exec`, disposer |
| `ctx.on("tools/pre-execute")` | `onPreToolExecute(listener)` | **OBSERVE-ONLY**: the adapter owns `next()`, returns the downstream gate decision VERBATIM (so a listener can neither alter nor veto a call) and discards the listener's own return value; the listener gets `(exec, decision)` with the `{kind:'allow'\|'ask'\|'deny'}` the harness will use; a throwing listener is contained; no event bus → no-op |
| `ctx.on("tools/post-execute")` | `onPostToolExecute(listener)` | the adapter owns `next()`; the listener receives `(exec, result, downstream)` and returns a decision or `undefined` to pass through; no event bus → no-op |
| `ctx.tools.get` / `ctx.tools.execute` | `hasTool(name)`, `toolRuntime()`, `executeTool({name, arguments, callId?, signal?})` | feature detection, default callId + timeout signal, `{ok, isError, value, error}` result |
| `ctx.subagents.start("spawn", …)` | `spawnAgent(spec)` | string prompt → content blocks, flat `provider`/`model` or `agentOptions`, `run.result` awaited whether it is a promise or an object, normalized `{output, structured, stopReason}` |
| `ctx.skills.registerProvider` / `list` / `get` | `registerSkillProvider`, `listSkills`, `loadSkill` | disposer pass-through, default options |
| `ctx.agentPresets.resolve` | `resolvePreset(id)` | normalized `{id, path, trust, broken}` |
| `ctx.llm.listProviders` / `listModels` / `resolveModelInfo` | `llmCatalog()` | the host's live model catalog projected as `{ providers: [{ id, name, models: [{ id, name, description?, efforts: [{ id, name, description? }], defaultEffort? }] }], degraded }` — the reasoning block FLATTENED onto the model, `efforts` always an array; read-only and never throwing |
| capability probing | `capabilities()` | one boolean per seam, so a caller can degrade instead of crashing |

## The model-catalog seam (`llmCatalog`)

`packages/mpd-tui-plugin` reads this seam AT REGISTRATION for the twelve `teamModels` slot
knobs, because the host renders `select` by cycling a deep-frozen option list (there is no
pick-list dialog). The read is TOTAL:

- a missing `ctx.llm`, or one lacking ANY of the three methods, resolves to
  `{ providers: [], degraded: true }` and logs **ONE** warn-once line naming the missing
  seam — never a throw, never a rejected promise;
- a provider whose `listModels` rejects, or a model whose `resolveModelInfo` rejects, is
  **skipped** (the catalog survives, `degraded: true`);
- a model whose resolved info carries no reasoning block still appears, with
  `efforts: []` and no `defaultEffort`;
- `capabilities().llmCatalog` reports the seam (true only when all three methods exist),
  which is the flag a caller branches on.

The seam is built from those three calls and nothing else — no new runtime dependency.

## Why it exists

Harness updates are normal; rewriting every call site for each of them is not. This
package is the only file in the repository allowed to touch a harness service directly.
The rule is binding (AGENTS.md §6): **a plugin row must not call `ctx.tools`,
`ctx.subagents`, `ctx.skills` or `ctx.agentPresets` itself.**

**Boundary:** the adopted `agent-teams` plugin (`packages/mpd-agent-teams-plugin`) is
upstream MIT main code re-vendored from upstream on upgrades, so it keeps its own
`ctx.*` calls (its one local adaptation is the `registerContinuableSetup` boot-safety
guard). Every self-written mpd plugin goes through this adapter — including the TUI edition:
`packages/mpd-tui-plugin` imports `createDshAdapter` from here and reads the mounted `mpdDsh`
service for the workspace-root union, exactly like every other self-written row.

The adapter is deliberately `inject`-free: every seam is resolved lazily at call time
and probed defensively, because the loader applies sibling rows concurrently (a
snapshot taken at `apply` would under-report) and because reading an uninjected
service as a property throws in Cordis. Missing seam → actionable error at the call,
or a `capabilities()` flag the caller can branch on.

## Usage

```js
import { createDshAdapter } from '@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js'

export function apply(ctx) {
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)
  dsh.registerTool({ name: "mpd_x", description: "…", execute: async (args, exec) => ({ ok: true }) })
  dsh.guardTool((exec) => (exec.name === "write" ? "denied" : undefined))
  // observe-only: the gate decision is returned unchanged, whatever this listener does
  dsh.onPreToolExecute((exec, decision) => { if (decision?.kind === "allow") started(exec.name, exec.callId) })
  dsh.onPostToolExecute((exec, result, downstream) => (exec.name === "bash" ? { ...downstream, content: trimmed } : undefined))
  const run = await dsh.spawnAgent({ label: "role-oracle-1", prompt: "…", provider: "deepseek-official", model: "deepseek-v4-pro" })
  const call = await dsh.executeTool({ name: "mpd_config_get", arguments: {} })
}
```

`ctx.get("mpdDsh")` returns the mounted instance (provided by the `mpd-dsh-adapter`
row, which the bundle patch inserts before every other mpd row); `createDshAdapter(ctx)`
builds an equivalent one, so a plugin works standalone in unit tests and partial
installs.

## Config

| Key | Type | Default |
|---|---|---|
| `defaultTimeoutMs` | number | `120000` (internal `executeTool` timeout when the caller passes none) |
| `quiet` | boolean | `false` (suppresses the one-line boot log) |
