#!/usr/bin/env node
// Case delegation-gate: the official spawn tools (`subagent` / `subagent_fork` / `workflow`) are
// REFUSED for the workspace's top-level session, the sanctioned roster path (`mpd_role_spawn`) is OPEN
// on the same sandbox, and the knob both ways is measured from the HARNESS's own session log.
//
// WHY THIS CASE EXISTS: the wave fixes two measured defects at once.
//   * F1 — nothing denied the harness's generic spawn tools, so §5 rule 2's sanctioned delegation
//     surfaces (mpd_role_spawn / the workmate library / Agent Teams) were advice, and the escape cost
//     nothing. The gate is a `tools.guard` callback in `mpd-roles-plugin` (`delegation-gate.ts`), keyed
//     on §5's PRESET-FREE session rank.
//   * F2 — the sanctioned path was itself BROKEN: `mpd_role_spawn` of a read-only role died with
//     `tools.restrict() names unknown global tools "mcp__lsp__rename_symbol", …` on a profile without
//     `cclsp`, because the harness rejects the WHOLE deny list when one name is unregistered. The fix
//     prunes by the harness's OWN verdict (`restrictToolsTolerant`, one retry).
// An escape that is closed while the front door is bricked would be worse than no gate, so (c) below
// asserts the front door on the SAME sandbox as (a).
//
// WHAT CARRIES THE PROOF — the HARNESS's session log, never the model's prose (AGENTS.md §7):
//   (a) a `tool/call` for `subagent` exists and EVERY recorded result for it is an ERROR whose text
//       carries the delegation-gate refusal;
//   (b) with `delegation.gate: "allow"` in the side's `.mpd/mpd.jsonc`, the same call's recorded
//       results carry NO refusal text (the call is not refused by the gate);
//   (c) on the deny-default sandbox, `mpd_role_spawn` (role Explorer, read-only) has a `tool/call`
//       whose recorded result is NOT an error and does NOT carry the unknown-names rejection.
// `--dump-config` is deliberately NOT used: it composes rows and never executes plugin code, so it
// cannot witness a guard at all.
//
// PREREQ: absent-dsh-binary dsh "install DeepSeek Harness (dsh) on PATH"
// PREREQ: absent-credentials DEEPSEEK_API_KEY "export DEEPSEEK_API_KEY in the launching shell, or add `refs: DEEPSEEK_API_KEY: <value>` to ~/.dsh/.credentials.yaml"
// PREREQ: absent-runtime packages/mpd-roles-plugin/dist/index.js ".toolchain/node_modules/.bin/bun build packages/mpd-roles-plugin/src/index.ts --target node --format esm --outfile packages/mpd-roles-plugin/dist/index.js"
//
// Isolation (all three layers, §7): isolated DSH_HOME + sandbox HOME + a SEPARATE sandbox workspace per
// side, `assertSessionsSandboxed`, and a before/after hash of the REAL checkout's row log. Evidence ->
// evidence/roles/delegation-gate/<ts>/{result.json,output.log,logs/}.
import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { credentialEnv, credentialDescriptor, resolveProviderCredential, seedSandboxCredentials, type Env } from "./lib/credentials.ts"
import type { CredentialResolution } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.ts"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.ts"
import { findToolCall, readSessionEvents } from "./lib/session-evidence.ts"
import {
  DEFAULT_DELEGATION_GATE_MODE,
  DELEGATION_CONFIG_KEY,
  DELEGATION_TOOLS,
  delegationGateDecision,
  delegationRefusal,
  resolveDelegationGateMode,
} from "../../../packages/mpd-roles-plugin/src/delegation-gate.ts"
import type { DelegationGateMode } from "../../../packages/mpd-roles-plugin/src/delegation-gate.ts"
import { sessionRank } from "../../../packages/mpd-roles-plugin/src/complexity-gate.ts"
// The tolerant-restrict helper is read from the BUILT adapter: the package's `src` uses extensionless
// specifiers (the `bun build` form), so only `dist` is importable by both runners this case must work
// under (`node <case>.ts` from the skill, and `bun` from `run-qa-selftests`). The TYPE comes from the
// source (type-only, erased at load) so the assertion stays pinned to the shipped signature.
import type { RestrictAttempt } from "../../../packages/mpd-dsh-adapter-plugin/src/index.ts"

/** The repository root, derived from this script's own URL (`<root>/skills/dsh-qa/scripts/`). */
const repoRoot: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The evidence slug: the SKIP/FAIL marker and the evidence directory both carry it. */
const SLUG: string = "delegation-gate"
/** The built roles row the live lane boots — asserted to CARRY the gate before any boot is spent. */
const ROLES_DIST: string = join(repoRoot, "packages", "mpd-roles-plugin", "dist", "index.js")
/** The row's own log, relative to a booting session's workspace (R5: a row never prints to stdout). */
const ROW_LOG: string = join(".mpd", "logs", "mpd-roles.log")
/** The boot-line field the roles row reports the gate's install and mode with. */
const BOOT_FIELD: string = "delegationGate="
/** The fragment every refusal sentence carries, asserted against the RECORDED result text. */
const REFUSAL_MARKER: string = "delegation gate"
/** The harness's own unknown-name rejection, whose ABSENCE is what (c) proves about the F2 repair. */
const UNKNOWN_NAMES_MARKER: string = "names unknown global tools"
/** The rebuild command the dist precondition names, so a stale artifact is never a mystery. */
const REBUILD_COMMAND: string = ".toolchain/node_modules/.bin/bun build packages/mpd-roles-plugin/src/index.ts --target node --format esm --outfile packages/mpd-roles-plugin/dist/index.js"
/** True when either strict spelling turns an absent prerequisite from a SKIP into a FAIL. */
const STRICT: boolean = process.argv.includes("--no-skip") || process.argv.includes("--require-pack")
/**
 * The credential provider id this case resolves (`PROVIDER_KEY_NAME`'s entry, i.e. `DEEPSEEK_API_KEY`)
 * — the key the deployment's `deepseek-official` model route is configured with, and the one the shared
 * resolver's tiers know how to find in the launching shell's profile.
 */
const PROVIDER: string = "deepseek"
/** The rebuild command for the ADAPTER, named whenever the built helper is missing or stale. */
const ADAPTER_REBUILD: string = ".toolchain/node_modules/.bin/bun build packages/mpd-dsh-adapter-plugin/src/index.ts --target node --format esm --outfile packages/mpd-dsh-adapter-plugin/dist/index.js"
/** The shipped helper's signature, as this case calls it. */
type ShippedTolerant = (restrict: RestrictAttempt, names: readonly string[]) => { readonly applied: readonly string[]; readonly pruned: readonly string[] }
/**
 * The BUILT adapter module, imported DYNAMICALLY: `dist/index.js` ships no declaration file (the build
 * strips types), so a static import would be a type error while the value is exactly what the live lane
 * mounts. The shift specifier is deliberate — the module is loaded at a path, never resolved as a package.
 */
// @ts-expect-error — the prebuilt adapter has no .d.ts; the export's shape is declared by ShippedTolerant.
const adapterDist = await import("../../../packages/mpd-dsh-adapter-plugin/dist/index.js") as { restrictToolsTolerant?: ShippedTolerant }
/** The BUILT helper, or `undefined` when the adapter dist predates this wave (reported, never assumed). */
const shippedTolerant: ShippedTolerant | undefined = adapterDist.restrictToolsTolerant

/** A lane prerequisite: absent means SKIP, or FAIL under either strict spelling. */
interface Prereq {
  /** The machine-readable reason code the SKIP/FAIL marker reports. */
  readonly reason: string
  /** The repository-relative path or probe whose absence was observed. */
  readonly prereq: string
  /** The command (or doc pointer) a human runs to satisfy the prerequisite. */
  readonly remedy: string
}

/** The three live sides this case drives, one headless boot each. */
type SideName = "deny" | "allow" | "roles"

/** The prompt every side is driven with — a FORCED single tool call, so the lane measures the guard and not the model's judgement. */
const PROMPTS: Readonly<Record<SideName, string>> = {
  deny: "Call the `subagent` tool EXACTLY ONCE, with label \"gate-probe\" and prompt \"reply with the single word ok\". Do not call any other tool. After the call, answer in one short line: did the call succeed or was it refused?",
  allow: "Call the `subagent` tool EXACTLY ONCE, with label \"gate-probe\" and prompt \"reply with the single word ok\". Do not call any other tool. After the call, answer in one short line: did the call succeed or was it refused?",
  roles: "Call the `mpd_role_spawn` tool EXACTLY ONCE, with role \"Explorer\" and task \"list the top-level files of the current working directory\". Do not call any other tool. After the call, answer in one short line with the tool's status.",
}

/** One side's recorded outcome, decoded from the harness log plus the row log. */
interface SideOutcome {
  /** The child's exit status, `null` when it was killed by the timeout. */
  readonly exit: number | null
  /** Every tool the harness SHOWED the model, from the request headers. */
  readonly toolNames: readonly string[]
  /** The `subagent` call evidence. */
  readonly subagent: { called: boolean; succeeded: boolean; resultText: string }
  /** The `mpd_role_spawn` call evidence. */
  readonly roleSpawn: { called: boolean; succeeded: boolean; resultText: string }
  /** The row log's text after the boot (the boot line lives there, not on stdout). */
  readonly rowLog: string
  /** The child's own output, kept in the evidence directory. */
  readonly output: string
}

/**
 * The offline self-test: every pure arm this case rests on, with no network, no model and no dsh boot.
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

  // ── the decision table: mode × session class × tool ────────────────────────────────────────────
  /** A captain session (the seeded-fork shape included), a child and an unreadable header. */
  const agents: ReadonlyArray<readonly [string, unknown]> = [
    ["captain", { id: "c", session: { header: { agentPreset: "cordis", delegationDepth: 0 } } }],
    ["seeded-fork", { id: "f", session: { header: { agentPreset: "cordis", parentSession: "seed", isSeeded: true, delegationDepth: 0 } } }],
    ["child", { id: "k", session: { header: { origin: "subagent", parentSession: "p", delegationDepth: 1 } } }],
    ["headerless", { id: "h" }],
  ]
  /** The decision for one call, through the SHIPPED function. */
  const decide = (toolName: string, mode: DelegationGateMode, agent: unknown): string | undefined =>
    delegationGateDecision({ toolName, mode, rank: sessionRank(agent) })
  for (const tool of DELEGATION_TOOLS) {
    for (const [label, agent] of agents) {
      check(decide(tool, "deny", agent) !== undefined, "deny must refuse " + tool + " for " + label)
      check(decide(tool, "allow", agent) === undefined, "allow must release " + tool + " for " + label)
    }
    check(decide(tool, "captain", agents[0]?.[1]) !== undefined, "captain mode must refuse " + tool + " for the captain")
    check(decide(tool, "captain", agents[1]?.[1]) !== undefined, "captain mode must refuse " + tool + " for the seeded fork")
    check(decide(tool, "captain", agents[2]?.[1]) === undefined, "captain mode must release " + tool + " for a child")
    check(decide(tool, "captain", agents[3]?.[1]) === undefined, "captain mode must release " + tool + " for a headerless session")
    check(decide("read", "deny", agents[0]?.[1]) === undefined, "a bystander tool is never the gate's business")
  }
  check(DEFAULT_DELEGATION_GATE_MODE === "deny", "the default mode must be the fail-closed deny")
  check([...DELEGATION_TOOLS].join(",") === "subagent,subagent_fork,workflow", "the covered list must be the three official spawn tools")

  // ── the refusal sentence steers to the sanctioned routes ──────────────────────────────────────
  /** The refusal for one covered tool. */
  const refusal = delegationRefusal("subagent")
  for (const needle of ["delegation gate", "subagent", "mpd_role_spawn", "mpd_workmate_spawn", "agent_teams_plan", "mpd_role_persona", "send_message", "delegation.gate"]) {
    check(refusal.includes(needle), "the refusal must name " + needle)
  }

  // ── the knob's spellings, fail-closed ─────────────────────────────────────────────────────────
  check(resolveDelegationGateMode("captain") === "captain" && resolveDelegationGateMode("allow") === "allow", "the two exact spellings must be honoured")
  for (const raw of ["ALLOW", "Allow", "allow ", "yes", "", true, 1, null, undefined]) {
    check(resolveDelegationGateMode(raw) === "deny", "resolveDelegationGateMode(" + JSON.stringify(raw) + ") must read as deny")
  }

  // ── the seeded-fork classification, the R2 repair ─────────────────────────────────────────────
  check(sessionRank(agents[0]?.[1]) === "captain", "a depth-0 header is the captain")
  check(sessionRank(agents[1]?.[1]) === "captain", "a SEEDED FORK (parentSession + depth 0, no origin) is the captain")
  check(sessionRank({ id: "p", session: { header: { parentSession: "seed" } } }) === "captain", "a parent link with no recorded depth is the captain")
  check(sessionRank(agents[2]?.[1]) === "child", "a subagent origin is a child")
  check(sessionRank({ id: "d", session: { header: { delegationDepth: 1 } } }) === "child", "a recorded depth of 1 is a child")
  check(sessionRank(agents[3]?.[1]) === "headerless", "a missing header is headerless")

  // ── the tolerant restrict: parse, prune, ONE retry, then rethrow ──────────────────────────────
  /** The canonical deny list, of which the profile without `cclsp` registers none of the two lsp names. */
  const canonical: readonly string[] = ["write", "edit", "bash", "mcp__lsp__rename_symbol", "mcp__lsp__rename_symbol_strict"]
  /** The real harness message shape, from `@deepseek-ai/dsh-tools`. */
  const unknownMessage = "tools.restrict() names unknown global tools \"mcp__lsp__rename_symbol\", \"mcp__lsp__rename_symbol_strict\"; known global tools: write, edit, bash"
  /** How many attempts the fixture attempt was handed. */
  let attempts = 0
  /** The lists the fixture attempt saw, in order. */
  const seen: string[][] = []
  /** A fixture attempt that rejects the two lsp names until they are pruned. */
  const attempt: RestrictAttempt = (names: readonly string[]): (() => void) | undefined => {
    attempts += 1
    seen.push([...names])
    if (names.includes("mcp__lsp__rename_symbol")) throw new Error(unknownMessage)
    return () => {}
  }
  /** The shipped helper, reported as a failing arm when the adapter dist is stale. */
  if (shippedTolerant === undefined) {
    failures.push("the adapter dist does not export restrictToolsTolerant — rebuild it: " + ADAPTER_REBUILD)
  }
  /** The helper's verdict on the canonical list; an absent export yields a stated failure, not a crash. */
  const outcome = (shippedTolerant ?? ((): { applied: readonly string[]; pruned: readonly string[] } => ({ applied: [], pruned: [] })))(attempt, canonical)
  check(outcome.pruned.length === 2, "the two rejected names must be pruned")
  check(outcome.applied.length === 3 && !outcome.applied.includes("mcp__lsp__rename_symbol"), "the applied list must keep the canonical survivors in order")
  check(attempts === 2, "exactly one retry is allowed")
  check(seen[1]?.join(",") === outcome.applied.join(","), "the retry must be handed the pruned list")
  /** The original list, asserted unmutated. */
  check(canonical.length === 5, "the canonical input must never be mutated")

  /** A fixture attempt that always rejects, so the retry fails too. */
  let cappedCalls = 0
  /** A fixture attempt that always rejects, so the helper's retry fails too. */
  const alwaysRejects: RestrictAttempt = (): (() => void) | undefined => { cappedCalls += 1; throw new Error(unknownMessage) }
  /** Whether the second failure was rethrown. */
  let rethrown = false
  try { shippedTolerant?.(alwaysRejects, canonical) } catch { rethrown = true }
  check(shippedTolerant !== undefined && rethrown && cappedCalls === 2, "a second failure must be rethrown after exactly one retry")
  /** A fixture attempt that fails for another reason. */
  let otherCalls = 0
  /** A fixture attempt that fails for a reason the helper must NOT treat as a prunable rejection. */
  const otherFailure: RestrictAttempt = (): (() => void) | undefined => { otherCalls += 1; throw new Error("tools.restrict() requires a scoped context") }
  /** Whether the unrelated failure was rethrown without a retry. */
  let otherRethrown = false
  try { shippedTolerant?.(otherFailure, canonical) } catch { otherRethrown = true }
  check(shippedTolerant !== undefined && otherRethrown && otherCalls === 1, "an unrelated failure must be rethrown with no retry")

  for (const message of failures) console.error("[delegation-gate self-test] FAIL: " + message)
  if (failures.length > 0) return failures.length
  console.log("[delegation-gate self-test] ok: " + [
    "decision table " + String(DELEGATION_TOOLS.length) + " tools x 3 modes x 4 session classes",
    "refusal steering",
    "knob spellings",
    "seeded-fork classification",
    "restrictToolsTolerant parse/prune/retry cap",
  ].join("; "))
  return 0
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
 * Drive ONE headless boot and decode its evidence from the ROW LOG and the HARNESS's session log.
 *
 * The child's stdio goes to a FILE (§7's shell caveat: long-lived MCP children inherit fds and a pipe
 * can hang), so a killed child still leaves everything it printed.
 *
 * @param sandbox - the isolated DSH_HOME.
 * @param ws - this side's sandbox workspace (its own session store key).
 * @param prompt - the task text handed to the headless session.
 * @param env - the child environment (sandbox home pair plus the resolved credential).
 * @param logFile - the file the child's own output is written to.
 * @returns what the run recorded; the caller asserts on the fields.
 */
function runSide(sandbox: string, ws: string, prompt: string, env: Env, logFile: string): SideOutcome {
  /** The resolved launcher invocation, or `null` when no launcher is installed. */
  const spec = dshCommand(["--profile", "mpd-headless", prompt], env)
  if (spec === null) throw new Error(DSH_MISSING)
  /** The open descriptor both of the child's output streams land on, closed in the `finally` below. */
  const fd = openSync(logFile, "w")
  /** The child run: a hard timeout, because a hung child must not hang the evidence. */
  let run: SpawnSyncReturns<string> | undefined
  try {
    run = spawnSync(spec.command, spec.args, { env, cwd: ws, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000, stdio: ["ignore", fd, fd] })
  } finally {
    closeSync(fd)
  }
  /** The harness's records for THIS side's workspace, decoded frame by frame (T-25). */
  const events = readSessionEvents(sandbox, { workspace: ws })
  // THE RAW TOOL RECORDS ARE KEPT AS EVIDENCE: every verdict below rests on this decode, so a reader can
  // re-derive the numbers independently instead of trusting this script's summary.
  writeFileSync(logFile.replace(/\.log$/, "-records.json"), JSON.stringify(
    events.records.filter((record) => record["type"] === "tool/call" || record["type"] === "tool/result"), null, 1), "utf8")
  /** The row log the boot line lands in (R5: `<ws>/.mpd/logs/mpd-roles.log`, never stdout). */
  const rowLogPath = join(ws, ROW_LOG)
  /** The row log's text, or the empty string when the row never wrote one. */
  const rowLog = existsSync(rowLogPath) ? readFileSync(rowLogPath, "utf8") : ""
  // The row log is copied into the evidence too: it lives in a fresh `/tmp` sandbox that this process's
  // exit discards, and the boot line is the registration instrument for the gate.
  writeFileSync(logFile.replace(/\.log$/, "-rowlog.log"), rowLog, "utf8")
  /** The harness's own `subagent` evidence for this side. */
  const subagent = findToolCall(events, "subagent")
  /** The harness's own `mpd_role_spawn` evidence for this side. */
  const roleSpawn = findToolCall(events, "mpd_role_spawn")
  /** The tool names the request headers offered, the ground truth for "the tool was mounted". */
  const toolNames = events.records
    .filter((record) => record["type"] === "request/header")
    .flatMap((record) => {
      /** The header object of this request record, when it is a plain object. */
      const header = (record["data"] as { header?: { tools?: unknown } } | undefined)?.header
      return Array.isArray(header?.tools) ? header.tools.map((tool) => String((tool as { name?: unknown })?.name ?? "")) : []
    })
    .filter((name) => name !== "")
  return {
    exit: run.status,
    toolNames,
    subagent: { called: subagent.called, succeeded: subagent.succeeded, resultText: subagent.resultText },
    roleSpawn: { called: roleSpawn.called, succeeded: roleSpawn.succeeded, resultText: roleSpawn.resultText },
    rowLog,
    output: readFileSync(logFile, "utf8"),
  }
}

/** One evidence row: the `{name, ok, reason, raw}` shape this repo's mount evidence uses. */
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
 * The live lane: three isolated boots, judged from the harness session log and the row log.
 *
 * @returns never; the process exits 0 on PASS and 1 on any failed arm.
 */
function runReal(): void {
  // A dist that does not carry the gate would make every boot below prove NOTHING while looking green
  // -free, so the artifact is asserted BEFORE a single model call is spent.
  if (!existsSync(ROLES_DIST)) gate("real", { reason: "absent-runtime", prereq: "packages/mpd-roles-plugin/dist/index.js", remedy: REBUILD_COMMAND })
  /** The built row's bytes, which must already carry the gate this case asserts. */
  const distText = readFileSync(ROLES_DIST, "utf8")
  /** The needles the built row must carry (a stale pre-wave dist fails all of them). */
  const distMissing = ["installDelegationGate", REFUSAL_MARKER, "delegationGate"].filter((needle) => !distText.includes(needle))
  if (distMissing.length > 0) {
    console.error("[" + SLUG + "] FAIL: the built row " + ROLES_DIST + " does not carry the delegation gate (missing " + JSON.stringify(distMissing) + "); rebuild it: " + REBUILD_COMMAND)
    process.exit(1)
  }
  // The declared credential, resolved POSITIVELY through the shared tiers (never assumed).
  const resolution = resolveProviderCredential({ provider: PROVIDER })
  /** The absent-credential record, or `null` when the key resolved. */
  const missing = credentialPrereq(resolution)
  if (missing !== null) gate("real", missing)
  /** The launcher probe: without `dsh` on PATH no side can boot. */
  if (dshCommand(["--version"], process.env) === null) gate("real", DSH_PREREQ)

  /** The run's timestamp, which names the evidence directory. */
  const ts = new Date().toISOString().replaceAll(":", "-")
  /** The evidence directory this run writes its verdict and logs into. */
  const outDir = join(repoRoot, "evidence", "roles", SLUG, ts)
  /** The directory holding one log per side plus the gate log. */
  const logsDir = join(outDir, "logs")
  mkdirSync(logsDir, { recursive: true })

  /** The sandbox DSH_HOME the isolated profile is installed into. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-delegation-gate-"))
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

  /** The isolated profile install, which materializes the sandbox profile the boots read. */
  const install = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.ts"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env, cwd: repoRoot, encoding: "utf8", timeout: 600000 })
  writeFileSync(join(logsDir, "install-profile.log"), (install.stdout || "") + (install.stderr || ""), "utf8")
  if (install.status !== 0) {
    console.error("[" + SLUG + "] FAIL: install-profile.ts exited " + String(install.status) + " (see logs/install-profile.log)")
    process.exit(1)
  }

  /** The three sides, in the order the contract's assertions (a)(b)(c) name them. */
  const sides: readonly SideName[] = ["deny", "allow", "roles"]
  /** Every side's recorded outcome, keyed by name. */
  const outcomes = new Map<SideName, SideOutcome>()
  for (const side of sides) {
    /** This side's own workspace, so its session store key is unambiguous. */
    const ws = sandboxWorkspace(sandbox, "ws-" + side)
    if (side === "allow") {
      // The knob, selected the way a USER selects it: a project `.mpd/mpd.jsonc` (read live by the row).
      mkdirSync(join(ws, ".mpd"), { recursive: true })
      writeFileSync(join(ws, ".mpd", "mpd.jsonc"), JSON.stringify({ delegation: { gate: "allow" } }, null, 2) + "\n", "utf8")
    }
    outcomes.set(side, runSide(sandbox, ws, PROMPTS[side], env, join(logsDir, side + ".log")))
  }
  // The isolation verdict: every session-store key belongs to a sandbox workspace.
  const isolation = assertSessionsSandboxed(sandbox, sandbox, { label: SLUG })
  /** The REAL checkout's row log after the run, for the untouched assertion. */
  const realRowLogAfter = existsSync(realRowLog) ? createHash("sha256").update(readFileSync(realRowLog)).digest("hex") : "absent"

  /** The deny side's outcome. */
  const deny = outcomes.get("deny")!
  /** The allow side's outcome. */
  const allow = outcomes.get("allow")!
  /** The roster side's outcome. */
  const roles = outcomes.get("roles")!
  /**
   * Whether a side's boot reported the gate's install line.
   * @param outcome The side's recorded outcome.
   * @returns true when the row log carries `delegationGate=`.
   */
  const booted = (outcome: SideOutcome): boolean => outcome.rowLog.includes(BOOT_FIELD)
  /** One boot line's text, quoted into a row's raw field. */
  const bootLine = (outcome: SideOutcome): string => outcome.rowLog.split("\n").find((line) => line.includes(BOOT_FIELD)) ?? ""
  /** The raw observation for one side, quoted so a reader sees the measured facts. */
  const rawOf = (label: SideName, outcome: SideOutcome): string =>
    "side=" + label + " exit=" + String(outcome.exit) + " bootLine=" + JSON.stringify(bootLine(outcome))
    + " subagentCalled=" + String(outcome.subagent.called) + " subagentSucceeded=" + String(outcome.subagent.succeeded)
    + " roleSpawnCalled=" + String(outcome.roleSpawn.called) + " roleSpawnSucceeded=" + String(outcome.roleSpawn.succeeded)
    + " subagentResult=" + JSON.stringify(outcome.subagent.resultText.slice(0, 400))
    + " roleSpawnResult=" + JSON.stringify(outcome.roleSpawn.resultText.slice(0, 400))

  /** Every acceptance row this run produces. */
  const rows: Row[] = []
  rows.push({
    name: "R5-dist-carries-the-gate",
    ok: true,
    reason: "the built roles row carries the gate's install and refusal text",
    raw: "needles=" + JSON.stringify(["installDelegationGate", REFUSAL_MARKER, "delegationGate"]) + " missing=[]",
  })
  rows.push({
    name: "R5-a-subagent-refused",
    ok: deny.subagent.called ? (deny.subagent.succeeded === false && deny.subagent.resultText.includes(REFUSAL_MARKER)) : null,
    reason: !deny.subagent.called
      ? "the model never called `subagent` (answer-only narration is not tool evidence)"
      : deny.subagent.succeeded
        ? "the `subagent` call was NOT refused under the default deny mode"
        : deny.subagent.resultText.includes(REFUSAL_MARKER)
          ? "the `subagent` call was refused with the delegation-gate sentence"
          : "the call errored, but without the delegation-gate sentence",
    raw: rawOf("deny", deny),
  })
  rows.push({
    name: "R5-b-allow-releases",
    ok: allow.subagent.called ? !allow.subagent.resultText.includes(REFUSAL_MARKER) : null,
    reason: !allow.subagent.called
      ? "the model never called `subagent` on the allow side (answer-only narration is not tool evidence)"
      : allow.subagent.resultText.includes(REFUSAL_MARKER)
        ? "the `subagent` call carried the refusal even though `delegation.gate` was \"allow\""
        : "the same call carries no refusal text under `delegation.gate: \"allow\"`",
    raw: rawOf("allow", allow),
  })
  rows.push({
    name: "R5-c-readonly-role-spawn-succeeds",
    ok: roles.roleSpawn.called ? (roles.roleSpawn.succeeded && !roles.roleSpawn.resultText.includes(UNKNOWN_NAMES_MARKER)) : null,
    reason: !roles.roleSpawn.called
      ? "the model never called `mpd_role_spawn` (answer-only narration is not tool evidence)"
      : roles.roleSpawn.resultText.includes(UNKNOWN_NAMES_MARKER)
        ? "the read-only spawn still died on the unknown-names rejection (the F2 defect is NOT fixed)"
        : roles.roleSpawn.succeeded
          ? "the read-only Explorer spawn completed without the unknown-names rejection"
          : "the spawn did not complete and its recorded result is not the unknown-names rejection",
    raw: rawOf("roles", roles),
  })
  for (const side of sides) {
    /** The boot-line row for one side. */
    const outcome = outcomes.get(side)!
    rows.push({
      name: "R5-bootline-" + side,
      ok: booted(outcome),
      reason: booted(outcome) ? "the row log reports the gate's install and mode" : "the row log carries no " + BOOT_FIELD + " line",
      raw: rawOf(side, outcome),
    })
  }
  rows.push({
    name: "R5-isolation",
    ok: isolation.ok,
    reason: isolation.ok ? "ok: " + String(isolation.keys.length) + " session-store key(s), all under the sandbox" : "a session-store key leaked outside the sandbox",
    raw: JSON.stringify(isolation),
  })
  rows.push({
    name: "R5-real-checkout-untouched",
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
    toolsOffered: { deny: deny.toolNames.length, allow: allow.toolNames.length, roles: roles.toolNames.length },
    rows,
  }, null, 2) + "\n", "utf8")
  writeFileSync(join(outDir, "output.log"), [
    "# delegation-gate live lane " + ts,
    "sandbox: " + sandbox,
    "credential: " + JSON.stringify(descriptor),
    "",
    ...sides.map((side) => "===== side " + side + " =====\n" + outcomes.get(side)!.output),
  ].join("\n"), "utf8")

  for (const row of rows) console.log("[" + SLUG + "] " + (row.ok === true ? "ok  " : row.ok === null ? "SKIP" : "FAIL") + " " + row.name + " — " + row.reason)
  console.log("[" + SLUG + "] evidence -> " + outDir)
  if (!allOk) process.exit(1)
  console.log("[" + SLUG + "] PASS (3 sides, " + String(rows.length) + " rows)")
}

// The two lanes: the offline self-test, and the real isolated run.
if (process.argv.includes("--self-test")) process.exit(selfTest())
else runReal()
