#!/usr/bin/env node
// Case agent-teams-messaging (t36): end-to-end, FALSIFIABLE QA for the R1 message
// channel delivered by t35 (packages/mpd-agent-teams-plugin/lib/state.js +
// lib/scheduler.js). Every one of the three sub-features ships ONE positive and ONE
// negative control, because a one-sided assertion is satisfied by a channel that
// simply drops or blocks everything.
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
// 1) offline --self-test: the R1 surface exists, the scheduler's exclusion region
//    still covers BOTH auto-delivery reads, and VENDOR_LOCK's `skills` treeSha
//    recomputes from the working tree (AGENTS.md §9/§11 pairing rule).
// 2) real run: isolated DSH_HOME + sandbox HOME + sandbox workspace; the mpd preset is
//    REALLY MOUNTED AND BOOTED (not --dump-config); the three lanes then drive the real
//    state primitives against the SANDBOX state root (`<ws>/.mpd/team`, the same layout
//    the scheduler resolves), and `assertSessionsSandboxed` proves no session key for
//    the real workspace was written. Never touches the real ~/.dsh.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.mjs"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const PLUGIN_LIB = join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib")
const STATE_JS = join(PLUGIN_LIB, "state.js")
const SCHEDULER_JS = join(PLUGIN_LIB, "scheduler.js")
const LOCK_PATH = join(repoRoot, "VENDOR_LOCK.json")
const SKILL_MD = join(repoRoot, "skills", "dsh-qa", "SKILL.md")
const CASE_SLUG = "agent-teams-messaging"
const TEAM = "t36-messaging"
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
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(dir)
  const rel = out.map((f) => f.slice(dir.length + 1)).sort()
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
  return source.slice(source.indexOf("\n", from) + 1, to)
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

// ------------------------------------------------------------------ self-test

function selfTest() {
  if (!existsSync(STATE_JS) || !existsSync(SCHEDULER_JS)) fail("adopted plugin lib missing")
  const stateSrc = readFileSync(STATE_JS, "utf8")
  const schedSrc = readFileSync(SCHEDULER_JS, "utf8")

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
  // recomputation above could be a constant that always "matches").
  const probeFile = join(repoRoot, "skills", "dsh-qa", "SKILL.md")
  const original = readFileSync(probeFile, "utf8")
  let mutated
  try {
    writeFileSync(probeFile, original + "\n<!-- treeSha falsifiability probe -->\n")
    mutated = buildTreeSha(join(repoRoot, "skills"))
  } finally {
    writeFileSync(probeFile, original)
  }
  if (mutated.treeSha === computed.treeSha) fail("skills treeSha did not move when a file changed (constant hash?)")

  // (d) the case table row exists, with the same 4 columns as every other row.
  const table = readFileSync(SKILL_MD, "utf8").split("\n").filter((line) => line.startsWith("| " + CASE_SLUG + " |"))
  if (table.length !== 1) fail("SKILL.md case table must carry exactly one `" + CASE_SLUG + "` row (found " + table.length + ")")
  const cols = table[0].split("|").slice(1, -1).map((c) => c.trim())
  if (cols.length !== 4 || cols.some((c) => c === "")) fail("SKILL.md row is not 4 populated columns: " + cols.length)

  // (e) the runner would actually pick this case up.
  const runner = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts["test:qa"]
  if (!runner.includes("skills/dsh-qa/scripts/*.mjs")) fail("test:qa no longer globs the case directory")

  console.log("[" + CASE_SLUG + " self-test] ok: R1 exports + scheduler exclusion on both reads + VENDOR_LOCK skills pin current ("
    + computed.fileCount + " files/" + computed.treeSha.slice(0, 12) + ") + SKILL.md row + test:qa glob")
}

// ------------------------------------------------------------------ real run

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials at " + creds)
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "omo-align", "messaging-qa", ts)
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
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
  const ws = sandboxWorkspace(sandbox)
  const stateRoot = join(ws, STATE_DIR)
  mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
  const env = { ...process.env, DSH_HOME: sandbox, HOME: sandbox }
  if (env.DSH_HOME !== sandbox || env.HOME !== sandbox) fail("isolation assertion failed")

  function runSync(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
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

  // --- 2) DEDUP lane: positive + negative control ---
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
  const ij = await state.enqueueInterjection(ijRoot, TEAM, {
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
  // The documented IN path: the approved request is re-posted as an ORDINARY message
  // to the requester's own inbox (member keys are sanitized on write, exactly as the
  // scheduler's member names are), where the SAME shipped predicate delivers it. The
  // interjection `kind` is deliberately NOT carried over — that is what "re-post as an
  // ordinary message" means, and it is why the request cannot slip through as itself.
  const requesterKey = "junior-engineer"
  const { kind: _kind, ...ordinary } = approved
  await state.appendMailbox(ijRoot, TEAM, requesterKey, { ...ordinary, to: requesterKey, id: "ij-1-delivery" })
  const requesterInbox = predicate.deliverableUnread(await state.readUnreadMailbox(ijRoot, TEAM, requesterKey))
  const interjectionPositive = {
    ok: pendingBefore.length === 1 && pendingBefore[0].expiresAt === ijTs + state.INTERJECTION_TTL_MS
      && queueRecords.length === 1 && inboxFiles.filter((f) => f.endsWith(".jsonl")).length === 1
      && notDeliveredPending && notYetExpired.length === 0
      && approved.status === "approved" && pendingAfter.length === 0
      && approvedRecord.status === "approved" && stillGatedAfterApproval
      && requesterInbox.length === 1 && requesterInbox[0].from === "Junior Engineer"
      && requesterInbox[0].content === "body-after-approval" && requesterInbox[0].to === requesterKey
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
    positive: interjectionPositive, negative: interjectionNegative, spoofedRecord: ij.id,
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
    schema: "mpd-omo-align-messaging-qa/1",
    task: "t36",
    case: CASE_SLUG,
    head: rev1,
    sandbox,
    workspace: ws,
    stateRoot,
    settledFiles: { state_js: hashes1[0], scheduler_js: hashes1[1] },
    loadEvidence: "mounted boot of the mpd preset in the sandbox home; --dump-config not cited",
    knownLimits: [
      "The approval->auto-delivery path is probed at the STATE level: the approved request is re-posted as an ordinary message to the requester's inbox (the documented tool-wiring job) and the shipped predicate then delivers it. The tool-layer wiring that posts it AND drives the real scheduler idle edge for a spawned member is not driven here — it needs a long-lived captain session with live members, which the isolated headless environment cannot hold (same limitation recorded by t35).",
    ],
    ok: allOk,
    steps,
  }
  writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2))
  writeFileSync(join(outDir, "output.log"), LOG.join("\n\n---\n\n"))
  // Keep the raw artifacts the assertions read, so the evidence is re-computable.
  try {
    cpSync(join(clearRoot, TEAM, "inbox"), join(outDir, "raw", "clear-inbox"), { recursive: true })
    cpSync(join(ijRoot, TEAM, "inbox"), join(outDir, "raw", "interjection-inbox"), { recursive: true })
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
