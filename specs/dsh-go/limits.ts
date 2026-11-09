// DSH-Go protocol v1 — the FROZEN SPEC DATA this repository conforms to.
//
// SOURCE OF TRUTH: `ccch1mneyyy/dsh-Go` at commit `f36bf91b0736e81ef40c2a7040b2ec337ca1ab40`
// (2026-11-09), file `runtime/bridge/dsh-go-bridge/lib/native/limits.js` (mirrored by the SDK at
// `sdk/plugin-kit/lib/bridge/limits.js`). `specs/dsh-go/SOURCE.json` pins every fetched file by
// sha256, and `VENDOR_LOCK.json` fingerprints this whole tree as an asset.
//
// WHY IT IS A TRANSCRIPTION AND NOT A COPY: `@dsh-go/plugin-kit` is `private: true` on npm, so the
// repository cannot depend on it, and the de-vendor policy forbids vendoring upstream EXECUTABLE
// code. Numbers, closed value sets and patterns are SPEC DATA — the same class as the JSON Schemas
// beside them — so they are transcribed here, one upstream symbol per declaration, with the
// upstream symbol name in each comment. Nothing in this file computes anything.
//
// WHO READS IT: `scripts/verify-dshgo-standard.ts` (the conformance gate) and the QA case
// `skills/dsh-qa/scripts/dshgo-standard.ts`. The live engine code in `packages/**` keeps its own
// runtime constants; the gate CROSS-CHECKS those against this table, so a drift between the shipped
// engine and the published standard is a gate failure rather than a silent divergence.

/** Upstream `PROTOCOL`: the one protocol major version this table describes. */
export const PROTOCOL: number = 1

/** The numeric limits the app, the bridge and the SDK share (upstream `LIMITS`). */
export interface DshGoLimits {
  /** Upstream `manifestBytes`: the serialized `dshGo` block's ceiling, in bytes. */
  readonly manifestBytes: number
  /** Upstream `perPlugin`: per-contribution-slot caps, keyed by surface name. */
  readonly perPlugin: Readonly<Record<string, number>>
  /** Upstream `textChars`: per-field display-text ceilings, measured in CODE POINTS. */
  readonly textChars: Readonly<Record<string, number>>
  /** Upstream `viewBytes`: one panel view's byte ceiling. */
  readonly viewBytes: number
  /** Upstream `viewNodes`: one panel view's component-node ceiling. */
  readonly viewNodes: number
  /** Upstream `viewDepth`: one panel view's nesting-depth ceiling. */
  readonly viewDepth: number
  /** Upstream `toolCardBytes`: one tool card view's byte ceiling. */
  readonly toolCardBytes: number
  /** Upstream `toolCardNodes`: one tool card view's component-node ceiling. */
  readonly toolCardNodes: number
  /** Upstream `dataBytes`: one pushed data patch's byte ceiling. */
  readonly dataBytes: number
  /** Upstream `patchBytes`: one stream patch's byte ceiling. */
  readonly patchBytes: number
  /** Upstream `dataHz`: how many data pushes per second one feed may emit. */
  readonly dataHz: number
  /** Upstream `invokeBytes`: one invoke request body's byte ceiling. */
  readonly invokeBytes: number
  /** Upstream `invokeValueBytes`: one invoke argument value's byte ceiling. */
  readonly invokeValueBytes: number
  /** Upstream `contextFieldBytes`: one context field's byte ceiling. */
  readonly contextFieldBytes: number
  /** Upstream `invokeBurst`: how many invokes may arrive back to back. */
  readonly invokeBurst: number
  /** Upstream `invokePerSecond`: the steady-state invoke rate per connection. */
  readonly invokePerSecond: number
  /** Upstream `invokeConcurrent`: how many invokes one plugin may run at once. */
  readonly invokeConcurrent: number
  /** Upstream `effectsPerInvoke`: how many effects one result may carry. */
  readonly effectsPerInvoke: number
  /** Upstream `insertChars`: the insert effect's text ceiling. */
  readonly insertChars: number
  /** Upstream `copyChars`: the copy effect's text ceiling. */
  readonly copyChars: number
  /** Upstream `commandArgsChars`: the command effect's argument ceiling. */
  readonly commandArgsChars: number
  /** Upstream `linkChars`: the link effect's URL ceiling. */
  readonly linkChars: number
  /** Upstream `handlerTimeoutMs`: how long one tap handler may run. */
  readonly handlerTimeoutMs: number
  /** Upstream `viewTimeoutMs`: how long one view function may run. */
  readonly viewTimeoutMs: number
  /** Upstream `firstDataWaitMs`: how long the app waits for a feed's first datum. */
  readonly firstDataWaitMs: number
  /** Upstream `effectWindowMs`: how long an effect stays applicable after the tap. */
  readonly effectWindowMs: number
  /** Upstream `streamConnections`: how many stream connections one app may open. */
  readonly streamConnections: number
  /** Upstream `streamSubscriptions`: how many subscriptions one stream connection may carry. */
  readonly streamSubscriptions: number
  /** Upstream `streamInboundFrameBytes`: one inbound stream frame's byte ceiling. */
  readonly streamInboundFrameBytes: number
  /** Upstream `streamOutboundFrameBytes`: one outbound stream frame's byte ceiling. */
  readonly streamOutboundFrameBytes: number
  /** Upstream `streamBacklogBytes`: one stream connection's backlog ceiling. */
  readonly streamBacklogBytes: number
  /** Upstream `heartbeatSeconds`: the websocket heartbeat period. */
  readonly heartbeatSeconds: number
  /** Upstream `idleTimeoutSeconds`: how long an idle stream connection survives. */
  readonly idleTimeoutSeconds: number
  /** Upstream `feedLingerMs`: how long a released feed stays addressable. */
  readonly feedLingerMs: number
  /** Upstream `feeds`: how many feeds one plugin may keep alive. */
  readonly feeds: number
  /** Upstream `assetBytes`: one served asset file's byte ceiling. */
  readonly assetBytes: number
  /** Upstream `violationsToDegrade`: how many protocol violations push a plugin to `degraded`. */
  readonly violationsToDegrade: number
  /** Upstream `pendingPerPlugin`: how many pending (deferred) invokes one plugin may hold. */
  readonly pendingPerPlugin: number
  /** Upstream `pendingDefaultMs`: the default pending window. */
  readonly pendingDefaultMs: number
  /** Upstream `pendingMinMs`: the shortest pending window a plugin may ask for. */
  readonly pendingMinMs: number
  /** Upstream `pendingMaxMs`: the longest pending window a plugin may ask for. */
  readonly pendingMaxMs: number
  /** Upstream `pendingLabelChars`: the pending label's text ceiling. */
  readonly pendingLabelChars: number
  /** Upstream `pendingEarlyResultMs`: how long a deferred invoke may still answer inline. */
  readonly pendingEarlyResultMs: number
  /** Upstream `turnNotesPerFeed`: how many turn notes one feed keeps. */
  readonly turnNotesPerFeed: number
}

/** Upstream `LIMITS`: the frozen numeric table, byte-for-byte the published values. */
export const LIMITS: DshGoLimits = Object.freeze({
  /** Upstream `manifestBytes`. */
  manifestBytes: 16384,
  /** Upstream `perPlugin` (the seven contribution surfaces). */
  perPlugin: Object.freeze({
    "composer.actions": 2,
    "message.actions": 2,
    "composer.strip": 1,
    panels: 4,
    "composer.tools": 2,
    "session.actions": 2,
    "turn.note": 1,
  }),
  /** Upstream `textChars` (measured per locale, in code points). */
  textChars: Object.freeze({
    composerTool: 8,
    sessionAction: 12,
    turnNote: 16,
    pluginTitle: 24,
    composerAction: 10,
    messageAction: 12,
    panelTitle: 16,
    stripText: 24,
    toast: 40,
  }),
  /** Upstream `viewBytes`. */
  viewBytes: 32768,
  /** Upstream `viewNodes`. */
  viewNodes: 120,
  /** Upstream `viewDepth`. */
  viewDepth: 8,
  /** Upstream `toolCardBytes`. */
  toolCardBytes: 8192,
  /** Upstream `toolCardNodes`. */
  toolCardNodes: 40,
  /** Upstream `dataBytes`. */
  dataBytes: 32768,
  /** Upstream `patchBytes`. */
  patchBytes: 16384,
  /** Upstream `dataHz`. */
  dataHz: 4,
  /** Upstream `invokeBytes`. */
  invokeBytes: 65536,
  /** Upstream `invokeValueBytes`. */
  invokeValueBytes: 4096,
  /** Upstream `contextFieldBytes`. */
  contextFieldBytes: 16384,
  /** Upstream `invokeBurst`. */
  invokeBurst: 8,
  /** Upstream `invokePerSecond`. */
  invokePerSecond: 4,
  /** Upstream `invokeConcurrent`. */
  invokeConcurrent: 4,
  /** Upstream `effectsPerInvoke`. */
  effectsPerInvoke: 4,
  /** Upstream `insertChars`. */
  insertChars: 2000,
  /** Upstream `copyChars`. */
  copyChars: 8000,
  /** Upstream `commandArgsChars`. */
  commandArgsChars: 500,
  /** Upstream `linkChars`. */
  linkChars: 2048,
  /** Upstream `handlerTimeoutMs`. */
  handlerTimeoutMs: 3000,
  /** Upstream `viewTimeoutMs`. */
  viewTimeoutMs: 3000,
  /** Upstream `firstDataWaitMs`. */
  firstDataWaitMs: 1000,
  /** Upstream `effectWindowMs`. */
  effectWindowMs: 3000,
  /** Upstream `streamConnections`. */
  streamConnections: 8,
  /** Upstream `streamSubscriptions`. */
  streamSubscriptions: 32,
  /** Upstream `streamInboundFrameBytes`. */
  streamInboundFrameBytes: 4096,
  /** Upstream `streamOutboundFrameBytes`. */
  streamOutboundFrameBytes: 49152,
  /** Upstream `streamBacklogBytes`. */
  streamBacklogBytes: 1048576,
  /** Upstream `heartbeatSeconds`. */
  heartbeatSeconds: 25,
  /** Upstream `idleTimeoutSeconds`. */
  idleTimeoutSeconds: 60,
  /** Upstream `feedLingerMs`. */
  feedLingerMs: 30000,
  /** Upstream `feeds`. */
  feeds: 64,
  /** Upstream `assetBytes`. */
  assetBytes: 1048576,
  /** Upstream `violationsToDegrade`. */
  violationsToDegrade: 5,
  /** Upstream `pendingPerPlugin`. */
  pendingPerPlugin: 2,
  /** Upstream `pendingDefaultMs`. */
  pendingDefaultMs: 30000,
  /** Upstream `pendingMinMs`. */
  pendingMinMs: 1000,
  /** Upstream `pendingMaxMs`. */
  pendingMaxMs: 60000,
  /** Upstream `pendingLabelChars`. */
  pendingLabelChars: 16,
  /** Upstream `pendingEarlyResultMs`. */
  pendingEarlyResultMs: 5000,
  /** Upstream `turnNotesPerFeed`. */
  turnNotesPerFeed: 64,
})

/** Upstream `SURFACES`: every contribution surface, in the bridge's own order. */
export const SURFACES: readonly string[] = Object.freeze([
  "composer.actions",
  "message.actions",
  "composer.strip",
  "panels",
  "composer.tools",
  "session.actions",
  "turn.note",
])

/** Upstream `PLACEMENT_PLUGIN`: the placement value a plugin chooses for itself. */
export const PLACEMENT_PLUGIN: string = "plugin"

/** Upstream `PLACEMENTS`: every value a panel's `placement` array may carry. */
export const PLACEMENTS: readonly string[] = Object.freeze([
  "session.tab",
  "features",
  "chat.panel",
  PLACEMENT_PLUGIN,
])

/** Upstream `PRESENTATIONS`: how a panel opens. */
export const PRESENTATIONS: readonly string[] = Object.freeze(["page", "sheet"])

/** Upstream `WANTS`: the content a tap may carry, `draft`/`clipboard` on composer surfaces only. */
export const WANTS: readonly string[] = Object.freeze(["draft", "clipboard", "message"])

/** Upstream `TONES`: the closed tone vocabulary of a view node. */
export const TONES: readonly string[] = Object.freeze(["good", "warn", "bad", "info", "muted"])

/** Upstream `SCOPE_KEYS`: the four keys a handler scope may carry. */
export const SCOPE_KEYS: readonly string[] = Object.freeze(["sessionId", "turnId", "messageId", "callId"])

/** Upstream `ID`: the shape of every contribution / panel / surface id. */
export const ID: RegExp = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/

/** Upstream `ICON`: the shape of an icon name. */
export const ICON: RegExp = /^[a-z][a-z0-9-]{0,31}$/

/** Upstream `PKG`: the shape of a plugin package name. */
export const PKG: RegExp = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

/** Upstream `SEMVER`: the three-part version shape (`minApp`, `engines.dsh`). */
export const SEMVER: RegExp = /^(\d+)\.(\d+)\.(\d+)$/

/**
 * One view budget, transcribed from upstream `sdk/plugin-kit/lib/view-check.js` `BUDGETS`.
 *
 * `strip` does not appear in `limits.js`; the app's own view checker is the authority for it, which
 * is why it is transcribed here beside the other two rather than invented.
 */
export interface DshGoViewBudget {
  /** The budget's own name, as the upstream table spells it. */
  readonly name: string
  /** Serialized byte ceiling. */
  readonly bytes: number
  /** Component-node ceiling. */
  readonly nodes: number
  /** Nesting-depth ceiling. */
  readonly depth: number
  /** Children-per-node ceiling. */
  readonly children: number
  /** Per-text-node character ceiling. */
  readonly text: number
}

/** Upstream `BUDGETS` (view-check.js): the three budgets the app enforces on a view tree. */
export const VIEW_BUDGETS: Readonly<Record<string, DshGoViewBudget>> = Object.freeze({
  /** Upstream `BUDGETS.toolCard`: a tool result's meta view. */
  toolCard: Object.freeze({ name: "toolCard", bytes: 8192, nodes: 40, depth: 6, children: 16, text: 200 }),
  /** Upstream `BUDGETS.panel`: a panel's view (live v2 and static v1). */
  panel: Object.freeze({ name: "panel", bytes: 32768, nodes: 120, depth: 8, children: 32, text: 200 }),
  /** Upstream `BUDGETS.strip`: a composer strip datum. */
  strip: Object.freeze({ name: "strip", bytes: 2048, nodes: 8, depth: 3, children: 4, text: 200 }),
})

/** Upstream `staticEffect` variants (invoke.schema.json): the ONLY kinds a manifest `effect` may use. */
export const STATIC_EFFECT_KINDS: readonly string[] = Object.freeze([
  "insert",
  "command",
  "open",
  "link",
  "copy",
  "toast",
])
