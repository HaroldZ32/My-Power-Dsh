// t26 chunk driver — the MULTI-JOB / MULTI-RUN board for the 33-entry dsh-qa selection.
//
// WHY A DRIVER: this host kills a managed background job at a bounded lifetime (~17 min observed),
// so the 33-entry sweep cannot be one job. Each chunk is launched through the T-23 helper
// (`node scripts/mpd-bg.mjs run --log <path> -- …`) and this driver WAITS for the child inside the
// job, because the helper's detached child dies with the job's bwrap sandbox (measured: a 45 s probe
// child left a 0-byte log, no marker and a DEAD pid at the call boundary). Surviving the boundary
// would require the child to escape the sandbox, which it does not.
//
// Each chunk writes its OWN result.json (the runner's, with complete/finishedAt) into the board dir;
// a lane that dies with a killed chunk is REPORTED (reading + the run it died in) and RE-RUN alone
// in the next run. Nothing here decides a lane's verdict: the runner does, and this driver only
// copies what it read.
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "../../../..")
const MANIFEST = join(REPO, "skills/dsh-qa/cases.json")
const RUNNER = "scripts/run-qa-lanes.mjs"
const argv = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")))
const BUDGET_MS = Number(argv["budget-ms"] ?? 780_000)
const DEFAULT_LANE_TIMEOUT = Number(argv["per-lane-timeout"] ?? 300_000)
const FIXED_TIMEOUTS = { "agent-teams-dispatch": 990_000, "session-start-team": 300_000 }

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")
const manifestSha = sha(MANIFEST)
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"))
const selection = [
  ...manifest.lanes.filter((l) => (l.suites ?? []).includes("all")).map((l) => ({ case: l.case, kind: "lane", script: l.script, args: l.args ?? [] })),
  ...manifest.gates.map((g) => ({ case: g.case, kind: "gate", script: g.script, args: g.args ?? [] })),
]
// Canonical selection: the ordered (case, kind, script, args) tuple — pins differ only in prose.
const canonical = createHash("sha256")
  .update(selection.map((s) => [s.case, s.kind, s.script, JSON.stringify(s.args)].join("\u0000")).join("\n"))
  .digest("hex")

const chunksDir = join(HERE, "chunks")
mkdirSync(chunksDir, { recursive: true })
const log = (s) => { lines.push(s); console.log(s) }
const lines = []

function covered() {
  const out = new Map()
  for (const d of readdirSync(chunksDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    const rj = join(chunksDir, d.name, "result.json")
    if (!existsSync(rj)) continue
    try {
      const r = JSON.parse(readFileSync(rj, "utf8"))
      if (r.complete !== true || !r.finishedAt) continue
      for (const l of r.lanes ?? []) out.set(l.case, { ...l, chunk: d.name, manifestSha256: r.manifestSha256 })
    } catch { /* unreadable chunk stays uncovered */ }
  }
  return out
}

const pending = () => selection.filter((s) => !covered().has(s.case))
const t0 = Date.now()
const ran = []
const killed = []

function runChunk(cases) {
  const id = String(ran.length + killed.length + 1).padStart(2, "0") + "-" + cases.map((c) => c.case).join("+")
  const dir = join(chunksDir, id)
  mkdirSync(dir, { recursive: true })
  const timeout = Math.max(...cases.map((c) => FIXED_TIMEOUTS[c.case] ?? DEFAULT_LANE_TIMEOUT))
  const args = [RUNNER, `--suite=all`, `--only=${cases.map((c) => c.case).join(",")}`, "--json",
    `--evidence-dir=${relative(REPO, dir)}`, `--timeout=${timeout}`]
  const started = Date.now()
  const launched = spawnSync("node", ["scripts/mpd-bg.mjs", "run", "--log", join(dir, "sweep.log"), "--", "node", ...args],
    { cwd: REPO, encoding: "utf8" })
  const pidfile = join(dir, "sweep.log.pid")
  let alive = true
  while (alive && Date.now() - t0 < BUDGET_MS) {
    const pid = existsSync(pidfile) ? readFileSync(pidfile, "utf8").trim() : ""
    if (!pid) { alive = false; break }
    const p = spawnSync("node", ["scripts/mpd-bg.mjs", "probe", pidfile], { cwd: REPO, encoding: "utf8" })
    alive = (p.stdout ?? "").includes("RUNNING")
    if (alive) spawnSync("sleep", ["5"])
  }
  const durationMs = Date.now() - started
  const rj = join(dir, "result.json")
  const chunk = { id, cases: cases.map((c) => c.case), launchedVia: launched.stdout?.trim().split("\n")[0] ?? null, perLaneTimeoutMs: timeout, command: "node " + args.join(" "), durationMs, complete: false, finishedAt: null, verdicts: [] }
  if (alive) {
    chunk.note = "chunk still running when the RUN BUDGET expired -> the job dies with it; entries are reported as died-with-chunk and re-run alone"
    killed.push(chunk)
  } else if (existsSync(rj)) {
    const r = JSON.parse(readFileSync(rj, "utf8"))
    chunk.complete = r.complete === true && Boolean(r.finishedAt)
    chunk.finishedAt = r.finishedAt ?? null
    chunk.manifestSha256 = r.manifestSha256 ?? null
    chunk.verdicts = (r.lanes ?? []).map((l) => ({ case: l.case, kind: l.kind, verdict: l.verdict, reason: l.reason ?? null, exitCode: l.exitCode ?? null, durationMs: l.durationMs ?? null, evidence: l.evidence ?? null }))
    ran.push(chunk)
  } else {
    chunk.note = "chunk died with no result.json (killed with the job)"
    killed.push(chunk)
  }
  writeFileSync(join(dir, "chunk.json"), JSON.stringify(chunk, null, 2) + "\n")
  return chunk
}

const requested = argv["only"] ? argv["only"].split(",") : null
let batch = Number(argv["batch"] ?? 1)
log(`[drive] start ${new Date().toISOString()} manifest=${manifestSha.slice(0, 12)} selection=${selection.length} canonical=${canonical.slice(0, 16)} budget=${BUDGET_MS}ms`)
while (Date.now() - t0 < BUDGET_MS) {
  const left = requested ? selection.filter((s) => requested.includes(s.case) && !covered().has(s.case)) : pending()
  if (left.length === 0) { log("[drive] nothing pending"); break }
  const chunkCases = left.slice(0, Math.max(1, Math.min(batch, Math.ceil(left.length / 1))))
  const c = runChunk(chunkCases)
  log(`[drive] chunk=${c.id} cases=${c.cases.join(",")} complete=${c.complete} ms=${c.durationMs} ${c.verdicts.map((v) => v.case + ":" + v.verdict).join(" ")}`)
  // adaptive batching: group only after a demonstrably cheap chunk
  batch = c.complete && c.durationMs < 90_000 ? 3 : 1
}
const cov = covered()
const run = {
  task: "t26", attemptId: process.env.T26_ATTEMPT_ID ?? "8384631b-16ac-40ed-ace5-0eaf41118741", run: new Date(t0).toISOString(),
  runner: RUNNER, manifest: "skills/dsh-qa/cases.json", manifestSha256: manifestSha,
  selection: selection.length, canonicalSelection: canonical,
  launchMechanism: "node scripts/mpd-bg.mjs run --log <chunk>/sweep.log -- node scripts/run-qa-lanes.mjs …",
  launchBound: "the helper's detached child is NOT a registered harness job, but it dies with the bwrap sandbox of the job that started it (measured probe: 0-byte log, no marker, DEAD pid at the boundary) — so every chunk is waited for INSIDE one job and the run budget must stay under the host's ~17 min job lifetime",
  chunks: ran, diedWithChunk: killed,
  coveredNow: cov.size, coveredCases: [...cov.keys()].sort(), pendingNow: selection.length - cov.size,
  perLaneTimeoutMs: { default: DEFAULT_LANE_TIMEOUT, ...FIXED_TIMEOUTS },
}
const runsDir = join(HERE, "runs"); mkdirSync(runsDir, { recursive: true })
const stamp = new Date(t0).toISOString().replace(/[:.]/g, "-")
writeFileSync(join(runsDir, `${stamp}-run.json`), JSON.stringify(run, null, 2) + "\n")
writeFileSync(join(HERE, "output.log"), (existsSync(join(HERE, "output.log")) ? readFileSync(join(HERE, "output.log"), "utf8") : "") + lines.join("\n") + "\n")
// board summary over ALL chunks seen so far
const all = covered()
const counts = {}
for (const v of all.values()) counts[v.verdict] = (counts[v.verdict] ?? 0) + 1
writeFileSync(join(HERE, "board.json"), JSON.stringify({
  task: "t26", selection: selection.length, canonicalSelection: canonical,
  covered: all.size, counts, entries: [...all.entries()].map(([c, v]) => ({ case: c, kind: v.kind, verdict: v.verdict, reason: v.reason, chunk: v.chunk, manifestSha256: v.manifestSha256?.slice(0, 12) })).sort((a, b) => a.case.localeCompare(b.case)),
  pending: pending().map((p) => p.case),
}, null, 2) + "\n")
log(`[drive] done covered=${all.size}/${selection.length} counts=${JSON.stringify(counts)} pending=${pending().length}`)
