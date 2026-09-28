#!/usr/bin/env node
// patch-agent-teams-client.ts — mpd-owned EXPORT BRIDGE for the adopted agent-teams
// client bundle (packages/mpd-agent-teams-plugin/lib/client.js).
//
// Why: the adopted client is a PREBUILT bundle (upstream @nanmicoder/dsh-agent-teams,
// MIT) whose factory exports only { apply, inject }. mpd-owned client code (the
// DSH-better-sidebar team page) must compose the bundle's own views, monitor store,
// locale dictionaries and CSS-module classes instead of re-implementing them, and it
// must NOT render the adopted overlay panel: that panel is a window manager that
// measures the shell overlay, writes the conversation-column shift and drags/resizes
// itself — all of which the sidebar replaces.
//
// What it does: appends `exports.<name> = <name>;` lines for a pinned symbol list,
// immediately before `return module.exports;`, inside a marked region. The patch is
// ADDITIVE ONLY: no adopted statement is modified, removed or reordered, so `apply`
// keeps registering exactly what it registered before (until the bundle's web client
// stops calling it).
//
// Idempotency: a second run detects the region, verifies it is exactly what this
// script produces and leaves the file byte-identical.
// Drift: if the anchor (`exports.inject = inject;` followed by `return module.exports;`)
// is missing or ambiguous, or any pinned symbol is no longer declared in the factory
// scope, the script exits non-zero naming the missing symbol instead of exporting
// undefined.
//
// sourceMappingURL: the file's `//# sourceMappingURL=client.js.map` trailer is KEPT.
// The map still describes the adopted body correctly; the appended bridge region is
// simply unmapped (devtools shows it as-is), which is a smaller diff than editing an
// adopted line or regenerating a map for a generated file.
//
// Usage: node scripts/patch-agent-teams-client.ts [--check]
//   --check  report applied/not-applied without writing (exit 1 when not applied)
// Re-applied automatically by scripts/vendor-agent-teams.mjs after a re-vendor.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import process from "node:process"
import { repoRootFrom } from "./lib/repo.ts"

/** The repository root, derived from this script's own URL (`<root>/scripts/patch-agent-teams-client.ts`). */
const repoRoot: string = repoRootFrom(import.meta.url)

/** The adopted prebuilt client bundle the bridge is applied to. */
export const CLIENT_FILE: string = join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "client.js")

/** Region markers (matched by substring, so indentation drift cannot break them). */
const BEGIN: string = "//#region mpd-export-bridge (mpd-owned; re-applied by scripts/vendor-agent-teams.mjs)"
/** The closing marker of the marked region. */
const END: string = "//#endregion mpd-export-bridge"

/**
 * Pinned bridge: [exported name, factory-scope symbol].
 * Every source symbol is asserted to be declared in the factory scope before export,
 * so an upstream re-vendor that renames or drops one fails loudly here.
 */
export const BRIDGE_EXPORTS: ReadonlyArray<readonly [string, string]> = [
  ["TeamSection", "TeamSection"],
  ["historicCardTeam", "historicCardTeam"],
  ["memberArtUrl", "memberArtUrl"],
  ["LEAD_ART", "LEAD_ART"],
  ["ACTIVITY_PANEL_CSS", "ActivityPanel_module_css_default"],
  ["AGENT_TEAMS_LOCALE_NAMESPACE", "AGENT_TEAMS_LOCALE_NAMESPACE"],
  ["zh", "zh"],
  ["en", "en"],
  ["teamIsActive", "teamIsActive"],
  ["startActivityPolling", "startActivityPolling"],
  ["subscribeActivitySnapshots", "subscribeActivitySnapshots"],
  ["getActivitySnapshotsSnapshot", "getActivitySnapshotsSnapshot"],
  ["updateActivitySnapshots", "updateActivitySnapshots"],
  ["ACTIVITY_POLL_MS", "ACTIVITY_POLL_MS"],
  ["ACTIVITY_PROBE_MS", "ACTIVITY_PROBE_MS"],
  ["ACTIVITY_STATE_URL", "ACTIVITY_STATE_URL"],
  ["ACTIVITY_HALT_URL", "ACTIVITY_HALT_URL"],
]

/** The bridge block as LINES, indented like the anchor line it is inserted before. */
export function bridgeBlock(indent: string): string[] {
  /** Applies `indent` to one line, leaving an empty line empty (so trailing whitespace never lands). */
  const at = (line: string): string => (line === "" ? "" : indent + line)
  return [
    BEGIN,
    "// Additive re-exports only: mpd-owned client code composes the adopted views,",
    "// the monitor store, the locale dictionaries and the panel CSS-module classes.",
    "// Adopted behaviour is untouched (apply/inject and every registration stay as-is).",
    ...BRIDGE_EXPORTS.map(([exported, symbol]: readonly [string, string]): string => `exports.${exported} = ${symbol};`),
    END,
  ].map(at)
}

/** Whether a symbol is declared in the bundle's factory scope. */
export function isDeclared(source: string, symbol: string): boolean {
  /** The symbol with every regex metacharacter escaped, so it matches literally. */
  const escaped: string = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  /** A declaration of that exact identifier (not a longer name that merely starts with it). */
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9_$.])(?:function|const|let|var|class)\\s+${escaped}(?![A-Za-z0-9_$])`)
  return pattern.test(source)
}

/** Locate the single insertion point: `exports.inject = inject;` then `return module.exports;`. */
function findAnchor(lines: string[]): number[] {
  /** Line index of every anchor's SECOND line (the `return module.exports;`). */
  const hits: number[] = []
  // Index of the candidate `exports.inject = inject;` line (the next line is inspected with it).
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (lines[i].trim() !== "exports.inject = inject;") continue
    if (lines[i + 1].trim() !== "return module.exports;") continue
    hits.push(i + 1)
  }
  return hits
}

/** What one `applyExportBridge` run did, or would do with `write: false`. */
interface BridgeResult {
  /** `applied` after a write, `already-applied` when the region was present, `missing` under --check. */
  status: "applied" | "already-applied" | "missing"
  /** The patched file's absolute path. */
  file: string
  /** Byte length of the patched content. */
  bytes: number
  /** How many symbols the bridge exports. */
  symbols: number
}

/**
 * Apply (or verify) the export bridge.
 * @returns `{ status: "applied"|"already-applied"|"missing", file, bytes, symbols }` — see `BridgeResult`.
 */
export function applyExportBridge({ write = true }: { write?: boolean } = {}): BridgeResult {
  /** The adopted bundle's current bytes. */
  const source: string = readFileSync(CLIENT_FILE, "utf8")
  /** Its lines, the unit both the anchor and the region are located in. */
  const lines: string[] = source.split("\n")

  /** Index of the first line carrying the region's begin marker, or -1 when absent. */
  const beginAt: number = lines.findIndex((line: string): boolean => line.includes(BEGIN))
  if (beginAt !== -1) {
    /** Index of the next line carrying the end marker after `beginAt`, or -1 when unterminated. */
    const endAt: number = lines.findIndex((line: string, index: number): boolean => index > beginAt && line.includes(END))
    if (endAt === -1) {
      throw new Error(`[patch-agent-teams-client] FAIL: bridge region opened at line ${beginAt + 1} has no end marker — refusing to guess`)
    }
    /** The region's current bytes, line by line. */
    const found: string[] = lines.slice(beginAt, endAt + 1)
    /** The indentation the begin marker carries, which the expected block must reproduce. */
    const indent: string = found[0].slice(0, found[0].indexOf("//#region"))
    /** What this script would write for that indentation. */
    const expected: string[] = bridgeBlock(indent)
    if (found.join("\n") !== expected.join("\n")) {
      throw new Error(
        `[patch-agent-teams-client] FAIL: existing bridge region (lines ${beginAt + 1}-${endAt + 1}) does not match this script's output`
        + ` — delete the region and re-run, or update BRIDGE_EXPORTS deliberately`,
      )
    }
    return { status: "already-applied", file: CLIENT_FILE, bytes: Buffer.byteLength(source), symbols: BRIDGE_EXPORTS.length }
  }

  /** Every matching anchor; exactly one is required, so an ambiguous file is refused. */
  const anchors: number[] = findAnchor(lines)
  if (anchors.length !== 1) {
    throw new Error(
      `[patch-agent-teams-client] FAIL: expected exactly one 'exports.inject = inject;' + 'return module.exports;' anchor in `
      + `${relative(repoRoot, CLIENT_FILE)} (found ${anchors.length}) — upstream bundle layout drifted; review the new tail and update this script`,
    )
  }

  /** Bridged source symbols the factory scope no longer declares. */
  const missing: string[] = BRIDGE_EXPORTS.map(([, symbol]: readonly [string, string]): string => symbol).filter((symbol: string): boolean => !isDeclared(source, symbol))
  if (missing.length > 0) {
    throw new Error(
      `[patch-agent-teams-client] FAIL: ${missing.length} bridged symbol(s) no longer declared in the factory scope: ${missing.join(", ")}`
      + ` — upstream renamed or dropped them; fix BRIDGE_EXPORTS (or mpd client code) before re-vendoring`,
    )
  }

  /** The single anchor's line index. */
  const anchorAt: number = anchors[0]
  /** The indentation of that anchor line, reused by the inserted block. */
  const indent: string = lines[anchorAt].slice(0, lines[anchorAt].length - lines[anchorAt].trimStart().length)
  /** The patched file content: the block inserted immediately before the anchor. */
  const next: string = [...lines.slice(0, anchorAt), ...bridgeBlock(indent), ...lines.slice(anchorAt)].join("\n")
  if (write) writeFileSync(CLIENT_FILE, next)
  return { status: write ? "applied" : "missing", file: CLIENT_FILE, bytes: Buffer.byteLength(next), symbols: BRIDGE_EXPORTS.length }
}

/** The CLI: `--check` is the only flag, and every other argument is refused with exit 2. */
function main(): void {
  /** Whether the caller asked for the non-writing verification mode. */
  const check: boolean = process.argv.includes("--check")
  if (process.argv.slice(2).some((arg: string): boolean => arg !== "--check")) {
    console.error("[patch-agent-teams-client] FAIL: unknown argument (only --check is supported)")
    process.exit(2)
  }
  try {
    /** The run's outcome, which decides both the printed line and the exit code. */
    const result: BridgeResult = applyExportBridge({ write: !check })
    /** The patched file, relative to the repository root. */
    const rel: string = relative(repoRoot, result.file)
    if (result.status === "missing") {
      console.error(`[patch-agent-teams-client] NOT APPLIED: ${rel} lacks the bridge region (${result.symbols} symbols expected)`)
      process.exit(1)
    }
    console.log(
      `[patch-agent-teams-client] ${result.status === "applied" ? "applied" : "already applied"}: ${rel}`
      + ` (${result.symbols} symbols, ${result.bytes} bytes)`,
    )
    process.exit(0)
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error))
    process.exit(1)
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
