// T1 unit probe — evaluate the SIX guard expressions under the LOADER'S OWN evaluation shape.
//
// The loader evaluates a `!!js` `disabled` value with
//   `new Function("ctx", "expr", "with (ctx) { return eval(expr) }")`
// (`cordis-plugin-loader`, `evaluate`, called from `Entry._resolveDisabled`). This probe extracts
// that Function BODY from each installed loader (rc.1 and rc.2), asserts the two are identical, and
// uses it verbatim - so the harness here is not a paraphrase of the dialect, it is the dialect.
//
// Each arm is a real filesystem fixture: a fake argv[1] tree, a fake profile tree, and a fake
// harness manifest, so the guards do their real reads. Every arm also asserts the ONE log line.

import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { composeTuiAndGeneration, hazardOf, renderGuard } from "./predicate.mjs";

const ROOT = dirname(new URL(import.meta.url).pathname);
const FIX = process.env.T1_FIX ?? mkdtempSync(join(tmpdir(), "t1-fixtures-"));
const LOADER_HOMES = [join(ROOT, "..", "dsh-022", "lib", "node_modules", "@deepseek-ai", "dsh", "package.json"), join(ROOT, "..", "dsh-022rc2", "lib", "node_modules", "@deepseek-ai", "dsh", "package.json")];

/** @param file A path to write JSON at. @param value The value to serialize. */
const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
};

/** @param file A path to create empty. */
const touch = (file) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "");
};

/**
 * Read the loader's own eval body out of an installed harness.
 * @param homePath Absolute path of `@deepseek-ai/dsh/package.json`.
 * @returns `{ home, loader, body }`.
 */
function loaderBody(homePath) {
  const require = createRequire(homePath);
  const loaderManifest = require.resolve("@deepseek-ai/cordis-plugin-loader/package.json");
  const source = readFileSync(join(dirname(loaderManifest), "lib", "index.js"), "utf8");
  const match = /const evaluate = new Function\("ctx", "expr", `([\s\S]*?)`\);/.exec(source);
  if (match === null) throw new Error("could not extract the loader's evaluate body from " + loaderManifest);
  return { home: dirname(homePath), loader: join(dirname(loaderManifest), "lib", "index.js"), body: match[1] };
}

/**
 * Build one fake harness tree.
 * @param dir The fixture root.
 * @param version The `@deepseek-ai/dsh` version the manifest carries.
 * @param layout `node_modules` (standard install) or `adjacent` (`@deepseek-ai/dsh` beside argv1).
 * @param raw When set, the manifest body is written verbatim instead of the JSON object.
 */
function harnessFixture(dir, version, layout, raw) {
  const manifest = layout === "adjacent" ? join(dir, "@deepseek-ai", "dsh", "package.json") : join(dir, "node_modules", "@deepseek-ai", "dsh", "package.json");
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(manifest, raw ?? JSON.stringify({ name: "@deepseek-ai/dsh", version }, null, 2));
  touch(join(dir, "bin", "dsh"));
  return join(dir, "bin", "dsh");
}

/**
 * Build a fake profile tree whose `node_modules` carries the given packages.
 * @param dir The fixture root.
 * @param packages Package-name -> version pairs to materialize.
 * @returns The `cordis.patch.yml` URL the loader would pass as `baseUrl`.
 */
function profileFixture(dir, packages) {
  writeJson(join(dir, "profile", "package.json"), { name: "fixture-profile", private: true });
  for (const [pkg, version] of Object.entries(packages)) {
    writeJson(join(dir, "profile", "node_modules", pkg, "package.json"), { name: pkg, version });
  }
  const patch = join(dir, "profile", "cordis.patch.yml");
  writeFileSync(patch, "[]" + String.fromCharCode(10));
  return new URL("file://" + patch).href;
}

/** One expected outcome. */
const EXPECT = [
  ["rc1-standard-install", { argv1: "rc1n/bin/dsh", baseUrl: null, env: {}, old: false, new: true, source: "argv1", generation: "old" }],
  ["rc1-adjacent-manifest", { argv1: "rc1a/bin/dsh", baseUrl: null, env: {}, old: false, new: true, source: "argv1", generation: "old" }],
  ["rc2-symlinked-launcher-realpath", { argv1: "rc2l/bin/dsh", baseUrl: null, env: {}, old: true, new: false, source: "argv1", generation: "new" }],
  ["rc1-0.2.1-rc.5", { argv1: "rc215/bin/dsh", baseUrl: null, env: {}, old: false, new: true, source: "argv1", generation: "old" }],
  ["rc2-0.2.2-rc.10-numeric", { argv1: "rc210/bin/dsh", baseUrl: null, env: {}, old: true, new: false, source: "argv1", generation: "new" }],
  ["baseUrl-only", { argv1: "none/bin/dsh", baseUrl: "base", env: {}, old: true, new: false, source: "baseUrl", generation: "new" }],
  ["presence-only-new", { argv1: "none/bin/dsh", baseUrl: "pres", env: {}, old: true, new: false, source: "presence", generation: "new" }],
  ["presence-both-ambiguous", { argv1: "none/bin/dsh", baseUrl: "pboth", env: {}, old: true, new: true, source: "none", generation: "ambiguous" }],
  ["presence-ancestor-leak-ambiguous", { argv1: "leak/bin/dsh", baseUrl: "leak", env: {}, old: true, new: true, source: "none", generation: "ambiguous" }],
  ["malformed-manifest-ambiguous", { argv1: "bad/bin/dsh", baseUrl: null, env: {}, old: true, new: true, source: "none", generation: "ambiguous" }],
  ["no-signal-ambiguous", { argv1: "none/bin/dsh", baseUrl: null, env: {}, old: true, new: true, source: "none", generation: "ambiguous" }],
  ["override-old-on-rc2", { argv1: "rc2l/bin/dsh", baseUrl: null, env: { MPD_DSH_TEAM_ROWS: "old" }, old: false, new: true, source: "override", generation: "old" }],
  ["override-new-on-rc1", { argv1: "rc1n/bin/dsh", baseUrl: null, env: { MPD_DSH_TEAM_ROWS: "new" }, old: true, new: false, source: "override", generation: "new" }],
  ["override-off-on-rc2", { argv1: "rc2l/bin/dsh", baseUrl: null, env: { MPD_DSH_TEAM_ROWS: "off" }, old: true, new: true, source: "override", generation: "ambiguous" }],
  ["throwing-ctx-baseUrl-thunk", { argv1: "rc2l/bin/dsh", baseUrl: "THROW", env: {}, old: true, new: true, source: "threw", generation: "threw" }],
];

/** Build every fixture once. */
function buildFixtures() {
  mkdirSync(FIX, { recursive: true });
  harnessFixture(join(FIX, "rc1n"), "0.2.2-rc.1", "node_modules");
  harnessFixture(join(FIX, "rc1a"), "0.2.1-rc.5", "adjacent");
  harnessFixture(join(FIX, "rc215"), "0.2.1-rc.5", "node_modules");
  harnessFixture(join(FIX, "rc210"), "0.2.2-rc.10", "node_modules");
  harnessFixture(join(FIX, "bad"), "0.0.0", "node_modules", "{ this is not JSON");
  touch(join(FIX, "none", "bin", "dsh"));
  // A symlinked launcher: the literal argv[1] path has no harness above it, the realpath does.
  harnessFixture(join(FIX, "rc2link"), "0.2.2-rc.2", "node_modules");
  touch(join(FIX, "rc2link", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"));
  mkdirSync(join(FIX, "rc2l", "bin"), { recursive: true });
  symlinkSync(join(FIX, "rc2link", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"), join(FIX, "rc2l", "bin", "dsh"));
  // A harness tree for the plain rc2 argv1 arm, decoupled from the symlink fixture.
  harnessFixture(join(FIX, "rc2n"), "0.2.2-rc.2", "node_modules");
  return {
    base: profileFixture(join(FIX, "base"), { "@deepseek-ai/dsh": "0.2.2-rc.2" }),
    pres: profileFixture(join(FIX, "pres"), { "@deepseek-ai/dsh-agent-team": "0.2.2-rc.2" }),
    pboth: profileFixture(join(FIX, "pboth"), { "@deepseek-ai/dsh-agent-team": "0.2.2-rc.2", "@deepseek-ai/dsh-experimental-agent-team": "0.2.2-rc.1" }),
    // A profile that sits INSIDE this repository: it declares only the NEW family, but resolution
    // walks up into the repo's own node_modules, which declares the OLD one. This arm exists to make
    // that leakage a MEASURED bound (presence => both => ambiguous => both sets disabled), not a guess.
    leak: (() => {
      const dir = join(ROOT, "leak");
      rmSync(dir, { recursive: true, force: true });
      touch(join(dir, "bin", "dsh"));
      return profileFixture(dir, { "@deepseek-ai/dsh-agent-team": "0.2.2-rc.2" });
    })(),
  };
}

/** @returns The verdict rows. */
function run() {
  const bodies = LOADER_HOMES.filter((home) => existsSync(home)).map(loaderBody);
  const fixtures = buildFixtures();
  const out = { fixtures: FIX, loaders: bodies.map((b) => ({ loader: b.loader, body: b.body })), bodiesIdentical: bodies.length === 2 && bodies[0].body === bodies[1].body, arms: [], rendered: {} };

  // The exact dialect: the Function body extracted from the installed loader.
  const evaluateWith = new Function("ctx", "expr", bodies[0].body);
  const guardOld = renderGuard("old");
  const guardNew = renderGuard("new");
  out.rendered = { oldBytes: guardOld.length, newBytes: guardNew.length, oldHazard: hazardOf(guardOld), newHazard: hazardOf(guardNew) };

  // Rows 1-2 compose the SHIPPED TUI clause verbatim with the generation half.
  const patchText = readFileSync(join(ROOT, "..", "..", "cordis.patch.yml"), "utf8");
  const clauseOf = (rowId) => {
    const lines = patchText.split(String.fromCharCode(10));
    const at = lines.findIndex((line) => line.trim() === "- id: " + rowId);
    if (at < 0) throw new Error("row not found: " + rowId);
    for (let i = at + 1; i < Math.min(at + 8, lines.length); i += 1) {
      const line = lines[i].trim();
      if (line.startsWith("disabled: !!js ")) {
        const first = line.indexOf('"');
        const last = line.lastIndexOf('"');
        return line.slice(first + 1, last);
      }
      if (line.startsWith("- id: ")) break;
    }
    throw new Error("no !!js disabled on " + rowId);
  };
  const composed = {
    oldAgent: composeTuiAndGeneration(clauseOf("mpd-agent-team"), "old"),
    oldTool: composeTuiAndGeneration(clauseOf("mpd-tool-agent-team"), "old"),
    newAgent: composeTuiAndGeneration(clauseOf("mpd-agent-team"), "new"),
    newTool: composeTuiAndGeneration(clauseOf("mpd-tool-agent-team"), "new"),
  };
  out.rendered.composed = Object.fromEntries(Object.entries(composed).map(([key, text]) => [key, { bytes: text.length, hazard: hazardOf(text) }]));

  /** A fresh log directory per arm, so each arm's line is attributable. */
  let armIndex = 0;
  for (const [label, spec] of EXPECT) {
    armIndex += 1;
    // Every arm runs in a fresh process-global ledger, like a fresh boot.
    delete globalThis.__mpdTeamRows;
    const logDir = join(tmpdir(), "t1-unit-log-" + process.pid + "-" + armIndex);
    rmSync(logDir, { recursive: true, force: true });
    mkdirSync(logDir, { recursive: true });
    const saved = { MPD_MCP_LOG_DIR: process.env.MPD_MCP_LOG_DIR, DSH_WORKSPACE_ROOT: process.env.DSH_WORKSPACE_ROOT, MPD_DSH_TEAM_ROWS: process.env.MPD_DSH_TEAM_ROWS };
    process.env.MPD_MCP_LOG_DIR = logDir;
    delete process.env.DSH_WORKSPACE_ROOT;
    if (spec.env.MPD_DSH_TEAM_ROWS === undefined) delete process.env.MPD_DSH_TEAM_ROWS;
    else process.env.MPD_DSH_TEAM_ROWS = spec.env.MPD_DSH_TEAM_ROWS;

    const argv1 = spec.argv1 === "rc2n/bin/dsh" ? join(FIX, spec.argv1) : join(FIX, spec.argv1);
    const realArgv1 = process.argv[1];
    process.argv[1] = argv1;
    const baseUrl = spec.baseUrl === null ? "" : spec.baseUrl === "THROW" ? "throw" : fixtures[spec.baseUrl];
    const ctx = { baseUrl };
    if (spec.baseUrl === "THROW") Object.defineProperty(ctx, "baseUrl", { get() { throw new Error("boom"); } });

    const row = { arm: label, expected: spec, actual: {} };
    try {
      row.actual.old = evaluateWith(ctx, guardOld);
      row.actual.new = evaluateWith(ctx, guardNew);
      // A second evaluation of the same side must NOT write a second line.
      row.actual.oldAgain = evaluateWith(ctx, guardOld);
    } catch (error) {
      row.actual.threw = String(error && error.message ? error.message : error);
    }
    process.argv[1] = realArgv1;
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key];
    else process.env[key] = value;

    const logFile = join(logDir, ".mpd", "logs", "mpd-patch-guards.log");
    row.actual.logLines = existsSync(logFile) ? readFileSync(logFile, "utf8").split(String.fromCharCode(10)).filter((line) => line !== "") : [];
    row.pass =
      row.actual.old === spec.old &&
      row.actual.new === spec.new &&
      row.actual.oldAgain === spec.old &&
      (spec.source === "threw"
        ? row.actual.logLines.length === 0
        : row.actual.logLines.length === 1 && row.actual.logLines[0].includes("generation=" + spec.generation + " source=" + spec.source));
    out.arms.push(row);
    rmSync(logDir, { recursive: true, force: true });
  }
  out.passed = out.arms.filter((arm) => arm.pass).length;
  out.total = out.arms.length;
  return out;
}

const report = run();
const target = process.argv[2] ?? join(ROOT, "unit-probe-result.json");
writeFileSync(target, JSON.stringify(report, null, 2) + String.fromCharCode(10));
for (const arm of report.arms) {
  console.log((arm.pass ? "ok   " : "FAIL ") + arm.arm + " old=" + arm.actual.old + " new=" + arm.actual.new + " lines=" + (arm.actual.logLines ?? []).length + (arm.actual.threw ? " threw=" + arm.actual.threw : ""));
}
console.log("bodiesIdentical=" + report.bodiesIdentical + " guards=" + JSON.stringify(report.rendered) + " PASS " + report.passed + "/" + report.total);
process.exitCode = report.passed === report.total && report.bodiesIdentical && report.rendered.oldHazard === "" && report.rendered.newHazard === "" ? 0 : 1;
