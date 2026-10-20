// Lane G / F3: run the standing gate sweep and file ONE evidence directory per gate.
//
// WHY A RUNNER: the plan's F3 line names eleven commands, and a verdict needs each one's OBSERVED
// exit code plus the line that decides it — not a hand-typed summary. This runner executes exactly
// the listed command (no shell, no PATH rewriting) and writes
// `evidence/harness-0.2.1/<slug>/<UTC stamp>/{result.json,output.log}` per gate.
//
// The gates are REPOSITORY gates: none of them reads the harness closure, so the harness pin cannot
// change their verdict. The two harness-facing arms (`verify:rows`, `preset-conformance`) are here
// too, and the caller decides which `dsh` is on PATH for them — the runner records the resolved
// launcher and its `--version` in every result so no row can silently certify the wrong harness.
//
// USAGE
//   node evidence/harness-0.2.1/f3-gates/run-gates.ts [--only <slug[,slug]>] [--timeout <ms>]
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** The repository root, derived from this runner's own URL (four directories up). */
const REPO_ROOT: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The evidence slug root every gate's directory is created under. */
const EVIDENCE_ROOT: string = join(REPO_ROOT, "evidence", "harness-0.2.1")
/** One gate the wave's F3 line names, spelled exactly as the plan spells it. */
interface Gate {
  /** Path-safe slug naming the evidence directory. */
  readonly slug: string
  /** The executable (resolved on PATH by the child). */
  readonly command: string
  /** Its argument vector. */
  readonly args: readonly string[]
  /** Which final-verification claim this gate answers. */
  readonly claim: string
  /** The output line that decides the verdict, matched as a regex; `""` when the exit code is the whole answer. */
  readonly decisive: string
}

/** The run stamp shared by every gate in one pass, so a wave's sweep is one timestamp. */
const RUN_STAMP: string = new Date().toISOString().replaceAll(":", "-")
/** The gate list, in the plan's own order (F1's two arms first, then F3's). */
const GATES: readonly Gate[] = [
  { slug: "verify-rows", command: "bun", args: ["run", "verify:rows"], claim: "F1", decisive: "row ids match|FAIL" },
  { slug: "preset-conformance-selftest", command: "node", args: ["skills/dsh-qa/scripts/preset-conformance.ts", "--self-test"], claim: "F1", decisive: "ok:|FAIL" },
  { slug: "bun-test", command: "bun", args: ["test"], claim: "F3", decisive: "pass|fail" },
  { slug: "typecheck", command: "bun", args: ["run", "typecheck"], claim: "F3", decisive: "" },
  { slug: "test-qa", command: "bun", args: ["run", "test:qa"], claim: "F3", decisive: "ok|FAIL" },
  { slug: "verify-dist", command: "bun", args: ["run", "verify:dist"], claim: "F3", decisive: "ok:|STALE|fresh" },
  { slug: "verify-pack-closure", command: "node", args: ["scripts/verify-pack-closure.ts"], claim: "F3", decisive: "ok|FAIL" },
  { slug: "verify-comments", command: "bun", args: ["run", "verify:comments"], claim: "F3", decisive: "ok|FAIL" },
  { slug: "verify-manifest", command: "bun", args: ["run", "verify:manifest"], claim: "F3", decisive: "ok|FAIL" },
  { slug: "verify-docs", command: "bun", args: ["run", "verify:docs"], claim: "F3", decisive: "ok|FAIL" },
  { slug: "verify-manual-paths", command: "node", args: ["scripts/verify-manual-paths.ts"], claim: "F3", decisive: "ok|FAIL" },
  { slug: "verify-no-host-override", command: "node", args: ["scripts/verify-no-host-override.ts"], claim: "F3", decisive: "ok|FAIL" },
]

/** Parse `--only` (a comma list of slugs) and `--timeout` (milliseconds). */
const argv = process.argv.slice(2)
/** The slugs this pass is restricted to; empty means every gate. */
const only: readonly string[] = argv.includes("--only") ? String(argv[argv.indexOf("--only") + 1] ?? "").split(",").filter((slug) => slug !== "") : []
/** Per-gate timeout; the default is generous because `bun test` and the pack gates are minute-scale. */
const timeoutMs: number = argv.includes("--timeout") ? Number(argv[argv.indexOf("--timeout") + 1] ?? 900000) : 900000

/** The harness launcher this pass resolves, recorded so no verdict can name the wrong harness. */
const launcher = spawnSync("bash", ["-c", "command -v dsh"], { encoding: "utf8" })
const launcherPath = (launcher.stdout ?? "").trim()
const version = launcherPath === "" ? "" : (spawnSync(launcherPath, ["--version"], { encoding: "utf8" }).stdout ?? "").trim()

const rows: Array<Record<string, unknown>> = []
for (const gate of GATES) {
  if (only.length > 0 && !only.includes(gate.slug)) continue
  const startedAt = Date.now()
  const run = spawnSync(gate.command, [...gate.args], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] })
  const output = (run.stdout ?? "") + (run.stderr ?? "")
  const exit = run.status ?? (run.signal !== null ? 3 : 2)
  const decisiveLine = gate.decisive === "" ? "" : (output.split(/\r?\n/).filter((line: string) => new RegExp(gate.decisive).test(line)).slice(-3).join("\n"))
  const dir = join(EVIDENCE_ROOT, gate.slug, RUN_STAMP)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "output.log"), "=== " + gate.command + " " + gate.args.join(" ") + " ===\n[exit " + exit + "]\n\n" + output)
  const body = {
    claim: gate.claim,
    slug: gate.slug,
    command: gate.command + " " + gate.args.join(" "),
    cwd: REPO_ROOT,
    exit,
    signal: run.signal,
    durationMs: Date.now() - startedAt,
    launcher: launcherPath,
    launcherVersion: version,
    decisiveLine,
    outputTail: output.slice(-3000),
  }
  writeFileSync(join(dir, "result.json"), JSON.stringify(body, null, 2) + "\n")
  rows.push({ claim: gate.claim, slug: gate.slug, exit, durationMs: body.durationMs, decisiveLine: decisiveLine.split("\n").pop() ?? "" })
  console.log("[" + gate.claim + "] " + gate.slug + " exit=" + exit + " (" + Math.round(body.durationMs / 1000) + "s) " + (decisiveLine.split("\n").pop() ?? ""))
}
const summaryDir = join(EVIDENCE_ROOT, "f3-gates", RUN_STAMP)
mkdirSync(summaryDir, { recursive: true })
writeFileSync(join(summaryDir, "summary.json"), JSON.stringify({ stamp: RUN_STAMP, launcher: launcherPath, launcherVersion: version, rows }, null, 2) + "\n")
console.log("\n" + JSON.stringify(rows, null, 2))
