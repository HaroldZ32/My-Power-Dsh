#!/usr/bin/env node
// Case dshgo-standard: the DSH-Go conformance HARD gate, exercised from the QA plane.
//
// WHY THIS CASE EXISTS: `scripts/verify-dshgo-standard.ts` is a gate with an exit contract
// (0 legal / 1 violations / 2 cannot-run / 3 NOT-PASSED). A gate whose contract no second surface
// measures is a claim, not a requirement: this case runs the gate as a CHILD, judges the result
// against that contract in BOTH cross-check directions, and additionally proves the gate can FAIL by
// pointing it at a deliberately broken fixture (the negative control). It writes
// `evidence/dshgo/standard/<timestamp>/{result.json,output.log}`.
//
// WHAT IT PROVES, and what it deliberately does not:
//   * the SHIPPED package passes the static lanes (manifest, views, compatibility, host half);
//   * with `MPD_DSHGO_KIT` set, the gate exits 0 and its cross-check lane says PASSED;
//   * with it unset, the gate exits 3 (NOT-PASSED) — never 0 — and says so;
//   * a package with a duplicate contribution id makes the gate exit 1 and name `id-duplicate`.
// It does NOT render a panel on a device and does NOT replace the gate's own `--self-test`.
//
// No prerequisite is required: the case is static (no dsh boot, no network, no credentials), so it
// never emits an `[mpd-qa] SKIP` marker. `MPD_DSHGO_KIT` changes WHICH branch is asserted, not
// whether the case can run.
//
// Usage:
//   node skills/dsh-qa/scripts/dshgo-standard.ts              run the case, write evidence
//   node skills/dsh-qa/scripts/dshgo-standard.ts --self-test  offline arms over the judge + fixture
//   node skills/dsh-qa/scripts/dshgo-standard.ts --help
//
// Exit codes: 0 the case held · 1 the case found a violation · 2 the case itself could not run.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

/** The line prefix every verdict this case prints carries. */
const TAG: string = "[dshgo-standard]"
/** The repository root, derived from this script's own URL (four directories up). */
const REPO_ROOT: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The gate this case drives. */
const GATE: string = join(REPO_ROOT, "scripts", "verify-dshgo-standard.ts")
/** The env var that selects the cross-check branch. */
const KIT_ENV: string = "MPD_DSHGO_KIT"
/** This case's exit contract. */
const EXIT = { OK: 0, FAIL: 1, CANNOT_RUN: 2 } as const
/** The evidence directory family this case writes under. */
const EVIDENCE_SLUG: string = join("dshgo", "standard")

/** Why the gate's `--json` report could not be read: absent from disk, or a JSON.parse failure. */
type ReportProblem = { readonly kind: "missing" } | { readonly kind: "unparsable"; readonly message: string }

/** One gate invocation's observed result. */
interface GateRun {
  /** The exit status, or null when the child never exited (a timeout or a spawn failure). */
  readonly status: number | null
  /** The signal that ended the child, or null when it exited on its own. */
  readonly signal: string | null
  /** The spawn failure flattened to `code: message`, or null when the child really ran. */
  readonly error: string | null
  /** Whether spawnSync's own timeout killed the child — a TIMEOUT, never a gate verdict. */
  readonly timedOut: boolean
  /** Captured stdout. */
  readonly stdout: string
  /** Captured stderr. */
  readonly stderr: string
  /** The `--json` report the gate wrote, when it wrote one. */
  readonly report: unknown
  /** Why the report is not readable, or null when it parsed as a JSON document. */
  readonly reportProblem: ReportProblem | null
}

/** One judged assertion: its name, whether it held, and the observed detail. */
interface Check {
  /** The assertion's stable name. */
  readonly name: string
  /** Whether it held. */
  readonly ok: boolean
  /** The observed value, quoted so a reader can verify without re-running. */
  readonly detail: string
}

/** Run the gate as a child over one package root, capturing its exit code, attribution and JSON report. */
function runGate(root: string, jsonPath: string): GateRun {
  /** The child's arguments. */
  const argv = [GATE, "--root", root, "--json", jsonPath]
  /** The child's completed run. */
  const res = spawnSync(process.execPath, argv, { encoding: "utf8", timeout: 180000, maxBuffer: 32 * 1024 * 1024 })
  /** The spawn failure flattened to one attributable string, or null when the child really ran. */
  const error = res.error === undefined ? null : `${(res.error as NodeJS.ErrnoException).code ?? "ERROR"}: ${res.error.message}`
  // FINDING B1 (PR #103, CodeRabbit round 1): spawnSync answers `status: null` when ITS OWN 180 s
  // timeout kills the child, and every downstream exit check then reads `exit = null` — a TIMEOUT
  // looked exactly like a gate VIOLATION. `ETIMEDOUT` on the spawn error is the authoritative flag
  // (it is what the timeout path sets); the signal is recorded beside it for the same reason.
  /** Whether spawnSync's own timeout killed the child, never the gate's verdict. */
  const timedOut = (res.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT"
  /** The JSON report the gate wrote, when it wrote one. */
  let report: unknown
  /** Why the report is not readable, or null when it parsed. */
  let reportProblem: ReportProblem | null = null
  if (!existsSync(jsonPath)) {
    reportProblem = { kind: "missing" }
  } else {
    try {
      report = JSON.parse(readFileSync(jsonPath, "utf8"))
    } catch (cause) {
      reportProblem = { kind: "unparsable", message: cause instanceof Error ? cause.message : String(cause) }
    }
  }
  return {
    status: res.status,
    signal: res.signal,
    error,
    timedOut,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    report,
    reportProblem,
  }
}

/** Render one run's exit attribution — status, signal, timeout flag, spawn error — for a log line. */
function runDetail(run: GateRun): string {
  return `exit=${String(run.status)} signal=${run.signal ?? "none"} timedOut=${String(run.timedOut)} error=${run.error ?? "none"}`
}

/** Name what a parsed `--json` value actually is, so a non-report shape is quoted, not guessed. */
function reportShape(report: unknown): string {
  if (report === null) return "null"
  if (Array.isArray(report)) return "an array"
  return `a ${typeof report}`
}

/**
 * Judge the gate's `--json` report: ONLY a non-null, non-array object is a parsable report.
 *
 * WHY THE SHAPE MATTERS (review finding B2, PR #103 round 1): a JSON `null`, array or primitive is a
 * VALID JSON document that carries no lanes, so the old `!== null`-shaped predicate admitted shapes
 * the rest of the judge then read as unreadable. The detail names WHICH failure was observed —
 * missing, unparsable, or a non-object — so a broken `--json` write is attributable.
 * @param run - the gate invocation under judgement.
 * @returns the `gate.report.parseable` check, with the observed shape or failure in its detail.
 */
function reportCheck(run: GateRun): Check {
  if (run.reportProblem?.kind === "missing") {
    return { name: "gate.report.parseable", ok: false, detail: "the gate wrote no --json report (the file is absent)" }
  }
  if (run.reportProblem?.kind === "unparsable") {
    return { name: "gate.report.parseable", ok: false, detail: `the gate's --json report is unparsable: ${run.reportProblem.message}` }
  }
  if (typeof run.report !== "object" || run.report === null || Array.isArray(run.report)) {
    return { name: "gate.report.parseable", ok: false, detail: `the gate's --json report parsed as ${reportShape(run.report)} — not a report object` }
  }
  return { name: "gate.report.parseable", ok: true, detail: "report parsed as an object" }
}

/** The gate's exit code and its cross-check status, read out of its report. */
function crossCheckStatus(report: unknown): string {
  if (typeof report !== "object" || report === null || Array.isArray(report)) return "unreadable"
  /** The report's cross-check object. */
  const cross = (report as { crossCheck?: unknown }).crossCheck
  if (typeof cross !== "object" || cross === null) return "unreadable"
  /** The status the lane recorded. */
  const status = (cross as { status?: unknown }).status
  return typeof status === "string" ? status : "unreadable"
}

/** Count the failing findings the static lanes recorded. */
function staticErrors(report: unknown): number {
  if (typeof report !== "object" || report === null) return -1
  /** The report's lanes. */
  const lanes = (report as { lanes?: unknown }).lanes
  if (!Array.isArray(lanes)) return -1
  /** The running count. */
  let total = 0
  for (const lane of lanes) {
    if (typeof lane !== "object" || lane === null) continue
    /** The lane's findings. */
    const findings = (lane as { findings?: unknown }).findings
    if (!Array.isArray(findings)) continue
    for (const finding of findings) {
      if (typeof finding === "object" && finding !== null && (finding as { severity?: unknown }).severity === "error") total += 1
    }
  }
  return total
}

/** Judge one gate run against the contract this case asserts. */
function judge(kitPresent: boolean, gate: GateRun): Check[] {
  /** The observed cross-check status. */
  const cross = crossCheckStatus(gate.report)
  /** The observed static error count. */
  const errors = staticErrors(gate.report)
  /** The checks, in report order. */
  const checks: Check[] = [
    reportCheck(gate),
    { name: "gate.static.errors", ok: errors === 0, detail: `static error findings = ${errors}` },
    // An explicit TIMEOUT check, so a killed child can never be credited as a pass by an exit-status
    // predicate that happens to tolerate `null`: the attribution is asserted, not inferred.
    { name: "gate.timeout", ok: !gate.timedOut, detail: `${runDetail(gate)} (a timeout is never a gate verdict)` },
  ]
  if (kitPresent) {
    checks.push({ name: "gate.crosscheck.present", ok: cross === "passed", detail: `cross-check status = ${cross}` })
    checks.push({ name: "gate.exit.legal", ok: gate.status === 0, detail: `exit = ${String(gate.status)} (${runDetail(gate)})` })
  } else {
    checks.push({ name: "gate.crosscheck.absent", ok: cross === "not-passed", detail: `cross-check status = ${cross}` })
    checks.push({ name: "gate.exit.not-passed", ok: gate.status === 3, detail: `exit = ${String(gate.status)} (${runDetail(gate)}; a missing official checkout must exit 3, never 0)` })
  }
  return checks
}

/** Write one deliberately broken package under a temp dir and return its path. */
function brokenFixture(base: string): string {
  /** The fixture's own directory. */
  const dir = join(base, "broken")
  mkdirSync(dir, { recursive: true })
  /** A manifest with one id declared twice, which the standard calls an ERROR. */
  const manifest = {
    engines: { dsh: ">=0.2.1-rc.5 <0.3.0" },
    dsh: { bundle: { patch: ["./cordis.patch.yml"] } },
    dshGo: {
      v: 1,
      contributes: {
        panels: [{ id: "dup", placement: ["session.tab"] }],
        "composer.strip": [{ id: "dup", text: "—" }],
      },
    },
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2))
  writeFileSync(join(dir, "cordis.patch.yml"), "# fixture\n")
  return dir
}

/** Append one line to the run's human log (also echoed to stdout). */
function logLine(lines: string[], line: string): void {
  lines.push(line)
  console.log(line)
}

/** The product of one case run: its checks, the gate runs and the evidence text. */
interface CaseOutcome {
  /** Every check the run judged. */
  readonly checks: readonly Check[]
  /** The gate run over the shipped tree. */
  readonly gate: GateRun
  /** The gate run over the broken fixture (the negative control). */
  readonly control: GateRun
  /** The human log the run printed. */
  readonly lines: readonly string[]
  /** The evidence directory the run wrote its artefacts into. */
  readonly evidence: string
}

/** Run the whole case: the shipped tree, the broken control, and the judgement. */
function runCase(): CaseOutcome {
  /** The temp root the broken fixture lives under. */
  const base = mkdtempSync(join(tmpdir(), "dshgo-qa-"))
  /** The lines this run printed. */
  const lines: string[] = []
  /** The evidence dir for the run's JSON artefacts. */
  const evidence = join(REPO_ROOT, "evidence", EVIDENCE_SLUG, new Date().toISOString().replace(/[:.]/g, "-"))
  mkdirSync(evidence, { recursive: true })
  try {
    /** The gate run over the repository. */
    const gate = runGate(REPO_ROOT, join(evidence, "gate.json"))
    /** Whether a cross-check checkout was supplied to this run. */
    const kitPresent = (process.env[KIT_ENV] ?? "") !== ""
    logLine(lines, `${TAG} gate: ${runDetail(gate)} cross-check=${crossCheckStatus(gate.report)} static-errors=${staticErrors(gate.report)} kit=${kitPresent ? "present" : "absent"}`)
    /** The contract checks. */
    const checks: Check[] = [...judge(kitPresent, gate)]
    /** The negative control: a duplicate id must make the gate fail. */
    const control = runGate(brokenFixture(base), join(evidence, "control.json"))
    logLine(lines, `${TAG} negative control: ${runDetail(control)} names-id-duplicate=${String(control.stdout.includes("id-duplicate"))}`)
    checks.push({ name: "control.exit.violations", ok: control.status === 1, detail: `exit = ${String(control.status)} (${runDetail(control)})` })
    checks.push({ name: "control.rule.id-duplicate", ok: control.stdout.includes("id-duplicate"), detail: control.stdout.includes("id-duplicate") ? "the gate named id-duplicate" : "the gate did not name id-duplicate" })
    return { checks, gate, control, lines, evidence }
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

/** Write the run's evidence: result.json plus the captured output log. */
function writeEvidence(outcome: CaseOutcome): string {
  /** The evidence dir this run writes into (the gate's own --json files already sit there). */
  const evidence = outcome.evidence
  /** Whether every check held. */
  const ok = outcome.checks.every((check: Check): boolean => check.ok)
  writeFileSync(join(evidence, "result.json"), JSON.stringify({
    case: "dshgo-standard",
    at: new Date().toISOString(),
    ok,
    checks: outcome.checks,
    gateExit: outcome.gate.status,
    // FINDING B1: the exit status alone cannot tell a TIMEOUT from a VIOLATION, so every run's
    // error / signal / timedOut is recorded beside it (the log line carries the same detail).
    gate: {
      exit: outcome.gate.status,
      signal: outcome.gate.signal,
      timedOut: outcome.gate.timedOut,
      error: outcome.gate.error,
      detail: runDetail(outcome.gate),
    },
    crossCheck: crossCheckStatus(outcome.gate.report),
    controlExit: outcome.control.status,
    control: {
      exit: outcome.control.status,
      signal: outcome.control.signal,
      timedOut: outcome.control.timedOut,
      error: outcome.control.error,
      detail: runDetail(outcome.control),
    },
    kit: process.env[KIT_ENV] ?? null,
  }, null, 2))
  writeFileSync(join(evidence, "output.log"), outcome.lines.join("\n") + "\n")
  return evidence
}

/** Run the judge arms offline: a synthetic gate result per arm, each with its expected verdict. */
function selfTest(): number {
  /**
   * Build one synthetic gate run for an arm.
   * @param status - the exit status to model, `null` included.
   * @param report - the parsed report to model.
   * @param overrides - the attribution fields an arm needs to force (`timedOut`, `reportProblem`, …).
   * @returns the synthetic run, with a well-formed exit and no timeout by default.
   */
  function fakeRun(status: number | null, report: unknown, overrides: Partial<GateRun> = {}): GateRun {
    return { status, signal: null, error: null, timedOut: false, stdout: "", stderr: "", report, reportProblem: null, ...overrides }
  }
  /** A gate run that looks legal with a PASSED cross-check. */
  const legal = fakeRun(0, { crossCheck: { status: "passed" }, lanes: [{ findings: [] }] })
  /** A gate run that reports NOT-PASSED because no checkout was supplied. */
  const notPassed = fakeRun(3, { crossCheck: { status: "not-passed" }, lanes: [{ findings: [] }] })
  /** A gate run with one failing finding. */
  const red = fakeRun(1, { crossCheck: { status: "passed" }, lanes: [{ findings: [{ rule: "x", path: "p", detail: "d", severity: "error" }] }] })
  // FINDING B1: `status: null` is what spawnSync answers when ITS OWN 180 s timeout kills the child,
  // so this arm models a TIMEOUT even though the run carries no report and no exit status at all.
  /** A TIMEOUT-shaped run: killed by the cap, with no report written. */
  const timedOut = fakeRun(null, undefined, { signal: "SIGTERM", error: "ETIMEDOUT: spawnSync node ETIMEDOUT", timedOut: true, reportProblem: { kind: "missing" } })
  // FINDING B2: each of these is a VALID JSON document that carries no report at all.
  /** A `--json` file whose whole content is `null`. */
  const nullReport = fakeRun(0, null)
  /** A `--json` file whose whole content is an empty array. */
  const arrayReport = fakeRun(0, [])
  /** A `--json` file that is not JSON at all. */
  const unparsable = fakeRun(0, undefined, { reportProblem: { kind: "unparsable", message: "Unexpected end of JSON input" } })
  /** One arm: a label, the kit flag, the run it judges, whether the judgement must hold, and the checks that must FAIL by name. */
  const arms: { name: string; kit: boolean; run: GateRun; ok: boolean; mustFail?: readonly string[] }[] = [
    { name: "kit present + legal run is accepted", kit: true, run: legal, ok: true },
    { name: "kit present + a red run is refused", kit: true, run: red, ok: false },
    { name: "kit present + a NOT-PASSED run is refused (never a silent green)", kit: true, run: notPassed, ok: false },
    { name: "kit absent + NOT-PASSED exit 3 is accepted as the contract", kit: false, run: notPassed, ok: true },
    { name: "kit absent + a green exit 0 is refused", kit: false, run: legal, ok: false },
    { name: "kit present + a TIMED-OUT run is refused (a timeout is never a pass)", kit: true, run: timedOut, ok: false, mustFail: ["gate.timeout"] },
    { name: "kit absent + a TIMED-OUT run is refused (a timeout is never a pass)", kit: false, run: timedOut, ok: false, mustFail: ["gate.timeout"] },
    { name: "kit present + a JSON null report is refused (parseable requires an object)", kit: true, run: nullReport, ok: false, mustFail: ["gate.report.parseable"] },
    { name: "kit present + a JSON array report is refused (parseable requires an object)", kit: true, run: arrayReport, ok: false, mustFail: ["gate.report.parseable"] },
    { name: "kit present + an unparsable report is refused", kit: true, run: unparsable, ok: false, mustFail: ["gate.report.parseable"] },
  ]
  /** Arms that did not behave as declared. */
  const failures: string[] = []
  for (const arm of arms) {
    /** Every check the judge produced for this arm. */
    const judged = judge(arm.kit, arm.run)
    /** Whether every check the judge produced held. */
    const held = judged.every((check: Check): boolean => check.ok)
    /** Whether each check the arm NAMED really failed, in the arm's own order. */
    const named = (arm.mustFail ?? []).map((name: string): boolean => judged.some((check: Check): boolean => check.name === name && !check.ok))
    /** Whether the overall verdict AND every named check behaved as the arm declared. */
    const armHeld = held === arm.ok && named.every((didFail: boolean): boolean => didFail)
    /** The named checks rendered as `name=failed|held`, empty when the arm names none. */
    const namedDetail = (arm.mustFail ?? []).map((name: string, index: number): string => `${name}=${named[index] ? "failed" : "held"}`).join(", ")
    console.log(`${armHeld ? "PASS" : "FAIL"}  ${arm.name} — judged ${held ? "ok" : "violation"}${namedDetail === "" ? "" : `; named ${namedDetail}`}`)
    if (!armHeld) failures.push(arm.name)
  }
  /** The real negative control, so the judge is not the only thing tested. */
  const base = mkdtempSync(join(tmpdir(), "dshgo-qa-self-test-"))
  try {
    /** The gate over a deliberately broken package. */
    const control = runGate(brokenFixture(base), join(base, "control.json"))
    /** Whether the gate both exited 1 and named the rule. */
    const ok = control.status === 1 && control.stdout.includes("id-duplicate")
    console.log(`${ok ? "PASS" : "FAIL"}  the real gate fails a broken package — exit=${String(control.status)}`)
    if (!ok) failures.push("real broken-package control")
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
  if (failures.length > 0) {
    console.log(`${TAG} SELF-TEST FAILED — ${failures.join("; ")}`)
    return EXIT.FAIL
  }
  console.log(`${TAG} SELF-TEST PASS — ${arms.length + 1} arms (${arms.length} judge controls + 1 real broken-package control)`)
  return EXIT.OK
}

/** Print the flags a caller may use. */
function usage(): void {
  console.log("usage: node skills/dsh-qa/scripts/dshgo-standard.ts [--self-test]")
  console.log("       set MPD_DSHGO_KIT=<dsh-Go checkout> to assert the cross-checked branch")
}

/** CLI entry point: run the case or its self-test. */
function main(argv: readonly string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    usage()
    return EXIT.OK
  }
  if (argv.includes("--self-test")) return selfTest()
  if (!existsSync(GATE)) {
    console.error(`${TAG} cannot-run: ${relative(REPO_ROOT, GATE)} is missing`)
    return EXIT.CANNOT_RUN
  }
  /** The complete case run. */
  const outcome = runCase()
  /** Where the run's evidence landed. */
  const evidence = writeEvidence(outcome)
  /** Whether every check held. */
  const ok = outcome.checks.every((check: Check): boolean => check.ok)
  for (const check of outcome.checks) console.log(`${TAG} check ${check.name}: ${check.ok ? "PASS" : "FAIL"} — ${check.detail}`)
  console.log(`${TAG} evidence: ${relative(REPO_ROOT, evidence)}`)
  console.log(`${TAG} ${ok ? "PASS" : "FAIL"} case=dshgo-standard lane=real crosscheck=${crossCheckStatus(outcome.gate.report)}`)
  return ok ? EXIT.OK : EXIT.FAIL
}

process.exitCode = main(process.argv.slice(2))
