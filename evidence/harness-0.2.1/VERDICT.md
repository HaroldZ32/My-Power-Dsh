# Lane G — wave verification verdict (second pass): harness-0.2.1-rc.2 adaptation + guard rollback

Wave: `.mpd/plans/harness-021-rollback.md` (frozen contract) · branch `feature/harness-021-rollback`
**Tree verified: `684f9116ff32d5bf56642912ad86755f1a8c4845`** — `git status --porcelain` EMPTY at the
start and end of the pass (the only untracked entries are this lane's own `evidence/**` artifacts).
Harness under test: `.mpd/reference/harness-021/node_modules/@deepseek-ai` (**0.2.1-rc.2**).
The machine's global dsh (**0.2.0-rc.2**) was never installed over, upgraded or written to.
Reviewer lane: evidence only (`evidence/**`); no source, patch or test was edited by this lane.
First-pass report (superseded, kept for the record): `VERDICT-first-pass.md`.

## Verdict table

| # | Claim (frozen contract) | Evidence | Verdict | The observed line that decides it |
|---|---|---|---|---|
| 1a | Every bundle row mounts on 0.2.1, WEB surface | `evidence/dsh-qa/preset-conformance/2026-10-17T14-46-43.577Z/` + `evidence/harness-0.2.1/preset-conformance-live/pass2.log` | **PASS** | `bootLog: {"ok":true,"signatures":[]}` — no active, no pending, no disabled entry |
| 1b | The `mpd` preset mounts | same run | **PASS** | `sessionCreate {"ok":true…, "agentPreset":"mpd"}`; `parity 27/27`; negative control `agent-preset/invalid` reddened |
| 1c | The subagent seam spawns a roster child | `f2-persona-spawn/roster-explorer-*`, `roster-junior-engineer-*` | **PASS** | child sessions `95`/`100` tools, descriptor `{"label":"Explorer"}` / `{"label":"Junior Engineer"}`, both answered |
| 1d | A READ-ONLY roster child is denied the writers | `f2-persona-spawn/roster-explorer-2026-10-17T14-46-43.451Z/` (`tools 95`, `writeCapable: []`, `denyApplied: true`) | **PASS** | header has **none** of `write`/`edit`/`bash`/`mpd_hashline_edit`; row log: `[mpd-roles] read-only child: applied 8 denials to its own tool scope` |
| 1e | A READ-ONLY workmate child is denied the writers | `f2-persona-spawn/workmate-explorer-2026-10-17T14-47-06.553Z/` | **PASS** | `writeCapable: []`, `tools 92`, and `[mpd-workmate] read-only workmate child: applied 8 denials to its own tool scope` |
| 1f | The deny is DISCRIMINATING (writable control keeps the writers) | `f2-persona-spawn/roster-junior-engineer-2026-10-17T14-44-02.824Z` | **PASS** | `writeCapable: ["bash","edit","mpd_hashline_edit","write"]`, `tools 100`, no deny line |
| 1g | A child with no roster label still spawns (seam no-ops) | `f2-persona-spawn/unlabelled-*` | **PASS** | generic `subagent` child spawned (label = the free-form description), `personaInSystem false`, `personaInPrompt false`, `writeCapable` = the normal four, reply `READY` — the seam neither throws nor restricts |
| 2a | Persona reaches the child **through the seam (system section)** | `f2-persona-spawn/*` (`personaInSystem: true`, `personaInPrompt` reported separately) | **PASS** | the CHILD's own `system/message` (found via `subagent/descriptor`) carries the roster marker for Explorer, Junior Engineer AND the workmate child; prompt text is reported as a separate field, never as the claim |
| 2b | Boot line: three withdrawn guards `absent`, `sessionGate=off` | `f2-sandbox-boot/closure-*` (second-pass run) | **PASS** | `readOnlyGuard=installed deny=8 verifyGate=absent reason=withdrawn:2026-10-17-user-ruling(verify.mode) captainInvestigation=absent reason=…(captain.investigation) delegationGate=absent reason=…(delegation.gate) askUserQuestion=installed rosterSection=agent-scoped order=605 sessionGate=off` |
| 2c | Tools register from shipped dist | same run | **PASS** | `toolCount 107`, `registeredMpdTools 47`, `missingTools []` |
| 2d | `mpd-verify` reports the seam, never a gate | same run, `row-logs/mpd-verify.log` | **PASS** | `verifySeam=present (the harness tools.guard SEAM — NOT an installed gate …)`; `verifyGate` occurrences = **0** |
| 2e | Live: source read + code write with no loop armed | `f2-live-guards/closure-*` + `evidence/gates/verify-law/…` (pass 2) | **PASS** | read returned the source lines; write `Created file` + artifact; verify-law `written:true retiredKnobWritten:true withdrawnReported:true` → PASS |
| 3a | `bun run verify:rows` | `evidence/harness-0.2.1/verify-rows/…` | **PASS** | `35 row ids match the 2-file bundle patch layer` |
| 3b | `preset-conformance --self-test` against 0.2.1 | `preset-conformance-selftest/pass2.log` | **PASS (0.2.1 regime)** | `32 harness rows conform … persona prefix=true, mpd preset 29 child rows, row parity 27/27 (negative controls: 4/4 reddened)`, EXIT 0 |
| 3c | `bun test` | `f3-gates/bun-test-packages-pass2.log`; matrix `bun-test` | **PASS as `bun test packages`; the plan's bare spelling stays red** | packages: `2004 pass, 3 skip, 0 fail` (124 files); bare `bun test`: `18 fail` — it sweeps `evidence/**` fixture `.test.ts` files |
| 3d | `bun run typecheck` | `f3-gates/…/typecheck/` | **PASS** | exit 0 |
| 3e | `bun run test:qa` | `f3-gates/test-qa-021-pass2.log` (0.2.1) / `test-qa/…` (0.2.0) | **PASS (0.2.1 regime)** | `[test:qa] all self-tests passed`, EXIT 0; on the installed 0.2.0: `FAILED: preset-conformance.ts` (parity delta) |
| 3f | `bun run verify:dist` | `f3-gates/…/verify-dist/` | **PASS** | exit 0 |
| 3g | `node scripts/verify-pack-closure.ts` | `f3-gates/…/verify-pack-closure/` | **PASS** | exit 0 after the re-pack (captain's reading: `607 compared, 607 identical, 0 drift`) |
| 3h | `bun run verify:comments` | `f3-gates/…/verify-comments/` | **PASS** | exit 0 |
| 3i | `bun run verify:manifest` | `f3-gates/…/verify-manifest/` | **PASS** | `npm pack --dry-run lists 987 file(s); 0 required path(s) absent` |
| 3j | `bun run verify:docs` | `f3-gates/…/verify-docs/` | **PASS** | exit 0 |
| 3k | `node scripts/verify-manual-paths.ts` | `f3-gates/…/verify-manual-paths/` | **PASS** | exit 0 |
| 3l | `node scripts/verify-no-host-override.ts` | `f3-gates/…/verify-no-host-override/` | **PASS** | exit 0 |
| 4a | Docker lane RAN against 0.2.1 and the pin is proven | `f4-docker-source/source-2026-10-17T14-42-46.809Z/` → `evidence/docker/client-install/2026-10-17T14-42-47Z/` | **PASS** | `harness.installed 0.2.1-rc.2`, `expected 0.2.1-rc.2`, `harness.version` raw `0.2.1-rc.2`; carriers `dsh-experimental-agent-team/tool-agent-team/client-ui-agent-team` all `0.2.1-rc.2`, `carrierMismatch:false` |
| 4b | `--mode source --require-docker` green | same | **FAIL** | lane exit **3**; `passed 61 / failed 3`: `qa.readonlyDeny`, `tui.laneExit`, `ui.mpdSettingsSection` (the two `pack.*` reds from the first pass CLEARED — the re-pack worked) |
| 5 | Native `TeamExecutor` and the Docker `live.*` arms | — | INCONCLUSIVE | no credential forwarded (bounds unchanged) |

## Addendum — narrow re-verdict of claim 4b (third tree: code `2746cbb0`, evidence `bb360f0f`)

`evidence/harness-0.2.1/f4-docker-source/narrow-verdict.md` holds the full record. In one line each:
- Assertions: `passed 63 / failed 1 / null 54`; the only red is `tui.laneExit` (`line=182` = the
  `dsh plugin --profile dsh-tui add dsh-tui@0.15.0` step, right after `tui.hostInstall=true`).
- `ui.mpdSettingsSection` and `qa.readonlyDeny` are GREEN with their own artifacts, and both `pack.*`
  assertions are green under the pinned toolchain (`exactMatch=true`). The first-pass reds are gone.
- **The lane EXIT is 3 for a second, independent reason**: `driver.json` `exitCode: 3`,
  `unmeasured: ["ui.replyRendered"]`, `requiredPrefixes: ["ui."]`, `liveRequested: false`. The last
  green source lane (`2026-10-16T10-04-20Z`) ran `liveRequested: true, exitCode: 0, unmeasured: []`.
  Without a forwarded credential the required `ui.` arm cannot be measured, so exit 0 is unreachable
  on any tree. `--no-browser` would isolate the TUI red as exit 1 with exactly one failed assertion.
- Verdict: **PASS on claim 4b as the declared bound** (assertion record), **FAIL on "the process exits
  0"** — and the FAIL is a credential bound, not a product regression. The TUI refusal TEXT remains
  unproven because the step's own log was not captured (`tui.pluginAddHost` is null); capturing
  `$TUI_DIR/add-host.log` would close it.

### FINAL (third tree: `2a22837a`) — Docker acceptance: PASS, bounded by the exit code

`evidence/harness-0.2.1/f4-docker-source/final-verdict.md` holds the record. `result.json`
`ok:true, passed 84, failed 0, null 34, failedNames:[]`; the TUI is genuinely tested on dsh-tui 0.16.1
(`pluginAddHost exit=0`, `boot` on a real PTY, `mergedPanelOpens`/`Order`, `hostDashboardKeyIntact`,
`laneExit=true`, no `hostPeerBound`); both `pack.*` green under the pinned toolchain;
`ui.mpdSettingsSection` and `qa.readonlyDeny` green with their own bytes. `bun test packages` re-run here:
2013 pass / 0 fail. **`driver.json` still shows `exitCode: 3`**, `unmeasured: ["ui.replyRendered"]`,
`requiredPrefixes: ["ui."]`, `liveRequested: false` — the assertions are green, the process is not, and a
zero exit needs `--live` with a credential (or `--no-browser`). `complete:false` (34 nulls) is expected and
is not the acceptance predicate for a single invocation.

## Findings

1. **F4's three red rows, each attributed (no product regression demonstrated by any of them):**
   - `tui.laneExit` (`exit 1`, `line=182` on the `dsh plugin --profile dsh-tui add` step) — the plan's
     own R5 bound: dsh-tui 0.15.0 has not adapted to harness 0.2.1, and this wave declared no
     real-machine TUI adaptation. It is a DECLARED red, not a regression this wave introduced.
   - `ui.mpdSettingsSection` (`the settings dialog did not open … tried: Ctrl+Comma`) — but the same
     run's own console shows the section REGISTERING AND RENDERING:
     `[mpd] settings section: form updated status=ready value=present`. The red is the lane's
     dialog-open step in this environment, not a missing settings capability.
   - `qa.readonlyDeny` (`denyListMatchesTheEight=false`, `spawnDriven=false`, `childRequests=1`,
     `childLeaksWriteCapable=[]`) — the case's stub-driven instrument disagrees with the product while
     its own numbers show the child spawned and NO write-capable name leaked. My live arms (1d/1e/1f)
     measure the deny directly, on the child's own first header, and pass discriminatingly. This case
     needs to be re-pointed at the new mechanism; I did not edit it.
   **I therefore cannot mark claim 4 PASS.** The pin half is proven; the lane's verdict is red. Whether
   those three rows are accepted as declared bounds is the captain's decision, not mine.
2. **Low / bound — the plan's bare `bun test` is red for an unrelated reason.** It sweeps
   `evidence/**` fixture `.test.ts` files (`18 fail`, mostly `Cannot find module`); the repository's own
   `test` script is `bun test packages` (**2004 pass, 0 fail**). Either the plan's line names the script,
   or evidence fixtures leave the default glob.
3. **Low / bound — `preset-conformance` cannot validate a HOISTED harness layout.** Against the
   closure's own `.bin` it reports `@deepseek-ai/dsh-persona … (unresolved)` because `harnessRoot` +
   `loadSchema` read `<harnessRoot>/node_modules/<pkg>/lib/index.js` — npm's GLOBAL shape. This lane's
   0.2.1 arms therefore run on a global-style layout built from the closure's own packages
   (`lib/make-global-layout.ts`: 1 copied `dsh` package + 306 symlinks; no network; closure untouched).
4. **Low / bound — `preset-mpd` is pending on the `mpd-headless` profile** (`waiting for service:
   agentPresets`), reproduced identically on 0.2.0-rc.2: a composition fact of that profile, not a wave
   defect. The WEB profile mounts the preset cleanly (1a/1b).
5. **Low — the container's RESOLVED `@deepseek-ai/cordis` is not printed by the lane.** The only
   `cordis` texts in its logs are peer WARNINGS naming `@deepseek-ai/cordis@4.0.2` (alongside
   `dsh-llm@0.1.7-rc.2` style stale specs). The harness CLOSURE resolves **4.0.5**. "Same spec + same
   registry" is an inference, not an observation, and I record it as such.

## Declined to judge

- The 0.2.0 adapter arm (proven against doubles only) — not this lane's subject.
- The TUI real-machine adaptation quality — declared out of the wave by R5.
- The one-click / Web-plane lane (F5) — not in this lane's claim set.
- `VENDOR_LOCK.json`'s re-pin arithmetic — `verify:vendor` is the captain's gate; outside my claims.
- The first pass's instrument defect — already corrected and recorded in `VERDICT-first-pass.md`.

## Bounds of this review

- Three isolation layers on every boot (throwaway `DSH_HOME`, sandbox `HOME`, sandbox workspace) with
  `assertSessionsSandboxed`; the real `~/.dsh` was never written. The machine's global dsh is untouched.
- A harness session log records ONE `request/header` and ONE `system/message` per session, so a
  restriction applied after a child's first assembly would not be observable; findings here are stated
  about the FIRST assembly, which is the one that steers the child's first action.
- Child identity is taken from `subagent/descriptor` — never from a tool-list guess (that inference is
  what mislabelled a whole first pass; see `VERDICT-first-pass.md`).
- No credential was forwarded to the Docker lane, so native `TeamExecutor` and the `live.*` arms remain
  INCONCLUSIVE.
- Nothing cited here predates `684f9116`; the pre-ping readings were discarded, not reused.

**Overall: the wave's claims PASS on `684f9116` — row mounting, the `mpd` preset, the reworked subagent
seam (spawn + persona-in-system + discriminating read-only deny, roster AND workmate), the withdrawn
guards' boot line, tool registration, the live no-loop read/write, and every standing gate in the
target-harness regime. Claim 4b is the one I cannot mark PASS: the Docker lane is red on three rows,
each attributed above, and two of them are outside the wave's code. I am not the party that can convert
those three rows into accepted bounds — if the captain records them as such, the remaining evidence
supports a PASS; until then, the honest reading is: everything passes except the Docker lane's own exit
code.**
