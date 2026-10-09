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
 * The assertions an arm the caller REQUIRED came back unable to evaluate.
 *
 * A `null` row means "not attempted / not reached", which is the right shape for an optional arm: the
 * credential-free run has always reported `boot.llmTurn: null` and stayed green. It is the WRONG shape
 * for an arm the caller explicitly asked for — with `--live` (or the browser lane on by default) a
 * null means the thing under test was never driven, and a run that greens through that is exactly how
 * the 2026-10-03 `MALFORMED_RESPONSE` defect stayed invisible: 52 of 53 assertions passed while no
 * model token had ever been produced. PURE, so `--self-test` exercises every arm without Docker.
 *
 * @param result - The result.json body, or null/undefined when none was produced.
 * @param prefixes - Assertion-name prefixes whose `null` rows are fatal (e.g. `live.`, `ui.`).
 * @returns The names of the unevaluated assertions inside a required arm, in report order.
 */
export function unmeasuredRequired(result: ResultBody | null | undefined, prefixes: readonly string[]): string[] {
  if (result === null || result === undefined || prefixes.length === 0) return []
  return (result.assertions ?? [])
    .filter((assertion: ResultAssertion) => assertion.ok === null && prefixes.some((prefix) => assertion.name.startsWith(prefix)))
    .map((assertion: ResultAssertion) => assertion.name)
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
 * Whether `docker compose run` is handed `-e MPD_E2E_LIVE_PROMPT`.
 *
 * PURE, so `--self-test` covers every case without Docker. The override is forwarded ONLY when the
 * caller asked for a live run AND supplied a non-empty prompt: an unset or empty value must reach the
 * container as compose's own empty interpolation, which the entrypoint maps back to its default
 * prompt. Forwarding it unconditionally would be a no-op at best, and passing the prompt by VALUE
 * would print a caller's whole task into the argv this driver echoes (the same reason the credential
 * travels by NAME).
 *
 * @param live - Whether the caller requested the live arms (`--live` or `--require-live`).
 * @param prompt - The caller's `MPD_E2E_LIVE_PROMPT` as read from this process's environment.
 * @returns True when the `-e MPD_E2E_LIVE_PROMPT` flag belongs in the compose argv.
 */
export function livePromptOverride(live: boolean, prompt: string | undefined): boolean {
  return live && (prompt ?? "") !== ""
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

  // 3b. the REQUIRED-ARM gate: an arm the caller asked for must never green by not running.
  /** A body with one null row in each of the two optional arms, plus one unrelated null. */
  const mixedArms: ResultBody = {
    ok: true,
    assertions: [
      { name: "live.web.turnCompleted", ok: null, reason: "not attempted" },
      { name: "ui.replyRendered", ok: null, reason: "not attempted" },
      { name: "boot.llmTurn", ok: null, reason: "not attempted" },
      { name: "tui.boot", ok: null, reason: "not reached" },
      { name: "live.web.toolCallsParsed", ok: true, reason: "ok" }
    ]
  }
  check("a null live row is unmeasured when --live was asked for", unmeasuredRequired(mixedArms, ["live.", "boot.llmTurn"]).join(",") === "live.web.turnCompleted,boot.llmTurn")
  check("a null ui row is unmeasured when the browser lane is on", unmeasuredRequired(mixedArms, ["ui."]).join(",") === "ui.replyRendered")
  check("an unrelated null is NOT a required-arm gap", !unmeasuredRequired(mixedArms, ["live."]).includes("tui.boot"))
  check("a passed row is never an unmeasured one", unmeasuredRequired(mixedArms, ["live."]).every((name) => name !== "live.web.toolCallsParsed"))
  check("no required arms means no gap", unmeasuredRequired(mixedArms, []).length === 0)
  check("a missing body has no required-arm gap", unmeasuredRequired(null, ["live."]).length === 0)

  // 3c. the arm-selecting flags: `--require-live` is the long spelling of `--live`, and
  // `--require-browser` names a requirement that is ON by default (`--no-browser` is the opt-out).
  /** The flag predicate the CLI uses, re-stated so the arms read as behaviour, not as argv plumbing. */
  const selectsLive = (args: readonly string[]): boolean => args.includes("--live") || args.includes("--require-live")
  /** The browser predicate, which must stay true under the explicit requirement. */
  const selectsBrowser = (args: readonly string[]): boolean => args.includes("--require-browser") || !args.includes("--no-browser")
  check("--live selects the live arms", selectsLive(["--live"]))
  check("--require-live is the same switch", selectsLive(["--require-live"]))
  check("neither flag leaves the live arms off", !selectsLive([]))
  check("the browser lane is on with no flag at all", selectsBrowser([]))
  check("--require-browser selects it explicitly", selectsBrowser(["--require-browser"]))
  check("--no-browser is the only opt-out", !selectsBrowser(["--no-browser"]))

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
  // The live-turn prompt knob must reach the container the same way the pins do: ONE interpolated
  // entry PER SERVICE. The INTERPOLATION FORM is what is asserted, never the bare name — a plain
  // `MPD_E2E_LIVE_PROMPT:` with no `${…:-}` would leave the variable unset for the container and
  // make the knob look installed while forwarding nothing, which is the failure this arm exists to
  // catch. Two matching entries pin the shape to exactly the two declared services.
  /** Every effective-config line declaring the live-prompt knob, for the assertion's raw output. */
  const livePromptLines = compose.match(/^\s*MPD_E2E_LIVE_PROMPT:.*$/gm) ?? []
  /** The `${MPD_E2E_LIVE_PROMPT:-}` interpolations, one per service. */
  const livePromptInterpolations = compose.match(/\$\{MPD_E2E_LIVE_PROMPT:-\}/g) ?? []
  check("both services interpolate the optional live prompt knob", livePromptInterpolations.length === 2 && livePromptLines.length === 2, JSON.stringify(livePromptLines))
  // The DRIVER half of the same knob: whether the compose argv gets `-e MPD_E2E_LIVE_PROMPT`. The four
  // cases are the ones a run can actually be in — an unset AND an empty prompt must both leave the
  // flag out (the container then keeps the entrypoint's own default), and a run that never asked for
  // the live arms must not leak the flag either.
  check("the live prompt is forwarded only for a live run with a non-empty value", livePromptOverride(true, "write a snake game") && !livePromptOverride(true, "") && !livePromptOverride(true, undefined) && !livePromptOverride(false, "write a snake game"))

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
  for (const pattern of [".git", "node_modules", "**/node_modules", "dist/*", "evidence", ".toolchain", "pnpm-workspace.yaml", "pnpm-lock.yaml", ".npmrc", ".pnpmfile.cjs"]) {
    check(`Dockerfile.dockerignore excludes ${pattern}`, ignore.includes(pattern))
  }
  // THE ONE DELIBERATE EXCEPTION. The §7 pack arms grade the artifact that TRAVELLED IN, so the ignore
  // file must re-admit exactly `dist/mpd-package` after excluding `dist/*` — and the entrypoint must
  // assert that same shape at run time, because a file can be added to the context later. Two halves of
  // one clause: this arm reddens if either half is dropped.
  check(
    "Dockerfile.dockerignore re-admits dist/mpd-package (the §7 pack arms' subject)",
    ignore.includes("!dist/mpd-package") && ignore.indexOf("!dist/mpd-package") > ignore.indexOf("dist/*"),
    JSON.stringify(ignore.filter((p: string) => p.includes("dist"))),
  )
  check("the bare `dist` pattern is gone (it would exclude the subject too)", !ignore.includes("dist"))
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
  // The knob is only reachable when the entrypoint reads it: this is the third layer of the path
  // (compose interpolates it, this driver forwards it, the entrypoint substitutes it).
  check("entrypoint reads the optional live prompt knob", entrypoint.includes("MPD_E2E_LIVE_PROMPT"))

  // 8b. THE §7 ACCEPTANCE ARMS. Each of these is a WIRE the gate needs to exist at all: the apparatus
  //     module must be invoked, with the paths it grades, or the assertion row can only ever be
  //     "not reached". The runtime verdict of each arm lives in the container; what is checkable
  //     offline is that the lane actually asks the question.
  /** The apparatus invocations the §7 arms rest on, with the flag that makes each one meaningful. */
  const owedWiring: readonly (readonly [module: string, flag: string])[] = [
    ["owed-install.ts", "--install-log"],
    ["owed-pack.ts", "--artifact"],
    ["owed-mcp.ts", "--boot-log"],
    ["owed-cases.ts", "--kind"],
  ]
  for (const [moduleName, flag] of owedWiring) {
    check(
      `entrypoint invokes docker/lib/${moduleName} with ${flag}`,
      entrypoint.includes("/" + moduleName) && entrypoint.includes(flag),
    )
  }
  check("entrypoint stages the ast-grep engine (the live search cannot run without it)", entrypoint.includes("scripts/install-mcp.ts"))
  check("entrypoint points the live search at real source", /export MPD_E2E_PROBE_SEARCH_DIR=/.test(entrypoint))
  check("probe.ts grades the mcp__ naming surface, not just three known names", readFileSync(join(DOCKER_DIR, "probe.ts"), "utf8").includes("MCP_SERVER_COUNTS"))
  check("probe.ts drives a REAL ast-grep search with its negative control", /MCP_LIVE_SEARCH_CONTROL/.test(readFileSync(join(DOCKER_DIR, "probe.ts"), "utf8")))
  // Every owed assertion must be DECLARED in the reporter, or a run that never reached it would drop it
  // silently instead of reporting it as owed — the exact gap the 2026-10-03 defect hid behind.
  /** The reporter's canonical assertion list. */
  const reported = readFileSync(join(DOCKER_DIR, "lib", "report.ts"), "utf8")
  for (const name of [
    "install.buildScripts",
    "pack.licenceCoherence",
    "pack.declarationCoherence",
    "pack.staticCoherence",
    "pack.distFreshRebuild",
    "boot.mcpToolNaming",
    "boot.mcpLiveSearch",
    "restore.reviewPanelSelfTest",
    "restore.reviewPanelCase",
    "restore.lspBootstrap",
    "restore.hashlineRepair",
    "qa.mcpCall",
    "qa.readonlyDeny",
  ]) {
    check(`report.ts declares the §7 assertion ${name}`, reported.includes(`"${name}"`))
  }
  check("pack.present is declared too (a missing artifact is a FAIL, never a skip)", reported.includes('"pack.present"'))

  // 8c. THE S-B ARMS (§4 S-B, 2026-10-09). Every arm below RUNS the real apparatus module it grades
  //     against PLANTED fixtures, and every one of them has a planted NEGATIVE control. A self-test that
  //     only greps a file for a name would pass on a module that always answers `true` — these do not:
  //     the panel classifier, the rebuild's compiler witness and the pack comparator are all driven, and
  //     the controls below are the same fixture with one field turned.
  // THE FIXTURES LIVE OUTSIDE THE REPOSITORY on purpose: `verify:comments` scans this repository's
  // TypeScript sources, and a planted `src/index.ts` under `docker/` is a policed declaration — measured
  // 2026-10-09, when a fixture tree left behind by a failing run reddened that STANDING gate. A temp
  // directory keeps the fixture out of every tree-walking gate, and it is removed at the end of the run.
  /** Scratch root for the S-B arms (outside the repository, so no gate ever walks it). */
  const sbDir = mkdtempSync(join(tmpdir(), "mpd-docker-e2e-sb-"))
  /** Run one apparatus module under this interpreter, returning its combined output and exit status. */
  const runApparatus = (script: string, args: readonly string[]): { status: number | null; out: string } => {
    /** The child run; both streams are merged because the modules print their contract to stdout. */
    const run = spawnSync(process.execPath, [join(DOCKER_DIR, "lib", script), ...args], { encoding: "utf8" })
    return { status: run.status, out: `${run.stdout ?? ""}${run.stderr ?? ""}` }
  }
  /** The value of one `[tag] KEY=value` line an apparatus module printed, or the empty string. */
  const printed = (out: string, key: string): string => new RegExp(`^\\[[a-z-]+\\] ${key}=(.*)$`, "m").exec(out)?.[1] ?? ""
  /** Read one assertion row's `ok` out of an NDJSON state file, as a string (`missing` when absent). */
  const stateRow = (stateFile: string, name: string): string => {
    /** Every non-empty line of the state file, parsed as a row (a corrupt line is reported as such). */
    const rows = readFileSync(stateFile, "utf8").split("\n").filter((line: string) => line.trim() !== "").map((line: string) => JSON.parse(line) as { name: string; ok: unknown })
    /** The last row recorded under this name — the reporter's own last-wins rule. */
    const row = [...rows].reverse().find((candidate) => candidate.name === name)
    return row === undefined ? "missing" : String(row.ok)
  }

  // 8c.1 THE TUI PANEL CLASSIFIER (criterion 4's measurement, criterion 7's offline falsifier).
  //      The fixtures carry the REAL strings the authoritative capture carries (`pane-merged.txt`), and
  //      the control is the PRE-KEY capture: a pane taken before the combo was sent.
  /** The sidebar panel body, exactly as the 0.14.0 capture carries it. */
  const panelBodyPane = [
    "  chat screen                                                                   │┌MPD──────────────────────────────────────┐",
    "                                                                                ││MPD                                       ⤢│",
    "                                                                                ││subagents  0 total · 0 running · 0 completed · 0 failed│",
    "                                                                                ││⚪ No subagents in the current session     │",
    "                                                                                ││team Scene Smoke  phase active  tasks 1/3  members 2  █████░░░░│",
    "                                                                                │││ ✓ T1   │                                 │",
    "                                                                                ││view boxes · 3 tasks · ranks derived       │",
  ].join("\n") + "\n"
  /** The same terminal BEFORE the combo: a chat screen with no panel body in it. */
  const preKeyPane = "  chat screen\n  ▶ loaded context\n  mpd: team Scene Smoke 2·1/3 (workspace-level)\n"
  /** The pre-0.13 full-screen scene, whose strings the `absent` shape still grades. */
  const sceneBodyPane = "MPD subagents + team\nsubagents  0 total · 0 running\nbuild the graph to see dependencies\n"
  /** Where the fixture panes live. */
  const panelDir = join(sbDir, "panel")
  mkdirSync(panelDir, { recursive: true })
  writeFileSync(join(panelDir, "pane-merged.txt"), panelBodyPane)
  writeFileSync(join(panelDir, "pane-teamClosed.txt"), preKeyPane)
  writeFileSync(join(panelDir, "pane-scene.txt"), sceneBodyPane)
  writeFileSync(join(panelDir, "pane-inverted.txt"), [
    "│┌MPD──────┐",
    "││team Scene Smoke  phase active  tasks 1/3  members 2│",
    "││subagents  0 total · 0 running│",
  ].join("\n") + "\n")
  // A pane already showing the panel BEFORE the key: the capture cannot attribute the open to the combo.
  writeFileSync(join(panelDir, "pane-control-dirty.txt"), panelBodyPane)
  /** The positive run: panel body present, control clean. */
  const panelGood = runApparatus("tui-panel-body.ts", ["--pane", join(panelDir, "pane-merged.txt"), "--control", join(panelDir, "pane-teamClosed.txt"), "--shape", "present"])
  check("tui-panel-body reads the panel body as an OPEN (criterion 4)", panelGood.status === 0 && printed(panelGood.out, "OPENS") === "true", panelGood.out.trim())
  check("tui-panel-body reads the subagent section ABOVE the team body", printed(panelGood.out, "ORDER") === "true", printed(panelGood.out, "ORDER"))
  // MEMBERSHIP, NEVER A FIXED COUNT (criterion 4b): the assertion is that each family is PRESENT and the
  // control is clean — the counts themselves vary with how many lines a host draws per family.
  /** The classifier's own hit line; `printed()` returns the value after `TITLE_HITS=`, which carries the
   *  three sibling counts, so each family is asserted on that one line — as PRESENCE, never as a count. */
  const panelHitLine = printed(panelGood.out, "TITLE_HITS")
  check("the open verdict quotes a present marker in every family and a CLEAN control", /^[1-9]/.test(panelHitLine) && /SUB_HITS=[1-9]/.test(panelHitLine) && /TEAM_HITS=[1-9]/.test(panelHitLine) && /CONTROL_HITS=0/.test(panelHitLine), panelHitLine)
  // THE FALSIFIER (criterion 7): the SAME pane, with a control that already carries the body, must NOT
  // be readable as an open — this is how the row reddens when the capture order or the key breaks.
  const panelDirty = runApparatus("tui-panel-body.ts", ["--pane", join(panelDir, "pane-merged.txt"), "--control", join(panelDir, "pane-control-dirty.txt"), "--shape", "present"])
  check("a control that already carries the body makes the open FALSE (the planted falsifier)", panelDirty.status === 0 && printed(panelDirty.out, "OPENS") === "false" && printed(panelDirty.out, "ORDER") === "false", panelDirty.out.trim())
  check("the falsifier names the control as the cause", printed(panelDirty.out, "REASON").includes("PRE-KEY capture already carries"), printed(panelDirty.out, "REASON"))
  // The ORDER row is a comparison, not a constant: the same markers INVERTED must go false while the
  // open stays true (otherwise a "true" on order would carry no information).
  const panelInverted = runApparatus("tui-panel-body.ts", ["--pane", join(panelDir, "pane-inverted.txt"), "--control", join(panelDir, "pane-teamClosed.txt"), "--shape", "present"])
  check("inverted section order opens but FAILS the order row", printed(panelInverted.out, "OPENS") === "true" && printed(panelInverted.out, "ORDER") === "false", panelInverted.out.trim())
  // A host WITHOUT the seam keeps its previous meaning: the pre-0.13 scene's own strings.
  const panelAbsent = runApparatus("tui-panel-body.ts", ["--pane", join(panelDir, "pane-scene.txt"), "--control", join(panelDir, "pane-teamClosed.txt"), "--shape", "absent"])
  check("the pre-0.13 shape still grades the full-screen scene", printed(panelAbsent.out, "OPENS") === "true" && printed(panelAbsent.out, "SHAPE") === "absent", panelAbsent.out.trim())
  check("a missing pane is a usage failure, never a silent false", runApparatus("tui-panel-body.ts", ["--pane", join(panelDir, "does-not-exist.txt")]).status === 2)
  // THE WIRE (criterion 7): the lane must USE that classifier — a falsified module nobody calls is not
  // an offline falsifier of `docker/tui-lane.sh`. The lane keeps no marker of its own, so this arm and
  // the classifier arms above together cover the whole path.
  /** The TUI lane's own text, read for the two wires below. */
  const tuiLane = readFileSync(join(DOCKER_DIR, "tui-lane.sh"), "utf8")
  check("tui-lane.sh drives the shared panel classifier", tuiLane.includes("tui-panel-body.ts") && tuiLane.includes('--shape "$PANEL_SEAM"'))
  check("tui-lane.sh hands the classifier the PRE-KEY capture as its control", /--control "\$MERGED_TEAMCLOSED_PANE"/.test(tuiLane))
  check("tui-lane.sh no longer records the merged rows as unreachable", !/record tui\.mergedPanelOpens null/.test(tuiLane) && !/record tui\.mergedPanelOrder null/.test(tuiLane))
  check("the Dockerfile carries the new apparatus module", readFileSync(DOCKERFILE, "utf8").includes("COPY docker/lib/ /opt/mpd-e2e/lib/"))

  // 8c.2 THE REBUILD'S COMPILER WITNESS (criteria 1 and 2). The arm runs the REAL rebuild module with a
  //       PLANTED fake compiler, so the witness it prints is a measurement of the binary it invoked —
  //       not a reading of PATH.
  /** A fake `bun` that answers `--version` and refuses to build: the witness is all this arm reads. */
  const fakeBun = join(sbDir, "fake-bun")
  writeFileSync(fakeBun, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo \"1.4.0-planted\"; exit 0; fi\necho \"fake bun: this arm does not build\" >&2\nexit 1\n")
  /** The fixture tree the rebuild walks; one package with a same-name src/dist pair. */
  const rebuildRepo = join(sbDir, "rebuild-repo")
  mkdirSync(join(rebuildRepo, "packages", "demo", "src"), { recursive: true })
  mkdirSync(join(rebuildRepo, "packages", "demo", "dist"), { recursive: true })
  writeFileSync(join(rebuildRepo, "packages", "demo", "src", "index.ts"), "export const x = 1\n")
  writeFileSync(join(rebuildRepo, "packages", "demo", "dist", "index.js"), "export const x = 1\n")
  spawnSync("chmod", ["755", fakeBun])
  /** The witness file the run writes. */
  const rebuildJson = join(sbDir, "rebuild.json")
  /** The witness run: the REAL rebuild module, driven with the planted compiler. */
  const rebuildRun = spawnSync(process.execPath, [join(DOCKER_DIR, "lib", "rebuild.ts"), "--repo", rebuildRepo, "--bun", fakeBun, "--json", rebuildJson], { encoding: "utf8" })
  /** The run's combined output. */
  const rebuildOut = `${rebuildRun.stdout ?? ""}${rebuildRun.stderr ?? ""}`
  check("rebuild.ts names the binary it invoked and that binary's own version", rebuildOut.includes(`[rebuild] BUN=${fakeBun} VERSION=1.4.0-planted`), rebuildOut.trim().split("\n")[0] ?? "")
  check("rebuild.ts carries the same witness into its json payload", existsSync(rebuildJson) && readJson<{ bun?: { bin?: string; version?: string } }>(rebuildJson).bun?.version === "1.4.0-planted", existsSync(rebuildJson) ? readFileSync(rebuildJson, "utf8").slice(0, 120) : "<no json>")
  /** The same run with no `--bun`: the default must be reported as the BARE name, never as a resolved path. */
  const rebuildDefaultRun = spawnSync(process.execPath, [join(DOCKER_DIR, "lib", "rebuild.ts"), "--repo", rebuildRepo], { encoding: "utf8" })
  check("the default compiler is reported as the bare `bun`, not as a silent PATH resolution", `${rebuildDefaultRun.stdout ?? ""}`.includes("[rebuild] BUN=bun VERSION="), `${rebuildDefaultRun.stdout ?? ""}`.split("\n")[0] ?? "")

  // 8c.3 THE PACK COMPARATOR (criteria 2 and 3): green on an unmodified artifact, red on a mutated one,
  //       and the toolchain compared by EXACT version equality — including the substring trap that the
  //       previous implementation (`declaredPin.includes(containerBun)`) would have passed.
  /** The graded artifact fixture. */
  const packArtifact = join(sbDir, "pack-artifact")
  /** The tree the artifact claims to be cut from. */
  const packSource = join(sbDir, "pack-source")
  /** The from-source rebuild the freshness row compares against. */
  const packRebuild = join(sbDir, "pack-rebuild")
  for (const root of [packArtifact, packSource, packRebuild]) mkdirSync(join(root, "packages", "demo", "dist"), { recursive: true })
  writeFileSync(join(packSource, "packages", "demo", "dist", "index.js"), "export const demo = 1\n")
  writeFileSync(join(packSource, "package.json"), JSON.stringify({ name: "demo-bundle", buildToolchain: "bun@1.4.0" }) + "\n")
  writeFileSync(join(packArtifact, "packages", "demo", "dist", "index.js"), "export const demo = 1\n")
  writeFileSync(join(packRebuild, "packages", "demo", "dist", "index.js"), "export const demo = 1\n")
  /** The rebuild's witness, naming the compiler that produced it. */
  const rebuildWitness = join(sbDir, "rebuild-witness.json")
  writeFileSync(rebuildWitness, JSON.stringify({ ok: true, bun: { bin: "/opt/toolchain/bun-pinned/bin/bun", version: "1.4.0" }, entries: 1 }) + "\n")
  /** One comparator run against the current fixtures; each arm below turns exactly one field. */
  const runPack = (tag: string): string => {
    /** This run's own state file, so no arm can read another arm's rows. */
    const state = join(sbDir, `pack-${tag}.ndjson`)
    rmSync(state, { force: true })
    runApparatus("owed-pack.ts", ["--artifact", packArtifact, "--source", packSource, "--rebuild", packRebuild, "--rebuild-report", rebuildWitness, "--state", state])
    return state
  }
  /** The unmodified fixture: fresh AND under the declared compiler. */
  const packGreen = runPack("green")
  check("an unmodified artifact is FRESH against its rebuild (criterion 3, green arm)", stateRow(packGreen, "pack.distFreshRebuild") === "true", stateRow(packGreen, "pack.distFreshRebuild"))
  check("the rebuild's own witness is matched EXACTLY against the declared pin", stateRow(packGreen, "pack.rebuildToolchain") === "true", stateRow(packGreen, "pack.rebuildToolchain"))
  // THE MUTATION (criterion 3's negative control): one byte-run appended to the graded artifact.
  appendFileSync(join(packArtifact, "packages", "demo", "dist", "index.js"), "// planted mutation\n")
  /** The same fixture, re-graded after the planted mutation. */
  const packMutated = runPack("mutated")
  check("a MUTATED artifact is NOT fresh (the planted negative control)", stateRow(packMutated, "pack.distFreshRebuild") === "false", stateRow(packMutated, "pack.distFreshRebuild"))
  check("the mutation leaves the toolchain row green, so the two subjects stay separate", stateRow(packMutated, "pack.rebuildToolchain") === "true", stateRow(packMutated, "pack.rebuildToolchain"))
  writeFileSync(join(packArtifact, "packages", "demo", "dist", "index.js"), "export const demo = 1\n")
  // THE TOOLCHAIN CONTROL: the artifact is byte-identical again, and only the WITNESS moves.
  writeFileSync(rebuildWitness, JSON.stringify({ ok: true, bun: { bin: "/usr/local/bin/bun", version: "1.4.2" }, entries: 1 }) + "\n")
  /** The fixture with a byte-identical artifact and a witness naming a DIFFERENT compiler. */
  const packDrift = runPack("drift")
  check("a rebuild under a DIFFERENT bun reddens the toolchain row", stateRow(packDrift, "pack.rebuildToolchain") === "false", stateRow(packDrift, "pack.rebuildToolchain"))
  check("the freshness row quotes the compiler that actually produced the rebuild", readFileSync(packDrift, "utf8").includes("rebuildBunVersion=1.4.2"), readFileSync(packDrift, "utf8").split("\n").find((line: string) => line.includes("distFreshRebuild"))?.slice(0, 200) ?? "")
  // THE SUBSTRING TRAP: `1.4` must NOT read as the declared `bun@1.4.0` — the exact defect criterion 2
  // names, and one the previous `declaredPin.includes(containerBun)` predicate would have passed.
  writeFileSync(rebuildWitness, JSON.stringify({ ok: true, bun: { bin: "/opt/toolchain/bun-pinned/bin/bun", version: "1.4" }, entries: 1 }) + "\n")
  check("a partial version (`1.4` vs `bun@1.4.0`) is NOT an exact match", stateRow(runPack("partial"), "pack.rebuildToolchain") === "false")
  // NO WITNESS = NO CLAIM: with no `--rebuild-report` the compiler is unknown, and the row says so.
  writeFileSync(rebuildWitness, JSON.stringify({ ok: true, entries: 1 }) + "\n")
  /** The state file of the run handed a rebuild report with no `bun` block at all. */
  const packNoWitness = join(sbDir, "pack-nowitness.ndjson")
  rmSync(packNoWitness, { force: true })
  runApparatus("owed-pack.ts", ["--artifact", packArtifact, "--source", packSource, "--rebuild", packRebuild, "--state", packNoWitness])
  check("a rebuild with no compiler witness cannot claim the toolchain", stateRow(packNoWitness, "pack.rebuildToolchain") === "false", stateRow(packNoWitness, "pack.rebuildToolchain"))
  // NO REBUILD = NO MEASUREMENT: the one-click mode's shape, where BOTH rows are null with a reason.
  const packNoRebuild = join(sbDir, "pack-norebuild.ndjson")
  rmSync(packNoRebuild, { force: true })
  runApparatus("owed-pack.ts", ["--artifact", packArtifact, "--source", packSource, "--state", packNoRebuild])
  check("with no rebuild both pack rows are null, never a green that measures nothing", stateRow(packNoRebuild, "pack.distFreshRebuild") === "null" && stateRow(packNoRebuild, "pack.rebuildToolchain") === "null")

  // 8c.4 THE ENTRYPOINT WIRES the criteria rest on. Each string below is a place where the lane has to
  //       ASK the question; without it the row can only ever be "not reached".
  check("entrypoint stages the PINNED build toolchain read from the tree", entrypoint.includes("buildToolchain") && entrypoint.includes("03b-bun-pin") && entrypoint.includes('BUN_INSTALL="$PINNED_BUN_DIR"'))
  check("entrypoint hands the PINNED binary to the rebuild", entrypoint.includes('--bun "$REBUILD_BUN"'))
  check("entrypoint passes the rebuild's witness to the pack comparator", entrypoint.includes('--rebuild-report "$PACK_REBUILD_REPORT"'))
  check("entrypoint runs the MUTATED-artifact control of the freshness row", entrypoint.includes("08c2-pack-control") && entrypoint.includes("pack.distFreshRebuildControl"))
  check("entrypoint records the one-click-only rows in source mode, with the mode as the reason", /record oneclick\.scratchRepo null/.test(entrypoint) && /record oneclick\.distByteIdentical null/.test(entrypoint) && entrypoint.includes("mode=$INSTALL_MODE"))
  check("entrypoint stages the engine into the tree the mcp-call launcher reads, AFTER the re-pack", entrypoint.includes("16b2-case-engine") && entrypoint.includes('--toolchain "$CASE_ENGINE_TREE/.toolchain"'))
  check("entrypoint records whether that engine is really there", entrypoint.includes("record qa.mcpCallEngine"))
  // 8c.5 THE HANG GUARD AND THE NPM TRANSPORT (measured 2026-10-09: a stalled `npm i -g` sat 23 minutes
  //      at 0.3% CPU until the run had to be killed, and the official registry's SCOPED endpoint —
  //      the one the harness pin resolves through — failed one probe and answered the next).
  check("run_step bounds every step in time", entrypoint.includes('timeout --kill-after=15 "$STEP_TIMEOUT"'))
  check("a timeout kill is recorded as such, never as a verdict", /KILLED BY THE \$\{STEP_TIMEOUT\}s STEP TIMEOUT/.test(entrypoint))
  check("npm's own per-request timeouts are bounded", entrypoint.includes("NPM_CONFIG_FETCH_TIMEOUT") && entrypoint.includes("NPM_CONFIG_FETCH_RETRIES"))
  check("the lane probes the SCOPED registry endpoint the harness pin resolves through", entrypoint.includes("@deepseek-ai%2fdsh"))
  check("the probe falls back to a mirror ONLY when the official registry does not answer, and says which was used", entrypoint.includes("mirror-fallback") && entrypoint.includes("fact obs.npmRegistry"))
  check("the registry actually used is exported to npm", entrypoint.includes('export NPM_CONFIG_REGISTRY='))
  // The selection is READ FROM A FILE, not parsed out of the step log: measured 2026-10-09, the log of
  // this very step carried a NUL frame, and a plain grep answers `binary file matches` for such a file
  // INSTEAD of the line — so the parse came back empty, the shell kept the OFFICIAL registry, and the
  // run went on stalling against the endpoint the step exists to avoid.
  check("the registry selection is read from its own file, not grepped out of a binary log", /sed -n '1p' "\$NPM_SELECTION_FILE"/.test(entrypoint) && entrypoint.includes('NPM_SELECTION_FILE="$WORK_DIR/npm-registry.txt"'))
  check("every grep over the container's step logs tolerates a NUL frame", !/grep -m1[^\n]*01b-npm-registry\.log/.test(entrypoint) && entrypoint.includes("grep -a -m1"))
  check("the TUI lane step is bounded in time too (it was the one unbounded command)", entrypoint.includes('timeout --kill-after=15 "$TUI_TIMEOUT" bash /opt/mpd-e2e/tui-lane.sh'))
  check("the TUI lane's elapsed seconds are measured, not written as 0", entrypoint.includes('append_step 14-tui "$TUI_STEP" "$TUI_SECONDS"'))
  // pnpm resolves its registry through the LOWERCASE env form (`dsh plugin` forwards to it), so the
  // uppercase export alone leaves every plugin install on the default registry — measured 2026-10-09,
  // when the lane's own `npm i -g` used the mirror while `dsh plugin add` kept retrying the flaky one.
  check("the selected registry is exported in BOTH cases (pnpm reads the lowercase form)", entrypoint.includes('export NPM_CONFIG_REGISTRY="$NPM_REGISTRY"') && entrypoint.includes('export npm_config_registry="$NPM_REGISTRY"'))
  // The case-engine probe must try `ast-grep` (the resolver's first candidate) and read BOTH streams:
  // the deprecated `sg` shim prints a warning to stderr and nothing to stdout.
  check("the case-engine probe uses the resolver's own candidate order and both streams", /CASE_ENGINE_BIN=""/.test(entrypoint) && entrypoint.includes('"$candidate" --version 2>&1'))
  check("compose interpolates the npm transport knobs (a knob only the entrypoint reads is unreachable)", /MPD_E2E_NPM_REGISTRY: \$\{MPD_E2E_NPM_REGISTRY:-\}/.test(compose) && /MPD_E2E_NPM_MIRROR: \$\{MPD_E2E_NPM_MIRROR:-\}/.test(compose) && /MPD_E2E_STEP_TIMEOUT: \$\{MPD_E2E_STEP_TIMEOUT:-\}/.test(compose))
  /** The names the union of BOTH modes' recorded rows demands (the four one-click-only names plus the
   *  thirteen the lanes recorded outside the old spine), quoted so a missing one reddens here. */
  const unionRequired: readonly string[] = [
    "team.route.state", "team.route.plan", "team.route.task", "team.route.mail", "team.routesAll", "team.planLookup",
    "tui.teamSceneOtherSessionInvisible", "tui.teamFixtureBound", "tui.teamSceneOpened", "tui.teamGraphDrawn",
    "tui.teamGraphEdges", "tui.teamGraphContent", "tui.laneExit",
    "oneclick.scratchRepo", "oneclick.requiredPaths", "oneclick.filesAllowlist", "oneclick.distByteIdentical",
  ]
  for (const name of unionRequired) check(`the EXPECTED spine declares the union row ${name}`, reported.includes(`"${name}"`))
  for (const name of ["toolchain.bunPinned", "pack.rebuildToolchain", "pack.distFreshRebuildControl", "qa.mcpCallEngine"]) {
    check(`the EXPECTED spine declares the new S-B row ${name}`, reported.includes(`"${name}"`))
  }
  /** The declared spine, parsed so a duplicate can be caught (the reporter keys rows by NAME). */
  const spineNames = [...(/const EXPECTED: readonly string\[\] = \[([\s\S]*?)^\]/m.exec(reported)?.[1] ?? "").split("\n").filter((line: string) => !line.trim().startsWith("//")).join("\n").matchAll(/"([^"]+)"/g)].map((match) => match[1])
  check("the EXPECTED spine carries no duplicate name", spineNames.length === new Set(spineNames).size, `names=${spineNames.length} unique=${new Set(spineNames).size}`)
  check("the declared spine covers the union of both modes' rows", unionRequired.every((name) => spineNames.includes(name)) && spineNames.length >= 114, `spine=${spineNames.length}`)

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
  rmSync(sbDir, { recursive: true, force: true })
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
    console.log("usage: node scripts/docker-e2e.ts [--self-test] [--no-build] [--mode source|oneclick|all] [--spec <install-spec>] [--live|--require-live] [--require-browser|--no-browser] [--allow-rootful-docker] [--require-docker]")
    return
  }
  // `--mode all` runs EVERY acceptance mode, each as its own child process, so one command answers the
  // whole "does this run everywhere" question. Each child gets its own evidence directory and its own
  // compose build (cached after the first), and the parent reports the WORST child exit code.
  /** The mode operand, or `source` when the caller named none. */
  const modeOperand = argv.includes("--mode") ? argv[argv.indexOf("--mode") + 1] : "source"
  if (modeOperand === "all") {
    /** This process's arguments with `--mode` and its operand removed, so each child names its own. */
    const childArgv: string[] = []
    for (let index = 0; index < argv.length; index++) {
      if (argv[index] === "--mode") { index++; continue }
      childArgv.push(argv[index])
    }
    /** One entry per mode actually run, in order. */
    const outcomes: Array<{ mode: string; code: number }> = []
    for (const mode of ["source", "oneclick"]) {
      console.log(`\n[driver] ===== mode ${mode} =====`)
      /** The child run; its stdio is inherited so the operator sees both lanes live. */
      const child = spawnSync(process.execPath, [SELF, ...childArgv, "--mode", mode], { stdio: "inherit" })
      outcomes.push({ mode, code: child.status ?? 2 })
    }
    /** The aggregate verdict: a missing prerequisite outranks a failure, which outranks no verdict. */
    const worst = outcomes.some((outcome) => outcome.code === 3) ? 3
      : outcomes.some((outcome) => outcome.code === 1) ? 1
        : outcomes.some((outcome) => outcome.code === 2) ? 2 : 0
    console.log(`\n[driver] --mode all: ${outcomes.map((outcome) => `${outcome.mode}=${outcome.code}`).join(" ")} -> ${worst}`)
    process.exitCode = worst
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
  /** Whether the caller asked for the live arms; the key is only forwarded when they did. */
  const liveRequested = argv.includes("--live") || argv.includes("--require-live")
  /** Whether this process actually holds a key to forward. */
  const keyPresent = process.env.DEEPSEEK_API_KEY !== undefined && process.env.DEEPSEEK_API_KEY !== ""
  // `--live` IS A CONTRACT, NOT A HINT. It used to print a warning and run anyway, which produced a
  // green lane whose live rows were all `null` — the exact "verification that verifies nothing" shape
  // this lane exists to remove. Asking for the live arms without a key now fails BEFORE the build.
  if (liveRequested && !keyPresent) {
    console.error("[driver] --live was passed but DEEPSEEK_API_KEY is not set in this environment; refusing to run a lane that would report the credential-free NULL. Export the key, or drop --live.")
    process.exitCode = 3
    return
  }
  // THE BROWSER LANE IS ON BY DEFAULT: the Web GUI is a shipped surface, so "is it usable in a real
  // browser" is not an optional question. `--no-browser` skips it (and its assertions become NULL,
  // which the required-arm check below then reports honestly). `--require-browser` is the explicit
  // spelling of the default, kept because a caller reading the release checklist looks for a flag
  // that NAMES the requirement rather than for the absence of an opt-out.
  const browserEnabled = argv.includes("--require-browser") || !argv.includes("--no-browser")
  /** The environment overrides for the compose run. */
  const envOverrides = [
    ...(mode === "oneclick" ? ["-e", "MPD_E2E_INSTALL_MODE=oneclick"] : []),
    ...(spec === undefined ? [] : ["-e", `MPD_E2E_INSTALL_SPEC=${spec}`]),
    // THE CREDENTIAL IS FORWARDED BY NAME, NEVER BY VALUE, and only when this process actually has
    // one. `-e DEEPSEEK_API_KEY` makes compose read it from THIS process's environment, so the secret
    // never enters the argv the driver echoes below — which is the whole reason the live turn can be
    // run at all without violating AGENTS.md §10 ("never committed, logged, or echoed").
    ...(liveRequested ? ["-e", "DEEPSEEK_API_KEY", "-e", "MPD_E2E_LIVE=1"] : []),
    // THE LIVE PROMPT ALSO TRAVELS BY NAME, for the same reason the key does: passing it by VALUE
    // would print a caller's whole task into the argv this driver echoes below. `-e
    // MPD_E2E_LIVE_PROMPT` makes compose read it from THIS process's environment, and it is added
    // only when a live run was asked for AND the value is non-empty — forwarding an empty string
    // would be a no-op the compose file already maps to the entrypoint's own default prompt.
    ...(livePromptOverride(liveRequested, process.env.MPD_E2E_LIVE_PROMPT) ? ["-e", "MPD_E2E_LIVE_PROMPT"] : []),
    ...(browserEnabled ? ["-e", "MPD_E2E_BROWSER=1"] : []),
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
  // THE REQUIRED-ARM GATE. An arm the caller asked for that came back unevaluated is a MISSING
  // PREREQUISITE, not a pass — exit 3, the same code `--require-docker` uses for a skipped lane. This
  // is what makes `--live` and the browser lane unfakeable: the run cannot green by not running them.
  /** The assertion-name prefixes whose `null` rows are fatal for this invocation. */
  const requiredPrefixes: string[] = [
    ...(liveRequested ? ["live.", "boot.llmTurn"] : []),
    ...(browserEnabled ? ["ui."] : []),
  ]
  /** The unevaluated assertions inside those arms. */
  const unmeasured = unmeasuredRequired(result, requiredPrefixes)
  /** The verdict after the requirement gate. */
  const finalExit = unmeasured.length > 0 ? 3 : exitCode
  writeFileSync(driverLog, JSON.stringify({
    startedAt,
    finishedAt: new Date().toISOString(),
    docker: docker.version,
    compose: docker.compose,
    image: IMAGE,
    imageMiB: sizeMiB,
    buildxConfig: buildx.env.BUILDX_CONFIG,
    liveRequested,
    browserEnabled,
    requiredPrefixes,
    unmeasured,
    steps,
    containerExit: ran.status,
    verdict: summarize(result),
    exitCode: finalExit,
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
  // The required arms are named separately, because these are the ones that turn the run RED.
  for (const name of unmeasured) {
    console.log(`[driver] UNMEASURED ${name} — this arm was required by the flags of this invocation, so a null is a MISSING PREREQUISITE (exit 3), not a pass`)
  }
  console.log(`[driver] evidence -> ${relative(REPO, evidence)}`)
  cleanup()
  process.exitCode = finalExit
}

// A module that also exports its helpers must not run the docker stack when it is imported: the
// CLI body executes only for the direct `node scripts/docker-e2e.ts` invocation.
if (process.argv[1] === SELF) {
  main().catch((error: unknown): void => {
    console.error(`[driver] unexpected failure: ${String(error instanceof Error ? error.stack ?? error : error)}`)
    process.exitCode = 2
  })
}
