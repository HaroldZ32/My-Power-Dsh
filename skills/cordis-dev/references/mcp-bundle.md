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

- `packages/mpd-mcp-astgrep`, `mpd-mcp-codegraph`, `mpd-mcp-gitbash`, `mpd-mcp-lsp` each ship a
  `src/launch.ts` entry (committed `dist/launch.js`), a `dist/cli.js` built OFFLINE by
  `scripts/build-mcp.ts` (sha-pinned in `VENDOR_LOCK.json`), and a row in `cordis.patch.yml`.
- Launcher resolution is by environment pin first (`MPD_AST_GREP_SG_PATH`, `MPD_CODEGRAPH_BIN`,
  `MPD_DSH_*_CLI`), then `PATH`/`.toolchain`. A caller-set pin WINS and can therefore mask a broken
  operand — a QA lane that means to exercise the real resolution chain must not pre-set one.
- **A long-lived MCP child inherits file descriptors**: never pipe `dsh` to it. Run with stdio to
  FILES (the `spawnSync` with `stdio: ['ignore', fd, fd]` shape) or as a managed background job
  (`node scripts/mpd-bg.ts run --log <workspace-path> -- <cmd>`), never `nohup` and never a pipe.
- Verify with a real call: `skills/dsh-qa/scripts/mcp-call.ts` asserts a recorded `tool/call` plus a
  non-error `tool/result` from the HARNESS's session log, not from model prose.
