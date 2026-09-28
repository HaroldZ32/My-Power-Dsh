// B4 mpd-modelchain-plugin: upstream fallback-chain resolution (DeepSeek-first) + workspace memory.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** The plugin id the bundle row mounts this module under. */
export const name = "mpd-modelchain"
/** The tool registry the three `mpd_*` tools are registered into. */
export const inject = ["tools"]

/** The slice of the row context this plugin reads: the tool registry plus the two lazily-read services. */
type Ctx = { tools: any; get?: (k: string) => any; [k: string]: any }
/** The row's config keys: a memory-file override and a whole replacement chain table. */
type Config = { memoryFile?: string; chains?: Record<string, Array<{ provider: string; model: string }>> }

/** The shipped fallback chains, keyed by kebab-case role name; entry 0 is the preferred route. */
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

/**
 * Resolve one role to its route: the first entry of the role's own chain, or of the shipped default
 * chain, or of `sisyphus` when the role is unknown or its chain is empty.
 *
 * @param role - the role key as the caller spelled it; camelCase is normalized to kebab-case.
 * @param chains - the chain table to resolve against, normally the row's merged table.
 * @returns the resolved route plus the whole chain it came from, for a caller that wants the fallbacks.
 */
export function resolveRole(role: string, chains: Record<string, Array<{ provider: string; model: string }>>): { provider: string; model: string; chain: Array<{ provider: string; model: string }> } {
  /** The normalized kebab-case chain key this role is looked up under. */
  const key = toKebabKey(role)
  /** The role's chain: the caller's table first, then the shipped table, then the generic default. */
  let chain = chains[key] ?? DEFAULT_CHAINS[key] ?? DEFAULT_CHAINS.sisyphus
  if (!Array.isArray(chain) || chain.length === 0) chain = DEFAULT_CHAINS.sisyphus
  /** The preferred route, i.e. the chain's first entry. */
  const primary = chain[0]
  return { provider: primary.provider, model: primary.model, chain }
}

/** The memory file's absolute path: the configured override resolved against `cwd`, else `<cwd>/.mpd/memory.json`. */
function memoryPath(cwd: string, config: Config): string {
  return config.memoryFile ? resolve(cwd, config.memoryFile) : join(cwd, ".mpd", "memory.json")
}

/** Read the memory file as a flat key/value map; a missing or unparseable file reads as empty (never throws). */
function loadMemory(p: string): Record<string, string> {
  try { return JSON.parse(readFileSync(p, "utf8")) } catch { return {} }
}

/**
 * Register the route resolver and the two memory tools, with the role chains overlaid from the
 * `mpdConfig` service when that service is present.
 *
 * @param ctx - the row context; the roster and config services are read lazily, never declared as deps.
 * @param config - row overrides for the memory file and the chain table.
 */
export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: any = resolveDshAdapter(ctx)
  /** The runtime config service, when the composition mounts one; its `get` answers dotted keys. */
  const mpdConfig = ctx.get?.("mpdConfig") as { get: (k?: string) => any } | undefined
  /** The chain table in force: the row's own, until the config overlay replaces it below. */
  let chains = config?.chains ?? DEFAULT_CHAINS
  if (mpdConfig?.get) {
    /** Only the roles the config actually overrides, kept apart so the shipped table survives for the rest. */
    const overlay: Record<string, Array<{ provider: string; model: string }>> = {}
    for (const key of Object.keys(DEFAULT_CHAINS)) {
      /** The legacy camelCase spelling of this role, if it ever had one. */
      const legacy = LEGACY_CHAIN_KEYS[key]
      /** The configured chain under either spelling; anything else is not a chain and is ignored. */
      const v = mpdConfig.get("modelchain." + key) ?? (legacy ? mpdConfig.get("modelchain." + legacy) : undefined)
      if (Array.isArray(v) && v.length > 0 && v.every((c: any) => c && typeof c.provider === "string" && typeof c.model === "string")) overlay[key] = v
    }
    if (Object.keys(overlay).length > 0) chains = { ...DEFAULT_CHAINS, ...overlay }
  }

  dsh.registerTool({
    name: "mpd_modelchain_resolve",
    description: "Resolve the DeepSeek provider/model route for a roster role, addressed by its name (Architect, Researcher, Planner, Deep Worker, Senior Engineer, Lead, Explorer, Reviewer, Plan Reviewer, Vision Analyst, Junior Engineer) — the same names team mode uses. Chains come from the mpd-roles roster, with the adapted fallback chains behind them.",
    parameters: { type: "object", properties: { role: { type: "string", description: "role name (see mpd_roles_list)" } }, required: ["role"] },
    output: {
      schema: { type: "object", properties: { provider: { type: "string" }, model: { type: "string" }, chain: { type: "array", items: { type: "object", properties: { provider: { type: "string" }, model: { type: "string" } }, required: [] } } }, required: ["provider", "model"] },
      render: (_args: any, value: any) => [{ type: "text", text: "role=" + _args?.role + " -> " + value.provider + "/" + value.model + " (chain " + value.chain.length + " entries)" }]
    },
    execute: async (args: any) => {
      /** The requested role, defaulting to the generic `sisyphus` chain when the caller named none. */
      const role = String(args?.role ?? "sisyphus")
      // Source of truth: the mpd-roles roster chains (DEFAULT_CHAINS kept as fallback).
      const rolesService = ctx.get?.("mpdRoles") as { get?: (k: string) => any } | undefined
      /** The roster's own spec for this role, when the roster service is mounted and knows the name. */
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
    execute: async (args: any, exec: any) => {
      // Root resolved PER CALL: the calling session's workspace (never the dsh process cwd).
      const p = memoryPath(dsh.workspaceRoot(exec), config)
      if (!existsSync(p)) mkdirSync(join(p, ".."), { recursive: true })
      /** The memory map read back from disk, so a save merges instead of replacing the file. */
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
    execute: async (args: any, exec: any) => {
      /** The memory map of the calling session's workspace, read fresh on every recall. */
      const mem = loadMemory(memoryPath(dsh.workspaceRoot(exec), config))
      /** The requested key, stringified so a non-string argument cannot miss the map. */
      const k = String(args.key)
      return { key: k, value: mem[k] ?? "", found: Object.prototype.hasOwnProperty.call(mem, k) }
    }
  })
}
