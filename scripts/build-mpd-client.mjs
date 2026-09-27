#!/usr/bin/env node
// build-mpd-client.mjs — compose the @mpd-dsh/mpd bundle's combined web client.
// The bundle's client entry (exports["./client"]) must be ONE script that registers
// the bundle id "@mpd-dsh/mpd" (the loader entry name comes from the bundle patch's
// self-row `mpd-web-compat`, and client-modules' arrive() checks the registered id
// against the entry id). The combined file:
//   1) embeds the adopted agent-teams client.js VERBATIM — it self-registers
//      "@nanmicoder/dsh-agent-teams" and is required for its views, monitor store,
//      locale dictionaries and CSS (reached through the additive export bridge in
//      scripts/patch-agent-teams-client.mjs). Its apply() is NOT called any more: that
//      is what registered the removed in-conversation card and overlay floater.
//   2) registers "@mpd-dsh/team-page" — the mpd-owned DSH-better-sidebar page that
//      renders those views inside a sidebar tab (src/team-page.js), then
//   3) registers "@mpd-dsh/mpd" with the mpd web-client factory
//      (packages/mpd-bundle-plugin/src/web-client.js): team tab + null command view
//      + the workmate library tab.
//
// BOTH features are SIDEBAR-ONLY by decision, so the gate below rejects any mpd client
// source that registers an overlay, an in-conversation chat node or a footer toggle:
// the removed agent-teams card/floater and the removed workmate floater/toggle must
// never come back.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const agentTeamsClient = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "client.js"), "utf8")
const teamPageFactory = readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "team-page.js"), "utf8").trim()
const webClientFactory = readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "web-client.js"), "utf8").trim()
// The bundle's TEAM tab for the HARNESS'S OWN right sidebar (ctx.sidebarRightTabs). It is a
// separate module from the better-sidebar page on purpose: that host is a third-party
// dependency a checkout install does not resolve, while the harness sidebar is always there.
const teamSidebarFactory = readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "team-sidebar.js"), "utf8").trim()
// The mpd settings card (t35) is an ADDITIVE, ISOLATED client module: removing the feature is this
// file plus the one registration line in web-client.js, and nothing else may reference it.
const settingsCardFactory = readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "settings-card.js"), "utf8").trim()
if (!agentTeamsClient.includes('id: "@nanmicoder/dsh-agent-teams"')) {
  console.error("[build-mpd-client] FAIL: agent-teams client.js no longer self-registers @nanmicoder/dsh-agent-teams")
  process.exit(1)
}
// The export bridge is what makes the sidebar page possible: guard the shipped artifact
// so an unbridged adopted bundle can never ship silently.
if (!agentTeamsClient.includes("//#region mpd-export-bridge")) {
  console.error("[build-mpd-client] FAIL: the adopted client has no mpd export bridge — run node scripts/patch-agent-teams-client.mjs")
  process.exit(1)
}
// Both GUIs live in the sidebar now: no mpd client source may register a surface
// outside it. Match the registration shape (not a bare mention, so comments and this
// file's own prose cannot trip the gate).
const LEGACY_SURFACES = [
  ["agent-teams activity floater", 'id: "agent-teams-activity"'],
  ["in-conversation chat card", 'inject("conversation.chat.node"'],
  ["workmate overlay floater", 'inject("shell.overlay"'],
  ["workmate footer toggle", 'inject("sidebar.footer.action"'],
]
for (const [label, legacy] of LEGACY_SURFACES) {
  if (webClientFactory.includes(legacy) || teamPageFactory.includes(legacy)) {
    console.error(`[build-mpd-client] FAIL: the removed ${label} (${legacy}) is still registered by an mpd client source`)
    process.exit(1)
  }
}
const out = agentTeamsClient
  + "\n\n// ==== @mpd-dsh/team-page: AgentTeams rendered inside a DSH-better-sidebar tab ====\n"
  + "window.__ModuleLoader__.load({ id: \"@mpd-dsh/team-page\", factory: " + teamPageFactory + " });\n"
  + "\n// ==== @mpd-dsh/settings-card: the mpd settings card (t35, additive + isolated) ====\n"
  + "window.__ModuleLoader__.load({ id: \"@mpd-dsh/settings-card\", factory: " + settingsCardFactory + " });\n"
  + "\n// ==== @mpd-dsh/team-sidebar: the Team tab in the HARNESS right sidebar ====\n"
  + "window.__ModuleLoader__.load({ id: \"@mpd-dsh/team-sidebar\", factory: " + teamSidebarFactory + " });\n"
  + "\n// ==== @mpd-dsh/mpd bundled client: team page + workmate library ====\n"
  + "window.__ModuleLoader__.load({ id: \"@mpd-dsh/mpd\", factory: " + webClientFactory + " });\n"
writeFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "client.js"), out)
console.log("[build-mpd-client] wrote packages/mpd-bundle-plugin/client.js (" + out.length + " bytes)")
