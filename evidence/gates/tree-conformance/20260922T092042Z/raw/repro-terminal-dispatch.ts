#!/usr/bin/env node
// Repro driver: run the T-07 terminal-dispatch file repeatedly and report which arms fail.
import { spawnSync } from "node:child_process"
const file = "packages/mpd-agent-teams-plugin/self-fix-tests/terminal-dispatch.test.mjs"
const runs = Number(process.argv[2] ?? 12)
let failures = 0
for (let i = 1; i <= runs; i += 1) {
  const r = spawnSync("bun", ["test", file], { encoding: "utf8", cwd: process.cwd(), maxBuffer: 32 * 1024 * 1024, timeout: 300000 })
  const out = String(r.stdout ?? "") + String(r.stderr ?? "")
  const fails = out.split("\n").filter((l) => l.startsWith("(fail)"))
  const status = r.status ?? 1
  console.log("run " + i + ": exit=" + status + (fails.length > 0 ? "  FAIL: " + fails.join(" | ") : "  ok"))
  if (status !== 0) {
    failures += 1
    console.log("---- failing output ----")
    console.log(out.split("\n").slice(-60).join("\n"))
  }
}
console.log("failures: " + failures + "/" + runs)
process.exit(failures === 0 ? 0 : 1)