# t22 (X8 verification) — run plan and captain's lane clarifications

Status: ON HOLD. Do not run until the captain confirms the tree is settled
(t20 done; t21/t23/t24/t25 terminal). Then: **pin the revision FRESH** (staged/`MM` state,
`VENDOR_LOCK` re-measure if a fingerprinted file moved) — do NOT reuse the t11 baseline
(52 staged → 49 with no further delta + 3 `MM`: `lib/index.js`, `lib/mpd-deltas.js`,
`scripts/build-mcp.mjs`).

Write scope: `evidence/rtl-extraction-residual/x8/`. Repo files: read-only, never modified.

## X4 — brand guard (t20 + t25)
- Seed a foreign token → guard must exit non-zero **naming it**; then the committed dists → exit 0.
- If the guard can pass with **zero tokens inspected**, that is a finding.
- Matcher was revised mid-wave: hyphen forms now report **full identifiers**; `omoRuntimeCandidates`
  and `omo/ping` still truncate to `omo`, and **t25 closes those two**.
- Verify the state actually on disk at run time; report any **remaining truncation as a finding with
  the vector tested**.

## X5 — placeholder + lockfile (t21, scope extended to the script)
- `grep -c 'the upstream project'` must be **0** in `scripts/build-mcp.mjs` (2 occurrences: a comment
  + the `source:` value it writes into regenerated BUILD.locks) **AND** in every
  `packages/mpd-mcp-*/dist/BUILD.lock` (including codegraph).
  → script 0 but a BUILD.lock non-zero = **partial repair = finding, do not accept**.
- The three committed `cli.js` must remain **byte-identical** apart from t21's repair of the corrupted
  git-bash identifier; every BUILD.lock's `artifact.sha256`/`bytes` must match the file on disk
  → mismatch = finding. Also re-measure `VENDOR_LOCK.json`'s sha256 for that `cli.js` and say whether
  the lane re-pinned it (not re-pinned = blocker finding).
- `bun.lock` workspaces must match the real `packages/*` dirs exactly: **7 added, 2 ghosts removed**
  (`packages/omo-hephaestus`, `packages/mpd-presets-plugin`).
  → If the lane says `bun install` cannot run here (read-only cache dir), **do NOT accept prose**:
  check the lockfile's internal consistency and state plainly in the verdict whether the refresh is
  **VERIFIED-BY-MEASUREMENT** or merely **CLAIMED**.

## X6 — declaration (t23)
EN/zh-CN semantically 1:1 sentence by sentence; no surviving port/fork lineage; SUL-1.0 + attribution
intact; MIT text attributed to the adopted component **only**; plus one repo-wide grep for
`fork` / `port of` / `移植` against tracked non-historical files (a half-relanded declaration is worse
than none).

## X7 — relocate-smoke (t24)
Run the anti-mask matrix myself, quoting exit codes and marker lines verbatim:
pack absent → **exit 0** with exactly **ONE canonical marker as the LAST stdout line**;
`--no-skip` + pack absent → **exit 1** with the **same** reason/prereq/remedy;
**present-but-broken pack → exit 1 even in skip mode** (AM3).

## OUT-OF-WAVE (classify, never fix)
`codegraph-smoke.mjs` has no credential guard and dies with an uncaught ENOENT instead of skipping;
13 other real lanes exit 1 on absent credentials without a marker; t21's bun-install limitation.
These are recorded follow-ups for the next wave, NOT defects of this wave's lanes.
