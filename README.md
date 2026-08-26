# my-power-dsh

A DeepSeek-Harness plugin bundle that ports the portable capabilities of oh-my-openagent (OmO).

> **Fork declaration**: This project is a fork derived from
> [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
> (commit `8c57e46`, v5.0.0-beta.20) with deep modifications; it inherits upstream
> **Sustainable Use License 1.0 (SUL-1.0)**. upstream copyright belongs to code-yeongyu and the OmO
> contributors. Full license text: [LICENSE.md](./LICENSE.md).

**Two hard rules**
1. Engineering matches the upstream upstream discipline: bun test / tsgo gates, isolated QA, evidence in
   `evidence/<domain>/<slug>/`, phase gates.
2. Every deliverable is a DSH plugin (self-written cordis plugin or official-plugin instance). No stray
   scripts, no raw config.

- Port plan: [PLAN.md](./PLAN.md)
- Baseline lock: [VENDOR_LOCK.json](./VENDOR_LOCK.json)
- Legal: [LICENSE.md](./LICENSE.md) / [LICENSE-NOTICES.md](./LICENSE-NOTICES.md)
- Gates & branching model: [AGENTS.md](./AGENTS.md)
- One-click install: `node scripts/install-profile.mjs --yes` (default dry-run; see --help)

Status: v0.1.0 baseline on Gitee (dev/master/tag v0.1.0); DeepSeek dual-track, 7 skills, 4 presets,
ast-grep/lsp/codegraph MCP, 9/9 golden tasks PASS.
