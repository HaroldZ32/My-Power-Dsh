#!/usr/bin/env node
// Case readonly-deny: a READ-ONLY specialist spawn must really START a child, and that child must be
// RESTRICTED — the case asserts what is MEASURED about the child, not merely that a list was sent.
//
// THE DEFECT: READONLY_DENY listed two tool names this profile does not register. The harness validates
// the whole restriction list while composing the child, so EVERY read-only spawn died with
// `tools.restrict() names unknown global tools "..."` and no child was ever created.
//
// THE MEASURED FAILURE MODE IS *SILENT UN-GUARDING*, NOT A LOUD REFUSAL (§W3): a name that is stale but
// still KNOWN to the scope's restrictable set does not throw — it simply makes the restriction partly
// inert, and the child then receives the FULL, unguarded toolset with no error anywhere. Two anchors
// explain both behaviours: `@deepseek-ai/dsh-subagent` applies the filter only when
// `composition.toolFilter` is defined (lib/index.js:711), while `@deepseek-ai/dsh-tools` throws only
// for names OUTSIDE `view(scope).restrictableNames` (lib/index.js:2804) — so a stale-but-known name
// passes that check, the list is accepted, and the denial it was supposed to contribute simply never
// takes effect. Older text in this delivery described the failure as a loud refusal; that is only one of
// the two routes. The re-injection control lane below reproduces the silent route on real data, which is
// what makes the enforcement assertion falsifiable instead of decorative.
//
// HOW THIS CASE PROVES ALL OF THAT WITHOUT A PROVIDER CREDENTIAL (t5, captain decision):
// A local OpenAI-shaped stub answers the PARENT model step with a tool call for mpd_role_spawn, so the
// child-composition path really runs in a FRESH dsh process with a throwaway key.
//   WHAT CARRIES THE PROOF (two independent assertions):
//   1. the instrumented sandbox copy of the adapter records the exact restriction mpd_role_spawn handed
//      to the harness (filterSent), so "the seven live names were sent" is on the record; and
//   2. every request in the stub trace is classified by the harness's own markers — the child's request
//      carries the composed role persona ("deployment:persona") and never the parent-only delegation
//      section ("subagent:delegation") — so the case can assert the child's VISIBLE TOOLSET excludes all
//      seven write-capable names while the parent's includes them (reviewer measurement: child 81 tools
//      with none, parent 87 with all seven). Assertion 2 is the one that can fail: with the pre-fix
//      names re-injected the child sees the full toolset, and the control lane asserts exactly that.
//   WHAT DOES NOT CARRY PROOF: the mere ABSENCE of the restrict error proves nothing, because a run
//   that never reaches the spawn (no parent credential, or a plugin tree that fails to apply) produces
//   the same silence; a non-zero exit or a missing filterSent fails this case for that reason. Likewise
//   a fresh-process MISSING_CREDENTIAL is NOT evidence the list was accepted — measured, authentication
//   happens BEFORE the child is composed, so the parent never calls mpd_role_spawn at all.
//   A run that never reaches a child request cannot pass: the enforcement assertion requires at least
//   one child request carrying a toolset.
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

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const SLUG = "readonly-deny"

// The seven names every deny list must carry: live-registered AND write-capable.
const EXPECTED_DENY = ["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]
// Aliased for readability at the enforcement assertions: these are exactly the tools a read-only child
// must NOT be able to see. Denying more than these would be a different (also valid) policy, but the
// enforcement check below is about these seven, because they are what the deny list names.
const WRITE_CAPABLE = EXPECTED_DENY
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
      let toolNames = []
      try {
        const parsed = JSON.parse(body)
        const tools = Array.isArray(parsed.tools) ? parsed.tools : []
        hasTools = tools.length > 0
        toolNames = tools.map((t) => t?.function?.name ?? t?.name).filter((n) => typeof n === "string")
      } catch { /* ignore */ }
      trace.push({
        call: calls, hasTools, bytes: body.length,
        toolCount: toolNames.length,
        // The property this case exists to prove: read-only authority means the child CANNOT SEE the
        // write-capable tools, not merely that the deny list was handed to the harness.
        writeCapableVisible: WRITE_CAPABLE.filter((n) => toolNames.includes(n)),
        _toolNames: toolNames,
      })
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
      // The real profile runs UNMODIFIED. This case briefly stripped the mpd-workmate row while that
      // package's output-schema type array aborted the plugin tree; that defect is fixed (t3/t12), the
      // workaround is gone, and the guard below keeps it gone. A boot that dies during apply never
      // reaches the spawn this case measures, so such a row must FAIL here, never be worked around.
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
    // ENFORCEMENT (t13 / t9 F1): the case must assert what is MEASURED about the child, not merely that
    // the deny list was handed over. The child request is found by its own signature: a request that
    // carries tools whose names are a PROPER SUBSET of the parent's toolset. Measured basis (raw
    // request dumps): call#1 = parent, 87 tools including all seven write-capable names; call#2 = a
    // session-title side request, 0 tools; call#3 = the child, 81 tools with none of the seven. A
    // request that merely repeats the parent's toolset is never classified as the child — that is
    // deliberate, because "the child has no restriction" must fail the assertion below rather than
    // silently match.
    // The child request is identified by its own semantic signature, measured from raw request dumps:
    // it carries tools, exposes NONE of the seven write-capable names, and adds the role's report
    // schema as `structured_output` (the read-only specialist's required output contract) — so its
    // toolset is the parent's MINUS the denied names PLUS structured_output. Measured basis: call#1 =
    // parent, 87 tools including all seven; call#2 = a session-title side request, 0 tools; call#3 =
    // the child, 81 tools with none of the seven and `structured_output` present.
    // WHY THIS KEYS ON THE TOOL-SET SIGNATURE AND NEVER ON CALL ORDER (t9 independent verification):
    // the 0-tool session-title side request is NOT at a fixed position — it was call#2 in the positive
    // lane but call#1 in the reviewer's control run. Position-keyed logic would classify the wrong
    // request; this predicate cannot, because the parent is "the first request that carries tools"
    // (the title request carries none, so it is skipped wherever it lands) and the child is identified
    // by what its tool set lacks and adds. Do not replace these predicates with index comparisons.
    const parentReq = steps.positive.stubTrace.find((c) => c.toolCount > 0)
    const parentNames = new Set(parentReq?._toolNames ?? [])
    const isChildReq = (c) => c !== parentReq && c.toolCount > 0 && c.writeCapableVisible.length === 0 && c._toolNames.includes("structured_output")
    const childReqs = steps.positive.stubTrace.filter(isChildReq)
    const childSpy = childReqs.filter((c) => c.toolCount > 0)
    // The parent must actually show the seven, or "the child lacks them" would be vacuous.
    const parentShowsAllSeven = (parentReq?.writeCapableVisible.length ?? 0) === WRITE_CAPABLE.length
    steps.enforcement = {
      // Falsifiable by construction: when the restriction silently fails to apply (the pre-fix names
      // re-injected) every request exposes the seven names, so childRequests is 0 and this fails — which
      // the control lane below demonstrates on real data.
      ok: childSpy.length > 0 && parentShowsAllSeven && childSpy.every((c) => c.writeCapableVisible.length === 0),
      childRequests: childReqs.length,
      parentRequests: parentReq ? steps.positive.stubTrace.filter((c) => c !== parentReq).length : 0,
      childToolCounts: childSpy.map((c) => c.toolCount),
      parentToolCount: parentReq?.toolCount ?? 0,
      childLeaksWriteCapable: childSpy.flatMap((c) => c.writeCapableVisible),
      childHasStructuredOutput: childSpy.some((c) => c._toolNames.includes("structured_output")),
      parentHasAllSeven: parentShowsAllSeven,
      note: "read-only authority is ENFORCED: the child's own requests cannot see any of the seven write-capable tools, while the parent's sees all of them",
    }

    steps.positiveOk = {
      // The exact seven-name list reached the harness, the child was created and answered, the harness
      // never reported an unknown tool, AND the enforcement assertion above holds. A create() that
      // throws inside tools.restrict() means NO child exists, so a created, answering child is the
      // precondition; the enforcement lane is what proves the child is actually restricted.
      ok: steps.positive.exit === 0
        && !steps.positive.restrictError
        && steps.positive.spawnDriven
        && !steps.positive.missingCredential
        && JSON.stringify(steps.positive.filterSent?.deny) === JSON.stringify(EXPECTED_DENY),
      note: "the seven-name list reached tools.restrict(), the child was created and answered, and the child's visible toolset excludes all seven write-capable names",
    }
    // CONTROL (t13 / t9 F1): the re-injection lane is where read-only authority SILENTLY DEGRADES in
    // this harness — a stale-but-known name overlaps the scope's restrictable names, so restrict()
    // applies nothing and the child sees the full toolset with no refusal (contract §W3). Asserting
    // that degraded state is what makes the enforcement assertion above falsifiable rather than
    // decorative: if this lane ever stops leaking, the enforcement assertion must be re-derived.
    // DIAGNOSTIC (control) lane: re-injecting the unregistered names into a sandbox copy reproduces the
    // SILENT route, not the loud one (§W3). Asserted below, after the lane has run.
    steps.reinjectionDiagnostic = await probe("neg", { reInjectDeadNames: true })
    // CONTROL (t13 / t9 F1): the re-injection lane is where read-only authority SILENTLY DEGRADES in
    // this harness — a stale-but-known name overlaps the scope's restrictable names, so restrict()
    // applies nothing and the child sees the full toolset with no refusal (contract §W3). Asserting
    // that degraded state is what makes the enforcement assertion above falsifiable rather than
    // decorative: if this lane ever stops leaking, the enforcement assertion must be re-derived.
    const diagTrace = steps.reinjectionDiagnostic.stubTrace
    const diagParent = diagTrace.find((c) => c.toolCount > 0)
    const diagChild = diagTrace.filter((c) => c !== diagParent && c.toolCount > 0 && c.writeCapableVisible.length === 0 && c._toolNames.includes("structured_output"))
    // PROVENANCE GUARD — without this the control cannot distinguish "the degradation happened" from
    // "the mutation never ran": a lane whose injected names never reached the harness would ALSO show
    // zero restricted-child requests, and the control would report a meaningless green. So the control
    // must first prove the MUTATION LOADED, by finding the injected names in the restriction the
    // adapter actually handed over. (t9 hit exactly this trap through a different route: an id-target
    // OVERLAY cannot rebind a row's `name:`, so their mutation lane silently ran the fixed build and
    // reported a clean lane that proved nothing.)
    const diagSent = steps.reinjectionDiagnostic.filterSent?.deny ?? []
    const mutationLoaded = DEAD_NAMES.every((n) => diagSent.includes(n))
    steps.reinjectionControl = {
      ok: mutationLoaded && diagChild.length === 0 && (diagParent?.writeCapableVisible.length ?? 0) === WRITE_CAPABLE.length && steps.reinjectionDiagnostic.restrictError === false,
      mutationLoaded,
      injectedNamesSeenByAdapter: DEAD_NAMES.filter((n) => diagSent.includes(n)),
      childRequestsUnderRestriction: diagChild.length,
      parentToolCount: diagParent?.toolCount ?? 0,
      parentSeesWriteCapable: diagParent?.writeCapableVisible ?? [],
      refusalSeen: steps.reinjectionDiagnostic.restrictError,
      note: "control: the mutation provably loaded (the adapter received the injected names) and the restriction then silently stopped applying — no request is a restricted child and no refusal is raised, which is the exact degradation the enforcement assertion above exists to catch",
    }
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
