# my-power-dsh

**English** | [中文](./README.zh-CN.md)

A DeepSeek-Harness plugin bundle that ports the portable capabilities of oh-my-openagent (OmO).

> **Fork declaration**: This project is a fork derived from
> [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
> (commit `8c57e46`, v5.0.0-beta.20) with deep modifications; it inherits upstream
> **Sustainable Use License 1.0 (SUL-1.0)**. upstream copyright belongs to code-yeongyu and the OmO
> contributors. Full license text: [LICENSE.md](./LICENSE.md).

**Install (ONE command, straight from the checkout)**

```sh
dsh plugin --profile web add .        # run it in the repo root
```

> The repo root IS the bundle package (`@mpd-dsh/mpd`): its manifest declares
> `dsh.bundle.patch`, `dsh.client` and the `exports` map the rows resolve through, so this
> single command installs every plugin row, the `mpd` preset and the whole skill corpus —
> no pack step, no copy step. `dsh plugin remove @mpd-dsh/mpd` reverses it just as cleanly.
>
> `node scripts/pack-mpd.mjs` (`npm run pack`) is now only the RELEASE step: it assembles
> the relocatable `dist/mpd-package/` for publishing or tarball installs
> (`dsh plugin --profile web add dist/mpd-package`). A local checkout install never needs it.

## Documentation

Full documentation lives in [`docs/`](docs/index.md) — start at
[`docs/index.md`](docs/index.md):

- [`docs/user-guide.md`](docs/user-guide.md) — install, presets, specialists,
  workmate library, team mode, GUI panels, configuration.
- [`docs/architecture.md`](docs/architecture.md) — bundle assembly, boot chain,
  plugin inventory, interaction flows, state layout, web-client wiring.
- [`docs/development.md`](docs/development.md) — build/test/QA/pack/release.
- [`AGENTS.md`](AGENTS.md) — the binding repository manual (conventions, gates, git
  model, troubleshooting).

This installs the `@mpd-dsh/mpd` bundle: DeepSeek dual-track (official default),
MCP servers, all mpd plugins (including codegraph auto-init), adopted agent-teams
(team tools + the sidebar team page), the `mpd` main-agent preset and the OMO-origin
specialists as SUBAGENTS:

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
  tools + the AgentTeams sidebar tab): a normal-named `mpd` roster profile
  (`taskPlanning: captain`) exposes the specialists above as teammate
  instantiation templates. The captain calls `agent_teams_create(profile="mpd")`,
  stages the plan in the AgentTeams tab, then the dependency-aware scheduler runs it.
- **Web GUI** (`@mpd-dsh/mpd` client bundle, `packages/mpd-bundle-plugin`) — the whole
  AgentTeams GUI is **one DSH-better-sidebar tab** (`dsh-better-sidebar`, the community
  sidebar bundle; tab id `mpd-agent-teams`, order 85). It lists the conversation's live and
  archived teams (members and live activity, task rows, the dependency map, the stop-team
  control, and the staged-plan approval editor), badges the conversation's live-team count,
  and auto-opens once when a team appears — plugin setting `autoOpenOnTeamActivity`, default
  ON, switchable in the sidebar settings page. **Visual parity with the original panel is a
  requirement**: the tab renders the removed floater's own interior — the `panelHead` with
  its title, busy dot and collapse control (the platform's own chevron), the `teams` body,
  the adopted empty hint and archive labels, all through the adopted CSS-module classes, so
  the `--dsw-alias-*` variables the team/member/task rules read resolve exactly as they did
  in the floater; only the window manager (drag, resize, floating frame) is gone. The
  in-conversation team card and the top-right activity floater were **removed**. The
  **Workmates** page is a second tab in the same sidebar, contributed via
  `ctx.betterSidebar.registerTab` — it lists `~/.mpd/workmate/` instances
  (base, uses, updated, note), opens one for its persona/memory/note, initializes new
  ones with a roster-backed base picker, and renames or deletes an instance (zh/en, with an
  explicit archive-vs-purge confirmation), reading
  `GET /plugins/mpd-workmate/{list,roster,get}` + `POST /plugins/mpd-workmate/{init,rename,delete}`. Both
  pages are **sidebar-only**: without that sidebar each logs one warning and registers
  nothing (the workmate 🤖 floater and its sidebar-foot button were removed too), and
  `scripts/build-mpd-client.mjs` fails the build if any client source registers one of the
  removed surfaces. The bundle patch ships the `mpd-web-compat` self-row
  (`name: '@mpd-dsh/mpd'`) so the client-modules boot graph carries the bundle's
  client entry — without it no client surface loads.
- **Workmate library** (`~/.mpd/workmate`): the roster specialists are BASE templates;
  instantiate one into a durable, evolving copy with an independent name
  (`mpd_workmate_init`). After each work session it self-summarizes
  (`mpd_workmate_reflect`) — evolving its own persona + independent memory (size-capped)
  and keeping a short note card. Reuse via `mpd_workmate_list` / `mpd_workmate_match`;
  if no note matches well enough (`matched=false`), initialize a NEW workmate rather than
  forcing a weak match. **Rename** an instance with `mpd_workmate_rename` (it moves the
  evolved identity — directory key, metadata, index key, note self-reference, previous
  names — never re-instantiates it), and **delete** it with `mpd_workmate_delete`, which is
  **archive-first**: the instance moves to `~/.mpd/workmate/.archive/` (out of
  `list`/`match`, restorable by a manual `mv` back) and only `purge: true` +
  `confirm: <name>` removes it for real. Both mutations are **refused while the workmate is
  in use** by a team member or an in-flight spawn, and they name the blocking teams so the
  block is actionable. Names are ASCII-only (`[a-z0-9_-]`); CJK/upper-case names are
  refused up front. In a team, a member named after the workmate gets its
  persona/memory injected automatically (patched `memberPersona` in
  `packages/mpd-agent-teams-plugin`). Details:
  [`packages/mpd-workmate-plugin/README.md`](packages/mpd-workmate-plugin/README.md).
- **One harness adapter.** Every mpd row calls `packages/mpd-dsh-adapter-plugin`
  (`mpdDsh` service) for tool registration/guards/post-execute, internal tool calls,
  subagent spawn, skill delivery and preset resolution — so a DeepSeek Harness release
  that reshapes a seam is fixed in one file, not across every plugin (AGENTS.md §6).
- **Whole-unit install, whole-unit uninstall.** One `dsh plugin add dist/mpd-package`
  installs every row AND the assets: the `mpd` preset is served from
  `<bundle>/presets` (the patch roots the preset roster there) and the skill corpus
  from `<bundle>/skills` (the `mpd-bootstrap` row registers a `ctx.skills` provider).
  Nothing is copied into `$DSH_HOME`, so `dsh plugin remove @mpd-dsh/mpd` takes the
  rows, the preset and the skills away with it and leaves no residue. Only the
  workmate library (`~/.mpd/workmate`, your own evolving agents) stays.

**Two hard rules**
1. Engineering matches the upstream discipline: bun test / tsgo gates, isolated QA, evidence in
   `evidence/<domain>/<slug>/`, phase gates.
2. Every deliverable is a DSH plugin (self-written cordis plugin or official-plugin instance). No stray
   scripts, no raw config.

- Port plan: [PLAN.md](./PLAN.md)
- Baseline lock: [VENDOR_LOCK.json](./VENDOR_LOCK.json)
- Legal: [LICENSE.md](./LICENSE.md) / [LICENSE-NOTICES.md](./LICENSE-NOTICES.md)
- Gates & branching model: [AGENTS.md](./AGENTS.md)
- One-click install (primary): `node scripts/pack-mpd.mjs && dsh plugin --profile web add dist/mpd-package`;
  legacy dev flow: `node scripts/install-profile.mjs --yes` (default dry-run; see --help)

Status: Plan D decoupling COMPLETE — relocatable one-plugin install (evidence/plan-d/relocate PASS);
Plan C waves complete (team adoption, ultrawork engine, hashline, boulder, mpd.jsonc, memory git+svn, vision e2e);
Plan F COMPLETE — OMO agents as subagent roster (mpd-roles-plugin), single `mpd` main preset carrying the
AGENT.md convention, mpd.jsonc wired into all runtime plugins (evidence/plan-f/roles-subagent PASS).
