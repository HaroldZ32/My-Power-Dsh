#!/usr/bin/env bun
// t17 INDEPENDENT isolation + two-sided gate reproduction (Lead, verifier).
// Not a re-run of t15's case: this driver uses sandboxWorkspace +
// assertSessionsSandboxed, asserts the team: prefix is CONSUMED in the goal text,
// and proves no real workspace/home record was created by THIS verification run.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { sandboxWorkspace, assertSessionsSandboxed, projectKey, REPO_ROOT } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/workspace-isolation.mjs";

const NOTICE = "[AgentTeams] Session-start team rule";
const out = { steps: {}, verdict: {} };
const log = [];

function teamIds(ws) {
  const root = join(ws, ".mpd", "team");
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((d) => d !== "archive" && existsSync(join(root, d, "team.json"))).sort();
}
function snapshotDir(p) {
  if (!existsSync(p)) return [];
  return readdirSync(p).sort();
}
function noticeInLog(home) {
  const root = join(home, "sessions");
  if (!existsSync(root)) return false;
  for (const key of readdirSync(root)) {
    const dir = join(root, key);
    for (const s of readdirSync(dir)) {
      const sd = join(dir, s);
      for (const f of readdirSync(sd)) {
        if (!f.startsWith("session") || !f.includes(".jsonl")) continue;
        const p = join(sd, f);
        if (p.endsWith(".zstd")) {
          const d = spawnSync("zstd", ["-d", p, "-c"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
          if (d.status === 0 && (d.stdout || "").includes(NOTICE)) return true;
        } else if (readFileSync(p, "utf8").includes(NOTICE)) return true;
      }
    }
  }
  return false;
}
function userMessageTexts(home) {
  const texts = [];
  const root = join(home, "sessions");
  if (!existsSync(root)) return texts;
  for (const key of readdirSync(root)) {
    const dir = join(root, key);
    for (const s of readdirSync(dir)) {
      const sd = join(dir, s);
      for (const f of readdirSync(sd)) {
        if (!f.startsWith("session") || !f.includes(".jsonl")) continue;
        const p = join(sd, f);
        let raw = "";
        if (p.endsWith(".zstd")) {
          const d = spawnSync("zstd", ["-d", p, "-c"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
          raw = d.stdout || "";
        } else raw = readFileSync(p, "utf8");
        for (const line of raw.split("\n")) {
          if (!line.includes('"user/message"')) continue;
          try { const o = JSON.parse(line); const content = o.data?.content ?? o.data?.message?.content ?? []; const t = content.filter((b) => b.type === "text").map((b) => b.text).join(" "); if (t) texts.push(t); } catch { /* skip */ }
        }
      }
    }
  }
  return texts;
}

// --- baseline of the REAL workspace + home ---------------------------------
const repoTeamBefore = teamIds(REPO_ROOT);
const realHome = join(homedir(), ".mpd");
const realHomeBefore = snapshotDir(realHome);
out.baseline = { repoTeamBefore, realHomeBefore };

const creds = join(homedir(), ".dsh", ".credentials.yaml");
if (!existsSync(creds)) { console.error("FAIL missing credentials"); process.exit(1); }
const sandbox = mkdtempSync(join(tmpdir(), "mpd-t17-iso-"));
cpSync(creds, join(sandbox, ".credentials.yaml"));
const settings = join(homedir(), ".dsh", "settings.yaml");
if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"));

const env = { ...process.env, DSH_HOME: sandbox };
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000, cwd: opts.cwd ?? REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
  log.push("$ " + cmd + " " + args.join(" ") + "\n[exit=" + r.status + "]\n" + ((r.stdout || "") + (r.stderr || "")).slice(0, 8000));
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
const inst = run(process.execPath, [join(REPO_ROOT, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"]);
out.steps.installer = { exit: inst.status, ok: inst.status === 0 };

const CASES = [
  { label: "simple", prompt: "Reply with exactly: hello-ok", expectTeam: false, expectConsumed: false },
  { label: "complex", prompt: "team: fix the flaky test", expectTeam: true, expectConsumed: true },
];
out.steps.sides = [];
for (const c of CASES) {
  const sideHome = join(sandbox, "side", c.label);
  const ws = sandboxWorkspace(sideHome);
  cpSync(join(sandbox, ".credentials.yaml"), join(sideHome, ".credentials.yaml"));
  if (existsSync(join(sandbox, "settings.yaml"))) cpSync(join(sandbox, "settings.yaml"), join(sideHome, "settings.yaml"));
  cpSync(join(sandbox, "profiles"), join(sideHome, "profiles"), { recursive: true });
  cpSync(join(sandbox, "cordis.patch.yml"), join(sideHome, "cordis.patch.yml"));
  const sideEnv = { ...process.env, DSH_HOME: sideHome };
  const r = spawnSync("dsh", ["--profile", "mpd-headless", c.prompt], { env: sideEnv, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, cwd: ws, stdio: ["ignore", "pipe", "pipe"] });
  log.push("[" + c.label + "] dsh cwd=" + ws + "\n[exit=" + r.status + "]\n" + ((r.stdout || "") + (r.stderr || "")).slice(0, 8000));
  const teams = teamIds(ws);
  const notice = noticeInLog(sideHome);
  const msgs = userMessageTexts(sideHome);
  const iso = assertSessionsSandboxed(sideHome, ws, { label: "t17-" + c.label });
  const consumed = !msgs.some((t) => t.trimStart().startsWith("team:")) && msgs.some((t) => t.includes("fix the flaky test"));
  const teamsStage = teams.length === 1 ? JSON.parse(readFileSync(join(ws, ".mpd", "team", teams[0], "team.json"), "utf8")) : undefined;
  const ok = c.expectTeam
    ? teams.length === 1 && notice && (!c.expectConsumed || consumed) && teamsStage?.phase === "staged" && (teamsStage?.members ?? []).filter((m) => m.status === "active").length === 0
    : teams.length === 0 && !notice;
  out.steps.sides.push({
    label: c.label, prompt: c.prompt, teams: teams.length, notice, ok,
    goalTextConsumed: c.expectConsumed ? consumed : null,
    userMessageTexts: msgs.map((t) => t.slice(0, 100)),
    sessionStoreKeys: iso.keys, sessionStoreKeyIsSandbox: iso.keys.every((k) => k === projectKey(ws)),
    staged: teamsStage?.phase, members: teamsStage?.members?.length, activeMembers: (teamsStage?.members ?? []).filter((m) => m.status === "active").length,
    dossier: teamsStage?.id,
  });
}
out.steps.isolation = out.steps.sides.map((s) => ({ label: s.label, keys: s.sessionStoreKeys, sandboxKeyed: s.sessionStoreKeyIsSandbox }));
out.steps.repoTeamPreserved = { before: repoTeamBefore, after: teamIds(REPO_ROOT) };
out.steps.realHomePreserved = { before: realHomeBefore, after: snapshotDir(realHome) };
out.steps.repoTeamPreserved.newIds = out.steps.repoTeamPreserved.after.filter((x) => !repoTeamBefore.includes(x));
out.steps.realHomePreserved.newEntries = out.steps.realHomePreserved.after.filter((x) => !realHomeBefore.includes(x));
out.verdict.twoSided = out.steps.sides.every((s) => s.ok);
out.verdict.isolation = out.steps.isolation.every((s) => s.sandboxKeyed) && out.steps.repoTeamPreserved.newIds.length === 0 && out.steps.realHomePreserved.newEntries.length === 0;

writeFileSync("/root/dshProj/my-power-dsh/evidence/omo-align/verification/raw/isolation-gate-independent.result.json", JSON.stringify(out, null, 2));
writeFileSync("/root/dshProj/my-power-dsh/evidence/omo-align/verification/raw/isolation-gate-independent.log", log.join("\n\n---\n\n"));
console.log(JSON.stringify(out.steps.sides, null, 1));
console.log("VERDICT twoSided=" + out.verdict.twoSided + " isolation=" + out.verdict.isolation + " newRepoTeams=" + JSON.stringify(out.steps.repoTeamPreserved.newIds) + " newHomeEntries=" + JSON.stringify(out.steps.realHomePreserved.newEntries));
