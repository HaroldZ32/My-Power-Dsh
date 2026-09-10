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
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

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
  // Sidebar surface: the library is contributed as a DSH-better-sidebar tab, so the
  // host must publish the roster + detail routes the tab reads and the client must
  // register that tab through the sidebar service.
  const wmSource = readFileSync(join(repoRoot, "packages", "mpd-workmate-plugin", "src", "index.ts"), "utf8")
  checks.push(["host roster route", wmSource.includes('path: "/plugins/mpd-workmate/roster"') && wmSource.includes('ctx.get ? ctx.get("mpdRoles") : undefined')])
  checks.push(["host detail route", wmSource.includes('path: "/plugins/mpd-workmate/get"') && wmSource.includes("workmateLibrary.read(name)")])
  const client = readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "client.js"), "utf8")
  checks.push(["client registers a better-sidebar tab", client.includes('const SIDEBAR_TAB_ID = "mpd-workmate"')
    && client.includes("sidebar.registerTab") && client.includes("registerSidebarTab")])
  checks.push(["client keeps a floater fallback", client.includes("better-sidebar not installed")
    && client.includes('inject("shell.overlay"') && client.includes('inject("sidebar.footer.action"')])
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
  cpSync(creds, join(dshHome, ".credentials.yaml"))
  // Live-LLM case: a home whose keys come from gateway providers configures the model
  // chain in settings.yaml too — without it the sandbox falls back to the base
  // deepseek-official route and the run dies with MISSING_CREDENTIAL (§7).
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(dshHome, "settings.yaml"))
  writeFileSync(join(ws, "README.md"), "# my-power-dsh\nworkmate e2e workspace\n")
  const env = { ...process.env, DSH_HOME: dshHome, HOME: wmHome }
  const steps = {}
  function runSync(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    return { status: r.status, out: (r.stdout || "") + (r.stderr || "") }
  }

  const inst = runSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", dshHome, "--profile", "mpd-headless", "--skip-toolchain"], { timeout: 600000 })
  steps.install = { ok: inst.status === 0, exit: inst.status }

  const dump = runSync("dsh", ["--profile", "mpd-headless", "--dump-config"], { timeout: 120000 })
  steps.dump = { ok: dump.status === 0 && dump.out.includes("id: mpd-workmate") && dump.out.includes("id: mpd-roles") && dump.out.includes("id: mpd-bootstrap"), exit: dump.status }

  const live = runSync("dsh", ["--profile", "mpd-headless", PROMPT], { timeout: 900000, cwd: ws })
  const out = live.out
  const wmRoot = join(wmHome, ".mpd", "workmate")
  const alice = join(wmRoot, "alice")
  const filesOk = ["meta.json", "persona.md", "memory.md", "note.md"].every((f) => existsSync(join(alice, f)))
  const note = existsSync(join(alice, "note.md")) ? readFileSync(join(alice, "note.md"), "utf8") : ""
  steps.live = { ok: live.status === 0 && !out.includes("ERR_MODULE_NOT_FOUND"), exit: live.status }
  steps.flow = { ok: out.includes("alice") && out.includes("initialized") && out.includes("DONE") && out.includes("MATCHED"), sample: out.slice(-1500).replace(/\n/g, " | ").slice(0, 600) }
  steps.files = { ok: filesOk && (note.includes("Verilog") || note.includes("counter")), note: note.slice(0, 160), wmRoot }
  steps.isolation = { ok: !existsSync(realWm), realWm }

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
