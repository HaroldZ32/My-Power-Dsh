#!/usr/bin/env node
// Case cellwork-mount (Wave 3 / C4): reproduce the 2026-10-26 overlay recipe and prove, on a REAL
// boot, that the `mpd-cellwork` row's own module APPLIES and registers.
//
// WHY THE OVERLAY IS USED ON THIS MACHINE — read this before changing the case:
//   This machine's BUNDLE resolution picks a STALE `@mpd-dsh/mpd` (0.15.5, no cellwork row) from the
//   global install / the `dsh-tui` profile / `dist/mpd-package`, so a plain link-profile boot composes
//   the full row set and NO cellwork row at all. The frozen mount proof of 2026-10-26T09:39:31Z was
//   therefore produced with a `--patch` overlay row carrying an ABSOLUTE module path, and this case
//   reproduces exactly that shape: an offline profile (checkout-absolute rows), the `mpd-cellwork` row
//   REMOVED from the composed home patch, and the row supplied ONLY by the overlay. Removing it is what
//   makes the arms mean something: with the installed row present, the mount line would appear even
//   when the overlay was broken, and the negatives below could not discriminate.
//   THE OVERLAY PROVES THE ROW MODULE APPLIES, NOT THAT THE BUNDLE ROW IS THE SOURCE. The bundle wiring
//   rests on `verify:rows` / `verify:manifest` (both green), and this case says so in its evidence.
//
// THE ARMS:
//   A. POSITIVE — overlay row at the ABSOLUTE `packages/mpd-cellwork-plugin/dist/index.js` → the row's
//      own mount line (`[mpd-cellwork] mounted: guard=… depthMax=… …`) is observed in the row's LOG SINK
//      `<ws>/.mpd/logs/mpd-cellwork.log` (the R5 rule: a row never prints), and NO loader failure and NO
//      apply-crash signature appears in the boot output;
//   B. COMPOSITION — `dsh --profile … --patch <same overlay> --dump-config` lists the row at that absolute
//      path. COMPOSITION ONLY: it never runs plugin code (AGENTS.md §4), so it is reported as such;
//   C. NEGATIVE CONTROL (real boot) — an overlay naming a MISSING module must NOT produce the mount line
//      and must produce a loader failure (or a non-zero exit). Without this arm the detector could be
//      passing on the environment rather than on the row.
// A row that is ABSENT from the composition fails arm A (`fails when the row is absent`), and a boot that
// cannot run at all is a FAILURE of this case, never a quiet SKIP.
// PREREQ: absent-dsh-binary dsh install @deepseek-ai/dsh so the real harness binary is on PATH
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  REPO, binaryPresent, bootSession, cleanup, createSandbox, installProfile, isolationStep,
  makeStubModel, runAsync, timestamp, useStubRoute, writeEvidence,
} from "./extension-isolation.ts"
import { sandboxWorkspace } from "./lib/workspace-isolation.ts"

/** The case slug, used in the sandbox prefix, the evidence directory and every log line. */
const SLUG = "cellwork-mount"
/** The row id the overlay inserts and the home patch must NOT also carry. */
const ROW_ID = "mpd-cellwork"
/** The row's built module — the ABSOLUTE path both the overlay and the dump assertion name. */
const ROW_MODULE = join(REPO, "packages", "mpd-cellwork-plugin", "dist", "index.js")
/** The profile the offline installer writes (`<DSH_HOME>/cordis.patch.yml` composes its rows). */
const PROFILE = "mpd-headless"
/** The prompt the booted session starts from; the stub answers it. */
const PROMPT = "Reply with exactly: cellwork-mount-qa"
/** The mount line's head: written at the END of the row's apply, after every registration. */
const MOUNT_HEAD = "[mpd-cellwork] mounted: "
/** Strings a boot prints when a patch row cannot be resolved or applied (a FAILURE for arm A). */
const LOADER_FAILURE_SIGNATURES: readonly string[] = [
  "failed to apply loader entry",
  "failed to load",
  "plugin tree failed to load",
  "cannot resolve",
  "Cannot find module",
  "ERR_MODULE_NOT_FOUND",
]
/** Apply-crash signatures that must never appear (the QA house list, extended with the loader ones). */
const CRASH_SIGNATURES: readonly string[] = [
  "unsupported JSON schema",
  "JsonSchemaError",
  ...LOADER_FAILURE_SIGNATURES,
]

/** A one-line problem list, empty when every expectation held. */
type Problems = string[]

/**
 * Remove ONE row block (`<indent>- id: <rowId>` plus its deeper-indented lines) from a patch document.
 *
 * The QA sandbox surgery that makes arm A meaningful: the offline installer writes every row into
 * `<DSH_HOME>/cordis.patch.yml`, so the cellwork row would mount even with a broken overlay.
 * @param text The patch document.
 * @param rowId The row id to remove.
 * @returns The document without that block, and how many blocks were removed (0 or 1 expected).
 */
export function removeRowBlock(text: string, rowId: string): { text: string; removed: number } {
  /** The document's lines. */
  const lines = text.split("\n")
  /** The kept lines. */
  const kept: string[] = []
  /** How many blocks were dropped. */
  let removed = 0
  /** The indentation of the block being dropped, or -1 when no block is open. */
  let dropIndent = -1
  /** The row-id pattern at any indentation. */
  const pattern = new RegExp("^(\\s*)- id: " + rowId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$")
  for (const line of lines) {
    /** The leading whitespace, which is how a block's extent is measured. */
    const indent = line.length - line.trimStart().length
    if (dropIndent >= 0) {
      // Inside the block: a blank line or a deeper-indented line still belongs to it.
      if (line.trim() === "" || indent > dropIndent) continue
      dropIndent = -1
    }
    /** The match, when this line opens the row's block. */
    const match = pattern.exec(line)
    if (match !== null) {
      removed += 1
      dropIndent = match[1].length
      continue
    }
    kept.push(line)
  }
  return { text: kept.join("\n"), removed }
}

/**
 * The overlay that inserts ONE row at an absolute module path.
 * @param modulePath The absolute module path the row must resolve.
 * @param configLines The row's config block lines, already indented; `[]` for a bare row.
 * @returns The overlay YAML.
 */
export function rowOverlay(modulePath: string, configLines: readonly string[] = []): string {
  return [
    "- insert:",
    "    - id: " + ROW_ID,
    "      name: " + JSON.stringify(modulePath),
    ...(configLines.length === 0 ? [] : ["      config:", ...configLines]),
    "",
  ].join("\n")
}

/**
 * Arm A's verdict: the row's own mount line, and no loader/apply failure anywhere in the boot.
 * @param sinkLog The row's own log-sink text, or `""` when the file does not exist.
 * @param bootLog The booted process's combined output.
 * @returns The verdict, the observed line, the carrier and every problem.
 */
export function evaluateMount(sinkLog: string, bootLog: string): { ok: boolean; mountLine: string; carrier: string; problems: Problems } {
  /** One problem per failed expectation. */
  const problems: Problems = []
  /** The mount line, from whichever carrier received it (the sink is the expected one). */
  const fromSink = sinkLog.split("\n").find((line) => line.includes(MOUNT_HEAD)) ?? ""
  /** The same line scraped from the boot output, for a composition whose sink fell back to a ring. */
  const fromBoot = bootLog.split("\n").find((line) => line.includes(MOUNT_HEAD)) ?? ""
  if (fromSink === "" && fromBoot === "") problems.push("the row's mount line " + JSON.stringify(MOUNT_HEAD) + " was not observed in the log sink or the boot output — the row is ABSENT from this composition")
  /** The line the verdict quotes. */
  const mountLine = fromSink !== "" ? fromSink : fromBoot
  /** Which carrier carried it. */
  const carrier = fromSink !== "" ? "sink" : fromBoot !== "" ? "boot-output" : "none"
  // The line must carry the resolved knobs, which is what distinguishes "apply() ran" from "a stale line".
  for (const field of ["guard=", "depthMax=", "checkpointRatio=", "windowFraction="]) {
    if (mountLine !== "" && !mountLine.includes(field)) problems.push("the mount line does not carry " + JSON.stringify(field))
  }
  /** The loader/apply signatures the boot output carries. */
  const present = CRASH_SIGNATURES.filter((signature) => bootLog.includes(signature))
  for (const signature of present) problems.push("the boot output carries a loader/apply failure signature: " + JSON.stringify(signature))
  return { ok: problems.length === 0, mountLine, carrier, problems }
}

/**
 * Arm C's verdict: the missing module produced NO mount line, and a failure was observable.
 * @param sinkLog The row's own log-sink text (or `""`).
 * @param bootLog The booted process's combined output.
 * @param exitStatus The boot's exit status.
 * @returns The verdict, the signatures found and every problem.
 */
export function evaluateNegative(sinkLog: string, bootLog: string, exitStatus: number | null): { ok: boolean; signatures: string[]; problems: Problems } {
  /** One problem per failed expectation. */
  const problems: Problems = []
  if (sinkLog.includes(MOUNT_HEAD) || bootLog.includes(MOUNT_HEAD)) problems.push("the MISSING-module overlay still produced the row's mount line — the row was mounted from somewhere else, so arm A proves nothing")
  /** The failure signatures the boot output carries. */
  const signatures = LOADER_FAILURE_SIGNATURES.filter((signature) => bootLog.includes(signature))
  if (signatures.length === 0 && exitStatus === 0) problems.push("a MISSING module neither produced a loader-failure signature nor failed the boot (exit 0, no signature) — the negative control is inert")
  return { ok: problems.length === 0, signatures, problems }
}

/**
 * The composition verdict: `--dump-config` lists the row at the overlay's absolute path.
 * @param dump The composed configuration text.
 * @param modulePath The absolute module path the overlay named.
 * @returns The verdict and its problems.
 */
export function evaluateComposition(dump: string, modulePath: string): { ok: boolean; problems: Problems } {
  /** One problem per failed expectation. */
  const problems: Problems = []
  if (!dump.includes("id: " + ROW_ID)) problems.push("the composed configuration does not name the row id " + JSON.stringify(ROW_ID))
  if (!dump.includes(modulePath)) problems.push("the composed configuration does not name the overlay's absolute module path " + JSON.stringify(modulePath))
  return { ok: problems.length === 0, problems }
}

/**
 * The offline self-test: every detector is exercised with a POSITIVE and a NEGATIVE fixture, and the
 * two sandbox edits (row removal, overlay) are pinned by shape.
 * @returns Nothing; exits 1 when any arm fails.
 */
function selfTest(): void {
  /** One problem per failed arm. */
  const problems: Problems = []
  /** Assert one condition with a label. */
  const check = (label: string, condition: boolean): void => { if (!condition) problems.push(label) }
  /** One real mount line, with the knobs the plugin writes. */
  const mount = "[2026-10-26T09:39:31.685Z] [mpd-cellwork] mounted: guard=on depthMax=3 checkpointRatio=0.5 windowFraction=0.25 windowOverride=none"
  // 1. Arm A's detector: the line in the sink, in the boot output, then three negatives.
  check("mount via sink", evaluateMount(mount + "\n", "").ok)
  check("mount via boot output", evaluateMount("", mount + "\n").ok)
  check("mount absent", !evaluateMount("", "some other line\n").ok)
  check("mount without knobs", !evaluateMount("[mpd-cellwork] mounted: ok\n", "").ok)
  check("mount with a loader failure", !evaluateMount(mount + "\n", "failed to load a row\n").ok)
  // 2. Arm C's detector: a missing module must show a failure and never the mount line.
  check("negative with signature", evaluateNegative("", "Cannot find module '/nope/index.js'\n", 1).ok)
  check("negative with exit only", evaluateNegative("", "", 1).ok)
  check("negative inert", !evaluateNegative("", "all good\n", 0).ok)
  check("negative mounted anyway", !evaluateNegative(mount + "\n", "Cannot find module\n", 1).ok)
  // 3. Arm B's composition detector.
  check("composition positive", evaluateComposition("- id: mpd-cellwork\n  name: " + JSON.stringify(ROW_MODULE) + "\n", ROW_MODULE).ok)
  check("composition wrong path", !evaluateComposition("- id: mpd-cellwork\n  name: \"/stale/index.js\"\n", ROW_MODULE).ok)
  check("composition absent", !evaluateComposition("- id: other\n", ROW_MODULE).ok)
  // 4. The row-removal surgery: the target block goes, its siblings and their config stay.
  /** A two-row patch fixture with a config block on each side of the target. */
  const fixture = ["- insert:", "  - id: before", "    name: \"/a.js\"", "    config:", "      keep: 1", "  - id: " + ROW_ID, "    name: \"/b.js\"", "    config:", "      drop: 2", "  - id: after", "    name: \"/c.js\"", ""].join("\n")
  /** The fixture with the target row removed. */
  const stripped = removeRowBlock(fixture, ROW_ID)
  check("removal count", stripped.removed === 1)
  check("removal keeps the siblings", stripped.text.includes("id: before") && stripped.text.includes("id: after"))
  check("removal keeps a sibling's config", stripped.text.includes("keep: 1"))
  check("removal drops the target and its config", !stripped.text.includes("id: " + ROW_ID) && !stripped.text.includes("drop: 2"))
  check("removal of an absent row is a no-op", removeRowBlock(fixture, "not-there").removed === 0)
  // 5. The overlay shape: exact row id, absolute path, no config by default.
  /** The overlay arm A writes. */
  const overlay = rowOverlay(ROW_MODULE)
  check("overlay id", overlay.includes("- id: " + ROW_ID))
  check("overlay absolute path", overlay.includes(JSON.stringify(ROW_MODULE)) && ROW_MODULE.startsWith("/"))
  check("overlay has no config block by default", !overlay.includes("config:"))
  check("overlay config when asked", rowOverlay("/m.js", ["        maxBytes: 1"]).includes("maxBytes: 1"))
  if (problems.length > 0) {
    for (const problem of problems) console.log("[cellwork-mount] SELF-TEST FAIL: " + problem)
    process.exit(1)
  }
  console.log("[cellwork-mount] self-test PASS — 21 arms incl. negative controls")
}

/**
 * The real run: sandbox, offline profile with the row REMOVED, three arms (mount, composition, negative).
 * @returns Nothing; sets the process exit code.
 */
async function main(): Promise<void> {
  // A MISSING PREREQUISITE IS A FAILURE HERE: never a quiet SKIP.
  if (!binaryPresent("dsh")) {
    console.log("[mpd-qa] FAIL case=" + SLUG + " lane=real reason=absent-dsh-binary prereq=dsh remedy=\"install @deepseek-ai/dsh so the real harness binary is on PATH\"")
    process.exit(1)
  }
  if (!existsSync(ROW_MODULE)) {
    console.log("[mpd-qa] FAIL case=" + SLUG + " lane=real reason=absent-row-module prereq=" + ROW_MODULE + " remedy=\"rebuild the package with the pinned toolchain (dist is never hand-edited)\"")
    process.exit(1)
  }
  /** The evidence directory stamp. */
  const stamp = timestamp()
  /** The evidence directory this run writes into. */
  const outDir = process.env.MPD_QA_EVIDENCE_DIR
    ? join(process.env.MPD_QA_EVIDENCE_DIR, SLUG + "-" + stamp)
    : join(REPO, "evidence", "cellwork", "qa", stamp + "-mount")
  mkdirSync(outDir, { recursive: true })
  /** The transcript lines the evidence log carries. */
  const log: string[] = []
  /** Append one transcript block. */
  const push = (text: string): void => { log.push(text) }
  /** The three sandbox paths and the child environment. */
  const sandbox = createSandbox(SLUG)
  /** The steps document the evidence carries. */
  const steps: Record<string, unknown> = {}
  /** The model stub, kept so its listener can be closed. */
  let stubToClose: { close: () => Promise<void> } | null = null
  try {
    push("# cellwork-mount — Wave 3 / C4 real run\nsandbox=" + sandbox.sandbox + "\nDSH_HOME=" + sandbox.dshHome + "\nHOME=" + sandbox.runHome + "\nws=" + sandbox.ws + "\nrow=" + ROW_MODULE)
    // 1. The offline profile (checkout-absolute rows, no registry, no pnpm).
    /** The install's outcome. */
    const install = await installProfile({ sandbox: sandbox.sandbox, dshHome: sandbox.dshHome, env: sandbox.env })
    push("[install] exit=" + String(install.status) + "\n" + install.out.slice(0, 4000))
    steps.install = { ok: install.status === 0, exit: install.status }
    if (install.status !== 0) throw new Error("the offline profile install exited " + String(install.status))
    // 2. THE SURGERY: remove the installed cellwork row, so ONLY the overlay can mount it.
    /** The composed home patch. */
    const homePatch = join(sandbox.dshHome, "cordis.patch.yml")
    /** The patch text before the surgery. */
    const before = readFileSync(homePatch, "utf8")
    /** The patch text after removing the row. */
    const stripped = removeRowBlock(before, ROW_ID)
    writeFileSync(homePatch, stripped.text)
    push("[surgery] removed " + String(stripped.removed) + " `" + ROW_ID + "` row block(s) from " + homePatch + " (the overlay is the ONLY source of the row)")
    steps.rowRemoved = { ok: stripped.removed === 1, removed: stripped.removed }
    if (stripped.removed !== 1) throw new Error("expected exactly ONE installed `" + ROW_ID + "` row to remove, found " + String(stripped.removed) + " — the installer's composition changed, and an inert negative control would follow")
    // 3. The model stub: no credential is read; the boot only has to APPLY the row, not do work.
    /** The local stub that answers every model step. */
    const stub = makeStubModel({ label: SLUG, script: [{ text: "QA-STUB-CELLWORK-MOUNT-OK" }] })
    stubToClose = stub
    /** The stub's loopback port, written into the sandbox's route patch. */
    const port = await stub.listen()
    useStubRoute(sandbox.dshHome, port)
    // 4. ARM A: the row at the absolute module path, through the overlay.
    /** Arm A's overlay file. */
    const overlayFile = join(outDir, "mount-overlay.yml")
    writeFileSync(overlayFile, rowOverlay(ROW_MODULE))
    push("[overlay] " + overlayFile + "\n" + readFileSync(overlayFile, "utf8"))
    /** Arm A's boot. */
    const boot = await bootSession({ slug: SLUG + "-mount", env: sandbox.env, cwd: sandbox.ws, prompt: PROMPT, stub, extraArgs: ["--patch", overlayFile] })
    push("[arm A] $ dsh --profile " + PROFILE + " --patch <overlay> " + JSON.stringify(PROMPT) + "\n[[exit=" + boot.status + "]]\n" + boot.out.slice(0, 8000))
    // The row's own log sink (R5: a row never prints). Copied into the evidence so the claim is auditable.
    /** The row's log file under the sandbox workspace. */
    const sinkFile = join(sandbox.ws, ".mpd", "logs", ROW_ID + ".log")
    if (existsSync(sinkFile)) copyFileSync(sinkFile, join(outDir, "row-log-sink.log"))
    /** The sink's text, or "" when the file does not exist. */
    const sinkLog = existsSync(sinkFile) ? readFileSync(sinkFile, "utf8") : ""
    /** Arm A's verdict. */
    const mounted = evaluateMount(sinkLog, boot.out)
    steps.mount = { ok: mounted.ok, carrier: mounted.carrier, mountLine: mounted.mountLine, problems: mounted.problems, bootExit: boot.status, sinkFile }
    // 5. ARM B: the same overlay through `--dump-config` — COMPOSITION ONLY (it never runs plugin code).
    /** The dump command's outcome. */
    const dump = await runAsync("dsh", ["--profile", PROFILE, "--patch", overlayFile, "--dump-config"], { env: sandbox.env, cwd: sandbox.ws, timeoutMs: 120000 })
    /** The composed row's own lines, for the evidence. */
    const composed = dump.out.split("\n").filter((line) => line.includes(ROW_ID) || line.includes(ROW_MODULE)).join("\n")
    writeFileSync(join(outDir, "dump-config-composed-row.txt"), composed + "\n")
    push("[arm B] $ dsh --profile " + PROFILE + " --patch <overlay> --dump-config\n[[exit=" + dump.status + "]]\n" + composed.slice(0, 4000))
    /** Arm B's verdict. */
    const composition = evaluateComposition(dump.out, ROW_MODULE)
    steps.composition = { ok: composition.ok, exit: dump.status, problems: composition.problems, note: "COMPOSITION ONLY: --dump-config composes rows and never executes plugin code" }
    // 6. ARM C: the NEGATIVE CONTROL — an overlay naming a module that does not exist.
    /** A module path that cannot resolve. */
    const missingModule = join(sandbox.sandbox, "no-such-row-module", "index.js")
    /** Arm C's overlay file. */
    const negativeOverlay = join(outDir, "negative-overlay.yml")
    writeFileSync(negativeOverlay, rowOverlay(missingModule))
    /** Arm C's workspace: its own, so its log sink cannot be arm A's. */
    const negativeWorkspace = sandboxWorkspace(sandbox.sandbox, "ws-negative")
    /** Arm C's boot. */
    const negativeBoot = await bootSession({ slug: SLUG + "-negative", env: sandbox.env, cwd: negativeWorkspace, prompt: PROMPT, stub, extraArgs: ["--patch", negativeOverlay] })
    push("[arm C] $ dsh --profile " + PROFILE + " --patch <negative-overlay> " + JSON.stringify(PROMPT) + "\n[[exit=" + negativeBoot.status + "]]\n" + negativeBoot.out.slice(0, 8000))
    /** The negative workspace's sink file. */
    const negativeSink = join(negativeWorkspace, ".mpd", "logs", ROW_ID + ".log")
    /** Its text, or "". */
    const negativeSinkText = existsSync(negativeSink) ? readFileSync(negativeSink, "utf8") : ""
    /** Arm C's verdict. */
    const negative = evaluateNegative(negativeSinkText, negativeBoot.out, negativeBoot.status)
    steps.negativeControl = { ok: negative.ok, exit: negativeBoot.status, signatures: negative.signatures, problems: negative.problems }
    /** The workspace isolation assertion. */
    const isolation = isolationStep(sandbox.dshHome, sandbox.sandbox, SLUG)
    steps.isolation = isolation
    /** Every problem the run found, in arm order. */
    const problems: Problems = [
      ...mounted.problems, ...composition.problems, ...negative.problems,
      ...(isolation.ok ? [] : ["workspace isolation violated: " + String(isolation.error ?? "")]),
      ...(boot.status === 0 ? [] : ["arm A's boot exited " + String(boot.status)]),
    ]
    push("[verdict] problems=" + String(problems.length) + (problems.length === 0 ? "" : "\n- " + problems.join("\n- ")))
    /** The case verdict, which also sets the exit code. */
    const ok = writeEvidence(outDir, SLUG, {
      ok: problems.length === 0,
      subject: "the mpd-cellwork row MODULE applies and registers under a real offline dsh boot, supplied by the 2026-10-26 overlay recipe",
      case: SLUG, wave: "cellwork-w3",
      command: "dsh --profile " + PROFILE + " --patch <mount-overlay> " + JSON.stringify(PROMPT),
      row: { id: ROW_ID, module: ROW_MODULE, suppliedBy: "the --patch overlay; the installed row was REMOVED from the composed home patch first" },
      sandbox: { root: sandbox.sandbox, dshHome: sandbox.dshHome, home: sandbox.runHome, ws: sandbox.ws },
      steps, problems,
      proves: [
        "The row's own apply() ran to completion under a REAL boot in an isolated DSH_HOME/HOME/workspace (never --dump-config): the log sink carries `[mpd-cellwork] mounted: guard=… depthMax=… checkpointRatio=… windowFraction=…`, which is written after the guard install, the tool registrations and the command registration.",
        "No loader failure and no apply-crash signature appears in that boot's output.",
        "The same overlay composes the row at the absolute module path (`--dump-config` excerpt on disk; COMPOSITION ONLY).",
        "The negative control really discriminates: an overlay naming a MISSING module produced no mount line and a loader failure (or a failing boot).",
      ],
      doesNotProve: [
        "That the BUNDLE's own `cordis.patch.yml` row is the source of the mount. On this machine the bundle resolution is stale (0.15.5, no cellwork row), which is WHY the overlay is used. The bundle wiring rests on `verify:rows` (37 ids incl mpd-cellwork) and `verify:manifest` (row module paths resolve).",
        "The `dsh plugin add` install/uninstall path for this row (needs a registry): `bundle-lifecycle` dies at its install step on this network.",
        "A session-level tool list (a `request/header` tools[] witness). This boot proves apply and the mount line; the unit suite proves the registrations, and the command case proves one whole surface end to end.",
      ],
    }, log.join("\n\n"))
    process.exitCode = ok ? 0 : 1
  } catch (error) {
    /** The failure's message, which is what the evidence records. */
    const message = error instanceof Error ? error.message : String(error)
    push("[failure] " + message)
    writeEvidence(outDir, SLUG, { ok: false, case: SLUG, wave: "cellwork-w3", problems: [message], steps }, log.join("\n\n"))
    process.exitCode = 1
  } finally {
    if (stubToClose !== null) await stubToClose.close()
    cleanup(sandbox.sandbox)
  }
}

/** Whether this module is the process ENTRY, so importing its predicates never runs the case. */
const isEntry = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest()
  else void main()
}
