// Review-lane read-only checks for t6 (no source writes).
// 1. patch `!!js` sidebar guard text  vs  install-profile.mjs SIDEBAR_GUARD const  vs  packed patch row
// 2. packed manifest dependencies arm vs root package.json dependencies arm
// 3. insert-id set in the patch vs the rows install-profile would render
import { readFileSync } from "node:fs";

const root = "/root/dshProj/my-power-dsh";
const P = `${root}/packages/mpd-bundle/cordis.patch.yml`;
const I = `${root}/scripts/install-profile.mjs`;
const PACKED = `${root}/dist/mpd-package`;

const patch = readFileSync(P, "utf8");
const line = patch.split("\n").find((l) => /disabled: !!js "/.test(l) && l.includes("mpdSidebarGuardSeen"));
const m = line ? line.match(/disabled: !!js "([\s\S]*)"\s*$/) : null;
const patchGuard = m ? m[1] : null;

const inst = readFileSync(I, "utf8");
const im = inst.match(/const SIDEBAR_GUARD = ("(?:[^"\\]|\\.)*")/);
const instGuard = im ? JSON.parse(im[1]) : null;
// the installer wraps it in JSON.stringify(...) at render time
const rendered = instGuard === null ? null : JSON.stringify(instGuard);

console.log("patchGuard bytes      :", patchGuard === null ? "NOT FOUND" : patchGuard.length);
console.log("installer const bytes :", instGuard === null ? "NOT FOUND" : instGuard.length);
console.log("PATCH == INSTALLER CONST :", patchGuard === instGuard);
console.log("PATCH == RENDERED SCALAR :", patchGuard === rendered);

try {
  const packedPatch = readFileSync(`${PACKED}/cordis.patch.yml`, "utf8");
  const pline = packedPatch.split("\n").find((l) => /disabled: !!js "/.test(l) && l.includes("mpdSidebarGuardSeen"));
  const pm = pline ? pline.match(/disabled: !!js "([\s\S]*)"\s*$/) : null;
  console.log("PACKED ROW guard bytes   :", pm ? pm[1].length : "NOT FOUND");
  console.log("PACKED == PATCH GUARD    :", !!pm && pm[1] === patchGuard);
} catch (e) {
  console.log("packed patch:", String(e.message));
}

const rootPkg = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
console.log("root dependencies arm    :", JSON.stringify(rootPkg.dependencies));
try {
  const packedPkg = JSON.parse(readFileSync(`${PACKED}/package.json`, "utf8"));
  console.log("packed dependencies arm  :", JSON.stringify(packedPkg.dependencies));
  console.log("PACKED DEPS == ROOT DEPS :", JSON.stringify(packedPkg.dependencies) === JSON.stringify(rootPkg.dependencies));
} catch (e) {
  console.log("packed manifest:", String(e.message));
}

// insert-id sets: patch insert list vs installer rows (both read-only)
const patchIds = [...patch.matchAll(/^\s{4}- id: (\S+)$/gm)].map((x) => x[1]);
const packedIds = (() => {
  try {
    return [...readFileSync(`${PACKED}/cordis.patch.yml`, "utf8").matchAll(/^\s{4}- id: (\S+)$/gm)].map((x) => x[1]);
  } catch { return null; }
})();
console.log("patch insert ids         :", patchIds.length, JSON.stringify(patchIds));
console.log("packed insert ids equal  :", packedIds && JSON.stringify(packedIds) === JSON.stringify(patchIds));

// test the guard against synthetic compositions (pure function, no boot)
const EVAL = new Function("ctx", "expr", "with (ctx) { return eval(expr) }");
const fsmod = await import("node:fs");
const pathmod = await import("node:path");
const os = await import("node:os");
const mkProf = (manifest, modules = {}) => {
  const dir = fsmod.mkdtempSync(pathmod.join(os.tmpdir(), "guardrev-"));
  fsmod.mkdirSync(pathmod.join(dir, "node_modules"), { recursive: true });
  fsmod.writeFileSync(pathmod.join(dir, "package.json"), JSON.stringify(manifest));
  for (const [name, files] of Object.entries(modules)) {
    const p = pathmod.join(dir, "node_modules", name);
    fsmod.mkdirSync(p, { recursive: true });
    for (const [f, c] of Object.entries(files)) fsmod.writeFileSync(pathmod.join(p, f), c);
  }
  return dir;
};
const run = (profileDir, entries, name = "dsh-better-sidebar") => {
  const ctx = {
    loader: { entries: () => entries },
    baseUrl: "file://" + profileDir.replace(/\/$/, "") + "/",
  };
  return EVAL(ctx, patchGuard);
};
const sidebarFiles = { "package.json": JSON.stringify({ name: "dsh-better-sidebar", version: "0.19.0-alpha.1", dsh: { bundle: { patch: "./cordis.patch.yml" } } }), "cordis.patch.yml": "[]" };
const cases = [];
{
  const dir = mkProf({ dsh: { profile: { bundles: ["@mpd-dsh/mpd"] } } }, { "dsh-better-sidebar": sidebarFiles });
  cases.push(["TUI-shape: no web entry, no web layer, pkg present", run(dir, [{ options: { id: "x", name: "@mpd-dsh/mpd" } }]), true]);
}
{
  const dir = mkProf({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } } }, { "dsh-better-sidebar": sidebarFiles });
  cases.push(["web: web-app layer declared, webserver entry present", run(dir, [{ options: { id: "webserver", name: "@deepseek-ai/dsh-host-webserver" } }]), false]);
}
{
  const dir = mkProf({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } } }, { "dsh-better-sidebar": sidebarFiles });
  cases.push(["web: web-app layer declared, webserver entry DISABLED by !!js (raw marker)", run(dir, [{ options: { id: "webserver", name: "@deepseek-ai/dsh-host-webserver", disabled: { __jsExpr: "true" } } }]), true]);
}
{
  const dir = mkProf({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } } }, { "dsh-better-sidebar": sidebarFiles });
  cases.push(["web-app layer declared, webserver entry MISSING at eval time", run(dir, []), true]);
}
{
  // aggregate declared as a layer in dsh.profile.bundles AND its patch mounts the sidebar
  const dir = mkProf({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@linxin666/dsh-web-all", "@mpd-dsh/mpd"] } } }, { "dsh-better-sidebar": sidebarFiles, "@linxin666/dsh-web-all": { "package.json": JSON.stringify({ name: "@linxin666/dsh-web-all", dsh: { bundle: { patch: "./cordis.patch.yml" } } }), "cordis.patch.yml": "[]\n- insert:\n    - id: web-ui-better-sidebar\n      name: 'dsh-better-sidebar'\n" } });
  cases.push(["aggregate layer (IN bundles) mounts it -> disabled", run(dir, [{ options: { id: "webserver", name: "@deepseek-ai/dsh-host-webserver" } }]), true]);
}
{
  // aggregate layer declared BEFORE ours (order-independence) AND resolvable only one level up
  const dir = mkProf({ dsh: { profile: { bundles: ["@linxin666/dsh-web-all", "@mpd-dsh/mpd"] } } }, { "dsh-better-sidebar": sidebarFiles, "@linxin666/dsh-web-all": { "package.json": JSON.stringify({ name: "@linxin666/dsh-web-all", dsh: { bundle: { patch: "./cordis.patch.yml" } } }), "cordis.patch.yml": "- insert:\n    - id: web-ui-better-sidebar\n      name: 'dsh-better-sidebar'\n" } });
  cases.push(["aggregate FIRST in bundles -> disabled (order-independent)", run(dir, []), true]);
}
{
  // aggregate patch mentions BOTH strings (e.g. a comment naming our guard row) -> guard skips it
  const dir = mkProf({ dsh: { profile: { bundles: ["@linxin666/dsh-web-all", "@mpd-dsh/mpd"] } } }, { "dsh-better-sidebar": sidebarFiles, "@linxin666/dsh-web-all": { "package.json": JSON.stringify({ name: "@linxin666/dsh-web-all", dsh: { bundle: { patch: "./cordis.patch.yml" } } }), "cordis.patch.yml": "- insert:\n    - id: web-ui-better-sidebar\n      name: 'dsh-better-sidebar'\n# note: the mpd-better-sidebar row may also mount this\n" } });
  cases.push(["other layer's patch mentions mpd-better-sidebar too -> guard state", run(dir, []), true]);
}
{
  const dir = mkProf({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@mpd-dsh/mpd"] } } });
  cases.push(["pkg absent -> disabled", run(dir, [{ options: { id: "webserver", name: "@deepseek-ai/dsh-host-webserver" } }]), true]);
}
{
  const dir = mkProf({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@mpd-dsh/mpd"] } } }, { "dsh-better-sidebar": sidebarFiles });
  cases.push(["no ctx.loader -> throw path returns disabled", (() => { try { return EVAL({ baseUrl: "file://" + dir + "/" }, patchGuard) } catch (e) { return "THREW " + e.message } })(), true]);
}
{
  const dir = mkProf({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@mpd-dsh/mpd"] } } }, { "dsh-better-sidebar": sidebarFiles });
  cases.push(["baseUrl undefined -> throw path returns disabled", (() => { try { return EVAL({ loader: { entries: () => [] } }, patchGuard) } catch (e) { return "THREW " + e.message } })(), true]);
}
{
  // F4 probe: a FOREIGN declared layer that really mounts the package, but whose patch text
  // also mentions our row id (comment/doc) -> the guard's `indexOf('mpd-better-sidebar') < 0`
  // exclusion skips it. Web plane present, so the guard reaches the final ENABLED return.
  const dir = mkProf({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@other/web-all", "@mpd-dsh/mpd"] } } }, { "dsh-better-sidebar": sidebarFiles, "@other/web-all": { "package.json": JSON.stringify({ name: "@other/web-all", dsh: { bundle: { patch: "./cordis.patch.yml" } } }), "cordis.patch.yml": "- insert:\n    - id: web-ui-better-sidebar\n      name: 'dsh-better-sidebar'\n# see also mpd-better-sidebar\n" } });
  cases.push(["F4: foreign layer mounts it AND mentions mpd-better-sidebar -> guard state", run(dir, [{ options: { id: "webserver", name: "@deepseek-ai/dsh-host-webserver" } }]), false]);
}
{
  // F1 probe: no bundle layer mounts it, package resolvable, web plane present
  // -> the guard enables, so a PROFILE/HOME/--patch overlay row (invisible to the guard)
  // would be the second /sidebar/api registration.
  const dir = mkProf({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } } }, { "dsh-better-sidebar": sidebarFiles });
  cases.push(["F1: overlay-only mount (invisible to guard) -> guard state", run(dir, [{ options: { id: "webserver", name: "@deepseek-ai/dsh-host-webserver" } }]), false]);
}
console.log("\n--- synthetic composition probes (guard evaluated verbatim, real fs) ---");
for (const [label, got, want] of cases) console.log((got === want ? "OK   " : "DIFF ") + label + " -> " + got + " (expected " + want + ")");
