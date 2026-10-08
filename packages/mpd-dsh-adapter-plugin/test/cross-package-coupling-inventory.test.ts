// INDEPENDENCE GATE — the cross-package coupling inventory is COUNTED, FROZEN and can only shrink.
//
// The independence contract (docs/independence.md, acceptance A1.3) says the bundle's parts are
// independent packages: each declares its own manifest, is loaded by its own row, and no package
// patches another package's objects at runtime. What REMAINS is a small set of source-level
// couplings, and a coupling nobody counted is exactly how "independent" quietly stops being true.
// This gate is that count. It scans `packages/mpd-*/src/**/*.ts` and freezes three classes:
//
//   1. CROSS-PACKAGE IMPORT — a relative specifier that resolves OUTSIDE the importing package.
//      Today these are legitimate (a row reusing the adapter's helpers or a sibling's schema), so
//      they are PINNED rather than banned: the inventory may only SHRINK. An entry that no longer
//      matches anything is a STALE entry and fails too, because a frozen set that is not tracked
//      rots into a fiction. Imports that target a SANCTIONED ADAPTER package are the one EXEMPT
//      class — see SANCTIONED_ADAPTER_PACKAGES below for why, and the report prints them loudly so
//      the exemption is never silent.
//   2. GLOBAL WRITE — an assignment to a `globalThis`/`global` member, or `Object.assign` /
//      `Object.defineProperty` on one. That is the runtime-handoff shape the contract forbids: it
//      makes one package's internals reachable from another through the process, invisible to both
//      `import` graphs and bundlers. MEASURED 2026-10-02: the band carries ZERO of these (the only
//      `globalThis` uses in `packages/*/src` are READS — the hashline vendor's runtime probe — and
//      the two warn-once registries live in shipped `cordis.patch.yml` GUARD EXPRESSIONS, not here).
//   3. HARNESS SERVICE PROVIDE — `ctx.provide("<name>", …)` where the name is one of the harness
//      seam ids the adapter owns (`DSH_SEAM_NAMES`, imported from the adapter itself so there is
//      ONE vocabulary). Providing a harness service from a row is how a bundle overrides the host.
//      MEASURED 2026-10-02: the band carries ZERO of these too — every `ctx.provide` in the tree
//      publishes an MPD-OWNED service (`mpdDsh`, `mpdRoles`, `mpdConfig`, `mpdWorkmate`, …).
//
// WHAT THE SCAN DOES, and what it deliberately does not (the D6 discipline this file copies):
//   * COMMENTS are stripped before matching (line structure preserved), so a doc line explaining
//     the rule is not a violation of it, while a STRING literal is copied verbatim and still matches;
//   * findings report the ORIGINAL line number and the original line text;
//   * the INVENTORY is keyed by `file :: normalized line text` and NEVER by line number, so an edit
//     above a coupling never rewrites the entry (T-55);
//   * a non-`.ts` file under a scanned `src/` is the DECLARED OUT-OF-BAND set: hits there are
//     printed in a loud NOT COVERED section and never fail the run;
//   * NO tree is declared out of the band any more: the RETIRED adopted body
//     (`packages/mpd-agent-teams-plugin/lib/**`) that used to be declared here — and counted on every
//     run so the blind spot stayed measured — is DELETED (de-vendor wave), and its replacement home
//     (`packages/mpd-schemastery/{lib,harness}`) sits outside `src/` and so outside this subject;
//   * a `.provide(...)` whose first argument is not a string LITERAL is printed in its own
//     "not statically readable" section and never fails — a line scan cannot follow a constant, and
//     naming that bound beats pretending the rule covers it.
//
// USAGE (both work; `--self-test` proves the gate reddens on a seeded violation, `--print-inventory`
// prints the frozen list in the exact literal form the constant below takes):
//   bun  packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts [--self-test|--print-inventory]
//
// THIS FILE IS RUN WITH `bun`, not node: it imports `DSH_SEAM_NAMES` from the adapter's own
// `src/index.ts`, and `packages/*/src` speaks the bundle's extensionless specifier form, which node's
// type stripping cannot resolve. Under `bun test` the two functions below are registered as ordinary
// test cases, so the gate also guards the adapter package's own suite.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import type { Dirent } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { DSH_SEAM_NAMES } from "../src/index.ts"

/** The three coupling classes this gate knows; one finding carries exactly one of them. */
export type CouplingKind = "cross-package-import" | "global-write" | "harness-service-provide"

/**
 * Packages whose imports are EXEMPT from the frozen inventory: an adapter IS the sanctioned contact
 * surface (AGENTS.md §6), so a row that starts importing one is being made MORE independent, not
 * less, and taxing that direction with an inventory edit would fight the contract it serves.
 *
 * The exemption is an allowlist of NAMES, never a `*-adapter-plugin` suffix rule: a suffix rule
 * would let any package rename itself into the exemption. Adding a third adapter is therefore a
 * deliberate edit HERE, which is the point. `mpd-tui-adapter-plugin` is listed before it exists so
 * the TUI-plane convergence (plan TODO 1 / A2.2) is not blocked by this gate while it lands.
 */
export const SANCTIONED_ADAPTER_PACKAGES: readonly string[] = [
  "mpd-dsh-adapter-plugin",
  "mpd-tui-adapter-plugin",
]

/** One reported coupling: the class that matched, and the ORIGINAL line it matched on. */
export interface CouplingFinding {
  /** The file's path relative to the scanned root, `/`-separated. */
  file: string
  /** The 1-based line in the ORIGINAL file (comment stripping preserves line structure). */
  line: number
  /** Which of the three coupling classes produced this entry. */
  kind: CouplingKind
  /** The package the coupling points at, or `""` when the specifier leaves `packages/` entirely. */
  target: string
  /** The original line's text, trimmed, so a finding reads without opening the file. */
  text: string
}

/** One scan's outcome: the couplings, the frozen/undefined split, and the declared blind spots. */
export interface CouplingScan {
  /** Every coupling found in the band, in file order, one per matching line. */
  findings: CouplingFinding[]
  /** The subset whose target is a SANCTIONED adapter package: printed, allowed to grow, never frozen. */
  sanctioned: CouplingFinding[]
  /** `findings` minus `sanctioned`: the subset the frozen inventory must describe EXACTLY. */
  frozen: CouplingFinding[]
  /** Frozen findings whose identity is absent from the inventory — the gate's FAIL condition. */
  unfrozen: CouplingFinding[]
  /** Inventory identities that matched nothing — also a FAIL, because the set may only shrink on purpose. */
  stale: string[]
  /** Hits in a non-`.ts` file under a scanned `src/`: printed as NOT COVERED, never failing. */
  outOfBand: CouplingFinding[]
  /** `.provide(...)` calls whose first argument is not a literal: printed as unreadable, never failing. */
  unverifiableProvides: CouplingFinding[]
  /** The MPD-owned service names a row DOES provide, deduplicated and sorted (allowed by design). */
  ownServiceNames: string[]
  /** How many entries the inventory this scan was compared against holds. */
  inventorySize: number
  /** How many `packages/mpd-*` `src/` roots were scanned. */
  packages: number
  /** How many `.ts` files were read inside those roots. */
  files: number
}

/** One self-test arm: its description, its verdict, and the detail printed when it fails. */
export interface SelfTestCheck {
  /** The arm's description, printed on its own report line. */
  name: string
  /** Whether the arm held. */
  ok: boolean
  /** The measured value, printed only for a failing arm. */
  detail: string
}

/** The self-test's full result: every arm plus the scan the seeded fixture produced. */
export interface SelfTestResult {
  /** Whether every arm held. */
  ok: boolean
  /** Every arm, in the order the fixture declares them. */
  checks: SelfTestCheck[]
  /** The fixture root, already removed (`undefined` only when the run never seeded one). */
  tempRoot: string | undefined
  /** The fixture scan's couplings, for a caller that wants to print them. */
  scan: CouplingScan | undefined
}

/** A report sink: one line at a time, so a caller can capture or silence the report. */
export type ReportStream = (line: string) => void

/** The scanned band: TypeScript sources under the `packages/mpd-<name>/src` roots. */
const BAND_EXTENSION = ".ts"
/** Extensions reported (never failed) when they sit under a scanned package's `src/`. */
const OUT_OF_BAND_EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx", ".tsx", ".mts", ".cts"]
// NO DECLARED OUT-OF-BAND TREE REMAINS. This constant used to name the RETIRED adopted body's
// `packages/mpd-agent-teams-plugin/lib`, counted and printed on every run so a tree the band never
// scans stayed visible. That body is DELETED (de-vendor wave), and its replacement home
// (`packages/mpd-schemastery/{lib,harness}`) needs no declaration for the same reason the old one
// arguably never did: the scanned band is `packages/mpd-<name>/src/**`, so a tree outside `src/`
// is not skipped by this rule, it is simply outside the subject. The report line went with it —
// a "0 file(s), never scanned" line for a directory that does not exist is noise, not a guard.

/** A `from "<specifier>"` clause, the shape every static import/export of this repo uses. */
const FROM_SPECIFIER = /\bfrom\s*["']([^"']+)["']/g
/** A side-effect or dynamic `import "<specifier>"` / `import("<specifier>")`. */
const BARE_IMPORT_SPECIFIER = /\bimport\s*\(?\s*["']([^"']+)["']/g
/** An assignment to a `globalThis`/`global` member: the runtime-handoff shape the contract forbids. */
const GLOBAL_MEMBER_WRITE = /\bglobalThis\s*(?:\.\s*[\w$]+|\[[^\]]+\])\s*(?:=[^=]|\|\|=|\?\?=|\+=)/
/** `Object.assign(globalThis, …)` and friends: the same handoff spelled without an `=`. */
const GLOBAL_OBJECT_WRITE = /\bObject\s*\.\s*(?:assign|defineProperty|defineProperties)\s*\(\s*(?:globalThis|global|self|window)\b/
/** A legacy `global.<name> =` write, which is the same class on a node-only spelling. */
const GLOBAL_LEGACY_WRITE = /\bglobal\s*\.\s*[\w$]+\s*=[^=]/
/** Any `.provide(` call, whatever its receiver: `ctx.provide`, `(ctx as X).provide`, `ctx.provide?.(`. */
const PROVIDE_CALL = /\.\s*provide\s*\??\.?\s*\(/g

/** This test file's own directory, which is also the fallback scratch root's parent. */
const here = dirname(fileURLToPath(import.meta.url))
/** `<repo>/packages/mpd-dsh-adapter-plugin/test` -> `<repo>`. */
export const REPO_ROOT: string = resolve(here, "..", "..", "..")

/**
 * THE FROZEN INVENTORY — every non-adapter coupling in the band on 2026-10-02, keyed by
 * `file :: normalized line text` and NEVER by line number.
 *
 * The set may only SHRINK: deleting an entry is how a coupling is retired, and an entry that no
 * longer matches anything fails the gate as STALE rather than lingering as a claim nothing backs.
 * Adding an entry is a deliberate act — it is the record that the bundle grew a new compile-time
 * dependency, and it belongs in the commit that grew it.
 *
 * Regenerate with `--print-inventory` (read-only) after a deliberate, reviewed change.
 */
export const FROZEN_COUPLINGS: readonly string[] = [
  // mpd-bootstrap -> mpd-ext: the ONE implementation of the skill-frontmatter subset, shared with
  // the extension skill plane instead of forked.
  "packages/mpd-bootstrap-plugin/src/index.ts :: import { isAbsent, parseFrontmatter, parseInvocation, stringField, type Frontmatter } from \"../../mpd-ext-plugin/src/skill-frontmatter\"",
  // R5 (lane F, 2026-10-02): the codegraph row's apply-time status line used to go to `console.log`,
  // which prints into the TUI's alternate screen. It now goes through THE shared log sink, so the
  // plugin no longer owns a terminal writer — the coupling is the point, not a leak.
  "packages/mpd-codegraph-plugin/src/index.ts :: import { openLogSink } from \"../../mpd-mcp-shared/log-sink\"",
  "packages/mpd-codegraph-plugin/src/index.ts :: import type { LogSink } from \"../../mpd-mcp-shared/log-sink\"",
  // R5 phase 2 (lane F, 2026-10-02): the adapter gained `rowLog()`, which is the ONE place a row asks
  // for a log file. The coupling direction is the sanctioned one — every row already imports the
  // adapter (it is EXEMPT outright) — and keeping the sink behind it means the sink has exactly one
  // importer outside the MCP packages instead of eleven.
  "packages/mpd-dsh-adapter-plugin/src/index.ts :: import { openLogSink } from \"../../mpd-mcp-shared/log-sink\"",
  "packages/mpd-dsh-adapter-plugin/src/index.ts :: import type { LogSink } from \"../../mpd-mcp-shared/log-sink\"",
  // THE FOUR MCP LAUNCHERS, visible to this scan only since 2026-10-03. They have imported the shared
  // sink and the shared binary resolver since wave 2 — the coupling is NOT new; what changed is that
  // the launchers moved from `packages/mpd-mcp-<x>/launch.ts` (outside the scanned band, which is
  // `packages/mpd-*/src/**`) into `src/` so they could be BUILT, because a `.ts` file under
  // node_modules cannot be run at all (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). Recorded here
  // because a coupling this gate cannot see is a coupling nobody counts.
  "packages/mpd-mcp-astgrep/src/launch.ts :: import { installTerminalSilence } from \"../../mpd-mcp-shared/log-sink.ts\"",
  "packages/mpd-mcp-astgrep/src/launch.ts :: import { resolveAstGrepBinary } from \"../../mpd-mcp-shared/bin-resolve.ts\"",
  "packages/mpd-mcp-codegraph/src/launch.ts :: import { installTerminalSilence } from \"../../mpd-mcp-shared/log-sink.ts\"",
  "packages/mpd-mcp-codegraph/src/launch.ts :: import { resolveCodegraphBinary } from \"../../mpd-mcp-shared/bin-resolve.ts\"",
  "packages/mpd-mcp-gitbash/src/launch.ts :: import { installTerminalSilence } from \"../../mpd-mcp-shared/log-sink.ts\"",
  "packages/mpd-mcp-lsp/src/launch.ts :: import { installTerminalSilence, resolveLogRoots } from \"../../mpd-mcp-shared/log-sink.ts\"",
  // THE TWO LAUNCHERS BECAME REAL THIN LAUNCHERS (de-omo wave B2, 2026-10-08): they no longer import
  // a vendored `./cli.js` beside them, so they resolve their server through the SHARED dependency
  // resolver, type their diagnostics channel on the SHARED sink interface, and degrade through the
  // SHARED unavailable-server fallback. Six NEW edges, frozen here rather than discovered later —
  // the R5 sink edge above was re-spelled in the same edit (it now also imports `resolveLogRoots`).
  "packages/mpd-mcp-gitbash/src/launch.ts :: import { resolveDependencyEntry } from \"../../mpd-mcp-shared/dependency-entry.ts\"",
  "packages/mpd-mcp-gitbash/src/launch.ts :: import type { LogSink } from \"../../mpd-mcp-shared/log-sink.ts\"",
  "packages/mpd-mcp-gitbash/src/launch.ts :: import { serveUnavailable } from \"../../mpd-mcp-shared/unavailable-server.ts\"",
  "packages/mpd-mcp-lsp/src/launch.ts :: import { resolveDependencyEntry } from \"../../mpd-mcp-shared/dependency-entry.ts\"",
  "packages/mpd-mcp-lsp/src/launch.ts :: import type { LogSink } from \"../../mpd-mcp-shared/log-sink.ts\"",
  "packages/mpd-mcp-lsp/src/launch.ts :: import { serveUnavailable } from \"../../mpd-mcp-shared/unavailable-server.ts\"",
  // THE AST_GREP SERVER IS OURS NOW (de-omo wave B1, 2026-10-08): the vendored artifact inlined both
  // shared modules, so these two edges are NEW to the scan even though the imports themselves only
  // moved from a bundle into source. `cli.ts` routes the row's diagnostics through THE shared sink
  // (R5) and `server.ts` resolves the engine through the shared binary resolver — the same pair the
  // launchers above already carry. Frozen here by the registration repair, which owns this inventory
  // this wave; the gate stays green instead of reddening on an edge that was written on purpose.
  "packages/mpd-mcp-astgrep/src/cli.ts :: import { openLogSink } from \"../../mpd-mcp-shared/log-sink.ts\"",
  "packages/mpd-mcp-astgrep/src/server.ts :: import { probeAstGrep, resolveAstGrepBinary } from \"../../mpd-mcp-shared/bin-resolve.ts\"",
  // THE DEBT IS REPAID, NOT DELETED (de-vendor wave): the four files below used to import the
  // schemastery tree vendored inside the adopted `packages/mpd-agent-teams-plugin`, which is why
  // docs/independence.md §4 carried them as a PINNED DEBT. That body is DELETED and the validator
  // now lives in `packages/mpd-schemastery` — an mpd-owned package — so the four couplings are
  // still real cross-package edges and stay FROZEN here, pointed at their new home. Frozen, not
  // dropped: this gate exists to make a NEW edge loud, and quietly deleting these entries would
  // hide the exact edges the wave rewrote.
  "packages/mpd-config-plugin/src/index.ts :: import z from \"../../mpd-schemastery\"",
  "packages/mpd-config-plugin/src/settings-schema.ts :: import z from \"../../mpd-schemastery\"",
  "packages/mpd-team-watchdog-plugin/src/index.ts :: import z from \"../../mpd-schemastery\"",
  "packages/mpd-tui-plugin/src/index.ts :: import z from \"../../mpd-schemastery\"",
  // LANE D'S LAW (the W4 wave this same pull request lands): the roles plugin arms the verification
  // law by reading the verifier seat and its record shape out of the new `mpd-verify-plugin`, and
  // the service NAME is imported from its `service.ts` rather than restated — the same one-source
  // rule the roster/table couplings above already follow. Frozen HERE by lane B, which owns this
  // inventory this wave, so the gate stays green across the two lanes instead of reddening on an
  // edge that was written on purpose. The third entry is spelled exactly as the scanner captures a
  // multi-line `import type { … } from` clause; that leading `}` is the scanner's own form.
  "packages/mpd-roles-plugin/src/index.ts :: import { VERIFY_SERVICE } from \"../../mpd-verify-plugin/src/service.ts\"",
  "packages/mpd-roles-plugin/src/verify-guard.ts :: import type { ArmedLoopView, VerifierSeatView } from \"../../mpd-verify-plugin/src/law.ts\"",
  "packages/mpd-roles-plugin/src/verify-guard.ts :: } from \"../../mpd-verify-plugin/src/law.ts\"",
  // mpd-ext -> mpd-roles: the roster table is read, never restated.
  "packages/mpd-ext-plugin/src/registry.ts :: import { ROLES, ROLE_BY_ID } from \"../../mpd-roles-plugin/src/roles.data\"",
  // mpd-roster-provider -> mpd-config: the slot membership has ONE declaration for both settings
  // front doors, which is the whole reason this coupling is allowed to exist.
  "packages/mpd-roster-provider-plugin/src/index.ts :: import { TEAM_MODEL_SLOT_GROUPS } from \"../../mpd-config-plugin/src/settings-schema\"",
  // The TUI plane's typed reads of the team record and the watchdog's incident shape. The
  // `import type` entries are ERASED by the build and create no runtime edge; they stay frozen
  // because they are still a source-level dependency on a sibling's internal module path.
  "packages/mpd-tui-plugin/src/index.ts :: import type { TeamRecord } from \"../../mpd-team-core-plugin/src/team-store.js\"",
  "packages/mpd-tui-plugin/src/scenes.ts :: import type { TeamRecord } from \"../../mpd-team-core-plugin/src/team-store.js\"",
  "packages/mpd-tui-plugin/src/settings.ts :: import { BRIDGE_DISCLOSURE, BRIDGE_NOT_LOST, SettingsSchema, SETTINGS_KNOBS, SETTINGS_NS, TEAM_MODEL_FALLBACK_OPTIONS } from \"../../mpd-config-plugin/src/settings-schema\"",
  // mpd-tui -> mpd-config AGAIN, from the model menu this time, and for the same reason the entry
  // above is allowed: the four slots and their member groups have ONE declaration, and the /mpd-model
  // pick-list has to offer exactly the slots the settings rows expose. Restating them in
  // `model-menu.ts` would be the drift this inventory exists to catch, so the import is recorded
  // rather than removed.
  "packages/mpd-tui-plugin/src/model-menu.ts :: import { TEAM_MODEL_SLOT_GROUPS, TEAM_MODEL_SLOTS } from \"../../mpd-config-plugin/src/settings-schema\"",
  "packages/mpd-tui-plugin/src/state.ts :: import type { TeamRecord } from \"../../mpd-team-core-plugin/src/team-store.js\"",
  "packages/mpd-tui-plugin/src/status.ts :: import type { TeamRecord } from \"../../mpd-team-core-plugin/src/team-store.js\"",
  "packages/mpd-tui-plugin/src/team-state.ts :: import type { TeamRecord, TeamTaskRecord } from \"../../mpd-team-core-plugin/src/team-store.js\"",
  "packages/mpd-tui-plugin/src/watchdog.ts :: import type { IncidentRecord } from \"../../mpd-team-watchdog-plugin/src/sidecars.js\"",
  // mpd-ulw -> mpd-roles (mechanical gate, 2026-10-06): the ULW activation gate and the
  // session-start gate evaluate THE SAME frozen predicate, and the directive's own clause forbids
  // inventing a second one. Importing the pure module is what makes that a fact instead of prose —
  // a fork would let the two gates drift apart silently, which is the exact defect class this wave
  // repairs. The import pulls no adapter value (the pure module touches only node:fs/node:path), so
  // the coupling adds a source edge, not a boot-order dependency.
  "packages/mpd-ulw-plugin/src/index.ts :: } from \"../../mpd-roles-plugin/src/complexity-gate.ts\"",
  // mpd-boulder -> mpd-roles (the SAME defect class, 2026-10-06): `boulder.dir` was read TWO ways, and
  // the divergence produced a doubled `<ws>/.mpd/.mpd/boulder.json` in every real boot — the gate's
  // signal D could never fire and `mpd_boulder_*` wrote to a path nobody documented. The cure is ONE
  // reading of the knob, so the boulder row imports the gate's `resolveBoulderDir` instead of keeping a
  // second copy that could drift back apart. Same shape as the ULW entry above, same file, same reason.
  "packages/mpd-boulder-plugin/src/index.ts :: import { resolveBoulderDir } from \"../../mpd-roles-plugin/src/complexity-gate.ts\"",
  // mpd-roles -> mpd-verify (the CAPTAIN INVESTIGATION guard, lane L, 2026-10-08): the top-level
  // session no longer does reconnaissance, and the new rule reuses `readTargetPath` from the SAME law
  // module the captain's write rule already reads rather than forking the argument-key list
  // (`file_path`/`path`/`filePath`/`target`), which would let the two rules disagree about which
  // spelling names a path. Same edge direction and same reasoning as the LANE D entries above; frozen
  // here by lane L, whose own scope does not hold this file, on the captain's instruction.
  "packages/mpd-roles-plugin/src/captain-investigation.ts :: import { readTargetPath } from \"../../mpd-verify-plugin/src/law.ts\"",
]

/** Blank out comments while preserving BOTH the character count and every newline, so a
 * finding keeps the original line number. String and template literals are copied verbatim
 * (their content is code-shaped: a specifier inside one must still match).
 *
 * Declared bound: a regular expression whose body contains `//` can swallow the rest of its
 * line. That direction is a false NEGATIVE on one line, never a false positive.
 *
 * @param source the file's raw text.
 * @returns the same text with every comment span replaced by spaces.
 */
export function stripComments(source: string): string {
  /** The rebuilt source: comment spans become spaces, and every kept byte is copied verbatim. */
  let out = ""
  /** Whether the scanner is inside a block comment right now. */
  let inBlock = false
  /** The quote character of the string/template literal currently open, or `""` for none. */
  let quote = ""
  for (let at = 0; at < source.length; at += 1) {
    /** The character under the cursor. */
    const ch = source[at]
    /** The character after it, `undefined` past the end (which the escape arm coalesces). */
    const next = source[at + 1]
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false
        out += "  "
        at += 1
        continue
      }
      out += ch === "\n" ? "\n" : " "
      continue
    }
    if (quote !== "") {
      out += ch
      if (ch === "\\") {
        out += next ?? ""
        at += 1
        continue
      }
      if (ch === quote) quote = ""
      continue
    }
    if (ch === "/" && next === "*") {
      inBlock = true
      out += "  "
      at += 1
      continue
    }
    if (ch === "/" && next === "/") {
      while (at < source.length && source[at] !== "\n") {
        out += " "
        at += 1
      }
      out += "\n"
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch
      out += ch
      continue
    }
    out += ch
  }
  return out
}

/**
 * Collapse a line to its identity form: runs of whitespace become one space and the ends are
 * trimmed, so re-indenting a coupling does not rewrite its inventory entry while changing the
 * coupling itself still does.
 *
 * @param text the ORIGINAL line's text.
 * @returns the normalized text used as the second half of an inventory key.
 */
export function normalizeLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/**
 * The inventory key of one finding: file plus normalized line text, never a line number (T-55).
 *
 * @param finding the finding to key.
 * @returns `"<file> :: <normalized line>"`.
 */
export function identityOf(finding: CouplingFinding): string {
  return `${finding.file} :: ${normalizeLine(finding.text)}`
}

/** Every file under `dir` (recursive, name-sorted); `[]` when the directory does not exist. */
function walkFiles(dir: string): string[] {
  /** The directory entries; the catch below returns before this is ever read. */
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  /** The files found, accumulated depth-first in sorted order so two runs report identically. */
  const files: string[] = []
  for (const entry of entries.slice().sort((left, right) => left.name.localeCompare(right.name))) {
    /** The entry's absolute path. */
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

/** One scanned package: its directory name and the `src/` root the walk covers. */
interface ScannedPackage {
  /** The `packages/<name>` directory name, which is also the sanctioned-adapter lookup key. */
  name: string
  /** The absolute `<repo>/packages/<name>/src` root. */
  src: string
}

/** Every `packages/mpd-*` package that has a `src/` directory, sorted by name. */
function scannedPackages(repoRoot: string): ScannedPackage[] {
  /** The `packages/` directory of the scanned root. */
  const packagesDir = join(repoRoot, "packages")
  /** The entries of `packages/`; the catch below returns before this is ever read. */
  let entries: Dirent[]
  try {
    entries = readdirSync(packagesDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("mpd-"))
    .map((entry) => ({ name: entry.name, src: join(packagesDir, entry.name, "src") }))
    .filter((pkg) => {
      try {
        return statSync(pkg.src).isDirectory()
      } catch {
        return false
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Whether `index` sits INSIDE a string or template literal on this line.
 *
 * A line scan that copies string literals verbatim (the rule that keeps `ctx.get("agentTeams")`
 * visible) also sees the text of a MESSAGE. MEASURED 2026-10-02: `mpd-ext-plugin` warns
 * `"ctx.provide(mpdExtensions) failed: …"`, which the provide rule read as a third call site. The
 * guard is per match position, never per line: `ctx.provide("tools")` keeps its call — only the
 * QUOTE-OPENING position is tested, so the argument's own string is not what is being skipped.
 *
 * Declared bound: with comments blanked out, a template literal spanning several lines leaves the
 * scan's quote state stale. That direction over-reports inside strings, never outside them.
 *
 * @param line the comment-stripped line.
 * @param index the 0-based position of the match's first character.
 * @returns `true` when the position is inside a quoted run.
 */
function insideString(line: string, index: number): boolean {
  /** The quote character of the literal currently open, or `""` for none. */
  let quote = ""
  for (let at = 0; at < index && at < line.length; at += 1) {
    /** The character under the cursor. */
    const ch = line[at]
    if (quote !== "") {
      if (ch === "\\") at += 1
      else if (ch === quote) quote = ""
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch
  }
  return quote !== ""
}

/**
 * Every module specifier a line names, static or dynamic, with the position it was read at.
 *
 * @param strippedLine the comment-stripped line (string literals survive stripping verbatim).
 * @returns `{{specifier, index}}` pairs in source order, without quotes, string-body matches excluded.
 */
function specifiersOf(strippedLine: string): { specifier: string; index: number }[] {
  /** The specifiers found on this line. */
  const found: { specifier: string; index: number }[] = []
  for (const pattern of [FROM_SPECIFIER, BARE_IMPORT_SPECIFIER]) {
    pattern.lastIndex = 0
    /** One `regexp.exec` step. */
    let match: RegExpExecArray | null
    while ((match = pattern.exec(strippedLine)) !== null) {
      if (match[1] !== undefined && !insideString(strippedLine, match.index)) found.push({ specifier: match[1], index: match.index })
    }
  }
  return found
}

/**
 * The package a resolved path belongs to, or `""` when the path leaves `packages/`.
 *
 * @param resolvedPath the absolute path a specifier resolved to.
 * @returns the `packages/<name>` segment, or `""`.
 */
function packageOf(resolvedPath: string): string {
  /** The `/`-separated pointer to the `packages/` segment. */
  const marker = `${sep}packages${sep}`
  /** Where the marker sits in the path, `-1` when absent. */
  const at = resolvedPath.lastIndexOf(marker)
  if (at < 0) return ""
  /** The remaining path after the marker: `<name>/…` or nothing. */
  const rest = resolvedPath.slice(at + marker.length)
  /** The first segment after the marker, which is the package directory name. */
  const name = rest.split(sep)[0] ?? ""
  return name
}

/**
 * The first argument of a `.provide(` call opening at `openIndex`, read to the first top-level
 * comma or closing paren. A line scan cannot parse the expression, and this is the declared bound:
 * a multi-line call argument is read as the remainder of the line only.
 *
 * @param line the comment-stripped line carrying the call.
 * @param openIndex the index of the call's `(`.
 * @returns the trimmed first-argument text, or `""` when the call opens at the line's end.
 */
function provideFirstArgument(line: string, openIndex: number): string {
  /** Everything after the opening paren. */
  const rest = line.slice(openIndex + 1)
  /** Where the argument ends, or `-1` when it runs to the end of the line. */
  let end = -1
  /** Whether the scan is inside a quoted string right now. */
  let quote = ""
  for (let at = 0; at < rest.length; at += 1) {
    /** The character under the cursor. */
    const ch = rest[at]
    if (quote !== "") {
      if (ch === "\\") at += 1
      else if (ch === quote) quote = ""
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch
      continue
    }
    if (ch === "," || ch === ")") {
      end = at
      break
    }
  }
  return (end < 0 ? rest : rest.slice(0, end)).trim()
}

/** A quoted string literal's content, or `null` when the text is not one. */
function literalString(text: string): string | null {
  if (text.length < 2) return null
  /** The quote character the argument opens with. */
  const quote = text[0]
  if (quote !== '"' && quote !== "'" && quote !== "`") return null
  return text.endsWith(quote) ? text.slice(1, -1) : null
}

/**
 * Scan one repository root for the three coupling classes.
 *
 * @param repoRoot the repository root to scan.
 * @param inventory the frozen identities to compare against; defaults to {@link FROZEN_COUPLINGS}.
 * @returns the scan's couplings, its frozen/undefined split, and the declared blind spots.
 */
export function scanCouplings(repoRoot: string, inventory: readonly string[] = FROZEN_COUPLINGS): CouplingScan {
  /** Every coupling found in the band. */
  const findings: CouplingFinding[] = []
  /** Hits in a non-`.ts` file: printed as NOT COVERED, never a failure. */
  const outOfBand: CouplingFinding[] = []
  /** `.provide(...)` calls whose first argument is not a literal. */
  const unverifiableProvides: CouplingFinding[] = []
  /** The MPD-owned service names a row provides, deduplicated. */
  const ownServiceNames = new Set<string>()
  /** How many `.ts` files the walk actually read (the coverage count the report prints). */
  let files = 0
  /** The scanned packages, resolved once so the walk and the band description cannot disagree. */
  const packages = scannedPackages(repoRoot)

  for (const pkg of packages) {
    /** `<repo>/packages/<pkg>` — the prefix an intra-package specifier stays inside. */
    const ownPrefix = join(repoRoot, "packages", pkg.name) + sep
    for (const file of walkFiles(pkg.src)) {
      /** The file's extension, taken from its last dot. */
      const extension = file.slice(file.lastIndexOf("."))
      /** The path as the report prints it: relative to the scanned root, `/`-separated. */
      const relPath = relative(repoRoot, file).split(sep).join("/")
      /** The file's text; an unreadable file is skipped rather than failing the whole scan. */
      let source: string
      try {
        source = readFileSync(file, "utf8")
      } catch {
        continue
      }
      if (extension !== BAND_EXTENSION) {
        if (OUT_OF_BAND_EXTENSIONS.includes(extension)) {
          // ONE entry per FILE, not per line: the unit of this blind spot is the file the walk
          // refused to parse, and a 500-line `.js` file must not become 500 report lines.
          outOfBand.push({
            file: relPath,
            line: 1,
            kind: "cross-package-import",
            target: extension,
            text: `${source.split("\n").length} line(s), not scanned`,
          })
        }
        continue
      }
      files += 1
      /** The original lines, quoted verbatim by each finding. */
      const original = source.split("\n")
      /** The same lines with comments blanked out, line structure preserved. */
      const stripped = stripComments(source).split("\n")
      for (let index = 0; index < stripped.length; index += 1) {
        /** The comment-stripped line every rule reads. */
        const line = stripped[index]
        /** The original line's text, the half of the inventory key that never changes with indentation. */
        const text = original[index] ?? ""

        // RULE 1 — a relative specifier that resolves outside the importing package.
        for (const { specifier } of specifiersOf(line)) {
          if (!specifier.startsWith(".")) continue
          /** The absolute path the specifier names (extensionless specifiers included). */
          const resolved = resolve(dirname(file), specifier)
          if (resolved === resolve(repoRoot, "packages", pkg.name) || resolved.startsWith(ownPrefix)) continue
          findings.push({ file: relPath, line: index + 1, kind: "cross-package-import", target: packageOf(resolved), text })
        }

        // RULE 2 — a runtime handoff through a process global.
        if (GLOBAL_MEMBER_WRITE.test(line) || GLOBAL_OBJECT_WRITE.test(line) || GLOBAL_LEGACY_WRITE.test(line)) {
          findings.push({ file: relPath, line: index + 1, kind: "global-write", target: "globalThis", text })
        }

        // RULE 3 — providing a HARNESS service id from a row.
        PROVIDE_CALL.lastIndex = 0
        /** One `.provide(` match on this line. */
        let provide: RegExpExecArray | null
        while ((provide = PROVIDE_CALL.exec(line)) !== null) {
          // A `.provide(` spelled INSIDE a message string is not a call site (measured: the
          // mpd-ext warn line). The position tested is the call's own, never the argument's.
          if (insideString(line, provide.index)) continue
          /** The call's opening paren, which is the match's last character. */
          const openIndex = provide.index + provide[0].length - 1
          /** The first argument's source text. */
          const argument = provideFirstArgument(line, openIndex)
          /** The argument as a runtime string, or `null` when it is not a literal. */
          const literal = literalString(argument)
          if (literal === null) {
            unverifiableProvides.push({ file: relPath, line: index + 1, kind: "harness-service-provide", target: argument, text })
            continue
          }
          if (DSH_SEAM_NAMES.includes(literal)) {
            findings.push({ file: relPath, line: index + 1, kind: "harness-service-provide", target: literal, text })
          } else {
            ownServiceNames.add(literal)
          }
        }
      }
    }
  }

  /** The couplings whose target is a sanctioned adapter package: exempt from the inventory. */
  const sanctioned = findings.filter((finding) => SANCTIONED_ADAPTER_PACKAGES.includes(finding.target))
  /** The couplings the inventory must describe exactly. */
  const frozen = findings.filter((finding) => !sanctioned.includes(finding))
  /** The frozen identities, deduplicated so a repeated line is one entry (and one report line). */
  const frozenIdentities = [...new Set(frozen.map(identityOf))]
  /** Frozen couplings with no inventory entry — the gate's FAIL condition. */
  const unfrozen = frozen.filter((finding) => !inventory.includes(identityOf(finding)))
  /** Inventory entries that matched nothing: they must be deleted, deliberately. */
  const stale = inventory.filter((entry) => !frozenIdentities.includes(entry))
  return {
    findings,
    sanctioned,
    frozen,
    unfrozen,
    stale,
    outOfBand,
    unverifiableProvides,
    ownServiceNames: [...ownServiceNames].sort(),
    inventorySize: inventory.length,
    packages: packages.length,
    files,
  }
}

/** `true` when `child` sits under `parent` (both absolute). */
function isUnder(parent: string, child: string): boolean {
  /** The path from `parent` to `child`, which is `""` when the two are the same path. */
  const rel = relative(parent, child)
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep) && resolve(parent, rel) === resolve(child)
}

/** The fixture tree's inventory: one entry that MATCHES a seeded coupling and one that is knowingly STALE. */
const FIXTURE_INVENTORY: readonly string[] = [
  `packages/mpd-fixture/src/known.ts :: import { x } from "../../mpd-other-plugin/src/x"`,
  `packages/mpd-fixture/src/gone.ts :: import { y } from "../../mpd-vanished-plugin/src/y"`,
]

/**
 * The negative control: seed a fixture tree with the SAME shapes the real band can carry and assert
 * the scanner reddens where it must and stays silent where it must not. The inventory passed in is
 * the fixture's own, so the control never depends on this repository's state.
 *
 * @returns `{{ ok, checks, tempRoot, scan }}`; `checks` is a list of `{name, ok, detail}` so a
 *   caller can print exactly which arm failed.
 */
export function selfTest(): SelfTestResult {
  /** The seeded fixture root; assigned by the two branches below before any fixture is written. */
  let tempRoot: string | undefined
  try {
    try {
      tempRoot = mkdtempSync(join(tmpdir(), "cross-package-coupling-"))
    } catch {
      // The file sandbox can deny the platform temp area; a repository-local scratch dir keeps the
      // self-test runnable there (it is removed in the `finally` below).
      /** The repository-local scratch parent, used only when the platform temp area is denied. */
      const localRoot = join(here, ".tmp-cross-package-coupling")
      mkdirSync(localRoot, { recursive: true })
      tempRoot = mkdtempSync(join(localRoot, "run-"))
    }
    /** The fixture root, captured once so the closures below need no assertion. */
    const root = tempRoot
    /** Write one fixture file, creating whatever parent directories it needs. */
    const write = (relPath: string, text: string): void => {
      /** The absolute path of the fixture file. */
      const full = join(root, relPath)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, text, "utf8")
    }

    // 1. The INVENTORIED coupling: it must NOT be reported, and must NOT show up as stale.
    write("packages/mpd-fixture/src/known.ts", `import { x } from "../../mpd-other-plugin/src/x"\n`)
    // 2. A NEW coupling of the same shape: no inventory entry, so it must redden.
    write("packages/mpd-fixture/src/new-import.ts", `import { z } from "../../mpd-third-plugin/src/z"\n`)
    // 3. An import of a SANCTIONED adapter package: exempt, printed, never frozen.
    write("packages/mpd-fixture/src/adapter-import.ts", `import { isRecord } from "../../mpd-dsh-adapter-plugin/src/index"\n`)
    // 4. An INTRA-package import: not a coupling at all.
    write("packages/mpd-fixture/src/local.ts", `import { helper } from "./helper.ts"\n`)
    // 5. A runtime handoff through a global: the shape the contract forbids.
    write("packages/mpd-fixture/src/global-write.ts", [
      "export function seen() {",
      "  const registry = globalThis.__mpdFixtureSeen || (globalThis.__mpdFixtureSeen = {})",
      "  return registry",
      "}",
      "",
    ].join("\n"))
    // 6. A HARNESS service provided from a row: the override shape the contract forbids.
    write("packages/mpd-fixture/src/provide-harness.ts", `export const apply = (ctx) => ctx.provide("tools", {})\n`)
    // 7. An MPD-OWNED service provided from a row: allowed, and NAMED in the report.
    write("packages/mpd-fixture/src/provide-own.ts", `export const apply = (ctx) => ctx.provide("mpdFixture", {})\n`)
    // 8. A provide whose argument is a CONSTANT: a line scan cannot read it, so it is named and spared.
    write("packages/mpd-fixture/src/provide-constant.ts", `export const apply = (ctx) => ctx.provide(FIXTURE_SERVICE, {})\n`)
    // 9. Comments naming every forbidden shape: documentation is not a violation of the rule.
    write("packages/mpd-fixture/src/commented.ts", [
      "// Never import from ../../mpd-other-plugin/src/x and never ctx.provide(\"tools\", {}):",
      "// the adapter owns the harness seams and the inventory owns the couplings.",
      "export const clean = true",
      "",
    ].join("\n"))
    // 10. A non-`.ts` file under a scanned src/: REPORTED as NOT COVERED, never a failure.
    write("packages/mpd-fixture/src/legacy.js", `const x = require("../../mpd-other-plugin/src/x")\n`)
    // 11. The target package of fixture 1 and 2, so the specifiers resolve to a real directory tree.
    write("packages/mpd-other-plugin/src/x.ts", "export const x = 1\n")
    write("packages/mpd-third-plugin/src/z.ts", "export const z = 1\n")

    /** The fixture scan every arm below reasons about. */
    const scan = scanCouplings(root, FIXTURE_INVENTORY)
    /** Whether a frozen finding for exactly this file is present. */
    const isUnfrozen = (file: string): boolean => scan.unfrozen.some((finding) => finding.file === file)

    /** Every arm of the control. */
    const checks: SelfTestCheck[] = [
      {
        name: "an INVENTORIED coupling is not reported (no false positive)",
        ok: !isUnfrozen("packages/mpd-fixture/src/known.ts"),
        detail: "the entry the fixture's inventory describes must match its own coupling",
      },
      {
        name: "a NEW cross-package import reddens",
        ok: isUnfrozen("packages/mpd-fixture/src/new-import.ts"),
        detail: "an un-inventoried import of a sibling package must fail the gate",
      },
      {
        name: "a SANCTIONED adapter import is exempt, and is PRINTED as sanctioned",
        ok: !isUnfrozen("packages/mpd-fixture/src/adapter-import.ts")
          && scan.sanctioned.some((finding) => finding.file === "packages/mpd-fixture/src/adapter-import.ts"),
        detail: "an adapter IS the sanctioned contact surface — exempt, but never silent",
      },
      {
        name: "an INTRA-package import is not a coupling",
        ok: !scan.findings.some((finding) => finding.file === "packages/mpd-fixture/src/local.ts"),
        detail: "./helper.ts stays inside mpd-fixture",
      },
      {
        name: "a globalThis WRITE reddens in both spellings on one line",
        ok: scan.findings.some((finding) => finding.file === "packages/mpd-fixture/src/global-write.ts" && finding.kind === "global-write"),
        detail: "the runtime-handoff shape must fail the gate",
      },
      {
        name: "ctx.provide(\"tools\") reddens as a harness-service provide",
        ok: scan.findings.some((finding) => finding.file === "packages/mpd-fixture/src/provide-harness.ts" && finding.kind === "harness-service-provide"),
        detail: "providing a harness seam id from a row is an override",
      },
      {
        name: "ctx.provide(\"mpdFixture\") is allowed and NAMED",
        ok: !scan.findings.some((finding) => finding.file === "packages/mpd-fixture/src/provide-own.ts")
          && scan.ownServiceNames.includes("mpdFixture"),
        detail: "the bundle's own services are the rows' contract, not an override",
      },
      {
        name: "a NON-LITERAL provide is named as unreadable, never failed",
        ok: scan.unverifiableProvides.some((finding) => finding.file === "packages/mpd-fixture/src/provide-constant.ts")
          && !scan.findings.some((finding) => finding.file === "packages/mpd-fixture/src/provide-constant.ts"),
        detail: "a line scan cannot follow a constant — the blind spot is declared, not hidden",
      },
      {
        name: "a COMMENT naming every forbidden shape is not a finding",
        ok: !scan.findings.some((finding) => finding.file === "packages/mpd-fixture/src/commented.ts"),
        detail: "comment stripping preserves the line structure the findings report against",
      },
      {
        name: "a non-.ts file under a scanned src/ is REPORTED out of band, never failed",
        ok: scan.outOfBand.some((hit) => hit.file === "packages/mpd-fixture/src/legacy.js")
          && !scan.findings.some((finding) => finding.file.endsWith(".js")),
        detail: "the blind spot is named, not silent",
      },
      {
        name: "a STALE inventory entry reddens (the frozen set must track reality)",
        ok: scan.stale.includes(FIXTURE_INVENTORY[1] ?? ""),
        detail: "an entry that matches nothing must be deleted, not left as a claim nothing backs",
      },
      {
        name: "exactly the four seeded couplings are frozen, three of them un-inventoried",
        // known.ts (inventoried), new-import.ts, global-write.ts, provide-harness.ts — and NOT the
        // sanctioned adapter import, the intra-package import, the own-service provide, the
        // non-literal provide, the comment or the `.js` file.
        ok: scan.frozen.length === 4 && scan.unfrozen.length === 3,
        detail: `frozen=${scan.frozen.length} unfrozen=${scan.unfrozen.length}: ${scan.frozen.map((finding) => finding.file).join(", ")}`,
      },
      {
        name: "the fixture walker actually read the seeded band",
        // THREE scanned package roots (mpd-fixture, mpd-other-plugin, mpd-third-plugin) and ELEVEN
        // `.ts` files across them; `legacy.js` is out of band and is counted under NOT COVERED.
        ok: scan.packages === 3 && scan.files === 11 && scan.outOfBand.length === 1,
        detail: `packages=${scan.packages} files=${scan.files} outOfBand=${scan.outOfBand.length}`,
      },
      {
        name: "a coupling turns into a NONZERO exit code, a clean scan into zero",
        ok: report(scan, () => {}) === 1
          && report({ ...scan, unfrozen: [], stale: [] }, () => {}) === 0,
        detail: "the gate must redden, not merely print",
      },
    ]
    return { ok: checks.every((check) => check.ok), checks, tempRoot, scan }
  } finally {
    if (tempRoot !== undefined) {
      try {
        rmSync(tempRoot, { recursive: true, force: true })
      } catch {
        // A leftover scratch dir is noise, never a self-test failure.
      }
      /** The sandbox fallback parent, removed only when it is the empty scratch root. */
      const localRoot = join(here, ".tmp-cross-package-coupling")
      if (isUnder(here, localRoot)) {
        try {
          rmSync(localRoot, { recursive: true, force: true })
        } catch {
          // Ditto.
        }
      }
    }
  }
}

/** One stable, greppable report line per coupling finding. */
function findingLine(finding: CouplingFinding): string {
  return `  ${finding.file}:${finding.line}: [${finding.kind}] -> ${finding.target || "(outside packages/)"} — ${normalizeLine(finding.text)}`
}

/**
 * Print the full report and return the process exit code (0 = clean).
 *
 * @param result the scan to report.
 * @param stream the sink each line is written to; defaults to `console.log`.
 * @returns 0 when the frozen inventory matches the band exactly, 1 otherwise.
 */
export function report(result: CouplingScan, stream: ReportStream = console.log): number {
  stream("CROSS-PACKAGE COUPLING INVENTORY — independence gate (docs/independence.md, acceptance A1.3)")
  stream(`band: packages/mpd-*/src/**/*${BAND_EXTENSION}`)
  stream(`scanned: ${result.packages} package(s), ${result.files} ${BAND_EXTENSION} file(s)`)
  stream(`frozen inventory: ${result.inventorySize} entr(y|ies); couplings in the band: ${result.frozen.length}, sanctioned adapter imports: ${result.sanctioned.length}`)
  if (result.sanctioned.length > 0) {
    stream(`SANCTIONED (an adapter IS the contact surface — exempt from the inventory, allowed to grow) — ${result.sanctioned.length}:`)
    for (const finding of result.sanctioned) stream(`  ${finding.file} -> ${finding.target}`)
  }
  if (result.ownServiceNames.length > 0) {
    stream(`MPD-OWNED services a row provides (allowed by design): ${result.ownServiceNames.join(", ")}`)
  }
  if (result.unverifiableProvides.length > 0) {
    stream(`NOT STATICALLY READABLE (declared blind spot, never a failure) — ${result.unverifiableProvides.length} .provide() call(s):`)
    for (const finding of result.unverifiableProvides) stream(findingLine(finding))
  }
  if (result.outOfBand.length > 0) {
    stream(`NOT COVERED (non-${BAND_EXTENSION} files under a scanned src/, never a failure) — ${result.outOfBand.length}:`)
    for (const hit of result.outOfBand) stream(`  ${hit.file}:${hit.line}`)
  }
  if (result.unfrozen.length > 0) {
    stream(`NEW COUPLINGS (${result.unfrozen.length}) — each one is a compile-time dependency the frozen set does not describe:`)
    for (const finding of result.unfrozen) stream(findingLine(finding))
  }
  if (result.stale.length > 0) {
    stream(`STALE INVENTORY ENTRIES (${result.stale.length}) — the coupling is gone; delete the entry so the set still shrinks on purpose:`)
    for (const entry of result.stale) stream(`  ${entry}`)
  }
  if (result.unfrozen.length === 0 && result.stale.length === 0) {
    stream("RESULT: PASS (the frozen inventory describes the band exactly)")
    return 0
  }
  stream(`RESULT: FAIL (${result.unfrozen.length} new, ${result.stale.length} stale)`)
  return 1
}

/**
 * The `--self-test` banner: one line per arm, then the verdict.
 *
 * @param result the self-test's result.
 * @param stream the sink each line is written to; defaults to `console.log`.
 * @returns 0 when every arm held, 1 otherwise.
 */
function reportSelfTest(result: SelfTestResult, stream: ReportStream = console.log): number {
  stream("SELF-TEST — cross-package-coupling-inventory (negative control over a seeded fixture tree)")
  for (const check of result.checks) stream(`  ${check.ok ? "ok  " : "FAIL"} ${check.name}${check.ok ? "" : ` — ${check.detail}`}`)
  /** The arms that held, printed as the `passed/total` tally. */
  const passed = result.checks.filter((check) => check.ok).length
  stream(`SELF-TEST: ${result.ok ? "PASS" : "FAIL"} (${passed}/${result.checks.length} checks)`)
  return result.ok ? 0 : 1
}

/** Print the band's couplings in the exact literal form `FROZEN_COUPLINGS` takes, for a deliberate re-freeze. */
function printInventory(): void {
  /** The live scan of this repository, taken with an EMPTY inventory so nothing is hidden by it. */
  const scan = scanCouplings(REPO_ROOT, [])
  for (const identity of [...new Set(scan.frozen.map(identityOf))].sort()) {
    console.log(`  ${JSON.stringify(identity)},`)
  }
  console.log(`// ${new Set(scan.frozen.map(identityOf)).size} frozen coupling(s); ${scan.sanctioned.length} sanctioned adapter import(s)`)
}

/** The CLI: `--self-test` runs the negative control, `--print-inventory` re-freezes, else the real band is scanned. */
async function main(argv: string[], stream: ReportStream = console.log): Promise<number> {
  if (argv.includes("--self-test")) {
    /** The negative control's result, which must not depend on this repository's state. */
    const result = selfTest()
    return reportSelfTest(result, stream)
  }
  if (argv.includes("--print-inventory")) {
    printInventory()
    return 0
  }
  return report(scanCouplings(REPO_ROOT), stream)
}

// ── the bun:test arm ────────────────────────────────────────────────────────────────
// `node` cannot resolve `bun:test` at all, and MEASURED with bun 1.4.0 a plain `bun <this file>`
// resolves the module but REJECTS `test(...)` with "Cannot use test outside of the test runner"
// (registration throws, the process would die before the CLI ran). Both cases therefore fall
// through to the CLI below; only `bun test` registers, which is what makes this gate part of the
// adapter package's own suite as well.
try {
  /** The test runner's own registration API; importing it is the whole bun:test arm. */
  const { expect, test } = await import("bun:test")
  test("the cross-package coupling inventory is exactly the frozen set (independence gate)", () => {
    /** The scan of the REAL band this repository currently carries. */
    const result = scanCouplings(REPO_ROOT)
    report(result)
    expect({ unfrozen: result.unfrozen.map(identityOf), stale: result.stale }).toEqual({ unfrozen: [], stale: [] })
  })
  test("the gate reddens on a seeded violation (negative control)", () => {
    /** The negative control's result; every arm must have held. */
    const result = selfTest()
    reportSelfTest(result)
    expect(result.ok).toBe(true)
  })
} catch {
  // Not under the bun test runner (or not bun at all): the CLI is the whole surface.
}

if (import.meta.main) {
  /** The exit code the CLI computed; a non-zero code must reach the shell. */
  const code = await main(process.argv.slice(2))
  if (code !== 0) process.exitCode = code
}
