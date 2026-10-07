#!/usr/bin/env node
// Shared plumbing for the team-watchdog lanes (w9). Every lane in this family:
//   * drives REAL modules or reads REAL artifacts — never a source string as evidence;
//   * writes its evidence under evidence/team-watchdog/lanes/<timestamp>/;
//   * ships a `--self-test` whose NEGATIVE controls prove each assertion is falsifiable
//     (a mutated observation must make the lane's own evaluator FAIL).
//
// Nothing here touches packages/**: the lanes only READ the built artifacts, mount the real
// watchdog dist on a stub context and read the store back with plain fs.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
/** Repo root, resolved from this file (lib -> scripts -> dsh-qa -> skills -> repo). */
export const REPO = resolve(HERE, "..", "..", "..", "..")
/** Every lane's evidence lives here; each run gets its OWN timestamp directory. */
export const LANES_DIR = join(REPO, "evidence", "team-watchdog", "lanes")
/** The paths every lane reads. */
export const PATHS = {
  adapterDist: join(REPO, "packages", "mpd-dsh-adapter-plugin", "dist", "index.js"),
  watchdogDist: join(REPO, "packages", "mpd-team-watchdog-plugin", "dist", "index.js"),
  watchdogSrc: join(REPO, "packages", "mpd-team-watchdog-plugin", "src", "index.ts"),
  fixture: join(REPO, "packages", "mpd-team-watchdog-plugin", "test", "fixtures", "inject.mjs"),
  tuiDist: join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js"),
  tuiWatchdog: join(REPO, "packages", "mpd-tui-plugin", "src", "watchdog.ts"),
  webClient: join(REPO, "packages", "mpd-bundle-plugin", "client.js"),
  webRoute: join(REPO, "packages", "mpd-bundle-plugin", "src", "watchdog-web.ts"),
  settingsSchema: join(REPO, "packages", "mpd-config-plugin", "src", "settings-schema.ts"),
  webHarness: join(REPO, "packages", "mpd-bundle-plugin", "test", "client-harness.mjs"),
}
/** The adopted team state dir (the watchdog row's default too). */
export const STATE_DIR = join(".mpd", "team")

/** One line to stdout, prefixed so a reader can grep a lane's run. */
export function say(prefix, text) {
  console.log("[" + prefix + "] " + text)
}

/** A fresh evidence directory: `--out <dir>`, else evidence/team-watchdog/lanes/<utc-stamp>/. */
export function evidenceDir(argv, slug) {
  const at = argv.indexOf("--out")
  if (at >= 0 && typeof argv[at + 1] === "string" && argv[at + 1] !== "") return resolve(argv[at + 1])
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
  return join(LANES_DIR, stamp + (slug === undefined ? "" : "-" + slug))
}

export function sha256(text) {
  return createHash("sha256").update(typeof text === "string" ? Buffer.from(text, "utf8") : text).digest("hex")
}

export function read(path) {
  return readFileSync(path, "utf8")
}

export function readJson(path) {
  try {
    return JSON.parse(read(path))
  } catch {
    return undefined
  }
}

/** A sandbox workspace inside the evidence directory (never the repo's own `.mpd`). */
export function sandboxWorkspace(dir, tag) {
  const ws = join(dir, "raw", "sandbox", tag, "ws")
  mkdirSync(join(ws, STATE_DIR, "watchdog"), { recursive: true })
  return ws
}

/** The watchdog store's paths for one workspace. */
export function storePaths(ws) {
  const root = join(ws, STATE_DIR, "watchdog")
  return {
    root,
    hold: (teamId) => join(root, "hold", teamId + ".json"),
    holdDir: join(root, "hold"),
    incidents: join(root, "incidents.jsonl"),
    watermark: join(root, "read-watermark.json"),
    scene: (teamId) => join(root, "scene", teamId),
    scenePointer: (teamId) => join(root, "scene", teamId, "latest.json"),
    heartbeat: (memberKey) => join(root, "heartbeat", memberKey + ".jsonl"),
  }
}

/** Every incident line, parsed; malformed lines are counted, never guessed. */
export function readIncidents(ws) {
  const path = storePaths(ws).incidents
  if (!existsSync(path)) return { records: [], malformed: 0 }
  let malformed = 0
  const records = []
  for (const line of read(path).split("\n")) {
    if (line.trim() === "") continue
    try {
      records.push(JSON.parse(line))
    } catch {
      malformed += 1
    }
  }
  return { records, malformed }
}

export function readWatermarks(ws) {
  return readJson(storePaths(ws).watermark) ?? {}
}

export function readHolds(ws) {
  const dir = storePaths(ws).holdDir
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => readJson(join(dir, name))).filter(Boolean)
}

/** EVERY file under a directory, as repo/relative-ish keys with sha256 + bytes (the raw store). */
export function hashTree(dir) {
  const out = {}
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name)
      const key = prefix === "" ? entry.name : prefix + "/" + entry.name
      if (entry.isDirectory()) walk(path, key)
      else {
        const bytes = readFileSync(path)
        out[key] = { sha256: sha256(bytes), bytes: bytes.length }
      }
    }
  }
  if (existsSync(dir)) walk(dir, "")
  return out
}

/**
 * Read a set of files from a FRESH process: a plain-`node` child prints JSON, so the lane's
 * own module state (caches, mounts, clocks) cannot make the read succeed. This is the
 * "plain fs from a fresh process" witness the scene lane is required to use.
 */
export function freshProcessRead(paths) {
  const script = [
    'const { readFileSync, existsSync } = require("node:fs");',
    "const paths = JSON.parse(process.argv[1]);",
    "const out = {};",
    "for (const p of paths) out[p] = existsSync(p) ? readFileSync(p, 'utf8') : null;",
    "process.stdout.write(JSON.stringify({ pid: process.pid, node: process.version, reads: out }));",
  ].join("\n")
  const child = spawnSync(process.execPath, ["-e", script, JSON.stringify(paths)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (child.status !== 0) throw new Error("fresh-process read failed: " + String(child.stderr || child.status))
  return JSON.parse(child.stdout)
}

// ─────────────────────────── mounting the REAL watchdog dist ───────────────────────────
/**
 * A stub cordis context: the ONLY simulated layer. The watchdog row, its engine, machine,
 * store, scene writer and hold registry are the REAL modules (its built dist), mounted here
 * exactly the way the plugin expects (`apply(ctx, config)`), with the adapter double served
 * through the documented `mpdDsh` service id.
 */
export function stubCtx(options = {}) {
  const workspace = options.workspace
  const services = new Map()
  const listeners = new Map()
  const events = []
  const registered = new Map()
  const warnings = []
  const liveAgents = [...(options.agents ?? [])]
  const settingsState = { value: options.namespace ?? {}, revision: 1 }
  // The host's settings document, as the adapter's `settingsReader` reads it.
  services.set("settings", {
    get: (ns) => (ns === "mpd" ? settingsState.value : undefined),
    describe: () => [{ ns: "mpd", value: settingsState.value, revision: settingsState.revision, user: settingsState.value, base: options.base }],
  })
  const ctx = {
    get: (id, strict) => {
      const value = services.get(id)
      if (value === undefined && strict === true) throw new Error("no service " + id)
      return value
    },
    provide: (id, value) => services.set(id, value),
    on: (event, handler) => {
      const list = listeners.get(event) ?? []
      list.push(handler)
      listeners.set(event, list)
      events.push(event)
      return () => {
        const current = listeners.get(event) ?? []
        listeners.set(event, current.filter((entry) => entry !== handler))
      }
    },
    effect: (fn) => {
      const disposer = typeof fn === "function" ? fn() : undefined
      return typeof disposer === "function" ? disposer : () => {}
    },
    inject: (deps, cb) => {
      if (Array.isArray(deps) && deps.every((dep) => services.has(dep))) cb(ctx)
      return () => {}
    },
    logger: { warn: (...args) => warnings.push(args.map(String).join(" ")), info: (...args) => warnings.push(args.map(String).join(" ")), error: () => {}, debug: () => {} },
    agents: { get: (id) => liveAgents.find((entry) => entry.id === id), list: () => [...liveAgents] },
    tools: {
      register: (definition) => {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
      get: (name) => registered.get(name),
      has: (name) => registered.has(name),
    },
    subagents: { prompt: async () => ({ messageId: "stub" }) },
    llm: { resolveCallConfig: async (request) => request, listModels: async () => [] },
    systemPrompt: { section: () => {} },
  }
  return {
    ctx, services, events, warnings, registered,
    /** Fire a captured event the way the host would — the live levers of every lane. */
    fire: async (event, ...args) => {
      const list = listeners.get(event) ?? []
      for (const handler of [...list]) await handler(...args)
      return list.length
    },
    setNamespace: (value, revision) => {
      settingsState.value = value
      settingsState.revision = typeof revision === "number" ? revision : settingsState.revision + 1
    },
    namespace: () => settingsState.value,
    setAgents: (list) => {
      liveAgents.length = 0
      liveAgents.push(...list)
    },
  }
}

/**
 * Mount the REAL watchdog dist on a stub context, with the REAL adapter (createDshAdapter)
 * served through the documented `mpdDsh` service id — so the seams the row uses (event
 * subscription, the POST tool hook, the settings reader and its document-updated listener,
 * tool registration) are the production ones, over a stub harness.
 */
export async function mountRealWatchdog(options) {
  const harness = stubCtx(options)
  const { createDshAdapter } = await import(pathToFileURL(PATHS.adapterDist).href)
  const adapter = createDshAdapter(harness.ctx)
  harness.ctx.provide("mpdDsh", adapter)
  const mod = await import(pathToFileURL(PATHS.watchdogDist).href)
  const report = mod.apply(harness.ctx, options.config ?? {})
  return { mod, report, adapter, ...harness }
}

/** Write the adopted plugin's team record the way its own state.js would (the lane's INPUT). */
export function writeTeamRecord(ws, team) {
  const dir = join(ws, STATE_DIR, team.id)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "team.json")
  writeFileSync(path, JSON.stringify(team, null, 2) + "\n", "utf8")
  return path
}

/** A live-agent double in the shape the harness registry hands the adapter. */
export function liveAgent(id, workspace, extras = {}) {
  // `agentIds()` reads the SESSION id from `session.id` and the agent id from `id` (measured):
  // a captain is recognised by `team.captainSessionId === session.id`, so the session id must
  // be carried explicitly or the stamp falls back to a session-derived key.
  const { sessionId, ...rest } = extras
  return { id, status: "idle", session: { id: typeof sessionId === "string" ? sessionId : id, header: { cwd: workspace } }, cancel: () => {}, ...rest }
}

// ─────────────────────────────── lane scaffolding ───────────────────────────────
/**
 * The shape every lane's `--self-test` uses: evaluate a healthy synthetic observation
 * (must PASS), then evaluate mutated copies (each must FAIL). A lane whose evaluator cannot
 * fail is not evidence, so this is mandatory, not decorative.
 */
export function selfTest(name, evaluate, healthy, mutations) {
  const checks = []
  const good = evaluate(healthy)
  if (!good.ok) {
    checks.push({ id: "healthy-observation", ok: false, detail: "the healthy observation did not pass: " + JSON.stringify(good.checks.filter((entry) => !entry.ok)) })
  } else {
    checks.push({ id: "healthy-observation", ok: true, detail: good.checks.length + " checks passed on the healthy observation" })
  }
  for (const [id, mutate, why] of mutations) {
    const copy = JSON.parse(JSON.stringify(healthy))
    mutate(copy)
    const result = evaluate(copy)
    const failedIds = result.checks.filter((entry) => !entry.ok).map((entry) => entry.id)
    const ok = result.ok === false && failedIds.length > 0
    checks.push({
      id: "negative:" + id,
      ok,
      detail: ok ? "the mutated observation FAILED its own check(s) " + JSON.stringify(failedIds) + " — " + why : "the mutation " + id + " did NOT fail any check (" + why + ")",
    })
  }
  const ok = checks.every((entry) => entry.ok)
  for (const entry of checks) console.log("[self-test] " + (entry.ok ? "ok  " : "FAIL") + " " + entry.id + ": " + entry.detail)
  console.log("[self-test] " + (ok ? "PASS" : "FAIL") + " — " + name + " (" + checks.length + " checks, " + checks.filter((entry) => !entry.ok).length + " failed)")
  process.exit(ok ? 0 : 1)
}

/** Write result.json + output.log for one lane run. */
export function writeEvidence(dir, result, stdoutLines) {
  mkdirSync(dir, { recursive: true })
  const payload = { ...result, evidenceDir: dir, finishedAt: new Date().toISOString() }
  writeFileSync(join(dir, "result.json"), JSON.stringify(payload, null, 2) + "\n", "utf8")
  writeFileSync(join(dir, "output.log"), stdoutLines.join("\n") + "\n", "utf8")
  return join(dir, "result.json")
}

/** Capture stdout while a lane runs, so the same lines land in output.log. */
export function captureStdout() {
  const lines = []
  const original = console.log
  console.log = (...args) => {
    const text = args.map(String).join(" ")
    lines.push(text)
    original(text)
  }
  return { lines, restore: () => { console.log = original } }
}

/** Print the verdict and exit with the lane's status. */
export function finish(slug, result, lines) {
  const failed = result.checks.filter((entry) => !entry.ok)
  say(slug, (result.ok ? "PASS" : "FAIL") + " — " + result.checks.length + " checks, " + failed.length + " failed" + (result.evidenceFile === undefined ? "" : " (evidence: " + result.evidenceFile + ")"))
  if (result.notClaimed !== undefined) for (const item of result.notClaimed) say(slug, "NOT CLAIMED: " + item)
  process.exit(result.ok ? 0 : 1)
}
