// Gate driver (AGENTS.md §4 MOUNT / row-config conformance): prove the retiered
// `mpd` team profile is accepted by the REAL loader schema and resolves to the
// intended member routes.
//
//   - `Config.parse` IS what the loader runs for the agent-teams row, so a bad
//     member key (e.g. a misspelled reasoning_effort) fails here exactly as it
//     would abort the row at boot.
//   - `resolveTeamProfile` IS what agent_teams_create(profile:"mpd") runs, so the
//     resolved member list/effort here is the list a team actually receives.
//
// Anchored on the real files: the patch row is read from the bundle patch, and
// the schema/normalizer come from the shipped plugin module (no re-implementation).
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pathToFileURL } from "node:url"

// Repo root from this file's own location (evidence/<domain>/<slug>/<ts>/ -> root),
// so the driver is independent of the invoking cwd; the plugin modules are then
// imported through absolute file URLs.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const libDir = join(ROOT, "packages", "mpd-agent-teams-plugin", "lib")
const { Config } = await import(pathToFileURL(join(libDir, "index.js")).href)
const { resolveTeamProfile } = await import(pathToFileURL(join(libDir, "profiles.js")).href)
const PATCH = join(ROOT, "packages", "mpd-bundle", "cordis.patch.yml")
const EX_PRO = ["Architect", "Planner", "Reviewer", "Lead", "Senior Engineer"]
const FLASH = "deepseek-v4-flash"
const results = []
const fail = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) fail.push(name + (detail === undefined ? "" : " :: " + detail))
}

// 1. Pull the agent-teams row config out of the REAL patch (bun reads yaml natively).
const patch = Bun.YAML.parse(readFileSync(PATCH, "utf8"))
// The patch is a LIST of layer documents, each carrying its own rows under
// `resolve` (id-targeted / inserted rows live in separate documents).
const layers = Array.isArray(patch) ? patch : [patch]
const rows = layers.flatMap((layer) => [...(layer?.resolve ?? []), ...(layer?.insert ?? [])])
const row = rows.find((r) => r?.id === "agent-teams")
check("patch carries the agent-teams row", row !== undefined)
if (row === undefined) {
  writeFileSync(join(ROOT, process.argv[2] ?? ".", "result.json"), JSON.stringify({ results, fail }, null, 2))
  console.error("FAIL: no agent-teams row in " + PATCH)
  process.exit(1)
}
check("row resolves the adopted main-code entry", String(row.name).includes("mpd-agent-teams-plugin/lib/index.js"), String(row.name))

// 2. The loader's own schema must ACCEPT the row config (this is the boot gate).
// Schemastery's Config is a FUNCTION: calling it validates and returns the
// normalized config (defaults applied) — exactly what the loader does per row.
let parsed
try {
  parsed = Config(row.config)
  check("Config(row.config) accepts the row (loader conformance)", parsed !== undefined && parsed.profiles !== undefined)
} catch (e) {
  check("Config.parse accepts the row (loader conformance)", false, String(e?.message ?? e))
}

// 3. Negative control: the assertion is falsifiable — a bad effort value must be
//    REJECTED by the same schema, so a green result above is not vacuous.
try {
  Config({ ...row.config, profiles: { mpd: { members: [{ name: "Architect", provider: "deepseek-official", model: FLASH, reasoning_effort: 42 }] } } })
  check("negative control: a non-string effort is rejected", false, "schema accepted reasoning_effort=42")
} catch (e) {
  check("negative control: a non-string effort is rejected", /reasoning_effort expected string/.test(String(e?.message ?? e)), String(e?.message ?? e))
}

// 4. Resolve the profile exactly as team-create does (maxMembers from the row).
const maxMembers = Number(parsed?.maxMembers ?? 16)
const profile = resolveTeamProfile(parsed.profiles, "mpd", maxMembers)
const byName = new Map(profile.members.map((m) => [m.name, m]))
check("profile resolves 11 members", profile.members.length === 11, "got " + profile.members.length)

// 5. Every ex-pro member is flash + max effort.
for (const name of EX_PRO) {
  const member = byName.get(name)
  if (member === undefined) { check("member " + name + " present", false); continue }
  check(name + ": model flash", member.model === FLASH, String(member.model))
  check(name + ": reasoningEffort max", member.reasoningEffort === "max", String(member.reasoningEffort))
}
// 6. The other six keep their previous tier (flash-family) and NO forced effort.
for (const name of ["Researcher", "Explorer", "Deep Worker", "Junior Engineer", "Plan Reviewer", "Vision Analyst"]) {
  const member = byName.get(name)
  check(name + ": effort untouched", member?.reasoningEffort === undefined, String(member?.reasoningEffort))
}
check("Vision Analyst keeps the vision model", byName.get("Vision Analyst")?.model === "deepseek-v4-flash-vision-exp")

// 7. No pro tier is reachable from the resolved profile (primary or fallback).
const pro = profile.members.filter((m) => m.model === "deepseek-v4-pro" || m.fallback?.model === "deepseek-v4-pro")
check("no member routes to the pro tier (primary or fallback)", pro.length === 0, pro.map((m) => m.name).join(","))

// 8. The one-shot roster (surface B) is retiered too, and the ONLY surviving pro
//    reference there is Plan Reviewer's fallback tier (the deliberate analogue).
const roles = readFileSync(join(ROOT, "packages", "mpd-roles-plugin", "src", "roles.data.ts"), "utf8")
const proLines = roles.split("\n").filter((l) => l.includes("deepseek-v4-pro"))
check("roster keeps exactly one pro reference (Plan Reviewer fallback)", proLines.length === 1, proLines.join(" | "))
const rosterPrimary = [...roles.matchAll(/"(?:id|name)": "([^"]+)",[\s\S]*?"chain": \[\s*\{ "provider": "deepseek-official", "model": "([^"]+)" \}/g)]
check("roster scans 11 primary routes", rosterPrimary.length === 11, "got " + rosterPrimary.length)
const rosterPro = rosterPrimary.filter(([, , model]) => model === "deepseek-v4-pro")
check("no roster primary route is the pro tier", rosterPro.length === 0, rosterPro.map((m) => m[1]).join(","))

const passed = results.filter((r) => r.ok).length
const payload = { at: new Date().toISOString(), patch: PATCH, results, passed, failed: fail.length, fail }
writeFileSync(join(ROOT, process.argv[2] ?? ".", "result.json"), JSON.stringify(payload, null, 2))
console.log("checks: " + passed + "/" + results.length + " passed")
if (fail.length > 0) { console.error("FAIL:\n - " + fail.join("\n - ")); process.exit(1) }
console.log("OK: retiered mpd profile conforms to the loader schema and resolves flash+max")
