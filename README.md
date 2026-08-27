# my-power-dsh

A DeepSeek-Harness plugin bundle that ports the portable capabilities of oh-my-openagent (OmO).

> **Fork declaration**: This project is a fork derived from
> [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
> (commit `8c57e46`, v5.0.0-beta.20) with deep modifications; it inherits upstream
> **Sustainable Use License 1.0 (SUL-1.0)**. upstream copyright belongs to code-yeongyu and the OmO
> contributors. Full license text: [LICENSE.md](./LICENSE.md).

**Install (one command, relocatable)**

```sh
node scripts/pack-mpd.mjs                          # -> dist/mpd-package/ (no checkout-absolute paths)
dsh plugin --profile web add dist/mpd-package      # install the staged bundle
```

> Note: `dsh plugin add` must point at the STAGED package (the root directory has no
> `dsh.bundle.patch` entry). `dsh plugin add <path-or-git-url>` works the same way when the
> target location contains the staged package.

This installs the `@mpd-dsh/mpd` bundle: DeepSeek dual-track (official default),
MCP servers, all mpd plugins (including codegraph auto-init), adopted agent-teams
(team + Web panel), and auto-copies the 11 `mpd-*` presets at first boot via
`mpd-bootstrap` (version-stamped: bump the package version and re-pack to refresh
already-installed presets).

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

Status: Plan D decoupling COMPLETE — relocatable one-plugin install (evidence/plan-d/relocate PASS);
Plan C waves complete (team adoption, ultrawork engine, hashline, boulder, mpd.jsonc, memory git+svn, vision e2e).
