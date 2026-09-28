#!/usr/bin/env node
// pack-mpd: assemble the relocatable installable bundle package (Plan D).
// Output: <repo>/dist/mpd-package/ — a self-contained npm package named @mpd-dsh/mpd
// with dsh.bundle.patch, whose cordis.patch.yml references plugins via the resolvable
// name '@mpd-dsh/mpd/packages/...' and every path-bearing value via the loader's
// baseUrl (the profile directory) — no checkout-absolute paths anywhere.
// `--out <dir>` stages somewhere else (T-63's scratch arms, T-85's lane change); with no flag the
// target is unchanged, so the canonical artifact and every existing caller behave exactly as before.
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { readJson, repoRootFrom } from "./lib/repo.ts"

/** The root `package.json` fields this packer reads; the rest of that document is never consulted. */
interface RootManifest {
  /** The bundle version, mirrored verbatim into the packed manifest's `version`. */
  readonly version?: string
  /** The bundle description, mirrored verbatim into the packed manifest's `description`. */
  readonly description?: string
  /** The loader-facing `dsh` declaration block. */
  readonly dsh?: {
    /** The `dsh.bundle` block: the ONE declaration the loader reads the patch layer from. */
    readonly bundle?: {
      /** The declared patch layer — one repo-relative path, or the 0.1.7-rc.2 array of them. */
      readonly patch?: string | string[]
    }
  }
}

/** One patch file the root manifest declares, in the two spellings the packer needs. */
interface DeclaredPatch {
  /** Repo-relative path with any leading `./` stripped; an additional patch keeps it when packed. */
  readonly rel: string
  /** Absolute path of the patch in this checkout, read and decoupled by writePatches(). */
  readonly source: string
}

/** The normalized `dsh.bundle.patch` declaration: the raw shape flag plus every usable entry. */
interface DeclaredPatches {
  /** Whether the manifest declared an ARRAY — the packed manifest mirrors that shape exactly. */
  readonly array: boolean
  /** Every non-empty string entry, in declaration order. */
  readonly entries: readonly DeclaredPatch[]
}

/** Where a run stages the pack: the resolved directory plus where that directory came from. */
interface OutDir {
  /** Absolute path of the directory the artifact is staged into (wiped first by main()). */
  readonly dir: string
  /** Human-readable provenance of `dir`, printed by main() so a scratch run names its route. */
  readonly source: string
}

/** The file-mode tally of the packed tree, reported so a run states how much it actually touched. */
interface ModeCounts {
  /** Every regular file visited below the packed root. */
  files: number
  /** Files that ended at 0644 (mode changed, or already correct). */
  made644: number
  /** Files that ended at 0755 (mode changed, or already executable). */
  kept755: number
  /** Files matching neither branch; never incremented today, kept so the tally shape stays explicit. */
  other: number
}

/** The packed `package.json`: the manifest of the relocatable artifact an installer consumes. */
interface PackedManifest {
  /** The packed package name — always this bundle's own name. */
  name: string
  /** The root bundle version; `undefined` when the root manifest omits it (JSON then drops the key). */
  version: string | undefined
  /** Always true: the artifact is an install source, never a publishable library. */
  private: boolean
  /** Always "module": every packed row is ESM. */
  type: "module"
  /** The root bundle description; `undefined` when the root manifest omits it. */
  description: string | undefined
  /** A pointer into the shipped licence file rather than an SPDX id. */
  license: string
  /** The packed entry point the `@mpd-dsh/mpd` specifier resolves. */
  main: string
  /** The packed `exports` map: the row and asset subpaths an installed bundle resolves. */
  exports: Record<string, string>
  /** The packed `files` allowlist npm reads when it packs the artifact. */
  files: string[]
  /** The loader-facing declaration, mirroring the root manifest's own shape. */
  dsh: {
    /** The packed patch layer: the same shape (string or array) as the root declaration. */
    bundle: { patch: string | readonly string[] }
    /** The bundle-level web client declaration. */
    client: {
      /** No bundle-level injects: the client factory declares its own service injects. */
      inject: readonly string[]
      /** The only platform this client ships for. */
      platform: string
    }
  }
  /** Third-party runtime plugin dependencies a loader row mounts, materialized by the boot fallback. */
  dependencies: Record<string, string>
  /** Toolchain binaries the consumer installs separately from this package. */
  optionalDependencies: Record<string, string>
}

/** The repository root, derived from this script's own URL under `<root>/scripts/`. */
const repoRoot: string = repoRootFrom(import.meta.url)
/** The same root in forward-slash form: the spelling a decoupled patch must never contain. */
const dev: string = repoRoot.replace(/\\/g, "/")
// The default target is the SAME expression this file always used, so an invocation with no flags
// stages exactly what it staged before. `--out <dir>` exists for the scratch-pack consumers (T-63's
// byte-rule arms and lane D's T-85 lane change): before it, a caller that needed a scratch artifact had
// to REWRITE this file's constants (`evidence/packaging/t70-root-file/…/scratch-pack.mjs`), which is a
// copy of the packer that drifts the moment the packer moves. `--out` keeps ONE packer.
/** The staging directory used when no `--out` flag is given: `<repo>/dist/mpd-package`. */
const DEFAULT_OUT_DIR: string = join(repoRoot, "dist", "mpd-package")

/**
 * Resolve the staging directory from the command line.
 *
 * `--help`/`-h` prints the usage and exits 0 (the file's only side-effect-free mode);
 * `--out <dir>` resolves relative to the repository root and refuses a value that would
 * stage the pack over the repository root itself; no flag keeps the historical default.
 *
 * @param argv The arguments after the script path.
 * @returns The staging directory plus a provenance string for the run's final report line.
 */
function parseOutDir(argv: readonly string[]): OutDir {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: node scripts/pack-mpd.ts [--out <dir>]")
    console.log("  no flags        stage into " + DEFAULT_OUT_DIR)
    console.log("  --out <dir>     stage into another directory (repo-relative or absolute); the canonical artifact is never touched")
    process.exit(0)
  }
  /** Position of `--out` in the argument list, or -1 when the flag is absent. */
  const flag = argv.indexOf("--out")
  if (flag === -1) return { dir: DEFAULT_OUT_DIR, source: "default (<repo>/dist/mpd-package)" }
  /** The flag's value, or `undefined` when `--out` is the last argument (a usage error). */
  const value: string | undefined = argv[flag + 1]
  if (value === undefined || value.startsWith("--")) {
    console.error("[pack-mpd] FAIL: --out needs a directory, got " + JSON.stringify(value ?? ""))
    process.exit(2)
  }
  /** The value resolved against the repository root, so a relative `--out` is repo-relative. */
  const dir = resolve(repoRoot, value)
  if (dir === repoRoot || dir === "/" || dir === "") {
    console.error("[pack-mpd] FAIL: --out " + JSON.stringify(value) + " resolves to " + dir + " — refusing to stage a pack over the repository root (or /)")
    process.exit(2)
  }
  return { dir, source: "command line (--out " + value + ")" }
}

/** The staging target for this run, resolved once at module load so main() reads a settled value. */
const OUT: OutDir = parseOutDir(process.argv.slice(2))
/** Absolute staging directory: the one path every copy and write below targets. */
const outDir: string = OUT.dir
/** The checkout's main bundle patch path, kept as the packer's visible source-path contract. */
const devPatch: string = join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml")
/** The packed package name, i.e. the specifier every decoupled row resolves through. */
const PKG_NAME: string = "@mpd-dsh/mpd"
/** The JS expression a packed path-bearing value is built from: the loader's own `baseUrl`. */
const BP: string = "(typeof baseUrl === \"string\" ? baseUrl.replace(/^file:\\/\\//, \"\").replace(/\\/+$/, \"\") : \"\")"

/**
 * The bundle's patch layer, from the ONE declaration the loader reads.
 *
 * 0.1.7-rc.2: `dsh.bundle.patch` is an ARRAY — the main bundle patch plus the
 * preset patch that declares the whole `mpd` preset as a
 * `@deepseek-ai/dsh-agent-preset` ROW (`presets/mpd.patch.yml`). The packer must
 * ship EVERY declared patch, decoupled, and declare the same set in the packed
 * manifest: a packed install missing the preset patch boots with NO `mpd` preset
 * at all while `npm run pack` still exits 0 — the same silent-omission class the
 * PLUGIN_PKGS / ROOT_ASSET_DIRS comments below record.
 *
 * The MAIN patch keeps its historical packed location (`<packed>/cordis.patch.yml`)
 * so every existing packed-path consumer is untouched; an ADDITIONAL patch is
 * staged at its own repo-relative path, which is also where ROOT_ASSET_DIRS'
 * `presets` copy already puts it.
 */
/** Repo-relative location of the main bundle patch, which keeps its historical packed name. */
const MAIN_PATCH_REL: string = "packages/mpd-bundle/cordis.patch.yml"

/**
 * Read every patch this bundle declares, from the ONE declaration the loader reads.
 *
 * @returns The raw shape flag (array or not) plus every usable entry, in declaration order.
 */
function declaredPatches(): DeclaredPatches {
  /** The raw `dsh.bundle.patch` value, before the two accepted shapes below narrow it. */
  const raw = readJson<RootManifest>(join(repoRoot, "package.json"))?.dsh?.bundle?.patch
  /** The declared entries, accepting both the single-string and the 0.1.7-rc.2 array form. */
  const list: readonly string[] = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  return {
    array: Array.isArray(raw),
    entries: list.filter((value: string): boolean => typeof value === "string" && value.trim() !== "")
      .map((value: string): DeclaredPatch => ({ rel: value.replace(/^\.\//, ""), source: join(repoRoot, value) })),
  }
}
/** The root manifest's patch declaration, read ONCE so every staging step agrees on the same set. */
const PATCHES: DeclaredPatches = declaredPatches()
/** Packed-relative path of one declared patch (the main patch keeps its root name). */
function packedPatchRel(entry: DeclaredPatch): string { return entry.rel === MAIN_PATCH_REL ? "cordis.patch.yml" : entry.rel }

/** Wrap a JS expression as a YAML `!!js` scalar, the one tag the loader evaluates. */
function jsVal(expr: string): string { return "!!js '" + expr + "'" }
/** A packed path-bearing YAML value: the loader's `baseUrl` joined with the repo-relative `rel`. */
function pathExpr(rel: string): string { return jsVal(BP + " + \"" + rel + "\"") }

/** Every plugin package the shipped patch mounts; a missing `dist/` for one of them is a hard FAIL. */
const PLUGIN_PKGS: readonly string[] = [
  "mpd-dsh-adapter-plugin",
  "mpd-tools-plugin", "mpd-modelchain-plugin", "mpd-ulw-plugin",
  "mpd-codegraph-plugin", "mpd-hashline-plugin", "mpd-boulder-plugin",
  "mpd-config-plugin", "mpd-comment-checker-plugin", "mpd-memory-plugin",
  "mpd-roles-plugin", "mpd-bootstrap-plugin", "mpd-workmate-plugin",
  // mpd-team-compact-plugin is MOUNTED by the bundle patch
  // (packages/mpd-bundle/cordis.patch.yml, loader entry `mpd-team-compact`) and was
  // missing from this list, so `npm run pack` exited 0 while the packed tree omitted
  // the package and the boot died with ERR_MODULE_NOT_FOUND on that entry (measured
  // 2026-09-14 by a teammate's QA case; a checkout install was unaffected, which is
  // exactly why no gate caught it). Every plugin package the patch mounts MUST be
  // listed here: `mpd-qa-roles-probe` is deliberately absent because it is QA-only
  // and mounted by an overlay, never by the shipped patch.
  "mpd-team-compact-plugin",
  // mpd-team-tools-plugin is MOUNTED by the bundle patch (row `mpd-team-tools`): the
  // staged-plan / task-contract / halt workflow around the official team runtime.
  "mpd-team-tools-plugin",
  // mpd-roster-provider-plugin is MOUNTED by the bundle patch (row `mpd-roster-provider`):
  // the per-member subagent provider the official team tool is pointed at.
  "mpd-roster-provider-plugin",
  // mpd-better-sidebar-host is MOUNTED by the bundle patch (row `mpd-better-sidebar`): the
  // bundle-owned door to the sidebar host it ships, so the sidebar mounts on a link: install too.
  "mpd-better-sidebar-host",
  // mpd-ext-plugin is MOUNTED by the bundle patch (row `mpd-ext`) and was missing
  // from this list: the packed tree would omit `packages/mpd-ext-plugin/dist/` while
  // `npm run pack` still exited 0, and the packed boot would die ERR_MODULE_NOT_FOUND
  // on that row — the same silent-omission class the comment above records for
  // mpd-team-compact-plugin. Its discovery root `<bundle>/extensions/` is copied by
  // cpAssets() and declared in the packed manifest's files/exports below.
  "mpd-ext-plugin",
  // mpd-tui-plugin is MOUNTED by the bundle patch (row `mpd-tui`, the DSH-TUI
  // edition) and was missing from this list: the packed tree would omit
  // `packages/mpd-tui-plugin/dist/` while `npm run pack` still exited 0, and the
  // packed boot would die ERR_MODULE_NOT_FOUND on that row — the same
  // silent-omission class the comments above record for mpd-team-compact-plugin and
  // mpd-ext-plugin. Adding the entry fixes this package; the whole CLASS is gated by
  // regression command R11 in .mpd/plans/dsh-tui-edition.md, which asserts every
  // `@mpd-dsh/mpd/packages/<pkg>/dist/index.js` row of the bundle patch is listed here.
  "mpd-tui-plugin",
  // mpd-team-watchdog-plugin is MOUNTED by the bundle patch (row `mpd-team-watchdog`,
  // packages/mpd-bundle/cordis.patch.yml:227-228, which landed AFTER this list was last
  // touched) and was missing from it — the FOURTH occurrence of the silent-omission
  // class the comments above record for mpd-team-compact-plugin, mpd-ext-plugin and
  // mpd-tui-plugin. Unlike those three it never reached a shipped tree: the positive
  // closure check below caught it and printed `[pack-mpd] FAIL: the patch mounts
  // packages/mpd-team-watchdog-plugin/dist/index.js but the packed tree has no such
  // file` (measured 2026-09-16 by the extension wave's QA lane:
  // evidence/extensions/extension-lifecycle/2026-09-16T04-43-51.532Z/output.log:97).
  // Adding the entry is the whole fix; R11 (see above) covers the class.
  "mpd-team-watchdog-plugin",
  "mpd-bundle-plugin"
]
/** The MCP server packages whose launcher modules and assets ship in the packed tree. */
const MCP_PKGS: readonly string[] = ["mpd-mcp-astgrep", "mpd-mcp-gitbash", "mpd-mcp-lsp", "mpd-mcp-codegraph"]

// Root-level asset directories the packed tree MUST carry. Source and destination names are
// the same (`<repo>/<dir>` -> `<packed>/<dir>`), and the table exists for two reasons:
//   1. `scripts/verify-pack-closure.ts` parses it and asserts BOTH that it names the assets a
//      packed install needs and that they are really on disk (source and packed tree) — so a
//      missing entry is loud WITHOUT a pack, and a missing directory is loud WITH one;
//   2. cpAssets() loops over it, so a new root asset is one entry instead of another copy call.
// The class it locks out is measured four times (see verify-pack-closure.ts): a shipped asset
// that no entry names is simply NOT packed while `npm run pack` still exits 0. `templates/`
// (T-35) and `docs/` (T-36/T-45) were missing from the artifact for exactly that reason until
// this wave's user decision (2026-09-17) to ship both.
/** Root directories copied verbatim into the packed tree, each one REQUIRED to exist. */
const ROOT_ASSET_DIRS: readonly string[] = [
  // the skill corpus, SERVED from <bundle>/skills by the `mpd-bootstrap` row (never copied
  // into $DSH_HOME); a packed bundle without it silently loses every skill
  "skills",
  // the `mpd` preset, served through the bundle patch's agent-presets root (<bundle>/presets)
  "presets",
  // the mpd-ext bundle discovery root: mpd-ext resolves the bundle plane as
  // `<bundleRoot>/extensions` (plan §1.9), so a packed bundle that ships the plugin but not
  // this directory silently loses the whole bundle plane, reference extension included
  "extensions",
  // the extension scaffold template `templates/mpd-extension` — the ONLY source of
  // `scripts/mpd-ext.ts scaffold`; without it the documented author workflow has nothing to copy
  "templates",
  // the human-facing documentation set, EN + *.zh-CN.md pairs (T-36/T-45): external authors
  // who install the bundle get the guides, not just the code
  "docs",
  // the ON-DEMAND agent references (t16 moved the manual's bulk there; captain's t11 addition):
  // troubleshooting.md (the symptom -> cause/fix table), agent-teams-deltas.md (the adopted
  // plugin's delta registry) and index.md. AGENTS.md itself deliberately stays out of the
  // artifact (it is the repository's contributor manual), but an EXTERNAL AUTHOR needs these
  // three when a boot misbehaves or when they touch the adopted plugin. English-only and
  // OUTSIDE the bilingual gate's discovery on purpose: no *.zh-CN.md twin belongs here.
  "agent-references",
]

// Root-level FILES the packed tree carries by name (not by directory). Same contract shape as
// ROOT_ASSET_DIRS and for the same measured reason: a file that no table names is simply NOT
// packed while `npm run pack` still exits 0, and the closure gate cannot report that from the
// artifact alone — its manifest arm is DECLARATION-DRIVEN, so an asset declared NOWHERE is
// invisible by construction. Naming this list, and letting `scripts/verify-pack-closure.ts`
// parse it, is what makes the ADDITION-omission loud instead of only a later removal. The
// extension author's machine contract joins the licence/README set because the artifact's own
// README, docs/index.md and the extension authoring guide link to it by RELATIVE path: without
// the file those links break for an external author who holds only the artifact (T-70). The
// contributor set (CONTRIBUTING pair + CHANGELOG) is named for the same reason: the shipped
// README/docs hub link to them by relative path.
/** Root-level files copied by name into the packed tree (a missing one is skipped, not fatal). */
const ROOT_FILES: readonly string[] = [
  "LICENSE.md",
  "LICENSE-NOTICES.md",
  "README.md",
  "README.zh-CN.md",
  "CONTRIBUTING.md",
  "CONTRIBUTING.zh-CN.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "SECURITY.zh-CN.md",
  "EXTENSIONS-FOR-AGENTS.md",
]

// The packed CLI's compiled-validator entry. `scripts/mpd-ext.ts` shares ONE validator with the
// runtime; in a checkout it imports the TypeScript sources, which the packer does NOT copy
// (`cpDist()` ships `dist/` only) — measured: inside `dist/mpd-package/` every CLI entry point
// died with `Cannot find module '…/packages/mpd-ext-plugin/src/registry.ts'` (T-51). The
// compiled bundle `dist/index.js` carries that whole validator but exports only the plugin
// surface (`name`/`inject`/`apply`/…), so the packed tree gets a generated sidecar:
// `dist/validator.js` = the shipped bundle + ONE `export { … }` line. The plugin module itself
// is never touched. Every name is checked against the bundle (a binding that is not there would
// be a module syntax error, i.e. a dead CLI) and the emitted file is really IMPORTED once before
// the pack returns.
/** The compiled bundle's export surface the packed CLI needs, checked before the sidecar is written. */
const VALIDATOR_SHIM_EXPORTS: readonly string[] = [
  "ROLES", // the base-roster table the CLI screens extension roles against
  "MPD_EXT_CONTRACT", // the frozen descriptor contract (id / skill-name / server-name grammars)
  "buildExtension",
  "roleNameKey",
  "roleNameCollisionReason",
  "discoverPlane",
  "projectExtensionsDir",
  "userExtensionsDir",
  "bundleExtensionsDir",
]
/** Repo-relative path of the compiled bundle the packed validator sidecar re-exports from. */
const VALIDATOR_BUNDLE: string = join("packages", "mpd-ext-plugin", "dist", "index.js")
/** Repo-relative path of the validator entry the packed CLI actually imports. */
const VALIDATOR_ENTRY: string = join("packages", "mpd-ext-plugin", "dist", "validator.js")

/** Copy every plugin/MCP package's built `dist/` into the packed tree; a missing one aborts the pack. */
function cpDist(): void {
  /** Package names whose `dist/` directory is absent, collected so ONE message names them all. */
  const missing: string[] = []
  for (const p of [...PLUGIN_PKGS, ...MCP_PKGS]) {
    /** The package's built output directory in this checkout. */
    const src = join(repoRoot, "packages", p, "dist")
    if (!existsSync(src)) { missing.push(p); continue }
    mkdirSync(join(outDir, "packages", p), { recursive: true })
    cpSync(src, join(outDir, "packages", p, "dist"), { recursive: true })
  }
  if (missing.length > 0) {
    console.error("[pack-mpd] FAIL: missing dist for " + missing.join(", ") + " — run bun build / scripts/build-mcp.ts first; a bundle must never ship without a plugin")
    process.exit(1)
  }
}

/** Copy every non-`dist/` asset the packed tree needs: root tables, per-package assets, launchers. */
function cpAssets(): void {
  mkdirSync(join(outDir, "packages"), { recursive: true })
  // Root assets (skills / presets / extensions / templates / docs): see ROOT_ASSET_DIRS for
  // why each one ships and why the table — and not an inline `if (existsSync(...)) cpSync(...)`
  // — is the contract. Every entry is REQUIRED: a missing root asset is a hard FAIL, because a
  // packed bundle that silently drops one is exactly the defect this wave is closing (T-35/T-36).
  for (const dir of ROOT_ASSET_DIRS) {
    /** Absolute source path of this root asset directory in the checkout. */
    const src = join(repoRoot, dir)
    if (!existsSync(src)) {
      console.error("[pack-mpd] FAIL: missing " + src + " — the packed tree must carry <root>/" + dir + " (see ROOT_ASSET_DIRS); a bundle must never silently drop a shipped asset (T-38 class)")
      process.exit(1)
    }
    cpSync(src, join(outDir, dir), { recursive: true })
  }
  // the roles plugin's persona assets ship under packages/mpd-roles-plugin/personas
  cpSync(join(repoRoot, "presets"), join(outDir, "presets"), { recursive: true })
  if (existsSync(join(repoRoot, "packages", "mpd-roles-plugin", "personas"))) {
    cpSync(join(repoRoot, "packages", "mpd-roles-plugin", "personas"), join(outDir, "packages", "mpd-roles-plugin", "personas"), { recursive: true })
  }
  // the adopted agent-teams plugin is FIRST-CLASS MAIN CODE under
  // packages/mpd-agent-teams-plugin: copy its whole body (lib + _deps + assets +
  // LICENSE + READMEs) so the bundle is self-contained under any install layout.
  // Exclude test/self-fix-tests dirs: they are dev-only and must not ship in the
  // bundle (avoids packing bloat AND the dist test-sweep duplication).
  cpSync(join(repoRoot, "packages", "mpd-agent-teams-plugin"), join(outDir, "packages", "mpd-agent-teams-plugin"), { recursive: true, filter: (s: string): boolean => !/(^|\/)(test|self-fix-tests)(\/|$)/.test(s) })
  // the bundle's combined web client (adopted agent-teams panel + workmate library),
  // composed by scripts/build-mpd-client.ts — served as @mpd-dsh/mpd's ./client
  cpSync(join(repoRoot, "packages", "mpd-bundle-plugin", "client.js"), join(outDir, "packages", "mpd-bundle-plugin", "client.js"))
  // Root bilingual README pair (AGENTS.md language policy: both files ship together
  // and each carries the switch link to the other; copying only README.md would
  // leave the [中文](./README.zh-CN.md) switch link dangling in the package).
  // …and every other root file travels through the SAME table as the manifest's `files`
  // declaration below, so the copies and the declaration can never disagree about WHICH root
  // files ship (T-70: the author contract was copied by nobody and declared nowhere, while six
  // shipped files linked to it).
  for (const f of ROOT_FILES) {
    if (existsSync(join(repoRoot, f))) cpSync(join(repoRoot, f), join(outDir, f))
  }
  // MCP install/activation helper ships with the package so dist installs can
  // bootstrap the sg/codegraph binaries + wave MCPs too. The extension CLI ships for
  // the same reason: it is the documented developer workflow (`validate`/`scaffold`/
  // `list`), and it runs from the packed tree too because writeValidatorEntry() below
  // emits the compiled validator it falls back to — that is what makes an installed
  // bundle author-facing (T-35/T-51). (AGENTS.md §4's Extension-CLI row names the
  // checkout commands; the packed-tree run is asserted by verify-pack-closure.ts.)
  mkdirSync(join(outDir, "scripts"), { recursive: true })
  cpSync(join(repoRoot, "scripts", "install-mcp.ts"), join(outDir, "scripts", "install-mcp.ts"))
  cpSync(join(repoRoot, "scripts", "mpd-ext.ts"), join(outDir, "scripts", "mpd-ext.ts"))
  // Per-package assets that are NOT under dist/. cpDist() ships `dist/` only, so a
  // package whose runtime or distribution surface includes sibling asset directories
  // needs them copied explicitly — and the omission is INVISIBLE in a checkout install
  // (which reads the repo directly), which is why the class needs a named entry here
  // and a gate rather than trust. The TUI package (row `mpd-tui`) is the measured
  // instance: it ships `themes/mpd-tui.json` (the host-format theme asset) and a
  // packaged skill `skills/mpd-tui/SKILL.md`, and a packed bundle that carried only
  // `dist/` would drop both while `npm run pack` still exited 0.
  // READER NOTE: the key below is an asset-table key, NOT a PLUGIN_PKGS entry — the
  // integrity signal for the array is `PLUGIN_PKGS`'s own element count (one
  // mpd-tui-plugin element, asserted by R11 and by the attribution check), so a raw
  // double-quoted grep of this package name on this file legitimately prints 2 (line
  // 51's array element + this table key), never 1. (This note spells the name without
  // double quotes on purpose, so it does not itself raise that count.)
  for (const [p, dirs] of Object.entries({
    "mpd-tui-plugin": ["themes", "skills"],
  })) {
    for (const dir of dirs) {
      /** Absolute source path of this per-package asset directory. */
      const src = join(repoRoot, "packages", p, dir)
      if (!existsSync(src)) {
        console.error("[pack-mpd] FAIL: missing " + src + " — the " + p + " package ships it; a packed bundle must not silently drop a shipped asset")
        process.exit(1)
      }
      cpSync(src, join(outDir, "packages", p, dir), { recursive: true })
    }
  }
  // Per-package bilingual README pair for every shipped plugin/MCP package
  // (the adopted mpd-agent-teams-plugin is copied wholesale above, READMEs included).
  for (const p of [...PLUGIN_PKGS, ...MCP_PKGS]) {
    for (const f of ["README.md", "README.zh-CN.md"]) {
      /** Absolute source path of this package's README (either language). */
      const s = join(repoRoot, "packages", p, f)
      if (existsSync(s)) cpSync(s, join(outDir, "packages", p, f))
    }
  }
  // B8 (wave 2) + t25: the MCP rows launch <pkg>/launch.ts, which resolves the
  // binary bundle-relatively and hands it to the adopted server. A packed bundle
  // that omits a launcher — OR any module the launcher imports statically — ships a
  // row that cannot start while `npm run pack` still exits 0 (measured: the packed
  // `mpd-mcp-codegraph/launch.ts:36` imports `./daemon-policy.ts`, which the packed
  // tree lacked; `node --input-type=module -e "import('…/launch.ts')"` then failed
  // ERR_MODULE_NOT_FOUND while pack had exited 0). So the closure is walked, not
  // guessed: every statically imported RELATIVE module comes along, recursively, and
  // a specifier that does not resolve in the SOURCE tree is a hard FAIL because it
  // means the walker (or the source) is wrong — never a silent omission.
  cpSync(join(repoRoot, "packages", "mpd-mcp-shared"), join(outDir, "packages", "mpd-mcp-shared"), { recursive: true, filter: (s: string): boolean => !/\.test\.ts$/.test(s) })
  /** The packages root every closure destination is expressed relative to. */
  const packagesRoot = join(repoRoot, "packages")
  /** Copy `packages/<pkg>/<file>` plus its static relative-import closure into the packed tree. */
  const copyLauncherClosure = (absFile: string, seen: Set<string>): void => {
    if (!existsSync(absFile)) {
      console.error("[pack-mpd] FAIL: missing " + absFile + " — a bundle must never ship a mounted row without its module")
      process.exit(1)
    }
    /** The module's `packages/`-relative path, which is also its packed destination. */
    const rel = relative(packagesRoot, absFile)
    if (rel.startsWith("..")) {
      console.error("[pack-mpd] FAIL: " + absFile + " is outside packages/ — refusing to pack it")
      process.exit(1)
    }
    /** Absolute destination of this module inside the packed tree. */
    const outFile = join(outDir, "packages", rel)
    mkdirSync(dirname(outFile), { recursive: true })
    cpSync(absFile, outFile)
    if (seen.has(absFile)) return
    seen.add(absFile)
    for (const spec of staticRelativeImports(readFileSync(absFile, "utf8"))) {
      /** The specifier resolved against the importing module's own directory. */
      const target = resolve(dirname(absFile), spec)
      if (!existsSync(target)) {
        console.error("[pack-mpd] FAIL: " + rel + " imports " + spec + " which does not resolve in the source tree — refusing to ship a broken closure")
        process.exit(1)
      }
      if (relative(packagesRoot, target).startsWith("..")) {
        console.error("[pack-mpd] FAIL: " + rel + " imports " + spec + " outside packages/ — the closure walker cannot ship it")
        process.exit(1)
      }
      copyLauncherClosure(target, seen)
    }
  }
  for (const p of MCP_PKGS) {
    // The MCP launchers are `launch.ts` (this wave's spelling): discover that module and copy
    // its whole static-import closure, so the packed tree can start the row it ships.
    if (existsSync(join(repoRoot, "packages", p, "launch.ts"))) {
      copyLauncherClosure(join(repoRoot, "packages", p, "launch.ts"), new Set())
    }
    // Licensing completeness for a package that vendors a third-party binary: the
    // licence/notice files travel with the copy or the distribution is incomplete.
    for (const f of ["LICENSE", "NODE-RUNTIME-LICENSES.md", "NOTICE"]) {
      if (existsSync(join(repoRoot, "packages", p, f))) cpSync(join(repoRoot, "packages", p, f), join(outDir, "packages", p, f))
    }
  }
  // Positive closure check against the PATCH LAYER itself: every `packages/<pkg>/<file>`
  // path a mounted row executes must exist in the packed tree (t25 acceptance). The
  // check runs over EVERY declared patch, so a row that only the preset patch mounts
  // is covered exactly like one in the main patch.
  for (const entry of PATCHES.entries) {
    if (!existsSync(entry.source)) continue
    /** The patch source text the mounted-row paths are scanned out of. */
    const patchText = readFileSync(entry.source, "utf8")
    // `launch.ts` is the wave's spelling and `launch.mjs` stays accepted: a patch that still
    // names the old launcher must fail the existence check below LOUDLY rather than be skipped
    // silently by this scanner.
    for (const m of patchText.matchAll(/packages\/([a-z0-9-]+)\/(launch\.(?:mjs|ts)|dist\/[A-Za-z0-9._/-]+\.js)/g)) {
      /** The packed tree's corresponding path for this mounted row module. */
      const packed = join(outDir, "packages", m[1], m[2])
      if (!existsSync(packed)) {
        console.error("[pack-mpd] FAIL: " + entry.rel + " mounts packages/" + m[1] + "/" + m[2] + " but the packed tree has no such file")
        process.exit(1)
      }
    }
  }
}

/** Relative static-import specifiers of an ESM module (import/export ... from "./x.ts"). */
function staticRelativeImports(text: string): readonly string[] {
  /** Deduplicated relative specifiers, in first-seen order. */
  const specs: Set<string> = new Set()
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)[^\n]*?from\s*["'](\.[^"']+)["']/g)) specs.add(m[1])
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*["'](\.[^"']+)["']/g)) specs.add(m[1])
  return [...specs]
}

/** Rewrite the checkout's absolute patch paths into the relocatable baseUrl-relative form. */
function decouplePatch(srcPatch: string): string {
  /** The patch source, rewritten by the successive splits/replaces below. */
  let t: string = readFileSync(srcPatch, "utf8")
  for (const p of PLUGIN_PKGS) {
    t = t.split("name: '" + dev + "/packages/" + p + "/dist/index.js'").join("name: '" + PKG_NAME + "/packages/" + p + "/dist/index.js'")
  }
  for (const p of MCP_PKGS) {
    t = t.split("'" + dev + "/packages/" + p + "/dist/cli.js'").join(pathExpr("/node_modules/" + PKG_NAME + "/packages/" + p + "/dist/cli.js"))
  }
  t = t.split("'" + dev + "/packages/mpd-mcp-codegraph/dist/serve.js'").join(pathExpr("/node_modules/" + PKG_NAME + "/packages/mpd-mcp-codegraph/dist/serve.js"))
  // B8 (wave 2): the `.toolchain` -> `<baseUrl>/node_modules/.bin/*` rewrites were
  // removed together with the env pins they served — the patch no longer names a
  // binary path at all (the launchers resolve it), so those splits could only ever
  // be no-ops that imply a resolution that no longer exists.
  // nested !!js (env || <expr>) fix: drop the inner YAML tag so the outer JS sees one expression
  t = t.replace(/\|\| !!js '([^']+)'/g, "|| ($1)")
  // generic YAML-safety: a PLAIN (unquoted) !!js value containing ': ' breaks
  // plain-scalar parsing; wrap it in single quotes (those JS bodies use double
  // quotes only, so no escaping). A value that already starts with a quote is a
  // QUOTED scalar — its ': ' is literal YAML, and re-wrapping it would corrupt
  // it: `!!js "(expr)"` became `!!js '"(expr)"'`, i.e. the expression turned into
  // a string literal, so a guarded row shipped in the packed artifact as
  // always-disabled (a boolean of any non-empty string is true). Measured on the
  // sidebar guard's packed row; the lookahead now skips both quote styles.
  t = t.replace(/(!!js )((?!['"])[^\n]*)/g, (m: string, tag: string, body: string): string => body.includes(": ") ? tag + "'" + body + "'" : m)
  return t
}

/** Write `<packed>/package.json`: the manifest an installer reads, mirroring the root declaration. */
function writeManifest(): void {
  /** The root manifest, the source of the packed identity fields. */
  const root = readJson<RootManifest>(join(repoRoot, "package.json"))
  // The packed patch layer mirrors the ROOT declaration, in order, at the paths the
  // packer actually stages. The SHAPE mirrors the source too (array stays an array),
  // so a single-patch bundle keeps the historical string form.
  /** The packed `./`-prefixed patch paths, in the root declaration's own order. */
  const patchTargets: string[] = PATCHES.entries.map((entry: DeclaredPatch): string => "./" + packedPatchRel(entry).split("\\").join("/"))
  /** The packed manifest document, written as pretty JSON at the end of this function. */
  const manifest: PackedManifest = {
    name: PKG_NAME,
    version: root.version,
    private: true,
    type: "module",
    description: root.description,
    license: "SEE LICENSE IN LICENSE.md",
    main: "packages/mpd-bundle-plugin/dist/index.js",
    exports: {
      ".": "./packages/mpd-bundle-plugin/dist/index.js",
      "./package.json": "./package.json",
      "./packages/*": "./packages/*",
      "./skills/*": "./skills/*",
      "./presets/*": "./presets/*",
      // the mpd-ext bundle discovery root: mpd-ext resolves `<bundleRoot>/extensions`
      // by filesystem path, and the map entry keeps the packed form addressable exactly
      // like skills/ and presets/ (plan §1.9: the asset and this declaration ship together).
      "./extensions/*": "./extensions/*",
      // The author-facing assets (user decision 2026-09-17, T-35/T-36/T-45): the scaffold
      // template and the documentation pairs travel with the package, so an installed bundle
      // can author an extension and read the guides without the repository checkout.
      "./templates/*": "./templates/*",
      "./docs/*": "./docs/*",
      // the agent-facing references (troubleshooting + the adopted-plugin delta registry) ship
      // with the same rule as every other root asset: the bytes AND the declaration together.
      "./agent-references/*": "./agent-references/*",
      "./client": "./packages/mpd-bundle-plugin/client.js"
    },
    files: [
      "packages/**",
      "skills/**",
      "presets/**",
      "extensions/**",
      "templates/**",
      "docs/**",
      "agent-references/**",
      "scripts/**",
      // every staged patch file, named individually as well: the wildcards above
      // cover them TODAY, and this line is what keeps the declaration honest if a
      // future patch lands somewhere the wildcards do not reach. `cordis.patch.yml`
      // is NOT listed separately — the main patch IS a `patchTargets` entry.
      ...patchTargets.map((target: string): string => target.replace(/^\.\//, "")),
      // the named root files, from the SAME table the copy loop uses — one source of truth, so a
      // file cannot be copied without being declared or declared without being copied (T-70).
      ...ROOT_FILES
    ],
    dsh: {
      bundle: { patch: PATCHES.array ? patchTargets : patchTargets[0] },
      // The bundle's web client (the adopted agent-teams panel + workmate library)
      // declares its own service injects inside the client factory; the bundle-level
      // graph-row inject stays empty, mirroring @linxin666/dsh-web-ui-all.
      client: { inject: [], platform: "web" }
    },
    // The adopted agent-teams plugin (MIT provenance, upstream @nanmicoder/
    // dsh-agent-teams 0.1.16-rc.3-mpd) is FIRST-CLASS MAIN CODE under
    // packages/mpd-agent-teams-plugin and is copied wholesale into the bundle
    // (lib + _deps + assets), loaded through the exports map above — it is NOT an
    // npm dependency and must not become one.
    //
    // `dependencies` carries the bundle's THIRD-PARTY RUNTIME PLUGIN dependencies —
    // packages a loader row mounts and nothing in the dsh installation provides.
    // Today exactly one (the sidebar HOST the bundle's two GUI pages register into).
    // BOTH halves are required, and both are measured
    // (evidence/install-deps/implementation/**):
    //  • pnpm (the engine behind `dsh plugin add`) does NOT link a bundle's
    //    transitive deps into the profile root, so the declaration alone never
    //    materializes the package — this half of the former claim still holds;
    //  • `@deepseek-ai/dsh-app-boot#healProfileModuleFallback` DOES resolve the
    //    dependency closure (dependencies + peerDependencies) of every
    //    NON-INSTALLATION bundle layer into `<profile>/node_modules` before the
    //    loader runs, so the declared package IS resolvable for the guarded row
    //    this bundle ships in cordis.patch.yml — this half is what the former
    //    claim missed.
    // The former sentence here ("a plain `dependencies` entry is NOT enough … the
    // row would silently self-disable at boot", repro evidence/plan-e/e1-team-route
    // 2026-08-27T07-38-13.142Z) is therefore CORRECTED rather than deleted: that
    // repro is a manifest/relocation check (version: null, min 0.1.13), not a
    // proof about pnpm's linking, and the boot-time fallback above is the missing
    // half. A dependency declared only here, with no row, mounts nothing.
    dependencies: { "dsh-better-sidebar": "0.19.0-alpha.1" },
    // Toolchain binaries stay as optionalDependencies (installed separately):
    //  - @ast-grep/cli / @colbymchenry/codegraph / @code-yeongyu/comment-checker
    optionalDependencies: { "@ast-grep/cli": "0.45.2", "@colbymchenry/codegraph": "1.5.0", "@code-yeongyu/comment-checker": "0.8.0" }
  }
  writeFileSync(join(outDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
}

/**
 * Normalize the packed artifact's file modes.
 *
 * `cpSync` copies the SOURCE mode verbatim, so a working tree that carries 600
 * bits (git normalizes modes to 644, so the committed files are fine — but an
 * editor/umask can still leave the checkout at 600) would ship an install source
 * whose files a non-root consumer cannot read. The artifact is what users install,
 * so the mode is fixed here rather than in the working tree: regular files become
 * 644 and anything already executable STAYS 755 (stat first, never a blind chmod).
 *
 * @param root Absolute root of the staged tree to walk.
 * @returns The tally of files visited and modes fixed.
 */
function normalizeModes(root: string): ModeCounts {
  /** Running tally of files visited and modes fixed, reported by main(). */
  const counts: ModeCounts = { files: 0, made644: 0, kept755: 0, other: 0 }
  /** Recursive walk over the staged tree; directories are descended into, files are mode-fixed. */
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      /** Absolute path of this directory entry. */
      const p = join(dir, entry)
      /** The entry's stat: `isDirectory()` picks descend-vs-fix, `mode` carries the permission bits. */
      const st = statSync(p)
      if (st.isDirectory()) { walk(p); continue }
      counts.files += 1
      /** The entry's permission bits, with the file-type bits masked off. */
      const mode = st.mode & 0o777
      if ((mode & 0o111) !== 0) {
        if (mode !== 0o755) { chmodSync(p, 0o755); counts.kept755 += 1 } else counts.kept755 += 1
        continue
      }
      if (mode !== 0o644) { chmodSync(p, 0o644); counts.made644 += 1 } else counts.made644 += 1
    }
  }
  walk(root)
  return counts
}

/**
 * The exported names of an ESM module's `export { … }` blocks (the exported spelling, so
 * `local as Public` yields `Public`). Used to refuse a shim that would re-export a name the
 * bundle already exports — that is a module SYNTAX error ("Duplicate export"), i.e. a packed
 * CLI that cannot even be loaded.
 *
 * @param text The module source to scan.
 * @returns The exported spellings, deduplicated.
 */
function exportedNames(text: string): ReadonlySet<string> {
  /** Exported spellings collected so far. */
  const names: Set<string> = new Set()
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      /** One `export { … }` element, trimmed; an empty slot between commas is skipped. */
      const entry = part.trim()
      if (entry.length === 0) continue
      /** The element's local name and its exported alias (the alias, when the element uses `as`). */
      const [local, exported] = entry.split(/\s+as\s+/)
      names.add((exported ?? local).trim())
    }
  }
  return names
}

/**
 * Import the emitted validator entry ONCE and assert every surface the CLI needs is there.
 * A sidecar that parses but misses a binding would only fail later, inside the packed CLI;
 * this makes it a PACK-time failure with the entry's path in the message.
 *
 * @param file Absolute path of the emitted validator entry.
 * @param mode Which route produced it (`prebuilt` or `generated`), named in the child's report.
 */
function verifyValidatorEntry(file: string, mode: string): void {
  /** The child program: import the entry, then assert every required name is defined. */
  const probe = [
    "const m = await import(" + JSON.stringify(pathToFileURL(file).href) + ");",
    "const missing = " + JSON.stringify(VALIDATOR_SHIM_EXPORTS) + ".filter((n) => m[n] === undefined);",
    "if (missing.length > 0) { console.error('missing: ' + missing.join(',')); process.exit(1) }",
    "console.log('validator entry ok: ' + " + JSON.stringify(mode) + " + ' (' + " + JSON.stringify(VALIDATOR_SHIM_EXPORTS.length) + " + ' exports)');",
  ].join("\n")
  /** The probe child's result; a non-zero status means the packed CLI would load a dead module. */
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8" })
  if (result.status !== 0) {
    console.error("[pack-mpd] FAIL: the packed validator entry " + file + " does not load under node: " + String(result.stderr ?? "").trim() + " — a packed CLI without its validator is dead (T-51)")
    process.exit(1)
  }
}

/**
 * Emit `<packed>/packages/mpd-ext-plugin/dist/validator.js`: the compiled validator surface the
 * packed CLI loads (see VALIDATOR_SHIM_EXPORTS). A `dist/validator.js` built by the package
 * itself wins — then the packer ships the build product verbatim instead of generating a sidecar.
 */
function writeValidatorEntry(): void {
  /** Packed path of the validator entry the CLI imports. */
  const dest = join(outDir, VALIDATOR_ENTRY)
  mkdirSync(dirname(dest), { recursive: true })
  /** The package's own prebuilt entry, which wins over a generated sidecar when present. */
  const prebuilt = join(repoRoot, VALIDATOR_ENTRY)
  if (existsSync(prebuilt)) {
    cpSync(prebuilt, dest)
    console.log("[pack-mpd] validator: shipped the package's own " + VALIDATOR_ENTRY + " verbatim")
    verifyValidatorEntry(dest, "prebuilt")
    return
  }
  /** Absolute path of the compiled bundle the sidecar is generated from. */
  const bundlePath = join(repoRoot, VALIDATOR_BUNDLE)
  /** The compiled bundle's source text. */
  const bundled = readFileSync(bundlePath, "utf8")
  /** Whether `name` has a top-level declaration in the bundle (else the re-export is a syntax error). */
  const declared = (name: string): boolean => new RegExp("(?:^|\\n)(?:async function|function|const|let|var|class)\\s+" + name + "\\b").test(bundled)
  /** Names the bundle already exports; re-exporting one would be a duplicate-export syntax error. */
  const already = exportedNames(bundled)
  /** Required names the bundle does not declare at all. */
  const missing = VALIDATOR_SHIM_EXPORTS.filter((name: string): boolean => !declared(name))
  /** Required names the bundle already exports (the other way the sidecar would be invalid). */
  const duplicate = VALIDATOR_SHIM_EXPORTS.filter((name: string): boolean => already.has(name))
  if (missing.length > 0 || duplicate.length > 0) {
    console.error("[pack-mpd] FAIL: " + VALIDATOR_BUNDLE + " cannot carry the packed CLI's validator surface — not declared: " + (missing.join(", ") || "(none)") + "; already exported: " + (duplicate.join(", ") || "(none)") + " — rebuild the package and keep VALIDATOR_SHIM_EXPORTS in step with scripts/mpd-ext.ts REQUIRED_COMPILED_EXPORTS")
    process.exit(1)
  }
  writeFileSync(
    dest,
    bundled + "\n// Appended by scripts/pack-mpd.ts (VALIDATOR_SHIM_EXPORTS): the packed CLI's view of\n" +
      "// this compiled validator, whose own export block exposes only the plugin surface. Do not\n" +
      "// edit the packed copy — it is regenerated on every pack.\n" +
      "export { " + VALIDATOR_SHIM_EXPORTS.join(", ") + " };\n",
  )
  console.log("[pack-mpd] validator: generated " + VALIDATOR_ENTRY + " (" + VALIDATOR_SHIM_EXPORTS.length + " exports) from the shipped bundle")
  verifyValidatorEntry(dest, "generated")
}

/**
 * Stage every declared patch, decoupled. The main patch goes to the packed root
 * (its historical location); every additional patch keeps its repo-relative path,
 * which is where the ROOT_ASSET_DIRS copy already placed it — the decoupled bytes
 * OVERWRITE that copy so the two can never disagree.
 */
function writePatches(): void {
  if (PATCHES.entries.length === 0) {
    console.error("[pack-mpd] FAIL: package.json declares no dsh.bundle.patch — a packed bundle with no patch layer mounts nothing")
    process.exit(1)
  }
  for (const entry of PATCHES.entries) {
    if (!existsSync(entry.source)) {
      console.error("[pack-mpd] FAIL: the manifest declares the patch " + entry.rel + " but it does not exist — a packed install would boot without it")
      process.exit(1)
    }
    /** The patch's packed-relative destination path. */
    const rel = packedPatchRel(entry)
    /** Absolute destination of this staged patch. */
    const dest = join(outDir, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, decouplePatch(entry.source))
  }
  if (!existsSync(join(outDir, "cordis.patch.yml"))) {
    console.error("[pack-mpd] FAIL: the packed tree has no cordis.patch.yml — the main bundle patch was not staged")
    process.exit(1)
  }
  console.log("[pack-mpd] staged " + PATCHES.entries.length + " patch file(s): " + PATCHES.entries.map((entry: DeclaredPatch): string => packedPatchRel(entry)).join(", "))
}

/** Stage the whole artifact; every step is order-dependent and aborts through its own FAIL path. */
function main(): void {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  cpDist()
  cpAssets()
  writeValidatorEntry()
  writePatches()
  writeManifest()
  // No dev path may survive in ANY staged patch: the artifact is relocatable, and a
  // leak in the second patch is as fatal as one in the first.
  for (const entry of PATCHES.entries) {
    /** The staged patch bytes, scanned for a leaked checkout path. */
    const raw = readFileSync(join(outDir, packedPatchRel(entry)), "utf8")
    if (raw.includes(dev)) { console.error("[pack-mpd] FAIL: dev path leaked into staged patch " + packedPatchRel(entry)); process.exit(1) }
  }
  /** The file-mode tally of the staged tree, reported below. */
  const modes = normalizeModes(outDir)
  console.log("[pack-mpd] modes normalized: " + modes.files + " files (644: " + modes.made644 + ", 755: " + modes.kept755 + ")")
  console.log("[pack-mpd] staged package -> " + outDir + "  (out-dir source: " + OUT.source + ")")
}

main()
