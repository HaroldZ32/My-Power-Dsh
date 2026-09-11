# mpd-mcp-codegraph

**English** | [中文](./README.zh-CN.md)

Offline-built MCP server that serves the CodeGraph tool surface
(`mcp__codegraph__*`). Wrapped by the bundle's `mcp-codegraph` row
(`@deepseek-ai/dsh-mcp-client`, serverName `codegraph`, stdio).

## What it does

- `launch.mjs` is the row's entry point (B8). It resolves the binary
  **bundle-relatively** — a caller env pin → `createRequire` of the
  `@colbymchenry/codegraph` optional dependency (packed layout; the package's own `bin`
  entry, e.g. `npm-shim.js`) → `<bundle>/.toolchain/node_modules/.bin/codegraph`
  (checkout `link:` install) — sets `MPD_CODEGRAPH_BIN` only when the caller left it
  unset, then calls `runCodegraphServe()` from `dist/serve.js` (built at pack time from
  the vendored prebuilt codegraph dist; see `packages/mpd-mcp-codegraph/LICENSE` +
  `NOTICE`).
- Why the launcher and not the row env: a **wrong** `MPD_CODEGRAPH_BIN` is returned by
  the adopted resolver even when the file does not exist, which hard-blocks its
  bundled → provisioned → PATH → download chain.
- **Degradation (F-B8-1, wave 3)**: if `runCodegraphServe()` THROWS — the measured
  case is an unresolvable binary with an unwritable state directory, where
  `ensureCodegraphProvisioned` calls `acquireLock(...)` *before* its own try/catch and
  `mkdir(<home>/.mpd/codegraph/.locks)` fails — the launcher prints the error to
  stderr, pins `MPD_CODEGRAPH_BIN` to a path-looking sentinel that does not exist and
  calls `runCodegraphServe()` once more. The adopted resolver then takes
  `source: "env"`, `provisionMissingCodegraph` returns null at its first guard, and the
  child stays alive as the unavailable MCP server (0 tools, the skip hint on stderr,
  exit 0) instead of dying uncaught. The retry runs only while nothing has been written
  to stdout (the MCP protocol owns it). The degradation lives in the launcher, NOT as a
  delta inside `dist/serve.js`: that file is a sha-pinned prebuilt behind the blocking
  vendor gate (`scripts/verify-vendor.mjs`), so a marked delta there would either fail
  the gate or turn it into a self-attestation
  (`evidence/wave3/registry-redesign/t1-decision-record.txt` §A4).
- Pair with `mpd-codegraph-plugin` (project index init) and `mcp-codegraph` row.

## Proof

`evidence/wave3/codegraph-degrade-and-applytime/` — `degrade-launcher.mjs` drives the
real MCP child with the genuinely read-only `$HOME/.mdp`: the pre-fix launcher dies
uncaught with `ENOENT: ... mkdir '<home>/.mpd/codegraph'` and answers no MCP request,
while the fixed launcher exits 0 and answers `initialize` / `tools/list` (0 tools).

## Usage

```bash
node scripts/pack-mpd.mjs   # bakes dist/serve.js + launch.mjs into the bundle
```

The bundle patch row config:

```yaml
- id: mcp-codegraph
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: codegraph
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-codegraph/launch.mjs]
    toolCallTimeoutMs: 60000
```
