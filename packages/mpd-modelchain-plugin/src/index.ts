// B4 mpd-modelchain-plugin: upstream fallback-chain resolution (DeepSeek-first) + workspace memory.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

export const name = "mpd-modelchain"
export const inject = ["tools"]

type Ctx = { tools: any; get?: (k: string) => any; [k: string]: any }
type Config = { memoryFile?: string; chains?: Record<string, Array<{ provider: string; model: string }>> }

export const DEFAULT_CHAINS: Record<string, Array<{ provider: string; model: string }>> = {
  sisyphus: [
    { provider: "deepseek-official", model: "deepseek-v4-pro" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  "sisyphus-junior": [
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  oracle: [
    { provider: "deepseek-official", model: "deepseek-v4-pro" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  atlas: [
    { provider: "deepseek-official", model: "deepseek-v4-pro" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  prometheus: [
    { provider: "deepseek-official", model: "deepseek-v4-pro" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  librarian: [
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  explore: [
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  metis: [
    { provider: "deepseek-official", model: "deepseek-v4-pro" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  momus: [
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
    { provider: "deepseek-official", model: "deepseek-v4-pro" }
  ],
  "multimodal-looker": [
    { provider: "deepseek-official", model: "deepseek-v4-flash-vision-exp" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  hephaestus: [
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ]
}

// Legacy camelCase config keys accepted for backward compatibility (full migration to kebab-case keys).
const LEGACY_CHAIN_KEYS: Record<string, string> = {
  "sisyphus-junior": "sisyphusJunior",
  "multimodal-looker": "multimodalLooker",
}

/** Normalize a role key to the kebab-case chain key (accepts legacy camelCase input). */
function toKebabKey(role: string): string {
  return String(role ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()
}

export function resolveRole(role: string, chains: Record<string, Array<{ provider: string; model: string }>>): { provider: string; model: string; chain: Array<{ provider: string; model: string }> } {
  const key = toKebabKey(role)
  let chain = chains[key] ?? DEFAULT_CHAINS[key] ?? DEFAULT_CHAINS.sisyphus
  if (!Array.isArray(chain) || chain.length === 0) chain = DEFAULT_CHAINS.sisyphus
  const primary = chain[0]
  return { provider: primary.provider, model: primary.model, chain }
}

function memoryPath(cwd: string, config: Config): string {
  return config.memoryFile ? resolve(cwd, config.memoryFile) : join(cwd, ".mpd", "memory.json")
}

function loadMemory(p: string): Record<string, string> {
  try { return JSON.parse(readFileSync(p, "utf8")) } catch { return {} }
}

export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)
  const mpdConfig = ctx.get?.("mpdConfig") as { get: (k?: string) => any } | undefined
  let chains = config?.chains ?? DEFAULT_CHAINS
  if (mpdConfig?.get) {
    const overlay: Record<string, Array<{ provider: string; model: string }>> = {}
    for (const key of Object.keys(DEFAULT_CHAINS)) {
      const legacy = LEGACY_CHAIN_KEYS[key]
      const v = mpdConfig.get("modelchain." + key) ?? (legacy ? mpdConfig.get("modelchain." + legacy) : undefined)
      if (Array.isArray(v) && v.length > 0 && v.every((c: any) => c && typeof c.provider === "string" && typeof c.model === "string")) overlay[key] = v
    }
    if (Object.keys(overlay).length > 0) chains = { ...DEFAULT_CHAINS, ...overlay }
  }
  const cwd = process.env.DSH_WORKSPACE_ROOT ?? process.cwd()

  dsh.registerTool({
    name: "mpd_modelchain_resolve",
    description: "Resolve the DeepSeek provider/model route for an upstream role (sisyphus/sisyphus-junior/oracle/atlas/prometheus/librarian/explore/metis/momus/multimodal-looker/hephaestus) from the adapted fallback chains.",
    parameters: { type: "object", properties: { role: { type: "string", description: "upstream agent role name" } }, required: ["role"] },
    output: {
      schema: { type: "object", properties: { provider: { type: "string" }, model: { type: "string" }, chain: { type: "array", items: { type: "object", properties: { provider: { type: "string" }, model: { type: "string" } }, required: [] } } }, required: ["provider", "model"] },
      render: (_args: any, value: any) => [{ type: "text", text: "role=" + _args?.role + " -> " + value.provider + "/" + value.model + " (chain " + value.chain.length + " entries)" }]
    },
    execute: async (args: any) => {
      const role = String(args?.role ?? "sisyphus")
      // Source of truth: the mpd-roles roster chains (DEFAULT_CHAINS kept as fallback).
      const rolesService = ctx.get?.("mpdRoles") as { get?: (k: string) => any } | undefined
      const spec = rolesService?.get?.(role)
      if (spec && Array.isArray(spec.chain) && spec.chain.length > 0) {
        return { provider: spec.chain[0].provider, model: spec.chain[0].model, chain: spec.chain.map((c: any) => ({ ...c })) }
      }
      return resolveRole(role, chains)
    }
  })

  dsh.registerTool({
    name: "mpd_memory_save",
    description: "Persist a key/value note in the workspace-scoped memory (.mpd/memory.json).",
    parameters: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] },
    output: { schema: { type: "object", properties: { ok: { type: "boolean" }, key: { type: "string" } }, required: ["ok", "key"] }, render: (_a: unknown, v: any) => [{ type: "text", text: "saved " + v.key }] },
    execute: async (args: any) => {
      const p = memoryPath(cwd, config)
      if (!existsSync(p)) mkdirSync(join(p, ".."), { recursive: true })
      const mem = loadMemory(p)
      mem[String(args.key)] = String(args.value)
      writeFileSync(p, JSON.stringify(mem, null, 2))
      return { ok: true, key: String(args.key) }
    }
  })

  dsh.registerTool({
    name: "mpd_memory_recall",
    description: "Recall a key from the workspace-scoped memory.",
    parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    output: { schema: { type: "object", properties: { key: { type: "string" }, value: { type: "string" }, found: { type: "boolean" } }, required: ["key", "found"] }, render: (_a: unknown, v: any) => [{ type: "text", text: v.found ? v.key + " = " + v.value : "not found: " + v.key }] },
    execute: async (args: any) => {
      const mem = loadMemory(memoryPath(cwd, config))
      const k = String(args.key)
      return { key: k, value: mem[k] ?? "", found: Object.prototype.hasOwnProperty.call(mem, k) }
    }
  })
}
