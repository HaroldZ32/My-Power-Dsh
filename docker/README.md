# Docker client-install E2E (ubuntu 24.04 + compose)

[中文](./README.zh-CN.md)

One command, run from the repository root:

```bash
node scripts/docker-e2e.mjs
```

It builds `docker/Dockerfile` through `docker/docker-compose.yml` (a bare `ubuntu:24.04` with no
node, no bun, no pnpm and no dsh), runs the `mpd-client` compose service, streams the container's
console to the terminal, and writes the evidence to
`evidence/docker/client-install/<UTC stamp>/{result.json, output.log, console.log, driver.json}`.
Nothing is ever copied into the repository: the build context IS the repository root, filtered by
`docker/Dockerfile.dockerignore`.

Exit codes: `0` every assertion true or explicitly `null`, `1` at least one assertion FALSE, `2` the
run produced no `result.json` at all, `3` the host has no usable docker.

## What it actually does inside the container

`docker/entrypoint.sh` runs, in order, and records one assertion per observation:

1. Asserts the build context was filtered (`copy.contextFiltered`). If host `node_modules`, `.git`,
   `evidence`, `.toolchain` or the packed `dist/` had leaked into the image, `bun install` could
   "succeed" on the host's own modules — the run bails instead of going green on borrowed parts.
2. `apt-get update` and `apt-get install -y --no-install-recommends curl git ca-certificates unzip
   xz-utils` — `ubuntu:24.04` has none of them.
3. Node.js 24 from the official tarball, **sha256-verified against the published
   `SHASUMS256.txt`**, plus `bun` from the official install script. Versions are asserted.
4. `pnpm` (`npm i -g pnpm@…`). Not decoration: `dsh plugin <args>` forwards to `pnpm` in the profile
   directory, and the harness prints `pnpm was not found; install pnpm and make it available on PATH`
   when it is missing. A machine without pnpm cannot install a bundle.
5. `npm i -g @deepseek-ai/dsh@0.1.7-rc.2`, then asserts that `dsh --version` prints **exactly** that
   string.
6. Copies the checkout to `/opt/mpd`, runs `bun install`, and rebuilds **every** `packages/*/dist`
   entry from source with the canonical repo-root command from `AGENTS.md` §6 (`bun build
   packages/<pkg>/src/<entry>.ts --target node --format esm --outfile packages/<pkg>/dist/<entry>.js`).
7. Switches to an isolated `HOME=/root/sandbox-home` and `DSH_HOME=/root/sandbox-dsh`, then runs the
   real client install: `cd /opt/mpd && dsh plugin --profile web add .`.
8. Composes the profile with the sanctioned wrapper (`node scripts/dump-config.mjs --profile web`)
   and asserts the mpd row ids, the `preset-mpd` row and the three official agent-team rows plus
   their package names. **This step is COMPOSITION ONLY** — it never executes plugin code.
9. **Boots** the installed profile with registration instrumentation (`docker/probe.mjs`, inserted
   through `--patch`) and asserts from the boot log that the plugin tree really applied: the probe's
   `apply()` ran, the adapter provided `mpdDsh`, an internal tool call through the adapter answered
   `ok`, every core mpd tool answered from the live tool registry, the official TeamService is mounted
   (`ctx.get("agentTeams")` → class `TeamService`, the service the `mpd-agent-team` row provides), the
   Web app served HTTP 200, and no fatal apply/module signature appears. The third row,
   `mpd-ui-agent-team`, is a browser-discovered plugin whose host half is a no-op `apply()` — the
   evidence records the strongest server-side facts it has (composed, no apply failure, package
   materialized in the profile with `dsh.client.platform=web`) as an observation instead of implying a
   load proof that cannot exist.
10. **Creates a session** with `POST /api/session/create` (`agentPreset: "mpd"`, sandbox `cwd`) and
    asserts `result.ok === true` with `agentPreset: "mpd"` (`boot.presetMount`). The gateway refuses
    that request when any row of the preset failed to activate, so this is the preset MOUNT proof —
    unlike step 8, which only composes rows. Auth is a **signed cookie**: the gateway mints it on a
    root request carrying the boot log's `?token=` and admits `/api/*` only with that cookie, so the
    step uses a cookie jar exactly as a browser does (a bare POST answers `401 unauthorized`, measured
    2026-09-27). The token line is **polled for**, not read once: `dsh web: …?token=…` appears only
    after the whole plugin tree is mounted, so an early read yields an empty token, no cookie, and a
    401 — measured as a green run followed by a red one on unchanged instrumentation.
11. **Grades the official team tools where they live.** They are registered in ONE EXACT AGENT SCOPE
    (`@deepseek-ai/dsh-experimental-tool-agent-team` calls `scoped.tools.register(...)` per agent), so a
    root-level registry read answers `0/9` *by design* — measured in this lane's first Docker run, where
    the root read looked like a failure while the tree was healthy. The probe therefore reports the root
    read as an observation and prints one line per agent it sees; the step-10 session supplies the agent,
    and `boot.agentTeamTools` is graded from that agent-scoped line.
12. **Asserts the session gate is LIVE, not merely mounted.** Once the session exists, the boot log
    must carry `[mpd-roles] session gate listener registered for agent "…" agentPreset=mpd`
    (`boot.sessionGateListener`). In v0.10.0 the session-start complexity gate was mounted but never
    fired — a composed row was never evidence for that contract — so this line, emitted on
    `agent/created` for the session this run creates, is its liveness proof.
13. Asserts isolation: the sandbox `HOME`/`DSH_HOME` were in force, no harness or toolchain marker
    (`.dsh`, `.mpd`, `.npm`, `.bun`) exists under the real `/root`, and no credential file carries a
    secret-shaped **value** (the empty `.credentials.yaml` the harness materializes in the sandbox home
    is expected and inventoried with its size). The reporter then re-reads the artifacts it wrote and
    refuses to let a token shape survive into them (`evidenceScrubbed`; a leak reddens the verdict and
    rewrites both files with targeted scrubbing).
14. Records `boot.llmTurn` as **`null` with a reason** — see below.

## What it proves — and what it does NOT

Proves:

- a clean `ubuntu:24.04` can obtain a toolchain and install `@deepseek-ai/dsh` at the pin;
- the bundle installs with ONE command from a **copy of this checkout** (no pack step, no host
  workspace, no prebuilt `dist/` requirement — the dists are rebuilt from source);
- the installed profile COMPOSES the mpd rows and the official agent-team rows (**composition only** —
  `result.json` keeps that claim in its own `provesCompositionOnly` field, never mixed with a load proof);
- the installed profile **MOUNTS**: plugin code executes, the adapter provides its service, the mpd
  tools are registered, the official TeamService is mounted, the official team tools answer inside an
  agent scope, the mpd session gate listener registers for a real session, the `mpd` preset activates
  for a real session, and the Web app serves.

Does NOT prove:

- **any live LLM turn or model routing.** No credential is copied in, read or written (`AGENTS.md`
  §10), so no model request is attempted. That assertion is recorded as `null` with its reason —
  never as a pass.
- that the COMPOSED row list equals the MOUNTED row list. `--dump-config` composes rows and never
  executes plugin code (`AGENTS.md` §4); it is labelled composition-only in the evidence, and every
  mount claim comes from the boot (step 9) or from session creation (step 10).
- a packed/tarball install (`dist/mpd-package`) or a relocation test;
- offline operation: apt, nodejs.org, bun.sh, npm and the package registry are all used.

## How the repository gets into the image

`docker/docker-compose.yml` builds with `context: ..` (the repository root) and
`dockerfile: docker/Dockerfile`; the Dockerfile copies that context to `/src`. There is **no staging
directory and no scratch copy anywhere on disk** — an earlier shape of this lane copied the tree into
`docker/src`, and that in-repo copy was picked up by `bun test`'s globs and by every tree-walking gate
(measured 2026-09-27), so the mechanism was removed rather than relocated.

What the context carries is decided by `docker/Dockerfile.dockerignore`, which BuildKit applies to
builds of `docker/Dockerfile` (verified on Docker 29.8.1). That file lives next to the Dockerfile it
belongs to, so this repository needs no root-level `.dockerignore`. It excludes:

| Excluded | Why |
|---|---|
| `.git`, `.gitignore`, `.gitattributes` | an install must not need history |
| `node_modules`, `**/node_modules` | `bun install` recreates them inside the container |
| the **root** `dist/` | this repository's packed output, not a source input |
| `evidence`, `.qa-*`, `.toolchain`, `.codegraph`, `.t18ev`, `.t28ev`, `.bun-tmp`, `.mpd` | host-local state |

`packages/*/dist` is deliberately **kept**: the container rebuilds it from source, and the rebuild is
an assertion, not a formality. The filter is also asserted from inside the container
(`copy.contextFiltered`), so a leaked context can never produce a fake green.

**Scope of that claim, stated so it is not over-read:** `docker/Dockerfile.dockerignore` is honoured
for a **BuildKit build of this Dockerfile path** — the docker CLI that ships with Docker 29.8.1
(`docker compose build`, `docker build -f docker/Dockerfile`) qualifies, and the driver also asserts
the filter from inside the container. A reviewer who builds the same context with a **different
builder** (or with a Dockerfile copied to another path, which changes the ignore-file name BuildKit
looks for) must NOT read the run as proof that the context was filtered: check `copy.contextFiltered`
in `result.json` — it is evaluated in the container, so it holds for whatever builder produced that
image.

## Environment

The sandbox this lane runs in denies writes outside the repository, while the docker CLI keeps its
buildx state under `$DOCKER_CONFIG` (default `~/.docker/buildx`), so a plain `docker build` fails with
`mkdir <home>/.docker/buildx: read-only file system`. The driver therefore sets `BUILDX_CONFIG` to a
private writable temp directory for every docker child (the caller's own value wins) and removes it at
the end; the rootless docker context in the real `~/.docker` is still used, and **no credential file is
copied anywhere**. By hand, `export BUILDX_CONFIG=$(mktemp -d)` before invoking compose.

## Isolation model

- `docker/docker-compose.yml` declares **one** service and **one** bind mount: the evidence `/out`
  directory. There is no mount of `$HOME`, `~/.dsh`, `~/.mpd`, `~/.agents`, the docker socket or the
  repository, and `node scripts/docker-e2e.mjs --self-test` asserts that statically.
- Inside the container, `HOME` and `DSH_HOME` are redirected to sandbox paths **before** the toolchain
  runs, and `NPM_CONFIG_CACHE` / `BUN_INSTALL` point at `/opt/toolchain`, so not even a
  package-manager cache lands in the real home.
- Evidence is scrubbed of the local Web UI token by two independent redaction passes (the container's
  reporter and the host driver), and the reporter re-reads the artifacts it wrote to prove no token
  shape survived (`evidenceScrubbed`; its firing path has a negative control in `--self-test`).

## Flags and exit codes

```bash
node scripts/docker-e2e.mjs --self-test   # offline: no docker, no network
node scripts/docker-e2e.mjs --no-build    # reuse the existing mpd-docker-e2e:local image
```

The raw compose path, when the driver is not what you want:

```bash
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml run --rm mpd-client
# evidence lands in docker/out/ unless MPD_DOCKER_OUT points elsewhere
```

If that fails with `mkdir <home>/.docker/buildx: read-only file system`, see **Environment** above
(`export BUILDX_CONFIG=$(mktemp -d)`).

Exit codes: `0` all assertions true or `null`, `1` at least one FALSE, `2` no `result.json`, `3` no
usable docker on the host.

## Reading a red run

1. `evidence/…/result.json` → `summary.failedNames` names the failed assertions; each entry carries
   `reason` **and the raw log line** that justified the verdict.
2. `evidence/…/output.log` → the same verdict plus every step's full output, redacted. The assertion
   list at the bottom is the fastest read.
3. `evidence/…/console.log` → the container's raw console as the host saw it.
4. `evidence/…/driver.json` → what the host did: the image size, the exact docker commands and their
   exit status, and the buildx state directory used.

An assertion recorded as `null` is *not* a pass: it means the run stopped before reaching it
(`reason` says so), or the assertion is deliberately out of scope (only `boot.llmTurn` today).
`result.json` also carries `evidenceScrubbed` — re-read from the written artifacts, not from memory.

## Self-test

`node scripts/docker-e2e.mjs --self-test` is offline and needs neither docker nor network. It
exercises the driver's own bookkeeping — the UTC evidence stamp, the verdict → exit-code mapping, the
redaction rule, the BUILDX_CONFIG injection — plus the static rules of the compose file, the
Dockerfile, the ignore file and the entrypoint, and round-trips the evidence writer. A driver whose
own bookkeeping is unchecked produces confident nonsense, so it is checked first.
