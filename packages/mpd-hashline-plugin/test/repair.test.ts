// S3 acceptance: the conservative fuzzy-repair pass.
//
// The pass undoes exactly two manglings a replacement block can come back with — one logical line
// split across two entries, and a block that lost its block-level indentation — and it refuses
// everything it cannot decide from the file's own bytes. These cases cover the two repairs, the
// NEGATIVE CONTROL (an ambiguous block names two candidate splits and must be left exactly as the
// caller wrote it), the exact-match guard, the interfaces the contract freezes, and the two
// round-trips that leave the vendor layer: a CRLF/BOM file, and the tool result.
import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index.ts"
import * as vendor from "../src/vendor/index.ts"
import { applyHashlineEditsWithReport, computeLineHash } from "../src/vendor/index.ts"
import type { DshToolDef, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The `LINE#HASH` anchor for a 1-based line of `lines`, as the read view would print it. */
function anchorFor(lines: string[], line: number): string {
  return line + "#" + computeLineHash(line, lines[line - 1])
}

/** A registered hashline tool handle whose result this case states, since the adapter types it `unknown`. */
type HashlineTool<Result> = Omit<DshToolDef, "execute"> & {
  /** Run the tool body; `exec` stays optional because every case here passes an absolute path. */
  execute(args: Record<string, unknown>, exec?: DshToolExec): Promise<Result>
}

/** `mpd_hashline_read`'s answer: the anchor view plus the source-line count it covers. */
type ReadResult = {
  /** How many source lines the view has. */
  lines: number
  /** The `LINE#HASH|content` view whose anchors the edit below passes back. */
  view: string
}

/** `mpd_hashline_edit`'s answer: the counters plus the diff field the repair notice rides in. */
type EditResult = {
  /** Source lines after the edit. */
  lines: number
  /** Edits that changed nothing. */
  noopEdits: number
  /** The unified diff, prefixed by the repair notice when the pass repaired something. */
  diff?: string
}

/** Install the plugin on a fake ctx and hand back a lookup for the tools it registered. */
function mount(): (name: string) => DshToolDef | undefined {
  /** Every tool the plugin registered, in registration order. */
  const tools: DshToolDef[] = []
  // Minimal host ctx: `get` answers "no service", so the row config stays authoritative.
  const ctx: Parameters<typeof apply>[0] = {
    get: () => undefined,
    tools: { register: (d: DshToolDef) => { tools.push(d); return () => {} } },
    // The guard registers through this seam; these cases drive the tools, never the guard.
    on: (event: string, listener: (...a: unknown[]) => unknown) => { void event; void listener },
  }
  apply(ctx, {})
  return (name) => tools.find((t) => t.name === name)
}

/** The `LINE#HASH` anchors of a hashline view, in file order. */
function anchorsOf(view: string): string[] {
  return view.split("\n").filter((l) => l.includes("|")).map((l) => l.slice(0, l.indexOf("|")))
}

// ── The two repairs ──────────────────────────────────────────────────────────────────────────────

// A logical line the caller's block split across two entries: entry 0 leaves `(` open, entry 1 closes
// it and carries no indentation of its own. The pass rejoins them, and the space comes from the
// trailing `,` — `call(one,b)` would be a different program from `call(one, b)`.
test("a replacement line the block wrapped across two entries IS repaired", () => {
  // Three-line fixture whose middle line is the one being replaced.
  const lines = ["function run() {", "    call(one,", "}"]
  // The mangled replacement: the intended single line arrived as two entries.
  const report = applyHashlineEditsWithReport(lines.join("\n"), [
    { op: "replace", pos: anchorFor(lines, 2), lines: ["    call(one,", "two)"] },
  ])
  expect(report.content).toBe("function run() {\n    call(one, two)\n}")
  expect(report.repairs).toEqual([{ kind: "wrapped-line", at: 0, line: 2, span: 2 }])
})

// A block that lost its indentation: every entry flush left while the range it replaces is indented.
// Without the repair the block's SECOND line would land at column 0 and the file would be mangled.
test("a flush-left replacement block IS re-indented from the range it replaces", () => {
  // Four-line fixture whose lines 2-3 are the two-line range being replaced.
  const lines = ["def run():", "    first()", "    second()", "done"]
  // The mangled replacement: both intended lines arrived without their indent.
  const report = applyHashlineEditsWithReport(lines.join("\n"), [
    { op: "replace", pos: anchorFor(lines, 2), end: anchorFor(lines, 3), lines: ["third()", "fourth()"] },
  ])
  expect(report.content).toBe("def run():\n    third()\n    fourth()\ndone")
  expect(report.repairs).toEqual([{ kind: "paired-indent", at: 0, line: 2, span: 2 }])
})

// ── The negative control ─────────────────────────────────────────────────────────────────────────

// Two candidate splits in ONE block is an ambiguous request: the pass cannot tell which one the
// caller meant, so it repairs NEITHER and the block is spliced exactly as it was written. The second
// half of the case proves the refusal comes from the COUNT and not from the shape — the same pair,
// alone in a block, IS repaired.
test("an AMBIGUOUS block naming two candidate splits is LEFT UNTOUCHED", () => {
  // The ambiguous replacement: two pairs, each individually wrap-shaped.
  const ambiguous = ["    alpha(beta,", "gamma)", "    delta(epsilon,", "zeta)"]
  // A single-line file, replaced wholesale by that block.
  const report = applyHashlineEditsWithReport("    start()", [
    { op: "replace", pos: anchorFor(["    start()"], 1), lines: ambiguous },
  ])
  // NEGATIVE CONTROL: nothing repaired, and every entry survives byte for byte.
  expect(report.repairs).toEqual([])
  expect(report.content).toBe("    alpha(beta,\ngamma)\n    delta(epsilon,\nzeta)")

  // The same shape with ONE candidate: the pair is repaired, so the refusal above is about ambiguity.
  const single = applyHashlineEditsWithReport("    start()", [
    { op: "replace", pos: anchorFor(["    start()"], 1), lines: ["    alpha(beta,", "gamma)"] },
  ])
  expect(single.content).toBe("    alpha(beta, gamma)")
  expect(single.repairs).toEqual([{ kind: "wrapped-line", at: 0, line: 1, span: 2 }])
})

// ── The exact-match guard ────────────────────────────────────────────────────────────────────────

// A block that equals the range it replaces is a successful EXACT edit. This fixture is the strongest
// form of the case: the range itself carries a wrap-shaped pair, so a pass without the guard would
// "repair" a file the caller never asked to change.
test("a replacement that EQUALS the range it replaces is never altered", () => {
  // Two-line fixture that is itself wrap-shaped.
  const lines = ["    alpha(beta,", "gamma)"]
  // The edit hands the range back UNCHANGED, which is the exact-match case under test.
  const report = applyHashlineEditsWithReport(lines.join("\n"), [
    { op: "replace", pos: anchorFor(lines, 1), end: anchorFor(lines, 2), lines: [...lines] },
  ])
  expect(report.repairs).toEqual([])
  expect(report.noopEdits).toBe(1)
  expect(report.content).toBe(lines.join("\n"))
})

// ── The frozen interfaces ────────────────────────────────────────────────────────────────────────

// The contract freezes the seven vendor entry points, the four tool names and the 16-character
// alphabet. `tool-schema.test.ts` owns the tool names and the schema subset; this case pins the rest,
// so a later edit that adds or renames an entry point reddens instead of shipping unnoticed.
test("the seven vendor entry points, the four tool names and the anchor alphabet are unchanged", () => {
  expect(Object.keys(vendor).sort()).toEqual([
    "HASHLINE_DICT",
    "HASHLINE_OUTPUT_PATTERN",
    "HASHLINE_REF_PATTERN",
    "HashlineMismatchError",
    "NIBBLE_STR",
    "applyHashlineEditsWithReport",
    "canonicalizeFileText",
    "computeLineHash",
    "formatHashLine",
    "generateUnifiedDiff",
    "normalizeHashlineEdits",
    "normalizeLineRef",
    "parseLineRef",
    "restoreFileText",
    "toHashlineContent",
    "validateLineRef",
    "validateLineRefs",
  ])
  expect(vendor.NIBBLE_STR).toBe("ZPMQVRWSNKTXJBYH")
  expect(vendor.HASHLINE_DICT).toHaveLength(256)
  expect(vendor.HASHLINE_OUTPUT_PATTERN.test("12#ZK|some content")).toBe(true)

  /** The tools the plugin registered, in registration order. */
  const names = ["mpd_hashline_read", "mpd_hashline_edit", "mpd_hashline_format", "mpd_hashline_restore"]
  for (const name of names) expect(typeof mount()(name)?.execute).toBe("function")
})

// ── The round-trips the contract names ───────────────────────────────────────────────────────────

// The repair is applied to the CANONICAL text and the write-back restores the envelope, so a CRLF +
// BOM file must come back CRLF + BOM with the rejoined line — never rewritten to LF, never stripped.
test("a CRLF + BOM file repaired through the tool round-trips its envelope", async () => {
  // Fresh mount for the read-then-edit round trip through the real tool bodies.
  const byName = mount()
  // Read tool handle, driven with an absolute path so the case needs no session.
  const read = byName("mpd_hashline_read") as HashlineTool<ReadResult>
  // Edit tool handle, the writer whose reported repair this case also asserts.
  const edit = byName("mpd_hashline_edit") as HashlineTool<EditResult>
  // Throwaway directory for the CRLF + BOM fixture.
  const dir = mkdtempSync(join(tmpdir(), "mpd-hashline-repair-"))
  // The fixture: a BOM, CRLF breaks, and a second line the edit will replace.
  const file = join(dir, "sample.txt")
  try {
    // Written with `\r\n` breaks and a leading BOM, i.e. the envelope that must survive the repair.
    writeFileSync(file, "\uFEFFtitle\r\n    call(one)\r\n")

    // The anchor view is computed over the CANONICAL text, which is CR-insensitive.
    const first = await read.execute({ path: file })
    expect(first.lines).toBe(2)
    // Anchors of the first view; a1[1] is the anchor of line 2.
    const a1 = anchorsOf(first.view)

    // The mangled replacement: the intended single line arrived as two entries.
    const result = await edit.execute({ path: file, edits: [{ op: "replace", pos: a1[1], lines: ["    call(other,", "arg)"] }] })
    expect(result.noopEdits).toBe(0)

    // THE REPAIR IS REPORTED in the tool result, above the diff, naming the mangling it undid.
    expect(String(result.diff)).toContain("[mpd-hashline repair]")
    expect(String(result.diff)).toContain("rejoined a replacement line")

    // …and the bytes on disk are the rejoined line in the file's OWN envelope.
    const raw = readFileSync(file, "utf8")
    expect(raw).toBe("\uFEFFtitle\r\n    call(other, arg)\r\n")
    expect(raw.startsWith("\uFEFF")).toBe(true)
    expect(/[^\r]\n/.test(raw)).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// The other round-trip: the tool result itself. A plain LF file repaired through the tool reports the
// repair, and an unrepaired edit reports nothing — so the notice is attributable, not decorative.
test("the tool result reports the repair, and stays silent when nothing was repaired", async () => {
  // Fresh mount for the two edits below.
  const byName = mount()
  // Read tool handle, driven with an absolute path so the case needs no session.
  const read = byName("mpd_hashline_read") as HashlineTool<ReadResult>
  // Edit tool handle, whose `diff` field this case reads.
  const edit = byName("mpd_hashline_edit") as HashlineTool<EditResult>
  // Throwaway directory for the plain LF fixture.
  const dir = mkdtempSync(join(tmpdir(), "mpd-hashline-report-"))
  // Two-line LF fixture, with no envelope to preserve.
  const file = join(dir, "sample.txt")
  try {
    writeFileSync(file, "title\n    call(one)\n")

    // Anchors of the fixture; the edit targets line 2.
    const a1 = anchorsOf((await read.execute({ path: file })).view)
    // A CONFORMING replacement: one entry, nothing to repair.
    const plain = await edit.execute({ path: file, edits: [{ op: "replace", pos: a1[1], lines: "    call(two)" }] })
    expect(String(plain.diff)).not.toContain("[mpd-hashline repair]")
    expect(String(plain.diff)).toContain("+    call(two)")

    // Anchors AFTER the first edit: same line numbers, a fresh hash where the text changed.
    const a2 = anchorsOf((await read.execute({ path: file })).view)
    // The mangled replacement, which the pass must repair AND report.
    const repaired = await edit.execute({ path: file, edits: [{ op: "replace", pos: a2[1], lines: ["    call(three,", "four)"] }] })
    expect(String(repaired.diff)).toContain("[mpd-hashline repair]")
    expect(String(repaired.diff)).toContain("rejoined a replacement line the block had wrapped across 2 entries (block line 1, file line 2)")
    expect(readFileSync(file, "utf8")).toBe("title\n    call(three, four)\n")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
