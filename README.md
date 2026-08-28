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
(team + Web panel), the `mpd` main-agent preset and the OMO-origin specialists as
SUBAGENTS:

- **Every project session on the `mpd` preset attempts to read `AGENT.md`**
  (falling back to `AGENTS.md`, then `CLAUDE.md`) via `dsh-agent-instructions`.
- **The 11 OMO-origin agents are specialists and teammate templates, not presets**:
  Architect, Researcher, Planner, Deep Worker, Senior Engineer, Lead,
  Explorer, Reviewer, Plan Reviewer, Vision Analyst and Junior Engineer live in the
  mpd-roles roster — one-shot consult one with `mpd_role_spawn`, list the roster
  with `mpd_roles_list`, fetch a persona text with `mpd_role_persona`. Read-only
  roles are mechanically denied write tools at spawn.
- **Team mode is the adopted dsh-agent-teams plugin** (first-class main code at
  `packages/mpd-agent-teams-plugin`, `agent_teams_*`
  tools + Web activity panel): a normal-named `mpd` roster profile
  (`taskPlanning: captain`) exposes the specialists above as teammate
  instantiation templates. The captain calls `agent_teams_create(profile="mpd")`,
  stages the plan in the panel, then the dependency-aware scheduler runs it.
- **Workmate library** (`~/.mpd/workmate`): the roster specialists are BASE templates;
  instantiate one into a durable, evolving copy with an independent name
  (`mpd_workmate_init`). After each work session it self-summarizes
  (`mpd_workmate_reflect`) — evolving its own persona + independent memory (size-capped)
  and keeping a short note card. Reuse via `mpd_workmate_list` / `mpd_workmate_match`;
  if no note matches well enough (`matched=false`), initialize a NEW workmate rather than
  forcing a weak match. In a team, a member named after the workmate gets its
  persona/memory injected automatically (patched `memberPersona` in
  `packages/mpd-agent-teams-plugin`).
- `mpd-bootstrap` auto-copies the `mpd` preset + skill corpus at first boot
  (version-stamped: bump the package version and re-pack to refresh
  already-installed copies).

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
Plan C waves complete (team adoption, ultrawork engine, hashline, boulder, mpd.jsonc, memory git+svn, vision e2e);
Plan F COMPLETE — OMO agents as subagent roster (mpd-roles-plugin), single `mpd` main preset carrying the
AGENT.md convention, mpd.jsonc wired into all runtime plugins (evidence/plan-f/roles-subagent PASS).
