// t13 MOUNT probe: proves the edited scheduler.js is the code a real boot loads, and
// drives its dispatch path INSIDE that boot process.
//
// Mounted by mount-proof.sh through an overlay patch row, so it runs in a real boot of
// the full `mpd` profile in an isolated DSH_HOME + sandbox HOME + sandbox workspace.
// --dump-config is never used as load evidence here (it composes rows without mounting
// them): the agent-teams tool registry below is read from a LIVE boot.
//
// Plain JS, dependency-free: the host imports this file directly.
export const name = "mpd-qa-t13-dispatch-probe"
export const inject = ["tools"]

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const AGENT_TEAM_TOOLS = [
  "agent_teams_status",
  "agent_teams_create",
  "agent_teams_add_member",
  "agent_teams_create_task",
  "agent_teams_update_task",
  "agent_teams_claim_task",
  "agent_teams_reassign_task",
  "agent_teams_send_message",
  "agent_teams_task_contract",
]

const DISPATCH_REGIONS = [
  "mpd-delta dispatch-decline-guard",
  "mpd-delta kick-team-decline-logs",
  "mpd-delta kick-member-decline-logs",
  "mpd-delta kick-member-locked-decline-logs",
  "mpd-delta idle-edge-no-team-log",
  "mpd-delta idle-edge-nonmember-log",
]

const log = (line) => console.log(`[t13-mount-probe] ${line}`)

/** Drive the REAL loaded scheduler against a synthetic approved team (one running member). */
async function driveDispatch(schedulerPath) {
  const module = await import(pathToFileURL(schedulerPath).href)
  if (typeof module.installTeamScheduler !== "function") {
    log("SCHEDULER_EXPORT=missing")
    return
  }
  log("SCHEDULER_EXPORT=installTeamScheduler:ok")
  const workspace = mkdtempSync(join(tmpdir(), "t13-probe-ws-"))
  mkdirSync(join(workspace, ".mpd", "team", "mpd-default", "inbox"), { recursive: true })
  const now = Date.now()
  writeFileSync(join(workspace, ".mpd", "team", "mpd-default", "team.json"), JSON.stringify({
    id: "mpd-default",
    name: "t13 probe",
    captainSessionId: "session-probe-captain",
    createdAt: now,
    approvedAt: now,
    phase: "running",
    taskSeq: 1,
    members: [{ name: "Architect", id: "member-probe-architect", role: "analyst", status: "idle", joinedAt: now }],
    tasks: [{ id: "t1", subject: "probe ready root", assignee: "Architect", dependencies: [], status: "pending", attempt: 0, createdAt: now, updatedAt: now }],
  }, null, 2))
  const deliveries = []
  const warns = []
  const live = new Map([
    ["session-probe-captain", { id: "session-probe-captain", status: "idle", session: { header: { cwd: workspace } } }],
    // The approval instant: the member exists and is MID-TURN on its spawn prompt.
    ["member-probe-architect", { id: "member-probe-architect", status: "running", session: { header: { cwd: workspace } } }],
  ])
  const ctx = {
    agents: { get: (id) => live.get(id) },
    logger: { warn: (m) => warns.push(String(m)), info: () => {}, error: () => {}, debug: () => {} },
    on: () => () => {},
    subagents: {
      prompt: async (request) => {
        deliveries.push(request.childSessionId)
        return { messageId: "probe-message" }
      },
    },
  }
  const scheduler = module.installTeamScheduler(ctx, { stateDir: join(".mpd", "team") })
  await scheduler.kickTeam(workspace, "mpd-default", live.get("session-probe-captain"))
  const record = JSON.parse(readFileSync(join(workspace, ".mpd", "team", "mpd-default", "team.json"), "utf8"))
  log(`DISPATCH_PROBE_DELIVERIES=${deliveries.length}`)
  log(`DISPATCH_PROBE_TASK_STATUS=${record.tasks[0].status}`)
  log(`DISPATCH_PROBE_DECLINE_LOGS=${warns.length}`)
}

export function apply(ctx) {
  // Defer: the loader applies rows concurrently, so a registry read must wait for the
  // rows still registering. Same settle window the repo's other mount probes use.
  setTimeout(async () => {
    try {
      const schedulerPath = process.env.T13_SCHEDULER_PATH
      const expectedSha = process.env.T13_EXPECT_SHA
      const source = readFileSync(schedulerPath, "utf8")
      const sha = createHash("sha256").update(source).digest("hex")
      log(`SCHEDULER_PATH=${schedulerPath}`)
      log(`SCHEDULER_SHA_MATCH=${sha === expectedSha ? "yes" : "NO(" + sha + ")"}`)
      const present = DISPATCH_REGIONS.filter((id) => source.includes(`//#region ${id} (`))
      log(`DISPATCH_REGIONS_PRESENT=${present.length}/${DISPATCH_REGIONS.length}`)
      log(`UPSTREAM_GUARD_ABSENT=${source.includes("function isMemberAvailable(") ? "no" : "yes"}`)
      log(`DECLINE_LOGGER_PRESENT=${source.includes("noteDispatchDecline") ? "yes" : "no"}`)

      const tools = (typeof ctx.get === "function" ? ctx.get("tools") : undefined) ?? ctx.tools
      const has = (n) => { try { return tools?.get?.(n) !== undefined } catch { return false } }
      const found = AGENT_TEAM_TOOLS.filter(has)
      log(`AGENT_TEAMS_TOOLS_PRESENT=${found.length}/${AGENT_TEAM_TOOLS.length}`)
      log(`AGENT_TEAMS_TOOLS=${AGENT_TEAM_TOOLS.map((n) => n + ":" + (has(n) ? "ok" : "MISSING")).join(",")}`)

      // Best-effort: name the loader entry that carries the adopted plugin, so a boot
      // that mounted a DIFFERENT copy of the tree is visible instead of assumed away.
      try {
        const loader = (typeof ctx.get === "function" ? ctx.get("loader") : undefined) ?? ctx.loader
        const entries = loader?.entries?.()
        if (Array.isArray(entries)) {
          const hits = entries
            .map((entry) => String(entry?.name ?? entry?.id ?? ""))
            .filter((text) => text.includes("agent-teams"))
          log(`LOADER_ENTRIES_TOTAL=${entries.length}`)
          log(`LOADER_AGENT_TEAMS_ENTRIES=${hits.join("|") || "none"}`)
        } else {
          log("LOADER_ENTRIES=unavailable")
        }
      } catch (error) {
        log(`LOADER_ENTRIES_ERR=${String(error?.message ?? error).slice(0, 160)}`)
      }

      await driveDispatch(schedulerPath)
      log("DONE")
    } catch (e) {
      log("FAIL=" + String(e?.message ?? e))
    }
  }, 9000)
}
