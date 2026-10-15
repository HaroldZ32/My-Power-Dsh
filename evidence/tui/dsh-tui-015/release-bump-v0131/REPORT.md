# v0.13.1 version bump — three carriers

Junior Engineer lane. Branch `release/v0.13.1`, HEAD `80391dcf5ba1b586f000365b5fa8da2a76da8807`.
Captured 2026-10-15T07:20:55Z. No git writes performed (the captain commits).

## What changed

One line per file — the `version` value only:

| Carrier | Line | From | To |
|---|---|---|---|
| `package.json` | 6 | `0.12.0` | `0.13.1` |
| `dsh-plugin.json` | 6 | `0.12.0` | `0.13.1` |
| `dsh-distribution.json` | 6 | `0.12.0` | `0.13.1` |

Indentation, key order and trailing newline are unchanged; the payload is exactly 3 changed lines
(`git diff -- package.json dsh-plugin.json dsh-distribution.json` → `3 insertions(+), 3 deletions(-)`).

## Verification

1. **`bun run verify:manifest`** → `VERDICT: PASS — the install-time rules and the packaging contract
   hold.`, **exit code 0**. The `version:` rows read `0.13.1` for `dsh-plugin.json` and
   `dsh-distribution.json`, so the three-carrier coherence the gate pins holds.
   Log: [`verify-manifest.log`](./verify-manifest.log).
2. **`grep -n '"version"' package.json dsh-plugin.json dsh-distribution.json`** (exit 0):
   ```
   package.json:6:  "version": "0.13.1",
   dsh-plugin.json:6:  "version": "0.13.1",
   dsh-distribution.json:6:    "version": "0.13.1"
   ```
3. **`git diff --stat`** — the whole tree shows FOUR files, not three, because the captain-written
   `CHANGELOG.md` is still uncommitted (+56). Restricted to the task's scope the stat is exactly the
   three carriers, one line each:
   ```
    dsh-distribution.json | 2 +-
    dsh-plugin.json       | 2 +-
    package.json          | 2 +-
    3 files changed, 3 insertions(+), 3 deletions(-)
   ```
   I did not touch `CHANGELOG.md` (`git status --short -- CHANGELOG.md` → ` M CHANGELOG.md`, same as
   before my edits).
4. **CHANGELOG top entry** (first 25 lines) — line 17:
   `## v0.13.1 — the review pass: team-plane authorization, docker lane honesty, and the QA install path`.
   **It matches the bumped version.**

## Integrity checks

All three files still parse as JSON, all three end with a trailing newline, and the diff carries no
reformatting — see [`integrity.log`](./integrity.log).

## Premise discrepancy (noticed, not reconciled)

The task context said the carriers sat at **0.13.0**; at this HEAD all three actually read **0.12.0**. The
baseline `verify:manifest` (run before any edit) exited 0 with `version = 0.12.0` on every carrier, so
there was no partial bump — the release branch base simply never received the 0.13.0 carrier bump. The
`v0.13.0` tag (`d8e87a50`) and `master` both carry 0.13.0, and `v0.13.0` is **not** an ancestor of HEAD.

I landed the stated END STATE (all three carriers → `0.13.1`) because it is unambiguous and satisfies both
the manifest gate and the CHANGELOG; the true starting point is reported here rather than silently
"corrected". Branch-base provenance is the captain's call.

## Files in this evidence dir

- `verify-manifest.log` — full gate output with timestamp, HEAD, exit code.
- `version-evidence.log` — grep, `git diff --stat` (whole tree + scoped), full 3-line diff, CHANGELOG head.
- `integrity.log` — trailing-newline, JSON-parse and post-edit HEAD re-read.
- `result.json` — machine-readable summary.
