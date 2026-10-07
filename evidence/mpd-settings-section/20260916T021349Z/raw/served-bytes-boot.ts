// w14 / t83 QA driver — REAL BOOT: the harness serves the bundle's web client from the
// BUILT artifact, so the registration contract has to hold in the SERVED bytes, not only
// on disk. Sandbox DSH_HOME + HOME + workspace; the shipped artifact is fetched back over
// the host's own browser-authenticated route.
//
// NOT CLAIMED: a browser render. No browser binary exists here — this proves the bytes the
// browser would receive, and the boot log is checked for a client-activation failure.
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { sandboxWorkspace, assertSessionsSandboxed } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/workspace-isolation.mjs";

const ROOT = "/root/dshProj/my-power-dsh";
const ARTIFACT = join(ROOT, "packages", "mpd-bundle-plugin", "client.js");
const OUT = join(ROOT, "evidence", "mpd-settings-section", "20260916T021349Z", "served-bytes-boot.result.json");
const PORT = Number(process.env.MPD_QA_MPDSET_PORT ?? 3199);
const sha = (text) => createHash("sha256").update(text).digest("hex");

const artifactText = readFileSync(ARTIFACT, "utf8");
const result = {
  what: "t83/w14 — the served web client bytes carry the top-level MPD settings section",
  artifact: { path: "packages/mpd-bundle-plugin/client.js", bytes: Buffer.byteLength(artifactText), sha256: sha(artifactText) },
  not_claimed: ["a real browser render (no browser binary in this environment)"],
};

const realProfileNodeModules = join(homedir(), ".dsh", "profiles", "web", "node_modules");
const needed = ["@deepseek-ai", "@linxin666", "dsh-better-sidebar"].map((name) => join(realProfileNodeModules, name));
const missing = needed.filter((path) => !existsSync(path));
const sandbox = mkdtempSync(join(tmpdir(), "mpd-mpdset-"));
result.sandbox = sandbox;

if (missing.length > 0) {
  result.skipped = "installed web profile packages absent: " + missing.join(", ");
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const home = join(sandbox, "dsh-home");
const userHome = join(sandbox, "user-home");
const profile = join(home, "profiles", "w");
mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true });
mkdirSync(join(home, ".agent-presets"), { recursive: true });
mkdirSync(userHome, { recursive: true });
for (const name of ["@deepseek-ai", "@linxin666", "dsh-better-sidebar"]) {
  symlinkSync(join(realProfileNodeModules, name), join(profile, "node_modules", name));
}
symlinkSync(ROOT, join(profile, "node_modules", "@mpd-dsh", "mpd"));
const credentials = join(homedir(), ".dsh", ".credentials.yaml");
if (existsSync(credentials)) copyFileSync(credentials, join(home, ".credentials.yaml"));
const settings = join(homedir(), ".dsh", "settings.yaml");
if (existsSync(settings)) cpSync(settings, join(home, "settings.yaml"));
writeFileSync(join(profile, "package.json"), JSON.stringify({
  name: "dsh-profile-w", private: true, dependencies: { "@mpd-dsh/mpd": "link:" + ROOT },
  dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@linxin666/dsh-web-all", "@mpd-dsh/mpd"] } },
}, null, 2));

const log = join(home, "web.log");
const fd = openSync(log, "w");
const ws = sandboxWorkspace(sandbox);
const web = spawn("dsh", ["--profile", "w", "--port", String(PORT), "--no-open"], {
  env: { ...process.env, DSH_HOME: home, HOME: userHome }, cwd: ws, stdio: ["ignore", fd, fd],
});
const base = "http://127.0.0.1:" + PORT;
result.dshHome = home;
result.userHome = userHome;
result.workspace = ws;
result.port = PORT;

try {
  let token = null;
  const deadline = Date.now() + 75000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const match = readFileSync(log, "utf8").match(/token=([A-Za-z0-9_-]+)/);
    if (match) { token = match[1]; break; }
  }
  if (token === null) {
    result.ok = false;
    result.skipped = "web boot never printed a token within 75s";
    result.logTail = readFileSync(log, "utf8").slice(-2000);
  } else {
    const authorize = await fetch(base + "/?token=" + token, { redirect: "manual" });
    const cookie = (authorize.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ");
    const html = await (await fetch(base + "/", { headers: cookie ? { cookie } : {} })).text();
    const urls = [...new Set([...html.matchAll(/\/plugins\/[^\s"'<>\\]*client\.js[^\s"'<>\\]*/g)].map((match) => match[0]))];
    const own = urls
      .filter((url) => decodeURIComponent(url).includes("@mpd-dsh/mpd"))
      .sort((left, right) => Number(left.includes(",@")) - Number(right.includes(",@")));
    let served = null;
    for (const url of own) {
      const response = await fetch(base + url, { headers: cookie ? { cookie } : {} });
      const body = await response.text();
      if (response.status !== 200) continue;
      if (served === null || body.length < served.bytes) served = { url, status: response.status, body };
      if (!url.includes(",@")) break;
    }
    const bootLog = readFileSync(log, "utf8");
    const activationFaults = [
      "did not activate", "Failed to load plugins", "plugin tree failed to load",
      "failed to apply loader entry", "pending (waiting for service",
    ].filter((needle) => bootLog.includes(needle));
    if (served === null) {
      result.ok = false;
      result.servedClient = null;
      result.clientUrls = urls;
      result.activationFaults = activationFaults;
    } else {
      const body = served.body;
      writeFileSync(join(ROOT, "evidence", "mpd-settings-section", "20260916T021349Z", "raw", "served-client.served.js"), body);
      const servedLines = body.split("\n");
      const repoLines = artifactText.split("\n");
      const delta = { servedLines: servedLines.length, repoLines: repoLines.length, firstDifferenceLine: null, sameLength: servedLines.length === repoLines.length };
      for (let index = 0; index < Math.max(servedLines.length, repoLines.length); index += 1) {
        if (servedLines[index] !== repoLines[index]) { delta.firstDifferenceLine = index + 1; break; }
      }
      result.servedClient = {
        url: served.url,
        status: served.status,
        bytes: Buffer.byteLength(body),
        sha256: sha(body),
        identicalToRepoArtifact: sha(body) === sha(artifactText),
        deltaVsRepoArtifact: delta,
        carriesSectionSlot: body.includes('const SECTION_SLOT = "settings.section"'),
        carriesSectionId: body.includes('const SECTION_ID = "mpd"'),
        carriesSectionOrder: body.includes("const SECTION_ORDER = 20"),
        registersSectionSlot: /slots\.inject\(\s*(?:SECTION_SLOT|"settings\.section")/.test(body),
        carriesNavLabel: body.includes('nav: "MPD"'),
        retiredPluginItemOccurrences: body.split("settings.plugin.item").length - 1,
      };
      result.activationFaults = activationFaults;
      result.ok = served.status === 200
        && result.servedClient.carriesSectionSlot
        && result.servedClient.carriesSectionId
        && result.servedClient.carriesSectionOrder
        && result.servedClient.registersSectionSlot
        && result.servedClient.carriesNavLabel
        && result.servedClient.retiredPluginItemOccurrences === 0
        && activationFaults.length === 0;
    }
    result.authorize = { status: authorize.status, hasCookie: cookie.length > 0 };
    try { result.sessionsSandboxed = assertSessionsSandboxed(home, sandbox, { label: "mpd-settings-section" }); }
    catch (error) { result.sessionsSandboxed = { ok: false, error: String(error?.message ?? error) }; }
    result.logTail = bootLog.slice(-1200);
  }
} finally {
  web.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok === true ? 0 : 1);
