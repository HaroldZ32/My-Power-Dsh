# Final canonical stage follow-up

The canonical relocatable stage was rebuilt from clean `fix/team-and-audit-recovery` commit `b261da2ae5dff4c46fdd97c826a6441b303c6037` after the packaging and corrected Team follow-ups. The packer destination resolved to the repository's `dist/mpd-package` directory. The explicit closure stamp was `2026-11-22T17:31:03.867Z`. This follow-up covers the stage consumed by the separate rootless Docker lane. The tracked-only npm archive is owned by its separate verification lane.

| Check | Exit | Observation |
| --- | ---: | --- |
| Pinned dist freshness | 0 | Bun 1.4.0 rebuilt all 35 covered targets twice with byte-identical outputs. The CodeGraph prebuilt remains the sole uncovered target. |
| Vendor verification | 0 | All eight shipped asset fingerprints matched the committed lock. |
| Canonical pack and strict closure | 0 | 30/30 packages present, 672/672 files identical, zero drift, zero post-pack changes, zero absent files. The declared roles-probe exemption was exercised. |
| Actual Docker pack assertion module, run locally | 0 | The NDJSON rows for presence, license, declarations and static coherence each explicitly recorded `true`. All 680 file declarations, two patch layers and 29 row module paths resolve. Static comparison found 683 identical files and the two declared generated exceptions. |
| Closure `--self-test` | 0 | 43/43 arms passed. |
| Manifest `--pack` and `--self-test` | 0 | Dry-run packlist 1,272 files with zero required paths absent and zero runtime-state paths leaked. The self-test exercised an actual npm pack fixture. |

The previous canonical stage reproduced `pack.declarationCoherence=false` under the same Docker assertion module. The two from-source rebuild rows in the local assertion run were `null` because the local invocation supplied no container rebuild witness. The rootless lane received the exact frozen commit and stage fingerprints for its own runtime verification.

| Staged file | SHA-256 |
| --- | --- |
| Package manifest | `832d1a6bd5c3bea07c659072800afc111108e993baa67e561fcb32180dea7b3a` |
| Team core distribution | `42082155f6d629e6be2542232318d33224b77eac3d5e8e8f76f9266b2752bb7f` |
| Roles distribution | `179c9e46b31ef32594d86ff5892d8dd60c2b1ffc654e9cdf4d9b86816d6cc2fb` |
| Combined Web client | `c5be0607ff2dc360b52c5357fe0af3e3c473cf0c6c77d343481b1c0e220000cb` |
| Vendor lock | `76703fca6600333e84ec91824f76a75c5bd78720700d85166dc196d535db1ccc` |

[Raw declaration and stage verification digests](./canonical-stage-logs.sha256)
