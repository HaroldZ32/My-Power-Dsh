#!/usr/bin/env node
// Lane F evidence driver — deliverable (c): a SANDBOX BOOT whose stdout/stderr are captured to FILES.
//
// What it does, in the order the evidence needs:
//   1. builds a sandbox root under `<repo>/.qa-terminal-silence/` (the declared `/.qa-*` scratch shape,
//      T-77): a `DSH_HOME`, a sandbox `HOME` and a sandbox WORKSPACE cwd (the
//      `skills/dsh-qa/scripts/lib/workspace-isolation` pattern — DSH_HOME/HOME do NOT isolate
//      workspace state, so the boot's cwd is the sandbox workspace and the case asserts no
//      `<DSH_HOME>/sessions/<projectKey(realCwd)>` key exists);
//   2. rewrites the TWO declared bundle patches to checkout-absolute operands with the SAME
//      `devFlavor()` rewrite `skills/dsh-qa/scripts/preset-register.ts` uses, so the boot really
//      mounts the bundle's rows — including all four MCP rows, whose children are the vector R5 is
//      about;
//   3. boots `dsh --profile headless --patch <main> --patch <preset> ok` with stdout and stderr
//      captured to SEPARATE FILES, plus `MPD_MCP_LOG_DIR` pinned so the sink's root is inside the
//      sandbox and its output can be copied into the evidence;
//   4. reports which bytes in those two files are MPD-authored, and copies the MCP children's logs.
//
// It is a THROWAWAY evidence generator, not a shipped QA case: it writes into its own evidence dir and
// never touches the real `~/.dsh`.
import { spawnSync } from "node:child_process"
import { copyFileSync, cpSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed, sandboxWorkspace } from "../../../../skills/dsh-qa/scripts/lib/workspace-isolation.ts"
import { credentialEnv, seedSandboxCredentials, type Env } from "../../../../skills/dsh-qa/scripts/lib/credentials.ts"
import { dshCommand } from "../../../../skills/dsh-qa/scripts/lib/dsh-launcher.ts"

/** The evidence directory this driver writes into: `argv[2]`, or its own directory when omitted. */
const outDir = process.argv[2] === undefined ? dirname(fileURLToPath(import.meta.url)) : resolve(process.argv[2])
/** The repository root, derived from the evidence directory's depth. */
const repoRoot = resolve(outDir, "..", "..", "..", "..")
/** The sandbox root: the declared `/.qa-*` scratch shape, which `.gitignore` covers by SHAPE (T-77). */
const sandbox = join(repoRoot, ".qa-terminal-silence")
/** The packed-operand prefix every committed bundle patch carries; `devFlavor` removes it whole. */
const BASEURL_PREFIX = '(typeof baseUrl === "string" ? decodeURIComponent(baseUrl.replace(/^file:\\/\\/\\/(?=[A-Za-z]:)/, "").replace(/^file:\\/\\//, "")).replace(/\\/+$/, "") : "") + '

/** The bundle patch files, from the ONE declaration the loader itself reads (string OR array). */
function declaredBundlePatches(): string[] {
  /** The manifest's `dsh.bundle.patch` value, still untrusted and normalised on the next line. */
  const raw: unknown = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))?.dsh?.bundle?.patch
  /** Both declaration shapes the manifest schema allows. */
  const list: readonly unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  return list.filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => resolve(repoRoot, value))
}

/** One patch file's text, rewritten for a checkout boot (byte-for-byte the QA case's own rewrite). */
function devFlavor(text: string): string {
  return text
    .split(BASEURL_PREFIX).join("")
    .split('"/node_modules/@mpd-dsh/mpd/').join('"' + repoRoot + "/")
    .split("name: '@mpd-dsh/mpd'").join("name: '" + join(repoRoot, "packages/mpd-bundle-plugin/dist/index.js") + "'")
    .split("@mpd-dsh/mpd/").join(repoRoot + "/")
}

/**
 * The markers of bytes an MCP CHILD authored — the vector R5 owns, and the claim this arm verifies.
 *
 * `[CodeGraph MCP]` is MEASURED to come from
 * `@colbymchenry/codegraph-linux-x64/lib/dist/mcp/engine.js` (the engine process the adopted
 * `dist/serve.js` bridge spawns), NOT from serve.js itself — which is exactly why it can appear on the
 * captured stderr even though the launcher replaced its own writers.
 */
const MCP_CHILD_MARKERS: readonly string[] = ["[CodeGraph MCP]", "CodeGraph MCP skipped:", "[lsp-daemon]", "[mpd-mcp-", "Usage: mpd-", "BINARY_NOT_FOUND"]

/**
 * The markers of bytes an IN-PROCESS plugin row authored: the rows mount inside the dsh process, so no
 * sink can take their writers away without silencing the host. These are the frozen sweep inventory.
 */
const ROW_MARKERS: readonly string[] = ["[mpd-", "[mpd]", "[roles-probe]"]

/** Every line of a captured file matching one of `markers`, with its 1-based line number. */
function markedLines(file: string, markers: readonly string[]): Array<{ line: number; text: string }> {
  if (!existsSync(file)) return []
  /** The captured file's lines, read back after the child closed its fd. */
  const lines = readFileSync(file, "utf8").split("\n")
  /** The matching lines found. */
  const hits: Array<{ line: number; text: string }> = []
  for (let index = 0; index < lines.length; index += 1) {
    /** The line under inspection, right-trimmed so trailing whitespace is not a discriminator. */
    const text = (lines[index] ?? "").trimEnd()
    if (text === "") continue
    if (markers.some((marker) => text.includes(marker))) hits.push({ line: index + 1, text })
  }
  return hits
}

/** Stamp the current UTC instant, second precision, for every recorded measurement. */
function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
}

/** Run the whole boot arm and write every artifact under `outDir`. */
function main(): void {
  /** The result the driver prints as JSON and files beside the captures. */
  const result: Record<string, unknown> = { at: utcNow(), steps: [] as unknown[] }
  const steps = result.steps as unknown[]
  /**
   * Record one step's name, verdict and detail.
   * @param name the step's name.
   * @param ok whether the step held.
   * @param detail the measured detail.
   */
  const step = (name: string, ok: boolean, detail: unknown): void => { steps.push({ name, ok, detail }) }

  mkdirSync(sandbox, { recursive: true })
  const dshHome = join(sandbox, "dsh-home")
  const userHome = join(sandbox, "home")
  const mcpLogs = join(sandbox, "mcp-logs")
  mkdirSync(dshHome, { recursive: true })
  mkdirSync(userHome, { recursive: true })
  mkdirSync(mcpLogs, { recursive: true })
  /** The sandbox workspace cwd every child of the boot runs in (workspace isolation, §7). */
  const workspace = sandboxWorkspace(sandbox, "ws")
  step("sandbox created", existsSync(dshHome) && existsSync(userHome) && existsSync(workspace), { sandbox, dshHome, userHome, workspace })

  // Credentials are copied ONCE into the sandbox; the real home is never read again. The boot does not
  // need a model answer to mount its rows, but a home WITHOUT the credential file makes the harness
  // exit before the rows come up — which would prove nothing about the MCP children.
  const realCredentials = join(homedir(), ".dsh", ".credentials.yaml")
  const seeded = seedSandboxCredentials(dshHome, { credentialsFile: realCredentials })
  const realSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(realSettings)) copyFileSync(realSettings, join(dshHome, "settings.yaml"))
  step("credentials seeded into the sandbox", existsSync(realCredentials), { credentials: seeded, settingsStaged: existsSync(realSettings) })

  /** The dev-flavored patch files, in manifest order. */
  const devFiles: string[] = []
  declaredBundlePatches().forEach((source, index) => {
    /** The sandbox file this dev-flavored patch is written to. */
    const file = join(sandbox, `bundle.dev.${index}.patch.yml`)
    writeFileSync(file, devFlavor(readFileSync(source, "utf8")))
    devFiles.push(file)
  })
  step("bundle patches dev-flavored", devFiles.length === 2, { devFiles })
  /** The main dev patch's MCP rows, asserted to be checkout-absolute so the children really start. */
  const mainText = readFileSync(devFiles[0] as string, "utf8")
  const mcpRows = ["packages/mpd-mcp-astgrep/launch.ts", "packages/mpd-mcp-codegraph/launch.ts", "packages/mpd-mcp-lsp/launch.ts", "packages/mpd-mcp-gitbash/launch.ts"].filter((rel) => mainText.includes(join(repoRoot, rel)))
  step("MCP rows rewritten to checkout-absolute operands", mcpRows.length >= 3, { mcpRows })

  /** The QA-only overlay that ENABLES the Windows-only `mcp-gitbash` row for this boot. */
  const gitbashOverlay = join(sandbox, "enable-gitbash.patch.yml")
  writeFileSync(gitbashOverlay, [
    "# QA boot overlay (lane F evidence): the mcp-gitbash row ships disabled because git_bash is",
    "# Windows-only by upstream design; this run enables it so its launcher really starts.",
    "- id: mcp-gitbash",
    "  disabled: false",
    "",
  ].join("\n"))
  step("gitbash enable overlay written", existsSync(gitbashOverlay), { gitbashOverlay })

  /** The captured host stdout, as its own file. */
  const stdoutFile = join(outDir, "host.stdout")
  /** The captured host stderr, as its own file. */
  const stderrFile = join(outDir, "host.stderr")
  const outFd = openSync(stdoutFile, "w")
  const errFd = openSync(stderrFile, "w")
  const env: Env = credentialEnv({ ...process.env, DSH_HOME: dshHome, HOME: userHome, MPD_MCP_LOG_DIR: mcpLogs })
  if (env.DSH_HOME !== dshHome || env.HOME !== userHome) throw new Error("sandbox assertion failed")
  /** The `dsh` invocation, resolved through the QA launcher helper so a missing binary is reported. */
  const spec = dshCommand(["--profile", "headless", ...devFiles.flatMap((file) => ["--patch", file]), "--patch", gitbashOverlay, "ok"], env)
  if (spec === null) throw new Error("no dsh launcher on PATH")
  /** The boot's own result; its status is recorded, never used as the verdict (a headless prompt needs a model). */
  const run = spawnSync(spec.command, spec.args, { env, cwd: workspace, encoding: "utf8", timeout: 300_000, stdio: ["ignore", outFd, errFd] })
  closeSync(outFd)
  closeSync(errFd)
  step("dsh boot completed", run.status !== null || run.error !== undefined, { status: run.status, signal: run.signal, error: String(run.error ?? "") })

  // Workspace isolation: the session key must be the SANDBOX workspace, never the real repo's.
  /** The session-store sandbox verdict, recorded as evidence of isolation. */
  let sandboxVerdict: unknown = null
  try {
    sandboxVerdict = assertSessionsSandboxed(dshHome, sandbox, { label: "terminal-silence" })
  } catch (error) {
    sandboxVerdict = String(error)
  }
  step("session store is sandboxed", typeof sandboxVerdict === "object" && sandboxVerdict !== null, sandboxVerdict)

  /** The MCP child logs the boot's children wrote. */
  const logDir = join(mcpLogs, ".mpd", "logs")
  /** The log files found, by name. */
  const logFiles = existsSync(logDir) ? readdirSync(logDir).sort() : []
  step("MCP children wrote their logs into the pinned root", logFiles.length > 0, { logDir, logFiles })

  /** The patch guards' own log, which must carry the guard line instead of the terminal. */
  const guardLog = join(mcpLogs, ".mpd", "logs", "mpd-patch-guards.log")
  /** The guard log's content, or `""` when the guards never had to say anything. */
  const guardText = existsSync(guardLog) ? readFileSync(guardLog, "utf8") : ""
  step("the patch guards wrote their line to the log FILE, not the terminal", guardText.includes("[mpd-better-sidebar] mount guard:"), { guardLog, guardText })

  /** Where the MCP logs are copied to inside the evidence dir. */
  const copiedLogs = join(outDir, "mcp-logs")
  if (existsSync(logDir)) cpSync(logDir, copiedLogs, { recursive: true })

  /** The terminal/stderr capture, scanned for the guard line the terminal must NOT carry. */
  const stderrText = existsSync(stderrFile) ? readFileSync(stderrFile, "utf8") : ""
  step("host stderr carries NO patch-guard line", !stderrText.includes("[mpd-better-sidebar] mount guard:"), stderrText.split("\n").filter((line) => line.includes("mount guard")).length)

  // ── the claim THIS lane owns: MCP-child bytes must never reach the captured host streams ─────────
  /** The MCP-child bytes in the captured stdout, which must be EMPTY. */
  const stdoutMcp = markedLines(stdoutFile, MCP_CHILD_MARKERS)
  /** The MCP-child bytes in the captured stderr, which must be EMPTY. */
  const stderrMcp = markedLines(stderrFile, MCP_CHILD_MARKERS)
  step("host stdout carries ZERO MCP-child bytes", stdoutMcp.length === 0, stdoutMcp)
  step("host stderr carries ZERO MCP-child bytes", stderrMcp.length === 0, stderrMcp)

  // ── reported, NOT asserted: bytes an in-process plugin row wrote. They mount INSIDE the dsh process,
  // so the sink cannot take their writers away without silencing the host; they are the frozen sweep
  // inventory the phase-2 sweep removes, and this is the measurement that sizes that sweep.
  /** The in-process row bytes in the captured stdout. */
  const stdoutRows = markedLines(stdoutFile, ROW_MARKERS)
  /** The in-process row bytes in the captured stderr. */
  const stderrRows = markedLines(stderrFile, ROW_MARKERS)
  step("in-process row bytes are reported (expected non-zero until the phase-2 sweep)", true, {
    stdout: stdoutRows,
    stderr: stderrRows,
    note: "these are the frozen SWEEP_INVENTORY files, not MCP children",
  })

  /** The byte sizes of both captures, so "zero MPD bytes" is read against a non-empty total. */
  const sizes = {
    stdout: existsSync(stdoutFile) ? readFileSync(stdoutFile).byteLength : 0,
    stderr: existsSync(stderrFile) ? readFileSync(stderrFile).byteLength : 0,
  }
  step("the captures are files with real content (the boot really spoke)", sizes.stdout > 0 && sizes.stderr > 0, sizes)

  result.ok = steps.every((entry) => (entry as { ok: boolean }).ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
  console.log(JSON.stringify(result, null, 2))
}

main()
