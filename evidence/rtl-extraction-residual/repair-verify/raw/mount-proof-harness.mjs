// t15 mount-proof harness — proves the carrier-hook merge at SESSION level.
// Sandbox lives under repair-verify/raw/mount-proof/ (untracked); the repo is read-only.
// Present direction: @mpd-dsh/silicon is GENUINELY installed (npm pack -> extracted package dir).
// Observation: the model request the real dsh session sends (its system prompt carries the merged
// profile listing) plus the result of a real agent_teams_create call issued by the stub model.
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, cpSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "/root/dshProj/my-power-dsh";
const SILICON = "/root/dshProj/my-power-dsh-silicon";
const HERE = dirname(fileURLToPath(import.meta.url));
const SB = join(HERE, "mount-proof");
const step = (name, r) => ({ name, status: r.status, ok: r.status === 0, tail: String(r.stdout ?? "").slice(-700) + String(r.stderr ?? "").slice(-400) });
const run = (cmd, args, opts) => spawnSync(cmd, args, { encoding: "utf8", timeout: 900000, ...opts });
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const out = {};

rmSync(SB, { recursive: true, force: true });
mkdirSync(SB, { recursive: true });
const dshHome = join(SB, "dsh-home");
const runHome = join(SB, "run-home");
const ws = join(SB, "ws");
for (const d of [dshHome, runHome, ws]) mkdirSync(d, { recursive: true });

// 1. bring the packed bundle into the sandbox (read-only copy of dist/mpd-package)
const pkg = join(SB, "mpd-package");
cpSync(join(REPO, "dist/mpd-package"), pkg, { recursive: true });
out.packed = { copied: existsSync(join(pkg, "package.json")), bytes: statSync(join(pkg, "package.json")).size };

// 2. install the bundle into a sandbox profile
const env = { ...process.env, DSH_HOME: dshHome, HOME: runHome, DEEPSEEK_API_KEY: "sk-t15-local-stub",
  npm_config_store_dir: join(SB, "pnpm-store"), npm_config_cache: join(SB, "npm-cache"), PNPM_HOME: join(SB, "pnpm-home"), npm_config_offline: "true" };
out.pluginAdd = step("dsh plugin add", run("dsh", ["plugin", "--profile", "mpd-headless", "add", pkg], { env, cwd: ws }));
const profileDir = join(dshHome, "profiles", "mpd-headless");
if (out.pluginAdd.status !== 0) {
  out.pluginAddFallback = step("install-profile --yes", run(process.execPath, [join(REPO, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", dshHome, "--profile", "mpd-headless", "--skip-toolchain"], { env, cwd: ws }));
}

// 3. genuinely install @mpd-dsh/silicon as a REAL package directory (copy, not symlink).
//    npm pack was attempted first and failed offline (log dir unwritable) -> recorded, then copied.
const packRes = run("npm", ["pack", SILICON, "--pack-destination", SB], { encoding: "utf8", timeout: 300000 });
out.npmPack = step("npm pack sibling (offline attempt)", packRes);
const targets = [join(SB, "node_modules", "@mpd-dsh", "silicon"), join(SB, "mpd-package", "node_modules", "@mpd-dsh", "silicon"), join(profileDir, "node_modules", "@mpd-dsh", "silicon")];
for (const t of targets) {
  mkdirSync(t, { recursive: true });
  cpSync(join(SILICON, "package.json"), join(t, "package.json"));
  cpSync(join(SILICON, "presets"), join(t, "presets"), { recursive: true });
}
const planted = join(SB, "node_modules", "@mpd-dsh", "silicon", "presets", "rtl-ip.profile.json");
out.silicon = {
  method: "real package directory copied from the sibling checkout (npm pack offline-failed; see npmPack tail)",
  plantedAt: planted, exists: existsSync(planted),
  bytes: existsSync(planted) ? statSync(planted).size : 0,
  sha256: existsSync(planted) ? sha(planted) : null,
  siblingBytes: statSync(join(SILICON, "presets/rtl-ip.profile.json")).size,
  siblingSha: sha(join(SILICON, "presets/rtl-ip.profile.json")),
  copies: targets.map((t) => ({ path: t, file: existsSync(join(t, "presets/rtl-ip.profile.json")), isFile: existsSync(join(t, "presets/rtl-ip.profile.json")) ? statSync(join(t, "presets/rtl-ip.profile.json")).isFile() : null })),
};

// 4. resolve-proof from the plugin's own location (read-only require.resolve check in the sandbox)
out.resolve = (() => {
  const libDirs = [
    join(pkg, "packages/mpd-agent-teams-plugin/lib"),
    join(profileDir, "node_modules/@mpd-dsh/mpd/packages/mpd-agent-teams-plugin/lib"),
    join(SB, "node_modules/@mpd-dsh/mpd/packages/mpd-agent-teams-plugin/lib"),
  ].filter(existsSync);
  const probe = join(SB, "resolve-probe.mjs");
  writeFileSync(probe, `import { createRequire } from "node:module";\nconst r = createRequire(${JSON.stringify(libDirs[0] + "/index.js")});\ntry { console.log("RESOLVED " + r.resolve("@mpd-dsh/silicon/presets/rtl-ip.profile.json")) } catch (e) { console.log("UNRESOLVED " + e.code) }\n`);
  const r = run(process.execPath, [probe], { cwd: SB });
  return { libDirs, out: String(r.stdout).trim() };
})();

// 5. stub model: records the request, then asks for a real agent_teams_create call
function stub() {
  const trace = [];
  let call = 0;
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      const tools = (parsed.tools ?? []).map((t) => t?.function?.name ?? t?.name).filter(Boolean);
      trace.push({ call: ++call, body, tools, messages: (parsed.messages ?? []).length });
      const send = (delta, finish) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ id: "chatcmpl-t15", object: "chat.completion.chunk", created: 1, model: "stub", choices: [{ index: 0, delta, finish_reason: finish ?? null }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      };
      if (call === 1 && tools.includes("agent_teams_create")) {
        return send({ role: "assistant", tool_calls: [{ index: 0, id: "call_t15_1", type: "function", function: { name: "agent_teams_create", arguments: JSON.stringify({ goal: "t15 mount proof", profile: "rtl-ip", approval: "required" }) } }] });
      }
      return send({ role: "assistant", content: "t15-done" }, "stop");
    });
  });
  return { trace, listen: () => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port))), close: () => srv.close() };
}

async function boot(label) {
  const s = stub();
  const port = await s.listen();
  // patch: point the deepseek provider at the stub (same shape the QA smoke case uses)
  const patchFile = existsSync(join(dshHome, "cordis.patch.yml")) ? join(dshHome, "cordis.patch.yml") : join(profileDir, "cordis.patch.yml");
  const before = existsSync(patchFile) ? readFileSync(patchFile, "utf8") : "";
  const stubRow = ["- id: llm-deepseek", "  config:", `    baseURL: http://127.0.0.1:${port}/v1`, "    apiKeyEnv: DEEPSEEK_API_KEY"].join("\n");
  // the profile patch template ships an empty top-level array `[]`; the stub row REPLACES it
  // (appending after `[]` would create a second YAML document -> parse error).
  const withStub = before.replace(/^\[\]\s*$/m, "").replace(/\n{2,}/g, "\n\n").trimEnd() + "\n" + stubRow + "\n";
  writeFileSync(patchFile, withStub);
  const r = run("dsh", ["--profile", "mpd-headless", "Prove the mount."], { env, cwd: ws });
  s.close();
  const all = String(r.stdout ?? "") + String(r.stderr ?? "");
  const promptText = s.trace.map((t) => t.body).join("\n");
  return {
    label,
    exit: r.status,
    stubCalls: s.trace.length,
    toolsOffered: s.trace[0]?.tools?.slice(0, 8) ?? [],
    hasRtlIpInPrompt: /rtl-ip/.test(promptText),
    hasMpdListingInPrompt: /Configured team profiles/.test(promptText),
    promptSnippet: (promptText.match(/Configured team profiles[\s\S]{0,400}/) ?? [""])[0].slice(0, 400),
    warningsInBoot: (all.match(/agent-teams: ignoring the silicon rtl-ip profile[\s\S]{0,120}|cannot read the silicon rtl-ip profile[\s\S]{0,120}/g) ?? []).slice(0, 3),
    warnCount: (all.match(/silicon rtl-ip profile/g) ?? []).length,
    createResult: (all.match(/rtl-ip[\s\S]{0,200}/g) ?? []).slice(0, 2),
    bootTail: all.slice(-900),
  };
}

out.present = await boot("present");
// 6. absent direction: remove the silicon package (both places) and re-boot in the same harness
for (const t of targets) rmSync(t, { recursive: true, force: true });
out.siliconRemoved = {
  sandboxGone: !existsSync(join(SB, "node_modules/@mpd-dsh/silicon")),
  packGone: !existsSync(join(SB, "mpd-package/node_modules/@mpd-dsh/silicon")),
  profileGone: !existsSync(join(profileDir, "node_modules/@mpd-dsh/silicon")),
  pluginResolve: out.resolve.out.replace("RESOLVED", "resolved(after-removal)"),
};
out.absent = await boot("absent");

writeFileSync(join(HERE, "mount-proof-result.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  packed: out.packed, pluginAdd: out.pluginAdd.status, pluginAddFallback: out.pluginAddFallback ? out.pluginAddFallback.status : "not-needed", npmPack: out.npmPack.status, silicon: out.silicon, resolve: out.resolve,
  present: { exit: out.present.exit, calls: out.present.stubCalls, rtlIpInPrompt: out.present.hasRtlIpInPrompt, listing: out.present.hasMpdListingInPrompt, warnCount: out.present.warnCount, snippet: out.present.promptSnippet.slice(0, 220) },
  absent: { exit: out.absent.exit, calls: out.absent.stubCalls, rtlIpInPrompt: out.absent.hasRtlIpInPrompt, warnCount: out.absent.warnCount },
}, null, 2));
