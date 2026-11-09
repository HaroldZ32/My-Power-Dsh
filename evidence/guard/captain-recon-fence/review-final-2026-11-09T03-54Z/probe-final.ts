// T5 FINAL RE-VERIFY PROBE — the two F10 arms against the SHIPPED pure decision.
// Reviewer evidence only: this file is never imported by product code and it edits nothing.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { captainShellDecision } from "../../../../packages/mpd-roles-plugin/src/captain-shell.ts"
import { captainReadablePath } from "../../../../packages/mpd-roles-plugin/src/captain-investigation.ts"

/** The workspace root the probe judges against: the checkout, exactly as the guarded session would. */
const ROOT: string = process.cwd()

/** Whether one token exists on disk, resolved against ROOT exactly like the installed shell guard. */
function pathExists(raw: string): boolean {
  try {
    if (raw === "") return false
    const absolute = raw.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(raw)
    return existsSync(absolute ? raw : join(ROOT, raw))
  } catch {
    return false
  }
}

/** The pure shell decision for one command, as the captain's own top-level `mpd` session would get it. */
function shell(command: string): string | undefined {
  return captainShellDecision({ toolName: "bash", args: { command }, workspaceRoot: ROOT, pathExists, topLevel: true, mode: "deny" })
}

/** One flattened verdict for the log. */
function flat(text: string | undefined): string {
  return text === undefined ? "ALLOWED" : "REFUSED"
}

/** One detail line with the refusal's opening clause, flattened. */
function detail(text: string | undefined): string {
  return text === undefined ? "" : " :: " + text.replace(/\s+/gu, " ").slice(0, 200)
}

/** Rows observed so far. */
let total = 0
/** Rows whose observed verdict differs from the amended contract's expectation. */
let mismatched = 0

/** Assert one shell row against the amended contract's expected verdict; print it either way. */
function expectShell(group: string, command: string, expected: "ALLOWED" | "REFUSED"): void {
  total += 1
  const verdict = shell(command)
  const observed = flat(verdict)
  const ok = observed === expected
  if (!ok) mismatched += 1
  console.log(
    (ok ? "OK  " : "MISMATCH ")
      + group.padEnd(8)
      + " exp=" + expected.padEnd(8)
      + " got=" + observed.padEnd(8)
      + " " + JSON.stringify(command)
      + detail(verdict),
  )
}

console.log("## F10 arm 1 — piped search carrying an EXISTING out-of-band path (contract B3: REFUSED)")
expectShell("F10-B3", "cat docs/decisions.md | grep TODO packages/mpd-roles-plugin/src/index.ts", "REFUSED")

console.log("")
console.log("## F10 arm 2 — piped search whose out-of-band token exists nowhere (contract C3: not a path candidate -> ALLOWED)")
expectShell("F10-C3", "cat docs/x | grep TODO packages/y.ts", "ALLOWED")

console.log("")
console.log("## Existence qualifier is UNIFORM (amended C3) — a nonexistent candidate never refuses")
expectShell("C3-uni", "rg --files docs/ packages/nope.ts", "ALLOWED")

console.log("")
console.log("## Unchanged C3 rows around the amendment (regression guard)")
expectShell("C3", "rg foo", "REFUSED")
expectShell("C3", "rg foo docs/", "ALLOWED")
expectShell("C3", "find . -name '*.ts'", "REFUSED")
expectShell("C3", "git log --oneline | grep fix", "ALLOWED")
expectShell("C3", "cat packages/mpd-roles-plugin/src/index.ts", "REFUSED")
expectShell("C3", "cat docs/decisions.md", "ALLOWED")

console.log("")
console.log("## Band classifier used by both rules (same function, one definition)")
for (const raw of ["docs/decisions.md", "packages/mpd-roles-plugin/src/index.ts", "packages/y.ts", "docs/x"]) {
  console.log("band " + JSON.stringify(raw) + " -> " + String(captainReadablePath(ROOT, raw)))
}

console.log("")
console.log("SUMMARY total=" + total + " mismatched=" + mismatched)
