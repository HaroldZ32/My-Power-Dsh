// T-43 real-home guard — PERMANENT both-sides spawn-shape arms (t67).
//
// Why this file exists: the guard shipped with NO test in this package, and the only verification that
// existed mutated `process.env.HOME` inside a running process. Under bun `os.homedir()` is frozen at
// process start, so that shape differed from every real boot and the cases passed while a sandboxed
// boot was refused (403 real-home-refused naming the SANDBOX). The durable pin therefore has to run
// the arms the way production does: a CHILD process, environment set AT SPAWN, and the observable
// surface (ALLOWED vs the refusal's code) asserted — never an internal variable.
//
// Two guards against the pin rotting into a tautology:
//   · the CONTROL arm table (a table without the sandbox-allowed arm is reported as HIDING the defect),
//   · a FALSIFIABILITY check that runs the same arms against the PRE-fix predicate and requires the
//     sandbox arm to FAIL there.
import { describe, expect, test } from "bun:test"
import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"

/** This package's directory, derived from the test file's own location. */
const PLUGIN = dirname(import.meta.dir)
/** The built artifact the arms import: the shipped dist, never a src re-implementation. */
const DIST = join(PLUGIN, "dist", "index.js")

/** One probe, spawned per arm: it imports the artifact under test and reports the observable surface. */
const PROBE = `
import { pathToFileURL } from "node:url"
// pathToFileURL: node's ESM loader refuses a bare Windows path
// (ERR_UNSUPPORTED_ESM_URL_SCHEME, received protocol "c:"), which broke every node arm.
const { assertMutationSandboxed } = await import(pathToFileURL(process.env.ARM_DIST).href)
try { assertMutationSandboxed("suite arm probe"); console.log("ALLOWED") }
catch (e) { console.log("REFUSED:" + (e.status ?? "?") + ":" + (e.code ?? "?")) }
`

/** One row of the control table: what the arm expected, what it observed, and whether it can discriminate. */
export type ArmRow = { id: string; expect: "ALLOWED" | "REFUSED"; got: string; discriminating?: boolean }

/**
 * The control's rule, kept as a function so a test can prove it discriminates: a table HIDES the defect
 * when it passes while containing no DISCRIMINATING arm — one whose outcome differs between the fixed
 * and the pre-fix predicate. Only the sandbox arm qualifies: the override arm also expects ALLOWED but
 * short-circuits before the real-home check, so it stays green under the defect and cannot discriminate.
 */
export function armTableVerdict(rows: ArmRow[]): { ok: boolean; oneSided: boolean } {
  /** True only when every arm in the table produced the outcome it expected. */
  const ok = rows.every((r) => r.got === r.expect)
  return { ok, oneSided: ok && !rows.some((r) => r.discriminating === true) }
}

/** The runtimes that can actually execute the probe here: both are probed, never assumed. */
function runtimes(): string[] {
  /** The runtimes whose version probe succeeded, in probe order. */
  const out: string[] = []
  for (const rt of ["node", "bun"]) {
    /** The version probe for this runtime; a non-zero status drops the runtime from the arm matrix. */
    const probe = spawnSync(rt, ["--version"], { encoding: "utf8", timeout: 20000 })
    if (probe.status === 0) out.push(rt)
  }
  return out
}

/** Runs one arm in a CHILD process — the shape production uses — and reduces its output to an observable verdict. */
function spawnArm(runtime: string, probe: string, dist: string, env: Record<string, string>, unsetHome: boolean): string {
  /** The child environment: the parent's variables plus the arm's, so PATH and friends survive. */
  const fullEnv: Record<string, string> = { ...(process.env as Record<string, string>), ARM_DIST: dist, ...env }
  if (unsetHome) delete fullEnv.HOME
  /** The child's raw result, reduced below to ALLOWED / REFUSED:<status>:<code> / ERROR:<detail>; a failed
   * spawn reports a NodeJS.ErrnoException, whose `code` names the failure. */
  const r: SpawnSyncReturns<string> & { error?: NodeJS.ErrnoException } = spawnSync(runtime, [probe], { env: fullEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 })
  /** The probe's last stdout line, the only surface the child is allowed to report through. */
  const line = (r.stdout || "").trim().split("\n").pop() || ""
  if (line.startsWith("ALLOWED")) return "ALLOWED"
  if (line.startsWith("REFUSED")) return line
  return "ERROR:" + (r.error ? String(r.error.code) : (r.stderr || "").trim().slice(0, 120))
}

/** The pre-fix predicate, verbatim in behaviour: this is what the arms must be able to catch. */
const PRE_FIX_GUARD = `
import { homedir } from "node:os"
import { join, resolve, sep } from "node:path"
export function assertMutationSandboxed(operation) {
  const dshHome = process.env.DSH_HOME
  if (dshHome === undefined || dshHome === "") return
  if (process.env.MPD_DSH_WORKMATE_ALLOW_REAL_HOME === "1") return
  const root = join(process.env.HOME || homedir(), ".mpd", "workmate")
  const home = process.env.HOME
  // The pre-fix predicate derived its "real home" from $HOME exactly as the guard derived the
  // library root, which is the tautology the arms must catch. os.homedir() reads $HOME on POSIX
  // but %USERPROFILE% on win32, so a faithful port of the DEFECT has to name the HOME-first source
  // explicitly (otherwise the arm proves nothing on Windows).
  const realHome = process.env.HOME || homedir()
  const inside = (h) => root === h || root.startsWith(h.endsWith(sep) ? h : h + sep)
  if (home !== undefined && home !== "" && resolve(home) !== resolve(realHome) && inside(resolve(home))) return
  const e = new Error("refusing to " + operation + " inside the REAL library " + root)
  e.status = 403; e.code = "real-home-refused"
  throw e
}
`

describe("T-43 real-home guard — both sides, in the shape production uses", () => {
  /** The per-run scratch tree holding both sandbox homes and both probe modules. */
  const work = mkdtempSync(join(tmpdir(), "sandbox-guard-"))
  WORKDIR = work
  /** The sandbox $HOME the sandbox-allowed arm points at. */
  const sandboxHome = join(work, "home")
  /** The sandbox $DSH_HOME that makes the child look isolated to the guard. */
  const dshHome = join(work, "dsh")
  mkdirSync(sandboxHome, { recursive: true })
  mkdirSync(dshHome, { recursive: true })
  /** The artifact probe module, written out so a child can import it by URL. */
  const probe = join(work, "probe.ts")
  writeFileSync(probe, PROBE)
  /** The pre-fix guard module the falsifiability arm runs the same probes against. */
  const preFix = join(work, "pre-fix-guard.mjs")
  writeFileSync(preFix, PRE_FIX_GUARD)
  // The real user home must be HOME-independent for the arm's expectation to mean anything.
  const realHome = (() => {
    /** A passwd-derived home probe, independent of $HOME by construction. */
    const r = spawnSync("node", ["-e", "process.stdout.write(require('node:os').userInfo().homedir)"], { encoding: "utf8", timeout: 20000 })
    if (r.status === 0 && r.stdout) return r.stdout.trim()
    // node's passwd emulation can fail on a Windows host (`uv_os_get_passwd returned ENOMEM`),
    // which used to fall back to the POSIX literal "/root" — a path that is not the real home
    // anywhere on Windows and made the real-home arm expect the wrong outcome. `homedir()` is
    // HOME-INDEPENDENT there (%USERPROFILE%), which is exactly what this arm needs.
    return homedir()
  })()

  /** The control table: one row per environment shape the guard must answer differently for. */
  const ARMS: Array<{ id: string; label: string; expect: "ALLOWED" | "REFUSED"; env: Record<string, string>; unsetHome?: boolean }> = [
    { id: "sandbox", label: "sandbox HOME + DSH_HOME -> ALLOWED (the recipe the manual prescribes)", expect: "ALLOWED", env: { HOME: sandboxHome, DSH_HOME: dshHome } },
    { id: "home-unset", label: "HOME unset + DSH_HOME -> REFUSED", expect: "REFUSED", env: { DSH_HOME: dshHome }, unsetHome: true },
    { id: "real-home", label: "real HOME + DSH_HOME -> REFUSED 403 real-home-refused", expect: "REFUSED", env: { HOME: realHome, DSH_HOME: dshHome } },
    { id: "override", label: "sandbox HOME + explicit override -> ALLOWED", expect: "ALLOWED", env: { HOME: sandboxHome, DSH_HOME: dshHome, MPD_DSH_WORKMATE_ALLOW_REAL_HOME: "1" } }
  ]

  for (const runtime of runtimes()) {
    for (const arm of ARMS) {
      test(`${runtime}: ${arm.label}`, () => {
        /** The arm's observed outcome, compared against the table's expectation. */
        const got = spawnArm(runtime, probe, DIST, arm.env, arm.unsetHome === true)
        expect(got === arm.expect || (arm.expect === "REFUSED" && got.startsWith("REFUSED"))).toBe(true)
        if (arm.expect === "REFUSED" && arm.id === "real-home") expect(got).toContain("403")
      })
    }
  }

  test("CONTROL: a one-sided arm table is reported as HIDING the defect (the t23 failure shape)", () => {
    /** A table containing the discriminating sandbox-allowed arm — the shape that can catch the defect. */
    const full: ArmRow[] = [
      { id: "sandbox", expect: "ALLOWED", got: "ALLOWED", discriminating: true },
      { id: "home-unset", expect: "REFUSED", got: "REFUSED" },
      { id: "real-home", expect: "REFUSED", got: "REFUSED" },
      { id: "override", expect: "ALLOWED", got: "ALLOWED" }
    ]
    // Dropping the discriminating (sandbox-allowed) arm leaves every remaining arm green — the false
    // green the original in-process cases produced — and the verdict must call that out.
    const oneSided = full.filter((r) => r.discriminating !== true)
    expect(armTableVerdict(oneSided).ok).toBe(true)
    expect(armTableVerdict(oneSided).oneSided).toBe(true)
    expect(armTableVerdict(full).ok).toBe(true)
    expect(armTableVerdict(full).oneSided).toBe(false)
    // And when the defect is present, the discriminating arm is what breaks that false green:
    const caught: ArmRow[] = [{ ...full[0], got: "REFUSED:403:real-home-refused" }, ...oneSided]
    expect(armTableVerdict(caught).ok).toBe(false)
  })

  test("FALSIFIABILITY: the same arms FAIL against the pre-fix predicate (homedir() follows $HOME)", () => {
    /** The pre-fix outcome for the sandbox arm, which must be a refusal. */
    const got = spawnArm("node", probe, preFix, { HOME: sandboxHome, DSH_HOME: dshHome }, false)
    expect(got.startsWith("REFUSED")).toBe(true) // the defect the arms exist to catch
    expect(got).toContain("403")
  })

  test("the artifact under test is the package's own dist (no src/dist write from this suite)", () => {
    expect(DIST.endsWith(join("packages", "mpd-workmate-plugin", "dist", "index.js"))).toBe(true)
  })
})

/** The scratch tree cleaned up at process exit; undefined until the describe body has run. */
let WORKDIR: string | undefined

process.on("exit", () => {
  // best effort: the temp tree lives outside the workspace and carries no state worth keeping
  try { if (WORKDIR !== undefined) rmSync(WORKDIR, { recursive: true, force: true }) } catch { /* ignore */ }
})
