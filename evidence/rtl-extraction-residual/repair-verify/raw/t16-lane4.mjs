// t16 lane 4 — present lane only, stub drives: create(rtl-ip) → refused (auto-provisioned team)
// → agent_teams_delete({}) → create(rtl-ip) again → expect a real result naming the rtl-ip profile.
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
const env = { ...process.env, DSH_HOME: dshHome, HOME: runHome, DEEPSEEK_API_KEY: "sk-t16-stub",
  npm_config_store_dir: join(SB, "pnpm-store"), npm_config_cache: join(SB, "npm-cache"), PNPM_HOME: join(SB, "pnpm-home") };
for (const t of [join(SB, "node_modules/@mpd-dsh/silicon"), join(packDir, "node_modules/@mpd-dsh/silicon"), join(dshHome, "profiles/mpd-headless/node_modules/@mpd-dsh/silicon")]) {
  rmSync(t, { recursive: true, force: true }); mkdirSync(t, { recursive: true });
  cpSync(join(SILICON, "package.json"), join(t, "package.json")); cpSync(join(SILICON, "presets"), join(t, "presets"), { recursive: true });
}
const plantedFile = join(packDir, "node_modules/@mpd-dsh/silicon/presets/rtl-ip.profile.json");
const out = {
  planted: { bytes: statSync(plantedFile).size, isFile: statSync(plantedFile).isFile() },
  resolution: (() => { try { return createRequire(join(packDir, "packages/mpd-agent-teams-plugin/lib/index.js")).resolve("@mpd-dsh/silicon/presets/rtl-ip.profile.json"); } catch (e) { return "ERROR " + String(e?.code ?? e); } })(),
};

const trace = [];
let state = "start";
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed = {}; try { parsed = JSON.parse(body); } catch {}
    const tools = Array.isArray(parsed.tools) ? parsed.tools.map((t) => t?.function?.name ?? t?.name).filter(Boolean) : [];
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const sys = typeof messages[0]?.content === "string" ? messages[0].content : "";
    const listing = (sys.match(/[Cc]onfigured team profiles[\s\S]{0,1200}/) ?? [""])[0];
    const last = messages.at(-1) ?? {};
    const lastText = typeof last.content === "string" ? last.content : JSON.stringify(last.content ?? "");
    trace.push({ n: trace.length + 1, state, tools: tools.length, roles: messages.map((m) => m.role).join(","), lastRole: last.role, lastText: lastText.slice(0, 1200), systemHasRtlIp: /rtl-ip/.test(listing), listing: listing.slice(0, 800), body });

    const sse = (payload) => { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" }); res.write(`data: ${JSON.stringify(payload)}\n\n`); res.write("data: [DONE]\n\n"); res.end(); };
    const chunk = (delta, finish) => ({ id: "chatcmpl-t16d", object: "chat.completion.chunk", created: 1, model: "probe", choices: [{ index: 0, delta, finish_reason: finish ?? null }] });
    const toolCall = (id, name, args) => chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

    if (tools.length === 0) return sse(chunk({ role: "assistant", content: "title" }));
    if (last.role === "tool") {
      if (/already lead team/i.test(lastText)) { state = "delete-issued"; return sse(toolCall("call_t16_delete", "agent_teams_delete", {})); }
      if (/rtl-ip/i.test(lastText) && !/Error/i.test(lastText)) { state = "created"; return sse(chunk({ role: "assistant", content: "t16-done" }, "stop")); }
      // delete result (or anything else) → try the create again
      state = "create2-issued";
      return sse(toolCall("call_t16_create2", "agent_teams_create", { name: "t16-rtl-ip-team", description: "t16 mount proof for the rtl-ip profile", profile: "rtl-ip", approval: "required" }));
    }
    state = "create1-issued";
    return sse(toolCall("call_t16_create1", "agent_teams_create", { name: "t16-rtl-ip-team", description: "t16 mount proof for the rtl-ip profile", profile: "rtl-ip", approval: "required" }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
writeFileSync(join(dshHome, "cordis.patch.yml"), ["- id: llm-deepseek", "  config:", `    baseURL: http://127.0.0.1:${port}/v1`, "    apiKeyEnv: DEEPSEEK_API_KEY", ""].join("\n"));

const logPath = join(HERE, "t16d-present-boot.log");
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
writeFileSync(join(HERE, "t16d-present-requests.jsonl"), trace.map((t) => JSON.stringify({ n: t.n, state: t.state, tools: t.tools, roles: t.roles, lastRole: t.lastRole, lastText: t.lastText, systemHasRtlIp: t.systemHasRtlIp })).join("\n") + "\n");
out.boot = { exit: r.status, killed: r.killed, elapsedMs: Date.now() - t0, requests: trace.length, warnCount: (log.match(/silicon rtl-ip profile/g) ?? []).length };
out.states = trace.map((t) => ({ n: t.n, state: t.state, lastRole: t.lastRole, lastText: t.lastText.slice(0, 400) }));
out.finalListing = trace.at(-1)?.listing ?? "";
writeFileSync(join(HERE, "t16d-result.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ planted: out.planted, resolution: out.resolution, boot: out.boot,
  states: out.states.map((s) => ({ n: s.n, state: s.state, lastRole: s.lastRole, lastText: s.lastText.slice(0, 260) })) }, null, 2));
