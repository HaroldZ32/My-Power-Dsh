#!/usr/bin/env node
// Case verify-law: the A-writes/B-verifies law, REPURPOSED for the 2026-10-17 rollback.
//
// WHY THIS CASE CHANGED (repurposed, never silently deleted — `.mpd/plans/harness-021-rollback.md` R7):
// until 2026-10-10/11 the `mpd-roles` row installed a `tools.guard` that DENIED the top-level mpd
// agent's `write` on a code path unless a verification loop was armed, and this case asserted that
// denial, its `verify.mode: "off"` negative control and the `docs/**` allowance. The user's ruling
// withdrew the ceremony (R1: one agent, its whole tool pack, steered by the persona prompt), so the OLD
// assertions described a surface that no longer exists — keeping them would fail a CORRECT tree.
// The case now asserts the NEW behaviour and keeps the falsifiable shape.
//
// WHAT EACH ARM IS WORTH — the two tiers are named so no reader mistakes one for the other (the SAME
// distinction `captain-scope.ts` draws, because one suite must not carry two opposite claims):
//   * DISCRIMINATING, offline: the SHIPPED apply site no longer calls `installVerifyGuard(` and still
//     prints `verifyGate=absent reason=…` (asserted against src, never against stale dist bytes), plus
//     the boot line's absent token in the live run below.
//   * DISCRIMINATING, the boot line: the roles row reports the withdrawal on its own apply site, and a
//     pre-withdrawal dist prints a MODE there — so that arm reddens on a returned guard.
//   * CORROBORATIVE, RUN A and RUN B: a one-shot HEADLESS boot NEVER composes an agent preset
//     (`@deepseek-ai/dsh-headless` `assertAdoptable` refuses it) and the withdrawn guards were
//     AGENT-SCOPED, so those runs pass IDENTICALLY before and after the rollback. They witness that the
//     captain's pack is callable on THIS composition — never that the guard is gone. MEASURED by the
//     verification lane on pre-wave 0.2.0 and 0.2.1: read-source + write-code already worked headless with
//     `verifyGate=installed captainInvestigation=deny` on the boot line.
//   * the `mpd-verify` row still MOUNTS: it writes its own sandbox boot marker, and its five
//     `mpd_verify_*` tools still register (asserted offline against the built dist). The law's
//     BOOKKEEPING surface is still shipped — only the mechanical WRITE GUARD is gone, and a real boot
//     (never `--dump-config`, which proves COMPOSITION ONLY and would pass with the row's apply
//     aborting) is what can distinguish the two;
//   * RUN A (CORROBORATIVE): with NO loop armed, the top-level mpd agent's `write` on a code path LANDS —
//     the harness records the call AND the artifact exists on disk. Both halves are asserted because the
//     harness pairs a guard-BLOCKED call with a result it does not error-flag (measured 2026-10-07), so
//     "a write was recorded" alone would pass a denied one. Per the bound above, this arm corroborates
//     the pack on a headless composition; it cannot by itself detect a returned guard;
//   * RUN B (CORROBORATIVE, the retired knob's own arm): the SAME sandbox with `verify.mode: "hard"` — the
//     spelling that used to be the strictest denial — still lets the write land. That the KNOB is inert
//     IS discriminating on the apply site (nothing installs the reader), which is why the offline arm
//     pins it there and this run only witnesses the same outcome end to end;
//   * the roles row's boot line reports `verifyGate=absent reason=…`: the withdrawn state is REPORTED,
//     never faked as a mode, and a stale pre-withdrawal dist reddens this arm on purpose;
//   * three-layer isolation (§7) and the REAL workspace's marker untouched (unchanged obligations).
//
// WHAT IT DOES NOT PROVE, stated so nobody over-reads it: it does not prove the `mpd_verify_*` TOOLS
// work end to end (the package's own suite and the record validator's arms do that), it does not prove
// the roster read-only guard — a DIFFERENT guard, exercised by its own unit arms and by the
// `readonly-deny` case — and, per the bound above, RUN A/B cannot prove an agent-scoped guard is
// absent, because a headless boot never composes one. Read the boot line, not the runs, for that.
//
// ISOLATION, all three layers (§7): an isolated `DSH_HOME`, a sandbox `HOME`, and a sandbox WORKSPACE
// (`sandboxWorkspace`), with `assertSessionsSandboxed` asserting that no real-cwd session key exists.
// Evidence -> evidence/gates/verify-law/<UTC>/{result.json,output.log} (+ per-run logs).
//
// --self-test is OFFLINE: the patch row, the built dists' symbols, the SHIPPED apply site's withdrawal
// and the package's own decision arms.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** The repository root, derived from this script's own URL (four directories up). */
const repoRoot: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The case slug, which prefixes every failure banner and names the evidence slug. */
const SLUG: string = "verify-law"
/** The five tools the row must register, as the mount arm's subject. */
const TOOLS: readonly string[] = ["mpd_verify_open", "mpd_verify_escape", "mpd_verify_seat", "mpd_verify_evidence", "mpd_verify_record"]
/** The code path RUN A and RUN B write; the whole case is that it LANDS now. */
const CODE_PATH: string = "packages/mpd-verify-plugin/src/probe-allowed.ts"
/** The real workspace marker the isolation arm asserts is untouched. */
const REAL_MARKER: string = join(repoRoot, ".mpd", "verify", "boot.json")
/** The shipped apply site whose withdrawal the offline arm pins. */
const APPLY_SITE: string = join(repoRoot, "packages", "mpd-roles-plugin", "src", "index.ts")
/** The install call a return of the withdrawal would have to reintroduce. */
const WITHDRAWN_INSTALL: string = "installVerifyGuard("
/** The boot-line spelling the withdrawn guard must keep reporting (never a mode). */
const ABSENT_TOKEN: string = "verifyGate=absent reason="

// THE SHARED QA HARNESS is resolved RELATIVE TO THE REPOSITORY ROOT rather than to this file, so the case
// behaves identically where it is authored (`packages/mpd-verify-plugin/qa/`) and where the wave's single
// `skills/**` writer places it (`skills/dsh-qa/scripts/`). A static `./lib/...` import would bind this
// file to one of those two directories and silently break the other.
/** The QA library directory, derived from the repository root. */
const QA_LIB: string = join(repoRoot, "skills", "dsh-qa", "scripts", "lib")
/** The credentials helpers (`credentialEnv`, `seedSandboxCredentials`). */
// EVERY import below is a FILE URL, never the bare path (win32 defect, MEASURED 2026-10-12): node's
// ESM loader refuses an absolute Windows path — it parses the drive letter as a URL scheme and dies
// with `ERR_UNSUPPORTED_ESM_URL_SCHEME … Received protocol 'c:'` before this script runs a single arm,
// so the whole law falsifier was unavailable on win32. `pathToFileURL` is the conversion.
const credentialsLib = await import(pathToFileURL(join(QA_LIB, "credentials.ts")).href) as {
  /** Resolve the credential key for a child environment. */
  credentialEnv: (env: Record<string, string | undefined>) => Record<string, string | undefined>
  /** Copy the real credentials into an isolated home. */
  seedSandboxCredentials: (sandbox: string, options: { credentialsFile: string }) => void
}
/** The launcher resolver, so a win32 `.cmd` shim is handled rather than ENOENT. */
const launcherLib = await import(pathToFileURL(join(QA_LIB, "dsh-launcher.ts")).href) as {
  /** The actionable sentence a lane reports when no launcher resolves. */
  DSH_MISSING: string
  /** The `{command, args}` pair for one `dsh` invocation, or `null` when nothing resolves. */
  dshCommand: (args: string[], env: Env) => { command: string; args: string[] } | null
}
/** The three-layer isolation helpers (§7). */
const isolationLib = await import(pathToFileURL(join(QA_LIB, "workspace-isolation.ts")).href) as {
  /** Create (and return) the sandbox workspace directory inside one sandbox. */
  sandboxWorkspace: (sandbox: string, name?: string) => string
  /** Assert that no session was keyed on a real cwd. */
  assertSessionsSandboxed: (dshHome: string, sandboxRoot: string, options?: { label?: string }) => unknown
}
/** The session-log decoder: the ONLY accepted source of a tool-call proof (§7). */
const evidenceLib = await import(pathToFileURL(join(QA_LIB, "session-evidence.ts")).href) as {
  /** Read and decode one sandbox's session records. */
  readSessionEvents: (dshHome: string, options?: { workspace?: string }) => unknown
  /** Pair the recorded calls of one tool name with their results. */
  findToolCall: (events: unknown, name: string) => {
    /** Whether any `tool/call` for that name was recorded. */
    called: boolean
    /**
     * Whether at least one recorded call has a NON-ERROR `tool/result` — the reader's own declared
     * field (`ToolCallEvidence.succeeded` in `lib/session-evidence.ts`).
     *
     * MEASURED SURPRISE, stated so nobody "fixes" it back: the harness paired a guard-DENIED call with a
     * result it did NOT mark as an error, so `succeeded === true` while the write never landed. That is
     * why this case's arms assert the ARTIFACT (`codeWritten`) as the primary signal and keep this flag
     * REPORTED-only: it cannot tell an allowed write from a blocked one on its own.
     */
    succeeded: boolean
    /** Every recorded call, with its raw arguments. */
    calls: Array<{ callId: string | undefined; arguments: unknown }>
    /** The joined text of every recorded `tool/result` block. */
    resultText: string
  }
}
/** One child-process environment: the `process.env` shape, where any key may be absent. */
type Env = Record<string, string | undefined>

/** Report one failed assertion and end the run with exit 1; never returns. */
function fail(msg: string): never { console.error("[" + SLUG + "] FAIL: " + msg); process.exit(1) }

/**
 * The offline arm: the patch row, the built symbols and the package's own decision arms.
 *
 * It NEVER boots a harness, so it stays green on a machine with no credential — and it is deliberately
 * blind to the very thing the live arm exists for (a row that aborts during apply).
 */
function selfTest(): void {
  /** The bundle patch, which must carry the row. */
  const bundle = readFileSync(join(repoRoot, "cordis.patch.yml"), "utf8")
  if (!bundle.includes("mpd-verify")) fail("the bundle patch carries no mpd-verify row")
  // THE ROW ID MUST BE UNIQUE: a duplicate entry id is fatal to the loader, so the row is counted.
  /** How many times the row id appears as an entry id. */
  const occurrences = bundle.split("- id: mpd-verify").length - 1
  if (occurrences !== 1) fail("the mpd-verify row id appears " + occurrences + " times (exactly one is required)")
  // THE BUILT ARTEFACTS, whose bytes are what a mount actually loads.
  /** The built verify plugin. */
  const verifyDist = readFileSync(join(repoRoot, "packages", "mpd-verify-plugin", "dist", "index.js"), "utf8")
  for (const tool of TOOLS) if (!verifyDist.includes(tool)) fail("the built mpd-verify dist carries no " + tool)
  // THE WITHDRAWAL, pinned on the SHIPPED SOURCE (never on dist bytes, which the wave's rebuild task
  // refreshes in its own commit): the apply site must no longer install the guard, and it must still
  // report the absent state instead of dropping the token silently. THIS ARM REPLACES, for the same
  // subject, the old assertion that the built roles dist CARRIES the guard's denial sentence — that
  // sentence is gone with the install, so asserting it now would fail a correct tree.
  /** The row's apply site, which owns the one install site of every guard. */
  const applySite = readFileSync(APPLY_SITE, "utf8")
  if (applySite.includes(WITHDRAWN_INSTALL)) fail("the shipped apply site still installs the write guard (" + WITHDRAWN_INSTALL + "): the 2026-10-17 withdrawal regressed")
  if (!applySite.includes(ABSENT_TOKEN)) fail("the shipped apply site no longer reports " + ABSENT_TOKEN + " — a withdrawn guard must keep reporting its absence, never drop the token")
  // The built roles row is still asserted to CARRY the token: the boot line is how a mount lane reads
  // the state. WHICH value it carries is the live arm's subject, not this one's.
  /** The built roles plugin whose boot line names the token. */
  const rolesDist = readFileSync(join(repoRoot, "packages", "mpd-roles-plugin", "dist", "index.js"), "utf8")
  if (!rolesDist.includes("verifyGate")) fail("the built mpd-roles dist does not report verifyGate")
  // THE RECORD VALIDATOR'S REFUSAL VOCABULARY, which is the actual guarantee.
  for (const reason of ["same-agent", "no-doc-sources", "no-gate-evidence", "forged-evidence", "bind-unproven", "fail-without-findings", "finding-without-basis", "blind-spent", "pre-plugin-unattested", "post-install-claim"]) {
    if (!verifyDist.includes(reason)) fail("the built dist carries no refusal reason " + reason)
  }
  // THE RETIRED-TWIN ARM (repurposed 2026-10-17, with the twin's retirement): the case body used to exist
  // TWICE — an authored copy under `packages/mpd-verify-plugin/qa/` and this registered one — kept
  // byte-identical by a sha256 arm. The twin was RETIRED when the case was re-purposed for the guard
  // withdrawal (see `packages/mpd-verify-plugin/qa/RETIRED.md`): this skill copy is now the ONLY body, and
  // a second copy would drift from a directory no `skills/**` writer may maintain. The arm therefore
  // asserts the twin stays ABSENT rather than asserting a copy that no longer should exist — a well-meant
  // re-copy must fail loudly here instead of silently re-introducing a second body.
  /** The retired authored twin's path. */
  const retiredTwin = join(repoRoot, "packages", "mpd-verify-plugin", "qa", "verify-law.ts")
  if (existsSync(retiredTwin)) {
    fail("the retired authored twin came BACK at " + retiredTwin
      + " — this registered copy is the only body (its reason is recorded in packages/mpd-verify-plugin/qa/RETIRED.md)")
  }
  // THE PACKAGE'S OWN ARMS: the decision table, the refusal table and the row's integration arm.
  /** The unit suite's result. */
  const suite = spawnSync("bun", ["test", "packages/mpd-verify-plugin"], { cwd: repoRoot, encoding: "utf8", timeout: 300000 })
  if (suite.status !== 0) fail("the package's own arms are red\n" + (suite.stdout || "") + (suite.stderr || ""))
  console.log("[" + SLUG + " self-test] ok: patch row + dist symbols + refusal vocabulary + decision/row arms")
}

/** One live run's outcome: what the harness recorded, and what landed on disk. */
interface RunOutcome {
  /** The child's exit status. */
  exit: number | null
  /** Whether a `write` tool call for the CODE path was recorded. */
  codeCalled: boolean
  /** Whether at least one recorded result for that call was a NON-ERROR `tool/result`. */
  callSucceeded: boolean
  /** Whether the CODE path exists in the sandbox workspace afterwards — the case's whole point. */
  codeWritten: boolean
  /** The combined child output, kept for the evidence log. */
  output: string
}

/**
 * Drive ONE headless run in the sandbox and read its evidence from the SESSION LOG plus the filesystem.
 * @param task The task text handed to the headless session.
 * @param sandbox Absolute path of the isolated DSH_HOME.
 * @param ws Absolute path of the sandbox workspace the session runs in.
 * @param env The child environment (sandbox home plus the resolved credential key).
 * @returns what the run recorded, never a thrown error — the caller asserts on the fields.
 */
function runOnce(task: string, sandbox: string, ws: string, env: Env): RunOutcome {
  /** The resolved launcher invocation, or `null` when no launcher is installed. */
  const spec = launcherLib.dshCommand(["--profile", "mpd-headless", task], env)
  if (spec === null) fail(launcherLib.DSH_MISSING)
  /** The headless run: stdio to PIPES with a hard timeout, because a hung child must not hang the case. */
  const run = spawnSync(spec.command, spec.args, { env, cwd: ws, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 900000, stdio: ["ignore", "pipe", "pipe"] })
  /** The child's combined output, which is what the evidence log keeps. */
  const output = (run.stdout || "") + (run.stderr || "")
  // THE SESSION LOG IS THE EVIDENCE, never the model's prose (§7): `tool/call` plus a `tool/result`.
  /** The harness's own records for this workspace, decoded frame by frame. */
  const events = evidenceLib.readSessionEvents(sandbox, { workspace: ws })
  /** The recorded `write` calls and their joined result text. */
  const write = evidenceLib.findToolCall(events, "write")
  return {
    exit: run.status,
    // The call must name THIS case's probe file, so a write to some other path cannot satisfy the arm.
    codeCalled: write.calls.some((call): boolean => JSON.stringify(call.arguments ?? {}).includes("probe-allowed")),
    callSucceeded: write.succeeded,
    // THE RELIABLE HALF (measured 2026-10-07): a guard-blocked call is recorded with a result the harness
    // does NOT error-flag, so the artifact's presence is what distinguishes an allowed write from a
    // denied one. Kept as the primary signal, with the recorded call as its precondition.
    codeWritten: existsSync(join(ws, CODE_PATH)),
    output,
  }
}

/** The live case: install the bundle into a sandbox home, then drive the three runs. */
function runReal(): void {
  /** The real credential store the sandbox copy is seeded from. */
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials at " + creds)
  // LAYER 1: an isolated DSH_HOME. Never the real ~/.dsh.
  /** The throwaway harness home. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-verify-law-"))
  credentialsLib.seedSandboxCredentials(sandbox, { credentialsFile: creds })
  // A gateway-configured chain lives in settings.yaml; without the copy the sandbox falls back to the
  // base route and the boot dies with MISSING_CREDENTIAL (§7, measured 2026-09-14).
  /** The real settings file, when the deployment has one. */
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
  // LAYER 2: a sandbox HOME, so skill roots and the workmate library are never the real ones.
  /** The environment the child gets: the sandbox home as DSH_HOME *and* HOME. */
  const env: Env = { ...credentialsLib.credentialEnv({ ...process.env, DSH_HOME: sandbox }), HOME: sandbox }
  // LAYER 3: a sandbox WORKSPACE — DSH_HOME/HOME do NOT isolate workspace state, and this law's whole
  // subject is workspace state (`.mpd/verify/**`).
  /** The sandbox workspace the session runs in. */
  const ws = isolationLib.sandboxWorkspace(sandbox)
  /** The instant this case started, which names its evidence directory. */
  const startedAt = new Date().toISOString()
  /** The evidence directory. */
  const outDir = join(repoRoot, "evidence", "gates", SLUG, startedAt.replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  // THE REAL MARKER IS READ BEFORE ANYTHING BOOTS (F.2): if it already exists, that is a FINDING about an
  // earlier mis-isolated boot, not a mess to tidy — this case must not create it and must not delete it.
  /** Whether the real workspace already carried the law's boot marker when this case started. */
  const realMarkerBefore = existsSync(REAL_MARKER)

  // The installer run that stages the bundle rows into the sandbox profile.
  /** The install-profile result. */
  const install = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.ts"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
  if (install.status !== 0) fail("install-profile failed\n" + (install.stdout || "") + (install.stderr || ""))

  // ── RUN A: NO loop armed, no knob set. The code write must LAND (the inverse of the old denial). ──
  /** Run A's outcome. */
  const allowed = runOnce("Call the write tool with file_path \"" + CODE_PATH + "\" and content \"// probe\\n\". Then report exactly what the tool returned.", sandbox, ws, env)
  writeFileSync(join(outDir, "run-a-allowed.log"), allowed.output.slice(0, 200000))

  // ── RUN B: THE RETIRED KNOB, spelled as the strictest old mode. The write must STILL land. ──────
  // `verify.mode: "hard"` used to DENY this exact write. The mode was read RAW through the config
  // service, so the sandbox's own `.mpd/mpd.jsonc` is the switch — the patch is never edited, and the
  // arm is one file in the SANDBOX workspace. If the guard were ever reinstalled, this arm would go red
  // together with RUN A, so neither can pass by accident.
  /** The sandbox workspace's config file, written only for the retired-knob arm. */
  const configPath = join(ws, ".mpd", "mpd.jsonc")
  mkdirSync(join(ws, ".mpd"), { recursive: true })
  writeFileSync(configPath, '{ "verify": { "mode": "hard" } }\n', "utf8")
  // The artifact RUN A wrote is removed FIRST, so RUN B's `codeWritten` is its OWN observation rather
  // than a leftover from the previous run.
  spawnSync(process.execPath, ["-e", "require('node:fs').rmSync(" + JSON.stringify(join(ws, CODE_PATH)) + ", { force: true })"], { encoding: "utf8" })
  /** Run B's outcome. */
  const retiredKnob = runOnce("Call the write tool with file_path \"" + CODE_PATH + "\" and content \"// probe-b\\n\". Then report exactly what the tool returned.", sandbox, ws, env)
  writeFileSync(join(outDir, "run-b-retired-knob.log"), retiredKnob.output.slice(0, 200000))
  // The config is REMOVED again, so the sandbox is left in its default state.
  spawnSync(process.execPath, ["-e", "require('node:fs').rmSync(" + JSON.stringify(configPath) + ", { force: true })"], { encoding: "utf8" })

  // ── THE ISOLATION ASSERTION, the row's mount marker and the boot line ───────────────────────────
  /** The session-sandbox assertion's verdict, or the reason it threw. */
  let sandboxed = ""
  try { isolationLib.assertSessionsSandboxed(sandbox, sandbox, { label: SLUG }) } catch (error) { sandboxed = error instanceof Error ? error.message : String(error) }
  /** Whether the sandbox workspace carries the law's boot marker (it must: the verify row really applied). */
  const sandboxMarker = existsSync(join(ws, ".mpd", "verify", "boot.json"))
  /** Whether the REAL workspace carries the marker now, and whether it did before the run. */
  const realMarkerAfter = existsSync(REAL_MARKER)
  /** The roles row's own log, where the boot line lands (R5: a row never prints to stdout). */
  const rowLogPath = join(ws, ".mpd", "logs", "mpd-roles.log")
  /** The roles row's log text, or the empty string when the row wrote none. */
  const rowLog = existsSync(rowLogPath) ? readFileSync(rowLogPath, "utf8") : ""
  /** The ONE team-plane boot line, quoted into the record so a reader sees the reported state. */
  const bootLine = rowLog.split("\n").find((line) => line.includes("team plane:")) ?? ""
  // THE BOOT LINE MUST REPORT THE WITHDRAWAL. A stale dist (built before the withdrawal) still prints a
  // MODE here and reddens this arm — deliberately: the wave's rebuild step is what makes the shipped
  // bytes say `absent`, and a case that accepted either spelling would hide a stale artifact.
  /** Whether the boot line names the withdrawn write guard as absent. */
  const withdrawnReported = bootLine.includes(ABSENT_TOKEN)

  /** Every assertion of this case, so the result file reports all of them rather than the first. */
  const steps = {
    // THE INVERSE OF THE OLD DENIAL — both halves, because the recorded call alone is not enough: the
    // harness pairs a guard-BLOCKED call with a result it does not error-flag (measured 2026-10-07), so
    // "a write was called" would pass a denied one. The artifact is the reliable half.
    written: { ok: allowed.codeCalled && allowed.codeWritten, detail: "with no loop armed the top-level agent's write CALL was recorded and the code path EXISTS in the sandbox" },
    // THE RETIRED KNOB cannot deny any more: the strictest old spelling, explicitly set, changes nothing.
    retiredKnobWritten: { ok: retiredKnob.codeCalled && retiredKnob.codeWritten, detail: "the retired `verify.mode: \"hard\"` knob no longer denies: the same write still landed" },
    // The row still MOUNTED: its own boot marker is written (its five tools are asserted offline).
    mounted: { ok: sandboxMarker, detail: "the mpd-verify row wrote its sandbox boot marker (the law's bookkeeping tools still mount)" },
    withdrawnReported: { ok: withdrawnReported, detail: "the roles row's boot line reports " + ABSENT_TOKEN + "… (the state is REPORTED, never a mode)" },
    realMarkerUnchanged: { ok: realMarkerAfter === realMarkerBefore, detail: "the REAL workspace's marker is exactly as it was: before=" + String(realMarkerBefore) + " after=" + String(realMarkerAfter) },
    sessionsSandboxed: { ok: sandboxed === "", detail: sandboxed === "" ? "no real-cwd session key exists" : sandboxed },
  }
  /** Whether every step held. */
  const ok = Object.values(steps).every((step) => step.ok)
  // REPORTED, never asserted: the exit codes, the recorded-result channel and the boot line, so a reader
  // can see the raw facts behind the arms without the record judging them twice.
  /** The runs' raw context, kept in the record. */
  const reported = { runAExit: allowed.exit, runBExit: retiredKnob.exit, runAResultOk: allowed.callSucceeded, runBResultOk: retiredKnob.callSucceeded, bootLine }
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, slug: SLUG, sandbox, workspace: ws, realMarkerBefore, steps, reported }, null, 2))
  writeFileSync(join(outDir, "output.log"), JSON.stringify({ runA: allowed.output.slice(0, 20000), runB: retiredKnob.output.slice(0, 20000) }, null, 2))
  console.log("[" + SLUG + "] ok=" + ok + " -> " + outDir)
  for (const [name, step] of Object.entries(steps)) console.log("  " + name + ": " + step.ok + " — " + step.detail)
  if (!ok) process.exit(1)
  console.log("[" + SLUG + "] PASS")
}

if (process.argv.includes("--self-test")) selfTest()
else runReal()
