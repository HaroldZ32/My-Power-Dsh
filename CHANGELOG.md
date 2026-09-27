# Changelog

Human-readable release notes. Format: one section per released version, newest first. This file is
English-only and is NOT part of the bilingual docs band (AGENTS.md Language policy polices `docs/**`,
`packages/*/README.md`, `extensions/**`, `templates/**` and the root `README`).

## v0.11.0 — the team workflow, per-member routing, and a settings surface that reads

The official Agent Teams plugin owns the team RUNTIME and nothing else. This release adds the WORKFLOW
around it, the routing it cannot express, and the GUI/settings work that a Docker view of both shipped
surfaces drove.

**Added — the team workflow (`mpd-team-tools-plugin`).**

- **Staged plan + approval.** `agent_teams_create` / `_add_member` / `_create_task` / `_edit_plan`
  stage a plan; `agent_teams_approve` EXECUTES it — spawns every member through `spawn_teammate`, posts
  every task to the official board, resolves `blocked_by` from planned subjects to posted ids and
  `owner` from staged names to spawned ids, and names where it stopped if it did. `dry_run` reports
  without creating. Nothing is spawned before approval.
- **Task contracts.** `agent_teams_claim_task` claims on the board AND freezes the task's meaning with
  a monotonic `attempt` counter; `agent_teams_task_contract` reads it back. The counter is why the
  sidecar exists: the board's `revision` moves for every mutation, so it cannot stand in for an attempt.
- **Halt / resume.** A hold that stops new dispatch and leaves the team and its members alive —
  deliberately not an ending. `agent_teams_delete` is the ending, and it ARCHIVES.
- **Dispatch.** `agent_teams_dispatch` pairs each READY task with an IDLE member, sends the task, and
  RECORDS the pairing, so a second pass cannot hand the same task to a second teammate (a message is
  not a ledger). Ledger entries for tasks deleted or completed out of band are pruned first, so a
  member is never left busy forever. `agent_teams_dispatch_release` frees one pairing.
- `agent_teams_status` prints the sidecar beside the official roster and board, and `/agent-teams
  <what the team is for>` stages a plan from the current goal.

**Added — per-member model routing (`mpd-roster-provider-plugin`).**

`spawn_teammate` used to inherit the Lead's route: the official TeamService forwards only
`{ prompt, parent }`. The harness itself is not the limitation — `SubagentContinuationManager`
resolves `request.agentOptions` and hands them to the PROVIDER, which constructs the run, and the
provider NAME is row config (`config.freshProvider`). This bundle therefore registers `mpd-roster`, a
provider that delegates to the composition's own and applies the member's `teamModels` slot route, and
points its `mpd-tool-agent-team` row at it. The teammate stays a real, continuable official teammate:
no fork, no contract change. A teammate `description` that NAMES a roster member routes that member;
one that does not inherits the Lead's route — the descriptor label is the only identity channel the
team service forwards. An incomplete slot fails the spawn loudly, naming the member and the slot.

**Added — the team GUI in the harness's own right sidebar (`mpd-bundle-plugin`).**

A Team tab registered through `ctx.sidebarRightTabs`, rendering the Lead session's `agentTeam`
projection: completion, `N of M running · ready · blocked`, members with role and phase, and tasks with
owner and blockers. It lands in the sidebar the harness already ships, so it appears wherever the
harness does.

**Fixed — the settings surface, on BOTH front doors.**

- The MPD section now RENDERS and READS. Harness 0.1.7-rc.2 replaced the namespace registry with the
  Cordis patch editor, so the knobs are declared as the `mpd-config` row's own `Config` with volatile
  flags, and both front doors address the ENTRY (`mpd-config`) rather than a namespace name. Measured:
  20000 / true / 6 / git / .mpd/team in the Web dialog and in the TUI.
- An edit actually REACHES the plugins: the row config is merged as the layer above the files, with
  the routing keys stripped.
- The repeated per-row disclosure is stated ONCE per surface, so eight rows fit where five did.
- The sidebar host mounts on a checkout install. `dsh-better-sidebar` was not resolvable from a
  `link:` profile, so the bundle contributed no sidebar GUI at all; the bundle now reaches its own copy
  through `mpd-better-sidebar-host`.
- The watchdog's three `agent/*` subscriptions and the bootstrap's `fs/observed` go through the
  adapter, and the D6 gate covers event NAMES.

**Fixed — the TUI edition.** A `dsh-tui` profile is now part of the Docker client test, which boots
the real TUI on a tmux PTY and reads the created session's preset from the harness's own store.

## v0.10.2 — TUI preset default, adapter event seams, TUI end-to-end lane

**Fixed.**

- **A `dsh-tui` profile defaulted every session to a preset its composition does not declare.** The
  harness moved preset selection to a registry row and this bundle targeted the web plane's
  `agent-preset-registry` — but `dsh-tui` mints its OWN scoped row (`dsh-tui-agent-preset-registry`,
  stock `default: standard`), and a TUI profile composes no `dsh-web-app` layer, so the web target is
  skipped there while nothing declares `standard`. A second id-target on the scoped TUI row restores
  user decision D10. The QA pin moves to `@deepseek-harness-tui/dsh-tui@0.11.1`, the first release
  whose peer ranges include `0.1.7-rc.2`.
- **Two harness-event subscriptions bypassed the adapter** — `mpd-team-watchdog-plugin`'s
  `agent/pre-step` / `agent/session-start` / `agent/turn-stopping` and `mpd-bootstrap-plugin`'s
  `fs/observed`, all on a raw ctx while neighbouring subscriptions already used `dsh.onEvent`. Both
  are rebased, and the D6 gate gained an event-name rule family so the class cannot return.
- A patch COMMENT that named `disabled: !!js` could displace the real scalar in
  `sidebar-guard-profile-dir.test.mjs` and kill the run in `JSON.parse`; the finder now accepts only
  a candidate that really parses.

**Added.**

- The DSH-TUI edition is now exercised END TO END in the Docker client test
  (`docker/tui-lane.sh`): it installs the TUI host, installs this bundle into the `dsh-tui` profile as
  the third patch layer, boots the REAL TUI on a real tmux PTY, and reads the preset the created
  session ACTUALLY ran from the harness's own session store — `agentPreset: "mpd"`. 11 assertions,
  reported as `passed=42 failed=0 null=1` by the driver.

## v0.10.1 — session-start gate delivery, producer-owned message source

**Fixed.**

- **The session-start complexity gate was MOUNTED but NEVER FIRED.** Three root causes, each measured
  on a real boot: (a) `agent/pre-step` is dispatched through the AGENT's scope carrier and `dsh-scope`
  drops a listener registered on a row's ctx, so the handler was never invoked; (b) the harness splices
  its own user-role runtime-context turn onto the pre-step decision, so the gate judged that snapshot
  instead of the goal; (c) the injected notice used the retired `{kind:"plugin"}` message source, which
  harness 0.1.7's format-v4 gate REFUSES — the injection killed the boot. The gate now registers one
  listener per qualifying agent in that agent's own scope through a new adapter seam
  (`registerAgentPreStep`), reads the goal from the payload's raw claimed list, and names its own
  message producer. The frozen properties are unchanged: advisory only, the marker
  `[AgentTeams] Session-start team rule`, the predicate A/B/C/D, mpd-preset scope, settle once,
  contained failure.
- **`/ulw` used the same fatal message source.** A lane-wide grep prompted by the first fix found
  `mpd-ulw-plugin` emitting `{kind:"plugin"}` for its activation directive; it now uses a
  producer-owned kind, and the adapter's doc comment no longer teaches the retired spelling.

**Tests.**

- `skills/dsh-qa/scripts/session-start-team.mjs` now splits its live verdict into named
  sub-assertions and asserts the boot's own session-store key plus the row's `sessionGate=advisory`
  report, so "the gate was never mounted" and "the gate is mounted and did not fire" are different
  readings with different owners. Its earlier green was partly vacuous on 3 of 6 sides; that is fixed,
  and it now passes with `simpleNotices [0,0,0]`, `softNotices [1,1]`, `explicitNotices [1]`, every
  triggered side staging nothing.
- A regression test drives the gate through the REAL adapter with the REAL payload shape — no `agent`
  field — which is the test whose absence let this ship.

## v0.10.0 — DeepSeek Harness 0.1.7-rc.2 adaptation, official Agent Teams, Docker client test

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

**Capability bound.** `TeamService.spawnTeammate` forwards only `{ prompt, parent }` to
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
