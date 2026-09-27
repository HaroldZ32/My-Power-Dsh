// packages/mpd-better-sidebar-host/src/index.ts
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
function hostUrl() {
  const here = dirname(fileURLToPath(import.meta.url));
  const bundleRoot = join(here, "..", "..", "..");
  return pathToFileURL(join(bundleRoot, "node_modules", "dsh-better-sidebar", "lib", "index.js")).href;
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
var inject = ["webServer", "sessions", "webRuntime", "tools"];
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
