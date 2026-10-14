// Triage probe for item (C) (READ-ONLY outside the sandbox): does OUR mediated decision subscription
// actually reach the host's recording branch, and does the host's effect ledger record it?
//
// The host's own source (`lib/types/dsh-adapter/plugin-host.js#subscribeDecision`) records
//   { operation:'bind', resource:{kind:'decision-handler', id:`<componentId>:<event>`}, result:'applied' }
// on its registered path and a `permission`/PERMISSION_NOT_GRANTED record otherwise — but neither
// appears in this sandbox's ledger (928 records, all `command`@host and `status`@undeclared). This
// boot installs the SAME grant file the tui-admission lane installs and captures DSH_TUI_DEBUG stderr,
// so our own seam disclosure (`[mpd-tui] decision-event seam …`) is readable.
//
// Usage (repo root): bun evidence/tui/dsh-tui-015/triage-reds/probe-decision-seam.ts [sandbox-root]
import { mkdirSync, readFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseSandboxArgs, runTuiSession, sandboxEffectLedgerFile, sandboxGrantFile, writeExtensionGrants } from "../../../../skills/dsh-qa/scripts/lib/tui-lane.ts"

/** The sandbox root to boot in; the frozen driver's root by default. */
const root = process.argv[2] ?? ".mpd/recon/qa/tui-lanes/tui-015"
/** Where this probe's panes and stderr go. */
// ABSOLUTE on purpose: the boot command types a shell redirection into a pane whose cwd is the
// sandbox workspace, so a repo-relative sink path resolves against the WRONG directory (measured:
// `-bash: …host-stderr.log: No such file or directory`, and the boot never starts).
const outDir = resolve(join("evidence", "tui", "dsh-tui-015", "triage-reds", "probe", "F-decision-granted"))
mkdirSync(outDir, { recursive: true })
/** The driver's own argument parsing, so the sandbox layout is byte-identical to a lane's. */
const parsed = parseSandboxArgs(["--sandbox-root", root], "triage-probe")
/** The host's grant file inside the sandbox. */
const grantFile = sandboxGrantFile(parsed.root)
/** The four intercept permissions the shipped manifest declares (`dsh-plugin.json`). */
const rows = [
  { name: "session.input.intercept", scope: "tui/input" },
  { name: "session.rewind.intercept", scope: "tui/rewind-prompt" },
  { name: "session.switch.intercept", scope: "tui/session-switch" },
  { name: "session.compact.intercept", scope: "tui/compact" },
]
writeExtensionGrants(grantFile, "com.mpd-dsh.mpd-tui", rows)
console.log("grant file written:", grantFile)

/** The ledger's line count before the boot, so the delta is exactly this boot's records. */
const before = existsSync(sandboxEffectLedgerFile(parsed.root)) ? readFileSync(sandboxEffectLedgerFile(parsed.root), "utf8").trim().split("\n").length : 0
/** The stderr sink for the boot: the host's debug stream lands here, off the pane. */
const stderrFile = join(outDir, "host-stderr.log")
const session = runTuiSession({
  lane: "pD2",
  root: parsed.root,
  outDir,
  bootWaitMs: 150_000,
  extraEnv: { DSH_TUI_DEBUG: "1" },
  stderrFile,
  steps: [{ name: "settle", keys: ["Escape"], waitMs: 3000 }, { name: "status-command", keys: ["/mpd status", "Enter"], waitMs: 6000 }],
})
console.log("lifecycle failures:", session.failures.length === 0 ? "(none)" : session.failures.join(" | "))

/** The boot's own diagnostic lines, as our plugin wrote them. */
const stderr = existsSync(stderrFile) ? readFileSync(stderrFile, "utf8") : ""
console.log("--- lines carrying our [mpd-tui] prefix:", (stderr.match(/\[mpd-tui\]/g) ?? []).length)
for (const line of stderr.split("\n").filter((l) => l.includes("[mpd-tui]")).slice(0, 25)) console.log("    " + line.slice(0, 220))
console.log("--- admission loader: admitted=", (stderr.match(/admission loader admitted/g) ?? []).length, "refused=", (stderr.match(/admission loader refused/g) ?? []).length)

/** The whole ledger after the boot. */
const after = existsSync(sandboxEffectLedgerFile(parsed.root)) ? readFileSync(sandboxEffectLedgerFile(parsed.root), "utf8").trim().split("\n") : []
/** The records this boot appended. */
const delta = after.slice(before)
console.log("--- ledger delta:", delta.length)
/** Kinds and attributions among the delta. */
const kinds = new Map<string, number>()
for (const line of delta) {
  try {
    const record = JSON.parse(line) as { pluginId?: string; operation?: string; resource?: { kind?: string; id?: string } }
    const key = `${record.resource?.kind ?? "?"}/${record.operation ?? "?"}/${record.pluginId ?? "?"}`
    kinds.set(key, (kinds.get(key) ?? 0) + 1)
  } catch {
    // A malformed line is surfaced by its absence.
  }
}
for (const [key, count] of kinds) console.log("    " + key + " x" + count)
console.log("--- any record naming our component:", delta.filter((l) => l.includes("com.mpd-dsh.mpd-tui")).length)
console.log("--- any decision-handler record:", delta.filter((l) => l.includes("decision-handler")).length)
