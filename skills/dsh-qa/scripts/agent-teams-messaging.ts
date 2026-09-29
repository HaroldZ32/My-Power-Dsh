#!/usr/bin/env node
// Case agent-teams-messaging (t36, REBUILT by t51): end-to-end QA for the R1 message
// channel that asserts THE SHIPPED USER PATH, not only the state primitives.
//
// THE F-1 DEFECT CLASS, pinned here so it cannot come back:
//   The first version of this case imported `lib/state.ts` and called
//   `appendMailboxDeduped` / `clearMailboxToWatermark` / `decideInterjection` DIRECTLY.
//   Every assertion was green while `agent_teams_send_message` — the tool a user
//   actually calls — still appended a SECOND record for the second identical send and
//   woke the recipient again. A green primitive is NOT a green capability: the library
//   was correct and unreachable at the same time, and every layer of checks missed it
//   because each one asked "does the module behave?" and nobody asked "does anything
//   ever CALL it?". The primitive lanes are kept (cheap localisation of a regression)
//   but they can never again be the only evidence: the SHIPPED-PATH lanes drive the real
//   tool registrations against the real `installTeamScheduler` and count deliveries on
//   the real member-queue seam.
//
//   1) dedup      — N identical sends inside the window fold into ONE record with
//                   dupCount=N and ONE unread (delivery is at-most-once).
//      control    — same content from a DIFFERENT sender is NOT folded.
//   2) clear      — archive-first: tombstone rows + a recoverable sidecar + one audit
//                   event; the live file keeps naming the ids.
//      control    — no hard-delete path exists anywhere under the state root.
//   3) interjection — a pending request never reaches a member's ordinary inbox and is
//                   filtered out of BOTH of the scheduler's auto-delivery reads.
//      control    — the extracted scheduler predicate is falsifiable: break the kind
//                   and the same input DOES pass the filter.
//
// 1) offline --self-test: the R1 surface exists; the shipped send/clear/interject wiring
//    is present AND this case still references the shipped path (a future edit cannot
//    silently downgrade it back to a primitive-only case); the scheduler's exclusion
//    region covers BOTH auto-delivery reads; the RED-arm transform still applies; and
//    VENDOR_LOCK's `skills` treeSha recomputes from the working tree (AGENTS.md §9/§11).
// 2) real run: isolated DSH_HOME + sandbox HOME + sandbox workspace; the mpd preset is
//    REALLY MOUNTED AND BOOTED (not --dump-config); the SHIPPED-PATH lanes plant a real
//    team record and drive agent_teams_send_message / agent_teams_mailbox_clear /
//    agent_teams_interject_* through the real tool + scheduler surface, counting
//    deliveries on `ctx.subagents.prompt` (the member-queue seam `deliverToMember`
//    itself uses); a RED arm re-runs the dedup lane against a PRE-FIX tools.ts built by
//    reverting the recorded t49 regions; `assertSessionsSandboxed` proves no session key
//    for the real workspace was written. Never touches the real ~/.dsh.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.ts"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.ts"
import { DSH_MISSING, dshCommand, resolveDshLauncher } from "./lib/dsh-launcher.ts"
import type { SessionSandboxVerdict } from "./lib/workspace-isolation.ts"

/** The repository root, derived from this case's own location (`<root>/skills/dsh-qa/scripts/`). */
const repoRoot: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The adopted body's `lib/`, whose `@ts-nocheck` TypeScript modules every fixture lane loads. */
const PLUGIN_LIB: string = join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib")
/** The shipped state module the R1 surface lives in (the adopted upstream body, converted to `.ts`). */
const STATE_TS: string = join(PLUGIN_LIB, "state.ts")
/** The shipped scheduler module whose exclusion region the predicate lanes extract. */
const SCHEDULER_TS: string = join(PLUGIN_LIB, "scheduler.ts")
/** The shipped tool layer the RED arm reverts and re-loads from a copied package. */
const TOOLS_TS: string = join(PLUGIN_LIB, "tools.ts")
/** The vendor lock whose `skills` fingerprint the self-test pins against the working tree. */
const LOCK_PATH: string = join(repoRoot, "VENDOR_LOCK.json")
/** The QA skill document whose case table must carry exactly one row for this case. */
const SKILL_MD: string = join(repoRoot, "skills", "dsh-qa", "SKILL.md")
/** The case slug, used for the SKILL.md row lookup and every failure banner. */
const CASE_SLUG: string = "agent-teams-messaging"
/** The team id the primitive lanes plant their records under. */
const TEAM: string = "t36-messaging"
// Shipped-path fixture identities (planted team record; the ids never reach the real
// workspace because every lane runs under the sandbox).
/** The planted captain's session id, and the identity a mailbox clear is authorized by. */
const CAPTAIN_ID: string = "session-t51-captain"
/** The planted teammate's session id: the recipient every delivery count filters on. */
const MEMBER_ID: string = "session-t51-member"
/** The teammate's member name, which is also its mailbox key and dedup key. */
const MEMBER_NAME: string = "Senior Engineer"
/** The other participant's session id, used to prove a different sender is not folded. */
const ASKER_ID: string = "session-t51-asker"
/** The other participant's member name, used as the interjection requester. */
const ASKER_NAME: string = "Lead"
/** How long the real run waits for the measured revision to settle, in ms (AGENTS.md §7). */
const SETTLE_MS: number = 50000
// The state layout the scheduler resolves: stateRootOf(workspace) = <ws>/<stateDir>.
/** The workspace-relative state directory the scheduler and the tool layer are configured with. */
const STATE_DIR: string = join(".mpd", "team")
/** Output substrings that mean the plugin tree failed to apply, never a healthy boot. */
const CRASH_SIGNATURES: readonly string[] = [
  "unsupported JSON schema",
  "JsonSchemaError",
  "plugin tree failed to load",
  "failed to apply loader entry",
  "cannot get property",
]
/** Every child-process command line and its merged output, for the evidence `output.log`. */
const LOG: string[] = []

/**
 * The members of the adopted `tools.ts` namespace this case applies. The adopted plugin's `lib/` is
 * `@ts-nocheck` TypeScript with no declaration file AND every fixture loads it by a COMPUTED
 * specifier (the shipped lib, or a copied pre-fix lib for the RED arm), so this interface is the
 * only declaration TypeScript can be given for that namespace.
 */
interface AdoptedToolsModule {
  /**
   * Register every agent-teams tool on the given host context.
   * @param ctx The host context stand-in the registrations are recorded on.
   * @param options The row configuration the tool layer reads (the state directory).
   */
  registerAgentTeamsTools(ctx: FixtureContext, options: { readonly stateDir: string }): void
}

/** The installed scheduler's handle: the kick every delivery lane drives. */
interface AdoptedScheduler {
  /**
   * Run one idle-edge delivery pass for the named member.
   * @param workspace The workspace whose `.mpd/team` state is read.
   * @param teamId The team whose member is kicked.
   * @param name The member to deliver to.
   * @param captain The captain identity the pass is driven as.
   * @returns The pass's own result, which no lane here inspects.
   */
  kickMember(workspace: string, teamId: string, name: string, captain: FixtureAgent): Promise<unknown>
}

/**
 * The members of the adopted `scheduler.ts` namespace this case applies; see `AdoptedToolsModule`
 * for why the declaration has to be written here instead of imported.
 */
interface AdoptedSchedulerModule {
  /**
   * Install the scheduler on the given host context.
   * @param ctx The host context stand-in the scheduler is applied to.
   * @param options The row configuration the scheduler reads (the state directory).
   * @returns The installed scheduler's handle.
   */
  installTeamScheduler(ctx: FixtureContext, options: { readonly stateDir: string }): AdoptedScheduler
}

/** One mailbox record as the adopted `state.ts` writes it; optional members are absent on some rows. */
interface MailboxRecord {
  /** The record's unique id inside its own mailbox file, which every lane asserts on. */
  readonly id: string
  /** The sender's member name — the dedup key's second half, so another sender must not fold. */
  readonly from?: string
  /** The payload text; an archive-first clear rewrites it to the empty string on a tombstone row. */
  readonly content: string
  /** How many identical sends folded into this record; 1 on a never-folded row. */
  readonly dupCount?: number
  /** Set by the archive-first clear, which keeps the id visible while emptying the payload. */
  readonly tombstone?: boolean
  /** The interjection marker kind, present only on a row of the interjection queue. */
  readonly kind?: string
  /** When the recipient acknowledged the record, in ms since the epoch; absent while unread. */
  readonly readAt?: number
}

/** One row of the interjection queue, as the state module's own readers return it. */
interface InterjectionRow {
  /** The request id a decision call addresses. */
  readonly id: string
  /** The lifecycle state: `pending`, `approved`, `rejected` or `expired`. */
  readonly status: string
  /** The wall-clock expiry, in ms since the epoch (`ts + INTERJECTION_TTL_MS` at enqueue). */
  readonly expiresAt: number
  /** The asking member's name. */
  readonly from: string
}

/** One parsed `interjections.jsonl` row, read straight off disk by the queue-file assertions. */
interface InterjectionQueueRow extends InterjectionRow {
  /** The one-line summary the request was queued with, which the queue lane asserts on. */
  readonly summary?: string
  /** Why the requester is blocked. */
  readonly reason?: string
  /** Where the request applies (a lane or step label). */
  readonly location?: string
  /** The enqueue timestamp, in ms since the epoch; the TTL lane rewrites it to age one row. */
  readonly ts?: number
}

/** A message handed to the shipped state module for appending. */
interface MailboxMessage {
  /** The caller-chosen record id. */
  readonly id: string
  /** The sender's member name; dedup only folds two sends that share it. */
  readonly from: string
  /** The recipient's member name or mailbox key. */
  readonly to: string
  /** The payload text. */
  readonly content: string
  /** The record timestamp, in ms since the epoch. */
  readonly ts: number
}

/** The dedup append's verdict: whether this send folded into an existing in-window record. */
interface DedupAppendResult {
  /** `true` when the send folded into the sender's existing identical record instead of appending. */
  readonly folded: boolean
}

/** The archive-first clear's outcome, which the clear lanes assert on. */
interface ClearOutcome {
  /** The ids the clear removed from the live file's live view. */
  readonly cleared: string[]
  /** The audit event the clear appended beside the tombstones. */
  readonly audit: {
    /** The event kind, `mailbox-cleared`. */
    readonly kind: string
    /** How many records the clear tombstoned. */
    readonly clearedCount: number
    /** The ids the audit event names. */
    readonly clearedIds: string[]
  }
  /** Absolute path of the recoverable sidecar that holds the cleared payloads. */
  readonly sidecar: string
  /** The unread count the clear reports for the mailbox after the watermark, in records. */
  readonly unread_after: number
}

/** A queued interjection request, as the shipped tools and the primitive lane both write it. */
interface InterjectionRequest {
  /** The request id the decision call addresses. */
  readonly id: string
  /** The asking member's name. */
  readonly from: string
  /** The addressed member's name or mailbox key. */
  readonly to: string
  /** The body re-posted to the requester once the request is approved. */
  readonly content: string
  /** The enqueue timestamp, in ms since the epoch. */
  readonly ts: number
  /** The one-line summary the queue row carries. */
  readonly summary: string
  /** Why the requester is blocked. */
  readonly reason: string
  /** Where the request applies (a lane or step label). */
  readonly location: string
}

/**
 * The members of the adopted `state.ts` namespace this case drives (the R1 message channel); see
 * `AdoptedToolsModule` for why the declaration has to be written here instead of imported. The index
 * signature exists for the surface check, which looks up export NAMES the case holds as data.
 */
interface AdoptedStateModule {
  /** Named-export lookup for the surface probe, where the export list is a string array. */
  readonly [name: string]: unknown
  /** The dedup window, in ms, the shipped send path resolves per call. */
  readonly MAILBOX_DEDUP_WINDOW_MS: number
  /** The interjection TTL, in ms; the self-test pins it at exactly 30 minutes. */
  readonly INTERJECTION_TTL_MS: number
  /** The record `kind` that marks an interjection-queue row. */
  readonly INTERJECTION_KIND: string
  /** The pseudo-member name of the interjection queue file. */
  readonly INTERJECTION_QUEUE: string
  /** The captain mailbox key an approved request is re-posted under. */
  readonly CAPTAIN_KEY: string
  /** Append a message, folding an identical in-window send from the same sender into it. */
  appendMailboxDeduped(stateRoot: string, teamId: string, recipient: string, message: MailboxMessage): Promise<DedupAppendResult>
  /** Append a message verbatim, with no dedup folding. */
  appendMailbox(stateRoot: string, teamId: string, recipient: string, message: MailboxMessage): Promise<unknown>
  /** Every record in a mailbox, tombstones included. */
  readMailbox(stateRoot: string, teamId: string, recipient: string): Promise<MailboxRecord[]>
  /** The records a member has not acknowledged yet. */
  readUnreadMailbox(stateRoot: string, teamId: string, recipient: string): Promise<MailboxRecord[]>
  /** The records the live file still names, tombstones excluded. */
  readLiveMailbox(stateRoot: string, teamId: string, recipient: string): Promise<MailboxRecord[]>
  /**
   * Clear every record at or below the watermark, archive-first.
   * @param stateRoot The workspace state root.
   * @param teamId The team whose mailbox is cleared.
   * @param recipient The mailbox owner.
   * @param watermark The clear's upper bound, in ms since the epoch.
   * @param options The clock the audit event is stamped with.
   * @returns The clear's outcome, tombstones and sidecar included.
   */
  clearMailboxToWatermark(stateRoot: string, teamId: string, recipient: string, watermark: number, options?: { readonly now?: number }): Promise<ClearOutcome>
  /** Queue an interjection request into the queue that is never auto-delivered. */
  enqueueInterjection(stateRoot: string, teamId: string, request: InterjectionRequest): Promise<InterjectionRow>
  /** The interjection rows still pending a decision. */
  readPendingInterjections(stateRoot: string, teamId: string): Promise<InterjectionRow[]>
  /** Every interjection row, decided or not. */
  readInterjections(stateRoot: string, teamId: string): Promise<InterjectionRow[]>
  /**
   * Expire the pending rows whose TTL has passed.
   * @param stateRoot The workspace state root.
   * @param teamId The team whose queue is ticked.
   * @param options The clock the expiry is evaluated against.
   * @returns The ids that expired in this tick.
   */
  expireInterjections(stateRoot: string, teamId: string, options?: { readonly now?: number }): Promise<string[]>
  /**
   * Record a decision and re-post an approved request as an ordinary message.
   * @param stateRoot The workspace state root.
   * @param teamId The team whose queue is decided.
   * @param id The request id being decided.
   * @param decision The decision, `approved` or `rejected`.
   * @param options The clock the decision is stamped with.
   * @returns The decided row.
   */
  decideInterjection(stateRoot: string, teamId: string, id: string, decision: string, options?: { readonly now?: number }): Promise<InterjectionRow>
}

/**
 * The predicate module assembled from the scheduler's extracted exclusion region at runtime, so its
 * declaration is local for the same reason `AdoptedToolsModule` is.
 */
interface DeliverablePredicateModule {
  /**
   * Keep only the unread records the scheduler may auto-deliver.
   * @param records The unread records read from a mailbox.
   * @returns The subset the scheduler's shipped filter lets through.
   */
  deliverableUnread(records: readonly MailboxRecord[]): MailboxRecord[]
}

/**
 * The fields of a shipped tool's JSON result this case reads. The adopted tool layer is untyped
 * JavaScript, so each member below records a READ the lanes perform — `pending` is required because
 * the decide lane chains straight into it, not because every tool emits it.
 */
interface ToolResult {
  /** `send_message`: `duplicate` when the send folded into an existing record instead of appending. */
  readonly delivered: string
  /** `send_message`: the id of the record the send appended to (or folded into). */
  readonly message_id: string
  /** `interject_request`/`mailbox_clear`: the id the tool acted on. */
  readonly request_id: string
  /** The tool's lifecycle verdict for the row it acted on. */
  readonly status: string
  /** `interject_request`: whether the pending request reached any auto-delivery lane. */
  readonly delivered_to_anyone: boolean
  /** `interject_decide --action list`: the rows still pending a decision. */
  readonly pending: readonly InterjectionRow[]
  /** `mailbox_clear`: how many records the clear tombstoned. */
  readonly cleared: number
  /** `mailbox_clear`: the unread count after the watermark. */
  readonly unread_after: number
}

/** A tool registration as the adopted body hands it to the host: a name plus its executor. */
interface ToolDefinition {
  /** The tool name the case addresses the registration by. */
  readonly name: string
  /**
   * Run the tool.
   * @param args The tool's own argument object.
   * @param exec The executing agent, which is what the tool authorizes against.
   * @returns The tool's JSON result.
   */
  execute(args: Record<string, unknown>, exec: { readonly agent: FixtureAgent }): ToolResult
}

/** The minimal live-agent stand-in the shipped tool layer reads: identity, route and session header. */
interface FixtureAgent {
  /** The agent's session id, which is also its key in the fixture's live-agent registry. */
  readonly id: string
  /** Always `idle`, so a kick finds the member at an idle edge. */
  readonly status: string
  /** The provider/model route the tool layer resolves for this agent. */
  readonly options: {
    /** The provider id the fixture pins for every participant. */
    readonly provider: string
    /** The model id the fixture pins for every participant. */
    readonly model: string
  }
  /** The session surface: the sandbox cwd plus the request-header factory the tools call. */
  readonly session: {
    /** The session header, whose `cwd` is the sandbox workspace all state resolves under. */
    readonly header: { readonly cwd: string }
    /** The per-request provider/model config the shipped delivery path reads. */
    readonly requestHeader: () => { readonly config: { readonly provider: string; readonly model: string } }
  }
}

/** The member-queue seam every counted delivery goes through (`deliverToMember` uses it too). */
interface FixtureSubagents {
  /**
   * Queue one delivery to a member session.
   * @param request The delivery: the recipient session id plus the packed body.
   * @returns The synthetic message id the caller records.
   */
  readonly prompt: (request: { readonly childSessionId: string; readonly content: unknown }) => Promise<{ readonly messageId: string }>
  /** Accepted by the adopted layer, never called by these lanes. */
  readonly followup: () => void
  /** Accepted by the adopted layer, never called by these lanes. */
  readonly sendMessage: () => void
  /** Accepted by the adopted layer, never called by these lanes. */
  readonly interrupt: () => void
}

/** The host context stand-in `registerAgentTeamsTools` and `installTeamScheduler` are applied to. */
interface FixtureContext {
  /** Tool registration: the adopted layer's own seam, recorded into the fixture's map. */
  readonly tools: { register: (definition: ToolDefinition) => void }
  /** The live-agent registry the tool layer resolves members through. */
  readonly agents: {
    /** Resolve one session id, or `undefined` when the fixture does not know it. */
    get: (id: string) => FixtureAgent | undefined
    /** Every live agent, in insertion order. */
    list: () => FixtureAgent[]
  }
  /** The member-queue seam the deliveries are counted on. */
  readonly subagents: FixtureSubagents
  /** No-op fiber hook, so applying the tools starts no real effect. */
  readonly effect: () => void
  /** No-op event subscription, for the same reason. */
  readonly on: () => void
  /** A silent logger: the fixture must not print into the case's own output. */
  readonly logger: {
    /** Swallow the adopted layer's warnings. */
    readonly warn: () => void
    /** Swallow the adopted layer's info lines. */
    readonly info: () => void
    /** Swallow the adopted layer's errors. */
    readonly error: () => void
    /** Swallow the adopted layer's debug lines. */
    readonly debug: () => void
  }
  /** Service lookup, deliberately empty so no real service can be reached. */
  readonly get: () => undefined
  /** The model-call seam the adopted layer resolves a call config through. */
  readonly llm: {
    /** Resolve the provider/model pair for one request. */
    readonly resolveCallConfig: (request: { readonly provider: string; readonly model: string }) => Promise<{ readonly provider: string; readonly model: string }>
    /** The model list; the fixture pins its route, so this stays empty. */
    readonly listModels: () => Promise<readonly unknown[]>
  }
}

/** One counted delivery on the member-queue seam, so a lane can filter by recipient. */
interface DeliveryRecord {
  /** The recipient's session id, which is what a lane counts. */
  readonly to: string
  /** The delivered text: the packed body, or the JSON of a non-string payload. */
  readonly content: string
}

/** The planted fixture: the real tool + scheduler surface plus every observation a lane needs. */
interface ShippedFixture {
  /** The state root the planted team record lives under (`<workspace>/.mpd/team`). */
  readonly stateRoot: string
  /** The planted team id, unique per lane so the lanes cannot share state. */
  readonly teamId: string
  /** The tools the real registration recorded, keyed by tool name. */
  readonly tools: Map<string, ToolDefinition>
  /** Every delivery counted on the member-queue seam, in order. */
  readonly deliveries: DeliveryRecord[]
  /** The host context stand-in the tools and the scheduler were applied to. */
  readonly ctx: FixtureContext
  /** The captain agent, whose identity authorizes a mailbox clear. */
  readonly captain: FixtureAgent
  /** The teammate the delivery lanes count. */
  readonly memberAgent: FixtureAgent
  /** The other participant, used to prove a different sender is not folded. */
  readonly askerAgent: FixtureAgent
  /** The shipped `state.ts` namespace this fixture was planted against. */
  readonly state: AdoptedStateModule
  /**
   * Invoke one registered tool as if the given agent called it.
   * @param name The tool name.
   * @param args The tool's argument object.
   * @param caller The executing agent; defaults to the captain.
   * @returns The tool's JSON result.
   */
  readonly call: (name: string, args: Record<string, unknown>, caller?: FixtureAgent) => Promise<ToolResult>
  /**
   * Drive one scheduler kick for the named member.
   * @param name The member to deliver to.
   * @returns The pass's own result.
   */
  readonly kick: (name: string) => Promise<unknown>
}

/** The knobs `plantFixture` accepts, so the RED arm can plant against a copied pre-fix lib. */
interface PlantFixtureOptions {
  /** The `lib/` directory to load `tools.ts`/`scheduler.ts`/`state.ts` from; defaults to the shipped one. */
  readonly libDir?: string
  /** The team id to plant under; defaults to the primitive lane's team. */
  readonly teamId?: string
}

/** A directory's vendor-lock fingerprint: how many files it holds and their folded hash. */
interface TreeSha {
  /** How many files the directory holds, `node_modules` and Python caches excluded. */
  readonly fileCount: number
  /** The folded hash over the sorted POSIX-spelled relpaths and their per-file hashes. */
  readonly treeSha: string
}

/** One asset's fingerprint inside `VENDOR_LOCK.json`. */
interface VendorLockAsset {
  /** How many files the pinned directory holds. */
  readonly fileCount: number
  /** The folded tree hash the lock records for that directory. */
  readonly treeSha: string
}

/** The parts of `VENDOR_LOCK.json` this case reads, so a stale pin can be named field by field. */
interface VendorLock {
  /** The pinned assets, keyed by asset name; `skills` is the one asserted here. */
  readonly assets: Record<string, VendorLockAsset>
}

/** The outcome of consuming one `appendMailboxDeduped(...)` statement out of `tools.ts`. */
type ConsumedCall = ConsumedCallAbsent | ConsumedCallUnterminated | ConsumedCallFound

/** The stable head is absent: the shipped member send path lost its dedup wiring (a regression). */
interface ConsumedCallAbsent {
  /** The discriminator: the anchor could not be found at all. */
  readonly reason: "absent"
}

/** The statement shape changed: no `);` terminates the line, so the transform refuses to guess. */
interface ConsumedCallUnterminated {
  /** The discriminator: the anchor was found but its statement has no terminator. */
  readonly reason: "unterminated"
  /** Index of the first character of the line the anchor sits on. */
  readonly from: number
  /** The 1-based line number the anchor sits on, so the failure can name it. */
  readonly line: number
}

/** The consumed statement, in the source's own coordinates. */
interface ConsumedCallFound {
  /** Declared `undefined` and never set, so the union keeps one readable discriminant everywhere. */
  readonly reason?: undefined
  /** Index of the first character of the statement's own line. */
  readonly from: number
  /** Index one past the statement's `);` terminator. */
  readonly to: number
  /** The statement's bytes, which the revert replaces with the recorded pre-fix body. */
  readonly text: string
}

/** The pre-fix source plus the byte counts that make the transform auditable in `result.json`. */
interface RevertedWiring {
  /** The reverted `tools.ts` source. */
  readonly source: string
  /** The byte size of each reverted piece, so the evidence shows what actually changed. */
  readonly transform: {
    /** Byte length of the captain-path region that was replaced. */
    readonly captainRegionBytes: number
    /** Byte length of the consumed member call statement. */
    readonly memberRegionBytes: number
    /** Byte length of the delivery-guard region that was replaced. */
    readonly guardRegionBytes: number
    /** Byte length of the transformed source. */
    readonly outBytes: number
  }
}

/**
 * One recorded lane outcome: the aggregate verdict plus the raw values the evidence file carries.
 * The index signature is what lets `steps` gain a member per lane while every value keeps an `ok`.
 */
interface StepOutcome {
  /** Whether the lane's assertions all held. */
  readonly ok: boolean
  /** Every other recorded value, kept verbatim in `result.json`. */
  readonly [key: string]: unknown
}

/** One completed child process: its exit status and its merged output, as the log records them. */
interface RunOutcome {
  /** The child's exit code, or `null` when it could not be spawned at all. */
  readonly status: number | null
  /** stdout and stderr concatenated, in that order. */
  readonly out: string
}

/** The knobs `runSync` accepts for the one child process it spawns. */
interface RunOptions {
  /** Kill the child after this many milliseconds; defaults to 15 minutes. */
  readonly timeout?: number
  /** Working directory for the child; defaults to the repository root. */
  readonly cwd?: string
}

/**
 * Print a failure prefixed with the case slug and end the run with exit 1.
 * @param message The failure text, naming the violated contract.
 * @returns Never: the process exits on this call, which is what narrows every caller's union.
 */
function fail(message: string): never { console.error("[" + CASE_SLUG + "] FAIL: " + message); process.exit(1) }

// ---------------------------------------------------------------- small helpers

/** Bytes as the harness/vendor lock reads them: text (no NUL) normalized to LF. */
function readBytes(path: string): Buffer {
  /** The file's raw bytes, read in one call so a partially written file cannot be split. */
  const buf: Buffer = readFileSync(path)
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"))
  return buf
}

/**
 * The SHA-256 of one file's normalized bytes, in hex.
 * @param path The file to hash.
 * @returns The lowercase hex digest the vendor lock records.
 */
function sha256Of(path: string): string { return createHash("sha256").update(readBytes(path)).digest("hex") }

/**
 * Reproduce `scripts/verify-vendor.ts`'s treeSha for one asset directory: relpath
 * sorted, each `relpath\n<sha256 of the normalized bytes>\n` folded into one hash and
 * `node_modules` skipped. Reimplemented here so the self-test can PIN VENDOR_LOCK to
 * the working tree without shelling out to the gate under test.
 * @param dir The asset directory to fingerprint.
 * @returns The file count and the folded tree hash for that directory.
 */
function buildTreeSha(dir: string): TreeSha {
  /** Absolute paths of every file the walk collected, in readdir order. */
  const out: string[] = []
  /** Collect the files under `d`, skipping vendored and Python cache directories. */
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      /** The candidate entry's absolute path, probed for directory-ness below. */
      const p: string = join(d, entry)
      if (entry === "node_modules") continue
      if (entry === "__pycache__" || entry.endsWith(".pyc") || entry.endsWith(".pyo")) continue
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(dir)
  // POSIX-spelled relpaths, exactly like scripts/verify-vendor.ts: a native separator would fold
  // a DIFFERENT hash on Windows than the lock records (see that gate's treeSha comment).
  /** The sorted POSIX-spelled relpaths, so the fold is stable across platforms. */
  const rel: string[] = out.map((f) => f.slice(dir.length + 1).split(sep).join("/")).sort()
  /** The running hash the sorted relpaths and their per-file hashes are folded into. */
  const h = createHash("sha256")
  for (const f of rel) h.update(f + "\n" + sha256Of(join(dir, f)) + "\n")
  return { fileCount: rel.length, treeSha: h.digest("hex") }
}

/**
 * Key-order-independent deep comparison, so a fixture edit cannot fake a pass.
 * @param value Any value; arrays and plain objects are normalized, everything else is returned as-is.
 * @returns The canonical form: object keys sorted, arrays mapped elementwise.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    // A non-null `object` carries no index signature and TypeScript cannot narrow one into being, so
    // this is the boundary where the parsed-JSON shape is named; the assertion is unavoidable here.
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]))
  }
  return value
}

/**
 * Whether two values are the same JSON document, ignoring key order.
 * @param a The first value.
 * @param b The second value.
 * @returns `true` when both canonicalize to the same JSON text.
 */
function sameJson(a: unknown, b: unknown): boolean { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)) }

/**
 * Extract a scheduler region body, failing loudly when the seam moved.
 * @param source The shipped source to slice.
 * @param marker The `mpd-delta` region marker (without the `#region`/`#endregion` prefixes).
 * @returns The region's body, or `null` when either marker is missing or out of order.
 */
function extractRegion(source: string, marker: string): string | null {
  /** The opening region marker, comment prefix included. */
  const start: string = "#region mpd-delta " + marker
  /** The closing region marker, comment prefix included. */
  const end: string = "#endregion mpd-delta " + marker
  /** Index of the opening marker, or -1 when the region is gone. */
  const from: number = source.indexOf(start)
  /** Index of the closing marker, or -1 when the region is gone. */
  const to: number = source.indexOf(end)
  if (from < 0 || to < 0 || to < from) return null
  // The slice ends at the `//` that opens the `//#endregion` line, so the leading
  // comment marker is dropped here and re-supplied by the replacement body: slicing
  // to `to` alone would leave a dangling `//` and losing it would leave a bare
  // `#endregion`, which the parser rejects as a private field.
  return source.slice(source.indexOf("\n", from) + 1, source.lastIndexOf("//", to))
}

/**
 * Run the scheduler's REAL predicate body (extracted from the shipped source) in an
 * isolated module, so the exclusion is driven by code, not by a re-typed copy. The
 * region references the imported constant `INTERJECTION_KIND`; it is bound here to the
 * value the shipped `state.ts` module actually exports, so a silent constant change
 * cannot keep the predicate "green" against a stale literal.
 * @param predicateSource The extracted region body.
 * @param interjectionKind The `INTERJECTION_KIND` value the shipped module exports.
 * @returns A `data:` URL importing the assembled module, ready for a dynamic `import()`.
 */
function buildDeliverablePredicate(predicateSource: string, interjectionKind: string): string {
  /** The region body with the imported constant inlined, so the module is self-contained. */
  const body: string = predicateSource.replaceAll("INTERJECTION_KIND", JSON.stringify(interjectionKind))
  return "data:text/javascript;base64," + Buffer.from(
    body + "\nexport { deliverableUnread };\n", "utf8",
  ).toString("base64")
}

// -------------------------------------------------- the shipped-path fixture

/**
 * Plant a REAL team record and register the REAL tool + scheduler surface against it.
 *
 * Every "delivery" counted here is a call to the harness member-queue seam
 * (`ctx.subagents.prompt`), the same seam `deliverToMember` uses in production, so an
 * assertion can never be satisfied by writing a record behind the plugin's back.
 * @param workspace The sandbox workspace the fixture's state root lives under.
 * @param options The lib directory to load and the team id to plant under.
 * @returns The fixture: the real surface plus every observation the lanes count on.
 */
async function plantFixture(workspace: string, { libDir = PLUGIN_LIB, teamId = TEAM }: PlantFixtureOptions = {}): Promise<ShippedFixture> {
  /** The state root the planted team record is written under. */
  const stateRoot: string = join(workspace, STATE_DIR)
  mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
  /** One clock reading shared by every planted record, so the fixture is internally consistent. */
  const now: number = Date.now()
  /** The two participants the planted team record declares. */
  const members = [
    { id: MEMBER_ID, name: MEMBER_NAME, role: "engineer", status: "idle", joinedAt: now },
    { id: ASKER_ID, name: ASKER_NAME, role: "reviewer", status: "idle", joinedAt: now },
  ]
  writeFileSync(join(stateRoot, teamId, "team.json"), JSON.stringify({
    id: teamId, name: "t51", captainSessionId: CAPTAIN_ID, createdAt: now, updatedAt: now,
    taskSeq: 0, phase: "running", members, tasks: [],
  }, null, 2))

  /** Build one live-agent stand-in for a session id, so all participants share one shape. */
  const agent = (id: string): FixtureAgent => ({
    id, status: "idle",
    options: { provider: "deepseek-official", model: "deepseek-v4-flash" },
    session: {
      header: { cwd: workspace },
      requestHeader: () => ({ config: { provider: "deepseek-official", model: "deepseek-v4-flash" } }),
    },
  })
  /** The captain stand-in, which is also the default caller and the clear authority. */
  const captain: FixtureAgent = agent(CAPTAIN_ID)
  /** The live-agent registry the shipped tool layer resolves members through. */
  const live: Record<string, FixtureAgent> = { [CAPTAIN_ID]: captain, [MEMBER_ID]: agent(MEMBER_ID), [ASKER_ID]: agent(ASKER_ID) }

  /** The tool registrations the shipped layer records, keyed by tool name. */
  const tools = new Map<string, ToolDefinition>()
  /** Every delivery counted on the member-queue seam, in order. */
  const deliveries: DeliveryRecord[] = []
  /** The member-queue seam stand-in: records each delivery and answers with a synthetic id. */
  const subagents: FixtureSubagents = {
    prompt: async (request) => {
      deliveries.push({
        to: request.childSessionId,
        content: typeof request.content === "string" ? request.content : JSON.stringify(request.content),
      })
      return { messageId: `delivery-${deliveries.length}` }
    },
    followup: () => {},
    sendMessage: () => {},
    interrupt: () => {},
  }
  /** The host context stand-in both the tool layer and the scheduler are applied to. */
  const ctx: FixtureContext = {
    tools: { register: (definition) => tools.set(definition.name, definition) },
    agents: { get: (id) => live[id], list: () => Object.values(live) },
    subagents,
    effect: () => {}, on: () => {},
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    get: () => undefined,
    llm: { resolveCallConfig: async (r) => ({ provider: r.provider, model: r.model }), listModels: async () => [] },
  }

  /** The shipped tool layer, loaded by a computed specifier so the RED arm can load a copy. */
  const toolsModule: AdoptedToolsModule = await import(join(libDir, "tools.ts"))
  /** The shipped scheduler, loaded the same way. */
  const schedulerModule: AdoptedSchedulerModule = await import(join(libDir, "scheduler.ts"))
  /** The shipped state module the tools and the scheduler both close over. */
  const stateModule: AdoptedStateModule = await import(join(libDir, "state.ts"))
  toolsModule.registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
  /** The installed scheduler handle every kick goes through. */
  const runtime: AdoptedScheduler = schedulerModule.installTeamScheduler(ctx, { stateDir: STATE_DIR })

  /**
   * Invoke one registered tool as the given caller.
   * @param name The tool name.
   * @param args The tool's argument object.
   * @param caller The executing agent; defaults to the captain.
   * @returns The tool's JSON result.
   */
  const call = async (name: string, args: Record<string, unknown>, caller: FixtureAgent = captain): Promise<ToolResult> => {
    /** The recorded definition for the requested name, or `undefined` when nothing registered it. */
    const definition: ToolDefinition | undefined = tools.get(name)
    if (definition === undefined) throw new Error(`tool "${name}" is not registered on the shipped surface`)
    return definition.execute(args, { agent: caller })
  }
  return {
    stateRoot, teamId, tools, deliveries, ctx, captain,
    memberAgent: live[MEMBER_ID], askerAgent: live[ASKER_ID], state: stateModule,
    call,
    // The scheduler's own kick, bound to this fixture's workspace/team and the captain identity.
    kick: (name: string): Promise<unknown> => runtime.kickMember(workspace, teamId, name, captain),
  }
}

/**
 * Build a PRE-FIX `tools.ts`: the `mpd-delta` regions t49 added are reverted to the
 * recorded pre-repair shape (specimens taken from the commit that introduced them, kept
 * in `evidence/omo-align/qa-shipped-path/…`), while the module keeps importing the
 * current `state.ts`. This is the RED arm: the SAME scenario against the shipped path as
 * it was before the repair, so the positive assertion is provably not tautological.
 * The MEMBER half is addressed by its stable call head (see `MEMBER_CALL_HEAD`): the
 * member path is not region-wrapped, so it cannot be extracted like the two regions and
 * must not be pinned as a full-statement literal (t54 — that is what rotted it).
 */
/**
 * The member send path's dedup call, addressed by its STABLE HEAD (t54). The previous
 * fixture pinned the WHOLE single-line statement, so the P1e change that resolved the
 * dedup window per call (adding a multi-line options argument) rotted it silently: the
 * transform then failed with a generic message and read like a refactor instead of the
 * regression detector it is. Only the head is anchored, and the statement is consumed
 * through its own `);` terminator, so an added/reordered option cannot rot it again.
 */
const MEMBER_CALL_HEAD: string = "appendMailboxDeduped(stateRoot, fresh.id, recipient.name, pendingMember"

/**
 * Consume the whole call statement that STARTS on the line carrying `head` and ENDS at the
 * terminator `);` that closes its line — the shape-guard the fixture now uses instead of a
 * full-statement literal. Returns `{ from, to, text }` in the source's own coordinates, or a
 * discriminated reason (`absent` = the wiring is GONE; `unterminated` = the statement shape
 * changed in a way this fixture cannot consume).
 * @param source The shipped `tools.ts` source.
 * @param head The stable call head the statement is anchored by.
 * @returns The consumed statement, or the discriminated reason it could not be consumed.
 */
function consumeCallStatement(source: string, head: string): ConsumedCall {
  /** Index of the stable call head, or -1 when the shipped wiring is gone. */
  const at: number = source.indexOf(head)
  if (at < 0) return { reason: "absent" }
  /** Index of the first character of the line the head sits on. */
  const from: number = source.lastIndexOf("\n", at) + 1
  /** Offset of the statement's `);` terminator relative to the head, or -1 when it has none. */
  const rel: number = source.slice(at).search(/\);[ \t]*(?:\n|$)/)
  if (rel < 0) return { reason: "unterminated", from, line: source.slice(0, from).split("\n").length }
  return { from, to: at + rel + 2, text: source.slice(from, at + rel + 2) }
}

/**
 * Revert the t49 dedup wiring to its recorded pre-fix shape, so the RED arm can run the same
 * scenario against the shipped path as it behaved before the repair.
 * @param source The shipped `tools.ts` source.
 * @returns The reverted source plus the byte counts of each replaced piece.
 */
function revertDedupWiring(source: string): RevertedWiring {
  /** The captain send-dedup wiring region, or `null` when the shipped source lost it. */
  const captainRegion: string | null = extractRegion(source, "send-dedup-wiring")
  /** The delivery-guard region, or `null` when the shipped source lost it. */
  const guardRegion: string | null = extractRegion(source, "send-dedup-delivery-guard")
  if (captainRegion === null || guardRegion === null) {
    fail("cannot build the pre-fix arm: a send-dedup REGION is missing (the RED arm must not silently no-op)")
  }
  /** The recorded pre-fix captain body, re-inserted verbatim. */
  const captainOld: string = [
    "                    const message = { ...createMessage(from, CAPTAIN_KEY, args.content), deliveryClaimedAt: Date.now() };",
    "                    await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, message);",
    "",
  ].join("\n")
  /** The shipped member dedup call statement, consumed by its stable head. */
  const memberCall: ConsumedCall = consumeCallStatement(source, MEMBER_CALL_HEAD)
  if (memberCall.reason === "absent") {
    // DISCRIMINATION (t54): an ABSENT anchor is not a fixture that needs re-pinning — it means the
    // shipped member send path LOST its dedup wiring, i.e. the capability regressed. Say that.
    fail("the member send path LOST its dedup wiring: `" + MEMBER_CALL_HEAD + "…` is not present in tools.ts, so the shipped member path no longer folds duplicate sends — restore/re-materialize the wiring (the region `send-dedup-wiring` is the captain path; the member path is currently UN-REGIONED), then re-run. This is a REGRESSION, not a fixture to re-pin.")
  }
  if (memberCall.reason === "unterminated") {
    fail("cannot build the pre-fix arm: the member dedup call at tools.ts:" + memberCall.line + " has no `);` terminating its statement, so the RED arm cannot be consumed from the shipped source (the transform refuses to guess where the statement ends)")
  }
  /** The indentation of the consumed statement's own line, re-applied to the pre-fix body. */
  const indent: string = (source.slice(memberCall.from).match(/^[ \t]*/) ?? [""])[0]
  /** The shipped member call statement, kept so the revert replaces exactly those bytes. */
  const memberFixed: string = memberCall.text
  /** The recorded pre-fix member body. */
  const memberOld: string = indent + "const message = { ...createMessage(from, recipient.name, args.content), deliveryClaimedAt: Date.now() };\n"
    + indent + "await appendMailbox(stateRoot, fresh.id, recipient.name, message);\n"
  /** The recorded pre-fix delivery guard. */
  const guardOld: string = "            // (pre-fix: no delivery guard - a folded send still ran live delivery)\n"
  /** The source as the transform edits it, one replacement at a time. */
  let out: string = source
  if (!out.includes(captainRegion) || !out.includes(guardRegion)) {
    fail("cannot build the pre-fix arm: a reverted REGION is not present verbatim in tools.ts")
  }
  out = out.replace(captainRegion, captainOld)
  out = out.replace(/\n\s*\.\.\.folded \? \{ foldedDuplicate: true, dupCount: message\.dupCount \} : \{\},/, "")
  out = out.replace(memberFixed, memberOld)
  out = out.replace(guardRegion, guardOld)
  // PER-REPLACEMENT guard (t54): the whole-transform `out === source` check cannot see a
  // member revert that silently no-ops while the other three changed bytes. Assert the
  // member half APPLIED, so a fixture that stops reverting the member path fails loudly.
  if (!out.includes(memberOld) || out.includes(MEMBER_CALL_HEAD)) {
    fail("cannot build the pre-fix arm: the member revert did not apply — the produced source "
      + (out.includes(MEMBER_CALL_HEAD) ? "still carries the dedup call" : "misses the pre-fix appendMailbox body"))
  }
  if (out === source) fail("cannot build the pre-fix arm: the reverting transform changed nothing")
  return {
    source: out,
    transform: {
      captainRegionBytes: captainRegion.length,
      memberRegionBytes: memberFixed.length,
      guardRegionBytes: guardRegion.length,
      outBytes: out.length,
    },
  }
}

// ------------------------------------------------------------------ self-test

/** The offline arm: pin the R1 surface, the shipped wiring, the RED transform and the vendor lock. */
function selfTest(): void {
  /** This case's own source, so the arm can assert it still drives the shipped path. */
  const caseSource: string = readFileSync(fileURLToPath(import.meta.url), "utf8")
  if (!existsSync(STATE_TS) || !existsSync(SCHEDULER_TS) || !existsSync(TOOLS_TS)) fail("adopted plugin lib missing")
  /** The shipped R1 message channel, read as text. */
  const stateSrc: string = readFileSync(STATE_TS, "utf8")
  /** The shipped scheduler, read as text so its exclusion region can be parsed. */
  const schedSrc: string = readFileSync(SCHEDULER_TS, "utf8")
  /** The shipped tool layer, read as text so the send wiring and RED arm can be checked. */
  const toolsSrc: string = readFileSync(TOOLS_TS, "utf8")

  // (a) the R1 surface exists and carries the archive-first marker.
  if (!stateSrc.includes("#region mpd-delta message-channel-r1")) fail("state.ts lost the message-channel-r1 region")
  for (const name of [
    "appendMailboxDeduped", "clearMailboxToWatermark", "readLiveMailbox",
    "enqueueInterjection", "readPendingInterjections", "expireInterjections", "decideInterjection",
  ]) {
    if (!new RegExp("export async function " + name + "\\b").test(stateSrc)) fail("state.ts no longer exports " + name)
  }
  for (const name of ["MAILBOX_DEDUP_WINDOW_MS", "INTERJECTION_TTL_MS", "INTERJECTION_QUEUE", "INTERJECTION_KIND"]) {
    if (!new RegExp("export const " + name + "\\b").test(stateSrc)) fail("state.ts no longer exports " + name)
  }
  if (!/ttl[^\n]*30 \* 60 \* 1000/i.test(stateSrc)) {
    /** The declared TTL assignment, or `null` when the constant is not spelled as an assignment. */
    const ttl = /INTERJECTION_TTL_MS = ([^;]+);/.exec(stateSrc)
    if (ttl === null || !ttl[1].includes("30 * 60 * 1000")) fail("interjection TTL is no longer 30 minutes")
  }

  // (b1) THE ANTI-REGRESSION GUARD for F-1: the shipped path must be WIRED, and THIS
  // case must actually exercise it. Either half alone is exactly the failure mode this
  // rebuild exists to prevent (a wired plugin nobody tests, or a test that never leaves
  // the primitive layer).
  for (const marker of ["send-dedup-wiring", "send-dedup-delivery-guard"]) {
    if (!toolsSrc.includes("#region mpd-delta " + marker)) {
      fail("the shipped send path lost the `" + marker + "` region — R1 is a library again, not a capability")
    }
  }
  for (const tool of ["agent_teams_send_message", "agent_teams_mailbox_clear", "agent_teams_interject_request", "agent_teams_interject_decide"]) {
    if (!new RegExp("name: '" + tool + "'").test(toolsSrc)) fail(tool + " is no longer registered on the shipped surface")
  }
  for (const needle of ['call("agent_teams_send_message"', "kick(MEMBER_NAME)", "registerAgentTeamsTools", "plantFixture"]) {
    if (!caseSource.includes(needle)) {
      fail("this case no longer drives the shipped path (missing `" + needle + "`): a primitive-only case is what let F-1 escape")
    }
  }
  // the RED arm must still be constructible from the shipped source.
  revertDedupWiring(toolsSrc)

  // (b) the scheduler exclusion region exists AND covers both auto-delivery reads.
  /** The scheduler's exclusion region body, or `null` when the seam moved. */
  const region: string | null = extractRegion(schedSrc, "interjection-not-auto-delivered")
  if (region === null) fail("scheduler lost the interjection-not-auto-delivered region")
  if (!/kind !== INTERJECTION_KIND/.test(region)) {
    fail("scheduler exclusion no longer tests the interjection kind: " + region.split("\n").join(" | "))
  }
  // A read that packs unread records AND is NOT routed through the filter is the
  // bypass this case exists to catch.
  /** Every scheduler line that reads unread records (the auto-delivery reads). */
  const unreadLines = schedSrc.split("\n").filter((line) => line.includes("readUnreadMailbox("))
  /** The reads that pack records WITHOUT the shipped exclusion predicate: the bypass class. */
  const bypass = unreadLines.filter((line) => !/deliverableUnread\(/.test(line))
  if (unreadLines.length !== 2) fail("expected exactly 2 scheduler auto-delivery reads, found " + unreadLines.length)
  if (bypass.length !== 0) fail("a scheduler read packs unread records WITHOUT deliverableUnread: " + bypass.join(" | "))

  // (c) VENDOR_LOCK's `skills` asset must recompute from the working tree (the §9/§11
  // pairing rule). This is the invariant the script's own addition changes.
  /** The vendor lock as recorded, narrowed to the assets this arm pins. */
  const lock: VendorLock = JSON.parse(readFileSync(LOCK_PATH, "utf8"))
  /** The `skills` fingerprint recomputed from the working tree, with the gate's own algorithm. */
  const computed: TreeSha = buildTreeSha(join(repoRoot, "skills"))
  if (lock.assets.skills.fileCount !== computed.fileCount || lock.assets.skills.treeSha !== computed.treeSha) {
    fail("VENDOR_LOCK skills asset is stale: lock=" + lock.assets.skills.fileCount + "/" + lock.assets.skills.treeSha.slice(0, 12)
      + " tree=" + computed.fileCount + "/" + computed.treeSha.slice(0, 12) + " (re-pin in the same commit, AGENTS.md §9)")
  }
  // falsifiable: the pin MUST move when one skills file changes (otherwise the
  // recomputation above could be a constant that always "matches"). The probe mutates a
  // TEMP COPY (t54): a probe that wrote into the tracked corpus could leave residue inside
  // a wave whose whole invariant is that `skills/**` does not move between re-pins, and an
  // interrupted run would leave the probe line in a tracked file.
  /** The disposable copy of `skills/` the falsifiability probe mutates. */
  const probeRoot: string = mkdtempSync(join(tmpdir(), "agent-teams-messaging-tree-"))
  /** The copy's fingerprint before the probe edit. */
  let baseline: TreeSha
  /** The copy's fingerprint after the probe edit, which must differ. */
  let mutated: TreeSha
  try {
    cpSync(join(repoRoot, "skills"), probeRoot, { recursive: true })
    baseline = buildTreeSha(probeRoot)
    /** The copied case table the probe appends one line to. */
    const probeFile: string = join(probeRoot, "dsh-qa", "SKILL.md")
    writeFileSync(probeFile, readFileSync(probeFile, "utf8") + "\n<!-- treeSha falsifiability probe -->\n")
    mutated = buildTreeSha(probeRoot)
  } finally {
    rmSync(probeRoot, { recursive: true, force: true })
  }
  // The copy must REPRODUCE the working tree's pin before it can falsify anything: a copy
  // that silently misses files would make the probe below pass for the wrong reason.
  if (baseline.fileCount !== computed.fileCount || baseline.treeSha !== computed.treeSha) {
    fail("the temp COPY of skills does not reproduce the working tree's treeSha (copy=" + baseline.fileCount + "/" + baseline.treeSha.slice(0, 12)
      + " tree=" + computed.fileCount + "/" + computed.treeSha.slice(0, 12) + "), so the falsifiability probe would be vacuous")
  }
  if (mutated.treeSha === baseline.treeSha) fail("skills treeSha did not move when a file changed (constant hash?) — the probe mutated a temp COPY, never <repoRoot>/skills")

  // (d) the case table row exists, with the same 4 columns as every other row.
  /** The SKILL.md row that describes this case; exactly one is expected. */
  const table = readFileSync(SKILL_MD, "utf8").split("\n").filter((line) => line.startsWith("| " + CASE_SLUG + " |"))
  if (table.length !== 1) fail("SKILL.md case table must carry exactly one `" + CASE_SLUG + "` row (found " + table.length + ")")
  /** The row's four trimmed cells, which must all be populated. */
  const cols = table[0].split("|").slice(1, -1).map((c) => c.trim())
  if (cols.length !== 4 || cols.some((c) => c === "")) fail("SKILL.md row is not 4 populated columns: " + cols.length)

  // (e) the runner would actually pick this case up.
  //
  // The contract is that `test:qa` DISCOVERS this case directory - not the shell spelling it used to
  // have. The POSIX `for f in skills/dsh-qa/scripts/*.mjs; do ... done` loop this arm used to pin
  // could not run on Windows at all (`bun run` hands the body to cmd.exe: `bun: command not found:
  // for`), so the sweep is `node scripts/run-qa-selftests.ts` now and THAT is what must stay wired:
  // the arm reads the runner's own source for the directory it discovers.
  /** The `test:qa` command the package manifest declares, which must still name the runner. */
  const runner: string = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts["test:qa"]
  /** The runner's source path, so the arm can read the directory it discovers. */
  const runnerPath: string = join(repoRoot, "scripts", "run-qa-selftests.ts")
  /** The runner's source, or `""` when the runner is missing (which the check below rejects). */
  const runnerSource: string = existsSync(runnerPath) ? readFileSync(runnerPath, "utf8") : ""
  /** Whether `test:qa` still routes through the runner that sweeps the case directory. */
  const sweepsCases: boolean = runner.includes("scripts/run-qa-selftests.ts") && runnerSource.includes("skills/dsh-qa/scripts")
  if (!sweepsCases) fail("test:qa no longer sweeps the case directory (expected scripts/run-qa-selftests.ts to discover skills/dsh-qa/scripts)")

  console.log("[" + CASE_SLUG + " self-test] ok: R1 exports + SHIPPED send/clear/interject wiring + this case drives the tool surface + scheduler exclusion on both reads + RED-arm transform applies (member revert consumed by its stable head) + VENDOR_LOCK skills pin current ("
    + computed.fileCount + " files/" + computed.treeSha.slice(0, 12) + ") + treeSha falsifiability probe on a temp COPY (nothing written under <repoRoot>/skills) + SKILL.md row + test:qa sweeps the case directory")
}

// ------------------------------------------------------------------ real run

/** The live arm: boot the sandboxed harness and drive the shipped message channel end to end. */
async function runReal(): Promise<void> {
  /** The real home's credentials document, copied ONCE into the sandbox (never read again). */
  const creds: string = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials at " + creds)
  /** The evidence directory's timestamp suffix, in the ISO form with `:` replaced for Windows. */
  const ts: string = new Date().toISOString().replaceAll(":", "-")
  /** This run's evidence directory, under the frozen evidence root. */
  const outDir: string = join(repoRoot, "evidence", "omo-align", "qa-shipped-path", ts)
  mkdirSync(outDir, { recursive: true })

  /** The shipped state module, asserted to carry every R1 export below. */
  const state: AdoptedStateModule = await import(STATE_TS)
  /** The R1 exports and constants the case requires before it measures anything. */
  const requiredExports = [
    "appendMailboxDeduped", "clearMailboxToWatermark", "readLiveMailbox", "readMailbox", "readUnreadMailbox",
    "enqueueInterjection", "readPendingInterjections", "readInterjections", "expireInterjections", "decideInterjection",
  ]
  /** The required exports the shipped module does NOT carry; empty is the only acceptable list. */
  const missingExports = requiredExports.filter((name) => typeof state[name] !== "function")
  if (missingExports.length > 0) fail("R1 exports missing from the shipped lib: " + missingExports.join(", "))

  /** Every lane outcome, keyed by lane name and written verbatim into `result.json`. */
  const steps: Record<string, StepOutcome> = {
    surface: {
      ok: missingExports.length === 0,
      exports: requiredExports.length,
      dedupWindowMs: state.MAILBOX_DEDUP_WINDOW_MS,
      interjectionTtlMs: state.INTERJECTION_TTL_MS,
      interjectionKind: state.INTERJECTION_KIND,
      queue: state.INTERJECTION_QUEUE,
    },
  }
  if (state.INTERJECTION_TTL_MS !== 30 * 60 * 1000) fail("interjection TTL is not 30 minutes: " + state.INTERJECTION_TTL_MS)

  // --- settled revision: no other writer may move it while this case measures ---
  /** HEAD before the settle window. */
  const rev0: string = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
  /** The two R1 files' hashes before the settle window, in `[state, scheduler]` order. */
  const hashes0: string[] = [STATE_TS, SCHEDULER_TS].map(sha256Of)
  LOG.push("settleWait: " + SETTLE_MS + " ms (HEAD " + rev0 + ", state.ts " + hashes0[0].slice(0, 16) + ")")
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  /** HEAD after the settle window, which must equal `rev0`. */
  const rev1: string = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
  /** The two R1 files' hashes after the settle window, which must equal `hashes0`. */
  const hashes1: string[] = [STATE_TS, SCHEDULER_TS].map(sha256Of)
  /** Whether HEAD and both R1 files held still across the window. */
  const settled: boolean = rev0 === rev1 && hashes0[0] === hashes1[0] && hashes0[1] === hashes1[1]
  steps.settled = { ok: settled, head: rev1, stateSha: hashes1[0], schedulerSha: hashes1[1] }
  if (!settled) fail("revision did not settle (HEAD or the R1 files changed during the window)")

  // --- sandbox: DSH_HOME + HOME + workspace all under the sandbox ---
  /** The sandbox root: both the child's `DSH_HOME` and its `HOME`. */
  const sandbox: string = mkdtempSync(join(tmpdir(), "mpd-t36-"))
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  /** The real home's gateway settings, copied when present (the live-LLM prerequisite, §7). */
  const settings: string = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
  /** The sandbox workspace every session and every state root resolves under. */
  const ws: string = sandboxWorkspace(sandbox)
  /** The primitive lanes' state root inside the sandbox workspace. */
  const stateRoot: string = join(ws, STATE_DIR)
  mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
  /** The child environment: the resolved credential plus the sandboxed home and workspace. */
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: sandbox  })
  if (env.DSH_HOME !== sandbox || env.HOME !== sandbox) fail("isolation assertion failed")

  /**
   * Run one child process with the sandboxed environment, logging its command line and output.
   * @param cmd The command; `"dsh"` is resolved through the shared launcher helper.
   * @param args The argument vector.
   * @param opts The timeout and working directory for this child.
   * @returns The child's exit status and its merged stdout+stderr.
   */
  function runSync(cmd: string, args: string[], opts: RunOptions = {}): RunOutcome {
    /** The spawnable pair: the resolved `dsh` launcher, or the command as given. */
    const spec = cmd === "dsh" ? dshCommand(args, env) : { command: cmd, args }
    /** The child's result, or the DSH_MISSING marker when no launcher resolves. */
    const r = spec === null ? { status: null, stdout: "", stderr: DSH_MISSING } : spawnSync(spec.command, spec.args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    /** The child's stdout and stderr, concatenated in that order. */
    const out = (r.stdout || "") + (r.stderr || "")
    LOG.push("$ " + cmd + " " + args.join(" ") + "\n[[exit=" + r.status + "]]\n" + out.slice(0, 20000))
    return { status: r.status, out }
  }

  // --- 1) install + REAL MOUNTED BOOT (never --dump-config) ---
  /** The installer run that seeds the sandbox home's mpd-headless profile. */
  const inst = runSync(process.execPath, [join(repoRoot, "scripts", "install-profile.ts"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { timeout: 600000 })
  // The installer serves the mpd preset into the home; a headless profile is the one
  // that takes a positional prompt, which is what a real CLI boot needs.
  /** Whether the installer landed both the profile manifest and the mpd preset. */
  const mpdPresetInstalled = existsSync(join(sandbox, "profiles", "mpd-headless", "package.json"))
    && existsSync(join(sandbox, ".agent-presets", "mpd", "agent.cordis.yml"))
  steps.installer = { ok: inst.status === 0 && mpdPresetInstalled, exit: inst.status, mpdPresetInstalled }
  // The mounted boot that really EXECUTES the tree runs that profile in the sandbox
  // home. A live-LLM turn is NOT a
  // prerequisite of this case (this environment carries no DEEPSEEK_API_KEY), so the
  // mount evidence is the plugin tree's own boot lines + a sandboxed session key +
  // zero apply/schema crash signatures — never the answer text.
  /** The real boot of the installed profile, which is what proves the tree MOUNTS. */
  const boot = runSync("dsh", ["--profile", "mpd-headless", "Reply with exactly: hello-ok"], { cwd: ws, timeout: 600000 })
  /** The crash signatures the boot output carries; an empty list is required. */
  const crashes = CRASH_SIGNATURES.filter((signature) => boot.out.includes(signature))
  /** The boot lines that prove the bundle's own rows really applied. */
  const MOUNT_MARKERS = [
    "[mpd-dsh-adapter] mpdDsh provided",
    "[mpd-bootstrap] skill corpus served from",
    "[mpd-codegraph] init status=",
  ]
  /** The mount markers the boot output does NOT carry; an empty list is required. */
  const missingMarkers = MOUNT_MARKERS.filter((marker) => !boot.out.includes(marker))
  /** Whether the boot was refused for a missing credential, which is not a mount failure. */
  const credentialBlocked = boot.status === 1 && boot.out.includes("MISSING_CREDENTIAL")
  steps.mountedBoot = {
    ok: crashes.length === 0 && missingMarkers.length === 0 && (boot.status === 0 || credentialBlocked),
    exit: boot.status,
    credentialBlocked,
    crashSignatures: crashes,
    mountMarkers: MOUNT_MARKERS.length - missingMarkers.length,
    missingMarkers,
    loadEvidence: "real mount+boot of the mpd preset home; --dump-config is deliberately NOT cited (AGENTS.md §4)",
  }

  /** The isolation verdict: whether the boot keyed its session store to the sandbox only. */
  let isolation: StepOutcome = { ok: false }
  try {
    /** The isolation assertion's verdict, which carries how many keys it inspected. */
    const checked: SessionSandboxVerdict = assertSessionsSandboxed(sandbox, sandbox, { label: CASE_SLUG })
    // The PROOF is two-sided: every key belongs to the sandbox AND the boot really
    // wrote one (zero keys would make the assertion vacuous).
    // The `Partial` view is what lets the spread keep its original position: TypeScript rejects a
    // definite re-specification of `ok`, and `Partial` names the spread's members as optional, so
    // this statement erases to exactly the pre-conversion bytes.
    isolation = { ok: checked.checked > 0, ...(checked as Partial<SessionSandboxVerdict>), sessionsWritten: checked.checked }
  } catch (error) {
    // A thrown value is `unknown` under `strict`, so the original `error.message` read is spelled
    // through an assertion: the pre-conversion expression is preserved byte for byte after erasure.
    isolation = { ok: false, error: String(error && (error as { readonly message?: unknown }).message ? (error as { readonly message?: unknown }).message : error) }
  }
  steps.isolation = isolation

  // =====================================================================
  // SHIPPED-PATH LANES (t51) — the F-1 fix.
  //
  // These lanes do NOT call the state primitives. They plant a real team record and
  // drive the REAL tool registrations (`agent_teams_send_message`,
  // `agent_teams_mailbox_clear`, `agent_teams_interject_request/decide`) against the
  // REAL `installTeamScheduler`, counting deliveries on the member-queue seam
  // (`ctx.subagents.prompt`) that `deliverToMember` itself uses. A green primitive lane
  // therefore can never stand in for them again.
  // =====================================================================
  // The exclusion region is asserted present: a missing region must throw inside the predicate
  // builder exactly as the pre-conversion `.replaceAll` on `null` did, so the assertion preserves
  // that failure mode instead of inventing a guard the original never had.
  /** The shipped predicate, assembled from the scheduler's extracted exclusion region. */
  const shippedPredicate: DeliverablePredicateModule = await import(buildDeliverablePredicate(
    extractRegion(readFileSync(SCHEDULER_TS, "utf8"), "interjection-not-auto-delivered")!,
    state.INTERJECTION_KIND,
  ))

  // --- 2a) SHIPPED dedup: 3 IDENTICAL sends -> 1 record / dupCount=3 / <=1 wake ---
  /** The green lane's own workspace, so its state cannot collide with another lane's. */
  const greenWs: string = join(ws, "shipped-green")
  mkdirSync(greenWs, { recursive: true })
  /** The green lane's fixture, planted against the SHIPPED lib. */
  const green = await plantFixture(greenWs, { teamId: TEAM + "-green" })
  /** The one argument object all three identical sends reuse. */
  const sendArgs = { to: MEMBER_NAME, content: "identical payload from the shipped path" }
  /** The three send results, in call order, which the dedup assertions read. */
  const shippedSends: ToolResult[] = []
  for (let i = 0; i < 3; i += 1) shippedSends.push(await green.call("agent_teams_send_message", sendArgs))
  /** The mailbox records the three sends produced; exactly one is expected. */
  const greenRecords: MailboxRecord[] = await green.state.readMailbox(green.stateRoot, green.teamId, MEMBER_NAME)
  // Count deliveries to the RECIPIENT. The first send may legitimately reach the member
  // live (its text is packed straight to the child), so "at most once" is the criterion,
  // not "zero before the kick".
  /** How many deliveries have reached the recipient so far. */
  const memberDeliveries = (): number => green.deliveries.filter((entry) => entry.to === MEMBER_ID).length
  /** Deliveries counted right after the three sends. */
  const deliveredAfterSends: number = memberDeliveries()
  await green.kick(MEMBER_NAME)
  /** Deliveries counted after the first idle-edge kick. */
  const deliveredAfterKick: number = memberDeliveries()
  await green.kick(MEMBER_NAME)
  /** Deliveries counted after a second kick, which must not wake the member again. */
  const deliveredAfterSecondKick: number = memberDeliveries()
  steps.shippedDedup = {
    ok: greenRecords.length === 1 && greenRecords[0].dupCount === 3
      && deliveredAfterSends <= 1 && deliveredAfterKick <= 1 && deliveredAfterSecondKick <= 1
      && deliveredAfterKick >= 1
      && shippedSends[0].delivered !== "duplicate" && shippedSends[1].delivered === "duplicate"
      && shippedSends[2].delivered === "duplicate"
      && shippedSends[1].message_id === greenRecords[0].id,
    sends: shippedSends.map((result) => ({ delivered: result.delivered, message_id: result.message_id })),
    records: greenRecords.length, dupCount: greenRecords[0] ? greenRecords[0].dupCount : null,
    deliveriesToRecipient: { afterSends: deliveredAfterSends, afterKick: deliveredAfterKick, afterSecondKick: deliveredAfterSecondKick },
    windowMs: green.state.MAILBOX_DEDUP_WINDOW_MS,
    path: "agent_teams_send_message -> appendMailboxDeduped -> scheduler kickMember -> ctx.subagents.prompt",
  }
  /** The same content sent by the OTHER participant, which must NOT fold. */
  const otherSender = await green.call("agent_teams_send_message", { to: MEMBER_NAME, content: sendArgs.content, from: ASKER_NAME }, green.askerAgent)
  /** The mailbox records after the other sender's send; two are expected. */
  const greenRecordsAfter: MailboxRecord[] = await green.state.readMailbox(green.stateRoot, green.teamId, MEMBER_NAME)
  /** The already-folded original record, which must keep `dupCount=3`. */
  const originalRecord = greenRecordsAfter.find((record) => record.id === greenRecords[0].id)
  /** The record the other sender's send produced. */
  const otherSenderRecord = greenRecordsAfter.find((record) => record.id === otherSender.message_id)
  steps.shippedDedupControl = {
    ok: otherSender.delivered !== "duplicate" && greenRecordsAfter.length === 2
      && originalRecord !== undefined && originalRecord.dupCount === 3
      && otherSenderRecord !== undefined && otherSenderRecord.dupCount === 1 && otherSenderRecord.from === ASKER_NAME,
    delivered: otherSender.delivered, records: greenRecordsAfter.length,
    dupCounts: greenRecordsAfter.map((record) => record.dupCount),
  }

  // --- 2b) RED ARM: the SAME scenario against the PRE-FIX shipped path ---
  /** The red lane's own workspace, which receives a copy of the whole adopted package. */
  const redWs: string = join(ws, "shipped-red")
  mkdirSync(redWs, { recursive: true })
  // The pre-fix module keeps the SAME runtime closure (sibling modules + `_deps`) as the
  // shipped one, so the closure is copied beside it and only `tools.ts` is replaced.
  cpSync(join(repoRoot, "packages", "mpd-agent-teams-plugin"), redWs, { recursive: true })
  /** The shipped `tools.ts` reverted to its recorded pre-fix shape. */
  const prefix: RevertedWiring = revertDedupWiring(readFileSync(TOOLS_TS, "utf8"))
  writeFileSync(join(redWs, "lib", "tools.ts"), prefix.source)
  /** The red lane's fixture, planted against the reverted copy. */
  const red = await plantFixture(redWs, { libDir: join(redWs, "lib"), teamId: TEAM + "-red" })
  for (let i = 0; i < 3; i += 1) await red.call("agent_teams_send_message", sendArgs)
  /** The red lane's records: the pre-fix path must append all three, never folding them. */
  const redRecords: MailboxRecord[] = await red.state.readMailbox(red.stateRoot, red.teamId, MEMBER_NAME)
  await red.kick(MEMBER_NAME)
  await red.kick(MEMBER_NAME)
  /** Deliveries the red lane produced, which must be at least the three sends. */
  const redDeliveries: number = red.deliveries.filter((entry) => entry.to === MEMBER_ID).length
  steps.preFixRedArm = {
    ok: redRecords.length === 3 && redDeliveries >= 3,
    records: redRecords.length, dupCounts: redRecords.map((record) => record.dupCount),
    deliveriesToRecipient: redDeliveries, transform: prefix.transform,
    specimen: "the t49 regions reverted to the shape recorded in the commit that introduced them (raw/prefix-tools.js)",
    note: "Counter-reading the contract asks for: 3 records / >=3 deliveries BEFORE the repair, 1 record / 1 delivery after it.",
  }

  // --- 2c) SHIPPED interjection: pending is silent, approval wakes the REQUESTER ---
  /** The interjection lane's own workspace. */
  const ijWs: string = join(ws, "shipped-interjection")
  mkdirSync(ijWs, { recursive: true })
  /** The interjection lane's fixture, planted against the SHIPPED lib. */
  const ij = await plantFixture(ijWs, { teamId: TEAM + "-ij" })
  /** The pending request the shipped tool queued. */
  const request = await ij.call("agent_teams_interject_request", {
    content: "please confirm the runbook", summary: "need the runbook", reason: "blocked on the gate", location: "t51",
  }, ij.askerAgent)
  /** The decide tool's `list` view taken while the request is still pending. */
  const pendingView = await ij.call("agent_teams_interject_decide", { action: "list" })
  /** The requester's unread inbox while the request is pending, which must be empty. */
  const askerInboxWhilePending: MailboxRecord[] = await ij.state.readUnreadMailbox(ij.stateRoot, ij.teamId, ASKER_NAME)
  /** Deliveries counted before the approval decision. */
  const deliveriesBeforeApprove: number = ij.deliveries.length
  await ij.kick(ASKER_NAME)
  /** Deliveries counted while the request is still pending, which must not have moved. */
  const deliveriesWhilePending: number = ij.deliveries.length
  /** The interjection queue file, read to prove the row carries the request's metadata. */
  const ijQueueFile: string = join(ij.stateRoot, ij.teamId, "inbox", "interjections.jsonl")
  /** The parsed queue rows, which prove the request was queued exactly once. */
  const ijQueueRows: InterjectionQueueRow[] = readFileSync(ijQueueFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  /** The approval decision's result. */
  const decision = await ij.call("agent_teams_interject_decide", { request_id: request.request_id, decision: "approved" })
  /** The requester's unread inbox after the approval, which must carry the re-posted record. */
  const askerInboxAfterApprove: MailboxRecord[] = await ij.state.readUnreadMailbox(ij.stateRoot, ij.teamId, ASKER_NAME)
  await ij.kick(ASKER_NAME)
  await ij.kick(ASKER_NAME)
  /** The deliveries produced from the approval onward. */
  const afterApproveDeliveries: DeliveryRecord[] = ij.deliveries.slice(deliveriesWhilePending)
  /** The approval deliveries addressed to the requester. */
  const askerDeliveries: DeliveryRecord[] = afterApproveDeliveries.filter((entry) => entry.to === ASKER_ID)
  /** The approval deliveries addressed to anyone else, which must be none. */
  const otherMemberDeliveries: DeliveryRecord[] = afterApproveDeliveries.filter((entry) => entry.to === MEMBER_ID)
  steps.shippedInterjection = {
    ok: request.delivered_to_anyone === false && request.status === "pending"
      && pendingView.pending.length === 1 && pendingView.pending[0].id === request.request_id
      && askerInboxWhilePending.length === 0 && deliveriesBeforeApprove === 0 && deliveriesWhilePending === 0
      && decision.status === "approved" && askerInboxAfterApprove.length === 1
      && askerInboxAfterApprove[0].id === request.request_id + "-delivery"
      && askerDeliveries.length === 1 && otherMemberDeliveries.length === 0
      && askerDeliveries[0].content.includes("Approved interjection")
      && ijQueueRows.length === 1 && ijQueueRows[0].summary === "need the runbook"
      && ijQueueRows[0].reason === "blocked on the gate" && ijQueueRows[0].location === "t51",
    request: { id: request.request_id, status: request.status, delivered_to_anyone: request.delivered_to_anyone },
    pendingListed: pendingView.pending.length,
    deliveries: { beforeApprove: deliveriesBeforeApprove, whilePending: deliveriesWhilePending, toRequester: askerDeliveries.length, toOtherMember: otherMemberDeliveries.length },
    requesterInbox: askerInboxAfterApprove.map((record) => record.id),
    path: "interject_request -> interject_decide(approved) -> decideInterjection re-post -> kickMember -> ctx.subagents.prompt",
  }
  /** The SECOND request, which the rejection control decides the other way. */
  const rejected = await ij.call("agent_teams_interject_request", { content: "second ask", summary: "second ask", reason: "r", location: "t51" }, ij.askerAgent)
  /** Deliveries counted before the rejection decision. */
  const beforeReject: number = ij.deliveries.length
  /** The rejection decision's result. */
  const rejectDecision = await ij.call("agent_teams_interject_decide", { request_id: rejected.request_id, decision: "rejected" })
  /** The requester's unread inbox after the rejection, which must stay empty. */
  const askerInboxAfterReject: MailboxRecord[] = await ij.state.readUnreadMailbox(ij.stateRoot, ij.teamId, ASKER_NAME)
  await ij.kick(ASKER_NAME)
  steps.shippedInterjectionRejectControl = {
    ok: rejectDecision.status === "rejected" && askerInboxAfterReject.length === 0
      && ij.deliveries.slice(beforeReject).filter((entry) => entry.to === ASKER_ID).length === 0,
    status: rejectDecision.status, requesterInbox: askerInboxAfterReject.length,
    deliveriesAfter: ij.deliveries.slice(beforeReject).length,
  }

  // --- 2d) SHIPPED TTL: silence expires the request and the requester IS told ---
  /** The TTL lane's own workspace. */
  const ttlWs: string = join(ws, "shipped-ttl")
  mkdirSync(ttlWs, { recursive: true })
  /** The TTL lane's fixture, planted against the SHIPPED lib. */
  const ttl = await plantFixture(ttlWs, { teamId: TEAM + "-ttl" })
  /** The request the fixture ages out of its TTL. */
  const overdue = await ttl.call("agent_teams_interject_request", { content: "overdue ask", summary: "overdue", reason: "r", location: "t51" }, ttl.askerAgent)
  /** The request that must stay pending, because its real TTL has not passed. */
  const insideTtl = await ttl.call("agent_teams_interject_request", { content: "still inside TTL", summary: "inside", reason: "r", location: "t51" }, ttl.askerAgent)
  // Age exactly ONE request. The tool deliberately takes no clock argument (an injected
  // clock would be a production seam), so the fixture rewrites that row's expiry while
  // the other keeps its real TTL.
  /** The TTL lane's queue file, rewritten to age exactly one row. */
  const queueFile: string = join(ttl.stateRoot, ttl.teamId, "inbox", "interjections.jsonl")
  /** The queue rows as they stand before the fixture ages one of them. */
  const queueRows: InterjectionQueueRow[] = readFileSync(queueFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  writeFileSync(queueFile, queueRows.map((row) => JSON.stringify(row.id === overdue.request_id ? { ...row, ts: 1_000, expiresAt: 2_000 } : row)).join("\n") + "\n")
  await ttl.kick(ASKER_NAME)
  // The notice is delivered AND acknowledged (the scheduler acks what the member
  // accepted), so the honest evidence is the delivery plus the acknowledged record —
  // asserting a post-ack unread count would encode the wrong contract.
  /** The deliveries the expiry tick produced for the requester. */
  const ttlDeliveries: DeliveryRecord[] = ttl.deliveries.filter((entry) => entry.to === ASKER_ID)
  /** The requester's mailbox, which must carry the EXPIRED notice record. */
  const askerNotices: MailboxRecord[] = await ttl.state.readMailbox(ttl.stateRoot, ttl.teamId, ASKER_NAME)
  /** The requests still pending after the tick, which must be the un-aged one only. */
  const pendingAfterTick: InterjectionRow[] = await ttl.state.readPendingInterjections(ttl.stateRoot, ttl.teamId)
  // The aged row is read unconditionally by the assertions below, exactly as the pre-conversion
  // code did, so the assertion keeps that failure mode (a TypeError on a missing row) rather than
  // inventing a guard the original never had.
  /** The aged request's row after the expiry tick. */
  const expiredRow: InterjectionRow = (await ttl.state.readInterjections(ttl.stateRoot, ttl.teamId)).find((record) => record.id === overdue.request_id)!
  steps.shippedTtl = {
    ok: expiredRow !== undefined && expiredRow.status === "expired"
      && ttlDeliveries.length === 1 && ttlDeliveries[0].content.includes("EXPIRED")
      && askerNotices.length === 1 && askerNotices[0].id === "interjection-expired-" + overdue.request_id
      && askerNotices[0].content.includes("EXPIRED") && askerNotices[0].readAt !== undefined
      && (await ttl.state.readUnreadMailbox(ttl.stateRoot, ttl.teamId, ASKER_NAME)).length === 0
      && pendingAfterTick.length === 1 && pendingAfterTick[0].id === insideTtl.request_id,
    agedStatus: expiredRow ? expiredRow.status : null,
    deliveredNotice: askerNotices.map((record) => record.id),
    noticeAcknowledged: askerNotices[0] ? askerNotices[0].readAt !== undefined : false,
    unreadAfterAck: (await ttl.state.readUnreadMailbox(ttl.stateRoot, ttl.teamId, ASKER_NAME)).length,
    stillPending: pendingAfterTick.map((record) => record.id),
    deliveriesToRequester: ttlDeliveries.length,
    path: "scheduler kickMember -> expiry tick -> expireInterjections -> ordinary notice -> deliverableUnread -> ctx.subagents.prompt",
  }

  // --- 2e) SHIPPED clear: after the watermark, 0 unread / 0 deliverable ---
  /** The clear lane's own workspace. */
  const clearWs: string = join(ws, "shipped-clear")
  mkdirSync(clearWs, { recursive: true })
  /** The clear lane's fixture, planted against the SHIPPED lib. */
  const clearFixture = await plantFixture(clearWs, { teamId: TEAM + "-clear" })
  await clearFixture.call("agent_teams_send_message", { to: MEMBER_NAME, content: "OLD-PAYLOAD-ALPHA" })
  await clearFixture.call("agent_teams_send_message", { to: MEMBER_NAME, content: "OLD-PAYLOAD-BETA" })
  /** The mailbox as it stands before the clear, when both payloads are live. */
  const liveBeforeClear: MailboxRecord[] = await clearFixture.state.readMailbox(clearFixture.stateRoot, clearFixture.teamId, MEMBER_NAME)
  await clearFixture.kick(MEMBER_NAME)
  /** Deliveries counted before the clear, so the clear can prove it woke nobody. */
  const deliveriesBeforeClear: number = clearFixture.deliveries.length
  /** The clear tool's result, which reports the post-watermark unread count. */
  const clearedResult = await clearFixture.call("agent_teams_mailbox_clear", { agent: MEMBER_NAME, watermark: Date.now() + 60_000 })
  /** The mailbox's unread view after the clear, which must be empty. */
  const unreadAfterClear: MailboxRecord[] = await clearFixture.state.readUnreadMailbox(clearFixture.stateRoot, clearFixture.teamId, MEMBER_NAME)
  /** The mailbox's full view after the clear, which must be two tombstones. */
  const liveAfterClear: MailboxRecord[] = await clearFixture.state.readMailbox(clearFixture.stateRoot, clearFixture.teamId, MEMBER_NAME)
  await clearFixture.kick(MEMBER_NAME)
  /** The mailbox's full view after a further kick, which must be unchanged. */
  const liveAfterClearKick: MailboxRecord[] = await clearFixture.state.readMailbox(clearFixture.stateRoot, clearFixture.teamId, MEMBER_NAME)
  steps.shippedClear = {
    ok: liveBeforeClear.length === 2 && deliveriesBeforeClear === 2
      && clearedResult.unread_after === 0 && unreadAfterClear.length === 0
      && liveAfterClear.every((record) => record.tombstone === true) && liveAfterClear.length === 2
      && shippedPredicate.deliverableUnread(unreadAfterClear).length === 0
      && clearFixture.deliveries.length === deliveriesBeforeClear
      && liveAfterClearKick.length === 2,
    cleared: clearedResult.cleared, unread_after: clearedResult.unread_after,
    tombstoned: liveAfterClear.filter((record) => record.tombstone === true).length,
    deliveries: { beforeClear: deliveriesBeforeClear, afterKick: clearFixture.deliveries.length },
    path: "agent_teams_send_message -> agent_teams_mailbox_clear -> readUnreadMailbox -> scheduler kickMember",
  }
  /** The refusal message of a clear attempted by a non-captain, or `null` when none was thrown. */
  let authzRefusal: string | null = null
  try {
    await clearFixture.call("agent_teams_mailbox_clear", { agent: MEMBER_NAME, watermark: Date.now() }, clearFixture.askerAgent)
  } catch (error) {
    // The thrown value is `unknown` under `strict`; the assertion preserves the pre-conversion
    // `error.message` read byte for byte after erasure, which is why no narrowing statement is added.
    authzRefusal = String(error && (error as { readonly message?: unknown }).message ? (error as { readonly message?: unknown }).message : error)
  }
  steps.shippedClearAuthzControl = {
    ok: authzRefusal !== null && /only the captain may clear another participant/.test(authzRefusal),
    refusal: authzRefusal,
  }

  // --- 2) DEDUP lane (PRIMITIVE layer): positive + negative control ---
  /** The shipped dedup window in ms, read once so every primitive assertion uses the same value. */
  const W: number = state.MAILBOX_DEDUP_WINDOW_MS
  /** The identical message body the three primitive sends share (id and ts differ per send). */
  const dedupBase = { from: "Senior Engineer", to: "captain", content: "same content", ts: 5_000_000 }
  /** The first primitive send, which must append rather than fold. */
  const d1: DedupAppendResult = await state.appendMailboxDeduped(stateRoot, TEAM, "captain", { ...dedupBase, id: "dedup-1" })
  /** The second primitive send, one second later, which must fold into the first. */
  const d2: DedupAppendResult = await state.appendMailboxDeduped(stateRoot, TEAM, "captain", { ...dedupBase, id: "dedup-2", ts: dedupBase.ts + 1000 })
  /** The third primitive send, one second after that, which must fold as well. */
  const d3: DedupAppendResult = await state.appendMailboxDeduped(stateRoot, TEAM, "captain", { ...dedupBase, id: "dedup-3", ts: dedupBase.ts + 2000 })
  /** The mailbox after the three primitive sends; exactly one record is expected. */
  const dedupRecords: MailboxRecord[] = await state.readMailbox(stateRoot, TEAM, "captain")
  /** The mailbox's unread count after the folds, which must be one. */
  const dedupUnread: MailboxRecord[] = await state.readUnreadMailbox(stateRoot, TEAM, "captain")
  /** The primitive dedup lane's positive assertions. */
  const dedupPositive = {
    ok: d1.folded === false && d2.folded === true && d3.folded === true
      && dedupRecords.length === 1 && dedupRecords[0].id === "dedup-1"
      && dedupRecords[0].dupCount === 3 && dedupUnread.length === 1,
    sends: 3, folded: [d1.folded, d2.folded, d3.folded],
    records: dedupRecords.length, dupCount: dedupRecords[0] ? dedupRecords[0].dupCount : null,
    unread: dedupUnread.length, windowMs: W,
  }
  // NEGATIVE CONTROL: the SAME content from a DIFFERENT sender must NOT fold. The
  // already-folded record keeps its dupCount=3 (the control only proves the new
  // sender added a SECOND record instead of merging into the folded one).
  /** The same content sent by a different sender, which must not fold. */
  const other: DedupAppendResult = await state.appendMailboxDeduped(stateRoot, TEAM, "captain", { ...dedupBase, id: "dedup-other", from: "Lead" })
  /** The mailbox after the other sender's send; two records are expected. */
  const afterOther: MailboxRecord[] = await state.readMailbox(stateRoot, TEAM, "captain")
  /** The record the other sender added. */
  const otherRecord = afterOther.find((record) => record.id === "dedup-other")
  /** The already-folded record, whose `dupCount` must be untouched by the control. */
  const foldedRecord = afterOther.find((record) => record.id === "dedup-1")
  /** The primitive dedup lane's negative control. */
  const dedupNegative = {
    ok: other.folded === false && afterOther.length === 2
      && otherRecord !== undefined && otherRecord.dupCount === 1 && otherRecord.from === "Lead"
      && foldedRecord !== undefined && foldedRecord.dupCount === 3,
    folded: other.folded, records: afterOther.length,
    ids: afterOther.map((record) => record.id),
    otherDupCount: otherRecord ? otherRecord.dupCount : null,
    foldedStillFolded: foldedRecord ? foldedRecord.dupCount : null,
  }
  steps.dedup = { ok: dedupPositive.ok && dedupNegative.ok, positive: dedupPositive, negative: dedupNegative }

  // --- 3) CLEAR lane: positive + negative control ---
  /** The primitive clear lane's own state root. */
  const clearRoot: string = join(ws, "clear-ws", STATE_DIR)
  mkdirSync(join(clearRoot, TEAM, "inbox"), { recursive: true })
  /** The three records the clear lane plants: two below the watermark and one above it. */
  const clearMessages = [
    { id: "clear-1", from: "captain", to: "Lead", content: "PAYLOAD-ALPHA", ts: 100 },
    { id: "clear-2", from: "captain", to: "Lead", content: "PAYLOAD-BETA", ts: 200 },
    { id: "clear-3", from: "Lead", to: "captain", content: "kept", ts: 900 },
  ]
  for (const message of clearMessages) await state.appendMailbox(clearRoot, TEAM, "captain", message)
  /** The live file's bytes before the clear, compared line-count-wise against the after state. */
  const liveBefore: string = readFileSync(join(clearRoot, TEAM, "inbox", "captain.jsonl"), "utf8")
  /** The clear's outcome at the watermark, which the positive assertions read. */
  const cleared: ClearOutcome = await state.clearMailboxToWatermark(clearRoot, TEAM, "captain", 500, { now: 1_000_000 })
  /** The live file's bytes after the clear, which must keep exactly as many lines as before. */
  const liveAfter: string = readFileSync(join(clearRoot, TEAM, "inbox", "captain.jsonl"), "utf8")
  /** Every record after the clear, tombstones included. */
  const allRecords: MailboxRecord[] = await state.readMailbox(clearRoot, TEAM, "captain")
  /** The live view after the clear, which must still name only the record above the watermark. */
  const liveView: MailboxRecord[] = await state.readLiveMailbox(clearRoot, TEAM, "captain")
  /** The tombstoned records, which must be exactly the two cleared ones. */
  const tombstones = allRecords.filter((record) => record.tombstone === true)
  /** The recoverable sidecar's text, or `""` when the clear wrote no sidecar. */
  const sidecarText: string = existsSync(cleared.sidecar) ? readFileSync(cleared.sidecar, "utf8") : ""
  /** The sidecar's parsed rows, which must reproduce the cleared payloads. */
  const sidecarRecords: unknown[] = sidecarText.split("\n").filter(Boolean).map((line) => JSON.parse(line))
  /** Whether every pre-clear id still appears in the mailbox (no hard delete happened). */
  const idSurvives: boolean = ["clear-1", "clear-2", "clear-3"].every((id) => allRecords.some((record) => record.id === id))
  /** Whether the sidecar recovers exactly the two cleared payloads. */
  const sidecarRecovers: boolean = sameJson(sidecarRecords, clearMessages.slice(0, 2))
    && sidecarText.includes("PAYLOAD-ALPHA") && sidecarText.includes("PAYLOAD-BETA")
  /** Whether the live view keeps exactly the one record above the watermark. */
  const cleanLiveView: boolean = liveView.length === 1 && liveView[0].id === "clear-3"
  /** The primitive clear lane's positive assertions. */
  const clearPositive = {
    ok: cleared.cleared.sort().join(",") === "clear-1,clear-2" && cleared.audit.kind === "mailbox-cleared"
      && cleared.audit.clearedCount === 2 && cleared.audit.clearedIds.sort().join(",") === "clear-1,clear-2"
      && existsSync(cleared.sidecar) && sidecarRecovers
      && tombstones.length === 2 && tombstones.every((record) => record.content === "")
      && idSurvives && cleanLiveView,
    cleared: cleared.cleared, audit: cleared.audit, sidecar: cleared.sidecar,
    sidecarRecords: sidecarRecords.length, tombstones: tombstones.length, idsSurvive: idSurvives, liveView: liveView.length,
  }
  // NEGATIVE CONTROL: no hard-delete path. The pre-clear id list must survive in the
  // live file, and the cleared payload must exist exactly once in the archive and
  // nowhere else under the workspace — so `rm` is not the mechanism.
  /** Every workspace file whose bytes carry the cleared payload marker. */
  const payloadLocations: string[] = []
  /** Walk `d` recursively, recording every readable text file that carries the marker. */
  const walkFiles = (d: string): void => {
    for (const entry of readdirSync(d)) {
      /** The candidate entry's absolute path, probed for directory-ness below. */
      const p: string = join(d, entry)
      if (statSync(p).isDirectory()) walkFiles(p)
      else {
        try { if (readFileSync(p, "utf8").includes("PAYLOAD-ALPHA")) payloadLocations.push(p) } catch { /* binary */ }
      }
    }
  }
  walkFiles(join(ws, "clear-ws"))
  /** The ids planted before the clear, which must all survive it. */
  const idsBefore: string[] = clearMessages.map((message) => message.id)
  /** The ids the mailbox still names after the clear. */
  const idsAfter: string[] = allRecords.map((record) => record.id)
  /** The clear's archive directory, which must hold exactly one sidecar. */
  const archiveDir: string = join(clearRoot, TEAM, "inbox", "archive")
  /** The primitive clear lane's negative control. */
  const clearNegative = {
    ok: idsBefore.every((id) => idsAfter.includes(id))
      && !liveAfter.includes("PAYLOAD-ALPHA") && !liveAfter.includes("PAYLOAD-BETA")
      && liveAfter.trim().split("\n").filter(Boolean).length === liveBefore.trim().split("\n").filter(Boolean).length
      && payloadLocations.length === 1 && payloadLocations[0] === cleared.sidecar
      && existsSync(archiveDir) && readdirSync(archiveDir).length === 1,
    idsSurvive: idsAfter, liveLines: liveAfter.trim().split("\n").filter(Boolean).length,
    payloadLocations: payloadLocations.map((p) => p.slice(ws.length + 1)),
    hardDelete: false,
  }
  steps.clear = { ok: clearPositive.ok && clearNegative.ok, positive: clearPositive, negative: clearNegative }

  // --- 4) INTERJECTION lane: positive + negative control ---
  /** The primitive interjection lane's own state root. */
  const ijRoot: string = join(ws, "ij-ws", STATE_DIR)
  mkdirSync(join(ijRoot, TEAM, "inbox"), { recursive: true })
  /** The clock the primitive interjection lane pins, so its TTL arithmetic is deterministic. */
  const ijTs: number = 2_000_000
  /** The queued request the primitive lane decides. */
  const queuedRequest: InterjectionRow = await state.enqueueInterjection(ijRoot, TEAM, {
    id: "ij-1", from: "Junior Engineer", to: "captain", content: "body-after-approval",
    ts: ijTs, summary: "need the runbook", reason: "blocked on the gate", location: "t36",
  })
  /** The pending view before any decision, which must carry exactly the queued request. */
  const pendingBefore: InterjectionRow[] = await state.readPendingInterjections(ijRoot, TEAM)
  /** The queue's own unread rows, which the shipped predicate must refuse to deliver. */
  const queueRecords: MailboxRecord[] = await state.readUnreadMailbox(ijRoot, TEAM, state.INTERJECTION_QUEUE)
  /** The queue directory's entries, which must hold exactly one jsonl file. */
  const inboxFiles: string[] = readdirSync(join(ijRoot, TEAM, "inbox"))
  // The scheduler packs EVERY unread record and auto-delivers it at the next idle
  // edge, so the pending request must NOT survive the shipped predicate. Drive the
  // predicate extracted from the shipped source (not a re-typed copy).
  // The region is asserted present for the same reason the shipped predicate above is: a missing
  // region must throw in the builder exactly as the pre-conversion `.replaceAll` on `null` did.
  /** The scheduler's exclusion region body, re-extracted for this lane. */
  const predicateSource: string = extractRegion(readFileSync(SCHEDULER_TS, "utf8"), "interjection-not-auto-delivered")!
  /** The predicate module assembled from that region. */
  const predicate: DeliverablePredicateModule = await import(buildDeliverablePredicate(predicateSource, state.INTERJECTION_KIND))
  /** The queue rows the shipped predicate is willing to auto-deliver, which must be none. */
  const deliverable: MailboxRecord[] = predicate.deliverableUnread(queueRecords)
  /** Whether the pending request reached no ordinary inbox and no auto-delivery read. */
  const notDeliveredPending: boolean = deliverable.length === 0 && queueRecords.length === 1
    && queueRecords[0].kind === state.INTERJECTION_KIND
    && !(await state.readUnreadMailbox(ijRoot, TEAM, "captain")).some((record) => record.kind === state.INTERJECTION_KIND)
  /** The ids that expired at one second past the enqueue, which must be none. */
  const notYetExpired: string[] = await state.expireInterjections(ijRoot, TEAM, { now: ijTs + 1000 })
  /** The approval decision's result. */
  const approved: InterjectionRow = await state.decideInterjection(ijRoot, TEAM, "ij-1", "approved", { now: ijTs + 2000 })
  /** The pending view after the approval, which must be empty. */
  const pendingAfter: InterjectionRow[] = await state.readPendingInterjections(ijRoot, TEAM)
  // The decided row is read unconditionally by the assertions below, exactly as the pre-conversion
  // code did, so the assertion keeps that failure mode instead of inventing a guard.
  /** The decided row, whose status must read `approved`. */
  const approvedRecord: InterjectionRow = (await state.readInterjections(ijRoot, TEAM)).find((record) => record.id === "ij-1")!
  // The approval RECORDS the decision; it must NOT leak the request into an
  // auto-delivered lane on its own (status is not a delivery marker).
  /** Whether the queue still holds nothing the shipped predicate would deliver. */
  const stillGatedAfterApproval: boolean = predicate.deliverableUnread(
    await state.readUnreadMailbox(ijRoot, TEAM, state.INTERJECTION_QUEUE),
  ).length === 0
  // The documented IN path: approving re-posts the request as an ORDINARY message into the
  // requester's own inbox (member keys are sanitized on write, exactly as the scheduler's
  // member names are), where the SAME shipped predicate delivers it. The interjection
  // `kind` is deliberately NOT carried over — that is what "re-post as an ordinary
  // message" means, and it is why the request cannot slip through as itself.
  //
  // ROOT CAUSE, and why this block asserts the LIBRARY's record instead of writing one
  // (review round 2, R2-F2): this case used to hand-write its own re-post under the id
  // `ij-1-delivery` — the very id `state.ts decideInterjection` had just written. The two
  // ids collided, the requester inbox held TWO records, and the `length === 1` assertion
  // failed. The library record is the production behaviour; a case that fabricates the
  // record it then counts proves nothing about the shipped path.
  //
  // The wider lesson this case must carry: a green result at the PRIMITIVE layer says
  // nothing about the path a user actually walks. That is exactly how this wave's
  // "library vs capability" defects survived earlier passes.
  /** The sanitized mailbox key the re-posted ordinary message lands under. */
  const requesterKey: string = "junior-engineer"
  /** The records the shipped predicate delivers to the requester, which must be exactly one. */
  const requesterInbox: MailboxRecord[] = predicate.deliverableUnread(await state.readUnreadMailbox(ijRoot, TEAM, requesterKey))
  /** The primitive interjection lane's positive assertions. */
  const interjectionPositive = {
    ok: pendingBefore.length === 1 && pendingBefore[0].expiresAt === ijTs + state.INTERJECTION_TTL_MS
      && queueRecords.length === 1 && inboxFiles.filter((f) => f.endsWith(".jsonl")).length === 1
      && notDeliveredPending && notYetExpired.length === 0
      && approved.status === "approved" && pendingAfter.length === 0
      && approvedRecord.status === "approved" && stillGatedAfterApproval
      // EXACTLY the ONE record the library posted, addressed to the requester, carrying the
      // approved body and NO interjection kind
      && requesterInbox.length === 1 && requesterInbox[0].id === "ij-1-delivery"
      && requesterInbox[0].from === state.CAPTAIN_KEY
      && requesterInbox[0].content.includes("Approved interjection \"ij-1\"")
      && requesterInbox[0].content.includes("body-after-approval")
      && requesterInbox[0].kind === undefined,
    queued: queueRecords.length, deliverableWhilePending: deliverable.length,
    notYetExpired: notYetExpired.length, status: approved.status,
    gatedEvenAfterApproval: stillGatedAfterApproval ? 1 : 0,
    requesterInboxAfterRepost: requesterInbox.length, requester: requesterInbox[0] ? requesterInbox[0].from : null,
    deliveredId: requesterInbox[0] ? requesterInbox[0].id : null,
    expiresAt: pendingBefore[0] ? pendingBefore[0].expiresAt : null,
  }
  /** The request the TTL control queues and then lets expire. */
  const ijTtl: InterjectionRow = await state.enqueueInterjection(ijRoot, TEAM, {
    id: "ij-ttl", from: "Lead", to: "captain", content: "s", ts: ijTs, summary: "s", reason: "r", location: "t36",
  })
  /** The ids that expired exactly at the TTL, which must be the TTL control's request. */
  const expired: string[] = await state.expireInterjections(ijRoot, TEAM, { now: ijTs + state.INTERJECTION_TTL_MS })
  // The expired row is read unconditionally by the assertions below, exactly as the pre-conversion
  // code did, so the assertion keeps that failure mode instead of inventing a guard.
  /** The expired row, whose status must read `expired`. */
  const ttlRecord: InterjectionRow = (await state.readInterjections(ijRoot, TEAM)).find((record) => record.id === "ij-ttl")!
  /** The pending view after the expiry, which must be empty. */
  const ttlPending: InterjectionRow[] = await state.readPendingInterjections(ijRoot, TEAM)
  steps.interjectionTtl = {
    ok: expired.length === 1 && expired[0] === "ij-ttl" && ttlRecord.status === "expired"
      && ttlPending.length === 0 && ttlRecord.from === "Lead",
    expired, status: ttlRecord.status, requester: ttlRecord.from, pendingLeft: ttlPending.length,
  }
  // NEGATIVE CONTROL: the shipped predicate must be falsifiable. Break the kind on the
  // SAME record and the same call must now return it — which is exactly why the post
  // above is not deliverable while it still carries the interjection kind.
  /** The queue rows with their interjection kind broken, which must become deliverable. */
  const spoofed = queueRecords.map((record) => ({ ...record, kind: "ordinary-message" }))
  /** What the shipped predicate delivers once the kind is broken. */
  const spoofedDeliverable: MailboxRecord[] = predicate.deliverableUnread(spoofed)
  /** Whether breaking the kind is enough to open the gate (the falsifiability proof). */
  const gateOpensWhenKindChanges: boolean = spoofedDeliverable.length === 1
  /** The primitive interjection lane's negative control. */
  const interjectionNegative = {
    ok: gateOpensWhenKindChanges && spoofedDeliverable[0].kind === "ordinary-message",
    deliverableWhenKindBroken: spoofedDeliverable.length,
    falsifiable: gateOpensWhenKindChanges,
  }
  steps.interjection = {
    ok: interjectionPositive.ok && steps.interjectionTtl.ok && interjectionNegative.ok,
    positive: interjectionPositive, negative: interjectionNegative, spoofedRecord: queuedRequest.id,
  }

  // --- 5) VENDOR_LOCK re-pin evidence (before/after) ---
  /** The vendor lock as recorded, narrowed to the assets this lane pins. */
  const lock: VendorLock = JSON.parse(readFileSync(LOCK_PATH, "utf8"))
  /** The `skills` fingerprint recomputed from the working tree, with the gate's own algorithm. */
  const computed: TreeSha = buildTreeSha(join(repoRoot, "skills"))
  /** The vendor gate's own run, whose exit status is recorded beside the recomputation. */
  const vendor = runSync(process.execPath, [join(repoRoot, "scripts", "verify-vendor.ts")], { timeout: 120000 })
  steps.vendorLock = {
    ok: lock.assets.skills.fileCount === computed.fileCount && lock.assets.skills.treeSha === computed.treeSha,
    before: { fileCount: lock.assets.skills.fileCount, treeSha: lock.assets.skills.treeSha },
    after: computed, gateExit: vendor.status,
  }

  /** Whether every recorded lane reported `ok`. */
  const allOk: boolean = Object.values(steps).every((s) => (typeof s === "object" && "ok" in s) ? s.ok : true)
  /** The run's evidence document, written verbatim to `result.json`. */
  const result = {
    schema: "mpd.omo-align.qa-shipped-path/2",
    task: "t36",
    case: CASE_SLUG,
    head: rev1,
    sandbox,
    workspace: ws,
    stateRoot,
    settledFiles: { state_js: hashes1[0], scheduler_js: hashes1[1] },
    loadEvidence: "mounted boot of the mpd preset in the sandbox home; --dump-config not cited",
    rootCause: "The original case asserted the state primitives only, so the F-1 class (library correct, shipped path unwired) passed every layer. It now drives agent_teams_send_message / agent_teams_mailbox_clear / agent_teams_interject_* against the real installTeamScheduler and counts deliveries on the member-queue seam, with a pre-fix RED arm.",
    knownLimits: [
      "The approval->auto-delivery path is probed at the STATE level: the approved request is re-posted as an ordinary message to the requester's inbox (the documented tool-wiring job) and the shipped predicate then delivers it. The tool-layer wiring that posts it AND drives the real scheduler idle edge for a spawned member is not driven here — it needs a long-lived captain session with live members, which the isolated headless environment cannot hold (same limitation recorded by t35).",
    ],
    ok: allOk,
    steps,
  }
  writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2))
  writeFileSync(join(outDir, "output.log"), LOG.join("\n\n---\n\n"))
  // Keep the raw artifacts the assertions read, so the evidence is re-computable: the
  // shipped-path inboxes (green/red/clear), the interjection lane, the pre-fix module
  // the RED arm ran, and the extracted scheduler predicate.
  try {
    cpSync(join(green.stateRoot, green.teamId, "inbox"), join(outDir, "raw", "shipped-green-inbox"), { recursive: true })
    cpSync(join(red.stateRoot, red.teamId, "inbox"), join(outDir, "raw", "shipped-red-inbox"), { recursive: true })
    cpSync(join(clearFixture.stateRoot, clearFixture.teamId, "inbox"), join(outDir, "raw", "shipped-clear-inbox"), { recursive: true })
    cpSync(join(ij.stateRoot, ij.teamId, "inbox"), join(outDir, "raw", "shipped-interjection-inbox"), { recursive: true })
    cpSync(join(stateRoot, TEAM, "inbox"), join(outDir, "raw", "primitive-captain-inbox"), { recursive: true })
    cpSync(join(ijRoot, TEAM, "inbox"), join(outDir, "raw", "primitive-interjection-inbox"), { recursive: true })
    writeFileSync(join(outDir, "raw", "prefix-tools.js"), prefix.source)
    writeFileSync(join(outDir, "raw", "deliverable-unread-region.js"), predicateSource)
  } catch { /* the assertions above are the gate; the raw copy is best-effort */ }

  console.log("[" + CASE_SLUG + "] ok=" + allOk + " -> " + outDir)
  for (const [key, value] of Object.entries(steps)) console.log("  " + key + ": " + JSON.stringify(value).slice(0, 300))
  if (!allOk) process.exit(1)
  console.log("[" + CASE_SLUG + "] PASS")
}

/** The case's own argv, so the run can select the offline self-test or the live arm. */
const argv: string[] = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
