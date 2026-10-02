#!/usr/bin/env node
// verify-workflows — every GitHub Actions workflow in `.github/workflows/` must be LOADABLE YAML
// with a sane job/step shape, because GitHub rejects an unloadable workflow AT LOAD TIME: the run
// appears, fails in 0 s, creates NO job and produces no step logs, so nothing in the repository ever
// reddens (friction item: measured 2026-10-02).
//
// WHY THIS GATE EXISTS — THE MEASURED DEFECT. `.github/workflows/gates.yml` carried the step
//
//     - name: Install the toolchain (dev dependencies: tsgo and the AST checker's typescript)
//
// and an unquoted YAML scalar containing `: ` starts a nested mapping. The document was therefore
// invalid, and EVERY push from 2026-09-28 to 2026-10-02 produced the same silent outcome: a run that
// failed in 0 s with zero jobs and the banner "This run likely failed because of a workflow file
// issue". Five pushes, four of them on `dev`/`master`, and no gate could see it — the repository's
// gates run INSIDE the workflow, so a workflow that never loads disables every one of them at once.
// The step-level defects fixed in the same wave (a stale `bun.lock`, two aggregate members that read
// state a bare runner lacks) could not even show themselves until the file parsed.
//
// WHAT IT CHECKS (every assertion is a real failure mode, not a style preference):
//   1. the file parses with a REAL YAML parser — the class the defect belongs to;
//   2. the parsed document is an object carrying `name`, `on` and a non-empty `jobs` mapping;
//   3. `on` is not the YAML 1.1 boolean `true` (a quoted or plain `on:` is a string under the
//      loader GitHub uses, but a schema that resolves it to a boolean makes the trigger block
//      meaningless);
//   4. every job has a `runs-on` scalar and a non-empty `steps` array;
//   5. every step is an object carrying EXACTLY one of `uses`/`run`, and its `name`, when present,
//      is a STRING — `name:` followed by a nested mapping is the same defect one indentation level
//      deeper, and it parses silently where the historical line did not;
//   6. the workflow directory holds at least one workflow (a zero-subject run must never report PASS).
//
// WHERE THE YAML PARSER COMES FROM. This repository has no YAML dependency of its own (zero runtime
// deps is the rule, `scripts/` uses Node builtins plus `scripts/lib/`). The parser is therefore
// resolved from the INSTALLED harness — the same source `skills/dsh-qa/scripts/preset-conformance.ts`
// reads its schemas from — with two further routes for a machine that lays things out differently:
// an explicit `MPD_WORKFLOW_JS_YAML` path, then the repository's own `node_modules/js-yaml`. A run
// that finds NO parser FAILS BY NAME: a gate that silently skips when its tool is missing is the
// defect class this repository keeps re-learning (an unreadable subject is not a green subject).
//
// Usage:
//   node scripts/verify-workflows.ts                      audit .github/workflows of this repository
//   node scripts/verify-workflows.ts --dir <path>         audit another directory of workflow files
//   node scripts/verify-workflows.ts --self-test          every arm on TEMP fixtures (never the tree)
//   node scripts/verify-workflows.ts --help
//
// Exit codes: 0 every workflow passed (and at least one was audited) · 1 at least one violation ·
//             2 runner error (no parser, no such directory, unknown flag).
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** This file's own absolute path, the anchor the repository root is derived from. */
const SELF: string = fileURLToPath(import.meta.url)
/** The repository root, i.e. the parent of the `scripts/` directory this file lives in. */
const ROOT: string = dirname(dirname(SELF))
/** The directory audited when no `--dir` is given. */
const DEFAULT_DIR: string = join(ROOT, ".github", "workflows")
/** Line prefix every audit line carries, so an aggregate transcript stays greppable. */
const TAG: string = "[verify-workflows]"
/** Exit code contract, `as const` so the three members stay literals instead of widening. */
const EXIT = { GREEN: 0, VIOLATION: 1, RUNNER_ERROR: 2 } as const

/** One violation: the file it was found in, the JSON path inside it, and what was wrong. */
interface Violation {
  /** Workflow file the violation belongs to, as an absolute path. */
  readonly file: string
  /** Where inside the document, spelled as a dotted path (`jobs.gates.steps[3].name`). */
  readonly at: string
  /** What is wrong, in one sentence a reader can act on. */
  readonly what: string
}

/** A parser that turns workflow text into a value, or throws with the parser's own message. */
type YamlParse = (text: string) => unknown

// ── the parser, resolved (never assumed) ─────────────────────────────────────────────────────────

/**
 * The installed harness's package root, or `""` when no `dsh` launcher resolves.
 *
 * The walk mirrors `preset-conformance`'s: the PATH-resolved launcher is realpath'd, then its
 * ancestors are probed for a `package.json` naming `@deepseek-ai/dsh`, including the npm prefix's
 * own `node_modules/@deepseek-ai/dsh` child (which is where a global install puts it).
 * @returns The harness package directory, or `""`.
 */
function harnessRoot(): string {
  /** The PATH-resolved `dsh` launcher path, `""` when none exists. */
  let launcher: string = ""
  // Every PATH entry is probed for a `dsh` launcher; the first hit wins, as `which` would.
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue
    /** The candidate launcher inside this PATH entry. */
    const candidate: string = join(dir, "dsh")
    if (existsSync(candidate)) { launcher = candidate; break }
  }
  if (launcher === "") return ""
  // THE SYMLINK IS FOLLOWED FIRST, and that is the whole mechanism on POSIX: npm's launcher is a
  // link INTO the package (`<prefix>/bin/dsh -> <prefix>/lib/node_modules/@deepseek-ai/dsh/bin/…`),
  // so the realpath already lands inside the harness and the walk starts one level below its root.
  // Measured 2026-10-02: without this the walk never reaches the package and the gate reports "no
  // YAML parser could be resolved" on a machine where `dsh` is installed and on PATH.
  /** The launcher's real path, `""` when the link cannot be resolved. */
  let real: string = ""
  try { real = realpathSync(launcher) } catch { return "" }
  /** The directory the upward walk starts from (`dirname` of the resolved launcher). */
  let dir: string = dirname(real)
  for (let hop = 0; hop < 8; hop += 1) {
    /** Whether `candidate` really is the harness package (its manifest names it). */
    const isHarness = (candidate: string): boolean => {
      /** The candidate's manifest path, probed before it is read. */
      const manifest: string = join(candidate, "package.json")
      if (!existsSync(manifest)) return false
      try { return JSON.parse(readFileSync(manifest, "utf8")).name === "@deepseek-ai/dsh" } catch { return false }
    }
    if (isHarness(dir)) return dir
    // BOTH npm layouts are probed: `<dir>/node_modules/...` (a Windows prefix, or a nested install)
    // and `<dir>/lib/node_modules/...` (the POSIX global prefix).
    for (const nested of [join(dir, "node_modules", "@deepseek-ai", "dsh"), join(dir, "lib", "node_modules", "@deepseek-ai", "dsh")]) {
      if (isHarness(nested)) return nested
    }
    /** The next directory up; reaching the filesystem root ends the walk. */
    const parent: string = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ""
}

/**
 * Resolve a real YAML parser, or throw naming every route that was tried.
 *
 * The three routes, in order: the explicit `MPD_WORKFLOW_JS_YAML` path, the installed harness's own
 * `js-yaml`, and the repository's `node_modules/js-yaml`. The harness route is the one CI uses (the
 * workflow installs the harness before the aggregate runs), and it is resolved exactly the way
 * `preset-conformance` resolves its schemas.
 * @returns A function parsing workflow text into a value.
 * @throws When no route yields a `js-yaml` build.
 */
function resolveParser(): YamlParse {
  /** Every route that was tried, quoted in the failure message so the remedy is obvious. */
  const tried: string[] = []
  /** The routes as (label, require-base, bare-specifier) triples: the base is what resolution hangs
   * off, and `null` means "require the base path itself" (the override names a js-yaml DIRECTORY). */
  const routes: Array<{ label: string; base: string; specifier: string | null }> = []
  /** The explicit override path, when the caller set one. */
  const override: string | undefined = process.env.MPD_WORKFLOW_JS_YAML
  if (override !== undefined && override !== "") routes.push({ label: override, base: override, specifier: null })
  /** The installed harness root, `""` when no launcher resolves. */
  const harness: string = harnessRoot()
  if (harness !== "") routes.push({ label: `${harness}/node_modules/js-yaml (via the installed harness)`, base: join(harness, "package.json"), specifier: "js-yaml" })
  routes.push({ label: `${ROOT}/node_modules/js-yaml (via this repository)`, base: join(ROOT, "package.json"), specifier: "js-yaml" })
  for (const route of routes) {
    tried.push(route.label)
    try {
      // `createRequire` binds resolution to the base, so a harness resolves ITS OWN js-yaml rather
      // than something unrelated higher up the tree — the same mechanism
      // `skills/dsh-qa/scripts/preset-conformance.ts` uses for its schemas.
      const req = createRequire(route.base)
      /** The loaded build, read structurally because a module's exports are untyped here. */
      const mod = req(route.specifier ?? route.base) as { load?: unknown }
      if (typeof mod.load === "function") return (text: string): unknown => (mod.load as (t: string) => unknown)(text)
    } catch { /* try the next route */ }
  }
  throw new Error(
    "no YAML parser could be resolved — tried: " + tried.join(" · ")
    + " — install the harness (`npm i -g @deepseek-ai/dsh@<the pin package.json declares>`) or point"
    + " MPD_WORKFLOW_JS_YAML at a js-yaml package directory. A run without a parser FAILS rather than"
    + " skipping: an unreadable subject is not a green subject.",
  )
}

// ── the audit ────────────────────────────────────────────────────────────────────────────────────

/** Render a value's type for a message, distinguishing arrays and null from plain objects. */
function typeOf(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

/** True when `value` is a non-null, non-array object, i.e. a YAML mapping. */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Audit ONE workflow document that has already been parsed.
 * @param file - Absolute path of the file, quoted in every violation.
 * @param doc - The parsed document.
 * @returns Every violation found, in reading order.
 */
function auditDocument(file: string, doc: unknown): Violation[] {
  /** The violations collected so far. */
  const out: Violation[] = []
  if (!isMapping(doc)) {
    out.push({ file, at: "<root>", what: `the document is ${typeOf(doc)}, not a mapping` })
    return out
  }
  if (typeof doc.name !== "string" || doc.name.trim() === "") {
    out.push({ file, at: "name", what: `"name" must be a non-empty string, got ${typeOf(doc.name)}` })
  }
  // `on:` is the one key whose YAML 1.1 reading is a BOOLEAN, which silently deletes every trigger.
  if (doc.on === undefined) out.push({ file, at: "on", what: "no trigger block (`on:`) is declared" })
  else if (typeof doc.on === "boolean") out.push({ file, at: "on", what: `the trigger block parsed as the boolean ${String(doc.on)} — quote it ("on":) or use a mapping` })
  if (!isMapping(doc.jobs) || Object.keys(doc.jobs).length === 0) {
    out.push({ file, at: "jobs", what: `"jobs" must be a non-empty mapping, got ${typeOf(doc.jobs)}` })
    return out
  }
  // `jobId` is the workflow's own job key; `job` is its configuration mapping.
  for (const [jobId, job] of Object.entries(doc.jobs)) {
    /** Dotted path of this job, prefixed onto every violation below it. */
    const base: string = `jobs.${jobId}`
    if (!isMapping(job)) { out.push({ file, at: base, what: `the job is ${typeOf(job)}, not a mapping` }); continue }
    if (typeof job["runs-on"] !== "string" || job["runs-on"].trim() === "") {
      out.push({ file, at: `${base}.runs-on`, what: `"runs-on" must be a non-empty string, got ${typeOf(job["runs-on"])}` })
    }
    if (!Array.isArray(job.steps) || job.steps.length === 0) {
      out.push({ file, at: `${base}.steps`, what: `"steps" must be a non-empty array, got ${typeOf(job.steps)}` })
      continue
    }
    job.steps.forEach((step: unknown, index: number) => {
      /** Dotted path of this step, quoted by every violation it produces. */
      const at: string = `${base}.steps[${index}]`
      if (!isMapping(step)) { out.push({ file, at, what: `the step is ${typeOf(step)}, not a mapping` }); return }
      // The step name is what a human reads in the run summary; a nested mapping here is the same
      // defect the historical line caused, one indentation level deeper.
      if (step.name !== undefined && typeof step.name !== "string") {
        out.push({ file, at: `${at}.name`, what: `the step name is ${typeOf(step.name)}, not a string — quote it if it contains ": "` })
      }
      /** Whether the step carries a `uses` action reference. */
      const hasUses: boolean = typeof step.uses === "string"
      /** Whether the step carries a `run` shell body. */
      const hasRun: boolean = typeof step.run === "string"
      if (hasUses === hasRun) {
        out.push({ file, at, what: `a step needs EXACTLY one of "uses"/"run" (uses=${String(hasUses)}, run=${String(hasRun)})` })
      }
    })
  }
  return out
}

/**
 * Parse and audit every `*.yml`/`*.yaml` file of one directory.
 * @param dir - Directory to audit.
 * @param parse - The resolved YAML parser.
 * @returns Every violation found, in file-name order.
 */
function auditDirectory(dir: string, parse: YamlParse): Violation[] {
  /** The workflow files to audit, sorted so the transcript is deterministic. */
  const files: string[] = readdirSync(dir)
    .filter((name: string): boolean => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
  if (files.length === 0) {
    return [{ file: dir, at: "<dir>", what: "the workflow directory holds no .yml/.yaml file — refusing to report PASS over zero subjects" }]
  }
  /** The violations collected across every file. */
  const out: Violation[] = []
  for (const name of files) {
    /** Absolute path of the file being audited. */
    const file: string = join(dir, name)
    /** The file's text, read once for the parse. */
    const text: string = readFileSync(file, "utf8")
    try {
      out.push(...auditDocument(file, parse(text)))
    } catch (error) {
      out.push({ file, at: "<root>", what: `the file is not loadable YAML: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` })
    }
  }
  return out
}

// ── self-test ────────────────────────────────────────────────────────────────────────────────────

/** One self-test arm: a stable name plus the check returning its evidence or throwing. */
interface Arm {
  /** The arm's stable name, printed on the census line. */
  readonly name: string
  /** Run the arm's assertions and return the evidence sentence a PASS prints. */
  readonly check: (dir: string, parse: YamlParse) => string
}

/** Write one fixture workflow file and return its absolute path. */
function fixture(dir: string, name: string, text: string): string {
  /** Absolute path of the written fixture. */
  const file: string = join(dir, name)
  writeFileSync(file, text)
  return file
}

/** The historical defect, byte for byte: an unquoted step name containing `: `. */
const HISTORICAL_LINE: string = [
  "name: gates",
  "on:",
  "  push:",
  "    branches: [dev]",
  "jobs:",
  "  gates:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: Install the toolchain (dev dependencies: tsgo and the AST checker's typescript)",
  "        run: bun install --frozen-lockfile",
  "",
].join("\n")

/** The arms, each running on fixtures inside `dir` (never the live tree). */
function arms(): Arm[] {
  return [
    {
      name: "the-historical-line-really-is-unloadable",
      check: (dir, parse): string => {
        /** The fixture carrying the exact line that disabled CI for a month. */
        const file: string = fixture(dir, "historical.yml", HISTORICAL_LINE)
        // The arm is only meaningful if the PARSER rejects it: a green audit of this text would mean
        // the gate cannot see the very defect it was written for.
        let parsed = false
        try { parse(readFileSync(file, "utf8")); parsed = true } catch { /* expected */ }
        if (parsed) throw new Error("the historical step-name line parsed — this gate cannot see the defect it exists for")
        return "the unquoted `(dev dependencies: tsgo …)` step name is rejected by the parser"
      },
    },
    {
      name: "a-quoted-name-and-a-clean-file-pass",
      check: (dir, parse): string => {
        // The control: the same document with the name quoted must be clean, so the arm above is not
        // passing because everything fails.
        /** The corrected twin of the historical fixture. */
        const file: string = fixture(dir, "fixed.yml", HISTORICAL_LINE.replace("- name: Install", '- name: "Install').replace("typescript)", 'typescript)"'))
        /** The violations the corrected fixture produced. */
        const found: Violation[] = auditDirectoryContaining(dir, file, parse)
        if (found.length !== 0) throw new Error(`the corrected fixture still reports ${found.length} violation(s): ${JSON.stringify(found[0])}`)
        return "the quoted form of the same document is clean"
      },
    },
    {
      name: "a-nested-mapping-name-is-caught",
      check: (dir, parse): string => {
        // `name:` followed by an indented mapping parses FINE and is still wrong: the run summary
        // would show an object. This is the arm for the defect one indentation level deeper.
        /** The fixture whose step name is a mapping instead of a string. */
        const file: string = fixture(dir, "nested-name.yml", [
          "name: gates", "on: [push]", "jobs:", "  g:", "    runs-on: ubuntu-latest", "    steps:",
          "      - name:", "          a: b", "        run: echo hi", "",
        ].join("\n"))
        /** The violations that fixture produced. */
        const found: Violation[] = auditDirectoryContaining(dir, file, parse)
        if (!found.some((v: Violation): boolean => v.at.endsWith(".name") && v.what.includes("not a string"))) {
          throw new Error(`the nested-mapping name was not reported: ${JSON.stringify(found)}`)
        }
        return "a name that parses as a mapping is reported by path"
      },
    },
    {
      name: "missing-steps-and-missing-runs-on-are-caught",
      check: (dir, parse): string => {
        /** The fixture whose job declares neither `runs-on` nor `steps`. */
        const file: string = fixture(dir, "no-steps.yml", ["name: gates", "on: [push]", "jobs:", "  g:", "    timeout-minutes: 5", ""].join("\n"))
        /** The violations that fixture produced. */
        const found: Violation[] = auditDirectoryContaining(dir, file, parse)
        if (!found.some((v: Violation): boolean => v.at.endsWith(".runs-on")) || !found.some((v: Violation): boolean => v.at.endsWith(".steps"))) {
          throw new Error(`a job with no runs-on/steps was not reported: ${JSON.stringify(found)}`)
        }
        return "a job without runs-on and without steps reports both by path"
      },
    },
    {
      name: "a-step-with-both-uses-and-run-is-caught",
      check: (dir, parse): string => {
        /** The fixture whose single step declares both `uses` and `run`. */
        const file: string = fixture(dir, "both.yml", [
          "name: gates", "on: [push]", "jobs:", "  g:", "    runs-on: ubuntu-latest", "    steps:",
          "      - name: confused", "        uses: actions/checkout@v7", "        run: echo hi", "",
        ].join("\n"))
        /** The violations that fixture produced. */
        const found: Violation[] = auditDirectoryContaining(dir, file, parse)
        if (!found.some((v: Violation): boolean => v.what.includes("EXACTLY one"))) {
          throw new Error(`a step with both uses and run was not reported: ${JSON.stringify(found)}`)
        }
        return "a step carrying both uses and run is refused"
      },
    },
    {
      name: "a-boolean-trigger-block-is-caught",
      check: (dir, parse): string => {
        // `true` is a boolean, which is what a YAML 1.1 reading of an unquoted `on:` produces; the
        // fixture spells it explicitly so the arm does not depend on the parser's schema version.
        /** The fixture whose trigger key holds a boolean. */
        const file: string = fixture(dir, "bool-on.yml", ["name: gates", "on: true", "jobs:", "  g:", "    runs-on: ubuntu-latest", "    steps:", "      - run: echo hi", ""].join("\n"))
        /** The violations that fixture produced. */
        const found: Violation[] = auditDirectoryContaining(dir, file, parse)
        if (!found.some((v: Violation): boolean => v.at === "on" && v.what.includes("boolean"))) {
          throw new Error(`a boolean trigger block was not reported: ${JSON.stringify(found)}`)
        }
        return "a trigger block that parsed as a boolean is reported"
      },
    },
    {
      name: "an-empty-directory-is-refused",
      check: (dir, parse): string => {
        /** An empty directory, which must never report a green sweep. */
        const empty: string = mkdtempSync(join(dir, "empty-"))
        /** The violations an empty subject produced. */
        const found: Violation[] = auditDirectory(empty, parse)
        if (!found.some((v: Violation): boolean => v.what.includes("no .yml"))) {
          throw new Error(`an empty workflow directory reported: ${JSON.stringify(found)}`)
        }
        return "zero subjects are refused instead of reported green"
      },
    },
  ]
}

/**
 * Audit exactly ONE fixture file, by pointing the directory audit at a private directory holding a
 * copy of it — the arms must never see their siblings, or one arm's fixture would redden another's.
 * @param root - The arm's own scratch root.
 * @param file - The fixture to audit.
 * @param parse - The resolved YAML parser.
 * @returns The violations that file produced.
 */
function auditDirectoryContaining(root: string, file: string, parse: YamlParse): Violation[] {
  /** A private directory holding only this fixture, so sibling files cannot redden the arm. */
  const only: string = mkdtempSync(join(root, "only-"))
  writeFileSync(join(only, "case.yml"), readFileSync(file, "utf8"))
  return auditDirectory(only, parse)
}

/** Run every arm on temp fixtures and print the census; the exit code follows the arm outcomes. */
function selfTest(): void {
  /** The temp fixture root, or null while it has not been created. */
  let dir: string | null = null
  /** How many arms held. */
  let passed = 0
  /** Every arm, so the census can report `<passed>/<total>`. */
  const all: Arm[] = arms()
  try {
    dir = mkdtempSync(join(tmpdir(), "verify-workflows-self-test-"))
    /** The parser the arms audit with, resolved once through the same code the real run uses. */
    const parse: YamlParse = resolveParser()
    for (const arm of all) {
      try {
        console.log(`${TAG} self-test arm ${arm.name}: PASS - ${arm.check(dir, parse)}`)
        passed += 1
      } catch (error) {
        console.error(`${TAG} self-test arm ${arm.name}: FAIL - ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } catch (error) {
    // Only fixture setup or parser resolution can land here; both must still end in the census
    // grammar rather than an unhandled crash.
    console.error(`${TAG} self-test setup: FAIL - ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (dir !== null) rmSync(dir, { recursive: true, force: true })
  }
  console.log(`${TAG} self-test ${passed === all.length ? "PASS" : "FAIL"}: ${passed}/${all.length} arms`)
  process.exitCode = passed === all.length ? EXIT.GREEN : EXIT.RUNNER_ERROR
}

/** Parse the CLI, run the audit or a mode, and set the process exit code. */
function main(): void {
  /** This process's arguments after the script path. */
  const argv: string[] = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: node scripts/verify-workflows.ts [--dir <path>] [--self-test] [--help]")
    return
  }
  if (argv.includes("--self-test")) { selfTest(); return }
  /** The `--dir` value, or the repository's own workflow directory. */
  const dirIndex: number = argv.indexOf("--dir")
  /** The directory to audit. */
  const dir: string = resolve(dirIndex === -1 ? DEFAULT_DIR : (argv[dirIndex + 1] ?? ""))
  if (!existsSync(dir)) {
    console.error(`${TAG} no such workflow directory: ${dir}`)
    process.exitCode = EXIT.RUNNER_ERROR
    return
  }
  /** The resolved parser, or a runner error naming every route that was tried. */
  let parse: YamlParse
  try {
    parse = resolveParser()
  } catch (error) {
    console.error(`${TAG} ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = EXIT.RUNNER_ERROR
    return
  }
  /** Every violation across the audited directory. */
  const violations: Violation[] = auditDirectory(dir, parse)
  console.log(`${TAG} audited ${readdirSync(dir).filter((n: string): boolean => n.endsWith(".yml") || n.endsWith(".yaml")).length} workflow file(s) under ${dir}`)
  for (const violation of violations) console.error(`${TAG} FAIL ${violation.file} :: ${violation.at} :: ${violation.what}`)
  if (violations.length > 0) {
    console.log(`${TAG} FAIL - ${violations.length} violation(s); GitHub rejects an unloadable workflow at LOAD time, creating no job and no step logs`)
    process.exitCode = EXIT.VIOLATION
    return
  }
  console.log(`${TAG} PASS - every workflow is loadable YAML with a sane job/step shape`)
}

main()
