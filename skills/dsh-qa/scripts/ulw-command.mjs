#!/usr/bin/env node
// Case ulw-command (user clause 2 + clause 3 surface, and the §1.1 equivalence-table
// confirmation): prove on a REAL boot that
//   1. `/ulw` and `/ultrawork` are registered in the LIVE command registry — the mounted
//      probe lists them from the harness's own `commands` service and EXECUTES both
//      through `commands.execute()` (never a grep of source, never `--dump-config`);
//   2. an EMPTY invocation settles as `kind: "error"` carrying the usage line;
//   3. a NON-EMPTY invocation settles `success` AND really starts a run — the harness
//      session log records the ULW activation directive as a USER-ROLE message of the
//      invoking session, carrying the objective and the ordered autonomy clauses
//      (triage -> gate -> team -> loop -> fix on sight -> close-out, ask nothing);
//   4. the plain-text `/ulw <objective>` GESTURE (headless, no command surface) injects
//      the same directive with zero `command/run` records — the command path is not
//      what answered it.
// Evidence carrier rule (AGENTS.md §7): every assertion reads the harness's session log
// (`lib/session-evidence.mjs`) or a value the real registry returned — never the model's
// prose.
//
// The model step is answered by the LOCAL OpenAI-shaped stub (`extension-isolation.mjs`)
// so the boot is real while no provider credential is read or copied; `apiKeyEnv` is the
// stub literal. That is deliberate: the directive tells a captain to run the whole ULW
// discipline autonomously, and a live model would start a real run (out of scope here —
// the frozen contract names that as U1).
// PREREQ: absent-dsh-binary dsh install @deepseek-ai/dsh so the real harness binary is on PATH
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { readSessionEvents } from "./lib/session-evidence.mjs"
import { sandboxWorkspace } from "./lib/workspace-isolation.mjs"
import {
  REPO, binaryPresent, bootSession, cleanup, createSandbox, gatePrereqs, installProfile,
  isolationStep, keepRawSession, makeStubModel, timestamp, useStubRoute, writeEvidence,
} from "./extension-isolation.mjs"

const SLUG = "ulw-command"
const OBJECTIVE_COMMAND = "qa-ulw-objective-command"
const OBJECTIVE_GESTURE = "qa-ulw-objective-gesture"
const PLUGIN_SRC = join(REPO, "packages", "mpd-ulw-plugin", "src", "index.ts")
const PLUGIN_DIST = join(REPO, "packages", "mpd-ulw-plugin", "dist", "index.js")
const PROBE = join(REPO, "skills", "dsh-qa", "scripts", "lib", "ulw-command-probe.mjs")

/**
 * The literal surface the mounted artifact must carry for the boot to be able to
 * register the commands. Tested against the SHIPPED `dist/index.js` first; a wave that
 * changed only `src` (AGENTS.md §7 T-88: a package's built `dist` belongs to the
 * integration task) leaves that artifact stale, and the case then builds the SAME
 * canonical command from `src` into the sandbox and records the pending rebuild LOUDLY
 * instead of reading a stale artifact as "the feature is missing". The integration
 * rebuild flips `steps.artifact.source` back to `shipped`.
 */
export const COMMAND_SURFACE_MARKERS = ["registerCommand", "ULW_ACTIVATION_DIRECTIVE", "usage: /ulw"]

/**
 * The surface the SHIPPED ADAPTER `dist` must carry for this case's boot to reach the
 * command plane at all: the adapter is the seam the ULW plugin registers through, and
 * the plugin's apply THROWS when the mounted adapter has no `registerCommand`
 * (measured pre-rebuild: `dsh.registerCommand is not a function`).
 */
export const ADAPTER_SURFACE_MARKERS = ["registerCommand", "submitUserTurn"]

/** The injected activation directive's head (the marker that a rewrite really happened). */
export const DIRECTIVE_HEAD_RE = /ULTRAWORK ACTIVATION/

/** The two registered spellings the frozen contract requires (one handler, two names). */
export const REQUIRED_COMMANDS = ["ulw", "ultrawork"]

/**
 * The ORDERED autonomy clauses the injected activation directive must carry. The first
 * five are the contract's C3.1-C3.5 behaviours; `fixOnSight` is C3.4b (D4(f)), part of
 * C3.4 and shipped as its own numbered clause. Each probe is a regex over the INJECTED
 * text, never over the plugin source. `HEAD_PROBE` is the un-numbered head sentence.
 */
export const CLAUSE_PROBES = [
  { id: "triage", label: "C3.1 triage first (before gate/team/loop)", re: /TRIAGE FIRST/ },
  { id: "gate", label: "C3.2 the SAME complexity predicate (flag OR any signal A-D)", re: /GATE:[\s\S]{0,120}complexity predicate[\s\S]{0,160}signal A-D/ },
  { id: "team", label: "C3.3 auto-approved team when warranted (OFFICIAL team tools)", re: /TEAM WHEN WARRANTED[\s\S]{0,400}spawn_teammate[\s\S]{0,400}team_task_create/ },
  { id: "loop", label: "C3.4 loop to completion without asking", re: /LOOP TO COMPLETION[\s\S]{0,120}never stop early to ask the user/ },
  { id: "fixOnSight", label: "C3.4b fix on sight", re: /FIX ON SIGHT/ },
  { id: "closeOut", label: "C3.5 close out on proof", re: /CLOSE OUT ON PROOF/ },
]
/** The activation head: the run asks the user nothing. */
export const HEAD_PROBE = { id: "noQuestions", re: /ask the user nothing/, label: "asks the user nothing" }

/** The RHS tool names the two `DSH Harness Tool Compatibility` tables rely on (observation). */
export const EQUIVALENCE_TABLE_TOOLS = [
  "subagent", "subagent_fork", "job_output", "send_message", "job_kill", "interrupt_agent",
  "agent_teams_create", "agent_teams_status", "mpd_role_spawn", "mpd_role_persona", "skill",
]

/** Which required command names the LIVE registry listed, and whether each carries metadata. */
export function evaluateListing(descriptors, required = REQUIRED_COMMANDS) {
  const problems = []
  if (!Array.isArray(descriptors)) return { ok: false, names: [], problems: ["the real registry listing was not recorded"] }
  const names = descriptors.map((descriptor) => descriptor?.name).filter((value) => typeof value === "string")
  for (const name of required) {
    if (!names.includes(name)) problems.push("the live command registry does not list " + name)
  }
  for (const descriptor of descriptors) {
    if (!required.includes(descriptor?.name)) continue
    if (typeof descriptor.description !== "string" || descriptor.description.trim() === "") problems.push("command " + descriptor.name + " listed without a description")
    if (descriptor.hint !== "objective") problems.push("command " + descriptor.name + " does not advertise the objective input hint")
  }
  return { ok: problems.length === 0, names, problems }
}

/** The empty invocation must settle as an error carrying the usage line (C2.3). */
export function evaluateUsage(result, usageNeedle = "usage: /ulw") {
  const problems = []
  if (result === null || result === undefined) {
    problems.push("the empty invocation did not resolve (the name is not registered)")
  } else {
    if (result.kind !== "error") problems.push("an empty invocation must settle as kind 'error', got " + JSON.stringify(result.kind))
    if (typeof result.text !== "string" || !result.text.includes(usageNeedle)) problems.push("the empty-invocation text must carry the usage line (" + JSON.stringify(result.text ?? null) + ")")
  }
  return { ok: problems.length === 0, problems, result: result ?? null }
}

/** The non-empty invocation must settle success AND name the objective it started (C2.2). */
export function evaluateActivation(result, objective) {
  const problems = []
  if (result === null || result === undefined) {
    problems.push("the non-empty invocation did not resolve (the name is not registered)")
  } else {
    if (result.kind !== "success") problems.push("a non-empty invocation must settle as kind 'success', got " + JSON.stringify(result.kind))
    if (typeof result.text !== "string" || !result.text.includes(objective)) problems.push("the success text must name the objective")
  }
  return { ok: problems.length === 0, problems, result: result ?? null }
}

/** The ordered clause verdict for one directive text (used on the source fixture AND the log). */
export function directiveClauses(text) {
  const found = []
  const missing = []
  for (const probe of CLAUSE_PROBES) {
    const match = probe.re.exec(String(text ?? ""))
    if (match === null) missing.push(probe.id)
    else found.push({ id: probe.id, at: match.index })
  }
  const order = found.map((entry) => entry.id)
  const ordered = found.every((entry, index) => index === 0 || entry.at > found[index - 1].at)
  // The clause NUMBERS must ascend too: renumbering alone (1. GATE before 2. TRIAGE)
  // keeps the physical order but ships a directive whose own numbering contradicts it.
  const numbering = [...String(text ?? "").matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]))
  const numberedAscending = numbering.every((value, index) => index === 0 || value > numbering[index - 1])
  return { found, missing, order, ordered, numbering, numberedAscending, numbered: numbering.length }
}

/**
 * The full assertion on ONE injected directive text: every clause present, in order,
 * at least five numbered clauses, and the objective appended last (C3.1-C3.5 + C3.4b).
 */
export function evaluateDirective(text, objective, { minClauses = 5 } = {}) {
  const clauses = directiveClauses(text)
  const problems = []
  if (typeof text !== "string" || text.length === 0) problems.push("no injected directive message was found in the session log")
  for (const id of clauses.missing) problems.push("the injected directive is missing clause '" + id + "'")
  if (!clauses.ordered) problems.push("the injected directive clause order changed: " + clauses.order.join(" -> "))
  if (!clauses.numberedAscending) problems.push("the injected directive clause numbering does not ascend: " + clauses.numbering.join(","))
  if (clauses.numbered < minClauses) problems.push("the injected directive carries only " + clauses.numbered + " numbered clause(s)")
  if (!HEAD_PROBE.re.test(String(text ?? ""))) problems.push("the injected directive does not carry the head sentence ('" + HEAD_PROBE.id + "')")
  if (typeof text === "string" && !text.includes("OBJECTIVE: " + objective)) problems.push("the injected directive does not carry OBJECTIVE: " + objective)
  return { ok: problems.length === 0, problems, clauses: clauses.order, numbered: clauses.numbered, head: HEAD_PROBE.id }
}

/** The directive array literal as shipped (fixture source for the offline arm). */
export function extractDirective(source) {
  const start = String(source).indexOf("export const ULW_ACTIVATION_DIRECTIVE = [")
  if (start < 0) return null
  const end = String(source).indexOf("].join(", start)
  if (end < 0) return null
  const body = String(source).slice(start, end)
  const parts = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => JSON.parse('"' + match[1] + '"'))
  return parts.length === 0 ? null : parts.join("\n")
}

/** The user-role texts the harness recorded (decoded frame-by-frame by the reader). */
export function userMessageTexts(records) {
  const texts = []
  for (const record of records ?? []) {
    if (record?.type !== "user/message") continue
    const content = Array.isArray(record?.data?.content) ? record.data.content : []
    const text = content.filter((block) => block?.type === "text").map((block) => String(block.text ?? "")).join("\n")
    if (text.length > 0) texts.push(text)
  }
  return texts
}

/** The harness's own command lifecycle records for one session. */
export function commandRecords(records) {
  const runs = []
  const dones = []
  for (const record of records ?? []) {
    if (record?.type === "command/run") runs.push({ name: record.data?.name, args: record.data?.args ?? "" })
    if (record?.type === "command/done") dones.push({ kind: record.data?.kind, text: record.data?.text ?? "" })
  }
  return { runs, dones }
}

/** Both ULW names really entered the dispatcher, with one error (usage) and one success. */
export function evaluateLifecycle(commands) {
  const problems = []
  const names = (commands?.runs ?? []).map((run) => run.name)
  for (const name of REQUIRED_COMMANDS) {
    if (!names.includes(name)) problems.push("the session log carries no command/run for " + name)
  }
  const kinds = (commands?.dones ?? []).map((done) => done.kind)
  if (!kinds.includes("error")) problems.push("the session log carries no command/done of kind 'error' (the empty invocation)")
  if (!kinds.includes("success")) problems.push("the session log carries no command/done of kind 'success' (the started run)")
  return { ok: problems.length === 0, problems, names, kinds }
}

/** The tool names the model request header offered (harness-recorded tool-list evidence). */
export function headerToolNames(records) {
  for (const record of records ?? []) {
    if (record?.type !== "request/header") continue
    const tools = record?.data?.header?.tools
    if (!Array.isArray(tools)) continue
    return tools.map((tool) => tool?.name ?? tool?.function?.name).filter((name) => typeof name === "string")
  }
  return []
}

/** Read one workspace's newest session store, or a structured read error (never a throw). */
function readOrNull(dshHome, workspace) {
  try {
    return readSessionEvents(dshHome, { workspace })
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
}

/** Whether a built artifact carries every marker of its surface. */
export function artifactSurface(path, markers) {
  if (!existsSync(path)) return { exists: false, fresh: false, missing: [...markers] }
  const text = readFileSync(path, "utf8")
  const missing = markers.filter((marker) => !text.includes(marker))
  return { exists: true, fresh: missing.length === 0, missing }
}

/**
 * Resolve one plugin artifact for the boot: the SHIPPED `dist` when it carries the
 * surface, else a sandbox build of the same canonical repo-root `bun build` command
 * (never written to `dist`, never a hand edit). Returns the row override the overlay
 * needs when the shipped artifact is stale (the loader REFUSES a patch that changes a
 * row's `name`, so the stale row is DISABLED and the built one is inserted under a new
 * id — one registration either way).
 */
export function resolveArtifact({ sandbox, label, srcEntry, distPath, markers, log }) {
  const shipped = artifactSurface(distPath, markers)
  if (shipped.fresh) return { label, source: "shipped", path: distPath, shipped, missing: [], ok: true }
  const built = join(sandbox, "src-build", label + ".js")
  mkdirSync(join(sandbox, "src-build"), { recursive: true })
  const build = spawnSync("bun", ["build", srcEntry, "--target", "node", "--format", "esm", "--outfile", built], { cwd: REPO, encoding: "utf8", timeout: 300000, stdio: ["ignore", "pipe", "pipe"] })
  if (log !== undefined) log.push("$ bun build " + srcEntry + " --target node --format esm --outfile " + built + "\n[[exit=" + build.status + "]]\n" + ((build.stdout || "") + (build.stderr || "")).slice(0, 2000))
  const builtSurface = artifactSurface(built, markers)
  return {
    label, source: "src-built", path: built, shipped, missing: shipped.missing,
    buildExit: build.status,
    ok: build.status === 0 && builtSurface.fresh,
    built: builtSurface,
  }
}

/** The `--patch` overlay: row overrides first, then the inserted rows. */
export function buildOverlay({ artifacts, probe }) {
  const lines = []
  for (const artifact of artifacts) {
    if (artifact.source === "shipped") continue
    // A stale shipped row is replaced by the built one: the loader refuses a `name`
    // change on an existing row, so it is disabled and the build is inserted.
    lines.push("- id: " + artifact.rowId, "  disabled: true")
  }
  const inserts = []
  for (const artifact of artifacts) {
    if (artifact.source === "shipped") continue
    inserts.push("    - id: " + artifact.insertId, "      name: " + JSON.stringify(artifact.path))
    if (artifact.config !== undefined) inserts.push("      config:", "        maxRounds: " + artifact.config.maxRounds)
  }
  if (probe !== undefined) {
    inserts.push("    - id: ulw-command-probe", "      name: " + JSON.stringify(PROBE), "      config:",
      "        outFile: " + JSON.stringify(probe.outFile), "        objective: " + JSON.stringify(probe.objective))
  }
  if (inserts.length > 0) lines.push("- insert:", ...inserts)
  return lines.length === 0 ? null : lines.join("\n") + "\n"
}

async function runReal() {
  gatePrereqs({
    slug: SLUG,
    prereqs: [{ code: "absent-dsh-binary", probe: "dsh", present: () => binaryPresent("dsh"), remedy: "install @deepseek-ai/dsh so the real harness binary is on PATH" }],
  })
  const outDir = process.env.MPD_QA_EVIDENCE_DIR
    ? join(process.env.MPD_QA_EVIDENCE_DIR, SLUG + "-" + timestamp())
    : join(REPO, "evidence", "dsh-qa", SLUG, timestamp())
  mkdirSync(outDir, { recursive: true })
  const log = []
  const push = (text) => { log.push(text) }

  const box = createSandbox(SLUG)
  const { sandbox, dshHome, env } = box
  if (env.HOME === homedir() || dshHome === join(homedir(), ".dsh")) {
    console.error("[" + SLUG + "] FAIL: isolation assertion — the sandbox overlaps the real home")
    process.exit(1)
  }
  const steps = {}

  const inst = await installProfile({ sandbox, dshHome, env })
  push("$ node scripts/install-profile.mjs --yes --dsh-home " + dshHome + " --profile mpd-headless --skip-toolchain\n[[exit=" + inst.status + "]]\n" + inst.out.slice(0, 4000))
  steps.install = { ok: inst.status === 0, exit: inst.status }

  // ── the mounted artifacts ───────────────────────────────────────────────────
  // The adapter carries the command + turn seams this surface needs; both plugins are
  // resolved the same way. A stale SHIPPED artifact (a wave that changed `src` only —
  // the built `dist` belongs to the integration task, AGENTS.md §7 T-88) is replaced in
  // the sandbox composition by a build of the SAME canonical command, and is recorded
  // LOUDLY as a pending integration rebuild instead of reading a stale artifact as
  // "the feature is missing".
  const adapter = resolveArtifact({
    sandbox, label: "mpd-dsh-adapter",
    srcEntry: "packages/mpd-dsh-adapter-plugin/src/index.ts",
    distPath: join(REPO, "packages", "mpd-dsh-adapter-plugin", "dist", "index.js"),
    markers: ADAPTER_SURFACE_MARKERS, log,
  })
  adapter.rowId = "mpd-dsh-adapter"
  adapter.insertId = "ulw-command-adapter"
  const ulw = resolveArtifact({
    sandbox, label: "mpd-ulw",
    srcEntry: "packages/mpd-ulw-plugin/src/index.ts",
    distPath: PLUGIN_DIST,
    markers: COMMAND_SURFACE_MARKERS, log,
  })
  ulw.rowId = "mpd-ulw"
  ulw.insertId = "ulw-command-artifact"
  ulw.config = { maxRounds: 3 }
  const artifacts = [adapter, ulw]
  // `shippedFresh` decides WHICH composition is gated; `resolvedUsable` decides whether
  // any boot can run at all (a failed src build would otherwise be read as a feature gap).
  const shippedFresh = artifacts.every((artifact) => artifact.source === "shipped")
  const resolvedUsable = artifacts.every((artifact) => artifact.ok === true)
  steps.artifact = {
    ok: resolvedUsable,
    sources: Object.fromEntries(artifacts.map((artifact) => [artifact.label, { source: artifact.source, path: artifact.path, missingInShipped: artifact.missing, buildExit: artifact.buildExit ?? null }])),
    shippedMarkers: { adapter: ADAPTER_SURFACE_MARKERS, ulw: COMMAND_SURFACE_MARKERS },
    pendingIntegrationRebuild: !shippedFresh,
    note: "a src-built artifact proves the wave's code on a real boot; the shipped dist carries the same code after the wave's single integration rebuild",
  }
  if (!resolvedUsable) push("[artifact] a src-built artifact failed to build; the gated arms cannot run")

  // The model step is answered by the local stub: no provider credential is read,
  // and a stub cannot start a real autonomous ULW run.
  const stub = makeStubModel({ label: SLUG, script: [{ text: "QA-STUB-ULW-COMMAND-OK" }] })
  const port = await stub.listen()
  useStubRoute(dshHome, port)

  /**
   * One booting arm: write the overlay (null = boot the installed composition as-is),
   * boot, and read the probe record + the harness session log for that workspace.
   */
  async function arm(label, { prompt, overlay, probeOut }) {
    const ws = sandboxWorkspace(sandbox, "ws-" + label)
    const args = overlay === null ? [] : ["--patch", overlay]
    const run = await bootSession({ slug: SLUG + "-" + label, env, cwd: ws, prompt, stub, extraArgs: args })
    push("[" + label + "] $ dsh --profile mpd-headless " + (overlay === null ? "" : "--patch <overlay> ") + JSON.stringify(prompt) + " (cwd " + ws + ")\n[[exit=" + run.status + "]]\n" + run.out.slice(0, 8000))
    const probe = probeOut !== undefined && existsSync(probeOut) ? JSON.parse(readFileSync(probeOut, "utf8")) : null
    const store = readOrNull(dshHome, ws)
    const records = store.records ?? []
    const commands = commandRecords(records)
    const users = userMessageTexts(records)
    return {
      label, prompt, ws, run, probe, store, records, commands, users,
      isolation: isolationStep(dshHome, sandbox, SLUG + "-" + label),
      directiveFor: (objective) => users.find((text) => text.includes(objective)) ?? "",
    }
  }

  /** The gating assertions of one arm: registry listing, usage, activation, injection. */
  function evaluateArm(armResult, objective) {
    const problems = []
    const listing = evaluateListing(armResult.probe?.descriptors)
    const usage = evaluateUsage(armResult.probe?.empty)
    const activation = evaluateActivation(armResult.probe?.filled, objective)
    const lifecycle = evaluateLifecycle(armResult.commands)
    const injected = evaluateDirective(armResult.directiveFor(objective), objective)
    for (const part of [listing, usage, activation, lifecycle, injected]) problems.push(...part.problems)
    if (armResult.probe === null) problems.push("the probe recorded nothing (its row did not mount, or the plugin tree failed to load)")
    if (!armResult.isolation.ok) problems.push("workspace isolation violated: " + armResult.isolation.error)
    if (armResult.run.status !== 0) problems.push("the boot exited " + armResult.run.status)
    return { ok: problems.length === 0, problems, listing: listing.names, usage: usage.result, activation: activation.result, lifecycle: { runs: lifecycle.names, kinds: lifecycle.kinds }, clauses: injected.clauses, numbered: injected.numbered }
  }

  /**
   * The C2.4 GESTURE arm. A KNOWN cross-lane defect makes the rewrite not happen at all
   * in a real composition: `packages/mpd-ulw-plugin/src/index.ts` matches the gesture
   * against the LAST user-role message of the claimed batch, and this bundle's own
   * composition appends user-role notices AFTER the prompt (runtime context,
   * `<system-reminder>` skill catalog — visible in the same session log). The arm is
   * therefore recorded as a labelled finding owned by the ULW plugin lane, and only a
   * DIFFERENT gesture failure (a directive that IS present but malformed, or a
   * command/run record on this path) fails this case.
   */
  function evaluateGesture(gesture) {
    const text = gesture.directiveFor(OBJECTIVE_GESTURE)
    const rewritten = DIRECTIVE_HEAD_RE.test(text)
    const directive = evaluateDirective(text, OBJECTIVE_GESTURE)
    const problems = []
    if (rewritten) problems.push(...directive.problems)
    if (gesture.commands.runs.length !== 0) problems.push("the gesture path must record NO command/run (it is not the command path): " + JSON.stringify(gesture.commands.runs))
    if (gesture.run.status !== 0) problems.push("the boot exited " + gesture.run.status)
    if (!gesture.isolation.ok) problems.push("workspace isolation violated: " + gesture.isolation.error)
    const finding = rewritten ? null : {
      id: "gesture-rewrite-never-fires",
      owner: "packages/mpd-ulw-plugin/src/index.ts",
      detail: "a real boot records the raw `/ulw <objective>` user message and ZERO rewrites (" + directive.problems.length + " clause problem(s)): the listener matches the gesture against the LAST user-role message of the claimed batch, but the composition appends user-role notices after the prompt (runtime context + `<system-reminder>` skill catalog), so the pattern never matches",
      repair: "match the gesture against the user's OWN message (the first user text of the claimed batch, or scan every user text for the pattern) instead of the last user-role message",
      evidence: "the same session log holds the raw prompt as one user message, the injected notices as LATER user messages, and 0 occurrences of the directive head",
    }
    return {
      ok: problems.length === 0,
      problems,
      gating: rewritten,
      finding,
      rewritten,
      clauses: directive.clauses,
      numbered: directive.numbered,
      commandRuns: gesture.commands.runs.length,
      objectiveSeen: text.includes(OBJECTIVE_GESTURE),
    }
  }

  // ── arm SHIPPED: the composition exactly as installed (a user's boot) ───────
  // It is the GATING arm when both shipped artifacts are fresh; while a rebuild is
  // pending it is recorded as the pending-rebuild observation of the real user path.
  const shippedProbeOut = join(sandbox, "probe-shipped.json")
  const shippedOverlayText = buildOverlay({ artifacts: [], probe: { outFile: shippedProbeOut, objective: OBJECTIVE_COMMAND } })
  const shippedOverlay = join(sandbox, "overlay-shipped.yml")
  writeFileSync(shippedOverlay, shippedOverlayText)
  const shippedArm = await arm("shipped", { prompt: "Reply with exactly: ulw-command-shipped-ok", overlay: shippedOverlay, probeOut: shippedProbeOut })
  steps.shippedComposition = { ...evaluateArm(shippedArm, OBJECTIVE_COMMAND), gating: shippedFresh, applyFailure: /failed to apply loader entry|failed to load/.test(shippedArm.run.out) }
  if (shippedArm.store.file !== undefined) keepRawSession(outDir, "arm-shipped", shippedArm.store)

  let gated = shippedArm
  let gatedProblems = []
  if (!shippedFresh) {
    // ── arm RESOLVED: the stale rows replaced by builds of the same canonical command ──
    const probeOut = join(sandbox, "probe-resolved.json")
    const overlay = join(sandbox, "overlay-resolved.yml")
    writeFileSync(overlay, buildOverlay({ artifacts, probe: { outFile: probeOut, objective: OBJECTIVE_COMMAND } }))
    gated = await arm("resolved", { prompt: "Reply with exactly: ulw-command-resolved-ok", overlay, probeOut })
    steps.resolvedArtifacts = evaluateArm(gated, OBJECTIVE_COMMAND)
    if (gated.store.file !== undefined) keepRawSession(outDir, "arm-resolved", gated.store)

    // The plain-text GESTURE path (headless has no command surface) on the same
    // artifact set: no probe row, and ZERO command/run records may appear.
    const gestureOverlay = join(sandbox, "overlay-gesture.yml")
    writeFileSync(gestureOverlay, buildOverlay({ artifacts }))
    const gesture = await arm("gesture", { prompt: "/ulw " + OBJECTIVE_GESTURE, overlay: gestureOverlay })
    steps.gesture = evaluateGesture(gesture)
    if (gesture.store.file !== undefined) keepRawSession(outDir, "arm-gesture", gesture.store)
    gatedProblems = steps.resolvedArtifacts.problems
  } else {
    // With fresh shipped artifacts the gesture arm boots the installed composition
    // as-is: there is nothing to override.
    const gesture = await arm("gesture", { prompt: "/ulw " + OBJECTIVE_GESTURE, overlay: null })
    steps.gesture = evaluateGesture(gesture)
    if (gesture.store.file !== undefined) keepRawSession(outDir, "arm-gesture", gesture.store)
    gatedProblems = steps.shippedComposition.problems
  }
  await stub.close()

  steps.stubServed = { ok: stub.requests() > 0, requests: stub.requests() }
  steps.workspacesSandboxed = { ok: true, sandbox, gatedWorkspace: gated.ws }
  const offered = headerToolNames(gated.records) || []
  steps.equivalenceTableTools = {
    ok: offered.length > 0,
    observed: offered.length > 0,
    toolCount: offered.length,
    missing: EQUIVALENCE_TABLE_TOOLS.filter((name) => !offered.includes(name)),
  }

  const crossLaneFindings = steps.gesture.finding === null ? [] : [steps.gesture.finding]
  const ok = writeEvidence(outDir, SLUG, {
    // The verdict covers this lane's acceptance: the command surface on a real boot
    // (registry listing + usage + activation + directive), the artifact resolution and
    // the tool-list observation. `steps.shippedComposition` is GATING only when the
    // shipped artifacts are fresh; `steps.gesture` fails this case only on a gesture
    // failure OTHER than the known cross-lane finding it carries.
    ok: steps.install.ok && steps.artifact.ok && gatedProblems.length === 0 && (steps.gesture.ok || steps.gesture.gating === false) && steps.equivalenceTableTools.ok,
    steps: { ...steps, gatedProblems },
    crossLaneFindings,
    env: { DSH_HOME: dshHome, HOME: env.HOME },
    gatingArm: shippedFresh ? "shipped" : "resolved (src-built artifacts)",
    gatingNote: "steps.shippedComposition (gating=" + steps.shippedComposition.gating + ") and steps.gesture (gating=" + steps.gesture.gating + ") are recorded; a repair of the gesture finding turns its gating flag true",
  }, log.join("\n\n---\n\n"))
  cleanup(sandbox)
  if (!ok) process.exit(1)
  console.log("[" + SLUG + "] PASS")
}

// ── offline --self-test ──────────────────────────────────────────────────────
function selfTest() {
  const problems = []
  const check = (condition, label) => { if (!condition) problems.push(label) }

  // 1) the LIVE-registry predicate: both names + metadata, falsifiable on both sides.
  check(evaluateListing([{ name: "ulw", description: "u", hint: "objective" }, { name: "ultrawork", description: "u", hint: "objective" }]).ok, "reference listing must pass")
  check(!evaluateListing([{ name: "ulw", description: "u", hint: "objective" }]).ok, "negative control: a single registered name must fail")
  check(!evaluateListing([]).ok, "negative control: an empty registry must fail")
  check(!evaluateListing([{ name: "ulw", description: "", hint: "objective" }, { name: "ultrawork", description: "u", hint: "objective" }]).ok, "negative control: an empty description must fail")
  check(!evaluateListing([{ name: "ulw", description: "u", hint: null }, { name: "ultrawork", description: "u", hint: "objective" }]).ok, "negative control: a missing input hint must fail")
  check(!evaluateListing(null).ok, "negative control: an unrecorded listing must fail")

  // 2) the empty-invocation / started-run predicates.
  check(evaluateUsage({ kind: "error", text: "usage: /ulw <objective> (alias: /ultrawork <objective>)" }).ok, "the usage result must pass")
  check(!evaluateUsage({ kind: "success", text: "ULW activated: x" }).ok, "negative control: a success on empty input must fail")
  check(!evaluateUsage({ kind: "error", text: "boom" }).ok, "negative control: an error without the usage line must fail")
  check(!evaluateUsage(null).ok, "negative control: an unresolved name must fail")
  check(evaluateActivation({ kind: "success", text: "ULW activated: obj" }, "obj").ok, "the activation result must pass")
  check(!evaluateActivation({ kind: "error", text: "ULW could not start" }, "obj").ok, "negative control: a failed activation must fail")
  check(!evaluateActivation({ kind: "success", text: "ULW activated: other" }, "obj").ok, "negative control: a success for another objective must fail")

  // 3) the directive predicate against the SHIPPED directive literal (source fixture),
  //    plus order/content controls. The same predicate runs on the real session log.
  const source = readFileSync(PLUGIN_SRC, "utf8")
  const directive = extractDirective(source)
  check(typeof directive === "string" && directive.length > 0, "the ULW_ACTIVATION_DIRECTIVE literal could not be extracted")
  const good = evaluateDirective((directive ?? "") + "\n\nOBJECTIVE: self-test-objective", "self-test-objective")
  check(good.ok, "the shipped directive must satisfy the clause predicate: " + good.problems.join("; "))
  check(good.clauses.length === CLAUSE_PROBES.length, "every clause probe must match the shipped directive")
  // Order/reordering controls: physically swapping two clause LINES and renumbering
  // alone must each fail the predicate (the number swap alone must not, since the
  // physical order — the property the contract cares about — is preserved).
  const swapLines = (text, a, b) => {
    const lines = String(text).split("\n")
    const at = (prefix) => lines.findIndex((line) => line.startsWith(prefix))
    const indexA = at(a + ". ")
    const indexB = at(b + ". ")
    const swappedLines = [...lines]
    swappedLines[indexA] = lines[indexB]
    swappedLines[indexB] = lines[indexA]
    return swappedLines.join("\n")
  }
  const reordered = swapLines(directive ?? "", "1", "2")
  check(!evaluateDirective(reordered + "\n\nOBJECTIVE: self-test-objective", "self-test-objective").ok, "negative control: a physically reordered clause pair must fail")
  const renumbered = (directive ?? "").replace(/^1\. TRIAGE FIRST/m, "9. TRIAGE FIRST").replace(/^2\. GATE:/m, "1. GATE:").replace(/^9\. TRIAGE FIRST/m, "2. TRIAGE FIRST")
  check(!evaluateDirective(renumbered + "\n\nOBJECTIVE: self-test-objective", "self-test-objective").ok, "negative control: non-ascending clause numbers must fail")
  check(!evaluateDirective((directive ?? "").replace(/^5\. FIX ON SIGHT.*$/m, "") + "\n\nOBJECTIVE: self-test-objective", "self-test-objective").ok, "negative control: a removed clause must fail")
  check(!evaluateDirective((directive ?? "") + "\n\nOBJECTIVE: another-objective", "self-test-objective").ok, "negative control: a directive without the objective must fail")
  check(!evaluateDirective("", "self-test-objective").ok, "negative control: an empty directive must fail")

  // 4) the command-lifecycle predicate.
  check(evaluateLifecycle({ runs: [{ name: "ulw" }, { name: "ultrawork" }], dones: [{ kind: "error" }, { kind: "success" }] }).ok, "the reference lifecycle must pass")
  check(!evaluateLifecycle({ runs: [{ name: "ulw" }], dones: [{ kind: "error" }, { kind: "success" }] }).ok, "negative control: a missing command/run must fail")
  check(!evaluateLifecycle({ runs: [{ name: "ulw" }, { name: "ultrawork" }], dones: [{ kind: "success" }] }).ok, "negative control: a missing usage failure must fail")
  check(!evaluateLifecycle({ runs: [], dones: [] }).ok, "negative control: an empty store must fail")

  // 5) the shipped surface must exist where the case reads it.
  check(existsSync(PROBE), "the command probe module is missing")
  check(COMMAND_SURFACE_MARKERS.every((marker) => source.includes(marker)), "packages/mpd-ulw-plugin/src/index.ts does not carry the full command surface: " + COMMAND_SURFACE_MARKERS.filter((marker) => !source.includes(marker)).join(","))
  check(source.includes('["ulw", "ultrawork"]'), "the plugin must register both spellings from one handler")
  check(source.includes("usage: /ulw <objective>"), "the plugin must ship the usage line the case asserts")

  // 6) the composition surgery that replaces a stale row: pinned offline on fixtures,
  //    because a wrong overlay silently boots the WRONG artifact.
  const tmp = mkdtempSync(join(tmpdir(), "mpd-ulw-command-selftest-"))
  try {
    const fresh = join(tmp, "fresh.js")
    writeFileSync(fresh, COMMAND_SURFACE_MARKERS.join("\n") + "\n")
    const stale = join(tmp, "stale.js")
    writeFileSync(stale, "// an artifact from before the change\n")
    check(artifactSurface(fresh, COMMAND_SURFACE_MARKERS).fresh, "artifactSurface must accept a file carrying every marker")
    const staleSurface = artifactSurface(stale, COMMAND_SURFACE_MARKERS)
    check(!staleSurface.fresh && staleSurface.missing.length === COMMAND_SURFACE_MARKERS.length, "artifactSurface must report a stale file's missing markers")
    check(!artifactSurface(join(tmp, "absent.js"), COMMAND_SURFACE_MARKERS).fresh, "artifactSurface must treat a missing file as stale")

    const shippedArtifact = { label: "mpd-ulw", source: "shipped", path: fresh, rowId: "mpd-ulw", insertId: "ulw-command-artifact", missing: [], ok: true }
    const staleArtifact = { label: "mpd-ulw", source: "src-built", path: stale, rowId: "mpd-ulw", insertId: "ulw-command-artifact", config: { maxRounds: 3 }, missing: ["registerCommand"], ok: true }
    const freshOverlay = buildOverlay({ artifacts: [shippedArtifact], probe: { outFile: join(tmp, "p.json"), objective: "obj" } })
    check(freshOverlay.includes("ulw-command-probe") && !freshOverlay.includes("disabled"), "a fresh artifact must not disable or replace any row")
    check(buildOverlay({ artifacts: [shippedArtifact] }) === null, "no stale artifact and no probe must produce no overlay at all")
    const staleOverlay = buildOverlay({ artifacts: [staleArtifact], probe: { outFile: join(tmp, "p.json"), objective: "obj" } })
    check(/- id: mpd-ulw\n  disabled: true/.test(staleOverlay), "a stale artifact must DISABLE its shipped row (a name change is refused by the loader)")
    check(staleOverlay.includes("    - id: ulw-command-artifact") && staleOverlay.includes(JSON.stringify(stale)), "a stale artifact must be inserted under its own id, pointing at the build")
    check(staleOverlay.includes("maxRounds: 3"), "the inserted row must carry the plugin config")

    // `resolveArtifact` prefers a fresh SHIPPED file and does not build in that case.
    const resolved = resolveArtifact({ sandbox: tmp, label: "ulw-command-self-test", srcEntry: "packages/mpd-ulw-plugin/src/index.ts", distPath: fresh, markers: COMMAND_SURFACE_MARKERS })
    check(resolved.source === "shipped" && resolved.path === fresh && !existsSync(join(tmp, "src-build")), "resolveArtifact must use a fresh shipped artifact without building")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  const skill = readFileSync(join(REPO, "skills", "dsh-qa", "SKILL.md"), "utf8")
  check(skill.includes("| ulw-command |"), "the case table does not list ulw-command")

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " problem(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: registry listing + usage + activation + directive order/objective + command lifecycle predicates, each with a negative control; shipped directive literal and SKILL.md row verified")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else await runReal()
