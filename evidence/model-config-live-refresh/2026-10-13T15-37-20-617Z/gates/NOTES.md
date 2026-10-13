# Gate sweep for the AC6 live-refresh repair (evidence index)

Run: 2026-10-13, repo root `/home/haroldzhao/MyProj/DshProj/My-Power-Dsh`,
branch `fix/model-config-live-refresh`.

`summary.txt` carries the sweep's start/end stamps and the exit code of every gate. Each
`*.log` is that gate's complete stdout+stderr from the FINAL sweep (run after the last edit of
the wave's repair). The dist rebuilt for this repair is
`packages/mpd-config-plugin/dist/index.js` sha256
`299c85a81dfc8c396d81a4cf19cc5b3918b54308cdf7084c5294295a143bd12b`, produced with the PINNED
toolchain (`.toolchain/node_modules/.bin/bun`, bun 1.4.0) from the repo root — the GREEN live run
below ran against exactly those bytes (a later comment-only src edit rebuilt to the same sha).

| Log | Command | Exit |
|---|---|---|
| `bun-test-packages.log` | `bun test packages` | 0 — `1894 pass / 3 skip / 0 fail`, 1897 tests / 119 files |
| `test-qa.log` | `bun run test:qa` | 0 — `[test:qa] all self-tests passed` |
| `typecheck.log` | `bun run typecheck` (`tsgo --noEmit`) | 0 — no diagnostics |
| `verify-comments.log` | `bun run verify:comments` | 0 — `VERDICT: PASS`, 396 files / 34910 declarations |
| `verify-dist-fresh.log` | `node scripts/verify-dist-fresh.ts` | 0 — `31/31 targets fresh`, 1 pre-existing NOT COVERED (`packages/mpd-mcp-codegraph/dist/serve.js`) |
| `verify-manifest.log` | `bun run verify:manifest` (contract AC7) | 0 — `VERDICT: PASS`, 976 packed files, 0 required paths absent |
| `verify-docs.log` | `bun run verify:docs` (contract AC7) | 0 — `pairs=47 failed=0 violations=0`, 436 links / 0 dead |

## `negative-control-stale-value.log`

The falsifiability control for the composition. `packages/mpd-config-plugin/src/index.ts`
`readEntryConfig` was TEMPORARILY changed back to `return described.value` (the stale
composition the repair replaces), `bun test packages/mpd-config-plugin/test/live-refresh.test.ts`
was re-run, and the source was restored immediately afterwards.

Result: 5 RED legs, exit 1 — all four pre-existing AC1 cases plus the new
"a MATERIALISED default ... never becomes L4" case. The restored source re-ran 11 pass / 0 fail.

The PRE-FIX live matrix (same stale composition, before the repair) is the sibling run
`../2026-10-13T15-15-39-019Z/result.json`: 4 RED legs (`save ... RESOLVED slot3.model`,
`after-save ... child ran on the SAVED model`, `provider-side ...`, `file-edit (control) ...`).
The GREEN run after the repair is `../2026-10-13T15-37-20-617Z/result.json` (15/15 legs).

## The three live runs under `evidence/model-config-live-refresh/`

| Directory | State | Verdict |
|---|---|---|
| `2026-10-13T15-15-39-019Z/` | BEFORE the repair (`readEntryConfig` still returned `describe().value`) | FAIL — 4 RED legs, `save.resolved="deepseek-v4-flash"` while the save was `deepseek-v4-pro` |
| `2026-10-13T15-35-56-959Z/` | AFTER the repair, BEFORE the case's own stale verdict leg was reworded: that leg asserted the descriptor's resolved VALUE must carry the save, which this harness never does | FAIL — 1 RED leg (`save: the descriptor's RESOLVED slot3.model is the saved model`); the three behaviour legs (after-save child, provider-side, file-edit) were already GREEN |
| `2026-10-13T15-37-20-617Z/` | FINAL: repaired source + reworded verdict leg (asserts the descriptor's SAVED OVERRIDE, `user`) | PASS — 15/15 legs, exit 0 |

`save` packet of the final run, quoted verbatim from `../2026-10-13T15-37-20-617Z/result.json`:
`{"status": 200, "error": null, "resolved": "deepseek-v4-flash", "userSlot": "deepseek-v4-pro",
"baseSlot": "deepseek-v4-flash", "revision": 1}` — the measured reason the layer is composed
from `user`: the save moved `user` only.

## `static-disclosure-checks.log` — the reworded T2/S2 against the REAL built bytes

The lane's two judges were run directly (no boot) over
`packages/mpd-tui-plugin/dist/index.js` and `packages/mpd-tui-plugin/src/settings.ts`:
`evaluateBridge({mode:"static"})` → S1/S2/S3 all ok; `evaluateTuiSurface(...)` → T1..T6, T8 ok.

**T7 is RED and is NOT caused by this repair.** T7 asserts the TUI dist contains none of
`writeFileSync`/`appendFileSync`/`mkdirSync`/`rmSync`; the dist inlines
`mpd-dsh-adapter-plugin` (`packages/mpd-tui-plugin/src/index.ts` imports `createDshAdapter`), so
those names have been in the bundle since before this wave — `git show
HEAD:packages/mpd-tui-plugin/dist/index.js | grep -c writeFileSync` = 3, identical to the working
tree. The TUI dist was not touched by this repair, and the config plugin's `index.ts` is not
inlined into it. This is a pre-existing lane defect (T7 needs to scope its scan to the TUI's own
source), reported, not fixed here.


