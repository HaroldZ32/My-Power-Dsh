#!/usr/bin/env node
// t7 independent verification driver (Reviewer).
//
// It does NOT re-run t5's QA cases as-is: it re-derives their load-bearing claims
// on its own boots, with its own assertions, reading the HARNESS's session log
// (never prose, never --dump-config). Reuse is limited to the proven isolation /
// stub plumbing in skills/dsh-qa/scripts/extension-isolation.mjs (sandbox, install,
// stub model, session-evidence readers); every assertion below is this file's own.
//
//   node evidence/extensions/t7-verify/<ts>/driver.mjs [--skip-boot]
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import {
  REPO, createSandbox, installProfile, useStubRoute, makeStubModel, bootSession,
  sessionEvidence, keepRawSession, isolationStep, crashSignatures, cleanup,
  writeExtension, manifest, SKILL_MD, FLOW_JSON, PERSONA_MD, callsOf, toolResultsByCallId,
} from "../../../../skills/dsh-qa/scripts/extension-isolation.mjs"
import { readSessionEvents } from "../../../../skills/dsh-qa/scripts/lib/session-evidence.mjs"

const OUT = dirname(fileURLToPath(import.meta.url))
const SKIP_BOOT = process.argv.includes("--skip-boot")
const log = []
const say = (line) => { log.push(line); console.log(line) }
const steps = {}
const problems = []
const record = (name, ok, detail) => {
  steps[name] = { ok, ...detail }
  if (!ok) problems.push(name + ": " + JSON.stringify(detail).slice(0, 500))
  say("[" + (ok ? "PASS" : "FAIL") + "] " + name + " " + JSON.stringify(detail).slice(0, 320))
}
const nameOf = (p) => readFileSync(p, "utf8")

// ── runtime fixture MCP servers (the repo ships none on disk; these are mine) ──
function writeFixtures(dir) {
  mkdirSync(dir, { recursive: true })
  const frames = (handler) => `#!/usr/bin/env node
import { createInterface } from "node:readline"
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n")
const rl = createInterface({ input: process.stdin })
rl.on("line", (line) => {
  let m; try { m = JSON.parse(line) } catch { return }
  ${handler}
})
`
  writeFileSync(join(dir, "hang-server.mjs"), frames(`if (m.method === "initialize") { /* never answers */ }`))
  writeFileSync(join(dir, "schema-server.mjs"), frames(`
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "schema-fixture", version: "1" } } })
  else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [
    { name: "good_tool", description: "valid", inputSchema: { type: "object", properties: {} } },
    { name: "bad_input", description: "input that CANNOT be projected", inputSchema: { type: ["string", "array"] } },
    { name: "bad_output", description: "output outside the subset", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object", properties: { y: { type: "string", format: "date-time" } } } }
  ] } })
  else if (m.method === "tools/call") send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "schema-ok:" + m.params?.name }] } })
`))
  writeFileSync(join(dir, "dup-server.mjs"), frames(`
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "dup-fixture", version: "1" } } })
  else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [
    { name: "dup_tool", description: "first", inputSchema: { type: "object", properties: {} } },
    { name: "dup_tool", description: "second, same raw name", inputSchema: { type: "object", properties: {} } }
  ] } })
`))
  writeFileSync(join(dir, "lossy-server.mjs"), frames(`
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "lossy-fixture", version: "1" } } })
  else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [
    { name: "weird.name/with spaces", description: "lossy", inputSchema: { type: "object", properties: {} } }
  ] } })
  else if (m.method === "tools/call") send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "lossy-ok" }] } })
`))
  return dir
}

// ── A. static discipline checks (no boot) ────────────────────────────────────
function staticChecks() {
  const dir = join(REPO, "packages/mpd-ext-plugin/src")
  const src = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => ({ f, t: nameOf(join(dir, f)) }))
  const all = src.map((s) => s.t).join("\n")
  const lines = all.split("\n")

  record("c1.no-module-level-workspace-root",
    !/^(const|let|var)\s+\w*(workspaceRoot|workspace|cwd|projectRoot)\w*\s*=/im.test(all),
    { matches: lines.filter((l) => /^(const|let|var)\s+\w*(workspaceRoot|workspace|cwd|projectRoot)\w*\s*=/i.test(l)) })

  // strip comments: a comment is not a seam call and not a cwd read.
  const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l)
  const code = lines.map((l, i) => ({ l: l.trim(), i: i + 1 })).filter((x) => !isComment(x.l))

  const cwdUse = code.filter((x) => x.l.includes("process.cwd()"))
  // The load-bearing rule: the WORKSPACE/discovery root comes from the adapter, per call.
  const discoveryRootUsesCwd = code.filter((x) => /process\.cwd\(\)/.test(x.l) && /(extension|workspace|discover|root|plane)/i.test(x.l) && !/this\.cwd/.test(x.l))
  record("c2.workspace-discovery-never-uses-process-cwd", discoveryRootUsesCwd.length === 0,
    { discoveryRootUsesCwd, allCwdReads: cwdUse, note: "a child-PROCESS cwd (MCP stdio spawn) is legitimate and is reported, not failed" })

  const directSeams = code.filter((x) => /ctx\.(tools|subagents|skills|agentPresets)\s*[.[]/.test(x.l))
  record("c5.no-direct-harness-seams", directSeams.length === 0,
    { directSeams, adapterResolution: code.filter((x) => /ctx\.get\("mpdDsh"\)|createDshAdapter/.test(x.l)).map((x) => x.i + ":" + x.l).slice(0, 4) })

  record("c3.workspace-root-resolved-per-call", code.filter((x) => /workspaceRoot\s*\(/.test(x.l)).length >= 3,
    { callSites: code.filter((x) => /workspaceRoot\s*\(/.test(x.l)).map((x) => x.i + ":" + x.l).slice(0, 6) })

  const writes = code.filter((x) => /writeFileSync|mkdirSync|rmSync|appendFileSync/.test(x.l))
  const suspicious = writes.filter((x) => /dsh|bundle/i.test(x.l) && !/temp|tmp/i.test(x.l))
  record("c4.no-runtime-writes-outside-extension-roots", suspicious.length === 0, { writeSites: writes.length, suspicious })

  const H = "/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js"
  const harnessSrc = existsSync(H) ? nameOf(H) : ""
  const grab = (s, n) => { const m = new RegExp("const " + n + " = ([^;]+);").exec(s); return m === null ? undefined : m[1] }
  const MAX = Number(grab(harnessSrc, "MAX_PUBLIC_NAME_LENGTH"))
  const HASH = Number(grab(harnessSrc, "HASH_LENGTH"))
  const ourSrc = nameOf(join(dir, "mcp-client.ts"))
  const harnessImpl = harnessSrc.includes("mcp__${serverName}__${rawName}") && harnessSrc.includes("slice(0, HASH_LENGTH)")
  const ourImpl = ourSrc.includes("mcp__${serverName}__${rawName}") && ourSrc.includes("slice(0, HASH_LENGTH)")
  record("8a.publicToolName-parity-with-installed-harness", harnessImpl && ourImpl, { MAX, HASH, harnessImpl, ourImpl })
  return { MAX, HASH }
}

const textOf = (evidence, tool) => evidence.calls[tool]?.resultText ?? ""
const offeredOf = (records) => {
  const out = []
  for (const r of records ?? []) {
    const list = r?.data?.header?.tools
    if (Array.isArray(list)) for (const t of list) if (typeof t?.name === "string") out.push(t.name)
  }
  return [...new Set(out)]
}

async function bootWithStub({ sandbox, dshHome, env, cwd, script, label, tools = [] }) {
  const stub = makeStubModel({ script, label })
  const port = await stub.listen()
  useStubRoute(dshHome, port)
  const started = Date.now()
  const run = await bootSession({ slug: label, env, cwd, prompt: "Run the requested tool calls, then report.", stub, timeoutMs: 600000 })
  const elapsed = Date.now() - started
  const evidence = sessionEvidence(dshHome, cwd, tools)
  const store = readSessionEvents(dshHome, { workspace: cwd })
  const offered = offeredOf(store.records)
  await stub.close()
  keepRawSession(OUT, label, evidence.store)
  return { run, evidence, store, offered, elapsed, crashed: crashSignatures(run.out) }
}

// ── main ─────────────────────────────────────────────────────────────────────
const h = staticChecks()
const sb = createSandbox("t7-verify")
say("sandbox: " + sb.sandbox)
const fix = writeFixtures(join(sb.sandbox, "fixtures"))
say("fixtures: " + fix)
const BOOTS = {}
try {
  if (!SKIP_BOOT) {
    const inst = await installProfile(sb)
    record("install.profile", inst.status === 0, { exit: inst.status, tail: inst.out.slice(-200) })

    const exampleServer = join(REPO, "extensions/mpd-ext-example/server.mjs")
    // The extension ships its OWN copy of the reference server (the server reads the
    // manifest from its own directory, i.e. the extension's mpd-ext.json).
    const userServer = nameOf(exampleServer)
    writeExtension(join(sb.ws, ".mpd", "extensions"), "t7-proj",
      manifest("t7-proj", { skills: [{ root: "skills" }], flows: [{ dir: "flows" }] }),
      { skills: { "t7-proj-skill": SKILL_MD("t7-proj-skill", "PROJ") }, flows: { "t7-proj-flow.json": FLOW_JSON("t7-proj-flow", "T7 project flow", "PROJ") } })
    writeExtension(join(sb.runHome, ".mpd", "extensions"), "t7-user",
      manifest("t7-user", {
        skills: [{ root: "skills" }],
        flows: [{ dir: "flows" }],
        roles: [{ name: "T7 User Reviewer", description: "t7 verification role", readonly: true, persona: "persona.md" }],
        mcp: [{ serverName: "t7_user", transport: "stdio", command: "node", args: ["server.mjs"], cwd: ".", env: {}, connectTimeoutMs: 8000, toolCallTimeoutMs: 30000 }],
      }),
      { skills: { "t7-user-skill": SKILL_MD("t7-user-skill", "USER") }, flows: { "t7-user-flow.json": FLOW_JSON("t7-user-flow", "T7 user flow", "USER") }, files: { "persona.md": PERSONA_MD("USER"), "server.mjs": userServer } })

    // ── B. MOUNT PROOF + BEHAVIOUR ────────────────────────────────────────
    const b = await bootWithStub({
      ...sb, cwd: sb.ws, label: "main",
      script: [
        { tool: "mpd_ext_list", args: {} },
        { tool: "mpd_ext_show", args: { id: "t7-proj" } },
        { tool: "mpd_flow_show", args: { id: "t7-proj-flow" } },
        { tool: "mpd_role_persona", args: { role: "T7 User Reviewer" } },
        { tool: "mcp__t7_user__describe_extension", args: {} },
        { text: "t7-main-done" },
      ],
      tools: ["mpd_ext_list", "mpd_ext_show", "mpd_flow_show", "mpd_role_persona", "mcp__t7_user__describe_extension"],
    })
    BOOTS.main = { exit: b.run.status, elapsedMs: b.elapsed, offeredExt: b.offered.filter((t) => /^(mpd_ext_|mpd_flow_)/.test(t)), crashed: b.crashed }
    const need4 = ["mpd_ext_list", "mpd_ext_show", "mpd_flow_list", "mpd_flow_show"]
    record("a.mount-proof-row-applied-and-4-tools-offered",
      b.run.status === 0 && need4.every((t) => b.offered.includes(t)) && b.crashed.length === 0,
      { exit: b.run.status, needed: need4, offeredExt: BOOTS.main.offeredExt, crashed: b.crashed })
    record("b.1.project-extension-listed", textOf(b.evidence, "mpd_ext_list").includes("t7-proj"), { head: textOf(b.evidence, "mpd_ext_list").slice(0, 220) })
    record("b.2.flow-loadable", textOf(b.evidence, "mpd_flow_show").includes("t7-proj-flow") && b.evidence.calls.mpd_flow_show?.succeeded === true, { head: textOf(b.evidence, "mpd_flow_show").slice(0, 160) })
    record("b.3.role-persona-reachable", textOf(b.evidence, "mpd_role_persona").includes("USER"), { head: textOf(b.evidence, "mpd_role_persona").slice(0, 160) })
    record("b.4.mcp-tool-callable-from-session-log",
      textOf(b.evidence, "mcp__t7_user__describe_extension").includes("t7-user") && b.evidence.calls["mcp__t7_user__describe_extension"]?.succeeded === true,
      { head: textOf(b.evidence, "mcp__t7_user__describe_extension").slice(0, 200), succeeded: b.evidence.calls["mcp__t7_user__describe_extension"]?.succeeded })
    record("b.5.sandbox-isolation", isolationStep(sb.dshHome, sb.sandbox, "main").ok === true, isolationStep(sb.dshHome, sb.sandbox, "main"))

    // ── E. FAILURE ARMS ─────────────────────────────────────────────────
    const bad = join(sb.runHome, ".mpd", "extensions")
    // the malformed candidate sits BESIDE a valid one from the same provider: if the
    // pre-validation were not load-bearing, the invalid candidate would poison the
    // whole skills snapshot and the valid sibling would disappear too.
    writeExtension(bad, "t7-bad-skill", manifest("t7-bad-skill", { skills: [{ root: "skills" }] }),
      {
        skills: { "Bad Name!": SKILL_MD("Bad Name!", "BAD", ""), "t7-good-sibling": SKILL_MD("t7-good-sibling", "SIBLING") },
      })
    writeExtension(bad, "t7-dead-mcp", manifest("t7-dead-mcp", { mcp: [{ serverName: "t7_dead", transport: "stdio", command: "/nonexistent/nope", args: [], cwd: ".", connectTimeoutMs: 3000 }] }))
    writeExtension(bad, "t7-hang-mcp", manifest("t7-hang-mcp", { mcp: [{ serverName: "t7_hang", transport: "stdio", command: "node", args: [join(fix, "hang-server.mjs")], cwd: ".", connectTimeoutMs: 1500 }] }))
    writeExtension(bad, "t7-schema-mcp", manifest("t7-schema-mcp", { mcp: [{ serverName: "t7_schema", transport: "stdio", command: "node", args: [join(fix, "schema-server.mjs")], cwd: ".", connectTimeoutMs: 5000 }] }))
    writeExtension(bad, "t7-dup-mcp", manifest("t7-dup-mcp", { mcp: [{ serverName: "t7_dup", transport: "stdio", command: "node", args: [join(fix, "dup-server.mjs")], cwd: ".", connectTimeoutMs: 5000 }] }))
    writeExtension(bad, "t7-lossy-mcp", manifest("t7-lossy-mcp", { mcp: [{ serverName: "t7_lossy", transport: "stdio", command: "node", args: [join(fix, "lossy-server.mjs")], cwd: ".", connectTimeoutMs: 5000 }] }))
    writeExtension(join(sb.ws, ".mpd", "extensions"), "t7-proj-badplane",
      manifest("t7-proj-badplane", { roles: [{ name: "Nope", description: "x", persona: "p.md" }], mcp: [{ serverName: "t7_nope", transport: "stdio", command: "node", args: [], cwd: "." }] }),
      { files: { "p.md": PERSONA_MD("NOPE") } })

    // The harness's public name for a LOSSY raw name: sanitize + `_<12-hex sha256(server NUL raw)>`.
    const RAW_LOSSY = "weird.name/with spaces"
    const LOSSY_SERVER = "t7_lossy"
    const lossyName = (() => {
      const joined = "mcp__" + LOSSY_SERVER + "__" + RAW_LOSSY
      const normalized = joined.replace(/[^A-Za-z0-9_-]/g, "_")
      if (normalized === joined && normalized.length <= h.MAX) return normalized
      const hash = spawnSync(process.execPath, ["-e", `process.stdout.write(require("node:crypto").createHash("sha256").update(${JSON.stringify(LOSSY_SERVER + "\0" + RAW_LOSSY)}).digest("hex").slice(0,${h.HASH}))`], { encoding: "utf8" }).stdout
      return normalized.slice(0, h.MAX - h.HASH - 1) + "_" + hash
    })()
    const f = await bootWithStub({
      ...sb, cwd: sb.ws, label: "failure",
      script: [
        { tool: "mpd_ext_list", args: {} },
        { tool: "mpd_ext_show", args: { id: "t7-dead-mcp" } },
        { tool: "mpd_ext_show", args: { id: "t7-hang-mcp" } },
        { tool: "mpd_ext_show", args: { id: "t7-schema-mcp" } },
        { tool: "mpd_ext_show", args: { id: "t7-dup-mcp" } },
        { tool: "skill", args: { name: "t7-good-sibling" } },
        { tool: "mcp__t7_user__describe_extension", args: {} },
        { tool: lossyName, args: {} },
        { text: "t7-failure-done" },
      ],
      tools: ["mpd_ext_list", "mpd_ext_show", "skill", "mcp__t7_user__describe_extension", lossyName],
    })
    const listText = textOf(f.evidence, "mpd_ext_list")
    const allResults = (f.store.records ?? []).filter((r) => r?.type === "tool/result").map((r) => JSON.stringify(r?.data ?? {})).join("\n")
    // per-call pairing: `findToolCall` joins every result of one tool name, which
    // mislabels evidence when a name is called more than once. Pair by toolCallId.
    const byCall = toolResultsByCallId(f.store)
    const resultFor = (name, predicate = () => true) => {
      const hits = callsOf(f.store, name).filter(predicate)
      const last = hits[hits.length - 1]
      return last === undefined ? undefined : byCall.get(last.callId)
    }
    const badSkillResult = resultFor("mpd_ext_list")
    const skillResult = resultFor("skill")
    const mcpResult = resultFor("mcp__t7_user__describe_extension")
    const lossyResult = resultFor(lossyName)
    BOOTS.failure = { exit: f.run.status, elapsedMs: f.elapsed, crashed: f.crashed, listed: listText.slice(0, 600) }
    record("e.1.boot-green-with-six-broken-extensions",
      f.run.status === 0 && f.crashed.length === 0 && f.evidence.calls.mpd_ext_list?.succeeded === true,
      { exit: f.run.status, crashed: f.crashed, listOk: f.evidence.calls.mpd_ext_list?.succeeded })
    record("e.2.malformed-skill-candidate-skipped-and-valid-sibling-loads",
      /t7-bad-skill/.test(listText) && /(rejected|error|skipped|warning|invalid)/i.test(listText)
        && (skillResult?.text ?? "").includes("SIBLING") && skillResult?.isError === false,
      {
        badExtensionListed: /t7-bad-skill/.test(listText),
        reported: /(rejected|error|skipped|warning|invalid)/i.test(listText),
        badSkillMention: (listText.split("\n").find((l) => /t7-bad-skill|Bad Name/.test(l)) ?? "").slice(0, 200),
        validSiblingLoaded: (skillResult?.text ?? "").includes("SIBLING"),
        skillCallId: callsOf(f.store, "skill")[0]?.callId,
        skillHead: (skillResult?.text ?? "").slice(0, 120),
        note: "the malformed candidate must be dropped by the provider's pre-validation; if it reached the skills snapshot it would poison the snapshot and the valid sibling of the SAME provider would not load",
      })
    record("e.3.healthy-extension-still-works-beside-broken",
      (mcpResult?.text ?? "").includes("t7-user") && mcpResult?.isError === false && listText.includes("t7-proj"),
      { mcpHead: (mcpResult?.text ?? "").slice(0, 140), mcpIsError: mcpResult?.isError, mcpCallId: callsOf(f.store, "mcp__t7_user__describe_extension")[0]?.callId })
    record("e.4.dead-mcp-reported-no-tool", /t7_dead=(unavailable|failed)/.test(allResults) && !f.offered.some((t) => t.startsWith("mcp__t7_dead__")), { seen: /t7_dead=\w+/.exec(allResults)?.[0], tools: f.offered.filter((t) => t.startsWith("mcp__t7_dead__")) })
    record("e.5.hang-mcp-time-boxed-boot-green", /t7_hang=(unavailable|failed)/.test(allResults) && f.run.status === 0 && !f.offered.some((t) => t.startsWith("mcp__t7_hang__")), { seen: /t7_hang=\w+/.exec(allResults)?.[0], exit: f.run.status })
    record("e.6.schema-keep-or-drop-loud",
      /t7_schema=connected/.test(allResults) && /(skipped|cannot be projected)/.test(allResults) && f.offered.includes("mcp__t7_schema__good_tool") && !f.offered.includes("mcp__t7_schema__bad_input") && !f.offered.includes("mcp__t7_schema__bad_output"),
      { seen: /t7_schema=\w+/.exec(allResults)?.[0], good: f.offered.includes("mcp__t7_schema__good_tool"), badInput: f.offered.includes("mcp__t7_schema__bad_input"), badOutput: f.offered.includes("mcp__t7_schema__bad_output") })
    record("e.7.dup-raw-name-leaves-zero-tools",
      /t7_dup=(unavailable|failed)/.test(allResults) && !f.offered.some((t) => t.startsWith("mcp__t7_dup__")),
      { seen: /t7_dup=\w+/.exec(allResults)?.[0], tools: f.offered.filter((t) => t.startsWith("mcp__t7_dup__")) })
    record("e.8.project-plane-mcp-and-roles-rejected-loudly",
      /t7-proj-badplane/.test(listText) && /(project-level|skills and flows only|rejected)/i.test(listText),
      { head: (listText.split("\n").filter((l) => /t7-proj-badplane|project-level/.test(l)).join(" | ") ?? "").slice(0, 300) })

    // (8) lossy naming: the observed public name must equal the harness algorithm, and the
    // suffixed name must be the one that actually registered (not the un-suffixed join).
    const observedLossy = f.offered.find((t) => t.startsWith("mcp__t7_lossy__"))
    record("8b.lossy-public-name-matches-harness-algorithm",
      observedLossy === lossyName && (observedLossy ?? "").length <= h.MAX && /^mcp__[A-Za-z0-9_]+__[A-Za-z0-9_-]+$/.test(observedLossy ?? ""),
      { observed: observedLossy, expected: lossyName, len: observedLossy?.length, cap: h.MAX })
    record("8c.lossy-tool-really-callable", (lossyResult?.text ?? "").includes("lossy-ok") && lossyResult?.isError === false,
      { head: (lossyResult?.text ?? "").slice(0, 120), isError: lossyResult?.isError, callId: callsOf(f.store, lossyName)[0]?.callId })

    // ── D. MULTI-SESSION ISOLATION ───────────────────────────────────────
    const wsA = join(sb.sandbox, "t7-ws-a"), wsB = join(sb.sandbox, "t7-ws-b"), decoy = join(sb.sandbox, "t7-decoy")
    for (const [dir, id] of [[wsA, "t7-iso-a"], [wsB, "t7-iso-b"], [decoy, "t7-iso-decoy"]]) {
      writeExtension(join(dir, ".mpd", "extensions"), id, manifest(id, { skills: [{ root: "skills" }] }), { skills: { [id + "-skill"]: SKILL_MD(id + "-skill", id.toUpperCase()) } })
    }
    for (const [label, cwd, expect, forbid] of [
      ["d.iso-a", wsA, "t7-iso-a", ["t7-iso-b", "t7-iso-decoy"]],
      ["d.iso-b", wsB, "t7-iso-b", ["t7-iso-a", "t7-iso-decoy"]],
      ["d.iso-decoy-control", decoy, "t7-iso-decoy", ["t7-iso-a", "t7-iso-b"]],
    ]) {
      const s = await bootWithStub({ ...sb, cwd, label, script: [{ tool: "mpd_ext_list", args: {} }, { text: label + "-done" }], tools: ["mpd_ext_list"] })
      const txt = textOf(s.evidence, "mpd_ext_list")
      record(label, s.run.status === 0 && txt.includes(expect) && forbid.every((x) => !txt.includes(x)),
        { exit: s.run.status, sawExpected: txt.includes(expect), sawForbidden: forbid.filter((x) => txt.includes(x)) })
    }

    // ── F. PACKED PATH (t5 records the RED; t11 owns the GREEN) ──────────
    const packed = spawnSync(process.execPath, [join(REPO, "scripts/pack-mpd.mjs")], { cwd: REPO, encoding: "utf8", timeout: 900000 })
    const packDir = join(REPO, "dist", "mpd-package")
    const packedState = {
      exit: packed.status,
      pluginPresent: existsSync(join(packDir, "packages/mpd-ext-plugin/dist/index.js")),
      extensionsPresent: existsSync(join(packDir, "extensions")),
      patchMentionsExt: existsSync(join(packDir, "cordis.patch.yml")) ? nameOf(join(packDir, "cordis.patch.yml")).includes("mpd-ext") : false,
    }
    BOOTS.packed = packedState
    record("f.1.pack-runs", packed.status === 0, { exit: packed.status, tail: (packed.stdout ?? "").slice(-200), stderr: (packed.stderr ?? "").slice(-300) })
    record("f.2.packed-red-recorded-as-expected", packedState.pluginPresent === false || packedState.extensionsPresent === false,
      { ...packedState, note: "t5's stated expectation for this wave: the packed tree cannot yet resolve the ext row / carry extensions/. A GREEN here means t11 already landed its fix." })
  }
} catch (error) {
  record("driver.exception", false, { error: String(error), stack: String(error?.stack).slice(0, 700) })
} finally {
  const payload = { slug: "t7-verify", ok: problems.length === 0, problems, steps, harness: h, boots: BOOTS, sandbox: sb.sandbox }
  writeFileSync(join(OUT, "result.verify.json"), JSON.stringify(payload, null, 2) + "\n")
  writeFileSync(join(OUT, "verify.log"), log.join("\n") + "\n")
  cleanup(sb.sandbox)
  say("RESULT ok=" + payload.ok + " problems=" + problems.length)
}
