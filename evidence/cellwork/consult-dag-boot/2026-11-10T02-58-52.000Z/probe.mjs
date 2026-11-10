// Independent verifier boot: install the bundle into an isolated DSH_HOME, boot `dsh web`, serve a
// consult-bearing team record through the REAL /plugins/mpd-team/state route, assert the projection,
// and write redacted evidence. No writes outside the sandbox + the evidence dir.
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync, readFileSync, existsSync, openSync, rmSync, copyFileSync } from "node:fs"
import { join } from "node:path"

const repo = "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
const evidence = process.argv[2]
mkdirSync(evidence, { recursive: true })
const root = "/tmp/consult-boot/sandbox"
rmSync(root, { recursive: true, force: true })
const home = join(root, "home"), userhome = join(root, "userhome"), ws = join(root, "ws")
const store = join(root, "pnpm-store"), runDir = join(root, "run"), npmCache = join(root, "npm-cache"), pnpmHome = join(root, "pnpm-home")
for (const d of [join(home, "profiles", "w"), userhome, ws, join(ws, ".mpd", "team", "teams"), store, runDir, npmCache, pnpmHome]) mkdirSync(d, { recursive: true })
writeFileSync(join(home, "profiles", "w", "package.json"), JSON.stringify({ name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }, null, 2) + "\n")
const env = { ...process.env, DSH_HOME: home, HOME: userhome, XDG_RUNTIME_DIR: runDir, npm_config_cache: npmCache, PNPM_HOME: pnpmHome, DSH_WORKSPACE_ROOT: ws }
const install = spawnSync("dsh", ["plugin", "--profile", "w", "add", "--store-dir", store, repo], { env, encoding: "utf8", timeout: 420000, cwd: root })
if (install.status !== 0) { console.error("install failed", install.stdout?.slice(-2000), install.stderr?.slice(-2000)); process.exit(2) }

const now = "2026-11-10T12:00:00.000Z"
const task = (id, subject, blockedBy = []) => ({ id, subject, kind: "work", status: "pending", owner: "Lead", blockedBy, dependencies: [] })
const base = (teamId, extra = {}) => ({ version: 1, teamId, name: teamId, description: "verifier boot fixture", leadSessionId: "session-boot", planId: "", phase: "active", createdAt: now, approvedAt: now, members: [], tasks: [], nextMemberNumber: 1, nextTaskNumber: 9, ...extra })
const consult = (n, id, role, t, state, extra = {}) => ({ consultNumber: n, consultId: id, role, task: t, cellId: "cell-boot", startedAt: 1750000000000 + n * 1000, state, ...extra })
const T_CONS = "team-boot-consults", T_BASE = "team-boot-baseline", T_NEST = "team-boot-nested", T_CHILD = "team-boot-child"
writeFileSync(join(ws, ".mpd", "team", "teams", T_CONS + ".json"), JSON.stringify(base(T_CONS, { tasks: [task("T1", "first task"), task("T2", "second task", ["T1"])], nextTaskNumber: 3, nextConsultNumber: 3,
  consults: [consult(2, "consult-b", "Researcher", "second assignment", "running"), consult(1, "consult-a", "Explorer", "first assignment", "complete", { finishedAt: 1750000001500, elapsedMs: 1500 })] }), null, 2))
writeFileSync(join(ws, ".mpd", "team", "teams", T_BASE + ".json"), JSON.stringify(base(T_BASE, { tasks: [task("T1", "first task"), task("T2", "second task", ["T1"])], nextTaskNumber: 3 }), null, 2))
writeFileSync(join(ws, ".mpd", "team", "teams", T_NEST + ".json"), JSON.stringify(base(T_NEST, { tasks: [task("T1", "root task")], nextTaskNumber: 2, nextConsultNumber: 2, consults: [consult(1, "consult-root", "Explorer", "root assignment", "running")] }), null, 2))
writeFileSync(join(ws, ".mpd", "team", "teams", T_CHILD + ".json"), JSON.stringify(base(T_CHILD, { parentTeamId: T_NEST, tasks: [task("T1", "child task")], nextTaskNumber: 2, nextConsultNumber: 2, consults: [consult(1, "consult-child", "Researcher", "child assignment", "cancelled", { finishedAt: 1750000002500, elapsedMs: 500 })] }), null, 2))
const bind = (id) => writeFileSync(join(ws, ".mpd", "team", "teams.json"), JSON.stringify({ version: 1, active: { workspace: id } }, null, 2) + "\n")
bind(T_CONS)
const port = 3933, logPath = join(root, "boot.log"), fd = openSync(logPath, "w")
const boot = spawn("dsh", ["--profile", "w", "--port", String(port), "--no-open"], { env, cwd: ws, stdio: ["ignore", fd, fd] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let cookie = "", token = "", up = false
const deadline = Date.now() + 180000
while (Date.now() < deadline) {
  await sleep(2000)
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
  const m = /token=([A-Za-z0-9_-]+)/.exec(log); if (m) token = m[1]
  if (token === "") continue
  try {
    const a = await fetch(`http://127.0.0.1:${port}/?token=${token}`, { redirect: "manual", signal: AbortSignal.timeout(8000) })
    const c = (a.headers.getSetCookie?.() ?? []).map((v) => v.split(";")[0]).join("; "); if (c) cookie = c
    const r = await fetch(`http://127.0.0.1:${port}/plugins/mpd-team/state`, { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(8000) })
    if (r.status === 200) { up = true; break }
  } catch {}
}
const get = async () => { const r = await fetch(`http://127.0.0.1:${port}/plugins/mpd-team/state`, { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(15000) }); return { status: r.status, body: await r.json() } }
const sCons = await get(); writeFileSync(join(evidence, "state-consults.json"), JSON.stringify(sCons.body, null, 2))
bind(T_BASE); const sBase = await get(); writeFileSync(join(evidence, "state-baseline.json"), JSON.stringify(sBase.body, null, 2))
bind(T_NEST); const sNest = await get(); writeFileSync(join(evidence, "state-nested.json"), JSON.stringify(sNest.body, null, 2))
const mCons = sCons.body?.model, mBase = sBase.body?.model, mNest = sNest.body?.model
const ids = (m) => (m?.consults ?? []).map((n) => n.id), has = (o, id) => JSON.stringify(o ?? {}).includes(id), j = JSON.stringify
const results = {
  ok: false, isolated: { DSH_HOME: home, HOME: userhome, workspace: ws, port },
  boot: { installExit: install.status, tokenSeen: token !== "", cookieSeen: cookie !== "", up, routeStatuses: [sCons.status, sBase.status, sNest.status] },
  consultsModel: mCons ? {
    hasConsultsKey: Object.prototype.hasOwnProperty.call(mCons, "consults"), ids: ids(mCons),
    states: (mCons.consults ?? []).map((n) => n.status), visuals: (mCons.consults ?? []).map((n) => n.visual),
    roles: (mCons.consults ?? []).map((n) => n.assignee), groups: (mCons.consults ?? []).map((n) => n.group ?? null),
    nodeIds: (mCons.nodes ?? []).map((n) => n.id),
    consultInNodes: has(mCons.nodes, "consult-a") || has(mCons.nodes, "consult-b"),
    consultInRanks: has(mCons.ranks, "consult-a") || has(mCons.ranks, "consult-b"),
    consultInEdges: has(mCons.edges, "consult-a") || has(mCons.edges, "consult-b"),
    consultInReport: has(mCons.report, "consult-a") || has(mCons.report, "consult-b"),
  } : null,
  baselineModel: mBase ? { hasConsultsKey: Object.prototype.hasOwnProperty.call(mBase, "consults"), nodeIds: (mBase.nodes ?? []).map((n) => n.id) } : null,
  byteIdentity: (mCons && mBase) ? { nodes: j(mCons.nodes) === j(mBase.nodes), edges: j(mCons.edges) === j(mBase.edges), ranks: j(mCons.ranks) === j(mBase.ranks), report: j(mCons.report) === j(mBase.report) } : null,
  nestedModel: mNest ? {
    ids: ids(mNest), groups: (mNest.consults ?? []).map((n) => n.group ?? null), states: (mNest.consults ?? []).map((n) => n.status),
    nodeIds: (mNest.nodes ?? []).map((n) => n.id),
    consultInNodes: has(mNest.nodes, "consult-child") || has(mNest.nodes, "consult-root"),
    consultInRanks: has(mNest.ranks, "consult-child") || has(mNest.ranks, "consult-root"),
    consultInEdges: has(mNest.edges, "consult-child") || has(mNest.edges, "consult-root"),
  } : null,
}
results.ok = results.boot.up === true
  && results.consultsModel?.hasConsultsKey === true && j(results.consultsModel.ids) === j(["C1", "C2"])
  && j(results.consultsModel.states) === j(["complete", "running"]) && j(results.consultsModel.visuals) === j(["completed", "running"])
  && j(results.consultsModel.roles) === j(["Explorer", "Researcher"]) && j(results.consultsModel.groups) === j([null, null])
  && results.consultsModel.consultInNodes === false && results.consultsModel.consultInRanks === false && results.consultsModel.consultInEdges === false && results.consultsModel.consultInReport === false
  && results.baselineModel?.hasConsultsKey === false
  && Object.values(results.byteIdentity ?? {}).every((v) => v === true)
  && j(results.nestedModel?.ids ?? []) === j(["C1", "team-boot-child::C1"]) && j(results.nestedModel?.groups ?? []) === j([null, "team-boot-child"])
  && results.nestedModel?.consultInNodes === false && results.nestedModel?.consultInRanks === false && results.nestedModel?.consultInEdges === false
writeFileSync(join(evidence, "result.json"), JSON.stringify(results, null, 2) + "\n")
// boot log, with the launch token redacted before it touches the repository.
const rawLog = existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
writeFileSync(join(evidence, "boot.log"), rawLog.replace(/token=[A-Za-z0-9_-]+/g, "token=<redacted>"))
copyFileSync("/tmp/consult-boot/boot.mjs", join(evidence, "probe.mjs"))
console.log(JSON.stringify({ ok: results.ok, boot: results.boot, consultsModel: results.consultsModel, byteIdentity: results.byteIdentity, nested: results.nestedModel }, null, 2))
try { boot.kill("SIGTERM") } catch {}
await sleep(1500)
try { boot.kill("SIGKILL") } catch {}
