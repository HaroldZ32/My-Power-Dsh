# t21 post-completion re-measurement (observed while the task sat with the captain)

Written because the tree changed under this task between my last verify sweep
(`raw/verify-sweep-attempt2.txt`, 11:06Z) and the captain's completion instructions: another lane's
dist repair landed, so some recorded numbers are now historical rather than current. Nothing in this
file was edited to make a check pass; it records what is on disk now, and what it does to the two
arithmetic constraints.

## Current state (re-measured)

| item | value |
|---|---|
| `scripts/build-mcp.mjs` placeholder | **0** |
| the three `dist/BUILD.lock` placeholder | **0** each |
| the three `dist/BUILD.lock` `source` | `"8c57e46"` each |
| `bun.lock` ghosts | `omo-hephaestus: false`, `mpd-presets-plugin: false` |
| `bun.lock` workspace coverage | all 19 real `packages/*` dirs present (`lock-workspace-check-done`, 0 MISSING) |
| `packages/mpd-mcp-codegraph/dist/BUILD.lock` | does not exist (vendored prebuilt `serve.js`) |

## Per-dist lock/artifact equality and the external cli.js change

```
astgrep  source="8c57e46" disk_sha=f06bba31.. disk_bytes=84651  lock_match=true vendor_match=true
gitbash  source="8c57e46" disk_sha=0484a8ff.. disk_bytes=22651  lock_match=true vendor_match=true
lsp      source="8c57e46" disk_sha=9f41d425.. disk_bytes=234827 lock_match=true vendor_match=true
```

`lock_match` = the lock's `artifact.sha256`/`bytes` equal the artifact currently on disk.
`vendor_match` = the same hash equals the `VENDOR_LOCK.json` entry for that artifact **as it stands
now**.

**Change since my sweep**: `packages/mpd-mcp-gitbash/dist/cli.js` was rebuilt by another lane
(mtime 19:07, `M` in `git status`) — the five `platformFrmpdOptions` occurrences became the correct
`platformFromOptions`. My BUILD.lock was updated by that same rebuild, so it now records
`sha256 0484a8ff… / bytes 22651` (it previously recorded the committed `cb9ce8f3… / 22656`).
`VENDOR_LOCK.json` was changed too (`MM`), and its gitbash entry now matches the repaired bytes.
Both `astgrep` and `lsp` are unchanged in this window (`f06bba31` / `84651`, `9f41d425` / `234827`).

## What that does to the two arithmetic constraints

1. **"Any BUILD.lock keeps its artifact.sha256/bytes equal to the committed cli.js"** — still holds in
   its substantive form: every lock's hash/bytes equal the artifact on disk *and* the current
   `VENDOR_LOCK.json` entry. The literal reading "the three committed cli.js stay byte-identical"
   (`git diff --stat` empty) **no longer holds for gitbash**, but not because of this task: an
   external lane replaced that artifact after my lock edit. The current `git diff --stat` for the
   three files shows only `packages/mpd-mcp-gitbash/dist/cli.js | 10 +++++-----`.
2. **"The three committed cli.js must stay byte-identical"** — this task did not write any of them;
   the gitbash change is outside t21's ownership and outside its boundary (`cli.js` is explicitly out
   of scope, and the captain's boundary note says the dist repair belongs to t25). It is recorded here
   so the completion payload can quote an honest, current verification rather than the stale one.

## Consequence for the completion payload

- All acceptance criteria remain satisfiable and true **as of this re-measurement**; the historical
  numbers in `report.md` §2.2 and `raw/verify-sweep-attempt2.txt` for **gitbash only** have been
  superseded by the external repair (they were accurate when measured at 11:06Z).
- The gitbash line in the report is annotated accordingly; astgrep/lsp numbers are unchanged.
- Any completion claim about `git diff --stat` on the three cli.js must state the gitbash caveat and
  attribute it to the other lane, not to t21.

## Commands used for this re-measurement

All run from `/root/dshProj/my-power-dsh` at the time of writing; the four contract verify commands
and their outputs are quoted in the "Current state" section above and re-runnable as-is. The per-dist
table comes from a node one-liner that recomputes sha256 + byte length from disk and compares against
both the lock and `VENDOR_LOCK.json` (same shape as the E1 check in `raw/verify-sweep-attempt2.txt`).
