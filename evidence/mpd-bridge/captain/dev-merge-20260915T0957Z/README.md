# The web/TUI settings bridge lands on `dev`

| | |
|---|---|
| Branch | `dev` |
| Merge commit | `c171d0c` — `merge: the web/TUI settings bridge into dev` (`--no-ff`, per AGENTS.md §5) |
| Merged from | `feature/mpd-settings-bridge` (`a647d47`) |
| Tree | `78e65e6090174f5e92dc6db32ea440a3454dc8dd` — **identical** to the feature tip's tree, so the merge changed no bytes |
| Pre-merge `dev` | `b660112` |

## Gates on the merged branch (re-run, not inherited)

| Gate | Result | Raw |
|---|---|---|
| `node scripts/verify-vendor.mjs` | **PASS** — `asset OK: skills 310 files`, all six assets OK | `raw/merge-verification.log` |
| `bun run test:qa` | **all self-tests passed**, exit 0 | `raw/test-qa-on-dev.log` |

The pre-merge sweep — typecheck 0, `bun test packages` 634 pass / 0 fail, R4 24 ids, R5
preset-conformance PASS, R6 `bundle-lifecycle` PASS, R7/R8/R11 ok, installer dry-run 0, the new
`test:qa:all` entry PASS, the shipped bilingual checker 28/28 and the cited-path check 0 missing —
is recorded at `evidence/mpd-bridge/captain/commit-sweep/` and was measured on the same tree hash,
which is why it is not repeated here.

## The wave's single re-pin

`VENDOR_LOCK.json` `assets/skills` moved `307 / ba0c3922…` → **`310 /
8ec53287296edb43b1f622046ff932a8e339f081184622854db4a2c0445a3268`**, with the `source` prose naming
the two bridge lanes and their shared engine, and `lockedAt` set to `2026-09-15T09:52:10Z`. The value
was recomputed with the gate's own algorithm
(`evidence/mpd-bridge/captain/recompute-skills-tree.mjs`, whose 12-char prefix matched the gate's own
print) and then refereed by the gate itself: `verify-vendor` PASS with `asset OK: skills 310 files`.

## `.gitignore` addition made here

`evidence/**/sandbox/` — lanes leave their isolated DSH home, sandbox HOME, fixture workspace and
package store inside their own evidence dir (measured: 291 MB / 5308 files for one lane). That is a
regenerable working area, not evidence; the report and raw logs beside it are. The sandbox stays on
disk and out of the repository, which took the staged set from 5514 files to 197.
