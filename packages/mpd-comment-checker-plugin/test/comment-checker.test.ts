import { describe, test, expect } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { resolveBinary, hookInputFor, runCheck, apply } from "../src/index.ts"
import type { DshPostDecision, DshPostResult, DshTextBlock, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/**
 * The detector binary this checkout resolves; null when it is not installed here.
 * Every arm below is skipped unless SKIP is false, which is exactly the case in which this is a
 * path — so the call sites read it with a non-null assertion rather than adding a runtime guard.
 */
const BINARY: string | null = resolveBinary({})
/** Whether the suite must skip: the detector is a ~51MB optionalDependency, absent in a bare checkout. */
const SKIP = !BINARY || !existsSync(BINARY)
/**
 * The documented reason the three detector arms below skip, carried INTO their titles.
 *
 * A skip is a fact a reader must be able to interpret: bun prints the skipped title and nothing else,
 * so a bare `(skip) clean file passes` left the reader unable to tell "not installed here" from "the
 * product is broken". Naming the missing instrument is what makes the gap legible instead of silent.
 */
const SKIP_REASON = "skipped: detector binary absent — run the installer with --with-comment-checker or set MPD_DSH_COMMENT_CHECKER_BIN"

test.skipIf(SKIP)(`binary resolves from toolchain (${SKIP_REASON})`, () => {
  expect(BINARY).toBeTruthy()
})

test.skipIf(SKIP)(`comment file triggers detection (exit 2) (${SKIP_REASON})`, () => {
  /** The detector's verdict for a file whose only content is a line comment. */
  const res = runCheck(BINARY!, hookInputFor(join(tmpdir(), "a.js"), "// hello comment\nlet x = 1\n"), 30000)
  expect(res.hasComments).toBe(true)
  expect(res.message).toContain("COMMENT/DOCSTRING DETECTED")
})

test.skipIf(SKIP)(`clean file passes (exit 0) (${SKIP_REASON})`, () => {
  /** The detector's verdict for a file with no comments at all. */
  const res = runCheck(BINARY!, hookInputFor(join(tmpdir(), "b.js"), "let x = 1\nconst y = 2\n"), 30000)
  expect(res.hasComments).toBe(false)
})

// ── the contract that needs NO detector binary ────────────────────────────────────────────────────
// The three arms above prove the plugin against the REAL detector and therefore vanish in a bare
// checkout, which left this package's core contract (what payload the detector is handed, which
// binary is chosen, and what an exit status MEANS) untested wherever the 51MB dependency is absent.
// These arms pin those three without it: two are pure, and the third drives a 3-line shell stub.
describe("the core contract, proved without the detector binary", () => {
  test("the payload is the detector's PostToolUse contract (pure: no process involved)", () => {
    /** The payload the row builds for one edited file. */
    const payload = hookInputFor("/ws/a.js", "let x = 1\n", "/ws")
    expect(payload.hook_event_name).toBe("PostToolUse")
    expect(payload.tool_name).toBe("Write")
    // The session workspace travels as `cwd`; it is metadata for the binary, never a read path.
    expect(payload.cwd).toBe("/ws")
    // The two fields the detector actually reads: WHICH file and its NEW content.
    expect(payload.tool_input).toEqual({ file_path: "/ws/a.js", content: "let x = 1\n" })
  })

  test("an explicit config.binary WINS, and a path that is not on disk changes nothing", () => {
    /** The temp directory holding this arm's stand-in binary. */
    const dir = mkdtempSync(join(tmpdir(), "mpd-cc-pick-"))
    /** A file that EXISTS: `resolveBinary` validates existence, it does not run the candidate. */
    const explicit = join(dir, "detector")
    writeFileSync(explicit, "#!/bin/sh\nexit 0\n")
    chmodSync(explicit, 0o755)
    expect(resolveBinary({ binary: explicit })).toBe(explicit)
    // A declared-but-absent override is not a candidate at all: resolution falls through to the
    // SAME answer an unconfigured call gets, rather than to the missing path.
    expect(resolveBinary({ binary: join(dir, "absent") })).toBe(resolveBinary({}))
  })

  // A POSIX SHELL STUB CANNOT BE SPAWNED ON WIN32 — the same declared bound the autoCheck arm states:
  // the row executes the resolved binary DIRECTLY (no shell), and win32 has no shebang mechanism.
  test.skipIf(process.platform === "win32")("the exit-code → verdict mapping (a stub process, not the detector)", () => {
    /** The temp directory holding this arm's exit-status stubs. */
    const dir = mkdtempSync(join(tmpdir(), "mpd-cc-verdict-"))
    /**
     * Write one stub that prints a status-named marker on stderr and exits with `status`.
     * @param status - the exit status the stub reports.
     * @returns the stub's path.
     */
    const stub = (status: number): string => {
      /** This status's stub file. */
      const path = join(dir, `stub-${status}.sh`)
      writeFileSync(path, `#!/bin/sh\ncat > /dev/null\nprintf 'MARKER-%s\\n' "${status}" >&2\nexit ${status}\n`)
      chmodSync(path, 0o755)
      return path
    }
    /** The payload every stub is fed, unread by them (they only echo the status). */
    const input = hookInputFor("/ws/a.js", "// c\n")
    // exit 0 = clean, and the success path carries NO message.
    expect(runCheck(stub(0), input, 30000)).toEqual({ hasComments: false, message: "" })
    // exit 2 = comments found, and the binary's own text is what the caller renders.
    /** The exit-2 verdict. */
    const found = runCheck(stub(2), input, 30000)
    expect(found.hasComments).toBe(true)
    expect(found.message).toContain("MARKER-2")
    // ANY OTHER status is NOT a silent clean: it reads as an unexpected exit, message included.
    /** The exit-7 verdict, the branch that once had no test at all. */
    const odd = runCheck(stub(7), input, 30000)
    expect(odd.hasComments).toBe(false)
    expect(odd.message).toContain("unexpected exit 7")
    expect(odd.message).toContain("MARKER-7")
  })
})

// ── E8: the autoCheck hook resolves the edited path against the SESSION workspace ─────────────────
// The hook did `readFileSync(fp, "utf8")` on the path exactly as the model wrote it — usually
// RELATIVE — inside a `try` that returned the decision untouched on failure. So a relative path was
// probed against the dsh process cwd and an honest miss was a SILENT skip. These arms need no real
// detector: an explicit `binary` is first in the resolution order, and a stub that echoes its stdin
// payload and exits 2 (the detector's "comments found" status) proves WHICH file the hook read.
// A POSIX SHELL STUB CANNOT BE SPAWNED ON WIN32 (declared instrument bound, MEASURED 2026-10-12). The
// row executes the resolved `binary` DIRECTLY — `spawnSync(binary, ["check"], …)`, no shell — and win32
// has no shebang mechanism, so `fake-detector.sh` fails with `Executable not found in $PATH` before the
// hook can run (`spawn failed: … fake-detector.sh`). The two other stub shapes are equally unusable:
// node >= 18.20 REFUSES to spawn a `.cmd`/`.bat` without `shell: true` (the CVE-2024-27980 guard), and
// the bundle ships no native Windows stub. The arm's SUBJECT — a relative `file_path` resolved against
// the SESSION workspace instead of process.cwd() — is platform-independent code, but its INSTRUMENT is
// not, so win32 declares the bound here rather than asserting a mechanism it cannot build. The subject
// stays covered on POSIX, where the stub is spawnable.
test.skipIf(process.platform === "win32")("autoCheck: the hook resolves a relative file_path against the session workspace", async () => {
  /** One `tools/post-execute` listener as the adapter registers and calls it. */
  type PostExecuteListener = (exec: DshToolExec, result: DshPostResult, next: () => Promise<DshPostDecision>) => Promise<DshPostDecision>
  /** Captured `tools/post-execute` listeners, in registration order. */
  const listeners: PostExecuteListener[] = []
  /** The session workspace the hook must resolve against; unrelated to the process cwd. */
  const ws = mkdtempSync(join(tmpdir(), "mpd-cc-ws-"))
  /** The edited file inside that workspace, carrying a marker the stub echoes back. */
  writeFileSync(join(ws, "notes.js"), "// session-file-marker\nlet x = 1\n")
  /** Directory holding the stub detector. */
  const stubDir = mkdtempSync(join(tmpdir(), "mpd-cc-stub-"))
  /** The stub detector: echoes the JSON payload it received on stderr, then exits 2. */
  const stub = join(stubDir, "fake-detector.sh")
  writeFileSync(stub, "#!/bin/sh\npayload=$(cat)\nprintf '%s' \"$payload\" >&2\nexit 2\n")
  chmodSync(stub, 0o755)
  /** Minimal host ctx: no config service, so the row config stays authoritative. */
  const ctx: Parameters<typeof apply>[0] = {
    tools: { register: (): void => {} },
    get: (): undefined => undefined,
    // The post-execute hook registers through this seam; capturing the listener keeps apply() pure
    // while letting the arm drive the hook exactly as the harness waterfall does.
    on: (event: string, listener: PostExecuteListener): void => { if (event === "tools/post-execute") listeners.push(listener) },
  }
  apply(ctx, { autoCheck: true, binary: stub })
  // The single hook `autoCheck: true` registers.
  const hook = listeners[0]
  /** The decision the harness accepted before the hook ran; the hook only ever appends text to it. */
  const accept = async (): Promise<DshPostDecision> => ({ kind: "accept" })
  /** The text a driven hook appended, or "" when it let the decision through untouched. */
  const appended = (out: DshPostDecision): string => ((out.content as DshTextBlock[] | undefined)?.[0]?.text) ?? ""

  // Arm 1: a RELATIVE path inside the session workspace. The stub's echo proves the hook read the
  // session's file; had it probed process.cwd() it would have found nothing and skipped in silence.
  const hit = await hook({ name: "write", arguments: { file_path: "notes.js" }, agent: { session: { header: { cwd: ws } } } }, {}, accept)
  expect(appended(hit)).toContain("[mpd-comment-checker] comments/docstrings detected")
  expect(appended(hit)).toContain("session-file-marker")

  // Arm 2: a relative path the session workspace does not hold is a DECLARED miss, not a silent
  // skip — the appended note names the path that could not be read.
  const miss = await hook({ name: "write", arguments: { file_path: "absent.js" }, agent: { session: { header: { cwd: ws } } } }, {}, accept)
  expect(appended(miss)).toContain("[mpd-comment-checker] auto-check skipped")
  expect(appended(miss)).toContain(join(ws, "absent.js"))
})
