#!/usr/bin/env bun
// wave2b-lane-d.mjs — lane D's corpus ARMS for wave 2b (T-25 reader · T-69 wrapper + call-site
// binding · T-77 scratch root · T-80 driver-header claims · T-89 `./` forms · T-74 `--out` discipline).
//
// WHY ONE DRIVER: every arm below asserts a CORPUS property, and each has an offline `--self-test`
// fixture so the arm itself is falsifiable without a live boot. `T-25`'s instrument leg is lane C's;
// here it is the DOCUMENTATION reading plus the naive-reader falsifier. `T-80`'s RULE is lane B2's
// (`scripts/check-citations.mjs --driver-headers`); this driver runs it and asserts the AGREEMENT.
//
// OUTPUT DISCIPLINE (T-74, and the same discipline this file must obey): `--out <dir>` pins the
// evidence dir; an EXISTING target is refused (immutability by default, T-53), and with no `--out`
// the run lands in a fresh stamped caller-visible dir under `evidence/dsh-qa/wave2b-laneD/`.
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { exitOnRefusal, refuseOverwrite, timestamp } from "./lib/immutable-output.mjs"
import { readSessionEvents, scanZstdFrames } from "./lib/session-evidence.mjs"
import { zstdCompressSync } from "node:zlib"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..")
const SLUG = "wave2b-lane-d"
const LANE_DIR = "skills/dsh-qa/scripts"
const SKILL_MD = "skills/dsh-qa/SKILL.md"

const sha = (text) => createHash("sha256").update(text).digest("hex")
const readText = (rel) => readFileSync(join(REPO, rel), "utf8")
const relPaths = (root, prefix = "") =>
  readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix === "" ? entry.name : prefix + "/" + entry.name
    return entry.isDirectory() ? relPaths(join(root, entry.name), rel) : [rel]
  })

// ── T-69: no corpus lane may compose a profile through the RAW flag ──────────────────────────
// The wrapper (`scripts/dump-config.mjs`, lane B's file) is what a lane must invoke. The raw-flag
// occurrences that remain in PROSE (the manual's contrast sentence, the wrapper's own warning text)
// are declared EXCEPTIONS BY NAME — never by count — so a new raw site cannot hide in a total.
const T69_EXCEPTIONS = [
  // Declared by NAME. A file+line lands here only when the line's own text CONTRASTS the flag.
  { site: "skills/dsh-qa/SKILL.md", why: "prose: the skill's own description of what a mount proof may cite, and the contrast passages" },
  { site: "skills/dsh-qa/scripts/wave2b-lane-d.mjs", why: "the SCANNER itself: its own pattern literal, its prose and its RED fixture live here, and the fixture MUST carry a raw invocation to prove the scan reddens" },
]
const RAW_FLAG = /"--dump-config"/g

export function scanRawDumpConfig() {
  const sites = []
  const files = [
    ...relPaths(join(REPO, "skills")).filter((rel) => rel.endsWith(".mjs") || rel.endsWith(".md")).map((rel) => "skills/" + rel),
  ]
  for (const rel of files) {
    const text = readText(rel)
    text.split("\n").forEach((line, index) => {
      RAW_FLAG.lastIndex = 0
      if (!RAW_FLAG.test(line)) return
      const trimmed = line.trim()
      // PROSE is a comment or a doc line; an INVOCATION is a real argv token in executing code.
      const isProse = /^(\/\/|\*|#)/.test(trimmed) || !rel.endsWith(".mjs")
      const covered = T69_EXCEPTIONS.some((entry) => entry.site === rel)
      sites.push({ site: rel + ":" + (index + 1), kind: isProse ? "prose" : "invocation", covered, line: trimmed.slice(0, 120) })
    })
  }
  return { filesScanned: files.length, sites, exceptions: T69_EXCEPTIONS.map((entry) => entry.site) }
}

function t69() {
  const scan = scanRawDumpConfig()
  const rawInvocations = scan.sites.filter((site) => site.kind === "invocation" && !site.covered)
  const check = { id: "T-69.raw-flag", ok: rawInvocations.length === 0, detail: "raw `dsh --dump-config` invocation(s) in the corpus: " + (rawInvocations.map((s) => s.site).join(", ") || "none") + " (files scanned " + scan.filesScanned + ", prose sites " + scan.sites.filter((s) => s.kind === "prose").length + ", declared exceptions " + scan.exceptions.length + ")" }
  return { check, scan, rawInvocations }
}

// ── T-69 TWIN: every `join(REPO|repoRoot, …)` call site must resolve to a BINDING ────────────
// WHY THIS ARM EXISTS (R-D-F1): the T-69 arm above proves no lane composes a profile through the
// raw flag, and it stayed GREEN while five lanes crashed in `main()` — their rewritten call sites
// named an identifier that no file bound (`join(REPO, …)` in files that only bind `repoRoot`), so
// the crash happened when the argv expression was EVALUATED, not when the scanner looked at it.
// The predicate is the finding's own: a call site `join(REPO|repoRoot, …)` is satisfied by an
// in-file declaration, a named import clause, or a function parameter. Prose lines are exempt by
// the same whole-line rule the other arms use. An EMPTY site set is a RED (T-83).
const JOIN_IDENT = /join\(\s*(REPO|repoRoot)\s*,/g
const BINDING_TESTS = {
  declared: (text, name) => new RegExp("\\b(?:const|let|var)\\s+" + name + "\\b").test(text),
  imported: (text, name) => [...text.matchAll(/\bimport\s*\{([\s\S]*?)\}\s*from/g)].some((match) => new RegExp("\\b" + name + "\\b").test(match[1])),
  parameter: (text, name) => new RegExp("\\(([^()]*\\b" + name + "\\b[^()]*)\\)\\s*(?:=>|\\{)").test(text),
}

export function checkJoinBindings(entries) {
  const sites = []
  const fileBindings = new Map()
  for (const entry of entries) {
    const text = String(entry.text ?? "")
    fileBindings.set(entry.site, Object.entries(BINDING_TESTS).map(([kind, test]) => [kind, test(text, "REPO"), test(text, "repoRoot")]))
    text.split("\n").forEach((line, index) => {
      if (/^\s*(\/\/|\*|#)/.test(line)) return
      JOIN_IDENT.lastIndex = 0
      for (const match of line.matchAll(JOIN_IDENT)) {
        const name = match[1]
        const binding = fileBindings.get(entry.site).filter(([, hasRepo, hasRepoRoot]) => (name === "REPO" ? hasRepo : hasRepoRoot)).map(([kind]) => kind)
        sites.push({ site: entry.site + ":" + (index + 1), name, binding })
      }
    })
  }
  return { filesScanned: entries.length, sites, offenders: sites.filter((site) => site.binding.length === 0) }
}

function t69binding() {
  const entries = relPaths(join(REPO, LANE_DIR))
    .filter((rel) => rel.endsWith(".mjs"))
    .map((rel) => ({ site: LANE_DIR + "/" + rel, text: readText(LANE_DIR + "/" + rel) }))
  const scan = checkJoinBindings(entries)
  const withSites = new Set(scan.sites.map((site) => site.site.split(":")[0])).size
  const check = { id: "T-69.call-site-binding", ok: scan.sites.length > 0 && scan.offenders.length === 0, detail: "`join(REPO|repoRoot, …)` call sites: " + scan.sites.length + " in " + withSites + " of " + scan.filesScanned + " scanned file(s); UNBOUND: " + (scan.offenders.map((site) => site.site + " `" + site.name + "`").join(", ") || "none") }
  return { check, scan }
}

// ── T-69 STREAM CONTRACT: the wrapper's JSON rides on STDOUT, its banner on STDERR ───────────
// WHY (R-D-F5, measured while repairing F1): every lane captures a child through its own helper, and
// several of those helpers returned stdout+stderr MERGED. `JSON.parse(merged)` then fails on the
// banner, the parse falls back to the ESCAPED envelope text, and a predicate carrying a `"`-quoted
// fragment silently goes FALSE — `bundle-lifecycle`'s `composed`/`layerDurability` were red for
// exactly that reason while the wrapper itself was byte-identical to the raw flag. This arm pins the
// contract the lanes must honour: stdout alone is the parseable envelope, the banner is on stderr,
// and a merged capture is NOT parseable (so falling back to it is a bug, not a tolerance).
const WRAPPER_BANNER = "COMPOSITION ONLY"

export function dumpConfigStreams(bin) {
  const args = [join(REPO, "scripts", "dump-config.mjs"), "--profile", "headless", "--json"]
  if (bin !== undefined) args.push("--bin", bin)
  const proc = spawnSync(process.execPath, args, { cwd: REPO, encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 })
  const stdout = proc.stdout ?? ""
  const stderr = proc.stderr ?? ""
  let parsed = null
  try { parsed = JSON.parse(stdout) } catch { parsed = null }
  let mergedParses = true
  try { JSON.parse(stdout + stderr) } catch { mergedParses = false }
  return { exit: proc.status, stdout, stderr, envelope: parsed, stdoutIsEnvelope: parsed !== null && typeof parsed.stdout === "string", bannerOnStdout: stdout.includes(WRAPPER_BANNER), bannerOnStderr: stderr.includes(WRAPPER_BANNER), mergedParses }
}

const streamContractHolds = (r) => r.stdoutIsEnvelope && r.bannerOnStderr && !r.bannerOnStdout && !r.mergedParses

function t69stream() {
  const box = mkdtempSync(join(tmpdir(), "lane-d-t69s-"))
  const child = join(box, "child.mjs")
  writeFileSync(child, '#!/usr/bin/env node\nprocess.stdout.write("SELF_TEST_CHILD_STDOUT\\n")\nprocess.stderr.write("SELF_TEST_CHILD_STDERR\\n")\n')
  chmodSync(child, 0o755)
  let live
  let fixture
  try {
    live = dumpConfigStreams(undefined)
    fixture = dumpConfigStreams(child)
  } finally {
    rmSync(box, { recursive: true, force: true })
  }
  const fixtureChildReachable = fixture.envelope !== null && String(fixture.envelope.stdout).includes("SELF_TEST_CHILD_STDOUT")
  const check = { id: "T-69.json-stream", ok: streamContractHolds(live) && streamContractHolds(fixture) && fixtureChildReachable, detail: "live (profile headless): exit " + live.exit + ", stdout is the JSON envelope=" + live.stdoutIsEnvelope + ", banner on stderr=" + live.bannerOnStderr + ", banner on stdout=" + live.bannerOnStdout + ", MERGED capture parses=" + live.mergedParses + " | fixture child via --bin: envelope=" + fixture.stdoutIsEnvelope + ", child stdout reachable only through the field=" + fixtureChildReachable + ", merged parses=" + fixture.mergedParses }
  return { check, live: { exit: live.exit, stdoutBytes: live.stdout.length, stderrBytes: live.stderr.length, stdoutIsEnvelope: live.stdoutIsEnvelope, mergedParses: live.mergedParses }, fixture: { exit: fixture.exit, stdoutIsEnvelope: fixture.stdoutIsEnvelope, childStdoutReachable: fixtureChildReachable, mergedParses: fixture.mergedParses } }
}

// ── T-89: path-qualified commands carry the `./` form ────────────────────────────────────────
// A path-qualified token: a string literal that CONTAINS a slash (so a bare filename is not a path)
// and does not already start with `./` or `/`. `join(REPO, …)` expressions are ABSOLUTE and safe.
const PATH_TOKEN = /"([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]*)"/g
const EXECUTED = /(runSync|spawnSync|spawn|runInSandbox|execFileSync)\s*\(/

export function scanPathCommands() {
  const files = relPaths(join(REPO, LANE_DIR)).filter((rel) => rel.endsWith(".mjs")).map((rel) => LANE_DIR + "/" + rel)
  const offenders = []
  const prose = []
  for (const rel of files) {
    const text = readText(rel)
    text.split("\n").forEach((line, index) => {
      const isProse = /^\s*(\/\/|\*|#)/.test(line)
      for (const match of line.matchAll(PATH_TOKEN)) {
        const token = match[1]
        if (token.startsWith("./") || token.startsWith("/") || token.includes("${")) continue
        // A token built by join()/resolve()/pathToFileURL() on the same line is ABSOLUTE — safe.
        const built = /\b(join|resolve|pathToFileURL)\s*\(/.test(line)
        if (!EXECUTED.test(line) || isProse || built) { prose.push({ site: rel + ":" + (index + 1), token, built }); continue }
        offenders.push({ site: rel + ":" + (index + 1), token, line: line.trim().slice(0, 110) })
      }
    })
  }
  return { filesScanned: files.length, offenders, prose }
}

/** The FILE COUNT a `./`-formed path discovers — the number a scratch-copy driver must NAME. */
export function discoveredCount(glob) {
  const dir = join(REPO, glob)
  if (!existsSync(dir)) return { glob, count: 0, exists: false }
  return { glob, count: relPaths(dir).filter((rel) => rel.endsWith(".mjs")).length, exists: true }
}

function t89() {
  const scan = scanPathCommands()
  const form = "./" + LANE_DIR
  const discovered = discoveredCount(form)
  const check = { id: "T-89.dot-slash", ok: scan.offenders.length === 0 && discovered.count > 0, detail: "exectued argv tokens without `./`: " + (scan.offenders.map((o) => o.site).join(", ") || "none") + "; prose/usage occurrences (documented, not violations): " + scan.prose.length + "; the `./` form " + form + " discovers " + discovered.count + " file(s) (files scanned " + scan.filesScanned + ")" }
  return { check, scan, discovered }
}

// ── T-77: the scratch-root CONVENTION, read against the repository's own ignore rule ─────────
const SCRATCH_SHAPE = ".qa-wave2b-lane-d-scratch/keep.txt" // must be IGNORED (the declared shape)
const NEAR_MISS = "qa-wave2b-lane-d-scratch/keep.txt" // must NOT be ignored (no leading dot)

export function checkIgnore(paths) {
  const proc = spawnSync("git", ["check-ignore", "-v", "--stdin"], { cwd: REPO, input: paths.join("\n") + "\n", encoding: "utf8" })
  const matched = new Set(String(proc.stdout ?? "").split("\n").filter(Boolean).map((line) => line.split("\t").pop()))
  return { exit: proc.status, ignored: [...matched], raw: String(proc.stdout ?? "").trim() }
}

function t77() {
  const result = checkIgnore([SCRATCH_SHAPE, NEAR_MISS])
  const shapeIgnored = result.ignored.includes(SCRATCH_SHAPE)
  const nearMissIgnored = result.ignored.includes(NEAR_MISS)
  const check = { id: "T-77.scratch-shape", ok: shapeIgnored && !nearMissIgnored, detail: "`" + SCRATCH_SHAPE + "` ignored=" + shapeIgnored + " (pattern: " + (result.raw.split("\n").find((l) => l.includes(SCRATCH_SHAPE))?.split("\t")[0] ?? "n/a") + "); near-miss `" + NEAR_MISS + "` ignored=" + nearMissIgnored }
  return { check, result }
}

// ── T-80: the header's CLAIMED keys and the driver's PRODUCED keys must agree ────────────────
export function driverHeaderCheck(dir = "./" + LANE_DIR) {
  const proc = spawnSync(process.execPath, [join(REPO, "scripts", "check-citations.mjs"), "--driver-headers", "--dir", dir], { cwd: REPO, encoding: "utf8", timeout: 120_000 })
  const out = String(proc.stdout ?? "") + String(proc.stderr ?? "")
  const summary = out.split("\n").find((line) => line.startsWith("[driver-headers]")) ?? ""
  const noClaim = (out.match(/NO-CLAIM-SET/g) ?? []).length
  const violations = Number((summary.match(/(\d+) violation\(s\)/) ?? [])[1] ?? NaN)
  const claimSets = Number((summary.match(/(\d+) claim set\(s\)/) ?? [])[1] ?? NaN)
  return { exit: proc.status, summary, violations, claimSets, noClaim, out }
}

/** A seeded mismatch: a SCRATCH copy whose header claims one key too many (must REDDEN). */
export function seededHeaderMismatch() {
  const box = mkdtempSync(join(tmpdir(), "lane-d-t80-"))
  const src = "skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs"
  const text = readText(src)
  const anchor = "// CLAIM SET (T-80): this driver CLAIMS the assertion keys A1–A5"
  if (text.split(anchor).length - 1 !== 1) throw new Error("seeded mismatch: the claim anchor did not match exactly once")
  writeFileSync(join(box, "settings-bridge-lane.mjs"), text.replace(anchor, anchor.replace("A1–A5", "A1–A6")))
  return box
}

function t80() {
  const live = driverHeaderCheck()
  const box = seededHeaderMismatch()
  let seeded
  try {
    seeded = driverHeaderCheck(box)
  } finally {
    rmSync(box, { recursive: true, force: true })
  }
  const check = { id: "T-80.header-claims", ok: live.exit === 0 && live.violations === 0 && live.claimSets >= 2 && seeded.exit !== 0 && seeded.violations >= 1, detail: "live: " + live.summary + " | seeded mismatch: exit " + seeded.exit + ", violations " + seeded.violations + " (a claimed-but-unasserted key must redden)" }
  return { check, live, seeded }
}

// ── T-25: the naive reader vs the frame-by-frame reader, on ONE container ────────────────────
/** Build a TWO-FRAME container with the runtime's own zstd, and read both ways. */
export function naiveVsReader() {
  const zlib = require("node:zlib")
  const box = mkdtempSync(join(tmpdir(), "lane-d-t25-"))
  try {
    const file = join(box, "session.frame")
    const frame = (obj) => zstdCompressSync(Buffer.from(JSON.stringify(obj) + "\n", "utf8"))
    writeFileSync(file, Buffer.concat([frame({ type: "header", sessionId: "s" }), frame({ type: "session/event", data: { kind: "tool/call", name: "probe" } })]))
    const bytes = readFileSync(file)
    const frames = (scanZstdFrames(bytes).frames ?? []).length
    let naive = "threw"
    try {
      JSON.parse(zlib.zstdDecompressSync(bytes).toString("utf8").trim().split("\n")[0])
      naive = "first-frame-only"
    } catch (error) {
      naive = "threw: " + String(error?.message ?? error).slice(0, 60)
    }
    return { file, frames, naive }
  } finally {
    rmSync(box, { recursive: true, force: true })
  }
}

function t25(storeHome) {
  const shape = naiveVsReader()
  const doc = readText(SKILL_MD)
  const namedEntries = ["readSessionEvents", "findToolCall", "recordedToolNames"].every((name) => doc.includes(name))
  const trapDocumented = doc.includes("concatenated-zstd-frame") || doc.includes("frame by frame") || doc.includes("zero events")
  let real = null
  if (storeHome !== undefined && existsSync(storeHome)) {
    const events = readSessionEvents(storeHome, {})
    real = { home: storeHome, events: events.length }
  }
  const check = { id: "T-25.naive-reader", ok: shape.frames >= 2 && naiveIsZero(shape.naive) && namedEntries && trapDocumented, detail: "container frames=" + shape.frames + ", naive one-shot read=" + shape.naive + " (the failure IS the evidence); docs name the three entry points=" + namedEntries + ", trap documented=" + trapDocumented + (real === null ? "; real-store reading: unavailable (no --store passed)" : "; real store " + real.home + " → " + real.events + " event(s)") }
  return { check, shape, real, docBytes: doc.length }
}
const naiveIsZero = (naive) => naive.startsWith("threw") || naive === "first-frame-only"

// ── T-74: the `--out` discipline, measured on this driver's own invocation ───────────────────
const T74_RULE = "a verification that runs another task's driver pins its output with `--out` into its own evidence dir"

function t74(foreignDir) {
  const doc = readText(SKILL_MD)
  const rulePresent = doc.includes(T74_RULE)
  let pair = null
  if (foreignDir !== undefined) {
    const box = mkdtempSync(join(tmpdir(), "lane-d-t74-"))
    try {
      const before = dirDigest(foreignDir)
      const target = join(box, "pinned")
      const proc = spawnSync("bun", [join(HERE, "wave2b-lane-d.mjs"), "--only", "t74-probe", "--out", target], { cwd: REPO, encoding: "utf8", timeout: 300_000 })
      const after = dirDigest(foreignDir)
      pair = { before, after, identical: before === after, pinnedWrote: existsSync(target), exit: proc.status }
    } finally {
      rmSync(box, { recursive: true, force: true })
    }
  }
  const check = { id: "T-74.out-discipline", ok: rulePresent && (pair === null || pair.identical), detail: "SKILL.md rule sentence present=" + rulePresent + (pair === null ? "; digest pair: not requested" : "; foreign dir digest " + pair.before.slice(0, 12) + " → " + pair.after.slice(0, 12) + " identical=" + pair.identical + " (the pinned dir received the run: " + pair.pinnedWrote + ")") }
  return { check, pair, rulePresent }
}

export function dirDigest(dir) {
  if (!existsSync(dir)) return "(absent)"
  const files = relPaths(dir).sort()
  return sha(files.map((rel) => rel + ":" + sha(readFileSync(join(dir, rel)))).join("\n")) + " files=" + files.length
}

// ── the run ──────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const at = argv.indexOf(name)
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback
}

function selfTest() {
  const failures = []
  let total = 0
  const check = (name, ok, detail) => {
    total += 1
    console.log("[self-test] " + (ok ? "ok  " : "FAIL") + " " + name + " — " + detail)
    if (!ok) failures.push(name)
  }
  const t69Fixture = () => {
    const box = mkdtempSync(join(tmpdir(), "lane-d-t69-"))
    writeFileSync(join(box, "raw.mjs"), 'const dump = spawnSync("dsh", ["--profile", "p", "--dump-config"])\n')
    return box
  }
  const box = t69Fixture()
  try {
    const text = readFileSync(join(box, "raw.mjs"), "utf8")
    check("t69-fixture-reddens", RAW_FLAG.test(text) || /"--dump-config"/.test(text), "a fixture carrying a raw invocation is DETECTED by the scanner's own pattern")
  } finally {
    rmSync(box, { recursive: true, force: true })
  }
  const t80seeded = seededHeaderMismatch()
  try {
    const seeded = driverHeaderCheck(t80seeded)
    check("t80-seeded-mismatch-reddens", seeded.exit !== 0 && seeded.violations >= 1, "a scratch copy claiming one key too many exits " + seeded.exit + " with " + seeded.violations + " violation(s)")
  } finally {
    rmSync(t80seeded, { recursive: true, force: true })
  }
  const shape = naiveVsReader()
  check("t25-two-frame-container", shape.frames >= 2 && naiveIsZero(shape.naive), "frames=" + shape.frames + ", naive read=" + shape.naive)
  const ignore = checkIgnore([SCRATCH_SHAPE, NEAR_MISS])
  check("t77-shape-and-near-miss", ignore.ignored.includes(SCRATCH_SHAPE) !== ignore.ignored.includes(NEAR_MISS), "shape ignored=" + ignore.ignored.includes(SCRATCH_SHAPE) + ", near-miss ignored=" + ignore.ignored.includes(NEAR_MISS))
  const count = discoveredCount("./" + LANE_DIR)
  check("t89-dot-slash-discovers", count.exists && count.count > 0, "`./" + LANE_DIR + "` discovers " + count.count + " file(s)")
  const bindingFixtures = [
    { site: "fixture-unbound.mjs", text: 'const a = join(REPO, "scripts", "x.mjs")\n', unbound: true },
    { site: "fixture-declared.mjs", text: 'const REPO = "/tmp/repo"\nconst a = join(REPO, "scripts", "x.mjs")\n', unbound: false },
    { site: "fixture-imported.mjs", text: 'import { REPO } from "./lib/tui-lane.mjs"\nconst a = join(REPO, "scripts", "x.mjs")\n', unbound: false },
    { site: "fixture-parameter.mjs", text: 'function probe(repoRoot) { return join(repoRoot, "scripts", "x.mjs") }\n', unbound: false },
    { site: "fixture-prose.mjs", text: '// join(REPO, "scripts", "x.mjs") is absolute and safe\n', unbound: false },
  ]
  const streamArm = t69stream()
  check("t69-json-stream-contract", streamArm.check.ok && streamArm.fixture.childStdoutReachable, streamArm.check.detail)
  const bindingScan = checkJoinBindings(bindingFixtures)
  const flagged = bindingScan.offenders.map((site) => site.site.split(":")[0])
  const expectedFlagged = bindingFixtures.filter((fixture) => fixture.unbound).map((fixture) => fixture.site)
  check("t69-binding-reddens-and-spares", flagged.length === expectedFlagged.length && expectedFlagged.every((site) => flagged.includes(site)), "fixtures: " + bindingFixtures.length + ", flagged: " + (flagged.join(", ") || "none") + " (declared/imported/parameter/prose fixtures must NOT flag)")
  check("t74-rule-sentence", readText(SKILL_MD).includes(T74_RULE), "the SKILL.md rule sentence is present byte-for-byte")
  console.log("[self-test] " + (failures.length === 0 ? "PASS" : "FAIL") + " — " + SLUG + " (" + (total - failures.length) + "/" + total + " arms)")
  process.exit(failures.length === 0 ? 0 : 1)
}

if (argv.includes("--self-test")) selfTest()

const only = argOf("--only", null)
const storeHome = argOf("--store", undefined)
const foreignDir = argOf("--foreign", undefined)
const out = resolve(argOf("--out", join(REPO, "evidence", "dsh-qa", "wave2b-laneD", timestamp())))
if (only === "t74-probe") {
  // The pinned probe: a cross-task invocation whose ONLY job is to land in the caller's dir (T-74).
  mkdirSync(out, { recursive: true })
  const target = join(out, "probe.txt")
  try {
    refuseOverwrite(target, { label: "probe output", remedy: "pass a fresh --out <dir>" })
  } catch (error) {
    exitOnRefusal(error, "[" + SLUG + "]")
  }
  writeFileSync(target, "wave2b lane D — T-74 probe\n")
  console.log("[" + SLUG + "] t74-probe wrote " + target)
  process.exit(0)
}

const arms = []
if (only === null || only === "t69") arms.push(t69())
if (only === null || only === "t69-binding") arms.push(t69binding())
if (only === null || only === "t69-stream") arms.push(t69stream())
if (only === null || only === "t89") arms.push(t89())
if (only === null || only === "t77") arms.push(t77())
if (only === null || only === "t80") arms.push(t80())
if (only === null || only === "t25") arms.push(t25(storeHome))
if (only === null || only === "t74") arms.push(t74(foreignDir))

mkdirSync(out, { recursive: true })
const checks = arms.map((arm) => arm.check)
const failed = checks.filter((check) => !check.ok)
const result = { slug: SLUG, suite: "wave2b lane D corpus arms", moment: new Date().toISOString(), only, checks, readings: arms.map((arm) => ({ id: arm.check.id, ...arm })), ok: failed.length === 0 }
const resultPath = join(out, "result.json")
try {
  refuseOverwrite(resultPath, { label: "result.json", remedy: "pass a fresh --out <dir>" })
} catch (error) {
  exitOnRefusal(error, "[" + SLUG + "]")
}
writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n")
for (const check of checks) console.log("[" + SLUG + "] " + (check.ok ? "ok  " : "FAIL") + " " + check.id + " — " + check.detail)
console.log("[" + SLUG + "] " + (result.ok ? "PASS" : "FAIL") + " — " + checks.length + " arm(s), " + failed.length + " failed (evidence: " + resultPath + ")")
process.exit(result.ok ? 0 : 1)
