// t12 (Reviewer) — INDEPENDENT attack on the member-route resolution and the slot read path.
//
// Written by the review lane, not by any implementation lane. It re-measures, on the settled tree:
//   * the REAL `mpd` profile block out of the shipped bundle patch (Bun.YAML.parse, never a copy),
//   * the REAL mpdConfig read path (`withTeamModelsDefaults` from the config plugin SOURCE) so the
//     fresh-workspace default route is exercised exactly as a member resolver reads it,
//   * staging into a TEMP stateRoot only (never the repository `.mpd/team`),
// and it asserts the failure semantics F1/F2/F3/F4/F5 + "no team state written".
//
// Run: bun evidence/model-slots/review/<ts>/driver/t12-slot-attack.mjs
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveTeamProfile } from "../../../../../packages/mpd-agent-teams-plugin/lib/profiles.ts"
import { initializeProfileTeam } from "../../../../../packages/mpd-agent-teams-plugin/lib/tools.ts"
import { withTeamModelsDefaults } from "../../../../../packages/mpd-config-plugin/src/index.ts"

const REPO = join(import.meta.dir, "..", "..", "..", "..", "..")
const PATCH = join(REPO, "packages", "mpd-bundle", "cordis.patch.yml")
const STATE_DIR = join(".mpd", "team")
const FALLBACK = { provider: "deepseek-official", model: "deepseek-v4-flash" }

const checks = []
const record = (id, ok, detail, extra = {}) => {
  checks.push({ id, ok: Boolean(ok), detail: String(detail), ...extra })
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`)
}

/** The REAL `mpd` profile from the shipped patch (the composition truth, not a fixture). */
function realProfile() {
  const doc = Bun.YAML.parse(readFileSync(PATCH, "utf8"))
  for (const row of doc) {
    if (row?.config?.profiles?.mpd !== undefined) return row.config.profiles.mpd
    for (const item of row?.insert ?? []) {
      if (item?.config?.profiles?.mpd !== undefined) return item.config.profiles.mpd
    }
  }
  throw new Error("the mpd profile block is missing from " + PATCH)
}

/**
 * A ctx whose `mpdConfig.get` is the REAL config layer's read path: the dot-path reducer over the
 * materialised resolved view — i.e. exactly `ctx.get("mpdConfig").get("teamModels.slot<N>")`.
 */
function ctxFromResolved(resolved, { catalogs = {}, resolveCallConfig, hasService = true } = {}) {
  const service = {
    get: (key) => key.split(".").reduce((acc, part) => (acc == null ? undefined : acc[part]), resolved),
  }
  return {
    get: (name) => (name === "mpdConfig" ? (hasService ? service : undefined) : undefined),
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    llm: {
      listModels: async (provider) => catalogs[provider] ?? [],
      resolveCallConfig: resolveCallConfig ?? (async (request) => ({ ...request })),
    },
  }
}

const captain = {
  id: "session-t12-review",
  status: "idle",
  options: { provider: "deepseek-official", model: "deepseek-v4-flash" },
  session: {
    header: { cwd: "/tmp" },
    requestHeader: () => ({ config: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" } }),
  },
}

function configWith(members) {
  return {
    stateDir: STATE_DIR,
    maxMembers: 16,
    memberProvider: "spawn",
    memberModel: "deepseek-v4-flash",
    executionPrompt: "do work",
    fallback: FALLBACK,
    memberMaxDepth: 1,
    profiles: { mpd: { taskPlanning: "captain", members } },
    sessionTeamPolicy: { name: "MPD Default", approval: "required" },
  }
}

function fixture() {
  const workspace = mkdtempSync(join(tmpdir(), "t12-review-"))
  return { stateRoot: join(workspace, STATE_DIR), cleanup: () => rmSync(workspace, { recursive: true, force: true }) }
}
const teamDirs = (stateRoot) => {
  try { return readdirSync(stateRoot).filter((name) => name !== "archive" && !name.startsWith(".")) } catch { return [] }
}
const stage = (ctx, config, stateRoot, teamId = "t12-review") =>
  initializeProfileTeam({
    ctx,
    config,
    memberSelections: new Map(),
    captain,
    exec: { signal: undefined },
    stateRoot,
    teamName: teamId,
    teamId,
    profileName: "mpd",
    description: "t12 review attack",
    staged: true,
  })

const FROZEN_TIERS = {
  Architect: 1, Planner: 1, Reviewer: 1, Lead: 1, "Senior Engineer": 1,
  Researcher: 2, Explorer: 2, "Plan Reviewer": 2,
  "Deep Worker": 3, "Junior Engineer": 3,
}

// ── A. the shipped patch carries tiers (no literals) ────────────────────────────────────────────
const profile = realProfile()
const membersOut = profile.members.map((m) => ({
  name: m.name,
  tier: m.tier,
  route: m.route,
  literals: ["provider", "model", "reasoning_effort"].filter((k) => k in m),
}))
record("B3-tier-mapping", membersOut.every((m) => (m.tier === undefined ? m.route !== undefined : m.tier === FROZEN_TIERS[m.name])) && membersOut.every((m) => m.literals.length === 0),
  JSON.stringify(membersOut))
const vision = membersOut.find((m) => m.name === "Vision Analyst")
record("B3-vision-explicit-route", vision !== undefined && vision.tier === undefined && vision.route?.model === "deepseek-v4-flash-vision-exp" && vision.route?.reasoningEffort === "high",
  JSON.stringify(vision))

// ── B. fresh-workspace defaults + the real read path ────────────────────────────────────────────
const rawFileConfig = {}
const materialised = withTeamModelsDefaults(rawFileConfig)
record("A2-fresh-defaults-materialised",
  materialised.teamModels?.slot1?.reasoningEffort === "max" && materialised.teamModels?.slot2?.reasoningEffort === "high"
  && materialised.teamModels?.slot3?.reasoningEffort === "high" && materialised.teamModels?.slot1?.model === "deepseek-v4-flash"
  && materialised.teamModels?.slot1?.provider === "deepseek-official",
  JSON.stringify(materialised.teamModels))
record("A2-read-path-does-not-mutate-input", Object.keys(rawFileConfig).length === 0, JSON.stringify(rawFileConfig))
const partial = withTeamModelsDefaults({ teamModels: { slot2: { model: "only-the-model" } } })
record("A2-partial-slot-merge", partial.teamModels.slot2.model === "only-the-model" && partial.teamModels.slot2.provider === "deepseek-official" && partial.teamModels.slot2.reasoningEffort === "high" && partial.teamModels.slot1.reasoningEffort === "max",
  JSON.stringify(partial.teamModels))

// ── C. B4: a real staging takes each member's route from its slot ───────────────────────────────
{
  const { stateRoot, cleanup } = fixture()
  try {
    const members = profile.members.map((m) => ({ name: m.name, role: m.role ?? "r", ...(m.tier === undefined ? { route: m.route } : { tier: m.tier }), fallback: FALLBACK }))
    await stage(ctxFromResolved(materialised), configWith(members), stateRoot)
    const staged = JSON.parse(readFileSync(join(stateRoot, "t12-review", "team.json"), "utf8")).members
    const routes = staged.map((m) => [m.name, m.provider, m.model, m.reasoningEffort])
    const by = Object.fromEntries(routes.map(([n, p, mo, e]) => [n, `${p}/${mo}@${e}`]))
    const slot1 = "deepseek-official/deepseek-v4-flash@max"
    const slot2 = "deepseek-official/deepseek-v4-flash@high"
    const slot3 = "deepseek-official/deepseek-v4-flash@high"
    const ok = ["Architect", "Planner", "Reviewer", "Lead", "Senior Engineer"].every((n) => by[n] === slot1)
      && ["Researcher", "Explorer", "Plan Reviewer"].every((n) => by[n] === slot2)
      && ["Deep Worker", "Junior Engineer"].every((n) => by[n] === slot3)
      && by["Vision Analyst"] === "deepseek-official/deepseek-v4-flash-vision-exp@high"
    record("B4-staged-routes-from-slots", ok, JSON.stringify(by))
  } finally { cleanup() }
}

// ── D. F4: unknown slot model → loud, no state ──────────────────────────────────────────────────
{
  const { stateRoot, cleanup } = fixture()
  try {
    const broken = withTeamModelsDefaults({ teamModels: { slot2: { model: "ghost-model" } } })
    const members = [{ name: "Researcher", role: "r", tier: 2, fallback: FALLBACK }]
    let message = ""
    try { await stage(ctxFromResolved(broken, { catalogs: { "deepseek-official": [{ id: "deepseek-v4-flash" }] } }), configWith(members), stateRoot) }
    catch (e) { message = String(e?.message ?? e) }
    record("F4-unknown-model-names-member-and-slot", /member "Researcher" route from teamModels\.slot2 failed: unknown member model "ghost-model"/.test(message), message)
    record("F4-no-team-state", teamDirs(stateRoot).length === 0, JSON.stringify(teamDirs(stateRoot)))
  } finally { cleanup() }
}

// ── E. F5: unsupported effort arrives verbatim (never clamped) → loud, no state ─────────────────
{
  const { stateRoot, cleanup } = fixture()
  try {
    const seen = []
    const broken = withTeamModelsDefaults({ teamModels: { slot1: { reasoningEffort: "ultra" } } })
    const ctx = ctxFromResolved(broken, {
      resolveCallConfig: async (request) => {
        seen.push(request)
        const error = new Error(`provider "deepseek-official" model "deepseek-v4-flash" does not support reasoning effort "ultra"`)
        error.code = "UNSUPPORTED_REASONING_EFFORT"
        throw error
      },
    })
    let message = ""
    try { await stage(ctx, configWith([{ name: "Architect", role: "r", tier: 1, fallback: FALLBACK }]), stateRoot) }
    catch (e) { message = String(e?.message ?? e) }
    record("F5-effort-reaches-adapter-verbatim", seen[0]?.reasoningEffort === "ultra", JSON.stringify(seen[0]))
    record("F5-unsupported-effort-names-member-and-slot", /member "Architect" route from teamModels\.slot1 failed:.*UNSUPPORTED|member "Architect" route from teamModels\.slot1 failed: provider .* does not support reasoning effort "ultra"/.test(message), message)
    record("F5-no-team-state", teamDirs(stateRoot).length === 0, JSON.stringify(teamDirs(stateRoot)))
  } finally { cleanup() }
}

// ── F. F1: no mpdConfig service → loud, no state ────────────────────────────────────────────────
{
  const { stateRoot, cleanup } = fixture()
  try {
    let message = ""
    try { await stage(ctxFromResolved(materialised, { hasService: false }), configWith([{ name: "Deep Worker", role: "r", tier: 3, fallback: FALLBACK }]), stateRoot) }
    catch (e) { message = String(e?.message ?? e) }
    record("F1-service-absent-names-member-and-slot", /member "Deep Worker" is routed by teamModels\.slot3 but the mpdConfig service/.test(message), message)
    record("F1-no-team-state", teamDirs(stateRoot).length === 0, JSON.stringify(teamDirs(stateRoot)))
  } finally { cleanup() }
}

// ── G. F2/F3: an edge service that answers undefined / a blank leaf → loud, never a substitution ─
{
  const { stateRoot, cleanup } = fixture()
  try {
    // An older/edge config layer that materialises nothing: `slot3` answers undefined.
    const service = { get: (key) => (key === "teamModels.slot3" ? undefined : {}) }
    const ctx = { get: (name) => (name === "mpdConfig" ? service : undefined), logger: { warn: () => {} }, llm: { listModels: async () => [], resolveCallConfig: async (r) => ({ ...r }) } }
    let message = ""
    try { await stage(ctx, configWith([{ name: "Deep Worker", role: "r", tier: 3, fallback: FALLBACK }]), stateRoot) }
    catch (e) { message = String(e?.message ?? e) }
    record("F2-empty-slot-answered-undefined", /which is NOT configured/.test(message), message)

    const blank = { get: (key) => (key === "teamModels.slot3" ? { provider: "   ", model: "m", reasoningEffort: "low" } : {}) }
    const ctx2 = { get: (name) => (name === "mpdConfig" ? blank : undefined), logger: { warn: () => {} }, llm: { listModels: async () => [], resolveCallConfig: async (r) => ({ ...r }) } }
    let message2 = ""
    try { await stage(ctx2, configWith([{ name: "Deep Worker", role: "r", tier: 3, fallback: FALLBACK }]), stateRoot) }
    catch (e) { message2 = String(e?.message ?? e) }
    record("F3-blank-leaf-is-incomplete-not-defaulted", /which is INCOMPLETE \(missing provider\)/.test(message2), message2)
    record("F2/F3-no-team-state", teamDirs(stateRoot).length === 0, JSON.stringify(teamDirs(stateRoot)))
  } finally { cleanup() }
}

// ── H. F7: a member with NEITHER tier nor route keeps the captain-derived behaviour ─────────────
{
  const { stateRoot, cleanup } = fixture()
  try {
    await stage(ctxFromResolved(materialised), configWith([{ name: "Architect", role: "r", fallback: FALLBACK }]), stateRoot)
    const staged = JSON.parse(readFileSync(join(stateRoot, "t12-review", "team.json"), "utf8")).members
    record("F7-no-slot-source-keeps-captain-route",
      staged[0].provider === "deepseek-official" && staged[0].model === "deepseek-v4-flash" && staged[0].reasoningEffort === "high",
      JSON.stringify([staged[0].provider, staged[0].model, staged[0].reasoningEffort]))
  } finally { cleanup() }
}

// ── I. B2: `tier` + `route` on ONE member is refused, naming the member and both keys ───────────
{
  let message = ""
  try {
    resolveTeamProfile({ mpd: { taskPlanning: "captain", members: [{ name: "Architect", role: "r", tier: 1, route: { provider: "p", model: "m" } }] } }, "mpd", 16)
  } catch (e) { message = String(e?.message ?? e) }
  record("B2-both-tier-and-route-refused", /member "Architect" declares both "tier" and "route"/.test(message), message)
}

const failed = checks.filter((c) => !c.ok)
const payload = { task: "t12", driver: "t12-slot-attack.mjs", verifiedAt: new Date().toISOString(), checks, failed: failed.map((c) => c.id) }
writeFileSync(join(import.meta.dir, "..", "t12-slot-attack.json"), JSON.stringify(payload, null, 2) + "\n")
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${failed.length ? " — FAILED: " + failed.map((c) => c.id).join(", ") : ""}`)
if (failed.length > 0) process.exit(1)
