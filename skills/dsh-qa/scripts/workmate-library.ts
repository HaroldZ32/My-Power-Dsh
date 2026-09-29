#!/usr/bin/env node
// Case workmate-library: prove the mpd-workmate plugin is mounted and functional
// end-to-end in a real headless boot, with the workmate library rooted at a SANDBOX
// HOME (~/.mpd/workmate) so the real home is never touched:
//   1) offline self-test: dist exists, bundle patch row, memberPersona injection patch,
//      preset guidance, package name;
//   2) real boot (isolated DSH_HOME + sandbox HOME): init -> list -> spawn (real model)
//      -> reflect -> match; assert output markers, the sandbox ~/.mpd/workmate files, and
//      that the real ~/.mpd/workmate was NOT created.
// Evidence -> evidence/plan-f/workmate-library/<ts>/. --self-test is offline.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, dirname, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.ts"
import type { ToolCallEvidence } from "./lib/session-evidence.ts"
import { findToolCall, readSessionEvents, recordedToolNames } from "./lib/session-evidence.ts"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.ts"
import { readMpdPresetSource } from "./lib/preset-source.ts"

/** A parsed `--json` dump capture: the wrapper prints the child's own stdout under `stdout`. */
interface DumpCapture {
  /** The child's stdout as the wrapper captured it, absent when the capture carried none. */
  readonly stdout?: string
}

/** The `package.json` fields this case pins about the workmate package. */
interface PackageManifest {
  /** The npm package name the bundle's rows address. */
  readonly name?: string
}

/** The `meta.json` bookkeeping this case reads: the `uses` counter that `reflect` bumps. */
interface WorkmateMeta {
  /** How many times the workmate has been used, absent when no meta.json was written. */
  readonly uses?: number
}

/** One entry of the run's verdict ledger, so `allOk` can fold every step by its `ok`. */
interface StepVerdict {
  /** Whether this step held; every step this case records carries one. */
  readonly ok: boolean
  /** The step's own evidence fields, recorded verbatim in `result.json`. */
  readonly [field: string]: unknown
}

/** The optional knobs of the case's own `spawnSync` wrapper. */
interface RunSyncOptions {
  /** Per-child timeout in milliseconds, defaulted to the long live-model bound. */
  readonly timeout?: number
  /** The child's working directory, defaulted to the repository root. */
  readonly cwd?: string
}

/** What the case's `spawnSync` wrapper reports: the child's status and both output views. */
interface ChildRun {
  /** The child's exit status, or `null` when nothing ran (no `dsh` launcher resolved). */
  readonly status: number | null
  /** Stdout and stderr concatenated, for the marker assertions. */
  readonly out: string
  /** Stdout alone, which `dumpJsonText` parses under `--json`. */
  readonly stdout: string
}

/**
 * The wrapper's `--json` capture, reduced to the child's own `stdout` text; a capture that is not
 * JSON is returned verbatim so the tree assertions still run over what was really printed. The
 * parsed value is untyped, so it is asserted to the field the wrapper is documented to print —
 * no narrowing can relate an arbitrary parsed value to that field.
 */
const dumpJsonText = (text: string): string => { try { return (JSON.parse(text) as DumpCapture).stdout ?? "" } catch { return String(text ?? "") } }
// .../skills/dsh-qa/scripts/workmate-library.ts -> the repository root.
const repoRoot: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The live prompt: drives the workmate flow init -> list -> spawn -> reflect -> match. */
const PROMPT: string = `Use the workmate tools in this exact order and report each result:
1) mpd_workmate_init {base:"hephaestus", name:"alice", note:"Verilog counter specialist"}
2) mpd_workmate_list
3) mpd_workmate_spawn {name:"alice", task:"Read the file README.md in the workspace and summarize it in one sentence"}
4) mpd_workmate_reflect {name:"alice", task:"summarize README", outcome:"provided a one-sentence summary"}
5) mpd_workmate_match {task:"implement a verilog counter and verify"}
End with the word DONE and then the contents of the note card ~/.mpd/workmate/alice/note.md.`

/** Report one failed case assertion and end the run with exit 1; never returns. */
function fail(msg: string): never { console.error("[workmate-library] FAIL: " + msg); process.exit(1) }

/** The offline arm: static pins of the dist, the bundle row, the persona patch and the preset. */
function selfTest(): void {
  // Every assertion label paired with its verdict, so one run reports each break by name.
  const checks: Array<[string, boolean]> = []
  // The built workmate plugin, which a checkout install mounts by reference.
  const dist = join(repoRoot, "packages", "mpd-workmate-plugin", "dist", "index.js")
  checks.push(["workmate dist built", existsSync(dist)])
  // The bundle patch, which declares the row that mounts the workmate plugin.
  const patch = readFileSync(join(repoRoot, "cordis.patch.yml"), "utf8")
  checks.push(["bundle patch row mpd-workmate", patch.includes("id: mpd-workmate") && patch.includes("@mpd-dsh/mpd/packages/mpd-workmate-plugin/dist/index.js")])
  // RETIREMENT (2026-09-27): the workmate guidance used to live in the adopted
  // vendored plugin's roster block inside the bundle patch. That row is GONE, so
  // the guidance moved to where the agent actually reads it — the mpd preset. Both
  // halves are asserted: the retired sentence must not linger in the patch, and
  // the PRESET must carry the consult/anti-weak-match rule.
  checks.push(["bundle patch no longer carries the retired roster workmate guidance", !patch.includes("never force a weak note match")])
  // The retired adopted plugin's member-persona source, where the injection patch lives.
  const members = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "members.ts"), "utf8")
  checks.push(["memberPersona workmate injection", members.includes("function workmateBacking") && members.includes("mpd_workmate_reflect") && members.includes("Durable workmate backing")])
  // 0.1.7-rc.2 ROW MODEL: the mpd composition is an inline `config.plugins` list in
  // the `preset-mpd` row of the manifest's second bundle patch — there is no
  // `presets/mpd/` directory any more. Read the DECLARED source, never a path.
  const preset = readMpdPresetSource(repoRoot)
  checks.push(["mpd preset WORKMATE guidance", preset.includes("WORKMATE LIBRARY") && preset.includes("mpd_workmate_init")])
  // The anti-weak-match rule, read from its NEW home (the retired roster block is
  // gone from the bundle patch, so asserting it there would be an assertion about
  // deleted text).
  checks.push(["mpd preset forbids forcing a weak workmate match", preset.includes("mpd_workmate_match") && /forcing a weak match/.test(preset)])
  // The package's own manifest, whose name the bundle's rows address.
  const pkg: PackageManifest = JSON.parse(readFileSync(join(repoRoot, "packages", "mpd-workmate-plugin", "package.json"), "utf8"))
  checks.push(["package name @mpd-dsh/workmate", pkg.name === "@mpd-dsh/workmate"])
  // The release packer, whose plugin list must still carry this package.
  const pack = readFileSync(join(repoRoot, "scripts", "pack-mpd.ts"), "utf8")
  checks.push(["pack PLUGIN_PKGS includes workmate", pack.includes('"mpd-workmate-plugin"')])
  // Sidebar surface: the library is contributed as a DSH-better-sidebar tab — its ONLY
  // host — so the host must publish the roster + detail routes the tab reads and the
  // client must register that tab through the sidebar service.
  const wmSource = readFileSync(join(repoRoot, "packages", "mpd-workmate-plugin", "src", "index.ts"), "utf8")
  checks.push(["host roster route", wmSource.includes('path: "/plugins/mpd-workmate/roster"') && wmSource.includes('ctx.get ? ctx.get("mpdRoles") : undefined')])
  checks.push(["host detail route", wmSource.includes('path: "/plugins/mpd-workmate/get"') && wmSource.includes("workmateLibrary.read(name)")])
  // Mutation surface: rename + delete are POST-only routes that branch on a reason code, and
  // the docs describe exactly these literals — so pin them (a rename of either route or of a
  // reason string must fail the case, not silently invalidate the documentation).
  // B1/t7 recap: the mutation API gained a trailing `teamRoots` argument (the in-use gate must
  // scan the CALLING SESSION's workspace, not the dsh process cwd), so the pinned literals carry
  // it; the route paths and the reason matrix below are unchanged.
  checks.push(["host rename route", wmSource.includes('path: "/plugins/mpd-workmate/rename"')
    && wmSource.includes("renameWorkmate(parsed.body?.name, parsed.body?.new_name, agentlessRoots(dsh))")])
  checks.push(["host delete route", wmSource.includes('path: "/plugins/mpd-workmate/delete"')
    && wmSource.includes("deleteWorkmate(parsed.body?.name, parsed.body?.purge, parsed.body?.confirm, agentlessRoots(dsh))")])
  checks.push(["mutation routes are POST-only with allow: POST", (wmSource.match(/allow: "POST"/g) ?? []).length >= 2])
  // The §D refusal matrix the GUI branches on: every reason the docs publish must exist here.
  const REASONS: readonly string[] = ["invalid-name", "unknown", "collision", "in-use", "confirm-required"]
  checks.push(["§D refusal reason matrix", REASONS.every((r) => wmSource.includes(`"${r}"`))
    && wmSource.includes("{ blocking: e.blocking }")])
  // Archive-first delete: the archive root is the hidden `.archive/` directory and a purge is
  // the only destructive path (it must keep requiring the exact name).
  checks.push(["delete is archive-first with a confirmed purge", wmSource.includes('join(workmateRoot(), ".archive")')
    && wmSource.includes("archived: null, purged: true")])
  checks.push(["service exposes rename + delete", wmSource.includes("rename: (name: string, newName: string, roots?: string[])")
    && wmSource.includes("delete: (name: string, purge = false, confirm = \"\", roots?: string[])")])
  // The combined web client the bundle ships, read for the sidebar tab it registers.
  const client = readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "client.js"), "utf8")
  checks.push(["client registers a better-sidebar tab", client.includes('const SIDEBAR_TAB_ID = "mpd-workmate"')
    && client.includes("sidebar.registerTab") && client.includes("registerWorkmateSidebarTab")])
  // The tab is registered from the ctx.inject callback: the sidebar service is provided by
  // another plugin's fiber AFTER this entry applies, so a one-shot probe would never see it.
  checks.push(["the sidebar service is awaited, not probed", client.includes('ctx.inject(["betterSidebar"]')
    && client.includes("mountSidebarPages(ctx, loadTeamPage())")
    && !client.includes("serviceAvailable(")])
  // The ARTIFACT carries the adopted bundle verbatim, whose dormant apply() still contains
  // its own `shell.overlay` registration — so the removed-surface scan reads the mpd SOURCE.
  const clientSource = readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "web-client.ts"), "utf8")
  checks.push(["client keeps NO floater fallback", !client.includes("mpd-workmate-library")
    && !client.includes("mpd-workmate-toggle")
    && !/inject\(\s*["'`]shell\.overlay["'`]/.test(clientSource)
    && !/inject\(\s*["'`]sidebar\.footer\.action["'`]/.test(clientSource)])
  // Isolation regression pin (T-60/T-21): the case must prove it never TOUCHES the real library by
  // sandboxing HOME and comparing the real listing before/after. The old assertion — the real
  // library must NOT EXIST — is false on any machine that ever used one and made the case red for
  // the environment instead of the change; it must never come back.
  const selfSource = readFileSync(join(repoRoot, "skills", "dsh-qa", "scripts", "workmate-library.ts"), "utf8")
  // Built by concatenation so this check's own needle cannot appear in the file it scans.
  const oldAbsenceAssertion = "!" + "existsSync(realWm)"
  checks.push(["isolation = sandbox HOME + real listing unchanged (never an absence assertion)",
    selfSource.includes("realWmAfter === realWmBefore")
    && selfSource.includes("HOME: wmHome")
    && !selfSource.includes(oldAbsenceAssertion)])
  // The labels that failed, printed together so one run reports every break.
  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n)
  if (bad.length) fail("self-test: " + bad.join(" | "))
  console.log("[workmate-library self-test] ok: " + checks.length + " checks")
}

/** The live arm: an isolated boot that drives the whole workmate flow and reads its files back. */
function runReal(): void {
  // The declared credential store, copied ONCE into the sandbox (never read from the real home).
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials at " + creds)
  // The real workmate library, which must be byte-identical before and after the run.
  const realWm = join(homedir(), ".mpd", "workmate")
  // The run's timestamp, which names the evidence directory and holds no path separator.
  const ts = new Date().toISOString().replaceAll(":", "-")
  // The evidence directory this run writes its verdict and log into.
  const outDir = join(repoRoot, "evidence", "plan-f", "workmate-library", ts)
  mkdirSync(outDir, { recursive: true })
  // The sandbox `DSH_HOME` the boot reads; the real harness home is never touched.
  const dshHome = mkdtempSync(join(tmpdir(), "mpd-wm-dsh-"))
  // The sandbox `HOME`, which is what puts `~/.mpd/workmate` inside the sandbox.
  const wmHome = mkdtempSync(join(tmpdir(), "mpd-wm-home-"))
  // The sandbox workspace, passed explicitly as every spawn's cwd.
  const ws = join(wmHome, "ws")
  mkdirSync(ws, { recursive: true })
  seedSandboxCredentials(dshHome, { credentialsFile: creds })
  // Live-LLM case: a home whose keys come from gateway providers configures the model
  // chain in settings.yaml too — without it the sandbox falls back to the base
  // deepseek-official route and the run dies with MISSING_CREDENTIAL (§7).
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(dshHome, "settings.yaml"))
  writeFileSync(join(ws, "README.md"), "# my-power-dsh\nworkmate e2e workspace\n")
  // The child environment: the sandbox home pair plus the resolved provider credential.
  const env = credentialEnv({ ...process.env, DSH_HOME: dshHome, HOME: wmHome  })
  // The invariant this case must prove is that it never TOUCHES the real library — NOT that the
  // real library is absent (it exists on any machine that ever used one; measured on this host:
  // /root/.mpd/workmate). The library under test lives under the SANDBOX HOME, and the real one is
  // snapshot before/after — the same shape workmate-team-member.ts uses. The product resolves the
  // root as `$HOME/.mpd/workmate` (mpd-workmate src/index.ts `homeDir(): process.env.HOME || homedir()`),
  // so sandboxing HOME is what keeps it out of the real home.
  const realWmBefore = existsSync(realWm) ? readdirSync(realWm).sort().join(",") : null
  // The run's verdict ledger, one entry per step this case asserts.
  const steps: Record<string, StepVerdict> = {}
  /**
   * Run one child with the sandbox environment.
   * @param cmd The command name, or `dsh` to go through the PATH-resolved launcher.
   * @param args The argument vector.
   * @param opts Optional timeout and working directory.
   * @returns The child's status and both output views.
   */
  function runSync(cmd: string, args: string[], opts: RunSyncOptions = {}): ChildRun {
    // The launcher spec: `dsh` is PATH-resolved (win32 needs its shim), any other name is verbatim.
    const spec = cmd === "dsh" ? dshCommand(args, env) : { command: cmd, args }
    // The child's result, or a synthetic miss when no `dsh` launcher resolves at all.
    const r = spec === null ? { status: null, stdout: "", stderr: DSH_MISSING } : spawnSync(spec.command, spec.args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    return { status: r.status, out: (r.stdout || "") + (r.stderr || ""), stdout: r.stdout || "" }
  }

  // The isolated install, which is what materializes the profile the boot reads.
  const inst = runSync(process.execPath, [join(repoRoot, "scripts", "install-profile.ts"), "--yes", "--dsh-home", dshHome, "--profile", "mpd-headless", "--skip-toolchain"], { timeout: 600000 })
  steps.install = { ok: inst.status === 0, exit: inst.status }

  // T-69: composition goes through the wrapper; the tree comes from the --json child output.
  const dump = runSync(process.execPath, [join(repoRoot, "scripts", "dump-config.ts"), "--profile", "mpd-headless", "--json"], { timeout: 120000 })
  // The composed tree, banner-free — the part the assertions read.
  const dumpText = dumpJsonText(dump.stdout)
  steps.dump = { ok: dump.status === 0 && dumpText.includes("id: mpd-workmate") && dumpText.includes("id: mpd-roles") && dumpText.includes("id: mpd-bootstrap"), exit: dump.status }

  // The flow assertion comes from the HARNESS session log, never from the model's prose (AGENTS.md
  // §7): the five workmate tools must have been CALLED. Measured flakiness the prose form carried:
  // 03:08Z a sample reasoned about the flow and called NO tool at all — the lane failed on
  // `out.includes("alice")`-style markers without saying which tool was missing. One bounded RETRY
  // absorbs live-model non-determinism; a flow that does not happen in either attempt is still a FAIL.
  const REQUIRED_TOOLS: readonly string[] = ["mpd_workmate_init", "mpd_workmate_list", "mpd_workmate_spawn", "mpd_workmate_reflect", "mpd_workmate_match"]
  // The sandbox library root the product resolves from the sandbox HOME.
  const wmRoot = join(wmHome, ".mpd", "workmate")
  // The instance under test, named by the prompt's `name:"alice"`.
  const alice = join(wmRoot, "alice")
  // The four durable files init/reflect must leave behind on the instance.
  const aliceFiles: readonly string[] = ["meta.json", "persona.md", "memory.md", "note.md"]
  // The boot's whole output, which the marker assertions read.
  let out = ""
  // The last boot's exit status, or `null` when no launcher resolved.
  let liveStatus: number | null = null
  // How many live attempts have run, bounded by the retry below.
  let attempts = 0
  // The tool names the harness showed the model, recorded as counter-evidence.
  let tools: string[] = []
  // The required tools whose call the log did not prove, empty once the flow completed.
  let missingTools: string[] = [...REQUIRED_TOOLS]
  // Whether all four durable instance files exist after the attempt.
  let filesOk = false
  // The call/result evidence per required tool, keyed by the tool name.
  let calls: Record<string, ToolCallEvidence> = {}
  // The retry diagnostics, recorded only when the first attempt did not complete the flow.
  const retryNotes: string[] = []
  while (attempts < 2) {
    attempts += 1
    // This attempt's live boot, in the sandbox workspace.
    const live = runSync("dsh", ["--profile", "mpd-headless", PROMPT], { timeout: 900000, cwd: ws })
    out = live.out
    liveStatus = live.status
    // The harness's own session-log view of this attempt, keyed by the sandbox workspace.
    const store = readSessionEvents(dshHome, { workspace: ws })
    // CALL evidence, not availability: `recordedToolNames` reads the request header's tool LIST
    // (what the session had), while `findToolCall` joins a `tool/call` with a non-error
    // `tool/result` — the only thing that proves the workmate tools really RAN.
    tools = recordedToolNames(store.records)
    calls = Object.fromEntries(REQUIRED_TOOLS.map((name): [string, ToolCallEvidence] => [name, findToolCall(store.records, name)]))
    missingTools = REQUIRED_TOOLS.filter((name) => calls[name].succeeded !== true)
    filesOk = aliceFiles.every((f) => existsSync(join(alice, f)))
    if (missingTools.length === 0 && filesOk) break
    if (attempts < 2) retryNotes.push("attempt " + attempts + " did not complete the flow (unproven tools: " + (missingTools.join(",") || "none") + "; files present: " + filesOk + ") — retrying once")
  }
  // The regenerated note card, or `""` when reflect never rewrote it.
  const note = existsSync(join(alice, "note.md")) ? readFileSync(join(alice, "note.md"), "utf8") : ""
  // The instance memory reflect appends to, or `""` when it was never written.
  const memory = existsSync(join(alice, "memory.md")) ? readFileSync(join(alice, "memory.md"), "utf8") : ""
  // The instance bookkeeping; an unreadable meta.json leaves the counter absent.
  let meta: WorkmateMeta = {}
  try { meta = JSON.parse(readFileSync(join(alice, "meta.json"), "utf8")) } catch { meta = {} }
  steps.live = { ok: liveStatus === 0 && !out.includes("ERR_MODULE_NOT_FOUND"), exit: liveStatus, attempts, retryNotes }
  steps.flow = {
    ok: missingTools.length === 0,
    calls: Object.fromEntries(Object.entries(calls).map(([name, call]) => [name, { called: call.called, succeeded: call.succeeded }])),
    unproven: missingTools.map((name) => name + ": " + calls[name].reason),
    availableTools: tools.length,
    source: "harness session log (tool/call + non-error tool/result via findToolCall), not the model's prose",
    sample: out.slice(-1500).replace(/\n/g, " | ").slice(0, 600),
  }
  steps.files = {
    // The product's own contract (mpd-workmate src/index.ts, measured): init writes the note card and
    // starts `meta.uses` at 0 with an EMPTY memory.md; `mpd_workmate_reflect` APPENDS to memory.md,
    // bumps `uses` by 1 and REGENERATES note.md through autoNote() — so the INIT phrase is not
    // guaranteed to survive. Asserting it asserts the model's verbosity: the same lane code read
    // ok=true at 02:31Z and ok=false at 02:47Z (the second note dropped "Verilog counter specialist").
    // Assert the durable bookkeeping instead: four files, a non-empty regenerated note, memory written
    // by reflect, and `uses` advanced past init's 0.
    ok: filesOk && note.trim().length > 0 && memory.trim().length > 0 && Number(meta.uses ?? 0) >= 1,
    uses: meta.uses ?? null,
    noteChars: note.trim().length,
    memoryChars: memory.trim().length,
    note: note.slice(0, 160),
    wmRoot,
  }
  // The real library's listing AFTER the run, which must equal the before-snapshot.
  const realWmAfter = existsSync(realWm) ? readdirSync(realWm).sort().join(",") : null
  steps.isolation = {
    // (a) the exercised library root is INSIDE the sandbox HOME and the child really got it as
    // HOME (a case that forgot to sandbox HOME would silently exercise the real library), and
    // (b) the real library's listing is unchanged — measured, not asserted as an absence.
    ok: realWmAfter === realWmBefore && wmRoot.startsWith(wmHome + sep) && env.HOME === wmHome && env.HOME !== homedir(),
    realWm,
    before: realWmBefore,
    after: realWmAfter,
    sandboxHome: wmHome,
    sandboxRoot: wmRoot,
    homeSandboxed: env.HOME === wmHome,
    predicate: "HOME is the sandbox (so $HOME/.mpd/workmate resolves inside it) AND the real library listing is unchanged",
  }

  // The run's single verdict: every recorded step must have held.
  const allOk = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, dshHome, wmHome, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out.slice(0, 40000) + "\n\n--- dump (raw capture, banner included) ---\n" + dump.out.slice(0, 20000) + "\n\n--- composed tree (stdout, banner-free — what the assertions read) ---\n" + dumpText.slice(0, 40000))
  console.log("[workmate-library] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 260))
  if (!allOk) process.exit(1)
  console.log("[workmate-library] PASS")
}

// The argv the case dispatches on: `--self-test` runs the offline arm, anything else the live one.
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
