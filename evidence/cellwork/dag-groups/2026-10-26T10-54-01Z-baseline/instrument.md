# W4 verifier instrument — declared BEFORE the rows freeze

Seat: w4-verifier. Basis: `.mpd/plans/cellwork-w4-contract.md` (frozen 2026-10-26T10:02:00Z), the plan
`.mpd/plans/cellwork.md` §4.13 and Wave 4, the five package README pairs, `docs/tui-dag-renderer.md`,
gate output and the BUILT artifacts. No `src/**` read before a FAIL is recorded.

## Pre-wave facts (this directory, HEAD 6171fd7e, taken 2026-10-26T10:54:01Z)

| fact | value / evidence |
|---|---|
| no-groups model (real W3 board + W3 plan) | `model-nogroups.json`, 3057 bytes, sha256 `3e006a42e29c3f3ebbf5459363cbbabb138589a2d88d4c93c0c66762b460f4d8` |
| graph-model gate arms | 8 arms, all PASS (`gate-selftest.log`) |
| dist / client.js hashes | `dist-sha256-pre.txt` |
| `client.js` group tokens | `grep -c 'mpd-dag-group'` = 0 |

The no-groups model is the BACKWARD PIN: after D1 lands, the same two inputs must emit bytes whose
sha256 is `3e006a42…` with no `groups` key added. A byte difference (including an added `groups: []`)
is a D1 finding.

## Method per row (frozen here so it cannot be fitted to results)

1. **Freeze check.** The writer's mail names its hashes; I compute the same scope hash myself and
   require start == end around a 50 s settle window (AGENTS.md §7). A moving scope invalidates the batch.
2. **Hash sandwich.** `sha256sum` over every file in the row's scope, sorted; start, post-settle, end.
3. **Seat rebind** with `mpd_verify_seat` immediately before the gate batch.
4. **Gate batch** through `mpd_verify_evidence` (`tests`, `typecheck`, `comments`, `dist`, `docs`) plus
   the row-specific commands: `node scripts/verify-graph-model.ts --self-test` and its `--help`, the
   backward A/B emit, `bun run verify:docs`, `bun run verify:rows`, `bun run verify:manifest`,
   `node scripts/verify-no-host-override.ts`, `node scripts/install-profile.ts --dry-run`.
5. **Observable claims only.** Every claim in the row is mapped to something a black-box run shows:
   gate arm names and counts, emitted-model bytes, dist/client.js bytes, README/doc text, test arm names.
6. **Declare the bounds**: what I did not read and could not run.
7. **Record** through `mpd_verify_record` against the frozen contract, then `complete` the board row and
   mail the writer the verdict.

## Row claim → evidence map

### T4 (D1, loop 98c855) — graph-core group model
| claim | evidence |
|---|---|
| `GraphModel.groups?` optional, plain JSON, deterministic | emitted model round-trips; group gate arm; determinism arms |
| backward pin byte-identical | A/B against `model-nogroups.json` |
| attachment rule: inside/outside re-anchor to innermost frame, fully-inside stays, group→group, derived spawn edge | group arm output naming the branches + a seeded negative that is REFUSED |
| per-level ranking, recursion deterministic | gate/determinism arms; outer rank unaffected |
| gate gains group arm AND seeded negative, `--self-test` proves both directions | arm count > 8, negative exits non-zero naming the defect |
| README pair updated | both README.md and README.zh-CN.md name groups; `verify:docs` green |
| no Map/Set/class instance | emitted JSON + round-trip equality |

### T5 (D2 + D5, loop 5dd885) — team projection + cellwork seam
| claim | evidence |
|---|---|
| `TeamRecord.parentTeamId?` additive; absent = root; readers tolerate both | team-core arms; a legacy record still loads |
| **the SEAM is NAMED** (explicit `parentTeamId` on create/edit, or implicit derivation) and the report + record name it | writer's report text + the record's notes |
| create accepts `parent_team_id`, Lead-authorized, validates existence/liveness/cycle | arm names + refusal arms |
| depth cap stays cellwork's | team-core refuses no cap; cellwork's depthMax still fences |
| `mpdTeams.graph` merges descendants recursively; `/state` carries `groups`; per-task `rank` stays OUTER | route/README text + arms |
| two-level, three-level, determinism, no-children backward | arm names + emitted state |
| D5: cellwork passes `parent_team_id` on sub-team staging; depth fence intact | cellwork arm names + README pair sentence |

### T6 (D3 + D4, loop d3552b) — TUI glyph frames + web canvas
| claim | evidence |
|---|---|
| second glyph border family, distinct, one cell per glyph | `DAG_CHARS_ONE_CELL` arm; glyph literals in the built dist are single code points |
| group frame spans interior rows; crossing edge ≠ terminating edge; `GraphHit` group identity | TUI arm names |
| never half a group; width guard collapses to rail/list | arm name + degraded-mode arm |
| web `.mpd-dag-group`, ONE canvas, `overlapAudit` + no-run-crosses-a-box extended, z-order, ports | built `client.js` grep + source-test arm names |
| **the BUILT `client.js` carries it** | `grep -c 'mpd-dag-group'` > 0 in `packages/mpd-bundle-plugin/client.js`, hash ≠ pre-wave |
| built-artifact test exists on `test/client-harness.ts` | bundle test arm names, green |
