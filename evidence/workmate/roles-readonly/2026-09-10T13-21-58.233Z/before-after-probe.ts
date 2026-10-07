// Parameterized restrict-validation probe for t5.
// Runs the SAME drive (local stub -> one mpd_role_spawn) against a chosen checkout, so the pre-fix
// and post-fix behaviour can be compared directly. The adapter is copied into the sandbox with a
// logging line, so we can see whether the spawn actually executes and what filter reaches the harness.
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

const target = process.argv[2] // checkout to probe
const label = process.argv[3] ?? "run"
if (!target || !existsSync(join(target, "scripts", "install-profile.mjs"))) {
  console.error("usage: ordering-probe2.mjs <checkout> <label>"); process.exit(2)
}

function runAsync(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (d) => { out += d })
    child.stderr.on("data", (d) => { out += d })
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeout ?? 600000)
    child.on("close", (code) => { clearTimeout(timer); resolve({ status: code, out }) })
  })
}

const sandbox = mkdtempSync(join(tmpdir(), "mpd-" + label + "-dsh-"))
const runHome = mkdtempSync(join(tmpdir(), "mpd-" + label + "-home-"))
const ws = join(runHome, "ws"); mkdirSync(ws, { recursive: true })
cpSync(join(homedir(), ".dsh/.credentials.yaml"), join(sandbox, ".credentials.yaml"))
if (existsSync(join(homedir(), ".dsh/settings.yaml"))) cpSync(join(homedir(), ".dsh/settings.yaml"), join(sandbox, "settings.yaml"))
const env = { ...process.env, DSH_HOME: sandbox, HOME: runHome, DEEPSEEK_API_KEY: "sk-probe-local-stub" }

const inst = await runAsync(process.execPath, [join(target, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env, timeout: 600000, cwd: target })
if (inst.status !== 0) { console.log(JSON.stringify({ label, fatal: "install failed", out: inst.out.slice(-800) }, null, 2)); process.exit(1) }

const patchPath = join(sandbox, "cordis.patch.yml")
let patch = readFileSync(patchPath, "utf8")
patch = patch.replace(/^ {2}- id: mpd-workmate\n(?: {4,}[^\n]*\n)*/m, "")

// Instrument the adapter copy: log the toolFilter the roles plugin hands to the harness.
const adapterCopyDir = join(sandbox, "adapter-probe")
mkdirSync(adapterCopyDir, { recursive: true })
const adapterCopy = join(adapterCopyDir, "index.js")
let adapterSrc = readFileSync(join(target, "packages/mpd-dsh-adapter-plugin/dist/index.js"), "utf8")
adapterSrc = adapterSrc.replace(
  /const run = await subagents\.start\(/,
  'console.error("[ADAPTER-PROBE] spawn toolFilter=" + JSON.stringify(spec.toolFilter ?? null) + " label=" + String(spec.label));\n      const run = await subagents.start(',
)
// No wrap needed for the verdict: tools.restrict() throws INSIDE the child's setup, so a throw means
// no child agent is ever created. "child created and answered" therefore settles the validation.
if (!adapterSrc.includes("[ADAPTER-PROBE]")) { console.log(JSON.stringify({ label, fatal: "adapter instrumentation missed" }, null, 2)); process.exit(1) }
writeFileSync(adapterCopy, adapterSrc)
const adapterRow = patch.match(/^ {2}- id: mpd-dsh-adapter\n(?: {4,}[^\n]*\n)*/m)
if (adapterRow) patch = patch.replace(adapterRow[0], adapterRow[0].replace(/^( {4}name:).*$/m, `$1 "${adapterCopy}"`))

let calls = 0
const sse = (res, payload) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" })
  res.write(`data: ${JSON.stringify(payload)}\n\n`); res.write("data: [DONE]\n\n"); res.end()
}
const server = createServer((req, res) => {
  let b = ""; req.on("data", (c) => { b += c })
  req.on("end", () => {
    calls += 1
    let hasTools = false
    try { hasTools = Array.isArray(JSON.parse(b).tools) && JSON.parse(b).tools.length > 0 } catch { /* ignore */ }
    console.error(`[STUB] call#${calls} hasTools=${hasTools} bytes=${b.length}`)
    if (calls === 1) {
      sse(res, { id: "c1", object: "chat.completion.chunk", created: 1, model: "probe", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "mpd_role_spawn", arguments: JSON.stringify({ role: "oracle", task: "Reply OK" }) } }] }, finish_reason: null }] })
    } else {
      sse(res, { id: "c2", object: "chat.completion.chunk", created: 2, model: "probe", choices: [{ index: 0, delta: { role: "assistant", content: "probe-child-answered" }, finish_reason: null }] })
    }
  })
})
const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)))
patch += ["", "- id: llm-deepseek", "  config:", `    baseURL: http://127.0.0.1:${port}/v1`, "    apiKeyEnv: DEEPSEEK_API_KEY", ""].join("\n")
writeFileSync(patchPath, patch)

const task = 'Call the tool mpd_role_spawn exactly once with {"role":"oracle","task":"Reply OK"}.'
const run = await runAsync("dsh", ["--profile", "mpd-headless", task], { env, cwd: ws, timeout: 600000 })
server.close()
const out = run.out
const result = {
  label,
  target,
  exit: run.status,
  denyListInThatCheckout: (() => {
    const d = readFileSync(join(target, "packages/mpd-roles-plugin/dist/index.js"), "utf8")
    const m = /var READONLY_DENY = \[([^\]]*)\]/.exec(d)
    return m ? [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]) : null
  })(),
  adapterProbe: (out.match(/\[ADAPTER-PROBE\][^\n]*/g) || []),
  stubCalls: calls,
  restrictErrorText: (out.match(/names unknown global tools?[^\n;]*/) || [null])[0],
  unknownToolPrefix: out.includes("names unknown global tool"),
  childAnswered: out.includes("probe-child-answered"),
  loaderError: /failed to apply|JsonSchemaError/.test(out),
  tail: out.slice(-400),
}
console.log(JSON.stringify(result, null, 2))
