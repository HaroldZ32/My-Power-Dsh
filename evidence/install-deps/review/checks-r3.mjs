// Round-3 review checks (t15) — read-only against the repository.
// Evaluates the SHIPPED row-aware foreign-mount predicate (repair F1) verbatim over
// real-filesystem compositions, in BOTH directions, plus the parse-miss fallback.
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const root = "/root/dshProj/my-power-dsh";
const patch = readFileSync(`${root}/packages/mpd-bundle/cordis.patch.yml`, "utf8");
const line = patch.split("\n").find((l) => /disabled: !!js "/.test(l) && l.includes("mpdSidebarGuardSeen"));
const guard = line.match(/disabled: !!js "([\s\S]*)"\s*$/)[1];
const h = (s) => createHash("sha256").update(s).digest("hex");
const inst = readFileSync(`${root}/scripts/install-profile.mjs`, "utf8");
const instGuard = JSON.parse(inst.match(/const SIDEBAR_GUARD = ("(?:[^"\\]|\\.)*")/)[1]);
const packed = readFileSync(`${root}/dist/mpd-package/cordis.patch.yml`, "utf8");
const pLine = packed.split("\n").find((l) => /disabled: !!js "/.test(l) && l.includes("mpdSidebarGuardSeen"));
const packedGuard = pLine ? pLine.match(/disabled: !!js "([\s\S]*)"\s*$/)[1] : null;
const repacked = readFileSync(`${root}/evidence/install-deps/repair-f1/pack-verified/cordis.patch.yml`, "utf8");
const rLine = repacked.split("\n").find((l) => /disabled: !!js "/.test(l) && l.includes("mpdSidebarGuardSeen"));
const repackedGuard = rLine ? rLine.match(/disabled: !!js "([\s\S]*)"\s*$/)[1] : null;

console.log("patch guard      :", guard.length, h(guard));
console.log("installer guard  :", instGuard.length, "EQUAL:", instGuard === guard);
console.log("canonical packed :", packedGuard ? packedGuard.length : "NOT FOUND", packedGuard ? h(packedGuard) : "-", "EQUAL TO SOURCE:", packedGuard === guard);
console.log("repair pack-verified:", repackedGuard ? repackedGuard.length : "NOT FOUND", repackedGuard ? h(repackedGuard) : "-", "EQUAL TO SOURCE:", repackedGuard === guard);
console.log("raw e.options.disabled reads:", (guard.match(/e\.options\.disabled/g) || []).length, "| evaluated .disabled read elsewhere:", /\.disabled\b/.test(guard.replace(/e\.options\.disabled/g, "RAW")) ? "SUSPECT" : "no");
console.log("comment-strip + unquote + keyOf present:", ["stripComments", "unquote", "keyOf", "foreignRowMountsSidebar"].map((n) => guard.includes(n)).join(","));

const EVAL = new Function("ctx", "expr", "with (ctx) { return eval(expr) }");
const SIDEBAR = { "package.json": JSON.stringify({ name: "dsh-better-sidebar", version: "0.19.0-alpha.1", dsh: { bundle: { patch: "./cordis.patch.yml" } } }), "cordis.patch.yml": "[]\n" };
const OWN = { "package.json": JSON.stringify({ name: "@mpd-dsh/mpd", dsh: { bundle: { patch: "./packages/mpd-bundle/cordis.patch.yml" } } }) };
const FOREIGN_PKG = { "package.json": JSON.stringify({ name: "@other/web-all", dsh: { bundle: { patch: "./cordis.patch.yml" } } }) };
let seq = 0;
function profile({ bundles, layerText = null, layerWhere = "bundle", modules = {} }) {
  const base = mkdtempSync(join(tmpdir(), `r3-${seq++}-`));
  const dir = join(base, "dsh", "profiles", "w");
  const mods = join(dir, "node_modules");
  mkdirSync(mods, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "dsh-profile-w", dsh: { profile: { bundles } } }));
  if (layerWhere === "profile" && layerText !== null) writeFileSync(join(dir, "cordis.patch.yml"), layerText);
  if (layerWhere === "home" && layerText !== null) writeFileSync(join(base, "dsh", "cordis.patch.yml"), layerText);
  for (const [name, files] of Object.entries(modules)) {
    const p = join(mods, name);
    mkdirSync(p, { recursive: true });
    for (const [f, c] of Object.entries(files)) {
      mkdirSync(join(p, f, ".."), { recursive: true });
      writeFileSync(join(p, f), c);
    }
  }
  return { base, dir };
}
const WEB_ENTRY = { options: { id: "webserver", name: "@deepseek-ai/dsh-host-webserver" } };
const run = (dir, entries, argv = ["node", "dsh", "--profile", "w"]) => {
  const saveArgv = process.argv, saveHome = process.env.DSH_HOME;
  process.argv = argv;
  process.env.DSH_HOME = join(dir, "..", "..");
  try { return EVAL({ loader: { entries: () => entries }, baseUrl: "file://" + dir.replace(/\/$/, "") + "/" }, guard); }
  finally { process.argv = saveArgv; if (saveHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = saveHome; }
};
const WEB = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"];
const modules = (extra = {}) => ({ "dsh-better-sidebar": SIDEBAR, "@mpd-dsh/mpd": OWN, ...extra });
const layer = (text) => profile({ bundles: WEB, layerText: text, modules: modules() });
const bundleLayer = (text) => profile({ bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@other/web-all", "@mpd-dsh/mpd"], modules: modules({ "@other/web-all": { ...FOREIGN_PKG, "cordis.patch.yml": text } }) });

// ---- decoys: must ENABLE (false -> mount) ----
const decoys = [
  ["D1 comment-only mention", bundleLayer("# we considered dsh-better-sidebar\n- id: unrelated\n  disabled: true\n")],
  ["D2 comment with apostrophes", bundleLayer("# don't mount dsh-better-sidebar here\n")],
  ["D3 literal disabled:true foreign row", bundleLayer("- insert:\n    - id: web-ui-x\n      name: 'dsh-better-sidebar'\n      disabled: true\n")],
  ["D4 quoted 'true' string disabled row", bundleLayer("- insert:\n    - id: web-ui-x\n      name: \"dsh-better-sidebar\"\n      disabled: 'true'\n")],
  ["D5 YAML boolean True row", bundleLayer("- insert:\n    - id: web-ui-x\n      name: dsh-better-sidebar\n      disabled: True\n")],
  ["D6 disabled:true row plus a comment", bundleLayer("# sidebar note\n- insert:\n    - id: web-ui-x\n      name: dsh-better-sidebar\n      disabled: true  # keep off\n")],
  ["D7 profile layer: disabled:true row", layer("- insert:\n    - id: user-x\n      name: dsh-better-sidebar\n      disabled: true\n")],
  ["D8 home layer: comment-only mention", profile({ bundles: WEB, layerText: "# dsh-better-sidebar is handled by the bundle\n", layerWhere: "home", modules: modules() })],
];
// ---- genuine mounts: must DISABLE (true -> back off) ----
decoys.push(["D10 row literally disabled + a second mention in the same row",
  bundleLayer("- insert:\n    - id: web-ui-x\n      name: 'dsh-better-sidebar'\n      disabled: true\n      extra: 'dsh-better-sidebar'\n")]);
const mounts = [
  ["M1 accepted aggregate shape", bundleLayer("- insert:\n    - id: web-ui-better-sidebar\n      name: 'dsh-better-sidebar'\n")],
  ["M2 bare name", bundleLayer("- insert:\n    - id: web-ui-x\n      name: dsh-better-sidebar\n")],
  ["M3 disabled: false", bundleLayer("- insert:\n    - id: web-ui-x\n      name: dsh-better-sidebar\n      disabled: false\n")],
  ["M4 disabled: !!js \"false\"", bundleLayer("- insert:\n    - id: web-ui-x\n      name: dsh-better-sidebar\n      disabled: !!js \"false\"\n")],
  ["M5 deeper disabled (inside config) counts as mount", bundleLayer("- insert:\n    - id: web-ui-x\n      name: dsh-better-sidebar\n      config:\n        disabled: true\n")],
  ["M6 profile layer mount", profile({ bundles: WEB, layerText: "- insert:\n    - id: user-sidebar\n      name: dsh-better-sidebar\n", layerWhere: "profile", modules: modules() })],
  ["M7 home layer mount", profile({ bundles: WEB, layerText: "- insert:\n    - id: home-sidebar\n      name: dsh-better-sidebar\n", layerWhere: "home", modules: modules() })],
];
// ---- parse misses: must DISABLE (conservative) ----
const parseMiss = [
  ["P1 flow-style mapping", bundleLayer("- insert:\n    - {id: web-ui-x, name: dsh-better-sidebar}\n")],
  ["P2 multi-line name scalar", bundleLayer("- insert:\n    - id: web-ui-x\n      name:\n        dsh-better-sidebar\n")],
  ["P3 YAML anchor + alias", bundleLayer("- &sidebarRow\n  id: web-ui-x\n  name: dsh-better-sidebar\n- insert:\n    - *sidebarRow\n")],
  ["P4 mention only in a config value", bundleLayer("- insert:\n    - id: web-ui-x\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: dsh-better-sidebar\n")],
  ["P5 tab-indented row", bundleLayer("- insert:\n\t- id: web-ui-x\n\t  name: dsh-better-sidebar\n")],
  ["P6 block-scalar name value", bundleLayer("- insert:\n    - id: web-ui-x\n      name: |\n        dsh-better-sidebar\n")],
];
const cases = [];
for (const [label, p] of decoys) cases.push([label, run(p.dir, [WEB_ENTRY]), false]);
for (const [label, p] of mounts) cases.push([label, run(p.dir, [WEB_ENTRY]), true]);
for (const [label, p] of parseMiss) cases.push([label, run(p.dir, [WEB_ENTRY]), true]);
// overlay spellings with a genuine mount + an overlay decoy
{
  const p = profile({ bundles: WEB, modules: modules() });
  const mountYml = join(p.base, "ov-mount.yml"); writeFileSync(mountYml, "- insert:\n    - id: ov\n      name: dsh-better-sidebar\n");
  const decoyYml = join(p.base, "ov-decoy.yml"); writeFileSync(decoyYml, "# dsh-better-sidebar mention only\n");
  cases.push(["M8 --patch mount", run(p.dir, [WEB_ENTRY], ["node", "dsh", "--patch", mountYml]), true]);
  cases.push(["M9 --patch=mount", run(p.dir, [WEB_ENTRY], ["node", "dsh", "--patch=" + mountYml]), true]);
  cases.push(["D9 --patch decoy comment", run(p.dir, [WEB_ENTRY], ["node", "dsh", "--patch", decoyYml]), false]);
}
// happy path + absent package + non-literal name (documented bound)
cases.push(["H1 happy path (no foreign layer)", run(profile({ bundles: WEB, modules: modules() }).dir, [WEB_ENTRY]), false]);
cases.push(["H2 package absent", run(profile({ bundles: ["@deepseek-ai/dsh-base", "@mpd-dsh/mpd"] }).dir, [WEB_ENTRY]), true]);
cases.push(["H3 NON-LITERAL name (shim/other spec) -> ENABLE (bound)", run(bundleLayer("- insert:\n    - id: web-ui-x\n      name: '@other/sidebar-shim/dist/index.js'\n").dir, [WEB_ENTRY]), false]);

console.log("\n--- round-3 probes over the SHIPPED predicate (real fs) ---");
let bad = 0;
for (const [label, got, want] of cases) { const ok = got === want; if (!ok) bad++; console.log((ok ? "OK   " : "DIFF ") + label.padEnd(52) + " -> " + got + " (expected " + want + ")"); }
console.log(bad === 0 ? "\nALL PROBES OK" : `\n${bad} PROBE(S) DIFFER FROM THE EXPECTATION`);
