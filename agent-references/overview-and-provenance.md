# Overview & provenance (the full former §1 body)

Agent-facing reference (English-only by the bundle's language policy; `bun run verify:docs` does not
discover this tree). **On demand — never auto-injected**: this file is deliberately not named
`AGENT.md`/`AGENTS.md`/`CLAUDE.md`, so the workspace instruction loader never reads it. `§N` citations
below refer to `AGENTS.md` sections, whose numbering is stable.

Provenance: moved from `AGENTS.md` §1 ("Overview & Provenance") on 2026-10-06 by the instruction-budget split (the
manual must stay under the harness's 65,536-byte workspace-instruction budget, and it was already
over at the previous HEAD). The block below is reproduced VERBATIM — its byte count and sha256 are
recorded in `evidence/gates/agents-budget/20261006T085805Z/result.json`. `AGENTS.md` §1 carries the BINDING rules and points
here for the full body; where the two differ, the manual wins.

**LICENCE STATE (current — de-omo wave E, 2026-10-08): this repository is MIT** (`LICENSE.md`,
`Copyright (c) 2026 HaroldZ32`). The block below is a VERBATIM reproduction of `AGENTS.md` §1 as it stood
on 2026-10-06, so it still reads `SUL-1.0` in places; those sentences are HISTORY and are superseded —
the full statement is in "LICENCE STATE (current)" at the foot of this file. Never quote the verbatim
block as the repository's present terms.

## The former §1 body (verbatim)

## 1. Overview & Provenance

**my-power-dsh** is a DeepSeek Harness (DSH) plugin bundle. **What it carries from upstream**: the
roster, the model-chain vocabulary and the roster's stable ids come from the upstream project, and
the capability baseline is
a pinned snapshot of `code-yeongyu/oh-my-openagent` (base commit `8c57e46`, v5.0.0-beta.20, recorded
in `VENDOR_LOCK.json` and not chased per §9), whose 11 specialists ship as adapted teammate templates
and workmate BASE templates; one component was adopted outright (the `agent-teams` plugin from
dsh-agent-teams under the MIT License, vendored as first-class main code) and is now RETIRED from the
composition in favour of the harness's own official Agent Teams plugin. **What is ours**: the DSH
plumbing, the plugin set, the `mpd` preset and the QA suite. Upstream spec parity is an engineering
reference, not an identity label — describe this repository by what it ships, never by what it is
not. License: SUL-1.0 (`LICENSE.md`), inherited from upstream; inheritance and attribution are
declared in `README.md` and `LICENSE-NOTICES.md`.

- **Naming.** Our prefix is **`mpd`** (my-power-dsh): packages, plugin ids, tool names (`mpd_*`),
  preset id (`mpd`), env keys (`MPD_DSH_*`), state dir (`.mpd`). Two exceptions are deliberate: DSH
  plugin names (`@deepseek-ai/dsh-llm-deepseek`, `dsh-llm-pi-ai`, `dsh-mcp-client`, …) are the host's
  API and are never renamed, and **Adopted plugins keep their plugin ids and tool names** (the
  `context7`/`grep_app` remote MCP rows follow the same rule). Upstream product names and repository
  paths stay upstream's (provenance only), and the two vendored binary-resolution env keys
  (`MPD_AST_GREP_SG_PATH`, the sg resolver, and `MPD_CODEGRAPH_BIN`, codegraph serve) are read by
  upstream vendored code and are never renamed.
- **Roster.** The 11 specialists are teammate instantiation templates — NOT presets — addressed by NAME
  and described by what they do, never by their internal stable `id`. One-shot consult goes through
  `mpd-roles-plugin` (`mpd_roles_list` / `mpd_role_spawn` / `mpd_role_persona`, `mpdRoles` service
  consumed by `mpd_modelchain_resolve`); team work uses the **official Agent Teams plugin**
  (`@deepseek-ai/dsh-experimental-agent-team` + `-tool-agent-team` + `-client-ui-agent-team`, mounted
  by this bundle's `mpd-agent-team` / `mpd-tool-agent-team` / `mpd-ui-agent-team` rows: the
  `spawn_teammate` / `send_message` / `list_agents` / `wait_agent` / `interrupt_agent` / `team_task_*`
  tools plus the official Web roster and task board); durable, evolving instances come from the
  **workmate library** (`mpd-workmate-plugin`). §13 defines roster, stable id, workmate and
  team-model slot precisely, and `mpd-roles-plugin` holds the authoritative names — read §13 before
  touching any of them.
- **THE TEAM RECORD IS OURS (team-plane split, 2026-09-30).** `mpd-team-core-plugin` owns the team
  (roster, board, DAG, `kind`/`attempt`/`round`/`verdict`) in `.mpd/team/teams/<id>.json`, served as
  **`mpdTeams`** and over the host route `/plugins/mpd-team/state`; `mpd-dsh-adapter` mediates the ONE
  execution seam, **`TeamExecutor`**, whose **native** backend (over `ctx.subagents.startContinuable`)
  is the DEFAULT and the official `dsh.team*` calls the FALLBACK. No mpd surface reads
  `dsh.teamLiveTeams()` any more. Surfaces: the TUI team scene draws the record's dependency graph
  (rank columns, status colours, focus chain, rail fallback) and the Web panel is ONE body registered
  into `dsh-better-sidebar` first with the harness's right sidebar as fallback — for the team AND the
  workmate library. See `docs/plan-team-plane-split.md`.
- **The vendored `agent-teams` body is DELETED (retired 2026-09-27, removed by the
  `de-vendor-and-verify-law` wave 2026-10-07).** It was a **0.1.14 body with the audited 0.1.16-rc.3
  deltas backported** (adopted package version `0.1.16-rc.3-mpd`; `lib/client.js` is still the 0.1.14
  client build). It lived at `packages/mpd-agent-teams-plugin` — **768 files, now GONE** — with
  `LICENSE-NOTICES.md` as its authoritative provenance record. Two pieces still ship, relocated in the
  same commit: the adopted client bundle at
  `packages/mpd-bundle-plugin/adopted/agent-teams-client.js` and the DSH runtime modules this repo owns
  at `packages/mpd-schemastery/`. It was **never mounted by a loader row** after 2026-09-27, so
  `agent_teams_*` tools, that plugin's
  `<workspace>/.mpd/team` record and its Web activity panel are NOT part of a shipped session. Harness 0.1.7-rc.2
  shipped an official Agent Teams plugin, and this bundle adopted it (see the roster bullet above and
  `docs/plan-0.1.7-adaptation.md`). Its `lib/` stays mediated through `mpd-dsh-adapter` except the
  counted `setup(childCtx, child)` residual that §6 names, which is why the code is retained rather
  than deleted: the D6 gate and the adapter still cover it, and a later wave can delete it without
  re-deriving that analysis. Deleting it is a declared follow-up, not an oversight.
- **A dependency a bundle DECLARES is mounted by a row that needs it.** The three official Agent Teams
  packages are declared in this package's `dependencies`, and `dsh-app-boot`'s
  `healProfileModuleFallback` materializes that closure into `<profile>/node_modules` before the
  loader runs. The same mechanism is how the `mpd-better-sidebar` row (the sidebar HOST the bundle's
  GUI pages need, deliberately id-named apart from the upstream row) resolves its sidebar host.
- **ULW is user-invocable**: the C2 (Plan C) ultrawork v2 engine (`mpd-ulw-plugin`) is reachable as
  `/ulw <objective>` and `/ultrawork <objective>` (equivalent, objective as argument) — the command
  submits the ULW activation directive as the invoking agent's own next user turn, so the run
  actually starts; empty input returns usage, and a plain-text `/ulw …` gesture gets the same
  directive on surfaces without command adjudication (headless). An activated ULW run asks the user
  nothing: it triages an unclear or investigate-first objective first, evaluates the same complexity
  predicate as any MPD request, stages its team on the mpd plan plane when the work warrants one
  (`agent_teams_plan` create → `add_member` / `create_task` → approve, which is what spawns the
  members), loops to
  completion, fixes defects on sight, and closes out through the verification and quality gates
  before reporting done.
- **The persisted GOAL is the basis of continuous execution (C8).** The harness ships the goal domain
  (`dsh-goal` + `dsh-tool-goal` + `dsh-goal-round-driver`) and the `mpd` preset mounts its tool and
  command rows; `mpd-goal-plugin` is what INVOKES them: `mpd_goal_status` / `mpd_goal_anchor` /
  `mpd_goal_finish`, the `mpdGoal` service, and the auto-anchor contract by which a heavy ULW run or a
  plan-bound `mpd_boulder_start` anchors a persisted goal (`goal.enabled` / `goal.autoAnchor` /
  `goal.autoRounds` in `mpd.jsonc`). A run that ends `max-rounds` deliberately LEAVES ITS GOAL ARMED —
  that is the handoff from the in-turn engine to the harness's round driver. Mutations go through the
  harness goal TOOLS, never `ctx.goals`, so the authorisation stays the harness's (a direct human turn
  for create/edit/pause/resume; the consecutive-round count for `blocked`); ownership is recorded per
  session in `<workspace>/.mpd/goal/anchors.json`. Evidence:
  `evidence/goal/goal-bridge/<ts>/` and the `goal-bridge` QA case.
- **The session-start complexity gate is MECHANICAL — it stages an APPROVABLE PLAN SHELL, never a
  team.** The frozen predicate `trigger = explicit flag OR (matchedSignals >= 1)` is evaluated at the
  session's first pre-step and the notice keeps the marker `[AgentTeams] Session-start team rule`, but
  on a trigger the gate STAGES a 0-member, 0-task plan shell through the `agent_teams_plan` tool and
  injects ONE notice naming the returned plan id — NOTHING is spawned, and the shell is INERT until the
  captain extends it (`add_member` / `create_task`) and approves it with
  `agent_teams_plan {action:"approve"}`. An explicit `team:` / `!team` request ALSO stages the shell
  (signal A) and has its marker CONSUMED from the goal text. `team.gate` in `mpd.jsonc` selects
  `mechanical` (the default) | `advisory` | `off`; without the `agent_teams_plan` tool mounted, or under
  `advisory`, the ONE notice is advisory and says `NO team was staged`, and the captain stages a team
  itself at the moment the work warrants one — or continues solo and says so. Signal D is an ACTIVE
  boulder work for this workspace (`status: "active"` in `.mpd/boulder.json`) — a plan FILE alone is NOT
  a signal, repaired 2026-10-07 because the retired plan-file probe fired in every session of this
  workspace. The gate is implemented by `mpd-roles-plugin` on the official plugin's seams (the retired
  `sessionTeamPolicy.mode: "auto"` unconditional-provisioning path is gone with the plugin that owned
  it).
- **The ONLY shipped preset is `mpd`** — the main working agent — which also carries the
  project-instruction convention: every session MUST attempt to read `AGENT.md` (falling back to
  `AGENTS.md`, then `CLAUDE.md`) via `dsh-agent-instructions`.

---

## LICENCE STATE (current) — de-omo wave E, 2026-10-08

**This repository's licence is MIT** (`LICENSE.md`, `Copyright (c) 2026 HaroldZ32`). Every declaration
that carries a licence field agrees with that file: `package.json`, `dsh-plugin.json` and the three
package manifests say `"license": "MIT"`, the packed manifest the packer writes says the same, and the
bilingual READMEs carry an `MIT` badge and licence section. Third-party components keep their OWN
licences, declared per component in `LICENSE-NOTICES.md`.

**The `SUL-1.0` bytes inside "The former §1 body (verbatim)" above are a HISTORICAL SNAPSHOT and are
SUPERSEDED.** That block is reproduced verbatim from `AGENTS.md` §1 as it stood on 2026-10-06, and its
byte count and sha256 are recorded in `evidence/gates/agents-budget/`. Its licence sentence, and its
account of the `agent-teams` body being "retained rather than deleted", were both overtaken by later
waves (the de-vendor wave deleted that tree on 2026-10-07; wave E moved the licence to MIT). The block is
kept because a licence record that erases its own past is defective — the manual's CURRENT §1 is the
binding one, and it states MIT.

---

## §1 long forms moved here by wave E (2026-10-08)

The five §1 bullets below were compressed in the manual to a short definition plus a pointer, because
`AGENTS.md` is injected into every session under a hard 65,536-byte budget and had fallen to 243 bytes of
margin. Their long forms are reproduced VERBATIM here. Where the manual and this file differ, the manual's
short form wins for the rule, and this file wins for the detail.

- **THE TEAM RECORD IS OURS (team-plane split, 2026-09-30).** `mpd-team-core-plugin` owns the team
  (roster, board, DAG, `kind`/`attempt`/`round`/`verdict`) in `.mpd/team/teams/<id>.json`, served as
  **`mpdTeams`** and over the host route `/plugins/mpd-team/state`; `mpd-dsh-adapter` mediates the ONE
  execution seam, **`TeamExecutor`**, whose **native** backend (over `ctx.subagents.startContinuable`)
  is the DEFAULT and the official `dsh.team*` calls the FALLBACK. No mpd surface reads
  `dsh.teamLiveTeams()` any more. Surfaces: the TUI team scene draws the record's dependency graph (rank
  columns, status colours, focus chain, rail fallback) and the Web panel is ONE body registered into
  `dsh-better-sidebar` first with the harness's right sidebar as fallback — for the team AND the workmate
  library. See `docs/plan-team-plane-split.md`.
- **The vendored `agent-teams` body is RETIRED (2026-09-27) AND REMOVED (2026-10-07)**: harness
  0.1.7-rc.2's official Agent Teams plugin replaced it, no loader row ever mounted it after the
  retirement, and the de-vendor wave deleted the tree outright. Its `agent_teams_*` tools, its
  `<workspace>/.mpd/team` record and its `mpd-delta` registry are NOT part of any shipped session, and no
  file here reads, copies, patches or fingerprints anything outside this repository. What SURVIVED the
  deletion was relocated into mpd-owned homes as our own code: the schemastery validator now lives in
  `packages/mpd-schemastery/**` (four shipped plugins import it) and the prebuilt browser client bundle
  in the web package, with the upstream MIT acknowledgement carried in `LICENSE-NOTICES.md`.
- **A dependency a bundle DECLARES is mounted by a row that needs it**: the three official Agent Teams
  packages are declared in `dependencies` and materialized by `dsh-app-boot`'s `healProfileModuleFallback`
  before the loader runs.
- **The persisted GOAL and ULW.** `mpd-goal-plugin` bridges the harness goal domain (`mpd_goal_status` /
  `mpd_goal_anchor` / `mpd_goal_finish` plus the `goal.*` auto-anchor contract); a run that ends
  `max-rounds` deliberately LEAVES ITS GOAL ARMED — the handoff to the harness's round driver — and goal
  mutations go through the harness goal TOOLS, never `ctx.goals`. `mpd-ulw-plugin` (C2 ultrawork v2)
  answers `/ulw <objective>` and `/ultrawork <objective>` by submitting the ULW activation directive as
  the invoking agent's OWN next user turn, so the run actually starts.
- **The session-start complexity gate is MECHANICAL — it stages an APPROVABLE PLAN SHELL, never a
  team.** The frozen predicate `trigger = explicit flag OR (matchedSignals >= 1)` runs at the session's
  first pre-step and the notice keeps the marker `[AgentTeams] Session-start team rule`; on a trigger the
  gate STAGES a 0-member, 0-task plan shell through the `agent_teams_plan` tool and injects ONE notice
  naming the returned plan id — NOTHING is spawned, and the shell is INERT until the captain extends it
  (`add_member` / `create_task`) and approves it with `agent_teams_plan {action:"approve"}`. An explicit
  `team:` / `!team` request ALSO stages the shell (signal A) and has its marker CONSUMED from the goal
  text. `team.gate` in `mpd.jsonc` selects `mechanical` (the default) | `advisory` | `off`: without the
  tool mounted, or under `advisory`, the ONE notice is advisory and says `NO team was staged`, and the
  captain stages a team itself when the work warrants one — or continues solo and says so. Signal D is an
  ACTIVE boulder work for this workspace (`status: "active"` in `<workspace>/.mpd/boulder.json`, which is
  gitignored RUNTIME STATE and not a shipped repo path) — a plan FILE alone is NOT a signal (repaired
  2026-10-07). Softer signals and the retired path are in the historical block above.


