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
   team ITSELF with the OFFICIAL Agent Teams tools: `spawn_teammate({name, description, prompt})`
   per roster member, then `team_task_create({subject, description, blocked_by?, write_scopes?})`
   for the DAG — a captain-designed roster/DAG, run without user confirmation. The retired
   `agent_teams_create` / `agent_teams_*` tools do not exist on harness 0.1.7; team state is the
   Lead session's own.
4. **Loop to completion** — never stop early to ask; rounds continue until every success
   criterion is clean.
5. **Fix on sight** — a defect the run finds is fixed in the same turn; never
   report-and-wait, never ask for approval.
6. **Close out on proof** — done only after the verification gate and the quality-gate
   ledger both approve.

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
