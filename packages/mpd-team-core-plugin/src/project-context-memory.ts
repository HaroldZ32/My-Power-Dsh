import type { DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import type { ContextNote } from "./project-context-view"
import type { TeamTaskRecord } from "./team-store"

/** A shared interface pin written explicitly in a task description. */
interface SharedReference {
  /** Exact shared memory key. */
  readonly key: string
  /** Exact expected revision of the current fact. */
  readonly revision: number
  /** Exact applicability under which the task is using the fact. */
  readonly appliesTo: string
}

/** Recognize the existing memory service without importing a sibling plugin. */
interface ContextMemory {
  /** Original per-member recall path. An unbound view returns no result. */
  recallKey(exec: DshToolExec, key: string): { readonly found: boolean; readonly value: string } | undefined
  /** The memory service returns only an exact, current, applicable shared fact. */
  contextFact(exec: DshToolExec, reference: SharedReference): Omit<ContextNote, "key"> | undefined
}

/** Parsing a malformed or incomplete pin never reads its key from a store. */
function sharedReference(raw: string): SharedReference | undefined {
  if (raw.length > 580) return undefined
  try {
    /** Parse only one explicitly addressed fact. */
    const input: unknown = JSON.parse(raw)
    if (typeof input !== "object" || input === null ||
        !("key" in input) || typeof input.key !== "string" || input.key.length > 120 ||
        !("revision" in input) || typeof input.revision !== "number" || !Number.isSafeInteger(input.revision) || input.revision < 1 ||
        !("appliesTo" in input) || typeof input.appliesTo !== "string" || input.appliesTo.length > 160) return undefined
    return { key: input.key, revision: input.revision, appliesTo: input.appliesTo }
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

/** Check the optional service once before invoking exact-key readers. */
function isContextMemory(candidate: unknown): candidate is ContextMemory {
  return typeof candidate === "object" && candidate !== null &&
    "recallKey" in candidate && typeof candidate.recallKey === "function" &&
    "contextFact" in candidate && typeof candidate.contextFact === "function"
}

/** Resolve only the explicitly referenced keys, using the real host execution identity. */
export function readContextNotes(service: unknown, exec: DshToolExec, tasks: readonly TeamTaskRecord[], privateAllowed: boolean): ContextNote[] {
  if (!isContextMemory(service)) return []
  /** Bound the reference scan independently of descriptions' persisted sizes. */
  const refs = tasks.slice(0, 3).flatMap((task) => task.description.slice(0, 4096).split("\n"))
    .filter((line) => line.startsWith("Context shared: ") || (privateAllowed && line.startsWith("Context private: ")))
  /** Preserve board and line order, within three distinct reference lookups per request. */
  const notes: ContextNote[] = []
  for (const line of [...new Set(refs)].slice(0, 3)) {
    try {
      if (line.startsWith("Context private: ")) {
        /** The exact opaque key; its path and member identity come only from the memory service. */
        const key = line.slice("Context private: ".length).replace(/\r$/u, "")
        if (key.length === 0 || key.length > 120) continue
        /** Reuse member-private recall, which never falls back to legacy or another member. */
        const found = service.recallKey(exec, key)
        if (found?.found) notes.push({ key, text: found.value })
      } else {
        /** A malformed, superseded or inapplicable fact contributes no text. */
        const reference = sharedReference(line.slice("Context shared: ".length))
        if (reference === undefined) continue
        /** The service verifies the stored revision and applicability against this pin. */
        const fact = service.contextFact(exec, reference)
        if (fact !== undefined && fact.source !== undefined && fact.revision === reference.revision && fact.appliesTo === reference.appliesTo) {
          notes.push({ key: reference.key, ...fact })
        }
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      // A refused or unreadable hint leaves the authorized task context available.
    }
  }
  return notes
}
