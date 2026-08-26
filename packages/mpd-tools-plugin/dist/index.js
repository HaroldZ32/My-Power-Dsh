// src/index.ts
import { existsSync, readFileSync } from "node:fs";
var name = "mpd-tools";
var inject = ["tools"];
function apply(ctx, config = {}) {
  const writeGuard = config.writeGuard ?? true;
  const maxBytes = config.truncateMaxBytes ?? 16384;
  const recoveryHint = config.recoveryHint ?? "mpd-tools recovery: read the file fresh with the read tool, re-check exact old_string/new_string (whitespace matters), then retry the edit against the current file content.";
  if (writeGuard) {
    ctx.tools.guard((exec) => {
      if (exec.name !== "write")
        return;
      const fp = exec.arguments?.file_path;
      const content = exec.arguments?.content;
      if (typeof fp !== "string" || typeof content !== "string")
        return;
      if (!existsSync(fp))
        return;
      try {
        const old = readFileSync(fp, "utf8").slice(0, 1048576);
        if (old === content)
          return;
      } catch {
        return;
      }
      return "mpd-tools guard: target file already exists with different content — use the edit tool (or read then rewrite deliberately via write with identical content) instead of overwriting.";
    });
  }
  ctx.on("tools/post-execute", async (exec, result, next) => {
    const out = await next();
    if (out.kind !== "accept")
      return out;
    const content = out.content ?? result?.content;
    if (typeof content !== "string" || content.length <= maxBytes)
      return out;
    const head = content.slice(0, Math.floor(maxBytes * 0.7));
    const tail = content.slice(-Math.floor(maxBytes * 0.3));
    return { ...out, content: head + `
... [mpd-tools truncated ` + content.length + " bytes; keep " + maxBytes + ` budget; tail follows] ...
` + tail };
  });
  ctx.on("tools/post-execute", async (exec, result, next) => {
    const out = await next();
    if (out.kind !== "accept")
      return out;
    const isEdit = exec.name === "edit" || exec.name === "str_replace_editor";
    if (!isEdit || !result?.isError)
      return out;
    const msg = result?.error?.message ?? String(result?.error ?? "edit failed");
    const content = out.content ?? result?.content ?? msg;
    return { ...out, content: "Edit failed: " + msg + `
` + recoveryHint };
  });
}
export {
  apply,
  inject,
  name
};
