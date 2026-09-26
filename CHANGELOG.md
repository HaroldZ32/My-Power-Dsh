# Changelog

Human-readable release notes. Format: one section per released version, newest first. This file is
English-only and is NOT part of the bilingual docs band (AGENTS.md Language policy polices `docs/**`,
`packages/*/README.md`, `extensions/**`, `templates/**` and the root `README`).

## v0.10.0 — full adaptation to DeepSeek Harness 0.1.7-rc.2

The harness replaced two things this bundle was built on, and this release follows both.

**Breaking changes (harness 0.1.7-rc.2).**

- **The preset model was replaced.** `@deepseek-ai/dsh-agent-presets` no longer exists: the deployment
  default now lives on `@deepseek-ai/dsh-agent-preset-registry`, and a preset is an ordinary plugin
  ROW (`@deepseek-ai/dsh-agent-preset`) whose `config.plugins` carries the child entry list inline.
  The `mpd` preset is therefore declared by `presets/mpd.patch.yml` (row `preset-mpd`), the bundle
  id-targets `agent-preset-registry` to `{ default: mpd }`, and the manifest's `dsh.bundle.patch`
  became an ARRAY of two patch files. The retired directory form
  (`presets/mpd/{preset.yml,agent.cordis.yml}`) is gone; `@deepseek-ai/dsh-workflow-worker-thread`
  went with it and the preset now declares `workflow-ptc`, matching the shipped `standard` preset.
- **Agent Teams became an official plugin set.** The bundle now mounts
  `@deepseek-ai/dsh-experimental-agent-team` (+ `-tool-agent-team`, `-client-ui-agent-team`) and the
  model-facing interface is `spawn_teammate` / `send_message` / `list_agents` / `wait_agent` /
  `interrupt_agent` / `team_task_*`. The vendored third-party body
  (`packages/mpd-agent-teams-plugin`, its `agent_teams_*` tools, its `.mpd/team` record and its Web
  activity panel) is RETIRED from the composition and kept in the tree for one release as a declared
  follow-up deletion.
- **Every agent-team interaction goes through `mpd-dsh-adapter`.** The adapter gained a team plane
  (`teamService` / `teamMembership` / `teamListMembers` / `teamListTasks` / `teamCreateTask` /
  `teamGetTask` / `teamUpdateTask` / `teamSendMessage` / `teamSpawnTeammate` / `teamInterrupt` /
  `teamWaitForChange` / `teamLiveTeams` / `registerSubagentProvider`), and a new gate
  (`packages/mpd-dsh-adapter-plugin/test/no-direct-team-access.test.mjs`) fails on a direct
  `ctx.agentTeams` / `subagents.startContinuable` reference anywhere outside the adapter.

**Capability bound, stated plainly.** `TeamService.spawnTeammate` forwards only `{ prompt, parent }` to
`ctx.subagents.startContinuable`, so a teammate created by `spawn_teammate` inherits the Lead's model
route: per-teammate model routing is impossible on the official plugin. The `teamModels.slot*` settings
keep applying to the one-shot consult paths (`mpd_role_spawn`, `mpd_workmate_spawn`), which pass an
explicit route. The roster's mechanical read-only discipline is preserved by a tool guard, and the
session-start complexity gate is re-implemented on the official seams by `mpd-roles-plugin`.

**Added.**

- A Docker end-to-end client test: `docker/Dockerfile` (ubuntu:24.04) + `docker/docker-compose.yml` +
  `docker/entrypoint.sh`, driven by `node scripts/docker-e2e.mjs`, which installs Node 24, bun and
  `@deepseek-ai/dsh@0.1.7-rc.2` into a clean Ubuntu 24.04 machine, runs the real
  `dsh plugin --profile web add .`, and asserts a mounting boot plus a `session/create` preset mount.
  See `docker/README.md` for what it proves and what it does not.
- `docs/plan-0.1.7-adaptation.md` — the adoption record: measured baseline, the harness changes, the
  decisions, the lanes, and the retired assertions.

**Fixed.**

- `mpd-bootstrap-plugin`'s legacy home-copy cleanup recognised only the retired directory spelling of
  a bundle preset, so a stamped `$DSH_HOME/.agent-presets/mpd` copy survived a boot that was supposed
  to remove it. Both spellings are now recognised.
- `buildToolchain` is recorded as the bun actually used (`bun@1.4.0`) and every committed `dist/` was
  rebuilt from the canonical repo-root command, so `verify-dist-fresh` is green again.

## Earlier releases

Untagged history for 0.1.x … 0.9.1 lives in the git log and in the process records under `docs/`.
