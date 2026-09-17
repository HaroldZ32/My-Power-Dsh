# SUPERSEDED — do not copy `20260917T0730Z-wave-2a-plan.md` (v1)

v1 of the wave-2a plan (`20260917T0730Z-wave-2a-plan.md`, 498 lines) contained TWO defects, both corrected in
`20260917T0745Z-wave-2a-plan-v2.md` (the plan-of-record the captain commits byte-for-byte):

- **ER-1** — v1 §1 success-criterion 2 named `node scripts/verify-gates`, a script that does not exist on disk
  (`scripts/verify*` = verify-rows-parity, verify-vendor, verify-dist-fresh, verify-docs-parity, verify-pack-closure).
  The aggregate it meant is `bun run verify:gates` (`package.json:37`); v2 names that and lists its MEMBERS.
- **ER-2** — v1 §5.5 said "two moves" where the plan requests ONE move (D-5) plus ONE amend (D-1).

Nothing else differs between v1 and v2. Authored by the Planner seat (task `t5`, read-only); v1 is retained
unedited as the authoring artifact, per the wave's nested-correction rule.
