# Arms — exact commands

All arms use the real built launcher and the real upstream shim. `probe.mjs` is an MCP stdio client
(newline-delimited JSON-RPC): it sends `initialize`, then `tools/list`, prints `VERDICT`/`TOOLS`/
`TOOL_NAMES`, and exits 0 only on a real `tools/list` answer. `CODEGRAPH_NO_DOWNLOAD=1` is set on every
arm so a network self-heal cannot mask a resolution question with a download (the shim honours that knob
itself; the bound this creates is that the container's GitHub reachability was never measured — either
outcome, death or a slow download, produces a child that answers nothing inside the probe window).

Common environment: `env -u MPD_CODEGRAPH_BIN … MPD_MCP_LOG_DIR=<arm dir> HOME=<arm dir>`; the launcher's
own stderr/stdout writers land in `<arm dir>/.mpd/logs/mpd-mcp-codegraph.log`, which each transcript
quotes.

| Arm | Fixture | Launcher | Expected |
|---|---|---|---|
| `armA-incomplete-pin` | a `@colbymchenry/codegraph` copy WITHOUT `@colbymchenry/codegraph-<platform>-<arch>` (the `added 4 packages` shape), pinned from the caller env | fixed `dist/launch.js` | 0 tools; the shim's own "no prebuilt bundle" message in the sink |
| `armB-complete-pin` | the repository's complete `.toolchain` shim, pinned from the caller env | fixed `dist/launch.js` | 1 tool: `codegraph_explore` |
| `armC-checkout-no-pin` | the real checkout tree (NO env pin, so the resolver decides) | fixed `dist/launch.js` | 1 tool: `codegraph_explore` (no regression) |
| `armD0-prefix-head-launcher` | a fake `<bundle>` whose require tier is the INCOMPLETE package and whose `.toolchain` tier is the complete one | the PRE-FIX launcher, `git show HEAD:packages/mpd-mcp-codegraph/dist/launch.js` | 0 tools — the pre-fix resolver pins the broken first candidate |
| `armD-gate-falls-through` | the SAME fixture as `armD0` | fixed `dist/launch.js` | 1 tool — the probe skips the broken candidate and the healthy tier answers |
| `armE-negative-control` | the same fixture with the healthy tier removed | fixed `dist/launch.js` | 0 tools — nothing is pinned; the predicate never invents an engine |

Rebuilding a fixture and an arm (from the repo root; `<arm dir>` is `arms/<name>`):

```sh
LAUNCH="$PWD/packages/mpd-mcp-codegraph/dist/launch.js"
# arm A fixture: a complete shim copy with its per-platform package REMOVED
mkdir -p .qa-tmp/broken/node_modules/@colbymchenry .qa-tmp/broken/node_modules/.bin
cp -a .toolchain/node_modules/@colbymchenry/codegraph .qa-tmp/broken/node_modules/@colbymchenry/
ln -sfn ../@colbymchenry/codegraph/npm-shim.js .qa-tmp/broken/node_modules/.bin/codegraph
env -u MPD_CODEGRAPH_BIN CODEGRAPH_NO_DOWNLOAD=1 \
  MPD_CODEGRAPH_BIN="$PWD/.qa-tmp/broken/node_modules/.bin/codegraph" \
  MPD_MCP_LOG_DIR=<arm dir> HOME=<arm dir> node arms/probe.mjs "$LAUNCH" 20000

# arm D fixture: a fake bundle, broken require tier + healthy .toolchain tier
F=.qa-tmp/fixcheck; mkdir -p "$F/packages/mpd-mcp-codegraph/dist" "$F/node_modules/@colbymchenry/codegraph"
printf '{"name":"@mpd-dsh/mpd","version":"0.16.1"}\n' > "$F/package.json"
cp "$LAUNCH" packages/mpd-mcp-codegraph/dist/serve.js "$F/packages/mpd-mcp-codegraph/dist/"
printf '{"name":"@colbymchenry/codegraph","version":"1.5.0","bin":{"codegraph":"npm-shim.js"}}\n' \
  > "$F/node_modules/@colbymchenry/codegraph/package.json"
cp .toolchain/node_modules/@colbymchenry/codegraph/npm-shim.js "$F/node_modules/@colbymchenry/codegraph/"
ln -s "$PWD/.toolchain" "$F/.toolchain"
env -u MPD_CODEGRAPH_BIN CODEGRAPH_NO_DOWNLOAD=1 MPD_MCP_LOG_DIR=<arm dir> HOME=<arm dir> \
  node arms/probe.mjs "$F/packages/mpd-mcp-codegraph/dist/launch.js" 45000
```

For `armD0`, copy `git show HEAD:packages/mpd-mcp-codegraph/dist/launch.js` into the same fixture shape
instead of the rebuilt launcher; for `armE`, delete `$F/.toolchain` before the run.
