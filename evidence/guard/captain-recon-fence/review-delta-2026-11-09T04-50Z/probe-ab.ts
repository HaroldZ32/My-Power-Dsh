// Verifier's black-box probe for CodeRabbit round-1 findings A and B (delta review, 2026-11-09).
// Drives the REAL exported decision (`captainShellDecision`) — the same function the mounted row calls —
// with the repository root and the same on-disk path probe the package's own test harness uses.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { CAPTAIN_SHELL_DENY_PATTERNS, captainShellDecision, matchCaptainShellDeny } from "../../../../packages/mpd-roles-plugin/src/captain-shell.ts"

const ROOT = "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
const pathExists = (raw: string): boolean => existsSync(raw.startsWith("/") ? raw : join(ROOT, raw))
const decide = (command: string): string | undefined =>
  captainShellDecision({ toolName: "bash", args: { command }, workspaceRoot: ROOT, pathExists, topLevel: true, mode: "deny" })

/** [group, command, expected] — the commands the round-1 findings name, plus the required anti-false-positives. */
const REQUIRED: Array<[string, string, "REFUSE" | "ALLOW"]> = [
  ["A", "bun run test", "REFUSE"],
  ["A", "bun run test:unit", "REFUSE"],
  ["A", "bun run test:watch", "REFUSE"],
  ["A", "bunx tsgo --noEmit", "REFUSE"],
  ["A", "bun x tsgo", "REFUSE"],
  ["A", "npm exec tsc", "REFUSE"],
  ["A", "pnpm dlx tsc", "REFUSE"],
  ["A", "yarn dlx tsc", "REFUSE"],
  ["A", "npm exec -p typescript tsc", "ALLOW"],
  ["A", "bun run testimony", "ALLOW"],
  ["A", "bun run format", "ALLOW"],
  ["A", "npm install", "ALLOW"],
  ["A", "git status", "ALLOW"],
  ["B", "true | grep -rn TODO", "REFUSE"],
  ["B", "git log | grep -R fix", "REFUSE"],
  ["B", "git log | grep -r fix", "REFUSE"],
  ["B", "git log | grep -rn fix", "REFUSE"],
  ["B", "git log | grep --recursive fix", "REFUSE"],
  ["B", "git log | grep --dereference-recursive fix", "REFUSE"],
  ["B", "git log | grep fix", "ALLOW"],
  ["B", "ls | grep md", "ALLOW"],
  ["B", "grep -rn TODO docs/", "ALLOW"],
  ["B", "git log | grep -rn TODO docs/", "ALLOW"],
]

/** Spellings OUTSIDE the filed finding set, printed as declared residuals rather than verdict rows. */
const RESIDUALS: string[] = [
  'git log | grep "-r" fix',
  "git log | grep '--recursive' fix",
  "bunx --bun tsgo",
  "npm x tsc",
  "pnpm --silent dlx tsc",
  'bun "test"',
]

let mismatched = 0
console.log("deny table length:", CAPTAIN_SHELL_DENY_PATTERNS.length)
for (const [group, command, expected] of REQUIRED) {
  const got = decide(command) === undefined ? "ALLOW" : "REFUSE"
  const label = matchCaptainShellDeny(command)?.label ?? "(no row)"
  const ok = got === expected
  if (!ok) mismatched += 1
  console.log(`${ok ? "ok  " : "MISMATCH"} ${group} ${JSON.stringify(command)} -> ${got} [${label}]`)
}
console.log(`required rows: ${REQUIRED.length} mismatched: ${mismatched}`)
console.log("--- declared residuals (outside the filed spellings) ---")
for (const command of RESIDUALS) console.log(`residual ${JSON.stringify(command)} -> ${decide(command) === undefined ? "ALLOW" : "REFUSE"}`)
process.exit(mismatched === 0 ? 0 : 1)
