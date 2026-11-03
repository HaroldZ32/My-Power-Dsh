# Settled-tree measurement — review B (lane B, loop loop-20261103T034211-dc7ad1)

Fingerprint = sha256( git status --porcelain + git diff ). All readings from the checkout root.

- H1 @ 2026-11-03T04:08:04Z: 8d46a8971b9dc95e935dab62a3ed984b2bc1e649fb644f4e598eb7a8293cc005
- (50 s settle window)
- H2 @ 2026-11-03T04:08:54Z: 8d46a8971b9dc95e935dab62a3ed984b2bc1e649fb644f4e598eb7a8293cc005  (identical)
- gate tests    @ 2026-11-03T04:08:59Z -> ev-20261103T040859-8c70db  exit 0
- H3 @ 2026-11-03T04:09:41Z: 8d46a8971b9dc95e935dab62a3ed984b2bc1e649fb644f4e598eb7a8293cc005  (identical after the gate run)
- gate typecheck @ 2026-11-03T04:04:56Z -> ev-20261103T040456-2cf7ba  exit 0 (re-read on the same settled tree)

## Independent dist-freshness check on the settled tree
```
  packages/mpd-mcp-codegraph/dist/serve.js — sha-pinned prebuilt vendored at pack time (packages/mpd-mcp-codegraph/README.md) — no local src/
[verify-dist-fresh] ok: 34/34 targets fresh (each rebuilt twice, byte-identical) — 1 NOT COVERED files listed — 737ms
```

## Gate tests summary (from 00-gate-tests-exit0.log)
```
 3450 pass
 6 skip
 0 fail
Ran 3456 tests across 229 files. [33.82s]
```

## Gate typecheck summary (from 01-gate-typecheck-exit0.log)
```
# gate typecheck cmd: "bun run typecheck" program: "/home/haroldzhao/.bun/bin/bun" argv: ["run","typecheck"]
$ tsgo --noEmit
```
