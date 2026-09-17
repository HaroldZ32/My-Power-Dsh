# CROSS-REFERENCE — review-B's OUTSIDE re-run of the repaired driver (t29 acceptance, verified from outside)

Read-only pointer to another seat's artifact, filed in this lane's record so t30 does not have to reconstruct the
walk. The reviewer (lane C seat, t13) ran the repaired driver into a FRESH directory of its own and left its
artifacts there:

`evidence/pack-closure/review-B/20260917T082500Z-t29-outside-rerun/` — `OUTSIDE-RERUN-NOTE.md`, `result.json`,
`driver-summary.json`, the 11 step logs and the four regenerated harness JSONs.

## What the reviewer reported

`node evidence/pack-closure/wave2-laneB/20260917T072544Z-laneB/run-laneB-evidence.mjs <its own fresh dir>` →
**exit 0**, all 11 steps executed, everything written INTO the fresh dir, THIS lane's sealed dir untouched.
It also noted that the driver file changed under it (140 → 223 lines, sha256 `cae90588897ecb0d`, mtime
2026-09-17T08:21:12Z+0800), which is why it sent no F1 patch: a diff against the pre-repair revision would have
been a stale, unattributed write into a file whose repair was already in flight.

## What I verified myself on its artifacts (not taken on report)

- `result.json.driver` = `{"resolved_harnesses_from": ".../wave2-laneB/20260917T072544Z-laneB", "output_dir":
  ".../review-B/20260917T082500Z-t29-outside-rerun"}` — the F1 fix, visible in its own run's data.
- `harness_parse_errors` = `{}`; the four harness JSONs exist in ITS dir with 4749 / 4369 / 2603 / 2315 B.
- `digests` = 16 (the files that run wrote), and `digests_skipped` = exactly ONE entry, firing on a REAL 0-byte
  case created by the reviewer's own shell redirection: `driver.stdout.log` → "empty file at digest time
  (0 bytes) - not evidence". The F2 guard is therefore exercised by an independent run, not by my fixture.
- `steps` carries `verify-gates` at exit 1 with `expected: "reported"` (lane D's corpus, the single re-pin is
  t18) — the per-command verdict rule is encoded in data, so the aggregate can never be read as this lane's red.
- This lane's sealed artifacts are unchanged by the outside run: `result.json` still `f1ef332092dfcb68`, the
  driver still `cae90588897ecb0d`.

## Status of the judgement

This is an outside RE-RUN, not the formal verdict: **t30 owns the judgement of t29 on its own revision.** Filed
here because the F1 acceptance test ("a reviewer can point it at a fresh dir and regenerate everything in one
command") is proven by an artifact that lives outside this lane's directory, and a reader of this record should
find it in one hop.
