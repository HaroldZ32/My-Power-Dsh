// packages/mpd-comment-checker-plugin/src/index.ts
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var name = "mpd-comment-checker";
var inject = ["tools"];
function mergedConfig(ctx, config) {
  const svc = ctx.get?.("mpdConfig");
  if (!svc?.get)
    return config;
  const v = (k) => svc.get(k);
  return {
    ...config,
    autoCheck: typeof v("commentChecker.autoCheck") === "boolean" ? v("commentChecker.autoCheck") : config.autoCheck,
    binary: typeof v("commentChecker.bin") === "string" ? v("commentChecker.bin") : config.binary,
    timeoutMs: typeof v("commentChecker.timeoutMs") === "number" ? v("commentChecker.timeoutMs") : config.timeoutMs,
    maxMessageChars: typeof v("commentChecker.maxMessageChars") === "number" ? v("commentChecker.maxMessageChars") : config.maxMessageChars
  };
}
function textBlock(text) {
  return [{ type: "text", text }];
}
function repoRoot() {
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}
function platformKey() {
  const arch = process.arch === "x64" ? "x64" : process.arch;
  return process.platform + "-" + arch;
}
function dependencyBinary() {
  try {
    const req = createRequire(import.meta.url);
    const p = req.resolve("@code-yeongyu/comment-checker/package.json");
    return join(dirname(p), "vendor", platformKey(), "comment-checker");
  } catch {
    return null;
  }
}
function resolveBinary(config) {
  if (config.binary && existsSync(resolve(config.binary)))
    return resolve(config.binary);
  const env = process.env.MPD_DSH_COMMENT_CHECKER_BIN;
  if (env && existsSync(env))
    return env;
  const dep = dependencyBinary();
  if (dep && existsSync(dep))
    return dep;
  const candidates = [
    join(repoRoot(), ".toolchain", "node_modules", "@code-yeongyu", "comment-checker", "vendor", platformKey(), "comment-checker"),
    join(repoRoot(), ".toolchain", "node_modules", "@code-yeongyu", "comment-checker", "bin", "comment-checker")
  ];
  for (const c of candidates)
    if (existsSync(c))
      return c;
  return null;
}
function hookInputFor(path, content) {
  return {
    session_id: "mpd",
    tool_name: "Write",
    transcript_path: "",
    cwd: process.env.DSH_WORKSPACE_ROOT ?? process.cwd(),
    hook_event_name: "PostToolUse",
    tool_input: { file_path: path, content },
    tool_response: { content: [{ type: "text", text: "file content" }], details: null, isError: false }
  };
}
function runCheck(binary, hookInput, timeoutMs) {
  const r = spawnSync(binary, ["check"], { input: JSON.stringify(hookInput), encoding: "utf8", timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
  if (r.error)
    throw new Error("mpd-comment-checker: spawn failed: " + String(r.error.message ?? r.error));
  const stderr = (r.stderr ?? "") + (r.stdout ?? "");
  if (r.status === 0)
    return { hasComments: false, message: "" };
  if (r.status === 2)
    return { hasComments: true, message: stderr };
  return { hasComments: false, message: "unexpected exit " + r.status + ": " + stderr.slice(0, 200) };
}
function apply(ctx, config = {}) {
  const cfg = mergedConfig(ctx, config);
  const timeoutMs = cfg.timeoutMs ?? 30000;
  const maxMessageChars = cfg.maxMessageChars ?? 12000;
  ctx.tools.register({
    name: "mpd_comment_check",
    description: "Run the comment/docstring detector on one or more files (content in memory or read from disk). Returns per-file detection results; exit 2 means comments/docstrings found and the binary message spells the required action. The binary (@code-yeongyu/comment-checker, MIT) must be installed in .toolchain (installer flag --with-comment-checker) or set via MPD_DSH_COMMENT_CHECKER_BIN.",
    parameters: { type: "object", properties: { files: { type: "array", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path"], additionalProperties: false } } }, required: ["files"] },
    output: { schema: { type: "object", properties: { binary: { type: "string" }, results: { type: "array", items: { type: "object" } } }, required: ["binary", "results"] }, render: (_a, v) => textBlock("comment-check binary=" + v.binary + `
` + v.results.map((x) => x.hasComments ? "DETECTED " + x.path + ": " + x.message.slice(0, maxMessageChars) : "clean " + x.path).join(`
`)) },
    execute: async (args) => {
      const binary = resolveBinary(cfg);
      if (!binary)
        throw new Error("mpd-comment-checker: binary not found — run the installer with --with-comment-checker or set MPD_DSH_COMMENT_CHECKER_BIN");
      const files = Array.isArray(args?.files) ? args.files : [];
      const results = [];
      for (const f of files) {
        const path = String(f.path);
        const content = typeof f.content === "string" ? f.content : existsSync(path) ? readFileSync(path, "utf8") : "";
        if (!content) {
          results.push({ path, hasComments: false, message: "no content to check" });
          continue;
        }
        try {
          const res = runCheck(binary, hookInputFor(path, content), timeoutMs);
          if (!res.hasComments && res.message)
            results.push({ path, hasComments: false, message: res.message });
          else
            results.push({ path, ...res });
        } catch (e) {
          results.push({ path, hasComments: false, message: "error: " + String(e?.message ?? e) });
        }
      }
      return { binary, results };
    }
  });
  if (cfg.autoCheck === true) {
    ctx.on("tools/post-execute", async (exec, result, next) => {
      const out = await next();
      if (out.kind !== "accept")
        return out;
      const isEdit = exec.name === "edit" || exec.name === "str_replace_editor" || exec.name === "write";
      if (!isEdit)
        return out;
      const fp = exec.arguments?.file_path ?? exec.arguments?.path;
      if (typeof fp !== "string")
        return out;
      const binary = resolveBinary(cfg);
      if (!binary)
        return out;
      let content = "";
      try {
        content = readFileSync(fp, "utf8");
      } catch {
        return out;
      }
      if (!content)
        return out;
      const res = runCheck(binary, hookInputFor(fp, content), timeoutMs);
      if (!res.hasComments)
        return out;
      const hint = "[mpd-comment-checker] comments/docstrings detected in " + fp + `:
` + res.message.slice(0, maxMessageChars);
      const c = out.content ?? result?.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => b && b.type === "text" ? b.text : "").join(`
`) : "";
      return { ...out, content: [{ type: "text", text: (text ? text + `

` : "") + hint }] };
    });
  }
}
export {
  runCheck,
  resolveBinary,
  name,
  inject,
  hookInputFor,
  apply
};
