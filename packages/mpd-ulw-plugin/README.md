# mpd-ulw-plugin

Plan C / C2 — fixed-policy ultrawork engine on the DSH subagent seam (v2,
replaces the B3 loop; `mpd_ulw` remains as a lightweight compatibility alias).

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

```sh
bun build src/index.ts --outdir dist --target node --format esm
```

Live QA: `node skills/dsh-qa/scripts/ultrawork-smoke.mjs`.
