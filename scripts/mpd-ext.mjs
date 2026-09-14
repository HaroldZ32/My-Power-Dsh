#!/usr/bin/env node
// mpd-ext — the developer CLI of the MPD extension interface (row `mpd-ext`).
//
// It shares ONE validator with the runtime: the descriptor is loaded with the
// plugin's own `buildExtension()` (packages/mpd-ext-plugin/src/registry.ts), the
// same function apply-time discovery calls. A manifest this CLI accepts is a
// manifest the loader accepts — there is deliberately no second rule set here,
// because "documented here, enforced differently there" is how a contract rots.
//
// Commands
//   validate <dir|mpd-ext.json>   exit 0 when the extension loads, exit 1 with one
//                                 line per item otherwise (CI-safe)
//   scaffold <name> [--dir <path>] [--with-mcp]
//                                 write a minimal, loadable extension
//   list                          what this host would discover, plane by plane
//   --self-test                   the CLI's own checks (temp dirs only)
//
// Imports the TypeScript sources directly (this script runs under bun — `bun
// scripts/mpd-ext.mjs`), so no build step can ever make the CLI validate a stale
// copy of the rules.
//
// Lives under scripts/ rather than skills/** on purpose: skills/** is
// VENDOR_LOCK-fingerprinted, and touching it would force a treeSha re-pin.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = dirname(dirname(scriptPath))

const registry = await import(new URL("../packages/mpd-ext-plugin/src/registry.ts", import.meta.url).href)
const sdk = await import(new URL("../packages/mpd-ext-plugin/src/sdk.ts", import.meta.url).href)
const manifest = await import(new URL("../packages/mpd-ext-plugin/src/manifest.ts", import.meta.url).href)

const MANIFEST_FILE = sdk.MPD_EXT_CONTRACT.manifestFile
const PLANES = ["project", "user", "bundle"]

function line(text) {
  process.stdout.write(text + "\n")
}

function fail(text) {
  process.stderr.write(text + "\n")
  process.exitCode = 1
}

/** Resolve `<dir>` (an extension directory) or a direct manifest path to {root, manifestPath}. */
function locateExtension(input) {
  const target = resolve(input ?? "")
  if (!existsSync(target)) return undefined
  if (statSync(target).isFile()) {
    if (target.endsWith(MANIFEST_FILE)) return { root: dirname(target), manifestPath: target }
    return undefined
  }
  const manifestPath = join(target, MANIFEST_FILE)
  if (!existsSync(manifestPath)) return undefined
  return { root: target, manifestPath }
}

/** Load one extension through the RUNTIME validator. Never throws. */
function loadExtension(input, plane = "user") {
  const located = locateExtension(input)
  if (located === undefined) {
    return { errors: [{ item: input ?? "", reason: `no ${MANIFEST_FILE} found at or under "${resolve(input ?? "")}"` }], entry: undefined, rejected: undefined }
  }
  let raw
  try {
    raw = readFileSync(located.manifestPath, "utf8")
  } catch (error) {
    return { errors: [{ item: located.manifestPath, reason: `cannot read: ${String(error)}` }], entry: undefined, rejected: undefined }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      errors: [{ item: located.manifestPath, reason: `invalid JSON: ${String(error)}` }],
      entry: undefined,
      rejected: { id: located.root, plane, origin: "directory", root: located.root, source: located.manifestPath, errors: [{ item: MANIFEST_FILE, reason: `invalid JSON: ${String(error)}` }] },
    }
  }
  const id = typeof parsed?.id === "string" && parsed.id.length > 0 ? parsed.id : "unnamed"
  try {
    const built = registry.buildExtension({
      input: parsed,
      plane,
      origin: "directory",
      root: located.root,
      source: located.manifestPath,
      fallbackId: id,
      providerName: `mpd-ext:${id}`,
    })
    if (built.rejected !== undefined) return { errors: built.rejected.errors, entry: undefined, rejected: built.rejected }
    return { errors: built.entry.errors, entry: built.entry, rejected: undefined }
  } catch (error) {
    return { errors: [{ item: MANIFEST_FILE, reason: `validation crashed: ${String(error)}` }], entry: undefined, rejected: undefined }
  }
}

function describeEntry(entry) {
  const counts = entry.contributions
  return `${counts.skills} skill(s), ${counts.flows} flow(s), ${counts.roles} role(s), ${counts.mcp} mcp server(s)`
}

/** `validate <dir>` — the CI gate. */
function runValidate(input, plane) {
  if (input === undefined) {
    fail("mpd-ext validate: an extension directory is required")
    return
  }
  const result = loadExtension(input, plane)
  const id = result.entry?.id ?? result.rejected?.id ?? resolve(input)
  line(`[mpd-ext] validate ${resolve(input)} (plane=${plane})`)
  line(`  extension "${id}": ${result.entry === undefined ? "REJECTED" : "loadable"}`)
  if (result.entry !== undefined) line(`  contributes: ${describeEntry(result.entry)}`)
  for (const error of result.errors) line(`  error ${error.item}: ${error.reason}`)
  for (const pending of result.entry?.pending ?? []) line(`  pending ${pending.item}: ${pending.reason}`)
  if (result.errors.length > 0) {
    fail(`[mpd-ext] ${result.errors.length} problem(s) — this extension would not load`)
    return
  }
  line("[mpd-ext] ok")
}

/** `list` — what this host would discover. */
function runList() {
  const roots = [
    ["project", manifest.projectExtensionsDir(process.cwd())],
    ["user", manifest.userExtensionsDir()],
    ["bundle", manifest.bundleExtensionsDir()],
  ]
  const seen = new Map()
  let problems = 0
  for (const [plane, dir] of roots) {
    line(`[mpd-ext] ${plane} plane: ${dir}`)
    const discovered = manifest.discoverPlane({ plane, dir, providerNameFor: (id) => `mpd-ext:${id}`, warn: (text) => { problems += 1; line(`  warn: ${text}`) } })
    for (const entry of discovered.entries) {
      if (seen.has(entry.id)) {
        line(`  ${entry.id}: shadowed by the ${seen.get(entry.id)} plane (first wins)`)
        continue
      }
      seen.set(entry.id, plane)
      line(`  ${entry.id}: ${entry.enabled ? "enabled" : "disabled"} — ${describeEntry(entry)}${entry.errors.length > 0 ? ` — ${entry.errors.length} error(s)` : ""}`)
      for (const error of entry.errors) line(`    error ${error.item}: ${error.reason}`)
    }
    for (const rejected of discovered.rejected) {
      problems += 1
      line(`  ${rejected.id}: REJECTED — ${rejected.errors.map((error) => `${error.item}: ${error.reason}`).join("; ")}`)
    }
    if (discovered.entries.length === 0 && discovered.rejected.length === 0) line("  (none)")
  }
  if (problems > 0) {
    line(`[mpd-ext] ${problems} problem(s) recorded (the loader still boots: every failure is contained per item)`)
  }
}

const SCAFFOLD_SERVER = `#!/usr/bin/env node
// Minimal dependency-free stdio MCP server (newline-delimited JSON-RPC 2.0).
import { stdin, stdout, stderr } from "node:process"

const TOOLS = [{ name: "hello", description: "Say hello.", inputSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false } }]
const send = (message) => stdout.write(JSON.stringify(message) + "\\n")

function handle(message) {
  const method = message.method
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : "2024-11-05", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "scaffold", version: "0.1.0" } } })
    return
  }
  if (method === "notifications/initialized") return
  if (method === "tools/list") { send({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } }); return }
  if (method === "tools/call") {
    const name = message.params?.name
    const text = name === "hello" ? \`hello \${String(message.params?.arguments?.name ?? "world")}\` : \`unknown tool "\${String(name)}"\`
    send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text }] } })
    return
  }
  if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: \`Method not found: \${String(method)}\` } })
}

let buffer = ""
stdin.setEncoding("utf8")
stdin.on("data", (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf("\\n")) !== -1) {
    const text = buffer.slice(0, index).replace(/\\r$/, "")
    buffer = buffer.slice(index + 1)
    if (text.trim() === "") continue
    try { handle(JSON.parse(text)) } catch (error) { stderr.write(String(error) + "\\n") }
  }
})
process.on("SIGTERM", () => process.exit(0))
`

/**
 * `scaffold <name> --dir <path>` — write a minimal extension that the SAME
 * validator then accepts (asserted here, not merely claimed).
 */
function runScaffold(name, options) {
  if (typeof name !== "string" || name.length === 0) {
    fail("mpd-ext scaffold: an extension name is required")
    return
  }
  if (!new RegExp(sdk.MPD_EXT_CONTRACT.idPattern).test(name)) {
    fail(`mpd-ext scaffold: "${name}" must match ${sdk.MPD_EXT_CONTRACT.idPattern}`)
    return
  }
  const skillName = `${name}-skill`
  const flowId = `${name}-flow`
  for (const [label, value] of [["skill name", skillName], ["flow id", flowId]]) {
    if (!new RegExp(sdk.MPD_EXT_CONTRACT.skillNamePattern).test(value)) {
      fail(`mpd-ext scaffold: the derived ${label} "${value}" violates the skill-name grammar ${sdk.MPD_EXT_CONTRACT.skillNamePattern} — pick a name without a trailing dash`)
      return
    }
  }
  const parent = resolve(options.dir ?? ".")
  const target = join(parent, name)
  if (existsSync(target)) {
    fail(`mpd-ext scaffold: "${target}" already exists — scaffolding never overwrites`)
    return
  }
  const withMcp = options.withMcp === true
  mkdirSync(join(target, "skills", skillName), { recursive: true })
  mkdirSync(join(target, "flows"), { recursive: true })
  mkdirSync(join(target, "personas"), { recursive: true })
  const descriptor = {
    apiVersion: sdk.MPD_EXT_CONTRACT.apiVersion,
    id: name,
    description: `The ${name} extension (scaffolded by scripts/mpd-ext.mjs).`,
    enabled: false,
    contributes: {
      skills: [{ root: "skills", rank: sdk.MPD_EXT_CONTRACT.defaultRank }],
      flows: [{ dir: "flows", rank: sdk.MPD_EXT_CONTRACT.defaultRank }],
      roles: [{ name: `${name} reviewer`, description: `Reviewer contributed by the ${name} extension.`, readonly: true, persona: `personas/${name}-reviewer.md` }],
      ...(withMcp ? { mcp: [{ serverName: name.slice(0, 32), transport: "stdio", command: "node", args: ["server.mjs"], cwd: ".", connectTimeoutMs: sdk.MPD_EXT_CONTRACT.defaultConnectTimeoutMs, toolCallTimeoutMs: sdk.MPD_EXT_CONTRACT.defaultToolCallTimeoutMs }] } : {}),
    },
  }
  writeFileSync(join(target, MANIFEST_FILE), JSON.stringify(descriptor, null, 2) + "\n")
  writeFileSync(
    join(target, "skills", skillName, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: "The ${name} extension's first skill: describe what it does, then how to run it. Use whenever a ${name} task needs a repeatable procedure."\n---\n\n# ${skillName}\n\nReplace this paragraph with the procedure. Keep the load-bearing sentence first:\nthe model-facing catalog truncates a description at 500 characters.\n`,
  )
  writeFileSync(
    join(target, "flows", `${flowId}.json`),
    JSON.stringify(
      {
        id: flowId,
        title: `${name} flow`,
        description: `The ${name} extension's first flow. Use when the ${name} procedure needs an ordered checklist.`,
        whenToUse: `Use when a ${name} task needs a step-by-step pass.`,
        steps: [{ title: "First step", detail: "Describe the action.", tool: "read", output: "What this step produces." }],
      },
      null,
      2,
    ) + "\n",
  )
  writeFileSync(join(target, "personas", `${name}-reviewer.md`), `You are the ${name} reviewer.\n\nReview the change, report findings with file and line, and never edit files.\n`)
  if (withMcp) writeFileSync(join(target, "server.mjs"), SCAFFOLD_SERVER)

  const result = loadExtension(target, "user")
  if (result.errors.length > 0 || result.entry === undefined) {
    fail(`mpd-ext scaffold: the generated extension does not load — this is a CLI defect, please report it`)
    for (const error of result.errors) line(`  error ${error.item}: ${error.reason}`)
    return
  }
  line(`[mpd-ext] scaffolded "${name}" at ${target}`)
  line(`  contributes: ${describeEntry(result.entry)}`)
  line(`  next: bun scripts/mpd-ext.mjs validate ${target}`)
}

// ── self-test ───────────────────────────────────────────────────────────────

function runChild(args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8" })
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

function selfTest() {
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-ext-cli-selftest-"))
  let checks = 0
  const expect = (condition, label) => {
    checks += 1
    if (condition) line(`  ok ${label}`)
    else fail(`  FAIL ${label}`)
  }
  try {
    // 1. scaffold -> the same validator accepts it, and the CLI exits 0.
    const scaffold = runChild(["scaffold", "demo-ext", "--dir", sandbox, "--with-mcp"])
    expect(scaffold.status === 0, `scaffold exits 0 (got ${scaffold.status}): ${scaffold.stderr.trim()}`)
    const scaffolded = join(sandbox, "demo-ext")
    expect(existsSync(join(scaffolded, MANIFEST_FILE)), "scaffold wrote mpd-ext.json")
    for (const asset of ["skills/demo-ext-skill/SKILL.md", "flows/demo-ext-flow.json", "personas/demo-ext-reviewer.md", "server.mjs"]) {
      expect(existsSync(join(scaffolded, asset)), `scaffold wrote ${asset}`)
    }
    const validated = runChild(["validate", scaffolded])
    expect(validated.status === 0, `validate accepts the scaffold (got ${validated.status}): ${validated.stderr.trim()}`)

    // 2. a deliberately broken extension: every defect is reported, exit is 1.
    const broken = join(sandbox, "broken-ext")
    mkdirSync(broken, { recursive: true })
    writeFileSync(
      join(broken, MANIFEST_FILE),
      JSON.stringify({
        apiVersion: 1,
        id: "broken-ext",
        typoKey: true,
        contributes: {
          skills: [{ root: "../outside" }],
          mcp: [{ serverName: "not a name!", transport: "stdio", command: "node", surprise: 1 }],
          roles: [{ name: "Missing persona", persona: "personas/absent.md" }],
        },
      }),
    )
    const brokenRun = runChild(["validate", broken])
    expect(brokenRun.status === 1, `validate exits 1 on a broken extension (got ${brokenRun.status})`)
    for (const needle of ["typoKey", "serverName", "contributes.skills[0].root", "escapes are rejected", "surprise", "persona file does not exist"]) {
      expect(brokenRun.stdout.includes(needle), `the broken run reports "${needle}"`)
    }

    // 3. the shipped example validates.
    const example = runChild(["validate", join(repoRoot, "extensions", "mpd-ext-example")])
    expect(example.status === 0, `validate accepts extensions/mpd-ext-example (got ${example.status}): ${example.stderr.trim()}`)

    // 4. list never throws and sees the bundle plane.
    const listed = runChild(["list"])
    expect(listed.status === 0, `list exits 0 (got ${listed.status})`)
    expect(listed.stdout.includes("bundle plane"), "list names the bundle plane")
    expect(listed.stdout.includes("mpd-ext-example"), "list sees the shipped example")

    // 5. usage guard.
    const usage = runChild([])
    expect(usage.stdout.includes("usage") || usage.status !== 0, "no command prints usage or fails")

    if (process.exitCode !== 1) line(`[mpd-ext] --self-test passed (${checks} checks)`)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}

const USAGE = `usage: bun scripts/mpd-ext.mjs <command>

  validate <dir|mpd-ext.json> [--plane project|user|bundle]
  scaffold <name> [--dir <path>] [--with-mcp]
  list
  --self-test`

async function main() {
  const argv = process.argv.slice(2)
  const command = argv[0]
  const flag = (name) => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  if (command === "--self-test") return selfTest()
  if (command === "validate") {
    const plane = flag("--plane")
    return runValidate(argv[1], PLANES.includes(plane) ? plane : "user")
  }
  if (command === "scaffold") {
    return runScaffold(argv[1], { dir: flag("--dir"), withMcp: argv.includes("--with-mcp") })
  }
  if (command === "list") return runList()
  line(USAGE)
  if (command !== undefined && command !== "help" && command !== "--help") process.exitCode = 2
}

await main()
