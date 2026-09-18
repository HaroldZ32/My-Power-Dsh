#!/usr/bin/env node
// t16 LIVE bounded call (acceptance 4): prove on the INSTALLED harness that a plan=false
// run now returns a VALID tool result, read from the harness's own session log.
//
// What is exercised, and why:
//   * `mpd_ultrawork` with tier=light + plan=false — the EXACT path the t2 verifier measured
//     failing (`tool "mpd_ultrawork" returned invalid output: "value.planFile" must be a
//     string`), because its own output schema declares `planFile` and the engine used to
//     return it as null.
//   * `mpd_ulw` — the alias, which hardcodes plan=false and returns a narrower object; it is
//     exercised because clause 2's user surface is the alias/command path.
//
// COMPOSITION (recorded): the shipped `packages/*/dist/**` still predate this wave (T-88:
// dist belongs to the integration task), so the boot points the TWO affected rows — ids
// `mpd-ulw` and `mpd-dsh-adapter`, ids KEPT — at sandbox builds of the canonical repo-root
// `bun build` command written into the SANDBOX's own profile patch. The repo tree is never
// touched. The model step is answered by the local OpenAI-shaped stub, which is SCRIPTED to
// emit the two tool calls, so no provider credential is read and the run is bounded.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readSessionEvents } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/session-evidence.mjs"
import { assertSessionsSandboxed, sandboxWorkspace } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/workspace-isolation.mjs"
import {
  REPO, bootSession, callsOf, cleanup, createSandbox, crashSignatures, installProfile, isolationStep,
  keepRawSession, makeStubModel, runAsync, toolResultsByCallId, useStubRoute, writeEvidence,
} from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/extension-isolation.mjs"

const SLUG = "l2c-live-schema"
const OUT_DIR = process.argv[2] ?? join(REPO, "evidence", "ulw", "l2c-schema-fix", "20260918T015142Z", "live")
const OBJECTIVE_ULTRAWORK = "qa-l2c-schema-ultrawork"
const OBJECTIVE_ALIAS = "qa-l2c-schema-alias"
const CHILD_MARKER = "ULTRAWORK DISCIPLINE" // appears only in the engine's round-child prompt
const BUILD_TARGETS = [
  { rowId: "mpd-ulw", entry: "packages/mpd-ulw-plugin/src/index.ts", shipped: join(REPO, "packages/mpd-ulw-plugin/dist/index.js") },
  { rowId: "mpd-dsh-adapter", entry: "packages/mpd-dsh-adapter-plugin/src/index.ts", shipped: join(REPO, "packages/mpd-dsh-adapter-plugin/dist/index.js") },
]

const log = []
const push = (text) => { log.push(text); console.log(String(text).slice(0, 400)) }
const sha = (path) => spawnSync("sha256sum", [path], { encoding: "utf8" }).stdout.trim().split(/\s+/)[0]

/** Re-point the two rows at sandbox builds, row IDS kept (a name change is refused by the loader). */
function retargetRows(patchFile, targets) {
  const before = readFileSync(patchFile, "utf8")
  let after = before
  const rows = []
  for (const target of targets) {
    const oldName = '  - id: ' + target.rowId + '\n    name: "' + target.shipped + '"'
    const newName = '  - id: ' + target.rowId + '\n    name: "' + target.build + '"'
    if (!before.includes(oldName)) throw new Error("row " + target.rowId + " not found with the expected shipped name in " + patchFile)
    after = after.replace(oldName, newName)
    rows.push({ rowId: target.rowId, from: target.shipped, to: target.build })
  }
  writeFileSync(patchFile, after)
  return rows
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const { sandbox, dshHome, env } = createSandbox(SLUG)
  const steps = {}

  const inst = await installProfile({ sandbox, dshHome, env })
  push("$ node scripts/install-profile.mjs --yes --dsh-home " + dshHome + " --profile mpd-headless --skip-toolchain\n[[exit=" + inst.status + "]]")
  steps.install = { ok: inst.status === 0, exit: inst.status }
  if (!steps.install.ok) throw new Error("install-profile failed")

  // ── the shipped artifact state, measured: it still carries the RETIRED return shape ──
  steps.shippedArtifacts = {
    measured: BUILD_TARGETS.map((target) => {
      const text = existsSync(target.shipped) ? readFileSync(target.shipped, "utf8") : ""
      return {
        rowId: target.rowId,
        path: target.shipped.replace(REPO + "/", ""),
        sha256: existsSync(target.shipped) ? sha(target.shipped) : null,
        carriesRetiredUnconditionalPlanFile: /return\s*\{\s*status,\s*rounds:\s*used,\s*planFile,/.test(text),
        carriesFixedConditionalPlanFile: /planFile === null \? \{\} : \{ planFile \}/.test(text),
      }
    }),
    note: "the shipped mpd-ulw dist predates this repair (T-88): it still emits planFile unconditionally, so a boot of the shipped composition would reproduce the t16 failure. The repair is measured through sandbox builds of the SAME canonical command the integration rebuild uses.",
  }
  push("[artifacts] shipped state:\n" + JSON.stringify(steps.shippedArtifacts.measured, null, 2))

  // ── canonical sandbox builds (repo root, path-qualified args) ──────────────
  const buildDir = join(sandbox, "builds")
  mkdirSync(buildDir, { recursive: true })
  for (const target of BUILD_TARGETS) {
    const out = join(buildDir, target.rowId + ".js")
    const built = await runAsync("bun", ["build", target.entry, "--target", "node", "--format", "esm", "--outfile", out], { env, cwd: REPO, timeoutMs: 300000 })
    push("$ bun build " + target.entry + " --target node --format esm --outfile " + out + "\n[[exit=" + built.status + "]]")
    target.build = out
    target.buildExit = built.status
  }
  steps.sandboxBuilds = { ok: BUILD_TARGETS.every((target) => target.buildExit === 0), canonicalCommand: "bun build <entry> --target node --format esm --outfile <sandbox>/builds/<row>.js" }
  if (!steps.sandboxBuilds.ok) throw new Error("a canonical sandbox build failed")

  const stub = makeStubModel({
    label: SLUG,
    // Two model-initiated tool calls, then a final text answer. The alias call is second;
    // `script[toolResults.length]` advances per received tool result.
    script: [
      { tool: "mpd_ultrawork", args: { objective: OBJECTIVE_ULTRAWORK, tier: "light", plan: false, maxRounds: 1 } },
      { tool: "mpd_ulw", args: { objective: OBJECTIVE_ALIAS, maxRounds: 1 } },
      { text: "QA-STUB-L2C-DONE" },
    ],
    childMarker: CHILD_MARKER,
    childScript: [{ text: "QA-STUB-L2C-CHILD-DONE" }],
  })
  const port = await stub.listen()
  useStubRoute(dshHome, port)

  const rows = retargetRows(join(dshHome, "cordis.patch.yml"), BUILD_TARGETS)
  steps.retargetedRows = { ok: rows.length === BUILD_TARGETS.length, rows: rows.map((row) => ({ ...row, to: row.to.replace(sandbox, "<sandbox>") })) }
  push("[patch] retargeted rows (ids kept): " + JSON.stringify(steps.retargetedRows.rows))

  // ── ONE bounded boot with the two scripted tool calls ─────────────────────
  const ws = sandboxWorkspace(sandbox, "ws-live")
  const prompt = "Call the mpd_ultrawork tool, then the mpd_ulw tool, then reply with exactly QA-STUB-L2C-USER-DONE."
  const run = await bootSession({ slug: SLUG, env, cwd: ws, prompt, stub })
  push("[live] $ dsh --profile mpd-headless " + JSON.stringify(prompt) + " (cwd " + ws + ")\n[[exit=" + run.status + "]]\n" + run.out.slice(0, 8000))

  let store = null
  try { store = readSessionEvents(env.DSH_HOME, { workspace: ws }) } catch (error) { push("session store unreadable: " + String(error?.message ?? error)) }

  const calls = store === null ? [] : callsOf(store, "mpd_ultrawork").concat(callsOf(store, "mpd_ulw"))
  const results = store === null ? new Map() : toolResultsByCallId(store)
  const perCall = calls.map((call) => {
    const result = results.get(call.callId) ?? null
    return { callId: call.callId, tool: call.arguments?.objective === OBJECTIVE_ALIAS ? "mpd_ulw" : "mpd_ultrawork", objective: call.arguments?.objective ?? null, plan: call.arguments?.plan ?? null, resultFound: result !== null, isError: result?.isError ?? null, resultTextHead: (result?.text ?? "").slice(0, 200) }
  })
  const decoded = store === null ? "" : store.records.map((record) => JSON.stringify(record)).join("\n")
  const invalidOutputHits = (decoded.match(/returned invalid output/g) ?? []).length

  const problems = []
  if (run.status !== 0) problems.push("the boot exited " + run.status)
  const crashes = crashSignatures(run.out)
  if (crashes.length > 0) problems.push("apply crash signatures: " + crashes.join(", "))
  if (/failed to apply loader entry|plugin tree failed to load/.test(run.out)) problems.push("the loader aborted a plugin tree")
  if (store === null) problems.push("the session store is unreadable")
  const ultraworkCall = perCall.find((entry) => entry.tool === "mpd_ultrawork")
  const aliasCall = perCall.find((entry) => entry.tool === "mpd_ulw")
  if (ultraworkCall === undefined) problems.push("no mpd_ultrawork (plan=false) call was recorded")
  else {
    if (ultraworkCall.objective !== OBJECTIVE_ULTRAWORK) problems.push("the mpd_ultrawork call carried the wrong objective: " + ultraworkCall.objective)
    if (ultraworkCall.plan !== false) problems.push("the mpd_ultrawork call was not plan=false: " + ultraworkCall.plan)
    if (!ultraworkCall.resultFound) problems.push("the mpd_ultrawork call recorded NO tool result")
    else if (ultraworkCall.isError !== false) problems.push("the mpd_ultrawork result is an ERROR — the t16 defect would still be live")
  }
  if (aliasCall === undefined) problems.push("no mpd_ulw call was recorded")
  else {
    if (!aliasCall.resultFound) problems.push("the mpd_ulw call recorded NO tool result")
    else if (aliasCall.isError !== false) problems.push("the mpd_ulw result is an ERROR")
  }
  // The harness never even reached its output validator with the retired shape.
  if (invalidOutputHits !== 0) problems.push("the log carries " + invalidOutputHits + " 'returned invalid output' record(s) — the schema still rejects the value")
  if (!perCall.some((entry) => (entry.resultTextHead ?? "").includes("status="))) problems.push("no rendered tool result text was recorded")
  const isolation = isolationStep(env.DSH_HOME, sandbox, SLUG)
  if (!isolation.ok) problems.push("workspace isolation violated: " + isolation.error)
  let sessions = { ok: false, error: "not run" }
  try { sessions = assertSessionsSandboxed(dshHome, sandbox, { label: SLUG }) } catch (error) { sessions = { ok: false, error: String(error?.message ?? error) } }

  steps.livePlanFalse = {
    ok: problems.length === 0,
    problems,
    exit: run.status,
    crashes,
    stubRequests: stub.requests(),
    calls: perCall,
    invalidOutputHits,
    isolation,
    sessionsSandboxed: sessions,
    note: "the two tool calls are MODEL-INITIATED, so the harness ran its own output validation on each returned value",
  }
  if (store?.file !== undefined) keepRawSession(OUT_DIR, "arm-live-plan-false", store)

  const allOk = Object.values(steps).every((step) => step.ok !== false)
  const result = {
    task: "t16", slug: SLUG, at: new Date().toISOString(),
    baseRevision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim(),
    sourceHashes: { "packages/mpd-ulw-plugin/src/index.ts": sha(join(REPO, "packages/mpd-ulw-plugin/src/index.ts")) },
    acceptance: "t16 acceptance 4 — a live bounded call on the installed harness: a plan=false invocation (mpd_ultrawork plan=false AND the mpd_ulw alias) returns a VALID result, read from the harness session log",
    ok: allOk,
    steps,
  }
  writeEvidence(OUT_DIR, SLUG, result, log.join("\n") + "\n")
  await stub.close()
  cleanup(sandbox)
  console.log("[" + SLUG + "] ok=" + allOk + " -> " + OUT_DIR)
  for (const [key, value] of Object.entries(steps)) console.log("  " + key + ": " + JSON.stringify(value).slice(0, 320))
  if (!allOk) process.exit(1)
}

main().then(() => process.exit(0)).catch((error) => { console.error("[" + SLUG + "] FAIL: " + String(error?.stack ?? error)); process.exit(1) })
