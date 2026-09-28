// Settings → mpd.jsonc write-back bridge (t34 design §A/§B/§2, captain rulings 1-3).
//
// The host settings namespace `mpd` is registered by `packages/mpd-tui-plugin`
// (captain ruling); THIS module never registers it — it reads the resolved/user
// section through the adapter's settings seam and owns the FILE write-back:
//
//   front door edits ns "mpd"
//     -> settings/document-updated(ns, revision) with source === 'update'
//     -> changed leaves -> target set = DISTINCT live session roots (never process.cwd())
//     -> per root: refuse-first surgical edit under compare-and-swap + atomic rename
//     -> per-root report, `applies: 'restart'` recorded, every failure named
//
// REFUSE-FIRST (design §B): a target the editor cannot prove is left
// BYTE-UNTOUCHED and reported with a named reason; the settings write is never
// rolled back or blocked by a file problem.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { readJsonc, surgicalEdit, type JsoncEditFailure } from "./jsonc-edit"

/** One leaf to write, expressed as a decoded key path plus its value. */
export interface BridgeLeaf {
  /** Decoded key path from the settings root down to this leaf, one segment per level. */
  readonly path: readonly string[]
  /** The value exactly as the settings document holds it; arrays and objects are written whole. */
  readonly value: unknown
}

/**
 * The named refusal reasons of design §10.3 — the reason, never the prose, is what a
 * lane and a unit test assert on.
 */
export type RefusalReason =
  | "no-live-session"
  | "ambiguous-multi-root"
  | "disabled"
  | "no-changes"
  | "unparsable"
  | "span-not-proven"
  | "ambiguous-intermediate"
  | "read-only"
  | "conflict"
  | "unsupported-shape"

/** How ONE root's write attempt ended; `written` and `created` are the only outcomes that changed bytes. */
export type RootOutcome = "written" | "unchanged" | "created" | "denied" | "conflict" | "unparsable" | "refused"

/** One root's attempt: which root and file it targeted, how it ended, and (when refused) why. */
export interface RootResult {
  /** The live session workspace root this attempt belongs to, as it was resolved at event time. */
  readonly root: string
  /** Absolute path of the file the attempt targeted — the root's `.mpd/mpd.jsonc`, or the row override. */
  readonly file: string
  /** How the attempt ended; `denied`, `conflict`, `unparsable` and `refused` all leave the file untouched. */
  readonly outcome: RootOutcome
  /** Named edit failure (refuse-first) or the errno code. */
  readonly reason?: string
  /** Human-readable detail for a warning line. */
  readonly detail?: string
  /**
   * PROVEN-but-notable facts the write must still report loudly (captain's ruling on duplicate
   * keys: the edit succeeds and the diagnostic names every occurrence line).
   */
  readonly notes?: readonly { reason: string; detail: string; lines?: readonly number[] }[]
}

/** What one write-back did: the files it changed, a per-root outcome each, and why nothing was attempted. */
export interface BridgeReport {
  /** Files that actually changed on disk. */
  readonly writtenTo: readonly string[]
  /** Every target attempted, with its own outcome (never collapsed into one boolean). */
  readonly results: readonly RootResult[]
  /** Present when no file was attempted at all (design §10.3 refusal reasons). */
  readonly skipped?: RefusalReason
  /** The candidate roots behind an `ambiguous-multi-root` refusal, in live order. */
  readonly candidates?: readonly string[]
  /** The behaviour-change timing for the saved value (design §D.1). */
  readonly applies: "restart"
}

/** The writer's configurable knobs (row config `settingsBridge`). */
export interface BridgeOptions {
  /** Master switch; the QA lane's negative control flips this to false (captain ruling 2). */
  readonly writeBack: boolean
  /** Compare-and-swap retries before reporting `conflict` (design §B.2/E8). */
  readonly retries: number
  /**
   * Test-only observation hook, fired between the in-memory edit and the
   * compare-and-swap re-read — it exists so a unit test can prove the conflict path
   * (a human edit landing mid-write) without racing a real process. Production
   * callers never pass it.
   */
  readonly hooks?: { readonly beforeCas?: (file: string) => void }
}

/** Row-config defaults: write-back ON, with three compare-and-swap retries before a conflict is reported. */
export const DEFAULT_BRIDGE_OPTIONS: BridgeOptions = { writeBack: true, retries: 3 }

/** Header written when the bridge creates a missing target file (design §B.2/E10). */
export function createdFileHeader(now: Date = new Date()): string {
  return `// mpd.jsonc — written by the mpd settings bridge (${now.toISOString()})\n// Comments and key order are preserved: the bridge rewrites only the values it is asked to change.\n`
}

/**
 * Decide the write target from the DISTINCT LIVE WORKSPACE ROOTS at event time
 * (design §A.1 / §10.3 / D-5):
 *
 *   1 root  -> write that root (the only unambiguous attribution)
 *   0 roots -> refuse `no-live-session`, persist nothing
 *   N roots -> refuse `ambiguous-multi-root` and name every candidate
 *
 * `process.cwd()` is NEVER a fallback and a fan-out is NEVER performed: t35
 * acceptance A3 forbids silently writing to a guessed path. A session that starts
 * later reads the file at its own mount, so no push is attempted.
 */
export type TargetDecision =
  | { readonly kind: "write"; readonly targets: readonly { root: string; file: string }[] }
  | { readonly kind: "refuse"; readonly reason: RefusalReason; readonly candidates: readonly string[] }

/** Decide the write target from the live roots; `projectFile` overrides the path only for a SINGLE root. */
export function resolveTargets(roots: readonly string[], projectFile?: string): TargetDecision {
  // Non-string and empty roots are dropped and duplicates collapsed: only DISTINCT live workspaces decide.
  const distinct = [...new Set(roots.filter((root) => typeof root === "string" && root.length > 0))]
  if (distinct.length === 0) return { kind: "refuse", reason: "no-live-session", candidates: [] }
  if (distinct.length > 1) return { kind: "refuse", reason: "ambiguous-multi-root", candidates: distinct }
  return { kind: "write", targets: targetFiles(distinct, projectFile) }
}

/** Flatten a settings section into leaves (arrays and objects are leaf VALUES, never paths). */
export function sectionLeaves(section: unknown, prefix: readonly string[] = []): BridgeLeaf[] {
  if (section === null || typeof section !== "object" || Array.isArray(section)) {
    return prefix.length === 0 ? [] : [{ path: prefix, value: section }]
  }
  // Leaves collected here; a nested object recurses into itself and is never a leaf value.
  const out: BridgeLeaf[] = []
  for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) out.push(...sectionLeaves(value, [...prefix, key]))
    else out.push({ path: [...prefix, key], value })
  }
  return out
}

/**
 * The leaves that need a write-back: the ones a front-door edit ADDED or CHANGED.
 * A leaf the user RESET (present before, absent now) is deliberately NOT a write
 * target — L2 is the durable home, so a reset returns the runtime to the file's
 * value and rewrites nothing (design §1.2/D-2: the file is the authority on reset).
 */
export function changedLeaves(prev: unknown, next: unknown): { written: BridgeLeaf[]; removed: BridgeLeaf[] } {
  // Path identity of a leaf: the joined segments, used as the map/set key below so depths never collide.
  const key = (leaf: BridgeLeaf): string => leaf.path.join("\u0000")
  // The PREVIOUS section's values by identity, so a change is detected by value, not by key presence.
  const before = new Map(sectionLeaves(prev).map((leaf) => [key(leaf), leaf.value]))
  // The leaves the settings document now declares, in document order.
  const after = sectionLeaves(next)
  // Leaves added or changed relative to `prev`, kept in the caller's own order.
  const written: BridgeLeaf[] = []
  for (const leaf of after) {
    if (!before.has(key(leaf)) || JSON.stringify(before.get(key(leaf))) !== JSON.stringify(leaf.value)) written.push(leaf)
  }
  // Identities still present after the edit; a previous leaf missing here was REMOVED.
  const afterKeys = new Set(after.map(key))
  // Removed leaves are reported but never written: on a reset the file stays the authority (design §1.2/D-2).
  const removed = sectionLeaves(prev).filter((leaf) => !afterKeys.has(key(leaf)))
  return { written, removed }
}

/** The distinct target files for a set of live roots (design §A.1: never a guessed root). */
export function targetFiles(roots: readonly string[], projectFile?: string): { root: string; file: string }[] {
  // Files already emitted, so two roots resolving to the same file yield ONE entry.
  const seen = new Set<string>()
  // One entry per distinct target file, in the order the roots were given.
  const out: { root: string; file: string }[] = []
  for (const root of roots) {
    // The row override applies to a SINGLE root only; several roots always resolve per root, never guessed.
    const file = projectFile !== undefined && roots.length === 1 ? projectFile : join(root, ".mpd", "mpd.jsonc")
    if (seen.has(file)) continue
    seen.add(file)
    out.push({ root, file })
  }
  return out
}

/** The POSIX errno code carried by a caught value, or undefined when it carries none. */
function errnoOf(error: unknown): string | undefined {
  // Read defensively: a thrown value need not be an object at all.
  const code = (error as { code?: unknown } | undefined)?.code
  return typeof code === "string" ? code : undefined
}

/** Whether a file can be written at all (used to report `denied` without touching it). */
export function isWritableFile(file: string): { ok: true } | { ok: false; reason: string; detail: string } {
  try {
    // stat also proves existence; a MISSING file is answered by the catch below, never here.
    const info = statSync(file)
    // Permission bits of the existing target, tested for ANY write bit (0o222) just below.
    const mode = info.mode
    // 0o222 = any write bit; root can still write a 0444 file, but a read-only
    // target must be REPORTED as denied rather than silently written (design E11).
    if ((mode & 0o222) === 0) return { ok: false, reason: "EACCES", detail: "the target file has no write bit set" }
    return { ok: true }
  } catch (error) {
    if (existsSync(file)) return { ok: false, reason: errnoOf(error) ?? "EACCES", detail: String((error as Error)?.message ?? error) }
    // Missing file: writable when its directory exists (or can be created).
    const dir = dirname(file)
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      return { ok: true }
    } catch (error2) {
      return { ok: false, reason: errnoOf(error2) ?? "EACCES", detail: `cannot create ${dir}: ${String((error2 as Error)?.message ?? error2)}` }
    }
  }
}

/**
 * Apply one leaf per root with refuse-first semantics, compare-and-swap and an
 * atomic rename. Pure with respect to the settings layer: it never touches it.
 * @param targets - the resolved target files (see {@link targetFiles}).
 * @param leaves - the leaves to write, in order.
 * @param options - writer options.
 * @returns a per-root report; a failure on one root never hides another's success.
 */
export function writeBackLeaves(
  targets: readonly { root: string; file: string }[],
  leaves: readonly BridgeLeaf[],
  options: BridgeOptions = DEFAULT_BRIDGE_OPTIONS,
): BridgeReport {
  if (!options.writeBack) return { writtenTo: [], results: [], skipped: "disabled", applies: "restart" }
  if (leaves.length === 0) return { writtenTo: [], results: [], skipped: "no-changes", applies: "restart" }
  if (targets.length === 0) return { writtenTo: [], results: [], skipped: "no-live-session", applies: "restart" }

  // Per-root outcomes, appended in target order; one root's failure never hides another's success.
  const results: RootResult[] = []
  // Files whose bytes actually changed, in the order they were written.
  const writtenTo: string[] = []
  for (const target of targets) {
    // Compare-and-swap attempts already spent on THIS root; a conflicting re-read reruns the loop.
    let attempt = 0
    // Whether this root reached a final outcome; the retry loop runs until it is true.
    let settled = false
    while (!settled && attempt <= options.retries) {
      attempt += 1
      // Re-read per attempt: the target may be created or deleted between CAS retries.
      const existed = existsSync(target.file)
      // The bytes the CAS compares against: the file's content, or a fresh header plus an empty object.
      let raw: string
      if (existed) {
        // Refuse-first: a target with no write bit is REPORTED as denied without a single write.
        const writable = isWritableFile(target.file)
        if (!writable.ok) {
          // §B.2/E11 names the STATUS `denied` and §10.3 names the REASON `read-only`; both
          // appear, so a lane can assert on either without inventing a synonym.
          results.push({ root: target.root, file: target.file, outcome: "denied", reason: writable.reason === "EACCES" || writable.reason === "EPERM" ? "read-only" : writable.reason, detail: writable.detail })
          settled = true
          break
        }
        try {
          raw = readFileSync(target.file, "utf8")
        } catch (error) {
          results.push({ root: target.root, file: target.file, outcome: "denied", reason: errnoOf(error) ?? "EACCES", detail: String((error as Error)?.message ?? error) })
          settled = true
          break
        }
        // Unparsable input is never repaired: the root is reported and left byte-untouched.
        const parsed = readJsonc(raw)
        if (parsed.ok !== true) {
          results.push({ root: target.root, file: target.file, outcome: "unparsable", reason: "unparsable", detail: parsed.detail ?? "the file is not valid JSONC" })
          settled = true
          break
        }
      } else {
        raw = createdFileHeader() + "{\n}\n"
      }

      // Apply every leaf to the in-memory text; the FIRST refusal aborts this root.
      let text = raw
      // The first leaf the editor could not prove; undefined means every leaf applied in memory.
      let refused: { reason: JsoncEditFailure; detail?: string } | undefined
      // Proven-but-notable facts (a duplicated key: the LAST occurrence won), carried out for a warning.
      const notes: { reason: string; detail: string; lines?: readonly number[] }[] = []
      for (const leaf of leaves) {
        // In-memory edit only: the file itself is written at most once, after every leaf is applied.
        const edited = surgicalEdit(text, leaf.path, leaf.value, { insert: true })
        if (edited.ok !== true) {
          refused = { reason: edited.reason, detail: edited.detail }
          break
        }
        // A proven edit may still be notable (a duplicated leaf key: the LAST occurrence won). It is
        // carried out of the writer so the caller warns with the exact lines — never silent.
        if (edited.notes !== undefined) notes.push(...edited.notes.map((note) => ({ reason: note.reason, detail: note.detail, lines: note.lines })))
        text = edited.text
      }
      if (refused !== undefined) {
        results.push({ root: target.root, file: target.file, outcome: "refused", reason: refused.reason, detail: refused.detail })
        settled = true
        break
      }
      if (text === raw) {
        results.push({ root: target.root, file: target.file, outcome: "unchanged" })
        settled = true
        break
      }
      try {
        options.hooks?.beforeCas?.(target.file)
      } catch {
        // a hook must never change the writer's behaviour
      }
      // Compare-and-swap: the bytes must still be what we read (design §B.2/E8).
      if (existed) {
        // Re-read just before the rename; anything other than `raw` means another writer landed.
        let current: string | undefined
        try {
          current = readFileSync(target.file, "utf8")
        } catch {
          current = undefined
        }
        if (current !== raw) {
          if (attempt > options.retries) {
            results.push({ root: target.root, file: target.file, outcome: "conflict", reason: "conflict", detail: `the file changed under the bridge ${attempt} times; left untouched` })
            settled = true
          }
          continue
        }
      }
      // Atomic replace: sibling temp file in the SAME directory, then rename.
      const temp = `${target.file}.mpd-bridge-${process.pid}-${attempt}.tmp`
      try {
        writeFileSync(temp, text, "utf8")
        renameSync(temp, target.file)
      } catch (error) {
        try {
          if (existsSync(temp)) unlinkSync(temp)
        } catch {
          // best effort
        }
        // The errno of the failed temp write or rename decides `denied` vs `refused` just below.
        const code = errnoOf(error)
        results.push({
          root: target.root,
          file: target.file,
          outcome: code === "EACCES" || code === "EPERM" ? "denied" : "refused",
          reason: code ?? "unwritable",
          detail: String((error as Error)?.message ?? error),
        })
        settled = true
        break
      }
      results.push({ root: target.root, file: target.file, outcome: existed ? "written" : "created", ...(notes.length === 0 ? {} : { notes }) })
      writtenTo.push(target.file)
      settled = true
    }
  }
  return { writtenTo, results, applies: "restart" }
}

/** Flatten a settings user section into leaves (only the paths the section declares). */
export function leavesFromSection(section: unknown, paths: readonly (readonly string[])[]): BridgeLeaf[] {
  // One leaf per requested path the section actually declares; a missing path contributes nothing.
  const leaves: BridgeLeaf[] = []
  for (const path of paths) {
    // Walked down the path; undefined means the section stops declaring it somewhere.
    let cursor: unknown = section
    for (const segment of path) {
      if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) {
        cursor = undefined
        break
      }
      cursor = (cursor as Record<string, unknown>)[segment]
    }
    if (cursor !== undefined) leaves.push({ path, value: cursor })
  }
  return leaves
}
