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
| `node scripts/docker-e2e.ts --mode all` | both, in sequence | one command answers the whole "does this run everywhere" question; each mode is its own child process with its own evidence dir, and the parent reports the WORST child exit code |

### The surfaces a run covers

One non-skipped run drives **every plane this bundle ships**, and each plane's verdict is read from the
harness's own session store (`docker/lib/live-verdict.ts`) — never from the model's prose:

| Plane | How it is driven | The assertions it owns |
|---|---|---|
| **Web, agent** | a real `POST /api/session/prompt` against the RUNNING Web app | `live.web.*` — a turn started, reached `turn/end reason=completed`, every tool-call payload parsed, an `mpd_*` tool ran, the assistant produced text |
| **Web, GUI** | Chromium opens the app, types into the composer, presses send, waits for the answer to render, then opens Settings→MPD and the Agent Teams sidebar | `ui.*` — the page loads, the composer accepts input, the prompt is sent, the reply renders, the MPD settings card renders, the team panel renders, **zero console/page errors** |
| **TUI** | the real `dsh-tui` on a real PTY under tmux; the prompt is TYPED into the pane | `live.tui.*` plus the pre-existing `tui.*` scene/panel/boot group |
| **Headless** | `dsh --profile headless <prompt>` in a scratch workspace | `live.headless.*`, `boot.llmTurn`, `live.teamRecord`, `live.nativeExecutor`, `live.headlessPresetRow` |

`live.<plane>.noMalformedToolJson` is the arm that catches a **model-output** defect: when the model
streams a tool-call payload that is not valid JSON, the harness raises `MALFORMED_RESPONSE`, and because
that code is absent from `DEFAULT_RETRYABLE_CODES` the whole turn is aborted. The failing call leaves NO
`tool/call` record — the abort happens before the assistant message is committed — so the reader also
scans the `assistant/attempt` stream records. An audit that reads only `tool/call` reports zero findings
on a session that actually died.

### Flags that decide what a run MUST prove

| Flag | Meaning |
|---|---|
| `--live` | stage the provider credential in the SANDBOX home **before the boot** and run the live arms on all three planes. The key is forwarded by NAME (`docker compose run -e DEEPSEEK_API_KEY`) and deleted before the report is written. Asking for `--live` without a key in the environment is a **hard error (exit 3)**, never a silent null |
| `--no-browser` | skip the Chromium lane (it downloads a browser). Its `ui.*` rows then record NULL with the reason |
| `--require-docker` | a skipped lane exits 3 instead of 0 |

**The required-arm gate.** A NULL row means "not attempted", which is the honest shape for an OPTIONAL
arm. It is the wrong shape for an arm the caller asked for: after the run, every `null` whose name starts
with a required prefix (`live.`/`boot.llmTurn` under `--live`, `ui.` when the browser lane is on) is
reported as `UNMEASURED` and turns the exit code into **3**. This is what stops the lane from greening by
not running the thing it was asked to verify.

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
list. Read every NULL with its printed reason; never read `complete=false` as a failure — but never read
a NULL in a REQUIRED arm as a pass either (see the required-arm gate above).

### What a live arm needs from the credential

The credential is staged ONCE, before the Web app boots, in `$DSH_HOME/.credentials.yaml` as
`version: 1` + a nested `refs:` mapping. Two measured traps: the harness's reader REFUSES the
pre-release flat layout by name, and staging the key AFTER the boot leaves the running Web server (and
therefore the Web and TUI planes) credential-less, so their turns fail with `MISSING_CREDENTIAL` while
the headless plane — a fresh process — works. Three further rows make the staging auditable:
`live.credentialStaged`, `live.credentialScoped` (sandbox path, mode 0600, reader-shaped) and
`live.credentialRemoved` (deleted before the report).

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

Two more were measured later, and both are the reason the lane now drives real turns instead of
stopping at the mount:

- **a model-output defect that no composition assertion can see.** A turn died with
  `DeepSeek Messages stream: tool input is invalid JSON` (`MALFORMED_RESPONSE`) while a credential-free
  run reported 52 of 53 assertions passing and `boot.llmTurn: null`. The failure exists only inside an
  SSE stream and the abort discards it, so the fix was to drive a real turn on every plane and grade
  the session store — and to make "the live arm was not attempted" a FAILURE when the caller asked for
  it, rather than the NULL that had been quietly acceptable.
- **a live verdict that graded another lane's artifact.** The headless arm's team-record lookup took
  whatever `find … -print -quit` returned first; after the TUI lane landed that was a FIXTURE named
  `tui-scene.json`, so two assertions recorded a PASS for a turn they had never measured while a third
  failed against the fixture's own empty handles. The lookup is now the newest record by mtime with a
  hard requirement that it postdate the step, and every other verdict is scoped by session + `--since`.
  A verdict must be about THIS run's artifact or say so.

`verify-plugin-manifest --pack` covers the packaging half of that list statically; only the container
covers the mount half — and only a driven turn covers the behavioural half.
