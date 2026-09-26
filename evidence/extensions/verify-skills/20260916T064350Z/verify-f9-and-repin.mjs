#!/usr/bin/env node

// t11 items 4 + 5.
//
// Item 4 — F9 packed-arm falsifiability, reproduced with the VERIFIER's OWN fixture
// packed trees plus the shipped exports (`packedStateOf` / `packedStateOk`), so the
// claim "exit-0-with-a-red-packed-tree is impossible" is checked as a property, not
// taken from the lane's result.json.
//
// Item 5 — the single-re-pin rule: `verify-vendor` exits 0, and the working tree
// carries exactly ONE changed VENDOR_LOCK.json asset entry (the skills treeSha),
// in the same uncommitted change set as the `skills/**` edits.
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { packedNegativeDriver, packedStateOf, packedStateOk } from "../../../../skills/dsh-qa/scripts/extension-lifecycle.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const checks = []
const logs = []
const log = (text) => {
  logs.push(text)
  process.stdout.write(text + "\n")
}
const check = (id, ok, detail) => {
  checks.push({ id, status: ok ? "passed" : "failed", detail })
  log(`  ${ok ? "ok  " : "FAIL"} ${id} — ${detail}`)
  return ok
}
const sh = (bin, args, opts = {}) => {
  const result = spawnSync(bin, args, { cwd: REPO, encoding: "utf8", ...opts })
  return { exitCode: result.status, out: (result.stdout ?? "") + (result.stderr ?? "") }
}

// ── item 4 ────────────────────────────────────────────────────────────────────
log("verify-f9-and-repin — item 4 (F9 falsifiability, verifier-owned fixtures)")
const root = mkdtempSync(join(tmpdir(), "t11-p11-fixtures-"))
try {
  const build = (name, { row = true, plugin = true, extensions = true } = {}) => {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    const line = row
      ? "    - id: mpd-ext\n      name: '@mpd-dsh/mpd/packages/mpd-ext-plugin/dist/index.js'\n"
      : "    - id: mpd-tools\n      name: '@mpd-dsh/mpd/packages/mpd-tools-plugin/dist/index.js'\n"
    writeFileSync(join(dir, "cordis.patch.yml"), "- insert:\n" + line)
    if (plugin) mkdirSync(join(dir, "packages", "mpd-ext-plugin", "dist"), { recursive: true })
    if (extensions) mkdirSync(join(dir, "extensions"), { recursive: true })
    return dir
  }
  // the verifier's own tree names, deliberately different from the lane's
  const mine = {
    closed: build("verifier-closed"),
    "missing-plugin-package": build("verifier-no-plugin", { plugin: false }),
    "missing-extensions-root": build("verifier-no-extensions", { extensions: false }),
    "missing-mpd-ext-row": build("verifier-no-row", { row: false }),
  }
  const facts = Object.fromEntries(Object.entries(mine).map(([name, dir]) => [name, packedStateOf(dir)]))
  const verdicts = Object.fromEntries(Object.entries(facts).map(([name, f]) => [name, packedStateOk({ packExit: 0, ...f })]))
  check(
    "closed-tree-is-green",
    verdicts.closed === true,
    `verifier fixture with all four facts: ok=${verdicts.closed} facts=${JSON.stringify(facts.closed)}`,
  )
  const brokenNames = ["missing-plugin-package", "missing-extensions-root", "missing-mpd-ext-row"]
  check(
    "every-missing-fact-is-red",
    brokenNames.every((name) => verdicts[name] === false),
    brokenNames.map((name) => `${name}=${verdicts[name]} facts=${JSON.stringify(facts[name])}`).join(" | "),
  )
  check(
    "packer-exit-gated",
    packedStateOk({ packExit: 1, hasRow: true, hasPlugin: true, hasExtensions: true }) === false,
    "a non-zero packer exit fails the predicate even when every asset is present",
  )
  // the retired predicate, re-enacted verbatim from the archived shape
  // `packRun.status === 0 && hasRow && (hasPlugin && hasExtensions ? true : red)`:
  // the `&& "red"` branch is TRUTHY, so a tree missing the plugin package or the
  // extensions root passed the old gate. This is the vacuity the fix removes.
  const RED = "red"
  const oldShape = (f) => 0 === 0 && f.hasRow === true && (f.hasPlugin && f.hasExtensions ? true : RED) && true
  check(
    "old-shape-was-vacuous",
    Boolean(oldShape(facts["missing-extensions-root"])) === true && verdicts["missing-extensions-root"] === false,
    `retired shape on the no-extensions tree: ${JSON.stringify(oldShape(facts["missing-extensions-root"]))} (truthy) while the shipped predicate returns ${verdicts["missing-extensions-root"]} — the fix is real, not cosmetic`,
  )
  const laneDriver = packedNegativeDriver()
  check(
    "lane-driver-falsifiable",
    laneDriver.falsifiable === true && laneDriver.packerExitGated === true,
    `packedNegativeDriver(): falsifiable=${laneDriver.falsifiable} packerExitGated=${laneDriver.packerExitGated} trees=${JSON.stringify(laneDriver.trees)}`,
  )
} finally {
  rmSync(root, { recursive: true, force: true })
}

// ── item 5 ────────────────────────────────────────────────────────────────────
log("verify-f9-and-repin — item 5 (single re-pin)")
const vendor = sh("node", ["scripts/verify-vendor.mjs"])
writeFileSync(join(HERE, "raw", "repin-verify-vendor.txt"), vendor.out)
check("verify-vendor", vendor.exitCode === 0, `exit ${vendor.exitCode}; ${vendor.out.trim().split("\n").slice(-2).join(" | ").slice(0, 200)}`)

const headRaw = sh("git", ["show", "HEAD:VENDOR_LOCK.json"])
const headLock = headRaw.exitCode === 0 ? JSON.parse(headRaw.out) : undefined
const workLock = JSON.parse(readFileSync(join(REPO, "VENDOR_LOCK.json"), "utf8"))
if (headLock === undefined) {
  check("head-lock-readable", false, "git show HEAD:VENDOR_LOCK.json failed")
} else {
  const changedEntries = []
  const keys = new Set([...Object.keys(headLock.assets ?? {}), ...Object.keys(workLock.assets ?? {})])
  for (const key of keys) {
    const before = JSON.stringify(headLock.assets?.[key] ?? null)
    const after = JSON.stringify(workLock.assets?.[key] ?? null)
    if (before !== after) changedEntries.push({ key, before: headLock.assets?.[key], after: workLock.assets?.[key] })
  }
  const skills = changedEntries.find((entry) => entry.key === "skills")
  check(
    "exactly-one-asset-entry-changed",
    changedEntries.length === 1 && skills !== undefined,
    `changed asset entries: [${changedEntries.map((entry) => entry.key).join(", ")}] (${changedEntries.length})`,
  )
  check(
    "skills-before-values",
    skills?.before?.fileCount === 317 && String(skills?.before?.treeSha ?? "").startsWith("7a48fdad90cc30f9c1e7"),
    `before: fileCount=${skills?.before?.fileCount} treeSha=${String(skills?.before?.treeSha ?? "").slice(0, 20)}…`,
  )
  check(
    "skills-after-values",
    skills?.after?.treeSha !== skills?.before?.treeSha && skills?.after?.fileCount !== skills?.before?.fileCount,
    `after: fileCount=${skills?.after?.fileCount} treeSha=${String(skills?.after?.treeSha ?? "").slice(0, 20)}… (one re-pin: one before value, one after value)`,
  )
  const otherChanged = changedEntries.filter((entry) => entry.key !== "skills")
  check("no-second-repin", otherChanged.length === 0, `no other asset entry changed: [${otherChanged.map((entry) => entry.key).join(", ")}]`)

  // the same change set: the skills edits and the re-pin are uncommitted together
  const status = sh("git", ["status", "--porcelain"]).out.split("\n").filter((line) => line.trim() !== "")
  const skillsEdits = status.filter((line) => /\sskills\//.test(line.replace(/^\?\?\s*/, " ")) || /^..\s*skills\//.test(line))
  const lockEdit = status.filter((line) => /VENDOR_LOCK\.json/.test(line))
  check(
    "same-change-set",
    skillsEdits.length > 0 && lockEdit.length === 1,
    `${skillsEdits.length} skills/** path(s) modified and VENDOR_LOCK.json modified in the SAME working-tree change set: ${skillsEdits.map((line) => line.trim()).join(" ; ")}`,
  )
  writeFileSync(
    join(HERE, "raw", "repin-entry-diff.json"),
    JSON.stringify({ changedEntries, skillsEdits: skillsEdits.map((line) => line.trim()), lockEdit: lockEdit.map((line) => line.trim()) }, null, 2) + "\n",
  )
}

// ── item 6 (lanes touched by the skills pass) ────────────────────────────────
log("verify-f9-and-repin — item 6 (lane --self-tests, clean runs)")
const LANES = [
  ["extension-isolation.mjs --self-test", ["skills/dsh-qa/scripts/extension-isolation.mjs", "--self-test"], "bun"],
  ["extension-lifecycle.mjs --self-test", ["skills/dsh-qa/scripts/extension-lifecycle.mjs", "--self-test"], "bun"],
  ["extension-mcp-bridge.mjs --self-test", ["skills/dsh-qa/scripts/extension-mcp-bridge.mjs", "--self-test"], "bun"],
  ["extension-template.mjs --self-test", ["skills/dsh-qa/scripts/extension-template.mjs", "--self-test"], "bun"],
  ["verify-pack-closure.mjs --self-test", ["scripts/verify-pack-closure.mjs", "--self-test"], "node"],
  ["verify-debranding-full.mjs --self-test", ["evidence/extensions/debranding-probe/20260916T061807Z/verify-debranding-full.mjs", "--self-test"], "node"],
]
const selfTestResults = []
for (const [label, args, bin] of LANES) {
  const result = sh(bin, args)
  const tail = result.out.trim().split("\n").slice(-1)[0]?.slice(0, 160) ?? ""
  selfTestResults.push({ lane: label, exitCode: result.exitCode, status: result.exitCode === 0 ? "passed" : "failed", tail })
  writeFileSync(join(HERE, "raw", `selftest-${label.replace(/[^a-z0-9.-]+/gi, "_")}.txt`), result.out)
  check(`selftest:${label}`, result.exitCode === 0, `exit ${result.exitCode}; ${tail}`)
}

const failed = checks.filter((entry) => entry.status === "failed")
writeFileSync(
  join(HERE, "raw", "verify-f9-and-repin.json"),
  JSON.stringify({ task: "t11", item: "4 + 5 + 6", attempt_id: "f488e6cf-997c-4899-b5bc-897ae67d869c", selfTests: selfTestResults, checks, failed: failed.map((entry) => `${entry.id}: ${entry.detail}`), passed: checks.length - failed.length, total: checks.length }, null, 2) + "\n",
)
writeFileSync(join(HERE, "raw", "verify-f9-and-repin.log"), logs.join("\n") + "\n")
log(`[t11 items 4+5+6] ${checks.length - failed.length}/${checks.length} checks passed, ${failed.length} failed`)
process.exitCode = failed.length === 0 ? 0 : 1
