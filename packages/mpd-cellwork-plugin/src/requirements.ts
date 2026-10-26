// CELLWORK REQUIREMENTS — the document contract the Socratic phase must satisfy (contract B4).
//
// The planner runs the interview, the CAPTAIN relays every question through `ask_user_question`, and the
// agreed document is written to `<cell>/requirements.md`. This module owns the ONE reading of that
// document: which sections exist, whether each carries real content, and what is missing. It is a PURE
// parser over markdown — no harness, no service, no clock — so the section contract is unit-testable.
//
// WHY SECTIONS AND NOT FREE PROSE. A requirements document that omits "non-goals" or "open questions"
// looks complete and is not: the splitter then invents scope the user never agreed to. `finalize`
// REFUSES such a document, naming every missing section, and the planner asks the user the next question.
import { existsSync, readFileSync } from "node:fs"
import { atomicWriteText, requirementsPath } from "./state"

/** One required section: the canonical key, its display title, and the heading spellings it accepts. */
export interface RequirementSection {
  /** Stable key used in results and journal entries. */
  key: string
  /** Human-readable title reported when the section is missing. */
  title: string
  /** Normalised heading spellings that satisfy this section (longest first is not required). */
  aliases: readonly string[]
}

/** The six sections a finalized document must carry, in the order a reader expects them. */
export const REQUIREMENT_SECTIONS: readonly RequirementSection[] = [
  { key: "goal", title: "Goal", aliases: ["goal", "objective", "aim"] },
  { key: "nonGoals", title: "Non-goals", aliases: ["non-goals", "non goals", "non-goal", "non goal"] },
  { key: "users", title: "Users / consumers", aliases: ["users", "users / consumers", "users and consumers", "consumers", "audience"] },
  { key: "constraints", title: "Constraints", aliases: ["constraints", "constraints and assumptions"] },
  { key: "acceptance", title: "Acceptance criteria", aliases: ["acceptance criteria", "acceptance", "definition of done", "done criteria"] },
  { key: "openQuestions", title: "Open questions", aliases: ["open questions", "open question", "questions", "unresolved questions"] },
]

/** One required section's reading. */
export interface SectionReading {
  /** The canonical key. */
  key: string
  /** The display title. */
  title: string
  /** Whether a heading satisfying this section exists. */
  present: boolean
  /** Non-empty characters of body text under that heading (0 when absent or empty). */
  chars: number
}

/** The validation outcome for one requirements document. */
export interface RequirementsValidation {
  /** True when every required section is present AND carries content. */
  ok: boolean
  /** The display titles of the sections still missing or empty, in document order. */
  missing: readonly string[]
  /** Every section's reading, present or not. */
  sections: readonly SectionReading[]
}

/**
 * Normalise one markdown heading to the spelling the aliases use.
 *
 * Lowercased, markdown emphasis stripped, a trailing colon (ASCII or fullwidth) removed, and every run
 * of whitespace collapsed to one space, so `## **Non-goals:**` and `### Non Goals` cannot slip past.
 *
 * @param heading - the heading text after its `#` markers.
 * @returns the normalised spelling.
 */
export function normalizeHeading(heading: string): string {
  return heading
    .replace(/[*_`]/g, "")
    .replace(/[:：]\s*$/, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Parse one document into heading → body map.
 *
 * Only headings up to level 4 are considered; a body runs until the next heading of ANY level, which is
 * how a reader sees the document. The first heading wins when a spelling repeats, so a stray duplicate
 * cannot empty a section that was already answered.
 *
 * @param text - the markdown document.
 * @returns the normalised headings and their trimmed bodies.
 */
export function parseSections(text: string): Map<string, string> {
  /** The resulting heading-to-body map. */
  const sections = new Map<string, string>()
  /** The heading currently collecting body lines, or undefined before the first heading. */
  let current: string | undefined
  /** The body lines collected for the current heading. */
  let body: string[] = []
  /** Flush the collected body into the map under the current heading. */
  const flush = (): void => {
    if (current !== undefined && !sections.has(current)) sections.set(current, body.join("\n").trim())
    body = []
  }
  for (const line of text.split("\n")) {
    /** The heading match: one to four `#` markers and a non-empty title. */
    const heading = /^(#{1,4})\s+(.+?)\s*$/.exec(line)
    if (heading !== null) {
      flush()
      current = normalizeHeading(heading[2])
      continue
    }
    if (current !== undefined) body.push(line)
  }
  flush()
  return sections
}

/**
 * Whether one normalised heading satisfies one section.
 *
 * A heading matches an alias EXACTLY or begins with it followed by a boundary character (` `, `/`, `-`,
 * `(`), so `users / consumers` and `non-goals (out of scope)` both match while `non-negotiable` does not.
 *
 * @param heading - the normalised heading.
 * @param section - the section whose aliases are tried.
 * @returns true when the heading satisfies the section.
 */
export function headingSatisfies(heading: string, section: RequirementSection): boolean {
  for (const alias of section.aliases) {
    if (heading === alias) return true
    if (heading.startsWith(alias) && /[ /(.-]/.test(heading.charAt(alias.length))) return true
  }
  return false
}

/**
 * Validate one document against the required-section contract.
 *
 * @param text - the markdown document.
 * @returns the validation outcome, naming every missing or empty section.
 */
export function validateRequirementsText(text: string): RequirementsValidation {
  /** The parsed heading map. */
  const sections = parseSections(text)
  /** One reading per required section. */
  const readings: SectionReading[] = []
  /** The titles still missing or empty. */
  const missing: string[] = []
  for (const section of REQUIREMENT_SECTIONS) {
    /** The first heading that satisfies this section, if any. */
    let matched: string | undefined
    for (const heading of sections.keys()) {
      if (headingSatisfies(heading, section)) { matched = heading; break }
    }
    /** The body under that heading, or "". */
    const body = matched === undefined ? "" : (sections.get(matched) ?? "")
    /** Whether the body carries real content (anything but whitespace). */
    const chars = body.replace(/\s+/g, "").length
    readings.push({ key: section.key, title: section.title, present: matched !== undefined, chars })
    if (matched === undefined || chars === 0) missing.push(section.title)
  }
  return { ok: missing.length === 0, missing, sections: readings }
}

/**
 * Read the accepted requirements document, or null when none was written yet.
 *
 * A read failure surfaces as null only for a MISSING file; an unreadable file throws, because turning an
 * I/O failure into "no requirements" would let a split be judged against an empty document.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell whose document is read.
 * @returns the document text, or null when it does not exist.
 */
export function readRequirements(workspace: string, cellId: string): string | null {
  /** The absolute document path. */
  const path = requirementsPath(workspace, cellId)
  if (!existsSync(path)) return null
  return readFileSync(path, "utf8")
}

/**
 * Write the requirements document atomically.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell whose document is written.
 * @param text - the complete document body.
 */
export function writeRequirements(workspace: string, cellId: string, text: string): void {
  atomicWriteText(requirementsPath(workspace, cellId), text.endsWith("\n") ? text : text + "\n")
}
