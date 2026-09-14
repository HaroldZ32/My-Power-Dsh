# t16 — vendored `skills` fingerprint refreshed after t13's case edit

Task: "Refresh the vendored skills fingerprint after t13's case edit (verify-vendor is red)".
Rule discharged (§R3): whoever edits `skills/**` refreshes the fingerprint in the same unit of work.

## What was red and why

The t13 case edit (and a follow-up comment-only header edit embedding the stale-but-known-names
mechanism) changed the vendored `skills` corpus while `VENDOR_LOCK.json` still held the previous
fingerprint, so `node scripts/verify-vendor.mjs` reported
`FAIL - asset skills treeSha mismatch` with `skills 364 files`.

## Method — never a pasted constant

The gate's OWN `readBytes`/`listFiles` were extracted **verbatim** from `scripts/verify-vendor.mjs`,
evaluated and run as the **last** action, and their digest written straight into the lock. This matters
because the constant went stale three times in this delivery (`81620614…` first-seen-and-stale,
`ca9dfa77…` correct until the t13 edit, then moved again after a comment-only edit). Any `skills/**`
write moves the value, including a comment.

    fileCount: 364   (unchanged)
    treeSha  : 1499dc30b80c5a7a377613ea6476601b5092ff8a357eb047922c92e5b2949cac

## Cross-check — independent recompute agrees with the stored value

Re-running the same gate helpers against the tree now returns exactly the stored value, so the lock is
current rather than copied from a message:

    recomputed treeSha : 1499dc30b80c5a7a377613ea6476601b5092ff8a357eb047922c92e5b2949cac
    locked treeSha     : 1499dc30b80c5a7a377613ea6476601b5092ff8a357eb047922c92e5b2949cac
    fileCount          : 364 | locked: 364
    CONSISTENT         : true

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

exit 0 — the last red binding gate in the delivery is cleared.

## Authoritative check 2 — `find skills -newer VENDOR_LOCK.json -type f`

Prints **NOTHING**: no file under the vendored corpus is newer than the lock.

## Lock identity

    VENDOR_LOCK.json  mtime 21:52:44
    sha256            31388572f84aec6dc3bdb69a935924b0c532786c6baa153fd88815bf566c2688

## Ordering rule inherited by t10 (§AB2)

`skills/dsh-qa/SKILL.md`'s `readonly-deny` row still describes the pre-t13 sentinel-based method and is
t10's file. Because any further `skills/**` edit invalidates this fingerprint, t10's own doc sync must
carry its own last-action refresh — otherwise the gate re-reds at the next sweep.
