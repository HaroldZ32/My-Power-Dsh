#!/usr/bin/env node
// t6 (Reviewer) OWN O-1 harness.
// Part A: three REAL headless MOUNT boots of the dev-flavor bundle patch in an
// isolated DSH_HOME + sandbox HOME/workspace, reading the [mpd-codegraph]
// apply-time line the shipped plugin prints. No --dump-config is cited.
// Part B: the CALL-TIME `/mpd-codegraph` handler of the shipped dist, invoked
// with a harness-shaped CommandInvocation carrying a session cwd != process cwd.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const RUN = join(here, "work", "o1-run")
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 900) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${String(detail).slice(0, 220)}`)
}
const rmrf = (p) => spawnSync("rm", ["-rf", p])

rmrf(RUN)
const projectA = join(RUN, "projectA")
const sessionWS = join(RUN, "sessionWS")
const explicitC = join(RUN, "explicitC")
for (const d of [projectA, sessionWS, explicitC]) mkdirSync(join(d, ".codegraph"), { recursive: true })
for (const d of [projectA, sessionWS, explicitC]) writeFileSync(join(d, ".codegraph", "codegraph.db"), "")

const DEV_PATCH = join(here, "work", "dev-fixed.yml")
const SCRUB = ["MPD_DSH_ASTGREP_CLI", "MPD_DSH_GITBASH_CLI", "MPD_DSH_LSP_CLI", "MPD_DSH_CODEGRAPH_CLI", "MPD_AST_GREP_SG_PATH", "MPD_AST_GREP_BIN_DIR", "MPD_CODEGRAPH_BIN", "MPD_CODEGRAPH_PROJECT_CWD", "MPD_DSH_CODEGRAPH_PROJECT_CWD", "DSH_WORKSPACE_ROOT"]

function boot(label, extraEnv) {
  const home = join(RUN, label, "home")
  const dshHome = join(RUN, label, "dsh")
  mkdirSync(home, { recursive: true })
  mkdirSync(dshHome, { recursive: true })
  const env = { ...process.env, DSH_HOME: dshHome, HOME: home, ...extraEnv }
  for (const k of SCRUB) delete env[k]
  for (const [k, v] of Object.entries(extraEnv ?? {})) env[k] = v
  const started = Date.now()
  const run = spawnSync("dsh", ["--profile", "headless", "--patch", DEV_PATCH, "ok"], {
    env, cwd: projectA, encoding: "utf8", timeout: 240_000, maxBuffer: 32 * 1024 * 1024,
  })
  const out = (run.stdout ?? "") + (run.stderr ?? "")
  writeFileSync(join(here, `o1-boot-${label}.log`), out)
  const m = out.match(/\[mpd-codegraph\] init status=(\S+) binary=(\S+) cwd=(\S+)/)
  return { label, status: m?.[1] ?? null, binary: m?.[2] ?? null, cwd: m?.[3] ?? null, ms: Date.now() - started, exit: run.status, out }
}

const b1 = boot("session-root", { DSH_WORKSPACE_ROOT: sessionWS })
check("O-1 apply-time: session workspace (DSH_WORKSPACE_ROOT) != process cwd -> the SESSION root is used",
  b1.cwd === sessionWS && b1.cwd !== projectA, `line cwd=${b1.cwd} sessionWS=${sessionWS} processCwd=${projectA} status=${b1.status} ms=${b1.ms}`)

const b2 = boot("no-override", {})
check("O-1 apply-time: no session override -> the documented last tier (process.cwd) holds",
  b2.cwd === projectA, `line cwd=${b2.cwd} expected=${projectA} status=${b2.status} ms=${b2.ms}`)

const b3 = boot("override-wins", { DSH_WORKSPACE_ROOT: sessionWS, MPD_CODEGRAPH_PROJECT_CWD: explicitC })
check("O-1 apply-time: explicit MPD_CODEGRAPH_PROJECT_CWD still wins over the workspace plane",
  b3.cwd === explicitC, `line cwd=${b3.cwd} expected=${explicitC} status=${b3.status} ms=${b3.ms}`)

// ------------------------------------------------------------------ Part B ---
const dist = join(repoRoot, "packages", "mpd-codegraph-plugin", "dist", "index.js")
const mod = await import("file://" + dist)
let registered = null
const ctx = { get: (k) => (k === "commands" ? { register: (d) => { registered = d } } : undefined) }
mod.apply(ctx, { autoInit: false })
const handler = registered?.handler
check("O-1 call-time: the plugin registers /mpd-codegraph on a commands seam", typeof handler === "function", typeof handler)

const invocation = { agent: { session: { header: { cwd: sessionWS } } } }
delete process.env.MPD_CODEGRAPH_PROJECT_CWD
delete process.env.MPD_DSH_CODEGRAPH_PROJECT_CWD
const callSession = await handler(invocation)
check("O-1 call-time: handler resolves the INVOCATION's session cwd (not process.cwd)",
  callSession?.kind === "success" && String(callSession.text).includes(sessionWS) && !String(callSession.text).includes(projectA),
  JSON.stringify(callSession))
const callNoInvocation = await handler()
check("O-1 call-time: no invocation -> process.cwd() fallback (documented last tier)",
  callNoInvocation?.kind === "success" && String(callNoInvocation.text).includes(process.cwd()),
  JSON.stringify(callNoInvocation))
process.env.MPD_CODEGRAPH_PROJECT_CWD = explicitC
const callOverride = await handler(invocation)
check("O-1 call-time: explicit override wins over the invocation session cwd",
  callOverride?.kind === "success" && String(callOverride.text).includes(explicitC),
  JSON.stringify(callOverride))
delete process.env.MPD_CODEGRAPH_PROJECT_CWD
const callResultShape = await handler(invocation)
check("O-1 call-time: handler returns the harness CommandResult shape ({kind}), never {success,error}",
  callResultShape && typeof callResultShape.kind === "string" && callResultShape.success === undefined,
  JSON.stringify(callResultShape))

// mount health of the boot logs (apply-crash signatures)
const crash = /unsupported JSON schema|JsonSchemaError|plugin tree failed to load|failed to apply loader entry/
const allOut = b1.out + b2.out + b3.out
check("mount health: 0 apply-crash signatures across the three boots",
  !crash.test(allOut), "signatures=" + String((allOut.match(crash) ?? []).length))

const result = {
  task: "t6 own O-1 harness",
  stamp: new Date().toISOString(),
  boots: [b1, b2, b3].map(({ out, ...r }) => r),
  callTime: { session: callSession, noInvocation: callNoInvocation, override: callOverride },
  checks,
  allPass: checks.every((c) => c.pass),
}
writeFileSync(join(here, "o1-own.result.json"), JSON.stringify(result, null, 2))
console.log("\n" + (result.allPass ? "PASS" : "FAIL") + " — o1-own.result.json (" + checks.filter((c) => c.pass).length + "/" + checks.length + ")")
process.exit(result.allPass ? 0 : 1)
