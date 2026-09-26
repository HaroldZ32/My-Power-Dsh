# NESTED CORRECTION — the declared-exception field named ONE default-root run; the tree holds TWO (t31 / B2-F6)

`result.json` in this directory is SEALED and is not rewritten. This note sits BESIDE it and completes
its `output_domain_and_immutability.declared_exception` field.

## The two legacy default-root runs, both named here

| run dir (under `evidence/extensions/docs-claims/runs/`) | what it is | reading |
|---|---|---|
| `run-2026-09-17T14-24-29.334Z` | an earlier **`--self-test`** run of the intermediate revision, executed WITHOUT `--out` → the checker's designed default root | `output_target` "fresh timestamped run directory", `negative_control` present, 21/21 |
| `run-2026-09-17T14-25-20.731Z` | the VERBATIM contract verify `node scripts/check-citations.mjs` (no `--out`) | 13/13, the run the sealed record already named |

Both are **intermediate-revision self-test artefacts, deliberately left in the legacy tree**: the
checker writes a fresh timestamped directory there by design (T-53 immutable-by-default), the tree is
the checker's own historical home (`OUT_BASE`), and it is INSIDE this task's declared write set
(`evidence/extensions/**`). Nothing is deleted — removing a run would destroy a reading, and the wave's
rule is that a superseded reading stays on disk.

## The rule as it should have been stated

"Every run this lane RECORDS passes an explicit `--out`" — and **every run the lane EXECUTES without
`--out`, including intermediate-revision self-tests, lands in the legacy default root and is named
here**. The t15 record named one of the two; this note names both. The t31 record's
`declared_exception` field carries the complete list, so a later auditor finds no unaccounted record.
