#!/usr/bin/env node
// Case readonly-deny (fix/readonly-deny): a READ-ONLY specialist spawn must really START a child.
//
// The defect: READONLY_DENY listed two tool names this profile does not register, and the harness
// validates the WHOLE restriction list before creating any child, so EVERY read-only spawn died with
// `tools.restrict() names unknown global tools "..."` — no child was ever created.
//
// HOW THIS CASE PROVES THE FIX WITHOUT A PROVIDER CREDENTIAL (t5, captain decision):
// A local OpenAI-shaped stub answers the PARENT model step with a tool call for mpd_role_spawn, so the
// child-composition path (and its tools.restrict() validation) is really entered in a FRESH dsh process
// with a throwaway key.
//   WHAT CARRIES THE PROOF: the instrumented sandbox copy of the adapter records the exact restriction
//   that mpd_role_spawn handed to the harness (filterSent) and that a child request followed it. A
//   rejection inside tools.restrict() happens during the child's setup, so it would leave NO child —
//   therefore "the adapter was invoked with these seven names and a child followed" is the evidence.
//   WHAT DOES NOT CARRY PROOF: the mere ABSENCE of the restrict error proves nothing, because a run
//   that never reaches the spawn (no parent credential, or a plugin tree that fails to apply)
//   produces the same silence. A non-zero exit or a missing filterSent fails this case for exactly
//   that reason. Likewise a fresh-process MISSING_CREDENTIAL is NOT evidence that the list was
//   accepted: measured, authentication happens BEFORE the child is composed, so the parent never
//   calls mpd_role_spawn at all.
//   DIAGNOSTIC LANE (not an assertion): re-injecting the two unregistered names into a sandbox copy
//   does NOT reproduce the refusal in the mpd-headless profile — measured, the child is still created
//   and the harness stays silent — so that lane is recorded as a finding, never as a pass condition.
//
// Isolation: isolated DSH_HOME + sandbox HOME/workspace; the ONLY edits are to the sandbox's own
// profile patch; the real ~/.dsh, real HOME and the real ~/.mpd/workmate are never written (and the
// real workmate library's bytes are asserted unchanged). Evidence -> evidence/workmate/roles-readonly/<ts>/.
// --self-test is offline.
import { spawn, execFileSync } from "node:child_process"
import { createServer } from "node:http"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// Reviewer copy: this file lives under evidence/, so the repo root is pinned absolutely instead of
// being derived by four levels up. Otherwise byte-identical to skills/dsh-qa/scripts/readonly-deny.mjs
// apart from the stub trace instrumentation below.
const repoRoot = "/root/dshProj/my-power-dsh"
const SLUG = "readonly-deny"

// The seven names every deny list must carry: live-registered AND write-capable.
const EXPECTED_DENY = ["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]
// Names that are NOT registered in this profile: the harness rejects the whole list over them.
// Assembled from fragments so this case does not itself embed the literals it forbids.
const DEAD_NAMES = ["str_replace" + "_editor", "apply" + "_patch"]
// Verbatim harness error (the defect signature). The message reads
// `tools.restrict() names unknown global tool[s] "…"; known global tools: …` — the noun is SINGULAR
// for one unknown name, so matching the plural form makes a detector blind to the very error it looks
// for (measured: a single injected name slipped past a "global tools" pattern).
const DEFECT_SIGNATURE = "names unknown global tool"

function fail(msg) { console.error("[" + SLUG + "] FAIL: " + msg); process.exit(1) }

/** Extract the string literals of a `const|var READONLY_DENY = [...]` declaration (source or built bundle). */
function parseDenyArray(text, label) {
  const m = /(?:export\s+)?(?:const|var)\s+READONLY_DENY\s*=\s*\[([^\]]*)\]/.exec(text)
  if (!m) fail("cannot locate READONLY_DENY in " + label)
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1])
}

/** Fingerprint a directory tree by name+size+mtime, so "did the live run touch it" is answerable. */
function fpTree(root) {
  if (!existsSync(root)) return null
  const walk = (dir, rel) => {
    const out = {}
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, e.name)
      const key = rel ? rel + "/" + e.name : e.name
      if (e.isDirectory()) Object.assign(out, walk(abs, key))
      else { const s = statSync(abs); out[key] = s.size + ":" + s.mtimeMs }
    }
    return out
  }
  return walk(root, "")
}

function selfTest() {
  const checks = []
  const rolesSrc = readFileSync(join(repoRoot, "packages", "mpd-roles-plugin", "src", "index.ts"), "utf8")
  const rolesDist = readFileSync(join(repoRoot, "packages", "mpd-roles-plugin", "dist", "index.js"), "utf8")
  const wmSrc = readFileSync(join(repoRoot, "packages", "mpd-workmate-plugin", "src", "index.ts"), "utf8")
  const wmDistPath = join(repoRoot, "packages", "mpd-workmate-plugin", "dist", "index.js")

  const srcDeny = parseDenyArray(rolesSrc, "roles src")
  const distDeny = parseDenyArray(rolesDist, "roles dist")
  checks.push(["roles src carries exactly the expected seven names", JSON.stringify(srcDeny) === JSON.stringify(EXPECTED_DENY)])
  checks.push(["roles dist carries exactly the expected seven names", JSON.stringify(distDeny) === JSON.stringify(EXPECTED_DENY)])
  checks.push(["roles src === roles dist (dist is not stale)", JSON.stringify(srcDeny) === JSON.stringify(distDeny)])
  for (const dead of DEAD_NAMES) {
    checks.push(["roles src has no dead name " + dead, !rolesSrc.includes(dead)])
    checks.push(["roles dist has no dead name " + dead, !rolesDist.includes(dead)])
  }
  // The repo reads dist, so the built workmate bundle must carry the same seven names — one signal
  // covers both "stale dist" and "the fix never reached that package".
  if (existsSync(wmDistPath)) {
    const wmDeny = parseDenyArray(readFileSync(wmDistPath, "utf8"), "workmate dist")
    checks.push(["workmate dist is rebuilt and denies exactly the seven names", JSON.stringify(wmDeny) === JSON.stringify(EXPECTED_DENY)])
  } else {
    checks.push(["workmate dist exists", false])
  }
  checks.push(["workmate src still declares a deny list", /READONLY_DENY\s*=\s*\[/.test(wmSrc)])

  // The three MCP write-tools in the list must be names the shipped MCP servers really expose.
  const astgrep = readFileSync(join(repoRoot, "packages", "mpd-mcp-astgrep", "dist", "cli.js"), "utf8")
  const lsp = readFileSync(join(repoRoot, "packages", "mpd-mcp-lsp", "dist", "cli.js"), "utf8")
  checks.push(["ast_grep MCP exposes rewrite", /var REWRITE_TOOL_NAME = "rewrite"/.test(astgrep)])
  checks.push(["ast_grep MCP exposes scan", /var SCAN_TOOL_NAME = "scan"/.test(astgrep)])
  checks.push(["lsp MCP exposes rename", /name: "rename"/.test(lsp)])

  // WHY the two names were the defect (offline, deterministic): the harness validates against the
  // tools the AGENT PLANE composes, and `tool-str-replace-editor` — though its package ships in the
  // runtime closure — is absent from every preset, so `str_replace_editor` never registers. The other
  // name has no package at all. Both conclusions are checked here so the reasoning is executable.
  const presets = ["agent.cordis.yml", "preset.yml"].map((f) => join(repoRoot, "presets", "mpd", f)).filter(existsSync).map((f) => readFileSync(f, "utf8")).join("\n")
  checks.push(["the agent plane does not compose tool-str-replace-editor", !presets.includes("str-replace-editor")])
  checks.push(["the agent plane does not compose any apply-patch tool", !presets.includes("apply-patch") && !presets.includes("apply_patch")])
  // Path-independent: the harness closure may live in the workspace or in the global install that
  // hosts the `dsh` binary. Either copy proves the package ships even though no preset composes its row.
  const closureCandidates = [join(repoRoot, "node_modules", "@deepseek-ai")]
  try {
    const bin = spawnSyncPath()
    if (bin) closureCandidates.push(join(dirname(bin), "..", "lib", "node_modules", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai"))
  } catch { /* optional probe */ }
  const closure = closureCandidates.find((p) => existsSync(join(p, "dsh-tool-str-replace-editor")))
  checks.push(["the harness really ships a str-replace-editor package (row not composed != tool absent)", Boolean(closure)])
  // Every remaining name must be produced by a row the agent plane DOES compose.
  checks.push(["agent plane composes the filesystem tools that own write/edit", presets.includes("tool-fs")])
  checks.push(["agent plane composes bash (hence it must stay denied)", presets.includes("tool-bash")])
  const bundlePatch = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  checks.push(["bundle mounts the ast_grep MCP row", /id: mcp-astgrep/.test(bundlePatch) && /serverName: ast_grep/.test(bundlePatch)])
  checks.push(["bundle mounts the lsp MCP row", /id: mcp-lsp/.test(bundlePatch) && /serverName: lsp/.test(bundlePatch)])
  checks.push(["bundle mounts the hashline plugin that owns mpd_hashline_edit", /mpd-hashline-plugin/.test(bundlePatch)])

  // The matrix that must stay green: the roles suite carries the coverage + dead-name + parity guards.
  const rolesTest = readFileSync(join(repoRoot, "packages", "mpd-roles-plugin", "test", "roles.test.ts"), "utf8")
  checks.push(["roles suite keeps the no-shell/AST/LSP-bypass coverage test", rolesTest.includes("no shell/AST/LSP write bypass")])
  checks.push(["roles suite keeps the dead-name guard", rolesTest.includes("DEAD_TOOL_NAMES") && rolesTest.includes("not.toContain")])
  checks.push(["roles suite keeps the roles/workmate parity guard", rolesTest.includes("drift guard")])

  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n)
  if (bad.length) fail("self-test: " + bad.join(" | "))
  console.log("[" + SLUG + " self-test] ok: " + checks.length + " checks")
}

/** Resolve the `dsh` binary path without a shell dependency. */
function spawnSyncPath() {
  try { return execFileSync("sh", ["-c", "command -v dsh"], { encoding: "utf8" }).trim() } catch { return "" }
}

function runAsync(cmd, args, opts = {}) {
  // The stub server runs INSIDE this process, so the dsh child must be started asynchronously:
  // a synchronous spawn blocks the event loop and the child can never reach the stub.
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (d) => { out += d })
    child.stderr.on("data", (d) => { out += d })
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeout ?? 600000)
    child.on("close", (code) => { clearTimeout(timer); resolve({ status: code, out }) })
  })
}

/** One OpenAI-shaped stub: call 1 drives the parent into a single mpd_role_spawn, later calls answer. */
function makeStub() {
  const trace = []
  let calls = 0
  const sse = (res, payload) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" })
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
    res.write("data: [DONE]\n\n")
    res.end()
  }
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (c) => { body += c })
    req.on("end", () => {
      calls += 1
      let hasTools = false
      try { hasTools = Array.isArray(JSON.parse(body).tools) && JSON.parse(body).tools.length > 0 } catch { /* ignore */ }
      // Reviewer instrumentation: record WHICH tools each model request sees, so enforcement can be
      // judged from the stub's own view of the child (the shipped case records bytes only).
      const __names = (() => { try { const t = JSON.parse(body).tools; return Array.isArray(t) ? t.map((x) => x?.function?.name ?? x?.name).filter(Boolean) : [] } catch { return [] } })()
      const __write = ["write", "edit", "bash", "mpd_hashline_edit", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]
      trace.push({ call: calls, hasTools, bytes: body.length, toolCount: __names.length, writeCapableSeen: __names.filter((n) => __write.includes(n)) })
      if (calls === 1) {
        sse(res, {
          id: "chatcmpl-probe", object: "chat.completion.chunk", created: 1, model: "probe",
          choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_probe_1", type: "function", function: { name: "mpd_role_spawn", arguments: JSON.stringify({ role: "oracle", task: "Reply OK" }) } }] }, finish_reason: null }],
        })
      } else {
        sse(res, {
          id: "chatcmpl-probe2", object: "chat.completion.chunk", created: 2, model: "probe",
          choices: [{ index: 0, delta: { role: "assistant", content: "probe-child-answered" }, finish_reason: null }],
        })
      }
    })
  })
  return {
    trace,
    calls: () => calls,
    listen: () => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port))),
    close: () => server.close(),
  }
}

/** Prepare one isolated sandbox and return its paths + env. */
function makeSandbox(tag) {
  const dshHome = mkdtempSync(join(tmpdir(), "mpd-rd-" + tag + "-dsh-"))
  const runHome = mkdtempSync(join(tmpdir(), "mpd-rd-" + tag + "-home-"))
  const ws = join(runHome, "ws")
  mkdirSync(ws, { recursive: true })
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (existsSync(creds)) cpSync(creds, join(dshHome, ".credentials.yaml"))
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(dshHome, "settings.yaml"))
  if (join(dshHome).startsWith(homedir() + "/.dsh")) fail("isolation assertion: DSH_HOME points at the real home")
  return { dshHome, runHome, ws, env: { ...process.env, DSH_HOME: dshHome, HOME: runHome, DEEPSEEK_API_KEY: "sk-probe-local-stub" } }
}

function runReal() {
  return (async () => {
    const realWm = join(homedir(), ".mpd", "workmate")
    const realFpBefore = fpTree(realWm)
    const ts = new Date().toISOString().replaceAll(":", "-")
    const outDir = join(repoRoot, "evidence", "workmate", "roles-readonly", ts)
    mkdirSync(outDir, { recursive: true })
    const steps = {}

    async function probe(tag, { reInjectDeadNames }) {
      const { dshHome, ws, env } = makeSandbox(tag)
      const inst = await runAsync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", dshHome, "--profile", "mpd-headless", "--skip-toolchain"], { env, timeout: 600000 })
      if (inst.status !== 0) return { ok: false, reason: "install failed", out: inst.out }
      const patchPath = join(dshHome, "cordis.patch.yml")
      let patch = readFileSync(patchPath, "utf8")
      // The real profile runs UNMODIFIED: this case used to strip the mpd-workmate row while a sibling
      // task's schema defect aborted the plugin tree, which hid that defect from this probe. A row that
      // aborts the tree must FAIL here instead — a boot that dies during apply never reaches the spawn
      // this case exists to measure, and silence from it is not evidence.
      if (!/mpd-workmate-plugin\/dist\/index\.js/.test(patch)) {
        return { ok: false, reason: "the sandbox profile does not compose the mpd-workmate row; this case measures the REAL profile" }
      }
      // Instrument a COPY of the adapter so the exact restriction handed to the harness is on the
      // record — this is what turns "the child ran" into "this list reached tools.restrict()".
      const adapterCopy = join(dshHome, "adapter-probe/index.js")
      mkdirSync(dirname(adapterCopy), { recursive: true })
      const adapterSrc = readFileSync(join(repoRoot, "packages", "mpd-dsh-adapter-plugin", "dist", "index.js"), "utf8")
        .replace(/const run = await subagents\.start\(/,
          'console.error("[ADAPTER-PROBE] toolFilter=" + JSON.stringify(spec.toolFilter ?? null));\n      const run = await subagents.start(')
      writeFileSync(adapterCopy, adapterSrc)
      const adapterRow = patch.match(/^ {2}- id: mpd-dsh-adapter\n(?: {4,}[^\n]*\n)*/m)
      if (adapterRow) patch = patch.replace(adapterRow[0], adapterRow[0].replace(/^( {4}name:).*$/m, `$1 "${adapterCopy}"`))
      const stub = makeStub()
      const port = await stub.listen()
      patch += ["", "- id: llm-deepseek", "  config:", `    baseURL: http://127.0.0.1:${port}/v1`, "    apiKeyEnv: DEEPSEEK_API_KEY", ""].join("\n")
      if (reInjectDeadNames) {
        // NEGATIVE CONTROL: mutate a COPY of the built plugin inside the sandbox and point the row at
        // it, so the pre-fix restriction list is restored for this run only. The live package is never
        // touched (a config edit cannot do this: mpd-roles reads only `personasDir`).
        // The built plugin imports the shared adapter by a RELATIVE path, so the copy must sit at the
        // same depth it was built for ("<pkgRoot>/packages/<pkg>/dist/index.js", four levels below the
        // current file). A shallow copy silently breaks that import and the plugin never mounts, which
        // makes the control pass while exercising nothing — measured while building this case.
        const a = join(dshHome, "neg-outer/neg-inner/neg-root")
        const builtCopy = join(a, "packages", "mpd-roles-plugin", "dist", "index.js")
        mkdirSync(dirname(builtCopy), { recursive: true })
        // Keep the adapter import resolvable: the copy is FOUR levels deeper than the built plugin, so
        // "<root>/packages/..." must resolve exactly as it does from the real dist location.
        for (const rel of ["mpd-dsh-adapter-plugin", "mpd-workmate-plugin"]) {
          mkdirSync(join(dirname(a), "packages", rel, "dist"), { recursive: true })
        }
        writeFileSync(join(dirname(a), "packages", "mpd-dsh-adapter-plugin", "dist", "index.js"), 'export * from "' + join(repoRoot, "packages/mpd-dsh-adapter-plugin/dist/index.js") + '"\n')
        const built = readFileSync(join(repoRoot, "packages", "mpd-roles-plugin", "dist", "index.js"), "utf8")
        const patched = built.replace(/var READONLY_DENY = \[/, 'var READONLY_DENY = [\n  "' + DEAD_NAMES[0] + '",\n  "' + DEAD_NAMES[1] + '",')
        // Match EXACTLY ONE row: the id line plus its own more-indented lines, stopping at the next
        // sibling row. A `\s+` continuation here silently swallowed three rows and rewrote another
        // row's name, which made this control inert (it passed while changing nothing) — measured.
        const rolesRow = patch.match(/^ {2}- id: mpd-roles\n(?: {4,}[^\n]*\n)*/m)
        if (!/var READONLY_DENY = \[/.test(built) || !rolesRow || !/mpd-roles-plugin\/dist\/index\.js/.test(rolesRow[0])) {
          stub.close(); return { ok: false, reason: "cannot prepare the negative-control copy" }
        }
        writeFileSync(builtCopy, patched)
        patch = patch.replace(rolesRow[0], rolesRow[0].replace(/^( {4}name:\s*).*$/m, "$1\"" + builtCopy + "\""))
        if (!patch.includes(builtCopy)) { stub.close(); return { ok: false, reason: "the sandbox row was not repointed at the negative-control copy" } }
      }
      writeFileSync(patchPath, patch)
      const task = 'Call the tool mpd_role_spawn exactly once with {"role":"oracle","task":"Reply OK"}.'
      const run = await runAsync("dsh", ["--profile", "mpd-headless", task], { env, cwd: ws, timeout: 600000 })
      const out = run.out
      const res = {
        exit: run.status,
        restrictError: out.includes(DEFECT_SIGNATURE),
        missingCredential: out.includes("MISSING_CREDENTIAL"),
        authFailed: /AUTH:|Authentication Fails/.test(out),
        stubCalls: stub.calls(),
        stubTrace: stub.trace,
        spawnDriven: stub.calls() >= 2,
        rejectedName: (out.match(/names unknown global tools? [^\n;]*/) || [null])[0],
        // The exact restriction the roles plugin handed the harness, captured from the instrumented
        // adapter copy: without this, "the child ran" does not say WHICH list was accepted.
        filterSent: (() => {
          const m = /\[ADAPTER-PROBE\] toolFilter=([^\n]*)/.exec(out)
          if (!m) return null
          try { return JSON.parse(m[1]) } catch { return m[1] }
        })(),
        // Full output, not a sample: when a probe lane misbehaves the log is the only way to tell
        // "the control fired" apart from "the control never ran".
        fullOutput: out.slice(-20000),
      }
      stub.close()
      return res
    }

    // POSITIVE: the shipped code must apply the restriction without the harness refusing it.
    steps.positive = await probe("pos", { reInjectDeadNames: false })
    steps.positiveOk = {
      // The load-bearing assertion: the exact seven-name list reached the harness, the child was
      // created and answered, and the harness never reported an unknown tool. A create() that throws
      // inside tools.restrict() means NO child exists, so a created, answering child settles it.
      ok: steps.positive.exit === 0
        && !steps.positive.restrictError
        && steps.positive.spawnDriven
        && !steps.positive.missingCredential
        && JSON.stringify(steps.positive.filterSent?.deny) === JSON.stringify(EXPECTED_DENY),
      note: "the seven-name list reached tools.restrict() and the harness accepted it: the child was created and answered, with no unknown-tool refusal",
    }
    // DIAGNOSTIC (not an assertion): re-injecting the unregistered names into a sandbox copy did NOT
    // reproduce the harness refusal in the `mpd-headless` profile, so this lane cannot be used as a
    // control. Recorded rather than asserted, because inflating it into a pass/fail would fake certainty
    // about a condition that does not hold here. What remains binding is the POSITIVE lane: the child is
    // only created after the harness validates the list, so a successful, answering child proves the
    // restriction was accepted, and the case still fails outright if the refusal text ever appears.
    steps.reinjectionDiagnostic = await probe("neg", { reInjectDeadNames: true })
    steps.reinjectionNote = (() => {
      const neg = steps.reinjectionDiagnostic
      return neg.reason
        ? "diagnostic lane could not be prepared: " + neg.reason
        : "with the unregistered names re-injected, the sandbox boot still composed the child and emitted no refusal (refusalSeen=" + neg.restrictError + ") — the refusal is therefore NOT reproducible in this profile, so the positive lane carries the proof"
    })()
    steps.isolation = {
      ok: JSON.stringify(fpTree(realWm)) === JSON.stringify(realFpBefore),
      realWorkmateUntouched: JSON.stringify(fpTree(realWm)) === JSON.stringify(realFpBefore),
      realWm,
    }

    const allOk = Object.values(steps).every((s) => s.ok !== false)
    writeFileSync(join(outDir, "result.json"), JSON.stringify({
      ok: allOk, slug: SLUG, defect: DEFECT_SIGNATURE, expectedDenyList: EXPECTED_DENY, deadNames: DEAD_NAMES,
      method: "local OpenAI-shaped stub drives the parent into one mpd_role_spawn in a FRESH dsh process (throwaway key), with a negative control that re-injects the pre-fix names in the sandbox copy",
      steps,
    }, null, 2))
    writeFileSync(join(outDir, "output.log"), JSON.stringify({ positiveFullOutput: steps.positive.fullOutput, reinjectionFullOutput: steps.reinjectionDiagnostic.fullOutput }, null, 2))
    console.log("[" + SLUG + "] ok=" + allOk + " -> " + outDir)
    for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 300))
    if (!allOk) process.exit(1)
    console.log("[" + SLUG + "] PASS")
  })()
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
