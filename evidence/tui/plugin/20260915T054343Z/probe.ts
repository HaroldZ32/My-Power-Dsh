// Reproducible probe for the BUILT entry of packages/mpd-tui-plugin.
//
// It loads `dist/index.js` (never `src/`), so it is evidence about the artifact
// the bundle row resolves — not about the TypeScript sources. Run it after a
// clean build:
//
//   rm -rf packages/mpd-tui-plugin/dist
//   bun build packages/mpd-tui-plugin/src/index.ts --target node --format esm \
//     --outfile packages/mpd-tui-plugin/dist/index.js
//   node evidence/tui/plugin/<ts>/probe.mjs
//
// Exit 0 = every assertion held; exit 1 = at least one did not (the JSON
// result names the failures).
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))))
const entry = join(repoRoot, "packages", "mpd-tui-plugin", "dist", "index.js")
const failures = []
const checks = []

function check(name, condition, detail) {
  checks.push({ name, ok: condition === true, detail: detail === undefined ? null : detail })
  if (condition !== true) failures.push(name)
}

const bytes = readFileSync(entry)
const sha256 = createHash("sha256").update(bytes).digest("hex")
const mod = await import(pathToFileURL(entry).href)

// ── contract ────────────────────────────────────────────────────────────────
check("name === 'mpd-tui'", mod.name === "mpd-tui", String(mod.name))
check("apply is a function", typeof mod.apply === "function")
check("Config is a callable schemastery schema", typeof mod.Config === "function")
check("no default export", mod.default === undefined)
const defaults = mod.Config({})
check(
  "the schema defaults every key",
  JSON.stringify(defaults) ===
    JSON.stringify({
      statusLine: true,
      statusIntervalMs: 3000,
      renderers: true,
      settingsSection: true,
      scene: true,
      commandTrees: true,
      commands: true,
      shortcuts: true,
      dialogs: true,
      sessionEvents: true,
      decisionEvents: true,
      logPrefix: "mpd-tui",
    }),
  JSON.stringify(defaults),
)

// ── degenerate composition: every TUI service absent ────────────────────────
const bareWarnings = []
const bare = {
  get: () => undefined,
  effect: (callback) => {
    callback()
    return {}
  },
  logger: { info: () => {}, warn: (m) => bareWarnings.push(m), debug: () => {} },
}
let bareThrew = null
try {
  mod.apply(bare, {})
} catch (error) {
  bareThrew = String(error && error.message ? error.message : error)
}
check("apply() does not throw without any TUI service", bareThrew === null, bareThrew)
check(
  "a service-less composition logs one aggregate warning",
  bareWarnings.length === 1 && bareWarnings[0].includes("no DSH-TUI service is composed"),
  JSON.stringify(bareWarnings),
)

// ── full composition: every TUI service present ─────────────────────────────
const calls = { status: [], renderers: [], sections: [], scenes: [], shortcuts: [], trees: [], decisions: [], namespaces: [], commands: [] }
const disposed = { count: 0 }
const disposer = () => {
  disposed.count += 1
}
const fullWarnings = []
const services = {
  tuiStatus: { set: (key, text) => (calls.status.push({ key, text }), disposer) },
  tuiRenderers: { register: (type) => (calls.renderers.push(type), disposer) },
  tuiSettingsSections: { register: (section) => (calls.sections.push(section), disposer) },
  tuiScenes: { register: (d) => (calls.scenes.push(d), disposer), open: (id) => (calls.scenes.push({ open: id }), true) },
  tuiShortcuts: { register: (combo) => (calls.shortcuts.push(combo), disposer) },
  tuiCommandTrees: { register: (p) => (calls.trees.push(p), disposer) },
  tuiDialogs: { select: async () => undefined, confirm: async () => undefined, input: async () => undefined },
  settings: { register: (ns, schema, options) => (calls.namespaces.push({ ns, options }), {}) },
  commands: { register: (definition) => (calls.commands.push(definition), disposer) },
  tuiPluginHost: {
    subscribeDecision: (_ctx, event) => {
      calls.decisions.push(event)
      throw new Error("dsh-tui: Component identity is not verified for this activation")
    },
  },
}
const probes = []
const full = {
  get: (id) => (probes.push(id), services[id]),
  effect: (callback) => {
    callback()
    return {}
  },
  logger: { info: () => {}, warn: (m) => fullWarnings.push(m), debug: () => {} },
}
let fullThrew = null
try {
  mod.apply(full, { statusIntervalMs: 0 })
} catch (error) {
  fullThrew = String(error && error.message ? error.message : error)
}
check("apply() does not throw in a full composition", fullThrew === null, fullThrew)
check("every seam is probed with ctx.get(id, false)", ["tuiStatus", "tuiRenderers", "tuiSettingsSections", "tuiScenes", "tuiDialogs", "tuiShortcuts", "tuiCommandTrees"].every((id) => probes.includes(id)), probes.join(","))
check("tuiStatus received the mpd key", calls.status.some((entry) => entry.key === "mpd" && String(entry.text).startsWith("mpd:")))
check("tuiRenderers registered 11 event types", calls.renderers.length === 11, String(calls.renderers.length))
check("the settings section is the mpd.jsonc knob section", calls.sections.length === 1 && calls.sections[0].ns === "mpd" && calls.sections[0].fields.length === 6)
check("the board scene is registered", calls.scenes.some((entry) => entry.id === "mpd-tui-board"))
check("three shortcuts are registered", calls.shortcuts.join(",") === "alt+m,alt+w,alt+r", calls.shortcuts.join(","))
check("the command tree root matches the registered command", calls.trees.length === 1 && calls.trees[0].root === "mpd" && calls.commands.length === 1 && calls.commands[0].name === "mpd")
check("the settings namespace is registered", calls.namespaces.some((entry) => entry.ns === "mpd"))
check(
  "the decision seam attempts all four intercept points",
  calls.decisions.join(",") === "tui/input,tui/rewind-prompt,tui/session-switch,tui/compact",
  calls.decisions.join(","),
)
check(
  "the refusal is logged exactly once and discloses the gap",
  fullWarnings.filter((m) => m.includes("ready but NOT activated")).length === 1 &&
    fullWarnings.some((m) => m.includes("No input/rewind/session-switch/compact interception is claimed")),
  JSON.stringify(fullWarnings),
)
check("no seam disposer ran during apply (cleanup is fiber-owned)", disposed.count === 0, String(disposed.count))

const result = {
  entry: "packages/mpd-tui-plugin/dist/index.js",
  bytes: bytes.length,
  sha256,
  checks,
  failures,
  ok: failures.length === 0,
}
process.stdout.write(JSON.stringify(result, null, 2) + "\n")
process.exit(result.ok ? 0 : 1)
