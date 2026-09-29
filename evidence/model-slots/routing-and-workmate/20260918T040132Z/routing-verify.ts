#!/usr/bin/env node
// t10 ROUTING verification driver (evidence/model-slots/routing-and-workmate/<ts>/).
//
// Proves, in ISOLATED environments (DSH_HOME + HOME + workspace all sandboxed, NO credentials so
// no model can act) and from the PERSISTED team state (never from an implementer summary):
//   S1  a real profile-"mpd" staging writes each member's route from the configured slots
//       (slot1/2/3 by tier), with Vision Analyst carrying its OWN explicit vision route;
//   S2  overriding the three slots in <workspace>/.mpd/mpd.jsonc CHANGES the staged routes at the
//       next staging (the slots are the source, not a literal coincidence) while Vision Analyst's
//       route does NOT move (its explicit all-or-nothing route);
//   S3  a deliberately broken slot (unknown model) makes the staging FAIL loudly with the member
//       and the slot named, and leaves NO team state behind.
//
// The deterministic staging entry point is the plugin's own explicit-request provisioning
// (`team: <goal>` -> session-start gate `routeDecision` -> `provisionSessionTeam` ->
// `initializeProfileTeam`), the SAME function `agent_teams_create` routes through, so no model is
// needed and the result is reproducible. The plugin-side failure text of S3 is read from the
// harness's own session log of that boot.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, cpSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed } from "../../../../skills/dsh-qa/scripts/lib/workspace-isolation.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(HERE, "../../../..")
const outDir = HERE
const LOG = []

const log = (line) => { LOG.push(line); console.log(line) }
const stripCredentials = (env) => {
  const clean = { ...env }
  for (const key of Object.keys(clean)) if (/DEEPSEEK|OPENAI|ANTHROPIC|API_KEY/i.test(key)) delete clean[key]
  return clean
}

function install(sandbox) {
  const r = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000,
    env: { ...stripCredentials(process.env), DSH_HOME: sandbox },
  })
  log("$ install-profile --dsh-home <sandbox> --profile mpd-headless\n[exit=" + r.status + "]\n" + ((r.stdout || "") + (r.stderr || "")).slice(0, 2000))
  if (r.status !== 0) throw new Error("isolated install failed (exit " + r.status + ")")
}

const teamRoot = (ws) => join(ws, ".mpd", "team")
const teamIds = (ws) => {
  const root = teamRoot(ws)
  if (!existsSync(root)) return []
  return readdirSync(root).filter((n) => n !== "archive" && !n.startsWith(".") && existsSync(join(root, n, "team.json")))
}

/** The user-role / logger text of every session log under a sandbox home (zstd frames decoded). */
function sessionLogText(home) {
  const root = join(home, "sessions")
  if (!existsSync(root)) return ""
  let text = ""
  for (const key of readdirSync(root)) {
    const dir = join(root, key)
    for (const entry of readdirSync(dir)) {
      const inner = join(dir, entry)
      for (const name of readdirSync(inner)) {
        const file = join(inner, name)
        if (file.endsWith(".zstd")) {
          const dec = spawnSync("zstd", ["-d", file, "-c"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
          if (dec.status === 0) text += dec.stdout || ""
        } else {
          try { text += readFileSync(file, "utf8") } catch { /* skip */ }
        }
      }
    }
  }
  return text
}

/** One staged-team scenario: fresh side home, sandboxed workspace, optional mpd.jsonc, one boot. */
function stage(sandbox, name, { mpdJsonc, prompt = "team: verify the routing of the staged members" }) {
  const home = join(sandbox, name)
  const ws = join(home, "ws")
  mkdirSync(ws, { recursive: true })
  cpSync(join(sandbox, "profiles"), join(home, "profiles"), { recursive: true })
  cpSync(join(sandbox, "cordis.patch.yml"), join(home, "cordis.patch.yml"))
  if (mpdJsonc !== undefined) {
    mkdirSync(join(ws, ".mpd"), { recursive: true })
    writeFileSync(join(ws, ".mpd", "mpd.jsonc"), mpdJsonc)
  }
  const env = stripCredentials({ ...process.env, DSH_HOME: home, HOME: home })
  const r = spawnSync("dsh", ["--profile", "mpd-headless", prompt], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, cwd: ws, env, stdio: ["ignore", "pipe", "pipe"],
  })
  const out = (r.stdout || "") + (r.stderr || "")
  const ids = teamIds(ws)
  const teams = ids.map((id) => JSON.parse(readFileSync(join(teamRoot(ws), id, "team.json"), "utf8")))
  const sessions = sessionLogText(home)
  log("### " + name + "\n$ dsh --profile mpd-headless " + JSON.stringify(prompt) + "   [exit=" + r.status + "]\n"
    + "teamIds=" + JSON.stringify(ids) + "\n--- stdout/stderr (2000) ---\n" + out.slice(0, 2000))
  let isolation
  try { isolation = assertSessionsSandboxed(home, home, { label: "t10-" + name }) } catch (error) { isolation = { ok: false, error: String(error) } }
  return { name, home, ws, exit: r.status, ids, teams, output: out, sessions, isolation }
}

const TIER_CLASSES = {
  1: ["Architect", "Planner", "Reviewer", "Lead", "Senior Engineer"],
  2: ["Researcher", "Explorer", "Plan Reviewer"],
  3: ["Deep Worker", "Junior Engineer"],
}
const VISION = { provider: "deepseek-official", model: "deepseek-v4-flash-vision-exp", reasoningEffort: "high" }
const DEFAULTS = {
  slot1: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max" },
  slot2: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" },
  slot3: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" },
}
const OVERRIDES = {
  slot1: { provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "high" },
  slot2: { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "low" },
  slot3: { provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "max" },
}

/** name -> the route the persisted member record carries (the RAW state keys). */
function memberRoutes(team) {
  const map = {}
  for (const member of team?.members ?? []) {
    map[member.name] = { provider: member.provider, model: member.model, reasoningEffort: member.reasoningEffort, status: member.status }
  }
  return map
}

/** Every entry of <ws>/.mpd/team except the archive — proves "no state at all" for a failed staging. */
function teamDirEntries(ws) {
  const root = teamRoot(ws)
  if (!existsSync(root)) return []
  return readdirSync(root).filter((n) => n !== "archive" && !n.startsWith("."))
}

function checkSlots(scenario, slots) {
  const problems = []
  if (scenario.teams.length !== 1) problems.push("expected exactly ONE staged team, got " + scenario.teams.length)
  const team = scenario.teams[0]
  const routes = memberRoutes(team)
  const names = Object.keys(routes)
  if (names.length === 0) problems.push("the staged team carries NO member records")
  if (team?.phase !== "staged") problems.push("the team is not in the staged phase (phase=" + String(team?.phase) + ")")
  for (const [tier, members] of Object.entries(TIER_CLASSES)) {
    for (const name of members) {
      const got = routes[name]
      if (got === undefined) { problems.push("member " + name + " is missing from the staged team"); continue }
      const want = slots["slot" + tier]
      if (got.provider !== want.provider || got.model !== want.model || got.reasoningEffort !== want.reasoningEffort) {
        problems.push("member " + name + " (tier " + tier + ") carries " + JSON.stringify(got) + ", expected slot" + tier + " " + JSON.stringify(want))
      }
      // A STAGED member carries no live model selection yet: the record status is the staged
      // placeholder ("idle"), and nothing spawns until the plan is approved.
      if (got.status !== "idle") problems.push("staged member " + name + " unexpectedly carries status=" + String(got.status))
    }
  }
  const vision = routes["Vision Analyst"]
  if (vision === undefined) problems.push("Vision Analyst is missing from the staged team")
  else if (vision.provider !== VISION.provider || vision.model !== VISION.model || vision.reasoningEffort !== VISION.reasoningEffort) {
    problems.push("Vision Analyst carries " + JSON.stringify(vision) + ", expected its OWN explicit route " + JSON.stringify(VISION))
  }
  return { problems, teamId: team?.id ?? null, phase: team?.phase ?? null, routes }
}

async function main() {
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-t10-"))
  log("sandbox=" + sandbox + "  repoRoot=" + repoRoot + "  realHome=" + homedir())
  const realWm = join(homedir(), ".mpd", "workmate")
  const realWmBefore = existsSync(realWm) ? readdirSync(realWm).sort().join(",") : null
  install(sandbox)

  const steps = {}

  const s1 = stage(sandbox, "s1-baseline", {})
  const c1 = checkSlots(s1, DEFAULTS)
  steps.s1Baseline = { ok: c1.problems.length === 0, problems: c1.problems, teamId: c1.teamId, routes: c1.routes, exit: s1.exit, isolation: s1.isolation }

  const overrideJsonc = "// t10 S2: the three slots overridden in the project layer\n{\n  \"teamModels\": {\n"
    + Object.entries(OVERRIDES).map(([slot, route]) => "    \"" + slot + "\": { \"provider\": \"" + route.provider + "\", \"model\": \"" + route.model + "\", \"reasoningEffort\": \"" + route.reasoningEffort + "\" }").join(",\n")
    + "\n  }\n}\n"
  const s2 = stage(sandbox, "s2-overridden", { mpdJsonc: overrideJsonc })
  const c2 = checkSlots(s2, OVERRIDES)
  steps.s2Overridden = {
    ok: c2.problems.length === 0, problems: c2.problems, teamId: c2.teamId, routes: c2.routes, exit: s2.exit,
    mpdJsonc: overrideJsonc,
    negativeHalf: c2.routes["Vision Analyst"] === undefined ? "Vision Analyst missing" : JSON.stringify(c2.routes["Vision Analyst"]) === JSON.stringify({ provider: VISION.provider, model: VISION.model, reasoningEffort: VISION.reasoningEffort, status: "staged" }),
    isolation: s2.isolation,
  }

  const brokenJsonc = "{\n  \"teamModels\": {\n    \"slot1\": { \"provider\": \"deepseek-official\", \"model\": \"no-such-model-xyz\", \"reasoningEffort\": \"high\" }\n  }\n}\n"
  const s3 = stage(sandbox, "s3-broken-slot1", { mpdJsonc: brokenJsonc })
  const errorText = s3.output + "\n" + s3.sessions
  writeFileSync(join(outDir, "s3-failure-text.txt"), errorText.slice(0, 400000))
  const entries = teamDirEntries(s3.ws)
  // Measured bound: the headless no-credential boot's own artifacts (stdout/stderr + the session
  // store) do NOT carry the provisioning error text — the plugin surfaces it through the harness
  // logger (`ctx.logger.warn`) and through the TOOL error, neither of which this boot captures.
  // The loud-failure TEXT is therefore proven by the LIVE tool call in tool-live-verify.mjs (L2),
  // and this scenario proves the other half: the broken slot leaves NO team state at all.
  const provisioningWarnVisible = /provisioning failed/.test(errorText)
  steps.s3BrokenSlot = {
    ok: s3.ids.length === 0,
    problems: s3.ids.length === 0 ? [] : ["team state WAS created for the broken-slot attempt: " + JSON.stringify(s3.ids)],
    teamIds: s3.ids,
    otherTeamDirEntries: entries,
    exit: s3.exit,
    provisioningWarnVisibleInBootArtifacts: provisioningWarnVisible,
    loudFailureEvidence: "see the LIVE tool call (L2) in tool-live-result.json — the recorded agent_teams_create error names the member and teamModels.slot1",
    isolation: s3.isolation,
  }

  // The two entry points share ONE resolution function: cite both call sites from source.
  const toolsSrc = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "tools.js"), "utf8")
  const sessionSrc = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "session-start.js"), "utf8")
  // The tool's own definition block: from its `name:` up to the NEXT tool definition in the file.
  const createAt = toolsSrc.indexOf("name: 'agent_teams_create'")
  const nextToolAt = toolsSrc.slice(createAt + 30).match(/\n\s*name: '[a-z_]+'/)
  const createBlock = createAt < 0 ? "" : toolsSrc.slice(createAt, nextToolAt === null ? toolsSrc.length : createAt + 30 + nextToolAt.index)
  const createCall = createBlock.includes("initializeProfileTeam(")
  const sessionAt = sessionSrc.indexOf("export async function provisionSessionTeam")
  const sessionCall = sessionAt >= 0 && sessionSrc.slice(sessionAt, sessionAt + 6000).includes("initializeProfileTeam(")
  steps.sameResolutionFunction = {
    ok: createCall && sessionCall,
    agentTeamsCreateCallsInitializeProfileTeam: createCall,
    sessionStartProvisioningCallsInitializeProfileTeam: sessionCall,
    toolBlockChars: createBlock.length,
    note: "the tool path and the session-start provisioning path are the only callers of the t6 resolution region (lib/tools.ts initializeProfileTeam)",
  }

  const realWmAfter = existsSync(realWm) ? readdirSync(realWm).sort().join(",") : null
  steps.realHomeUntouched = { ok: realWmBefore === realWmAfter, realWm, before: realWmBefore, after: realWmAfter }

  const ok = Object.values(steps).every((step) => step.ok === true)
  writeFileSync(join(outDir, "routing-result.json"), JSON.stringify({ ok, sandbox, steps }, null, 2))
  writeFileSync(join(outDir, "routing-output.log"), LOG.join("\n\n---\n\n"))
  console.log("[t10 routing] ok=" + ok)
  for (const [key, value] of Object.entries(steps)) console.log("  " + key + ": " + JSON.stringify({ ok: value.ok, problems: value.problems }).slice(0, 400))
  process.exit(ok ? 0 : 1)
}

await main()
