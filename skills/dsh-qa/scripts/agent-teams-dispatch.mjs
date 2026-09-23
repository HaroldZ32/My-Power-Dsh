#!/usr/bin/env node
// Case agent-teams-dispatch (fix: the shared-task scheduler must wake the next
// batch after the first batch completes).
//
// Live defect this case reproduces (2026-09-10, team "workmate-rename-delete"):
// the captain approved a staged team, the first batch ran, and then the
// dependency-ready tasks (t3/t4/t5) were NEVER delivered. Member session logs
// contain only the spawn prompt, every `agent_teams_send_message` result read
// "delivered via mailbox", and the captain's own status kick woke nobody.
// Root cause: the adopted 0.1.14 body called `ctx.subagents.followup(...)`,
// which the running Harness does not expose; delivery is the host's public
// `ctx.subagents.prompt(request, signal)` continuable seam (0.1.5-rc.2+), which
// replaced the older symbol-keyed FIFO queue.
//
// Offline self-test (what test:qa runs):
//   1) the INSTALLED host still has no `followup` on the subagent service face
//      and owns the public `prompt(request, signal)` seam — i.e. the fix
//      targets a real seam;
//   2) the shipped plugin delivers through `queueMemberPrompt`, preferring
//      `ctx.subagents.prompt`, never through `ctx.subagents.followup`;
//   3) both scheduler triggers exist: a task mutation kicks the team, and a
//      member idle edge kicks that member;
//   4) the capability layer still denies members every captain-only tool.
// Real run (needs a model route): drives a two-task dependency chain in an
// isolated DSH_HOME and asserts both tasks COMPLETE plus the scheduler's
// automatic assignment prompt reached the member owning the DEPENDENT task —
// exactly the wake the pre-fix delivery path could never perform. Measured
// (2026-09-11, Harness 0.1.5-rc.1 / subagent 0.1.5-rc.2): the first-batch
// member finished its own task inside its spawn turn from the join prompt
// (`Current team status: 2 task(s), 1 pending task(s) assigned to you`) and was
// never woken again, while the dependent member idled and then received the
// assignment — so a marker-in-both-logs assertion is a false negative.
//
// Harness note (2026-09-11): the dispatcher is driven by live `agent/status`
// idle edges, so it needs the captain process to OUTLIVE member settlement.
// `dsh --profile headless "…"` is one-shot: it turns the prompt into one
// captain turn and exits, and process exit disposes every continuable member.
// Measured: the captain approved 3.7s in and the process left immediately, so
// all 11 members were killed with only `turn/start`/`request/header` in their
// session log (no `turn/end`, no first assistant message) and never emitted an
// idle edge — tasks stayed `pending`/attempt 0. The probe prompt therefore has
// the captain run a bounded `sleep` after approving, which emulates the
// long-lived Web/TUI captain session the scheduler is designed around without
// changing any plugin behavior (the sleep only holds the process open).
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, cpSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.mjs"
import { DSH_MISSING, dshCommand, resolveDshLauncher } from "./lib/dsh-launcher.mjs"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const PLUGIN = join(repoRoot, "packages", "mpd-agent-teams-plugin")
const LOG = []
const ASSIGNMENT_MARKER = "AgentTeams automatic task assignment"

function fail(msg) { console.error("[agent-teams-dispatch] FAIL: " + msg); process.exit(1) }

/**
 * The PATH-resolved `dsh` launcher, WITHOUT `sh` and WITHOUT `which`.
 *
 * `which dsh` is POSIX-only in two ways: there is no `which` program on Windows, and the MSYS
 * `which` a Git-Bash host answers with prints a POSIX path (`/c/Users/...`) that `realpathSync`
 * cannot resolve — measured `ENOENT: lstat 'C:\c'`, which took the whole case down. The PATH scan
 * is the platform-native equivalent and needs no shell at all.
 */
function whichDsh() {
  const dirs = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":")
  const names = process.platform === "win32" ? ["dsh.cmd", "dsh.exe", "dsh.bat", "dsh"] : ["dsh"]
  for (const dir of dirs) {
    if (dir === "") continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return ""
}

/**
 * Locate the installed @deepseek-ai/dsh package root.
 *
 * POSIX resolves the `bin/dsh` symlink INTO the package, so the peers sit at
 * `<pkg>/node_modules/@deepseek-ai/*` and one upward walk finds them. npm's Windows launcher is
 * not a symlink: `<prefix>\dsh.cmd` only marks the npm prefix, and the package plus its peers hang
 * off `<prefix>\node_modules\@deepseek-ai\dsh` — so BOTH shapes are probed at every ancestor.
 */
function hostRoot() {
  const bin = whichDsh()
  if (bin === "") return null
  let real = bin
  try { real = realpathSync(bin) } catch { /* keep the literal path */ }
  let dir = dirname(real)
  for (let i = 0; i < 8; i++) {
    const candidates = [dir, join(dir, "node_modules", "@deepseek-ai", "dsh")]
    for (const candidate of candidates) {
      if (existsSync(join(candidate, "node_modules", "@deepseek-ai", "dsh-subagent"))) return candidate
      if (existsSync(join(candidate, "package.json"))) {
        try {
          if (JSON.parse(readFileSync(join(candidate, "package.json"), "utf8")).name === "@deepseek-ai/dsh") return candidate
        } catch { /* keep looking */ }
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** Decompress a zstd session log (concatenated frames), best effort. */
function readSessionLog(path) {
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const buf = readFileSync(path)
  const idxs = []
  for (let i = 0; i <= buf.length - 4; i++) if (buf.compare(MAGIC, 0, 4, i, i + 4) === 0) idxs.push(i)
  const parts = []
  for (let k = 0; k < idxs.length; k++) {
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(idxs[k], k + 1 < idxs.length ? idxs[k + 1] : buf.length))) } catch { /* partial tail */ }
  }
  return Buffer.concat(parts).toString("utf8")
}

function selfTest() {
  const checks = []
  const host = hostRoot()
  if (host === null) fail("dsh not on PATH; cannot verify the installed host contract")
  const hostSubagent = join(host, "node_modules", "@deepseek-ai", "dsh-subagent")
  const face = readFileSync(join(hostSubagent, "lib", "typert.host.js"), "utf8")
  const hostImpl = readFileSync(join(hostSubagent, "lib", "index.js"), "utf8")
  // 1) the installed host: no public followup member, but the public prompt
  //    seam that replaced the symbol queue at 0.1.5-rc.2.
  checks.push(["installed host exposes no subagent followup member", !/"name": "followup"/.test(face)])
  checks.push(["installed host owns the public subagent prompt seam",
    hostImpl.includes('"subagent.prompt": z.object({')
    && hostImpl.includes('mode: z.literal("continuable")')
    && hostImpl.includes('delivery: z.enum(["queue", "steer"])')
    && /async prompt\(request, signal\)/.test(hostImpl)])
  checks.push(["installed host face declares the prompt request/receipt contract",
    /"name": "prompt"/.test(face)
    && face.includes('"name": "SubagentPromptRequest"')
    && face.includes('"name": "SubagentPromptReceipt"')])

  const members = readFileSync(join(PLUGIN, "lib", "members.js"), "utf8")
  const compat = readFileSync(join(PLUGIN, "lib", "harness-compat.js"), "utf8")
  // 2) the shipped plugin binds the delivery seam, not the retired method.
  // The bridge rewired this call site inside a delta region (members.js `adapter-delivery-runtime`):
  // delivery still goes through `queueMemberPrompt`, but with the audited subagent RUNTIME object
  // resolved by the bridge (`subagentRuntimeOf`, imported from the facade module) — the facade's
  // `subagents` member is a projection whose ladder lookups would silently look undeliverable. The
  // pre-bridge spelling is asserted ABSENT, so a regression back to the raw projection reddens here.
  checks.push(["member delivery uses the audited boundary",
    members.includes("import { subagentRuntimeOf } from \"./mpd-adapter-ctx.js\";")
    && members.includes("await queueMemberPrompt(subagentRuntimeOf(ctx), captain, brandedSessionId(childId),")
    && !members.includes("await queueMemberPrompt(ctx.subagents,")])
  checks.push(["no call site uses ctx.subagents.followup",
    !/ctx\.subagents\.followup/.test(members) && !/ctx\.subagents\.followup/.test(readFileSync(join(PLUGIN, "lib", "scheduler.js"), "utf8"))])
  checks.push(["modern delivery prefers the public prompt seam",
    compat.includes("if (typeof runtime.prompt === 'function')")
    && compat.includes("mode: 'continuable',")
    && compat.includes("delivery: 'queue',")])
  // Regression (2026-09-11): the modern setup ran `const child = childCtx.agent`.
  // An agent-scoped Cordis ctx is a proxy that throws
  // `cannot get property "agent" without inject`, and the listener runs for the
  // captain's own session too, so it aborted member initialization team-wide and
  // made 0.1.5 team mode unusable. The seam must hand the Agent over as an argument.
  checks.push(["modern member setup receives the live Agent instead of reading childCtx.agent",
    compat.includes("setup(agent.ctx, agent)")
    && members.includes("const child = hostChild ?? childCtx.agent;")])
  checks.push(["legacy followup/queue remain only as older-generation fallbacks",
    compat.includes("if (typeof runtime.followup === 'function')")
    && compat.includes("const queue = runtime[HOST_PROMPT_QUEUE]")
    && compat.includes("Symbol.for('dsh.subagent.queuePrompt')")])

  // 3) both scheduler triggers that must exist for a second batch.
  const scheduler = readFileSync(join(PLUGIN, "lib", "scheduler.js"), "utf8")
  const tools = readFileSync(join(PLUGIN, "lib", "tools.js"), "utf8")
  checks.push(["task mutations kick the whole team", /await scheduler\.kickTeam\(workspace, team\.id/.test(tools)])
  checks.push(["member idle edges kick that member", scheduler.includes("if (status === 'idle')\n            await runtime.kickMember(workspace, located.id, member.name);")])
  checks.push(["delivery failure rolls the claim back instead of stranding it",
    scheduler.includes("task.status = 'pending';") && scheduler.includes("releaseMailboxDelivery")])

  // 4) members can never call captain-only operations (capability layer).
  const caps = readFileSync(join(PLUGIN, "lib", "capabilities.js"), "utf8")
  const names = readFileSync(join(PLUGIN, "lib", "tool-names.js"), "utf8")
  // The bridge resolves the per-agent scope ONCE (`agentScopeOf`, region `adapter-agent-scope`): the
  // member-only restriction still runs the captain-only DENY filter on that scope's tools object, and
  // the filter expression itself is asserted verbatim, so this check cannot pass on a refactor that
  // drops the deny list (a bare `restrict({` substring would have gone green on any tools object).
  checks.push(["capabilities deny all captain-only tools for members",
    caps.includes("const scope = agentScopeOf(ctx, agent);")
    && caps.includes("revoke = scope.tools.restrict({")
    && caps.includes("deny: TEAM_TOOL_NAMES.filter(name => !MEMBER_TOOL_NAMES.includes(name)),")
    && names.includes("'agent_teams_approve'") && names.includes("'agent_teams_edit_plan'")])
  checks.push(["members receive member instructions, not the captain protocol",
    caps.includes("export const TEAM_MEMBER_PROMPT") && caps.includes("? TEAM_MEMBER_PROMPT : captainPrompt")])

  // 5) the real-run assertion targets the DEPENDENT task's assignee. Measured
  //    (2026-09-11): the first-batch member completes inside its spawn turn from
  //    the join prompt and is never woken again, so requiring the assignment
  //    marker in BOTH member logs reported a false negative on a correct run.
  const self = readFileSync(fileURLToPath(import.meta.url), "utf8")
  const oldAssertion = "assignments" + ".length >= " + "2"
  checks.push(["real run asserts the wake on the dependent task's assignee only",
    self.includes("const dependentAssignee = probeB?.assignee")
    && self.includes("s.label.endsWith(`:${dependentAssignee}`)")
    && !self.includes(oldAssertion)])

  const failed = checks.filter(([, ok]) => !ok)
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`)
  if (failed.length > 0) fail(`${failed.length} of ${checks.length} checks failed`)
  console.log(`[agent-teams-dispatch self-test] ok: ${checks.length} checks`)
}

const PROMPT = [
  "AgentTeams dispatch probe. Do exactly this and nothing else:",
  "1. Call agent_teams_approve for the staged team (the approval is already authorized).",
  "2. Call agent_teams_create_task for subject DISPATCH-PROBE-A with assignee Planner, no dependencies,",
  "   description: 'Reply with exactly A-OK in your report, then complete this task immediately with status=completed and output A-OK. Do not run any command.'",
  "3. Call agent_teams_create_task for subject DISPATCH-PROBE-B with assignee Researcher, dependencies = the returned id of DISPATCH-PROBE-A,",
  "   description: 'Reply with exactly B-OK in your report, then complete this task immediately with status=completed and output B-OK. Do not run any command.'",
  "4. Call agent_teams_approve again for the staged team so the two tasks are approved together.",
  "5. Then keep the process alive while the team works: call the bash tool three times, each time with",
  "   command `sleep 110` — three SEPARATE calls, do NOT combine them into one command.",
  "   (headless dsh exits the moment your turn ends, which disposes every member before the",
  "   scheduler can assign it; the sleeps only hold the process open. Do not poll anyone.)",
  "6. After the third sleep returns, end your turn. Do not message the members; the scheduler assigns them.",
].join("\n")

function teamState(ws) {
  const root = join(ws, ".mpd", "team")
  if (!existsSync(root)) return null
  for (const id of readdirSync(root)) {
    const p = join(root, id, "team.json")
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, "utf8")) } catch { /* keep looking */ }
    }
  }
  return null
}

/** Every agent session, with its subagent label and whether the scheduler's
 *  automatic assignment prompt reached it. */
function sessionAssignments(sandbox) {
  const sessions = join(sandbox, "sessions")
  const found = []
  if (!existsSync(sessions)) return found
  for (const key of readdirSync(sessions)) {
    if (!key.startsWith("--")) continue
    for (const entry of readdirSync(join(sessions, key))) {
      const dir = join(sessions, key, entry)
      // This Harness writes `session.v3.jsonl.zstd`; older releases wrote
      // `session.jsonl.zstd`. Reading only the legacy name made this case report
      // 0 deliveries even after the scheduler dispatched correctly.
      const zstd = ["session.v3.jsonl.zstd", "session.jsonl.zstd"]
        .map((name) => join(dir, name))
        .find((candidate) => existsSync(candidate))
      if (zstd === undefined) continue
      try {
        const text = readSessionLog(zstd)
        let label = ""
        for (const line of text.split("\n")) {
          if (!line.includes("subagent/descriptor")) continue
          try {
            const ev = JSON.parse(line)
            label = ev.data?.label ?? ev.label ?? ""
          } catch { /* keep scanning */ }
          if (label !== "") break
        }
        found.push({ entry, label, assigned: text.includes(ASSIGNMENT_MARKER) })
      } catch { /* unreadable log is not a delivery */ }
    }
  }
  return found
}

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  const settings = join(homedir(), ".dsh", "settings.yaml")
  const hasEnvRoute = Object.keys(process.env).some((name) => /DEEPSEEK_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY/.test(name))
  if (!existsSync(creds) && !hasEnvRoute) fail("no credentials and no provider key in the environment; run this from a shell that has the deployment's model route")
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "dsh-qa", "agent-teams-dispatch", ts)
  mkdirSync(outDir, { recursive: true })
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dispatch-"))
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
  const ws = join(sandbox, "ws")
  mkdirSync(ws, { recursive: true })
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox  })
  const steps = {}
  let failed = false

  function runSync(cmd, args, opts = {}) {
    const spec = cmd === "dsh" ? dshCommand(args, env) : { command: cmd, args }
    const r = spec === null ? { status: null, stdout: "", stderr: DSH_MISSING } : spawnSync(spec.command, spec.args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    const out = (r.stdout || "") + (r.stderr || "")
    LOG.push("$ " + cmd + " " + args.join(" ") + "\n[[exit=" + r.status + "]]\n" + out.slice(0, 20000))
    return { status: r.status, out }
  }

  const inst = runSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { timeout: 600000 })
  steps.installer = { ok: inst.status === 0, exit: inst.status }
  const live = runSync("dsh", ["--profile", "mpd-headless", PROMPT], { timeout: 600000, cwd: ws })
  steps.captainRun = { ok: live.status === 0, exit: live.status, tail: live.out.slice(-600) }

  // Poll the durable team state: the scheduler must finish BOTH tasks, and the
  // dependent one can only start after its prerequisite completed.
  const deadline = Date.now() + 15 * 60_000
  let state = null
  while (Date.now() < deadline) {
    state = teamState(ws)
    const tasks = state?.tasks ?? []
    const done = tasks.filter((t) => t.status === "completed").length
    if (tasks.length >= 2 && done >= 2) break
    if (tasks.some((t) => t.status === "failed")) break
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  const tasks = state?.tasks ?? []
  const probeA = tasks.find((t) => t.subject === "DISPATCH-PROBE-A")
  const probeB = tasks.find((t) => t.subject === "DISPATCH-PROBE-B")
  steps.tasks = { a: probeA?.status, b: probeB?.status, total: tasks.length }
  const sessions = sessionAssignments(sandbox)
  const assigned = sessions.filter((s) => s.assigned)
  steps.memberAssignments = {
    count: assigned.length,
    sessions: sessions.length,
    labels: assigned.map((s) => s.label || s.entry).slice(0, 8),
  }

  steps.secondBatchDispatched = { ok: probeA?.status === "completed" && probeB?.status === "completed" }
  // The case's point is that the scheduler WAKES THE NEXT BATCH: the member
  // owning the dependent task must receive the automatic assignment once its
  // prerequisite completes. The first-batch member can finish its own task
  // inside its spawn turn straight from the join prompt and then never need a
  // scheduler wake — that is correct, not a missed delivery, so requiring the
  // marker in BOTH member logs is a false negative. Assert it on the dependent
  // task's assignee instead (recorded from the live team state).
  const dependentAssignee = probeB?.assignee
  const dependentDelivered = dependentAssignee !== undefined
    && sessions.some((s) => s.assigned && s.label.endsWith(`:${dependentAssignee}`))
  steps.assignmentDelivery = { ok: dependentDelivered, dependentAssignee }
  for (const [k, v] of Object.entries(steps)) if ("ok" in v && !v.ok) failed = true
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: !failed, sandbox, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), LOG.join("\n\n---\n\n"))
  console.log("[agent-teams-dispatch] ok=" + !failed + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 300))
  if (failed) process.exit(1)
  console.log("[agent-teams-dispatch] PASS")
}

if (process.argv.slice(2).includes("--self-test")) selfTest()
else await runReal()
