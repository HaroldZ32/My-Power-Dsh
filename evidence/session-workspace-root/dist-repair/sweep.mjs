#!/usr/bin/env node
// t12 sweep: for every packages/*/dist/index.js, build packages/<p>/src/index.ts to a temp
// path and diff it against the committed bytes, ignoring only the leading build-banner
// comment line (the contract's freeze). Verdicts:
//   FRESH (byte-identical)  - committed dist equals the fresh build byte for byte
//   FRESH (banner-only)     - equal after dropping the leading banner line
//   STALE                   - real body difference (raw diff printed)
// Modes: default = dry sweep; --apply = rebuild every STALE package in place;
//        --clean-room = do a SECOND independent build pass and report committed vs pass2
//        and pass1 vs pass2 (byte identity), proving the rebuild is reproducible.
// This script only READS src/ and WRITES the rebuilt dists (in --apply). It never edits src.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

const repoRoot = process.cwd()
const TMP = join(process.env.TMPDIR || "/tmp", "mpd-dist-sweep")
const args = new Set(process.argv.slice(2))
const APPLY = args.has("--apply")
const CLEAN_ROOM = args.has("--clean-room")
const BUILD_ARGS = ["build", "--target", "node", "--format", "esm"]

const sha = (buf) => createHash("sha256").update(buf).digest("hex")
const stripBanner = (text) => {
  const nl = text.indexOf("\n")
  if (nl === -1) return ""
  const first = text.slice(0, nl)
  return first.startsWith("// ") ? text.slice(nl + 1) : text
}

mkdirSync(join(TMP, "pass1"), { recursive: true })
if (CLEAN_ROOM) mkdirSync(join(TMP, "pass2"), { recursive: true })
rmSync(join(TMP, "pass1"), { recursive: true, force: true })
mkdirSync(join(TMP, "pass1"), { recursive: true })
if (CLEAN_ROOM) {
  rmSync(join(TMP, "pass2"), { recursive: true, force: true })
  mkdirSync(join(TMP, "pass2"), { recursive: true })
}

const pkgs = readdirSync(join(repoRoot, "packages"))
  .filter((p) => existsSync(join(repoRoot, "packages", p, "dist", "index.js")))
  .sort()

const build = (entryRel, outFile) => {
  execFileSync("bun", [...BUILD_ARGS, entryRel, "--outfile", outFile], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] })
  return readFileSync(outFile)
}

const results = []
for (const p of pkgs) {
  const distRel = join("packages", p, "dist", "index.js")
  const entryRel = join("packages", p, "src", "index.ts")
  if (!existsSync(join(repoRoot, entryRel))) {
    results.push({ p, verdict: "NO-SRC-ENTRY", note: entryRel + " missing; cannot rebuild -> finding" })
    continue
  }
  const out1 = join(TMP, "pass1", p + ".js")
  const cmd = "bun " + [...BUILD_ARGS, entryRel, "--outfile", out1].join(" ")
  let fresh
  try { fresh = build(entryRel, out1) } catch (e) {
    results.push({ p, cmd, verdict: "BUILD-FAILED", note: String(e?.stderr ?? e?.message ?? e) })
    continue
  }
  const committed = readFileSync(join(repoRoot, distRel))
  const fullEqual = sha(committed) === sha(fresh)
  const bodyEqual = stripBanner(committed.toString("utf8")) === stripBanner(fresh.toString("utf8"))
  const verdict = fullEqual ? "FRESH (byte-identical)" : bodyEqual ? "FRESH (banner-only)" : "STALE"
  const rec = {
    p, cmd, distRel, verdict,
    committedSha: sha(committed).slice(0, 16), freshSha: sha(fresh).slice(0, 16),
    committedBytes: committed.length, freshBytes: fresh.length,
  }
  if (!bodyEqual) {
    // raw diff via the system `diff` (banner line dropped from both sides first)
    const ca = join(TMP, "committed.body")
    const cb = join(TMP, "fresh.body")
    writeFileSync(ca, stripBanner(committed.toString("utf8")))
    writeFileSync(cb, stripBanner(fresh.toString("utf8")))
    let d = ""
    try { d = execFileSync("diff", [ca, cb], { encoding: "utf8" }) } catch (e) { d = String(e.stdout ?? "") }
    rec.bodyDiff = d.replace(/\n+$/, "")
    rec.bodyDiffLineCount = rec.bodyDiff ? rec.bodyDiff.split("\n").length : 0
  }
  if (CLEAN_ROOM) {
    const out2 = join(TMP, "pass2", p + ".js")
    const fresh2 = build(entryRel, out2)
    rec.pass1VsPass2ByteIdentical = sha(fresh2) === sha(fresh)
    rec.committedVsPass2ByteIdentical = sha(fresh2) === sha(committed)
    rec.pass2Sha = sha(fresh2).slice(0, 16)
  }
  results.push(rec)
}

console.log("=== dist sweep ===")
console.log("repoRoot=" + repoRoot + "  mode=" + (APPLY ? "apply" : CLEAN_ROOM ? "clean-room" : "dry"))
for (const r of results) {
  console.log("")
  console.log(r.p + ": " + r.verdict)
  if (r.cmd) console.log("  cmd: " + r.cmd)
  if (r.committedSha) console.log("  sha256 committed=" + r.committedSha + " fresh=" + r.freshSha + " (" + r.committedBytes + "B vs " + r.freshBytes + "B)")
  if (r.bodyDiff) { console.log("  RAW BODY DIFF (banner line excepted):"); for (const l of r.bodyDiff.split("\n")) console.log("    " + l) }
  if (r.pass2Sha) console.log("  clean-room: pass2sha=" + r.pass2Sha + " pass1==pass2=" + r.pass1VsPass2ByteIdentical + " committed==pass2=" + r.committedVsPass2ByteIdentical)
  if (r.note) console.log("  note: " + r.note)
}
const stale = results.filter((r) => r.verdict === "STALE")
const noEntry = results.filter((r) => r.verdict !== "STALE" && r.verdict.startsWith("NO-SRC") === false && r.verdict !== "FRESH (byte-identical)" && r.verdict !== "FRESH (banner-only)")
console.log("")
console.log("=== summary ===")
console.log("packages with dist/index.js: " + results.length)
console.log("FRESH byte-identical: " + results.filter((r) => r.verdict === "FRESH (byte-identical)").length)
console.log("FRESH banner-only: " + results.filter((r) => r.verdict === "FRESH (banner-only)").length)
console.log("STALE: " + stale.length + (stale.length ? " -> " + stale.map((s) => s.p).join(", ") : ""))
if (noEntry.length) console.log("ATTENTION: " + noEntry.map((s) => s.p + "=" + s.verdict).join(", "))
if (CLEAN_ROOM) {
  console.log("clean-room pass1==pass2 byte-identical: " + results.filter((r) => r.pass1VsPass2ByteIdentical).length + "/" + results.filter((r) => r.pass1VsPass2ByteIdentical !== undefined).length)
  console.log("clean-room committed==pass2 byte-identical: " + results.filter((r) => r.committedVsPass2ByteIdentical).length + "/" + results.filter((r) => r.committedVsPass2ByteIdentical !== undefined).length)
}

if (APPLY && stale.length) {
  console.log("")
  console.log("=== applying rebuild to " + stale.length + " STALE package(s) ===")
  for (const s of stale) {
    const outFile = join(repoRoot, s.distRel)
    const rel = s.distRel.replace(/\\/g, "/")
    execFileSync("bun", [...BUILD_ARGS, join("packages", s.p, "src", "index.ts"), "--outfile", rel], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    console.log("  rebuilt " + rel + " (" + readFileSync(outFile).length + "B)")
  }
}
