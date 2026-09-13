#!/usr/bin/env node
// Case agent-teams-sidebar: prove the AgentTeams GUI is ONE DSH-better-sidebar tab of the
// bundle web client, that the tab reproduces the removed floater's own interior class for
// class, and that the removed surfaces (the top-right activity floater, the in-conversation
// team card, the workmate overlay floater and its footer toggle) can no longer be
// registered by any mpd client source.
//
//   a) the BUILT artifact packages/mpd-bundle-plugin/client.js registers exactly ONE
//      better-sidebar tab for AgentTeams (id mpd-agent-teams, order 85, single) and
//      carries the "@mpd-dsh/team-page" module — asserted twice: textually on an isolated
//      sandbox COPY of the artifact, and by really evaluating that copy in a minimal
//      module-loader + cordis-ctx runtime written by this case (no author harness reuse);
//   a2) VISUAL PARITY: that runtime also RENDERS the registered tab component and asserts
//      the floater's interior — the adopted `panel`/`panelHead`/`panelTitle`/`panelDot`/
//      `panelControls`/`iconButton`/`teams`/`emptyHint` classes, the platform chevron, the
//      dropped window-manager half, and a collapse control that drives the SIDEBAR's store;
//   b) no mpd client SOURCE registers a removed surface: no `agent-teams-activity`
//      definition, no `conversation.chat.node` registration, no `shell.overlay` floater and
//      no `sidebar.footer.action` toggle; the sanctioned `conversation.chat.commandview`
//      admission surface must still be there (so the assertion is provably reading the
//      registration sites and not an empty file);
//   c) the adopted client carries the mpd export bridge (marker region + the pinned
//      export list) in both packages/mpd-agent-teams-plugin/lib/client.js and the built
//      artifact, and scripts/patch-agent-teams-client.mjs is genuinely idempotent
//      (running it must not change a byte of the already-patched adopted client);
//   d) the host route /plugins/dsh-agent-teams/state exists in the MOUNTED server half.
//      Preferred proof: a REAL offline web boot in an isolated sandbox (DSH_HOME + HOME
//      sandboxed, packages symlinked read-only from the installed web profile), fetching
//      the served client bundle AND the state route over HTTP. When that boot is not
//      possible (no `dsh` on PATH / no installed web profile), the case falls back to
//      the plugin row + server-half source assertion and says so in result.json.
//
// Evidence -> evidence/agent-teams/sidebar-migration/<ts>/{result.json,output.log}.
// --self-test is fully offline and never boots anything. Never touches the real ~/.dsh.
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(dirname(dirname(HERE)))
const PORT = Number(process.env.MPD_QA_SIDEBAR_PORT ?? 3194)
const ARTIFACT = join(ROOT, "packages", "mpd-bundle-plugin", "client.js")
const TEAM_PAGE = join(ROOT, "packages", "mpd-bundle-plugin", "src", "team-page.js")
const WEB_CLIENT = join(ROOT, "packages", "mpd-bundle-plugin", "src", "web-client.js")
const ADOPTED_CLIENT = join(ROOT, "packages", "mpd-agent-teams-plugin", "lib", "client.js")
const ADOPTED_MAIN = join(ROOT, "packages", "mpd-agent-teams-plugin", "lib", "index.js")
const PATCH_SCRIPT = join(ROOT, "scripts", "patch-agent-teams-client.mjs")
const BUILD_SCRIPT = join(ROOT, "scripts", "build-mpd-client.mjs")
const PATCH = join(ROOT, "packages", "mpd-bundle", "cordis.patch.yml")
const STATE_ROUTE = "/plugins/dsh-agent-teams/state"
const TEAM_TAB_ID = "mpd-agent-teams"
// Every symbol the sidebar page composes; the bridge must export each one.
const BRIDGE_EXPORTS = [
  "TeamSection", "historicCardTeam", "memberArtUrl", "LEAD_ART", "AGENT_TEAMS_LOCALE_NAMESPACE",
  "zh", "en", "startActivityPolling", "subscribeActivitySnapshots", "getActivitySnapshotsSnapshot",
  "updateActivitySnapshots", "ACTIVITY_POLL_MS", "ACTIVITY_PROBE_MS", "ACTIVITY_STATE_URL",
  "ACTIVITY_HALT_URL", "teamIsActive", "ACTIVITY_PANEL_CSS",
]
// Registration shapes of the two removed surfaces — matched as REGISTRATIONS, never as
// bare mentions, so the explanatory comments in src/web-client.js stay legal. A
// spelling-independent proof also exists: runtimeChecks() really EVALUATES the shipped
// artifact, so a registration hidden behind a renamed local variable (which no pattern
// can see) still shows up in the recorded slot definitions.
const LEGACY_PATTERNS = [
  { label: "floater definition id agent-teams-activity", re: /id:\s*["'`]agent-teams-activity["'`]/ },
  { label: "card slot registration conversation.chat.node", re: /inject\(\s*["'`]conversation\.chat\.node["'`]/ },
  { label: "card slot definition name conversation.chat.node", re: /name:\s*["'`]conversation\.chat\.node["'`]/ },
  { label: "workmate overlay floater", re: /inject\(\s*["'`]shell\.overlay["'`]/ },
  { label: "workmate footer toggle", re: /inject\(\s*["'`]sidebar\.footer\.action["'`]/ },
]

function fail(msg) { console.error("[agent-teams-sidebar] FAIL: " + msg); process.exit(1) }
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
const LOG = []
const say = (line) => { LOG.push(line); console.log(line) }

/** Minimal module-loader runtime: enough to evaluate the shipped client factories. */
function loadFactories(artifactSource) {
  const factories = new Map()
  const window = {
    __ModuleLoader__: {
      load: (registration) => factories.set(registration.id, registration.factory),
      create: () => ({ manifest: { plugins: [] } }),
      prefetch: async () => {},
    },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  }
  // eslint-disable-next-line no-new-func
  new Function("window", artifactSource)(window)
  return factories
}

/**
 * The adopted CSS-module class map the page composes. Real class NAMES, because visual
 * parity is the binding requirement: `panelsUseAdoptedClasses` proves the page renders
 * the floater's own classes instead of inventing wrappers.
 */
const LAYOUT_CLASS_MAP = {
  panel: "aYQbCq_panel",
  panelHead: "aYQbCq_panelHead",
  panelTitle: "aYQbCq_panelTitle",
  panelDot: "aYQbCq_panelDot",
  panelControls: "aYQbCq_panelControls",
  iconButton: "aYQbCq_iconButton",
  teams: "aYQbCq_teams",
  emptyHint: "aYQbCq_emptyHint",
  archivedWrap: "aYQbCq_archivedWrap",
  archiveLabel: "aYQbCq_archiveLabel",
}

/**
 * Faithful-enough adopted-module stub: the tab-registration path only reads the pinned
 * bridge surface, so every pinned name is present and unknown reads are recorded instead
 * of silently producing fixtures (page RENDERING is pinned by team-page.test.mjs).
 */
function createAdoptedStub(reads) {
  const base = {
    inject: [],
    apply: () => { reads.adoptedApply = true },
    TeamSection: (props) => ({ type: "section", props }),
    historicCardTeam: () => undefined,
    memberArtUrl: () => undefined,
    LEAD_ART: "lead-art",
    ACTIVITY_PANEL_CSS: LAYOUT_CLASS_MAP,
    AGENT_TEAMS_LOCALE_NAMESPACE: "agentTeams",
    zh: { "activity.title": "AgentTeams 活动", "activity.empty": "暂无团队活动" },
    en: { "activity.title": "AgentTeams activity", "activity.empty": "No team activity", "activity.panelAria": "AgentTeams activity panel", "activity.collapse": "Collapse activity panel" },
    teamIsActive: () => false,
    getActivitySnapshotsSnapshot: () => ({ teams: [], archivedTeams: [] }),
    subscribeActivitySnapshots: () => () => {},
    updateActivitySnapshots: () => ({ teams: [], archivedTeams: [] }),
    startActivityPolling: () => ({ firstTick: Promise.resolve(), stop() {} }),
    ACTIVITY_POLL_MS: 1000,
    ACTIVITY_PROBE_MS: 1000,
    ACTIVITY_STATE_URL: STATE_ROUTE,
    ACTIVITY_HALT_URL: "/plugins/dsh-agent-teams/halt",
  }
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop]
      reads.unknownAdoptedReads.push(String(prop))
      return () => undefined
    },
  })
}

/** Mount the shipped client half against a recording ctx and report what it registered. */
function mountClient(factories) {
  const calls = { registerTab: [], slots: [], slotsRegistered: [], locale: [], effects: [], openTab: [] }
  const sidebarService = {
    registerTab: (descriptor) => { calls.registerTab.push(descriptor); return () => {} },
    registerFileViewer: () => () => {},
    openTab: (seed) => { calls.openTab.push(seed) },
    isTabEnabled: () => true,
    getTabs: () => [],
    getSnapshot: () => ({ prefs: { pluginSettings: {} } }),
    subscribeState: () => () => {},
    subscribe: () => () => {},
    version: "0.18.0",
  }
  const reads = { unknownAdoptedReads: [] }
  const adoptedStub = createAdoptedStub(reads)
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {}, useLayoutEffect: () => {}, useCallback: (fn) => fn,
    useMemo: (fn) => fn(), useId: () => "qa-id",
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  const requireMap = {
    react,
    "@nanmicoder/dsh-agent-teams": adoptedStub,
    // The platform icon module the page resolves its collapse glyph from — the same
    // component the adopted panel renders. Stubbed so the parity step can prove the real
    // component is chosen rather than the page's inline fallback.
    "@deepseek-ai/dsh-client-ui-primitives": {
      IconChevronDownOutline14: (props) => ({ type: "svg", props: { ...(props ?? {}), "data-icon": "chevron-down-14" } }),
    },
  }
  const cache = new Map()
  const require = (name) => {
    if (cache.has(name)) return cache.get(name)
    if (name in requireMap) { cache.set(name, requireMap[name]); return requireMap[name] }
    const factory = factories.get(name)
    if (factory === undefined) throw new Error("case loader: unexpected require(" + name + ")")
    const value = factory(require)
    cache.set(name, value)
    return value
  }
  // Injection fibers, as cordis schedules them: `betterSidebar` is provided by ANOTHER
  // plugin's fiber AFTER this entry applies, so the case publishes it explicitly — that race
  // is the live failure this case must be able to reproduce.
  const services = {}
  const pending = []
  const wake = () => {
    for (const entry of [...pending]) {
      if (!entry.deps.every((dep) => services[dep] !== undefined)) continue
      pending.splice(pending.indexOf(entry), 1)
      entry.cb(ctx)
    }
  }
  const ctx = {
    get: (name) => services[name],
    provide: (name, value) => { services[name] = value; wake(); return () => {} },
    effect: (fn) => { calls.effects.push(1); const disposer = fn(); return typeof disposer === "function" ? disposer : () => {} },
    on: () => () => {},
    inject: (deps, cb) => {
      const entry = { deps: [...deps], cb }
      pending.push(entry)
      wake()
      return { dispose: () => { const at = pending.indexOf(entry); if (at >= 0) pending.splice(at, 1) } }
    },
    slots: {
      inject: (key, cb) => { calls.slots.push(key); cb(); return () => {} },
      register: (definition) => { calls.slotsRegistered.push(definition); return () => {} },
    },
    locale: { register: (namespace) => { calls.locale.push(namespace); return () => {} } },
  }
  const exports_ = require("@mpd-dsh/mpd")
  exports_.apply(ctx)
  // The sidebar appears AFTERWARDS, exactly like the live boot.
  ctx.provide("betterSidebar", sidebarService)
  return { calls, exports: exports_, reads, adoptedStub, factories, ctx, sidebarService }
}

/** Checks (a)+(b)+(c) against an artifact TEXT and the repo sources. Side-effect free. */
function runtimeChecks(artifactText, factories) {
  const steps = {}
  const ids = [...factories.keys()]
  steps.moduleIds = {
    ok: ["@nanmicoder/dsh-agent-teams", "@mpd-dsh/team-page", "@mpd-dsh/mpd"].every((id) => ids.includes(id)),
    ids,
  }
  steps.teamPageModuleInArtifact = { ok: artifactText.includes('id: "@mpd-dsh/team-page"') }

  const client = mountClient(factories)
  const teamTabs = client.calls.registerTab.filter((descriptor) => descriptor.id === TEAM_TAB_ID)
  const teamTab = teamTabs[0]
  steps.exactlyOneTeamTab = {
    ok: teamTabs.length === 1 && client.calls.registerTab.length === 2,
    teamTabIds: teamTabs.map((descriptor) => descriptor.id),
    allTabIds: client.calls.registerTab.map((descriptor) => descriptor.id),
  }
  steps.teamTabShape = {
    ok: Boolean(teamTab)
      && teamTab.single === true
      && teamTab.order === 85
      && typeof teamTab.component === "function"
      && typeof teamTab.title === "function"
      && teamTab.title() === "AgentTeams"
      && typeof teamTab.createTab === "function"
      && teamTab.createTab().tab.type === TEAM_TAB_ID
      && Array.isArray(teamTab.settings?.pluginToggles)
      && teamTab.settings.pluginToggles[0]?.key === "autoOpenOnTeamActivity"
      && teamTab.settings.pluginToggles[0]?.type === "switch",
    order: teamTab?.order, single: teamTab?.single, toggle: teamTab?.settings?.pluginToggles?.[0]?.key,
  }
  // Auto-open must carry NO content seed. dsh-better-sidebar >= 0.19 routes any seed
  // holding `path`/`url` to DSH's NATIVE right column (`surface.openResource(
  // fileAddress(sessionId, cwd, path))`) instead of this registered tab type, so the
  // throwaway marker this call used to carry ("team-activity") made the host resolve
  // `<cwd>/team-activity`, fail `realpath` with ENOENT and raise
  // `cannot resolve target "<cwd>/team-activity"` into the GUI — without ever opening
  // the tab. A type-only seed lands the tab in its own surface and expands it.
  steps.seedlessAutoOpen = {
    ok: !artifactText.includes("AUTO_OPEN_SEED_PATH")
      && artifactText.includes("openTab({ type: TEAM_TAB_ID })")
      && !/openTab\(\{[^}]*\bpath:/.test(artifactText),
    call: (artifactText.match(/openTab\(\{[^)]*\)/) ?? [""])[0].slice(0, 90),
  }
  const definitions = client.calls.slotsRegistered
  // No removed surface is REGISTERED, and no floating fallback is contributed: BOTH GUIs
  // have exactly one host (their sidebar tab) by the user's decision.
  steps.noLegacyRegistration = {
    ok: !definitions.some((definition) => definition.id === "agent-teams-activity")
      && !definitions.some((definition) => definition.name === "conversation.chat.node")
      && !client.calls.slots.includes("shell.overlay")
      && !client.calls.slots.includes("sidebar.footer.action"),
    registeredDefinitions: definitions.map((definition) => definition.id ?? definition.name),
  }
  // The adopted client half must never be applied: its apply() is what registered both
  // removed surfaces. `agent-teams-activity` in the artifact TEXT is expected (the adopted
  // bundle is embedded verbatim for its views/strings) — it must stay UNREGISTERED.
  steps.adoptedNeverApplied = {
    ok: client.reads.adoptedApply === undefined,
    artifactStillContainsAdoptedStrings: artifactText.includes("agent-teams-activity"),
  }
  const overlayDefinitions = definitions.filter((definition) => definition.id === "agent-teams-activity")
  steps.noFloaterDefined = { ok: overlayDefinitions.length === 0 }
  steps.commandViewKept = {
    ok: client.calls.slots.filter((key) => key === "conversation.chat.commandview").length === 1
      && definitions.some((definition) => definition.name === "conversation.chat.commandview"),
    slots: client.calls.slots,
  }
  steps.panelInteriorParity = panelInteriorParity(client, teamTab)
  return { steps, client }
}

/**
 * VISUAL PARITY, measured on the SHIPPED page: render the registered tab component and
 * assert it reproduces the removed floater's own interior — the `aside` root carrying the
 * adopted `panel` class (which is where the `--dsw-alias-*` custom properties every
 * adopted rule reads are declared), the head with title + busy dot + collapse control,
 * the `teams` scroll body, and the floater's own empty hint. A page that invents its own
 * wrapper renders every team/member/task rule unstyled, which is exactly the regression
 * this step exists to catch.
 */
function panelInteriorParity(client, teamTab) {
  const css = LAYOUT_CLASS_MAP
  const reduced = []
  const store = { reduce: (reducer) => { reduced.push(reducer); return reducer({ panelOpen: true }) } }
  let tree
  try {
    // `component` is a thin element wrapper around TeamPageView; render it like React
    // would (this harness records elements and never recurses into components).
    const element = teamTab.component({ ctx: client.ctx, scope: { sessionId: "qa-session" }, tab: {}, visible: true, store })
    tree = typeof element.type === "function" ? element.type(element.props) : element
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) }
  }
  // This harness records every child slot as an array (React collapses a single child),
  // so unwrap one-child arrays until real markup is reached.
  const only = (children) => {
    let current = children
    while (Array.isArray(current) && current.length === 1) current = current[0]
    return current
  };
  const children = Array.isArray(tree?.props?.children) ? tree.props.children : [];
  const [head, teamsBody] = children;
  const headChildren = Array.isArray(head?.props?.children) ? head.props.children : [];
  const [title, controls] = headChildren;
  const titleChildren = Array.isArray(title?.props?.children) ? title.props.children : [];
  const collapseButton = only(controls?.props?.children);
  const glyph = only(collapseButton?.props?.children);
  const glyphType = typeof glyph?.type === "function" ? glyph.type(glyph.props)?.type : glyph?.type;
  const emptyHint = only(teamsBody?.props?.children);
  // Reading the class names through the adopted map is the point: these strings exist only
  // in the adopted stylesheet, so matching them proves the page composes the real views.
  const observed = {
    root: tree?.props?.className,
    head: head?.props?.className,
    title: title?.props?.className,
    dot: titleChildren[1]?.props?.className,
    controls: controls?.props?.className,
    collapse: collapseButton?.props?.className,
    teams: teamsBody?.props?.className,
    empty: emptyHint?.props?.className,
    panelMarker: tree?.props?.["data-agent-teams-activity"],
    emptyMarker: emptyHint?.props?.["data-agent-teams-empty"],
    glyph: typeof glyphType === "function" ? glyphType.name : String(glyphType),
  }
  const expected = {
    root: css.panel, head: css.panelHead, title: css.panelTitle, dot: css.panelDot,
    controls: css.panelControls, collapse: css.iconButton, teams: css.teams, empty: css.emptyHint,
  }
  const mismatched = Object.entries(expected).filter(([key, want]) => observed[key] !== want).map(([key]) => key)
  // Sidebar pane owns the box: the floater's absolute positioning / floating frame is gone.
  const style = tree?.props?.style ?? {}
  const windowManagerDropped = style.position === "relative" && style.border === "none"
    && style.boxShadow === "none" && style.background === "transparent"
  // The collapse control must drive the SIDEBAR's own panel state, not a page-local flag.
  if (typeof collapseButton?.props?.onClick === "function") collapseButton.props.onClick()
  const storeReduced = reduced.length === 1 && reduced[0]({ panelOpen: true }).panelOpen === false
  return {
    ok: mismatched.length === 0 && observed.panelMarker === true && observed.emptyMarker === true
      && observed.glyph === "IconChevronDownOutline14" && windowManagerDropped && storeReduced,
    mismatched, observed, windowManagerDropped, storeReduced,
  }
}

function sourceChecks() {
  const steps = {}
  const sources = { "src/web-client.js": readFileSync(WEB_CLIENT, "utf8"), "src/team-page.js": readFileSync(TEAM_PAGE, "utf8") }
  const hits = []
  for (const [name, text] of Object.entries(sources)) {
    for (const pattern of LEGACY_PATTERNS) {
      if (pattern.re.test(text)) hits.push(name + ": " + pattern.label)
    }
  }
  steps.sourcesRegisterNoRemovedSurface = { ok: hits.length === 0, hits }
  steps.commandViewStillRegisteredBySource = {
    ok: /conversation\.chat\.commandview/.test(sources["src/web-client.js"]),
  }
  const buildScript = readFileSync(BUILD_SCRIPT, "utf8")
  // The build gate is the shipping-time guard: it must name EVERY removed surface, so a
  // reintroduced registration fails the build rather than the browser.
  steps.buildGatePresent = {
    ok: buildScript.includes("LEGACY_SURFACES")
      && ['id: "agent-teams-activity"', 'inject("conversation.chat.node"', 'inject("shell.overlay"', 'inject("sidebar.footer.action"']
        .every((needle) => buildScript.includes(needle)),
  }
  const patch = readFileSync(PATCH, "utf8")
  steps.serverHalfMountedByRow = {
    ok: patch.includes("packages/mpd-agent-teams-plugin/lib/index.js")
      && readFileSync(ADOPTED_MAIN, "utf8").includes("path: '/plugins/dsh-agent-teams/state'"),
    note: "row mounted by the bundle patch + server half registering the route",
  }
  return steps
}

function bridgeChecks(artifactText) {
  const steps = {}
  const region = (text) => {
    const start = text.indexOf("//#region mpd-export-bridge")
    const end = text.indexOf("//#endregion mpd-export-bridge")
    return start === -1 || end === -1 ? null : text.slice(start, end)
  }
  const adoptedRegion = region(readFileSync(ADOPTED_CLIENT, "utf8"))
  const artifactRegion = region(artifactText)
  // Each pinned symbol must be an explicit re-export, not merely mentioned somewhere.
  const missing = (text) => BRIDGE_EXPORTS.filter((name) => !new RegExp("exports\\." + name + "\\s*=").test(text))
  steps.adoptedClientBridged = {
    ok: adoptedRegion !== null && missing(adoptedRegion).length === 0,
    missing: adoptedRegion === null ? BRIDGE_EXPORTS : missing(adoptedRegion),
  }
  steps.artifactCarriesBridge = {
    ok: artifactRegion !== null && missing(artifactRegion).length === 0,
    missing: artifactRegion === null ? BRIDGE_EXPORTS : missing(artifactRegion),
  }
  const patchScript = readFileSync(PATCH_SCRIPT, "utf8")
  steps.bridgePatchGuarded = {
    ok: patchScript.includes("//#region mpd-export-bridge") && /endregion mpd-export-bridge/.test(patchScript),
  }
  return steps
}

function selfTest() {
  const artifactText = readFileSync(ARTIFACT, "utf8")
  const runtime = runtimeChecks(artifactText, loadFactories(artifactText)).steps
  const steps = { ...runtime, ...sourceChecks(), ...bridgeChecks(artifactText) }
  const bad = Object.entries(steps).filter(([, value]) => value.ok !== true).map(([name]) => name)
  if (bad.length) fail("self-test: " + bad.join(" | ") + " :: " + JSON.stringify(steps))
  console.log("[agent-teams-sidebar self-test] ok: " + Object.keys(steps).length + " checks ("
    + steps.exactlyOneTeamTab.allTabIds.join(",") + "; " + steps.moduleIds.ids.join(",") + ")")
}

/** Bridge idempotency: an already-patched adopted client must not change by one byte. */
function bridgeIdempotency(sandbox) {
  const before = sha(ADOPTED_CLIENT)
  const backup = join(sandbox, "adopted-client.js.before")
  copyFileSync(ADOPTED_CLIENT, backup)
  const run = spawnSync(process.execPath, [PATCH_SCRIPT], { cwd: ROOT, encoding: "utf8" })
  const after = sha(ADOPTED_CLIENT)
  if (after !== before) copyFileSync(backup, ADOPTED_CLIENT)
  return {
    ok: run.status === 0 && after === before,
    exit: run.status,
    output: ((run.stdout ?? "") + (run.stderr ?? "")).trim().slice(0, 400),
    restored: after !== before,
  }
}

/**
 * Real host-route proof: boot the bundle's web half offline in a sandbox and ask the
 * running server for the served client bundle and the agent-teams state route.
 */
async function bootProbe(sandbox, artifactText) {
  const realProfileNodeModules = join(homedir(), ".dsh", "profiles", "web", "node_modules")
  const credentials = join(homedir(), ".dsh", ".credentials.yaml")
  const needed = ["@deepseek-ai", "@linxin666", "dsh-better-sidebar"].map((name) => join(realProfileNodeModules, name))
  const missing = needed.filter((path) => !existsSync(path))
  if (spawnSync("dsh", ["--version"], { encoding: "utf8" }).status !== 0) {
    return { ok: false, mode: "source-and-row", skipped: "dsh binary not on PATH" }
  }
  if (missing.length > 0) {
    return { ok: false, mode: "source-and-row", skipped: "installed web profile packages absent: " + missing.join(", ") }
  }
  const home = join(sandbox, "dsh-home")
  const userHome = join(sandbox, "user-home")
  const profile = join(home, "profiles", "w")
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(join(home, ".agent-presets"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  for (const name of ["@deepseek-ai", "@linxin666", "dsh-better-sidebar"]) {
    symlinkSync(join(realProfileNodeModules, name), join(profile, "node_modules", name))
  }
  symlinkSync(ROOT, join(profile, "node_modules", "@mpd-dsh", "mpd"))
  if (existsSync(credentials)) cpSync(credentials, join(home, ".credentials.yaml"))
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-w", private: true, dependencies: { "@mpd-dsh/mpd": "link:" + ROOT },
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@linxin666/dsh-web-all", "@mpd-dsh/mpd"] } },
  }, null, 2))
  const log = join(home, "web.log")
  const fd = openSync(log, "w")
  // Workspace isolation: the web boot's session workspace is its cwd, so it must be a
  // sandbox dir — never the real checkout (DSH_HOME/HOME do not cover workspace state).
  const ws = sandboxWorkspace(sandbox)
  const web = spawn("dsh", ["--profile", "w", "--port", String(PORT), "--no-open"], {
    env: { ...process.env, DSH_HOME: home, HOME: userHome }, cwd: ws, stdio: ["ignore", fd, fd],
  })
  const base = "http://127.0.0.1:" + PORT
  const result = { ok: false, mode: "real-boot", dshHome: home, userHome, port: PORT }
  try {
    let token = null
    const deadline = Date.now() + 75000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const match = readFileSync(log, "utf8").match(/token=([A-Za-z0-9_-]+)/)
      if (match) { token = match[1]; break }
    }
    if (token === null) {
      result.skipped = "web boot never printed a token within 75s"
      return result
    }
    const authorize = await fetch(base + "/?token=" + token, { redirect: "manual" })
    const cookie = (authorize.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ")
    const index = await fetch(base + "/", { headers: cookie ? { cookie } : {} })
    const html = await index.text()
    const urls = [...new Set([...html.matchAll(/\/plugins\/[^\s"'<>\\]*client\.js[^\s"'<>\\]*/g)].map((match) => match[0]))]
    // Prefer the single-id URL for our entry; a combined batch URL is accepted as a
    // fallback, but it is not what the browser requests for this plugin alone.
    const own = urls
      .filter((url) => decodeURIComponent(url).includes("@mpd-dsh/mpd"))
      .sort((left, right) => Number(left.includes(",@")) - Number(right.includes(",@")))
    let served = null
    for (const url of own) {
      const response = await fetch(base + url, { headers: cookie ? { cookie } : {} })
      const body = await response.text()
      if (response.status !== 200) continue
      if (served === null || body.length < served.bytes) {
        served = {
          url,
          status: response.status,
          bytes: body.length,
          teamPageModule: body.includes('id: "@mpd-dsh/team-page"'),
          teamTabId: body.includes('TEAM_TAB_ID = "mpd-agent-teams"'),
          bridge: body.includes("//#region mpd-export-bridge"),
          atLeastRepoArtifactBytes: body.length >= artifactText.length,
          carriesRepoArtifact: body.includes(artifactText.slice(0, 512).trim().slice(0, 200)),
        }
      }
      if (!url.includes(",@")) break
    }
    // The state route is INSIDE the host's browser-authentication fence (the
    // adopted 0.1.16-rc.3 web-routes boundary): an unauthenticated request must
    // be rejected and the browser's own cookie session must still be served, so
    // the sidebar page keeps its data feed.
    const anonymous = await fetch(base + STATE_ROUTE, { signal: AbortSignal.timeout(8000) })
    const stateResponse = await fetch(base + STATE_ROUTE, { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(8000) })
    const stateBody = await stateResponse.text()
    let parsed = null
    try { parsed = JSON.parse(stateBody) } catch { /* reported as-is */ }
    result.servedClient = served
    result.stateRoute = {
      status: stateResponse.status,
      anonymousStatus: anonymous.status,
      gated: anonymous.status === 401 || anonymous.status === 403,
      body: stateBody.slice(0, 200),
      teamsArray: Array.isArray(parsed?.teams),
    }
    result.bootLogTail = readFileSync(log, "utf8").split("\n").slice(-8).join("\n")
    result.ok = served !== null && served.teamPageModule && served.teamTabId && served.bridge && served.atLeastRepoArtifactBytes === true
      && result.stateRoute.status === 200 && result.stateRoute.teamsArray && result.stateRoute.gated
    // Isolation: the booted home lives inside the sandbox, never in the real DSH home.
    result.realHomeUntouched = home.startsWith(sandbox) && !home.startsWith(join(homedir(), ".dsh"))
    result.realHome = join(homedir(), ".dsh")
    // Falsifiable workspace-isolation proof: no session-store key may carry the real
    // checkout as its workspace (DSH_HOME/HOME isolation does not cover that).
    try { result.sessionsSandboxed = assertSessionsSandboxed(home, sandbox, { label: "agent-teams-sidebar" }) }
    catch (error) { result.sessionsSandboxed = { ok: false, error: String(error?.message ?? error) } }
  } finally {
    web.kill("SIGTERM")
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return result
}

async function runReal() {
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(ROOT, "evidence", "agent-teams", "sidebar-migration", ts)
  mkdirSync(outDir, { recursive: true })
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-atsb-"))
  const artifactCopy = join(sandbox, "client.js")
  copyFileSync(ARTIFACT, artifactCopy)

  say("[agent-teams-sidebar] ts=" + ts)
  say("sandbox=" + sandbox + " (isolated; the artifact under test is the sandbox COPY)")
  const repoSha = sha(ARTIFACT)
  const copySha = sha(artifactCopy)
  const artifactText = readFileSync(artifactCopy, "utf8")
  const factories = loadFactories(artifactText)

  const steps = { artifactCopyFaithful: { ok: repoSha === copySha, repoSha, copySha, bytes: artifactText.length } }
  Object.assign(steps, runtimeChecks(artifactText, factories).steps)
  Object.assign(steps, sourceChecks())
  Object.assign(steps, bridgeChecks(artifactText))
  steps.bridgePatchIdempotent = bridgeIdempotency(sandbox)
  if (steps.bridgePatchIdempotent.ok === false) {
    steps.bridgePatchIdempotent = { ...steps.bridgePatchIdempotent, restoredFromBackup: steps.bridgePatchIdempotent.restored }
  }

  say("offline artifact steps: " + Object.entries(steps).map(([name, value]) => name + "=" + value.ok).join(" "))

  const boot = await bootProbe(sandbox, artifactText)
  // Workspace isolation (wave 2): a real boot must leave no session-store key for the
  // real checkout. Offline fallback (no boot) has no session store, so it is trivially ok.
  steps.workspaceIsolation = {
    ok: boot.mode === "real-boot" ? boot.sessionsSandboxed?.ok === true : true,
    mode: boot.mode,
    detail: boot.sessionsSandboxed ?? null,
  }
  steps.hostRouteMounted = {
    ok: boot.mode === "real-boot" ? boot.ok === true : steps.serverHalfMountedByRow.ok,
    mode: boot.mode,
    skipped: boot.skipped,
    servedClient: boot.servedClient,
    stateRoute: boot.stateRoute,
    honestNote: boot.mode === "real-boot"
      ? "asserted on a REAL offline web boot: the served @mpd-dsh/mpd client bundle + HTTP state route"
      : "offline web boot NOT performed — asserted from the plugin row + server-half source instead",
  }
  say("host route: mode=" + boot.mode + " ok=" + steps.hostRouteMounted.ok + (boot.skipped ? " skipped=" + boot.skipped : ""))
  if (boot.servedClient) say("  served client: " + JSON.stringify(boot.servedClient).slice(0, 300))
  if (boot.stateRoute) say("  state route: " + JSON.stringify(boot.stateRoute).slice(0, 200))

  const allOk = Object.values(steps).every((step) => step.ok === true)
  const webLog = join(boot.dshHome ?? sandbox, "web.log")
  writeFileSync(join(outDir, "result.json"), JSON.stringify({
    ok: allOk,
    case: "agent-teams-sidebar",
    checkedAt: ts,
    repoRoot: ROOT,
    sandbox,
    artifact: { path: "packages/mpd-bundle-plugin/client.js", sha256: repoSha, bytes: artifactText.length },
    steps,
    realHomeUntouched: boot.realHomeUntouched ?? true,
  }, null, 2))
  writeFileSync(join(outDir, "output.log"), LOG.join("\n") + "\n\n--- web boot log"
    + (existsSync(webLog) ? " (tail) ---\n" + readFileSync(webLog, "utf8").split("\n").slice(-30).join("\n") : ": not attempted ---") + "\n")
  if (existsSync(webLog)) copyFileSync(webLog, join(outDir, "web-boot.log"))
  console.log("[agent-teams-sidebar] ok=" + allOk + " -> " + outDir)
  for (const [name, value] of Object.entries(steps)) console.log("  " + name + ": " + JSON.stringify(value).slice(0, 240))
  if (!allOk) process.exit(1)
  console.log("[agent-teams-sidebar] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else await runReal()
