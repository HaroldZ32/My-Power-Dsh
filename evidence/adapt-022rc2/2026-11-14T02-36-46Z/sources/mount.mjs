// T1 mount arm runner — one REAL mount of the six-row overlay on one harness generation.
//
//   node .qa-tmp/t1/mount.mjs --label=rc1 --harness=.qa-tmp/dsh-022 --port=3211 [--skip-install]
//
// WHAT MAKES THIS A MOUNT AND NOT A COMPOSITION DUMP: it boots the web profile, and the LAST row of
// the overlay is a probe plugin that writes down, from INSIDE the activation, which of the six rows
// the loader left enabled/activated, what `process.argv[1]`/`ctx.baseUrl` really were, and how each
// package resolved from each anchor. A `--dump-config` cannot see any of that (AGENTS.md §4).
//
// Isolation: sandbox DSH_HOME + sandbox HOME + sandbox cwd; the real ~/.dsh is never touched.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderGuard } from "./predicate.mjs";

const ROOT = dirname(new URL(import.meta.url).pathname);
const REPO = join(ROOT, "..", "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith("--" + name + "="));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const label = flag("label", "rc1");
const harnessDir = join(REPO, flag("harness", ".qa-tmp/dsh-022"));
const port = flag("port", "3211");
const overlay = join(REPO, flag("overlay", ".qa-tmp/t1/overlay.yml"));
const skipInstall = args.includes("--skip-install");
const RUN = join(ROOT, "run", label);
const HOME_DSH = join(RUN, "dsh-home");
const USER_HOME = join(RUN, "user-home");
const WS = join(RUN, "workspace");
const PROBE_OUT = join(RUN, "probe.json");
const PROBE_SETTLED = join(RUN, "probe.settled.json");
const BOOT_LOG = join(RUN, "boot.log");
const result = { label, harness: harnessDir, overlay, port: Number(port), steps: [], assertions: [], ok: false };

/** @param line One step line. @param extra Extra fields merged into the step record. */
function step(line, extra) {
  result.steps.push({ at: new Date().toISOString(), line, ...(extra ?? {}) });
  console.log("[" + label + "] " + line);
}

/** @param name The assertion's name. @param pass Whether it held. @param detail What was seen. */
function check(name, pass, detail) {
  result.assertions.push({ name, pass: Boolean(pass), detail });
  console.log("[" + label + "] " + (pass ? "ok   " : "FAIL ") + name + (detail === undefined ? "" : " - " + detail));
}

/**
 * Run one command to completion.
 * @param file Executable path.
 * @param argv Argument vector.
 * @param opts spawnSync options plus a timeout label.
 * @returns `{ status, stdout, stderr }`.
 */
function run(file, argv, opts = {}) {
  const done = spawnSync(file, argv, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 600_000,
    cwd: opts.cwd ?? WS,
    env: opts.env ?? env,
  });
  return { status: done.status, stdout: done.stdout ?? "", stderr: done.stderr ?? "" };
}

const env = {
  ...process.env,
  DSH_HOME: HOME_DSH,
  HOME: USER_HOME,
  XDG_RUNTIME_DIR: join(RUN, "xdg"),
  MPD_T1_PROBE_OUT: PROBE_OUT,
  DSH_WORKSPACE_ROOT: WS,
  PATH: join(harnessDir, "bin") + ":" + String(process.env.PATH ?? ""),
};

rmSync(RUN, { recursive: true, force: true });
for (const dir of [HOME_DSH, USER_HOME, WS, join(RUN, "xdg")]) mkdirSync(dir, { recursive: true });

const dshBin = join(harnessDir, "bin", "dsh");
const version = run(dshBin, ["--version"]);
result.harnessVersion = version.stdout.trim();
step("harness --version", { exit: version.status, stdout: version.stdout.trim().split("\n")[0] });
check("harness binary is the requested one", version.status === 0, result.harnessVersion);

// 1) Create the profile from a shipped template. `--dump-config` only PROVES the creation succeeded.
const created = run(dshBin, ["--profile", "t1", "--from-default-profile", "web", "--dump-config"], { timeoutMs: 180_000 });
step("profile create (--from-default-profile web --dump-config)", { exit: created.status, rows: (created.stdout.match(/^- id:/gm) ?? []).length });
check("profile created from the web template", created.status === 0 && existsSync(join(HOME_DSH, "profiles", "t1", "package.json")), "exit=" + created.status);

// 2) Install what the six rows resolve through. THREE measurements, in this order, because each
//    one answers a different question about contract D2 (declare BOTH generations in dependencies):
//      a) the SAME-generation family as TOP-LEVEL targets  -> the install path works at all;
//      b) the OTHER generation as TOP-LEVEL targets         -> the harness's plugin-version gate
//         refuses a package whose peer demands another harness (measured on rc.1, 2026-11-14);
//      c) a CARRIER that declares BOTH generations as DEPS  -> D2's real shape: does the gate look
//         at transitive dependencies, or only at the packages named on the command line?
const FAMILY = {
  new: ["@deepseek-ai/dsh-agent-team@0.2.2-rc.2", "@deepseek-ai/dsh-tool-agent-team@0.2.2-rc.2", "@deepseek-ai/dsh-client-ui-agent-team@0.2.2-rc.2"],
  old: ["@deepseek-ai/dsh-experimental-agent-team@0.2.2-rc.1", "@deepseek-ai/dsh-experimental-tool-agent-team@0.2.2-rc.1", "@deepseek-ai/dsh-experimental-client-ui-agent-team@0.2.2-rc.1"],
};
const isNew = result.harnessVersion.includes("rc.2");
const same = isNew ? FAMILY.new : FAMILY.old;
const other = isNew ? FAMILY.old : FAMILY.new;
result.installProbes = {};
if (skipInstall && existsSync(join(HOME_DSH, "profiles", "t1", "node_modules"))) {
  step("dependency install skipped (--skip-install with a warm profile)");
} else {
  const a = run(dshBin, ["plugin", "--profile", "t1", "add", ...same], { timeoutMs: 900_000 });
  result.installProbes.sameGenerationTargets = { exit: a.status, tail: a.stderr.trim().split("\n").slice(-2).join(" | ") };
  step("(a) install the SAME-generation family as top-level targets", { exit: a.status, tail: result.installProbes.sameGenerationTargets.tail });
  check("(a) same-generation family installs as a top-level target", a.status === 0, "exit=" + a.status);

  const b = run(dshBin, ["plugin", "--profile", "t1", "add", ...other], { timeoutMs: 900_000 });
  result.installProbes.otherGenerationTargets = { exit: b.status, tail: b.stderr.trim().split("\n").slice(-3).join(" | "), stdout: b.stdout.trim().slice(-600) };
  step("(b) install the OTHER generation as top-level targets", { exit: b.status, tail: result.installProbes.otherGenerationTargets.tail });

  const c = run(dshBin, ["plugin", "--profile", "t1", "add", join(ROOT, "carrier")], { timeoutMs: 900_000 });
  result.installProbes.carrierDeclaringBoth = { exit: c.status, tail: c.stderr.trim().split("\n").slice(-3).join(" | "), stdout: c.stdout.trim().slice(-600) };
  step("(c) install a carrier that DECLARES both generations (D2 shape)", { exit: c.status, tail: result.installProbes.carrierDeclaringBoth.tail });

  const probe = run(dshBin, ["plugin", "--profile", "t1", "add", join(ROOT, "probe")], { timeoutMs: 900_000 });
  step("install the T1 probe package", { exit: probe.status, tail: probe.stderr.trim().split("\n").slice(-2).join(" | ") });
  check("T1 probe installed", probe.status === 0, "exit=" + probe.status);
}

// 3) The guard text actually differs per side, so a single overlay serves both generations.
check("renderGuard(old) and renderGuard(new) differ", renderGuard("old") !== renderGuard("new"));

// 4) Boot. The probe writes its report at activation; the app is killed once the report lands.
const boot = spawn(process.execPath, [join(harnessDir, "lib", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"), "--profile", "t1", "--patch", overlay, "--port", port, "--no-open"], { cwd: WS, env, stdio: ["pipe", "pipe", "pipe"] });
const chunks = [];
boot.stdout.on("data", (chunk) => chunks.push(chunk));
boot.stderr.on("data", (chunk) => chunks.push(chunk));
let exited;
const exitPromise = new Promise((resolve) => boot.on("exit", (code, signal) => { exited = { code, signal }; resolve(); }));
const deadline = Date.now() + 150_000;
while (!existsSync(PROBE_OUT) && exited === undefined && Date.now() < deadline) await new Promise((r) => setTimeout(r, 400));
// The SETTLED report is the one that judges activation: sibling rows initialize concurrently.
const settledDeadline = Date.now() + 60_000;
while (!existsSync(PROBE_SETTLED) && exited === undefined && Date.now() < settledDeadline) await new Promise((r) => setTimeout(r, 400));
const bootedAt = Date.now();
step("boot reached the probe row", { waitedMs: bootedAt - (deadline - 150_000), exit: exited ?? null });
if (exited === undefined) {
  boot.kill("SIGTERM");
  await Promise.race([exitPromise, new Promise((r) => setTimeout(r, 8000))]);
  if (exited === undefined) {
    boot.kill("SIGKILL");
    await Promise.race([exitPromise, new Promise((r) => setTimeout(r, 4000))]);
  }
}
writeFileSync(BOOT_LOG, Buffer.concat(chunks));
step("boot terminated", { exit: exited ?? null, logBytes: Buffer.concat(chunks).length });
check("probe report written (a row activated)", existsSync(PROBE_OUT), PROBE_OUT);
check("boot did not exit on its own with an error", exited === undefined || exited.code === 0 || exited.code === null, JSON.stringify(exited ?? null));

// 5) Judge the activation facts from the probe's own report.
const probeText = existsSync(PROBE_SETTLED) ? readFileSync(PROBE_SETTLED, "utf8") : (existsSync(PROBE_OUT) ? readFileSync(PROBE_OUT, "utf8") : "");
result.settled = existsSync(PROBE_SETTLED);
check("settled report landed", existsSync(PROBE_SETTLED), PROBE_SETTLED);
const probeReport = probeText === "" ? null : JSON.parse(probeText);
if (probeReport !== null) writeFileSync(join(RUN, "probe.json"), probeText);
result.probe = probeReport;
const byId = new Map((probeReport?.entries ?? []).map((entry) => [entry.id, entry]));
const expectEnabled = result.harnessVersion.includes("rc.2") ? ["mpd-agent-team-rc2", "mpd-tool-agent-team-rc2", "mpd-ui-agent-team-rc2"] : ["mpd-agent-team", "mpd-tool-agent-team", "mpd-ui-agent-team"];
const expectDisabled = result.harnessVersion.includes("rc.2") ? ["mpd-agent-team", "mpd-tool-agent-team", "mpd-ui-agent-team"] : ["mpd-agent-team-rc2", "mpd-tool-agent-team-rc2", "mpd-ui-agent-team-rc2"];
for (const id of expectEnabled) {
  const entry = byId.get(id);
  check("row " + id + " enabled+activated", entry !== undefined && entry.disabled === false && entry.active === true, JSON.stringify(entry ?? null));
}
for (const id of expectDisabled) {
  const entry = byId.get(id);
  check("row " + id + " disabled", entry !== undefined && entry.disabled === true, JSON.stringify(entry ?? null));
}
check("all six team rows are present in the loader", expectEnabled.concat(expectDisabled).every((id) => byId.has(id)), "present=" + expectEnabled.concat(expectDisabled).filter((id) => byId.has(id)).length + "/6");

// 6) The ONE guard log line, from the boot's own cwd.
const guardLog = join(WS, ".mpd", "logs", "mpd-patch-guards.log");
const guardLines = existsSync(guardLog) ? readFileSync(guardLog, "utf8").split("\n").filter((line) => line.startsWith("[mpd-team-rows]")) : [];
result.guardLines = guardLines;
check("exactly ONE generation line in mpd-patch-guards.log", guardLines.length === 1, JSON.stringify(guardLines));
step("guard log", { path: guardLog, lines: guardLines.length });

// 7) Package resolvability from both anchors (deliverable 2) and the installed versions.
const installed = {};
for (const pkg of ["@deepseek-ai/dsh", "@deepseek-ai/dsh-agent-team", "@deepseek-ai/dsh-tool-agent-team", "@deepseek-ai/dsh-client-ui-agent-team", "@deepseek-ai/dsh-experimental-agent-team", "@deepseek-ai/dsh-experimental-tool-agent-team", "@deepseek-ai/dsh-experimental-client-ui-agent-team"]) {
  const manifest = join(HOME_DSH, "profiles", "t1", "node_modules", pkg, "package.json");
  installed[pkg] = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).version : null;
}
result.installedInProfile = installed;
result.profileDependencies = JSON.parse(readFileSync(join(HOME_DSH, "profiles", "t1", "package.json"), "utf8")).dependencies;
result.rowCounts = { enabledRows: expectEnabled.length, disabledRows: expectDisabled.length };
result.ok = result.assertions.every((entry) => entry.pass);
writeFileSync(join(RUN, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("[" + label + "] " + (result.ok ? "PASS" : "FAIL") + " " + result.assertions.filter((a) => a.pass).length + "/" + result.assertions.length + " assertions; evidence " + RUN);
process.exitCode = result.ok ? 0 : 1;
