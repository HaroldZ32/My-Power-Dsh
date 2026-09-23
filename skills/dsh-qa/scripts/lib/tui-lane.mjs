// Shared helpers for the five dsh-TUI QA lanes (t7).
//
// Measured constraints every lane here obeys (`.mpd/recon/CAPTAIN-RECON.md` §2/§5):
//   • the real TUI must boot WITHOUT a pipe on stdout — a pipe makes stdout a
//     non-TTY and the host refuses with `dsh-tui requires an interactive terminal`,
//     so every live lane boots inside tmux and captures with `capture-pane -p -J`
//     plus a `pipe-pane` raw ANSI log;
//   • a tmux server does not survive across shell invocations, so ONE process owns
//     the whole lifecycle (spawn, drive, capture, kill);
//   • `dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui@0.10.1` needs
//     network on first run, so the lanes take an EXPLICIT sandbox/cache root
//     (`--sandbox-root`, recorded in every result) and reuse a warm profile instead
//     of reinstalling: a verification run that is handed a different root proves it
//     by the recorded path, and a root without a profile is a SKIP, not a silent
//     install.
//
// Nothing here re-implements upstream logic: the admission lane imports the HOST's
// own pinned `@dsh-std/manifest` + `lib/types/adapter/standard/*`, and the
// conformance lane reads the host submodule's own `requirements-v0.15.json`.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { DSH_MISSING, dshCommand } from "./dsh-launcher.mjs"

export const REPO = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))))

/** Apply-crash signatures: a boot log carrying one of these did NOT load the tree. */
export const APPLY_CRASH_SIGNATURES = [
  "unsupported JSON schema",
  "JsonSchemaError",
  "plugin tree failed to load",
  "failed to apply loader entry",
  "duplicate loader entry id",
]

/**
 * Structural rules of the Community v0.15 manifest that OUR lane asserts on top of
 * the pinned parser (pure, so the self-test can falsify them): the schema rejects
 * `provides` / `requires.services` / client+worker facets, and an optional contract
 * must carry a written fallback.
 */
export function structuralFindings(manifest) {
  const findings = []
  if (manifest?.manifestVersion !== "0.15") findings.push("manifestVersion must be 0.15")
  if (typeof manifest?.id !== "string" || manifest.id.length === 0) findings.push("a stable plugin id is required")
  if (manifest?.facets?.host === undefined) findings.push("facets.host is required")
  if (manifest?.facets?.client !== undefined || manifest?.facets?.worker !== undefined) findings.push("client/worker facets are rejected in v0.15")
  if (Object.hasOwn(manifest ?? {}, "provides")) findings.push("`provides` is rejected in v0.15")
  if (manifest?.requires !== undefined && Object.hasOwn(manifest.requires, "services")) findings.push("`requires.services` is rejected in v0.15")
  const contracts = Array.isArray(manifest?.requires?.contracts) ? manifest.requires.contracts : []
  for (const contract of contracts.filter((entry) => entry?.optional === true)) {
    if (typeof contract.fallback !== "string" || contract.fallback.length === 0) {
      findings.push("an optional contract needs a written fallback: " + JSON.stringify(contract))
    }
  }
  const decision = contracts.find((entry) => String(entry?.kind ?? "").includes("DecisionEvents"))
  if (decision !== undefined && decision.optional !== true) findings.push("the decision-event contract must stay OPTIONAL with a fallback")
  return findings
}

/** The plugin build every lane measures: the dist entry the bundle row resolves. */
export const DIST_ARTIFACT = "packages/mpd-tui-plugin/dist/index.js"

/** The bundle-level manifest whose digest every admission-reading lane records. */
export const MANIFEST_ARTIFACT = "dsh-plugin.json"

export function distPath() {
  return join(REPO, DIST_ARTIFACT)
}

export function manifestPath() {
  return join(REPO, MANIFEST_ARTIFACT)
}

/**
 * The measured artifact revision, in t8's shape ({path, sha256, bytes, mtime}) —
 * raw hex for the digest, both mtime spellings so a reader can order runs without
 * knowing the container timezone.
 */
export function artifactRevision(path = distPath()) {
  if (!existsSync(path)) return { path: path.replace(REPO + "/", ""), sha256: undefined, bytes: undefined, missing: true }
  const stat = statSync(path)
  return {
    path: path.replace(REPO + "/", ""),
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    bytes: stat.size,
    mtimeLocal: stat.mtime.toISOString(),
    mtimeUtc: stat.mtime.toISOString(),
  }
}

/** The manifest digest, or undefined when the manifest is absent. */
export function manifestDigest() {
  const path = manifestPath()
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : undefined
}

/**
 * A lane must FAIL LOUDLY when its subject moved under it: a digest that changed
 * between the start of the run and the evidence write means the result describes
 * neither revision (t8's F5 gap, measured this wave).
 */
export function revisionDelta(before, after) {
  const changed = before?.sha256 !== after?.sha256
  return {
    changed,
    before: before?.sha256,
    after: after?.sha256,
    reason: changed
      ? "the measured artifact changed DURING the run (" + String(before?.sha256).slice(0, 12) + " -> " + String(after?.sha256).slice(0, 12) + "); this result describes neither revision"
      : "unchanged across the run",
  }
}

/** Write the t8-shaped REVISION.json beside a lane result. */
export function writeRevisionFile(outDir, { before, after, composition, proof }) {
  const delta = revisionDelta(before, after)
  const body = {
    measuredBy: "Lead (t26)",
    artifact: after,
    proofThisIsWhatTheLaneRan: proof ?? [
      "the recorded mtime precedes this run's evidence timestamp",
      "the digest was re-measured at evidence-write time and matches the start-of-run measurement",
    ],
    composition: composition ?? {},
    delta,
  }
  const file = join(outDir, "REVISION.json")
  writeFileSync(file, JSON.stringify(body, null, 2) + "\n")
  return { file, delta, after }
}

/** Session-event types the sandbox store carries, with the raw line count. */
export function readUserMessages(root, limit = 200) {
  const dir = join(root, "dshhome", "sessions", sandboxProjectKey(root))
  const messages = []
  if (!existsSync(dir)) return messages
  for (const id of readdirSync(dir)) {
    const file = join(dir, id, "session.v3.jsonl.zstd")
    if (!existsSync(file)) continue
    for (const line of decompressAllFrames(file).split("\n")) {
      if (!line.startsWith('{"type":"user/message"')) continue
      try {
        const record = JSON.parse(line)
        const content = Array.isArray(record.data?.content) ? record.data.content : []
        const text = content.filter((part) => part?.type === "text").map((part) => String(part.text ?? "")).join("\n")
        messages.push({ sessionId: id, seq: record.seq, text: text.slice(0, 2000) })
      } catch {
        // A malformed record is surfaced by its absence, never counted as a pass.
      }
      if (messages.length >= limit) return messages
    }
  }
  return messages
}

export function sha256File(path) {
  return "sha256:" + createHash("sha256").update(readFileSync(path)).digest("hex")
}

export function sha256Text(text) {
  return "sha256:" + createHash("sha256").update(text).digest("hex")
}

/**
 * Resolve a BARE command name on PATH, without a shell.
 *
 * `spawnSync("bash", ["-lc", "command -v X"])` is a POSIX-only shape: a stock win32 host may
 * have no `bash` at all (and where the `sh` that answers is Git Bash it resolves a different
 * PATH than the host), so the lane would call an installed tool ABSENT. Measured 2026-09-22.
 * win32 resolves a bare name through %PATHEXT%: `tmux.exe` and a `dsh-tui.cmd` shim count, and
 * `spawn` accepts both of those names as the child command.
 * @param {string} command @returns {string|null}
 */
export function onPath(command) {
  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ".bat", ".com", ""] : [""]
  for (const dir of String(process.env.PATH ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    for (const suffix of suffixes) {
      const candidate = join(dir, command + suffix)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** The installed `@deepseek-harness-tui/dsh-tui` payload (the pinned host). */
export function resolveHostRoot() {
  const viaEnv = process.env.DSH_TUI_ROOT
  if (typeof viaEnv === "string" && viaEnv.length > 0) return realpathSync(viaEnv)
  const bin = onPath("dsh-tui")
  if (bin === null) return undefined
  try {
    // <root>/bin/dsh-tui.js (or a symlinked bin) -> <root>
    const real = realpathSync(bin)
    return dirname(dirname(real))
  } catch {
    return undefined
  }
}

export function tuiBinaryPresent() {
  return onPath("dsh-tui") !== null
}

export function tmuxPresent() {
  return onPath("tmux") !== null
}

/**
 * The path of the host's own `dsh-ecosystem-spec` CHECKOUT, when this host can have one.
 *
 * The recorded location is a POSIX absolute path (`/root/dshProj/tui/dsh-TUI/dsh-ecosystem-spec`).
 * That spelling cannot name a checkout on win32 — `join("/root/...")` answers `C:\root\...`, a
 * place no checkout lives — so the literal is offered on POSIX only, and `MPD_TUI_SPEC_ROOT` (the
 * variable the spec-conformance lane already reads) names the checkout on any host. `undefined`
 * means "no recorded location on this host", i.e. an ABSENT EXTERNAL FIXTURE: the lanes report it
 * as a declared skip (a FAIL under `--no-skip`), never as a red of their own logic.
 */
export function resolveSpecCheckout() {
  const viaEnv = process.env.MPD_TUI_SPEC_ROOT
  if (typeof viaEnv === "string" && viaEnv.length > 0) return viaEnv
  if (process.platform === "win32") return undefined
  return "/root/dshProj/tui/dsh-TUI/dsh-ecosystem-spec"
}

/**
 * The spec-data root CANDIDATES, in resolution order, with `undefined` entries dropped.
 *
 * Exported so a caller can tell "no candidate exists on this host" (an absent fixture — a declared
 * skip) from "a candidate exists but does not carry the registry" (a real red) without re-deriving
 * the list: that distinction is what the lanes' skip/FAIL arms are built on.
 */
export function specDataRootCandidates(hostRoot) {
  return [
    { kind: "installed-payload", dir: hostRoot === undefined ? undefined : join(hostRoot, "dsh-ecosystem-spec") },
    { kind: "user-checkout", dir: resolveSpecCheckout() },
  ].filter((candidate) => candidate.dir !== undefined)
}

/**
 * The spec-data root the admission lane must use: the INSTALLED payload's
 * `dsh-ecosystem-spec/` first (that is the copy the running host resolves), then
 * the populated user checkout. `.mpd/recon/dsh-TUI/` is deliberately NEVER used —
 * that clone's spec directory is empty (CAPTAIN-RECON §6, re-measured).
 */
export function resolveSpecDataRoot(hostRoot) {
  for (const candidate of specDataRootCandidates(hostRoot)) {
    if (existsSync(join(candidate.dir, "registry", "registry-0.15.json"))) {
      return { ...candidate, registrySha256: sha256File(join(candidate.dir, "registry", "registry-0.15.json")) }
    }
  }
  return undefined
}

/** Parse `--sandbox-root <path>` / `--sandbox-root=<path>` / `--fresh`. */
export function parseSandboxArgs(argv, lane) {
  let root
  let fresh = false
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--sandbox-root") { root = argv[++i]; continue }
    if (arg.startsWith("--sandbox-root=")) { root = arg.slice("--sandbox-root=".length); continue }
    if (arg === "--fresh") { fresh = true; continue }
    rest.push(arg)
  }
  const resolvedRoot = resolve(root ?? join(REPO, ".mpd", "recon", "qa", "tui-lanes", lane))
  if (fresh) rmSync(resolvedRoot, { recursive: true, force: true })
  for (const dir of ["dshhome", "home", "npm-cache", "pnpm-home", "config", "data", "ws"]) {
    mkdirSync(join(resolvedRoot, dir), { recursive: true })
  }
  return { root: resolvedRoot, fresh, rest, explicit: root !== undefined }
}

/**
 * The sandbox environment for every dsh / dsh-tui spawn: DSH_HOME, HOME, the npm
 * and pnpm caches, XDG dirs, ALL inside the workspace (`/root/.npm` is read-only).
 * No real `~/.dsh` or `~/.dsh-tui` is ever touched.
 */
export function sandboxEnv(root, extra = {}) {
  return {
    ...process.env,
    DSH_HOME: join(root, "dshhome"),
    HOME: join(root, "home"),
    npm_config_cache: join(root, "npm-cache"),
    PNPM_HOME: join(root, "pnpm-home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    TERM: "xterm-256color",
    NO_COLOR: "1",
    ...extra,
  }
}

/** The `dsh-tui` profile state inside a sandbox root. */
export function profileState(root) {
  const profileDir = join(root, "dshhome", "profiles", "dsh-tui")
  const manifestPath = join(profileDir, "package.json")
  if (!existsSync(manifestPath)) return { present: false, profileDir, bundles: [] }
  let manifest = {}
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")) } catch { manifest = {} }
  const bundles = manifest?.dsh?.profile?.bundles ?? manifest?.dsh?.bundles ?? []
  return {
    present: true,
    profileDir,
    bundles: Array.isArray(bundles) ? bundles : [],
    hasHost: (bundles ?? []).includes("@deepseek-harness-tui/dsh-tui"),
    hasBundle: (bundles ?? []).includes("@mpd-dsh/mpd"),
  }
}

/** Run a command inside the sandbox and capture stdout/stderr/status. */
export function runInSandbox(root, command, args, { cwd, timeoutMs = 900_000, extraEnv = {} } = {}) {
  // `command` may be the bare launcher name (`"dsh"`), which is not portable: see lib/dsh-launcher.mjs.
  const spec = command === "dsh" ? dshCommand(args) : { command, args }
  if (spec === null) return { status: null, stdout: "", stderr: DSH_MISSING, error: DSH_MISSING }
  const run = spawnSync(spec.command, spec.args, {
    cwd: cwd ?? join(root, "ws"),
    env: sandboxEnv(root, extraEnv),
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    timeout: timeoutMs,
  })
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "", error: run.error?.message }
}

/** `dsh --profile dsh-tui --dump-config` (COMPOSITION only — never a load proof). */
export function dumpConfig(root, extraArgs = []) {
  // T-69: compose through the wrapper (absolute path, so a sandbox cwd still resolves it).
  return runInSandbox(root, process.execPath, [join(REPO, "scripts", "dump-config.mjs"), "--profile", "dsh-tui", "--json", ...extraArgs], { timeoutMs: 180_000 })
}

/** The `dsh.profile.bundles` list out of a dump-config text. */
export function extractBundles(dumpText) {
  const match = dumpText.match(/bundles:\s*\[([^\]]*)\]/)
  if (match === null) return []
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1])
}

/** Apply-crash signatures present in a boot log (never on the model's prose). */
export function crashSignatures(logText) {
  return APPLY_CRASH_SIGNATURES.filter((signature) => logText.includes(signature))
}

/**
 * Classify the host's own `/plugins check` pane (AC-9).
 *
 * Acceptable: `compatible`, `compatible_degraded`, or the explainable
 * `waiting_authorization` (a declared permission is deny-defaulted with no grant
 * row — `negotiate()` → PERMISSION_NOT_GRANTED; `admitInternal` accepts only the
 * first two, so this state is reported, never silently upgraded).
 * Forbidden: the parse/schema/semantic/spec-data failure family, each of which
 * would otherwise sail through a loose "known outcome" wording.
 */
export const ADMISSION_FORBIDDEN = [
  { marker: "Not parseable JSON", code: "plugins-check-invalid-json" },
  { marker: "不是可解析的 JSON", code: "plugins-check-invalid-json" },
  { marker: "Schema validation failed", code: "plugins-check-schema-failed" },
  { marker: "schema 校验失败", code: "plugins-check-schema-failed" },
  { marker: "Semantic validation failed", code: "plugins-check-invalid" },
  { marker: "语义校验失败", code: "plugins-check-invalid" },
  { marker: "Vendored spec data unavailable", code: "plugins-check-spec-unavailable" },
  { marker: "vendored 规范数据不可用", code: "plugins-check-spec-unavailable" },
]

export function classifyAdmissionPane(paneText) {
  const forbidden = ADMISSION_FORBIDDEN.filter((entry) => paneText.includes(entry.marker)).map((entry) => entry.code)
  const decision = paneText.match(/Negotiation decision:\s*([a-z_]+)/) ?? paneText.match(/协商结果：\s*([a-z_]+)/)
  const state = decision === null ? undefined : decision[1]
  const acceptable = state === "compatible" || state === "compatible_degraded" || state === "waiting_authorization"
  return {
    ok: forbidden.length === 0 && acceptable,
    state,
    acceptable,
    forbidden: [...new Set(forbidden)],
    reason: forbidden.length > 0
      ? "the pane carries a forbidden failure state: " + [...new Set(forbidden)].join(",")
      : acceptable
        ? "state " + state
        : "no acceptable five-state outcome in the pane (expected compatible | compatible_degraded | waiting_authorization)",
  }
}

/** tmux helpers — every call targets a PRIVATE socket, so lanes never collide. */
export function tmux(socket, args, { timeoutMs = 60_000 } = {}) {
  const run = spawnSync("tmux", ["-S", socket, ...args], { encoding: "utf8", timeout: timeoutMs })
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" }
}

/**
 * Boot the real TUI inside tmux, drive it, capture, kill — inside THIS process.
 *
 * @param options.lane - lane slug (socket name + evidence labels).
 * @param options.root - sandbox root (recorded in the result).
 * @param options.outDir - evidence directory for the panes/log.
 * @param options.steps - `{ name, keys: string[], waitMs }`; `keys` are tmux
 *   `send-keys` arguments (a literal string, or `Enter`/`Escape`/`M-w`).
 * @param options.bootWaitMs - how long the first boot may take.
 */
export function runTuiSession({ lane, root, outDir, steps = [], bootWaitMs = 90_000, readyPattern = /❯|esc to interrupt|按 Esc/ }) {
  mkdirSync(outDir, { recursive: true })
  const socket = join(root, lane + ".sock")
  const logFile = join(outDir, "tui-pane.log")
  const panes = []
  const failures = []
  rmSync(socket, { force: true })
  tmux(socket, ["kill-server"])
  writeFileSync(logFile, "")

  const created = tmux(socket, ["-f", "/dev/null", "new-session", "-d", "-s", "tui", "-x", "220", "-y", "50", "-c", join(root, "ws")])
  if (created.status !== 0) failures.push("tmux new-session failed: " + created.stderr.trim())
  tmux(socket, ["pipe-pane", "-t", "tui", "-o", "cat > '" + logFile + "'"])

  const env = sandboxEnv(root)
  const envArgs = ["PATH=" + env.PATH, "DSH_HOME=" + env.DSH_HOME, "HOME=" + env.HOME,
    "npm_config_cache=" + env.npm_config_cache, "PNPM_HOME=" + env.PNPM_HOME,
    "XDG_CONFIG_HOME=" + env.XDG_CONFIG_HOME, "XDG_DATA_HOME=" + env.XDG_DATA_HOME,
    // The host resolves the session workspace from `config.workspace ??
    // DSH_TUI_WORKSPACE_TARGET` (src/dsh-adapter/plugin.ts:391) and its own CLI sets
    // that key (bin/dsh-tui.js:589-593) — measured: without it the TUI session ran with
    // the REPO as cwd, so workspace-scoped state (and the session-store key) escaped the
    // sandbox even though DSH_HOME/HOME pointed inside it.
    "DSH_TUI_WORKSPACE_TARGET=" + join(root, "ws"),
    "TERM=xterm-256color"]
  const boot = "env -i " + envArgs.map((entry) => "'" + entry + "'").join(" ") + " dsh-tui"
  tmux(socket, ["send-keys", "-t", "tui", boot, "Enter"])

  const capture = (name) => {
    const run = tmux(socket, ["capture-pane", "-p", "-J", "-t", "tui"])
    const file = join(outDir, name + ".pane.txt")
    writeFileSync(file, run.stdout)
    panes.push({ name, file, text: run.stdout })
    return run.stdout
  }

  // Wait for the CHAT screen (the prompt box), not merely for the splash: the
  // plugin status line and every seam surface render with the chat screen, so a
  // capture taken during the splash would report a false absence.
  const deadline = Date.now() + bootWaitMs
  let ready = false
  while (Date.now() < deadline) {
    const probe = tmux(socket, ["capture-pane", "-p", "-J", "-t", "tui"])
    if (readyPattern.test(probe.stdout)) { ready = true; break }
    sleepMs(2000)
  }
  if (!ready) failures.push("the TUI did not reach the chat screen within " + bootWaitMs + "ms (readiness pattern " + String(readyPattern) + ")")
  sleepMs(3000)
  const bootPane = capture("boot")

  for (const step of steps) {
    // Additive (tui-team-surface): a step may need to change the SANDBOX between the
    // boot and its own keystrokes — e.g. write the staged team record with the live
    // session id this boot just produced, so the surface meets a record that names a
    // captain which is actually attached. Absent for every other lane: no behaviour
    // change. A throwing hook is contained so it can never kill the tmux lifecycle.
    if (typeof step.before === "function") {
      try { step.before() } catch (error) { failures.push("step " + step.name + " before() failed: " + String(error?.message ?? error)) }
    }
    for (const key of step.keys) tmux(socket, ["send-keys", "-t", "tui", key])
    sleepMs(step.waitMs ?? 4000)
    capture(step.name)
  }

  // Raw ANSI log + a plain-text pane stream are both kept: the log proves what the
  // terminal actually received, the captures are what the reviewer reads.
  tmux(socket, ["kill-server"])
  rmSync(socket, { force: true })
  const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : ""
  return { panes, bootPane, log, logFile, failures, socket }
}

export function sleepMs(ms) {
  // Synchronous by design: the whole tmux lifecycle must stay inside one process,
  // and every step boundary is a real wait for the host to repaint.
  const shared = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(shared), 0, 0, ms)
}

/** The bound assertion collector every lane uses for its offline self-test. */
export function makeChecks() {
  const problems = []
  return {
    check(condition, message) { if (!condition) problems.push(message); return condition },
    problems,
  }
}

/** Evidence writer shared by all five lanes (result.json + output.log + raw/). */
export function writeLaneEvidence(outDir, slug, payload, logText) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ slug, ...payload }, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), logText + "\n")
  console.log("[" + slug + "] ok=" + payload.ok + " -> " + outDir)
  return payload.ok
}

/** `<repo>/evidence/tui/lanes/<timestamp>/` — the evidence root of every lane. */
export function laneEvidenceDir(lane) {
  const stamp = new Date().toISOString().replaceAll(":", "-")
  const dir = join(REPO, "evidence", "tui", "lanes", stamp)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "lane.txt"), lane + "\n")
  return dir
}

/** One `[mpd-qa] SKIP|FAIL …` marker line, exactly one per invocation. */
export function emitMarker(kind, slug, reason, probe, remedy) {
  console.log("[mpd-qa] " + kind + " case=" + slug + " lane=real reason=" + reason + " prereq=" + probe + ' remedy="' + remedy + '"')
}

/** Declared prerequisites, in check order. */
export function tuiPrereqs({ sandboxPresent }) {
  return [
    { code: "absent-dsh-binary", probe: "dsh-tui", remedy: "npm i -g @deepseek-harness-tui/dsh-tui@0.10.1", present: tuiBinaryPresent },
    { code: "absent-runtime", probe: "tmux", remedy: "apt-get install tmux (a real TTY is required; stdout must not be a pipe)", present: tmuxPresent },
    { code: "absent-fixture", probe: "tui profile in the sandbox root", remedy: "bun skills/dsh-qa/scripts/tui-mount.mjs --sandbox-root <root> --install", present: sandboxPresent },
  ]
}

/**
 * Prerequisite gate.
 *
 * Rule (T8-F1, adopted shape): a SKIP is legitimate only when the caller did NOT
 * ask for the missing thing. `--no-skip` still forces a failure for every absent
 * prerequisite; `requested` names the codes the caller explicitly asked for (e.g.
 * `--install` for `absent-fixture`), and those FAIL loudly with a named reason
 * instead of exiting green — a silent skip of a REQUESTED action is the defect this
 * closed.
 */
export function gateTuiPrereqs(slug, prereqs, { requested = [] } = {}) {
  const strict = process.argv.includes("--no-skip")
  for (const prereq of prereqs) {
    if (prereq.present()) continue
    const asked = requested.includes(prereq.code)
    const kind = (strict || asked) ? "FAIL" : "SKIP"
    emitMarker(kind, slug, asked ? "requested-" + prereq.code : prereq.code, prereq.probe, prereq.remedy)
    process.exit((strict || asked) ? 1 : 0)
  }
}

/** Decode the sandbox session store's header records (the preset witness, AC-11). */
export function readSessionHeaders(root, { limit = 1000, projectKey: onlyKey } = {}) {
  const sessionsRoot = join(root, "dshhome", "sessions")
  const out = []
  if (!existsSync(sessionsRoot)) return out
  // The cap must never decide WHICH key is read first: a warm shared root holds many
  // sessions under the real-repo key, and a low limit plus readdir order once hid the
  // run's own sandbox-keyed session (measured 2026-09-15: preset witness undefined).
  for (const key of readdirSync(sessionsRoot)) {
    if (onlyKey !== undefined && key !== onlyKey) continue
    const keyDir = join(sessionsRoot, key)
    if (!statSync(keyDir).isDirectory()) continue
    for (const id of readdirSync(keyDir)) {
      const file = join(keyDir, id, "session.v3.jsonl.zstd")
      if (!existsSync(file)) continue
      const text = decompressAllFrames(file)
      const header = text.split("\n").find((line) => line.startsWith('{"type":"session"'))
      if (header === undefined) continue
      try {
        const record = JSON.parse(header)
        out.push({
          projectKey: key,
          sessionId: id,
          file,
          sha256: sha256File(file),
          mtimeMs: statSync(file).mtimeMs,
          agentPreset: record.agentPreset,
          cwd: record.cwd,
        })
      } catch {
        // A malformed header is reported by its absence, never silently as a pass.
      }
      if (out.length >= limit) return out
    }
  }
  return out
}

/**
 * Decompress a CONCATENATED-ZSTD-FRAME store: one `zstdDecompressSync` call
 * returns only the first frame (the header), so the frames are located with the
 * same structure-only scan the harness uses.
 */
const dumpJsonText = (text) => { try { return JSON.parse(text).stdout ?? "" } catch { return String(text ?? "") } }
function decompressAllFrames(file) {
  const buffer = readFileSync(file)
  const frames = []
  let offset = 0
  while (offset + 4 <= buffer.length) {
    // Zstandard frame magic 0x28 0xB5 0x2F 0xFD, little-endian in the stream.
    if (buffer[offset] === 0x28 && buffer[offset + 1] === 0xb5 && buffer[offset + 2] === 0x2f && buffer[offset + 3] === 0xfd) {
      frames.push(offset)
    }
    offset += 1
  }
  const pieces = []
  for (let i = 0; i < frames.length; i++) {
    const start = frames[i]
    const end = i + 1 < frames.length ? frames[i + 1] : buffer.length
    try {
      pieces.push(require("node:zlib").zstdDecompressSync(buffer.subarray(start, end)).toString("utf8"))
    } catch {
      // A truncated tail frame is normal for a live store; earlier frames stand.
    }
  }
  if (pieces.length > 0) return pieces.join("")
  try {
    return require("node:zlib").zstdDecompressSync(buffer).toString("utf8")
  } catch {
    const run = spawnSync("zstd", ["-dc", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    return run.stdout ?? ""
  }
}

// `require` is not defined in ESM; bind it once for the zstd calls above.
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)

/** Count occurrences of one session event type in the sandbox-keyed store. */
export function countSessionEvents(root, type) {
  const dir = join(root, "dshhome", "sessions", sandboxProjectKey(root))
  if (!existsSync(dir)) return { count: 0, sessions: [] }
  let count = 0
  const sessions = []
  for (const id of readdirSync(dir)) {
    const file = join(dir, id, "session.v3.jsonl.zstd")
    if (!existsSync(file)) continue
    const text = decompressAllFrames(file)
    const hits = text.split("\n").filter((line) => line.includes('"' + type + '"')).length
    if (hits > 0) { count += hits; sessions.push({ sessionId: id, sha256: sha256File(file), hits }) }
  }
  return { count, sessions }
}

/**
 * The harness's own record of a command invocation and its result
 * (`command/run` + `command/done`) from the sandbox-keyed store — the ground truth
 * the dsh-qa doctrine requires instead of reading the model's prose or a pane.
 */
export function readCommandRecords(root) {
  const dir = join(root, "dshhome", "sessions", sandboxProjectKey(root))
  const runs = []
  const dones = []
  if (!existsSync(dir)) return { runs, dones }
  for (const id of readdirSync(dir)) {
    const file = join(dir, id, "session.v3.jsonl.zstd")
    if (!existsSync(file)) continue
    for (const line of decompressAllFrames(file).split("\n")) {
      if (!line.startsWith('{"type":"command/')) continue
      try {
        const record = JSON.parse(line)
        if (record.type === "command/run") runs.push({ sessionId: id, name: record.data?.name, args: record.data?.args })
        if (record.type === "command/done") dones.push({ sessionId: id, commandId: record.data?.commandId, kind: record.data?.kind, text: record.data?.text })
      } catch {
        // A malformed record is surfaced by its absence, never counted as a success.
      }
    }
  }
  return { runs, dones }
}

/** Every session-store project key present in this sandbox's DSH_HOME. */
export function sessionStoreKeys(root) {
  const sessionsRoot = join(root, "dshhome", "sessions")
  return existsSync(sessionsRoot) ? readdirSync(sessionsRoot) : []
}

/** The project key a boot with this sandbox cwd writes. */
export function sandboxProjectKey(root) {
  const ws = join(root, "ws")
  return "--" + ws.replace(/^\/+/, "").replaceAll("/", "-") + "--"
}

/** The session-store path a boot in this sandbox writes (isolation assertion). */
export function sessionsOutsideSandbox(root, allowedRoot) {
  const sessionsRoot = join(root, "dshhome", "sessions")
  if (!existsSync(sessionsRoot)) return []
  const allowed = allowedRoot.replace(/^\/+/, "").replaceAll("/", "-").replace(/^-+/, "")
  return readdirSync(sessionsRoot).filter((key) => {
    const inner = key.replace(/^--/, "").replace(/--$/, "")
    return !inner.startsWith(allowed)
  })
}

/** Copy a bounded excerpt of a decoded session record for the evidence dir. */
export function writeSessionExcerpt(outDir, name, headers) {
  const body = headers.map((entry) => ({
    sessionId: entry.sessionId,
    projectKey: entry.projectKey,
    store: entry.file.replace(REPO + "/", ""),
    storeSha256: entry.sha256,
    agentPreset: entry.agentPreset,
    cwd: entry.cwd,
  }))
  const file = join(outDir, name)
  writeFileSync(file, JSON.stringify({ note: "decoded header records from the sandbox session store", records: body }, null, 2) + "\n")
  return file
}

/** `pathToFileURL` re-export so lanes do not each import node:url. */
export { pathToFileURL }
