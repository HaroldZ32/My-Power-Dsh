// B4 regression: the tool PARAMETER schema must stay inside the JSON-Schema subset this harness
// enforces. `type: ["string","array"]` is REJECTED by the installed validator
// (@deepseek-ai/dsh-tools assertSupportedJsonSchema: "type must be a single type string (type arrays
// are not supported)"); one such union takes the WHOLE plugin tree down at load. It is a parameter
// schema today, which this harness release validates only for outputs — hence latent, not harmless.
// The accepted union spelling is `oneOf`, which the harness renders and validates everywhere.
import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { apply } from "../src/index.ts"
import type { DshPostDecision, DshPostResult, DshTextBlock, DshToolDef, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** This package's root: the test file sits in `<root>/test/`, so two dirname steps land there. */
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** One tool registration as the fake ctx captured it: the adapter's own normalized tool descriptor. */
type Registered = DshToolDef

/** What the guard answers: the downstream decision, carrying a warning text block once it fires. */
type GuardDecision = Omit<DshPostDecision, "content"> & {
  /** The replacement content, present only when the guard fired for this call. */
  content?: DshTextBlock[]
}

/** The captured `tools/post-execute` guard, in the shape the adapter's waterfall invokes it. */
type GuardListener = (exec: DshToolExec, result: DshPostResult, next: () => Promise<DshPostDecision>) => Promise<GuardDecision>

/** What `mount` hands an arm: the registrations, the captured guard listeners and a name lookup. */
type MountedTools = {
  /** Every tool definition the plugin registered, in registration order. */
  tools: Registered[]
  /** The captured `tools/post-execute` listeners, in registration order. */
  listeners: GuardListener[]
  /** Resolve a registration by tool name; `undefined` when the plugin registered no such tool. */
  byName: (n: string) => Registered | undefined
}

/** `mpd_hashline_read`'s answer: the LINE#HASH view plus the number of source lines it covers. */
type ReadResult = {
  /** How many lines the view has; an empty file reports zero. */
  lines: number
  /** The `LINE#HASH|content` view whose anchors the edit arms pass back. */
  view: string
}

/** `mpd_hashline_edit`'s answer: the post-edit line count and the no-op tally. */
type EditResult = {
  /** How many lines the file has once the edits were applied. */
  lines: number
  /** How many edits matched an already-identical line and therefore changed nothing. */
  noopEdits: number
}

/** `mpd_hashline_format`'s answer: the session-absolute path now under the discipline. */
type FormatResult = {
  /** The session-resolved absolute path that was written to the registry. */
  path: string
}

/** A registered hashline tool handle whose result the arm states, since the adapter types it `unknown`. */
type HashlineTool<Result> = Omit<DshToolDef, "execute"> & {
  /** Run the tool body; `exec` stays optional because the read/edit arms need no session. */
  execute(args: Record<string, unknown>, exec?: DshToolExec): Promise<Result>
}

/** The `lines` leaf of the edit tool's parameter schema: the shape that used to be a type ARRAY. */
type LinesLeaf = {
  /** The rejected single-type spelling; absent in the accepted schema, or the assertion could not fail. */
  type?: string
  /** The accepted union spelling, one branch per shape `lines` may take. */
  oneOf?: Array<{ type: string; items?: { type: string } }>
}

/** The edit registration, its parameter schema declared down to the `lines` leaf read below. */
type EditRegistration = Omit<Registered, "parameters"> & {
  /** The declared parameter schema; `properties.edits.items.properties.lines` is the leaf under test. */
  parameters: { properties: { edits: { items: { properties: { lines: LinesLeaf } } } } }
}

/** Install the plugin on a fake ctx and hand back the registrations plus the captured guard. */
function mount(): MountedTools {
  // Every tool the plugin registered, in registration order.
  const tools: Registered[] = []
  // Captured `tools/post-execute` listeners, so a case can drive the guard directly.
  const listeners: GuardListener[] = []
  // Minimal host ctx: `get` answers 'no service', so the row config stays authoritative.
  const ctx: Parameters<typeof apply>[0] = {
    get: () => undefined,
    tools: { register: (d: Registered) => { tools.push(d); return () => {} } },
    // The post-execute guard registers through this seam; capturing the listener keeps apply() pure
    // while letting a case drive the guard exactly as the harness waterfall does.
    on: (event: string, listener: GuardListener) => { if (event === "tools/post-execute") listeners.push(listener) },
  }
  apply(ctx, {})
  return { tools, listeners, byName: (n) => tools.find((t) => t.name === n) }
}

/** The `LINE#HASH` anchors of a hashline view, in file order. */
function anchorsOf(view: string): string[] {
  return view.split("\n").filter((l) => l.includes("|")).map((l) => l.slice(0, l.indexOf("|")))
}

test("no registered hashline schema uses a type ARRAY (parameters or output)", () => {
  // The registered tools; their names and order are part of the row's contract.
  const { tools } = mount()
  expect(tools.map((t) => t.name)).toEqual([
    "mpd_hashline_read",
    "mpd_hashline_edit",
    "mpd_hashline_format",
    "mpd_hashline_restore",
  ])
  for (const t of tools) {
    for (const [surface, schema] of [["parameters", t.parameters], ["output", t.output?.schema]] as const) {
      expect({ tool: t.name, surface, hasTypeArray: /"type"\s*:\s*\[/.test(JSON.stringify(schema ?? {})) })
        .toEqual({ tool: t.name, surface, hasTypeArray: false })
    }
  }
})

test("edit.lines is a oneOf union of the string and array-of-string shapes", () => {
  // Fresh mount: this case inspects only the declared parameter schema.
  const { byName } = mount()
  // The `lines` leaf of the edit tool's single edit shape, the one that used to be a type array; it is
  // cast because the descriptor leaves `parameters` an opaque JSON-Schema object.
  const lines = (byName("mpd_hashline_edit") as EditRegistration).parameters.properties.edits.items.properties.lines
  expect(lines.type).toBeUndefined()
  expect(lines.oneOf).toEqual([{ type: "string" }, { type: "array", items: { type: "string" } }])
})

test("read then edit works with lines as a single string AND as an array of strings", async () => {
  // Fresh mount for the read-then-edit round trip, driving each accepted `lines` shape.
  const { byName } = mount()
  // Read tool handle, driven with an absolute path so the case needs no session; the cast states its
  // declared output, which the adapter types `unknown`.
  const read = byName("mpd_hashline_read") as HashlineTool<ReadResult>
  // Edit tool handle, the writer under test, cast under the same `unknown`-result contract.
  const edit = byName("mpd_hashline_edit") as HashlineTool<EditResult>
  // Throwaway directory for the sample file.
  const dir = mkdtempSync(join(tmpdir(), "mpd-hashline-schema-"))
  // Sample file whose content and line count every assertion below reads back.
  const file = join(dir, "sample.txt")
  try {
    writeFileSync(file, "alpha\nbeta\ngamma\n")

    // First view: three source lines; the file's final newline TERMINATES line 3 rather than adding one.
    const first = await read.execute({ path: file })
    expect(first.lines).toBe(3)
    // Anchors of the first view; a1[1] is the anchor of line 2 ('beta').
    const a1 = anchorsOf(first.view)

    // lines as a single STRING
    const stringEdit = await edit.execute({ path: file, edits: [{ op: "replace", pos: a1[1], lines: "BETA" }] })
    expect(stringEdit.noopEdits).toBe(0)
    expect(readFileSync(file, "utf8")).toBe("alpha\nBETA\ngamma\n")

    // lines as an ARRAY of strings (one anchored replace expanding into two lines)
    const second = await read.execute({ path: file })
    // Anchors AFTER the first edit: same line numbers, a fresh hash where the text changed.
    const a2 = anchorsOf(second.view)
    // The array form of `lines`, expanding one anchored replace into two lines.
    const arrayEdit = await edit.execute({ path: file, edits: [{ op: "replace", pos: a2[2], lines: ["GAMMA-1", "GAMMA-2"] }] })
    expect(arrayEdit.noopEdits).toBe(0)
    expect(readFileSync(file, "utf8")).toBe("alpha\nBETA\nGAMMA-1\nGAMMA-2\n")

    // and the array form still works for append/prepend
    const appended = await edit.execute({ path: file, edits: [{ op: "append", lines: ["TAIL-1", "TAIL-2"] }] })
    expect(appended.lines).toBe(6)
    expect(readFileSync(file, "utf8")).toBe("alpha\nBETA\nGAMMA-1\nGAMMA-2\nTAIL-1\nTAIL-2")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── E4: ONE source-line count for read / format / edit ───────────────────────────────────────────
// `toHashlineContent` re-appends the final newline, so counting the VIEW with `split("\n")` counted
// that terminator as an extra empty line: a 2-line file reported 3 while `#editFile` reported the
// honest count for the same file. All three tools must report the SAME count.
test("read, format and edit report the same source-line count for a terminated file", async () => {
  // Fresh mount for the three tools whose counts must agree.
  const { byName } = mount()
  // Read and format share one output shape: both answer path/lines/view.
  const read = byName("mpd_hashline_read") as HashlineTool<ReadResult>
  // The format tool, whose count must land on the same number as read's and edit's.
  const format = byName("mpd_hashline_format") as HashlineTool<ReadResult>
  // The edit tool, whose own count must land on the same number.
  const edit = byName("mpd_hashline_edit") as HashlineTool<EditResult>
  // Throwaway directory for the two-line fixture.
  const dir = mkdtempSync(join(tmpdir(), "mpd-hashline-count-"))
  // The fixture: exactly two source lines, newline-terminated.
  const file = join(dir, "two.txt")
  try {
    writeFileSync(file, "one\ntwo\n")
    expect((await read.execute({ path: file })).lines).toBe(2)
    expect((await format.execute({ path: file })).lines).toBe(2)
    // Anchors for the replace below, taken from a fresh view of the same file.
    const view = (await read.execute({ path: file })).view
    // The edit tool's answer for the same file; its count must land on 2 as well.
    const edited = await edit.execute({ path: file, edits: [{ op: "replace", pos: anchorsOf(view)[1], lines: "TWO" }] })
    expect(edited.lines).toBe(2)
    // The file really holds two lines after the edit, so the count describes the file and not a view artifact.
    expect(readFileSync(file, "utf8")).toBe("one\nTWO\n")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── E5: the CRLF/BOM envelope survives an anchored edit ──────────────────────────────────────────
// `canonicalizeFileText` / `restoreFileText` were exported and never called: `#editFile` wrote the
// applier's LF-only body straight back, so a CRLF file came back with MIXED endings and a BOM file
// silently lost its BOM.
test("an anchored edit keeps a CRLF file's line endings and a BOM file's BOM", async () => {
  // Fresh mount for the read/edit pair driving both envelope fixtures.
  const { byName } = mount()
  // The read tool, whose view supplies each envelope fixture's anchors.
  const read = byName("mpd_hashline_read") as HashlineTool<ReadResult>
  // The anchored-edit tool whose write-back both envelope arms assert on.
  const edit = byName("mpd_hashline_edit") as HashlineTool<EditResult>
  // Throwaway directory holding the two envelope fixtures.
  const dir = mkdtempSync(join(tmpdir(), "mpd-hashline-envelope-"))
  // CRLF fixture: every line ends with a carriage return plus a line feed.
  const crlf = join(dir, "crlf.txt")
  // BOM fixture: a leading U+FEFF before the first line.
  const bom = join(dir, "bom.txt")
  try {
    writeFileSync(crlf, "alpha\r\nbeta\r\n")
    // The view's anchors, taken as the caller would: the envelope arm asserts the WRITE-BACK only.
    const crlfView = await read.execute({ path: crlf })
    await edit.execute({ path: crlf, edits: [{ op: "replace", pos: anchorsOf(crlfView.view)[1], lines: "BETA" }] })
    // The whole file keeps CRLF: an LF-only write-back leaves a MIXED file behind.
    expect(readFileSync(crlf, "utf8")).toBe("alpha\r\nBETA\r\n")

    writeFileSync(bom, "\uFEFFalpha\nbeta\n")
    // The BOM fixture's anchors, taken before the edit consumes them.
    const bomView = await read.execute({ path: bom })
    await edit.execute({ path: bom, edits: [{ op: "replace", pos: anchorsOf(bomView.view)[1], lines: "BETA" }] })
    // The leading BOM is still there; the edit must not strip it.
    expect(readFileSync(bom, "utf8")).toBe("\uFEFFalpha\nBETA\n")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the committed src AND dist carry no array-typed schema form, and the dist carries the oneOf fix", () => {
  // Source of the plugin entry, scanned for the rejected union spelling.
  const src = readFileSync(join(PLUGIN_ROOT, "src", "index.ts"), "utf8")
  // Built artifact, which must carry the REBUILT bytes rather than the pre-fix ones.
  const dist = readFileSync(join(PLUGIN_ROOT, "dist", "index.js"), "utf8")
  for (const [what, text] of [["src", src], ["dist", dist]] as const) {
    expect({ what, hasTypeArray: /type:\s*\[/.test(text) }).toEqual({ what, hasTypeArray: false })
  }
  // the shipped artifact must be the REBUILT one, not the pre-fix bytes
  expect(dist).toContain('lines: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] }')
})

// ── B1 repair (t13): the guard's file_path must resolve with the SAME base as the registry ────────
// The registry is session-keyed (mpd_hashline_format stores the session-resolved absolute path),
// while the plain edit/write tools report the path as the model wrote it — often RELATIVE. Resolving
// that with process.cwd() makes the membership test miss and the guard silently no-ops.
test("the guard resolves a RELATIVE file_path against the session workspace, not process.cwd()", async () => {
  // Mount whose captured post-execute listener drives the guard as the waterfall does.
  const { byName, listeners } = mount()
  // Registration tool handle: the one that writes the session-keyed registry, cast under the same
  // `unknown`-result contract as the read and edit handles above.
  const format = byName("mpd_hashline_format") as HashlineTool<FormatResult>
  // Workspace of the session under test; it keys the registry.
  const sessionWs = mkdtempSync(join(tmpdir(), "mpd-hashline-ws-"))
  // A second workspace, proving the guard is session-scoped rather than global.
  const otherWs = mkdtempSync(join(tmpdir(), "mpd-hashline-other-"))
  // Exec carrying the session header the adapter reads the workspace from.
  const sessionExec = { agent: { session: { header: { cwd: sessionWs } } } }
  // Exec of the other session, used for the miss case.
  const otherExec = { agent: { session: { header: { cwd: otherWs } } } }
  // The single post-execute listener the plugin registered.
  const guard = listeners[0]
  // Drive the guard once with a plain `edit` call, exactly as the harness waterfall would; only the
  // session-bearing agent is read off the exec, so the parameter states just that much.
  const driveGuard = (exec: { agent: unknown }, filePath: unknown): ReturnType<typeof guard> =>
    guard({ name: "edit", arguments: { file_path: filePath }, agent: exec.agent }, {}, async () => ({ kind: "accept" }))
  try {
    // The session must differ from the process cwd, or the case proves nothing.
    expect(sessionWs).not.toBe(process.cwd())
    writeFileSync(join(sessionWs, "sample.txt"), "alpha\nbeta\n")

    // register with a RELATIVE path THROUGH the session: the registry stores the session absolute path
    const formatted = await format.execute({ path: "sample.txt" }, sessionExec)
    expect(formatted.path).toBe(join(sessionWs, "sample.txt"))
    // Registry file the format tool wrote, under the SESSION's workspace rather than the process cwd.
    const registry = JSON.parse(readFileSync(join(sessionWs, ".mpd", "hashline-files.json"), "utf8"))
    expect(registry).toEqual([join(sessionWs, "sample.txt")])

    // 1) relative path + the SAME session ⇒ the guard fires
    const hit = await driveGuard(sessionExec, "sample.txt")
    expect(String(hit.content?.[0]?.text ?? "")).toContain("[mpd-hashline guard]")

    // 2) absolute path ⇒ unchanged behaviour, the guard fires too
    const absHit = await driveGuard(sessionExec, join(sessionWs, "sample.txt"))
    expect(String(absHit.content?.[0]?.text ?? "")).toContain("[mpd-hashline guard]")

    // 3) a DIFFERENT session ⇒ the file is not registered there, so the guard passes through
    const miss = await driveGuard(otherExec, "sample.txt")
    expect(miss.content).toBeUndefined()

    // 4) no session at all ⇒ falls back to the process cwd, which holds no such file
    const noAgent = await guard({ name: "edit", arguments: { file_path: "sample.txt" } }, {}, async () => ({ kind: "accept" }))
    expect(noAgent.content).toBeUndefined()
  } finally {
    rmSync(sessionWs, { recursive: true, force: true })
    rmSync(otherWs, { recursive: true, force: true })
  }
})
