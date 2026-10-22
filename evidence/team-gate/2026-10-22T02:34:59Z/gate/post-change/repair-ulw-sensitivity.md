# R1 repair 2 — the ULW gate honours `team.sensitivity`; the frozen head moves to A–F (2026-10-22)

Accepted as an in-wave defect by the captain. Scope: `packages/mpd-ulw-plugin/src/index.ts` (+ its
test) and the one QA probe in `skills/dsh-qa/scripts/ulw-command.ts` that mirrors the head text.
`dist/` was NOT rebuilt (the captain's integration re-runs it).

## 1. The consistency bug, fixed

Before: `evaluateUlwGate` called
`evaluateComplexityGate(objective, { explicitFlag, activeBoulder })` — no `sensitivity` — so the
`/ulw` pre-run gate always ran the shipped `easy` default while the session-start gate honoured the
configured row. One session could judge the SAME objective two different ways.

After:
- `Config.team` gains `sensitivity?: unknown`; `gateConfigValue` answers `SENSITIVITY_CONFIG_KEY`
  from `config.team?.sensitivity` (row layer), and the function's EXISTING precedence already tries
  the live `mpdConfig` service first — so the ULW gate now mirrors `session-gate.ts`: live layer
  first, row config second, `resolveSensitivity` for unknown/missing (→ `easy`, never throws).
- The row is resolved PER CALL inside `evaluateUlwGate` (never cached) and passed as
  `{ …, sensitivity }` into the ONE shared predicate.

## 2. The stale head, fixed

`ULW_ACTIVATION_DIRECTIVE` clause 2 now says:

> … (an explicit `team:`/`!team` flag OR any matched signal A-F: A explicit flag, B deliverable
> verbs, C enumerated steps, D an active boulder work, E a CJK-scale instruction, F large-workspace
> scale) was run by the plugin BEFORE this directive was injected, with the thresholds selected by
> `team.sensitivity` (easy | normal | strict), and its verdict is …

Deliberate byte change: the prefix cache is invalidated once, as the captain accepted for this wave.

## 3. Tests

- NEW arm: “team.sensitivity reaches the ULW gate: the easy row stages, the normal row stays
  silent” — the two-verb CJK one-liner `修复并验证` (B at easy `>= 2`, silent at normal `>= 4`):
  easy → 1 staging call, directive names `complexity signals B` and `a team PLAN was STAGED`;
  normal (same `team.gate`, one key added) → 0 staging calls, “no complexity signal fired for this
  objective”, no staged sentence; the two directives differ.
- `workdirs()` gained the optional `sensitivity` argument (row-config layer).
- Head assertions moved to `signal A-F` and now also require the `team.sensitivity` sentence.
- The test that mirrors the QA probe (C3.2) and that probe itself
  (`skills/dsh-qa/scripts/ulw-command.ts`, `CLAUSE_PROBES` id `gate`) were updated together, so the
  QA case and the package test cannot disagree.

## Observed results (quoted)

$ bun test packages/mpd-ulw-plugin
  25 pass
  0 fail
  220 expect() calls
  Ran 25 tests across 2 files.

$ bun test packages/mpd-roles-plugin
  169 pass
  0 fail
  1362 expect() calls
  Ran 169 tests across 9 files.

$ bun run typecheck
  $ tsgo --noEmit
  (exit 0)

$ bun run verify:comments
  VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.

$ node skills/dsh-qa/scripts/ulw-command.ts --self-test
  [ulw-command self-test] ok: … shipped directive literal and SKILL.md row verified

A repo-wide scan now finds ZERO `signal A-E` / `signals A-E` references (`packages`, `skills`,
`agent-references`, `docs`).

## Remaining bound (reported, NOT absorbed)

The ULW gate still does not evaluate SIGNAL F: it passes `sensitivity` but no `workspaceScale`, so
on a large workspace the session-start gate can fire F while `/ulw` does not. This is the same class
of divergence the captain asked to close for `team.sensitivity`; closing it needs ONE bounded
`readWorkspaceScale(workspace)` probe on rows whose `workspaceScale` is true (the workspace is
already resolved inside `evaluateUlwGate`). It changes `/ulw` staging behaviour in large projects,
so it is left for an explicit decision rather than smuggled into this repair.
