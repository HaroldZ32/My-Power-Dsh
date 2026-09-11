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

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

type Registered = { name: string; parameters?: any; output?: { schema?: any } }

function mount(): { tools: Registered[]; listeners: any[]; byName: (n: string) => Registered | undefined } {
  const tools: Registered[] = []
  const listeners: any[] = []
  const ctx: any = {
    get: () => undefined,
    tools: { register: (d: Registered) => { tools.push(d); return () => {} } },
    // The post-execute guard registers through this seam; capturing the listener keeps apply() pure
    // while letting a case drive the guard exactly as the harness waterfall does.
    on: (event: string, listener: any) => { if (event === "tools/post-execute") listeners.push(listener) },
  }
  apply(ctx, {})
  return { tools, listeners, byName: (n) => tools.find((t) => t.name === n) }
}

function anchorsOf(view: string): string[] {
  return view.split("\n").filter((l) => l.includes("|")).map((l) => l.slice(0, l.indexOf("|")))
}

test("no registered hashline schema uses a type ARRAY (parameters or output)", () => {
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
  const { byName } = mount()
  const lines = (byName("mpd_hashline_edit") as any).parameters.properties.edits.items.properties.lines
  expect(lines.type).toBeUndefined()
  expect(lines.oneOf).toEqual([{ type: "string" }, { type: "array", items: { type: "string" } }])
})

test("read then edit works with lines as a single string AND as an array of strings", async () => {
  const { byName } = mount()
  const read = byName("mpd_hashline_read") as any
  const edit = byName("mpd_hashline_edit") as any
  const dir = mkdtempSync(join(tmpdir(), "mpd-hashline-schema-"))
  const file = join(dir, "sample.txt")
  try {
    writeFileSync(file, "alpha\nbeta\ngamma\n")

    const first = await read.execute({ path: file })
    expect(first.lines).toBe(4)
    const a1 = anchorsOf(first.view)

    // lines as a single STRING
    const stringEdit = await edit.execute({ path: file, edits: [{ op: "replace", pos: a1[1], lines: "BETA" }] })
    expect(stringEdit.noopEdits).toBe(0)
    expect(readFileSync(file, "utf8")).toBe("alpha\nBETA\ngamma\n")

    // lines as an ARRAY of strings (one anchored replace expanding into two lines)
    const second = await read.execute({ path: file })
    const a2 = anchorsOf(second.view)
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

test("the committed src AND dist carry no array-typed schema form, and the dist carries the oneOf fix", () => {
  const src = readFileSync(join(PLUGIN_ROOT, "src", "index.ts"), "utf8")
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
  const { byName, listeners } = mount()
  const format = byName("mpd_hashline_format") as any
  const sessionWs = mkdtempSync(join(tmpdir(), "mpd-hashline-ws-"))
  const otherWs = mkdtempSync(join(tmpdir(), "mpd-hashline-other-"))
  const sessionExec = { agent: { session: { header: { cwd: sessionWs } } } }
  const otherExec = { agent: { session: { header: { cwd: otherWs } } } }
  const guard = listeners[0]
  const driveGuard = (exec: any, filePath: unknown) =>
    guard({ name: "edit", arguments: { file_path: filePath }, agent: exec.agent }, {}, async () => ({ kind: "accept" }))
  try {
    // The session must differ from the process cwd, or the case proves nothing.
    expect(sessionWs).not.toBe(process.cwd())
    writeFileSync(join(sessionWs, "sample.txt"), "alpha\nbeta\n")

    // register with a RELATIVE path THROUGH the session: the registry stores the session absolute path
    const formatted = await format.execute({ path: "sample.txt" }, sessionExec)
    expect(formatted.path).toBe(join(sessionWs, "sample.txt"))
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
