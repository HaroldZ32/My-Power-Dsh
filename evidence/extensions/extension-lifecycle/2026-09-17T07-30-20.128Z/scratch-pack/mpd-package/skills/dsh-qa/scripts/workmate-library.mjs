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
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.mjs"
import { findToolCall, readSessionEvents, recordedToolNames } from "./lib/session-evidence.mjs"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const PROMPT = `Use the workmate tools in this exact order and report each result:
1) mpd_workmate_init {base:"hephaestus", name:"alice", note:"Verilog counter specialist"}
2) mpd_workmate_list
3) mpd_workmate_spawn {name:"alice", task:"Read the file README.md in the workspace and summarize it in one sentence"}
4) mpd_workmate_reflect {name:"alice", task:"summarize README", outcome:"provided a one-sentence summary"}
5) mpd_workmate_match {task:"implement a verilog counter and verify"}
End with the word DONE and then the contents of the note card ~/.mpd/workmate/alice/note.md.`

function fail(msg) { console.error("[workmate-library] FAIL: " + msg); process.exit(1) }

function selfTest() {
  const checks = []
  const dist = join(repoRoot, "packages", "mpd-workmate-plugin", "dist", "index.js")
  checks.push(["workmate dist built", existsSync(dist)])
  const patch = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  checks.push(["bundle patch row mpd-workmate", patch.includes("id: mpd-workmate") && patch.includes("@mpd-dsh/mpd/packages/mpd-workmate-plugin/dist/index.js")])
  checks.push(["bundle profile protocol workmate guidance", patch.includes("mpd_workmate_match") && patch.includes("never force a weak note match")])
  const members = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "members.js"), "utf8")
  checks.push(["memberPersona workmate injection", members.includes("function workmateBacking") && members.includes("mpd_workmate_reflect") && members.includes("Durable workmate backing")])
  const preset = readFileSync(join(repoRoot, "presets", "mpd", "agent.cordis.yml"), "utf8")
  checks.push(["mpd preset WORKMATE guidance", preset.includes("WORKMATE LIBRARY") && preset.includes("mpd_workmate_init")])
  const pkg = JSON.parse(readFileSync(join(repoRoot, "packages", "mpd-workmate-plugin", "package.json"), "utf8"))
  checks.push(["package name @mpd-dsh/workmate", pkg.name === "@mpd-dsh/workmate"])
  const pack = readFileSync(join(repoRoot, "scripts", "pack-mpd.mjs"), "utf8")
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
  const REASONS = ["invalid-name", "unknown", "collision", "in-use", "confirm-required"]
  checks.push(["§D refusal reason matrix", REASONS.every((r) => wmSource.includes(`"${r}"`))
    && wmSource.includes("{ blocking: e.blocking }")])
  // Archive-first delete: the archive root is the hidden `.archive/` directory and a purge is
  // the only destructive path (it must keep requiring the exact name).
  checks.push(["delete is archive-first with a confirmed purge", wmSource.includes('join(workmateRoot(), ".archive")')
    && wmSource.includes("archived: null, purged: true")])
  checks.push(["service exposes rename + delete", wmSource.includes("rename: (name: string, newName: string, roots?: string[])")
    && wmSource.includes("delete: (name: string, purge = false, confirm = \"\", roots?: string[])")])
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
  const clientSource = readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "web-client.js"), "utf8")
  checks.push(["client keeps NO floater fallback", !client.includes("mpd-workmate-library")
    && !client.includes("mpd-workmate-toggle")
    && !/inject\(\s*["'`]shell\.overlay["'`]/.test(clientSource)
    && !/inject\(\s*["'`]sidebar\.footer\.action["'`]/.test(clientSource)])
  // Isolation regression pin (T-60/T-21): the case must prove it never TOUCHES the real library by
  // sandboxing HOME and comparing the real listing before/after. The old assertion — the real
  // library must NOT EXIST — is false on any machine that ever used one and made the case red for
  // the environment instead of the change; it must never come back.
  const selfSource = readFileSync(join(repoRoot, "skills", "dsh-qa", "scripts", "workmate-library.mjs"), "utf8")
  // Built by concatenation so this check's own needle cannot appear in the file it scans.
  const oldAbsenceAssertion = "!" + "existsSync(realWm)"
  checks.push(["isolation = sandbox HOME + real listing unchanged (never an absence assertion)",
    selfSource.includes("realWmAfter === realWmBefore")
    && selfSource.includes("HOME: wmHome")
    && !selfSource.includes(oldAbsenceAssertion)])
  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n)
  if (bad.length) fail("self-test: " + bad.join(" | "))
  console.log("[workmate-library self-test] ok: " + checks.length + " checks")
}

function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials at " + creds)
  const realWm = join(homedir(), ".mpd", "workmate")
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "plan-f", "workmate-library", ts)
  mkdirSync(outDir, { recursive: true })
  const dshHome = mkdtempSync(join(tmpdir(), "mpd-wm-dsh-"))
  const wmHome = mkdtempSync(join(tmpdir(), "mpd-wm-home-"))
  const ws = join(wmHome, "ws")
  mkdirSync(ws, { recursive: true })
  seedSandboxCredentials(dshHome, { credentialsFile: creds })
  // Live-LLM case: a home whose keys come from gateway providers configures the model
  // chain in settings.yaml too — without it the sandbox falls back to the base
  // deepseek-official route and the run dies with MISSING_CREDENTIAL (§7).
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(dshHome, "settings.yaml"))
  writeFileSync(join(ws, "README.md"), "# my-power-dsh\nworkmate e2e workspace\n")
  const env = credentialEnv({ ...process.env, DSH_HOME: dshHome, HOME: wmHome  })
  // The invariant this case must prove is that it never TOUCHES the real library — NOT that the
  // real library is absent (it exists on any machine that ever used one; measured on this host:
  // /root/.mpd/workmate). The library under test lives under the SANDBOX HOME, and the real one is
  // snapshot before/after — the same shape workmate-team-member.mjs uses. The product resolves the
  // root as `$HOME/.mpd/workmate` (mpd-workmate src/index.ts `homeDir(): process.env.HOME || homedir()`),
  // so sandboxing HOME is what keeps it out of the real home.
  const realWmBefore = existsSync(realWm) ? readdirSync(realWm).sort().join(",") : null
  const steps = {}
  function runSync(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    return { status: r.status, out: (r.stdout || "") + (r.stderr || "") }
  }

  const inst = runSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", dshHome, "--profile", "mpd-headless", "--skip-toolchain"], { timeout: 600000 })
  steps.install = { ok: inst.status === 0, exit: inst.status }

  const dump = runSync("dsh", ["--profile", "mpd-headless", "--dump-config"], { timeout: 120000 })
  steps.dump = { ok: dump.status === 0 && dump.out.includes("id: mpd-workmate") && dump.out.includes("id: mpd-roles") && dump.out.includes("id: mpd-bootstrap"), exit: dump.status }

  // The flow assertion comes from the HARNESS session log, never from the model's prose (AGENTS.md
  // §7): the five workmate tools must have been CALLED. Measured flakiness the prose form carried:
  // 03:08Z a sample reasoned about the flow and called NO tool at all — the lane failed on
  // `out.includes("alice")`-style markers without saying which tool was missing. One bounded RETRY
  // absorbs live-model non-determinism; a flow that does not happen in either attempt is still a FAIL.
  const REQUIRED_TOOLS = ["mpd_workmate_init", "mpd_workmate_list", "mpd_workmate_spawn", "mpd_workmate_reflect", "mpd_workmate_match"]
  const wmRoot = join(wmHome, ".mpd", "workmate")
  const alice = join(wmRoot, "alice")
  const aliceFiles = ["meta.json", "persona.md", "memory.md", "note.md"]
  let out = ""
  let liveStatus = null
  let attempts = 0
  let tools = []
  let missingTools = [...REQUIRED_TOOLS]
  let filesOk = false
  let calls = {}
  const retryNotes = []
  while (attempts < 2) {
    attempts += 1
    const live = runSync("dsh", ["--profile", "mpd-headless", PROMPT], { timeout: 900000, cwd: ws })
    out = live.out
    liveStatus = live.status
    const store = readSessionEvents(dshHome, { workspace: ws })
    // CALL evidence, not availability: `recordedToolNames` reads the request header's tool LIST
    // (what the session had), while `findToolCall` joins a `tool/call` with a non-error
    // `tool/result` — the only thing that proves the workmate tools really RAN.
    tools = recordedToolNames(store.records)
    calls = Object.fromEntries(REQUIRED_TOOLS.map((name) => [name, findToolCall(store.records, name)]))
    missingTools = REQUIRED_TOOLS.filter((name) => calls[name].succeeded !== true)
    filesOk = aliceFiles.every((f) => existsSync(join(alice, f)))
    if (missingTools.length === 0 && filesOk) break
    if (attempts < 2) retryNotes.push("attempt " + attempts + " did not complete the flow (unproven tools: " + (missingTools.join(",") || "none") + "; files present: " + filesOk + ") — retrying once")
  }
  const note = existsSync(join(alice, "note.md")) ? readFileSync(join(alice, "note.md"), "utf8") : ""
  const memory = existsSync(join(alice, "memory.md")) ? readFileSync(join(alice, "memory.md"), "utf8") : ""
  let meta = {}
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

  const allOk = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, dshHome, wmHome, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out.slice(0, 40000) + "\n\n--- dump ---\n" + dump.out.slice(0, 20000))
  console.log("[workmate-library] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 260))
  if (!allOk) process.exit(1)
  console.log("[workmate-library] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
