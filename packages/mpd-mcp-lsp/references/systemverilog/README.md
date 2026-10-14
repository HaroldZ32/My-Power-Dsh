# SystemVerilog — language server for `.sv` / `.svh`

**English** | [中文](./README.zh-CN.md)

This page is the SystemVerilog half of the `lsp-setup` skill's route: the skill sends `.sv` and `.svh`
files here, into the package that owns the LSP plane. The machine-readable row lives in
`packages/mpd-mcp-lsp/src/server-catalog.ts` (`language: "systemverilog"`); this page is the human half.

## The server

| | |
|---|---|
| Server | `svls` |
| Language | SystemVerilog (`.sv`, `.svh`) |
| Licence | **MIT** — permissive |
| Executable | `svls` |
| Install | `cargo install svls`, or `sudo snap install svls` |
| npm-installable | **no** for this server |

## Wiring it

1. Install the server with one of the commands above (or download a release archive from
   <https://github.com/dalance/svls/releases> and put the binary on `PATH`).
2. Restart the session. The launcher probes the catalog, finds `svls`, and writes a `servers` row for
   `sv` and `svh` into `<workspace>/.mpd/lsp/cclsp.json`.
3. For a UVM or otherwise include-heavy project, add a `svls.toml` beside the sources listing the
   include directories — without it svls indexes only what it can reach from the workspace root.

A server that is not installed is deliberately left OUT of the generated config, so an unrouted `.sv`
file fails with cclsp's own "No LSP server configured for file" rather than a spawn error for a binary
that is not there.

## Alternatives, and their licences

| Server | Licence | Why you might pick it |
|---|---|---|
| `svls` (this row) | **MIT** | One command to install, indexes the workspace itself. |
| `verible-verilog-ls` | Apache-2.0 | Already present for the [Verilog page](../verilog/README.md); a full toolchain with a formatter and a linter beside the server. |
| `@imc-trading/svlangserver` (`svlangserver`) | **MIT** | The npm-installable path (`npm install -g @imc-trading/svlangserver`), for a machine where a Node toolchain is easier than Rust or a release archive. |

Only ONE of these can be the wired `.sv` server at a time — cclsp routes an extension to a single
`servers` entry — so switching means naming the alternative in `<workspace>/cclsp.json`, which the
launcher never rewrites.
