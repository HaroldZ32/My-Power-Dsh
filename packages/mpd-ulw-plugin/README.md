# mpd-ulw-plugin
**English** | [中文](./README.zh-CN.md)

Plan C / C2 — fixed-policy ultrawork engine on the DSH subagent seam (v2,
replaces the B3 loop; `mpd_ulw` remains as a lightweight compatibility alias).

## Commands

- `/ulw <objective>` and `/ultrawork <objective>` (identical behaviour) — inject the ULW
  activation directive for that objective and start the run. Empty input returns usage.
- No command surface (headless): a plain-text `/ulw …` / `/ultrawork …` message is
  recognised at the plugin's `agent/pre-step` boundary and receives the same directive.

## Autonomy policy (carried by the activation directive)

An activated ULW run asks the user nothing:

1. **Triage first** — an unclear objective, or an investigate-then-execute task, gets one
   normal-MPD investigation round before the gate, a team, or the loop.
2. **The same complexity gate** — the run evaluates the session-start predicate: an
   explicit `team:` / `!team` flag OR any matched signal (A explicit flag, B deliverable
   verbs, C enumerated steps, D an existing `.mpd/plans` artifact). Never a second predicate.
3. **A team when warranted** — a fired gate (or genuinely complex work) means the run stages the
   team ITSELF, and the DEFAULT is the staged-plan path: `agent_teams_plan` with `add_member` per
   roster member, then `create_task` for each DAG node (carrying its dependency answer), then
   `approve` — a captain-designed roster/DAG, run without user confirmation. That is the ONLY way in:
   this bundle's team plane is the mpd RECORD, the official Agent Teams tools are REFUSED at the tool
   boundary (`spawn_teammate`, `team_task_create`, `team_task_list`, `team_task_get`,
   `team_task_update`), and `send_message` / `list_agents` / `wait_agent` / `interrupt_agent` remain
   for agent communication. The retired VENDORED family (`agent_teams_create`, `agent_teams_add_member`,
   `agent_teams_create_task`, `agent_teams_approve`, `agent_teams_status`, `agent_teams_send_message`,
   `agent_teams_shutdown*`, `agent_teams_delete`) does not exist on harness 0.1.7 either — the five live
   tools are `agent_teams_plan`, `agent_teams_task`, `agent_teams_dispatch`, `agent_teams_mail` and
   `agent_teams_control`; team state is the mpd RECORD.
4. **Loop to completion** — never stop early to ask; rounds continue until every success
   criterion is clean.
5. **Fix on sight** — a defect the run finds is fixed in the same turn; never
   report-and-wait, never ask for approval.
6. **Close out on proof** — done only after the verification gate and the quality-gate
   ledger both approve.

**The NORMAL ULW flow — extending the staged plan through `agent_teams_plan` — is the GUARDED one.**
Stage the team with `agent_teams_plan`: `add_member` per roster member, then `create_task` for each DAG
node, then `approve`. The guard is the TOOL's, not advice: `create_task` REQUIRES the dependency answer
(`blocked_by: [...]`, an explicit empty root, or `independent: true`), and `approve` REFUSES two tasks
whose declared write scopes overlap with no dependency path between them (naming the pair and the two
remedies).

**There is no bypass at the TOOL boundary: the team door closes it there.** The mpd RECORD
(`<workspace>/.mpd/team/teams/<teamId>.json`, served as `mpdTeams`) is this bundle's team plane and
`agent_teams_plan` is the way in; the team-door guard REFUSES `spawn_teammate`, `team_task_create`,
`team_task_list`, `team_task_get` and `team_task_update` on every session, while `send_message` /
`list_agents` / `wait_agent` / `interrupt_agent` stay for agent communication. **The bound, stated once:**
a ROW that calls the team SERVICE directly (the official-executor fallback) is not a tool call and is NOT
gated. So no task a TOOL authors can reach a board without its dependency answer: `create_task` requires
it, and `approve` refuses an overlapping write scope with no dependency path.

## Policy — upstream shape, our wording

The discipline's SHAPE is upstream's: it is re-expressed from the **documented** upstream ultrawork
discipline (base 8c57e46). The WORDING shipped here is this package's own — **no upstream prompt,
policy or error text was found or copied**, and the clauses below name things that exist only in this
bundle (the `mpd` toolbox, the five `agent_teams_*` tools this harness has, `.mpd/ulw`, the
`mpdConfig` keys).

**Un-diffed residual, stated rather than smoothed over:** four clauses could NOT be compared against
any upstream text — the ladder `PIN → RED → GREEN → SURFACE → CLEAN`, the
stop-after-2-fruitless-discovery-waves rule, the subagent barrier, and evidence-never-suppressed.
They are OURS in wording; that they are upstream's in intent is unproven, and this note does not
claim it.

- Discovery waves: fresh child per round; bounded waves of independent work
  concurrent; stop after 2 fruitless discovery waves.
- Per-criterion loop: PIN → RED → GREEN → SURFACE → CLEAN until all criteria clean.
- Plan gate: Prometheus planner writes `.mpd/plans/<slug>.md` + checklist;
  Momus plan review when heavy/sensitive (max 2 re-reviews).
- Verification gate: Momus read-only reviewer (max 2 re-reviews) when a plan
  exists AND (tier=heavy OR strictReview OR plan review failed).
- Final quality gate: gate reviewer stamps per-lane ledger (`.mpd/ulw/<id>/ledger.jsonl`:
  code quality, hands-on QA, goal verification); any FAIL blocks completion.
- Subagent barrier and evidence-never-suppressed rules are part of this package's fixed directive —
  two of the four clauses with no upstream text to diff them against.
- Optional hyperplan wave: 5 adversarial category reviewers (unspecified-low/high,
  deep, ultrabrain, artistry) → insight bundle → planner.

## Tools

- `mpd_ultrawork({objective, tier?, plan?, hyperplan?, strictReview?, maxRounds?})`
- `mpd_ulw({objective, maxRounds?})` — alias (light tier, no plan).

## State

`.mpd/ulw/<id>/{state.json, ledger.jsonl}`; plans land in `.mpd/plans/`.

## Build / test

Run from the repository root with path-qualified arguments — the canonical form. A build
run inside the package directory writes different bundler path comments, so
`node scripts/verify-dist-fresh.ts` flags its output as stale:

```sh
bun build packages/mpd-ulw-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ulw-plugin/dist/index.js
```

Test: `bun test packages/mpd-ulw-plugin`.
Live QA: `node skills/dsh-qa/scripts/ultrawork-smoke.ts`.
