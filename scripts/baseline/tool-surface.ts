import { basename, dirname, resolve } from "node:path"
import { Inputs, counter, instant, object, type Row } from "./input.ts"

/** Serialization shared by both headers, including brackets and commas, without a wrapper. */
const serialization = "UTF-8 bytes of ECMAScript JSON.stringify(data.header.tools) with no replacer or indentation"

/** Estimates use the same bytes-per-token assumption for both captures. */
const defaultBytesPerToken = 4

/** A validated tool keeps the recorded property order and all of its JSON fields. */
interface Tool {
  /** Exact name from the request header. */
  readonly name: string
  /** Raw JSON object retained only in memory for serialization. */
  readonly raw: Row
}

/** Byte counts by tool group; punctuation is accounted for at array level. */
interface Family {
  /** Prefix-defined group, or `harness` for built-in and ungrouped tools. */
  readonly family: string
  /** Number of rows assigned to this group. */
  readonly toolCount: number
  /** Sum of each complete, standalone JSON tool definition. */
  readonly schemaBytes: number
}

/** A usable schema measurement or a failure that must stay visible during comparison. */
type Capture = {
  readonly status: "MEASURED"
  readonly path: string
  readonly inputSha256: string
  readonly inputBytes: number
  readonly requestSeq: number
  readonly requestTime: string
  readonly toolCount: number
  readonly schemaBytes: number
  readonly estTokens: number
  readonly families: readonly Family[]
  readonly arrayOverhead: { readonly brackets: number; readonly separators: number; readonly envelope: number }
  readonly names: readonly string[]
} | {
  readonly status: "UNMEASURED"
  readonly path: string
  readonly reason: string
}

/** Assign each definition to a named, mutually exclusive tool family. */
function familyOf(name: string): string {
  if (name.startsWith("mcp__")) return name.split("__", 2).join("__")
  if (name.startsWith("mpd_")) return name.split("_", 2).join("_")
  if (name.startsWith("cellwork_")) return "cellwork"
  if (name.startsWith("agent_teams_")) return "agent_teams"
  if (name.startsWith("session-watchdog-")) return "session-watchdog"
  return "harness"
}

/** Parse only the fields needed to identify and count a recorded tool definition. */
function parseTool(value: unknown): Tool | undefined {
  /** Untyped input is narrowed once, without rebuilding the persisted object. */
  const row = object(value)
  if (typeof row?.name !== "string" || !/^[A-Za-z0-9_-]+$/.test(row.name)
    || typeof row.description !== "string" || object(row.parameters) === undefined) return undefined
  return { name: row.name, raw: row }
}

/** Parse the complete list and reject duplicate names or partially valid captures. */
function parseTools(value: unknown): readonly Tool[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  /** Only definitions validated in this request enter the result. */
  const tools: Tool[] = []
  /** Reject an ambiguous name list instead of silently deduplicating rows. */
  const seen = new Set<string>()
  for (const valueOfTool of value) {
    /** One fully checked tool definition. */
    const tool = parseTool(valueOfTool)
    if (tool === undefined || seen.has(tool.name)) return undefined
    seen.add(tool.name)
    tools.push(tool)
  }
  return tools
}

/** Count whole tool objects and leave the delimiters outside the family totals. */
function familyTotals(tools: readonly Tool[]): readonly Family[] {
  /** Accumulators are replaced after each observed definition. */
  const families = new Map<string, Family>()
  for (const tool of tools) {
    /** Exactly one family receives this definition's bytes. */
    const family = familyOf(tool.name)
    /** The previous totals for this family, if the request has more than one. */
    const prev = families.get(family)
    families.set(family, {
      family,
      toolCount: (prev?.toolCount ?? 0) + 1,
      schemaBytes: (prev?.schemaBytes ?? 0) + Buffer.byteLength(JSON.stringify(tool.raw), "utf8"),
    })
  }
  return [...families.values()].sort((a, b) => a.family.localeCompare(b.family, "en"))
}

/** Decode the exact input bytes without substituting invalid byte sequences. */
function decodeUtf8(bytes: Buffer): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    return undefined
  }
}

/** Measure one request header, leaving absent and malformed inputs unmeasured. */
function measure(path: string, bytesPerToken: number): Capture {
  /** Use the shared baseline reader to fingerprint the bytes actually parsed. */
  const inputs = new Inputs(dirname(resolve(path)))
  /** The complete bytes of the on-disk request record. */
  const bytes = inputs.bytes(basename(path))
  /** Decode before parsing so an invalid capture cannot measure a substituted character. */
  const text = bytes === undefined ? undefined : decodeUtf8(bytes)
  if (bytes !== undefined && text === undefined) return { status: "UNMEASURED", path, reason: "invalid UTF-8" }
  /** Parse the validated UTF-8 through the existing shape and JSON reader. */
  const record = text === undefined ? undefined : inputs.parse(basename(path), text)
  if (record === undefined) {
    /** Parse errors append the final observation after successful file reads. */
    const source = inputs.sources.at(-1)
    return { status: "UNMEASURED", path, reason: source?.reason ?? source?.state ?? "input unavailable" }
  }
  /** Request coordinates are retained without the configuration or prompt. */
  const seq = counter(record.seq)
  /** Harness timestamp normalized to UTC for cross-capture comparison. */
  const time = instant(record.time)
  /** The actual request-specific definitions, excluding the rest of the header. */
  const tools = parseTools(object(object(record.data)?.header)?.tools)
  /** Fingerprint for the successful file read. */
  const source = inputs.sources[0]
  if (record.type !== "request/header" || seq === undefined || time === undefined || tools === undefined
    || source?.sha256 === undefined || source.bytes === undefined) {
    return { status: "UNMEASURED", path, reason: "expected a timestamped request/header with a nonempty array of unique tool definitions" }
  }
  /** Compact JSON of the entire tool array with its original order and fields. */
  const schemaBytes = Buffer.byteLength(JSON.stringify(tools.map(tool => tool.raw)), "utf8")
  /** Even a positive finite ratio can overflow when applied to one capture. */
  const estTokens = schemaBytes / bytesPerToken
  if (!Number.isFinite(estTokens)) return { status: "UNMEASURED", path, reason: "token estimate exceeds the finite numeric range at this bytes-per-token ratio" }
  return {
    status: "MEASURED",
    path,
    inputSha256: source.sha256,
    inputBytes: source.bytes,
    requestSeq: seq,
    requestTime: new Date(time).toISOString(),
    toolCount: tools.length,
    schemaBytes,
    estTokens,
    families: familyTotals(tools),
    arrayOverhead: { brackets: 2, separators: tools.length - 1, envelope: 0 },
    names: tools.map(tool => tool.name).sort(),
  }
}

/** Emit both measurements and compare only when each side was observed. */
function main(args: readonly string[]): number {
  /** The positional arguments are fresh first and historical second. */
  const [freshPath, historicalPath, ratioText] = args
  /** The optional conversion ratio must be finite and strictly positive. */
  const bytesPerToken = ratioText === undefined ? defaultBytesPerToken : Number(ratioText)
  if (!freshPath || !historicalPath || args.length > 3 || !Number.isFinite(bytesPerToken) || bytesPerToken <= 0) {
    console.error("Usage: node scripts/baseline/tool-surface.ts <fresh-header.json> <historical-header.json> [bytes-per-token]")
    return 2
  }
  /** Today's mounted seat capture. */
  const fresh = measure(freshPath, bytesPerToken)
  /** The immutable comparison record supplied by the caller. */
  const historical = measure(historicalPath, bytesPerToken)
  /** A delta is meaningful only when both measurements exist. */
  const comparison = fresh.status === "MEASURED" && historical.status === "MEASURED"
    ? {
      added: fresh.names.filter(name => !historical.names.includes(name)),
      removed: historical.names.filter(name => !fresh.names.includes(name)),
      toolCountDelta: fresh.toolCount - historical.toolCount,
      schemaBytesDelta: fresh.schemaBytes - historical.schemaBytes,
    }
    : null
  console.log(JSON.stringify({
    status: comparison === null ? "UNMEASURED" : "MEASURED",
    command: [basename(process.execPath), "scripts/baseline/tool-surface.ts", ...args],
    serialization,
    bytesPerToken,
    fresh,
    historical,
    comparison,
  }, null, 2))
  return comparison === null ? 3 : 0
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2))
