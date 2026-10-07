#!/usr/bin/env node
// build-mpd-client.ts — compose the @mpd-dsh/mpd bundle's combined web client.
// The bundle's client entry (exports["./client"]) must be ONE script that registers
// the bundle id "@mpd-dsh/mpd" (the loader entry name comes from the bundle patch's
// self-row `mpd-web-compat`, and client-modules' arrive() checks the registered id
// against the entry id). The combined file:
//   1) embeds the adopted agent-teams client bundle VERBATIM — it self-registers
//      "@nanmicoder/dsh-agent-teams" and is required for its views, monitor store,
//      locale dictionaries and CSS (reached through the additive export bridge that
//      is baked into the relocated copy at its marked region). Its apply() is NOT
//      called any more: that is what registered the removed in-conversation card and
//      overlay floater.
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
const agentTeamsClient: string = readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "adopted", "agent-teams-client.js"), "utf8")
/** The sidebar team-page factory source, registered as its own client module. */
const teamPageFactory: string = stripFactoryTypes(readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "team-page.ts"), "utf8")).trim()
/** The mpd web-client factory source, registered last as the bundle's own `@mpd-dsh/mpd` entry. */
const webClientFactory: string = stripFactoryTypes(readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "web-client.ts"), "utf8")).trim()
// The mpd settings card (t35) is an ADDITIVE, ISOLATED client module: removing the feature is this
// file plus the one registration line in web-client.ts, and nothing else may reference it.
/** The settings-card factory source, kept as its own module for the offline harness. */
const settingsCardFactory: string = stripFactoryTypes(readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "settings-card.ts"), "utf8")).trim()
// THE TEAM VIEW (W4) is spliced the SAME way, and for the same measured reason: only the
// `@mpd-dsh/mpd` module is APPLIED as a client plugin, so anything a sibling `load()` block defines
// is reachable only through the module loader and never through a bare reference in the applied code.
/** The team-view factory source, which becomes the `MPD_TEAM_VIEW` global inside the applied module. */
const teamViewFactory: string = stripFactoryTypes(readFileSync(join(repoRoot, "packages", "mpd-bundle-plugin", "src", "team-view.ts"), "utf8")).trim()

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
/** The team-view IIFE: one expression, evaluated in the applied module's own scope. */
// WRAPPED EXACTLY LIKE THE SETTINGS CARD, down to the shape of the IIFE, and that is deliberate:
// the card's splice is the PROVEN one in this file. Two earlier attempts to splice the team view as
// an arrow-function expression (`var X = (factory)(require)`) produced an artifact that failed to
// parse — the factory's leading line comment and the surrounding `factory:` property interact — and
// the same BODY-in-a-plain-IIFE form the card uses carries no such shape at all. The factory's own
// `return { createTeamView }` becomes the global's value, so `MPD_TEAM_VIEW.createTeamView` reads the
// same as it would have.
/** The team-view factory source split into lines, for the line-anchored boundary search. */
const teamViewLines: string[] = teamViewFactory.split("\n")
/** Index of the factory's opening `=> {` line, or -1 when the boundaries moved. */
const teamViewOpen: number = teamViewLines.findIndex((line: string): boolean => line.trimEnd().endsWith("=> {"))
if (teamViewOpen < 0 || teamViewLines[teamViewLines.length - 1].trim() !== "}") {
  console.error("[build-mpd-client] FAIL: the team-view factory boundaries moved")
  process.exit(1)
}
/** The factory body: everything between the opening `=> {` and the file's final `}`. */
const teamViewBody: string = teamViewLines.slice(teamViewOpen + 1, -1).join("\n") + "\n"
/** The body wrapped in a fresh-scope IIFE, spliced into the applied client module. */
const teamViewIife: string = "  var MPD_TEAM_VIEW = (function () {\n" + teamViewBody + "  })();\n\n"
// THE ANCHOR IS WHITESPACE-TOLERANT, and that is a FIX, not a nicety. Type stripping replaces a
// removed annotation with SPACES to keep offsets stable, so a source line written
// `function loadSettingsCard(): SettingsCardModule {` arrives here as
// `function loadSettingsCard()                     {` — 21 spaces. The previous anchor demanded
// exactly one, so it silently matched NOTHING, and the splice was dropped from every rebuild.
/** The anchor: the settings-card loader, whatever whitespace type stripping left behind. */
const SPLICE_ANCHOR: RegExp = /(\n\s*function loadSettingsCard\(\)\s*\{)/
if (!SPLICE_ANCHOR.test(webClientFactory)) {
  console.error("[build-mpd-client] FAIL: the loadSettingsCard() splice anchor is gone from src/web-client.ts")
  process.exit(1)
}
/** The web-client factory with BOTH IIFEs spliced in before `loadSettingsCard()`. */
// THE REPLACEMENT IS A FUNCTION, and that is load-bearing. A string replacement is scanned for `$`
// patterns (`$&`, `$1`, `` $` ``, `$'`), and the two spliced bodies contain `$` of their own — the
// settings card's copy plus the team view's template-free but `$`-bearing text — so a `${...}`-like
// pair spanning the two bodies was silently rewritten and the artifact stopped parsing. Measured:
// EACH splice alone produced a valid module, BOTH together produced `Unexpected token 'const'` — the
// signature of a mangled replacement, not of a broken brace. A function replacement disables every
// `$` pattern, which is why the anchor arrives as an argument rather than as `$1`.
const webClientWithCard: string = webClientFactory
  .replace(SPLICE_ANCHOR, (_match: string, anchor: string): string => "\n" + settingsCardIife + "\n" + teamViewIife + anchor)
// THE GUARDS CHECK THE DECLARATION, never a bare mention. Both markers appear in `web-client.ts`'s
// OWN text (the ambient `declare const` and the call site), so `includes("MPD_SETTINGS_CARD")` was
// true whether or not the splice happened — a guard that could not fail, which is exactly how the
// broken anchor above went unnoticed across a whole conversion.
if (!webClientWithCard.includes("var MPD_SETTINGS_CARD = ")) { console.error("[build-mpd-client] FAIL: the settings-card IIFE was not spliced"); process.exit(1) }
if (!webClientWithCard.includes("var MPD_TEAM_VIEW = (function () {")) { console.error("[build-mpd-client] FAIL: the team-view IIFE was not spliced"); process.exit(1) }

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
