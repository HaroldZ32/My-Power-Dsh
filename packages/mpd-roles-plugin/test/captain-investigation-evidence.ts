#!/usr/bin/env bun
// THE CAPTAIN INVESTIGATION GUARD'S MOUNT EVIDENCE (contract `.mpd/plans/lane-l-captain-investigation.md`,
// clauses L1..L6): ONE reproducible run that produces `evidence/roles/captain-investigation/<UTC>/`.
//
// WHY THIS FILE SITS IN `packages/mpd-roles-plugin/test/**`: it is the lane's own evidence harness, and the
// lane's write scope is this package (src + test + dist), `presets/mpd.patch.yml`, `AGENTS.md`,
// `agent-references/**` and the evidence directory. A QA case body belongs under
// `skills/dsh-qa/scripts/**`, which the wave's SINGLE `skills/**` writer owns (§9) — so the harness is
// authored here and run directly, and it is NOT named `*.test.ts` so `bun test` never discovers it.
//
// WHAT IT PROVES, and why only a real boot can:
//   * L1 — the package's own pure arms (`bun test …/captain-investigation.test.ts`) decide the behaviour
//     table path by path;
//   * L2 — a REAL headless boot in an isolated DSH_HOME mounts the row, the row's boot line on disk
//     (`<ws>/.mpd/logs/mpd-roles.log`, never stdout: R5) reports `captainInvestigation=<mode>`, and the
//     top-level session's `read` of a SOURCE path is REFUSED, established behaviourally from the
//     harness's own session log (a recorded `tool/call` whose every recorded result is an ERROR that
//     carries the denial sentence) PLUS the absence of the probe file's marker in every result — never
//     from the model's prose (§7). `--dump-config` is not evidence here: it composes rows and never
//     executes plugin code.
//   * L2b — the DOCUMENTATION BAND stays open: the same boot reads `docs/probe.md` successfully.
//   * L3 — the knob both ways: with `captain.investigation: "allow"` in the sandbox workspace's
//     `.mpd/mpdcjsonc` the SAME read of the SAME source path SUCCEEDS and its content reaches the log,
//     and the boot line reports `allow`.
//   * L4 — every gate of the contract, each with its exit code and its log kept.
//   * L5 — `presets/mpd.patch.yml` no longer tells the captain to verify subagent results itself and DOES
//     carry the delegation clause (the two sentences are printed into the result).
//   * L6 — `AGENTS.md` measured with `wc -c` against the 65024-byte target, plus the moved long form
//     present at its `agent-references/` home with a pointer left behind.
//
// ISOLATION, all three layers (§7): an isolated `DSH_HOME`, a sandbox `HOME`, and a SEPARATE sandbox
// WORKSPACE per run (so each run's session store is unambiguous), with `assertSessionsSandboxed` and a
// before/after check on the REAL checkout's row log. Evidence -> `evidence/roles/captain-investigation/<UTC>/`.
import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { Env } from "../../../skills/dsh-qa/scripts/lib/credentials.ts"
import { credentialEnv, seedSandboxCredentials } from "../../../skills/dsh-qa/scripts/lib/credentials.ts"
import { DSH_MISSING, dshCommand } from "../../../skills/dsh-qa/scripts/lib/dsh-launcher.ts"
import { assertSessionsSandboxed, sandboxWorkspace } from "../../../skills/dsh-qa/scripts/lib/workspace-isolation.ts"
import type { SessionStore } from "../../../skills/dsh-qa/scripts/lib/session-evidence.ts"
import { readSessionEvents } from "../../../skills/dsh-qa/scripts/lib/session-evidence.ts"

/** The repository root: `packages/mpd-roles-plugin/test/<this file>` is four directories deep. */
const repoRoot: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The evidence slug, which names the directory under `evidence/roles/`. */
const SLUG: string = "captain-investigation"
/** The source path each run probes: REFUSED for the captain while the mode is `deny`. */
const SOURCE_PROBE: string = "packages/probe/src/probe.ts"
/** The documentation path each run-probe may read whatever the mode says: the band stays open. */
const DOC_PROBE: string = "docs/probe.md"
/** The content marker of {@link SOURCE_PROBE}; its presence in a result proves the source really was read. */
const SOURCE_MARKER: string = "PROBE_SOURCE_MARKER"
/** The content marker of {@link DOC_PROBE}; its presence proves the documentation read really happened. */
const DOC_MARKER: string = "PROBE_DOC_MARKER"
/** The fragment every denial sentence carries, asserted against the RECORDED result text. */
const DENIAL_MARKER: string = "captain investigation rule"
/** The boot-line field the roles row reports its install and mode with. */
const BOOT_FIELD: string = "captainInvestigation"
/** The row log the boot line lands in, relative to the booting session's workspace (R5: a row never prints). */
const ROW_LOG: string = join(".mpd", "logs", "mpd-roles.log")
/**
 * The NODE executable the repository's own `.ts` scripts run under (AGENTS.md §6: "run directly by
 * Node"). `process.execPath` is deliberately NOT used for them: this harness is run with `bun`, so
 * `process.execPath` would silently launch those scripts under bun instead — MEASURED here as a
 * `bun is unable to write files to tempdir: EROFS` startup failure of `preset-conformance.ts` in its
 * real mode. The `bun …` rows still spawn `bun`, because that is what the contract's commands spell.
 */
const NODE_BIN: string = process.env.MPD_DSH_NODE_BIN ?? "node"

/** One acceptance row, exactly the `{name, ok, reason, raw}` shape the contract asks for. */
interface Row {
  /** The clause or arm this row answers, e.g. `L2-mount-deny`. */
  name: string
  /** `true` observed, `false` contradicted, `null` not runnable (with the reason). */
  ok: boolean | null
  /** The one-line outcome a reader can act on. */
  reason: string
  /** The raw observation this row rests on (measured values, quoted text), never a summary of them. */
  raw: string
}

/** One `read` call's recorded evidence, decoded from the harness's own session log. */
interface ReadEvidence {
  /** True when a `read` call naming the probed path was recorded. */
  called: boolean
  /** The joined text of every recorded result for those calls. */
  resultText: string
  /** True when EVERY recorded result for those calls carried an error marker. */
  allErrored: boolean
  /** True when at least one recorded result carried no error marker. */
  anySucceeded: boolean
}

/** One headless run's recorded outcome. */
interface RunOutcome {
  /** The child's exit status, `null` when it was killed by the timeout. */
  exit: number | null
  /** The `read` call evidence decoded from the session log. */
  read: ReadEvidence
  /** The row log's text after the run, for the boot-line assertion. */
  rowLog: string
  /** The child's own output, kept for the evidence directory. */
  output: string
}

/**
 * Read one property of a decoded value, or `undefined` when the value is not an object.
 *
 * The session log is JSON the harness owns, so every read here is defensive: a shape this evidence
 * script does not recognize must degrade the ROW to a stated reason, never throw the run away.
 *
 * @param value - any decoded JSON value.
 * @param key - the property name to read.
 * @returns the property value, or `undefined`.
 */
function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined
  return (value as Record<string, unknown>)[key]
}

/**
 * The text and the error flag of ONE `tool/result` record.
 *
 * TWO BLOCK SHAPES ARE ACCEPTED ON PURPOSE. `tool/result` content blocks are emitted as
 * `{type:"text"}` by the harness this bundle runs on, while the shared QA helper (`resultTextOf` in
 * `skills/dsh-qa/scripts/lib/session-evidence.ts`) reads only `{type:"tool-result"}` — so its
 * `resultText` is EMPTY and its `succeeded` is really "a call was recorded". This decoder reads the
 * text block the harness actually writes and treats the guard's own `Error:` prefix as the error
 * marker, which is what makes the deny/allow arms falsifiable here.
 *
 * @param record - one decoded session record.
 * @returns the joined result text and whether it carries an error marker.
 */
function resultText(record: unknown): { text: string; error: boolean } {
  /** The record's `data` payload. */
  const data = field(record, "data")
  /** The result message inside it. */
  const message = field(data, "message")
  /** The message's content blocks, when it carries an array of them. */
  const blocks = field(message, "content")
  /** The text of every block, joined below. */
  const parts: string[] = []
  /** Whether an error marker was seen on the message itself or on any block. */
  let error = field(message, "isError") === true
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      /** The block's own `text`, which may be a string or an array of text parts. */
      const text = field(block, "text")
      if (typeof text === "string") parts.push(text)
      else if (Array.isArray(text)) {
        for (const part of text) {
          /** One text part inside an array-shaped block. */
          const inner = field(part, "text")
          if (typeof inner === "string") parts.push(inner)
        }
      }
      if (field(block, "isError") === true) error = true
    }
  }
  /** The joined text, whose leading `Error:` the harness writes for a guard denial. */
  const joined = parts.join("\n")
  if (joined.startsWith("Error:")) error = true
  return { text: joined, error }
}

/**
 * Decode the evidence of every `read` call that named one probed path.
 *
 * @param store - the harness's decoded session store for one run's workspace.
 * @param pathHint - the path the probe call must name (matched inside the recorded arguments).
 * @returns the call evidence, with the tallies the rows assert on.
 */
function readEvidence(store: SessionStore, pathHint: string): ReadEvidence {
  /** The call ids of the `read` calls that named the probed path. */
  const callIds = new Set<string>()
  for (const record of store.records) {
    if (field(record, "type") !== "tool/call") continue
    /** The call's `data` payload. */
    const data = field(record, "data")
    if (field(data, "name") !== "read") continue
    if (!JSON.stringify(field(data, "arguments") ?? "").includes(pathHint)) continue
    /** The call id the result records are paired by. */
    const id = field(data, "callId")
    if (typeof id === "string" && id !== "") callIds.add(id)
  }
  /** The joined result text of those calls. */
  const texts: string[] = []
  /** How many result records were paired with those calls. */
  let results = 0
  /** How many of them carried an error marker. */
  let errored = 0
  for (const record of store.records) {
    if (field(record, "type") !== "tool/result") continue
    /** The result's `data` payload. */
    const data = field(record, "data")
    /** The result's message, which carries its own `toolCallId` in some harness versions. */
    const message = field(data, "message")
    /** The call id this result answers, wherever the harness puts it. */
    const id = field(data, "toolCallId") ?? field(message, "toolCallId")
    if (typeof id !== "string" || !callIds.has(id)) continue
    /** This result's text and error marker. */
    const result = resultText(record)
    results += 1
    if (result.error) errored += 1
    texts.push(result.text)
  }
  return {
    called: callIds.size > 0,
    resultText: texts.join("\n"),
    allErrored: results > 0 && errored === results,
    anySucceeded: results > errored,
  }
}

/**
 * Build one acceptance row.
 *
 * @param name - the clause or arm this row answers.
 * @param ok - `true` observed, `false` contradicted, `null` not runnable.
 * @param reason - the one-line outcome.
 * @param raw - the raw observation behind the row.
 * @returns the row.
 */
function row(name: string, ok: boolean | null, reason: string, raw: string): Row {
  return { name, ok, reason, raw }
}

/**
 * Create a sandbox workspace carrying the two probe files and return its absolute path.
 *
 * @param sandbox - the isolated DSH_HOME the workspace lives inside.
 * @param name - the workspace directory name, unique per run so its session store cannot mix runs.
 * @returns the absolute workspace path to spawn the child with.
 */
function probeWorkspace(sandbox: string, name: string): string {
  /** The created workspace directory. */
  const ws = sandboxWorkspace(sandbox, name)
  mkdirSync(join(ws, "packages", "probe", "src"), { recursive: true })
  mkdirSync(join(ws, "docs"), { recursive: true })
  writeFileSync(join(ws, SOURCE_PROBE), SOURCE_MARKER + "\n", "utf8")
  writeFileSync(join(ws, DOC_PROBE), DOC_MARKER + "\n", "utf8")
  return ws
}

/**
 * Drive ONE headless boot and read its evidence from the ROW LOG and the HARNESS's session log.
 *
 * The child's stdio goes to a FILE (§7's shell caveat: long-lived MCP children inherit fds and a pipe can
 * hang), so a killed child still leaves everything it printed.
 *
 * @param sandbox - the isolated DSH_HOME.
 * @param ws - the sandbox workspace this run's session lives in.
 * @param task - the task text handed to the headless session.
 * @param env - the child environment (sandbox home plus the resolved credential key).
 * @param logFile - the file the child's own output is written to.
 * @param recordsFile - the file the decoded session records are written to, so a reader can re-derive
 * the verdict from the raw bytes rather than from this script's summary.
 * @param pathHint - the path the probe's `read` call must name.
 * @returns what the run recorded, never a thrown error — the caller asserts on the fields.
 */
function runOnce(sandbox: string, ws: string, task: string, env: Env, logFile: string, recordsFile: string, pathHint: string): RunOutcome {
  /** The resolved launcher invocation, or `null` when no launcher is installed. */
  const spec = dshCommand(["--profile", "mpd-headless", task], env)
  if (spec === null) throw new Error(DSH_MISSING)
  /** The open descriptor the child's stdout and stderr both land on, closed in the `finally` below. */
  const fd = openSync(logFile, "w")
  /** The child run: a hard timeout, because a hung child must not hang the evidence. */
  let run: SpawnSyncReturns<string> | undefined
  try {
    run = spawnSync(spec.command, spec.args, { env, cwd: ws, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 900000, stdio: ["ignore", fd, fd] })
  } finally {
    closeSync(fd)
  }
  /** The row log's text after the boot, or the empty string when the row never wrote one. */
  const rowLogPath = join(ws, ROW_LOG)
  /** The harness's own records for THIS run's workspace, decoded frame by frame. */
  const events: SessionStore = readSessionEvents(sandbox, { workspace: ws })
  // THE DECODED RECORDS ARE KEPT AS EVIDENCE: the arms' verdicts are only as good as this decode, so the
  // raw tool records land beside the log and a reader can re-derive every number independently.
  writeFileSync(recordsFile, JSON.stringify(events.records.filter((record) => {
    /** The record's own type discriminator. */
    const type = field(record, "type")
    return type === "tool/call" || type === "tool/result"
  }), null, 1), "utf8")
  /** The row log's text after the boot, or the empty string when the row never wrote one. */
  const rowLog = existsSync(rowLogPath) ? readFileSync(rowLogPath, "utf8") : ""
  // THE ROW LOG IS COPIED INTO THE EVIDENCE: the boot line is the registration instrument (the guard
  // install reporting its mode), and it lives in the SANDBOX workspace, which a fresh `/tmp` discards
  // once this process exits — the copy is what makes the claim readable afterwards.
  writeFileSync(logFile.replace(/\.log$/, "-rowlog.log"), rowLog, "utf8")
  return {
    exit: run.status,
    read: readEvidence(events, pathHint),
    rowLog,
    output: readFileSync(logFile, "utf8"),
  }
}
/**
 * Assert one reconnaissance run against the contract: refused, or allowed with the content reaching the log.
 *
 * @param label - the row's name.
 * @param outcome - what the boot recorded.
 * @param options.allow - true when the run must SUCCEED and carry the source marker.
 * @param options.marker - the marker the allowed run must carry.
 * @param options.bootField - the exact boot-line field the row log must carry (`captainInvestigation=…`).
 * @returns the acceptance row.
 */
function reconnaissanceRow(label: string, outcome: RunOutcome, options: { allow: boolean; marker: string; bootField: string }): Row {
  /** Whether the row's required boot line is on disk. */
  const booted = outcome.rowLog.includes(options.bootField)
  /** Whether every recorded `read` result was an error carrying the denial sentence. */
  const denied = outcome.read.called && outcome.read.allErrored && outcome.read.resultText.includes(DENIAL_MARKER)
  /** Whether the probe's marker reached the recorded results. */
  const content = outcome.read.resultText.includes(options.marker)
  /** The raw observation, quoted so a reader sees the measured facts rather than a verdict. */
  const raw = "exit=" + String(outcome.exit) + " readCalled=" + String(outcome.read.called) + " readResultsErrored=" + String(outcome.read.allErrored)
    + " readResultsSucceeded=" + String(outcome.read.anySucceeded) + " bootLine=" + String(booted) + " markerSeen=" + String(content)
    + " rowLogLine=" + JSON.stringify(outcome.rowLog.split("\n").find((line) => line.includes(BOOT_FIELD)) ?? "")
    + " resultText=" + JSON.stringify(outcome.read.resultText.slice(0, 600))
  if (!outcome.read.called) {
    return row(label, null, "the model never called `read` on the probed path (answer-only narration is not tool evidence)", raw)
  }
  if (!booted) return row(label, false, "the row log carries no " + options.bootField + " line — the guard is not installed/reported", raw)
  if (options.allow) {
    return row(label, content && outcome.read.anySucceeded,
      content ? "the read succeeded and the content reached the session log" : "the read did not return the probe content", raw)
  }
  if (!denied) return row(label, false, "the read of a source path was NOT refused with the denial sentence", raw)
  if (content) return row(label, false, "the source content reached the session log although the call was refused", raw)
  return row(label, true, "refused: every recorded result is an ERROR carrying the denial sentence, and no source content reached the log", raw)
}

/**
 * Run one shell command from the repository root and keep its combined output as a gate log.
 *
 * @param name - the row name.
 * @param command - the executable to run.
 * @param args - its arguments, exactly as the contract spells them.
 * @param logFile - the file the combined output is written to.
 * @returns the acceptance row, `ok: null` when the command could not be executed at all.
 */
function gateRow(name: string, command: string, args: readonly string[], logFile: string): Row {
  /** The gate run, from the repository root so every relative path means what the contract says. */
  const run = spawnSync(command, args as string[], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 1800000 })
  /** The combined output, written whole so the evidence carries the measurement. */
  const output = (run.stdout ?? "") + (run.stderr ?? "")
  writeFileSync(logFile, output, "utf8")
  /** The last non-empty lines, which is what a reader needs to see the outcome. */
  const tail = output.split("\n").filter((line) => line.trim() !== "").slice(-6).join("\n")
  if (run.error !== undefined) return row(name, null, command + " could not be run: " + String(run.error.message), tail)
  return row(name, run.status === 0, command + " " + args.join(" ") + " -> exit " + String(run.status), tail)
}

/** The live part: install the bundle into a sandbox home, drive the boots, then run every gate. */
function main(): void {
  /** The instant this run started, which names its evidence directory. */
  const startedAt = new Date().toISOString()
  /** The evidence directory every artifact of this run lands in. */
  const outDir = join(repoRoot, "evidence", "roles", SLUG, startedAt.replaceAll(":", "-"))
  /** The gate logs' directory. */
  const logsDir = join(outDir, "logs")
  mkdirSync(logsDir, { recursive: true })
  /** The real checkout's row log, whose bytes must not move (§7's isolation obligation). */
  const realRowLog = join(repoRoot, ROW_LOG)
  /** The real row log's size before the runs, or -1 when it does not exist. */
  const realRowLogBefore = existsSync(realRowLog) ? statSync(realRowLog).size : -1
  /** The rows accumulated by this run. */
  const rows: Row[] = []

  // L1 — the package's own pure arms, run first: they need no harness and they fail fast.
  rows.push(gateRow("L1-pure-arms", "bun", ["test", "packages/mpd-roles-plugin/test/captain-investigation.test.ts"], join(logsDir, "L1-pure-arms.log")))

  // L5 — the preset text: the sentence that told the captain to verify results itself must be GONE, and
  // the delegation clause must be present. Read as bytes, quoted verbatim into the row.
  /** The preset patch's text, the subject of the L5 rows. */
  const preset = readFileSync(join(repoRoot, "presets", "mpd.patch.yml"), "utf8")
  /** The sentence the contract removes, as the two spellings the file carried. */
  const banned = ["can edit - always verify their claimed", "can edit — always verify their claimed results yourself."]
  /** The lines that still carry a self-verification instruction, if any. */
  const bannedHits = preset.split("\n").filter((line) => banned.some((needle) => line.includes(needle)))
  /** The delegation clause's own line, quoted into the row. */
  const delegationLine = preset.split("\n").find((line) => line.includes("Reconnaissance is DELEGATED")) ?? ""
  rows.push(row("L5-preset-no-self-verify", bannedHits.length === 0,
    bannedHits.length === 0 ? "no sentence tells the captain to verify subagent results itself" : bannedHits.length + " self-verification sentence(s) remain",
    bannedHits.length === 0 ? preset.split("\n").find((line) => line.includes("treat their output as advice")) ?? "" : bannedHits.join("\n")))
  rows.push(row("L5-preset-delegation-clause", delegationLine !== "",
    delegationLine !== "" ? "the delegation clause is present" : "the delegation clause is MISSING",
    delegationLine))
  /** The reconnaissance sentence in the preset, which the delegation clause must be part of. */
  const reconLine = preset.split("\n").find((line) => line.includes("read`/`grep`/`glob`")) ?? ""
  rows.push(row("L5-preset-mechanical-denial", reconLine !== "",
    reconLine !== "" ? "the preset states the mechanical denial and the open documentation band" : "the preset says nothing about the denied reconnaissance tools",
    reconLine))

  // L6 — the manual's instruction budget and the move-first obligation.
  /** `AGENTS.md`'s byte count, measured with the same `wc -c` a reader would run. */
  const manualBytes = Number(spawnSync("wc", ["-c", join(repoRoot, "AGENTS.md")], { encoding: "utf8" }).stdout.trim().split(/\s+/)[0])
  /** The manual's text, for the pointer assertion. */
  const manual = readFileSync(join(repoRoot, "AGENTS.md"), "utf8")
  /** The pointer left where the long form was moved out. */
  const pointerLine = manual.split("\n").find((line) => line.includes("agent-references/verification-flow.md") && line.includes("§5 rule 2")) ?? ""
  /** The moved long form's home. */
  const movedHome = join(repoRoot, "agent-references", "verification-flow.md")
  /** Whether the moved section really exists at that home. */
  const movedPresent = existsSync(movedHome) && readFileSync(movedHome, "utf8").includes("§5 rule 2 — the captain's reserved set")
  rows.push(row("L6-manual-budget", manualBytes <= 65024,
    "AGENTS.md measures " + manualBytes + " B (" + (manualBytes <= 65024 ? "within" : "OVER") + " the 65024 B target of the 65536 B cap)",
    "wc -c AGENTS.md = " + manualBytes))
  rows.push(row("L6-move-first", pointerLine !== "" && movedPresent,
    pointerLine !== "" && movedPresent ? "the pointer is in place and the moved long form is at its agent-references/ home" : "the pointer and/or the moved long form is missing",
    "pointer: " + pointerLine + "\nmoved-section-present: " + String(movedPresent)))

  // ── L2/L3 — THE MOUNT ARMS. Everything below needs the rebuilt dist in the sandbox's own profile. ──
  /** The real credential store the sandbox copy is seeded from. */
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) {
    rows.push(row("L2-mount-deny", null, "no credential store at " + creds + " — a live boot cannot run", ""))
    rows.push(row("L2-doc-band-open", null, "no credential store at " + creds, ""))
    rows.push(row("L3-knob-allow", null, "no credential store at " + creds, ""))
  } else {
    /** The throwaway harness home. */
    const sandbox = mkdtempSync(join(tmpdir(), "mpd-captain-investigation-"))
    seedSandboxCredentials(sandbox, { credentialsFile: creds })
    /** The real settings file, when the deployment has one (a gateway chain lives there, §7). */
    const settings = join(homedir(), ".dsh", "settings.yaml")
    if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
    /** The child environment: the sandbox home as DSH_HOME *and* HOME. */
    const env: Env = { ...credentialEnv({ ...process.env, DSH_HOME: sandbox }), HOME: sandbox }
    /** The installer run that stages the bundle rows into the sandbox profile. */
    const install = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.ts"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
    writeFileSync(join(logsDir, "install-profile.log"), (install.stdout ?? "") + (install.stderr ?? ""), "utf8")
    if (install.status !== 0) {
      rows.push(row("L2-mount-deny", false, "install-profile failed (exit " + String(install.status) + ")", (install.stdout ?? "") + (install.stderr ?? "")))
    } else {
      // THE DENY RUN, default mode: the captain reads the SOURCE probe. It must be refused.
      /** The deny run's workspace, with its own probe files. */
      const wsDeny = probeWorkspace(sandbox, "ws-deny")
      /** The deny run's outcome. */
      const denyRun = runOnce(sandbox, wsDeny, "Use the read tool exactly once with file_path \"" + SOURCE_PROBE + "\". Then reply with the exact text the tool returned, prefixed by RESULT:.",
        env, join(logsDir, "run-deny-source.log"), join(logsDir, "records-deny-source.json"), SOURCE_PROBE)
      rows.push(reconnaissanceRow("L2-mount-deny", denyRun, { allow: false, marker: SOURCE_MARKER, bootField: BOOT_FIELD + "=deny" }))
      // THE DOCUMENTATION-BAND RUN, same mode: the captain reads `docs/probe.md`. It must succeed.
      /** The documentation run's workspace. */
      const wsDocs = probeWorkspace(sandbox, "ws-docs")
      /** The documentation run's outcome. */
      const docsRun = runOnce(sandbox, wsDocs, "Use the read tool exactly once with file_path \"" + DOC_PROBE + "\". Then reply with the exact text the tool returned, prefixed by RESULT:.",
        env, join(logsDir, "run-deny-docs.log"), join(logsDir, "records-deny-docs.json"), DOC_PROBE)
      rows.push(reconnaissanceRow("L2-doc-band-open", docsRun, { allow: true, marker: DOC_MARKER, bootField: BOOT_FIELD + "=deny" }))
      // THE ALLOW RUN: the knob in the SANDBOX WORKSPACE's own `mpd.jsonc`. The same read must succeed.
      /** The allow run's workspace, whose project config opts out. */
      const wsAllow = probeWorkspace(sandbox, "ws-allow")
      mkdirSync(join(wsAllow, ".mpd"), { recursive: true })
      writeFileSync(join(wsAllow, ".mpd", "mpd.jsonc"), '{ "captain": { "investigation": "allow" } }\n', "utf8")
      /** The allow run's outcome. */
      const allowRun = runOnce(sandbox, wsAllow, "Use the read tool exactly once with file_path \"" + SOURCE_PROBE + "\". Then reply with the exact text the tool returned, prefixed by RESULT:.",
        env, join(logsDir, "run-allow-source.log"), join(logsDir, "records-allow-source.json"), SOURCE_PROBE)
      rows.push(reconnaissanceRow("L3-knob-allow", allowRun, { allow: true, marker: SOURCE_MARKER, bootField: BOOT_FIELD + "=allow" }))
    }
    /** The isolation verdict: no session-store key may escape the sandbox. */
    const isolation = ((): string => {
      try {
        /** The verdict from the shared helper, whose throw is the failure being caught. */
        const verdict = assertSessionsSandboxed(sandbox, sandbox, { label: SLUG })
        return "ok: " + verdict.checked + " session-store key(s), all under the sandbox"
      } catch (error) {
        return "FAILED: " + (error instanceof Error ? error.message : String(error))
      }
    })()
    rows.push(row("L2-isolation", isolation.startsWith("ok"), isolation, "sandbox=" + sandbox))
    /** The real checkout's row log size after every run, or -1 when it does not exist. */
    const realRowLogAfter = existsSync(realRowLog) ? statSync(realRowLog).size : -1
    rows.push(row("L2-real-checkout-untouched", realRowLogBefore === realRowLogAfter,
      "the real checkout's " + ROW_LOG + " is " + (realRowLogBefore === realRowLogAfter ? "byte-identical" : "CHANGED") + " across the runs",
      "before=" + realRowLogBefore + " after=" + realRowLogAfter))
    writeFileSync(join(outDir, "sandbox.txt"), sandbox + "\n", "utf8")
  }

  // ── L4 — the contract's gate set, each with its log. These run LAST: they measure the final tree. ──
  rows.push(gateRow("L4-package-tests", "bun", ["test", "packages/mpd-roles-plugin"], join(logsDir, "L4-package-tests.log")))
  rows.push(gateRow("L4-typecheck", "bun", ["run", "typecheck"], join(logsDir, "L4-typecheck.log")))
  rows.push(gateRow("L4-comments", "bun", ["run", "verify:comments"], join(logsDir, "L4-comments.log")))
  rows.push(gateRow("L4-manifest", "bun", ["run", "verify:manifest"], join(logsDir, "L4-manifest.log")))
  rows.push(gateRow("L4-manual-paths", NODE_BIN, ["scripts/verify-manual-paths.ts"], join(logsDir, "L4-manual-paths.log")))
  rows.push(gateRow("L4-dist-fresh", NODE_BIN, ["scripts/verify-dist-fresh.ts"], join(logsDir, "L4-dist-fresh.log")))
  // THE SCOPED FRESHNESS ROW: the whole-tree gate is RED whenever ANOTHER lane's `src/**` is newer than
  // its committed `dist/**`, and this lane may not rebuild a package it does not own. The scoped run
  // isolates the only claim this lane makes — ITS OWN target is fresh — and the full run above keeps the
  // aggregate measurement, red or green, so the bound is visible rather than averaged away.
  rows.push(gateRow("L4-dist-fresh-roles-only", NODE_BIN, ["scripts/verify-dist-fresh.ts", "--only", "mpd-roles-plugin"], join(logsDir, "L4-dist-fresh-roles-only.log")))
  rows.push(gateRow("L4-rows", "bun", ["run", "verify:rows"], join(logsDir, "L4-rows.log")))
  // THE INDEPENDENCE GATE (docs/independence.md A1.3): its frozen inventory is keyed by
  // `file :: normalized line text`, so this lane's new source edge had to be RECORDED there. It is run
  // as its own row because the repo-wide `bun test` failure it caused is exactly why the entry exists.
  rows.push(gateRow("L4-coupling-inventory", "bun", ["packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts"], join(logsDir, "L4-coupling-inventory.log")))
  rows.push(gateRow("L4-preset-conformance", NODE_BIN, ["skills/dsh-qa/scripts/preset-conformance.ts", "--self-test"], join(logsDir, "L4-preset-conformance.log")))
  // THE REAL MOUNT ARM FOR THE PRESET TEXT (L5): the self-test above is offline, so it cannot see the
  // preset the loader actually resolves. This run boots a real dsh with the `mpd` preset, validates every
  // row config against the installed plugin schemas, pins the preset's row set, creates a session with
  // `agentPreset=mpd`, and proves the assertion falsifiable with its own negative control.
  rows.push(gateRow("L5-preset-conformance-real", NODE_BIN, ["skills/dsh-qa/scripts/preset-conformance.ts"], join(logsDir, "L5-preset-conformance-real.log")))

  /** Whether every row that was run passed. */
  const ok = rows.every((entry) => entry.ok !== false)
  /** The unattempted rows, named so a reader sees exactly what is missing. */
  const notRun = rows.filter((entry) => entry.ok === null).map((entry) => entry.name)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, slug: SLUG, startedAt, rows, notRun }, null, 2))
  // THE README: the exact commands and their observed outcomes, so the directory is reproducible by a
  // reader who has never seen this lane. Written from the SAME row list result.json carries.
  writeFileSync(join(outDir, "README.md"), evidenceReadme(startedAt, rows), "utf8")
  console.log("[" + SLUG + "] ok=" + ok + " rows=" + rows.length + " -> " + outDir)
  for (const entry of rows) console.log("  " + entry.name + ": " + String(entry.ok) + " — " + entry.reason)
  if (!ok) process.exit(1)
  console.log("[" + SLUG + "] PASS")
}

/**
 * Render the evidence directory's README from the measured rows.
 *
 * @param startedAt - the UTC instant this run started.
 * @param rows - every acceptance row this run produced.
 * @returns the README's markdown.
 */
function evidenceReadme(startedAt: string, rows: readonly Row[]): string {
  /** One markdown table row per acceptance row, in run order. */
  const table = rows.map((entry) => "| " + entry.name + " | " + String(entry.ok) + " | " + entry.reason.replace(/\|/g, "\\|") + " |").join("\n")
  return "# Captain investigation guard — mount evidence (" + startedAt + ")\n\n"
    + "Contract: `.mpd/plans/lane-l-captain-investigation.md` (lane L). Verification loop: "
    + "`loop-20261008T073559-e89f04`. Reproduce with ONE command from the repository root:\n\n"
    + "```\nbun packages/mpd-roles-plugin/test/captain-investigation-evidence.ts\n```\n\n"
    + "It runs the clauses L1..L6 in order: the package's pure arms, the two preset-text checks plus the "
    + "manual-budget measurement, then three REAL headless boots in an isolated `DSH_HOME` (deny mode on a "
    + "source path, deny mode on a documentation path, allow mode on the same source path), and finally "
    + "every gate of clause L4. `--dump-config` is deliberately NOT used: it composes rows and never "
    + "executes plugin code.\n\n"
    + "| row | ok | reason |\n|---|---|---|\n" + table + "\n\n"
    + "Artifacts: `result.json` (the rows above, machine-readable), `logs/` (one file per gate, the "
    + "child's whole output), and this README. The boot rows read the ROW LOG the roles plugin writes "
    + "(`<workspace>/.mpd/logs/mpd-roles.log`, never stdout: R5) and the HARNESS's own session log — a "
    + "recorded `tool/call` plus the error/allow verdict on its `tool/result` — never the model's prose.\n\n"
    + "Honest bound: the guard reads a TOOL CALL's arguments, so reaching a source path through `bash` "
    + "(`cat`, `rg`) is NOT blocked by this rule; and a path is judged by its SPELLING, so a symlink is "
    + "never resolved.\n"
}

main()
