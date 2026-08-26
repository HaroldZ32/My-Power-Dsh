# dsh plugin surface cheat sheet (dsh-qa reference)

Verified/documentation highlights from the installed @deepseek-ai/dsh 0.1.1-rc.2 package.

- bundle: an npm package whose package.json declares "dsh": { "bundle": { "patch": "./cordis.patch.yml" } };
  the profile's dsh.profile.bundles stack in order, and the profile's cordis.patch.yml plus $DSH_HOME's cordis.patch.yml are the upper-layer overrides.
- Mount proof: dsh --profile <name> --dump-config / --dump-default-config.
- tool plugin: ctx.tools.register(definition) (schema + output declaration + execute);
  waterfall: tools/pre-execute → guards → tools/execute → tools/post-execute → tools/result.
- Commands: ctx.commands.register({name, description, handler}).
- Skills: the ctx.skills registry + dsh-skill-filesystem (SKILL.md / flat md, root: .dsh/skills, .agents/skills, customSkillDirs);
  on the model side, dsh-tool-skill exposes catalog + loader.
- Persona/presets: dsh-persona (scope-only rows), agent preset (preset.yml + agent.cordis.yml);
  subagent supports per-child persona/model/structured output/tool filter/depth limit.
- LLM: dsh-llm-deepseek (deepseek-official routing, official wire), dsh-llm-pi-ai (multi-provider, deepseek directory routing).
- MCP: dsh-mcp-client (stdio/http, tool names mcp__<server>__<raw>).
- Target paths: the per-stage instance rows finalized at PLAN.md decision points D1–D9 for each track.
