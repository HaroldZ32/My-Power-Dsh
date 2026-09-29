#!/usr/bin/env node
/**
 * t8 (Lead) — INDEPENDENT verification of defect B1: every mpd plugin must resolve the
 * SESSION workspace root, not the dsh process cwd.
 *
 * This script is written from scratch for the verification task; it does NOT re-run t7's probe.
 * Shape (the ORIGINAL deployment shape, i.e. process cwd != session workspace):
 *   1) isolated DSH_HOME + sandbox HOME, a throwaway web profile "w" whose only bundle that
 *      matters is @mpd-dsh/mpd resolved from THIS checkout (symlink);
 *   2) `dsh --profile w --port 3196` is launched with cwd = /root/dshProj (the live deployment's
 *      launch cwd) while every session is created with an explicit workspace cwd — so the process
 *      cwd is provably NOT the session workspace;
 *   3) three REAL sessions are created over the gateway API and driven with REAL model turns
 *      (session/prompt). The model is asked to make the four reproductions of the defect plus the
 *      workmate in-use gate calls; the raw tool results are then read back out of the DURABLE
 *      session logs, so the assertion does not depend on the model's own prose;
 *   4) the workmate in-use gate is exercised against a CONTROLLED workspace fixture (blocked) and
 *      against the LIVE repo team record (member "Lead"), and the .mpd/team trees are hashed
 *      before/after to prove the gate is still read-only;
 *   5) apply-crash signatures must be 0 in the mounting boot log. NO --dump-config result is cited
 *      as load evidence anywhere.
 *
 * Usage: node evidence/session-workspace-root/t8-verify/live-session-proof.mjs
 */
import { mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync, existsSync, cpSync, symlinkSync, rmSync, readdirSync, statSync, lstatSync, readlinkSync } from "node:fs"
import { spawn, execFileSync } from "node:child_process"
import { homedir, tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..")            // the repo = the authoritative session workspace
const LAUNCH_CWD = process.env.T8_LAUNCH_CWD ?? "/root/dshProj"
const PORT = Number(process.env.T8_PORT ?? 3196)
const APPLY_CRASH = /unsupported JSON schema|JsonSchemaError|plugin tree failed to load|failed to apply loader entry/
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const say = (...parts) => console.log("[t8]", ...parts)

const sandbox = mkdtempSync(join(tmpdir(), "mpd-t8-"))
const home = join(sandbox, "dsh-home")
const userhome = join(sandbox, "user-home")
const profile = join(home, "profiles", "w")
const wBlocked = join(sandbox, "ws-blocked")
const wClean = join(sandbox, "ws-clean")
const outDir = join(HERE, process.env.T8_OUT ?? new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z") + "-proof")
mkdirSync(outDir, { recursive: true })

/* ── helpers ─────────────────────────────────────────────────────────────────────────────── */
function hashTree(root) {
  const files = []
  const walk = (dir) => {
    for (const entry of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  walk(root)
  files.sort()
  const hash = createHash("sha256")
  const per = {}
  for (const file of files) {
    const rel = relative(root, file)
    const fileHash = createHash("sha256").update(readFileSync(file)).digest("hex")
    per[rel] = fileHash
    hash.update(rel + "\0")
    hash.update(fileHash)
    hash.update("\0")
  }
  return { sha256: hash.digest("hex"), files: files.map((f) => relative(root, f)).sort(), per }
}

function treeDelta(before, after) {
  const changed = Object.keys(before.per).filter((rel) => after.per[rel] !== undefined && after.per[rel] !== before.per[rel])
  const removed = Object.keys(before.per).filter((rel) => after.per[rel] === undefined)
  const added = Object.keys(after.per).filter((rel) => before.per[rel] === undefined)
  return { changed, removed, added }
}

function shell(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options })
}

function readLogTail(path, bytes = 400000) {
  try { const text = readFileSync(path, "utf8"); return text.slice(-bytes) } catch { return "" }
}

function events(file) {
  const text = shell("zstd", ["-d", "-c", file])
  const out = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "") continue
    try { out.push(JSON.parse(trimmed)) } catch { /* partial tail line */ }
  }
  return out
}

function toolResultText(event) {
  const parts = event?.data?.message?.content ?? []
  const texts = []
  for (const part of parts) {
    if (part?.type !== "tool-result") continue
    for (const inner of part.content ?? []) if (inner?.type === "text") texts.push(String(inner.text ?? ""))
  }
  return texts.join("\n")
}

function toolResultRaw(event) {
  return JSON.stringify(event?.data?.message?.content ?? null).slice(0, 4000)
}

function findSessionLog(sessionId) {
  const sessionsRoot = join(home, "sessions")
  const walk = (dir) => {
    for (const entry of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === sessionId) {
          const candidate = join(path, "session.v3.jsonl.zstd")
          if (existsSync(candidate)) return candidate
        }
        const found = walk(path)
        if (found !== undefined) return found
      }
    }
    return undefined
  }
  return walk(sessionsRoot)
}

/* ── sandbox ─────────────────────────────────────────────────────────────────────────────── */
mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
mkdirSync(userhome, { recursive: true })
mkdirSync(home, { recursive: true })
symlinkSync(ROOT, join(profile, "node_modules", "@mpd-dsh", "mpd"), "dir")
writeFileSync(join(profile, "package.json"), JSON.stringify({
  name: "dsh-profile-t8", private: true, dependencies: {},
  dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } },
}, null, 2))
for (const name of [".credentials.yaml", "settings.yaml"]) {
  const source = join(homedir(), ".dsh", name)
  if (existsSync(source)) cpSync(source, join(home, name))
}
if (home.startsWith(join(homedir(), ".dsh"))) throw new Error("isolation assertion: DSH_HOME points at the real home")

// CONTROLLED workmate-gate fixture: the ONLY difference between the blocked and the clean workspace.
mkdirSync(wClean, { recursive: true })
mkdirSync(join(wBlocked, ".mpd", "team", "blocking-team"), { recursive: true })
writeFileSync(join(wBlocked, ".mpd", "team", "blocking-team", "team.json"), JSON.stringify({
  id: "blocking-team", name: "t8 controlled blocked workspace", archived: false,
  members: [{ name: "t8wm1" }, { name: "t8wm2" }],
}, null, 2))

// Read-only proof snapshots for the team-state trees the gate must only READ.
const teamTrees = {
  repo: join(ROOT, ".mpd", "team"),
  blocked: join(wBlocked, ".mpd", "team"),
  clean: join(wClean, ".mpd", "team"),
}
const teamBefore = Object.fromEntries(Object.entries(teamTrees).map(([k, v]) => [k, hashTree(v)]))

/* ── boot ────────────────────────────────────────────────────────────────────────────────── */
const bootLog = join(outDir, "boot.log")
const fd = openSync(bootLog, "w")
const child = spawn("dsh", ["--profile", "w", "--port", String(PORT), "--no-open"], {
  cwd: LAUNCH_CWD,
  env: { ...process.env, DSH_HOME: home, HOME: userhome },
  stdio: ["ignore", fd, fd],
})
let childCwd = ""
try { childCwd = readlinkSync(`/proc/${child.pid}/cwd`) } catch (error) { childCwd = "<unreadable: " + String(error?.code) + ">" }
say("launcher cwd =", process.cwd(), "| boot child pid =", child.pid, "| child /proc cwd =", childCwd)

let token = ""
let cookie = ""
const bootDeadline = Date.now() + 150000
while (Date.now() < bootDeadline) {
  await sleep(1500)
  const match = /token=([A-Za-z0-9_-]+)/.exec(readLogTail(bootLog))
  if (match !== null) token = match[1]
  if (token === "") continue
  try {
    const authorize = await fetch(`http://127.0.0.1:${PORT}/?token=${token}`, { redirect: "manual", signal: AbortSignal.timeout(8000) })
    cookie = (authorize.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ") || cookie
    const root = await fetch(`http://127.0.0.1:${PORT}/`, { headers: cookie === "" ? {} : { cookie }, signal: AbortSignal.timeout(8000) })
    if (cookie !== "" && root.status === 200) break
  } catch { /* not serving yet */ }
}
if (token === "") {
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ passed: false, stage: "boot", bootLog: readLogTail(bootLog) }, null, 2))
  try { child.kill("SIGKILL") } catch { /* gone */ }
  throw new Error("sandbox web profile never started serving (see boot.log)")
}
say("sandbox server up on port", PORT)

async function createSession(cwd, tag) {
  const rpcId = `t8-${tag}-${Date.now()}`
  const response = await fetch(`http://127.0.0.1:${PORT}/api/session/create`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ type: "client-request", rpcId, method: "session/create", payload: { args: { request: { cwd, agentPreset: "mpd" } } } }),
    signal: AbortSignal.timeout(60000),
  }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
  const envelope = await response.json().catch(() => ({}))
  const value = envelope?.result?.value ?? envelope?.result ?? {}
  const sessionId = value?.sessionId ?? null
  say(`session/${tag} cwd=${cwd} status=${response.status} sessionId=${sessionId} ok=${value?.ok ?? "?"} err=${envelope?.error?.code ?? value?.error?.code ?? "none"}`)
  say(`session/${tag} raw-envelope=${JSON.stringify(envelope).slice(0, 500)}`)
  return { tag, cwd, sessionId, status: response.status, envelope }
}

async function promptSession(sessionId, requestId, text) {
  const response = await fetch(`http://127.0.0.1:${PORT}/api/session/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      type: "client-request", rpcId: requestId, method: "session/prompt",
      payload: { args: { request: { sessionId, requestId, mode: "queue", content: [{ type: "text", text }] } } },
    }),
    signal: AbortSignal.timeout(60000),
  }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
  const envelope = await response.json().catch(() => ({}))
  const value = envelope?.result?.value ?? envelope?.result ?? {}
  say(`prompt/${sessionId.slice(0, 18)} status=${response.status} accepted=${JSON.stringify(value?.accepted ?? envelope?.error ?? null)}`)
  say(`prompt/${sessionId.slice(0, 18)} raw-envelope=${JSON.stringify(envelope).slice(0, 700)}`)
  return { status: response.status, envelope }
}

const sessions = {}
for (const [tag, cwd] of [["repo", ROOT], ["blocked", wBlocked], ["clean", wClean]]) sessions[tag] = await createSession(cwd, tag)

const PROMPTS = {
  repo: [
    "You are executing a FIXED verification script. Make these tool calls, EXACTLY once each, in this order, and do not call any other tool:",
    '1. mpd_hashline_read with arguments {"path": ".mpd/hashline-files.json"}',
    '2. mpd_verif_venv with arguments {"action": "info"}',
    "3. mpd_memory_status with arguments {}",
    "4. mpd_boulder_plans with arguments {}",
    '5. mpd_workmate_init with arguments {"base": "oracle", "name": "lead"}',
    '6. mpd_workmate_rename with arguments {"name": "lead", "new_name": "lead-x"}',
    "Call 6 is expected to be refused; that is the point of the check. When all calls are done, reply with the verbatim raw output text of each call, labelled CALL1 to CALL6.",
  ].join("\n"),
  blocked: [
    "You are executing a FIXED verification script. Make these tool calls, EXACTLY once each, in this order, and do not call any other tool:",
    '1. mpd_workmate_init with arguments {"base": "oracle", "name": "t8wm1"}',
    '2. mpd_workmate_rename with arguments {"name": "t8wm1", "new_name": "t8wm2"}',
    "Call 2 is expected to be refused; that is the point of the check. When done, reply with the verbatim raw output text of each call, labelled CALL1 and CALL2.",
  ].join("\n"),
  clean: [
    "You are executing a FIXED verification script. Make these tool calls, EXACTLY once each, in this order, and do not call any other tool:",
    '1. mpd_workmate_init with arguments {"base": "oracle", "name": "t8wm3"}',
    '2. mpd_workmate_rename with arguments {"name": "t8wm3", "new_name": "t8wm4"}',
    '3. mpd_workmate_delete with arguments {"name": "t8wm4"}',
    "All three are expected to succeed. When done, reply with the verbatim raw output text of each call, labelled CALL1 to CALL3.",
  ].join("\n"),
}

const prompted = {}
for (const [tag, session] of Object.entries(sessions)) {
  if (session.sessionId === null) { prompted[tag] = { status: 0, note: "no session" }; continue }
  prompted[tag] = await promptSession(session.sessionId, `t8-${tag}-turn1`, PROMPTS[tag])
}

// Wait for turn/end in every driven session (then SIGTERM flushes the durable logs).
const waitDeadline = Date.now() + 300000
const logPaths = {}
while (Date.now() < waitDeadline) {
  let allDone = true
  for (const [tag, session] of Object.entries(sessions)) {
    if (session.sessionId === null) continue
    const file = findSessionLog(session.sessionId)
    if (file === undefined) { allDone = false; continue }
    logPaths[tag] = file
    let done = false
    try { done = events(file).some((event) => event.type === "turn/end") } catch { done = false }
    if (!done) allDone = false
  }
  if (allDone && Object.keys(logPaths).length >= 3) break
  await sleep(3000)
}
say("turn wait finished; logs:", JSON.stringify(Object.fromEntries(Object.entries(logPaths).map(([k, v]) => [k, v.replace(home, "$DSH_HOME")]))))

try { child.kill("SIGTERM") } catch { /* already gone */ }
for (let i = 0; i < 40 && child.exitCode === null && child.signalCode === null; i++) await sleep(500)
try { child.kill("SIGKILL") } catch { /* already gone */ }
await sleep(1000)

/* ── extract raw evidence ────────────────────────────────────────────────────────────────── */
const extracted = {}
for (const [tag, file] of Object.entries(logPaths)) {
  const list = events(file)
  const calls = new Map()
  for (const event of list) if (event.type === "tool/call") calls.set(event.data.callId, { name: event.data.name, arguments: event.data.arguments })
  const results = []
  for (const event of list) {
    if (event.type !== "tool/result") continue
    const callId = event?.data?.message?.content?.[0]?.toolCallId
    results.push({ callId, name: calls.get(callId)?.name ?? "<unknown>", arguments: calls.get(callId)?.arguments ?? null, text: toolResultText(event), raw: toolResultRaw(event) })
  }
  const dump = join(outDir, `session-${tag}.jsonl`)
  writeFileSync(dump, shell("zstd", ["-d", "-c", file]))
  extracted[tag] = { file, events: list.length, turns: list.filter((e) => e.type === "turn/end").map((e) => e.data?.reason ?? null), results, dump }
  say(`session/${tag}: events=${list.length} toolResults=${results.length} turnEnd=${JSON.stringify(extracted[tag].turns)}`)
}

const workmateLibrary = existsSync(join(userhome, ".mpd", "workmate"))
  ? readdirSync(join(userhome, ".mpd", "workmate")).sort()
  : []
const teamAfter = Object.fromEntries(Object.entries(teamTrees).map(([k, v]) => [k, hashTree(v)]))
const bootText = readLogTail(bootLog, 4_000_000)
const crashHits = [...bootText.matchAll(new RegExp(APPLY_CRASH.source, "g"))].map((m) => m[0])

const byName = (tag, name) => extracted[tag]?.results.find((r) => r.name === name)
const text = (tag, name) => byName(tag, name)?.text ?? ""
const under = (p, root) => typeof p === "string" && (p === root || p.startsWith(root + "/"))

const checks = []
const check = (id, pass, detail) => { checks.push({ id, status: pass ? "PASS" : "FAIL", detail: String(detail).slice(0, 1200) }); say(`CHECK ${id}=${pass ? "PASS" : "FAIL"} ${String(detail).slice(0, 400)}`) }

check("P1_LAUNCH_CWD_IS_NOT_SESSION_WORKSPACE", childCwd === LAUNCH_CWD && LAUNCH_CWD !== ROOT, `child /proc cwd=${childCwd} launchCwd=${LAUNCH_CWD} sessionWorkspace=${ROOT}`)
check("P2_APPLY_CRASH_SIGNATURES_ZERO", crashHits.length === 0, `hits=${JSON.stringify(crashHits)}`)
check("P3_MOUNT_MARKERS", bootText.includes("[mpd-dsh-adapter] mpdDsh provided") && /skill corpus served from .*\/skills/.test(bootText), `adapter=${bootText.includes("[mpd-dsh-adapter] mpdDsh provided")} skillsServed=${/skill corpus served from/.test(bootText)}`)

const r1 = text("repo", "mpd_hashline_read")
check("R1_HASHLINE_RELATIVE_READ", r1 !== "" && !/file not found/.test(r1) && !/\/root\/dshProj\/\.mpd\/hashline-files\.json/.test(r1) && /files/.test(r1), `raw=${r1.slice(0, 300)}`)
const r2 = text("repo", "mpd_verif_venv")
check("R2_VERIF_INFO_RESOLVES_REPO", r2.includes(`workspace ${ROOT}`) && r2.includes(`venv ${ROOT}/.venv-rtl`) && r2.includes(`work ${ROOT}/.mpd/verif`), `raw=${r2.slice(0, 300)}`)
const r3 = text("repo", "mpd_memory_status")
check("R3_MEMORY_STATUS_RESOLVES_REPO", r3.includes(`root=${ROOT}/.mpd/memory`), `raw=${r3.slice(0, 300)}`)
const r4 = text("repo", "mpd_boulder_plans")
check("R4_BOULDER_PLANS_LISTS_REPO_PLAN", r4.includes(`${ROOT}/.mpd/plans/workmate-rename-delete-contract.md`), `raw=${r4.slice(0, 300)}`)

const wBlockedRename = text("blocked", "mpd_workmate_rename")
check("W1_BLOCKED_WS_GATE_REFUSES", /in use/.test(wBlockedRename) && /blocking-team\/t8wm1/.test(wBlockedRename), `raw=${wBlockedRename.slice(0, 400)}`)
const wCleanRename = text("clean", "mpd_workmate_rename")
const wCleanDelete = text("clean", "mpd_workmate_delete")
check("W2_CLEAN_WS_ALLOWS_AND_ARCHIVES", !/Error|in use/.test(wCleanRename) && /t8wm4/.test(wCleanRename) && /archive/.test(wCleanDelete), `rename=${wCleanRename.slice(0, 200)} delete=${wCleanDelete.slice(0, 200)}`)
const wRealTeamRename = text("repo", "mpd_workmate_rename")
check("W3_LIVE_REPO_TEAM_RECORD_SEEN", /in use/.test(wRealTeamRename) && /mpd-default-7332aba4/.test(wRealTeamRename), `raw=${wRealTeamRename.slice(0, 400)}`)
// The repo tree hosts the LIVE team record of the session that runs this verification; the running
// agent-teams plugin keeps writing ITS OWN record. Any change there is attributed explicitly, and the
// read-only assertion is exact for every other path (plus byte-exact for the controlled workspaces).
const LIVE_TEAM_DIR = "mpd-default-7332aba4/"
const repoDelta = treeDelta(teamBefore.repo, teamAfter.repo)
const repoDeltaOutsideLiveTeam = {
  changed: repoDelta.changed.filter((rel) => !rel.startsWith(LIVE_TEAM_DIR)),
  removed: repoDelta.removed,
  added: repoDelta.added.filter((rel) => !rel.startsWith(LIVE_TEAM_DIR)),
}
const blockedDelta = treeDelta(teamBefore.blocked, teamAfter.blocked)
const cleanDelta = treeDelta(teamBefore.clean, teamAfter.clean)
check("W4_TEAM_STATE_READ_ONLY",
  blockedDelta.changed.length === 0 && blockedDelta.removed.length === 0 && blockedDelta.added.length === 0 &&
  cleanDelta.changed.length === 0 && cleanDelta.removed.length === 0 && cleanDelta.added.length === 0 &&
  repoDeltaOutsideLiveTeam.changed.length === 0 && repoDeltaOutsideLiveTeam.removed.length === 0 && repoDeltaOutsideLiveTeam.added.length === 0,
  JSON.stringify({ repoDelta, repoDeltaOutsideLiveTeam, blockedDelta, cleanDelta, attribution: "changes inside " + LIVE_TEAM_DIR + " are written by the LIVE agent-teams plugin of the running team, not by the workmate gate" }))

const expected = { repo: ["mpd_hashline_read", "mpd_verif_venv", "mpd_memory_status", "mpd_boulder_plans", "mpd_workmate_init", "mpd_workmate_rename"], blocked: ["mpd_workmate_init", "mpd_workmate_rename"], clean: ["mpd_workmate_init", "mpd_workmate_rename", "mpd_workmate_delete"] }
const missing = []
for (const [tag, names] of Object.entries(expected)) for (const name of names) if (byName(tag, name) === undefined) missing.push(`${tag}:${name}`)
check("P4_ALL_EXPECTED_TOOL_CALLS_OBSERVED", missing.length === 0, `missing=${JSON.stringify(missing)}`)

const failed = checks.filter((c) => c.status !== "PASS")
const result = {
  task: "t8 — independent verification of B1 (session workspace root resolution)",
  method: "REAL model turns (session/prompt) in REAL gateway sessions of a fresh boot whose process cwd is deliberately different from every session workspace; assertions read the durable session logs, not the model's prose",
  isolation: { DSH_HOME: home.replace(sandbox, "$SANDBOX"), HOME: userhome.replace(sandbox, "$SANDBOX") },
  launchCwd: LAUNCH_CWD,
  bootChildCwd: childCwd,
  sessionWorkspaces: { repo: ROOT, blocked: wBlocked, clean: wClean },
  note: "no --dump-config result is cited as load evidence; the mounting boot log (boot.log) is the load evidence",
  applyCrashSignatures: crashHits,
  sessions: Object.fromEntries(Object.entries(sessions).map(([tag, s]) => [tag, { sessionId: s.sessionId, status: s.status, cwd: s.cwd, promptStatus: prompted[tag]?.status ?? null }])),
  sessionLogs: Object.fromEntries(Object.entries(extracted).map(([tag, e]) => [tag, { dump: relative(ROOT, e.dump), events: e.events, turns: e.turns, toolResults: e.results }])),
  workmateLibrary,
  teamTreeHashes: { before: teamBefore, after: teamAfter },
  checks,
  failedChecks: failed.map((c) => c.id),
  passed: failed.length === 0,
}
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
rmSync(sandbox, { recursive: true, force: true })
say(`evidence -> ${outDir}`)
say(`passed=${result.passed} failed=${JSON.stringify(result.failedChecks)}`)
process.exit(result.passed ? 0 : 1)
