#!/usr/bin/env node
// cross-layer-defaults.mjs — the T-18 / T-48-D3 three-layer defaults check.
//
// WHY THIS EXISTS: the watchdog's knob defaults are declared THREE times, in three different
// notations, and only one of them is a runtime source of truth:
//   1. plugin defaults  — packages/mpd-team-watchdog-plugin/src/machine.ts  (WATCHDOG_DEFAULTS)
//   2. namespace schema — packages/mpd-config-plugin/src/settings-schema.ts  (SettingsSchema.watchdog)
//   3. bundle row       — packages/mpd-bundle/cordis.patch.yml               (mpd-team-watchdog config)
// A mismatch is invisible at boot (schemastery keeps unknown keys and the row value simply wins or
// loses) and the measured T-18 incident was exactly that class: the value a user wrote never reached
// the running process. This checker reads all three files and reports them SIDE BY SIDE against the
// frozen §3 table, so a drift is a loud non-zero exit rather than a silent behaviour difference.
//
// Usage:
//   node cross-layer-defaults.mjs [--root <dir>] [--json] [--expect-fail]
// Exit 0 iff every layer declares every §3 knob with the §3 value. `--expect-fail` inverts the exit
// code, which is how the negative control (one mutated layer in a scratch root) proves the check can
// actually go red.
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const EXPECTED = {
  warnSilenceMs: 600000,
  tickIntervalMs: 15000,
  warnStreakToEscalate: 6,
  actionOnEscalate: "warn-only",
  toolInFlightMaxMs: 900000,
  holdTtlMs: 900000,
}

const REL = {
  machine: "packages/mpd-team-watchdog-plugin/src/machine.ts",
  schema: "packages/mpd-config-plugin/src/settings-schema.ts",
  row: "packages/mpd-bundle/cordis.patch.yml",
}

function parseArgs(argv) {
  const out = { root: process.cwd(), json: false, expectFail: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--root") out.root = resolve(argv[++i])
    else if (arg === "--json") out.json = true
    else if (arg === "--expect-fail") out.expectFail = true
  }
  return out
}

function read(root, key) {
  return readFileSync(join(root, REL[key]), "utf8")
}

/** `600_000` -> 600000, `"warn-only"` -> warn-only, `true` -> true. */
function literal(raw) {
  const text = String(raw).trim().replace(/,$/, "").trim()
  if (/^["'].*["']$/.test(text)) return text.slice(1, -1)
  if (text === "true" || text === "false") return text === "true"
  if (/^-?[\d_]+$/.test(text)) return Number(text.replace(/_/g, ""))
  return text
}

/** Extract the body of `export const WATCHDOG_DEFAULTS: WatchdogKnobs = { ... }`. */
function parseMachine(src) {
  const start = src.indexOf("export const WATCHDOG_DEFAULTS")
  if (start < 0) throw new Error("WATCHDOG_DEFAULTS not found in machine.ts")
  const open = src.indexOf("{", start)
  const end = src.indexOf("\n}", open)
  if (open < 0 || end < 0) throw new Error("WATCHDOG_DEFAULTS block is not closed")
  const body = src.slice(open + 1, end)
  const found = {}
  for (const line of body.split("\n")) {
    if (/^\s*\/\//.test(line) || line.trim() === "") continue
    const m = line.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*(.+?)\s*,?\s*$/)
    if (m) found[m[1]] = literal(m[2])
  }
  return found
}

/** Extract `watchdog: z.object({ ... })` defaults from the settings schema. */
function parseSchema(src) {
  const start = src.indexOf("watchdog: z.object({")
  if (start < 0) throw new Error("watchdog: z.object block not found in settings-schema.ts")
  const end = src.indexOf("}),", start)
  if (end < 0) throw new Error("watchdog: z.object block is not closed")
  const body = src.slice(start, end)
  const found = {}
  for (const line of body.split("\n")) {
    if (/^\s*\/\//.test(line) || line.trim() === "") continue
    const m = line.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:.*?\.default\((.+?)\)\s*,?\s*$/)
    if (m) found[m[1]] = literal(m[2])
  }
  return found
}

/** Extract the `mpd-team-watchdog` row's `config:` block from the bundle patch. */
function parseRow(src) {
  const lines = src.split("\n")
  const start = lines.findIndex((line) => /^\s*- id: mpd-team-watchdog\s*$/.test(line))
  if (start < 0) throw new Error("mpd-team-watchdog row not found in cordis.patch.yml")
  const found = {}
  let inConfig = false
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*- id: /.test(line)) break
    if (/^\s*config:\s*$/.test(line)) {
      inConfig = true
      continue
    }
    if (!inConfig) continue
    if (/^\s*#/.test(line) || line.trim() === "") continue
    const m = line.match(/^\s+([A-Za-z][A-Za-z0-9]*)\s*:\s*(.+?)\s*$/)
    if (m) found[m[1]] = literal(m[2])
  }
  return found
}

function compare(layers) {
  const rows = []
  let ok = true
  for (const knob of Object.keys(EXPECTED)) {
    const values = Object.fromEntries(Object.entries(layers).map(([name, found]) => [name, found[knob]]))
    const agrees = Object.values(values).every((value) => value === EXPECTED[knob])
    if (!agrees) ok = false
    rows.push({ knob, expected: EXPECTED[knob], ...values, agrees })
  }
  return { ok, rows }
}

const args = parseArgs(process.argv.slice(2))
const layers = {
  "machine.ts": parseMachine(read(args.root, "machine")),
  "settings-schema.ts": parseSchema(read(args.root, "schema")),
  "cordis.patch.yml": parseRow(read(args.root, "row")),
}
const { ok, rows } = compare(layers)
const failedRows = rows.filter((row) => !row.agrees)

if (args.json) {
  process.stdout.write(
    JSON.stringify(
      {
        root: args.root,
        expected: EXPECTED,
        layers,
        comparison: rows,
        verdict: ok ? "PASS" : "FAIL",
        mismatches: failedRows.map((row) => row.knob),
      },
      null,
      2,
    ) + "\n",
  )
} else {
  console.log("[cross-layer-defaults] root=" + args.root)
  const head = ["knob".padEnd(22), "machine.ts".padEnd(14), "settings-schema".padEnd(16), "cordis row".padEnd(14), "§3".padEnd(14), "verdict"].join(" | ")
  console.log(head)
  console.log("-".repeat(head.length))
  for (const row of rows) {
    console.log(
      [
        row.knob.padEnd(22),
        String(row["machine.ts"]).padEnd(14),
        String(row["settings-schema.ts"]).padEnd(16),
        String(row["cordis.patch.yml"]).padEnd(14),
        String(row.expected).padEnd(14),
        row.agrees ? "ok" : "MISMATCH",
      ].join(" | "),
    )
  }
  console.log("[cross-layer-defaults] verdict=" + (ok ? "PASS" : "FAIL") + " mismatches=" + failedRows.map((row) => row.knob).join(","))
}

const exitCode = args.expectFail ? (ok ? 1 : 0) : ok ? 0 : 1
process.exit(exitCode)
