// T5 DELTA RE-VERIFY PROBE 3 — contract §4 B1 spellings, anti-false-positive list and scope.
// Reviewer evidence only: reads the shipped pure decision; edits nothing.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { captainShellDecision } from "../../../../packages/mpd-roles-plugin/src/captain-shell.ts"

/** The workspace root the probe judges against. */
const ROOT: string = process.cwd()

/** Whether one token exists on disk, resolved exactly like the installed shell guard. */
function pathExists(raw: string): boolean {
  try {
    if (raw === "") return false
    const absolute = raw.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(raw)
    return existsSync(absolute ? raw : join(ROOT, raw))
  } catch {
    return false
  }
}

/** The pure shell decision with the session classification and mode under test. */
function shell(command: string, topLevel: boolean = true, mode: "deny" | "allow" = "deny"): string | undefined {
  return captainShellDecision({ toolName: "bash", args: { command }, workspaceRoot: ROOT, pathExists, topLevel, mode })
}

/** Print one observed row. */
function observe(label: string, command: string, topLevel: boolean = true, mode: "deny" | "allow" = "deny"): void {
  const verdict = shell(command, topLevel, mode)
  console.log(label.padEnd(10) + (verdict === undefined ? "ALLOWED  " : "REFUSED  ") + JSON.stringify(command))
}

console.log("## B1 — R1 launcher spellings (expect REFUSED)")
for (const command of [
  "npm test",
  "npm run typecheck",
  "bun typecheck",
  "bun run --silent typecheck",
  "env FOO=1 bun run typecheck",
  "/usr/local/bin/bun test",
  "/usr/bin/env bun test",
  "sudo -u root bun test",
  "FOO=1 bun test",
  "command bun test",
  "nohup bun test",
  "npm run verify:gates",
  "pnpm test",
  "yarn run typecheck",
  "npx vitest",
  "cd packages && bun test",
  "echo start; bun test",
]) observe("R1", command)

console.log("")
console.log("## B1 — anti-false-positive list (expect ALLOWED)")
for (const command of [
  "git status",
  "ls",
  "mkdir -p x",
  "node -e \"1+1\"",
  "bun run format",
  "npm install",
  "cat docs/x.md",
  "echo \"bun test\"",
]) observe("anti-FP", command)

console.log("")
console.log("## B1 — scope: child session and non-captain keep the shell, `allow` restores it")
observe("child", "cat packages/mpd-roles-plugin/src/index.ts", false, "deny")
observe("allow", "bun test", true, "allow")
observe("allow", "cat packages/mpd-roles-plugin/src/index.ts", true, "allow")
