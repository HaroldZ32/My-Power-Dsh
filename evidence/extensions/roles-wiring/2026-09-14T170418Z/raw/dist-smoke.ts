// t4 shipped-artifact smoke: drive the REAL dists of mpd-ext + mpd-roles (the exact bytes the
// bundle patch loads) over one stub ctx, and read the extension-role surface through every
// consumer (mpd_roles_list / mpd_role_spawn / mpd_role_persona / the mpdRoles service).
// Run: bun evidence/extensions/roles-wiring/<ts>/raw/dist-smoke.mjs
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply as applyExt } from "../../../../../packages/mpd-ext-plugin/dist/index.js"
import { apply as applyRoles, READONLY_DENY } from "../../../../../packages/mpd-roles-plugin/dist/index.js"

const services = {}
const tools = []
const spawned = []
const provided = {}
const warnings = []
const ctx = {
  logger: { warn: (line) => warnings.push(String(line)) },
  tools: { register: (definition) => { tools.push(definition); return definition } },
  skills: { registerProvider: () => {} },
  subagents: { start: async (_kind, options) => { spawned.push(options); return { result: { structured: { role: "x", summary: "done" }, stopReason: "complete" } } } },
  provide: (name, value) => { provided[name] = value; services[name] = value },
  get: (name) => services[name],
}
const exec = { agent: { id: "agent-1" }, signal: new AbortController().signal }

applyExt(ctx, {})
applyRoles(ctx, {})

const root = mkdtempSync(join(tmpdir(), "mpd-roles-dist-smoke-"))
mkdirSync(join(root, "personas"), { recursive: true })
writeFileSync(join(root, "personas", "verilog-reviewer.md"), "# Verilog Reviewer\nReview SystemVerilog read-only. Never edit a file.")

const registered = services.mpdExtensions.register({
  apiVersion: 1,
  id: "rtl-verilog",
  description: "RTL flow",
  contributes: {
    roles: [{
      name: "Verilog Reviewer",
      description: "Reviews SystemVerilog RTL",
      readonly: true,
      persona: "personas/verilog-reviewer.md",
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
    }],
  },
}, { root })

const byName = (name) => tools.find((tool) => tool.name === name)
const listed = await byName("mpd_roles_list").execute({}, exec)
const spawnedRole = await byName("mpd_role_spawn").execute({ role: "verilog reviewer", task: "review the RTL" }, exec)
const persona = await byName("mpd_role_persona").execute({ role: "Verilog Reviewer" }, exec)
const serviceEntry = provided.mpdRoles.get("Verilog Reviewer")

const result = {
  registered: registered.ok,
  listCount: listed.count,
  extensionEntry: listed.roles.find((role) => role.name === "Verilog Reviewer") ?? null,
  refused: listed.refused,
  render: byName("mpd_roles_list").output.render({}, listed)[0].text.split("\n").filter((line) => line.includes("Verilog Reviewer") || line.includes("refused")),
  spawnLabel: spawned[0]?.label ?? null,
  spawnRole: spawnedRole.role,
  spawnDenyIsReadonlyList: JSON.stringify(spawned[0]?.toolFilter?.deny ?? null) === JSON.stringify(READONLY_DENY),
  spawnPersonaCarriesExtensionText: String(spawned[0]?.persona ?? "").includes("Never edit a file"),
  personaRole: persona.role,
  serviceEntry: serviceEntry === null ? null : { id: serviceEntry.id, name: serviceEntry.name, readonly: serviceEntry.readonly, chain: serviceEntry.chain, personaHasExtensionText: String(serviceEntry.persona).includes("SystemVerilog") },
  baseEntryStillIntact: provided.mpdRoles.get("Deep Worker").id,
  warnings,
}
console.log(JSON.stringify(result, null, 2))
const ok = result.registered && result.listCount === 12 && result.refused.length === 0
  && result.spawnLabel === "Verilog Reviewer" && result.spawnDenyIsReadonlyList
  && result.spawnPersonaCarriesExtensionText && result.serviceEntry?.id === "ext-rtl-verilog-verilog-reviewer"
  && result.baseEntryStillIntact === "hephaestus"
console.log("[dist-smoke] " + (ok ? "PASS" : "FAIL"))
process.exit(ok ? 0 : 1)
