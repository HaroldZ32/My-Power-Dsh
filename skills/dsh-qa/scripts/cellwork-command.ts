#!/usr/bin/env node
// Case cellwork-command (Wave 3 / C3): prove on a REAL boot that
//   1. `/cellwork` is REGISTERED in the live command registry — the mounted probe
//      (`lib/cellwork-command-probe.ts`) lists it from the harness's own `commands`
//      service and EXECUTES it through `commands.execute()`, never a source grep and
//      never `--dump-config` (which composes rows and never runs plugin code);
//   2. an EMPTY invocation settles `kind:"error"` carrying the usage line and writes
//      NO cell state (the workspace's one-cell slot is untouched);
//   3. a NON-EMPTY `/cellwork <objective>` settles `success`, which the handler only
//      reaches when the submission through the invoking agent's own turn seam
//      returned true, AND the harness session log records the activation directive as
//      a USER-ROLE message of that session;
//   4. the handler's own artifact exists: one cell directory whose `state.json` carries
//      the objective, the `requirements` phase and a captain session, and whose journal
//      starts with the `start` event.
// Evidence carrier rule (AGENTS.md §7): every assertion reads the harness's session log
// (`lib/session-evidence.ts`), a value the real registry returned, or a file the handler
// wrote. The model's prose proves nothing.
//
// THE BOOT SHAPE: the offline recipe this case reuses — `createSandbox` (isolated DSH_HOME
// + sandboxed HOME + sandbox workspace), `installProfile` (the checkout's own `mpd-headless`
// profile with ABSOLUTE row paths — no registry, no pnpm), a local OpenAI-shaped model stub
// (`makeStubModel` + `useStubRoute`, no provider credential), and a `dsh --patch` overlay
// that mounts ONLY the probe row. No network is used.
// A SKIP IS NOT A PASS HERE: a missing `dsh` binary, a failed profile install or a failed
// boot are FAILURES of this case, never a quiet exit 0.
// PREREQ: absent-dsh-binary dsh install @deepseek-ai/dsh so the real harness binary is on PATH
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { readSessionEvents } from "./lib/session-evidence.ts"
import type { SessionRecord, SessionStore } from "./lib/session-evidence.ts"
import {
  REPO, binaryPresent, bootSession, cleanup, createSandbox, installProfile, isolationStep,
  keepRawSession, makeStubModel, timestamp, useStubRoute, writeEvidence,
} from "./extension-isolation.ts"
import { userMessageTexts } from "./ulw-command.ts"
import type { ProbeRecord } from "./lib/cellwork-command-probe.ts"

/** The case slug, used in the sandbox prefix, the evidence directory and every log line. */
const SLUG = "cellwork-command"
/** The objective the non-empty invocation carries, matched against the cell record and the directive. */
const OBJECTIVE = "qa-cellwork-objective-command"
/** The probe module mounted as a row by the `--patch` overlay. */
const PROBE = join(REPO, "skills", "dsh-qa", "scripts", "lib", "cellwork-command-probe.ts")
/** The command's argument hint, which a usable `/cellwork` must declare. */
const EXPECTED_HINT = "objective"
/** The head of the activation directive the handler submits (stable, asserted by the plugin's tests). */
const DIRECTIVE_HEAD = "[mpd-cellwork] CELLWORK MODE IS ACTIVE — cell "
/** The usage line an empty invocation must answer with. */
const USAGE_PROBE = "usage: /cellwork <objective>"
/** The handler's own success sentence, which it only reaches after a successful submission. */
const SUBMITTED_PROBE = "activation directive was submitted"
/** The prompt the booted session starts from; the stub answers it (and the directive turn). */
const PROMPT = "Reply with exactly: cellwork-command-qa"

/** A one-line problem list, empty when every expectation held. */
type Problems = string[]

/**
 * The LIVE registry's listing verdict: `cellwork` present, with a description and the objective hint.
 * @param descriptors The probe's recorded descriptors, unvalidated JSON.
 * @returns The verdict, the listed names and the problems found.
 */
export function evaluateListing(descriptors: unknown): { ok: boolean; names: string[]; problems: Problems } {
  /** One problem per failed expectation. */
  const problems: Problems = []
  if (!Array.isArray(descriptors)) return { ok: false, names: [], problems: ["the probe recorded no command descriptors (the registry listing failed or the row did not mount)"] }
  /** The descriptors as the record shape the probe writes. */
  const rows = descriptors as Array<Record<string, unknown>>
  /** Every listed name. */
  const names = rows.map((row) => String(row.name ?? "")).filter((value) => value !== "")
  /** The one row this case gates on. */
  const cellwork = rows.find((row) => row.name === "cellwork")
  if (cellwork === undefined) problems.push("the live command registry does not list `cellwork` (listed: " + names.join(", ") + ")")
  else {
    if (String(cellwork.description ?? "").trim() === "") problems.push("the listed `cellwork` descriptor carries no description")
    if (cellwork.hint !== EXPECTED_HINT) problems.push("the listed `cellwork` descriptor's input hint is " + JSON.stringify(cellwork.hint) + ", expected " + JSON.stringify(EXPECTED_HINT))
  }
  return { ok: problems.length === 0, names, problems }
}

/**
 * One invocation's settled verdict.
 * @param record The probe's recorded invocation, or null when the name did not resolve.
 * @param expectedKind The result kind that invocation must settle as.
 * @param needle A substring the result text must carry.
 * @param label The invocation name used in the problems.
 * @returns The verdict and its problems.
 */
export function evaluateInvocation(record: ProbeRecord["empty"], expectedKind: string, needle: string, label: string): { ok: boolean; kind: string | null; problems: Problems } {
  /** One problem per failed expectation. */
  const problems: Problems = []
  if (record === null) return { ok: false, kind: null, problems: ["the " + label + " invocation did not resolve in the live dispatcher (`/cellwork` is not registered)"] }
  if (record.kind !== expectedKind) problems.push("the " + label + " invocation settled kind=" + JSON.stringify(record.kind) + ", expected " + JSON.stringify(expectedKind) + " (text: " + record.text.slice(0, 200) + ")")
  if (!record.text.includes(needle)) problems.push("the " + label + " invocation's text does not carry " + JSON.stringify(needle))
  return { ok: problems.length === 0, kind: record.kind, problems }
}

/**
 * The handler's own artifact verdict: exactly ONE cell, objective, `requirements` phase, a start event.
 * @param cells The probe's recorded cell rows, unvalidated JSON.
 * @param objective The objective the invocation carried.
 * @returns The verdict, the cell ids and the problems.
 */
export function evaluateCells(cells: unknown, objective: string, cellsAfterEmpty?: unknown): { ok: boolean; ids: string[]; problems: Problems } {
  /** One problem per failed expectation. */
  const problems: Problems = []
  // THE EMPTY INVOCATION'S OWN CLAIM, checked against the snapshot taken BEFORE the non-empty dispatch
  // (CodeRabbit 4377306805). Without it the usage answer's "writes nothing" was only inferred from what a
  // LATER invocation did, so a cell written by the empty spelling could slip through.
  if (!Array.isArray(cellsAfterEmpty)) {
    problems.push("the probe recorded no post-empty cell list, so the claim that the empty invocation left the cell root empty cannot be checked")
  } else if (cellsAfterEmpty.length !== 0) {
    /** The cells the EMPTY invocation left behind, named so the failure says what was written. */
    const stray = (cellsAfterEmpty as Array<Record<string, unknown>>).map((row) => String(row.cellId ?? ""))
    problems.push("the EMPTY invocation wrote " + String(cellsAfterEmpty.length) + " cell(s) (" + stray.join(", ") + "), but the usage answer must leave the cell root empty")
  }
  if (!Array.isArray(cells)) return { ok: false, ids: [], problems: [...problems, "the probe recorded no cell list"] }
  /** The recorded cell rows. */
  const rows = cells as Array<Record<string, unknown>>
  /** Every cell id the boot's workspace holds. */
  const ids = rows.map((row) => String(row.cellId ?? ""))
  if (rows.length !== 1) problems.push("expected exactly ONE cell after the non-empty invocation, found " + String(rows.length) + " (" + ids.join(", ") + ")")
  /** The one cell this case reads. */
  const cell = rows[0]
  if (cell !== undefined) {
    /** The parsed record the probe read back. */
    const state = typeof cell.state === "object" && cell.state !== null ? cell.state as Record<string, unknown> : null
    if (state === null) problems.push("the cell's state.json could not be read as a record")
    else {
      if (state.objective !== objective) problems.push("the cell record's objective is " + JSON.stringify(state.objective) + ", expected " + JSON.stringify(objective))
      if (state.phase !== "requirements") problems.push("the cell record's phase is " + JSON.stringify(state.phase) + ", expected \"requirements\"")
      if (String(state.captainSessionId ?? "") === "") problems.push("the cell record carries no captain session id")
    }
    /** The journal's first event, which records how the cell started. */
    const first = typeof cell.firstJournalEvent === "object" && cell.firstJournalEvent !== null ? cell.firstJournalEvent as Record<string, unknown> : null
    if (first?.event !== "start") problems.push("the cell journal's first event is " + JSON.stringify(first?.event ?? null) + ", expected \"start\"")
  }
  return { ok: problems.length === 0, ids, problems }
}

/**
 * The submission verdict: the harness session log recorded the activation directive as a USER message.
 * @param texts The user-role message texts the session log recorded, in record order.
 * @param objective The objective the directive must carry.
 * @returns The verdict and its problems.
 */
export function evaluateDirective(texts: readonly string[], objective: string): { ok: boolean; problems: Problems } {
  /** One problem per failed expectation. */
  const problems: Problems = []
  /** The one recorded user message that carries the directive head. */
  const directive = texts.find((text) => text.includes(DIRECTIVE_HEAD))
  if (directive === undefined) {
    problems.push("no USER-ROLE message in the session log carries the activation directive head " + JSON.stringify(DIRECTIVE_HEAD) + " (" + String(texts.length) + " user message(s) recorded)")
    return { ok: false, problems }
  }
  if (!directive.includes(objective)) problems.push("the recorded directive does not carry the objective " + JSON.stringify(objective))
  if (!directive.includes("`cellwork_start`")) problems.push("the recorded directive does not instruct the captain to call `cellwork_start`")
  return { ok: problems.length === 0, problems }
}

/**
 * The harness-recorded command lifecycle: the dispatcher entered `/cellwork` at least once.
 * @param records The decoded session records.
 * @param name The command name the log must name.
 * @returns The verdict, the recorded names and the problems.
 */
export function evaluateCommandRecords(records: readonly SessionRecord[] | undefined, name: string): { ok: boolean; names: string[]; problems: Problems } {
  /** One problem per failed expectation. */
  const problems: Problems = []
  /** Every `command/run` name the log recorded. */
  const names = (records ?? []).filter((record) => record?.type === "command/run").map((record) => {
    /** The record's payload, read for the name only. */
    const data = (record as { data?: { name?: unknown } | null }).data
    return String(data?.name ?? "")
  }).filter((value) => value !== "")
  if (!names.includes(name)) problems.push("the session log recorded no `command/run` for " + JSON.stringify(name) + " (recorded: " + (names.join(", ") || "none") + ")")
  return { ok: problems.length === 0, names, problems }
}

/**
 * The overlay that mounts ONLY the probe row.
 * @param probePath Absolute path of the probe module.
 * @param outFile Absolute path the probe records into.
 * @param objective The objective the probe dispatches.
 * @returns The overlay YAML.
 */
export function probeOverlay(probePath: string, outFile: string, objective: string): string {
  return [
    "- insert:",
    "    - id: cellwork-command-probe",
    "      name: " + JSON.stringify(probePath),
    "      config:",
    "        outFile: " + JSON.stringify(outFile),
    "        objective: " + JSON.stringify(objective),
    "",
  ].join("\n")
}

/**
 * Read one workspace's newest session store, or null when there is none.
 * @param dshHome The isolated DSH home.
 * @param workspace The sandboxed session workspace.
 * @returns The store, or null.
 */
function storeOf(dshHome: string, workspace: string): SessionStore | null {
  try {
    return readSessionEvents(dshHome, { workspace })
  } catch {
    return null
  }
}

/**
 * The offline self-test: every predicate is exercised with a POSITIVE and a NEGATIVE fixture, and
 * the usage/success fixtures are the case's own real strings.
 * @returns Nothing; exits 1 when any arm fails.
 */
function selfTest(): void {
  /** One problem per failed arm. */
  const problems: Problems = []
  /** Assert one condition with a label. */
  const check = (label: string, condition: boolean): void => { if (!condition) problems.push(label) }
  // 1. The listing arm: positive, then three negatives (absent, no hint, no description).
  check("listing positive", evaluateListing([{ name: "cellwork", description: "d", hint: "objective" }]).ok)
  check("listing absent", !evaluateListing([{ name: "ulw", description: "d", hint: "objective" }]).ok)
  check("listing no hint", !evaluateListing([{ name: "cellwork", description: "d", hint: null }]).ok)
  check("listing no description", !evaluateListing([{ name: "cellwork", description: "", hint: "objective" }]).ok)
  check("listing non-list", !evaluateListing(null).ok)
  // 2. The invocation arm: the usage answer and the success answer, each with its negative control.
  check("usage positive", evaluateInvocation({ commandId: "cellwork", kind: "error", text: USAGE_PROBE }, "error", USAGE_PROBE, "empty").ok)
  check("usage wrong kind", !evaluateInvocation({ commandId: "cellwork", kind: "success", text: USAGE_PROBE }, "error", USAGE_PROBE, "empty").ok)
  check("usage missing line", !evaluateInvocation({ commandId: "cellwork", kind: "error", text: "nope" }, "error", USAGE_PROBE, "empty").ok)
  check("activation positive", evaluateInvocation({ commandId: "cellwork", kind: "success", text: "cellwork active: cell-1 — the " + SUBMITTED_PROBE + " as this agent's next turn" }, "success", SUBMITTED_PROBE, "filled").ok)
  check("activation unresolved", !evaluateInvocation(null, "success", SUBMITTED_PROBE, "filled").ok)
  check("activation wrong kind", !evaluateInvocation({ commandId: "cellwork", kind: "error", text: SUBMITTED_PROBE }, "success", SUBMITTED_PROBE, "filled").ok)
  // 3. The cell-artifact arm: one good record, then a wrong objective and a missing journal event.
  /** One good cell row, as the probe records it. */
  const goodCell = { cellId: "cell-1", state: { objective: OBJECTIVE, phase: "requirements", captainSessionId: "session-1" }, statePath: "/x/state.json", firstJournalEvent: { at: "now", event: "start" } }
  check("cell positive", evaluateCells([goodCell], OBJECTIVE, []).ok)
  check("cell written by the EMPTY invocation", !evaluateCells([goodCell], OBJECTIVE, [{ cellId: "cell-stray" }]).ok)
  check("cell post-empty list not recorded", !evaluateCells([goodCell], OBJECTIVE, undefined).ok)
  check("cell wrong objective", !evaluateCells([{ ...goodCell, state: { ...goodCell.state, objective: "other" } }], OBJECTIVE).ok)
  check("cell missing start", !evaluateCells([{ ...goodCell, firstJournalEvent: { event: "split-accepted" } }], OBJECTIVE).ok)
  check("cell two cells", !evaluateCells([goodCell, { ...goodCell, cellId: "cell-2" }], OBJECTIVE).ok)
  // 4. The directive arm: the head plus the objective, then a directive without the objective.
  check("directive positive", evaluateDirective(["hello", DIRECTIVE_HEAD + "cell-1\nOBJECTIVE: " + OBJECTIVE + "\ncall `cellwork_start` now"], OBJECTIVE).ok)
  check("directive missing", !evaluateDirective(["hello", "a normal answer"], OBJECTIVE).ok)
  check("directive wrong objective", !evaluateDirective([DIRECTIVE_HEAD + "cell-1\n`cellwork_start`"], OBJECTIVE).ok)
  // 5. The command-lifecycle arm: a recorded run, and the absence of one.
  /** One decoded record carrying a command run. */
  const runRecord = { type: "command/run", data: { name: "cellwork", args: OBJECTIVE } } as unknown as SessionRecord
  check("command record positive", evaluateCommandRecords([runRecord], "cellwork").ok)
  check("command record missing", !evaluateCommandRecords([{ type: "user/message", data: {} } as unknown as SessionRecord], "cellwork").ok)
  check("command record other name", !evaluateCommandRecords([runRecord], "ulw").ok)
  // 6. The overlay surgery: the probe row with an absolute module path and both config keys.
  /** The overlay the case writes. */
  const overlay = probeOverlay(PROBE, "/tmp/probe.json", OBJECTIVE)
  check("overlay inserts the probe", overlay.includes("- id: cellwork-command-probe"))
  check("overlay absolute module", overlay.includes(JSON.stringify(PROBE)) && PROBE.startsWith("/"))
  check("overlay carries the out file", overlay.includes("outFile: \"/tmp/probe.json\""))
  // 7. The fixtures above are the case's own constants, not a parallel spelling.
  check("usage fixture is the plugin's line", USAGE_PROBE.startsWith("usage: /cellwork"))
  if (problems.length > 0) {
    for (const problem of problems) console.log("[cellwork-command] SELF-TEST FAIL: " + problem)
    process.exit(1)
  }
  console.log("[cellwork-command] self-test PASS — " + String(7) + " arms incl. negative controls")
}

/**
 * The real run: sandbox, offline profile, stub model, one boot with the probe row, then the assertions.
 * @returns Nothing; sets the process exit code.
 */
async function main(): Promise<void> {
  // A MISSING PREREQUISITE IS A FAILURE HERE (the contract's own words): never a quiet SKIP.
  if (!binaryPresent("dsh")) {
    console.log("[mpd-qa] FAIL case=" + SLUG + " lane=real reason=absent-dsh-binary prereq=dsh remedy=\"install @deepseek-ai/dsh so the real harness binary is on PATH\"")
    process.exit(1)
  }
  if (!existsSync(PROBE)) {
    console.log("[mpd-qa] FAIL case=" + SLUG + " lane=real reason=absent-probe prereq=" + PROBE)
    process.exit(1)
  }
  /** The evidence directory under `evidence/cellwork/qa/`, or the wave's override. */
  const stamp = timestamp()
  /** The evidence directory this run writes into. */
  const outDir = process.env.MPD_QA_EVIDENCE_DIR
    ? join(process.env.MPD_QA_EVIDENCE_DIR, SLUG + "-" + stamp)
    : join(REPO, "evidence", "cellwork", "qa", stamp + "-command")
  mkdirSync(outDir, { recursive: true })
  /** The transcript lines the evidence log carries. */
  const log: string[] = []
  /** Append one transcript block. */
  const push = (text: string): void => { log.push(text) }
  /** The three sandbox paths and the child environment. */
  const sandbox = createSandbox(SLUG)
  /** The steps document the evidence carries. */
  const steps: Record<string, unknown> = {}
  try {
    push("# cellwork-command — Wave 3 / C3 real run\nsandbox=" + sandbox.sandbox + "\nDSH_HOME=" + sandbox.dshHome + "\nHOME=" + sandbox.runHome + "\nws=" + sandbox.ws + "\n")
    // 1. The offline profile: the checkout's own headless composition, absolute row paths, no registry.
    push("[install] node scripts/install-profile.ts --yes --dsh-home <sandbox> --profile mpd-headless --skip-toolchain")
    /** The install's exit status. */
    const install = await installProfile({ sandbox: sandbox.sandbox, dshHome: sandbox.dshHome, env: sandbox.env })
    push("[[install exit=" + install.status + "]]\n" + install.out.slice(0, 4000))
    steps.install = { ok: install.status === 0, exit: install.status }
    if (install.status !== 0) throw new Error("the offline profile install exited " + String(install.status))
    // 2. The model stub: no provider credential is read, and the run cannot reach a real model.
    /** The local stub that answers every model step. */
    const stub = makeStubModel({ label: SLUG, script: [{ text: "QA-STUB-CELLWORK-COMMAND-OK" }] })
    // The stub's listener is the reason this case must stop it explicitly: an open server keeps the
    // event loop alive and the process would hang AFTER writing its evidence (measured once).
    stubToClose = stub
    /** The stub's loopback port, written into the sandbox's route patch. */
    const port = await stub.listen()
    useStubRoute(sandbox.dshHome, port)
    push("[stub] listening on 127.0.0.1:" + port)
    // 3. The probe row through a `--patch` overlay, then one real boot.
    /** The probe's output file, inside the evidence directory so it is auditable. */
    const probeOut = join(outDir, "probe.json")
    /** The overlay file that mounts the probe. */
    const overlayFile = join(outDir, "probe-overlay.yml")
    writeFileSync(overlayFile, probeOverlay(PROBE, probeOut, OBJECTIVE))
    push("[overlay] " + overlayFile + "\n" + readFileSync(overlayFile, "utf8"))
    /** The booted session's outcome. */
    const run = await bootSession({ slug: SLUG, env: sandbox.env, cwd: sandbox.ws, prompt: PROMPT, stub, extraArgs: ["--patch", overlayFile] })
    push("[boot] $ dsh --profile mpd-headless --patch <overlay> " + JSON.stringify(PROMPT) + " (cwd " + sandbox.ws + ")\n[[exit=" + run.status + "]]\n" + run.out.slice(0, 8000))
    steps.boot = { ok: run.status === 0, exit: run.status, stubRequests: run.stubRequests }
    // 4. The probe's record and the harness session log, which is where the proofs live.
    /** The probe's record, or null when its row did not mount. */
    const probe: ProbeRecord | null = existsSync(probeOut) ? JSON.parse(readFileSync(probeOut, "utf8")) as ProbeRecord : null
    /** The workspace's newest session store, or null when nothing was recorded. */
    const store = storeOf(sandbox.dshHome, sandbox.ws)
    /** The decoded session records. */
    const records = store?.records ?? []
    push("[session] records=" + String(records.length) + " userMessages=" + String(userMessageTexts(records).length))
    if (store !== null) keepRawSession(outDir, SLUG, store)
    // 5. The verdicts.
    /** The live-registry listing. */
    const listing = evaluateListing(probe?.descriptors)
    /** The empty invocation (usage, nothing written). */
    const usage = evaluateInvocation(probe === null ? null : probe.empty, "error", USAGE_PROBE, "empty")
    /** The non-empty invocation (success after the submission). */
    const activation = evaluateInvocation(probe === null ? null : probe.filled, "success", SUBMITTED_PROBE, "filled")
    /** The handler's own artifact. */
    const cells = evaluateCells(probe?.cells, OBJECTIVE, probe?.cellsAfterEmpty)
    /** The directive in the harness session log. */
    const directive = evaluateDirective(userMessageTexts(records), OBJECTIVE)
    /** The dispatcher's own command record. */
    const lifecycle = evaluateCommandRecords(records, "cellwork")
    /** The workspace isolation assertion. */
    const isolation = isolationStep(sandbox.dshHome, sandbox.sandbox, SLUG)
    /** The probe's own recorded cwd, which must be this case's sandbox workspace. */
    const cwdOk = probe?.cwd === sandbox.ws
    steps.listing = { ok: listing.ok, names: listing.names, problems: listing.problems }
    steps.usage = { ok: usage.ok, kind: usage.kind, problems: usage.problems }
    steps.activation = { ok: activation.ok, kind: activation.kind, problems: activation.problems }
    steps.cells = { ok: cells.ok, ids: cells.ids, problems: cells.problems }
    steps.directive = { ok: directive.ok, problems: directive.problems }
    steps.commandLifecycle = { ok: lifecycle.ok, names: lifecycle.names, problems: lifecycle.problems }
    steps.cwd = { ok: cwdOk, recorded: probe?.cwd ?? null, expected: sandbox.ws }
    steps.isolation = isolation
    steps.probeErrors = probe?.errors ?? ["the probe recorded nothing"]
    /** Every problem the run found, in arm order. */
    const problems: Problems = [
      ...(probe === null ? ["the probe recorded nothing: its row did not mount, or the plugin tree failed to load"] : []),
      ...listing.problems, ...usage.problems, ...activation.problems, ...cells.problems, ...directive.problems, ...lifecycle.problems,
      ...(cwdOk ? [] : ["the probe's cwd is not this case's sandbox workspace"]),
      ...(isolation.ok ? [] : ["workspace isolation violated: " + String(isolation.error ?? "")]),
      ...(run.status === 0 ? [] : ["the boot exited " + String(run.status)]),
    ]
    push("[verdict] problems=" + String(problems.length) + (problems.length === 0 ? "" : "\n- " + problems.join("\n- ")))
    /** The case verdict, which also sets the exit code. */
    const ok = writeEvidence(outDir, SLUG, {
      ok: problems.length === 0,
      subject: "`/cellwork` is registered in the LIVE command registry and its handler submits the activation directive, on a real isolated boot",
      case: SLUG, wave: "cellwork-w3", objective: OBJECTIVE, prompt: PROMPT,
      command: "dsh --profile mpd-headless --patch <probe-overlay> " + JSON.stringify(PROMPT),
      sandbox: { root: sandbox.sandbox, dshHome: sandbox.dshHome, home: sandbox.runHome, ws: sandbox.ws },
      steps, problems,
      proves: [
        "The live `commands` registry listed `cellwork` with a description and the `objective` input hint (harness service, not a source grep).",
        "An EMPTY `/cellwork` settled kind=error with the usage line and left the cell root empty.",
        "A NON-EMPTY `/cellwork <objective>` settled kind=success, and the harness session log records the activation directive as a USER-ROLE message carrying the objective and the `cellwork_start` instruction.",
        "The handler wrote exactly one cell whose state.json carries the objective, phase requirements and a captain session, and whose journal starts with `start`.",
      ],
      doesNotProve: [
        "Any live-LLM cell run: the model step is a local stub, so no planner/splitter/team work is exercised here (the unit suite proves the protocol logic).",
        "That the BUNDLE row is the source of the mount: the profile install writes checkout-absolute rows, and the bundle wiring rests on verify:rows / verify:manifest.",
        "That a real slash-command INVOCATION from a TUI/web surface behaves the same; the dispatcher call is the harness's own, but the entry surface is not exercised.",
      ],
    }, log.join("\n\n"))
    process.exitCode = ok ? 0 : 1
  } catch (error) {
    /** The failure's message, which is what the evidence records. */
    const message = error instanceof Error ? error.message : String(error)
    push("[failure] " + message)
    writeEvidence(outDir, SLUG, { ok: false, case: SLUG, wave: "cellwork-w3", problems: [message], steps }, log.join("\n\n"))
    process.exitCode = 1
  } finally {
    if (stubToClose !== null) await stubToClose.close()
    cleanup(sandbox.sandbox)
  }
}

/** The model stub whose listener must be closed, so the process can exit after writing evidence. */
let stubToClose: { close: () => Promise<void> } | null = null

/** Whether this module is the process ENTRY, so importing its predicates never runs the case. */
const isEntry = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest()
  else void main()
}
