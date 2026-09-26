#!/usr/bin/env node
// t11 FINAL VERIFICATION — acceptance 6: a MOUNT-INSTRUMENTED boot on the INTEGRATED
// revision (the SHIPPED composition, no row retargeting, no sandbox builds) proves
//   (a) the `mpd-ulw` ROW loaded — its two tools exist in the live tool registry;
//   (b) BOTH command names (`ulw`, `ultrawork`) are registered in the LIVE command
//       registry with a description and the `objective` input hint;
//   (c) a COMPLEX prompt leaves NO PLUGIN pre-staging (0 team records in the workspace's
//       own `.mpd/team`, and the ONE advisory notice — never the provisioning notice).
//
// Registration instrumentation, never `--dump-config` (AGENTS.md §4: the flag composes
// rows and never executes plugin code, so it can witness neither a registration nor an
// apply abort). Isolation: temp DSH_HOME + sandboxed HOME + an explicit sandbox workspace
// on every spawn, plus assertSessionsSandboxed; the model step is answered by the local
// OpenAI-shaped stub, so no provider credential is read and the boot stays bounded.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readSessionEvents } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/session-evidence.mjs"
import { assertSessionsSandboxed, sandboxWorkspace } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/workspace-isolation.mjs"
import { SOFT_COMPLEX_PROMPTS } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/gate-probe.mjs"
import {
  REPO, bootSession, cleanup, createSandbox, crashSignatures, installProfile, isolationStep,
  keepRawSession, makeStubModel, useStubRoute, writeEvidence,
} from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/extension-isolation.mjs"

const SLUG = "t11-mount-boot"
const OUT_DIR = process.argv[2] ?? join(REPO, "evidence", "ulw", "final-verification", "mount-boot")
const PROBE_PATH = join(import.meta.dirname, "t11-mount-probe.mjs")
const REQUIRED_COMMANDS = ["ulw", "ultrawork"]
const NOTICE_MARKER = "[AgentTeams] Session-start team rule"
const ADVISORY_PHRASE = "NO team was staged"
const PROVISIONED_PHRASE = "is staged in this workspace"
const COMPLEX_PROMPT = SOFT_COMPLEX_PROMPTS[0]

const log = []
const push = (text) => { log.push(text); console.log(String(text).slice(0, 400)) }
const sha = (path) => spawnSync("sha256sum", [path], { encoding: "utf8" }).stdout.trim().split(/\s+/)[0]

/** The probe overlay: one INSERTED row, no shipped row touched. */
function writeProbeOverlay(path, probeOut) {
  writeFileSync(path, [
    "- insert:",
    "  - id: t11-mount-probe",
    "    name: " + JSON.stringify(PROBE_PATH),
    "    config:",
    "      outFile: " + JSON.stringify(probeOut),
    "",
  ].join("\n"))
  return path
}

/** Every team record the workspace carries: ACTIVE + ARCHIVED (outcomes, not just live teams). */
function teamRecords(ws) {
  const root = join(ws, ".mpd", "team")
  if (!existsSync(root)) return { active: [], archived: [] }
  const ids = readdirSync(root).filter((dir) => dir !== "archive" && dir !== "retired-members.json" && existsSync(join(root, dir, "team.json")))
  const archiveRoot = join(root, "archive")
  const archivedIds = existsSync(archiveRoot) ? readdirSync(archiveRoot).filter((dir) => existsSync(join(archiveRoot, dir, "team.json"))) : []
  return { active: ids, archived: archivedIds }
}

/** The user-role texts the harness recorded for this workspace's session. */
function recordedUserTexts(home, ws) {
  const store = readSessionEvents(home, { workspace: ws })
  const texts = []
  for (const record of store.records) {
    if (record?.type !== "user/message") continue
    const content = Array.isArray(record?.data?.content) ? record.data.content : []
    const text = content.filter((block) => block?.type === "text").map((block) => String(block.text ?? "")).join("\n")
    if (text.length > 0) texts.push(text)
  }
  return { store, texts }
}

function classifyNotice(texts) {
  const marked = texts.filter((text) => text.includes(NOTICE_MARKER))
  const advisory = marked.filter((text) => text.includes(ADVISORY_PHRASE))
  const provisioned = marked.filter((text) => text.includes(PROVISIONED_PHRASE))
  const signals = advisory.map((text) => /complexity signals ([A-D](?:\/[A-D])*)/.exec(text)?.[1]).filter((value) => value !== undefined)
  return { any: marked.length > 0, advisory: advisory.length, provisioned: provisioned.length, signals }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const { sandbox, dshHome, env } = createSandbox(SLUG)
  const steps = {}

  const inst = await installProfile({ sandbox, dshHome, env })
  push("$ node scripts/install-profile.mjs --yes --dsh-home " + dshHome + " --profile mpd-headless --skip-toolchain\n[[exit=" + inst.status + "]]")
  steps.install = { ok: inst.status === 0, exit: inst.status }
  if (!steps.install.ok) throw new Error("install-profile failed")

  // ── the SHIPPED artifact state, measured (this boot never retargets a row) ──
  const ulwDist = join(REPO, "packages", "mpd-ulw-plugin", "dist", "index.js")
  const ulwDistText = readFileSync(ulwDist, "utf8")
  steps.shippedArtifact = {
    ok: ulwDistText.includes("registerCommand") && ulwDistText.includes("ULW_ACTIVATION_DIRECTIVE"),
    path: ulwDist.replace(REPO + "/", ""),
    sha256: sha(ulwDist),
    markers: ["registerCommand", "ULW_ACTIVATION_DIRECTIVE", "usage: /ulw"].filter((marker) => ulwDistText.includes(marker)),
    note: "the shipped dist must carry the command surface, otherwise this boot would measure PRE-WAVE code (that was the pre-integration observation); no sandbox build and no row retargeting is used here",
  }
  if (!steps.shippedArtifact.ok) throw new Error("the shipped mpd-ulw dist does not carry the command surface")

  const stub = makeStubModel({ label: SLUG, script: [{ text: "QA-T11-MOUNT-OK" }] })
  const port = await stub.listen()
  useStubRoute(dshHome, port)

  const ws = sandboxWorkspace(sandbox, "ws-mount")
  const probeOut = join(sandbox, "probe-shipped.json")
  const overlay = writeProbeOverlay(join(sandbox, "overlay-probe.yml"), probeOut)
  const run = await bootSession({ slug: SLUG, env, cwd: ws, prompt: COMPLEX_PROMPT, stub, extraArgs: ["--patch", overlay] })
  push("[shipped] $ dsh --profile mpd-headless --patch <overlay> " + JSON.stringify(COMPLEX_PROMPT) + " (cwd " + ws + ")\n[[exit=" + run.status + "]]\n" + run.out.slice(0, 12000))

  const probe = existsSync(probeOut) ? JSON.parse(readFileSync(probeOut, "utf8")) : null
  let session = { store: null, texts: [] }
  try { session = recordedUserTexts(env.DSH_HOME, ws) } catch (error) { push("session store unreadable: " + String(error?.message ?? error)) }
  const teams = teamRecords(ws)
  const notice = classifyNotice(session.texts)

  const problems = []
  if (run.status !== 0) problems.push("the boot exited " + run.status)
  const crashes = crashSignatures(run.out)
  if (crashes.length > 0) problems.push("apply crash signatures: " + crashes.join(", "))
  if (/failed to apply loader entry|plugin tree failed to load/.test(run.out)) problems.push("the loader aborted a plugin tree")
  if (probe === null) problems.push("the probe recorded nothing (its row did not mount)")
  else {
    if ((probe.errors ?? []).length > 0) problems.push("probe errors: " + JSON.stringify(probe.errors))
    if (probe.tools?.mpd_ultrawork !== true) problems.push("the mpd-ulw row's tool mpd_ultrawork is not registered (row did not load)")
    if (probe.tools?.mpd_ulw !== true) problems.push("the mpd-ulw row's tool mpd_ulw is not registered (row did not load)")
  }
  const commands = probe?.commands?.names ?? []
  for (const name of REQUIRED_COMMANDS) {
    if (!commands.includes(name)) problems.push("the live command registry does not list " + name)
  }
  for (const descriptor of probe?.commands?.descriptors ?? []) {
    if (!REQUIRED_COMMANDS.includes(descriptor?.name)) continue
    if (typeof descriptor.description !== "string" || descriptor.description.trim() === "") problems.push(descriptor.name + " listed without a description")
    if (descriptor.hint !== "objective") problems.push(descriptor.name + " does not advertise the objective input hint")
  }
  // (c) no PLUGIN pre-staging: the complexity gate advised, it staged nothing.
  if (notice.provisioned !== 0) problems.push("a complex prompt must NOT record the provisioning notice (the plugin staged a team)")
  if (notice.advisory !== 1) problems.push("the advisory route must record EXACTLY ONE advisory notice, got " + notice.advisory)
  if (notice.signals.length === 0) problems.push("the advisory notice must name the fired complexity signals")
  if (teams.active.length !== 0 || teams.archived.length !== 0) problems.push("the plugin pre-staged a team for a complex prompt: " + JSON.stringify(teams))
  const isolation = isolationStep(env.DSH_HOME, sandbox, SLUG)
  if (!isolation.ok) problems.push("workspace isolation violated: " + isolation.error)
  let sessions = { ok: false, error: "not run" }
  try { sessions = assertSessionsSandboxed(dshHome, sandbox, { label: SLUG }) } catch (error) { sessions = { ok: false, error: String(error?.message ?? error) } }
  if (sessions.ok !== true) problems.push("workspace isolation (session keys) violated: " + JSON.stringify(sessions))

  steps.mountedShippedBoot = {
    ok: problems.length === 0,
    problems,
    exit: run.status,
    crashes,
    prompt: COMPLEX_PROMPT,
    tools: probe?.tools ?? null,
    commands,
    descriptors: probe?.commands?.descriptors ?? null,
    registryShape: probe?.registryShape ?? null,
    notice,
    teams,
    isolation,
    sessionsSandboxed: sessions,
    note: "registration instrumentation on the SHIPPED composition: the row is loaded, both command names are listed by the live registry, and a complex prompt produced the advisory notice with ZERO team records",
  }

  if (session.store?.file !== undefined) keepRawSession(OUT_DIR, "arm-mount-shipped", session.store)

  const allOk = Object.values(steps).every((step) => step.ok !== false)
  const result = {
    task: "t11", slug: SLUG, at: new Date().toISOString(),
    baseRevision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim(),
    sourceHashes: {
      "packages/mpd-ulw-plugin/dist/index.js": sha(ulwDist),
      "packages/mpd-agent-teams-plugin/lib/session-start.js": sha(join(REPO, "packages", "mpd-agent-teams-plugin", "lib", "session-start.js")),
    },
    acceptance: "t11 acceptance 6 — a mount-instrumented boot on the integrated revision shows the mpd-ulw row loaded, both command names registered, and no PLUGIN pre-staging for a complex prompt",
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
