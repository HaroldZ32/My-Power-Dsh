# Verilog — language server for `.v` / `.vh`

**English** | [中文](./README.zh-CN.md)

This page is the Verilog half of the `lsp-setup` skill's route: the skill sends `.v` and `.vh` files
here, into the package that owns the LSP plane. The machine-readable row lives in
`packages/mpd-mcp-lsp/src/server-catalog.ts` (`language: "verilog"`); this page is the human half of it.

## The server

| | |
|---|---|
| Server | `verible-verilog-ls` (part of the Verible toolchain) |
| Language | Verilog (`.v`, `.vh`) |
| Licence | **Apache-2.0** — permissive |
| Executable | `verible-verilog-ls` |
| Install | download and extract a release from <https://github.com/chipsalliance/verible/releases> |
| npm-installable | **no** — there is no supported npm package for Verible |

Verible is the Chips Alliance's SystemVerilog toolchain; `verible-verilog-ls` is the language server
binary inside its release archives, and `verible-verilog-format` / `verible-verilog-lint` ship beside
it, which is why the same install also gives a formatter and a linter.

## Wiring it

1. Download the archive for your platform from the releases page and extract it.
2. Put `verible-verilog-ls` on `PATH`.
3. Restart the session. The launcher probes the catalog, finds the executable, and writes a
   `servers` row for `v` and `vh` into `<workspace>/.mpd/lsp/cclsp.json`.

If the binary lives somewhere unusual, skip step 2 and name it in `<workspace>/cclsp.json` instead —
that file is authoritative and the launcher never rewrites it:

```json
{
  "servers": [
    { "extensions": ["v", "vh"], "command": ["/opt/verible/bin/verible-verilog-ls"], "rootDir": "." }
  ]
}
```

## Bounds worth knowing

- The binary is **not** distributed through a package manager in most distributions, so the release
  archive is the route; the project also documents a Bazel build from source.
- Verible is a SystemVerilog-era parser: legacy Verilog-2001 constructs it does not model come back as
  parse diagnostics rather than as silence.
- The row claims `.v` and `.vh` only. A project mixing `.sv` sources wants the
  [`systemverilog` page](../systemverilog/README.md) as well — both rows can be present at once.
