// S2 source verifier — reads the PRIMARY sources for the language→server catalog.
//
// Why this exists: the catalog's `licence`, `installCommand` and `npmInstallable` fields must come from
// a source a reader can re-open, never from memory. This script fetches, for every candidate row:
//   * the npm registry's own `latest` document (license field, version, repository URL), and
//   * the repository's LICENCE file BYTES from raw.githubusercontent (the licence text itself), plus
//   * the install lines of the repository README, so an install command is quoted rather than guessed.
// It writes the full result to sources.json next to this file and prints a one-line-per-row summary.
//
// Usage: node verify-sources.mjs [--out <dir>]
import { writeFileSync } from "node:fs"
import { join } from "node:path"

/** Every candidate row: the language key, the npm package (when there is one) and the repository. */
const SOURCES = [
  { key: "typescript", npm: "typescript-language-server", repo: "typescript-language-server/typescript-language-server" },
  { key: "python", npm: "pyright", repo: "microsoft/pyright" },
  { key: "go", repo: "golang/tools" },
  { key: "rust", repo: "rust-lang/rust-analyzer" },
  { key: "c-cpp", repo: "llvm/llvm-project" },
  { key: "objective-c", repo: "llvm/llvm-project" },
  { key: "java", repo: "eclipse-jdtls/eclipse.jdt.ls" },
  { key: "kotlin", repo: "Kotlin/kotlin-lsp" },
  { key: "csharp", repo: "razzmatazz/csharp-language-server" },
  { key: "razor", repo: "dotnet/roslyn" },
  { key: "swift", repo: "swiftlang/sourcekit-lsp" },
  { key: "ruby", repo: "Shopify/ruby-lsp" },
  { key: "php", npm: "intelephense", repo: "bmewburn/vscode-intelephense" },
  { key: "dart", repo: "dart-lang/sdk" },
  { key: "elixir", repo: "elixir-lsp/elixir-ls" },
  { key: "zig", repo: "zigtools/zls" },
  { key: "lua", repo: "LuaLS/lua-language-server" },
  { key: "bash", npm: "bash-language-server", repo: "bash-lsp/bash-language-server" },
  { key: "yaml", npm: "yaml-language-server", repo: "redhat-developer/yaml-language-server" },
  { key: "json", npm: "vscode-langservers-extracted", repo: "hrsh7th/vscode-langservers-extracted" },
  { key: "markdown", repo: "artempyanykh/marksman" },
  { key: "dockerfile", npm: "dockerfile-language-server-nodejs", repo: "rcjsuen/dockerfile-language-server" },
  { key: "terraform", repo: "hashicorp/terraform-ls" },
  { key: "haskell", repo: "haskell/haskell-language-server" },
  { key: "julia", repo: "julia-vscode/LanguageServer.jl" },
  { key: "toml", npm: "@taplo/cli", repo: "tamasfe/taplo" },
  { key: "vue", npm: "@vue/language-server", repo: "vuejs/language-tools" },
  { key: "svelte", npm: "svelte-language-server", repo: "sveltejs/language-tools" },
  { key: "graphql", npm: "graphql-language-service-cli", repo: "graphql/graphql-language-service" },
  { key: "sql", npm: "sql-language-server", repo: "joe-re/sql-language-server" },
  { key: "cmake", npm: "cmake-language-server", repo: "regen100/cmake-language-server" },
  { key: "protobuf", repo: "coder3101/protols" },
  { key: "nix", repo: "oxalica/nil" },
  { key: "clojure", repo: "clojure-lsp/clojure-lsp" },
  { key: "erlang", repo: "erlang-ls/erlang_ls" },
  { key: "gleam", repo: "gleam-lang/gleam" },
  { key: "r", repo: "REditorSupport/languageserver" },
  { key: "scala", repo: "scalameta/metals" },
  { key: "ocaml", repo: "ocaml/ocaml-lsp" },
  { key: "verilog", repo: "chipsalliance/verible" },
  { key: "systemverilog", repo: "dalance/svls" },
  { key: "powershell", repo: "PowerShell/PowerShellEditorServices" },
  { key: "fortran", repo: "fortran-lang/fortls" },
  { key: "tex", repo: "latex-lsp/texlab" },
  { key: "elm", npm: "@elm-tooling/elm-language-server", repo: "elm-tooling/elm-language-server" },
  { key: "ansible", npm: "@ansible/ansible-language-server", repo: "ansible/vscode-ansible" },
  { key: "solidity", npm: "@nomicfoundation/solidity-language-server", repo: "NomicFoundation/hardhat-vscode" },
  { key: "tailwind", npm: "@tailwindcss/language-server", repo: "tailwindlabs/tailwindcss-intellisense" },
  { key: "prisma", npm: "@prisma/language-server", repo: "prisma/language-tools" },
  { key: "typst", repo: "Myriad-Dreamin/tinymist" },
  { key: "perl", repo: "bscan/PerlNavigator" },
  { key: "groovy", repo: "GroovyLanguageServer/groovy-language-server" },
  { key: "vhdl", repo: "VHDL-LS/rust_hdl" },
  { key: "nickel", repo: "tweag/nickel" },
  { key: "erlang-otp" },
]

/** The licence-file names tried, in order, against the repository's default branch. */
const LICENCE_PATHS = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE-APACHE", "LICENCE", "COPYING", "COPYING.txt", "LICENSE.rst"]

/** The README names tried for the install lines. */
const README_PATHS = ["README.md", "README.rst", "README.markdown"]

/** SPDX markers matched against the licence text; the first hit wins. */
const SPDX_MARKERS = [
  ["Apache License", "Apache-2.0"],
  ["Apache-2.0", "Apache-2.0"],
  ["MIT License", "MIT"],
  ["Permission is hereby granted, free of charge", "MIT"],
  ["Mozilla Public License", "MPL-2.0"],
  ["Eclipse Public License", "EPL-2.0"],
  ["GNU GENERAL PUBLIC LICENSE", "GPL"],
  ["GNU LESSER GENERAL PUBLIC LICENSE", "LGPL"],
  ["BSD 3-Clause", "BSD-3-Clause"],
  ["BSD 2-Clause", "BSD-2-Clause"],
  ["Redistribution and use in source and binary forms", "BSD (clause count unread)"],
  ["The Artistic License", "Artistic-2.0"],
  ["ISC License", "ISC"],
  ["The Unlicense", "Unlicense"],
  ["zlib License", "Zlib"],
]

/**
 * Fetch a URL as text, with a bounded timeout so one dead host cannot stall the sweep.
 *
 * @param url the absolute URL to read.
 * @returns the response body, or null for any non-200 answer or transport error.
 */
async function fetchText(url) {
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "user-agent": "mpd-lsp-catalog-research" } })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

/**
 * Read the npm registry's own document for a package.
 *
 * @param name the package name.
 * @returns the fields the catalog cites, or an error marker.
 */
async function readNpm(name) {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2f")}/latest`
  const body = await fetchText(url)
  if (body === null) return { url, error: "unreachable" }
  try {
    const doc = JSON.parse(body)
    return { url, name: doc.name, version: doc.version, license: doc.license ?? null, repository: doc.repository?.url ?? null, homepage: doc.homepage ?? null }
  } catch {
    return { url, error: "unparsable" }
  }
}

/**
 * Guess the SPDX id from licence text.
 *
 * @param text the licence file's content.
 * @returns the matched marker, or null when no marker matched.
 */
function guessSpdx(text) {
  for (const [marker, spdx] of SPDX_MARKERS) {
    if (text.includes(marker)) return spdx
  }
  return null
}

/**
 * Read the repository's licence file and README install lines.
 *
 * @param repo the `owner/name` repository slug.
 * @returns what was found, with the URL of every document actually read.
 */
async function readRepo(repo) {
  const result = { repo, licenceUrl: null, licenceHead: null, spdx: null, readmeUrl: null, installLines: [] }
  for (const path of LICENCE_PATHS) {
    const url = `https://raw.githubusercontent.com/${repo}/HEAD/${path}`
    const body = await fetchText(url)
    if (body === null) continue
    result.licenceUrl = url
    result.licenceHead = body.split("\n").slice(0, 6).join(" ").replace(/\s+/g, " ").trim().slice(0, 220)
    result.spdx = guessSpdx(body)
    break
  }
  for (const path of README_PATHS) {
    const url = `https://raw.githubusercontent.com/${repo}/HEAD/${path}`
    const body = await fetchText(url)
    if (body === null) continue
    result.readmeUrl = url
    result.installLines = body
      .split("\n")
      .filter((line) => /install|go get|cargo add|gem install|opam install/.test(line) && line.trim().length > 0 && line.trim().length < 130)
      .slice(0, 8)
    break
  }
  return result
}

/**
 * Run the sweep with bounded concurrency.
 *
 * @returns the per-row results.
 */
async function main() {
  const outDir = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : process.cwd()
  const results = []
  for (const source of SOURCES) {
    const npm = source.npm ? await readNpm(source.npm) : null
    const repo = source.repo ? await readRepo(source.repo) : null
    results.push({ ...source, npm, repo })
    const licence = npm?.license ?? repo?.spdx ?? "?"
    console.log(
      `${source.key.padEnd(15)} licence=${String(licence).padEnd(12)} npm=${String(npm?.version ?? "-").padEnd(9)} licenceDoc=${repo?.licenceUrl ? "yes" : "NO "} readme=${repo?.readmeUrl ? repo.installLines.length + " lines" : "NO README"}`
    )
  }
  writeFileSync(join(outDir, "sources.json"), JSON.stringify(results, null, 2) + "\n")
  console.log(`\nwrote ${join(outDir, "sources.json")} — ${results.length} rows`)
}

await main()
