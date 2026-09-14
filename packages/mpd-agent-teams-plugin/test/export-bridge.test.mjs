// Proves the mpd export bridge on the REAL adopted client bundle: the bridge is
// additive (it changes no adopted statement and no registration), every pinned symbol
// resolves at module-load time, and the patch is idempotent. It also pins that a
// re-vendor re-applies the bridge, so a refresh cannot silently ship an unbridged
// client — the failure mode that would break the sidebar team page at runtime.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRIDGE_EXPORTS, CLIENT_FILE, applyExportBridge, isDeclared } from "../../../scripts/patch-agent-teams-client.mjs";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const VENDOR_SCRIPT = join(ROOT, "scripts", "vendor-agent-teams.mjs");

/** Load the browser bundle in a minimal loader sandbox and run its factory. */
function loadAdoptedClient() {
  const source = readFileSync(CLIENT_FILE, "utf8");
  let registration;
  const window = { __ModuleLoader__: { load: (entry) => { registration = entry; } } };
  // eslint-disable-next-line no-new-func
  new Function("window", source)(window);
  if (registration === undefined) throw new Error("adopted client did not register a module");

  const cache = new Map();
  const stubFor = (name) => {
    const target = function () {};
    return new Proxy(target, {
      get: (_target, property) => {
        if (typeof property === "symbol") return undefined;
        if (property === "then") return undefined;
        const key = `${name}.${String(property)}`;
        if (!cache.has(key)) cache.set(key, stubFor(key));
        return cache.get(key);
      },
      apply: () => stubFor(`${name}()`),
      construct: () => stubFor(`new ${name}()`),
    });
  };
  const requireStub = (id) => {
    if (!cache.has(id)) cache.set(id, stubFor(id));
    return cache.get(id);
  };
  return { id: registration.id, exports: registration.factory(requireStub), source };
}

describe("adopted client export bridge", () => {
  const loaded = loadAdoptedClient();
  const source = readFileSync(CLIENT_FILE, "utf8");

  test("registers under the adopted module id and keeps apply/inject", () => {
    expect(loaded.id).toBe("@nanmicoder/dsh-agent-teams");
    expect(typeof loaded.exports.apply).toBe("function");
    expect(Array.isArray(loaded.exports.inject)).toBe(true);
    expect(loaded.exports.inject).toContain("slots");
  });

  test("exposes every bridged symbol at load time", () => {
    const missing = BRIDGE_EXPORTS
      .map(([exported, symbol]) => [exported, symbol, loaded.exports[exported]])
      .filter(([, , value]) => value === undefined)
      .map(([exported, symbol]) => `${exported} (${symbol})`);
    expect(missing).toEqual([]);
  });

  test("exports the panel CSS-module class map, not a renamed copy", () => {
    const css = loaded.exports.ACTIVITY_PANEL_CSS;
    expect(typeof css).toBe("object");
    expect(Object.keys(css).length).toBeGreaterThan(10);
    expect(Object.keys(css)).toContain("teams");
  });

  test("carries every class the sidebar page renders, and the adopted archivedWrap quirk", () => {
    // The sidebar page reproduces the floater's interior class for class, so each key it
    // reads must exist here. `archivedWrap` is the deliberate exception: the adopted map
    // has no such key while the adopted panel still reads it (client.js
    // `ActivityPanel_module_css_default.archivedWrap`), so the floater renders a CLASS-LESS
    // wrapper div — the page must do the same to stay identical. If upstream ever adds the
    // key, this test fails and the page picks the class up automatically.
    const css = loaded.exports.ACTIVITY_PANEL_CSS;
    const pageClasses = ["panel", "panelHead", "panelTitle", "panelDot", "panelControls", "iconButton", "teams", "emptyHint", "archiveLabel"];
    expect(pageClasses.filter((key) => typeof css[key] !== "string")).toEqual([]);
    expect("archivedWrap" in css).toBe(false);
    expect(source).toContain("ActivityPanel_module_css_default.archivedWrap");
  });

  test("locale dictionaries and monitor store survive the bridge", () => {
    expect(typeof loaded.exports.AGENT_TEAMS_LOCALE_NAMESPACE).toBe("string");
    expect(Object.keys(loaded.exports.zh).length).toBeGreaterThan(20);
    expect(Object.keys(loaded.exports.en).length).toBeGreaterThan(20);
    expect(typeof loaded.exports.subscribeActivitySnapshots).toBe("function");
    expect(typeof loaded.exports.startActivityPolling).toBe("function");
    expect(typeof loaded.exports.TeamSection).toBe("function");
    expect(typeof loaded.exports.historicCardTeam).toBe("function");
  });

  test("the bridge is purely additive: exports grow by exactly the pinned list", () => {
    const assignments = source.split("\n").filter((line) => /^\s*exports\.[A-Za-z_$][\w$]* = /.test(line));
    // apply + inject (adopted) + one per bridged symbol
    expect(assignments.length).toBe(BRIDGE_EXPORTS.length + 2);
    expect(source).toContain("exports.apply = apply;");
    expect(source).toContain("exports.inject = inject;");
    expect(source).toContain("exports.TeamSection = TeamSection;");
  });

  test("re-running the bridge is a no-op that leaves the file byte-identical", () => {
    const before = readFileSync(CLIENT_FILE, "utf8");
    const result = applyExportBridge({ write: true });
    expect(result.status).toBe("already-applied");
    expect(readFileSync(CLIENT_FILE, "utf8")).toBe(before);
  });

  test("drift guard: an unknown symbol is reported as undeclared", () => {
    expect(isDeclared(source, "TeamSection")).toBe(true);
    expect(isDeclared(source, "NoSuchAdoptedSymbol")).toBe(false);
  });

  test("a re-vendor re-applies the bridge", () => {
    const vendor = readFileSync(VENDOR_SCRIPT, "utf8");
    expect(vendor).toContain("applyExportBridge");
  });
});
