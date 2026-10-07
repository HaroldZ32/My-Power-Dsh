#!/usr/bin/env node
// L6 mount-instrumented boot (verification task t2, acceptance 4): prove on a REAL
// headless boot, with registration instrumentation (never `--dump-config`), that the
// `mpd-ulw` ROW loaded and that BOTH command names are registered in the live registry.
//
// COMPOSITION CHOICE (recorded, order-critical): the shipped `packages/*/dist/**` are
// STALE w.r.t. `src` (t15 changed mpd-ulw src; t12 changed the adapter src), and a boot
// that MIXES a fresh row with a stale row aborts the whole plugin tree
// (`dsh.registerCommand is not a function`). So this boot points the TWO affected rows —
// id `mpd-ulw` and id `mpd-dsh-adapter`, IDS KEPT — at sandbox builds of the canonical
// repo-root `bun build` command, in the SANDBOX's own profile patch (a copy; the repo
// tree is never touched). Two boots are recorded, BOTH carrying the same mounted probe
// overlay (an INSERTED row — it changes no shipped row):
//   BOOT A  shipped-consistent, exactly as `install-profile` wrote it (stale dists): the
//           shipped mpd-ulw DIST carries 0 occurrences of `registerCommand`, so the row
//           loads its PRE-WAVE code — its two tools exist and the command registry lists
//           neither new name. The honest "artifact is stale, pending the t8 integration
//           rebuild" observation, never read as a feature gap.
//   BOOT B  sandbox-built, same row IDS: the mpd-ulw row's two tools must exist and both
//           command names must be listed by the LIVE registry.
// Isolation: temp DSH_HOME + sandboxed HOME + explicit sandbox workspace on every spawn,
// plus assertSessionsSandboxed; the model step is answered by the local stub, so no
// provider credential is read.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readSessionEvents } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/session-evidence.mjs"
import { assertSessionsSandboxed, sandboxWorkspace } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/workspace-isolation.mjs"
import {
  REPO, bootSession, cleanup, createSandbox, crashSignatures, installProfile, isolationStep,
  keepRawSession, makeStubModel, runAsync, timestamp, useStubRoute, writeEvidence,
} from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/extension-isolation.mjs"

const SLUG = "l6-mount-boot"
const OUT_DIR = process.argv[2] ?? join(REPO, "evidence", "ulw", "l6-verification", timestamp())
const PROBE_PATH = join(import.meta.dirname, "mount-probe.mjs")
const REQUIRED_COMMANDS = ["ulw", "ultrawork"]
const BUILD_TARGETS = [
  { rowId: "mpd-ulw", entry: "packages/mpd-ulw-plugin/src/index.ts", shipped: join(REPO, "packages/mpd-ulw-plugin/dist/index.js"), markers: ["registerCommand", "ULW_ACTIVATION_DIRECTIVE", "usage: /ulw"] },
  { rowId: "mpd-dsh-adapter", entry: "packages/mpd-dsh-adapter-plugin/src/index.ts", shipped: join(REPO, "packages/mpd-dsh-adapter-plugin/dist/index.js"), markers: ["registerCommand", "submitUserTurn"] },
]

const log = []
const push = (text) => { log.push(text); console.log(String(text).slice(0, 400)) }
const sha = (path) => spawnSync("sha256sum", [path], { encoding: "utf8" }).stdout.trim().split(/\s+/)[0]

/** Rewrite the sandbox profile patch so the TWO rows keep their ids but load fresh builds. */
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

/** The probe overlay: one INSERTED row, no shipped row touched. */
function writeProbeOverlay(path, probeOut) {
  writeFileSync(path, [
    "- insert:",
    "  - id: l6-mount-probe",
    "    name: " + JSON.stringify(PROBE_PATH),
    "    config:",
    "      outFile: " + JSON.stringify(probeOut),
    "",
  ].join("\n"))
  return path
}

/** The shared assertions on one probe record. */
function probeChecks(arm, { requireCommands }) {
  const problems = []
  if (arm.run.status !== 0) problems.push("the boot exited " + arm.run.status)
  if (arm.crashes.length > 0) problems.push("apply crash signatures: " + arm.crashes.join(", "))
  if (arm.applyAbort) problems.push("the loader aborted a plugin tree")
  if (arm.probe === null) problems.push("the probe recorded nothing (its row did not mount)")
  else if ((arm.probe.errors ?? []).length > 0) problems.push("probe errors: " + JSON.stringify(arm.probe.errors))
  const tools = arm.probe?.tools ?? null
  const commands = arm.probe?.commands?.names ?? []
  if (tools === null) problems.push("the tools service was not observable")
  else {
    if (tools.mpd_ultrawork !== true) problems.push("the mpd-ulw row's tool mpd_ultrawork is not registered")
    if (tools.mpd_ulw !== true) problems.push("the mpd-ulw row's tool mpd_ulw is not registered")
  }
  if (requireCommands) {
    for (const name of REQUIRED_COMMANDS) {
      if (!commands.includes(name)) problems.push("the live command registry does not list " + name)
    }
    for (const descriptor of arm.probe?.commands?.descriptors ?? []) {
      if (!REQUIRED_COMMANDS.includes(descriptor?.name)) continue
      if (typeof descriptor.description !== "string" || descriptor.description.trim() === "") problems.push(descriptor.name + " listed without a description")
      if (descriptor.hint !== "objective") problems.push(descriptor.name + " does not advertise the objective input hint")
    }
  }
  if (!arm.isolation.ok) problems.push("workspace isolation violated: " + arm.isolation.error)
  return { problems, tools, commands }
}

async function boot(label, { overlay, probeOut, env, sandbox, stub }) {
  const ws = sandboxWorkspace(sandbox, "ws-" + label)
  const args = overlay === null ? [] : ["--patch", overlay]
  const run = await bootSession({ slug: SLUG + "-" + label, env, cwd: ws, prompt: "Reply with exactly: l6-mount-" + label + "-ok", stub, extraArgs: args })
  push("[" + label + "] $ dsh --profile mpd-headless " + (overlay === null ? "" : "--patch <overlay> ") + JSON.stringify("Reply with exactly: l6-mount-" + label + "-ok") + " (cwd " + ws + ")\n[[exit=" + run.status + "]]\n" + run.out.slice(0, 12000))
  const probe = probeOut !== undefined && existsSync(probeOut) ? JSON.parse(readFileSync(probeOut, "utf8")) : null
  let store = null
  try { store = readSessionEvents(env.DSH_HOME, { workspace: ws }) } catch (error) { push("[" + label + "] session store unreadable: " + String(error?.message ?? error)) }
  return {
    label, ws, run, probe, store,
    crashes: crashSignatures(run.out),
    applyAbort: /failed to apply loader entry|plugin tree failed to load/.test(run.out),
    isolation: isolationStep(env.DSH_HOME, sandbox, SLUG + "-" + label),
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const box = createSandbox(SLUG)
  const { sandbox, dshHome, env } = box
  const steps = {}

  const inst = await installProfile({ sandbox, dshHome, env })
  push("$ node scripts/install-profile.mjs --yes --dsh-home " + dshHome + " --profile mpd-headless --skip-toolchain\n[[exit=" + inst.status + "]]\n" + inst.out.slice(0, 3000))
  steps.install = { ok: inst.status === 0, exit: inst.status }
  if (!steps.install.ok) throw new Error("install-profile failed")

  const patchFile = join(dshHome, "cordis.patch.yml")

  // ── the shipped-artifact state, measured (not assumed) ─────────────────────
  steps.shippedArtifacts = {
    measured: BUILD_TARGETS.map((target) => ({
      rowId: target.rowId,
      path: target.shipped.replace(REPO + "/", ""),
      sha256: sha(target.shipped),
      missingMarkers: target.markers.filter((marker) => !readFileSync(target.shipped, "utf8").includes(marker)),
      presentMarkers: target.markers.filter((marker) => readFileSync(target.shipped, "utf8").includes(marker)),
    })),
    note: "a missing marker proves the shipped dist predates the wave's src; a boot mixing it with a fresh row aborts the plugin tree, so the gated boot B is built from src",
  }

  // ── canonical sandbox builds (repo-root, path-qualified args) ──────────────
  const buildDir = join(sandbox, "builds")
  mkdirSync(buildDir, { recursive: true })
  for (const target of BUILD_TARGETS) {
    const out = join(buildDir, target.rowId + ".js")
    const built = await runAsync("bun", ["build", target.entry, "--target", "node", "--format", "esm", "--outfile", out], { env, cwd: REPO, timeoutMs: 300000 })
    push("$ bun build " + target.entry + " --target node --format esm --outfile " + out + "\n[[exit=" + built.status + "]]\n" + built.out.slice(0, 2000))
    target.build = out
    target.buildExit = built.status
    target.buildSha = existsSync(out) ? sha(out) : null
  }
  steps.sandboxBuilds = {
    ok: BUILD_TARGETS.every((target) => target.buildExit === 0),
    builds: BUILD_TARGETS.map((target) => ({ rowId: target.rowId, entry: target.entry, build: target.build.replace(sandbox, "<sandbox>"), exit: target.buildExit, sha256: target.buildSha })),
    canonicalCommand: "bun build packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js",
  }
  if (!steps.sandboxBuilds.ok) throw new Error("a canonical sandbox build failed")

  const stub = makeStubModel({ label: SLUG, script: [{ text: "QA-STUB-L6-MOUNT-OK" }] })
  const port = await stub.listen()
  useStubRoute(dshHome, port)

  // ── BOOT A: shipped-consistent composition ─────────────────────────────────
  const probeOutA = join(sandbox, "probe-shipped.json")
  const overlayA = writeProbeOverlay(join(sandbox, "overlay-probe-shipped.yml"), probeOutA)
  const a = await boot("shipped", { overlay: overlayA, probeOut: probeOutA, env, sandbox, stub })
  const aChecks = probeChecks(a, { requireCommands: false })
  // The DISCRIMINATING observation: the shipped-consistent boot must list NEITHER new
  // command (its dist predates the wave), while BOOT B lists both. If this ever flips,
  // the artifact state changed and the stale-dist classification below must be re-read.
  const aStaleConsistent = REQUIRED_COMMANDS.every((name) => !aChecks.commands.includes(name))
  if (!aStaleConsistent) aChecks.problems.push("the shipped-consistent boot unexpectedly lists a wave command — the artifact state changed; re-read the stale-dist classification")
  steps.bootShippedConsistent = {
    ok: aChecks.problems.length === 0,
    problems: aChecks.problems,
    exit: a.run.status, crashes: a.crashes, applyAbort: a.applyAbort,
    tools: aChecks.tools, commands: aChecks.commands,
    staleConsistent: aStaleConsistent,
    isolation: a.isolation,
    note: "the shipped mpd-ulw DIST carries no registerCommand, so the row loads its PRE-WAVE code: both tools exist (the row loaded) and the command registry lists neither new name — the EXPECTED shipped-stale observation, not a feature gap",
  }
  if (a.store?.file !== undefined) keepRawSession(OUT_DIR, "arm-shipped", a.store)

  // ── BOOT B: sandbox builds, SAME row ids ──────────────────────────────────
  const rows = retargetRows(patchFile, BUILD_TARGETS)
  push("[patch] retargeted rows (row ids kept):\n" + JSON.stringify(rows.map((row) => ({ ...row, to: row.to.replace(sandbox, "<sandbox>") })), null, 2))
  steps.retargetedRows = { ok: rows.length === BUILD_TARGETS.length, rows: rows.map((row) => ({ ...row, to: row.to.replace(sandbox, "<sandbox>") })) }

  const probeOutB = join(sandbox, "probe-built.json")
  const overlayB = writeProbeOverlay(join(sandbox, "overlay-probe-built.yml"), probeOutB)
  const b = await boot("sandbox-built", { overlay: overlayB, probeOut: probeOutB, env, sandbox, stub })
  const bChecks = probeChecks(b, { requireCommands: true })
  steps.bootSandboxBuilt = {
    ok: bChecks.problems.length === 0,
    problems: bChecks.problems,
    exit: b.run.status, crashes: b.crashes, applyAbort: b.applyAbort,
    tools: bChecks.tools, commands: bChecks.commands,
    descriptors: b.probe?.commands?.descriptors ?? null,
    registryShape: b.probe?.registryShape ?? null,
    isolation: b.isolation,
    gating: true,
  }
  if (b.store?.file !== undefined) keepRawSession(OUT_DIR, "arm-sandbox-built", b.store)

  // ── composition-only cross-check (composes rows, never loads code) ─────────
  const dump = spawnSync(process.execPath, [join(REPO, "scripts", "dump-config.mjs"), "--profile", "mpd-headless", "--json", "--", "--patch", overlayB], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const dumpText = (() => { try { return JSON.parse(dump.stdout).stdout } catch { return dump.stdout } })()
  steps.compositionOnly = {
    ok: dump.status === 0 && dumpText.includes("id: mpd-ulw") && dumpText.includes("id: l6-mount-probe"),
    exit: dump.status,
    hasUlwRow: dumpText.includes("id: mpd-ulw"),
    hasProbeRow: dumpText.includes("id: l6-mount-probe"),
    note: "COMPOSITION ONLY (AGENTS.md §4): proves the composed row list carries id mpd-ulw and the probe row; it can never witness a registration or an apply abort — the load evidence is BOOT B's live registries",
  }

  try {
    steps.isolationSessions = assertSessionsSandboxed(dshHome, sandbox, { label: SLUG })
  } catch (error) {
    steps.isolationSessions = { ok: false, error: String(error?.message ?? error) }
  }

  const allOk = Object.values(steps).every((step) => step.ok !== false)
  const result = {
    task: "t2", slug: SLUG, at: new Date().toISOString(),
    baseRevision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim(),
    sourceHashes: Object.fromEntries([...BUILD_TARGETS.map((target) => [target.entry, sha(join(REPO, target.entry))]), ["packages/mpd-agent-teams-plugin/lib/session-start.js", sha(join(REPO, "packages/mpd-agent-teams-plugin/lib/session-start.js"))]]),
    acceptance: "t2 acceptance 4 — a mount-instrumented boot (registration instrumentation, not --dump-config) shows the mpd-ulw row loaded and both command names registered",
    ok: allOk,
    steps,
    stubRequests: stub.requests(),
  }
  writeEvidence(OUT_DIR, SLUG, result, log.join("\n") + "\n")
  await stub.close()
  cleanup(sandbox)
  console.log("[" + SLUG + "] ok=" + allOk + " -> " + OUT_DIR)
  for (const [key, value] of Object.entries(steps)) console.log("  " + key + ": " + JSON.stringify(value).slice(0, 300))
  if (!allOk) process.exit(1)
}

main().then(() => process.exit(0)).catch((error) => { console.error("[" + SLUG + "] FAIL: " + String(error?.stack ?? error)); process.exit(1) })
