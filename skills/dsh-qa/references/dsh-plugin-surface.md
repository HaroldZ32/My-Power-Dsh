# dsh 插件面速查（dsh-qa 参考）

来自 @deepseek-ai/dsh 0.1.1-rc.2 已安装包的实测/文档要点。

- bundle：npm 包，package.json 声明 "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }；
  profile 的 dsh.profile.bundles 按序叠加，profile 与 $DSH_HOME 的 cordis.patch.yml 为上层覆盖。
- 挂载证明：dsh --profile <name> --dump-config / --dump-default-config。
- tool 插件：ctx.tools.register(definition)（schema + output 声明 + execute）；
  瀑布 tools/pre-execute → guards → tools/execute → tools/post-execute → tools/result。
- 命令：ctx.commands.register({name, description, handler})。
- 技能：ctx.skills 注册表 + dsh-skill-filesystem（SKILL.md / 平铺 md，root: .dsh/skills、.agents/skills、customSkillDirs）；
  模型侧由 dsh-tool-skill 暴露 catalog + loader。
- 人格/预设：dsh-persona（scope-only 行）、agent preset（preset.yml + agent.cordis.yml）；
  subagent 支持 per-child persona/model/structured output/tool filter/depth limit。
- LLM：dsh-llm-deepseek（deepseek-official 路由，官方 wire）、dsh-llm-pi-ai（多供应商，deepseek 目录路由）。
- MCP：dsh-mcp-client（stdio/http，工具名 mcp__<server>__<raw>）。
- 目标路径：track 每阶段在 PLAN.md 决策点 D1–D9 落定的实例行。
