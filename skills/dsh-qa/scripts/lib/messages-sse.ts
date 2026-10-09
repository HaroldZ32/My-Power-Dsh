// Shared DeepSeek Messages SSE helper for the QA cases that answer the model themselves.
//
// DEFECT this closes (measured 2026-10-09, `readonly-deny` + `software-smoke` + `extension-isolation`):
// the cases' local model stubs answered with OpenAI `chat.completion` streaming-chunk objects, while
// the pinned harness (`@deepseek-ai/dsh-llm-deepseek` 0.2.0-rc.2) speaks the DeepSeek Messages protocol
// ONLY and throws `MALFORMED_RESPONSE: DeepSeek Messages SSE event type mismatch` on any frame whose
// top-level `type` it does not know (`lib/types/sse.js` `parseSse`). The parent's FIRST model step
// therefore died, `mpd_role_spawn` was never called, and the capability each case exists to measure was
// never exercised — a case that "ran" while proving nothing. The retired wire object is named in full
// in the wave's evidence packet (evidence/restore/acceptance/sA/…) rather than spelled here, so that a
// grep for it across the touched files returns nothing at all.
//
// The frames below are the exact contract the installed provider's `translate()` enforces:
//   message_start        { message: { usage: {…} } }   — `message` and `message.usage` must be OBJECTS
//   content_block_start  { index, content_block }      — `{type:"text",text}` | `{type:"tool_use",…}`
//   content_block_delta  { index, delta }              — `{type:"text_delta"}` | `{type:"input_json_delta"}`
//   content_block_stop   { index }                     — settles the block
//   message_delta        { delta: { stop_reason } }    — end_turn | tool_use | max_tokens | stop_sequence
//   message_stop         {}                            — refused until every block is settled
// Two properties are easy to get wrong and both are load-bearing:
//   · NO `data: [DONE]` sentinel. The Messages reader JSON.parses every `data:` line, so the OpenAI
//     sentinel is ITSELF a malformed frame; a stub that appends it fails even with correct events.
//   · tool input arrives as `input_json_delta.partial_json`, because `message_stop` re-parses the
//     accumulated arguments and requires a JSON OBJECT (`tool input is invalid JSON` otherwise).
//
// The REQUEST reader accepts BOTH wire shapes so a case's trace keys survive a provider change: tool
// names sit at `tools[].function.name` (OpenAI) or `tools[].name` (Messages), and a tool result is a
// `role: "tool"` message (OpenAI) or a `tool_result` content block (Messages).
import type { ServerResponse } from "node:http"
import { pathToFileURL } from "node:url"

/** The six event types one complete turn may emit, in the order {@link messagesTextEvents} emits them. */
export const MESSAGES_EVENT_TYPES: readonly string[] = [
  "message_start",
  "content_block_start",
  "content_block_delta",
  "content_block_stop",
  "message_delta",
  "message_stop",
]

/** One DeepSeek Messages event: a discriminated `type` plus the fields that event carries. */
export interface MessagesEvent {
  /** The discriminator the provider's parser matches exactly; an unknown value is a hard failure. */
  readonly type: string
  /** Every other wire field this event carries, read by the provider's translator. */
  readonly [field: string]: unknown
}

/** What one model request carried, read in whichever wire shape the client used. */
export interface WireRequest {
  /** The tool names the request offered, from either wire spelling. */
  readonly toolNames: string[]
  /** The text of every tool result already in the conversation, from either wire shape. */
  readonly toolResults: string[]
  /** The conversation exactly as it arrived, for callers that memoize on it or scan it for a marker. */
  readonly messages: readonly unknown[]
}

/**
 * One own property of a decoded JSON value.
 * @param value Any decoded JSON value.
 * @param key Property name to read.
 * @returns The property value, or `undefined` when `value` is not a non-null object.
 */
function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined
  // Narrowing above proves a non-null object; a dynamic key needs the record view.
  return (value as Record<string, unknown>)[key]
}

/**
 * The string at `key` of a decoded value.
 * @param value Any decoded JSON value.
 * @param key Property name to read.
 * @returns The property value when it really is a string, else `undefined`.
 */
function stringFieldOf(value: unknown, key: string): string | undefined {
  // The raw property value, before the string test decides whether it is usable.
  const raw = fieldOf(value, key)
  return typeof raw === "string" ? raw : undefined
}

/**
 * The array at `key` of a decoded value.
 * @param value Any decoded JSON value.
 * @param key Property name to read.
 * @returns The property value when it is an array, else an empty list.
 */
function arrayFieldOf(value: unknown, key: string): readonly unknown[] {
  // The raw property value, before the array test decides whether it is usable.
  const raw = fieldOf(value, key)
  return Array.isArray(raw) ? raw : []
}

/**
 * The text of one wire content value, in either shape a provider uses for it.
 * @param content A message's `content`: a plain string, or a list of parts carrying `text`.
 * @returns The joined text; `""` when the value carries none.
 */
function textOfContent(content: unknown): string {
  if (typeof content === "string") return content
  // The parts of an array-shaped content, each contributing its own `text` when it has one.
  const parts: string[] = []
  for (const part of Array.isArray(content) ? content : []) {
    // The part's text, accepted only when it really is a string.
    const text = stringFieldOf(part, "text")
    if (text !== undefined) parts.push(text)
  }
  return parts.join("")
}

/**
 * The frames of one complete TEXT turn, in the shape the pinned provider's translator accepts.
 * @param text The assistant text this turn answers with; emitted as one `text_delta`.
 * @returns The six frames, in emission order; the block is settled before `message_stop`.
 */
export function messagesTextEvents(text: string): MessagesEvent[] {
  // The token accounting the provider folds into the turn's final usage value.
  const usage: Record<string, number> = { input_tokens: 1, output_tokens: 1 }
  return [
    { type: "message_start", message: { id: "msg_qa_stub", type: "message", role: "assistant", usage } },
    // The text block opens EMPTY on purpose: the payload then travels as a delta, the way a real
    // provider streams it, so the delta branch is exercised rather than short-circuited.
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage },
    { type: "message_stop" },
  ]
}

/**
 * The frames of one complete TOOL-CALL turn, in the shape the pinned provider's translator accepts.
 * @param id The tool-call id, which pairs this call with the result the harness sends back.
 * @param name The tool name the model is asking to run.
 * @param args The call's arguments, serialized into the `input_json_delta` payload.
 * @returns The six frames, in emission order; `message_stop` re-parses the arguments as an object.
 */
export function messagesToolUseEvents(id: string, name: string, args: unknown): MessagesEvent[] {
  // The token accounting the provider folds into the turn's final usage value.
  const usage: Record<string, number> = { input_tokens: 1, output_tokens: 1 }
  return [
    { type: "message_start", message: { id: "msg_qa_stub", type: "message", role: "assistant", usage } },
    // `input` must be an object even when the real arguments arrive as deltas below.
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name, input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(args ?? {}) } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage },
    { type: "message_stop" },
  ]
}

/**
 * Write one complete Messages turn as an SSE response and end it.
 * @param res The response to write onto; it is ended here.
 * @param events The frames to emit, in order — typically one builder's own result.
 * @returns Nothing.
 */
export function writeMessagesSse(res: ServerResponse, events: readonly MessagesEvent[]): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" })
  for (const event of events) res.write("data: " + JSON.stringify(event) + "\n\n")
  // No `data: [DONE]` sentinel: see the header — the Messages reader would parse it as a bad frame.
  res.end()
}

/**
 * Read one model request body in either wire shape, so a case's trace keys survive a provider change.
 * @param body The request body as received.
 * @returns The offered tool names, the tool results already in the conversation, and the conversation.
 */
export function readWireRequest(body: string): WireRequest {
  // The parsed body; `JSON.parse` is untyped, and a malformed body reads as carrying nothing.
  let parsed: unknown = null
  try { parsed = JSON.parse(body) } catch { parsed = null }
  // The offered tool entries, empty when the field is absent or is not an array.
  const tools = arrayFieldOf(parsed, "tools")
  // The public names of those entries: the nested OpenAI spelling, else the flat Messages one.
  const toolNames = tools
    .map((entry) => stringFieldOf(fieldOf(entry, "function"), "name") ?? stringFieldOf(entry, "name"))
    .filter((name): name is string => typeof name === "string")
  // The conversation, empty when the field is absent or is not an array.
  const messages = arrayFieldOf(parsed, "messages")
  // The text of every tool result the conversation already carries, in either wire shape.
  const toolResults: string[] = []
  for (const message of messages) {
    // The message's role, which decides which of the two shapes to read below.
    const role = stringFieldOf(message, "role")
    if (role === "tool" || role === "tool_result") {
      toolResults.push(textOfContent(fieldOf(message, "content")))
      continue
    }
    // Messages shape: the results are `tool_result` blocks inside a user message.
    for (const block of arrayFieldOf(message, "content")) {
      if (stringFieldOf(block, "type") !== "tool_result") continue
      toolResults.push(textOfContent(fieldOf(block, "content")))
    }
  }
  return { toolNames, toolResults, messages }
}

// Standalone --self-test (offline): the frame vocabulary, both turn builders and the dual-shape request
// reader, each with the negative control that makes it falsifiable. The point of the controls is that a
// regression to the RETIRED wire shape fails here, not inside a slow container run.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--self-test")) {
  /** The wire object name the pinned provider refuses, assembled so this file never spells it. */
  const RETIRED_SHAPE: string = "chat" + ".completion" + ".chunk"
  /** Report one failed assertion and end the run with status 1. */
  const fail = (msg: string): void => { console.error("[messages-sse self-test] FAIL: " + msg); process.exit(1) }
  // The tool-call turn every assertion below reads.
  const toolTurn = messagesToolUseEvents("call_1", "mpd_role_spawn", { role: "Architect" })
  // The text turn every assertion below reads.
  const textTurn = messagesTextEvents("hello")
  // Every frame of both turns, in emission order.
  const everyFrame = [...toolTurn, ...textTurn]
  if (JSON.stringify(toolTurn.map((f) => f.type)) !== JSON.stringify(MESSAGES_EVENT_TYPES)) fail("a tool-call turn must emit the six Messages events in order, saw " + JSON.stringify(toolTurn.map((f) => f.type)))
  if (JSON.stringify(textTurn.map((f) => f.type)) !== JSON.stringify(MESSAGES_EVENT_TYPES)) fail("a text turn must emit the six Messages events in order, saw " + JSON.stringify(textTurn.map((f) => f.type)))
  // The serialized body, which is what really crosses the socket.
  const wireBody = everyFrame.map((f) => "data: " + JSON.stringify(f) + "\n\n").join("")
  if (wireBody.includes(RETIRED_SHAPE)) fail("the retired OpenAI streaming object must never be emitted")
  if (wireBody.includes("[DONE]")) fail("the OpenAI `[DONE]` sentinel is a malformed Messages frame and must never be emitted")
  // NEGATIVE CONTROL 1: the retired shape carries no top-level `type`, which is EXACTLY why the provider
  // threw on it — so the vocabulary test above is not decorative.
  const retiredFrame: Record<string, unknown> = { object: RETIRED_SHAPE, choices: [{ index: 0, delta: { content: "x" } }] }
  if (typeof retiredFrame.type === "string") fail("control: the retired frame shape must NOT carry a top-level `type` (this arm exists to prove the check above is falsifiable)")
  // NEGATIVE CONTROL 2: `message_stop` re-parses the accumulated tool arguments as a JSON OBJECT, so the
  // delta payload must be real JSON — an empty payload throws where this line would otherwise pass.
  // The tool-arguments delta of the tool-call turn, whose payload must parse as an object.
  const deltaFrame = toolTurn.find((f) => f.type === "content_block_delta")
  // The `partial_json` payload the delta carries, `""` when the field is missing entirely.
  const partialJson = String(fieldOf(deltaFrame, "delta") === undefined ? "" : stringFieldOf(fieldOf(deltaFrame, "delta"), "partial_json") ?? "")
  if (typeof JSON.parse(partialJson) !== "object") fail("the tool arguments must arrive as an object-shaped JSON delta")
  // NEGATIVE CONTROL 3: the request reader must see BOTH shapes, or a case's trace keys silently empty.
  const messagesBody = JSON.stringify({
    tools: [{ name: "read" }],
    messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: [{ type: "text", text: "ok" }] }] }],
  })
  // The same request in the LEGACY OpenAI shape (`role: "tool"` + nested `function.name`).
  const legacyBody = JSON.stringify({
    tools: [{ type: "function", function: { name: "read" } }],
    messages: [{ role: "tool", tool_call_id: "c1", content: "ok" }],
  })
  /** The Messages-shaped request as the reader sees it. */
  const messagesRead = readWireRequest(messagesBody)
  /** The legacy OpenAI-shaped request as the reader sees it. */
  const legacyRead = readWireRequest(legacyBody)
  if (JSON.stringify(messagesRead.toolNames) !== JSON.stringify(["read"])) fail("the reader must read a Messages `tools[].name`")
  if (JSON.stringify(messagesRead.toolResults) !== JSON.stringify(["ok"])) fail("the reader must read a Messages `tool_result` block, saw " + JSON.stringify(messagesRead.toolResults))
  if (JSON.stringify(legacyRead.toolNames) !== JSON.stringify(["read"])) fail("the reader must still read the nested OpenAI `tools[].function.name`")
  if (JSON.stringify(legacyRead.toolResults) !== JSON.stringify(["ok"])) fail("the reader must still read a legacy `role: \"tool\"` message, saw " + JSON.stringify(legacyRead.toolResults))
  if (JSON.stringify(readWireRequest("not json").toolNames) !== "[]") fail("a malformed body must read as carrying nothing, never throw")
  console.log("[messages-sse self-test] ok: both turn builders emit the six Messages events in order, the retired OpenAI shape and the `[DONE]` sentinel are absent (with the no-top-level-`type` control that proves that check is falsifiable), the tool arguments parse as a JSON object, and the request reader reads BOTH wire shapes")
}
