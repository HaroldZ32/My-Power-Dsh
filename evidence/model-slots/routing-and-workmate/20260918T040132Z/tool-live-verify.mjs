#!/usr/bin/env node
// t10 LIVE tool-call verification (evidence/model-slots/routing-and-workmate/<ts>/).
//
// Drives the REAL `agent_teams_create` tool through a real headless session (live model, credentials
// seeded INTO the sandbox store only) and reads the evidence from the HARNESS's own session log —
// never from the model's prose:
//   L1  agent_teams_create {name, profile:"mpd", approval:"required"} SUCCEEDS on the default slots,
//       and the persisted team state carries slot1/slot2/slot3 routes plus Vision Analyst's explicit
//       route;
//   L2  the same call with a broken slot1 FAILS: the recorded tool RESULT is an error naming a
//       slot-1 member and teamModels.slot1, and NO team state is written.
//
// Isolation: fresh DSH_HOME + sandbox HOME + sandbox workspace; the credential is resolved by the
// repo's own resolver and written only into the ephemeral sandbox store; the real ~/.mpd/workmate is
// asserted unchanged. Run with node.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { credentialDescriptor, resolveProviderCredential, seedSandboxCredentials } from "../../../../skills/dsh-qa/scripts/lib/credentials.mjs"
import { findToolCall, readSessionEvents } from "../../../../skills/dsh-qa/scripts/lib/session-evidence.mjs"
import { assertSessionsSandboxed } from "../../../../skills/dsh-qa/scripts/lib/workspace-isolation.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(HERE, "../../../..")
const LOG = []
const log = (line) => { LOG.push(line); console.log(line) }
const REAL_HOME = process.env.HOME ?? ""
const REAL_WM = join(REAL_HOME, ".mpd", "workmate")
const realWmBefore = existsSync(REAL_WM) ? readdirSync(REAL_WM).sort().join(",") : null

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

function install(sandbox) {
  const r = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, env: { ...process.env, DSH_HOME: sandbox } })
  log("$ install-profile --dsh-home <sandbox> --profile mpd-headless\n[exit=" + r.status + "]")
  if (r.status !== 0) throw new Error("isolated install failed")
}

const teamRoot = (ws) => join(ws, ".mpd", "team")
const teamIds = (ws) => {
  const root = teamRoot(ws)
  if (!existsSync(root)) return []
  return readdirSync(root).filter((n) => n !== "archive" && !n.startsWith(".") && existsSync(join(root, n, "team.json")))
}

function liveScenario(sandbox, name, { mpdJsonc, teamName, resolution }) {
  const home = join(sandbox, name)
  const ws = join(home, "ws")
  mkdirSync(ws, { recursive: true })
  cpSync(join(sandbox, "profiles"), join(home, "profiles"), { recursive: true })
  cpSync(join(sandbox, "cordis.patch.yml"), join(home, "cordis.patch.yml"))
  seedSandboxCredentials(home, { resolution })
  if (mpdJsonc !== undefined) {
    mkdirSync(join(ws, ".mpd"), { recursive: true })
    writeFileSync(join(ws, ".mpd", "mpd.jsonc"), mpdJsonc)
  }
  const prompt = "Call the tool `agent_teams_create` exactly ONCE with these arguments: name=\"" + teamName + "\", profile=\"mpd\", approval=\"required\". "
    + "Then reply with the tool's own result text (or its error message) verbatim and stop. Do not call any other tool and do not create anything else."
  const r = spawnSync("dsh", ["--profile", "mpd-headless", prompt], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000, cwd: ws,
    env: { ...process.env, DSH_HOME: home, HOME: home }, stdio: ["ignore", "pipe", "pipe"],
  })
  const output = (r.stdout || "") + (r.stderr || "")
  log("### " + name + "  [exit=" + r.status + "]\n" + output.slice(0, 1500))
  let call = { called: false, succeeded: false, resultText: "", calls: [], reason: "session log unreadable" }
  let events = { records: [] }
  try {
    events = readSessionEvents(home, { workspace: ws })
    call = findToolCall(events, "agent_teams_create")
  } catch (error) {
    call = { called: false, succeeded: false, resultText: "", calls: [], reason: "log read failed: " + String(error) }
  }
  const ids = teamIds(ws)
  const teams = ids.map((id) => JSON.parse(readFileSync(join(teamRoot(ws), id, "team.json"), "utf8")))
  let isolation
  try { isolation = assertSessionsSandboxed(home, home, { label: "t10-live-" + name }) } catch (error) { isolation = { ok: false, error: String(error) } }
  return { name, home, ws, exit: r.status, output, call, events: events.records?.length ?? 0, ids, teams, isolation }
}

async function main() {
  const resolution = resolveProviderCredential()
  log("credential: " + JSON.stringify(credentialDescriptor(resolution)))
  if (!resolution.present) throw new Error("no provider credential available — a live case cannot run")
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-t10-live-"))
  install(sandbox)
  const steps = {}

  // L1 — the tool SUCCEEDS on the default slots.
  const l1 = liveScenario(sandbox, "l1-tool-staged", { teamName: "t10-live", resolution })
  const team = l1.teams[0]
  const routes = Object.fromEntries((team?.members ?? []).map((member) => [member.name, { provider: member.provider, model: member.model, reasoningEffort: member.reasoningEffort, status: member.status }]))
  const problems = []
  if (!l1.call.called) problems.push("the harness recorded NO agent_teams_create call")
  if (l1.call.called && !l1.call.succeeded) problems.push("agent_teams_create was called but its recorded result is an ERROR: " + l1.call.resultText.slice(0, 300))
  if (team?.phase !== "staged") problems.push("the created team is not staged (phase=" + String(team?.phase) + ")")
  for (const [tier, members] of Object.entries(TIER_CLASSES)) {
    for (const member of members) {
      const got = routes[member]
      const want = DEFAULTS["slot" + tier]
      if (got === undefined) problems.push("member " + member + " missing from the persisted team")
      else if (got.provider !== want.provider || got.model !== want.model || got.reasoningEffort !== want.reasoningEffort) {
        problems.push("member " + member + " (tier " + tier + ") carries " + JSON.stringify(got) + ", expected slot" + tier + " " + JSON.stringify(want))
      }
    }
  }
  const vision = routes["Vision Analyst"]
  if (vision === undefined) problems.push("Vision Analyst missing from the persisted team")
  else if (vision.provider !== VISION.provider || vision.model !== VISION.model || vision.reasoningEffort !== VISION.reasoningEffort) {
    problems.push("Vision Analyst carries " + JSON.stringify(vision) + ", expected its own explicit route " + JSON.stringify(VISION))
  }
  steps.l1ToolCallStaged = {
    ok: problems.length === 0,
    problems,
    toolCalled: l1.call.called,
    toolSucceeded: l1.call.succeeded,
    callArguments: l1.call.calls,
    resultText: l1.call.resultText.slice(0, 1200),
    teamId: team?.id ?? null,
    phase: team?.phase ?? null,
    routes,
    exit: l1.exit,
    sessionRecords: l1.events,
    isolation: l1.isolation,
  }

  // L2 — the tool FAILS LOUDLY on a broken slot1 and writes NO state.
  const broken = "{\n  \"teamModels\": {\n    \"slot1\": { \"provider\": \"deepseek-official\", \"model\": \"no-such-model-xyz\", \"reasoningEffort\": \"high\" }\n  }\n}\n"
  const l2 = liveScenario(sandbox, "l2-tool-broken-slot", { mpdJsonc: broken, teamName: "t10-broken", resolution })
  const errorText = l2.call.resultText
  const namesMember = TIER_CLASSES[1].some((member) => errorText.includes(member))
  const namesSlot = errorText.includes("teamModels.slot1")
  steps.l2ToolCallBrokenSlot = {
    ok: l2.call.called && !l2.call.succeeded && namesMember && namesSlot && l2.ids.length === 0,
    toolCalled: l2.call.called,
    toolFailed: l2.call.called && !l2.call.succeeded,
    errorText: errorText.slice(0, 1500),
    namesSlot1Member: namesMember,
    namesSlot: namesSlot,
    teamIds: l2.ids,
    exit: l2.exit,
    sessionRecords: l2.events,
    isolation: l2.isolation,
    problems: [
      ...(l2.call.called ? [] : ["no agent_teams_create call recorded"]),
      ...(l2.call.called && !l2.call.succeeded ? [] : ["the call did not fail (succeeded=" + String(l2.call.succeeded) + ")"]),
      ...(namesMember ? [] : ["the error does not name a slot-1 member"]),
      ...(namesSlot ? [] : ["the error does not name teamModels.slot1"]),
      ...(l2.ids.length === 0 ? [] : ["team state WAS written for the failed attempt: " + JSON.stringify(l2.ids)]),
    ],
  }

  const realWmAfter = existsSync(REAL_WM) ? readdirSync(REAL_WM).sort().join(",") : null
  steps.realHomeUntouched = { ok: realWmBefore === realWmAfter, realWm: REAL_WM, before: realWmBefore, after: realWmAfter }
  steps.credentials = { ok: resolution.present === true, descriptor: credentialDescriptor(resolution), storedInSandboxOnly: true }

  const ok = Object.values(steps).every((step) => step.ok === true)
  writeFileSync(join(HERE, "tool-live-result.json"), JSON.stringify({ ok, sandbox, steps }, null, 2))
  writeFileSync(join(HERE, "tool-live-output.log"), LOG.join("\n\n---\n\n"))
  console.log("[t10 live tool] ok=" + ok)
  for (const [key, value] of Object.entries(steps)) console.log("  " + key + ": " + JSON.stringify({ ok: value.ok, problems: value.problems ?? [] }).slice(0, 400))
  process.exit(ok ? 0 : 1)
}

await main()
