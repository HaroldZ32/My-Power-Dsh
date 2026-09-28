import { existsSync, readFileSync } from "node:fs"

import type { PlanChecklist, TopLevelTaskRef } from "./types"

/** Grammar of a plain top-level checkbox: an unindented bullet, an optional tick character, then the label text. */
const SIMPLE_CHECKBOX_PATTERN = /^[-*][ \t]*\[[ \t]*([xX]?)[ \t]*\][ \t]+(.+)$/
/** Second-level heading that opens the TODO section, whose numbered `N. ` items are counted as work. */
const TODO_HEADING_PATTERN = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i
/** Second-level heading that opens the final-verification wave, whose items carry the `F<n>. ` id form. */
const FINAL_VERIFICATION_HEADING_PATTERN =
  /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i
/** Any heading the scan treats as a section boundary, so items below an untracked heading are not counted. */
const SECTION_BOUNDARY_HEADING_PATTERN = /^#{1,2}(?:[ \t]+|$)/
/** Fenced-code opener — up to three indent spaces then a run of three or more backticks or tildes; checkbox-shaped lines inside a fence are ignored. */
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/
/** Checkbox form required inside the TODO section: a bullet plus a numbered `N. ` label, so a nested bullet is not counted. */
const TODO_CHECKBOX_PATTERN = /^- \[([ xX])\] ([1-9]\d*\. .+)$/
/** Checkbox form required inside the final-verification section: a bullet plus an `F<n>. ` label in either case. */
const FINAL_WAVE_CHECKBOX_PATTERN = /^- \[([ xX])\] (F[1-9]\d*\. .+)$/i

/** Which part of the plan the scan is currently in; `other` marks a section whose items the caller does not count. */
type ChecklistSection = "todo" | "final-wave" | "other"

/** One recognized checkbox: its tick state and its label with the bullet and box already removed. */
type ParsedCheckbox = {
  readonly checked: boolean
  readonly label: string
}

/** A checkbox from a structured section plus the plan-task pointer built from its label. */
type ParsedStructuredCheckbox = ParsedCheckbox & {
  readonly task: TopLevelTaskRef
}

/** Open code fence remembered across lines so its closing run can be matched by marker kind and minimum length. */
type MarkdownFence = {
  readonly marker: "`" | "~"
  readonly length: number
}

/** Result of one pass over a structured plan: the counts plus the first unticked item as a task pointer. */
type ParsedStructuredPlan = {
  readonly checklist: PlanChecklist
  readonly nextTask: TopLevelTaskRef | null
}

/** Checklist of the plan file at `planPath`; a missing or unreadable file yields the empty checklist rather than throwing. */
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

/** Checklist of plan `markdown`, using the TODO/Final-Wave grammar when the document has one of those sections and the plain-checkbox grammar otherwise. */
export function parsePlanChecklist(markdown: string): PlanChecklist {
  // Plan lines to scan; the split tolerates CRLF because plans are hand-edited on every platform.
  const lines = markdown.split(/\r?\n/)
  if (!hasStructuredSection(lines)) {
    return parseSimpleChecklist(lines)
  }

  return parseStructuredPlan(lines).checklist
}

/** Pointer to the first unticked top-level task of a structured plan, or null when the document has no TODO/Final-Wave section. */
export function parseCurrentTopLevelTask(markdown: string): TopLevelTaskRef | null {
  // Plan lines to scan; the same CRLF-tolerant split the checklist parser uses.
  const lines = markdown.split(/\r?\n/)
  if (!hasStructuredSection(lines)) {
    return null
  }

  return parseStructuredPlan(lines).nextTask
}

/** Single pass over a structured plan: count the checkboxes of the TODO and Final-Wave sections and remember the first unticked one. */
function parseStructuredPlan(lines: readonly string[]): ParsedStructuredPlan {
  // Unticked items counted so far; grows for every unchecked box of a tracked section.
  let remaining = 0
  // Every recognized checkbox, ticked or not; `completed` is derived as total - remaining.
  let total = 0
  // Label of the first unticked item, or null while none has been seen.
  let nextTaskLabel: string | null = null
  // Task pointer for that same first unticked item; the label alone does not say which section it came from.
  let nextTask: TopLevelTaskRef | null = null
  // Section the scan is currently in; `other` skips the lines between tracked headings.
  let section: ChecklistSection = "other"
  // Currently open code fence, or null while outside one.
  let fence: MarkdownFence | null = null

  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence)) {
        fence = null
      }
      continue
    }

    // Fence opened by this line, if any; the scan then skips ahead to its closing marker.
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

    // Checkbox of this line under the current section's grammar, or null when the line is ignored.
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

/** Counts every top-level checkbox of a plan that has no TODO/Final-Wave section, in document order. */
function parseSimpleChecklist(lines: readonly string[]): PlanChecklist {
  // Unticked items counted so far; grows for every unchecked box.
  let remaining = 0
  // Every recognized checkbox, ticked or not; `completed` is derived as total - remaining.
  let total = 0
  // Label of the first unticked item, or null while none has been seen.
  let nextTaskLabel: string | null = null
  // Currently open code fence, or null while outside one.
  let fence: MarkdownFence | null = null

  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence)) {
        fence = null
      }
      continue
    }

    // Fence opened by this line, if any; a checkbox-shaped line inside a fence is not an item.
    const openingFence = parseOpeningFence(line)
    if (openingFence !== null) {
      fence = openingFence
      continue
    }

    // Checkbox of this line under the plain grammar, or null when the line is not one.
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

/** Plain-grammar checkbox parsed out of one line, or null when the line is not a top-level item. */
function parseSimpleTopLevelCheckbox(line: string): ParsedCheckbox | null {
  // Regex result; the tick and label groups must both be present for the line to count as an item.
  const match = line.match(SIMPLE_CHECKBOX_PATTERN)
  // Tick character between the brackets: empty for open, `x` or `X` for done.
  const marker = match?.[1]
  // Item text after the box, kept verbatim as the label the status view shows.
  const label = match?.[2]
  if (marker === undefined || label === undefined) {
    return null
  }
  return { checked: marker.toLowerCase() === "x", label }
}

/** Whether the plan carries a TODO or Final-Verification heading outside a code fence, which selects the structured grammar. */
function hasStructuredSection(lines: readonly string[]): boolean {
  // Fence state carried across lines, so a heading quoted inside a fence is not a section.
  let fence: MarkdownFence | null = null
  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence)) {
        fence = null
      }
      continue
    }

    // Fence opened by this line, if any; a heading inside a fence must not be seen as a section.
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

/** Section a heading line opens, or `other` for a heading whose items are not counted. */
function parseStructuredSectionHeading(line: string): ChecklistSection {
  if (TODO_HEADING_PATTERN.test(line)) {
    return "todo"
  }
  if (FINAL_VERIFICATION_HEADING_PATTERN.test(line)) {
    return "final-wave"
  }
  return "other"
}

/** Checkbox of one line under the given section's grammar; null when the line does not match, or its label yields no task reference. */
function parseStructuredTopLevelCheckbox(
  line: string,
  section: "todo" | "final-wave",
): ParsedStructuredCheckbox | null {
  // Grammar of the current section: a numbered `N. ` label for TODOs, an `F<n>. ` one for the final wave.
  const pattern = section === "todo" ? TODO_CHECKBOX_PATTERN : FINAL_WAVE_CHECKBOX_PATTERN
  // Regex result; the tick and label groups must both be present for the line to count as an item.
  const match = line.match(pattern)
  // Tick character between the brackets; `x`/`X` mean the item is done.
  const marker = match?.[1]
  // Item label including its id prefix, in the form `buildTaskRef` expects.
  const label = match?.[2]
  if (marker === undefined || label === undefined) {
    return null
  }
  // Parsed task pointer; a label that does not fit the id form drops the whole checkbox.
  const task = buildTaskRef(section, label)
  if (task === null) {
    return null
  }
  return { checked: marker.toLowerCase() === "x", label, task }
}

/** Task pointer split out of a checkbox label: the `<section>:<lowercased id>` key, the section, the id as written and the title. */
function buildTaskRef(section: "todo" | "final-wave", label: string): TopLevelTaskRef | null {
  // Id grammar of this section, mirroring the one the checkbox pattern already enforced.
  const pattern = section === "todo" ? /^([1-9]\d*)\. (.+)$/ : /^(F[1-9]\d*)\. (.+)$/i
  // Regex result; the id and the title must both be non-empty.
  const match = label.match(pattern)
  // Id exactly as the plan wrote it (`1`, `F2`, …), with its case preserved for display.
  const rawLabel = match?.[1]
  // Task text with the `N. ` / `F<n>. ` id prefix stripped.
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

/** Code fence opened by this line, or null when it is not a valid opener because a backtick appears in the info string. */
function parseOpeningFence(line: string): MarkdownFence | null {
  // Regex result; group 1 is the marker run, group 2 the info string after it.
  const match = line.match(FENCE_PATTERN)
  // Marker run itself: at least three backticks or tildes.
  const run = match?.[1]
  // Info string after the run; a backtick inside it makes the whole line an invalid opener.
  const info = match?.[2]
  // First character of the run, which fixes the fence's marker kind for the closing match.
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

/** Whether one line closes `fence`: the same marker character and a run at least as long, with nothing else on the line. */
function isClosingFence(line: string, fence: MarkdownFence): boolean {
  // Closing run of this line, or undefined when the line is not a bare fence marker.
  const run = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/)?.[1]
  return run?.charAt(0) === fence.marker && run.length >= fence.length
}

/** Zeroed checklist returned for a missing, unreadable or checkbox-less plan, so callers never see a throw. */
function emptyChecklist(): PlanChecklist {
  return { completed: 0, remaining: 0, total: 0, nextTaskLabel: null }
}
