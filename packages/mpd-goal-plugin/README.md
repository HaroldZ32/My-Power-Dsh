# mpd-goal-plugin
**English** | [中文](./README.zh-CN.md)

C8 — the persisted GOAL as the durable basis of continuous execution.

The harness already ships the whole goal domain: `@deepseek-ai/dsh-goal` (the per-session state
machine), `@deepseek-ai/dsh-tool-goal` (`get_goal` / `create_goal` / `update_goal`) and
`@deepseek-ai/dsh-goal-round-driver` (the automatic continuation rounds), and the `mpd` preset
mounts the goal tool + `/goal` command rows. What no row did is **invoke** them — a long mpd run
finished inside one turn and left nothing durable for the driver to continue.

This row closes that gap. It adds a model-facing tool surface and one service, and it makes long
runs anchor a goal **automatically**, so "keep going until the objective is actually achieved" is
the harness's job rather than a second human instruction.

## Tools

| Tool | Purpose |
|---|---|
| `mpd_goal_status` | Read the calling session's goal (id, revision, objective, phase, rounds used/cap, activation, anchor). Needs no driver. |
| `mpd_goal_anchor` | Put a persisted goal in place for a long objective. An unfinished goal already current is KEPT, never replaced. |
| `mpd_goal_finish` | Complete (or attempt to block) the current goal and disarm continuation. |

## The `mpdGoal` service (consumed by `mpd-ulw` and `mpd-boulder`)

`available()` / `autoAnchor()` / `status(exec)` / `anchor(exec, {objective, source, maxRounds?})` /
`finish(exec, {outcome, source, reason?})`. Both consumers resolve it lazily with
`ctx.get("mpdGoal")`, so a composition without this row keeps working with no durable goal.

## The auto-anchor contract

| Trigger | What happens |
|---|---|
| `mpd_ultrawork` with `tier=heavy` or `plan=true` | Anchors a goal for the run's objective; the goal id lands in the run's `state.json`. |
| `mpd_boulder_start` (plan-bound work) | Anchors a goal named after the plan and the work id. |
| Run ends `complete` | The goal is completed (the anchor record is dropped). |
| Run ends `blocked` | A `blocked` transition is ATTEMPTED; the harness may refuse it before its consecutive-round threshold, and the refusal is logged, never fatal. |
| Run ends `max-rounds` | The goal STAYS ARMED on purpose: that is the case the goal exists for — the in-turn engine stopped, the round driver carries the objective on. |
| A goal this row did not anchor | Never completed, never blocked: ownership is recorded per session in `<workspace>/.mpd/goal/anchors.json`. |

## Config (`mpd.jsonc`, `goal` block; the row config is the fallback)

| Key | Default | Meaning |
|---|---|---|
| `goal.enabled` | `true` | Master switch; `false` makes the tools and the service inert. |
| `goal.autoAnchor` | `true` | Whether long runs anchor a goal by themselves. |
| `goal.autoRounds` | `32` | Round cap an auto-anchored goal is created with. |

## Policy is the harness's, not this row's

Every mutation goes through the goal **tools**. The domain's authorisation lives there — `create` /
`edit` / `pause` / `resume` require a direct human turn on a top-level agent, `blocked` requires the
configured consecutive-round count, and every call requires the exact live invoking agent inside an
active driver. A row that wrote `ctx.goals` directly could arm a goal the model itself could not, so
this plugin deliberately cannot: its adapter seam exposes the read and the tools, nothing else.

## Degradation

`capabilities().goals` (the durable read) and `capabilities().goalTools` (the write path) are
reported separately, and every entry point degrades instead of throwing: no service → the tool read
is tried; no tools → `mpd_goal_anchor` reports that the goal surface is not mounted; a refusal from
the harness (a policy refusal, a stale revision, a missing goal) comes back as `ok:false` with the
harness's own message.

## Build / test

```sh
bun build packages/mpd-goal-plugin/src/index.ts --target node --format esm --outfile packages/mpd-goal-plugin/dist/index.js
bun test
```
