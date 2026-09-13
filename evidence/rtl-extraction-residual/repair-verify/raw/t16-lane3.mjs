// t16 lane 3 — same two lanes, capture hardened: per-request digest + full bodies to disk, and the
// profiles listing read from the SYSTEM message only (the user prompt mentions rtl-ip, so a
// whole-body grep would be contaminated).
import { createServer } from "node:http";
import { readFileSync, writeFileSync, openSync, closeSync, existsSync, mkdirSync, rmSync, cpSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SILICON = "/root/dshProj/my-power-dsh-silicon";
const SB = join(HERE, "t16-lane");
const dshHome = join(SB, "dsh-home"), runHome = join(SB, "run-home"), ws = join(SB, "ws");
const packDir = join(SB, "mpd-package");
const profileDir = join(dshHome, "profiles", "mpd-headless");
const out = { startedAt: new Date().toISOString() };
const env = { ...process.env, DSH_HOME: dshHome, HOME: runHome, DEEPSEEK_API_KEY: "sk-t16-stub",
  npm_config_store_dir: join(SB, "pnpm-store"), npm_config_cache: join(SB, "npm-cache"), PNPM_HOME: join(SB, "pnpm-home") };

const siliconTargets = [join(SB, "node_modules/@mpd-dsh/silicon"), join(packDir, "node_modules/@mpd-dsh/silicon"), join(profileDir, "node_modules/@mpd-dsh/silicon")];
const plant = () => { for (const t of siliconTargets) { rmSync(t, { recursive: true, force: true }); mkdirSync(t, { recursive: true }); cpSync(join(SILICON, "package.json"), join(t, "package.json")); cpSync(join(SILICON, "presets"), join(t, "presets"), { recursive: true }); } };
plant();
const plantedFile = join(packDir, "node_modules/@mpd-dsh/silicon/presets/rtl-ip.profile.json");
out.planted = { bytes: statSync(plantedFile).size, isFile: statSync(plantedFile).isFile() };
try { out.resolution = { resolved: createRequire(join(packDir, "packages/mpd-agent-teams-plugin/lib/index.js")).resolve("@mpd-dsh/silicon/presets/rtl-ip.profile.json") }; } catch (e) { out.resolution = { error: String(e?.code ?? e) }; }

function makeStub() {
  const trace = [];
  let stage = "idle";
  const sse = (res, payload) => { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" }); res.write(`data: ${JSON.stringify(payload)}\n\n`); res.write("data: [DONE]\n\n"); res.end(); };
  const chunk = (delta, finish) => ({ id: "chatcmpl-t16c", object: "chat.completion.chunk", created: 1, model: "probe", choices: [{ index: 0, delta, finish_reason: finish ?? null }] });
  const toolCall = (id, name, args) => chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed = {}; try { parsed = JSON.parse(body); } catch {}
      const tools = Array.isArray(parsed.tools) ? parsed.tools.map((t) => t?.function?.name ?? t?.name).filter(Boolean) : [];
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const sys = typeof messages[0]?.content === "string" ? messages[0].content : JSON.stringify(messages[0]?.content ?? "");
      const listing = (sys.match(/[Cc]onfigured team profiles[\s\S]{0,1200}/) ?? [""])[0];
      const last = messages.at(-1) ?? {};
      trace.push({
        n: trace.length + 1, stage, toolCount: tools.length,
        hasCreate: tools.includes("agent_teams_create"),
        roles: messages.map((m) => m.role).join(","),
        systemHasRtlIp: /rtl-ip/.test(listing),
        systemListing: listing.slice(0, 1200),
        lastRole: last.role, lastContent: (typeof last.content === "string" ? last.content : JSON.stringify(last.content ?? "")).slice(0, 1500),
        body,
      });
      if (tools.length === 0) return sse(res, chunk({ role: "assistant", content: "no tools offered" }));
      if (stage === "idle") { stage = "create-issued"; return sse(res, toolCall("call_t16_create", "agent_teams_create", { name: "t16-mount-proof", goal: "t16 mount proof", profile: "rtl-ip", approval: "required" })); }
      return sse(res, chunk({ role: "assistant", content: "t16-done" }, "stop"));
    });
  });
  return { trace, listen: () => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port))), close: () => server.close() };
}

async function boot(label, budgetMs) {
  const stub = makeStub();
  const port = await stub.listen();
  writeFileSync(join(dshHome, "cordis.patch.yml"), ["- id: llm-deepseek", "  config:", `    baseURL: http://127.0.0.1:${port}/v1`, "    apiKeyEnv: DEEPSEEK_API_KEY", ""].join("\n"));
  const logPath = join(HERE, `t16c-${label}-boot.log`);
  const fd = openSync(logPath, "a");
  const child = spawn("dsh", ["--profile", "mpd-headless", "Call agent_teams_create with profile rtl-ip, then say t16-done."], { env, cwd: ws, stdio: ["ignore", fd, fd] });
  const t0 = Date.now();
  const r = await new Promise((resolve) => {
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve({ status: -9, killed: true }); }, budgetMs);
    child.on("error", (e) => { clearTimeout(timer); resolve({ status: -1, error: String(e), killed: false }); });
    child.on("close", (status, signal) => { clearTimeout(timer); resolve({ status, signal, killed: false }); });
  });
  closeSync(fd); stub.close();
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  writeFileSync(join(HERE, `t16c-${label}-requests.jsonl`), stub.trace.map((t) => JSON.stringify({ n: t.n, stage: t.stage, toolCount: t.toolCount, hasCreate: t.hasCreate, roles: t.roles, systemHasRtlIp: t.systemHasRtlIp, lastRole: t.lastRole, lastContent: t.lastContent })).join("\n") + "\n");
  const res = {
    label, exit: r.status, killed: r.killed, elapsedMs: Date.now() - t0, requests: stub.trace.length,
    toolsOffered: stub.trace[0]?.toolCount ?? 0, createOffered: stub.trace.some((t) => t.hasCreate),
    systemProfilesPresent: stub.trace.at(-1)?.systemListing ?? "", systemHasRtlIp: stub.trace.at(-1)?.systemHasRtlIp ?? false,
    hasMpdInListing: /-\s*mpd\s*\(/.test(stub.trace.at(-1)?.systemListing ?? ""),
    secondRequestLastContent: stub.trace[1]?.lastContent ?? "",
    warnCount: (log.match(/silicon rtl-ip profile/g) ?? []).length,
    applyCrash: /duplicate loader entry id|failed to apply loader entry|plugin tree failed to load/.test(log),
    logPath, logTail: log.slice(-600),
  };
  writeFileSync(join(HERE, `t16c-${label}-result.json`), JSON.stringify(res, null, 2));
  return res;
}

out.present = await boot("present", 240000);
for (const t of siliconTargets) rmSync(t, { recursive: true, force: true });
out.absent = await boot("absent", 240000);
out.finishedAt = new Date().toISOString();
writeFileSync(join(HERE, "t16c-lane-result.json"), JSON.stringify(out, null, 2));
const trim = (r) => ({ exit: r.exit, requests: r.requests, tools: r.toolsOffered, createOffered: r.createOffered, systemHasRtlIp: r.systemHasRtlIp, hasMpd: r.hasMpdInListing, warnCount: r.warnCount, applyCrash: r.applyCrash, ms: r.elapsedMs, listing: r.systemProfilesPresent.slice(0, 320), second: r.secondRequestLastContent.slice(0, 400) });
console.log(JSON.stringify({ planted: out.planted, resolution: out.resolution, present: trim(out.present), absent: trim(out.absent) }, null, 2));
