# Verification flow (the ordered gate list, and what each step is worth)

**Agent-facing, English-only, on-demand.** This file is the DETAIL behind the AGENTS.md §4 gate table
and §11 release sweep. It is not auto-injected; open it when you are about to run a verification pass,
or when you need to know whether a step may be skipped.

## The order is part of the contract

A verification pass runs cheapest-and-most-falsifiable first, so a broken tree is caught before an
expensive step can hide it behind unrelated noise:

1. **Static gates** — vendor, dist freshness, row parity, doc pairs, preset conformance. These are
   `bun run verify:gates` (7 members, all static, seconds each).
2. **The two standing user-mandated gates** — `bun run verify:manifest` (no `cordis` in any dependency
   field by NAME, no `preinstall` / `install` / `postinstall` / `prepare` script name, and the packaging
   contract a one-command install rests on) and `bun run verify:comments` (every declaration carries a
   precise comment and every named function writes down its parameter and return types).
3. **Correctness suites** — `bun run typecheck` (root `tsgo --noEmit`), `bun test`, `bun run test:qa`.
4. **Packaging** — `node scripts/pack-mpd.ts`, then `node scripts/verify-pack-closure.ts`.
5. **Docker real-machine lane — THE LAST STEP.** `bun run verify:docker` (see below).

## The Docker lane is the last step, and it may SKIP

`node scripts/docker-e2e.ts` (`bun run verify:docker`) builds a real `ubuntu:24.04` container and asks
the question no static gate can: **does a fresh machine install this bundle with one command and then
really MOUNT it?** It asserts rows activating, tools registering, the real TUI booting on a real PTY,
and the harness's own session store recording `agentPreset=mpd` — never just "the install exited 0".

Two lanes, one flag apart:

| Command | Lane | What it proves |
|---|---|---|
| `node scripts/docker-e2e.ts --mode source` | checkout install | `dsh plugin --profile web add .` works from a clone |
| `node scripts/docker-e2e.ts --mode oneclick` | published package | the packed artifact installs through pnpm's git resolver — the path `dsh plugin --profile web add github:HaroldZ32/My-Power-Dsh` takes for a user |

### Rootless, skip, and when the step is fatal

The policy is measured, printed and falsifiable (the driver's `--self-test` carries one arm per branch):

| Measured state | Default behaviour |
|---|---|
| **rootless** Docker (`SecurityOptions` contains `name=rootless`) | **run** the lane, and print `docker mode: ROOTLESS (…)` so the evidence says which environment it proved |
| **rootful** Docker | **SKIP** with a notice naming `--allow-rootful-docker`, which opts a rootful daemon in explicitly (CI images are usually rootful) |
| **no Docker / unusable daemon** (missing binary, unreachable socket, permission denied) | **SKIP** with the cause quoted, and the install hint for rootless Docker |
| any of the above **with `--require-docker`** | **FAIL** (exit 3) — use it in a release sweep, where losing the lane silently is the risk |

A SKIP **exits 0 on purpose**: the Docker lane is the last step of the flow, not a precondition for the
steps before it. Everything above it still had to pass. The notice names the state it found, the
override, and the command to re-run, so "not verified here" is never mistaken for "verified".

A non-skipped run is graded by the container's own report: `ok`, `passed`, `failed`, and the `null`
list, where a NULL means an assertion that was deliberately **not attempted** (a live LLM turn needs
provider credentials the container does not stage) or is **not applicable** in that mode (in one-click
mode the package ships its own built `dist/`, so there is no in-container build to assert). Read the
NULLs with their printed reasons; never read `complete=false` as a failure.

## Evidence layout

- `evidence/docker/client-install/<UTC-stamp>/{result.json,console.log,driver.json}` — the checkout lane.
- `evidence/docker/client-install-oneclick/<UTC-stamp>/…` — the published-package lane.
- `evidence/<domain>/<slug>/<UTC-stamp>/{result.json,SUMMARY.md}` — the wave record that cites them.

A stamp is the moment the RUN started, so re-run the lane after the last write if you intend to cite
it as evidence for a frozen revision (§7's settled-hash rule).

## Why the lane exists at all

Three failure classes are invisible to every other gate, and each was measured in this repository:

- an install that succeeds but whose rows never activate (the loader rejects a duplicate id, a preset
  refuses to mount on a missing required key),
- a package that installs from a checkout but whose packed form drops a runtime path (the `files`
  allowlist is the only thing that decides what a user downloads),
- a dependency set that pnpm refuses on a clean machine (`ERR_PNPM_IGNORED_BUILDS`) even though the
  same tree installs fine on a developer box that already has the build outputs.

`verify-plugin-manifest --pack` covers the packaging half of that list statically; only the container
covers the mount half.
