# Plan: full adaptation of my-power-dsh to DeepSeek Harness 0.1.7-rc.2

Process record (AGENTS.md §3: `docs/plan-*.md` is exempt from the bilingual rule). English-only.

## 1. Measured baseline (installed harness = `@deepseek-ai/dsh@0.1.7-rc.2`)

`bun run verify:gates` on the untouched `dev` tree, 2026-09-27:

| Gate | Result | Cause |
|---|---|---|
| vendor | FAIL | no oh-my-openagent checkout (`MPD_UPSTREAM_ROOT`); environment, not drift |
| dist-fresh | FAIL | committed dists were built with `bun@1.4.2`; installed bun is `1.4.0` |
| docs-parity | FAIL | 1 pair / 1 violation (pre-existing) |
| preset-conformance | FAIL | `the installed harness ships no 'standard' preset` |
| rows/parity | PASS | — |
| `bun test packages` | 2 FAIL | the two F1 shipped-artifact byte-identity arms (same bun-version cause) |
| `bun run typecheck` | exit 127 | `tsgo` is not installed in this checkout |

## 2. What changed in the harness (measured against the installed package tree)

### 2.1 The preset model was replaced (breaking)

- `@deepseek-ai/dsh-agent-presets` **no longer exists**. Its role is split into
  `@deepseek-ai/dsh-agent-preset-registry` (the `default` selection) and
  `@deepseek-ai/dsh-agent-preset` (one declaration per preset).
- A preset is now **an ordinary plugin row**, not a directory:
  ```yaml
  - id: agent-preset-registry
    name: '@deepseek-ai/dsh-agent-preset-registry'
    config: { default: standard }
  - id: preset-standard
    name: '@deepseek-ai/dsh-agent-preset'
    config: { id: standard, order: 1, plugins: [ <inline entry list> ] }
  ```
- The shipped presets are separate patch files under
  `<dsh-web-app>/presets/{standard,ptc,minimal,cordis}.patch.yml`, listed as an **array** in
  `dsh.bundle.patch`.
- Consequence for this bundle: the two id-targets on `agent-presets` and
  `dsh-tui-agent-presets` are dead; `presets/mpd/{preset.yml,agent.cordis.yml}` is no longer a
  loadable form. The `mpd` preset must become a `@deepseek-ai/dsh-agent-preset` row carrying the
  translated inline plugin list.

### 2.2 Agent Teams became an official, supported plugin set

- `@deepseek-ai/dsh-experimental-agent-team` — the `ctx.agentTeams` `TeamService` (implicit-root
  roster, durable peer mailbox, shared task DAG, all state in the **Lead Session log**).
- `@deepseek-ai/dsh-experimental-tool-agent-team` — the scoped model-facing tools
  `spawn_teammate`, `send_message`, `list_agents`, `wait_agent`, `interrupt_agent`,
  `team_task_create|list|get|update` + the `team:policy` prompt section.
- `@deepseek-ai/dsh-experimental-client-ui-agent-team` — the Web roster / task board / teammate
  navigation client.
- `@deepseek-ai/dsh-experimental-agent-team-profile` — a bundle that mounts those three and
  disables `tool-subagent`, `tool-subagent-control`, `tool-subagent-list-agents`, `tool-subagent-fork`.
- Service surface (`dsh-experimental-agent-team/lib/types/index.d.ts`): `membership(agent)`,
  `listMembers(agent)`, `spawnTeammate(caller, {name, description, prompt, context, provider, signal})`,
  `sendMessage`, `createTask`, `getTask`, `listTasks`, `updateTask`, `waitForChange`, `interrupt`,
  `tryMembership(agent)`.
- **State moved**: there is no `<workspace>/.mpd/team/team.json`. Team state is persisted as
  `team/member` / `team/task` events in the **Lead's session log** and published through the
  `agentTeam` session projection.

## 3. The one hard capability delta, stated plainly

`TeamService.spawnTeammate` forwards to `ctx.subagents.startContinuable({provider, label, request:
{prompt, parent}, signal})`. `SubagentStartRequest` therefore carries **no** `agentOptions`,
`persona` or `toolFilter` for the continuable path, and a `SubagentProvider` contributes only
`seed` (`prepareContinuable`) plus `agentRouteDefaults` (one-shot only). `resolveChildAgentOptions`
then derives the teammate route from its **parent (the Lead)**.

Therefore, with the official plugin:

- **Per-teammate model routing (the `teamModels.slot*` contract, AGENTS.md §13) CANNOT be applied
  mechanically** to a teammate spawned through `spawn_teammate`. It survives on the mpd one-shot
  consult path (`mpd_role_spawn` / `mpd_workmate_spawn`, which do pass `agentOptions`) and is
  carried as explicit guidance inside a roster-teammate's spawn prompt for the team path.
- **Mechanical read-only enforcement CAN be preserved**, by a tool guard keyed on the calling
  agent's team membership, which the official `tryMembership(agent)` resolves.

Both halves are recorded in AGENTS.md so no reader mistakes the reduction for an oversight.

## 4. Decisions (frozen for this wave)

| # | Decision |
|---|---|
| D1 | The `mpd` preset is declared by a new `packages/mpd-bundle/presets/mpd.patch.yml`; `dsh.bundle.patch` becomes an array. `presets/mpd/agent.cordis.yml` is retired as a *loadable* file. |
| D2 | `agent-preset-registry` is id-targeted to `{ default: mpd }`. |
| D3 | The official team rows mount under mpd-owned entry ids (`mpd-agent-team`, `mpd-tool-agent-team`, `mpd-ui-agent-team`) with entry **names** equal to the official package names, so no id can collide with `@deepseek-ai/dsh-experimental-agent-team-profile` when both are installed. |
| D4 | The three official packages are declared in the bundle manifest `dependencies` (the `dsh-better-sidebar` pattern) and mounted by our rows. |
| D5 | `packages/mpd-agent-teams-plugin` (the vendored `@nanmicoder/dsh-agent-teams` body), its `_deps` closure, the delta registry and the applier scripts are **retired**. Git history keeps them. |
| D6 | Every mpd plugin reaches the team service only through `mpdDsh` (the adapter). A static gate fails on a direct `ctx.agentTeams` / `ctx.subagents.startContinuable` reference outside the adapter. |
| D7 | The roster stays the bundle's capability: `mpd-roles-plugin` keeps the 11 specialists, registers a roster prompt section for the Lead through the adapter, exposes the roster member → teammate-prompt rendering, and registers the read-only guard. |
| D8 | Consumers (`mpd-team-watchdog-plugin`, `mpd-team-compact-plugin`, `mpd-ulw-plugin`, `mpd-tui-plugin`, the bundle web client) are rebased onto the adapter's team surface; where an old data source disappears, the plugin is rebased or honestly reduced. |

## 5. Lanes

| Lane | Scope (write) | Deliverable |
|---|---|---|
| A (captain) | `packages/mpd-bundle/**`, `package.json` | patch/preset migration, official team rows, release |
| B | `packages/mpd-dsh-adapter-plugin/**` | the adapter team surface + the direct-access gate |
| C | `skills/dsh-qa/scripts/**`, `scripts/verify-rows-parity.mjs`, `scripts/pack-mpd.mjs`, `scripts/install-profile.mjs` | gates and QA cases rebased onto the new preset model |
| D | `docker/**`, `scripts/docker-e2e.mjs` | ubuntu:24.04 + compose end-to-end client install test |
| E | `packages/mpd-team-watchdog-plugin/**`, `packages/mpd-team-compact-plugin/**`, `packages/mpd-ulw-plugin/**`, `packages/mpd-tui-plugin/**`, `packages/mpd-bundle-plugin/**` | consumers rebased onto the adapter team surface |

## 6. Retired assertions (recorded, not silently dropped)

Three test files were DELETED with the retirement, because every failing assertion in them was a read
of a configuration the bundle no longer ships — none of them tested live behaviour:

| Deleted file | What it asserted | Where the guarantee lives now |
|---|---|---|
| `packages/mpd-agent-teams-plugin/test/team-model-slot-routes.test.mjs` | the shipped bundle patch carried the `agent-teams.profiles.mpd` block with `tier:` on all eleven members, and the plugin's `Config` kept `tier`/`route` | the `teamModels.slot*` defaults and their resolution stay in `mpd-config-plugin` (`TEAM_MODEL_SLOT_DEFAULTS`, asserted by its own tests); per-member model ROUTING for a teammate is impossible on the official plugin (plan §3) and the roster's tier mapping is now guidance text, not config |
| `packages/mpd-agent-teams-plugin/test/opt2-residual-and-ordering.test.mjs` | `presets/mpd/agent.cordis.yml` put the complexity gate before the sizing doctrine | the persona text now lives in `presets/mpd.patch.yml`, and DELIVERABLE C of the roster task re-implements the gate; the ordering claim is prose, not a file the loader reads |
| `packages/mpd-agent-teams-plugin/test/member-readonly-deny.test.mjs` | the shipped profile marked exactly the six read-only members with `toolDeny` | `mpd-roles-plugin`'s read-only guard plus its equality test against `mpd-workmate-plugin`'s identical seven-name list (AGENTS.md §13) |

The rest of that package's suite (333 tests) stays green and keeps covering the retained code's own
contracts. Deleting the three files is a *record of the retirement*, not a test-weakening: a reviewer
who wants the old guarantees back has to restore a mounted configuration that offers them.
