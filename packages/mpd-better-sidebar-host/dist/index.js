// packages/mpd-better-sidebar-host/src/index.ts
import { dirname, join as join2 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// packages/mpd-mcp-shared/log-sink.ts
import { join, resolve } from "node:path";
var LOG_SUBDIR = join(".mpd", "logs");
var DEFAULT_MAX_BYTES = 1024 * 1024;
// packages/mpd-dsh-adapter-plugin/src/index.ts
var DSH_SEAM_TOOLS = "tools";
var DSH_SEAM_SESSIONS = "sessions";
var DSH_SEAM_WEB_SERVER = "webServer";
var DSH_SEAM_WEB_RUNTIME = "webRuntime";
function dshSeamInject(...names) {
  return [...names];
}
var rowLogSinks = new Map;

// packages/mpd-better-sidebar-host/src/index.ts
function hostUrl() {
  const here = dirname(fileURLToPath(import.meta.url));
  const bundleRoot = join2(here, "..", "..", "..");
  return pathToFileURL(join2(bundleRoot, "node_modules", "dsh-better-sidebar", "lib", "index.js")).href;
}
var cached;
async function loadSidebarHost() {
  if (cached !== undefined)
    return cached;
  const url = hostUrl();
  try {
    cached = await import(url);
    return cached;
  } catch (error) {
    throw new Error(`mpd-better-sidebar-host: could not import the sidebar host at ${url}: ${String(error?.message ?? error)}`);
  }
}
var name = "mpd-better-sidebar-host";
var inject = dshSeamInject(DSH_SEAM_WEB_SERVER, DSH_SEAM_SESSIONS, DSH_SEAM_WEB_RUNTIME, DSH_SEAM_TOOLS);
async function apply(ctx, config) {
  const host = await loadSidebarHost();
  if (typeof host.apply !== "function")
    throw new Error("mpd-better-sidebar-host: the sidebar host exports no apply()");
  await host.apply(ctx, config);
}
export {
  apply,
  inject,
  loadSidebarHost,
  name
};
