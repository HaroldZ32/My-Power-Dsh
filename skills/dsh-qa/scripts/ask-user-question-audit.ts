#!/usr/bin/env node
// Case ask-user-question-audit — a REPORTING tool (it has no lane mode): enumerate every
// `ask_user_question` `tool/call` in a dsh session log, classify what the model asked for, and pair
// each occurrence with the record that closed it.
//
// WHY (wave contract `.mpd/plans/ask-user-question-guard.md`, deliverable D3 / D1): the dsh-tui
// question panel rendered broken cards (missing options, once missing the question text) and the render
// path is host-owned end to end, so the ONLY way to attribute a HISTORICAL occurrence is the harness's
// own session log — the ground truth `lib/session-evidence.ts` reads, never the model's prose
// (AGENTS.md §7). This script is the instrument that shows where an occurrence sits relative to the D1
// boundary. It MUST NOT import the plugin package: the rule set below is a LOCAL prose restatement of
// the D1 deny list, and the two must agree (D1 `askUserQuestionDenial` in
// `packages/mpd-roles-plugin/src/ask-user-guard.ts` is the enforcement, this is the report).
//
// WHAT the harness records (measured 2026-10-11 against the installed harness, this workspace):
// `appendToolCall` writes `data.arguments` as the RAW model string, so a normal call reads as a JSON
// string and a call the model emitted with invalid JSON reads as that raw text — `parseArguments` in
// the agent loop preserves invalid JSON as text and maps EMPTY input to `{}`. An ANSWER is a
// `tool/result` whose `toolCallId` names the call (the answer batch, or the timeout's pending notice),
// or — for a continued/pending question — a LATER `user/message` whose `data.source.kind` is
// `user-question-reply` and whose `source.callId` names the call (`@deepseek-ai/dsh-user-questions`).
//
// Usage:
//   node skills/dsh-qa/scripts/ask-user-question-audit.ts <session-log.jsonl|session-log.jsonl.zstd>
//   node skills/dsh-qa/scripts/ask-user-question-audit.ts --self-test
//
// Exit codes: 0 the report printed (a broken occurrence is a FINDING, not a failure) · 2 usage error
// (no path, an unknown flag, or a path that is not a file) · 1 the log exists but cannot be decoded.
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { zstdCompressSync } from "node:zlib"
import { decodeSessionLog } from "./lib/session-evidence.ts"
import type { SessionRecord } from "./lib/session-evidence.ts"

/** The one tool name this audit enumerates; nothing else in the log is classified. */
const TOOL_NAME = "ask_user_question"

/** Exit code for the report itself: an occurrence that is broken is a finding, never a failure. */
const REPORT_EXIT = 0

/** Exit code for a log that exists but cannot be decoded (a corrupt container, no zstd support). */
const READ_EXIT = 1

/** Exit code for a usage error: a missing path, an unknown flag, or a path that is not a file. */
const USAGE_EXIT = 2

/** The one usage line printed for every usage error, so the caller never has to guess the shape. */
const USAGE_LINE = "usage: node skills/dsh-qa/scripts/ask-user-question-audit.ts <session-log.jsonl[.zstd]> | --self-test"

/** This script's own absolute path, used by the self-test to exercise the real CLI. */
const SELF = fileURLToPath(import.meta.url)

/** One classification verdict, spelled exactly as the wave contract names it. */
type Verdict = "ok" | "structurally-broken" | "unparseable-arguments"

/** One broken clause of the D1 rule set: which rule fired, where, and what was found there. */
interface Violation {
  /** Short rule id, mirroring the D1 deny clause that fired (e.g. `question-text-missing`). */
  readonly rule: string
  /** The argument path the rule failed at, e.g. `questions[1].options`. */
  readonly path: string
  /** What was found at that path, e.g. `absent`, `string`, `[] (empty)`, `object`. */
  readonly detail: string
}

/** The classification of one call's recorded arguments. */
interface Classification {
  /** The verdict: `ok`, `structurally-broken` or `unparseable-arguments`. */
  readonly verdict: Verdict
  /** Every broken clause, in argument order; empty for `ok` and for `unparseable-arguments`. */
  readonly violations: readonly Violation[]
  /** How many questions the decoded `questions` array carried; `0` when it could not be read. */
  readonly questions: number
  /** Option counts per question, in question order; `0` for a question without a readable array. */
  readonly options: readonly number[]
  /** For `unparseable-arguments`, the JSON decode failure; absent for every other verdict. */
  readonly note?: string
}

/** How one occurrence was paired with the record that closed it. */
interface AnswerPairing {
  /** Whether a later `tool/result` carries this call's id. */
  readonly hasResult: boolean
  /** Whether that result was flagged as an error; `false` when there is no result. */
  readonly resultIsError: boolean
  /** That result's payload character count; `0` when there is no result. */
  readonly resultChars: number
  /** Whether a later `user-question-reply` message answers this call (a pending question continued). */
  readonly hasUserAnswer: boolean
  /** That message's payload character count; `0` when there is none. */
  readonly answerChars: number
}

/** One enumerated `ask_user_question` call, with its classification and its answer pairing. */
interface Occurrence {
  /** 1-based position among the enumerated occurrences, as printed in the table. */
  readonly index: number
  /** The harness call id, or `<absent>` when the record carried none. */
  readonly callId: string
  /** The call record's 0-based position in the decoded log, for a reader who wants the raw line. */
  readonly recordIndex: number
  /** What the recorded arguments classify as. */
  readonly classification: Classification
  /** The record that closed this call, when the log carries one. */
  readonly answer: AnswerPairing
}

/** The whole audit of one session log. */
interface AuditReport {
  /** The log path, as the caller spelled it. */
  readonly file: string
  /** How many zstd frames the log decoded; `0` for a plain JSONL log. */
  readonly frames: number
  /** How many records the log decoded. */
  readonly records: number
  /** Byte offset of an incomplete final frame, or `undefined` when the container is complete. */
  readonly tornStart: number | undefined
  /** Non-empty lines that were not a JSON object (reported, never silently dropped). */
  readonly undecodableLines: number
  /** `tool/result` records whose call id could not be read, so no occurrence can ever pair with them. */
  readonly idlessResults: number
  /** Every enumerated occurrence, in log order. */
  readonly occurrences: readonly Occurrence[]
}

/** The counts the report closes with, so a reader gets the shape without re-reading the table. */
interface AuditSummary {
  /** Enumerated occurrences. */
  readonly total: number
  /** Occurrences classified `ok`. */
  readonly ok: number
  /** Occurrences classified `structurally-broken`. */
  readonly broken: number
  /** Occurrences classified `unparseable-arguments`. */
  readonly unparseable: number
  /** Violation counts by rule id, highest first (ties by rule id), for the `rules:` line. */
  readonly rules: readonly (readonly [string, number])[]
  /** Occurrences closed by a `tool/result` or by a `user-question-reply` message. */
  readonly paired: number
  /** Occurrences closed by a `tool/result`. */
  readonly results: number
  /** How many of those results were flagged as errors. */
  readonly erroredResults: number
  /** Occurrences closed by a `user-question-reply` message. */
  readonly userAnswers: number
  /** `tool/result` records in the whole log whose call id could not be read, so nothing pairs with them. */
  readonly idlessResults: number
}

/** What one CLI invocation asks for: the audit, the self-test, or the usage error to report. */
type Invocation =
  | { readonly kind: "audit"; readonly file: string }
  | { readonly kind: "self-test" }
  | { readonly kind: "usage"; readonly message: string }

/**
 * Read one property of a decoded JSON value, `undefined` for anything that is not a non-null object.
 * @param value Any decoded JSON value.
 * @param key Property name to read.
 * @returns The property value, or `undefined` when `value` is not a non-null object.
 */
function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined
  // Narrowing above proves a non-null object; indexing by a dynamic key needs the record view.
  return (value as Record<string, unknown>)[key]
}

/**
 * The string at `key` of a decoded value.
 * @param value Any decoded JSON value.
 * @param key Property name to read.
 * @returns The property value when it is a string, else `undefined`.
 */
function stringFieldOf(value: unknown, key: string): string | undefined {
  // The raw property value, before the string test.
  const raw = fieldOf(value, key)
  return typeof raw === "string" ? raw : undefined
}

/**
 * The array at `key` of a decoded value.
 * @param value Any decoded JSON value.
 * @param key Property name to read.
 * @returns The property value when it is an array, else `undefined`.
 */
function arrayFieldOf(value: unknown, key: string): readonly unknown[] | undefined {
  // The raw property value, before the array test.
  const raw = fieldOf(value, key)
  return Array.isArray(raw) ? raw : undefined
}

/**
 * Whether a decoded value is a non-null, non-array object — the only shape the host tool accepts as
 * this tool's `arguments`.
 * @param value Any decoded JSON value.
 * @returns `true` only for a plain object value.
 */
function isArgumentsObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * A one-word shape name for a value, so a violation detail says what was found instead.
 * @param value Any decoded JSON value.
 * @returns `absent`, `null`, `array`, `string`, `number`, `boolean`, `object` or `undefined`.
 */
function shapeOf(value: unknown): string {
  if (value === undefined) return "absent"
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

/**
 * The JSON decode step of the rule set, mirroring the harness's own `parseArguments`: a non-empty
 * string is the RAW model text and must parse, empty or absent input was dispatched as `{}`, and a
 * value that is already a decoded object (an older/other writer) is taken as it is.
 * @param raw The recorded `data.arguments` field, in whatever shape the log carries it.
 * @returns The dispatch value plus `unparseable` when the raw text is not valid JSON.
 */
function decodeArguments(raw: unknown): { readonly value: unknown; readonly unparseable: boolean; readonly note?: string } {
  if (raw === undefined || raw === "") return { value: {}, unparseable: false }
  if (typeof raw !== "string") return { value: raw, unparseable: false }
  try {
    return { value: JSON.parse(raw), unparseable: false }
  } catch (error) {
    return { value: undefined, unparseable: true, note: "arguments are not valid JSON: " + (error instanceof Error ? error.message : String(error)) }
  }
}

/**
 * Apply the D1 rule set — restated here as local prose, because a QA case may not import plugin code.
 * DENY (i.e. `structurally-broken`) when, in this order: `arguments` is not an object; `questions` is
 * missing, not an array, or empty; an item is not an object, or its `id` is not a NON-EMPTY string, or
 * its `question` is not a NON-EMPTY string; `options` is present and is not an array, or is empty, or
 * an entry is not an object carrying a non-empty string `label`. A question WITHOUT `options` stays
 * legal — a free-text question is a designed use of the host tool. Invalid JSON text is its own
 * verdict, `unparseable-arguments`, because the model's raw text never became a shape to check.
 * @param raw The recorded `data.arguments` field.
 * @returns The verdict, every violation found (not just the first) and the question/option counts.
 */
function classifyArguments(raw: unknown): Classification {
  // The decode step's outcome: the dispatch value or the invalid-JSON verdict.
  const decoded = decodeArguments(raw)
  if (decoded.unparseable) return { verdict: "unparseable-arguments", violations: [], questions: 0, options: [], note: decoded.note }
  // Every violation of the rule set, in argument order, so a call with two defects reports both.
  const violations: Violation[] = []
  if (!isArgumentsObject(decoded.value)) {
    violations.push({ rule: "arguments-not-object", path: "arguments", detail: shapeOf(decoded.value) })
    return { verdict: "structurally-broken", violations, questions: 0, options: [] }
  }
  // The decoded `questions` field, in whatever shape the caller sent it.
  const questions = fieldOf(decoded.value, "questions")
  if (questions === undefined) {
    violations.push({ rule: "questions-missing", path: "questions", detail: "absent" })
    return { verdict: "structurally-broken", violations, questions: 0, options: [] }
  }
  if (!Array.isArray(questions)) {
    violations.push({ rule: "questions-not-array", path: "questions", detail: shapeOf(questions) })
    return { verdict: "structurally-broken", violations, questions: 0, options: [] }
  }
  if (questions.length === 0) {
    violations.push({ rule: "questions-empty", path: "questions", detail: "[] (empty)" })
    return { verdict: "structurally-broken", violations, questions: 0, options: [] }
  }
  // Option counts per question, in question order, for the report's `options` column.
  const options: number[] = []
  for (let index = 0; index < questions.length; index += 1) {
    // The question item under inspection, at its argument path.
    const item = questions[index]
    // The item's argument path, shared by every rule that can fire below.
    const itemPath = "questions[" + String(index) + "]"
    if (!isArgumentsObject(item)) {
      violations.push({ rule: "question-item-not-object", path: itemPath, detail: shapeOf(item) })
      options.push(0)
      continue
    }
    // The item's `id`, which the host schema requires and the panel keys its card by.
    const id = stringFieldOf(item, "id")
    if (id === undefined || id.length === 0) {
      violations.push({ rule: "question-id-missing", path: itemPath + ".id", detail: id === undefined ? "absent" : "'' (empty)" })
    }
    // The item's `question` text, whose absence is what rendered a card with no prompt.
    const text = stringFieldOf(item, "question")
    if (text === undefined || text.length === 0) {
      violations.push({ rule: "question-text-missing", path: itemPath + ".question", detail: text === undefined ? "absent" : "'' (empty)" })
    }
    // The item's optional `options`; absent means a free-text question, which stays legal.
    const itemOptions = fieldOf(item, "options")
    if (itemOptions === undefined) {
      options.push(0)
      continue
    }
    if (!Array.isArray(itemOptions)) {
      violations.push({ rule: "options-not-array", path: itemPath + ".options", detail: shapeOf(itemOptions) })
      options.push(0)
      continue
    }
    options.push(itemOptions.length)
    if (itemOptions.length === 0) {
      violations.push({ rule: "options-empty", path: itemPath + ".options", detail: "[] (empty)" })
      continue
    }
    for (let optionIndex = 0; optionIndex < itemOptions.length; optionIndex += 1) {
      // The option under inspection, whose `label` is the only text the panel can render.
      const option = itemOptions[optionIndex]
      // The option's argument path, used by the label rule below.
      const optionPath = itemPath + ".options[" + String(optionIndex) + "]"
      if (!isArgumentsObject(option)) {
        violations.push({ rule: "option-label-missing", path: optionPath, detail: shapeOf(option) })
        continue
      }
      // The option's label, which must be a non-empty string to render.
      const label = stringFieldOf(option, "label")
      if (label === undefined || label.length === 0) {
        violations.push({ rule: "option-label-missing", path: optionPath + ".label", detail: label === undefined ? "absent" : "'' (empty)" })
      }
    }
  }
  return { verdict: violations.length === 0 ? "ok" : "structurally-broken", violations, questions: questions.length, options }
}

/**
 * Whether a decoded record carries the given `type` discriminator.
 * @param record Any decoded record.
 * @param type The exact `type` string to match.
 * @returns `true` only for a record whose `type` equals the argument.
 */
function recordIs(record: unknown, type: string): boolean {
  return stringFieldOf(record, "type") === type
}

/**
 * Read one `tool/result` record in whichever shape wrote it. The two shapes and why both must be read
 * are documented in `lib/session-evidence.ts`, which does not export its reader: v4 carries the tool
 * facts on the MESSAGE (`data.message.toolCallId` / `isError`), v3 keeps them on a `tool-result`
 * content BLOCK (`content[0].type === "tool-result"`). Reading only v3 is a silent-wrong-answer
 * defect — the id reads `undefined` and a failed call counts as evidence.
 * @param record Any decoded record; a record that is not `tool/result`-shaped reads as an empty result.
 * @returns The call id, the error flag and the payload text, with absent fields reading `false`/`""`.
 */
function resultOf(record: unknown): { readonly toolCallId: string | undefined; readonly isError: boolean; readonly text: string } {
  // The record's message, which is where both shapes keep everything this reader needs.
  const message = fieldOf(fieldOf(record, "data"), "message")
  // The message's content blocks, empty when the record carries none.
  const blocks = arrayFieldOf(message, "content")
  // The joined payload text, filled from whichever shape this record uses.
  const parts: string[] = []
  // Whether the MESSAGE itself carries the tool facts, which is what makes this record v4.
  const messageCarriesResult = fieldOf(message, "toolCallId") !== undefined || fieldOf(message, "isError") !== undefined
  if (messageCarriesResult) {
    for (const block of blocks ?? []) {
      // A text block's own text, accepted only when it really is a string.
      const text = stringFieldOf(block, "text")
      if (text !== undefined) parts.push(text)
    }
    return { toolCallId: stringFieldOf(message, "toolCallId"), isError: fieldOf(message, "isError") === true, text: parts.join("\n") }
  }
  // The v3 shape: the id, the flag and the payload all live on the `tool-result` content block.
  let toolCallId: string | undefined
  // The block-level error flag, false until a `tool-result` block sets it.
  let isError = false
  for (const block of blocks ?? []) {
    if (!recordIs(block, "tool-result")) continue
    if (fieldOf(block, "isError") === true) isError = true
    toolCallId = stringFieldOf(block, "toolCallId")
    for (const inner of arrayFieldOf(block, "content") ?? []) {
      // The inner block's text, accepted only when it really is a string.
      const text = stringFieldOf(inner, "text")
      if (text !== undefined) parts.push(text)
    }
  }
  return { toolCallId, isError, text: parts.join("\n") }
}

/**
 * The call id one `user/message` record answers, read from EITHER of the two places the host writes it:
 * the message source (`data.source.kind === "user-question-reply"`, `source.callId`) or the JSON
 * payload the source's text carries (`{kind:"answer_to_pending_question", callId, …}`).
 * @param record Any decoded record.
 * @returns The answered call id, or `undefined` when this record answers no question.
 */
function answeredCallIdOf(record: unknown): string | undefined {
  // The message's data, which carries both the source object and the content.
  const data = fieldOf(record, "data")
  // The source object, whose `kind`/`callId` pair is the primary marker.
  const source = fieldOf(data, "source")
  if (stringFieldOf(source, "kind") === "user-question-reply") {
    // The call id on the source, which the host always writes for a reply.
    const fromSource = stringFieldOf(source, "callId")
    if (fromSource !== undefined) return fromSource
  }
  for (const block of arrayFieldOf(data, "content") ?? []) {
    // The block's own text, which the host writes as the pending-answer JSON payload.
    const text = stringFieldOf(block, "text")
    if (text === undefined) continue
    try {
      // The parsed payload; an ordinary user message simply fails this test and is skipped.
      const parsed: unknown = JSON.parse(text)
      if (stringFieldOf(parsed, "kind") !== "answer_to_pending_question") continue
      // The call id the payload names, which is what pairs it with the original call.
      const fromPayload = stringFieldOf(parsed, "callId")
      if (fromPayload !== undefined) return fromPayload
    } catch { /* not a JSON payload: an ordinary user message */ }
  }
  return undefined
}

/**
 * Pair one call with the first record after it that closes it: a `tool/result` carrying the call's id,
 * a `user-question-reply` message naming it, or both (a timed-out call gets a pending result first and
 * the continued answer later, and the report must show both so neither is read as the other).
 * @param records Every decoded record of the log.
 * @param callIndex The call record's 0-based position in `records`.
 * @param callId The call id to pair on; `<absent>` pairs with nothing.
 * @returns The pairing facts, all false/zero when the log carries no closing record.
 */
function pairAnswer(records: readonly SessionRecord[], callIndex: number, callId: string): AnswerPairing {
  // The pairing facts, flipped as the walk below finds the closing records.
  let hasResult = false
  // Whether the paired result was flagged as an error.
  let resultIsError = false
  // The paired result's payload character count.
  let resultChars = 0
  // Whether a user-question-reply message answers this call.
  let hasUserAnswer = false
  // That message's payload character count.
  let answerChars = 0
  if (callId === "<absent>") return { hasResult, resultIsError, resultChars, hasUserAnswer, answerChars }
  for (let index = callIndex + 1; index < records.length; index += 1) {
    // The record under inspection, at its position after the call.
    const record = records[index]
    if (!hasResult && recordIs(record, "tool/result")) {
      // This result's own facts, read in whichever shape the harness wrote it.
      const result = resultOf(record)
      if (result.toolCallId === callId) {
        hasResult = true
        resultIsError = result.isError
        resultChars = result.text.length
        continue
      }
    }
    if (!hasUserAnswer && recordIs(record, "user/message") && answeredCallIdOf(record) === callId) {
      hasUserAnswer = true
      // The message's content blocks, whose text length is what the report shows.
      const blocks = arrayFieldOf(fieldOf(record, "data"), "content")
      for (const block of blocks ?? []) answerChars += (stringFieldOf(block, "text") ?? "").length
    }
    if (hasResult && hasUserAnswer) break
  }
  return { hasResult, resultIsError, resultChars, hasUserAnswer, answerChars }
}

/**
 * Parse one decoded session text into records.
 * @param text The concatenated decoded text of every frame.
 * @returns The records that parsed as JSON objects, plus the count of non-empty lines that did not.
 */
function parseRecords(text: string): { readonly records: readonly SessionRecord[]; readonly undecodableLines: number } {
  // Every record parsed from the text, in file order.
  const records: SessionRecord[] = []
  // How many non-empty lines were not a JSON object, reported rather than dropped.
  let undecodableLines = 0
  for (const line of text.split("\n")) {
    // One trimmed line, skipped when blank.
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      // The parsed line; `JSON.parse` is untyped, so the record shape is asserted after the object test.
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed === "object" && parsed !== null) records.push(parsed as SessionRecord)
      else undecodableLines += 1
    } catch {
      undecodableLines += 1
    }
  }
  return { records, undecodableLines }
}

/**
 * Enumerate and classify every `ask_user_question` call in one session log.
 * @param file Path of the session log: a concatenated-zstd container, or plain JSONL.
 * @returns The report a caller prints, with every occurrence in log order.
 * @throws When a frame fails to decompress, or this Node build has no zstd support.
 */
function auditSessionLog(file: string): AuditReport {
  // The decoded container: the concatenated text plus the frame count and any torn tail.
  const decoded = decodeSessionLog(file)
  // The records and the non-record lines the text carried.
  const { records, undecodableLines } = parseRecords(decoded.text)
  // `tool/result` records whose call id could not be read: reported, because nothing can pair with them.
  let idlessResults = 0
  for (const record of records) {
    if (recordIs(record, "tool/result") && resultOf(record).toolCallId === undefined) idlessResults += 1
  }
  // Every enumerated occurrence, in log order.
  const occurrences: Occurrence[] = []
  for (let index = 0; index < records.length; index += 1) {
    // The record under inspection.
    const record = records[index]
    if (!recordIs(record, "tool/call")) continue
    // The call's data object, which carries the tool name, the call id and the raw arguments.
    const data = fieldOf(record, "data")
    if (stringFieldOf(data, "name") !== TOOL_NAME) continue
    // The harness call id, or the printed placeholder when the record carries none.
    const callId = stringFieldOf(data, "callId") ?? "<absent>"
    occurrences.push({
      index: occurrences.length + 1,
      callId,
      recordIndex: index,
      classification: classifyArguments(fieldOf(data, "arguments")),
      answer: pairAnswer(records, index, callId),
    })
  }
  return { file, frames: decoded.frames, records: records.length, tornStart: decoded.tornStart, undecodableLines, idlessResults, occurrences }
}

/**
 * Count one report's verdicts, rules and answer pairings.
 * @param report The report to summarize.
 * @returns The counts the report's closing lines print.
 */
function summarize(report: AuditReport): AuditSummary {
  // Occurrences classified `ok`.
  let ok = 0
  // Occurrences classified `structurally-broken`.
  let broken = 0
  // Occurrences classified `unparseable-arguments`.
  let unparseable = 0
  // Violation counts by rule id, filled from every violation of every occurrence.
  const counts = new Map<string, number>()
  // Occurrences closed by a result or a reply message.
  let paired = 0
  // Occurrences closed by a `tool/result`.
  let results = 0
  // How many of those results were flagged as errors.
  let erroredResults = 0
  // Occurrences closed by a `user-question-reply` message.
  let userAnswers = 0
  for (const occurrence of report.occurrences) {
    if (occurrence.classification.verdict === "ok") ok += 1
    else if (occurrence.classification.verdict === "structurally-broken") broken += 1
    else unparseable += 1
    for (const violation of occurrence.classification.violations) counts.set(violation.rule, (counts.get(violation.rule) ?? 0) + 1)
    if (occurrence.answer.hasResult) {
      results += 1
      if (occurrence.answer.resultIsError) erroredResults += 1
    }
    if (occurrence.answer.hasUserAnswer) userAnswers += 1
    if (occurrence.answer.hasResult || occurrence.answer.hasUserAnswer) paired += 1
  }
  // The rule counts as a sorted array, highest first and ties by rule id, so the line is stable.
  const rules = [...counts.entries()].sort((left, right) => (right[1] - left[1]) || (left[0] < right[0] ? -1 : 1))
  return { total: report.occurrences.length, ok, broken, unparseable, rules, paired, results, erroredResults, userAnswers, idlessResults: report.idlessResults }
}

/**
 * Render one table cell: padded to `width`, or truncated to fit with a trailing `~` marker.
 * @param value The cell's text.
 * @param width The column width in characters.
 * @returns The cell, exactly `width` characters long.
 */
function cell(value: string, width: number): string {
  if (value.length <= width) return value.padEnd(width)
  return value.slice(0, width - 1) + "~"
}

/**
 * Render one occurrence's answer column: the closing result, the later reply, both, or `-`.
 * @param answer The occurrence's pairing facts.
 * @returns A short cell, e.g. `result ok 84c`, `result ERR 40c +answer 210c`, `answer 210c`, or `-`.
 */
function answerText(answer: AnswerPairing): string {
  // The rendered halves, joined at the end.
  const parts: string[] = []
  if (answer.hasResult) parts.push("result " + (answer.resultIsError ? "ERR" : "ok") + " " + String(answer.resultChars) + "c")
  if (answer.hasUserAnswer) parts.push((parts.length === 0 ? "" : "+") + "answer " + String(answer.answerChars) + "c")
  return parts.length === 0 ? "-" : parts.join(" ")
}

/**
 * Print one report: the decode header, the per-occurrence table, every violation by name, then the
 * summary lines.
 * @param report The report to print.
 * @returns Nothing; the text goes to stdout.
 */
function printReport(report: AuditReport): void {
  // The column widths of the occurrence table, in the order the header below prints them.
  const widths: readonly number[] = [3, 22, 21, 24, 2, 12, 24]
  console.log("[ask-user-question-audit] file: " + report.file)
  console.log("[ask-user-question-audit] decoded: " + String(report.frames) + " zstd frame(s), " + String(report.records)
    + " record(s), " + String(report.undecodableLines) + " non-record line(s), torn tail: "
    + (report.tornStart === undefined ? "none" : "byte " + String(report.tornStart)))
  console.log("[ask-user-question-audit] occurrences: " + String(report.occurrences.length) + " " + TOOL_NAME + " call(s)")
  console.log([cell("#", widths[0]), cell("callId", widths[1]), cell("verdict", widths[2]), cell("rule", widths[3]), cell("q", widths[4]), cell("options", widths[5]), cell("answer", widths[6])].join("  "))
  for (const occurrence of report.occurrences) {
    // The first violation, or `undefined` for an `ok` / `unparseable-arguments` occurrence.
    const first = occurrence.classification.violations[0]
    // The rule column: the first rule plus how many more this call broke, or `-`.
    const rule = first === undefined ? "-" : first.rule + (occurrence.classification.violations.length > 1 ? " +" + String(occurrence.classification.violations.length - 1) : "")
    console.log([
      cell(String(occurrence.index), widths[0]),
      cell(occurrence.callId, widths[1]),
      cell(occurrence.classification.verdict, widths[2]),
      cell(rule, widths[3]),
      cell(String(occurrence.classification.questions), widths[4]),
      cell(occurrence.classification.options.join("/") || "-", widths[5]),
      cell(answerText(occurrence.answer), widths[6]),
    ].join("  "))
  }
  if (report.occurrences.length === 0) console.log("  (none: this log carries no " + TOOL_NAME + " call)")
  for (const occurrence of report.occurrences) {
    if (occurrence.classification.verdict === "ok") continue
    console.log("  [" + String(occurrence.index) + "] " + occurrence.callId + "  " + occurrence.classification.verdict)
    for (const violation of occurrence.classification.violations) {
      console.log("      - " + violation.rule + " at " + violation.path + ": " + violation.detail)
    }
    if (occurrence.classification.note !== undefined) console.log("      - " + occurrence.classification.note)
    if (occurrence.answer.hasResult && occurrence.answer.resultIsError) console.log("      - the closing tool/result is an ERROR (the guard or the host refused the call)")
  }
  // The counts the closing lines print.
  const summary = summarize(report)
  console.log("[ask-user-question-audit] summary: " + String(summary.total) + " call(s) — ok " + String(summary.ok)
    + ", structurally-broken " + String(summary.broken) + ", unparseable-arguments " + String(summary.unparseable))
  console.log("[ask-user-question-audit] rules: " + (summary.rules.length === 0 ? "none fired" : summary.rules.map(([rule, count]) => rule + " " + String(count)).join(", ")))
  console.log("[ask-user-question-audit] answers: paired " + String(summary.paired) + "/" + String(summary.total)
    + " (tool-result " + String(summary.results) + ", user-message " + String(summary.userAnswers) + ", errors " + String(summary.erroredResults) + ")")
  if (summary.idlessResults > 0) {
    console.log("[ask-user-question-audit] note: " + String(summary.idlessResults) + " tool/result record(s) carry no call id, so no occurrence above can pair with them")
  }
}

/**
 * Parse this script's arguments into the one action it should take.
 * @param argv Arguments without the node executable and the script path.
 * @returns The audit target, the self-test request, or the usage error to report.
 */
function parseArgs(argv: readonly string[]): Invocation {
  for (const flag of argv.filter((arg) => arg.startsWith("--"))) {
    if (flag !== "--self-test") return { kind: "usage", message: "unknown flag " + flag }
  }
  if (argv.includes("--self-test")) return { kind: "self-test" }
  // The positional arguments, which must be exactly one session-log path.
  const paths = argv.filter((arg) => !arg.startsWith("--"))
  if (paths.length === 0) return { kind: "usage", message: "missing the <session-log> path" }
  if (paths.length > 1) return { kind: "usage", message: "expected one <session-log> path, got " + String(paths.length) }
  return { kind: "audit", file: paths[0] }
}

/**
 * Write a synthetic concatenated-zstd session container: one independently compressed frame per
 * record batch, which is exactly the shape the harness appends to (so a naive single decompress sees
 * only the first frame — the trap this fixture is built to catch).
 * @param file Path of the fixture container to write.
 * @param frames One batch of records per frame, in file order.
 * @returns The number of frames written, for the caller's own assertion.
 */
function writeFixtureFrames(file: string, frames: readonly (readonly SessionRecord[])[]): number {
  // One compressed frame per batch, each holding that batch's JSONL text.
  const parts = frames.map((batch) => zstdCompressSync(Buffer.from(batch.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")))
  writeFileSync(file, Buffer.concat(parts))
  return parts.length
}

/**
 * The offline self-test: synthetic CONCATENATED-zstd frames through the real decoder, one assertion per
 * rule of the local restatement, both answer pairings (v4 and v3 result shapes, and the continued
 * question's user-message answer), a negative control that must NOT be enumerated, and the CLI's own
 * exit codes (0 after reporting, 2 on a usage error) exercised by spawning this very script.
 * @returns Nothing; a failed assertion ends the process with exit 1.
 */
function selfTest(): void {
  /** Report one failed self-test assertion and end the run with exit 1. */
  const fail = (message: string): void => { console.error("[ask-user-question-audit self-test] FAIL: " + message); process.exit(1) }
  /** Assert one named self-test condition. */
  const check = (label: string, ok: boolean): void => { if (!ok) fail(label) }
  // The fixture frames, one record batch each: envelope, valid, the broken family, then pairings below.
  const frames: readonly (readonly SessionRecord[])[] = [
    [
      { type: "session", data: { id: "fixture-session" } },
      { type: "request/header", data: { header: { tools: [{ name: TOOL_NAME }, { name: "read" }] } } },
      { type: "tool/call", data: { callId: "call-valid", name: TOOL_NAME, arguments: JSON.stringify({ questions: [{ id: "q1", question: "Which mode?", options: [{ label: "fast" }, { label: "safe" }] }, { id: "q2", question: "Anything else?" }] }) } },
      { type: "tool/result", data: { message: { role: "tool", toolCallId: "call-valid", isError: false, content: [{ type: "text", text: JSON.stringify({ answers: [{ id: "q1", selected: ["fast"] }, { id: "q2", selected: [] }] }) }] } } },
    ],
    [
      { type: "tool/call", data: { callId: "call-broken", name: TOOL_NAME, arguments: JSON.stringify({ questions: [{ id: "q1", question: "Pick one", options: [{ label: "keep" }] }, { id: "q2", options: { label: "mis-keyed" } }] }) } },
      { type: "tool/result", data: { message: { role: "tool", toolCallId: "call-broken", isError: true, content: [{ type: "text", text: "denied: questions[1].question must be a non-empty string" }] } } },
      { type: "tool/call", data: { callId: "call-unparseable", name: TOOL_NAME, arguments: "{\"questions\": [" } },
      { type: "tool/result", data: { message: { role: "tool", content: [{ type: "tool-result", toolCallId: "call-unparseable", isError: true, content: [{ type: "text", text: "denied: arguments are not valid JSON" }] }] } } },
    ],
    [
      { type: "tool/call", data: { callId: "call-empty-questions", name: TOOL_NAME, arguments: JSON.stringify({ questions: [] }) } },
      { type: "tool/call", data: { callId: "call-missing-questions", name: TOOL_NAME, arguments: "" } },
      { type: "tool/call", data: { callId: "call-questions-not-array", name: TOOL_NAME, arguments: JSON.stringify({ questions: "q1" }) } },
      { type: "tool/call", data: { callId: "call-not-object", name: TOOL_NAME, arguments: "null" } },
      { type: "tool/call", data: { callId: "call-item-not-object", name: TOOL_NAME, arguments: JSON.stringify({ questions: ["q1"] }) } },
    ],
    [
      { type: "tool/call", data: { callId: "call-id-missing", name: TOOL_NAME, arguments: JSON.stringify({ questions: [{ question: "no id?", options: [] }] }) } },
      { type: "tool/call", data: { callId: "call-label-missing", name: TOOL_NAME, arguments: JSON.stringify({ questions: [{ id: "q1", question: "pick", options: [{ description: "no label" }] }] }) } },
      { type: "tool/call", data: { callId: "call-user-answered", name: TOOL_NAME, arguments: JSON.stringify({ questions: [{ id: "q1", question: "still there?" }] }) } },
      { type: "user/message", data: { role: "user", source: { kind: "user-question-reply", callId: "call-user-answered", outcome: "answered" }, content: [{ type: "text", text: JSON.stringify({ kind: "answer_to_pending_question", tool: TOOL_NAME, callId: "call-user-answered", questions: [{ id: "q1" }], answers: [{ id: "q1", selected: [] }] }) }] } },
      { type: "tool/call", data: { callId: "call-read", name: "read", arguments: JSON.stringify({ file_path: "/tmp/x" }) } },
    ],
  ]
  // The temp root holding the fixture container, removed before a successful exit.
  const root = mkdtempSync(join(tmpdir(), "mpd-ask-audit-"))
  // The fixture container's path; the `.zstd` suffix is what selects the frame-by-frame decode.
  const fixture = join(root, "session.v4.jsonl.zstd")
  // How many frames the fixture really holds, asserted against the decoder below.
  const frameCount = writeFixtureFrames(fixture, frames)
  // The fixture's own record count, so the decoder's count is asserted against the fixture.
  const recordCount = frames.reduce((total, batch) => total + batch.length, 0)
  // The audit of the fixture, driven through the same entry point the CLI uses.
  const report = auditSessionLog(fixture)
  /** The occurrence for one call id, or `undefined` when the audit missed it. */
  const byCall = (callId: string): Occurrence | undefined => report.occurrences.find((occurrence) => occurrence.callId === callId)
  /** The rule ids one occurrence reported, in argument order. */
  const rulesOf = (callId: string): readonly string[] => byCall(callId)?.classification.violations.map((violation) => violation.rule) ?? []

  check("the fixture decoded as " + String(frameCount) + " frames, got " + String(report.frames), report.frames === frameCount)
  check("the fixture decoded as " + String(recordCount) + " records, got " + String(report.records), report.records === recordCount)
  check("no line of the fixture should be undecodable", report.undecodableLines === 0)
  check("every fixture result carries a call id, got " + String(report.idlessResults) + " idless", report.idlessResults === 0)
  check("11 occurrences expected, got " + String(report.occurrences.length), report.occurrences.length === 11)
  check("the negative control (a `read` call) must NOT be enumerated", byCall("call-read") === undefined)

  check("a valid call must classify ok", byCall("call-valid")?.classification.verdict === "ok")
  check("a valid call reports both questions", byCall("call-valid")?.classification.questions === 2)
  check("a question without options stays legal (2 then 0)", (byCall("call-valid")?.classification.options ?? []).join("/") === "2/0")
  check("a valid call pairs with its v4 tool/result", byCall("call-valid")?.answer.hasResult === true && byCall("call-valid")?.answer.resultIsError === false && (byCall("call-valid")?.answer.resultChars ?? 0) > 0)

  check("a broken call must classify structurally-broken", byCall("call-broken")?.classification.verdict === "structurally-broken")
  check("both defects are collected, not just the first: " + rulesOf("call-broken").join(","), rulesOf("call-broken").join(",") === "question-text-missing,options-not-array")
  check("the missing question text is named at its own path", byCall("call-broken")?.classification.violations[0].path === "questions[1].question")
  check("a broken call pairs with its ERROR result", byCall("call-broken")?.answer.hasResult === true && byCall("call-broken")?.answer.resultIsError === true)

  check("invalid JSON text must classify unparseable-arguments", byCall("call-unparseable")?.classification.verdict === "unparseable-arguments")
  check("an unparseable call names no rule but keeps the decode failure", byCall("call-unparseable")?.classification.violations.length === 0 && (byCall("call-unparseable")?.classification.note ?? "").includes("not valid JSON"))
  check("the v3 result shape pairs too, with its error flag", byCall("call-unparseable")?.answer.hasResult === true && byCall("call-unparseable")?.answer.resultIsError === true)

  check("questions: [] is questions-empty", rulesOf("call-empty-questions").join(",") === "questions-empty")
  check("an empty arguments string dispatched as {} is questions-missing", rulesOf("call-missing-questions").join(",") === "questions-missing")
  check("a non-array questions field is questions-not-array", rulesOf("call-questions-not-array").join(",") === "questions-not-array")
  check("a JSON null arguments is arguments-not-object", rulesOf("call-not-object").join(",") === "arguments-not-object")
  check("a non-object question item is question-item-not-object", rulesOf("call-item-not-object").join(",") === "question-item-not-object")
  check("a missing id and an empty options array both fire", rulesOf("call-id-missing").join(",") === "question-id-missing,options-empty")
  check("an option without a label is option-label-missing", rulesOf("call-label-missing").join(",") === "option-label-missing")

  check("a continued question pairs with its user-message answer, not with a result", byCall("call-user-answered")?.answer.hasResult === false && byCall("call-user-answered")?.answer.hasUserAnswer === true && (byCall("call-user-answered")?.answer.answerChars ?? 0) > 0)
  check("a call with no closing record reports no pairing", byCall("call-missing-questions")?.answer.hasResult === false && byCall("call-missing-questions")?.answer.hasUserAnswer === false)

  // The summary counts, asserted so a vacuous pass is impossible.
  const summary = summarize(report)
  check("summary total 11, got " + String(summary.total), summary.total === 11)
  check("summary ok 2, got " + String(summary.ok), summary.ok === 2)
  check("summary structurally-broken 8, got " + String(summary.broken), summary.broken === 8)
  check("summary unparseable-arguments 1, got " + String(summary.unparseable), summary.unparseable === 1)
  check("summary paired 4 (3 results + 1 answer), got " + String(summary.paired), summary.paired === 4 && summary.results === 3 && summary.userAnswers === 1)
  check("summary errored results 2, got " + String(summary.erroredResults), summary.erroredResults === 2)

  // The CLI arms: the documented invocation must exit 0 after reporting, and a usage error must exit 2.
  /** Run this script as a child process and return its exit status plus its combined output. */
  const runCli = (args: readonly string[]): { readonly status: number | null; readonly out: string } => {
    // The spawned child: its exit status and its stdout/stderr, joined for the assertions below.
    const result = spawnSync(process.execPath, [SELF, ...args], { encoding: "utf8" })
    return { status: result.status, out: (result.stdout ?? "") + (result.stderr ?? "") }
  }
  check("no argument must be a usage error (exit 2)", runCli([]).status === 2)
  check("an unknown flag must be a usage error (exit 2)", runCli(["--nope"]).status === 2)
  check("a path that is not a file must be a usage error (exit 2)", runCli([join(root, "absent.jsonl")]).status === 2)
  check("an unknown flag reports the usage line", runCli(["--nope"]).out.includes("usage: node skills/dsh-qa/scripts/ask-user-question-audit.ts"))
  // The real CLI arm over the fixture: exit 0 after reporting, with the summary on stdout.
  const live = runCli([fixture])
  check("the report run must exit 0, got " + String(live.status), live.status === REPORT_EXIT)
  check("the report run must print the summary line", live.out.includes("summary: 11 call(s) — ok 2, structurally-broken 8, unparseable-arguments 1"))
  rmSync(root, { recursive: true, force: true })
  console.log("[ask-user-question-audit self-test] ok: " + String(frameCount) + " concatenated zstd frame(s), " + String(recordCount)
    + " record(s), 11 occurrence(s), every rule of the local restatement, both answer pairings and the CLI exit codes are verified offline")
}

/** This process's arguments, without the node executable and the script path. */
const invocation = parseArgs(process.argv.slice(2))
if (invocation.kind === "usage") {
  console.error(USAGE_LINE)
  console.error("[ask-user-question-audit] usage error: " + invocation.message)
  process.exit(USAGE_EXIT)
} else if (invocation.kind === "self-test") {
  selfTest()
} else {
  // The caller-supplied log path, checked before anything is decoded (a non-file is a usage error).
  const file = invocation.file
  if (!existsSync(file) || !statSync(file).isFile()) {
    console.error(USAGE_LINE)
    console.error("[ask-user-question-audit] usage error: not a session log file: " + file)
    process.exit(USAGE_EXIT)
  }
  /** The audit of that log, or `undefined` when the container could not be decoded. */
  let report: AuditReport | undefined
  try {
    report = auditSessionLog(file)
  } catch (error) {
    console.error("[ask-user-question-audit] cannot read " + file + ": " + (error instanceof Error ? error.message : String(error)))
  }
  if (report === undefined) {
    process.exit(READ_EXIT)
  } else {
    printReport(report)
    process.exit(REPORT_EXIT)
  }
}
