// Round-2 review checks (t12) — read-only against the repository.
// Evaluates the SHIPPED repaired guard text verbatim over real-filesystem compositions.
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const root = "/root/dshProj/my-power-dsh";
const patch = readFileSync(`${root}/packages/mpd-bundle/cordis.patch.yml`, "utf8");
const line = patch.split("\n").find((l) => /disabled: !!js "/.test(l) && l.includes("mpdSidebarGuardSeen"));
const patchGuard = line.match(/disabled: !!js "([\s\S]*)"\s*$/)[1];
const inst = readFileSync(`${root}/scripts/install-profile.mjs`, "utf8");
const instGuard = JSON.parse(inst.match(/const SIDEBAR_GUARD = ("(?:[^"\\]|\\.)*")/)[1]);
const packedPatch = readFileSync(`${root}/dist/mpd-package/cordis.patch.yml`, "utf8");
const packedLine = packedPatch.split("\n").find((l) => /disabled: !!js "/.test(l) && l.includes("mpdSidebarGuardSeen"));
const packedGuard = packedLine ? packedLine.match(/disabled: !!js "([\s\S]*)"\s*$/)[1] : null;
const h = (s) => createHash("sha256").update(s).digest("hex");

console.log("patch guard      :", patchGuard.length, h(patchGuard));
console.log("installer const  :", instGuard.length, "EQUAL:", patchGuard === instGuard);
console.log("packed guard     :", packedGuard ? packedGuard.length : "NOT FOUND", packedGuard ? h(packedGuard) : "-");
console.log("PACKED == PATCH  :", packedGuard === patchGuard);
console.log("reads evaluated .disabled getter:", /\.disabled\b/.test(patchGuard.replace(/e\.options\.disabled/g, "RAW")) ? "SUSPECT" : "no (only raw e.options.disabled)");

const EVAL = new Function("ctx", "expr", "with (ctx) { return eval(expr) }");
const SIDEBAR = {
  "package.json": JSON.stringify({ name: "dsh-better-sidebar", version: "0.19.0-alpha.1", dsh: { bundle: { patch: "./cordis.patch.yml" } } }),
  "cordis.patch.yml": "[]\n",
};
const OWN = {
  "package.json": JSON.stringify({ name: "@mpd-dsh/mpd", dsh: { bundle: { patch: "./packages/mpd-bundle/cordis.patch.yml" } } }),
  "packages/mpd-bundle/cordis.patch.yml": patch,
};

let seq = 0;
function profile({ bundles, modules = {}, profilePatch = null, homePatch = null }) {
  const base = mkdtempSync(join(tmpdir(), `r2-${seq++}-`));
  const dir = join(base, "dsh", "profiles", "w");
  const mods = join(dir, "node_modules");
  mkdirSync(mods, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "dsh-profile-w", dsh: { profile: { bundles } } }));
  if (profilePatch !== null) writeFileSync(join(dir, "cordis.patch.yml"), profilePatch);
  if (homePatch !== null) writeFileSync(join(base, "dsh", "cordis.patch.yml"), homePatch);
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
  const saveArgv = process.argv;
  const saveHome = process.env.DSH_HOME;
  process.argv = argv;
  process.env.DSH_HOME = join(dir, "..", "..");
  try {
    return EVAL({ loader: { entries: () => entries }, baseUrl: "file://" + dir.replace(/\/$/, "") + "/" }, patchGuard);
  } finally {
    process.argv = saveArgv;
    if (saveHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = saveHome;
  }
};
const FOREIGN_MOUNT = "- insert:\n    - id: web-ui-better-sidebar\n      name: 'dsh-better-sidebar'\n";
const FOREIGN_MOUNT_AND_MENTION = FOREIGN_MOUNT + "# see also mpd-better-sidebar\n";
const modules = (extra = {}) => ({ "dsh-better-sidebar": SIDEBAR, "@mpd-dsh/mpd": OWN, ...extra });

const cases = [];
const add = (label, got, want) => cases.push([label, got, want]);

// happy web composition (clause 5 must be true from the ENTRY alone)
add("P1 web: own layer + webserver entry -> ENABLED", run(profile({ bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"], modules: modules() }).dir, [WEB_ENTRY]), false);
add("P1b web: own layer not installed as a dir (unreadable) -> ENABLED", run(profile({ bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"], modules: { "dsh-better-sidebar": SIDEBAR } }).dir, [WEB_ENTRY]), false);
add("P2 web layer declared but webserver entry MISSING -> DISABLED (fail-closed)", run(profile({ bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"], modules: modules() }).dir, []), true);
add("P3 webserver entry disabled by !!js marker -> DISABLED (R3)", run(profile({ bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"], modules: modules() }).dir, [{ options: { id: "webserver", name: "@deepseek-ai/dsh-host-webserver", disabled: { __jsExpr: "true" } } }]), true);
add("P3b webserver entry raw disabled:false -> ENABLED", run(profile({ bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"], modules: modules() }).dir, [{ options: { id: "webserver", name: "@deepseek-ai/dsh-host-webserver", disabled: false } }]), false);
add("P4 foreign layer mounts + mentions our id -> DISABLED (R4)", run(profile({ bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@other/web-all", "@mpd-dsh/mpd"], modules: modules({ "@other/web-all": { "package.json": JSON.stringify({ name: "@other/web-all", dsh: { bundle: { patch: "./cordis.patch.yml" } } }), "cordis.patch.yml": FOREIGN_MOUNT_AND_MENTION } }) }).dir, [WEB_ENTRY]), true);
add("P5 foreign layer mounts (no mention) -> DISABLED", run(profile({ bundles: ["@deepseek-ai/dsh-base", "@other/web-all", "@mpd-dsh/mpd"], modules: modules({ "@other/web-all": { "package.json": JSON.stringify({ name: "@other/web-all", dsh: { bundle: { patch: "./cordis.patch.yml" } } }), "cordis.patch.yml": FOREIGN_MOUNT } }) }).dir, [WEB_ENTRY]), true);
add("P5b foreign layer mounts, ordered FIRST -> DISABLED (order-independent)", run(profile({ bundles: ["@other/web-all", "@mpd-dsh/mpd"], modules: modules({ "@other/web-all": { "package.json": JSON.stringify({ name: "@other/web-all", dsh: { bundle: { patch: "./cordis.patch.yml" } } }), "cordis.patch.yml": FOREIGN_MOUNT } }) }).dir, [WEB_ENTRY]), true);
add("P6 profile layer mentions it -> DISABLED (R1a)", run(profile({ bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"], modules: modules(), profilePatch: "# user overlay\n- insert:\n    - id: my-sidebar\n      name: dsh-better-sidebar\n" }).dir, [WEB_ENTRY]), true);
add("P7 home layer mentions it -> DISABLED (R1b)", run(profile({ bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"], modules: modules(), homePatch: "- insert:\n    - id: home-sidebar\n      name: dsh-better-sidebar\n" }).dir, [WEB_ENTRY]), true);
{
  const p = profile({ bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"], modules: modules() });
  const overlay = join(p.base, "overlay-mention.yml");
  writeFileSync(overlay, FOREIGN_MOUNT);
  add("P8a --patch <file> overlay mounts -> DISABLED (R1c)", run(p.dir, [WEB_ENTRY], ["node", "dsh", "--profile", "w", "--patch", overlay]), true);
  add("P8b --patch=<file> spelling -> DISABLED (R1c)", run(p.dir, [WEB_ENTRY], ["node", "dsh", "--profile", "w", `--patch=${overlay}`]), true);
  const clean = join(p.base, "overlay-clean.yml");
  writeFileSync(clean, "- id: unrelated\n  disabled: true\n");
  add("P9 --patch overlay that does NOT mention it -> ENABLED", run(p.dir, [WEB_ENTRY], ["node", "dsh", "--profile", "w", "--patch", clean]), false);
}
add("P10 package absent -> DISABLED", run(profile({ bundles: ["@deepseek-ai/dsh-base", "@mpd-dsh/mpd"] }).dir, [WEB_ENTRY]), true);
add("P11 no ctx.loader -> throw path DISABLED", (() => { try { return EVAL({ baseUrl: "file:///nonexistent/" }, patchGuard); } catch (e) { return "THREW " + e.message; } })(), true);
add("P12 webserver entry but NO web plane layer (custom web bundle) + own layer -> ENABLED", run(profile({ bundles: ["@custom/web", "@mpd-dsh/mpd"], modules: modules() }).dir, [WEB_ENTRY]), false);

console.log("\n--- round-2 synthetic composition probes (shipped guard verbatim, real fs) ---");
let bad = 0;
for (const [label, got, want] of cases) {
  const ok = got === want;
  if (!ok) bad++;
  console.log((ok ? "OK   " : "DIFF ") + label + " -> " + got + " (expected " + want + ")");
}
console.log(bad === 0 ? "\nALL PROBES OK" : `\n${bad} PROBE(S) DIFFER FROM THE EXPECTATION`);
