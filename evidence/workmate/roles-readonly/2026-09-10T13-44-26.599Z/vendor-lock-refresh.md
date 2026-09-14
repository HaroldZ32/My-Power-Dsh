# VENDOR_LOCK refresh — authorized as part of t13 by the captain

Rule applied (§R3): whoever edits `skills/` refreshes the fingerprint in the SAME unit of work.

Method: the gate's OWN `readBytes`/`listFiles` extracted **verbatim** from `scripts/verify-vendor.mjs` —
never a re-derivation, and never a value pasted from a message. Three hashes went stale in this delivery
(81620614 first-seen-and-stale, ca9dfa77 correct until my t13 edit, 2c11c7a9 now), so that discipline is
the only thing that holds.

    fileCount: 364   (unchanged)
    treeSha  : 1499dc30b80c5a7a377613ea6476601b5092ff8a357eb047922c92e5b2949cac
    previous : ca9dfa77663f26c1cd05e832bb17ae744ab5852aba80acffb3dab0754f5cb1ba  (superseded by the t13 edit)

NOTE ON WHY THIS VALUE MOVED ONE MORE TIME, because it is the lesson of this file: after the first
refresh I made a COMMENT-ONLY edit to the case header (embedding the stale-but-known-names mechanism
sentence), and that alone invalidated the fingerprint again — the gate re-red and I had to recompute.
Any `skills/**` write moves this value, including a comment. Recompute as the LAST action, always.

`VENDOR_LOCK.json` after the refresh: mtime **21:50:28**, sha256
`867205bfa34f4c783b978d5fef74aa6929c6ca8e993c0bfb70c44ac463bb2380`.

## Authoritative check 1 — `node scripts/verify-vendor.mjs`

```
[verify-vendor] commit OK: 8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29
[verify-vendor] version OK: 5.0.0-beta.20
[verify-vendor] stats OK: 9131 files / 1470231 loc
[verify-vendor] asset OK: skills 364 files
[verify-vendor] asset OK: packages/mpd-agent-teams-plugin/_deps 635 files
[verify-vendor] asset OK: packages/mpd-mcp-astgrep/dist/cli.js 1 files
[verify-vendor] asset OK: packages/mpd-mcp-gitbash/dist/cli.js 1 files
[verify-vendor] asset OK: packages/mpd-mcp-lsp/dist/cli.js 1 files
[verify-vendor] asset OK: packages/mpd-mcp-codegraph/dist/serve.js 1 files
[verify-vendor] PASS
```

exit 0

## Authoritative check 2 — `find skills -newer VENDOR_LOCK.json -type f`

Printed **NOTHING** (stable: no file under the vendored corpus is newer than the lock).

## F1 assertions on these bytes (the captain's acceptance shape)

- POSITIVE lane: parent `call#1` = 87 tools with **all seven** write-capable visible; the child's request
  = 81 tools with **none** of the seven (`childLeaksWriteCapable: []`) plus `structured_output`.
  `enforcement.ok = true`.
- CONTROL lane: with the pre-fix names re-injected the child receives the **full 87** tools and no
  refusal, so zero requests match the restricted-child signature
  (`childRequestsUnderRestriction: 0`, `refusalSeen: false`).

That pairing is what makes the assertion provably able to fail: the child is recognisable only
**because** it lacks the denied tools, so losing the restriction erases the signature.
