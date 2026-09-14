# t11 — evidence consolidation audit

Scanned 2026-09-11T12:28:49. Completeness rule: a case directory carries a machine-readable result (`RESULT.json`/`result.json`) plus at least one raw output (log/txt/jsonl/md). `gates/`, `mount/`, timestamped run dirs are supporting artifacts of the case, never cases themselves. NOTHING was created, deleted, moved or rewritten by this audit.

| task | directory | result file | raw outputs | verdict |
|---|---|---|---|---|
| t2 B2 vendor re-pin | `evidence/verification/t9-b2-b6/20260911T033622Z` | yes | 16 | **COMPLETE** |
| t2 B2 vendor re-pin | — | — | — | t2 wrote NO standalone evidence directory; its raw logs live in t9's verification dir + its task output |
| t3 B3 verif lossless | `evidence/fix/verif-tool-lossless/20260911T030646Z` | yes | 12 | **COMPLETE** |
| t4 B4 hashline schema | `evidence/hashline/schema-union-fix` | yes | 8 | **COMPLETE** |
| t5 B5 comment-checker | `evidence/verification/t9-b2-b6/20260911T033622Z` | yes | 16 | **COMPLETE** |
| t5 B5 comment-checker | — | — | — | t5 wrote NO standalone evidence directory (the provisioning itself is gitignored .toolchain/); the skip/execute control is t9's b5-preprovision-skip.log |
| t6 B6 provenance | `evidence/agent-teams/provenance-version-align/20260911T032030Z` | yes | 1 | **COMPLETE** |
| t7 B1 resolution | `evidence/session-workspace-root/b1-resolution` | yes | 8 | **COMPLETE** |
| t8 B1 verification | `evidence/session-workspace-root/t8-verify` | yes | 42 | **COMPLETE** |
| t8 B1 verification | `evidence/session-workspace-root/t8-verify/attempt-2` | yes | 21 | **COMPLETE** |
| t9 B2-B6 verification | `evidence/verification/t9-b2-b6/20260911T033622Z` | yes | 16 | **COMPLETE** |
| t12 dist repair | `evidence/session-workspace-root/dist-repair` | yes | 10 | **COMPLETE** |
| t13 repair round 2 | `evidence/session-workspace-root/t8-verify/attempt-2/repair-t13` | yes | 11 | **COMPLETE** |
| t14 review round 2 | `evidence/verification/t14-review` | yes | 15 | **COMPLETE** |
| captain-named preset-conformance 03-0* | `evidence/dsh-qa/preset-conformance/2026-09-11T03-08-17.241Z` | yes | 3 | **COMPLETE** |
| captain-named preset-conformance 03-0* | `evidence/dsh-qa/preset-conformance/2026-09-11T03-10-07.166Z` | yes | 3 | **COMPLETE** |

Whole-tree hygiene scan: **0 empty directories** under `evidence/` (no files, no subdirs).

## Findings

- **F-cons-1 (info)**: t2 and t5 produced no standalone evidence directory. Their proof is preserved in two places: the task completion outputs in the team record, and t9's independent re-derivation under `evidence/verification/t9-b2-b6/20260911T033622Z/` (`b2-verify-vendor.log`, `b2-mutation-fresh.log`, `b2-mutation-raw.log`, `b5-preprovision-skip.log`). Nothing was missing from disk; the two tasks simply never used the case-directory pattern. Report only — no artifact was created or removed.
- **F-cons-2 (info)**: `evidence/fix/typecheck-baseline/2026-08-27T13-14-57.802330615Z` holds `result.json` but no raw log, and `evidence/agent-teams/sidebar-migration/final-2026-09-10T06-21-45Z/live-gui` is a supporting sub-tree of a COMPLETE case (`result.json` one level up). Both predate this delivery (2026-08-27 / 2026-09-10) and are outside the t2-t9 scope; listed for completeness only.
- The captain's deliberately removed partial directory `evidence/dsh-qa/preset-conformance/2026-09-11T02-51-22.844Z` is absent as intended — **not** reported as missing.

## Verdict
Every in-scope evidence directory for t2-t9 (plus t12/t13/t14) is complete: result file + raw outputs present. No partial or orphan case directory remains.
