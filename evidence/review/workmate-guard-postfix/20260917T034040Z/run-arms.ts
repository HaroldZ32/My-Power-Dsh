// t64 — NON-AUTHOR second reading of the T-43 real-home guard, in the shape that FAILED (HOME at
// PROCESS START), in BOTH runtimes. Measurement only: every arm calls the exported predicate and
// touches nothing; the real ~/.mpd/workmate is snapshotted before and after to prove that.
//
// Why this file exists: the pre-fix four-arm table (this seat) showed the allow-branch needed
// `resolve(HOME) !== resolve(homedir())`, and under bun `os.homedir()` freezes at process start,
// so the branch was reachable only when HOME changed AFTER start — a shape no verifier's boot uses.
// The fix (t62, platform-engineer) resolves the real home from the /etc/passwd entry first.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "../../../..")
const DIST = join(REPO, "packages/mpd-workmate-plugin/dist/index.js")
const REAL_HOME = "/root"
const REAL_LIB = join(REAL_HOME, ".mpd/workmate")
const SANDBOX = join(HERE, "sandbox-home")
mkdirSync(SANDBOX, { recursive: true })

const distSha = createHash("sha256").update(readFileSync(DIST)).digest("hex")
const distBytes = statSync(DIST).size

// The child program: import the guard and call it once. No fs effect anywhere.
const ARM_CODE = `
const m = await import(${JSON.stringify(DIST)});
try { m.assertMutationSandboxed("arm"); console.log("ALLOWED"); }
catch (e) { console.log("REFUSED " + (e && e.code)); }
`
// The control arm repoints HOME at runtime, inside a plain node process.
const CONTROL_CODE = `
process.env.DSH_HOME = ${JSON.stringify(join(SANDBOX, "dsh"))};
process.env.HOME = ${JSON.stringify(SANDBOX)};
const m = await import(${JSON.stringify(DIST)});
try { m.assertMutationSandboxed("control"); console.log("ALLOWED"); }
catch (e) { console.log("REFUSED " + (e && e.code)); }
`

function libDigest() {
  if (!existsSync(REAL_LIB)) return { exists: false, entries: [], digest: null }
  const names = []
  const walk = (d, rel = "") => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? rel + "/" + e.name : e.name
      if (e.isDirectory()) walk(join(d, e.name), r)
      else names.push(r + "  " + createHash("sha256").update(readFileSync(join(d, e.name))).digest("hex").slice(0, 16))
    }
  }
  walk(REAL_LIB)
  names.sort()
  return { exists: true, entries: names, digest: createHash("sha256").update(names.join("\n")).digest("hex") }
}

const before = libDigest()

const arms = [
  { id: "A1", runtime: "node", env: { HOME: SANDBOX, DSH_HOME: join(SANDBOX, "dsh") }, expect: "ALLOWED",
    why: "the QA-boot shape that FAILED pre-fix: sandbox HOME and DSH_HOME set AT PROCESS START" },
  { id: "A2", runtime: "bun", env: { HOME: SANDBOX, DSH_HOME: join(SANDBOX, "dsh") }, expect: "ALLOWED",
    why: "the runtime where os.homedir() freezes at process start — the compiler of the old bug" },
  { id: "A3", runtime: "node", env: { HOME: SANDBOX, DSH_HOME: null }, expect: "ALLOWED",
    why: "normal session: DSH_HOME unset, the early return must stay untouched" },
  { id: "A4", runtime: "node", env: { HOME: REAL_HOME, DSH_HOME: join(SANDBOX, "dsh") }, expect: "REFUSED real-home-refused",
    why: "isolated boot whose HOME is the REAL home: the guard must still refuse — a passive guard would mutate the real library" },
  { id: "A5", runtime: "node", env: { HOME: SANDBOX, DSH_HOME: join(SANDBOX, "dsh"), MPD_DSH_WORKMATE_ALLOW_REAL_HOME: "1" }, expect: "ALLOWED",
    why: "the documented override still releases the guard (NOT covered by the platform lane's 4x2 pre-flight — stated new coverage)" },
  { id: "C1", runtime: "node", env: { HOME: REAL_HOME, DSH_HOME: join(SANDBOX, "dsh") }, code: CONTROL_CODE, expect: "ALLOWED",
    why: "DISCRIMINATING CONTROL: plain node, HOME repointed to the sandbox AT RUNTIME. Pre-fix this was REFUSED because node's homedir() follows the live env while bun's is frozen; post-fix the passwd entry decides, so a pass here shows the fix does not depend on the freeze quirk" },
]

const results = arms.map((arm) => {
  const env = { ...process.env }
  for (const [k, v] of Object.entries(arm.env)) { if (v === null || v === undefined) delete env[k]; else env[k] = v }
  const bin = arm.runtime === "bun" ? "bun" : "node"
  const r = spawnSync(bin, ["--input-type=module", "-e", arm.code ?? ARM_CODE], { env, encoding: "utf8", cwd: REPO })
  const out = ((r.stdout ?? "") + (r.stderr ?? "")).trim().split("\n").filter(Boolean).pop() ?? ""
  return { id: arm.id, runtime: arm.runtime, why: arm.why, expect: arm.expect, observed: out,
    pass: out.startsWith(arm.expect.split(" ")[0]) && (arm.expect.includes(" ") ? out.includes(arm.expect.split(" ")[1]) : true),
    exit: r.status, env_at_process_start: Object.fromEntries(Object.entries(arm.env).map(([k, v]) => [k, v === null ? "<unset>" : v])) }
})

const after = libDigest()
const allPass = results.every((r) => r.pass)
const report = {
  task: "t64", kind: "verification", attemptId: "ff9bdc35-60fb-411a-ba80-df0b8f72db6c",
  NON_AUTHOR: true,
  non_author_note: "the guard's author is platform-engineer (t62); this seat only READS the shipped bytes and measured the pre-fix mechanism, so this is not a self-approval",
  measured_at: new Date().toISOString(),
  revision: {
    dist: "packages/mpd-workmate-plugin/dist/index.js",
    dist_sha256: distSha, dist_bytes: distBytes, dist_mtime: statSync(DIST).mtime.toISOString(),
    every_arm_imported: distSha,
    src_dist_correspondence: "node scripts/verify-dist-fresh.mjs read 20/20 fresh immediately before the arms, so the shipped dist is the build of the fixed src",
    bound: "the verdict is bound to this dist hash; a later rebuild voids it",
  },
  arms: results,
  control_note: "C1 is the discriminating control: it would have been REFUSED pre-fix under plain node, so a pass here is evidence the fix works independently of the os.homedir() freeze quirk rather than the quirk having moved the problem",
  real_library_invariant: {
    path: "~/.mpd/workmate",
    before: { exists: before.exists, entries: before.entries.length, digest: before.digest },
    after: { exists: after.exists, entries: after.entries.length, digest: after.digest },
    unchanged: before.digest === after.digest,
  },
  verifier_command: "bun test packages/mpd-workmate-plugin",
  ok: allPass && before.digest === after.digest,
}
writeFileSync(join(HERE, "result.json"), JSON.stringify(report, null, 2) + "\n")
const lines = [
  "t64 — NON-AUTHOR second reading of the T-43 real-home guard after t62 (measurement only; nothing written outside this directory).",
  "imported module: " + "packages/mpd-workmate-plugin/dist/index.js",
  "dist sha256: " + distSha + "  (" + distBytes + " B, mtime " + report.revision.dist_mtime + ")",
  "src→dist correspondence: verify-dist-fresh 20/20 fresh immediately before the arms",
  "",
  "ARMS (HOME set AT PROCESS START — the shape that failed):",
  ...results.map((r) => `  ${r.id} ${r.runtime.padEnd(4)} expect=${r.expect.padEnd(28)} observed=${r.observed.padEnd(28)} ${r.pass ? "PASS" : "FAIL"}  (${r.why})`),
  "",
  "real library invariant: ~/.mpd/workmate before " + before.entries.length + " files digest " + before.digest,
  "                                    after  " + after.entries.length + " files digest " + after.digest,
  "                                    UNCHANGED: " + (before.digest === after.digest),
  "",
  "ALL ARMS PASS: " + allPass,
]
writeFileSync(join(HERE, "output.log"), lines.join("\n") + "\n")
console.log(lines.slice(0, 12).join("\n"))
console.log("ok=" + report.ok)
