# t47 (impl-A/4c) — the mailbox completion: P1e delivered; P1d and P1b named as the uncovered halves

**Task:** `t47`, attempt 2, attempt_id `96b71a09-3480-4ff2-a285-93a488cfb956` (the dispatch carried
attempt 1 `de4f00b8…`; the claim minted attempt 2, and updates use the id the claim returned).
**Verify:** `bun test ./packages/mpd-agent-teams-plugin` → **275 pass / 0 fail / 2406 expect() calls /
42 files, exit 0**.

## P1e — DELIVERED, both sides on disk

The duplicate window no longer borrows the delivery-lease constant. `lib/state.js` now carries
`MAILBOX_DEDUP_WINDOW_DEFAULT_MS = 30 * 60 * 1000` — the region records the measured basis (the lease is
60 s while the exact-repeat groups sit at a median of 43.3 s and a maximum of 1,131.6 s, so the borrowed
constant could see only 4 of 7; and 2,084 records carry `dupCount` with every value 1, i.e. no fold has
ever happened). `MAILBOX_DEDUP_WINDOW_MS` survives as a back-compat alias of that default.
`windowMs <= 0` is **OFF** — a configured 0 folds nothing, rather than the "fold same-millisecond
records" that `Math.abs(...) <= 0` would have meant. The window is RESOLVED PER CALL: both dedup call
sites in `lib/tools.js` (captain and member paths) pass `windowMs: config.mailboxDedupWindowMs`, whose
home is a `z.number().default(MAILBOX_DEDUP_WINDOW_DEFAULT_MS)` field in `lib/index.js`, carried into
`resolved`, single-sourced from `state.js`.

| reading | result |
|---|---|
| ARM `self-fix-tests/t47-mailbox-window.test.mjs` (after) | **3 pass / 0 fail / 8 expect()** — the 30-min default asserted; a ~10-min repeat FOLDS with `dupCount: 2`; window `0` folds nothing even at the same millisecond; different content never folds |
| ARM against a scratch mirror with the OLD default restored (`MAILBOX_DELIVERY_LEASE_MS`) | **exit 1** — the ~10-min arm FAILS, the other two pass (they do not depend on the default) |
| one pre-existing arm updated | `test/r1-message-channel.test.mjs` "beyond the window" now pins its OWN `{ windowMs: 60_000 }`, because the 30-min default would otherwise have folded a 60 s repeat — its intent preserved explicitly rather than by drift |
| full suite | **275 pass / 0 fail / 2406 expect() / 42 files**, exit 0 |
| heal · `--check` · `verify:docs` · cross-lane | **21/0** · exit 0 at **96 regions / 10 files** (regenerated in the same change; the count did not move, so its sentence did not) · **PASS** · **139/0/684/13 files**, no break |

## P1d — NOT DELIVERED (named)

No `agent_teams_mailbox_check` tool, no pre-send precondition on `agent_teams_send_message`, no
`confirm_duplicate` escape. The measured basis (zero mentions of the tool name in `lib/tools.js`) still
holds. **Declared as the first step rather than discovered mid-edit:** adding a tool moves two pins this
task does not own alone — the tool-count pin `tools.size === 20` in `test/task-contract-tool.test.mjs`
and the tool-name lists in `lib/tool-names.js` (both inside this task's inScope, both to be updated in
the same change as the tool).

## P1b — NOT DELIVERED (named)

No retention prune, no knob, none of its five arms, no before/after on a seeded mailbox. The design is
unchanged from the t43 README's amendment section (delivery path, three conditions armed independently,
archive-first sidecar, bounded sweep, `0 = off`).

## The instrument and the marker rules

The registry cycle ran in the SAME change as P1e's edit (`--write-registry` → `--check` exit 0 at 96
regions / 10 files) **and** the full suite is green — because `--check` alone is not registry health. No
region was nested and no function was split: the P1e edits landed inside the existing regions
(`message-channel-r1` in `state.js`, `send-dedup-wiring` in `tools.js`), and the schema field went into
`lib/index.js`, which carries no region. `verify:docs` is PASS with its derived arm true, and the count
sentence did not move because the count did not (96/10 before and after).

## Bounds

No repo-wide aggregate. Every path-qualified command used the `./` form with its discovered count
reported (275/42; 3/1; 21/1; 139/13). `packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`,
`.mpd/plans/**` and `skills/**` untouched. The single `test/**` change is the pre-existing arm whose
intent P1e's default altered — declared here rather than left implicit. `F1-note.md` in this directory
files the cycle-note measurement at the captain's request.

## Files

`lib/state.js` `78aa42a50905034a…`, `lib/index.js` `5ae9ab23e74d178b…`, `lib/tools.js` `22c13235917487d1…`,
`lib/mpd-deltas.js` `de780c6cd391fa33…`, `self-fix-tests/t47-mailbox-window.test.mjs`
`6f13de2a56ed8e28…` (NEW), `test/r1-message-channel.test.mjs`, and this directory (`README.md`,
`F1-note.md`, `p1e-arm-after.out.txt`, `p1e-arm-before.out.txt`, `suite.log`, `heal.log`,
`registry-check.log`, `verify-docs.log`, `cross-lane.log`).
