#!/usr/bin/env node
// Case team-idle-member-guard (P2a): on a REAL boot, a team member with NO board task performs ZERO
// tool calls and receives ONE idle directive, while the task's owner works.
//
// WHAT IT PROVES (contract `.mpd/plans/team-idle-member-guard.md` §4, "Live QA case"):
//   1. the task owner's session records a `tool/call` to `agent_teams_task` WITH a non-error
//      `tool/result` — the member really works;
//   2. the taskless member's session records ZERO `tool/call` rows and EXACTLY ONE idle directive
//      (the user-role message the guard injects);
//   3. two members were really raised (both carry an executor handle in the team record), so the
//      "zero calls" verdict is about a spawned member, not an absent one;
//   4. the harness session log is the only witness — model prose is never read as tool evidence.
//
// §3.4 LAZY SPAWN IS NOT CLAIMED HERE: this case does not prove that no session exists before the first
// task dispatch, so the one-turn bound (§6.1) is declared instead.
//
// THE BOOT SHAPE: the offline recipe — `createSandbox` (isolated DSH_HOME + sandboxed HOME + sandbox
// workspace), `installProfile` (the checkout's `mpd-headless` composition, absolute row paths, no
// registry/pnpm), a local OpenAI-shaped model stub (`makeStubModel` + `useStubRoute`, no provider
// credential) whose CHILD script drives the owner's claim while the taskless member gets plain text,
// and a `dsh --patch` overlay mounting the probe row (`lib/team-idle-member-guard-probe.ts`) that stages
// and approves the two-member/one-task plan through the REAL `agent_teams_plan` tool.
// A SKIP IS NOT A PASS: a missing `dsh` binary, a failed install or a failed boot are FAILURES.
//
// Usage:
//   bun skills/dsh-qa/scripts/team-idle-member-guard.ts --self-test   (offline falsifier)
//   bun skills/dsh-qa/scripts/team-idle-member-guard.ts               (the live case)
// Evidence -> evidence/team/idle-member-guard/live/<timestamp>/{result.json,output.log}
// PREREQ: absent-dsh-binary dsh install @deepseek-ai/dsh so the real harness binary is on PATH
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { decodeSessionLog, findToolCall, type SessionRecord } from "./lib/session-evidence.ts"
import type { ProbeRecord } from "./lib/team-idle-member-guard-probe.ts"
import {
  REPO, binaryPresent, bootSession, cleanup, createSandbox, installProfile, isolationStep,
  makeStubModel, timestamp, useStubRoute, writeEvidence,
} from "./extension-isolation.ts"

/** The case slug, used in the sandbox prefix and the evidence directory. */
const SLUG = "team-idle-member-guard"
/** The probe module the overlay mounts. */
const PROBE = join(REPO, "skills", "dsh-qa", "scripts", "lib", "team-idle-member-guard-probe.ts")
/** The substring of the owner's spawn prompt, which selects the stub's child script. */
const OWNER_MARKER = "IDLE-QA-OWNER"
/** The exactly-one directive the guard injects (pinned to the plugin source by the self-test). */
const DIRECTIVE_TEXT = "You have no board task. Do not read, run, write, message or claim. End your turn now."
/** The one-line denial every tool of a taskless member receives (pinned to the plugin source too). */
const DENIAL_TEXT = "[mpd-team] no board task is assigned to you; end your turn and wait for a dispatch"
/** The tool the owner's child script calls (the claim the dispatch turn needs). */
const OWNER_TOOL = "agent_teams_task"
/** The prompt the booted Lead session starts from; the stub answers every non-owner request with text. */
const PROMPT = "Stage and approve the idle-guard live QA team, then reply with one line."
/** One problem list, empty when every expectation held. */
type Problems = string[]

/** One decoded session log: its file and records. */
export interface SessionLog {
  /** The absolute log file. */
  readonly file: string
  /** Every decoded record, in file order. */
  readonly records: readonly SessionRecord[]
}

/**
 * Every `user/message` text a log carries, joined per message.
 * @param records - the decoded records.
 * @returns the non-empty user texts in record order.
 */
export function userTexts(records: readonly SessionRecord[]): string[] {
  /** The collected texts. */
  const texts: string[] = []
  for (const record of records) {
    /** The record viewed as the message shape the harness writes. */
    const row = record as { type?: unknown; data?: { content?: unknown } }
    if (row?.type !== "user/message") continue
    /** The content blocks, when the record carried an array. */
    const content = Array.isArray(row?.data?.content) ? row.data.content as Array<{ type?: unknown; text?: unknown }> : []
    /** The message's text blocks joined. */
    const text = content.filter((block) => block?.type === "text").map((block) => String(block.text ?? "")).join("\n")
    if (text.length > 0) texts.push(text)
  }
  return texts
}

/**
 * How many `tool/call` rows a log carries (any tool).
 * @param records - the decoded records.
 * @returns the count.
 */
export function toolCallCount(records: readonly SessionRecord[]): number {
  return records.filter((record) => (record as { type?: unknown })?.type === "tool/call").length
}

/**
 * The owner verdict: the claim was recorded AND one of its results was not an error.
 * @param records - the owner session's records.
 * @returns the verdict and the problems found.
 */
export function evaluateOwner(records: readonly SessionRecord[]): { ok: boolean; problems: Problems } {
  /** The recorded claim. */
  const evidence = findToolCall(records, OWNER_TOOL)
  /** One problem per failed expectation. */
  const problems: Problems = []
  if (!evidence.called) problems.push("the task owner's session recorded no `" + OWNER_TOOL + "` call (the owner did not work)")
  if (evidence.called && !evidence.succeeded) problems.push("the owner's `" + OWNER_TOOL + "` call has no non-error result: " + evidence.reason)
  return { ok: problems.length === 0, problems }
}

/**
 * The taskless-member verdict: zero tool calls and exactly one idle directive.
 *
 * BOTH directions matter: a prose-only answer proves nothing (the harness records tool calls, not
 * narration), and a repeat of the directive would mean the one-directive rule broke.
 * @param records - the taskless member's records.
 * @returns the verdict and the problems found.
 */
export function evaluateIdle(records: readonly SessionRecord[]): { ok: boolean; problems: Problems } {
  /** One problem per failed expectation. */
  const problems: Problems = []
  /** The tool calls this session recorded. */
  const calls = toolCallCount(records)
  if (calls !== 0) problems.push("the taskless member recorded " + String(calls) + " tool/call row(s); the guard denied nothing or the model ignored the directive")
  /** The idle directives this session recorded. */
  const directives = userTexts(records).filter((text) => text.includes(DIRECTIVE_TEXT)).length
  if (directives !== 1) problems.push("the taskless member recorded " + String(directives) + " idle directive(s), expected exactly 1")
  return { ok: problems.length === 0, problems }
}

/**
 * Build the `--patch` overlay that mounts the probe row.
 * @param probePath - the probe module's absolute path.
 * @param outFile - the record file the probe writes.
 * @returns the overlay YAML.
 */
export function buildOverlay(probePath: string, outFile: string): string {
  return [
    "- insert:",
    "    - id: team-idle-member-guard-probe",
    "      name: " + JSON.stringify(probePath),
    "      config:",
    "        outFile: " + JSON.stringify(outFile),
    "",
  ].join("\n")
}

/**
 * Every session log under one isolated DSH_HOME, decoded with the shared reader.
 * @param dshHome - the isolated harness home.
 * @returns the decoded logs (empty when the store does not exist).
 */
export function sessionLogs(dshHome: string): SessionLog[] {
  /** The `<DSH_HOME>/sessions` root. */
  const root = join(dshHome, "sessions")
  if (!existsSync(root)) return []
  /** The decoded logs. */
  const logs: SessionLog[] = []
  for (const key of safeReaddir(root)) {
    /** The project-key directory. */
    const keyDir = join(root, key)
    if (!isDir(keyDir)) continue
    for (const sessionId of safeReaddir(keyDir)) {
      /** The session directory. */
      const sessionDir = join(keyDir, sessionId)
      if (!isDir(sessionDir)) continue
      for (const name of safeReaddir(sessionDir)) {
        if (!/^session\..*jsonl(\.zstd)?$/.test(name)) continue
        /** The absolute log file. */
        const file = join(sessionDir, name)
        try {
          /** The decoded text of the artifact. */
          const decoded = decodeSessionLog(file)
          /** The parsed records, skipping undecodable lines. */
          const records: SessionRecord[] = []
          for (const line of decoded.text.split("\n")) {
            if (line.trim() === "") continue
            try {
              records.push(JSON.parse(line) as SessionRecord)
            } catch { /* a torn line is reported by the shared reader elsewhere */ }
          }
          if (records.length > 0) logs.push({ file, records })
        } catch { /* an unreadable log cannot be evidence; the case fails on the missing witness */ }
      }
    }
  }
  return logs
}

/**
 * A directory listing that answers `[]` instead of throwing.
 * @param dir - the directory to list.
 * @returns its entry names.
 */
function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * Whether a path is a directory.
 * @param path - the path to test.
 * @returns true when it exists and is a directory.
 */
function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * The offline self-test: each detector with a POSITIVE and a NEGATIVE fixture, plus the two pins that
 * keep this case honest (the plugin's exact texts, and the overlay it writes).
 * @returns nothing; throws on the first failed arm.
 */
export function selfTest(): void {
  /** One synthetic `tool/call` record. */
  const call = (callId: string, name: string): SessionRecord => ({ type: "tool/call", data: { name, callId, arguments: {} } })
  /** One synthetic v4 `tool/result` record. */
  const result = (callId: string, isError: boolean): SessionRecord => ({ type: "tool/result", data: { message: { toolCallId: callId, isError, content: [{ type: "text", text: isError ? "denied" : "ok" }] } } })
  /** One synthetic user message. */
  const say = (text: string): SessionRecord => ({ type: "user/message", data: { content: [{ type: "text", text }] } })
  /** Run one expectation and report it. */
  const arm = (name: string, condition: boolean): void => {
    if (!condition) throw new Error("self-test arm failed: " + name)
    console.log("[self-test] PASS " + name)
  }
  // Owner: a call WITH a non-error result passes; an errored result and a prose-only log both fail.
  arm("owner positive", evaluateOwner([call("c1", OWNER_TOOL), result("c1", false)]).ok)
  arm("owner negative: errored result", !evaluateOwner([call("c1", OWNER_TOOL), result("c1", true)]).ok)
  arm("owner negative: prose only", !evaluateOwner([say("I claimed T1")]).ok)
  // Idle member: one directive and no calls passes; a call, no directive and a doubled directive fail.
  arm("idle positive", evaluateIdle([say(DIRECTIVE_TEXT)]).ok)
  arm("idle negative: a tool call", !evaluateIdle([say(DIRECTIVE_TEXT), call("c1", "read")]).ok)
  arm("idle negative: no directive", !evaluateIdle([say("hello")]).ok)
  arm("idle negative: two directives", !evaluateIdle([say(DIRECTIVE_TEXT), say(DIRECTIVE_TEXT)]).ok)
  // THE PINS: the directive and denial this case asserts must be the plugin's own literals, so a
  // paraphrase in either place reddens here instead of passing both sides.
  /** The guard module's source. */
  const source = readFileSync(join(REPO, "packages", "mpd-team-core-plugin", "src", "idle-guard.ts"), "utf8")
  arm("pin: the directive is the plugin's literal", source.includes("IDLE_DIRECTIVE_TEXT = " + JSON.stringify(DIRECTIVE_TEXT)))
  arm("pin: the denial is the plugin's literal", source.includes("IDLE_DENIAL_TEXT = " + JSON.stringify(DENIAL_TEXT)))
  /** The overlay the case writes. */
  const overlay = buildOverlay("/abs/probe.ts", "/abs/out.json")
  arm("overlay names the probe and its record file", overlay.includes("/abs/probe.ts") && overlay.includes("/abs/out.json"))
  console.log("[team-idle-member-guard] self-test PASS — 10 arms incl. negative controls")
}

/**
 * Read one team record from a sandbox workspace, when one exists.
 * @param workspace - the sandbox workspace.
 * @returns the newest record, or null.
 */
function teamRecordOf(workspace: string): Record<string, unknown> | null {
  /** The teams directory. */
  const dir = join(workspace, ".mpd", "team", "teams")
  /** The candidate record files, newest last. */
  const files = safeReaddir(dir).filter((name) => name.endsWith(".json")).map((name) => join(dir, name))
  if (files.length === 0) return null
  try {
    return JSON.parse(readFileSync(files[files.length - 1], "utf8")) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * The live lane: one real boot, then the session-log and team-record verdicts.
 * @returns nothing; sets the process exit code.
 */
async function live(): Promise<void> {
  if (!binaryPresent("dsh")) throw new Error("the `dsh` binary is not on PATH — this case FAILS rather than skips")
  /** The evidence directory this run writes into. */
  const stamp = timestamp()
  /** The evidence directory. */
  const outDir = process.env.MPD_QA_EVIDENCE_DIR
    ? join(process.env.MPD_QA_EVIDENCE_DIR, SLUG + "-" + stamp)
    : join(REPO, "evidence", "team", "idle-member-guard", "live", stamp)
  mkdirSync(outDir, { recursive: true })
  /** The transcript lines the evidence carries. */
  const log: string[] = []
  /** The steps document the evidence carries. */
  const steps: Record<string, unknown> = {}
  /** The three sandbox paths and the child environment. */
  const sandbox = createSandbox(SLUG)
  /** The stub, held so the process does not hang after the case writes its evidence. */
  let stubToClose: ReturnType<typeof makeStubModel> | null = null
  try {
    log.push("# team-idle-member-guard — live case\nsandbox=" + sandbox.sandbox + "\nDSH_HOME=" + sandbox.dshHome + "\nws=" + sandbox.ws + "\n")
    // 1. The offline profile.
    log.push("[install] node scripts/install-profile.ts --yes --dsh-home <sandbox> --profile mpd-headless --skip-toolchain")
    /** The install's outcome. */
    const install = await installProfile({ sandbox: sandbox.sandbox, dshHome: sandbox.dshHome, env: sandbox.env })
    log.push("[[install exit=" + install.status + "]]\n" + install.out.slice(0, 3000))
    steps.install = { ok: install.status === 0, exit: install.status }
    if (install.status !== 0) throw new Error("the offline profile install exited " + String(install.status))
    // 2. The model stub: the owner's child calls `agent_teams_task claim T1`; every other request is text.
    /** The stub double. */
    const stub = makeStubModel({
      label: SLUG,
      script: [{ text: "QA-STUB-IDLE-LEAD-OK" }],
      childMarker: OWNER_MARKER,
      childScript: [{ tool: OWNER_TOOL, args: { action: "claim", task_id: "T1" } }],
    })
    stubToClose = stub
    /** The stub's loopback port. */
    const port = await stub.listen()
    useStubRoute(sandbox.dshHome, port)
    log.push("[stub] listening on 127.0.0.1:" + port)
    // 3. The probe row through a `--patch` overlay, then one real boot.
    /** The probe's record file. */
    const probeOut = join(outDir, "probe.json")
    /** The overlay file. */
    const overlayFile = join(outDir, "probe-overlay.yml")
    writeFileSync(overlayFile, buildOverlay(PROBE, probeOut))
    log.push("[overlay] " + overlayFile + "\n" + readFileSync(overlayFile, "utf8"))
    /** The boot's outcome. */
    const run = await bootSession({ slug: SLUG, env: sandbox.env, cwd: sandbox.ws, prompt: PROMPT, stub, extraArgs: ["--patch", overlayFile] })
    log.push("[boot] dsh --profile mpd-headless --patch <overlay> " + JSON.stringify(PROMPT) + "\n[[exit=" + run.status + "]]\n" + run.out.slice(0, 6000))
    steps.boot = { ok: run.status === 0, exit: run.status, stubRequests: run.stubRequests }
    if (run.status !== 0) throw new Error("the boot exited " + String(run.status))
    // 4. The probe's record, the team record and every session log.
    /** The probe's record, or null when its row did not mount. */
    const probe: ProbeRecord | null = existsSync(probeOut) ? JSON.parse(readFileSync(probeOut, "utf8")) as ProbeRecord : null
    steps.probe = { lead: probe?.lead ?? null, calls: probe?.calls ?? [], errors: probe?.errors ?? ["the probe recorded nothing"] }
    /** Every session log this isolated home holds. */
    const logs = sessionLogs(sandbox.dshHome)
    log.push("[session] logs=" + String(logs.length) + " records=" + String(logs.reduce((total, entry) => total + entry.records.length, 0)))
    // 5. Classify the sessions: the owner is the ONE log with an `agent_teams_task` call; the taskless
    // member is the ONE log carrying the idle directive.
    /** The owner's log, when exactly one session recorded the claim. */
    const ownerLogs = logs.filter((entry) => findToolCall(entry.records, OWNER_TOOL).called)
    /** The taskless member's log, when exactly one session carries the directive. */
    const idleLogs = logs.filter((entry) => userTexts(entry.records).some((text) => text.includes(DIRECTIVE_TEXT)))
    steps.sessions = { logs: logs.length, owners: ownerLogs.length, idle: idleLogs.length }
    /** The problems every verdict contributes. */
    const problems: Problems = []
    if (probe === null) problems.push("the probe row did not mount (no record file was written)")
    if (probe !== null && probe.calls.length !== 5) problems.push("the probe ran " + String(probe.calls.length) + " of 5 plan calls: " + JSON.stringify(probe.calls))
    if (probe !== null && probe.calls.some((call) => !call.ok)) problems.push("a plan call was refused: " + JSON.stringify(probe.calls.filter((call) => !call.ok)))
    if (probe !== null && probe.errors.length > 0) problems.push("the probe reported errors: " + probe.errors.join("; "))
    if (ownerLogs.length !== 1) problems.push("expected exactly ONE session with an `" + OWNER_TOOL + "` call, found " + String(ownerLogs.length))
    if (idleLogs.length !== 1) problems.push("expected exactly ONE session carrying the idle directive, found " + String(idleLogs.length))
    /** The owner verdict, when its session was identified. */
    const owner = ownerLogs.length === 1 ? evaluateOwner(ownerLogs[0].records) : { ok: false, problems: [] as Problems }
    /** The taskless-member verdict, when its session was identified. */
    const idle = idleLogs.length === 1 ? evaluateIdle(idleLogs[0].records) : { ok: false, problems: [] as Problems }
    problems.push(...owner.problems, ...idle.problems)
    // 6. Two members were really raised (so "zero calls" is about a spawned member, not an absent one).
    /** The team record, or null. */
    const record = teamRecordOf(sandbox.ws)
    steps.team = record === null ? null : {
      teamId: record.teamId,
      members: (Array.isArray(record.members) ? record.members as Array<Record<string, unknown>> : []).map((member) => ({ name: member.name, status: member.status, spawned: typeof member.executorRef === "string" && member.executorRef !== "" })),
      tasks: (Array.isArray(record.tasks) ? record.tasks as Array<Record<string, unknown>> : []).map((task) => ({ id: task.id, owner: task.owner, status: task.status })),
    }
    /** The two members the plan named. */
    const members = (Array.isArray(record?.members) ? record.members : []) as Array<Record<string, unknown>>
    if (record === null) problems.push("no team record was written to the sandbox workspace")
    else {
      for (const name of ["cell-owner", "cell-idle"]) {
        /** The member row the plan named. */
        const member = members.find((candidate) => candidate.name === name)
        if (member === undefined) problems.push("the team record has no member " + JSON.stringify(name))
        else if (typeof member.executorRef !== "string" || member.executorRef === "") problems.push("member " + JSON.stringify(name) + " was never raised (no executor handle)")
      }
    }
    // 7. Isolation, then the evidence.
    /** The workspace-isolation assertion. */
    const isolation = isolationStep(sandbox.dshHome, sandbox.sandbox, SLUG)
    steps.isolation = isolation
    if (isolation.ok !== true) problems.push("workspace isolation violated: " + String(isolation.error ?? ""))
    log.push("[verdict] problems=" + String(problems.length) + (problems.length === 0 ? "" : "\n- " + problems.join("\n- ")))
    /** The case verdict. */
    const ok = writeEvidence(outDir, SLUG, {
      ok: problems.length === 0,
      subject: "on a real boot, a taskless team member records ZERO tool calls and one idle directive while the task owner works",
      case: SLUG,
      wave: "P2a/idle-member-guard",
      prompt: PROMPT,
      command: "dsh --profile mpd-headless --patch <probe-overlay> " + JSON.stringify(PROMPT),
      sandbox: { root: sandbox.sandbox, dshHome: sandbox.dshHome, home: sandbox.runHome, ws: sandbox.ws },
      steps,
      problems,
      proves: [
        "The Lead's plan (two members, one task) was staged and approved through the REAL agent_teams_plan tool (the probe's own recorded answers).",
        "Both members were raised: the team record carries an executor handle for cell-owner and cell-idle.",
        "The task owner's session log records an `agent_teams_task` call with a non-error result.",
        "The taskless member's session log records ZERO tool/call rows and exactly ONE idle directive (harness session log, never model prose).",
      ],
      doesNotProve: [
        "Lazy spawn: this case does not prove that no session exists before the first task dispatch, so the §6.1 one-turn bound is declared (the spawn turn still costs one model turn; the guard makes it a zero-tool turn).",
        "The bundle row as the mount source: the profile install writes checkout-absolute rows; the bundle wiring rests on verify:rows / verify:manifest.",
        "A TUI/web entry surface; the boot is headless.",
      ],
    }, log.join("\n\n"))
    process.exitCode = ok ? 0 : 1
  } catch (error) {
    /** The failure's message. */
    const message = error instanceof Error ? error.message : String(error)
    log.push("[failure] " + message)
    writeEvidence(outDir, SLUG, { ok: false, case: SLUG, wave: "P2a/idle-member-guard", problems: [message], steps }, log.join("\n\n"))
    process.exitCode = 1
  } finally {
    try {
      await stubToClose?.close()
    } catch { /* already closed */ }
    cleanup(sandbox.sandbox)
  }
}

// The entry guard: `--self-test` runs offline and never boots anything.
const isEntry = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isEntry) {
  if (process.argv.includes("--self-test")) {
    try {
      selfTest()
    } catch (error) {
      console.error("[team-idle-member-guard] self-test FAIL — " + (error instanceof Error ? error.message : String(error)))
      process.exitCode = 1
    }
  } else {
    void live()
  }
}
