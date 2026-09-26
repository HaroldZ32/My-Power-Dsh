#!/usr/bin/env node
// F1 evidence checker (t4).
//
// Reads the REAL mount lane's artifacts (bundle-lifecycle boot.log + result.json) and
// asserts the adapter-identity fix on them, never on prose:
//   · both rows report `adapterIdentity=mounted:mpdDsh` in the boot log;
//   · the fallback marker appears ZERO times in a healthy boot (no warning);
//   · the mpd-ext summary line still names all four tools, and its text is
//     byte-identical to the PRE-change boot log apart from the inserted identity field
//     (so "healthy behaviour unchanged" is a measured diff, not a claim);
//   · the lane's own step results are all ok and match the pre-change run.
//
// Usage: node check-boot-identity.mjs <beforeBootLog> <afterBootLog> <beforeResult> <afterResult> <outDir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [beforeBootLog, afterBootLog, beforeResult, afterResult, outDir] = process.argv.slice(2)
if (!outDir) {
  console.error("usage: node check-boot-identity.mjs <beforeBootLog> <afterBootLog> <beforeResult> <afterResult> <outDir>")
  process.exit(2)
}

const read = (path) => readFileSync(path, "utf8")
const lines = (text) => text.split("\n")

const before = read(beforeBootLog)
const after = read(afterBootLog)
const beforeRun = JSON.parse(read(beforeResult))
const afterRun = JSON.parse(read(afterResult))

const checks = []
const check = (id, ok, detail) => checks.push({ id, ok, detail })

const summaryLine = (text, tag) => lines(text).find((line) => line.startsWith(tag) && line.includes(" provided"))
const beforeExt = summaryLine(before, "[mpd-ext]")
const afterExt = summaryLine(after, "[mpd-ext]")
const afterRoles = summaryLine(after, "[mpd-roles]")

const TOOLS = ["mpd_ext_list", "mpd_ext_show", "mpd_flow_list", "mpd_flow_show"]

check("boot.mpdd-ext-identity-line-present", afterExt !== undefined, afterExt ?? "(absent)")
check("boot.mpd-roles-identity-line-present", afterRoles !== undefined, afterRoles ?? "(absent)")
check("boot.mpd-ext-identity-mounted", String(afterExt).includes("adapterIdentity=mounted:mpdDsh"), String(afterExt))
check("boot.mpd-roles-identity-mounted", String(afterRoles).includes("adapterIdentity=mounted:mpdDsh"), String(afterRoles))

const fallbackLines = lines(after).filter((line) => line.includes("ADAPTER FALLBACK"))
const fallbackIdentityLines = lines(after).filter((line) => line.includes("adapterIdentity=fallback:"))
check("boot.no-fallback-warning", fallbackLines.length === 0, "ADAPTER FALLBACK lines: " + fallbackLines.length)
check("boot.no-fallback-identity", fallbackIdentityLines.length === 0, "fallback identity lines: " + fallbackIdentityLines.length)

const missingTools = TOOLS.filter((name) => !String(afterExt).includes(name))
check("boot.four-inspection-tools-registered", missingTools.length === 0, "missing: " + JSON.stringify(missingTools))

// The pre-change line vs the post-change line: strip the NEW field from the after line and
// require the remainder to equal the before line exactly (one inserted field, nothing else).
const stripIdentity = (line) => String(line).replace(/\s*\|\s*adapterIdentity=[^\s|]+/, "")
check(
  "boot.mpd-ext-line-otherwise-byte-identical",
  beforeExt !== undefined && afterExt !== undefined && stripIdentity(afterExt) === beforeExt,
  JSON.stringify({ before: beforeExt, afterWithoutIdentity: stripIdentity(String(afterExt)) }),
)

// The discovery-derived provider list the boot logs (one provider per discovered extension
// that contributes skills/flows) must be unchanged.
const providers = (line) => (/skill providers: ([^|]+)/.exec(String(line)) ?? [])[1]?.trim()
check(
  "boot.discovery-providers-unchanged",
  providers(beforeExt) !== undefined && providers(beforeExt) === providers(afterExt),
  JSON.stringify({ before: providers(beforeExt), after: providers(afterExt) }),
)

// The lane's own recorded steps: identical ok-flags, all true, same adapter seam string.
const beforeSteps = beforeRun.steps ?? {}
const afterSteps = afterRun.steps ?? {}
const stepDiffs = Object.keys(beforeSteps).filter((name) => beforeSteps[name]?.ok !== afterSteps[name]?.ok)
const failedAfter = Object.keys(afterSteps).filter((name) => afterSteps[name]?.ok !== true)
check("lane.overall-ok", afterRun.ok === true, "after.ok=" + String(afterRun.ok))
check("lane.step-ok-flags-identical", stepDiffs.length === 0, "differing steps: " + JSON.stringify(stepDiffs))
check("lane.every-step-ok", failedAfter.length === 0, "failing steps: " + JSON.stringify(failedAfter))
check(
  "lane.adapter-seams-identical",
  beforeSteps.boot?.adapterSeams !== undefined && beforeSteps.boot.adapterSeams === afterSteps.boot?.adapterSeams,
  JSON.stringify({ before: beforeSteps.boot?.adapterSeams, after: afterSteps.boot?.adapterSeams }),
)
check("lane.boot-correct-adapter-probe", /ADAPTER_TOOL_CALL=ok/.test(after) && /roles-probe\] PASS/.test(after), "ADAPTER_TOOL_CALL=ok + roles-probe PASS present")

const ok = checks.every((entry) => entry.ok)
mkdirSync(outDir, { recursive: true })
writeFileSync(
  join(outDir, "result.json"),
  JSON.stringify(
    {
      ok,
      subject: "F1 adapter identity (mpd-ext + mpd-roles) on a real mounted boot",
      beforeBootLog,
      afterBootLog,
      beforeResult,
      afterResult,
      checks,
      readings: { extSummary: afterExt ?? null, rolesSummary: afterRoles ?? null, extSummaryBefore: beforeExt ?? null },
    },
    null,
    2,
  ) + "\n",
)
writeFileSync(
  join(outDir, "output.log"),
  [
    "checks:",
    ...checks.map((entry) => (entry.ok ? "  ok   " : "  FAIL ") + entry.id + " :: " + entry.detail),
    "",
    "after boot (identity lines):",
    "  " + String(afterExt),
    "  " + String(afterRoles),
    "",
    "before boot (same row):",
    "  " + String(beforeExt),
  ].join("\n") + "\n",
)
console.log("[f1-adapter-identity] ok=" + ok + " -> " + join(outDir, "result.json"))
for (const entry of checks) console.log("  " + (entry.ok ? "ok" : "FAIL") + " " + entry.id)
process.exit(ok ? 0 : 1)
