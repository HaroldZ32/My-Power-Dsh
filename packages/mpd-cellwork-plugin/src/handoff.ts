// CELLWORK HANDOFF — the document a checkpointed member must write before its context is compressed
// (contract B8, plan §4.6 step 3).
//
// WHY A DOCUMENT AND NOT A SUMMARY. The agent is about to be compacted or reseeded: whatever it does not
// write down is lost, and the NEXT agent (the promoted subcaptain, or a fresh child) continues from this
// file alone. The seven sections are therefore the minimum needed to continue honestly — the task, the
// state, the decisions (with why), the artifacts, what was VERIFIED, what is still open, and the single
// next step. `cellwork_handoff` REFUSES a document missing any of them and names what is missing.
//
// This module is pure apart from the file write, so the section contract is unit-testable.
import { atomicWriteText, handoffPath } from "./state"

/** One required handoff section: the canonical key, its display title, and the heading/bullet spellings. */
export interface HandoffSection {
  /** Stable key used in results and journal entries. */
  key: string
  /** Human-readable title reported when the section is missing. */
  title: string
  /** Normalised spellings that satisfy this section. */
  aliases: readonly string[]
}

/** The seven sections a valid handoff carries, in the order the directive asks for them. */
export const HANDOFF_SECTIONS: readonly HandoffSection[] = [
  { key: "task", title: "Task", aliases: ["task", "current task"] },
  { key: "state", title: "State", aliases: ["state", "current state"] },
  { key: "decisions", title: "Decisions", aliases: ["decisions", "decision", "decisions and why"] },
  { key: "artifacts", title: "Artifacts", aliases: ["artifacts", "artefacts", "files"] },
  { key: "verified", title: "Verified facts", aliases: ["verified facts", "verified", "facts"] },
  { key: "open", title: "Open questions", aliases: ["open questions", "open", "questions"] },
  { key: "next", title: "Next step", aliases: ["next step", "next"] },
]

/** One section's reading. */
export interface HandoffReading {
  /** The canonical key. */
  key: string
  /** The display title. */
  title: string
  /** Whether a satisfying label was found. */
  present: boolean
  /** Non-whitespace characters under that label. */
  chars: number
}

/** The validation outcome for one handoff document. */
export interface HandoffValidation {
  /** True when every required section is present AND carries content. */
  ok: boolean
  /** The display titles still missing or empty. */
  missing: readonly string[]
  /** Every section's reading. */
  sections: readonly HandoffReading[]
}

/**
 * Normalise one label to the spelling the aliases use.
 *
 * @param label - a markdown heading text or a `Key:` line's key.
 * @returns the normalised spelling.
 */
export function normalizeHandoffLabel(label: string): string {
  return label
    .replace(/[*_`]/g, "")
    .replace(/[:：]\s*$/, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Parse one handoff document into label → body.
 *
 * TWO grammars are accepted because both are natural to a model, but ONE document uses one of them:
 * when any markdown heading (level 1–4) is present the document is read as headed sections (a heading's
 * body runs to the next heading); otherwise every `Key: …` line / `- Key: …` bullet is read as its own
 * section. Mixing is not attempted, so a heading cannot swallow a key line and a key line cannot shadow a
 * heading. The first occurrence of a label wins.
 *
 * @param text - the handoff document.
 * @returns the normalised labels and their trimmed bodies.
 */
export function parseHandoff(text: string): Map<string, string> {
  /** The resulting label-to-body map. */
  const sections = new Map<string, string>()
  /** The heading currently collecting body lines, or undefined. */
  let current: string | undefined
  /** The body lines of the current heading. */
  let body: string[] = []
  /** Flush the collected heading body into the map. */
  const flush = (): void => {
    if (current !== undefined && !sections.has(current)) sections.set(current, body.join("\n").trim())
    body = []
  }
  for (const line of text.split("\n")) {
    /** A markdown heading of level 1–4. */
    const heading = /^(#{1,4})\s+(.+?)\s*$/.exec(line)
    if (heading !== null) {
      flush()
      current = normalizeHandoffLabel(heading[2])
      continue
    }
    if (current !== undefined) body.push(line)
  }
  flush()
  if (sections.size > 0) return sections
  // No headings at all: read the key-line grammar.
  for (const line of text.split("\n")) {
    /** A bullet or bare key line (`- Task: body`). */
    const keyed = /^\s*(?:[-*+]\s+)?([A-Za-z][A-Za-z /_-]{0,40}):\s*(.*)$/.exec(line)
    if (keyed === null) continue
    /** The label the key line names. */
    const label = normalizeHandoffLabel(keyed[1])
    if (!sections.has(label)) sections.set(label, keyed[2].trim())
  }
  return sections
}

/**
 * Validate one handoff document against the seven-section contract.
 *
 * @param text - the handoff document.
 * @returns the validation outcome, naming every missing or empty section.
 */
export function validateHandoffText(text: string): HandoffValidation {
  /** The parsed label map. */
  const parsed = parseHandoff(text)
  /** One reading per required section. */
  const readings: HandoffReading[] = []
  /** The titles still missing or empty. */
  const missing: string[] = []
  for (const section of HANDOFF_SECTIONS) {
    /** The first label that satisfies this section. */
    let matched: string | undefined
    for (const label of parsed.keys()) {
      if (section.aliases.includes(label) || section.aliases.some((alias) => label.startsWith(alias + " "))) { matched = label; break }
    }
    /** The body under that label, or "". */
    const content = matched === undefined ? "" : (parsed.get(matched) ?? "")
    /** Whether the body carries real content. */
    const chars = content.replace(/\s+/g, "").length
    readings.push({ key: section.key, title: section.title, present: matched !== undefined, chars })
    if (matched === undefined || chars === 0) missing.push(section.title)
  }
  return { ok: missing.length === 0, missing, sections: readings }
}

/**
 * Write one member's handoff document and answer its absolute path.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell the handoff belongs to.
 * @param member - the member's board name.
 * @param ordinal - the handoff ordinal (`handoffs + 1`).
 * @param text - the validated document body.
 * @returns the absolute path written.
 */
export function writeHandoff(workspace: string, cellId: string, member: string, ordinal: number, text: string): string {
  /** The absolute document path. */
  const path = handoffPath(workspace, cellId, member, ordinal)
  atomicWriteText(path, text.endsWith("\n") ? text : text + "\n")
  return path
}
