#!/usr/bin/env node
// Case verify-law: the A-writes/B-verifies LAW, proven on a MOUNTED row in a real headless boot.
//
// SOURCE OF THIS FILE. It is the Lane D (mpd-verify-plugin) case body, authored by the Lead inside its
// own package so the wave's single `skills/**` writer (Lane C) can place it verbatim at
// `skills/dsh-qa/scripts/verify-law.ts`. The single-skills-writer rule (§9) forbids Lane D writing there.
//
// WHAT IT PROVES, and why a boot is the only thing that can prove it:
//   * the `mpd-verify` row MOUNTS and installs the guard (a boot line, never `--dump-config` — that flag
//     proves COMPOSITION ONLY and would pass with the row's apply aborting);
//   * the top-level agent's `write` on a CODE path is really DENIED by the harness (`tool/call` +
//     an ERROR `tool/result`, read from the session log, never from the model's prose);
//   * THE NEGATIVE CONTROL — the same write SUCCEEDS with the guard disabled — so the denial assertion
//     is falsifiable rather than decorative;
//   * PATH CLASSIFICATION BOTH WAYS: a `docs/**` write is allowed while a `packages/**` write is refused,
//     because a guard that also blocked the manual, the PR body or the verification records would be a
//     defect rather than a stricter law;
//   * the law writes its own records into the SANDBOX workspace, and the REAL repository's
//     `.mpd/verify/boot.json` was NOT created by the run (F.1/F.2: a mis-isolated boot would retract the
//     `pre-plugin` record exemption for every lane that finished earlier, silently).
//
// ISOLATION, all three layers (§7): an isolated `DSH_HOME`, a sandbox `HOME`, and a sandbox WORKSPACE
// (`sandboxWorkspace`), with `assertSessionsSandboxed` asserting that no real-cwd session key exists.
// Evidence -> evidence/gates/verify-law/<UTC>/{result.json,output.log} (+ per-run logs).
//
// --self-test is OFFLINE: the patch row, the built dists' symbols, and the package's own decision arms.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** The repository root, derived from this script's own URL (four directories up). */
const repoRoot: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The case slug, which prefixes every failure banner and names the evidence slug. */
const SLUG: string = "verify-law"
/** The five tools the row must register, as the mount arm's subject. */
const TOOLS: readonly string[] = ["mpd_verify_open", "mpd_verify_escape", "mpd_verify_seat", "mpd_verify_evidence", "mpd_verify_record"]
/** The sentence the guard's denial carries, asserted on the recorded tool RESULT. */
const DENIAL_MARKER: string = "verification law"
/** The code path the denied write targets; never created, because it must never be written. */
const CODE_PATH: string = "packages/mpd-verify-plugin/src/probe-denied.ts"
/** The documentation path the allowed write targets. */
const DOC_PATH: string = "docs/probe-allowed.md"
/** The real workspace marker both obligations assert about. */
const REAL_MARKER: string = join(repoRoot, ".mpd", "verify", "boot.json")

// THE SHARED QA HARNESS is resolved RELATIVE TO THE REPOSITORY ROOT rather than to this file, so the case
// behaves identically where it is authored (`packages/mpd-verify-plugin/qa/`) and where the wave's single
// `skills/**` writer places it (`skills/dsh-qa/scripts/`). A static `./lib/...` import would bind this
// file to one of those two directories and silently break the other.
/** The QA library directory, derived from the repository root. */
const QA_LIB: string = join(repoRoot, "skills", "dsh-qa", "scripts", "lib")
/** The credentials helpers (`credentialEnv`, `seedSandboxCredentials`). */
const credentialsLib = await import(join(QA_LIB, "credentials.ts")) as {
  /** Resolve the credential key for a child environment. */
  credentialEnv: (env: Record<string, string | undefined>) => Record<string, string | undefined>
  /** Copy the real credentials into an isolated home. */
  seedSandboxCredentials: (sandbox: string, options: { credentialsFile: string }) => void
}
/** The launcher resolver, so a win32 `.cmd` shim is handled rather than ENOENT. */
const launcherLib = await import(join(QA_LIB, "dsh-launcher.ts")) as {
  /** The actionable sentence a lane reports when no launcher resolves. */
  DSH_MISSING: string
  /** The `{command, args}` pair for one `dsh` invocation, or `null` when nothing resolves. */
  dshCommand: (args: string[], env: Env) => { command: string; args: string[] } | null
}
/** The three-layer isolation helpers (§7). */
const isolationLib = await import(join(QA_LIB, "workspace-isolation.ts")) as {
  /** Create (and return) the sandbox workspace directory inside one sandbox. */
  sandboxWorkspace: (sandbox: string, name?: string) => string
  /** Assert that no session was keyed on a real cwd. */
  assertSessionsSandboxed: (dshHome: string, sandboxRoot: string, options?: { label?: string }) => unknown
}
/** The session-log decoder: the ONLY accepted source of a tool-call proof (§7). */
const evidenceLib = await import(join(QA_LIB, "session-evidence.ts")) as {
  /** Read and decode one sandbox's session records. */
  readSessionEvents: (dshHome: string, options?: { workspace?: string }) => unknown
  /** Pair the recorded calls of one tool name with their results. */
  findToolCall: (events: unknown, name: string) => {
    /** Whether any `tool/call` for that name was recorded. */
    called: boolean
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
  /** The built roles plugin, which installs the guard. */
  const rolesDist = readFileSync(join(repoRoot, "packages", "mpd-roles-plugin", "dist", "index.js"), "utf8")
  if (!rolesDist.includes("verifyGate")) fail("the built mpd-roles dist does not report verifyGate")
  if (!rolesDist.includes(DENIAL_MARKER)) fail("the built mpd-roles dist carries no denial sentence")
  // THE RECORD VALIDATOR'S REFUSAL VOCABULARY, which is the actual guarantee.
  for (const reason of ["same-agent", "no-doc-sources", "no-gate-evidence", "forged-evidence", "bind-unproven", "fail-without-findings", "finding-without-basis", "blind-spent", "pre-plugin-unattested", "post-install-claim"]) {
    if (!verifyDist.includes(reason)) fail("the built dist carries no refusal reason " + reason)
  }
  // THE ANTI-DRIFT ARM: the case body exists TWICE — authored here and registered VERBATIM at
  // `skills/dsh-qa/scripts/verify-law.ts` by the wave's single `skills/**` writer. A verbatim copy that
  // can silently drift is a stale probe waiting to happen, so whenever both exist their sha256 must
  // match. A genuinely absent half is SKIPPED WITH A STATED REASON rather than passed silently: the
  // authored copy is the source of truth, and the registration is the wave's own act.
  /** The registered copy's path. */
  const registered = join(repoRoot, "skills", "dsh-qa", "scripts", "verify-law.ts")
  /** This file's own path. */
  const authored = fileURLToPath(import.meta.url)
  if (!existsSync(registered)) {
    console.log("[" + SLUG + " self-test] note: " + registered + " is not registered yet (the skills/** writer places it) — the drift arm is SKIPPED, not passed")
  } else {
    /** Both copies' digests. */
    const authoredSha = createHash("sha256").update(readFileSync(authored)).digest("hex")
    /** The registered copy's digest, compared byte for byte with the authored one. */
    /** The REGISTERED copy's digest, compared with the AUTHORED one so a verbatim copy cannot drift. */
    const registeredSha = createHash("sha256").update(readFileSync(registered)).digest("hex")
    if (authoredSha !== registeredSha) {
      fail("the registered case has DRIFTED from the authored body: " + authored + " " + authoredSha
        + " vs " + registered + " " + registeredSha + " — re-copy the authored file verbatim")
    }
    console.log("[" + SLUG + " self-test] ok: the registered copy is byte-identical (" + authoredSha.slice(0, 12) + ")")
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
  /** Whether the write was called and blocked: no recorded call for it ever SUCCEEDED. */
  denied: boolean
  /** True when a recorded `write` result happened to relay the guard's own sentence (secondary). */
  sentenceRelayed: boolean
  /** Whether the documentation path exists in the sandbox workspace afterwards. */
  docWritten: boolean
  /** Whether the CODE path exists in the sandbox workspace afterwards (it must not, when guarded). */
  codeWritten: boolean
  /** The combined child output, kept for the evidence log. */
  output: string
}

/**
 * Drive ONE headless run in the sandbox and read its evidence from the SESSION LOG.
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
  /** True when the recorded `write` results carry the guard's own sentence, when the harness relays it. */
  const sentenceRelayed = write.resultText.includes(DENIAL_MARKER)
  return {
    exit: run.status,
    codeCalled: write.calls.some((call): boolean => JSON.stringify(call.arguments ?? {}).includes("probe-denied")),
    // MEASURED 2026-10-07: a `tools.guard` denial does NOT always reach `tool/result` text — the harness
    // blocks the call at the guard and records it WITHOUT a successful result, so the RELIABLE evidence
    // is "the write was called and NO call succeeded". The sentence is kept as a secondary signal and
    // reported on the result, never as the assertion: requiring it would fail a working guard.
    denied: write.called && !write.succeeded,
    sentenceRelayed,
    docWritten: existsSync(join(ws, DOC_PATH)),
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

  // ── RUN A: the guard is ON (the shipped default). The code write must be REFUSED. ────────────────
  /** Run A's outcome. */
  const guarded = runOnce("Call the write tool with file_path \"" + CODE_PATH + "\" and content \"// probe\". Then call the read tool with file_path \"AGENTS.md\" and paste its first line. Report exactly what the tools returned.", sandbox, ws, env)
  writeFileSync(join(outDir, "run-a-guarded.log"), guarded.output.slice(0, 200000))

  // ── RUN B: THE NEGATIVE CONTROL. The SAME task with `verify.mode: off` must NOT be refused. ──────
  // The mode is read RAW through the config service, so the sandbox's own `.mpd/mpd.jsonc` is the
  // switch — the patch is never edited, and the control is one file in the SANDBOX workspace.
  /** The sandbox workspace's config file, written only for the control run. */
  const configPath = join(ws, ".mpd", "mpd.jsonc")
  mkdirSync(join(ws, ".mpd"), { recursive: true })
  writeFileSync(configPath, '{ "verify": { "mode": "off" } }\n', "utf8")
  /** Run B's outcome. */
  const control = runOnce("Call the write tool with file_path \"" + CODE_PATH + "\" and content \"// probe\". Then report exactly what the tool returned.", sandbox, ws, env)
  writeFileSync(join(outDir, "run-b-control.log"), control.output.slice(0, 200000))
  // The control is REMOVED again, so run C is guarded like run A.
  spawnSync(process.execPath, ["-e", "require('node:fs').rmSync(" + JSON.stringify(configPath) + ", { force: true })"], { encoding: "utf8" })

  // ── RUN C: PATH CLASSIFICATION BOTH WAYS. docs/** must stay WRITABLE. ────────────────────────────
  /** Run C's outcome. */
  const docs = runOnce("Call the write tool with file_path \"" + DOC_PATH + "\" and content \"# probe\\n\". Then report exactly what the tool returned.", sandbox, ws, env)
  writeFileSync(join(outDir, "run-c-docs.log"), docs.output.slice(0, 200000))

  // ── THE ISOLATION ASSERTION, and the two markers ────────────────────────────────────────────────
  /** The session-sandbox assertion's verdict, or the reason it threw. */
  let sandboxed = ""
  try { isolationLib.assertSessionsSandboxed(sandbox, sandbox, { label: SLUG }) } catch (error) { sandboxed = error instanceof Error ? error.message : String(error) }
  /** Whether the sandbox workspace carries the law's boot marker (it must: the row really installed). */
  const sandboxMarker = existsSync(join(ws, ".mpd", "verify", "boot.json"))
  /** Whether the REAL workspace carries it now, and whether it did before the run. */
  const realMarkerAfter = existsSync(REAL_MARKER)

  /** Every assertion of this case, so the result file reports all of them rather than the first. */
  const steps = {
    // The row MOUNTED: the guard refused the write, which is only possible through the installed hook.
    mounted: { ok: guarded.codeCalled, detail: "the harness recorded a write call for the code path" },
    // THE BEHAVIOURAL PAIR (corrected 2026-10-07, measured): a `tools.guard` denial is blocked BEFORE
    // dispatch, so the harness pairs the call with a result that is neither error-flagged nor carries
    // the guard's sentence — asserting either channel FAILS a working guard (measured on this arm:
    // `denied=false` while the artifact was never created). This arm therefore asserts WHAT THE
    // HARNESS RECORDS AND WHAT LANDED ON DISK: a recorded call for the code path, and no artifact.
    // The control pair (`controlNotDenied` + `controlWritten`) in the SAME run is what makes the block
    // attributable to the guard rather than to any other failure.
    denied: { ok: guarded.codeCalled && !guarded.codeWritten, detail: "the harness recorded a write CALL for the code path and the artifact was NEVER created (sentence relayed: " + String(guarded.sentenceRelayed) + " — REPORTED, never asserted: requiring it would fail a working guard)" },
    codeNotWritten: { ok: !guarded.codeWritten, detail: "the denied code path was never created" },
    // THE NEGATIVE CONTROL: with the guard off the same write is NOT refused. An arm that passes with
    // and without the guard is worth nothing, so this is what makes the denial falsifiable.
    controlNotDenied: { ok: !control.denied, detail: "with verify.mode=off the same write was not refused" },
    controlWritten: { ok: control.codeWritten, detail: "with verify.mode=off the code path really was written" },
    // BOTH WAYS on classification: a documentation write is allowed and lands.
    docsAllowed: { ok: docs.docWritten && !docs.denied, detail: "a docs/** write is allowed and exists in the sandbox" },
    sandboxMarker: { ok: sandboxMarker, detail: "the law wrote its boot marker in the SANDBOX workspace" },
    realMarkerUnchanged: { ok: realMarkerAfter === realMarkerBefore, detail: "the REAL workspace's marker is exactly as it was: before=" + String(realMarkerBefore) + " after=" + String(realMarkerAfter) },
    sessionsSandboxed: { ok: sandboxed === "", detail: sandboxed === "" ? "no real-cwd session key exists" : sandboxed },
  }
  /** Whether every step held. */
  const ok = Object.values(steps).every((step) => step.ok)
  // REPORTED, never asserted: the text channels the guard's denial does NOT reliably reach.
  /** The channels measured as unreliable, kept in the record so a reader can see them without judging them. */
  const reported = { sentenceRelayed: guarded.sentenceRelayed, controlSentenceRelayed: control.sentenceRelayed }
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, slug: SLUG, sandbox, workspace: ws, realMarkerBefore, steps, reported }, null, 2))
  writeFileSync(join(outDir, "output.log"), JSON.stringify({ runA: guarded.output.slice(0, 20000), runB: control.output.slice(0, 20000), runC: docs.output.slice(0, 20000) }, null, 2))
  console.log("[" + SLUG + "] ok=" + ok + " -> " + outDir)
  for (const [name, step] of Object.entries(steps)) console.log("  " + name + ": " + step.ok + " — " + step.detail)
  if (!ok) process.exit(1)
  console.log("[" + SLUG + "] PASS")
}

if (process.argv.includes("--self-test")) selfTest()
else runReal()
