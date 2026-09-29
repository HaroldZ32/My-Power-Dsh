#!/usr/bin/env node
// Case extension-template: the SHIPPED authoring template, mounted and used, on a
// REAL boot in isolation.
//
// WHAT CARRIES THE PROOF
//   1. the template itself — `templates/mpd-extension/` (7 files, all four kinds) —
//      copied by the developer CLI (`bun scripts/mpd-ext.mjs scaffold <name> --dir
//      <host plane> --with-mcp`) into a SANDBOX host plane, never into the checkout.
//      The template ships `enabled: false` on purpose (it must never be discovered
//      from the repo), so this case flips ONLY the sandbox copy's flag and records
//      that step; the repo template is never touched.
//   2. a REAL `dsh` process (mpd-headless rows composed from THIS checkout,
//      sandboxed DSH_HOME + HOME + session cwd). The model step is answered by the
//      shared local OpenAI-shaped stub (extension-isolation.mjs), so the tool calls
//      are really executed by the session and need no provider credential.
//   3. every claim is read from the HARNESS's own session log
//      (`lib/session-evidence.mjs`: `tool/call` + non-error `tool/result`) — never
//      from the model's prose. The one exception is the offered-tool list, which is
//      read from the stub's own request trace AND the session log's tool list.
//
// FOUR KINDS, ONE COPY (the template's whole promise)
//   skill  — `skill` answers with the copy's own SKILL.md (the rewritten heading)
//   flow   — `mpd_flow_show <id>` answers with the copy's flow, whose step names the
//            copy's own skill (so the id rewrite is proven, not assumed)
//   role   — `mpd_role_persona` answers with the copy's persona AND `mpd_role_spawn`
//            really starts a child (the stub answers it)
//   mcp    — the copy's own stdio server publishes `mcp__<name>__describe_extension`,
//            which is called with a NON-ERROR result carrying the copy's manifest
//
// PREREQ: absent-dsh-binary dsh "install DeepSeek Harness (dsh) on PATH"
// PREREQ: absent-runtime packages/mpd-ext-plugin/dist/index.js "bun build packages/mpd-ext-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/index.js"
// PREREQ: absent-fixture templates/mpd-extension/mpd-ext.json "restore the shipped authoring template (templates/mpd-extension/)"
//
// --self-test is offline (temp dirs + the CLI only): the template loads with all
// four kinds, the scaffold emits the four-kind copy this case boots, the derived
// names this case asserts still match the CLI's own rewrite, and the case-table
// row for this lane exists. Evidence ->
// evidence/extensions/extension-template/<ts>/{result.json,output.log}.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  REPO, binaryPresent, bootSession, callsOf, crashSignatures, createSandbox, cleanup, gatePrereqs, installProfile,
  isolationStep, keepRawSession, makeStubModel, sessionEvidence, timestamp, toolResultsByCallId, useStubRoute,
  writeEvidence,
} from "./extension-isolation.ts"

export const SLUG = "extension-template"

/** The template's shipped placeholder id — read from the template, never hard-coded twice. */
const TEMPLATE_DIR = join(REPO, "templates", "mpd-extension")
const CLI = join(REPO, "scripts", "mpd-ext.mjs")

/** The name this case scaffolds into the sandbox host plane. */
const EXT_NAME = "qa-template"
const EXT_ID = EXT_NAME
const SKILL_NAME = EXT_NAME + "-skill"
const FLOW_ID = EXT_NAME + "-flow"
const ROLE_NAME = EXT_NAME + " reviewer"
const MCP_SERVER = EXT_NAME
/** `mcp__<serverName>__<rawName>`; the harness hash branch does not fire on this name. */
const MCP_TOOL = "mcp__" + MCP_SERVER + "__describe_extension"
const CHILD_MARKER = "QA-TEMPLATE-CHILD"
const PERSONA_FILE = "personas/" + EXT_NAME + "-reviewer.md"

function templateManifest() {
  return JSON.parse(readFileSync(join(TEMPLATE_DIR, "mpd-ext.json"), "utf8"))
}

/** The template's placeholder id (its own manifest `id`), the CLI's rewrite token. */
function templateToken() {
  return String(templateManifest().id ?? "")
}

let productPublicToolName = null

/**
 * T-56: the public tool-name formula lives in the PRODUCT
 * (`packages/mpd-ext-plugin/src/mcp-client.ts#publicToolName`) — this case must never keep its own
 * copy of it (the copy it used to carry had a placeholder hash branch, so it could only ever agree
 * with the product on a lossless name). Loaded LAZILY on purpose: a module-level import of a `.ts`
 * module would crash before the case's prerequisite gate could skip, and the import needs a runtime
 * with TypeScript type stripping (node >= 22.6 / bun).
 */
async function loadPublicToolName() {
  if (productPublicToolName) return productPublicToolName
  const source = join(REPO, "packages", "mpd-ext-plugin", "src", "mcp-client.ts")
  if (!existsSync(source)) fail("T-56: the product's mcp-client.ts is missing: " + source)
  let module
  try {
    module = await import(pathToFileURL(source).href)
  } catch (error) {
    fail("T-56: cannot import the product's publicToolName from " + source + " (a runtime with TypeScript type stripping is required): " + error.message)
  }
  if (typeof module.publicToolName !== "function") fail("T-56: " + source + " no longer exports publicToolName")
  productPublicToolName = module.publicToolName
  return productPublicToolName
}

/** Run the developer CLI (bun: it imports the TypeScript sources directly). */
function runCli(args, options = {}) {
  return spawnSync("bun", [CLI, ...args], { encoding: "utf8", timeout: 300000, cwd: REPO, ...options })
}

/**
 * Scaffold a named copy of the shipped template into `parentDir` and return the
 * facts this case asserts on. The ONLY write to the copy is the `enabled` flip
 * (the shipped template is disabled by design); everything else is the CLI's own
 * output, which the self-test compares against this case's expectations.
 */
function scaffoldCopy(parentDir) {
  const run = runCli(["scaffold", EXT_NAME, "--dir", parentDir, "--with-mcp"])
  const root = join(parentDir, EXT_NAME)
  const manifestPath = join(root, "mpd-ext.json")
  if (run.status !== 0 || !existsSync(manifestPath)) return { ok: false, run, root, enabled: false }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  manifest.enabled = true
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
  return { ok: true, run, root, enabled: true, manifest }
}

/** A recursive file listing (relative paths, sorted) — the copy's shape, recorded. */
function treeOf(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else out.push(path.slice(root.length + 1))
    }
  }
  if (existsSync(root)) walk(root)
  return out
}

async function selfTest() {
  const problems = []
  const check = (condition, message) => { if (!condition) problems.push(message) }

  // 1) the shipped template exists, loads, and carries all four kinds.
  check(existsSync(join(TEMPLATE_DIR, "mpd-ext.json")), "the shipped template (templates/mpd-extension/mpd-ext.json) is missing")
  check(existsSync(CLI), "the developer CLI (scripts/mpd-ext.mjs) is missing — the scaffold step cannot run")
  const templateValidation = runCli(["validate", TEMPLATE_DIR])
  check(templateValidation.status === 0, "the CLI must accept the shipped template (exit " + templateValidation.status + "): " + String(templateValidation.stderr ?? "").slice(0, 200))
  check(String(templateValidation.stdout ?? "").includes("1 skill(s), 1 flow(s), 1 role(s), 1 mcp server(s)"), "the template must declare all four contribution kinds")

  // 2) the template ships DISABLED: this case's enable step is therefore a real,
  //    recorded mutation of the SANDBOX copy, not a no-op.
  check(templateManifest().enabled === false, "the template must ship enabled:false (it must never be discovered straight from the repo)")

  // 3) the CLI emits the four-kind copy THIS case boots, and its derived names are
  //    the ones this case asserts (a CLI rename would otherwise make every live
  //    assertion below fail for the wrong reason).
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-template-selftest-"))
  try {
    const scaffolded = scaffoldCopy(sandbox)
    check(scaffolded.ok, "scaffold --with-mcp failed in the self-test: " + String(scaffolded.run?.stderr ?? "").slice(0, 200))
    if (scaffolded.ok) {
      const copyValidation = runCli(["validate", scaffolded.root])
      check(copyValidation.status === 0, "the CLI must accept its own four-kind copy (exit " + copyValidation.status + ")")
      check(scaffolded.manifest.id === EXT_ID, "the copy's id must be " + EXT_ID + " (got " + String(scaffolded.manifest.id) + ")")
      check(String(scaffolded.manifest.contributes.mcp?.[0]?.serverName) === MCP_SERVER, "the copy's mcp serverName must be rewritten to " + MCP_SERVER)
      check(String(scaffolded.manifest.contributes.roles?.[0]?.name) === ROLE_NAME, "the copy's role name must be " + ROLE_NAME + " (got " + String(scaffolded.manifest.contributes.roles?.[0]?.name) + ")")
      check(String(scaffolded.manifest.contributes.roles?.[0]?.persona) === PERSONA_FILE, "the copy's persona path must be " + PERSONA_FILE)
      const tree = treeOf(scaffolded.root)
      for (const [asset, what] of [
        ["mpd-ext.json", "the manifest"],
        ["skills/" + SKILL_NAME + "/SKILL.md", "the skill asset"],
        ["flows/" + FLOW_ID + ".json", "the flow asset"],
        [PERSONA_FILE, "the role persona"],
        ["server.mjs", "the stdio server"],
      ]) {
        check(tree.includes(asset), "the copy is missing " + what + " (" + asset + "); have: " + tree.join(", "))
      }
      // The skill heading and the flow's own cross-reference are the two markers the
      // LIVE arm reads out of tool results, so they are pinned here.
      const skillMd = readFileSync(join(scaffolded.root, "skills", SKILL_NAME, "SKILL.md"), "utf8")
      check(skillMd.includes("# " + SKILL_NAME), "the copy's SKILL.md must carry the heading # " + SKILL_NAME)
      check(skillMd.includes("The " + EXT_NAME + " extension's first skill"), "the copy's SKILL.md description must carry the rewritten name")
      const flow = JSON.parse(readFileSync(join(scaffolded.root, "flows", FLOW_ID + ".json"), "utf8"))
      check(flow.id === FLOW_ID, "the copy's flow id must be " + FLOW_ID)
      check(JSON.stringify(flow).includes(SKILL_NAME), "the copy's flow must reference " + SKILL_NAME + " (the id rewrite inside the document)")
      const persona = readFileSync(join(scaffolded.root, PERSONA_FILE), "utf8")
      // The template's prose wraps, so the sentence check is whitespace-normalized.
      const personaFlat = persona.replace(/\s+/g, " ")
      check(persona.includes(ROLE_NAME), "the copy's persona must name " + ROLE_NAME)
      check(personaFlat.includes("read-only role contributed by the " + EXT_NAME + " extension"), "the copy's persona must carry the rewritten extension id")
      check(scaffolded.enabled === true, "the self-test copy must be enabled for the live arm")
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }

  // 4) the expected public MCP tool name is the PRODUCT's own formula output (T-56: imported from
  //    mcp-client.ts, never re-implemented here) — a name that needed the hash branch would make
  //    this case assert a name the bridge never publishes.
  const productFormula = await loadPublicToolName()
  const expectedToolName = productFormula(MCP_SERVER, "describe_extension")
  check(expectedToolName === MCP_TOOL, "the expected MCP tool name changed: " + expectedToolName)
  const ownSource = readFileSync(join(REPO, "skills", "dsh-qa", "scripts", "extension-template.mjs"), "utf8")
  // Built by concatenation so this check's own needle cannot appear in the file it scans.
  check(!ownSource.includes("function public" + "ToolName("), "T-56: the case must not re-implement the product's publicToolName")
  check(ownSource.includes('"src", "mcp-client.ts"'), "T-56: the case must load the formula from the product's mcp-client.ts")
  const serverSource = readFileSync(join(TEMPLATE_DIR, "server.mjs"), "utf8")
  check(serverSource.includes("kinds: KINDS.filter("), "the template's server no longer reports its contributed kinds")
  check(serverSource.includes("root: HERE") && serverSource.includes("enabled: parsed.enabled === true"), "the template's server no longer reports its own root/enabled flag")

  // 5) the case catalog is the index of record: this lane must be a row in
  //    SKILL.md and must be named there by its exact script path.
  const skillDoc = readFileSync(join(REPO, "skills", "dsh-qa", "SKILL.md"), "utf8")
  check(/\|\s*extension-template\s*\|/.test(skillDoc), "SKILL.md has no case-table row for extension-template")
  check(skillDoc.includes("scripts/extension-template.mjs"), "SKILL.md does not name scripts/extension-template.mjs")
  check(skillDoc.includes("scripts/extension-isolation.mjs"), "SKILL.md no longer names the shared extension helper")

  // 6) the boot really composes the row this case drives.
  const patch = readFileSync(join(REPO, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  check(/- id: mpd-ext\b/.test(patch), "the bundle patch does not carry the mpd-ext row")

  if (problems.length > 0) {
    for (const problem of problems) console.error("[" + SLUG + " self-test] FAIL: " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: shipped template loads with all four kinds + ships disabled + scaffold emits the four-kind copy this case boots (ids, flow cross-reference, persona and MCP name pinned) + SKILL.md row present")
}

async function runReal() {
  gatePrereqs({ slug: SLUG, prereqs: [
    { code: "absent-dsh-binary", probe: "dsh", remedy: "install DeepSeek Harness (dsh) on PATH", present: () => binaryPresent("dsh") },
    { code: "absent-runtime", probe: "packages/mpd-ext-plugin/dist/index.js", remedy: "bun build packages/mpd-ext-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/index.js", present: () => existsSync(join(REPO, "packages", "mpd-ext-plugin", "dist", "index.js")) },
    { code: "absent-fixture", probe: "templates/mpd-extension/mpd-ext.json", remedy: "restore the shipped authoring template (templates/mpd-extension/)", present: () => existsSync(join(TEMPLATE_DIR, "mpd-ext.json")) },
  ] })
  const ts = timestamp()
  const outDir = join(REPO, "evidence", "extensions", SLUG, ts)
  mkdirSync(outDir, { recursive: true })
  const box = createSandbox(SLUG)
  const logs = []
  const steps = {}
  do {
    const inst = await installProfile({ sandbox: box.sandbox, dshHome: box.dshHome, env: box.env })
    steps.install = { ok: inst.status === 0, exit: inst.status, tail: inst.out.slice(-400) }
    logs.push("=== install ===\n" + inst.out.slice(-2000))
    if (!steps.install.ok) break

    // 1) scaffold the template copy into the SANDBOX host plane (user plane: the
    //    only plane allowed to contribute mcp/roles), then enable it.
    const hostPlane = join(box.runHome, ".mpd", "extensions")
    mkdirSync(hostPlane, { recursive: true })
    const scaffolded = scaffoldCopy(hostPlane)
    const tree = scaffolded.ok ? treeOf(scaffolded.root) : []
    steps.scaffold = {
      ok: scaffolded.ok && scaffolded.enabled === true && tree.length >= 7,
      exit: scaffolded.run?.status ?? -1,
      root: scaffolded.root,
      templateId: templateToken(),
      templateEnabledFlagInRepo: templateManifest().enabled,
      sandboxEnabledFlag: scaffolded.manifest?.enabled ?? null,
      copyFiles: tree,
      cliStdout: String(scaffolded.run?.stdout ?? "").trim().slice(0, 400),
      note: "the repo template is never modified: the copy is written into the sandbox HOME plane and only its `enabled` flag is flipped (the template ships enabled:false so it can never be discovered from the repo)",
    }
    logs.push("=== scaffold ===\n" + String(scaffolded.run?.stdout ?? "") + String(scaffolded.run?.stderr ?? ""))
    if (!steps.scaffold.ok) break

    // 2) ONE real boot exercising all four kinds of the copy.
    const script = [
      { tool: "mpd_ext_list", args: {} },
      { tool: "skill", args: { name: SKILL_NAME } },
      { tool: "mpd_flow_show", args: { id: FLOW_ID } },
      { tool: "mpd_role_persona", args: { role: ROLE_NAME } },
      { tool: "mpd_role_spawn", args: { role: ROLE_NAME, task: "Reply with exactly " + CHILD_MARKER } },
      { tool: MCP_TOOL, args: {} },
      { text: "extension-template-done" },
    ]
    const stub = makeStubModel({
      script,
      childMarker: CHILD_MARKER,
      childAnswer: CHILD_MARKER + "-OK",
      childScript: [{ tool: "structured_output", args: { role: ROLE_NAME, summary: CHILD_MARKER + "-OK", recommendation: "none", details: "extension-template QA", evidence: [SKILL_NAME] } }],
      label: "template",
    })
    const port = await stub.listen()
    useStubRoute(box.dshHome, port)
    const run = await bootSession({ slug: SLUG, env: box.env, cwd: box.ws, prompt: "Use the scaffolded extension: list it, load its skill, show its flow, read its role persona, spawn that role once, then call its MCP tool.", stub })
    const names = ["mpd_ext_list", "skill", "mpd_flow_show", "mpd_role_persona", "mpd_role_spawn", MCP_TOOL]
    const evidence = sessionEvidence(box.dshHome, box.ws, names)
    await stub.close()
    keepRawSession(outDir, "template", evidence.store)
    logs.push("=== template arm (exit " + run.status + ", " + run.durationMs + "ms) ===\n" + run.out.slice(-6000))

    // Every assertion is bound to ITS OWN call result (a joined text would let one
    // call's output satisfy another call's claim).
    const results = toolResultsByCallId(evidence.store)
    const textOf = (name) => {
      const call = callsOf(evidence.store, name)[0]
      return call === undefined ? "" : (results.get(call.callId)?.text ?? "")
    }
    const offered = new Set(stub.trace.flatMap((entry) => entry.offeredTools))
    const headerTools = new Set(evidence.names)
    const mcpOffered = offered.has(MCP_TOOL) && headerTools.has(MCP_TOOL)
    const mcpCall = evidence.calls[MCP_TOOL]
    const manifestJson = JSON.stringify(scaffolded.manifest, null, 2)

    steps.skill = {
      ok: run.status === 0 && evidence.calls.skill?.succeeded === true && textOf("skill").includes("# " + SKILL_NAME),
      called: Boolean(evidence.calls.skill?.called),
      succeeded: Boolean(evidence.calls.skill?.succeeded),
      sawHeading: textOf("skill").includes("# " + SKILL_NAME),
      resultHead: textOf("skill").slice(0, 200),
    }
    steps.flow = {
      ok: run.status === 0 && evidence.calls.mpd_flow_show?.succeeded === true
        && textOf("mpd_flow_show").includes(FLOW_ID)
        && textOf("mpd_flow_show").includes(SKILL_NAME),
      called: Boolean(evidence.calls.mpd_flow_show?.called),
      succeeded: Boolean(evidence.calls.mpd_flow_show?.succeeded),
      sawFlowId: textOf("mpd_flow_show").includes(FLOW_ID),
      sawSkillCrossReference: textOf("mpd_flow_show").includes(SKILL_NAME),
      resultHead: textOf("mpd_flow_show").slice(0, 240),
    }
    steps.role = {
      ok: run.status === 0 && evidence.calls.mpd_role_persona?.succeeded === true
        && evidence.calls.mpd_role_spawn?.succeeded === true
        && textOf("mpd_role_persona").includes(ROLE_NAME)
        && textOf("mpd_role_persona").includes(EXT_NAME + " extension")
        && textOf("mpd_role_spawn").includes(CHILD_MARKER + "-OK"),
      personaCalled: Boolean(evidence.calls.mpd_role_persona?.called),
      personaSucceeded: Boolean(evidence.calls.mpd_role_persona?.succeeded),
      spawnCalled: Boolean(evidence.calls.mpd_role_spawn?.called),
      spawnSucceeded: Boolean(evidence.calls.mpd_role_spawn?.succeeded),
      sawRoleName: textOf("mpd_role_persona").includes(ROLE_NAME),
      childAnswered: textOf("mpd_role_spawn").includes(CHILD_MARKER + "-OK"),
      personaHead: textOf("mpd_role_persona").slice(0, 200),
    }
    steps.mcp = {
      // The copy's OWN stdio server (`server.mjs`) reports what the RUNNING host
      // sees: its id, its own root on disk, its enabled flag and all four kinds.
      // The result is read from the session log's non-error `tool/result`.
      ok: run.status === 0 && mcpOffered && mcpCall?.succeeded === true
        && textOf(MCP_TOOL).includes('"id": "' + EXT_ID + '"')
        && textOf(MCP_TOOL).includes(scaffolded.root)
        && textOf(MCP_TOOL).includes('"enabled": true')
        && ["skills", "flows", "mcp", "roles"].every((kind) => textOf(MCP_TOOL).includes('"' + kind + '"')),
      tool: MCP_TOOL,
      offeredInRequest: offered.has(MCP_TOOL),
      offeredInHeader: headerTools.has(MCP_TOOL),
      called: Boolean(mcpCall?.called),
      succeeded: Boolean(mcpCall?.succeeded),
      servedManifest: textOf(MCP_TOOL).includes('"id": "' + EXT_ID + '"'),
      servedOwnRoot: textOf(MCP_TOOL).includes(scaffolded.root),
      servedFourKinds: ["skills", "flows", "mcp", "roles"].every((kind) => textOf(MCP_TOOL).includes('"' + kind + '"')),
      resultHead: textOf(MCP_TOOL).slice(0, 400),
      manifestHead: manifestJson.slice(0, 200),
    }
    steps.listed = {
      ok: run.status === 0 && evidence.calls.mpd_ext_list?.succeeded === true && textOf("mpd_ext_list").includes(EXT_ID),
      sawCopy: textOf("mpd_ext_list").includes(EXT_ID),
      resultHead: textOf("mpd_ext_list").slice(0, 300),
    }
    steps.containment = {
      ok: run.status === 0 && crashSignatures(run.out).length === 0,
      exit: run.status,
      durationMs: run.durationMs,
      crashSignatures: crashSignatures(run.out),
      offeredTemplateTools: [...offered].filter((name) => name.startsWith("mcp__" + MCP_SERVER + "__")),
      isolation: isolationStep(box.dshHome, box.sandbox, SLUG),
    }
  } while (false)
  steps.isolationFinal = isolationStep(box.dshHome, box.sandbox, SLUG)
  const ok = Object.values(steps).every((step) => step.ok === true)
  writeEvidence(outDir, SLUG, {
    ok,
    sandbox: box.sandbox,
    subject: "templates/mpd-extension copied by `bun scripts/mpd-ext.mjs scaffold " + EXT_NAME + " --with-mcp` into the sandbox host plane",
    arms: "scaffold (the copy, its file tree and the recorded enabled flip) | skill (the `skill` tool answers with the copy's SKILL.md) | flow (mpd_flow_show answers with the copy's flow, cross-referencing the copy's skill) | role (mpd_role_persona answers AND mpd_role_spawn really starts a child) | mcp (the copy's own stdio server publishes " + MCP_TOOL + " and answers a real call) | containment (no apply-crash signature, session + workspace isolation)",
    steps,
  }, logs.join("\n\n"))
  cleanup(box.sandbox)
  process.exit(ok ? 0 : 1)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) await selfTest()
  else await runReal()
}
