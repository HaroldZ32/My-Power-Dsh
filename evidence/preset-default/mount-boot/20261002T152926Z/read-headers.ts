// Evidence driver: decode the sandbox session store's `session` header records, which is where a
// TUI boot RECORDS the agent preset it actually resolved (never the model's or the pane's prose).
//
// WHY IT EXISTS: the store is keyed by project key, and a sandbox root can hold sessions under the
// REAL-repo key as well (measured during this lane: `<sandbox>/dshhome/sessions` contained a
// `--home-…-My-Power-Dsh--` key because the first boot had no workspace target). Reading every key
// would report the wrong run's witness, so the caller pins the sandbox key explicitly.
//
// Usage: node evidence/preset-default/mount-boot/<ts>/read-headers.ts <sandbox-root>
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"
import { readSessionHeaders, sandboxProjectKey } from "../../../../skills/dsh-qa/scripts/lib/tui-lane.ts"
import { readSessionEvents } from "../../../../skills/dsh-qa/scripts/lib/session-evidence.ts"

/** This driver's own directory, so the repo root is derived rather than hardcoded. */
const HERE: string = dirname(fileURLToPath(import.meta.url))
/** The repository root, four directories above `<root>/evidence/preset-default/mount-boot/<ts>/`. */
const REPO: string = resolve(HERE, "..", "..", "..", "..")
// The sandbox root to read: the caller's first argument, else a sibling `sandbox/`.
/** The sandbox root whose session store is decoded. */
const ROOT: string = resolve(process.argv[2] ?? join(HERE, "sandbox"))
/** The project key a session created with the sandbox workspace must be filed under. */
const KEY: string = sandboxProjectKey(ROOT)
/** The session-store events, decoded frame by frame (a naive reader sees only the first frame). */
const EVENTS = readSessionEvents(join(ROOT, "dshhome"), { workspace: join(ROOT, "ws") })
/** The event record types present, so an absent preset-mount witness is visible as its own fact. */
const TYPES: Record<string, number> = {}
for (const record of EVENTS.records) {
  /** The record's own event type, or `(none)` for a record that carries no discriminator. */
  const type: string = String((record as { type?: unknown }).type ?? "(none)")
  TYPES[type] = (TYPES[type] ?? 0) + 1
}
console.log(JSON.stringify({ root: ROOT, expectProjectKey: KEY, repo: REPO, headers: readSessionHeaders(ROOT, { projectKey: KEY }), eventTypes: TYPES, presetEvents: EVENTS.records.filter((record: unknown): boolean => JSON.stringify(record).includes("preset")).slice(0, 4) }, null, 2))
