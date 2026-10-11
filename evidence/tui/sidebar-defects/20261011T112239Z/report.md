# Writer A — fix/sidebar-defects lanes D1/D2/D3 — evidence index

Contract: `.mpd/plans/fix-sidebar-defects.md` (frozen). Branch `fix/sidebar-defects` @ `2bf951f9`.
Every claim below has its raw log in this directory; `result.json` carries the machine-readable form.

## What changed (13 files, all inside Writer A's scope)

| File | Symbols |
|---|---|
| `packages/mpd-tui-adapter-plugin/src/index.ts` | `PanelEnableMerge{kept,pruned}`, `panelSlugOf`, `panelTokenIsStaleMine`, `normalizePanelCsv`, `mergePanelEnableIds` (prune + read-back), `createPanelEnableKeeper.decide` (write when `added‖pruned`, post-write read-back) |
| `packages/mpd-tui-plugin/src/panel-core.ts` | `normalizeWheelDelta` (ONE sign decision), `setWheelInvertRead`, `wheelInvertOn`, `scrollByWheel`/`scrollByWheelX` (+`invert`), `usePanelViewport.onWheelX` routed through `scrollByWheelX` |
| `packages/mpd-tui-plugin/src/scenes.ts` | graph `onWheel` — both axes through `normalizeWheelDelta` |
| `packages/mpd-tui-plugin/src/settings.ts` | `WHEEL_INVERT_KNOB`, `wheelInvertFrom` |
| `packages/mpd-tui-plugin/src/index.ts` | row config `wheelInvert` (default `false`) + the reader installed at apply |
| `scripts/mpd-tui-panels.ts` | `PanelMerge{kept,pruned}`, `panelSlugOf`, `panelTokenIsStaleMine`, `mergePanelIds`, `blockPanelCsv`, prune-only runs, post-write document read-back |
| `packages/mpd-tui-plugin/test/panel-visibility.test.ts` | 5 new D1/D3 keeper+script arms |
| `packages/mpd-tui-plugin/test/panel-dag.test.ts` | 5 new D2 arms |
| `packages/mpd-tui-plugin/test/plugin.test.ts` | the config-default arm enumerates the new `wheelInvert` key |
| `docs/tui.md`, `docs/tui.zh-CN.md` | §3.3 prune + read-back semantics; §6.2 the `tui.wheelInvert` knob and its bound |
| both `dist/index.js` | rebuilt with the PINNED toolchain (`.toolchain/node_modules/.bin/bun`, 1.4.0) from the repo root |

## Red → green

* `red-before-fix.log` — `bun test` **exit 1**, 5 assertion-level D1/D3 failures with their Expected/Received
  diffs, plus the D2 module-load failure (`SyntaxError: Export named 'wheelInvertFrom' not found …`).
* `bun-test.log` — **502 pass / 0 fail**, exit 0.

## Gates (all from the repo root; log files in this directory)

| Gate | Exit | Result |
|---|---|---|
| `bun test packages/mpd-tui-plugin packages/mpd-tui-adapter-plugin` | 0 | 502 pass / 0 fail |
| `bun run typecheck` | 0 | tsgo --noEmit, no diagnostics |
| `bun run verify:comments` | 0 | VERDICT: PASS |
| `node scripts/verify-dist-fresh.ts` | 0 | 31/31 fresh (pinned bun 1.4.0) |
| `bun run verify:docs` | 0 | pairs=47 failed=0 violations=0 |
| `bun run verify:rows` | 0 | 35 row ids match the patch layer |
| `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | 0 | 32 rows conform, negative controls 4/4 reddened |
| `node scripts/mpd-tui-panels.ts --self-test` | 0 | SELF-TEST PASS (10 new D1/D3 arms) |
| `node skills/dsh-qa/scripts/tui-panels.ts --self-test` | 0 | 8 surfaces asserted, negative controls fail |
| `node skills/dsh-qa/scripts/tui-panels.ts` | 0 | **SKIP — NOT A PASS** (`reason=absent-fixture`) |
| `bun skills/dsh-qa/scripts/tui-mount.ts … --install` | 1 | `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK … Read-only file system (os error 30)` |

## Bounds the verifier must weigh (full text in `result.json` → `bounds`)

1. The real QA lane did **not** run — its fixture cannot be installed in this session's file sandbox.
2. The host PanelBar carousel ORDER is unpatchable here; D1 removes only the ids with no panel behind them.
3. The top panel-switching wheel lives in the host's PanelBar; the paths fixed here are the ones that route
   through this bundle.
4. `tui.wheelInvert` has **no `/settings` row** — `packages/mpd-config-plugin/src/settings-schema.ts` is
   outside this lane's write scope. The file layer works and is proven against the real `loadConfig`.
5. The prune is scoped by OUR slug (documented reading of the contract's two clauses); a foreign
   `act<N>:<their-slug>` id is preserved, never dropped.
6. A CSV naming a CURRENT id of ours plus stale ones is still left alone (stand-down unchanged).
7. The M4 Docker lane is the captain's step and was not run here.
