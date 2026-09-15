# Ledger citation (t6)

The per-package compatibility ledger reproduced in docs/tui.md and docs/tui.zh-CN.md (§8) is t5's measurement, cited verbatim.

| field | value |
|---|---|
| path | evidence/tui/composition/20260915T053445Z/ledger.json |
| generatedAt (in file) | 2026-09-15T05:54:03.989Z |
| sha256 | a292c88b95c8cf1f0566fa8a13e3276e2447db44079834554bb7178686974bf3 |
| human summary | evidence/tui/composition/20260915T053445Z/ledger.md (sha256 02c9cce61e1fdaeb9ead979eaf6c6703817bcb4511746aa413eecf85674704ab) |
| counts (in file) | usable 22 / inert 2 / web-only 1 / total 25 |

No package was re-classified by t6: AC-12 is t5's measurement and is re-checked by t8.

Staleness disclosed in the docs: the ledger recorded mpd-tui-plugin dist sha256 695f68c4858745cc35544ac77dbdb87907d6991c62f9435661e1fc02264f77ac; the built artifact is now 710d3eef5d0f451bff220da151f45c9ccccb5b264ecfc215ce61be8b667e9fc3 (rebuilt by the t21 follow-up for the /settings disclosure), so the ledger's plugin hashes are stale for the current revision while its composition observations stand.
