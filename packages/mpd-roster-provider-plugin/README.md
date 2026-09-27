# mpd-roster-provider-plugin

**English** | [中文](./README.zh-CN.md)

Per-member model routing for **official Agent Teams teammates**. A teammate created by
`spawn_teammate` inherits the LEAD's model route, because the official `TeamService` forwards only
`{ prompt, parent }` — so the mpd `teamModels` slots, which do route the one-shot consult paths, had
no effect on a teammate. This package closes that gap **without forking the official plugin**.

## How it works

The harness, unlike its team service, is not the limitation:

- `SubagentContinuationManager.startContinuable` resolves `request.agentOptions` into
  provider/model/reasoningEffort and passes them to the **provider**, which is what constructs the run.
- a provider is a small class a plugin registers itself (`ctx.subagents.registerProvider`).
- the provider NAME is **row config**, not a tool argument: the official `spawn_teammate` tool always
  sends `provider: context === "fork" ? config.forkProvider : config.freshProvider`.

So this package registers a provider named `mpd-roster` that **delegates to the composition's own
provider** and applies the member's slot route on the way through, and the bundle points its
`mpd-tool-agent-team` row's `freshProvider` at it.

## Which member a teammate is

The team service forwards no name — `request` is `{ prompt, parent }` — so the identity channel is the
descriptor **label**, i.e. the teammate's `description`. The contract is:

> A description that NAMES a roster member routes that member; one that does not inherits the Lead's
> route.

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
follow. A member with no slot inherits, which is what every teammate did before this row existed.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `baseProvider` | `spawn` | the composition's own provider a delegation delegates TO |
| `enabled` | `true` | set `false` to leave the provider unregistered (every teammate then inherits) |

## Known limits

- Routing is resolved at SPAWN time from the live config; changing a slot affects the next teammate,
  not one already running.
- A teammate whose label names no roster member is not routed. That is a property of the one identity
  channel the team service forwards, not a policy choice.
