#!/usr/bin/env node
// t11 FINAL VERIFICATION — acceptance 4 (F2 repair on the SHIPPED composition).
//
// Independent re-measurement of the t16 defect on the INTEGRATED revision, with NO
// sandbox retargeting: this boot installs the profile exactly as `install-profile`
// writes it and points every row at the tree's own `packages/*/dist/**`. That is the
// point of t11: on the pre-integration revision the shipped dists predated the repair
// (t2/t16 had to retarget rows at sandbox builds); after t8's rebuild the SHIPPED
// artifacts must themselves carry the repair, so the user path is what is measured.
//
// The defect: `mpd_ultrawork`'s own output schema declares `planFile` as a string while
// the engine used to return it as null, so the harness rejected every valid run with
// `tool "mpd_ultrawork" returned invalid output: "value.planFile" must be a string`.
//
// Evidence rule (AGENTS.md §7): the proof is the HARNESS session log — a model-initiated
// `tool/call` plus a NON-ERROR `tool/result`, plus a ZERO count of "returned invalid
// output" records. The model step is answered by the local OpenAI-shaped stub, scripted
// to emit the calls, so no provider credential is read and the run stays bounded.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readSessionEvents } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/session-evidence.mjs"
import { assertSessionsSandboxed, sandboxWorkspace } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/workspace-isolation.mjs"
import {
  REPO, bootSession, callsOf, cleanup, createSandbox, crashSignatures, installProfile, isolationStep,
  keepRawSession, makeStubModel, toolResultsByCallId, useStubRoute, writeEvidence,
} from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/extension-isolation.mjs"

const SLUG = "t11-f2-live-plan-false"
const OUT_DIR = process.argv[2] ?? join(REPO, "evidence", "ulw", "final-verification", "f2-live")
const OBJECTIVE_ULTRAWORK = "t11-f2-shipped-ultrawork"
const OBJECTIVE_ALIAS = "t11-f2-shipped-alias"
const CHILD_MARKER = "ULTRAWORK DISCIPLINE"
const SHIPPED = {
  "mpd-ulw": join(REPO, "packages", "mpd-ulw-plugin", "dist", "index.js"),
  "mpd-dsh-adapter": join(REPO, "packages", "mpd-dsh-adapter-plugin", "dist", "index.js"),
}

const log = []
const push = (text) => { log.push(text); console.log(String(text).slice(0, 400)) }
const sha = (path) => spawnSync("sha256sum", [path], { encoding: "utf8" }).stdout.trim().split(/\s+/)[0]

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const { sandbox, dshHome, env } = createSandbox(SLUG)
  const steps = {}

  const inst = await installProfile({ sandbox, dshHome, env })
  push("$ node scripts/install-profile.mjs --yes --dsh-home " + dshHome + " --profile mpd-headless --skip-toolchain\n[[exit=" + inst.status + "]]")
  steps.install = { ok: inst.status === 0, exit: inst.status }
  if (!steps.install.ok) throw new Error("install-profile failed")

  // ── the SHIPPED artifacts, measured: the repair must already be in them ─────
  steps.shippedArtifacts = {
    measured: Object.entries(SHIPPED).map(([rowId, path]) => {
      const text = existsSync(path) ? readFileSync(path, "utf8") : ""
      return {
        rowId,
        path: path.replace(REPO + "/", ""),
        sha256: existsSync(path) ? sha(path) : null,
        carriesFixedConditionalPlanFile: /planFile === null \? \{\} : \{ planFile \}/.test(text),
        carriesRetiredUnconditionalPlanFile: /return\s*\{\s*status,\s*rounds:\s*used,\s*planFile,/.test(text),
      }
    }),
    note: "measured on the INSTALLED PROFILE'S OWN artifacts (no sandbox build, no row retargeting): the boot below exercises the user path.",
  }
  const shippedCarriesFix = steps.shippedArtifacts.measured.find((row) => row.rowId === "mpd-ulw")?.carriesFixedConditionalPlanFile === true
  if (!shippedCarriesFix) throw new Error("the shipped mpd-ulw dist does not carry the F2 repair — the boot would not measure the user path")

  // ── one bounded boot of the SHIPPED composition ────────────────────────────
  const stub = makeStubModel({
    label: SLUG,
    script: [
      { tool: "mpd_ultrawork", args: { objective: OBJECTIVE_ULTRAWORK, tier: "light", plan: false, maxRounds: 1 } },
      { tool: "mpd_ulw", args: { objective: OBJECTIVE_ALIAS, maxRounds: 1 } },
      { text: "QA-T11-F2-DONE" },
    ],
    childMarker: CHILD_MARKER,
    childScript: [{ text: "QA-T11-F2-CHILD-DONE" }],
  })
  const port = await stub.listen()
  useStubRoute(dshHome, port)

  const ws = sandboxWorkspace(sandbox, "ws-f2")
  const prompt = "Call the mpd_ultrawork tool, then the mpd_ulw tool, then reply with exactly QA-T11-F2-USER-DONE."
  const run = await bootSession({ slug: SLUG, env, cwd: ws, prompt, stub })
  push("[live] $ dsh --profile mpd-headless " + JSON.stringify(prompt) + " (cwd " + ws + ")\n[[exit=" + run.status + "]]\n" + run.out.slice(0, 8000))

  let store = null
  try { store = readSessionEvents(env.DSH_HOME, { workspace: ws }) } catch (error) { push("session store unreadable: " + String(error?.message ?? error)) }

  const calls = store === null ? [] : callsOf(store, "mpd_ultrawork").concat(callsOf(store, "mpd_ulw"))
  const results = store === null ? new Map() : toolResultsByCallId(store)
  const perCall = calls.map((call) => {
    const result = results.get(call.callId) ?? null
    return {
      callId: call.callId,
      tool: call.arguments?.objective === OBJECTIVE_ALIAS ? "mpd_ulw" : "mpd_ultrawork",
      objective: call.arguments?.objective ?? null,
      plan: call.arguments?.plan ?? null,
      resultFound: result !== null,
      isError: result?.isError ?? null,
      resultTextHead: (result?.text ?? "").slice(0, 300),
    }
  })
  const decoded = store === null ? "" : store.records.map((record) => JSON.stringify(record)).join("\n")
  const invalidOutputHits = (decoded.match(/returned invalid output/g) ?? []).length
  const invalidOutputExcerpt = (decoded.match(/.{0,160}returned invalid output.{0,200}/g) ?? []).slice(0, 3)

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
    else if (ultraworkCall.isError !== false) problems.push("the mpd_ultrawork result is an ERROR — the F2 defect would still be live")
  }
  if (aliasCall === undefined) problems.push("no mpd_ulw call was recorded")
  else {
    if (!aliasCall.resultFound) problems.push("the mpd_ulw call recorded NO tool result")
    else if (aliasCall.isError !== false) problems.push("the mpd_ulw result is an ERROR")
  }
  if (invalidOutputHits !== 0) problems.push("the log carries " + invalidOutputHits + " 'returned invalid output' record(s) — the schema still rejects the value")
  if (!perCall.some((entry) => (entry.resultTextHead ?? "").includes("status="))) problems.push("no rendered tool result text was recorded")
  const isolation = isolationStep(env.DSH_HOME, sandbox, SLUG)
  if (!isolation.ok) problems.push("workspace isolation violated: " + isolation.error)
  let sessions = { ok: false, error: "not run" }
  try { sessions = assertSessionsSandboxed(dshHome, sandbox, { label: SLUG }) } catch (error) { sessions = { ok: false, error: String(error?.message ?? error) } }

  steps.shippedLivePlanFalse = {
    ok: problems.length === 0,
    problems,
    exit: run.status,
    crashes,
    stubRequests: stub.requests(),
    calls: perCall,
    invalidOutputHits,
    invalidOutputExcerpt,
    isolation,
    sessionsSandboxed: sessions,
    note: "the two tool calls are MODEL-INITIATED in the SHIPPED composition, so the harness ran its own output validation on each returned value",
  }
  if (store?.file !== undefined) keepRawSession(OUT_DIR, "arm-f2-shipped", store)

  const allOk = Object.values(steps).every((step) => step.ok !== false)
  const result = {
    task: "t11", slug: SLUG, at: new Date().toISOString(),
    baseRevision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim(),
    sourceHashes: Object.fromEntries(Object.entries(SHIPPED).map(([rowId, path]) => [path.replace(REPO + "/", ""), sha(path)])),
    acceptance: "t11 acceptance 4 — F2 repair verified ON THE SHIPPED COMPOSITION: a bounded live mpd_ultrawork (plan=false) + mpd_ulw invocation returns a VALID result, evidenced from the harness session log",
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
