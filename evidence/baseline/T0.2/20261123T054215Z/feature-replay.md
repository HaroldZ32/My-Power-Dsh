# Feature checkout replay receipt

The replay ran in the dev-based `feature/v2-wave0-baseline` checkout at `eeec38a9f76fbbae9cd4dcf8db9630f5ab80b0db` with the candidate replay files. This checkout lacked the old November 23 investigation driver. Node `v24.21.0` reproduced the saved comparison byte for byte from the branch’s own inputs. The live replay used DSH `0.2.2-rc.5` and Bun `1.4.0` from the local toolchain installation. The `mpd-headless` boot reported the declared `mpd` preset pending, and mounted the Team tools used in the live case.

| Input or result | Tools | Compact UTF-8 bytes | Estimated tokens at 4 bytes/token |
| --- | ---: | ---: | ---: |
| Saved integrated working member | 125 | 127,489 | 31,872.25 |
| Fresh dev-based feature working member | 125 | 126,888 | 31,722 |
| Saved October 27 main turn | 117 | 93,189 | 23,297.25 |

The two November tool-name sets were identical. Team `control` and `plan`, Cellwork `open`, `send` and `supervise`, `mpd_memory_reflect_complete`, and `mpd_role_spawn_async` differed in their serialized definitions. Their byte changes sum to −601. This run measures the dev-based worktree’s tool schemas and does not replace the integrated-build capture.

The harness created Senior Engineer seat `M1` on `team-20261123055510698-lal5-002`. In session `faf8ae84-f072-479a-91aa-bdb55d00e334`, turn 1, `request/header` sequence 13 at `2026-11-23T05:55:10.863Z` preceded `agent_teams_task` completion for `T1`. Call sequence 24 and result sequence 25 shared ID `qa_surface_8`. The result had `isError: false`. The board recorded `T1` as `completed`. The isolation check resolved exactly one sandboxed workspace key. The probe retained these coordinates and discarded task and prompt contents from the public receipt.

| Artifact | SHA-256 |
| --- | --- |
| Fresh tool-only header | `94e77c6b35ef6bc1f5e1fd84ceeb41cfe08993e3244272077629f26a28723617` |
| Fresh source/distribution inventory before and after | `5cdc8b2e7cc5039d3e3ceec46a0bc068e1f994f36efc04daaea24dd2ba190bf4` |
| Feature Cellwork dist | `be2ce454979504c70827d56d4b4b27d3e37f6797fd907182892b02e8421e266d` |
| Feature adapter dist | `f6e29ac2da8deca15d4be262a2bc301e66e44880754b28568a1cd272cc18c782` |
| Feature Team dist | `1b729632eeb3660846607b185b66ce373d050e41e541b1e69125defaf7da68fa` |
| Saved November 23 header | `77338388fd069f6c77a03967b2ae3fe02a1fca529e38a72adc35fbf8559e4567` |
| Saved October 27 header | `6ac1e38dcb62043d904ed9d0d06b856e3715d8e6b3285282f25bb21867a67910` |
| Saved comparison | `c8ed2f548a4eaecbf7bc9032b1a4bc2ac2aa4dbc5eaef4e97bfe787102156546` |

`sh capture.sh --self-test`, the pinned `--out` mount, the fresh measurement, fingerprint comparison, shell syntax check, focused declaration comment check, and strict TypeScript check of `capture-driver.ts` each exited 0. Replay commands and tool installation inputs are in [replay.md](./replay.md).
