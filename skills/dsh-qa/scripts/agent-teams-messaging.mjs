#!/usr/bin/env node
// Case agent-teams-messaging (t36, REBUILT by t51): end-to-end QA for the R1 message
// channel that asserts THE SHIPPED USER PATH, not only the state primitives.
//
// THE F-1 DEFECT CLASS, pinned here so it cannot come back:
//   The first version of this case imported `lib/state.js` and called
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
//    itself uses); a RED arm re-runs the dedup lane against a PRE-FIX tools.js built by
//    reverting the recorded t49 regions; `assertSessionsSandboxed` proves no session key
//    for the real workspace was written. Never touches the real ~/.dsh.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.mjs"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.mjs"
import { DSH_MISSING, dshCommand, resolveDshLauncher } from "./lib/dsh-launcher.mjs"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const PLUGIN_LIB = join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib")
const STATE_JS = join(PLUGIN_LIB, "state.js")
const SCHEDULER_JS = join(PLUGIN_LIB, "scheduler.js")
const TOOLS_JS = join(PLUGIN_LIB, "tools.js")
const LOCK_PATH = join(repoRoot, "VENDOR_LOCK.json")
const SKILL_MD = join(repoRoot, "skills", "dsh-qa", "SKILL.md")
const CASE_SLUG = "agent-teams-messaging"
const TEAM = "t36-messaging"
// Shipped-path fixture identities (planted team record; the ids never reach the real
// workspace because every lane runs under the sandbox).
const CAPTAIN_ID = "session-t51-captain"
const MEMBER_ID = "session-t51-member"
const MEMBER_NAME = "Senior Engineer"
const ASKER_ID = "session-t51-asker"
const ASKER_NAME = "Lead"
const SETTLE_MS = 50000
// The state layout the scheduler resolves: stateRootOf(workspace) = <ws>/<stateDir>.
const STATE_DIR = join(".mpd", "team")
const CRASH_SIGNATURES = [
  "unsupported JSON schema",
  "JsonSchemaError",
  "plugin tree failed to load",
  "failed to apply loader entry",
  "cannot get property",
]
const LOG = []

function fail(message) { console.error("[" + CASE_SLUG + "] FAIL: " + message); process.exit(1) }

// ---------------------------------------------------------------- small helpers

/** Bytes as the harness/vendor lock reads them: text (no NUL) normalized to LF. */
function readBytes(path) {
  const buf = readFileSync(path)
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"))
  return buf
}

function sha256Of(path) { return createHash("sha256").update(readBytes(path)).digest("hex") }

/**
 * Reproduce `scripts/verify-vendor.mjs`'s treeSha for one asset directory: relpath
 * sorted, each `relpath\n<sha256 of the normalized bytes>\n` folded into one hash and
 * `node_modules` skipped. Reimplemented here so the self-test can PIN VENDOR_LOCK to
 * the working tree without shelling out to the gate under test.
 */
function buildTreeSha(dir) {
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry)
      if (entry === "node_modules") continue
      if (entry === "__pycache__" || entry.endsWith(".pyc") || entry.endsWith(".pyo")) continue
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(dir)
  // POSIX-spelled relpaths, exactly like scripts/verify-vendor.mjs: a native separator would fold
  // a DIFFERENT hash on Windows than the lock records (see that gate's treeSha comment).
  const rel = out.map((f) => f.slice(dir.length + 1).split(sep).join("/")).sort()
  const h = createHash("sha256")
  for (const f of rel) h.update(f + "\n" + sha256Of(join(dir, f)) + "\n")
  return { fileCount: rel.length, treeSha: h.digest("hex") }
}

/** Key-order-independent deep comparison, so a fixture edit cannot fake a pass. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]))
  }
  return value
}

function sameJson(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)) }

/** Extract a scheduler region body, failing loudly when the seam moved. */
function extractRegion(source, marker) {
  const start = "#region mpd-delta " + marker
  const end = "#endregion mpd-delta " + marker
  const from = source.indexOf(start)
  const to = source.indexOf(end)
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
 * value the shipped `state.js` module actually exports, so a silent constant change
 * cannot keep the predicate "green" against a stale literal.
 */
function buildDeliverablePredicate(predicateSource, interjectionKind) {
  const body = predicateSource.replaceAll("INTERJECTION_KIND", JSON.stringify(interjectionKind))
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
 */
async function plantFixture(workspace, { libDir = PLUGIN_LIB, teamId = TEAM } = {}) {
  const stateRoot = join(workspace, STATE_DIR)
  mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
  const now = Date.now()
  const members = [
    { id: MEMBER_ID, name: MEMBER_NAME, role: "engineer", status: "idle", joinedAt: now },
    { id: ASKER_ID, name: ASKER_NAME, role: "reviewer", status: "idle", joinedAt: now },
  ]
  writeFileSync(join(stateRoot, teamId, "team.json"), JSON.stringify({
    id: teamId, name: "t51", captainSessionId: CAPTAIN_ID, createdAt: now, updatedAt: now,
    taskSeq: 0, phase: "running", members, tasks: [],
  }, null, 2))

  const agent = (id) => ({
    id, status: "idle",
    options: { provider: "deepseek-official", model: "deepseek-v4-flash" },
    session: {
      header: { cwd: workspace },
      requestHeader: () => ({ config: { provider: "deepseek-official", model: "deepseek-v4-flash" } }),
    },
  })
  const captain = agent(CAPTAIN_ID)
  const live = { [CAPTAIN_ID]: captain, [MEMBER_ID]: agent(MEMBER_ID), [ASKER_ID]: agent(ASKER_ID) }

  const tools = new Map()
  const deliveries = []
  const subagents = {
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
  const ctx = {
    tools: { register: (definition) => tools.set(definition.name, definition) },
    agents: { get: (id) => live[id], list: () => Object.values(live) },
    subagents,
    effect: () => {}, on: () => {},
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    get: () => undefined,
    llm: { resolveCallConfig: async (r) => ({ provider: r.provider, model: r.model }), listModels: async () => [] },
  }

  const toolsModule = await import(join(libDir, "tools.js"))
  const schedulerModule = await import(join(libDir, "scheduler.js"))
  const stateModule = await import(join(libDir, "state.js"))
  toolsModule.registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
  const runtime = schedulerModule.installTeamScheduler(ctx, { stateDir: STATE_DIR })

  const call = async (name, args, caller = captain) => {
    const definition = tools.get(name)
    if (definition === undefined) throw new Error(`tool "${name}" is not registered on the shipped surface`)
    return definition.execute(args, { agent: caller })
  }
  return {
    stateRoot, teamId, tools, deliveries, ctx, captain,
    memberAgent: live[MEMBER_ID], askerAgent: live[ASKER_ID], state: stateModule,
    call,
    kick: (name) => runtime.kickMember(workspace, teamId, name, captain),
  }
}

/**
 * Build a PRE-FIX `tools.js`: the `mpd-delta` regions t49 added are reverted to the
 * recorded pre-repair shape (specimens taken from the commit that introduced them, kept
 * in `evidence/omo-align/qa-shipped-path/…`), while the module keeps importing the
 * current `state.js`. This is the RED arm: the SAME scenario against the shipped path as
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
const MEMBER_CALL_HEAD = "appendMailboxDeduped(stateRoot, fresh.id, recipient.name, pendingMember"

/**
 * Consume the whole call statement that STARTS on the line carrying `head` and ENDS at the
 * terminator `);` that closes its line — the shape-guard the fixture now uses instead of a
 * full-statement literal. Returns `{ from, to, text }` in the source's own coordinates, or a
 * discriminated reason (`absent` = the wiring is GONE; `unterminated` = the statement shape
 * changed in a way this fixture cannot consume).
 */
function consumeCallStatement(source, head) {
  const at = source.indexOf(head)
  if (at < 0) return { reason: "absent" }
  const from = source.lastIndexOf("\n", at) + 1
  const rel = source.slice(at).search(/\);[ \t]*(?:\n|$)/)
  if (rel < 0) return { reason: "unterminated", from, line: source.slice(0, from).split("\n").length }
  return { from, to: at + rel + 2, text: source.slice(from, at + rel + 2) }
}

function revertDedupWiring(source) {
  const captainRegion = extractRegion(source, "send-dedup-wiring")
  const guardRegion = extractRegion(source, "send-dedup-delivery-guard")
  if (captainRegion === null || guardRegion === null) {
    fail("cannot build the pre-fix arm: a send-dedup REGION is missing (the RED arm must not silently no-op)")
  }
  const captainOld = [
    "                    const message = { ...createMessage(from, CAPTAIN_KEY, args.content), deliveryClaimedAt: Date.now() };",
    "                    await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, message);",
    "",
  ].join("\n")
  const memberCall = consumeCallStatement(source, MEMBER_CALL_HEAD)
  if (memberCall.reason === "absent") {
    // DISCRIMINATION (t54): an ABSENT anchor is not a fixture that needs re-pinning — it means the
    // shipped member send path LOST its dedup wiring, i.e. the capability regressed. Say that.
    fail("the member send path LOST its dedup wiring: `" + MEMBER_CALL_HEAD + "…` is not present in tools.js, so the shipped member path no longer folds duplicate sends — restore/re-materialize the wiring (the region `send-dedup-wiring` is the captain path; the member path is currently UN-REGIONED), then re-run. This is a REGRESSION, not a fixture to re-pin.")
  }
  if (memberCall.reason === "unterminated") {
    fail("cannot build the pre-fix arm: the member dedup call at tools.js:" + memberCall.line + " has no `);` terminating its statement, so the RED arm cannot be consumed from the shipped source (the transform refuses to guess where the statement ends)")
  }
  const indent = (source.slice(memberCall.from).match(/^[ \t]*/) ?? [""])[0]
  const memberFixed = memberCall.text
  const memberOld = indent + "const message = { ...createMessage(from, recipient.name, args.content), deliveryClaimedAt: Date.now() };\n"
    + indent + "await appendMailbox(stateRoot, fresh.id, recipient.name, message);\n"
  const guardOld = "            // (pre-fix: no delivery guard - a folded send still ran live delivery)\n"
  let out = source
  if (!out.includes(captainRegion) || !out.includes(guardRegion)) {
    fail("cannot build the pre-fix arm: a reverted REGION is not present verbatim in tools.js")
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

function selfTest() {
  const caseSource = readFileSync(fileURLToPath(import.meta.url), "utf8")
  if (!existsSync(STATE_JS) || !existsSync(SCHEDULER_JS) || !existsSync(TOOLS_JS)) fail("adopted plugin lib missing")
  const stateSrc = readFileSync(STATE_JS, "utf8")
  const schedSrc = readFileSync(SCHEDULER_JS, "utf8")
  const toolsSrc = readFileSync(TOOLS_JS, "utf8")

  // (a) the R1 surface exists and carries the archive-first marker.
  if (!stateSrc.includes("#region mpd-delta message-channel-r1")) fail("state.js lost the message-channel-r1 region")
  for (const name of [
    "appendMailboxDeduped", "clearMailboxToWatermark", "readLiveMailbox",
    "enqueueInterjection", "readPendingInterjections", "expireInterjections", "decideInterjection",
  ]) {
    if (!new RegExp("export async function " + name + "\\b").test(stateSrc)) fail("state.js no longer exports " + name)
  }
  for (const name of ["MAILBOX_DEDUP_WINDOW_MS", "INTERJECTION_TTL_MS", "INTERJECTION_QUEUE", "INTERJECTION_KIND"]) {
    if (!new RegExp("export const " + name + "\\b").test(stateSrc)) fail("state.js no longer exports " + name)
  }
  if (!/ttl[^\n]*30 \* 60 \* 1000/i.test(stateSrc)) {
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
  const region = extractRegion(schedSrc, "interjection-not-auto-delivered")
  if (region === null) fail("scheduler lost the interjection-not-auto-delivered region")
  if (!/kind !== INTERJECTION_KIND/.test(region)) {
    fail("scheduler exclusion no longer tests the interjection kind: " + region.split("\n").join(" | "))
  }
  // A read that packs unread records AND is NOT routed through the filter is the
  // bypass this case exists to catch.
  const unreadLines = schedSrc.split("\n").filter((line) => line.includes("readUnreadMailbox("))
  const bypass = unreadLines.filter((line) => !/deliverableUnread\(/.test(line))
  if (unreadLines.length !== 2) fail("expected exactly 2 scheduler auto-delivery reads, found " + unreadLines.length)
  if (bypass.length !== 0) fail("a scheduler read packs unread records WITHOUT deliverableUnread: " + bypass.join(" | "))

  // (c) VENDOR_LOCK's `skills` asset must recompute from the working tree (the §9/§11
  // pairing rule). This is the invariant the script's own addition changes.
  const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"))
  const computed = buildTreeSha(join(repoRoot, "skills"))
  if (lock.assets.skills.fileCount !== computed.fileCount || lock.assets.skills.treeSha !== computed.treeSha) {
    fail("VENDOR_LOCK skills asset is stale: lock=" + lock.assets.skills.fileCount + "/" + lock.assets.skills.treeSha.slice(0, 12)
      + " tree=" + computed.fileCount + "/" + computed.treeSha.slice(0, 12) + " (re-pin in the same commit, AGENTS.md §9)")
  }
  // falsifiable: the pin MUST move when one skills file changes (otherwise the
  // recomputation above could be a constant that always "matches"). The probe mutates a
  // TEMP COPY (t54): a probe that wrote into the tracked corpus could leave residue inside
  // a wave whose whole invariant is that `skills/**` does not move between re-pins, and an
  // interrupted run would leave the probe line in a tracked file.
  const probeRoot = mkdtempSync(join(tmpdir(), "agent-teams-messaging-tree-"))
  let baseline
  let mutated
  try {
    cpSync(join(repoRoot, "skills"), probeRoot, { recursive: true })
    baseline = buildTreeSha(probeRoot)
    const probeFile = join(probeRoot, "dsh-qa", "SKILL.md")
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
  const table = readFileSync(SKILL_MD, "utf8").split("\n").filter((line) => line.startsWith("| " + CASE_SLUG + " |"))
  if (table.length !== 1) fail("SKILL.md case table must carry exactly one `" + CASE_SLUG + "` row (found " + table.length + ")")
  const cols = table[0].split("|").slice(1, -1).map((c) => c.trim())
  if (cols.length !== 4 || cols.some((c) => c === "")) fail("SKILL.md row is not 4 populated columns: " + cols.length)

  // (e) the runner would actually pick this case up.
  //
  // The contract is that `test:qa` DISCOVERS this case directory - not the shell spelling it used to
  // have. The POSIX `for f in skills/dsh-qa/scripts/*.mjs; do ... done` loop this arm used to pin
  // could not run on Windows at all (`bun run` hands the body to cmd.exe: `bun: command not found:
  // for`), so the sweep is `node scripts/run-qa-selftests.mjs` now and THAT is what must stay wired:
  // the arm reads the runner's own source for the directory it discovers.
  const runner = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts["test:qa"]
  const runnerPath = join(repoRoot, "scripts", "run-qa-selftests.mjs")
  const runnerSource = existsSync(runnerPath) ? readFileSync(runnerPath, "utf8") : ""
  const sweepsCases = runner.includes("scripts/run-qa-selftests.mjs") && runnerSource.includes("skills/dsh-qa/scripts")
  if (!sweepsCases) fail("test:qa no longer sweeps the case directory (expected scripts/run-qa-selftests.mjs to discover skills/dsh-qa/scripts)")

  console.log("[" + CASE_SLUG + " self-test] ok: R1 exports + SHIPPED send/clear/interject wiring + this case drives the tool surface + scheduler exclusion on both reads + RED-arm transform applies (member revert consumed by its stable head) + VENDOR_LOCK skills pin current ("
    + computed.fileCount + " files/" + computed.treeSha.slice(0, 12) + ") + treeSha falsifiability probe on a temp COPY (nothing written under <repoRoot>/skills) + SKILL.md row + test:qa sweeps the case directory")
}

// ------------------------------------------------------------------ real run

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials at " + creds)
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "omo-align", "qa-shipped-path", ts)
  mkdirSync(outDir, { recursive: true })

  const state = await import(STATE_JS)
  const requiredExports = [
    "appendMailboxDeduped", "clearMailboxToWatermark", "readLiveMailbox", "readMailbox", "readUnreadMailbox",
    "enqueueInterjection", "readPendingInterjections", "readInterjections", "expireInterjections", "decideInterjection",
  ]
  const missingExports = requiredExports.filter((name) => typeof state[name] !== "function")
  if (missingExports.length > 0) fail("R1 exports missing from the shipped lib: " + missingExports.join(", "))

  const steps = {
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
  const rev0 = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
  const hashes0 = [STATE_JS, SCHEDULER_JS].map(sha256Of)
  LOG.push("settleWait: " + SETTLE_MS + " ms (HEAD " + rev0 + ", state.js " + hashes0[0].slice(0, 16) + ")")
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  const rev1 = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
  const hashes1 = [STATE_JS, SCHEDULER_JS].map(sha256Of)
  const settled = rev0 === rev1 && hashes0[0] === hashes1[0] && hashes0[1] === hashes1[1]
  steps.settled = { ok: settled, head: rev1, stateSha: hashes1[0], schedulerSha: hashes1[1] }
  if (!settled) fail("revision did not settle (HEAD or the R1 files changed during the window)")

  // --- sandbox: DSH_HOME + HOME + workspace all under the sandbox ---
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-t36-"))
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
  const ws = sandboxWorkspace(sandbox)
  const stateRoot = join(ws, STATE_DIR)
  mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: sandbox  })
  if (env.DSH_HOME !== sandbox || env.HOME !== sandbox) fail("isolation assertion failed")

  function runSync(cmd, args, opts = {}) {
    const spec = cmd === "dsh" ? dshCommand(args, env) : { command: cmd, args }
    const r = spec === null ? { status: null, stdout: "", stderr: DSH_MISSING } : spawnSync(spec.command, spec.args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    const out = (r.stdout || "") + (r.stderr || "")
    LOG.push("$ " + cmd + " " + args.join(" ") + "\n[[exit=" + r.status + "]]\n" + out.slice(0, 20000))
    return { status: r.status, out }
  }

  // --- 1) install + REAL MOUNTED BOOT (never --dump-config) ---
  const inst = runSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { timeout: 600000 })
  // The installer serves the mpd preset into the home; a headless profile is the one
  // that takes a positional prompt, which is what a real CLI boot needs.
  const mpdPresetInstalled = existsSync(join(sandbox, "profiles", "mpd-headless", "package.json"))
    && existsSync(join(sandbox, ".agent-presets", "mpd", "agent.cordis.yml"))
  steps.installer = { ok: inst.status === 0 && mpdPresetInstalled, exit: inst.status, mpdPresetInstalled }
  // The mounted boot that really EXECUTES the tree runs that profile in the sandbox
  // home. A live-LLM turn is NOT a
  // prerequisite of this case (this environment carries no DEEPSEEK_API_KEY), so the
  // mount evidence is the plugin tree's own boot lines + a sandboxed session key +
  // zero apply/schema crash signatures — never the answer text.
  const boot = runSync("dsh", ["--profile", "mpd-headless", "Reply with exactly: hello-ok"], { cwd: ws, timeout: 600000 })
  const crashes = CRASH_SIGNATURES.filter((signature) => boot.out.includes(signature))
  const MOUNT_MARKERS = [
    "[mpd-dsh-adapter] mpdDsh provided",
    "[mpd-bootstrap] skill corpus served from",
    "[mpd-codegraph] init status=",
  ]
  const missingMarkers = MOUNT_MARKERS.filter((marker) => !boot.out.includes(marker))
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

  let isolation = { ok: false }
  try {
    const checked = assertSessionsSandboxed(sandbox, sandbox, { label: CASE_SLUG })
    // The PROOF is two-sided: every key belongs to the sandbox AND the boot really
    // wrote one (zero keys would make the assertion vacuous).
    isolation = { ok: checked.checked > 0, ...checked, sessionsWritten: checked.checked }
  } catch (error) {
    isolation = { ok: false, error: String(error && error.message ? error.message : error) }
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
  const shippedPredicate = await import(buildDeliverablePredicate(
    extractRegion(readFileSync(SCHEDULER_JS, "utf8"), "interjection-not-auto-delivered"),
    state.INTERJECTION_KIND,
  ))

  // --- 2a) SHIPPED dedup: 3 IDENTICAL sends -> 1 record / dupCount=3 / <=1 wake ---
  const greenWs = join(ws, "shipped-green")
  mkdirSync(greenWs, { recursive: true })
  const green = await plantFixture(greenWs, { teamId: TEAM + "-green" })
  const sendArgs = { to: MEMBER_NAME, content: "identical payload from the shipped path" }
  const shippedSends = []
  for (let i = 0; i < 3; i += 1) shippedSends.push(await green.call("agent_teams_send_message", sendArgs))
  const greenRecords = await green.state.readMailbox(green.stateRoot, green.teamId, MEMBER_NAME)
  // Count deliveries to the RECIPIENT. The first send may legitimately reach the member
  // live (its text is packed straight to the child), so "at most once" is the criterion,
  // not "zero before the kick".
  const memberDeliveries = () => green.deliveries.filter((entry) => entry.to === MEMBER_ID).length
  const deliveredAfterSends = memberDeliveries()
  await green.kick(MEMBER_NAME)
  const deliveredAfterKick = memberDeliveries()
  await green.kick(MEMBER_NAME)
  const deliveredAfterSecondKick = memberDeliveries()
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
  const otherSender = await green.call("agent_teams_send_message", { to: MEMBER_NAME, content: sendArgs.content, from: ASKER_NAME }, green.askerAgent)
  const greenRecordsAfter = await green.state.readMailbox(green.stateRoot, green.teamId, MEMBER_NAME)
  const originalRecord = greenRecordsAfter.find((record) => record.id === greenRecords[0].id)
  const otherSenderRecord = greenRecordsAfter.find((record) => record.id === otherSender.message_id)
  steps.shippedDedupControl = {
    ok: otherSender.delivered !== "duplicate" && greenRecordsAfter.length === 2
      && originalRecord !== undefined && originalRecord.dupCount === 3
      && otherSenderRecord !== undefined && otherSenderRecord.dupCount === 1 && otherSenderRecord.from === ASKER_NAME,
    delivered: otherSender.delivered, records: greenRecordsAfter.length,
    dupCounts: greenRecordsAfter.map((record) => record.dupCount),
  }

  // --- 2b) RED ARM: the SAME scenario against the PRE-FIX shipped path ---
  const redWs = join(ws, "shipped-red")
  mkdirSync(redWs, { recursive: true })
  // The pre-fix module keeps the SAME runtime closure (sibling modules + `_deps`) as the
  // shipped one, so the closure is copied beside it and only `tools.js` is replaced.
  cpSync(join(repoRoot, "packages", "mpd-agent-teams-plugin"), redWs, { recursive: true })
  const prefix = revertDedupWiring(readFileSync(TOOLS_JS, "utf8"))
  writeFileSync(join(redWs, "lib", "tools.js"), prefix.source)
  const red = await plantFixture(redWs, { libDir: join(redWs, "lib"), teamId: TEAM + "-red" })
  for (let i = 0; i < 3; i += 1) await red.call("agent_teams_send_message", sendArgs)
  const redRecords = await red.state.readMailbox(red.stateRoot, red.teamId, MEMBER_NAME)
  await red.kick(MEMBER_NAME)
  await red.kick(MEMBER_NAME)
  const redDeliveries = red.deliveries.filter((entry) => entry.to === MEMBER_ID).length
  steps.preFixRedArm = {
    ok: redRecords.length === 3 && redDeliveries >= 3,
    records: redRecords.length, dupCounts: redRecords.map((record) => record.dupCount),
    deliveriesToRecipient: redDeliveries, transform: prefix.transform,
    specimen: "the t49 regions reverted to the shape recorded in the commit that introduced them (raw/prefix-tools.js)",
    note: "Counter-reading the contract asks for: 3 records / >=3 deliveries BEFORE the repair, 1 record / 1 delivery after it.",
  }

  // --- 2c) SHIPPED interjection: pending is silent, approval wakes the REQUESTER ---
  const ijWs = join(ws, "shipped-interjection")
  mkdirSync(ijWs, { recursive: true })
  const ij = await plantFixture(ijWs, { teamId: TEAM + "-ij" })
  const request = await ij.call("agent_teams_interject_request", {
    content: "please confirm the runbook", summary: "need the runbook", reason: "blocked on the gate", location: "t51",
  }, ij.askerAgent)
  const pendingView = await ij.call("agent_teams_interject_decide", { action: "list" })
  const askerInboxWhilePending = await ij.state.readUnreadMailbox(ij.stateRoot, ij.teamId, ASKER_NAME)
  const deliveriesBeforeApprove = ij.deliveries.length
  await ij.kick(ASKER_NAME)
  const deliveriesWhilePending = ij.deliveries.length
  const ijQueueFile = join(ij.stateRoot, ij.teamId, "inbox", "interjections.jsonl")
  const ijQueueRows = readFileSync(ijQueueFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  const decision = await ij.call("agent_teams_interject_decide", { request_id: request.request_id, decision: "approved" })
  const askerInboxAfterApprove = await ij.state.readUnreadMailbox(ij.stateRoot, ij.teamId, ASKER_NAME)
  await ij.kick(ASKER_NAME)
  await ij.kick(ASKER_NAME)
  const afterApproveDeliveries = ij.deliveries.slice(deliveriesWhilePending)
  const askerDeliveries = afterApproveDeliveries.filter((entry) => entry.to === ASKER_ID)
  const otherMemberDeliveries = afterApproveDeliveries.filter((entry) => entry.to === MEMBER_ID)
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
  const rejected = await ij.call("agent_teams_interject_request", { content: "second ask", summary: "second ask", reason: "r", location: "t51" }, ij.askerAgent)
  const beforeReject = ij.deliveries.length
  const rejectDecision = await ij.call("agent_teams_interject_decide", { request_id: rejected.request_id, decision: "rejected" })
  const askerInboxAfterReject = await ij.state.readUnreadMailbox(ij.stateRoot, ij.teamId, ASKER_NAME)
  await ij.kick(ASKER_NAME)
  steps.shippedInterjectionRejectControl = {
    ok: rejectDecision.status === "rejected" && askerInboxAfterReject.length === 0
      && ij.deliveries.slice(beforeReject).filter((entry) => entry.to === ASKER_ID).length === 0,
    status: rejectDecision.status, requesterInbox: askerInboxAfterReject.length,
    deliveriesAfter: ij.deliveries.slice(beforeReject).length,
  }

  // --- 2d) SHIPPED TTL: silence expires the request and the requester IS told ---
  const ttlWs = join(ws, "shipped-ttl")
  mkdirSync(ttlWs, { recursive: true })
  const ttl = await plantFixture(ttlWs, { teamId: TEAM + "-ttl" })
  const overdue = await ttl.call("agent_teams_interject_request", { content: "overdue ask", summary: "overdue", reason: "r", location: "t51" }, ttl.askerAgent)
  const insideTtl = await ttl.call("agent_teams_interject_request", { content: "still inside TTL", summary: "inside", reason: "r", location: "t51" }, ttl.askerAgent)
  // Age exactly ONE request. The tool deliberately takes no clock argument (an injected
  // clock would be a production seam), so the fixture rewrites that row's expiry while
  // the other keeps its real TTL.
  const queueFile = join(ttl.stateRoot, ttl.teamId, "inbox", "interjections.jsonl")
  const queueRows = readFileSync(queueFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  writeFileSync(queueFile, queueRows.map((row) => JSON.stringify(row.id === overdue.request_id ? { ...row, ts: 1_000, expiresAt: 2_000 } : row)).join("\n") + "\n")
  await ttl.kick(ASKER_NAME)
  // The notice is delivered AND acknowledged (the scheduler acks what the member
  // accepted), so the honest evidence is the delivery plus the acknowledged record —
  // asserting a post-ack unread count would encode the wrong contract.
  const ttlDeliveries = ttl.deliveries.filter((entry) => entry.to === ASKER_ID)
  const askerNotices = await ttl.state.readMailbox(ttl.stateRoot, ttl.teamId, ASKER_NAME)
  const pendingAfterTick = await ttl.state.readPendingInterjections(ttl.stateRoot, ttl.teamId)
  const expiredRow = (await ttl.state.readInterjections(ttl.stateRoot, ttl.teamId)).find((record) => record.id === overdue.request_id)
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
  const clearWs = join(ws, "shipped-clear")
  mkdirSync(clearWs, { recursive: true })
  const clearFixture = await plantFixture(clearWs, { teamId: TEAM + "-clear" })
  await clearFixture.call("agent_teams_send_message", { to: MEMBER_NAME, content: "OLD-PAYLOAD-ALPHA" })
  await clearFixture.call("agent_teams_send_message", { to: MEMBER_NAME, content: "OLD-PAYLOAD-BETA" })
  const liveBeforeClear = await clearFixture.state.readMailbox(clearFixture.stateRoot, clearFixture.teamId, MEMBER_NAME)
  await clearFixture.kick(MEMBER_NAME)
  const deliveriesBeforeClear = clearFixture.deliveries.length
  const clearedResult = await clearFixture.call("agent_teams_mailbox_clear", { agent: MEMBER_NAME, watermark: Date.now() + 60_000 })
  const unreadAfterClear = await clearFixture.state.readUnreadMailbox(clearFixture.stateRoot, clearFixture.teamId, MEMBER_NAME)
  const liveAfterClear = await clearFixture.state.readMailbox(clearFixture.stateRoot, clearFixture.teamId, MEMBER_NAME)
  await clearFixture.kick(MEMBER_NAME)
  const liveAfterClearKick = await clearFixture.state.readMailbox(clearFixture.stateRoot, clearFixture.teamId, MEMBER_NAME)
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
  let authzRefusal = null
  try {
    await clearFixture.call("agent_teams_mailbox_clear", { agent: MEMBER_NAME, watermark: Date.now() }, clearFixture.askerAgent)
  } catch (error) {
    authzRefusal = String(error && error.message ? error.message : error)
  }
  steps.shippedClearAuthzControl = {
    ok: authzRefusal !== null && /only the captain may clear another participant/.test(authzRefusal),
    refusal: authzRefusal,
  }

  // --- 2) DEDUP lane (PRIMITIVE layer): positive + negative control ---
  const W = state.MAILBOX_DEDUP_WINDOW_MS
  const dedupBase = { from: "Senior Engineer", to: "captain", content: "same content", ts: 5_000_000 }
  const d1 = await state.appendMailboxDeduped(stateRoot, TEAM, "captain", { ...dedupBase, id: "dedup-1" })
  const d2 = await state.appendMailboxDeduped(stateRoot, TEAM, "captain", { ...dedupBase, id: "dedup-2", ts: dedupBase.ts + 1000 })
  const d3 = await state.appendMailboxDeduped(stateRoot, TEAM, "captain", { ...dedupBase, id: "dedup-3", ts: dedupBase.ts + 2000 })
  const dedupRecords = await state.readMailbox(stateRoot, TEAM, "captain")
  const dedupUnread = await state.readUnreadMailbox(stateRoot, TEAM, "captain")
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
  const other = await state.appendMailboxDeduped(stateRoot, TEAM, "captain", { ...dedupBase, id: "dedup-other", from: "Lead" })
  const afterOther = await state.readMailbox(stateRoot, TEAM, "captain")
  const otherRecord = afterOther.find((record) => record.id === "dedup-other")
  const foldedRecord = afterOther.find((record) => record.id === "dedup-1")
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
  const clearRoot = join(ws, "clear-ws", STATE_DIR)
  mkdirSync(join(clearRoot, TEAM, "inbox"), { recursive: true })
  const clearMessages = [
    { id: "clear-1", from: "captain", to: "Lead", content: "PAYLOAD-ALPHA", ts: 100 },
    { id: "clear-2", from: "captain", to: "Lead", content: "PAYLOAD-BETA", ts: 200 },
    { id: "clear-3", from: "Lead", to: "captain", content: "kept", ts: 900 },
  ]
  for (const message of clearMessages) await state.appendMailbox(clearRoot, TEAM, "captain", message)
  const liveBefore = readFileSync(join(clearRoot, TEAM, "inbox", "captain.jsonl"), "utf8")
  const cleared = await state.clearMailboxToWatermark(clearRoot, TEAM, "captain", 500, { now: 1_000_000 })
  const liveAfter = readFileSync(join(clearRoot, TEAM, "inbox", "captain.jsonl"), "utf8")
  const allRecords = await state.readMailbox(clearRoot, TEAM, "captain")
  const liveView = await state.readLiveMailbox(clearRoot, TEAM, "captain")
  const tombstones = allRecords.filter((record) => record.tombstone === true)
  const sidecarText = existsSync(cleared.sidecar) ? readFileSync(cleared.sidecar, "utf8") : ""
  const sidecarRecords = sidecarText.split("\n").filter(Boolean).map((line) => JSON.parse(line))
  const idSurvives = ["clear-1", "clear-2", "clear-3"].every((id) => allRecords.some((record) => record.id === id))
  const sidecarRecovers = sameJson(sidecarRecords, clearMessages.slice(0, 2))
    && sidecarText.includes("PAYLOAD-ALPHA") && sidecarText.includes("PAYLOAD-BETA")
  const cleanLiveView = liveView.length === 1 && liveView[0].id === "clear-3"
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
  const payloadLocations = []
  const walkFiles = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry)
      if (statSync(p).isDirectory()) walkFiles(p)
      else {
        try { if (readFileSync(p, "utf8").includes("PAYLOAD-ALPHA")) payloadLocations.push(p) } catch { /* binary */ }
      }
    }
  }
  walkFiles(join(ws, "clear-ws"))
  const idsBefore = clearMessages.map((message) => message.id)
  const idsAfter = allRecords.map((record) => record.id)
  const archiveDir = join(clearRoot, TEAM, "inbox", "archive")
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
  const ijRoot = join(ws, "ij-ws", STATE_DIR)
  mkdirSync(join(ijRoot, TEAM, "inbox"), { recursive: true })
  const ijTs = 2_000_000
  const queuedRequest = await state.enqueueInterjection(ijRoot, TEAM, {
    id: "ij-1", from: "Junior Engineer", to: "captain", content: "body-after-approval",
    ts: ijTs, summary: "need the runbook", reason: "blocked on the gate", location: "t36",
  })
  const pendingBefore = await state.readPendingInterjections(ijRoot, TEAM)
  const queueRecords = await state.readUnreadMailbox(ijRoot, TEAM, state.INTERJECTION_QUEUE)
  const inboxFiles = readdirSync(join(ijRoot, TEAM, "inbox"))
  // The scheduler packs EVERY unread record and auto-delivers it at the next idle
  // edge, so the pending request must NOT survive the shipped predicate. Drive the
  // predicate extracted from the shipped source (not a re-typed copy).
  const predicateSource = extractRegion(readFileSync(SCHEDULER_JS, "utf8"), "interjection-not-auto-delivered")
  const predicate = await import(buildDeliverablePredicate(predicateSource, state.INTERJECTION_KIND))
  const deliverable = predicate.deliverableUnread(queueRecords)
  const notDeliveredPending = deliverable.length === 0 && queueRecords.length === 1
    && queueRecords[0].kind === state.INTERJECTION_KIND
    && !(await state.readUnreadMailbox(ijRoot, TEAM, "captain")).some((record) => record.kind === state.INTERJECTION_KIND)
  const notYetExpired = await state.expireInterjections(ijRoot, TEAM, { now: ijTs + 1000 })
  const approved = await state.decideInterjection(ijRoot, TEAM, "ij-1", "approved", { now: ijTs + 2000 })
  const pendingAfter = await state.readPendingInterjections(ijRoot, TEAM)
  const approvedRecord = (await state.readInterjections(ijRoot, TEAM)).find((record) => record.id === "ij-1")
  // The approval RECORDS the decision; it must NOT leak the request into an
  // auto-delivered lane on its own (status is not a delivery marker).
  const stillGatedAfterApproval = predicate.deliverableUnread(
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
  // `ij-1-delivery` — the very id `state.js decideInterjection` had just written. The two
  // ids collided, the requester inbox held TWO records, and the `length === 1` assertion
  // failed. The library record is the production behaviour; a case that fabricates the
  // record it then counts proves nothing about the shipped path.
  //
  // The wider lesson this case must carry: a green result at the PRIMITIVE layer says
  // nothing about the path a user actually walks. That is exactly how this wave's
  // "library vs capability" defects survived earlier passes.
  const requesterKey = "junior-engineer"
  const requesterInbox = predicate.deliverableUnread(await state.readUnreadMailbox(ijRoot, TEAM, requesterKey))
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
  const ijTtl = await state.enqueueInterjection(ijRoot, TEAM, {
    id: "ij-ttl", from: "Lead", to: "captain", content: "s", ts: ijTs, summary: "s", reason: "r", location: "t36",
  })
  const expired = await state.expireInterjections(ijRoot, TEAM, { now: ijTs + state.INTERJECTION_TTL_MS })
  const ttlRecord = (await state.readInterjections(ijRoot, TEAM)).find((record) => record.id === "ij-ttl")
  const ttlPending = await state.readPendingInterjections(ijRoot, TEAM)
  steps.interjectionTtl = {
    ok: expired.length === 1 && expired[0] === "ij-ttl" && ttlRecord.status === "expired"
      && ttlPending.length === 0 && ttlRecord.from === "Lead",
    expired, status: ttlRecord.status, requester: ttlRecord.from, pendingLeft: ttlPending.length,
  }
  // NEGATIVE CONTROL: the shipped predicate must be falsifiable. Break the kind on the
  // SAME record and the same call must now return it — which is exactly why the post
  // above is not deliverable while it still carries the interjection kind.
  const spoofed = queueRecords.map((record) => ({ ...record, kind: "ordinary-message" }))
  const spoofedDeliverable = predicate.deliverableUnread(spoofed)
  const gateOpensWhenKindChanges = spoofedDeliverable.length === 1
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
  const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"))
  const computed = buildTreeSha(join(repoRoot, "skills"))
  const vendor = runSync(process.execPath, [join(repoRoot, "scripts", "verify-vendor.mjs")], { timeout: 120000 })
  steps.vendorLock = {
    ok: lock.assets.skills.fileCount === computed.fileCount && lock.assets.skills.treeSha === computed.treeSha,
    before: { fileCount: lock.assets.skills.fileCount, treeSha: lock.assets.skills.treeSha },
    after: computed, gateExit: vendor.status,
  }

  const allOk = Object.values(steps).every((s) => (typeof s === "object" && "ok" in s) ? s.ok : true)
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

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
