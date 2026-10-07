import { test, expect } from "bun:test"
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

test.skipIf(SKIP)("binary resolves from toolchain", () => {
  expect(BINARY).toBeTruthy()
})

test.skipIf(SKIP)("comment file triggers detection (exit 2)", () => {
  /** The detector's verdict for a file whose only content is a line comment. */
  const res = runCheck(BINARY!, hookInputFor("/tmp/a.js", "// hello comment\nlet x = 1\n"), 30000)
  expect(res.hasComments).toBe(true)
  expect(res.message).toContain("COMMENT/DOCSTRING DETECTED")
})

test.skipIf(SKIP)("clean file passes (exit 0)", () => {
  /** The detector's verdict for a file with no comments at all. */
  const res = runCheck(BINARY!, hookInputFor("/tmp/b.js", "let x = 1\nconst y = 2\n"), 30000)
  expect(res.hasComments).toBe(false)
})

// ── E8: the autoCheck hook resolves the edited path against the SESSION workspace ─────────────────
// The hook did `readFileSync(fp, "utf8")` on the path exactly as the model wrote it — usually
// RELATIVE — inside a `try` that returned the decision untouched on failure. So a relative path was
// probed against the dsh process cwd and an honest miss was a SILENT skip. These arms need no real
// detector: an explicit `binary` is first in the resolution order, and a stub that echoes its stdin
// payload and exits 2 (the detector's "comments found" status) proves WHICH file the hook read.
test("autoCheck: the hook resolves a relative file_path against the session workspace", async () => {
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
