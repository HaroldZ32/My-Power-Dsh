#!/usr/bin/env node
// build-mpd-client.ts — compose the @mpd-dsh/mpd bundle's combined web client.
// The bundle's client entry (exports["./client"]) must be ONE script that registers
// the bundle id "@mpd-dsh/mpd" (the loader entry name comes from the bundle patch's
// self-row `mpd-web-compat`, and client-modules' arrive() checks the registered id
// against the entry id). The combined file:
//   1) embeds the adopted agent-teams client.js VERBATIM — it self-registers
//      "@nanmicoder/dsh-agent-teams" and is required for its views, monitor store,
//      locale dictionaries and CSS (reached through the additive export bridge in
//      scripts/patch-agent-teams-client.ts). Its apply() is NOT called any more: that
//      is what registered the removed in-conversation card and overlay floater.
//   2) registers "@mpd-dsh/team-page" — the mpd-owned DSH-better-sidebar page that
//      renders those views inside a sidebar tab (src/team-page.ts), then
//   3) registers "@mpd-dsh/mpd" with the mpd web-client factory
//      (packages/mpd-bundle-plugin/src/web-client.ts): team tab + null command view
//      + the workmate library tab.
//
// BOTH features are SIDEBAR-ONLY by decision, so the gate below rejects any mpd client
// source that registers an overlay, an in-conversation chat node or a footer toggle:
// the removed agent-teams card/floater and the removed workmate floater/toggle must
// never come back.
import { readFileSync, writeFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { repoRootFrom } from "./lib/repo.ts"

/** The repository root, derived from this script's own URL (`<root>/scripts/build-mpd-client.ts`). */
const repoRoot: string = repoRootFrom(import.meta.url)

/**
 * Erase TypeScript-only syntax from one factory source before it is spliced into the browser
 * artifact.
 *
 * The three factories below are inlined as TEXT (never bundled), so an annotation or an
 * `interface` declaration would reach the browser verbatim: MEASURED 2026-09-28, the raw splice of
 * the typed sources failed `node --check` with `SyntaxError: Unexpected token ':'`. This is Node's
 * own type stripper — the same transform that lets `node <file>.ts` run — and in `strip` mode it
 * blanks the erased spans instead of reflowing them, so every line keeps its position and the
 * line-anchored boundary searches below still hold.
 *
 * @param source - the `.ts` factory file read as UTF-8 text.
 * @returns the same source as plain JavaScript, ready to be spliced.
 */
const stripFactoryTypes = (source: string): string => stripTypeScriptTypes(source, { mode: "strip" })
/** The adopted agent-teams client bundle, embedded verbatim as the first half of the client entry. */
const agentTeamsClient: string = readFileSync(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "client.js"), "utf8")
/** The sidebar team-page factory source, registered as its own client module. */
const teamPageFactory: string = stripFactoryTypes(readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "team-page.ts"), "utf8")).trim()
/** The mpd web-client factory source, registered last as the bundle's own `@mpd-dsh/mpd` entry. */
const webClientFactory: string = stripFactoryTypes(readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "web-client.ts"), "utf8")).trim()
// The mpd settings card (t35) is an ADDITIVE, ISOLATED client module: removing the feature is this
// file plus the one registration line in web-client.ts, and nothing else may reference it.
/** The settings-card factory source, kept as its own module for the offline harness. */
const settingsCardFactory: string = stripFactoryTypes(readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "settings-card.ts"), "utf8")).trim()

// THE SETTINGS CARD IS ALSO SPLICED INTO THE APPLIED MODULE. Its sibling `load()` block is
// registered but never APPLIED, and `require("@mpd-dsh/settings-card")` cannot reach it — so on a
// real install the mpd settings section silently vanished from the Settings dialog (measured
// 2026-09-27 in docker/ui). The factory body is wrapped in an IIFE (a fresh scope, so its 48
// top-level consts cannot collide with the client's) and injected as `MPD_SETTINGS_CARD`, which
// `loadSettingsCard()` prefers over the require path that the offline harness still exercises.
// LINE-anchored, not brace-anchored: the file's leading comment contains braces, and the
// factory's own opening brace is the LAST line that ends with `=> {`.
/** The settings-card factory source split into lines, for the line-anchored boundary search. */
const settingsCardLines: string[] = settingsCardFactory.split("\n")
/** Index of the factory's opening `=> {` line, or -1 when the boundaries moved. */
const settingsCardOpen: number = settingsCardLines.findIndex((line: string): boolean => line.trimEnd().endsWith("=> {"))
if (settingsCardOpen < 0 || settingsCardLines[settingsCardLines.length - 1].trim() !== "}") {
  console.error("[build-mpd-client] FAIL: the settings-card factory boundaries moved")
  process.exit(1)
}
/** The factory body: everything between the opening `=> {` and the file's final `}`. */
const settingsCardBody: string = settingsCardLines.slice(settingsCardOpen + 1, -1).join("\n") + "\n"
/** The body wrapped in a fresh-scope IIFE, spliced into the applied client module. */
const settingsCardIife: string = "  var MPD_SETTINGS_CARD = (function () {\n" + settingsCardBody + "  })();\n\n"
if (!agentTeamsClient.includes('id: "@nanmicoder/dsh-agent-teams"')) {
  console.error("[build-mpd-client] FAIL: agent-teams client.js no longer self-registers @nanmicoder/dsh-agent-teams")
  process.exit(1)
}
// The export bridge is what makes the sidebar page possible: guard the shipped artifact
// so an unbridged adopted bundle can never ship silently.
if (!agentTeamsClient.includes("//#region mpd-export-bridge")) {
  console.error("[build-mpd-client] FAIL: the adopted client has no mpd export bridge — run node scripts/patch-agent-teams-client.ts")
  process.exit(1)
}
// Both GUIs live in the sidebar now: no mpd client source may register a surface
// outside it. Match the registration shape (not a bare mention, so comments and this
// file's own prose cannot trip the gate).
/** The removed mpd surfaces, each as [human label, registration shape that must be absent]. */
const LEGACY_SURFACES: ReadonlyArray<readonly [string, string]> = [
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
/** The web-client factory with the settings-card IIFE spliced in before `loadSettingsCard()`. */
const webClientWithCard: string = webClientFactory.replace(/(\n\s*function loadSettingsCard\(\) \{)/, "\n" + settingsCardIife + "$1")
if (!webClientWithCard.includes("MPD_SETTINGS_CARD")) { console.error("[build-mpd-client] FAIL: the settings-card splice anchor moved"); process.exit(1) }

/** The combined client artifact: adopted bundle + team page + settings card + mpd client. */
const out: string = agentTeamsClient
  + "\n\n// ==== @mpd-dsh/team-page: AgentTeams rendered inside a DSH-better-sidebar tab ====\n"
  + "window.__ModuleLoader__.load({ id: \"@mpd-dsh/team-page\", factory: " + teamPageFactory + " });\n"
  + "\n// ==== @mpd-dsh/settings-card: kept as a module for the offline harness ====\n"
  + "window.__ModuleLoader__.load({ id: \"@mpd-dsh/settings-card\", factory: " + settingsCardFactory + " });\n"
  // The Team tab for the harness right sidebar is spliced into the @mpd-dsh/mpd module
  // itself (see src/web-client.ts): only THAT module is APPLIED as a client plugin, while a
  // sibling load() block is registered as a module and never applied — measured by adding
  // one and watching the guide render no entry for it.
  + "\n// ==== @mpd-dsh/mpd bundled client: team page + workmate library ====\n"
  + "window.__ModuleLoader__.load({ id: \"@mpd-dsh/mpd\", factory: " + webClientWithCard + " });\n"
writeFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "client.js"), out)
console.log("[build-mpd-client] wrote packages/mpd-bundle-plugin/client.js (" + out.length + " bytes)")
