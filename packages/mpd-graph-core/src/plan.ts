// THE TASK-PLAN PARSER: markdown in, a declared task graph out, and NOTHING thrown away.
//
// THE CONTRACT IS TOLERANCE WITH A REPORT (frozen decision, `.mpd/plans/living-graph.md` Amendment
// 1). A plan mid-edit is the NORMAL state under a file watcher, so refusing to parse because one
// line is half-typed would make the live view useless exactly when it matters. Every line this
// parser recognizes but cannot read is collected into `problems` with its 1-based line number, and
// the model carries that list into the panel's footer as a count.
//
// THE ACCEPTED SUBSET IS DOCUMENTED IN THE PACKAGE README, section by section — the two headings,
// the id forms, the lane-table shapes, the explicit edge forms and the exact predicate that makes a
// line a problem. That documentation is binding: if this file accepts something the README does not
// promise, the README is the defect, because hand-authored fixtures are written from it.
//
// WHAT THIS PARSER DOES NOT DO. It never reads a file (see `resolve.ts`), never touches the live
// board, and never resolves a reference against the board: plan ids are declared against the plan,
// and the merge is what decides whether an id exists on both sides.
import { ID_ORDER } from "./rank.ts"
import type { PlanDocument, PlanLane, PlanProblem, PlanSection, PlanTask } from "./types.ts"

/** A line that survived fence removal, with the 1-based document line it came from. */
interface SourceLine {
  /** The line's text, verbatim except for a trailing carriage return. */
  text: string
  /** The 1-based line number in the original document. */
  line: number
}

/** The raw reading of one task line, before its block references are resolved to ids. */
interface RawPlanTask {
  /** The id the line's own ordinal names. */
  id: string
  /** The title with checkbox, ordinal and leading lane marker removed. */
  title: string
  /** The ORIGINAL source line, verbatim, which every report about this task quotes. */
  source: string
  /** Which tracked section declared the line. */
  section: PlanSection
  /** The 1-based document line. */
  line: number
  /** The lane key the title's leading marker names, when it names one the document declares. */
  lane?: string
  /** Block references exactly as the document spelled them, before resolution. */
  references: string[]
}

/** Heading that opens the numbered TODO section, whose items are the work. */
const TODO_HEADING = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i

/** Heading that opens the final-verification wave, whose items carry the `F<n>. ` id form. */
const FINAL_WAVE_HEADING = /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i

/** Any level-1/2 heading, which closes whichever tracked section is open; level 3+ does not. */
const SECTION_BOUNDARY = /^#{1,2}(?:[ \t]+|$)/

/** Fenced-code opener: up to three indent spaces, then three or more backticks or tildes. */
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/

/** A TODO task line at column 0: `1. …`, `- 1. …` or `- [x] 1. …`. */
const TODO_TASK = /^(?:[-*][ \t]+(?:\[[ xX]\][ \t]+)?)?([1-9][0-9]*)\.\s+(\S.*)$/

/** A final-wave task line at column 0: `F1. …`, `- F1. …` or `- [x] F1. …`. */
const FINAL_TASK = /^(?:[-*][ \t]+(?:\[[ xX]\][ \t]+)?)?([Ff][1-9][0-9]*)\.\s+(\S.*)$/

/** Whether a line LOOKS like a task, so a line that fails the grammar becomes a problem, not a skip. */
const TASK_CANDIDATE = /^(?:[-*][ \t]+|[0-9]+\.|[Ff][0-9]+\.)/

/** A leading lane marker: `Lane B (Engineering) — …`, `A. Core`, `P0 · Contract`. */
const LANE_MARKER = /^(?:Lane\s+)?([A-Za-z][A-Za-z0-9]{0,3})\s*(?:\.[ \t]*|—[ \t]*|–[ \t]*|·[ \t]*|:[ \t]*|\()/

/** A block reference list inside parentheses: `(blocked by 1, 2)`. */
const PARENTHESISED_BLOCKS = /\(\s*blocked[\s_-]+by\s*:?\s*([^)]+)\)/gi

/** A block reference written as an explicit label: `blocked_by: 2, F1` or `depends on: T3`. */
const LABELLED_BLOCKS = /(?:blocked[\s_-]+by|depends[\s_-]+on)\s*:\s*([^.()\n]+)/gi

/**
 * Split a markdown table row into its cells, outer pipes removed and each cell trimmed.
 * @param row - the row's text, starting with `|`.
 * @returns the cells, `[]` when the row is not a table row.
 */
function splitCells(row: string): string[] {
  /** The trimmed row, so the outer pipes can be dropped without guessing at indentation. */
  const trimmed = row.trim()
  if (!trimmed.startsWith("|")) return []
  /** The row's body, outer pipes removed. */
  const body = trimmed.replace(/^\|/, "").replace(/\|$/, "")
  return body.split("|").map((cell) => cell.trim())
}

/**
 * Whether a row is a table's header separator (`|---|---|`).
 * @param row - the candidate row's text.
 * @returns true when every cell is nothing but dashes and optional alignment colons.
 */
function isTableSeparator(row: string): boolean {
  /** The row's cells. */
  const cells = splitCells(row)
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.replace(/[ \t]/g, "")))
}

/**
 * Strip the emphasis markers a plan wraps a label in, from both ends.
 * @param text - the label text.
 * @returns the label without surrounding bold, italic or code markers.
 */
function stripEmphasis(text: string): string {
  /** The working value, trimmed before each marker removal. */
  let value = text.trim()
  while (value.startsWith("**") || value.startsWith("*") || value.startsWith("`")) {
    value = (value.startsWith("**") ? value.slice(2) : value.slice(1)).trim()
  }
  while (value.endsWith("**") || value.endsWith("*") || value.endsWith("`")) {
    value = (value.endsWith("**") ? value.slice(0, -2) : value.slice(0, -1)).trim()
  }
  return value
}

/**
 * The lane key a label or a title names.
 *
 * A key is one to four ASCII alphanumerics followed by a SEPARATOR (`.`, `—`, `·`, `:`, `(`) or the
 * end of the label — never a bare space, which is what keeps the prose title `The two lane suites`
 * from being read as lane `THE`.
 * @param text - a lane-table label or a task title.
 * @returns the upper-cased key, or undefined when the text names no lane.
 */
function laneKeyOf(text: string): string | undefined {
  /** The text with emphasis markers removed. */
  const value = stripEmphasis(text)
  /** The leading label followed by a separator or the end of the text. */
  const match = /^(?:Lane\s+)?([A-Za-z][A-Za-z0-9]{0,3})(?=[ \t]*[.:—–·(]|[ \t]*$)/.exec(value)
  return match === null ? undefined : match[1].toUpperCase()
}

/**
 * Read a task title's leading lane marker, if it has one, and the title it would leave behind.
 *
 * DETECTION ONLY, DELIBERATELY: the caller decides whether the marker's key is one the document's
 * lane table actually declares. An UNDECLARED marker must not eat the text — a title that begins
 * `Two. Things` or `P1 · something` outside any lane table is a title, not a marker — so this
 * function reports what it saw and lets `collectTasks` keep the line verbatim and record a problem.
 * @param text - the title text after its ordinal was removed.
 * @returns the lane key and the remaining title, or undefined when the title starts with prose.
 */
function leadingLane(text: string): { key: string; title: string } | undefined {
  /** The working title, trimmed. */
  let value = text.trim()
  /** Whether a leading bold wrapper was opened, so its close is consumed with the marker. */
  let bold = false
  if (value.startsWith("**")) {
    bold = true
    value = value.slice(2)
  }
  /** The marker plus the separator that proves it is a marker. */
  const match = LANE_MARKER.exec(value)
  if (match === null) return undefined
  /** Everything after the marker, before the inline owner note (if any) is closed. */
  let rest = value.slice(match[0].length)
  if (match[0].endsWith("(")) {
    /** The close of an inline owner note such as `(Senior Engineer)`; an unclosed note is prose. */
    const close = rest.indexOf(")")
    if (close >= 0) rest = rest.slice(close + 1)
  }
  if (bold && rest.startsWith("**")) rest = rest.slice(2)
  rest = rest.replace(/^[ \t]*(?:—|–|-|·|:)[ \t]*/, "").trim()
  return { key: match[1].toUpperCase(), title: rest === "" ? value.trim() : rest }
}

/**
 * The owner a lane table's owner cell names.
 * @param cell - the cell's text.
 * @returns the display name with emphasis removed and a trailing qualifier (`(after C)`) cut off.
 */
function normalizeOwner(cell: string): string {
  /** The cell with emphasis markers removed. */
  const value = stripEmphasis(cell)
  /** Where a trailing qualifier starts, or -1 when there is none. */
  const cut = value.indexOf("(")
  return (cut >= 0 ? value.slice(0, cut) : value).trim()
}

/**
 * The document's readable lines, in order, with fenced code blocks excluded.
 *
 * A fence carries its marker and run length, so a `~~~` block does not close a ``` one, and a
 * plan that QUOTES the grammar inside a fence is not parsed as if it declared tasks.
 * @param text - the whole plan document.
 * @returns the surviving lines with their original 1-based numbers.
 */
function readableLines(text: string): SourceLine[] {
  /** The surviving lines. */
  const lines: SourceLine[] = []
  /** The open fence's marker character and run length, or undefined outside a fence. */
  let fence: { marker: string; length: number } | undefined
  /** The 1-based line counter. */
  let number = 0
  for (const raw of text.split("\n")) {
    number += 1
    /** The fence marker on this line, when it carries one. */
    const opener = FENCE.exec(raw)
    if (fence === undefined) {
      if (opener !== null) {
        fence = { marker: opener[1][0], length: opener[1].length }
        continue
      }
      lines.push({ text: raw.replace(/\r$/, ""), line: number })
      continue
    }
    if (opener !== null && opener[1][0] === fence.marker && opener[1].length >= fence.length && opener[2].trim() === "") {
      fence = undefined
    }
  }
  return lines
}

/**
 * Collect every lane table in the document into a lane-key to owner map.
 *
 * A LANE TABLE is any markdown table whose header carries both a `lane` cell and an `owner` cell, at
 * any depth and under any heading — the plan documents in this repository place it either before or
 * after the TODOs. The FIRST row for a key wins, so a later restatement cannot retarget an owner
 * silently, and a row that names no key or no owner is a problem rather than a silent skip.
 * @param lines - the readable lines.
 * @param problems - the problem list this scan appends to.
 * @returns the lane key to owner map.
 */
function collectLanes(lines: readonly SourceLine[], problems: PlanProblem[]): Map<string, string> {
  /** The lane key to owner map. */
  const lanes = new Map<string, string>()
  /** Index of the line being examined. */
  let index = 0
  while (index < lines.length) {
    /** The candidate header row's cells. */
    const header = splitCells(lines[index].text)
    /** Whether the header names both columns this parser reads. */
    const named = header.some((cell) => stripEmphasis(cell).toLowerCase() === "lane") && header.some((cell) => stripEmphasis(cell).toLowerCase() === "owner")
    /** The separator row a header must be followed by. */
    const separator = lines[index + 1]
    if (!named || separator === undefined || !isTableSeparator(separator.text)) {
      index += 1
      continue
    }
    /** Position of the row being read, starting after the separator. */
    let cursor = index + 2
    while (cursor < lines.length && lines[cursor].text.trimStart().startsWith("|")) {
      /** The row's cells. */
      const cells = splitCells(lines[cursor].text)
      /** The lane key the first cell names. */
      const key = laneKeyOf(cells[0] ?? "")
      /** The owner the second cell names. */
      const owner = cells.length > 1 ? normalizeOwner(cells[1]) : ""
      if (key === undefined || owner === "") {
        problems.push({
          line: lines[cursor].line,
          text: lines[cursor].text,
          reason: key === undefined ? "lane table row names no lane label" : "lane table row names no owner",
        })
      } else if (!lanes.has(key)) {
        lanes.set(key, owner)
      }
      cursor += 1
    }
    index = cursor
  }
  return lanes
}

/**
 * Collect the task lines of both tracked sections, in document order.
 *
 * A line is a CANDIDATE when it starts at column 0 with a bullet, a bare number-dot or an `F<n>.`
 * marker; a candidate that fails its section's grammar becomes a problem. Everything else — prose,
 * blank lines, indented continuation lines and table rows — is not a candidate and is simply not a
 * task, which is what keeps a plan's explanatory paragraphs out of the problem count.
 *
 * A LANE MARKER IS STRIPPED ONLY WHEN ITS KEY IS DECLARED by the lane table: a prefix that looks
 * like a marker but names no declared lane leaves the title verbatim and is REPORTED, because
 * silently eating the first token of a real title is the kind of loss a tolerant parser must not
 * commit.
 * @param lines - the readable lines.
 * @param lanes - the lane table's keys, which decide whether a marker may strip a title.
 * @param problems - the problem list this scan appends to.
 * @returns the raw task lines in document order.
 */
function collectTasks(lines: readonly SourceLine[], lanes: ReadonlyMap<string, string>, problems: PlanProblem[]): RawPlanTask[] {
  /** The tasks in document order. */
  const tasks: RawPlanTask[] = []
  /** The tracked section currently open, undefined outside both. */
  let section: PlanSection | undefined
  for (const line of lines) {
    if (TODO_HEADING.test(line.text)) {
      section = "todo"
      continue
    }
    if (FINAL_WAVE_HEADING.test(line.text)) {
      section = "final-wave"
      continue
    }
    if (SECTION_BOUNDARY.test(line.text)) {
      section = undefined
      continue
    }
    if (section === undefined) continue
    if (line.text.trim() === "") continue
    if (/^[ \t]/.test(line.text)) continue
    if (!TASK_CANDIDATE.test(line.text)) continue
    /** The grammar the open section requires. */
    const grammar = section === "todo" ? TODO_TASK : FINAL_TASK
    /** The grammar's match: the ordinal and the text after it. */
    const match = grammar.exec(line.text)
    if (match === null) {
      problems.push({
        line: line.line,
        text: line.text,
        reason: section === "todo" ? "not a numbered TODO item" : "not an F<n> final-verification item",
      })
      continue
    }
    /** The text after the ordinal, before any lane marker is read. */
    const afterOrdinal = match[2].trim()
    /** The marker the title starts with, from detection only. */
    const mark = leadingLane(afterOrdinal)
    /** The DECLARED lane key the marker names, or undefined for no marker or an undeclared one. */
    const lane = mark !== undefined && lanes.has(mark.key) ? mark.key : undefined
    if (mark !== undefined && lane === undefined) {
      problems.push({ line: line.line, text: line.text, reason: `leading lane marker ${mark.key} names no lane the plan declares` })
    }
    /** The title with a DECLARED marker removed; an undeclared marker stays verbatim. */
    const title = mark !== undefined && lane !== undefined ? mark.title : afterOrdinal
    tasks.push({
      id: section === "todo" ? `T${match[1]}` : match[1].toUpperCase(),
      title,
      source: line.text,
      section,
      line: line.line,
      lane,
      references: declaredReferences(afterOrdinal),
    })
  }
  return tasks
}

/**
 * The block references one task line declares, exactly as spelled.
 * @param text - the task's text after its ordinal.
 * @returns one token per declared reference, in first-seen order.
 */
function declaredReferences(text: string): string[] {
  /** The reference lists found, parenthesised first and colon-labelled second. */
  const lists: string[] = []
  for (const match of text.matchAll(PARENTHESISED_BLOCKS)) lists.push(match[1])
  for (const match of text.matchAll(LABELLED_BLOCKS)) lists.push(match[1])
  /** Every reference token across the lists, split on commas, `+`, `&` and `and`. */
  return lists.flatMap((list) => list.split(/[ \t]*(?:,|\+|&|\band\b)[ \t]*/i).map((token) => token.trim()).filter((token) => token !== ""))
}

/**
 * Resolve one raw task's references into ids and attach its lane owner.
 * @param task - the raw task line.
 * @param lanes - the lane key to owner map.
 * @param byLane - the raw tasks each lane declares, for a lane reference.
 * @param problems - the problem list this resolution appends to.
 * @returns the resolved plan task.
 */
function resolveTask(task: RawPlanTask, lanes: Map<string, string>, byLane: Map<string, RawPlanTask[]>, problems: PlanProblem[]): PlanTask {
  /** The ids this task's references name, before de-duplication. */
  const ids: string[] = []
  for (const token of task.references) {
    /** The numeric or `T`/`F` id the token spells, when it spells one. */
    const idMatch = /^(T|F)?([1-9][0-9]*)$/i.exec(token)
    /** The lane key the token spells, when it spells one. */
    const laneMatch = /^(?:Lane[ \t]+)?([A-Za-z][A-Za-z0-9]{0,3})$/i.exec(token)
    if (idMatch !== null) {
      ids.push(`${(idMatch[1] ?? "T").toUpperCase()}${idMatch[2]}`)
      continue
    }
    if (laneMatch !== null) {
      /** The upper-cased lane key. */
      const key = laneMatch[1].toUpperCase()
      /** The tasks that lane declares. */
      const declared = byLane.get(key) ?? []
      if (declared.length > 0) {
        for (const other of declared) if (other.id !== task.id) ids.push(other.id)
        continue
      }
    }
    problems.push({ line: task.line, text: task.source, reason: `"${token}" names no task id and no declared lane` })
  }
  /** The task's owner, read from the lane table row its marker names. */
  const owner = task.lane === undefined ? undefined : lanes.get(task.lane)
  /** The ids, de-duplicated and ordered by the drawing's own collator. */
  const blockedBy = [...new Set(ids)].sort((left, right) => ID_ORDER.compare(left, right))
  return { id: task.id, title: task.title, section: task.section, line: task.line, owner, blockedBy }
}

/**
 * Parse a task-plan markdown document into the declared graph.
 *
 * NEVER THROWS: a line the grammar cannot read is a {@link PlanProblem} and every other line still
 * produces its task. Tasks are ordered by the id collator, lanes by their key, and problems in
 * document order (line, then text), so two equal documents produce equal results.
 * @param text - the plan markdown, as read from disk.
 * @returns the declared tasks, lane owners and problems.
 */
export function parsePlanMarkdown(text: string): PlanDocument {
  /** The document's lines with fenced blocks removed. */
  const lines = readableLines(text)
  /** Everything the scan could not read. */
  const problems: PlanProblem[] = []
  /** The lane owner table collected from the whole document. */
  const lanes = collectLanes(lines, problems)
  /** The task lines, in document order; the lane table decides which markers may strip a title. */
  const raw = collectTasks(lines, lanes, problems)
  /** Task ids already claimed, so a repeated ordinal is REPORTED instead of merged. */
  const seen = new Set<string>()
  /** Raw tasks indexed by the lane key they name, for lane references. */
  const byLane = new Map<string, RawPlanTask[]>()
  for (const task of raw) {
    if (task.lane === undefined) continue
    /** The raw tasks already collected for this lane. */
    const list = byLane.get(task.lane) ?? []
    list.push(task)
    byLane.set(task.lane, list)
  }
  /** The resolved tasks, in document order until the final sort. */
  const tasks: PlanTask[] = []
  for (const task of raw) {
    if (seen.has(task.id)) {
      problems.push({ line: task.line, text: task.source, reason: `duplicate task id ${task.id}` })
      continue
    }
    seen.add(task.id)
    tasks.push(resolveTask(task, lanes, byLane, problems))
  }
  problems.sort((left, right) => left.line - right.line || left.text.localeCompare(right.text))
  /** The lane rows, ordered by key. */
  const laneRows: PlanLane[] = [...lanes].map(([key, owner]) => ({ key, owner })).sort((left, right) => ID_ORDER.compare(left.key, right.key))
  return { tasks: tasks.sort((left, right) => ID_ORDER.compare(left.id, right.id)), lanes: laneRows, problems }
}
