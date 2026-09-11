# t17 — `readonly-deny` SKILL.md row brought to the current enforcement method + same-unit fingerprint refresh

## What was wrong

`skills/dsh-qa/SKILL.md`'s `readonly-deny` case-table row still stated the PRE-t13 pass condition,
verbatim: *"the pass condition is a created, answering CHILD plus the absence of the harness
`names unknown global tool[s]` refusal"*. The shipped case (hash `ba6b4908…`) does more than that —
it asserts the child is RESTRICTED. The row had also survived a doc sync because that sync was told
not to treat the row as stale, an instruction written before t13 changed the pass condition.

The subtlety worth recording: **the file's mtime (14:23:38Z) was NEWER than the t13 change while the
row still described the old condition.** Freshness was not a content signal — so the new row says so
explicitly, in the row itself.

## The change (assertion column only; slug/domain/phase untouched)

- before: 1118 bytes · after: 2507 bytes
- `row-before.md` / `row-after.md` in this directory hold both, verbatim.

The row now states:
1. a READ-ONLY spawn must START a child **and that child must be RESTRICTED**;
2. the live half boots a **FRESH dsh process** whose parent is driven into one `mpd_role_spawn` by a
   **local OpenAI-shaped stub** with **NO provider credential**, and asserts the exact seven-name list
   reaches the harness, a child is **CREATED AND ANSWERS**, and — the load-bearing part — the child's
   own requests **EXPOSE NONE of the seven write-capable names** while the parent's **exposes all
   seven** (measured: child 81 tools with none, parent 87 with all seven plus `structured_output`);
3. the **falsifiability mechanism**: a re-injection control lane that **FIRST PROVES the mutation
   loaded** (`mutationLoaded`, read from the filter the adapter actually delivered) and **THEN** shows
   the child receiving the **FULL tool set with no refusal** — so the assertion demonstrably fails
   whenever the restriction is absent, and a run that never reaches a child **cannot pass vacuously**;
4. the mtime warning: do not read this row's freshness from the file mtime.

Superseded wording is gone: `grep -c` for `sentinel` = 0, `absence of the harness` = 0,
`list was sent` = 0.

## Fingerprint refresh — recompute was the LAST action

`skills/dsh-qa/SKILL.md` is inside the vendored corpus, so the write invalidated the lock. Sequence run:

    pre-recompute gate:  FAIL - asset skills treeSha mismatch      (confirms the edit landed)
    recompute:           gate's OWN readBytes/listFiles, verbatim, LAST action
    fileCount: 364   treeSha: d4a05ae26a0ead30912565f7fd8c2fbe120645c4cc3558e6ce53db103dadc606
    previous:           c66efeef901841546c2118455ef1058dc0aa39343387cf26fb21e0938033effb

### Authoritative CHECK 1 — `node scripts/verify-vendor.mjs`

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

### Authoritative CHECK 2 — `find skills -newer VENDOR_LOCK.json -type f`

Prints **NOTHING** in the same invocation as CHECK 1 (and an immediate recompute after the write
returned the identical digest, so the value is stable rather than merely accepted).

### Lock identity

    VENDOR_LOCK.json  mtime 22:36:44.817316679
    sha256            a3e299a2660ca7c3f825e1a7751af5ce5cdcf08770d612b061c820a8b21ec4f7
    skills treeSha    d4a05ae26a0ead30912565f7fd8c2fbe120645c4cc3558e6ce53db103dadc606   (364 files)

NOTE ON A SELF-INFLICTED DETOUR, recorded because it is the same trap this task documents: my FIRST
refresh wrote `927e22e7…`, but the checks then reported the gate red AND `find` printing SKILL.md —
diagnosis showed SKILL.md 9 s NEWER than the lock (22:35:49.99 vs 22:35:41.09). The cause was ordering:
I recomputed, and the file's state moved on before the lock landed, so the recorded digest described an
earlier byte state. The fix was to recompute, write, re-run the gate and the `find` in ONE invocation
and to re-derive the digest immediately after the write (`stable: true`). That is the operational form
of "recompute as the LAST action": the verification must share the invocation with the write, otherwise
the check is measuring a different moment than the digest did.

## Declared verify commands on the final bytes

| command | result |
|---|---|
| `node skills/dsh-qa/scripts/readonly-deny.mjs --self-test` | ok, 23 checks, exit 0 |
| `bun run test:qa` | `[test:qa] all self-tests passed`, exit 0 |
| `node scripts/verify-vendor.mjs` | PASS, exit 0 |
