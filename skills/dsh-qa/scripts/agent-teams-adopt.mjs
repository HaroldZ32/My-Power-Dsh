#!/usr/bin/env node
// Case agent-teams-adopt — RETIRED to a PROVENANCE case (2026-09-27, decision D5).
//
// WHAT THIS CASE USED TO PROVE, AND WHY IT CANNOT ANY MORE: it adopted
// `@nanmicoder/dsh-agent-teams` into an isolated home through `scripts/install-profile.mjs`
// and then proved end-to-end that (1) the installer wrote the bundle dependency + the
// `stateDir` override, (2) the composed config contained the `agent-teams` row, (3) a real
// headless run created `.mpd/team` state with a task DAG and archived the team on delete,
// and (4) the web profile served `/plugins/dsh-agent-teams/state`.
//
// The vendored body is RETIRED from the composition (AGENTS.md §1): NO loader row mounts
// it, so every one of those four claims is about a plugin that no shipped session reaches.
// They are DROPPED, and they are named here rather than deleted silently:
//   * the `agent-teams` row + its `stateDir` override — the row is gone from the bundle
//     patch AND from the legacy installer;
//   * the composed `agent-teams` row — nothing composes it;
//   * the live headless team run / `.mpd/team` team.json / archive-on-delete — team state
//     now lives in the LEAD'S SESSION LOG, owned by the official
//     `@deepseek-ai/dsh-experimental-agent-team` plugin, and NOTHING in this repository
//     asserts that live path;
//   * the `/plugins/dsh-agent-teams/state` snapshot route — it retired with the plugin's
//     server half; the official `mpd-ui-agent-team` row owns the roster/board UI.
//
// WHAT IT STILL PROVES, AND WHY THAT IS WORTH KEEPING: the adopted code is RETAINED on
// disk (not deleted — AGENTS.md §1 keeps it so the D6 adapter gate and the delta registry
// stay meaningful), and retained third-party code carries a LICENCE/ATTRIBUTION obligation
// that must not rot while the code sits there. `LICENSE-NOTICES.md` is the authoritative
// record (§1), and the naming exception it rests on is a manual sentence (§1). This case is
// the ONLY executable check of that pair, so it is rebased rather than removed:
//   * the MIT notice block, its copyright line and the adopted `LICENSE` copy exist;
//   * the adopted package still carries its pinned version and its `_deps` closure;
//   * `AGENTS.md` still states the naming exception the attribution depends on;
//   * and the body is REALLY unmounted — the bundle patch declares no `agent-teams` row —
//     so a reader can never mistake retained code for shipped code.
//
// Offline by construction: provenance is a fact about files, so there is nothing to boot.
// The default (no-argument) run performs the SAME audit, so the lane stays runnable in
// `bun run test:qa:all`; `--self-test` adds a negative control that must redden.
// Never touches the real ~/.dsh.
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const ADOPTED = join("packages", "mpd-agent-teams-plugin")
const NOTICE_LINE = "Copyright (c) 2026 程序员阿江(Relakkes)"
const MIT_MARKER = "dsh-agent-teams (MIT)"
const AGENTS_EXCEPTION = "Adopted plugins keep their plugin ids and tool names"
const PINNED_VERSION = "0.1.16-rc.3-mpd"

function fail(msg) { console.error("[agent-teams-adopt] FAIL: " + msg); process.exit(1) }

/** Every input the audit reads, so the negative control can drive ONE seam. */
function readSources() {
  return {
    notices: readFileSync(join(repoRoot, "LICENSE-NOTICES.md"), "utf8"),
    agents: readFileSync(join(repoRoot, "AGENTS.md"), "utf8"),
    patch: readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8"),
    licenseExists: existsSync(join(repoRoot, ADOPTED, "LICENSE")),
    depsExist: existsSync(join(repoRoot, ADOPTED, "_deps", "schemastery", "lib", "index.mjs")),
    version: (() => {
      try { return JSON.parse(readFileSync(join(repoRoot, ADOPTED, "package.json"), "utf8")).version } catch { return null }
    })(),
  }
}

/**
 * The provenance + retirement audit. Pure over `sources`, so `--self-test` drives a
 * MUTATED copy through this same function and proves the audit can fail.
 * @returns {string[]} problems (empty = conforms)
 */
export function auditProvenance(sources) {
  const problems = []
  if (!sources.notices.includes(MIT_MARKER)) problems.push("LICENSE-NOTICES.md no longer carries the `" + MIT_MARKER + "` attribution block for the retained adopted body")
  if (!sources.notices.includes(NOTICE_LINE)) problems.push("LICENSE-NOTICES.md lost the copyright line " + JSON.stringify(NOTICE_LINE))
  if (!sources.licenseExists) problems.push("the adopted " + ADOPTED + "/LICENSE copy is missing — the retained code ships without its licence")
  if (!sources.depsExist) problems.push("the adopted " + ADOPTED + "/_deps closure is missing — the retained body cannot resolve its runtime deps")
  if (sources.version !== PINNED_VERSION) problems.push("the adopted package version is not the pinned " + PINNED_VERSION + " (got " + JSON.stringify(sources.version) + ")")
  if (!sources.agents.includes(AGENTS_EXCEPTION)) problems.push("AGENTS.md no longer states the naming exception the attribution rests on: " + JSON.stringify(AGENTS_EXCEPTION))
  // The RETIREMENT half: retained must not read as shipped.
  if (/^\s*-?\s*id:\s*agent-teams\s*$/m.test(sources.patch)) problems.push("the bundle patch declares an `agent-teams` row again — the retirement (D5) was reverted")
  return problems
}

function report(problems) {
  if (problems.length === 0) return
  for (const problem of problems) console.error("  - " + problem)
  fail("the retained adopted body's provenance/retirement contract is violated (" + problems.length + " problem(s))")
}

const argv = process.argv.slice(2)
const sources = readSources()
if (argv.includes("--self-test")) {
  report(auditProvenance(sources))
  // NEGATIVE CONTROL: dropping the attribution block must REDDEN the same audit, and so
  // must a re-declared `agent-teams` row — a provenance case that cannot fail is a
  // paragraph, not an instrument.
  const controlLicence = auditProvenance({ ...sources, notices: sources.notices.split(MIT_MARKER).join("SOMETHING ELSE") })
  if (controlLicence.length === 0) fail("negative control: the audit passed with the MIT attribution block removed")
  const controlRow = auditProvenance({ ...sources, patch: sources.patch + "\n- insert:\n    - id: agent-teams\n      name: '@mpd-dsh/mpd/packages/mpd-agent-teams-plugin/lib/index.js'\n" })
  if (controlRow.length === 0) fail("negative control: the audit passed with an `agent-teams` row re-declared")
  console.log("[agent-teams-adopt self-test] ok: retained adopted body — MIT notice + copyright + LICENSE + pinned " + PINNED_VERSION
    + " + _deps closure + AGENTS.md naming exception, and NO `agent-teams` row in the bundle patch"
    + "; negative controls reddened (attribution removed " + controlLicence.length + ", row re-declared " + controlRow.length + " problem(s))")
} else {
  // The lane's real run: the audit IS the deliverable (provenance is a fact about files).
  report(auditProvenance(sources))
  console.log("[agent-teams-adopt] ok=true (offline provenance audit — the four live adoption guarantees retired with the plugin; see this file's header)")
  console.log("[agent-teams-adopt] PASS")
}
