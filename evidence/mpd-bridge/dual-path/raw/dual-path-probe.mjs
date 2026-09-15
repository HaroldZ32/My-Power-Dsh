// t38 dual-path probe — ONE sandbox DSH_HOME, TWO profiles, independent boots, and the
// sharing proofs in both directions.
//
// Sequence:
//   1) seed the shared fixtures (workspace .mpd/mpd.jsonc with a NON-default value, a
//      workmate in the shared HOME, a workspace memory file)
//   2) boot the TUI profile  -> mount, crash signatures, served corpus, agentPreset
//   3) boot the WEB profile   -> bundle route alive, session/create with agentPreset mpd,
//                                then edit the settings document through the HOST's own
//                                settings/mutate RPC (the same call any front door emits)
//   4) boot the TUI profile AGAIN -> it must observe the value the WEB front door wrote
//      into the shared settings document (cross-front-door sharing, direction web -> TUI)
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { runTuiSession, readSessionHeaders, crashSignatures } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/tui-lane.mjs"

const S = process.argv[2]        // sandbox root: <S>/dshhome, <S>/home, <S>/ws
const OUT = process.argv[3]      // evidence dir
const PORT = Number(process.argv[4] ?? 43119)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha = (p) => { try { return "sha256:" + createHash("sha256").update(readFileSync(p)).digest("hex") } catch { return null } }
const read = (p) => { try { return readFileSync(p, "utf8") } catch { return "" } }
const env = {
  ...process.env, DSH_HOME: join(S, "dshhome"), HOME: join(S, "home"),
  npm_config_cache: join(S, "npm-cache"), PNPM_HOME: join(S, "pnpm-home"),
  XDG_CONFIG_HOME: join(S, "config"), XDG_DATA_HOME: join(S, "data"),
}
const report = { sandbox: S, profileBundles: {}, fixtures: {}, boots: {}, sharing: {}, sha: {} }

// ── 1) fixtures in the SHARED workspace + HOME ──────────────────────────────
const wsMpd = join(S, "ws", ".mpd")
mkdirSync(wsMpd, { recursive: true })
const jsonc = join(wsMpd, "mpd.jsonc")
const jsoncText = '{\n  // human comment: the one file both front doors must obey\n  "hashline": {\n    "maxDiffChars": 35000,\n  },\n  "ulw": { "maxRounds": 6 },\n}\n'
writeFileSync(jsonc, jsoncText)
writeFileSync(join(wsMpd, "memory.json"), JSON.stringify({ note: "t38 shared workspace memory" }, null, 1) + "\n")
const workmateDir = join(S, "home", ".mpd", "workmate", "t38-shared")
mkdirSync(workmateDir, { recursive: true })
writeFileSync(join(workmateDir, "meta.json"), JSON.stringify({ name: "t38-shared", baseId: "architect" }, null, 1) + "\n")
report.fixtures = {
  workspaceJsonc: { path: jsonc, sha256: sha(jsonc), value: 35000 },
  workspaceMemory: { path: join(wsMpd, "memory.json"), sha256: sha(join(wsMpd, "memory.json")) },
  workmateLibrary: { path: workmateDir, homeScoped: true },
}
for (const p of ["w", "dsh-tui"]) {
  const m = JSON.parse(read(join(S, "dshhome", "profiles", p, "package.json")) || "{}")
  report.profileBundles[p] = m?.dsh?.profile?.bundles ?? m?.dsh?.bundles ?? []
}

// ── 2) TUI boot ────────────────────────────────────────────────────────────
function tuiBoot(label, outDir) {
  const session = runTuiSession({ lane: "t38-" + label, root: S, outDir, bootWaitMs: 120_000, steps: [{ name: "settled", keys: [], waitMs: 5000 }] })
  const strip = (t) => t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
  const pane = strip(session.bootPane ?? "")
  const log = session.log ?? ""
  const sessions = readSessionHeaders(S).filter((e) => String(e.projectKey ?? "").includes("dual-path"))
  const bridgeLines = (strip(log).match(/settings bridge[^\n]{0,200}/g) ?? []).slice(0, 6)
  const corpus = /\[mpd-bootstrap\] skill corpus served from ([^\s]+)/.exec(strip(log))
  return {
    tmuxFailures: session.failures,
    crashSignatures: crashSignatures(log),
    paneHasStatusLine: /mpd:\s+team /.test(pane),
    paneWorkmateCount: (/workmates?\s+(\d+)/i.exec(pane) ?? [])[1] ?? null,
    corpusServedFrom: corpus?.[1] ?? null,
    bridgeLines,
    sessions: sessions.map((e) => ({ agentPreset: e.agentPreset, cwd: e.cwd, projectKey: e.projectKey })),
    pane: pane.slice(-1200),
  }
}

// ── 3) WEB boot + host settings RPC ────────────────────────────────────────
async function webBoot() {
  const logPath = join(OUT, "boot-web.log")
  rmSync(logPath, { force: true })
  const fd = openSync(logPath, "w")
  const child = spawn("dsh", ["--profile", "w", "--port", String(PORT), "--no-open"], { env, cwd: join(S, "ws"), stdio: ["ignore", fd, fd] })
  let cookie = ""
  let token = ""
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    await sleep(1500)
    const log = read(logPath)
    const m = /token=([A-Za-z0-9_-]+)/.exec(log)
    if (m !== null) token = m[1]
    if (token !== "") {
      try {
        const auth = await fetch(`http://127.0.0.1:${PORT}/?token=${token}`, { redirect: "manual", signal: AbortSignal.timeout(8000) })
        cookie = (auth.headers.getSetCookie?.() ?? []).map((v) => v.split(";")[0]).join("; ") || cookie
        const root = await fetch(`http://127.0.0.1:${PORT}/`, { headers: cookie === "" ? {} : { cookie }, signal: AbortSignal.timeout(8000) })
        if (cookie !== "" && root.status === 200) break
      } catch { /* not serving yet */ }
    }
  }
  const rpc = async (method, args, timeout = 60000) => {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/${method.split("/")[0]}/${method.split("/")[1]}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
      body: JSON.stringify({ type: "client-request", rpcId: "t38-" + Date.now(), method, payload: { args } }),
      signal: AbortSignal.timeout(timeout),
    }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
    const envelope = await response.json().catch(() => ({}))
    return { status: response.status, result: envelope?.result ?? null, error: envelope?.error ?? null, transport: envelope?.transport ?? null }
  }
  // bundle-owned route (no session needed): proves the bundle's web rows are alive
  const route = await fetch(`http://127.0.0.1:${PORT}/plugins/mpd-workmate/list`, { signal: AbortSignal.timeout(6000) }).then((r) => ({ status: r.status })).catch((e) => ({ status: 0, error: String(e?.message ?? e) }))
  // a REAL session in the web plane: the resolved preset witness
  const session = await rpc("session/create", { request: { cwd: join(S, "ws"), agentPreset: "mpd" } }, 90000)
  // the host's own settings write, the same call any front door emits
  const settingsPath = join(S, "dshhome", "settings.yaml")
  const before = { path: settingsPath, sha256: sha(settingsPath), exists: existsSync(settingsPath) }
  const mutate = await rpc("settings/mutate", { ns: "mpd", ops: [{ op: "set", path: ["hashline", "maxDiffChars"], value: 31415 }] })
  await sleep(2500)
  const after = { path: settingsPath, sha256: sha(settingsPath), exists: existsSync(settingsPath) }
  try { child.kill("SIGTERM") } catch {}
  await sleep(2000)
  try { child.kill("SIGKILL") } catch {}
  const log = read(logPath)
  const stripLog = log.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
  return {
    cookieAcquired: cookie !== "",
    bundleRoute: route,
    sessionCreate: { status: session.status, agentPreset: session.result?.agentPreset ?? session.result?.session?.agentPreset ?? null, sessionId: session.result?.sessionId ?? session.result?.session?.id ?? null },
    settingsDocument: { before, after, changed: before.sha256 !== after.sha256 },
    mutate: { status: mutate.status, resolved: mutate.result?.value?.value ?? null, base: mutate.result?.value?.base ?? null, user: mutate.result?.value?.user ?? null, revision: mutate.result?.value?.revision ?? null },
    crashSignatures: crashSignatures(log),
    corpusServedFrom: (/\[mpd-bootstrap\] skill corpus served from ([^\s]+)/.exec(stripLog) ?? [])[1] ?? null,
    bridgeLines: (stripLog.match(/settings bridge[^\n]{0,200}/g) ?? []).slice(0, 6),
  }
}

report.boots.tui1 = tuiBoot("one", join(OUT, "tui-1"))
report.boots.web = await webBoot()
report.sha.settingsAfterWebEdit = sha(join(S, "dshhome", "settings.yaml"))
report.boots.tui2 = tuiBoot("two", join(OUT, "tui-2"))

// ── sharing summary derived from the boot artifacts ────────────────────────
const knob = (v) => JSON.stringify(v?.hashline?.maxDiffChars)
report.sharing = {
  a_presetRosterFromBundle: { web: report.profileBundles.w?.includes("@mpd-dsh/mpd"), tui: report.profileBundles["dsh-tui"]?.includes("@mpd-dsh/mpd"), note: "preset + roster are served from <bundle>/presets in both profiles (dump-config showed default: mpd + the mpd/presets root in each)" },
  b_corpus: { tui: report.boots.tui1.corpusServedFrom, web: report.boots.web.corpusServedFrom },
  c_workspaceJsonc: { file: report.fixtures.workspaceJsonc.path, sha256: report.fixtures.workspaceJsonc.sha256, webNamespaceBase: knob(report.boots.web.mutate.base), tuiBridgeLines: report.boots.tui1.bridgeLines },
  d_settingsDocument: { path: report.boots.web.settingsDocument.before.path, beforeWebEdit: report.boots.web.settingsDocument.before.sha256, afterWebEdit: report.boots.web.settingsDocument.after.sha256, visibleToTui2: report.boots.tui2.bridgeLines },
  e_homeScoped: { workmatesInTuiPane: report.boots.tui1.paneWorkmateCount, workmateLibrary: report.fixtures.workmateLibrary.path, workspaceMemory: report.fixtures.workspaceMemory.path },
}
writeFileSync(join(OUT, "dual-path.result.json"), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ tui1: report.boots.tui1.crashSignatures, web: report.boots.web.crashSignatures, tui2: report.boots.tui2.crashSignatures, webRoute: report.boots.web.bundleRoute, settingsChanged: report.boots.web.settingsDocument.changed, mutateBase: knob(report.boots.web.mutate.base), sharing: report.sharing }, null, 1))
