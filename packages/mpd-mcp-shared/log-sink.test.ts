// Runtime tests for the terminal-silence sink (R5, lane F).
//
// `packages/mpd-dsh-adapter-plugin/test/no-terminal-writes.test.ts` is the STATIC half of R5 — it proves
// no new terminal write enters an MPD runtime path. This file is the RUNTIME half: it locks the sink's
// own behaviour on the paths a launcher depends on and that a static scan cannot see.
//
// Every arm runs against a temp directory it creates and removes, and the capturing arm restores the
// process's writers in a `finally` so a failing arm cannot leave the test runner silenced.
import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { installTerminalSilence, LOG_ROOT_ENV_KEYS, openLogSink, resolveLogRoots } from "./log-sink.ts"

/** Every temp root this file created, removed by `afterEach` so no arm leaks a directory. */
const temps: string[] = []

/** Create a fresh temp root and register it for cleanup. */
function tempRoot(): string {
  /** The new directory, registered before anything inside it can fail. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-log-sink-"))
  temps.push(dir)
  return dir
}

/** The lines a log file holds, oldest first; `[]` when the file does not exist. */
function linesOf(file: string | null): string[] {
  if (file === null || !existsSync(file)) return []
  return readFileSync(file, "utf8").split("\n").filter((line) => line !== "")
}

afterEach(() => {
  while (temps.length > 0) {
    /** One recorded temp root, removed with everything the sink wrote inside it. */
    const dir = temps.pop()
    if (dir === undefined) continue
    // A chmod-ed arm must be made writable again before it can be removed.
    try { chmodSync(dir, 0o700) } catch { /* already writable, or gone */ }
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})

describe("root resolution and writability", () => {
  test("the documented env keys come first, in order", () => {
    /** The resolved chain for an env that names both keys plus a cwd. */
    const roots = resolveLogRoots({ MPD_MCP_LOG_DIR: "/a", DSH_WORKSPACE_ROOT: "/b" }, "/c")
    expect(LOG_ROOT_ENV_KEYS).toEqual(["MPD_MCP_LOG_DIR", "DSH_WORKSPACE_ROOT"])
    expect(roots.slice(0, 3)).toEqual(["/a", "/b", "/c"])
    // The tmpdir tier is always present, so the chain can never be empty.
    expect(roots.length).toBe(4)
  })

  test("blank and duplicate candidates are dropped", () => {
    /** The resolved chain for an env with a blank key and a cwd that repeats the workspace root. */
    const roots = resolveLogRoots({ MPD_MCP_LOG_DIR: "   ", DSH_WORKSPACE_ROOT: "/b" }, "/b")
    expect(roots[0]).toBe("/b")
    expect(roots.filter((root) => root === "/b")).toHaveLength(1)
  })

  test("the first WRITABLE root wins and the log file appears under it", () => {
    /** The first candidate root. */
    const first = tempRoot()
    /** The second candidate root, which must NOT be used. */
    const second = tempRoot()
    /** The opened sink. */
    const sink = openLogSink("probe", { roots: [first, second] })
    sink.write("hello")
    expect(sink.file).toBe(join(first, ".mpd", "logs", "probe.log"))
    expect(sink.root).toBe(first)
    expect(linesOf(sink.file)[0]).toContain("hello")
    expect(existsSync(join(second, ".mpd"))).toBe(false)
  })

  test("an unwritable candidate falls through to the next one", () => {
    /** A regular FILE standing in for an unusable root (mkdir under it cannot succeed). */
    const blocker = join(tempRoot(), "not-a-directory")
    writeFileSync(blocker, "")
    /** The usable root behind it. */
    const usable = tempRoot()
    /** The opened sink, which must have skipped the blocker. */
    const sink = openLogSink("probe", { roots: [blocker, usable] })
    expect(sink.root).toBe(usable)
    expect(sink.file).toBe(join(usable, ".mpd", "logs", "probe.log"))
  })
})

describe("when no root is writable", () => {
  test("the sink goes to the ring: no file, no throw, and the lines are kept in memory", () => {
    /** A regular FILE standing in for the only candidate root. */
    const blocker = join(tempRoot(), "not-a-directory")
    writeFileSync(blocker, "")
    /** The sink opened against that unusable root. */
    const sink = openLogSink("probe", { roots: [blocker], ringLines: 3 })
    for (let index = 1; index <= 5; index += 1) sink.write(`line-${index}`)
    expect(sink.file).toBeNull()
    expect(sink.root).toBeNull()
    expect(sink.fd()).toBeNull()
    expect(sink.written()).toBe(5)
    // The ring keeps the NEWEST records and counts what it evicted.
    expect(sink.ring()).toHaveLength(3)
    expect(sink.ring()[0]).toContain("line-3")
    expect(sink.ring()[2]).toContain("line-5")
    expect(sink.dropped()).toBe(2)
  })
})

describe("size cap and rotation", () => {
  test("the log rotates to a single `.1` generation once the cap is crossed", () => {
    /** The root the sink writes into. */
    const root = tempRoot()
    /** A sink whose cap is small enough to rotate after a couple of records. */
    const sink = openLogSink("probe", { roots: [root], maxBytes: 120, maxLineBytes: 200, timestamps: false })
    for (let index = 0; index < 12; index += 1) sink.write(`record-${index}-${"x".repeat(40)}`)
    expect(sink.rotations()).toBeGreaterThan(0)
    /** The rotated generation, which must exist and must be the OLDER one. */
    const rotated = `${sink.file}.1`
    expect(existsSync(rotated)).toBe(true)
    expect(linesOf(sink.file).at(-1)).toContain("record-11")
    // One generation only: a `.2` is never produced.
    expect(existsSync(`${sink.file}.2`)).toBe(false)
    /** The live file's size, which the cap keeps bounded (one record may overshoot). */
    const live = readFileSync(sink.file as string).byteLength
    expect(live).toBeLessThanOrEqual(200)
  })

  test("a line longer than the per-line cap is truncated with a marker", () => {
    /** The root the sink writes into. */
    const root = tempRoot()
    /** A sink with a 64-byte line cap. */
    const sink = openLogSink("probe", { roots: [root], maxLineBytes: 64, timestamps: false })
    sink.write("h".repeat(500))
    /** The single record that was written. */
    const record = linesOf(sink.file)[0] ?? ""
    expect(record).toContain("truncated")
    expect(record.length).toBeLessThan(200)
  })
})

describe("capture and restore", () => {
  test("stderr and the five console methods are replaced, stdout is NOT touched, restore puts them back", () => {
    /** The root the sink writes into. */
    const root = tempRoot()
    /** The original stderr writer, compared after `restore`. */
    const originalStderrWrite = process.stderr.write
    /** The original console.log, compared after `restore`. */
    const originalConsoleLog = console.log
    // `MPD_MCP_STDERR_REBIND=0` on purpose: the descriptor rebind is PROCESS-GLOBAL and cannot be
    // undone, so a test sharing the runner's stderr must not perform it. The child-process arm below
    // proves the rebind itself, where outliving the sink is exactly what it is supposed to do; THIS
    // arm proves the opt-out skips ONLY that layer — the writer sink stays installed.
    const sink = installTerminalSilence("probe", { roots: [root], timestamps: false, env: { MPD_MCP_STDERR_REBIND: "0" } })
    try {
      process.stderr.write("raw-stderr\n")
      console.warn("warned %s", "text")
      console.log("logged")
      console.error("errored")
      expect(process.stderr.write).not.toBe(originalStderrWrite)
      expect(console.log).not.toBe(originalConsoleLog)
      // The documented opt-out outcome: no rebind was attempted and it is REPORTED, not silently
      // ignored. A performed rebind answers "rebound", so this single value pins the difference.
      expect(sink.stderrRebind()).toBe("disabled")
      /** The recorded lines, read back from the log. */
      const written = linesOf(sink.file).join("\n")
      expect(written).toContain("raw-stderr")
      expect(written).toContain("warned text")
      expect(written).toContain("logged")
      expect(written).toContain("errored")
    } finally {
      sink.restore()
    }
    expect(process.stderr.write).toBe(originalStderrWrite)
    expect(console.log).toBe(originalConsoleLog)
    // A second restore is a no-op, never a double-wrap.
    sink.restore()
    expect(console.log).toBe(originalConsoleLog)
  })
})

describe("the descriptor rebind (POSIX)", () => {
  test("a GRANDCHILD's inherited stderr lands in the log, and zero bytes reach the parent's file", () => {
    /** The root the child's sink writes into. */
    const root = tempRoot()
    /** The child script, written as plain ESM (it imports the `.ts` sink through node's type stripping). */
    const script = join(root, "child.mjs")
    /** The absolute specifier of the sink under test. */
    const sinkUrl = new URL("./log-sink.ts", import.meta.url).href
    writeFileSync(
      script,
      [
        `import { spawnSync } from "node:child_process"`,
        `import { installTerminalSilence } from ${JSON.stringify(sinkUrl)}`,
        `const sink = installTerminalSilence("child", { roots: [process.argv[2]], rebindStderr: true })`,
        // The grandchild inherits fd 1 and fd 2 from this process — the descriptor the sink rebound.
        `spawnSync(process.execPath, ["-e", "process.stderr.write('GRANDCHILD-LINE\\\\n')"], { stdio: ["ignore", "inherit", "inherit"] })`,
        `process.stderr.write("direct-line\\n")`,
        // `console.log` is REPLACED by the sink (one of the five captured methods), so the report
        // must leave through `process.stdout.write`, the channel the sink never touches.
        `process.stdout.write("rebind=" + sink.stderrRebind() + "\\n")`,
      ].join("\n"),
    )
    /** The file the child's OWN stderr is captured to; it must stay empty. */
    const captured = join(root, "child.stderr")
    /** The capture file's descriptor, handed to the child as its stderr. */
    const fd = openSync(captured, "w")
    /** The child's result; stdout carries only its one report line. */
    const run = spawnSync(process.execPath, [script, root], { encoding: "utf8", stdio: ["ignore", "pipe", fd], timeout: 30_000 })
    closeSync(fd)
    expect(run.stdout).toContain("rebind=rebound")
    expect(readFileSync(captured, "utf8")).toBe("")
    /** The log the child's sink wrote, which must hold BOTH the grandchild's line and the direct one. */
    const log = readFileSync(join(root, ".mpd", "logs", "child.log"), "utf8")
    expect(log).toContain("GRANDCHILD-LINE")
    expect(log).toContain("direct-line")
  })
})
