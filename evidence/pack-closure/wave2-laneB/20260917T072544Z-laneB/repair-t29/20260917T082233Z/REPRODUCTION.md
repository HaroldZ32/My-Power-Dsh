# t29 — review-B F1/F2: reproduction on the PRE-repair revision, and the fix

## Pre-repair revision

`run-laneB-evidence.mjs` = **`abbc33335219766a`** (the digest quoted in the t9 completion). Both findings were
reproduced on it before any edit:

**F1 — cannot run in a fresh dir (ENOENT), and readings come from files the driver never writes.**
`node run-laneB-evidence.mjs <fresh-dir>` → **exit 1**, `node:fs:441 … ENOENT` on
`<fresh-dir>/t67-build-form-diff.json`: the four harness paths were resolved against the OUTPUT dir
(`join(dir, "<name>.mjs")`) and the readings were parsed from `<name>.json` files that only my earlier
MANUAL runs had produced — sealed 15:28:13–15:37:52, i.e. BEFORE the driver's own 15:38 `.log` runs. So the
driver could assemble four harness readings it had not taken.

**F2 — the digest loop digested a file being written and a 0-byte file.**
With `probe-empty-file.tmp` planted (0 bytes) and stdout redirected into the evidence dir, the digest map
carried both `probe-empty-file.tmp` and `driver-summary.json` as `e3b0c44298fc1c14` — the sha256 of the EMPTY
string. An empty file was presented as evidence, and the stdout target was digested mid-write.

## The fix (revision `cae90588897ecb0d`)

1. `here = dirname(fileURLToPath(import.meta.url))`; the four harnesses are resolved as `join(here, …)`, so the
   `[<evidence-dir>]` argument only chooses WHERE outputs go — a fresh dir works in one command.
2. Each harness step parses the JSON out of the `<name>.log` THIS run just wrote (`parseJsonFromLog`: whole
   stdout, else the braced span) and saves it as `<name>.json`; a parse failure is recorded in
   `harness_parse_errors` and fails the driver's exit code instead of silently yielding `null` readings.
3. Digests: the files this run wrote (every `<name>.log`, every harness `<name>.json`,
   `driver-summary.json`) are digested BY NAME; any other top-level file is digested only if it is non-empty
   AND its mtime predates the run; everything skipped lands in `digests_skipped` with its reason
   (`empty file at digest time (0 bytes) - not evidence` / `mtime falls inside this run …`). `result.json`
   excludes itself and the run PRINTS its own digest after the write (`regenerated.result_json_digest`).
4. `expected` per step is explicit: 0 for the lane's own gates and harnesses, `"reported"` for the repo-wide
   `dist-fresh` and for `verify-gates` (T-84: a cross-lane aggregate is reported with its cause and never
   gates this lane's exit code).

## Post-repair readings (both scenarios)

- **Fresh dir** `evidence/pack-closure/wave2-laneB/20260917T074900Z-regenerate-t29/` → driver **exit 0**, 16
  artifacts digested, all four harnesses parsed and saved, the planted 0-byte file and the empty stdout
  redirect both SKIPPED with reasons.
- **Its own dir** → driver **exit 0**, 25 artifacts digested, `result.json` digest `f1ef332092dfcb68`, the two
  0-byte `.err` files skipped with reasons.
- Digest deltas from the own-dir regeneration are disclosed in `digest-deltas.txt` (the four harness JSONs and
  `result.json` change because the readings are per-run; the pre-repair revisions stay cited above).
