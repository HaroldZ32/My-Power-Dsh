#!/usr/bin/env node
// f3-registry-arms.mjs — the controls for FINDING (3): when step 01b's METADATA probe answers and the
// TARBALL range blackholes on the official/operator registry, the probe must try the MIRROR's metadata
// AND tarball before settling, select the mirror when both answer, and keep the old failure otherwise.
//
// No Docker and no external network. The program under test is EXTRACTED from the shipped
// `docker/entrypoint.sh` (never a copy), so the bytes exercised are the bytes that ship; the registry it
// talks to is the DETERMINISTIC FAKE injected as `globalThis.fetch` (`f3-fetch-shim.mjs`), because this
// session's sandbox blackholes even loopback TCP. THE CONTROL IS THE AUTHENTIC PRE-FIX PROGRAM, read from
// `git show HEAD:docker/entrypoint.sh` (a read-only git command; this wave's edits are uncommitted) — not
// a reconstruction — so the two programs differ by exactly the repairs this wave made.
//
// Usage: node evidence/tui/dsh-tui-015/coderabbit/docker/f3-registry-arms.mjs
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
/** The repository root, resolved from this driver's own location (…/evidence/tui/<slug>/coderabbit/docker). */
const REPO = join(HERE, "..", "..", "..", "..", "..")
/** The fake registry, injected into every probe run. */
const SHIM = join(HERE, "f3-fetch-shim.mjs")
/** The route this repair adds: the official/operator registry's tarball blackholed, the mirror served both. */
const NEW_ROUTE = "mirror-fallback-after-tarball-blackhole"
/** The pre-fix route: the probe settles on the registry it probed first. */
const OLD_ROUTE = "-tarball-blackholed"

/**
 * Extract the 01b probe program from an entrypoint text, or throw when the shape moved.
 *
 * @param text - The entrypoint source to slice.
 * @returns The `node -e` program body, verbatim.
 */
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

/**
 * Check one expectation and print it.
 *
 * @param name - The check's name, printed as `[f3] <name>=true|false`.
 * @param ok - Whether the expectation held.
 * @param detail - One line of observed evidence.
 */
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`[f3] ${name}=${ok}${detail === "" ? "" : " — " + detail}`)
}

/**
 * Run the probe program once, against the fake registry.
 *
 * @param program - The `node -e` program body to run.
 * @param spec - The fake registry's per-base-URL behaviour.
 * @param args - The probe's argv (registry, probeUrl, mirror, label, out, tarballPath, knob).
 * @param outFile - The selection file the program writes.
 * @returns The exit code, the stdout and the selection file's lines and the fake's counters.
 */
function runProbe(program, spec, args, outFile) {
  /** Where the fake writes its counters. */
  const statePath = outFile + ".state"
  writeFileSync(outFile, "")
  writeFileSync(statePath, "{}")
  /** The probe run, spawned exactly as the shell spawns it (plus the injected fake). */
  const run = spawnSync(process.execPath, ["--import", SHIM, "-e", program, ...args], {
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, F3_FAKE_SPEC: JSON.stringify(spec), F3_FAKE_STATE: statePath },
  })
  return {
    code: run.status,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    file: readFileSync(outFile, "utf8").split("\n"),
    state: JSON.parse(readFileSync(statePath, "utf8")),
  }
}

/** The shipped entrypoint, and the probe program this repair changed. */
const shippedEntrypoint = readFileSync(join(REPO, "docker", "entrypoint.sh"), "utf8")
const shipped = extractProgram(shippedEntrypoint)
/** The authentic PRE-FIX entrypoint from git HEAD (this wave's edits are uncommitted). */
const preFixRun = spawnSync("git", ["show", "HEAD:docker/entrypoint.sh"], { encoding: "utf8", cwd: REPO })
/** The pre-fix program, or null when git could not answer. */
const preFix = preFixRun.status === 0 ? extractProgram(preFixRun.stdout) : null
/** A scratch dir for the selection files and the fake's counters. */
const work = mkdtempSync(join(tmpdir(), "f3-arms-"))
/** The two bases the arms use; the fake keys its behaviour on them. */
const OFFICIAL = "http://official.invalid"
const MIRROR = "http://mirror.invalid"
/** The version pin the shipped entrypoint computes its tarball path from, read rather than hard-coded. */
const VERSION = /^DSH_VERSION="?\$\{MPD_E2E_DSH_VERSION:-([^}"]+)\}"?/m.exec(shippedEntrypoint)?.[1] ?? ""
/** The tarball path the shipped entrypoint computes for that pin. */
const TARBALL_PATH = `/@deepseek-ai/dsh/-/dsh-${VERSION}.tgz`

check("shipped-program-has-no-single-quote", !shipped.includes("'"), "the shell single-quotes this argument, so one quote would terminate it early")
check("shipped-program-carries-the-tarball-arm", shipped.includes("tarballProbe") && shipped.includes("bytes=0-1023") && shipped.includes("TARBALL="), "the ranged GET and its log line are in the shipped program")
check("shipped-program-carries-the-mirror-fallback", shipped.includes(NEW_ROUTE), `route=${NEW_ROUTE}`)
check("version-pin-read", VERSION !== "", `DSH_VERSION=${VERSION} tarballPath=${TARBALL_PATH}`)
check("pre-fix-program-extracted", preFix !== null, preFix === null ? `git show HEAD failed: ${preFixRun.stderr.trim()}` : "git show HEAD:docker/entrypoint.sh")
if (preFix !== null) {
  check("pre-fix-program-is-the-metadata-plus-tarball-probe", preFix.includes("tarballProbe") && !preFix.includes(NEW_ROUTE), "the control really is the pre-repair program: tarball arm yes, mirror fallback no")
  check("shipped-differs-from-pre-fix", shipped !== preFix, `shippedChars=${shipped.length} preFixChars=${preFix.length}`)
}

/**
 * The probe's argv for one arm: registry, metadata URL, mirror, label, out file, tarball path, knob.
 *
 * @param registry - The registry base URL the probe is pointed at.
 * @param label - The route label the probe prefixes its routes with.
 * @param outFile - The selection file the probe writes.
 * @param knob - `MPD_E2E_NPM_REGISTRY` as the shell would pass it.
 * @returns The argv array.
 */
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
}

// ── A2: a mirror that IGNORES Range and streams a 200 → accepted, and only ONE chunk is read ─────────
{
  /** The selection file this arm writes. */
  const out = join(work, "a2.txt")
  const result = runProbe(shipped, { [OFFICIAL]: { meta: "ok", tarball: "whole" } }, argvFor(OFFICIAL, "operator-set", out, OFFICIAL), out)
  check("A2-exit-0", result.code === 0, `exit=${result.code}`)
  check("A2-accepts-200-with-bytes", /http=200 bytes=\d+/.test(result.file[2] ?? ""), `tarball=${result.file[2]}`)
}

// ── A3: a 200 with ZERO bytes is a failure, never a pass ─────────────────────────────────────────────
{
  /** The selection file this arm writes. */
  const out = join(work, "a3.txt")
  const result = runProbe(shipped, { [OFFICIAL]: { meta: "ok", tarball: "empty" } }, argvFor(OFFICIAL, "operator-set", out, OFFICIAL), out)
  check("A3-exit-1", result.code === 1, `exit=${result.code}`)
  check("A3-route-blackholed", result.file[1] === "operator-set-tarball-blackholed", `route=${result.file[1]}`)
  check("A3-reading-says-zero-bytes", /bytes=0/.test(result.file[2] ?? ""), `tarball=${result.file[2]}`)
}

// ── NEW 1: the official/operator TARBALL blackholes and the MIRROR serves metadata + tarball → mirror ─
{
  /** The selection file this arm writes. */
  const out = join(work, "new1.txt")
  /** The official metadata answers while its tarball blackholes; the mirror answers BOTH. */
  const spec = { [OFFICIAL]: { meta: "ok", tarball: "hang" }, [MIRROR]: { meta: "ok", tarball: "range" } }
  const result = runProbe(shipped, spec, argvFor(OFFICIAL, "operator-set", out, OFFICIAL), out)
  check("NEW1-exit-0", result.code === 0, `exit=${result.code}`)
  check("NEW1-selects-the-MIRROR", result.file[0] === MIRROR, `selected=${result.file[0]}`)
  check("NEW1-route-names-the-fallback", result.file[1] === NEW_ROUTE, `route=${result.file[1]}`)
  check("NEW1-reading-is-the-mirrors-tarball", /http=206 bytes=1024/.test(result.file[2] ?? ""), `tarball=${result.file[2]}`)
  check("NEW1-probes-both-registries-metadata", result.state.meta[OFFICIAL] === 1 && result.state.meta[MIRROR] === 1, `meta=${JSON.stringify(result.state.meta)}`)
  check("NEW1-ranges-both-tarballs", result.state.tarball[OFFICIAL] === 1 && result.state.tarball[MIRROR] === 1, `tarball=${JSON.stringify(result.state.tarball)}`)
  check("NEW1-stdout-names-the-fallback", new RegExp("ROUTE=" + NEW_ROUTE).test(result.stdout) && /TARBALL=http=206/.test(result.stdout), result.stdout.trim().split("\n").join(" | "))
  if (preFix !== null) {
    // THE LOAD-BEARING PROOF: the pre-fix program, on the very registry set the mirror could serve,
    // settles on the official registry and exits 1 — and never even asks the mirror for its tarball.
    const controlOut = join(work, "new1-control.txt")
    const control = runProbe(preFix, spec, argvFor(OFFICIAL, "operator-set", controlOut, OFFICIAL), controlOut)
    check("NEW1-control-pre-fix-FAILS", control.code === 1 && control.file[0] === OFFICIAL && control.file[1] === "operator-set-tarball-blackholed", `exit=${control.code} selected=${control.file[0]} route=${control.file[1]}`)
    check("NEW1-control-never-probes-the-mirror-tarball", (control.state.tarball[MIRROR] ?? 0) === 0, `tarball=${JSON.stringify(control.state.tarball)} (the fallback is what changes the outcome)`)
  }
}

// ── NEW 2: BOTH tarballs blackhole → the current failure behaviour is kept ───────────────────────────
{
  /** The selection file this arm writes. */
  const out = join(work, "new2.txt")
  /** Both metadata endpoints answer; neither tarball ever delivers a byte. */
  const spec = { [OFFICIAL]: { meta: "ok", tarball: "hang" }, [MIRROR]: { meta: "ok", tarball: "hang" } }
  const result = runProbe(shipped, spec, argvFor(OFFICIAL, "operator-set", out, OFFICIAL), out)
  check("NEW2-exit-1", result.code === 1, `exit=${result.code}`)
  check("NEW2-settles-on-the-probed-registry", result.file[0] === OFFICIAL, `selected=${result.file[0]}`)
  check("NEW2-route-is-the-existing-blackholed-route", result.file[1] === "operator-set" + OLD_ROUTE, `route=${result.file[1]}`)
  check("NEW2-reading-says-failed", /FAILED/.test(result.file[2] ?? ""), `tarball=${result.file[2]}`)
  check("NEW2-probes-the-mirror-before-settling", result.state.tarball[OFFICIAL] === 1 && result.state.tarball[MIRROR] === 1, `tarball=${JSON.stringify(result.state.tarball)} (metadata AND tarball are both probed on the mirror)`)
  if (preFix !== null) {
    /** The pre-fix program on the same blackholed spec, to show the settled outcome is unchanged. */
    const controlOut = join(work, "new2-control.txt")
    const control = runProbe(preFix, spec, argvFor(OFFICIAL, "operator-set", controlOut, OFFICIAL), controlOut)
    check("NEW2-control-settles-identically", control.code === 1 && control.file[0] === result.file[0] && control.file[1] === result.file[1], `exit=${control.code} selected=${control.file[0]} route=${control.file[1]}`)
  }
}

// ── NEW 3: the mirror's METADATA is dead → no mirror tarball is asked for, the old failure stands ─────
{
  /** The selection file this arm writes. */
  const out = join(work, "new3.txt")
  /** The official tarball answers 200 with zero bytes (a blackhole that fails fast); the mirror's metadata is dead. */
  const spec = { [OFFICIAL]: { meta: "ok", tarball: "empty" }, [MIRROR]: { meta: "500", tarball: "range" } }
  const result = runProbe(shipped, spec, argvFor(OFFICIAL, "operator-set", out, OFFICIAL), out)
  check("NEW3-exit-1", result.code === 1, `exit=${result.code}`)
  check("NEW3-route-is-the-existing-blackholed-route", result.file[1] === "operator-set" + OLD_ROUTE, `route=${result.file[1]}`)
  check("NEW3-mirror-metadata-was-probed", result.state.meta[MIRROR] === 1, `meta=${JSON.stringify(result.state.meta)}`)
  check("NEW3-mirror-tarball-was-NOT-probed", (result.state.tarball[MIRROR] ?? 0) === 0, `tarball=${JSON.stringify(result.state.tarball)} (the fallback is metadata AND tarball, never either alone)`)
}

// ── D: the official metadata is DEAD and the mirror's tarball errors → the pre-existing route is kept ─
{
  /** The selection file this arm writes. */
  const out = join(work, "d.txt")
  const spec = { [OFFICIAL]: { meta: "500", tarball: "range" }, [MIRROR]: { meta: "ok", tarball: "error" } }
  const result = runProbe(shipped, spec, argvFor(OFFICIAL, "operator-set", out, OFFICIAL), out)
  check("D-exit-1", result.code === 1, `exit=${result.code}`)
  check("D-route-mirror-tarball-blackholed", result.file[1] === "mirror-tarball-blackholed", `route=${result.file[1]}`)
  check("D-tarball-request-went-to-the-mirror", (result.state.tarball[MIRROR] ?? 0) === 1 && (result.state.tarball[OFFICIAL] ?? 0) === 0, `tarball=${JSON.stringify(result.state.tarball)}`)
}

// ── D2: the official metadata is DEAD and the mirror serves both → the pre-existing mirror-fallback ───
{
  /** The selection file this arm writes. */
  const out = join(work, "d2.txt")
  const spec = { [OFFICIAL]: { meta: "500", tarball: "range" }, [MIRROR]: { meta: "ok", tarball: "range" } }
  const result = runProbe(shipped, spec, argvFor(OFFICIAL, "operator-set", out, OFFICIAL), out)
  check("D2-exit-0", result.code === 0, `exit=${result.code}`)
  check("D2-route-mirror-fallback", result.file[1] === "mirror-fallback", `route=${result.file[1]} (the pre-existing route and its wording are untouched)`)
}

// ── E: neither registry answers METADATA → the pre-existing both-unreachable route is unchanged ──────
{
  /** The selection file this arm writes. */
  const out = join(work, "e.txt")
  const spec = { [OFFICIAL]: { meta: "500", tarball: "range" }, [MIRROR]: { meta: "500", tarball: "range" } }
  const result = runProbe(shipped, spec, argvFor(OFFICIAL, "official-registry", out, OFFICIAL), out)
  check("E-route-both-unreachable", result.file[1] === "both-unreachable", `route=${result.file[1]}`)
  check("E-no-tarball-request", (result.state.tarball[OFFICIAL] ?? 0) === 0 && (result.state.tarball[MIRROR] ?? 0) === 0, `tarball=${JSON.stringify(result.state.tarball)} (a tarball probe only runs where metadata answered)`)
}

// ── C: NO registry knob → the tarball arm is SKIPPED WITH ITS REASON and costs no request ────────────
{
  /** The selection file this arm writes. */
  const out = join(work, "c.txt")
  const result = runProbe(shipped, { [OFFICIAL]: { meta: "ok", tarball: "hang" } }, argvFor(OFFICIAL, "official-registry", out, ""), out)
  check("C-exit-0", result.code === 0, `exit=${result.code}`)
  check("C-route-official-ok", result.file[1] === "official-registry-ok", `route=${result.file[1]}`)
  check("C-tarball-skipped-with-reason", /skipped reason=no-registry-knob/.test(result.file[2] ?? ""), `tarball=${result.file[2]}`)
  check("C-zero-tarball-requests", (result.state.tarball[OFFICIAL] ?? 0) === 0 && (result.state.tarball[MIRROR] ?? 0) === 0, `tarball=${JSON.stringify(result.state.tarball)} (offline-safe: nothing extra is paid without the knob)`)
}

console.log(`[f3] FAILED=${failed}`)
console.log(`[f3] workdir=${work}`)
process.exit(failed === 0 ? 0 : 1)
