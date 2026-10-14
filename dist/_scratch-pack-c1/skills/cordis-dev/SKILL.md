---
name: cordis-dev
description: "Use when developing, changing, mounting or debugging anything Cordis/plugin-shaped in the my-power-dsh bundle or its DeepSeek Harness host: a new plugin package, a cordis.patch.yml row, an agent preset, an MCP bundle, a Web UI panel or decoration, a skill or extension, a tool registration, a harness seam change, or a plugin that must invoke the persisted GOAL. Carries the Loader patch dialect, host-vs-preset placement, the bundle's BINDING rules (adapter seam, mounting contract, gates, dist discipline), and the verification standard for a plugin change. Triggers: cordis, cordis plugin, dsh plugin, plugin package, bundle patch, cordis.patch.yml, patch row, agent preset, preset row, MCP bundle, mcp-client, client plugin, UI slot, decoration, sidebar panel, tool registration, registerTool, adapter seam, mpd-dsh-adapter, tui adapter, extension, mpd-ext, skill authoring, mpd_goal, goal round."
---

# Cordis plugin development (my-power-dsh)

Two planes exist and they have different rules. **This repository** (`my-power-dsh`) ships its own
plugin packages, mounted by its own patch through the profile mechanism. **A generic harness
bundle** is a workspace package installed by `plugin_manager`. Decide which one you are writing
before you write anything; the flow below picks the references you need.

## 0. Pick the shape (and the reference that owns it)

| You are building | Read |
|---|---|
| A plugin / row / tool **inside this repository** (`packages/mpd-*`) | `references/this-bundle.md` — the binding rules; then `references/host-plugin.md` for the generic form |
| A standalone **workspace bundle** for a live Harness profile | `references/host-plugin.md` |
| A **Web UI** panel, dock item, decoration or Chat row | `references/ui-plugin.md` |
| An **MCP server** connection (config-only bundle / this repo's MCP packages) | `references/mcp-bundle.md` |
| An **agent preset** or any other Cordis composition (patch layers, groups, realms) | `references/compositions.md` |
| Making information discoverable — tool definitions, skills, prompt sections, context | `references/practices.md` |
| Deciding what PROVES the change works | `references/verification.md` |

## 1. Discover the real API before writing code

The installed Harness is the authority, not memory and not this skill:

1. `cordis_inspect_list` then targeted `cordis_inspect_query` — `Service` (exact method signatures),
   `Event` (dispatch modes), `Tool` (what this agent can call), `Config.listConfigs` (a mounted row's
   JSON Schema, and its `packageDir`).
2. The package's own `README.md` and built `lib/` under that `packageDir`; in a source checkout the
   `src/`. For this bundle: `packages/<pkg>/README.md` next to the code.
3. For this bundle, the single seam file `packages/mpd-dsh-adapter-plugin/src/index.ts` — its
   interface IS the list of harness capabilities the bundle is allowed to touch.

## 2. Author

- **In this repository**: one directory per package under `packages/`, `src/index.ts` exporting
  `name` / `inject` / `apply`, a committed `dist/index.js`, a bilingual `README.md` +
  `README.zh-CN.md` pair, and a row in `cordis.patch.yml`. Copy the closest existing package rather
  than a template; `templates/` at the repo root holds the plugin/extension scaffolds.
- **A workspace bundle** for someone else's profile: the manifest and patch from
  `references/host-plugin.md`, and the harness's own starting points under
  `<dsh>/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/templates/`
  (`decoration/` for a UI plugin, `mcp/` for an MCP connection) — copy them into the workspace, never
  build in place.
- Never write a profile's `package.json` or `cordis.patch.yml` by hand, never create packages under
  `$DSH_HOME`, and never run a package manager inside a profile directory: in this repository the
  mount travels through `cordis.patch.yml` + the profile mechanism; elsewhere it is
  `plugin_manager install_bundle`.

## 3. Mount

Rows reach a harness in exactly two ways, and no third one exists:

- **this bundle**: `package.json` → `dsh.bundle.patch` names the patch files; the patch inserts rows
  by `id` + `name`; the profile resolves them. `dsh plugin --profile <p> add .` is the whole install
  from a checkout.
- **any other bundle**: install it with `plugin_manager` `action: install_bundle`; read the result's
  `application` and `warnings` — those, not logs or process lists, decide whether the change is live.

A row may **add** a capability; it may never id-target an id a host layer declares
(`node scripts/verify-no-host-override.ts` is the gate that says so).

## 4. Verify — a registered tool is not a working capability

Scale the proof to the change, and state any limit explicitly:

- Tool/schema change ⇒ a boot that really MOUNTS the rows (isolated `DSH_HOME` + sandbox `HOME` +
  sandbox workspace), not `--dump-config`, which composes rows without executing plugin code.
- Behaviour change ⇒ a real call, or the HARNESS's own session log (`tool/call` + a non-error
  `tool/result`), never the model's prose.
- In this repository the gate table in `references/this-bundle.md` (§Gates) is mandatory, with
  evidence on disk under `evidence/<domain>/<slug>/<timestamp>/`.
- A UI plugin without browser control: syntax, manifest and live slot registration are the honest
  limit; do not build a rasterizer, mock page or iframe to manufacture a screenshot.

## 5. Persistent goals (continuous execution)

A long-running objective is anchored on the harness's persisted GOAL, not on one turn. This bundle
wires that: `mpd_goal_status` / `mpd_goal_anchor` / `mpd_goal_finish` (row `mpd-goal`), the
`mpdGoal` service the ULW and boulder rows consume, and the auto-anchor contract (`goal.autoAnchor`).
Mutations go through the HARNESS GOAL TOOLS, never `ctx.goals`, because the tools carry the
authorisation (a direct human turn for create/edit/pause/resume; the consecutive-round count for
`blocked`). Details: `references/this-bundle.md` §Goal plane.

## Read next

| Task | File |
|---|---|
| This repository's binding rules: package layout, adapter seam, mounting, state roots, gates, goal plane | `references/this-bundle.md` |
| Manifest, export forms, `Config`, registrations/effects, install and observe | `references/host-plugin.md` |
| Client manifest, slot registration, theme tokens, disposal | `references/ui-plugin.md` |
| MCP connection through configuration only | `references/mcp-bundle.md` |
| Patch dialect, `insert`/override, groups, `isolate`, `!!js`, preset declaration, host vs preset | `references/compositions.md` |
| Extension points, contexts, projections, performance, tool-definition authoring | `references/practices.md` |
| What counts as proof, and how to bound a claim | `references/verification.md` |
