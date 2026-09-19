# t9 — Review verdict (round 1): AC-by-AC on the settled revision, with the closure and parity claims attacked

Seat: Reviewer (read-only; no fix applied). Task: t9 (contract lane t7). Reviewed wave: all lanes
against `evidence/agent-teams/adapter-wiring/requirements-contract.md` (frozen, revision 3 + the
in-place ERRATA). Attempt 6, attempt_id `37ff551f-ba49-4590-aa3d-ed76a369fe3e`.

**VERDICT: needs_revision — 14 ACs PASS, AC13 FAIL, AC14 UNPROVEN.**
Every claim the wave makes about its own product survives my attack (closure, parity, delta restore,
docs count, mounting boot, negative control). What fails is the wave's own out-of-scope `skills/**`
repair: VENDOR_LOCK.json is now stale, and that single fact reddens THREE of the acceptance commands
(`bun run verify:gates`, `bun run test:qa`, and the vendor gate itself). AC14 belongs to the
integration lane, which has not run. AC12 was FAIL at my first read and PASSES on evidence t22 landed
inside the review window (see §0).

## 0. Revision judged (hash + UTC read moment — a bare hash is provenance, not an anchor)

My own hash read at **2026-09-19T15:55:40Z**, re-checked at **15:57:28Z** after the tree moved
(`logs/reviewer-revision-hashes.txt`). The load-bearing product files are byte-identical to the
verification lane's settled `end-c` set: my hash lines diffed against
`…/verification/20260919T152119Z/end-c.txt` show ONLY the files I did not re-hash plus the skills
changes below. My 50 s settle sandwich is identical (`logs/settle-sandwich.log`).

| Path | sha256 (first 16) | note |
|---|---|---|
| `packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js` | `01fd9125510885fb` | bridge, 522 lines, 1 region |
| `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js` | `456a297b00e5225f` | registry, 151 entries / 13 files |
| `packages/mpd-agent-teams-plugin/lib/{index,capabilities,harness-compat,members,command,tools}.js` | `3387c26e…`, `8e6249da…`, `22f5d3f7…`, `f4b7cb9b…`, `fcc3bb6b…`, `d470e24c…` | the six bridged files |
| `packages/mpd-dsh-adapter-plugin/src/index.ts` / `dist/index.js` | `e394855355116187` / `d8e8fa36cb214d04` | twelve new methods + dist |
| `scripts/patch-agent-teams-fixes.mjs` | `f0789ea0cf35dadd` | registry guard |
| `AGENTS.md` / `docs/design.md` / `docs/design.zh-CN.md` / `agent-references/agent-teams-deltas.md` | `bdd440cb…` / `5de54a33…` / `dfd17369…` / `a1ea21c0…` | docs surfaces |
| `packages/mpd-team-watchdog-plugin/test/fixtures/inject.mjs` | `b4c9ceb879b290a1` | t18 fixture repair |
| `skills/dsh-qa/scripts/lib/credentials.mjs` | `b32f12c7becaf6c6` | t22 (mtime 15:50:19Z) — **out of the wave's declared scope** |
| `skills/dsh-qa/scripts/agent-teams-dispatch.mjs` | `8da2a61b9a6c1cc4` | t22 (mtime 15:55:51Z) — **out of the wave's declared scope** |

**The tree moved during the review, and the verdict says so.** `credentials.mjs` appeared at 15:50:19Z
(after t8's 15:46:52Z settled set and after this review claimed the task at 15:48:02Z);
`agent-teams-dispatch.mjs` appeared at 15:55:51Z. Two consequences I handled explicitly:
(a) AC12 was FAIL at my first read (15:52Z) and is **PASS** on evidence that landed at 15:51:13Z /
15:56:05Z — I read those artifacts and re-measured the red commands on the new revision;
(b) AC13 stays FAIL and F1 got STRONGER (a second skills file, a third red command).

Settle sandwich (`logs/settle-sandwich.log`): my two reads 50 s apart are identical (`SETTLED`), and
the 22-file hash set matches the verification lane's end-c — except that the two skills files above
are NEW changes the verification lane never saw. `logs/reviewer-revision-hashes.txt` is my own read.

Commands I ran myself (logs under `logs/`): `node scripts/verify-vendor.mjs` (**exit 1, twice: 15:52Z
and 15:57:16Z**), `bun run verify:gates` (**exit 1 twice — `FAIL - 1/5 member gate(s) failed: vendor`**),
`node scripts/patch-agent-teams-fixes.mjs --check` (exit 0, `151 … across 13`), `bun test` on the five
new test files (67 pass / 0 fail), `bun test packages/mpd-agent-teams-plugin` (360 pass / 0 fail),
`bun run typecheck` (exit 0), the registry census, the region/hunk discipline checker, an independent
closure census, a scratch-tree restore experiment, a scratch-tree `--write-registry` identity check,
and an adversarial probe of the AC15 scanner's power.

## 1. AC-by-AC verdict table

| AC | Verdict | Evidence (authoritative path first) |
|---|---|---|
| AC1 | **PASS** | `bun run typecheck` exit 0 (`logs/typecheck.log`); `FROZEN_SURFACE` = 14 methods with arities + `FROZEN_FLAGS` = 12 flags, green in my run of `packages/mpd-dsh-adapter-plugin/test/adapter-agent-teams-surface.test.ts`; my read of `src/index.ts` (`registerHostTool`, `subagentRuntime`, `subagentProvider`, `subagentProviders`, `startContinuableAgent`, `interruptAgent`, `llmListModels`, `llmResolveCallConfig`, `registerPromptSection`, `agentScope`, `startAgentTurn`, `cancelAgentTurn`, `steerAgentTurn`, `injectAgentMessage`) and of `capabilities()` (the 12 new flags + the pre-existing `subagents`/`commandsRegister` the bridge also gates on) |
| AC2 | **PASS** | `adapter-agent-teams-surface.test.ts` "the SAME object reference reaches `tools.register` — no rebuild, no spread, no wrapper": `Object.is` true, the four fields `registerTool` drops present BY IDENTITY, `execute` the original function, key set equal; `registerTool` keeps its own test arm |
| AC3 | **PASS** | `packages/mpd-agent-teams-plugin/test/adapter-routing.test.mjs` (green in my run): `apply()` + the five installers + `deliverToMember`/`interruptMember`/`spawnMember`/`haltTeamWork`/the command handler against a THROWING-proxy raw ctx, `rawHits === []`, plus the negative-control arm proving the detector is armed; the rev-6 F7 instrument scope is honored (host `childCtx` exempt) |
| AC4 | **PASS** | `test/adapter-facade.test.mjs` (green): frozen witness literals, exactly ONE absent line, PENDING ≠ ABSENT and re-probe, mounted ⇒ zero fallback lines, console sink by default, per-seam degrade |
| AC5 | **PASS** | `git status --porcelain` over `test/` + `self-fix-tests/` shows ONLY `??` new files (no ` M `); `bun test packages/mpd-agent-teams-plugin` = 360 pass / 0 fail exit 0 (`logs/bun-test-agent-teams-package.log`) |
| AC6 | **PASS** | `test/adapter-tool-parity.test.mjs` (green): 21 definitions in BOTH lanes, `adapterNames toEqual rawNames` (order), `canonical()` (sorted keys + `String(fn)`) equal, plus the `Object.is` arm. I re-read the test: it compares exactly what the AC names; its blind spots are Symbol/non-enumerable properties, which the AC's own definition of "canonical serialization" excludes |
| AC7 | **PASS** | `--check` exit 0 (`151 … across 13`); my hunk-vs-region checker: all **36** diff hunks of the six bridged files land inside `mpd-delta` spans, 0 outside (`logs/region-hunk-check.log`); registry census: 151 entries / 13 files, keys exactly `afterContext,beforeContext,block,file,id`, ZERO `create` keys; my scratch `--write-registry` reproduces `456a297b…` **byte-identically** (so the registry is derived, not hand-edited) |
| AC8 | **PASS** | my own scratch tree (real CLI + real lib, `mktemp -d`): missing bridge ⇒ `--check` exit 1, names the file, **0 occurrences of ENOENT**, tells the caller to re-run `--write`; `--write` exit 0 ⇒ sha256 **identical** to the checked-in bridge, second `--check` exit 0; control: a missing NON-mpd registered file (`quality-gates.js`) is named by `--check`, `--write` exits 1 and does **not** create it. `self-fix-tests/mpd-owned-file-restore.test.mjs` green |
| AC9 | **PASS** (2 low findings) | `verify:docs` PASS inside my `verify:gates` run: `pairs=38 failed=0 violations=0 dead=0`, and the derived note adjudicates the count sentence: `carried **151**/13 vs derived 151/13 — agree`. My reads: AGENTS §1 seam clause + §6 closure paragraph, `docs/design.md` §6b + zh twin, deltas reference (count sentence wording byte-equal to HEAD's, only numbers moved — R5 TRUE: the gate regex `REGION_COUNT_RE` is fixed on that wording), adapter README pair "Wrapped seams" table with the 14 new rows. Findings F5 (absolute "every seam" sentences) and F6 ("its own flag") |
| AC10 | **PASS** (scope note F7) | `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` unmodified PASS (`evidence/dsh-qa/bundle-lifecycle/2026-09-19T15-21-24.780Z`); its `boot.log` line 7 carries the MOUNTED witness, line 1 the adapter row, `ABSENT`/`pending` = 0, `[roles-probe] AGENT_TEAMS_TOOLS=7/7`; the lane's own instrumented boot (`verification/…/adapter-enabled-boot.mjs`, `adapter-enabled-result.json`) adds `VERIF_AGENT_TEAMS_TOOLS=21/21`, mounted ×1, fallback ×0, scope identity true |
| AC11 | **PASS** | `verification/…/adapter-disabled-result.json` + `.log`: adapter row occurrences **0**, `absent=1 / pending=0 / mounted=0`, tools 21/21, F1 signature 0, BR-1 witness 0, preset probe PASS, DSH_HOME/HOME/workspace sandboxed + `sessionsSandboxed` asserted |
| AC12 | **PASS** (upgraded during the window) | `--self-test` green (31 rows conform, parity 31/31, inside my `verify:gates` logs); the REAL run is now GREEN with post-fix evidence: `evidence/dsh-qa/preset-conformance/2026-09-19T15-51-13.529Z/` and `…/2026-09-19T15-56-05.060Z/`, both `ok: true` and `[preset-conformance] PASS` (auth, sessionCreate 200 with `agentPreset: mpd`, sessionHeader, bootLog signatures [], negativeControl firing). At my first read the last recorded real run was exit 1 (t8's V-1); t22's fix and its evidence landed INSIDE the review window, so the verdict follows the latest evidence on disk, not my first read. Residual ask (F2) |
| AC13 | **FAIL** | **three reds on the current revision**: (1) my own runs of `bun run verify:gates` = `FAIL - 1/5 member gate(s) failed: vendor (exit=1)` at 15:52Z and again at 15:57:16Z (`logs/verify-gates.log`, `logs/verify-gates-second.log`); (2) `node scripts/verify-vendor.mjs` = `FAIL - asset skills treeSha mismatch` (both runs); (3) `bun run test:qa` exit 1 — `[agent-teams-messaging] FAIL: VENDOR_LOCK skills asset is stale: lock=326/e944e320b3ff tree=326/82f38bd828bc (re-pin in the same commit, AGENTS.md §9)` in t22's own `evidence/agent-teams/qa-credentials-repair/20260919T155032Z/test-qa.log`. Also red: bare `bun test` (t8's V-2, 605 failures under `evidence/mpd-naming/wave2/raw/scratch/**`, pre-existing, wave-independent). Green in my runs: dist-fresh (20/20), rows (25), docs (PASS), preset-conformance `--self-test`, typecheck. Finding F1 |
| AC14 | **UNPROVEN** | the integration lane (team t10) is blocked; no re-pack / `expected-after-pack` freshness evidence exists under `evidence/…/integration/**` |
| AC15 | **PASS on the bytes** (1 medium finding) | the scanner test is green in my run, and I did NOT take its word: my independent census (`logs/closure-census.log`) walks 18 server files and classifies **83** seam sites — 39 on the facade, 18 on non-facade receivers inside regions, 24 in the bridge's fallback column, 2 on the counted `childCtx` residual (the two `childCtx.on(...)` subscriptions), **0 unrouted** (the 5 raw hits my broad regex reported are data fields `args.commandsRun`/`task.commandsRun`/`update.commandsRun` and `req.on` in `web-routes.js`). No alias/destructure/bracket/`Reflect.get` shape exists anywhere in `lib/`. Finding F4 (the test's power is bounded) |
| AC16 | **PASS** | t8's `start/end-a/end-b/end-c` + `recheck-154850Z.txt` (22 files, 50 s settle, start == end); my own sandwich 50 s apart is identical AND matches end-c, i.e. the product files are settled — with the explicit caveat that `skills/**` moved after t8's window (F1/F3) |

## 2. The four attacks the assignment ordered

**(a) Closure — no surviving raw seam access.** Result: NOT falsified, on the bytes I inspected.
Independently verified: (i) `harnessCtx` lives only in the two region lines of `index.js` and escapes
nowhere; (ii) every consumer (`installTeamCapabilities`, `installSessionTeamPolicy`,
`installInterjectionExpirySweep`, `installAgentTeamsGestureBoundary`, `registerAgentTeamsCommand`
through the facade's own `inject` wrapper, `registerAgentTeamsTools`, `installTeamScheduler`,
`haltTeamWork`) is called with the reassigned `ctx`; (iii) the unbridged server files
(`scheduler.js`, `events.js`, `session-start.js`, `snapshot.js`, `state.js`, `quality-gates.js`,
`profiles.js`, `web-routes.js`, `tool-names.js`, `types.js`, `event-types.js`) contain no harness-seam
receiver at all (`web-routes.js`'s only `.on(` is `req.on`); (iv) no
`get('agents')`/bracket/destructure/alias/`Reflect.get` spelling survives outside the bridge. The
residual is exactly what the docs claim: the counted `setup(childCtx, child)` lines, of which
members.js:383 and :434 are real raw scoped-ctx `on(...)` subscriptions — see F5.

**(b) Parity — 21 definitions, order, and does the test compare what it says.** Result: NOT falsified.
The test compares name lists IN ORDER, both lane lengths (21), and the canonical form the AC names;
the production chain's verbatim hand-over is proven separately by AC2's `Object.is` arm against the
real `tools.register`.

**(c) Delta restore.** Result: NOT falsified, and stronger than the wave's own evidence: my
independent scratch run reproduces `--check` loud-by-name (no ENOENT), `--write` byte-faithful
restore, and `--write-registry` byte-identity — plus a control proving a missing non-mpd file is
never created.

**(d) Docs truthfulness.** Substantially TRUE — the count sentence R5 describes is real (the gate
regex matches it verbatim, only numbers moved), the residual set is named, the closed exception is
stated on all four surfaces. Two precision findings (F5, F6).

## 3. Findings (each actionable; none applied — the captain is the only git writer)

**F1 — high — the wave's own repair edited `skills/**` out of scope and left the vendor baseline stale;
one fact now reddens three acceptance commands.**
TWO skills files carry t22's changes (`skills/dsh-qa/scripts/lib/credentials.mjs` `b32f12c7…`,
mtime 15:50:19Z; `skills/dsh-qa/scripts/agent-teams-dispatch.mjs` `8da2a61b…`, mtime 15:55:51Z), the
wave's contract says "`skills/**` MUST NOT be touched in this wave" (D7/§8), and `VENDOR_LOCK.json`
was not re-pinned, so: `node scripts/verify-vendor.mjs` fails (`asset skills treeSha mismatch` — my
runs at 15:52Z and 15:57:16Z); `bun run verify:gates` = `1/5 member gate(s) failed: vendor` (both my
runs); and `bun run test:qa` exits 1 on `agent-teams-messaging.mjs --self-test` with
`VENDOR_LOCK skills asset is stale: lock=326/e944e320b3ff tree=326/82f38bd828bc` (t22's own
`test-qa.log`). AC13 cannot pass and the wave must not merge in this state. Required fix: land the
wave's single sanctioned re-pin in the SAME commit as the skills changes
(`node scripts/repin-vendor.mjs --write --i-know-this-is-the-captains-step` — a captain step), then
re-run BOTH `bun run verify:gates` and `bun run test:qa`; OR revert the skills edits and take the V-1
repair in its own wave. Either way the contract's "skills/** out of scope" line (§8/D7) must be
reconciled with the created t22 in the same change, so plan and tree agree.

**F2 — RESOLVED inside the review window (one residual ask) — AC12's evidence landed, its proof is one-off.**
At my first read AC12 had no post-fix evidence (t8's real run exit 1, V-1). During the window t22
landed the fix plus TWO real `preset-conformance` runs (`…/2026-09-19T15-51-13.529Z/`,
`…/15-56-05.060Z/`, both `ok: true`, PASS), a before/after reproducer, a 16-check shapes proof and a
`test:qa` log (`evidence/agent-teams/qa-credentials-repair/20260919T155032Z/`). AC12 therefore PASSES.
Residual ask: the shapes proof is a one-off `evidence/**` script rather than a permanent `--self-test`
arm — promote its three shape families (bare `refs:`, single-line inline mapping, loud refusal) into a
case `--self-test` so a regression cannot land invisibly.

**F3 — medium — the verification lane's evidence is stale against the revision it is cited for.**
t8's stored verdict is FAILED (AC12/AC13 red) and its 22-file hash set predates the `skills/**` edit
that now reddens `verify:gates`; the stored result's own `attempt_note` says a repaired revision needs
a fresh attempt. Required fix: after t22 + the re-pin settle, dispatch a fresh verification attempt
(re-run AC12/AC13/AC16 and the boot arms) and cite THOSE hashes; my AC12/AC13 verdicts cannot be
upgraded on t8's record.

**F4 — medium — AC15's scanner power is bounded (heuristic, not a soundness proof).** Measured with
the test's own rules: an alias of `agent.ctx`, a destructured `on`, a bracket member
(`agent.ctx['tools']`), `Reflect.get(ctx,'agents')`, `ctx.get.call(ctx,'agents')`, and ANY seam on a
line that also mentions `childCtx` all evade the scan (`logs/adversarial-closure-scan.log`). The tree
exploits none of them (my census), so the closure holds today — but the test's own sentence claims
more than its power. Required fix: extend the rules to the alias/destructure/bracket shapes, and
narrow the `childCtx` skip to the five known lines instead of the whole line set.

**F5 — low — two absolute sentences overstate the closure relative to the counted bypass.**
AGENTS.md §1: "every harness seam it touches goes through the mounted `mpdDsh` service"; design.md
§6b: "reaches every harness seam through this adapter". §6 correctly counts the residual, and the
adapter's `agentScope` deliberately returns `context === agent.ctx`, so members.js:383/:434 subscribe
with raw `childCtx.on(...)` even when the adapter is mounted. Required fix: qualify both sentences
("except the counted `setup(childCtx, child)` residual named in §6") or fold the residual pointer
into the same sentence.

**F6 — low — "each behind its own `capabilities()` flag" is not literally true.** 14 methods carry 12
new flags: `subagentProvider`/`subagentProviders` share `subagentsProvider`, and `subagentRuntime`
gates on the pre-existing `subagents` flag (`seamMethod`'s gate is read from the adapter's own
`capabilities()`). Required fix: say "each behind a `capabilities()` flag (one flag may cover two
methods; `subagentRuntime` reuses the existing `subagents` flag)".

**F7 — low — AC10's boot cannot witness the five agent-object flags.** `ADAPTER_SEAMS` in the boot log
reports `agentScope`, `agentTurnStart/Cancel/Steer/Inject` ABSENT because they are LIVE-REGISTRY probes
and that boot has no live agent; the 21-tool count in the boot comes from the lane's own instrumented
probe (`verif-probe`/`adapter-enabled-boot.mjs`), while the named unmodified case reports
`AGENT_TEAMS_TOOLS=7/7`. Evidence still exists (unit tests + the hostile-ctx arm), so AC10 passes —
but a reader of the AC must not conclude the named command witnessed the five flags. Required fix:
state the scope in the verification result (or add a live-agent boot arm).

## 4. What would let this wave close

1. t22 completes with its own evidence (F2, now largely landed), the captain applies the single vendor
   re-pin (F1), and the contract's skills clause is reconciled with t22 (F1).
2. A fresh verification attempt runs the standard sweep on the settled post-re-pin hashes (F3) and
   shows `bun run verify:gates` AND `bun run test:qa` green (the AC12 real case is already green).
3. Then t10 integration produces AC14's re-pack evidence (T-91: freshness read from the
   `expected-after-pack` list, never from the exit code).

Findings F4–F7 are recommendations, not gates: none of them falsifies a claim the wave makes about
the bytes on disk. F2's residual ask (a permanent shape arm) is a hardening request.
