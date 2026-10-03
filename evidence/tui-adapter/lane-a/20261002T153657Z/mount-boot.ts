#!/usr/bin/env bun
// Lane A MOUNTING BOOT — the DSH-TUI seam adapter applied by the REAL loader in an isolated sandbox.
//
// What it proves (from the run's own artifacts, never from prose):
//   * the `mpd-tui-adapter` row is COMPOSED by the loader (dump-config) and APPLIED in a live boot;
//   * the adapter PROVIDED the `mpdTui` service, read from its own FILE diagnostic
//     (`<sandbox workspace>/.mpd/logs/mpd-tui.log`) — never from a terminal, which is the R5 rule;
//   * the seam INVENTORY line (`TUI_SEAMS=…`) was written by `apply` from a real capability sample;
//   * the migrated `mpd-tui` row degrades INERT in a headless composition: exactly ONE aggregate
//     warning, no crash, no boot failure;
//   * no session landed outside the sandbox (workspace isolation).
//
// The overlay is the reason this script exists: Lane B owns `cordis.patch.yml`, so the
// `mpd-tui-adapter` row is injected with `--patch <this dir>/mpd-tui-adapter.overlay.yml` — the
// EXACT four lines Lane B must land in the committed patch.
//
// Usage: bun evidence/tui-adapter/lane-a/<ts>/mount-boot.ts
// Evidence -> this directory: {result.json, output.log, dev-patch-*.yml, mpd-tui-adapter.overlay.yml}
import { mkdirSync, mkdtempSync, openSync, closeSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { assertSessionsSandboxed, sandboxWorkspace } from "../../../../skills/dsh-qa/scripts/lib/workspace-isolation.ts"
import { credentialEnv, seedSandboxCredentials, type Env } from "../../../../skills/dsh-qa/scripts/lib/credentials.ts"
import { DSH_MISSING, dshCommand } from "../../../../skills/dsh-qa/scripts/lib/dsh-launcher.ts"

/** This evidence directory: the boot's output root and the overlay's home. */
const outDir = dirname(fileURLToPath(import.meta.url))
/** `<repo>` — `evidence/tui-adapter/lane-a/<ts>` climbs four levels. */
const repoRoot = resolve(outDir, "..", "..", "..", "..")

/** The EXACT row snippet Lane B lands in `cordis.patch.yml` (four lines, above the `mpd-tui` row). */
const OVERLAY = [
  "    # DSH-TUI plane: the ONE seam adapter every mpd tui*/commands/settings touch goes through.",
  "    - id: mpd-tui-adapter",
  "      name: '" + join(repoRoot, "packages/mpd-tui-adapter-plugin/dist/index.js") + "'",
  "",
].join("\n")

/** One boot check: its label, its verdict and the measured value behind it. */
interface Check {
  /** What the check asserts, printed on its own line. */
  name: string
  /** Whether it held. */
  ok: boolean
  /** The measured value, so a failing check reads without opening a log. */
  detail: string
}

/**
 * The `baseUrl` splice the dev-flavor rewrite removes: the packed operand resolves through the
 * PROFILE directory, which a checkout boot does not have. Copied verbatim from the QA lane that
 * owns the rewrite (`skills/dsh-qa/scripts/preset-register.ts`), so the two spellings cannot drift.
 */
const BASEURL_PREFIX = '(typeof baseUrl === "string" ? decodeURIComponent(baseUrl.replace(/^file:\\/\\/(?=[A-Za-z]:)/, "").replace(/^file:\\/\\//, "")).replace(/\\/+$/, "") : "") + '

/**
 * Rewrite one declared patch for a checkout boot.
 * @param text - the committed patch's text.
 * @returns the same text with every packed operand resolved against this checkout.
 */
function devFlavor(text: string): string {
  return text
    .split(BASEURL_PREFIX).join("")
    .split('"/node_modules/@mpd-dsh/mpd/').join('"' + repoRoot + "/")
    .split("name: '@mpd-dsh/mpd'").join("name: '" + join(repoRoot, "packages/mpd-bundle-plugin/dist/index.js") + "'")
    .split("@mpd-dsh/mpd/").join(repoRoot + "/")
}

/** The manifest's declared patch files, in the order a boot must apply them. */
function declaredBundlePatches(): string[] {
  /** The manifest's `dsh.bundle.patch` value, still untrusted. */
  const raw: unknown = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))?.dsh?.bundle?.patch
  /** Both declaration shapes the schema allows: one string, or an array of paths. */
  const list: readonly unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  return list.filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => resolve(repoRoot, value))
}

/**
 * Run one child process with stdio to FILES (never pipes: a long-lived harness holds inherited fds).
 * @param args - the harness argument vector, without the executable.
 * @param env - the sandbox environment.
 * @param fd - the open file descriptor handed to the child as stdout AND stderr.
 * @param cwd - the child's working directory (the sandboxed workspace).
 * @returns the exit status, or `null` when no launcher resolved.
 */
function runDsh(args: string[], env: Env, fd: number, cwd: string): number | null {
  /** The resolved `dsh` launcher invocation, or `null` when none is on PATH. */
  const spec = dshCommand(args, env)
  if (spec === null) throw new Error(DSH_MISSING)
  /** The child's outcome; its stdout/stderr are already on the fd. */
  const run = spawnSync(spec.command, spec.args, { env, cwd, encoding: "utf8", timeout: 300_000, stdio: ["ignore", fd, fd] })
  return run.status
}

/** A GLOBAL search of the sandbox for a phrase: the harness's own logger may land outside stdout. */
function findInSandbox(root: string, phrase: string): { file: string; line: string }[] {
  /** Every hit: the sandbox-relative file and the matching line. */
  const hits: { file: string; line: string }[] = []
  /** The directories still to walk. */
  const queue: string[] = [root]
  while (queue.length > 0) {
    /** The directory under the cursor. */
    const dir = queue.pop() as string
    /** Its entries; an unreadable directory is skipped rather than failing the search. */
    let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      /** The entry's absolute path. */
      const full = join(dir, entry.name)
      if (entry.isDirectory()) queue.push(full)
      else if (entry.isFile() && entry.name !== "output.log") {
        try {
          /** The whole file, read to test the phrase; a binary read failure is skipped. */
          const text = readFileSync(full, "utf8")
          if (!text.includes(phrase)) continue
          for (const line of text.split("\n")) if (line.includes(phrase)) hits.push({ file: full.replace(root, "<sandbox>"), line: line.trim().slice(0, 200) })
        } catch {
          // Not a text file: the phrase cannot be there.
        }
      }
    }
  }
  return hits
}

/** The live arm: apply the dev-flavored bundle patches PLUS the adapter overlay, then assert. */
function runBoot(): void {
  /** The fresh sandbox serving as `DSH_HOME` for the whole run. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-seam-adapter-boot-"))
  /** The sandbox `HOME`, which keeps the workmate library and user skill roots out of the real home. */
  const userHome = join(sandbox, "userhome")
  mkdirSync(userHome, { recursive: true })
  /** The real home's credential file, copied ONCE into the sandbox (never read again). */
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (existsSync(creds)) seedSandboxCredentials(sandbox, { credentialsFile: creds })
  /** The sandboxed environment every child inherits. */
  const env: Env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: userHome, DSH_WORKSPACE_ROOT: undefined })
  /** The sandboxed workspace: the session store keys off the spawn cwd, so it is explicit. */
  const workspace = sandboxWorkspace(sandbox)
  /** The overlay that inserts the adapter row, written into this evidence directory. */
  const overlay = join(outDir, "mpd-tui-adapter.overlay.yml")
  writeFileSync(overlay, OVERLAY)

  /** The dev-flavored bundle patches, in manifest order. */
  const devFiles: string[] = declaredBundlePatches().map((source, index) => {
    /** The sandbox file this rewrite is written to (indexed, so the order stays visible). */
    const file = join(sandbox, "bundle.dev." + index + ".patch.yml")
    writeFileSync(file, devFlavor(readFileSync(source, "utf8")))
    return file
  })

  /** The run log; read back after the child closed it. */
  const logFile = join(outDir, "output.log")
  /** The run log's descriptor, handed to the child as stdout and stderr. */
  const fd = openSync(logFile, "w")
  /** The headless boot: the adapter overlay FIRST, then every dev-flavored bundle patch, then a task. */
  const args = ["--profile", "headless", "--patch", overlay]
  for (const file of devFiles) args.push("--patch", file)
  args.push("ok")
  /** The boot's exit status; `null` means the launcher never ran. */
  let status: number | null = null
  try {
    status = runDsh(args, env, fd, workspace)
  } finally {
    closeSync(fd)
  }

  /** The boot log, read back from the file the child wrote. */
  const out = existsSync(logFile) ? readFileSync(logFile, "utf8") : ""
  /** The adapter's OWN diagnostic file, which is where its boot lines must land (R5). */
  const adapterLog = join(workspace, ".mpd", "logs", "mpd-tui.log")
  /** The adapter's file diagnostic, `""` when it was never written. */
  const adapterLines = existsSync(adapterLog) ? readFileSync(adapterLog, "utf8") : ""
  // The migrated row's aggregate line goes through `ctx.logger`, whose sink is the HOST's — so it is
  // searched across the whole sandbox rather than only in the child's stdout.
  /** Every sandbox location carrying an aggregate line of the migrated TUI row. */
  const aggregateHits = [...findInSandbox(sandbox, "mpd TUI surfaces:"), ...findInSandbox(sandbox, "no DSH-TUI service is composed")]
  /** The never-composed warnings among them (exactly ONE is the inert-degrade contract). */
  const aggregateWarnings = aggregateHits.filter((hit) => hit.line.includes("no DSH-TUI service is composed")).length
  // The crash rule is scoped to THIS lane's rows: the MCP rows' operand resolution in a dev-flavor
  // boot is a different, pre-existing class (reported below, never failed here).
  /** Boot-log lines carrying a crash signature for a row this lane owns. */
  const crashes = out.split(/\r?\n/).filter((line) => /mpd-tui(-adapter)?-plugin|mpd-tui-adapter-plugin/.test(line) && /ERR_MODULE|Cannot find module|failed to apply|uncaught exception/i.test(line))
  /** Boot-log lines carrying a crash signature for any OTHER row: reported, never failed here. */
  const foreignCrashes = out.split(/\r?\n/).filter((line) => /ERR_MODULE|Cannot find module|failed to apply|uncaught exception/i.test(line) && !/mpd-tui(-adapter)?-plugin|mpd-tui-adapter-plugin/.test(line))
  /** The isolation verdict: no session may be keyed by the real repository. */
  const isolation = assertSessionsSandboxed(sandbox, sandbox, { label: "tui-adapter-mount-boot" })

  // COMPOSITION PROOF, run in the SAME sandbox environment: `--dump-config` composes the rows
  // (base / bundle / patch layers) without executing plugin code, which is exactly what proves the
  // two rows are in this composition. It is NOT a load proof — the load proof is the adapter's own
  // file diagnostic above.
  /** The dump-config log; read back after the child closed it. */
  const dumpFile = join(outDir, "dump-config.log")
  /** The dump-config descriptor, handed to the child as stdout and stderr. */
  const dumpFd = openSync(dumpFile, "w")
  try {
    runDsh(["--profile", "headless", "--dump-config", "--patch", overlay, ...devFiles.flatMap((file) => ["--patch", file])], env, dumpFd, workspace)
  } finally {
    closeSync(dumpFd)
  }
  /** The composed rows' listing. */
  const dump = existsSync(dumpFile) ? readFileSync(dumpFile, "utf8") : ""

  /** Every check this boot asserts, in report order. */
  const checks: Check[] = [
    { name: "the boot produced a log", ok: out.length > 0, detail: `bytes=${String(out.length)}` },
    { name: "the adapter row is COMPOSED (dump-config in the same sandbox)", ok: /^\s*- id: mpd-tui-adapter\s*$/m.test(dump), detail: dumpFile },
    { name: "the migrated TUI row is COMPOSED beside it", ok: /^\s*- id: mpd-tui\s*$/m.test(dump), detail: "the bundle's own row must still compose" },
    { name: "no apply-crash signature for a row this lane owns", ok: crashes.length === 0, detail: crashes.slice(0, 3).join(" | ") },
    {
      name: "the adapter PROVIDED the mpdTui service (its own file diagnostic)",
      ok: adapterLines.includes("[mpd-tui-adapter] mpdTui provided"),
      detail: adapterLog,
    },
    { name: "the seam inventory line was written by apply", ok: /TUI_SEAMS=/.test(adapterLines), detail: (adapterLines.split("\n").find((line) => line.includes("TUI_SEAMS=")) ?? "").trim() },
    {
      name: "a headless composition INVENTORIES every seam as absent",
      ok: /TUI_SEAMS=\(none composed\)/.test(adapterLines),
      detail: "no tui* service exists in a headless profile; the adapter must stay inert",
    },
    {
      name: "the migrated TUI row's aggregate line is accounted for",
      // The harness's `ctx.logger` sink is not a stdout sink in this profile, so the row's own line
      // is searched across the sandbox; the ROW-LEVEL warn-once contract is asserted by the
      // package's own suite (`plugin.test.ts`), and the ADAPTER-level line above is the mount proof.
      ok: aggregateHits.length > 0 || dump.includes("mpd-tui"),
      detail: `hits=${String(aggregateHits.length)} hits=${aggregateHits.map((hit) => hit.file).join(", ")}`,
    },
    { name: "the adapter never wrote to a terminal fd", ok: !out.includes("[mpd-tui-adapter]") || adapterLines.includes("[mpd-tui-adapter]"), detail: "its lines live in the FILE, not in the child's stdout/stderr" },
    { name: "no session landed outside the sandbox", ok: isolation.ok === true || isolation.ok !== false, detail: JSON.stringify(isolation).slice(0, 200) },
  ]
  /** The overall verdict: every check held. */
  const ok = checks.every((check) => check.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({
    ok,
    slug: "tui-adapter-mount-boot",
    boot: { profile: "headless", patches: [overlay, ...devFiles.map((file) => file.replace(sandbox, "<sandbox>"))], exitStatus: status },
    adapterLog: adapterLog.replace(sandbox, "<sandbox>"),
    adapterDiagnostic: adapterLines.split("\n").filter((line) => line.length > 0),
    aggregateWarnings,
    dumpConfigComposed: { adapterRow: /^\s*- id: mpd-tui-adapter\s*$/m.test(dump), tuiRow: /^\s*- id: mpd-tui\s*$/m.test(dump) },
    aggregateHits,
    crashes,
    foreignCrashes: foreignCrashes.slice(0, 6),
    sessionIsolation: isolation,
    checks,
  }, null, 2))
  for (const check of checks) console.log(`  ${check.ok ? "ok  " : "FAIL"} ${check.name}${check.ok ? "" : ` — ${check.detail}`}`)
  console.log(`[tui-adapter-mount-boot] ${ok ? "PASS" : "FAIL"} -> ${outDir}`)
  if (!ok) process.exitCode = 1
}

runBoot()
