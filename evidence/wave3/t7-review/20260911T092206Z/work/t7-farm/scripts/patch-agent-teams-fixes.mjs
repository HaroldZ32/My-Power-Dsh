#!/usr/bin/env node
// patch-agent-teams-fixes.mjs — re-apply guard for the mpd LOCAL ADAPTATION deltas in the
// adopted agent-teams plugin (packages/mpd-agent-teams-plugin/lib/**).
//
// Why: `packages/mpd-agent-teams-plugin/lib` is adopted upstream main code (MIT). Our deltas
// there are bracketed by `//#region mpd-delta <id> (mpd LOCAL ADAPTATION; ...)` markers and
// registered in `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js`. A re-vendor / re-materialize
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
//   --write-registry   regenerate lib/mpd-deltas.js from the marked regions in the files
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
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import process from "node:process"
import { MPD_DELTA_MARKERS, MPD_DELTAS } from "../packages/mpd-agent-teams-plugin/lib/mpd-deltas.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Region begin line for one delta id. */
const beginLine = (id) => MPD_DELTA_MARKERS.begin(id)
/** Region end line for one delta id. */
const endLine = (id) => MPD_DELTA_MARKERS.end(id)

/** Every file the registry touches, in registry order. */
export function mpdDeltaFiles() {
  return [...new Set(MPD_DELTAS.map((delta) => delta.file))]
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
 * @returns {{begin: number, end: number, orphan?: "begin"|"end"}|undefined}
 */
export function findRegion(lines, id) {
  const begin = lines.findIndex((line) => line.trim() === beginLine(id))
  const end = lines.findIndex((line) => line.trim() === endLine(id))
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

/** Number of positions where `window` occurs in `haystack` as consecutive lines. */
function countWindow(haystack, window) {
  let count = 0
  for (let at = 0; at + window.length <= haystack.length; at += 1) {
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

/**
 * The file as it looks with EVERY region removed (markers + bodies), plus the
 * skeleton index each region was taken from: its SEAM. Context windows are always
 * computed on this skeleton, never on the canonical file — a canonical-file
 * window can name another region's `//#region` marker line, which does not exist
 * after a strip, and would then be unmatchable exactly when the heal needs it.
 * @returns {{spans: Array<[number, number]>, skeleton: string[], seams: number[]}}
 */
function skeletonView(lines) {
  const spans = regionSpans(lines)
  const skeleton = []
  const seams = []
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
 */
function uniqueWindow(skeleton, seam, side) {
  for (let size = 1; size <= CONTEXT_WINDOW_MAX; size += 1) {
    const start = side === "after" ? seam : seam - size
    const end = side === "after" ? seam + size : seam
    if (start < 0 || end > skeleton.length) break
    const window = skeleton.slice(start, end)
    if (countWindow(skeleton, window) === 1) return window
  }
  return undefined
}

/** Whether one file index lies inside any of `spans`. */
function inSpans(spans, index) {
  return spans.some(([begin, end]) => index >= begin && index <= end)
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
 * @returns {number} index the block is inserted at
 */
function locateSeam(lines, delta, spans, file) {
  const matches = []
  for (let at = 0; at + delta.afterContext.length <= lines.length; at += 1) {
    if (inSpans(spans, at)) continue
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
  const at = matches[0]
  const skipped = []
  let cursor = at
  for (;;) {
    const enclosing = spans.find(([begin, end]) => end === cursor - 1)
    if (enclosing === undefined) break
    skipped.unshift(enclosing)
    cursor = enclosing[0]
  }
  const size = delta.beforeContext.length
  const preceding = lines.slice(Math.max(0, cursor - size), cursor).join("\n")
  if (cursor - size < 0 || preceding !== delta.beforeContext.join("\n")) {
    throw new Error(`[patch-agent-teams-fixes] FAIL: delta "${delta.id}" is MISSING from ${file} and the lines before its afterContext window do not match the registered beforeContext — the adopted file drifted; restore the marked file, or re-establish the region's site and re-run --write-registry — the applier never guesses an insertion site`)
  }
  const selfIndex = MPD_DELTAS.findIndex((item) => item.file === file && item.id === delta.id)
  for (const [begin] of skipped) {
    const match = /\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(lines[begin])
    if (match === null) continue
    const siblingIndex = MPD_DELTAS.findIndex((item) => item.file === file && item.id === match[1])
    if (siblingIndex > selfIndex) return begin
  }
  return at
}

/**
 * Re-bracket a PARTIALLY stripped region whose body is still present byte-for-byte:
 * restore only the missing marker line instead of inserting a second copy of the
 * block. A body that does not match the registered block returns `undefined`, and
 * the caller falls back to dropping the orphan marker and healing from context.
 * @returns {string[]|undefined}
 */
function reBracketOrphan(lines, delta, found) {
  const body = delta.block.split("\n").slice(1, -1)
  if (found.orphan === "end") {
    // The surviving begin marker carries the region's indentation: the restored
    // END marker must be written at that same indent, or the region no longer
    // matches the registered block byte-for-byte.
    const indent = leadingWhitespace(lines[found.begin])
    const expectedBody = expectedLines(delta, indent).slice(1, -1)
    const actual = lines.slice(found.begin + 1, found.begin + 1 + body.length)
    if (actual.length !== expectedBody.length || actual.join("\n") !== expectedBody.join("\n")) return undefined
    const at = found.begin + 1 + body.length
    return [...lines.slice(0, at), `${indent}${endLine(delta.id)}`, ...lines.slice(at)]
  }
  if (found.end - body.length < 0) return undefined
  const actual = lines.slice(found.end - body.length, found.end)
  if (actual.join("\n") !== body.join("\n")) return undefined
  const at = found.end - body.length
  const indent = leadingWhitespace(lines[found.end])
  return [...lines.slice(0, at), `${indent}${beginLine(delta.id)}`, ...lines.slice(at)]
}

/** Leading whitespace of a line (the block's own indentation). */
function leadingWhitespace(line) {
  return line.slice(0, line.length - line.trimStart().length)
}
/**
 * The exact lines this script writes for one region at `indent`: the block is
 * stored at its canonical indentation, so re-indenting strips the BLOCK's own
 * indent (never the target's) before applying the target prefix. At the
 * canonical indentation this is the identity, which is what `--check` relies on.
 */
function expectedLines(delta, indent) {
  const base = leadingWhitespace(delta.block.split("\n")[0] ?? "")
  return delta.block.split("\n").map((line) => {
    if (line === "") return ""
    const body = base !== "" && line.startsWith(base) ? line.slice(base.length) : line
    return `${indent}${body}`
  })
}

/** The registered block's own canonical indentation. */
export function canonicalIndent(delta) {
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
 */
function declaredNames(block) {
  const names = new Set()
  for (const line of block.split("\n")) {
    if (leadingWhitespace(line) !== "") continue
    const match = /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (match !== null) names.add(match[1])
  }
  return [...names]
}

/** Whether a line declares a module-scope (column 0) function/class/const/let/var. */
function declaresName(line, name) {
  return new RegExp(`^(?:export\\s+)?(?:async\\s+)?(?:function|class|const|let|var)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(line)
}

/** Index spans of every region currently in the file. */
function declaredSpans(lines) {
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
 */
function assertNoRedeclaration(lines, delta, file, where) {
  const spans = declaredSpans(lines)
  for (const name of declaredNames(delta.block)) {
    const hits = lines
      .map((line, index) => (declaresName(line, name) && !spans.some(([begin, end]) => index >= begin && index <= end) ? index : -1))
      .filter((index) => index !== -1)
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
 */
export function validateHealedFile(lines, file) {
  for (const delta of MPD_DELTAS.filter((item) => item.file === file)) {
    // Whole-line comparison, the same rule findRegion resolves with: `scope-overlap`
    // is a prefix of `scope-overlap-normalize`, so a substring count would report 2
    // for the outer region on an intact file.
    const occurrences = lines.filter((line) => line.trim() === beginLine(delta.id)).length
    if (occurrences !== 1) {
      throw new Error(`[patch-agent-teams-fixes] FAIL: post-heal validation of ${file}: region "${delta.id}" appears ${occurrences} times (must be exactly 1)`)
    }
    const found = findRegion(lines, delta.id)
    for (const name of declaredNames(delta.block)) {
      const outside = lines
        .map((line, index) => (declaresName(line, name) ? index : -1))
        .filter((index) => index !== -1 && (index < found.begin || index > found.end))
      if (outside.length > 0) {
        throw new Error(
          `[patch-agent-teams-fixes] FAIL: post-heal validation of ${file}: "${name}" is declared both inside region "${delta.id}" and ${outside.length} time(s) outside it (line(s) ${outside.map((index) => index + 1).join(", ")}) — the healed module cannot import`,
        )
      }
    }
  }
}

/**
 * Assert one PRESENT region spans exactly the registered block at its own indent.
 * Throws on any drift so a heal can never "repair" a file into a state that only
 * looks applied.
 */
function assertRegionMatches(lines, delta, file, found) {
  if (found === undefined || found.orphan !== undefined) {
    throw new Error(`[patch-agent-teams-fixes] FAIL: delta "${delta.id}" in ${file} is not present as a complete marker pair after the repair — refusing to report success`)
  }
  const indent = leadingWhitespace(lines[found.begin])
  const expected = expectedLines(delta, indent)
  const actual = lines.slice(found.begin, found.end + 1)
  if (actual.join("\n") !== expected.join("\n")) {
    const firstDiff = actual.findIndex((line, index) => line !== (expected[index] ?? ""))
    throw new Error(
      `[patch-agent-teams-fixes] FAIL: delta "${delta.id}" in ${file} (lines ${found.begin + 1}-${found.end + 1}) no longer matches this script's registered block`
      + ` — first difference at line ${found.begin + 1 + (firstDiff === -1 ? 0 : firstDiff)}`
      + `; either the delta was edited without regenerating lib/mpd-deltas.js (run --write-registry) or a re-vendor rewrote it`,
    )
  }
}

/**
 * The canon orphan row `begin present + end absent + body NOT byte-equal` is a
 * DRIFTED delta, not a missing one: someone edited the region body without
 * regenerating the registry. Dropping the orphan begin marker and healing from
 * context would delete that authored text, so this row refuses — naming the
 * region AND the surviving begin marker's line, with the remedy.
 */
function driftedOrphanError(delta, file, found) {
  return new Error(
    `[patch-agent-teams-fixes] FAIL: delta "${delta.id}" in ${file}: the begin marker at line ${found.begin + 1} has no end marker and the surviving lines are NOT the registered block — the delta was edited without regenerating lib/mpd-deltas.js; restore the marked region, or fix it and run: node scripts/patch-agent-teams-fixes.mjs --write-registry`,
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
 */
export function assertRegistryFormat(entries = MPD_DELTAS) {
  const carriesOldKeys = entries.some((entry) => entry.anchor !== undefined || entry.anchorOccurrence !== undefined || entry.anchorMarker !== undefined)
  const carriesContextPair = entries.every((entry) => Array.isArray(entry.beforeContext) && entry.beforeContext.length > 0
    && Array.isArray(entry.afterContext) && entry.afterContext.length > 0)
  if (carriesOldKeys || !carriesContextPair) {
    throw new Error("[patch-agent-teams-fixes] FAIL: lib/mpd-deltas.js is in the OLD anchor format — run: node scripts/patch-agent-teams-fixes.mjs --write-registry (one-time migration)")
  }
}

/**
 * Apply or verify the registered mpd deltas under `root`.
 * @param {{root?: string, write?: boolean}} [options]
 * @returns {{status: "applied"|"already-applied", files: string[], inserted: string[], regions: number}}
 */
export function applyAgentTeamsFixes({ root = repoRoot, write = false } = {}) {
  assertRegistryFormat()
  const files = mpdDeltaFiles()
  const inserted = []
  let regions = 0
  for (const file of files) {
    const absolute = join(root, file)
    const before = readFileSync(absolute, "utf8")
    let lines = before.split("\n")
    for (const delta of MPD_DELTAS.filter((item) => item.file === file)) {
      regions += 1
      const found = findRegion(lines, delta.id)
      if (found !== undefined && found.orphan === undefined) {
        assertRegionMatches(lines, delta, file, found)
        continue
      }
      // `orphan` names the MISSING marker: "begin" = the end marker survived,
      // "end" = the begin marker survived.
      const orphanAt = found === undefined ? undefined : (found.orphan === "begin" ? found.end : found.begin)
      const survivor = found === undefined
        ? undefined
        : found.orphan === "begin" ? `end marker at line ${found.end + 1}` : `begin marker at line ${found.begin + 1}`
      const partial = survivor === undefined ? "" : ` (partially stripped: the ${survivor} survived and its partner is gone)`
      if (!write) {
        // --check must not advise `--write` for the drifted row: --write refuses it too,
        // so the honest diagnosis is the edit-without-regeneration one.
        if (found !== undefined && found.orphan === "end" && reBracketOrphan(lines, delta, found) === undefined) {
          throw driftedOrphanError(delta, file, found)
        }
        throw new Error(`[patch-agent-teams-fixes] FAIL: delta "${delta.id}" is MISSING from ${file}${partial} (verify-only mode) — a re-vendor dropped it; re-run with --write to restore it from lib/mpd-deltas.js`)
      }
      if (found !== undefined) {
        // PARTIAL strip: restore the missing marker around an intact body when we
        // can, so the repair is a marker fix and never a second copy of the code.
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
        lines = [...lines.slice(0, orphanAt), ...lines.slice(orphanAt + 1)]
      }
      assertNoRedeclaration(lines, delta, file, "insertion")
      // The site comes from the registered before/after CONTEXT PAIR only: both
      // halves are lines OUTSIDE every region, so no earlier insertion in this pass
      // (or in any past heal) can rewrite them, and the seam they bracket is
      // invariant. A pair that is not unique, or that does not bracket a seam,
      // refuses instead of guessing — that is the wave-2 order-dependence fix.
      const seam = locateSeam(lines, delta, skeletonView(lines).spans, file)
      lines = [...lines.slice(0, seam), ...delta.block.split("\n"), ...lines.slice(seam)]
      inserted.push(delta.id)
    }
    // Post-validation of the HEALED file: exact content is already asserted per
    // region above; this refuses a heal that would leave a duplicate declaration.
    if (write)
      validateHealedFile(lines, file)
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

/** Every region span currently in one file, as `[begin, end]` index pairs. */
function regionSpans(lines) {
  const spans = []
  let index = 0
  while (index < lines.length) {
    const begin = lines.findIndex((line, at) => at >= index && /^\s*\/\/#region mpd-delta [A-Za-z0-9-]+ \(/.test(line))
    if (begin === -1) break
    const id = /\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(lines[begin])[1]
    const end = lines.findIndex((line, at) => at > begin && line.trim() === endLine(id))
    if (end === -1) throw new Error(`[patch-agent-teams-fixes] FAIL: unterminated region "${id}"`)
    spans.push([begin, end])
    index = end + 1
  }
  return spans
}

/** Regenerate lib/mpd-deltas.js from the marked regions in the adopted files. */
export function writeRegistry() {
  const registryFile = join(repoRoot, "packages/mpd-agent-teams-plugin/lib/mpd-deltas.js")
  const out = []
  const entries = []
  for (const file of mpdDeltaFiles()) {
    const lines = readFileSync(join(repoRoot, file), "utf8").split("\n")
    // Spans and skeleton are computed ONCE per file: recomputing them after each
    // entry would let an already-processed region's body contaminate the next
    // entry's uniqueness count.
    const { spans, skeleton, seams } = skeletonView(lines)
    for (let index = 0; index < spans.length; index += 1) {
      const [begin, end] = spans[index]
      const match = /\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(lines[begin])
      if (match === null) throw new Error(`[patch-agent-teams-fixes] FAIL: unreadable region marker at ${file}:${begin + 1}`)
      const id = match[1]
      const block = lines.slice(begin, end + 1).join("\n")
      const beforeContext = uniqueWindow(skeleton, seams[index], "before")
      const afterContext = uniqueWindow(skeleton, seams[index], "after")
      if (beforeContext === undefined || afterContext === undefined) {
        const missing = beforeContext === undefined ? "beforeContext" : "afterContext"
        throw new Error(`[patch-agent-teams-fixes] FAIL: no ${missing} window for region "${id}" in ${file} is unique in the region-stripped skeleton within ${CONTEXT_WINDOW_MAX} lines — refusing to register a far-away or ambiguous anchor (that fallback is exactly the wave-2 order-dependence bug)`)
      }
      entries.push({ file, id, beforeContext, afterContext, block })
    }
  }
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

function main() {
  const args = process.argv.slice(2)
  const unknown = args.filter((arg) => arg !== "--check" && arg !== "--write" && arg !== "--write-registry")
  if (unknown.length > 0) {
    console.error(`[patch-agent-teams-fixes] FAIL: unknown argument(s): ${unknown.join(", ")} (supported: --check, --write, --write-registry)`)
    process.exit(2)
  }
  try {
    if (args.includes("--write-registry")) {
      const result = writeRegistry()
      console.log(`[patch-agent-teams-fixes] registry regenerated: ${relative(repoRoot, result.file)} (${result.regions} regions)`)
      // The freshly written registry is only visible to a NEW process (MPD_DELTAS
      // was already imported), so a registry write never also verifies in-process.
      process.exit(0)
    }
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
