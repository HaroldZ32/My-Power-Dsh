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
import { repoRootFrom } from "./lib/repo.mjs"

const repoRoot = repoRootFrom(import.meta.url)
const agentTeamsClient = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "client.js"), "utf8")
const teamPageFactory = readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "team-page.js"), "utf8").trim()
const webClientFactory = readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "web-client.js"), "utf8").trim()
// The mpd settings card (t35) is an ADDITIVE, ISOLATED client module: removing the feature is this
// file plus the one registration line in web-client.js, and nothing else may reference it.
const settingsCardFactory = readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "settings-card.js"), "utf8").trim()

// THE SETTINGS CARD IS ALSO SPLICED INTO THE APPLIED MODULE. Its sibling `load()` block is
// registered but never APPLIED, and `require("@mpd-dsh/settings-card")` cannot reach it — so on a
// real install the mpd settings section silently vanished from the Settings dialog (measured
// 2026-09-27 in docker/ui). The factory body is wrapped in an IIFE (a fresh scope, so its 48
// top-level consts cannot collide with the client's) and injected as `MPD_SETTINGS_CARD`, which
// `loadSettingsCard()` prefers over the require path that the offline harness still exercises.
// LINE-anchored, not brace-anchored: the file's leading comment contains braces, and the
// factory's own opening brace is the LAST line that ends with `=> {`.
const settingsCardLines = settingsCardFactory.split("\n")
const settingsCardOpen = settingsCardLines.findIndex((line) => line.trimEnd().endsWith("=> {"))
if (settingsCardOpen < 0 || settingsCardLines[settingsCardLines.length - 1].trim() !== "}") {
  console.error("[build-mpd-client] FAIL: the settings-card factory boundaries moved")
  process.exit(1)
}
const settingsCardBody = settingsCardLines.slice(settingsCardOpen + 1, -1).join("\n") + "\n"
const settingsCardIife = "  var MPD_SETTINGS_CARD = (function () {\n" + settingsCardBody + "  })();\n\n"
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
const webClientWithCard = webClientFactory.replace(/(\n\s*function loadSettingsCard\(\) \{)/, "\n" + settingsCardIife + "$1")
if (!webClientWithCard.includes("MPD_SETTINGS_CARD")) { console.error("[build-mpd-client] FAIL: the settings-card splice anchor moved"); process.exit(1) }

const out = agentTeamsClient
  + "\n\n// ==== @mpd-dsh/team-page: AgentTeams rendered inside a DSH-better-sidebar tab ====\n"
  + "window.__ModuleLoader__.load({ id: \"@mpd-dsh/team-page\", factory: " + teamPageFactory + " });\n"
  + "\n// ==== @mpd-dsh/settings-card: kept as a module for the offline harness ====\n"
  + "window.__ModuleLoader__.load({ id: \"@mpd-dsh/settings-card\", factory: " + settingsCardFactory + " });\n"
  // The Team tab for the harness right sidebar is spliced into the @mpd-dsh/mpd module
  // itself (see src/web-client.js): only THAT module is APPLIED as a client plugin, while a
  // sibling load() block is registered as a module and never applied — measured by adding
  // one and watching the guide render no entry for it.
  + "\n// ==== @mpd-dsh/mpd bundled client: team page + workmate library ====\n"
  + "window.__ModuleLoader__.load({ id: \"@mpd-dsh/mpd\", factory: " + webClientWithCard + " });\n"
writeFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "client.js"), out)
console.log("[build-mpd-client] wrote packages/mpd-bundle-plugin/client.js (" + out.length + " bytes)")
