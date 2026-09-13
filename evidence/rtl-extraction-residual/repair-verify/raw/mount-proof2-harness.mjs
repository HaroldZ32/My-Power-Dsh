// t15 retry — packed-copy layout (the only layout where the hook can see a sandbox-planted
// silicon package) + a FULL OpenAI-shaped SSE stub modelled on software-smoke.mjs's makeStub.
import { mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, rmSync, statSync, readdirSync, openSync, closeSync } from "node:fs";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "/root/dshProj/my-power-dsh", SILICON = "/root/dshProj/my-power-dsh-silicon";
const HERE = dirname(fileURLToPath(import.meta.url)), SB = join(HERE, "mount-proof2");
const run = (c, a, o) => spawnSync(c, a, { encoding: "utf8", timeout: 600000, ...o });
rmSync(SB, { recursive: true, force: true });
const dshHome = join(SB, "dsh-home"), runHome = join(SB, "run-home"), ws = join(SB, "ws");
for (const d of [dshHome, runHome, ws]) mkdirSync(d, { recursive: true });
for (const cand of ["/root/dshProj/my-power-dsh/.toolchain/node_modules/.bin/codegraph", "/root/dshProj/my-power-dsh/.toolchain/bin/codegraph"]) { if (existsSync(cand)) process.env.MPD_CODEGRAPH_BIN = cand; }
const env = { ...process.env, DSH_HOME: dshHome, HOME: runHome, DEEPSEEK_API_KEY: "sk-t15-local-stub",
  npm_config_store_dir: join(SB, "pnpm-store"), npm_config_cache: join(SB, "npm-cache"), PNPM_HOME: join(SB, "pnpm-home") };
const out = {};
cpSync(join(REPO, "dist/mpd-package"), join(SB, "mpd-package"), { recursive: true });
const add = run("dsh", ["plugin", "--profile", "mpd-headless", "add", join(SB, "mpd-package")], { env, cwd: ws });
out.pluginAdd = { status: add.status, tail: (String(add.stdout) + String(add.stderr)).slice(-300) };
const profileDir = join(dshHome, "profiles", "mpd-headless");
const targets = [join(SB, "node_modules/@mpd-dsh/silicon"), join(SB, "mpd-package/node_modules/@mpd-dsh/silicon"), join(profileDir, "node_modules/@mpd-dsh/silicon")];
for (const t of targets) { mkdirSync(t, { recursive: true }); cpSync(join(SILICON, "package.json"), join(t, "package.json")); cpSync(join(SILICON, "presets"), join(t, "presets"), { recursive: true }); }
const planted = join(SB, "node_modules/@mpd-dsh/silicon/presets/rtl-ip.profile.json");
out.planted = { bytes: statSync(planted).size, isFile: statSync(planted).isFile() };

// FULL stub: complete OpenAI-shaped SSE, multi-chunk, with a tool call on request #1.
function makeStub() {
  const trace = [];
  let n = 0;
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const parsed = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      const tools = (parsed.tools ?? []).map((t) => t?.function?.name ?? t?.name).filter(Boolean);
      trace.push({ n: ++n, url: req.url, tools, body });
      const head = { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" };
      res.writeHead(200, head);
      const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: "chatcmpl-t15", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: parsed.model ?? "stub", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      res.write(chunk({ role: "assistant", content: "" }));
      if (n === 1 && tools.includes("agent_teams_create")) {
        res.write(chunk({ tool_calls: [{ index: 0, id: "call_t15_1", type: "function", function: { name: "agent_teams_create", arguments: JSON.stringify({ goal: "t15 mount proof", profile: "rtl-ip", approval: "required" }) } }] }));
        res.write(chunk({}, "tool_calls"));
      } else {
        res.write(chunk({ content: "t15-done" }));
        res.write(chunk({}, "stop"));
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return { trace, listen: () => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port))), close: () => srv.close() };
}

async function boot(label, timeoutMs) {
  const s = makeStub();
  const port = await s.listen();
  const pf = existsSync(join(dshHome, "cordis.patch.yml")) ? join(dshHome, "cordis.patch.yml") : join(profileDir, "cordis.patch.yml");
  const before = existsSync(pf) ? readFileSync(pf, "utf8") : "[]\n";
  const row = ["- id: llm-deepseek", "  config:", `    baseURL: http://127.0.0.1:${port}/v1`, "    apiKeyEnv: DEEPSEEK_API_KEY"].join("\n");
  writeFileSync(pf, before.replace(/^\[\]\s*$/m, "").trimEnd() + "\n" + row + "\n");
  const raw = join(SB, `boot-${label}.raw.log`);
  const fd = openSync(raw, "w");
  const r = spawnSync("dsh", ["--profile", "mpd-headless", "Prove the mount."], { env, cwd: ws, stdio: ["ignore", fd, fd], timeout: timeoutMs, killSignal: "SIGKILL" });
  closeSync(fd);
  const txt = readFileSync(raw, "utf8");
  writeFileSync(join(SB, `boot-${label}.log`), txt);
  const prompt = s.trace.map((t) => t.body).join("\n");
  // session-log capture: even a killed boot leaves the on-disk session record
  let sessionText = "";
  try {
    const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const q = join(d, e.name); if (e.isDirectory()) walk(q); else if (/session.*\.(jsonl|zst|json)/.test(e.name)) { try { sessionText += readFileSync(q).toString("latin1") + "\n"; } catch {} } } };
    walk(join(dshHome, "sessions"));
  } catch {}
  const sessionHit = { filesBytes: sessionText.length, rtlIp: /rtl-ip/.test(sessionText), profiles: /Configured team profiles/.test(sessionText) };
  s.close();
  return { label, exit: r.status, signal: r.signal, requests: s.trace.length, toolsOffered: s.trace[0]?.tools?.slice(0, 6) ?? [],
    rtlIpInPrompt: /rtl-ip/.test(prompt), listingInPrompt: /Configured team profiles/.test(prompt),
    snippet: (prompt.match(/Configured team profiles[\s\S]{0,320}/) ?? [""])[0],
    warnCount: (txt.match(/silicon rtl-ip profile/g) ?? []).length, sessionHit, tail: txt.slice(-500) };
}
out.present = await boot("present", 600000);
for (const t of targets) rmSync(t, { recursive: true, force: true });
out.absent = await boot("absent", 300000);
writeFileSync(join(HERE, "mount-proof2-result.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ codegraphBin: process.env.MPD_CODEGRAPH_BIN ?? null, pluginAdd: out.pluginAdd.status, planted: out.planted,
  present: { exit: out.present.exit, requests: out.present.requests, rtlIp: out.present.rtlIpInPrompt, listing: out.present.listingInPrompt, warnCount: out.present.warnCount, sessionHit: out.present.sessionHit, snippet: out.present.snippet.slice(0, 200) },
  absent: { exit: out.absent.exit, requests: out.absent.requests, rtlIp: out.absent.rtlIpInPrompt, warnCount: out.absent.warnCount } }, null, 2));
