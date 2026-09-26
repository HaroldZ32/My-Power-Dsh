// Independent artifact-level pins for the AgentTeams sidebar migration (added by the
// verifier, additive only). Existing suites pin the RUNTIME behaviour through the
// harness (sidebar-tab.test.mjs / team-page.test.mjs) and the bridge on the adopted
// client (packages/mpd-agent-teams-plugin/test/export-bridge.test.mjs); this file pins
// what actually SHIPS in packages/mpd-bundle-plugin/client.js, where a stale rebuild or
// a re-vendored adopted client would otherwise go unnoticed:
//   1) exactly the three loader modules, including the sidebar page module;
//   2) the mpd export bridge present in the shipped bytes with every pinned export;
//   3) no mpd client SOURCE registers a removed surface (registration shapes only, so
//      the explanatory comments stay legal);
//   4) the team-page module still exports the pinned tab id/order.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const ARTIFACT = readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "client.js"), "utf8");
const SOURCES = {
  "src/web-client.js": readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "src", "web-client.js"), "utf8"),
  "src/team-page.js": readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "src", "team-page.js"), "utf8"),
};
const BRIDGE_EXPORTS = [
  "TeamSection", "historicCardTeam", "memberArtUrl", "LEAD_ART", "AGENT_TEAMS_LOCALE_NAMESPACE",
  "zh", "en", "startActivityPolling", "subscribeActivitySnapshots", "getActivitySnapshotsSnapshot",
  "updateActivitySnapshots", "ACTIVITY_POLL_MS", "ACTIVITY_PROBE_MS", "ACTIVITY_STATE_URL",
  "ACTIVITY_HALT_URL", "teamIsActive", "ACTIVITY_PANEL_CSS",
];
// Registrations of the removed surfaces, matched as registrations — never as bare
// mentions, so src/web-client.js may keep documenting what is gone and src/team-page.js
// may keep emitting the adopted `data-agent-teams-activity` marker.
const LEGACY_REGISTRATIONS = [
  /id:\s*["'`]agent-teams-activity["'`]/,
  /inject\(\s*["'`]conversation\.chat\.node["'`]/,
  /name:\s*["'`]conversation\.chat\.node["'`]/,
  /inject\(\s*["'`]shell\.overlay["'`]/,
  /name:\s*["'`]shell\.overlay["'`]/,
  /inject\(\s*["'`]sidebar\.footer\.action["'`]/,
  /name:\s*["'`]sidebar\.footer\.action["'`]/,
];

function moduleIds(source) {
  return [...source.matchAll(/__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/g)].map((match) => match[1]);
}

describe("shipped bundle client after the AgentTeams sidebar migration", () => {
  test("registers exactly the four loader modules: the sidebar page plus the isolated settings card", () => {
    expect(moduleIds(ARTIFACT).sort()).toEqual([
      "@mpd-dsh/mpd",
      "@mpd-dsh/settings-card",
      "@mpd-dsh/team-page",
      "@nanmicoder/dsh-agent-teams",
    ]);
  });

  test("carries the mpd export bridge with every pinned export", () => {
    const start = ARTIFACT.indexOf("//#region mpd-export-bridge");
    const end = ARTIFACT.indexOf("//#endregion mpd-export-bridge");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const region = ARTIFACT.slice(start, end);
    const missing = BRIDGE_EXPORTS.filter((name) => !new RegExp(`exports\\.${name}\\s*=`).test(region));
    expect(missing).toEqual([]);
  });

  test("no mpd client source registers a removed surface", () => {
    const hits = [];
    for (const [name, source] of Object.entries(SOURCES)) {
      for (const pattern of LEGACY_REGISTRATIONS) {
        if (pattern.test(source)) hits.push(`${name}: ${String(pattern)}`);
      }
    }
    expect(hits).toEqual([]);
    // Sanity: the sanctioned slash-command admission surface is still registered, so the
    // scan above is provably reading real registration sites.
    expect(SOURCES["src/web-client.js"]).toContain("conversation.chat.commandview");
  });

  test("the page module keeps the pinned tab id and order", () => {
    expect(ARTIFACT).toContain('const TEAM_TAB_ID = "mpd-agent-teams"');
    expect(ARTIFACT).toContain("const TEAM_TAB_ORDER = 85");
    expect(ARTIFACT).toContain("exports.SIDEBAR_TAB_ID = TEAM_TAB_ID");
    expect(ARTIFACT).toContain("exports.registerTeamSidebarTab = registerTeamSidebarTab");
  });
});
