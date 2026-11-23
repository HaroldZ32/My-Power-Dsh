# T0.2 independent verification

**PASS** on the repaired CLI and proposed public capture packet. Record `rec-20261123T060159-e852a2`, loop `loop-20261123T055003-c65b1f`. The earlier failure `rec-20261123T054921-b701cd` identified non-finite estimates and silently replaced malformed UTF-8. Both controls now pass on CLI SHA-256 `368b7933b423733f8b18fd98f4ef2b814af7e3e732b669a7a434f45859fc8f9e`.

| Capture | Tools | Compact schema bytes | Estimated tokens at 4 bytes/token |
| --- | ---: | ---: | ---: |
| October 27 historical main turn | 117 | 93,189 | 23,297.25 |
| November 23 original integrated member | 125 | 127,489 | 31,872.25 |
| November 23 independent dev-based feature member | 125 | 126,888 | 31,722 |

Independent byte counting of both original headers confirmed all family sums, array framing, 15 added names and seven removed names. The original report reproduces byte for byte at SHA-256 `c8ed2f548a4eaecbf7bc9032b1a4bc2ac2aa4dbc5eaef4e97bfe787102156546`. The two November tool lists have the same names and different schema definitions.

The independent feature run materialized the dev-based tracked checkout at `eeec38a9f76fbbae9cd4dcf8db9630f5ab80b0db` and added the proposed packet and CLI. The pinned tools and installed checkout dependencies were available; the earlier November investigation driver was absent. At `2026-11-23T06:01:01.898Z` a fresh isolated `mpd-headless` boot on DSH `0.2.2-rc.5` produced a Senior Engineer request at sequence 13. Its own `agent_teams_task` call at sequence 24 completed T1. The native result at sequence 25 matched the call and the board recorded that executor's task complete. The `mpd` preset row was declared and pending on `agentPresets`. The host mounted the Team tools for the headless profile. Source and distribution inventories before and after matched at SHA-256 `5cdc8b2e7cc5039d3e3ceec46a0bc068e1f994f36efc04daaea24dd2ba190bf4`. The compact fresh tool array hashed to `4e2c817fee0b231f9249e4f96f61a5d057df987e8a35a731e877ac892d067868`.

The independent CLI controls covered a lone `ff` byte on each input side, an intentionally encoded U+FFFD, emoji, missing and truncated files, ordinary and fractional ratios, and a `1e-320` ratio. Overflow now yields `UNMEASURED` and exit 3. Where only one side overflowed, the representable side kept its measured numeric result. The integrated fixed typecheck and declaration-comments gates passed (`ev-20261123T055914-41ba6c`, `ev-20261123T055915-5db42a`).

Use a **Git checkout** containing the packet and its tracked historical header for replay. `git archive` omits the historical header via `export-ignore`. The mounted replay needs installed project dependencies, Node `v24.21.0`, Bun `1.4.0` and DSH `0.2.2-rc.5`; point `PINNED_BUN` and `PINNED_DSH` at those binaries. The saved comparison needs only Node and the checked-in inputs. [Replay commands](./replay.md) · [Repair controls](./repair-controls.md)
