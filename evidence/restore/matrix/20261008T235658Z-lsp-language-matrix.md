# LSP language → server matrix (46 rows, cited) — for contract `.mpd/plans/restore-three-capabilities.md` §1 decision 3 / §3 S2

Stamp: 2026-10-08T23:56:58Z · Producer: `language-matrix` (Researcher role, read-only; bash used for read-only HTTP GETs only)
Supersedes: the earlier 23-language packet — **which is NOT on disk anywhere** (searched `evidence/de-omo/**` for
`cclsp`, `terraform-ls`, `Intelephense`, `jdtls`, `roslyn`: only unrelated `mcp-b2` logs hit). It was a one-shot lane's
REPORT, never a file. The base rows below were therefore **re-derived from primary sources**, not recalled.

## 0. Method (what makes each cell a reading, not a recollection)

* Licence = the text of the project's own licence file, fetched at `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/<LICENSE…>`
  and read (first bytes), plus `https://api.github.com/repos/<owner>/<repo>/license` for the rows where the plain-text
  classifier is known to misfire (EPL-2.0 / MPL-2.0 / AGPL-vs-GPL text collisions).
* npm eligibility / npm-declared licence = `https://registry.npmjs.org/<pkg>` (machine-readable manifest), fetched the same session.
* Install commands: marked **[read]** when the command was read verbatim from the project README/docs in this session;
  marked **[UNVERIFIED-command]** when the project URL is cited but the command was NOT read verbatim (the writer must
  confirm it before shipping it as a literal).
* No repository git history and no deleted in-repo overlay was read for this matrix. Public documentation only.
* `extensions` are BARE (no dot) because `cclsp` 0.7.0 matches bare extensions — carried from the contract's verified
  facts, not re-derived here.

## 1. The matrix (46 rows; base 23 languages re-derived + 21 added)

| # | Language | Server | Project · SPDX licence | Install command | npm? | URL |
|---|---|---|---|---|---|---|
| 1 | TypeScript / JavaScript | `typescript-language-server` 6.0.1 | typescript-language-server/typescript-language-server · **Apache-2.0** | `npm i -g typescript-language-server typescript` | YES (bin `typescript-language-server`) | https://github.com/typescript-language-server/typescript-language-server |
| 2 | Python | `pyright-langserver` (pkg `pyright` 1.1.414) | microsoft/pyright · **MIT** | `npm i -g pyright` | YES (bins `pyright`, `pyright-langserver`) | https://github.com/microsoft/pyright |
| 3 | Go | `gopls` | golang/tools · **BSD-3-Clause** | `go install golang.org/x/tools/gopls@latest` **[UNVERIFIED-command]** | NO (npm `gopls` is a `0.0.1-security` placeholder, no bin) | https://github.com/golang/tools |
| 4 | Rust | `rust-analyzer` | rust-lang/rust-analyzer · **MIT OR Apache-2.0** (LICENSE-MIT read) | `rustup component add rust-analyzer` **[UNVERIFIED-command]** | NO (npm `rust-analyzer` is a `0.0.1-security` placeholder, no bin) | https://github.com/rust-lang/rust-analyzer |
| 5 | Java | Eclipse JDT LS | eclipse-jdtls/eclipse.jdt.ls · **EPL-2.0 — NON-PERMISSIVE (weak copyleft)** | distributed by editor extensions / JDT LS builds **[UNVERIFIED-command]** | NO | https://github.com/eclipse-jdtls/eclipse.jdt.ls |
| 6 | Kotlin | `kotlin-language-server` | fwcd/kotlin-language-server · **MIT** | release archive **[UNVERIFIED-command]** | NO | https://github.com/fwcd/kotlin-language-server |
| 7 | C / C++ | `clangd` | llvm/llvm-project · **Apache-2.0 WITH LLVM-exception** (LICENSE.TXT read: "Apache License v2.0 with LLVM Exceptions") | `apt install clangd` / LLVM release **[UNVERIFIED-command]** | NO (npm `clangd` is a `0.0.0` placeholder, no bin) | https://github.com/llvm/llvm-project |
| 8 | C# | C# Dev Kit / Roslyn language server | microsoft/vscode-csharp · **PROPRIETARY** (no licence file; `/license` API → `Not Found`) | VS Code C# Dev Kit extension **[UNVERIFIED-command]** | NO | https://github.com/microsoft/vscode-csharp |
| 8b | C# (permissive alternative) | `omnisharp-roslyn` | OmniSharp/omnisharp-roslyn · **MIT** (`/license` API → MIT, `license.md`) | release archive **[UNVERIFIED-command]** | NO | https://github.com/OmniSharp/omnisharp-roslyn |
| 8c | C# (alternative, licence owed) | `csharp-ls` | Razor/csharp-ls · **UNVERIFIED** (no root licence file read) | `dotnet tool install --global csharp-ls` **[UNVERIFIED-command]** | NO | https://github.com/Razor/csharp-ls |
| 9 | Ruby | `ruby-lsp` | Shopify/ruby-lsp · **MIT** (LICENSE.txt read) | `gem install ruby-lsp` **[UNVERIFIED-command]** | NO | https://github.com/Shopify/ruby-lsp |
| 10 | PHP | Intelephense **server — PROPRIETARY** | npm `intelephense` 1.18.5, licence field `SEE LICENSE IN LICENSE.txt`; published tarball `LICENSE.txt` read verbatim = *"Intelephense Licence … By installing this software you agree to be bound by the provisions of this agreement"* (commercial, Licence-Key-gated Premium Features) | `npm i -g intelephense` | **YES — npm-installable but NOT open source** | https://www.npmjs.com/package/intelephense |
| 10b | PHP (permissive alternative) | `phpactor` | phpactor/phpactor · **MIT** | composer `phpactor/phpactor` **[UNVERIFIED-command]** | NO | https://github.com/phpactor/phpactor |
| 11 | Swift | `sourcekit-lsp` | swiftlang/sourcekit-lsp · **Apache-2.0** (LICENSE.txt read) | bundled with the Swift toolchain / Xcode **[read: README says it is included in Swift toolchains and bundled with Xcode]** | NO | https://github.com/swiftlang/sourcekit-lsp |
| 12 | Lua | `lua-language-server` | LuaLS/lua-language-server · **MIT** | release archive **[UNVERIFIED-command]** | NO (npm `lua-language-server` NOT FOUND) | https://github.com/LuaLS/lua-language-server |
| 13 | Bash / Shell | `bash-language-server` 5.8.1 | bash-lsp/bash-language-server · **MIT** | `npm i -g bash-language-server` | YES (bin `bash-language-server`) | https://github.com/bash-lsp/bash-language-server |
| 14 | YAML | `yaml-language-server` 1.24.0 | redhat-developer/yaml-language-server · **MIT** | `npm i -g yaml-language-server` | YES (bin `yaml-language-server`) | https://github.com/redhat-developer/yaml-language-server |
| 15 | JSON | `vscode-json-language-server` | hrsh7th/vscode-langservers-extracted (upstream microsoft/vscode-json-languageservice) · **MIT** | `npm i -g vscode-langservers-extracted` | YES (bin `vscode-json-language-server`) | https://www.npmjs.com/package/vscode-langservers-extracted |
| 16 | HTML | `vscode-html-language-server` | hrsh7th/vscode-langservers-extracted (upstream microsoft/vscode-html-languageservice) · **MIT** | `npm i -g vscode-langservers-extracted` | YES (bin `vscode-html-language-server`) | https://github.com/microsoft/vscode-html-languageservice |
| 17 | CSS / SCSS / LESS | `vscode-css-language-server` | hrsh7th/vscode-langservers-extracted (upstream microsoft/vscode-css-languageservice) · **MIT** | `npm i -g vscode-langservers-extracted` | YES (bin `vscode-css-language-server`) | https://github.com/microsoft/vscode-css-languageservice |
| 18 | Terraform / HCL | `terraform-ls` | hashicorp/terraform-ls · **MPL-2.0 — NON-PERMISSIVE (weak copyleft)** (LICENSE read: "Copyright IBM Corp. 2020, 2026 / Mozilla Public License, version 2.0"; `/license` API → MPL-2.0) | release archive **[UNVERIFIED-command]** | NO | https://github.com/hashicorp/terraform-ls |
| 19 | SQL | `sql-language-server` 1.7.1 | joe-re/sql-language-server · **MIT** | `npm i -g sql-language-server` | YES (bin `sql-language-server`) | https://github.com/joe-re/sql-language-server |
| 19b | SQL (alternative) | `sqls` | sqls-server/sqls · **MIT** | `go install github.com/sqls-server/sqls@latest` **[UNVERIFIED-command]** | NO | https://github.com/sqls-server/sqls |
| 20 | Dockerfile | `docker-langserver` (pkg `dockerfile-language-server-nodejs` 0.15.0) | rcjsuen/dockerfile-language-server-nodejs · **MIT** (npm manifest; `/license` API returned `Moved Permanently`) | `npm i -g dockerfile-language-server-nodejs` | YES (bin `docker-langserver`) | https://www.npmjs.com/package/dockerfile-language-server-nodejs |
| 21 | Markdown | `marksman` | artempyanykh/marksman · **MIT** (LICENSE read) | `brew install marksman` **[UNVERIFIED-command]** | NO — the npm package named `marksman` is a DIFFERENT project (fussydesigns/marksman, `Zlib OR MIT OR Apache-2.0`); never wire cclsp to it | https://github.com/artempyanykh/marksman |
| 21b | Markdown (npm path) | `vscode-markdown-language-server` | hrsh7th/vscode-langservers-extracted · **MIT** | `npm i -g vscode-langservers-extracted` | YES (bin `vscode-markdown-language-server`) | https://www.npmjs.com/package/vscode-langservers-extracted |
| 22 | Zig | `zls` | zigtools/zls · **MIT** (LICENSE read) | zigtools.org install page **[UNVERIFIED-command]**; npm package `zls` is a THIRD-PARTY wrapper (repo `Sarvesh-SP/zls`, declared ISC) — do not present it as the official server | NO (official) / YES-unofficial | https://github.com/zigtools/zls |
| 23 | Elixir | `elixir-ls` | elixir-lsp/elixir-ls · **Apache-2.0** | release archive / editor extension **[UNVERIFIED-command]** | NO (npm `elixir-ls` NOT FOUND) | https://github.com/elixir-lsp/elixir-ls |
| 24 | Haskell | `haskell-language-server` | haskell/haskell-language-server · **Apache-2.0** | `ghcup install hls` **[UNVERIFIED-command]** (README links its installation docs) | NO | https://github.com/haskell/haskell-language-server |
| 25 | Scala | `metals` | scalameta/metals · **Apache-2.0** | `cs install metals` **[UNVERIFIED-command]** | NO | https://github.com/scalameta/metals |
| 26 | OCaml | `ocaml-lsp-server` | ocaml/ocaml-lsp · **ISC** (LICENSE.md read; `/license` API said NOASSERTION, the text is the ISC grant) | `opam install ocaml-lsp-server` **[read: README]** | NO | https://github.com/ocaml/ocaml-lsp |
| 27 | Erlang | `erlang_ls` | erlang-ls/erlang_ls · **Apache-2.0** | escript build then `make install` **[read: README]** | NO | https://github.com/erlang-ls/erlang_ls |
| 27b | Erlang (alternative) | ELP (`erlang-language-platform`) | whatsapp/erlang-language-platform · **MIT** (LICENSE-MIT read) | release/`cargo` build **[UNVERIFIED-command]** | NO | https://github.com/whatsapp/erlang-language-platform |
| 28 | Clojure | `clojure-lsp` | clojure-lsp/clojure-lsp · **MIT** | installation script / brew (clojure-lsp.io/installation) **[UNVERIFIED-command]** | NO (npm `clojure-lsp` and `clojure-lsp-bin` NOT FOUND) | https://github.com/clojure-lsp/clojure-lsp |
| 29 | Groovy | `groovy-language-server` | GroovyLanguageServer/groovy-language-server · **Apache-2.0** | build from source / shipped inside the editor extension **[UNVERIFIED-command]** | NO (npm `groovy-language-server` NOT FOUND) | https://github.com/GroovyLanguageServer/groovy-language-server |
| 30 | Dart | `dart language-server` (SDK command) | dart-lang/sdk · **BSD-3-Clause** | ships with the Dart SDK: `dart language-server` **[UNVERIFIED-command]** | NO | https://github.com/dart-lang/sdk |
| 31 | Julia | `LanguageServer.jl` | julia-vscode/LanguageServer.jl · **MIT** (LICENSE.md read) | install into the Julia environment (`Pkg.add("LanguageServer")`) **[read: README states installation into the current environment; exact command form UNVERIFIED]** | NO | https://github.com/julia-vscode/LanguageServer.jl |
| 32 | Perl | `PerlNavigator` | bscan/PerlNavigator · **MIT** | VS Code extension (bundles the server) **[read: README]** | NO | https://github.com/bscan/PerlNavigator |
| 33 | R | `languageserver` | REditorSupport/languageserver · **MIT** (DESCRIPTION read: "License: MIT + file LICENSE"; LICENSE read) | `install.packages("languageserver")` **[read: README]** | NO | https://github.com/REditorSupport/languageserver |
| 34 | Nim | `nimlangserver` | nim-lang/langserver · **MIT** | `nimble install -g nimlangserver` **[read: README]** | NO | https://github.com/nim-lang/langserver |
| 35 | Crystal | `crystalline` | elbywan/crystalline · **MIT** | `brew install crystalline` **[read: README]** | NO | https://github.com/elbywan/crystalline |
| 36 | PowerShell | PowerShell Editor Services | PowerShell/PowerShellEditorServices · **MIT** | PowerShell module install (PSES runs as a PowerShell 7+ module) **[read: README states the module form; command UNVERIFIED]** | NO | https://github.com/PowerShell/PowerShellEditorServices |
| 37 | Nix | `nil` | oxalica/nil · **MIT** (LICENSE-MIT read) | `nix profile install nixpkgs#nil` **[read: README]** | NO | https://github.com/oxalica/nil |
| 37b | Nix (alternative, NON-PERMISSIVE) | `nixd` | nix-community/nixd · **LGPL-3.0 — NON-PERMISSIVE (weak copyleft)** (LICENSE read: "GNU LESSER GENERAL PUBLIC LICENSE Version 3") | `nix profile install nixpkgs#nixd` **[UNVERIFIED-command]** | NO | https://github.com/nix-community/nixd |
| 38 | TOML | `taplo` | tamasfe/taplo · **MIT** | `npm i -g @taplo/cli` (bin `taplo`, mode `taplo lsp stdio`) | YES (bin `taplo`) | https://github.com/tamasfe/taplo |
| 39 | XML | `lemminx` | eclipse-lemminx/lemminx · **EPL-2.0 — NON-PERMISSIVE (weak copyleft)** (LICENSE read; `/license` API → EPL-2.0) | binary release / editor XML extension **[UNVERIFIED-command]** | NO | https://github.com/eclipse-lemminx/lemminx |
| 40 | GraphQL | `graphql-lsp` (pkg `graphql-language-service-cli` 3.5.0) | npm manifest **MIT**; upstream now lives in graphql/graphiql — the old graphql/graphql-language-service repo has NO root licence file (`/license` API → `Not Found`) | `npm i -g graphql-language-service-cli` | YES (bin `graphql-lsp`) | https://www.npmjs.com/package/graphql-language-service-cli |
| 41 | Protocol Buffers | `buf` (`buf beta lsp`) | bufbuild/buf · **Apache-2.0** (LICENSE read) | `brew install bufbuild/buf/buf` **[read: README]** | NO | https://github.com/bufbuild/buf |
| 41b | Protocol Buffers (alternative, licence OWED) | `protols` | upstream c4pt0r/protols has **NO licence file** (`/license` API → `Not Found`); the npm package `protols` declares MIT, and that declaration covers the WRAPPER package only — do NOT publish "protols is MIT" | `cargo install protols` **[UNVERIFIED-command]** | npm wrapper YES / upstream NO | https://github.com/c4pt0r/protols |
| 42 | Vim script | `vim-language-server` 2.3.1 | npm manifest **MIT**; repo iamcco/vim-language-server has NO root licence file read (`/license` API → `Not Found`) | `npm i -g vim-language-server` **[read: README]** | YES (bin `vim-language-server`) | https://github.com/iamcco/vim-language-server |
| 43 | Verilog / SystemVerilog | `verible-verilog-ls` | chipsalliance/verible · **Apache-2.0** (LICENSE read) | release archive / bazel build **[UNVERIFIED-command]** | NO | https://github.com/chipsalliance/verible |
| 43b | SystemVerilog (npm path) | `svlangserver` (pkg `@imc-trading/svlangserver` 0.4.1) | imc-trading/svlangserver · **MIT** (repo LICENSE read + npm manifest MIT) | `npm install -g @imc-trading/svlangserver` **[read: README]** | YES (bin `svlangserver`) | https://github.com/imc-trading/svlangserver |
| 44 | VHDL | `vhdl_ls` | VHDL-LS/rust_hdl · **MPL-2.0 — NON-PERMISSIVE (weak copyleft)** (LICENSE.txt read) | `cargo install vhdl_ls` **[read: README mentions the crates.io package; the source path `cargo install --path vhdl_ls` was read verbatim]** | NO | https://github.com/VHDL-LS/rust_hdl |
| 45 | LaTeX | `texlab` | latex-lsp/texlab · **GPL-3.0 — NON-PERMISSIVE (strong copyleft)** (LICENSE read: "GNU GENERAL PUBLIC LICENSE Version 3"; `/license` API → GPL-3.0) | `cargo install texlab` / package manager **[read: README says manual install or package manager; exact command UNVERIFIED]** | NO (npm `texlab` NOT FOUND) | https://github.com/latex-lsp/texlab |
| 46 | Assembly (GAS / NASM / MASM …) | `asm-lsp` | bergercookie/asm-lsp · **BSD-2-Clause** (LICENSE read) | `cargo install asm-lsp` **[read: README]** | NO (npm `asm-lsp` NOT FOUND) | https://github.com/bergercookie/asm-lsp |

Rows: **46** covering **44 distinct languages/dialects** (the original 23 plus OCaml, Erlang, Clojure, Groovy, Dart,
Julia, Perl, R, Nim, Crystal, PowerShell, Nix, TOML, XML, GraphQL, Protocol Buffers, Vim script, Verilog/SV, VHDL,
LaTeX, Assembly).

## 2. NON-PERMISSIVE — never call these MIT (the four known + four NEW)

| Server | Licence | Kind |
|---|---|---|
| Eclipse JDT LS | EPL-2.0 | weak copyleft (known) |
| `terraform-ls` | MPL-2.0 | weak copyleft (known) |
| Intelephense server (npm `intelephense`) | proprietary commercial EULA | proprietary (known) |
| C# Dev Kit / `microsoft/vscode-csharp` | proprietary, no licence file | proprietary (known) |
| **`lemminx` (XML) — NEW** | EPL-2.0 | weak copyleft |
| **`nixd` (Nix, alternative) — NEW** | LGPL-3.0 | weak copyleft |
| **`vhdl_ls` (VHDL) — NEW** | MPL-2.0 | weak copyleft |
| **`texlab` (LaTeX) — NEW** | GPL-3.0 | strong copyleft |
| `protols` upstream (Protocol Buffers alternative) | NO licence file found | all rights reserved by default — treat as non-permissive |

Nuance the guide must not flatten: **Roslyn itself is MIT** (`dotnet/roslyn` `/license` API → MIT, `License.txt`) — what is
proprietary is the *shipped C# Dev Kit language server*. Write the row as "C# Dev Kit (proprietary)"; do not write
"Roslyn is proprietary" and do not write "Roslyn is MIT" as if it were the installed server. Permissive C# paths:
`omnisharp-roslyn` (MIT); `csharp-ls` licence UNVERIFIED.

## 3. Not verified — do not fill in by guessing

1. `csharp-ls` (Razor/csharp-ls) — **licence UNVERIFIED**: no root licence file could be read.
2. `vim-language-server` — repo root licence **not read**; the MIT claim rests on the npm manifest alone.
3. `graphql-language-service` — repo root licence **not found**; the MIT claim rests on the npm manifest alone.
4. `protols` upstream — **no licence file found**; only the npm *wrapper* package declares MIT.
5. ~20 install commands marked **[UNVERIFIED-command]** (gopls, rust-analyzer, jdtls, kotlin, clangd, ruby-lsp,
   lua-language-server, marksman, zls, elixir-ls, HLS, metals, clojure-lsp, groovy, dart, Julia's exact form,
   PowerShell, verible, texlab, nixd) — the project URL is cited, the literal is not. Confirm before shipping literals.
6. `digestif` (LaTeX alternative, MIT-claimed) — **not investigated**; do not cite it without a read.
7. `Perl::LanguageServer` (FractalBoy) — **not investigated**; `PerlNavigator` (MIT) is the verified Perl row.

## 4. Reconciliation notes for `lsp-writer` (disagreements stated, never silently resolved)

* The old packet listed `typescript-language-server` as MIT: **it is Apache-2.0** — repo LICENSE read AND npm manifest
  `license=Apache-2.0`. The captain's correction is confirmed independently here; prefer Apache-2.0.
* `terraform-ls` = **MPL-2.0** (confirmed by licence text + `/license` API), NOT a permissive licence — the old packet's
  flag stands.
* `eclipse.jdt.ls` = **EPL-2.0** (confirmed by `/license` API → EPL-2.0). Caution: the EPL-2.0 text itself names the
  GNU GPL in its secondary-licence clause, which makes naive keyword classification report GPL — do not repeat that error.
* npm placeholders exist under the names `gopls`, `rust-analyzer` (`0.0.1-security`) and `clangd` (`0.0.0`, no bin):
  the language table must NOT mark Go/Rust/C-C++ npm-installable.
* The npm package `zls` and the npm package `marksman` are **third-party / unrelated** — both are traps.
* `cclsp` config shape (carried from the contract, unchanged): `{servers:[{extensions,command,rootDir,restartInterval,
  initializationOptions}]}` via `CCLSP_CONFIG_PATH`; `command[0]` is spawned directly (absolute paths OK); extensions
  BARE.
