# Nested correction: the register advanced to 24 rows — and the reconciliation script dies with the wave

**Filed by:** captain (MPD) · `2026-09-17T06:40:48Z` · parents **byte-untouched**
**Parent (sealed, and still the reading of ITS moment):** `../register-partition-check.{log,json}` — register sha
`c0046ee33e4b0785…`, **22** new rows, the revision pinned by the closure commit `eda90ae` / merge `46ef275`.
**This revision:** register sha `5d3397612f5fbe51…`, **24** new rows, `DISAGREEMENTS = 0`,
`reconcile-register.py` exit **0** (the full run output is `run-stdout.txt` beside this file).

## Why it advanced: an AUDIT found two rows missing, this did not reopen the wave

- **`T-85 [trap] A QA lane packs the CANONICAL artifact.`** Plan `L144` explicitly promised a *"New wave-2 row,
  with its remedy already proven in hand"* for the lane that runs `scripts/pack-mpd.mjs` against the real
  `dist/mpd-package` (`skills/dsh-qa/scripts/extension-lifecycle.mjs:376`). The row was never written: the
  journal carried the promise, the ledger (§8.6) did not. The row names the measured case (the `04:37:59Z` pack
  no task asked for, which forced the full provenance investigation of `L144`/`L145`/`L152`), the rule it
  produced — **the artifact has exactly ONE WRITER AT A TIME**, true by design rather than by discipline — and
  the proven remedy (point the lane's packed arm at a scratch out-dir, the `t70` `scratch-pack.mjs` pattern).
- **`T-86 [trap] The reconciliation script dies with the wave it reconciles.`** `reconcile-register.py:33` reads
  its coverage list from the LIVE team record (`.mpd/team/<team>/team.json`), and the standing one-team-per-wave
  rule archives that path on merge. Measured on the archived `friction-p1-wave`:
  `FileNotFoundError … .mpd/team/friction-p1-wave/team.json`, exit 1. Because the script writes only at the END,
  a failed re-run leaves the PREVIOUS revision's artifacts in place **looking current** — the first copy made
  here was exactly that failure: it reproduced the sealed digests byte-for-byte instead of the advanced ones, and
  was caught **by digest, not by eye**.

Both rows are in `.mpd/TODO.md` §8.6, and §8.1's mechanically-checked prose now reads **24**.

## Method, including the one intervention (so the numbers are reproducible)

1. `ln -s archive/friction-p1-wave .mpd/team/friction-p1-wave` — a TEMPORARY symlink that restores the input the
   standing archive rule removes. Removed immediately after the run (`rm`, absence verified).
2. `python3 evidence/wave1-integration/20260917T052400Z/reconcile-register.py` → **exit 0**, output captured in
   `run-stdout.txt`; the two artifacts it wrote are copied here
   (`register-partition-check.log` `ab31d310b7ee5d50…`, `.json` `d8ad385c4379ff41…`).
3. The sealed parents were then restored from the index and verified byte-exact
   (`2d89a4a0ee14edac…` / `1a3364f251a6c102…`) — the wave-closure reading stays untouched, which is the whole
   point of filing this as a nested correction instead of rewriting them.

## Tree state at audit time (the reading that makes the parents' moment checkable)

`git status --porcelain -uall` → exactly the **eight documented `.qa-*` scratch paths** (the T-77 exclusion set):
`.qa-before-dir`, `.qa-run-stamp`, `.qa-t15-dir`, `.qa-t17-after`, `.qa-t17-after-runner`, `.qa-t17-dir`,
`.qa-t17-final`, `.qa-t21-dir`. **0 modified, 0 staged, 0 other untracked.** Static gate aggregate
`bun run verify:gates` → **exit 0** (`pairs=37 failed=0 violations=0 exempt=17`; preset conformance 31 rows).
The new `.gitignore` rule `evidence/**/raw/final/` was verified with its own negative control in the same audit:
a probe file under that path is ignored (`.gitignore:71`), absent from `git status`, and still stageable with
`git add -f` (the documented escape) — then removed.

## Bounds

- These numbers rest on the ARCHIVED team record, read through the temporary symlink; the live directory did not
  exist at run time. That is T-86's measurement, not a property of the register.
- `../result.json` is deliberately NOT regenerated: it is a sealed record whose `register_partition` block pins
  the **22**-row revision at its moment (`c0046ee33e4b0785…`). Read it with its timestamp, as §8.7 requires; read
  the register itself (`.mpd/TODO.md`, untracked by design) for the current 24-row state.
- This directory is evidence only: no product file, gate script or package was touched by the audit.
