import { previewText } from "./project-scope.ts"

/** Maximum space occupied by the serialized array before the tool adds its page metadata. */
const PAGE_BYTES = 7 * 1024

/** The narrow metadata from a private markdown entry that can cross the tool boundary. */
interface EntryPreview {
  /** Exact entry filename, usable as a recall key. */
  readonly file: string
  /** Entry title or summary. */
  readonly description: string
  /** Entry kind, such as note, reflection or fact. */
  readonly kind?: string
  /** A prefix of the stored body. */
  readonly content: string
  /** Bounded tag list from the entry's frontmatter. */
  readonly tags?: readonly string[]
  /** Bounded alias list from the entry's frontmatter. */
  readonly aliases?: readonly string[]
  /** Informational marker recorded in the entry. */
  readonly read_only?: boolean
  /** True if text or list metadata was omitted from this entry. */
  readonly truncated: boolean
}

/** Construct a bounded page, keeping the caller's next offset contiguous through the matches. */
export function previewEntries(entries: readonly Record<string, unknown>[], limit: number): readonly EntryPreview[] {
  /** Pages are assembled as an ordered prefix under a fixed budget. */
  const page: EntryPreview[] = []
  /** The bytes of the enclosing JSON array, plus each included item and delimiter. */
  let bytes = 2
  for (const entry of entries.slice(0, limit)) {
    /** A single bounded projection, including its precise cut indicator. */
    const preview = entryPreview(entry)
    /** Serialized size, accounting for escaping, non-ASCII text and separators. */
    const size = Buffer.byteLength(JSON.stringify(preview)) + (page.length > 0 ? 1 : 0)
    if (bytes + size > PAGE_BYTES) break
    page.push(preview)
    bytes += size
  }
  return page
}

/** Project only known metadata and record any abbreviated field. */
function entryPreview(entry: Readonly<Record<string, unknown>>): EntryPreview {
  /** Whether any field in the preview needed clipping. */
  let truncated = false
  /** Bound one optional field and accumulate its truncation signal. */
  function text(value: unknown, max: number): string | undefined {
    if (typeof value !== "string") return undefined
    /** The UTF-16-safe prefix returned to the caller. */
    const result = previewText(value, max)
    truncated ||= result.length !== value.length
    return result
  }
  /** Project only the first few text items, preserving their original order. */
  function list(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined
    truncated ||= value.length > 3
    return value.slice(0, 3).flatMap((item: unknown) => text(item, 24) ?? [])
  }
  /** Every returned key must survive the harness's lossless JSON serialization check. */
  const kind = text(entry.kind, 24)
  /** Tags are optional in prior entries, so absence is omitted from the result object. */
  const tags = list(entry.tags)
  /** Aliases are optional for the same reason. */
  const aliases = list(entry.aliases)
  return {
    file: text(entry.file, 255) ?? "",
    description: text(entry.description, 160) ?? "",
    ...(kind === undefined ? {} : { kind }),
    content: text(entry.content, 512) ?? "",
    ...(tags === undefined ? {} : { tags }),
    ...(aliases === undefined ? {} : { aliases }),
    ...(typeof entry.read_only === "boolean" ? { read_only: entry.read_only } : {}),
    truncated,
  }
}
