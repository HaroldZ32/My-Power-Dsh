// THE TEAM HANDOFF: the document a HANDOFFPED seat writes before its context is compressed.
//
// WHY A DOCUMENT AND NOT A SUMMARY. The member is about to be compacted or reseeded: whatever it does
// not write down is lost, and the NEXT agent continues from this file alone. The seven sections are the
// minimum needed to continue honestly — the task, the state, the decisions (with why), the artifacts,
// what was VERIFIED, what is still open, and the single next step. `agent_teams_task {action:"handoff"}`
// REFUSES a document missing any of them and names what is missing.
//
// WHY IT LIVES ON THE TEAM PLANE (D4). The capability was implemented privately by
// `packages/mpd-cellwork-plugin` (`src/handoff.ts`); the refactor moves it here so cellwork, a
// workmate-driven team and an autoproject run share ONE handoff contract instead of one per engine.
// This module is pure apart from the ONE file write, so the section contract is unit-testable.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { sanitizeId, teamRoot } from "./team-store"

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
 * Where one member's handoff lands: `<workspace>/.mpd/team/handoff/<teamId>/<member>-<ordinal>.md`.
 *
 * Both path segments are reduced through the store's own {@link sanitizeId}, because a member name is
 * captain-supplied text that reaches a file name — the same rule the team record's own id obeys.
 * @param workspace - the workspace root.
 * @param teamId - the team the handoff belongs to.
 * @param member - the member's board name.
 * @param ordinal - the 1-based handoff ordinal of that member.
 * @returns the absolute document path.
 */
export function teamHandoffPath(workspace: string, teamId: string, member: string, ordinal: number): string {
  return join(teamRoot(workspace), "handoff", sanitizeId(teamId), sanitizeId(member) + "-" + String(ordinal) + ".md")
}

/**
 * Write one member's handoff document and answer its absolute path.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param teamId - the team the handoff belongs to.
 * @param member - the member's board name.
 * @param ordinal - the handoff ordinal (`previous + 1`).
 * @param text - the validated document body.
 * @returns the absolute path written.
 */
export function writeHandoffDocument(workspace: string, teamId: string, member: string, ordinal: number, text: string): string {
  /** The absolute document path. */
  const path = teamHandoffPath(workspace, teamId, member, ordinal)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, text.endsWith("\n") ? text : text + "\n")
  return path
}

/**
 * The directive a handoff answers with: the member must stop so the barrier can take over.
 *
 * The instruction is prose because the TEAM plane has no tool guard of its own; the fence it records
 * (`mode: checkpoint`) is what the next dispatch pass and the seat's own supervisor read.
 * @param path - the absolute handoff document path.
 * @returns the one-line directive the caller relays to the member.
 */
export function handoffWrittenDirective(path: string): string {
  return "[mpd-team] handoff written to " + path + ". END YOUR TURN NOW — do not call another tool; the plugin compacts and promotes you from that document."
}
