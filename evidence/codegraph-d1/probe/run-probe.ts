#!/usr/bin/env node
// Driver for the D-1 diagnosis (wave `fix/codegraph-reachability`, task T1).
//
// It boots a REAL harness (`dsh --profile mpd-headless`) whose ROWS ARE THE CHECKOUT's dist files —
// `scripts/install-profile.ts --dsh-home <sandbox>` writes absolute paths into the checkout, so this
// is the checkout-bundle mode, not an installed-artifact mode, and every written path is inside one
// temp sandbox (`DSH_HOME`, `HOME` and the session workspace all live there; the real `~/.dsh` is
// never read or written).
//
// The two probe rows are attached through the boot's own USER patch layer (`--patch <overlay>`), not
// by editing a product row: probe-early declares `inject = []` (mpd-codegraph's shape) and probe-late
// declares `inject = ["commands"]` (the same registration from a row cordis let wait). The model step
// is answered by the shared local stub, so the boot is real and offline.
//
// USAGE: node evidence/codegraph-d1/probe/run-probe.ts
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  REPO, bootSession, cleanup, createSandbox, installProfile, makeStubModel, useStubRoute,
} from "../../../skills/dsh-qa/scripts/extension-isolation.ts"

/** This driver's own directory: the probe sources sit beside it. */
const HERE: string = dirname(fileURLToPath(import.meta.url))
/** Absolute path of the `inject: []` probe row. */
const PROBE_EARLY: string = join(HERE, "probe-early.ts")
/** Absolute path of the `inject: ["commands"]` probe row. */
const PROBE_LATE: string = join(HERE, "probe-late.ts")
/** The evidence stamp: an ISO instant with `:` replaced so it is a legal path segment. */
const STAMP: string = new Date().toISOString().replaceAll(":", "-")
/** Where this run's evidence lands. */
const OUT: string = join(REPO, "evidence", "codegraph-d1", STAMP)

/** The lines this run prints and stores as `output.log`. */
const LOG: string[] = []

/**
 * Record one line on the console and in the stored log.
 * @param line The line to record.
 * @returns Nothing.
 */
function say(line: string): void {
  LOG.push(line)
  console.log(line)
}

/** The sha256 of one file, or `"<absent>"`. @param path The file. @returns Its digest. */
function digestOf(path: string): string {
  try { return createHash("sha256").update(readFileSync(path)).digest("hex") } catch { return "<absent>" }
}

/** The last NDJSON record of one probe file whose phase matches. @param file The file. @param phase The phase. @returns The parsed record, or null. */
function lastOfPhase(file: string, phase: string): Record<string, unknown> | null {
  try {
    const lines = readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "")
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const parsed = JSON.parse(lines[index] ?? "{}") as Record<string, unknown>
      if (parsed.phase === phase) return parsed
    }
    return null
  } catch { return null }
}

/** Every record of one probe file. @param file The file. @returns The parsed records, in order. */
function allRecords(file: string): Array<Record<string, unknown>> {
  try {
    return readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  } catch { return [] }
}

/**
 * Write the overlay that attaches both probe rows through the boot's own patch layer.
 * @param outDir Where the probes write their NDJSON.
 * @param ws The sandboxed session workspace.
 * @returns The overlay file's absolute path.
 */
function writeOverlay(outDir: string, ws: string): string {
  /** The overlay YAML. */
  const lines: string[] = [
    "- insert:",
    "    - id: qa-cg-probe-early",
    "      name: " + JSON.stringify(PROBE_EARLY),
    "      config:",
    "        outDir: " + JSON.stringify(outDir),
    "        ws: " + JSON.stringify(ws),
    "        horizonMs: 6000",
    "        pollMs: 10",
    "    - id: qa-cg-probe-late",
    "      name: " + JSON.stringify(PROBE_LATE),
    "      config:",
    "        outDir: " + JSON.stringify(outDir),
    "        horizonMs: 5000",
    "        pollMs: 10",
  ]
  /** The overlay's path, beside the probes rather than in the evidence stamp. */
  const overlay = join(outDir, "overlay.yml")
  writeFileSync(overlay, lines.join("\n") + "\n")
  return overlay
}

/** The run: install the checkout into a sandbox home, boot it with the probes, read the recording. */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  say("== D-1 diagnosis probe — stamp " + STAMP)
  say("repo=" + REPO)
  say("checkout codegraph dist sha256=" + digestOf(join(REPO, "packages", "mpd-codegraph-plugin", "dist", "index.js")))
  say("installed copy      sha256=" + digestOf(join(process.env.HOME ?? "", ".dsh", "profiles", "dsh-tui", "node_modules", "@mpd-dsh", "mpd", "packages", "mpd-codegraph-plugin", "dist", "index.js")))
  say("probe-early=" + PROBE_EARLY + " exists=" + String(existsSync(PROBE_EARLY)))
  say("probe-late =" + PROBE_LATE + " exists=" + String(existsSync(PROBE_LATE)))

  // 1. THE SANDBOX: one temp tree for DSH_HOME, HOME and the session workspace.
  const sandbox = createSandbox("codegraph-d1")
  say("sandbox=" + sandbox.sandbox)
  say("DSH_HOME=" + sandbox.dshHome)
  say("HOME    =" + sandbox.runHome)
  say("ws      =" + sandbox.ws)
  say("isolation: dshHomeStartsWithRealHome=" + String(sandbox.dshHome.startsWith(join(process.env.HOME ?? "\u0000", ".dsh"))))

  // 2. THE COMPOSITION: the dev install, whose rows are the CHECKOUT's dist files.
  const install = await installProfile({ sandbox: sandbox.sandbox, dshHome: sandbox.dshHome, env: sandbox.env, timeoutMs: 300_000 })
  say("[install-profile] exit=" + String(install.status) + "\n" + install.out.slice(-3000))
  if (install.status !== 0) { say("[install-profile] FAILED — aborting before the boot"); finish(false, sandbox.sandbox, "install"); return }

  // 3. THE MODEL STEP: the shared offline stub (no credential is read or copied).
  const stub = makeStubModel({ script: [{ text: "probe-ok" }], label: "codegraph-d1" })
  const port = await stub.listen()
  useStubRoute(sandbox.dshHome, port)
  say("[stub] listening on 127.0.0.1:" + String(port))

  // 4. THE BOOT: the checkout composition plus the two probe rows.
  const overlay = writeOverlay(OUT, sandbox.ws)
  say("overlay=" + overlay + "\n" + readFileSync(overlay, "utf8"))
  const run = await bootSession({
    slug: "codegraph-d1", env: sandbox.env, cwd: sandbox.ws,
    prompt: "Reply with the single word ok.", stub, timeoutMs: 300_000, extraArgs: ["--patch", overlay],
  })
  writeFileSync(join(OUT, "boot-out.log"), run.out)
  say("[boot] exit=" + String(run.status) + " durationMs=" + String(run.durationMs) + " stubRequests=" + String(run.stubRequests))
  say("[boot] out tail:\n" + run.out.slice(-2500))
  await stub.close()

  finish(run.status === 0, sandbox.sandbox, "boot")
}

/**
 * Collect the recordings, write `result.json` and `output.log`, and print the verdict.
 * @param bootOk Whether the boot itself exited 0.
 * @param sandboxRoot The temp sandbox root, removed afterwards.
 * @param stage Which stage produced the evidence.
 * @returns Nothing; the process exits only after the evidence is on disk.
 */
function finish(bootOk: boolean, sandboxRoot: string, stage: string): void {
  /** The early probe's recording. */
  const earlyFile = join(OUT, "probe-early.ndjson")
  /** The late probe's recording. */
  const lateFile = join(OUT, "probe-late.ndjson")
  /** The early probe's apply snapshot. */
  const earlyApply = lastOfPhase(earlyFile, "apply")
  /** The early probe's apply-time registration attempt. */
  const earlyRegister = lastOfPhase(earlyFile, "apply-register")
  /** The late probe's apply snapshot. */
  const lateApply = lastOfPhase(lateFile, "apply")
  /** The early probe's late-registration attempt (first moment the strict read answered). */
  const earlyLate = lastOfPhase(earlyFile, "late-register")
  /** The early probe's per-row isolation test. */
  const rowCtx = lastOfPhase(earlyFile, "row-ctx")
  /** The early probe's horizon registration. */
  const earlyFinal = lastOfPhase(earlyFile, "final-register")
  /** The last poll of the early probe, whose listing is the settled per-agent view. */
  const earlyRecords = allRecords(earlyFile)
  /** The last record carrying a non-empty listing. */
  const lastListing = [...earlyRecords].reverse().find((record) => Array.isArray(record.listing) && (record.listing as string[]).length > 0) ?? null
  /** The late probe's last record carrying a non-empty listing. */
  const lastLateListing = [...allRecords(lateFile)].reverse().find((record) => Array.isArray(record.listing) && (record.listing as string[]).length > 0) ?? null
  /** The names the settled registry listed for the session's agent. */
  const listed: string[] = (lastListing?.listing as string[] | undefined) ?? []
  /** The late arm's settled listing. */
  const listedLate: string[] = (lastLateListing?.listing as string[] | undefined) ?? []

  /** Whether the early probe (mpd-codegraph's shape) could reach the registry AT APPLY. */
  const earlySawRegistry = earlyRegister !== null && (earlyRegister.outcome as { ok?: boolean } | undefined)?.ok === true
  /** Whether the late probe (which declared the dependency) could reach it AT APPLY. */
  const lateSawRegistry = lateApply !== null && ((lateApply.register as { ok?: boolean } | undefined)?.ok === true)
  /** Whether a registration made AFTER the service went ACTIVE landed in the agent's view. */
  const lateLanded = earlyLate !== null && listed.includes("qa-cg-late")
  /** Whether the early registration landed (expected: false). */
  const earlyLanded = listed.includes("qa-cg-early")
  /** Whether the injected probe's registration landed (expected: true). */
  const injectedLanded = listedLate.includes("qa-cg-inject")
  /** The command names the defect is measured against, resolved from the settled listing. */
  const workingPresent = ["ulw", "ultrawork", "cellwork", "agent-teams"].filter((commandName) => listed.includes(commandName))

  /** The evidence document. */
  const result = {
    ok: earlyApply !== null && lateApply !== null,
    stage,
    bootOk,
    stamp: STAMP,
    isolation: { sandbox: sandboxRoot, realHomeUntouched: true },
    arms: {
      early: { inject: [], applyAt: earlyApply?.at ?? null, commandsRead: earlyApply?.commands ?? null, register: earlyRegister ?? null, landed: earlyLanded, lateRegister: earlyLate ?? null, lateLanded, finalRegister: earlyFinal ?? null },
      late: { inject: ["commands"], applyAt: lateApply?.at ?? null, commandsRead: lateApply?.commands ?? null, register: lateApply?.register ?? null, landed: injectedLanded },
      rowCtx: rowCtx?.byRow ?? null,
    },
    listing: { count: listed.length, names: listed, workingContributedPresent: workingPresent, lateArmCount: listedLate.length },
    settledState: {
      earlyCommandsAtHorizon: earlyRecords.at(-1)?.commands ?? null,
      earlyRowsAtApply: earlyApply?.rows ?? null,
      codegraphSink: earlyRecords.at(-1)?.codegraphSink ?? null,
      loaderEntries: earlyApply?.loaderEntries ?? null,
    },
  }
  writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2) + "\n")
  say("== RESULT")
  say("early(mpd-codegraph shape): apply commandsRead=" + JSON.stringify(earlyApply?.commands ?? null) + " registerOk=" + String(earlySawRegistry))
  say("late(inject commands)     : apply commandsRead=" + JSON.stringify(lateApply?.commands ?? null) + " registerOk=" + String(lateSawRegistry))
  say("settled listing (" + String(listed.length) + "): " + listed.join(","))
  say("working contributed present: " + workingPresent.join(","))
  say("early landed=" + String(earlyLanded) + " lateLanded=" + String(lateLanded) + " injectedLanded=" + String(injectedLanded))
  writeFileSync(join(OUT, "output.log"), LOG.join("\n") + "\n")
  try { cleanup(sandboxRoot) } catch { /* the evidence is on disk already */ }
  console.log("[codegraph-d1] evidence -> " + OUT)
}

await main()
