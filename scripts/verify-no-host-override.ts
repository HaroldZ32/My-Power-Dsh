#!/usr/bin/env node
// Repo gate: STRICT ZERO-OVERRIDE — a shipped patch layer of this bundle may ADD rows
// and may never id-target a row a HOST layer declares.
//
// WHY THIS EXISTS (user decision 2026-10-02, "strict zero-override"): this bundle used to
// id-target two preset-selection registry rows — `agent-preset-registry` (declared by
// `@deepseek-ai/dsh-web-app`'s own cordis.patch.yml) and `dsh-tui-agent-preset-registry`
// (declared by the `@deepseek-harness-tui/dsh-tui` package's own) — with `config.default: mpd`.
// Both were silent OVERRIDES of a host decision: the row is the host's, and an id-target is a
// per-key replacement of it. Reading the patch by eye cannot keep that property; two rows in
// ~650 lines were found by an audit, not by a gate. This gate makes the property EXECUTABLE.
//
// WHAT IT READS (the subject, derived — never a hardcoded file name): the patch layers the
// ROOT MANIFEST declares at `dsh.bundle.patch` (a string or an array), which is the same
// declaration the loader itself reads. Every TOP-LEVEL entry of those documents is classified:
//   * an entry with a string `id` and no `insert:` -> an ID-TARGET (an override) -> subject;
//   * an entry with an `insert:` list -> rows this bundle ADDS -> never an override, and their
//     ids are deliberately NOT compared (adding a row named after a host row is exactly what the
//     zero-override policy wants, and a duplicate loader entry id is a separate gate's business);
//   * anything else -> counted and printed as unclassified, never silently dropped.
// INLINE PRESET CHILDREN ARE OUT OF SCOPE BY CONSTRUCTION: the `config.plugins` list inside a
// `preset-mpd` row travels INSIDE that row (it is an agent-plane composition, not a home-patch
// row), so this walk never descends into `config` and those child ids cannot be mistaken for
// id-targets of the host-plane patch.
//
// WHAT IT COMPARES AGAINST (the host side, discovered on disk): for each host layer package —
// `dsh-base`, `dsh-web-app`, `dsh-headless` under the installed harness, and `dsh-tui` under a
// `~/.dsh/profiles/*/node_modules` (or the sandbox `HOME` named by `--home`) — the layer's OWN
// `dsh.bundle.patch` declaration is followed and EVERY id it declares is collected, whether as
// an id-target or inside an `insert:` list: a host's inserted row is host-owned too. A bundle
// id-target whose id appears in that set is a violation.
//
// FAILING LOUDLY ON A VACUOUS PASS: when no host layer is found at all the gate REFUSES to
// report success (a green run over zero host layers is an assertion about nothing), and says so.
// `--allow-no-host` exists for a partial/packed copy and downgrades that one condition to a loud
// NOTE; it never suppresses a real finding.
//
// DECLARED EXEMPTIONS ARE PRINTED, NEVER SKIPPED: `DECLARED_EXEMPT` is the single place an
// id-target could be excused, the run prints the class with its size whether or not it is empty,
// and each entry prints its own reason beside its id.
//
// Usage:
//   node scripts/verify-no-host-override.ts [--root <dir>] [--harness-root <dir>] [--home <dir>]
//                                          [--allow-no-host]
//   node scripts/verify-no-host-override.ts --self-test
//
// Exit: 0 when every id-target is bundle-owned (or the id is on the printed exempt list);
//       1 on any violation, on an unreadable patch layer, or on the vacuous-pass refusal.
// Evidence -> evidence/preset-default/no-host-override/<UTCts>/{result.json,output.log}.

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { cpSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readJson, repoRootFrom } from "./lib/repo.ts"

/** This script's own path, so a self-test arm can re-spawn the LIVE gate instead of a copy. */
const SELF: string = fileURLToPath(import.meta.url)
/** The repository root, derived from `<root>/scripts/<this file>`. */
const REPO: string = repoRootFrom(import.meta.url)
/** The prefix on every line this gate prints, so a log line names its producer. */
const PREFIX: string = "[verify-no-host-override]"
/** This process's arguments, without the node executable and the script path. */
const ARGV: readonly string[] = process.argv.slice(2)
/** The host layers whose DECLARED row ids this gate treats as untouchable, in report order. */
const HOST_LAYERS: readonly string[] = ["dsh-base", "dsh-web-app", "dsh-headless"]
/** The dsh-tui package's scope, whose profile-local copy is the TUI host layer of a TUI profile. */
const TUI_SCOPE: string = "@deepseek-harness-tui"
/** The dsh-tui package name; a profile-local copy is a host layer in every layout. */
const TUI_PACKAGE: string = "dsh-tui"

/** One id-target this gate is told to accept, with the reason printed beside it. */
interface ExemptTarget {
  /** The id-target's row id, matched exactly against the id a bundle patch declares. */
  readonly id: string
  /** Why the override is accepted; printed with the id so the excuse is never implicit. */
  readonly reason: string
}

/**
 * The id-targets accepted by DECLARATION. Empty today: this bundle id-targets NOTHING, which is
 * the whole point of the gate. An entry added here is printed as its own class on every run.
 */
const DECLARED_EXEMPT: readonly ExemptTarget[] = []

/** The patch declaration on a manifest: one path, a list of paths, or any foreign value. */
interface PatchDeclaration {
  /** The declared patch layer(s); only string members are followed. */
  readonly patch?: unknown
}

/** The `dsh` block of a manifest, reduced to the bundle section this gate reads. */
interface DshBlock {
  /** The bundle section carrying the patch declaration. */
  readonly bundle?: PatchDeclaration
}

/** A JSON manifest, reduced to the one nested key this gate needs. */
interface Manifest {
  /** The `dsh` block; absent on a non-bundle package. */
  readonly dsh?: DshBlock
}

/** One parsed YAML entry of a patch document, as far as this gate classifies it. */
interface PatchEntry {
  /** The entry's row id, when it declares one as a string. */
  readonly id?: unknown
  /** The `insert:` list of rows this layer ADDS; its presence is what makes an entry additive. */
  readonly insert?: unknown
}

/** The loader's `!!js` scalar, reconstructed as a marker so a parsed expression is never run. */
interface JsExpr {
  /** The expression source text, kept only so the marker is distinguishable from a plain object. */
  readonly __jsExpr: unknown
}

/** A reader bound to one installed js-yaml build: patch text in, the parsed document out. */
type YamlLoad = (text: string) => unknown

/** One discovered host layer: its name for the report and the patch files it declares. */
interface HostLayer {
  /** The layer's package name as the report prints it (`dsh-web-app`, `dsh-tui`, …). */
  readonly name: string
  /** The layer's package directory on disk. */
  readonly dir: string
  /** Every patch file the layer's own manifest declares, resolved and existing. */
  readonly patches: readonly string[]
}

/** One id declared by a host layer, with the file that declared it (so a failure cites evidence). */
interface HostRow {
  /** The row id the host layer declares. */
  readonly id: string
  /** The absolute patch file declaring it, or the layer's package dir when it declares none. */
  readonly declaredIn: string
}

/** The gate's verdict inputs, assembled so the printer never recomputes a discovery step. */
interface Verdict {
  /** The bundle's patch layers, resolved absolute paths. */
  readonly bundlePatches: readonly string[]
  /** Every bundle id-target found, in declaration order. */
  readonly idTargets: readonly string[]
  /** Every row id the bundle ADDS through an `insert:` list, in declaration order. */
  readonly inserted: readonly string[]
  /** Top-level entries this gate could classify as neither, counted so none is silently dropped. */
  readonly unclassified: number
  /** Host layers discovered on disk, in discovery order. */
  readonly layers: readonly HostLayer[]
  /** The union of every id those layers declare, keyed by id for the violation lookup. */
  readonly hostRows: ReadonlyMap<string, HostRow>
  /** Id-targets that ARE declared by a host layer, in bundle declaration order. */
  readonly violations: readonly string[]
  /** Id-targets excused by `DECLARED_EXEMPT`, in bundle declaration order. */
  readonly exempted: readonly string[]
}

/**
 * Read one flag's value from an argument vector.
 * @param argv The argument vector to scan.
 * @param flag The flag name, spelled with its leading dashes.
 * @returns The value after the flag, the value after `flag=`, or undefined when the flag is absent.
 */
function flagValue(argv: readonly string[], flag: string): string | undefined {
  // The flag's own index, or -1 when this run did not pass it.
  const at = argv.indexOf(flag)
  if (at >= 0) return argv[at + 1]
  // The `--flag=value` spelling, matched by prefix so the value needs no separate argv slot.
  const inline = argv.find((arg: string): boolean => arg.startsWith(flag + "="))
  return inline === undefined ? undefined : inline.slice(flag.length + 1)
}

/**
 * Report a blocking finding and stop the process.
 * @param message The finding, printed after this gate's prefix.
 * @returns Never: the process exits here, which is what lets callers rely on the exit code.
 */
function fail(message: string): never {
  console.error(PREFIX + " FAIL: " + message)
  process.exit(1)
}

/**
 * js-yaml resolved from the installed harness, so this gate adds no repository dependency.
 * @param root A directory whose resolution chain reaches an installed `js-yaml` (the harness root).
 * @returns A reader bound to that build, with the loader's `!!js` tag registered as a marker.
 */
function yamlLoader(root: string): YamlLoad {
  /** A `require` anchored at the harness package, so `js-yaml` resolves from ITS node_modules. */
  const req = createRequire(join(root, "package.json"))
  /** The harness's own js-yaml build. */
  const yaml = req("js-yaml")
  /** The `!!js` scalar tag, reconstructed as a marker so an expression is parsed but never run. */
  const jsTag = new yaml.Type("tag:yaml.org,2002:js", { kind: "scalar", construct: (data: unknown): JsExpr => ({ __jsExpr: data }) })
  return (text: string): unknown => yaml.load(text, { schema: yaml.DEFAULT_SCHEMA.extend([jsTag]) })
}

/**
 * The patch files a manifest declares, normalized to absolute paths.
 * @param manifestPath The manifest to read; an unreadable one yields no patches rather than a crash.
 * @param root The directory the declared relative paths resolve against.
 * @returns The declared patch files in declaration order; empty when none are declared.
 */
function declaredPatchFiles(manifestPath: string, root: string): string[] {
  // The declaration, still untyped: a manifest may spell it as a string, an array, or anything.
  let raw: unknown
  try {
    raw = readJson<Manifest>(manifestPath)?.dsh?.bundle?.patch
  } catch {
    return []
  }
  /** The declaration normalized to a list, so the single-string form still yields one entry. */
  const list: unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  return list
    .filter((value: unknown): value is string => typeof value === "string" && value.trim() !== "")
    .map((value: string): string => resolve(root, value))
}

/**
 * The top-level entries of one patch document.
 * @param file The patch file to parse.
 * @param load The YAML reader bound to the installed harness's js-yaml.
 * @returns The document's entries when it is a top-level list, else an empty list.
 */
function patchEntries(file: string, load: YamlLoad): PatchEntry[] {
  // The parsed document; a patch layer is a YAML ARRAY of entries, and anything else is reported
  // as unreadable rather than treated as "no rows", so a malformed layer cannot pass by silence.
  let doc: unknown
  try {
    doc = load(readFileSync(file, "utf8"))
  } catch (error) {
    fail("cannot parse patch layer " + file + ": " + (error instanceof Error ? error.message : String(error)))
  }
  if (!Array.isArray(doc)) fail("patch layer is not a top-level array of entries: " + file)
  return doc.filter((entry: unknown): entry is PatchEntry => entry !== null && typeof entry === "object")
}

/**
 * The directories whose `node_modules` may hold the installed harness's host layers.
 * @param explicit The `--harness-root` value, already an absolute path, or undefined.
 * @returns Candidate `node_modules` directories, de-duplicated and in probe order.
 */
function harnessModuleRoots(explicit: string | undefined): string[] {
  /** The candidates in probe order: the explicit root, then the PATH-resolved launcher's tree. */
  const roots: string[] = []
  if (explicit !== undefined) {
    // Both spellings of the same root: a directory HOLDING `@deepseek-ai/*`, or its parent with
    // the packages one `node_modules` deeper. Probing both keeps `--harness-root` unambiguous.
    roots.push(explicit, join(explicit, "node_modules"))
  }
  /** The `dsh` launcher PATH resolves, or `""` when the harness is not installed for this user. */
  const launcher: string = resolveOnPath("dsh")
  if (launcher !== "") {
    // The launcher's TARGET, because an npm-global `dsh` is a symlink: `<prefix>/bin/dsh` ->
    // `<prefix>/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`. Requiring beside the SYMLINK walks a
    // chain that never reaches `lib/node_modules` (measured: the gate could not find the harness
    // installed on this machine while `dsh` ran fine from PATH), so the real path is what anchors.
    /** The launcher's resolved target, or the launcher itself when the OS cannot resolve it. */
    let anchor: string = launcher
    try {
      anchor = realpathSync(launcher)
    } catch { /* an unresolvable link keeps the launcher's own path */ }
    // The REQUIRING form first, exactly as dsh-launcher's private `harnessRootNear` does it: the
    // resolver's parent chain is what reaches a global install's `lib/node_modules`.
    try {
      /** A `require` anchored beside the launcher's target, so the harness's chain answers. */
      const resolver = createRequire(join(dirname(anchor), "resolve.cjs"))
      roots.push(join(dirname(resolver.resolve("@deepseek-ai/dsh/package.json")), "node_modules"))
    } catch { /* fall through to the layout walk */ }
    // The walk from the launcher's target upward, for a layout the resolver cannot see (e.g. a
    // launcher inside a checkout's own `node_modules/.bin`).
    let dir: string = dirname(anchor)
    for (let depth = 0; depth < 6; depth += 1) {
      /** The harness package candidate at this walk depth. */
      const candidate = join(dir, "node_modules", "@deepseek-ai", "dsh")
      if (existsSync(join(candidate, "package.json"))) {
        roots.push(join(candidate, "node_modules"))
        break
      }
      /** The next directory up; equal to `dir` at the filesystem root, which ends the walk. */
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return [...new Set(roots)].filter((root: string): boolean => existsSync(root))
}

/**
 * The `dsh` launcher on PATH, without a shell.
 * @param name The bare command name to resolve.
 * @returns The absolute launcher path, or `""` when nothing on PATH matches.
 */
function resolveOnPath(name: string): string {
  // The platform's separator: a win32 PATH is `;`-joined, POSIX is `:`-joined.
  const separator: string = process.platform === "win32" ? ";" : ":"
  for (const dir of String(process.env.PATH ?? "").split(separator)) {
    if (dir === "") continue
    for (const candidate of [join(dir, name), join(dir, name + ".cmd")]) {
      if (existsSync(candidate)) return candidate
    }
  }
  return ""
}

/**
 * One host layer package, resolved from a module root.
 * @param moduleRoot A directory holding `@deepseek-ai/<layer>` and/or `@deepseek-harness-tui/dsh-tui`.
 * @param home The HOME whose `~/.dsh/profiles/*` copies are also scanned for the TUI host.
 * @returns The discovered layers, each with the patch files its own manifest declares.
 */
function hostLayersIn(moduleRoot: string, home: string): HostLayer[] {
  /** The discovered layers, in scan order. */
  const found: HostLayer[] = []
  /** The `<package> -> <scope>` pairs to probe under this module root. */
  const candidates: { name: string; dir: string }[] = HOST_LAYERS.map((layer: string) => ({ name: layer, dir: join(moduleRoot, "@deepseek-ai", layer) }))
  candidates.push({ name: TUI_PACKAGE, dir: join(moduleRoot, TUI_SCOPE, TUI_PACKAGE) })
  for (const candidate of candidates) {
    if (!existsSync(join(candidate.dir, "package.json"))) continue
    // The layer's own patch declaration; a layer that declares none is still a HOST (its package
    // name is what a row would mount), so it is listed with an empty patch set rather than dropped.
    /** The patch files the layer's own manifest declares. */
    const patches: string[] = declaredPatchFiles(join(candidate.dir, "package.json"), candidate.dir)
    /** The layer's `cordis.patch.yml`, the conventional layer name, when the manifest declares none. */
    const conventional: string = join(candidate.dir, "cordis.patch.yml")
    /** The effective patch set: the declared files that exist, plus the conventional name. */
    const effective: string[] = [...new Set([...patches, conventional])].filter((file: string): boolean => existsSync(file))
    found.push({ name: candidate.name, dir: candidate.dir, patches: effective })
  }
  // The profile-local TUI host: every `~/.dsh/profiles/*/node_modules/@deepseek-harness-tui/dsh-tui`.
  // This is the layout a REAL TUI install uses, and the sandbox HOME makes it the isolated subject.
  /** The profiles directory inside the HOME under audit. */
  const profiles: string = join(home, ".dsh", "profiles")
  if (existsSync(profiles)) {
    for (const entry of readdirSync(profiles, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      /** The TUI package directory of this profile, when the profile has one installed. */
      const dir: string = join(profiles, entry.name, "node_modules", TUI_SCOPE, TUI_PACKAGE)
      if (!existsSync(join(dir, "package.json"))) continue
      /** The patch files this profile-local copy declares. */
      const patches: string[] = declaredPatchFiles(join(dir, "package.json"), dir)
      /** The same effective set the harness-side probe builds. */
      const effective: string[] = [...new Set([...patches, join(dir, "cordis.patch.yml")])].filter((file: string): boolean => existsSync(file))
      found.push({ name: TUI_PACKAGE + " (profile " + entry.name + ")", dir, patches: effective })
    }
  }
  return found
}

/**
 * Every id a host layer declares, flattened for the violation lookup.
 * @param layers The discovered host layers.
 * @param load The YAML reader bound to the installed harness's js-yaml.
 * @returns A map from declared id to the host row that declares it; the first declarer wins.
 */
function hostDeclaredRows(layers: readonly HostLayer[], load: YamlLoad): Map<string, HostRow> {
  /** The accumulated `id -> declaring row` map. */
  const rows = new Map<string, HostRow>()
  for (const layer of layers) {
    for (const file of layer.patches) {
      for (const entry of patchEntries(file, load)) {
        /** The entries this one contributes: the entry itself, plus any `insert:` children. */
        const contributing: PatchEntry[] = [entry]
        if (Array.isArray(entry.insert)) {
          for (const child of entry.insert) if (child !== null && typeof child === "object") contributing.push(child as PatchEntry)
        }
        for (const item of contributing) {
          if (typeof item.id !== "string" || item.id === "") continue
          if (!rows.has(item.id)) rows.set(item.id, { id: item.id, declaredIn: file })
        }
      }
    }
  }
  return rows
}

/**
 * Classify one patch document into id-targets, inserted rows and everything else.
 * @param file The patch file to classify.
 * @param load The YAML reader bound to the installed harness's js-yaml.
 * @param into The verdict accumulator this document contributes to.
 * @returns Nothing: `into` is mutated with this document's rows.
 */
function classify(file: string, load: YamlLoad, into: { idTargets: string[]; inserted: string[]; unclassified: number }): void {
  for (const entry of patchEntries(file, load)) {
    // An `insert:` list is ADDITIVE by definition, so its entry is not an override whatever else
    // it carries; its ids are collected separately and never compared against the host set.
    if (Array.isArray(entry.insert)) {
      for (const child of entry.insert) {
        if (child !== null && typeof child === "object" && typeof (child as PatchEntry).id === "string") into.inserted.push((child as PatchEntry).id as string)
      }
      continue
    }
    if (typeof entry.id === "string" && entry.id !== "") {
      into.idTargets.push(entry.id)
      continue
    }
    into.unclassified += 1
  }
}

/**
 * The installed harness's js-yaml, probed across candidate anchors.
 * BOTH sides of the comparison parse through ONE reader, so a patch document cannot be
 * classified differently depending on which side of the gate it belongs to.
 * @param anchors Candidate anchor directories, in probe order (a harness package dir, the repo root).
 * @returns The first anchor's js-yaml reader.
 */
function resolveYamlLoader(anchors: readonly string[]): YamlLoad {
  for (const anchor of anchors) {
    try {
      return yamlLoader(anchor)
    } catch { /* this anchor has no resolvable js-yaml; the next one may */ }
  }
  fail("cannot resolve js-yaml from any anchor (" + anchors.join(", ") + ") - install the harness (`npm install -g @deepseek-ai/dsh`)")
}

/**
 * Discover the subject and the host side, then decide.
 * @param root The repository root whose `package.json` declares the patch layers.
 * @param harnessRoot The `--harness-root` value, or undefined to resolve the installed harness.
 * @param home The HOME whose profile-local TUI hosts are scanned.
 * @returns The assembled verdict, with nothing printed.
 */
function buildVerdict(root: string, harnessRoot: string | undefined, home: string): Verdict {
  /** The bundle's patch layers, from the ONE declaration the loader also reads. */
  const bundlePatches: string[] = declaredPatchFiles(join(root, "package.json"), root)
  if (bundlePatches.length === 0) fail("the root manifest declares no dsh.bundle.patch layer, so there is nothing to verify: " + join(root, "package.json"))
  for (const file of bundlePatches) if (!existsSync(file)) fail("declared patch layer does not exist: " + file)
  /** The module roots that may hold the installed harness's host layers. */
  const moduleRoots: string[] = harnessModuleRoots(harnessRoot)
  /** The YAML reader, anchored at the harness package when one is installed and at the repo else. */
  const load: YamlLoad = resolveYamlLoader([...moduleRoots.map((moduleRoot: string): string => join(moduleRoot, "@deepseek-ai", "dsh")), root])
  /** The accumulated classification of the bundle's own layers. */
  const classified = { idTargets: [] as string[], inserted: [] as string[], unclassified: 0 }
  for (const file of bundlePatches) classify(file, load, classified)
  /** The discovered host layers, across every module root and every profile-local TUI copy. */
  const layers: HostLayer[] = moduleRoots.flatMap((moduleRoot: string): HostLayer[] => hostLayersIn(moduleRoot, home))
  /** The union of every id the host layers declare. */
  const hostRows: Map<string, HostRow> = hostDeclaredRows(layers, load)
  /** The exempt ids, so an excused target is reported as a class instead of silently skipped. */
  const exemptIds = new Set(DECLARED_EXEMPT.map((entry: ExemptTarget): string => entry.id))
  return {
    bundlePatches,
    idTargets: classified.idTargets,
    inserted: classified.inserted,
    unclassified: classified.unclassified,
    layers,
    hostRows,
    violations: classified.idTargets.filter((id: string): boolean => hostRows.has(id) && !exemptIds.has(id)),
    exempted: classified.idTargets.filter((id: string): boolean => exemptIds.has(id)),
  }
}

/**
 * Print the verdict and exit with its code.
 * @param verdict The assembled verdict.
 * @param allowNoHost True when `--allow-no-host` downgrades the zero-host-layer refusal to a NOTE.
 * @returns Never: the process exits with 0 (green) or 1 (any finding).
 */
function report(verdict: Verdict, allowNoHost: boolean): never {
  console.log(PREFIX + " subject: " + verdict.bundlePatches.length + " declared patch layer(s)")
  for (const file of verdict.bundlePatches) console.log(PREFIX + "   patch: " + file)
  console.log(PREFIX + " bundle id-targets (overrides): " + verdict.idTargets.length + (verdict.idTargets.length > 0 ? " -> " + verdict.idTargets.join(", ") : " (none: this bundle is purely additive)"))
  console.log(PREFIX + " bundle inserted rows (additive): " + verdict.inserted.length)
  console.log(PREFIX + " unclassified top-level entries: " + verdict.unclassified)
  console.log(PREFIX + " host layers found on disk: " + verdict.layers.length)
  for (const layer of verdict.layers) console.log(PREFIX + "   host: " + layer.name + " -> " + layer.dir + " [" + layer.patches.length + " patch file(s)]")
  console.log(PREFIX + " host-declared row ids: " + verdict.hostRows.size)
  console.log(PREFIX + " declared exemptions (" + DECLARED_EXEMPT.length + "): " + (DECLARED_EXEMPT.length === 0 ? "none" : DECLARED_EXEMPT.map((entry: ExemptTarget): string => entry.id + " (" + entry.reason + ")").join("; ")))
  for (const id of verdict.exempted) console.log(PREFIX + "   exempt target honoured: " + id)
  if (verdict.layers.length === 0) {
    // A green run over zero host layers asserts nothing, so it is refused by default; the flag is
    // the ONE way to accept it, and even then the condition is printed rather than hidden.
    if (!allowNoHost) fail("no host layer found on disk (dsh-base / dsh-web-app / dsh-headless under the installed harness, dsh-tui under a profile) — a PASS here would be vacuous; install the harness, pass --harness-root, or accept it loudly with --allow-no-host")
    console.log(PREFIX + " NOTE (--allow-no-host): no host layer was found, so NO id-target was compared — this run proves nothing about overrides")
  }
  if (verdict.violations.length > 0) {
    console.error(PREFIX + " FAIL: " + verdict.violations.length + " id-target(s) override a row a HOST layer declares:")
    for (const id of verdict.violations) {
      /** The host row that declares this id. */
      const row = verdict.hostRows.get(id)
      console.error(PREFIX + "   - " + id + " is declared by " + (row === undefined ? "(unknown)" : row.declaredIn))
    }
    console.error(PREFIX + " policy: a shipped row may ADD a capability, never overwrite a host layer's decision. Remove the id-target, or add a DECLARED_EXEMPT entry with a reason.")
    process.exit(1)
  }
  console.log(PREFIX + " PASS: every id-target is bundle-owned (0 of " + verdict.idTargets.length + " collide with the " + verdict.hostRows.size + " host-declared row ids)")
  process.exit(0)
}

/**
 * The installed harness's own js-yaml directory, so a self-test fixture can carry a REAL parser.
 * @returns The absolute js-yaml package directory, or undefined when no harness is installed.
 */
function installedJsYamlDir(): string | undefined {
  /** The PATH-resolved launcher, or `""` when the harness is not installed for this user. */
  const launcher: string = resolveOnPath("dsh")
  if (launcher === "") return undefined
  try {
    /** A `require` anchored beside the launcher's target, where the harness's chain resolves. */
    const resolver = createRequire(join(dirname(realpathSync(launcher)), "resolve.cjs"))
    return dirname(resolver.resolve("js-yaml/package.json"))
  } catch {
    return undefined
  }
}

/**
 * Build the hermetic fixture tree one self-test arm drives the live gate against.
 * @param base The temporary directory the fixture lives in.
 * @param bundlePatch The fixture bundle patch document, written verbatim.
 * @param hostPatch The fixture host layer's patch document, written verbatim.
 * @returns The `--root`, `--harness-root` and `--home` values the arm passes to the gate.
 */
function fixture(base: string, bundlePatch: string, hostPatch: string): { root: string; harnessRoot: string; home: string } {
  /** The fixture repository whose manifest declares the fixture bundle patch. */
  const root: string = join(base, "repo")
  /** The fixture harness tree, whose `@deepseek-ai/dsh` package anchors the js-yaml reader. */
  const harnessRoot: string = join(base, "harness")
  /** The fixture HOME, which carries one profile-local `dsh-tui` host layer. */
  const home: string = join(base, "home")
  /** The fixture host layer directory inside the fixture harness. */
  const layer: string = join(harnessRoot, "node_modules", "@deepseek-ai", "dsh-base")
  /** The profile-local TUI layer directory inside the fixture HOME. */
  const tui: string = join(home, ".dsh", "profiles", "dsh-tui", "node_modules", TUI_SCOPE, TUI_PACKAGE)
  for (const dir of [root, layer, tui, join(harnessRoot, "node_modules", "@deepseek-ai", "dsh")]) mkdirSync(dir, { recursive: true })
  // A REAL js-yaml inside the fixture, so every arm runs with `PATH` cleared and cannot accidentally
  // exercise the machine's installed harness: a control that needs its subject to work is no control.
  /** The installed js-yaml to copy, or undefined when no harness is installed on this machine. */
  const yamlDir: string | undefined = installedJsYamlDir()
  if (yamlDir === undefined) fail("self-test needs an installed harness for its js-yaml fixture (the same prerequisite the live-tree arm has): `npm install -g @deepseek-ai/dsh`")
  cpSync(yamlDir, join(harnessRoot, "node_modules", "js-yaml"), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fx-bundle", dsh: { bundle: { patch: ["./cordis.patch.yml"] } } }, null, 2))
  writeFileSync(join(root, "cordis.patch.yml"), bundlePatch)
  writeFileSync(join(layer, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh-base", dsh: { bundle: { patch: "./cordis.patch.yml" } } }, null, 2))
  writeFileSync(join(layer, "cordis.patch.yml"), hostPatch)
  writeFileSync(join(tui, "package.json"), JSON.stringify({ name: TUI_SCOPE + "/" + TUI_PACKAGE }, null, 2))
  writeFileSync(join(tui, "cordis.patch.yml"), "- insert:\n    - id: host-tui-row\n      name: '@deepseek-ai/dsh-agent-preset-registry'\n")
  return { root, harnessRoot, home }
}

/**
 * Run the LIVE gate against one fixture and return its observable outcome.
 * @param args The gate arguments for this arm.
 * @param hermetic True to clear `PATH`, so only the fixture's own trees can be discovered.
 * @returns The child's exit status, stdout and stderr.
 */
function runGate(args: readonly string[], hermetic: boolean = true): { status: number | null; out: string; err: string } {
  /** The child gate process; the LIVE script is re-spawned, never a copied stand-in. */
  const child = spawnSync(process.execPath, [SELF, ...args], { encoding: "utf8", env: hermetic ? { ...process.env, PATH: "" } : process.env })
  return { status: child.status, out: child.stdout ?? "", err: child.stderr ?? "" }
}

/**
 * The `--self-test` arm runner: four fixtures, each asserting on the live gate's real behaviour.
 * @returns Never: exits 0 when every arm holds, 1 on the first arm that does not.
 */
function selfTest(): never {
  /** The temporary fixture root every arm lives under, removed at the end. */
  const base: string = join(tmpdir(), "mpd-no-host-override-" + process.pid)
  rmSync(base, { recursive: true, force: true })
  mkdirSync(base, { recursive: true })
  /** The per-arm outcomes, so a failing arm reports every message it observed. */
  const arm = (label: string, ok: boolean, detail: string): void => {
    console.log(PREFIX + " self-test " + (ok ? "ok   " : "FAIL ") + label + " — " + detail)
    if (!ok) {
      rmSync(base, { recursive: true, force: true })
      process.exit(1)
    }
  }
  /** The host patch the fixture harness declares; its ids are the untouchable set. */
  const hostPatch: string = "- insert:\n    - id: host-row-a\n      name: '@deepseek-ai/dsh-agent-preset-registry'\n"
  // ARM (a) CLEAN CONTROL: an additive-only bundle patch must pass against a host that declares rows.
  /** The additive-only fixture. */
  const clean = fixture(join(base, "clean"), "- insert:\n    - id: our-row\n      name: '@mpd-dsh/mpd/packages/x/dist/index.js'\n", hostPatch)
  /** The clean arm's child run. */
  const a = runGate(["--root", clean.root, "--harness-root", clean.harnessRoot, "--home", clean.home])
  arm("(a) additive-only bundle vs a host declaring rows -> exit 0", a.status === 0 && a.out.includes("PASS: every id-target is bundle-owned"), "exit " + a.status + "; " + (a.out.trim().split("\n").pop() ?? "(no stdout)"))
  // ARM (b) SEEDED OFFENDER: an id-target on a host-declared id must fail AND name the host file.
  /** The offending fixture: the very override this gate exists to catch. */
  const offender = fixture(join(base, "offender"), "- id: host-row-a\n  name: '@deepseek-ai/dsh-agent-preset-registry'\n  config:\n    default: mpd\n", hostPatch)
  /** The offending arm's child run. */
  const b = runGate(["--root", offender.root, "--harness-root", offender.harnessRoot, "--home", offender.home])
  arm("(b) id-target on a host-declared id -> exit 1 + the declaring host file named", b.status === 1 && b.err.includes("host-row-a") && b.err.includes(join("dsh-base", "cordis.patch.yml")), "exit " + b.status + "; " + (b.err.split("\n").find((line: string): boolean => line.includes("host-row-a")) ?? "(no violation line)"))
  // ARM (b2) THE PROFILE-LOCAL TUI HOST: the same id declared by a `~/.dsh/profiles/*` copy must be
  // caught too, because that is the layout a TUI install actually uses (the offline counterpart of
  // the removal this gate was written for).
  /** The fixture whose violation is only visible through the profile-local TUI layer. */
  const tuiOffender = fixture(join(base, "tui-offender"), "- id: host-tui-row\n  name: '@deepseek-ai/dsh-agent-preset-registry'\n  config:\n    default: mpd\n", hostPatch)
  /** The TUI-owner arm's child run. */
  const b2 = runGate(["--root", tuiOffender.root, "--harness-root", tuiOffender.harnessRoot, "--home", tuiOffender.home])
  arm("(b2) id-target on a PROFILE-LOCAL dsh-tui row -> exit 1", b2.status === 1 && b2.err.includes("host-tui-row") && b2.err.includes("dsh-tui"), "exit " + b2.status + "; " + (b2.err.split("\n").find((line: string): boolean => line.includes("host-tui-row")) ?? "(no violation line)"))
  // ARM (c) FALSIFIABILITY: the SAME id, carried by an `insert:` list instead of an id-target, must
  // PASS — so arm (b) failed because the row was an OVERRIDE, not because the id string appeared.
  /** The additive fixture reusing the host's id, which the policy explicitly allows. */
  const additive = fixture(join(base, "additive"), "- insert:\n    - id: host-row-a\n      name: '@mpd-dsh/mpd/packages/x/dist/index.js'\n", hostPatch)
  /** The falsifiability arm's child run. */
  const c = runGate(["--root", additive.root, "--harness-root", additive.harnessRoot, "--home", additive.home])
  arm("(c) the SAME id added through insert: -> exit 0 (proves (b) keyed on the override)", c.status === 0 && c.out.includes("bundle id-targets (overrides): 0"), "exit " + c.status + "; " + (c.out.split("\n").find((line: string): boolean => line.includes("id-targets")) ?? "(no id-target line)"))
  // ARM (d) VACUOUS-PASS REFUSAL: with no host layer reachable the gate must NOT report PASS.
  /** The fixture whose harness tree holds no host layer at all. */
  const empty = fixture(join(base, "empty"), "- id: some-bundle-row\n  name: '@mpd-dsh/mpd/packages/x/dist/index.js'\n", "- insert:\n    - id: unused\n      name: '@deepseek-ai/dsh-base'\n")
  rmSync(join(empty.harnessRoot, "node_modules", "@deepseek-ai", "dsh-base"), { recursive: true, force: true })
  // `PATH` is cleared for this arm so the REAL installed harness cannot be discovered instead:
  // the fixture's own js-yaml is what lets the gate get as far as the host-layer scan.
  /** The vacuous arm's child run, with no host layer anywhere in the fixture or on PATH. */
  const d = runGate(["--root", empty.root, "--harness-root", empty.harnessRoot, "--home", join(empty.home, "nowhere")])
  arm("(d) zero host layers -> exit 1 with the vacuous-pass refusal", d.status === 1 && d.err.includes("vacuous") && !d.out.includes("PASS:"), "exit " + d.status + "; " + (d.err.split("\n").find((line: string): boolean => line.includes("vacuous")) ?? "(no refusal line)"))
  // ARM (e) THE LIVE TREE: this repository's real patch layers against the REAL installed harness,
  // which is the arm that keeps the shipped file honest (fixtures alone prove only the gate's logic).
  /** The live arm's child run, PATH intact so the machine's own harness is the subject. */
  const e = runGate(["--root", REPO, "--home", homedir()], false)
  arm("(e) this repository's live patch layers vs the installed harness -> exit 0", e.status === 0 && e.out.includes("PASS:"), "exit " + e.status + "; " + (e.out.trim().split("\n").pop() ?? "(no stdout)"))
  rmSync(base, { recursive: true, force: true })
  console.log(PREFIX + " self-test PASS: 6 arms (clean, offender, TUI-profile offender, falsifiability, vacuous refusal, live tree)")
  process.exit(0)
}

// The one entry point: the self-test arm runner, or the gate over the live tree.
if (ARGV.includes("--self-test")) {
  selfTest()
} else {
  report(buildVerdict(resolve(flagValue(ARGV, "--root") ?? REPO), flagValue(ARGV, "--harness-root"), resolve(flagValue(ARGV, "--home") ?? homedir())), ARGV.includes("--allow-no-host"))
}
