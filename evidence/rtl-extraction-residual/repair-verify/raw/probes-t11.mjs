// t11 bounded probes: Guard-1 (verify-rows-parity), Guard-2 (verify-vendor), and the
// carrier-hook merge — each driven from the VERBATIM live region, with the slice hashed
// so the extraction is auditable. No repo file is written; everything lives in raw/.
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "/root/dshProj/my-power-dsh";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "probes-t11-out");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const sha = (s) => createHash("sha256").update(s).digest("hex");
const results = {};

// ---------- Guard-1: verify-rows-parity (verbatim slice) ----------
const rowsSrc = readFileSync(join(REPO, "scripts/verify-rows-parity.mjs"), "utf8");
const guard1 = rowsSrc.slice(rowsSrc.indexOf("// Guard-1 (t8 / R7.15)"), rowsSrc.indexOf("if (missing.length || extra.length"));
const mismatch = rowsSrc.slice(rowsSrc.indexOf("if (missing.length || extra.length"), rowsSrc.indexOf('console.log("[verify-rows-parity] ok:'));
results.guard1Slice = { sha256: sha(guard1), lines: guard1.split("\n").length };
results.mismatchSlice = { sha256: sha(mismatch), lines: mismatch.split("\n").length };

function runGuard1(patchSet, installerSet) {
  const missing = [...patchSet].filter((id) => !installerSet.has(id));
  const extra = [...installerSet].filter((id) => !patchSet.has(id));
  const errs = [];
  const consoleStub = { error: (m) => errs.push(String(m)), log: () => {} };
  const processStub = { exit: (c) => { throw { __exit: c }; } };
  const body = guard1 + "\n" + mismatch;
  try {
    new Function("patchSet", "installerSet", "missing", "extra", "patchDup", "installerDup", "console", "process", body)(
      patchSet, installerSet, missing, extra, [], [], consoleStub, processStub,
    );
    return { exit: 0, errs };
  } catch (e) {
    if (e && e.__exit !== undefined) return { exit: e.__exit, errs };
    throw e;
  }
}
const S = (...a) => new Set(a);
results.guard1 = {
  patch_only_empty: runGuard1(S(), S("a", "b")),
  installer_only_empty: runGuard1(S("a", "b"), S()),
  both_empty: runGuard1(S(), S()),
  one_row_delta: runGuard1(S("a", "b"), S("a", "c")),
  real_pair_ok: runGuard1(S("a", "b"), S("a", "b")),
};

// ---------- Guard-2: verify-vendor (verbatim slice) ----------
const vendSrc = readFileSync(join(REPO, "scripts/verify-vendor.mjs"), "utf8");
const g2Start = vendSrc.indexOf("const assetEntries = Object.entries");
const g2End = vendSrc.indexOf("for (const [rel, meta] of assetEntries)");
const guard2 = vendSrc.slice(g2Start, g2End);
results.guard2Slice = { sha256: sha(guard2), lines: guard2.split("\n").length };
function runGuard2(assets) {
  const errs = [];
  const fail = (m) => { errs.push("FAIL " + String(m)); throw { __exit: 1 }; };
  try {
    new Function("lock", "fail", guard2)({ assets }, fail);
    return { exit: 0, errs };
  } catch (e) {
    if (e && e.__exit !== undefined) return { exit: e.__exit, errs };
    throw e;
  }
}
results.guard2 = {
  empty_assets: runGuard2({}),
  underscore_only_assets: runGuard2({ _meta: {} }),
  real_assets: runGuard2({ a: {}, b: {} }),
};

// ---------- Carrier hook merge (verbatim slice wrapped in a function) ----------
const idx = readFileSync(join(REPO, "packages/mpd-agent-teams-plugin/lib/index.js"), "utf8");
const mStart = idx.indexOf("const loadSiliconProfiles = () => {");
const mEnd = idx.indexOf("    //#endregion mpd-delta rtl-ip-carrier");
const hookSlice = idx.slice(mStart, mEnd);
results.hookSlice = { sha256: sha(hookSlice), lines: hookSlice.split("\n").length };
const probeDir = join(OUT, "plug/lib");
mkdirSync(probeDir, { recursive: true });
const probePath = join(probeDir, "merge-probe.mjs");
writeFileSync(probePath, `export function probe(config) {\n${hookSlice}\n  return config.profiles;\n}\n`);

const { probe } = await import(probePath);
const L = probeDir; // walk-up candidates stay inside OUT/plug/**
const CAND = (d) => { let dir = L; for (let i = 0; i < d; i += 1) dir = join(dir, ".."); return join(dir, "node_modules/@mpd-dsh/silicon/presets/rtl-ip.profile.json"); };
const clean = () => { for (const p of [join(OUT, "plug/lib"), join(OUT, "plug"), OUT]) rmSync(join(p, "node_modules"), { recursive: true, force: true }); };
const put = (p, t) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t); };
const warns = [];
const origWarn = console.warn;
console.warn = (...a) => warns.push(a.map(String).join(" "));
const valid = JSON.stringify({ "rtl-ip": { name: "rtl-ip" } });
const marker = JSON.stringify({ "rtl-ip": { name: "rtl-ip-FARTHER" } });
const corrupt = "{ nope";
const loop = (p) => { mkdirSync(dirname(p), { recursive: true }); symlinkSync(p + "--b", p + "--a"); symlinkSync(p + "--a", p + "--b"); symlinkSync(p + "--a", p); };
const dangle = (p) => { mkdirSync(dirname(p), { recursive: true }); symlinkSync(p + "--missing", p); };

function scenario(name, setup) {
  clean();
  warns.length = 0;
  setup();
  const merged = probe({ profiles: { mpd: { name: "mpd" } } });
  return { name, warns: [...warns], warnCount: warns.length, hasRtlIp: Object.prototype.hasOwnProperty.call(merged, "rtl-ip"), rtlName: merged["rtl-ip"] && merged["rtl-ip"].name, hasMpd: Object.prototype.hasOwnProperty.call(merged, "mpd") };
}
results.merge = [
  scenario("d valid nearest", () => { put(CAND(0), valid); put(CAND(1), marker); }),
  scenario("a corrupt nearest + valid farther", () => { put(CAND(0), corrupt); put(CAND(1), marker); }),
  scenario("a2 unreadable (ELOOP) nearest + valid farther", () => { loop(CAND(0)); put(CAND(1), marker); }),
  scenario("a3 all unreadable (ELOOP)", () => { loop(CAND(0)); loop(CAND(1)); }),
  scenario("b all corrupt", () => { put(CAND(0), corrupt); put(CAND(1), corrupt); }),
  scenario("c all absent", () => {}),
  scenario("d2 dangling symlink nearest + valid farther", () => { dangle(CAND(0)); put(CAND(1), marker); }),
];
console.warn = origWarn;
writeFileSync(join(OUT, "probes-t11-result.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
