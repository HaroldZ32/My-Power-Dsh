#!/usr/bin/env node
// t10 INDEPENDENT verification — healthy-path invariance + template non-discovery, measured by
// the VERIFIER on a boot the verifier ran itself.
//
// Inputs are two REAL mounted-boot artifacts of the bundle-lifecycle lane:
//   BEFORE  evidence/dsh-qa/bundle-lifecycle/2026-09-16T02-55-38.803Z/  (pre-change, committed)
//   AFTER   a boot this verifier started itself in this session
// Everything below is a reading over those files; nothing is taken from an author's transcript.
//
// What it asserts:
//   · AFTER carries `adapterIdentity=mounted:mpdDsh` on BOTH rows and ZERO fallback markers;
//   · the four inspection tools are in the AFTER mpd-ext line;
//   · the AFTER mpd-ext line with the ONE inserted `adapterIdentity=` field removed is
//     BYTE-IDENTICAL to the BEFORE line (so healthy behaviour did not drift);
//   · the discovery-derived `skill providers:` list is identical before and after;
//   · the lane's per-step ok flags are identical before and after;
//   · the template is NOT discovered: no boot-log line mentions the template id, and the
//     discovered extension set is the same as BEFORE.
//
// Usage: node invariance-and-discovery.mjs <beforeDir> <afterDir> [--json-out <path>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

const PREFIX = "[t10-invariance]"
const [beforeDir, afterDir] = process.argv.slice(2)
if (!beforeDir || !afterDir) {
  console.error(PREFIX + " usage: node invariance-and-discovery.mjs <beforeDir> <afterDir> [--json-out <path>]")
  process.exit(2)
}

const TEMPLATE_ID = "mpd-extension-template"
const TOOLS = ["mpd_ext_list", "mpd_ext_show", "mpd_flow_list", "mpd_flow_show"]

const readText = (p) => readFileSync(p, "utf8")
const lines = (t) => t.split(/\r?\n/).filter((l) => l.trim().length > 0)
const rowLine = (text, tag) => lines(text).find((l) => l.startsWith(tag) && l.includes(" provided"))
const providersOf = (line) => (/skill providers: ([^|]+)/.exec(String(line)) ?? [])[1]?.trim() ?? null
const stripIdentity = (line) => String(line).replace(/\s*\|\s*adapterIdentity=[^\s|]+/, "")

const checks = []
const check = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) })

const beforeBoot = readText(resolve(beforeDir, "boot.log"))
const afterBoot = readText(resolve(afterDir, "boot.log"))
const beforeResult = JSON.parse(readText(resolve(beforeDir, "result.json")))
const afterResult = JSON.parse(readText(resolve(afterDir, "result.json")))

const beforeExt = rowLine(beforeBoot, "[mpd-ext]")
const afterExt = rowLine(afterBoot, "[mpd-ext]")
const afterRoles = rowLine(afterBoot, "[mpd-roles]")

// --- the F1 fix, on a boot the verifier ran ------------------------------------------------
check("after.ext-identity-line-present", afterExt !== undefined, afterExt ?? "(absent)")
check("after.roles-identity-line-present", afterRoles !== undefined, afterRoles ?? "(absent)")
check("after.ext-identity-is-mounted", String(afterExt).includes("adapterIdentity=mounted:mpdDsh"), String(afterExt))
check("after.roles-identity-is-mounted", String(afterRoles).includes("adapterIdentity=mounted:mpdDsh"), String(afterRoles))
const fallbackMarkers = lines(afterBoot).filter((l) => l.includes("ADAPTER FALLBACK"))
const fallbackIdentities = lines(afterBoot).filter((l) => l.includes("adapterIdentity=fallback:"))
check("after.no-fallback-warning", fallbackMarkers.length === 0, "ADAPTER FALLBACK lines: " + fallbackMarkers.length)
check("after.no-fallback-identity", fallbackIdentities.length === 0, "fallback identity lines: " + fallbackIdentities.length)

// --- the four inspection tools --------------------------------------------------------------
const missingTools = TOOLS.filter((t) => !String(afterExt).includes(t))
check("after.four-inspection-tools", missingTools.length === 0, "missing: " + JSON.stringify(missingTools))

// --- healthy-path invariance vs the genuinely pre-change boot -------------------------------
check("before.is-pre-change", beforeExt !== undefined && !String(beforeExt).includes("adapterIdentity="), "before line has no identity field: " + !String(beforeExt).includes("adapterIdentity="))
check(
  "invariance.ext-line-otherwise-byte-identical",
  beforeExt !== undefined && afterExt !== undefined && stripIdentity(afterExt) === beforeExt,
  JSON.stringify({ before: beforeExt, afterWithoutIdentity: stripIdentity(String(afterExt)), equal: stripIdentity(String(afterExt)) === beforeExt })
)
check(
  "invariance.discovery-providers-identical",
  providersOf(beforeExt) !== null && providersOf(beforeExt) === providersOf(afterExt),
  JSON.stringify({ before: providersOf(beforeExt), after: providersOf(afterExt) })
)

// The lane's per-step ok flags. NOTE: the steps are nested under `steps` — a first version of
// this checker read the TOP-LEVEL keys, produced two empty arrays and reported both checks as
// PASS, i.e. it compared nothing. Measured trap, fixed here and bounded by the
// `invariance.step-subjects-nonzero` guard below so an empty read can never pass again.
const stepFlags = (r) => Object.entries(r?.steps ?? {}).filter(([, v]) => v && typeof v === "object" && "ok" in v).map(([k, v]) => k + "=" + v.ok).sort()
const beforeSteps = stepFlags(beforeResult)
const afterSteps = stepFlags(afterResult)
check("invariance.step-subjects-nonzero", beforeSteps.length > 0 && afterSteps.length > 0, JSON.stringify({ before: beforeSteps.length, after: afterSteps.length }))
check("invariance.lane-step-ok-flags-identical", JSON.stringify(beforeSteps) === JSON.stringify(afterSteps), JSON.stringify({ before: beforeSteps, after: afterSteps }))
check("after.lane-every-step-ok", afterSteps.length > 0 && afterSteps.every((s) => s.endsWith("=true")), JSON.stringify(afterSteps))
const seamsBefore = beforeResult?.steps?.boot?.adapterSeams ?? null
const seamsAfter = afterResult?.steps?.boot?.adapterSeams ?? null
check("invariance.adapter-seams-identical", seamsBefore !== null && seamsBefore === seamsAfter, JSON.stringify({ before: seamsBefore, after: seamsAfter }))

// --- template non-discovery -----------------------------------------------------------------
check("discovery.no-template-line-in-boot", !afterBoot.includes(TEMPLATE_ID), "boot log mentions " + TEMPLATE_ID + ": " + afterBoot.includes(TEMPLATE_ID))
check("discovery.provider-set-unchanged", providersOf(beforeExt) === providersOf(afterExt), JSON.stringify({ before: providersOf(beforeExt), after: providersOf(afterExt) }))
check("discovery.template-not-in-providers", !String(providersOf(afterExt)).includes("template"), String(providersOf(afterExt)))

for (const c of checks) console.log(PREFIX + " " + (c.ok ? "PASS" : "FAIL") + " " + c.id + " :: " + c.detail)
const failed = checks.filter((c) => !c.ok)
console.log(PREFIX + " " + (failed.length === 0 ? "PASS" : "FAIL") + ": " + (checks.length - failed.length) + "/" + checks.length + " checks")

const outIdx = process.argv.indexOf("--json-out")
if (outIdx >= 0) {
  const out = resolve(process.argv[outIdx + 1])
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify({
    driver: "invariance-and-discovery.mjs",
    beforeDir, afterDir,
    readings: {
      beforeExtLine: beforeExt ?? null, afterExtLine: afterExt ?? null, afterRolesLine: afterRoles ?? null,
      afterWithoutIdentity: stripIdentity(String(afterExt)),
      fallbackWarningLines: fallbackMarkers.length, fallbackIdentityLines: fallbackIdentities.length,
      providersBefore: providersOf(beforeExt), providersAfter: providersOf(afterExt),
      laneStepsBefore: beforeSteps, laneStepsAfter: afterSteps,
      templateMentionedInBoot: afterBoot.includes(TEMPLATE_ID)
    },
    checks
  }, null, 2) + "\n")
  console.log(PREFIX + " raw readings written to " + out)
}
process.exit(failed.length === 0 ? 0 : 1)
