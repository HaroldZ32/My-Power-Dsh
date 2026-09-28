// mpd adaptation: inline the upstream record-type-guard (one-liner) to drop the workspace dep.
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null }
import type { ApplyPatchAccumulator, ApplyPatchFileMetadata, CheckerEdit } from "./types"



/**
 * Recovers the text substitutions one `apply_patch` call performed.
 * @param details - the tool result's `details` payload, which may already carry per-file metadata.
 * @param args - the tool arguments; their patch text is parsed only when the metadata is empty.
 * @returns the edits, metadata first; an empty array when neither source yields one.
 */
export function extractApplyPatchEdits(
  details: unknown,
  args?: Record<string, unknown>,
): CheckerEdit[] {
  /** The substitutions the result metadata already reports, with deletions dropped. */
  const metadataEdits = getApplyPatchMetadataFiles(details)
    .filter((file) => file.type?.toLowerCase() !== "delete")
    .map((file) => ({
      filePath: file.movePath ?? file.filePath,
      before: file.before,
      after: file.after,
    }))

  if (metadataEdits.length > 0) return metadataEdits

  /** The raw patch text the call carried, when it carried one. */
  const patch = args === undefined ? undefined : getString(args, ["patchText", "input", "patch", "command"])
  if (patch === undefined) return []

  return parseApplyPatchRequests(patch)
}

/**
 * Reads the per-file metadata out of an `apply_patch` result.
 * @param details - the tool result's `details` payload.
 * @returns the file entries, from the first of the three shapes the harness has used that yields any.
 */
export function getApplyPatchMetadataFiles(details: unknown): ApplyPatchFileMetadata[] {
  if (!isRecord(details)) return []

  /** Entries found directly under `details.files`. */
  const direct = readApplyPatchMetadataFiles(details["files"])
  if (direct.length > 0) return direct

  /** The `details.result` payload, the second place the harness has put the file list. */
  const resultDetails = details["result"]
  /** Entries found under `details.result.files`; empty when that payload is not a record. */
  const result = isRecord(resultDetails) ? readApplyPatchMetadataFiles(resultDetails["files"]) : []
  if (result.length > 0) return result

  /** The `details.metadata` payload, the third place the harness has put the file list. */
  const metadataDetails = details["metadata"]
  return isRecord(metadataDetails) ? readApplyPatchMetadataFiles(metadataDetails["files"]) : []
}

/**
 * Normalises one metadata file list into typed entries.
 * @param value - the candidate list; anything that is not an array yields nothing.
 * @returns the accepted entries, in payload order, with malformed entries dropped.
 */
export function readApplyPatchMetadataFiles(value: unknown): ApplyPatchFileMetadata[] {
  if (!Array.isArray(value)) return []

  /** The accepted entries, in payload order. */
  const files: ApplyPatchFileMetadata[] = []
  for (const item of value) {
    if (!isRecord(item)) continue

    /** Path of this entry, under any of the key spellings the harness has used. */
    const filePath = getString(item, ["filePath", "file_path", "path"])
    /** Move destination recorded by this entry, when it has one. */
    const movePath = getString(item, ["movePath", "move_path"])
    /** The entry's pre-patch content. */
    const before = getString(item, ["before", "old", "oldString", "old_string"])
    /** The entry's post-patch content. */
    const after = getString(item, ["after", "new", "newString", "new_string"])
    /** The entry's operation name, which is what marks a deletion. */
    const type = getString(item, ["type", "operation"])

    if (filePath === undefined || before === undefined || after === undefined) continue

    files.push({
      filePath,
      before,
      after,
      ...(movePath === undefined ? {} : { movePath }),
      ...(type === undefined ? {} : { type }),
    })
  }

  return files
}

/**
 * Parses a `*** Begin Patch` body into substitutions.
 * @param patch - the raw patch text.
 * @returns one edit per add/update section; delete sections are recognised but yield nothing.
 */
export function parseApplyPatchRequests(patch: string): CheckerEdit[] {
  /** The substitutions collected so far, in patch order. */
  const edits: CheckerEdit[] = []
  /** The file section being accumulated, undefined between sections. */
  let current: ApplyPatchAccumulator | undefined

  /** Closes the open section, turning it into an edit; a no-op when none is open. */
  const flush = (): void => {
    if (current === undefined) return

    if (current.operation === "add") {
      /** The added file's body; an empty body produces no edit. */
      const after = joinPatchLines(current.newLines)
      if (after.length > 0) {
        edits.push({ filePath: current.filePath, before: "", after })
      }
    }

    if (current.operation === "update") {
      /** The updated file's new body, recorded at its moved path when the section moves the file. */
      const after = joinPatchLines(current.newLines)
      if (after.length > 0) {
        edits.push({
          filePath: current.movePath ?? current.filePath,
          before: joinPatchLines(current.oldLines),
          after,
        })
      }
    }

    current = undefined
  }

  for (const line of patch.split(/\r?\n/)) {
    if (line === "*** Begin Patch" || line === "*** End Patch") continue

    if (line.startsWith("*** Add File: ")) {
      flush()
      current = makeAccumulator("add", line.slice("*** Add File: ".length).trim())
      continue
    }

    if (line.startsWith("*** Update File: ")) {
      flush()
      current = makeAccumulator("update", line.slice("*** Update File: ".length).trim())
      continue
    }

    if (line.startsWith("*** Delete File: ")) {
      flush()
      current = makeAccumulator("delete", line.slice("*** Delete File: ".length).trim())
      continue
    }

    if (line.startsWith("*** Move to: ")) {
      if (current?.operation === "update") {
        current.movePath = line.slice("*** Move to: ".length).trim()
      }
      continue
    }

    if (current === undefined || line.startsWith("@@")) continue

    if (current.operation === "add") {
      if (line.startsWith("+")) current.newLines.push(line.slice(1))
      continue
    }

    if (current.operation === "update") {
      if (line.startsWith("-")) current.oldLines.push(line.slice(1))
      if (line.startsWith("+")) current.newLines.push(line.slice(1))
    }
  }

  flush()
  return edits
}

/**
 * Starts an empty accumulator for one patch section.
 * @param operation - the operation named by the section header.
 * @param filePath - the path the section header named.
 * @returns a buffer for that section, with no lines collected yet.
 */
export function makeAccumulator(
  operation: ApplyPatchAccumulator["operation"],
  filePath: string,
): ApplyPatchAccumulator {
  return {
    operation,
    filePath,
    oldLines: [],
    newLines: [],
  }
}

/**
 * Reads the first string-valued key of a record.
 * @param input - the record to read from.
 * @param keys - candidate key spellings, tried in order.
 * @returns the first string value found, or undefined when none of the keys holds one.
 */
export function getString(input: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    /** The candidate value under the current key, of any type. */
    const value = input[key]
    if (typeof value === "string") return value
  }

  return undefined
}

/**
 * Joins collected patch lines into file content.
 * @param lines - the lines, without their leading `+`/`-`/space marker.
 * @returns the lines newline-terminated, or an empty string when there are none.
 */
export function joinPatchLines(lines: readonly string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`
}
