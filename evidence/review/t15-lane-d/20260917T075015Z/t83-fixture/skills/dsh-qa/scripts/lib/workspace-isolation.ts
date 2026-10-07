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
//   import { sandboxWorkspace, assertSessionsSandboxed } from "./lib/workspace-isolation.mjs"
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

// .../skills/dsh-qa/scripts/lib/workspace-isolation.mjs -> the repository root.
export const REPO_ROOT = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))))

/**
 * The session-store project-key encoding, ported verbatim from the installed
 * harness (`@deepseek-ai/dsh-session-persistence-jsonl` `projectKey`): separator
 * runs collapse to one `-`, `~` and non-`[A-Za-z0-9._-]` become `~XXXX` escapes,
 * leading `-` runs are stripped, and the whole key is wrapped `--…--`.
 */
export function projectKey(cwd) {
  if (cwd.length === 0) throw new Error("cannot encode an empty project path")
  let readable = ""
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
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

/** Create (once) the sandbox workspace a QA dsh boot and its sessions must live in. */
export function sandboxWorkspace(sandbox, name = "ws") {
  const ws = join(sandbox, name)
  mkdirSync(ws, { recursive: true })
  return ws
}

/**
 * Fail unless every session-store key under `<dshHome>/sessions` belongs to a
 * workspace under `sandboxRoot`. `forbidden` defaults to the real repository (this
 * checkout), the invoking process cwd and the real home — the keys a leaking QA
 * case produces.
 */
export function assertSessionsSandboxed(dshHome, sandboxRoot, { label = "qa-case", forbidden } = {}) {
  const sessionsRoot = join(dshHome, "sessions")
  const keys = existsSync(sessionsRoot) ? readdirSync(sessionsRoot) : []
  const allowedPrefix = projectKey(sandboxRoot).replace(/--$/, "")
  const blocked = new Set(forbidden ?? [projectKey(REPO_ROOT), projectKey(process.cwd()), projectKey(homedir())])
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
  const fail = (msg) => { console.error("[workspace-isolation self-test] FAIL: " + msg); process.exit(1) }
  if (projectKey(REPO_ROOT) !== "--" + REPO_ROOT.replace(/^\/+/, "").replaceAll("/", "-") + "--") fail("projectKey(REPO_ROOT) = " + projectKey(REPO_ROOT))
  if (projectKey("/") !== "--root--") fail("projectKey('/') = " + projectKey("/"))
  const dshHome = mkdtempSync(join(tmpdir(), "mpd-iso-selftest-"))
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-iso-selftest-sb-"))
  try {
    const empty = assertSessionsSandboxed(dshHome, sandbox, { label: "selftest-empty" })
    if (empty.checked !== 0) fail("unexpected session keys in a fresh home: " + empty.keys.join(","))
    mkdirSync(join(dshHome, "sessions", projectKey(REPO_ROOT), "session-x"), { recursive: true })
    let threw = false
    try { assertSessionsSandboxed(dshHome, sandbox, { label: "selftest-repo-key" }) } catch { threw = true }
    if (!threw) fail("assertion accepted a repo-keyed session store")
    rmSync(join(dshHome, "sessions", projectKey(REPO_ROOT)), { recursive: true, force: true })
    mkdirSync(join(dshHome, "sessions", projectKey(join(sandbox, "ws")), "session-y"), { recursive: true })
    const ok = assertSessionsSandboxed(dshHome, sandbox, { label: "selftest-sandbox-key" })
    if (ok.checked !== 1) fail("sandbox-keyed store not accepted")
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
    rmSync(sandbox, { recursive: true, force: true })
  }
  console.log("[workspace-isolation self-test] ok: projectKey vectors + repo-key rejection + sandbox-key acceptance verified")
}
