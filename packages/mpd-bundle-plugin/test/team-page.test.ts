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
import { createHarness, loadMpdClient, type HarnessOptions, type LoadedMpdClient, type TabDescriptor } from "./client-harness.ts";

/** The bundle's own watchdog state route, the only route the page polls. */
const STATE_URL = "/plugins/mpd-team-watchdog/state";
/** The bundle's own acknowledge route the page posts to. */
const ACK_URL = "/plugins/mpd-team-watchdog/ack";

/** The canned state payload: one held team, one unread escalation, one replay frame. */
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

/** The mounted client plus the tab descriptor and page seams an arm drives. */
interface MountedClient extends LoadedMpdClient {
  /** The single watchdog tab descriptor the page registered. */
  tab: TabDescriptor
  /** The team-page module's own test seams. */
  page: {
    /** Acknowledge the incidents up to one timestamp, returning whether it landed. */
    __watchdogAck: (since: number) => Promise<boolean>
  }
}

/** Load the client, mount it against the harness, and return its tab and page seams. */
function mountClient({ responses = {}, requestResponses = {}, ...options }: HarnessOptions = {}): MountedClient {
  /** The client this mount built, with its fetch stub installed. */
  const client = loadMpdClient({
    responses: { [STATE_URL]: PAYLOAD, ...responses },
    requestResponses,
    ...options,
  });
  client.exports.apply(client.ctx);
  client.provideSidebar();
  // The page registers exactly one tab with this id, which every arm below asserts.
  /** The watchdog tab descriptor the page registered. */
  const tab = client.calls.registerTab.find((descriptor) => descriptor.id === "mpd-agent-teams")!;
  // The page's own module: the combined client registers it under the same id the build script
  // composes, so the test drives the REAL page factory and its test seams.
  // The module id is resolved at runtime by the loader, so only this seam can be typed.
  /** The team-page module's own test seams. */
  const page = client.require("@mpd-dsh/team-page") as MountedClient["page"];
  return { ...client, tab, page };
}

/** Wait past the page-settle window so a poll's fetch lands. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe("the team-watchdog sidebar tab descriptor", () => {
  test("registers one single-instance tab with the pinned id and order", () => {
    /** The mounted client this arm drives. */
    const client = mountClient();
    expect(client.tab).toBeDefined();
    expect(client.tab.single).toBe(true);
    expect(client.tab.order).toBe(85);
    expect(client.calls.registerTab.filter((descriptor) => descriptor.id === "mpd-agent-teams").length).toBe(1);
    client.restore();
  });

  test("the tab has NO auto-open switch: the watchdog view never opens itself", () => {
    /** The mounted client this arm drives. */
    const client = mountClient();
    // 0.1.7: the retired page auto-opened on team activity. The official client owns that UX and
    // a watchdog notice must not steal focus, so the tab declares no plugin toggles at all.
    expect(client.tab.settings).toBeUndefined();
    expect(client.calls.openTab).toEqual([]);
    client.restore();
  });

  test("createTab mints the watchdog tab (id pinned, title is the watchdog's)", () => {
    /** The mounted client this arm drives. */
    const client = mountClient();
    /** The tab instance the descriptor's own factory minted. */
    const minted = client.tab.createTab({});
    expect(minted.tab.id).toBe("mpd-agent-teams");
    expect(minted.tab.type).toBe("mpd-agent-teams");
    expect(minted.tab.title.length).toBeGreaterThan(0);
    client.restore();
  });
});

describe("the watchdog page renders the bundle's OWN state route", () => {
  test("shows the banner, the hold and the unread incident with an acknowledge control", async () => {
    /** The mounted client this arm drives. */
    const client = mountClient();
    await settle();
    /** The element the tab's component returned. */
    const element = client.tab.component({});
    /** The rendered tree, serialized so the assertions can scan it as text. */
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
    /** The mounted client this arm drives. */
    const client = mountClient({ responses: { [STATE_URL]: { ...PAYLOAD, stuck: false, held: [], banner: null, activity: [], unread: [], replay: false } } });
    await settle();
    /** The element the tab's component returned. */
    const element = client.tab.component({});
    /** The rendered tree, serialized so the assertions can scan it as text. */
    const html = JSON.stringify(await client.hooks.render(element.type, element.props));
    expect(html).toContain("data-watchdog-banner");
    expect(html).toContain("none");
    expect(html).not.toContain("data-watchdog-activity");
    client.restore();
  });

  test("a FAILING route degrades to a readable error notice and never throws", async () => {
    /** The mounted client this arm drives. */
    const client = mountClient({ requestResponses: { [`GET ${STATE_URL}`]: { status: 404, body: {} } } });
    await settle();
    /** The element the tab's component returned. */
    const element = client.tab.component({});
    /** The rendered tree, serialized so the assertions can scan it as text. */
    const html = JSON.stringify(await client.hooks.render(element.type, element.props));
    expect(html).toContain("data-watchdog-error");
    client.restore();
  });

  test("acknowledging posts to the bundle's ack route with the stable reader key", async () => {
    /** The mounted client this arm drives. */
    const client = mountClient({ requestResponses: { [`POST ${ACK_URL}`]: { status: 200, body: { ok: true } } } });
    await settle();
    /** How many acknowledge requests the page had already sent. */
    const before = client.calls.fetched.filter((entry) => entry.url === ACK_URL).length;
    /** Whether the acknowledge call the arm made succeeded. */
    const ok = await client.page.__watchdogAck(1_700_000_000_000);
    expect(ok).toBe(true);
    /** The acknowledge requests recorded after this arm's call. */
    const acked = client.calls.fetched.filter((entry) => entry.url === ACK_URL);
    expect(acked.length).toBe(before + 1);
    expect(acked[acked.length - 1].method).toBe("POST");
    // The recorded acknowledge POST always carries its init, which is what the body assertion reads.
    expect(String(acked[acked.length - 1].options!.body)).toContain('"reader":"web-panel"');
    client.restore();
  });

  test("the badge is the last poll's UNREAD count, and never a fetch", async () => {
    /** The mounted client this arm drives. */
    const client = mountClient();
    await settle();
    expect(client.tab.badge()).toBe(1);
    /** The fetch count before the badge read, to prove it adds none. */
    const fetches = client.calls.fetched.length;
    client.tab.badge();
    expect(client.calls.fetched.length).toBe(fetches);
    client.restore();
  });

  test("mounting the tab twice keeps ONE polling controller", async () => {
    /** The mounted client this arm drives. */
    const client = mountClient();
    await settle();
    /** State fetches recorded after the first mount. */
    const first = client.calls.fetched.filter((entry) => entry.url === STATE_URL).length;
    // A second registration ON THE SAME service is a no-op (the sidebar throws on a duplicate id).
    client.provideSidebar();
    await settle();
    /** State fetches recorded after the second mount attempt. */
    const second = client.calls.fetched.filter((entry) => entry.url === STATE_URL).length;
    // At most one more poll from the mount-time read; never a second timer's worth.
    expect(second - first).toBeLessThanOrEqual(1);
    client.restore();
  });
});

describe("the removed AgentTeams surfaces can never come back", () => {
  test("no mpd client source requires the retired adopted client", () => {
    /** The reader used on the two client sources. */
    const { readFileSync } = require("node:fs");
    /** The path joiner used to resolve the sources under the package. */
    const { join } = require("node:path");
    /** The package directory the two sources live in. */
    const root = join(import.meta.dir, "..");
    for (const file of ["src/team-page.ts", "src/web-client.ts"]) {
    /** One client source's bytes, scanned for a removed-surface registration. */
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
