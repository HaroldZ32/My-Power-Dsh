// D5 evidence probe — the `legacy` vs `timed` question, settled on SHIPPED BYTES and a REAL session.
//
// PART A decodes one operator session store through the repository's own session-evidence reader and
// reports, for every `ask_user_question` call it carries, whether each question item carried `options`
// at all — the D5 root cause — plus the tool schema the session's request header recorded.
//
// PART B executes the INSTALLED host module (`dsh-tool-ask-user`) twice, once under the row's current
// default and once under `mode: "timed"`, and feeds both captured schemas to the host's OWN fold
// predicate, so the reported difference is the shipped behaviour rather than a reading of it.
//
// Usage: node evidence/ask-user-guard/d5-options-mandatory/<stamp>/mode-probe/probe.ts <session-log>
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

import { decodeSessionLog } from "../../../../../skills/dsh-qa/scripts/lib/session-evidence.ts"

/** The host closure this machine installed, resolved from the `dsh` CLI's own tree. */
const DSH_HOST_ROOT =
  "/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"

/** One decoded record, narrowed only as far as this probe reads. */
type Record_ = Record<string, unknown>

/**
 * Read one property off a decoded record without assuming its shape.
 * @param value - any decoded JSON value.
 * @param key - the property to read.
 * @returns the property value, or `undefined` when `value` is not a non-null object.
 */
function prop(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record_)[key] : undefined
}

/**
 * Describe one question item's `options` field: absent, an array of N entries, or another shape.
 * @param item - one question item from a recorded tool call.
 * @returns a short tag naming what the field held.
 */
function optionsShape(item: unknown): string {
  const options = prop(item, "options")
  if (options === undefined) return "ABSENT"
  if (!Array.isArray(options)) return "not-an-array:" + typeof options
  return "array(" + String(options.length) + ")"
}

/** Package versions read straight out of the installed host closure, so the evidence names its subject. */
function hostVersions(): Record<string, string> {
  const require_ = createRequire(import.meta.url)
  /** The three installed host packages this probe's conclusion rests on. */
  const names = ["dsh-tool-ask-user", "dsh-user-questions", "dsh-client-ui-user-questions"]
  return Object.fromEntries(names.map((name) => [
    name,
    String(prop(require_(DSH_HOST_ROOT + "/" + name + "/package.json"), "version")),
  ]))
}

/**
 * PART A — every `ask_user_question` call in one decoded session log, with its `options` shape.
 * @param file - the session log to decode.
 * @returns the report rows plus the ask_user_question schema the request headers recorded.
 */
function sessionArm(file: string): Record<string, unknown> {
  const decoded = decodeSessionLog(file)
  /** Every non-empty decoded line, parsed; a line that does not parse is counted, never hidden. */
  const records: unknown[] = []
  /** How many non-empty lines failed to parse as JSON. */
  let undecodable = 0
  for (const line of decoded.text.split("\n")) {
    if (line.trim() === "") continue
    try {
      records.push(JSON.parse(line))
    } catch {
      undecodable += 1
    }
  }
  /** One row per recorded call: its id and the per-item `options` shape. */
  const calls: Record<string, unknown>[] = []
  /** Every request header's `ask_user_question` parameter list, deduplicated. */
  const schemas = new Set<string>()
  for (const record of records) {
    const data = prop(record, "data")
    if (prop(record, "type") === "tool/call" && prop(data, "name") === "ask_user_question") {
      // The harness records `data.arguments` as the RAW model string, so it is parsed here first and a
      // call whose text does not parse is reported as such rather than mistaken for an empty question list.
      const raw = prop(data, "arguments")
      /** The parsed arguments object, or `null` when the recorded text is not JSON. */
      let parsed: unknown = raw
      if (typeof raw === "string") {
        try {
          parsed = JSON.parse(raw)
        } catch {
          parsed = null
        }
      }
      const questions = prop(parsed, "questions")
      calls.push({
        callId: String(prop(data, "callId") ?? "?"),
        argumentsKind: typeof raw === "string" ? "raw-string" : typeof raw,
        items: Array.isArray(questions) ? questions.length : "not-an-array",
        options: Array.isArray(questions) ? questions.map((item) => optionsShape(item)) : [],
      })
    }
    if (prop(record, "type") === "request/header") {
      const tools = prop(prop(data, "header"), "tools")
      if (!Array.isArray(tools)) continue
      for (const tool of tools) {
        if (prop(tool, "name") !== "ask_user_question") continue
        const parameters = prop(tool, "parameters")
        /** The parameter names the tool schema declared on this request. */
        const keys = Object.keys((prop(parameters, "properties") ?? {}) as Record_)
        schemas.add(JSON.stringify(keys))
      }
    }
  }
  return {
    file,
    frames: decoded.frames,
    records: records.length,
    undecodableLines: undecodable,
    tornStart: decoded.tornStart ?? "none",
    calls,
    declaredSchemas: [...schemas],
  }
}

/**
 * PART B — execute the installed module under both modes and run the host's own fold predicate.
 * @returns the captured parameter keys, the timeout property and the fold verdict per mode.
 */
async function modeArm(): Promise<Record<string, unknown>> {
  /** The installed host module under test. */
  const toolModule = await import(DSH_HOST_ROOT + "/dsh-tool-ask-user/lib/index.js")
  /** The installed service module that owns the fold predicate. */
  const serviceModule = await import(DSH_HOST_ROOT + "/dsh-user-questions/lib/index.js")
  /** Every tool definition the module registered, in application order. */
  const captured: Record<string, unknown>[] = []
  /**
   * Apply the installed module against a registry double that records what it registers.
   * @param config - the row config handed to `apply`.
   * @returns nothing; the registration lands in `captured`.
   */
  const applyWith = (config: Record<string, unknown>): void => {
    toolModule.apply({ tools: { register: (tool: Record<string, unknown>): void => { captured.push(tool) } }, userQuestions: {} }, config)
  }
  applyWith({})
  applyWith({ mode: "timed" })
  return {
    timedWaitParameter: serviceModule.TIMED_WAIT_PARAMETER,
    arms: captured.map((tool, index) => {
      const parameters = prop(tool, "parameters")
      return {
        applied: index === 0 ? "{} (row default)" : '{ mode: "timed" }',
        declaredParameters: Object.keys((prop(parameters, "properties") ?? {}) as Record_),
        timeoutProperty: prop(prop(parameters, "properties"), "timeout") === undefined ? "ABSENT" : "present",
        foldWouldTrackAskUserCalls: serviceModule.isTimedAskUserQuestionSchema({ name: tool.name, parameters }),
      }
    }),
  }
}

/** The session log this run decodes, named on the command line so the evidence is reproducible. */
const subject = process.argv[2]
if (subject === undefined) {
  console.error("usage: node probe.ts <session-log.jsonl.zstd>")
  process.exit(2)
}
console.log("[probe] host versions: " + JSON.stringify(hostVersions()))
console.log("[probe] A — real session store (decoded by skills/dsh-qa/scripts/lib/session-evidence.ts)")
console.log(JSON.stringify(sessionArm(subject), null, 1))
console.log("[probe] B — installed host module executed under both modes")
console.log(JSON.stringify(await modeArm(), null, 1))
// A torn container is reported rather than hidden; the probe still prints what it decoded.
console.log("[probe] A bytes: " + String(readFileSync(subject).length) + " (container size)")
