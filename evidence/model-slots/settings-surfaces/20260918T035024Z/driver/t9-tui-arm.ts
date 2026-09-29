// t9 verification driver — the TUI ARM of the settings-surface measurement.
//
// WHAT IS MEASURED, exactly: the BUILT artifact `packages/mpd-tui-plugin/dist/index.js` is applied
// against a stub host through its real `apply()` entry, with the REAL adapter build as the
// `mpdDsh` service. Two arms are run so the BRANCH is a measurement rather than an assumption:
//   • LIVE  — the adapter reads a host `llm` service through the adapter's own `llmCatalog()`
//             projection, so the section's options come from the catalog;
//   • FALLBACK — no `llm` service, so the catalog is degraded and the section must register on the
//             declared option lists (never empty).
// In both arms the driver captures (a) the branch line the built code logs and (b) the section
// object the plugin hands to `tuiSettingsSections.register`, then asserts the NINE slot fields are
// `select` with NON-EMPTY options.
//
// LIMITATION, stated rather than hidden: this is a stub-host registration measurement against the
// built bytes, NOT a dsh-tui process boot. A real TUI composition needs the dsh-tui bundle in the
// sandbox profile (a network install of @deepseek-harness-tui/dsh-tui@0.10.1) and tmux; that
// install was not run, so the in-process TUI boot is NOT claimed. What the real bundled boot DOES
// prove is in ../mount-checks.json (the mpd-tui row applies inert under the web profile with no
// crash signature).
//
// Usage: bun evidence/model-slots/settings-surfaces/<ts>/driver/t9-tui-arm.mjs
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, "..")
const REPO = join(HERE, "..", "..", "..", "..", "..")
const TUI_DIST = join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js")
const ADAPTER_DIST = join(REPO, "packages", "mpd-dsh-adapter-plugin", "dist", "index.js")

const noop = () => () => {}
const noopService = new Proxy({}, { get: () => () => noop() })

/** The host `llm` service the REAL adapter projects through `llmCatalog()`. */
function fakeLlm() {
  const twoProvider = [
    { id: "deepseek-official", name: "DeepSeek Official" },
    { id: "pi-ai", name: "pi-ai" },
  ]
  const models = {
    "deepseek-official": [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: { efforts: [{ id: "max", name: "Max" }, { id: "high", name: "High" }] } }],
    "pi-ai": [{ id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: { efforts: [{ id: "high", name: "High" }] } }],
  }
  return {
    listProviders: async () => twoProvider,
    listModels: async (providerId) => models[providerId] ?? [],
    resolveModelInfo: async (providerId, modelId) => (models[providerId] ?? []).find((model) => model.id === modelId),
  }
}

/** A minimal cordis-like host: unknown services answer as no-ops, injects run when satisfied. */
function makeHost({ adapter } = {}) {
  const captured = { sections: [], infos: [], warns: [], injects: [], skippedInjects: [] }
  const registry = {
    mpdConfig: { states: () => ({ files: [], errors: [], writeback: null }) },
    tuiStatus: { set: () => noop() },
    tuiRenderers: { register: () => noop() },
    tuiSettingsSections: { register: (section) => { captured.sections.push(section); return noop() } },
    tuiScenes: { register: () => noop(), open: noop },
    tuiCommandTrees: { register: () => noop() },
    tuiShortcuts: { register: () => noop() },
    tuiDialogs: { register: () => noop() },
    tuiPluginHost: { register: () => noop() },
    commands: { register: () => noop() },
  }
  if (adapter !== undefined) registry.mpdDsh = adapter
  const scopedFor = (deps) => {
    const base = {
      get: (name) => registry[name],
      effect: (fn) => { try { return fn() ?? noop() } catch { return noop() } },
      on: () => noop(),
      logger: { info: (line) => captured.infos.push(String(line)), warn: (line) => captured.warns.push(String(line)), error: () => {}, debug: () => {} },
    }
    return new Proxy(base, {
      get: (target, prop) => (prop in target ? target[prop] : (deps.includes(prop) ? registry[prop] : undefined)),
    })
  }
  const ctx = new Proxy({
    get: (name) => registry[name],
    inject: (deps, cb) => {
      captured.injects.push([...deps])
      if (deps.every((dep) => registry[dep] !== undefined)) cb(scopedFor([...deps]))
      else captured.skippedInjects.push([...deps])
      return { dispose: noop }
    },
    effect: (fn) => { try { return fn() ?? noop() } catch { return noop() } },
    on: () => noop(),
    logger: { info: (line) => captured.infos.push(String(line)), warn: (line) => captured.warns.push(String(line)), error: () => {}, debug: () => {} },
  }, { get: (target, prop) => (prop in target ? target[prop] : noopService) })
  return { ctx, captured, registry }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 400))

async function runArm(name, { adapter }) {
  const tui = await import(pathToFileURL(TUI_DIST).href)
  const host = makeHost({ adapter })
  const outcome = { arm: name, threw: null, sectionFound: false, slots: [], branchLine: null, degradedLine: null }
  try {
    tui.apply(host.ctx, { statusIntervalMs: 0 })
  } catch (error) {
    outcome.threw = String(error?.message ?? error)
  }
  await settle()
  const branch = host.captured.infos.find((line) => line.includes("slot options: provider=")) ?? null
  outcome.branchLine = branch
  const section = host.captured.sections[0]
  if (section !== undefined) {
    outcome.sectionFound = true
    const fields = Array.isArray(section.fields) ? section.fields : []
    outcome.slots = fields
      .filter((field) => Array.isArray(field.path) && field.path[0] === "teamModels")
      .map((field) => ({ path: field.path.join("."), kind: field.kind, options: Array.isArray(field.options) ? field.options.map((option) => option.value ?? option) : null, optionCount: Array.isArray(field.options) ? field.options.length : 0 }))
    outcome.totalFields = fields.length
  }
  return outcome
}

const adapterMod = await import(pathToFileURL(ADAPTER_DIST).href)
const adapterCtx = { get: (name) => (name === "llm" ? fakeLlm() : undefined) }
const realAdapter = adapterMod.createDshAdapter(adapterCtx)
const liveCatalog = await realAdapter.llmCatalog()

const live = await runArm("live", { adapter: { llmCatalog: () => realAdapter.llmCatalog() } })
const degraded = await runArm("degraded", { adapter: { llmCatalog: async () => ({ providers: [], degraded: true }) } })
const fallback = await runArm("unavailable", { adapter: {} })

const NINE = ["teamModels.slot1.model", "teamModels.slot1.provider", "teamModels.slot1.reasoningEffort", "teamModels.slot2.model", "teamModels.slot2.provider", "teamModels.slot2.reasoningEffort", "teamModels.slot3.model", "teamModels.slot3.provider", "teamModels.slot3.reasoningEffort"].sort()
const checks = []
const add = (id, ok, detail) => checks.push({ id, ok, detail })

for (const arm of [live, degraded, fallback]) {
  const tag = arm.arm.toUpperCase()
  add("T." + tag + ".1", arm.threw === null && arm.sectionFound, "the built dist applied against the stub host and registered ONE section (threw: " + String(arm.threw) + ", fields: " + String(arm.totalFields) + ")")
  add("T." + tag + ".2", JSON.stringify(arm.slots.map((slot) => slot.path).sort()) === JSON.stringify(NINE), "the registered section carries exactly the NINE slot fields: " + JSON.stringify(arm.slots.map((slot) => slot.path).sort()))
  add("T." + tag + ".3", arm.slots.length === 9 && arm.slots.every((slot) => slot.kind === "select" && slot.optionCount > 0), "every slot field is `select` with a NON-EMPTY options array: " + JSON.stringify(arm.slots.map((slot) => slot.path + "=" + slot.optionCount)))
  add("T." + tag + ".4", typeof arm.branchLine === "string" && arm.branchLine.includes("catalog="), "the built code logged the branch it took: " + String(arm.branchLine))
}

add("T.BRANCH.live", String(live.branchLine).includes("catalog=live") && String(live.branchLine).includes("provider=live(2)") && String(live.branchLine).includes("model=live(2)"), "LIVE arm: the catalog (2 providers, 2 models, union of efforts) drove the options — " + String(live.branchLine))
add("T.BRANCH.degraded", String(degraded.branchLine).includes("catalog=degraded") && /provider=declared\(\d+\)/.test(String(degraded.branchLine)) && /model=declared\(\d+\)/.test(String(degraded.branchLine)) && /reasoningEffort=declared\(\d+\)/.test(String(degraded.branchLine)), "DEGRADED arm: a catalog that answered {providers:[],degraded:true} registered on the DECLARED non-empty lists — " + String(degraded.branchLine))
add("T.BRANCH.unavailable", String(fallback.branchLine).includes("catalog=unavailable") && /provider=declared\(\d+\)/.test(String(fallback.branchLine)) && /model=declared\(\d+\)/.test(String(fallback.branchLine)) && /reasoningEffort=declared\(\d+\)/.test(String(fallback.branchLine)), "UNAVAILABLE arm: a mounted adapter WITHOUT the llmCatalog seam registered on the DECLARED non-empty lists — " + String(fallback.branchLine))
add("T.CATALOGREAL", liveCatalog.degraded === false && liveCatalog.providers.length === 2, "the REAL adapter build projected the host llm catalog for the live arm: " + JSON.stringify({ degraded: liveCatalog.degraded, providers: liveCatalog.providers.length }))

const result = {
  case: "t9-settings-surfaces-tui-arm",
  measuredAt: new Date().toISOString(),
  artifact: { tuiDist: TUI_DIST, adapterDist: ADAPTER_DIST, tuiDistSha256: (await import("node:crypto")).createHash("sha256").update((await import("node:fs")).readFileSync(TUI_DIST)).digest("hex") },
  limitation: "stub-host registration against the built bytes; NO dsh-tui process boot was run (a TUI profile needs a network install of @deepseek-harness-tui/dsh-tui@0.10.1 + tmux) — the real bundled boot evidence is ../mount-checks.json (mpd-tui row applied inert under the web profile, no crash signature)",
  live, degraded, fallback, checks,
  verdict: { ok: checks.every((check) => check.ok), failed: checks.filter((check) => !check.ok).map((check) => check.id) },
}
writeFileSync(join(OUT_DIR, "tui-arm.json"), JSON.stringify(result, null, 2) + "\n")
console.log("[t9-tui-arm] " + JSON.stringify(result.verdict))
process.exit(result.verdict.ok ? 0 : 1)
