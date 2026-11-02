// REVIEWER'S PROBE 2: does `reassign` refuse a FAILED / PROVISIONING target the way the cellwork
// implementation it claims to carry does (its repair R-A1: "a FAILED member can still carry a recorded
// handle, so claiming a row for it would move the row to in_progress where no later pass picks it up")?
// Run: bun evidence/autoproject-refactor/w1a/probe-reassign-dead-target.ts
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runDispatch, type TeamActionCaller, type TeamActionDeps } from "../../../packages/mpd-team-core-plugin/src/team-actions"
import { addTeamMember, addTeamTask, createTeam, readTeam, updateTeamMember, writeTeam, activeTeamId, listTeams } from "../../../packages/mpd-team-core-plugin/src/team-store"
import type { DshTeamExecutor } from "../../../packages/mpd-dsh-adapter-plugin/src/index.ts"

const NOW = new Date("2026-11-02T03:00:00.000Z")
const LEAD = "lead-probe-2"
const TEAM = "team-probe-2"

/** One sandbox workspace. */
const workspace = mkdtempSync(join(tmpdir(), "mpd-w1a-probe2-"))
/** Seed: a pending row owned by a fenced worker, and a seat whose raise FAILED but which still carries a handle. */
let record = createTeam(workspace, { teamId: TEAM, name: "probe2", description: "dead-target probe", leadSessionId: LEAD }, NOW)
record = addTeamMember(record, { name: "worker", description: "a worker" }, NOW)
record = addTeamMember(record, { name: "dead", description: "a seat whose raise failed" }, NOW)
record = addTeamTask(record, { subject: "work", description: "the acceptance text", blockedBy: [], owner: "worker" }, NOW)
/** The approved shape: `dead` keeps its executorRef (a failed raise is not a missing handle), status failed. */
let seeded = {
  ...record,
  approvedAt: NOW.toISOString(),
  phase: "active" as const,
  members: record.members.map((member) => ({ ...member, status: "inactive" as const, executorRef: "sess-" + member.name })),
}
seeded = { ...seeded, members: updateTeamMember(seeded, "dead", { status: "failed" }).members }
writeTeam(workspace, seeded)

/** The sent messages this probe records. */
const sent: string[] = []
/** The executor double. */
const executor: DshTeamExecutor = {
  kind: "native",
  reason: "probe",
  providers: (): string[] => ["spawn"],
  spawn: async (_caller: unknown): Promise<{ handle: string; executor: "native" }> => ({ handle: "child", executor: "native" }),
  send: async (_caller: unknown, handle: string, content: string): Promise<void> => { sent.push(handle + ":" + content) },
  interrupt: async (): Promise<void> => {},
  membership: (): undefined => undefined,
  members: (): [] => [],
}

/** The deps, with no roster service (the read-only guard is not the subject of this probe). */
const deps: TeamActionDeps = {
  now: () => NOW,
  executor: () => executor,
  bundleApprovalEffects: async (): Promise<void> => {},
  deriveParentTeam: (): undefined => undefined,
  resolveTeam: (space: string, sessionId: string) => {
    const bound = activeTeamId(space, sessionId)
    const boundRecord = bound === undefined ? undefined : readTeam(space, bound)
    if (boundRecord !== undefined) return { record: boundRecord }
    const memberOf = listTeams(space).find((row) => row.members.some((member) => member.executorRef === sessionId))
    return memberOf === undefined ? {} : { record: memberOf }
  },
  readWatchdogHold: () => ({ state: "free" }),
  service: (): undefined => undefined,
  log: (): void => {},
  beginDispatch: () => (): void => {},
  assertPlanGraph: (): void => {},
  assertScopesOrdered: (): void => {},
}

/** The live Lead caller. */
const caller: TeamActionCaller = { workspace, sessionId: LEAD, lineage: [], agent: { session: { id: LEAD, header: {} } } }

const before = readTeam(workspace, TEAM)?.members.find((member) => member.name === "dead")
console.log("TARGET before:", JSON.stringify({ status: before?.status, executorRef: before?.executorRef }))
const pass = await runDispatch(deps, caller, { reassign: [{ taskId: "T1", owner: "dead" }] })
console.log("REASSIGN    :", JSON.stringify(pass))
const after = readTeam(workspace, TEAM)?.tasks[0]
console.log("BOARD after :", JSON.stringify({ owner: after?.owner, status: after?.status }))
console.log("SENT        :", JSON.stringify(sent.length))
rmSync(workspace, { recursive: true, force: true })
