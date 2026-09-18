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
3. **A team when warranted** — a fired gate (or genuinely complex work) means
   `agent_teams_create(approval="automatic", profile="mpd")` with a captain-designed
   roster/DAG, run without user confirmation.
4. **Loop to completion** — never stop early to ask; rounds continue until every success
   criterion is clean.
5. **Fix on sight** — a defect the run finds is fixed in the same turn; never
   report-and-wait, never ask for approval.
6. **Close out on proof** — done only after the verification gate and the quality-gate
   ledger both approve.

## Policy (adapted from upstream ultrawork, base 8c57e46)

- Discovery waves: fresh child per round; bounded waves of independent work
  concurrent; stop after 2 fruitless discovery waves.
- Per-criterion loop: PIN → RED → GREEN → SURFACE → CLEAN until all criteria clean.
- Plan gate: Prometheus planner writes `.mpd/plans/<slug>.md` + checklist;
  Momus plan review when heavy/sensitive (max 2 re-reviews).
- Verification gate: Momus read-only reviewer (max 2 re-reviews) when a plan
  exists AND (tier=heavy OR strictReview OR plan review failed).
- Final quality gate: gate reviewer stamps per-lane ledger (`.mpd/ulw/<id>/ledger.jsonl`:
  code quality, hands-on QA, goal verification); any FAIL blocks completion.
- Subagent barrier and evidence-never-suppressed rules are part of the fixed directive.
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
`node scripts/verify-dist-fresh.mjs` flags its output as stale:

```sh
bun build packages/mpd-ulw-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ulw-plugin/dist/index.js
```

Test: `bun test packages/mpd-ulw-plugin`.
Live QA: `node skills/dsh-qa/scripts/ultrawork-smoke.mjs`.
