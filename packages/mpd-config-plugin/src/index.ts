// C7 mpd-config-plugin: minimal mpd.jsonc runtime config layer.
// Project layer: <workspace>/.mpd/mpd.jsonc; user layer: $DSH_HOME/mpd.jsonc
// (or ~/.dsh/mpd.jsonc). Deep-merged (project wins), JSONC (comments +
// trailing commas), prototype-pollution safe. Provides the "mpdConfig"
// service for other mpd plugins (inject: ["mpdConfig"]) and two tools.
// Boundary: bundle patch stays the composition truth; this layer only feeds
// plugin runtime config, it never mutates dsh patch rows.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

export const name = "mpd-config"
export const inject = ["tools"]

type Ctx = { tools: any; provide: (name: string, value: any, check?: any) => void }
type Config = { projectFile?: string; userFile?: string }

function textBlock(text: string): any { return [{ type: "text", text }] }

// --- minimal JSONC parser (comments + trailing commas; string-aware) ---
function stripJsonc(src: string): string {
  let out = ""
  let inString = false
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (inString) {
      out += ch
      if (ch === "\\") { out += src[i + 1] ?? ""; i += 2; continue }
      if (ch === "\"") inString = false
      i++
      continue
    }
    if (ch === "\"") { inString = true; out += ch; i++; continue }
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue }
    if (ch === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue }
    if (ch === ",") {
      // trailing comma before } or ]
      let j = i + 1
      while (j < src.length && /\s/.test(src[j])) j++
      if (src[j] === "}" || src[j] === "]") { i++; continue }
    }
    out += ch
    i++
  }
  return out
}

function parseJsonc(src: string): any {
  return JSON.parse(stripJsonc(src))
}

function isPlainObject(v: any): boolean {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"])

// prototype-pollution safe deep merge (project wins)
function deepMerge(base: any, over: any): any {
  const out: any = {}
  const bkeys = isPlainObject(base) ? Object.keys(base) : []
  const okeys = isPlainObject(over) ? Object.keys(over) : []
  for (const key of new Set([...bkeys, ...okeys])) {
    if (RESERVED_KEYS.has(key)) continue
    const bv = isPlainObject(base) ? base[key] : undefined
    const ov = isPlainObject(over) ? over[key] : undefined
    if (isPlainObject(bv) && isPlainObject(ov)) out[key] = deepMerge(bv, ov)
    else if (isPlainObject(bv) && ov === undefined) out[key] = deepMerge(bv, {})
    else out[key] = ov !== undefined ? ov : bv
  }
  return out
}

function loadConfig(config: Config): { config: any; files: string[]; errors: string[] } {
  const cwd = process.env.DSH_WORKSPACE_ROOT ?? process.cwd()
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh")
  const userFile = config.userFile ? resolve(config.userFile) : join(dshHome, "mpd.jsonc")
  const projectFile = config.projectFile ? resolve(config.projectFile) : join(cwd, ".mpd", "mpd.jsonc")
  const files = [userFile, projectFile]
  let merged: any = {}
  const errors: string[] = []
  for (const f of files) {
    if (!existsSync(f)) continue
    try { merged = deepMerge(merged, parseJsonc(readFileSync(f, "utf8"))) }
    catch (e: any) { errors.push(f + ": " + String(e?.message ?? e)) }
  }
  return { config: merged, files: files.filter((f) => existsSync(f)), errors }
}

export { stripJsonc, parseJsonc, deepMerge }

export function apply(ctx: Ctx, config: Config = {}): void {
  let state = loadConfig(config)

  function reload(): any { state = loadConfig(config); return state.config }

  ctx.provide("mpdConfig", {
    get: (key?: string) => {
      if (key === undefined) return state.config
      return key.split(".").reduce((acc: any, part: string) => (acc == null ? undefined : acc[part]), state.config)
    },
    reload,
    states: () => ({ files: state.files, errors: state.errors }),
  })

  ctx.tools.register({
    name: "mpd_config_get",
    description: "Read the resolved mpd.jsonc runtime config (project .mpd/mpd.jsonc merged over user $DSH_HOME/mpd.jsonc). Consumed keys: memory.vcs/memory.dir/memory.agentSlug/memory.reflectionEvery, team.stateDir, hashline.guardEditTools/hashline.maxDiffChars/hashline.registryFile, commentChecker.autoCheck/commentChecker.bin/commentChecker.timeoutMs/commentChecker.maxMessageChars, modelchain.<chainKey>, boulder.dir, ulw.maxRounds/ulw.planDir/ulw.stateDir/ulw.provider/ulw.model/ulw.reviewerModel/ulw.maxReReviews.",
    parameters: { type: "object", properties: { key: { type: "string", description: "Optional dot-path to a single key, e.g. memory.vcs" } }, additionalProperties: false },
    output: { schema: { type: "object", properties: { config: { type: "object" }, key: { type: "string" }, value: {} }, required: ["config"] }, render: (_a: unknown, v: any) => textBlock(v.key ? "mpd config " + v.key + ": " + JSON.stringify(v.value, null, 1) : "mpd config: " + JSON.stringify(v.config, null, 1)) },
    execute: async (args: any) => {
      const key = args?.key ? String(args.key) : undefined
      // `value` is a raw JSON value: an undefined field is dropped by JSON
      // serialization, which breaks the host's lossless round-trip check
      // ("value is not lossless JSON"). Missing keys resolve to null instead.
      const value = key ? (key.split(".").reduce((acc: any, part: string) => (acc == null ? undefined : acc[part]), state.config) ?? null) : null
      return key === undefined ? { config: state.config } : { config: state.config, key, value }
    }
  })

  ctx.tools.register({
    name: "mpd_config_reload",
    description: "Re-read the mpd.jsonc layers and refresh the resolved config (returns files found and any parse errors).",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { files: { type: "array", items: { type: "string" } }, errors: { type: "array", items: { type: "string" } } }, required: ["files", "errors"] }, render: (_a: unknown, v: any) => textBlock("mpd config reloaded: " + v.files.join(", ") + (v.errors.length ? " ERRORS: " + v.errors.join("; ") : "")) },
    execute: async () => {
      const cfg = reload()
      return { files: state.files, errors: state.errors, config: cfg }
    }
  })
}
