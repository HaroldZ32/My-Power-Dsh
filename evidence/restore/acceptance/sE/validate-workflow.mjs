// validate-workflow.mjs — an INDEPENDENT structural audit of `.github/workflows/docker-e2e.yml`.
//
// WHY THIS EXISTS. `node scripts/verify-workflows.ts` (the aggregate's `workflows` member) proves the
// file is LOADABLE YAML with a sane job/step shape; it deliberately says nothing about WHAT the
// workflow is supposed to do. This audit asserts the intent: the triggers we chose, the flags the lane
// needs, the artifact, the timeouts — and it EXTRACTS the last step's `run:` body verbatim so the very
// bytes that ship are the ones rehearsed by `rehearse-print-step.sh`. It is a local check, not a gate.
//
// Usage: node evidence/restore/acceptance/sE/validate-workflow.mjs
// Exit:  0 every assertion held · 1 at least one failed (each printed with its observed value).
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** This file's directory, where the extracted rehearsal script is written. */
const HERE = dirname(fileURLToPath(import.meta.url))
/** The repository root, four levels up from `evidence/restore/acceptance/sE/`. */
const ROOT = resolve(HERE, "..", "..", "..", "..")
/** The workflow under audit. */
const WORKFLOW = join(ROOT, ".github", "workflows", "docker-e2e.yml")

/** Resolve a YAML parser the same way `scripts/verify-workflows.ts` does: repo node_modules, then a PATH `dsh`. */
function resolveParser() {
  /** Candidate require bases, in the gate's own order. */
  const bases = [join(ROOT, "package.json")]
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue
    const launcher = join(dir, "dsh")
    if (!existsSync(launcher)) continue
    let real = launcher
    try { real = realpathSync(launcher) } catch { /* keep the link path */ }
    let probe = dirname(real)
    for (let hop = 0; hop < 8; hop += 1) {
      // The gate probes the package root ITSELF plus BOTH npm layouts: the POSIX global prefix keeps
      // the package under `<prefix>/lib/node_modules`, which a bare ancestor walk never reaches.
      for (const candidate of [probe, join(probe, "node_modules", "@deepseek-ai", "dsh"), join(probe, "lib", "node_modules", "@deepseek-ai", "dsh")]) {
        const manifest = join(candidate, "package.json")
        if (!existsSync(manifest)) continue
        try { if (JSON.parse(readFileSync(manifest, "utf8")).name === "@deepseek-ai/dsh") bases.push(manifest) } catch { /* not the harness */ }
      }
      const parent = dirname(probe)
      if (parent === probe) break
      probe = parent
    }
    break
  }
  for (const base of bases) {
    try {
      const mod = createRequire(base)("js-yaml")
      if (typeof mod.load === "function") return mod.load
    } catch { /* try the next base */ }
  }
  throw new Error("no js-yaml resolved — tried: " + bases.join(" · "))
}

/** Every assertion that failed, as `path :: what was observed`. */
const failures = []
/**
 * Assert one condition.
 * @param {boolean} ok - Whether it held.
 * @param {string} what - The assertion, in one line.
 * @param {unknown} observed - The value that was actually read.
 */
function check(ok, what, observed) {
  if (ok) { console.log(`ok   ${what}`) } else { console.log(`FAIL ${what} — observed: ${JSON.stringify(observed)}`); failures.push(what) }
}

const doc = resolveParser()(readFileSync(WORKFLOW, "utf8"))
const job = doc.jobs["docker-e2e"]
const steps = job.steps
const lane = steps.find((s) => typeof s.run === "string" && s.run.includes("docker-e2e.ts"))
const upload = steps.find((s) => typeof s.uses === "string" && s.uses.includes("upload-artifact"))
const print = steps[steps.length - 1]

// ── the triggers we CHOSE, and the one we deliberately left out ──────────────────────────────────
check(typeof doc.name === "string" && doc.name === "docker-e2e", "the workflow is named docker-e2e", doc.name)
check(doc.on?.workflow_dispatch !== undefined, "workflow_dispatch is declared (on demand)", Object.keys(doc.on ?? {}))
check(doc.on?.schedule?.[0]?.cron === "41 3 * * *", "a nightly schedule is declared at 03:41 UTC", doc.on?.schedule)
check(doc.on?.push === undefined, "NO push trigger (the lane is tens of minutes)", doc.on?.push)
check(doc.on?.pull_request === undefined, "NO pull_request trigger", doc.on?.pull_request)
check(doc.on?.pull_request_target === undefined, "NO pull_request_target trigger", doc.on?.pull_request_target)
check(doc.on?.workflow_dispatch?.inputs?.npm_registry?.default === "", "the npm_registry input defaults to EMPTY (no registry forced)", doc.on?.workflow_dispatch?.inputs?.npm_registry)
check(job.env?.MPD_E2E_NPM_REGISTRY === "${{ inputs.npm_registry }}", "MPD_E2E_NPM_REGISTRY is declared from the input, never hard-coded", job.env?.MPD_E2E_NPM_REGISTRY)
check(doc.permissions?.contents === "read", "permissions are contents:read (the lane reads the repo and nothing else)", doc.permissions)

// ── the runner and the budgets ───────────────────────────────────────────────────────────────────
check(job["runs-on"] === "ubuntu-24.04", "the runner is the pinned ubuntu-24.04 label", job["runs-on"])
check(job["timeout-minutes"] === 60, "the JOB carries a 60-minute timeout", job["timeout-minutes"])
check(lane?.["timeout-minutes"] === 50, "the LANE STEP carries a 50-minute timeout", lane?.["timeout-minutes"])
check(typeof lane?.run === "string", "a step runs scripts/docker-e2e.ts", lane?.run)

// ── the flags, each with the measured fact that put it there ─────────────────────────────────────
check(lane.run.includes("--mode source"), "--mode source (builds from the checkout, needs no pushed ref)", lane.run)
check(lane.run.includes("--require-docker"), "--require-docker (a skip becomes exit 3)", lane.run)
check(lane.run.includes("--allow-rootful-docker"), "--allow-rootful-docker (a hosted runner's daemon is ROOTFUL, and the default is to SKIP it at exit 0)", lane.run)
check(lane.run.includes("--no-browser"), "--no-browser (the ui. arms are REQUIRED by default, and a null in a required arm is exit 3)", lane.run)
check(!lane.run.includes("--live"), "no --live (no API key is involved)", lane.run)
check(!lane.run.includes("--require-live"), "no --require-live", lane.run)
check(lane.run.includes("node scripts/docker-e2e.ts"), "the lane is invoked as the repository documents it", lane.run)

// ── the evidence and the readable verdict ────────────────────────────────────────────────────────
check(upload?.uses === "actions/upload-artifact@v7", "the artifact action matches this repository's v7 action pins", upload?.uses)
check(upload?.if === "always()", "the stamp directory is uploaded even when the lane is RED", upload?.if)
check(upload?.with?.path === "evidence/docker/client-install*/", "the uploaded path is the lane's own stamp directory (both case slugs)", upload?.with?.path)
check(upload?.with?.name === "docker-e2e-stamp-${{ github.run_attempt }}", "the artifact name carries run_attempt (immutable artifacts collide on a re-run)", upload?.with?.name)
check(upload?.with?.["retention-days"] === 14, "the artifact keeps a bounded retention window", upload?.with?.["retention-days"])
check(print?.if === "always()", "the row summary runs even when the lane is red", print?.if)
check(typeof print?.run === "string" && print.run.includes("process.env.GITHUB_STEP_SUMMARY") && print.run.includes("appendFileSync"), "the summary also reaches the run page's step summary", print?.run?.includes("GITHUB_STEP_SUMMARY"))
check(print.run.includes("evidence/docker/client-install*/*/"), "the summary globs the STAMP directories, not the case directories above them", print.run.split("\n")[1])

// ── every step is well formed for the gate's rules, restated here for the record ─────────────────
for (const [index, step] of steps.entries()) {
  const shape = [typeof step.uses === "string", typeof step.run === "string"].filter(Boolean).length
  check(shape === 1, `step[${index}] carries exactly one of uses/run`, step.name ?? step.uses ?? step.run?.slice(0, 20))
  check(step.name === undefined || typeof step.name === "string", `step[${index}] name is a string`, step.name)
}

// ── hand the EXACT shipped bytes of the print step to the rehearsal ──────────────────────────────
const rehearsal = join(HERE, "rehearse-print-step.sh")
writeFileSync(rehearsal, print.run.endsWith("\n") ? print.run : `${print.run}\n`)
console.log(`\nextracted ${print.run.split("\n").length} line(s) of the print step to ${rehearsal}`)
console.log(failures.length === 0 ? `\nPASS - ${steps.length} step(s) audited, every assertion held` : `\nFAIL - ${failures.length} assertion(s) failed`)
process.exitCode = failures.length === 0 ? 0 : 1
