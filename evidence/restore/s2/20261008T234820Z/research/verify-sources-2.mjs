// S2 source verifier, second pass — the rows the first sweep left unresolved.
//
// The first pass reported `?` for seven rows and printed its install lines truncated. This pass tries
// the remaining licence-file spellings (LLVM ships LICENSE.TXT, Roslyn ships License.txt), reads the
// licence text in FULL where the first six lines were ambiguous (Intelephense's file mixes an MIT
// client section with a proprietary server section), and writes every install line to installs.txt so
// the commands can be quoted rather than guessed.
//
// Usage: node verify-sources-2.mjs --out <dir>
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** The repositories whose licence file the first pass could not find, by language key. */
const UNRESOLVED = {
  "c-cpp": "llvm/llvm-project",
  "objective-c": "llvm/llvm-project",
  razor: "dotnet/roslyn",
  dockerfile: "rcjsuen/dockerfile-language-server",
  graphql: "graphql/graphql-language-service",
  tailwind: "tailwindlabs/tailwindcss-intellisense",
  r: "REditorSupport/languageserver",
  vhdl: "VHDL-LS/rust_hdl"
}

/** Every licence-file spelling worth trying, longest-lived conventions first. */
const PATH_CANDIDATES = [
  "LICENSE.txt",
  "LICENSE.TXT",
  "License.txt",
  "LICENSE",
  "LICENSE.md",
  "LICENCE",
  "LICENCE.txt",
  "COPYING",
  "COPYING.txt",
  "LICENSE-APACHE",
  "LICENSE-MIT",
  "NOTICE"
]

/** The documents read in full, because a marker-based guess would mislabel them. */
const READ_IN_FULL = {
  php: "https://raw.githubusercontent.com/bmewburn/vscode-intelephense/HEAD/LICENSE.txt",
  rust: "https://raw.githubusercontent.com/rust-lang/rust-analyzer/HEAD/LICENSE-MIT"
}

/**
 * Fetch a URL as text.
 *
 * @param url the absolute URL to read.
 * @returns the body, or null on any failure.
 */
async function fetchText(url) {
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "user-agent": "mpd-lsp-catalog-research" } })
    return response.ok ? await response.text() : null
  } catch {
    return null
  }
}

/**
 * Try every licence-file spelling for one repository.
 *
 * @param repo the `owner/name` slug.
 * @returns the winning URL and its first lines, or a miss marker.
 */
async function findLicence(repo) {
  for (const path of PATH_CANDIDATES) {
    const url = `https://raw.githubusercontent.com/${repo}/HEAD/${path}`
    const body = await fetchText(url)
    if (body === null) continue
    return { url, head: body.split("\n").slice(0, 8).join(" ").replace(/\s+/g, " ").trim().slice(0, 400) }
  }
  return { url: null, head: null }
}

/**
 * Run the second pass and write its two reports.
 *
 * @returns nothing; the results go to `unresolved.json` and `installs.txt` in the output directory.
 */
async function main() {
  const outDir = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : process.cwd()
  const unresolved = {}
  for (const [key, repo] of Object.entries(UNRESOLVED)) {
    const found = await findLicence(repo)
    unresolved[key] = { repo, ...found }
    console.log(`${key.padEnd(12)} ${found.url ?? "STILL MISSING"}  ${(found.head ?? "").slice(0, 120)}`)
  }
  writeFileSync(join(outDir, "unresolved.json"), JSON.stringify(unresolved, null, 2) + "\n")

  const sections = []
  for (const [key, url] of Object.entries(READ_IN_FULL)) {
    const body = await fetchText(url)
    sections.push(`===== ${key} ${url} =====\n${body === null ? "(unreachable)" : body}`)
  }
  writeFileSync(join(outDir, "licences-full.txt"), sections.join("\n\n"))

  const rows = JSON.parse(readFileSync(join(outDir, "sources.json"), "utf8"))
  const installs = rows.map((row) => {
    const lines = (row.repo?.installLines ?? []).map((line) => "    " + line.trim()).join("\n")
    return `${row.key}\n  readme: ${row.repo?.readmeUrl ?? "(none)"}\n  npm: ${row.npm ? `${row.npm.name}@${row.npm.version} license=${row.npm.license}` : "(not on npm)"}\n${lines}`
  })
  writeFileSync(join(outDir, "installs.txt"), installs.join("\n\n") + "\n")
  console.log(`\nwrote unresolved.json, licences-full.txt, installs.txt to ${outDir}`)
}

await main()
