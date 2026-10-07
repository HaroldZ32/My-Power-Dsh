#!/usr/bin/env node
// Shared proof helpers for the extension QA cases (extension-lifecycle.ts and
// extension-mcp-bridge.ts), plus the multi-session isolation arm.
//
// WHY A LOCAL STUB MODEL (and why this is not a mock of the thing under test):
// `dsh` headless drives a REAL session — real plugin tree, real tool registry,
// real tool execution — but a provider credential is needed for the model step,
// and a QA sandbox must never depend on one (this environment has none: the real
// ~/.dsh holds no provider key and is read-only). So the model step is answered
// by a local OpenAI-shaped endpoint (the `software-smoke` pattern): the harness
// really executes the tool calls the stub scripts, and the results come back as
// real `tool` messages. NOTHING about the extension interface is mocked: the
// rows, the registry, the discovery, the providers, the bridge and the tools are
// the shipped ones, and every assertion is read from the HARNESS's own session
// log (`lib/session-evidence.ts`) or from the request the harness really sent.
//
// Isolation (Hard rule 1): DSH_HOME + HOME + the session cwd are all under one
// temp sandbox, the launcher cwd is a decoy directory that must never leak into a
// session, and every boot is followed by `assertSessionsSandboxed`.
//
// This module is intentionally importable: it runs nothing until a case calls it,
// and its own `--self-test` is offline (stub protocol + fixtures + contract).
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createServer, type ServerResponse } from "node:http"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import type { AddressInfo } from "node:net"
import { pathToFileURL } from "node:url"
import { REPO_ROOT, projectKey, assertSessionsSandboxed, sandboxWorkspace, type SessionSandboxVerdict } from "./lib/workspace-isolation.ts"
import { readSessionEvents, findToolCall, recordedToolNames, type SessionStore, type ToolCallEvidence } from "./lib/session-evidence.ts"
import { DSH_MISSING, dshCommand, resolveDshLauncher, type CommandSpec, type Env } from "./lib/dsh-launcher.ts"

/** The repository root, as the shared workspace-isolation helper derives it from its own URL. */
export const REPO: string = REPO_ROOT
/** QA home label of the extension cases, exported so a case can name the plane it asserts. */
export const EX_QA_HOME: string = "mpd-ext-qa"

/**
 * Abort the case with the banner every extension case prints on a hard failure.
 * @param message The failure reason, printed after the `FAIL:` prefix.
 * @returns Never: the process exits with status 1.
 */
function fail(message: string): never {
  console.error("[extension-isolation] FAIL: " + message)
  process.exit(1)
}

// ── fixtures: extension directories ─────────────────────────────────────────

/**
 * Build one QA extension skill file: frontmatter, a title and the marker line a case greps for.
 * @param name The skill name, used in the frontmatter, the title and the default description.
 * @param marker The marker the case asserts on, carried on the `QA-MARKER-SKILL:` line.
 * @param description Frontmatter description; defaults to a QA sentence naming the skill.
 * @returns The complete `SKILL.md` text this case writes into the extension directory.
 */
export const SKILL_MD = (name: string, marker: string, description: string = `QA extension skill ${name}`): string => `---
name: ${name}
description: "${description}"
---

# ${name}

QA-MARKER-SKILL:${marker}
`

/** One step of a flow fixture: a title plus whichever of detail/tool/output the case declares. */
interface FlowStep {
  /** Step title, rendered as the plan line. */
  readonly title: string
  /** Step detail; the QA marker is carried here so a case can grep it back out. */
  readonly detail?: string
  /** Tool the step names, when the flow asks for one. */
  readonly tool?: string
  /** Expected output description, when the step declares one. */
  readonly output?: string
}

/** A flow fixture file in the shape the extension contract's `flows` contribution loads. */
export interface FlowFile {
  /** The flow id the `mpd_flow_*` tools address. */
  readonly id: string
  /** Human-readable title shown by `mpd_flow_list`/`mpd_flow_show`. */
  readonly title: string
  /** One-line description; derived from the id so a case cannot drift. */
  readonly description: string
  /** When-to-use sentence shown in the flow catalog. */
  readonly whenToUse: string
  /** Ordered steps; at least one, so `steps.length > 0` stays a real assertion. */
  readonly steps: readonly FlowStep[]
}

/**
 * Build one QA flow fixture, marker included in the first step's detail.
 * @param id The flow id the `mpd_flow_*` tools address.
 * @param title The flow title.
 * @param marker The marker line the case asserts on.
 * @returns The flow file object, written as JSON by `writeExtension`.
 */
export const FLOW_JSON = (id: string, title: string, marker: string): FlowFile => ({
  id,
  title,
  description: `QA extension flow ${id}`,
  whenToUse: "Use when the extension QA case asks for this flow.",
  steps: [
    { title: "Read the input", detail: `QA-MARKER-FLOW:${marker}`, tool: "read" },
    { title: "Report the findings", output: "A short list of findings." },
  ],
})

/**
 * Build one QA role persona file, marker included.
 * @param marker The marker the case asserts on, on the `QA-MARKER-PERSONA:` line.
 * @returns The persona markdown the role contribution points at.
 */
export const PERSONA_MD = (marker: string): string => `You are a QA extension role. QA-MARKER-PERSONA:${marker}\n`

/** One skill-root contribution: the directory a skill family is discovered from. */
interface ExtensionSkillContribution {
  /** Skill root, relative to the extension directory; `../escape` is the invalid fixture form. */
  readonly root: string
  /** Rank within the layer; a string here is the deliberately invalid fixture form. */
  readonly rank?: number | string
}

/** One flow-directory contribution. */
interface ExtensionFlowContribution {
  /** Flow directory, relative to the extension directory. */
  readonly dir: string
  /** Rank within the layer; a string here is the deliberately invalid fixture form. */
  readonly rank?: number | string
}

/** One stdio MCP server contribution: what the runtime bridge spawns for this extension. */
interface ExtensionMcpContribution {
  /** Server name; the public tool name is derived from it as `mcp__<serverName>__<raw>`. */
  readonly serverName: string
  /** Transport; only `stdio` is bridged by the shipped runtime. */
  readonly transport?: string
  /** Executable the bridge spawns. */
  readonly command?: string
  /** Arguments for that executable. */
  readonly args?: readonly string[]
  /** Working directory for the child, when it differs from the extension directory. */
  readonly cwd?: string
  /** Environment overlay added to the child's inherited environment. */
  readonly env?: Record<string, string>
  /** Handshake deadline in milliseconds; the `hang` arm is time-boxed by this. */
  readonly connectTimeoutMs?: number
  /** Per-call deadline in milliseconds. */
  readonly toolCallTimeoutMs?: number
}

/** One role contribution: a named persona the roster-facing tools can address. */
interface ExtensionRoleContribution {
  /** Role name the `mpd_role_*` tools address. */
  readonly name: string
  /** One-line description of what the role does. */
  readonly description?: string
  /** Whether the role is denied every writing tool. */
  readonly readonly?: boolean
  /** Persona markdown path, relative to the extension directory. */
  readonly persona: string
}

/** The contribution block of a descriptor: the four kinds the contract knows, plus the invalid extras a case declares. */
interface ExtensionContributes {
  /** Skill roots this extension contributes. */
  readonly skills?: readonly ExtensionSkillContribution[]
  /** Flow directories this extension contributes. */
  readonly flows?: readonly ExtensionFlowContribution[]
  /** Stdio MCP servers this extension contributes; the host plane is the only one allowed to. */
  readonly mcp?: readonly ExtensionMcpContribution[]
  /** Roles this extension contributes; process-global registration is host-plane only. */
  readonly roles?: readonly ExtensionRoleContribution[]
  /** Any further contribution kind, so a deliberately invalid fixture can be expressed. */
  readonly [kind: string]: unknown
}

/**
 * A descriptor as a case writes it: the contract fields plus whatever further key the case adds.
 * `contributes` is required because `manifest()` always writes it (defaulting to `{}`).
 */
interface ExtensionDescriptor {
  /** Descriptor schema version; the invalid-version fixture writes 9 on purpose. */
  readonly apiVersion: number
  /** The extension id, validated against `^[a-z0-9][a-z0-9-]{0,63}$` (no underscores). */
  readonly id: string
  /** One-line description; the invalid-version fixture omits it on purpose. */
  readonly description?: string
  /** What the extension contributes. */
  readonly contributes: ExtensionContributes
  /** Any further key, so an out-of-contract fixture keeps its extra fields on disk. */
  readonly [extra: string]: unknown
}

/** Assets `writeExtension` materializes beside the manifest. */
export interface ExtensionAssets {
  /** Skill files keyed by skill directory name; each becomes `skills/<name>/SKILL.md`. */
  readonly skills?: Record<string, string>
  /** Flow files keyed by file name; a string is written verbatim, anything else as JSON. */
  readonly flows?: Record<string, string | object>
  /** Arbitrary further files keyed by path relative to the extension directory. */
  readonly files?: Record<string, string>
}

/**
 * Write one extension directory (data plane) with optional assets.
 * @param baseDir The extensions root the directory is created under.
 * @param id The extension directory name (also the descriptor id the case uses).
 * @param manifest The descriptor to serialize, or a raw string for the invalid-JSON fixture.
 * @param assets Skill/flow/extra files to materialize beside the manifest.
 * @returns The absolute extension directory that was written.
 */
export function writeExtension(baseDir: string, id: string, manifest: string | ExtensionDescriptor, assets: ExtensionAssets = {}): string {
  // The extension directory this call owns, created before anything is written into it.
  const dir = join(baseDir, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "mpd-ext.json"), JSON.stringify(manifest, null, 2) + "\n")
  for (const [name, content] of Object.entries(assets.skills ?? {})) {
    mkdirSync(join(dir, "skills", name), { recursive: true })
    writeFileSync(join(dir, "skills", name, "SKILL.md"), content)
  }
  for (const [name, content] of Object.entries(assets.flows ?? {})) {
    mkdirSync(join(dir, "flows"), { recursive: true })
    writeFileSync(join(dir, "flows", name), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n")
  }
  for (const [name, content] of Object.entries(assets.files ?? {})) {
    writeFileSync(join(dir, name), content)
  }
  return dir
}

/**
 * A minimal, contract-conforming descriptor.
 * @param id The extension id the descriptor declares.
 * @param contributes The contribution block; defaults to the empty block.
 * @param extra Any further descriptor key the case needs (a deliberately invalid value included).
 * @returns The descriptor object `writeExtension` serializes.
 */
export function manifest(id: string, contributes: ExtensionContributes = {}, extra: Record<string, unknown> = {}): ExtensionDescriptor {
  return { apiVersion: 1, id, description: `QA extension ${id}`, contributes, ...extra }
}

// ── the local OpenAI-shaped stub model ──────────────────────────────────────

/** One scripted step: exactly one of a tool call and a closing text, never both. */
type StubStep =
  | {
      /** Public name of the tool to call. */
      readonly tool: string
      /** Arguments for the call; `{}` when the step omits them. */
      readonly args?: Record<string, unknown>
      /** Unset on a tool step: this is what tells the two variants apart. */
      readonly text?: undefined
    }
  | {
      /** Unset on a text step: this is what tells the two variants apart. */
      readonly tool?: undefined
      /** The closing assistant text of the turn. */
      readonly text: string
    }

/** The stub's answer to one request: a tool call or a text turn, with the reason it decided so. */
type StubDecision =
  | {
      /** Discriminator of a text turn. */
      readonly kind: "text"
      /** The assistant text streamed back. */
      readonly text: string
      /** Why the stub answered this way, recorded in the trace. */
      readonly why: string
    }
  | {
      /** Discriminator of a tool call. */
      readonly kind: "tool"
      /** Public name of the tool the harness must call. */
      readonly name: string
      /** Arguments the call is issued with. */
      readonly args: Record<string, unknown>
      /** Why the stub answered this way, recorded in the trace. */
      readonly why: string
    }

/** One trace entry: what the harness offered, what it had already answered, and the stub's reply. */
interface StubTraceEntry {
  /** 1-based ordinal of this request within the stub's lifetime. */
  readonly request: number
  /** The request path the harness called. */
  readonly path: string
  /** Public names of every tool the harness offered for this request. */
  readonly offeredTools: string[]
  /** How many tool results the conversation already carried. */
  readonly toolResultCount: number
  /** The text of each tool result, in message order. */
  readonly toolResults: string[]
  /** Why the stub answered this way, marked `(memoized)` on a replayed answer. */
  readonly decision: string
  /** Whether the answer was computed now or replayed from the memo. */
  readonly decided: "fresh" | "memoized"
}

/** The single choice of one streaming chunk. */
interface ChatChunkChoice {
  /** Choice index; always 0 for this single-choice stub. */
  readonly index: number
  /** The incremental payload the harness accumulates into an assistant message. */
  readonly delta: Record<string, unknown>
  /** The stop reason, `null` while the turn continues. */
  readonly finish_reason: string | null
}

/** One chunk in the OpenAI streaming shape the harness's SSE reader parses. */
interface ChatChunk {
  /** Synthetic completion id, stable so a memoized answer looks like a fresh one. */
  readonly id: string
  /** The wire object kind the SSE reader keys on. */
  readonly object: string
  /** Synthetic creation stamp; the stub never varies it. */
  readonly created: number
  /** The model label the stub answers as. */
  readonly model: string
  /** Exactly one choice, carrying the delta and its finish reason. */
  readonly choices: ChatChunkChoice[]
}

/** One wire message of the stub protocol: only the fields the driver reads are named. */
interface StubMessage {
  /** The speaker role, tested against the two tool-result spellings. */
  readonly role?: unknown
  /** The message content: a plain string, or an array of text parts. */
  readonly content?: unknown
  /** Tool calls an assistant message asks for; only the probe's own request literals carry them. */
  readonly tool_calls?: readonly unknown[]
  /** The call id a tool-result message answers; only the probe's own request literals carry it. */
  readonly tool_call_id?: string
}

/** One content part of a message: a bare string, or an object whose `text` is read. */
type MessagePart = string | { readonly text?: unknown }

/** One tool entry as it appears in a request: the OpenAI nesting, or the flat name spelling. */
interface OfferedToolWire {
  /** The OpenAI nesting whose `name` is the public tool name. */
  readonly function?: { readonly name?: unknown } | undefined
  /** The flat spelling some clients send instead. */
  readonly name?: unknown
}

/** The knobs `makeStubModel` accepts. */
interface StubModelOptions {
  /** Ordered script steps: a tool call while steps remain, else the closing text. */
  readonly script?: readonly StubStep[]
  /** Marker in a request's messages that identifies a spawned child turn. */
  readonly childMarker?: string
  /** Text handed to a spawned child with no child script left. */
  readonly childAnswer?: string
  /** Script for spawned-child turns, when the flat child answer is not enough. */
  readonly childScript?: readonly StubStep[] | null
  /** Label used in chunk ids and in the `call_…` tool-call id. */
  readonly label?: string
}

/** The running stub: its trace, its lifecycle and its request counter. */
interface StubModel {
  /** Every request the stub answered, in arrival order. */
  readonly trace: StubTraceEntry[]
  /** Start listening on an ephemeral loopback port. @returns the bound port. */
  readonly listen: () => Promise<number>
  /** Stop the server. @returns a promise resolving once the listener is closed. */
  readonly close: () => Promise<void>
  /** How many requests the stub has answered so far. @returns the count. */
  readonly requests: () => number
}

/**
 * A deterministic OpenAI-shaped streaming endpoint.
 *
 * `script` is a list of steps:
 *   { tool: "<name>", args: {...} }   issue one real tool call
 *   { text: "..." }                   finish the turn with assistant text
 * A request whose conversation already contains a tool result advances the
 * script by the NUMBER OF TOOL RESULTS it sees, so the driver is stateless and
 * safe against a repeated request (the response is memoized by message hash).
 * A request carrying `childMarker` and NO tool results is a spawned subagent
 * (role spawn / workmate): it gets `childAnswer` immediately.
 * @param options.script The ordered steps of the main conversation.
 * @param options.childMarker Marker identifying a spawned child's request.
 * @param options.childAnswer Text handed to a spawned child.
 * @param options.childScript Optional script for spawned-child turns.
 * @param options.label Label used in the chunk and tool-call ids.
 * @returns The running stub, with its trace and lifecycle handles.
 */
export function makeStubModel({
  script = [],
  childMarker = "",
  childAnswer = "QA-STUB-CHILD-OK",
  childScript = null,
  label = "stub",
}: StubModelOptions = {}): StubModel {
  // Every request the stub answered, in arrival order, read by the cases' assertions.
  const trace: StubTraceEntry[] = []
  // Answers already computed, keyed by the message-hash + offered-tool-list key.
  const memo = new Map<string, StubDecision>()
  // How many requests have arrived; also the trace ordinal.
  let requests = 0
  /**
   * One chunk in the wire shape the harness's SSE reader parses.
   * @param delta The incremental payload of this chunk.
   * @param finish The stop reason; omitted while the turn continues.
   * @returns The chunk object serialized into one `data:` line.
   */
  const chunk = (delta: Record<string, unknown>, finish?: string): ChatChunk => ({
    id: "chatcmpl-" + label,
    object: "chat.completion.chunk",
    created: 1,
    model: label,
    choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  })
  /**
   * Write the whole SSE response: one `data:` chunk plus the `[DONE]` sentinel.
   * @param res The response to write onto.
   * @param payload The chunk to serialize.
   * @returns Nothing; the response is ended here.
   */
  const sse = (res: ServerResponse, payload: ChatChunk): void => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" })
    res.write("data: " + JSON.stringify(payload) + "\n\n")
    res.write("data: [DONE]\n\n")
    res.end()
  }
  /**
   * The text of one wire message, whichever content shape the client sent.
   * @param message The message to read.
   * @returns Its text: a plain string, or the concatenated `text` of its parts.
   */
  const textOf = (message: StubMessage): string => {
    // The content before the string/array distinction is made.
    const content = message?.content
    if (typeof content === "string") return content
    // `Array.isArray` widens the unknown content to `any[]`; naming the part shape keeps
    // each part's `text` read typed instead of implicit `any`.
    if (Array.isArray(content)) return (content as readonly MessagePart[]).map((part) => (typeof part === "string" ? part : part?.text ?? "")).join("")
    return ""
  }
  /** Answer one request: a tool call while the script has steps, else plain text. */
  const decide = (offeredTools: string[], toolResults: string[], blob: string): StubDecision => {
    if (offeredTools.length === 0) return { kind: "text", text: "QA-STUB-NO-TOOLS", why: "plain text (no tools offered)" }
    if (childMarker !== "" && blob.includes(childMarker) && toolResults.length === 0
      || (childMarker !== "" && blob.includes(childMarker) && childScript !== null && toolResults.length < childScript.length)) {
      if (childScript !== null) {
        // The child's next step, `undefined` once the child script is exhausted.
        const step: StubStep | undefined = childScript[toolResults.length]
        if (step !== undefined && step.text === undefined) {
          return { kind: "tool", name: step.tool, args: step.args ?? {}, why: "spawned-child step " + step.tool }
        }
      }
      return {
        kind: "text",
        // The guard above already proved this element's `text` is set, but TS cannot carry
        // that narrowing across the repeated indexed access, so the assertion restates it.
        text: (childScript !== null && childScript[toolResults.length]?.text !== undefined ? childScript[toolResults.length].text : childAnswer) as string,
        why: "spawned-child answer",
      }
    }
    // The main script's next step, `undefined` once every step has been consumed.
    const step: StubStep | undefined = script[toolResults.length]
    if (step === undefined || step.text !== undefined) {
      return { kind: "text", text: step?.text ?? "QA-STUB-SCRIPT-EXHAUSTED", why: "final text" }
    }
    return { kind: "tool", name: step.tool, args: step.args ?? {}, why: "tool call " + step.tool }
  }
  // The loopback HTTP endpoint the harness sends its chat completions to.
  const server = createServer((req, res) => {
    // The request body accumulated across `data` events.
    let body = ""
    req.on("data", (piece: Buffer) => { body += piece })
    req.on("end", () => {
      // The parsed request body; a malformed body stays the empty object.
      let parsed: Record<string, unknown> = {}
      try { parsed = JSON.parse(body) } catch { /* keep {} */ }
      // The offered tool entries, or none when the field is absent or not an array.
      const tools: readonly OfferedToolWire[] = Array.isArray(parsed.tools) ? parsed.tools : []
      // The public names of those entries; a nameless entry contributes nothing.
      const offeredTools: string[] = tools.map((entry) => entry?.function?.name ?? entry?.name).filter((name): name is string => typeof name === "string")
      // The conversation, or none when the field is absent or not an array.
      const messages: readonly StubMessage[] = Array.isArray(parsed.messages) ? parsed.messages : []
      // The text of every tool result the conversation already carries.
      const toolResults = messages.filter((message) => message?.role === "tool" || message?.role === "tool_result").map(textOf)
      // The serialized conversation, hashed into the memo key.
      const blob = JSON.stringify(messages)
      requests += 1
      // The memo key: the conversation plus the tool list offered for it.
      const key = createHash("sha256").update(blob + "\u0000" + offeredTools.join(",")).digest("hex")
      // The answer already computed for this key, if any.
      const cached = memo.get(key)
      // The answer to send: the memoized one, or a freshly decided one.
      const decision = cached ?? decide(offeredTools, toolResults, blob)
      memo.set(key, decision)
      trace.push({
        request: requests,
        path: req.url ?? "",
        offeredTools,
        toolResultCount: toolResults.length,
        toolResults,
        decision: decision.why + (cached === undefined ? "" : " (memoized)"),
        decided: cached === undefined ? "fresh" : "memoized",
      })
      if (decision.kind === "text") return sse(res, chunk({ role: "assistant", content: decision.text }, "stop"))
      return sse(res, chunk({
        role: "assistant",
        tool_calls: [{
          index: 0,
          id: "call_" + label + "_" + toolResults.length,
          type: "function",
          function: { name: decision.name, arguments: JSON.stringify(decision.args) },
        }],
      }))
    })
  })
  return {
    trace,
    // The listener is bound to a TCP port, so `address()` is always an AddressInfo here;
    // the `AddressInfo | string | null` union @types/node declares cannot say that.
    listen: () => new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port))),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    requests: () => requests,
  }
}

// ── sandbox + boot ──────────────────────────────────────────────────────────

/** The five sandbox paths and the child environment every boot of one case carries. */
export interface ExtensionSandbox {
  /** The temp sandbox root every other path here lives under. */
  readonly sandbox: string
  /** The isolated DSH home the installer writes and the boot reads. */
  readonly dshHome: string
  /** The sandboxed HOME, so no skill root can leak in from the real home. */
  readonly runHome: string
  /** The sandboxed session workspace every boot cwd points at. */
  readonly ws: string
  /** The decoy cwd whose extension must stay invisible to the sandboxed sessions. */
  readonly decoy: string
  /** The child environment, with DSH_HOME/HOME/the stub API key already pinned. */
  readonly env: Env
}

/**
 * One temp sandbox: DSH_HOME (`dsh-home`), HOME (`run-home`) and the session
 * workspace (`ws`) plus a decoy directory (`decoy`) that holds the extension a
 * process-cwd-based (apply-time) discovery would wrongly show every session.
 * @param slug The case slug, used in the temp-directory prefix and in failure banners.
 * @returns The sandbox paths plus the child environment every boot must carry.
 */
export function createSandbox(slug: string): ExtensionSandbox {
  // The temp root holding the isolated home, home and workspaces.
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-" + slug + "-"))
  // The isolated DSH home the installer writes into.
  const dshHome = join(sandbox, "dsh-home")
  // The sandboxed HOME, so `~/.agents/skills` and friends cannot leak in.
  const runHome = join(sandbox, "run-home")
  // The decoy cwd that carries an extension no sandboxed session may see.
  const decoy = join(sandbox, "decoy")
  mkdirSync(dshHome, { recursive: true })
  mkdirSync(runHome, { recursive: true })
  mkdirSync(decoy, { recursive: true })
  // The sandboxed session workspace every boot cwd is set to.
  const ws = sandboxWorkspace(sandbox)
  // The child environment: isolation plus the stub's placeholder API key.
  const env: Env = {
    ...process.env,
    DSH_HOME: dshHome,
    HOME: runHome,
    DEEPSEEK_API_KEY: "sk-extension-qa-local-stub",
  }
  // The real home is `$HOME` on POSIX and `%USERPROFILE%` on win32. With `process.env.HOME ?? ""`
  // this guard degenerated to `startsWith(".dsh")` - which no absolute temp path can match - so
  // it silently passed on Windows instead of failing a real-home leak (measured 2026-09-22).
  const realHome = process.env.HOME || process.env.USERPROFILE || homedir()
  if (dshHome.startsWith(join(realHome, ".dsh"))) fail(slug + ": isolation assertion — DSH_HOME is the real home")
  return { sandbox, dshHome, runHome, ws, decoy, env }
}

/** What `installProfile` needs to install the bundle rows into a sandbox. */
interface ProfileInstallOptions {
  /** The sandbox root the installer runs in (its cwd). */
  readonly sandbox: string
  /** The isolated DSH home the installer writes the profile into. */
  readonly dshHome: string
  /** The child environment carrying the sandboxed DSH_HOME/HOME. */
  readonly env: Env
  /** Wall-clock ceiling for the install, in milliseconds. */
  readonly timeoutMs?: number
}

/** The outcome of one spawned command, with stdout and stderr joined. */
export interface RunResult {
  /** The child's exit status, or `-1` when it could not be spawned at all. */
  readonly status: number | null
  /** Its combined stdout+stderr, in arrival order. */
  readonly out: string
}

/**
 * Install the bundle rows for the headless profile into the sandbox (checkout-absolute paths).
 * @param options.sandbox The sandbox root to run the installer in.
 * @param options.dshHome The isolated DSH home to install into.
 * @param options.env The sandboxed child environment.
 * @param options.timeoutMs Wall-clock ceiling for the install.
 * @returns The installer's exit status and combined output.
 */
export function installProfile({ sandbox, dshHome, env, timeoutMs = 900000 }: ProfileInstallOptions): Promise<RunResult> {
  return runAsync(process.execPath, [
    join(REPO, "scripts", "install-profile.ts"),
    "--yes", "--dsh-home", dshHome, "--profile", "mpd-headless", "--skip-toolchain",
  ], { env, cwd: sandbox, timeoutMs })
}

/**
 * Point the harness's deepseek route at the local stub (appended to the composed home patch).
 * @param dshHome The isolated DSH home whose patch file is amended.
 * @param port The loopback port the stub listens on.
 * @returns The patch file that was rewritten.
 */
export function useStubRoute(dshHome: string, port: number): string {
  // The composed home patch the installer wrote, amended in place.
  const patchFile = join(dshHome, "cordis.patch.yml")
  // The amended document: the composed patch plus an id-targeted llm-deepseek row.
  const patch = readFileSync(patchFile, "utf8") + [
    "",
    "- id: llm-deepseek",
    "  config:",
    "    baseURL: http://127.0.0.1:" + port + "/v1",
    "    apiKeyEnv: DEEPSEEK_API_KEY",
    "",
  ].join("\n")
  writeFileSync(patchFile, patch)
  return patchFile
}

/** How one child command is spawned and where. */
interface RunOptions {
  /** Child environment; defaults to this process's own when omitted. */
  readonly env?: Env
  /** Working directory the child starts in. */
  readonly cwd: string
  /** Wall-clock ceiling in milliseconds, passed through to `spawn`. */
  readonly timeoutMs: number
}

/**
 * Spawn one child and collect its combined output.
 * @param cmd The executable, or the bare name `"dsh"` for the PATH-resolved launcher.
 * @param args The argument vector.
 * @param opts Environment, cwd and timeout for the child.
 * @returns The exit status and combined output; `-1` plus the reason when no launcher resolves.
 */
export function runAsync(cmd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    // `cmd` may be the bare launcher name ("dsh"): see lib/dsh-launcher.ts for why that
    // is not portable - and why this module resolves it in-process instead.
    const spec: CommandSpec | null = cmd === "dsh" ? dshCommand(args, opts.env ?? process.env) : { command: cmd, args }
    if (spec === null) { resolve({ status: -1, out: DSH_MISSING }); return }
    // The spawned child whose output this promise collects.
    const child = spawn(spec.command, spec.args, { ...opts, stdio: ["ignore", "pipe", "pipe"] })
    // The combined stdout+stderr collected so far.
    let out = ""
    child.stdout.on("data", (piece: Buffer) => { out += piece })
    child.stderr.on("data", (piece: Buffer) => { out += piece })
    child.on("error", (error) => resolve({ status: -1, out: out + "\nspawn error: " + error.message }))
    child.on("close", (status) => resolve({ status, out }))
  })
}

/** What one boot of a real headless session needs. */
interface BootSessionOptions {
  /** Case slug, used in failure banners. */
  readonly slug: string
  /** The sandboxed child environment. */
  readonly env: Env
  /** Session workspace: the cwd the session's state must be keyed by. */
  readonly cwd: string
  /** The user prompt the session starts from. */
  readonly prompt: string
  /** The stub answering the model step, when the caller keeps one to read its trace. */
  readonly stub?: StubModel
  /** Wall-clock ceiling for the boot, in milliseconds. */
  readonly timeoutMs?: number
  /** Extra `dsh` CLI flags inserted before the prompt. */
  readonly extraArgs?: readonly string[]
}

/** One boot's result: the child outcome plus the timing and stub counters. */
interface BootSessionResult extends RunResult {
  /** How long the boot took, in milliseconds. */
  readonly durationMs: number
  /** How many requests the stub answered for this boot (0 when no stub was passed). */
  readonly stubRequests: number
}

/**
 * One real headless session: a REAL dsh process whose model step the stub answers.
 * @param options.slug The case slug.
 * @param options.env The sandboxed child environment.
 * @param options.cwd The sandboxed session workspace.
 * @param options.prompt The prompt the session starts from.
 * @param options.stub The stub to read the request count from.
 * @param options.timeoutMs Wall-clock ceiling for the boot.
 * @param options.extraArgs Extra CLI flags inserted before the prompt.
 * @returns The boot outcome, its duration and the stub's request count.
 */
export async function bootSession({ slug, env, cwd, prompt, stub, timeoutMs = 900000, extraArgs = [] }: BootSessionOptions): Promise<BootSessionResult> {
  // The instant the boot starts, so the duration is measured around the spawn.
  const started = Date.now()
  // The boot's child outcome.
  const run = await runAsync("dsh", ["--profile", "mpd-headless", ...extraArgs, prompt], { env, cwd, timeoutMs })
  return { ...run, durationMs: Date.now() - started, stubRequests: stub === undefined ? 0 : stub.requests() }
}

/** The harness-recorded evidence of one session: the store, its tool names and the per-name pairings. */
interface SessionEvidenceBundle {
  /** The decoded session store the assertions read. */
  readonly store: SessionStore
  /** Every tool name the harness recorded in that store. */
  readonly names: string[]
  /** One pairing verdict per requested tool name, keyed by that name. */
  readonly calls: Record<string, ToolCallEvidence>
}

/**
 * Read the harness-recorded evidence of one workspace's newest session.
 * @param dshHome The isolated DSH home holding the session store.
 * @param ws The workspace whose project-keyed store is read.
 * @param toolNames The tool names to pair, in the order they are recorded.
 * @returns The store, the recorded tool names and one pairing per requested name.
 */
export function sessionEvidence(dshHome: string, ws: string, toolNames: readonly string[] = []): SessionEvidenceBundle {
  // The decoded store of the newest session under this workspace's project key.
  const store = readSessionEvents(dshHome, { workspace: ws })
  // Every tool name the harness recorded, in record order.
  const names = recordedToolNames(store.records)
  // One `tool/call` + `tool/result` pairing per requested tool name.
  const calls: Record<string, ToolCallEvidence> = {}
  for (const name of toolNames) calls[name] = findToolCall(store.records, name)
  return { store, names, calls }
}

/** One content part of a tool result: only its `text` field is read here. */
interface ResultPart {
  /** The part's text, when the part carries one. */
  readonly text?: unknown
}

/** One `tool-result` content block of a recorded result message. */
interface ToolResultBlock {
  /** Block discriminator; only `"tool-result"` blocks carry a paired result here. */
  readonly type?: unknown
  /** The harness call id this result belongs to, a string by construction. */
  readonly toolCallId?: string
  /** The block's content parts, unvalidated: the reader narrows it with `Array.isArray`. */
  readonly content?: unknown
  /** Whether the harness marked the result as an error. */
  readonly isError?: unknown
}

/** The `tool/result` record payload, as far as the per-call read needs it. */
interface ToolResultRecordData {
  /** The message the harness stored for the result. */
  readonly message?: {
    /** Its content blocks, unvalidated: the reader narrows it with `Array.isArray`. */
    readonly content?: unknown
  }
}

/** The text and error flag paired by one `tool/result` block. */
interface ToolResultSummary {
  /** The joined text of every content part the block carries. */
  readonly text: string
  /** True when the harness flagged the result as an error. */
  readonly isError: boolean
}

/**
 * Per-call results: `findToolCall` joins every result of a tool name, which is
 * useless when one session calls the same tool several times with different
 * arguments (the MCP case calls `mpd_ext_show` once per extension). Pairing by
 * `toolCallId` keeps every assertion tied to the call it belongs to.
 * @param store The decoded session store to read.
 * @returns Every `tool-result` block keyed by its call id (or `undefined` when the block carried none).
 */
export function toolResultsByCallId(store: SessionStore): Map<string | undefined, ToolResultSummary> {
  // The paired results, keyed by the call id the result block carries.
  const map = new Map<string | undefined, ToolResultSummary>()
  for (const record of store?.records ?? []) {
    if (record?.type !== "tool/result") continue
    // The record's payload as the writer stores it: a JSON object, so the `unknown`
    // record field is given its shape once here instead of narrowed at every read.
    const data = record?.data as ToolResultRecordData | undefined
    // The result blocks the message carries; a malformed payload contributes none.
    const blocks: readonly ToolResultBlock[] = Array.isArray(data?.message?.content) ? data.message.content : []
    for (const block of blocks) {
      if (block?.type !== "tool-result") continue
      // The block's content parts; a malformed payload contributes no text at all.
      const parts: readonly ResultPart[] = Array.isArray(block.content) ? block.content : []
      // The joined text of every part, newline-separated.
      const text = parts
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("\n")
      map.set(block.toolCallId, { text, isError: block.isError === true })
    }
  }
  return map
}

/** The `tool/call` record payload, as far as the per-call read needs it. */
interface ToolCallRecordData {
  /** The tool name the harness recorded in `data.name`. */
  readonly name?: unknown
  /** The harness call id, a string by construction, that pairs the call with its result. */
  readonly callId?: string
  /** The recorded arguments: the harness's JSON-string form, or the direct object form. */
  readonly arguments?: string | Record<string, unknown>
}

/**
 * One recorded `tool/call` with its arguments parsed: the unit a per-call assertion reads.
 * Same pairing as the shared `RecordedToolCall`, with `arguments` narrowed to what callers index.
 */
export interface ParsedToolCall {
  /** Harness call id pairing this call with its `tool/result`, `undefined` when unrecorded. */
  readonly callId: string | undefined
  /** The recorded arguments object, `null` when the record carried none or did not parse. */
  readonly arguments: Record<string, unknown> | null
}

/**
 * Every recorded call of one tool, with its arguments (in record order).
 * The harness records `tool/call.data.arguments` as a JSON STRING (measured:
 * `"arguments": "{\"id\":\"qa-mcp-dead\"}"`), so it is parsed here — comparing
 * against an object would silently match nothing and every per-call assertion
 * would then pass or fail for the wrong reason.
 * @param store The decoded session store to read.
 * @param name The exact tool name to collect calls of.
 * @returns One entry per recorded call, with the arguments parsed when possible.
 */
export function callsOf(store: SessionStore, name: string): ParsedToolCall[] {
  return (store?.records ?? [])
    .filter((record) => record?.type === "tool/call" && (record?.data as ToolCallRecordData | undefined)?.name === name)
    .map((record) => {
      // The call's payload as the writer stores it: a JSON object with the recorded arguments.
      const data = record.data as ToolCallRecordData | undefined
      // The recorded arguments value, before the string/object distinction is made.
      const raw = data?.arguments
      // The parsed arguments object, `null` when absent or unparsable.
      let parsed: Record<string, unknown> | null = null
      if (typeof raw === "string") {
        try { parsed = JSON.parse(raw) } catch { parsed = null }
      } else if (raw !== undefined) parsed = raw
      return { callId: data?.callId, arguments: parsed }
    })
}

/** The verdict of one boot's sandbox-isolation assertion. */
interface IsolationStepVerdict {
  /** Whether the assertion passed; a failure is reported instead of thrown. */
  readonly ok: boolean
  /** How many session-store keys the check inspected (success only). */
  readonly checked?: number
  /** The inspected keys, so the caller can record what it looked at (success only). */
  readonly keys?: string[]
  /** The assertion's failure text (failure only). */
  readonly error?: string
  /** Any further field, so the verdict drops into an arm bag that indexes by key. */
  readonly [field: string]: unknown
}

/**
 * Run the session-sandbox assertion for one finished boot, as a step value.
 * @param dshHome The isolated DSH home that was booted against.
 * @param sandbox The sandbox root no session key may resolve outside of.
 * @param label The label printed when the assertion fails.
 * @returns The verdict, with the failure text instead of a thrown error.
 */
export function isolationStep(dshHome: string, sandbox: string, label: string): IsolationStepVerdict {  try {
    // The verdict carries `ok: true` of its own, so the spread drops that key from its type;
    // the assertion is erased and changes nothing at runtime.
    return { ok: true, ...(assertSessionsSandboxed(dshHome, sandbox, { label }) as Omit<SessionSandboxVerdict, "ok">) }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/**
 * Copy the raw session log next to the evidence so the claim is auditable.
 * @param outDir The evidence directory the raw copies are written under.
 * @param name The copy's base name inside `raw/`.
 * @param store The decoded store whose file and records are copied.
 * @returns Nothing; the copy is best-effort and never throws.
 */
export function keepRawSession(outDir: string, name: string, store: SessionStore): void {
  try {
    if (store.file !== null && existsSync(store.file)) {
      mkdirSync(join(outDir, "raw"), { recursive: true })
      writeFileSync(join(outDir, "raw", name + ".session.jsonl.zstd"), readFileSync(store.file))
      writeFileSync(join(outDir, "raw", name + ".session.decoded.jsonl"), store.records.map((record) => JSON.stringify(record)).join("\n") + "\n")
    }
  } catch { /* evidence copy is best-effort; result.json carries the verdict */ }
}

/** The result document `writeEvidence` persists: the verdict plus every arm the case reports. */
interface EvidencePayload {
  /** The case verdict, written both inside the document and as its first field. */
  readonly ok: boolean
  /** Per-arm verdicts, each rendered as one console line. */
  readonly steps?: Record<string, unknown>
  /** Any further field the case records (sandbox path, arm prose, notes, …). */
  readonly [field: string]: unknown
}

/**
 * Write one case's `result.json` and `output.log` and echo the verdict.
 * @param outDir The evidence directory to write into (created when absent).
 * @param slug The case slug echoed in the console line.
 * @param payload The result document; `ok` is repeated at its head.
 * @param logText The combined run log written as `output.log`.
 * @returns The verdict, so the caller can set its own exit code.
 */
export function writeEvidence(outDir: string, slug: string, payload: EvidencePayload, logText: string): boolean {
  mkdirSync(outDir, { recursive: true })
  // The verdict, echoed on the console line and stored first in the document.
  const ok = payload.ok
  // `payload` is spread last on purpose, so its own fields win; the declared `ok` is dropped
  // from the spread's type because it repeats the literal's own `ok` and says nothing new.
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, slug, ...(payload as Omit<EvidencePayload, "ok">) }, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), logText + "\n")
  console.log("[" + slug + "] ok=" + ok + " -> " + outDir)
  for (const [name, step] of Object.entries(payload.steps ?? {})) {
    console.log("  " + name + ": " + JSON.stringify(step).slice(0, 300))
  }
  return ok
}

/**
 * The evidence-directory stamp: an ISO instant with `:` replaced so it is a legal path segment.
 * @returns The ISO instant with `:` replaced, safe as a single path segment.
 */
export function timestamp(): string {
  return new Date().toISOString().replaceAll(":", "-")
}

/**
 * Remove one sandbox tree.
 * @param sandbox The sandbox root to delete recursively.
 * @returns Nothing; a failed delete is swallowed as best-effort cleanup.
 */
export function cleanup(sandbox: string): void {
  try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* best-effort scratch cleanup */ }
}

/** Crash signatures the boot log must never carry (AGENTS.md §12). */
export const APPLY_CRASH_SIGNATURES: readonly string[] = [
  "unsupported JSON schema",
  "JsonSchemaError",
  "plugin tree failed to load",
  "failed to apply loader entry",
]

/** One prerequisite: what is probed, why it is absent and how to satisfy it. */
interface Prerequisite {
  /** Stable machine-readable reason, printed after `reason=`. */
  readonly code: string
  /** What was probed, printed after `prereq=`. */
  readonly probe: string
  /** The one-line remedy quoted in the banner, runnable as written. */
  readonly remedy: string
  /** Whether the prerequisite is satisfied right now. @returns true when present. */
  readonly present: () => boolean
}

/** What `gatePrereqs` needs to render the house prerequisite banner. */
interface GatePrereqsOptions {
  /** The case slug, printed as `case=<slug>`. */
  readonly slug: string
  /** The prerequisites to check, in the order they are reported. */
  readonly prereqs: readonly Prerequisite[]
}

/**
 * The house prerequisite gate (SKILL.md): a case whose prerequisite is absent
 * prints ONE `[mpd-qa] SKIP …` marker as its FIRST stdout line and exits 0, while
 * an explicit strict request (`--no-skip` / `--require-pack`) turns the same
 * absence into a loud FAIL. Call it before any other output.
 * @param options.slug The case slug printed in the banner.
 * @param options.prereqs The prerequisites, checked in order.
 * @returns Nothing on success; the process exits (0 for SKIP, 1 for FAIL) on the first absence.
 */
export function gatePrereqs({ slug, prereqs }: GatePrereqsOptions): void {
  // Whether an explicit strict request turns an absent prerequisite into a failure.
  const strict = process.argv.includes("--no-skip") || process.argv.includes("--require-pack")
  for (const prereq of prereqs) {
    if (prereq.present()) continue
    console.log("[mpd-qa] " + (strict ? "FAIL" : "SKIP")
      + " case=" + slug + " lane=real reason=" + prereq.code
      + " prereq=" + prereq.probe + ' remedy="' + prereq.remedy + '"')
    process.exit(strict ? 1 : 0)
  }
}

/**
 * Whether one executable answers `--version` successfully.
 * @param command The executable to probe (a bare PATH name, not a shell line).
 * @returns True only when it exits 0 within the probe timeout.
 */
export function binaryPresent(command: string): boolean {
  // The probe's outcome; a missing binary reports a spawn error and a null status.
  const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 60000 })
  return result.status === 0
}

/**
 * Which apply-crash signatures one boot log carries.
 * @param bootLog The combined boot output to scan.
 * @returns The signatures found, in `APPLY_CRASH_SIGNATURES` order (empty on a clean boot).
 */
export function crashSignatures(bootLog: string): string[] {
  return APPLY_CRASH_SIGNATURES.filter((signature) => bootLog.includes(signature))
}

// ── the multi-session isolation arm ─────────────────────────────────────────

/** One isolation arm: the session cwd, the id it must see and the ids it must not. */
type IsolationArmSpec = readonly [name: string, cwd: string, expected: string, forbidden: readonly string[]]

/** One arm's recorded verdict inside `isolationArm`'s bag. */
interface IsolationArmStep {
  /** Whether this session's boot succeeded AND saw exactly its own extension. */
  ok: boolean
  /** The session's exit status. */
  readonly exit: number | null
  /** The cwd the session was booted in. */
  readonly cwd: string
  /** Whether the harness recorded the `mpd_ext_list` call. */
  readonly recorded: boolean
  /** Whether that call returned a non-error result. */
  readonly succeeded: boolean
  /** Whether the report text carried the expected extension id. */
  readonly sawExpected: boolean
  /** The forbidden ids that DID leak into the report (empty on success). */
  readonly sawForbidden: string[]
  /** The extension/flow tool names the harness offered this session. */
  readonly offeredExtTools: string[]
  /** The sandbox-isolation verdict for this boot. */
  readonly isolation: IsolationStepVerdict
}

/** The arm bag: one verdict per arm name, plus the `ok` summary written after the loop. */
interface IsolationArmSteps {
  /** Summary verdict: every arm passed. Written only after the loop has filled the arms. */
  ok: boolean
  /** Verdict of one named arm, keyed by the arm name; the loop assigns each one in turn. */
  [arm: string]: IsolationArmStep | boolean
}

/** What the isolation arm returns to its case. */
interface IsolationArmResult {
  /** Per-arm verdicts plus the summary `ok`. */
  readonly steps: IsolationArmSteps
  /** One log section per arm, appended to the case's own log. */
  readonly logs: string[]
}

/** What the isolation arm needs from its case. */
interface IsolationArmOptions {
  /** The case slug. */
  readonly slug: string
  /** The sandbox root the three session cwds are created under. */
  readonly sandbox: string
  /** The isolated DSH home every arm boots against. */
  readonly dshHome: string
  /** The sandboxed child environment. */
  readonly env: Env
  /** The decoy cwd carrying the extension no sandboxed session may see. */
  readonly decoy: string
  /** The evidence directory the raw session logs are copied into. */
  readonly outDir: string
}

/**
 * Two sessions on ONE host root (same DSH_HOME + HOME), different session cwds,
 * plus a two-sided control:
 *   negative — a decoy extension in the LAUNCHER cwd is visible to no session
 *              (an apply-time/process-cwd discovery would show it to both);
 *   positive — the same decoy IS listed once a session's own cwd is that
 *              directory, so the negative arm cannot pass vacuously.
 * @param options.slug The case slug.
 * @param options.sandbox The sandbox root the arm works under.
 * @param options.dshHome The isolated DSH home every boot uses.
 * @param options.env The sandboxed child environment.
 * @param options.decoy The decoy cwd for the positive control.
 * @param options.outDir The evidence directory for the raw session copies.
 * @returns The per-arm verdicts and the arm logs.
 */
export async function isolationArm({ slug, sandbox, dshHome, env, decoy, outDir }: IsolationArmOptions): Promise<IsolationArmResult> {
  // The arm bag: filled per arm below, then given the boolean `ok` summary. It starts EMPTY on
  // purpose — the summary is computed over the arm entries alone, so a pre-seeded boolean would
  // both join that fold and short-circuit it, hence the assertion that names the invariant.
  const steps: IsolationArmSteps = {} as IsolationArmSteps
  // One log section per arm, in arm order.
  const logs: string[] = []
  // The first session's workspace; its extension must be the only one it sees.
  const wsA = join(sandbox, "ws-a")
  // The second session's workspace, on the SAME host root as the first.
  const wsB = join(sandbox, "ws-b")
  mkdirSync(wsA, { recursive: true })
  mkdirSync(wsB, { recursive: true })
  writeExtension(join(wsA, ".mpd", "extensions"), "qa-iso-a", manifest("qa-iso-a", { skills: [{ root: "skills" }] }), {
    skills: { "qa-iso-a-skill": SKILL_MD("qa-iso-a-skill", "A") },
  })
  writeExtension(join(wsB, ".mpd", "extensions"), "qa-iso-b", manifest("qa-iso-b", { skills: [{ root: "skills" }] }), {
    skills: { "qa-iso-b-skill": SKILL_MD("qa-iso-b-skill", "B") },
  })
  writeExtension(join(decoy, ".mpd", "extensions"), "qa-iso-decoy", manifest("qa-iso-decoy", { skills: [{ root: "skills" }] }), {
    skills: { "qa-iso-decoy-skill": SKILL_MD("qa-iso-decoy-skill", "DECOY") },
  })

  // The three arms: two sandboxed session cwds plus the decoy-cwd positive control.
  const arms: readonly IsolationArmSpec[] = [
    ["session-a", wsA, "qa-iso-a", ["qa-iso-b", "qa-iso-decoy"]],
    ["session-b", wsB, "qa-iso-b", ["qa-iso-a", "qa-iso-decoy"]],
    ["decoy-cwd-control", decoy, "qa-iso-decoy", ["qa-iso-a", "qa-iso-b"]],
  ]
  for (const [name, cwd, expected, forbidden] of arms) {
    // The stub that makes this session list the extensions exactly once.
    const stub = makeStubModel({ script: [{ tool: "mpd_ext_list", args: {} }, { text: "isolation-" + name }], label: name })
    // The loopback port this arm's stub listens on.
    const port = await stub.listen()
    useStubRoute(dshHome, port)
    // The boot outcome of this arm's session.
    const run = await bootSession({ slug, env, cwd, prompt: "Call mpd_ext_list once and report the extension ids you received.", stub })
    // What the harness really recorded for this session.
    const evidence = sessionEvidence(dshHome, cwd, ["mpd_ext_list"])
    await stub.close()
    keepRawSession(outDir, name, evidence.store)
    // The text of the recorded `mpd_ext_list` result, `""` when nothing was recorded.
    const resultText = evidence.calls.mpd_ext_list?.resultText ?? ""
    steps[name] = {
      ok: run.status === 0
        && Boolean(evidence.calls.mpd_ext_list?.succeeded)
        && resultText.includes(expected)
        && forbidden.every((id) => !resultText.includes(id)),
      exit: run.status,
      cwd,
      recorded: Boolean(evidence.calls.mpd_ext_list?.called),
      succeeded: Boolean(evidence.calls.mpd_ext_list?.succeeded),
      sawExpected: resultText.includes(expected),
      sawForbidden: forbidden.filter((id) => resultText.includes(id)),
      offeredExtTools: evidence.names.filter((name) => name.startsWith("mpd_ext_") || name.startsWith("mpd_flow_")),
      isolation: isolationStep(dshHome, sandbox, slug + ":" + name),
    }
    logs.push("=== " + name + " (cwd=" + cwd + ") ===\n" + run.out.slice(-4000))
  }
  // Every entry at this point is an arm verdict — the `ok` summary is written only now,
  // which is what makes the narrowing below a restatement rather than a guess.
  steps.ok = (Object.values(steps) as IsolationArmStep[]).every((step) => step.ok === true)
  return { steps, logs }
}

// ── self-test (offline) ─────────────────────────────────────────────────────

/** The contract keys the shipped extension SDK publishes; the self-test reads them by name. */
interface ExtensionSdkContract {
  /** Every key a descriptor may carry at the top level. */
  readonly descriptorKeys: readonly string[]
  /** Every key the `contributes` block may carry. */
  readonly contributesKeys: readonly string[]
  /** The descriptor schema version the contract freezes. */
  readonly apiVersion: number
  /** The rank a contribution takes when it declares none. */
  readonly defaultRank: number
  /** The contribution kinds the project plane is allowed to declare. */
  readonly projectKinds: readonly string[]
  /** The manifest file name every extension directory must use. */
  readonly manifestFile: string
}

/** One role entry of the shipped example's manifest. */
interface ExampleRoleEntry {
  /** Persona path, relative to the example root, that must exist on disk. */
  readonly persona: string
}

/** The shipped example's manifest, as far as this self-test reads it. */
interface ExampleManifest {
  /** The descriptor version the example declares. */
  readonly apiVersion?: number
  /** Whether the example ships enabled; the contract requires `false`. */
  readonly enabled?: boolean
  /** Its contributions: the role list is the only part probed here. */
  readonly contributes: {
    /** The roles the example contributes. */
    readonly roles: readonly ExampleRoleEntry[]
  }
}

/**
 * The module's own offline self-test: stub protocol, descriptor contract, shipped example, boot recipe.
 * @returns A promise resolving after the verdict line; a failure exits the process with status 1.
 */
async function selfTest(): Promise<void> {
  // Every violation found, so one run reports them all instead of the first.
  const problems: string[] = []
  /** Record one violation without aborting the run. */
  const check = (condition: boolean, message: string): void => { if (!condition) problems.push(message) }

  // 1) the stub protocol really answers an OpenAI-shaped request with a tool call.
  // The stub whose script the protocol probe drives.
  const stub = makeStubModel({ script: [{ tool: "mpd_ext_list", args: {} }, { text: "done" }], label: "selftest" })
  // The loopback port the protocol probe sends its requests to.
  const port = await stub.listen()
  /**
   * Send one OpenAI-shaped chat request to the self-test stub.
   * @param messages The conversation to send.
   * @param tools The tool list to offer; an empty list means none.
   * @returns The raw SSE body.
   */
  const askOnce = async (messages: readonly StubMessage[], tools: readonly unknown[]): Promise<string> => {
    // The stub's response to this request.
    const response = await fetch("http://127.0.0.1:" + port + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "probe", stream: true, messages, tools }),
    })
    return await response.text()
  }
  // The first response, which must carry the scripted tool call.
  const first = await askOnce([{ role: "user", content: "go" }], [{ type: "function", function: { name: "mpd_ext_list" } }])
  check(first.includes("mpd_ext_list"), "the stub did not answer with the scripted tool call")
  // The second response, sent after a tool result, which must advance the script.
  const second = await askOnce([
    { role: "user", content: "go" },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "mpd_ext_list", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "[]" },
  ], [{ type: "function", function: { name: "mpd_ext_list" } }])
  check(second.includes("done"), "the stub did not advance to the final text after a tool result")
  // A tool-less request, which must be answered with plain text rather than a call.
  const capped = await askOnce([{ role: "user", content: "no tools here" }], [])
  check(capped.includes("QA-STUB-NO-TOOLS"), "the stub must answer a tool-less request with plain text")
  // The stub that answers a marker-carrying child request with the child answer.
  const childStub = makeStubModel({ script: [{ tool: "x", args: {} }], childMarker: "QA-CHILD-MARKER", childAnswer: "QA-CHILD-ANSWER" })
  // The port the child-answer probe sends its request to.
  const childPort = await childStub.listen()
  // The child turn's raw SSE body.
  const childText = await (await fetch("http://127.0.0.1:" + childPort + "/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "QA-CHILD-MARKER do it" }], tools: [{ type: "function", function: { name: "x" } }] }),
  })).text()
  check(childText.includes("QA-CHILD-ANSWER"), "a spawned child carrying the marker must get the child answer")
  await stub.close()
  await childStub.close()

  // 2) the fixtures this module writes satisfy the frozen descriptor contract.
  // The built extension SDK whose contract constants are asserted on.
  const sdkPath = join(REPO, "packages", "mpd-ext-plugin", "dist", "sdk.js")
  check(existsSync(sdkPath), "the extension SDK build artifact is missing (bun run build in the package)")
  if (existsSync(sdkPath)) {
    // The SDK module: a build product, typed by the one export this self-test reads.
    const sdk: { readonly MPD_EXT_CONTRACT: ExtensionSdkContract } = await import(pathToFileURL(sdkPath).href)
    // The frozen descriptor contract every fixture must satisfy.
    const contract = sdk.MPD_EXT_CONTRACT
    // A descriptor exercising every contribution kind the project plane allows.
    const sample = manifest("qa-sample", {
      skills: [{ root: "skills" }],
      flows: [{ dir: "flows", rank: 300 }],
      mcp: [{ serverName: "qa_lsp", transport: "stdio", command: "node", args: ["x.js"], cwd: "." }],
      roles: [{ name: "QA Reviewer", persona: "personas/r.md" }],
    })
    for (const key of Object.keys(sample)) check(contract.descriptorKeys.includes(key), "descriptor key outside the contract: " + key)
    for (const key of Object.keys(sample.contributes)) check(contract.contributesKeys.includes(key), "contributes key outside the contract: " + key)
    check(contract.apiVersion === 1, "the contract apiVersion must be 1")
    check(contract.defaultRank === 300, "the default rank must be 300")
    check(contract.projectKinds.join(",") === "skills,flows", "the project plane may contribute skills+flows only")
    check(contract.manifestFile === "mpd-ext.json", "the manifest file name changed")
  }

  // 3) the shipped reference extension is contract-conforming and still discovers its assets.
  // The shipped reference extension's directory.
  const exampleDir = join(REPO, "extensions", "mpd-ext-example")
  check(existsSync(join(exampleDir, "mpd-ext.json")), "the shipped example extension is missing")
  if (existsSync(join(exampleDir, "mpd-ext.json"))) {
    // The example's manifest, read as the subset this self-test probes.
    const example: ExampleManifest = JSON.parse(readFileSync(join(exampleDir, "mpd-ext.json"), "utf8"))
    check(example.apiVersion === 1, "the shipped example must declare apiVersion 1")
    check(example.enabled === false, "the shipped example must stay disabled by default")
    check(existsSync(join(exampleDir, example.contributes.roles[0].persona)), "the example role persona is missing")
    check(existsSync(join(exampleDir, "flows", "change-triage-flow.json")), "the example flow file is missing")
  }

  // 4) the boot recipe this module depends on still exists and is wired.
  // The installer source, read to prove it still writes the `mpd-ext` row.
  const installer = readFileSync(join(REPO, "scripts", "install-profile.ts"), "utf8")
  check(installer.includes('"mpd-ext"'), "install-profile.ts no longer writes the mpd-ext row")
  // The bundle patch, read to prove the `mpd-ext` row is still mounted.
  const patch = readFileSync(join(REPO, "cordis.patch.yml"), "utf8")
  check(/- id: mpd-ext\b/.test(patch), "the bundle patch no longer carries the mpd-ext row")
  // The repo's own stdio MCP server, the healthy server the bridge case boots against.
  const lsp = join(REPO, "packages", "mpd-mcp-lsp", "dist", "cli.js")
  check(existsSync(lsp), "the repo's own stdio MCP server (packages/mpd-mcp-lsp/dist/cli.js) is missing")

  if (problems.length > 0) {
    for (const problem of problems) console.error("[extension-isolation self-test] FAIL: " + problem)
    process.exit(1)
  }
  console.log("[extension-isolation self-test] ok: stub protocol (tool call, advance, child marker, no-tools text) + descriptor contract + shipped example + boot recipe verified")
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--self-test")) {
  await selfTest()
}
