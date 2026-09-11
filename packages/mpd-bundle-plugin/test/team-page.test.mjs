// Proves the AgentTeams GUI now lives in ONE DSH-better-sidebar tab: the page renders
// the floater's OWN interior (the same `aside` panel root, the same panelHead title +
// busy dot + collapse control, the same `teams` body, the same empty hint) for the
// conversation's teams (members, tasks, archived) from the host state route, the badge is
// a cached count, auto-open opens the tab ONCE per new team carrying NO content seed
// (dsh-better-sidebar >= 0.19 routes any `path`/`url` seed to DSH's native right column
// instead of this tab type, where a throwaway marker path fails `realpath` and raises
// `cannot resolve target …`), and the
// removed in-conversation card / overlay floater can never come back.
// Runs the REAL combined client.js through the offline harness — no browser, no server.
import { describe, expect, test } from "bun:test";
import { createAdoptedStub, createHarness, createSidebarStore, loadBundleClient, loadMpdClient } from "./client-harness.mjs";

const STATE_URL = "/plugins/dsh-agent-teams/state";
const SCOPE = { sessionId: "s1" };

const TEAM_ALPHA = {
  workspace: "/w",
  teamId: "alpha",
  name: "Alpha team",
  captainSessionId: "s1",
  phase: "running",
  members: [
    { id: "m1", name: "senior-eng", role: "engineer", activity: "working", status: "working" },
    { id: "m2", name: "reviewer", role: "reviewer", activity: "idle", status: "idle" },
  ],
  tasks: [
    { id: "t1", subject: "build the page", status: "in_progress", state: "running", assignee: "senior-eng", kind: "implementation" },
  ],
  messageCount: 4,
};
const TEAM_ARCHIVED = {
  workspace: "/w",
  teamId: "old",
  name: "Old team",
  captainSessionId: "s1",
  phase: "running",
  members: [],
  tasks: [],
  messageCount: 0,
};
const TEAM_OTHER_SESSION = { ...TEAM_ALPHA, teamId: "beta", name: "Beta team", captainSessionId: "s2" };

function mountClient({ teams = [TEAM_ALPHA], archivedTeams = [TEAM_ARCHIVED], ...options } = {}) {
  const client = loadMpdClient({
    responses: { [STATE_URL]: { teams, archivedTeams } },
    ...options,
  });
  client.exports.apply(client.ctx);
  // The sidebar service arrives from its own plugin fiber AFTER apply() — the harness models
  // that by default, so the tab only exists once it is published.
  client.provideSidebar();
  const tab = client.calls.registerTab.find((descriptor) => descriptor.id === "mpd-agent-teams");
  return { ...client, tab };
}

/** Wait past the page-settle window that arms the auto-open baseline. */
function waitSettle() {
  return new Promise((resolve) => setTimeout(resolve, 2700));
}

/**
 * Render the page through the descriptor: `component` is a wrapper that creates the
 * element for TeamPageView, so the harness renders the element type itself (it does not
 * recurse into function-type elements).
 */
function renderPage(client, props = {}) {
  const element = client.tab.component(props);
  return client.hooks.render(element.type, props);
}

/**
 * Render a function-type element the way React would (the harness records elements but
 * never recurses into components), so a test can read the markup a nested component
 * produces.
 */
function renderElement(element) {
  let current = element;
  for (let depth = 0; depth < 8 && typeof current.type === "function"; depth += 1) {
    current = current.type(current.props);
  }
  return current;
}

/** The floater's interior, as the page must reproduce it: aside > [head, teams body]. */
function panelParts(tree) {
  const [head, teamsBody] = tree.props.children;
  const body = Array.isArray(teamsBody.props.children) ? teamsBody.props.children : [teamsBody.props.children];
  const collapseButton = head.props.children[1].props.children;
  return {
    head,
    title: head.props.children[0],
    controls: head.props.children[1],
    dot: head.props.children[0].props.children[1],
    collapseButton,
    glyph: renderElement(collapseButton.props.children),
    teams: teamsBody,
    body,
  };
}

describe("AgentTeams sidebar tab descriptor", () => {
  test("registers one single-instance tab with the pinned id and order", () => {
    const client = mountClient();
    expect(client.tab).toBeDefined();
    expect(client.tab.single).toBe(true);
    expect(client.tab.order).toBe(85);
    expect(client.calls.registerTab.filter((descriptor) => descriptor.id === "mpd-agent-teams").length).toBe(1);
    client.restore();
  });

  test("createTab mints a clean tab so the auto-open seed never lands on it", () => {
    const client = mountClient();
    const minted = client.tab.createTab({});
    expect(minted.tab).toEqual({ id: "mpd-agent-teams", type: "mpd-agent-teams", title: "AgentTeams" });
    client.restore();
  });

  test("offers the auto-open switch as a plugin-owned setting", () => {
    const client = mountClient();
    const toggles = client.tab.settings.pluginToggles;
    expect(toggles.length).toBe(1);
    expect(toggles[0].key).toBe("autoOpenOnTeamActivity");
    expect(toggles[0].type).toBe("switch");
    expect(toggles[0].title().length).toBeGreaterThan(0);
    client.restore();
  });
});

describe("AgentTeams page rendering", () => {
  test("renders the conversation's teams, members, tasks and archived section", async () => {
    const client = mountClient();
    const tree = await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    expect(client.calls.fetched.map((entry) => entry.url)).toContain(STATE_URL);
    expect(tree.props["data-agent-teams-page"]).toBe(true);
    expect(tree.props["data-team-count"]).toBe("1");
    // The page hands the adopted section the whole team (members + tasks live inside it),
    // the translated `t`, and the composer callbacks the staged-plan editor needs.
    const [liveElement, archivedElement] = panelParts(tree).body;
    expect(liveElement.type).toBe(client.adoptedStub.TeamSection);
    expect(liveElement.props.team.name).toBe("Alpha team");
    expect(liveElement.props.team.members.map((member) => member.name)).toEqual(["senior-eng", "reviewer"]);
    expect(liveElement.props.team.tasks.map((task) => task.id)).toEqual(["t1"]);
    expect(typeof liveElement.props.onContinuePlanning).toBe("function");
    expect(typeof liveElement.props.onNavigate).toBe("function");
    expect(liveElement.props.t("archive.label")).toBe("archived");
    expect(archivedElement.props["data-team-id"]).toBe("old");
    client.restore();
  });

  test("reproduces the floater's panel interior, class for class", async () => {
    // Visual parity is the binding requirement: every adopted class name the floater's
    // own panel body uses must be on the page, and the window-manager half must not be.
    const client = mountClient();
    const tree = await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    const css = client.adoptedStub.ACTIVITY_PANEL_CSS;
    const parts = panelParts(tree);

    expect(tree.type).toBe("aside");
    expect(tree.props.className).toBe(css.panel);
    expect(tree.props["aria-label"]).toBe("AgentTeams activity panel");
    expect(parts.head.props.className).toBe(css.panelHead);
    expect(parts.title.props.className).toBe(css.panelTitle);
    expect(parts.title.props.children[0]).toBe("AgentTeams activity");
    expect(parts.dot.props.className).toBe(css.panelDot);
    expect(parts.controls.props.className).toBe(css.panelControls);
    expect(parts.collapseButton.props.className).toBe(css.iconButton);
    expect(parts.teams.props.className).toBe(css.teams);

    // The sidebar pane owns the box: no absolute positioning, no floating frame, and the
    // head must not advertise a drag handle.
    expect(tree.props.style.position).toBe("relative");
    expect(tree.props.style.border).toBe("none");
    expect(tree.props.style.background).toBe("transparent");
    expect(tree.props.style.boxShadow).toBe("none");
    expect(tree.props.style.transform).toBe("none");
    expect(tree.props["data-compact"]).toBe(true);
    client.restore();
  });

  test("the head's collapse control closes the sidebar panel through the store", async () => {
    const client = mountClient();
    const store = createSidebarStore();
    const tree = await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true, store });
    const button = panelParts(tree).collapseButton;
    expect(button.props["data-control"]).toBe("collapse");
    expect(button.props["aria-label"]).toBe("Collapse activity panel");
    expect(store.state().panelOpen).toBe(true);
    button.props.onClick();
    expect(store.state().panelOpen).toBe(false);
    expect(store.reductions.length).toBe(1);
    client.restore();
  });

  test("a missing store still renders the same markup and never throws", async () => {
    const client = mountClient();
    const tree = await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    expect(() => panelParts(tree).collapseButton.props.onClick()).not.toThrow();
    client.restore();
  });

  test("the head's busy dot follows live member activity", async () => {
    const busy = mountClient();
    const busyTree = await renderPage(busy, { ctx: busy.ctx, scope: SCOPE, tab: {}, visible: true });
    expect(panelParts(busyTree).dot.props["data-busy"]).toBe(true);
    busy.restore();

    const idleTeam = {
      ...TEAM_ALPHA,
      members: TEAM_ALPHA.members.map((member) => ({ ...member, activity: "idle" })),
    };
    const idle = mountClient({ teams: [idleTeam], archivedTeams: [] });
    const idleTree = await renderPage(idle, { ctx: idle.ctx, scope: SCOPE, tab: {}, visible: true });
    expect(panelParts(idleTree).dot.props["data-busy"]).toBe(false);
    idle.restore();
  });

  test("renders the collapse glyph with the platform's own icon component", async () => {
    const client = mountClient();
    const tree = await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    const chevron = panelParts(tree).collapseButton.props.children;
    // One wrapper (<ChevronDown14/>), then the platform component itself: the same one the
    // adopted panel renders, so the glyph is identical rather than merely similar.
    const platformElement = chevron.type(chevron.props);
    expect(platformElement.type).toBe(client.primitives.IconChevronDownOutline14);
    expect(panelParts(tree).glyph.props["data-icon"]).toBe("chevron-down-14");
    client.restore();
  });

  test("falls back to the identical inline chevron when the platform icons are absent", async () => {
    const client = mountClient({ primitives: null });
    const tree = await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    const glyph = panelParts(tree).glyph;
    expect(glyph.type).toBe("svg");
    expect(glyph.props.viewBox).toBe("0 0 14 14");
    expect(glyph.props.children.props.d.startsWith("M11.8486 5.5")).toBe(true);
    client.restore();
  });

  test("renders the archived section with the archived label", async () => {
    const client = mountClient();
    const tree = await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    const archivedElement = panelParts(tree).body[1];
    expect(archivedElement.props["data-historic"]).toBe(true);
    expect(archivedElement.props["data-team-id"]).toBe("old");
    // The page performs the SAME lookup the floater does (`css.archivedWrap`). The stub
    // carries the key while the REAL adopted map does not — upstream reads a missing key, so
    // the original wrapper is class-less too (pinned in
    // packages/mpd-agent-teams-plugin/test/export-bridge.test.mjs).
    expect(archivedElement.props.className).toBe(client.adoptedStub.ACTIVITY_PANEL_CSS.archivedWrap);
    expect(archivedElement.props.children[0].props.children).toBe("archived");
    expect(archivedElement.props.children[1].props.team.name).toBe("Old team");
    client.restore();
  });

  test("filters by the tab's own conversation scope", async () => {
    const client = mountClient({ teams: [TEAM_ALPHA, TEAM_OTHER_SESSION] });
    const tree = await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    const flat = JSON.stringify(tree);
    expect(flat).toContain("Alpha team");
    expect(flat).not.toContain("Beta team");
    client.restore();
  });

  test("shows the floater's own empty hint inside the panel body", async () => {
    const client = mountClient({ teams: [], archivedTeams: [] });
    const tree = await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    const parts = panelParts(tree);
    expect(parts.teams.props.className).toBe(client.adoptedStub.ACTIVITY_PANEL_CSS.teams);
    expect(parts.body.length).toBe(1);
    expect(parts.body[0].props.className).toBe(client.adoptedStub.ACTIVITY_PANEL_CSS.emptyHint);
    expect(parts.body[0].props["data-agent-teams-empty"]).toBe(true);
    expect(parts.body[0].props.children).toBe("No team activity");
    client.restore();
  });

  test("a hidden tab renders no live view (the sidebar CSS-hides collapsed tabs)", async () => {
    const client = mountClient();
    const tree = await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: false });
    expect(tree).toBeNull();
    client.restore();
  });

  test("a failing host route degrades to the empty state instead of throwing", async () => {
    const client = loadMpdClient({ responses: {} });
    client.exports.apply(client.ctx);
    client.provideSidebar();
    const tab = client.calls.registerTab.find((descriptor) => descriptor.id === "mpd-agent-teams");
    const tree = await client.hooks.render(tab.component({ ctx: client.ctx, scope: SCOPE, tab: {}, visible: true }).type, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    const flat = JSON.stringify(tree);
    expect(flat).toContain("data-agent-teams-empty");
    expect(flat).not.toContain("data-agent-teams-error");
    client.restore();
  });

  test("a rejecting poll shows a readable error notice, not a crash", async () => {
    // Variant adopted module whose controller rejects on the first tick.
    const variant = {
      ...createAdoptedStub({}),
      startActivityPolling: () => ({ firstTick: Promise.reject(new Error("state route down")), stop: () => {} }),
    };
    const client = loadMpdClient({ responses: {}, services: { "@nanmicoder/dsh-agent-teams": variant } });
    client.exports.apply(client.ctx);
    client.provideSidebar();
    const tab = client.calls.registerTab.find((descriptor) => descriptor.id === "mpd-agent-teams");
    const props = { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true };
    const tree = await client.hooks.render(tab.component(props).type, props);
    const notice = panelParts(tree).body[0];
    expect(JSON.stringify(tree)).toContain("data-agent-teams-error");
    expect(JSON.stringify(tree)).toContain("state route down");
    // Even the degraded notice keeps the floater's body shape and styling.
    expect(notice.props.className).toBe(variant.ACTIVITY_PANEL_CSS.emptyHint);
    client.restore();
  });
});

describe("staged plan approval", () => {
  const staged = { ...TEAM_ALPHA, teamId: "staged", name: "Staged team", phase: "staged" };

  test("passes a model directory to a staged team when the service provides one", async () => {
    const client = mountClient({
      teams: [staged],
      archivedTeams: [],
      services: { modelDirectories: { directoryFor: () => ({ id: "dir", models: [] }) } },
    });
    const tree = await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    const stagedElement = panelParts(tree).body[0];
    expect(stagedElement.props.team.phase).toBe("staged");
    expect(stagedElement.props.modelDirectory).toEqual({ id: "dir", models: [] });
    client.restore();
  });

  test("a throwing directoryFor degrades instead of crashing the page", async () => {
    const client = mountClient({
      teams: [staged],
      archivedTeams: [],
      services: {
        modelDirectories: {
          directoryFor: () => { throw new Error("unknown session"); },
        },
      },
    });
    const tree = await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    const stagedElement = panelParts(tree).body[0];
    expect(stagedElement.props.team.name).toBe("Staged team");
    expect(stagedElement.props.modelDirectory).toBeUndefined();
    client.restore();
  });
});

describe("badge and polling", () => {
  test("badge reports the cached live-team count for its session only", async () => {
    const client = mountClient({ teams: [TEAM_ALPHA, TEAM_OTHER_SESSION], archivedTeams: [] });
    await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    expect(client.tab.badge(client.ctx, SCOPE)).toBe(1);
    expect(client.tab.badge(client.ctx, { sessionId: "s2" })).toBe(1);
    expect(client.tab.badge(client.ctx, { sessionId: "s3" })).toBeUndefined();
    expect(client.calls.fetched.every((entry) => entry.url === STATE_URL)).toBe(true);
    client.restore();
  });

  test("mounting the page twice keeps a single polling controller", async () => {
    const client = mountClient();
    await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    expect(client.calls.pollStarts.length).toBe(1);
    client.restore();
  });
});

describe("auto-open policy", () => {
  test("opens the tab once, with NO content seed, for a team that appears after the baseline", async () => {
    const client = mountClient({ teams: [], archivedTeams: [] });
    await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    await waitSettle();

    // A team appears after the restore baseline: exactly one open, and it carries no
    // `path`/`url` — a seeded open is routed to DSH's native right column by
    // dsh-better-sidebar >= 0.19 and never reaches this tab type (the seed path used to
    // be a marker that failed `realpath`: `cannot resolve target …/team-activity`).
    client.adoptedStub.updateActivitySnapshots({ teams: [TEAM_ALPHA] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.calls.openTab.length).toBe(1);
    expect(client.calls.openTab[0].seed).toEqual({ type: "mpd-agent-teams" });
    expect(client.calls.openTab[0].seed.path).toBeUndefined();
    expect(client.calls.openTab[0].seed.url).toBeUndefined();
    expect(client.calls.openTab[0].scope).toBeUndefined();

    // The same team must never open the panel twice.
    client.adoptedStub.updateActivitySnapshots({ teams: [{ ...TEAM_ALPHA }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.calls.openTab.length).toBe(1);
    client.restore();
  });

  test("teams restored with the page never auto-open", async () => {
    const client = mountClient({ teams: [TEAM_ALPHA], archivedTeams: [] });
    await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    await waitSettle();
    expect(client.calls.openTab.length).toBe(0);
    client.restore();
  });

  test("the plugin switch turns auto-open off", async () => {
    const client = mountClient({
      teams: [],
      archivedTeams: [],
      pluginSettings: { "mpd-agent-teams": { autoOpenOnTeamActivity: false } },
    });
    await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    await waitSettle();
    client.adoptedStub.updateActivitySnapshots({ teams: [TEAM_ALPHA] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.calls.openTab.length).toBe(0);
    client.restore();
  });

  test("a disabled tab type is never auto-opened", async () => {
    const client = mountClient({ teams: [], archivedTeams: [], disabledTabs: ["mpd-agent-teams"] });
    await renderPage(client, { ctx: client.ctx, scope: SCOPE, tab: {}, visible: true });
    await waitSettle();
    client.adoptedStub.updateActivitySnapshots({ teams: [TEAM_ALPHA] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.calls.openTab.length).toBe(0);
    client.restore();
  });
});

describe("boot safety", () => {
  test("a missing page module degrades to one warning instead of throwing out of apply", () => {
    // The page module must be contained, like every other optional surface.
    const { factories } = loadBundleClient();
    const harness = createHarness({ factories, requireMap: { "@mpd-dsh/team-page": undefined } });
    const factory = factories.get("@mpd-dsh/mpd");
    const warnings = [];
    const original = console.warn;
    console.warn = (message) => { warnings.push(String(message)); };
    let thrown;
    try {
      const clientExports = factory(harness.require);
      clientExports.apply(harness.ctx);
      harness.provideSidebar();
    } catch (error) {
      thrown = error;
    } finally {
      console.warn = original;
    }
    expect(thrown).toBeUndefined();
    expect(warnings.filter((message) => message.includes("AgentTeams sidebar file exposes no registerTeamSidebarTab")).length).toBe(1);
    // The workmate page still registers: one broken page module must not take the other with it.
    expect(harness.calls.registerTab.map((descriptor) => descriptor.id)).toEqual(["mpd-workmate"]);
  });

  test("without better-sidebar nothing is registered and nothing is warned about", () => {
    const client = loadMpdClient({ withoutSidebar: true });
    const warnings = [];
    const original = console.warn;
    console.warn = (message) => { warnings.push(String(message)); };
    try {
      client.exports.apply(client.ctx);
      client.provideSidebar();
    } finally {
      console.warn = original;
    }
    expect(client.calls.registerTab.length).toBe(0);
    // The sidebar is OPTIONAL: its absence must be a silent no-op, not a warning storm and
    // definitely not a fatal `pending` entry.
    expect(warnings).toEqual([]);
    const definitions = client.calls.slotsRegistered ?? [];
    expect(definitions.some((definition) => definition.id === "agent-teams-activity")).toBe(false);
    expect(definitions.some((definition) => definition.name === "conversation.chat.node")).toBe(false);
    client.restore();
  });
});
