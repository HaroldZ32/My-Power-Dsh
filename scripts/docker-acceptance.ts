// The shared credential-free source acceptance lane for release operators and GitHub Actions.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
  return 0
}

/**
 * Archive one checked-out commit, build its pack, then run the strict source lane.
 * @param argv - User options. Rootful Docker needs explicit approval from the caller.
 * @returns The source lane's exit code, or a staging/identity failure.
 */
function run(argv: readonly string[]): number {
  if (argv.length === 1 && argv[0] === "--self-test") return selfTest()
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--allow-rootful-docker")) {
    console.error("usage: node scripts/docker-acceptance.ts [--allow-rootful-docker | --self-test]")
    return 2
  }
  for (const key of registries) {
    if (!publicRegistry(process.env[key] ?? "")) {
      console.error(`[docker-acceptance] ${key} must be a public HTTP(S) registry URL without credentials, query or fragment`)
      return 2
    }
  }
  /** The archive, private home and temporary tar are all owned by this invocation. */
  const scratch = mkdtempSync(join(tmpdir(), "mpd-docker-acceptance-"))
  try {
    /** Private root for process state, separate from the Docker build context. */
    const home = join(scratch, "home")
    mkdirSync(home)
    /** This environment is explicit for every child, including the metadata probes. */
    const env = isolatedEnv(home, process.env)
    /** Resolve HEAD once, then use its object ID for every subsequent Git read. */
    const revision = spawnSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], { cwd: repo, env, encoding: "utf8" })
    /** Full candidate object ID, reported before staging and in the driver evidence. */
    const candidateSha = revision.stdout?.trim() ?? ""
    if (revision.status !== 0 || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(candidateSha)) {
      console.error("[docker-acceptance] cannot resolve checkout HEAD")
      return 2
    }
    if (process.env.GITHUB_SHA !== undefined && candidateSha !== process.env.GITHUB_SHA) {
      console.error(`[docker-acceptance] checkout ${candidateSha} differs from the GitHub event SHA`)
      return 2
    }
    console.log(`[docker-acceptance] candidate=${candidateSha} source=git-archive credentialFree=true`)
    /** Existing evidence and other Docker-excluded top-level paths need no archive or tar space. */
    const rows = spawnSync("git", ["ls-tree", "-z", "--name-only", candidateSha], { cwd: repo, env, encoding: "utf8" })
    if (rows.status !== 0) return 2
    /** Historical evidence is deliberately outside the input snapshot. */
    const paths = rows.stdout.split("\0").filter((path) => path !== "" && path !== "evidence")
    /** The build context gets only tracked candidate bytes and the pack derived from them. */
    const snapshot = join(scratch, "source")
    mkdirSync(snapshot)
    /** Temporary tar file for a bounded-memory transfer between Git and tar. */
    const archive = join(scratch, "source.tar")
    if (spawnSync("git", ["archive", "--format=tar", `--output=${archive}`, candidateSha, "--", ...paths], { cwd: repo, env, stdio: "inherit" }).status !== 0) return 2
    if (spawnSync("tar", ["-xf", archive, "-C", snapshot], { env, stdio: "inherit" }).status !== 0) return 2
    if (spawnSync(process.execPath, ["scripts/pack-mpd.ts"], { cwd: snapshot, env, stdio: "inherit" }).status !== 0) return 2
    /** Reserve the first free stamp atomically so concurrent runs cannot overwrite evidence. */
    let stampTime = Date.now()
    for (;;) {
      /** This run's stamp lives in the caller's checkout, outside the temporary candidate. */
      const out = evidenceDir(repo, new Date(stampTime))
      mkdirSync(dirname(out), { recursive: true })
      try {
        mkdirSync(out)
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error
        stampTime += 1000
        continue
      }
      /** Candidate and launch record survives even when Docker could not reach the reporter. */
      const record = join(out, "acceptance.json")
      /** This stamp belongs to one immutable product and the shared credential-free mode. */
      const identity = { candidateSha, mode: "source", credentialForwarded: false, browserEnabled: false }
      writeFileSync(record, JSON.stringify(identity, null, 2) + "\n")
      if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `stamp=${relative(repo, out)}\n`, { flag: "a" })
      /** Strict options are fixed here for both callers. The sole extension opts in to rootful Docker. */
      const args = ["scripts/docker-e2e.ts", "--mode", "source", "--require-docker", "--no-browser", ...argv]
      /** Preserve the driver exit and signal in the stamp even on a missing daemon. */
      const child = spawnSync(process.execPath, args, {
        cwd: snapshot,
        env: {
          ...env, MPD_DOCKER_ACCEPTANCE_SHA: candidateSha, MPD_DOCKER_ACCEPTANCE_OUT: out,
          MPD_DOCKER_IMAGE: `mpd-docker-e2e:acceptance-${candidateSha}`,
        },
        stdio: "inherit",
      })
      /** A missing process status is an execution failure. */
      const exitCode = child.status ?? 2
      writeFileSync(record, JSON.stringify({ ...identity, exitCode, signal: child.signal }, null, 2) + "\n")
      return exitCode
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

process.exitCode = run(process.argv.slice(2))
