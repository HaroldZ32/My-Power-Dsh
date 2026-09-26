# t27 — Review verdict (round 3): PASS on every in-scope AC

Seat: Reviewer (read-only; no fix applied). Task: t27 (review r3, reviewed task t26). Attempt 2,
attempt_id `6bb317bb-6695-488c-b3e1-6baeb6cca8c2`. Frozen authority:
`evidence/agent-teams/adapter-wiring/requirements-contract.md` (sha256 `e4e0b3b24f7778c5…`, unchanged
since round 2).

**VERDICT: pass.** Every in-scope AC (AC1–AC13, AC15, AC16) carries evidence I re-measured on the
settled revision; **AC14 is CARRIED BY t10** (integration), per the captain's ruling recorded in
t26's item 1 — a review round must not fail for evidence that can only exist after it. Round-2's
findings F2, F3 and F5 are closed BY THE ARTIFACTS, and the artifacts changed since round 2 (docs
wording, scanner rules, contract clause) survived an adversarial pass. Two non-blocking observations
are recorded in §3; neither falsifies a claim the wave makes.

## 0. The settled revision (hash + UTC read moment)

My own hash read at **2026-09-19T16:18:53Z** (`logs/reviewer-revision-hashes.txt`). Settle sandwich:
START `16:20:04Z` == END `16:21:0xZ` over 50 s, **identical** (`logs/settle-sandwich.log`), covering
the 22 files that matter to this wave (docs, the hardened scanner test, AGENTS.md, the contract,
`VENDOR_LOCK.json`, the bridge + six bridged files, the adapter src/dist, the CLI, the two authorized
skills files).

| Changed since round 2 | sha256 (16:18:53Z) | round-2 value |
|---|---|---|
| `docs/design.md` | `91a153031268fdaa` | `5de54a3356997026` |
| `docs/design.zh-CN.md` | `ace6a393173f3afe` | `dfd17369c12ca9ae` |
| `agent-references/agent-teams-deltas.md` | `2d98f7e9173e1827` | `a1ea21c0bdcffcfb` |
| `packages/mpd-dsh-adapter-plugin/README.md` / `.zh-CN.md` | `420b4894cf4c632f` / `c41fa806e7586cd5` | `e233980a86198ba8` / `8b1c6681fffee826` |
| `packages/mpd-agent-teams-plugin/test/adapter-bypass-inventory.test.mjs` | `4d8fb3e3b0da2308` | `d40c230bee54b75b` |
| Unchanged since round 2 | `AGENTS.md` `d813c47c…`, contract `e4e0b3b2…`, `VENDOR_LOCK.json` `fc6f8aa3…`, lib bridge/registry/six files, adapter src `e3948553…` / dist `d8e8fa36…`, CLI `f0789ea0…`, skills `b32f12c7…`/`8da2a61b…` | same |

Decisive commands I ran MYSELF on this revision (logs under `logs/`):

- `node scripts/patch-agent-teams-fixes.mjs --check` → exit 0, `already applied: 151 … across 13`;
- `bun run verify:gates` → exit 0, `PASS - 5/5 member gate(s) green` (vendor, dist-fresh, rows-parity,
  docs-parity, preset-conformance), with the docs gate's own derived note:
  `carried **151**/13 vs derived 151/13 — agree`;
- `bun run test:qa` → exit 0, `[test:qa] all self-tests passed`;
- `bun test packages/mpd-agent-teams-plugin packages/mpd-dsh-adapter-plugin` → 461 pass / 0 fail /
  5758 expects, exit 0;
- `bun run typecheck` → exit 0;
- my independent closure census (`logs/closure-census.log`) and the t26-rule probe
  (`logs/scanner-probe-v3.log`).

## 1. AC-by-AC verdict (in-scope: AC1–AC13, AC15, AC16; AC14 carried by t10)

| AC | Verdict | Evidence on the settled revision |
|---|---|---|
| AC1 | **PASS** | my `bun run typecheck` exit 0 + the adapter surface test green in my package run (14 methods / 12 new flags); `src/index.ts` byte-identical to rounds 1–2 (`e3948553…`), where I read every method and the `capabilities()` body |
| AC2 | **PASS** | the `Object.is` arm of `adapter-agent-teams-surface.test.ts` green in my run; unchanged bytes |
| AC3 | **PASS** | `adapter-routing.test.mjs` green in my run (throwing raw ctx, `rawHits === []`, negative-control arm); the ten adopted lib files are byte-identical to round 2, so round 2's verdict stands as the standing evidence (`review/round2/verdict.md`, hashes in `round2/logs/reviewer-revision-hashes.txt`) |
| AC4 | **PASS** | `adapter-facade.test.mjs` green in my run; unchanged bytes |
| AC5 | **PASS** | `git status --porcelain` over `test/` + `self-fix-tests/` shows ONLY `??` entries (no ` M `); the package suite is green (461/0) |
| AC6 | **PASS** | `adapter-tool-parity.test.mjs` green in my run (21 definitions, registration order, canonical form, `Object.is`); unchanged bytes |
| AC7 | **PASS** | my `--check` exit 0 (151 regions / 13 files) this round; the six bridged files are byte-identical to round 2, whose hunk checker proved 36/36 hunks inside `mpd-delta` spans |
| AC8 | **PASS** | `self-fix-tests/mpd-owned-file-restore.test.mjs` green in my run; the CLI is byte-identical (`f0789ea0…`), so round 2's independent scratch-tree restore (loud `--check` by name with zero ENOENT, byte-faithful `--write`, non-mpd control never created) stands |
| AC9 | **PASS** | F2/F3 closed by artifacts (see §2); my `verify:gates` run shows `docs-parity PASS` with `pairs=38 failed=0 violations=0 dead=0` and the derived count agreeing 151/13 |
| AC10 | **PASS** | t8 attempt-7 fresh evidence (verdict PASSED for its lane): `ac10-bundle-lifecycle.log` (unmodified case PASS, exit 0, stamp `16-00-10.971Z`) + `ac10-11-instrumented-boots.log` (enabled arm 21/21, mounted witness ×1, fallback 0); the adopted bytes are unchanged since that run |
| AC11 | **PASS** | t8 attempt-7 disabled arm (adapter row 0, `absent=1 / pending=0 / mounted=0`, isolation asserted); unchanged bytes |
| AC12 | **PASS** | t8 attempt-7 `ac12-preset-conformance.log`: `--self-test` exit 0 and the REAL run `[preset-conformance] PASS` exit 0 (stamp `16-01-07.071Z`, auth + sessionCreate 200 + negativeControl); the skills files are unchanged since that run |
| AC13 | **PASS** | MY runs this round: `verify:gates` 5/5, `typecheck` 0, `test:qa` exit 0 (`all self-tests passed`), packages 461/0; plus t8's `bun test packages` 1152/0 and dist/docs/rows exit 0. The bare `bun test` spelling stays red on the 411 UNTRACKED+GITIGNORED scratch copies under `evidence/mpd-naming/wave2/raw/scratch/**`, which the captain ACCEPTED as an environment note (sanctioned scope `bun test packages`) — recorded, not a wave defect |
| AC14 | **CARRIED BY t10** | out of this review's scope by the captain's ruling (integration's acceptance item 1 IS AC14). No evidence exists yet and none can: t10 is blocked by this review. Not a finding |
| AC15 | **PASS** | the t26 scanner (`4d8fb3e3…`) is green in my run (6 tests), my probe confirms the round-2 gaps are closed (§2), and my census on the same bytes classifies 83 seam sites / 0 UNROUTED; the contract's AC15 row declares the scanner a bounded heuristic with the census as primary evidence |
| AC16 | **PASS** | my sandwich START == END over 50 s (16:20:04Z → 16:21:0xZ) with the hash table quoted at 16:18:53Z; the verification lane's fresh `result.json` (attempt 7) carries its own settled record — 24 files, `AGENTS.md` DRIFT detected and RE-ANCHORED, `start2 16:09:11Z == end 16:10:01Z`, docs gates re-run on the settled revision |

## 2. What I attacked this round (only what changed since round 2)

**(a) F2 closed by artifacts.** `docs/design.md` now reads "reaches every harness seam through this
adapter — except the counted `setup(childCtx, child)` residual that AGENTS.md §6 names (five lines in
`lib/members.js`, asserted line-by-line, because that host-handed scoped ctx is passed to a vendored
`_deps/dsh-agent` helper and a legacy Alpha.2 `childCtx` is not guaranteed to be `child.ctx`)", and
`docs/design.zh-CN.md` carries the same qualifier in the same change (hashes in §0). The optional
`agent-references/agent-teams-deltas.md` clause is qualified too — "The adopted plugin now reaches
every harness seam THROUGH `mpd-dsh-adapter` — except the ONE counted residual, the host-handed
`setup(childCtx, child)` scoped ctx…". The R5 count sentence's gate-pinned prefix is byte-unchanged
(`The live registry is **151** regions across **13** adopted files`), which the docs gate's derived
check confirms.

**(b) F3 closed by artifacts, all four spots + both lists.** `docs/design.md` ("each behind a
`capabilities()` flag (one flag may cover two methods; `subagentRuntime` reuses the existing
`subagents` flag)"), `docs/design.zh-CN.md` (same parenthetical in 简体中文), and the adapter README
pair ("Each method sits behind a `capabilities()` flag (one flag may cover two methods…)" /
每个方法都在一个 `capabilities()` 标志之后（一个标志可覆盖两个方法…）). Both README lists now
enumerate **14** flags in the SAME order, `commandsRegister` included — I re-derived the count from
the bridge's own `seam(name, flag)` call sites (toolsRegisterHost, subagents, subagentsProvider,
subagentsContinuable, subagentsInterrupt, llmListModels, llmResolveCallConfig, systemPromptSection,
agentScope, commandsRegister, agentTurnStart, agentTurnCancel, agentTurnSteer, agentTurnInject = 14,
with `subagentsProvider` shared by two methods), so the docs now match the code rather than a
convenient round number.

**(c) F5 closed by declaration + a real job.** t26's `t26-result.json` declares the unannounced
16:07:10Z scanner edit as its own (the t23 follow-up) and states that t26 now owns
`packages/mpd-agent-teams-plugin/test/**`. The exemption is not reverted; instead the new
`seam.captured-method-call` rule gives it a job, and the test's own arms prove the module-scoped
behaviour — `harness-compat.js` `prompt.call(runtime, …)` clean (D6/R2 policy) while `members.js`
`prompt.call(…)` and `legacy.call(…)` redden. My independent probe reproduces exactly that split.

**(d) F4 closed by rules, not by a declared bound** (the stronger option). My probe with the t26 rules
verbatim confirms the four round-2 gaps are CAUGHT: late assignment (`let a; a = ctx.agents;`) and
parenthesized receiver (`const a = (ctx).agents`) by the broadened `facade.alias`; `const g = ctx.get`
by `facade.get-extraction`; `const t = agent.ctx.tools;` by `scoped-ctx.extraction`; plus
`{ restrict } = agent.ctx.tools` by `scoped-ctx.destructure`. Negative controls stay clean: the
documented `ctx.get("mpdDsh")` idiom is a CALL not an extraction, `ctx.agents.get(sessionId)` is a
facade call, and a bare alias call is untouched.

**(e) Contract §8 clause vs the tree.** Unchanged since round 2 (`e4e0b3b2…`) and still exact: the
clause names `skills/dsh-qa/scripts/lib/credentials.mjs` + `skills/dsh-qa/scripts/agent-teams-dispatch.mjs`
as the ONE authorized exception, states the single `VENDOR_LOCK.json` re-pin landed in the same change,
and bounds any further edit. `git status` shows exactly those two skills files + the lock modified, and
`verify:vendor` is green inside my `verify:gates` run — plan and tree agree.

**Not re-litigated (round 2's standing evidence, cited with its hashes):** the closure census, the
parity chain and the delta-restore experiment all ran on lib bytes that are byte-identical today
(§0 table), so `review/round2/verdict.md` + `round2/logs/{closure-census.log,settle-sandwich.log,
reviewer-revision-hashes.txt}` remain the evidence; this round re-ran the census anyway (83/0) and
`--check` (exit 0) as a drift guard.

## 3. Non-blocking observations (no finding raised)

1. **Scanner residuals of the inherent class.** `const { tools } = agent.ctx` (destructuring the
   scoped ctx itself, as opposed to `agent.ctx.tools`) and a function-parameter alias
   (`function f(c) { const a = c.agents; … }`) are still invisible to the line-local rule set. No such
   line exists in `lib/` (targeted grep + the census: 0 unrouted), and AC15's declared bound covers
   precisely this class — the census is the primary evidence, the scanner the regression defence.
   Worth a rule only if a future edit introduces that shape.
2. **The count sentence's parenthetical moved with its numbers.** R5's pinned prefix is unchanged, but
   the same line's measurement note gained a new moment/clause (`plus a marker scan`) in this wave. The
   gate does not police that text and the sentence stays truthful; recorded so a reader comparing the
   line against HEAD sees the difference is intentional.

## 4. Why this is a pass

Every in-scope AC carries evidence re-measured or re-read on the settled bytes; the two round-2
artifact-level findings and the process finding are closed by artifacts I inspected rather than by the
lanes' prose; the changes that landed after round 2 survived a targeted adversarial pass; and the one
remaining structural item (AC14) is carried by the integration lane by explicit ruling. The wave's
product claims were never falsified in three review rounds, and the gates the contract names are green
on my own runs.

Artifacts of this round: `evidence/agent-teams/adapter-wiring/review/round3/verdict.md`,
`round3/result.json`, and `round3/logs/**` (my command logs, the census, the probe, the sandwich and
the hash table). No fix was applied by this read-only seat.
