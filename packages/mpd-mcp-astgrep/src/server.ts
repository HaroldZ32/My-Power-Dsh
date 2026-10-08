// server.ts — the ast_grep MCP surface: descriptors, lifecycle methods and tool dispatch.
//
// Fault split (kept from this server's previous implementation, because a QA case and the harness
// both depend on it): JSON-RPC errors are reserved for PROTOCOL faults — a non-object request
// (-32600), an unknown method (-32601), a `tools/call` without `params.name` (-32602). Everything a
// TOOL can fail at, including an unknown tool name, comes back as a normal successful JSON-RPC
// response whose result carries `isError: true` and a taxonomy payload.
import { existsSync } from "node:fs"
import { probeAstGrep, resolveAstGrepBinary } from "../../mpd-mcp-shared/bin-resolve.ts"
import {
  SEARCH_TOOL_DESCRIPTION,
  SEARCH_TOOL_NAME,
  SearchArgumentError,
  executeSearch,
  parseSearchInput,
  type SearchPayload,
} from "./search.ts"
import { REWRITE_TOOL_DESCRIPTION, REWRITE_TOOL_NAME, executeRewrite, type RewritePayload } from "./rewrite.ts"
import { SCAN_TOOL_DESCRIPTION, SCAN_TOOL_NAME, executeScan, type ScanPayload } from "./scan.ts"

/** The MCP `serverInfo.name` this server advertises. */
export const AST_GREP_SERVER_NAME = "ast_grep" as const

/** The MCP `serverInfo.version` this server advertises. */
export const AST_GREP_SERVER_VERSION = "0.1.0" as const

/** Protocol version answered when the client's `initialize` names none. */
const DEFAULT_PROTOCOL_VERSION = "2024-11-05"

/** Every failure code an `isError` payload of this server can carry. */
export const AST_GREP_ERROR_CODES = [
  "INVALID_ARGUMENT",
  "BINARY_NOT_FOUND",
  "BINARY_INVALID",
  "UNSUPPORTED_LANGUAGE",
  "PATTERN_HINT_REJECTED",
  "PATTERN_PARSE_FAILED",
  "RULE_PARSE_FAILED",
  "REWRITE_UNBOUND_METAVARIABLE",
  "REWRITE_METAVARIABLE_KIND_MISMATCH",
  "PATH_NOT_FOUND",
  "PATH_UNREADABLE",
  "TIMEOUT",
  "ABORTED",
  "OUTPUT_TOO_LARGE",
  "OUTPUT_PARSE_FAILED",
  "PREVIEW_TRUNCATED",
  "REWRITE_STALE_PREVIEW",
  "SG_FAILED",
  "ENCODING_ERROR",
] as const

/** One member of {@link AST_GREP_ERROR_CODES}. */
export type AstGrepErrorCode = (typeof AST_GREP_ERROR_CODES)[number]

/** The 25 languages ast-grep parses, as the tool schemas publish them. */
const LANGUAGES = [
  "bash", "c", "cpp", "csharp", "css", "elixir", "go", "haskell", "html",
  "java", "javascript", "json", "kotlin", "lua", "nix", "php", "python",
  "ruby", "rust", "scala", "solidity", "swift", "typescript", "tsx", "yaml",
] as const

/** The match strictness levels ast-grep accepts. */
const STRICTNESS = ["cst", "smart", "ast", "relaxed", "signature"] as const

// `pattern`, `rewrite` and `inlineRules` are bounded in UTF-8 BYTES by the parsers, while JSON Schema
// `maxLength` counts Unicode CODE POINTS, so a `maxLength` keyword cannot express these budgets
// faithfully (a 10k-code-point CJK pattern is 30k bytes). The budget is therefore published in the
// description and the parser stays authoritative.
/** Byte-budget note published on every `pattern` property. */
const PATTERN_BYTES_NOTE = "Max 16 KiB (16384 BYTES, UTF-8) — the limit counts bytes, not characters."
/** Byte-budget note published on the `rewrite` property. */
const REWRITE_BYTES_NOTE = "Max 64 KiB (65536 BYTES, UTF-8) — the limit counts bytes, not characters."
/** Byte-budget note published on the `inlineRules` property. */
const INLINE_RULES_BYTES_NOTE = "Max 64 KiB (65536 BYTES, UTF-8) — the limit counts bytes, not characters."

/** The shared `paths` property: at least one entry, and never an implicit ".". */
const pathsSchema = {
  type: "array",
  minItems: 1,
  maxItems: 64,
  items: { type: "string", minLength: 1, maxLength: 4096 },
  description: "Files or directories to search. Required — there is no implicit '.' default.",
} as const

/** The shared `globs` property. */
const globsSchema = {
  type: "array",
  maxItems: 32,
  items: { type: "string", minLength: 1, maxLength: 1024 },
  description: "Optional include/exclude globs passed through to ast-grep.",
} as const

/** The shared `workdir` property. */
const workdirSchema = {
  type: "string",
  minLength: 1,
  maxLength: 4096,
  description: "Working directory for the sg process. Defaults to the server's cwd.",
} as const

/** The shared `maxMatches` property. */
const maxMatchesSchema = {
  type: "integer",
  minimum: 1,
  maximum: 500,
  description: "Maximum matches to return (default 50).",
} as const

/** The shared `timeoutMs` property. */
const timeoutMsSchema = {
  type: "integer",
  minimum: 1000,
  maximum: 300000,
  description: "Whole-call timeout budget in milliseconds (default 300000).",
} as const

/** The shared `includeHidden` property. */
const includeHiddenSchema = { type: "boolean", description: "Include hidden files (--no-ignore hidden)." } as const

/** The shared `followSymlinks` property. */
const followSymlinksSchema = { type: "boolean", description: "Follow symlinks (--follow)." } as const

/** One MCP tool this server publishes: its raw name, its description and its input schema. */
export interface McpToolDescriptor {
  /** The raw tool name, which the harness exposes as `mcp__<server>__<name>`. */
  readonly name: string
  /** Model-facing description of the tool. */
  readonly description: string
  /** JSON Schema of the tool's `arguments` object. */
  readonly inputSchema: Record<string, unknown>
}

/** The three tools this server publishes, in listing order. */
export const AST_GREP_MCP_TOOLS: readonly McpToolDescriptor[] = [
  {
    name: SEARCH_TOOL_NAME,
    description: SEARCH_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", minLength: 1, description: `ast-grep pattern — code, not regex. ${PATTERN_BYTES_NOTE}` },
        language: { type: "string", enum: [...LANGUAGES], description: "Language the pattern must parse in." },
        paths: pathsSchema,
        workdir: workdirSchema,
        globs: globsSchema,
        selector: { type: "string", minLength: 1, maxLength: 128, description: "Optional sub-node selector." },
        strictness: { type: "string", enum: [...STRICTNESS], description: "Match strictness (default smart)." },
        maxMatches: maxMatchesSchema,
        timeoutMs: timeoutMsSchema,
        includeHidden: includeHiddenSchema,
        followSymlinks: followSymlinksSchema,
        force: { type: "boolean", description: "Bypass non-fatal pattern hint rejections." },
      },
      required: ["pattern", "language", "paths"],
      additionalProperties: false,
    },
  },
  {
    name: REWRITE_TOOL_NAME,
    description: REWRITE_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", minLength: 1, description: `ast-grep pattern — code, not regex. ${PATTERN_BYTES_NOTE}` },
        rewrite: { type: "string", description: `Replacement code; empty deletes the match. ${REWRITE_BYTES_NOTE}` },
        language: { type: "string", enum: [...LANGUAGES], description: "Language the pattern must parse in." },
        paths: pathsSchema,
        workdir: workdirSchema,
        globs: globsSchema,
        selector: { type: "string", minLength: 1, maxLength: 128, description: "Optional sub-node selector." },
        strictness: { type: "string", enum: [...STRICTNESS], description: "Match strictness (default smart)." },
        apply: { type: "boolean", description: "Write the rewrite to disk. Default false (dry run)." },
        maxMatches: maxMatchesSchema,
        timeoutMs: timeoutMsSchema,
        includeHidden: includeHiddenSchema,
        followSymlinks: followSymlinksSchema,
        force: { type: "boolean", description: "Bypass non-fatal pattern hint rejections." },
      },
      required: ["pattern", "rewrite", "language", "paths"],
      additionalProperties: false,
    },
  },
  {
    name: SCAN_TOOL_NAME,
    description: SCAN_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        ruleFile: { type: "string", minLength: 1, maxLength: 4096, description: "Path to a YAML rule file. Mutually exclusive with inlineRules." },
        inlineRules: {
          type: "string",
          minLength: 1,
          description: `Inline YAML rule text. Mutually exclusive with ruleFile. ${INLINE_RULES_BYTES_NOTE}`,
        },
        paths: pathsSchema,
        workdir: workdirSchema,
        globs: globsSchema,
        maxMatches: maxMatchesSchema,
        timeoutMs: timeoutMsSchema,
        includeHidden: includeHiddenSchema,
        followSymlinks: followSymlinksSchema,
        includeMetadata: { type: "boolean", description: "Include rule metadata in each match." },
        apply: { type: "boolean", description: "Write rule fixes to disk. Default false (dry run)." },
      },
      required: ["paths"],
      // Exactly one explicit rule source per call: `ruleFile` XOR `inlineRules`. The contract is
      // published in both property descriptions and enforced by the parser, NOT by a schema-level
      // oneOf/not: JSON-Schema composition keywords are rejected outright by some gateways and can
      // kill the entire run, while the parser stays authoritative either way.
      additionalProperties: false,
    },
  },
] as const

/** A JSON-RPC id: a string or a number, or null when the request carried neither. */
export type JsonRpcId = string | number | null

/** One JSON-RPC response this server writes to stdout. */
export interface JsonRpcResponse {
  /** Always "2.0". */
  readonly jsonrpc: "2.0"
  /** The request's id, echoed. */
  readonly id: JsonRpcId
  /** The success result, present when the request succeeded. */
  readonly result?: unknown
  /** The failure, present when the request was a protocol fault. */
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown }
}

/** The abort signal and resolution seam one request is handled with. */
export interface AstGrepMcpOptions {
  /** Abort signal of the in-flight request, which reaches the spawned engine. */
  readonly signal?: AbortSignal
  /** Test seam: production callers leave this unset so the real resolver runs. */
  readonly resolveSgPath?: () => string
}

/**
 * Whether a value is a plain JSON object (never an array or null).
 * @param value - the value to classify
 * @returns true when it is a plain object
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Read a JSON-RPC id, falling back to null for anything that is not a string or a number.
 * @param value - the raw `id` field
 * @returns the id, or null
 */
function jsonRpcId(value: unknown): JsonRpcId {
  return typeof value === "string" || typeof value === "number" ? value : null
}

/**
 * Build a JSON-RPC success response.
 * @param id - the request's id
 * @param result - the result to return
 * @returns the response object
 */
function successResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result }
}

/**
 * Build a JSON-RPC error response.
 * @param id - the request's id, or null when it could not be read
 * @param code - the JSON-RPC error code
 * @param message - the error message
 * @returns the response object
 */
function errorResponse(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

/**
 * Wrap a tool payload in the MCP `tools/call` result shape.
 * @param id - the request's id
 * @param payload - the payload to serialize as the single text content block
 * @param isError - whether the payload describes a tool failure
 * @returns the JSON-RPC response
 */
function toolResponse(id: JsonRpcId, payload: unknown, isError: boolean): JsonRpcResponse {
  return successResponse(id, {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError,
  })
}

/**
 * Build a failed `tools/call` response from the shared taxonomy.
 * @param id - the request's id
 * @param code - the taxonomy code
 * @param message - one-line cause
 * @param hints - actionable next steps; an empty list omits the `hints` key entirely
 * @param extra - further fields placed beside `phase` (e.g. `language`)
 * @returns the JSON-RPC response carrying `isError: true`
 */
function toolFailure(
  id: JsonRpcId,
  code: AstGrepErrorCode,
  message: string,
  hints: readonly string[] = [],
  extra: Record<string, unknown> = {},
): JsonRpcResponse {
  return toolResponse(
    id,
    {
      schemaVersion: 1,
      ok: false,
      error: {
        code,
        message,
        retryable: false,
        phase: "preflight",
        ...extra,
        details: hints.length > 0 ? { hints } : {},
      },
    },
    true,
  )
}

/**
 * Read the `language` argument for an error payload.
 * @param args - the raw `tools/call` arguments
 * @returns the language the caller named, or "unknown"
 */
function languageOf(args: Record<string, unknown>): string {
  return typeof args["language"] === "string" ? args["language"] : "unknown"
}

/**
 * Read an error's message, whatever was thrown.
 * @param error - the thrown value
 * @returns its message
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read the `hints` attached to a thrown error, if any.
 * @param error - the thrown value
 * @returns the hints, or an empty list
 */
function hintsOf(error: unknown): readonly string[] {
  if (!(error instanceof Error) || !("hints" in error)) return []
  /** The error's `hints` field, as attached by the resolver. */
  const hints = (error as { hints?: unknown }).hints
  return Array.isArray(hints) ? hints.filter((hint): hint is string => typeof hint === "string") : []
}

/**
 * Read the protocol version a client asked for, defaulting when it named none.
 * @param params - the `initialize` params
 * @returns the protocol version to answer with
 */
function requestedProtocolVersion(params: unknown): string {
  if (!isPlainRecord(params) || typeof params["protocolVersion"] !== "string") return DEFAULT_PROTOCOL_VERSION
  return params["protocolVersion"]
}

/**
 * Resolve the ast-grep executable for one call.
 *
 * Order: the caller's env pin `MPD_AST_GREP_SG_PATH` (the launcher sets it, and a user or a QA lane
 * may set it too), then this bundle's own resolver, which links the installed package, the pinned
 * `.toolchain`, or the bundle's own bin directory. A pin is only accepted when it passes the same
 * `--version` probe the resolver applies, because the PATH-resolvable `sg` on many systems is
 * util-linux's setgid wrapper, which would otherwise be handed a structural query. Resolution runs
 * PER CALL, so a binary installed while the session is live is picked up without a restart.
 * @param options - the request options, whose `resolveSgPath` seam overrides resolution in tests
 * @returns the absolute path of the executable
 * @throws {Error} with `hints` attached when no candidate was accepted
 */
function resolveSgPath(options: AstGrepMcpOptions): string {
  if (options.resolveSgPath !== undefined) return options.resolveSgPath()
  /** The caller's explicit pin, when it is non-empty. */
  const pinned = (process.env.MPD_AST_GREP_SG_PATH ?? "").trim()
  if (pinned.length > 0 && existsSync(pinned) && probeAstGrep(pinned)) return pinned
  /** What this bundle's own resolver found. */
  const resolution = resolveAstGrepBinary(import.meta.url)
  if (resolution !== null) return resolution.binary
  throw Object.assign(
    new Error("ast-grep executable not found: no candidate passed the --version probe, and no ast-grep this bundle can link"),
    {
      hints: [
        "Install the MIT engine with `npm install -g @ast-grep/cli`, or set MPD_AST_GREP_SG_PATH to the absolute path of the ast-grep executable.",
        "In a checkout, `node scripts/install-mcp.ts` installs it into <bundle>/.toolchain, which this server resolves automatically.",
      ],
    },
  )
}

/**
 * Handle one parsed JSON-RPC request.
 * @param input - the parsed request object
 * @param options - the request's abort signal and resolution seam
 * @returns the response to write, or undefined for a notification that takes no response
 */
export async function handleAstGrepMcpRequest(
  input: unknown,
  options: AstGrepMcpOptions = {},
): Promise<JsonRpcResponse | undefined> {
  if (!isPlainRecord(input)) return errorResponse(null, -32600, "Invalid Request")

  /** The request's id. */
  const id = jsonRpcId(input["id"])
  /** The request's method. */
  const method = input["method"]

  if (method === "notifications/initialized") return undefined
  if (method === "ping") return successResponse(id, {})
  if (method === "initialize") {
    return successResponse(id, {
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: AST_GREP_SERVER_NAME, version: AST_GREP_SERVER_VERSION },
      protocolVersion: requestedProtocolVersion(input["params"]),
    })
  }
  if (method === "tools/list") return successResponse(id, { tools: [...AST_GREP_MCP_TOOLS] })
  if (method === "tools/call") return await handleToolCall(id, input["params"], options)

  return errorResponse(id, -32601, `Method not found: ${String(method)}`)
}

/**
 * Handle one `tools/call` request.
 * @param id - the request's id
 * @param params - the request's params (`name` plus `arguments`)
 * @param options - the request's abort signal and resolution seam
 * @returns the response, always a successful JSON-RPC response with `isError` marking a tool failure
 */
async function handleToolCall(
  id: JsonRpcId,
  params: unknown,
  options: AstGrepMcpOptions,
): Promise<JsonRpcResponse> {
  if (!isPlainRecord(params) || typeof params["name"] !== "string") {
    return errorResponse(id, -32602, "tools/call requires params.name")
  }

  /** The raw tool name the caller asked for. */
  const name = params["name"]
  /** The raw arguments, or an empty object when the call carried none. */
  const args: Record<string, unknown> = isPlainRecord(params["arguments"]) ? params["arguments"] : {}

  if (name !== SEARCH_TOOL_NAME && name !== REWRITE_TOOL_NAME && name !== SCAN_TOOL_NAME) {
    return toolFailure(
      id,
      "INVALID_ARGUMENT",
      `Unknown ast_grep tool: ${name}. Available tools: ${AST_GREP_MCP_TOOLS.map((tool) => tool.name).join(", ")}.`,
    )
  }

  /** The executable every tool call resolves for itself. */
  let sgPath: string
  try {
    sgPath = resolveSgPath(options)
  } catch (error) {
    return toolFailure(id, "BINARY_NOT_FOUND", messageOf(error), hintsOf(error))
  }

  try {
    /** The tool's payload. */
    const payload = await dispatch(name, args, sgPath, options)
    return toolResponse(id, payload, payload.ok !== true)
  } catch (error) {
    if (error instanceof SearchArgumentError) {
      return toolFailure(id, "INVALID_ARGUMENT", error.message, [], { language: error.language })
    }
    return toolFailure(id, "SG_FAILED", messageOf(error))
  }
}

/**
 * Run the tool the caller named.
 *
 * `search` is parsed at this boundary because its executor trusts its input; `rewrite` and `scan`
 * parse internally so that a bad argument is reported in their own payload shape.
 * @param name - the validated raw tool name
 * @param args - the raw arguments
 * @param sgPath - the resolved ast-grep executable
 * @param options - the request's abort signal
 * @returns the tool's payload
 */
async function dispatch(
  name: typeof SEARCH_TOOL_NAME | typeof REWRITE_TOOL_NAME | typeof SCAN_TOOL_NAME,
  args: Record<string, unknown>,
  sgPath: string,
  options: AstGrepMcpOptions,
): Promise<SearchPayload | RewritePayload | ScanPayload> {
  if (name === SEARCH_TOOL_NAME) {
    return await executeSearch(parseSearchInput(args), sgPath, options.signal)
  }
  if (name === REWRITE_TOOL_NAME) {
    return await executeRewrite(args as never, sgPath, options.signal)
  }
  return await executeScan(args, sgPath, options.signal)
}
