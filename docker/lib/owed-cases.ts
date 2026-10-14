// docker/lib/owed-cases.ts — the apparatus arm that RE-RUNS the cases §7 still owes (§7 items 3 and 4).
//
// WHY IT EXISTS. Two of the repository's live QA cases are red on the developer host for PRE-EXISTING
// reasons (`mcp-call` needs a provider credential and an `sg` engine; `readonly-deny` needs a working
// `dsh` install it can drive), and the three capabilities this wave RESTORES each ship their own case.
// A host that cannot run them is not a verdict about them, and inheriting the host's excuse is exactly
// what the acceptance gate forbids — so the same commands are driven INSIDE the container and their
// REAL outcome is what lands in the report.
//
// TWO RULES THIS MODULE OBEYS, both learned in this repository:
//   · A SKIP IS NOT A PASS. A case that prints the marker saying it could not run at all is recorded
//     `null` WITH that marker quoted — never `true`. A case that ran and failed is `false`.
//   · A MISSING CASE IS A FAILURE, not a skip. Every case named here is OWED by the wave contract, so
//     an absent script is a statement about the wave (`restore.reviewPanel*`), not about this machine.
//
// The LSP arm (`--kind lsp`) is the one place a real boot is replaced by a direct launcher run: the
// launcher is driven TWICE with a closed stdin, once in a scratch root with no config and once in a
// scratch root carrying the user's own `cclsp.json`. That pair is the assertion's negative control —
// the capability is "generate when the user has none", and a launcher that also overwrote a user's
// file, or that never wrote anything, fails one half of the pair.
//
// Usage:
//   node docker/lib/owed-cases.ts --kind cases --repo <dir> --state <ndjson> [--work <dir>] [--qa-home <dir>]
//   node docker/lib/owed-cases.ts --kind lsp   --repo <dir> --state <ndjson> --work <dir>
import { spawn, spawnSync } from "node:child_process"
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join, resolve } from "node:path"

/** How long the review-panel case and the hashline suite may take before the arm gives up. */
const CASE_TIMEOUT_MS: number = 900000
/** How long a QA case that drives a real model turn may take (the two live cases install a profile). */
const LIVE_CASE_TIMEOUT_MS: number = 1800000
/** How long the LSP launcher gets to write its config before the control reads the scratch root. */
const LSP_WRITE_BUDGET_MS: number = 30000
/** The shortest wait the negative half ever makes, so a fast positive half cannot shorten it to nothing. */
const LSP_MIN_NEGATIVE_WAIT_MS: number = 5000
/** The extensions `cclsp` expects are BARE (no dot): these are the TypeScript family the row serves. */
const TS_EXTENSIONS: readonly string[] = ["ts", "tsx", "mts", "cts"]
/** The workspace-relative path the launcher generates a config at when the user has none. */
const GENERATED_CONFIG_REL: string = join(".mpd", "lsp", "cclsp.json")

/** One assertion row, in the exact shape `docker/lib/report.ts` reads out of the state file. */
interface Row {
  /** Assertion name, e.g. `qa.mcpCall`. */
  readonly name: string
  /** Verdict: true pass, false fail, null deliberately not evaluated. */
  readonly ok: boolean | null
  /** Human reason, carrying the measurement that produced the verdict. */
  readonly reason: string
  /** The raw witness: exit code, path, quoted output. */
  readonly raw: string
}

/** One case this wave owes, and how its outcome must be classified. */
interface CaseSpec {
  /** The assertion name the verdict lands under. */
  readonly row: string
  /** What the case is worth, for the failure text. */
  readonly what: string
  /** The full argv, run with the repository root as cwd. */
  readonly argv: readonly string[]
  /** Repository-relative files that must exist for the case to be able to run. */
  readonly requires: readonly string[]
  /** Output markers that mean "the case itself refused to run" — recorded `null`, never a pass. */
  readonly skipMarkers: readonly string[]
  /** The budget for this case. */
  readonly timeoutMs: number
}

/** The cases §7 owes, in report order. */
const CASES: readonly CaseSpec[] = [
  {
    row: "restore.reviewPanelSelfTest",
    what: "the restored review panel's offline self-test (with its negative control)",
    argv: ["node", "skills/dsh-qa/scripts/review-panel.ts", "--self-test"],
    requires: ["skills/dsh-qa/scripts/review-panel.ts"],
    skipMarkers: [],
    timeoutMs: CASE_TIMEOUT_MS,
  },
  {
    row: "restore.reviewPanelCase",
    what: "the restored review panel's real case",
    argv: ["node", "skills/dsh-qa/scripts/review-panel.ts"],
    requires: ["skills/dsh-qa/scripts/review-panel.ts"],
    skipMarkers: [],
    timeoutMs: CASE_TIMEOUT_MS,
  },
  {
    row: "restore.hashlineRepair",
    what: "the restored hashline fuzzy-repair cases (wrapped line, paired indent, the ambiguous negative control, the CRLF round-trip)",
    argv: ["bun", "test", "packages/mpd-hashline-plugin"],
    requires: ["packages/mpd-hashline-plugin/src/vendor/edits.ts"],
    skipMarkers: [],
    timeoutMs: CASE_TIMEOUT_MS,
  },
  {
    row: "qa.mcpCall",
    what: "the live mcp-call case (a real model turn that must record a mcp__ast_grep__search call)",
    argv: ["node", "skills/dsh-qa/scripts/mcp-call.ts"],
    requires: ["skills/dsh-qa/scripts/mcp-call.ts", "dist/mpd-package"],
    skipMarkers: ["[mcp-call] missing credentials", "[mcp-call] missing staged bundle"],
    timeoutMs: LIVE_CASE_TIMEOUT_MS,
  },
  {
    row: "qa.readonlyDeny",
    what: "the live readonly-deny case (a read-only spawn whose child must really be restricted)",
    argv: ["node", "skills/dsh-qa/scripts/readonly-deny.ts"],
    requires: ["skills/dsh-qa/scripts/readonly-deny.ts"],
    skipMarkers: [],
    timeoutMs: LIVE_CASE_TIMEOUT_MS,
  },
]

/** The parsed command line of one invocation. */
interface Options {
  /** `cases` runs the owed QA/restore cases; `lsp` drives the LSP launcher control pair. */
  readonly kind: string
  /** The installed bundle tree the cases run against. */
  readonly repo: string
  /** The run's `assertions.ndjson` path. */
  readonly state: string
  /** Scratch root for the LSP control pair. */
  readonly work: string
  /** The home the cases see, so a staged credential can be placed where `homedir()` looks. */
  readonly qaHome: string
  /** Assertion names to run; empty means every case in the table. */
  readonly only: readonly string[]
}

/**
 * Parse argv into options, exiting 2 with the usage line when a required flag is missing.
 *
 * @param argv - `process.argv.slice(2)`.
 * @returns The resolved option set.
 */
function parseArgs(argv: readonly string[]): Options {
  /** The option values as parsed, keyed by flag name without the leading dashes. */
  const found = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    /** The token being read; a non-flag ends the pair scan without consuming a value. */
    const flag = argv[index]
    if (!flag.startsWith("--")) continue
    found.set(flag.slice(2), argv[index + 1] ?? "")
    index += 1
  }
  /** The flags every invocation needs, so a missing one is named rather than silently empty. */
  const missing = ["kind", "repo", "state"].filter((key) => (found.get(key) ?? "") === "")
  if (missing.length > 0) {
    console.error("usage: node docker/lib/owed-cases.ts --kind cases|lsp --repo <dir> --state <ndjson> [--work <dir>] [--qa-home <dir>]")
    console.error("[owed-cases] missing: " + missing.join(", "))
    process.exit(2)
  }
  return {
    kind: found.get("kind") ?? "",
    // EVERY path handed to a CHILD is resolved to an absolute one here: the LSP arm spawns the launcher
    // with the SCRATCH ROOT as the child's cwd, so a relative `argv[1]` would be resolved against the
    // scratch root and the child would die with MODULE_NOT_FOUND — measured on the developer host while
    // rehearsing this very module.
    repo: resolve(found.get("repo") ?? "."),
    state: resolve(found.get("state") ?? "."),
    work: resolve(found.get("work") ?? "."),
    qaHome: resolve(found.get("qa-home") ?? "."),
    // `--only` exists so ONE arm can be rehearsed without paying for the two live cases: a debugger
    // that must run the whole table before it can look at one row is a debugger nobody uses.
    only: (found.get("only") ?? "").split(",").filter((name) => name !== ""),
  }
}

/**
 * Append one row to the run's assertion state file.
 *
 * @param state - The `assertions.ndjson` path.
 * @param row - The row to record.
 */
function record(state: string, row: Row): void {
  appendFileSync(state, JSON.stringify({ name: row.name, ok: row.ok, reason: row.reason, raw: row.raw.slice(0, 1500) }) + "\n")
  console.log("[owed-cases] " + row.name + "=" + String(row.ok) + " — " + row.reason)
}

/**
 * The last few non-empty lines of a log file, so a failure report quotes the real output.
 *
 * @param path - The log to read.
 * @param lines - How many trailing lines to keep.
 * @returns The tail, trimmed to a bounded length.
 */
function tail(path: string, lines: number): string {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .slice(-lines)
      .join(" | ")
      .slice(0, 1200)
  } catch {
    return "<no log>"
  }
}

/**
 * Run one owed case with BOTH streams written to a FILE (never a pipe: the MCP children these cases
 * boot inherit the descriptor and would hold a pipe open past EOF) and classify its outcome.
 *
 * @param options - The resolved paths.
 * @param spec - The case to run.
 */
function runCase(options: Options, spec: CaseSpec): void {
  /** Repository-relative files the case needs; a missing one is a failure of the WAVE, not a skip. */
  const absent = spec.requires.filter((rel) => !existsSync(join(options.repo, rel)))
  if (absent.length > 0) {
    record(options.state, {
      name: spec.row,
      ok: false,
      reason: spec.what + " cannot run: this wave owes " + absent.join(", ") + " and the tree does not carry it",
      raw: "absent=" + absent.join(","),
    })
    return
  }
  /** Where this case's console output lands; the container keeps it for the step log. */
  const logDir = options.work === "" ? join(options.repo, ".owed-logs") : join(options.work, "owed-logs")
  mkdirSync(logDir, { recursive: true })
  /** The log for this case, stripped of the characters a path cannot carry. */
  const logFile = join(logDir, spec.row.replace(/[^A-Za-z0-9._-]/g, "_") + ".log")
  /** The file descriptor both streams are pointed at. */
  const fd = openSync(logFile, "w")
  /** The child environment: the caller's, with HOME redirected to the staged QA home when given. */
  const env: NodeJS.ProcessEnv = options.qaHome === "" ? { ...process.env } : { ...process.env, HOME: options.qaHome }
  /** The child's outcome; `status` is null when the signal killed it or the budget expired. */
  let status: number | null = null
  /** The signal that ended the child, when one did. */
  let signal: string | null = null
  try {
    /** The case process; `spawnSync` blocks until it exits or the budget expires. */
    const child = spawnSync(spec.argv[0], spec.argv.slice(1), { cwd: options.repo, env, stdio: ["ignore", fd, fd], timeout: spec.timeoutMs, maxBuffer: 64 * 1024 * 1024 })
    status = child.status
    signal = child.signal
  } finally {
    closeSync(fd)
  }
  /** The case's own output, which decides between a verdict and a refusal to run. */
  const out = (() => { try { return readFileSync(logFile, "utf8") } catch { return "" } })()
  /** The marker that says the case itself could not run, if it printed one. */
  const skipMarker = spec.skipMarkers.find((marker) => out.includes(marker))
  if (skipMarker !== undefined) {
    // A REFUSAL TO RUN IS NOT A PASS. The marker and the real output are quoted, so a reader can tell
    // "this machine could not drive the case" from "the case ran and the thing it checks is broken".
    record(options.state, {
      name: spec.row,
      ok: null,
      reason: spec.what + " did not run to a verdict on this machine: the case itself reported " + JSON.stringify(skipMarker) + " — a skip is not a pass, and nothing about the bundle is settled by it",
      raw: "exit=" + String(status) + " marker=" + skipMarker + " tail=" + tail(logFile, 4),
    })
    return
  }
  /** True when the case ran to a clean exit under its own budget. */
  const ok = status === 0
  record(options.state, {
    name: spec.row,
    ok,
    reason: ok
      ? spec.what + " ran to a clean exit in this run — the case's own assertions are what passed"
      : spec.what + " did NOT pass in this run (exit=" + String(status) + (signal === null ? "" : " signal=" + signal) + "); this is the case's real outcome, not the host's excuse",
    raw: "cmd=" + spec.argv.join(" ") + " exit=" + String(status) + " log=" + logFile + " tail=" + tail(logFile, 6),
  })
}

/**
 * Drive the LSP launcher twice with a closed stdin and grade the pair: a scratch root with no config
 * must GAIN a valid generated config, and a scratch root carrying the user's own `cclsp.json` must be
 * left alone. The second half is the negative control — a launcher that overwrote the user's file
 * would pass a "was a config written" check while failing the capability the contract states.
 *
 * @param options - The resolved paths.
 */
async function lspControl(options: Options): Promise<void> {
  /** The launcher under test, at the installed tree's own path so its dependency chain resolves. */
  const launcher = join(options.repo, "packages", "mpd-mcp-lsp", "dist", "launch.js")
  if (!existsSync(launcher)) {
    record(options.state, {
      name: "restore.lspBootstrap",
      ok: false,
      reason: "the LSP launcher is not carried in the installed tree, so the config it is supposed to generate cannot be produced or graded",
      raw: "launcher=" + launcher,
    })
    return
  }
  /** The scratch root the positive half runs in: cwd is the launcher's own workspace root. */
  const blessed = join(options.work, "lsp-blessed")
  /** The scratch root the control half runs in, carrying the user's own config. */
  const userOwned = join(options.work, "lsp-user-owned")
  mkdirSync(blessed, { recursive: true })
  mkdirSync(userOwned, { recursive: true })
  /** The user's own config, whose bytes must survive the launcher untouched. */
  const sentinel = join(userOwned, "cclsp.json")
  writeFileSync(sentinel, JSON.stringify({ servers: [{ extensions: ["zig"], command: ["zig-lsp"], rootDir: "." }] }, null, 2) + "\n")
  /** The sentinel's digest before the launcher sees it. */
  const before = createHash("sha256").update(readFileSync(sentinel)).digest("hex")
  /** The generated config the positive half must produce. */
  const generated = join(blessed, GENERATED_CONFIG_REL)
  /** How long the launcher needed to write, measured by this run rather than assumed. */
  const wroteIn = await driveLauncher(launcher, blessed, () => existsSync(generated), LSP_WRITE_BUDGET_MS)
  // The negative half must wait at least as long as the positive one took, or "it wrote nothing" would
  // be indistinguishable from "it had not got there yet" — the classic way a control passes by timing.
  await driveLauncher(launcher, userOwned, () => existsSync(join(userOwned, GENERATED_CONFIG_REL)), Math.min(LSP_WRITE_BUDGET_MS, Math.max(LSP_MIN_NEGATIVE_WAIT_MS, wroteIn * 3)))
  /** Whether the launcher ALSO wrote into the user's own root, which the contract forbids. */
  const intruded = existsSync(join(userOwned, GENERATED_CONFIG_REL))
  /** The sentinel's digest after the launcher ran. */
  const after = existsSync(sentinel) ? createHash("sha256").update(readFileSync(sentinel)).digest("hex") : ""
  /** The generated document as parsed JSON, or `undefined` when absent or malformed. */
  const document = (() => {
    try {
      /** The file's bytes parsed as JSON, still untyped until the object check below. */
      const parsed: unknown = JSON.parse(readFileSync(generated, "utf8"))
      return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined
    } catch {
      return undefined
    }
  })()
  /** The generated servers, filtered to the well-formed entries `cclsp` can actually load. */
  const servers = Array.isArray(document?.servers) ? (document?.servers as unknown[]).filter(isServerEntry) : []
  /** The servers whose extensions cover the TypeScript family the row must serve. */
  const tsServers = servers.filter((server) => server.extensions.some((ext) => TS_EXTENSIONS.includes(ext)))
  /** True when the config is valid, serves TypeScript, and the user's own file was left alone. */
  const ok = document !== undefined && servers.length > 0 && tsServers.length > 0 && !intruded && after === before && after !== ""
  record(options.state, {
    name: "restore.lspBootstrap",
    ok,
    reason: ok
      ? "the launcher generated a valid " + GENERATED_CONFIG_REL + " with " + servers.length + " well-formed language server(s), " + tsServers.length + " of them serving the TypeScript family, and left a pre-existing user cclsp.json byte-identical (the negative control)"
      : "the LSP bootstrap did not hold: configParsed=" + String(document !== undefined) + " servers=" + servers.length + " typescriptServers=" + tsServers.length + " userConfigOverwritten=" + String(!(after === before && after !== "")) + " wroteIntoUserRoot=" + String(intruded),
    raw: "generated=" + generated + " userConfigDigestBefore=" + before.slice(0, 12) + " after=" + after.slice(0, 12),
  })
}

/**
 * Whether a parsed `servers[]` entry is one `cclsp` can load: bare extensions and a spawnable command.
 *
 * @param value - One entry of the generated document's `servers` array.
 * @returns True when the entry carries a non-empty `extensions` and `command` pair.
 */
function isServerEntry(value: unknown): value is { readonly extensions: readonly string[]; readonly command: readonly string[] } {
  if (value === null || typeof value !== "object") return false
  /** The entry viewed as a bag, so the two required members can be read at all. */
  const bag = value as Record<string, unknown>
  /** The declared extensions, filtered to non-empty strings. */
  const extensions = Array.isArray(bag.extensions) ? bag.extensions.filter((ext): ext is string => typeof ext === "string" && ext !== "") : []
  /** The declared argv, filtered to non-empty strings. */
  const command = Array.isArray(bag.command) ? bag.command.filter((part): part is string => typeof part === "string" && part !== "") : []
  return extensions.length > 0 && command.length > 0
}

/**
 * Wait until a predicate holds, the child exits, or the budget expires — then stop the child. The wait
 * is a polling loop rather than `spawnSync` because the launcher SERVES MCP on its stdin and would
 * never exit on its own; the kill is unconditional, so no launcher survives this arm.
 *
 * @param launcher - The absolute launcher path to run.
 * @param cwd - The scratch root, which the launcher resolves as its workspace root.
 * @param satisfied - Called after every poll; the wait ends as soon as it answers true.
 * @param budgetMs - The longest this half may wait.
 * @returns The elapsed milliseconds, which sets the negative half's own wait.
 */
async function driveLauncher(launcher: string, cwd: string, satisfied: () => boolean, budgetMs: number): Promise<number> {
  /** The launcher child; every stream is discarded so nothing it prints can reach the report. */
  const child = spawn(process.execPath, [launcher], {
    cwd,
    env: { ...process.env, MPD_MCP_LOG_DIR: "", DSH_WORKSPACE_ROOT: "" },
    stdio: ["ignore", "ignore", "ignore"],
  })
  /** When this half started, so the caller learns how long the launcher needed. */
  const started = Date.now()
  /** The instant the wait gives up. */
  const deadline = started + budgetMs
  while (Date.now() < deadline) {
    if (satisfied()) break
    if (child.exitCode !== null || child.signalCode !== null) break
    await new Promise((resolve) => { setTimeout(resolve, 250) })
  }
  try { child.kill("SIGKILL") } catch { /* an already-dead child needs no kill */ }
  return Date.now() - started
}

/**
 * The module entry point: run the arm the caller asked for.
 */
async function main(): Promise<void> {
  /** The resolved invocation. */
  const options = parseArgs(process.argv.slice(2))
  if (options.kind === "lsp") {
    if (options.work === "") {
      console.error("[owed-cases] --kind lsp needs --work <scratch dir>")
      process.exit(2)
    }
    await lspControl(options)
    return
  }
  if (options.kind !== "cases") {
    console.error("[owed-cases] unknown --kind " + options.kind + " (expected cases|lsp)")
    process.exit(2)
  }
  // `dist/mpd-package` is a case precondition (mcp-call installs the STAGED pack), so it is declared in
  // the table above; a missing one is recorded as a failure of the run, never as a silent skip.
  /** The cases this invocation runs: all of them, or the `--only` selection. */
  const selected = options.only.length === 0 ? CASES : CASES.filter((spec) => options.only.includes(spec.row))
  for (const spec of selected) runCase(options, spec)
}

// `.catch` rather than top-level `await`: this module is executed from `/opt/mpd-e2e/lib/` inside the
// container, where NO `package.json` declares the module system and Node therefore has to DETECT it.
// A detected-ESM file with top-level await is the one combination that has historically been fragile,
// and there is nothing to gain by depending on it for a rejection that must be loud.
main().catch((error: unknown) => {
  console.error("[owed-cases] FAILED: " + String(error))
  process.exit(1)
})
