#!/usr/bin/env bun
// Case tui-mount: boot the REAL dsh-TUI with the bundle as the THIRD patch layer
// inside a workspace-local sandbox, and assert the mount face.
//
// What it proves (never from prose — always from the harness's own artifacts):
//   • `dsh.profile.bundles` is the triple [dsh-base, dsh-tui, @mpd-dsh/mpd];
//   • the `mpd-tui` row is composed (dump-config) and the live boot carries ZERO
//     apply-crash signatures in the raw ANSI log;
//   • the TUI really rendered (tmux pane capture) with our keyed status line;
//   • the session the boot created ran the `mpd` preset (decoded session record);
//   • no session ever landed outside the sandbox (workspace isolation).
//
// Constraints (CAPTAIN-RECON §2/§5): the host refuses to boot when stdout is a pipe,
// so the boot happens inside tmux and this process owns the whole lifecycle; the
// profile is WARM in the sandbox root and is never silently reinstalled.
//
// PREREQ: absent-dsh-binary dsh-tui "npm i -g @deepseek-harness-tui/dsh-tui@0.10.1"
// PREREQ: absent-runtime tmux "install tmux; the TUI requires a real TTY"
// PREREQ: absent-fixture tui profile in the sandbox root "bun skills/dsh-qa/scripts/tui-mount.mjs --sandbox-root <root> --install"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-mount.mjs --self-test
//   bun skills/dsh-qa/scripts/tui-mount.mjs [--sandbox-root <dir>] [--fresh] [--install]
// Evidence -> evidence/tui/lanes/<timestamp>/{result.json,output.log,*.pane.txt,tui-pane.log}
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  REPO, artifactRevision, classifyAdmissionPane, crashSignatures, dumpConfig, extractBundles, gateTuiPrereqs,
  laneEvidenceDir, makeChecks, manifestDigest, parseSandboxArgs, profileState, readSessionHeaders, runInSandbox,
  runTuiSession, sandboxProjectKey, sessionStoreKeys, sha256File, tuiPrereqs, writeLaneEvidence, writeRevisionFile,
  writeSessionExcerpt,
} from "./lib/tui-lane.mjs"

const SLUG = "tui-mount"
const EXPECTED_BUNDLES = ["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]

/** The layering claim: our bundle joins as the THIRD layer, in that order. */
export function assertLayering(bundles) {
  const missing = EXPECTED_BUNDLES.filter((entry) => !bundles.includes(entry))
  const order = EXPECTED_BUNDLES.map((entry) => bundles.indexOf(entry))
  const ordered = order.every((value, index) => value >= 0 && (index === 0 || value > order[index - 1]))
  return {
    ok: missing.length === 0 && ordered,
    missing,
    ordered,
    bundles,
    reason: missing.length > 0 ? "missing bundle layer(s): " + missing.join(", ") : ordered ? "triple layer in order" : "layers present but out of order",
  }
}

/** The live-boot assertions, kept pure so the self-test can falsify them. */
export function assertBootFace({ pane, log, bundles, sessions }) {
  const crashes = crashSignatures(log)
  const layering = assertLayering(bundles)
  const statusLine = /mpd:\s+team /.test(pane)
  // The TUI localizes its chrome: accept the English AND the Chinese counter labels.
  const counters = /(Tools|工具)\s*\d+/.test(pane) && /(Skills|技能)\s*\d+/.test(pane)
  const rendered = pane.trim().length > 0
  const preset = sessions.find((entry) => entry.agentPreset === "mpd")
  return {
    ok: layering.ok && crashes.length === 0 && statusLine && counters && rendered && preset !== undefined,
    layering,
    crashSignatures: crashes,
    statusLine,
    counters,
    rendered,
    presetSessionId: preset?.sessionId,
    presetAgentPreset: preset?.agentPreset,
  }
}

function selfTest() {
  const { check, problems } = makeChecks()

  const fixture = "  dsh:\n    profile:\n      bundles: ['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui', '@mpd-dsh/mpd']"
  check(assertLayering(extractBundles(fixture)).ok, "the triple layering must be accepted")
  const pair = "bundles: ['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui']"
  check(!assertLayering(extractBundles(pair)).ok, "a NEGATIVE CONTROL failed: a two-layer composition must be rejected")
  const reordered = "bundles: ['@deepseek-harness-tui/dsh-tui', '@deepseek-ai/dsh-base', '@mpd-dsh/mpd']"
  check(!assertLayering(extractBundles(reordered)).ok, "a NEGATIVE CONTROL failed: an out-of-order composition must be rejected")

  check(crashSignatures("clean boot log").length === 0, "a clean log must have zero crash signatures")
  check(crashSignatures("failed to apply loader entry x").length === 1, "a NEGATIVE CONTROL failed: an apply-crash signature must be detected")
  check(crashSignatures("duplicate loader entry id: agent-presets").length === 1, "a duplicate-entry-id log must be detected")

  const good = {
    pane: "… DEEPSEEK HARNESS … Tools 94 Skills 18\nmpd: team - · plans 1 · workmates 0\n> ",
    log: "boot ok",
    bundles: EXPECTED_BUNDLES,
    sessions: [{ sessionId: "s1", agentPreset: "mpd" }],
  }
  check(assertBootFace(good).ok, "the reference boot face must pass")
  check(!assertBootFace({ ...good, bundles: ["@deepseek-ai/dsh-base"] }).ok, "a NEGATIVE CONTROL failed: a missing layer must fail the boot face")
  check(!assertBootFace({ ...good, log: "plugin tree failed to load" }).ok, "a NEGATIVE CONTROL failed: a crash signature must fail the boot face")
  check(!assertBootFace({ ...good, sessions: [{ sessionId: "s", agentPreset: "standard" }] }).ok, "a NEGATIVE CONTROL failed: a non-mpd preset must fail the boot face")
  check(!assertBootFace({ ...good, pane: "no pane" }).ok, "a NEGATIVE CONTROL failed: a pane without the status line must fail")

  const patch = existsSync(join(REPO, "packages", "mpd-bundle", "cordis.patch.yml"))
  check(patch, "the bundle patch is missing")
  const skill = existsSync(join(REPO, "skills", "dsh-qa", "SKILL.md"))
  check(skill, "SKILL.md is missing")
  if (skill) {
    const text = readFileSync(join(REPO, "skills", "dsh-qa", "SKILL.md"), "utf8")
    check(text.includes("| tui-mount |"), "the case table does not list tui-mount")
  }
  check(classifyAdmissionPane("Negotiation decision: waiting_authorization (PERMISSION_NOT_GRANTED: x)").ok,
    "the shared admission classifier must accept the explainable waiting_authorization state")

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " check(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: layering, crash-scan, boot-face and isolation predicates are two-sided")
}

function real() {
  const argv = process.argv.slice(2)
  const { root, fresh, explicit } = parseSandboxArgs(argv, SLUG)
  const outDir = laneEvidenceDir(SLUG)
  const log = []
  const say = (line) => { log.push(line); console.log("[" + SLUG + "] " + line) }

  const revisionBefore = artifactRevision()
  const wantsInstall = argv.includes("--install")

  // T8-F1: the requested install runs BEFORE the gate, so `--install` on a fresh root
  // is actually attempted; the gate then judges the RESULT of that attempt and, when
  // the caller asked for the install and the profile is still unusable, it FAILS with
  // a named reason instead of exiting green on a skip.
  let installAttempt
  if (wantsInstall) {
    say("installing the host into the sandbox profile (network required): " + root)
    const host = runInSandbox(root, "dsh", ["plugin", "--profile", "dsh-tui", "add", "@deepseek-harness-tui/dsh-tui@0.10.1"], { timeoutMs: 900_000 })
    say("host install exit=" + host.status)
    const bundle = runInSandbox(root, "dsh", ["plugin", "--profile", "dsh-tui", "add", REPO], { timeoutMs: 900_000 })
    say("bundle install exit=" + bundle.status)
    const installLog = join(outDir, "install.log")
    writeFileSync(installLog, host.stdout + host.stderr + bundle.stdout + bundle.stderr)
    installAttempt = { hostExit: host.status, bundleExit: bundle.status, log: installLog.replace(REPO + "/", ""), root: root.replace(REPO + "/", "") }
    say("install log=" + installAttempt.log)
  }

  const state = profileState(root)
  gateTuiPrereqs(
    SLUG,
    tuiPrereqs({ sandboxPresent: () => state.present && state.hasHost && state.hasBundle }),
    { requested: wantsInstall ? ["absent-fixture"] : [] },
  )

  say("sandbox root=" + root + " explicit=" + explicit + " warm=" + state.present + " fresh=" + fresh)
  const before = sessionStoreKeys(root)
  const dump = dumpConfig(root)
  writeFileSync(join(outDir, "dump-config.txt"), dump.stdout + dump.stderr)
  // The bundle LAYERING is authoritative in the profile manifest (the patch layers
  // compose into it); the dump-config text is a composition cross-check.
  const profile = profileState(root)
  const bundles = profile.bundles.length > 0 ? profile.bundles : extractBundles(dump.stdout)
  say("profile bundles=" + JSON.stringify(profile.bundles) + " (dump-config carries " + extractBundles(dump.stdout).length + " row(s))")
  const rowComposed = /id:\s*['"]?mpd-tui['"]?/.test(dump.stdout) && dump.stdout.includes("packages/mpd-tui-plugin/dist/index.js")
  say("dump-config exit=" + dump.status + " bundles=" + JSON.stringify(bundles) + " rowComposed=" + rowComposed)

  const session = runTuiSession({ lane: SLUG, root, outDir, steps: [], bootWaitMs: 90_000 })
  for (const failure of session.failures) say("tmux: " + failure)
  const bootPanePath = session.panes[0]?.file
  if (bootPanePath !== undefined) {
    // AC-11's preset witness is the SAME capture, kept under the name the contract uses.
    writeFileSync(join(outDir, "preset.pane.txt"), session.panes[0].text)
  }
  const allSessions = readSessionHeaders(root, { limit: 400 })
  // The preset witness must come from a session THIS run created (the sandbox-keyed
  // store), never from an earlier run inherited in a warm root.
  const expectedProjectKey = sandboxProjectKey(root)
  // Prefer the NEWEST sandbox-keyed record: the witness must be the session THIS run
  // created, not whichever one readdir happened to return first.
  const sessions = allSessions
    .filter((entry) => entry.projectKey === expectedProjectKey)
    .sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
  const presetFile = writeSessionExcerpt(outDir, "preset.session.json", allSessions)
  const sandboxSessions = allSessions.filter((entry) => entry.projectKey === expectedProjectKey)
  // Isolation is asserted on the DELTA this run created — a warm shared root may
  // legitimately carry earlier runs' stores, and those are reported separately.
  const after = sessionStoreKeys(root)
  const created = after.filter((key) => !before.includes(key))
  const isolation = created.filter((key) => key !== expectedProjectKey)

  const face = assertBootFace({ pane: session.bootPane, log: session.log, bundles, sessions })
  face.rowComposed = rowComposed
  face.isolationOffenders = isolation
  face.sessionKeysCreated = created
  face.sessionKeysInherited = after.filter((key) => before.includes(key))
  face.expectedProjectKey = expectedProjectKey
  face.sandboxSessions = sandboxSessions.length
  face.sandboxRoot = root
  face.layeringEvidence = "dump-config.txt"
  face.paneEvidence = "boot.pane.txt + tui-pane.log"
  face.presetEvidence = "preset.pane.txt + preset.session.json + " + presetFile.replace(REPO + "/", "")
  const ok = face.ok && rowComposed && isolation.length === 0

  say("statusLine=" + face.statusLine + " counters=" + face.counters + " crashes=" + JSON.stringify(face.crashSignatures))
  say("session keys created=" + JSON.stringify(created) + " inherited=" + JSON.stringify(face.sessionKeysInherited))
  say("preset=" + String(face.presetAgentPreset) + " session=" + String(face.presetSessionId) + " isolationOffenders=" + isolation.length)
  const revisionAfter = artifactRevision()
  const { delta } = writeRevisionFile(outDir, {
    before: revisionBefore,
    after: revisionAfter,
    composition: { sandboxRoot: root.replace(REPO + "/", ""), profile: "dsh-tui", bundles, workspaceTarget: join(root, "ws").replace(REPO + "/", "") },
  })
  if (delta.changed) {
    console.error("[" + SLUG + "] FAIL: " + delta.reason)
    process.exit(1)
  }
  writeLaneEvidence(outDir, SLUG, {
    ok,
    steps: { face, rowComposed, isolation, installAttempt },
    face,
    revision: revisionAfter,
    revisionDelta: delta,
    manifestDigest: manifestDigest(),
  }, log.join("\n"))
  if (!ok) {
    console.error("[" + SLUG + "] FAIL: " + JSON.stringify({ face, rowComposed, isolation }).slice(0, 2000))
    process.exit(1)
  }
  console.log("[" + SLUG + "] PASS: third layer mounted, " + sessions.length + " session record(s) decoded, zero apply-crash signatures")
}

// Entry guard: importing this lane (e.g. to reuse findModelEcho or the surface table)
// must never start a live run. The self-test and the real lane run only when this file IS
// the process entry point.
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest()
  else real()
}
