# Outside re-run of lane B's repaired evidence driver (t29) — by the t13 reviewer

**Why this directory exists.** Captain dispatch asked `watchdog-engineer` (the t13 reviewer) to hand lane B
a 6-line diff for finding **F1**. By the time the diff was built, lane B's `t29` repair had **already
landed** on the driver (`run-laneB-evidence.mjs`: 140 → 223 lines, sha256 `cae90588897ecb0d…`, mtime
2026-09-17T08:21:12Z+0800) — so the diff was **not sent**, and the repair was re-run from the outside
instead. This is a reading, **not** the formal verdict on `t29`: that judgement belongs to `t30`.

## Command and reading

```
node evidence/pack-closure/wave2-laneB/20260917T072544Z-laneB/run-laneB-evidence.mjs \
     evidence/pack-closure/review-B/20260917T082500Z-t29-outside-rerun
```
→ **exit 0**, all 11 steps executed, `result.json` + `driver-summary.json` + the four harness artifacts
written INTO THIS FRESH DIRECTORY (the sealed dir was not written by the run).

| step | exit | expected | note |
|---|---|---|---|
| closure | 0 | 0 | |
| closure-selftest | 0 | 0 | `34/34 arms` on the pinned gate |
| dist-fresh | 0 | "reported" | repo-wide 20/20 |
| dist-fresh-ext-plugin | 0 | 0 | 2/2 |
| dist-fresh-tui-plugin | 0 | 0 | 1/1 |
| dist-fresh-selftest | 0 | 0 | 12/12 |
| verify-gates | 1 | "reported" | lane D's corpus; the aggregate is t18's — encoded as a by-design red in DATA |
| t67-build-form-diff | 0 | 0 | forms differ (the point of T-67) |
| t63-t76-seeded-mutation | 0 | 0 | |
| t63-out-flag-equivalence | 0 | 0 | |
| t67-round-trip | 0 | 0 | both round trips reproduce the committed bytes |

## F1 verification (the finding this re-run was for)

* **Structural half:** every harness invocation now resolves from the DRIVER's directory — quoted in the
  run's own `steps[].command`, e.g.
  `/root/dshProj/my-power-dsh/evidence/pack-closure/wave2-laneB/20260917T072544Z-laneB/t67-build-form-diff.mjs`.
  The old `ENOENT … <fresh-dir>/t67-build-form-diff.json` failure cannot occur: the run completed in a fresh
  dir with **no pre-existing `.json` artifacts**.
* **Provenance half:** the four harness readings were regenerated HERE as `<name>.json` (4749 / 4369 / 2603 /
  2315 bytes) from the `<name>.log` this run wrote — the header states it: "each harness's JSON is parsed out
  of the `<name>.log` this run just wrote and saved as `<name>.json` — so the readings can never come from a
  file the driver did not write".

## F2 verification (digest discipline)

* `digests` = 16 entries, all written by this run; `driver-summary.json` (25,662 B) **is** digested — it is
  now written by the driver itself, so the old empty-string digest cannot recur.
* `digests_skipped` = `{"driver.stdout.log": "empty file at digest time (0 bytes) - not evidence"}` — this is
  the discipline working on a file MY OWN shell redirection had created empty. Reading: the guard that F2
  asked for is present AND it fires on a real case.
* `result.json` excludes itself; its digest is reported separately by the summary.

## Bounds

* One run, one revision (`repo_head c826f16`); the readings are anchored to the sha quoted above and to
  `result.json`/`driver-summary.json` in this directory, each carrying its own digests.
* `verify-gates` exit 1 is lane D's corpus condition, not a driver defect; the driver records it as
  `expected: "reported"` rather than hiding it or failing.
* This note does not supersede t13's findings: F1/F2 were filed against the PREVIOUS revision of the driver
  and are answered here by measurement of the repaired one. The formal judgement is `t30`'s.
