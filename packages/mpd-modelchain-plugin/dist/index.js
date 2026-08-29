// packages/mpd-modelchain-plugin/src/index.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
var name = "mpd-modelchain";
var inject = ["tools"];
var DEFAULT_CHAINS = {
  sisyphus: [
    { provider: "deepseek-official", model: "deepseek-v4-pro" },
    { provider: "deepseek-official", model: "deepseek-v4-flash" },
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
};
var LEGACY_CHAIN_KEYS = {
  "sisyphus-junior": "sisyphusJunior",
  "multimodal-looker": "multimodalLooker"
};
function toKebabKey(role) {
  return String(role ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
function resolveRole(role, chains) {
  const key = toKebabKey(role);
  let chain = chains[key] ?? DEFAULT_CHAINS[key] ?? DEFAULT_CHAINS.sisyphus;
  if (!Array.isArray(chain) || chain.length === 0)
    chain = DEFAULT_CHAINS.sisyphus;
  const primary = chain[0];
  return { provider: primary.provider, model: primary.model, chain };
}
function memoryPath(cwd, config) {
  return config.memoryFile ? resolve(cwd, config.memoryFile) : join(cwd, ".mpd", "memory.json");
}
function loadMemory(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}
function apply(ctx, config = {}) {
  const mpdConfig = ctx.get?.("mpdConfig");
  let chains = config?.chains ?? DEFAULT_CHAINS;
  if (mpdConfig?.get) {
    const overlay = {};
    for (const key of Object.keys(DEFAULT_CHAINS)) {
      const legacy = LEGACY_CHAIN_KEYS[key];
      const v = mpdConfig.get("modelchain." + key) ?? (legacy ? mpdConfig.get("modelchain." + legacy) : undefined);
      if (Array.isArray(v) && v.length > 0 && v.every((c) => c && typeof c.provider === "string" && typeof c.model === "string"))
        overlay[key] = v;
    }
    if (Object.keys(overlay).length > 0)
      chains = { ...DEFAULT_CHAINS, ...overlay };
  }
  const cwd = process.env.DSH_WORKSPACE_ROOT ?? process.cwd();
  ctx.tools.register({
    name: "mpd_modelchain_resolve",
    description: "Resolve the DeepSeek provider/model route for an upstream role (sisyphus/sisyphus-junior/oracle/atlas/prometheus/librarian/explore/metis/momus/multimodal-looker/hephaestus) from the adapted fallback chains.",
    parameters: { type: "object", properties: { role: { type: "string", description: "upstream agent role name" } }, required: ["role"] },
    output: {
      schema: { type: "object", properties: { provider: { type: "string" }, model: { type: "string" }, chain: { type: "array", items: { type: "object", properties: { provider: { type: "string" }, model: { type: "string" } }, required: [] } } }, required: ["provider", "model"] },
      render: (_args, value) => [{ type: "text", text: "role=" + _args?.role + " -> " + value.provider + "/" + value.model + " (chain " + value.chain.length + " entries)" }]
    },
    execute: async (args) => {
      const role = String(args?.role ?? "sisyphus");
      const rolesService = ctx.get?.("mpdRoles");
      const spec = rolesService?.get?.(role);
      if (spec && Array.isArray(spec.chain) && spec.chain.length > 0) {
        return { provider: spec.chain[0].provider, model: spec.chain[0].model, chain: spec.chain.map((c) => ({ ...c })) };
      }
      return resolveRole(role, chains);
    }
  });
  ctx.tools.register({
    name: "mpd_memory_save",
    description: "Persist a key/value note in the workspace-scoped memory (.mpd/memory.json).",
    parameters: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] },
    output: { schema: { type: "object", properties: { ok: { type: "boolean" }, key: { type: "string" } }, required: ["ok", "key"] }, render: (_a, v) => [{ type: "text", text: "saved " + v.key }] },
    execute: async (args) => {
      const p = memoryPath(cwd, config);
      if (!existsSync(p))
        mkdirSync(join(p, ".."), { recursive: true });
      const mem = loadMemory(p);
      mem[String(args.key)] = String(args.value);
      writeFileSync(p, JSON.stringify(mem, null, 2));
      return { ok: true, key: String(args.key) };
    }
  });
  ctx.tools.register({
    name: "mpd_memory_recall",
    description: "Recall a key from the workspace-scoped memory.",
    parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    output: { schema: { type: "object", properties: { key: { type: "string" }, value: { type: "string" }, found: { type: "boolean" } }, required: ["key", "found"] }, render: (_a, v) => [{ type: "text", text: v.found ? v.key + " = " + v.value : "not found: " + v.key }] },
    execute: async (args) => {
      const mem = loadMemory(memoryPath(cwd, config));
      const k = String(args.key);
      return { key: k, value: mem[k] ?? "", found: Object.prototype.hasOwnProperty.call(mem, k) };
    }
  });
}
export {
  resolveRole,
  name,
  inject,
  apply,
  DEFAULT_CHAINS
};
