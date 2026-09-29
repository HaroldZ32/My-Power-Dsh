#!/usr/bin/env node
// patch-agent-teams-fixes.mjs — re-apply guard for the mpd LOCAL ADAPTATION deltas in the
// adopted agent-teams plugin (packages/mpd-agent-teams-plugin/lib/**).
//
// Why: `packages/mpd-agent-teams-plugin/lib` is adopted upstream main code (MIT). Our deltas
// there are bracketed by `//#region mpd-delta <id> (mpd LOCAL ADAPTATION; ...)` markers and
// registered in `packages/mpd-agent-teams-plugin/lib/mpd-deltas.ts`. A re-vendor / re-materialize
// of that tree must not be able to SILENTLY drop or rewrite them, so this script is the guard
// `scripts/vendor-agent-teams.mjs` re-runs after every refresh, exactly like
// `patch-agent-teams-client.mjs` guards the prebuilt client bundle via the export bridge.
//
// Contract:
//   --check (default)  every registered region must be present and byte-identical to the
//                      registry block; ANY missing/mismatched region exits 1 naming it.
//   --write            additionally RESTORE a missing (or partially stripped) region at the
//                      seam its registered before/after CONTEXT PAIR brackets, refusing when
//                      that pair is not unique or does not bracket a seam, then re-verify.
//   --write-registry   regenerate lib/mpd-deltas.ts from the marked regions in the files
//                      (used when a delta itself changes; never hand-edit the registry).
//
// Addressing: a region is addressed ONLY by the context pair recorded for it (see the
// registry JSDoc). Wave 2 measured that every LINE-keyed rule is order-dependent — a block
// carrying a copy of its own anchor line, or any earlier insertion, shifts the occurrence
// counts later regions were registered against — and the wave-2 registry left `tools.js`
// unable to heal byte-faithfully (60 diff lines, the `task-contract` region re-inserted at
// 1970 where canonical is 1733). Both context halves live outside every region, so the seam
// they bracket survives ANY insertion history.
//
// The guard is exercised by `packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs`
// (marker-prefix fixtures + strip-heal byte fidelity for both adopted files) and by the vendor run itself.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import process from "node:process"
import { repoRootFrom } from "./lib/repo.ts"
import { MPD_DELTA_MARKERS, MPD_DELTAS } from "../packages/mpd-agent-teams-plugin/lib/mpd-deltas.ts"
// The vendored registry's entry shape, imported as a TYPE only: the registry itself stays
// JavaScript, `scripts/lib/vendored-agent-teams.d.ts` declares its surface, and this import is
// erased before node ever runs the module.
import type { MpdDeltaEntry } from "../packages/mpd-agent-teams-plugin/lib/mpd-deltas.ts"

/** Repository root, derived from this script's own module URL (`<root>/scripts/`). */
const repoRoot = repoRootFrom(import.meta.url)

/** The adopted-body header the regenerated registry carries as its first line. */
const REGISTRY_NOCHECK = "// @ts-nocheck -- vendored upstream body: renamed to .ts for this repository's source-language rule, never typed here."

/** Region begin line for one delta id. */
const beginLine = (id: string): string => MPD_DELTA_MARKERS.begin(id)
/** Region end line for one delta id. */
const endLine = (id: string): string => MPD_DELTA_MARKERS.end(id)

/**
 * The subset of a registry entry a byte-faithful create-class reconstruction needs: the two
 * region-stripped skeleton windows plus the exact region block between them.
 */
type CreateClassEntryParts = Pick<MpdDeltaEntry, "beforeContext" | "afterContext" | "block">

/** Every file the registry touches, in registry order, plus the bootstrap discovery. */
export function mpdDeltaFiles(): string[] {
  /** Repository-relative paths that already carry a registered region, de-duplicated. */
  const registered = [...new Set(MPD_DELTAS.map((delta: MpdDeltaEntry): string => delta.file))]
  // A region can only be registered from a file the registry already names, so a NEW
  // delta file (lib/index.ts, t8's carrier hook) would never be discovered by
  // --write-registry. Discover the adopted lib files that carry region markers and are
  // not registered yet — the registry stays the authority, this only seeds it once.
  /** Absolute path of the adopted plugin's lib directory, scanned for marker carriers. */
  const libDir = join(repoRoot, "packages/mpd-agent-teams-plugin/lib")
  /** Adopted lib files that carry a region marker yet have no registry entry, repo-relative. */
  const discovered = readdirSync(libDir)
    .filter((name: string): boolean => name.endsWith(".ts") && name !== "mpd-deltas.ts")
    .map((name: string): string => relative(repoRoot, join(libDir, name)).split("\\").join("/"))
    .filter((file: string): boolean => !registered.includes(file) && readFileSync(join(repoRoot, file), "utf8").includes("//#region mpd-delta "))
  return [...registered, ...discovered]
}

/**
 * Name-derived CREATE CLASS (t6): the files the registry may RECREATE byte-faithfully when
 * they are missing. mpd-owned-ness comes from the FILE NAME — never from a registry field, so
 * the schema stays its five keys — and the derived registry itself is EXCLUDED: it matches
 * `mpd-*.ts` but is the artifact being generated, never restorable from its own entries.
 * @param file - repository-relative path of an adopted lib file.
 * @returns {string|undefined} the basename when it is create-class-eligible, else undefined
 */
export function createClassBase(file: string): string | undefined {
  /** The path's final segment, or undefined when the path has none. */
  const base = file.split("/").pop()
  if (base === undefined || base === "mpd-deltas.ts" || !/^mpd-.*\.ts$/.test(base)) return undefined
  return base
}

/**
 * Byte-faithful reconstruction of one entry's file: the two skeleton windows around the region
 * plus the region block, terminated by exactly one newline. RULE A (`writeRegistry`) refuses to
 * REGISTER a create-class entry that does not reproduce the current file, and the heal path
 * re-verifies what it wrote before reporting success.
 * @param entry - the registry-entry parts that address the region.
 * @returns the reconstructed file bytes, ending in exactly one newline.
 */
export function reconstructCreateClassFile(entry: CreateClassEntryParts): string {
  return [...entry.beforeContext, ...entry.block.split("\n"), ...entry.afterContext].join("\n") + "\n"
}

/** The single registry entry of a create-class file, or undefined when the create predicate fails. */
function createClassEntry(file: string): MpdDeltaEntry | undefined {
  if (createClassBase(file) === undefined) return undefined
  /** Every registry entry that names this file. */
  const entries = MPD_DELTAS.filter((item: MpdDeltaEntry): boolean => item.file === file)
  return entries.length === 1 ? entries[0] : undefined
}

/** Where one region's marker pair sits in a file, or which single marker survived a partial strip. */
interface RegionLocation {
  /** Zero-based index of the begin marker line, or -1 when only the end marker survived. */
  begin: number
  /** Zero-based index of the end marker line, or -1 when only the begin marker survived. */
  end: number
  /** The MISSING half of a partially stripped pair; absent while both markers are present. */
  orphan?: "begin" | "end"
}

/**
 * Locate one region by WHOLE-LINE marker comparison. Three delta ids are prefixes
 * of a sibling (`scope-overlap` ⊂ `scope-overlap-normalize`, `repair-scope` ⊂
 * `repair-scope-fields`, `task-contract` ⊂ `task-contract-render`), so a
 * substring search resolves the OUTER id's end marker to the CHILD's end line and
 * either misdiagnoses a merely-missing region as `half-open` or reports a bogus
 * span. The end-line spelling here is the same rule `writeRegistry` emits with.
 *
 * `orphan` reports a PARTIALLY stripped region (exactly one of the two markers
 * present): that is a missing region to heal, never a half-open pair. The
 * half-open wording is reserved for an inverted pair (both markers present,
 * end < begin), which is genuinely unrepairable by guessing.
 * @param lines - the file's lines, already split on `\n`.
 * @param id - region id whose markers are looked for.
 * @returns {{begin: number, end: number, orphan?: "begin"|"end"}|undefined}
 */
export function findRegion(lines: readonly string[], id: string): RegionLocation | undefined {
  /** Index of the line that is exactly this region's begin marker, or -1. */
  const begin = lines.findIndex((line: string): boolean => line.trim() === beginLine(id))
  /** Index of the line that is exactly this region's end marker, or -1. */
  const end = lines.findIndex((line: string): boolean => line.trim() === endLine(id))
  if (begin === -1 && end === -1) return undefined
  if (begin === -1) return { begin: -1, end, orphan: "begin" }
  if (end === -1) return { begin, end: -1, orphan: "end" }
  if (end < begin) {
    throw new Error(`[patch-agent-teams-fixes] FAIL: region "${id}" has a half-open marker pair (begin@${begin}, end@${end}) — both markers exist but the end precedes the begin; refusing to guess the intended span`)
  }
  return { begin, end }
}

/** Longest context window the emitter will grow to before it gives up. */
const CONTEXT_WINDOW_MAX = 6

/**
 * Number of positions where `window` occurs in `haystack` as consecutive lines.
 * @param haystack - the lines to scan.
 * @param window - the consecutive lines to look for.
 * @returns the number of start positions at which `window` matches line for line.
 */
function countWindow(haystack: readonly string[], window: readonly string[]): number {
  /** Matching start positions found so far. */
  let count = 0
  for (let at = 0; at + window.length <= haystack.length; at += 1) {
    /** Whether every line of `window` still matches at this start position. */
    let hit = true
    for (let offset = 0; offset < window.length; offset += 1) {
      if (haystack[at + offset] !== window[offset]) {
        hit = false
        break
      }
    }
    if (hit) count += 1
  }
  return count
}

/** Inclusive begin/end line indices of one region inside a file. */
type RegionSpan = [number, number]

/** A file's region spans plus the region-stripped skeleton and each region's seam inside it. */
interface SkeletonView {
  /** Inclusive spans of every region in the file, in file order. */
  spans: RegionSpan[]
  /** The file's lines with every region (both markers and body) removed. */
  skeleton: string[]
  /** For each span, the index in `skeleton` the region was removed from. */
  seams: number[]
}

/**
 * The file as it looks with EVERY region removed (markers + bodies), plus the
 * skeleton index each region was taken from: its SEAM. Context windows are always
 * computed on this skeleton, never on the canonical file — a canonical-file
 * window can name another region's `//#region` marker line, which does not exist
 * after a strip, and would then be unmatchable exactly when the heal needs it.
 * @param lines - the file's lines.
 * @returns {{spans: Array<[number, number]>, skeleton: string[], seams: number[]}}
 */
function skeletonView(lines: readonly string[]): SkeletonView {
  /** Inclusive spans of every region currently in the file, in file order. */
  const spans = regionSpans(lines)
  /** The file's lines with every region removed. */
  const skeleton: string[] = []
  /** Skeleton index each removed region was taken from, aligned with `spans`. */
  const seams: number[] = []
  /** Index of the next not-yet-copied line in the source file. */
  let cursor = 0
  for (const [begin, end] of spans) {
    skeleton.push(...lines.slice(cursor, begin))
    seams.push(skeleton.length)
    cursor = end + 1
  }
  skeleton.push(...lines.slice(cursor))
  return { spans, skeleton, seams }
}

/**
 * The shortest window anchored at one side of `seam` that occurs EXACTLY ONCE in
 * the skeleton, or `undefined` when none exists within CONTEXT_WINDOW_MAX lines.
 * `after` grows forward from the first skeleton line past the seam; `before`
 * grows backward from the last skeleton line before it. Failing instead of
 * falling back to a far-away line is the point: the wave-2 registry addressed
 * `task-contract` with a unique line 237 lines past the region, which is exactly
 * how the heal landed at 1970 instead of 1733.
 * @param skeleton - the region-stripped lines to search.
 * @param seam - the skeleton index the region was removed from.
 * @param side - which side of the seam the window grows from.
 * @returns the shortest unique window, or undefined when none exists within CONTEXT_WINDOW_MAX lines.
 */
function uniqueWindow(skeleton: readonly string[], seam: number, side: "before" | "after"): string[] | undefined {
  for (let size = 1; size <= CONTEXT_WINDOW_MAX; size += 1) {
    /** First index of the candidate window; the seam itself for a `before` window. */
    const start = side === "after" ? seam : seam - size
    /** Index just past the candidate window; the seam itself for an `after` window. */
    const end = side === "after" ? seam + size : seam
    if (start < 0 || end > skeleton.length) break
    /** The candidate window of `size` lines on the requested side of the seam. */
    const window = skeleton.slice(start, end)
    if (countWindow(skeleton, window) === 1) return window
  }
  return undefined
}

/**
 * Whether one file index lies inside any of `spans`.
 * @param spans - the inclusive region spans of the file.
 * @param index - the line index to test.
 * @returns true when `index` falls inside at least one span.
 */
function inSpans(spans: readonly RegionSpan[], index: number): boolean {
  return spans.some(([begin, end]: RegionSpan): boolean => index >= begin && index <= end)
}

/**
 * Locate the insertion seam of a MISSING region: the unique occurrence of the
 * registered afterContext window OUTSIDE every region, whose immediately
 * preceding non-region lines equal the registered beforeContext. Walking back
 * over region blocks is what lets several regions share one seam (scope-overlap
 * and scope-overlap-normalize are adjacent siblings): the pair pins the SITE, the
 * registry order (== canonical file order) pins the SEQUENCE, and inserting
 * before the first already-present sibling that sits LATER in the registry
 * reproduces that order — a subset strip that removed only the earlier sibling
 * must not be healed into the reverse order.
 * @param lines - the file's lines at this point of the pass.
 * @param delta - the registry entry whose region is missing.
 * @param spans - the inclusive spans of the regions still present.
 * @param file - repository-relative path of the file, named in the refusal.
 * @returns {number} index the block is inserted at
 */
function locateSeam(lines: readonly string[], delta: MpdDeltaEntry, spans: readonly RegionSpan[], file: string): number {
  /** Start indices, outside every region, where the registered afterContext window matches. */
  const matches: number[] = []
  for (let at = 0; at + delta.afterContext.length <= lines.length; at += 1) {
    if (inSpans(spans, at)) continue
    /** Whether the whole afterContext window matches at `at` without touching a region. */
    let hit = true
    for (let offset = 0; offset < delta.afterContext.length; offset += 1) {
      if (inSpans(spans, at + offset) || lines[at + offset] !== delta.afterContext[offset]) {
        hit = false
        break
      }
    }
    if (hit) matches.push(at)
  }
  if (matches.length !== 1) {
    throw new Error(`[patch-agent-teams-fixes] FAIL: delta "${delta.id}" is MISSING from ${file} and its registered afterContext window occurs ${matches.length} time(s) OUTSIDE every region (must be exactly 1) — the adopted file drifted; restore the marked file, or re-establish the region's site and re-run --write-registry — the applier never guesses an insertion site`)
  }
  /** The single start index of the registered afterContext window. */
  const at = matches[0]
  /** Region spans walked back over while looking for the seam. */
  const skipped: RegionSpan[] = []
  /** Index the backward walk currently sits at. */
  let cursor = at
  for (;;) {
    /** The region whose end line sits immediately before `cursor`, when one does. */
    const enclosing = spans.find(([begin, end]: RegionSpan): boolean => end === cursor - 1)
    if (enclosing === undefined) break
    skipped.unshift(enclosing)
    cursor = enclosing[0]
  }
  /** Number of beforeContext lines the seam must be preceded by. */
  const size = delta.beforeContext.length
  /** The lines immediately before the seam candidate, joined (empty when it is the file head). */
  const preceding = lines.slice(Math.max(0, cursor - size), cursor).join("\n")
  if (cursor - size < 0 || preceding !== delta.beforeContext.join("\n")) {
    throw new Error(`[patch-agent-teams-fixes] FAIL: delta "${delta.id}" is MISSING from ${file} and the lines before its afterContext window do not match the registered beforeContext — the adopted file drifted; restore the marked file, or re-establish the region's site and re-run --write-registry — the applier never guesses an insertion site`)
  }
  /** Registry index of the region being located, used to keep sibling order canonical. */
  const selfIndex = MPD_DELTAS.findIndex((item: MpdDeltaEntry): boolean => item.file === file && item.id === delta.id)
  for (const [begin] of skipped) {
    /** The skipped sibling's begin-marker id, or null when its begin line is unreadable. */
    const match = /\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(lines[begin])
    if (match === null) continue
    /** Registry index of that sibling, compared with `selfIndex` to preserve canonical order. */
    const siblingIndex = MPD_DELTAS.findIndex((item: MpdDeltaEntry): boolean => item.file === file && item.id === match[1])
    if (siblingIndex > selfIndex) return begin
  }
  return at
}

/**
 * Re-bracket a PARTIALLY stripped region whose body is still present byte-for-byte:
 * restore only the missing marker line instead of inserting a second copy of the
 * block. A body that does not match the registered block returns `undefined`, and
 * the caller falls back to dropping the orphan marker and healing from context.
 * @param lines - the file's lines at this point of the pass.
 * @param delta - the registry entry the region belongs to.
 * @param found - the located orphan span (exactly one of its markers survived).
 * @returns {string[]|undefined}
 */
function reBracketOrphan(lines: readonly string[], delta: MpdDeltaEntry, found: RegionLocation): string[] | undefined {
  /** The registered block's body lines, i.e. without its two marker lines. */
  const body = delta.block.split("\n").slice(1, -1)
  if (found.orphan === "end") {
    // The surviving begin marker carries the region's indentation: the restored
    // END marker must be written at that same indent, or the region no longer
    // matches the registered block byte-for-byte.
    /** Leading whitespace of the surviving begin marker, i.e. the region's indentation. */
    const indent = leadingWhitespace(lines[found.begin])
    /** The registered body re-indented to the surviving marker, markers stripped. */
    const expectedBody = expectedLines(delta, indent).slice(1, -1)
    /** The lines now sitting where the registered body should be. */
    const actual = lines.slice(found.begin + 1, found.begin + 1 + body.length)
    if (actual.length !== expectedBody.length || actual.join("\n") !== expectedBody.join("\n")) return undefined
    /** Index the restored end marker is inserted at. */
    const at = found.begin + 1 + body.length
    return [...lines.slice(0, at), `${indent}${endLine(delta.id)}`, ...lines.slice(at)]
  }
  if (found.end - body.length < 0) return undefined
  /** The lines now sitting where the registered body should be. */
  const actual = lines.slice(found.end - body.length, found.end)
  if (actual.join("\n") !== body.join("\n")) return undefined
  /** Index the restored begin marker is inserted at. */
  const at = found.end - body.length
  /** Leading whitespace of the surviving end marker, i.e. the region's indentation. */
  const indent = leadingWhitespace(lines[found.end])
  return [...lines.slice(0, at), `${indent}${beginLine(delta.id)}`, ...lines.slice(at)]
}

/**
 * Leading whitespace of a line (the block's own indentation).
 * @param line - the line whose indentation is measured.
 * @returns the run of whitespace that opens the line.
 */
function leadingWhitespace(line: string): string {
  return line.slice(0, line.length - line.trimStart().length)
}
/**
 * The exact lines this script writes for one region at `indent`: the block is
 * stored at its canonical indentation, so re-indenting strips the BLOCK's own
 * indent (never the target's) before applying the target prefix. At the
 * canonical indentation this is the identity, which is what `--check` relies on.
 * @param delta - the registry entry holding the canonical block.
 * @param indent - the indentation the block is re-written at.
 * @returns the block's lines, re-indented to `indent`.
 */
function expectedLines(delta: MpdDeltaEntry, indent: string): string[] {
  /** The registered block's own canonical indentation, stripped before re-indenting. */
  const base = leadingWhitespace(delta.block.split("\n")[0] ?? "")
  return delta.block.split("\n").map((line: string): string => {
    if (line === "") return ""
    /** The line with the block's canonical indent removed when it carries it. */
    const body = base !== "" && line.startsWith(base) ? line.slice(base.length) : line
    return `${indent}${body}`
  })
}

/**
 * The registered block's own canonical indentation.
 * @param delta - the registry entry holding the canonical block.
 * @returns the leading whitespace of the block's first line.
 */
export function canonicalIndent(delta: MpdDeltaEntry): string {
  return leadingWhitespace(delta.block.split("\n")[0] ?? "")
}

// F4 is now covered BY CONSTRUCTION: the heal inserts a region VERBATIM at its
// own canonical indent, and a context pair (never a nearby line's indentation)
// chooses the site. The wave-2 F4 class — a region authored at 8 spaces inserted
// at a 4-space anchor line, silently leaving the scope it belongs to
// (`create-contract-gate` outside `if (WRITE_KINDS…)`) — has no anchor indent left
// to get wrong, so the `effectiveInsertionIndent` correction is gone with it.

/**
 * Every name one region block declares at MODULE scope (column 0). Used by the
 * heal guard: inserting a region whose names are STILL declared elsewhere in the
 * file would produce a duplicate declaration and a module that fails to import.
 * Nested locals (a `const key` inside a loop) are deliberately NOT collected —
 * they cannot collide with a module-level declaration.
 * @param block - the region block whose module-scope declarations are collected.
 * @returns the declared names, de-duplicated, in first-seen order.
 */
function declaredNames(block: string): string[] {
  /** Module-scope names the block declares, de-duplicated. */
  const names = new Set<string>()
  for (const line of block.split("\n")) {
    if (leadingWhitespace(line) !== "") continue
    /** The declaration's name when the line declares one at column 0, else null. */
    const match = /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (match !== null) names.add(match[1])
  }
  return [...names]
}

/**
 * Whether a line declares a module-scope (column 0) function/class/const/let/var.
 * @param line - the line to test.
 * @param name - the declaration name to look for (regex-escaped before it enters the pattern).
 * @returns true when `line` declares exactly `name` at column 0.
 */
function declaresName(line: string, name: string): boolean {
  return new RegExp(`^(?:export\\s+)?(?:async\\s+)?(?:function|class|const|let|var)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(line)
}

/**
 * Index spans of every region currently in the file.
 * @param lines - the file's lines.
 * @returns the inclusive region spans, in file order.
 */
function declaredSpans(lines: readonly string[]): RegionSpan[] {
  return regionSpans(lines)
}

/**
 * F3 guard: refuse to INSERT a region while the file still declares, OUTSIDE any
 * region, a name the region defines. The pre-fix heal path happily inserted a
 * `scope-glob` region into a file that still carried the upstream
 * `pathMatchesScope`, exited 0, and left a module that failed to import with
 * `Identifier 'pathMatchesScope' has already been declared` — a guard giving
 * false confidence in exactly the re-materialize scenario it exists for.
 * Occurrences INSIDE a region are expected (the regions already healed in this
 * same pass) and are never a collision.
 * @param lines - the file's lines at this point of the pass.
 * @param delta - the registry entry about to be inserted.
 * @param file - repository-relative path of the file, named in the refusal.
 * @param where - the pass stage named in the refusal (`insertion`).
 * @returns nothing; throws when a name the region declares is still declared outside every region.
 */
function assertNoRedeclaration(lines: readonly string[], delta: MpdDeltaEntry, file: string, where: string): void {
  /** Inclusive spans of the regions present at this point of the pass. */
  const spans = declaredSpans(lines)
  for (const name of declaredNames(delta.block)) {
    /** Line indices where `name` is still declared outside every region. */
    const hits = lines
      .map((line: string, index: number): number => (declaresName(line, name) && !spans.some(([begin, end]: RegionSpan): boolean => index >= begin && index <= end) ? index : -1))
      .filter((index: number): boolean => index !== -1)
    if (hits.length > 0) {
      throw new Error(
        `[patch-agent-teams-fixes] FAIL: refusing to heal delta "${delta.id}" into ${file} (${where}): it declares "${name}" but that declaration still exists OUTSIDE any region at line ${hits[0] + 1}`
        + ` — the file was re-materialized with the OLD body; remove the old declaration (or restore the marked file) before healing, otherwise the healed module fails to import`,
      )
    }
  }
}

/**
 * Post-heal validation of one already-healed file: every registered region is
 * present exactly once, and no name a region declares is ALSO declared outside
 * that region (the duplicate declaration that made the pre-fix heal produce an
 * unimportable module).
 * @param lines - the healed file's lines.
 * @param file - repository-relative path of the healed file.
 * @returns nothing; throws when a region is missing/duplicated or a name is declared outside its region.
 */
export function validateHealedFile(lines: readonly string[], file: string): void {
  for (const delta of MPD_DELTAS.filter((item: MpdDeltaEntry): boolean => item.file === file)) {
    // Whole-line comparison, the same rule findRegion resolves with: `scope-overlap`
    // is a prefix of `scope-overlap-normalize`, so a substring count would report 2
    // for the outer region on an intact file.
    /** Number of whole lines that spell this region's begin marker. */
    const occurrences = lines.filter((line: string): boolean => line.trim() === beginLine(delta.id)).length
    if (occurrences !== 1) {
      throw new Error(`[patch-agent-teams-fixes] FAIL: post-heal validation of ${file}: region "${delta.id}" appears ${occurrences} times (must be exactly 1)`)
    }
    /** The region's located span; the count above guarantees its begin marker exists. */
    const found = findRegion(lines, delta.id)!
    for (const name of declaredNames(delta.block)) {
      /** Line indices where `name` is declared outside the region's span. */
      const outside = lines
        .map((line: string, index: number): number => (declaresName(line, name) ? index : -1))
        .filter((index: number): boolean => index !== -1 && (index < found.begin || index > found.end))
      if (outside.length > 0) {
        throw new Error(
          `[patch-agent-teams-fixes] FAIL: post-heal validation of ${file}: "${name}" is declared both inside region "${delta.id}" and ${outside.length} time(s) outside it (line(s) ${outside.map((index: number): number => index + 1).join(", ")}) — the healed module cannot import`,
        )
      }
    }
  }
}

/**
 * Assert one PRESENT region spans exactly the registered block at its own indent.
 * Throws on any drift so a heal can never "repair" a file into a state that only
 * looks applied.
 * @param lines - the file's lines at this point of the pass.
 * @param delta - the registry entry the region belongs to.
 * @param file - repository-relative path of the file, named in the refusal.
 * @param found - the located span, or undefined when no marker was found.
 * @returns nothing; throws on any drift between the region and the registered block.
 */
function assertRegionMatches(lines: readonly string[], delta: MpdDeltaEntry, file: string, found: RegionLocation | undefined): void {
  if (found === undefined || found.orphan !== undefined) {
    throw new Error(`[patch-agent-teams-fixes] FAIL: delta "${delta.id}" in ${file} is not present as a complete marker pair after the repair — refusing to report success`)
  }
  /** Indentation of the region as it sits in the file. */
  const indent = leadingWhitespace(lines[found.begin])
  /** The lines this script writes for the region at that indentation. */
  const expected = expectedLines(delta, indent)
  /** The region's lines as they actually are in the file. */
  const actual = lines.slice(found.begin, found.end + 1)
  if (actual.join("\n") !== expected.join("\n")) {
    /** Index of the first line that differs from the registered block, or -1 when none does. */
    const firstDiff = actual.findIndex((line: string, index: number): boolean => line !== (expected[index] ?? ""))
    throw new Error(
      `[patch-agent-teams-fixes] FAIL: delta "${delta.id}" in ${file} (lines ${found.begin + 1}-${found.end + 1}) no longer matches this script's registered block`
      + ` — first difference at line ${found.begin + 1 + (firstDiff === -1 ? 0 : firstDiff)}`
      + `; either the delta was edited without regenerating lib/mpd-deltas.ts (run --write-registry) or a re-vendor rewrote it`,
    )
  }
}

/**
 * The canon orphan row `begin present + end absent + body NOT byte-equal` is a
 * DRIFTED delta, not a missing one: someone edited the region body without
 * regenerating the registry. Dropping the orphan begin marker and healing from
 * context would delete that authored text, so this row refuses — naming the
 * region AND the surviving begin marker's line, with the remedy.
 * @param delta - the registry entry whose orphan marker survived.
 * @param file - repository-relative path of the file, named in the refusal.
 * @param found - the located orphan span (its `begin` is the surviving marker line).
 * @returns the refusal error naming the region, the line and the remedy.
 */
function driftedOrphanError(delta: MpdDeltaEntry, file: string, found: RegionLocation): Error {
  return new Error(
    `[patch-agent-teams-fixes] FAIL: delta "${delta.id}" in ${file}: the begin marker at line ${found.begin + 1} has no end marker and the surviving lines are NOT the registered block — the delta was edited without regenerating lib/mpd-deltas.ts; restore the marked region, or fix it and run: node scripts/patch-agent-teams-fixes.mjs --write-registry`,
  )
}

/**
 * Refuse to run the applier against a pre-wave-3 registry. Every entry must be
 * addressed by its context pair and must not carry the retired line keys, and
 * there is deliberately NO fallback to the old line-keyed rule — that rule is the
 * wave-2 order-dependence defect.
 *
 * The guard is NOT at module load on purpose: `--write-registry` is the one-time
 * migration and it only needs `delta.file` from the old registry, so a load-time
 * guard would make the migration impossible.
 * @param entries - the registry entries to check; defaults to the imported registry.
 * @returns nothing; throws when any entry carries a retired line key or lacks a context pair.
 */
export function assertRegistryFormat(entries: readonly MpdDeltaEntry[] = MPD_DELTAS): void {
  /** Whether any entry still carries one of the retired wave-2 line keys. */
  const carriesOldKeys = entries.some((entry: MpdDeltaEntry): boolean => entry.anchor !== undefined || entry.anchorOccurrence !== undefined || entry.anchorMarker !== undefined)
  /** Whether EVERY entry is addressed by a non-empty before/after context pair. */
  const carriesContextPair = entries.every((entry: MpdDeltaEntry): boolean => Array.isArray(entry.beforeContext) && entry.beforeContext.length > 0
    && Array.isArray(entry.afterContext) && entry.afterContext.length > 0)
  if (carriesOldKeys || !carriesContextPair) {
    throw new Error("[patch-agent-teams-fixes] FAIL: lib/mpd-deltas.ts is in the OLD anchor format — run: node scripts/patch-agent-teams-fixes.mjs --write-registry (one-time migration)")
  }
}

/** Caller options for one apply/verify pass over the registered mpd deltas. */
interface ApplyOptions {
  /** Repository root the registry's relative paths resolve against; defaults to this repository. */
  root?: string
  /** True to restore missing regions on disk, false to verify only (the `--check` default). */
  write?: boolean
}

/** Outcome of one apply/verify pass over the registered mpd deltas. */
interface ApplyResult {
  /** `applied` when this pass inserted or recreated at least one region, `already-applied` otherwise. */
  status: "applied" | "already-applied"
  /** Every adopted file the registry touches, in registry order. */
  files: string[]
  /** Ids of the regions this pass inserted or recreated. */
  inserted: string[]
  /** Number of registered regions this pass examined. */
  regions: number
}

/**
 * Apply or verify the registered mpd deltas under `root`.
 * @param options - repository root and write flag; both defaulted for a verify-only run in this repo.
 * @returns {{status: "applied"|"already-applied", files: string[], inserted: string[], regions: number}}
 */
export function applyAgentTeamsFixes({ root = repoRoot, write = false }: ApplyOptions = {}): ApplyResult {
  assertRegistryFormat()
  /** Every adopted file the registry touches, in registry order. */
  const files = mpdDeltaFiles()
  /** Ids of the regions this pass inserted or recreated. */
  const inserted: string[] = []
  /** Number of registered regions examined so far. */
  let regions = 0
  for (const file of files) {
    /** Absolute path of the adopted file under the root being applied to. */
    const absolute = join(root, file)
    // DISPOSITION BRANCH (t6): an enumerated registered file may be ABSENT — a re-materialize
    // (`rm -rf lib && cp -r upstream/lib lib`) drops our mpd-owned bridge, which upstream does
    // not have. It must never reach the bare readFileSync below: a missing create-class file is
    // either reported BY NAME (--check) or RECREATED from its single registry entry (--write),
    // and every other missing file refuses by name instead of crashing with ENOENT.
    if (!existsSync(absolute)) {
      /** The file's single registry entry, or undefined when it is not a create-class file. */
      const entry = createClassEntry(file)
      if (entry === undefined) {
        throw new Error(`[patch-agent-teams-fixes] FAIL: registered adopted file ${file} is MISSING and is NOT a create-class file (lib/mpd-*.ts, excluding mpd-deltas.ts, carrying exactly ONE registry entry) — the registry cannot reconstruct it from context; restore the file from the re-materialize source and re-run`)
      }
      if (!write) {
        throw new Error(`[patch-agent-teams-fixes] FAIL: registered mpd-owned file ${file} is MISSING (verify-only mode) — its single registry entry "${entry.id}" reconstructs it byte-faithfully; re-run with --write to recreate it from lib/mpd-deltas.ts`)
      }
      /** The bytes the create-class entry reconstructs for the missing file. */
      const expected = reconstructCreateClassFile(entry)
      writeFileSync(absolute, expected)
      try {
        /** The bytes re-read from the file just created. */
        const created = readFileSync(absolute, "utf8")
        if (created !== expected) throw new Error("the re-read bytes differ from the bytes just written")
        if (!created.endsWith("\n") || created.endsWith("\n\n")) throw new Error("the created file does not end with exactly one newline")
        /** The created file's lines, re-verified against the entry before the create is accepted. */
        const createdLines = created.split("\n")
        assertRegionMatches(createdLines, entry, file, findRegion(createdLines, entry.id))
        validateHealedFile(createdLines, file)
      } catch (error) {
        // ROUND-TRIP RULE (t6): a create that does not immediately re-verify is UNDONE, so a
        // failed run never leaves a half-restored tree. Its bound, stated honestly: this catches
        // a corrupt or half-written create, NOT truncation — RULE A (writeRegistry) is what
        // prevents a short reconstruction from ever being registered.
        rmSync(absolute, { force: true })
        /** The re-verification failure's message, or the raw value when it is not an Error. */
        const why = error instanceof Error ? error.message : String(error)
        throw new Error(`[patch-agent-teams-fixes] FAIL: recreated ${file} from its single registry entry "${entry.id}" but the post-create re-verification FAILED (${why}) — the created file was DELETED again, so no half-restored tree is left behind; fix that entry and re-run`)
      }
      regions += 1
      inserted.push(entry.id)
      continue
    }
    /** The file's bytes before this pass; only `--write` may change them below. */
    const before = readFileSync(absolute, "utf8")
    /** The working line array for this file, rewritten as regions are healed. */
    let lines = before.split("\n")
    for (const delta of MPD_DELTAS.filter((item: MpdDeltaEntry): boolean => item.file === file)) {
      regions += 1
      /** The region's located span, its orphan half, or undefined when no marker survives. */
      const found = findRegion(lines, delta.id)
      if (found !== undefined && found.orphan === undefined) {
        assertRegionMatches(lines, delta, file, found)
        continue
      }
      // `orphan` names the MISSING marker: "begin" = the end marker survived,
      // "end" = the begin marker survived.
      /** Index of the single surviving marker, or undefined when the region is fully gone. */
      const orphanAt = found === undefined ? undefined : (found.orphan === "begin" ? found.end : found.begin)
      /** Human-readable description of the surviving marker, or undefined when none survived. */
      const survivor = found === undefined
        ? undefined
        : found.orphan === "begin" ? `end marker at line ${found.end + 1}` : `begin marker at line ${found.begin + 1}`
      /** Suffix naming the partial strip, or the empty string for a fully missing region. */
      const partial = survivor === undefined ? "" : ` (partially stripped: the ${survivor} survived and its partner is gone)`
      if (!write) {
        // --check must not advise `--write` for the drifted row: --write refuses it too,
        // so the honest diagnosis is the edit-without-regeneration one.
        if (found !== undefined && found.orphan === "end" && reBracketOrphan(lines, delta, found) === undefined) {
          throw driftedOrphanError(delta, file, found)
        }
        throw new Error(`[patch-agent-teams-fixes] FAIL: delta "${delta.id}" is MISSING from ${file}${partial} (verify-only mode) — a re-vendor dropped it; re-run with --write to restore it from lib/mpd-deltas.ts`)
      }
      if (found !== undefined) {
        // PARTIAL strip: restore the missing marker around an intact body when we
        // can, so the repair is a marker fix and never a second copy of the code.
        /** The file with the missing marker restored, or undefined when the body is not byte-equal. */
        const reBracketed = reBracketOrphan(lines, delta, found)
        if (reBracketed !== undefined) {
          lines = reBracketed
          inserted.push(delta.id)
          assertRegionMatches(lines, delta, file, findRegion(lines, delta.id))
          continue
        }
        // The orphan-'end' row (begin survived, end gone) with a drifted body is a
        // refusal; only the orphan-'begin' row — where nothing of the body survived —
        // drops the single orphan marker and heals from context.
        if (found.orphan === "end") {
          throw driftedOrphanError(delta, file, found)
        }
        // Only this row reaches here and it always carries a surviving begin marker
        // (the orphan-'end' row threw above), so `orphanAt` is a real index; the `!`
        // states that invariant to the compiler and erases at runtime.
        lines = [...lines.slice(0, orphanAt!), ...lines.slice(orphanAt! + 1)]
      }
      assertNoRedeclaration(lines, delta, file, "insertion")
      // The site comes from the registered before/after CONTEXT PAIR only: both
      // halves are lines OUTSIDE every region, so no earlier insertion in this pass
      // (or in any past heal) can rewrite them, and the seam they bracket is
      // invariant. A pair that is not unique, or that does not bracket a seam,
      // refuses instead of guessing — that is the wave-2 order-dependence fix.
      /** Insertion seam resolved from the registered context pair. */
      const seam = locateSeam(lines, delta, skeletonView(lines).spans, file)
      lines = [...lines.slice(0, seam), ...delta.block.split("\n"), ...lines.slice(seam)]
      inserted.push(delta.id)
    }
    // Post-validation of the HEALED file: exact content is already asserted per
    // region above; this refuses a heal that would leave a duplicate declaration.
    if (write)
      validateHealedFile(lines, file)
    /** The file's lines joined back into text, written only when `--write` changed them. */
    const after = lines.join("\n")
    if (write && after !== before) writeFileSync(absolute, after)
  }
  return {
    status: inserted.length > 0 ? "applied" : "already-applied",
    files,
    inserted,
    regions,
  }
}

/** One region whose begin marker was seen but whose end marker has not been seen yet. */
interface OpenRegion {
  /** Region id spelled by the begin marker. */
  id: string
  /** Zero-based index of that begin marker's line. */
  begin: number
}

/**
 * Every region span currently in one file, as `[begin, end]` index pairs.
 * @param lines - the file's lines.
 * @returns the inclusive spans, in file order; throws on any nesting or mismatched pair.
 */
function regionSpans(lines: readonly string[]): RegionSpan[] {
  // T-92/T-42 (t55): a marker is a SIBLING, never a CHILD. The previous scan jumped from a region's
  // begin to its end (`index = end + 1`), so a region opened INSIDE another region's span was
  // invisible to every nesting-unaware consumer: the registry missed it, `--write-registry` kept
  // missing it, the docs gate's per-file count still said "agree", and no gate reddened — the measured
  // defect (session-start.js's `plan-format-seed` nested inside `session-start-gate`). The scan is now
  // a STACK: an inner begin, a mismatched end or an unterminated region is REFUSED by name and span,
  // which is the one place `--write-registry`, the applier and the heal path all pass through.
  /** Inclusive spans of the regions closed so far, in file order. */
  const spans: RegionSpan[] = []
  /** Regions whose begin marker was seen but whose end marker has not, innermost last. */
  const open: OpenRegion[] = []
  for (let index = 0; index < lines.length; index += 1) {
    /** The begin-marker id on this line, or null when the line is not a region begin. */
    const beginMatch = /^\s*\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(lines[index])
    if (beginMatch !== null) {
      /** Region id spelled by the begin marker. */
      const id = beginMatch[1]
      if (open.length > 0) {
        /** The innermost still-open region this begin marker would nest inside. */
        const parent = open[open.length - 1]
        throw new Error(`[patch-agent-teams-fixes] FAIL: region "${id}" (line ${index + 1}) is NESTED inside region "${parent.id}" (line ${parent.begin + 1}) — a marker must be a SIBLING, never a child: move "${id}" outside "${parent.id}"'s span (or teach the registry, every count and this scan to represent the nesting)`)
      }
      open.push({ id, begin: index })
      continue
    }
    /** The end-marker id on this line, or null when the line is not a region end. */
    const endMatch = /^\s*\/\/#endregion (mpd-delta [A-Za-z0-9-]+)\s*$/.exec(lines[index])
    if (endMatch === null)
      continue
    /** The region this end marker closes, or undefined when no region is open. */
    const top = open.pop()
    if (top === undefined || top.id !== endMatch[1]) {
      throw new Error(`[patch-agent-teams-fixes] FAIL: end marker "${endMatch[1]}" (line ${index + 1}) closes ${top === undefined ? "no open region" : `region "${top.id}" (line ${top.begin + 1}) instead`}`)
    }
    spans.push([top.begin, index])
  }
  if (open.length > 0) {
    /** The innermost region still open at end of file. */
    const stray = open[open.length - 1]
    throw new Error(`[patch-agent-teams-fixes] FAIL: unterminated region "${stray.id}" (line ${stray.begin + 1})`)
  }
  return spans
}

/** Where the regenerated registry was written and how many region entries it carries. */
interface RegistryWriteResult {
  /** Absolute path of the regenerated `lib/mpd-deltas.ts`. */
  file: string
  /** Number of region entries written, in file order. */
  regions: number
}

/**
 * Regenerate lib/mpd-deltas.ts from the marked regions in the adopted files.
 * @returns the written path and the number of entries emitted.
 */
export function writeRegistry(): RegistryWriteResult {
  /** Absolute path of the generated registry module. */
  const registryFile = join(repoRoot, "packages/mpd-agent-teams-plugin/lib/mpd-deltas.ts")
  /** The registry module's lines, joined with `\n` when the file is written. */
  const out: string[] = []
  /** The entries collected from the marked regions, in file order. */
  const entries: MpdDeltaEntry[] = []
  for (const file of mpdDeltaFiles()) {
    /** Absolute path of the adopted file being read. */
    const absolute = join(repoRoot, file)
    // Same disposition rule as the applier: a MISSING registered file must never reach a bare
    // readFileSync. Regeneration would silently DROP that file's entries, so it refuses BY NAME
    // and tells the caller to restore the file first (--write recreates a create-class file).
    if (!existsSync(absolute)) {
      throw new Error(`[patch-agent-teams-fixes] FAIL: registered adopted file ${file} is MISSING — regenerating the registry now would silently DROP its entries; run: node scripts/patch-agent-teams-fixes.mjs --write first (it recreates a create-class lib/mpd-*.js file byte-faithfully), then re-run --write-registry`)
    }
    /** The adopted file's bytes, the authority for the generated entry bytes. */
    const text = readFileSync(absolute, "utf8")
    /** The adopted file's lines. */
    const lines = text.split("\n")
    // Spans and skeleton are computed ONCE per file: recomputing them after each
    // entry would let an already-processed region's body contaminate the next
    // entry's uniqueness count.
    /** The file's region spans, region-stripped skeleton and per-region seam indices. */
    const { spans, skeleton, seams } = skeletonView(lines)
    for (let index = 0; index < spans.length; index += 1) {
      /** The region's inclusive begin/end line indices, taken from the per-file span list. */
      const [begin, end] = spans[index]
      /** The region's begin-marker id, or null when its marker line is unreadable. */
      const match = /\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(lines[begin])
      if (match === null) throw new Error(`[patch-agent-teams-fixes] FAIL: unreadable region marker at ${file}:${begin + 1}`)
      /** Region id spelled by the begin marker. */
      const id = match[1]
      /** Exact region bytes, both marker lines included. */
      const block = lines.slice(begin, end + 1).join("\n")
      /** Shortest before-window unique in the region-stripped skeleton, or undefined. */
      const beforeContext = uniqueWindow(skeleton, seams[index], "before")
      /** Shortest after-window unique in the region-stripped skeleton, or undefined. */
      const afterContext = uniqueWindow(skeleton, seams[index], "after")
      if (beforeContext === undefined || afterContext === undefined) {
        /** Which half of the context pair has no unique window. */
        const missing = beforeContext === undefined ? "beforeContext" : "afterContext"
        throw new Error(`[patch-agent-teams-fixes] FAIL: no ${missing} window for region "${id}" in ${file} is unique in the region-stripped skeleton within ${CONTEXT_WINDOW_MAX} lines — refusing to register a far-away or ambiguous anchor (that fallback is exactly the wave-2 order-dependence bug)`)
      }
      entries.push({ file, id, beforeContext, afterContext, block })
      // RULE A (t6): the create guarantee is sound only when the entry reproduces the WHOLE
      // file, and `uniqueWindow` returns the SHORTEST unique window (<= CONTEXT_WINDOW_MAX
      // lines) — NOT edge-anchored — so a file with more skeleton lines than its windows would
      // reconstruct SHORT, and the heal's own round-trip check cannot see that. The invariant is
      // therefore enforced HERE, where the file still exists. Multi-region mpd-*.js files carry
      // no create guarantee and are never refused.
      if (createClassBase(file) !== undefined && spans.length === 1) {
        /** The bytes this entry's context pair plus block reconstruct for the file. */
        const reconstructed = reconstructCreateClassFile({ beforeContext, afterContext, block })
        if (reconstructed !== text) {
          throw new Error(`[patch-agent-teams-fixes] FAIL: ${file} is a create-class file (lib/mpd-*.ts, exactly one region) but beforeContext + block + afterContext does NOT reproduce its current bytes — a create-class file must be reconstructible from beforeContext+block+afterContext; make the leading/trailing skeleton lines unique (the frozen bridge layout is 1 leading comment + region + 1 different trailing comment) or drop the create guarantee by using more than one region`)
        }
      }
    }
  }
  out.push(REGISTRY_NOCHECK)
  out.push("/**")
  out.push(" * mpd LOCAL ADAPTATION registry for the adopted agent-teams plugin.")
  out.push(" *")
  out.push(" * Generated from the `//#region mpd-delta ...` markers that live in the adopted")
  out.push(" * files themselves (scripts/patch-agent-teams-fixes.mjs --write-registry, checked")
  out.push(" * in `--check` mode). This module is the ONE authority for what our deltas should")
  out.push(" * look like: the applier inserts these exact bytes and compares a file's existing")
  out.push(" * regions against them, so a re-vendor that drops or rewrites a delta fails")
  out.push(" * loudly instead of silently losing it. Never hand-edit: edit the adopted file's")
  out.push(" * marked region and regenerate.")
  out.push(" * @module dsh-agent-teams/mpd-deltas")
  out.push(" */")
  out.push("/** One registered mpd delta region: its file, id, context pair and replacement block. */")
  out.push("export interface MpdDeltaEntry {")
  out.push("  /** Repository-relative path of the adopted file the region lives in. */")
  out.push("  readonly file: string")
  out.push("  /** Region id, unique per file; the marker text interpolates it into both markers. */")
  out.push("  readonly id: string")
  out.push("  /** Shortest unique window of region-stripped lines ending at the seam. */")
  out.push("  readonly beforeContext: readonly string[]")
  out.push("  /** Shortest unique window of region-stripped lines starting after the seam. */")
  out.push("  readonly afterContext: readonly string[]")
  out.push("  /** Exact bytes the region must contain, including both marker lines. */")
  out.push("  readonly block: string")
  out.push("  /** RETIRED wave-2 line key, read only from a pre-migration registry by assertRegistryFormat. */")
  out.push("  readonly anchor?: string")
  out.push("  /** RETIRED wave-2 marker line the anchor was keyed by, read only from a pre-migration registry. */")
  out.push("  readonly anchorMarker?: string")
  out.push("  /** RETIRED wave-2 occurrence index of anchorMarker, read only from a pre-migration registry. */")
  out.push("  readonly anchorOccurrence?: number")
  out.push("}")
  out.push("/** Region markers that bracket every mpd delta in the adopted plugin. */")
  out.push("export const MPD_DELTA_MARKERS = {")
  out.push('    begin: (id) => `//#region ${id} (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)`,')
  out.push("    end: (id) => `//#endregion ${id}`,")
  out.push("};")
  out.push("/**")
  out.push(" * Every mpd delta in file order, addressed by the CONTEXT PAIR that brackets")
  out.push(" * its seam: `beforeContext` is the shortest window ending at the last")
  out.push(" * region-stripped-skeleton line before the seam that occurs exactly once in")
  out.push(" * that skeleton, `afterContext` the shortest such window starting at the first")
  out.push(" * line after it. Both halves live OUTSIDE every region, so no insertion — in")
  out.push(" * this pass or in any earlier heal — can rewrite them: the pair is exact under")
  out.push(" * any insertion history, which the wave-2 line-keyed `anchor` fields were not.")
  out.push(" * @type {Array<{file: string, id: string, beforeContext: string[], afterContext: string[], block: string}>}")
  out.push(" */")
  out.push("export const MPD_DELTAS = [")
  for (const entry of entries) {
    out.push("    {")
    out.push(`        file: ${JSON.stringify(entry.file)},`)
    out.push(`        id: ${JSON.stringify(entry.id)},`)
    out.push("        beforeContext: [")
    for (const line of entry.beforeContext) out.push(`            ${JSON.stringify(line)},`)
    out.push("        ],")
    out.push("        afterContext: [")
    for (const line of entry.afterContext) out.push(`            ${JSON.stringify(line)},`)
    out.push("        ],")
    out.push(`        block: ${JSON.stringify(entry.block)},`)
    out.push("    },")
  }
  out.push("];")
  out.push("")
  writeFileSync(registryFile, out.join("\n"))
  return { file: registryFile, regions: entries.length }
}

/**
 * CLI entry point: dispatch `--check` (the default), `--write` or `--write-registry`.
 * An unknown flag exits 2, a refusal exits 1 naming the offending region, and a
 * successful verify/apply prints its summary and exits 0.
 * @returns nothing; the process exits with the run's status code.
 */
function main(): void {
  /** Raw command-line arguments after the script path. */
  const args = process.argv.slice(2)
  /** Arguments this flag table does not know; any of them refuses the whole run. */
  const unknown = args.filter((arg: string): boolean => arg !== "--check" && arg !== "--write" && arg !== "--write-registry")
  if (unknown.length > 0) {
    console.error(`[patch-agent-teams-fixes] FAIL: unknown argument(s): ${unknown.join(", ")} (supported: --check, --write, --write-registry)`)
    process.exit(2)
  }
  try {
    if (args.includes("--write-registry")) {
      /** The registry regeneration report. */
      const result = writeRegistry()
      console.log(`[patch-agent-teams-fixes] registry regenerated: ${relative(repoRoot, result.file)} (${result.regions} regions)`)
      // The freshly written registry is only visible to a NEW process (MPD_DELTAS
      // was already imported), so a registry write never also verifies in-process.
      process.exit(0)
    }
    /** The apply/verify report for the requested mode. */
    const result = applyAgentTeamsFixes({ write: args.includes("--write") })
    console.log(
      `[patch-agent-teams-fixes] ${result.status === "applied" ? "applied" : "already applied"}: ${result.regions} mpd delta region(s) across ${result.files.length} adopted file(s)`
      + (result.inserted.length > 0 ? ` (inserted: ${result.inserted.join(", ")})` : ""),
    )
    process.exit(0)
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error))
    process.exit(1)
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
