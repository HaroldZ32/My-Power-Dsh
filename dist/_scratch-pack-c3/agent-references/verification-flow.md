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

---

## The former §4 body (verbatim): the full gate table with every per-row measurement

Provenance: moved from `AGENTS.md` §4 ("Gates (binding)") on 2026-10-06 by the instruction-budget split (the
manual must stay under the harness's 65,536-byte workspace-instruction budget, and it was already
over at the previous HEAD). The block below is reproduced VERBATIM — its byte count and sha256 are
recorded in `evidence/gates/agents-budget/20261006T085805Z/result.json`. `AGENTS.md` §4 carries the BINDING rules and points
here for the full body; where the two differ, the manual wins.

## 4. Gates (binding)

| Gate | Command | When |
|---|---|---|
| Vendor | `node scripts/verify-vendor.ts`; the corpus re-pin is DERIVED — `node scripts/repin-vendor.ts` (dry-run by default, `--check` asserts, `--write` applies; the helper REFUSES the repository's own `VENDOR_LOCK.json` without `--i-know-this-is-the-captains-step`, so a wave cannot re-pin mid-flight) — and lands in the commit that invalidated the `treeSha` (§9/§11) | any baseline/asset change; before release |
| Dist freshness | `node scripts/verify-dist-fresh.ts` (deterministic rebuild-and-diff: every `packages/*/src` entry is rebuilt twice into a temp dir and compared byte-for-byte with its committed `dist/`; unmatched `dist/` files are printed in a loud NOT COVERED section, never silently skipped; `--self-test` seeds a mismatch; the canonical REBUILD command — repo root, path-qualified args — and the package-directory trap are named in §6's Build line) | any `packages/*/src` or `dist/` change; before release |
| Row/parity | `bun run verify:rows` + `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | any bundle-patch / preset / overlay / row change |
| Pack closure | `node scripts/verify-pack-closure.ts` (completeness + the byte identity of files whose sources did not move; `--self-test` is the fixture-driven arm; `--pack-stamp <t>` re-anchors the comparison for a reviewer mutating a copy) | any pack, any post-pack writer, and in the release sweep (§11) |
| Tests | `bun test` (per package) + `bun run typecheck` (root) | every plugin change |
| QA self-tests | `bun run test:qa` (all `--self-test`) | every plugin/QA-script change |
| QA real cases | `node skills/dsh-qa/scripts/<case>.ts` | runtime-behavior changes |
| Installer | `node scripts/install-profile.ts --dry-run` | any bundle-patch/installer change |
| Doc pairs | `bun run verify:docs` (`scripts/verify-docs-parity.ts`; ships `--self-test` with a negative control; recursive under `docs/`, `extensions/**/README.md` and `templates/**/README.md`, and it fails on a zh-only doc or an undocumented package) | any human-facing doc change (`README*.md`, `docs/**`, `packages/*/README*.md`, `extensions/**`, `templates/**/README*.md`); before release |
| **Plugin manifest (STANDING — user-mandated)** | `bun run verify:manifest` (= `node scripts/verify-plugin-manifest.ts --pack`): the TWO install-time rules — **no `cordis`** in `dependencies` / `peerDependencies` / `optionalDependencies` (by NAME; the optional field is NOT an exemption) and no `preinstall` / `install` / `postinstall` / `prepare` script NAME — the VERSION-COHERENCE rule (`dsh-plugin.json` + `dsh-distribution.json` must carry `package.json`'s version) — plus the packaging contract a one-command install rests on: declared patch files exist, every row module path resolves, the `files` allowlist admits every runtime path, `evidence/` stays out, and **npm's own `npm pack --dry-run` list carries them**. `--self-test`: six arms with clean controls | every manifest/patch/row/file-layout/version change, and EVERY release sweep |
| **Declaration comments (STANDING — user-mandated)** | `bun run verify:comments` (= `node scripts/verify-comment-coverage.ts`): a TypeScript-AST check (never a line scan) that every declaration in the source set (`packages/*/{src,test,self-fix-tests}`, `scripts/`, `skills/*/scripts/`, `docker/`, `tests/`, `templates/`, `extensions/`) has a precise comment above it, and that every NAMED function writes down its parameter and return types | any source edit, and EVERY release sweep |
| No host override | `node scripts/verify-no-host-override.ts`: fails when ANY shipped patch row id-targets an id a host layer declares; refuses a vacuous PASS; `--self-test` 6 arms + a live seed | any bundle-patch row edit, and EVERY release sweep |
| Manual paths | `node scripts/verify-manual-paths.ts` (T-66: a path-shaped token this manual spells in a code span is AUDITED only when its first segment is an entry at the repo root; a token that is not root-anchored (a GitHub slug, an API route, an `@scope/name`) or not written literally (a glob, a placeholder, an elision) is counted in its own bucket and NEVER fails the run — so it catches a wrong ROOT-relative path, not a wrong package-relative spelling; the DECLARED anticipatory class and its rot guard are printed apart from the audited subjects) | any edit to this manual |
| Extension CLI | `bun scripts/mpd-ext.ts --self-test` + `bun scripts/mpd-ext.ts validate extensions/mpd-ext-example` (exit 0; a deliberately broken extension MUST exit 1 with per-item errors) | any extension-interface/manifest/CLI change |
| Boot check (MOUNT) | a boot that really applies the rows in an isolated `DSH_HOME` + sandbox `HOME` — e.g. `bun skills/dsh-qa/scripts/bundle-lifecycle.ts` (host rows) and `node skills/dsh-qa/scripts/preset-conformance.ts` (the `mpd` preset's standing mount + every harness-owned row config; its negative control proves the assertion is falsifiable), or the `full-profile-boot.sh` / `mount-proof.sh` pattern with registration instrumentation | any patch change, any preset/row change, and REQUIRED for any tool-schema change |
| Composition only | `node scripts/dump-config.ts --profile <p>` (repo wrapper around the raw harness flag: prints the composition-only banner in its own output and propagates the child's exit code) | whenever a row/preset composition question is asked |
| **Docker real-machine (LAST step)** | `bun run verify:docker` (`node scripts/docker-e2e.ts`; `--mode source` = checkout, `--mode oneclick` = the PUBLISHED package, `--spec <install-spec>` = any spec including the live `github:` one). Builds a real `ubuntu:24.04` and asserts the INSTALL then the MOUNT — rows activating, tools registering, the TUI booting on a real PTY, `agentPreset=mpd` in the session store — never merely "the install exited 0". **A machine without a ROOTLESS Docker PRINTS A NOTICE AND SKIPS (exit 0)**: rootless runs, rootful skips unless `--allow-rootful-docker`, an absent daemon skips, `--require-docker` makes any skip exit 3. A SKIP is not a pass — the steps ABOVE it carry the wave | every release sweep, and any install/mount-path change (`files`/`dsh.*`, a patch row, `docker/**`) |

**The pack-closure bound (T-91):** a green `node scripts/verify-pack-closure.ts` certifies COMPLETENESS
plus the BYTE IDENTITY of every file whose source did not move; **freshness is NOT what the exit code
says** — it is read from the `expected-after-pack` list at the re-pack (T-26's discriminator: TIMESTAMP
ORDER; `--pack-stamp <t>` re-anchors it for a reviewer mutating a COPY). The gate's `--self-test` fixture
arms are the operative evidence; a grep for this paragraph is not.

`--dump-config` is NOT a gate: it COMPOSES rows and never executes plugin code, so a schema/apply abort
is invisible to it. Measured: `dsh --profile mpd --dump-config` exited 0 with the `mpd-workmate` row
present while the same profile's real boot could not load the tree; the decisive check was a mounting boot
with registration instrumentation (`evidence/workmate/rename-delete-core/20260910T132303Z-mount/`).
**It proves COMPOSITION ONLY — never a plugin load.** Every instruction that sends a reader to the flag
goes through the repo wrapper `node scripts/dump-config.ts` (T-31), which prints that warning itself;
only passages that CONTRAST the flag keep the raw spelling on purpose.

No evidence on disk for a gate = the change is not complete. Merge to dev only after the relevant gates
pass and their evidence is committed with the change.

`bun run verify:gates` is the fast aggregate over the static gates (vendor, dist freshness, row parity,
doc pairs, preset conformance) — one command for a patch/preset edit and for the release sweep. It
expects a CLEAN tree: a dirty `skills/**` corpus legitimately reddens the vendor gate until the wave's
single re-pin lands (§9/§11).

## §5 rule 2 — the captain's reserved set

The manual's §5 rule 2 is the binding statement; this section is its LONG FORM, moved out on 2026-10-08 by
the instruction-budget rule (§3, MOVE-FIRST) when rule 2 gained the reconnaissance clause. The manual
keeps the short definition plus the pointer that sent you here.

**What the captain reserves.** §5 names the work the workspace's TOP-LEVEL session executes itself because
no other agent may: the SINGLE GIT WRITER of the checkout (§5's one-writer rule; the user's own shell
otherwise), CONTRACT AMENDMENTS, PLAN/ROSTER SHAPING, releasing a watchdog hold, and the FINAL
INTEGRATION. It does that without framing it as "working solo" — sizing decides WHICH executor, never
whether to delegate.

**What is NOT reserved — RECONNAISSANCE.** The user's requirement (2026-10-08): the user-facing main agent
must keep its context small enough to drive very large projects, and reconnaissance — finding files,
reading source, grepping for symbols — is what inflates it. So it is DELEGATED: an `Explorer` (find files
and code) or a `Researcher` (evidence-based search) through `mpd_role_spawn`, or a team member; the captain
consumes the REPORT. This is MECHANICAL, not a reminder: `mpd-roles-plugin`'s captain investigation guard
denies `read`, `grep` and `glob` on a SOURCE path for the top-level session, decided by the pure function
`captainInvestigationDecision` (`packages/mpd-roles-plugin/src/captain-investigation.ts`) and installed
through the adapter's `guardTool` seam beside the captain's write rule. Keyed on `sessionIsTopLevel` — §5's
ONE captain predicate, never a preset name (T-92) — so members, one-shot specialists, workmate spawns and
bound verifier seats keep their reconnaissance: the verifier's own envelope scopes ITS reads separately and
must not be double-restricted.

**The band that stays readable** (integration is impossible without it): `.mpd/**`, `docs/**`,
`evidence/**`, `agent-references/**`, and at the workspace ROOT `AGENTS.md`, `AGENT.md`, `CLAUDE.md`,
`README.md`, `README.zh-CN.md`, `CHANGELOG.md` and `LICENSE*.md`. Everything else — any source path under
`packages/**`, `scripts/**`, `skills/**`, `presets/**`, `docker/**`, `extensions/**`, `templates/**`,
`tests/**`, `vendor/**`, `node_modules/**` — is REFUSED, and a call with NO usable path argument is refused
(fail-closed: a bare `grep`/`glob` searches the whole workspace, and a pattern's own directory prefix is
not a path). A `..` segment is refused rather than resolved, so `docs/../packages/x/src/y.ts` cannot start
inside a band and end outside it.

**The knob.** `captain.investigation` in `mpd.jsonc`: `"deny"` (the DEFAULT) | `"allow"`; anything else
reads as `deny` (fail-closed). It is read PER CALL through the existing config layer, so an edit is picked
up live (T-18), and the row's boot line reports the mode it installed (`captainInvestigation=deny|allow` in
`<workspace>/.mpd/logs/mpd-roles.log`). The refusal names the route out and the band that stays open.

**Honest bounds, stated rather than implied.** (1) The guard reads a TOOL CALL's arguments: reaching a
source path through `bash` (`cat`, `rg`) is NOT blocked — `bash` stays available to the captain for gates
and git, exactly as §5 rule 5's command matcher has the same reading bound. (2) A path is judged by its
SPELLING; a symlink is never resolved. (3) A composition with no `tools.guard` seam installs nothing and
SAYS so (the boot line carries `captainInvestigation=absent reason=…`). Mount evidence:
`evidence/roles/captain-investigation/`.

**The sanctioned delegation is MECHANICAL too — the delegation gate (2026-10-10).** Rule 2 names the
sanctioned delegation surfaces (`mpd_role_spawn`, the workmate library, Agent Teams), but the harness's
generic spawn tools `subagent` / `subagent_fork` / `workflow` were undefended, so the discipline was advice
and the escape cost nothing. `packages/mpd-roles-plugin/src/delegation-gate.ts` installs ONE `guardTool`
callback beside the investigation guard; it refuses those three names and its sentence names the routes
out. The knob is `delegation.gate` in `mpd.jsonc`: `"deny"` (DEFAULT — the captain AND every member
session, because a hatch a member can still use is not a discipline) | `"captain"` (the top-level session
only) | `"allow"`; anything else reads as `deny`, and the knob is read PER CALL. Keyed on §5's PRESET-FREE
`sessionRank`, so it covers every session in a workspace that mounts the bundle, whatever preset the
profile assigned — and preset-plane omission is deliberately NOT the mechanism, because the live top-level
session runs a preset this bundle does not own (`cordis`). The boot line carries `delegationGate=<mode>`
(or `delegationGate=absent reason=…` without the guard seam). **Honest bound:** the guard reads the TOOL
CALL at dispatch, so it cannot stop a model from TRYING another tool, and a profile without this bundle
has no gate at all. Live evidence: `evidence/roles/delegation-gate/`.

**The captain predicate and the SEEDED FORK (F0, 2026-10-10).** `sessionRank` in the same package decides
`captain` / `child` / `headerless` from the session HEADER alone: a session is a CHILD iff the harness
recorded `origin === "subagent"` OR a `delegationDepth` of `1` or more; every other header is the CAPTAIN.
The parent link is deliberately NOT the test — the user's real working session is a SEEDED FORK
(`parentSession` + `isSeeded: true` + depth `0`, no subagent origin), and the old "any parent session is a
child" rule classified THAT session as a member, which silently disarmed the captain write rule, the
investigation guard and the one-git-writer rule on the one session they gate. An absent header still fails
CLOSED (`headerless`, never the captain). `sessionQualifies` — the session-start gate's preset-scoped
question — is untouched and must never be substituted here (T-92).

**A read-only spawn survives an unregistered deny-list name (F2, 2026-10-10).** `tools.restrict()` rejects
the WHOLE list when one name is not registered in the profile and offers no ignore-unknown option, so the
two `mcp__lsp__*` deny entries killed EVERY read-only spawn on a host without `cclsp` — the broken front
door that pushed the captain onto the generic `subagent` tool the delegation gate now refuses. The
adapter's `restrictToolsTolerant` (`packages/mpd-dsh-adapter-plugin/src/index.ts`) applies the CANONICAL
list to the calling agent's own scope and releases it in the same synchronous turn, so the harness's own
verdict is the only pruner: the names it reports as unknown are pruned, exactly ONE retry is allowed, and
any second failure is rethrown. The lists themselves are unchanged, still identical across the roles and
workmate packages, and still never pre-filtered with a `hasTool` probe (the glossary rule).

**The tool surface, and the two sentences rule 4 REPLACES** (moved here verbatim with the same MOVE-FIRST
split). The verification law's tool surface is ONE row, `mpd-verify-plugin`: `mpd_verify_open` /
`_escape` / `_seat` / `_evidence` / `_record`, and the verifier's envelope denies a bound seat the shell,
the source-returning tools and every board mutation. **Two sentences this rule REPLACES**: "execute
directly when it does not [help to delegate]" is no longer an option for code, and "verify everything a
subagent claims yourself" is no longer how the main agent closes work — a claim is closed by a DIFFERENT
agent's recorded verdict, and the main agent's own reading of a result is INTEGRATION, which is not
verification.
