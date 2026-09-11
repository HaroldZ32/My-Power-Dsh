#!/usr/bin/env bun
// t9 (Reviewer) OWN R1 ordering negative control.
//
// Independent of the implementer's pre-fix-order.mjs: this works on a
// DISPOSABLE COPY of packages/mpd-verif-plugin under the evidence scratch dir,
// so the shared source tree is never mutated (no race with an in-flight repair
// task reading src/regress.ts).
//
// Baseline: the copied package's order-pinning tests PASS.
// Flipped:  the copy is rewritten to the PRE-FIX order (work dir created before
//           the cocotb iron gate) and the same tests FAIL — that is the control
//           proving the ordering assertion is falsifiable.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const source = join(repoRoot, "packages", "mpd-verif-plugin")
const scratch = join(here, "scratch")
const copy = join(scratch, "mpd-verif-plugin-prefix")
const testFile = join(copy, "test", "regress.test.ts")

const SEED_ANCHOR = "  const seedBase = args.seedBase ?? dateSeedBase()"
const LANE_LINE = "\n  const regressDir = createRegressDir(exec)\n"
const MARKER = "  const regressDir = createRegressDir(exec) // T9 PRE-FIX ORDER SIMULATION"

const runTests = (label) => {
  const t0 = Date.now()
  const r = spawnSync("bun", ["test", testFile], { cwd: repoRoot, encoding: "utf8", timeout: 300000, maxBuffer: 32 * 1024 * 1024 })
  const out = (r.stdout ?? "") + (r.stderr ?? "")
  const pass = (out.match(/^\s*(\d+)\s+pass\b/m) ?? [])[1] ?? "?"
  const fail = (out.match(/^\s*(\d+)\s+fail\b/m) ?? [])[1] ?? "?"
  return { label, exitCode: r.status, pass, fail, durationMs: Date.now() - t0, output: out }
}

// Fresh disposable copy.
rmSync(copy, { recursive: true, force: true })
mkdirSync(scratch, { recursive: true })
cpSync(source, copy, { recursive: true })

// The copied package keeps the repo's cross-package RELATIVE import
// (`../../mpd-dsh-adapter-plugin/src/index`), so provide that sibling as a
// symlink into the real packages tree: the shared source is still never mutated.
const adapterLink = join(scratch, "mpd-dsh-adapter-plugin")
rmSync(adapterLink, { recursive: true, force: true })
symlinkSync(join(repoRoot, "packages", "mpd-dsh-adapter-plugin"), adapterLink, "dir")

const baseline = runTests("baseline-copy (fixed order)")
writeFileSync(join(here, "r1-prefix-control-baseline.log"), baseline.output)

// Flip the COPY to the pre-fix order.
const srcPath = join(copy, "src", "regress.ts")
const text = readFileSync(srcPath, "utf8")
if (text.includes(MARKER)) throw new Error("copy already carries the marker")
if (!text.includes(SEED_ANCHOR)) throw new Error("seed anchor not found in the copy")
const laneIdx = text.indexOf(LANE_LINE)
if (laneIdx === -1) throw new Error("post-gate createRegressDir line not found in the copy")
if (text.indexOf(LANE_LINE, laneIdx + 1) !== -1) throw new Error("ambiguous createRegressDir anchor")
writeFileSync(srcPath, text.replace(LANE_LINE, "\n").replace(SEED_ANCHOR, SEED_ANCHOR + "\n" + MARKER))

const flipped = runTests("pre-fix-order copy")
writeFileSync(join(here, "r1-prefix-control-flipped.log"), flipped.output)

// The shipped source must be untouched by this control.
const shipped = spawnSync("sha256sum", [join(source, "src", "regress.ts")], { encoding: "utf8" })
const shippedSha = (shipped.stdout ?? "").split(/\s+/)[0]

const result = {
  task: "t9 own R1 ordering negative control (disposable copy)",
  stamp: new Date().toISOString(),
  copy,
  shippedRegressTsSha256: shippedSha,
  baseline,
  flipped: { ...flipped, output: undefined },
  baselineOutputTail: baseline.output.trim().split("\n").slice(-6),
  flippedOutputTail: flipped.output.trim().split("\n").slice(-8),
  pass: Number(baseline.fail) === 0 && baseline.exitCode === 0 && Number(flipped.fail) > 0,
  partialOutputs: {
    baseline: join(here, "r1-prefix-control-baseline.log"),
    flipped: join(here, "r1-prefix-control-flipped.log"),
  },
}
writeFileSync(join(here, "r1-prefix-control.result.json"), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ baseline: { exit: baseline.exitCode, pass: baseline.pass, fail: baseline.fail }, flipped: { exit: flipped.exitCode, pass: flipped.pass, fail: flipped.fail }, shippedSha, pass: result.pass }, null, 2))
console.log("baseline tail:\n" + result.baselineOutputTail.join("\n"))
console.log("flipped tail:\n" + result.flippedOutputTail.join("\n"))
process.exit(result.pass ? 0 : 1)
