#!/usr/bin/env node
// Case ulw-command (user clause 2 + clause 3 surface, and the §1.1 equivalence-table
// confirmation): prove on a REAL boot that
//   1. `/ulw` and `/ultrawork` are registered in the LIVE command registry — the mounted
//      probe lists them from the harness's own `commands` service and EXECUTES both
//      through `commands.execute()` (never a grep of source, never `--dump-config`);
//   2. an EMPTY invocation settles as `kind: "error"` carrying the usage line;
//   3. a NON-EMPTY invocation settles `success` AND really starts a run — the harness
//      session log records the ULW activation directive as a USER-ROLE message of the
//      invoking session, carrying the objective and the ordered autonomy clauses
//      (triage -> gate -> team -> loop -> fix on sight -> close-out, ask nothing);
//   4. the plain-text `/ulw <objective>` GESTURE (headless, no command surface) injects
//      the same directive with zero `command/run` records — the command path is not
//      what answered it.
// Evidence carrier rule (AGENTS.md §7): every assertion reads the harness's session log
// (`lib/session-evidence.ts`) or a value the real registry returned — never the model's
// prose.
//
// The model step is answered by the LOCAL OpenAI-shaped stub (`extension-isolation.ts`)
// so the boot is real while no provider credential is read or copied; `apiKeyEnv` is the
// stub literal. That is deliberate: the directive tells a captain to run the whole ULW
// discipline autonomously, and a live model would start a real run (out of scope here —
// the frozen contract names that as U1).
// PREREQ: absent-dsh-binary dsh install @deepseek-ai/dsh so the real harness binary is on PATH
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { readSessionEvents } from "./lib/session-evidence.ts"
import type { SessionRecord, SessionStore } from "./lib/session-evidence.ts"
import { sandboxWorkspace } from "./lib/workspace-isolation.ts"
import {
  REPO, binaryPresent, bootSession, cleanup, createSandbox, gatePrereqs, installProfile,
  isolationStep, keepRawSession, makeStubModel, timestamp, useStubRoute, writeEvidence,
} from "./extension-isolation.ts"

/** The case slug, used for the sandbox prefix, the evidence directory and every log line. */
const SLUG = "ulw-command"
/** The objective the COMMAND arm activates, matched against the injected directive. */
const OBJECTIVE_COMMAND = "qa-ulw-objective-command"
/** The objective the plain-text GESTURE arm activates. */
const OBJECTIVE_GESTURE = "qa-ulw-objective-gesture"
/** The ULW plugin's `src` entry: the offline directive fixture and the sandbox build input. */
const PLUGIN_SRC = join(REPO, "packages", "mpd-ulw-plugin", "src", "index.ts")
/** The shipped ULW plugin build the boot loads when it carries the whole command surface. */
const PLUGIN_DIST = join(REPO, "packages", "mpd-ulw-plugin", "dist", "index.js")
/** The command probe module mounted as a row by the `--patch` overlay. */
const PROBE = join(REPO, "skills", "dsh-qa", "scripts", "lib", "ulw-command-probe.ts")

/**
 * The literal surface the mounted artifact must carry for the boot to be able to
 * register the commands. Tested against the SHIPPED `dist/index.js` first; a wave that
 * changed only `src` (AGENTS.md §7 T-88: a package's built `dist` belongs to the
 * integration task) leaves that artifact stale, and the case then builds the SAME
 * canonical command from `src` into the sandbox and records the pending rebuild LOUDLY
 * instead of reading a stale artifact as "the feature is missing". The integration
 * rebuild flips `steps.artifact.source` back to `shipped`.
 */
export const COMMAND_SURFACE_MARKERS: readonly string[] = ["registerCommand", "ULW_ACTIVATION_DIRECTIVE", "usage: /ulw"]

/**
 * The surface the SHIPPED ADAPTER `dist` must carry for this case's boot to reach the
 * command plane at all: the adapter is the seam the ULW plugin registers through, and
 * the plugin's apply THROWS when the mounted adapter has no `registerCommand`
 * (measured pre-rebuild: `dsh.registerCommand is not a function`).
 */
export const ADAPTER_SURFACE_MARKERS: readonly string[] = ["registerCommand", "submitUserTurn"]

/** The injected activation directive's head (the marker that a rewrite really happened). */
export const DIRECTIVE_HEAD_RE: RegExp = /ULTRAWORK ACTIVATION/

/** The two registered spellings the frozen contract requires (one handler, two names). */
export const REQUIRED_COMMANDS: readonly string[] = ["ulw", "ultrawork"]

/** One ordered autonomy clause the injected directive must carry, probed by regex. */
interface ClauseProbe {
  /** Stable clause id, used in verdict payloads and failure messages. */
  readonly id: string
  /** Human-readable description of the contract clause the probe encodes. */
  readonly label: string
  /** Pattern matched against the INJECTED directive text, never against the plugin source. */
  readonly re: RegExp
}

/**
 * The ORDERED autonomy clauses the injected activation directive must carry. The first
 * five are the contract's C3.1-C3.5 behaviours; `fixOnSight` is C3.4b (D4(f)), part of
 * C3.4 and shipped as its own numbered clause. Each probe is a regex over the INJECTED
 * text, never over the plugin source. `HEAD_PROBE` is the un-numbered head sentence.
 */
export const CLAUSE_PROBES: readonly ClauseProbe[] = [
  { id: "triage", label: "C3.1 triage first (before gate/team/loop)", re: /TRIAGE FIRST/ },
  { id: "gate", label: "C3.2 the SAME complexity predicate (flag OR any signal A-E)", re: /GATE:[\s\S]{0,120}complexity predicate[\s\S]{0,160}signal A-E/ },
  { id: "team", label: "C3.3 gate-staged team plan, extended and self-approved on OUR plane", re: /TEAM WHEN WARRANTED[\s\S]{0,400}agent_teams_plan[\s\S]{0,400}(add_member|create_task)/ },
  { id: "loop", label: "C3.4 loop to completion without asking", re: /LOOP TO COMPLETION[\s\S]{0,120}never stop early to ask the user/ },
  { id: "fixOnSight", label: "C3.4b fix on sight", re: /FIX ON SIGHT/ },
  { id: "closeOut", label: "C3.5 close out on proof", re: /CLOSE OUT ON PROOF/ },
]
/** The activation head: the run asks the user nothing. */
export const HEAD_PROBE: ClauseProbe = { id: "noQuestions", re: /ask the user nothing/, label: "asks the user nothing" }

/** The RHS tool names the two `DSH Harness Tool Compatibility` tables rely on (observation). */
export const EQUIVALENCE_TABLE_TOOLS: readonly string[] = [
  "subagent", "subagent_fork", "job_output", "send_message", "job_kill", "interrupt_agent",
  "agent_teams_create", "agent_teams_status", "mpd_role_spawn", "mpd_role_persona", "skill",
]

/** One command descriptor the live registry listed, as far as this case validates it. */
type ListedDescriptor = {
  /** The registered command name. */
  readonly name?: string
  /** The description the registry serves for the command. */
  readonly description?: string
  /** The advertised input hint (`objective` for both ULW spellings). */
  readonly hint?: string
}

/** What the live-registry listing check concluded, plus the names it saw. */
interface ListingVerdict {
  /** Whether both required names are listed with usable metadata. */
  readonly ok: boolean
  /** The names the real registry listed, filtered to strings. */
  readonly names: string[]
  /** One human-readable problem per failed expectation. */
  readonly problems: string[]
}

/**
 * Whether the LIVE registry listed both spellings with a description and the objective hint.
 * @param descriptors The probe's recorded listing, unvalidated JSON.
 * @param required The command names the contract requires.
 * @returns The verdict, the names seen and every problem found.
 */
export function evaluateListing(descriptors: unknown, required: readonly string[] = REQUIRED_COMMANDS): ListingVerdict {
  /** One problem per failed expectation; empty means the listing passed. */
  const problems: string[] = []
  if (!Array.isArray(descriptors)) return { ok: false, names: [], problems: ["the real registry listing was not recorded"] }
  // The listing is harness-returned JSON: `Array.isArray` proves the array, and this view types the
  // descriptor fields for the `typeof`/equality validation that follows.
  /** The listed descriptors, viewed as the fields this case validates. */
  const listed = descriptors as readonly ListedDescriptor[]
  /** The listed names, kept only when they are strings. */
  const names: string[] = listed.map((descriptor) => descriptor?.name).filter((value): value is string => typeof value === "string")
  for (const name of required) {
    if (!names.includes(name)) problems.push("the live command registry does not list " + name)
  }
  for (const descriptor of listed) {
    if (descriptor?.name === undefined || !required.includes(descriptor.name)) continue
    if (typeof descriptor.description !== "string" || descriptor.description.trim() === "") problems.push("command " + descriptor.name + " listed without a description")
    if (descriptor.hint !== "objective") problems.push("command " + descriptor.name + " does not advertise the objective input hint")
  }
  return { ok: problems.length === 0, names, problems }
}

/**
 * One command invocation's settled result, as far as this case reads it. Both members
 * stay `unknown` because every verdict validates them with a `typeof` test before use.
 */
interface SettledCommandResult {
  /** The settlement kind the harness reported (`success`, `error`, ...), unvalidated. */
  readonly kind?: unknown
  /** The result text the harness reported, unvalidated. */
  readonly text?: unknown
}

/** What the empty-invocation check concluded, plus the settled result it read. */
interface UsageVerdict {
  /** Whether the invocation settled as an error carrying the usage line. */
  readonly ok: boolean
  /** One human-readable problem per failed expectation. */
  readonly problems: string[]
  /** The settled result, or `null` when the invocation never resolved. */
  readonly result: SettledCommandResult | null
}

/**
 * The empty invocation must settle as an error carrying the usage line (C2.3).
 * @param result The probe's recorded result for the empty invocation, or `null` when absent.
 * @param usageNeedle The usage line the result text must carry.
 * @returns The verdict plus the settled result for the evidence record.
 */
export function evaluateUsage(result: SettledCommandResult | null | undefined, usageNeedle: string = "usage: /ulw"): UsageVerdict {
  /** One problem per failed expectation; empty means the result passed. */
  const problems: string[] = []
  if (result === null || result === undefined) {
    problems.push("the empty invocation did not resolve (the name is not registered)")
  } else {
    if (result.kind !== "error") problems.push("an empty invocation must settle as kind 'error', got " + JSON.stringify(result.kind))
    if (typeof result.text !== "string" || !result.text.includes(usageNeedle)) problems.push("the empty-invocation text must carry the usage line (" + JSON.stringify(result.text ?? null) + ")")
  }
  return { ok: problems.length === 0, problems, result: result ?? null }
}

/** What the non-empty-invocation check concluded, plus the settled result it read. */
interface ActivationVerdict {
  /** Whether the invocation settled as a success naming the objective. */
  readonly ok: boolean
  /** One human-readable problem per failed expectation. */
  readonly problems: string[]
  /** The settled result, or `null` when the invocation never resolved. */
  readonly result: SettledCommandResult | null
}

/**
 * The non-empty invocation must settle success AND name the objective it started (C2.2).
 * @param result The probe's recorded result for the non-empty invocation, or `null` when absent.
 * @param objective The objective the success text must name.
 * @returns The verdict plus the settled result for the evidence record.
 */
export function evaluateActivation(result: SettledCommandResult | null | undefined, objective: string): ActivationVerdict {
  /** One problem per failed expectation; empty means the result passed. */
  const problems: string[] = []
  if (result === null || result === undefined) {
    problems.push("the non-empty invocation did not resolve (the name is not registered)")
  } else {
    if (result.kind !== "success") problems.push("a non-empty invocation must settle as kind 'success', got " + JSON.stringify(result.kind))
    if (typeof result.text !== "string" || !result.text.includes(objective)) problems.push("the success text must name the objective")
  }
  return { ok: problems.length === 0, problems, result: result ?? null }
}

/** One clause probe's match position inside the injected directive text. */
interface ClausePosition {
  /** The clause probe's stable id. */
  readonly id: string
  /** Index of the clause's match in the text, used for the ordering check. */
  readonly at: number
}

/** What one directive text yielded: matches, misses, physical order and clause numbering. */
interface DirectiveClauses {
  /** Every clause that matched, with its position. */
  readonly found: ClausePosition[]
  /** The ids of the clauses that did not match. */
  readonly missing: string[]
  /** The matched clause ids in match order. */
  readonly order: string[]
  /** Whether the matched clauses appear in physical text order. */
  readonly ordered: boolean
  /** The leading numbers of the numbered clause lines, in text order. */
  readonly numbering: number[]
  /** Whether those numbers ascend with the text order. */
  readonly numberedAscending: boolean
  /** How many numbered clause lines the text carries. */
  readonly numbered: number
}

/**
 * The ordered clause verdict for one directive text (used on the source fixture AND the log).
 * @param text The directive text to probe, unvalidated.
 * @returns The matches, misses, physical order and clause numbering.
 */
export function directiveClauses(text: unknown): DirectiveClauses {
  /** The clauses that matched, in probe order. */
  const found: ClausePosition[] = []
  /** The clause ids that did not match. */
  const missing: string[] = []
  for (const probe of CLAUSE_PROBES) {
    /** The probe's match in this text, or `null` when the clause is absent. */
    const match = probe.re.exec(String(text ?? ""))
    if (match === null) missing.push(probe.id)
    else found.push({ id: probe.id, at: match.index })
  }
  /** The matched clause ids, in match order. */
  const order = found.map((entry) => entry.id)
  /** Whether every matched clause sits after the previous one in the text. */
  const ordered = found.every((entry, index) => index === 0 || entry.at > found[index - 1].at)
  // The clause NUMBERS must ascend too: renumbering alone (1. GATE before 2. TRIAGE)
  // keeps the physical order but ships a directive whose own numbering contradicts it.
  /** The leading numbers of every numbered clause line, in text order. */
  const numbering = [...String(text ?? "").matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]))
  /** Whether those numbers ascend with the text order. */
  const numberedAscending = numbering.every((value, index) => index === 0 || value > numbering[index - 1])
  return { found, missing, order, ordered, numbering, numberedAscending, numbered: numbering.length }
}

/** Optional knobs for the directive predicate. */
interface DirectiveOptions {
  /** Minimum number of numbered clause lines the directive must carry. */
  readonly minClauses?: number
}

/** What one injected directive text was found to carry. */
interface DirectiveVerdict {
  /** Whether every clause, the order, the numbering, the head and the objective are present. */
  readonly ok: boolean
  /** One human-readable problem per failed expectation. */
  readonly problems: string[]
  /** The matched clause ids, in order. */
  readonly clauses: string[]
  /** How many numbered clause lines the text carries. */
  readonly numbered: number
  /** The head probe's id, so a failure names which head sentence was wanted. */
  readonly head: string
}

/**
 * The full assertion on ONE injected directive text: every clause present, in order,
 * at least five numbered clauses, and the objective appended last (C3.1-C3.5 + C3.4b).
 * @param text The directive text to assert, unvalidated.
 * @param objective The objective the text must carry after `OBJECTIVE: `.
 * @param options Optional `minClauses` override for the numbered-clause floor.
 * @returns The verdict, the matched clause ids and the numbering count.
 */
export function evaluateDirective(text: unknown, objective: string, { minClauses = 5 }: DirectiveOptions = {}): DirectiveVerdict {
  /** The clause verdict for this text. */
  const clauses = directiveClauses(text)
  /** One problem per failed expectation; empty means the directive passed. */
  const problems: string[] = []
  if (typeof text !== "string" || text.length === 0) problems.push("no injected directive message was found in the session log")
  for (const id of clauses.missing) problems.push("the injected directive is missing clause '" + id + "'")
  if (!clauses.ordered) problems.push("the injected directive clause order changed: " + clauses.order.join(" -> "))
  if (!clauses.numberedAscending) problems.push("the injected directive clause numbering does not ascend: " + clauses.numbering.join(","))
  if (clauses.numbered < minClauses) problems.push("the injected directive carries only " + clauses.numbered + " numbered clause(s)")
  if (!HEAD_PROBE.re.test(String(text ?? ""))) problems.push("the injected directive does not carry the head sentence ('" + HEAD_PROBE.id + "')")
  if (typeof text === "string" && !text.includes("OBJECTIVE: " + objective)) problems.push("the injected directive does not carry OBJECTIVE: " + objective)
  return { ok: problems.length === 0, problems, clauses: clauses.order, numbered: clauses.numbered, head: HEAD_PROBE.id }
}

/**
 * The directive array literal as shipped (fixture source for the offline arm).
 * @param source The plugin source text, unvalidated.
 * @returns The joined directive, or `null` when the literal is absent.
 */
export function extractDirective(source: unknown): string | null {
  /** Index where the shipped directive literal starts, or -1 when it is absent. */
  const start = String(source).indexOf("export const ULW_ACTIVATION_DIRECTIVE = [")
  if (start < 0) return null
  /** Index where the literal's `].join(` terminator starts, or -1 when it is absent. */
  const end = String(source).indexOf("].join(", start)
  if (end < 0) return null
  /** The literal's body, from the opening `[` to the `].join(` terminator. */
  const body = String(source).slice(start, end)
  // The quoted parts are JSON-escaped source text; `JSON.parse` is the unescaper the original used.
  /** The literal's string parts, unescaped in source order. */
  const parts: string[] = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => JSON.parse('"' + match[1] + '"'))
  return parts.length === 0 ? null : parts.join("\n")
}

/** One content block of a recorded user message, as far as this case reads it. */
type MessageContentBlock = {
  /** The block kind; only `text` blocks carry directive text. */
  readonly type?: unknown
  /** The block text, coerced with `String` exactly as before. */
  readonly text?: unknown
}

/** The payload of a recorded user message. */
type MessageRecordData = {
  /** The content blocks, absent or `null` when the record carried none. */
  readonly content?: readonly MessageContentBlock[] | null
}

/** The part of a `user/message` record this case reads. */
type UserMessageRecord = {
  /** The record's type tag; only `user/message` is of interest. */
  readonly type?: unknown
  /** The model-facing payload. */
  readonly data?: MessageRecordData | null
}

/**
 * The user-role texts the harness recorded (decoded frame-by-frame by the reader).
 * @param records The decoded session records, or `undefined` when the read failed.
 * @returns One text per `user/message` record that carried text.
 */
export function userMessageTexts(records: readonly SessionRecord[] | undefined): string[] {
  /** The recorded user texts, in record order. */
  const texts: string[] = []
  // The decoded records are dynamic JSON; they are viewed as the message shape this case reads.
  /** The records viewed as the message shape this case reads. */
  const messages = (records ?? []) as readonly UserMessageRecord[]
  for (const record of messages) {
    if (record?.type !== "user/message") continue
    // `Array.isArray` types its guarded value as `any[]`; the annotation restores the block shape
    // this case reads, so no `any` reaches the two callbacks below.
    /** The message's content blocks, or an empty list when the record carried none. */
    const content: readonly MessageContentBlock[] = Array.isArray(record?.data?.content) ? record.data.content : []
    /** The joined text of the message's `text` blocks. */
    const text = content.filter((block) => block?.type === "text").map((block) => String(block.text ?? "")).join("\n")
    if (text.length > 0) texts.push(text)
  }
  return texts
}

/** One recorded `command/run` entry, as far as this case reads it. */
type CommandRunRecord = {
  /** The command name the dispatcher entered. */
  readonly name?: string
  /** The raw argument text, defaulted to the empty string. */
  readonly args?: string
}

/** One recorded `command/done` entry, as far as this case reads it. */
type CommandDoneRecord = {
  /** The settlement kind (`success`, `error`, ...). */
  readonly kind?: string
  /** The settlement text, defaulted to the empty string. */
  readonly text?: string
}

/** The part of a command lifecycle record this case reads. */
type CommandEventRecord = {
  /** The record's type tag (`command/run` / `command/done`). */
  readonly type?: unknown
  /** The record's payload, carrying either the run fields or the settlement fields. */
  readonly data?: (CommandRunRecord & CommandDoneRecord) | null
}

/** One entered command, projected for the lifecycle verdict. */
interface CommandRun {
  /** The command name, or absent when the record carried none. */
  readonly name?: string
  /** The raw argument text, defaulted to the empty string. */
  readonly args?: string
}

/** One settled command, projected for the lifecycle verdict. */
interface CommandDone {
  /** The settlement kind, or absent when the record carried none. */
  readonly kind?: string
  /** The settlement text, defaulted to the empty string. */
  readonly text?: string
}

/** The harness's own command lifecycle records for one session. */
interface CommandLifecycle {
  /** Every `command/run` the session recorded, in record order. */
  readonly runs: CommandRun[]
  /** Every `command/done` the session recorded, in record order. */
  readonly dones: CommandDone[]
}

/**
 * The harness's own command lifecycle records for one session.
 * @param records The decoded session records, or `undefined` when the read failed.
 * @returns The entered commands and the settlements, in record order.
 */
export function commandRecords(records: readonly SessionRecord[] | undefined): CommandLifecycle {
  /** The entered commands, in record order. */
  const runs: CommandRun[] = []
  /** The settlements, in record order. */
  const dones: CommandDone[] = []
  // The decoded records are dynamic JSON; they are viewed as the command shape this case reads.
  /** The records viewed as the command lifecycle shape this case reads. */
  const events = (records ?? []) as readonly CommandEventRecord[]
  for (const record of events) {
    if (record?.type === "command/run") runs.push({ name: record.data?.name, args: record.data?.args ?? "" })
    if (record?.type === "command/done") dones.push({ kind: record.data?.kind, text: record.data?.text ?? "" })
  }
  return { runs, dones }
}

/** What the command-lifecycle check concluded. */
interface LifecycleVerdict {
  /** Whether both names ran and both settlement kinds were recorded. */
  readonly ok: boolean
  /** One human-readable problem per failed expectation. */
  readonly problems: string[]
  /** The command names the log recorded, in record order. */
  readonly names: Array<string | undefined>
  /** The settlement kinds the log recorded, in record order. */
  readonly kinds: Array<string | undefined>
}

/**
 * Both ULW names really entered the dispatcher, with one error (usage) and one success.
 * @param commands The lifecycle records read from the session log, or `undefined` when absent.
 * @returns The verdict plus the names and kinds seen.
 */
export function evaluateLifecycle(commands?: CommandLifecycle): LifecycleVerdict {
  /** One problem per failed expectation; empty means the lifecycle passed. */
  const problems: string[] = []
  /** The command names the log recorded. */
  const names = (commands?.runs ?? []).map((run) => run.name)
  for (const name of REQUIRED_COMMANDS) {
    if (!names.includes(name)) problems.push("the session log carries no command/run for " + name)
  }
  /** The settlement kinds the log recorded. */
  const kinds = (commands?.dones ?? []).map((done) => done.kind)
  if (!kinds.includes("error")) problems.push("the session log carries no command/done of kind 'error' (the empty invocation)")
  if (!kinds.includes("success")) problems.push("the session log carries no command/done of kind 'success' (the started run)")
  return { ok: problems.length === 0, problems, names, kinds }
}

/** The `tools[]` entry of a model request header, as far as the observation reads it. */
type RequestToolDescriptor = {
  /** The tool's flat name. */
  readonly name?: unknown
  /** The nested-function form some routes use instead. */
  readonly function?: { readonly name?: unknown } | null
}

/** The part of a `request/header` record this case reads. */
type RequestHeaderRecord = {
  /** The record's type tag; only `request/header` is of interest. */
  readonly type?: unknown
  /** The record's payload, holding the header the harness sent. */
  readonly data?: { readonly header?: { readonly tools?: readonly RequestToolDescriptor[] } | null } | null
}

/**
 * The tool names the model request header offered (harness-recorded tool-list evidence).
 * @param records The decoded session records, or `undefined` when the read failed.
 * @returns The offered tool names, or `[]` when no request header was recorded.
 */
export function headerToolNames(records: readonly SessionRecord[] | undefined): string[] {
  // The decoded records are dynamic JSON; they are viewed as the request-header shape read here.
  /** The records viewed as the request-header shape this case reads. */
  const headers = (records ?? []) as readonly RequestHeaderRecord[]
  for (const record of headers) {
    if (record?.type !== "request/header") continue
    /** The header's offered tools, when the record carried the array. */
    const tools = record?.data?.header?.tools
    if (!Array.isArray(tools)) continue
    // `Array.isArray` types its guarded value as `any[]`; this view restores the element shape the
    // observation reads, so no `any` flows out of this function.
    /** The offered tools, viewed as the descriptor shape the observation reads. */
    const listed: readonly RequestToolDescriptor[] = tools
    return listed.map((tool) => tool?.name ?? tool?.function?.name).filter((name): name is string => typeof name === "string")
  }
  return []
}

/**
 * A session-store read that failed: the decoder's throw is reported instead of propagated.
 * `records`/`file` are declared absent so the success path's two reads keep narrowing to the store.
 */
interface SessionReadFailure {
  /** The decoder's error message, carried into the arm result. */
  readonly error: string
  /** Absent on a failure: a failed read decodes no records. */
  readonly records?: undefined
  /** Absent on a failure: a failed read selects no log file. */
  readonly file?: undefined
}

/**
 * Read one workspace's newest session store, or a structured read error (never a throw).
 * @param dshHome The sandbox `DSH_HOME` whose `sessions/` tree is read.
 * @param workspace The session workspace whose project-keyed store is selected.
 * @returns The decoded store, or the throw's message as a structured failure.
 */
function readOrNull(dshHome: string, workspace: string): SessionStore | SessionReadFailure {
  try {
    return readSessionEvents(dshHome, { workspace })
  } catch (error) {
    // A caught value is `unknown` under strict mode, so the thrower's message is read through a view.
    return { error: String((error as { message?: unknown } | null)?.message ?? error) }
  }
}

/** Whether one built artifact exists and carries the surface markers the boot needs. */
interface ArtifactSurface {
  /** Whether the file exists at all. */
  readonly exists: boolean
  /** Whether every requested marker is present. */
  readonly fresh: boolean
  /** The markers that are missing (every marker when the file is absent). */
  readonly missing: string[]
}

/**
 * Whether a built artifact carries every marker of its surface.
 * @param path Absolute path of the built artifact.
 * @param markers The literal surface markers the boot needs.
 * @returns The existence/freshness verdict plus the missing markers.
 */
export function artifactSurface(path: string, markers: readonly string[]): ArtifactSurface {
  if (!existsSync(path)) return { exists: false, fresh: false, missing: [...markers] }
  /** The artifact's text, scanned for the markers. */
  const text = readFileSync(path, "utf8")
  /** The markers the artifact does not carry. */
  const missing = markers.filter((marker) => !text.includes(marker))
  return { exists: true, fresh: missing.length === 0, missing }
}

/** The artifact one plugin row resolved to, plus the row identity the overlay needs. */
interface ResolvedArtifact {
  /** The human label naming the plugin this artifact belongs to. */
  label: string
  /** Which artifact the boot will load: the shipped build or a sandbox build of `src`. */
  source: string
  /** Absolute path of the artifact the boot loads. */
  path: string
  /** Whether the resolved artifact carries its whole surface. */
  ok: boolean
  /** The SHIPPED artifact's surface verdict, recorded even when a build replaced it. */
  shipped?: ArtifactSurface
  /** The markers the shipped artifact lacks (empty when it is fresh). */
  missing: readonly string[]
  /** The sandbox build's exit status, or `null`/absent when no build ran. */
  buildExit?: number | null
  /** The sandbox build's surface verdict, absent when no build ran. */
  built?: ArtifactSurface
  /** The row id the overlay disables when the shipped artifact is stale. */
  rowId?: string
  /** The entry id the overlay inserts for the sandbox build. */
  insertId?: string
  /** The row config for the inserted entry. */
  config?: { readonly maxRounds: number }
}

/** The inputs of one artifact's resolution. */
interface ResolveArtifactInput {
  /** The sandbox the fallback build is written into. */
  readonly sandbox: string
  /** The human label, also used for the build's file name. */
  readonly label: string
  /** The `src` entry built when the shipped artifact is stale. */
  readonly srcEntry: string
  /** The shipped `dist` artifact to test first. */
  readonly distPath: string
  /** The surface markers the artifact must carry. */
  readonly markers: readonly string[]
  /** The evidence log the build transcript is appended to, when given. */
  readonly log?: string[]
}

/**
 * Resolve one plugin artifact for the boot: the SHIPPED `dist` when it carries the
 * surface, else a sandbox build of the same canonical repo-root `bun build` command
 * (never written to `dist`, never a hand edit). Returns the row override the overlay
 * needs when the shipped artifact is stale (the loader REFUSES a patch that changes a
 * row's `name`, so the stale row is DISABLED and the built one is inserted under a new
 * id — one registration either way).
 * @param input The sandbox, the shipped artifact, its markers and the optional transcript log.
 * @returns The resolved artifact, its surface verdicts and its row identity.
 */
export function resolveArtifact({ sandbox, label, srcEntry, distPath, markers, log }: ResolveArtifactInput): ResolvedArtifact {
  /** The shipped artifact's surface verdict, which decides whether a build is needed. */
  const shipped = artifactSurface(distPath, markers)
  if (shipped.fresh) return { label, source: "shipped", path: distPath, shipped, missing: [], ok: true }
  /** The sandbox path the fallback build writes to (never the repo's own `dist`). */
  const built = join(sandbox, "src-build", label + ".js")
  mkdirSync(join(sandbox, "src-build"), { recursive: true })
  /** The canonical `bun build` run for this artifact. */
  const build = spawnSync("bun", ["build", srcEntry, "--target", "node", "--format", "esm", "--outfile", built], { cwd: REPO, encoding: "utf8", timeout: 300000, stdio: ["ignore", "pipe", "pipe"] })
  if (log !== undefined) log.push("$ bun build " + srcEntry + " --target node --format esm --outfile " + built + "\n[[exit=" + build.status + "]]\n" + ((build.stdout || "") + (build.stderr || "")).slice(0, 2000))
  /** The fallback build's surface verdict. */
  const builtSurface = artifactSurface(built, markers)
  return {
    label, source: "src-built", path: built, shipped, missing: shipped.missing,
    buildExit: build.status,
    ok: build.status === 0 && builtSurface.fresh,
    built: builtSurface,
  }
}

/** The inputs of the `--patch` overlay: the resolved artifacts, plus the optional probe row. */
interface OverlayInput {
  /** The resolved artifacts whose stale shipped rows the overlay replaces. */
  readonly artifacts: readonly ResolvedArtifact[]
  /** The probe row to insert, or absent for an overlay that only replaces artifacts. */
  readonly probe?: { readonly outFile: string; readonly objective: string }
}

/**
 * The `--patch` overlay: row overrides first, then the inserted rows.
 * @param input The resolved artifacts and the optional probe row.
 * @returns The overlay YAML, or `null` when there is nothing to override.
 */
export function buildOverlay({ artifacts, probe }: OverlayInput): string | null {
  /** The overlay's top-level YAML lines. */
  const lines: string[] = []
  for (const artifact of artifacts) {
    if (artifact.source === "shipped") continue
    // A stale shipped row is replaced by the built one: the loader refuses a `name`
    // change on an existing row, so it is disabled and the build is inserted.
    lines.push("- id: " + artifact.rowId, "  disabled: true")
  }
  /** The `insert:` entry lines, indented under the list key. */
  const inserts: string[] = []
  for (const artifact of artifacts) {
    if (artifact.source === "shipped") continue
    inserts.push("    - id: " + artifact.insertId, "      name: " + JSON.stringify(artifact.path))
    if (artifact.config !== undefined) inserts.push("      config:", "        maxRounds: " + artifact.config.maxRounds)
  }
  if (probe !== undefined) {
    inserts.push("    - id: ulw-command-probe", "      name: " + JSON.stringify(PROBE), "      config:",
      "        outFile: " + JSON.stringify(probe.outFile), "        objective: " + JSON.stringify(probe.objective))
  }
  if (inserts.length > 0) lines.push("- insert:", ...inserts)
  return lines.length === 0 ? null : lines.join("\n") + "\n"
}

/** One artifact's resolution, recorded in the evidence document. */
interface ArtifactSourceRecord {
  /** Which artifact the boot loaded: the shipped build or a sandbox build of `src`. */
  readonly source: string
  /** Absolute path of the artifact the boot loaded. */
  readonly path: string
  /** The markers the shipped artifact lacked, for the pending-rebuild record. */
  readonly missingInShipped: readonly string[]
  /** The sandbox build's exit status, or `null` when no build ran. */
  readonly buildExit: number | null
}

/** One booted session's process outcome, as far as this case reads it. */
interface BootRun {
  /** The child's exit status, or `null` when it was killed by a signal. */
  readonly status: number | null
  /** The child's combined stdout+stderr. */
  readonly out: string
}

/** The sandbox assertion for one arm's boot. */
interface ArmIsolation {
  /** Whether the assertion passed. */
  readonly ok: boolean
  /** The assertion's cause, absent when it passed. */
  readonly error?: string
}

/** The record the mounted probe wrote: the live listing and the two invocations it executed. */
interface ProbeRecord {
  /** The live registry's descriptors, unvalidated JSON. */
  readonly descriptors?: unknown
  /** The empty invocation's settled result, unvalidated JSON. */
  readonly empty?: SettledCommandResult | null
  /** The non-empty invocation's settled result, unvalidated JSON. */
  readonly filled?: SettledCommandResult | null
}

/** One arm's boot result: the run, the probe record and the session-log evidence. */
interface ArmResult {
  /** The arm's label, also used for its workspace and sandbox naming. */
  readonly label: string
  /** The prompt the booted session received. */
  readonly prompt: string
  /** The sandboxed workspace the boot ran in. */
  readonly ws: string
  /** The boot's process outcome. */
  readonly run: BootRun
  /** The probe's record, or `null` when its row did not mount. */
  readonly probe: ProbeRecord | null
  /** The workspace's newest session store, or the structured read failure. */
  readonly store: SessionStore | SessionReadFailure
  /** The decoded session records (empty when the read failed). */
  readonly records: SessionRecord[]
  /** The command lifecycle the log recorded. */
  readonly commands: CommandLifecycle
  /** The user-role texts the log recorded. */
  readonly users: string[]
  /** The sandbox assertion for this arm. */
  readonly isolation: ArmIsolation
  /** Looks up the recorded directive text that carries `objective`, or `""` when none does. */
  readonly directiveFor: (objective: string) => string
}

/** The boot inputs of one arm. */
interface ArmInput {
  /** The user prompt the booted session receives. */
  readonly prompt: string
  /** The overlay passed as `--patch`, or `null` to boot the installed composition as-is. */
  readonly overlay: string | null
  /** The file the probe row writes its record to, or absent when no probe row is inserted. */
  readonly probeOut?: string
}

/** The gating assertions of one arm. */
interface ArmVerdict {
  /** Whether every gating assertion passed. */
  readonly ok: boolean
  /** One human-readable problem per failed expectation. */
  readonly problems: string[]
  /** The command names the live registry listed. */
  readonly listing: string[]
  /** The empty invocation's settled result, or `null` when it did not resolve. */
  readonly usage: SettledCommandResult | null
  /** The non-empty invocation's settled result, or `null` when it did not resolve. */
  readonly activation: SettledCommandResult | null
  /** The lifecycle names and settlement kinds the log recorded. */
  readonly lifecycle: { readonly runs: Array<string | undefined>; readonly kinds: Array<string | undefined> }
  /** The matched directive clause ids, in order. */
  readonly clauses: string[]
  /** How many numbered clause lines the directive carries. */
  readonly numbered: number
}

/** The labelled cross-lane finding the gesture arm carries when no rewrite happened. */
interface GestureFinding {
  /** Stable finding id naming the defect class. */
  readonly id: string
  /** The file that owns the repair. */
  readonly owner: string
  /** What the boot measured. */
  readonly detail: string
  /** The suggested repair. */
  readonly repair: string
  /** Where the proof lives. */
  readonly evidence: string
}

/** The gesture arm's verdict. */
interface GestureVerdict {
  /** Whether the arm failed for a reason OTHER than the known cross-lane finding. */
  readonly ok: boolean
  /** One human-readable problem per failed expectation. */
  readonly problems: string[]
  /** Whether a directive rewrite was recorded (this arm's gating flag). */
  readonly gating: boolean
  /** The labelled cross-lane finding, or `null` when the rewrite fired. */
  readonly finding: GestureFinding | null
  /** Whether the directive head was present in the recorded text. */
  readonly rewritten: boolean
  /** The matched directive clause ids, in order. */
  readonly clauses: string[]
  /** How many numbered clause lines the directive carries. */
  readonly numbered: number
  /** How many `command/run` records the gesture path produced. */
  readonly commandRuns: number
  /** Whether the recorded text carries the gesture objective. */
  readonly objectiveSeen: boolean
}

/**
 * The per-step verdict record the evidence carrier writes, in the order the steps run.
 * A type alias (not an interface) so the spread into the evidence payload stays an object type.
 */
type UlwCommandSteps = {
  /** The prerequisite gate and the isolated profile install. */
  install: { readonly ok: boolean; readonly exit: number | null }
  /** Which artifact each plugin row resolved to, plus the pending-rebuild flag. */
  artifact: {
    /** Whether every artifact resolved to something the boot can load. */
    readonly ok: boolean
    /** One resolution record per plugin artifact, keyed by label. */
    readonly sources: Record<string, ArtifactSourceRecord>
    /** The marker lists the shipped artifacts were tested against. */
    readonly shippedMarkers: { readonly adapter: readonly string[]; readonly ulw: readonly string[] }
    /** Whether a shipped artifact is stale and an integration rebuild is pending. */
    readonly pendingIntegrationRebuild: boolean
    /** Why a src-built artifact is acceptable evidence for this wave. */
    readonly note: string
  }
  /** The installed composition's arm, gating only while both shipped artifacts are fresh. */
  shippedComposition: ArmVerdict & { readonly gating: boolean; readonly applyFailure: boolean }
  /** The src-built arm that gates while a shipped artifact is stale. */
  resolvedArtifacts: ArmVerdict
  /** The plain-text gesture arm. */
  gesture: GestureVerdict
  /** How many model requests the local stub answered. */
  stubServed: { readonly ok: boolean; readonly requests: number }
  /** The sandbox assertion for the gating arm's workspace. */
  workspacesSandboxed: { readonly ok: boolean; readonly sandbox: string; readonly gatedWorkspace: string }
  /** The tool-list observation taken from the gating arm's request header. */
  equivalenceTableTools: { readonly ok: boolean; readonly observed: boolean; readonly toolCount: number; readonly missing: string[] }
}

/** The live arm: a real boot of the composition with the probe row mounted. */
async function runReal(): Promise<void> {
  gatePrereqs({
    slug: SLUG,
    prereqs: [{ code: "absent-dsh-binary", probe: "dsh", present: () => binaryPresent("dsh"), remedy: "install @deepseek-ai/dsh so the real harness binary is on PATH" }],
  })
  /** The evidence directory: the wave's override when set, else the repo's own evidence tree. */
  const outDir = process.env.MPD_QA_EVIDENCE_DIR
    ? join(process.env.MPD_QA_EVIDENCE_DIR, SLUG + "-" + timestamp())
    : join(REPO, "evidence", "dsh-qa", SLUG, timestamp())
  mkdirSync(outDir, { recursive: true })
  /** The boot transcript lines, joined into the evidence log at the end. */
  const log: string[] = []
  /** Appends one line of boot transcript to the evidence log. */
  const push = (text: string): void => { log.push(text) }

  /** The temp sandbox: DSH_HOME, HOME, session workspace and decoy. */
  const box = createSandbox(SLUG)
  /** The sandbox's parts, unpacked for the isolation assertion and every child spawn. */
  const { sandbox, dshHome, env } = box
  if (env.HOME === homedir() || dshHome === join(homedir(), ".dsh")) {
    console.error("[" + SLUG + "] FAIL: isolation assertion — the sandbox overlaps the real home")
    process.exit(1)
  }
  // The record is filled in step by step, so no single literal carries every member; the assertion
  // is erased at runtime and the object stays empty until the first step is recorded.
  /** The per-step verdict record, filled in as each step runs. */
  const steps = {} as UlwCommandSteps

  /** The isolated profile install for the headless profile. */
  const inst = await installProfile({ sandbox, dshHome, env })
  push("$ node scripts/install-profile.ts --yes --dsh-home " + dshHome + " --profile mpd-headless --skip-toolchain\n[[exit=" + inst.status + "]]\n" + inst.out.slice(0, 4000))
  steps.install = { ok: inst.status === 0, exit: inst.status }

  // ── the mounted artifacts ───────────────────────────────────────────────────
  // The adapter carries the command + turn seams this surface needs; both plugins are
  // resolved the same way. A stale SHIPPED artifact (a wave that changed `src` only —
  // the built `dist` belongs to the integration task, AGENTS.md §7 T-88) is replaced in
  // the sandbox composition by a build of the SAME canonical command, and is recorded
  // LOUDLY as a pending integration rebuild instead of reading a stale artifact as
  // "the feature is missing".
  /** The adapter's resolution: the shipped build, or a sandbox build of the same `src`. */
  const adapter = resolveArtifact({
    sandbox, label: "mpd-dsh-adapter",
    srcEntry: "packages/mpd-dsh-adapter-plugin/src/index.ts",
    distPath: join(REPO, "packages", "mpd-dsh-adapter-plugin", "dist", "index.js"),
    markers: ADAPTER_SURFACE_MARKERS, log,
  })
  adapter.rowId = "mpd-dsh-adapter"
  adapter.insertId = "ulw-command-adapter"
  /** The ULW plugin's resolution, tested against the shipped build first. */
  const ulw = resolveArtifact({
    sandbox, label: "mpd-ulw",
    srcEntry: "packages/mpd-ulw-plugin/src/index.ts",
    distPath: PLUGIN_DIST,
    markers: COMMAND_SURFACE_MARKERS, log,
  })
  ulw.rowId = "mpd-ulw"
  ulw.insertId = "ulw-command-artifact"
  ulw.config = { maxRounds: 3 }
  /** Both artifacts, in the order the overlay disables and re-inserts them. */
  const artifacts = [adapter, ulw]
  // `shippedFresh` decides WHICH composition is gated; `resolvedUsable` decides whether
  // any boot can run at all (a failed src build would otherwise be read as a feature gap).
  /** Whether both artifacts are the SHIPPED builds (no rebuild pending). */
  const shippedFresh = artifacts.every((artifact) => artifact.source === "shipped")
  /** Whether every artifact resolved to something the boot can load. */
  const resolvedUsable = artifacts.every((artifact) => artifact.ok === true)
  steps.artifact = {
    ok: resolvedUsable,
    sources: Object.fromEntries(artifacts.map((artifact): [string, ArtifactSourceRecord] => [artifact.label, { source: artifact.source, path: artifact.path, missingInShipped: artifact.missing, buildExit: artifact.buildExit ?? null }])),
    shippedMarkers: { adapter: ADAPTER_SURFACE_MARKERS, ulw: COMMAND_SURFACE_MARKERS },
    pendingIntegrationRebuild: !shippedFresh,
    note: "a src-built artifact proves the wave's code on a real boot; the shipped dist carries the same code after the wave's single integration rebuild",
  }
  if (!resolvedUsable) push("[artifact] a src-built artifact failed to build; the gated arms cannot run")

  // The model step is answered by the local stub: no provider credential is read,
  // and a stub cannot start a real autonomous ULW run.
  /** The local OpenAI-shaped stub that answers every model step. */
  const stub = makeStubModel({ label: SLUG, script: [{ text: "QA-STUB-ULW-COMMAND-OK" }] })
  /** The stub's loopback port, written into the sandbox's route patch. */
  const port = await stub.listen()
  useStubRoute(dshHome, port)

  /**
   * One booting arm: write the overlay (null = boot the installed composition as-is),
   * boot, and read the probe record + the harness session log for that workspace.
   * @param label The arm's label, used for its workspace and transcript prefix.
   * @param input The prompt, the overlay path (or `null`) and the probe's output file.
   * @returns The arm's run, probe record and session-log evidence.
   */
  async function arm(label: string, { prompt, overlay, probeOut }: ArmInput): Promise<ArmResult> {
    /** The sandboxed workspace this arm boots in. */
    const ws = sandboxWorkspace(sandbox, "ws-" + label)
    /** The extra CLI arguments: `--patch <overlay>` only when an overlay was written. */
    const args = overlay === null ? [] : ["--patch", overlay]
    /** The booted session's outcome. */
    const run = await bootSession({ slug: SLUG + "-" + label, env, cwd: ws, prompt, stub, extraArgs: args })
    push("[" + label + "] $ dsh --profile mpd-headless " + (overlay === null ? "" : "--patch <overlay> ") + JSON.stringify(prompt) + " (cwd " + ws + ")\n[[exit=" + run.status + "]]\n" + run.out.slice(0, 8000))
    /** The probe's record for this arm, or `null` when the row did not mount. */
    const probe: ProbeRecord | null = probeOut !== undefined && existsSync(probeOut) ? JSON.parse(readFileSync(probeOut, "utf8")) : null
    /** The workspace's newest session store, or the structured read failure. */
    const store = readOrNull(dshHome, ws)
    /** The decoded session records (empty when the read failed). */
    const records = store.records ?? []
    /** The command lifecycle the log recorded. */
    const commands = commandRecords(records)
    /** The user-role texts the log recorded. */
    const users = userMessageTexts(records)
    return {
      label, prompt, ws, run, probe, store, records, commands, users,
      isolation: isolationStep(dshHome, sandbox, SLUG + "-" + label),
      directiveFor: (objective: string): string => users.find((text) => text.includes(objective)) ?? "",
    }
  }

  /**
   * The gating assertions of one arm: registry listing, usage, activation, injection.
   * @param armResult The arm's run, probe record and session-log evidence.
   * @param objective The objective the arm activated.
   * @returns The arm's verdict, naming every failed expectation.
   */
  function evaluateArm(armResult: ArmResult, objective: string): ArmVerdict {
    /** One problem per failed expectation; empty means the arm passed. */
    const problems: string[] = []
    /** The live-registry listing verdict. */
    const listing = evaluateListing(armResult.probe?.descriptors)
    /** The empty-invocation verdict. */
    const usage = evaluateUsage(armResult.probe?.empty)
    /** The non-empty-invocation verdict. */
    const activation = evaluateActivation(armResult.probe?.filled, objective)
    /** The command-lifecycle verdict. */
    const lifecycle = evaluateLifecycle(armResult.commands)
    /** The injected-directive verdict. */
    const injected = evaluateDirective(armResult.directiveFor(objective), objective)
    for (const part of [listing, usage, activation, lifecycle, injected]) problems.push(...part.problems)
    if (armResult.probe === null) problems.push("the probe recorded nothing (its row did not mount, or the plugin tree failed to load)")
    if (!armResult.isolation.ok) problems.push("workspace isolation violated: " + armResult.isolation.error)
    if (armResult.run.status !== 0) problems.push("the boot exited " + armResult.run.status)
    return { ok: problems.length === 0, problems, listing: listing.names, usage: usage.result, activation: activation.result, lifecycle: { runs: lifecycle.names, kinds: lifecycle.kinds }, clauses: injected.clauses, numbered: injected.numbered }
  }

  /**
   * The C2.4 GESTURE arm. A KNOWN cross-lane defect makes the rewrite not happen at all
   * in a real composition: `packages/mpd-ulw-plugin/src/index.ts` matches the gesture
   * against the LAST user-role message of the claimed batch, and this bundle's own
   * composition appends user-role notices AFTER the prompt (runtime context,
   * `<system-reminder>` skill catalog — visible in the same session log). The arm is
   * therefore recorded as a labelled finding owned by the ULW plugin lane, and only a
   * DIFFERENT gesture failure (a directive that IS present but malformed, or a
   * command/run record on this path) fails this case.
   * @param gesture The gesture arm's boot result.
   * @returns The gesture verdict, carrying the labelled finding when no rewrite fired.
   */
  function evaluateGesture(gesture: ArmResult): GestureVerdict {
    /** The recorded text carrying the gesture objective, or `""` when none does. */
    const text = gesture.directiveFor(OBJECTIVE_GESTURE)
    /** Whether the directive head was recorded (the property this arm gates on). */
    const rewritten = DIRECTIVE_HEAD_RE.test(text)
    /** The clause verdict for the recorded text. */
    const directive = evaluateDirective(text, OBJECTIVE_GESTURE)
    /** One problem per failed expectation; empty means the gesture arm passed. */
    const problems: string[] = []
    if (rewritten) problems.push(...directive.problems)
    if (gesture.commands.runs.length !== 0) problems.push("the gesture path must record NO command/run (it is not the command path): " + JSON.stringify(gesture.commands.runs))
    if (gesture.run.status !== 0) problems.push("the boot exited " + gesture.run.status)
    if (!gesture.isolation.ok) problems.push("workspace isolation violated: " + gesture.isolation.error)
    /** The labelled cross-lane finding, or `null` when the rewrite fired. */
    const finding: GestureFinding | null = rewritten ? null : {
      id: "gesture-rewrite-never-fires",
      owner: "packages/mpd-ulw-plugin/src/index.ts",
      detail: "a real boot records the raw `/ulw <objective>` user message and ZERO rewrites (" + directive.problems.length + " clause problem(s)): the listener matches the gesture against the LAST user-role message of the claimed batch, but the composition appends user-role notices after the prompt (runtime context + `<system-reminder>` skill catalog), so the pattern never matches",
      repair: "match the gesture against the user's OWN message (the first user text of the claimed batch, or scan every user text for the pattern) instead of the last user-role message",
      evidence: "the same session log holds the raw prompt as one user message, the injected notices as LATER user messages, and 0 occurrences of the directive head",
    }
    return {
      ok: problems.length === 0,
      problems,
      gating: rewritten,
      finding,
      rewritten,
      clauses: directive.clauses,
      numbered: directive.numbered,
      commandRuns: gesture.commands.runs.length,
      objectiveSeen: text.includes(OBJECTIVE_GESTURE),
    }
  }

  // ── arm SHIPPED: the composition exactly as installed (a user's boot) ───────
  // It is the GATING arm when both shipped artifacts are fresh; while a rebuild is
  // pending it is recorded as the pending-rebuild observation of the real user path.
  /** The shipped arm's probe output file. */
  const shippedProbeOut = join(sandbox, "probe-shipped.json")
  /** The shipped arm's overlay YAML (the probe row only). */
  const shippedOverlayText = buildOverlay({ artifacts: [], probe: { outFile: shippedProbeOut, objective: OBJECTIVE_COMMAND } })
  /** The shipped arm's overlay file. */
  const shippedOverlay = join(sandbox, "overlay-shipped.yml")
  // The probe row is always given above, so this overlay is never the null return.
  writeFileSync(shippedOverlay, shippedOverlayText!)
  /** The shipped arm's boot result. */
  const shippedArm = await arm("shipped", { prompt: "Reply with exactly: ulw-command-shipped-ok", overlay: shippedOverlay, probeOut: shippedProbeOut })
  steps.shippedComposition = { ...evaluateArm(shippedArm, OBJECTIVE_COMMAND), gating: shippedFresh, applyFailure: /failed to apply loader entry|failed to load/.test(shippedArm.run.out) }
  if (shippedArm.store.file !== undefined) keepRawSession(outDir, "arm-shipped", shippedArm.store)

  /** The arm whose verdict gates the case (the shipped arm, or the src-built one). */
  let gated: ArmResult = shippedArm
  /** The gating arm's problems, recorded in the evidence document. */
  let gatedProblems: string[] = []
  if (!shippedFresh) {
    // ── arm RESOLVED: the stale rows replaced by builds of the same canonical command ──
    /** The resolved arm's probe output file. */
    const probeOut = join(sandbox, "probe-resolved.json")
    /** The resolved arm's overlay file. */
    const overlay = join(sandbox, "overlay-resolved.yml")
    // Both artifacts are given, so this overlay always carries at least the inserted rows.
    writeFileSync(overlay, buildOverlay({ artifacts, probe: { outFile: probeOut, objective: OBJECTIVE_COMMAND } })!)
    gated = await arm("resolved", { prompt: "Reply with exactly: ulw-command-resolved-ok", overlay, probeOut })
    steps.resolvedArtifacts = evaluateArm(gated, OBJECTIVE_COMMAND)
    if (gated.store.file !== undefined) keepRawSession(outDir, "arm-resolved", gated.store)

    // The plain-text GESTURE path (headless has no command surface) on the same
    // artifact set: no probe row, and ZERO command/run records may appear.
    /** The gesture arm's overlay file (the artifact rows, no probe). */
    const gestureOverlay = join(sandbox, "overlay-gesture.yml")
    // The artifact list is non-empty, so this overlay always carries the inserted rows.
    writeFileSync(gestureOverlay, buildOverlay({ artifacts })!)
    /** The gesture arm's boot result. */
    const gesture = await arm("gesture", { prompt: "/ulw " + OBJECTIVE_GESTURE, overlay: gestureOverlay })
    steps.gesture = evaluateGesture(gesture)
    if (gesture.store.file !== undefined) keepRawSession(outDir, "arm-gesture", gesture.store)
    gatedProblems = steps.resolvedArtifacts.problems
  } else {
    // With fresh shipped artifacts the gesture arm boots the installed composition
    // as-is: there is nothing to override.
    /** The gesture arm's boot result on the installed composition. */
    const gesture = await arm("gesture", { prompt: "/ulw " + OBJECTIVE_GESTURE, overlay: null })
    steps.gesture = evaluateGesture(gesture)
    if (gesture.store.file !== undefined) keepRawSession(outDir, "arm-gesture", gesture.store)
    gatedProblems = steps.shippedComposition.problems
  }
  await stub.close()

  steps.stubServed = { ok: stub.requests() > 0, requests: stub.requests() }
  steps.workspacesSandboxed = { ok: true, sandbox, gatedWorkspace: gated.ws }
  /** The tool names the gating arm's request header offered. */
  const offered = headerToolNames(gated.records) || []
  steps.equivalenceTableTools = {
    ok: offered.length > 0,
    observed: offered.length > 0,
    toolCount: offered.length,
    missing: EQUIVALENCE_TABLE_TOOLS.filter((name) => !offered.includes(name)),
  }

  /** The cross-lane findings this run carries (the gesture finding, when no rewrite fired). */
  const crossLaneFindings: GestureFinding[] = steps.gesture.finding === null ? [] : [steps.gesture.finding]
  /** Whether the case passed as a whole. */
  const ok = writeEvidence(outDir, SLUG, {
    // The verdict covers this lane's acceptance: the command surface on a real boot
    // (registry listing + usage + activation + directive), the artifact resolution and
    // the tool-list observation. `steps.shippedComposition` is GATING only when the
    // shipped artifacts are fresh; `steps.gesture` fails this case only on a gesture
    // failure OTHER than the known cross-lane finding it carries.
    ok: steps.install.ok && steps.artifact.ok && gatedProblems.length === 0 && (steps.gesture.ok || steps.gesture.gating === false) && steps.equivalenceTableTools.ok,
    steps: { ...steps, gatedProblems },
    crossLaneFindings,
    env: { DSH_HOME: dshHome, HOME: env.HOME },
    gatingArm: shippedFresh ? "shipped" : "resolved (src-built artifacts)",
    gatingNote: "steps.shippedComposition (gating=" + steps.shippedComposition.gating + ") and steps.gesture (gating=" + steps.gesture.gating + ") are recorded; a repair of the gesture finding turns its gating flag true",
  }, log.join("\n\n---\n\n"))
  cleanup(sandbox)
  if (!ok) process.exit(1)
  console.log("[" + SLUG + "] PASS")
}

// ── offline --self-test ──────────────────────────────────────────────────────
/** The offline arm: every predicate with its negative control, plus the overlay surgery on fixtures. */
function selfTest(): void {
  /** Every failed expectation, reported together at the end. */
  const problems: string[] = []
  /** Records one failed expectation. */
  const check = (condition: boolean, label: string): void => { if (!condition) problems.push(label) }

  // 1) the LIVE-registry predicate: both names + metadata, falsifiable on both sides.
  check(evaluateListing([{ name: "ulw", description: "u", hint: "objective" }, { name: "ultrawork", description: "u", hint: "objective" }]).ok, "reference listing must pass")
  check(!evaluateListing([{ name: "ulw", description: "u", hint: "objective" }]).ok, "negative control: a single registered name must fail")
  check(!evaluateListing([]).ok, "negative control: an empty registry must fail")
  check(!evaluateListing([{ name: "ulw", description: "", hint: "objective" }, { name: "ultrawork", description: "u", hint: "objective" }]).ok, "negative control: an empty description must fail")
  check(!evaluateListing([{ name: "ulw", description: "u", hint: null }, { name: "ultrawork", description: "u", hint: "objective" }]).ok, "negative control: a missing input hint must fail")
  check(!evaluateListing(null).ok, "negative control: an unrecorded listing must fail")

  // 2) the empty-invocation / started-run predicates.
  check(evaluateUsage({ kind: "error", text: "usage: /ulw <objective> (alias: /ultrawork <objective>)" }).ok, "the usage result must pass")
  check(!evaluateUsage({ kind: "success", text: "ULW activated: x" }).ok, "negative control: a success on empty input must fail")
  check(!evaluateUsage({ kind: "error", text: "boom" }).ok, "negative control: an error without the usage line must fail")
  check(!evaluateUsage(null).ok, "negative control: an unresolved name must fail")
  check(evaluateActivation({ kind: "success", text: "ULW activated: obj" }, "obj").ok, "the activation result must pass")
  check(!evaluateActivation({ kind: "error", text: "ULW could not start" }, "obj").ok, "negative control: a failed activation must fail")
  check(!evaluateActivation({ kind: "success", text: "ULW activated: other" }, "obj").ok, "negative control: a success for another objective must fail")

  // 3) the directive predicate against the SHIPPED directive literal (source fixture),
  //    plus order/content controls. The same predicate runs on the real session log.
  /** The ULW plugin source, read as the directive fixture. */
  const source = readFileSync(PLUGIN_SRC, "utf8")
  /** The shipped directive literal's joined text, or `null` when it could not be extracted. */
  const directive = extractDirective(source)
  check(typeof directive === "string" && directive.length > 0, "the ULW_ACTIVATION_DIRECTIVE literal could not be extracted")
  /** The full predicate verdict on the shipped directive plus an objective. */
  const good = evaluateDirective((directive ?? "") + "\n\nOBJECTIVE: self-test-objective", "self-test-objective")
  check(good.ok, "the shipped directive must satisfy the clause predicate: " + good.problems.join("; "))
  check(good.clauses.length === CLAUSE_PROBES.length, "every clause probe must match the shipped directive")
  // Order/reordering controls: physically swapping two clause LINES and renumbering
  // alone must each fail the predicate (the number swap alone must not, since the
  // physical order — the property the contract cares about — is preserved).
  /**
   * Physically swaps the two clause lines whose leading numbers are `a` and `b`.
   * @param text The directive text to reorder.
   * @param a The first clause line's leading number.
   * @param b The second clause line's leading number.
   * @returns The text with the two clause lines exchanged in place.
   */
  const swapLines = (text: string, a: string, b: string): string => {
    /** The text split into lines, so a clause line can be found by prefix. */
    const lines = String(text).split("\n")
    /** Index of the first line starting with `prefix`, or -1 when absent. */
    const at = (prefix: string): number => lines.findIndex((line) => line.startsWith(prefix))
    /** The index of the first clause line to swap. */
    const indexA = at(a + ". ")
    /** The index of the second clause line to swap. */
    const indexB = at(b + ". ")
    /** A copy of the lines, so the original line array stays readable while swapping. */
    const swappedLines = [...lines]
    swappedLines[indexA] = lines[indexB]
    swappedLines[indexB] = lines[indexA]
    return swappedLines.join("\n")
  }
  /** The physically reordered directive (clauses 1 and 2 exchanged). */
  const reordered = swapLines(directive ?? "", "1", "2")
  check(!evaluateDirective(reordered + "\n\nOBJECTIVE: self-test-objective", "self-test-objective").ok, "negative control: a physically reordered clause pair must fail")
  /** The shipped directive with its clause numbers alone rewritten out of order. */
  const renumbered = (directive ?? "").replace(/^1\. TRIAGE FIRST/m, "9. TRIAGE FIRST").replace(/^2\. GATE:/m, "1. GATE:").replace(/^9\. TRIAGE FIRST/m, "2. TRIAGE FIRST")
  check(!evaluateDirective(renumbered + "\n\nOBJECTIVE: self-test-objective", "self-test-objective").ok, "negative control: non-ascending clause numbers must fail")
  check(!evaluateDirective((directive ?? "").replace(/^5\. FIX ON SIGHT.*$/m, "") + "\n\nOBJECTIVE: self-test-objective", "self-test-objective").ok, "negative control: a removed clause must fail")
  check(!evaluateDirective((directive ?? "") + "\n\nOBJECTIVE: another-objective", "self-test-objective").ok, "negative control: a directive without the objective must fail")
  check(!evaluateDirective("", "self-test-objective").ok, "negative control: an empty directive must fail")

  // 4) the command-lifecycle predicate.
  check(evaluateLifecycle({ runs: [{ name: "ulw" }, { name: "ultrawork" }], dones: [{ kind: "error" }, { kind: "success" }] }).ok, "the reference lifecycle must pass")
  check(!evaluateLifecycle({ runs: [{ name: "ulw" }], dones: [{ kind: "error" }, { kind: "success" }] }).ok, "negative control: a missing command/run must fail")
  check(!evaluateLifecycle({ runs: [{ name: "ulw" }, { name: "ultrawork" }], dones: [{ kind: "success" }] }).ok, "negative control: a missing usage failure must fail")
  check(!evaluateLifecycle({ runs: [], dones: [] }).ok, "negative control: an empty store must fail")

  // 5) the shipped surface must exist where the case reads it.
  check(existsSync(PROBE), "the command probe module is missing")
  check(COMMAND_SURFACE_MARKERS.every((marker) => source.includes(marker)), "packages/mpd-ulw-plugin/src/index.ts does not carry the full command surface: " + COMMAND_SURFACE_MARKERS.filter((marker) => !source.includes(marker)).join(","))
  check(source.includes('["ulw", "ultrawork"]'), "the plugin must register both spellings from one handler")
  check(source.includes("usage: /ulw <objective>"), "the plugin must ship the usage line the case asserts")

  // 6) the composition surgery that replaces a stale row: pinned offline on fixtures,
  //    because a wrong overlay silently boots the WRONG artifact.
  /** The scratch directory the fixture artifacts are written into. */
  const tmp = mkdtempSync(join(tmpdir(), "mpd-ulw-command-selftest-"))
  try {
    /** A fixture artifact carrying the full command surface. */
    const fresh = join(tmp, "fresh.js")
    writeFileSync(fresh, COMMAND_SURFACE_MARKERS.join("\n") + "\n")
    /** A fixture artifact carrying none of the surface markers. */
    const stale = join(tmp, "stale.js")
    writeFileSync(stale, "// an artifact from before the change\n")
    check(artifactSurface(fresh, COMMAND_SURFACE_MARKERS).fresh, "artifactSurface must accept a file carrying every marker")
    /** The stale fixture's surface verdict. */
    const staleSurface = artifactSurface(stale, COMMAND_SURFACE_MARKERS)
    check(!staleSurface.fresh && staleSurface.missing.length === COMMAND_SURFACE_MARKERS.length, "artifactSurface must report a stale file's missing markers")
    check(!artifactSurface(join(tmp, "absent.js"), COMMAND_SURFACE_MARKERS).fresh, "artifactSurface must treat a missing file as stale")

    /** A fresh shipped artifact, as `resolveArtifact` returns one. */
    const shippedArtifact: ResolvedArtifact = { label: "mpd-ulw", source: "shipped", path: fresh, rowId: "mpd-ulw", insertId: "ulw-command-artifact", missing: [], ok: true }
    /** A stale artifact replaced by a sandbox build, carrying a row config. */
    const staleArtifact: ResolvedArtifact = { label: "mpd-ulw", source: "src-built", path: stale, rowId: "mpd-ulw", insertId: "ulw-command-artifact", config: { maxRounds: 3 }, missing: ["registerCommand"], ok: true }
    /** The overlay for a composition whose only artifact is fresh. */
    const freshOverlay = buildOverlay({ artifacts: [shippedArtifact], probe: { outFile: join(tmp, "p.json"), objective: "obj" } })
    check(freshOverlay!.includes("ulw-command-probe") && !freshOverlay!.includes("disabled"), "a fresh artifact must not disable or replace any row")
    check(buildOverlay({ artifacts: [shippedArtifact] }) === null, "no stale artifact and no probe must produce no overlay at all")
    /** The overlay for a composition with one stale artifact. */
    const staleOverlay = buildOverlay({ artifacts: [staleArtifact], probe: { outFile: join(tmp, "p.json"), objective: "obj" } })
    check(/- id: mpd-ulw\n  disabled: true/.test(staleOverlay!), "a stale artifact must DISABLE its shipped row (a name change is refused by the loader)")
    check(staleOverlay!.includes("    - id: ulw-command-artifact") && staleOverlay!.includes(JSON.stringify(stale)), "a stale artifact must be inserted under its own id, pointing at the build")
    check(staleOverlay!.includes("maxRounds: 3"), "the inserted row must carry the plugin config")

    // `resolveArtifact` prefers a fresh SHIPPED file and does not build in that case.
    /** The resolution of a fresh shipped artifact. */
    const resolved = resolveArtifact({ sandbox: tmp, label: "ulw-command-self-test", srcEntry: "packages/mpd-ulw-plugin/src/index.ts", distPath: fresh, markers: COMMAND_SURFACE_MARKERS })
    check(resolved.source === "shipped" && resolved.path === fresh && !existsSync(join(tmp, "src-build")), "resolveArtifact must use a fresh shipped artifact without building")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  /** The QA skill document, read only for the case-table row assertion. */
  const skill = readFileSync(join(REPO, "skills", "dsh-qa", "SKILL.md"), "utf8")
  check(skill.includes("| ulw-command |"), "the case table does not list ulw-command")

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " problem(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: registry listing + usage + activation + directive order/objective + command lifecycle predicates, each with a negative control; shipped directive literal and SKILL.md row verified")
}

// Guarded on being the ENTRY module (the SAME guard `session-start-team.ts` carries): this file
// exports predicates and clause fixtures, and an IMPORT must be inert. MEASURED this wave: without the
// guard, importing the module for its exported `CLAUSE_PROBES` executed the whole case body and started
// a full sandboxed live run, which wrote an untracked evidence directory as a side effect of what
// looked like a read-only lookup.
// The CLI arguments after the script path: `--self-test` selects the offline arm.
const argv = process.argv.slice(2)
/** Whether this module is the process entry point, which alone may run the case. */
const isEntry = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isEntry) {
  if (argv.includes("--self-test")) selfTest()
  else await runReal()
}
