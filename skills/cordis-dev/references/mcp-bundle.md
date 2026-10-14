# Connecting an MCP server

## As a configuration-only bundle (any profile)

Copy the shipped starting point
`<dsh>/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/templates/mcp/`
(`package.json`, `cordis.patch.yml`) into your bundle directory with the file-write tool. Such a
bundle needs a unique name, a version and `dsh.bundle.patch` — no Host/Client entry files. Its patch
inserts the already installed `@deepseek-ai/dsh-mcp-client` row with `serverName`, the transport and
the endpoint:

```yaml
- insert:
    - id: my-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: demo
        transport: streamable-http
        url: https://example.invalid/mcp
        failOnStartupError: true
```

Replace the endpoint, install the bundle through `plugin_manager`, then call a newly available
`mcp__<serverName>__<tool>` tool to verify the connection. For stdio use `transport: stdio`,
`command` and optional `args` / `env` / `cwd`; `Config.listConfigs` on the installed row returns the
complete client schema. Ambient credentials are scrubbed — reference existing credentials with a
loader `!!js` expression rather than copying secrets into conversation text. Repair the same bundle
on failure instead of creating duplicates.

## As a package in this bundle

MCP servers here are ordinary packages under `packages/mpd-mcp-*`, launched as child processes:

- Every one of them ships a `src/launch.ts` entry with its committed `dist/launch.js` (built by that
  package's own `scripts.build`) and a row in `cordis.patch.yml`. Since de-omo wave B2 there is **no
  vendored server and no offline build step**: `mpd-mcp-astgrep` is our own server, and
  `mpd-mcp-lsp` / `mpd-mcp-gitbash` are THIN LAUNCHERS that resolve a DECLARED npm dependency
  (`cclsp`, `@cyanheads/git-mcp-server`, `mcp-server-commands`) from the installed profile through
  `packages/mpd-mcp-shared/dependency-entry.ts`, take the terminal writers away from the terminal,
  and import the dependency's `bin` entry in-process. `mpd-mcp-codegraph` still ships a sha-pinned
  prebuilt. The historical `vendor/mcp-src/**` snapshot and `scripts/build-mcp.ts` are gone.
- One launcher can serve TWO rows: `mpd-mcp-gitbash/dist/launch.js` reads `argv[2]` (`git` | `shell`)
  and starts the matching dependency, so `mcp-git` and `mcp-shell` share one R5 terminal-silence file.
- Launcher resolution is by environment pin first (`MPD_AST_GREP_SG_PATH`, `MPD_CODEGRAPH_BIN`,
  `MPD_DSH_*_CLI`), then `PATH`/`.toolchain`. A caller-set pin WINS and can therefore mask a broken
  operand — a QA lane that means to exercise the real resolution chain must not pre-set one. An absent
  declared dependency is NOT fatal: `packages/mpd-mcp-shared/unavailable-server.ts` keeps the row alive
  with zero tools and records the reason in the launcher's log.
- **A long-lived MCP child inherits file descriptors**: never pipe `dsh` to it. Run with stdio to
  FILES (the `spawnSync` with `stdio: ['ignore', fd, fd]` shape) or as a managed background job
  (`node scripts/mpd-bg.ts run --log <workspace-path> -- <cmd>`), never `nohup` and never a pipe.
- Verify with a real call: `skills/dsh-qa/scripts/mcp-call.ts` asserts a recorded `tool/call` plus a
  non-error `tool/result` from the HARNESS's session log, not from model prose.
