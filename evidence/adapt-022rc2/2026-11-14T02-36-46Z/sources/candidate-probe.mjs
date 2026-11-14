// T1 candidate probe — measure T2's SHIPPED guard, not a paraphrase of it.
//
// The guard text is EXTRACTED from the working tree's `cordis.patch.yml` (all six rows), then
// evaluated with the LOADER'S OWN evaluation Function (`with (ctx) { return eval(expr) }`, extracted
// from the installed `cordis-plugin-loader`), against REAL paths:
//   * `process.argv[1]` is the real `.../@deepseek-ai/dsh/lib/bin.js` of each installed harness;
//   * `ctx.baseUrl` is the real profile directory URL of each mount arm.
// So the probe stage observations below are what the guard would ACTUALLY read on those hosts.
//
// Matrix: each host against each arm's REAL profile (same-generation and MIXED), plus synthetic
// ambiguity/override fixtures. Every row also evaluates the T1 REFERENCE predicate on the same input,
// so a semantic difference between "stage 1 is authoritative" and "the probes must agree" is visible
// side by side instead of argued.

import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { renderGuard } from "./predicate.mjs";

const ROOT = dirname(new URL(import.meta.url).pathname);
const REPO = join(ROOT, "..", "..");
const OUT = join(ROOT, "candidate", "result.json");
const CANDIDATE_PATCH = join(REPO, "cordis.patch.yml");

const ROW_IDS = ["mpd-agent-team", "mpd-tool-agent-team", "mpd-ui-agent-team", "mpd-agent-team-rc2", "mpd-tool-agent-team-rc2", "mpd-ui-agent-team-rc2"];

/** @param patchText The patch text. @param rowId The row id. @returns The row's `!!js` guard text. */
function extractGuard(patchText, rowId) {
  const lines = patchText.split(String.fromCharCode(10));
  const at = lines.findIndex((line) => line.trim() === "- id: " + rowId);
  if (at < 0) throw new Error("row not found: " + rowId);
  for (let i = at + 1; i < Math.min(at + 14, lines.length); i += 1) {
    const line = lines[i].trim();
    if (line.startsWith("- id: ")) break;
    if (line.startsWith("disabled: !!js ")) {
      const first = line.indexOf('"');
      const last = line.lastIndexOf('"');
      return line.slice(first + 1, last);
    }
  }
  throw new Error("no !!js disabled on " + rowId);
}

/** @param homePath `@deepseek-ai/dsh/package.json` of an installed harness. @returns The loader's eval body. */
function loaderBody(homePath) {
  const require = createRequire(homePath);
  const manifest = require.resolve("@deepseek-ai/cordis-plugin-loader/package.json");
  const source = readFileSync(join(dirname(manifest), "lib", "index.js"), "utf8");
  const match = /const evaluate = new Function\("ctx", "expr", `([\s\S]*?)`\);/.exec(source);
  if (match === null) throw new Error("loader evaluate body not found");
  return { file: join(dirname(manifest), "lib", "index.js"), body: match[1] };
}

/**
 * The FIVE observations the lead asked for, measured independently of the guard's own reporting.
 * @param argv1 The argv[1] value the guard would see.
 * @param baseUrl The `ctx.baseUrl` the guard would see.
 * @returns The observation record.
 */
function observe(argv1, baseUrl) {
  const fs = { read: (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } } };
  const real = (() => { try { return realpathSync(argv1); } catch { return null; } })();
  let nearest = null;
  if (real !== null) {
    let dir = dirname(real);
    for (let level = 0; level < 40; level += 1) {
      const manifest = fs.read(join(dir, "package.json"));
      if (manifest !== null && manifest.name === "@deepseek-ai/dsh" && typeof manifest.version === "string") {
        nearest = { dir, version: manifest.version };
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  let profileDir = "";
  if (baseUrl !== "") {
    try {
      const asPath = fileURLToPath(baseUrl);
      profileDir = asPath.endsWith("/") ? asPath.slice(0, -1) : asPath;
    } catch { profileDir = ""; }
  }
  let profileHarness = null;
  let insideProfile = null;
  if (profileDir !== "") {
    try {
      const require = createRequire(join(profileDir, "package.json"));
      const resolved = realpathSync(require.resolve("@deepseek-ai/dsh/package.json"));
      const rel = relative(realpathSync(profileDir), resolved);
      insideProfile = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
      const manifest = fs.read(resolved);
      profileHarness = { resolved, version: manifest?.version ?? null, insideProfile };
    } catch (error) {
      profileHarness = { resolved: null, version: null, insideProfile: false, error: String(error && error.message ? error.message : error) };
    }
  }
  const presence = {};
  for (const pkg of ["@deepseek-ai/dsh-experimental-agent-team", "@deepseek-ai/dsh-agent-team"]) {
    presence[pkg] = profileDir === "" ? false : (() => { try { return statSync(join(profileDir, "node_modules", pkg)).isDirectory(); } catch { return false; } })();
  }
  return { argv1, argv1Realpath: real, nearestHarness: nearest, baseUrl, profileDir, profileHarness, presence };
}

const candidatePatch = readFileSync(CANDIDATE_PATCH, "utf8");
const candidate = Object.fromEntries(ROW_IDS.map((id) => [id, extractGuard(candidatePatch, id)]));
const loaders = [
  loaderBody(join(REPO, ".qa-tmp", "dsh-022", "lib", "node_modules", "@deepseek-ai", "dsh", "package.json")),
  loaderBody(join(REPO, ".qa-tmp", "dsh-022rc2", "lib", "node_modules", "@deepseek-ai", "dsh", "package.json")),
];
const evaluateWith = new Function("ctx", "expr", loaders[0].body);
const reference = { old: renderGuard("old"), new: renderGuard("new") };

const RC1_BIN = join(REPO, ".qa-tmp", "dsh-022", "lib", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const RC2_BIN = join(REPO, ".qa-tmp", "dsh-022rc2", "lib", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const RC1_PROFILE = join(ROOT, "run", "rc1", "dsh-home", "profiles", "t1");
const RC2_PROFILE = join(ROOT, "run", "rc2", "dsh-home", "profiles", "t1");
const profileUrl = (dir) => "file://" + dir + "/";

const result = {
  at: new Date().toISOString(),
  candidatePatch: CANDIDATE_PATCH,
  candidateGuardBytes: Object.fromEntries(Object.entries(candidate).map(([id, text]) => [id, text.length])),
  loadersIdentical: loaders.length === 2 && loaders[0].body === loaders[1].body,
  loaderFile: loaders[0].file,
  arms: [],
};

/** One matrix cell. */
function cell(label, argv1, baseUrl, envOverride) {
  const saved = { argv1: process.argv[1], log: process.env.MPD_MCP_LOG_DIR, root: process.env.DSH_WORKSPACE_ROOT, over: process.env.MPD_DSH_TEAM_ROWS };
  const logDir = mkdtempSync(join(tmpdir(), "t1-cand-"));
  process.env.MPD_MCP_LOG_DIR = logDir;
  delete process.env.DSH_WORKSPACE_ROOT;
  if (envOverride === undefined) delete process.env.MPD_DSH_TEAM_ROWS;
  else process.env.MPD_DSH_TEAM_ROWS = envOverride;
  process.argv[1] = argv1;
  delete globalThis.__mpdTeamRowsGuardSeen;
  delete globalThis.__mpdTeamRowsGeneration;
  delete globalThis.__mpdTeamRows;
  delete globalThis.__mpdTuiPlaneGuard;
  const observed = observe(argv1, baseUrl);
  const ctx = { baseUrl, loader: { entries: () => [] } };
  const record = { label, override: envOverride ?? null, observed, candidate: {}, reference: {}, logs: {} };
  for (const id of ROW_IDS) record.candidate[id] = evaluateWith(ctx, candidate[id]);
  record.reference.oldDisabled = evaluateWith(ctx, reference.old);
  record.reference.newDisabled = evaluateWith(ctx, reference.new);
  const logFile = join(logDir, ".mpd", "logs", "mpd-patch-guards.log");
  record.logs.candidate = existsSync(logFile) ? readFileSync(logFile, "utf8").split(String.fromCharCode(10)).filter((line) => line !== "") : [];
  process.argv[1] = saved.argv1;
  for (const [key, value] of Object.entries({ MPD_MCP_LOG_DIR: saved.log, DSH_WORKSPACE_ROOT: saved.root, MPD_DSH_TEAM_ROWS: saved.over })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  record.verdict = {
    candidateOldEnabled: record.candidate["mpd-agent-team"] !== true && record.candidate["mpd-tool-agent-team"] !== true && record.candidate["mpd-ui-agent-team"] !== true,
    candidateNewEnabled: record.candidate["mpd-agent-team-rc2"] !== true && record.candidate["mpd-tool-agent-team-rc2"] !== true && record.candidate["mpd-ui-agent-team-rc2"] !== true,
    referenceOldEnabled: record.reference.oldDisabled !== true,
    referenceNewEnabled: record.reference.newDisabled !== true,
  };
  result.arms.push(record);
  return record;
}

// 1) The REAL hosts against the REAL profiles of the two mount arms (same-generation).
cell("rc1-host + rc1-profile", RC1_BIN, profileUrl(RC1_PROFILE));
cell("rc2-host + rc2-profile", RC2_BIN, profileUrl(RC2_PROFILE));
// 2) MIXED: each host against the OTHER generation's real profile. Probe 1 and the profile's
//    package presence then point in opposite directions - the case the "probes must agree" rule
//    turns into ambiguity.
cell("rc1-host + rc2-profile (MIXED)", RC1_BIN, profileUrl(RC2_PROFILE));
cell("rc2-host + rc1-profile (MIXED)", RC2_BIN, profileUrl(RC1_PROFILE));
// 3) The override ladder.
cell("rc1-host + rc2-profile, MPD_DSH_TEAM_ROWS=new", RC1_BIN, profileUrl(RC2_PROFILE), "new");
cell("rc1-host + rc2-profile, MPD_DSH_TEAM_ROWS=old", RC1_BIN, profileUrl(RC2_PROFILE), "old");
cell("rc1-host + rc2-profile, MPD_DSH_TEAM_ROWS=off", RC1_BIN, profileUrl(RC2_PROFILE), "off");
cell("rc2-host + rc1-profile, MPD_DSH_TEAM_ROWS=nonsense", RC2_BIN, profileUrl(RC1_PROFILE), "nonsense");
// 4) Nothing readable at all: no argv1, no baseUrl.
cell("no argv1, no baseUrl (unreadable)", join(tmpdir(), "t1-absent-bin.js"), "");
// 5) A profile whose own harness lives INSIDE it at the other generation.
const insideProfile = mkdtempSync(join(tmpdir(), "t1-profile-harness-"));
mkdirSync(join(insideProfile, "node_modules", "@deepseek-ai", "dsh"), { recursive: true });
writeFileSync(join(insideProfile, "package.json"), JSON.stringify({ name: "mixed-profile", private: true }));
writeFileSync(join(insideProfile, "node_modules", "@deepseek-ai", "dsh", "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.2.2-rc.2" }));
cell("rc1-host + profile-local rc.2 harness (stage 2 disagrees)", RC1_BIN, profileUrl(insideProfile));

result.summary = result.arms.map((arm) => ({
  label: arm.label,
  nearestHarness: arm.observed.nearestHarness?.version ?? null,
  profileHarness: arm.observed.profileHarness?.version ?? null,
  profileHarnessInsideProfile: arm.observed.profileHarness?.insideProfile ?? null,
  presenceOld: arm.observed.presence["@deepseek-ai/dsh-experimental-agent-team"],
  presenceNew: arm.observed.presence["@deepseek-ai/dsh-agent-team"],
  candidate: { oldEnabled: arm.verdict.candidateOldEnabled, newEnabled: arm.verdict.candidateNewEnabled },
  reference: { oldEnabled: arm.verdict.referenceOldEnabled, newEnabled: arm.verdict.referenceNewEnabled },
  logLines: arm.logs.candidate.length,
}));
writeFileSync(OUT, JSON.stringify(result, null, 2) + String.fromCharCode(10));
console.log("label".padEnd(46) + "nearest  profile  presOld presNew | CANDIDATE old/new | REFERENCE old/new | lines");
for (const row of result.summary) {
  console.log(
    row.label.padEnd(46) +
      String(row.nearestHarness).padEnd(9) +
      String(row.profileHarness).padEnd(9) +
      String(row.presenceOld).padEnd(8) +
      String(row.presenceNew).padEnd(8) +
      "| " + String(row.candidate.oldEnabled).padEnd(6) + String(row.candidate.newEnabled).padEnd(16) +
      "| " + String(row.reference.oldEnabled).padEnd(6) + String(row.reference.newEnabled).padEnd(16) +
      "| " + row.logLines,
  );
}
console.log("loadersIdentical=" + result.loadersIdentical + " -> " + OUT);
