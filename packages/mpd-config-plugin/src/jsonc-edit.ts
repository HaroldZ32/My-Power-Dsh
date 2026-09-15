// Refuse-first, path-addressed JSONC span rewriter (t34 design §B, E1-E11).
//
// WHY THIS EXISTS: the bundle needs to persist a settings edit into
// `<workspace>/.mpd/mpd.jsonc` WITHOUT destroying the human's file. No
// comment-preserving JSONC editor exists offline (t32 dossier §d), so this module
// extends the repo's own string-aware scanner into a span rewriter: it locates the
// EXACT character span of one value and splices only that span, leaving every other
// byte — comments, key order, whitespace, quotes, trailing commas, line endings —
// byte-identical BY CONSTRUCTION.
//
// THE SINGLE MOST IMPORTANT RULE (design §B): the editor returns a RESULT, never a
// best effort. If it cannot prove the span, it returns `{ ok: false, reason }` and
// the caller leaves the file BYTE-UNTOUCHED. A config file destroyed by a UI save is
// the worst outcome this feature can produce, so every ambiguity resolves to
// "do not write".
//
// This module performs NO I/O. The atomic write (compare-and-swap + sibling temp +
// rename) lives in the caller.

/**
 * Named reasons a rewrite can be refused (each is surfaced loudly by the caller).
 *
 * The vocabulary is the design's own enumeration (§B.2/E1-E11, §10.2, §10.3), so a lane and
 * a reviewer can assert on a NAME rather than on prose.
 */
export type JsoncEditFailure =
  /** The document is not parseable as JSONC: no edit is attempted at all (E9). */
  | "unparsable"
  /**
   * The requested path walks through two identically-keyed objects: the target cannot be
   * proven, refuse byte-untouched (§B.2/E5, §10.3 `ambiguous-intermediate`).
   */
  | "ambiguous-intermediate"
  /**
   * Two members share the requested key in one object. NOT a refusal any more: the design
   * (§B.2/E5, D-11, §10.3, U6) requires editing the LAST occurrence, because that is the
   * one `JSON.parse` reads — editing the first would look successful and change nothing
   * observable. Kept in the union so a caller can name a duplicated-LEAF situation that
   * some other rule (e.g. a deletion that cannot leave a valid member set) must refuse.
   */
  | "duplicate-key"
  /** A path segment addresses a member of a scalar/array where an object is required. */
  | "unsupported-shape"
  /** The exact value span for the path could not be proven (E5/E6/§10.3). */
  | "span-not-proven"

/** The design's own names for these two shapes (§10.2): one spelling per concept. */
export type EditRefusal = JsoncEditFailure
export type EditResult = JsoncEditResult

/**
 * The deletion sentinel (§10.2): `surgicalEdit(raw, path, DELETE)` removes the member,
 * which is the same operation `surgicalDelete` exposes directly.
 */
export const DELETE = Symbol.for("mpd.jsonc.delete")

/** The proven span of a member's VALUE, as the design specifies it (§10.2). */
export interface ValueSpan {
  readonly start: number
  readonly end: number
  readonly hasTrailingComma: boolean
  readonly eol: "\n" | "\r\n"
}

export interface JsoncStyle {
  /** The document's dominant line ending, used only when a NEW line is emitted (E7). */
  readonly eol: "\n" | "\r\n"
  /** Whether the document uses a trailing comma before the closing brace/bracket (E3). */
  readonly trailingComma: boolean
  /** Indentation unit detected from the document (defaults to two spaces). */
  readonly indent: string
}

/**
 * A note attached to a PROVEN edit: the write succeeded, and the caller must still report this
 * loudly (captain ruling on duplicate keys: nothing silent).
 */
export interface JsoncEditNote {
  readonly reason: "duplicate-key"
  readonly detail: string
  readonly lines: readonly number[]
}

export type JsoncEditResult =
  | { readonly ok: true; readonly text: string; readonly style: JsoncStyle; readonly changed: boolean; readonly notes?: readonly JsoncEditNote[] }
  | { readonly ok: false; readonly reason: JsoncEditFailure; readonly detail?: string; readonly lines?: readonly number[] }

interface Entry {
  /** Raw key text including quotes, as it appears in the source (objects only). */
  readonly keyRaw?: string
  /** Decoded key (E1: matched against decoded text, never raw bytes). */
  readonly key?: string
  /** [keyStart, keyEnd) of the key token, objects only. */
  readonly keyStart?: number
  readonly keyEnd?: number
  /** [valueStart, valueEnd) of the member/element value. */
  readonly valueStart: number
  readonly valueEnd: number
}

interface Container {
  readonly kind: "object" | "array"
  /** [open, close) of the delimiters. */
  readonly open: number
  readonly close: number
  readonly entries: readonly Entry[]
}

function isWs(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r"
}

/** Skip whitespace and `//` / `/* *​/` comments starting at `pos` (design §4.1 step 1). */
function skipTrivia(src: string, pos: number): number {
  let i = pos
  for (;;) {
    while (i < src.length && isWs(src[i])) i++
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (src[i] === "/" && src[i + 1] === "*") {
      i += 2
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++
      i = Math.min(src.length, i + 2)
      continue
    }
    return i
  }
}

/** Scan one string token starting at `pos` (which must be the opening quote). */
function scanString(src: string, pos: number): number {
  let i = pos + 1
  while (i < src.length) {
    const ch = src[i]
    if (ch === "\\") {
      i += 2
      continue
    }
    if (ch === "\"") return i + 1
    i++
  }
  return src.length
}

/** Scan one scalar token (string, number, true, false, null) starting at `pos`. */
function scanValue(src: string, pos: number): { start: number; end: number } {
  const start = pos
  const ch = src[pos]
  if (ch === "\"") {
    const end = scanString(src, pos)
    return { start, end }
  }
  // number / true / false / null
  let i = pos
  while (i < src.length && !/[\s,}\]]/.test(src[i])) i++
  return { start, end: i }
}

/** Parse one container beginning at `open` (already known to be `{` or `[`). */
function parseContainer(src: string, open: number): Container | undefined {
  const kind: Container["kind"] = src[open] === "{" ? "object" : "array"
  const closeCh = kind === "object" ? "}" : "]"
  const entries: Entry[] = []
  let i = skipTrivia(src, open + 1)
  let trailingComma = false
  for (;;) {
    if (i >= src.length) return undefined
    if (src[i] === closeCh) {
      void trailingComma
      return { kind, open, close: i, entries }
    }
    if (kind === "array") {
      let end: number
      if (src[i] === "{" || src[i] === "[") {
        const nested = parseContainer(src, i)
        if (nested === undefined) return undefined
        end = nested.close + 1
      } else {
        end = scanValue(src, i).end
      }
      entries.push({ valueStart: i, valueEnd: end })
      i = skipTrivia(src, end)
      if (src[i] === ",") {
        i = skipTrivia(src, i + 1)
        trailingComma = src[i] === closeCh
        continue
      }
      if (src[i] === closeCh) continue
      return undefined
    }
    // object member: key then colon then value
    if (src[i] !== "\"") return undefined
    const keyStart = i
    const keyEnd = scanString(src, i)
    const keyRaw = src.slice(keyStart, keyEnd)
    let key: string
    try {
      key = JSON.parse(keyRaw) as string
    } catch {
      return undefined
    }
    i = skipTrivia(src, keyEnd)
    if (src[i] !== ":") return undefined
    i = skipTrivia(src, i + 1)
    if (i >= src.length) return undefined
    let end: number
    if (src[i] === "{" || src[i] === "[") {
      const nested = parseContainer(src, i)
      if (nested === undefined) return undefined
      end = nested.close + 1
    } else if (src[i] === "\"") {
      end = scanString(src, i)
    } else {
      end = scanValue(src, i).end
    }
    entries.push({ keyRaw, key, keyStart, keyEnd, valueStart: i, valueEnd: end })
    i = skipTrivia(src, end)
    if (src[i] === ",") {
      i = skipTrivia(src, i + 1)
      if (src[i] === closeCh) trailingComma = true
      continue
    }
    if (src[i] === closeCh) continue
    return undefined
  }
}

/** Detect the document style (E3, E7) from the raw text. */
export function detectStyle(raw: string): JsoncStyle {
  const crlf = (raw.match(/\r\n/g) ?? []).length
  const lf = (raw.match(/(?<!\r)\n/g) ?? []).length
  const indentMatch = raw.match(/\n([ \t]+)(?=")/)
  return {
    eol: crlf > lf ? "\r\n" : "\n",
    trailingComma: /,\s*[}\]]/.test(raw.replace(/"(?:[^"\\]|\\.)*"/g, '""')),
    indent: indentMatch === null ? "  " : indentMatch[1],
  }
}

/** Strip comments and trailing commas, then JSON.parse (mirrors the reader in index.ts). */
export function stripJsoncText(src: string): string {
  let out = ""
  let inString = false
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (inString) {
      out += ch
      if (ch === "\\") {
        out += src[i + 1] ?? ""
        i += 2
        continue
      }
      if (ch === "\"") inString = false
      i++
      continue
    }
    if (ch === "\"") {
      inString = true
      out += ch
      i++
      continue
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++
      i += 2
      continue
    }
    if (ch === ",") {
      // A comma is TRAILING when the next non-trivia token closes the container.
      // Skipping trivia (not just whitespace) matters: `{ "a": 1, /* c */ }` keeps
      // the comma otherwise and the document stops parsing — measured.
      const j = skipTrivia(src, i + 1)
      if (src[j] === "}" || src[j] === "]") {
        i++
        continue
      }
    }
    out += ch
    i++
  }
  return out
}

/** The depth-based indentation for a member inside a container opened at `open`. */
function indentFor(src: string, open: number, style: JsoncStyle): string {
  let depth = 0
  let inString = false
  for (let i = 0; i < open; i++) {
    const ch = src[i]
    if (inString) {
      if (ch === "\\") i++
      else if (ch === "\"") inString = false
      continue
    }
    if (ch === "\"") inString = true
    else if (ch === "{" || ch === "[") depth++
    else if (ch === "}" || ch === "]") depth--
  }
  return style.indent.repeat(Math.max(depth, 0))
}

/** Locate the container that owns `path`, returning the parent container and the last matching entry. */
/** 1-based line number of a character offset (for the duplicate-key diagnostic). */
export function lineAt(src: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === "\n") line++
  return line
}

function locate(
  src: string,
  root: Container,
  path: readonly string[],
  allowMaterialise: boolean,
  parentOnly = false,
): { container: Container; entry?: Entry; missingFrom?: number; lines?: readonly number[]; ok: true } | { ok: false; reason: JsoncEditFailure; detail?: string; lines?: readonly number[] } {
  let container = root
  for (let index = 0; index < path.length; index++) {
    const segment = path[index]
    const last = index === path.length - 1
    if (container.kind === "array") {
      const at = Number(segment)
      if (!Number.isInteger(at) || at < 0 || at >= container.entries.length) {
        if (last) return { container, ok: true }
        if (allowMaterialise) return { container, missingFrom: index, ok: true }
        return { ok: false, reason: "span-not-proven", detail: `array index ${segment} out of range` }
      }
      const entry = container.entries[at]
      if (last) return { container, ...(parentOnly ? {} : { entry }), ok: true }
      const nested = parseContainer(src, entry.valueStart)
      if (nested === undefined) return { ok: false, reason: "unsupported-shape", detail: "array element is not a container" }
      container = nested
      continue
    }
    const matches = container.entries.filter((e) => e.key === segment)
    if (matches.length === 0) {
      if (last) return { container, ok: true }
      if (allowMaterialise) return { container, missingFrom: index, ok: true }
      return { ok: false, reason: "span-not-proven", detail: `missing intermediate "${segment}"` }
    }
    if (matches.length > 1) {
      const lines = matches.map((m) => lineAt(src, m.keyStart ?? m.valueStart)).join(", ")
      if (!last) {
        // A duplicated INTERMEDIATE is the one duplicate case that cannot be resolved
        // honestly: two objects with the same key on the path, and no way to know which
        // subtree the caller meant (§B.2/E5, §10.3). Byte-untouched refusal.
        return { ok: false, reason: "ambiguous-intermediate", detail: `key "${segment}" appears ${matches.length} times (lines ${lines})` }
      }
      // A duplicated LEAF is editable: `JSON.parse` is last-wins, so the LAST occurrence is
      // the member the runtime actually reads (E5/D-11/U6). `matches` is in document order. The
      // duplicate is REPORTED (captain ruling: nothing silent) with every occurrence's line.
      const chosen = matches[matches.length - 1]
      const duplicate = { lines: matches.map((m) => lineAt(src, m.keyStart ?? m.valueStart)) }
      return { container, entry: chosen, ok: true, ...duplicate }
    }
    const entry = matches[0]
    if (last) return { container, ...(parentOnly ? {} : { entry }), ok: true }
    const nested = parseContainer(src, entry.valueStart)
    if (nested === undefined) {
      return { ok: false, reason: "unsupported-shape", detail: `"${segment}" is not an object` }
    }
    container = nested
  }
  return { container, ok: true }
}

export interface JsoncEditOptions {
  /** Insert a missing path (E6) instead of refusing with `span-not-proven`. */
  readonly insert?: boolean
}

/**
 * Replace (or insert) the value at `path`, splicing only its span.
 * @param raw - the file's exact bytes as a string.
 * @param path - decoded key path; numeric segments index arrays (E4).
 * @param value - the JSON-serialisable value to write.
 * @param options - `insert` allows creating a missing path (E6).
 * @returns a result; `ok:false` means the caller must leave the file untouched.
 */
/**
 * Prove the exact span of one member's VALUE (design §10.2). Pure: no filesystem, no text
 * change. A caller that wants the design's explicit two-step shape can locate first and
 * only then edit; the editor itself uses the same scanner, so the two can never disagree.
 * @param raw - the document text.
 * @param path - the decoded key path (arrays address elements by index).
 * @returns the proven span, or the named refusal.
 */
export function locateValueSpan(raw: string, path: readonly string[]): ValueSpan | { reason: JsoncEditFailure; detail?: string } {
  const parsed = readJsonc(raw)
  if (parsed.ok !== true) return { reason: "unparsable", detail: parsed.detail }
  const style = detectStyle(raw)
  const root = parseContainer(raw, skipTrivia(raw, 0))
  if (root === undefined) return { reason: "unsupported-shape", detail: "the document root is not an object or array" }
  if (path.length === 0) return { start: root.open, end: root.close + 1, hasTrailingComma: style.trailingComma, eol: style.eol }
  const found = locate(raw, root, path, false)
  if (found.ok !== true) return { reason: found.reason, detail: found.detail }
  if (found.entry === undefined) return { reason: "span-not-proven", detail: path.join(".") }
  const entry = found.entry
  const tail = raw.slice(entry.valueEnd, entry.valueEnd + 1)
  // A trailing comma is a FOLLOWING token, not part of the span: report it explicitly.
  const after = skipTrivia(raw, entry.valueEnd)
  return { start: entry.valueStart, end: entry.valueEnd, hasTrailingComma: raw.slice(after, after + 1) === "," || tail === ",", eol: style.eol }
}

export function surgicalEdit(raw: string, path: readonly string[], value: unknown, options: JsoncEditOptions = {}): JsoncEditResult {
  // The deletion sentinel is handled BEFORE any serialisation: a Symbol is not JSON, so the
  // value path would otherwise refuse `unsupported-shape` on a legitimate delete (§10.2).
  if (value === DELETE) return surgicalDelete(raw, path)
  const style = detectStyle(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsoncText(raw))
  } catch (error) {
    return { ok: false, reason: "unparsable", detail: String((error as Error)?.message ?? error) }
  }
  let serialised: string
  try {
    serialised = JSON.stringify(value, null, 2)
  } catch {
    return { ok: false, reason: "unsupported-shape", detail: "the value is not representable as JSON" }
  }
  if (serialised === undefined) return { ok: false, reason: "unsupported-shape", detail: "the value is not representable as JSON" }

  const open = skipTrivia(raw, 0)
  const root = parseContainer(raw, open)
  if (root === undefined) return { ok: false, reason: "unparsable", detail: "the scanner could not tokenise the document" }

  const found = locate(raw, root, path, options.insert === true)
  if (found.ok !== true) return found
  if (found.entry !== undefined) {
    const existing = raw.slice(found.entry.valueStart, found.entry.valueEnd)
    // Idempotence: an identical edit is a byte-level no-op (§9.1 U11).
    if (existing === serialised) return { ok: true, text: raw, style, changed: false }
    const note = duplicateNote(found.lines, path, "updated")
    return {
      ok: true,
      text: raw.slice(0, found.entry.valueStart) + serialised + raw.slice(found.entry.valueEnd),
      style,
      changed: true,
      ...(note === undefined ? {} : { notes: [note] }),
    }
  }

  if (options.insert !== true) return { ok: false, reason: "span-not-proven", detail: path.join(".") }
  const eol = style.eol
  const missingFrom = found.missingFrom ?? path.length - 1
  const leafKey = path[missingFrom]
  const rest = path.slice(missingFrom + 1)
  // Build the subtree for a missing intermediate chain; a leaf insert has rest === [].
  let subtree: unknown = value
  for (let i = rest.length - 1; i >= 0; i--) {
    const segment = rest[i]
    subtree = /^\d+$/.test(segment) ? [subtree] : { [segment]: subtree }
  }
  const serialisedSubtree = JSON.stringify(subtree, null, 2)
  const container = found.container

  if (container.kind === "object") {
    const indent = indentFor(raw, container.open, style)
    const inner = indent + style.indent
    const memberText = `${JSON.stringify(leafKey)}: ${serialisedSubtree.split("\n").join(eol + inner)}`
    const entries = container.entries
    if (entries.length === 0) {
      const text = raw.slice(0, container.open + 1) + eol + inner + memberText + eol + indent + raw.slice(container.close)
      return { ok: true, text, style, changed: true }
    }
    const lastEntry = entries[entries.length - 1]
    const afterLast = skipTrivia(raw, lastEntry.valueEnd)
    if (raw[afterLast] === ",") {
      // The file already separates the last member: insert AFTER the comma and keep
      // the document's own trailing-comma style.
      const insertAt = afterLast + 1
      const tail = style.trailingComma ? "," : ""
      return { ok: true, text: raw.slice(0, insertAt) + eol + inner + memberText + tail + raw.slice(insertAt), style, changed: true }
    }
    return { ok: true, text: raw.slice(0, lastEntry.valueEnd) + "," + eol + inner + memberText + raw.slice(lastEntry.valueEnd), style, changed: true }
  }

  // array insert: append before the closing bracket, matching the comma style
  const indent = indentFor(raw, container.open, style)
  const inner = indent + style.indent
  const entries = container.entries
  const item = serialisedSubtree.split("\n").join(eol + inner)
  if (entries.length === 0) {
    const text = raw.slice(0, container.open + 1) + eol + inner + item + eol + indent + raw.slice(container.close)
    return { ok: true, text, style, changed: true }
  }
  const lastEntry = entries[entries.length - 1]
  const afterLast = skipTrivia(raw, lastEntry.valueEnd)
  if (raw[afterLast] === ",") {
    const insertAt = afterLast + 1
    const tail = style.trailingComma ? "," : ""
    return { ok: true, text: raw.slice(0, insertAt) + eol + inner + item + tail + raw.slice(insertAt), style, changed: true }
  }
  return { ok: true, text: raw.slice(0, lastEntry.valueEnd) + "," + eol + inner + item + raw.slice(lastEntry.valueEnd), style, changed: true }
}

/**
 * Delete the value at `path` (E3/E4 span arithmetic): the member's key, its value
 * and exactly one adjacent comma, leaving valid JSONC.
 * @param raw - the file's exact bytes as a string.
 * @param path - decoded key path.
 * @returns a result; `ok:false` means the caller must leave the file untouched.
 */
export function surgicalDelete(raw: string, path: readonly string[]): JsoncEditResult {
  const style = detectStyle(raw)
  try {
    JSON.parse(stripJsoncText(raw))
  } catch (error) {
    return { ok: false, reason: "unparsable", detail: String((error as Error)?.message ?? error) }
  }
  const open = skipTrivia(raw, 0)
  const root = parseContainer(raw, open)
  if (root === undefined) return { ok: false, reason: "unparsable", detail: "the scanner could not tokenise the document" }
  // CAPTAIN'S DELTA vs the design: an UNSET removes EVERY occurrence of that exact path. Removing
  // only the last one would leave an earlier occurrence effective — the key would read as unset in
  // the UI while still being set at runtime (a silent lie). If ANY occurrence's span cannot be
  // proven, the whole edit is refused and the file stays byte-untouched.
  const all = locateAllLeaves(raw, root, path)
  if (all.ok !== true) return all
  const spans = all.entries
    .map((entry) => {
      const start = entry.keyStart ?? entry.valueStart
      const end = entry.valueEnd
      // Remove one adjacent comma: the one AFTER the member when another member follows,
      // otherwise the one BEFORE it.
      let from = start
      let to = end
      const tail = raw.slice(end)
      const commaAfter = /^\s*,/.exec(tail)
      if (commaAfter !== null) {
        to = end + commaAfter[0].length
      } else {
        const head = raw.slice(0, start)
        const commaBefore = /,\s*$/.exec(head)
        if (commaBefore !== null) from = start - commaBefore[0].length
      }
      return { from, to }
    })
    .sort((a, b) => b.from - a.from)
  let text = raw
  for (const span of spans) text = text.slice(0, span.from) + text.slice(span.to)
  const note = duplicateNote(all.lines, path, "removed")
  let reparsed: unknown
  try {
    reparsed = JSON.parse(stripJsoncText(text))
  } catch (error) {
    // A deletion that would leave invalid JSONC is refused (refuse-first).
    return { ok: false, reason: "unsupported-shape", detail: `deletion would leave invalid JSONC: ${String((error as Error)?.message ?? error)}` }
  }
  void reparsed
  return { ok: true, text, style, changed: true, ...(note === undefined ? {} : { notes: [note] }) }
}

/** The loud note a PROVEN duplicate-key edit must carry (captain ruling: nothing silent). */
function duplicateNote(lines: readonly number[] | undefined, path: readonly string[], action: "updated" | "removed"): JsoncEditNote | undefined {
  if (lines === undefined || lines.length < 2) return undefined
  return {
    reason: "duplicate-key",
    lines: [...lines],
    detail: `key "${path.join(".")}" appears ${lines.length} times at lines ${lines.join(", ")}; ${action === "updated" ? "the last occurrence is the effective value and was updated" : "every occurrence was removed, so the key is unset at runtime too"}`,
  }
}

/**
 * EVERY entry for a leaf path inside the object its parent resolves to (document order). Used by
 * the delete path, where removing just the last occurrence would leave an earlier one effective —
 * the key would read as unset in the UI while still being set at runtime (captain's ruling).
 */
function locateAllLeaves(
  src: string,
  root: Container,
  path: readonly string[],
): { entries: readonly Entry[]; lines: readonly number[]; ok: true } | { ok: false; reason: JsoncEditFailure; detail?: string } {
  if (path.length === 0) return { ok: false, reason: "span-not-proven", detail: "the document root has no leaf span" }
  const parent = locate(src, root, path, false, true) as unknown as { container: Container; ok: true } | { ok: false; reason: JsoncEditFailure; detail?: string }
  if (parent.ok !== true) return parent
  const last = path[path.length - 1]
  const entries = parent.container.kind === "array"
    ? parent.container.entries.filter((_entry, index) => String(index) === last)
    : parent.container.entries.filter((entry) => entry.key === last)
  if (entries.length === 0) return { ok: false, reason: "span-not-proven", detail: path.join(".") }
  const allProven = entries.every((entry) => entry.valueStart <= entry.valueEnd)
  if (!allProven) return { ok: false, reason: "span-not-proven", detail: path.join(".") }
  return { ok: true, entries, lines: entries.map((entry) => lineAt(src, entry.keyStart ?? entry.valueStart)) }
}

/** Read a value out of a JSONC document (used for the file-derived base and diffs). */
export function readJsonc(raw: string): { ok: true; value: unknown } | { ok: false; reason: "unparsable"; detail?: string } {
  try {
    return { ok: true, value: JSON.parse(stripJsoncText(raw)) }
  } catch (error) {
    return { ok: false, reason: "unparsable", detail: String((error as Error)?.message ?? error) }
  }
}
