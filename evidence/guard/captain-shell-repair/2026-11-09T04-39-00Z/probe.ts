// The direct decision probe for this repair: the table length, one representative per new deny row, the
// four new anti-false-positive spellings, and one arm per recursion flag. Run from the repo root, e.g.
//   .toolchain/node_modules/.bin/bun evidence/guard/captain-shell-repair/2026-11-09T04-39-00Z/probe.ts
import {
  CAPTAIN_SHELL_DENY_PATTERNS,
  captainShellDecision,
  matchCaptainShellDeny,
} from "../../../../packages/mpd-roles-plugin/src/captain-shell.ts"

/** The decision for one captain `bash` call, with no path on disk and the deny mode in force. */
function decide(command: string): string {
  return captainShellDecision({
    toolName: "bash", args: { command }, workspaceRoot: process.cwd(),
    pathExists: () => false, topLevel: true, mode: "deny",
  }) === undefined ? "ALLOW" : "REFUSE"
}

console.log("table length:", CAPTAIN_SHELL_DENY_PATTERNS.length)
for (const command of [
  "bun run test", "bun run test:unit", "bun run testimony", "bun run format",
  "bunx tsgo", "bun x tsgo", "bun x jest",
  "npm exec tsc", "pnpm dlx tsc", "yarn dlx tsc", "npm install",
]) {
  console.log(JSON.stringify(command), "->", matchCaptainShellDeny(command)?.label ?? "(no row)", "|", decide(command))
}
for (const command of [
  "git log | grep -r fix", "git log | grep -R fix", "git log | grep -rn fix", "git log | grep -nr fix",
  "git log | grep --recursive fix", "git log | grep --dereference-recursive fix",
  "git log | grep fix", "ls | grep md", "grep fix docs/x", "git log | grep -rn TODO docs/",
]) {
  console.log(JSON.stringify(command), "->", decide(command))
}
