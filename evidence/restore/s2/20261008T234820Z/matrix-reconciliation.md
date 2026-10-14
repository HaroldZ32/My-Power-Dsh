# S2 — reconciliation of my primary research with `language-matrix`

Inputs: my own fetch sweep (`research/verify-sources{,-2,-3}.mjs`, results in `research/sources.json`,
`installs.txt`, `install-docs.txt`, `licences-full.txt`, `roslyn.json`) and the matrix at
`evidence/restore/matrix/20261008T235658Z-lsp-language-matrix.md` (46 rows).

Rule applied: prefer the row with the better citation; keep the union; state every disagreement.

## Adopted from the matrix (rows or facts I did not have)

| Fact | Action in the catalog |
|---|---|
| `lemminx` (XML) is EPL-2.0 and NON-permissive | new `xml` row (EPL-2.0) + guard entry |
| `nixd` (Nix) is LGPL-3.0 and NON-permissive | guard entry + the `nix` row's caveat names it as the non-permissive alternative |
| `vim-language-server` — repo has NO root licence file, MIT rests on the npm manifest | new `vim` row, licence cited to the npm page, caveat says "package-declared" |
| `@imc-trading/svlangserver` (MIT, npm) for SystemVerilog | named in the `systemverilog` row's caveat + the HDL reference page |
| `fwcd/kotlin-language-server` (MIT) as the Kotlin alternative | named in the `kotlin` row's caveat + citation |
| `omnisharp-roslyn` (MIT) as a permissive C# path | the `csharp` row keeps `csharp-ls`; the C# Dev Kit nuance is in the `razor` row (the bundle wires one C# server) |
| `buf` (Apache-2.0) as the vendor-backed protobuf alternative | named in the `protols` row's caveat |
| npm placeholders: `gopls`, `rust-analyzer` (0.0.1-security), `clangd` (0.0.0, no bin) | recorded as `NPM_TRAPS` + a test that no install command points at one |
| npm `zls` (third-party wrapper) and npm `marksman` (unrelated project) are traps | recorded as `NPM_TRAPS` |
| C# Dev Kit is proprietary with NO licence file (`microsoft/vscode-csharp`) | the `razor` row's licence is now **proprietary**, and the caveat carries the Roslyn nuance in the captain's wording |

## Where I disagree with the matrix (recorded, not silently resolved)

1. **`protols`.** The matrix checked `c4pt0r/protols` and found no licence file. I fetched
   `https://raw.githubusercontent.com/coder3101/protols/HEAD/LICENSE` → HTTP 200, `MIT License,
   Copyright (c) 2024 Ashar`; the URL the matrix used returns **404** and is not this project. The row
   stays MIT, cites the file I read, and carries the disagreement in its caveat. Recorded in
   `LICENCE_DISPUTES`.
2. **`csharp-ls`.** The matrix reports the licence UNVERIFIED because `Razor/csharp-ls` has no readable
   licence file. That path 404s today; the project's current home `razzmatazz/csharp-language-server`
   serves `LICENSE` = MIT, which is what the row cites. The row's caveat names both coordinates.
3. **Roslyn framing.** The matrix's own nuance (Roslyn the compiler is MIT; the shipped C# Dev Kit
   server is proprietary) is adopted verbatim in spirit: the row is labelled **proprietary** for the
   product and the caveat refuses both wrong flattenings.
4. **Kotlin.** The matrix wires `fwcd/kotlin-language-server` (MIT); I keep JetBrains' official
   `kotlin-lsp` (Apache-2.0) as the WIRED row — both licences are permissive and both are cited — and
   the alternative is named in the caveat so the union is visible without a silent pick.

## Rows the matrix marks `[UNVERIFIED-command]` that my own sweep upgraded to `primary`

`terraform-ls` (brew, read from `docs/installation.md`), `marksman` (brew, `docs/install.md`),
`haskell-language-server` (brew, `docs/installation.md`), `clojure-lsp` (brew, `docs/installation.md`),
`ruby-lsp` (`gem install`, confirmed against the RubyGems API), `ocaml-lsp-server` (`opam install`,
README), `srclang erlang_ls` (`make install`, README), `vhdl_ls` (release/`cargo install --path`,
README), `verible` (release archive, README), `svls` (`cargo install`/snap, README), `fortls`
(`pip install`, README), `texlab` (README), `typst`/`tinymist` (releases, README).

## Rows where I AGREE with the matrix that the command is unverified

`go` (gopls), `java` (jdtls), `dart`, `julia`, `lua`, `zls`, `scala`/metals, `gleam`, `groovy`, `r`,
`nickel`, `graphql`, `sql`, `toml` — 16 rows in total, each with a caveat that OPENS with
`UNVERIFIED` and names the weak part; the validator reddens if that marker is missing.
`gopls/doc/user.md` — a citation I had used for the Go row — returns **404**, so the Go row was moved
to `unverified` rather than left claiming a document it does not have.
