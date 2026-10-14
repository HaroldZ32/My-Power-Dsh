# mpd-mcp-lsp

**English** | [中文](./README.zh-CN.md)

Thin launcher for the declared npm dependency **`cclsp`** (MIT, © 2025 ktnyt) — the
language-server plane of the bundle, exposed as `mcp__lsp__*` tools. Wrapped by the bundle's
`mcp-lsp` row (`@deepseek-ai/dsh-mcp-client`, serverName `lsp`, stdio).

## What it does

- `dist/launch.js` (our own file, built by this package's `build` script) resolves `cclsp` from the
  installed profile's `node_modules`, takes this process's terminal writers away from the terminal
  (`<root>/.mpd/logs/mpd-mcp-lsp.log`), then imports cclsp's `bin` entry in-process.
- Nothing is vendored and nothing is built from `vendor/mcp-src/**`: that snapshot, the retired
  `scripts/build-mcp.ts` and the SUL-1.0 `lsp-daemon` build it produced are gone (de-omo wave B2).
- The TS/JS language server needs no user installation: cclsp depends on
  `typescript-language-server` (Apache-2.0) and the launcher's generated config points at that copy.
- **Every other language is wired from the language→server catalog** (`src/server-catalog.ts`), so
  installing a language server is the whole user-side step — see
  [Language servers (the bootstrap)](#language-servers-the-bootstrap).

## Tools

cclsp's own twelve names, and this bundle uses them **unchanged** — there is no name-translating
shim: `find_definition`, `find_references`, `find_implementation`, `rename_symbol`,
`rename_symbol_strict`, `get_diagnostics`, `get_hover`, `find_workspace_symbols`,
`prepare_call_hierarchy`, `get_incoming_calls`, `get_outgoing_calls`, `restart_server`.

Two of them write to disk (`rename_symbol`, `rename_symbol_strict`), so both are on the read-only
specialists' deny list.

## Configuration

The launcher sets `CCLSP_CONFIG_PATH` only when the caller left it unset, and in this order:

1. a caller-set `CCLSP_CONFIG_PATH` — always wins;
2. `<workspace>/cclsp.json` — the file a user maintains by hand. It is **authoritative**: the
   launcher detects it and never reads, merges or rewrites it;
3. `<workspace>/.mpd/lsp/cclsp.json` — generated, rewritten only when its bytes would change.

The generated document names the TS/JS family plus every catalog language whose server is actually
installed (see below). cclsp starts a server lazily, per extension group, so a config with rows for
languages you do not use costs nothing until a file of that language is queried.

## Language servers (the bootstrap)

`src/server-catalog.ts` is the machine-readable source of truth: **59 rows**, one per language family,
each carrying **`server`**, **`licence`**, **`installCommand`**, **`npmInstallable`** and **`caveat`**,
plus the bare `extensions`, the `command` argv cclsp spawns, the `citations` each fact was read from,
and a `verification` mark.

- **`verification: "primary"`** — every fact traces to a document that was actually fetched (the
  package registry's own metadata, the repository's licence file, or its README/install page). 45 rows.
- **`verification: "unverified"`** — at least one fact could NOT be pinned to such a document. The
  row's caveat opens with `UNVERIFIED` and says which part is weak, so neither this README nor the
  generated config can present a weak row as a checked one. 16 rows.

A citation is not decoration: `test/server-catalog.test.ts` drives the same validator the launcher
relies on and reddens when a row loses any required field or names an empty licence string, and
`test/language-coverage.test.ts` holds the catalog to the ≥40-language floor, the eight-entry
non-permissive guard, the recorded licence disputes and the npm trap list.

Two pages under `references/` carry the HDL half the `lsp-setup` skill routes into this package:
[`references/verilog/README.md`](./references/verilog/README.md) and
[`references/systemverilog/README.md`](./references/systemverilog/README.md).

### How a language gets wired

1. **Install the server** — the row's `installCommand`, run by you. This bundle never installs a
   language server, never downloads one at request time, and no argv it generates goes through `npx`.
2. **Make it reachable** — a global install on `PATH`, or a workspace-local one under
   `node_modules/.bin`. The launcher probes both and writes the **absolute** path it found into the
   config, so a workspace-local server shadows a global one without a `PATH` change.
3. **Restart the session** — the launcher regenerates the config at boot and the new row appears.
4. **Query a file of that language** — cclsp starts the server on first use.

A server that is not installed is left **out** of the generated config on purpose: an unrouted
extension then fails with cclsp's own message ("No LSP server configured for file") instead of a
spawn error for a binary that is not there. Two further decisions worth keeping — do not "fix" them
back:

- **The probe decides, not the catalog.** A row enters the generated config only when its executable
  actually resolves (workspace `node_modules/.bin` first, then `PATH`, absolute path written). So
  installing a server is what wires it, and no config ever names a binary that is not there.
- **Nothing is installed at request time.** No generated argv goes through `npx`, and no row's
  `installCommand` is run by this bundle — that is what keeps the language plane offline-safe and
  keeps a language server out of the dependency closure.

### Install guide

Prefer the package manager that owns the language, and never edit
`<workspace>/.mpd/lsp/cclsp.json` by hand — it is regenerated whenever its bytes would change.

| Route | When | Shape |
|---|---|---|
| npm | the row sets `npmInstallable: true` | `npm install -g <package>` |
| language toolchain | the row sets `npmInstallable: false` | `go install …`, `rustup component add …`, `gem install …`, `opam install …`, `pip install …`, `cargo install …`, `dotnet tool install -g …`, `nimble install -g …` |
| upstream release | the server ships binaries only | download from the row's `citations` and put it on `PATH` |

To wire a server by hand instead — an unlisted language, a pinned fork, or an alternative the catalog
mentions in a caveat — write `<workspace>/cclsp.json`, which the launcher then uses as-is:

```json
{
  "servers": [
    { "extensions": ["ex", "exs"], "command": ["/opt/elixir-ls/language_server.sh"], "rootDir": "." }
  ]
}
```

Extensions are **bare** (no leading dot) — that is cclsp's own format — and `command[0]` is handed
straight to `spawn`, so an absolute path is fine.

### npm TRAPS — do not wire these packages

Five npm names look like the servers they are named after and are not them. The catalog carries them
as `NPM_TRAPS`, and a test asserts no row's install command points at one:

| npm package | What it actually is | The real route |
|---|---|---|
| `gopls` | a `0.0.1-security` placeholder with no bin | `go install golang.org/x/tools/gopls@latest` |
| `rust-analyzer` | a `0.0.1-security` placeholder with no bin | `rustup component add rust-analyzer` |
| `clangd` | an empty `0.0.0` package with no bin | your distribution's clangd, or the LLVM release |
| `zls` | a third-party wrapper, unrelated to `zigtools/zls` | the zls release matching your Zig version |
| `marksman` | an unrelated project (`fussydesigns/marksman`) | `brew install marksman` (artempyanykh/marksman) |

### Servers that are NOT permissive

Eight servers in the researched set are **not** permissive, and no row, doc or report may call them
MIT:

| Server | Language | Licence | Notes |
|---|---|---|---|
| Eclipse JDT LS (`jdtls`) | Java | **EPL-2.0** | Weak copyleft; spawned, never redistributed here. |
| `terraform-ls` | Terraform / HCL | **MPL-2.0** | File-level copyleft OSS. |
| Intelephense's server | PHP | **proprietary** | Commercial EULA with Licence-Key-gated Premium Features — and still npm-installable, so the flag and the npm route are independent facts. `phpactor` (MIT) is the permissive alternative. |
| C# Dev Kit language server | C# / Razor | **proprietary** | Microsoft ships it with no licence file at all. The permissive C# path here is `csharp-ls` (MIT). |
| `lemminx` | XML | **EPL-2.0** | Weak copyleft (Eclipse). |
| `nixd` | Nix | **LGPL-3.0** | Weak copyleft; the catalog wires `nil` (MIT OR Apache-2.0) instead and says so. |
| `vhdl_ls` | VHDL | **MPL-2.0** | File-level copyleft. |
| `texlab` | LaTeX | **GPL-3.0** | Strong copyleft. |

**Do not flatten the Roslyn nuance.** Roslyn the COMPILER is MIT, and the standalone NuGet package
`roslyn-language-server` declares MIT; what is proprietary is the C# Dev Kit **product** Microsoft
ships. Write "C# Dev Kit (proprietary)" — never "Roslyn is proprietary", and never "Roslyn is MIT" as
if that covered the shipped C# Dev Kit server.

`NON_PERMISSIVE_SERVERS` in `src/server-catalog.ts` is the standing guard for this list; a row whose
server name matches one of its keywords must carry that licence and is never labelled `MIT`. Where a
source contradicts another — `protols`, whose upstream `coder3101/protols` LICENSE reads MIT while a
404 fork does not — the disagreement is recorded in `LICENCE_DISPUTES` and in the row's caveat rather
than silently resolved in either direction.

## Bundle row

```yaml
- id: mcp-lsp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: lsp
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-lsp/dist/launch.js]
    toolCallTimeoutMs: 60000
```

## Capability deltas (de-omo wave B2)

The retired server exposed eight names; cclsp exposes twelve, and three of the old ones have no
counterpart. None was dropped quietly:

| Old name | Status | Why |
|---|---|---|
| `status` | **DROPPED** | It reported the vendored daemon's own state; that daemon no longer exists. `restart_server` is the surviving operational verb, and the launcher's log file is where the LSP plane narrates itself. |
| `prepare_rename` | **DROPPED** | cclsp's `rename_symbol` performs symbol resolution and the edit atomically, so there is no separate prepare step to call. The capability is subsumed, not lost. |
| `install_decision` | **DROPPED** | It recorded a decision the retired `lsp-core` read. cclsp has no such mechanism: a missing language server is reported per request. |
| `diagnostics` | replaced | `get_diagnostics` |
| `goto_definition` | replaced | `find_definition` |
| `find_references` | replaced | `find_references` |
| `symbols` | replaced | `find_workspace_symbols` |
| `rename` | replaced | `rename_symbol` (+ `rename_symbol_strict`) |
| — | **NEW** | `find_implementation`, `get_hover`, `prepare_call_hierarchy`, `get_incoming_calls`, `get_outgoing_calls`, `restart_server` |

**Language coverage is a delta too**: the retired overlay carried install hints for ~40 languages and
decided by itself which server to launch. The catalog restores that breadth as our own data, and
cclsp drives whatever the config names — with the difference that the decision is now a documented
row you can read and correct, instead of code inside a vendored daemon.

## Notes

- Prefer LSP for exact symbol facts (definition/references/diagnostics); ast-grep for structural
  pattern queries; both are cheap when scoped.
- If the dependency is absent from the profile, the row stays ALIVE with zero tools and records the
  reason in `<root>/.mpd/logs/mpd-mcp-lsp.log` instead of killing the boot.
- The probe that decides which catalog rows are wired is a **name lookup** on `PATH` and
  `<workspace>/node_modules/.bin`, with the executable bit checked on POSIX. On Windows any regular
  file matches, so a `.cmd` shim whose name differs from the package's is not found — install such a
  server globally, or name its path in `<workspace>/cclsp.json`.
