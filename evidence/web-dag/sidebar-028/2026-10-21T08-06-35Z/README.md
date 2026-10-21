# Wave evidence — web-dag-sidebar-028

Code: `feature/web-dag-sidebar-028`, final repair commit `defa50ea` (first feature commit `6e89d619`; visual repair `83796fb4`; docs images `e0b3ab22`, v2 cache-bust URLs `fbea3917`).
Frozen contract: [`contract.md`](./contract.md) (copy of `.mpd/plans/web-dag-sidebar-028.md`).

This root is the measured-evidence deliverable the contract's DoD and AGENTS.md §4/§5 require.
The contract's clause matrix is below; the command log is [`output.log`](./output.log), the
real-browser capture is [`docker-post-fix/`](./docker-post-fix/), and the pre-fix defect record is
`../2026-10-21T07-40-13Z/docker/`.

Independent verifier: **PASS** — final record `rec-20261021T090546-abad35` for loop
`loop-20261021T070931-850b4a`. The verifier re-ran the nine fixed-table gates on the final tree
(tests 2194 pass, 3 skip, 0 fail; `gates/` holds the logs) and inspected the post-fix stills and the
refreshed docs images.

CodeRabbit reconciliation (commit `defa50ea`): **F1** reduced-motion flow overlay **FIXED** (the
`[data-mpd-flow]` SMIL arrow is hidden under `prefers-reduced-motion`, while the static path and
arrowhead stay visible); **F4** cancelled-task finish stamp **FIXED** (`cancelled` now deletes
`finishedAt`, so a prior finish cannot survive). **F2** crossing-gutter lane registration and **F3**
geometry cache + ticker gating are recorded as **STILL-VALID follow-ups** (non-blocking width/perf
cleanups; the property battery and UI checks are green). The final post-repair verifier record is
`rec-20261021T090546-abad35`: 2194 gate tests pass (986 in the four-package suite).

## Clause-to-evidence matrix

| Clause | Evidence |
|---|---|
| better-sidebar pinned at 0.28.0 (devDep, optional peer, pack pin, lock) | `package.json`, `bun.lock`, `scripts/pack-mpd.ts`; `packages/mpd-better-sidebar-host/test/host-contract.test.ts` reports the installed host 0.28.0 and the `["webServer","sessions","connection","tools"]` inject list; `bun run verify:rows` (35 ids) and `bun run verify:manifest` PASS |
| Secondary adaptation: both primary (better-sidebar) and bottom-workbench twins, plus the official-right-sidebar fallback | `packages/mpd-bundle-plugin/test/sidebar-tab.test.ts` (primary ids, `:bottom` twins, `bottomOnly`, betterSidebar-only placement, fallback still registers); docs/user-guide.md §8; host-contract arms |
| DAG columns centred on the horizontal midline | `packages/mpd-bundle-plugin/test/team-view.test.ts` D1 arms (`centerY`, stack centre, one-row column top 4) and the 8-board × 2-rank-source property battery |
| Long edges routed through mirrored top/bottom bands, never through a node card | same D1 arms + the battery's box-invasion assertion; `docs/user-guide.md` §8.1 |
| No overlapping straight connector segments | `overlaps === []` on the battery + `TASKS`/`LONG_EDGE_TASKS`/`CYCLE_TASKS`; the D1 port/lane parity proof; the fan-in port pitch is 12px for 2–4 incident edges (5–6: 8px) and a 2-incoming arm asserts a ≥10px tip gap with disjoint 8px arrowheads |
| Dynamic layout change | node `translate3d` transition (420ms) + recomputation from the served state; D2 CSS/transition arms |
| Completed → running animated directional arrow | `animateMotion` arrow overlay + 6px dash flow; D2 flow-only-completed→running arm; real-browser `docker-post-fix/ui-shots-cjk/06b-team-board.png` (T1 completed → T3 running) |
| Frosted-glass node cards | scoped CSS gradient + `backdrop-filter: blur(14px) saturate(1.25)` + inset highlight/outer shadow; D2 CSS arms; `docker-post-fix/ui-shots/06b-team-board.png` |
| Running-node breathing without harming text | keyframes animate only `box-shadow`/`border-color`; reduced-motion disables it; D2 CSS arms; `06b-team-board.png` (T3 running glow) |
| Hover card: status, owner, elapsed, rough task, progress; beside the cursor | D2 card arms (content, truncation, clamp, pointer-derived position); real-browser `07-team-graph-hover.png` in both boards shows the card next to the pinned node |
| Click → next hover opaque; mouse leave closes | D2 pin-opacity and mouseleave arms; the post-fix stills show the opaque pinned card; the pre-fix focus-anchor defect was repaired (focus no longer invents `(14,14)`) |
| Existing features preserved | full affected suite 986 pass / 0 fail; the real-browser capture 18/18 checks and 9/9 steps; click-to-pin detail still renders in the stills |
| `startedAt` / `finishedAt` and coarse progress | `packages/mpd-team-core-plugin/test/team-store.test.ts` transition matrix; `test/team-web.test.ts` payload/omitted-undefined/progress mapping; docs/user-guide.md §8.1 declares the coarse 100/50/10/0 mapping |
| Docs images refreshed to the new UI | `docs/assets/images/web-team-board-v2.png` + `hero-web-tui-v2.png` (EN) from `docker-post-fix/ui-shots/07-team-graph-hover.png`; the zh pair from `docs-capture-zh/07-team-graph-hover.png`; README/README.zh-CN and docs/index descriptions updated in the same commit (the `-v2` names also cache-bust GitHub's README image proxy) |

## Gate and boot results

- `bun test packages/mpd-bundle-plugin packages/mpd-team-core-plugin packages/mpd-tui-plugin packages/mpd-better-sidebar-host` → **986 pass, 0 fail** (after the CodeRabbit repairs).
- `bun run typecheck` → exit 0.
- `bun run verify:gates` → **9/9 members green** (vendor, dist freshness, row parity, doc pairs, preset conformance, plugin manifest, comment coverage, graph model, workflows).
- `bun run verify:docs` → pairs 48, failed 0.
- `bun run verify:comments` → 426 files, PASS.
- `node scripts/verify-vendor.ts` → all 7 assets fingerprinted, including the rebuilt `client.js`.
- `node skills/dsh-qa/scripts/preset-conformance.ts` (real) → PASS; evidence `../../../dsh-qa/preset-conformance/2026-10-21T07-33-58.879Z/`.
- `bun skills/dsh-qa/scripts/bundle-lifecycle.ts` → PASS (install, mount, no home copy, uninstall no residue); evidence `../../../dsh-qa/bundle-lifecycle/2026-10-21T07-34-29.585Z/`.

## Real-browser Docker evidence

- Declared `node scripts/docker-e2e.ts --mode source --require-docker --require-browser` on `6e89d619` exited **3** because `ui.replyRendered` is a credential-free declared bound (`MISSING_CREDENTIAL`). It is **not a pass**; see `../2026-10-21T07-40-13Z/docker/docker-report.md` and `docker-report` in that directory.
- The repository's UI-capture lane (the one that writes 07/08) ran on the pre-fix commit: **18/18 checks, 9/9 steps, exit 0**, but its stills exposed two visual defects: the hover card parked at the viewport top-left after click/focus, and two fan-in arrowheads merged.
- After the repair (`83796fb4`), the same lane ran again on a freshly rebuilt image: **18/18 checks, 9/9 steps, exit 0**; see `docker-post-fix/` and its report. The stills show the card beside the node, the 12px fan-in separation, the stronger glass/glow and the readable flow dash.
- The two `pack.*` false rows in the pre-fix declared e2e are stale local `dist/mpd-package` artifacts; the pack was refreshed after the repair. They are not a code failure.

## Honest bounds

- No live model reply: `ui.replyRendered` is a declared bound; the team fixture is seeded, so the graph/hover checks are real-browser checks, not a live model turn.
- A still frame proves the presence of the glow, glass, card and animated elements, not their motion; the SMIL/dash animation is asserted structurally in tests.
- Progress is a coarse status-derived value (completed 100, running 50, claimed 10, pending/failed/cancelled 0), not measured work. Legacy tasks without `startedAt` show a dash for elapsed time.
- The zero-overlap proof is the rank-parity channel plus the generated battery; the documented capacity bounds are ≥21 incident ports, >47 crossing lanes per gutter and >23 same-rank lanes, where `laneOverflow`/`overlaps` report the breach. 5–6 incident edges use an 8px pitch whose outermost arrowheads can touch at the ±20 clamp.
- No zoom/pan/minimap in this wave; no graph-layout library. The layout is computed by the bundle.
- Better-sidebar bottom-workbench registration is proven by source-contract tests and a real preset/host boot, not by a screenshot of the bottom surface; the right-sidebar capture is the visual proof for the shared body.
