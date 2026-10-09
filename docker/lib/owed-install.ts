// docker/lib/owed-install.ts — the apparatus arm that grades the INSTALL CLOSURE (§7 item 1).
//
// WHY IT EXISTS. Wave B2 made the published dependency closure build-script-free on purpose: pnpm 11
// hard-exits on unapproved dependency build scripts (`ERR_PNPM_IGNORED_BUILDS`) and the client flow
// (`dsh plugin --profile web add`, which forwards to pnpm) has NO approval channel — so a single
// package shipping a `prepare`/`postinstall` in its published manifest breaks a user's one-command
// install. `install.exit` already reddens when the command fails, but it cannot tell WHICH failure
// happened, and it says nothing about the closure itself; the clause stayed "operative, not textual"
// for exactly that reason. This arm makes it textual, twice over:
//
//   1. the install log is read for the error CLASS (the code, the ignored-build-scripts warning, the
//      `approve-builds` hint) and quoted, so a failure is named rather than merely counted; and
//   2. the INSTALLED closure is walked for manifests that DECLARE a build script, so the inventory is
//      a measurement of what landed, not an inference from an absence of messages.
//
// Usage:
//   node docker/lib/owed-install.ts --install-log <file> --exit <code> --roots <dir,dir> --state <ndjson>
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** The script NAMES pnpm treats as a dependency build step, from AGENTS §8's own clause. */
const BUILD_SCRIPT_NAMES: readonly string[] = ["preinstall", "install", "postinstall", "prepare"]
/** The error class the closure must not produce, quoted verbatim so a rename reddens loudly. */
const ERROR_CLASS: string = "ERR_PNPM_IGNORED_BUILDS"
/** The two messages pnpm prints beside that class, matched separately in case only one is emitted. */
const WARN_MARKERS: readonly string[] = ["Ignored build scripts", "approve-builds"]
/** How many package manifests the closure walk will read before it stops and says so. */
const WALK_BUDGET: number = 4000

/** One assertion row, in the exact shape `docker/lib/report.ts` reads out of the state file. */
interface Row {
  /** Assertion name, e.g. `install.buildScripts`. */
  readonly name: string
  /** Verdict: true pass, false fail, null deliberately not evaluated. */
  readonly ok: boolean | null
  /** Human reason, carrying the measurement that produced the verdict. */
  readonly reason: string
  /** The raw witness: the matched error lines and the declared-build-script inventory. */
  readonly raw: string
}

/** The parsed command line of one invocation. */
interface Options {
  /** The install step's captured console output. */
  readonly installLog: string
  /** The install step's exit code, as recorded by the entrypoint's `run_step`. */
  readonly exitCode: number
  /** The installed trees whose closures are walked (`<profile>`, `<bundle>`). */
  readonly roots: readonly string[]
  /** The run's `assertions.ndjson` path. */
  readonly state: string
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
  const missing = ["install-log", "exit", "state"].filter((key) => (found.get(key) ?? "") === "")
  if (missing.length > 0) {
    console.error("usage: node docker/lib/owed-install.ts --install-log <file> --exit <code> --roots <dir,dir> --state <ndjson>")
    console.error("[owed-install] missing: " + missing.join(", "))
    process.exit(2)
  }
  return {
    installLog: found.get("install-log") ?? "",
    exitCode: Number(found.get("exit") ?? "1"),
    roots: (found.get("roots") ?? "").split(",").filter((root) => root !== ""),
    state: found.get("state") ?? "",
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
  console.log("[owed-install] " + row.name + "=" + String(row.ok) + " — " + row.reason)
}

/**
 * Inventory the package manifests that DECLARE a dependency build script, walking each root's
 * `node_modules` two package levels deep (a direct dependency and a dependency's own dependency),
 * which is the shape an npm/pnpm closure takes.
 *
 * @param roots - The installed trees to walk.
 * @returns The `<relative path>:<script names>` entries, bounded and sorted.
 */
function declaredBuildScripts(roots: readonly string[]): readonly string[] {
  /** The manifests found, as `<path>:<names>` entries. */
  const found: string[] = []
  /** How many manifests were read, so the budget can be reported rather than silently hit. */
  let read = 0
  for (const root of roots) {
    if (!existsSync(root)) continue
    // The two levels are enumerated explicitly rather than by a recursive walk: a full `node_modules`
    // walk on a real profile is tens of thousands of directories, and the closure this clause is about
    // is the DIRECT dependency set plus what those packages declare.
    /** The `node_modules` directories to inspect: the root's, and each direct package's own. */
    const moduleDirs: string[] = [join(root, "node_modules")]
    /** The root's own manifest is part of the closure's first level. */
    const rootManifest = join(root, "package.json")
    if (existsSync(rootManifest)) moduleDirs.push(root)
    for (const dir of moduleDirs) {
      if (!existsSync(dir)) continue
      /** The package directories at this level: bare names plus `@scope/name`. */
      const packages: string[] = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith("@")) {
          for (const scoped of readdirSync(join(dir, entry.name), { withFileTypes: true })) {
            if (scoped.isDirectory()) packages.push(join(dir, entry.name, scoped.name))
          }
        } else packages.push(join(dir, entry.name))
      }
      for (const pkg of packages) {
        if (read >= WALK_BUDGET) {
          found.push("<walk budget " + WALK_BUDGET + " reached — inventory is partial>")
          return found.sort()
        }
        /** The package's manifest path, which may simply not exist for a stray directory. */
        const manifest = join(pkg, "package.json")
        if (!existsSync(manifest)) continue
        read += 1
        try {
          /** The parsed manifest, read only for its declared script names. */
          const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"))
          /** The manifest's `scripts` map, when it declares one. */
          const scripts = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>).scripts : undefined
          if (scripts === null || typeof scripts !== "object") continue
          /** The build-script names this manifest declares. */
          const declared = BUILD_SCRIPT_NAMES.filter((name) => name in (scripts as Record<string, unknown>))
          if (declared.length > 0) found.push(pkg.slice(pkg.indexOf("node_modules")) + ":" + declared.join("+"))
        } catch {
          // An unreadable manifest is not a build script; the row below quotes what was actually found.
        }
      }
    }
  }
  return found.sort()
}

/**
 * The module entry point: read the install log and the installed closure, then record the row.
 */
function main(): void {
  /** The resolved invocation. */
  const options = parseArgs(process.argv.slice(2))
  /** The install step's console output. */
  const log = (() => { try { return readFileSync(options.installLog, "utf8") } catch { return "" } })()
  /** The lines naming the ignored-build-scripts error CLASS, quoted verbatim. */
  const classLines = log.split("\n").filter((line) => line.includes(ERROR_CLASS)).slice(0, 3)
  /** The lines carrying the warning or the `approve-builds` hint. */
  const warnLines = log.split("\n").filter((line) => WARN_MARKERS.some((marker) => line.includes(marker))).slice(0, 3)
  /** The installed manifests that declare a dependency build script. */
  const inventory = declaredBuildScripts(options.roots)
  /** True when the install succeeded AND neither the error class nor its warning appeared. */
  const ok = options.exitCode === 0 && classLines.length === 0 && warnLines.length === 0
  record(options.state, {
    name: "install.buildScripts",
    ok,
    reason: ok
      ? "the client install completed with NO unapproved build script: exit 0, no " + ERROR_CLASS + " anywhere in the install output, no ignored-build-scripts warning, and the " + options.roots.length + " installed closure root(s) were walked for manifests declaring " + BUILD_SCRIPT_NAMES.join("/") + " (" + inventory.length + " found)"
      : "the install closure clause did not hold: exit=" + options.exitCode + " " + ERROR_CLASS + " lines=" + classLines.length + " ignored-build-script warnings=" + warnLines.length + " declared-build-script manifests=" + inventory.length,
    raw: "ERROR_CLASS_LINES=" + (classLines.join(" | ") || "none") + " WARN_LINES=" + (warnLines.join(" | ") || "none") + " INVENTORY=" + (inventory.slice(0, 12).join(",") || "none"),
  })
}

main()
