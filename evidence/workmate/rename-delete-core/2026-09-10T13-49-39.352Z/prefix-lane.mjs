#!/usr/bin/env node
// t15 pre-fix REAL-BOOT lane: boot the harness with the PRE-REPAIR workmate schemas mounted as the
// live row, and prove it with a load marker.
//
// Why this exists: t3 reported that an id-target overlay cannot rebind a row's `name:` field
// (two attempts, marker absent — recorded in
// evidence/workmate/rename-delete-core/t15-valid-call/NOTES-t3-author-measurement.txt). The
// mechanism that DOES work is the one skills/dsh-qa/scripts/readonly-deny.mjs uses for its negative
// control: the profile's COMPOSED patch file (written by scripts/install-profile.mjs) defines every
// row, so rewriting the row's `name:` line there rebinds it — provided the copy sits at the SAME
// DEPTH the plugin was built for, so its relative adapter import still resolves.
//
// The lane: copy the built workmate plugin into a deep sandbox path, strip `ok` from BOTH mutation
// schemas (= the pre-t15 shape, reproduces the defect byte-for-byte), inject a marker log, point the
// composed patch's workmate row at the copy, boot, and report:
//   - whether the MARKER appears (proof the mutated copy really was the live module)
//   - whether the tool calls report `returned invalid output: "value.ok" ...`
//
// Usage: node prefix-lane.mjs        (writes prefix-lane.{log,json} next to this file)
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = "/root/dshProj/my-power-dsh"
const transcript = []
const log = (line) => { transcript.push(line); console.log(line) }

const sandbox = join(ROOT, ".mpd", "t15-sb-prefix")
const dshHome = join(sandbox, "dsh-home")
const userHome = join(sandbox, "user-home")
const ws = join(sandbox, "ws")
mkdirSync(ws, { recursive: true })
log("=== t15 pre-fix real-boot lane ===")
log("sandbox=" + sandbox)

// ── 1) the profile whose COMPOSED patch defines every row (the dev flow, not an overlay) ─────────
const install = spawnSync(process.execPath, [join(ROOT, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", dshHome, "--profile", "mpd-headless", "--skip-toolchain"], {
  env: { ...process.env, DSH_HOME: dshHome, HOME: userHome }, cwd: ROOT, encoding: "utf8", timeout: 900000,
})
log("[install] exit=" + install.status)
if (install.status !== 0) { log(String(install.stdout ?? "").slice(-800)); process.exit(1) }
const patchPath = join(dshHome, "cordis.patch.yml")
if (!existsSync(patchPath)) { log("FATAL: no composed patch at " + patchPath); process.exit(1) }
let patch = readFileSync(patchPath, "utf8")
const rowMatch = patch.match(/^ {2}- id: mpd-workmate\n(?: {4,}[^\n]*\n)*/m)
log("[patch] rows composed: " + (patch.match(/^ {2}- id: /gm) ?? []).length + "; workmate row found: " + (rowMatch !== null))
if (rowMatch === null) process.exit(1)
log("[patch] workmate row name: " + (rowMatch[0].match(/name:\s*(.+)/) ?? [])[1])
const originalRow = rowMatch[0]

// ── 2) the mutated copy, at the depth the plugin was built for ───────────────────────────────────
// The built plugin imports the adapter by a relative path four levels below the package root, so a
// copy that is not at that depth fails to import and the plugin never mounts — which would make this
// lane pass while exercising nothing (the exact false-green t3 walked into).
const outer = join(ROOT, ".mpd", "t15-outer", "t15-inner")
cpSync(join(ROOT, "packages", "mpd-workmate-plugin"), join(outer, "packages", "mpd-workmate-plugin"), { recursive: true })
// The adapter sits next to it, two levels up in the same tree, exactly as the real layout has it.
mkdirSync(join(outer, "..", "packages", "mpd-dsh-adapter-plugin", "dist"), { recursive: true })
writeFileSync(
  join(outer, "..", "packages", "mpd-dsh-adapter-plugin", "dist", "index.js"),
  'export * from "' + join(ROOT, "packages", "mpd-dsh-adapter-plugin", "dist", "index.js") + '"\n',
)
const copyPath = join(outer, "packages", "mpd-workmate-plugin", "dist", "index.js")
let source = readFileSync(copyPath, "utf8")
const before = (source.match(/ok: \{ type: "boolean" \}, /g) ?? []).length
const CORRUPT = process.argv.includes("--corrupt-schema")
// Strip BOTH halves of the repair: the property declaration AND its `required` entry.
source = source.replace(/ok: \{ type: "boolean" \}, /g, "")
source = source.replace(/required: \["ok", /g, "required: [")
if (CORRUPT) {
  // Deliberately leave `"ok"` named in `required` with no matching property: the harness refuses such
  // a schema at REGISTRATION, so a boot that only reaches registration is enough to prove WHICH module
  // is live. That is the marker substitute that works even when the tool calls cannot run.
  source = readFileSync(copyPath, "utf8").replace(/ok: \{ type: "boolean" \}, /g, "")
}
const okLeftovers = (source.match(/"ok"/g) ?? []).length
const after = (source.match(/ok: \{ type: "boolean" \}, /g) ?? []).length
source = source.replace("export function apply(ctx)", 'export function apply(ctx)\n  console.error("[t15-prefix] MUTATED-COPY LOADED (pre-repair schemas, ok stripped: ' + before + "->" + after + ')")')
writeFileSync(copyPath, source)
log("[copy] ok declarations stripped: " + before + " -> " + after + "; \"ok\" strings left in the copy: " + okLeftovers + (CORRUPT ? " (CORRUPT MODE: registration-rejection lane, by design)" : " (must be 0, required must not name a missing property)"))

// ── 3) rebind the row by REWRITING it in the composed patch (the dev-flow mechanism) ─────────────
patch = patch.replace(originalRow, originalRow.replace(/^( {4}name:).*$/m, '$1 "' + copyPath + '"'))
writeFileSync(patchPath, patch)
log("[patch] workmate row rebound to the mutated copy")

// ── 4) the probe: valid-input calls that must reach the validator ────────────────────────────────
const probePath = join(HERE, "probe.mjs")
writeFileSync(patchPath, patch + ["", "- id: mpd-t15-probe", "  name: '" + probePath + "'", ""].join("\n"))

const credentials = join(homedir(), ".dsh", ".credentials.yaml")
if (existsSync(credentials)) cpSync(credentials, join(dshHome, ".credentials.yaml"))
const settings = join(homedir(), ".dsh", "settings.yaml")
if (existsSync(settings)) cpSync(settings, join(dshHome, "settings.yaml"))

const bootLog = join(HERE, "prefix-lane.log")
const fd = openSync(bootLog, "w")
const boot = spawnSync("dsh", ["--profile", "mpd-headless", "noop"], {
  env: { ...process.env, DSH_HOME: dshHome, HOME: userHome }, cwd: ws, stdio: ["ignore", fd, fd], timeout: 300000,
})
const text = existsSync(bootLog) ? readFileSync(bootLog, "utf8") : ""
log("[boot] exit=" + boot.status + " (killed at the cap is normal for a live profile)")
const markerPresent = text.includes("[t15-prefix] MUTATED-COPY LOADED")
const resultLine = text.match(/\[t15-probe\] RESULT=(\{.*\})/s)
const probe = resultLine ? JSON.parse(resultLine[1]) : null
const stepOf = (id) => (probe?.steps ?? []).find((s) => s.id === id)
const invalid = (r) => typeof r?.error === "string" && r.error.includes("returned invalid output")
const registrationRejected = /failed to apply loader entry mpd-workmate/.test(text) && text.includes(copyPath)
const checks = {
  marker_proves_the_mutated_copy_was_live: markerPresent || registrationRejected,
  probe_ran: probe !== null,
  pre_fix_rename_rejected_by_the_validator: invalid(stepOf("tool.rename")),
  pre_fix_archive_rejected_by_the_validator: invalid(stepOf("tool.delete.archive")),
  pre_fix_purge_rejected_by_the_validator: invalid(stepOf("tool.delete.purge")),
  mutation_applied_despite_the_rejection: stepOf("state.after-rename")?.oldKey === null,
}
for (const [name, ok] of Object.entries(checks)) log((ok ? "PASS " : "FAIL ") + name)
if (probe) {
  log("rename error: " + String(stepOf("tool.rename")?.error))
  log("archive error: " + String(stepOf("tool.delete.archive")?.error))
  log("purge error: " + String(stepOf("tool.delete.purge")?.error))
}
if (CORRUPT) log("registration rejection names the COPY as the live row: " + registrationRejected)
writeFileSync(join(HERE, "prefix-lane.json"), JSON.stringify({ lane: "pre-fix real boot (pre-repair schemas mounted as the live row)", sandbox, markerPresent, checks, probe, transcript }, null, 2))
log("=== pre-fix lane: " + (Object.values(checks).every(Boolean) ? "PASS" : "FAIL") + " ===")
process.exit(Object.values(checks).every(Boolean) ? 0 : 1)
