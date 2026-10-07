#!/usr/bin/env node
// t6 (Reviewer) falsifiability controls: the new devPatch self-test guards must
// FAIL when the capability is absent. We rebuild each script in a symlink farm
// (so its repoRoot still points at the real checkout) with ONLY the devPatch fix
// reverted, and run the unmodified and the mutated --self-test side by side.
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const FARM = join(here, "work", "negfarm")
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 900) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${String(detail).slice(0, 240)}`)
}

spawnSync("rm", ["-rf", FARM])
mkdirSync(FARM, { recursive: true })
for (const link of ["packages", "presets", "tests", "docs", "node_modules"]) {
  try { symlinkSync(join(repoRoot, link), join(FARM, link)) } catch {}
}
mkdirSync(join(FARM, "skills", "dsh-qa", "scripts"), { recursive: true })
symlinkSync(join(repoRoot, "skills", "dsh-qa", "scripts", "lib"), join(FARM, "skills", "dsh-qa", "scripts", "lib"))

function runSelfTest(scriptPath, label) {
  const run = spawnSync("node", [scriptPath, "--self-test"], { encoding: "utf8", cwd: FARM, env: { ...process.env }, timeout: 120_000 })
  return { label, exit: run.status, out: (run.stdout ?? "") + (run.stderr ?? "") }
}

for (const name of ["preset-register.mjs", "rtl-verif.mjs"]) {
  const src = readFileSync(join(repoRoot, "skills", "dsh-qa", "scripts", name), "utf8")
  // revert ONLY the devPatch fix (the two consumed-operand steps), keeping the new guards
  const mutated = src
    .split("    .split(BASEURL_PREFIX).join(\"\")\n").join("")
    .split(`    .split('"/node_modules/@mpd-dsh/mpd/').join('"' + repoRoot + "/")\n`).join("")
  if (mutated === src) { check(`${name}: mutation applied (fix removed)`, false, "mutation changed nothing — fix lines not found"); continue }
  const dir = join(FARM, "skills", "dsh-qa", "scripts")
  const unmodifiedPath = join(dir, "unmodified-" + name)
  const mutatedPath = join(dir, "mutated-" + name)
  writeFileSync(unmodifiedPath, src)
  writeFileSync(mutatedPath, mutated)

  const okRun = runSelfTest(unmodifiedPath, "unmodified")
  check(`${name}: unmodified --self-test passes in the same farm (farm itself is sound)`,
    okRun.exit === 0, `exit=${okRun.exit} out=${okRun.out.trim().slice(-200)}`)
  const badRun = runSelfTest(mutatedPath, "mutated")
  check(`${name}: --self-test FAILS when the devPatch fix is reverted (guard is falsifiable, not vacuous)`,
    badRun.exit !== 0 && /devPatch left the packed \/node_modules operand or a baseUrl concat/.test(badRun.out),
    `exit=${badRun.exit} out=${badRun.out.trim().slice(-260)}`)
}

const result = { task: "t6 falsifiability controls for the devPatch guards", stamp: new Date().toISOString(), farm: FARM, checks, allPass: checks.every((c) => c.pass) }
writeFileSync(join(here, "negative-controls.result.json"), JSON.stringify(result, null, 2))
console.log("\n" + (result.allPass ? "PASS" : "FAIL") + " — negative-controls.result.json (" + checks.filter((c) => c.pass).length + "/" + checks.length + ")")
process.exit(result.allPass ? 0 : 1)
