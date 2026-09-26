#!/usr/bin/env node
// scripts/docker-e2e.mjs — the HOST side of the Docker client-install E2E (task lane D).
//
// ONE COMMAND:
//     node scripts/docker-e2e.mjs
// It builds docker/Dockerfile through docker/docker-compose.yml (build context = THE REPOSITORY
// ROOT, filtered by docker/Dockerfile.dockerignore), runs the `mpd-client` compose service, streams
// the container's console to this terminal, and lands the evidence under
//     evidence/docker/client-install/<UTC stamp>/{result.json, output.log, console.log, driver.json}
// exiting non-zero when any assertion in result.json is FALSE.
//
// NOTHING IS EVER COPIED INTO THE REPOSITORY. An earlier shape of this driver staged a working-tree
// copy into docker/src as the build context; that copy sat inside the repo and was picked up by
// every tree-walking gate and by `bun test`'s globs (measured 2026-09-27, lead-reported). The build
// context is now the repository root itself and `docker/Dockerfile.dockerignore` does the
// filtering, so no scratch copy exists anywhere on disk.
//
// WHY BUILDX_CONFIG: the driver runs under a sandbox that permits writes only inside the repository,
// while the docker CLI writes buildx state under $DOCKER_CONFIG (default ~/.docker/buildx) — a
// `docker build` therefore died with `mkdir /home/<user>/.docker/buildx: read-only file system`
// (measured 2026-09-27). BUILDX_CONFIG is pointed at a private writable temp dir for the whole run,
// and the real ~/.docker keeps its context (the rootless daemon endpoint), so no credential file is
// copied anywhere.
//
// Exit codes: 0 every assertion true or explicitly null; 1 at least one assertion FALSE; 2 the run
// produced no result.json at all (the container never reached the reporter); 3 a host prerequisite
// (docker / compose / daemon) is missing.
//
// OFFLINE SELF-TEST: `node scripts/docker-e2e.mjs --self-test` needs no docker and no network. It
// exercises this file's own pure helpers (timestamp, evidence path, redaction, verdict/exit
// mapping) plus the static rules of the compose file, the Dockerfile, the ignore file and the
// entrypoint, and round-trips the evidence writer — because a driver whose own bookkeeping is
// unchecked produces confident nonsense.
import { spawn, spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const SELF = fileURLToPath(import.meta.url)
const REPO = dirname(dirname(SELF))
const DOCKER_DIR = join(REPO, "docker")
const COMPOSE_FILE = join(DOCKER_DIR, "docker-compose.yml")
const DOCKERFILE = join(DOCKER_DIR, "Dockerfile")
const DOCKERIGNORE = join(DOCKER_DIR, "Dockerfile.dockerignore")
const SELFTEST_DIR = join(DOCKER_DIR, ".selftest")
const IMAGE = process.env.MPD_DOCKER_IMAGE ?? "mpd-docker-e2e:local"
const SERVICE = "mpd-client"

// ── pure helpers (all exercised by --self-test) ───────────────────────────────

/** The evidence directory stamp: UTC, second precision, filesystem-safe. */
export function utcStamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-")
}

/** evidence/docker/client-install/<stamp> — the one place this case writes evidence. */
export function evidenceDir(repo, date = new Date()) {
  return join(repo, "evidence", "docker", "client-install", utcStamp(date))
}

/**
 * Token scrubbing for everything the driver writes (AGENTS.md §10). The container's reporter
 * redacts too; this is the second, independent pass, because the driver echoes raw container
 * stdout and a redaction rule with one implementation is a rule with one point of failure.
 */
export function redact(text) {
  return String(text)
    .replace(/([?&]token=)[A-Za-z0-9._~+/=-]+/g, "$1<redacted>")
    .replace(/(\btoken\s*[:=]\s*)["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi, "$1<redacted>")
    .replace(/(\bsk-)[A-Za-z0-9_-]{12,}/g, "$1<redacted>")
}

/** The verdict → process exit code mapping, stated once. */
export function decideExit(result) {
  if (result === null || result === undefined || typeof result.ok !== "boolean") return 2
  return result.ok ? 0 : 1
}

/** A one-line human summary of a result.json body. */
export function summarize(result) {
  if (result === null || result === undefined) return "no result.json"
  const summary = result.summary ?? {}
  const failed = (result.assertions ?? []).filter((a) => a.ok === false).map((a) => a.name)
  const nulls = (result.assertions ?? []).filter((a) => a.ok === null).map((a) => a.name)
  return `ok=${result.ok} complete=${result.complete} passed=${summary.passed ?? "?"} failed=${summary.failed ?? failed.length}`
    + ` null=${summary.null ?? nulls.length}`
    + (failed.length > 0 ? ` FAILED=[${failed.join(",")}]` : "")
    + (nulls.length > 0 ? ` NULL=[${nulls.join(",")}]` : "")
}

/**
 * The environment every docker child gets: BUILDX_CONFIG pointed at a writable directory, because
 * the sandbox denies writes to the default ~/.docker/buildx and a build then fails before it
 * starts. The caller's own BUILDX_CONFIG wins.
 */
export function buildxEnv(base = process.env, dir = mkdtempSync(join(tmpdir(), "mpd-docker-e2e-buildx-"))) {
  return {
    env: { ...base, BUILDX_CONFIG: base.BUILDX_CONFIG ?? dir },
    dir,
    owned: base.BUILDX_CONFIG === undefined,
  }
}

// ── host tooling ─────────────────────────────────────────────────────────────

/** Resolve `docker`/`docker compose` without throwing; a missing binary is a precise message. */
export function resolveDocker(env = process.env) {
  const path = String(env.PATH ?? "")
  const dirs = path.split(":").filter((d) => d !== "")
  const found = dirs.map((d) => join(d, "docker")).find((candidate) => existsSync(candidate)) ?? ""
  if (found === "") return { ok: false, reason: "no `docker` on PATH (install Docker and put its bin directory on PATH)" }
  const version = spawnSync(found, ["--version"], { encoding: "utf8" })
  if (version.status !== 0) return { ok: false, reason: `docker --version failed: ${version.stderr ?? ""}`.trim() }
  const compose = spawnSync(found, ["compose", "version"], { encoding: "utf8" })
  if (compose.status !== 0) return { ok: false, reason: "the docker compose plugin is not available (`docker compose version` failed)" }
  return { ok: true, docker: found, version: String(version.stdout ?? "").trim(), compose: String(compose.stdout ?? "").trim() }
}

/** Stream a child's stdout+stderr to this terminal AND to a file, honouring redaction. */
function runStreaming(command, args, { cwd, env, logFile }) {
  return new Promise((resolve) => {
    // Appended chunk by chunk, never buffered to the end: an interrupted run must still leave the
    // raw console of whatever it managed to do.
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    const onData = (buffer) => {
      const text = redact(buffer.toString("utf8"))
      appendFileSync(logFile, text)
      process.stdout.write(text)
    }
    child.stdout.on("data", onData)
    child.stderr.on("data", onData)
    child.on("error", (error) => {
      const text = `\n[driver] failed to spawn ${command}: ${String(error.message)}\n`
      appendFileSync(logFile, text)
      process.stdout.write(text)
      resolve({ status: 127, signal: null })
    })
    child.on("close", (status, signal) => resolve({ status, signal }))
  })
}

/** `docker image inspect` size in MiB, or null when the image is absent. */
function imageSizeMiB(docker, env) {
  const result = spawnSync(docker, ["image", "inspect", IMAGE, "--format", "{{.Size}}"], { encoding: "utf8", env })
  if (result.status !== 0) return null
  const bytes = Number(String(result.stdout).trim())
  return Number.isFinite(bytes) ? Math.round(bytes / 1048576) : null
}

// ── self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  const failures = []
  const check = (name, condition, detail = "") => {
    if (condition) { console.log(`[self-test] ok   ${name}`) }
    else { failures.push(`${name} ${detail}`); console.error(`[self-test] FAIL ${name} ${detail}`) }
  }

  // 1. stamp + evidence path
  const stamp = utcStamp(new Date("2026-01-02T03:04:05.678Z"))
  check("utcStamp is a filesystem-safe UTC second stamp", /^2026-01-02T03-04-05Z$/.test(stamp), stamp)
  check("utcStamp has no colons", !stamp.includes(":"), stamp)
  const dir = evidenceDir("/repo", new Date("2026-01-02T03:04:05.678Z"))
  check("evidenceDir lands under evidence/docker/client-install", dir === "/repo/evidence/docker/client-install/2026-01-02T03-04-05Z", dir)

  // 2. redaction
  check("redact removes a boot URL token", redact("dsh web: http://127.0.0.1:3197/?token=AbC-123_xyz") === "dsh web: http://127.0.0.1:3197/?token=<redacted>")
  check("redact removes an api-key-shaped value", !redact("key=sk-abcdefghijklmnopqrst").includes("abcdefghijklmnopqrst"))
  check("redact leaves ordinary text alone", redact("exit=0 seconds=12") === "exit=0 seconds=12")

  // 3. verdict → exit code
  check("decideExit(ok) === 0", decideExit({ ok: true }) === 0)
  check("decideExit(failed) === 1", decideExit({ ok: false }) === 1)
  check("decideExit(null) === 2", decideExit(null) === 2)
  check("summarize names the failed assertion", summarize({ ok: false, complete: false, summary: {}, assertions: [{ name: "boot.x", ok: false }, { name: "y", ok: null }] }).includes("FAILED=[boot.x]"))

  // 4. the driver never stages a copy of the repository inside the repository (lead-reported
  //    defect, measured 2026-09-27: a docker/src copy poisoned `bun test`'s globs and every
  //    tree-walking gate). Nothing under docker/ may be a repository copy.
  for (const forbidden of ["src", "repo", "checkout", "context"]) {
    check(`docker/${forbidden} does not exist`, !existsSync(join(DOCKER_DIR, forbidden)))
  }

  // 5. compose isolation rules (static, on the EFFECTIVE config: comments are prose about the rule,
  //    not the rule, so they are stripped before the scan).
  const stripComments = (text) => text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.replace(/\s+#.*$/, ""))
    .join("\n")
  const compose = stripComments(readFileSync(COMPOSE_FILE, "utf8"))
  for (const forbidden of ["$HOME", "~/.dsh", "~/.mpd", "$DSH_HOME", "/root/.dsh", "/root/.mpd", ".agents"]) {
    check(`compose does not reference ${forbidden}`, !compose.includes(forbidden))
  }
  const volumeLines = compose.split("\n").filter((line) => /^\s*-\s+\S+:\S+\s*$/.test(line))
  check("compose declares exactly one bind mount", volumeLines.length === 1, JSON.stringify(volumeLines))
  check("the only bind mount is the evidence /out mount", volumeLines.length === 1 && volumeLines[0].includes(":/out"), JSON.stringify(volumeLines))
  check("compose builds from the REPOSITORY ROOT context", /^\s*context:\s*\.\.\s*$/m.test(compose))
  check("compose points at docker/Dockerfile", /^\s*dockerfile:\s*docker\/Dockerfile\s*$/m.test(compose))
  check("compose names the image", /^\s*image:\s*\S+/m.test(compose))
  check("compose declares exactly one service", (compose.match(/^ {2}[a-z][a-z0-9-]*:$/gm) ?? []).length === 1, JSON.stringify(compose.match(/^ {2}[a-z][a-z0-9-]*:$/gm)))

  // 6. Dockerfile base image + context copy
  const dockerfile = readFileSync(DOCKERFILE, "utf8")
  const fromLine = dockerfile.split("\n").find((line) => /^FROM\s/.test(line))
  check("Dockerfile FROM ubuntu:24.04", fromLine === "FROM ubuntu:24.04", String(fromLine))
  check("Dockerfile copies the context (never a bind mount)", dockerfile.includes("COPY . /src/"))

  // 7. the ignore file: it is what keeps host state OUT of the image, and it must not eat the
  //    `packages/*/dist` trees the container is supposed to rebuild.
  const ignore = stripComments(readFileSync(DOCKERIGNORE, "utf8")).split("\n").map((l) => l.trim()).filter((l) => l !== "")
  for (const pattern of [".git", "node_modules", "**/node_modules", "dist", "evidence", ".toolchain"]) {
    check(`Dockerfile.dockerignore excludes ${pattern}`, ignore.includes(pattern))
  }
  check("Dockerfile.dockerignore does not exclude packages/", !ignore.some((p) => /^!?packages\//.test(p) || p === "packages"))

  // 8. entrypoint obligations
  const entrypoint = readFileSync(join(DOCKER_DIR, "entrypoint.sh"), "utf8")
  check("entrypoint is strict bash", entrypoint.includes("set -euo pipefail"))
  check("entrypoint performs the real client install", entrypoint.includes("dsh plugin --profile web add ."))
  check("entrypoint installs the harness at a pin", /npm i -g "@deepseek-ai\/dsh@\$DSH_VERSION"/.test(entrypoint))
  check("entrypoint isolates HOME and DSH_HOME", entrypoint.includes("export HOME=\"$SANDBOX_HOME\"") && entrypoint.includes("export DSH_HOME=\"$SANDBOX_DSH\""))
  check("entrypoint never copies a credential file", !/\b(cp|scp|install|rsync|cat)\b[^\n]*credential/i.test(entrypoint))
  check("entrypoint never reads the real harness home", !/~\/\.dsh/.test(entrypoint) && !/\$HOME\/\.dsh/.test(entrypoint))
  check("entrypoint asserts the build context was filtered", /record copy\.contextFiltered/.test(entrypoint))
  check("entrypoint asserts the preset mount through /api/session/create", entrypoint.includes("/api/session/create"))
  check("entrypoint records the un-provable LLM assertion as null", /record boot\.llmTurn null/.test(entrypoint))

  // 9. BUILDX_CONFIG: the sandbox cannot write ~/.docker/buildx, so every docker child must run
  //    with a writable buildx state dir and the caller's own value must win.
  const injected = buildxEnv({ PATH: "/usr/bin" }, "/tmp/probe-buildx")
  check("buildxEnv injects a writable BUILDX_CONFIG", injected.env.BUILDX_CONFIG === "/tmp/probe-buildx" && injected.owned === true)
  const kept = buildxEnv({ PATH: "/usr/bin", BUILDX_CONFIG: "/caller" }, "/tmp/ignored")
  check("buildxEnv keeps the caller's BUILDX_CONFIG", kept.env.BUILDX_CONFIG === "/caller" && kept.owned === false)

  // 10. evidence writer round-trip (offline, no docker)
  rmSync(SELFTEST_DIR, { recursive: true, force: true })
  const fixture = join(SELFTEST_DIR, "evidence")
  mkdirSync(fixture, { recursive: true })
  const body = { ok: true, summary: { passed: 1, failed: 0, null: 0 }, assertions: [{ name: "x", ok: true }] }
  writeFileSync(join(fixture, "result.json"), JSON.stringify(body, null, 2) + "\n")
  writeFileSync(join(fixture, "output.log"), redact("dsh web: http://127.0.0.1:3197/?token=SECRET123\n") + "\n")
  const readBack = JSON.parse(readFileSync(join(fixture, "result.json"), "utf8"))
  check("result.json round-trips byte-identically", JSON.stringify(readBack) === JSON.stringify(body))
  check("output.log is written redacted", !readFileSync(join(fixture, "output.log"), "utf8").includes("SECRET123"))

  // 11. missing docker is a precise message, not a throw
  const missing = resolveDocker({ PATH: "/nonexistent-bin" })
  check("resolveDocker reports a missing docker precisely", missing.ok === false && missing.reason.includes("no `docker` on PATH"), JSON.stringify(missing))

  // 12. NEGATIVE CONTROL for the evidence scrub guard: plant a token-shaped value through the
  //     reporter's own hook and assert the guard FIRES (red verdict, scrubbed artifacts, no shape
  //     left). Without this arm the guard would be an assertion nobody ever saw fail.
  const leakWork = join(SELFTEST_DIR, "leak", "work")
  const leakOut = join(SELFTEST_DIR, "leak", "out")
  mkdirSync(join(leakWork, "steps"), { recursive: true })
  mkdirSync(leakOut, { recursive: true })
  writeFileSync(join(leakWork, "assertions.ndjson"), JSON.stringify({ name: "harness.version", ok: true, reason: "control", raw: "0.1.7-rc.2" }) + "\n")
  writeFileSync(join(leakWork, "steps.tsv"), "01-apt\t0\t1\t01.log\tcontrol\n")
  writeFileSync(join(leakWork, "steps", "01.log"), "control step output\n")
  const leaked = spawnSync(process.execPath, [join(DOCKER_DIR, "lib", "report.mjs"), "--work", leakWork, "--out", leakOut], {
    encoding: "utf8",
    env: { ...process.env, MPD_E2E_FORCE_LEAK: "1" },
  })
  const leakResult = existsSync(join(leakOut, "result.json")) ? JSON.parse(readFileSync(join(leakOut, "result.json"), "utf8")) : null
  check("the scrub guard fails a planted leak (exit 1)", leaked.status === 1, `status=${leaked.status}`)
  check("the scrub guard marks the verdict red", leakResult !== null && leakResult.ok === false && leakResult.evidenceScrubbed === false, JSON.stringify(leakResult?.summary ?? null))
  check("the guard names itself in failedNames", (leakResult?.summary?.failedNames ?? []).includes("isolation.evidenceScrubbed"))
  const leakArtifacts = leakResult === null ? "" : readFileSync(join(leakOut, "output.log"), "utf8") + readFileSync(join(leakOut, "result.json"), "utf8")
  check("no planted shape survives into the artifacts", !leakArtifacts.includes("NOTAREDACTEDLEAK"))

  // 13. the CLEAN path must also carry the scrub verdict. Measured defect 2026-09-27: result.json was
  //     rendered before `evidenceScrubbed` was assigned, so a green run published an artifact with the
  //     field MISSING — indistinguishable from "not checked" to a reader.
  const cleanOut = join(SELFTEST_DIR, "clean", "out")
  mkdirSync(cleanOut, { recursive: true })
  const cleanRun = spawnSync(process.execPath, [join(DOCKER_DIR, "lib", "report.mjs"), "--work", leakWork, "--out", cleanOut], { encoding: "utf8", env: { ...process.env, MPD_E2E_FORCE_LEAK: "" } })
  const cleanResult = existsSync(join(cleanOut, "result.json")) ? JSON.parse(readFileSync(join(cleanOut, "result.json"), "utf8")) : null
  check("a clean report carries evidenceScrubbed: true", cleanResult?.evidenceScrubbed === true, JSON.stringify(cleanResult?.evidenceScrubbed))
  check("a clean report exits 0", cleanRun.status === 0, `status=${cleanRun.status}`)

  rmSync(SELFTEST_DIR, { recursive: true, force: true })
  if (failures.length > 0) {
    console.error(`[self-test] ${failures.length} FAILED`)
    process.exit(1)
  }
  console.log("[self-test] all arms passed (offline: no docker, no network)")
}

// ── the real run ─────────────────────────────────────────────────────────────

function writeSyntheticResult(evidence, reason, extra = {}) {
  const body = {
    case: "docker-client-install",
    ok: false,
    complete: false,
    driver: { synthesized: true, reason, ...extra },
    summary: { total: 0, passed: 0, failed: 0, null: 0, failedNames: [], nullNames: [] },
    assertions: [],
    observations: {},
    facts: {},
    hashes: [],
    steps: [],
    outputLog: "output.log",
  }
  writeFileSync(join(evidence, "result.json"), JSON.stringify(body, null, 2) + "\n")
  return body
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes("--self-test")) { selfTest(); return }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: node scripts/docker-e2e.mjs [--self-test] [--no-build]")
    return
  }

  const docker = resolveDocker()
  if (!docker.ok) {
    console.error(`[driver] ${docker.reason}`)
    process.exitCode = 3
    return
  }
  console.log(`[driver] ${docker.version} / ${docker.compose}`)

  const buildx = buildxEnv()
  console.log(`[driver] BUILDX_CONFIG=${buildx.env.BUILDX_CONFIG}${buildx.owned ? " (private, writable: the sandbox denies ~/.docker/buildx)" : " (caller-provided)"}`)

  const evidence = evidenceDir(REPO)
  mkdirSync(evidence, { recursive: true })
  const consoleLog = join(evidence, "console.log")
  const driverLog = join(evidence, "driver.json")
  const startedAt = new Date().toISOString()
  const steps = []
  const cleanup = () => { if (buildx.owned) rmSync(buildx.dir, { recursive: true, force: true }) }

  if (!argv.includes("--no-build")) {
    const buildArgs = ["compose", "-f", COMPOSE_FILE, "build"]
    console.log(`[driver] $ docker ${buildArgs.join(" ")}`)
    const built = await runStreaming(docker.docker, buildArgs, { cwd: REPO, env: buildx.env, logFile: consoleLog })
    steps.push({ id: "driver-build", cmd: `docker ${buildArgs.join(" ")}`, status: built.status })
    if (built.status !== 0) {
      writeSyntheticResult(evidence, `docker compose build exited ${built.status}`)
      writeFileSync(join(evidence, "output.log"), readFileSync(consoleLog, "utf8"))
      writeFileSync(driverLog, JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), docker: docker.version, compose: docker.compose, steps, exitCode: 2 }, null, 2) + "\n")
      console.error(`[driver] docker compose build failed (exit ${built.status}) — see ${relative(REPO, consoleLog)}`)
      cleanup()
      process.exitCode = 2
      return
    }
  }
  const sizeMiB = imageSizeMiB(docker.docker, buildx.env)
  console.log(`[driver] image ${IMAGE}${sizeMiB === null ? "" : ` = ${sizeMiB} MiB`}`)

  const runArgs = ["compose", "-f", COMPOSE_FILE, "run", "--rm", "-T", SERVICE]
  console.log(`[driver] $ docker ${runArgs.join(" ")}`)
  console.log(`[driver] evidence -> ${relative(REPO, evidence)}`)
  const ran = await runStreaming(docker.docker, runArgs, {
    cwd: REPO,
    env: { ...buildx.env, MPD_DOCKER_OUT: evidence, MPD_E2E_IMAGE: IMAGE },
    logFile: consoleLog,
  })
  steps.push({ id: "driver-run", cmd: `docker ${runArgs.join(" ")}`, status: ran.status, signal: ran.signal })

  const resultPath = join(evidence, "result.json")
  let result = null
  if (existsSync(resultPath)) {
    try { result = JSON.parse(readFileSync(resultPath, "utf8")) } catch (error) {
      console.error(`[driver] result.json is not valid JSON: ${String(error.message)}`)
    }
  }
  if (result === null) {
    result = writeSyntheticResult(evidence, `the container exited ${ran.status} without writing result.json`, { containerExit: ran.status })
  }
  if (!existsSync(join(evidence, "output.log"))) writeFileSync(join(evidence, "output.log"), readFileSync(consoleLog, "utf8"))

  const exitCode = decideExit(result)
  writeFileSync(driverLog, JSON.stringify({
    startedAt,
    finishedAt: new Date().toISOString(),
    docker: docker.version,
    compose: docker.compose,
    image: IMAGE,
    imageMiB: sizeMiB,
    buildxConfig: buildx.env.BUILDX_CONFIG,
    steps,
    containerExit: ran.status,
    verdict: summarize(result),
    exitCode,
  }, null, 2) + "\n")

  console.log("")
  console.log(`[driver] ${summarize(result)}`)
  for (const assertion of (result.assertions ?? []).filter((a) => a.ok === false)) {
    console.log(`[driver] FAIL ${assertion.name} — ${assertion.reason}${assertion.raw ? " | raw: " + assertion.raw : ""}`)
  }
  for (const assertion of (result.assertions ?? []).filter((a) => a.ok === null)) {
    console.log(`[driver] NULL ${assertion.name} — ${assertion.reason}`)
  }
  console.log(`[driver] evidence -> ${relative(REPO, evidence)}`)
  cleanup()
  process.exitCode = exitCode
}

// A module that also exports its helpers must not run the docker stack when it is imported: the
// CLI body executes only for the direct `node scripts/docker-e2e.mjs` invocation.
if (process.argv[1] === SELF) {
  main().catch((error) => {
    console.error(`[driver] unexpected failure: ${String(error?.stack ?? error)}`)
    process.exitCode = 2
  })
}
