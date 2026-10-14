// The language → server catalog: our own data module for the LSP bootstrap.
//
// WHY THIS FILE EXISTS. Until the de-omo wave the LSP package carried an overlay that knew many
// languages. Its replacement (wave B2) knows exactly one — the TypeScript/JavaScript family, served by
// the `typescript-language-server` that the declared `cclsp` dependency happens to carry — so every
// other language regressed to "install a server and write the config yourself". This module restores
// the mapping as our own code, so the launcher can WRITE a config that names a server per language.
//
// FIELD DISCIPLINE, and why the five required fields exist:
//   * `server`         — the server's own name, as its project spells it.
//   * `licence`        — the SERVER's licence, never the language's and never a guess. Several servers
//                        in this table are NOT permissive (Eclipse JDT LS EPL-2.0, `terraform-ls`
//                        MPL-2.0, VHDL-LS MPL-2.0, texlab GPL-3.0, Intelephense's server proprietary)
//                        and no row may call them MIT; `NON_PERMISSIVE_SERVERS` is the standing guard.
//   * `installCommand` — the exact command a human runs. The catalog never installs anything, and
//                        nothing here may pull a package at request time (a `npx`-based argv would).
//   * `npmInstallable` — whether npm is a DOCUMENTED route for this server; a false sends the reader
//                        to the server's own instructions instead.
//   * `caveat`         — the one sentence a user must read before relying on the row.
// `extensions` are BARE (no leading dot) because that is what cclsp matches, and `command[0]` is the
// executable the launcher probes for on PATH (or in the workspace's `node_modules/.bin`).
//
// PROVENANCE DISCIPLINE. Every `licence` and every `installCommand` traces to a document that was
// FETCHED and can be re-opened — the package registry's own metadata, the repository's licence file,
// or the repository's README/install page (the sweep is `evidence/restore/s2/20261008T234820Z/research/`,
// its per-row result `sources.json`). A row where a fact could NOT be pinned to such a document is
// marked `verification: "unverified"`, and its caveat says `UNVERIFIED` out loud so the guide and the
// generated config cannot present a weak row as a checked one.

/** One language server the bootstrap can wire into a `cclsp.json`, with the facts a reader needs. */
export interface LanguageServerEntry {
  /** Stable language id, unique in the catalog and used in reports (`typescript`, `c-cpp`). */
  readonly language: string
  /** Human-readable name of the family this row covers. */
  readonly displayName: string
  /** The server's own name, as its project or package calls itself. */
  readonly server: string
  /** The server's licence, spelled as its own project spells it; never empty. */
  readonly licence: string
  /** Where the licence above is stated, so a reader can re-check it. */
  readonly licenceUrl: string
  /** The exact command a human runs to install the server; the catalog installs nothing itself. */
  readonly installCommand: string
  /** Whether npm is a documented install route for this server (`false` sends the reader elsewhere). */
  readonly npmInstallable: boolean
  /** The one sentence a user must read before relying on this server. */
  readonly caveat: string
  /** File extensions this row claims, BARE (no leading dot), as cclsp matches them. */
  readonly extensions: readonly string[]
  /** The argv cclsp spawns; `command[0]` is the executable the launcher probes for. */
  readonly command: readonly string[]
  /** The sources the licence and install facts were read from. */
  readonly citations: readonly string[]
  /** `primary` when every fact above traces to a fetched document; `unverified` when one does not. */
  readonly verification: "primary" | "unverified"
}

/** One way a catalog row can be wrong; the validator reports these instead of throwing. */
export interface CatalogViolation {
  /** The offending row's language id, or `#<index>` when the id itself is missing. */
  readonly language: string
  /** The field at fault (`licence`, `extensions`, `command`, …). */
  readonly field: string
  /** What is wrong with it, phrased for a report. */
  readonly detail: string
}

/** The five fields the S2 acceptance contract requires every row to carry; named once so the
 *  validator, the test and the README cannot drift apart. */
export const REQUIRED_ENTRY_FIELDS: readonly string[] = [
  "server",
  "licence",
  "installCommand",
  "npmInstallable",
  "caveat",
] as const

/** The string-valued fields that must be non-empty, checked in this order for a stable report. */
const REQUIRED_STRINGS: readonly (keyof LanguageServerEntry)[] = [
  "language",
  "displayName",
  "server",
  "licence",
  "licenceUrl",
  "installCommand",
  "caveat",
] as const

/** The shape a bare extension must have: lower-case, alphanumeric with `+`/`-`/`_`, and NO dot. */
const BARE_EXTENSION: RegExp = /^[a-z0-9][a-z0-9+_-]*$/

/** The marking an `unverified` row must carry at the START of its caveat, so the guide says so too. */
export const UNVERIFIED_MARKER: string = "UNVERIFIED"

/** A server whose licence is NOT permissive, matched against the catalog by a name keyword.
 *  The guard exists so the catalog (and the guide) can never describe one of these as MIT. */
export interface NonPermissiveServer {
  /** Lower-case keyword that identifies the server inside a catalog row's `server` name. */
  readonly match: string
  /** The licence substring the row must carry, as the server's own project states it. */
  readonly licence: string
}

/** The servers whose licence is NOT permissive; the catalog must never call one of them MIT.
 *  The first four are the ones the contract names; the rest were found while researching and are
 *  guarded with the same discipline — a row matching one of these must carry the real licence. */
export const NON_PERMISSIVE_SERVERS: readonly NonPermissiveServer[] = [
  { match: "jdt", licence: "EPL-2.0" },
  { match: "terraform-ls", licence: "MPL-2.0" },
  { match: "intelephense", licence: "proprietary" },
  { match: "c# dev kit", licence: "proprietary" },
  { match: "lemminx", licence: "EPL-2.0" },
  { match: "nixd", licence: "LGPL-3.0" },
  { match: "vhdl", licence: "MPL-2.0" },
  { match: "texlab", licence: "GPL-3.0" }
] as const

/** A row where the CONTRACT and the primary source disagree, recorded rather than reconciled.
 *  The guard for these is the opposite of the one above: the licence may be permissive, and what must
 *  hold is that the row SAYS SO and names the proprietary product beside it. */
export interface LicenceDispute {
  /** Lower-case keyword that identifies the disputed row inside a catalog row's `server` name. */
  readonly match: string
  /** What the contract claims about this server. */
  readonly contractClaim: string
  /** What the primary source says instead, with the source named. */
  readonly sourceSays: string
  /** The phrase the row's caveat must contain, so the disagreement is visible to a reader. */
  readonly caveatMustMention: string
}

/** The licence DISPUTES this catalog carries, each recorded rather than silently resolved. */
export const LICENCE_DISPUTES: readonly LicenceDispute[] = [
  {
    match: "c# dev kit",
    contractClaim: "the contract §3 S2 lists Roslyn/C# Dev Kit among the four NOT permissive servers",
    sourceSays: "the C# Dev Kit PRODUCT ships Microsoft's Roslyn-based language server with no licence file at all, while the standalone NuGet package `roslyn-language-server` declares MIT and the Roslyn COMPILER is MIT — the contract's claim is about the product and is upheld here",
    caveatMustMention: "C# Dev Kit"
  },
  {
    match: "protols",
    contractClaim: "the matrix reports that upstream protols has NO licence file, so it is all-rights-reserved by default",
    sourceSays: "the upstream repository is coder3101/protols, whose LICENSE file was fetched and read as MIT (c) 2024 Ashar; the URL the matrix checked (c4pt0r/protols) returns 404 and is not this project",
    caveatMustMention: "coder3101"
  }
] as const

/** One npm package name that LOOKS like a language server and must never be wired: the real server is
 *  a toolchain install, and the npm package under that name is a placeholder or another project. */
export interface NpmTrap {
  /** The npm package name that is the trap. */
  readonly package: string
  /** What the package actually is, and where the real server comes from. */
  readonly reason: string
}

/** The npm TRAPS found while researching: no generated install command may point at one of these. */
export const NPM_TRAPS: readonly NpmTrap[] = [
  { package: "gopls", reason: "a 0.0.1-security placeholder with no bin; the real gopls is a Go toolchain install" },
  { package: "rust-analyzer", reason: "a 0.0.1-security placeholder with no bin; the real rust-analyzer came from rustup" },
  { package: "clangd", reason: "an empty 0.0.0 package with no bin; the real clangd ships with LLVM" },
  { package: "zls", reason: "a third-party wrapper unrelated to zigtools/zls; the real zls ships as a release binary" },
  { package: "marksman", reason: "an UNRELATED project (fussydesigns/marksman); the real marksman is artempyanykh/marksman" }
] as const

/**
 * Check a catalog for the contract's field discipline.
 *
 * The rules are deliberately structural, so the test can feed a mutated copy and watch the SAME
 * function redden — the negative control the acceptance contract asks for.
 *
 * @param entries the catalog rows to check; an entry that is not an object is reported as `#<index>`.
 * @returns one violation per defect, in row order; an empty array means the catalog is well-formed.
 */
export function validateServerCatalog(entries: readonly LanguageServerEntry[]): readonly CatalogViolation[] {
  /** Violations accumulated in row order. */
  const violations: CatalogViolation[] = []
  /** Language ids already seen, so a duplicate id is reported instead of silently shadowing. */
  const seenLanguages: Map<string, number> = new Map()
  /** Extension → language id that claimed it first, so an ambiguous routing is reported. */
  const seenExtensions: Map<string, string> = new Map()

  entries.forEach((entry: LanguageServerEntry, index: number): void => {
    /** The row as an unknown value: a catalog a test mutates is not guaranteed to be shaped like the
     *  type, and the validator's whole job is to SAY so rather than crash on a missing field. */
    const candidate: unknown = entry
    if (candidate === null || typeof candidate !== "object") {
      violations.push({ language: `#${index}`, field: "entry", detail: "row is not an object" })
      return
    }
    /** The row, safe to read field by field because every field below is validated before it is used
     *  — the cast only restores the static type the caller claimed. */
    const row: LanguageServerEntry = candidate as LanguageServerEntry
    /** This row's label in a report: its id when present, its index otherwise. */
    const label: string = typeof row.language === "string" && row.language.trim().length > 0 ? row.language : `#${index}`
    for (const field of REQUIRED_STRINGS) {
      /** The raw value of the required string field under test. */
      const value: unknown = row[field]
      if (typeof value !== "string" || value.trim().length === 0) {
        violations.push({ language: label, field, detail: typeof value === "string" ? "is an empty string" : "is missing" })
      }
    }
    if (typeof row.npmInstallable !== "boolean") {
      violations.push({ language: label, field: "npmInstallable", detail: "must be a boolean" })
    }
    if (row.verification !== "primary" && row.verification !== "unverified") {
      violations.push({ language: label, field: "verification", detail: "must be `primary` or `unverified`" })
    }
    if (row.verification === "unverified" && typeof row.caveat === "string" && !row.caveat.startsWith(UNVERIFIED_MARKER)) {
      violations.push({ language: label, field: "caveat", detail: `an unverified row must open its caveat with ${UNVERIFIED_MARKER}` })
    }
    if (!Array.isArray(row.extensions) || row.extensions.length === 0) {
      violations.push({ language: label, field: "extensions", detail: "must be a non-empty array" })
    } else {
      row.extensions.forEach((extension: string): void => {
        if (typeof extension !== "string" || !BARE_EXTENSION.test(extension)) {
          violations.push({ language: label, field: "extensions", detail: `${JSON.stringify(extension)} is not a bare extension (no dot, lower-case)` })
          return
        }
        /** The language id that claimed this extension before, if any. */
        const owner: string | undefined = seenExtensions.get(extension)
        if (owner !== undefined) {
          violations.push({ language: label, field: "extensions", detail: `${extension} is already claimed by ${owner}` })
          return
        }
        seenExtensions.set(extension, label)
      })
    }
    if (!Array.isArray(row.command) || row.command.length === 0 || row.command.some((part: string): boolean => typeof part !== "string" || part.trim().length === 0)) {
      violations.push({ language: label, field: "command", detail: "must be a non-empty argv of non-empty strings" })
    }
    if (!Array.isArray(row.citations) || row.citations.length === 0 || row.citations.some((part: string): boolean => typeof part !== "string" || part.trim().length === 0)) {
      violations.push({ language: label, field: "citations", detail: "must name at least one source" })
    }
    /** The index a previous row used for this language id, if the id was already seen. */
    const previous: number | undefined = seenLanguages.get(label)
    if (previous !== undefined) {
      violations.push({ language: label, field: "language", detail: `duplicate language id (also at index ${previous})` })
    } else {
      seenLanguages.set(label, index)
    }
  })

  return violations
}

/** The registry page a row's npm facts were read from. */
const npmPage = (name: string): string => `https://www.npmjs.com/package/${name}`
/** The npm registry document itself, which is where the `license` and `bin` fields were read. */
const npmDoc = (name: string): string => `https://registry.npmjs.org/${name.replace("/", "%2f")}/latest`
/** A repository document (licence file, README, install page) as fetched from its default branch. */
const repoDoc = (repo: string, path: string): string => `https://raw.githubusercontent.com/${repo}/HEAD/${path}`
/** A repository's README. */
const readme = (repo: string): string => repoDoc(repo, "README.md")

/**
 * The shipped catalog: one row per language family the bootstrap can wire.
 *
 * SIZE IS THE ACCEPTANCE CONTRACT, not a preference: the S2 goal is the FULL ~40-language set, and
 * `packages/mpd-mcp-lsp/test/language-coverage.test.ts` reddens below it. Every row here was
 * researched from a primary source (see PROVENANCE DISCIPLINE at the top of this file; the sweep and
 * its per-row result live under `evidence/restore/s2/20261008T234820Z/research/`). A row whose
 * install command or argv could not be pinned to a fetched document is marked `unverified` and says
 * so in its caveat. The language matrix that arrives later is RECONCILED into this table: a better
 * citation wins, the union is kept, and a disagreement is recorded in `LICENCE_DISPUTES` rather than
 * silently resolved.
 */
export const LANGUAGE_SERVERS: readonly LanguageServerEntry[] = [
  {
    language: "typescript",
    displayName: "TypeScript / JavaScript",
    server: "typescript-language-server",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("typescript-language-server/typescript-language-server", "LICENSE"),
    installCommand: "npm install -g typescript-language-server typescript",
    npmInstallable: true,
    caveat: "Ships with the bundle: the declared `cclsp` dependency carries it, so no user install is needed for TS/JS. The launcher points at that copy through the running node, never at a PATH one.",
    extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"],
    command: ["typescript-language-server", "--stdio"],
    citations: [npmPage("typescript-language-server"), repoDoc("typescript-language-server/typescript-language-server", "LICENSE"), readme("typescript-language-server/typescript-language-server")],
    verification: "primary"
  },
  {
    language: "python",
    displayName: "Python",
    server: "pyright",
    licence: "MIT",
    licenceUrl: repoDoc("microsoft/pyright", "LICENSE.txt"),
    installCommand: "npm install -g pyright (the pip route is: pip install pyright)",
    npmInstallable: true,
    caveat: "`basedpyright` is a drop-in alternative with the same CLI shape; because the generated config names only the server this row carries, switching to it means naming `basedpyright-langserver` in a workspace `cclsp.json`.",
    extensions: ["py", "pyi"],
    command: ["pyright-langserver", "--stdio"],
    citations: [npmPage("pyright"), repoDoc("microsoft/pyright", "LICENSE.txt")],
    verification: "primary"
  },
  {
    language: "go",
    displayName: "Go",
    server: "gopls",
    licence: "BSD-3-Clause",
    licenceUrl: repoDoc("golang/tools", "LICENSE"),
    installCommand: "go install golang.org/x/tools/gopls@latest",
    npmInstallable: false,
    caveat: "UNVERIFIED for the install command: it is the canonical Go-toolchain install but was NOT read verbatim from a project document in this session. `npm install -g gopls` is a TRAP — that package is a 0.0.1-security placeholder with no bin. The module path pins no version, so re-running the command is what updates gopls.",
    extensions: ["go"],
    command: ["gopls"],
    citations: [repoDoc("golang/tools", "LICENSE")],
    verification: "unverified"
  },
  {
    language: "rust",
    displayName: "Rust",
    server: "rust-analyzer",
    licence: "MIT OR Apache-2.0",
    licenceUrl: repoDoc("rust-lang/rust-analyzer", "LICENSE-MIT"),
    installCommand: "rustup component add rust-analyzer",
    npmInstallable: false,
    caveat: "Shipped through rustup so it tracks your toolchain, which is the point: a standalone rust-analyzer that does not match the toolchain is the usual source of proc-macro errors.",
    extensions: ["rs"],
    command: ["rust-analyzer"],
    citations: [repoDoc("rust-lang/rust-analyzer", "LICENSE-MIT"), repoDoc("rust-lang/rust-analyzer", "LICENSE-APACHE"), "https://rust-analyzer.github.io/book/installation.html"],
    verification: "primary"
  },
  {
    language: "c-cpp",
    displayName: "C / C++",
    server: "clangd",
    licence: "Apache-2.0 WITH LLVM-exception",
    licenceUrl: repoDoc("llvm/llvm-project", "LICENSE.TXT"),
    installCommand: "Install your distribution's clangd package (apt install clangd, brew install llvm), or download a release from https://github.com/llvm/llvm-project/releases",
    npmInstallable: false,
    caveat: "clangd needs a compile-commands database to be useful: generate `compile_commands.json` (CMake: -DCMAKE_EXPORT_COMPILE_COMMANDS=ON) at the workspace root, or diagnostics stay at syntax level.",
    extensions: ["c", "cpp", "cc", "cxx", "c++", "h", "hpp", "hh", "hxx", "h++"],
    command: ["clangd", "--background-index", "--clang-tidy"],
    citations: [repoDoc("llvm/llvm-project", "LICENSE.TXT")],
    verification: "primary"
  },
  {
    language: "objective-c",
    displayName: "Objective-C",
    server: "clangd",
    licence: "Apache-2.0 WITH LLVM-exception",
    licenceUrl: repoDoc("llvm/llvm-project", "LICENSE.TXT"),
    installCommand: "Install your distribution's clangd package (apt install clangd, brew install llvm), or download a release from https://github.com/llvm/llvm-project/releases",
    npmInstallable: false,
    caveat: "This row resolves to the SAME clangd binary as the C/C++ row, so the two merge into one server process in the generated config; Xcode's own indexer is not involved.",
    extensions: ["m", "mm"],
    command: ["clangd", "--background-index", "--clang-tidy"],
    citations: [repoDoc("llvm/llvm-project", "LICENSE.TXT")],
    verification: "primary"
  },
  {
    language: "java",
    displayName: "Java",
    server: "Eclipse JDT LS",
    licence: "EPL-2.0",
    licenceUrl: repoDoc("eclipse-jdtls/eclipse.jdt.ls", "LICENSE"),
    installCommand: "Download and extract a milestone build from https://download.eclipse.org/jdtls/milestones/ and put the launcher on PATH",
    npmInstallable: false,
    caveat: "UNVERIFIED for the launcher name: the project README documents the download and extract steps but not the executable they yield, so the argv below is the community convention rather than a quoted command. NOT permissive: EPL-2.0 (weak copyleft) — spawned from the user's install, never redistributed here.",
    extensions: ["java"],
    command: ["jdtls"],
    citations: [repoDoc("eclipse-jdtls/eclipse.jdt.ls", "LICENSE"), readme("eclipse-jdtls/eclipse.jdt.ls")],
    verification: "unverified"
  },
  {
    language: "kotlin",
    displayName: "Kotlin",
    server: "kotlin-lsp",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("Kotlin/kotlin-lsp", "LICENSE.txt"),
    installCommand: "brew install JetBrains/utils/kotlin-lsp",
    npmInstallable: false,
    caveat: "JetBrains' own server, distributed today mainly as editor extensions and release zips; the Homebrew tap is the only one-command route its README quotes. The independently researched matrix carries `fwcd/kotlin-language-server` (MIT) for the same extensions; it is a real alternative, and switching to it means naming `kotlin-language-server` in a workspace `cclsp.json`.",
    extensions: ["kt", "kts"],
    command: ["kotlin-lsp"],
    citations: [repoDoc("Kotlin/kotlin-lsp", "LICENSE.txt"), readme("Kotlin/kotlin-lsp"), "evidence/restore/matrix/20261008T235658Z-lsp-language-matrix.md (row 6, the fwcd alternative)"],
    verification: "primary"
  },
  {
    language: "csharp",
    displayName: "C#",
    server: "csharp-ls",
    licence: "MIT",
    licenceUrl: repoDoc("razzmatazz/csharp-language-server", "LICENSE"),
    installCommand: "dotnet tool install --global csharp-ls",
    npmInstallable: false,
    caveat: "A community server rather than Microsoft's: it needs the .NET SDK on PATH and gives you a language service without the C# Dev Kit product. The researched matrix could not read a licence file at the old `Razor/csharp-ls` coordinates (404 today); the project's CURRENT home `razzmatazz/csharp-language-server` carries the MIT LICENSE cited here.",
    extensions: ["cs"],
    command: ["csharp-ls"],
    citations: [repoDoc("razzmatazz/csharp-language-server", "LICENSE"), readme("razzmatazz/csharp-language-server"), "evidence/restore/matrix/20261008T235658Z-lsp-language-matrix.md (row 8c — the coordinates it could not read)"],
    verification: "primary"
  },
  {
    language: "razor",
    displayName: "Razor / ASP.NET views",
    server: "C# Dev Kit language server (Microsoft)",
    licence: "proprietary",
    licenceUrl: "https://api.nuget.org/v3-flatcontainer/roslyn-language-server/5.12.0-1.26475.2/roslyn-language-server.nuspec",
    installCommand: "Install the C# Dev Kit extension in your editor (Visual Studio Code: ms-dotnettools.csdevkit), or the standalone NuGet tool with `dotnet tool install --global roslyn-language-server`",
    npmInstallable: false,
    caveat: "NOT permissive, and the nuance is recorded rather than flattened: the C# Dev Kit PRODUCT ships Microsoft's Roslyn-based language server under no licence file at all, while the standalone NuGet package `roslyn-language-server` declares MIT and the Roslyn COMPILER is MIT. Never write `Roslyn is proprietary` and never write `Roslyn is MIT` as if that covered the shipped C# Dev Kit server — the permissive C# path in this catalog is the `csharp-ls` row.",
    extensions: ["razor", "cshtml"],
    command: ["roslyn-language-server", "--stdio"],
    citations: ["https://api.nuget.org/v3-flatcontainer/roslyn-language-server/index.json", "https://api.nuget.org/v3-flatcontainer/roslyn-language-server/5.12.0-1.26475.2/roslyn-language-server.nuspec", repoDoc("dotnet/roslyn", "License.txt"), repoDoc("microsoft/vscode-csharp", "README.md")],
    verification: "primary"
  },
  {
    language: "swift",
    displayName: "Swift",
    server: "sourcekit-lsp",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("swiftlang/sourcekit-lsp", "LICENSE.txt"),
    installCommand: "Comes with the Swift toolchain: install one from https://swift.org/install/ (on macOS it is bundled with Xcode)",
    npmInstallable: false,
    caveat: "There is no separate install: if sourcekit-lsp is missing, the Swift toolchain is what to install, and on macOS `xcode-select --install` is what provides it.",
    extensions: ["swift"],
    command: ["sourcekit-lsp"],
    citations: [repoDoc("swiftlang/sourcekit-lsp", "LICENSE.txt"), readme("swiftlang/sourcekit-lsp")],
    verification: "primary"
  },
  {
    language: "ruby",
    displayName: "Ruby",
    server: "ruby-lsp",
    licence: "MIT",
    licenceUrl: repoDoc("Shopify/ruby-lsp", "LICENSE.txt"),
    installCommand: "gem install ruby-lsp",
    npmInstallable: false,
    caveat: "Shopify's server, published on RubyGems; a project with its own Gemfile usually wants the gem added there too, so the editor and the project agree on the version.",
    extensions: ["rb", "rake", "gemspec", "ru"],
    command: ["ruby-lsp"],
    citations: [repoDoc("Shopify/ruby-lsp", "LICENSE.txt"), "https://rubygems.org/api/v1/gems/ruby-lsp.json"],
    verification: "primary"
  },
  {
    language: "php",
    displayName: "PHP",
    server: "Intelephense",
    licence: "proprietary",
    licenceUrl: repoDoc("bmewburn/vscode-intelephense", "LICENSE.txt"),
    installCommand: "npm install -g intelephense",
    npmInstallable: true,
    caveat: "NOT permissive: the repository LICENSE.txt carries an MIT section for the CLIENT application and a separate `Intelephense Licence` for the server, where Premium Features need a purchased Licence Key. `phpactor` (MIT) is the permissive alternative, but switching is a hand-written `cclsp.json` because the generated config names one PHP server.",
    extensions: ["php"],
    command: ["intelephense", "--stdio"],
    citations: [npmPage("intelephense"), repoDoc("bmewburn/vscode-intelephense", "LICENSE.txt")],
    verification: "primary"
  },
  {
    language: "dart",
    displayName: "Dart / Flutter",
    server: "Dart SDK language server",
    licence: "BSD-3-Clause",
    licenceUrl: repoDoc("dart-lang/sdk", "LICENSE"),
    installCommand: "Comes with the Dart SDK: install one from https://dart.dev/get-dart",
    npmInstallable: false,
    caveat: "UNVERIFIED for the argv: the SDK repository does not document the language-server subcommand, so `dart language-server --lsp` is the convention published on dart.dev rather than a line quoted from the repository. Requires `dart` on PATH.",
    extensions: ["dart"],
    command: ["dart", "language-server", "--lsp"],
    citations: [repoDoc("dart-lang/sdk", "LICENSE")],
    verification: "unverified"
  },
  {
    language: "elixir",
    displayName: "Elixir",
    server: "ElixirLS",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("elixir-lsp/elixir-ls", "LICENSE"),
    installCommand: "Download the release archive from https://github.com/elixir-lsp/elixir-ls/releases/latest and unzip it",
    npmInstallable: false,
    caveat: "The archive ships `language_server.sh`, which is the executable this row probes for — put that name on PATH; ElixirLS is distributed as a release directory rather than a single binary.",
    extensions: ["ex", "exs"],
    command: ["language_server.sh"],
    citations: [repoDoc("elixir-lsp/elixir-ls", "LICENSE"), readme("elixir-lsp/elixir-ls")],
    verification: "primary"
  },
  {
    language: "zig",
    displayName: "Zig",
    server: "zls",
    licence: "MIT",
    licenceUrl: repoDoc("zigtools/zls", "LICENSE"),
    installCommand: "See the install guide at https://zigtools.org/zls/install/ (prebuilt binaries and package-manager routes)",
    npmInstallable: false,
    caveat: "UNVERIFIED for the install command: the README points at an install PAGE rather than quoting a command. `npm install -g zls` is a TRAP — that package is a third-party wrapper (Sarvesh-SP/zls), not zigtools/zls. The release you download must target your Zig version: zls follows Zig master, and a mismatched pair refuses to start.",
    extensions: ["zig", "zon"],
    command: ["zls"],
    citations: [repoDoc("zigtools/zls", "LICENSE"), readme("zigtools/zls")],
    verification: "unverified"
  },
  {
    language: "lua",
    displayName: "Lua",
    server: "lua-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("LuaLS/lua-language-server", "LICENSE"),
    installCommand: "See the install instructions at https://luals.github.io/#install (community packages such as brew install lua-language-server)",
    npmInstallable: false,
    caveat: "UNVERIFIED for the exact command: the repository README points at the project website for installation, so no install line could be quoted from it. The probed executable name is the project's own.",
    extensions: ["lua"],
    command: ["lua-language-server"],
    citations: [repoDoc("LuaLS/lua-language-server", "LICENSE"), readme("LuaLS/lua-language-server")],
    verification: "unverified"
  },
  {
    language: "bash",
    displayName: "Shell (bash / zsh)",
    server: "bash-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("bash-lsp/bash-language-server", "LICENSE"),
    installCommand: "npm install -g bash-language-server",
    npmInstallable: true,
    caveat: "Its linting is only as good as `shellcheck`: without shellcheck the server starts and answers, but the diagnostics are mostly empty.",
    extensions: ["sh", "bash", "zsh", "ksh"],
    command: ["bash-language-server", "start"],
    citations: [npmPage("bash-language-server"), repoDoc("bash-lsp/bash-language-server", "LICENSE")],
    verification: "primary"
  },
  {
    language: "yaml",
    displayName: "YAML",
    server: "yaml-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("redhat-developer/yaml-language-server", "LICENSE"),
    installCommand: "npm install -g yaml-language-server",
    npmInstallable: true,
    caveat: "Schema validation is opt-in: a `# yaml-language-server: $schema=<url>` comment at the top of a file is what turns a bare YAML parse into real diagnostics.",
    extensions: ["yaml", "yml"],
    command: ["yaml-language-server", "--stdio"],
    citations: [npmPage("yaml-language-server"), repoDoc("redhat-developer/yaml-language-server", "LICENSE")],
    verification: "primary"
  },
  {
    language: "json",
    displayName: "JSON / JSONC",
    server: "vscode-json-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("hrsh7th/vscode-langservers-extracted", "LICENSE"),
    installCommand: "npm i -g vscode-langservers-extracted",
    npmInstallable: true,
    caveat: "One npm package carries the JSON, HTML, CSS and Markdown servers, so installing it wires several rows here at once; it is a REPACKAGE of Microsoft's language servers rather than an official Microsoft release.",
    extensions: ["json", "jsonc"],
    command: ["vscode-json-language-server", "--stdio"],
    citations: [npmDoc("vscode-langservers-extracted"), repoDoc("hrsh7th/vscode-langservers-extracted", "LICENSE"), readme("hrsh7th/vscode-langservers-extracted")],
    verification: "primary"
  },
  {
    language: "html",
    displayName: "HTML",
    server: "vscode-html-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("hrsh7th/vscode-langservers-extracted", "LICENSE"),
    installCommand: "npm i -g vscode-langservers-extracted",
    npmInstallable: true,
    caveat: "Same package as the JSON and CSS rows, so one install wires three languages; embedded CSS and JavaScript inside HTML is a known weak spot of this server.",
    extensions: ["html", "htm"],
    command: ["vscode-html-language-server", "--stdio"],
    citations: [npmDoc("vscode-langservers-extracted"), repoDoc("hrsh7th/vscode-langservers-extracted", "LICENSE")],
    verification: "primary"
  },
  {
    language: "css",
    displayName: "CSS / SCSS / Less",
    server: "vscode-css-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("hrsh7th/vscode-langservers-extracted", "LICENSE"),
    installCommand: "npm i -g vscode-langservers-extracted",
    npmInstallable: true,
    caveat: "Framework-specific at-rules (Tailwind directives, CSS modules) produce unknown-at-rule diagnostics with this server; a project that lives in them wants a framework-aware server instead, wired by hand in `cclsp.json`.",
    extensions: ["css", "scss", "less"],
    command: ["vscode-css-language-server", "--stdio"],
    citations: [npmDoc("vscode-langservers-extracted"), repoDoc("hrsh7th/vscode-langservers-extracted", "LICENSE")],
    verification: "primary"
  },
  {
    language: "markdown",
    displayName: "Markdown",
    server: "marksman",
    licence: "MIT",
    licenceUrl: repoDoc("artempyanykh/marksman", "LICENSE"),
    installCommand: "brew install marksman",
    npmInstallable: false,
    caveat: "Cross-file link completion is what marksman adds beyond a plain parser; it resolves wiki-style links within one directory tree, so a scattered documentation set gets less out of it.",
    extensions: ["md", "markdown"],
    command: ["marksman", "server"],
    citations: [repoDoc("artempyanykh/marksman", "LICENSE"), repoDoc("artempyanykh/marksman", "docs/install.md")],
    verification: "primary"
  },
  {
    language: "dockerfile",
    displayName: "Dockerfile",
    server: "dockerfile-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("rcjsuen/dockerfile-language-server", "License.txt"),
    installCommand: "npm install -g dockerfile-language-server-nodejs",
    npmInstallable: true,
    caveat: "cclsp routes by FILE EXTENSION and `Dockerfile` has none — only `name.dockerfile` reaches this row, so a plain `Dockerfile` stays unrouted and fails with cclsp's own message.",
    extensions: ["dockerfile"],
    command: ["docker-langserver", "--stdio"],
    citations: [npmPage("dockerfile-language-server-nodejs"), repoDoc("rcjsuen/dockerfile-language-server", "License.txt")],
    verification: "primary"
  },
  {
    language: "terraform",
    displayName: "Terraform / HCL",
    server: "terraform-ls",
    licence: "MPL-2.0",
    licenceUrl: repoDoc("hashicorp/terraform-ls", "LICENSE"),
    installCommand: "brew install hashicorp/tap/terraform-ls",
    npmInstallable: false,
    caveat: "NOT permissive: MPL-2.0 (file-level copyleft). HashiCorp's own server, spawned from the user's install and never redistributed here.",
    extensions: ["tf", "tfvars"],
    command: ["terraform-ls", "serve"],
    citations: [repoDoc("hashicorp/terraform-ls", "LICENSE"), repoDoc("hashicorp/terraform-ls", "docs/installation.md")],
    verification: "primary"
  },
  {
    language: "haskell",
    displayName: "Haskell",
    server: "haskell-language-server",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("haskell/haskell-language-server", "LICENSE"),
    installCommand: "brew install haskell-language-server",
    npmInstallable: false,
    caveat: "It needs a GHC matching the project and a build plan (an hie.yaml, or plain cabal/stack layout); `ghcup install hls` is the usual route when the project pins its own GHC.",
    extensions: ["hs", "lhs"],
    command: ["haskell-language-server-wrapper", "--lsp"],
    citations: [repoDoc("haskell/haskell-language-server", "LICENSE"), repoDoc("haskell/haskell-language-server", "docs/installation.md")],
    verification: "primary"
  },
  {
    language: "julia",
    displayName: "Julia",
    server: "LanguageServer.jl",
    licence: "MIT",
    licenceUrl: repoDoc("julia-vscode/LanguageServer.jl", "LICENSE.md"),
    installCommand: "julia -e 'using Pkg; Pkg.add(\"LanguageServer\")'",
    npmInstallable: false,
    caveat: "UNVERIFIED for the argv: the package README documents installing LanguageServer.jl, while the `runserver()` invocation below is the client convention rather than a quoted line. The project must be in the julia process's load path for cross-file facts.",
    extensions: ["jl"],
    command: ["julia", "--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"],
    citations: [repoDoc("julia-vscode/LanguageServer.jl", "LICENSE.md"), readme("julia-vscode/LanguageServer.jl")],
    verification: "unverified"
  },
  {
    language: "toml",
    displayName: "TOML",
    server: "taplo",
    licence: "MIT",
    licenceUrl: repoDoc("tamasfe/taplo", "LICENSE"),
    installCommand: "npm install -g @taplo/cli",
    npmInstallable: true,
    caveat: "UNVERIFIED for the argv: the package name, version and MIT licence are confirmed from the registry, but the `lsp stdio` subcommand was not quoted from a fetched document. Schema-aware completion comes from the file's own `#:schema` directive.",
    extensions: ["toml"],
    command: ["taplo", "lsp", "stdio"],
    citations: [npmDoc("@taplo/cli"), repoDoc("tamasfe/taplo", "LICENSE")],
    verification: "unverified"
  },
  {
    language: "vue",
    displayName: "Vue",
    server: "Vue language server",
    licence: "MIT",
    licenceUrl: repoDoc("vuejs/language-tools", "LICENSE"),
    installCommand: "npm install -g @vue/language-server",
    npmInstallable: true,
    caveat: "Needs the project's own TypeScript for accurate types; a global install can drift from the version the project expects, so a pinned project-local copy named in `cclsp.json` is often the better wiring.",
    extensions: ["vue"],
    command: ["vue-language-server", "--stdio"],
    citations: [npmDoc("@vue/language-server"), repoDoc("vuejs/language-tools", "LICENSE")],
    verification: "primary"
  },
  {
    language: "svelte",
    displayName: "Svelte",
    server: "Svelte language server",
    licence: "MIT",
    licenceUrl: repoDoc("sveltejs/language-tools", "LICENSE"),
    installCommand: "npm install -g svelte-language-server",
    npmInstallable: true,
    caveat: "The executable is `svelteserver`, not the package name — that mismatch is why this row's probe names the binary rather than the package.",
    extensions: ["svelte"],
    command: ["svelteserver", "--stdio"],
    citations: [npmDoc("svelte-language-server"), repoDoc("sveltejs/language-tools", "LICENSE")],
    verification: "primary"
  },
  {
    language: "graphql",
    displayName: "GraphQL",
    server: "graphql-language-service",
    licence: "MIT",
    licenceUrl: npmPage("graphql-language-service-cli"),
    installCommand: "npm install -g graphql-language-service-cli",
    npmInstallable: true,
    caveat: "UNVERIFIED for the argv: the registry confirms the package, its MIT licence and its `graphql-lsp` binary, but the `server -m stream` subcommand was not quoted from a fetched README. The project schema is discovered through .graphqlrc rather than inferred.",
    extensions: ["graphql", "gql"],
    command: ["graphql-lsp", "server", "-m", "stream"],
    citations: [npmDoc("graphql-language-service-cli")],
    verification: "unverified"
  },
  {
    language: "sql",
    displayName: "SQL",
    server: "sql-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("joe-re/sql-language-server", "LICENSE"),
    installCommand: "npm install -g sql-language-server",
    npmInstallable: true,
    caveat: "UNVERIFIED for the argv: the package and its MIT licence are confirmed from the registry, while the `up --method stdio` subcommand comes from the repository README rather than a fetched line. Without a workspace config it answers with no schema.",
    extensions: ["sql"],
    command: ["sql-language-server", "up", "--method", "stdio"],
    citations: [npmDoc("sql-language-server"), repoDoc("joe-re/sql-language-server", "LICENSE")],
    verification: "unverified"
  },
  {
    language: "cmake",
    displayName: "CMake",
    server: "cmake-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("regen100/cmake-language-server", "LICENSE"),
    installCommand: "pip install cmake-language-server",
    npmInstallable: false,
    caveat: "Deliberately NOT on npm — the project publishes on PyPI, which is why this row sets npm-eligibility false even though the server is Python-packaged.",
    extensions: ["cmake"],
    command: ["cmake-language-server"],
    citations: [repoDoc("regen100/cmake-language-server", "LICENSE"), readme("regen100/cmake-language-server")],
    verification: "primary"
  },
  {
    language: "protobuf",
    displayName: "Protocol Buffers",
    server: "protols",
    licence: "MIT",
    licenceUrl: repoDoc("coder3101/protols", "LICENSE"),
    installCommand: "cargo install protols",
    npmInstallable: false,
    caveat: "A young server: it parses proto2/proto3 with tree-sitter, so imports resolve relative to the workspace root rather than through a compiler's include path. LICENCE DISPUTE, recorded not silently resolved: the researched matrix reported NO licence file upstream and treated the project as all-rights-reserved, but the upstream repository is coder3101/protols — its LICENSE file was fetched here and reads MIT (c) 2024 Ashar. The URL the matrix checked (c4pt0r/protols) returns 404 and is a different repository. The permissive alternative with a vendor-backed licence is `buf` (Apache-2.0), wired in a workspace `cclsp.json`.",
    extensions: ["proto"],
    command: ["protols"],
    citations: [repoDoc("coder3101/protols", "LICENSE"), readme("coder3101/protols"), "evidence/restore/matrix/20261008T235658Z-lsp-language-matrix.md (row 41b — its coordinates 404; this read is the primary one)"],
    verification: "primary"
  },
  {
    language: "nix",
    displayName: "Nix",
    server: "nil",
    licence: "MIT OR Apache-2.0",
    licenceUrl: repoDoc("oxalica/nil", "LICENSE-MIT"),
    installCommand: "nix profile install nixpkgs#nil",
    npmInstallable: false,
    caveat: "`nixd` is the other maintained Nix server, aimed at flakes and nixpkgs evaluation, and it is NOT permissive (LGPL-3.0); this row carries nil (MIT OR Apache-2.0) because its install is one command on a machine that already runs Nix.",
    extensions: ["nix"],
    command: ["nil"],
    citations: [repoDoc("oxalica/nil", "LICENSE-MIT"), repoDoc("oxalica/nil", "LICENSE-APACHE"), readme("oxalica/nil")],
    verification: "primary"
  },
  {
    language: "clojure",
    displayName: "Clojure",
    server: "clojure-lsp",
    licence: "MIT",
    licenceUrl: repoDoc("clojure-lsp/clojure-lsp", "LICENSE"),
    installCommand: "brew install clojure-lsp/brew/clojure-lsp-native",
    npmInstallable: false,
    caveat: "The native image is the fast route; open the project at its root so the server can find the classpath, and give it a moment on the first run while it caches the analysis.",
    extensions: ["clj", "cljs", "cljc", "edn"],
    command: ["clojure-lsp"],
    citations: [repoDoc("clojure-lsp/clojure-lsp", "LICENSE"), repoDoc("clojure-lsp/clojure-lsp", "docs/installation.md")],
    verification: "primary"
  },
  {
    language: "erlang",
    displayName: "Erlang",
    server: "erlang_ls",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("erlang-ls/erlang_ls", "LICENSE"),
    installCommand: "Build from a checkout: `make` then `make install` (PREFIX=/path make install for a custom prefix)",
    npmInstallable: false,
    caveat: "Distributed as an escript you build yourself; it expects a rebar3 or erlang.mk project layout to find the OTP applications in the workspace.",
    extensions: ["erl", "hrl"],
    command: ["erlang_ls"],
    citations: [repoDoc("erlang-ls/erlang_ls", "LICENSE"), readme("erlang-ls/erlang_ls")],
    verification: "primary"
  },
  {
    language: "gleam",
    displayName: "Gleam",
    server: "Gleam CLI (`gleam lsp`)",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("gleam-lang/gleam", "LICENSE"),
    installCommand: "Install the Gleam CLI from https://gleam.run/getting-started/installing/",
    npmInstallable: false,
    caveat: "UNVERIFIED for the argv: the language server is a subcommand of the compiler CLI rather than a separate binary, and no install line for it could be quoted from a fetched document. Requires the Gleam CLI on PATH.",
    extensions: ["gleam"],
    command: ["gleam", "lsp"],
    citations: [repoDoc("gleam-lang/gleam", "LICENSE")],
    verification: "unverified"
  },
  {
    language: "r",
    displayName: "R",
    server: "languageserver",
    licence: "MIT",
    licenceUrl: repoDoc("REditorSupport/languageserver", "DESCRIPTION"),
    installCommand: "R -e 'install.packages(\"languageserver\")'",
    npmInstallable: false,
    caveat: "UNVERIFIED for the argv: the package DESCRIPTION declares `License: MIT + file LICENSE` and the README documents the CRAN install, while the `languageserver::run()` invocation is the client convention. The probe therefore looks for `R`, which must be on PATH.",
    extensions: ["r", "rmd"],
    command: ["R", "--slave", "-e", "languageserver::run()"],
    citations: [repoDoc("REditorSupport/languageserver", "DESCRIPTION"), repoDoc("REditorSupport/languageserver", "LICENSE"), readme("REditorSupport/languageserver")],
    verification: "unverified"
  },
  {
    language: "scala",
    displayName: "Scala",
    server: "Metals",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("scalameta/metals", "LICENSE"),
    installCommand: "See https://scalameta.org/metals/ for the install routes (the CLI route is `cs install metals`)",
    npmInstallable: false,
    caveat: "UNVERIFIED for the install command: the repository README points at the project website, so the coursier command could not be quoted from a fetched document. Metals also needs a build-server connection (Bloop or sbt) before cross-module questions answer.",
    extensions: ["scala", "sc", "sbt"],
    command: ["metals"],
    citations: [repoDoc("scalameta/metals", "LICENSE"), readme("scalameta/metals")],
    verification: "unverified"
  },
  {
    language: "ocaml",
    displayName: "OCaml",
    server: "ocaml-lsp-server",
    licence: "ISC",
    licenceUrl: repoDoc("ocaml/ocaml-lsp", "LICENSE.md"),
    installCommand: "opam install ocaml-lsp-server",
    npmInstallable: false,
    caveat: "Must be installed into the SAME opam switch the project builds in — the README says so explicitly, and a server from another switch reports the wrong modules.",
    extensions: ["ml", "mli"],
    command: ["ocamllsp"],
    citations: [repoDoc("ocaml/ocaml-lsp", "LICENSE.md"), readme("ocaml/ocaml-lsp")],
    verification: "primary"
  },
  {
    language: "verilog",
    displayName: "Verilog",
    server: "verible-verilog-ls",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("chipsalliance/verible", "LICENSE"),
    installCommand: "Download and extract the release binaries from https://github.com/chipsalliance/verible/releases",
    npmInstallable: false,
    caveat: "Ships as a release archive rather than through a package manager in most distributions, so `verible-verilog-ls` has to be put on PATH by hand; the repository also documents a Bazel build from source.",
    extensions: ["v", "vh"],
    command: ["verible-verilog-ls"],
    citations: [repoDoc("chipsalliance/verible", "LICENSE"), readme("chipsalliance/verible")],
    verification: "primary"
  },
  {
    language: "systemverilog",
    displayName: "SystemVerilog",
    server: "svls",
    licence: "MIT",
    licenceUrl: repoDoc("dalance/svls", "LICENSE"),
    installCommand: "cargo install svls (or: sudo snap install svls)",
    npmInstallable: false,
    caveat: "Indexes the workspace itself and is happy with plain SystemVerilog; a UVM project usually wants its include paths listed in a `svls.toml` beside the sources. The researched matrix also carries `@imc-trading/svlangserver` (MIT, npm-installable) for the same extensions; switching to it means naming `svlangserver` in a workspace `cclsp.json`.",
    extensions: ["sv", "svh"],
    command: ["svls"],
    citations: [repoDoc("dalance/svls", "LICENSE"), readme("dalance/svls"), "evidence/restore/matrix/20261008T235658Z-lsp-language-matrix.md (row 43b, the svlangserver alternative)"],
    verification: "primary"
  },
  {
    language: "fortran",
    displayName: "Fortran",
    server: "fortls",
    licence: "MIT",
    licenceUrl: repoDoc("fortran-lang/fortls", "LICENSE"),
    installCommand: "pip install fortls",
    npmInstallable: false,
    caveat: "The older `fortran-language-server` shares the same executable name — the project's own troubleshooting note says to uninstall it first, or the two shadow each other on PATH.",
    extensions: ["f90", "f95", "f03", "f08"],
    command: ["fortls"],
    citations: [repoDoc("fortran-lang/fortls", "LICENSE"), readme("fortran-lang/fortls")],
    verification: "primary"
  },
  {
    language: "nim",
    displayName: "Nim",
    server: "nimlangserver",
    licence: "MIT",
    licenceUrl: repoDoc("nim-lang/langserver", "LICENSE"),
    installCommand: "nimble install -g nimlangserver",
    npmInstallable: false,
    caveat: "Installed through Nim's own package manager, so the Nim toolchain has to exist first; the project is maintained by the Nim organisation rather than a third party.",
    extensions: ["nim", "nims"],
    command: ["nimlangserver"],
    citations: [repoDoc("nim-lang/langserver", "LICENSE")],
    verification: "primary"
  },
  {
    language: "crystal",
    displayName: "Crystal",
    server: "crystalline",
    licence: "MIT",
    licenceUrl: repoDoc("elbywan/crystalline", "LICENSE"),
    installCommand: "brew install crystalline",
    npmInstallable: false,
    caveat: "It compiles and indexes the project itself, so the first run on a large codebase is slow; it needs the Crystal compiler on PATH to resolve the standard library.",
    extensions: ["cr"],
    command: ["crystalline"],
    citations: [repoDoc("elbywan/crystalline", "LICENSE")],
    verification: "primary"
  },
  {
    language: "xml",
    displayName: "XML / XSD / XSL",
    server: "lemminx",
    licence: "EPL-2.0",
    licenceUrl: repoDoc("eclipse-lemminx/lemminx", "LICENSE"),
    installCommand: "Download the binary release from https://github.com/eclipse-lemminx/lemminx/releases, or use the XML extension that bundles it",
    npmInstallable: false,
    caveat: "NOT permissive: EPL-2.0 (weak copyleft) — spawned from the user's install, never redistributed here. Schema validation only happens when the document points at a schema (`xsi:noNamespaceSchemaLocation`, a DOCTYPE or a catalogue), so a bare XML file gets syntax checks only.",
    extensions: ["xml", "xsd", "xsl", "xslt", "svg"],
    command: ["lemminx"],
    citations: [repoDoc("eclipse-lemminx/lemminx", "LICENSE")],
    verification: "primary"
  },
  {
    language: "vim",
    displayName: "Vim script",
    server: "vim-language-server",
    licence: "MIT",
    licenceUrl: npmPage("vim-language-server"),
    installCommand: "npm i -g vim-language-server",
    npmInstallable: true,
    caveat: "Its MIT licence rests on the npm MANIFEST: the repository (iamcco/vim-language-server) has no root licence file to read, so treat the licence string as package-declared rather than repository-read.",
    extensions: ["vim"],
    command: ["vim-language-server", "--stdio"],
    citations: [npmDoc("vim-language-server")],
    verification: "primary"
  },
  {
    language: "assembly",
    displayName: "Assembly (GAS / NASM / MASM)",
    server: "asm-lsp",
    licence: "BSD-2-Clause",
    licenceUrl: repoDoc("bergercookie/asm-lsp", "LICENSE"),
    installCommand: "cargo install asm-lsp",
    npmInstallable: false,
    caveat: "Reads the assembler dialect from `.asm-lsp.toml` in the workspace; without that file it falls back to a generic parser and hover/completion stay coarse.",
    extensions: ["asm", "s"],
    command: ["asm-lsp"],
    citations: [repoDoc("bergercookie/asm-lsp", "LICENSE")],
    verification: "primary"
  },
  {
    language: "powershell",
    displayName: "PowerShell",
    server: "PowerShell Editor Services",
    licence: "MIT",
    licenceUrl: repoDoc("PowerShell/PowerShellEditorServices", "LICENSE"),
    installCommand: "Install the PowerShellEditorServices module (it runs as a PowerShell 7+ module rather than a standalone binary)",
    npmInstallable: false,
    caveat: "UNVERIFIED for the install command and the argv: the project is distributed mainly inside the editor extension and runs as a module script, so no single install line and no standalone executable could be confirmed. The probe below therefore looks for the module's script name, and this row stays out of the generated config until that name is on PATH.",
    extensions: ["ps1", "psm1", "psd1"],
    command: ["Start-EditorServices.ps1"],
    citations: [repoDoc("PowerShell/PowerShellEditorServices", "LICENSE"), readme("PowerShell/PowerShellEditorServices")],
    verification: "unverified"
  },
  {
    language: "tex",
    displayName: "LaTeX / BibTeX",
    server: "texlab",
    licence: "GPL-3.0",
    licenceUrl: repoDoc("latex-lsp/texlab", "LICENSE"),
    installCommand: "Install from your package manager, or build with `cargo install --git https://github.com/latex-lsp/texlab --locked --tag <version>`",
    npmInstallable: false,
    caveat: "NOT permissive: GPL-3.0 (strong copyleft) — spawned from the user's install, never redistributed here. The README explicitly warns against the stale crates.io release, which is why the quoted command builds from the tagged git source.",
    extensions: ["tex", "bib"],
    command: ["texlab"],
    citations: [repoDoc("latex-lsp/texlab", "LICENSE"), readme("latex-lsp/texlab")],
    verification: "primary"
  },
  {
    language: "elm",
    displayName: "Elm",
    server: "elm-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("elm-tooling/elm-language-server", "LICENSE"),
    installCommand: "npm install -g @elm-tooling/elm-language-server",
    npmInstallable: true,
    caveat: "Needs `elm`, `elm-format` and `elm-test` on PATH for the features that call out to them; without elm-format the formatting requests fail rather than degrade quietly.",
    extensions: ["elm"],
    command: ["elm-language-server", "--stdio"],
    citations: [npmDoc("@elm-tooling/elm-language-server"), repoDoc("elm-tooling/elm-language-server", "LICENSE"), readme("elm-tooling/elm-language-server")],
    verification: "primary"
  },
  {
    language: "solidity",
    displayName: "Solidity",
    server: "solidity-language-server",
    licence: "MIT",
    licenceUrl: repoDoc("NomicFoundation/hardhat-vscode", "LICENSE"),
    installCommand: "npm install -g @nomicfoundation/solidity-language-server",
    npmInstallable: true,
    caveat: "The executable is `nomicfoundation-solidity-language-server`, much longer than the package name; it works on a Foundry or Hardhat project and takes compiler settings from the project's own config.",
    extensions: ["sol"],
    command: ["nomicfoundation-solidity-language-server"],
    citations: [npmDoc("@nomicfoundation/solidity-language-server"), repoDoc("NomicFoundation/hardhat-vscode", "LICENSE")],
    verification: "primary"
  },
  {
    language: "prisma",
    displayName: "Prisma schema",
    server: "Prisma language server",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("prisma/language-tools", "LICENSE"),
    installCommand: "npm install -g @prisma/language-server",
    npmInstallable: true,
    caveat: "Understands the schema language only: it formats and validates `schema.prisma`, while the generated client's types stay TypeScript's business.",
    extensions: ["prisma"],
    command: ["prisma-language-server", "--stdio"],
    citations: [npmDoc("@prisma/language-server"), repoDoc("prisma/language-tools", "LICENSE")],
    verification: "primary"
  },
  {
    language: "typst",
    displayName: "Typst",
    server: "tinymist",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("Myriad-Dreamin/tinymist", "LICENSE"),
    installCommand: "Download a prebuilt from https://github.com/Myriad-Dreamin/tinymist/releases",
    npmInstallable: false,
    caveat: "The fastest-moving Typst tooling and the engine behind the official editor extension; the release assets carry per-platform binaries, so pick the archive for your OS and put `tinymist` on PATH.",
    extensions: ["typ"],
    command: ["tinymist"],
    citations: [repoDoc("Myriad-Dreamin/tinymist", "LICENSE"), readme("Myriad-Dreamin/tinymist")],
    verification: "primary"
  },
  {
    language: "perl",
    displayName: "Perl",
    server: "PerlNavigator",
    licence: "MIT",
    licenceUrl: repoDoc("bscan/PerlNavigator", "LICENSE"),
    installCommand: "sudo npm install -g perlnavigator-server",
    npmInstallable: true,
    caveat: "The npm package is the editor-facing wrapper around the server; it needs `perl` on PATH and reads a `.perlnavigator.json` for include paths.",
    extensions: ["pl", "pm", "t"],
    command: ["perlnavigator"],
    citations: [npmDoc("perlnavigator-server"), repoDoc("bscan/PerlNavigator", "LICENSE"), readme("bscan/PerlNavigator")],
    verification: "primary"
  },
  {
    language: "groovy",
    displayName: "Groovy",
    server: "groovy-language-server",
    licence: "Apache-2.0",
    licenceUrl: repoDoc("GroovyLanguageServer/groovy-language-server", "LICENSE"),
    installCommand: "Build from a checkout with Gradle (`./gradlew build`) and run the produced jar",
    npmInstallable: false,
    caveat: "UNVERIFIED for the install command: the project ships no package-manager route and its README documents a source build only, so no single install line could be quoted. Requires a JDK.",
    extensions: ["groovy", "gvy"],
    command: ["groovy-language-server"],
    citations: [repoDoc("GroovyLanguageServer/groovy-language-server", "LICENSE")],
    verification: "unverified"
  },
  {
    language: "vhdl",
    displayName: "VHDL",
    server: "VHDL-LS",
    licence: "MPL-2.0",
    licenceUrl: repoDoc("VHDL-LS/rust_hdl", "LICENSE.txt"),
    installCommand: "Download a release from https://github.com/VHDL-LS/rust_hdl/releases, or build with `cargo install --path vhdl_ls` from a checkout",
    npmInstallable: false,
    caveat: "NOT permissive: MPL-2.0 (file-level copyleft). The binary is `vhdl_ls`; the README's install step builds `vhdl_lang` first, which is why the quoted command is the second of the two.",
    extensions: ["vhd", "vhdl"],
    command: ["vhdl_ls"],
    citations: [repoDoc("VHDL-LS/rust_hdl", "LICENSE.txt"), readme("VHDL-LS/rust_hdl")],
    verification: "primary"
  },
  {
    language: "nickel",
    displayName: "Nickel",
    server: "nls (built into the Nickel CLI)",
    licence: "MIT",
    licenceUrl: repoDoc("tweag/nickel", "LICENSE"),
    installCommand: "Install the Nickel CLI from https://nickel-lang.org",
    npmInstallable: false,
    caveat: "UNVERIFIED for the argv: the language server is a subcommand of the compiler CLI, and no install line for it could be quoted from a fetched document. Requires the `nickel` CLI on PATH.",
    extensions: ["ncl"],
    command: ["nickel", "lsp"],
    citations: [repoDoc("tweag/nickel", "LICENSE")],
    verification: "unverified"
  }
] as const

/**
 * Find the row for one language id.
 *
 * @param language the language id to look up (`typescript`, `go`, …).
 * @returns the matching row, or null when the catalog does not have it.
 */
export function findLanguageServer(language: string): LanguageServerEntry | null {
  return LANGUAGE_SERVERS.find((entry: LanguageServerEntry): boolean => entry.language === language) ?? null
}
