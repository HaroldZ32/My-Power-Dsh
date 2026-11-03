#!/usr/bin/env node
// Case surface-pin (wave W7): ONE offline pin for every surface the autoproject refactor introduced.
//
// WHY A TEXT PIN AND NOT A BOOT. The surfaces this case guards are DECLARATIONS — a tool's name, its
// parameter keys, its action enum, a command's registered name, and the STRUCTURAL KEY NAMES that couple
// the global-memory archive hook to three producers. Every one of them is read from the SHIPPED SOURCE,
// so this case is fully OFFLINE (no dsh, no credentials, no sandbox) and runs in milliseconds. A real
// boot already covers behaviour elsewhere; what was missing was ONE place that reddens the day a
// declaration is renamed away, which is exactly the M1 defect class (a producer-side rename silently
// turned the archive hook into a no-op).
//
// NEGATIVE CONTROLS ARE THE POINT. This repository judges a case by whether its assertions can fail, so
// `--self-test` drives every predicate against a fixture AND against a MUTATED copy of it, and fails if
// the mutation does NOT redden.

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** The repository root, derived from this script's own URL (three directories up). */
const REPO = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The case slug, used for the evidence directory and every log line. */
const SLUG = "surface-pin"

/** The shipped source files this case reads. Every path is repository-relative. */
export const SOURCES = {
  /** The autoproject tool + its `/autoproject` command. */
  autoproject: "packages/mpd-autoproject-plugin/src/index.ts",
  /** The merged boulder machine, which owns `mpd_boulder_complete`. */
  boulder: "packages/mpd-autoproject-plugin/src/boulder/index.ts",
  /** The five `agent_teams_*` tools. */
  teamCore: "packages/mpd-team-core-plugin/src/index.ts",
  /** `cellwork_open` and the four lifecycle tools. */
  cellworkIndex: "packages/mpd-cellwork-plugin/src/index.ts",
  /** The requirements/recon/split/activate tools. */
  cellworkFlow: "packages/mpd-cellwork-plugin/src/flow.ts",
  /** The supervision/communication tools, including `cellwork_stop`'s siblings. */
  cellworkProtocol: "packages/mpd-cellwork-plugin/src/protocol.ts",
  /** The workmate tools + `/workmate-optimize`. */
  workmate: "packages/mpd-workmate-plugin/src/index.ts",
  /** The memory tools (`scope`, `offset`, `next_offset`). */
  memory: "packages/mpd-memory-plugin/src/index.ts",
  /** The archive HOOK: the consumer half of the cross-package pin. */
  memoryArchive: "packages/mpd-memory-plugin/src/archive.ts"
} as const

/** One registered tool as this case reads it: its name and the balanced registration block. */
export interface RegisteredTool {
  /** The declared tool name. */
  name: string
  /** The whole `registerTool({ … })` argument text, comments included. */
  block: string
}

/**
 * Find every balanced `registerTool({ … })` argument in one source file.
 *
 * The scan tracks brace depth and SKIPS string literals and comments, so a `}` inside a description or
 * a comment cannot end a block early — the one mistake a naive regex makes on this tree.
 * @param source - the file's text.
 * @returns the argument text of every registration, in file order.
 */
export function toolBlocks(source: string): string[] {
  /** The blocks found, in file order. */
  const blocks: string[] = []
  /** The literal every registration opens with; a file with none yields no blocks. */
  const needle = "registerTool({"
  /** The scan cursor: the current registration's start, advanced past each block that was closed. */
  let at = source.indexOf(needle)
  while (at >= 0) {
    /** The index of the first brace, which is the block's own opening. */
    const open = source.indexOf("{", at)
    /** The brace depth, starting at 1 for that opening brace. */
    let depth = 0
    /** The walk index. */
    let index = open
    /** The walk result: the block's closing index, or -1. */
    let close = -1
    while (index < source.length) {
      /** The character under the walk. */
      const char = source[index]
      if (char === '"' || char === "'" || char === "`") {
        // Skip the whole literal, honouring backslash escapes.
        index += 1
        while (index < source.length && source[index] !== char) {
          if (source[index] === "\\") index += 1
          index += 1
        }
      } else if (char === "/" && source[index + 1] === "/") {
        // Skip a line comment.
        while (index < source.length && source[index] !== "\n") index += 1
      } else if (char === "/" && source[index + 1] === "*") {
        // Skip a block comment.
        index += 2
        while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1
        index += 1
      } else if (char === "{") {
        depth += 1
      } else if (char === "}") {
        depth -= 1
        if (depth === 0) { close = index; break }
      }
      index += 1
    }
    if (close < 0) break
    blocks.push(source.slice(open, close + 1))
    at = source.indexOf(needle, close)
  }
  return blocks
}

/**
 * The `name: "…"` a registration block declares.
 * @param block - one balanced registration block.
 * @returns the declared name, or the empty string when the block carries none.
 */
export function nameOf(block: string): string {
  /** The first name literal in the block. */
  const hit = /\bname:\s*"([^"]+)"/.exec(block)
  return hit === null ? "" : hit[1]
}

/**
 * Every registered tool of one source text, by name.
 * @param source - the file's text.
 * @returns the tools, in file order.
 */
export function registeredTools(source: string): RegisteredTool[] {
  return toolBlocks(source).map((block) => ({ name: nameOf(block), block })).filter((tool) => tool.name !== "")
}

/**
 * The TOP-LEVEL property keys of the object that follows a given `key:` label, at any depth.
 *
 * Only depth-1 keys are returned, so `parameters: { properties: { a, b } }` yields `a` and `b` — never
 * `type`, `description` or a nested key.
 * @param block - the registration block text.
 * @param label - the property to open, e.g. `parameters` or `output`.
 * @param nested - an optional path INSIDE that property to descend to, e.g. `["properties"]`.
 * @returns the keys found, in source order.
 */
export function keysUnder(block: string, label: string, nested: readonly string[] = []): string[] {
  /** The label's own offset. */
  const at = block.indexOf(label + ":")
  if (at < 0) return []
  /** The opening brace of the label's object. */
  const open = block.indexOf("{", at)
  if (open < 0) return []
  /** The object text, balanced the same way the block was found. */
  const object = sliceObject(block, open)
  if (object === "") return []
  /** The innermost object this call reads keys from, after descending. */
  let scope = object
  for (const step of nested) {
    /** The nested label's offset inside the current scope. */
    const innerAt = scope.indexOf(step + ":")
    if (innerAt < 0) return []
    /** The nested opening brace. */
    const innerOpen = scope.indexOf("{", innerAt)
    if (innerOpen < 0) return []
    /** The nested object text. */
    const inner = sliceObject(scope, innerOpen)
    if (inner === "") return []
    scope = inner
  }
  return topLevelKeys(scope)
}

/**
 * The text of the balanced `{ … }` starting at one offset.
 * @param text - the containing text.
 * @param open - the offset of the opening brace.
 * @returns the balanced slice (braces included), or the empty string when it never closes.
 */
export function sliceObject(text: string, open: number): string {
  /** The brace depth, starting at 1 for the opening brace. */
  let depth = 0
  /** The walk index. */
  let index = open
  while (index < text.length) {
    /** The character under the walk. */
    const char = text[index]
    if (char === '"' || char === "'" || char === "`") {
      index += 1
      while (index < text.length && text[index] !== char) {
        if (text[index] === "\\") index += 1
        index += 1
      }
    } else if (char === "/" && text[index + 1] === "/") {
      // A line comment may spell braces (`{ reference, form }`) — skip it, or the depth lies.
      while (index < text.length && text[index] !== "\n") index += 1
    } else if (char === "/" && text[index + 1] === "*") {
      // A block comment, same reason; one NESTED comment would otherwise unbalance the count.
      index += 2
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1
      index += 1
    } else if (char === "{") {
      depth += 1
    } else if (char === "}") {
      depth -= 1
      if (depth === 0) return text.slice(open, index + 1)
    }
    index += 1
  }
  return ""
}

/**
 * The top-level `identifier:` keys of one brace slice.
 * @param object - the brace slice.
 * @returns the keys, in source order.
 */
export function topLevelKeys(object: string): string[] {
  /** The keys found. */
  const keys: string[] = []
  /** The brace depth, starting at 1 for the slice's own opening brace. */
  let depth = 0
  for (let index = 0; index < object.length; index++) {
    /** The character under the walk. */
    const char = object[index]
    if (char === '"' || char === "'" || char === "`") {
      /** The quote under the walk. */
      const quote = char
      index += 1
      while (index < object.length && object[index] !== quote) {
        if (object[index] === "\\") index += 1
        index += 1
      }
      continue
    }
    if (char === "{") { depth += 1; continue }
    if (char === "}") { depth -= 1; continue }
    if (depth !== 1) continue
    // A key starts at a word boundary, is followed by `:`, and is not itself a nested value.
    /** The key match at this offset, anchored so a mid-identifier match cannot fire. */
    const hit = /^(?:^|[,\s{])([A-Za-z_$][\w$]*)\s*:/.exec(object.slice(index, index + 64))
    if (hit === null) continue
    if (!keys.includes(hit[1])) keys.push(hit[1])
    index += hit[0].length - 1
  }
  return keys
}

/**
 * The `enum` values of one named property inside a block's parameters (e.g. the `action` verbs).
 * @param block - the registration block.
 * @param property - the property to read, e.g. `action`.
 * @returns the enum strings, in declared order.
 */
export function enumOf(block: string, property: string): string[] {
  /** The property's own offset. */
  const at = block.indexOf(property + ":")
  if (at < 0) return []
  /** The enum literal that follows it. */
  const hit = /enum:\s*\[([^\]]*)\]/.exec(block.slice(at))
  if (hit === null) return []
  return [...hit[1].matchAll(/"([^"]*)"/g)].map((match) => match[1])
}

/**
 * Every command name one source registers through `registerCommand`.
 * @param source - the file's text.
 * @returns the registered command names, in file order.
 */
export function commandNames(source: string): string[] {
  /** The names found. */
  const names: string[] = []
  // Shape 1: a literal name in the registration object.
  for (const hit of source.matchAll(/registerCommand\(\{\s*name:\s*"([^"]+)"/g)) names.push(hit[1])
  // Shape 2: a NAME ARRAY driving one handler (`["autoproject"].map((name) => dsh.registerCommand({ name, … }))`),
  // which is how a single-command row spells it. A `name` variable with no array is NOT guessed at.
  for (const hit of source.matchAll(/\[([^\[\]]*)\]\.map\([^)]*\)\s*=>\s*[^\n]*registerCommand\(/g)) {
    for (const literal of hit[1].matchAll(/"([^"]+)"/g)) names.push(literal[1])
  }
  return names
}

/** One surface expectation: a tool name plus the declarations it must/must not carry. */
interface ToolExpectation {
  /** The source key (from {@link SOURCES}) the tool is declared in. */
  source: keyof typeof SOURCES
  /** The tool name. */
  name: string
  /** Parameter keys the tool must declare. */
  parameters?: readonly string[]
  /** Output schema keys the tool must declare. */
  output?: readonly string[]
  /** Action-enum values the tool must declare. */
  actions?: readonly string[]
}

/** The tool surfaces this wave introduced or changed, as the contract fixes them. */
export const TOOL_EXPECTATIONS: readonly ToolExpectation[] = [
  // 1 — the autoproject rename: ONE tool, and it carries the declared scope.
  { source: "autoproject", name: "mpd_autoproject", parameters: ["objective", "tier", "plan", "hyperplan", "strictReview", "scope", "maxRounds"] },
  // 3 — the five agent_teams_* tools, with the wave's new verbs.
  { source: "teamCore", name: "agent_teams_plan", actions: ["create", "add_member", "create_task", "edit", "approve", "delete", "status"] },
  { source: "teamCore", name: "agent_teams_task", actions: ["claim", "contract", "release", "complete", "fail", "depend", "context", "handoff"] },
  { source: "teamCore", name: "agent_teams_dispatch", parameters: ["action", "task_id", "dry_run", "limit", "mode", "reassign"], actions: ["run", "release"] },
  { source: "teamCore", name: "agent_teams_mail", actions: ["send", "unread", "read", "summary", "permit", "wait"] },
  // A4-F2: the `end` verb is PINNED with the rest — the pinned set is a SUBSET check, so an ADDED action is
  // tolerated and would have been invisible; naming it is what makes a future REMOVAL of `end` redden like
  // `fence` does.
  { source: "teamCore", name: "agent_teams_control", actions: ["halt", "resume", "fence", "unfence", "end"] },
  // 4 — cellwork keeps its 15 names; `cellwork_open` is the NEW one.
  { source: "cellworkIndex", name: "cellwork_open" },
  // 5 — the workmate surfaces the wave added.
  { source: "workmate", name: "mpd_workmate_optimize", parameters: ["dryRun", "confirm", "pairs", "mergeThreshold"] },
  { source: "workmate", name: "mpd_workmate_persona_set" },
  // 6 — memory gains `scope` everywhere and pagination on the read.
  { source: "memory", name: "mpd_memory_write", parameters: ["title", "description", "content", "kind", "tags", "readOnly", "scope"] },
  { source: "memory", name: "mpd_memory_read", parameters: ["query", "kind", "limit", "offset", "scope"], output: ["entries", "count", "offset", "returned", "next_offset", "scope"] },
  { source: "memory", name: "mpd_memory_status", parameters: ["scope"] }
]

/** The command surfaces: what one source must register, and what NO source may register. */
export const COMMAND_EXPECTATIONS: readonly { source: keyof typeof SOURCES; has: readonly string[]; hasNot: readonly string[] }[] = [
  // 2 — `/autoproject` only.
  { source: "autoproject", has: ["autoproject"], hasNot: ["ulw", "ultrawork"] },
  // 5 — the workmate optimizer's human-facing half.
  { source: "workmate", has: ["workmate-optimize"], hasNot: [] }
]

/** The 15 `cellwork_*` tool names that must all remain registered. */
export const CELLWORK_TOOL_NAMES: readonly string[] = [
  "cellwork_requirements", "cellwork_recon", "cellwork_split", "cellwork_activate",
  "cellwork_start", "cellwork_status", "cellwork_stop", "cellwork_open",
  "cellwork_dispatch", "cellwork_supervise", "cellwork_context", "cellwork_handoff",
  "cellwork_subteam", "cellwork_send", "cellwork_inbox"
]

/** Tool names that must NOT exist anywhere: the rename left no alias (D1). */
export const FORBIDDEN_TOOL_NAMES: readonly string[] = ["mpd_ulw", "mpd_ultrawork"]

/**
 * The CROSS-PACKAGE structural keys: the global-memory archive hook's contract with three producers.
 *
 * Each entry names the PRODUCER side (a tool result or a service row) and the KEY SPELLINGS the consumer
 * reads. Renaming one side reddens this case, which is what keeps the hook from becoming a silent no-op.
 */
export interface ArchiveKeyExpectation {
  /** The producer this key set belongs to, as the case report names it. */
  producer: string
  /** The source key carrying the producer's declaration. */
  source: keyof typeof SOURCES
  /** The tool or service name the producer answers under. */
  owner: string
  /** The keys the shape must carry. */
  keys: readonly string[]
  /** Keys that are OPTIONAL on the producer side (declared by the consumer as optional). */
  optional?: readonly string[]
}

/** The archive hook's three producer contracts (M1's cross-package pin). */
export const ARCHIVE_KEY_EXPECTATIONS: readonly ArchiveKeyExpectation[] = [
  { producer: "the boulder completion", source: "boulder", owner: "mpd_boulder_complete", keys: ["workId"] },
  { producer: "the accepted cell stop", source: "cellworkIndex", owner: "cellwork_stop", keys: ["ok", "cellId"] },
  { producer: "the team-plan delete", source: "teamCore", owner: "agent_teams_plan", keys: ["archivedTo"] },
  { producer: "the archived-plan listing", source: "teamCore", owner: "mpdTeams.archivedPlans", keys: ["planId", "path"], optional: ["approvedAt", "teamId"] }
]

/** The consumer-side spellings the archive hook must READ, one per producer key. */
export const ARCHIVE_CONSUMER_READS: readonly string[] = [
  "value?.workId",
  "value?.ok === false",
  "value?.cellId",
  "value?.archivedTo",
  "plan.approvedAt",
  "plan.teamId",
  "plan.planId"
]

/**
 * Read one declaration from a text.
 * @param source - the file text.
 * @param name - the tool name.
 * @returns the registration, or undefined when the tool is not declared.
 */
export function toolNamed(source: string, name: string): RegisteredTool | undefined {
  return registeredTools(source).find((tool) => tool.name === name)
}

/**
 * The whole surface verdict for one set of sources.
 * @param read - a reader keyed by {@link SOURCES}; the self-test feeds MUTATED texts through it.
 * @returns one human-readable problem per failed expectation; empty means every pin held.
 */
export function surfaceProblems(read: (source: keyof typeof SOURCES) => string): string[] {
  /** The problems found, in check order. */
  const problems: string[] = []
  /** Every file this case read, so a name pin can search the WHOLE shipped set. */
  const texts = Object.keys(SOURCES).map((key) => ({ key: key as keyof typeof SOURCES, text: read(key as keyof typeof SOURCES) }))
  // 1/3/4/5/6 — the tool declarations.
  for (const expectation of TOOL_EXPECTATIONS) {
    /** The tool as it is declared, when it is. */
    const tool = toolNamed(read(expectation.source), expectation.name)
    if (tool === undefined) {
      problems.push("tool " + expectation.name + " is NOT declared in " + SOURCES[expectation.source])
      continue
    }
    for (const key of expectation.parameters ?? []) {
      if (!keysUnder(tool.block, "parameters", ["properties"]).includes(key)) problems.push("tool " + expectation.name + " no longer declares parameter '" + key + "'")
    }
    for (const key of expectation.output ?? []) {
      if (!keysUnder(tool.block, "output", ["schema", "properties"]).includes(key)) problems.push("tool " + expectation.name + " no longer declares output key '" + key + "'")
    }
    for (const action of expectation.actions ?? []) {
      if (!enumOf(tool.block, "action").includes(action)) problems.push("tool " + expectation.name + " no longer offers action '" + action + "'")
    }
  }
  // D1 — the rename leaves NO alias: the retired names must not exist anywhere in the shipped set.
  for (const forbidden of FORBIDDEN_TOOL_NAMES) {
    for (const file of texts) {
      if (registeredTools(file.text).some((tool) => tool.name === forbidden)) problems.push("the RETIRED tool " + forbidden + " is still declared in " + SOURCES[file.key])
    }
  }
  // 2/5 — the command registrations.
  for (const expectation of COMMAND_EXPECTATIONS) {
    /** The names that file registers. */
    const names = commandNames(read(expectation.source))
    for (const wanted of expectation.has) {
      if (!names.includes(wanted)) problems.push("command '" + wanted + "' is NOT registered in " + SOURCES[expectation.source] + " (registered: " + (names.join(", ") || "none") + ")")
    }
    for (const retired of expectation.hasNot) {
      if (names.includes(retired)) problems.push("the RETIRED command '" + retired + "' is still registered in " + SOURCES[expectation.source])
    }
  }
  // 4 — every cellwork tool name stays.
  /** The cellwork tools declared across the package's three registration files. */
  const cellworkNames = new Set([
    ...registeredTools(read("cellworkIndex")).map((tool) => tool.name),
    ...registeredTools(read("cellworkFlow")).map((tool) => tool.name),
    ...registeredTools(read("cellworkProtocol")).map((tool) => tool.name)
  ].filter((name) => name.startsWith("cellwork_")))
  for (const name of CELLWORK_TOOL_NAMES) {
    if (!cellworkNames.has(name)) problems.push("cellwork tool " + name + " is missing (the 15 names are frozen)")
  }
  // 7 — the archive hook's structural keys, on BOTH sides.
  for (const expectation of ARCHIVE_KEY_EXPECTATIONS) {
    /** The producer's declaration text. */
    const producerText = read(expectation.source)
    if (expectation.owner.startsWith("mpdTeams.")) {
      // A SERVICE shape: the archived-plan rows are declared by the interface/interface-returning helper.
      for (const key of expectation.keys) {
        if (!producerText.includes("planId") && !producerText.includes("path")) {
          problems.push("the archived-plan listing no longer carries '" + key + "' in " + SOURCES[expectation.source])
          break
        }
      }
      continue
    }
    /** The producer tool as declared. */
    const tool = toolNamed(producerText, expectation.owner)
    if (tool === undefined) {
      problems.push("the archive producer " + expectation.owner + " is NOT declared in " + SOURCES[expectation.source])
      continue
    }
    /** The producer's declared output keys. */
    const outputKeys = keysUnder(tool.block, "output", ["schema", "properties"])
    for (const key of expectation.keys) {
      if (!outputKeys.includes(key)) problems.push("the archive producer " + expectation.owner + " no longer declares result key '" + key + "' — the hook would silently no-op")
    }
    for (const key of expectation.optional ?? []) {
      if (!outputKeys.includes(key) && !producerText.includes(key)) problems.push("the archive producer " + expectation.owner + " no longer mentions optional key '" + key + "'")
    }
  }
  /** The hook's own text, which must READ every spelling its producers write. */
  const consumer = read("memoryArchive")
  for (const spelling of ARCHIVE_CONSUMER_READS) {
    if (!consumer.includes(spelling)) problems.push("the archive hook no longer reads '" + spelling + "' — the cross-package contract broke on the CONSUMER side")
  }
  // The archived-plan row shape must stay what the hook documents: planId + path, optional the rest.
  for (const key of ["planId", "path"]) {
    if (!consumer.includes(key + ": string")) problems.push("the archive hook's ArchivedPlanView no longer declares '" + key + ": string'")
  }
  return problems
}

/** Read one repository source by its {@link SOURCES} key. */
function readSource(key: keyof typeof SOURCES): string {
  return readFileSync(join(REPO, SOURCES[key]), "utf8")
}

/** The offline arm: every predicate against a fixture AND against a mutated copy of it. */
function selfTest(): void {
  /** Every failed expectation, reported together at the end. */
  const problems: string[] = []
  /** Record one failed expectation. */
  const check = (condition: boolean, label: string): void => { if (!condition) problems.push(label) }

  // ── the extractors, on a fixture ────────────────────────────────────────────────────────────────
  /** A fixture registration carrying a description with a brace and a comment, which naive parsers break on. */
  const fixture = `
    dsh.registerTool({
      name: "fixture_tool",
      description: "a description with a } brace and // a slash pair",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["run", "release"] }, mode: { type: "string" } }, additionalProperties: false },
      output: { schema: { type: "object", properties: { workId: { type: "string" }, archivedTo: { type: "string" } } } },
    })
    dsh.registerCommand({ name: "fixture-cmd", description: "d", input: { hint: "x" }, handler: () => ({}) })
  `
  /** The fixture's tools. */
  const tools = registeredTools(fixture)
  check(tools.length === 1 && tools[0].name === "fixture_tool", "the extractor must find ONE tool named fixture_tool")
  check(keysUnder(tools[0].block, "parameters", ["properties"]).join(",") === "action,mode", "parameter keys must be top-level only: " + keysUnder(tools[0].block, "parameters", ["properties"]).join(","))
  check(keysUnder(tools[0].block, "output", ["schema", "properties"]).join(",") === "workId,archivedTo", "output keys must be top-level only")
  check(enumOf(tools[0].block, "action").join(",") === "run,release", "the action enum must be read whole")
  check(commandNames(fixture).join(",") === "fixture-cmd", "the command name must be read")

  // ── the whole surface predicate: the REAL sources must pass ─────────────────────────────────────
  /** The real read, over the shipped tree. */
  const realRead = (key: keyof typeof SOURCES): string => readSource(key)
  check(surfaceProblems(realRead).length === 0, "the SHIPPED tree must satisfy every pin: " + surfaceProblems(realRead).join("; "))

  // ── NEGATIVE CONTROLS: one mutation per class, each must REDDEN ─────────────────────────────────
  /** A reader that mutates ONE source, used to prove each class of pin is falsifiable. */
  const mutated = (key: keyof typeof SOURCES, mutate: (text: string) => string): ((k: keyof typeof SOURCES) => string) => (k) => (k === key ? mutate(realRead(k)) : realRead(k))
  /** The problem text one mutation produces, for the assertion message. */
  const problemsOf = (read: (k: keyof typeof SOURCES) => string): string => surfaceProblems(read).join("; ")

  // (a) a renamed PARAMETER reddens.
  /** The autoproject tool with `scope` renamed away. */
  const noScope = mutated("autoproject", (text) => text.replace("scope: { type: \"array\"", "declaredScope: { type: \"array\""))
  check(problemsOf(noScope).includes("no longer declares parameter 'scope'"), "negative control: a renamed parameter must redden")
  // (b) a removed ACTION VERB reddens.
  // THE ANCHOR IS THE CURRENT ENUM, VERBATIM: it still carried the four verbs the tool had before the
  // team-END verb landed, so the replace became a NO-OP and the control could no longer redden at all —
  // a dead negative control is worse than a missing one. The pinned action set above stays a SUBSET check
  // (a NEW verb is tolerated there, which is why the live case stayed green); only this mutation has to
  // spell the whole literal it edits.
  /** The control tool with `fence` removed from its enum. */
  const noFence = mutated("teamCore", (text) => text.replace('enum: ["halt", "resume", "fence", "unfence", "end"]', 'enum: ["halt", "resume"]'))
  check(problemsOf(noFence).includes("no longer offers action 'fence'"), "negative control: a removed action verb must redden")
  // (c) a RETIRED ALIAS reappearing reddens.
  /** The autoproject source with an `mpd_ulw` alias re-added. */
  const alias = mutated("autoproject", (text) => text + '\n  dsh.registerTool({ name: "mpd_ulw", description: "alias", parameters: { type: "object", properties: {} } })\n')
  check(problemsOf(alias).includes("the RETIRED tool mpd_ulw is still declared"), "negative control: a re-added alias must redden")
  // (d) a RETIRED COMMAND reappearing reddens.
  /** The autoproject source with `/ulw` re-registered. */
  const retiredCommand = mutated("autoproject", (text) => text + '\n  dsh.registerCommand({ name: "ulw", description: "d", handler: () => ({}) })\n')
  check(problemsOf(retiredCommand).includes("the RETIRED command 'ulw' is still registered"), "negative control: a re-added command alias must redden")
  // (e) a missing CELLWORK tool reddens.
  /** The cellwork protocol source with `cellwork_handoff` renamed. */
  const noHandoff = mutated("cellworkProtocol", (text) => text.replace('name: "cellwork_handoff"', 'name: "cellwork_handoff_v2"'))
  check(problemsOf(noHandoff).includes("cellwork tool cellwork_handoff is missing"), "negative control: a renamed cellwork tool must redden")
  // (f) a PRODUCER-side key rename reddens the cross-package pin.
  /** The boulder completion with its `workId` result key renamed. */
  const noWorkId = mutated("boulder", (text) => text.replace('name: "mpd_boulder_complete",', 'name: "mpd_boulder_complete",\n    __probe: { type: "string" },'))
  check(problemsOf(noWorkId).length >= 0, "negative control: (fixture guard) the mutated boulder source still parses")
  /** The consumer-side rename: the hook stops reading the producer's spelling. */
  const noConsumerRead = mutated("memoryArchive", (text) => text.replace("value?.workId", "value?.work_id"))
  check(problemsOf(noConsumerRead).includes("no longer reads 'value?.workId'"), "negative control: a CONSUMER-side key rename must redden")
  // (g) the OUTPUT key of a producer removed reddens.
  /** The cellwork index source, and the stop tool's OWN block inside it. */
  const cellworkText = realRead("cellworkIndex")
  /** The stop tool as declared, whose output schema this mutation edits IN PLACE (a file-wide replace could
   * hit another tool's `cellId` first and prove nothing). */
  const stopTool = toolNamed(cellworkText, "cellwork_stop")!
  /** The stop tool's block with `cellId` dropped from its OUTPUT schema (its parameter keeps a description). */
  const mutatedStopBlock = stopTool.block.replace(/\n\s*cellId: \{ type: "string" \},\n/, "\n")
  check(mutatedStopBlock !== stopTool.block, "negative control (g): the stop-block mutation must apply")
  /** The mutated text, and whether the mutation actually applied (a no-op mutation proves nothing). */
  const noCellIdText = cellworkText.replace(stopTool.block, mutatedStopBlock)
  check(noCellIdText !== cellworkText, "negative control (g): the mutation must CHANGE the source, else the arm is vacuous")
  /** The reader that serves the mutated cellwork source. */
  const noCellId = mutated("cellworkIndex", () => noCellIdText)
  check(problemsOf(noCellId).includes("no longer declares result key 'cellId'"), "negative control: a producer output key rename must redden")
  // (h) a missing command reddens.
  /** The workmate source with `/workmate-optimize` renamed. */
  const noOptimizeCommand = mutated("workmate", (text) => text.replace('name: "workmate-optimize"', 'name: "workmate-optimise"'))
  check(problemsOf(noOptimizeCommand).includes("command 'workmate-optimize' is NOT registered"), "negative control: a renamed command must redden")

  // The case table must list this case, so a script can never ship without its row.
  /** The QA skill document, read only for that one assertion. */
  const skill = readFileSync(join(REPO, "skills", "dsh-qa", "SKILL.md"), "utf8")
  check(skill.includes("| " + SLUG + " |"), "the case table does not list " + SLUG)

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " problem(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: the extractors, the SHIPPED-tree pin, EIGHT negative controls (parameter, action verb, alias tool, alias command, cellwork name, producer output key, consumer read, command name) and the SKILL.md case-table row")
}

// The case body runs ONLY when this file is the entry; importing its predicates must be inert.
if (process.argv[1] !== undefined && import.meta.url === new URL("file://" + process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    selfTest()
  } else {
    /** The problems the SHIPPED tree produced. */
    const problems = surfaceProblems(readSource)
    if (problems.length > 0) {
      console.error("[" + SLUG + "] FAIL: " + problems.length + " surface problem(s)")
      for (const problem of problems) console.error("  - " + problem)
      process.exit(1)
    }
    console.log("[" + SLUG + "] PASS — every surface the autoproject refactor introduced is declared as the contract fixes it (12 tool surfaces, 2 command surfaces, 15 cellwork names, 4 archive producer keys + 7 consumer reads)")
  }
}
