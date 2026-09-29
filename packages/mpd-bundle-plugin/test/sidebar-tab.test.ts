// Proves the bundle's web client contributes its DSH-better-sidebar tabs (the workmate
// library and the AgentTeams page) and NOTHING else: the bundle's own overlay floater and
// footer toggle are gone, so a profile without that sidebar simply has no workmate GUI.
//
// The sidebar service is provided AFTER apply() — that is what the real plugin does, and
// getting it wrong left the live sidebar with no mpd tab at all — so every case here drives
// the injection instead of assuming a synchronous probe could see it.
// Runs the REAL combined client.js through a Cordis-like harness — no browser, no server.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript5";
import { join } from "node:path";
import { loadMpdClient, createHarness, type ElementNode, type ElementProps, type HarnessOptions, type LoadedMpdClient, type TabDescriptor, type TreeChild, type TreeNode } from "./client-harness.ts";

/** Repository root, three directories above this test file. */
const ROOT = join(import.meta.dirname, "..", "..", "..");
process.env.MPD_REPO_ROOT = ROOT;

/** The shipped combined client, read as text for its structural pins. */
const built = readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "client.js"), "utf8");
/** The authoritative web-client source, driven directly by the source arms. */
const source = readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "src", "web-client.ts"), "utf8");

// The workmate wire payloads carry the functional NAME only (C3): the roster's internal id is
// never sent, so no fixture here may carry `id`/`baseId` — a client that read one would render
// `undefined`.
const LISTED = { workmates: [{ name: "gui-alice", baseName: "Deep Worker", readonly: false, uses: 3, updatedAt: "2026-09-10T01:00:00.000Z", note: "Writes RTL testbenches" }] };
/** The roster route's canned answer: one functional base name. */
const ROSTER = { bases: [{ name: "Deep Worker", description: "deep work", readonly: false }] };
/** A readonly workmate record, the fixture for the in-use refusal arm. */
const READ_ONLY = { name: "gui-alice", baseName: "Deep Worker", readonly: true, uses: 3 };
/** Only the list route answers — used when a case must prove NO mutation was sent. */
const LIST_ONLY = { "/plugins/mpd-workmate/list": LISTED, "/plugins/mpd-workmate/roster": ROSTER };

/**
 * Hand the process-global fetch stub back to the runtime. Always call this before a test
 * ends: `loadMpdClient` installs its own stub globally, and a test that leaves it installed
 * makes every LATER case run against the wrong canned responses.
 */
function restore(client: LoadedMpdClient): void {
  try {
    client.restore();
  } catch {
    // already restored
  }
}

/** Flatten an element tree (or any nested value) into its text, the way JSON.stringify(flat) reads. */
function flatText(value: TreeNode): string {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(flatText).join(" ");
  if (typeof value === "object" && "props" in value) return flatText(value.props?.children);
  return "";
}

/** First element in the tree matching `predicate`, depth first. */
function findFirst(node: TreeChild, predicate: (candidate: ElementNode) => boolean): ElementNode | null {
  if (node === null || typeof node !== "object") return null;
  if (predicate(node)) return node;
  /** The node's children, one node or a list of them. */
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    // The recursive children type cannot be narrowed to a single entry without changing the
    // loop, and React flattens nested lists at runtime, so the recursion takes that type.
    const found = findFirst(child as TreeChild, predicate);
    /** The first matching descendant under this child, when it holds one. */
    if (found !== null) return found;
  }
  return null;
}

/** First clickable element whose own text is exactly `needle` (a button by its label). */
function findClickable(node: TreeChild, needle: string): ElementNode | null {
  return findFirst(node, (candidate) => typeof candidate.props?.onClick === "function"
    && flatText(candidate.props?.children).trim() === needle);
}

/** The list row of `name` — a clickable element keyed by the workmate name. */
function findRow(node: TreeChild, name: string): ElementNode | null {
  return findFirst(node, (candidate) => candidate.key === name && typeof candidate.props?.onClick === "function");
}

/** The first controlled text field in a form (the rename input of the detail pane). */
function findInput(node: TreeChild): ElementNode | null {
  return findFirst(node, (candidate) => typeof candidate.props?.onChange === "function"
    && typeof candidate.props?.value === "string");
}

/** Every form in the tree, in render order: the rename form is the detail pane's first. */
function findForms(node: TreeChild, found: ElementNode[] = []): ElementNode[] {
  if (node === null || typeof node !== "object") return found;
  if (node.type === "form" && typeof node.props?.onSubmit === "function") found.push(node);
  /** The node's children, one node or a list of them. */
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) findForms(child as TreeChild, found);
  return found;
}

/** The rename form: the detail pane's FIRST form (the delete section is not a form). */
function findForm(node: TreeChild): ElementNode | null {
  return findForms(node)[0] ?? null;
}

describe("client seam policy", () => {
  test("declares only services this profile is guaranteed to mount", () => {
    expect(built).toContain("const inject = REQUIRED_SERVICES.slice()");
    expect(built).toContain('const REQUIRED_SERVICES = ["slots", "locale"]');
  });
  test("never declares the sidebar statically (that would park the whole entry)", () => {
    // A declared-but-unregistered service becomes a fatal `pending` entry, taking the whole
    // GUI down — so `betterSidebar` must NOT ride the static inject list.
    expect(/REQUIRED_SERVICES = \[[^\]]*betterSidebar/.test(source)).toBe(false);
    expect(source).not.toContain("OPTIONAL_SERVICES");
    expect(source).not.toContain("serviceAvailable(");
  });
  test("waits for the sidebar through ctx.inject instead of a one-shot probe", () => {
    // The regression pin: the service is provided by another plugin's fiber, so a probe at
    // apply() time answers undefined and cordis never wakes a fiber that did not declare it.
    expect(source).toContain('ctx.inject(["betterSidebar"]');
    // Pin the CLAIM (the sidebar pages are wired through mountSidebarPages), not one spelling of
    // its argument: the second argument is the page module the loader hands back, and pinning the
    // identifier `teamPage` broke the moment the call became lazy (`loadTeamPage()`).
    expect(source).toContain("mountSidebarPages(ctx,");
  });
});

describe("with DSH-better-sidebar installed", () => {
  /** The client this describe block mounts once. */
  const client = loadMpdClient();
  client.exports.apply(client.ctx);
  /** Whether the sidebar service was actually bound. */
  const provided = client.provideSidebar();
  /** Every tab descriptor the page registered. */
  const tabs = client.calls.registerTab;
  /** The tab descriptor registered under one id, if any. */
  const tabById = (id: string): TabDescriptor | undefined => tabs.find((tab) => tab.id === id);

  test("registers the mpd TEAM view, the AgentTeams page and the workmate library, and no legacy floater", () => {
    expect(provided).toBe(true);
    // THREE tabs since W4: the mpd-owned TEAM view (`mpd-team`, which reads this bundle's own
    // /plugins/mpd-team/state route) beside the adopted AgentTeams page and the workmate library.
    expect(tabs.map((tab) => tab.id).sort()).toEqual(["mpd-agent-teams", "mpd-team", "mpd-workmate"]);
  /** Every keyed slot registration the host recorded. */
    const definitions = client.calls.slotsRegistered ?? [];
    expect(definitions.some((definition) => definition.id === "agent-teams-activity")).toBe(false);
    expect(definitions.some((definition) => definition.name === "conversation.chat.node")).toBe(false);
    // Non-sidebar surfaces: the slash-command admission row (never a GUI panel) and the t35
    // settings UI, which since w14 targets its OWN top-level settings section instead of the
    // Plugins tab's keyed item slot.
    expect(client.calls.slots ?? []).toEqual(["conversation.chat.commandview", "settings.section"]);
  });
  test("the adopted client half is never applied (it would re-register the removed surfaces)", () => {
    expect(client.calls.agentTeamsApplied).toBeUndefined();
  });
  test("both tab descriptors are valid sidebar pages", () => {
    for (const tab of tabs) {
      expect(tab.single).toBe(true);
  /** The title the strip would show, resolved when it is a thunk. */
      const title = typeof tab.title === "function" ? tab.title() : tab.title;
      expect(typeof title).toBe("string");
      expect(title.length).toBeGreaterThan(0);
      expect(typeof tab.component).toBe("function");
      expect(tab.icon(16)).toBeDefined();
    }
    expect(tabById("mpd-workmate")).toBeDefined();
    expect(tabById("mpd-agent-teams")!.order).toBe(85);
  });
  test("keeps the locale namespaces registered", () => {
    expect(client.calls.locale).toContain("mpdWorkmate");
    expect(client.calls.locale).toContain("mpdAgentTeams");
  });
});

describe("a sidebar provider REMOUNT keeps both tabs", () => {
  // The user-visible intermittency: the right sidebar itself disappears and comes back, and the
  // "+" menu's AgentTeams/Workmates rows go with it. `ctx.inject` re-fires the pages' callback
  // when the provider rebinds, so the registration must be IDEMPOTENT for the same service (the
  // real `registerTab` THROWS on a duplicate id) and COMPLETE for a fresh one (an EMPTY registry
  // must get both tabs back) — otherwise a remount permanently loses the pages until a reload.
  test("a re-fire against the SAME service never double-registers", () => {
  /** The client this arm mounts for the same-service re-fire. */
    const client = loadMpdClient({ sidebarAtApply: true });
    client.exports.apply(client.ctx);
    // EVERY tab this client registers, so a fourth one is caught by this list rather than by nothing:
    // the mpd team view (`mpd-team`, W4), the adopted AgentTeams page and the workmate library.
    expect(client.calls.registerTab.map((tab) => tab.id).sort()).toEqual(["mpd-agent-teams", "mpd-team", "mpd-workmate"]);
    client.refireInjections();
    // The RE-FIRE is the point: `ctx.inject` re-runs on a provider remount, and the host's own
    // `registerTab` THROWS on a duplicate id — so a missing idempotence guard reddens right here.
    expect(client.calls.registerTab.map((tab) => tab.id).sort()).toEqual(["mpd-agent-teams", "mpd-team", "mpd-workmate"]);
    expect(client.sidebarService.getTab("mpd-agent-teams")).toBeDefined();
    expect(client.sidebarService.getTab("mpd-team")).toBeDefined();
    expect(client.sidebarService.getTab("mpd-workmate")).toBeDefined();
    restore(client);
  });
  test("a FRESH service (the remount) receives both tabs again", () => {
  /** The client this arm mounts before handing it a fresh service. */
    const client = loadMpdClient({ sidebarAtApply: true });
    client.exports.apply(client.ctx);
  /** A second sidebar service, the shape a remount hands out. */
    const fresh = client.createSidebarService();
    client.provideService("betterSidebar", fresh);
    expect(fresh.getTab("mpd-agent-teams")).toBeDefined();
    expect(fresh.getTab("mpd-workmate")).toBeDefined();
    restore(client);
  });
});

describe("workmate page", () => {
  test("renders the library from the host routes", async () => {
  /** The client this arm mounts with the two route answers. */
    const client = loadMpdClient({ responses: { "/plugins/mpd-workmate/list": LISTED, "/plugins/mpd-workmate/roster": ROSTER } });
    client.exports.apply(client.ctx);
    client.provideSidebar();
  /** The workmate tab's own component, which the arm renders directly. */
    const tabComponent = client.calls.registerTab.find((tab) => tab.id === "mpd-workmate")!.component;
    expect(tabComponent({ t: (key: string) => key }).type).toBe(client.exports.WorkmateLibraryView);

  /** The rendered library tree. */
    const tree = await client.hooks.render(client.exports.WorkmateLibraryView, { t: (key: string, params?: Record<string, string>) => key + (params ? JSON.stringify(params) : "") });
  /** The tree serialized, so the assertions can scan it as text. */
    const flat = JSON.stringify(tree);
    expect(client.calls.fetched.map((f) => f.url)).toContain("/plugins/mpd-workmate/list");
    expect(client.calls.fetched.map((f) => f.url)).toContain("/plugins/mpd-workmate/roster");
    expect(flat).toContain("panel.filter");
    expect(flat).toContain("panel.init");
    expect(flat).toContain("gui-alice");
    expect(flat).toContain("Deep Worker");
    restore(client);
  });
});

describe("workmate page base picker (C3: the functional NAME is the only base key)", () => {
  /**
   * Drive the AUTHORITATIVE source (src/web-client.ts) instead of the derived
   * packages/mpd-bundle-plugin/client.js. client.js is a build artifact rebuilt by the
   * settings-card lane and by integration, so the lane that changes the source must be able
   * to prove the new option value/label before the artifact is regenerated — reading the
   * built file here would only ever assert the PREVIOUS build.
   */
  function loadFromSource(options: HarnessOptions = {}): LoadedMpdClient {
    /** The harness this source-driven client runs in. */
    const harness = createHarness(options);
    /** The source's own factory, evaluated from its text. */
    // The authoritative source is TypeScript now, and `new Function` parses JavaScript: erase the
    // types with the repo's pinned transpiler (`typescript5`, the aliased typescript@5.9.3) so this
    // arm keeps driving the SOURCE text rather than the built artifact. Ambient declarations are
    // erased with the types, which is exactly what the surrounding harness supplies at runtime.
    /** The factory source with its type annotations erased. */
    const javascript = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    }).outputText
    // The transpiler terminates the factory's expression STATEMENT with a `;`, which cannot sit
    // inside the `return ( … )` wrapper below; the wrapper is the only consumer here.
    /** The factory expression alone, with its statement terminator removed. */
    const expression = javascript.trim().replace(/;\s*$/, "")
    /** The loaded factory itself, before the harness's require map is handed to it. */
    const factory = new Function("return (" + expression + ")")();
    /** The factory's exports, the surface the artifact exposes. */
    const exports = factory(harness.require);
    /** The process-global fetch to restore when the arm ends. */
    const saved = globalThis.fetch;
    // The double answers a partial Response shape, which is all the page reads; the global's own
    // type demands a whole one, and only the runtime contract makes the difference safe.
    globalThis.fetch = harness.fetchImpl as typeof fetch;
    harness.restore = () => { globalThis.fetch = saved; };
    // The restore hook is installed above, so the caller always gets one; the spread's optional
    // field cannot carry that fact, and no narrowing reaches it.
    return { exports, ...harness } as LoadedMpdClient;
  }

  test("the base <option> value and label are the functional NAME, with no id suffix", async () => {
    /** The source-driven client this arm mounts. */
    const client = loadFromSource({ responses: { "/plugins/mpd-workmate/list": LISTED, "/plugins/mpd-workmate/roster": ROSTER } });
    try {
      client.exports.apply(client.ctx);
    /** The rendered library tree. */
      const tree = await client.hooks.render(client.exports.WorkmateLibraryView, { t: (key: string) => key });
    /** The first base option the page rendered. */
      const option = findFirst(tree, (candidate) => candidate.type === "option");
      expect(option).not.toBeNull();
      expect(option!.props.value).toBe("Deep Worker");
      expect(flatText(option!.props.children)).toBe("Deep Worker");
      // no surface of the page can render an id: the payloads never carry one, and neither does
      // the detail panel (baseName only) or the fallback copy.
      expect(JSON.stringify(tree)).not.toContain("hephaestus");
      expect(source).not.toContain("d.baseId");
      expect(source).not.toContain('b.name + " (" + b.id + ")"');
    } finally { restore(client); }
  });

  test('the "type the base id" fallback copy is gone from BOTH dictionaries', () => {
    /** The source-driven client this arm mounts. */
    const client = loadFromSource();
    try {
    /** The two dictionaries the page registered. */
      const { zh, en } = client.exports.dictionaries;
      expect(en["panel.rosterUnavailable"]).toBe("roster unavailable — type the base name");
      expect(zh["panel.rosterUnavailable"]).toBe("roster 不可用，请手填 base 名称");
      for (const dict of [zh, en]) for (const value of Object.values(dict)) expect(String(value)).not.toContain("base id");
      // ...and the placeholder teaches a functional name, never an id
      expect(en["panel.basePlaceholder"]).not.toMatch(/hephaestus/);
      expect(zh["panel.basePlaceholder"]).not.toMatch(/hephaestus/);
    } finally { restore(client); }
  });
});

describe("workmate page dictionaries", () => {
  /** A fresh client per case: the dictionaries are captured at apply() time. */
  function withDictionaries(run: (client: LoadedMpdClient, registered: { namespace: string; dictionaries: Record<string, Record<string, string>> }) => unknown): unknown {
    /** A fresh client per case: the dictionaries are captured at apply() time. */
    const client = loadMpdClient();
    try {
      client.exports.apply(client.ctx);
      // The page registers exactly this namespace, which every arm below relies on.
      const registered = (client.calls.localeDictionaries ?? []).find((entry) => entry.namespace === "mpdWorkmate")!;
      return run(client, registered);
    } finally {
      restore(client);
    }
  }

  test("registers the workmate namespace with both dictionaries", () => {
    withDictionaries((client, registered) => {
      expect(client.calls.locale).toContain("mpdWorkmate");
      expect(registered).toBeDefined();
      expect(Object.keys(registered.dictionaries ?? {}).sort()).toEqual(["en", "zh"]);
    });
  });
  test("zh is the key-set source of truth and en matches it key for key (§L A7)", () => {
    withDictionaries((client, registered) => {
      /** The two dictionaries the namespace registered. */
    const { zh, en } = registered.dictionaries;
    expect(Object.keys(zh).sort()).toEqual(client.exports.dictionaries.zh !== undefined
      ? Object.keys(client.exports.dictionaries.zh).sort()
      : Object.keys(zh).sort());
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    // Every value is a real string in both languages — a key present but untranslated would
    // render as an empty row.
    for (const key of Object.keys(zh)) {
      expect(typeof zh[key]).toBe("string");
      expect(typeof en[key]).toBe("string");
      expect(zh[key].length).toBeGreaterThan(0);
      expect(en[key].length).toBeGreaterThan(0);
    }
    });
  });
  test("the mutation surface is localized in BOTH languages, not hardcoded English", () => {
    withDictionaries((client, registered) => {
      /** The two dictionaries the namespace registered. */
      const { zh, en } = registered.dictionaries;
      for (const key of ["mutate.rename", "mutate.archive", "mutate.purge", "mutate.cancel", "mutate.delete"]) {
        expect(Object.hasOwn(zh, key)).toBe(true);
        expect(Object.hasOwn(en, key)).toBe(true);
        expect(zh[key]).not.toBe(en[key]);
      }
    });
  });
  test("the tab-strip label stays hardcoded English (contract §K, deliberate deferral)", () => {
    expect(source).toContain('const SIDEBAR_TAB_TITLE = "Workmates"');
    // The descriptor really carries it: the page BODY is localized, the strip label is not.
    withDictionaries((client) => {
      client.provideSidebar();
      // The page registers exactly one workmate tab, which this arm inspects.
      const tab = client.calls.registerTab.find((descriptor) => descriptor.id === "mpd-workmate")!;
      expect(tab).toBeDefined();
      expect(typeof tab.title === "function" ? tab.title() : tab.title).toBe("Workmates");
    });
  });
});

describe("workmate failure reasons (§D) reach the page as readable messages", () => {
  // The wire table, exactly as the routes answer it. `request()` used to collapse every
  // failure into `new Error(body.error)`, so the page could neither branch on `reason` nor
  // name the blocking team of an in-use refusal.
  const client = loadMpdClient();
  /** The live client's dictionaries. */
  const dict = client.exports.dictionaries;
  /** The page's translator, reading the zh dictionary. */
  const t = (key: string, params?: Record<string, string>): string => {
    /** The zh template for the key, or the key itself. */
    const template = dict.zh[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
  };
  /** The wire failure table: reason codes and the text each carries. */
  const cases = [
    ["invalid-name", 400, { error: "name must match [a-z0-9_-]", reason: "invalid-name" }, "name must match"],
    // §M2: a same-key rename answers 400 invalid-name and its text says exactly why.
    ["same-key rename", 400, { error: "the new name equals the current name", reason: "invalid-name" }, "equals the current name"],
    ["confirm-required", 400, { error: "purge requires confirm === name", reason: "confirm-required" }, "confirm ==="],
    ["unknown", 404, { error: "no workmate named x", reason: "unknown" }, "no workmate named"],
    ["collision", 409, { error: "target exists", reason: "collision" }, "target exists"],
  ];

  /** The page dictionary of the LIVE client, with the key recorded for each lookup. */
  function liveTranslator(client: LoadedMpdClient): { t: (key: string, params?: Record<string, string>) => string; requested: Array<{ key: string; params: Record<string, string> | undefined }> } {
    /** Every lookup the translator performed, in order. */
    const requested: Array<{ key: string; params: Record<string, string> | undefined }> = [];
    /** The zh dictionary behind the translator. */
    const dict = client.exports.dictionaries.zh;
    /** A translator that records each lookup before resolving it. */
    const t = (key: string, params?: Record<string, string>): string => {
      requested.push({ key, params });
      /** The zh template for the key, or the key itself. */
      const template = dict[key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
    };
    return { t, requested };
  }

  test("every reason code maps to a distinct, readable message", () => {
    /** One case per distinct failure condition, with its expected message source. */
    const cases: Array<[string, { error: string; reason: string }, string | null, string | null]> = [
      ["invalid-name", { error: "name must match [a-z0-9_-]", reason: "invalid-name" }, "name must match [a-z0-9_-]", null],
      // §M2: a same-key rename answers 400 invalid-name and its text says exactly why.
      ["same-key rename", { error: "the new name equals the current name", reason: "invalid-name" }, "the new name equals the current name", null],
      ["confirm-required", { error: "purge requires confirm === name", reason: "confirm-required" }, null, "mutate.reason.confirmRequired"],
      ["unknown", { error: "", reason: "unknown" }, null, "mutate.reason.unknown"],
      ["collision", { error: "target exists", reason: "collision" }, null, "mutate.reason.collision"],
      // The same reason with NO server text must still be explained, in the user's language.
      ["invalid-name without server text", { error: "", reason: "invalid-name" }, null, "mutate.reason.invalidName"],
    ];
    /** Every distinct message the cases produced. */
    const messages = new Set<string>();
    for (const [label, body, serverText, dictionaryKey] of cases) {
      /** This case's translator, with the lookups it made. */
      const { t, requested } = liveTranslator(client);
      /** The failure the route would have thrown, in the client's own shape. */
      const error = Object.assign(new Error(body.error), { status: 400, body, reason: body.reason });
      /** The readable message the page would show. */
      const message = client.exports.describeFailure(error, t);
      expect({ label, message }).toEqual({ label, message: serverText ?? (client.exports.dictionaries.zh[dictionaryKey as string] ?? dictionaryKey) });
      expect({ label, notStatusOnly: /^HTTP \d+$/.test(message) }).toEqual({ label, notStatusOnly: false });
      if (serverText === null) {
        // The dictionary is consulted whenever the server did not say anything useful; the case's
        // key is null exactly when the server text explains itself, which this branch excludes.
        expect({ label, keys: requested.map((entry) => entry.key) }).toEqual({ label, keys: [dictionaryKey as string] });
      }
      messages.add(message);
    }
    // The five distinct conditions must not collapse into one message, and the translated
    // ones must be real sentences rather than leaked dictionary keys.
    expect(messages.size).toBeGreaterThanOrEqual(5);
    for (const message of messages) expect(message).not.toContain("mutate.reason.");
  });

  test("an in-use refusal names the blocking team and member (§E, user decision D2)", () => {
    /** The team and member that hold the workmate, as the route reports them. */
    const blocking = [{ teamId: "workmate-rename-delete", member: "architect" }];
    /** The in-use refusal, carrying its blocking list. */
    const error = Object.assign(new Error("refused: workmate is in use"), {
      status: 409, reason: "in-use", blocking, body: { error: "refused: workmate is in use", reason: "in-use", blocking },
    });
    /** The readable message the page would show. */
    const message = client.exports.describeFailure(error, t);
    expect(message).toContain("workmate-rename-delete");
    expect(message).toContain("architect");
    expect(message).not.toContain("mutate.reason.");
  });
  test("an unknown failure falls back to the server text, never to a raw reason key", () => {
    /** A failure with no reason code and no dictionary entry. */
    const plain = Object.assign(new Error("boom"), { status: 500, body: { error: "boom" } });
    expect(client.exports.describeFailure(plain, t)).toBe("boom");
    expect(client.exports.failureReason(plain)).toBeUndefined();
    expect(client.exports.failureReason(Object.assign(new Error("x"), { reason: "collision" }))).toBe("collision");
  });
  // Hand the process-global fetch stub back: a later case installs its own.
});

describe("workmate page mutation controls", () => {
  // The canned wire answers: a rename that lands on a new key, an archive delete, and the
  // 409 in-use refusal §E requires the page to name. `requestResponses` keys a response by
  // METHOD + path, which is the only way a POST body can be told apart from the GETs.
  const MUTATION_RESPONSES = {
    "POST /plugins/mpd-workmate/rename": { ok: true, name: "gui-alice-2", from: "gui-alice" },
    "POST /plugins/mpd-workmate/delete": { ok: true, name: "gui-alice", archived: "/home/x/.mpd/workmate/.archive/gui-alice-20260910T000000Z", purged: false },
  };
  /** Open the detail pane of a rendered list row. */
  const OPEN_DETAIL = (inner: ElementNode): unknown => inner.props.onClick!();

  /** Mount the library page, open one workmate's detail pane, and return both. */
  async function openLibraryPage(options: HarnessOptions = {}): Promise<{ client: LoadedMpdClient; props: ElementProps; detail: ElementNode }> {
    /** The client this page runs in. */
    const client = loadMpdClient({ responses: { ...LIST_ONLY, ...(options.responses ?? {}) }, requestResponses: options.requestResponses ?? MUTATION_RESPONSES });
    client.exports.apply(client.ctx);
    client.provideSidebar();
    /** The props every render of the library page receives. */
    const props: ElementProps = { t: (key: string, params?: Record<string, string>): string => key + (params ? JSON.stringify(params) : "") };
    /** The mounted library tree. */
    const tree = await client.hooks.render(client.exports.WorkmateLibraryView, props);
    /** The list row of the workmate under test. */
    const row = findRow(tree, "gui-alice");
    expect(row).not.toBeNull();
    // The row is asserted above, and the arm would throw on a miss either way.
    OPEN_DETAIL(row!);
    /** The detail pane's tree, after the row click settled. */
    const detail = await client.hooks.act(client.exports.WorkmateLibraryView, props);
    return { client, props, detail };
  }

  test("delete is an explicit two-step confirmation, never one destructive click (D1)", async () => {
    /** This arm's client, props and open detail pane. */
    const { client, props, detail } = await openLibraryPage();
    expect(flatText(detail)).toContain("mutate.deleteTitle");

    /** The two-step delete control in the detail pane. */
    const deleteButton = findClickable(detail, "mutate.delete");
    expect(deleteButton).not.toBeNull();
    deleteButton!.props.onClick!();
    // One `act` pass renders the new state; the second lets any effect settle.
    await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The tree after the first delete step landed. */
    const confirming = await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The confirming step's text, scanned for the archive and purge wording. */
    const text = flatText(confirming);

    // Step 1 of 2: the ARCHIVE outcome is explained and confirmed explicitly, with a cancel.
    expect(text).toContain("mutate.archiveHint");
    expect(text).toContain("mutate.archive");
    expect(text).toContain("mutate.cancel");
    // ...and nothing destructive has happened yet, on this page or on the wire.
    expect(client.calls.fetched.filter((f) => f.method === "POST")).toEqual([]);

    // The rename input starts AT the current key (directory name = key): the useful starting
    // point is the name being changed, not an empty box.
    expect(findInput(detail)!.props.value).toBe("gui-alice");

    // Step 2 of 2: the PURGE outcome is a separate, further step that spells out that it
    // cannot be undone — and it demands the name be typed (see the confirm-required case).
    findClickable(confirming, "mutate.purge")!.props.onClick!();
    await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The tree after the purge step was opened. */
    const purgeStep = await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The purge step's text, scanned for its warning and confirm copy. */
    const purgeText = flatText(purgeStep);
    expect(purgeText).toContain("mutate.purgeHint");
    expect(purgeText).toContain("mutate.purgeConfirm");
    expect(purgeText).toContain("mutate.cancel");
    expect(client.calls.fetched.filter((f) => f.method === "POST")).toEqual([]);
    restore(client);
  });

  test("purge cannot be submitted without typing the exact name (§D confirm-required)", async () => {
    /** This arm's client, props and open detail pane. */
    const { client, props, detail } = await openLibraryPage();
    // Re-read the tree between interactions: every render pass rebuilds the elements, so a
    // handler captured from an earlier pass would act on a view that is no longer on screen.
    findClickable(detail, "mutate.delete")!.props.onClick!();
    await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The tree after the delete control was clicked. */
    const archiveStep = await client.hooks.act(client.exports.WorkmateLibraryView, props);
    findClickable(archiveStep, "mutate.purge")!.props.onClick!();
    await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The purge step's tree, where the confirm control lives. */
    const purge = await client.hooks.act(client.exports.WorkmateLibraryView, props);
    expect(flatText(purge)).toContain("mutate.purgeHint");

    /** The purge confirm field of a rendered tree. */
    const purgeInput = (tree: TreeChild): ElementNode | null => findFirst(tree, (candidate) => candidate.props?.placeholder === "mutate.purgeConfirmLabel"
      && typeof candidate.props?.onChange === "function");
    /** The purge confirm field of the step just rendered. */
    const input = purgeInput(purge);
    expect(input).not.toBeNull();
    expect(input!.props.value).toBe("");

    // Wrong name: the confirm control is DISABLED, so the browser cannot deliver the click and
    // no purge request can leave the page.
    input!.props.onChange!({ target: { value: "not-the-name" } });
    await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The tree after a WRONG confirm name was typed. */
    const wrong = await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The confirm control, which a wrong name must leave disabled. */
    const confirmButton = findClickable(wrong, "mutate.purgeConfirm");
    expect(confirmButton).not.toBeNull();
    expect(confirmButton!.props.disabled).toBe(true);
    expect(confirmButton!.props["aria-disabled"]).toBe(true);
    // The typed name really is the wrong one, and it really landed in the PURGE field.
    expect(purgeInput(wrong)!.props.value).toBe("not-the-name");
    expect(client.calls.fetched.filter((f) => f.url.endsWith("/delete"))).toEqual([]);

    // Typing the exact name — and nothing else — arms it.
    purgeInput(wrong)!.props.onChange!({ target: { value: "gui-alice" } });
    await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The tree after the exact confirm name was typed. */
    const armed = await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The confirm control, which the exact name must arm. */
    const armedButton = findClickable(armed, "mutate.purgeConfirm");
    expect(armedButton!.props.disabled).toBe(false);
    expect(armedButton!.props["aria-disabled"]).toBe(false);
    expect(client.calls.fetched.filter((f) => f.url.endsWith("/delete"))).toEqual([]);
    restore(client);
  });

  test("the archive confirmation posts that workmate and reports the archived outcome", async () => {
    /** This arm's client, props and open detail pane. */
    const { client, props, detail } = await openLibraryPage();
    findClickable(detail, "mutate.delete")!.props.onClick!();
    /** The tree after the first delete step landed. */
    const confirming = await client.hooks.act(client.exports.WorkmateLibraryView, props);
    findClickable(confirming, "mutate.archive")!.props.onClick!();
    await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The tree after the archive confirmation posted. */
    const after = await client.hooks.act(client.exports.WorkmateLibraryView, props);

    /** Every POST the page sent during this arm. */
    const posts = client.calls.fetched.filter((f) => f.method === "POST");
    expect(posts.map((f) => f.url)).toEqual(["/plugins/mpd-workmate/delete"]);
    // The recorded POST always carries the serialized body, which is what the arm asserts.
    expect(JSON.parse(posts[0].options!.body as string)).toEqual({ name: "gui-alice" });
    // D1: an archive is NOT a purge, so no confirm field rides along.
    expect(JSON.parse(posts[0].options!.body as string).purge).toBeUndefined();
    // After a delete the view returns to the LIST: the archived instance is gone, so the
    // detail pane must not linger on it.
    expect(flatText(after)).not.toContain("mutate.deleteTitle");
    // No stale detail polling either: the page re-reads the list, never the dead key again.
    const gets = client.calls.fetched.filter((f) => f.url.startsWith("/plugins/mpd-workmate/get")).map((f) => f.url);
    expect(gets[gets.length - 1]).toBe("/plugins/mpd-workmate/get?name=gui-alice");
    restore(client);
  });

  test("a rename posts { name, new_name } and follows the new key (§H no stale selection)", async () => {
    /** This arm's client, props and open detail pane. */
    const { client, props, detail } = await openLibraryPage();
    /** The rename field of the detail pane. */
    const input = findInput(detail);
    expect(input).not.toBeNull();
    // Prefilled with the current key, then edited to the target name.
    expect(input!.props.value).toBe("gui-alice");
    input!.props.onChange!({ target: { value: "gui-alice-2" } });
    /** The tree after the rename field was edited. */
    const filled = await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The rename form, the detail pane's first form. */
    const form = findForm(filled);
    expect(form).not.toBeNull();
    form!.props.onSubmit!({
      /** The submit event stub: the form handler only calls preventDefault. */
      preventDefault(): void {},
    });
    await client.hooks.act(client.exports.WorkmateLibraryView, props);
    await client.hooks.act(client.exports.WorkmateLibraryView, props);

    /** Every POST the page sent during this arm. */
    const posts = client.calls.fetched.filter((f) => f.method === "POST");
    expect(posts.map((f) => f.url)).toEqual(["/plugins/mpd-workmate/rename"]);
    expect(JSON.parse(posts[0].options!.body as string)).toEqual({ name: "gui-alice", new_name: "gui-alice-2" });
    // The detail pane no longer points at the old key: it re-reads the NEW one.
    const getUrls = client.calls.fetched.filter((f) => f.url.startsWith("/plugins/mpd-workmate/get")).map((f) => f.url);
    expect(getUrls).toContain("/plugins/mpd-workmate/get?name=gui-alice-2");
    expect(getUrls[getUrls.length - 1]).toBe("/plugins/mpd-workmate/get?name=gui-alice-2");
    restore(client);
  });

  test("an in-use refusal is shown with the blocking team/member, not a generic failure (§E)", async () => {
    /** The team and member that hold the workmate, as the route reports them. */
    const blocking = [{ teamId: "workmate-rename-delete", member: "architect" }];
    /** This arm's client, props and open detail pane. */
    const { client, props, detail } = await openLibraryPage({
      responses: { "/plugins/mpd-workmate/get?name=gui-alice": READ_ONLY },
      requestResponses: {
        "POST /plugins/mpd-workmate/rename": { status: 409, body: { error: "refused: workmate is in use", reason: "in-use", blocking } },
      },
    });
    /** The rename field of the detail pane. */
    const input = findInput(detail);
    input!.props.onChange!({ target: { value: "oracle-2" } });
    /** The tree after the rename field was edited. */
    const filled = await client.hooks.act(client.exports.WorkmateLibraryView, props);
    findForm(filled)!.props.onSubmit!({
      /** The submit event stub: the form handler only calls preventDefault. */
      preventDefault(): void {},
    });
    await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The tree after the refused rename settled. */
    const after = await client.hooks.act(client.exports.WorkmateLibraryView, props);

    /** The refusal text, which must name both blockers. */
    const text = flatText(after);
    // The localized in-use message, naming BOTH blockers — not a generic failure, and not
    // the bare message template (the placeholder must be interpolated).
    expect(text).toContain("mutate.reason.inUse");
    expect(text).not.toContain("{blocking}");
    expect(text).toContain("workmate-rename-delete");
    expect(text).toContain("architect");
    // A readonly instance is still a valid mutation target (§M1) — the refusal is about
    // being in use, not about the readonly discipline.
    expect(client.calls.fetched.some((f) => f.url.endsWith("/rename") && f.method === "POST")).toBe(true);
    restore(client);
  });

  test("a 409 collision is reported as taken, and an unknown key drops the stale selection", async () => {
    /** This arm's client, props and open detail pane. */
    const { client, props, detail } = await openLibraryPage({
      requestResponses: { "POST /plugins/mpd-workmate/rename": { status: 409, body: { error: "target exists", reason: "collision" } } },
    });
    /** The rename field of the detail pane. */
    const input = findInput(detail);
    input!.props.onChange!({ target: { value: "gui-alice-2" } });
    /** The tree after the rename field was edited. */
    const filled = await client.hooks.act(client.exports.WorkmateLibraryView, props);
    findForm(filled)!.props.onSubmit!({
      /** The submit event stub: the form handler only calls preventDefault. */
      preventDefault(): void {},
    });
    await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The tree after the colliding rename settled. */
    const after = await client.hooks.act(client.exports.WorkmateLibraryView, props);
    expect(flatText(after)).toContain("mutate.reason.collision");
    restore(client);
  });

  // ── The four t8 low findings, each with the assertion that would have caught it ─────────
  test("a same-key rename is refused locally and explains itself (t8 L1)", async () => {
    /** This arm's client, props and open detail pane. */
    const { client, props, detail } = await openLibraryPage();
    // The rename field starts AT the current key, so submitting it UNCHANGED is exactly the
    // same-key case the server answers 400 invalid-name for. Its dictionary entry must be
    // reachable: before this fix it existed in both languages and could never be shown.
    expect(findInput(detail)!.props.value).toBe("gui-alice");
    findForm(detail)!.props.onSubmit!({
      /** The submit event stub: the form handler only calls preventDefault. */
      preventDefault(): void {},
    });
    await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The tree after the same-key submit was refused locally. */
    const after = await client.hooks.act(client.exports.WorkmateLibraryView, props);

    expect(flatText(after)).toContain("mutate.reason.sameKey");
    // Refused BEFORE the wire: no pointless rename round-trip leaves the page.
    expect(client.calls.fetched.filter((f) => f.method === "POST")).toEqual([]);
    restore(client);
  });

  test("a purge never reports itself as a plain delete (t8 L2)", () => {
    /** The client this arm mounts with the mutation answers. */
    const client = loadMpdClient({ responses: LIST_ONLY, requestResponses: MUTATION_RESPONSES });
    /** The two dictionaries the page registered. */
    const { zh, en } = client.exports.dictionaries;
    // D1's whole point is that archive and purge are DIFFERENT outcomes, so the busy label
    // must not blur them mid-operation: zh "彻底删除" used to turn into "删除中…".
    // English inflects ("Purge" → "Purging" drops the e), so compare the shared stem;
    // Chinese does not inflect ("彻底删除" → "彻底删除中…").
    /** Drop a trailing "e" so "purge"/"purging" share a comparable stem. */
    const stem = (word: string): string => (word.toLowerCase().endsWith("e") ? word.slice(0, -1) : word).toLowerCase();
    expect(zh["mutate.purgeBusy"]).toContain(zh["mutate.purge"]);
    expect(en["mutate.purgeBusy"].toLowerCase()).toContain(stem(en["mutate.purge"]));
    expect(zh["mutate.archiveBusy"]).toContain(zh["mutate.archive"]);
    expect(en["mutate.archiveBusy"].toLowerCase()).toContain(stem(en["mutate.archive"]));
    restore(client);
  });

  test("the zh reason strings are complete sentences without a stray gap (t8 L3)", () => {
    /** The client this arm mounts with the mutation answers. */
    const client = loadMpdClient({ responses: LIST_ONLY, requestResponses: MUTATION_RESPONSES });
    /** The zh dictionary the arm inspects. */
    const zh = client.exports.dictionaries.zh;
    // "…完整名称确认" read as clipped — the 以 was missing.
    expect(zh["mutate.reason.confirmRequired"]).toContain("以确认");
    // A full-width colon followed by a HALF-width space renders as a visible gap before the
    // interpolated blocker list.
    expect(zh["mutate.reason.inUse"]).toContain("：{blocking}");
    expect(zh["mutate.reason.inUse"]).not.toContain("： {blocking}");
    restore(client);
  });

  test("a detail load that fails stops claiming to load (t8 L4)", async () => {
    /** This arm's client, props and open detail pane. */
    const { client, props, detail } = await openLibraryPage({
      // `failed`, NOT `unknown`: only `unknown` closes the pane, so this is the branch that
      // used to render "Loading…" forever beside the error banner.
      requestResponses: {
        ...MUTATION_RESPONSES,
        "GET /plugins/mpd-workmate/get?name=gui-alice": { status: 500, body: { error: "detail exploded", reason: "failed" } },
      },
    });
    /** The tree after the failing detail load settled. */
    const after = await client.hooks.act(client.exports.WorkmateLibraryView, props);
    /** The failure text the pane shows beside the still-selected row. */
    const text = flatText(after);

    expect(text).not.toContain("panel.loading");
    expect(text).toContain("detail exploded");
    // The workmate stays SELECTED — a transient failure must not throw the selection away
    // (only a genuinely gone key does that, contract §H).
    expect(text).toContain("mutate.deleteTitle");
    restore(client);
  });
});
describe("without DSH-better-sidebar", () => {
  test("registers no sidebar surface at all — there is no floating fallback", () => {
    /** The client this arm mounts without a sidebar provider. */
    const client = loadMpdClient({ withoutSidebar: true });
    /** Every console.warn line the mount emitted. */
    const warnings: string[] = [];
    /** The real console.warn, put back before the assertions run. */
    const original = console.warn;
    console.warn = (message) => { warnings.push(String(message)); };
    try {
      client.exports.apply(client.ctx);
    } finally {
      console.warn = original;
    }
    expect(client.calls.registerTab.length).toBe(0);
    // No overlay, no footer toggle: the registrations left are the non-GUI slash-command
    // admission row and the t35 settings UI (which since w14 targets its OWN top-level settings
    // section, not the sidebar) — a profile without the sidebar still gets both. The section's own
    // ACTUAL registration additionally needs the `settingsScope` service, which this harness does
    // not mount; its own test file provides it and asserts that registration.
    expect(client.calls.slots ?? []).toEqual(["conversation.chat.commandview", "settings.section"]);
    /** Every keyed slot registration the mount recorded. */
    const definitions = client.calls.slotsRegistered ?? [];
    expect(definitions.map((definition) => definition.name)).toEqual(["conversation.chat.commandview"]);
    // Nothing is registered, and nothing is warned about either: the injection simply never
    // fires, which is the point of using ctx.inject instead of a fatal static declaration.
    expect(client.provideSidebar()).toBe(false);
    expect(client.calls.registerTab.length).toBe(0);
    expect(warnings.filter((message) => message.includes("no registerTab")).length).toBe(0);
  });
});

// ── W4: the host PREFERENCE, asserted rather than assumed ────────────────────
//
// THE RULE (user decision, 2026-09-30): `dsh-better-sidebar` is the PREFERRED host for the mpd
// panels, and the harness's own right sidebar is the FALLBACK — so a profile mounting BOTH must not
// end up with the same panel in two places. The behaviour is one early return inside the official
// registration callback, which is exactly the kind of thing a later refactor deletes without
// noticing, so both directions are pinned here.
describe("the sidebar host preference (W4)", () => {
  /**
     * The registry double for the harness sidebar.
     * @returns the tab/pane recorders and the two service objects the client injects.
     */
  const harnessSidebarDouble = (): {
    /** The tab definitions the host accepted. */
    tabs: Array<{ id: string; kind: string; title: () => string }>
    /** The pane bodies the host accepted. */
    bodies: Array<{ key: string; name: string; component: unknown }>
    /** The tabs the client asked the host to open. */
    opened: string[]
    /** The tab-type registry the client registers into. */
    sidebarRightTabs: { register: (definition: { id: string; kind: string; title: () => string }) => () => void }
    /** The pane opener the client's commands call. */
    sidebarRight: { openTab: (kind: string) => () => void }
    /** A pane-body registry, for an arm that wants to install its own over the harness's. */
    slots: { register: (definition: { key: string; name: string }, component: unknown) => () => void }
  } => {
    /** The tab definitions the host accepted. */
    const tabs: Array<{ id: string; kind: string; title: () => string }> = [];
    /** The pane bodies the host accepted, when an arm installs this double over the harness's own. */
    const bodies: Array<{ key: string; name: string; component: unknown }> = [];
    /** The tabs the client asked the host to open. */
    const opened: string[] = [];
    return {
      tabs,
      bodies,
      opened,
      sidebarRightTabs: {
        register: (definition: { id: string; kind: string; title: () => string }) => { tabs.push(definition); return () => {}; },
      },
      sidebarRight: {
        openTab: (kind: string) => { opened.push(kind); return () => {}; },
      },
      slots: {
        register: (definition: { key: string; name: string }, component: unknown) => { bodies.push({ ...definition, component }); return () => {}; },
      },
    };
  }

  test("with better-sidebar MOUNTED the official right sidebar stays untouched", () => {
    /** The client with BOTH hosts available. */
    const client = loadMpdClient({ sidebarAtApply: true });
    /** The harness sidebar's registry double. */
    const harness = harnessSidebarDouble();
    client.exports.apply(client.ctx);
    // The official sidebar arrives after apply(), exactly as it does live.
    client.provideService("sidebarRightTabs", harness.sidebarRightTabs);
    client.provideService("slots", harness.slots);
    client.provideService("sidebarRight", harness.sidebarRight);
    // better-sidebar won, so NOTHING was registered on the fallback host — no duplicate panel.
    expect(harness.tabs).toEqual([]);
    expect(harness.bodies).toEqual([]);
    // The preferred host DID get the tabs, which is what makes this a preference and not a disable.
    expect(client.calls.registerTab.map((tab) => tab.id).sort()).toEqual(["mpd-agent-teams", "mpd-team", "mpd-workmate"]);
    restore(client);
  });

  test("with better-sidebar ABSENT both panels register on the official fallback", () => {
    /** The client in a profile that has the harness sidebar and not the third-party one. */
    const client = loadMpdClient({ withoutSidebar: true });
    /** The harness sidebar's registry double. */
    const harness = harnessSidebarDouble();
    client.exports.apply(client.ctx);
    client.provideService("slots", harness.slots);
    client.provideService("sidebarRightTabs", harness.sidebarRightTabs);
    client.provideService("sidebarRight", harness.sidebarRight);
    // BOTH panels reach the fallback: the team view AND the workmate library, which used to be a
    // better-sidebar-only surface and was therefore unreachable in exactly this profile.
    expect(harness.tabs.map((tab) => tab.id).sort()).toEqual(["@mpd-dsh/team-sidebar", "@mpd-dsh/workmate-sidebar"]);
    // The PANE BODIES go through the harness's own `slots` service, which is the one this client
    // declares as a dependency — so this is the real path, not a double the arm installed.
    /** The pane bodies both tabs registered, by the key they were registered under. */
    // FILTERED BY SLOT NAME: `slotsRegistered` also carries the non-sidebar rows this client
    // registers (the command view and the settings section), which are a different concern.
    const bodies = (client.calls.slotsRegistered ?? []).filter((slot) => slot.name === "sidebar.right.pane.tab").map((slot) => slot.key).sort();
    expect(bodies).toEqual(["@mpd-dsh/team-sidebar", "@mpd-dsh/workmate-sidebar"]);
    // Every body is a component the host can call, not a value.
    for (const body of client.calls.slotsRegistered ?? []) {
      if (body.name === "sidebar.right.pane.tab") expect(typeof body.component).toBe("function");
    }
    restore(client);
  });
})
