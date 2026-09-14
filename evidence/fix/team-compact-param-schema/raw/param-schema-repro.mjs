#!/usr/bin/env node
// Defect driver: `mpd_team_compact_run` (and its sibling `mpd_team_compact_status`)
// declared a BARE property map as the tool `parameters`:
//     parameters: { team_id: { type: "string", description: "..." } }
// The adapter forwards `parameters` VERBATIM — `definition.parameters ?? OBJECT_SCHEMA`
// (packages/mpd-dsh-adapter-plugin/src/index.ts:433) only defaults a schema when the field
// is ABSENT — and the harness's raw `register()` path does NOT validate parameters (unlike
// its `defineTool`, which compiles a property map into `type: "object"`). The result was a
// registered tool whose model-facing schema carries no object root at all, so the provider
// rejected EVERY model request of a session mounting the row with the reported error:
//   Invalid schema for function 'mpd_team_compact_run': schema must be a JSON Schema of
//   'type: "object"', got 'type: null'
//
// What this driver measures — a REAL mounted boot, in an isolated DSH_HOME + sandbox HOME +
// sandbox workspace, through the dev-flavor bundle patch (the same rewrite
// `skills/dsh-qa/scripts/preset-register.mjs` uses: rows -> checkout-absolute paths, NO
// install step) with the QA roles probe mounted as registration instrumentation:
//   * the LIVE registry's model-facing projection of every mpd_*/agent_teams_* tool
//     (`tools.schemas()`) is read by the probe and printed as TOOL_PARAM_SCHEMAS;
//   * this driver applies the REPORTED PROVIDER RULE to that measurement — every function
//     schema must be object-rooted — and composes the provider message it implies.
//
// `--dump-config` cannot see any of this (composition only, AGENTS.md §4), and neither can
// a source-level unit test: only the live registry knows what was registered.
//
//   --expect-bad   RED  mode: the compact tools MUST be flagged with a non-object root and
//                  the composed provider message MUST equal the reported one
//   (default)      GREEN mode: every tool MUST be object-rooted, no BAD entry, probe PASS
//
// NOTE ON SCOPE (honest limits): this sandbox has no provider credential (`~/.dsh` holds
// only the browser-session grant) and blocks loopback connections from spawned children
// (measured: a parent HTTP listener is never reached by a child process), so a live
// provider round-trip cannot be driven here. The provider-side rejection is therefore
// anchored on (a) the reported error text and (b) the measured schema that composes it.
//
// Usage: node evidence/fix/team-compact-param-schema/raw/param-schema-repro.mjs [--expect-bad]
// Evidence -> evidence/fix/team-compact-param-schema/<ts>/{result.json,output.log}
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))))
const PRESETS_DIR = join(repoRoot, "presets")
const PROBE = join(repoRoot, "packages", "mpd-qa-roles-probe", "dist", "index.js")
const PACKED_PRESETS_EXPR = '"/node_modules/@mpd-dsh/mpd/presets"'
const BASEURL_PREFIX = '(typeof baseUrl === "string" ? baseUrl.replace(/^file:\\/\\//, "").replace(/\\/+$/, "") : "") + '
const COMPACT_TOOLS = ["mpd_team_compact_run", "mpd_team_compact_status"]
/** The reported provider error, verbatim (the symptom this defect produced). */
const REPORTED = "Invalid schema for function 'mpd_team_compact_run': schema must be a JSON Schema of 'type: \"object\"', got 'type: null'"

// The reported provider rule, applied to a measured schema type.
function providerMessage(name, type) {
  const got = type === undefined || type === null || type === "null" ? "null" : JSON.stringify(type)
  return `Invalid schema for function '${name}': schema must be a JSON Schema of 'type: "object"', got 'type: ${got}'`
}

// Verbatim dev-flavor rewrite of the committed bundle patch (preset-register.mjs).
function devPatch() {
  const t = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  return t
    .split(PACKED_PRESETS_EXPR).join(JSON.stringify(PRESETS_DIR))
    .split(BASEURL_PREFIX).join("")
    .split('"/node_modules/@mpd-dsh/mpd/').join('"' + repoRoot + "/")
    .split("name: '@mpd-dsh/mpd'").join("name: '" + join(repoRoot, "packages", "mpd-bundle-plugin", "dist", "index.js") + "'")
    .split("@mpd-dsh/mpd/").join(repoRoot + "/")
}

function main() {
  const expectBad = process.argv.includes("--expect-bad")
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[param-schema-repro] missing credentials"); process.exit(1) }
  // The sandbox lives INSIDE the ignored scratch root so a failed run stays inspectable
  // (each bash call gets a fresh /tmp — AGENTS.md §12) without dirtying the tracked tree.
  const sandbox = join(repoRoot, ".qa-reloc", "team-compact-param-schema", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(sandbox, { recursive: true })
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  const ws = join(sandbox, "ws")
  const home = join(sandbox, "home")
  mkdirSync(ws, { recursive: true })
  mkdirSync(home, { recursive: true })

  const bundlePatch = join(sandbox, "bundle.dev.patch.yml")
  writeFileSync(bundlePatch, devPatch())
  const presetsOverlay = join(sandbox, "agent-presets-headless.yml")
  writeFileSync(presetsOverlay, readFileSync(join(repoRoot, "tests/overlays/agent-presets-headless.yml"), "utf8").split("{{PRESETS}}").join(PRESETS_DIR))
  const probeOverlay = join(sandbox, "roles-probe.yml")
  writeFileSync(probeOverlay, readFileSync(join(repoRoot, "tests/overlays/roles-probe.yml"), "utf8").split("{{PROBE}}").join(PROBE))

  const logFile = join(sandbox, "run.log")
  const fd = openSync(logFile, "w")
  const env = { ...process.env, DSH_HOME: sandbox, HOME: home }
  let run
  try {
    run = spawnSync("dsh", [
      "--profile", "headless",
      "--patch", bundlePatch,
      "--patch", presetsOverlay,
      "--patch", probeOverlay,
      "Reply with exactly: schema-ok",
    ], { env, cwd: ws, encoding: "utf8", timeout: 300000, stdio: ["ignore", fd, fd] })
  } finally {
    closeSync(fd)
  }
  const out = readFileSync(logFile, "utf8")

  // Parse the probe's live-registry reading.
  const line = /\[roles-probe\] TOOL_PARAM_SCHEMAS=([^\n]*)/.exec(out)?.[1] ?? null
  const counts = /^(\d+)\/(\d+)/.exec(line ?? "")
  const checked = counts === null ? null : Number(counts[1])
  const total = counts === null ? null : Number(counts[2])
  const bad = (/(?:^|\s)BAD=([^\n]*)/.exec(line ?? "")?.[1] ?? "").split(",").filter((s) => s !== "")
    .map((entry) => { const [name, type] = entry.split(":type="); return { name, type: type ?? "null" } })
  const compactBad = bad.filter((b) => COMPACT_TOOLS.includes(b.name))
  const registered = /TEAM_COMPACT_TOOLS=(\d+)\/(\d+)/.exec(out)
  const probePass = /roles-probe\] PASS/.test(out)
  // The provider message the measured schema composes (RED) / would have composed.
  const composed = compactBad.map((b) => providerMessage(b.name, b.type))

  const steps = {
    mountedBoot: { ok: registered !== null, exit: run.status, registered: registered?.[0] ?? null },
    probeReadLiveRegistry: { ok: line !== null, line },
  }
  if (expectBad) {
    steps.compactToolsFlagged = { ok: compactBad.length === COMPACT_TOOLS.length, flagged: compactBad }
    steps.composesReportedError = { ok: composed.includes(REPORTED), composed }
    steps.probeVerdict = { ok: !probePass, note: "RED mode: the probe's own PASS verdict is already withheld" }
  } else {
    steps.allToolsObjectRooted = { ok: checked === total && total > 0 && bad.length === 0, checked, total, bad }
    steps.compactToolsPresent = { ok: registered !== null && registered[1] === registered[2], line: registered?.[0] ?? null }
    steps.probePass = { ok: probePass }
  }
  const ok = Object.values(steps).every((s) => s.ok)
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "fix", "team-compact-param-schema", ts)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({
    ok, mode: expectBad ? "RED-expect-bad" : "GREEN", sandbox, exit: run.status,
    providerRule: "every model-facing function schema must be object-rooted (the reported provider rule)",
    reportedError: REPORTED,
    hashes: {
      pluginSrc: sha256(join(repoRoot, "packages", "mpd-team-compact-plugin", "src", "index.ts")),
      pluginDist: sha256(join(repoRoot, "packages", "mpd-team-compact-plugin", "dist", "index.js")),
      probeDist: sha256(PROBE),
    },
    steps,
  }, null, 2))
  writeFileSync(join(outDir, "output.log"), out.slice(0, 200000))
  console.log("[param-schema-repro] mode=" + (expectBad ? "RED" : "GREEN") + " ok=" + ok + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 300))
  if (!ok) process.exit(1)
  console.log("[param-schema-repro] PASS (" + (expectBad ? "defect reproduced in the live registry" : "defect absent in the live registry") + ")")
}

// Verdicts anchor on the hashes they were measured on (AGENTS.md §7).
function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16)
}

main()
