// S2 source verifier, third pass — the rows whose README states no bare install command.
//
// Several projects document installation on a dedicated page (`docs/install.md`, a book page) or only
// through their editor extension. This pass reads those documents, greps with a RELAXED filter (the
// command is often inside a longer line or a shell snippet), and resolves the one licence the first two
// passes could not: the Roslyn language server, whose compiler repository is MIT but whose shipped
// language server is proprietary. For that row the source is the NuGet package's own `.nuspec`.
//
// Usage: node verify-sources-3.mjs --out <dir>
import { writeFileSync } from "node:fs"
import { join } from "node:path"

/** Dedicated install documents, by language key. */
const INSTALL_DOCS = {
  rust: "https://rust-analyzer.github.io/book/installation.html",
  terraform: "https://raw.githubusercontent.com/hashicorp/terraform-ls/HEAD/docs/installation.md",
  markdown: "https://raw.githubusercontent.com/artempyanykh/marksman/HEAD/docs/install.md",
  haskell: "https://raw.githubusercontent.com/haskell/haskell-language-server/HEAD/docs/installation.md",
  lua: "https://raw.githubusercontent.com/LuaLS/lua-language-server/HEAD/doc/README.md",
  clojure: "https://raw.githubusercontent.com/clojure-lsp/clojure-lsp/master/docs/installation.md",
  kotlin: "https://raw.githubusercontent.com/Kotlin/kotlin-lsp/HEAD/README.md",
  java: "https://raw.githubusercontent.com/eclipse-jdtls/eclipse.jdt.ls/HEAD/README.md",
  ruby: "https://raw.githubusercontent.com/Shopify/ruby-lsp/HEAD/README.md",
  swift: "https://raw.githubusercontent.com/swiftlang/sourcekit-lsp/HEAD/README.md",
  dart: "https://raw.githubusercontent.com/dart-lang/sdk/HEAD/README.md",
  zig: "https://raw.githubusercontent.com/zigtools/zls/HEAD/README.md",
  scala: "https://raw.githubusercontent.com/scalameta/metals/HEAD/README.md",
  powershell: "https://raw.githubusercontent.com/PowerShell/PowerShellEditorServices/HEAD/README.md",
  elixir: "https://raw.githubusercontent.com/elixir-lsp/elixir-ls/HEAD/README.md",
  julia: "https://raw.githubusercontent.com/julia-vscode/LanguageServer.jl/HEAD/README.md",
  gleam: "https://raw.githubusercontent.com/gleam-lang/gleam/HEAD/README.md",
  erlang: "https://raw.githubusercontent.com/erlang-ls/erlang_ls/HEAD/README.md",
  perl: "https://raw.githubusercontent.com/bscan/PerlNavigator/HEAD/README.md",
  groovy: "https://raw.githubusercontent.com/GroovyLanguageServer/groovy-language-server/HEAD/README.md",
  typst: "https://raw.githubusercontent.com/Myriad-Dreamin/tinymist/HEAD/README.md",
  vhdl: "https://raw.githubusercontent.com/VHDL-LS/rust_hdl/HEAD/README.md",
  verilog: "https://raw.githubusercontent.com/chipsalliance/verible/HEAD/README.md",
  systemverilog: "https://raw.githubusercontent.com/dalance/svls/HEAD/README.md",
  powershell_docs: "https://raw.githubusercontent.com/PowerShell/PowerShellEditorServices/HEAD/docs/installation.md",
  gopls: "https://raw.githubusercontent.com/golang/tools/HEAD/gopls/doc/user.md",
  terraform_ls: "https://raw.githubusercontent.com/hashicorp/terraform-ls/HEAD/README.md"
}

/** The relaxed command filter: any line that looks like a way to obtain the server. */
const COMMAND = /(npm (i|install|add)|pnpm add|yarn add|cargo install|go install|go get|gem install|pip install|pipx install|uv tool install|dotnet tool install|opam install|cs install|coursier|brew install|snap install|winget install|scoop install|choco install|apt install|nix profile install|make install|Pkg\.add|install\.packages|releases?\b|toolchain|SDK|sdkman)/i

/**
 * Fetch a URL as text.
 *
 * @param url the absolute URL to read.
 * @returns the body, or null on any failure.
 */
async function fetchText(url) {
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(25000), headers: { "user-agent": "mpd-lsp-catalog-research" } })
    return response.ok ? await response.text() : null
  } catch {
    return null
  }
}

/**
 * Resolve the Roslyn language server's licence from its own NuGet package metadata.
 *
 * @returns the licence element of the newest `.nuspec`, with the URL it came from.
 */
async function roslynLicence() {
  const indexUrl = "https://api.nuget.org/v3-flatcontainer/roslyn-language-server/index.json"
  const body = await fetchText(indexUrl)
  if (body === null) return { url: indexUrl, error: "unreachable" }
  const versions = JSON.parse(body).versions
  const newest = versions[versions.length - 1]
  const nuspecUrl = `https://api.nuget.org/v3-flatcontainer/roslyn-language-server/${newest}/roslyn-language-server.nuspec`
  const nuspec = await fetchText(nuspecUrl)
  if (nuspec === null) return { url: nuspecUrl, version: newest, error: "nuspec unreachable" }
  const match = nuspec.match(/<license[^>]*>([\s\S]*?)<\/license>/)
  const projectUrl = nuspec.match(/<projectUrl>([\s\S]*?)<\/projectUrl>/)
  return { version: newest, url: nuspecUrl, licenceElement: match ? match[1].trim() : "(no license element)", projectUrl: projectUrl ? projectUrl[1].trim() : null }
}

/**
 * Run the third pass.
 *
 * @returns nothing; the digest goes to `install-docs.txt` and the Roslyn answer to `roslyn.json`.
 */
async function main() {
  const outDir = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : process.cwd()
  const sections = []
  for (const [key, url] of Object.entries(INSTALL_DOCS)) {
    const body = await fetchText(url)
    if (body === null) {
      sections.push(`===== ${key} ${url}\n  (unreachable)`)
      continue
    }
    const stripped = body.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'")
    const hits = stripped
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => COMMAND.test(line) && line.length > 0 && line.length < 160)
      .slice(0, 14)
    sections.push(`===== ${key} ${url}\n${hits.map((line) => "  " + line).join("\n")}`)
  }
  writeFileSync(join(outDir, "install-docs.txt"), sections.join("\n\n") + "\n")
  const roslyn = await roslynLicence()
  writeFileSync(join(outDir, "roslyn.json"), JSON.stringify(roslyn, null, 2) + "\n")
  console.log(sections.join("\n\n"))
  console.log("\n===== roslyn =====\n" + JSON.stringify(roslyn, null, 2))
}

await main()
