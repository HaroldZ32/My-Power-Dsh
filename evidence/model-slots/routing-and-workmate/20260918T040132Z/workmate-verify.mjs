#!/usr/bin/env node
// t10 WORKMATE verification driver (evidence/model-slots/routing-and-workmate/<ts>/).
//
// Applies the REAL packages (src, byte-identical to the fresh dists row consumers load) to a real
// context, with HOME + DSH_HOME + DSH_WORKSPACE_ROOT all pointed at a sandbox, then drives the
// workmate surface and measures the RESULT BYTES:
//   T1  the seven registered tools are exactly list/init/spawn/reflect/match/rename/delete
//       (NO mpd_workmate_get, NO mpd_workmate_read);
//   T2  init base "Deep Worker" (name omitted) succeeds and produces deep-worker-1;
//   T3  init base "hephaestus" is refused with a NAME-ONLY error (the rejected key is not echoed);
//   T4  every tool output (init/list/match/spawn/reflect/rename/delete) and their output SCHEMAS
//       carry NO baseId key;
//   T5  the /plugins/mpd-workmate/{list,roster,get} ROUTE HANDLERS the plugin registers answer
//       payloads carrying NO id/baseId (the handler is invoked through the plugin's own
//       registration with a response double; no HTTP socket is opened);
//   T6  the built web client artifact carries no baseId and none of the old id-teaching copy in the
//       workmate tab path (the artifact t5 rebuilt after t7);
//   T7  the REAL ~/.mpd/workmate listing is unchanged (the sandbox HOME is the only library touched).
//
// Run with bun (the src modules are TypeScript):  bun <this file>
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(HERE, "../../../..")
const outDir = HERE
const LOG = []
const log = (line) => { LOG.push(line); console.log(line) }

// The REAL home must be captured BEFORE the sandbox takes over $HOME.
const REAL_HOME = process.env.HOME ?? ""
const REAL_WM = join(REAL_HOME, ".mpd", "workmate")
const realWmBefore = existsSync(REAL_WM) ? readdirSync(REAL_WM).sort().join(",") : null

const sandbox = mkdtempSync(join(tmpdir(), "mpd-t10-wm-"))
const ws = join(sandbox, "ws")
process.env.HOME = sandbox
process.env.DSH_HOME = sandbox
process.env.DSH_WORKSPACE_ROOT = ws
delete process.env.MPD_DSH_WORKMATE_ALLOW_REAL_HOME

log("sandbox=" + sandbox + "\nrealHome=" + REAL_HOME + "\nrealWorkmateLibrary=" + REAL_WM)

/** Deep scan: every path whose key is `baseId` or `id` (the two keys the alias removal forbids). */
function findKeys(value, keys = ["baseId", "id"], path = "$", hits = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findKeys(entry, keys, path + "[" + index + "]", hits))
    return hits
  }
  if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      if (keys.includes(key)) hits.push(path + "." + key)
      findKeys(inner, keys, path + "." + key, hits)
    }
  }
  return hits
}

const renderedText = (def, args, value) => {
  try {
    const blocks = typeof def.output?.render === "function" ? def.output.render(args, value) : []
    return JSON.stringify(blocks ?? [])
  } catch (error) {
    return "RENDER-THREW: " + String(error)
  }
}

async function main() {
  const roles = await import(join(repoRoot, "packages/mpd-roles-plugin/src/index.ts"))
  const workmate = await import(join(repoRoot, "packages/mpd-workmate-plugin/src/index.ts"))

  const toolsCaptured = []
  const routesCaptured = []
  const services = {}
  const tools = { register: (def) => { toolsCaptured.push(def); return () => {} }, get: () => undefined, execute: async () => ({ ok: false, error: { message: "not executed by this driver" } }) }
  const subagents = { start: async (mode, spec) => ({ result: { output: "stub spawn result", structured: { ok: true }, stopReason: "end_turn" } }) }
  const webServer = { register: (def) => { routesCaptured.push(def); return () => {} } }
  const ctx = {
    tools,
    subagents,
    provide: (name, value) => { services[name] = value },
    get: (name) => (name === "tools" ? tools : name === "subagents" ? subagents : name === "webServer" ? webServer : services[name]),
    effect: (fn) => { try { const disposer = fn(); return typeof disposer === "function" ? disposer : () => {} } catch { return () => {} } },
    on: () => () => {},
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
  }
  await roles.apply(ctx, {})
  const rolesToolNames = toolsCaptured.map((def) => def.name)
  toolsCaptured.length = 0 // this driver's subject is the WORKMATE surface
  workmate.apply(ctx)

  const steps = {}
  const tool = (name) => {
    const found = toolsCaptured.find((def) => def.name === name)
    if (found === undefined) throw new Error("tool not registered: " + name)
    return found
  }
  const call = async (name, args) => {
    const def = tool(name)
    const value = await def.execute(args, {})
    return { name, args, value, rendered: renderedText(def, args, value), schema: def.output?.schema }
  }
  const callExpectRefusal = async (name, args) => {
    try {
      const value = await tool(name).execute(args, {})
      return { name, args, threw: false, value }
    } catch (error) {
      return { name, args, threw: true, message: String(error?.message ?? error) }
    }
  }

  // T1 — exactly the seven tools, and the two forbidden names are absent.
  const SEVEN = ["mpd_workmate_list", "mpd_workmate_init", "mpd_workmate_spawn", "mpd_workmate_reflect", "mpd_workmate_match", "mpd_workmate_rename", "mpd_workmate_delete"]
  const names = toolsCaptured.map((def) => def.name).sort()
  steps.t1RegisteredTools = {
    ok: JSON.stringify(names) === JSON.stringify([...SEVEN].sort()) && !names.includes("mpd_workmate_get") && !names.includes("mpd_workmate_read"),
    names,
    rolesToolNames,
    problems: JSON.stringify(names) === JSON.stringify([...SEVEN].sort()) ? [] : ["registered tool names differ from the seven-tool contract: " + JSON.stringify(names)],
  }

  // T2 — init with the FUNCTIONAL NAME, name omitted -> deep-worker-1.
  const init = await call("mpd_workmate_init", { base: "Deep Worker", note: "t10 sandbox instance" })
  const libRoot = join(sandbox, ".mpd", "workmate")
  const entry = join(libRoot, "deep-worker-1")
  steps.t2InitByFunctionalName = {
    ok: init.value?.name === "deep-worker-1" && init.value?.baseName === "Deep Worker" && existsSync(join(entry, "meta.json")) && existsSync(join(entry, "persona.md")),
    value: init.value,
    sandboxEntryFiles: existsSync(entry) ? readdirSync(entry).sort() : null,
    problems: [
      ...(init.value?.name === "deep-worker-1" ? [] : ["init did not auto-name the instance deep-worker-1 (got " + String(init.value?.name) + ")"]),
      ...(existsSync(join(entry, "meta.json")) ? [] : ["meta.json was not written under the sandbox library"]),
    ],
  }

  // T3 — an omo/roster id is refused with a NAME-ONLY error.
  const refusal = await callExpectRefusal("mpd_workmate_init", { base: "hephaestus", name: "legacy-alias" })
  const refusalText = String(refusal.message ?? JSON.stringify(refusal.value ?? ""))
  steps.t3RosterIdRefused = {
    ok: refusalText.includes("unknown base") && !refusalText.toLowerCase().includes("hephaestus") && !existsSync(join(libRoot, "legacy-alias")),
    refusalText: refusalText.slice(0, 400),
    listsNames: /Deep Worker/.test(refusalText),
    problems: [
      ...(refusalText.includes("unknown base") ? [] : ["the refusal does not say 'unknown base'"]),
      ...(refusalText.toLowerCase().includes("hephaestus") ? ["the refusal ECHOES the rejected roster id"] : []),
      ...(existsSync(join(libRoot, "legacy-alias")) ? ["the refused init still created an instance"] : []),
    ],
  }

  // T2b — case/separator-insensitive name resolution on a SECOND instance (proves the matcher).
  const init2 = await call("mpd_workmate_init", { base: "deep worker", name: "second-probe" })
  steps.t2bNameSpellingInsensitive = {
    ok: init2.value?.name === "second-probe" && init2.value?.baseName === "Deep Worker" && existsSync(join(libRoot, "second-probe", "meta.json")),
    value: init2.value,
    problems: [
      ...(init2.value?.baseName === "Deep Worker" ? [] : ["the lower-case spelling 'deep worker' did not resolve to the functional name 'Deep Worker'"]),
      ...(existsSync(join(libRoot, "second-probe", "meta.json")) ? [] : ["the second instance was not created"]),
    ],
  }

  // T4 — every tool output AND output schema, deep-scanned for baseId.
  const list = await call("mpd_workmate_list", {})
  const match = await call("mpd_workmate_match", { task: "implement a verilog counter and verify" })
  const spawn = await call("mpd_workmate_spawn", { name: "deep-worker-1", task: "summarize README.md" })
  const reflect = await call("mpd_workmate_reflect", { name: "deep-worker-1", task: "summarize README.md", outcome: "one-sentence summary" })
  const rename = await call("mpd_workmate_rename", { name: "second-probe", new_name: "second-probe-renamed" })
  const del = await call("mpd_workmate_delete", { name: "second-probe-renamed" })
  const outputs = [init, list, match, spawn, reflect, rename, del]
  const baseIdHits = {}
  const schemaHits = {}
  for (const entryOut of outputs) {
    baseIdHits[entryOut.name] = findKeys(entryOut.value, ["baseId"])
    schemaHits[entryOut.name] = findKeys(entryOut.schema, ["baseId"])
  }
  const schemaTextHits = outputs.map((entryOut) => ({ name: entryOut.name, hit: JSON.stringify(entryOut.schema ?? {}).includes("baseId") }))
  steps.t4NoBaseIdInToolOutputs = {
    ok: Object.values(baseIdHits).every((hits) => hits.length === 0) && Object.values(schemaHits).every((hits) => hits.length === 0) && schemaTextHits.every((entryHit) => entryHit.hit === false),
    baseIdHits,
    schemaHits,
    schemaTextHits,
    calls: outputs.map((entryOut) => ({ name: entryOut.name, value: JSON.stringify(entryOut.value).slice(0, 300), rendered: entryOut.rendered.slice(0, 200) })),
    problems: [
      ...Object.entries(baseIdHits).filter(([, hits]) => hits.length > 0).map(([name, hits]) => name + " output carries " + hits.join(",")),
      ...schemaTextHits.filter((entryHit) => entryHit.hit).map((entryHit) => entryHit.name + " schema declares baseId"),
    ],
  }

  // T5 — the registered route handlers' payloads (invoked with a response double).
  const res = () => ({
    status: null, headers: null, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body === undefined ? null : String(body) },
    payload() { try { return JSON.parse(String(this.body)) } catch { return null } },
  })
  const routeOf = (path) => {
    const found = routesCaptured.find((def) => def.path === path)
    if (found === undefined) throw new Error("route not registered: " + path)
    return found
  }
  const routed = {}
  for (const path of ["/plugins/mpd-workmate/list", "/plugins/mpd-workmate/roster", "/plugins/mpd-workmate/get"]) {
    const def = routeOf(path)
    const response = res()
    const request = { method: "GET", url: path + (path.endsWith("/get") ? "?name=deep-worker-1" : ""), [Symbol.asyncIterator]: async function* () { } }
    await def.handler(request, response)
    routed[path] = { status: response.status, payload: response.payload(), raw: String(response.body).slice(0, 600), keys: findKeys(response.payload(), ["baseId", "id"]) }
  }
  steps.t5RoutesCarryNoId = {
    ok: Object.values(routed).every((entry) => entry.status === 200 && entry.payload !== null && entry.keys.length === 0 && !String(entry.raw).includes("baseId")),
    routed,
    rosterShape: Array.isArray(routed["/plugins/mpd-workmate/roster"]?.payload?.bases) ? Object.keys(routed["/plugins/mpd-workmate/roster"].payload.bases[0] ?? {}) : null,
    problems: Object.entries(routed).flatMap(([path, entry]) => [
      ...(entry.status === 200 ? [] : [path + " answered status " + String(entry.status)]),
      ...(entry.keys.length === 0 ? [] : [path + " payload carries " + entry.keys.join(",")]),
    ]),
  }

  // T6 — the BUILT web client (the artifact t5 rebuilt after t7).
  const clientPath = join(repoRoot, "packages", "mpd-bundle-plugin", "client.js")
  const client = readFileSync(clientPath, "utf8")
  const clientHash = createHash("sha256").update(client).digest("hex")
  steps.t6BuiltClientBytes = {
    ok: !client.includes("baseId") && !client.includes("type the base id") && !client.includes("roster id") && /baseName/.test(client),
    path: clientPath,
    sha256: clientHash,
    bytes: Buffer.byteLength(client),
    mtime: statSync(clientPath).mtime.toISOString(),
    baseIdOccurrences: (client.match(/baseId/g) ?? []).length,
    idTeachingCopyOccurrences: (client.match(/type the base id/gi) ?? []).length,
    usesBaseName: /baseName/.test(client),
    problems: [
      ...(client.includes("baseId") ? ["the built client mentions baseId"] : []),
      ...(client.includes("type the base id") ? ["the built client still teaches typing a base id"] : []),
      ...(/baseName/.test(client) ? [] : ["the built client never reads baseName"]),
    ],
  }

  // T7 — the real library was never touched.
  const realWmAfter = existsSync(REAL_WM) ? readdirSync(REAL_WM).sort().join(",") : null
  steps.t7RealHomeUntouched = { ok: realWmBefore === realWmAfter, realWm: REAL_WM, before: realWmBefore, after: realWmAfter }

  const ok = Object.values(steps).every((step) => step.ok === true)
  writeFileSync(join(outDir, "workmate-result.json"), JSON.stringify({ ok, sandbox, steps }, null, 2))
  writeFileSync(join(outDir, "workmate-output.log"), LOG.join("\n\n---\n\n"))
  console.log("[t10 workmate] ok=" + ok)
  for (const [key, value] of Object.entries(steps)) console.log("  " + key + ": " + JSON.stringify({ ok: value.ok, problems: value.problems ?? [] }).slice(0, 500))
  process.exit(ok ? 0 : 1)
}

await main()
