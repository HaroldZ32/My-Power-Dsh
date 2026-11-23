// The shared credential-free source acceptance lane for release operators and GitHub Actions.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { evidenceDir } from "./docker-e2e.ts"
import { repoRootFrom } from "./lib/repo.ts"

/** The checkout from which this run selects its candidate. */
const repo = repoRootFrom(import.meta.url)

/** The host settings needed for binaries and the documented public npm transport overrides. */
const registries = ["MPD_E2E_NPM_REGISTRY", "MPD_E2E_NPM_MIRROR"] as const

/**
 * Reject registry URLs that can carry credentials into the install or its evidence.
 * @param value - A configured public registry override, with empty meaning the default.
 * @returns Whether the override is an HTTP(S) URL without user info, query or fragment.
 */
function publicRegistry(value: string): boolean {
  if (value === "") return true
  /** URL parsing turns syntax errors into an ordinary input refusal. */
  const url = URL.parse(value)
  return url !== null && (url.protocol === "https:" || url.protocol === "http:")
    && !url.username && !url.password && !url.search && !url.hash
}

/**
 * Give every child a private home and Docker config. Preserve the local daemon socket without
 * reading the operator's Docker contexts or forwarding provider, registry or runner credentials.
 * @param home - Private home for this invocation.
 * @param base - Host environment from which to select the public settings and socket.
 * @returns Environment for Git, tar, the packer and the Docker driver.
 */
function isolatedEnv(home: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  /** Credential, agent and Compose overrides cannot enter through the allowlist. */
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    DOCKER_CONFIG: join(home, ".docker"),
    COMPOSE_DISABLE_ENV_FILE: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    PATH: base.PATH,
  }
  for (const key of registries) env[key] = base[key]
  /** The Linux default rootless socket, used when the caller did not give an endpoint. */
  const rootless = join(base.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? ""}`, "docker.sock")
  if (base.DOCKER_HOST?.startsWith("unix:///")) env.DOCKER_HOST = base.DOCKER_HOST
  else if (existsSync(rootless)) env.DOCKER_HOST = `unix://${rootless}`
  return env
}

/**
 * Run a deterministic negative control without staging a checkout or contacting Docker.
 * @returns The process exit code.
 */
function selfTest(): number {
  /** Dummy secrets and Compose overrides should disappear while rootless Docker stays reachable. */
  const env = isolatedEnv("/sandbox/home", {
    PATH: "/tools", DOCKER_HOST: "unix:///run/user/1000/docker.sock", DOCKER_CONFIG: "/real/.docker",
    HOME: "/real", DSH_HOME: "/real/.dsh", DEEPSEEK_API_KEY: "fixture", GITHUB_TOKEN: "fixture",
    NODE_OPTIONS: "--require ./fixture.cjs", COMPOSE_ENV_FILES: ".env", MPD_E2E_LIVE: "1",
    MPD_E2E_NPM_REGISTRY: "https://registry.npmjs.org",
  })
  /** These are all the values the fixture is allowed to pass along. */
  const expected = {
    HOME: "/sandbox/home", DOCKER_CONFIG: "/sandbox/home/.docker", COMPOSE_DISABLE_ENV_FILE: "1",
    GIT_CONFIG_NOSYSTEM: "1", PATH: "/tools", MPD_E2E_NPM_REGISTRY: "https://registry.npmjs.org",
    DOCKER_HOST: "unix:///run/user/1000/docker.sock",
  }
  if (JSON.stringify(env) !== JSON.stringify(expected)) {
    console.error("[docker-acceptance self-test] FAIL isolated child environment")
    return 1
  }
  if (publicRegistry("https://user:fixture@registry.example/") || publicRegistry("https://registry.example/?token=fixture")) {
    console.error("[docker-acceptance self-test] FAIL credential-bearing registry override")
    return 1
  }
  console.log("[docker-acceptance self-test] PASS private HOME and Docker config, no credential or Compose env-file inheritance")
  /** Only fixture programs run. Each failure must retain the current stamp outside the staged source. */
  const fixture = mkdtempSync(join(tmpdir(), "mpd-docker-acceptance-selftest-"))
  try {
    /** Deterministic stand-in for the validated Git candidate. */
    const sha = "a".repeat(40)
    for (const [phase, status, exit] of [["archive", 19, 2], ["extract", 21, 2], ["pack", 23, 2], ["docker", 3, 3]] as const) {
      /** Each fixture gets a fresh output file so an earlier stamp cannot satisfy the control. */
      const checkout = join(fixture, phase)
      mkdirSync(checkout)
      /** The fake Git archive refuses to run until the workflow output is already visible. */
      const output = join(checkout, "github-output")
      writeFileSync(join(checkout, "git"), `#!/bin/sh\ncase "$1" in\n  rev-parse) printf '%s\\n' '${sha}';;\n  ls-tree) printf 'scripts\\000';;\n  archive) [ -s github-output ] || exit 99; exit ${phase === "archive" ? status : 0};;\nesac\n`, { mode: 0o755 })
      writeFileSync(join(checkout, "tar"), `#!/bin/sh\n${phase === "extract" ? `exit ${status}` : `/bin/mkdir "$4/scripts" && printf 'process.exitCode = ${phase === "pack" ? status : 0}\\n' > "$4/scripts/pack-mpd.ts" && printf 'process.exitCode = 3\\n' > "$4/scripts/docker-e2e.ts"`}\n`, { mode: 0o755 })
      /** This is the real entry point, with PATH limited to the fixture programs. */
      const code = run([], checkout, { PATH: checkout, GITHUB_SHA: sha, GITHUB_OUTPUT: output })
      /** Read back exactly the path the step exported for the upload action. */
      const stamp = readFileSync(output, "utf8").trim().replace(/^stamp=/, "")
      /** The fixture expects only the identity, phase and exit values from the durable receipt. */
      const receipt: unknown = JSON.parse(readFileSync(join(checkout, stamp, "acceptance.json"), "utf8"))
      if (typeof receipt !== "object" || receipt === null || !("phase" in receipt) || receipt.phase !== phase
          || !("childExitCode" in receipt) || receipt.childExitCode !== status
          || !("exitCode" in receipt) || receipt.exitCode !== exit || code !== exit) {
        console.error(`[docker-acceptance self-test] FAIL ${phase} receipt or exit propagation`)
        return 1
      }
      console.log(`[docker-acceptance self-test] PASS ${phase} failure publishes its stamp and preserves exit ${exit}`)
    }
    return 0
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

/**
 * Reserve a stamp atomically so concurrent runs cannot overwrite evidence.
 * @param checkout - The checkout that owns the evidence directory.
 * @returns The new stamp's absolute path.
 */
function reserveStamp(checkout: string): string {
  /** Start at the current second and advance only on a collision. */
  let stampTime = Date.now()
  for (;;) {
    /** The next stamp available to try. */
    const out = evidenceDir(checkout, new Date(stampTime))
    mkdirSync(dirname(out), { recursive: true })
    try {
      mkdirSync(out)
      return out
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error
      stampTime += 1000
    }
  }
}

/**
 * Write a receipt or workflow output without superseding the lane's verdict.
 * @param file - The receipt or output path.
 * @param text - Redacted evidence or the stamp path.
 * @param append - Whether this is the GitHub step output, which may contain other keys.
 */
function writeEvidence(file: string, text: string, append: boolean = false): void {
  try {
    writeFileSync(file, text, { flag: append ? "a" : "w" })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    console.error(`[docker-acceptance] could not write ${append ? "GitHub stamp output" : "acceptance receipt"}`)
  }
}

/**
 * Archive one checked-out commit, build its pack, then run the strict source lane.
 * @param argv - User options. Rootful Docker needs explicit approval from the caller.
 * @param checkout - The candidate checkout and owner of the resulting evidence.
 * @param base - Host variables, filtered for every staging and Docker child.
 * @returns The source lane's exit code, or a staging/identity failure.
 */
function run(argv: readonly string[], checkout: string = repo, base: NodeJS.ProcessEnv = process.env): number {
  if (argv.length === 1 && argv[0] === "--self-test") return selfTest()
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--allow-rootful-docker")) {
    console.error("usage: node scripts/docker-acceptance.ts [--allow-rootful-docker | --self-test]")
    return 2
  }
  /** This invocation owns the stamp before any fallible checkout or staging step. */
  const out = reserveStamp(checkout)
  /** A concise diagnostic even if the Docker reporter is never reached. */
  const record = join(out, "acceptance.json")
  /** Candidate metadata becomes available only after identifying the checkout. */
  let candidateSha: string | null = null
  /** Exact image also expected from the driver and container receipts. */
  let image: string | null = null
  /** Last phase entered, written before it can fail or time out. */
  let phase = "checkout"
  /** Staging failures retain exit 2, while the Docker driver's exit passes through. */
  let exitCode = 2
  /** Raw child result for the failed phase or the final Docker invocation. */
  let childStatus: { status: number | null; signal: string | null } | undefined
  /** Scratch is cleaned only when this run successfully allocated it. */
  let scratch: string | undefined
  /** Persist the current phase or its final outcome without disclosing subprocess output. */
  const save = (finished: boolean): void => {
    writeEvidence(record, JSON.stringify({
      candidateSha, image, phase, mode: "source", credentialForwarded: false, browserEnabled: false,
      exitCode: finished ? exitCode : null, childExitCode: childStatus?.status ?? null, signal: childStatus?.signal ?? null,
    }, null, 2) + "\n")
  }
  /** Start a new phase and clear the previous subprocess result. */
  const begin = (name: string): void => { phase = name; childStatus = undefined; save(false) }
  save(false)
  if (base.GITHUB_OUTPUT) writeEvidence(base.GITHUB_OUTPUT, `stamp=${relative(checkout, out)}\n`, true)
  try {
    for (const key of registries) {
      if (!publicRegistry(base[key] ?? "")) {
        console.error(`[docker-acceptance] ${key} must be a public HTTP(S) registry URL without credentials, query or fragment`)
        return exitCode
      }
    }
    scratch = mkdtempSync(join(tmpdir(), "mpd-docker-acceptance-"))
    /** Private root for process state, separate from the Docker build context. */
    const home = join(scratch, "home")
    mkdirSync(home)
    /** This environment is explicit for every child, including the metadata probes. */
    const env = isolatedEnv(home, base)
    /** Resolve HEAD once, then use its object ID for every subsequent Git read. */
    const revision = spawnSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], { cwd: checkout, env, encoding: "utf8" })
    childStatus = revision
    /** Full object ID, validated before recording or using it in arguments. */
    const sha = revision.stdout?.trim() ?? ""
    if (revision.status !== 0 || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(sha)) {
      console.error("[docker-acceptance] cannot resolve checkout HEAD")
      return exitCode
    }
    candidateSha = sha
    if (base.GITHUB_SHA !== undefined && candidateSha !== base.GITHUB_SHA) {
      console.error(`[docker-acceptance] checkout ${candidateSha} differs from the GitHub event SHA`)
      return exitCode
    }
    image = `mpd-docker-e2e:acceptance-${candidateSha}`
    console.log(`[docker-acceptance] candidate=${candidateSha} source=git-archive credentialFree=true`)
    begin("archive")
    /** Historical evidence is deliberately outside the input snapshot. */
    const rows = spawnSync("git", ["ls-tree", "-z", "--name-only", candidateSha], { cwd: checkout, env, encoding: "utf8" })
    childStatus = rows
    if (rows.status !== 0) return exitCode
    /** Pass only tracked top-level paths, excluding historical evidence. */
    const paths = rows.stdout.split("\0").filter((path) => path !== "" && path !== "evidence")
    /** Temporary tar file for a bounded-memory transfer between Git and tar. */
    const archive = join(scratch, "source.tar")
    childStatus = spawnSync("git", ["archive", "--format=tar", `--output=${archive}`, candidateSha, "--", ...paths], { cwd: checkout, env, stdio: "inherit" })
    if (childStatus.status !== 0) return exitCode
    begin("extract")
    /** The isolated Docker context will contain only that archive and the pack derived from it. */
    const snapshot = join(scratch, "source")
    mkdirSync(snapshot)
    childStatus = spawnSync("tar", ["-xf", archive, "-C", snapshot], { env, stdio: "inherit" })
    if (childStatus.status !== 0) return exitCode
    begin("pack")
    childStatus = spawnSync(process.execPath, ["scripts/pack-mpd.ts"], { cwd: snapshot, env, stdio: "inherit" })
    if (childStatus.status !== 0) return exitCode
    begin("docker")
    /** Strict options are fixed here for both callers. The sole extension opts in to rootful Docker. */
    const args = ["scripts/docker-e2e.ts", "--mode", "source", "--require-docker", "--no-browser", ...argv]
    childStatus = spawnSync(process.execPath, args, {
      cwd: snapshot,
      env: { ...env, MPD_DOCKER_ACCEPTANCE_SHA: candidateSha, MPD_DOCKER_ACCEPTANCE_OUT: out, MPD_DOCKER_IMAGE: image },
      stdio: "inherit",
    })
    exitCode = childStatus.status ?? 2
    return exitCode
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return exitCode
  } finally {
    save(true)
    if (exitCode !== 0) console.error(`[docker-acceptance] ${phase} phase exited ${exitCode}; receipt: ${relative(checkout, record)}`)
    if (scratch) {
      try { rmSync(scratch, { recursive: true, force: true }) } catch (error) {
        if (!(error instanceof Error)) throw error
        console.error("[docker-acceptance] could not clean the staging directory")
      }
    }
  }
}

process.exitCode = run(process.argv.slice(2))
