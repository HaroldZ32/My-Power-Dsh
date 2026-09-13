// t16 diagnostic — why did the session never reach the stub?
// Bounded: one boot, stdio to FILES (never pipes), 180 s kill, stub logs every hit.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, openSync, closeSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SB = join(HERE, "mount-proof2");
const dshHome = join(SB, "dsh-home");
const runHome = join(SB, "run-home");
const ws = join(SB, "ws");
const profileDir = join(dshHome, "profiles", "mpd-headless");

const trace = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    trace.push({ n: trace.length + 1, url: req.url, bytes: body.length, tools: (() => { try { return (JSON.parse(body).tools ?? []).map((t) => t?.function?.name ?? t?.name).filter(Boolean).length; } catch { return -1; } })() });
    const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: "chatcmpl-t16-diag", object: "chat.completion.chunk", created: 1, model: "probe", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    res.write(chunk({ role: "assistant", content: "diag-ok" }));
    res.write(chunk({}, "stop"));
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const patchPath = join(profileDir, "cordis.patch.yml");
const pre = existsSync(patchPath) ? readFileSync(patchPath, "utf8") : "";
mkdirSync(dirname(join(HERE, "t16-diag-boot.log")), { recursive: true });
writeFileSync(join(HERE, "t16-diag-patch-before.txt"), pre);
writeFileSync(patchPath, [
  "# t16 diagnostic patch — exactly one provider row, id-targeted",
  "- id: llm-deepseek",
  "  config:",
  `    baseURL: http://127.0.0.1:${port}/v1`,
  "    apiKeyEnv: DEEPSEEK_API_KEY",
  "",
].join("\n"));

const env = { ...process.env, DSH_HOME: dshHome, HOME: runHome, DEEPSEEK_API_KEY: "sk-t16-diag-stub",
  npm_config_store_dir: join(SB, "pnpm-store"), npm_config_cache: join(SB, "npm-cache"), PNPM_HOME: join(SB, "pnpm-home") };
const logFd = openSync(join(HERE, "t16-diag-boot.log"), "a");
const child = spawn("dsh", ["--profile", "mpd-headless", "Say diag-ok and stop."], { env, cwd: ws, stdio: ["ignore", logFd, logFd] });
const t0 = Date.now();
const result = await new Promise((resolve) => {
  const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve({ status: -9, killed: true }); }, 180000);
  child.on("error", (e) => { clearTimeout(timer); resolve({ status: -1, error: String(e), killed: false }); });
  child.on("close", (status, signal) => { clearTimeout(timer); resolve({ status, signal, killed: false }); });
});
closeSync(logFd);
server.close();
const log = existsSync(join(HERE, "t16-diag-boot.log")) ? readFileSync(join(HERE, "t16-diag-boot.log"), "utf8") : "";
const sig = (re) => (log.match(re) ?? []).length;
const out = {
  port, boot: result, elapsedMs: Date.now() - t0, stubRequests: trace.length, trace,
  logBytes: log.length,
  signatures: {
    missingCredential: sig(/MISSING_CREDENTIAL/g), authFailed: sig(/AUTH:|Authentication Fails|invalid_api_key/g),
    appliedPatch: sig(/llm-deepseek/g), profileMounted: sig(/mpd-headless/g),
    teamProfilesListed: sig(/[Cc]onfigured team profiles/g), rtlIp: sig(/rtl-ip/g),
    applyCrash: sig(/unsupported JSON schema|JsonSchemaError|plugin tree failed to load|failed to apply loader entry/g),
    mcpSpawn: sig(/mcp-client|spawn/g),
  },
  logTail: log.slice(-4000),
};
writeFileSync(join(HERE, "t16-diag-result.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ boot: result, elapsedMs: out.elapsedMs, stubRequests: trace.length, signatures: out.signatures, logBytes: log.length }, null, 2));
console.log("---- log tail ----");
console.log(out.logTail);
