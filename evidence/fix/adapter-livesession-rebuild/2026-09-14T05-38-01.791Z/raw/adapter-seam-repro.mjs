// RED/GREEN driver for the stale-adapter defect (2026-09-14).
//
// QUESTION: can the adapter ARTIFACT the bundle row loads serve the call sites of the
// team-compaction tool? `mpd-team-compact-plugin/src/index.ts` reaches the live-session
// plane through `ctx.get("mpdDsh")` (the mounted adapter row), NOT through its own inlined
// copy — so a stale mounted artifact crashes the tool even when the plugin's own dist is
// fresh.
//
// The driver boots the REAL plugin entry against a chosen adapter artifact and runs the
// registered `mpd_team_compact_run` tool over a real team fixture. It never touches the
// process-wide services: `tools`, `agents` and the workspace are stubs, the workspace is a
// fresh temp dir inside this run.
//
//   node <this> <adapter-artifact.mjs> --expect-crash    # RED
//   node <this> <adapter-artifact.mjs>                   # GREEN
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const repoRoot = process.env.MPD_REPRO_REPO ?? "/root/dshProj/my-power-dsh"
const adapterPath = process.argv[2]
const expectCrash = process.argv.includes("--expect-crash")
if (adapterPath === undefined) {
  console.error("usage: adapter-seam-repro.mjs <adapter-artifact.mjs> [--expect-crash]")
  process.exit(2)
}

const { createDshAdapter } = await import(adapterPath)
const { apply } = await import(join(repoRoot, "packages/mpd-team-compact-plugin/src/index.ts"))

// ── a real team fixture (shape copied from the plugin's own test harness) ────────────────
const workspace = mkdtempSync(join(tmpdir(), "mpd-adapter-repro-"))
const teamId = "repro-team"
mkdirSync(join(workspace, ".mpd", "team", teamId), { recursive: true })
const now = Date.now()
writeFileSync(join(workspace, ".mpd", "team", teamId, "team.json"), JSON.stringify({
  id: teamId, name: "repro", captainSessionId: "session-captain", createdAt: now, updatedAt: now,
  taskSeq: 1, phase: "running",
  members: [{ id: "session-member", name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now }],
  tasks: [{ id: "t1", status: "completed", assignee: "Senior Engineer", dependencies: [], attempt: 1 }],
}, null, 2))

// ── the harness ctx the ADAPTER reads its seams from ────────────────────────────────────
const registered = []
const tools = {
  register: (definition) => { registered.push(definition); return () => {} },
  guard: () => () => {},
  get: () => undefined,
  schemas: () => registered,
  execute: async () => ({ value: undefined }),
}
const agents = { list: () => [], get: () => undefined }
const harnessCtx = {
  get: (name) => ({ tools, agents })[name],
  on: () => () => {},
  provide: () => {},
}

const dsh = createDshAdapter(harnessCtx)
console.log("[repro] adapter artifact    = " + adapterPath)
console.log("[repro] adapter capabilities = " + JSON.stringify(dsh.capabilities()))
for (const method of ["liveAgent", "liveAgents", "compactionEngineForAgent", "onEvent", "workspaceRootsAll"]) {
  console.log("[repro] typeof dsh." + method + " = " + typeof dsh[method])
}

// ── boot the REAL plugin against that adapter ───────────────────────────────────────────
const pluginCtx = { get: (key) => (key === "mpdDsh" ? dsh : undefined), logger: { warn: () => {}, info: () => {} }, on: () => () => {} }
await apply(pluginCtx)

const tool = registered.find((definition) => definition.name === "mpd_team_compact_run")
if (tool === undefined) {
  console.log("[repro] VERDICT=FAIL reason=mpd_team_compact_run was not registered")
  process.exit(1)
}

const exec = { agent: { session: { header: { cwd: workspace } } } }
let outcome
try {
  outcome = { ok: true, value: await tool.execute({ team_id: teamId }, exec) }
} catch (error) {
  outcome = { ok: false, error: String(error?.message ?? error) }
}

console.log("[repro] tool outcome = " + JSON.stringify(outcome))
if (expectCrash) {
  const crashed = outcome.ok === false && /is not a function/.test(outcome.error)
  console.log("[repro] VERDICT=" + (crashed ? "RED-CONFIRMED (the shipped artifact cannot serve the call site)" : "FAIL (expected a TypeError)"))
  process.exit(crashed ? 0 : 1)
}
const alive = outcome.ok === true
console.log("[repro] VERDICT=" + (alive ? "GREEN-CONFIRMED (the artifact serves the call site)" : "FAIL (the tool still crashed)"))
process.exit(alive ? 0 : 1)
