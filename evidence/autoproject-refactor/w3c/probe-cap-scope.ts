// REVIEWER'S PROBE: is `workmates.max` the PER-WORKSPACE cap the contract names, or the whole
// HOME-scoped library? The library is shared by every project, so if the cap counts it globally, a
// fresh workspace with ZERO workmates of its own can be refused auto-init by other projects' instances.
// Run: bun evidence/autoproject-refactor/w3c/probe-cap-scope.ts
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { approveTeam, type TeamActionCaller, type TeamActionDeps } from "../../../packages/mpd-team-core-plugin/src/team-actions.ts"
import { addMember, addTask, stagePlan, writePlan } from "../../../packages/mpd-team-core-plugin/src/plan-store.ts"
import { listTeams } from "../../../packages/mpd-team-core-plugin/src/team-store.ts"

/** The sandbox HOME the (shared) library lives under. */
const home = mkdtempSync(join(tmpdir(), "mpd-w3c-cap-home-"))
/** The project workspace that owns NONE of those instances. */
const workspace = mkdtempSync(join(tmpdir(), "mpd-w3c-cap-ws-"))
process.env.HOME = home
delete process.env.DSH_HOME

const NOW = new Date("2026-11-02T12:00:00.000Z")
/** The library root. */
const liveRoot = join(home, ".mpd", "workmate")

/**
 * Seed one library instance (as another project's `mpd_workmate_init` would leave it).
 * @param name - the instance key.
 */
function seedForeign(name: string): void {
  const dir = join(liveRoot, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "meta.json"), JSON.stringify({
    name, baseId: "hephaestus", baseName: "Planner", description: "plans",
    provider: "deepseek-official", model: "deepseek-v4-flash", readonly: false,
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z",
    uses: 4, lastTask: "another project", renamedFrom: [],
  }, null, 2) + "\n")
  writeFileSync(join(dir, "persona.md"), "You plan.\n")
  writeFileSync(join(dir, "memory.md"), "")
  writeFileSync(join(dir, "note.md"), "plans large projects end to end\n")
}
seedForeign("planner-1")
seedForeign("planner-2")

/** What the stub workmate tools observed. */
const calls: string[] = []
/** The three workmate tools, answered the way the real row answers them. */
const executeTool = async ({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }): Promise<{ ok: boolean; value?: unknown }> => {
  calls.push(name)
  if (name === "mpd_workmate_list") {
    const rows = readdirSync(liveRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== ".archive")
      .map((entry) => ({ name: entry.name, baseName: "Planner" }))
    return { ok: true, value: { workmates: rows } }
  }
  if (name === "mpd_workmate_match") return { ok: true, value: { matched: false, threshold: 0.35, matches: [] } }
  if (name === "mpd_workmate_init") return { ok: true, value: { name: String(args?.name ?? "") } }
  return { ok: false, error: "unknown tool" }
}

/** The deps bundle an approval needs, with the workmate seams wired. */
const deps: TeamActionDeps = {
  now: () => NOW,
  executor: () => ({
    kind: "native",
    reason: "probe",
    providers: (): string[] => ["spawn"],
    spawn: async (_caller: unknown, request: { name: string }): Promise<{ handle: string; executor: "native" }> => ({ handle: "child-" + request.name, executor: "native" }),
    send: async (): Promise<void> => {},
    interrupt: async (): Promise<void> => {},
    membership: (): undefined => undefined,
    members: (): [] => [],
  }),
  bundleApprovalEffects: async (): Promise<void> => {},
  deriveParentTeam: (): undefined => undefined,
  resolveTeam: () => ({ refusal: "not a team action" }),
  readWatchdogHold: () => ({ state: "free" }),
  service: (id: string) => (id === "mpdDsh"
    ? { executeTool }
    : id === "mpdConfig"
      ? { get: (key?: string) => (key === "workmates.max" ? 2 : undefined) }
      : undefined),
  log: (): void => {},
  beginDispatch: () => (): void => {},
  assertPlanGraph: (): void => {},
  assertScopesOrdered: (): void => {},
}
/** The approving lead. */
const caller: TeamActionCaller = { workspace, sessionId: "lead-cap", lineage: [], agent: { session: { id: "lead-cap", header: {} } } }

/** One plan with a single role-bearing member that matches nothing. */
let plan = stagePlan(workspace, "lead-cap", { name: "cap probe", description: "does the cap count the whole library", approval: "required" }, NOW)
plan = addMember(plan, { name: "planner-seat", description: "plan the wave", prompt: "You plan.", role: "Planner" })
plan = addTask(plan, { subject: "plan", description: "plan it", blockedBy: [], owner: "planner-seat" })
writePlan(workspace, plan)

console.log("library (HOME-wide):", readdirSync(liveRoot).filter((entry) => entry !== ".archive" && entry !== "index.json").sort().join(","))
console.log("this workspace's own workmates: 0")
const result = await approveTeam(deps, caller)
console.log("approve ok:", (result as { ok?: boolean }).ok)
console.log("bindings  :", JSON.stringify((result as { bindings?: unknown }).bindings))
console.log("team member name on the record:", String(listTeams(workspace)[0]?.members[0]?.name ?? "(none)"))
console.log("init calls:", calls.filter((name) => name === "mpd_workmate_init").length)
rmSync(home, { recursive: true, force: true })
rmSync(workspace, { recursive: true, force: true })
