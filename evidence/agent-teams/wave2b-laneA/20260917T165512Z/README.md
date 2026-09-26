# t55 — review `t44` F1: the nested, unregistered region — re-anchored, and the hole closed

Stamp `20260917T165512Z` · lane A (agent-teams-engineer) · attempt `e7bf789e-9739-4372-ac38-dedab7ba5a2d`.

## The defect (mine, from t52) and the five-part fix

`mpd-delta plan-format-seed` had been inserted at `lib/session-start.js:224` — INSIDE `mpd-delta
session-start-gate`'s span (`:86–:648`) — so the nesting-blind `regionSpans` skipped it: the registry held
**118**, the live markers **119**, and every gate was blind (`--check` verifies registered regions; the heal
suite heals registered regions; the docs gate's helper folded the child into the parent's span and printed
`markers agree: 118`).

| acceptance item | what was done | reading |
|---|---|---|
| (1) re-anchor as a SIBLING | the 90-line block moved OUT of `session-start-gate`'s span: it now sits at `:559–648`, immediately after the parent's end marker at `:558` (before `interjection-expiry-session-start` at `:649`) | region map printed below |
| (2) `--write-registry` moves the count | **118 → 119** — exactly the previously missing entry — registry sha `461a425ae9eaa610832e5a3e…` | `registry-check.log` |
| (3) gates at that revision | `--check` exit 0 (119 / 10 files); heal **21 pass / 0 fail**; `verify:docs` PASS with its derived arm TRUE and no longer agreeing falsely: `carried **119**/10 vs derived 119/10` | `registry-check.log`, `heal.log`, `verify-docs.log` |
| (4) the deltas doc | the count sentence moved to **119** in the SAME change, with the re-anchor and its cause named (the doc and registry no longer disagree by one) | `agent-references/agent-teams-deltas.md` |
| (5) durable half | the applier's enumeration is now a STACK: an inner begin, a mismatched end or an unterminated region is REFUSED by id and span at the ONE place `--write-registry`, the applier and the heal path all pass through; and the docs gate's helper is handed over as a NAMED HOP REQUEST | red side below |

Region map after the fix (`lib/session-start.js`):

```
86 ://#region mpd-delta session-start-gate
558://#endregion mpd-delta session-start-gate
559://#region mpd-delta plan-format-seed      <- SIBLING
648://#endregion mpd-delta plan-format-seed
649://#region mpd-delta interjection-expiry-session-start
696://#endregion mpd-delta interjection-expiry-session-start
```

## The red side for the durable half (measured)

A scratch tree (copy of `scripts/patch-agent-teams-fixes.mjs` + `packages/mpd-agent-teams-plugin/lib/**`)
was **green first** (`already applied: 119 regions` — the fixture is faithful), then the 90-line block was
put back INSIDE `session-start-gate`. Result, both surfaces:

- `--check`: `FAIL: delta "mpd-delta session-start-gate" … (lines 86-648) no longer matches this script's
  registered block — first difference at line 558` (the parent's span changed, so the drift check fires);
- `--write-registry`: **`FAIL: region "mpd-delta plan-format-seed" (line 558) is NESTED inside region
  "mpd-delta session-start-gate" (line 86) — a marker must be a SIBLING, never a child: move …`**.

The exit codes were captured through a `| tail` pipeline (so the quoted `exit=` values are the pipeline's);
the refusal TEXT is the evidence, and both runs fail loudly where the old scan was silent.

## Readings (all at the final revision)

| command | result |
|---|---|
| `bun test ./packages/mpd-agent-teams-plugin` | **299 pass / 0 fail / 2763 expect() / 48 files**, exit 0 (`suite.log`) |
| `bun test …/self-fix-tests/t52-one-plan-format.test.mjs` | 3 pass / 0 fail / 19 expect() — T-42's own arms still green, so the re-anchor moved the region without moving the code (`arms-t52-after.txt`) |
| `bun test …/self-fix-tests/registry-context-heal.test.mjs` | 21 pass / 0 fail (`heal.log`) |
| `node scripts/patch-agent-teams-fixes.mjs --check` | exit 0 — 119 regions / 10 adopted files (`registry-check.log`) |
| `bun run verify:docs` | PASS — `carried **119**/10 vs derived 119/10` (`verify-docs.log`) |
| `bun test ./packages/mpd-team-watchdog-plugin` (CROSS-LANE READING) | **139 pass / 0 fail / 684 expect() / 13 files**, exit 0 (`cross-lane.log`) |

Counts that moved: the region count 118 → 119 (declared), and the suite's `expect()` total 2755 → 2763 at an
unchanged test count — reported as MEASURED, not attributed. PINS MOVED: none (no `test/**` file edited).
`packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`, `.mpd/plans/**`, `skills/**` untouched; no
repo-wide aggregate; every path-qualified command is `./`-formed with its discovered file count.

## The one item NOT delivered in scope, named

Acceptance item (5)'s second half — the docs gate's per-file count — lives in
`scripts/verify-docs-parity.mjs`, OUTSIDE this task's `inScope`. The exact drop-in replacement is prepared
in `gate-hop-request.md` with its acceptance, and the applier half of item (5) is delivered and red-armed.
