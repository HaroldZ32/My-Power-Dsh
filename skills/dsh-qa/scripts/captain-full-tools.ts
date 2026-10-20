#!/usr/bin/env node
// Case captain-full-tools: the WITHDRAWAL's boot-line proof, plus a corroborative read/write/bash witness.
//
// WHY THIS CASE EXISTS (`.mpd/plans/harness-021-rollback.md` R1 + F2, user ruling 2026-10-17): the
// 2026-10-10/11 wave installed three mechanical guards on the top-level agent — a captain-investigation
// guard (reconnaissance delegated: `read`/`grep`/`glob` refused on SOURCE paths), a delegation gate
// (bare `subagent`/`subagent_fork`/`workflow` refused) and the verification law's write guard (a code
// `write` refused unless an A-writes/B-verifies loop was armed). The user withdrew ALL THREE: one agent,
// its whole tool pack, steered by the persona prompt instead of hooks.
//
// WHAT EACH ARM IS WORTH — the two tiers are named so no reader mistakes one for the other:
//   * DISCRIMINATING, the boot line: the roles row reports the three withdrawn guards as
//     `absent reason=…` and the session gate as `off`. `apply()` produces that line, and a
//     pre-withdrawal `dist` prints MODES here, so this arm reddens on a stale artifact and cannot pass
//     a tree that still installs the ceremony.
//   * DISCRIMINATING, offline (`--self-test`): the SHIPPED apply site no longer contains any of the
//     three install calls and still prints each absent token; `resolveGateMode(undefined)` is `off`; the
//     row is composed exactly once; this case is registered in the skill's table.
//   * CORROBORATIVE, the read/write/bash arms — read this before trusting them: a one-shot HEADLESS boot
//     NEVER composes an agent preset. The harness's own `@deepseek-ai/dsh-headless` `assertAdoptable`
//     throws `session "…" runs under agent preset "…", which the one-shot runner does not compose`, and
//     the withdrawn guards were AGENT-SCOPED, so they never armed in this lane at all. MEASURED by the
//     wave's verification lane: the PRE-wave tree on 0.2.0 AND on 0.2.1 already allowed read-source +
//     write-code headless, with `verifyGate=installed captainInvestigation=deny` on the boot line. These
//     arms therefore prove the pack is intact and callable on THIS composition — never that the rollback
//     happened — which is why their row names carry the `corroborative-` prefix. A discriminating LIVE
//     arm needs an AGENT-PRESET session (the web profile's `session/create` with `agentPreset: "mpd"`),
//     and that belongs to the verification lane.
//   * CORROBORATIVE, the tool list: the request header OFFERS the pack (`read`, `write`, `edit`, `bash`,
//     `grep`, `glob`, `subagent`) — tool-LIST evidence, the only accepted proof that a tool is mounted
//     (§7). The harness offers the same list before and after the rollback; it is a mount witness.
//   * SAFETY (neither tier): three-layer isolation (§7) holds and the REAL checkout's row log is
//     untouched — those keep the case itself trustworthy, they say nothing about the withdrawal.
//
// WHAT IT DOES NOT PROVE, stated so nobody over-reads it: it does not prove the roster read-only guard
// (a DIFFERENT guard, `readonly-deny`'s subject), nor the ask_user_question backstop, nor that the model
// USES the pack well — and, per the bound above, it does not prove the agent-scoped guards were
// withdrawn on an agent-preset session.
//
// PREREQ: absent-dsh-binary dsh "install DeepSeek Harness (dsh) on PATH"
// PREREQ: absent-credentials DEEPSEEK_API_KEY "export DEEPSEEK_API_KEY in the launching shell, or add `refs: DEEPSEEK_API_KEY: <value>` to ~/.dsh/.credentials.yaml"
// PREREQ: absent-runtime packages/mpd-roles-plugin/dist/index.js ".toolchain/node_modules/.bin/bun build packages/mpd-roles-plugin/src/index.ts --target node --format esm --outfile packages/mpd-roles-plugin/dist/index.js"
//
// Isolation (all three layers, §7): isolated DSH_HOME + sandbox HOME + a sandbox WORKSPACE whose source
// and code paths are COPIES (the real tree is never the subject). Evidence ->
// evidence/roles/captain-full-tools/<ts>/{result.json,output.log,logs/}.
import { spawnSync } from "node:child_process"
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { credentialEnv, credentialDescriptor, resolveProviderCredential, seedSandboxCredentials, type Env } from "./lib/credentials.ts"
import type { CredentialResolution } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.ts"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.ts"
import { findToolCall, readSessionEvents } from "./lib/session-evidence.ts"
import { GATE_MODE_OFF, resolveGateMode } from "../../../packages/mpd-roles-plugin/src/complexity-gate.ts"

/** The repository root, derived from this script's own URL (`<root>/skills/dsh-qa/scripts/`). */
const repoRoot: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The evidence slug: the SKIP/FAIL marker and the evidence directory both carry it. */
const SLUG: string = "captain-full-tools"
/** The role's own log, relative to a booting session's workspace (R5: a row never prints to stdout). */
const ROW_LOG: string = join(".mpd", "logs", "mpd-roles.log")
/** The boot-line token a withdrawn write guard must report — a REASON, never a mode. */
const ABSENT_VERIFY: string = "verifyGate=absent reason="
/** The boot-line token a withdrawn reconnaissance guard must report. */
const ABSENT_INVESTIGATION: string = "captainInvestigation=absent reason="
/** The boot-line token a withdrawn delegation gate must report. */
const ABSENT_DELEGATION: string = "delegationGate=absent reason="
/** The session gate's OPT-IN default, as the boot line must spell it. */
const SESSION_GATE_OFF: string = "sessionGate=off"
/** The pack §5's top-level agent holds DIRECTLY, asserted from the request header's tool list. */
const ENGINE_TOOLS: readonly string[] = ["read", "write", "edit", "bash", "grep", "glob", "subagent"]
/** The SOURCE path the session reads — a COPY inside the sandbox workspace, never the real tree. */
const SOURCE_PATH: string = "packages/mpd-roles-plugin/src/roles.data.ts"
/** The CODE path the session writes — likewise a sandbox path, so no real file is touched. */
const CODE_PATH: string = "packages/mpd-roles-plugin/src/probe-full-tools.ts"
/** The source file the sandbox copy is made from, whose own first line becomes the read needle. */
const SOURCE_ORIGIN: string = join(repoRoot, "packages", "mpd-roles-plugin", "src", "roles.data.ts")
/** The shipped apply site, whose absent tokens the offline arm pins. */
const APPLY_SITE: string = join(repoRoot, "packages", "mpd-roles-plugin", "src", "index.ts")
/** The three installs the rollback removed; any of them present again means the ceremony returned. */
const WITHDRAWN_INSTALLS: readonly string[] = ["installVerifyGuard(", "installCaptainInvestigationGuard(", "installDelegationGate("]
/** The rebuild command the runtime precondition names, so a stale artifact is never a mystery. */
const REBUILD_COMMAND: string = ".toolchain/node_modules/.bin/bun build packages/mpd-roles-plugin/src/index.ts --target node --format esm --outfile packages/mpd-roles-plugin/dist/index.js"
/** The declared provider id this case resolves its credential for. */
const PROVIDER: string = "deepseek"
/** True when either strict spelling turns an absent prerequisite from a SKIP into a FAIL. */
const STRICT: boolean = process.argv.includes("--no-skip") || process.argv.includes("--require-pack")

/** A lane prerequisite: absent means SKIP, or FAIL under either strict spelling. */
interface Prereq {
  /** The machine-readable reason code the SKIP/FAIL marker reports. */
  readonly reason: string
  /** The repository-relative path or probe whose absence was observed. */
  readonly prereq: string
  /** The command (or doc pointer) a human runs to satisfy the prerequisite. */
  readonly remedy: string
}

/** One evidence row: the `{name, ok, reason, raw}` shape this repository's mount evidence uses. */
interface Row {
  /** The arm this row answers. */
  readonly name: string
  /** `true` observed, `false` contradicted, `null` not runnable (with the reason). */
  readonly ok: boolean | null
  /** The one-line outcome a reader can act on. */
  readonly reason: string
  /** The raw observation behind the row, never a summary of it. */
  readonly raw: string
}

/**
 * Print the one standard marker line (FIRST on stdout) and exit: SKIP under no strict flag, FAIL under
 * either strict spelling. Every prerequisite-independent arm has already run by this point.
 *
 * @param lane - the lane the marker names (`self-test` or `real`).
 * @param prereq - the observed absent prerequisite.
 * @returns never; the function exits.
 */
function gate(lane: string, prereq: Prereq): never {
  console.log(`[mpd-qa] ${STRICT ? "FAIL" : "SKIP"} case=${SLUG} lane=${lane} reason=${prereq.reason} prereq=${prereq.prereq} remedy="${prereq.remedy}"`)
  /** The human-readable follow-up, routed to stderr for a FAIL and to stdout for a SKIP. */
  const prose = `[${SLUG}] prerequisite absent (${prereq.prereq}); ${STRICT ? "failing (strict flag)" : "skipping (not a failure)"}`
  if (STRICT) console.error(prose)
  else console.log(prose)
  process.exit(STRICT ? 1 : 0)
}

/** The dsh launcher prerequisite: no harness on PATH means this lane cannot boot anything. */
const DSH_PREREQ: Prereq = { reason: "absent-dsh-binary", prereq: "dsh", remedy: "install DeepSeek Harness (dsh) on PATH" }

/**
 * The credential prerequisite for the declared provider.
 *
 * @param resolution - the resolved credential, present or not.
 * @returns the record the marker prints, or `null` when the credential is present.
 */
function credentialPrereq(resolution: CredentialResolution): Prereq | null {
  if (resolution.present) return null
  return {
    reason: "absent-credentials",
    prereq: resolution.keyName,
    remedy: "export " + resolution.keyName + " in the launching shell, or add `refs: " + resolution.keyName + ": <value>` to ~/.dsh/.credentials.yaml",
  }
}

/**
 * The offline self-test: every arm this case rests on that needs no model, no network and no boot.
 *
 * @returns the number of failing assertions (0 is a pass).
 */
function selfTest(): number {
  /** Every failing arm's message, printed together so one run reports all of them. */
  const failures: string[] = []
  /**
   * Assert one arm.
   * @param ok Whether the arm held.
   * @param what The arm's description, printed when it failed.
   */
  const check = (ok: boolean, what: string): void => { if (!ok) failures.push(what) }

  // ── the row the boots depend on is composed exactly once ──────────────────────────────────────
  /** The bundle patch, which must carry the roles row this case boots. */
  const bundle = readFileSync(join(repoRoot, "cordis.patch.yml"), "utf8")
  /** How many times the row id appears as an entry id (a duplicate id is fatal to the loader). */
  const rowOccurrences = bundle.split("- id: mpd-roles").length - 1
  check(rowOccurrences === 1, "the mpd-roles row id must appear exactly once in cordis.patch.yml, found " + String(rowOccurrences))

  // ── the WITHDRAWAL, pinned on the SHIPPED SOURCE ──────────────────────────────────────────────
  // The source is the subject, not `dist/**`: the wave's rebuild task refreshes the built bytes in its
  // own commit, and a self-test that needed the rebuild to land first could not run in this lane at all.
  /** The row's apply site, which owns the ONE install site of every guard. */
  const applySite = readFileSync(APPLY_SITE, "utf8")
  for (const install of WITHDRAWN_INSTALLS) {
    check(!applySite.includes(install), "the shipped apply site still installs " + install + ": the 2026-10-17 withdrawal regressed")
  }
  for (const token of [ABSENT_VERIFY, ABSENT_INVESTIGATION, ABSENT_DELEGATION]) {
    check(applySite.includes(token), "the shipped apply site no longer reports " + token + " — a withdrawn guard must keep reporting its absence")
  }
  check(applySite.includes(SESSION_GATE_OFF.replace("=off", "=")), "the shipped apply site no longer reports the sessionGate token")

  // ── the session gate is OPT-IN: an absent config value reads `off` ────────────────────────────
  check(resolveGateMode(undefined) === GATE_MODE_OFF, "the session gate's default must read `off` after the rollback (an absent key arms nothing)")

  // ── this case is REGISTERED: the skill's case table names it ──────────────────────────────────
  /** The QA skill document whose case table registers every case in this corpus. */
  const skill = readFileSync(join(repoRoot, "skills", "dsh-qa", "SKILL.md"), "utf8")
  check(skill.includes("| " + SLUG + " |"), "the dsh-qa SKILL.md case table must carry a row for " + SLUG)

  for (const message of failures) console.error("[" + SLUG + " self-test] FAIL: " + message)
  if (failures.length > 0) return failures.length
  console.log("[" + SLUG + " self-test] ok: row composed once; three installs withdrawn with absent tokens; session gate defaults off; case registered")
  return 0
}

/** The first non-empty line of one text, trimmed — the needle the read arm looks for. */
function firstLineOf(text: string): string {
  for (const line of text.split(/\r?\n/u)) {
    /** The line with its ends trimmed, which is what a reader would quote back. */
    const trimmed = line.trim()
    if (trimmed !== "") return trimmed
  }
  return ""
}

/** One live run's decoded evidence: what the harness recorded, what it offered, and what landed. */
interface LiveOutcome {
  /** The child's exit status, `null` when it was killed by the timeout. */
  readonly exit: number | null
  /** Every tool the harness SHOWED the model, from the request headers. */
  readonly toolNames: readonly string[]
  /** The `read` call evidence for the source path. */
  readonly sourceRead: { called: boolean; succeeded: boolean; resultText: string }
  /** The `write` call evidence for the code path. */
  readonly codeWrite: { called: boolean; succeeded: boolean; resultText: string }
  /** The `bash` call evidence. */
  readonly shell: { called: boolean; succeeded: boolean; resultText: string }
  /** Whether `mpd_verify_open` was ever called (it must NOT be: this case runs with no loop armed). */
  readonly loopOpened: boolean
  /** The roles row's log text (the boot line lives there, not on stdout). */
  readonly rowLog: string
  /** The child's own output, kept in the evidence directory. */
  readonly output: string
}

/**
 * Drive ONE headless boot in the sandbox and decode its evidence from the ROW LOG and the session log.
 *
 * The child's stdio goes to a FILE (§7's shell caveat: long-lived MCP children inherit fds and a pipe
 * can hang), so a killed child still leaves everything it printed.
 *
 * @param sandbox - the isolated DSH_HOME.
 * @param ws - the sandbox workspace (its own session store key).
 * @param prompt - the task text handed to the headless session.
 * @param env - the child environment (sandbox home pair plus the resolved credential).
 * @param logFile - the file the child's own output is written to.
 * @returns what the run recorded; the caller asserts on the fields.
 */
function runOnce(sandbox: string, ws: string, prompt: string, env: Env, logFile: string): LiveOutcome {
  /** The resolved launcher invocation, or `null` when no launcher is installed. */
  const spec = dshCommand(["--profile", "mpd-headless", prompt], env)
  if (spec === null) throw new Error(DSH_MISSING)
  /** The open descriptor both of the child's output streams land on, closed in the `finally` below. */
  const fd = openSync(logFile, "w")
  /** The child's own result, kept so the record reports the REAL exit status. */
  let status: number | null = null
  try {
    /** The boot itself: a hard timeout, because a hung child must not hang the evidence. */
    const run = spawnSync(spec.command, spec.args, { env, cwd: ws, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000, stdio: ["ignore", fd, fd] })
    status = run.status
  } finally {
    closeSync(fd)
  }
  /** The harness's records for THIS workspace, decoded frame by frame (T-25). */
  const events = readSessionEvents(sandbox, { workspace: ws })
  // THE RAW TOOL RECORDS ARE KEPT AS EVIDENCE: every verdict below rests on this decode, so a reader can
  // re-derive the numbers independently instead of trusting this script's summary.
  writeFileSync(logFile.replace(/\.log$/, "-records.json"), JSON.stringify(
    events.records.filter((record) => record["type"] === "tool/call" || record["type"] === "tool/result"), null, 1), "utf8")
  /** The row log the boot line lands in (R5: `<ws>/.mpd/logs/mpd-roles.log`, never stdout). */
  const rowLogPath = join(ws, ROW_LOG)
  /** The row log's text, or the empty string when the row never wrote one. */
  const rowLog = existsSync(rowLogPath) ? readFileSync(rowLogPath, "utf8") : ""
  // The row log is copied into the evidence too: it lives in a fresh sandbox that this process's exit
  // discards, and the boot line is the registration instrument for the guard state.
  writeFileSync(logFile.replace(/\.log$/, "-rowlog.log"), rowLog, "utf8")
  /** The harness's own `read` evidence. */
  const read = findToolCall(events, "read")
  /** The harness's own `write` evidence. */
  const write = findToolCall(events, "write")
  /** The harness's own `bash` evidence. */
  const bash = findToolCall(events, "bash")
  /** The harness's own `mpd_verify_open` evidence — its ABSENCE is what "no loop armed" means. */
  const verifyOpen = findToolCall(events, "mpd_verify_open")
  /** The tool names the request headers offered, the ground truth for "the tool is mounted". */
  const toolNames = events.records
    .filter((record) => record["type"] === "request/header")
    .flatMap((record) => {
      /** The header object of this request record, when it is a plain object. */
      const header = (record["data"] as { header?: { tools?: unknown } } | undefined)?.header
      return Array.isArray(header?.tools) ? header.tools.map((tool) => String((tool as { name?: unknown })?.name ?? "")) : []
    })
    .filter((name) => name !== "")
  return {
    exit: status,
    toolNames,
    sourceRead: { called: read.called, succeeded: read.succeeded, resultText: read.resultText },
    codeWrite: { called: write.called, succeeded: write.succeeded, resultText: write.resultText },
    shell: { called: bash.called, succeeded: bash.succeeded, resultText: bash.resultText },
    loopOpened: verifyOpen.called,
    rowLog,
    output: readFileSync(logFile, "utf8"),
  }
}

/**
 * The live lane: ONE isolated boot, judged from the harness session log, the filesystem and the row log.
 *
 * @returns never; the process exits 0 on PASS and 1 on any failed arm.
 */
function runReal(): void {
  // A dist that does not carry the row would make the boot below prove NOTHING while looking green, so
  // the artifact is asserted BEFORE a model call is spent.
  /** The built roles row this boot loads. */
  const rolesDist = join(repoRoot, "packages", "mpd-roles-plugin", "dist", "index.js")
  if (!existsSync(rolesDist)) gate("real", { reason: "absent-runtime", prereq: "packages/mpd-roles-plugin/dist/index.js", remedy: REBUILD_COMMAND })
  // The declared credential, resolved POSITIVELY through the shared tiers (never assumed).
  /** The credential's resolved state, which never carries a secret value. */
  const resolution = resolveProviderCredential({ provider: PROVIDER })
  /** The absent-credential record, or `null` when the key resolved. */
  const missing = credentialPrereq(resolution)
  if (missing !== null) gate("real", missing)
  if (dshCommand(["--version"], process.env) === null) gate("real", DSH_PREREQ)

  /** The run's timestamp, which names the evidence directory. */
  const ts = new Date().toISOString().replaceAll(":", "-")
  /** The evidence directory this run writes its verdict and logs into. */
  const outDir = join(repoRoot, "evidence", "roles", SLUG, ts)
  /** The directory holding the boot's logs. */
  const logsDir = join(outDir, "logs")
  mkdirSync(logsDir, { recursive: true })

  /** The sandbox DSH_HOME the isolated profile is installed into. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-captain-full-tools-"))
  /** The sandbox HOME, which is what keeps skill roots out of the real home. */
  const sandboxHome = join(sandbox, "home")
  mkdirSync(sandboxHome, { recursive: true })
  seedSandboxCredentials(sandbox, { provider: PROVIDER })
  // The declared settings file, copied when present so a gateway-configured model chain still resolves.
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) writeFileSync(join(sandbox, "settings.yaml"), readFileSync(settings))
  /** The child environment: the sandbox home pair plus the resolved provider credential. */
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: sandboxHome })
  if (env.DSH_HOME !== sandbox || env.HOME !== sandboxHome) {
    console.error("[" + SLUG + "] FAIL: isolation assertion failed (DSH_HOME/HOME not the sandbox pair)")
    process.exit(1)
  }
  /** The REAL checkout's row log before the run, hashed so the lane proves it wrote nothing there. */
  const realRowLog = join(repoRoot, ROW_LOG)
  /** The digest of that file before the run, or `"absent"` when it does not exist. */
  const realRowLogBefore = existsSync(realRowLog) ? createHash("sha256").update(readFileSync(realRowLog)).digest("hex") : "absent"

  /** The sandbox WORKSPACE, whose source path is a COPY so the real tree is never the subject. */
  const ws = sandboxWorkspace(sandbox)
  /** The copied source file's path inside the sandbox workspace. */
  const sandboxSource = join(ws, SOURCE_PATH)
  mkdirSync(dirname(sandboxSource), { recursive: true })
  cpSync(SOURCE_ORIGIN, sandboxSource)
  /** The needle the read arm looks for: the copied source's OWN first line. */
  const needle = firstLineOf(readFileSync(sandboxSource, "utf8"))

  /** The isolated profile install, which materializes the sandbox profile the boot reads. */
  const install = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.ts"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env, cwd: repoRoot, encoding: "utf8", timeout: 600000 })
  writeFileSync(join(logsDir, "install-profile.log"), (install.stdout || "") + (install.stderr || ""), "utf8")
  if (install.status !== 0) {
    console.error("[" + SLUG + "] FAIL: install-profile.ts exited " + String(install.status) + " (see logs/install-profile.log)")
    process.exit(1)
  }

  // THE PROMPT FORCES THE THREE CALLS, so the lane measures the mounted pack and not the model's taste.
  /** The task handed to the headless session. */
  const prompt = "Call the read tool with file_path \"" + SOURCE_PATH + "\" and paste the first line of what it returns. "
    + "Then call the write tool with file_path \"" + CODE_PATH + "\" and content \"// probe\\n\". "
    + "Then call the bash tool with command \"echo captain-probe\" and paste its output. "
    + "Do not call any other tool. Then answer in one short line."
  /** The boot's recorded outcome. */
  const run = runOnce(sandbox, ws, prompt, env, join(logsDir, "boot.log"))
  // The isolation verdict: every session-store key belongs to a sandbox workspace.
  const isolation = assertSessionsSandboxed(sandbox, sandbox, { label: SLUG })
  /** The REAL checkout's row log after the run, for the untouched assertion. */
  const realRowLogAfter = existsSync(realRowLog) ? createHash("sha256").update(readFileSync(realRowLog)).digest("hex") : "absent"
  /** The ONE team-plane boot line, quoted into the record so a reader sees the reported state. */
  const bootLine = run.rowLog.split("\n").find((line) => line.includes("team plane:")) ?? ""
  /** Whether the sandbox workspace carries the written code artifact. */
  const codeWritten = existsSync(join(ws, CODE_PATH))
  /** Whether any loop record was created in the sandbox (a loop must NOT be armed for this case). */
  const loopFiles = ((): readonly string[] => {
    /** The loops directory the verify row's tools write into. */
    const loopsDir = join(ws, ".mpd", "verify", "loops")
    if (!existsSync(loopsDir)) return []
    try {
      return readdirSync(loopsDir)
    } catch {
      // An unreadable loops directory is reported as ONE entry, so it can never read as "no loop armed".
      return ["<unreadable>"]
    }
  })()

  /** Every acceptance row this run produces. */
  const rows: Row[] = []
  /** The raw observation quoted into more than one row. */
  const rawBase = "exit=" + String(run.exit) + " offered=" + String(run.toolNames.length) + " bootLine=" + JSON.stringify(bootLine)
  rows.push({
    name: "boot-completed",
    ok: run.exit === 0,
    reason: run.exit === 0 ? "the headless boot exited 0 (the session really completed its turn)" : "the headless boot did not exit 0, so the records below describe a broken run: " + String(run.exit),
    raw: rawBase,
  })
  rows.push({
    name: "corroborative-pack-offered",
    ok: ENGINE_TOOLS.every((name) => run.toolNames.includes(name)) ? true : null,
    reason: (ENGINE_TOOLS.every((name) => run.toolNames.includes(name))
      ? "CORROBORATIVE: the request header offers the whole pack: " + ENGINE_TOOLS.join(", ")
      : "the harness recorded no request header / the pack is incomplete — offered: " + JSON.stringify(run.toolNames.slice(0, 40)))
      + " (the same list is offered before and after the rollback; the boot-line arm below is the discriminator)",
    raw: rawBase + " missing=" + JSON.stringify(ENGINE_TOOLS.filter((name) => !run.toolNames.includes(name))),
  })
  rows.push({
    name: "corroborative-source-read",
    ok: run.sourceRead.called ? (run.sourceRead.succeeded && run.sourceRead.resultText.includes(needle)) : null,
    reason: (!run.sourceRead.called
      ? "the model never called `read` (answer-only narration is not tool evidence)"
      : !run.sourceRead.succeeded
        ? "the `read` call did not answer a non-error result"
        : run.sourceRead.resultText.includes(needle)
          ? "CORROBORATIVE: the source path was READ — a non-error result carries the file's own first line"
          : "the `read` call answered, but its text does not carry the source's first line")
      + " (a headless boot composes no agent preset, so this arm reads before and after the withdrawal)",
    raw: rawBase + " needle=" + JSON.stringify(needle) + " readResult=" + JSON.stringify(run.sourceRead.resultText.slice(0, 400)),
  })
  rows.push({
    name: "corroborative-code-write-no-loop",
    ok: run.codeWrite.called ? (codeWritten && !run.loopOpened && loopFiles.length === 0) : null,
    reason: (!run.codeWrite.called
      ? "the model never called `write` (answer-only narration is not tool evidence)"
      : run.loopOpened || loopFiles.length > 0
        ? "a verification loop WAS armed in this session, so the write cannot witness the no-loop path"
        : codeWritten
          ? "CORROBORATIVE: the code path was WRITTEN with no loop armed (no `mpd_verify_open`, no loop record)"
          : "the `write` call was recorded but the artifact does not exist")
      + " (agent-scoped guards never arm in a headless boot: the withdrawal is proved by the boot line)",
    raw: rawBase + " codeWritten=" + String(codeWritten) + " loopOpened=" + String(run.loopOpened) + " loopFiles=" + JSON.stringify(loopFiles) + " writeResult=" + JSON.stringify(run.codeWrite.resultText.slice(0, 400)),
  })
  rows.push({
    name: "corroborative-shell",
    ok: run.shell.called ? (run.shell.succeeded && run.shell.resultText.includes("captain-probe")) : null,
    reason: (!run.shell.called
      ? "the model never called `bash` (answer-only narration is not tool evidence)"
      : run.shell.succeeded && run.shell.resultText.includes("captain-probe")
        ? "CORROBORATIVE: `bash` ran and answered with its own output"
        : "the `bash` call did not answer the echoed marker")
      + " (same bound as the two arms above)",
    raw: rawBase + " shellResult=" + JSON.stringify(run.shell.resultText.slice(0, 400)),
  })
  rows.push({
    name: "DISCRIMINATING-guard-state-reported",
    ok: [ABSENT_VERIFY, ABSENT_INVESTIGATION, ABSENT_DELEGATION, SESSION_GATE_OFF].every((token) => bootLine.includes(token)),
    reason: [ABSENT_VERIFY, ABSENT_INVESTIGATION, ABSENT_DELEGATION, SESSION_GATE_OFF].every((token) => bootLine.includes(token))
      ? "DISCRIMINATING: the boot line reports the three withdrawn guards as absent and the session gate as off"
      : "the boot line does not report the withdrawn state (a stale dist still prints modes — rebuild it: " + REBUILD_COMMAND + ")",
    raw: JSON.stringify(bootLine),
  })
  rows.push({
    name: "isolation-sessions-sandboxed",
    ok: isolation.ok,
    reason: isolation.ok ? "ok: " + String(isolation.keys.length) + " session-store key(s), all under the sandbox" : "a session-store key leaked outside the sandbox",
    raw: JSON.stringify(isolation),
  })
  rows.push({
    name: "isolation-real-checkout-untouched",
    ok: realRowLogBefore === realRowLogAfter,
    reason: realRowLogBefore === realRowLogAfter ? "the real checkout's row log is byte-identical across the run" : "the real checkout's row log CHANGED during the run",
    raw: "before=" + realRowLogBefore + " after=" + realRowLogAfter,
  })

  /** Every row's verdict folded into the run's exit code; a `null` row is not a pass. */
  const allOk = rows.every((row) => row.ok === true)
  /** The credential descriptor, which carries presence/source and never a secret value. */
  const descriptor = credentialDescriptor(resolution)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({
    ok: allOk,
    slug: SLUG,
    startedAt: ts,
    sandbox,
    credential: descriptor,
    bootLine,
    rows,
  }, null, 2) + "\n", "utf8")
  writeFileSync(join(outDir, "output.log"), "# captain-full-tools live lane " + ts + "\nsandbox: " + sandbox + "\ncredential: " + JSON.stringify(descriptor) + "\n\n" + run.output, "utf8")

  for (const row of rows) console.log("[" + SLUG + "] " + (row.ok === true ? "ok  " : row.ok === null ? "SKIP" : "FAIL") + " " + row.name + " — " + row.reason)
  console.log("[" + SLUG + "] evidence -> " + outDir)
  if (!allOk) process.exit(1)
  console.log("[" + SLUG + "] PASS (" + String(rows.length) + " rows)")
}

// The two lanes: the offline self-test, and the real isolated run.
if (process.argv.includes("--self-test")) process.exit(selfTest())
else runReal()
