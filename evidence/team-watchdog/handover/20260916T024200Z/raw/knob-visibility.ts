// w16 / t86 visibility probe — `watchdog.toolInFlightMaxMs` must be DECLARED once and RENDERED by
// both front doors. The probe shape is the one w4/t61 used in `team-watchdog-config.mjs` (read the
// ONE declaration, then the artifacts the front doors ship) plus the real Web card driven through
// the bundle's own client harness, so "declared" and "rendered" are measured, never assumed.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { SETTINGS_KNOBS, SettingsSchema } from "/root/dshProj/my-power-dsh/packages/mpd-config-plugin/src/settings-schema"
import { loadMpdClient } from "/root/dshProj/my-power-dsh/packages/mpd-bundle-plugin/test/client-harness.mjs"

const REPO = "/root/dshProj/my-power-dsh"
const PKG = join(REPO, "packages")
const OUT = join(REPO, "evidence", "team-watchdog", "handover", "20260916T024200Z", "raw", "knob-visibility.result.json")
const KEY = "toolInFlightMaxMs"
const PATH = "watchdog.toolInFlightMaxMs"
const SEMANTICS = "how long ONE tool call may run before it stops explaining a silent member: past this bound the call is reported ONCE as a `tool-expired` incident (a warning — never a scene, never a hold, never an escalation), and `0` disables the bound"

const sha = (text) => createHash("sha256").update(text).digest("hex")
const schemaSource = readFileSync(join(PKG, "mpd-config-plugin", "src", "settings-schema.ts"), "utf8")
const tuiDist = readFileSync(join(PKG, "mpd-tui-plugin", "dist", "index.js"), "utf8")
const clientBytes = readFileSync(join(PKG, "mpd-bundle-plugin", "client.js"), "utf8")

// 1) the ONE declaration: the knob exists, with the same default both doors read.
const schemaDefaults = SettingsSchema({})
const knob = SETTINGS_KNOBS.find((entry) => entry.path.join(".") === PATH)

// 2) the TUI front door ships the knob (its section is built from SETTINGS_KNOBS, which the build
//    INLINES into the dist as an array entry: `{ path: ["watchdog","toolInFlightMaxMs"], ... }`).
const tuiCarriesTheEntry = tuiDist.includes(KEY) && tuiDist.includes(`["watchdog", "${KEY}"]`)
const tuiEntryHasLabelAndZh = tuiDist.includes(knob.label) && tuiDist.includes(knob.zh)
const tuiEntryHasHint = tuiDist.includes(SEMANTICS)

// 3) the Web front door RENDERS it, driven through the real harness + hook runtime.
const READY = {
  status: "ready", mode: "host", writable: true, revision: 3,
  value: { watchdog: { toolInFlightMaxMs: 900000 } },
  user: {},
}
const scope = { bind: () => ({ getSnapshot: () => READY, subscribe: () => () => {}, mutate: async () => {}, dispose: () => {} }) }
const client = loadMpdClient({ services: { settingsScope: scope } })
client.exports.apply(client.ctx)
const section = (client.calls.slotsRegistered ?? []).find((definition) => definition.name === "settings.section")
const face = section.inject()
// The card resolves its row text through the registration's LOCALE DICTIONARIES (`t(key)` /
// `t(key + ".hint")`), so the front-door proof must use those dictionaries — rendering with an
// identity `t` would hide the user-visible text.
const dictionaries = (client.calls.localeDictionaries ?? []).find((entry) => entry.namespace === "mpdSettings")?.dictionaries
const en = dictionaries?.en ?? {}
const zh = dictionaries?.zh ?? {}
const tree = await client.hooks.render(section.component, {
  useMpdCard: (selector) => selector(face.hooks.mpdCard.getSnapshot()),
  t: (key) => en[key] ?? key,
})
const strings = []
;(function walk(node) {
  if (node === null || node === undefined) return
  if (typeof node === "string" || typeof node === "number") { strings.push(String(node)); return }
  if (Array.isArray(node)) { for (const child of node) walk(child); return }
  if (Array.isArray(node.props?.children)) { for (const child of node.props.children) walk(child); return }
  walk(node.props?.children)
})(tree)
// Every declared row is rendered when its dotted path appears in the row's hint text.
const renderedPaths = SETTINGS_KNOBS.map((entry) => entry.path.join(".")).filter((path) => strings.some((text) => text.includes(path)))

const result = {
  what: "w16/t86 — watchdog.toolInFlightMaxMs declared once and rendered by both front doors",
  declaration: {
    path: "packages/mpd-config-plugin/src/settings-schema.ts",
    sha256: sha(schemaSource),
    knobCount: SETTINGS_KNOBS.length,
    knobPresent: knob !== undefined,
    knob: knob === undefined ? null : { path: knob.path.join("."), label: knob.label, zh: knob.zh, kind: knob.kind, hint: knob.hint },
    schemaDefault: schemaDefaults.watchdog?.[KEY],
    schemaDeclaration: schemaSource.includes(`${KEY}: z.number().default(900000)`),
    hintIsTheSemanticsSentence: knob?.hint === SEMANTICS,
    semanticsAppearsInSchema: schemaSource.includes(SEMANTICS),
  },
  tuiFrontDoor: {
    artifact: "packages/mpd-tui-plugin/dist/index.js",
    bytes: Buffer.byteLength(tuiDist),
    sha256: sha(tuiDist),
    carriesTheEntry: tuiCarriesTheEntry,
    entryCarriesLabelAndZh: tuiEntryHasLabelAndZh,
    entryCarriesTheSemanticsSentence: tuiEntryHasHint,
    derivesFromTheOneList: readFileSync(join(PKG, "mpd-tui-plugin", "src", "settings.ts"), "utf8").includes("SETTINGS_KNOBS.map("),
    fieldCount: 12,
    fieldCountEvidence: "packages/mpd-tui-plugin/test/plugin.test.ts asserts calls.sections[0].fields has length 12 on the real plugin",
  },
  webFrontDoor: {
    artifact: "packages/mpd-bundle-plugin/client.js",
    bytes: Buffer.byteLength(clientBytes),
    sha256: sha(clientBytes),
    renderedRows: renderedPaths.length,
    rendersTheKnob: renderedPaths.includes(PATH),
    renderedLabel: strings.includes(knob?.label ?? ""),
    renderedZhRowInTheZhDictionary: zh[PATH] === knob?.zh,
    renderedSemantics: strings.some((text) => text.includes(SEMANTICS)),
    zeroIsDocumented: strings.some((text) => text.includes("0 = no bound")) && zh[PATH]?.includes("0 表示不设上限") === true,
    hintCarriesTheBridgeDisclosure: (en[PATH + ".hint"] ?? "").includes("a save writes <workspace>/.mpd/mpd.jsonc"),
  },
  zeroDisablesTheBound: { engineReads: "packages/mpd-team-watchdog-plugin/src/machine.ts only applies the bound when knobs.toolInFlightMaxMs > 0", toolExpiredOnce: "reported ONCE per task+attempt as a WARN-class `tool-expired` incident (no scene, no hold, no escalate)" },
  nothingElseChanged: "no other assertion loosened: the two hard-coded counts moved 11 -> 12 (settings-card.test.mjs, mpd-tui-plugin/test/plugin.test.ts); every existing knob assertion is untouched",
}
writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))

const faults = []
if (result.declaration.knobPresent !== true) faults.push("the knob is not in SETTINGS_KNOBS")
if (result.declaration.schemaDefault !== 900000) faults.push("the schema default is not 900000")
if (result.declaration.hintIsTheSemanticsSentence !== true) faults.push("the semantics sentence is not the declaration's hint")
if (result.tuiFrontDoor.carriesTheEntry !== true) faults.push("the TUI dist does not carry the knob entry")
if (result.tuiFrontDoor.entryCarriesLabelAndZh !== true) faults.push("the TUI dist entry carries no label/zh")
if (result.tuiFrontDoor.entryCarriesTheSemanticsSentence !== true) faults.push("the TUI dist entry carries no semantics hint")
if (result.webFrontDoor.rendersTheKnob !== true) faults.push("the Web card does not render the knob")
if (result.webFrontDoor.renderedRows !== SETTINGS_KNOBS.length) faults.push("the Web card did not render every declared row")
if (result.webFrontDoor.renderedLabel !== true) faults.push("the Web card does not render the knob's label")
if (result.webFrontDoor.renderedZhRowInTheZhDictionary !== true) faults.push("the zh dictionary does not carry the knob row")
if (result.webFrontDoor.renderedSemantics !== true) faults.push("the Web card does not render the semantics sentence")
if (result.webFrontDoor.zeroIsDocumented !== true) faults.push("the rendered rows do not state that 0 disables the bound")
if (result.webFrontDoor.hintCarriesTheBridgeDisclosure !== true) faults.push("the knob's hint lost the shared bridge disclosure")
if (faults.length > 0) { console.error("VISIBILITY-FAIL " + JSON.stringify(faults)); process.exit(1) }
console.log("VISIBILITY-OK")
