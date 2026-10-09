// Boulder core: the plan-markdown parser behind the progress and status tools.
//
// Two grammars are recognized. A plan carrying a `## TODOs` or `## Final Verification Wave` heading
// is read STRUCTURALLY: only top-level numbered items under those two headings count. Any other plan
// falls back to the PLAIN grammar, where every top-level checkbox counts. Headings and checkboxes
// inside a code fence are ignored in both grammars, so a plan that quotes the syntax is not miscounted.

import { existsSync, readFileSync } from "node:fs"

import type { PlanChecklist, TopLevelTaskRef } from "./types"

/** Plain-grammar checkbox: an unindented bullet, an optional tick, then the label text. */
const SIMPLE_CHECKBOX_PATTERN = /^[-*][ \t]*\[[ \t]*([xX]?)[ \t]*\][ \t]+(.+)$/

/** Heading that opens the TODO section, whose numbered `N. ` items are the work. */
const TODO_HEADING_PATTERN = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i

/** Heading that opens the final-verification wave, whose items carry the `F<n>. ` id form. */
const FINAL_VERIFICATION_HEADING_PATTERN = /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i

/** Any heading the scan treats as a section boundary, so items below an untracked heading are not counted. */
const SECTION_BOUNDARY_HEADING_PATTERN = /^#{1,2}(?:[ \t]+|$)/

/** Fenced-code opener: up to three indent spaces, then three or more backticks or tildes. */
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/

/** Checkbox form required inside the TODO section: a bullet plus a numbered `N. ` label, so a nested bullet never counts. */
const TODO_CHECKBOX_PATTERN = /^- \[([ xX])\] ([1-9]\d*\. .+)$/

/** Checkbox form required inside the final-verification section: a bullet plus an `F<n>. ` label in either case. */
const FINAL_WAVE_CHECKBOX_PATTERN = /^- \[([ xX])\] (F[1-9]\d*\. .+)$/i

/** Which part of the plan the scan is in; `other` marks a section whose items this parser does not count. */
type ChecklistSection = "todo" | "final-wave" | "other"

/** One recognized checkbox: its tick state plus its label with bullet and box already removed. */
type ParsedCheckbox = {
  /** True when the box is ticked with `x` or `X`. */
  readonly checked: boolean
  /** Item text after the box, kept verbatim for display. */
  readonly label: string
}

/** A checkbox from a structured section plus the plan-task pointer built from its label. */
type ParsedStructuredCheckbox = ParsedCheckbox & {
  /** Pointer naming the plan task this checkbox is. */
  readonly task: TopLevelTaskRef
}

/** Open code fence remembered across lines, so its close can be matched by marker kind and minimum run length. */
type MarkdownFence = {
  /** Fence character, which a valid closing run must repeat. */
  readonly marker: "`" | "~"
  /** Length of the opening run; a closing run must be at least this long. */
  readonly length: number
}

/** Result of one pass over a structured plan: the counts plus the first unticked item as a task pointer. */
type ParsedStructuredPlan = {
  /** Counts and next label the status view reports. */
  readonly checklist: PlanChecklist
  /** First unticked item as a pointer, or null when every counted item is ticked. */
  readonly nextTask: TopLevelTaskRef | null
}

/**
 * Checklist of the plan file at `planPath`.
 *
 * @param planPath - path of the plan file to read.
 * @returns its checklist, or the empty checklist for a missing or unreadable file rather than a throw.
 */
export function getPlanChecklist(planPath: string): PlanChecklist {
  if (!existsSync(planPath)) {
    return emptyChecklist()
  }

  try {
    return parsePlanChecklist(readFileSync(planPath, "utf-8"))
  } catch (error) {
    if (error instanceof Error) {
      return emptyChecklist()
    }
    throw error
  }
}

/**
 * Checklist of plan `markdown`, under the structured grammar when the document has one of the two
 * tracked headings and under the plain grammar otherwise.
 *
 * @param markdown - full plan text; either line ending is tolerated.
 * @returns the recognized counts plus the first unticked label.
 */
export function parsePlanChecklist(markdown: string): PlanChecklist {
  /** Plan lines to scan; plans are hand-edited on every platform, so CRLF is accepted. */
  const lines = markdown.split(/\r?\n/)
  if (!hasStructuredSection(lines)) {
    return parseSimpleChecklist(lines)
  }

  return parseStructuredPlan(lines).checklist
}

/**
 * Pointer to the first unticked top-level task of a structured plan.
 *
 * @param markdown - full plan text; either line ending is tolerated.
 * @returns the pointer, or null when the document carries no TODO / Final-Wave section.
 */
export function parseCurrentTopLevelTask(markdown: string): TopLevelTaskRef | null {
  /** Plan lines to scan, split exactly as the checklist parser splits them. */
  const lines = markdown.split(/\r?\n/)
  if (!hasStructuredSection(lines)) {
    return null
  }

  return parseStructuredPlan(lines).nextTask
}

/**
 * One pass over a structured plan: count the checkboxes of the two tracked sections and remember the first unticked one.
 *
 * @param lines - the plan's lines, without terminators.
 * @returns the checklist counts plus the first unticked item as a pointer.
 */
function parseStructuredPlan(lines: readonly string[]): ParsedStructuredPlan {
  /** Unticked counted items so far; grows for every open box of a tracked section. */
  let remaining = 0
  /** Every recognized checkbox, ticked or not; `completed` is derived as `total - remaining`. */
  let total = 0
  /** Label of the first unticked item, or null while none has been seen. */
  let nextTaskLabel: string | null = null
  /** Pointer for that same first unticked item; the label alone does not say which section it came from. */
  let nextTask: TopLevelTaskRef | null = null
  /** Section the scan is currently in; `other` skips the lines between tracked headings. */
  let section: ChecklistSection = "other"
  /** Currently open code fence, or null while outside one. */
  let fence: MarkdownFence | null = null

  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence)) {
        fence = null
      }
      continue
    }

    /** Fence this line opens, if any; the scan then skips ahead to its closing marker. */
    const openingFence = parseOpeningFence(line)
    if (openingFence !== null) {
      fence = openingFence
      continue
    }

    if (SECTION_BOUNDARY_HEADING_PATTERN.test(line)) {
      section = parseStructuredSectionHeading(line)
      continue
    }
    if (section === "other") {
      continue
    }

    /** Checkbox of this line under the current section's grammar, or null when the line is ignored. */
    const checkbox = parseStructuredTopLevelCheckbox(line, section)
    if (checkbox === null) {
      continue
    }

    total += 1
    if (checkbox.checked) {
      continue
    }

    remaining += 1
    if (nextTaskLabel === null) {
      nextTaskLabel = checkbox.label
      nextTask = checkbox.task
    }
  }

  return {
    checklist: {
      completed: total - remaining,
      remaining,
      total,
      nextTaskLabel,
    },
    nextTask,
  }
}

/**
 * Count every top-level checkbox of a plan that has no tracked section, in document order.
 *
 * @param lines - the plan's lines, without terminators.
 * @returns the recognized counts plus the first unticked label; no task pointer exists under this grammar.
 */
function parseSimpleChecklist(lines: readonly string[]): PlanChecklist {
  /** Unticked items counted so far. */
  let remaining = 0
  /** Every recognized checkbox, ticked or not; `completed` is derived as `total - remaining`. */
  let total = 0
  /** Label of the first unticked item, or null while none has been seen. */
  let nextTaskLabel: string | null = null
  /** Currently open code fence, or null while outside one. */
  let fence: MarkdownFence | null = null

  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence)) {
        fence = null
      }
      continue
    }

    /** Fence this line opens, if any; a checkbox-shaped line inside a fence is not an item. */
    const openingFence = parseOpeningFence(line)
    if (openingFence !== null) {
      fence = openingFence
      continue
    }

    /** Checkbox of this line under the plain grammar, or null when the line is not one. */
    const checkbox = parseSimpleTopLevelCheckbox(line)
    if (checkbox === null) {
      continue
    }

    total += 1
    if (checkbox.checked) {
      continue
    }

    remaining += 1
    if (nextTaskLabel === null) {
      nextTaskLabel = checkbox.label
    }
  }

  return { completed: total - remaining, remaining, total, nextTaskLabel }
}

/**
 * Parse one line under the plain grammar.
 *
 * @param line - one plan line, without its terminator.
 * @returns the checkbox, or null when the line is not a top-level bullet item.
 */
function parseSimpleTopLevelCheckbox(line: string): ParsedCheckbox | null {
  /** Regex result; the tick and label groups must both be present for the line to count. */
  const match = line.match(SIMPLE_CHECKBOX_PATTERN)
  /** Tick character between the brackets: empty for open, `x` or `X` for done. */
  const marker = match?.[1]
  /** Item text after the box, kept verbatim. */
  const label = match?.[2]
  if (marker === undefined || label === undefined) {
    return null
  }
  return { checked: marker.toLowerCase() === "x", label }
}

/**
 * Whether the plan carries a tracked heading outside a code fence, which selects the structured grammar.
 *
 * @param lines - the plan's lines, without terminators.
 * @returns true when at least one TODO or Final-Verification heading is outside every fence.
 */
function hasStructuredSection(lines: readonly string[]): boolean {
  /** Fence state carried across lines, so a heading quoted inside a fence is not a section. */
  let fence: MarkdownFence | null = null
  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence)) {
        fence = null
      }
      continue
    }

    /** Fence this line opens, if any; a heading inside a fence must not be read as a section. */
    const openingFence = parseOpeningFence(line)
    if (openingFence !== null) {
      fence = openingFence
      continue
    }
    if (parseStructuredSectionHeading(line) !== "other") {
      return true
    }
  }
  return false
}

/**
 * Section a heading line opens.
 *
 * @param line - one plan line, without its terminator.
 * @returns the tracked section, or `other` for a heading whose items are not counted.
 */
function parseStructuredSectionHeading(line: string): ChecklistSection {
  if (TODO_HEADING_PATTERN.test(line)) {
    return "todo"
  }
  if (FINAL_VERIFICATION_HEADING_PATTERN.test(line)) {
    return "final-wave"
  }
  return "other"
}

/**
 * Parse one line under a tracked section's grammar.
 *
 * @param line - one plan line, without its terminator.
 * @param section - the tracked section the scan is currently in.
 * @returns the checkbox with its task pointer, or null when the line does not match or its label yields no pointer.
 */
function parseStructuredTopLevelCheckbox(
  line: string,
  section: "todo" | "final-wave",
): ParsedStructuredCheckbox | null {
  /** Grammar of this section: a numbered `N. ` label for TODOs, an `F<n>. ` one for the final wave. */
  const pattern = section === "todo" ? TODO_CHECKBOX_PATTERN : FINAL_WAVE_CHECKBOX_PATTERN
  /** Regex result; the tick and label groups must both be present for the line to count. */
  const match = line.match(pattern)
  /** Tick character between the brackets; `x`/`X` mean the item is done. */
  const marker = match?.[1]
  /** Item label including its id prefix, in the form `buildTaskRef` expects. */
  const label = match?.[2]
  if (marker === undefined || label === undefined) {
    return null
  }
  /** Parsed pointer; a label outside the id form drops the whole checkbox. */
  const task = buildTaskRef(section, label)
  if (task === null) {
    return null
  }
  return { checked: marker.toLowerCase() === "x", label, task }
}

/**
 * Split a checkbox label into the plan-task pointer the status view reports.
 *
 * @param section - the tracked section the label came from, which fixes its id grammar.
 * @param label - the raw label, e.g. `1. Parse the ledger` or `F2. Audit the diff`.
 * @returns the pointer, or null when the label does not start with the section's id form.
 */
function buildTaskRef(section: "todo" | "final-wave", label: string): TopLevelTaskRef | null {
  /** Id grammar of this section, mirroring the one the checkbox pattern already enforced. */
  const pattern = section === "todo" ? /^([1-9]\d*)\. (.+)$/ : /^(F[1-9]\d*)\. (.+)$/i
  /** Regex result; the id and the title must both be non-empty. */
  const match = label.match(pattern)
  /** Id exactly as the plan wrote it (`1`, `F2`, …), with its case preserved for display. */
  const rawLabel = match?.[1]
  /** Task text with the `N. ` / `F<n>. ` id prefix stripped. */
  const title = match?.[2]
  if (rawLabel === undefined || title === undefined) {
    return null
  }
  return {
    key: `${section}:${rawLabel.toLowerCase()}`,
    section,
    label: rawLabel,
    title,
  }
}

/**
 * Code fence opened by this line.
 *
 * @param line - one plan line, without its terminator.
 * @returns the opened fence, or null when the line is not a valid opener because a backtick appears in its info string.
 */
function parseOpeningFence(line: string): MarkdownFence | null {
  /** Regex result; group 1 is the marker run and group 2 the info string after it. */
  const match = line.match(FENCE_PATTERN)
  /** Marker run itself: at least three backticks or tildes. */
  const run = match?.[1]
  /** Info string after the run; a backtick inside it makes the whole line an invalid opener. */
  const info = match?.[2]
  /** First character of the run, which fixes the marker kind the closing run must repeat. */
  const marker = run?.charAt(0)
  if (
    run === undefined ||
    info === undefined ||
    (marker !== "`" && marker !== "~") ||
    (marker === "`" && info.includes("`"))
  ) {
    return null
  }
  return { marker, length: run.length }
}

/**
 * Whether one line closes an open fence.
 *
 * @param line - one plan line, without its terminator.
 * @param fence - the fence currently open.
 * @returns true for a bare marker line of the same kind and at least the same run length.
 */
function isClosingFence(line: string, fence: MarkdownFence): boolean {
  /** This line's closing run, or undefined when the line is not a bare fence marker. */
  const run = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/)?.[1]
  return run?.charAt(0) === fence.marker && run.length >= fence.length
}

/**
 * The zeroed checklist returned for a missing, unreadable or checkbox-less plan.
 *
 * @returns counts of zero and no next label, so callers never have to handle a throw.
 */
function emptyChecklist(): PlanChecklist {
  return { completed: 0, remaining: 0, total: 0, nextTaskLabel: null }
}
