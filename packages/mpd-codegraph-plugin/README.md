# mpd-codegraph-plugin

**English** | [中文](./README.zh-CN.md)

CodeGraph (repository/code intelligence index) integration: resolves the `codegraph`
binary, auto-initializes a project index on boot, and exposes the `/mpd-codegraph`
command for manual (re)runs.

## What it does

- Binary resolution order: `config.binary` → `MPD_CODEGRAPH_BIN` /
  `MPD_DSH_CODEGRAPH_BIN` env (exists-checked) → the bundle's optional dependency
  (`createRequire("@colbymchenry/codegraph")`, the packed layout) →
  `<bundle>/.toolchain/node_modules/.bin/codegraph` (B8: the checkout `link:` layout,
  which pnpm never populates with the link package's optionalDependencies — mirrors
  `mpd-comment-checker-plugin`) → PATH.
- At apply: if `autoInit`, runs `codegraph init` in the workspace with a timeout;
  skips when the binary is missing, when initialization cooldown is active, or when
  auto-init is disabled (reports a one-line status).
- Skips the user home as a project (avoids indexing the whole machine); use a real
  project directory, `MPD_DSH_CODEGRAPH_PROJECT_CWD`, or `/mpd-codegraph`.
- Registers the `/mpd-codegraph` command when a command registry is present
  (per-invocation project root, the harness `CommandResult` shape).

## Project root resolution (O-1)

`mpd-codegraph` is the ONE mpd workspace consumer that resolves at **apply** time,
before any session exists, so it cannot take a tool `exec`. It therefore goes through
the shared adapter's workspace plane instead of a bare `process.cwd()` chain
(`packages/mpd-dsh-adapter-plugin`). Order, highest first:

1. `MPD_CODEGRAPH_PROJECT_CWD` / `MPD_DSH_CODEGRAPH_PROJECT_CWD` — explicit override.
   It is also the adopted MCP child's project-cwd env (`serve.js` precedence:
   `MPD_CODEGRAPH_PROJECT_CWD` → session-start cwd → `PWD`), and the child's env is
   frozen when its row spawns it, so this stays the documented escape hatch for the child.
2. `dsh.workspaceRoot(exec)` — the calling session's workspace when a command
   invocation supplies one (the `/mpd-codegraph` call-time path); the exec-less form
   (apply time) resolves `DSH_WORKSPACE_ROOT` → `process.cwd()`.
3. `process.cwd()` — the adapter's own last tier (boot, unit tests).

Behaviour: `packages/mpd-codegraph-plugin/src/index.test.ts`,
`evidence/wave3/codegraph-degrade-and-applytime/` (mount boots with and without a
session root).

## State

The project index and init lock/cooldown live in `.codegraph/` under the workspace
(`.codegraph/codegraph.db`, `init.lock`, `init.cooldown`), mirroring upstream's
discipline and kept out of git (`.gitignore`). This is a **sanctioned second workspace
state root** alongside `.mpd/` (see AGENTS.md §6) — the plugin never writes outside the
workspace.

## Config

| Key | Type | Default |
|---|---|---|
| `autoInit` | boolean | `true` |
| `initTimeoutMs` | number | `60000` |
| `cooldownMs` | number | — |
| `binary` | string | resolved per above |

## Env

- `MPD_CODEGRAPH_BIN` — explicit binary path (upstream vendored code reads it too).
- `MPD_CODEGRAPH_PROJECT_CWD` / `MPD_DSH_CODEGRAPH_PROJECT_CWD` — project root
  override (highest precedence for both this plugin and the MCP child).

## Usage

No model tools; the MCP companion row `mcp-codegraph` exposes
`mcp__codegraph__*`. The `codegraph` MCP row's `command` env uses
`MPD_DSH_CODEGRAPH_CLI || <pkg>/packages/mpd-mcp-codegraph/launch.ts`; the launcher
(B8) resolves the binary itself and sets `MPD_CODEGRAPH_BIN` only when unset, so this
plugin and the MCP row share the same resolver rules.
