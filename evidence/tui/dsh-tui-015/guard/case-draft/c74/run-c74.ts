// Runner for the C7-4 case-arm DRAFT: prints the arms and (with `--out <dir>`) writes result.json.
// This file exists so the draft is PROVEN in place at its own depth; the skills writer copies only the
// `c74-arms.ts` content and rewrites its import prefix (see the header of that file).
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { c74Arms } from "./c74-arms.ts"

/** The arms, printed and optionally persisted. */
const arms = await c74Arms()
for (const arm of arms) console.log(`${arm.ok ? "ok  " : "FAIL"} (${arm.id}) ${arm.claim} — ${arm.observed}`)
/** Whether every arm held. */
const ok = arms.every((arm) => arm.ok)
console.log(ok ? `SELF-TEST: PASS (${arms.length} arms: 5 fixes with their negative controls)` : "SELF-TEST: FAIL")
/** The `--out` target, when the caller pinned one. */
const outIndex = process.argv.indexOf("--out")
/** The requested directory, or undefined to print only. */
const requested = outIndex >= 0 ? process.argv[outIndex + 1] : undefined
if (requested !== undefined) {
  mkdirSync(requested, { recursive: true })
  writeFileSync(join(requested, "result.json"), JSON.stringify({ case: "team-dispatch-guard/c74-draft", ok, arms }, null, 2) + "\n")
  console.log(`evidence -> ${requested}`)
}
process.exit(ok ? 0 : 1)
