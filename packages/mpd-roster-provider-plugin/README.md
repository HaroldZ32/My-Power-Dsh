# mpd-roster-provider-plugin

**English** | [中文](./README.zh-CN.md)

Per-member model routing for the **official Agent Teams fallback path**. This row is HISTORICAL wiring:
in a DEFAULT composition it routes **nothing**, because the native `TeamExecutor` resolves team members'
slots itself and the official `spawn_teammate` TOOL that reaches this package's provider is REFUSED at
the tool boundary. The default rule: a member's `teamModels` slot is resolved by identity precedence
`role` → the head of `description` → the whole `name`; an UNMATCHED member, or one whose slot is
unconfigured, INHERITS the staging session's route (the captain's in a top-level spawn, the Lead's in a
team-lead spawn) with one log line and no throw. This package remains the contained fallback for a
composition that runs the official executor and whose ROW raises teammates through the team service:
there the official `TeamService` forwards only `{ prompt, parent }`, so it applies a member's slot when
the teammate's descriptor label names that member.

**Bound.** The five official AUTHORING verbs — `spawn_teammate`, `team_task_create`,
`team_task_list`, `team_task_get`, `team_task_update` — are REFUSED at the tool boundary, and the mpd
RECORD is the only board (the door is `agent_teams_plan`, driven by `agent_teams_task` /
`agent_teams_dispatch`). This routing therefore serves only a teammate a ROW raises by calling the team
SERVICE directly (the official-executor fallback): that is not a tool call and is NOT gated — and a
DEFAULT (native-executor) composition never takes this path at all.

The slot is the ONLY route source (`contract .mpd/plans/slot-single-source.md` §6): `agentRoutes` is
deleted; on THIS path, a slot-routed member whose slot is unconfigured or malformed REFUSES the spawn
with the structured `SLOT_UNCONFIGURED` failure — thrown before `base.start`, so the composition's own
provider is never reached and no child is started — and the slot's own `fallbacks` chain is consumed
once (catalog-positive first win) before the route is applied. A teammate whose label names no roster
member is forwarded by identity (inheritance). The DEFAULT native executor does not throw: it INHERITS
the staging session's route with one log line and no throw.

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

The team service forwards no name — `request` is `{ prompt, parent }` — so the identity channel on THIS
path is the descriptor **label**, i.e. the teammate's `description`, and only its HEAD is read. The
DEFAULT native path has three channels and reads them in this order: `role` → the description head →
the whole `name`. `rosterNameHead` in the adapter is the ONE head-splitting implementation, so the two
paths cannot disagree about what "the head of a description" means. The contract is therefore:

> A member whose identity names a roster member is routed by that member's slot; an UNMATCHED member,
> or one whose slot is unconfigured, INHERITS the route of the session that staged it (the captain's in
> a top-level spawn, the Lead's in a team-lead spawn). Prompt text cannot create an identity.

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

On the official SERVICE path, a member that HAS a slot whose provider or model is unset **fails that
spawn loudly, naming the member and the slot**, writes no state, and never clamps an effort — the rule
the one-shot paths already follow. In the DEFAULT native composition a slot can never fail a teammate:
an unusable slot is reported in ONE log line and the member inherits the staging session's route. A
teammate whose identity names no roster member is not routed by this package: it is forwarded by
identity.

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
- A teammate whose identity names no roster member, or whose slot is unconfigured, INHERITS the route
  of the session that staged it, and the native executor logs that once. On this official path the only
  identity channel is the descriptor label the team service forwards, so prompt text cannot create one.
- In a DEFAULT composition this package routes nothing: the native `TeamExecutor` owns the decision.
