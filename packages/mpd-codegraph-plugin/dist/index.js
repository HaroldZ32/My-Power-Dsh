// src/index.ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { writeFileSync } from "node:fs";
var name = "mpd-codegraph";
var inject = [];
function packageCodegraphPath() {
  try {
    const req = createRequire(import.meta.url);
    const p = req.resolve("@colbymchenry/codegraph/package.json");
    const binEntry = JSON.parse(readFileSync(join(dirname(p), "package.json"), "utf8"));
    const bin = typeof binEntry.bin === "string" ? binEntry.bin : binEntry.bin?.codegraph ?? "codegraph";
    return join(dirname(p), bin);
  } catch {
    return null;
  }
}
function resolveBinary(config) {
  const candidates = [
    config?.binary,
    process.env.MPD_CODEGRAPH_BIN ?? process.env.MPD_DSH_CODEGRAPH_BIN,
    process.env.MPD_DSH_CODEGRAPH_BIN
  ].filter((s) => !!s && s.length > 0);
  for (const c of candidates)
    if (existsSync(c))
      return c;
  const pkgBin = packageCodegraphPath();
  if (pkgBin && existsSync(pkgBin))
    return pkgBin;
  for (const p of (process.env.PATH || "").split(":")) {
    const f = join(p, "codegraph");
    if (existsSync(f))
      return f;
  }
  return null;
}
function cooldownFresh(cwd, cooldownMs) {
  const stamp = join(cwd, ".codegraph", "init.cooldown");
  if (!existsSync(stamp))
    return false;
  try {
    const age = Date.now() - statSync(stamp).mtimeMs;
    return age < cooldownMs;
  } catch {
    return false;
  }
}
function initProject(cwd, binary, timeoutMs) {
  const marker = join(cwd, ".codegraph", "codegraph.db");
  if (existsSync(marker))
    return "marker";
  const lock = join(cwd, ".codegraph", "init.lock");
  const lockDir = join(cwd, ".codegraph");
  try {
    mkdirSync(lockDir, { recursive: true });
    mkdirSync(lock, { recursive: false });
  } catch {
    return "locked";
  }
  try {
    const r = spawnSync(binary, ["init"], { cwd, timeout: timeoutMs, stdio: "ignore" });
    if (r.status === 0 && existsSync(marker))
      return "ok";
    return r.status === 0 ? "fail-no-marker" : "fail";
  } finally {
    try {
      rmSync(lock, { recursive: true, force: true });
    } catch {}
    try {
      writeCooldown(join(cwd, ".codegraph"), "init.cooldown");
    } catch {}
  }
}
function writeCooldown(dir, file) {
  try {
    writeFileSync(join(dir, file), String(Date.now()));
  } catch {}
}
function apply(ctx, config = {}) {
  const autoInit = config.autoInit ?? true;
  const timeoutMs = config.initTimeoutMs ?? 60000;
  const cooldownMs = config.cooldownMs ?? 15 * 60000;
  const cwd = (process.env.MPD_CODEGRAPH_PROJECT_CWD ?? process.env.MPD_DSH_CODEGRAPH_PROJECT_CWD) || process.cwd();
  const binary = resolveBinary(config);
  let status;
  const home = resolve(homedir());
  if (!binary) {
    status = "no-binary";
  } else if (existsSync(join(cwd, ".codegraph", "codegraph.db"))) {
    status = "marker";
  } else if (!autoInit) {
    status = "auto-init-disabled";
  } else if (resolve(cwd) === home) {
    status = "skipped-home";
  } else if (cooldownFresh(cwd, cooldownMs)) {
    status = "cooldown";
  } else {
    status = initProject(cwd, binary, timeoutMs);
  }
  console.log("[mpd-codegraph] init status=" + status + " binary=" + (binary ?? "-") + " cwd=" + cwd + (status === "skipped-home" ? " (workspace is the user home; start a session inside a project dir, or set MPD_DSH_CODEGRAPH_PROJECT_CWD, or run /mpd-codegraph there)" : ""));
  try {
    const commands = ctx.get && ctx.get("commands");
    if (commands?.register) {
      commands.register({
        name: "mpd-codegraph",
        description: "Initialize/re-run the CodeGraph index (.codegraph/codegraph.db)",
        handler: async () => {
          const b = resolveBinary(config);
          if (!b)
            return { success: false, error: "codegraph binary unavailable: install it or set MPD_DSH_CODEGRAPH_BIN" };
          const s = existsSync(join(cwd, ".codegraph", "codegraph.db")) ? "marker" : initProject(cwd, b, timeoutMs);
          return { success: s === "ok" || s === "marker", text: "mpd-codegraph init: " + s };
        }
      });
    }
  } catch {}
}
export {
  apply,
  inject,
  name
};
