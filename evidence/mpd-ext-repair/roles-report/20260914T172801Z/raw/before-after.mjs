#!/usr/bin/env bun
// t14 BEFORE/AFTER probe: drive mpd-ext's own reporting tools over ONE fixture and
// print, as JSON, what the two surfaces say about the same roles.
//
// It reads no state outside its own temp HOME/workspace, and it is source-agnostic:
// run it with the pre-fix registry.ts in place to capture the BEFORE values, and with
// the fixed one to capture the AFTER values (see run-before-after.sh).
//
// The comparison surface is deliberate: `mpd_ext_list` reports the contribution COUNT
// plus every error/pending line, and `mpd_ext_show` reports the usable role NAMES —
// so a refused role must disappear from `roles`/`contributions.roles` and appear as a
// `refused:` error line. The ROSTER's own per-call resolver is asked the same question
// so the two answers can be compared mechanically.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "../../../../..")
const load = (relative) => import(pathToFileURL(join(repoRoot, relative)).href)

// argv[2] selects the artifact under measurement:
//   `src`  = packages/mpd-ext-plugin/src/index.ts          (the fixed source)
//   `dist` = packages/mpd-ext-plugin/dist/index.js         (the PRE-fix shipped build)
// Both are real code paths; `dist` is the artifact that shipped before this task, so
// its values are the BEFORE measurement, not a re-enactment.
const which = process.argv[2] ?? "src"
const ext = await load(which === "dist" ? "packages/mpd-ext-plugin/dist/index.js" : "packages/mpd-ext-plugin/src/index.ts")
const sdk = await load("packages/mpd-ext-plugin/src/sdk.ts")
const roster = await load("packages/mpd-roles-plugin/src/index.ts")
if (which === "dist" && typeof ext.apply !== "function") throw new Error("dist/index.js does not export apply")

// ── fixture: one healthy role + one role per refusal class + a cross-extension dup ──
const home = mkdtempSync(join(tmpdir(), "t14-home-"))
const workspace = mkdtempSync(join(tmpdir(), "t14-ws-"))
const userRoot = join(home, ".mpd", "extensions")

function writeExtension(id, contributes, extra = {}, personas = {}) {
  const dir = join(userRoot, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, sdk.MPD_EXT_CONTRACT.manifestFile), `${JSON.stringify({
    apiVersion: sdk.MPD_EXT_API_VERSION, id, description: `The ${id} extension`, contributes, ...extra,
  }, null, 2)}\n`)
  for (const [name, body] of Object.entries(personas)) {
    mkdirSync(join(dir, dirname(name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

// alpha-owner: healthy + base-name collision (case-insensitive) + unreadable persona
writeExtension("alpha-owner", {
  roles: [
    { name: "Verilog Reviewer", persona: "ok.md" },
    { name: "Architect", persona: "ok.md" },
    { name: "Roster Clone", persona: "missing.md" },
  ],
}, { enabled: true }, { "ok.md": "healthy persona" })
// zeta-clone: a CROSS-extension duplicate of the healthy name
writeExtension("zeta-clone", { roles: [{ name: "Verilog Reviewer", persona: "ok.md" }] }, { enabled: true }, { "ok.md": "clone" })

// A PROJECT-plane extension declaring a role too: the contract rejects that item
// ("tool and skill-provider registration is process-global, so only the host-wide
// roots may contribute MCP servers and roles"). Whether the ROSTER honours that
// rejection is a separate question this probe also answers.
const projectRoot = join(workspace, ".mpd", "extensions", "proj-ext")
mkdirSync(projectRoot, { recursive: true })
writeFileSync(join(projectRoot, sdk.MPD_EXT_CONTRACT.manifestFile), `${JSON.stringify({
  apiVersion: sdk.MPD_EXT_API_VERSION,
  id: "proj-ext",
  description: "The proj-ext extension",
  contributes: { roles: [{ name: "Project Role", persona: "p.md" }] },
}, null, 2)}\n`)
writeFileSync(join(projectRoot, "p.md"), "project persona")

process.env.HOME = home

// ── drive the two tools through a fake-but-real ctx ─────────────────────────────────
const registered = []
const provided = {}
const ctx = {
  logger: { warn: () => {}, info: () => {}, error: () => {} },
  get: () => undefined,
  provide: (key, value) => { provided[key] = value },
  tools: { register: (definition) => { registered.push(definition); return () => {} }, guard: () => () => {}, get: () => undefined, execute: async () => ({}) },
  skills: { registerProvider: () => () => {} },
}
ext.apply(ctx, { quiet: true })
const exec = { agent: { session: { header: { cwd: workspace } } } }
const tool = (name) => registered.find((definition) => definition.name === name)
const listed = await tool("mpd_ext_list").execute({}, exec)
const shown = await tool("mpd_ext_show").execute({ id: "alpha-owner" }, exec)
const shownClone = await tool("mpd_ext_show").execute({ id: "zeta-clone" }, exec)

// ── what the ROSTER itself resolves for the same call ──────────────────────────────
const rosterCtx = { get: (key) => (key === "mpdExtensions" ? provided.mpdExtensions : undefined) }
const resolved = roster.extensionRoles(rosterCtx, exec, () => {})
const views = provided.mpdExtensions.list({ exec }).extensions

const pick = (entry) => ({
  contributions_roles: entry.contributions.roles,
  roles: views.find((view) => view.id === entry.id)?.roles ?? null,
  pending_roles: entry.pending.filter((line) => line.item === "contributes.roles").map((line) => line.reason),
  errors: entry.errors.map((line) => `${line.item}: ${line.reason}`),
})

const report = {
  artifact: which === "dist" ? "packages/mpd-ext-plugin/dist/index.js (PRE-fix shipped build)" : "packages/mpd-ext-plugin/src/index.ts (fixed source)",
  fixture: "alpha-owner (healthy + base-name collision + unreadable persona) and zeta-clone (cross-extension duplicate)",
  mpd_ext_list: {
    alpha_owner: pick(listed.extensions.find((entry) => entry.id === "alpha-owner")),
    zeta_clone: pick(listed.extensions.find((entry) => entry.id === "zeta-clone")),
  },
  mpd_ext_show: { alpha_owner_roles: shown.roles, zeta_clone_roles: shownClone.roles },
  project_plane: {
    // The ext side reports the contract rejection and exposes nothing.
    ext_roles: views.find((view) => view.id === "proj-ext")?.roles ?? null,
    ext_errors: (listed.extensions.find((entry) => entry.id === "proj-ext")?.errors ?? []).map((line) => `${line.item}: ${line.reason}`),
    // The roster side: does it honour that rejection?
    roster_exposes: resolved.roles.filter((role) => role.extension === "proj-ext").map((role) => role.name),
  },
  roster_resolution: {
    exposed: resolved.roles.map((role) => `${role.extension}:${role.name}`).sort(),
    refused: resolved.refused.map((refusal) => refusal.reason).sort(),
  },
}
// The exact sentence the stale note carried: its presence IS the F3 defect.
report.stale_sentence_present = JSON.stringify(listed).includes("not yet exposed through mpd_roles_list")
// The F4 defect: a role the ROSTER refuses FOR THIS EXTENSION but the ext report still
// lists as usable (the pair matters: "Verilog Reviewer" is legitimately usable in the
// first extension and refused in the second).
const refusedPairs = new Set(resolved.refused.map((refusal) => `${refusal.extension}\u0000${refusal.name}`))
report.refused_names_listed_as_usable = ["alpha-owner", "zeta-clone"].flatMap((id) => {
  const usable = views.find((view) => view.id === id)?.roles ?? []
  return usable.filter((name) => refusedPairs.has(`${id}\u0000${name}`)).map((name) => `${id}:${name}`)
})

console.log(JSON.stringify(report, null, 2))
rmSync(home, { recursive: true, force: true })
rmSync(workspace, { recursive: true, force: true })
