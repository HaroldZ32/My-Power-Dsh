import { mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

const OUT = "evidence/omo-align/messaging/r1-wiring"
mkdirSync(OUT, { recursive: true })

function run(label, command, args) {
  const started = Date.now()
  let exitCode = 0
  let output = ""
  try {
    output = execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: process.cwd() })
  } catch (error) {
    exitCode = typeof error.status === "number" ? error.status : 1
    output = `${String(error.stdout ?? "")}${String(error.stderr ?? "")}`
  }
  return { label, command: [command, ...args].join(" "), exitCode, ms: Date.now() - started, tail: output.trim().split("\n").slice(-12).join("\n") }
}

const results = [
  run("delta registry check", "node", ["scripts/patch-agent-teams-fixes.mjs", "--check"]),
  run("plugin suite", "bun", ["test", "packages/mpd-agent-teams-plugin"]),
  run("self-fix suite", "bun", ["test", "packages/mpd-agent-teams-plugin/self-fix-tests"]),
  run("typecheck", "bun", ["run", "typecheck"]),
]

const payload = {
  task: "t49",
  round: "repair-round-2",
  attempt: 1,
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  note: "commands only; the long session-start-team QA case is recorded in its own evidence dir",
  results,
}
writeFileSync(`${OUT}/gates.json`, JSON.stringify(payload, null, 2))
console.log(JSON.stringify(results.map((r) => ({ label: r.label, exitCode: r.exitCode, ms: r.ms })), null, 1))
