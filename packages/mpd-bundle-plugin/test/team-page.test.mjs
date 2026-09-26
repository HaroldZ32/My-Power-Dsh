// Proves the bundle's OWN team surface is the TEAM WATCHDOG view — and nothing else.
//
// 0.1.7 REBASE: this file used to pin the retired vendored client's roster/DAG/staged-plan
// markup, which the OFFICIAL `@deepseek-ai/dsh-experimental-client-ui-agent-team` client now
// owns. The bundle's sidebar tab polls this bundle's OWN watchdog routes instead, so the arms
// below drive THAT page: the tab descriptor, the banner/hold/activity rendering, the
// acknowledge POST, the degrade-on-failure paths and the single-poller rule.
//
// Runs the REAL combined client.js through the offline harness — no browser, no server.
import { describe, expect, test } from "bun:test";
import { createHarness, loadMpdClient } from "./client-harness.mjs";

const STATE_URL = "/plugins/mpd-team-watchdog/state";
const ACK_URL = "/plugins/mpd-team-watchdog/ack";

const PAYLOAD = {
  ok: true,
  reader: "web-panel",
  generatedAt: "2026-09-27T00:00:00.000Z",
  stateDir: ".mpd/team",
  workspaces: ["/w"],
  workspace: "/w",
  stuck: true,
  held: [{ id: "h1", teamId: "alpha", since: 1_700_000_000_000, cause: "silence", taskId: "t1", attemptId: "3", sceneAt: 0 }],
  banner: { kind: "held", teamId: "alpha", holdId: "h1", incidentId: null, cause: "silence", since: 1_700_000_000_000, taskId: "t1", attemptId: "3", scene: null, workspace: "/w" },
  activity: [
    { id: "alpha#esc#1", teamId: "alpha", kind: "escalate", at: 1_700_000_000_000, label: "ESCALATE", cause: "silence", ms: 900_000, taskId: "t1", attemptId: "3", scene: null, hold: "applied", acknowledgedBy: [], ackRequired: true, workspace: "/w" },
  ],
  unread: ["alpha#esc#1"],
  watermarks: {},
  replay: true,
  errors: [],
};

function mountClient({ responses = {}, requestResponses = {}, ...options } = {}) {
  const client = loadMpdClient({
    responses: { [STATE_URL]: PAYLOAD, ...responses },
    requestResponses,
    ...options,
  });
  client.exports.apply(client.ctx);
  client.provideSidebar();
  const tab = client.calls.registerTab.find((descriptor) => descriptor.id === "mpd-agent-teams");
  // The page's own module: the combined client registers it under the same id the build script
  // composes, so the test drives the REAL page factory and its test seams.
  const page = client.require("@mpd-dsh/team-page");
  return { ...client, tab, page };
}

/** Wait past the page-settle window so a poll's fetch lands. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("the team-watchdog sidebar tab descriptor", () => {
  test("registers one single-instance tab with the pinned id and order", () => {
    const client = mountClient();
    expect(client.tab).toBeDefined();
    expect(client.tab.single).toBe(true);
    expect(client.tab.order).toBe(85);
    expect(client.calls.registerTab.filter((descriptor) => descriptor.id === "mpd-agent-teams").length).toBe(1);
    client.restore();
  });

  test("the tab has NO auto-open switch: the watchdog view never opens itself", () => {
    const client = mountClient();
    // 0.1.7: the retired page auto-opened on team activity. The official client owns that UX and
    // a watchdog notice must not steal focus, so the tab declares no plugin toggles at all.
    expect(client.tab.settings).toBeUndefined();
    expect(client.calls.openTab).toEqual([]);
    client.restore();
  });

  test("createTab mints the watchdog tab (id pinned, title is the watchdog's)", () => {
    const client = mountClient();
    const minted = client.tab.createTab({});
    expect(minted.tab.id).toBe("mpd-agent-teams");
    expect(minted.tab.type).toBe("mpd-agent-teams");
    expect(minted.tab.title.length).toBeGreaterThan(0);
    client.restore();
  });
});

describe("the watchdog page renders the bundle's OWN state route", () => {
  test("shows the banner, the hold and the unread incident with an acknowledge control", async () => {
    const client = mountClient();
    await settle();
    const element = client.tab.component({});
    const html = JSON.stringify(await client.hooks.render(element.type, element.props));
    expect(html).toContain("data-mpd-team-watchdog-page");
    expect(html).toContain("data-watchdog-banner");
    expect(html).toContain("alpha");
    expect(html).toContain("data-watchdog-hold");
    expect(html).toContain("data-watchdog-activity");
    expect(html).toContain("data-watchdog-ack");
    // The page reads the WATCHDOG route — never a team record, never the retired state route.
    expect(client.calls.fetched.some((entry) => entry.url === STATE_URL)).toBe(true);
    expect(client.calls.fetched.every((entry) => !entry.url.includes("dsh-agent-teams"))).toBe(true);
    client.restore();
  });

  test("an empty store renders the honest 'no stuck team' line instead of a fake banner", async () => {
    const client = mountClient({ responses: { [STATE_URL]: { ...PAYLOAD, stuck: false, held: [], banner: null, activity: [], unread: [], replay: false } } });
    await settle();
    const element = client.tab.component({});
    const html = JSON.stringify(await client.hooks.render(element.type, element.props));
    expect(html).toContain("data-watchdog-banner");
    expect(html).toContain("none");
    expect(html).not.toContain("data-watchdog-activity");
    client.restore();
  });

  test("a FAILING route degrades to a readable error notice and never throws", async () => {
    const client = mountClient({ requestResponses: { [`GET ${STATE_URL}`]: { status: 404, body: {} } } });
    await settle();
    const element = client.tab.component({});
    const html = JSON.stringify(await client.hooks.render(element.type, element.props));
    expect(html).toContain("data-watchdog-error");
    client.restore();
  });

  test("acknowledging posts to the bundle's ack route with the stable reader key", async () => {
    const client = mountClient({ requestResponses: { [`POST ${ACK_URL}`]: { status: 200, body: { ok: true } } } });
    await settle();
    const before = client.calls.fetched.filter((entry) => entry.url === ACK_URL).length;
    const ok = await client.page.__watchdogAck(1_700_000_000_000);
    expect(ok).toBe(true);
    const acked = client.calls.fetched.filter((entry) => entry.url === ACK_URL);
    expect(acked.length).toBe(before + 1);
    expect(acked[acked.length - 1].method).toBe("POST");
    expect(String(acked[acked.length - 1].options.body)).toContain('"reader":"web-panel"');
    client.restore();
  });

  test("the badge is the last poll's UNREAD count, and never a fetch", async () => {
    const client = mountClient();
    await settle();
    expect(client.tab.badge()).toBe(1);
    const fetches = client.calls.fetched.length;
    client.tab.badge();
    expect(client.calls.fetched.length).toBe(fetches);
    client.restore();
  });

  test("mounting the tab twice keeps ONE polling controller", async () => {
    const client = mountClient();
    await settle();
    const first = client.calls.fetched.filter((entry) => entry.url === STATE_URL).length;
    // A second registration ON THE SAME service is a no-op (the sidebar throws on a duplicate id).
    client.provideSidebar();
    await settle();
    const second = client.calls.fetched.filter((entry) => entry.url === STATE_URL).length;
    // At most one more poll from the mount-time read; never a second timer's worth.
    expect(second - first).toBeLessThanOrEqual(1);
    client.restore();
  });
});

describe("the removed AgentTeams surfaces can never come back", () => {
  test("no mpd client source requires the retired adopted client", () => {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const root = join(import.meta.dir, "..");
    for (const file of ["src/team-page.js", "src/web-client.js"]) {
      const text = readFileSync(join(root, file), "utf8");
      // A real REQUIRE, not the comment that documents what was removed.
      expect(text).not.toContain('= require("@nanmicoder/dsh-agent-teams")');
      // The removed surfaces stay removed: sidebar-only, no overlay/chat node/footer toggle.
      expect(text).not.toContain('inject("conversation.chat.node"');
      expect(text).not.toContain('inject("shell.overlay"');
      expect(text).not.toContain('inject("sidebar.footer.action"');
      expect(text).not.toContain('id: "agent-teams-activity"');
    }
  });
});
