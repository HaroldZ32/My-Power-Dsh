// Lane G / F4: run the Docker real-machine lane against 0.2.1-rc.2 and file the result with the
// container's OWN version fact as the decisive line.
//
// WHY THE WRAPPER: `scripts/docker-e2e.ts` proves the lane ran, but the HARNESS the run certifies is
// decided by `MPD_E2E_DSH_VERSION` (host env → compose interpolation → `docker/entrypoint.sh`), and the
// driver's echoed argv does NOT print the pin. So the only honest evidence is inside the container's
// own report: `result.json.harness.installed` plus the `harness.version` assertion's raw
// `dsh --version` output. This wrapper runs the lane, then quotes those two lines verbatim.
//
// USAGE
//   node evidence/harness-0.2.1/f4-docker-source/run-docker.ts [--mode source|oneclick] [--pin 0.2.1-rc.2]
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** The repository root, derived from this wrapper's own URL (four directories up). */
const REPO_ROOT: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** This wrapper's own directory, which names its evidence runs. */
const SLUG_DIR: string = dirname(fileURLToPath(import.meta.url))
/** The argv flags this wrapper understands. */
const argv = process.argv.slice(2)
/** The acceptance lane to drive: `source` (checkout install) by default. */
const mode: string = argv.includes("--mode") ? String(argv[argv.indexOf("--mode") + 1] ?? "source") : "source"
/** The harness version the container must install and assert; the wave's target. */
const pin: string = argv.includes("--pin") ? String(argv[argv.indexOf("--pin") + 1] ?? "0.2.1-rc.2") : "0.2.1-rc.2"

/**
 * Run one command and return its combined output plus exit status.
 * @param command The executable.
 * @param args Its argument vector.
 * @param env The child environment.
 * @param timeoutMs The hard timeout.
 * @returns The status and output.
 */
function run(command: string, args: string[], env: Record<string, string | undefined>, timeoutMs: number): { status: number | null; output: string } {
  const result = spawnSync(command, args, { cwd: REPO_ROOT, env, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] })
  return { status: result.status ?? (result.signal !== null ? 3 : 2), output: (result.stdout ?? "") + (result.stderr ?? "") }
}

/** Run the Docker lane with the pin and file the evidence. */
function main(): void {
  const stamp = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(SLUG_DIR, mode + "-" + stamp)
  mkdirSync(outDir, { recursive: true })
  const env: Record<string, string | undefined> = { ...process.env, MPD_E2E_DSH_VERSION: pin }

  // THE TRIPLE THE F4 CLAIM RESTS ON: the daemon mode, the interpolated pin, and the container's own
  // observed version. The first two are cheap and run before the (long) image build.
  const dockerInfo = run("docker", ["info"], env, 120000)
  const modeLine = dockerInfo.output.split(/\r?\n/).find((line: string) => line.includes("rootless")) ?? ""
  const compose = run("docker", ["compose", "-f", "docker/docker-compose.yml", "config"], env, 180000)
  const pinLines = compose.output.split(/\r?\n/).filter((line: string) => line.includes("MPD_E2E_DSH_VERSION") || line.includes("MPD_E2E_TUI_VERSION"))

  // THE LANE. `--require-docker` makes any skip fatal (exit 3), so a machine without a usable daemon
  // can never produce a green row here.
  const lane = run(process.execPath, [join(REPO_ROOT, "scripts", "docker-e2e.ts"), "--mode", mode, "--require-docker"], env, 4 * 60 * 60 * 1000)
  writeFileSync(join(outDir, "lane.log"), lane.output)

  // THE CONTAINER'S OWN REPORT: the newest evidence directory the lane wrote.
  const dockerEvidence = join(REPO_ROOT, "evidence", "docker", mode === "oneclick" ? "client-install-oneclick" : "client-install")
  const candidates = existsSync(dockerEvidence)
    ? readdirSync(dockerEvidence).map((name: string) => join(dockerEvidence, name)).filter((dir: string) => statSync(dir).isDirectory()).sort((a: string, b: string) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : []
  const newest = candidates[0] ?? ""
  let container: Record<string, unknown> | null = null
  let harnessVersionRow: Record<string, unknown> | null = null
  if (newest !== "" && existsSync(join(newest, "result.json"))) {
    container = JSON.parse(readFileSync(join(newest, "result.json"), "utf8")) as Record<string, unknown>
    const assertions = (container.assertions as Array<Record<string, unknown>> | undefined) ?? []
    harnessVersionRow = assertions.find((row) => row.name === "harness.version") ?? null
  }
  const harness = (container?.harness ?? null) as { installed?: string | null; expected?: string | null } | null
  // THE SUPPLEMENTARY CORDIS PROBE: the lane's own logs do not print `@deepseek-ai/cordis`, and a
  // carrier sitting on the 4.0.4 line under a 0.2.1 harness would mean an inconsistent resolution. So
  // when the lane ran, ONE extra container (the same image, the same npm) resolves it and reports the
  // version. This is supplemental evidence, labelled as such in the result body.
  let containerCordis = ""
  if (lane.status === 0) {
    const probe = run("docker", ["run", "--rm", "--entrypoint", "sh", "mpd-docker-e2e:local", "-c",
      "export PATH=/usr/local/bin:$PATH; npm i -g --silent @deepseek-ai/dsh@" + pin + " >/dev/null 2>&1 && node -p \"require('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/package.json').version\""], env, 900000)
    containerCordis = probe.output.trim().split(/\r?\n/).pop() ?? ""
  }
  // THE CARRIER RISK (captain's point 5): the bundle declares the three agent-team packages by EXACT
  // version, so a container that resolves the 0.2.0 build against a 0.2.1 harness must show up here as
  // a FAIL. The resolved versions are read out of the container's own install logs, not inferred.
  const carrierVersions: Record<string, string[]> = {}
  for (const file of ["console.log", "output.log"]) {
    const path = newest === "" ? "" : join(newest, file)
    if (path === "" || !existsSync(path)) continue
    const text = readFileSync(path, "utf8")
    for (const match of text.matchAll(/(@deepseek-ai\/(?:dsh-experimental-(?:agent-team|tool-agent-team|client-ui-agent-team)|cordis))@([0-9][0-9A-Za-z.+-]*)/g)) {
      const name = match[1] ?? ""
      const value = match[2] ?? ""
      if (name === "" || value === "") continue
      carrierVersions[name] = [...new Set([...(carrierVersions[name] ?? []), value])]
    }
  }
  // A 0.2.0 build of an agent-team carrier against a 0.2.1 harness is the exact mismatch to catch.
  const carrierMismatch = harness?.installed === "0.2.1-rc.2"
    && Object.values(carrierVersions).some((values) => values.some((value) => value.startsWith("0.2.0")))

  const result = {
    // THE CLAIM: the lane ran to a real verdict, and the container installed and asserted the pin.
    ok: lane.status === 0 && harness?.installed === pin && harness?.expected === pin && harnessVersionRow?.ok === true && carrierMismatch === false,
    claim: "F4 — docker --mode " + mode + " --require-docker against " + pin,
    pin,
    dockerMode: modeLine,
    composePins: pinLines,
    laneExit: lane.status,
    containerEvidence: newest,
    containerHarness: harness,
    harnessVersionAssertion: harnessVersionRow,
    carrierVersions,
    containerCordis: { value: containerCordis, source: "supplementary probe: one docker run on the same image resolving @deepseek-ai/cordis from the pinned harness install" },
    carrierMismatch,
    containerOk: container?.ok ?? null,
    containerComplete: container?.complete ?? null,
    assertionsTotal: Array.isArray(container?.assertions) ? (container?.assertions as unknown[]).length : null,
    // The report nests the names under `summary`; passing counts are quoted too, because "ok" without
    // a passed count could hide a vacuous run.
    failedAssertions: (container?.summary as { failedNames?: unknown } | undefined)?.failedNames ?? null,
    unevaluated: (container?.summary as { nullNames?: unknown } | undefined)?.nullNames ?? null,
    passedAssertions: (container?.summary as { passed?: unknown } | undefined)?.passed ?? null,
  }
  writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), ["=== docker mode ===", modeLine, "", "=== compose pins ===", pinLines.join("\n"), "", "=== lane exit " + lane.status + " ===", lane.output].join("\n"))
  console.log(JSON.stringify({ ok: result.ok, laneExit: result.laneExit, dockerMode: result.dockerMode, composePins: result.composePins, containerHarness: result.containerHarness, harnessVersionAssertion: result.harnessVersionAssertion, containerOk: result.containerOk, failed: result.failedAssertions }, null, 2))
}

main()
