// QA workspace isolation helper (wave-2 defect: `DSH_HOME=<mktemp>` + sandbox `HOME`
// isolate the harness home but NOT workspace-scoped state).
//
// Every workspace root the bundle writes resolves from the SESSION workspace:
// `agent.session.header.cwd ?? process.cwd()` in the adopted agent-teams plugin and
// `dsh.workspaceRoot(exec)` (session header cwd → DSH_WORKSPACE_ROOT → cwd) in ours.
// A session-scoped cwd outranks the process-wide `DSH_WORKSPACE_ROOT`, so the env
// cannot isolate a QA boot — only an explicit sandbox cwd on the dsh spawn (and on
// every `session/create` payload) can. Without it, a stepped QA session writes real
// `<repo>/.mpd/team/mpd-default-*` records, which the `mpd_workmate_rename/delete`
// in-use gate then scans (AGENTS.md §12).
//
// Usage in a live case:
//   import { sandboxWorkspace, assertSessionsSandboxed } from "./lib/workspace-isolation.ts"
//   const ws = sandboxWorkspace(sandbox)              // mkdtemp dir/ws, pass as spawn cwd
//   spawn("dsh", args, { env, cwd: ws, ... })
//   assertSessionsSandboxed(sandbox, sandbox)         // <DSH_HOME>, allowed workspace root
//
// `assertSessionsSandboxed` is the falsifiable, concurrency-safe assertion: it reads
// the harness's own session store layout `<DSH_HOME>/sessions/<projectKey(cwd)>/<id>/`
// and fails if any key escapes the sandbox (e.g. `--root-dshProj-my-power-dsh--`).
// It never inspects session contents (no zstd decompression, no mtime races), so a
// concurrent real session elsewhere cannot make it flake.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// .../skills/dsh-qa/scripts/lib/workspace-isolation.ts -> the repository root.
export const REPO_ROOT: string = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))))

/**
 * Optional knobs of `assertSessionsSandboxed`.
 */
export interface SessionSandboxAssertOptions {
  /** Label printed in the failure banner, so a multi-assertion case names the failing arm. */
  readonly label?: string
  /** Extra encoded keys that must never appear, appended to the three defaults. */
  readonly forbidden?: readonly string[]
}

/**
 * The verdict of a passing isolation assertion.
 */
export interface SessionSandboxVerdict {
  /** Always `true`: the function throws instead of returning a failure. */
  readonly ok: true
  /** How many session-store keys the check inspected. */
  readonly checked: number
  /** The inspected keys, so a caller can record what it actually looked at. */
  readonly keys: string[]
}

/**
 * The session-store project-key encoding, ported verbatim from the installed
 * harness (`@deepseek-ai/dsh-session-persistence-jsonl` `projectKey`): separator
 * runs collapse to one `-`, `~` and non-`[A-Za-z0-9._-]` become `~XXXX` escapes,
 * leading `-` runs are stripped, and the whole key is wrapped `--…--`.
 * @param cwd The workspace path to encode (never empty).
 * @returns The harness's own session-store directory key for that path.
 */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error("cannot encode an empty project path")
  // The readable form built so far, before the leading-dash strip and the wrapper.
  let readable = ""
  // Whether the previous character was a path separator, so a separator RUN emits one dash.
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    // The code point of the current character, which the escape form prints in hex.
    const code = cwd.charCodeAt(i)
    // The current character itself, so the plain-alphabet branch can test it directly.
    const ch = String.fromCharCode(code)
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-"
      separatorRun = true
    } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += "~" + code.toString(16).toUpperCase().padStart(4, "0")
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`
}

/**
 * Create (once) the sandbox workspace a QA dsh boot and its sessions must live in.
 * @param sandbox The sandbox root directory (already created by the caller).
 * @param name Subdirectory name of the workspace inside the sandbox.
 * @returns The absolute sandbox workspace path to pass as the spawn cwd.
 */
export function sandboxWorkspace(sandbox: string, name: string = "ws"): string {
  // The workspace directory the session store must be keyed by.
  const ws = join(sandbox, name)
  mkdirSync(ws, { recursive: true })
  return ws
}

/**
 * Fail unless every session-store key under `<dshHome>/sessions` belongs to a
 * workspace under `sandboxRoot`. `forbidden` defaults to the real repository (this
 * checkout), the invoking process cwd and the real home — the keys a leaking QA
 * case produces.
 * @param dshHome The sandbox `DSH_HOME` whose session store is inspected.
 * @param sandboxRoot The only workspace root whose key may appear.
 * @param options Optional label and extra forbidden keys.
 * @returns The verdict, carrying the inspected keys and their count.
 * @throws When any inspected key escapes the sandbox.
 */
export function assertSessionsSandboxed(dshHome: string, sandboxRoot: string, { label = "qa-case", forbidden }: SessionSandboxAssertOptions = {}): SessionSandboxVerdict {
  // The `<DSH_HOME>/sessions` root, absent until a boot writes its first store.
  const sessionsRoot = join(dshHome, "sessions")
  // The project keys actually present, empty when no boot wrote a store at all.
  const keys = existsSync(sessionsRoot) ? readdirSync(sessionsRoot) : []
  // The allowed key with its trailing wrapper dashes stripped, so descendants still match.
  const allowedPrefix = projectKey(sandboxRoot).replace(/--$/, "")
  // The encoded keys that must never appear, even under the allowed prefix.
  const blocked = new Set<string>(forbidden ?? [projectKey(REPO_ROOT), projectKey(process.cwd()), projectKey(homedir())])
  // The keys that are neither under the allowed prefix nor outside the blocked set.
  const offenders = keys.filter((key) => !key.startsWith(allowedPrefix) || blocked.has(key))
  if (offenders.length > 0) {
    console.error("[workspace-isolation] FAIL (" + label + "): " + offenders.length + " session-store key(s) escaped the sandbox")
    for (const key of offenders) console.error("  - " + key)
    console.error("  dshHome=" + dshHome + " allowed key prefix=" + allowedPrefix)
    throw new Error("workspace isolation violated: " + offenders.join(", "))
  }
  return { ok: true, checked: keys.length, keys }
}

// Standalone --self-test (offline): the encoding must reproduce the harness's own
// session-store key for THIS checkout, the assertion must FAIL on a repo-keyed store
// and PASS on a sandbox-keyed one. Guarded on being the entry module so the QA cases
// that import this helper never trigger it through their own --self-test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--self-test")) {
  /** Report one failed self-test assertion and end the run with exit 1. */
  const fail = (msg: string): void => { console.error("[workspace-isolation self-test] FAIL: " + msg); process.exit(1) }
  if (projectKey(REPO_ROOT) !== "--" + REPO_ROOT.replace(/^\/+/, "").replaceAll("/", "-") + "--") fail("projectKey(REPO_ROOT) = " + projectKey(REPO_ROOT))
  if (projectKey("/") !== "--root--") fail("projectKey('/') = " + projectKey("/"))
  // The fake `DSH_HOME` whose store the negative and positive controls write into.
  const dshHome = mkdtempSync(join(tmpdir(), "mpd-iso-selftest-"))
  // The allowed sandbox root the positive control keys its store by.
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-iso-selftest-sb-"))
  try {
    // Positive control 0: a fresh home has no keys at all.
    const empty = assertSessionsSandboxed(dshHome, sandbox, { label: "selftest-empty" })
    if (empty.checked !== 0) fail("unexpected session keys in a fresh home: " + empty.keys.join(","))
    mkdirSync(join(dshHome, "sessions", projectKey(REPO_ROOT), "session-x"), { recursive: true })
    // Negative control: a repo-keyed store must be rejected, not accepted silently.
    let threw = false
    try { assertSessionsSandboxed(dshHome, sandbox, { label: "selftest-repo-key" }) } catch { threw = true }
    if (!threw) fail("assertion accepted a repo-keyed session store")
    rmSync(join(dshHome, "sessions", projectKey(REPO_ROOT)), { recursive: true, force: true })
    mkdirSync(join(dshHome, "sessions", projectKey(join(sandbox, "ws")), "session-y"), { recursive: true })
    // Positive control: a sandbox-keyed store must be accepted.
    const ok = assertSessionsSandboxed(dshHome, sandbox, { label: "selftest-sandbox-key" })
    if (ok.checked !== 1) fail("sandbox-keyed store not accepted")
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
    rmSync(sandbox, { recursive: true, force: true })
  }
  console.log("[workspace-isolation self-test] ok: projectKey vectors + repo-key rejection + sandbox-key acceptance verified")
}
