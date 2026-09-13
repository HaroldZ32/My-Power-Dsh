// t16 lane 2 — same sandbox, composition fixed: the home patch written by install-profile
// inserted the mpd rows pointing at the REPO, which duplicated the pack layer's ids
// ("duplicate loader entry id: mpd-web-compat"). The pack bundle patch supplies the whole row
// set, so the home patch is reduced to the provider row only.
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

const siliconTargets = [
  join(SB, "node_modules/@mpd-dsh/silicon"),
  join(packDir, "node_modules/@mpd-dsh/silicon"),
  join(profileDir, "node_modules/@mpd-dsh/silicon"),
];
const plant = () => { for (const t of siliconTargets) { rmSync(t, { recursive: true, force: true }); mkdirSync(t, { recursive: true }); cpSync(join(SILICON, "package.json"), join(t, "package.json")); cpSync(join(SILICON, "presets"), join(t, "presets"), { recursive: true }); } };
plant();
const plantedFile = join(packDir, "node_modules/@mpd-dsh/silicon/presets/rtl-ip.profile.json");
out.planted = { bytes: statSync(plantedFile).size, isFile: statSync(plantedFile).isFile() };
const pluginLib = join(packDir, "packages/mpd-agent-teams-plugin/lib/index.js");
try { out.resolution = { resolved: createRequire(pluginLib).resolve("@mpd-dsh/silicon/presets/rtl-ip.profile.json") }; } catch (e) { out.resolution = { error: String(e?.code ?? e) }; }

function makeStub() {
  const trace = [];
  let stage = "idle";
  const sse = (res, payload) => { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" }); res.write(`data: ${JSON.stringify(payload)}\n\n`); res.write("data: [DONE]\n\n"); res.end(); };
  const chunk = (delta, finish) => ({ id: "chatcmpl-t16b", object: "chat.completion.chunk", created: 1, model: "probe", choices: [{ index: 0, delta, finish_reason: finish ?? null }] });
  const toolCall = (id, name, args) => chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed = {}; try { parsed = JSON.parse(body); } catch {}
      const tools = Array.isArray(parsed.tools) ? parsed.tools.map((t) => t?.function?.name ?? t?.name).filter(Boolean) : [];
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const toolResults = messages.filter((m) => m.role === "tool" || m.role === "tool_result").map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
      trace.push({ n: trace.length + 1, stage, toolCount: tools.length, hasCreate: tools.includes("agent_teams_create"), toolResults, body });
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
  const homePatch = join(dshHome, "cordis.patch.yml");
  writeFileSync(join(HERE, `t16b-${label}-patch-before.txt`), existsSync(homePatch) ? readFileSync(homePatch, "utf8") : "<absent>");
  // provider row ONLY: the pack bundle patch supplies every mpd row
  writeFileSync(homePatch, ["- id: llm-deepseek", "  config:", `    baseURL: http://127.0.0.1:${port}/v1`, "    apiKeyEnv: DEEPSEEK_API_KEY", ""].join("\n"));
  const logPath = join(HERE, `t16b-${label}-boot.log`);
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
  const bodies = stub.trace.map((t) => t.body).join("\n");
  const createResult = stub.trace.flatMap((t) => t.toolResults).find((s) => /rtl-ip|unknown|profile/i.test(s)) ?? "";
  const res = { label, exit: r.status, killed: r.killed, elapsedMs: Date.now() - t0, requests: stub.trace.length,
    toolsOffered: stub.trace[0]?.toolCount ?? 0, createOffered: stub.trace.some((t) => t.hasCreate),
    rtlIpInPrompt: /rtl-ip/.test(bodies), listingSnippet: (bodies.match(/[Cc]onfigured team profiles[\s\S]{0,400}/) ?? [""])[0],
    createResult: createResult.slice(0, 1200), warnCount: (log.match(/silicon rtl-ip profile/g) ?? []).length,
    applyCrash: /duplicate loader entry id|failed to apply loader entry|plugin tree failed to load/.test(log),
    logPath, logBytes: log.length, logTail: log.slice(-1500) };
  writeFileSync(join(HERE, `t16b-${label}-result.json`), JSON.stringify(res, null, 2));
  return res;
}

out.present = await boot("present", 240000);
for (const t of siliconTargets) rmSync(t, { recursive: true, force: true });
out.absent = await boot("absent", 240000);
out.finishedAt = new Date().toISOString();
writeFileSync(join(HERE, "t16b-lane-result.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  planted: out.planted, resolution: out.resolution,
  present: { exit: out.present.exit, requests: out.present.requests, tools: out.present.toolsOffered, createOffered: out.present.createOffered, rtlIp: out.present.rtlIpInPrompt, createResult: out.present.createResult.slice(0, 400), warnCount: out.present.warnCount, applyCrash: out.present.applyCrash, ms: out.present.elapsedMs },
  absent: { exit: out.absent.exit, requests: out.absent.requests, rtlIp: out.absent.rtlIpInPrompt, warnCount: out.absent.warnCount, applyCrash: out.absent.applyCrash, ms: out.absent.elapsedMs },
  absentLogTail: out.absent.logTail.slice(-600),
}, null, 2));
