// §7.2/§7.3 — the FILE layer of the `mpd` settings namespace, read for DIVERGENCE only.
//
// T-18's measured fact: a `.mpd/mpd.jsonc` edit reaches a process only at the NEXT boot (the
// namespace's file-derived base is fixed for the process lifetime), so the honest fix is not to
// re-register anything but to SAY SO — per knob, what the process is running with, what the file
// says, and whether a restart is required. The running value comes from the settings namespace
// (through the adapter); the FILE value comes from here.
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
  let out = ""
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
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
  const path = join(workspace, PROJECT_CONFIG_FILE)
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return { found: false, path, section: undefined }
  }
  try {
    const parsed = JSON.parse(stripTrailingCommas(stripJsonComments(text))) as Record<string, unknown>
    const root = parsed !== null && typeof parsed === "object" ? parsed : {}
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
