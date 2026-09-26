# t49 (impl-A/4e) — P1b: the automatic archive-first retention prune. DELIVERED

**Task:** `t49`, attempt 1, attempt_id `2bf3c950-7e98-40e4-a09f-8e7af0d47fd8`.
**Verify:** `bun test ./packages/mpd-agent-teams-plugin` → **282 pass / 0 fail / 2479 expect() calls / 44 files, exit 0**.

## What landed

- **The prune rides the DELIVERY path** — `pruneMailboxRetention()` (in `lib/state.js`, inside the existing
  `message-channel-r1` region) is invoked by `acknowledgeMailbox()`, the function that marks a record
  delivered + read, so no timer is needed and the sweep is deterministic; it is **BOUNDED** (default 64
  per call, `MAILBOX_RETENTION_BATCH`).
- **Eligibility, three conditions, each armed on its own:** `deliveredAt` AND `readAt` set (an UNREAD
  record is never touched) · older than the window (measured on `deliveredAt`) · not currently leased
  (`deliveryClaimedAt` cleared or past `MAILBOX_DELIVERY_LEASE_MS`).
- **Archive-first:** the bytes are written to `<inbox>/archive/<key>.retention.<moment>.jsonl` BEFORE the
  live file is rewritten, and the tombstone keeps `id`/`ts`/`from`/`to` **plus** `readAt`/`deliveredAt`
  (and `dupCount`) — so it can never re-open as unread and is never deliverable twice (`readUnreadMailbox`
  asserted 0 in the arm).
- **The knob, configured the same way as t47's dedup window:** `mailboxRetentionMs:
  z.number().default(MAILBOX_RETENTION_DEFAULT_MS)` in `lib/index.js`, single-sourced from `lib/state.js`
  (`MAILBOX_RETENTION_DEFAULT_MS = 7 days`), carried into `resolved`, and passed **per call** at the three
  `acknowledgeMailbox` sites in `lib/tools.js` as `{ retentionMs: config.mailboxRetentionMs }` — never
  cached at apply time. `retentionMs <= 0` disables the prune (an arm proves it).
- **The default's justification, measured:** the longest exact-repeat gap this mailbox ever produced is
  1,131.6 s and the dedup window is 30 min, so 7 days is ~500× beyond any evidence the fold could need —
  while the workspace holds 116 inbox files / 3,302 records (largest 1.0 MB / 410 records) with no
  automatic tombstone ever created. Long enough to keep anything reviewable, short enough to reclaim.

## Readings, both sides

| reading | result |
|---|---|
| `self-fix-tests/t49-retention-prune.test.mjs` | **4 pass / 0 fail / 26 expect()** — the three conditions (stale-acked pruned; never-read NOT; leased NOT; fresh NOT); archive-first (the sidecar record `toEqual` the original byte-for-byte, and the tombstone keeps id/ts/from/to/readAt/deliveredAt/dupCount with `readUnreadMailbox` 0); the knob (`0` disables, a quarter-day window prunes, and the ACK PATH prunes with no explicit call); and the seeded measurement + the t43 guard |
| **SEEDED BEFORE/AFTER (the effect, not the argument)** | `[P1b] seeded 45 records at 1970-01-31T00:16:40.000Z → pruned 40, tombstones 40, live 5` — the 5 live survivors are exactly the unread ones; the workspace baseline this exists to reduce is 116 inbox files / 3,302 records |
| the t43 clear guard, re-verified AFTER the prune landed | `clearMailboxToWatermark` returns `cleared: []` and `skipped_unread` naming all five unread records — the guard still holds, verified rather than assumed |
| RED side | eligibility condition (a) reverted on a scratch mirror → **exit 1, 2 failing arms** (the pruner then touches unread records); mirror outside the workspace, deleted in-call |
| full suite · heal · `--check` · `verify:docs` · cross-lane | **282/0/2479/44** · **21/0** · exit 0 at **99 regions / 10 files** (`--write-registry` in the same change; the count did not move, so its sentence did not either) · **PASS** · **139/0/684/13**, no break |

## Declared pins

**No existing pin moved.** The three `acknowledgeMailbox` call sites in `lib/tools.js` gained an options
argument (nothing pins that signature), and the new region-less edits landed inside the existing
`message-channel-r1` block plus the `lib/index.js` schema/resolved pair. No marker was nested, no function
was split, and no test file was changed for this task.

## Bounds

No repo-wide aggregate; every path-qualified command `./`-formed with its discovered count reported
(282/44; 4/1; 21/1; 139/13). `packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`,
`.mpd/plans/**` and `skills/**` untouched. Evidence: this directory (`README.md`, `arms-after.out.txt`,
`arms-condition-a-reverted.out.txt`, `suite.log`, `heal.log`, `verify-docs.log`, `cross-lane.log`).
