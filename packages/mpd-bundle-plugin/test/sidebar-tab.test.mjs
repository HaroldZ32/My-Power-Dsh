// Proves the bundle's web client contributes a DSH-better-sidebar tab (the workmate
// library) and falls back to its own floater when that sidebar is absent. Runs the
// REAL combined client.js through a Cordis-like harness — no browser, no server.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadMpdClient } from "./client-harness.mjs";

const ROOT = join(import.meta.dirname, "..", "..", "..");
process.env.MPD_REPO_ROOT = ROOT;

const built = readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "client.js"), "utf8");
const source = readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "src", "web-client.js"), "utf8");

const LISTED = { workmates: [{ name: "gui-alice", baseId: "hephaestus", baseName: "Deep Worker", readonly: false, uses: 3, updatedAt: "2026-09-10T01:00:00.000Z", note: "Writes RTL testbenches" }] };
const ROSTER = { bases: [{ id: "hephaestus", name: "Deep Worker", description: "deep work", readonly: false }] };

describe("client seam policy", () => {
  test("declares only services this harness registers", () => {
    expect(built).toContain("const inject = REQUIRED_SERVICES.slice()");
    expect(built).toContain('const REQUIRED_SERVICES = ["slots", "locale"]');
  });
  test("awaits drift-prone seams instead of declaring them", () => {
    expect(built).toContain("ctx.inject(OPTIONAL_SERVICES");
    expect(built).toContain("serviceAvailable(ctx, name)");
  });
  test("probes betterSidebar without declaring it", () => {
    expect(source).toContain('const PROBED_SERVICES = ["betterSidebar"]');
    expect(/OPTIONAL_SERVICES = \[[^\]]*betterSidebar/.test(source)).toBe(false);
    expect(/REQUIRED_SERVICES = \[[^\]]*betterSidebar/.test(source)).toBe(false);
  });
});

describe("with DSH-better-sidebar installed", () => {
  const client = loadMpdClient();
  client.exports.apply(client.ctx);
  const tabs = client.calls.registerTab;

  test("registers exactly one sidebar tab and no legacy floater", () => {
    expect(tabs.length).toBe(1);
    expect(client.calls.slots ?? []).toEqual([]);
  });
  test("tab descriptor is a valid sidebar page", () => {
    const tab = tabs[0];
    expect(tab.id).toBe("mpd-workmate");
    expect(tab.single).toBe(true);
    expect(typeof tab.title()).toBe("string");
    expect(tab.title().length).toBeGreaterThan(0);
    expect(typeof tab.component).toBe("function");
    expect(tab.icon(16)).toBeDefined();
  });
  test("keeps the locale namespace registered", () => {
    expect(client.calls.locale).toContain("mpdWorkmate");
  });
});

describe("workmate page", () => {
  test("renders the library from the host routes", async () => {
    const client = loadMpdClient({ responses: { "/plugins/mpd-workmate/list": LISTED, "/plugins/mpd-workmate/roster": ROSTER } });
    client.exports.apply(client.ctx);
    const tabComponent = client.calls.registerTab[0].component;
    expect(tabComponent({ t: (key) => key }).type).toBe(client.exports.WorkmateLibraryView);

    const tree = await client.hooks.render(client.exports.WorkmateLibraryView, { t: (key, params) => key + (params ? JSON.stringify(params) : "") });
    const flat = JSON.stringify(tree);
    expect(client.calls.fetched.map((f) => f.url)).toContain("/plugins/mpd-workmate/list");
    expect(client.calls.fetched.map((f) => f.url)).toContain("/plugins/mpd-workmate/roster");
    expect(flat).toContain("panel.filter");
    expect(flat).toContain("panel.init");
    expect(flat).toContain("gui-alice");
    expect(flat).toContain("Deep Worker");
    client.restore();
  });
});

describe("without DSH-better-sidebar", () => {
  test("falls back to the bundle-owned floater and footer toggle", () => {
    const client = loadMpdClient();
    delete client.ctx.betterSidebar;
    client.exports.apply(client.ctx);
    expect(client.calls.registerTab.length).toBe(0);
    const slotKeys = client.calls.slots ?? [];
    expect(slotKeys).toContain("shell.overlay");
    expect(slotKeys).toContain("sidebar.footer.action");
  });
});
