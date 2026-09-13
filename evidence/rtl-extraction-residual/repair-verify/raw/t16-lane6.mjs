// t16 lane 6 — ABSENT lane, bounded: at most 3 tool calls, digests only (lane 5 looped and OOM'd;
// that was a harness bug, not a session behaviour).
import { createServer } from "node:http";
import { readFileSync, writeFileSync, openSync, closeSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SB = join(HERE, "t16-lane");
const dshHome = join(SB, "dsh-home"), runHome = join(SB, "run-home"), ws = join(SB, "ws");
const packDir = join(SB, "mpd-package");
for (const t of [join(SB, "node_modules/@mpd-dsh/silicon"), join(packDir, "node_modules/@mpd-dsh/silicon"), join(dshHome, "profiles/mpd-headless/node_modules/@mpd-dsh/silicon")]) rmSync(t, { recursive: true, force: true });
const env = { ...process.env, DSH_HOME: dshHome, HOME: runHome, DEEPSEEK_API_KEY: "sk-t16-stub",
  npm_config_store_dir: join(SB, "pnpm-store"), npm_config_cache: join(SB, "npm-cache"), PNPM_HOME: join(SB, "pnpm-home") };

const trace = [];
let toolCalls = 0;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed = {}; try { parsed = JSON.parse(body); } catch {}
    const tools = Array.isArray(parsed.tools) ? parsed.tools.map((t) => t?.function?.name ?? t?.name).filter(Boolean) : [];
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const sys = typeof messages[0]?.content === "string" ? messages[0].content : "";
    const listing = (sys.match(/[Cc]onfigured team profiles[\s\S]{0,600}/) ?? [""])[0];
    const last = messages.at(-1) ?? {};
    const lastText = typeof last.content === "string" ? last.content : JSON.stringify(last.content ?? "");
    trace.push({ n: trace.length + 1, tools: tools.length, hasCreate: tools.includes("agent_teams_create"), lastRole: last.role, lastText: lastText.slice(0, 700), systemHasRtlIp: /\brtl-ip\b/.test(listing), listing: listing.slice(0, 400) });
    const sse = (p) => { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" }); res.write(`data: ${JSON.stringify(p)}\n\n`); res.write("data: [DONE]\n\n"); res.end(); };
    const chunk = (delta, finish) => ({ id: "chatcmpl-t16f", object: "chat.completion.chunk", created: 1, model: "probe", choices: [{ index: 0, delta, finish_reason: finish ?? null }] });
    const toolCall = (id, name, args) => chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
    const stop = () => sse(chunk({ role: "assistant", content: "t16f-done" }, "stop"));
    if (tools.length === 0) return sse(chunk({ role: "assistant", content: "title" }));
    if (toolCalls >= 3) return stop();
    if (last.role === "tool" && /already lead team/i.test(lastText) && toolCalls < 2) { toolCalls++; return sse(toolCall("c_del", "agent_teams_delete", {})); }
    if (last.role === "tool" && !/already lead team/i.test(lastText)) { toolCalls = 3; return stop(); }
    toolCalls++;
    return sse(toolCall("c_create", "agent_teams_create", { name: "t16-absent-team", description: "absent-lane probe", profile: "rtl-ip", approval: "required" }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
writeFileSync(join(dshHome, "cordis.patch.yml"), ["- id: llm-deepseek", "  config:", `    baseURL: http://127.0.0.1:${port}/v1`, "    apiKeyEnv: DEEPSEEK_API_KEY", ""].join("\n"));
const logPath = join(HERE, "t16f-absent-boot.log");
const fd = openSync(logPath, "a");
const child = spawn("dsh", ["--profile", "mpd-headless", "Create a team with the rtl-ip profile."], { env, cwd: ws, stdio: ["ignore", fd, fd] });
const t0 = Date.now();
const r = await new Promise((resolve) => {
  const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve({ status: -9, killed: true }); }, 240000);
  child.on("error", (e) => { clearTimeout(timer); resolve({ status: -1, error: String(e) }); });
  child.on("close", (status, signal) => { clearTimeout(timer); resolve({ status, signal, killed: false }); });
});
closeSync(fd); server.close();
const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
const out = { exit: r.status, killed: r.killed, elapsedMs: Date.now() - t0, requests: trace.length,
  warnCount: (log.match(/silicon rtl-ip profile/g) ?? []).length, trace, siliconGone: !existsSync(join(packDir, "node_modules/@mpd-dsh/silicon")),
  logTail: log.slice(-400) };
writeFileSync(join(HERE, "t16f-absent-result.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ exit: out.exit, requests: out.requests, warnCount: out.warnCount, siliconGone: out.siliconGone,
  trace: trace.map((t) => ({ n: t.n, tools: t.tools, hasCreate: t.hasCreate, lastRole: t.lastRole, lastText: t.lastText.slice(0, 300), systemHasRtlIp: t.systemHasRtlIp })) }, null, 2));
