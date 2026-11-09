// T5 DELTA RE-VERIFY PROBE 2 — the NEW substitution-aware pass and its neighbours.
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

/** The pure shell decision for one command, as the captain's own top-level `mpd` session would get it. */
function shell(command: string): string | undefined {
  return captainShellDecision({ toolName: "bash", args: { command }, workspaceRoot: ROOT, pathExists, topLevel: true, mode: "deny" })
}

/** Print one observed row. */
function observe(command: string): void {
  const verdict = shell(command)
  console.log((verdict === undefined ? "ALLOWED  " : "REFUSED  ") + JSON.stringify(command))
  if (verdict !== undefined) console.log("    :: " + verdict.replace(/\s+/gu, " ").slice(0, 160))
}

console.log("## substitution-hidden GATE commands (contract §3 C1 family)")
for (const command of [
  "echo $(bun test)",
  "x=$(bun test)",
  "$(bun test)",
  "echo `bun test`",
  "echo $(npm run typecheck)",
  "echo $(node scripts/verify-vendor.ts)",
  "if $(bun test); then echo ok; fi",
  "echo $(cd packages && bun test)",
]) observe(command)

console.log("")
console.log("## substitution-hidden READS (the repaired class — expected REFUSED)")
for (const command of [
  "echo $(cat packages/mpd-roles-plugin/src/index.ts)",
  "echo `grep TODO packages/mpd-roles-plugin/src/index.ts`",
  "echo $(head -5 packages/mpd-roles-plugin/src/index.ts)",
]) observe(command)

console.log("")
console.log("## process substitution / declared bounds (out of the token class)")
for (const command of [
  "cat <(cat packages/mpd-roles-plugin/src/index.ts)",
  "diff <(cat docs/decisions.md) <(cat packages/mpd-roles-plugin/src/index.ts)",
  "bash -c 'cat packages/mpd-roles-plugin/src/index.ts'",
  "sh -c 'bun test'",
  "python3 -c 'print(open(\"packages/mpd-roles-plugin/src/index.ts\").read())'",
]) observe(command)

console.log("")
console.log("## over-block watch: a read segment plus an unrelated substitution")
for (const command of [
  "cat docs/decisions.md && echo \"ran at $(date)\" && ls packages",
  "cat docs/decisions.md && du -sh packages $(pwd)",
  "cat docs/decisions.md && git log -1 --format=%H $(git rev-parse --abbrev-ref HEAD)",
  "echo $(cat docs/decisions.md && ls packages)",
]) observe(command)
