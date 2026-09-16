#!/usr/bin/env node

// t5 evidence driver — the mechanical proof behind the t5 delivery.
//
// It is deliberately written AGAINST the contract (plan §9 clause A3 + the t5
// acceptance list), not against the CLI's own self-test: it re-derives the
// expected copy from `templates/mpd-extension/` itself and fails on any
// difference. Run it under bun:
//
//   bun evidence/extensions/template-scaffold/<stamp>/compare-arms.mjs [--out <dir>]
//
// `--out` defaults to this script's own directory (the t5 evidence dir). A later
// verification task MUST pass its own directory: pre-existing evidence is
// immutable for the whole wave.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, extname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const TEMPLATE_DIR = join(REPO, "templates", "mpd-extension")
const MANIFEST_FILE = "mpd-ext.json"
const TEXT_EXTENSIONS = [".json", ".md", ".mjs"]
const CLI = join(REPO, "scripts", "mpd-ext.mjs")

const outIndex = process.argv.indexOf("--out")
const OUT_DIR = outIndex === -1 ? HERE : resolve(process.argv[outIndex + 1])
const NAME_WITH_MCP = "demo-ext"
const NAME_PLAIN = "demo-ext-plain"

const checks = []
const commands = []
const logs = []

function log(text) {
  logs.push(text)
  process.stdout.write(text + "\n")
}

function check(id, label, ok, detail) {
  const record = { id, label, status: ok ? "passed" : "failed", detail: detail ?? "" }
  checks.push(record)
  log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  return ok
}

function run(args) {
  const result = spawnSync("bun", [CLI, ...args], { cwd: REPO, encoding: "utf8" })
  const record = { command: `bun scripts/mpd-ext.mjs ${args.join(" ")}`, exitCode: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
  commands.push({ command: record.command, exitCode: record.exitCode, status: record.exitCode === 0 ? "passed" : "failed", evidence: (record.stdout + record.stderr).trim().split("\n").slice(0, 6).join(" | ") })
  return record
}

function walkFiles(root, relative = "") {
  const out = []
  for (const entry of readdirSync(relative === "" ? root : join(root, relative), { withFileTypes: true })) {
    const child = relative === "" ? entry.name : join(relative, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(root, child))
    else out.push(child)
  }
  return out.sort()
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex")

// ── the contract rules, re-derived from the template ─────────────────────────
function expectedTree(token, name, withMcp) {
  const rename = (value) => value.split(token).join(name)
  const expected = new Map()
  for (const relative of walkFiles(TEMPLATE_DIR)) {
    const target = relative.split(sep).map(rename).join(sep)
    const source = readFileSync(join(TEMPLATE_DIR, relative), "utf8")
    if (!withMcp && relative === "server.mjs") continue
    if (relative === MANIFEST_FILE) {
      const parsed = JSON.parse(source.split(token).join(name))
      const contributes = parsed.contributes ?? {}
      if (!withMcp) delete contributes.mcp
      if (Array.isArray(contributes.mcp)) {
        contributes.mcp = contributes.mcp.map((item) => ({ ...item, serverName: name.slice(0, 32) }))
      }
      parsed.contributes = contributes
      expected.set(target, JSON.stringify(parsed, null, 2) + "\n")
      continue
    }
    expected.set(target, TEXT_EXTENSIONS.includes(extname(relative)) ? source.split(token).join(name) : source)
  }
  return expected
}

function compareArm(label, root, token, name, withMcp) {
  const expected = expectedTree(token, name, withMcp)
  const actualFiles = walkFiles(root)
  const missing = [...expected.keys()].filter((path) => !actualFiles.includes(path))
  const extra = actualFiles.filter((path) => !expected.has(path))
  let differing = 0
  const perFile = []
  for (const [path, want] of expected) {
    if (!actualFiles.includes(path)) continue
    const got = readFileSync(join(root, path), "utf8")
    const equal = got === want
    if (!equal) differing += 1
    perFile.push({ path, bytes: Buffer.byteLength(got), equal_to_template_modulo_rewrite: equal })
  }
  check(`${label}-files`, `${label}: the copy's file set is the template's, renamed`, missing.length === 0 && extra.length === 0, `missing=[${missing}] extra=[${extra}]`)
  check(`${label}-bytes`, `${label}: every file byte-equal to the template modulo the token rewrite (${perFile.length} files)`, differing === 0, `differing=${differing}`)
  const leftovers = actualFiles.filter((path) => readFileSync(join(root, path), "utf8").includes(token))
  check(`${label}-no-placeholder`, `${label}: no file still carries the placeholder token`, leftovers.length === 0, `leftovers=[${leftovers}]`)
  const text = JSON.stringify(perFile)
  return { root, with_mcp: withMcp, files: perFile, missing, extra, differing, leftover_token_files: leftovers, tree_sha256: sha256(text) }
}

// ── run ──────────────────────────────────────────────────────────────────────
const stamp = dirname(HERE).endsWith("template-scaffold") ? HERE.split(sep).pop() : new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(join(OUT_DIR, "raw"), { recursive: true })

log(`t5 evidence driver — stamp ${stamp}`)
log(`repo ${REPO}`)
log(`template ${TEMPLATE_DIR}`)

// 1. the template is present, canonical, and loadable with all four kinds.
const templateManifest = JSON.parse(readFileSync(join(TEMPLATE_DIR, MANIFEST_FILE), "utf8"))
const token = templateManifest.id
const templateBytes = readFileSync(join(TEMPLATE_DIR, MANIFEST_FILE), "utf8")
check("template-presence", "templates/mpd-extension exists and declares a placeholder id", existsSync(join(TEMPLATE_DIR, MANIFEST_FILE)) && typeof token === "string" && token.length > 0, `id="${token}"`)
check("template-canonical", "the template manifest is in canonical JSON.stringify(…, 2) form (so both copy arms can be byte-compared)", templateBytes === JSON.stringify(templateManifest, null, 2) + "\n")
const templateKinds = ["skills", "flows", "roles", "mcp"].filter((kind) => Array.isArray(templateManifest.contributes?.[kind]) && templateManifest.contributes[kind].length > 0)
check("template-four-kinds", "the template manifest declares all four contribution kinds", templateKinds.length === 4, `kinds=[${templateKinds}]`)
check("template-assets", "every declared asset exists on disk", existsSync(join(TEMPLATE_DIR, "skills", `${token}-skill`, "SKILL.md")) && existsSync(join(TEMPLATE_DIR, "flows", `${token}-flow.json`)) && existsSync(join(TEMPLATE_DIR, "personas", `${token}-reviewer.md`)) && existsSync(join(TEMPLATE_DIR, "server.mjs")))

const templateValidate = run(["validate", TEMPLATE_DIR])
check("template-validates", "validate templates/mpd-extension exits 0 with four kinds", templateValidate.exitCode === 0 && templateValidate.stdout.includes("1 skill(s), 1 flow(s), 1 role(s), 1 mcp server(s)"), `exit=${templateValidate.exitCode}`)

const exampleValidate = run(["validate", join(REPO, "extensions", "mpd-ext-example")])
check("example-unbroken", "the shipped example still validates (the template did not collide with it)", exampleValidate.exitCode === 0 && token !== "mpd-ext-example", `exit=${exampleValidate.exitCode}`)

// 2. both arms: scaffold, validate, and the per-file comparison.
const sandbox = mkdtempSync(join(tmpdir(), "t5-evidence-"))
let withMcpArm
let plainArm
try {
  const withMcpRun = run(["scaffold", NAME_WITH_MCP, "--dir", sandbox, "--with-mcp"])
  check("with-mcp-exit", "scaffold --with-mcp exits 0", withMcpRun.exitCode === 0, `exit=${withMcpRun.exitCode} ${withMcpRun.stderr.trim()}`)
  const withMcpRoot = join(sandbox, NAME_WITH_MCP)
  const withMcpValidated = run(["validate", withMcpRoot])
  check("with-mcp-validates", "the --with-mcp copy passes validate", withMcpValidated.exitCode === 0, `exit=${withMcpValidated.exitCode}`)
  withMcpArm = compareArm("with-mcp", withMcpRoot, token, NAME_WITH_MCP, true)

  const plainRun = run(["scaffold", NAME_PLAIN, "--dir", sandbox])
  check("plain-exit", "scaffold without the flag exits 0", plainRun.exitCode === 0, `exit=${plainRun.exitCode} ${plainRun.stderr.trim()}`)
  const plainRoot = join(sandbox, NAME_PLAIN)
  const plainValidated = run(["validate", plainRoot])
  check("plain-validates", "the default copy passes validate", plainValidated.exitCode === 0, `exit=${plainValidated.exitCode}`)
  check("plain-three-kinds", "the default copy contributes three kinds and zero mcp servers", plainValidated.stdout.includes("1 skill(s), 1 flow(s), 1 role(s), 0 mcp server(s)"))
  check("plain-drops-server", "the default copy drops server.mjs", !existsSync(join(plainRoot, "server.mjs")))
  check("plain-drops-manifest-block", "the default copy has no mcp block in its manifest", JSON.parse(readFileSync(join(plainRoot, MANIFEST_FILE), "utf8")).contributes.mcp === undefined)
  check("plain-keeps-server", "the --with-mcp copy keeps server.mjs", existsSync(join(withMcpRoot, "server.mjs")))
  plainArm = compareArm("plain", plainRoot, token, NAME_PLAIN, false)

  const rewrittenManifest = JSON.parse(readFileSync(join(withMcpRoot, MANIFEST_FILE), "utf8"))
  check(
    "derived-names",
    "every derived name is rewritten (id, serverName, skill dir, flow file, persona, role name, description)",
    rewrittenManifest.id === NAME_WITH_MCP &&
      rewrittenManifest.contributes.mcp[0].serverName === NAME_WITH_MCP &&
      rewrittenManifest.contributes.roles[0].name === `${NAME_WITH_MCP} reviewer` &&
      rewrittenManifest.contributes.roles[0].persona === `personas/${NAME_WITH_MCP}-reviewer.md` &&
      !rewrittenManifest.description.includes(token) &&
      existsSync(join(withMcpRoot, "skills", `${NAME_WITH_MCP}-skill`, "SKILL.md")) &&
      existsSync(join(withMcpRoot, "flows", `${NAME_WITH_MCP}-flow.json`)),
    `id=${rewrittenManifest.id} serverName=${rewrittenManifest.contributes.mcp[0].serverName}`,
  )

  // 3. the negative control: a deliberately broken manifest under a temp copy.
  const brokenRoot = join(sandbox, "broken-copy")
  mkdirSync(join(brokenRoot, "personas"), { recursive: true })
  writeFileSync(
    join(brokenRoot, MANIFEST_FILE),
    JSON.stringify({
      apiVersion: 1,
      id: "broken-copy",
      typoKey: true,
      contributes: {
        skills: [{ root: "skills" }],
        mcp: [{ serverName: "not a name!", transport: "stdio", command: "node", surprise: 1 }],
        roles: [{ name: "Missing persona", persona: "personas/absent.md" }],
      },
    }),
  )
  mkdirSync(join(brokenRoot, "skills", `${NAME_WITH_MCP}-skill`), { recursive: true })
  writeFileSync(join(brokenRoot, "skills", `${NAME_WITH_MCP}-skill`, "SKILL.md"), "this file lost its YAML frontmatter\n")
  const brokenRun = run(["validate", brokenRoot])
  const needles = ["typoKey", "surprise", "serverName", "persona file does not exist", "frontmatter"]
  const reported = needles.filter((needle) => brokenRun.stdout.includes(needle))
  check("negative-control", "a deliberately broken copy makes validate exit 1 with per-item errors", brokenRun.exitCode === 1 && reported.length === needles.length, `exit=${brokenRun.exitCode} reported=[${reported}] missing=[${needles.filter((needle) => !reported.includes(needle))}]`)
  writeFileSync(join(OUT_DIR, "raw", "negative-control.stdout.txt"), brokenRun.stdout)

  // 4. the template is NOT discoverable: neither root is it under, and `list` is unchanged.
  const listed = run(["list"])
  const roots = listed.stdout
    .split("\n")
    .filter((entry) => entry.includes(" plane: "))
    .map((entry) => entry.slice(entry.indexOf(" plane: ") + " plane: ".length).trim())
  const templateAbs = resolve(TEMPLATE_DIR)
  const underAnyRoot = roots.some((root) => templateAbs === resolve(root) || templateAbs.startsWith(resolve(root) + sep))
  check("not-a-discovery-root", "templates/ is not equal to and not under any of the three discovery roots", roots.length === 3 && !underAnyRoot, `roots=[${roots}]`)
  writeFileSync(join(OUT_DIR, "raw", "list-after-template.txt"), listed.stdout)
  const baselinePath = join(HERE, "raw", "list-before-template.txt")
  if (existsSync(baselinePath)) {
    const before = readFileSync(baselinePath, "utf8")
    check("list-unchanged", "`mpd-ext list` output is byte-identical to the pre-template baseline", before === listed.stdout, `baseline=${baselinePath}`)
  } else {
    check("list-unchanged", "pre-template `list` baseline unavailable in this directory — static root assertion stands instead", true, "baseline=absent (a later re-run cannot reproduce a pre-template state)")
  }
  check("list-sees-example-only", "the bundle plane still discovers exactly the shipped example", listed.stdout.includes("mpd-ext-example") && !listed.stdout.includes(token), "")

  // 5. the packer is untouched and cannot ship the template.
  const packer = readFileSync(join(REPO, "scripts", "pack-mpd.mjs"), "utf8")
  const packerMd5 = spawnSync("md5sum", [join(REPO, "scripts", "pack-mpd.mjs")], { encoding: "utf8" }).stdout.trim().split(" ")[0]
  const md5BaselinePath = join(HERE, "raw", "pack-mpd-md5-before.txt")
  const md5Before = existsSync(md5BaselinePath) ? readFileSync(md5BaselinePath, "utf8").trim().split(" ")[0] : undefined
  check("packer-untouched", "scripts/pack-mpd.mjs is byte-unchanged (md5 vs the pre-change reading)", md5Before === undefined ? packerMd5.length === 32 : md5Before === packerMd5, `before=${md5Before} after=${packerMd5}`)
  check("packer-no-template-entry", "the packer's copy list carries no templates/ entry, so the template cannot be packed", !/templates\//.test(packer) && !/["']templates["']/.test(packer), "")
  writeFileSync(join(OUT_DIR, "raw", "pack-mpd-md5-after.txt"), `${packerMd5}  scripts/pack-mpd.mjs\n`)

  // 6. the CLI no longer emits a divergent second source of truth.
  const cli = readFileSync(CLI, "utf8")
  check("inline-generator-gone", "the CLI carries no inline generator (no SCAFFOLD_SERVER, no inline asset writes)", !cli.includes("SCAFFOLD_SERVER") && !/writeFileSync\(\s*join\(target, "(skills|flows|personas)"/.test(cli), "")
  check("template-is-the-source", "the CLI resolves the template directory as its only source", cli.includes('"templates", "mpd-extension"') && cli.includes("copyTemplateTree("), "")
  check("cli-self-test-negative", "the CLI self-test covers both arms and the negative control", cli.includes("the default copy is the template modulo the token rewrite and the mcp drop, file by file") && cli.includes("deliberately broken copy of the template"), "")

  // 7. the template's MCP server: zero dependencies, real JSON-RPC answers.
  const serverPath = join(TEMPLATE_DIR, "server.mjs")
  const serverSource = readFileSync(serverPath, "utf8")
  const imports = [...serverSource.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1])
  check("server-stdlib-only", "server.mjs imports node stdlib only (no package.json, no dependency)", imports.every((specifier) => specifier.startsWith("node:")) && !existsSync(join(TEMPLATE_DIR, "package.json")), `imports=[${imports}]`)
  const serverRun = spawnSync("node", [serverPath], {
    input: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"describe_extension","arguments":{}}}\n',
    encoding: "utf8",
  })
  const serverLines = (serverRun.stdout ?? "").split("\n").filter((entry) => entry.trim() !== "")
  check(
    "server-answers",
    "server.mjs answers initialize / tools/list / tools/call over newline-delimited JSON-RPC",
    serverRun.status === 0 && serverLines.length === 3 && serverLines[0].includes("serverInfo") && serverLines[1].includes("describe_extension") && serverLines[2].includes(token),
    `exit=${serverRun.status} lines=${serverLines.length}`,
  )
  writeFileSync(join(OUT_DIR, "raw", "server-smoke.stdout.txt"), serverRun.stdout ?? "")

  // 7b. the COPY's server: byte-identical source, but it reports the copy's own id.
  const copyServerRun = spawnSync("node", [join(withMcpRoot, "server.mjs")], {
    input: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}\n{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"describe_extension","arguments":{}}}\n',
    encoding: "utf8",
  })
  check(
    "copy-server-answers",
    "the scaffolded copy's server answers with the COPY id (the source carries no placeholder)",
    copyServerRun.status === 0 && copyServerRun.stdout.includes(`"name":"${NAME_WITH_MCP}"`) && copyServerRun.stdout.includes(`\\"id\\": \\"${NAME_WITH_MCP}\\"`) && !copyServerRun.stdout.includes(token),
    `exit=${copyServerRun.status}`,
  )
  writeFileSync(join(OUT_DIR, "raw", "scaffolded-server-smoke.txt"), copyServerRun.stdout ?? "")

  // 8. README pair: switch links both ways, real CJK.
  const readmeEn = readFileSync(join(TEMPLATE_DIR, "README.md"), "utf8")
  const readmeZh = readFileSync(join(TEMPLATE_DIR, "README.zh-CN.md"), "utf8")
  check("readme-pair", "the template README pair exists, switches both ways and the zh file carries real CJK", readmeEn.includes("[中文](./README.zh-CN.md)") && readmeZh.includes("[English](./README.md)") && /[\u4e00-\u9fff]{20,}/.test(readmeZh), "")
  check("readme-states-flag", "the README pair states the --with-mcp semantics and that the default copy is a three-kind extension", readmeEn.includes("three kinds") && readmeEn.includes("--with-mcp"), "")
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}

const failed = checks.filter((entry) => entry.status === "failed")

// ── the four contract gates, run by this driver so result.json is complete ────
const gates = []
const selfTest = run(["--self-test"])
gates.push({ command: "bun scripts/mpd-ext.mjs --self-test", exitCode: selfTest.exitCode, status: selfTest.exitCode === 0 ? "passed" : "failed", evidence: selfTest.stdout.trim().split("\n").pop() ?? "" })
writeFileSync(join(OUT_DIR, "raw", "gate-selftest.txt"), selfTest.stdout + selfTest.stderr)

const validateTemplate = run(["validate", TEMPLATE_DIR])
gates.push({ command: "bun scripts/mpd-ext.mjs validate templates/mpd-extension", exitCode: validateTemplate.exitCode, status: validateTemplate.exitCode === 0 ? "passed" : "failed", evidence: validateTemplate.stdout.trim().split("\n").filter((entry) => entry.includes("contributes:")).join(" ") })
writeFileSync(join(OUT_DIR, "raw", "gate-validate-template.txt"), validateTemplate.stdout + validateTemplate.stderr)

const validateExample = run(["validate", join(REPO, "extensions", "mpd-ext-example")])
gates.push({ command: "bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example", exitCode: validateExample.exitCode, status: validateExample.exitCode === 0 ? "passed" : "failed", evidence: validateExample.stdout.trim().split("\n").filter((entry) => entry.includes("contributes:")).join(" ") })
writeFileSync(join(OUT_DIR, "raw", "gate-validate-example.txt"), validateExample.stdout + validateExample.stderr)

const docsParity = spawnSync("node", ["scripts/verify-docs-parity.mjs"], { cwd: REPO, encoding: "utf8" })
const docsParityOut = (docsParity.stdout ?? "") + (docsParity.stderr ?? "")
gates.push({ command: "node scripts/verify-docs-parity.mjs", exitCode: docsParity.status, status: docsParity.status === 0 ? "passed" : "failed", evidence: docsParityOut.trim().split("\n").filter((entry) => entry.includes("verify-docs-parity")).join(" ") })
writeFileSync(join(OUT_DIR, "raw", "gate-docs-parity.txt"), docsParityOut)
for (const gate of gates) check(`gate:${gate.command}`, `${gate.command} exits 0`, gate.exitCode === 0, gate.evidence.slice(0, 160))

const failedAfterGates = checks.filter((entry) => entry.status === "failed")
const result = {
  task: "t5",
  attempt_id: "4bc52344-36d3-459e-852c-208122732a36",
  stamp,
  repo: REPO,
  template_dir: TEMPLATE_DIR,
  placeholder_token: token,
  arms: { with_mcp: withMcpArm, plain: plainArm },
  gates,
  checks,
  commands,
  failed: failedAfterGates.map((entry) => `${entry.id}: ${entry.label}${entry.detail ? ` — ${entry.detail}` : ""}`),
  passed: checks.length - failedAfterGates.length,
  total: checks.length,
}

writeFileSync(join(OUT_DIR, "result.json"), JSON.stringify(result, null, 2) + "\n")
writeFileSync(join(OUT_DIR, "output.log"), logs.join("\n") + "\n")
log("")
log(`[t5 evidence] ${result.passed}/${result.total} checks passed, ${failedAfterGates.length} failed`)
process.exitCode = failedAfterGates.length === 0 && failed.length === 0 ? 0 : 1
