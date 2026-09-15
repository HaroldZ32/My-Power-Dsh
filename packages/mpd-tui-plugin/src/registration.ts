// Runtime registration of the log-only session event type (iron rule 2).
//
// A plugin that appends its own event type must make that type KNOWN to every
// reachable dsh-session copy before appending: the strict read paths (resume
// seed validation, persistence load) refuse a log carrying an unknown,
// non-ignorable type — which would make the user's session UNRESUMABLE.
//
// This module is deliberately stricter than the ecosystem template
// (`dsh-working-activity/src/registration.ts`): it registers AND VERIFIES, and
// the caller appends only when verification succeeded. The template's anchors
// (`import.meta.url`, `process.argv[1]`) do not resolve the harness copy in a
// bundle install (the bundle is linked into `<profile>/node_modules`, and the
// bin path has no reachable `@deepseek-ai/dsh-session`), so this module also
// probes each composed profile directory, which is where the live copy is
// resolvable from.
import { createRequire } from "node:module"
import { readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Log } from "./log.js"

/** The type this plugin appends (see `session-events.d.ts`). */
export const BOARD_OPENED_EVENT = "mpd-tui/board-opened"

interface KnownTypesModule {
  KNOWN_SESSION_EVENT_TYPES?: Set<string>
}

/**
 * Candidate `createRequire` anchors, most specific first.
 * @param env - environment (testing).
 * @param home - home directory (testing).
 * @returns deduplicated anchor paths; unresolvable ones are simply skipped later.
 */
export function candidateAnchors(env: Record<string, string | undefined> = process.env, home: string = homedir()): string[] {
  const anchors: string[] = []
  try {
    anchors.push(fileURLToPath(import.meta.url))
  } catch {
    // A non-file module URL (bundled embedder): the remaining anchors still apply.
  }
  const argv1 = process.argv[1]
  if (typeof argv1 === "string" && argv1.length > 0) anchors.push(argv1)
  const homes: string[] = []
  if (typeof env.DSH_HOME === "string" && env.DSH_HOME.length > 0) homes.push(env.DSH_HOME)
  homes.push(join(home, ".dsh"), join(home, ".dsh-tui"))
  for (const root of homes) {
    const profiles = join(root, "profiles")
    try {
      for (const entry of readdirSync(profiles, { withFileTypes: true })) {
        if (entry.isDirectory()) anchors.push(join(profiles, entry.name, "package.json"))
      }
    } catch {
      // No profiles directory under this home: nothing to probe here.
    }
  }
  return [...new Set(anchors)]
}

/**
 * Add one type to a resolved dsh-session copy's known vocabulary.
 * @param moduleLike - a resolved `@deepseek-ai/dsh-session` module namespace.
 * @param type - the event type.
 * @returns true when the type is present in that copy's set afterwards.
 */
export function registerInto(moduleLike: unknown, type: string): boolean {
  const set = (moduleLike as KnownTypesModule | null | undefined)?.KNOWN_SESSION_EVENT_TYPES
  if (!(set instanceof Set)) return false
  try {
    if (set.has(type)) return true
  } catch {
    return false
  }
  try {
    set.add(type)
  } catch {
    // Frozen/forbidden set: report what is actually true afterwards.
  }
  try {
    return set.has(type) === true
  } catch {
    return false
  }
}

/**
 * Register the log-only event type in every reachable dsh-session copy.
 * Never throws; a copy that cannot be resolved is skipped.
 * @param type - the event type.
 * @param log - diagnostics.
 * @returns true when at least one copy verified the type as known.
 */
export function registerLogOnlyEventType(type: string, log: Log): boolean {
  let verified = false
  let resolved = 0
  for (const anchor of candidateAnchors()) {
    try {
      const required = createRequire(anchor)("@deepseek-ai/dsh-session") as unknown
      resolved += 1
      if (registerInto(required, type)) verified = true
    } catch {
      // This anchor cannot resolve the harness copy — try the next one.
    }
  }
  log.debug(`session event type ${type}: ${verified ? "registered" : "NOT registered"} (${resolved} dsh-session copy/copies reached)`)
  return verified
}
