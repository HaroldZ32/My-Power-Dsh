// Proves the bundle's web client contributes ONE `conversation.view` entry — the MPD workbench —
// and that the page it renders is a real surface: the team header with its hold, the board rows,
// two fenced writes that DEGRADE to a sentence, and an empty state that is never a blank page.
//
// WHY THIS SLOT IS PINNED HERE. A mobile host projects `conversation.view` as a full-page tab and
// locates it by the entry's `id` + `label`, so those two values are a CONTRACT with a client that
// does not live in this repository. The static arms pin them; the behavioural arms drive the REAL
// combined `client.js` through the offline harness (no browser, no server).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadMpdClient, type ElementNode, type LoadedMpdClient, type SlotRegistration, type TreeChild, type TreeNode } from "./client-harness.ts";

/** Repository root, three directories above this test file. */
const ROOT = join(import.meta.dirname, "..", "..", "..");
process.env.MPD_REPO_ROOT = ROOT;

/** The slot this bundle contributes exactly one entry to. */
const SLOT = "conversation.view";
/** The entry id the mobile host keys its tab on. */
const VIEW_ID = "mpd-workbench";
/** The label thunk's constant answer (it is deliberately locale-independent). */
const VIEW_LABEL = "Workbench";
/** The locale namespace the page's own copy lives in. */
const LOCALE_NS = "mpdWorkbench";

/** One active team with a two-row board, as `/plugins/mpd-team/state` serves it. */
const STATE_TEAM = {
  ok: true,
  workspace: "/ws",
  sessionId: "s1",
  workspaceTeams: { records: [] },
  team: { id: "team-abc", name: "Mobile slice", description: "one small slice", phase: "active", links: 1 },
  counts: { total: 2, completed: 1, running: 1, ready: 0, blocked: 0, failed: 0, releasedByFailure: 0 },
  members: [
    { id: "m1", name: "Ada", status: "running", done: 1, total: 2 },
    { id: "m2", name: "Bo", status: "waiting", done: 0, total: 0 },
  ],
  tasks: [
    { id: "T1", subject: "wire the view", status: "completed", visual: "completed", owner: "Ada", progress: 100, blockedBy: [], failedBy: [], depth: 0 },
    { id: "T2", subject: "run the gates", status: "in_progress", visual: "running", owner: "Bo", progress: 50, blockedBy: ["T1"], failedBy: [], depth: 1 },
  ],
  cycles: [],
  executor: { kind: "native", reason: "default" },
  problems: [],
};

/** A session with no team of its own, and no staged plan either. */
const STATE_NONE = {
  ok: true,
  workspace: "/ws",
  sessionId: "s1",
  workspaceTeams: { records: [] },
  team: null,
  counts: { total: 0, completed: 0, running: 0, ready: 0, blocked: 0, failed: 0, releasedByFailure: 0 },
  members: [],
  tasks: [],
  cycles: [],
  executor: { kind: "native", reason: "default" },
  problems: [],
};

/** A session whose workspace holds one OTHER team, so the empty state has something to name. */
const STATE_OTHER = {
  ...STATE_NONE,
  workspaceTeams: { records: [{ id: "team-old", name: "Last wave", description: "done", phase: "ended", tasks: { total: 1, completed: 1, failed: 0 }, members: 3, active: false }] },
};

/** A staged-but-unapproved plan, the state the empty state must point at. */
const PLAN_STAGED = { ok: true, workspace: "/ws", sessionId: "s1", plan: { planId: "plan-1", name: "staged", description: "d", tasks: [], members: [] } };
/** No staged plan. */
const PLAN_NONE = { ok: true, workspace: "/ws", sessionId: "s1", plan: null };

/** The watchdog payload with a LIVE hold on the team the page shows. */
const WATCHDOG_HELD = {
  ok: true,
  reader: "web-panel",
  generatedAt: "2026-11-01T00:00:00.000Z",
  stateDir: ".mpd/team",
  workspaces: ["/ws"],
  workspace: "/ws",
  stuck: true,
  held: [{ id: "hold-1", teamId: "team-abc", since: 1762000000000, cause: "silence", taskId: "T2", attemptId: "a1", sceneAt: 1762000000000 }],
  banner: { kind: "held", teamId: "team-abc", holdId: "hold-1", incidentId: null, cause: "silence", since: 1762000000000, taskId: "T2", attemptId: "a1", scene: null, workspace: "/ws" },
  activity: [],
  unread: [],
  watermarks: {},
  replay: false,
  errors: [],
};

/** The watchdog payload with no hold at all. */
const WATCHDOG_CLEAR = { ...WATCHDOG_HELD, stuck: false, held: [], banner: null };

/** Every read route canned for the session-less (workspace-level) spelling. */
const READS = {
  "/plugins/mpd-team/state": STATE_TEAM,
  "/plugins/mpd-team/plan": PLAN_NONE,
  "/plugins/mpd-team-watchdog/state": WATCHDOG_CLEAR,
};

/** Flatten an element tree (or any nested value) into its text, the way the page's own copy reads. */
function textOf(value: TreeNode): string {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (typeof value === "object" && "props" in value) return textOf(value.props?.children);
  return "";
}

/** Every element of one tag in a tree, depth first, so a button can be found by its label. */
function elementsOf(tree: TreeChild, tag: string): ElementNode[] {
  if (tree === null || tree === undefined || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => elementsOf(child as TreeChild, tag));
  /** This node's own match, before its descendants. */
  const here: ElementNode[] = tree.type === tag ? [tree] : [];
  /** The node's children, one node or a list of them. */
  const children = tree.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) here.push(...elementsOf(child as TreeChild, tag));
  return here;
}

/** The button whose own text is `label`, or undefined when the page rendered none. */
function buttonOf(tree: TreeChild, label: string): ElementNode | undefined {
  return elementsOf(tree, "button").find((button) => textOf(button.props.children) === label);
}

/** Hand the process-global fetch stub back to the runtime, so a later case gets its own fixtures. */
function restore(client: LoadedMpdClient): void {
  try {
    client.restore();
  } catch {
    // already restored
  }
}

/**
 * Mount the client and hand back the ONE workbench registration it made.
 * @param client - the loaded client under test.
 * @returns the registration, asserted to exist.
 */
function workbenchOf(client: LoadedMpdClient): SlotRegistration {
  client.exports.apply(client.ctx);
  /** Every entry the slot double accepted for this slot. */
  const entries = (client.calls.slotsRegistered ?? []).filter((entry) => entry.name === SLOT);
  expect(entries.length).toBe(1);
  return entries[0]!;
}

/**
 * Click one button by its label, then let the handler's promise chain land.
 *
 * The hook runtime cannot await a handler's promise, so this arm waits the same way the harness's
 * own render loop does — several macrotask ticks — and then re-renders once with `act`.
 * @param client - the loaded client under test (its hook runtime drives the re-render).
 * @param tree - the tree the button lives in.
 * @param component - the registered component to re-render.
 * @param props - the props the component renders with.
 * @param label - the button's own text.
 */
async function clickAndSettle(client: LoadedMpdClient, tree: ElementNode, component: Function, props: Record<string, unknown>, label: string): Promise<ElementNode> {
  /** The button to press. */
  const button = buttonOf(tree, label);
  expect(button).toBeDefined();
  (button!.props.onClick as () => void)();
  for (let tick = 0; tick < 8; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return client.hooks.act(component, props);
}

describe("the MPD workbench is ONE conversation.view entry", () => {
  test("apply() registers exactly one entry with the pinned id, label and locale", () => {
    /** The client under test. */
    const client = loadMpdClient({ responses: READS });
    try {
      /** The workbench registration. */
      const entry = workbenchOf(client);
      // The slot double records every injection, so this also proves the SLOT the entry targets.
      expect(client.calls.slots).toContain(SLOT);
      expect(entry.name).toBe(SLOT);
      expect(entry.id).toBe(VIEW_ID);
      expect(typeof entry.label).toBe("function");
      expect(entry.label()).toBe(VIEW_LABEL);
      expect(entry.locale).toBe(LOCALE_NS);
      // An ENTRY, not a keyed item: the slot is a `list`, whose registration requires `id` only.
      expect(Object.hasOwn(entry, "key")).toBe(false);
      // NO `order`: the conversation shell projects its tab list from registration order, so a
      // number here would be a field the host never reads.
      expect(Object.hasOwn(entry, "order")).toBe(false);
    } finally {
      restore(client);
    }
  });

  test("the page's copy is registered for BOTH languages and stays key-complete", () => {
    /** The client under test. */
    const client = loadMpdClient({ responses: READS });
    try {
      workbenchOf(client);
      /** The dictionaries registered for this page's namespace. */
      const registered = (client.calls.localeDictionaries ?? []).filter((entry) => entry.namespace === LOCALE_NS);
      expect(registered.length).toBe(1);
      /** The two language tables. */
      const dictionaries = registered[0]!.dictionaries;
      expect(Object.keys(dictionaries).sort()).toEqual(["en", "zh"]);
      expect(Object.keys(dictionaries.zh!).sort()).toEqual(Object.keys(dictionaries.en!).sort());
      // Every value is real copy, never an empty string that would render as nothing.
      for (const value of Object.values(dictionaries.en!)) expect(value.trim()).not.toBe("");
      for (const value of Object.values(dictionaries.zh!)) expect(value.trim()).not.toBe("");
    } finally {
      restore(client);
    }
  });
});

describe("the workbench page renders the team, its board and its hold", () => {
  test("the header names the team id, its phase, the member count and the live hold", async () => {
    /** The client under test, with a live hold on this team. */
    const client = loadMpdClient({ responses: { ...READS, "/plugins/mpd-team-watchdog/state": WATCHDOG_HELD } });
    try {
      /** The workbench registration. */
      const entry = workbenchOf(client);
      /** The rendered page. */
      const tree = await client.hooks.render(entry.component, {});
      /** The page's whole text. */
      const text = textOf(tree);
      expect(text).toContain("MPD workbench");
      expect(text).toContain("team-abc");
      expect(text).toContain("active");
      expect(text).toContain("2 members");
      expect(text).toContain("held — silence");
      // A held team can be RESUMED and not paused: the two buttons follow the hold, not a click.
      expect(buttonOf(tree, "Pause")?.props.disabled).toBe(true);
      expect(buttonOf(tree, "Resume")?.props.disabled).toBe(false);
      client.hooks.runCleanups();
    } finally {
      restore(client);
    }
  });

  test("the board renders one row per task with its id, owner and RENDERED state", async () => {
    /** The client under test. */
    const client = loadMpdClient({ responses: READS });
    try {
      /** The workbench registration. */
      const entry = workbenchOf(client);
      /** The rendered page. */
      const tree = await client.hooks.render(entry.component, {});
      /** The page's whole text. */
      const text = textOf(tree);
      expect(text).toContain("T1");
      expect(text).toContain("T2");
      expect(text).toContain("Ada");
      expect(text).toContain("Bo");
      // `visual` wins over `status`: the rendered state is what a reader can act on.
      expect(text).toContain("completed");
      expect(text).toContain("running");
      // No hold, so the opposite button pair is live.
      expect(buttonOf(tree, "Pause")?.props.disabled).toBe(false);
      expect(buttonOf(tree, "Resume")?.props.disabled).toBe(true);
      client.hooks.runCleanups();
    } finally {
      restore(client);
    }
  });

  test("the 简体中文 table is what the page renders when the host binds it", async () => {
    /** The client under test. */
    const client = loadMpdClient({ responses: READS });
    try {
      /** The workbench registration. */
      const entry = workbenchOf(client);
      /** The zh table the client registered, used as the host translator would. */
      const zh = (client.calls.localeDictionaries ?? []).find((row) => row.namespace === LOCALE_NS)!.dictionaries.zh!;
      /** The rendered page, translated. */
      const tree = await client.hooks.render(entry.component, { t: (key: string) => zh[key] ?? key });
      /** The page's whole text. */
      const text = textOf(tree);
      expect(text).toContain("MPD 工作台");
      expect(text).toContain("2 名成员");
      expect(buttonOf(tree, "暂停")).toBeDefined();
      client.hooks.runCleanups();
    } finally {
      restore(client);
    }
  });
});

describe("the workbench empty state is explicit, never a blank page", () => {
  test("a session with no team says so and names the next step", async () => {
    /** The client under test. */
    const client = loadMpdClient({ responses: { ...READS, "/plugins/mpd-team/state": STATE_NONE } });
    try {
      /** The workbench registration. */
      const entry = workbenchOf(client);
      /** The rendered page. */
      const tree = await client.hooks.render(entry.component, {});
      /** The page's whole text. */
      const text = textOf(tree);
      expect(text).toContain("No team in this session.");
      expect(text).toContain("agent_teams_plan");
      // No team means no write targets: neither button is rendered at all.
      expect(buttonOf(tree, "Pause")).toBeUndefined();
      expect(buttonOf(tree, "Resume")).toBeUndefined();
      client.hooks.runCleanups();
    } finally {
      restore(client);
    }
  });

  test("a staged plan is named instead of the generic hint", async () => {
    /** The client under test, with a staged plan and no team. */
    const client = loadMpdClient({ responses: { ...READS, "/plugins/mpd-team/state": STATE_NONE, "/plugins/mpd-team/plan": PLAN_STAGED } });
    try {
      /** The workbench registration. */
      const entry = workbenchOf(client);
      /** The page's whole text. */
      const text = textOf(await client.hooks.render(entry.component, {}));
      expect(text).toContain("A plan is staged for this session");
      expect(text).not.toContain("Nothing is staged here");
      client.hooks.runCleanups();
    } finally {
      restore(client);
    }
  });

  test("the workspace's other teams are named, not hidden behind an empty page", async () => {
    /** The client under test, with one other team in the workspace. */
    const client = loadMpdClient({ responses: { ...READS, "/plugins/mpd-team/state": STATE_OTHER } });
    try {
      /** The workbench registration. */
      const entry = workbenchOf(client);
      /** The page's whole text. */
      const text = textOf(await client.hooks.render(entry.component, {}));
      expect(text).toContain("This workspace has 1 other team(s)");
      expect(text).toContain("team-old (ended)");
      client.hooks.runCleanups();
    } finally {
      restore(client);
    }
  });

  test("a payload WITHOUT ok:true is reported as unreadable, never as an empty team", async () => {
    /** The client under test, whose state route answers a body with no `ok` marker. */
    const client = loadMpdClient({ responses: { ...READS, "/plugins/mpd-team/state": { team: null } } });
    try {
      /** The workbench registration. */
      const entry = workbenchOf(client);
      /** The page's whole text. */
      const text = textOf(await client.hooks.render(entry.component, {}));
      expect(text).toContain("The team routes could not be read.");
      expect(text).toContain("Could not read /plugins/mpd-team/state");
      expect(text).toContain("HTTP 200");
      // THE POINT: an unreadable answer must not be rendered as the confident "no team" claim.
      expect(text).not.toContain("No team in this session.");
      client.hooks.runCleanups();
    } finally {
      restore(client);
    }
  });
});

describe("the two fenced writes degrade to a message, never a crash", () => {
  test("Pause POSTs {teamId} to the hold route, disables both buttons in flight, then re-reads", async () => {
    /** The client under test. */
    const client = loadMpdClient({
      responses: READS,
      requestResponses: { "POST /plugins/mpd-team-watchdog/hold": { ok: true, held: true } },
    });
    try {
      /** The workbench registration. */
      const entry = workbenchOf(client);
      /** The rendered page. */
      const tree = await client.hooks.render(entry.component, {});
      /** The button to press. */
      const button = buttonOf(tree, "Pause")!;
      button.props.onClick!();
      // MID-FLIGHT, synchronously: the handler sets `busy` before its promise leaves, so a render
      // taken NOW must show the busy label and must disable BOTH buttons.
      client.hooks.reset();
      /** The page rendered while the request is still in flight. */
      const inFlight = entry.component({}) as ElementNode;
      expect(buttonOf(inFlight, "Pausing…")?.props.disabled).toBe(true);
      expect(buttonOf(inFlight, "Resume")?.props.disabled).toBe(true);
      /** The page after the write and its re-read landed. */
      const settled = await clickAndSettle(client, tree, entry.component, {}, "Pause");
      // The label is back to the resting one, i.e. the busy state really was cleared.
      expect(buttonOf(settled, "Pause")).toBeDefined();
      /** The POST the page issued. */
      const post = client.calls.fetched.find((call) => call.method === "POST");
      expect(post?.url).toBe("/plugins/mpd-team-watchdog/hold");
      // `reason` IS the sidecar's recorded cause, so a human pause must not be stored as `silence`
      // (the watchdog's own stall word). The route takes only those two fields from this page.
      expect(post?.options?.body).toBe(JSON.stringify({ teamId: "team-abc", reason: "workbench" }));
      // The re-read happened, so the header follows the server rather than the POST's echo.
      expect(client.calls.fetched.filter((call) => call.url === "/plugins/mpd-team/state").length).toBeGreaterThan(1);
      client.hooks.runCleanups();
    } finally {
      restore(client);
    }
  });

  test("Resume POSTs to the resume route when the team is held", async () => {
    /** The client under test, with the team held. */
    const client = loadMpdClient({
      responses: { ...READS, "/plugins/mpd-team-watchdog/state": WATCHDOG_HELD },
      requestResponses: { "POST /plugins/mpd-team-watchdog/resume": { ok: true } },
    });
    try {
      /** The workbench registration. */
      const entry = workbenchOf(client);
      /** The rendered page. */
      const tree = await client.hooks.render(entry.component, {});
      await clickAndSettle(client, tree, entry.component, {}, "Resume");
      /** The POST the page issued. */
      const post = client.calls.fetched.find((call) => call.method === "POST");
      expect(post?.url).toBe("/plugins/mpd-team-watchdog/resume");
      expect(post?.options?.body).toBe(JSON.stringify({ teamId: "team-abc" }));
      client.hooks.runCleanups();
    } finally {
      restore(client);
    }
  });

  test("a 403 from the host fence becomes the fence sentence, and the page keeps rendering", async () => {
    /** The client under test, whose write route is refused by the fence. */
    const client = loadMpdClient({
      responses: READS,
      requestResponses: { "POST /plugins/mpd-team-watchdog/hold": { status: 403, body: { ok: false, error: "refused by the host fence" } } },
    });
    try {
      /** The workbench registration. */
      const entry = workbenchOf(client);
      /** The rendered page. */
      const tree = await client.hooks.render(entry.component, {});
      /** The page after the refusal. */
      const refused = await clickAndSettle(client, tree, entry.component, {}, "Pause");
      /** The refusal sentence, rendered in the page's own alert row. */
      const text = textOf(refused);
      expect(text).toContain("The host refused the request (403)");
      // The board is still there: a refused write never takes the page down.
      expect(text).toContain("T1");
      // And the buttons are usable again, so a retry is possible.
      expect(buttonOf(refused, "Pause")?.props.disabled).toBe(false);
      client.hooks.runCleanups();
    } finally {
      restore(client);
    }
  });

  test("a 405 names the method, because that is a server build without the route", async () => {
    /** The client under test, whose write route does not exist on this build. */
    const client = loadMpdClient({
      responses: READS,
      requestResponses: { "POST /plugins/mpd-team-watchdog/hold": { status: 405, body: { ok: false, error: "method not allowed" } } },
    });
    try {
      /** The workbench registration. */
      const entry = workbenchOf(client);
      /** The rendered page. */
      const tree = await client.hooks.render(entry.component, {});
      /** The page after the refusal. */
      const refused = await clickAndSettle(client, tree, entry.component, {}, "Pause");
      expect(textOf(refused)).toContain("The route rejected the method (405)");
      client.hooks.runCleanups();
    } finally {
      restore(client);
    }
  });
});

describe("the session id comes from the slot's session kit", () => {
  test("a sessionId prop addresses every read with ?sessionId=", async () => {
    /** The client under test, canned for the session-scoped spelling. */
    const client = loadMpdClient({
      responses: {
        "/plugins/mpd-team/state?sessionId=s1": STATE_TEAM,
        "/plugins/mpd-team/plan?sessionId=s1": PLAN_NONE,
        "/plugins/mpd-team-watchdog/state?sessionId=s1": WATCHDOG_CLEAR,
      },
    });
    try {
      /** The workbench registration. */
      const entry = workbenchOf(client);
      /** The rendered page, addressed to one session. */
      const tree = await client.hooks.render(entry.component, { sessionId: "s1" });
      expect(textOf(tree)).toContain("team-abc");
      /** Every URL the page read. */
      const urls = client.calls.fetched.map((call) => call.url);
      expect(urls).toContain("/plugins/mpd-team/state?sessionId=s1");
      expect(urls).toContain("/plugins/mpd-team/plan?sessionId=s1");
      expect(urls).toContain("/plugins/mpd-team-watchdog/state?sessionId=s1");
      client.hooks.runCleanups();
    } finally {
      restore(client);
    }
  });

  test("no session id reads the WORKSPACE principal, with no query invented", async () => {
    /** The client under test, canned for the session-less spelling only. */
    const client = loadMpdClient({ responses: READS });
    try {
      /** The workbench registration. */
      const entry = workbenchOf(client);
      /** The rendered page, with no session prop at all. */
      const tree = await client.hooks.render(entry.component, {});
      expect(textOf(tree)).toContain("team-abc");
      /** Every URL the page read. */
      const urls = client.calls.fetched.map((call) => call.url);
      expect(urls).toContain("/plugins/mpd-team/state");
      // NOTHING here may guess a session: a made-up id addresses a session that does not exist.
      expect(urls.some((url) => url.includes("sessionId"))).toBe(false);
      client.hooks.runCleanups();
    } finally {
      restore(client);
    }
  });
});

describe("the slot gate degrades quietly, and never throws out of apply", () => {
  test("a ctx with no slots.inject loses the tab with ONE line and no throw", () => {
    /** The client under test. */
    const client = loadMpdClient({ responses: READS });
    /** The console lines the entry emits. */
    const lines: string[] = [];
    /** The real console method, restored in the finally block below. */
    const originalInfo = console.info;
    console.info = (message?: unknown) => { lines.push(String(message)); };
    try {
      // THE SERVICE PROBE IS THE GATE: a client ctx without the slot seam must degrade to a
      // diagnostic instead of throwing out of `apply` (which would take the whole page down).
      const ctx = client.ctx as unknown as { slots?: unknown };
      /** The real slot seam, put back before the arm ends so no later arm inherits the stub. */
      const savedSlots = ctx.slots;
      ctx.slots = { register: () => () => {} };
      expect(() => client.exports.apply(client.ctx)).not.toThrow();
      ctx.slots = savedSlots;
    } finally {
      console.info = originalInfo;
      restore(client);
    }
    /** The single line that reports the missing seam. */
    const reported = lines.filter((line) => line.includes("the MPD workbench view is not registered"));
    expect(reported.length).toBe(1);
    expect(reported[0]).toContain("slots.inject");
  });

  test("a host that never declares the slot reports the absence once, at the settle bound", async () => {
    /** The client under test. */
    const client = loadMpdClient({ responses: READS });
    /** The console lines the entry emits. */
    const lines: string[] = [];
    /** The real console method, restored in the finally block below. */
    const originalInfo = console.info;
    console.info = (message?: unknown) => { lines.push(String(message)); };
    try {
      // A REDUCED HOST: the seam exists and quietly accepts the wait, and the declaration never comes
      // — which is exactly what a host build without `conversation.view` looks like from here.
      const ctx = client.ctx as unknown as { slots?: { register: unknown; inject: unknown } };
      /** The real slot seam, put back before the arm ends so no later arm inherits the stub. */
      const savedSlots = ctx.slots;
      ctx.slots = { register: () => () => {}, inject: () => () => {} };
      client.exports.settleTimeoutMs(10);
      client.exports.apply(client.ctx);
      ctx.slots = savedSlots;
      await new Promise((resolve) => setTimeout(resolve, 40));
    } finally {
      console.info = originalInfo;
      restore(client);
    }
    /** The single line that reports the absent slot. */
    const reported = lines.filter((line) => line.includes("never declared \"conversation.view\""));
    expect(reported.length).toBe(1);
    expect(reported[0]).toContain("within 10ms");
  });
});
