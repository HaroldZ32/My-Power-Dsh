// §7.2/§7.3 — the FILE layer of the `mpd` settings namespace.
//
// T-18's measured fact: a `.mpd/mpd.jsonc` edit reaches a process's `mpd` NAMESPACE only at the
// NEXT boot (the namespace's file-derived base is fixed for the process lifetime). Wave 2's user
// ruling is that the knobs are DATA and must therefore be live in-process, so this file is no
// longer read for DIVERGENCE only: the engine calls `readWatchdogSection` on every knob refresh,
// and when the file is the layer that MOVED, its stated leaves are overlaid onto the namespace
// value the knobs are resolved from (see `overlayWatchdogSection` in `machine.ts`). The
// divergence reading stays as the honest residue — a value the running process is NOT using.
//
// This module reads the workspace's own config file (never `DSH_HOME`, never a session log) and
// is defensive by construction: a missing file, a comment, a trailing comma or a malformed value
// degrades to "the file states nothing", which can only ever SUPPRESS a divergence report — it
// can never invent one, and it can never throw into a tick or a render path.
import { readFileSync } from "node:fs"
import { join } from "node:path"

/** The project-layer config file, relative to the workspace (mpd-config's own default). */
export const PROJECT_CONFIG_FILE = join(".mpd", "mpd.jsonc")

/**
 * Strip `//` and multi-line comments from a JSONC document, respecting string literals.
 *
 * A hand-rolled scanner rather than a regex: `//` inside a string value (a URL, a path) must
 * survive, and the plugin must not add a dependency for this.
 */
export function stripJsonComments(text: string): string {
  // The comment-free document accumulated so far, returned verbatim once the scan ends.
  let out = ""
  // Whether the scanner is currently inside a double-quoted string literal.
  let inString = false
  // Whether the previous string character was a backslash, so the next quote does not close the string.
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    // The character under the cursor.
    const char = text[index]
    // The character after the cursor, used to recognise a `//` or `/*` opener.
    const next = text[index + 1]
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1
      out += "\n"
      continue
    }
    if (char === "/" && next === "*") {
      index += 2
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1
      index += 1
      continue
    }
    out += char
  }
  return out
}

/** Remove trailing commas before `}` or `]` (JSONC's other well-known liberty). */
export function stripTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, "$1")
}

/**
 * Parse the `watchdog` section out of one workspace's `.mpd/mpd.jsonc`.
 *
 * @param workspace - the workspace root (resolved per call by the caller).
 * @returns `{found, path, section}` — `found:false` for a missing/unreadable/malformed file, and
 *          `section:undefined` when the file exists but states no `watchdog` object.
 */
export function readWatchdogSection(workspace: string): { found: boolean; path: string; section: unknown } {
  // Absolute path of the project config file inside the caller's workspace.
  const path = join(workspace, PROJECT_CONFIG_FILE)
  // Raw file text when readable; an unreadable file leaves through the `found:false` return below.
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return { found: false, path, section: undefined }
  }
  try {
    // The parsed document, typed as an open record because a JSONC file is untrusted input.
    const parsed = JSON.parse(stripTrailingCommas(stripJsonComments(text))) as Record<string, unknown>
    // The document object itself, or an empty record when the top-level value is not an object.
    const root = parsed !== null && typeof parsed === "object" ? parsed : {}
    // The raw `watchdog` value as the file states it, before any shape check.
    const section = (root as Record<string, unknown>).watchdog
    return {
      found: true,
      path,
      section: section !== null && typeof section === "object" ? section : undefined,
    }
  } catch {
    // A malformed file states nothing: reporting a divergence from a broken document would be a
    // guess, and the honest reading of an unparsable file is "no file statement".
    return { found: false, path, section: undefined }
  }
}
