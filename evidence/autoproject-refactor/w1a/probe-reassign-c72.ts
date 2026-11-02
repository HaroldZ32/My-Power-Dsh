// REVIEWER'S PROBE: does `reassign` honour the C7-2 read-only pairing guard that the very same dispatch
// pass enforces for its own pairings? It should refuse a write-scoped task handed to a read-only member.
// Run: bun evidence/autoproject-refactor/w1a/probe-reassign-c72.ts
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runDispatch, type TeamActionCaller, type TeamActionDeps } from "../../../packages/mpd-team-core-plugin/src/team-actions"
import { addTeamMember, addTeamTask, createTeam, readTeam, writeTeam, activeTeamId, listTeams } from "../../../packages/mpd-team-core-plugin/src/team-store"
import { planDispatch } from "../../../packages/mpd-team-core-plugin/src/dispatch"
import type { DshTeamExecutor } from "../../../packages/mpd-dsh-adapter-plugin/src/index.ts"

const NOW = new Date("2026-11-02T03:00:00.000Z")
const LEAD = "lead-probe"
const TEAM = "team-probe"

/** One sandbox workspace. */
const workspace = mkdtempSync(join(tmpdir(), "mpd-w1a-probe-"))
/** Seed: one write task owned by `worker`, one read-only seat beside it. */
let record = createTeam(workspace, { teamId: TEAM, name: "probe", description: "C7-2 probe", leadSessionId: LEAD }, NOW)
record = addTeamMember(record, { name: "worker", description: "a worker" }, NOW)
record = addTeamMember(record, { name: "Plan Reviewer", description: "read-only" }, NOW)
record = addTeamTask(record, { subject: "write work", description: "writes files", blockedBy: [], owner: "worker", writeScopes: ["packages/x"] }, NOW)
const seeded = {
  ...record,
  approvedAt: NOW.toISOString(),
  phase: "active" as const,
  members: record.members.map((member) => ({ ...member, status: "inactive" as const, executorRef: "sess-" + member.name })),
}
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

/** The deps, with the roster service that CLASSIFIES Plan Reviewer as read-only (the guard's own input). */
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
  service: (id: string) => (id === "mpdRoles"
    ? { list: () => [{ name: "worker" }, { name: "Plan Reviewer", readonly: true }] }
    : undefined),
  log: (): void => {},
  beginDispatch: () => (): void => {},
  assertPlanGraph: (): void => {},
  assertScopesOrdered: (): void => {},
}

/** The live Lead caller. */
const caller: TeamActionCaller = { workspace, sessionId: LEAD, lineage: [], agent: { session: { id: LEAD, header: {} } } }

// CONTROL: the guard DOES refuse this exact pairing when the pass pairs it itself.
const control = planDispatch({
  tasks: [{ id: "T1", subject: "write work", status: "pending", ready: true, ownerName: "Plan Reviewer", writeScopes: ["packages/x"] }],
  members: [{ id: "sess-Plan Reviewer", name: "Plan Reviewer", status: "inactive", readonly: true }],
  ledger: {},
})
console.log("CONTROL (owner-only pass) pairs:", JSON.stringify(control.pairs))
console.log("CONTROL (owner-only pass) skip  :", JSON.stringify(control.skipped))

// THE PROBE: hand the same write row to the same read-only seat through `reassign`.
const pass = await runDispatch(deps, caller, { reassign: [{ taskId: "T1", owner: "Plan Reviewer" }] })
console.log("REASSIGN result:", JSON.stringify(pass))
const after = readTeam(workspace, TEAM)?.tasks[0]
console.log("BOARD after     :", JSON.stringify({ owner: after?.owner, status: after?.status }))
console.log("SENT            :", JSON.stringify(sent.map((row) => row.slice(0, 40))))
rmSync(workspace, { recursive: true, force: true })
