// Independent artifact-level pins for the AgentTeams sidebar migration (added by the
// verifier, additive only). Existing suites pin the RUNTIME behaviour through the
// harness (sidebar-tab.test.ts / team-page.test.ts) and the bridge on the adopted
// client — whose own suite (packages/mpd-agent-teams-plugin/test/export-bridge.test.ts)
// was DELETED with the body by the de-vendor wave, which makes THIS file the surviving
// pin on the bridge; it pins what actually SHIPS in packages/mpd-bundle-plugin/client.js,
// where a stale rebuild or a re-vendored adopted client would otherwise go unnoticed:
//   1) exactly the three loader modules, including the sidebar page module;
//   2) the mpd export bridge present in the shipped bytes with every pinned export;
//   3) no mpd client SOURCE registers a removed surface (registration shapes only, so
//      the explanatory comments stay legal);
//   4) the team-page module still exports the pinned tab id/order.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Repository root, three directories above this test file. */
const ROOT = join(import.meta.dirname, "..", "..", "..");
/** The shipped combined client, read as text for the byte-level pins below. */
const ARTIFACT = readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "client.js"), "utf8");
/** The two client sources the registration scan reads, keyed by repo-relative path. */
const SOURCES: Record<string, string> = {
  "src/web-client.ts": readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "src", "web-client.ts"), "utf8"),
  "src/team-page.ts": readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "src", "team-page.ts"), "utf8"),
};
/** Every export the mpd bridge must leave on the shipped artifact. */
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

/** The module ids the artifact's own loader registers, in byte order. */
function moduleIds(source: string): string[] {
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
    /** Byte offset of the bridge region's opening marker. */
    const start = ARTIFACT.indexOf("//#region mpd-export-bridge");
    /** Byte offset of the bridge region's closing marker. */
    const end = ARTIFACT.indexOf("//#endregion mpd-export-bridge");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    /** The bridge region's bytes, the only slice the export pin scans. */
    const region = ARTIFACT.slice(start, end);
    /** Pinned exports the region does not define; asserted empty. */
    const missing = BRIDGE_EXPORTS.filter((name) => !new RegExp(`exports\\.${name}\\s*=`).test(region));
    expect(missing).toEqual([]);
  });

  test("no mpd client source registers a removed surface", () => {
    /** Registration hits across the scanned sources; asserted empty. */
    const hits = [];
    for (const [name, source] of Object.entries(SOURCES)) {
      for (const pattern of LEGACY_REGISTRATIONS) {
        if (pattern.test(source)) hits.push(`${name}: ${String(pattern)}`);
      }
    }
    expect(hits).toEqual([]);
    // Sanity: the sanctioned slash-command admission surface is still registered, so the
    // scan above is provably reading real registration sites.
    expect(SOURCES["src/web-client.ts"]).toContain("conversation.chat.commandview");
  });

  test("the page module keeps the pinned tab id and order", () => {
    expect(ARTIFACT).toContain('const TEAM_TAB_ID = "mpd-agent-teams"');
    expect(ARTIFACT).toContain("const TEAM_TAB_ORDER = 85");
    expect(ARTIFACT).toContain("exports.SIDEBAR_TAB_ID = TEAM_TAB_ID");
    expect(ARTIFACT).toContain("exports.registerTeamSidebarTab = registerTeamSidebarTab");
  });
});
