// t9 verification driver — REAL MOUNT of the bundle in an isolated DSH_HOME + sandbox HOME +
// sandbox WORKSPACE, with a QA probe row inserted through a `--patch` overlay.
//
// What it measures (nothing inferred from prose):
//   1. the bundle's rows (mpd-config, mpd-tui, …) apply with NO apply/schema abort — the boot
//      log is scanned for the repo's own apply-crash signatures and for the mpd-tui aggregate
//      diagnostic line;
//   2. the `mpd` settings namespace is served and carries the three team-model slots;
//   3. the intended READ surfaces answer with the schema defaults (KEYED `get("teamModels")` /
//      `get("teamModels.slot<N>")` and both `mpd_config_get` payload forms) — the parameterless
//      `get()` stays the RAW merged view BY DESIGN and is recorded as such, never as a defect;
//   4. one mutate through the adapter's settings seam lands in the resolved config, and an
//      `unset` restores the schema default.
//
// Usage: bun evidence/model-slots/settings-surfaces/<ts>/driver/t9-web-mount.mjs
// Writes result.json + output.log beside itself. Never touches the real ~/.dsh.
import { spawn } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync, closeSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { mkdtempSync } from "node:fs"
import { sandboxWorkspace } from "../../../../../skills/dsh-qa/scripts/lib/workspace-isolation.ts"
import { seedSandboxCredentials } from "../../../../../skills/dsh-qa/scripts/lib/credentials.ts"
import { APPLY_CRASH_SIGNATURES } from "../../../../../skills/dsh-qa/scripts/lib/tui-lane.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, "..")
const REPO = join(HERE, "..", "..", "..", "..", "..")
const PROBE = join(OUT_DIR, "probe", "t9-web-probe.mjs")
const PORT = Number(process.env.MPD_QA_T9_PORT ?? 3299)
const sandbox = mkdtempSync(join(tmpdir(), "mpd-t9-"))
const logPath = join(OUT_DIR, "dsh-boot.log")

const result = {
  case: "t9-settings-surfaces-web-mount",
  startedAt: new Date().toISOString(),
  repo: REPO,
  probe: PROBE,
  sandbox,
  isolation: { dshHome: null, home: null, workspace: null, sessionsSandboxed: null, note: null },
  boot: { exit: null, crashSignatures: [], mpdTuiLine: null, rowsComposed: null, aborted: false },
  probe: null,
  verdict: null,
}

function fail(message) {
  result.verdict = { ok: false, reason: message }
  finish(1)
}

function finish(code) {
  result.finishedAt = new Date().toISOString()
  writeFileSync(join(OUT_DIR, "result.json"), JSON.stringify(result, null, 2) + "\n")
  console.log("[t9-web-mount] " + JSON.stringify(result.verdict))
  process.exit(code)
}

try {
  // ── sandbox: isolated DSH_HOME, sandbox HOME, sandbox WORKSPACE ──────────────────────────
  const home = join(sandbox, "home")
  const userHome = join(sandbox, "userhome")
  const profile = join(home, "profiles", "w")
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  if (join(home).startsWith(join(homedir(), ".dsh"))) fail("isolation assertion: DSH_HOME points at the real home")
  // A checkout install IS a link: node_modules/@mpd-dsh/mpd -> the repo (what `dsh plugin add`
  // writes, and what the bundle's exports map resolves through).
  symlinkSync(REPO, join(profile, "node_modules", "@mpd-dsh", "mpd"), "dir")
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-w", private: true, dependencies: {},
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } },
  }, null, 2) + "\n")
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (existsSync(creds)) seedSandboxCredentials(home, { credentialsFile: creds })
  const qaSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(qaSettings)) copyFileSync(qaSettings, join(home, "settings.yaml"))
  const ws = sandboxWorkspace(sandbox)
  const env = { ...process.env, DSH_HOME: home, HOME: userHome }
  result.isolation = { dshHome: home, home: userHome, workspace: ws, sessionsSandboxed: null, note: "DSH_HOME + HOME + cwd are all inside the sandbox" }

  // ── the overlay that inserts the probe row ───────────────────────────────────────────────
  const overlay = join(sandbox, "t9-probe.yml")
  writeFileSync(overlay, "- insert:\n"
    + "    - id: t9-settings-probe\n"
    + "      name: " + JSON.stringify(PROBE) + "\n")

  // ── boot ─────────────────────────────────────────────────────────────────────────────────
  const fd = openSync(logPath, "w")
  const child = spawn("dsh", ["--profile", "w", "--patch", overlay, "--port", String(PORT), "--no-open"], {
    env, cwd: ws, stdio: ["ignore", fd, fd],
  })
  const readLog = () => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
  const deadline = Date.now() + 180000
  let raw = ""
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    raw = readLog()
    if (raw.includes("[t9-probe] T9_RESULT ")) break
    if (child.exitCode !== null && child.exitCode !== 0) break
  }
  const pendingExit = child.exitCode
  try { child.kill("SIGTERM") } catch { /* already gone */ }
  await new Promise((resolve) => setTimeout(resolve, 1000))
  try { child.kill("SIGKILL") } catch { /* already gone */ }
  closeSync(fd)

  raw = readLog()
  const signatureHits = APPLY_CRASH_SIGNATURES.filter((signature) => raw.includes(signature))
  const loaderAborts = ["failed to apply loader entry", "agent-preset/invalid", "esbuild", "Cannot find module"].filter((needle) => raw.includes(needle))
  const tuiLine = raw.split("\n").find((line) => line.includes("[mpd-tui]") && line.includes("seam")) ?? raw.split("\n").find((line) => line.includes("[mpd-tui]")) ?? null
  result.boot = {
    exit: pendingExit ?? null,
    crashSignatures: signatureHits,
    loaderAborts,
    mpdTuiLine: tuiLine,
    aborted: signatureHits.length > 0 || loaderAborts.length > 0,
  }

  // Composition-only row set (NEVER cited as load evidence: it does not execute plugin code).
  const dump = await new Promise((resolve) => {
    const child2 = spawn("dsh", ["--profile", "w", "--patch", overlay, "--dump-config"], { env, cwd: ws, stdio: ["ignore", "pipe", "pipe"] })
    let text = ""
    child2.stdout.on("data", (chunk) => { text += String(chunk) })
    child2.stderr.on("data", (chunk) => { text += String(chunk) })
    child2.on("close", () => resolve(text))
  })
  result.boot.rowsComposed = {
    note: "COMPOSITION ONLY — dsh --dump-config never executes plugin code; cited only to print the composed row set, never as load evidence",
    hasMpdConfig: /id:\s*mpd-config/.test(dump),
    hasMpdTui: /id:\s*mpd-tui/.test(dump),
    hasAdapter: /id:\s*mpd-dsh-adapter/.test(dump),
  }
  writeFileSync(join(OUT_DIR, "dump-config.txt"), dump)

  // ── the probe's own result line ──────────────────────────────────────────────────────────
  const match = /\[t9-probe\] T9_RESULT (\{.*\})/.exec(raw)
  if (match === null) fail("the probe never emitted T9_RESULT (see dsh-boot.log); boot exit=" + String(pendingExit))
  result.probe = JSON.parse(match[1])

  // ── isolation: no session key for the real workspace ─────────────────────────────────────
  const { assertSessionsSandboxed } = await import("../../../../../skills/dsh-qa/scripts/lib/workspace-isolation.ts")
  try {
    assertSessionsSandboxed(home, sandbox, { label: "t9-web-mount" })
    result.isolation.sessionsSandboxed = "ok: no session store key for the real checkout"
  } catch (error) {
    result.isolation.sessionsSandboxed = "FAIL: " + String(error?.message ?? error)
  }

  // ── verdict ──────────────────────────────────────────────────────────────────────────────
  const p = result.probe
  const defaults = {
    slot1: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max" },
    slot2: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" },
    slot3: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" },
  }
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok, detail })
  add("M1", !result.boot.aborted, "boot carried no apply-crash signature and no loader abort (" + JSON.stringify(signatureHits.concat(loaderAborts)) + ")")
  add("M2", result.boot.rowsComposed.hasMpdConfig && result.boot.rowsComposed.hasMpdTui, "the mpd-config and mpd-tui rows are composed in the mpd bundle patch (composition only — the LOAD proof is the probe answering + the crash-signature scan)")
  add("M3", p.adapter.found === true && p.adapter.hasSettingsReader === true && p.adapter.hasExecuteTool === true && p.adapter.hasSettingsMutate === true, "the adapter seam answered inside the boot: " + JSON.stringify(p.adapter))
  add("M4", p.namespace.revision !== null && p.namespace.revision !== undefined && Array.isArray(p.namespace.topLevelKeys) && p.namespace.topLevelKeys.includes("teamModels"), "the served `mpd` namespace descriptor carries teamModels (revision " + String(p.namespace.revision) + ")")
  const ninePaths = ["teamModels.slot1.model", "teamModels.slot1.provider", "teamModels.slot1.reasoningEffort", "teamModels.slot2.model", "teamModels.slot2.provider", "teamModels.slot2.reasoningEffort", "teamModels.slot3.model", "teamModels.slot3.provider", "teamModels.slot3.reasoningEffort"].sort()
  add("M4b", JSON.stringify(p.namespace.slotPaths) === JSON.stringify(ninePaths), "the SERVED namespace descriptor reports exactly the NINE new slot knobs: " + JSON.stringify(p.namespace.slotPaths))
  for (const slot of ["slot1", "slot2", "slot3"]) {
    add("M5." + slot, JSON.stringify(p.service["keyed_" + slot]) === JSON.stringify(defaults[slot]), "keyed service read get(\"teamModels." + slot + "\") = " + JSON.stringify(p.service["keyed_" + slot]))
  }
  // The tool RESULT the adapter hands back is the tool's OUTPUT payload, whose keyed form nests the
  // value under `value` (and whose no-key form nests the config under `config`) — asserted at that
  // depth deliberately, so the shape is part of the measurement rather than an assumption.
  add("M6", JSON.stringify(p.tool.keyedTeamModels?.value?.value) === JSON.stringify({ slot1: defaults.slot1, slot2: defaults.slot2, slot3: defaults.slot3 }), "mpd_config_get({key:\"teamModels\"}) payload.value = " + JSON.stringify(p.tool.keyedTeamModels?.value?.value))
  add("M7", JSON.stringify(p.tool.noKey?.value?.config?.teamModels) === JSON.stringify({ slot1: defaults.slot1, slot2: defaults.slot2, slot3: defaults.slot3 }), "mpd_config_get({}) payload.config.teamModels = " + JSON.stringify(p.tool.noKey?.value?.config?.teamModels))
  add("M8", p.service.rawNoKeyHasTeamModels === false, "NEGATIVE CONTROL: the parameterless get() is the RAW merged view and does NOT materialise teamModels (documented asymmetry, not a defect)")
  const mutated = p.mutate?.result
  add("M9", mutated?.ok === true, "settingsMutate(\"mpd\", set teamModels.slot1.{provider,model,reasoningEffort}) = " + JSON.stringify(mutated))
  const after = p.mutate?.toolAfter?.value
  add("M10", after?.model === "t9-probe-model" && after?.provider === "t9-probe-provider" && after?.reasoningEffort === "low", "the mutated values are the RESOLVED config after the write: " + JSON.stringify(after))
  add("M11", p.mutate?.serviceAfter?.model === "t9-probe-model" && p.mutate?.namespaceAfter?.model === "t9-probe-model", "the keyed service read and the namespace descriptor agree after the mutate: service " + JSON.stringify(p.mutate?.serviceAfter))
  add("M12", JSON.stringify(p.mutate?.slot2After) === JSON.stringify(defaults.slot2) && JSON.stringify(p.mutate?.slot3After) === JSON.stringify(defaults.slot3), "the untouched slots kept their defaults across the mutate")
  const restored = p.afterUnset?.toolAfter?.value
  add("M13", p.afterUnset?.result?.ok === true && JSON.stringify(restored) === JSON.stringify(defaults.slot1), "after the unset the schema default is back on the tool surface: " + JSON.stringify(restored))
  add("M14", (p.errors ?? []).length === 0, "the probe recorded no error: " + JSON.stringify(p.errors ?? []))
  result.verdict = { ok: checks.every((check) => check.ok), checks, failed: checks.filter((check) => !check.ok).map((check) => check.id) }
  writeFileSync(join(OUT_DIR, "mount-checks.json"), JSON.stringify(checks, null, 2) + "\n")
  finish(result.verdict.ok ? 0 : 1)
} catch (error) {
  fail("driver crash: " + String(error?.stack ?? error))
}
