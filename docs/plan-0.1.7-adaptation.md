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

## 7. Post-release findings (v0.10.0 → v0.10.1)

v0.10.0 was tagged and pushed on 2026-09-27 after a green sweep. Two defects were then measured by
lanes whose verification went deeper than the sweep did. Both are recorded here rather than folded
silently into a fix, because each is a CLASS of evidence gap worth keeping.

### 7.1 The session-start gate was MOUNTED but NEVER FIRED

Lane C's rebased `skills/dsh-qa/scripts/session-start-team.mjs` — after lane C fixed two of its own
instrumentation bugs (a shared `DSH_HOME` legitimately holds one session-store key per side, so the
side's own workspace was the wrong isolation bound) — booted six headless sessions and measured ZERO
notices on every triggered side:

```
threeWay: {"ok":false,"simpleNotices":[0,0,0],"softNotices":[0,0],"softSignals":[[],[]],
           "softStaged":[0,0],"explicitNotices":[0],"explicitStaged":[0],"explicitMarkerConsumed":[false]}
```

Root cause, measured in the installed harness: `@deepseek-ai/dsh-agent-loop`'s `preStep()` emits
`waterfall("agent/pre-step", { messages: claimed, ...position, signal }, …)` — **the payload carries no
`agent`**. The gate opened with `const agent = payload?.agent; if (agent === undefined) return
undefined`, so it returned early on every step. Mounted, silent, no throw, no warning.

**Why the sweep missed it, named precisely.** The gate's evidence was (a) an apply-time log line
`sessionGate=advisory`, which proves the plugin APPLIED, and (b) a unit test that handed the listener a
payload *containing* an `agent` — a payload shape the harness never sends. The captain's integration
boot explicitly recorded that bound ("it has no boot line and is asserted by the unit test only") and
still shipped it. A unit test that constructs the payload it feeds the code under test cannot witness a
payload-shape mismatch; only a real boot can, which is exactly AGENTS.md §7's "assert a REAL tool
result" rule. The fix moves the agent resolution from the payload to the registration SCOPE (the same
place `@deepseek-ai/dsh-experimental-tool-agent-team` gets it) and adds a test that drives the listener
with the REAL payload shape.

### 7.2 A live lane's green was partly vacuous

The same case's isolation assertion passed the side's own workspace as the bound, so in a shared
`DSH_HOME` it flagged sibling sides as escapees and — once fixed — revealed that its `gateInstalled`
check did not exist at all. A live lane that reports ONE boolean cannot say which half failed. The
structural remedy, applied here and already used by `bundle-lifecycle`: split a step into NAMED
sub-assertions so "the gate was never mounted" and "the gate is mounted and did not fire" are different
readings with different owners.

**Both lessons are binding for the next harness adaptation:** a payload-shape assumption is verified by
a BOOT, never by a unit test that builds the payload; and a live case's verdict is only as strong as
its most granular assertion.

## 8. Agent-team capability delta (retired vendored body → official plugin + mpd layer)

Measured 2026-09-27 by reading both surfaces: the retired tool list is
`packages/mpd-agent-teams-plugin/lib/tool-names.js` (20 stable operations), the current one is
`@deepseek-ai/dsh-experimental-tool-agent-team` (9 model-facing tools) plus the mpd layer
(`mpd-roles-plugin`'s guard, roster section and advisory gate).

**YES, the surface is smaller, and the reductions are real.** What is gone, and what replaced it:

| Retired capability | Retired semantics | Now |
|---|---|---|
| `agent_teams_create` + `_approve` + `_edit_plan` | stage a plan, the user edits and approves it in the Web panel, then the scheduler runs | **GONE as a mechanism.** The captain spawns teammates and posts tasks on the shared board directly; `team_task_update`'s revision-checked lifecycle replaces the staged-plan gate |
| `_add_member` / `_remove_member` | extend/prune the roster beyond a profile | `spawn_teammate` per member; **no removal** — `interrupt_agent` stops a turn, nothing deletes a member |
| `_create_task` / `_reassign_task` / `_claim_task` / `_update_task` | task DAG with `attempt_id` and auto-claim | `team_task_create` + `team_task_update` (`claim`/`release`/`edit`/`set_dependencies`/`complete`/`reopen`/`reassign`/`delete`) with `expectedRevision`; **no `attempt_id`** |
| `_status` | roster + board + delivery snapshot | `list_agents` + `team_task_list` |
| `_send_message` / `_mailbox_check` | messaging + a read-only unread pre-check | `send_message`; **no unread count exists on the official mailbox** |
| `_task_contract` | a frozen per-task contract object | **GONE** — the task record (`subject`, `description`, `blocked_by`, `write_scopes`) is the contract |
| `_path_owner` / `_move_path` | path ownership and hand-off | **GONE** |
| `_rollover` | generation rollover | **GONE** — the board's `revision` is the generation bound |
| `_resume` / the Stop-team halt | one operator pause mechanism | **GONE** — the official plugin exposes no halt; the watchdog's preserving hold is the only pause this bundle implements |
| `_delete` | archive a staged/finished team | **GONE** — a team is the implicit root of its Lead session |
| the dependency-DAG **scheduler** with auto-claim | members were dispatched automatically | **GONE** — the captain dispatches with `send_message` and `wait_agent` |
| per-member **model routing** (`teamModels.slot*` → member) | each teammate started on its tier's route | **GONE for teammates** (plan §3: `spawnTeammate` forwards only `{prompt,parent}`). The slots still route the ONE-SHOT paths (`mpd_role_spawn`, `mpd_workmate_spawn`) |
| per-member `toolDeny` | mechanical read-only discipline | **RESTORED** as a tool guard keyed on the calling agent's team membership (`mpd-roles-plugin/src/team-guard.ts`) |
| `<workspace>/.mpd/team/team.json` | durable cross-process team record | **GONE** — state is the Lead's session log (`team/member`, `team/task`) |
| the adopted Web activity panel / sidebar tab | roster, plan editor, activity | replaced by the OFFICIAL roster + task board client; the bundle's own sidebar tab is now the watchdog view |
| the `/agent-teams` command | stage a team from a slash command | **GONE** |
| the session-start gate's **provisioning** modes | `mode: auto` staged a team unconditionally | **ADVISORY only** — restored on the official seams, and it stages nothing |

**What is NOT reduced:** the 11-member roster (names, personas, read-only discipline), the
session-start complexity gate (advisory), one-shot consult (`mpd_role_spawn`), the workmate
library, the team watchdog and the team-compaction lanes — all still shipped, rebased where their
data source moved.

## 9. Adapter coverage audit (2026-09-27)

Question asked: is EVERY harness interface of the agent-team plane on `mpd-dsh-adapter`?

- **The mpd team plane: yes.** `mpd-roles-plugin` (guard, roster section, gate) reaches the team
  service only through `mpdDsh`; the D6 gate proves it statically over 22 packages / 96 `.ts` files.
- **The official plugin itself: no, and it cannot be.** `@deepseek-ai/dsh-experimental-agent-team`
  and friends ARE harness code — they talk to the harness because they are part of it. Routing them
  through this bundle's adapter would mean forking them, which is the opposite of adopting the
  official surface. What this bundle controls is which ROWS it mounts and how its OWN code reaches
  them.
- **Two real gaps were found and closed by this audit** (neither was visible to the D6 gate, which
  only looked for two identifiers):
  1. `mpd-team-watchdog-plugin` subscribed to `agent/pre-step`, `agent/session-start` and
     `agent/turn-stopping` on a RAW ctx while its `session/event` and `agent/assistant-stream`
     subscriptions already went through `dsh.onEvent` — a split nobody had seen, because an event
     NAME is invisible to an identifier scan. All three now go through `dsh.onEvent` (which is what
     the adapter is for: a renamed harness event is absorbed in ONE file).
  2. `mpd-bootstrap-plugin` subscribed to `fs/observed` the same way; it now takes the adapter and
     contains its own handler (the adapter's `onEvent` is a passthrough).
  The D6 gate gained a second rule family (`FORBIDDEN_EVENT_NAMES`) so this class cannot come back.
- **Deliberately NOT routed, and named:** `ctx.on("internal/service", …)` in `mpd-bundle-plugin` and
  `mpd-workmate-plugin` is the CORDIS FRAMEWORK's own service-registry signal, not a harness seam —
  the rule lists harness EVENTS, not "no `ctx.on` anywhere".
- **The retired vendored body** stays adapter-mediated with its counted 5-line residual
  (`lib/members.js`), and it is unmounted, so it is not on any live path.
