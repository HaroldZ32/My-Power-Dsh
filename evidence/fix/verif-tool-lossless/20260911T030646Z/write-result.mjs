// Build evidence/fix/verif-tool-lossless/<ts>/result.json from the captured
// logs, asserting each acceptance step mechanically (no hand-copied verdicts).
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ev = dirname(fileURLToPath(import.meta.url))
const repo = join(ev, "..", "..", "..", "..")
const read = (p) => (existsSync(join(ev, p)) ? readFileSync(join(ev, p), "utf8") : "")
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")

const prefixUnit = read("negative-control.log") // unit tests vs pre-fix src
const postUnit = read("postfix-full-suite.log") // full package suite vs fixed src
const mountedFixed = read("mounted-backends.log")
const mountedLintCompile = read("mounted-lint-compile.log")
const mountedPrefix = read("negative-control.mounted.log")
const dist = readFileSync(join(repo, "packages/mpd-verif-plugin/dist/index.js"), "utf8")
const distBackup = join(ev, "fixed-dist", "index.js")

const steps = {
  "unit tests vs PRE-FIX src (negative control)": {
    ok: /4 fail/.test(prefixUnit) && /value\.licenseHint/.test(prefixUnit) && /value\.filelistPath/.test(prefixUnit),
    evidence: "4 of 5 new tests fail; the deep scanner names the lossy keys value.licenseHint and value.filelistPath/value.outBinary",
  },
  "unit tests vs FIXED src (positive)": {
    ok: /74 pass/.test(postUnit) && /0 fail/.test(postUnit),
    evidence: "74 pass / 0 fail (lossless.test.ts 5 pass)",
  },
  "mounted session, FIXED dist: mpd_verif_backends {iverilog, all, vcs}": {
    ok:
      /BACKENDS1: mpd_verif_backends: iverilog=present/.test(mountedFixed) &&
      /BACKENDS2: mpd_verif_backends: iverilog=present.*verilator=present.*vcs=absent/.test(mountedFixed) &&
      /BACKENDS3: mpd_verif_backends: vcs=absent/.test(mountedFixed) &&
      !/not lossless JSON/.test(mountedFixed),
    evidence: "all three selectors returned rendered results; the string 'not lossless JSON' is absent from the whole log",
  },
  "mounted session, FIXED dist: mpd_verif_lint + mpd_verif_compile {iverilog}": {
    ok:
      /LINT: mpd_verif_lint OK \(iverilog\)/.test(mountedLintCompile) &&
      /COMPILE: mpd_verif_compile OK — iverilog/.test(mountedLintCompile) &&
      !/not lossless JSON/.test(mountedLintCompile),
    evidence: "authorized compile.ts extension verified through the host boundary on the open-source lane",
  },
  "mounted session, PRE-FIX dist (negative control)": {
    ok:
      /BACKENDS1: Error: tool "mpd_verif_backends" returned invalid output: value is not lossless JSON/.test(mountedPrefix) &&
      /BACKENDS2: Error: tool "mpd_verif_backends" returned invalid output: value is not lossless JSON/.test(mountedPrefix) &&
      /BACKENDS3: mpd_verif_backends: vcs=absent/.test(mountedPrefix),
    evidence: "same mounted path rejects the pre-fix artifact exactly as the task described (iverilog+all red, vcs green)",
  },
  "dist rebuilt from fixed source": {
    ok:
      /licenseHint = backend === "vcs"[\s\S]{0,200}?: null;/.test(dist) &&
      dist.includes("...plan.filelistPath === undefined ? {} : { filelistPath: plan.filelistPath }") &&
      !/licenseHint = backend === "vcs"[\s\S]{0,200}?: undefined;/.test(dist),
    evidence: "dist carries ': null' for licenseHint and the conditional spreads in verifCompile",
  },
  "dist restore is byte-identical to the fixed backup": {
    ok: existsSync(distBackup) && sha(distBackup) === sha(join(repo, "packages/mpd-verif-plugin/dist/index.js")),
    evidence: "sha256 " + (existsSync(distBackup) ? sha(distBackup) : "missing"),
  },
}

const ok = Object.values(steps).every((s) => s.ok)
writeFileSync(join(ev, "result.json"), JSON.stringify({ ok, task: "t3", slug: "verif-tool-lossless", steps }, null, 2))
console.log(JSON.stringify({ ok, steps }, null, 2))
process.exit(ok ? 0 : 1)
