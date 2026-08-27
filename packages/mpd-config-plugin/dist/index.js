// src/index.ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
var name = "mpd-config";
var inject = ["tools"];
function textBlock(text) {
  return [{ type: "text", text }];
}
function stripJsonc(src) {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === '"')
        inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== `
`)
        i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/"))
        i++;
      i += 2;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j]))
        j++;
      if (src[j] === "}" || src[j] === "]") {
        i++;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}
function parseJsonc(src) {
  return JSON.parse(stripJsonc(src));
}
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
var RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
function deepMerge(base, over) {
  const out = {};
  const bkeys = isPlainObject(base) ? Object.keys(base) : [];
  const okeys = isPlainObject(over) ? Object.keys(over) : [];
  for (const key of new Set([...bkeys, ...okeys])) {
    if (RESERVED_KEYS.has(key))
      continue;
    const bv = isPlainObject(base) ? base[key] : undefined;
    const ov = isPlainObject(over) ? over[key] : undefined;
    if (isPlainObject(bv) && isPlainObject(ov))
      out[key] = deepMerge(bv, ov);
    else if (isPlainObject(bv) && ov === undefined)
      out[key] = deepMerge(bv, {});
    else
      out[key] = ov !== undefined ? ov : bv;
  }
  return out;
}
function loadConfig(config) {
  const cwd = process.env.DSH_WORKSPACE_ROOT ?? process.cwd();
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  const userFile = config.userFile ? resolve(config.userFile) : join(dshHome, "mpd.jsonc");
  const projectFile = config.projectFile ? resolve(config.projectFile) : join(cwd, ".mpd", "mpd.jsonc");
  const files = [userFile, projectFile];
  let merged = {};
  const errors = [];
  for (const f of files) {
    if (!existsSync(f))
      continue;
    try {
      merged = deepMerge(merged, parseJsonc(readFileSync(f, "utf8")));
    } catch (e) {
      errors.push(f + ": " + String(e?.message ?? e));
    }
  }
  return { config: merged, files: files.filter((f) => existsSync(f)), errors };
}
function apply(ctx, config = {}) {
  let state = loadConfig(config);
  function reload() {
    state = loadConfig(config);
    return state.config;
  }
  ctx.provide("mpdConfig", {
    get: (key) => key === undefined ? state.config : state.config[key],
    reload,
    states: () => ({ files: state.files, errors: state.errors })
  });
  ctx.tools.register({
    name: "mpd_config_get",
    description: "Read the resolved mpd.jsonc runtime config (project .mpd/mpd.jsonc merged over user $DSH_HOME/mpd.jsonc). Known keys: memory.vcs (git|svn|both), team.stateDir, hashline.enabled/guardEditTools, commentChecker.autoCheck/bin, modelchain.<role>, boulder.dir, ulw.maxRounds.",
    parameters: { type: "object", properties: { key: { type: "string", description: "Optional dot-path to a single key, e.g. memory.vcs" } }, additionalProperties: false },
    output: { schema: { type: "object", properties: { config: { type: "object" }, key: { type: "string" }, value: {} }, required: ["config"] }, render: (_a, v) => textBlock(v.key ? "mpd config " + v.key + ": " + JSON.stringify(v.value, null, 1) : "mpd config: " + JSON.stringify(v.config, null, 1)) },
    execute: async (args) => {
      const key = args?.key ? String(args.key) : undefined;
      const value = key ? key.split(".").reduce((acc, part) => acc == null ? undefined : acc[part], state.config) : undefined;
      return key === undefined ? { config: state.config } : { config: state.config, key, value };
    }
  });
  ctx.tools.register({
    name: "mpd_config_reload",
    description: "Re-read the mpd.jsonc layers and refresh the resolved config (returns files found and any parse errors).",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { files: { type: "array", items: { type: "string" } }, errors: { type: "array", items: { type: "string" } } }, required: ["files", "errors"] }, render: (_a, v) => textBlock("mpd config reloaded: " + v.files.join(", ") + (v.errors.length ? " ERRORS: " + v.errors.join("; ") : "")) },
    execute: async () => {
      const cfg = reload();
      return { files: state.files, errors: state.errors, config: cfg };
    }
  });
}
export {
  apply,
  deepMerge,
  inject,
  name,
  parseJsonc,
  stripJsonc
};
