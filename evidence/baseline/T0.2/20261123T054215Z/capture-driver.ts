import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { basename, dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { counter, key, object, type Row } from "../../../../scripts/baseline/input.ts"
import { createSandbox, installProfile, isolationStep, useStubRoute } from "../../../../skills/dsh-qa/scripts/extension-isolation.ts"
import { messagesTextEvents, messagesToolUseEvents, readWireRequest, writeMessagesSse } from "../../../../skills/dsh-qa/scripts/lib/messages-sse.ts"
import { decodeSessionLog } from "../../../../skills/dsh-qa/scripts/lib/session-evidence.ts"

/** Execution title used to identify the working seat in the real board and the assignment. */
const workerSubject = "QA worker receipt"
/** Drive the ordinary Team tools in order, with no seeded board or synthetic member session. */
const captainSteps = [
  { name: "agent_teams_plan", args: { action: "create", name: "Tool surface QA", description: "Dispatch a single receipt task", approval: "required" } },
  { name: "agent_teams_plan", args: { action: "edit", members: [
    { name: "Senior Engineer", role: "Senior Engineer", description: "Ordinary execution seat", prompt: "Wait for the assigned QA task." },
  ], tasks: [{ subject: workerSubject, description: "Close the assigned QA task.", owner: "Senior Engineer", kind: "work", write_scopes: ["receipt.txt"], blocked_by: [] }] } },
  { name: "agent_teams_plan", args: { action: "approve" } },
  { name: "agent_teams_dispatch", args: { action: "run" } },
] as const
/** Keep request routing restricted to named fixture operations. */
interface Decision {
  /** Tool the harness should call. */
  readonly name: string
  /** Valid test arguments for that tool. */
  readonly args: Row
}

/** Read a fixture-generated object without accepting scalars or arrays. */
function readObject(path: string): Row {
  /** Parsed envelope from a sandbox-owned file. */
  const row = object(JSON.parse(readFileSync(path, "utf8")))
  assert(row, "expected a sandbox JSON object")
  return row
}

/** Extract object rows from arrays on the external harness and board boundaries. */
function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(object).filter(row => row !== undefined) : []
}

/** List state files only when the harness has created the directory. */
function entries(directory: string): string[] {
  return existsSync(directory) ? readdirSync(directory) : []
}

/** Inspect only the user messages in memory to distinguish the assigned work from startup. */
function userTexts(messages: readonly unknown[]): string[] {
  return messages.map(object).filter(message => message?.role === "user").flatMap(message => {
    /** User content uses either the plain or block-shaped wire representation. */
    const content = message?.content
    return typeof content === "string" ? [content] : rows(content).flatMap(block =>
      block.type === "text" && typeof block.text === "string" ? [block.text] : [])
  })
}

/** Route a working assignment only when the persisted board confirms its identity. */
function assigned(prompts: readonly string[], boardTasks: readonly Row[], results: readonly string[]): Decision | undefined {
  /** Spawn-only prompts lack this actual dispatch marker. */
  const match = prompts.map(text => text.match(/You have been assigned shared task (\w+): ([^\n]+)/)).findLast(Boolean)
  if (!match || results.length >= 5) return undefined
  /** Same task and title must belong to a currently open row. */
  const row = boardTasks.findLast(task => task.id === match[1] && task.subject === match[2])
  if (!row || ["completed", "failed", "cancelled"].includes(String(row.status))) return undefined
  return { name: "agent_teams_task", args: { action: "complete", task_id: row.id, note: "QA receipt observed" } }
}

/** Boot one ordinary worker case and publish only the allowlisted header and success receipt. */
async function capture(args: readonly string[]): Promise<void> {
  /** The shell wrapper supplies a dedicated scratch directory and verified tool versions. */
  const [scratch, dsh, bun, node] = args
  assert(scratch && dsh && bun && node && basename(scratch).startsWith(".qa-v2-t02-"), "expected capture wrapper arguments")
  for (const name of ["HOME", "DSH_HOME", "TMPDIR"]) {
    assert(process.env[name]?.startsWith(scratch + "/"), "expected capture-specific environment directories")
  }
  /** The helper creates a new isolated HOME, DSH_HOME and workspace. */
  const { sandbox, dshHome, ws, env } = createSandbox("v2-tool-surface")
  /** Team records include planning and execution boards. */
  const boardDir = join(ws, ".mpd", "team", "teams")
  /** Resolve the latest boards without caching prior status or ownership. */
  const boards = (): Row[] => entries(boardDir).filter(name => name.endsWith(".json")).map(name => readObject(join(boardDir, name)))
  /** Limit fixture model steps independently of the subprocess timeout. */
  let calls = 0
  /** Keep transport private and process only the in-memory request. */
  const server = createServer(async (req, res) => {
    try {
      /** Complete provider request body for the shared wire parser. */
      let body = ""
      for await (const part of req) body += part
      /** Parse both supported message shapes without retaining request payloads. */
      const wire = readWireRequest(body)
      /** Startup and task injections identify the current seat during this fixture. */
      const prompts = userTexts(wire.messages)
      /** Startup/title requests can receive text without acting. */
      let decision: Decision | undefined
      if (++calls < 100 && wire.toolNames.length > 0 && !prompts.some(text => text.startsWith("Generate the session title"))) {
        /** Captain prompts and member prompts have disjoint markers in this mounted case. */
        const captain = prompts.includes("QA-BOOT-CAPTAIN") && !prompts.some(text => text.includes("You are a team member."))
        /** Stage a real board through the captain's own model turn. */
        const step = captainSteps[wire.toolResults.length]
        if (!captain) decision = assigned(prompts, boards().flatMap(board => rows(board.tasks)), wire.toolResults)
        else if (step) decision = step
        else if (wire.toolResults.length === captainSteps.length) {
          // Team approval anchors a goal on this host. Settle it after the real worker has acted.
          for (let poll = 0; poll < 40; poll += 1) {
            if (boards().some(board => rows(board.tasks).some(task => task.subject === workerSubject && task.status === "completed"))) {
              decision = { name: "mpd_goal_finish", args: { outcome: "complete" } }
              break
            }
            await delay(50)
          }
        }
      }
      writeMessagesSse(res, decision && wire.toolNames.includes(decision.name)
        ? messagesToolUseEvents("qa_surface_" + calls, decision.name, decision.args) : messagesTextEvents("QA acknowledgement."))
    } catch (error) {
      if (!(error instanceof Error)) throw error
      res.writeHead(500).end()
      console.error("Local fixture could not answer the request.")
    }
  })
  mkdirSync(join(ws, ".mpd"), { recursive: true })
  writeFileSync(join(ws, ".mpd", "mpd.jsonc"), JSON.stringify({
    team: { gate: "off" },
    goal: { enabled: false, autoAnchor: false },
    agentRoutes: { "Senior Engineer": { provider: "deepseek-official", model: "deepseek-flash" } },
  }))
  /** Installer comes from the checkout and resolves its own dist paths. */
  const install = await installProfile({ sandbox, dshHome, env, timeoutMs: 45000 })
  assert.equal(install.status, 0, "isolated headless profile install failed")
  await new Promise<void>((resolveListen, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolveListen))
  /** Only an ephemeral loopback URL can receive provider requests in this case. */
  const address = server.address()
  assert(address && typeof address !== "string")
  /** Output filenames are confined to scratch and the newly created case. */
  const bootPath = join(sandbox, "boot.log")
  try {
    useStubRoute(dshHome, address.port)
    /** File-backed output avoids a blocked harness pipe and stays private. */
    const fd = openSync(bootPath, "wx")
    try {
      /** Pinned version was checked by the wrapper against the same executable directory. */
      const child = spawn("dsh", ["--profile", "mpd-headless", "QA-BOOT-CAPTAIN"],
        { cwd: ws, env, stdio: ["ignore", fd, fd], timeout: 55000 })
      /** Normal exit also guarantees the session logs are ready to decode. */
      const status = await new Promise<number | null>((resolveExit, reject) => child.once("error", reject).once("exit", resolveExit))
      assert.equal(status, 0, "isolated headless harness failed")
    } finally {
      closeSync(fd)
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolveClose => server.close(() => resolveClose()))
  }
  /** Require genuine isolated logs and a terminal row on the execution board. */
  const isolation = isolationStep(dshHome, sandbox, "v2-tool-surface")
  assert(isolation.ok, "session isolation check failed")
  /** Declared owner, task, and executor identity are checked again before selecting a session. */
  const board = boards().find(candidate => rows(candidate.tasks).some(row => row.subject === workerSubject))
  /** The distinctive work row must complete in the real harness. */
  const task = rows(board?.tasks).find(row => row.subject === workerSubject)
  /** The board's own handle joins it to the member session. */
  const seat = rows(board?.members).find(member => member.name === task?.owner)
  assert(board && task?.status === "completed" && seat?.role === "Senior Engineer", "working execution seat did not complete its row")
  /** The execution session id, distinct from the captain and review sessions. */
  const session = key(seat.executorRef)
  assert(session)
  /** The repository reader handles every compressed frame of the member log. */
  const sessionRoot = join(dshHome, "sessions")
  /** Select exactly one real store for the board's handle. */
  const stores = readdirSync(sessionRoot, { recursive: true, encoding: "utf8" }).map(path => join(sessionRoot, path)).filter(path =>
    basename(dirname(path)) === session && /session\.v[34]\.jsonl(?:\.zstd)?$/.test(path))
  assert.equal(stores.length, 1, "expected one persisted member session")
  /** File consumed for both decoding and compact fingerprint proof. */
  const store = stores[0]
  assert(store)
  /** Individual harness events with their recorded sequence. */
  const events = rows(decodeSessionLog(store).text.trim().split("\n").map(line => JSON.parse(line)))
  /** Exactly the actual task completion, matched by tool and task arguments. */
  const call = events.find(event => {
    /** The call's own envelope. */
    const data = object(event.data)
    if (event.type !== "tool/call" || data?.name !== "agent_teams_task") return false
    /** Recorded rc.5 arguments may be textual JSON or an object. */
    const input = object(typeof data.arguments === "string" ? JSON.parse(data.arguments) : data.arguments)
    return input?.action === "complete" && input.task_id === task.id
  })
  /** The real same-turn coordinates and joined result. */
  const data = object(call?.data)
  /** A concrete call was recorded and must have a strictly later result. */
  const callSeq = counter(call?.seq)
  assert(data && callSeq !== undefined && key(data.callId))
  /** Result belongs to the exact call ID observed in this store. */
  const result = events.find(event => event.type === "tool/result" && object(object(event.data)?.message)?.toolCallId === data.callId)
  /** Call and result order is part of the evidence. */
  const resultSeq = counter(result?.seq)
  assert(resultSeq !== undefined && resultSeq > callSeq && object(object(result?.data)?.message)?.isError === false)
  /** Only a header in the assigned turn may be selected. */
  const start = events.findLast(event => event.type === "turn/start" && object(event.data)?.turn === data.turn && (counter(event.seq) ?? Infinity) < callSeq)
  /** Request header must precede the action and follow that turn's start. */
  const header = events.findLast(event => event.type === "request/header" && (counter(event.seq) ?? -1) > (counter(start?.seq) ?? Infinity)
    && (counter(event.seq) ?? Infinity) < callSeq)
  /** Only the original tool definitions are published from the event envelope. */
  const tools = object(object(header?.data)?.header)?.tools
  assert(header && typeof header.time === "number" && Array.isArray(tools) && tools.length > 0 && tools.every(tool => {
    /** Refuse unexpected tool fields that could carry extra context. */
    const definition = object(tool)
    return definition && typeof definition.name === "string" && typeof definition.description === "string" && object(definition.parameters)
      && Object.keys(definition).every(name => ["name", "description", "parameters"].includes(name))
  }), "missing or malformed request header tool definitions")
  /** Record only the known preset observation without retaining the host log. */
  const presetMount = /preset-mpd .*pending \(waiting for service: agentPresets\)/.test(readFileSync(bootPath, "utf8"))
    ? "pending: agentPresets service unavailable" : "unknown"
  /** Serializable proof, restricted to tool schema and identity coordinates. */
  const receipt = {
    host: { dsh, bun, node, profile: "mpd-headless", declaredAgentPreset: "mpd", presetMount, provider: "local loopback fixture" },
    sandbox: { isolated: isolation.ok, workspaceKeys: isolation.checked },
    seat: { teamId: board.teamId, memberId: seat.id, sessionId: session, role: seat.role, taskId: task.id, status: task.status },
    request: { seq: header.seq, at: new Date(header.time).toISOString(), turn: data.turn, toolCount: tools.length },
    action: { tool: data.name, action: "complete", taskId: task.id, callId: data.callId, callSeq, resultSeq, isError: false },
    sessionLog: { file: basename(store), sha256: createHash("sha256").update(readFileSync(store)).digest("hex") },
  }
  writeFileSync(join(scratch, "member-request-header.json"), JSON.stringify({
    type: header.type, seq: header.seq, time: header.time, data: { header: { tools } },
  }, null, 2) + "\n", { flag: "wx" })
  writeFileSync(join(scratch, "capture.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" })
  console.log(JSON.stringify({ status: "MEASURED", request: receipt.request, seat: receipt.seat, action: receipt.action }))
}

await capture(process.argv.slice(2))
