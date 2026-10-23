# mpd-roster-provider-plugin

**English** | [中文](./README.zh-CN.md)

Per-member model routing for **official Agent Teams teammates**. A teammate runs on the route of the
session that staged it, and the official `TeamService` forwards only `{ prompt, parent }` — so the mpd
`teamModels` slots, which do route the one-shot consult paths, had no way to reach a teammate. This
package closes that gap **without forking the official plugin**: it applies a member's slot when the
teammate `description` NAMES that member.

**Bound.** The five official AUTHORING verbs — `spawn_teammate`, `team_task_create`,
`team_task_list`, `team_task_get`, `team_task_update` — are REFUSED at the tool boundary, and the mpd
RECORD is the only board (the door is `agent_teams_plan`, driven by `agent_teams_task` /
`agent_teams_dispatch`). This routing therefore serves a teammate a ROW raises by calling the team
SERVICE directly (the official-executor fallback): that is not a tool call and is NOT gated.

The slot is the ONLY route source (`contract .mpd/plans/slot-single-source.md` §6): `agentRoutes` is
deleted, a slot-routed member whose slot is unconfigured or malformed REFUSES the spawn with the
structured `SLOT_UNCONFIGURED` failure — thrown before `base.start`, so the composition's own provider
is never reached and no child is started — and the slot's own `fallbacks` chain is consumed once
(catalog-positive first win) before the route is applied. A teammate whose `description` names no
roster member is forwarded by identity: inheritance, unchanged.

## How it works

The harness, unlike its team service, is not the limitation:

- `SubagentContinuationManager.startContinuable` resolves `request.agentOptions` into
  provider/model/reasoningEffort and passes them to the **provider**, which is what constructs the run.
- a provider is a small class a plugin registers itself (`ctx.subagents.registerProvider`).
- the provider NAME is **row config**, not a tool argument: the official `spawn_teammate` tool (now
  REFUSED at the tool boundary) always sent
  `provider: context === "fork" ? config.forkProvider : config.freshProvider`, and a row that raises a
  teammate through the team service resolves the same row config.

So this package registers a provider named `mpd-roster` that **delegates to the composition's own
provider** and applies the member's slot route on the way through, and the bundle points its
`mpd-tool-agent-team` row's `freshProvider` at it.

## Which member a teammate is

The team service forwards no name — `request` is `{ prompt, parent }` — so the identity channel is the
descriptor **label**, i.e. the teammate's `description`. The contract is:

> A description that NAMES a roster member routes that member; any other teammate runs on the route of
> the session that staged it (the captain's in a top-level spawn, the Lead's in a team-lead spawn), and
> prompt text cannot change a route.

The name is the text before the first separator (`—`, `–`, `:`, `|`, ` - `), matched
case-insensitively and longest-name-first, so `"Senior Engineer — implements the parser"` routes
Senior Engineer and `"check the vendored corpus"` routes nobody. Matching is deliberately
conservative: a wrong guess would silently move a teammate onto a model nobody chose.

## The slot a member takes

`TEAM_MODEL_SLOT_GROUPS` in `mpd-config-plugin` — the SAME declaration both settings front doors
render — is imported, never restated:

| Slot | Members |
|---|---|
| `slot1` | Architect, Planner, Reviewer, Lead, Senior Engineer |
| `slot2` | Researcher, Explorer, Plan Reviewer |
| `slot3` | Deep Worker, Junior Engineer |
| `slot4` | Vision Analyst |

## Failure

A member that HAS a slot whose provider or model is unset **fails the spawn loudly, naming the member
and the slot**, writes no state, and never clamps an effort — the rule the one-shot paths already
follow. A teammate whose label names no roster member is not routed at all: it runs on the staging
session's route, which is what every teammate did before this row existed.

### The reasoning-effort adaptation

A slot is read MATERIALISED over its schema defaults, so a teammate routed onto a model whose live
catalog entry declares **no** reasoning efforts at all would otherwise be handed the slot's default
`max`/`high` — a keyword no provider can accept, which fails the call. Before delegating, `start()`
passes the resolved route through the adapter's `withSupportedEffort`, which **drops** exactly that
keyword (logging the drop) and leaves every other route untouched: a model that DOES declare efforts
keeps the slot's keyword even when the value is unsupported, because that is a configuration error
worth seeing rather than papering over, and an unknown model or a degraded catalog read is not
evidence of anything. Nothing is ever substituted FOR the effort, so this is not clamping.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `baseProvider` | `spawn` | the composition's own provider a delegation delegates TO |
| `enabled` | `true` | set `false` to leave the provider unregistered (every teammate then inherits) |

## Known limits

- Routing is resolved at SPAWN time from the live config; changing a slot affects the next teammate,
  not one already running.
- A teammate whose label names no roster member is not routed: it runs on the route of the session that
  staged it. That is a property of the one identity channel the team service forwards, not a policy
  choice, and prompt text cannot change it.
