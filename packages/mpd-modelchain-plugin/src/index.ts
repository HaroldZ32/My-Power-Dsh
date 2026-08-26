// B4 omo-modelchain-plugin: upstream fallback-chain resolution (DeepSeek-first) + workspace memory.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

export const name = "omo-modelchain"
export const inject = ["tools"]

type Ctx = { tools: any; get?: (k: string) => any; [k: string]: any }
type Config = { memoryFile?: string; chains?: Record<string, Array<{ provider: string; model: string }>> }

export const DEFAULT_CHAINS: Record<string, Array<{ provider: string; model: string }>> = {
  sisyphus: [
    { provider: "deepseek-official", model: "deepseek-v4-pro" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
    { provider: "deepseek", model: "deepseek-v4-flash" }
  ],
  sisyphusJunior: [
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
    { provider: "deepseek", model: "deepseek-v4-flash" }
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
    { provider: "deepseek", model: "deepseek-v4-flash" }
  ],
  explore: [
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
    { provider: "deepseek", model: "deepseek-v4-flash" }
  ],
  metis: [
    { provider: "deepseek-official", model: "deepseek-v4-pro" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  momus: [
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
    { provider: "deepseek-official", model: "deepseek-v4-pro" }
  ],
  multimodalLooker: [
    { provider: "deepseek-official", model: "deepseek-v4-flash-vision-exp" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" }
  ],
  hephaestus: [
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
    { provider: "deepseek", model: "deepseek-v4-flash" }
  ]
}

export function resolveRole(role: string, chains: Record<string, Array<{ provider: string; model: string }>>): { provider: string; model: string; chain: Array<{ provider: string; model: string }>; skipped: boolean } {
  const key = role === "sisyphus-junior" ? "sisyphusJunior" : role === "multimodal-looker" ? "multimodalLooker" : role
  const chain = chains[key] ?? chains[key] ?? DEFAULT_CHAINS[key] ?? DEFAULT_CHAINS.sisyphus
  const primary = chain[0]
  return { provider: primary.provider, model: primary.model, chain, skipped: false }
}

function memoryPath(cwd: string, config: Config): string {
  return config.memoryFile ? resolve(cwd, config.memoryFile) : join(cwd, ".mpd", "memory.json")
}

function loadMemory(p: string): Record<string, string> {
  try { return JSON.parse(readFileSync(p, "utf8")) } catch { return {} }
}

export function apply(ctx: Ctx, config: Config = {}): void {
  const chains = config.chains ?? DEFAULT_CHAINS
  const cwd = process.env.DSH_WORKSPACE_ROOT ?? process.cwd()

  ctx.tools.register({
    name: "mpd_modelchain_resolve",
    description: "Resolve the DeepSeek provider/model route for an upstream role (sisyphus/oracle/atlas/prometheus/librarian/explore/hephaestus) from the adapted fallback chains.",
    parameters: { type: "object", properties: { role: { type: "string", description: "upstream agent role name" } }, required: ["role"] },
    output: {
      schema: { type: "object", properties: { provider: { type: "string" }, model: { type: "string" }, chain: { type: "array", items: { type: "object", properties: { provider: { type: "string" }, model: { type: "string" } }, required: [] } }, skipped: { type: "boolean" } }, required: ["provider", "model", "skipped"] },
      render: (_args: unknown, value: any) => [{ type: "text", text: "role=" + _args?.role + " -> " + value.provider + "/" + value.model + " (chain " + value.chain.length + " entries)" }]
    },
    execute: async (args: any) => resolveRole(String(args?.role ?? "sisyphus"), chains)
  })

  ctx.tools.register({
    name: "mpd_memory_save",
    description: "Persist a key/value note in the workspace-scoped omo memory (.mpd/memory.json).",
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

  ctx.tools.register({
    name: "mpd_memory_recall",
    description: "Recall a key from the workspace-scoped omo memory.",
    parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    output: { schema: { type: "object", properties: { key: { type: "string" }, value: { type: "string" }, found: { type: "boolean" } }, required: ["key", "found"] }, render: (_a: unknown, v: any) => [{ type: "text", text: v.found ? v.key + " = " + v.value : "not found: " + v.key }] },
    execute: async (args: any) => {
      const mem = loadMemory(memoryPath(cwd, config))
      const k = String(args.key)
      return { key: k, value: mem[k] ?? "", found: Object.prototype.hasOwnProperty.call(mem, k) }
    }
  })
}
