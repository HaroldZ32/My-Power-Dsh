# Lane G — wave verification verdict: harness-0.2.1-rc.2 adaptation + guard rollback

Wave: `.mpd/plans/harness-021-rollback.md` (frozen contract) · branch `feature/harness-021-rollback`
Tree verified: `06b058148bcb5cac5149f03567fb3ebdce121282` ("feat(harness)!: adapt to DeepSeek Harness 0.2.1-rc.2 and withdraw the 2026-10-10 guard ceremony"), `git status --porcelain` EMPTY at the start and end of the pass.
Harness under test: `.mpd/reference/harness-021/node_modules/@deepseek-ai` (**0.2.1-rc.2**, 306 packages). The machine's global dsh (**0.2.0-rc.2**) was never installed over, upgraded or written to.
Reviewer lane: evidence only (`evidence/**`); no source, patch or test was edited by this lane.

> **CORRECTION (added after the first pass, before the second): claims 5 and 1d were measured with a
> probe that could not find a child.** It inferred "parent" from a tool-list property that is true of
> BOTH sessions, so `childCount` was 0 on every run and the session it labelled `parent` was the child
> (`subagent/descriptor` is the only valid discriminator). Claim 5's PASS was for the wrong reason: the
> persona it found was PROMPT TEXT (`prompt = persona + "Task: …"`), not the persona seam's system
> section. **Claim 5 is therefore restated as FAIL on that instrument**, and claim 1d stands (it was
> correct: the read-only child's first header carried the write-capable tools). The corrected instrument
> (`f2-persona-spawn/spawn-probe.ts`) finds the child by `subagent/descriptor`, reads header tools as
> `entry.name`, and asserts the persona in the CHILD's `system/message`; it reports `personaInSystem`
> and `personaInPrompt` separately so the two channels can never be conflated again. A second pass on
> the pinged tree supersedes every claim below.

## Verdict table

| # | Claim (frozen contract) | Evidence | Verdict | The observed line that decides it |
|---|---|---|---|---|
| 1a | Every bundle row mounts on 0.2.1, web surface | `evidence/dsh-qa/preset-conformance/2026-10-17T14-19-38.817Z/` (+ `evidence/harness-0.2.1/preset-conformance-live/post-rebuild.log`) | **PASS** | `bootLog: {"ok":true,"signatures":[]}` and `sessionCreate: {"ok":true,…, "agentPreset":"mpd"}`, negative control `agent-preset/invalid` reddened |
| 1b | The `mpd` preset mounts on 0.2.1 | same run | **PASS** | `sessionHeader: {"ok":true,"agentPreset":"mpd"}`; `parity 27/27` |
| 1c | The reworked subagent seam spawns a roster child | `evidence/harness-0.2.1/f2-persona-spawn/run-2026-10-17T14-19-44.073Z/` | **PASS** | `role Junior Engineer (complete)` … `Created file` in the parent's `tool/result` |
| 1d | A READ-ONLY roster child is restricted (R3, §13's eight-name deny list) | `evidence/harness-0.2.1/f2-persona-spawn/run-2026-10-17T14-22-29.912Z/output.log` (child `caadf952-…`) | **FAIL** | child `request/header`: `tools 101`, `writeCapable ["write","edit","bash","mpd_hashline_edit"]` |
| 1e | Native `TeamExecutor` live on 0.2.1 | — | INCONCLUSIVE | not exercised (docker live arms were not run: no `DEEPSEEK_API_KEY` forwarded) |
| 2a | Boot line: the three withdrawn guards `absent`, `sessionGate=off` | `evidence/harness-0.2.1/f2-sandbox-boot/closure-2026-10-17T14-18-55.291Z/row-logs/mpd-roles.log` | **PASS** | `[mpd-roles] team plane: readOnlyGuard=installed deny=8 verifyGate=absent reason=withdrawn:2026-10-17-user-ruling(verify.mode) captainInvestigation=absent reason=…(captain.investigation) delegationGate=absent reason=…(delegation.gate) askUserQuestion=installed rosterSection=agent-scoped order=605 sessionGate=off` |
| 2b | Tools still register from shipped dist | same run (`result.json`) | **PASS** | `toolCount 105`, `registeredMpdTools 47`, `missingTools []` |
| 2c | `mpd-verify` reports the seam, never a gate | same run, `row-logs/mpd-verify.log` | **PASS** | `verifySeam=present (the harness tools.guard SEAM — NOT an installed gate: the write guard is WITHDRAWN; …)`; `grep -c verifyGate` = **0** |
| 2d | Live: top-level agent reads a source path and writes a code path with no loop armed | `evidence/harness-0.2.1/f2-live-guards/{closure-…,run-…}` + `evidence/gates/verify-law/2026-10-17T14-25-30.417Z` | **PASS (corroborative)** | read: source lines returned; write: `Created file` + artifact exists; verify-law: `written: true … retiredKnobWritten: true … withdrawnReported: true` |
| 3a | `bun run verify:rows` | `evidence/harness-0.2.1/verify-rows/2026-10-17T14-24-58.195Z/` | **PASS** | `35 row ids match the 2-file bundle patch layer` |
| 3b | `preset-conformance --self-test` against 0.2.1 | `evidence/harness-0.2.1/preset-conformance-selftest/post-rebuild.log` | **PASS (0.2.1 regime)** | `32 harness rows conform … persona prefix=true, mpd preset 29 child rows, row parity 27/27 (negative controls: 4/4 reddened)`, EXIT 0 |
| 3c | `bun test` | `evidence/harness-0.2.1/f3-gates/bun-test-packages.log`; matrix row `bun-test` | **PASS as `bun test packages`; the plan's bare spelling is red** | packages: `1995 pass, 3 skip, 0 fail` (124 files); bare `bun test`: `2397 pass, 3 skip, 18 fail, 13 errors` (203 files — it sweeps `evidence/**` fixtures) |
| 3d | `bun run typecheck` | `f3-gates/2026-10-17T14-24-58.195Z/typecheck/` | **PASS** | exit 0 |
| 3e | `bun run test:qa` | `evidence/harness-0.2.1/f3-gates/test-qa-021.log` (0.2.1); `test-qa/…` (0.2.0) | **PASS (0.2.1 regime)** | `[test:qa] all self-tests passed`, EXIT 0; on the installed 0.2.0: `FAILED: preset-conformance.ts` (parity delta) |
| 3f | `bun run verify:dist` | `f3-gates/…/verify-dist/` | **PASS** | exit 0 after the pinned rebuild |
| 3g | `node scripts/verify-pack-closure.ts` | `f3-gates/…/verify-pack-closure/` | **PASS** | `ok: 23 dist/index.js row(s) + 0 adopted lib/index.ts row(s) + 4 mcp row(s) …` |
| 3h | `bun run verify:comments` | `f3-gates/…/verify-comments/` | **PASS** | exit 0 |
| 3i | `bun run verify:manifest` | `f3-gates/…/verify-manifest/` | **PASS** | `npm pack --dry-run lists 987 file(s); 0 required path(s) absent` |
| 3j | `bun run verify:docs` | `f3-gates/…/verify-docs/` | **PASS** | exit 0 |
| 3k | `node scripts/verify-manual-paths.ts` | `f3-gates/…/verify-manual-paths/` | **PASS** | exit 0 |
| 3l | `node scripts/verify-no-host-override.ts` | `f3-gates/…/verify-no-host-override/` | **PASS** | exit 0 |
| 4 | Docker `--mode source --require-docker` against 0.2.1 | `evidence/harness-0.2.1/f4-docker-source/source-2026-10-17T14-18-52Z/` → `evidence/docker/client-install/2026-10-17T14-18-52Z/result.json` | **FAIL** | pin PASS: `harness.installed 0.2.1-rc.2`, `expected 0.2.1-rc.2`, `harness.version raw "0.2.1-rc.2"`; lane exit **3**; failed rows `pack.staticCoherence`, `pack.distFreshRebuild`, `qa.readonlyDeny`, `tui.laneExit`, `ui.mpdSettingsSection` |
| 5 | Persona reaches the child **through the seam (system section)** | `f2-persona-spawn/run-…14-19-44`, `run-…`, `sandbox/spawn-h5et8z/ws/persona-probe.txt` — re-read with the CORRECTED instrument | **FAIL (first pass said PASS for the wrong reason)** | the true child (found by `subagent/descriptor`) carried the persona only as PROMPT TEXT; its `system/message` did not contain it. Restated by the correction block above. |
| 6 | An unlabelled child still spawns | — | INCONCLUSIVE | not exercised by this lane (the seam's no-op arm is unit-tested only) |

## Ranked findings

1. **Blocker/High — the read-only roster discipline does not reach the child's composed toolset on 0.2.1.**
   Where: `mpd_role_spawn` of the READ-ONLY `Explorer`. Observed in `evidence/harness-0.2.1/f2-persona-spawn/run-2026-10-17T14-22-29.912Z/output.log`: the child session `caadf952-…` carries **101 tools** and its `request/header` offers `["write","edit","bash","mpd_hashline_edit"]` — the eight-name `READONLY_DENY` is not reflected. The child's persona DID arrive (its first user message is the Explorer persona), so the persona seam works while the tool restriction does not; the child's prose even claimed "bash stays denied … no write tool" while its own header contradicts it.
   Corroboration: the Docker lane's `qa.readonlyDeny` arm failed in the same run (`childRequests=0`, `spawnDriven=false` — vacuous rather than contrary, but a second red on the same capability). `R3` keeps this discipline: a read-only member that can call `write` is a product regression, not a bound.
   Direction (described, not applied): re-apply the deny list on the child's own scoped tool registry (the same place the persona prefix is installed) and assert it in the child's FIRST `request/header`, not only over doubles.

2. **High — the Docker real-machine lane is red because the packed artifact was not re-packed.**
   `pack.staticCoherence`: `48 differing file(s)`; `pack.distFreshRebuild`: `24 differing … Both the artifact and this rebuild are under bun 1.4.0`. Both statements are about `dist/mpd-package`, which the wave did not refresh. Direction: run `node scripts/pack-mpd.ts` (the release step) and re-run F4.

   **Container carrier check (the version pin's second half):** `harness.installed/expected` = `0.2.1-rc.2` / `0.2.1-rc.2`, `harness.version` raw `0.2.1-rc.2`; resolved carriers in the container's logs: `@deepseek-ai/dsh-experimental-agent-team@0.2.1-rc.2`, `…-tool-agent-team@0.2.1-rc.2`, `…-client-ui-agent-team@0.2.1-rc.2` → `carrierMismatch: false`. `@deepseek-ai/cordis`: the harness closure resolves **4.0.5**; the container's only `cordis` texts are four `warn: incorrect peer dependency "@deepseek-ai/cordis@4.0.2"` lines (bun peer warnings about stale specs elsewhere in the graph, alongside `dsh-llm@0.1.7-rc.2`, `dsh-agent@0.1.5-rc.2`), so the container's RESOLVED cordis is INCONCLUSIVE from this run — the supplementary `docker run` probe I added returned empty. Same spec + same registry as the closure (4.0.5) is an INFERENCE, not an observation.

3. **High — `ui.mpdSettingsSection`: "no Settings control was found"** in the 0.2.1 web UI (live red assertion). Not covered by the wave's claims and not investigated further by this lane; it needs an owner.

4. **Medium — the TUI lane aborts on 0.2.1** (`tui.laneExit`, `exit 1`, `line=182`: the `dsh plugin --profile dsh-tui add` step). This is the plan's declared bound (R5: no real-machine TUI adaptation this wave), but it IS a red lane in the sweep and must be stated as such.

5. **Medium — `preset-conformance` cannot validate a HOISTED harness layout.** Against the closure's `.bin` it fails `self-test: the installed @deepseek-ai/dsh-persona exposes no config schema (unresolved)`, because `harnessRoot` + `loadSchema` read `<harnessRoot>/node_modules/<pkg>/lib/index.js` — npm's GLOBAL shape — while a hoisted install keeps the packages as siblings. Direction: resolve through `createRequire` from the harness package (Node's own algorithm) so both layouts work.

6. **Medium — the plan's literal `bun test` is red for a reason unrelated to the wave.** Bare `bun test` sweeps `evidence/**` fixture `.test.ts` files (`18 fail`, mostly `Cannot find module`); the repository's own `test` script is `bun test packages` (**1995 pass, 0 fail**). Either the plan's line should name the script, or evidence fixtures should be excluded from the default glob.

7. **Low / bound — `preset-mpd` is pending on the `mpd-headless` profile** (`waiting for service: agentPresets`); reproduced identically on 0.2.0-rc.2, so it is a composition fact of that profile, not a wave defect. The web profile mounts the preset cleanly (row 1a/1b).

8. **Low — the sweep's default regime is the installed 0.2.0 harness**, where `preset-conformance --self-test` legitimately reddens on parity (`time-context, tool-schedule, tool-plugin-market`) and therefore `test:qa` reddens with it. Both are green in the 0.2.1 regime. This is a REGIME property the PR must state, not a defect.

## Declined to judge

- The 0.2.0 arm of the adapter's subagent seam — proven against doubles only; not my lane's subject.
- `persona` ordering before the child's first assembly — the persona is delivered as the child's leading prompt text, observed in its first user message; the internal ordering claim needs no verdict.
- The Docker `live.*` arms and the one-click lane (F5) — not in this lane's claim set / no credential forwarded.
- TUI real-machine adaptation quality — declared out of the wave by R5.
- `VENDOR_LOCK.json` re-pin correctness — `verify:vendor` green, outside my claim list.
- The 11 removed harness packages' future importability — a recorded risk, not a present behaviour.

## Bounds of this review

- The three isolation layers were used for every boot (throwaway `DSH_HOME`, sandbox `HOME`, sandbox workspace) and `assertSessionsSandboxed` asserted the session store never left the sandbox; the machine's `~/.dsh` was never written.
- The 0.2.1 QA-script arms run against a **global-style layout built from the closure** (`evidence/harness-0.2.1/lib/make-global-layout.ts`: one copied `dsh` package + symlinks for the remaining 305 packages and 245 non-harness deps; no network, closure bytes untouched). This exists because of finding 5; it is NOT a second harness — same 0.2.1-rc.2 packages.
- A harness session log records ONE `request/header` and ONE `system/message` per session, so a restriction applied after a child's first assembly is not observable from the store; finding 1 is stated about the FIRST assembly, which is the one that steers the child's first action.
- F4's container `@deepseek-ai/dsh-experimental-*` and `@deepseek-ai/cordis` versions: see the F4 result body; a 0.2.0 carrier under a 0.2.1 harness would have been recorded as `carrierMismatch: true`.
- Nothing in this report was measured before the rebuild: every cited artifact is from the pass that started after `06b05814` was committed.

**Overall: REQUEST CHANGES.** The adaptation's centre of gravity is proven — every row mounts on the web surface with no inactive entry, the `mpd` preset mounts with a reddening negative control, the boot line reports all three withdrawn guards `absent` with `sessionGate=off` from shipped dist, 105 tools register, and the gate matrix is green in the 0.2.1 regime. It is not approvable as-is because a KEPT guard (the roster's read-only discipline) does not reach the child's composed toolset, and the real-machine lane is red on a stale packed artifact plus a live web-UI assertion.
