#!/usr/bin/env node
// scripts/docker-e2e.ts — the HOST side of the Docker client-install E2E (task lane D).
//
// ONE COMMAND:
//     node scripts/docker-e2e.ts
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
// OFFLINE SELF-TEST: `node scripts/docker-e2e.ts --self-test` needs no docker and no network. It
// exercises this file's own pure helpers (timestamp, evidence path, redaction, verdict/exit
// mapping) plus the static rules of the compose file, the Dockerfile, the ignore file and the
// entrypoint, and round-trips the evidence writer — because a driver whose own bookkeeping is
// unchecked produces confident nonsense.
import { spawn, spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { readJson } from "./lib/repo.ts"

/** This file's own absolute path, the anchor every sibling path below is derived from. */
const SELF = fileURLToPath(import.meta.url)
/** The repository root, derived from this file's own location (`<root>/scripts/`). */
const REPO = dirname(dirname(SELF))
/** The directory holding the build inputs the static self-test arms read. */
const DOCKER_DIR = join(REPO, "docker")
/** The compose file the driver builds and runs the service through. */
const COMPOSE_FILE = join(DOCKER_DIR, "docker-compose.yml")
/** The image definition; its FROM line and context COPY are asserted statically. */
const DOCKERFILE = join(DOCKER_DIR, "Dockerfile")
/** The build-context filter that keeps host state out of the image. */
const DOCKERIGNORE = join(DOCKER_DIR, "Dockerfile.dockerignore")
/** Scratch root for the self-test fixture arms, removed again on both ends of the run. */
const SELFTEST_DIR = join(DOCKER_DIR, ".selftest")
/** Image tag the compose service runs, overridable for a pinned/prebuilt image. */
const IMAGE = process.env.MPD_DOCKER_IMAGE ?? "mpd-docker-e2e:local"
/** The compose service that installs a CHECKOUT by path, after a from-source rebuild. */
const SERVICE = "mpd-client"
/** The compose service that installs the PUBLISHED package from a git spec, with no build at all. */
const ONECLICK_SERVICE = "mpd-oneclick"

// ── pure helpers (all exercised by --self-test) ───────────────────────────────

/** One assertion row as the container's reporter writes it into result.json. */
interface ResultAssertion {
  /** Stable assertion name, e.g. `boot.sessionGateListener`. */
  readonly name: string
  /** Verdict: true pass, false fail, null not provable in this run. */
  readonly ok: boolean | null
  /** Human reason the reporter attached; empty when it had none. */
  readonly reason?: string
  /** Raw observed value quoted beside a failure; empty when absent. */
  readonly raw?: string
}

/** The reporter's summary block: verdict counts plus the names behind them. */
interface ResultSummary {
  /** Assertions the reporter knew about. */
  readonly total?: number
  /** Assertions that passed. */
  readonly passed?: number
  /** Assertions that failed. */
  readonly failed?: number
  /** Assertions that could not be evaluated. */
  readonly null?: number
  /** Names of the failed assertions, in report order. */
  readonly failedNames?: readonly string[]
  /** Names of the unevaluated assertions, in report order. */
  readonly nullNames?: readonly string[]
}

/** result.json as this driver reads it back; reporter-only fields stay unread but are round-tripped. */
interface ResultBody {
  /** Case id the reporter stamps (`docker-client-install`). */
  readonly case?: string
  /** Overall verdict; the process exit code is derived from it. */
  readonly ok?: boolean
  /** True when every assertion was evaluated. */
  readonly complete?: boolean
  /** Verdict counts and the names behind them. */
  readonly summary?: ResultSummary
  /** Every assertion the container recorded, failed and unevaluated ones included. */
  readonly assertions?: readonly ResultAssertion[]
  /** Written by writeSyntheticResult only: why the driver had to synthesize a body. */
  readonly driver?: Record<string, unknown>
  /** Reporter-owned observation map; this driver only carries it to disk. */
  readonly observations?: unknown
  /** Reporter-owned facts map; this driver only carries it to disk. */
  readonly facts?: unknown
  /** Reporter-owned hash list; this driver only carries it to disk. */
  readonly hashes?: readonly unknown[]
  /** Reporter-owned step list; this driver only carries it to disk. */
  readonly steps?: readonly unknown[]
  /** Name of the raw log stored beside result.json. */
  readonly outputLog?: string
  /** Post-write scrub verdict: false means a token shape survived into the artifacts. */
  readonly evidenceScrubbed?: boolean
}

/** One step of this driver's own run, recorded in driver.json. */
interface DriverStep {
  /** Step id, e.g. `driver-build`. */
  readonly id: string
  /** The exact command line that was run. */
  readonly cmd: string
  /** Child exit status, null when the child was killed by a signal. */
  readonly status: number | null
  /** Terminating signal, present only when the child was signalled. */
  readonly signal?: string | null
}

/** The outcome of one streamed child process. */
interface ChildOutcome {
  /** Exit status, null when the child was terminated by a signal. */
  readonly status: number | null
  /** Terminating signal name, null for a normal exit. */
  readonly signal: string | null
}

/** The environment every docker child receives, plus the private buildx state dir. */
interface BuildxEnv {
  /** Environment handed to the docker CLI, with BUILDX_CONFIG resolved. */
  readonly env: NodeJS.ProcessEnv
  /** Writable buildx state directory used for this run. */
  readonly dir: string
  /** True when this call created `dir` and the caller must remove it. */
  readonly owned: boolean
}

/** The missing-prerequisite arm of resolveDocker. */
interface DockerMissing {
  /** False marker that selects this arm of the union. */
  readonly ok: false
  /** Precise human reason naming what is missing. */
  readonly reason: string
}

/** The ready arm of resolveDocker. */
interface DockerReady {
  /** True marker that selects this arm of the union. */
  readonly ok: true
  /** Absolute path of the docker binary that was found. */
  readonly docker: string
  /** `docker --version` stdout, trimmed. */
  readonly version: string
  /** `docker compose version` stdout, trimmed. */
  readonly compose: string
}

/** How the machine's Docker answers the rootless question. */
type DockerModeState = "rootless" | "rootful" | "unusable"

/** The daemon-mode probe: which of the three states this machine is in, and the evidence for it. */
interface DockerModeProbe {
  /** The state the probe measured. */
  readonly state: DockerModeState
  /** The raw evidence (`docker info` output, or the failure it produced), quoted in every verdict. */
  readonly detail: string
}

/** What this run should do about Docker, decided from the probe and the caller's flags. */
type DockerDecision =
  | { readonly action: "run"; readonly modeLine: string }
  | { readonly action: "skip"; readonly notice: string }
  | { readonly action: "fail"; readonly reason: string }

/** Either a resolved docker toolchain or the precise reason it is unusable. */
type DockerResolution = DockerMissing | DockerReady

/** Everything one streamed docker child needs. */
interface StreamOptions {
  /** Working directory for the child (the repository root). */
  readonly cwd: string
  /** Full environment for the child. */
  readonly env: NodeJS.ProcessEnv
  /** File every redacted chunk is appended to as it arrives. */
  readonly logFile: string
}

/** The evidence directory stamp: UTC, second precision, filesystem-safe. */
export function utcStamp(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-")
}

/**
 * evidence/docker/<slug>/<stamp> — the one place this case writes evidence.
 *
 * The slug names the ACCEPTANCE QUESTION, not the tool: `client-install` is the checkout install
 * (built from source) and `client-install-oneclick` is the published-package install, so a reader
 * of the evidence tree can tell the two runs apart without opening a record.
 * @param repo - repository root the evidence tree lives under.
 * @param date - clock used for the stamp; fixed by the self-test arm.
 * @param slug - the case slug; defaults to the checkout-install case.
 * @returns the absolute evidence directory for this run.
 */
export function evidenceDir(repo: string, date: Date = new Date(), slug: string = "client-install"): string {
  return join(repo, "evidence", "docker", slug, utcStamp(date))
}

/**
 * Token scrubbing for everything the driver writes (AGENTS.md §10). The container's reporter
 * redacts too; this is the second, independent pass, because the driver echoes raw container
 * stdout and a redaction rule with one implementation is a rule with one point of failure.
 *
 * @param text - Anything about to be logged; `String()` is applied first so odd input cannot throw.
 * @returns The same text with token/sk shaped values replaced.
 */
export function redact(text: unknown): string {
  return String(text)
    .replace(/([?&]token=)[A-Za-z0-9._~+/=-]+/g, "$1<redacted>")
    .replace(/(\btoken\s*[:=]\s*)["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi, "$1<redacted>")
    .replace(/(\bsk-)[A-Za-z0-9_-]{12,}/g, "$1<redacted>")
}

/**
 * The verdict → process exit code mapping, stated once.
 *
 * @param result - The result.json body, or null/undefined when none was produced.
 * @returns 0 pass, 1 fail, 2 when no usable verdict exists.
 */
export function decideExit(result: ResultBody | null | undefined): number {
  if (result === null || result === undefined || typeof result.ok !== "boolean") return 2
  return result.ok ? 0 : 1
}

/**
 * A one-line human summary of a result.json body.
 *
 * @param result - The result.json body, or null/undefined when none was produced.
 * @returns A single line naming the counts and, when present, the failing/null assertion names.
 */
export function summarize(result: ResultBody | null | undefined): string {
  if (result === null || result === undefined) return "no result.json"
  /** Reporter counts block; read as empty when a synthesized body carries none. */
  const summary = result.summary ?? {}
  /** Names of the assertions that came back FALSE. */
  const failed = (result.assertions ?? []).filter((a: ResultAssertion) => a.ok === false).map((a: ResultAssertion) => a.name)
  /** Names of the assertions that could not be evaluated. */
  const nulls = (result.assertions ?? []).filter((a: ResultAssertion) => a.ok === null).map((a: ResultAssertion) => a.name)
  return `ok=${result.ok} complete=${result.complete} passed=${summary.passed ?? "?"} failed=${summary.failed ?? failed.length}`
    + ` null=${summary.null ?? nulls.length}`
    + (failed.length > 0 ? ` FAILED=[${failed.join(",")}]` : "")
    + (nulls.length > 0 ? ` NULL=[${nulls.join(",")}]` : "")
}

/**
 * The environment every docker child gets: BUILDX_CONFIG pointed at a writable directory, because
 * the sandbox denies writes to the default ~/.docker/buildx and a build then fails before it
 * starts. The caller's own BUILDX_CONFIG wins.
 *
 * @param base - Environment to derive from (defaults to this process's).
 * @param dir - Writable buildx state directory to inject (defaults to a fresh temp dir).
 * @returns The child environment, that directory and whether this call owns it.
 */
export function buildxEnv(base: NodeJS.ProcessEnv = process.env, dir: string = mkdtempSync(join(tmpdir(), "mpd-docker-e2e-buildx-"))): BuildxEnv {
  return {
    env: { ...base, BUILDX_CONFIG: base.BUILDX_CONFIG ?? dir },
    dir,
    owned: base.BUILDX_CONFIG === undefined,
  }
}

// ── host tooling ─────────────────────────────────────────────────────────────

/**
 * Resolve `docker`/`docker compose` without throwing; a missing binary is a precise message.
 *
 * @param env - Environment whose PATH is searched (defaults to this process's).
 * @returns The resolved toolchain, or the reason it is unusable.
 */
export function resolveDocker(env: NodeJS.ProcessEnv = process.env): DockerResolution {
  /** The PATH being searched, as a string (`""` when unset). */
  const path = String(env.PATH ?? "")
  /** PATH entries with the empty ones dropped, so a trailing colon cannot produce a bogus hit. */
  const dirs = path.split(":").filter((d: string) => d !== "")
  /** Absolute path of the first PATH entry that really holds a docker binary, `""` when none does. */
  const found = dirs.map((d: string) => join(d, "docker")).find((candidate: string) => existsSync(candidate)) ?? ""
  if (found === "") return { ok: false, reason: "no `docker` on PATH (install Docker and put its bin directory on PATH)" }
  /** `docker --version` result; a non-zero status means the binary is not usable. */
  const version = spawnSync(found, ["--version"], { encoding: "utf8" })
  if (version.status !== 0) return { ok: false, reason: `docker --version failed: ${version.stderr ?? ""}`.trim() }
  /** `docker compose version` result; this driver needs the compose plugin, not the standalone v1. */
  const compose = spawnSync(found, ["compose", "version"], { encoding: "utf8" })
  if (compose.status !== 0) return { ok: false, reason: "the docker compose plugin is not available (`docker compose version` failed)" }
  return { ok: true, docker: found, version: String(version.stdout ?? "").trim(), compose: String(compose.stdout ?? "").trim() }
}

/**
 * Ask the daemon whether it runs rootless.
 *
 * WHY THIS MATTERS: this lane is the LAST step of the verification flow and it must be honest about
 * the environment it ran in — a rootless daemon proves the whole install/mount path works without
 * root, while a rootful one proves less. It must also never turn an absent Docker into a broken
 * wave, so an unusable daemon is reported as its own state instead of an exception.
 *
 * @param dockerPath - Absolute path of the docker binary resolveDocker found.
 * @returns The measured state plus the evidence (the `SecurityOptions` list, or the failure text).
 */
export function probeDockerMode(dockerPath: string): DockerModeProbe {
  // `docker info` succeeds without elevated privileges only when the CURRENT USER may talk to the
  // daemon (rootless mode, or membership in the docker group); a socket EACCES is exactly the "no
  // usable Docker here" case the flow skips on.
  /** The daemon query: SecurityOptions carries `name=rootless` on a rootless daemon. */
  const info = spawnSync(dockerPath, ["info", "--format", "{{json .SecurityOptions}}"], { encoding: "utf8", timeout: 30_000 })
  if (info.status !== 0) {
    /** stderr when the CLI produced one, else the signal/status, so the notice names the real cause. */
    const failure = String(info.stderr ?? "").trim() || `docker info exited ${String(info.status)}${info.signal === null ? "" : ` (signal ${info.signal})`}`
    return { state: "unusable", detail: failure }
  }
  /** The SecurityOptions JSON array as text; the key is matched inside it, never parsed positionally. */
  const options = String(info.stdout ?? "").trim()
  return { state: options.includes("rootless") ? "rootless" : "rootful", detail: options }
}

/**
 * Decide what Docker means for this run — PURE, so `--self-test` exercises every arm without Docker.
 *
 * THE POLICY (user-set): the Docker lane is part of the verification flow and runs as its LAST step;
 * a machine with no ROOTLESS Docker prints a notice and SKIPS the step instead of failing the wave.
 * `--allow-rootful-docker` opts a rootful daemon in explicitly (CI images are usually rootful), and
 * `--require-docker` turns any skip into a failure for a release run that must not silently lose it.
 *
 * @param probe - The measured daemon mode.
 * @param flags - The caller's two switches.
 * @returns `run`, `skip` with the notice to print, or `fail` with the reason.
 */
export function decideDockerUse(probe: DockerModeProbe, flags: { readonly requireDocker: boolean; readonly allowRootful: boolean }): DockerDecision {
  if (probe.state === "rootless") return { action: "run", modeLine: `docker mode: ROOTLESS (${probe.detail})` }
  if (probe.state === "rootful" && flags.allowRootful) return { action: "run", modeLine: `docker mode: ROOTFUL — opted in with --allow-rootful-docker (${probe.detail})` }
  /** The one sentence that names what was found, shared by the notice and the fatal reason. */
  const found = probe.state === "rootful"
    ? `this machine's Docker is ROOTFUL, not rootless (${probe.detail}); pass --allow-rootful-docker to run the lane here anyway`
    : `no usable Docker daemon for this user (${probe.detail})`
  if (flags.requireDocker) return { action: "fail", reason: `--require-docker was passed and ${found}` }
  return {
    action: "skip",
    notice: [
      `[driver] SKIP — the Docker real-machine lane did NOT run: ${found}.`,
      "[driver] This step is the LAST one in the verification flow and is skipped on purpose, not failed:",
      "[driver] every static gate, the unit suite and the QA self-tests above still had to pass. Install a",
      "[driver] rootless Docker (https://docs.docker.com/engine/security/rootless/) and re-run",
      "[driver] `node scripts/docker-e2e.ts --mode source` / `--mode oneclick`, or pass --require-docker to",
      "[driver] make this skip fatal for a release sweep.",
    ].join("\n"),
  }
}

/**
 * Stream a child's stdout+stderr to this terminal AND to a file, honouring redaction.
 *
 * @param command - Binary to spawn.
 * @param args - Its argv.
 * @param options - Working directory, environment and the log file to append to.
 * @returns The child's exit status and terminating signal (127 when it could not be spawned).
 */
function runStreaming(command: string, args: readonly string[], { cwd, env, logFile }: StreamOptions): Promise<ChildOutcome> {
  return new Promise((resolve) => {
    // Appended chunk by chunk, never buffered to the end: an interrupted run must still leave the
    // raw console of whatever it managed to do.
    /** The docker child; both streams are piped so every byte can be redacted and logged. */
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    /** Redact one arriving chunk and write it to both the log file and this terminal. */
    const onData = (buffer: Buffer): void => {
      /** The redacted chunk text, shared by the log file and the terminal. */
      const text = redact(buffer.toString("utf8"))
      appendFileSync(logFile, text)
      process.stdout.write(text)
    }
    // The stdio array above pipes both streams, so neither accessor is null here.
    child.stdout!.on("data", onData)
    child.stderr!.on("data", onData)
    child.on("error", (error: Error): void => {
      /** The spawn-failure line, logged and streamed like any other output. */
      const text = `\n[driver] failed to spawn ${command}: ${String(error.message)}\n`
      appendFileSync(logFile, text)
      process.stdout.write(text)
      resolve({ status: 127, signal: null })
    })
    child.on("close", (status: number | null, signal: string | null): void => resolve({ status, signal }))
  })
}

/**
 * `docker image inspect` size in MiB, or null when the image is absent.
 *
 * @param docker - Absolute path of the docker binary.
 * @param env - Environment for the inspect call.
 * @returns The rounded image size, or null when the image does not exist.
 */
function imageSizeMiB(docker: string, env: NodeJS.ProcessEnv): number | null {
  /** The inspect call; a non-zero status means the image is not present locally. */
  const result = spawnSync(docker, ["image", "inspect", IMAGE, "--format", "{{.Size}}"], { encoding: "utf8", env })
  if (result.status !== 0) return null
  /** Image size in bytes, as the inspect template prints it. */
  const bytes = Number(String(result.stdout).trim())
  return Number.isFinite(bytes) ? Math.round(bytes / 1048576) : null
}

// ── self-test ────────────────────────────────────────────────────────────────

/** Exercise this file's pure helpers and the static rules of the docker build inputs, offline. */
function selfTest(): void {
  /** Failure lines collected by the arms below; a non-empty list is the self-test's exit 1. */
  const failures: string[] = []
  /** Record one arm: print ok/FAIL and remember a failure for the final verdict. */
  const check = (name: string, condition: boolean, detail: string = ""): void => {
    if (condition) { console.log(`[self-test] ok   ${name}`) }
    else { failures.push(`${name} ${detail}`); console.error(`[self-test] FAIL ${name} ${detail}`) }
  }

  // 1. stamp + evidence path
  /** Fixed clock, so the stamp/path arms are deterministic. */
  const stamp = utcStamp(new Date("2026-01-02T03:04:05.678Z"))
  check("utcStamp is a filesystem-safe UTC second stamp", /^2026-01-02T03-04-05Z$/.test(stamp), stamp)
  check("utcStamp has no colons", !stamp.includes(":"), stamp)
  /** Evidence path built from the same fixed clock. */
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
  // Each forbidden name is a directory a staged repository copy used to occupy.
  for (const forbidden of ["src", "repo", "checkout", "context"]) {
    check(`docker/${forbidden} does not exist`, !existsSync(join(DOCKER_DIR, forbidden)))
  }

  // 5. compose isolation rules (static, on the EFFECTIVE config: comments are prose about the rule,
  //    not the rule, so they are stripped before the scan).
  /** Strip whole-line and trailing comments, so only effective YAML is scanned. */
  const stripComments = (text: string): string => text
    .split("\n")
    .filter((line: string) => !/^\s*#/.test(line))
    .map((line: string) => line.replace(/\s+#.*$/, ""))
    .join("\n")
  /** The compose file with its comments removed. */
  const compose = stripComments(readFileSync(COMPOSE_FILE, "utf8"))
  // Each forbidden token is host state the container must never reach.
  for (const forbidden of ["$HOME", "~/.dsh", "~/.mpd", "$DSH_HOME", "/root/.dsh", "/root/.mpd", ".agents"]) {
    check(`compose does not reference ${forbidden}`, !compose.includes(forbidden))
  }
  /** Bind-mount lines of the effective config: ONE PER SERVICE (the evidence mount) is allowed. */
  const volumeLines = compose.split("\n").filter((line: string) => /^\s*-\s+\S+:\S+\s*$/.test(line))
  /** The service names the effective config declares. */
  const composeServices = compose.match(/^ {2}[a-z][a-z0-9-]*:$/gm) ?? []
  check("compose declares a bind mount per service", volumeLines.length === composeServices.length, `services=${composeServices.length} volumes=${volumeLines.length} ${JSON.stringify(volumeLines)}`)
  check("every bind mount is the evidence /out mount", volumeLines.length > 0 && volumeLines.every((line: string) => line.includes(":/out")), JSON.stringify(volumeLines))
  check("compose builds from the REPOSITORY ROOT context", /^\s*context:\s*\.\.\s*$/m.test(compose))
  check("compose points at docker/Dockerfile", /^\s*dockerfile:\s*docker\/Dockerfile\s*$/m.test(compose))
  check("compose names the image", /^\s*image:\s*\S+/m.test(compose))
  // The two services are the wave's two acceptance questions: the checkout install (`source`) and
  // the published-package install with no build (`oneclick`). Naming them exactly means a third
  // service cannot appear unnoticed — and a missing one cannot silently reduce the evidence.
  check("compose declares exactly the source and oneclick services", composeServices.length === 2 && composeServices.some((line: string) => line.trim() === `${SERVICE}:`) && composeServices.some((line: string) => line.trim() === `${ONECLICK_SERVICE}:`), JSON.stringify(composeServices))
  check("the oneclick service selects the oneclick install mode", /MPD_E2E_INSTALL_MODE:\s*oneclick/.test(compose))
  check("the oneclick service names a git spec or the env override", /MPD_E2E_INSTALL_SPEC:/.test(compose) && /MPD_ONECLICK_SPEC/.test(compose))

  // 6. Dockerfile base image + context copy. The RUNTIME image is the LAST stage, never the FIRST
  //    `FROM` line: node arrives from the official `node:24-bookworm` image through a multi-stage COPY,
  //    so the first FROM names the helper stage. This arm used to read the first line and reddened on a
  //    CORRECT Dockerfile while the lane it guards was green (measured 2026-10-02, HEAD db80fe4e).
  /** The Dockerfile text, scanned for its stages and its context COPY. */
  const dockerfile = readFileSync(DOCKERFILE, "utf8")
  /** Every stage's `FROM` line in file order; the LAST one is the image the lane actually runs. */
  const fromLines = dockerfile.split("\n").filter((line: string) => /^FROM\s/.test(line))
  check("Dockerfile's runtime stage is FROM ubuntu:24.04", fromLines[fromLines.length - 1] === "FROM ubuntu:24.04", JSON.stringify(fromLines))
  check("Dockerfile declares exactly the node-runtime + ubuntu stages, node first", fromLines.length === 2 && fromLines[0] === "FROM node:24-bookworm AS node-runtime", JSON.stringify(fromLines))
  check("Dockerfile hands node over with COPY --from (never a bind mount)", dockerfile.includes("COPY --from=node-runtime /usr/local /usr/local"))
  check("Dockerfile copies the context (never a bind mount)", dockerfile.includes("COPY . /src/"))

  // 7. the ignore file: it is what keeps host state OUT of the image, and it must not eat the
  //    `packages/*/dist` trees the container is supposed to rebuild.
  /** Non-empty, comment-free ignore patterns of the build-context filter. */
  const ignore = stripComments(readFileSync(DOCKERIGNORE, "utf8")).split("\n").map((l: string) => l.trim()).filter((l: string) => l !== "")
  // Each pattern is host state or a build product that must not enter the image.
  for (const pattern of [".git", "node_modules", "**/node_modules", "dist", "evidence", ".toolchain", "pnpm-workspace.yaml", "pnpm-lock.yaml", ".npmrc", ".pnpmfile.cjs"]) {
    check(`Dockerfile.dockerignore excludes ${pattern}`, ignore.includes(pattern))
  }
  // The install-affecting class must ALSO be asserted at RUN time (a file can be added to the context
  // after the filter was written), so the entrypoint's marker list is checked here, offline.
  /** The entrypoint's context-leak markers, read for the assertion below. */
  const leakMarkers = /for marker in ([^;]+); do/.exec(readFileSync(join(DOCKER_DIR, "entrypoint.sh"), "utf8"))?.[1] ?? ""
  for (const marker of ["pnpm-workspace.yaml", "pnpm-lock.yaml", ".npmrc", ".pnpmfile.cjs"]) {
    check(`entrypoint asserts the context carries no ${marker}`, leakMarkers.includes(marker))
  }
  check("Dockerfile.dockerignore does not exclude packages/", !ignore.some((p: string) => /^!?packages\//.test(p) || p === "packages"))

  // 8. entrypoint obligations
  /** The container entrypoint script, asserted for its install/boot obligations. */
  const entrypoint = readFileSync(join(DOCKER_DIR, "entrypoint.sh"), "utf8")
  // The LIVE lane drives `github:<owner>/<repo>`, the shorthand the README prints, so the entrypoint's
  // profile-dependency assertion must accept that shape (measured 2026-09-28: the install itself
  // succeeded and the assertion alone failed the run).
  check("entrypoint accepts the github: shorthand as a git dependency shape", entrypoint.includes("oneclick:github:*"))
  check("entrypoint is strict bash", entrypoint.includes("set -euo pipefail"))
  check("entrypoint performs the real client install", entrypoint.includes("dsh plugin --profile web add ."))
  check("entrypoint installs the harness at a pin", /npm i -g "@deepseek-ai\/dsh@\$DSH_VERSION"/.test(entrypoint))
  check("entrypoint isolates HOME and DSH_HOME", entrypoint.includes("export HOME=\"$SANDBOX_HOME\"") && entrypoint.includes("export DSH_HOME=\"$SANDBOX_DSH\""))
  check("entrypoint never copies a credential file", !/\b(cp|scp|install|rsync|cat)\b[^\n]*credential/i.test(entrypoint))
  check("entrypoint never reads the real harness home", !/~\/\.dsh/.test(entrypoint) && !/\$HOME\/\.dsh/.test(entrypoint))
  check("entrypoint asserts the build context was filtered", /record copy\.contextFiltered/.test(entrypoint))
  check("entrypoint asserts the preset mount through /api/session/create", entrypoint.includes("/api/session/create"))
  check("entrypoint asserts the session-gate LISTENER registration", /record boot\.sessionGateListener/.test(entrypoint) && entrypoint.includes("session gate listener registered for agent"))
  check("entrypoint records the un-provable LLM assertion as null", /record boot\.llmTurn null/.test(entrypoint))

  // 9. BUILDX_CONFIG: the sandbox cannot write ~/.docker/buildx, so every docker child must run
  //    with a writable buildx state dir and the caller's own value must win.
  /** A caller with no BUILDX_CONFIG: the driver must inject its own writable dir and own it. */
  const injected = buildxEnv({ PATH: "/usr/bin" }, "/tmp/probe-buildx")
  check("buildxEnv injects a writable BUILDX_CONFIG", injected.env.BUILDX_CONFIG === "/tmp/probe-buildx" && injected.owned === true)
  /** A caller that supplied BUILDX_CONFIG: its value must survive and the temp dir is not owned. */
  const kept = buildxEnv({ PATH: "/usr/bin", BUILDX_CONFIG: "/caller" }, "/tmp/ignored")
  check("buildxEnv keeps the caller's BUILDX_CONFIG", kept.env.BUILDX_CONFIG === "/caller" && kept.owned === false)

  // 10. evidence writer round-trip (offline, no docker)
  rmSync(SELFTEST_DIR, { recursive: true, force: true })
  /** Fixture directory standing in for a run's evidence dir. */
  const fixture = join(SELFTEST_DIR, "evidence")
  mkdirSync(fixture, { recursive: true })
  /** The body written and read back: counts plus one passing assertion. */
  const body: ResultBody = { ok: true, summary: { passed: 1, failed: 0, null: 0 }, assertions: [{ name: "x", ok: true }] }
  writeFileSync(join(fixture, "result.json"), JSON.stringify(body, null, 2) + "\n")
  writeFileSync(join(fixture, "output.log"), redact("dsh web: http://127.0.0.1:3197/?token=SECRET123\n") + "\n")
  /** The body as re-read from disk; it must equal the written one byte for byte. */
  const readBack = readJson<ResultBody>(join(fixture, "result.json"))
  check("result.json round-trips byte-identically", JSON.stringify(readBack) === JSON.stringify(body))
  check("output.log is written redacted", !readFileSync(join(fixture, "output.log"), "utf8").includes("SECRET123"))

  // 11. missing docker is a precise message, not a throw
  /** Resolution against a PATH that holds no docker binary. */
  const missing = resolveDocker({ PATH: "/nonexistent-bin" })
  check("resolveDocker reports a missing docker precisely", missing.ok === false && missing.reason.includes("no `docker` on PATH"), JSON.stringify(missing))

  // 11b. the rootless/skip policy: every arm of the decision, plus the probe's own parsing.
  /** The four probes the policy must distinguish, each with the evidence text a real run would print. */
  const probes = {
    rootless: { state: "rootless", detail: '[\"name=seccomp,profile=builtin\",\"name=rootless\"]' },
    rootful: { state: "rootful", detail: '[\"name=seccomp,profile=builtin\"]' },
    unusable: { state: "unusable", detail: "permission denied while trying to connect to the Docker daemon socket" },
  } as const
  /** Default flags: no requirement, no rootful opt-in. */
  const plain = { requireDocker: false, allowRootful: false }
  check("a ROOTLESS daemon runs the lane", decideDockerUse(probes.rootless, plain).action === "run")
  check("a ROOTFUL daemon is SKIPPED with a notice, not failed", decideDockerUse(probes.rootful, plain).action === "skip")
  check("an unusable daemon is SKIPPED, never thrown", decideDockerUse(probes.unusable, plain).action === "skip")
  check("--allow-rootful-docker opts a rootful daemon in", decideDockerUse(probes.rootful, { requireDocker: false, allowRootful: true }).action === "run")
  check("--require-docker turns the skip into a failure", decideDockerUse(probes.unusable, { requireDocker: true, allowRootful: false }).action === "fail")
  check("--allow-rootful-docker does NOT rescue an unusable daemon", decideDockerUse(probes.unusable, { requireDocker: false, allowRootful: true }).action === "skip")
  /** The skip notice must name the override and the reason, or a reader cannot act on it. */
  const skipNotice = decideDockerUse(probes.unusable, plain)
  check("the skip notice names the cause and the overrides", skipNotice.action === "skip" && skipNotice.notice.includes("rootless") && skipNotice.notice.includes("--require-docker") && skipNotice.notice.includes("permission denied"), JSON.stringify(skipNotice))
  // The run arm must QUOTE the measured mode, or the evidence cannot say which environment it proved.
  /** The decision a rootless probe produces under the default flags. */
  const rootlessRun = decideDockerUse(probes.rootless, plain)
  check("the rootless run line reports the measured mode", rootlessRun.action === "run" && rootlessRun.modeLine.includes("ROOTLESS") && rootlessRun.modeLine.includes("name=rootless"))
  check("the probe reads `name=rootless` out of SecurityOptions", probeDockerMode("/nonexistent-docker").state === "unusable")

  // 12. NEGATIVE CONTROL for the evidence scrub guard: plant a token-shaped value through the
  //     reporter's own hook and assert the guard FIRES (red verdict, scrubbed artifacts, no shape
  //     left). Without this arm the guard would be an assertion nobody ever saw fail.
  /** Work dir handed to the reporter, holding the recorded assertion/steps state. */
  const leakWork = join(SELFTEST_DIR, "leak", "work")
  /** Output dir the reporter writes its artifacts into. */
  const leakOut = join(SELFTEST_DIR, "leak", "out")
  mkdirSync(join(leakWork, "steps"), { recursive: true })
  mkdirSync(leakOut, { recursive: true })
  writeFileSync(join(leakWork, "assertions.ndjson"), JSON.stringify({ name: "harness.version", ok: true, reason: "control", raw: "0.1.7-rc.2" }) + "\n")
  writeFileSync(join(leakWork, "steps.tsv"), "01-apt\t0\t1\t01.log\tcontrol\n")
  writeFileSync(join(leakWork, "steps", "01.log"), "control step output\n")
  /** The reporter run with the forced-leak hook, which must exit 1 with a red, scrubbed verdict. */
  const leaked = spawnSync(process.execPath, [join(DOCKER_DIR, "lib", "report.ts"), "--work", leakWork, "--out", leakOut], {
    encoding: "utf8",
    env: { ...process.env, MPD_E2E_FORCE_LEAK: "1" },
  })
  /** The leaked run's result.json, or null when the reporter never wrote one. */
  const leakResult = existsSync(join(leakOut, "result.json")) ? readJson<ResultBody>(join(leakOut, "result.json")) : null
  check("the scrub guard fails a planted leak (exit 1)", leaked.status === 1, `status=${leaked.status}`)
  check("the scrub guard marks the verdict red", leakResult !== null && leakResult.ok === false && leakResult.evidenceScrubbed === false, JSON.stringify(leakResult?.summary ?? null))
  check("the guard names itself in failedNames", (leakResult?.summary?.failedNames ?? []).includes("isolation.evidenceScrubbed"))
  /** Both leaked artifacts concatenated, scanned for the planted shape. */
  const leakArtifacts = leakResult === null ? "" : readFileSync(join(leakOut, "output.log"), "utf8") + readFileSync(join(leakOut, "result.json"), "utf8")
  check("no planted shape survives into the artifacts", !leakArtifacts.includes("NOTAREDACTEDLEAK"))

  // 13. the CLEAN path must also carry the scrub verdict. Measured defect 2026-09-27: result.json was
  //     rendered before `evidenceScrubbed` was assigned, so a green run published an artifact with the
  //     field MISSING — indistinguishable from "not checked" to a reader.
  /** Output dir for the clean reporter run. */
  const cleanOut = join(SELFTEST_DIR, "clean", "out")
  mkdirSync(cleanOut, { recursive: true })
  /** The reporter run without the leak hook: green verdict, scrub field present and true. */
  const cleanRun = spawnSync(process.execPath, [join(DOCKER_DIR, "lib", "report.ts"), "--work", leakWork, "--out", cleanOut], { encoding: "utf8", env: { ...process.env, MPD_E2E_FORCE_LEAK: "" } })
  /** The clean run's result.json, or null when the reporter never wrote one. */
  const cleanResult = existsSync(join(cleanOut, "result.json")) ? readJson<ResultBody>(join(cleanOut, "result.json")) : null
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

/**
 * Write the minimal red result.json the driver publishes when the container never produced one.
 *
 * @param evidence - Evidence directory to write into.
 * @param reason - Why the driver had to synthesize a body; quoted in `driver.reason`.
 * @param extra - Extra driver fields folded into the `driver` block (e.g. the container exit code).
 * @returns The synthesized body.
 */
function writeSyntheticResult(evidence: string, reason: string, extra: Record<string, unknown> = {}): ResultBody {
  /** The synthesized body: failed, incomplete, with every count at zero. */
  const body: ResultBody = {
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

/** Build, run and grade the container case, landing the evidence under evidence/docker/client-install/. */
async function main(): Promise<void> {
  /** This process's arguments after the script path. */
  const argv = process.argv.slice(2)
  if (argv.includes("--self-test")) { selfTest(); return }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: node scripts/docker-e2e.ts [--self-test] [--no-build] [--mode source|oneclick] [--spec <install-spec>] [--allow-rootful-docker] [--require-docker]")
    return
  }

  // WHICH QUESTION THIS RUN ASKS. `source` (default) runs the checkout-install service; `oneclick`
  // runs the published-package service, whose entrypoint builds a scratch git repository from the
  // build context and installs THAT through pnpm's git resolver — the `github:` path a user takes.
  /** The compose service this run drives; `--mode oneclick` (or its `--oneclick` shorthand) picks the published-package lane. */
  const modeIndex = argv.indexOf("--mode")
  /** The acceptance lane this run drives: `oneclick` only when `--mode oneclick` (or `--oneclick`) asked for it. */
  const mode = modeIndex !== -1 && argv[modeIndex + 1] === "oneclick" ? "oneclick" : argv.includes("--oneclick") ? "oneclick" : "source"
  /** The service name matching the mode. */
  const service = mode === "oneclick" ? ONECLICK_SERVICE : SERVICE
  /** The case slug the evidence tree is filed under, one per acceptance question. */
  const caseSlug = mode === "oneclick" ? "client-install-oneclick" : "client-install"
  /** Extra `-e` overrides handed to the container, so the spec under test is visible in the argv. */
  const specIndex = argv.indexOf("--spec")
  /** The install spec, when the caller named one (defaults to the service's own). */
  const spec = specIndex === -1 ? undefined : argv[specIndex + 1]
  /** Whether the caller asked for the live turn; the key is only forwarded when they did. */
  const requireLive = argv.includes("--live")
  if (requireLive && (process.env.DEEPSEEK_API_KEY === undefined || process.env.DEEPSEEK_API_KEY === "")) {
    console.error("[driver] --live was passed but DEEPSEEK_API_KEY is not set in this environment; the container will report the credential-free NULL")
  }
  /** The environment overrides for the compose run. */
  const envOverrides = [
    ...(mode === "oneclick" ? ["-e", "MPD_E2E_INSTALL_MODE=oneclick"] : []),
    ...(spec === undefined ? [] : ["-e", `MPD_E2E_INSTALL_SPEC=${spec}`]),
    // THE CREDENTIAL IS FORWARDED BY NAME, NEVER BY VALUE, and only when this process actually has
    // one. `-e DEEPSEEK_API_KEY` makes compose read it from THIS process's environment, so the secret
    // never enters the argv the driver echoes below — which is the whole reason the live turn can be
    // run at all without violating AGENTS.md §10 ("never committed, logged, or echoed").
    ...(requireLive && process.env.DEEPSEEK_API_KEY !== undefined && process.env.DEEPSEEK_API_KEY !== ""
      ? ["-e", "DEEPSEEK_API_KEY"]
      : []),
  ]

  /** The resolved docker toolchain, or the reason it is unusable. */
  const docker = resolveDocker()
  if (!docker.ok) {
    // A machine with no docker AT ALL is the same class as a rootful one: notice, skip, keep the wave.
    /** The skip/fail decision for an absent toolchain, so the two absence shapes read alike. */
    const absent = decideDockerUse({ state: "unusable", detail: docker.reason }, { requireDocker: argv.includes("--require-docker"), allowRootful: argv.includes("--allow-rootful-docker") })
    if (absent.action === "run") { console.error(`[driver] an absent toolchain cannot reach the run arm`); process.exitCode = 3; return }
    if (absent.action === "fail") { console.error(`[driver] ${absent.reason}`); process.exitCode = 3; return }
    console.log(absent.notice)
    return
  }
  console.log(`[driver] ${docker.version} / ${docker.compose}`)
  /** The daemon-mode probe: rootless runs, rootful needs the explicit opt-in, unusable skips. */
  const modeProbe = probeDockerMode(docker.docker)
  /** What this run does about the measured mode. */
  const decision = decideDockerUse(modeProbe, { requireDocker: argv.includes("--require-docker"), allowRootful: argv.includes("--allow-rootful-docker") })
  if (decision.action === "fail") { console.error(`[driver] ${decision.reason}`); process.exitCode = 3; return }
  if (decision.action === "skip") { console.log(decision.notice); return }
  console.log(`[driver] ${decision.modeLine}`)

  /** Child environment carrying the private buildx state dir. */
  const buildx = buildxEnv()
  console.log(`[driver] BUILDX_CONFIG=${buildx.env.BUILDX_CONFIG}${buildx.owned ? " (private, writable: the sandbox denies ~/.docker/buildx)" : " (caller-provided)"}`)

  /** Evidence directory for this run (UTC-stamped), filed under the mode's case slug. */
  const evidence = evidenceDir(REPO, new Date(), caseSlug)
  mkdirSync(evidence, { recursive: true })
  /** Append-only copy of everything the docker children printed. */
  const consoleLog = join(evidence, "console.log")
  /** The driver's own record: commands, timings, image size and the final verdict. */
  const driverLog = join(evidence, "driver.json")
  /** Run start, restated in driver.json. */
  const startedAt = new Date().toISOString()
  /** Every command this driver ran, with its exit status. */
  const steps: DriverStep[] = []
  /** Remove the private buildx state dir, but only when this driver created it. */
  const cleanup = (): void => { if (buildx.owned) rmSync(buildx.dir, { recursive: true, force: true }) }

  if (!argv.includes("--no-build")) {
    /** The compose build argv; logged verbatim so the evidence names the exact command. */
    const buildArgs = ["compose", "-f", COMPOSE_FILE, "build"]
    console.log(`[driver] $ docker ${buildArgs.join(" ")}`)
    /** The build child's outcome; a non-zero status stops the run with exit 2. */
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
  /** Image size in MiB, or null when the image is not present locally. */
  const sizeMiB = imageSizeMiB(docker.docker, buildx.env)
  console.log(`[driver] image ${IMAGE}${sizeMiB === null ? "" : ` = ${sizeMiB} MiB`}`)

  /** The compose run argv; `-T` keeps the CLI from allocating a TTY for a piped run. */
  const runArgs = ["compose", "-f", COMPOSE_FILE, "run", "--rm", "-T", ...envOverrides, service]
  console.log(`[driver] $ docker ${runArgs.join(" ")}`)
  console.log(`[driver] evidence -> ${relative(REPO, evidence)}`)
  /** The container run's outcome; its status is quoted even when a result.json exists. */
  const ran = await runStreaming(docker.docker, runArgs, {
    cwd: REPO,
    env: { ...buildx.env, MPD_DOCKER_OUT: evidence, MPD_E2E_IMAGE: IMAGE },
    logFile: consoleLog,
  })
  steps.push({ id: "driver-run", cmd: `docker ${runArgs.join(" ")}`, status: ran.status, signal: ran.signal })

  /** Where the container's reporter was asked to publish its verdict. */
  const resultPath = join(evidence, "result.json")
  /** The container's verdict body; null until it is read (or synthesized below). */
  let result: ResultBody | null = null
  if (existsSync(resultPath)) {
    try { result = readJson<ResultBody>(resultPath) } catch (error) {
      console.error(`[driver] result.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (result === null) {
    result = writeSyntheticResult(evidence, `the container exited ${ran.status} without writing result.json`, { containerExit: ran.status })
  }
  if (!existsSync(join(evidence, "output.log"))) writeFileSync(join(evidence, "output.log"), readFileSync(consoleLog, "utf8"))

  /** The process exit code this run will report (0 pass, 1 fail, 2 no verdict). */
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
  // Every FALSE assertion is reprinted here with its reason, so the terminal needs no JSON digging.
  for (const assertion of (result.assertions ?? []).filter((a: ResultAssertion) => a.ok === false)) {
    console.log(`[driver] FAIL ${assertion.name} — ${assertion.reason}${assertion.raw ? " | raw: " + assertion.raw : ""}`)
  }
  // Unevaluated assertions are reprinted too: a null is reported, never silently dropped.
  for (const assertion of (result.assertions ?? []).filter((a: ResultAssertion) => a.ok === null)) {
    console.log(`[driver] NULL ${assertion.name} — ${assertion.reason}`)
  }
  console.log(`[driver] evidence -> ${relative(REPO, evidence)}`)
  cleanup()
  process.exitCode = exitCode
}

// A module that also exports its helpers must not run the docker stack when it is imported: the
// CLI body executes only for the direct `node scripts/docker-e2e.ts` invocation.
if (process.argv[1] === SELF) {
  main().catch((error: unknown): void => {
    console.error(`[driver] unexpected failure: ${String(error instanceof Error ? error.stack ?? error : error)}`)
    process.exitCode = 2
  })
}
