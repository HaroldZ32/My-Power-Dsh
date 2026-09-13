// t11 hook harness — exercises the REAL carrier-hook module from a scratch tree.
// The live file is COPIED (never modified); the copy's location makes both candidate
// families land inside the scratch tree, so no repo path is ever created or read.
// Usage: node hook-harness.mjs <mode>
import { mkdirSync, writeFileSync, symlinkSync, rmSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
const REPO = "/root/dshProj/my-power-dsh";
const S = join(here, "hook-scratch");
const PLUGIN_LIB = join(S, "node_modules/@mpd-dsh/mpd/packages/mpd-agent-teams-plugin/lib");
const CAND = (depth) => {
  let dir = PLUGIN_LIB;
  for (let i = 0; i < depth; i += 1) dir = join(dir, "..");
  return join(dir, "node_modules/@mpd-dsh/silicon/presets/rtl-ip.profile.json");
};

rmSync(S, { recursive: true, force: true });
mkdirSync(PLUGIN_LIB, { recursive: true });
const PLUGIN_DIR = join(S, "node_modules/@mpd-dsh/mpd/packages/mpd-agent-teams-plugin");
cpSync(join(REPO, "packages/mpd-agent-teams-plugin"), PLUGIN_DIR, {
  recursive: true,
  filter: (p) => !p.includes("node_modules"),
});
put2(join(PLUGIN_DIR, "package.json"), JSON.stringify({ name: "mpd-agent-teams-plugin", type: "module" }));
const copy = join(PLUGIN_DIR, "lib/index.js");

function put2(p, text) { mkdirSync(dirname(p), { recursive: true }); if (!existsSync(p)) writeFileSync(p, text); }

const valid = JSON.stringify({ "rtl-ip": { name: "rtl-ip", members: [{ name: "architect" }] } });
const marker = JSON.stringify({ "rtl-ip": { name: "rtl-ip-FARTHER", members: [{ name: "farther" }] } });
const corrupt = "{ this is not json";
const put = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
const loop = (p) => {
  mkdirSync(dirname(p), { recursive: true });
  symlinkSync(p + "--b", p + "--a"); // a -> b
  symlinkSync(p + "--a", p + "--b"); // b -> a   (true cycle a<->b)
  symlinkSync(p + "--a", p); //         p -> a   => readFileSync(p) throws ELOOP
};
const dangle = (p) => {
  mkdirSync(dirname(p), { recursive: true });
  symlinkSync(p + "--missing-target", p); // dangling => readFileSync(p) throws ENOENT
};

if (mode === "d-valid-nearest") { put(CAND(0), valid); put(CAND(1), marker); }
if (mode === "a-corrupt-nearest-valid-farther") { put(CAND(0), corrupt); put(CAND(1), marker); }
if (mode === "a2-eloop-nearest-valid-farther") { loop(CAND(0)); put(CAND(1), marker); }
if (mode === "a3-all-unreadable") { loop(CAND(0)); loop(CAND(1)); }
if (mode === "b-all-corrupt") { put(CAND(0), corrupt); put(CAND(1), corrupt); }
if (mode === "c-all-absent") { /* nothing */ }

const warns = [];
const origWarn = console.warn;
console.warn = (...a) => { warns.push(a.map(String).join(" ")); };
const origError = console.error;
console.error = (...a) => { warns.push("ERROR " + a.map(String).join(" ")); };

// Recording ctx: chainable proxy that records which ctx surfaces were touched and
// invokes injected callbacks so the merged `config.profiles` getters can be reached.
const touched = [];
function makeProxy(label) {
  const fn = function () { return makeProxy(label + "()"); };
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === "then") return undefined;
      return makeProxy(label + "." + String(prop));
    },
    apply(_t, _this, args) {
      touched.push(label + "(" + args.map((a) => (typeof a === "function" ? "[fn]" : JSON.stringify(a))).join(",") + ")");
      const cb = args.find((a) => typeof a === "function");
      if (cb && label.includes("inject")) { try { cb(makeProxy(label + ".injected")); } catch {} }
      return makeProxy(label + "()");
    },
  });
}

const mod = await import(pathToFileURL(copy).href);
let applyError = null;
try {
  mod.apply(makeProxy("ctx"), { stateDir: ".agent-teams", profiles: { mpd: { name: "mpd", members: [{ name: "architect" }] } } });
} catch (e) { applyError = String(e && e.message ? e.message : e); }
console.warn = origWarn; console.error = origError;

const out = { mode, warns, warnCount: warns.length, applyError, touchedSample: touched.slice(0, 12) };
writeFileSync(join(here, "hook-result-" + mode + ".json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
