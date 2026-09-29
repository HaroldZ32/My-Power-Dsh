#!/usr/bin/env node
// Case extension-lifecycle: the MPD extension interface, end to end, on a REAL
// mounted boot in isolation.
//
// WHAT CARRIES THE PROOF
//   1. a REAL `dsh` process (mpd-headless rows composed from THIS checkout,
//      sandboxed DSH_HOME + HOME + session cwd). The model step is answered by a
//      local OpenAI-shaped stub (see extension-isolation.mjs), so the tool calls
//      are really executed by the session and need no provider credential.
//   2. every claim is read from the HARNESS's own session log
//      (`lib/session-evidence.mjs`: `tool/call` + non-error `tool/result`, and
//      `request/header.header.tools[]` for the offered tool list) — never from
//      the model's prose.
//   3. the data plane is exercised the way an author uses it: a directory with
//      `mpd-ext.json` dropped into `<sandbox-ws>/.mpd/extensions/`, discovered
//      PER CALL, plus a user-plane extension for the kinds the project plane is
//      forbidden to contribute (roles; `mcp`/`roles` there are rejected per item
//      by design — C14).
//
// ARMS
//   main            — the project extension is LISTED, its flow is discoverable
//                     and loadable, its skill is served through the catalog, and
//                     the user-plane extension's role answers mpd_role_persona
//                     AND really spawns (the stub answers the child).
//   failure         — one deliberately broken extension of each kind sits next to
//                     a healthy one: the boot stays green, the session still
//                     completes a turn (the malformed skill candidates must not
//                     break the pre-step), and every broken item is REPORTED
//                     per item. The extension CLI is used as an independent
//                     oracle over the same directories.
//   isolation       — two sessions on ONE host root, different cwds, plus a
//                     two-sided control (a decoy extension in the LAUNCHER cwd is
//                     visible to no session; the same decoy IS listed when a
//                     session's own cwd is that directory).
//   packed          — packs into a SCRATCH out-dir and asserts the packed tree is
//                     CLOSED: `PLUGIN_PKGS` carries `mpd-ext-plugin`
//                     (scripts/pack-mpd.mjs:42), `cpAssets()` copies
//                     `<bundle>/extensions/` (scripts/pack-mpd.mjs:93-98) and the
//                     packed patch carries the `mpd-ext` row. The arm's `ok` is
//                     the pure predicate `packedStateOk()` — FALSE when the row,
//                     the plugin or the discovery root is missing, so a green
//                     exit can never accompany a red packed state. Because the
//                     archived RED this lane once recorded was a property of that
//                     older tree (not of this case), the predicate is proven
//                     falsifiable on every run by a NEGATIVE CONTROL over fixture
//                     packed trees (closed vs. each asset removed), recorded in
//                     result.json and re-run in --self-test.
//                     T-85: the arm NEVER writes the canonical `dist/mpd-package`.
//                     The rule it implements is "the artifact has exactly ONE
//                     writer at a time". Route, in order of preference:
//                     (1) the packer's own sanctioned `--out <dir>` flag
//                     (`scripts/pack-mpd.mjs`, whose own docstring says that flag
//                     exists FOR this lane change); (2) the t70 scratch-COPY
//                     fallback, used only when the packer source carries no `--out`
//                     (copy + exactly two rewritten path constants + a REFUSAL on
//                     a drifted packer). The route actually taken is recorded in
//                     result.json, and the canonical artifact's content STAMP is
//                     read before and after the arm and must be identical, so a
//                     lane run that moved the delivered artifact could not report
//                     green.
//
// PREREQ: absent-dsh-binary dsh "install DeepSeek Harness (dsh) on PATH"
// PREREQ: absent-runtime packages/mpd-ext-plugin/dist/index.js "bun build packages/mpd-ext-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/index.js"
//
// --self-test is offline: descriptor-contract fixtures (including the code-plane
// NaN rank that JSON cannot express), the CLI negative control, the stub
// protocol, and the composed-row/CLI wiring. Evidence ->
// evidence/extensions/extension-lifecycle/<ts>/{result.json,output.log}.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  FLOW_JSON, PERSONA_MD, REPO, SKILL_MD, binaryPresent, bootSession, callsOf, crashSignatures, createSandbox,
  cleanup, gatePrereqs, installProfile, isolationArm, isolationStep, keepRawSession, manifest, makeStubModel,
  runAsync, sessionEvidence, timestamp, toolResultsByCallId, useStubRoute, writeEvidence, writeExtension,
} from "./extension-isolation.ts"

export const SLUG = "extension-lifecycle"

const PROJ_ID = "qa-ext-proj"
const USER_ID = "qa-ext-user"
const HEALTHY_ID = "qa-ext-healthy"
const SKILL_NAME = "qa-ext-skill"
const FLOW_ID = "qa-ext-flow"
const ROLE_NAME = "QA Extension Reviewer"
const PERSONA_MARKER = "QA-MARKER-PERSONA-USER"
const SKILL_MARKER = "QA-MARKER-SKILL-PROJ"
const FLOW_MARKER = "QA-MARKER-FLOW-PROJ"
const ROLE_CHILD_MARKER = "QA-CHILD-MARKER-ROLE"
const PROJECT_REJECTION = "project-level extensions may contribute skills and flows only"


/**
 * The regression test that WOULD HAVE CAUGHT the seam defect (measured
 * 2026-09-14): the built row must DECLARE the seams it registers through, and a
 * boot whose seams are unavailable must be LOUD on stdout and must never print
 * the success summary. Both halves fail on the pre-fix artifact (`inject: []`
 * plus an unconditional success line) and pass on the fixed one, so this is a
 * real falsifiable check rather than a re-statement of the fix.
 */
async function seamRegressionCheck(artifactPath) {
  const distPath = artifactPath ?? join(REPO, "packages", "mpd-ext-plugin", "dist", "index.js")
  if (!existsSync(distPath)) return "the built plugin dist is missing: " + distPath
  const dist = await import(pathToFileURL(distPath).href + "?v=" + Date.now())
  if (!Array.isArray(dist.inject) || !dist.inject.includes("tools") || !dist.inject.includes("skills")) {
    return "the built row must declare the seams it registers through (inject must include tools and skills; got " + JSON.stringify(dist.inject) + ")"
  }
  const captured = []
  const originalLog = console.log
  console.log = (...args) => { captured.push(args.map((part) => String(part)).join(" ")) }
  try {
    // HOSTILE ctx: the services are NOT plain properties and get() resolves
    // nothing — the exact composition that used to fail with no visible line.
    const ctx = { logger: { warn: () => {} }, get: () => undefined, provide: () => {} }
    await dist.apply(ctx, {})
  } catch (error) {
    console.log = originalLog
    return "apply threw out of the row (it must contain every failure): " + String(error && error.message ? error.message : error)
  } finally {
    console.log = originalLog
  }
  const text = captured.join("\n")
  if (!/FATAL/.test(text)) return "an unavailable seam must be reported LOUDLY on stdout, not only through ctx.logger.warn"
  if (/mpdExtensions provided/.test(text)) return "the success summary must never be printed when the four tools did not register"
  return undefined
}

async function selfTest() {
  const problems = []
  const check = (condition, message) => { if (!condition) problems.push(message) }

  // 1) the bundle really composes the row this case boots.
  const patch = readFileSync(join(REPO, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  check(/- id: mpd-ext\b/.test(patch), "the bundle patch does not carry the mpd-ext row")
  check(patch.includes("packages/mpd-ext-plugin/dist/index.js"), "the mpd-ext row does not point at the plugin dist")
  const installer = readFileSync(join(REPO, "scripts", "install-profile.mjs"), "utf8")
  check(installer.includes('"mpd-ext"'), "install-profile.mjs does not write the mpd-ext row")

  // 2) the descriptor contract rejects what this case's failure arm relies on,
  //    including the code-plane `rank: NaN` that a JSON manifest cannot express.
  const registry = join(REPO, "packages", "mpd-ext-plugin", "src", "registry.ts")
  check(existsSync(registry), "the runtime validator source is missing")
  if (existsSync(registry)) {
    const result = spawnSync("bun", ["-e", [
      'import { validateDescriptor } from "' + registry + '"',
      'const bad = validateDescriptor({ apiVersion: 1, id: "x", contributes: { skills: [{ root: "skills", rank: Number.NaN }], flows: [{ dir: "../escape" }] } })',
      'const version = validateDescriptor({ apiVersion: 9, id: "x" })',
      'const noId = validateDescriptor({ apiVersion: 1 })',
      'console.log(JSON.stringify({ skills: bad.descriptor?.contributes.skills.length, flows: bad.descriptor?.contributes.flows.length, reasons: bad.errors.map((e) => e.item), versionRejected: version.rejected, noIdRejected: noId.rejected }))',
    ].join("; ")], { encoding: "utf8", timeout: 120000 })
    check(result.status === 0, "the validator probe failed: " + (result.stderr ?? "").slice(0, 200))
    let parsed = {}
    try { parsed = JSON.parse((result.stdout ?? "").trim()) } catch { /* reported below */ }
    check(parsed.skills === 0, "a NaN rank must reject the skills item")
    check(parsed.flows === 0, "an escaping flows dir must reject the flows item")
    check(parsed.versionRejected === true, "apiVersion 9 must reject the descriptor")
    check(parsed.noIdRejected === true, "a missing id must reject the descriptor")
  }

  // 3) the extension developer CLI is a working independent oracle.
  const cli = join(REPO, "scripts", "mpd-ext.mjs")
  check(existsSync(cli), "the extension developer CLI (scripts/mpd-ext.mjs) is missing")
  if (existsSync(cli)) {
    const okRun = spawnSync("bun", [cli, "validate", join(REPO, "extensions", "mpd-ext-example")], { encoding: "utf8", timeout: 120000 })
    check(okRun.status === 0, "the CLI must accept the shipped example (exit " + okRun.status + ")")
  }

  // 4) the fixtures this case writes are contract-shaped, and the skill fixture
  //    is a servable candidate (non-empty description).
  const projectManifest = manifest(PROJ_ID, { skills: [{ root: "skills" }], flows: [{ dir: "flows" }] })
  check(projectManifest.apiVersion === 1, "the fixture manifest must declare apiVersion 1")
  check(FLOW_JSON(FLOW_ID, "QA flow", FLOW_MARKER).id === FLOW_ID, "the flow fixture must carry the requested id")
  check(FLOW_JSON(FLOW_ID, "QA flow", FLOW_MARKER).steps.length > 0, "the flow fixture must carry steps")
  check(SKILL_MD(SKILL_NAME, SKILL_MARKER).includes(SKILL_MARKER), "the skill fixture must carry its marker")
  check(/description: ".+"/.test(SKILL_MD(SKILL_NAME, SKILL_MARKER)), "the skill fixture must declare a non-empty description")

  // 5) the regression test for the seam defect (declared seams + loud failure +
  //    no false success claim), proven FALSIFIABLE: the same check must go RED on
  //    a mutated copy of the built artifact (the pre-fix `inject: []`, and a
  //    forced success branch). A check that cannot fail proves nothing.
  const seamProblem = await seamRegressionCheck()
  check(seamProblem === undefined, String(seamProblem))

  const distSource = readFileSync(join(REPO, "packages", "mpd-ext-plugin", "dist", "index.js"), "utf8")
  const mutations = [
    { name: "pre-fix inject", from: "var inject = [...REQUIRED_SEAMS];", to: "var inject = [];" },
    { name: "forced success branch", from: "if (missingTools.length > 0) {", to: "if (false) {" },
  ]
  const mutateDir = mkdtempSync(join(tmpdir(), "mpd-ext-mutant-"))
  try {
    for (const mutation of mutations) {
      if (!distSource.includes(mutation.from)) {
        check(false, "mutation anchor missing from the bundle (" + mutation.name + "): " + mutation.from)
        continue
      }
      const mutantPath = join(mutateDir, mutation.name.replace(/[^a-z0-9]+/gi, "-") + ".mjs")
      writeFileSync(mutantPath, distSource.replace(mutation.from, mutation.to))
      const red = await seamRegressionCheck(mutantPath)
      check(red !== undefined, "the seam check must go RED on the "+ mutation.name + " mutant, but it passed")
    }
  } finally {
    rmSync(mutateDir, { recursive: true, force: true })
  }

  // 6) F9 FALSIFIABILITY (offline, temp dirs only): the packed-tree predicate the
  //    real arm gates on must be FALSE for every broken fixture tree — otherwise
  //    "the packed tree is closed" would be a claim no tree could contradict.
  const negative = packedNegativeDriver()
  check(negative.falsifiable, "the packed predicate is not falsifiable: " + JSON.stringify(negative.trees))
  check(negative.packerExitGated, "a non-zero packer exit must fail the packed predicate")
  check(negative.trees.closed.ok === true && Object.keys(negative.trees).length === 4, "the negative driver must build one closed tree and three broken ones")

  // 7) T-85 FALSIFIABILITY (offline): the ROUTE CHOICE must react to the packer's own source, and the
  //    copy fallback must rewrite exactly two anchors and REFUSE a drifted packer. Driven over synthetic
  //    sources ON PURPOSE: asserting against the LIVE packer's shape reddened this lane the moment the
  //    packer legitimately changed (measured 2026-09-17, when `--out` landed and this arm threw).
  const scratchFixture = join(tmpdir(), "mpd-scratch-pack-fixture")
  const withOutFlag = ['const flag = argv.indexOf("--out")', "const outDir = OUT.dir", ""].join("\n")
  const legacyTwoAnchors = [
    "const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))",
    'const outDir = join(repoRoot, "dist", "mpd-package")',
    "",
  ].join("\n")
  check(choosePackRoute(withOutFlag) === "flag", "a packer exposing --out must route through the sanctioned flag")
  check(choosePackRoute(legacyTwoAnchors) === "copy", "a packer WITHOUT --out must fall back to the scratch COPY route")
  const patchedLegacy = patchPackerSource(legacyTwoAnchors, { repo: REPO, out: scratchFixture })
  check(patchedLegacy.refused === false && patchedLegacy.patched.length === 2, "the copy route must rewrite exactly two anchors: " + JSON.stringify(patchedLegacy))
  check(patchedLegacy.text.includes(JSON.stringify(scratchFixture)), "the patched copy must point at the scratch out-dir")
  check(!patchedLegacy.text.includes('join(repoRoot, "dist", "mpd-package")'), "the patched copy must no longer point at the canonical dist/mpd-package")
  const driftedPackerSource = legacyTwoAnchors.replace(/^const outDir = .*$/m, "const outDir = join(repoRoot, 'somewhere', 'else')")
  const patchedDrifted = patchPackerSource(driftedPackerSource, { repo: REPO, out: scratchFixture })
  check(patchedDrifted.refused === true && /outDir/.test(patchedDrifted.reason), "a drifted packer must be REFUSED, never patched: " + JSON.stringify(patchedDrifted))
  const anchorlessPacker = patchPackerSource("// a packer that carries neither anchor\n", { repo: REPO, out: scratchFixture })
  check(anchorlessPacker.refused === true, "a packer source with no anchors must be refused")
  // The LIVE packer is READ and RECORDED, never asserted: a packer change must not redden this lane.
  console.log("[self-test] live packer route = " + choosePackRoute(readFileSync(PACKER, "utf8")) + " (recorded, not asserted)")

  if (problems.length > 0) {
    for (const problem of problems) console.error("[" + SLUG + " self-test] FAIL: " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: composed row + validator rejections (incl. NaN rank via the code plane) + CLI oracle + seam regression (inject declared, failure LOUD, no false success) + packed predicate falsifiable (closed vs. three broken fixture trees) + T-85 scratch-pack patcher (two anchors rewritten, a drifted packer REFUSED) + fixtures verified")
}

// ── arms ────────────────────────────────────────────────────────────────────

async function mainArm({ box, outDir, logs }) {
  const projectSkills = join(box.ws, ".mpd", "extensions")
  writeExtension(projectSkills, PROJ_ID, manifest(PROJ_ID, {
    skills: [{ root: "skills" }],
    flows: [{ dir: "flows" }],
    // Both kinds below are ILLEGAL in the project plane (process-global
    // registration cannot be scoped to a session): they must be rejected per
    // item with the stated reason and contribute nothing.
    mcp: [{ serverName: "qa_proj_mcp", transport: "stdio", command: "node" }],
    roles: [{ name: "QA Project Role", persona: "persona.md" }],
  }), {
    skills: { [SKILL_NAME]: SKILL_MD(SKILL_NAME, SKILL_MARKER) },
    flows: { [FLOW_ID + ".json"]: FLOW_JSON(FLOW_ID, "QA extension flow", FLOW_MARKER) },
    files: { "persona.md": PERSONA_MD("PROJ") },
  })
  writeExtension(join(box.runHome, ".mpd", "extensions"), USER_ID, manifest(USER_ID, {
    skills: [{ root: "skills" }],
    roles: [{ name: ROLE_NAME, description: "QA extension role", readonly: true, persona: "persona.md" }],
  }), {
    skills: { "qa-ext-user-skill": SKILL_MD("qa-ext-user-skill", "USER") },
    files: { "persona.md": PERSONA_MD(PERSONA_MARKER) },
  })

  const script = [
    { tool: "mpd_ext_list", args: {} },
    { tool: "mpd_ext_show", args: { id: PROJ_ID } },
    { tool: "mpd_flow_list", args: {} },
    { tool: "mpd_flow_show", args: { id: FLOW_ID } },
    { tool: "skill", args: { name: SKILL_NAME } },
    { tool: "mpd_role_persona", args: { role: ROLE_NAME } },
    { tool: "mpd_role_spawn", args: { role: ROLE_NAME, task: "Reply with exactly " + ROLE_CHILD_MARKER } },
    { text: "lifecycle-main-done" },
  ]
  // A spawned role child must report through the harness's `structured_output`
  // tool (the subagent driver attaches it), so the stub drives that call — an
  // empty summary would otherwise look like a successful spawn with no child turn.
  const stub = makeStubModel({
    script,
    childMarker: ROLE_CHILD_MARKER,
    childAnswer: ROLE_CHILD_MARKER + "-OK",
    childScript: [{ tool: "structured_output", args: { role: ROLE_NAME, summary: ROLE_CHILD_MARKER + "-OK", recommendation: "none", details: "extension-lifecycle QA", evidence: ["mpd_role_spawn"] } }],
    label: "lifecycle-main",
  })
  const port = await stub.listen()
  useStubRoute(box.dshHome, port)
  const run = await bootSession({ slug: SLUG, env: box.env, cwd: box.ws, prompt: "Run the extension inspection calls in order, then report what you saw.", stub })
  const names = ["mpd_ext_list", "mpd_ext_show", "mpd_flow_list", "mpd_flow_show", "skill", "mpd_role_persona", "mpd_role_spawn"]
  const evidence = sessionEvidence(box.dshHome, box.ws, names)
  await stub.close()
  keepRawSession(outDir, "main", evidence.store)
  logs.push("=== main arm (exit " + run.status + ", " + run.durationMs + "ms) ===\n" + run.out.slice(-6000))
  // Bind every assertion to ITS OWN call result: `findToolCall().resultText` joins
  // the results of every call of that tool name, which would let one call's text
  // satisfy another call's assertion.
  const results = toolResultsByCallId(evidence.store)
  const text = (name) => {
    const call = callsOf(evidence.store, name)[0]
    return call === undefined ? "" : (results.get(call.callId)?.text ?? "")
  }
  const offered = stub.trace[0]?.offeredTools ?? []
  return {
    ok: run.status === 0
      && names.every((name) => evidence.calls[name]?.succeeded === true)
      && text("mpd_ext_list").includes(PROJ_ID)
      && text("mpd_ext_list").includes(USER_ID)
      && text("mpd_ext_list").includes(PROJECT_REJECTION)
      && text("mpd_flow_show").includes(FLOW_MARKER)
      && text("skill").includes(SKILL_MARKER)
      && text("mpd_role_persona").includes(PERSONA_MARKER)
      && text("mpd_role_spawn").includes(ROLE_CHILD_MARKER + "-OK"),
    exit: run.status,
    durationMs: run.durationMs,
    offeredExtTools: offered.filter((name) => name.startsWith("mpd_ext_") || name.startsWith("mpd_flow_")),
    recordedTools: names.filter((name) => evidence.names.includes(name)),
    calls: Object.fromEntries(names.map((name) => [name, {
      succeeded: Boolean(evidence.calls[name]?.succeeded),
      reason: evidence.calls[name]?.reason ?? "",
      resultHead: text(name).slice(0, 240),
    }])),
    sawProjectId: text("mpd_ext_list").includes(PROJ_ID),
    sawUserId: text("mpd_ext_list").includes(USER_ID),
    sawProjectRejection: text("mpd_ext_list").includes(PROJECT_REJECTION),
    sawFlow: text("mpd_flow_show").includes(FLOW_MARKER),
    sawSkill: text("skill").includes(SKILL_MARKER),
    sawPersona: text("mpd_role_persona").includes(PERSONA_MARKER),
    sawRoleChild: text("mpd_role_spawn").includes(ROLE_CHILD_MARKER + "-OK"),
    crashSignatures: crashSignatures(run.out),
    isolation: isolationStep(box.dshHome, box.sandbox, SLUG + ":main"),
  }
}

async function failureArm({ box, outDir, logs }) {
  const root = join(box.ws, ".mpd", "extensions")
  writeExtension(root, "qa-bad-json", "{ this is not json")
  writeExtension(root, "qa-bad-version", { apiVersion: 9, id: "qa-bad-version", contributes: {} })
  writeExtension(root, "qa-bad-skill", manifest("qa-bad-skill", { skills: [{ root: "skills" }], flows: [{ dir: "flows", rank: "300" }] }), {
    skills: {
      "qa-good-sibling": SKILL_MD("qa-good-sibling", "SIBLING"),
      "qa-broken-empty": SKILL_MD("qa-broken-empty", "BROKEN", ""),
      "QA-BAD-NAME": SKILL_MD("QA-BAD-NAME", "BROKEN"),
    },
  })
  writeExtension(root, "qa-bad-asset", manifest("qa-bad-asset", { skills: [{ root: "../escape" }] }))
  writeExtension(root, HEALTHY_ID, manifest(HEALTHY_ID, { skills: [{ root: "skills" }], flows: [{ dir: "flows" }] }), {
    skills: { "qa-ext-healthy-skill": SKILL_MD("qa-ext-healthy-skill", "HEALTHY") },
    flows: { "qa-ext-healthy-flow.json": FLOW_JSON("qa-ext-healthy-flow", "Healthy flow", "HEALTHY-FLOW") },
  })
  writeExtension(root, "qa-project-host-kinds", manifest("qa-project-host-kinds", {
    skills: [{ root: "skills" }],
    mcp: [{ serverName: "qa_proj_only", transport: "stdio", command: "node" }],
    roles: [{ name: "QA Project Only", persona: "persona.md" }],
  }), { skills: { "qa-project-host-kind-skill": SKILL_MD("qa-project-host-kind-skill", "PROJHOST") }, files: { "persona.md": PERSONA_MD("PROJONLY") } })

  const stub = makeStubModel({
    script: [
      { tool: "mpd_ext_list", args: {} },
      { tool: "mpd_flow_list", args: {} },
      { tool: "mpd_flow_show", args: { id: "qa-ext-healthy-flow" } },
      { text: "lifecycle-failure-done" },
    ],
    label: "lifecycle-failure",
  })
  const port = await stub.listen()
  useStubRoute(box.dshHome, port)
  const run = await bootSession({ slug: SLUG, env: box.env, cwd: box.ws, prompt: "List the extensions, the flows and show the healthy flow.", stub })
  const evidence = sessionEvidence(box.dshHome, box.ws, ["mpd_ext_list", "mpd_flow_list", "mpd_flow_show"])
  await stub.close()
  keepRawSession(outDir, "failure", evidence.store)
  logs.push("=== failure arm (exit " + run.status + ") ===\n" + run.out.slice(-6000))
  const listed = evidence.calls.mpd_ext_list?.resultText ?? ""

  // The CLI is an independent oracle over the SAME directories: it must accept
  // the healthy extension and reject each broken one per item.
  const cli = join(REPO, "scripts", "mpd-ext.mjs")
  const cliChecks = {}
  for (const id of ["qa-bad-json", "qa-bad-version", "qa-bad-skill", "qa-bad-asset", HEALTHY_ID]) {
    const result = spawnSync("bun", [cli, "validate", join(root, id)], { encoding: "utf8", timeout: 120000 })
    cliChecks[id] = { exit: result.status, tail: ((result.stderr ?? "") + (result.stdout ?? "")).trim().split("\n").slice(-2).join(" | ").slice(0, 200) }
  }
  return {
    ok: run.status === 0
      && Boolean(evidence.calls.mpd_ext_list?.succeeded)
      && Boolean(evidence.calls.mpd_flow_list?.succeeded)
      && Boolean(evidence.calls.mpd_flow_show?.succeeded)
      && listed.includes(HEALTHY_ID)
      && evidence.calls.mpd_flow_show.resultText.includes("HEALTHY-FLOW")
      && listed.includes("qa-bad-version")
      && listed.includes("rejected")
      && listed.includes(PROJECT_REJECTION)
      && cliChecks[HEALTHY_ID].exit === 0
      && ["qa-bad-json", "qa-bad-version", "qa-bad-skill", "qa-bad-asset"].every((id) => cliChecks[id].exit === 1),
    exit: run.status,
    sessionCompleted: run.status === 0,
    listedHealthy: listed.includes(HEALTHY_ID),
    flowToolStillWorks: evidence.calls.mpd_flow_show?.resultText.includes("HEALTHY-FLOW") ?? false,
    reportedProjectRejection: listed.includes(PROJECT_REJECTION),
    reportedRejections: ["qa-bad-json", "qa-bad-version"].filter((id) => listed.includes(id)),
    cliChecks,
    crashSignatures: crashSignatures(run.out),
    resultHead: listed.slice(0, 600),
    isolation: isolationStep(box.dshHome, box.sandbox, SLUG + ":failure"),
  }
}

const PACKER = join(REPO, "scripts", "pack-mpd.mjs")
const CANONICAL_PACKED = join(REPO, "dist", "mpd-package")

/** sha256 of a text/blob, the same digest shape the QA lanes use elsewhere. */
function digest(text) {
  return createHash("sha256").update(text).digest("hex")
}

/** sha256 of a file's bytes, or null when the file is absent. */
function fileSha(path) {
  return existsSync(path) ? digest(readFileSync(path)) : null
}

/**
 * T-85: a cheap, deterministic STAMP of the canonical packed artifact — the file count plus the two
 * files that define the packed tree. A reader can recompute it without trusting this lane, which is
 * what makes "the lane did not move the delivered artifact" checkable instead of asserted.
 */
export function canonicalArtifactStamp(root = CANONICAL_PACKED) {
  if (!existsSync(root)) return { present: false, root, files: 0, manifestSha256: null, patchSha256: null }
  let files = 0
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name))
      else files += 1
    }
  }
  walk(root)
  return {
    present: true,
    root,
    files,
    manifestSha256: fileSha(join(root, "package.json")),
    patchSha256: fileSha(join(root, "cordis.patch.yml")),
  }
}

/**
 * T-85 / t70 `scratch-pack.mjs` pattern: rewrite EXACTLY the two path constants of the real packer
 * (`repoRoot`, `outDir`) and REFUSE when either anchor does not match exactly once — a drifted packer
 * fails loudly instead of silently packing from something else. Pure (no IO), so --self-test drives it
 * over the real source and a deliberately drifted one.
 */
export function patchPackerSource(source, { repo, out }) {
  const anchors = [
    { name: "repoRoot", re: /^const repoRoot = dirname\(dirname\(fileURLToPath\(import\.meta\.url\)\)\)$/, replacement: "const repoRoot = " + JSON.stringify(repo) },
    { name: "outDir", re: /^const outDir = join\(repoRoot, "dist", "mpd-package"\)$/, replacement: "const outDir = " + JSON.stringify(out) },
  ]
  const lines = source.split("\n")
  const patched = []
  for (const anchor of anchors) {
    const hits = lines.map((line, index) => (anchor.re.test(line) ? index : -1)).filter((index) => index >= 0)
    if (hits.length !== 1) {
      return {
        refused: true,
        reason: "anchor `" + anchor.name + "` matched " + hits.length + " line(s), expected exactly 1 — refusing to patch a packer that has drifted",
        anchors: anchors.map((entry) => entry.name),
      }
    }
    patched.push(hits[0])
    lines[hits[0]] = anchor.replacement
  }
  return { refused: false, patched, anchors: anchors.map((entry) => entry.name), text: lines.join("\n") }
}

/**
 * T-85 route choice — PREFERENCE ORDER, decided from the packer's OWN source so the lane cannot
 * silently keep staging into a canonical dir: the sanctioned `--out <dir>` flag when the packer
 * exposes it, else the t70 scratch-COPY fallback. Pure, so --self-test drives it both ways.
 */
export function choosePackRoute(source) {
  return /indexOf\("--out"\)/.test(source) ? "flag" : "copy"
}

/**
 * Run the REAL packer against a SCRATCH out-dir. The canonical `dist/mpd-package` is never a target:
 * route (1) is the packer's own `--out <dir>`; route (2) is the t70 copy, used only when the flag is
 * absent. The route taken is recorded in the arm's result.
 */
async function scratchPack({ outDir, logs }) {
  const source = readFileSync(PACKER, "utf8")
  const scratchRoot = join(outDir, "scratch-pack")
  const scratchOut = join(scratchRoot, "mpd-package")
  mkdirSync(scratchRoot, { recursive: true })
  const route = choosePackRoute(source)
  if (route === "flag") {
    const run = await runAsync(process.execPath, [PACKER, "--out", scratchOut], { cwd: REPO, timeoutMs: 900000 })
    logs.push("=== scratch pack via the sanctioned --out flag (exit " + run.status + ", out-dir " + scratchOut + ") ===\n" + run.out.slice(-3000))
    return { refused: false, route, run, packedRoot: scratchOut, scratchRoot, packerSha256: digest(source).slice(0, 16), packerSupportsOut: true }
  }
  const patched = patchPackerSource(source, { repo: REPO, out: scratchOut })
  if (patched.refused) {
    logs.push("=== scratch pack REFUSED (copy route) ===\n" + patched.reason)
    return { refused: true, route, reason: patched.reason, scratchRoot, packerSha256: digest(source).slice(0, 16), packerSupportsOut: false }
  }
  const scratchPacker = join(scratchRoot, "pack-mpd.scratch.mjs")
  writeFileSync(scratchPacker, patched.text)
  const run = await runAsync(process.execPath, [scratchPacker], { cwd: REPO, timeoutMs: 900000 })
  logs.push("=== scratch pack via the copy fallback (exit " + run.status + ", out-dir " + scratchOut + ") ===\n" + run.out.slice(-3000))
  logs.push("=== scratch packer provenance ===\nrepoRoot+outDir rewritten only; other lines byte-identical ("
    + (patched.text.split("\n").length - 2) + " of " + patched.text.split("\n").length + " lines unchanged); packer sha "
    + digest(source).slice(0, 16) + " -> patched sha " + digest(patched.text).slice(0, 16))
  return {
    refused: false,
    run,
    packedRoot: scratchOut,
    scratchRoot,
    scratchPacker,
    packerSha256: digest(source).slice(0, 16),
    patchedSha256: digest(patched.text).slice(0, 16),
  }
}

async function packedArm({ outDir, logs }) {
  const canonicalBefore = canonicalArtifactStamp()
  const scratch = await scratchPack({ outDir, logs })
  const packed = scratch.refused ? null : scratch.packedRoot
  const facts = packed === null ? { hasRow: false, hasPlugin: false, hasExtensions: false } : packedStateOf(packed)
  const negative = packedNegativeDriver()
  const canonicalAfter = canonicalArtifactStamp()
  const canonicalUnmoved = JSON.stringify(canonicalBefore) === JSON.stringify(canonicalAfter)
  logs.push("=== packed negative control (fixture trees) ===\n" + JSON.stringify(negative.trees, null, 2))
  logs.push("=== canonical artifact stamp (before/after) ===\n" + JSON.stringify({ canonicalBefore, canonicalAfter, canonicalUnmoved }, null, 2))
  const packExit = scratch.refused ? null : scratch.run.status
  return {
    ok: scratch.refused === false
      && packedStateOk({ packExit, hasRow: facts.hasRow, hasPlugin: facts.hasPlugin, hasExtensions: facts.hasExtensions })
      && negative.falsifiable
      && canonicalUnmoved,
    route: (scratch.route === "flag"
      ? "sanctioned `--out <dir>` flag on scripts/pack-mpd.mjs (the packer's own documented route for this lane change): no copy, no rewritten constant"
      : "t70 scratch-COPY fallback (the packer source carries no `--out`): copy + rewrite repoRoot+outDir only + refuse a drifted packer"),
    packerSupportsOut: scratch.packerSupportsOut,
    packExit,
    packedRoot: packed,
    scratch: {
      root: scratch.scratchRoot,
      packer: scratch.scratchPacker ?? null,
      packerSha256: scratch.packerSha256,
      patchedSha256: scratch.patchedSha256 ?? null,
      refused: scratch.refused,
      reason: scratch.reason ?? null,
    },
    canonical: {
      before: canonicalBefore,
      after: canonicalAfter,
      unmoved: canonicalUnmoved,
      rule: "the artifact has exactly ONE writer at a time (T-85): this lane is not a writer for dist/mpd-package, and a movement across the arm would be visible here",
    },
    rows: { mpdExtRowInPackedPatch: facts.hasRow },
    assets: { pluginDist: facts.hasPlugin, extensionsAsset: facts.hasExtensions },
    // The predicate above is the gate: FALSIFIABLE by construction, because the
    // same function is driven over fixture trees that each miss one fact.
    negativeControl: negative,
    status: facts.hasRow && facts.hasPlugin && facts.hasExtensions
      ? "GREEN (the SCRATCH packed tree carries the mpd-ext row, the plugin and the extensions/ discovery root)"
      : "RED (the scratch packed tree is missing the mpd-ext row, the plugin and/or the extensions/ discovery root — scripts/pack-mpd.mjs must never exit 0 for such a tree, and this case now exits 1 with it)",
    note: "the packed arms read and write a SCRATCH tree under this run's evidence dir; the canonical dist/mpd-package is only stamped (read), never written, by this case",
    packTail: scratch.refused ? scratch.reason : scratch.run.out.trim().split("\n").slice(-3).join(" | ").slice(0, 300),
  }
}

// ── packed-tree contract + its negative driver ──────────────────────────────

/**
 * The packed-tree contract as a PURE predicate (F9): a packed tree is closed only
 * when the packer exited 0 AND the packed patch carries the `mpd-ext` row AND the
 * plugin package AND the `<bundle>/extensions/` discovery root are both present.
 *
 * It is a function of facts, never of this case's expectation: the archived `ok`
 * used to be `... && (hasPlugin && hasExtensions ? true : red)`, which was TRUE in
 * BOTH states, so exit 0 could accompany a red packed tree. Exported so the
 * negative driver below (and the offline `--self-test`) can falsify it directly.
 */
export function packedStateOk({ packExit, hasRow, hasPlugin, hasExtensions }) {
  return packExit === 0 && hasRow === true && hasPlugin === true && hasExtensions === true
}

/** The three facts the predicate reads, derived from ONE tree on disk. */
export function packedStateOf(root) {
  const patchPath = join(root, "cordis.patch.yml")
  const hasRow = existsSync(patchPath) && /- id: mpd-ext\b/.test(readFileSync(patchPath, "utf8"))
  return {
    hasRow,
    hasPlugin: existsSync(join(root, "packages", "mpd-ext-plugin")),
    hasExtensions: existsSync(join(root, "extensions")),
  }
}

/**
 * NEGATIVE DRIVER: build fixture packed trees in a temp dir — one CLOSED tree and
 * one per missing fact (no plugin package, no `extensions/` root, no `mpd-ext`
 * row) — and drive the SAME predicate the real arm uses over each. `falsifiable`
 * is true only when the closed tree passes and EVERY broken tree fails, so the
 * real arm's green cannot be a predicate that is true regardless of the tree.
 * Called from the real packed arm AND from `--self-test` (offline, temp dirs only).
 */
export function packedNegativeDriver() {
  const root = mkdtempSync(join(tmpdir(), "mpd-packed-fixture-"))
  const trees = {}
  try {
    const build = (name, { row = true, plugin = true, extensions = true } = {}) => {
      const dir = join(root, name)
      mkdirSync(dir, { recursive: true })
      const line = row
        ? "    - id: mpd-ext\n      name: '@mpd-dsh/mpd/packages/mpd-ext-plugin/dist/index.js'\n"
        : "    - id: mpd-tools\n      name: '@mpd-dsh/mpd/packages/mpd-tools-plugin/dist/index.js'\n"
      writeFileSync(join(dir, "cordis.patch.yml"), "- insert:\n" + line)
      if (plugin) mkdirSync(join(dir, "packages", "mpd-ext-plugin", "dist"), { recursive: true })
      if (extensions) mkdirSync(join(dir, "extensions"), { recursive: true })
      return dir
    }
    const fixtures = {
      closed: build("closed"),
      "no-plugin-package": build("no-plugin-package", { plugin: false }),
      "no-extensions-root": build("no-extensions-root", { extensions: false }),
      "no-mpd-ext-row": build("no-mpd-ext-row", { row: false }),
    }
    for (const [name, dir] of Object.entries(fixtures)) {
      const facts = packedStateOf(dir)
      trees[name] = { ...facts, ok: packedStateOk({ packExit: 0, ...facts }) }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  const broken = ["no-plugin-package", "no-extensions-root", "no-mpd-ext-row"]
  return {
    falsifiable: trees.closed?.ok === true && broken.every((name) => trees[name]?.ok === false),
    // A packer that exited non-zero must also fail the predicate (the fourth fact).
    packerExitGated: packedStateOk({ packExit: 1, hasRow: true, hasPlugin: true, hasExtensions: true }) === false,
    trees,
  }
}

async function runReal() {
  gatePrereqs({ slug: SLUG, prereqs: [
    { code: "absent-dsh-binary", probe: "dsh", remedy: "install DeepSeek Harness (dsh) on PATH", present: () => binaryPresent("dsh") },
    { code: "absent-runtime", probe: "packages/mpd-ext-plugin/dist/index.js", remedy: "bun build packages/mpd-ext-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/index.js", present: () => existsSync(join(REPO, "packages", "mpd-ext-plugin", "dist", "index.js")) },
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
    steps.main = await mainArm({ box, outDir, logs })
    steps.failure = await failureArm({ box, outDir, logs })
    const iso = await isolationArm({ slug: SLUG, sandbox: box.sandbox, dshHome: box.dshHome, env: box.env, decoy: box.decoy, outDir })
    steps.isolation = { ok: iso.steps.ok, sessions: iso.steps }
    logs.push(...iso.logs)
    steps.packed = await packedArm({ outDir, logs })
  } while (false)
  steps.isolationFinal = isolationStep(box.dshHome, box.sandbox, SLUG)
  const ok = Object.values(steps).every((step) => step.ok === true)
  const wrote = writeEvidence(outDir, SLUG, {
    ok,
    sandbox: box.sandbox,
    arms: "main (mount + list + flow + skill + role persona/spawn) | failure (broken of each kind beside a healthy one, CLI oracle) | isolation (two sessions, one host, decoy control) | packed (a SCRATCH pack — the canonical dist/mpd-package is never written by this lane, its stamp is asserted unmoved)",
    rankLadder: "100 project-dsh < 200 project-agents < 250 runtime < 300 ours < 400 user-dsh < 500 user-agents < 600 bundled; lower wins inside a layer, nearest layer wins outright",
    steps,
  }, logs.join("\n\n"))
  cleanup(box.sandbox)
  process.exit(ok ? 0 : 1)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) await selfTest()
  else await runReal()
}
