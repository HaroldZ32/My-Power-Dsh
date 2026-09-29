# mpd-mcp-codegraph

**English** | [中文](./README.zh-CN.md)

Offline-built MCP server that serves the CodeGraph tool surface
(`mcp__codegraph__*`). Wrapped by the bundle's `mcp-codegraph` row
(`@deepseek-ai/dsh-mcp-client`, serverName `codegraph`, stdio).

## What it does

- `launch.ts` is the row's entry point (B8). It resolves the binary
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
  vendor gate (`scripts/verify-vendor.ts`), so a marked delta there would either fail
  the gate or turn it into a self-attestation
  (`evidence/wave3/registry-redesign/t1-decision-record.txt` §A4).
- **A LOAD failure of the prebuilt degrades too (host defect, measured 2026-09-22)**: the artifact
  evaluates `var ACCOUNT_HOME_DIR = userInfo().homedir` at MODULE LOAD, so on a host where libuv's
  `uv_os_get_passwd` fails it throws `SystemError: ... ENOMEM` before it can answer one frame - and a
  dying MCP child took the whole bundle's boot down with it (the web app never served). `launch.ts`
  therefore wraps the `import` and, on failure, answers the handshake itself as the UNAVAILABLE server
  (0 tools, the reason on stderr, exit 0), so the session boots and the cause stays readable. Same
  rule as above: the delta lives in the launcher, never in the sha-pinned prebuilt.
- **Shared-daemon policy (`daemon-policy.ts`)**: the adopted server can serve a session from a
  per-project-root SHARED daemon (`<projectRoot>/.codegraph/daemon.{sock,pid}`) or from its own
  in-process engine. The daemon is lost for reasons the session cannot control — upstream reaps it
  after 30 idle minutes even with a client attached (`DEFAULT_MAX_IDLE_MS`), a `codegraph daemon`
  stop SIGTERMs it, and the pid-liveness rendezvous cannot be trusted from a PID namespace — and the
  lost connection is reported as `[CodeGraph MCP] Shared daemon connection lost; serving this session
  in-process (degraded), re-serving 0 in-flight request(s).` This bundle therefore defaults to
  **in-process serving** (no daemon, no line; `.codegraph/codegraph.db` is still shared between
  sessions — only the engine/watcher is per session). `MPD_CODEGRAPH_DAEMON=1` restores upstream's
  shared daemon, `=0` states the default explicitly, and an explicit `CODEGRAPH_NO_DAEMON=1`
  (upstream's own opt-out) is never overridden. The launcher applies the policy BEFORE importing
  `dist/serve.js`, because the vendored bridge freezes the child env at load time.
- Pair with `mpd-codegraph-plugin` (project index init) and `mcp-codegraph` row.

## Proof

`evidence/wave3/codegraph-degrade-and-applytime/` — `degrade-launcher.mjs` drives the
real MCP child with the genuinely read-only `$HOME/.mpd`: the pre-fix launcher dies
uncaught with `ENOENT: ... mkdir '<home>/.mpd/codegraph'` and answers no MCP request,
while the fixed launcher exits 0 and answers `initialize` / `tools/list` (0 tools).
`evidence/mpd-defects-2/raw/codegraph-daemon-probe.ts` is the two-sided daemon proof: arm A
(default) answers `initialize`/`tools/call` from its own engine with NO daemon artifacts and no
`Shared daemon` line, while arm B (`MPD_CODEGRAPH_DAEMON=1`) takes upstream's daemon path.

## Usage

```bash
node scripts/pack-mpd.ts   # bakes dist/serve.js + launch.ts into the bundle
```

The bundle patch row config:

```yaml
- id: mcp-codegraph
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: codegraph
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-codegraph/launch.ts]
    toolCallTimeoutMs: 60000
```
