// docker/lib/owed-mcp.ts — the apparatus arm that grades the MCP surface the probe measured (§7 item 2).
//
// WHY IT EXISTS. `boot.mcpTools` (in the entrypoint) asks three KNOWN names whether they answered. That
// proves a server came up; it cannot prove the ROW SET that is switched on is the row set that
// registered. Two failures hide behind a presence check: a row whose `serverName` changed (the names
// would still look plausible one at a time) and a row shipped `disabled: true` that registered anyway
// (nothing in the check would notice an EXTRA server). This arm reads the probe's full enumeration and
// grades the shape and the set.
//
// It also grades the LIVE search, which is the only measurement that can settle the claim a developer
// host cannot make at all (no `sg` binary): a `mcp__ast_grep__search` call driven through the mounted
// adapter over real source, WITH a negative control — a pattern that must match nothing. A server that
// answered both calls the same way is a stub, not a search, and would pass a one-armed check.
//
// Usage:
//   node docker/lib/owed-mcp.ts --boot-log <file> --state <ndjson> --search-dir <dir>
import { appendFileSync, readFileSync } from "node:fs"

/**
 * The `serverName` of every LOCAL (stdio) row this bundle mounts, each of which must come up in a boot
 * of the installed profile: MPD owns these servers and their launchers resolve inside the bundle.
 */
const REQUIRED_SERVERS: readonly string[] = ["ast_grep", "lsp", "codegraph"]
/**
 * The `serverName` of the two REMOTE rows the SAME patch mounts (`mcp-context7`, `mcp-grepapp`):
 * streamable-http rows against public services, declared in `cordis.patch.yml` under "network required,
 * optional per use". They register ONLY when their handshake completes, so their presence is allowed
 * and their absence is not a defect — measured 2026-10-09, when a one-click run reached both services
 * and the registry carried `mcp__context7__*` + `mcp__grep_app__*` while the source run (same tree, same
 * patch) did not, because the network answered one and not the other.
 */
const REMOTE_SERVERS: readonly string[] = ["context7", "grep_app"]
/**
 * Every `serverName` the shipped patch layers declare. A registered segment OUTSIDE this set is the
 * leak this row exists to catch (a `disabled: true` row that registered anyway, or a row renamed to a
 * `serverName` nobody declared); a segment INSIDE it is a legitimate row, whatever the network did.
 */
const DECLARED_SERVERS: readonly string[] = [...REQUIRED_SERVERS, ...REMOTE_SERVERS]
/** The tools the ast-grep row declares, graded exactly because they are known statically. */
const AST_GREP_TOOLS: readonly string[] = ["search", "rewrite", "scan"]

/** One assertion row, in the exact shape `docker/lib/report.ts` reads out of the state file. */
interface Row {
  /** Assertion name, e.g. `boot.mcpToolNaming`. */
  readonly name: string
  /** Verdict: true pass, false fail, null deliberately not evaluated. */
  readonly ok: boolean | null
  /** Human reason, carrying the measurement that produced the verdict. */
  readonly reason: string
  /** The raw witness: the probe lines this verdict rests on. */
  readonly raw: string
}

/** The parsed command line of one invocation. */
interface Options {
  /** The boot log holding the probe's `[docker-probe]` lines. */
  readonly bootLog: string
  /** The run's `assertions.ndjson` path. */
  readonly state: string
  /** The directory the graded live search ran over, quoted in the raw field. */
  readonly searchDir: string
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
  const missing = ["boot-log", "state"].filter((key) => (found.get(key) ?? "") === "")
  if (missing.length > 0) {
    console.error("usage: node docker/lib/owed-mcp.ts --boot-log <file> --state <ndjson> [--search-dir <dir>]")
    console.error("[owed-mcp] missing: " + missing.join(", "))
    process.exit(2)
  }
  return { bootLog: found.get("boot-log") ?? "", state: found.get("state") ?? "", searchDir: found.get("search-dir") ?? "" }
}

/**
 * Append one row to the run's assertion state file.
 *
 * @param state - The `assertions.ndjson` path.
 * @param row - The row to record.
 */
function record(state: string, row: Row): void {
  appendFileSync(state, JSON.stringify({ name: row.name, ok: row.ok, reason: row.reason, raw: row.raw.slice(0, 1500) }) + "\n")
  console.log("[owed-mcp] " + row.name + "=" + String(row.ok) + " — " + row.reason)
}

/**
 * The value of the first `[docker-probe] <KEY>=…` line in the boot log.
 *
 * @param text - The boot log's contents.
 * @param key - The probe key to read (e.g. `MCP_REGISTERED`).
 * @returns The value after the first `=`, or `null` when the probe never printed the key.
 */
function probeValue(text: string, key: string): string | null {
  /** The line's tail after the key, taken from the FIRST match so a repeated boot cannot mix runs. */
  const match = text.match(new RegExp("\\[docker-probe\\] " + key + "=(.*)"))
  return match === null ? null : match[1].trim()
}

/**
 * Grade the registered MCP surface: the naming SHAPE, and the SERVER SET against the rows that ship
 * enabled. A disabled row that registered tools, or an enabled row that published under another
 * `serverName`, fails here while a presence check stays green.
 *
 * @param text - The boot log's contents.
 * @param state - The run's assertion state path.
 */
function gradeNaming(text: string, state: string): void {
  /** The comma-joined registered names the probe listed, or `null` when it could not enumerate. */
  const registered = probeValue(text, "MCP_REGISTERED")
  /** The `<server>:<count>` pairs the probe derived from the same list. */
  const counts = probeValue(text, "MCP_SERVER_COUNTS")
  if (registered === null || counts === null) {
    // The host offered no enumeration seam. That is a MISSING READ, not a clean surface: the row is
    // reported `null` with the reason, so it can never be read as "no MCP row registered".
    record(state, {
      name: "boot.mcpToolNaming",
      ok: null,
      reason: "the probe could not enumerate the registry (no `MCP_REGISTERED` line in the boot log), so the mcp__<server>__<tool> surface could not be graded — a missing read is not a clean surface",
      raw: "MCP_REGISTERED=" + String(registered) + " MCP_SERVER_COUNTS=" + String(counts),
    })
    return
  }
  /** Every registered name, split on the separator the probe used. */
  const names = registered === "" ? [] : registered.split(",")
  /** Names whose shape is not `mcp__<server>__<tool>` with a non-empty server and tool segment. */
  const malformed = names.filter((name) => {
    /** The `__`-separated segments of the name. */
    const parts = name.split("__")
    return parts[0] !== "mcp" || parts.length < 3 || (parts[1] ?? "") === "" || parts.slice(2).join("__") === ""
  })
  /** The server segments the registered names actually carried. */
  const servers = [...new Set(names.map((name) => name.split("__")[1] ?? "?"))].sort()
  /** Servers that registered although NO shipped patch row declares them: the leak class. */
  const unexpected = servers.filter((server) => !DECLARED_SERVERS.includes(server))
  /** The LOCAL rows that registered NOTHING, which the counts line names directly. */
  const silent = REQUIRED_SERVERS.filter((server) => !servers.includes(server))
  /** The ast-grep tool names the row declares but the registry does not hold. */
  const missingAstGrep = AST_GREP_TOOLS.filter((tool) => !names.includes("mcp__ast_grep__" + tool))
  /** True when the surface is well formed, carries no undeclared server, and the local rows are up. */
  const ok = names.length > 0 && malformed.length === 0 && unexpected.length === 0 && silent.length === 0 && missingAstGrep.length === 0
  record(state, {
    name: "boot.mcpToolNaming",
    ok,
    reason: ok
      ? "every registered MCP tool is named mcp__<server>__<tool>; no server outside the shipped patch's declared set registered (declared: " + DECLARED_SERVERS.join(",") + "; registered: " + servers.join(",") + "); every LOCAL row came up (the two remote rows register only when their public service answers, so their absence is not graded); and the ast-grep row published its whole declared surface (" + AST_GREP_TOOLS.join(",") + ")"
      : "the registered MCP surface is not the declared row set: malformed=" + (malformed.slice(0, 4).join(",") || "none") + " undeclaredServers=" + (unexpected.join(",") || "none") + " silentLocalServers=" + (silent.join(",") || "none") + " missingAstGrepTools=" + (missingAstGrep.join(",") || "none"),
    raw: "MCP_REGISTERED=" + registered + " MCP_SERVER_COUNTS=" + counts + " declared=" + DECLARED_SERVERS.join(",") + " remote=" + REMOTE_SERVERS.join(","),
  })
}

/**
 * Grade the LIVE ast-grep search and its negative control together: the graded pattern must find at
 * least one match in real source, and the control pattern must find NONE. Either half alone is
 * passable by a broken server, which is why they are one verdict.
 *
 * @param text - The boot log's contents.
 * @param state - The run's assertion state path.
 * @param searchDir - The directory the search ran over, quoted for the reader.
 */
function gradeLiveSearch(text: string, state: string, searchDir: string): void {
  /** The graded call's outcome line, or `null` when the probe never printed it. */
  const live = probeValue(text, "MCP_LIVE_SEARCH")
  /** The negative control's outcome line. */
  const control = probeValue(text, "MCP_LIVE_SEARCH_CONTROL")
  /** The match count of a `ok:<n>` line, or `null` when the line is a failure or absent. */
  const countOf = (line: string | null): number | null => {
    if (line === null) return null
    /** The digits after an `ok:` prefix. */
    const match = line.match(/^ok:(\d+)$/)
    return match === null ? null : Number(match[1])
  }
  /** The graded call's match count. */
  const found = countOf(live)
  /** The control call's match count. */
  const controlFound = countOf(control)
  /** The result ENVELOPE the probe measured, quoted so the verdict is read from a shape, not a guess. */
  const shape = probeValue(text, "MCP_LIVE_SEARCH_SHAPE") ?? "<not reported>"
  /** True when real source matched AND the impossible pattern matched nothing. */
  const ok = found !== null && found > 0 && controlFound === 0
  record(state, {
    name: "boot.mcpLiveSearch",
    ok,
    reason: ok
      ? "a REAL mcp__ast_grep__search call through the mounted adapter matched " + found + " site(s) in " + searchDir + ", and the negative control matched 0 — the search engine ran, so the registered name is backed by a working server on this machine"
      : "the live ast-grep search did not settle: graded=" + String(live) + " control=" + String(control) + " (the control MUST be 0 matches, and the graded call at least 1)",
    raw: "dir=" + searchDir + " MCP_LIVE_SEARCH=" + String(live) + " MCP_LIVE_SEARCH_CONTROL=" + String(control) + " SHAPE=" + shape,
  })
}

/**
 * The module entry point: read the probe lines and grade the two MCP questions.
 */
function main(): void {
  /** The resolved invocation. */
  const options = parseArgs(process.argv.slice(2))
  /** The boot log as text, or empty when the boot never produced one. */
  const text = (() => { try { return readFileSync(options.bootLog, "utf8") } catch { return "" } })()
  if (text === "") {
    record(options.state, {
      name: "boot.mcpToolNaming",
      ok: false,
      reason: "the boot log is absent or empty, so nothing about the MCP surface was measured",
      raw: "bootLog=" + options.bootLog,
    })
    record(options.state, {
      name: "boot.mcpLiveSearch",
      ok: false,
      reason: "the boot log is absent or empty, so no live MCP call could be read",
      raw: "bootLog=" + options.bootLog,
    })
    return
  }
  gradeNaming(text, options.state)
  gradeLiveSearch(text, options.state, options.searchDir === "" ? "<unset>" : options.searchDir)
}

main()
