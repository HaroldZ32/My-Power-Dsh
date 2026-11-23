import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { setTimeout as pause } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { messagesTextEvents, messagesToolUseEvents, readWireRequest, writeMessagesSse } from "./bundle/skills/dsh-qa/scripts/lib/messages-sse.ts"
import type { MessagesEvent } from "./bundle/skills/dsh-qa/scripts/lib/messages-sse.ts"
import { decodeSessionLog } from "./bundle/skills/dsh-qa/scripts/lib/session-evidence.ts"
import type { SessionRecord } from "./bundle/skills/dsh-qa/scripts/lib/session-evidence.ts"
import { assertSessionsSandboxed, projectKey, sandboxWorkspace } from "./bundle/skills/dsh-qa/scripts/lib/workspace-isolation.ts"

/** All runtime state lives under this fixture's own ignored scratch directory. */
const root = dirname(fileURLToPath(import.meta.url))
/** The route is explicit so no ambient model configuration or credentials reach the fixture. */
const route = { provider: "deepseek-official", model: "deepseek-flash" } as const
/** The canned, non-secret receipt that proves a child result reached its caller. */
const receipt = "QA_FIXED_CHILD_RESULT"
/** Scheduled model action for one tagged user turn. */
type Action = { readonly name: string; readonly args: Readonly<Record<string, unknown>> }
/** A compact record of a real tool call and its paired result from the host log. */
type Call = { readonly name: string; readonly id: string; readonly error: boolean | null; readonly text: string }

/** Read a dynamic property from an untrusted JSON value. */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && Object.hasOwn(value, key) ? Reflect.get(value, key) : undefined
}

/** Put multiple independent tool blocks in one Messages response. */
function toolTurn(tag: string, actions: readonly Action[]): MessagesEvent[] {
  const template = messagesToolUseEvents("template", "template", {})
  const blocks = actions.flatMap(({ name, args }, index) =>
    messagesToolUseEvents(`call_${tag}_${index}`, name, args)
      .slice(1, 4).map((event) => ({ ...event, index })),
  )
  return [...template.slice(0, 1), ...blocks, ...template.slice(-2)]
}

/** Poll disk and local boot readiness with a wall-clock bound. */
async function until<T>(read: () => T | undefined, label: string): Promise<T> {
  const expires = Date.now() + 45_000
  while (Date.now() < expires) {
    const value = read()
    if (value !== undefined) return value
    await pause(100)
  }
  throw new Error(`Timed out: ${label}`)
}

/** Pair exact tool call IDs against the v4 host tool-result records. */
function callsOf(records: readonly SessionRecord[]): Call[] {
  const messages = new Map<unknown, unknown>()
  for (const entry of records.filter((event) => event.type === "tool/result")) {
    const message = field(entry.data, "message")
    messages.set(field(message, "toolCallId"), message)
  }
  return records.flatMap((entry) => {
    if (entry.type !== "tool/call") return []
    const name = field(entry.data, "name")
    const id = field(entry.data, "callId")
    if (typeof name !== "string" || typeof id !== "string") return []
    const message = messages.get(id)
    const error = field(message, "isError")
    const content = field(message, "content")
    const text = Array.isArray(content) ? content.map((part: unknown) => field(part, "text")).filter((part) => typeof part === "string").join("\n") : ""
    return [{ name, id, error: typeof error === "boolean" ? error : null, text }]
  })
}

/** Load one explicitly named session log. The helper decodes every complete zstd frame. */
function logFor(home: string, workspace: string, session: string): readonly SessionRecord[] {
  const dir = join(home, "sessions", projectKey(workspace), session)
  if (!existsSync(dir)) return []
  const filename = readdirSync(dir).find((name) => /^session\.v\d+\.jsonl(\.zstd)?$/.test(name))
  if (filename === undefined) return []
  return decodeSessionLog(join(dir, filename)).text.split("\n").filter(Boolean).map((line) => JSON.parse(line))
}

/** Boot the real web profile and drive only local RPCs plus the configured loopback model. */
async function run(pinned: string): Promise<void> {
  const dshHome = realpathSync(process.env.QA_DSH_HOME ?? join(root, "dsh"))
  assert(dshHome.startsWith(root + "/"), "DSH_HOME must be a child of the scratch root")
  const runDir = mkdtempSync(join(root, "run-"))
  const home = sandboxWorkspace(runDir, "home")
  const bootCwd = sandboxWorkspace(runDir, "boot")
  const repo = spawnSync("git", ["init", "--quiet", runDir], { cwd: bootCwd, env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8" })
  assert.equal(repo.status, 0, `Could not initialize the scratch project: ${repo.stderr}`)
  writeFileSync(join(runDir, "AGENT.md"), "Isolated routing QA for the local deterministic provider.\n")
  const planned = new Map<string, readonly Action[]>()
  const fired = new Set<string>()
  const childRequests: { readonly tag: string; readonly started: number; ended?: number }[] = []
  const offered = new Map<string, readonly string[]>()
  const model = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const wire = readWireRequest(Buffer.concat(chunks).toString("utf8"))
    const userTexts = [...wire.messages].reverse().filter((entry) => field(entry, "role") === "user").map((entry) => JSON.stringify(entry))
    const taggedTurn = userTexts.map((text) => /QaTurn-[a-z0-9-]+/.exec(text)?.[0]).find((tag) => tag !== undefined)
    const tag = taggedTurn ?? (planned.has("QaTurn-cell-serve") && wire.toolNames.includes("cellwork_requirements") ? "QaTurn-cell-serve" : undefined)
    const child = userTexts.map((text) => /QaChild-[a-z0-9-]+/.exec(text)?.[0]).find((tag) => tag !== undefined)
    if (child !== undefined && tag === undefined && !wire.toolNames.includes("mpd_role_spawn_async")) {
      const measurement = { tag: child, started: Date.now(), ended: undefined as number | undefined }
      childRequests.push(measurement)
      if (child.includes("-burst-")) await pause(2700)
      measurement.ended = Date.now()
    }
    const actions = tag === undefined ? undefined : planned.get(tag)
    if (tag !== undefined && actions !== undefined && !fired.has(tag) && actions.every((action) => wire.toolNames.includes(action.name))) {
      fired.add(tag)
      offered.set(tag, wire.toolNames)
      writeMessagesSse(res, toolTurn(tag, actions))
    } else {
      if (tag !== undefined && wire.toolNames.length > 0 && !offered.has(tag)) offered.set(tag, wire.toolNames)
      writeMessagesSse(res, messagesTextEvents(receipt))
    }
  })
  const address = await new Promise<number>((resolve, reject) => {
    model.once("error", reject)
    model.listen(0, "127.0.0.1", () => {
      const bound = model.address()
      if (typeof bound === "object" && bound !== null) resolve(bound.port)
      else reject(new Error("Provider did not bind TCP"))
    })
  })
  const overlay = join(runDir, "loopback.yml")
  writeFileSync(overlay, `- id: agent-preset-registry\n  config:\n    default: cordis\n- id: llm-deepseek\n  config:\n    baseURL: http://127.0.0.1:${address}/v1\n    apiKeyEnv: DEEPSEEK_API_KEY\n`)
  const bootLog = join(runDir, "boot.private.log")
  const fd = openSync(bootLog, "wx", 0o600)
  const server = spawn(pinned, ["--profile", "web", "--patch", overlay, "--port", "0", "--no-open"], {
    cwd: bootCwd,
    env: { PATH: process.env.PATH, HOME: home, DSH_HOME: dshHome, DSH_AGENTS_HOME: join(home, ".agents"), DEEPSEEK_API_KEY: "sk-routing-probe-local-stub", MPD_DSH_CONSULT_MAX: "8" },
    stdio: ["ignore", fd, fd],
  })
  closeSync(fd)
  const starts: unknown[] = []
  try {
    const launch = await until(() => {
      if (server.exitCode !== null) throw new Error(`Boot exited ${server.exitCode}. See private boot log in ${runDir}`)
      return /http:\/\/(?:localhost|127\.0\.0\.1):(\d+)\/\?token=([A-Za-z0-9_-]+)/.exec(readFileSync(bootLog, "utf8")) ?? undefined
    }, `web launch URL in ${runDir}`)
    const base = `http://127.0.0.1:${launch[1]}`
    const authorized = await fetch(`${base}/?token=${launch[2]}`, { redirect: "manual", signal: AbortSignal.timeout(5_000) })
    const cookie = authorized.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ")
    assert(cookie.length > 0, "Loopback authorization did not return a cookie")
    const rpc = async (method: string, args: unknown): Promise<unknown> => {
      const response = await fetch(`${base}/api/${method}`, {
        method: "POST", headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ type: "client-request", rpcId: randomUUID(), method, payload: { args } }),
        signal: AbortSignal.timeout(15_000),
      })
      const envelope: unknown = await response.json()
      const result = field(envelope, "result")
      assert(response.ok && field(envelope, "error") === undefined && field(result, "ok") === true,
        `${method} refused (HTTP ${response.status}) ${JSON.stringify(field(result, "error") ?? field(envelope, "error"))}`)
      return field(result, "value")
    }
    const seatsOnly = process.env.QA_SEATS_ONLY === "1"
    const allModes = seatsOnly ? ["member", "cell"] : ["mechanical", "advisory", "off"]
    const modes = process.env.QA_ONLY_MODE === undefined ? allModes : allModes.filter((mode) => mode === process.env.QA_ONLY_MODE)
    assert(modes.length > 0, "Requested mode is unavailable")
    for (const mode of modes) {
      const workspace = sandboxWorkspace(runDir, mode)
      const gate = mode === "member" || mode === "cell" ? "mechanical" : mode
      mkdirSync(join(workspace, ".mpd"))
      writeFileSync(join(workspace, ".mpd", "mpd.jsonc"), JSON.stringify({ team: { gate, sensitivity: "easy" }, workmates: { autoInit: false }, cellwork: { planning: { analysts: 0 } }, agentRoutes: { "Junior Engineer": route, Explorer: route, Planner: route } }))
      const created = await rpc("session/create", { request: { cwd: workspace } })
      const session = field(created, "sessionId")
      assert(typeof session === "string" && field(created, "agentPreset") === "cordis", `Default creation preset did not equal cordis in ${mode}`)
      const selected = await rpc("agentPresets/select", { agentId: session, agentPreset: "mpd" })
      await rpc("session/selectModel", { request: { sessionId: session, ...route } })
      const role = (tag: string, name = "mpd_role_spawn"): Action => ({ name, args: { role: "Junior Engineer", task: `Return the fixed QA text for QaChild-${tag}.` } })
      const prompt = async (tag: string, text: string, actions: readonly Action[]): Promise<Call[]> => {
        const marker = `QaTurn-${tag}`
        planned.set(marker, actions)
        await rpc("session/prompt", { request: { requestId: randomUUID(), sessionId: session, mode: "queue", content: [{ type: "text", text: `${marker} ${text}` }] } })
        return await until(() => {
          const calls = callsOf(logFor(dshHome, workspace, session)).filter((call) => call.id.startsWith(`call_${marker}_`))
          return calls.length === actions.length && calls.every((call) => call.error !== null) ? calls : undefined
        }, `${marker} real ${actions.map((action) => action.name).join(" ")} receipts, tools offered: ${offered.get(marker)?.length ?? 0}`)
      }
      if (mode === "member" || mode === "cell") {
        const controls: Call[] = []
        if (mode === "member") {
          planned.set("QaTurn-member-serve", [role("member-serve", "mpd_role_spawn_async")])
          const plan: readonly Action[] = [
            { name: "agent_teams_plan", args: { action: "create", name: "qa-owner", description: "One assigned routing check." } },
            { name: "agent_teams_plan", args: { action: "add_member", member: { name: "probe-owner", role: "Junior Engineer", prompt: "Follow your assigned board row." } } },
            { name: "agent_teams_plan", args: { action: "create_task", task: { subject: "QaTurn-member-serve", description: "Perform the assigned consult check.", owner: "probe-owner", blocked_by: [], kind: "requirement" } } },
            { name: "agent_teams_plan", args: { action: "approve" } },
            { name: "agent_teams_dispatch", args: { action: "run" } },
          ]
          for (const [index, action] of plan.entries()) controls.push(...await prompt(`member-${index}`, "Perform the next isolated QA check.", [action]))
        } else {
          planned.set("QaTurn-cell-serve", [{ name: "cellwork_recon", args: { role: "Explorer", task: "Return the fixed QA text for QaChild-cell-serve." } }])
          controls.push(...await prompt("cell-open", "Open the isolated QA check.", [{ name: "cellwork_open", args: { objective: "Check the planner's QA consultation." } }]))
          controls.push(...await prompt("cell-start", "Begin the isolated QA check.", [{ name: "cellwork_start", args: {} }]))
        }
        writeFileSync(join(runDir, `${mode}-setup.json`), JSON.stringify(controls, null, 2) + "\n")
        const seat = await until(() => {
          const sessionsDir = join(dshHome, "sessions", projectKey(workspace))
          for (const id of readdirSync(sessionsDir).filter((id) => id !== session)) {
            const log = logFor(dshHome, workspace, id)
            const call = callsOf(log).find((call) => call.id.startsWith(`call_QaTurn-${mode}-serve_`) && call.error !== null)
            if (call !== undefined) return { depth: log[0]?.delegationDepth, call }
          }
          return undefined
        }, `${mode} tool result from delegated seat in ${runDir}`)
        assert.equal(seat.call.error, false, `${mode} consult was refused`)
        console.log(`${mode} seat depth=${seat.depth} consult=${seat.call.name} nonError=true`)
        starts.push({ mode, controls, seat })
        continue
      }
      const small = await prompt(`${mode}-small`, "Ask for one short answer to a narrow wording question.", [role(`${mode}-small`)])
      const expand = "一起解决掉吧。Fix the routing policy, wire the adapter, update the bilingual docs, and have an independent verifier run the runtime and build checks. These are parallel lanes with separate owners and a final integration handoff."
      const followup = await prompt(`${mode}-expand`, expand, [role(`${mode}-expand`)])
      const burst = await prompt(`${mode}-burst`, expand, Array.from({ length: 8 }, (_, index) => role(`${mode}-burst-${index}`, "mpd_role_spawn_async")))
      await pause(3100)
      const records = logFor(dshHome, workspace, session)
      const children = childRequests.filter((request) => request.tag.startsWith(`QaChild-${mode}-burst-`))
      const peak = Math.max(0, ...children.map((child) => children.filter((other) => other.started <= child.started && (other.ended ?? Infinity) > child.started).length))
      const gateDir = join(workspace, ".mpd", "session-gate")
      const planDir = join(workspace, ".mpd", "team", "plans")
      const notices = records.filter((record) => record.type === "user/message" && field(field(record.data, "source"), "kind") !== "agent-instructions")
        .map((record) => JSON.stringify(field(record.data, "content"))).filter((text) => text?.includes("[AgentTeams]"))
      starts.push({ mode, creationPreset: field(created, "agentPreset"), selected, header: records[0]?.agentPreset, presetEvents: records.filter((record) => record.type === "agent-preset/selected").map((record) => record.data), notices, gateFiles: existsSync(gateDir) ? readdirSync(gateDir).length : 0, planFiles: existsSync(planDir) ? readdirSync(planDir).length : 0, small, followup, burst, burstChildCalls: new Set(children.map((child) => child.tag)).size, peak })
      writeFileSync(join(runDir, "result.json"), JSON.stringify({ starts, runDir }, null, 2) + "\n")
      console.log(`${mode} small=${small[0]?.error} expand=${followup[0]?.error} burst=${burst.filter((call) => call.error === false).length}/8 children=${children.length} peak=${peak}`)
    }
    const isolation = assertSessionsSandboxed(dshHome, root, { forbidden: [projectKey(dirname(root))] })
    writeFileSync(join(runDir, "result.json"), JSON.stringify({ starts, isolation }, null, 2) + "\n")
    console.log(`Evidence ${join(runDir, "result.json")}`)
  } finally {
    server.kill("SIGTERM")
    model.closeAllConnections()
    model.close()
  }
}

/** Test tool-call separation and error pairing without booting the host. */
function selfTest(): void {
  const frames = toolTurn("self", [{ name: "one", args: {} }, { name: "two", args: {} }])
  assert.deepEqual(frames.filter((event) => event.type === "content_block_start").map((event) => event.index), [0, 1])
  const failed = callsOf([{ type: "tool/call", data: { callId: "id", name: "one" } }, { type: "tool/result", data: { message: { toolCallId: "id", isError: true } } }])
  assert.equal(failed[0]?.error, true)
  console.log("Offline fixture controls passed")
}

if (process.argv[2] === "--self-test") selfTest()
else {
  const pinned = process.argv[2]
  assert(pinned !== undefined && pinned.startsWith("/"), "Pass the absolute pinned DSH executable")
  await run(pinned)
}
