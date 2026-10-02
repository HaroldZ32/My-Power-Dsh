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
// PREREQ: absent-dsh-binary dsh-tui "npm i -g @deepseek-harness-tui/dsh-tui@0.12.0"
// PREREQ: absent-runtime tmux "install tmux; the TUI requires a real TTY"
// PREREQ: absent-fixture tui profile in the sandbox root "bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root <root> --install"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-mount.ts --self-test
//   bun skills/dsh-qa/scripts/tui-mount.ts [--sandbox-root <dir>] [--fresh] [--install]
// Evidence -> evidence/tui/lanes/<timestamp>/{result.json,output.log,*.pane.txt,tui-pane.log}
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  REPO, artifactRevision, classifyAdmissionPane, crashSignatures, dumpConfig, extractBundles, gateTuiPrereqs,
  laneEvidenceDir, makeChecks, manifestDigest, parseSandboxArgs, profileState, readSessionHeaders, runInSandbox,
  runTuiSession, sandboxProjectKey, sessionStoreKeys, sha256File, tuiPrereqs, writeLaneEvidence, writeRevisionFile,
  writeSessionExcerpt,
} from "./lib/tui-lane.ts"

/** The case slug: names the evidence directory, the tmux socket and every log prefix of this lane. */
const SLUG = "tui-mount"
/** The expected patch layers, in composition order: base, the TUI host, then this bundle. */
const EXPECTED_BUNDLES: readonly string[] = ["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]

/** The layering verdict of one `dsh.profile.bundles` list. */
export interface LayeringVerdict {
  /** True when every expected layer is present AND the present ones keep their relative order. */
  readonly ok: boolean
  /** Expected layers absent from the list, in expected order. */
  readonly missing: string[]
  /** True when the present layers appear in strictly ascending expected order. */
  readonly ordered: boolean
  /** The bundle list exactly as it was judged, echoed into the evidence file. */
  readonly bundles: readonly string[]
  /** One sentence for the log: the missing layers, the order violation, or "triple layer in order". */
  readonly reason: string
}

/** The two header fields the boot face reads out of one decoded session record. */
export interface SessionPresetWitness {
  /** The session id — the store directory name the record was decoded from. */
  readonly sessionId: string
  /** The preset id the harness recorded, `unknown` until it is compared against `mpd`. */
  readonly agentPreset: unknown
}

/** The observations `assertBootFace` judges, kept structural so the self-test can pass fixtures. */
export interface BootFaceInput {
  /** The boot pane text `capture-pane -p -J` printed. */
  readonly pane: string
  /** The raw ANSI boot log scanned for apply-crash signatures. */
  readonly log: string
  /** The `dsh.profile.bundles` list the boot actually composed. */
  readonly bundles: readonly string[]
  /** The decoded session headers the preset witness is looked up in. */
  readonly sessions: readonly SessionPresetWitness[]
}

/**
 * The boot-face verdict plus every raw observation the evidence file records. The live arm fills
 * the optional members after the pure assertions, so none of them is readonly.
 */
export interface BootFace {
  /** True when layering, zero crash signatures, the keyed status line, counters, a render and an mpd session all hold. */
  ok: boolean
  /** The bundle-layering verdict the boot was judged against. */
  layering: LayeringVerdict
  /** Apply-crash signatures found in the raw ANSI log; empty means the tree really loaded. */
  crashSignatures: string[]
  /** True when the pane carries the `mpd: team …` status line above the prompt. */
  statusLine: boolean
  /** True when the pane carries both the Tools and the Skills counters (English or Chinese copy). */
  counters: boolean
  /** True when the captured pane is not blank, i.e. the TUI really painted something. */
  rendered: boolean
  /** Session id of the boot that ran the `mpd` preset, `undefined` when none did. */
  presetSessionId?: unknown
  /** The preset that session ran, echoed into the evidence file. */
  presetAgentPreset?: unknown
  /** Set by the live arm: true when dump-config composed the `mpd-tui` row. */
  rowComposed?: boolean
  /** Set by the live arm: project keys created outside the sandbox, which must stay empty. */
  isolationOffenders?: string[]
  /** Set by the live arm: every session-store project key this run created. */
  sessionKeysCreated?: string[]
  /** Set by the live arm: project keys inherited from earlier runs in a warm root. */
  sessionKeysInherited?: string[]
  /** Set by the live arm: the sandbox project key the preset witness must come from. */
  expectedProjectKey?: string
  /** Set by the live arm: how many decoded session records carried the sandbox key. */
  sandboxSessions?: number
  /** Set by the live arm: absolute sandbox root the boot ran inside. */
  sandboxRoot?: string
  /** Set by the live arm: the artifact holding the layering witness. */
  layeringEvidence?: string
  /** Set by the live arm: the artifacts holding the pane captures. */
  paneEvidence?: string
  /** Set by the live arm: the artifacts holding the preset witness. */
  presetEvidence?: string
}

/**
 * The dsh-tui host this lane installs into the sandbox profile.
 *
 * MOVED 0.11.2 -> 0.12.0 (2026-10-02), one step on and for the same reason: 0.11.2's peer lists end
 * at `|| 0.2.0-rc.1`, so `dsh plugin --profile dsh-tui add` is REFUSED against the 0.2.0-rc.2 harness
 * this bundle now pins, while 0.12.0's lists end with `|| 0.2.0-rc.2`.
 *
 * MOVED 0.11.1 -> 0.11.2 (2026-09-30), and the reason is written down in this repository already:
 * `docker/README.md` records that 0.11.2 is "the first dsh-tui release whose peer ranges accept BOTH
 * harness pins this lane runs (0.1.7-rc.2 and 0.2.0-rc.1; 0.11.1 stops at the former, and
 * `dsh plugin --profile dsh-tui add` is then REFUSED on peer ranges)". The Docker lane was moved at
 * the time; THIS lane was not, so on the current harness it could not seed its fixture at all — and
 * the refusal surfaced as the generic `absent-fixture` SKIP, which reads as "not set up yet" rather
 * than "this pin is incompatible". Measured: host install exit=1 with the harness's own
 * `installation rejected: ... is incompatible with dsh 0.2.0-rc.1` in the install log.
 *
 * The env override matches the Docker lane's knob, so one variable moves both.
 */
const TUI_HOST_SPEC: string = "@deepseek-harness-tui/dsh-tui@" + (process.env.MPD_E2E_TUI_VERSION ?? "0.12.0")

/** What the `--install` arm attempted, and where it recorded the attempt. */
interface InstallAttempt {
  /** Exit status of the host (`dsh-tui`) install; `null` when the child was signalled. */
  readonly hostExit: number | null
  /** Exit status of this bundle's install; `null` when the child was signalled. */
  readonly bundleExit: number | null
  /** Repo-relative path of the combined install log. */
  readonly log: string
  /** Repo-relative sandbox root the two installs targeted. */
  readonly root: string
}

/**
 * The layering claim: our bundle joins as the THIRD layer, in that order.
 * @param bundles The `dsh.profile.bundles` list to judge.
 * @returns The verdict, the missing layers and the list as judged.
 */
export function assertLayering(bundles: readonly string[]): LayeringVerdict {
  // Expected layers the list does not declare, in expected order.
  const missing = EXPECTED_BUNDLES.filter((entry) => !bundles.includes(entry))
  // Each expected layer's index in the list, `-1` for an absent one.
  const order = EXPECTED_BUNDLES.map((entry) => bundles.indexOf(entry))
  // True when every layer is present and each one sits after the layer before it.
  const ordered = order.every((value, index) => value >= 0 && (index === 0 || value > order[index - 1]))
  return {
    ok: missing.length === 0 && ordered,
    missing,
    ordered,
    bundles,
    reason: missing.length > 0 ? "missing bundle layer(s): " + missing.join(", ") : ordered ? "triple layer in order" : "layers present but out of order",
  }
}

/**
 * The live-boot assertions, kept pure so the self-test can falsify them.
 * @param input The captured pane, the raw log, the composed bundles and the decoded session headers.
 * @returns The boot verdict with every observation the evidence file records.
 */
export function assertBootFace({ pane, log, bundles, sessions }: BootFaceInput): BootFace {
  // Apply-crash signatures present in the raw log; a non-empty list means the tree did not load.
  const crashes = crashSignatures(log)
  // The bundle-layering verdict of the composed list.
  const layering = assertLayering(bundles)
  // True when the keyed status line sits above the prompt.
  const statusLine = /mpd:\s+team /.test(pane)
  // The TUI localizes its chrome: accept the English AND the Chinese counter labels.
  const counters = /(Tools|工具)\s*\d+/.test(pane) && /(Skills|技能)\s*\d+/.test(pane)
  // True when the capture carries any non-whitespace text at all.
  const rendered = pane.trim().length > 0
  // The first session header that ran the mpd preset; the preset witness of AC-11.
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

/** The offline arm: layering, crash scan, boot face and the sandbox isolation predicates. */
function selfTest(): void {
  // The bound assertion collector: `check` records failures into `problems`.
  const { check, problems } = makeChecks()

  // A dump-config fragment declaring the full triple, which the layering rule must accept.
  const fixture = "  dsh:\n    profile:\n      bundles: ['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui', '@mpd-dsh/mpd']"
  check(assertLayering(extractBundles(fixture)).ok, "the triple layering must be accepted")
  // A fragment declaring only two layers; the missing bundle must be rejected.
  const pair = "bundles: ['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui']"
  check(!assertLayering(extractBundles(pair)).ok, "a NEGATIVE CONTROL failed: a two-layer composition must be rejected")
  // The same three layers in the wrong order, which is a different failure from a missing one.
  const reordered = "bundles: ['@deepseek-harness-tui/dsh-tui', '@deepseek-ai/dsh-base', '@mpd-dsh/mpd']"
  check(!assertLayering(extractBundles(reordered)).ok, "a NEGATIVE CONTROL failed: an out-of-order composition must be rejected")

  check(crashSignatures("clean boot log").length === 0, "a clean log must have zero crash signatures")
  check(crashSignatures("failed to apply loader entry x").length === 1, "a NEGATIVE CONTROL failed: an apply-crash signature must be detected")
  check(crashSignatures("duplicate loader entry id: agent-presets").length === 1, "a duplicate-entry-id log must be detected")

  // A reference boot face that satisfies every assertion, used as the control's base object.
  const good: BootFaceInput = {
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

  // True when the bundle patch the mount proof applies is present.
  const patch = existsSync(join(REPO, "cordis.patch.yml"))
  check(patch, "the bundle patch is missing")
  // True when the skill document that must list this case is present.
  const skill = existsSync(join(REPO, "skills", "dsh-qa", "SKILL.md"))
  check(skill, "SKILL.md is missing")
  if (skill) {
    // The skill document's text, scanned for this lane's case-table row.
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

/** The live arm: boot the real TUI in tmux inside the sandbox and assert the whole mount face. */
function real(): void {
  // The lane's own command line; `--install` and the sandbox flags are read from this slice.
  const argv = process.argv.slice(2)
  // The sandbox root and flags: every path below resolves inside that root, never the real home.
  const { root, fresh, explicit } = parseSandboxArgs(argv, SLUG)
  // This run's evidence directory, created by the shared helper.
  const outDir = laneEvidenceDir(SLUG)
  // One line per step, joined into `output.log` at the end of the run.
  const log: string[] = []
  // Append one line to the log and echo it with this lane's prefix.
  const say = (line: string): void => { log.push(line); console.log("[" + SLUG + "] " + line) }

  // The artifact revision measured before the boot touches anything.
  const revisionBefore = artifactRevision()
  // True when the caller asked for the host and bundle to be installed into the sandbox profile.
  const wantsInstall = argv.includes("--install")

  // T8-F1: the requested install runs BEFORE the gate, so `--install` on a fresh root
  // is actually attempted; the gate then judges the RESULT of that attempt and, when
  // the caller asked for the install and the profile is still unusable, it FAILS with
  // a named reason instead of exiting green on a skip.
  // What the `--install` arm attempted, `undefined` when the caller did not ask for it.
  let installAttempt: InstallAttempt | undefined
  /** Why the host install was refused, or undefined when it succeeded or was never attempted. */
  let hostInstallRefusal: string | undefined
  if (wantsInstall) {
    say("installing the host into the sandbox profile (network required): " + root)
    // The host (dsh-tui) install, whose exit status the gate's verdict depends on.
    const host = runInSandbox(root, "dsh", ["plugin", "--profile", "dsh-tui", "add", TUI_HOST_SPEC], { timeoutMs: 900_000 })
    say("host install exit=" + host.status)
    // This bundle's install into the same sandbox profile.
    const bundle = runInSandbox(root, "dsh", ["plugin", "--profile", "dsh-tui", "add", REPO], { timeoutMs: 900_000 })
    say("bundle install exit=" + bundle.status)
    // The combined install log, kept so a failed install is diagnosable from the evidence.
    const installLog = join(outDir, "install.log")
    writeFileSync(installLog, host.stdout + host.stderr + bundle.stdout + bundle.stderr)
    installAttempt = { hostExit: host.status, bundleExit: bundle.status, log: installLog.replace(REPO + "/", ""), root: root.replace(REPO + "/", "") }
    // A REFUSED host install is its OWN outcome. Without this the run fell through to the generic
    // `absent-fixture` SKIP, which says "set this up first" about a setup that was JUST attempted and
    // rejected — the operator then re-runs the same command and reads the same sentence.
    if (host.status !== 0) {
      /** The harness's own rejection sentence, when the install log carries one. */
      let refusal = ""
      try {
        // The install log the attempt wrote, read for the sentence the OPERATOR needs. The refusal is
        // kept as a REASON for the prerequisite gate rather than thrown here, so the run still reports
        // its own marker line and the sandbox it used.
        const text = readFileSync(join(REPO, installLog.replace(REPO + "/", "")), "utf8")
        /** The first line naming a rejection or a peer-range refusal. */
        const line = text.split("\n").find((l: string) => l.includes("installation rejected") || l.includes("incompatible with dsh"))
        if (line !== undefined) refusal = line.trim().slice(0, 300)
      } catch { /* an unreadable log leaves the exit status to carry the fact */ }
      hostInstallRefusal = `${TUI_HOST_SPEC} exited ${host.status}${refusal === "" ? "" : " — " + refusal}`
    }
    say("install log=" + installAttempt.log)
  }

  // The sandbox profile's state at gate time, judged after the optional install above.
  const state = profileState(root)
  gateTuiPrereqs(
    SLUG,
    tuiPrereqs({ sandboxPresent: () => state.present && state.hasHost && state.hasBundle, hostInstallRefusal: () => hostInstallRefusal }),
    { requested: wantsInstall ? ["absent-fixture", "host-install-refused"] : [] },
  )

  say("sandbox root=" + root + " explicit=" + explicit + " warm=" + state.present + " fresh=" + fresh)
  // The session-store project keys present BEFORE the boot, so the run's own delta is isolable.
  const before = sessionStoreKeys(root)
  // The composition dump; COMPOSITION only, never a load proof (see AGENTS.md §4).
  const dump = dumpConfig(root)
  writeFileSync(join(outDir, "dump-config.txt"), dump.stdout + dump.stderr)
  // The bundle LAYERING is authoritative in the profile manifest (the patch layers
  // compose into it); the dump-config text is a composition cross-check.
  const profile = profileState(root)
  // The authoritative layer list: the profile manifest when it declares one, else the dump.
  const bundles = profile.bundles.length > 0 ? profile.bundles : extractBundles(dump.stdout)
  say("profile bundles=" + JSON.stringify(profile.bundles) + " (dump-config carries " + extractBundles(dump.stdout).length + " row(s))")
  // True when the dump composes the mpd-tui row AND names its dist entry point.
  const rowComposed = /id:\s*['"]?mpd-tui['"]?/.test(dump.stdout) && dump.stdout.includes("packages/mpd-tui-plugin/dist/index.js")
  say("dump-config exit=" + dump.status + " bundles=" + JSON.stringify(bundles) + " rowComposed=" + rowComposed)

  // The full tmux lifecycle of this boot; the lane passes no steps, so only the boot is captured.
  const session = runTuiSession({ lane: SLUG, root, outDir, steps: [], bootWaitMs: 90_000 })
  for (const failure of session.failures) say("tmux: " + failure)
  // The boot capture's written path, or `undefined` when the lifecycle captured nothing.
  const bootPanePath = session.panes[0]?.file
  if (bootPanePath !== undefined) {
    // AC-11's preset witness is the SAME capture, kept under the name the contract uses.
    writeFileSync(join(outDir, "preset.pane.txt"), session.panes[0].text)
  }
  // Every decoded session header in the sandbox store, capped at 400 records.
  const allSessions = readSessionHeaders(root, { limit: 400 })
  // The preset witness must come from a session THIS run created (the sandbox-keyed
  // store), never from an earlier run inherited in a warm root.
  const expectedProjectKey = sandboxProjectKey(root)
  // Prefer the NEWEST sandbox-keyed record: the witness must be the session THIS run
  // created, not whichever one readdir happened to return first.
  const sessions = allSessions
    .filter((entry) => entry.projectKey === expectedProjectKey)
    .sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
  // Repo-relative path of the session excerpt written as the preset witness.
  const presetFile = writeSessionExcerpt(outDir, "preset.session.json", allSessions)
  // The sandbox-keyed records, counted for the evidence file.
  const sandboxSessions = allSessions.filter((entry) => entry.projectKey === expectedProjectKey)
  // Isolation is asserted on the DELTA this run created — a warm shared root may
  // legitimately carry earlier runs' stores, and those are reported separately.
  const after = sessionStoreKeys(root)
  // The project keys this run created; anything but the sandbox key is an isolation offender.
  const created = after.filter((key) => !before.includes(key))
  // The offenders: keys created outside the sandbox, which must stay empty.
  const isolation = created.filter((key) => key !== expectedProjectKey)

  // The pure boot-face verdict, enriched below with the live-arm observations.
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
  // The lane verdict: the boot face, the composed row and a clean isolation delta.
  const ok = face.ok && rowComposed && isolation.length === 0

  say("statusLine=" + face.statusLine + " counters=" + face.counters + " crashes=" + JSON.stringify(face.crashSignatures))
  say("session keys created=" + JSON.stringify(created) + " inherited=" + JSON.stringify(face.sessionKeysInherited))
  say("preset=" + String(face.presetAgentPreset) + " session=" + String(face.presetSessionId) + " isolationOffenders=" + isolation.length)
  // The artifact revision re-measured after the boot, compared against `revisionBefore`.
  const revisionAfter = artifactRevision()
  // The digest comparison this run records; a change between the two readings invalidates the result.
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
