#!/usr/bin/env node
// Offline probe: evaluate the session-start complexity gate against the THREE verbatim
// frozen prompt sets and BOTH directions of the routing contract. Exits non-zero unless
// every SIMPLE prompt is untriggered AND routes `none`, every SOFT-COMPLEX prompt
// triggers AND routes `advise` (the advisory path stages nothing — user clause 4), and
// every EXPLICIT `team:` prompt triggers AND routes `provision`. The policy-disabled
// control proves the whole reading is falsifiable: with `autoRoute: false` every prompt
// must route `none` and match no signal, so a gate that can only answer one way cannot
// pass this probe.
//
// Used by `session-start-team.mjs --self-test`, which imports the SAME prompt arrays
// this probe evaluates (so the offline predicate and the live sides can never drift),
// and runnable standalone: `node skills/dsh-qa/scripts/lib/gate-probe.mjs`.
// Never touches the network or any DSH state; the workspace passed to the gate is an
// empty temp directory.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..", "..")
const modulePath = join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "session-start.js")

// ── the frozen prompt sets (one source of truth for the offline probe and the live case) ──
export const SIMPLE_PROMPTS = [
  "Reply with exactly: hello-ok",
  "What does the git-master skill do? Answer in one sentence.",
  "Rename the variable `foo` to `bar` in src/util.ts and run its test.",
]
export const SOFT_COMPLEX_PROMPTS = [
  "Align the bundle with upstream: audit the orchestration surface, then implement the routing change.",
  "1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot",
]
export const EXPLICIT_PROMPTS = [
  "team: fix the flaky test",
]

/**
 * The three-way routing table one prompt set must satisfy. `none` = no team and no
 * notice; `advise` = the gate fired and the run is ADVISORY (still no team);
 * `provision` = a team is staged. The expectations are part of the probe's contract,
 * never a caller-supplied argument, so a caller cannot weaken a side.
 */
export const ROUTE_EXPECTATION = { simple: "none", soft: "advise", explicit: "provision" }

/** The routing decision for one prompt under one policy (never throws). */
export async function routeOf(gate, prompt, workspace, policy = { mode: "off", autoRoute: true, profile: "mpd" }) {
  const consumed = gate.consumeExplicitFlag(prompt)
  const verdict = gate.evaluateComplexityGate(consumed.text, {
    explicitFlag: consumed.flagged,
    planArtifact: await gate.hasPlanArtifact(workspace),
  })
  const route = await gate.routeDecision(policy, prompt, workspace)
  return { consumed, verdict, route }
}

/** Evaluate one labelled prompt set against its expectation. Returns per-prompt rows. */
export async function probeSet(gate, label, prompts, workspace, policy = undefined) {
  const expect = ROUTE_EXPECTATION[label]
  const rows = []
  for (const prompt of prompts) {
    const { consumed, verdict, route } = await routeOf(gate, prompt, workspace, policy)
    const problems = []
    if (label === "simple" && verdict.trigger) problems.push("a SIMPLE prompt must not trigger the gate")
    if (label !== "simple" && !verdict.trigger) problems.push("a COMPLEX prompt must trigger the gate")
    if (route.action !== expect) problems.push("routeDecision must return '" + expect + "', got '" + route.action + "'")
    if (label === "simple" && route.signals.length !== 0) problems.push("an untriggered route must carry no signals")
    if (label !== "simple" && route.signals.length === 0) problems.push("a triggered route must name at least one signal")
    // The explicit flag must be CONSUMED, never left in the goal text.
    if (consumed.flagged && consumed.text.includes("!team")) problems.push("flag not consumed: " + prompt)
    if (consumed.flagged && /^team:/i.test(consumed.text.trim())) problems.push("team: prefix not consumed: " + prompt)
    rows.push({ label, prompt, expect, action: route.action, signals: route.signals, trigger: verdict.trigger, consumed: consumed.flagged, problems })
  }
  return rows
}

/** The full offline probe: the three sets in order, then the policy-disabled control. */
export async function probeAll(gate, workspace, { policyOff = true } = {}) {
  const rows = []
  rows.push(...await probeSet(gate, "simple", SIMPLE_PROMPTS, workspace))
  rows.push(...await probeSet(gate, "soft", SOFT_COMPLEX_PROMPTS, workspace))
  rows.push(...await probeSet(gate, "explicit", EXPLICIT_PROMPTS, workspace))
  const disabled = []
  if (policyOff) {
    // The raw predicate stays policy-independent (it still reports the matched
    // signals); what the DISABLED policy must not do is ACT on them: every prompt
    // routes `none` and carries no signals, and no team/notice can follow.
    const off = { mode: "off", autoRoute: false, profile: "mpd" }
    for (const prompt of [...SIMPLE_PROMPTS, ...SOFT_COMPLEX_PROMPTS, ...EXPLICIT_PROMPTS]) {
      const { route } = await routeOf(gate, prompt, workspace, off)
      const problems = []
      if (route.action !== "none") problems.push("autoRoute:false must route 'none', got '" + route.action + "'")
      if (route.signals.length !== 0) problems.push("autoRoute:false must carry no signals")
      disabled.push({ label: "control", prompt, action: route.action, signals: route.signals, problems })
    }
  }
  const failed = rows.filter((row) => row.problems.length > 0).length + disabled.filter((row) => row.problems.length > 0).length
  return { rows, disabled, failed }
}

/** Load the shipped gate module (lib/session-start.js) and probe it in a temp workspace. */
export async function loadAndProbe() {
  const gate = await import(pathToFileURL(modulePath).href)
  const workspace = mkdtempSync(join(tmpdir(), "mpd-gate-probe-"))
  try {
    return await probeAll(gate, workspace)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

// Standalone entry (with or without `--self-test`): run the three sets plus the disabled
// control and FAIL loudly on any violated row. Guarded on being the ENTRY module, so a
// case that imports the prompt sets never triggers the probe's own exit.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const extra = process.argv.slice(2).filter((flag) => flag !== "--self-test")
  if (extra.length > 0) {
    console.error("[gate-probe] FAIL: unknown argument(s): " + extra.join(" "))
    process.exit(1)
  }
  const result = await loadAndProbe()
  for (const row of result.rows) {
    console.log((row.problems.length === 0 ? "OK   " : "BAD  ") + row.label + " action=" + row.action + " signals=[" + row.signals.join(",") + "] | " + JSON.stringify(row.prompt.slice(0, 48)))
  }
  for (const row of result.disabled) {
    console.log((row.problems.length === 0 ? "OK   " : "BAD  ") + "control(autoRoute=false) action=" + row.action + " | " + JSON.stringify(row.prompt.slice(0, 40)))
  }
  if (result.failed > 0) {
    console.error("[gate-probe] FAIL: " + result.failed + " three-way violation(s)")
    for (const row of [...result.rows, ...result.disabled]) for (const problem of row.problems) console.error("  - " + row.label + ": " + problem)
    process.exit(1)
  }
  console.log("[gate-probe] ok: SIMPLE -> none (untriggered), SOFT-COMPLEX -> advise, EXPLICIT team: -> provision, and autoRoute:false -> none everywhere")
}
