# mpd-codegraph-plugin

CodeGraph (repository/code intelligence index) integration: resolves the `codegraph`
binary, auto-initializes a project index on boot, and exposes the `/mpd-codegraph`
command for manual (re)runs.

## What it does

- Binary resolution order: `config.binary` → `MPD_CODEGRAPH_BIN` env → the bundle's
  optional dependency (`@colbymchenry/codegraph` in `node_modules/.bin`).
- At apply: if `autoInit`, runs `codegraph init` in the workspace with a timeout;
  skips when the binary is missing, when initialization cooldown is active, or when
  auto-init is disabled (reports a one-line status).
- Skips the user home as a project (avoids indexing the whole machine); use a real
  project directory, `MPD_DSH_CODEGRAPH_PROJECT_CWD`, or `/mpd-codegraph`.
- Registers the `/mpd-codegraph` command when a command registry is present.

## Config

| Key | Type | Default |
|---|---|---|
| `autoInit` | boolean | `true` |
| `initTimeoutMs` | number | `60000` |
| `cooldownMs` | number | — |
| `binary` | string | resolved per above |

## Env

- `MPD_CODEGRAPH_BIN` — explicit binary path (upstream vendored code reads it too).
- `MPD_DSH_CODEGRAPH_PROJECT_CWD` — project root override.

## Usage

No model tools; the MCP companion row `mcp-codegraph` exposes
`mcp__codegraph__*`. The `codegraph` MCP row's `command` env uses
`MPD_DSH_CODEGRAPH_CLI || <pkg>/packages/mpd-mcp-codegraph/dist/serve.js`.
