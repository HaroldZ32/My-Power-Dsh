# Doc-set fingerprint — review docs (T7)

Method: sha256 over the sorted sha256sum of every *.md under docs/, extensions/**, templates/**, packages/*/README*.md and the root README.md (exactly the verify-docs discovery band), taken from the checkout root.

- DOC-H1 @ 2026-11-03T04:28:53Z: a64444f9b757da87d17959223e002220e66971dd6de3ea5dd511a3c64c6a300b
- (50 s settle window)
- DOC-H2 @ 2026-11-03T04:29:43Z: a64444f9b757da87d17959223e002220e66971dd6de3ea5dd511a3c64c6a300b  (identical)
- gate docs @ 2026-11-03T04:30:05Z -> ev-20261103T043005-3706a1  exit 0
- DOC-H3 @ 2026-11-03T04:30:11Z: a64444f9b757da87d17959223e002220e66971dd6de3ea5dd511a3c64c6a300b  (identical after the gate run)

The whole-tree fingerprint moved during the first settle window because another seat was writing
docker/QA logs (files outside the docs band); the DOC-SET fingerprint is the settled measurement
the docs gate was taken on, and it did not move.

## Gate summary (from 00-gate-docs-exit0.log)
```
[verify-docs-parity] links=500 checked=470 resolved=470 dead=0 exemptProvenance=0 absentSite=0 ignoredExternal=24 ignoredAnchorOnly=6 files=131

[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=55 failed=0 violations=0 exempt=24 derived=3 links=500 dead=0 — PASS
$ node scripts/verify-docs-parity.ts
```
