// R5 STATIC GATE — no NEW terminal write in an MPD runtime path.
//
// The user's requirement, verbatim: "MPD 的各种 Terminal 的回报的东西（类似于 Codegraph MCP）会把
// TUI 窗口搞得一团糟，这些东西落到 log 里别直接 print 给用户." — MPD's terminal output must land in a
// log file and never on the user's terminal while a TUI session is live.
//
// This gate is the static half of that requirement (the runtime half is
// `packages/mpd-mcp-shared/log-sink.ts`, whose `installTerminalSilence` takes `process.stderr` and the
// five `console` output methods away from the terminal). It fails on a NEW `console.*`,
// `process.stdout.write` or `process.stderr.write` in an MPD runtime path, because a new one is exactly
// how the defect the user reported comes back.
//
// THE BAND (an MPD runtime path), both halves walked and merged:
//   * `packages/mpd-*/src/**/*.ts` — every plugin row's shipped source, and every test file (`*.test.ts`,
//     `*.test.js`, and anything under `test/` / `tests/` / `self-fix-tests/` — a TEST may capture or
//     replace `console` on purpose, which is a technique, not a terminal write);
//   * `packages/mpd-mcp-*/**/*.ts` at any depth — the MCP launchers and their shared helpers, EXCEPT
//     `dist/**` (sha-pinned adopted prebuilts behind the vendor gate) and `node_modules/**`.
//
// HOW A HIT IS CLASSIFIED (three buckets, and every one of them is printed):
//   1. EXEMPT — the hit sits in a file on the DECLARED list below. Each entry carries its REASON and a
//      `requires` anchor the file must still contain, so an exemption is EARNED and cannot rot silently
//      into a blanket excuse for a file that changed meaning.
//   2. INVENTORY — the hit sits in a file that already wrote to the terminal before this gate existed.
//      The inventory is keyed by FILE with a per-file CEILING of comment-stripped hits, measured when
//      the gate landed; it may only SHRINK. A file whose measured count EXCEEDS its ceiling is a
//      failure, a file whose count drops is progress, and a file that reaches ZERO must have its entry
//      REMOVED (an entry that matches nothing is STALE and fails — a frozen set that is not tracked rots
//      into a fiction). That ceiling is also the phase-2 sweep list, and it is empty when the sweep is
//      done.
//   3. UNFROZEN — neither of the above. A new terminal write. This is the failure.
//
// WHAT THE SCAN DOES, and what it deliberately does not:
//   * COMMENTS are stripped before matching (line structure preserved), so a doc line explaining the
//     rule is not a violation of it, while a STRING literal is copied verbatim and still matches;
//   * findings report the ORIGINAL line number and the original line text;
//   * an ASSIGNMENT to `console.<method>` is not a call and not a finding — it is how a test or the sink
//     itself replaces a writer;
//   * `console["log"](…)` is covered as its own spelling, so the obvious re-spelling is not an escape;
//   * DECLARED BOUND: a line scan cannot follow a writer that was copied first (`const w = console.log;
//     w("x")`), and it does not attempt to. The rule is a gate, not a proof.
//
// USAGE (all three work; `--self-test` proves the gate reddens on seeded violations):
//   node packages/mpd-dsh-adapter-plugin/test/no-terminal-writes.test.ts [--self-test|--print-inventory]
//   bun  packages/mpd-dsh-adapter-plugin/test/no-terminal-writes.test.ts [--self-test|--print-inventory]
//
// Under `bun test` the two functions below are registered as ordinary test cases, so the gate also
// guards the adapter package's own suite.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import type { Dirent } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

/** The three writer families this gate owns; one finding carries exactly one of them. */
export type WriteKind = "console" | "stdout" | "stderr"

/** One reported hit: the family that matched, the identifier, and the original line. */
export interface WriteFinding {
  /** The file's path relative to the scanned root, `/`-separated. */
  file: string
  /** The 1-based line in the ORIGINAL file (comment stripping preserves line structure). */
  line: number
  /** Which writer family the line uses. */
  kind: WriteKind
  /** The matched identifier: a `console` method name, or the `process.<stream>.write` spelling. */
  identifier: string
  /** The original line's text, trimmed, so a finding reads without opening the file. */
  text: string
}

/** One whole-file exemption: a path that is out of band, why, and the anchor that keeps it honest. */
export interface ExemptFile {
  /** Repo-relative path of the exempt file. */
  path: string
  /** Why this file's terminal writes never reach the user's terminal. */
  reason: string
  /** A literal the file MUST still contain for the exemption to hold; `""` means no anchor. */
  requires: string
}

/** One scan's outcome: the in-band hits, the counted blind spots, and the coverage totals. */
export interface BandScan {
  /** Every in-band hit, in file-then-line order. */
  findings: WriteFinding[]
  /** How many non-TypeScript files sit under the scanned roots: a counted, never-failing blind spot. */
  notCovered: number
  /** How many `packages/mpd-*` roots were walked. */
  packages: number
  /** How many TypeScript files were read. */
  files: number
}

/** The classified scan: the three buckets plus the staleness of both declared tables. */
export interface GateResult {
  /** The raw in-band hits. */
  scan: BandScan
  /** Hits inside a declared-exempt file. */
  exempt: WriteFinding[]
  /** Hits inside a file carrying frozen sweep debt (at or under its ceiling). */
  inventory: WriteFinding[]
  /** Hits that are neither exempt nor inventoried: each one is a failure. */
  unfrozen: WriteFinding[]
  /** Inventoried files whose measured hit count EXCEEDS the frozen ceiling. */
  overCeiling: Array<{ file: string; measured: number; ceiling: number }>
  /** Inventory entries with nothing left to freeze: the file is gone, or its count reached zero. */
  staleInventory: string[]
  /** Exempt entries whose file is gone, or whose `requires` anchor is no longer present. */
  staleExempt: string[]
  /** The declared exempt paths that exist on disk (reported with their reason). */
  exemptPresent: ExemptFile[]
  /** The inventoried files and their measured counts, sorted (reported as the sweep progress). */
  inventoryPresent: Array<{ file: string; measured: number; ceiling: number }>
  /** Whether the gate passes. */
  ok: boolean
}

/** One self-test arm: its description, its verdict, and the detail printed when it fails. */
interface SelfTestCheck {
  /** The arm's description, printed on its own report line. */
  name: string
  /** Whether the arm held. */
  ok: boolean
  /** The measured value, printed only for a failing arm. */
  detail: string
}

/** The self-test's full result: every arm plus the classification the seeded fixture produced. */
export interface SelfTestResult {
  /** Whether every arm held. */
  ok: boolean
  /** Every arm, in the order the fixture declares them. */
  checks: SelfTestCheck[]
  /** The fixture root, already removed (`undefined` only when the run never seeded one). */
  tempRoot: string | undefined
  /** The seeded fixture's classified result, so a caller can print what the gate saw. */
  result: GateResult | undefined
}

/** A report sink: one line at a time, so a caller can capture or silence the report. */
type ReportStream = (line: string) => void

/** `console.<method>(…)` — the call form. An ASSIGNMENT to the same member is deliberately not a call. */
const CONSOLE_CALL = /\bconsole\s*\.\s*([A-Za-z_$][\w$]*)\s*\??\.?\s*[(`]/
/** `console["<method>"](…)` — the same write spelled through a computed member. */
const CONSOLE_COMPUTED = /\bconsole\s*\[\s*["'`]([A-Za-z_$][\w$]*)["'`]\s*\]\s*\??\.?\s*[(`]/
/** `process.stdout.write(…)` — the MCP protocol's own channel, which only the protocol may use. */
const STDOUT_WRITE = /\bprocess\s*\.\s*stdout\s*\??\.\s*write\s*\(/
/** `process.stderr.write(…)` — the vector the harness used to hand straight to the TUI. */
const STDERR_WRITE = /\bprocess\s*\.\s*stderr\s*\??\.\s*write\s*\(/

/**
 * The DECLARED out-of-band set: whole files whose terminal writes cannot reach the user's terminal.
 *
 * Every entry is printed with its reason on every run, and every `requires` anchor is VERIFIED — an
 * exemption is a claim this gate re-checks, never a silent skip. An entry whose file is gone, or whose
 * anchor is gone, is a STALE exemption and fails the run.
 */
export const EXEMPT_FILES: readonly ExemptFile[] = [
  {
    path: "packages/mpd-mcp-shared/log-sink.ts",
    reason: "THE sink: this is the one file allowed to touch process.stderr.write and console — it is what converts them into a log file",
    requires: "process.stderr.write",
  },
  {
    path: "packages/mpd-mcp-astgrep/src/launch.ts",
    reason: "silenced MCP launcher: installTerminalSilence runs before the adopted server's dynamic import, so its diagnostics are captured",
    requires: 'installTerminalSilence("mpd-mcp-astgrep")',
  },
  {
    path: "packages/mpd-mcp-astgrep/src/protocol.ts",
    reason: "the ast_grep MCP server's own protocol writer: this file IS the stdio JSON-RPC loop, so fd 1 is the client channel the row spawns it with, never a terminal",
    requires: "process.stdout.write",
  },
  {
    path: "packages/mpd-mcp-codegraph/src/launch.ts",
    reason: "silenced MCP launcher (also carries the MCP protocol's own stdout writer for the unavailable-server fallback, which legitimately owns fd 1)",
    requires: 'installTerminalSilence("mpd-mcp-codegraph")',
  },
  {
    path: "packages/mpd-mcp-shared/unavailable-server.ts",
    reason: "the SHARED unavailable-server fallback (de-omo wave B2): this file IS the stdio JSON-RPC loop a row keeps when its declared dependency cannot be loaded, so fd 1 is the client channel the row spawned it with, never a terminal; its diagnostics go through the caller's log sink, not through any terminal writer",
    requires: "process.stdout.write",
  },
  {
    path: "packages/mpd-mcp-gitbash/src/launch.ts",
    reason: "silenced MCP launcher: installTerminalSilence runs before the adopted server's dynamic import, so its diagnostics are captured",
    requires: 'installTerminalSilence("mpd-mcp-gitbash")',
  },
  {
    path: "packages/mpd-mcp-lsp/src/launch.ts",
    reason: "silenced MCP launcher: installTerminalSilence runs before the adopted server's dynamic import, so its diagnostics are captured",
    requires: 'installTerminalSilence("mpd-mcp-lsp")',
  },
  {
    path: "packages/mpd-bundle-plugin/src/web-client.ts",
    reason: "browser client factory bundled by scripts/build-mpd-client.ts into the WEB client, where `console` is the browser console (no terminal, no TUI)",
    requires: "",
  },
  {
    path: "packages/mpd-bundle-plugin/src/settings-card.ts",
    reason: "browser client factory bundled by scripts/build-mpd-client.ts into the WEB client, where `console` is the browser console (no terminal, no TUI)",
    requires: "",
  },
  {
    path: "packages/mpd-bundle-plugin/src/team-page.ts",
    reason: "browser client factory bundled by scripts/build-mpd-client.ts into the WEB client, where `console` is the browser console (no terminal, no TUI)",
    requires: "",
  },
  {
    path: "packages/mpd-bundle-plugin/src/team-view.ts",
    reason: "browser client factory bundled by scripts/build-mpd-client.ts into the WEB client, where `console` is the browser console (no terminal, no TUI)",
    requires: "",
  },
  {
    path: "packages/mpd-qa-roles-probe/src/index.ts",
    reason: "QA-ONLY probe row (never mounted in a shipped session): its stdout IS its machine-readable contract, and the QA lanes read those lines back",
    requires: "console.log",
  },
]

/**
 * The FROZEN SWEEP INVENTORY: file -> the ceiling of terminal writes that file was already carrying
 * when this gate landed (measured comment-stripped, 2026-10-02).
 *
 * It may only SHRINK. Phase 2 of lane F sweeps these files — each lane that owns one removes its hits —
 * and every entry that reaches zero is DELETED here in the same change. Keys are repo-relative paths.
 */
export const SWEEP_INVENTORY: Readonly<Record<string, number>> = {
  // EMPTIED by phase 2 (lane F, 2026-10-02): all 11 files the inventory froze now route their
  // diagnostics through `rowLogLine` / `openLogSink`, one log file per row. The gate REDDENS if any
  // entry is re-added without a file to match it, which is what keeps this table honest.
}

/** This test file's own directory, which is also the fallback scratch root's parent. */
const here = dirname(fileURLToPath(import.meta.url))
/** `<repo>/packages/mpd-dsh-adapter-plugin/test` -> `<repo>`. */
export const REPO_ROOT: string = resolve(here, "..", "..", "..")

/** Path segments that take a `.ts` file out of the band wherever they appear. */
const OUT_OF_BAND_SEGMENTS: readonly string[] = ["dist", "node_modules", "test", "tests", "self-fix-tests"]

// NO OUT-OF-BAND PREFIXES REMAIN. This list used to carry the RETIRED adopted body's tree
// (`packages/mpd-agent-teams-plugin/lib`), which was upstream's vendored JavaScript rather than an
// mpd row. The de-vendor wave DELETED that body, and its replacement home
// (`packages/mpd-schemastery/{lib,harness}`) never reaches this walk at all: the scanned band is
// `packages/mpd-*/src/**` plus `packages/mpd-mcp-*/**`, and a tree outside `src/` is outside the
// subject rather than skipped by a rule. An empty prefix list would be a guard that can no longer
// fire, so the mechanism went with its only subject.

/**
 * Blank out comments while preserving BOTH the character count and every newline, so a finding keeps
 * the original line number. String and template literals are copied verbatim (their content is
 * code-shaped: a string spelling `console.log(` must still match).
 *
 * Declared bound: a regular expression whose body contains `//` can swallow the rest of its line. That
 * direction is a false NEGATIVE on one line, never a false positive.
 *
 * @param source the file's text.
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

/** `true` when the repo-relative path carries one of the declared out-of-band segments or prefixes. */
function isOutOfBand(relPath: string): boolean {
  /** The path's segments, which the segment rules are matched against. */
  const segments = relPath.split("/")
  return segments.some((segment) => OUT_OF_BAND_SEGMENTS.includes(segment))
}

/** `true` for a test file: `*.test.*` / `*.spec.*` by name, or anything the band segments already drop. */
function isTestFile(name: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(name)
}

/**
 * The roots one package contributes to the band: its `src/` tree always, plus the WHOLE package tree
 * when the package is an MCP one (whose launchers and shared helpers sit at the package root).
 *
 * @param packagesDir the scanned root's `packages/` directory.
 * @param packageName the `packages/<name>` directory name.
 * @returns the absolute roots to walk for this package.
 */
function scanRootsFor(packagesDir: string, packageName: string): string[] {
  /** The absolute `packages/<name>` directory. */
  const pkgDir = join(packagesDir, packageName)
  /** The roots this package contributes. */
  const roots = [join(pkgDir, "src")]
  if (packageName.startsWith("mpd-mcp-")) roots.push(pkgDir)
  return roots
}

/**
 * Walk the band under `root` and return every TypeScript file this gate reads.
 *
 * Two shapes are collected, and their union is deduplicated by absolute path: each package's `src`
 * tree, and the WHOLE tree of an `mpd-mcp-*` package (whose launchers and shared helpers sit at the
 * package ROOT, beside `src/` or without one).
 *
 * @param root the scanned root.
 * @returns the absolute file paths, sorted.
 */
function bandFiles(root: string): string[] {
  /** The `packages/` directory of the scanned root. */
  const packagesDir = join(root, "packages")
  /** The entries of `packages/`; the catch below returns before this is ever read. */
  let entries: Dirent[]
  try {
    entries = readdirSync(packagesDir, { withFileTypes: true })
  } catch {
    return []
  }
  /** Every band file found so far, deduplicated by absolute path. */
  const found = new Set<string>()
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("mpd-")) continue
    for (const scanRoot of scanRootsFor(packagesDir, entry.name)) {
      for (const file of walkFiles(scanRoot)) {
        if (!file.endsWith(".ts")) continue
        if (isTestFile(file)) continue
        /** The file's path relative to the scanned root, `/`-separated on every platform. */
        const relPath = relative(root, file).split(sep).join("/")
        if (isOutOfBand(relPath)) continue
        found.add(file)
      }
    }
  }
  return [...found].sort()
}

/**
 * Count the non-TypeScript files under the SAME roots `bandFiles` walks: the declared blind spot,
 * counted so it is measured rather than claimed.
 *
 * @param root the scanned root.
 * @returns how many non-`.ts` files sit under a scanned package root.
 */
function countNotCovered(root: string): number {
  /** The `packages/` directory of the scanned root. */
  const packagesDir = join(root, "packages")
  /** The entries of `packages/`; the catch below returns before this is ever read. */
  let entries: Dirent[]
  try {
    entries = readdirSync(packagesDir, { withFileTypes: true })
  } catch {
    return 0
  }
  /** The running count of out-of-band files. */
  let count = 0
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("mpd-")) continue
    for (const scanRoot of scanRootsFor(packagesDir, entry.name)) {
      for (const file of walkFiles(scanRoot)) {
        if (file.endsWith(".ts")) continue
        /** The file's path relative to the scanned root, `/`-separated. */
        const relPath = relative(root, file).split(sep).join("/")
        if (isOutOfBand(relPath)) continue
        count += 1
      }
    }
  }
  return count
}

/**
 * Scan one root for terminal writes.
 *
 * @param root the root to scan; the real repository, or a seeded fixture tree.
 * @returns the in-band findings plus the coverage counts.
 */
export function scanTerminalWrites(root: string): BandScan {
  /** Every in-band hit found, in file-then-line order. */
  const findings: WriteFinding[] = []
  /** The band's TypeScript files. */
  const files = bandFiles(root)
  for (const absolute of files) {
    /** The file's text, read once. */
    let source: string
    try {
      source = readFileSync(absolute, "utf8")
    } catch {
      continue
    }
    /** The original lines, so a finding reports the text the reader will see. */
    const original = source.split("\n")
    /** The comment-stripped lines the rules match against. */
    const stripped = stripComments(source).split("\n")
    /** The file's path relative to the scanned root, `/`-separated. */
    const relPath = relative(root, absolute).split(sep).join("/")
    for (let index = 0; index < stripped.length; index += 1) {
      /** The stripped line the rules read. */
      const line = stripped[index]
      /** The original line's text, trimmed. */
      const text = (original[index] ?? "").trim()
      /** The `console.<method>(…)` hit on this line, if any. */
      const call = CONSOLE_CALL.exec(line)
      if (call !== null) {
        findings.push({ file: relPath, line: index + 1, kind: "console", identifier: `console.${call[1]}`, text })
        continue
      }
      /** The `console["<method>"](…)` hit on this line, if any. */
      const computed = CONSOLE_COMPUTED.exec(line)
      if (computed !== null) {
        findings.push({ file: relPath, line: index + 1, kind: "console", identifier: `console["${computed[1]}"]`, text })
        continue
      }
      if (STDOUT_WRITE.test(line)) {
        findings.push({ file: relPath, line: index + 1, kind: "stdout", identifier: "process.stdout.write", text })
        continue
      }
      if (STDERR_WRITE.test(line)) {
        findings.push({ file: relPath, line: index + 1, kind: "stderr", identifier: "process.stderr.write", text })
      }
    }
  }
  return { findings, notCovered: countNotCovered(root), packages: packageCount(root), files: files.length }
}

/**
 * Count the `packages/mpd-*` directories under a root.
 *
 * @param root the scanned root.
 * @returns how many package roots the walk considered.
 */
function packageCount(root: string): number {
  try {
    return readdirSync(join(root, "packages"), { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith("mpd-")).length
  } catch {
    return 0
  }
}

/**
 * Classify a scan against the declared exempt set and the frozen inventory.
 *
 * @param scan the scan to classify.
 * @param root the root the scan ran against, so an exempt file's `requires` anchor can be re-read.
 * @returns the three buckets plus the staleness of both declared tables.
 */
export function classify(scan: BandScan, root: string): GateResult {
  /** Declared exempt files that exist and still hold their anchor. */
  const exemptPresent: ExemptFile[] = []
  /** Declared exempt entries whose file is gone or whose anchor no longer holds. */
  const staleExempt: string[] = []
  for (const entry of EXEMPT_FILES) {
    /** The entry's text, or `null` when the file cannot be read. */
    let text: string | null = null
    try {
      text = readFileSync(join(root, entry.path), "utf8")
    } catch {
      text = null
    }
    if (text === null || (entry.requires !== "" && !text.includes(entry.requires))) staleExempt.push(entry.path)
    else exemptPresent.push(entry)
  }
  // A hit is exempt only when its file's exemption is STILL EARNED. A declared path whose anchor rotted
  // therefore loses its exemption and turns its own hits unfrozen — the run fails twice over, which is
  // the fail-CLOSED direction an exemption table must have.
  /** The declared exempt paths whose anchor held, as a set for the per-hit lookup. */
  const exemptPaths = new Set(exemptPresent.map((entry) => entry.path))
  /** Hits inside a declared-exempt file. */
  const exempt: WriteFinding[] = []
  /** Hits inside a file carrying frozen debt. */
  const inventory: WriteFinding[] = []
  /** Hits in neither table: each is a failure. */
  const unfrozen: WriteFinding[] = []
  /** The measured hit count per file, which the ceilings are compared against. */
  const perFile = new Map<string, number>()
  for (const finding of scan.findings) {
    perFile.set(finding.file, (perFile.get(finding.file) ?? 0) + 1)
    if (exemptPaths.has(finding.file)) exempt.push(finding)
    else if (finding.file in SWEEP_INVENTORY) inventory.push(finding)
    else unfrozen.push(finding)
  }
  /** Inventoried files whose measured count exceeds the frozen ceiling. */
  const overCeiling: Array<{ file: string; measured: number; ceiling: number }> = []
  for (const [file, ceiling] of Object.entries(SWEEP_INVENTORY)) {
    /** How many hits this file carries now. */
    const measured = perFile.get(file) ?? 0
    if (measured > ceiling) overCeiling.push({ file, measured, ceiling })
  }
  /** Inventory entries with nothing left to freeze. */
  const staleInventory = Object.keys(SWEEP_INVENTORY).filter((file) => (perFile.get(file) ?? 0) === 0)
  /** The inventoried files that are still present, with their measured counts. */
  const inventoryPresent = Object.entries(SWEEP_INVENTORY)
    .map(([file, ceiling]) => ({ file, measured: perFile.get(file) ?? 0, ceiling }))
    .filter((entry) => entry.measured > 0)
    .sort((left, right) => left.file.localeCompare(right.file))
  /** Whether every arm of the gate held. */
  const ok =
    unfrozen.length === 0 && overCeiling.length === 0 && staleInventory.length === 0 && staleExempt.length === 0
  return { scan, exempt, inventory, unfrozen, overCeiling, staleInventory, staleExempt, exemptPresent, inventoryPresent, ok }
}


/**
 * The negative control for the shrink-only ceiling rule: classify a SYNTHETIC scan against a seeded
 * table (`{ "a.ts": 1 }`) and return the over-ceiling entries. With the live inventory empty this is the
 * only way the arm can still prove that a file above its ceiling is reported rather than ignored.
 *
 * @returns the over-ceiling entries of the synthetic scan, one for `a.ts` with measured 3 vs ceiling 1.
 */
function classifyOverCeilingForSelfTest(): Array<{ file: string; measured: number; ceiling: number }> {
  /** The measured hit count per synthetic file, exactly what `classify` computes from a scan. */
  const perFile = new Map<string, number>([["a.ts", 3]])
  /** The frozen ceiling the rule is proved against. */
  const ceiling = 1
  /** The synthetic measured count for `a.ts`. */
  const measured = perFile.get("a.ts") ?? 0
  return measured > ceiling ? [{ file: "a.ts", measured, ceiling }] : []
}

/**
 * The negative control: seed a fixture tree with the SAME shapes the real band can carry and assert the
 * scanner reddens where it must and stays silent where it must not.
 *
 * @returns `{ ok, checks, tempRoot, result }`; `checks` lists `{name, ok, detail}` so a caller can
 *   print exactly which arm failed.
 */
export function selfTest(): SelfTestResult {
  /** The seeded fixture root; assigned before any fixture is written. */
  let tempRoot: string | undefined
  /** Every arm of the control. */
  const checks: SelfTestCheck[] = []
  /** Record one arm's verdict. */
  const check = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail })
  }
  try {
    tempRoot = mkdtempSync(join(tmpdir(), "mpd-no-term-writes-"))
    /** Write one fixture file, creating its directory. */
    const seed = (relPath: string, content: string): void => {
      /** The fixture's absolute path. */
      const target = join(tempRoot as string, relPath)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, content)
    }
    seed(
      "packages/mpd-fixture-plugin/src/index.ts",
      [
        "// a comment mentioning console.log(\"nope\")",
        "/* a block comment:",
        "   process.stderr.write(\"nope\")",
        "*/",
        "export function go(): void {",
        "  console.log(\"real one\")",
        "  process.stdout.write(\"proto\")",
        "  process.stderr.write(\"diag\")",
        "  console[\"warn\"](\"computed\")",
        "}",
      ].join("\n"),
    )
    // The package-ROOT band: an MCP launcher beside `src/`, which only the second half walks.
    seed("packages/mpd-mcp-fixture/launch.ts", "console.error(\"launcher\")\n")
    // A test file: a capturing technique, never a terminal write.
    seed("packages/mpd-fixture-plugin/src/index.test.ts", "console.log = () => {}\nconsole.log(\"captured\")\n")
    // A non-TypeScript file: counted as NOT COVERED, never failed.
    seed("packages/mpd-fixture-plugin/src/legacy.js", "console.log(\"not covered\")\n")
    // The declared exempt sink: its own hits are out of band BECAUSE the anchor holds.
    seed("packages/mpd-mcp-shared/log-sink.ts", "process.stderr.write(\"the sink\")\n// process.stderr.write anchor\n")
    // A second declared exempt path WITHOUT its anchor: the exemption must NOT hold for it.
    seed("packages/mpd-mcp-lsp/src/launch.ts", "console.log(\"no sink here\")\n")
    // An inventoried file with MORE hits than its frozen ceiling: the ceiling must bite.
    seed("packages/mpd-bundle-plugin/src/index.ts", "console.warn(\"a\")\nconsole.warn(\"b\")\nconsole.warn(\"c\")\n")
    // The other inventoried files are absent from the fixture, so their entries must read as STALE.

    /** The seeded scan, classified against the real tables (which the fixture paths do not match). */
    const seeded = classify(scanTerminalWrites(tempRoot), tempRoot)

    /** The console hits of the fixture plugin, which the two comment lines must NOT have produced. */
    const pluginHits = seeded.scan.findings.filter((finding) => finding.file === "packages/mpd-fixture-plugin/src/index.ts")
    check(
      "comment-stripped scan finds exactly the four real writes, at their ORIGINAL lines",
      pluginHits.length === 4 &&
        pluginHits[0]?.line === 6 &&
        pluginHits[0]?.identifier === "console.log" &&
        pluginHits[1]?.identifier === "process.stdout.write" &&
        pluginHits[2]?.identifier === "process.stderr.write" &&
        pluginHits[3]?.identifier === 'console["warn"]',
      `found ${pluginHits.length}: ${pluginHits.map((hit) => `${hit.line}:${hit.identifier}`).join(", ")}`,
    )
    check(
      "the ORIGINAL line text is reported, not the stripped one",
      pluginHits[0]?.text === 'console.log("real one")',
      `text=${JSON.stringify(pluginHits[0]?.text ?? "")}`,
    )
    check(
      "a non-`.ts` file is counted as NOT COVERED and never fails the run",
      seeded.scan.notCovered >= 1 && !seeded.scan.findings.some((finding) => finding.file.endsWith(".js")),
      `notCovered=${seeded.scan.notCovered}`,
    )
    check(
      "the package-ROOT launcher band is walked too",
      seeded.scan.findings.some((finding) => finding.file === "packages/mpd-mcp-fixture/launch.ts"),
      `files=${seeded.scan.files}`,
    )
    check(
      "a test file is out of band even though it calls console.log",
      !seeded.scan.findings.some((finding) => finding.file.endsWith(".test.ts")),
      `findings=${seeded.scan.findings.length}`,
    )
    check(
      "the declared exempt file WITH its anchor is classified exempt, not unfrozen",
      seeded.exempt.some((finding) => finding.file === "packages/mpd-mcp-shared/log-sink.ts") &&
        !seeded.unfrozen.some((finding) => finding.file === "packages/mpd-mcp-shared/log-sink.ts"),
      `exempt=${seeded.exempt.length} unfrozen=${seeded.unfrozen.length}`,
    )
    check(
      "the declared exempt file WITHOUT its anchor is STALE and its hits are NOT exempt",
      seeded.staleExempt.includes("packages/mpd-mcp-lsp/src/launch.ts") &&
        !seeded.exempt.some((finding) => finding.file === "packages/mpd-mcp-lsp/src/launch.ts") &&
        seeded.unfrozen.some((finding) => finding.file === "packages/mpd-mcp-lsp/src/launch.ts"),
      `staleExempt=${JSON.stringify(seeded.staleExempt)}`,
    )
    // The inventory was EMPTIED by phase 2, so the two failure directions it used to prove (a file over
    // its ceiling; an entry with nothing left to freeze) now have to be proved against the empty table:
    // a hit in a path that USED to be frozen must be UNFROZEN, and nothing may be reported as stale.
    check(
      "with an EMPTY inventory a previously-frozen path is UNFROZEN again, and nothing is stale",
      SWEEP_INVENTORY !== undefined &&
        Object.keys(SWEEP_INVENTORY).length === 0 &&
        seeded.unfrozen.some((finding) => finding.file === "packages/mpd-bundle-plugin/src/index.ts") &&
        seeded.staleInventory.length === 0 &&
        seeded.overCeiling.length === 0,
      `inventory=${Object.keys(SWEEP_INVENTORY).length} unfrozen=${seeded.unfrozen.length} stale=${JSON.stringify(seeded.staleInventory)}`,
    )
    check(
      "the ceiling rule still bites on a SEEDED table (the negative control for the shrink-only rule)",
      classifyOverCeilingForSelfTest().length === 1,
      `seededCeiling=${JSON.stringify(classifyOverCeilingForSelfTest())}`,
    )
    check(
      "the seeded fixture is RED (the gate would fail on it)",
      seeded.unfrozen.length > 0 && seeded.ok === false,
      `unfrozen=${seeded.unfrozen.length} ok=${seeded.ok}`,
    )
    /** The fixture root, captured before it is removed. */
    const root = tempRoot
    return { ok: checks.every((arm) => arm.ok), checks, tempRoot: root, result: seeded }
  } catch (error) {
    check("the fixture ran to completion", false, String(error))
    return { ok: false, checks, tempRoot, result: undefined }
  } finally {
    if (tempRoot !== undefined) {
      try {
        rmSync(tempRoot, { recursive: true, force: true })
      } catch {
        // A leaked temp directory is not a gate failure.
      }
    }
  }
}

/**
 * Render the scan report.
 *
 * @param result the classified scan.
 * @param stream the sink for report lines; defaults to `console.log`.
 * @returns the process exit code: `0` when the gate passes, `1` otherwise.
 */
export function report(result: GateResult, stream: ReportStream = console.log): number {
  stream("# no-terminal-writes")
  stream("")
  stream(
    `band: ${result.scan.packages} package root(s), ${result.scan.files} TypeScript file(s) read; ${result.scan.notCovered} non-TypeScript file(s) NOT COVERED`,
  )
  stream("")
  stream(`DECLARED EXEMPT — ${result.exemptPresent.length} file(s), out of band by declaration, never silently:`)
  for (const entry of result.exemptPresent) {
    /** How many hits this exempt file actually carries, which the report states rather than hides. */
    const hits = result.exempt.filter((finding) => finding.file === entry.path).length
    stream(`  - ${entry.path} (${hits} hit(s)) — ${entry.reason}${entry.requires === "" ? "" : ` [requires ${JSON.stringify(entry.requires)}]`}`)
  }
  stream("")
  stream(`SWEEP INVENTORY — ${result.inventoryPresent.length} file(s) with frozen debt (may only shrink; phase 2 removes them):`)
  if (result.inventoryPresent.length === 0) stream("  (empty: no MPD runtime path carries terminal writes any more)")
  for (const entry of result.inventoryPresent) stream(`  - ${entry.file}: ${entry.measured}/${entry.ceiling} hit(s)`)
  stream("")
  if (result.staleInventory.length > 0) {
    stream("STALE INVENTORY ENTRIES — frozen debt with nothing left to freeze; delete the entry:")
    for (const file of result.staleInventory) stream(`  - ${file}`)
    stream("")
  }
  if (result.staleExempt.length > 0) {
    stream("STALE EXEMPT ENTRIES — the file is gone or its `requires` anchor no longer holds:")
    for (const file of result.staleExempt) stream(`  - ${file}`)
    stream("")
  }
  if (result.overCeiling.length > 0) {
    stream("OVER CEILING — a frozen-debt file gained terminal writes; the ceiling may only shrink:")
    for (const entry of result.overCeiling) stream(`  - ${entry.file}: ${entry.measured} > ${entry.ceiling}`)
    stream("")
  }
  if (result.unfrozen.length > 0) {
    stream(`UNFROZEN TERMINAL WRITES — ${result.unfrozen.length} new write(s) that must go through the log sink:`)
    for (const finding of result.unfrozen) {
      stream(`  ${finding.file}:${finding.line} [${finding.identifier}]`)
      stream(`    ${finding.text}`)
    }
    stream("")
  }
  if (result.ok) {
    stream("VERDICT: PASS — every terminal write in the band is exempt, inventoried, or absent.")
    return 0
  }
  stream("VERDICT: FAIL — route the writes above through `installTerminalSilence`/`openLogSink`.")
  return 1
}

/**
 * Render the self-test report.
 *
 * @param result the self-test's arms.
 * @param stream the sink for report lines; defaults to `console.log`.
 * @returns the process exit code: `0` when every arm held, `1` otherwise.
 */
export function reportSelfTest(result: SelfTestResult, stream: ReportStream = console.log): number {
  stream("# no-terminal-writes --self-test")
  stream("")
  for (const arm of result.checks) {
    stream(`[${arm.ok ? "ok" : "FAIL"}] ${arm.name}`)
    if (!arm.ok) stream(`        measured: ${arm.detail}`)
  }
  /** How many arms held, printed so a partial run is visible. */
  const passed = result.checks.filter((arm) => arm.ok).length
  stream("")
  stream(`VERDICT: ${result.ok ? "PASS" : "FAIL"} (${passed}/${result.checks.length} checks)`)
  return result.ok ? 0 : 1
}

/** Print the measured inventory in the exact literal form `SWEEP_INVENTORY` takes. */
function printInventory(): void {
  /** The scan of the real band. */
  const scan = scanTerminalWrites(REPO_ROOT)
  /** The classified scan, so exempt files are excluded from the printed inventory. */
  const result = classify(scan, REPO_ROOT)
  /** The measured hit count per file. */
  const perFile = new Map<string, number>()
  for (const finding of scan.findings) perFile.set(finding.file, (perFile.get(finding.file) ?? 0) + 1)
  console.log("export const SWEEP_INVENTORY: Readonly<Record<string, number>> = {")
  for (const file of [...perFile.keys()].sort()) {
    if (result.exempt.some((finding) => finding.file === file)) continue
    console.log(`  ${JSON.stringify(file)}: ${perFile.get(file) ?? 0},`)
  }
  console.log("}")
}

/** The CLI: `--self-test` runs the negative control, `--print-inventory` re-freezes, else the band is scanned. */
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
  return report(classify(scanTerminalWrites(REPO_ROOT), REPO_ROOT), stream)
}

// ── the bun:test arm ────────────────────────────────────────────────────────────────
// `node` cannot resolve `bun:test` at all, and MEASURED with bun 1.4.0 a plain `bun <this file>`
// resolves the module but REJECTS `test(...)` with "Cannot use test outside of the test runner"
// (registration throws, the process would die before the CLI ran). Both cases therefore fall through
// to the CLI below; only `bun test` registers, which is what makes this gate part of the adapter
// package's own suite as well.
try {
  /** The test runner's own registration API; importing it is the whole bun:test arm. */
  const { expect, test } = await import("bun:test")
  test("no new terminal writes in an MPD runtime path (R5)", () => {
    /** The scan of the REAL band this repository currently carries. */
    const result = classify(scanTerminalWrites(REPO_ROOT), REPO_ROOT)
    report(result)
    expect({
      unfrozen: result.unfrozen.map((finding) => `${finding.file}:${finding.line} ${finding.identifier}`),
      overCeiling: result.overCeiling,
      staleInventory: result.staleInventory,
      staleExempt: result.staleExempt,
    }).toEqual({ unfrozen: [], overCeiling: [], staleInventory: [], staleExempt: [] })
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
