#!/usr/bin/env node
// build-mpd-client.mjs — compose the @mpd-dsh/mpd bundle's combined web client.
// The bundle's client entry (exports["./client"]) must be ONE script that registers
// the bundle id "@mpd-dsh/mpd" (the loader entry name comes from the bundle patch's
// self-row `mpd-web-compat`, and client-modules' arrive() checks the registered id
// against the entry id). The combined file:
//   1) embeds the adopted agent-teams client.js VERBATIM (it self-registers
//      "@nanmicoder/dsh-agent-teams", which the mpd factory requires to mount the
//      team activity floater + team card unchanged), then
//   2) registers "@mpd-dsh/mpd" with the mpd web-client factory
//      (packages/mpd-bundle-plugin/src/web-client.js): mounts agentTeams.apply(ctx)
//      plus the workmate library floater + sidebar toggle.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const agentTeamsClient = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "client.js"), "utf8")
const webClientFactory = readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "web-client.js"), "utf8").trim()
if (!agentTeamsClient.includes('id: "@nanmicoder/dsh-agent-teams"')) {
  console.error("[build-mpd-client] FAIL: agent-teams client.js no longer self-registers @nanmicoder/dsh-agent-teams")
  process.exit(1)
}
const out = agentTeamsClient
  + "\n\n// ==== @mpd-dsh/mpd bundled client: adopted agent-teams panel + workmate library ====\n"
  + "window.__ModuleLoader__.load({ id: \"@mpd-dsh/mpd\", factory: " + webClientFactory + " });\n"
writeFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "client.js"), out)
console.log("[build-mpd-client] wrote packages/mpd-bundle-plugin/client.js (" + out.length + " bytes)")
