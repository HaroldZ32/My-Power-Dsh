# t58 — T-115: the MEMBER-side send-path dedup wiring gets its OWN sibling region

Stamp `20260917T165932Z` · lane A (agent-teams-engineer) · attempt `b22c2534-0432-4ff0-b85b-5741d44026ff`.

## Why this row was measured at 16:47Z and fixed now

The captain deferred it on §2 minimal-diffs plus this wave's region risks, and reviewer `t44`'s finding F1 then
proved the deferral was the only safe call: a region added while every instrument was nesting-BLIND is exactly how
`plan-format-seed` landed unregistered and invisible. **`t55` closed that hole** — `regionSpans` is a stack that
REFUSES a nested region by id and span, with a seeded control on both halves — and **that refusal is this task's
precondition**, named as such rather than left to inference.

## The measurement (before)

`MOMENT=2026-09-17T16:58:43Z` · registry `lib/mpd-deltas.js` sha **`461a425ae9eaa610832e5a3e…`** with **119 entries** ·
`VENDOR_LOCK.json` sha `cfc8005d56bc3e3fb5ebfa74…` · stack scan over `tools.js`: 62 sibling regions, 0 unclosed, and

```
line 2641 -> inside: ['mpd-delta send-dedup-wiring (2634-2644)']
line 2662 -> inside: NO REGION          <- the member-bound fold, unprotected
line 2679 -> inside: ['mpd-delta send-dedup-delivery-guard (2678-2696)']
```

## The wrap (after)

The 5-line block (`// R1 wiring (same rule as the captain path above).` · `const pendingMember = …` · the
`appendMailboxDeduped(…, pendingMember, { windowMs: config.mailboxDedupWindowMs })` call and its closing `});`) is now
`mpd-delta send-dedup-member-wiring`, **1-based 2660–2666** (markers at 2660 and 2666). Stack scan AFTER:

```
STACK SCAN over tools.js AFTER the wrap: 63 regions, 0 unclosed, nested children = 0
  mpd-delta mailbox-send-gate:            2592-2615
  mpd-delta message-payload-ceiling:      2616-2632
  mpd-delta send-dedup-wiring:            2634-2644
  mpd-delta send-dedup-member-wiring:     2660-2666   <- the new SIBLING
  mpd-delta send-dedup-delivery-guard:    2680-2698
NEW REGION: mpd-delta send-dedup-member-wiring at 2660-2666; SIBLINGS (no containment): True
```

## The registry moved by exactly one entry, and NOTHING else moved

`--write-registry` → **120 regions**; after-sha **`f8f64be9d045e19efa128fce…`**. The stronger reading (a sha of a
regenerated file is only as stable as the writer's order): a scratch reconstruction of the PRE-wrap tree (the two
marker lines removed) regenerates **119 entries**, and comparing the id→(beforeContext, afterContext, block) TRIPLES:

```
added ids: ['mpd-delta send-dedup-member-wiring']
removed ids: []
PREVIOUS entries whose (before, after, block) CHANGED: 0
```

i.e. every one of the 119 pre-existing regions is byte-identical in the registry and the new entry is the only addition —
which is the precise meaning of "no existing region's span is altered by the wrap" (downstream LINE NUMBERS shift by +2;
no existing region's content or context did).

## The HEAL reading (the property a region exists for)

Scratch copy `…/tmp/t58-heal-idSW` (applier + `lib/**` incl. the new registry), the region **GONE** (2 marker lines +
5 body lines removed):

```
STRIPPED_SHA:  f521c6568459250ce3c31341…
[patch-agent-teams-fixes] applied: 120 mpd delta region(s) across 10 adopted file(s) (inserted: mpd-delta send-dedup-member-wiring)
RESTORED_SHA:  b001214ea76a60191c04a613…
REAL_SHA:      b001214ea76a60191c04a613…
```

Restoration is **byte-identical**, and the applier NAMES the inserted region.

## Readings (all at the final revision)

| command | result |
|---|---|
| `node scripts/patch-agent-teams-fixes.mjs --check` | exit 0 — 120 regions / 10 adopted files (`registry-check.log`) |
| `bun test ./packages/mpd-agent-teams-plugin` | **299 pass / 0 fail / 2771 expect() / 48 files**, exit 0 (`suite.log`) |
| `bun test …/self-fix-tests/registry-context-heal.test.mjs` | 21 pass / 0 fail (`heal.log`) |
| `bun run verify:docs` | PASS — `carried **120**/10 vs derived 120/10` (`verify-docs.log`); the count sentence moved in the SAME change |
| `bun skills/dsh-qa/scripts/agent-teams-messaging.mjs --self-test` | **exit 0** (`qa-messaging-selftest.log`) — CROSS-LANE: lane D's anchor-based rebuild (`MEMBER_CALL_HEAD` addresses the call by its text) survives a wrap that adds only comment lines |

## Bounds (stated, not smoothed)

- **`skills/**` and `VENDOR_LOCK.json`: `VENDOR_LOCK.json` is byte-identical across this task (`cfc8005d…` before AND
  after), and no `skills/**` path is in this task's changedPaths — so the wave's landed re-pin stays valid. MEASURED
  CAVEAT: `git status` reports **15 paths under `skills/` differing from HEAD** — that is the wave's own pre-existing,
  uncommitted corpus state (a single-writer lane's work, not this task's), and the QA instrument independently reports
  `VENDOR_LOCK skills pin current (324 files/2c039e4c49b9)`.
- Counts that moved: regions **119 → 120** (the entry named above) and the suite `expect()` total **2763 → 2771** at an
  unchanged test count — reported as MEASURED, not attributed. PINS MOVED: none; no `test/**` file edited.
- `packages/*/dist/**`, `dist/mpd-package/**`, `.mpd/plans/**` untouched; no repo-wide aggregate; every path-qualified
  command is `./`-formed with its discovered file count.

## Revisions

`lib/tools.js b001214ea76a60191c04a613…` · `lib/mpd-deltas.js f8f64be9d045e19efa128fce…` (120 entries) ·
`agent-references/agent-teams-deltas.md` (count 120) · `VENDOR_LOCK.json cfc8005d56bc3e3fb5ebfa74…` (unchanged).
Baseline pinned by t55: registry `461a425ae9eaa610832e5a3e…` (119), suite 299/0/2763/48, heal 21/0, cross-lane 139/0/684/13.
