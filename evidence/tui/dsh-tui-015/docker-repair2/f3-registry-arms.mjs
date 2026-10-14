#!/usr/bin/env node
// f3-registry-arms.mjs — offline arms for FINDING F3 (step 01b graded npm METADATA only, so a registry
// whose TARBALLS blackhole passed the probe and then stalled the install).
//
// No Docker and no external network. The program under test is EXTRACTED from the shipped
// `docker/entrypoint.sh` (never a copy), so the bytes exercised are the bytes that ship; the registry it
// talks to is a DETERMINISTIC FAKE injected as `globalThis.fetch` (`f3-fetch-shim.mjs`), because this
// session's sandbox blackholes even loopback TCP. The PRE-FIX program is extracted from
// `git show HEAD:docker/entrypoint.sh` (a read-only git command) and used as the NEGATIVE CONTROL: the
// same blackholing registry must PASS the old probe and FAIL the new one.
//
// Usage: node evidence/tui/dsh-tui-015/docker-repair2/f3-registry-arms.mjs
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** The probe program marker inside the entrypoint, and the text that closes its single-quoted argument. */
const MARKER = "run_step 01b-npm-registry node -e '"
/** The text that starts the closing line of the `node -e` argument. */
const CLOSER = "\n' \"$NPM_REGISTRY\""
/** This driver's own directory, so the shim resolves wherever the driver is run from. */
const HERE = dirname(fileURLToPath(import.meta.url))
/** The fake registry, injected into every probe run. */
const SHIM = join(HERE, "f3-fetch-shim.mjs")
/** The tarball path the shipped entrypoint computes for the current harness pin. */
const TARBALL_PATH = "/@deepseek-ai/dsh/-/dsh-0.2.0-rc.2.tgz"

/** Extract the 01b probe program from an entrypoint text, or throw when the shape moved. */
function extractProgram(text) {
  /** Where the marker and the argument's closing quote sit. */
  const start = text.indexOf(MARKER)
  const from = start + MARKER.length
  const end = text.indexOf(CLOSER, from)
  if (start === -1 || end === -1) throw new Error("could not extract the 01b probe program from the entrypoint")
  return text.slice(from, end)
}

/** One arm's verdict bookkeeping. */
let failed = 0
/** Check one expectation and print it. */
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`[f3] ${name}=${ok}${detail === "" ? "" : " — " + detail}`)
}

/**
 * Run the probe program once, against the fake registry.
 *
 * @param program - The `node -e` program body to run.
 * @param spec - The fake registry's per-base-URL behaviour.
 * @param args - The probe's argv (registry, probeUrl, mirror, label, out, tarballPath, knob), with the
 *   two base URLs the spec keys on.
 * @returns The exit code, the stdout, the selection file's lines and the fake's counters.
 */
function runProbe(program, spec, args, outFile) {
  /** Where the fake writes its counters. */
  const statePath = outFile + ".state"
  writeFileSync(outFile, "")
  writeFileSync(statePath, "{}")
  /** The probe run, spawned exactly as the shell spawns it (plus the injected fake). */
  const run = spawnSync(process.execPath, ["--import", SHIM, "-e", program, ...args], {
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, F3_FAKE_SPEC: JSON.stringify(spec), F3_FAKE_STATE: statePath },
  })
  return {
    code: run.status,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    file: readFileSync(outFile, "utf8").split("\n"),
    state: JSON.parse(readFileSync(statePath, "utf8")),
    elapsed: 0,
  }
}

/** The shipped program, and the pre-fix one from git HEAD. */
const shipped = extractProgram(readFileSync("docker/entrypoint.sh", "utf8"))
const preFixRun = spawnSync("git", ["show", "HEAD:docker/entrypoint.sh"], { encoding: "utf8" })
const preFix = preFixRun.status === 0 ? extractProgram(preFixRun.stdout) : null
/** A scratch dir for the selection files and the fake's counters. */
const work = mkdtempSync(join(tmpdir(), "f3-arms-"))
/** The two bases the arms use; the fake keys its behaviour on them. */
const OFFICIAL = "http://official.invalid"
const MIRROR = "http://mirror.invalid"

check("shipped-program-has-no-single-quote", !shipped.includes("'"), "the shell single-quotes this argument, so one quote would terminate it early")
check("shipped-program-fetches-a-tarball", shipped.includes("tarballProbe") && shipped.includes("bytes=0-1023") && shipped.includes("TARBALL="), "the ranged GET and its log line are in the shipped program")
check("pre-fix-program-extracted", preFix !== null, preFix === null ? "git show HEAD failed" : "git show HEAD:docker/entrypoint.sh")
if (preFix !== null) check("pre-fix-program-has-no-tarball-arm", !preFix.includes("tarballProbe"), "the control really is the metadata-only probe")

/** The probe's argv for one arm: registry, metadata URL, mirror, label, out file, tarball path, knob. */
function argvFor(registry, label, outFile, knob) {
  return [registry, registry + "/@deepseek-ai%2fdsh", MIRROR, label, outFile, TARBALL_PATH, knob]
}

// ── A: metadata answers AND the tarball range answers (206) → pass, with the reading recorded ─────────
{
  /** The selection file this arm writes. */
  const out = join(work, "a.txt")
  const result = runProbe(shipped, { [OFFICIAL]: { meta: "ok", tarball: "range" } }, argvFor(OFFICIAL, "operator-set", out, OFFICIAL), out)
  check("A-exit-0", result.code === 0, `exit=${result.code}`)
  check("A-route-ok", result.file[1] === "operator-set-ok", `route=${result.file[1]}`)
  check("A-tarball-range-read", /http=206 bytes=1024/.test(result.file[2] ?? ""), `tarball=${result.file[2]}`)
  check("A-selection-file-has-3-lines", result.file.filter((line) => line !== "").length === 3, `lines=${JSON.stringify(result.file)}`)
  check("A-one-meta-one-tarball-request", result.state.meta[OFFICIAL] === 1 && result.state.tarball[OFFICIAL] === 1, `meta=${JSON.stringify(result.state.meta)} tarball=${JSON.stringify(result.state.tarball)}`)
  check("A-sends-a-range-header", result.state.ranges.join(",") === "bytes=0-1023", `ranges=${JSON.stringify(result.state.ranges)}`)
}

// ── A2: a mirror that IGNORES Range and streams a 200 → accepted, and only ONE chunk is read ─────────
{
  /** The selection file this arm writes. */
  const out = join(work, "a2.txt")
  const result = runProbe(shipped, { [OFFICIAL]: { meta: "ok", tarball: "whole" } }, argvFor(OFFICIAL, "operator-set", out, OFFICIAL), out)
  check("A2-exit-0", result.code === 0, `exit=${result.code}`)
  check("A2-route-ok", result.file[1] === "operator-set-ok", `route=${result.file[1]}`)
  check("A2-accepts-200-with-bytes", /http=200 bytes=\d+/.test(result.file[2] ?? ""), `tarball=${result.file[2]}`)
}

// ── A3: a 200 with ZERO bytes is a failure, never a pass ─────────────────────────────────────────────
{
  /** The selection file this arm writes. */
  const out = join(work, "a3.txt")
  const result = runProbe(shipped, { [OFFICIAL]: { meta: "ok", tarball: "empty" } }, argvFor(OFFICIAL, "operator-set", out, OFFICIAL), out)
  check("A3-exit-1", result.code === 1, `exit=${result.code}`)
  check("A3-route-tarball-blackholed", result.file[1] === "operator-set-tarball-blackholed", `route=${result.file[1]}`)
  check("A3-reading-says-zero-bytes", /bytes=0/.test(result.file[2] ?? ""), `tarball=${result.file[2]}`)
}

// ── B: metadata answers, the TARBALL hangs → the probe FAILS, bounded by its own abort ───────────────
{
  /** The selection file this arm writes. */
  const out = join(work, "b.txt")
  /** Wall clock, to show the 20 s abort bounds the wait (the shell's step budget is 900 s). */
  const started = Date.now()
  const result = runProbe(shipped, { [OFFICIAL]: { meta: "ok", tarball: "hang" } }, argvFor(OFFICIAL, "operator-set", out, OFFICIAL), out)
  /** How long the blackholed arm took. */
  const elapsed = Date.now() - started
  check("B-exit-1", result.code === 1, `exit=${result.code} elapsedMs=${elapsed}`)
  check("B-route-tarball-blackholed", result.file[1] === "operator-set-tarball-blackholed", `route=${result.file[1]}`)
  check("B-reading-says-failed", /FAILED/.test(result.file[2] ?? ""), `tarball=${result.file[2]}`)
  check("B-bounded-by-the-probes-own-abort", elapsed >= 19_000 && elapsed < 60_000, `elapsedMs=${elapsed} (the probe's 20 s abort, not the 90 s harness timeout)`)
  check("B-stdout-names-the-failure", /ROUTE=operator-set-tarball-blackholed/.test(result.stdout) && /TARBALL=.*FAILED/.test(result.stdout), result.stdout.trim().split("\n").join(" | "))
  if (preFix !== null) {
    // THE REPORTED FALSE PASS, reproduced: the metadata-only probe greens on the very registry whose
    // tarballs blackhole. If this ever stops being true, the fixture no longer reproduces FINDING F3.
    const controlOut = join(work, "b-control.txt")
    const control = runProbe(preFix, { [OFFICIAL]: { meta: "ok", tarball: "hang" } }, argvFor(OFFICIAL, "operator-set", controlOut, OFFICIAL), controlOut)
    check("B-control-pre-fix-PASSES-the-blackhole", control.code === 0 && control.file[1] === "operator-set-ok", `exit=${control.code} route=${control.file[1]} tarballRequests=${control.state.tarball[OFFICIAL] ?? 0}`)
  }
}

// ── C: NO registry knob → the tarball arm is SKIPPED WITH ITS REASON and costs no request ────────────
{
  /** The selection file this arm writes. */
  const out = join(work, "c.txt")
  const result = runProbe(shipped, { [OFFICIAL]: { meta: "ok", tarball: "hang" } }, argvFor(OFFICIAL, "official-registry", out, ""), out)
  check("C-exit-0", result.code === 0, `exit=${result.code}`)
  check("C-route-official-ok", result.file[1] === "official-registry-ok", `route=${result.file[1]}`)
  check("C-tarball-skipped-with-reason", /skipped reason=no-registry-knob/.test(result.file[2] ?? ""), `tarball=${result.file[2]}`)
  check("C-zero-tarball-requests", (result.state.tarball[OFFICIAL] ?? 0) === 0, `meta=${result.state.meta[OFFICIAL] ?? 0} tarball=${result.state.tarball[OFFICIAL] ?? 0} (offline-safe: nothing extra is paid without the knob)`)
}

// ── D: the official registry is dead, the FALLBACK mirror's tarball errors → must FAIL ───────────────
{
  /** The selection file this arm writes. */
  const out = join(work, "d.txt")
  const spec = { [OFFICIAL]: { meta: "500", tarball: "range" }, [MIRROR]: { meta: "ok", tarball: "error" } }
  const result = runProbe(shipped, spec, argvFor(OFFICIAL, "operator-set", out, OFFICIAL), out)
  check("D-exit-1", result.code === 1, `exit=${result.code}`)
  check("D-route-mirror-tarball-blackholed", result.file[1] === "mirror-tarball-blackholed", `route=${result.file[1]}`)
  check("D-reading-says-failed", /FAILED/.test(result.file[2] ?? ""), `tarball=${result.file[2]}`)
  check("D-tarball-request-went-to-the-mirror", (result.state.tarball[MIRROR] ?? 0) === 1 && (result.state.tarball[OFFICIAL] ?? 0) === 0, `tarball=${JSON.stringify(result.state.tarball)}`)
}

// ── E: neither registry answers METADATA → the pre-existing both-unreachable route is unchanged ──────
{
  /** The selection file this arm writes. */
  const out = join(work, "e.txt")
  const spec = { [OFFICIAL]: { meta: "500", tarball: "range" }, [MIRROR]: { meta: "500", tarball: "range" } }
  const result = runProbe(shipped, spec, argvFor(OFFICIAL, "official-registry", out, OFFICIAL), out)
  check("E-route-both-unreachable", result.file[1] === "both-unreachable", `route=${result.file[1]}`)
  check("E-no-tarball-request", (result.state.tarball[OFFICIAL] ?? 0) === 0 && (result.state.tarball[MIRROR] ?? 0) === 0, `tarball=${JSON.stringify(result.state.tarball)} (a probe only runs where metadata answered)`)
}

console.log(`[f3] FAILED=${failed}`)
console.log(`[f3] workdir=${work}`)
process.exit(failed === 0 ? 0 : 1)
