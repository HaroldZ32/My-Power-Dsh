// w5 web front door driver (AC-12 / AC-14, web surface). Re-runnable:
//
//   MPD_REPO_ROOT=<repo> bun evidence/team-watchdog/notify/web/<ts>/driver.mjs
//
// It exercises the REAL code on both sides of the wire, with no browser:
//   * the REAL route handlers (packages/mpd-bundle-plugin/src/watchdog-web.ts) over a
//     sandbox workspace store, invoked through captured `webServer.register` handlers;
//   * the REAL built client (packages/mpd-bundle-plugin/client.js) through the offline
//     harness, with `fetch` served from the payload the ROUTE just produced (and re-produced
//     after the acknowledge), so the rendered tree cannot be fed a fixture the route could
//     not have returned.
//
// Assertions (all recorded in result.json + raw/):
//   S1 payload            the state route's payload: stuck/banner/activity/reader
//   S2 first poll         mounting the page fetches the route WITHOUT any user action
//   S3 render wired       the banner is the panel root's FIRST child and carries the
//                         payload's own values; ONE activity record heads the body
//   S4 acknowledge        the REAL POST handler advances read-watermark.json (bytes+sha
//                         before/after) and touches no other reader's key
//   S5 replay stops       after the acknowledge, the next poll renders NO banner/record
//   S6 restart            a FRESH client on the same store still shows nothing (acked)
//   S7 new incident       a SECOND unacknowledged incident replays on a fresh load
//   S8 no adopted edits   git status for packages/mpd-agent-teams-plugin is empty
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.MPD_REPO_ROOT ?? resolve(HERE, "..", "..", "..", "..", "..");
process.env.MPD_REPO_ROOT = REPO;

const { buildWatchdogState, registerWatchdogRoutes, acknowledge } = await import(
  join(REPO, "packages", "mpd-bundle-plugin", "src", "watchdog-web.ts")
);
const { createHarness, loadBundleClient } = await import(
  join(REPO, "packages", "mpd-bundle-plugin", "test", "client-harness.mjs")
);

const WS = join(HERE, "raw", "ws");
const STATE_DIR = join(".mpd", "team");
const READER = "web-panel";
const STATE_URL = "/plugins/mpd-team-watchdog/state?reader=" + READER;
const ACK_URL = "/plugins/mpd-team-watchdog/ack";
const T1 = 1789460000000;
const T2 = T1 + 60000;
const hold = { id: "hold-alpha-1", teamId: "alpha", since: T1, cause: "silence 120000 ms", taskId: "t9", attemptId: "a1", sceneAt: T1 };
const escalate = { id: "inc-1", teamId: "alpha", kind: "escalate", at: T1, cause: { kind: "silence", ms: 120000 }, taskId: "t9", attemptId: "a1", scene: join(WS, STATE_DIR, "watchdog", "scene", "alpha", "latest.json"), hold: "applied", acknowledgedBy: [] };
const warn2 = { id: "inc-2", teamId: "beta", kind: "warn", at: T2, cause: { kind: "silence", ms: 90000 }, taskId: "t10", attemptId: "a2", scene: null, hold: "not-requested", acknowledgedBy: [] };

const sha = (text) => createHash("sha256").update(text).digest("hex");
const bytesOf = (path) => readFileSync(path, "utf8");
const json = (res, status, body) => res.end(JSON.stringify(body));
const checks = [];
function check(id, ok, detail) {
  checks.push({ id, status: ok ? "passed" : "failed", detail });
  console.log(`[w5-web] ${ok ? "ok  " : "FAIL"} ${id}: ${detail}`);
  return ok;
}

function seedStore() {
  rmSync(join(WS, ".mpd"), { recursive: true, force: true });
  mkdirSync(join(WS, STATE_DIR, "watchdog", "hold"), { recursive: true });
  mkdirSync(join(WS, STATE_DIR, "watchdog", "scene", "alpha"), { recursive: true });
  writeFileSync(join(WS, STATE_DIR, "watchdog", "hold", "alpha.json"), JSON.stringify(hold, null, 2) + "\n", "utf8");
  writeFileSync(join(WS, STATE_DIR, "watchdog", "incidents.jsonl"), JSON.stringify(escalate) + "\n", "utf8");
  writeFileSync(join(WS, STATE_DIR, "watchdog", "scene", "alpha", "latest.json"), JSON.stringify({ at: T1, cause: "silence" }) + "\n", "utf8");
  writeFileSync(join(WS, STATE_DIR, "watchdog", "read-watermark.json"), JSON.stringify({ "tui-panel": 5 }, null, 2) + "\n", "utf8");
}
function appendIncident(record) {
  writeFileSync(join(WS, STATE_DIR, "watchdog", "incidents.jsonl"), JSON.stringify(record) + "\n", { flag: "a" });
}

/** Capture the REAL route handlers the way the host's web server would. */
function captureRoutes() {
  const routes = new Map();
  const registered = registerWatchdogRoutes(
    { register: (route) => { routes.set(route.path, route.handler); return () => {}; } },
    { roots: () => [WS], stateDir: () => STATE_DIR, effect: (fn) => fn() },
  );
  return { routes, registered };
}
const fakeRes = () => ({ status: 0, headers: {}, body: "", writeHead(status, headers) { this.status = status; this.headers = headers; }, end(text) { this.body = text; } });
const fakeReq = (url, body) => ({ url, async *[Symbol.asyncIterator]() { if (body !== undefined) yield JSON.stringify(body); } });
const callRoute = (handler, req) => { const res = fakeRes(); handler(req, res); return res; };
const callRouteAsync = async (handler, req) => { const res = fakeRes(); await handler(req, res); return res; };

/** Mount the REAL built client with `fetch` served by the real route handlers. */
function mountClient() {
  const { factories } = loadBundleClient();
  const responses = {};
  const harness = createHarness({ factories, requestResponses: responses });
  const saved = globalThis.fetch;
  globalThis.fetch = harness.fetchImpl;
  // Resolve BOTH through the harness's own require cache: calling the factories directly
  // would build a second module instance whose store the mounted page never reads (measured
  // — the render showed the banner while `__watchdogState()` still said null).
  const mpd = harness.require("@mpd-dsh/mpd");
  const page = harness.require("@mpd-dsh/team-page");
  harness.provideSidebar();
  return {
    harness, page, responses,
    apply: () => { mpd.apply(harness.ctx); },
    restore: () => { globalThis.fetch = saved; page.__resetTeamPageForTests(); },
  };
}

/**
 * Render the tab component until quiescent, returning the rendered tree + the props used.
 * The runtime MUST be the harness's own (`client.harness.hooks`): the module's `react` is
 * the instance the harness injected through `require("react")`, so a second runtime would
 * collect no effects at all and the page would never start polling.
 */
async function renderTab(client) {
  const tab = client.harness.calls.registerTab.find((descriptor) => descriptor.id === "mpd-agent-teams");
  const props = { ctx: client.harness.ctx, scope: { sessionId: "s1" }, tab: {}, visible: true, store: undefined };
  const element = tab.component(props);
  const tree = await client.harness.hooks.render(element.type, props);
  return { tree, props, element };
}
const children = (tree) => (Array.isArray(tree.props.children) ? tree.props.children.filter((child) => child !== null && child !== undefined) : [tree.props.children]);
function findByAttr(node, attr, out = []) {
  if (node === null || typeof node !== "object") return out;
  if (node.props && node.props[attr] !== undefined) out.push(node);
  for (const child of children(node)) findByAttr(child, attr, out);
  return out;
}

const started = new Date().toISOString();
const result = { task: "w5", surface: "web", producedBy: "Lead", startedAt: started, checks: [], invariants: {}, pending: {} };
try {
  seedStore();
  const adoptedStatusAtStart = execFileSync("git", ["status", "--porcelain", "--", "packages/mpd-agent-teams-plugin"], { cwd: REPO, encoding: "utf8" }).trim();
  const { routes, registered } = captureRoutes();
  check("route-registered", registered.state === true && registered.ack === true && routes.has(STATE_URL.split("?")[0]) && routes.has(ACK_URL),
    `state=${String(registered.state)} ack=${String(registered.ack)} paths=${[...routes.keys()].join(",")}`);
  const stateHandler = routes.get("/plugins/mpd-team-watchdog/state");
  const ackHandler = routes.get(ACK_URL);

  // S1 — the payload the panel consumes, straight from the REAL route.
  const firstRes = callRoute(stateHandler, fakeReq(STATE_URL));
  const payload = JSON.parse(firstRes.body);
  writeFileSync(join(HERE, "raw", "state-before-ack.json"), JSON.stringify(payload, null, 2) + "\n");
  result.pending.payloadBefore = payload;
  check("S1-route-payload", firstRes.status === 200 && payload.reader === READER && payload.stuck === true && payload.banner !== null && payload.replay === true,
    `status=${firstRes.status} reader=${payload.reader} stuck=${String(payload.stuck)} replay=${String(payload.replay)} banner=${payload.banner === null ? "null" : payload.banner.kind + "/" + payload.banner.teamId}`);
  check("S1-banner-fields", payload.banner.incidentId === "inc-1" && payload.banner.holdId === "hold-alpha-1" && payload.banner.cause === "silence for 120000 ms" && payload.banner.taskId === "t9",
    `incident=${payload.banner.incidentId} hold=${payload.banner.holdId} cause=${payload.banner.cause}`);
  check("S1-one-activity-record", Array.isArray(payload.activity) && payload.activity.length === 1 && payload.activity[0].id === "inc-1" && payload.activity[0].ackRequired === true && payload.activity[0].label === "escalated",
    `activity=${payload.activity.length} id=${payload.activity[0] && payload.activity[0].id} ackRequired=${String(payload.activity[0] && payload.activity[0].ackRequired)}`);

  // S2/S3 — the client: first poll (no user action) + the wired render.
  const client = mountClient();
  client.responses[STATE_URL] = payload;
  client.apply();
  const first = await renderTab(client);
  writeFileSync(join(HERE, "raw", "render-tree-before-ack.json"), JSON.stringify(first.tree, (key, value) => (key === "onClick" || key === "onNavigate" || key === "t" ? "[fn]" : value), 2) + "\n");
  const fetchedWatchdog = client.harness.calls.fetched.filter((entry) => entry.url === STATE_URL);
  check("S2-first-poll-replays", fetchedWatchdog.length >= 1,
    `watchdog fetches without user action = ${fetchedWatchdog.length} (url=${STATE_URL})`);
  const storeSlice = client.page.__watchdogState();
  check("S3-state-reached-render", storeSlice.payload !== null && storeSlice.payload !== undefined && storeSlice.payload.banner !== null,
    `store.slice.payload.banner=${storeSlice.payload === null || storeSlice.payload === undefined ? "null" : String(storeSlice.payload.banner && storeSlice.payload.banner.kind)} (props passed to the render: ${Object.keys(first.props).join(",")})`);
  const root = first.tree;
  const topChild = children(root)[0];
  check("S3-banner-is-top-child", root.props["data-watchdog-stuck"] === "1" && topChild.props["data-watchdog-banner"] === "incident" && topChild.props["data-watchdog-cause"] === "silence for 120000 ms" && topChild.props["data-watchdog-reader"] === READER && topChild.props["data-watchdog-replay"] === "1",
    `children[0].data-watchdog-banner=${String(topChild.props["data-watchdog-banner"])} cause=${String(topChild.props["data-watchdog-cause"])} team=${String(topChild.props["data-watchdog-team"])} reader=${String(topChild.props["data-watchdog-reader"])}`);
  const records = findByAttr(root, "data-watchdog-activity");
  check("S3-activity-record-rendered", records.length === 1 && records[0].props["data-watchdog-activity"] === "inc-1" && records[0].props["data-watchdog-kind"] === "escalate" && records[0].props["data-watchdog-ack-required"] === "1",
    `records=${records.length} id=${records[0] && records[0].props["data-watchdog-activity"]} kind=${records[0] && records[0].props["data-watchdog-kind"]}`);

  // S4 — the REAL acknowledge route: byte-level watermark proof.
  const wmPath = join(WS, STATE_DIR, "watchdog", "read-watermark.json");
  const beforeText = bytesOf(wmPath);
  const afterRes = await callRouteAsync(ackHandler, fakeReq(ACK_URL, { reader: READER, incidentTs: T1, workspace: WS }));
  const afterBody = JSON.parse(afterRes.body);
  const afterText = bytesOf(wmPath);
  writeFileSync(join(HERE, "raw", "watermark-before.json"), beforeText);
  writeFileSync(join(HERE, "raw", "watermark-after.json"), afterText);
  const afterMap = JSON.parse(afterText);
  check("S4-ack-advances-watermark", afterRes.status === 200 && afterBody.ok === true && afterBody.before === 0 && afterBody.after === T1 && afterMap[READER] === T1,
    `status=${afterRes.status} ok=${String(afterBody.ok)} before=${String(afterBody.before)} after=${String(afterBody.after)} file[reader]=${String(afterMap[READER])}`);
  check("S4-watermark-bytes-changed", beforeText !== afterText && sha(beforeText) !== sha(afterText),
    `before sha=${sha(beforeText).slice(0, 16)} (${Buffer.byteLength(beforeText)} B) after sha=${sha(afterText).slice(0, 16)} (${Buffer.byteLength(afterText)} B)`);
  check("S4-other-reader-preserved", afterMap["tui-panel"] === 5,
    `other reader key kept: tui-panel=${String(afterMap["tui-panel"])}`);
  result.invariants.watermark = { path: wmPath, beforeSha256: sha(beforeText), afterSha256: sha(afterText), beforeBytes: Buffer.byteLength(beforeText), afterBytes: Buffer.byteLength(afterText), beforeText, afterText };

  // S5 — after the acknowledge the next poll replays NOTHING (server-side truth).
  const afterAckPayload = JSON.parse(callRoute(stateHandler, fakeReq(STATE_URL)).body);
  writeFileSync(join(HERE, "raw", "state-after-ack.json"), JSON.stringify(afterAckPayload, null, 2) + "\n");
  client.responses[STATE_URL] = afterAckPayload;
  const polled = await client.page.__watchdogPoll();
  const second = await renderTab(client);
  const secondTop = children(second.tree)[0];
  const secondRecords = findByAttr(second.tree, "data-watchdog-activity");
  check("S5-replay-stops-after-ack", afterAckPayload.replay === false && afterAckPayload.unread.length === 0 && afterAckPayload.activity.length === 0 && polled.payload.replay === false && afterAckPayload.stuck === true && secondRecords.length === 0 && secondTop.props["data-watchdog-banner"] === "hold" && secondTop.props["data-watchdog-incident"] === "",
    `payload.replay=${String(afterAckPayload.replay)} unread=${JSON.stringify(afterAckPayload.unread)} activity=${afterAckPayload.activity.length} renderedRecords=${secondRecords.length} bannerNow=${String(secondTop.props["data-watchdog-banner"])} (the incident replay stopped; the DURABLE hold still reports the team as paused)`);
  // The banner is durable state, not a replay artifact: with the hold resumed (sidecar gone)
  // the same reader sees no banner at all on the next poll.
  rmSync(join(WS, STATE_DIR, "watchdog", "hold", "alpha.json"), { force: true });
  const resumedPayload = JSON.parse(callRoute(stateHandler, fakeReq(STATE_URL)).body);
  writeFileSync(join(HERE, "raw", "state-after-resume.json"), JSON.stringify(resumedPayload, null, 2) + "\n");
  client.responses[STATE_URL] = resumedPayload;
  await client.page.__watchdogPoll();
  const resumed = await renderTab(client);
  const resumedTop = children(resumed.tree)[0];
  check("S5-banner-is-durable-state", resumedPayload.stuck === false && resumedPayload.banner === null && resumed.tree.props["data-watchdog-stuck"] === "0" && resumedTop.props["data-watchdog-banner"] === undefined,
    `after the hold sidecar was removed: stuck=${String(resumedPayload.stuck)} banner=${String(resumedPayload.banner)} renderedTopChild=${String(resumedTop.type)}`);
  client.restore();

  // S6 — a fresh load ("restart") on the same store: the acked incident stays quiet.
  const restart = mountClient();
  restart.responses[STATE_URL] = resumedPayload;
  restart.apply();
  const restarted = await renderTab(restart);
  const restartTop = children(restarted.tree)[0];
  check("S6-restart-no-replay", restarted.tree.props["data-watchdog-stuck"] === "0" && restartTop.props["data-watchdog-banner"] === undefined && findByAttr(restarted.tree, "data-watchdog-activity").length === 0,
    `restart stuck=${String(restarted.tree.props["data-watchdog-stuck"])} topChild=${String(restartTop.type === "header" ? "header" : restartTop.type)} (the acknowledged incident does not replay; the hold was resumed separately)`);
  restart.restore();

  // S7 — a NEW unacknowledged incident replays on the next start, with no user action.
  appendIncident(warn2);
  const newPayload = JSON.parse(callRoute(stateHandler, fakeReq(STATE_URL)).body);
  writeFileSync(join(HERE, "raw", "state-new-incident.json"), JSON.stringify(newPayload, null, 2) + "\n");
  const nextStart = mountClient();
  nextStart.responses[STATE_URL] = newPayload;
  nextStart.apply();
  const nextTree = await renderTab(nextStart);
  const nextTop = children(nextTree.tree)[0];
  const nextRecords = findByAttr(nextTree.tree, "data-watchdog-activity");
  check("S7-new-incident-replays", newPayload.unread.length === 1 && newPayload.banner !== null && newPayload.banner.incidentId === "inc-2" && nextTree.tree.props["data-watchdog-stuck"] === "1" && nextTop.props["data-watchdog-banner"] === "incident" && nextRecords.length === 1 && nextRecords[0].props["data-watchdog-activity"] === "inc-2",
    `unread=${JSON.stringify(newPayload.unread)} banner=${newPayload.banner === null ? "null" : newPayload.banner.incidentId} top=${String(nextTop.props["data-watchdog-banner"])} records=${nextRecords.length}`);
  nextStart.restore();

  // S8 — THIS pass edited nothing under the adopted package. The tree already carries w7's
  // in-flight delta work, so the proof is a before/after comparison of the same measurement
  // (an edit by this pass would change it), recorded verbatim rather than asserted empty.
  const adoptedStatus = execFileSync("git", ["status", "--porcelain", "--", "packages/mpd-agent-teams-plugin"], { cwd: REPO, encoding: "utf8" }).trim();
  check("S8-adopted-plugin-untouched", adoptedStatus === adoptedStatusAtStart,
    `before=${JSON.stringify(adoptedStatusAtStart)} after=${JSON.stringify(adoptedStatus)} (identical; the pre-existing entries are w7's delta regions, not this pass)`);
  result.invariants.adoptedPluginGitStatus = { atStart: adoptedStatusAtStart, atEnd: adoptedStatus, identical: adoptedStatus === adoptedStatusAtStart };

  // An explicit negative control: the SAME client with a 404ing watchdog route shows NO banner.
  const control = mountClient();
  control.apply();
  const controlTree = await renderTab(control);
  check("negative-control-no-route", controlTree.tree.props["data-watchdog-stuck"] === "0" && children(controlTree.tree)[0].props["data-watchdog-banner"] === undefined,
    "with no watchdog payload the panel renders exactly the pre-banner shape (banner absent, not empty-stringed)");
  control.restore();
} catch (error) {
  check("driver-threw", false, String(error && error.stack ? error.stack : error));
} finally {
  result.checks = checks;
  result.verdict = checks.every((entry) => entry.status === "passed") ? "passed" : "failed";
  result.finishedAt = new Date().toISOString();
  result.notClaimed = ["a real browser render and a click-driven save — no browser binary exists in this environment; the rendered claims above come from the offline hook runtime driving the REAL built client"];
  delete result.pending;
  writeFileSync(join(HERE, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(`[w5-web] verdict=${result.verdict} checks=${checks.length} failed=${checks.filter((entry) => entry.status !== "passed").length}`);
  if (existsSync(join(HERE, "result.json"))) process.exit(result.verdict === "passed" ? 0 : 1);
}
