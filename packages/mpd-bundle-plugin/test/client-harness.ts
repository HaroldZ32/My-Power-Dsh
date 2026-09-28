// Drop-in harness for the bundle's combined web client: it reproduces the parts of
// the DSH client runtime the factory touches (module loader, require map, a minimal
// cordis-like ctx) so the sidebar tab registration and the workmate page can be
// exercised without a browser. Not a shipped artifact — QA reads it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One rendered element's prop bag: children, handlers, styles, data attributes and callbacks. */
export interface ElementProps {
  /** The nested node(s) of this element. */
  children?: TreeNode
  /** The translation function a page component was handed. */
  t?: (key: string, params?: Record<string, string>) => string
  /** The hook-store reader a settings component was handed. */
  useMpdCard?: (selector: (state: unknown) => unknown) => unknown
  /** A controlled input's current value. */
  value?: string
  /** A click handler, when the element is clickable. */
  onClick?: Function
  /** A change handler, when the element is a controlled input. */
  onChange?: Function
  /** A submit handler, when the element is a form. */
  onSubmit?: Function
  /** Whether a control is disabled. */
  disabled?: boolean
  /** A control's placeholder text. */
  placeholder?: string
  /** A label or heading string. */
  label?: string
  /** Inline styles, compared across two spans by the readability arm. */
  style?: Record<string, number>
  /** Any other prop: data attributes and page-specific callbacks. */
  [prop: string]: unknown
}

/** One rendered element record, the shape this harness's own createElement mints. */
export interface ElementNode {
  /** The element's tag name, or the component reference it came from. */
  type?: unknown
  /** The element's identity key, how an arm locates a row. */
  key?: unknown
  /** The element's prop bag. */
  props: ElementProps
  /** Any other field recorded on the element. */
  [field: string]: unknown
}

/** One entry of a children list: an element or a leaf value, never a list. */
export type TreeChild = ElementNode | string | number | null | undefined

/** Any node the offline renderer can produce: one entry, or a list of entries. */
export type TreeNode = TreeChild | TreeNode[]

/** One fixed-order hook slot: a state value, a ref record, a deps key or a subscription. */
export interface HookSlot {
  /** The deps key a useEffect slot re-runs on. */
  key?: string
  /** The value a useRef slot holds. */
  current?: unknown
  /** The unsubscribe a store-subscription slot holds. */
  unsubscribe?: unknown
  /** Any other value a state slot holds. */
  [field: string]: unknown
}

/** The React-shaped API the minimal runtime exposes to a page component. */
export interface HookReact {
  /** Mint one element record. */
  createElement: (type: unknown, props: ElementProps | null | undefined, ...children: TreeNode[]) => ElementNode
  /** A fixed-order state slot whose setter schedules a re-render. */
  useState: (initial: HookSlot | (() => HookSlot)) => [unknown, (next: HookSlot | ((previous: HookSlot | undefined) => HookSlot)) => void]
  /** A fixed-order ref slot, created once and stable afterwards. */
  useRef: (initial: unknown) => HookSlot | undefined
  /** Run an effect when its deps key changes, as React would. */
  useEffect: (fn: () => unknown, deps?: unknown) => void
  /** Return the callback unchanged; the pages only need a stable identity. */
  useCallback: <T>(fn: T) => T
  /** Compute once per slot and return the value. */
  useMemo: <T>(fn: () => T) => T
  /** Subscribe once per slot and re-read the snapshot every render. */
  useSyncExternalStore: (subscribe: (listener: () => void) => unknown, getSnapshot: () => unknown) => unknown
  /** The layout-effect seam, mapped onto useEffect. */
  useLayoutEffect?: (fn: () => unknown, deps?: unknown) => void
  /** A stable id for accessibility wiring. */
  useId?: () => string
}

/** The minimal hook runtime the offline render loop drives. */
export interface HookRuntime {
  /** The React-shaped API handed to a page component. */
  react: HookReact
  /** Clear the slot cursor and the effect queue for a fresh pass. */
  reset: () => void
  /** Take the effects queued since the last pass, clearing the queue. */
  takeEffects: () => Array<() => unknown>
  /** Register a cleanup the runtime runs on teardown. */
  registerCleanup: (fn: Function) => void
  /** Run every registered cleanup, swallowing their errors. */
  runCleanups: () => void
  /** Render a component until its state settles, then return the final tree. */
  render: (Component: Function, props: ElementProps) => Promise<ElementNode>
  /** Re-render a component with an awaited flush, for an update made outside the loop. */
  act: (Component: Function, props: ElementProps) => Promise<ElementNode>
}

/** One fetch the page issued, recorded so the arms can inspect method, URL and body. */
export interface FetchCall {
  /** The requested URL. */
  url: string
  /** The request method, upper-cased by the canned fetch. */
  method: string
  /** The init the caller passed, when it passed one. */
  options?: FetchInit
}

/** The subset of a fetch init the harness records; extra init keys pass through untouched. */
export interface FetchInit {
  /** The request method, defaulted to GET by the canned fetch. */
  method?: string
  /** The serialized request body, when the page posted one. */
  body?: unknown
  /** Any other init field: cache, headers, signal. */
  [key: string]: unknown
}

/** A canned fetch answer: a status flag plus a JSON body thunk. */
export interface CannedResponse {
  /** Whether the status is a 2xx. */
  ok: boolean
  /** The canned status code. */
  status: number
  /** Parse the canned body. */
  json: () => Promise<unknown>
}

/** One sidebar tab descriptor the pages registered. */
export interface TabDescriptor {
  /** The tab's stable id. */
  id: string
  /** Whether the sidebar allows only one instance of the tab. */
  single: boolean
  /** The tab's sort order in the strip. */
  order: number
  /** The strip title, either literal or a thunk resolved per locale. */
  title: string | (() => string)
  /** The plugin toggles the tab declares; absent when the view never auto-opens. */
  settings?: unknown
  /** The page component the sidebar mounts. */
  component: Function
  /** The tab's icon renderer, called with the strip's icon size. */
  icon: (size: number) => unknown
  /** The unread badge count the page publishes for the strip. */
  badge: () => number
  /** Mint a tab instance, as the sidebar's own factory does. */
  createTab: (options: Record<string, unknown>) => { tab: TabDescriptor }
  /** Any other descriptor field. */
  [field: string]: unknown
}

/** The DSH-better-sidebar service double the pages register through. */
export interface SidebarService {
  /** Register one tab; a duplicate id throws, as the real 0.19.1 does. */
  registerTab: (descriptor: TabDescriptor) => () => void
  /** Register a file viewer; the double records it. */
  registerFileViewer: (descriptor: Record<string, unknown>) => () => void
  /** Open a tab with a content seed, recording the request. */
  openTab: (seed: unknown, scope: unknown) => void
  /** Whether a tab id is enabled in this fixture. */
  isTabEnabled: (id: string) => boolean
  /** Every tab this service instance holds, in registration order. */
  getTabs: () => TabDescriptor[]
  /** The tab registered under one id, if any. */
  getTab: (id: string) => TabDescriptor | undefined
  /** The sidebar's own snapshot, which carries the plugin settings. */
  getSnapshot: () => { prefs: { pluginSettings: Record<string, unknown> } }
}

/** One keyed slot registration the host's slot double recorded. */
export interface SlotRegistration {
  /** The slot name the host dispatches on. */
  name: string
  /** The entry id within the slot. */
  id: string
  /** The sort order the host honours. */
  order: number
  /** The label thunk the host calls for the current locale. */
  label: () => string
  /** The locale namespace a translated label resolves through. */
  locale: string
  /** The retired keyed-item field, which must stay absent. */
  key?: unknown
  /** The renderer the host mounts for this entry. */
  component: Function
  /** The face factory the host calls to reach the entry's store and form actions. */
  inject: () => CardFace
  /** Any other descriptor field. */
  [field: string]: unknown
}

/** The face a settings section exposes to its host: one hook store plus the form actions. */
export interface CardFace {
  /** The host hook stores the section's component reads. */
  hooks: {
    /** The card's own store, the snapshot the component renders from. */
    mpdCard: { getSnapshot: () => CardState }
  }
  /** Stage an edit for one dotted field key. */
  edit: (key: string, value: string) => void
  /** Drop a staged edit, falling back to the file value. */
  resetField: (key: string) => void
  /** Write the staged batch through the scope's mutate. */
  save: () => Promise<void>
  /** Drop every staged edit. */
  discard: () => void
  /** Any other face member. */
  [field: string]: unknown
}

/** The card store's snapshot, as the arms read it. */
export interface CardState {
  /** Whether the scope accepts writes. */
  writable: boolean
  /** The mode the scope reports, e.g. host or memory. */
  mode: string
  /** Whether the current draft fails its field's validation. */
  invalid?: boolean
  /** The catalog projection the picker rows render from. */
  catalog?: unknown
  /** Any other state field. */
  [field: string]: unknown
}

/** Every call the harness records; one array or flag per registration the arms assert. */
export interface HarnessCalls {
  /** Sidebar tab descriptors, in registration order. */
  registerTab: TabDescriptor[]
  /** File-viewer descriptors, in registration order. */
  registerFileViewer: Array<Record<string, unknown>>
  /** Effect labels passed to ctx.effect, in order. */
  effects: string[]
  /** Every fetch the page issued, in order. */
  fetched: FetchCall[]
  /** Locale namespaces registered, in order. */
  locale: string[]
  /** Auto-open requests the page made. */
  openTab: Array<{ seed: unknown; scope: unknown }>
  /** Activity-polling starts recorded on the adopted stub. */
  pollStarts: Array<{ targets: unknown; runtime: unknown }>
  /** Slot keys the page injected into. */
  slots?: string[]
  /** Values a slot generator yielded. */
  slotYields?: unknown[]
  /** Keyed slot registrations, each with the component it carried. */
  slotsRegistered?: SlotRegistration[]
  /** Locale registrations with their dictionaries. */
  localeDictionaries?: Array<{ namespace: string; dictionaries: Record<string, Record<string, string>> }>
  /** Dependency lists of every injection callback that fired. */
  injected?: string[][]
  /** Set when the ADOPTED client half's own apply ran, which must never happen. */
  agentTeamsApplied?: boolean
}

/** The cordis-shaped ctx the harness hands the client under test. */
export interface HarnessCtx {
  /** One-shot service probe: visible registry entries only. */
  get: (name: string) => unknown
  /** Register an effect; the label is recorded for the assertions. */
  effect: (fn: () => unknown, label?: string) => unknown
  /** Subscribe to a runtime event; this ctx never notifies. */
  on: () => () => void
  /** Provide a service and wake every parked injection. */
  provide: (name: string, value: unknown) => () => unknown
  /** Declare a dependency list and run the callback once it is satisfied. */
  inject: (deps: string[], cb: (scoped: HarnessCtx) => unknown) => { dispose: () => void }
  /** The slot seams the pages register through. */
  slots: {
    /** Inject into a slot; a generator's yields are collected. */
    inject: (key: string, cb: () => { next: () => { done?: boolean; value?: unknown } } | null | undefined) => () => void
    /** Register a keyed slot entry together with its component. */
    register: (definition: SlotRegistration, component: Function) => () => void
  }
  /** The locale seam. */
  locale: {
    /** Register one namespace's dictionaries. */
    register: (ns: string, dictionaries: Record<string, Record<string, string>>) => () => void
  }
}

/** One parked injection: its declared deps, its callback and the last fire's values. */
export interface PendingInjection {
  /** The dependency names the callback declared. */
  deps: string[]
  /** The callback to run once every dependency is available. */
  cb: (scoped: HarnessCtx) => unknown
  /** Whether the entry's disposer already ran. */
  disposed: boolean
  /** Whether the callback has fired for the current values. */
  fired?: boolean
  /** The values the last fire saw. */
  values?: unknown[]
}

/** One module registration the artifact's loader global receives. */
export interface LoaderRegistration {
  /** The module id the loader keys the factory by. */
  id: string
  /** The factory the loader materializes on require. */
  factory: Function
}

/** The artifact's own module-loader global, as the window stub provides it. */
export interface ModuleLoaderStub {
  /** Record one module registration. */
  load: (registration: LoaderRegistration) => unknown
  /** Mint the loader's bootstrap record. */
  create: () => { manifest: { plugins: unknown[] } }
  /** Prefetch hook, a no-op offline. */
  prefetch: () => Promise<void>
}

/** The window stub the combined client is invoked with. */
export interface ClientWindow {
  /** The loader global the artifact registers its modules through. */
  __ModuleLoader__: ModuleLoaderStub
  /** No-op listener registration. */
  addEventListener: () => void
  /** No-op listener removal. */
  removeEventListener: () => void
  /** No-op event dispatch. */
  dispatchEvent: () => void
}

/** The artifact's loader global after it has run: its factories and the window they saw. */
export interface LoadedBundleClient {
  /** The module factories the artifact registered, keyed by module id. */
  factories: Map<string, Function>
  /** The window stub the artifact's loader global was installed on. */
  window: ClientWindow
}

/** The adopted client stub's surface, the shape the sidebar page composes against. */
export interface AdoptedStub {
  /** The services the adopted plugin declares; the bundle's page needs none of them. */
  inject: string[]
  /** The adopted plugin's own apply; recording it proves the client half never ran. */
  apply: () => void
  /** One team's card, rendered with the props the page passes. */
  TeamSection: (props: AdoptedTeamSectionProps) => ElementNode
  /** Build a historic-card team record from a card's data and its owner. */
  historicCardTeam: (data: Record<string, unknown>, owner: unknown) => Record<string, unknown>
  /** The member art URL resolver; the stub resolves none. */
  memberArtUrl: () => unknown
  /** The lead member's art key. */
  LEAD_ART: string
  /** The adopted panel's own class map, mirrored so visual parity is provable. */
  ACTIVITY_PANEL_CSS: Record<string, string>
  /** The locale namespace the adopted panel translates through. */
  AGENT_TEAMS_LOCALE_NAMESPACE: string
  /** The Chinese dictionary. */
  zh: Record<string, string>
  /** The English dictionary. */
  en: Record<string, string>
  /** Whether a team has any task in progress. */
  teamIsActive: (team: { tasks?: Array<{ status?: unknown }> }) => boolean
  /** The activity snapshot in force. */
  getActivitySnapshotsSnapshot: () => AdoptedSnapshot
  /** Subscribe to activity-snapshot changes. */
  subscribeActivitySnapshots: (listener: () => void) => () => void
  /** Publish an activity snapshot; absent fields keep their previous value. */
  updateActivitySnapshots: (update: AdoptedSnapshotUpdate) => AdoptedSnapshot
  /** Start polling the adopted state route; the stub ticks once, deterministically. */
  startActivityPolling: (targets: unknown, runtime?: Record<string, unknown>) => { firstTick: Promise<void>; stop: () => void }
  /** The poll interval the adopted panel declares. */
  ACTIVITY_POLL_MS: number
  /** The probe interval the adopted panel declares. */
  ACTIVITY_PROBE_MS: number
  /** The adopted panel's state route. */
  ACTIVITY_STATE_URL: string
  /** The adopted panel's halt route. */
  ACTIVITY_HALT_URL: string
  /** Any other stub member. */
  [field: string]: unknown
}

/** One activity snapshot the adopted stub publishes. */
export interface AdoptedSnapshot {
  /** The live team records. */
  teams: unknown[]
  /** The archived team records. */
  archivedTeams: unknown[]
}

/** A partial activity snapshot: absent fields keep their previous value. */
export interface AdoptedSnapshotUpdate {
  /** Replacement live team records. */
  teams?: unknown[]
  /** Replacement archived team records. */
  archivedTeams?: unknown[]
}

/** The props the page hands the adopted TeamSection. */
export interface AdoptedTeamSectionProps {
  /** The team record being rendered. */
  team: { teamId?: string; name?: string; members?: Array<{ name?: string }>; tasks?: Array<{ id?: string }> }
  /** Whether the card renders a historic (archived) team. */
  historic?: boolean
  /** The model directory the card would offer, when one resolved. */
  modelDirectory?: unknown
  /** Present when the card may continue planning. */
  onContinuePlanning?: unknown
  /** Present when the card may be discarded. */
  onDiscarded?: unknown
  /** Any other prop. */
  [field: string]: unknown
}

/** The platform primitives stub: just the icon module the pages resolve. */
export interface PrimitivesStub {
  /** The chevron glyph the panel's collapse control renders. */
  IconChevronDownOutline14: (props: { size?: unknown }) => ElementNode
  /** Any other primitive the fixture replaces wholesale. */
  [field: string]: unknown
}

/** A DSH-better-sidebar store double: the state, the reductions applied, and the views. */
export interface SidebarStore {
  /** The store's state, panelOpen unless the fixture overrides it. */
  state: () => Record<string, unknown>
  /** Every reducer the page pushed through reduce(). */
  reductions: Array<(state: Record<string, unknown>) => Record<string, unknown>>
  /** Apply one reducer, recording it first so an assertion can inspect it. */
  reduce: (reducer: (state: Record<string, unknown>) => Record<string, unknown>) => Record<string, unknown>
  /** The readonly snapshot a sidebar component subscribes to. */
  getSnapshot: () => Record<string, unknown>
  /** Subscribe to changes; the double never notifies. */
  subscribe: () => () => void
}

/** The fixture options one caller-scoped service descriptor is built from. */
export interface CallerScopedServiceOptions {
  /** Dotted seams the methods read; each must be in the caller's inject list. */
  reads?: string[]
  /** The methods, each receiving the caller's ctx as its first argument. */
  methods?: Record<string, (callerCtx: { deps: string[] }, ...args: unknown[]) => unknown>
}

/** A caller-scoped service descriptor: the seams its methods read, and the methods. */
export interface CallerScopedService {
  /** The descriptor the harness binds to the resolving ctx's inject list. */
  __mpdCallerScoped: CallerScopedDescriptor
}

/** The binding data a caller-scoped service carries. */
export interface CallerScopedDescriptor {
  /** The dotted seams the methods read; each must be in the caller's inject list. */
  reads: string[]
  /** The methods, each receiving the caller's ctx as its first argument. */
  methods: Record<string, (callerCtx: { deps: string[] }, ...args: unknown[]) => unknown>
}

/** Anything the registry can hand the caller-scoped binder: the descriptor, or a plain service. */
export interface CallerScopedCandidate {
  /** The caller-scoped descriptor, present only on a service of the caller-scoped shape. */
  __mpdCallerScoped?: CallerScopedDescriptor
  /** Any plain service member. */
  [field: string]: unknown
}

/** The fixture options one harness instance is built from. */
export interface HarnessOptions {
  /** Services pre-registered before apply(); the adopted stub may be replaced here. */
  services?: { "@nanmicoder/dsh-agent-teams"?: AdoptedStub; [name: string]: unknown }
  /** URL-keyed canned 200 bodies. */
  responses?: Record<string, unknown>
  /** `METHOD path` (or bare path) keyed canned responses, optionally `{ status, body }`. */
  requestResponses?: Record<string, unknown>
  /** A module-name map answered before any real resolution. */
  requireMap?: Record<string, unknown>
  /** The client's own module factories, when the caller already loaded them. */
  factories?: Map<string, Function> | null
  /** Tab ids the sidebar double reports as disabled. */
  disabledTabs?: string[]
  /** Plugin settings the sidebar snapshot carries. */
  pluginSettings?: Record<string, unknown>
  /** Services reachable only through a declared injection. */
  hiddenServices?: Record<string, unknown>
  /** Register the sidebar service before apply() instead of after. */
  sidebarAtApply?: boolean
  /** Never provide the sidebar service at all. */
  withoutSidebar?: boolean
  /** The platform icon stub, or null to exercise the fallback. */
  primitives?: PrimitivesStub | null
}

/** The offline harness one case drives: the ctx double, the canned fetch and every call. */
export interface Harness {
  /** The cordis-shaped ctx handed to the client under test. */
  ctx: HarnessCtx
  /** The module resolver handed to the client's factories. */
  require: (name: string) => unknown
  /** The canned fetch installed as the process-global one for the case's lifetime. */
  fetchImpl: (url: unknown, options_?: FetchInit) => Promise<CannedResponse>
  /** Every call the harness recorded, for the assertions. */
  calls: HarnessCalls
  /** The service registry a plain ctx.get probe can see. */
  registry: Map<string, unknown>
  /** The hook runtime the page components render in. */
  hooks: HookRuntime
  /** The adopted client stub the page composes against. */
  adoptedStub: AdoptedStub
  /** The platform icon stub, or null when the fixture exercises the fallback. */
  primitives: PrimitivesStub | null
  /** The sidebar service this harness provides. */
  sidebarService: SidebarService
  /** Whether provideSidebar() will bind anything. */
  sidebarProvided: boolean
  /** Build one sidebar service; a remount hands out a FRESH one. */
  createSidebarService: () => SidebarService
  /** Re-arm every live injection and run it again. */
  refireInjections: () => void
  /** Publish the sidebar service the way its own plugin fiber does. */
  provideSidebar: () => boolean
  /** Publish any service and wake the parked injection fibers. */
  provideService: (name: string, value: unknown) => void
  /** Installed by loadMpdClient once the fetch stub is in place. */
  restore?: () => void
}

/** The bundle client's public exports, as the arms exercise them. */
export interface MpdClientExports {
  /** Mount the client's registrations against a cordis-shaped ctx. */
  apply: (ctx: unknown) => void
  /** The workmate library page component the sidebar tab renders. */
  WorkmateLibraryView: Function
  /** The zh/en dictionaries the page translates through. */
  dictionaries: { zh: Record<string, string>; en: Record<string, string> }
  /** Turn a failed request into a readable, localized message. */
  describeFailure: (error: unknown, t: (key: string, params?: Record<string, string>) => string) => string
  /** The wire reason code a failure carries, when it carries one. */
  failureReason: (error: unknown) => string | undefined
  /** The pinned sidebar tab id the page registers. */
  SIDEBAR_TAB_ID: string
  /** The registrar the sidebar mounts the page through. */
  registerTeamSidebarTab: Function
  /** Any other export the artifact carries. */
  [field: string]: unknown
}

/** A loaded client: the harness plus the artifact's exports and its fetch-restore hook. */
export interface LoadedMpdClient extends Harness {
  /** The bundle client's public exports. */
  exports: MpdClientExports
  /** Put the process-global fetch back the way the case found it. */
  restore: () => void
}
/** Repository root the harness reads the client from, overridable per process. */
const ROOT = process.env.MPD_REPO_ROOT ?? process.cwd();

/** Read the combined client and run it against a window stub, returning its factories. */
export function loadBundleClient(): LoadedBundleClient {
  // Resolved at CALL time, not import time: a test file sets MPD_REPO_ROOT after its import
  // (module evaluation runs first), so an import-time read silently ignores it and loads
  // whatever client.js `cwd` happens to point at — which made an earlier control-lane run
  // load the REAL client and pass while claiming to test a pre-fix build.
  const root = process.env.MPD_REPO_ROOT ?? ROOT;
  /** The shipped client artifact's bytes. */
  const source = readFileSync(join(root, "packages", "mpd-bundle-plugin", "client.js"), "utf8");
  /** The module factories the artifact registers through its loader global. */
  const factories = new Map<string, Function>();
  /** The loader global the artifact calls into. */
  const bootstrap: ModuleLoaderStub = {
    load: (registration: LoaderRegistration) => factories.set(registration.id, registration.factory),
    create: () => ({ manifest: { plugins: [] } }),
    prefetch: async () => {},
  };
  /** The window stub the artifact's loader global is installed on. */
  const window: ClientWindow = {
    __ModuleLoader__: bootstrap,
    /** The window stub's no-op listener registration. */
    addEventListener(): void {},
    /** The window stub's no-op listener removal. */
    removeEventListener(): void {},
    /** The window stub's no-op event dispatch. */
    dispatchEvent(): void {},
  };
  // eslint-disable-next-line no-new-func
  new Function("window", source)(window);
  return { factories, window };
}

/** One React element record, enough to assert on what a component returns. */
function createElement(type: unknown, props: ElementProps | null | undefined, ...children: TreeNode[]): ElementNode {
  /** The element's key, split out so it stays a sibling of props. */
  const { key, ...rest } = props ?? {};
  return { type, key, props: { ...rest, children: children.length > 1 ? children : children[0] } };
}

/**
 * Minimal hook runtime: fixed-order slots, setters that schedule a re-render.
 * Enough to drive a page component until its fetched state settles, then read the
 * last rendered tree. Not a React substitute — just deterministic for assertions.
 */
export function createHookRuntime(): HookRuntime {
  /** Fixed-order hook slots: state values, ref records and subscription entries. */
  const slots: Array<HookSlot | undefined> = [];
  /** The slot cursor for the render pass in flight. */
  let cursor = 0;
  /** Whether a state setter ran during this pass, forcing another one. */
  let dirty = false;
  /** Mark the tree dirty so the render loop runs another pass. */
  const schedule = (): void => { dirty = true; };
  /** Effects queued by the last pass, run before the next one. */
  let effects: Array<() => unknown> = [];
  /** Cleanups registered by effects, run on teardown. */
  let cleanup: Function[] = [];
  /** The React-shaped API handed to a page component. */
  const react: HookReact = {
    createElement,
    /** A fixed-order state slot whose setter schedules a re-render. */
    useState(initial: HookSlot | (() => HookSlot)): [unknown, (next: HookSlot | ((previous: HookSlot | undefined) => HookSlot)) => void] {
      /** The slot this hook owns for the component's lifetime. */
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      /** Write the next value (or apply an updater), then schedule a re-render. */
      const set = (next: HookSlot | ((previous: HookSlot | undefined) => HookSlot)): void => {
        slots[index] = typeof next === "function" ? next(slots[index]) : next;
        schedule();
      };
      return [slots[index], set];
    },
    /** A fixed-order ref slot, created once and stable afterwards. */
    useRef(initial: unknown): HookSlot | undefined {
      /** The slot this ref owns. */
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    /** Run an effect when its deps key changes, as React would. */
    useEffect(fn: () => unknown, deps?: unknown): void {
      /** The slot this effect owns. */
      const index = cursor++;
      /** The serialized deps, compared against the previous render's. */
      const key = JSON.stringify(deps ?? null);
      /** The slot's previous entry, undefined on the first render. */
      const previous = slots[index];
      if (previous === undefined || previous.key !== key) {
        slots[index] = { key };
        effects.push(fn);
      }
    },
    /** Return the callback unchanged; the pages only need a stable identity. */
    useCallback<T>(fn: T): T { cursor++; return fn; },
    /** Compute once per slot and return the value. */
    useMemo<T>(fn: () => T): T { cursor++; return fn(); },
    /**
     * Minimal external store: subscribe once per slot and re-read the snapshot every
     * render (the store returns the same object until it really changes, so the render
     * loop converges). A store notification marks the tree dirty, which is what drives
     * the page's re-render after a poll lands.
     */
    useSyncExternalStore(subscribe: (listener: () => void) => unknown, getSnapshot: () => unknown): unknown {
      /** The slot this subscription owns. */
      const index = cursor++;
      if (!(index in slots)) {
      /** What the store returned for this subscription. */
        const unsubscribe = subscribe(() => { schedule(); });
        slots[index] = { unsubscribe };
        cleanup.push(typeof unsubscribe === "function" ? unsubscribe : () => {});
      }
      return getSnapshot();
    },
  };
  return {
    react,
    /** Clear the slot cursor and the effect queue for a fresh pass. */
    reset(): void { cursor = 0; effects = []; },
    /** Take the effects queued since the last pass, clearing the queue. */
    takeEffects(): Array<() => unknown> {
      /** The effects queued by the pass that just ran. */
      const taken = effects;
      effects = [];
      return taken;
    },
    /** Register a cleanup the runtime runs on teardown. */
    registerCleanup(fn: Function): void { cleanup.push(fn); },
    /** Run every registered cleanup, swallowing their errors. */
    runCleanups(): void { for (const fn of cleanup.splice(0)) { try { fn(); } catch { /* harness */ } } },
    /**
     * Render until quiescent: keep re-rendering whenever a state setter was called
     * (fetch resolution lands in a later microtask), running pending effects between
     * passes, then return the final element tree.
     */
    async render(Component: Function, props: ElementProps): Promise<ElementNode> {
      /** The tree the last pass produced. */
      let current: ElementNode | null = null;
      for (let pass = 0; pass < 60; pass += 1) {
        dirty = false;
        cursor = 0;
        current = Component(props);
        for (const effect of this.takeEffects()) {
        /** Whatever the effect returned, registered when it is a function. */
          const disposer = effect();
          if (typeof disposer === "function") this.registerCleanup(disposer);
        }
        // Let pending promises (fetch → setState) land before deciding to stop.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!dirty) break;
      }
      // The loop always assigns before it can break, so the tree is present at this point.
      // A cast is the only way to say that: the variable is null-initialized for the first pass.
      return current as ElementNode;
    },
    /**
     * Re-render the last component with an awaited flush, so a state update made OUTSIDE
     * the render loop — an event handler invoked by a test, e.g. a button click — reaches
     * the returned tree. `render()` alone cannot: it clears the dirty flag on entry.
     */
    async act(Component: Function, props: ElementProps): Promise<ElementNode> {
      cursor = 0;
      /** The tree this re-render produced. */
      const current = Component(props);
      for (const effect of this.takeEffects()) {
        /** Whatever the effect returned, registered when it is a function. */
        const disposer = effect();
        if (typeof disposer === "function") this.registerCleanup(disposer);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      return current;
    },
  };
}

/**
 * A CALLER-SCOPED service, bound the way cordis binds one: the service's own `ctx` resolves to the
 * context that ASKED for the service, so a method that reads a dotted seam (`this.ctx.remote.session`)
 * is rejected unless the CALLER declared that inject. That is the MEASURED live failure behind the
 * settings card's one-provider defect: the host's model-directory resolver declares
 * `inject = ["sessions","remote","remote.session"]` and reads `this.ctx.remote.session` inside
 * `directoryFor()`, so a card that injected only `["modelDirectories","sessions"]` got
 * `cannot get property "remote.session" without inject` and silently rendered its declared lists.
 *
 * `reads` names the dotted seams the methods read (each must be in the CALLER's inject list);
 * `methods` receive the caller's ctx as their FIRST argument, the way `this.ctx` would, so a method
 * can only read what the caller declared. A method called with a missing seam throws that exact
 * error, so a test that asserts a LIVE result proves the chain was satisfied at the call site.
 */
export function callerScopedService({ reads = [], methods = {} }: CallerScopedServiceOptions = {}): CallerScopedService {
  return { __mpdCallerScoped: { reads: [...reads], methods: { ...methods } } };
}

/**
 * Bind a caller-scoped descriptor to the inject list of the ctx that resolved it: the returned view
 * carries the same non-method fields and method wrappers that THROW when a declared read is absent.
 * A plain service (no descriptor) passes through untouched, so existing fixtures are unaffected.
 */
function bindCallerScoped(value: unknown, deps: string[]): unknown {
  // The descriptor is a runtime protocol on an otherwise opaque service value, so the read
  // must go through a cast: nothing in the parameter's type names the field.
  const descriptor = value === null || typeof value !== "object" ? undefined : (value as CallerScopedCandidate).__mpdCallerScoped;
  if (descriptor === undefined) return value;
  /** The bound view returned in place of the original service. */
  const bound: Record<string, unknown> = {};
  // The guard above proved this is an object; the cast names the entry shape Object.entries needs.
  for (const [name, field] of Object.entries(value as Record<string, unknown>)) {
    if (name !== "__mpdCallerScoped") bound[name] = field;
  }
  for (const [name, method] of Object.entries(descriptor.methods)) {
    bound[name] = (...args: unknown[]): unknown => {
      /** The first declared seam the caller did not inject, when there is one. */
      const missing = descriptor.reads.find((read) => !deps.includes(read));
      if (missing !== undefined) throw new Error('cannot get property "' + missing + '" without inject');
      return method({ deps: [...deps] }, ...args);
    };
  }
  return bound;
}

/** Records how the page drives the sidebar's expand-on-content-open path. */
export function createCalls(): HarnessCalls {
  return { registerTab: [], registerFileViewer: [], effects: [], fetched: [], locale: [], openTab: [], pollStarts: [] };
}

/** The platform externals stub: just enough of the icon module the page resolves. */
export function createPrimitivesStub(): PrimitivesStub {
  /** The chevron glyph the panel's collapse control resolves. */
  const IconChevronDownOutline14 = (props: { size?: unknown }): ElementNode => createElement("svg", { "data-icon": "chevron-down-14", size: props?.size });
  return { IconChevronDownOutline14 };
}

/**
 * A DSH-better-sidebar store stub. `reduce` is the ONLY lever a tab component has, so
 * the stub records every reduction — that is how the collapse control is proven to
 * close the panel through the sidebar's own state, not through a page-local flag.
 */
export function createSidebarStore(initial: Record<string, unknown> = {}): SidebarStore {
  /** The store's state, panelOpen unless the fixture overrides it. */
  let state: Record<string, unknown> = { panelOpen: true, ...initial };
  /** Every reducer the page pushed through reduce(). */
  const reductions: Array<(state: Record<string, unknown>) => Record<string, unknown>> = [];
  return {
    state: () => state,
    reductions,
    /** Apply one reducer, recording it first so an assertion can inspect it. */
    reduce(reducer: (state: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown> { reductions.push(reducer); state = reducer(state); return state; },
    getSnapshot: () => state,
    subscribe: () => () => {},
  };
}

/**
 * Fake "@nanmicoder/dsh-agent-teams" module: the adopted views/store/locale surface the
 * sidebar page composes. The REAL adopted bundle is proven separately
 * (packages/mpd-agent-teams-plugin/test/export-bridge.test.ts), so this stub only has to
 * be faithful about the contract the page relies on.
 */
export function createAdoptedStub(calls: HarnessCalls): AdoptedStub {
  /** Snapshot subscribers the stub notifies on a real change. */
  const listeners = new Set<() => void>();
  /** The current snapshot, replaced only when a field really changed. */
  let snapshot: AdoptedSnapshot = { teams: [], archivedTeams: [] };
  // The class map the page composes. Names double as the identity under test: the page
  // must render the PANEL's own classes (visual parity), so the stub exposes the whole
  // set the floater's interior uses.
  const css = {
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
  };
  /** Publish an update, keeping a field's previous value when it is absent. */
  const publish = (update: AdoptedSnapshotUpdate): AdoptedSnapshot => {
    /** The candidate snapshot this publish would install. */
    const next = {
      teams: update.teams ?? snapshot.teams,
      archivedTeams: update.archivedTeams ?? snapshot.archivedTeams,
    };
    if (next.teams === snapshot.teams && next.archivedTeams === snapshot.archivedTeams) return snapshot;
    snapshot = next;
    for (const listener of listeners) listener();
    return snapshot;
  };
  return {
    inject: [],
    apply: () => { calls.agentTeamsApplied = true; },
    TeamSection: (props) => createElement("section", {
      "data-team-section": props.team.teamId,
      "data-historic": props.historic === true ? "1" : undefined,
      "data-model-directory": props.modelDirectory === undefined ? undefined : "present",
      "data-can-edit-plan": props.onContinuePlanning !== undefined && props.onDiscarded !== undefined ? "1" : undefined,
    }, [
      props.team.name,
      ...(props.team.members ?? []).map((member) => "member:" + member.name),
      ...(props.team.tasks ?? []).map((task) => "task:" + task.id),
    ]),
    historicCardTeam: (data, owner) => ({
      teamId: data.teamId, name: data.teamName, captainSessionId: data.captainSessionId || owner,
      phase: "running", members: [], tasks: [], archived: true,
    }),
    memberArtUrl: () => undefined,
    LEAD_ART: "lead-art",
    ACTIVITY_PANEL_CSS: css,
    AGENT_TEAMS_LOCALE_NAMESPACE: "agentTeams",
    zh: {
      "archive.label": "已归档", "archive.discardedLabel": "已丢弃",
      "activity.title": "AgentTeams 活动", "activity.empty": "暂无团队活动",
      "activity.collapse": "收起活动面板", "activity.panelAria": "AgentTeams 活动面板",
    },
    en: {
      "archive.label": "archived", "archive.discardedLabel": "discarded",
      "activity.title": "AgentTeams activity", "activity.empty": "No team activity",
      "activity.collapse": "Collapse activity panel", "activity.panelAria": "AgentTeams activity panel",
    },
    teamIsActive: (team) => (team.tasks ?? []).some((task) => task.status === "in_progress"),
    getActivitySnapshotsSnapshot: () => snapshot,
    subscribeActivitySnapshots: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    updateActivitySnapshots: publish,
    /** One deterministic tick (no interval) so tests never race a timer. */
    startActivityPolling: (targets, runtime = {}) => {
      calls.pollStarts.push({ targets, runtime });
      /** Whether stop() has been called, which ends the polling. */
      let stopped = false;
      /** One deterministic poll tick: read the state route once, then publish. */
      const tick = async (): Promise<void> => {
        if (stopped) return;
        /** The canned state answer. */
        const response = await globalThis.fetch("/plugins/dsh-agent-teams/state", { cache: "no-store" });
        if (response.ok !== true) return;
        /** The parsed state payload. */
        const body = await response.json();
        if (Array.isArray(body.teams)) publish({ teams: body.teams });
        if (Array.isArray(body.archivedTeams)) publish({ archivedTeams: body.archivedTeams });
      };
      return { firstTick: tick(), stop: () => { stopped = true; } };
    },
    ACTIVITY_POLL_MS: 100000,
    ACTIVITY_PROBE_MS: 100000,
    ACTIVITY_STATE_URL: "/plugins/dsh-agent-teams/state",
    ACTIVITY_HALT_URL: "/plugins/dsh-agent-teams/halt",
  };
}

/** Build one offline harness: a cordis-shaped ctx, a canned fetch and a call recorder. */
export function createHarness(options: HarnessOptions = {}): Harness {
  /** The fixture options, with the module map and factory table defaulted. */
  const { services = {}, responses = {}, requireMap = {}, factories = null } = options;
  // `requestResponses` maps a REQUEST (method + path, no query) to a canned response so the
  // failure matrix of the workmate routes is expressible: mutation URLs are POSTed, and a
  // 409 in-use body cannot be keyed by URL alone. `responses` keeps its resolve-to-200 shape.
  const requestResponses = options.requestResponses ?? {};
  /** Every call the harness records for the assertions. */
  const calls = createCalls();
  /** The service registry a plain ctx.get probe can see. */
  const registry = new Map(Object.entries(services));
  /** Tab ids the sidebar double reports as disabled. */
  const disabledTabs = options.disabledTabs ?? [];
  /**
   * DSH-better-sidebar publishes `betterSidebar` from ITS OWN plugin fiber, which activates
   * LATER than this entry — so the service is absent while `apply()` runs. That race is
   * modelled by default (the tests call `provideSidebar()` afterwards); `sidebarAtApply`
   * pre-registers it and `withoutSidebar` never provides it at all.
   */
  /**
   * Build ONE sidebar service. A remount hands the pages a FRESH service with an EMPTY tab
   * registry — that is the shape a test must be able to produce, which is why this is a factory
   * and not a single object.
   */
  /** Build one sidebar service; a remount hands out a FRESH one. */
  const createSidebarService = (): SidebarService => {
    /** The tabs this service instance holds. */
    const tabs = new Map<string, TabDescriptor>();
    return {
      // Faithful to dsh-better-sidebar 0.19.1: `registerTab` THROWS on a duplicate id and
      // `getTab(id)` answers the descriptor. Both matter here — the production registrar checks
      // `getTab` before registering, so a re-fire must be provably harmless instead of throwing.
      registerTab: (descriptor) => {
        if (tabs.has(descriptor.id)) throw new Error('[dsh-better-sidebar] tab type "' + descriptor.id + '" already registered');
        tabs.set(descriptor.id, descriptor);
        calls.registerTab.push(descriptor);
        return () => { if (tabs.get(descriptor.id) === descriptor) tabs.delete(descriptor.id); };
      },
      registerFileViewer: (descriptor) => { calls.registerFileViewer.push(descriptor); return () => {}; },
      // Auto-open capture: the page must expand the panel with a CONTENT seed.
      openTab: (seed, scope) => { calls.openTab.push({ seed, scope }); },
      isTabEnabled: (id) => !disabledTabs.includes(id),
      getTabs: () => [...tabs.values()],
      getTab: (id) => tabs.get(id),
      getSnapshot: () => ({ prefs: { pluginSettings: options.pluginSettings ?? {} } }),
    };
  };
  /** The sidebar service this harness provides. */
  const sidebarService = createSidebarService();
  /** Whether provideSidebar() will bind anything. */
  const sidebarProvided = options.withoutSidebar !== true;
  if (options.sidebarAtApply === true && sidebarProvided) registry.set("betterSidebar", sidebarService);
  /**
   * Injection fibers, the way cordis actually schedules them: a callback runs when every
   * declared dependency is registered, and `provide()` re-evaluates the parked ones. This is
   * the ONLY way a plugin-provided service can be consumed — a one-shot `ctx.get` probe
   * during apply() answers undefined, which is exactly the live failure this models.
   */
  const pendingInjections: PendingInjection[] = [];
  /**
   * PROBE-INVISIBLE services: the exact shape of the live defect. A `hiddenServices` entry is
   * NOT in `registry`, so a bare `ctx.get(name)` probe answers undefined — only an injection
   * whose deps NAME it resolves, and that injection's callback receives a SCOPED ctx whose
   * `get` does see it. That is cordis' actual rule (a service provided by another plugin's
   * fiber is invisible to a plain probe, and `notify()` only re-evaluates fibers that DECLARE
   * the dependency), and it is what makes T-A falsifiable: on a bare-probe implementation the
   * pickers fall back even though the service exists and an injection can reach it.
   */
  const hidden = new Map(Object.entries(options.hiddenServices ?? {}));
  /** A ctx scoped to one caller's inject list, as cordis scopes a resolved service. */
  const scopedCtx = (deps: string[]): HarnessCtx => ({
    ...ctx,
    // CALLER SCOPING: a service handed to this ctx is bound to THIS ctx's inject list, so a
    // caller-scoped method reading a seam the caller never declared throws (the measured live
    // failure — see `callerScopedService`). A visible registry service is bound the same way, so a
    // fixture can also prove the chain on a probe-visible service.
    get: (name) => {
      if (registry.has(name)) return bindCallerScoped(registry.get(name), deps);
      return deps.includes(name) && hidden.has(name) ? bindCallerScoped(hidden.get(name), deps) : undefined;
    },
  });
  /** Run every parked injection whose dependencies are satisfied. */
  const runInjections = (): void => {
    for (const entry of [...pendingInjections]) {
      if (entry.disposed) continue;
      /** The current values of the entry's dependencies. */
      const values = entry.deps.map((dep) => (registry.has(dep) ? registry.get(dep) : hidden.get(dep)));
      // An unsatisfied dependency parks the fiber; the entry is NOT dropped, because cordis
      // re-evaluates every fiber that DECLARES a dependency when its provider rebinds.
      if (values.some((value) => value === undefined)) continue;
      // A REBIND is a remount: the same deps naming a NEW service value must re-run the
      // callback (that is the documented `ctx.inject` behaviour the sidebar pages rely on).
      if (entry.fired === true && values.every((value, at) => value === entry.values![at])) continue;
      entry.fired = true;
      entry.values = values;
      calls.injected = calls.injected ?? [];
      calls.injected.push(entry.deps);
      entry.cb(scopedCtx(entry.deps));
    }
  };
  /**
   * Re-run every live injection against its CURRENT service values. A provider rebind re-fires
   * the callback even when the same service object is bound again, so a case needs to be able to
   * drive that re-fire explicitly instead of hoping a changed value causes one.
   */
  /** Re-arm every live injection and run them again, as a provider rebind does. */
  const refireInjections = (): void => {
    for (const entry of pendingInjections) {
      entry.fired = false;
      entry.values = undefined;
    }
    runInjections();
  };
  /** The cordis-shaped ctx handed to the client under test. */
  const ctx: HarnessCtx = {
    get: (name) => (registry.has(name) ? registry.get(name) : undefined),
    effect: (fn, label) => {
      calls.effects.push(label ?? "effect");
      /** Whatever the effect returned, when it returned a disposer. */
      const disposer = fn();
      return typeof disposer === "function" ? disposer : () => {};
    },
    on: () => () => {},
    provide: (name, value) => { registry.set(name, value); runInjections(); return () => registry.delete(name); },
    inject: (deps, cb) => {
      /** The parked injection this call created. */
      const entry = { deps: [...deps], cb, disposed: false };
      pendingInjections.push(entry);
      runInjections();
      return { dispose: () => {
        entry.disposed = true;
        /** The entry's position, so it can be removed on dispose. */
        const at = pendingInjections.indexOf(entry);
        if (at >= 0) pendingInjections.splice(at, 1);
      } };
    },
    slots: {
      // The host's own cards pass a GENERATOR to `slots.inject` (`function* () { yield
      // ctx.slots.register(...) }`), and the slot machinery drives it so the yielded
      // registrations/disposers are collected. The double models both shapes.
      inject: (key, cb) => {
        calls.slots = calls.slots ?? [];
        calls.slots.push(key);
        /** Whatever the inject callback returned: a generator, or nothing. */
        const returned = cb();
        if (returned !== null && returned !== undefined && typeof returned.next === "function") {
          /** One yielded registration or disposer. */
          let step = returned.next();
          while (step.done !== true) {
            calls.slotYields = calls.slotYields ?? [];
            calls.slotYields.push(step.value);
            step = returned.next();
          }
        }
        return () => {};
      },
      // `slots.register(options, component)` — the host's keyed-slot shape (its own cards pass the
      // options object and the component separately). The component is recorded too, so an offline
      // test can render a registered card in the hook runtime.
      register: (definition, component) => { calls.slotsRegistered = calls.slotsRegistered ?? []; calls.slotsRegistered.push({ ...definition, component }); return () => {}; },
    },
    // The dictionaries ride along: capturing only the namespace made the zh/en key-parity
    // assertion (contract §L A7) impossible offline. `calls.locale` stays the namespace list;
    // each entry also records `namespace` and `dictionaries`.
    locale: {
      register: (ns, dictionaries) => {
        calls.locale.push(ns);
        calls.localeDictionaries = calls.localeDictionaries ?? [];
        calls.localeDictionaries.push({ namespace: ns, dictionaries });
        return () => {};
      },
    },
  };
  for (const [name, value] of Object.entries(services)) registry.set(name, value);
  /** The hook runtime the page components render in. */
  const hooks = createHookRuntime();
  /** The React-shaped API, with the layout-effect and id seams added. */
  const react = hooks.react;
  react.useLayoutEffect = react.useEffect;
  react.useId = () => "mpd-harness-id";
  /** The adopted client stub, or the fixture's own replacement. */
  const adoptedStub = services["@nanmicoder/dsh-agent-teams"] ?? createAdoptedStub(calls);
  /**
   * The platform icon module the page resolves its collapse glyph from (the adopted
   * panel renders the very same component). Stubbed so tests can prove the REAL
   * component is chosen rather than the inline fallback; pass `primitives: null` to
   * exercise the fallback.
   */
  const primitives = options.primitives === undefined ? createPrimitivesStub() : options.primitives;
  /** Modules already materialized, so a factory runs at most once. */
  const moduleCache = new Map<string, unknown>();
  /** The module resolver handed to the client's factories. */
  const require = (name: string): unknown => {
    if (moduleCache.has(name)) return moduleCache.get(name);
    if (name in requireMap) { moduleCache.set(name, requireMap[name]); return requireMap[name]; }
    if (name === "react") return react;
    if (name === "@nanmicoder/dsh-agent-teams") return adoptedStub;
    if (name === "@deepseek-ai/dsh-client-ui-primitives") {
      if (primitives === null) throw new Error("harness: platform primitives unavailable");
      return primitives;
    }
    /** The factory for a module the artifact registered, when there is one. */
    const factory = factories && typeof factories.get === "function" ? factories.get(name) : undefined;
    if (factory !== undefined) {
      /** The module value the factory produced. */
      const value = factory(require);
      moduleCache.set(name, value);
      return value;
    }
    throw new Error("harness: unexpected require(" + name + ")");
  };
  /**
   * Canned fetch. Resolution order: an exact `method path` (or bare path) entry in
   * `requestResponses`, then the URL-keyed `responses` (200), else 404 {error}.
   * An entry is either a body, or `{ status, body }` so the failure matrix — 400
   * invalid-name / 400 confirm-required / 404 unknown / 409 collision / 409 in-use
   * (`blocking: [{teamId, member}]`) — is expressible per route.
   */
  const fetchImpl = async (url: unknown, options_?: FetchInit): Promise<CannedResponse> => {
    /** The requested URL as a string. */
    const target = String(url);
    /** The request method, defaulted to GET and upper-cased. */
    const method = String(options_?.method ?? "GET").toUpperCase();
    calls.fetched.push({ url: target, method, options: options_ });
    /** The canned answer for this request, when one was registered. */
    const entry = requestResponses[method + " " + target] ?? requestResponses[target];
    if (entry !== undefined) {
      if (entry !== null && typeof entry === "object" && "status" in entry) {
      /** The canned status code, numeric. */
        const status = Number(entry.status);
      /** The canned body, or an error payload naming the status. */
        const body = "body" in entry ? entry.body : { error: "HTTP " + String(status) };
        return { ok: status >= 200 && status < 300, status, json: async () => body };
      }
      return { ok: true, status: 200, json: async () => entry };
    }
    /** The URL-keyed canned body, when the fixture registered one. */
    const body = responses[target];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
    return { ok: true, status: 200, json: async () => body };
  };
  return {
    ctx, require, fetchImpl, calls, registry, hooks, adoptedStub, primitives, sidebarService, sidebarProvided,
    createSidebarService,
    refireInjections,
    /** Publish the sidebar service the way its own plugin fiber does — after apply(). */
    provideSidebar: () => {
      if (!sidebarProvided) return false;
      registry.set("betterSidebar", sidebarService);
      runInjections();
      return true;
    },
    /** Publish any service and wake the parked injection fibers. */
    provideService: (name, value) => { registry.set(name, value); runInjections(); },
  };
}

/** Load the bundle client and return its `@mpd-dsh/mpd` factory exports. */
export function loadMpdClient(options: HarnessOptions = {}): LoadedMpdClient {
  /** The factories the artifact registered. */
  const { factories } = loadBundleClient();
  if (!factories.has("@mpd-dsh/team-page")) {
    throw new Error("harness: bundle client did not register @mpd-dsh/team-page (rebuild with node scripts/build-mpd-client.ts)");
  }
  /** The harness this client runs in. */
  const harness = createHarness({ ...options, factories });
  /** The bundle entry's own factory, which the arms drive. */
  const factory = factories.get("@mpd-dsh/mpd");
  if (factory === undefined) throw new Error("harness: bundle client did not register @mpd-dsh/mpd");
  // Install the stub fetch for the lifetime of this client: component effects call
  // the global `fetch` long after the factory returned, so restoring it here would
  // leave the page talking to the real network.
  const saved = globalThis.fetch;
  // The double answers a partial Response shape, which is all the pages read; the global's own
  // type demands a whole one, and only the runtime contract makes the difference safe.
  globalThis.fetch = harness.fetchImpl as typeof fetch;
  /** The bundle client's public exports. */
  const exports = factory(harness.require);
  harness.restore = () => { globalThis.fetch = saved; };
  // The restore hook is installed above, so a case always gets one; the spread's optional field
  // cannot carry that fact, and no narrowing reaches it.
  return { exports, ...harness } as LoadedMpdClient;
}
