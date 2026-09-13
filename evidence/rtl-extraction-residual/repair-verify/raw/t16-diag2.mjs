// t16 diagnostic 2 — calibration lane: does a live session reach a local stub in the
// install-profile layout (the QA case's proven recipe)? If yes here and not in the packed
// layout, the packed layout is the blocker; if no here either, the environment/stub is.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, openSync, closeSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = "/root/dshProj/my-power-dsh";
const SB = join(HERE, "t16-diag2-sandbox");
rmSync(SB, { recursive: true, force: true });
const dshHome = join(SB, "dsh-home"), runHome = join(SB, "run-home"), ws = join(SB, "ws");
for (const d of [dshHome, runHome, ws]) mkdirSync(d, { recursive: true });

const env = { ...process.env, DSH_HOME: dshHome, HOME: runHome, DEEPSEEK_API_KEY: "sk-t16-diag2-stub",
  npm_config_store_dir: join(SB, "pnpm-store"), npm_config_cache: join(SB, "npm-cache"), PNPM_HOME: join(SB, "pnpm-home") };

const inst = spawnSync(process.execPath, [join(REPO, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", dshHome, "--profile", "mpd-headless", "--skip-toolchain"],
  { encoding: "utf8", timeout: 900000, env, cwd: ws });
writeFileSync(join(HERE, "t16-diag2-install.log"), String(inst.stdout ?? "") + String(inst.stderr ?? ""));
if (inst.status !== 0) {
  writeFileSync(join(HERE, "t16-diag2-result.json"), JSON.stringify({ install: { status: inst.status }, aborted: true }, null, 2));
  console.log(JSON.stringify({ install: { status: inst.status }, aborted: true }));
  process.exit(0);
}

const trace = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    trace.push({ n: trace.length + 1, url: req.url, bytes: body.length });
    const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: "chatcmpl-t16-diag2", object: "chat.completion.chunk", created: 1, model: "probe", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    res.write(chunk({ role: "assistant", content: "diag2-ok" }));
    res.write(chunk({}, "stop"));
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const patchPath = join(dshHome, "cordis.patch.yml");
const before = existsSync(patchPath) ? readFileSync(patchPath, "utf8") : "";
writeFileSync(join(HERE, "t16-diag2-patch-before.txt"), before);
writeFileSync(patchPath, before.trimEnd() + "\n" + ["- id: llm-deepseek", "  config:", `    baseURL: http://127.0.0.1:${port}/v1`, "    apiKeyEnv: DEEPSEEK_API_KEY", ""].join("\n"));

const logFd = openSync(join(HERE, "t16-diag2-boot.log"), "a");
const child = spawn("dsh", ["--profile", "mpd-headless", "Say diag2-ok and stop."], { env, cwd: ws, stdio: ["ignore", logFd, logFd] });
const t0 = Date.now();
const result = await new Promise((resolve) => {
  const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve({ status: -9, killed: true }); }, 180000);
  child.on("error", (e) => { clearTimeout(timer); resolve({ status: -1, error: String(e), killed: false }); });
  child.on("close", (status, signal) => { clearTimeout(timer); resolve({ status, signal, killed: false }); });
});
closeSync(logFd);
server.close();
const log = existsSync(join(HERE, "t16-diag2-boot.log")) ? readFileSync(join(HERE, "t16-diag2-boot.log"), "utf8") : "";
const sig = (re) => (log.match(re) ?? []).length;
const out = { install: { status: inst.status }, port, boot: result, elapsedMs: Date.now() - t0, stubRequests: trace.length, trace,
  logBytes: log.length,
  signatures: { missingCredential: sig(/MISSING_CREDENTIAL/g), authFailed: sig(/AUTH:|Authentication Fails|invalid_api_key/g),
    teamProfilesListed: sig(/[Cc]onfigured team profiles/g), rtlIp: sig(/rtl-ip/g),
    applyCrash: sig(/unsupported JSON schema|JsonSchemaError|plugin tree failed to load|failed to apply loader entry/g) },
  logTail: log.slice(-3000) };
writeFileSync(join(HERE, "t16-diag2-result.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ install: inst.status, boot: result, elapsedMs: out.elapsedMs, stubRequests: trace.length, signatures: out.signatures }, null, 2));
console.log("---- log tail ----");
console.log(out.logTail);
