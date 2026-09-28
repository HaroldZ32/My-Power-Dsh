// Unit tests for the settings→JSONC write-back bridge (design §A/§B/§2, U8/U10/U11/U13/U14).
// Every failure path asserts BOTH the named outcome AND the file's byte identity.
import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { changedLeaves, createdFileHeader, leavesFromSection, resolveTargets, sectionLeaves, targetFiles, writeBackLeaves } from "../src/bridge"
import { readJsonc } from "../src/jsonc-edit"

// Sandbox trees this run created, drained by the afterEach below so no test leaves a temp dir behind.
const temps: string[] = []
/** A fresh workspace root plus its default target file, recorded in `temps` for later teardown. */
function sandbox(): { root: string; file: string } {
  // Unique temp directory per call; its `.mpd` subdirectory must exist before the bridge writes.
  const dir = mkdtempSync(join(tmpdir(), "mpd-bridge-"))
  temps.push(dir)
  // The workspace root the bridge is handed as a live session cwd.
  const root = join(dir, "ws")
  mkdirSync(join(root, ".mpd"), { recursive: true })
  return { root, file: join(root, ".mpd", "mpd.jsonc") }
}
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// A JSONC target carrying a line comment, an inline block comment and trailing commas — the exact
// bytes every assertion below compares against, because the writer must preserve all three.
const WITH_COMMENTS = `{
  // human comment above hashline
  "hashline": {
    "maxDiffChars": 20000, /* inline */
  },
  "ulw": {
    "maxRounds": 6,
  },
}
`

describe("target set (design §A.1 — never a guessed root)", () => {
  test("U14: exactly one live root is written; two live roots REFUSE and name both candidates", () => {
    // The file operand is DERIVED with the platform's own join: hard-coding "/a/.mpd/mpd.jsonc"
    // pins the POSIX separator (win32 answers "\a\.mpd\mpd.jsonc"), not the behaviour under test.
    // Typed off `targetFiles` so this expectation cannot drift from the pair it must equal.
    const at = (root: string): ReturnType<typeof targetFiles>[number] => ({ root, file: join(root, ".mpd", "mpd.jsonc") })
    expect(resolveTargets(["/a"])).toEqual({ kind: "write", targets: [at("/a")] })
    // The multi-root decision under test: refuse, and name BOTH candidates (design §A.1 forbids a guess).
    const two = resolveTargets(["/a", "/b"])
    expect(two).toEqual({ kind: "refuse", reason: "ambiguous-multi-root", candidates: ["/a", "/b"] })
    // a duplicated root is still ONE candidate, and a projectFile override applies only to the single-root case
    expect(resolveTargets(["/a", "/a"])).toEqual({ kind: "write", targets: [at("/a")] })
    expect(resolveTargets(["/a"], "/custom.jsonc")).toEqual({ kind: "write", targets: [{ root: "/a", file: "/custom.jsonc" }] })
  })

  test("U14 (must-fail-if-fanout): two live roots touch NO file, the settings write is untouched", () => {
    // First live root; its target is filled with the comment-bearing bytes below.
    const a = sandbox()
    // Second live root: the pair must produce a refusal rather than two writes.
    const b = sandbox()
    writeFileSync(a.file, WITH_COMMENTS)
    writeFileSync(b.file, WITH_COMMENTS)
    // The decider's verdict for the two roots; both must come back as named candidates.
    const decision = resolveTargets([a.root, b.root])
    expect(decision.kind).toBe("refuse")
    // the report shape a caller produces from that decision: nothing written, both named
    const report = decision.kind === "refuse" ? { writtenTo: [], results: [], skipped: decision.reason, candidates: decision.candidates } : undefined
    expect(report?.skipped).toBe("ambiguous-multi-root")
    expect(report?.writtenTo).toEqual([])
    expect(report?.candidates).toEqual([a.root, b.root])
    expect(readFileSync(a.file, "utf8")).toBe(WITH_COMMENTS)
    expect(readFileSync(b.file, "utf8")).toBe(WITH_COMMENTS)
    expect(targetFiles([a.root, b.root]).length).toBe(2)
  })

  test("zero live roots writes NOTHING anywhere and reports no-live-session", () => {
    // No live root at all: the writer must skip rather than fall back to a guessed path.
    const report = writeBackLeaves([], [{ path: ["ulw", "maxRounds"], value: 9 }])
    expect(report.skipped).toBe("no-live-session")
    expect(report.writtenTo).toEqual([])
    expect(report.results).toEqual([])
    expect(report.applies).toBe("restart")
  })

  test("the negative-control switch refuses to write even with a live root", () => {
    // One live root whose target already holds the comment-bearing bytes.
    const { root, file } = sandbox()
    writeFileSync(file, WITH_COMMENTS)
    // The bytes before the call; a disabled write must leave them byte-identical.
    const before = readFileSync(file, "utf8")
    // Negative control: `writeBack: false` must refuse even though exactly one live root exists.
    const report = writeBackLeaves(targetFiles([root]), [{ path: ["ulw", "maxRounds"], value: 9 }], { writeBack: false, retries: 3 })
    expect(report.skipped).toBe("disabled")
    expect(readFileSync(file, "utf8")).toBe(before)
  })
})

describe("happy paths", () => {
  test("U1: a live root gets the value written with comments, order and trailing commas intact", () => {
    // A live root whose target already exists with the comment-bearing bytes.
    const { root, file } = sandbox()
    writeFileSync(file, WITH_COMMENTS)
    // The report for one leaf change: `ulw.maxRounds` 6 → 9 in the only live root.
    const report = writeBackLeaves(targetFiles([root]), [{ path: ["ulw", "maxRounds"], value: 9 }])
    expect(report.writtenTo).toEqual([file])
    expect(report.results[0].outcome).toBe("written")
    expect(readFileSync(file, "utf8")).toBe(WITH_COMMENTS.replace("6", "9"))
    expect(readFileSync(file, "utf8")).toContain("// human comment above hashline")
    expect(report.applies).toBe("restart")
  })

  test("U11: a missing target is created with the header comment, and a repeat run is unchanged", () => {
    // A live root whose target does NOT exist yet — the creation path.
    const { root, file } = sandbox()
    // First call: the absent target must be CREATED, not silently skipped.
    const first = writeBackLeaves(targetFiles([root]), [{ path: ["ulw", "maxRounds"], value: 6 }])
    expect(first.results[0].outcome).toBe("created")
    // The created bytes; the repeat run below must reproduce them exactly.
    const text = readFileSync(file, "utf8")
    // the header carries a live ISO timestamp, so only its stable parts are asserted
    expect(text.split("\n")[0].startsWith("// mpd.jsonc — written by the mpd settings bridge (")).toBe(true)
    expect(text.split("\n")[0].endsWith(")")).toBe(true)
    expect(text.split("\n")[1]).toBe(createdFileHeader().split("\n")[1])
    expect(JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""))).toEqual({ ulw: { maxRounds: 6 } })
    // Repeat of the same value: the writer must report `unchanged` and rewrite no byte.
    const second = writeBackLeaves(targetFiles([root]), [{ path: ["ulw", "maxRounds"], value: 6 }])
    expect(second.results[0].outcome).toBe("unchanged")
    expect(second.writtenTo).toEqual([])
    expect(readFileSync(file, "utf8")).toBe(text)
  })

  test("the writer reports per root when handed several targets (the DECIDER never hands it more than one)", () => {
    // First target root, holding the comment-bearing JSONC.
    const a = sandbox()
    // Second target root, so this call hands the writer two files at once.
    const b = sandbox()
    writeFileSync(a.file, WITH_COMMENTS)
    writeFileSync(b.file, WITH_COMMENTS)
    // Both roots carry the changeable leaf, so each must report `written` independently.
    const report = writeBackLeaves(targetFiles([a.root, b.root]), [{ path: ["ulw", "maxRounds"], value: 11 }])
    // The report hands back a READONLY list, which cannot be sorted in place; the assertion orders a
    // COPY of it, so what it compares is the writer's own reported set, left unmutated.
    expect([...report.writtenTo].sort()).toEqual([a.file, b.file].sort())
    expect(report.results.map((r) => r.outcome)).toEqual(["written", "written"])
    // a failure on one root never hides another root's success (design §B.3)
    const c = sandbox()
    writeFileSync(c.file, '{ "ulw": }')
    // Per-root isolation: the unparsable sibling must not hide the other root's success.
    const mixed = writeBackLeaves(targetFiles([c.root, a.root]), [{ path: ["ulw", "maxRounds"], value: 12 }])
    expect(mixed.results.map((r) => r.outcome)).toEqual(["unparsable", "written"])
    expect(mixed.writtenTo).toEqual([a.file])
  })
})

describe("loud failure paths (design §B.2/§7)", () => {
  test("U10: a read-only target is reported denied, byte-untouched, and names the file", () => {
    // A live root whose target exists and is then stripped of every write bit.
    const { root, file } = sandbox()
    writeFileSync(file, WITH_COMMENTS)
    chmodSync(file, 0o444)
    // The bytes before the call; a `denied` outcome must not touch them.
    const before = readFileSync(file, "utf8")
    // The report for the read-only target, which must name the file it refused.
    const report = writeBackLeaves(targetFiles([root]), [{ path: ["ulw", "maxRounds"], value: 9 }])
    // That root's own result record: the one carrying the outcome, the path and the reason.
    const result = report.results[0]
    expect(result.outcome).toBe("denied")
    expect(result.file).toBe(file)
    // §10.3 names the REASON `read-only` (the status stays `denied`, §B.2/E11)
    expect(result.reason).toBe("read-only")
    expect(readFileSync(file, "utf8")).toBe(before)
    expect(report.writtenTo).toEqual([])
  })

  test("U9: an unparsable target is skipped without writing a byte", () => {
    // A live root whose target is not valid JSONC.
    const { root, file } = sandbox()
    writeFileSync(file, '{ "ulw": }')
    // The malformed bytes; an `unparsable` outcome must never repair them.
    const before = readFileSync(file, "utf8")
    // The report for the malformed target: skipped without a byte written.
    const report = writeBackLeaves(targetFiles([root]), [{ path: ["ulw", "maxRounds"], value: 9 }])
    expect(report.results[0].outcome).toBe("unparsable")
    expect(readFileSync(file, "utf8")).toBe(before)
  })

  test("a duplicate key in the target refuses with both line numbers and no write", () => {
    // A live root whose target repeats the leaf key on two separate lines.
    const { root, file } = sandbox()
    writeFileSync(file, '{\n  "ulw": { "maxRounds": 6 },\n  "ulw": { "maxRounds": 7 },\n}\n')
    // The duplicated-key bytes; a refusal must leave both lines untouched.
    const before = readFileSync(file, "utf8")
    // The report for that target: refused, naming both offending line numbers.
    const report = writeBackLeaves(targetFiles([root]), [{ path: ["ulw", "maxRounds"], value: 9 }])
    expect(report.results[0].outcome).toBe("refused")
    expect(String(report.results[0].detail)).toContain("lines 2, 3")
    expect(readFileSync(file, "utf8")).toBe(before)
  })

  test("U8: a human edit landing mid-write ends as conflict, leaving the human's bytes", () => {
    // A live root whose target a human will edit in the middle of the write.
    const { root, file } = sandbox()
    writeFileSync(file, WITH_COMMENTS)
    // How often the sabotage hook fired: once per write attempt, so three at the full budget.
    let saves = 0
    // The human's most recent bytes, which must be the ones left on disk when the retries run out.
    let last = WITH_COMMENTS
    // The report for a write whose compare-and-swap can never succeed.
    const report = writeBackLeaves(targetFiles([root]), [{ path: ["ulw", "maxRounds"], value: 9 }], {
      writeBack: true,
      retries: 2,
      hooks: {
        beforeCas: () => {
          // the human saves while the bridge is between its read and its swap; every
          // attempt is sabotaged so the compare-and-swap retry budget is exhausted
          saves += 1
          last = WITH_COMMENTS.replace("20000", String(12000 + saves))
          writeFileSync(file, last)
        },
      },
    })
    expect(report.results[0].outcome).toBe("conflict")
    expect(saves).toBe(3)
    expect(report.writtenTo).toEqual([])
    expect(readFileSync(file, "utf8")).toBe(last)
    expect(existsSync(`${file}.mpd-bridge-${process.pid}-1.tmp`)).toBe(false)
  })
})

describe("section leaves and the change diff", () => {
  test("a front-door edit yields only the added/changed leaves; a reset yields none", () => {
    // The leaves as the user left them before the front-door edit.
    const prev = { hashline: { maxDiffChars: 20000 }, ulw: { maxRounds: 6 } }
    // The leaves after the edit: one value changed, its sibling untouched.
    const next = { hashline: { maxDiffChars: 4096 }, ulw: { maxRounds: 6 } }
    // The delta for that edit: only the changed leaf is a write target, and nothing was removed.
    const delta = changedLeaves(prev, next)
    expect(delta.written).toEqual([{ path: ["hashline", "maxDiffChars"], value: 4096 }])
    expect(delta.removed).toEqual([])
    // a RESET (user section leaf removed) is not a write target: the file stays the authority
    expect(changedLeaves(next, { ulw: { maxRounds: 6 } }).written).toEqual([])
    expect(changedLeaves(next, { ulw: { maxRounds: 6 } }).removed).toEqual([{ path: ["hashline", "maxDiffChars"], value: 4096 }])
    // an array is a leaf VALUE, never a path
    expect(sectionLeaves({ extensions: { disable: ["a", "b"] } })).toEqual([{ path: ["extensions", "disable"], value: ["a", "b"] }])
  })

  test("U12 helper: an unchanged section produces no write (the deep-equal gate cannot drop a raw change)", () => {
    // One section compared with itself, so a no-op edit must produce no write at all.
    const section = { hashline: { maxDiffChars: 4096 } }
    expect(changedLeaves(section, section).written).toEqual([])
  })
})

describe("leavesFromSection", () => {
  test("only declared paths become leaves, and absent paths are skipped", () => {
    // Two declared paths, only the first of which is present in the section.
    const leaves = leavesFromSection({ hashline: { maxDiffChars: 4096 }, nothing: true }, [
      ["hashline", "maxDiffChars"],
      ["ulw", "maxRounds"],
    ])
    expect(leaves).toEqual([{ path: ["hashline", "maxDiffChars"], value: 4096 }])
  })
})


describe("the settled duplicate-key ruling reaches the writer's report (nothing silent)", () => {
  test("a duplicated leaf key is WRITTEN (last occurrence) and the per-root result carries the loud note", () => {
    // A live root whose target repeats a LEAF key; the runtime reads the last one.
    const { root, file } = sandbox()
    // the runtime reads the LAST occurrence, so that is the one the bridge must update
    writeFileSync(file, `{\n  "ulw": {\n    "maxRounds": 3,\n    "maxRounds": 6,\n  },\n}\n`)
    // The report for that target: the last occurrence updated, with a loud per-root note.
    const report = writeBackLeaves(targetFiles([root]), [{ path: ["ulw", "maxRounds"], value: 11 }])
    expect(report.results[0].outcome).toBe("written")
    expect(report.writtenTo).toEqual([file])
    // The rewritten bytes: the new value sits on the SECOND occurrence, the first is left alone.
    const text = readFileSync(file, "utf8")
    expect(text).toBe(`{\n  "ulw": {\n    "maxRounds": 3,\n    "maxRounds": 11,\n  },\n}\n`)
    // The rewritten text re-read as JSONC, trailing comma included.
    const parsed = readJsonc(text) // JSONC: the file intentionally carries a trailing comma
    expect(parsed.ok).toBe(true)
    if (parsed.ok === true) expect(parsed.value).toEqual({ ulw: { maxRounds: 11 } })
    expect(report.results[0].notes).toHaveLength(1)
    expect(report.results[0].notes?.[0].lines).toEqual([3, 4])
    expect(report.results[0].notes?.[0].detail).toContain("appears 2 times at lines 3, 4")
    expect(report.results[0].notes?.[0].detail).toContain("the last occurrence is the effective value and was updated")
  })

  test("a duplicated INTERMEDIATE is still refused byte-untouched", () => {
    // A live root whose target repeats an INTERMEDIATE object rather than a leaf.
    const { root, file } = sandbox()
    writeFileSync(file, `{\n  "ulw": { "maxRounds": 3 },\n  "other": 1,\n  "ulw": { "maxRounds": 6 },\n}\n`)
    // The bytes before the call; an ambiguous intermediate must stay untouched.
    const before = readFileSync(file, "utf8")
    // The report for that target: refused as `ambiguous-intermediate`, no byte written.
    const report = writeBackLeaves(targetFiles([root]), [{ path: ["ulw", "maxRounds"], value: 11 }])
    expect(report.results[0].outcome).toBe("refused")
    expect(report.results[0].reason).toBe("ambiguous-intermediate")
    expect(readFileSync(file, "utf8")).toBe(before)
  })
})
