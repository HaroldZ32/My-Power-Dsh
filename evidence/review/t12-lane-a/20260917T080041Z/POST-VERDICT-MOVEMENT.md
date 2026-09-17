# POST-VERDICT MOVEMENT (nested beside the sealed t12 record) — which pinned files moved, and why

**Task:** t12 (review-A) · **Reviewer:** code-reviewer · **Written:** 2026-09-17 (after the captain flagged the drift)
`result.json` is NOT edited; this page is the correction BESIDE it, per the wave's doctrine.

## Full comparison: t12's PIN-1 (08:00:41Z) → now

| file (all of t12's pinned paths) | PIN-1 | now | verdict / cause |
|---|---|---|---|
| `lib/tools.js` | 5fe18cdf62af6801 | 6021bf6dfce594ed | **MOVED — by t21** (the pause-status collapse rewrote the file; T-61's guard is untouched inside it, see below) |
| `lib/mpd-deltas.js` | 3db729cd99937659 | 6dce6f1f3598c77b | **MOVED — by t24** (78→79) **then t21** (79→81) registry regenerations |
| `agent-references/agent-teams-deltas.md` | 2fd0099a47fa9a27 | 8716eaf51b0e32b8 | **MOVED — by t24/t21** (the derived count sentence 78→79→81) |
| `self-fix-tests/terminal-rearm-refusal.test.mjs` | 4c77cf321e32b927 | fad07bfb7d26e5cc | **MOVED — by t31** (the lane-A follow-up: comment-only correction of the refuted "inert in-process" framing, 2 sites) |
| `lib/state.js` | 6092febdb28e66c8 | 6092febdb28e66c8 | SAME (it was already t24's revision at my pin) |
| `lib/quality-gates.js` | 1b0eb60e61765f5e | 1b0eb60e61765f5e | SAME |
| `lib/snapshot.js` | fc534afdd0102314 | fc534afdd0102314 | SAME |
| `self-fix-tests/strict-task-arguments.test.mjs` | 1a901602f7975d7d | 1a901602f7975d7d | SAME |
| `self-fix-tests/repair-source-deadlock.test.mjs` | 92bcb5db9bc76f85 | 92bcb5db9bc76f85 | SAME |
| `self-fix-tests/registry-context-heal.test.mjs` | 63949b6706572de2 | 63949b6706572de2 | SAME |
| `self-fix-tests/terminal-dispatch.test.mjs` | e6bb57cb964f1fef | e6bb57cb964f1fef | SAME |
| `self-fix-tests/quality-loop.test.mjs` | 4969831008db2a2a | 4969831008db2a2a | SAME |
| `packages/mpd-roles-plugin/test/adapter-identity.test.ts` | df2d2935c341c886 | df2d2935c341c886 | SAME |
| `packages/mpd-ext-plugin/test/adapter-identity.test.ts` | 81b2c55e99c234e3 | 81b2c55e99c234e3 | SAME |
| `scripts/patch-agent-teams-fixes.mjs` | f142a271c9124753 | f142a271c9124753 | SAME |

## Why t12's verdict is untouched (measured on the current bytes, not asserted)

* **T-61** — the guard call is still there: `assertKnownToolArguments('agent_teams_update_task', …)` occurs exactly **1** time in `lib/tools.js` (t21 rewrote the pause-status regions, not the guard).
* **T-81** — the open-source exemption is still there: `OPEN_STATUSES.includes(repairSource.status)` occurs exactly **1** time in `lib/quality-gates.js` (SAME file hash).
* **T-79** — `export function assertTaskRearmable` is present in `lib/state.js` (SAME hash), and my LATER review (t33) re-ran the T-79 arm on the current revision: 6 pass / 0 fail, with terminal/cancelled/failed all refusing the rotation.
* **T-62** — both `adapter-identity.test.ts` files and `scripts/patch-agent-teams-fixes.mjs` are SAME.
* **T-75** — NOT APPLICABLE (unchanged; captain log §A-1 Ruling 2).
* The moved T-79 arm (`terminal-rearm-refusal.test.mjs`, by t31) was re-run by me on the CURRENT bytes under t33: **6 pass / 0 fail** — so the t31 comment-only edit did not disturb the arm.

## What a reader must not do with this page

Do NOT compare t12's quoted suite counts (self-fix 107/0, plugin 264/0) against the current tree expecting them to match: later work added cases (t24's +6, t21's +1 → 108/0 and 265/0). That movement was already disclosed in t12's own `output_append` (T-89 correction) and in t33's O3; this page adds the hash-level table the captain asked for.
