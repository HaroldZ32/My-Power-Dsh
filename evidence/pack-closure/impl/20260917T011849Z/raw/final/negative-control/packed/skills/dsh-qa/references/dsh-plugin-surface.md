# dsh plugin surface cheat sheet (dsh-qa reference)

Verified/documentation highlights from the installed @deepseek-ai/dsh 0.1.5-rc.1 package.

- bundle: an npm package whose package.json declares "dsh": { "bundle": { "patch": "./cordis.patch.yml" } };
  the profile's dsh.profile.bundles stack in order, and the profile's cordis.patch.yml plus $DSH_HOME's cordis.patch.yml are the upper-layer overrides.
- Composition check: dsh --profile <name> --dump-config / --dump-default-config composes rows ONLY and
  never executes plugin code — it is NOT a mount proof (a schema/apply abort is invisible to it). A real
  mount proof is a boot that loads the rows in an isolated DSH_HOME with registration instrumentation.
- tool plugin: ctx.tools.register(definition) (schema + output declaration + execute);
  waterfall: tools/pre-execute → guards → tools/execute → tools/post-execute → tools/result.
- Commands: ctx.commands.register({name, description, handler}).
- Skills: the ctx.skills registry + dsh-skill-filesystem (SKILL.md / flat md, root: .dsh/skills, .agents/skills, customSkillDirs);
  on the model side, dsh-tool-skill exposes catalog + loader.
- Persona/presets: dsh-persona (scope-only rows), agent preset (preset.yml + agent.cordis.yml);
  subagent supports per-child persona/model/structured output/tool filter/depth limit.
  **Row-config contract (measured on 0.1.5-rc.1 CLI + rc.2 packages):** every row's `config` is
  validated against its plugin's schemastery `Config` when the row applies. `dsh-persona` takes
  `prefix` (REQUIRED) + `suffix` — the single `text` key of <= 0.1.2-rc.1 is gone, and a
  required-key failure makes `dsh-agent-presets.mountPreset` refuse the WHOLE preset
  (`agent-preset/invalid: … row(s) did not activate`), so every session on it fails to start.
  An UNKNOWN key is instead kept silently (schemastery does not strip it), so a renamed key loses
  its setting with no error. `agentPresets.list`/`resolve` and `--dump-config` never validate
  configs — only a mount does. `preset-conformance` checks both failure modes against the
  installed schemas and mounts a real session.
- LLM: dsh-llm-deepseek (deepseek-official routing, official wire), dsh-llm-pi-ai (multi-provider, deepseek directory routing).
- MCP: dsh-mcp-client (stdio/http, tool names mcp__<server>__<raw>).
- Target paths: the per-stage instance rows finalized at PLAN.md decision points D1–D9 for each track.
