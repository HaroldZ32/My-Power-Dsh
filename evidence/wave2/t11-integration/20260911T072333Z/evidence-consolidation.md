# Wave-2 t11 — evidence consolidation

Scope: every case directory produced by t2–t9 (plus the repairs t12–t15 and the reviews t8/t10) must be
complete on disk — a record file plus its raw logs — and anything partial or orphaned must be REPORTED,
never silently removed.

## Method

`find evidence/wave2 -type f` per case directory, then a record check for `result.json` / `RESULT.json` /
`t9-RESULT.json` / `t10-REVIEW.md` / `README.md` at the top level or one level down, then a zero-byte
scan (raw `evidence-consolidation.log` + `evidence-consolidation-detail.log` in this directory).

## Result — every wave-2 case has a record

| Case dir | files | record |
|---|---|---|
| `evidence/wave2/adopted-tooling/` (t4) | 12 | `result.json`, `README.md` |
| `evidence/wave2/adopted-tooling-repair/` (t13) | 17 | `result.json`, `README.md` |
| `evidence/wave2/adopted-tooling-repair-f4/` (t14) | 25 | `result.json`, `README.md` |
| `evidence/wave2/adopted-tooling-repair-f4-sibling/` (t15 cancellation analysis) | 1 | `README.md` (deliberately one file: the four measured approaches + two candidate designs) |
| `evidence/wave2/b8-binary-resolution/` (t6) | 16 | `RESULT.json`, `t1-decision-record.md` |
| `evidence/wave2/b9-installer-parity/` (t2) | 10 | `20260911T054527Z/result.json` |
| `evidence/wave2/memory-migration/` (t5) | 11 | `20260911T055855Z/result.json` + `before-after-summary.json` |
| `evidence/wave2/qa-workspace-isolation/` (t7) | 20 | `20260911T054831Z/result.json` |
| `evidence/wave2/r1-f1-exec-forward/` (t12) | 14 | `RESULT.json` |
| `evidence/wave2/r1-gate-order/` (t3) | 14 | `RESULT.json` |
| `evidence/wave2/t8-verification/` (Lead) | 111+ | `20260911T061046Z/{result.json, README.md}` + `attempt2/result.json` + `attempt3/result.json` |
| `evidence/wave2/t9-verification/` (Reviewer) | 86 | `20260911T061339Z/t9-RESULT.json` |
| `evidence/wave2/t10-review/` (Reviewer) | 31 | `20260911T063000Z/t10-REVIEW.md` |
| `evidence/wave2/t11-integration/` (this task) | — | this record |

Zero empty case directories under `evidence/wave2`.

## Partial / orphan report

- **No partial case directory.** The only zero-byte files under `evidence/wave2` are empty `*.err`
  capture files (`check1-prefix.err`, `check3-*.err`, `check2-*.err`, `heal-repro.err`, …) — they are
  the *proof of no stderr* for drivers that redirect it separately, not truncated records. Listed in
  `evidence-consolidation-detail.log`; kept on purpose.
- **Orphans: none left in place.** Wave 1's one partial directory was removed by the captain before
  this wave; no equivalent exists now.
- **One deliberate non-deletion:** the real team records `<repo>/.mpd/team/mpd-default-0bc1738e`
  (t7's isolation negative control) and `<repo>/.mpd/team/mpd-default-587132ea` (t9's isolation
  negative control) are REAL user state under `.mpd/` and are left in place on purpose — t1 §7 says
  report, never auto-delete. They are not evidence directories; see the carry-forward list for the
  user action (archive them in the AgentTeams tab).
- **Wave-1 evidence used by this integration** (not re-verified here, cited as inputs):
  `evidence/verification/t11-integration/` (wave-1 commit plan + green snapshot), `evidence/verification/t9-b2-b6/`,
  `evidence/verification/t10-review/`, `evidence/verification/t14-review/`, `evidence/session-workspace-root/**`,
  `evidence/hashline/**`, `evidence/fix/verif-tool-lossless/`, `evidence/agent-teams/provenance-version-align/`.
