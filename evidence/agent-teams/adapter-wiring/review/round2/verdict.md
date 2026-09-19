# t24 — Review verdict (round 2): AC-by-AC on the repaired revision

Seat: Reviewer (read-only; no fix applied). Task: t24 (review r2, reviewed task t23). Attempt 2,
attempt_id `ee7b886d-c5fd-435a-8249-18eea58f719b`. Frozen authority:
`evidence/agent-teams/adapter-wiring/requirements-contract.md` (sha256 `e4e0b3b24f7778c5…`, read
2026-09-19T16:06:07Z).

**VERDICT: needs_revision — 15 ACs PASS, AC14 UNPROVEN, no AC fails on its own substance.**
The single blocking item is AC14 (pack + closure), whose owner lane is the integration task t10 —
which the platform blocks on THIS review. The review therefore cannot certify it and, by its own
acceptance rule ("pass only when the latest revision on disk supports every AC"), cannot return
pass. Four low/medium findings are recorded; none of them falsifies a claim the wave makes about its
own product.

## 0. Revision judged (hash + UTC read moment)

My own hash read at **2026-09-19T16:06:07Z**; settle sandwich START/END 50 s apart **identical**
(`logs/settle-sandwich.log`), matching the 16:06:07Z read for every file EXCEPT the one movement
recorded below. My full table: `logs/reviewer-revision-hashes.txt`.

| Path | sha256 (first 16) | note |
|---|---|---|
| `packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js` | `01fd9125510885fb` | bridge, unchanged since the round-1 review |
| `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js` | `456a297b00e5225f` | 151 regions / 13 files |
| the six bridged adopted files | `3387c26e…`, `8e6249da…`, `22f5d3f7…`, `f4b7cb9b…`, `fcc3bb6b…`, `d470e24c…` | byte-identical to the round-1 read |
| `packages/mpd-dsh-adapter-plugin/src/index.ts` / `dist/index.js` | `e394855355116187` / `d8e8fa36cb214d04` | unchanged |
| `scripts/patch-agent-teams-fixes.mjs` | `f0789ea0cf35dadd` | unchanged |
| `AGENTS.md` | `d813c47c31e7497b` | **changed by t23** (F5/F6 fixes) |
| `docs/design.md` / `docs/design.zh-CN.md` | `5de54a3356997026` / `dfd17369c12ca9ae` | unchanged since round 1 |
| `agent-references/agent-teams-deltas.md` | `a1ea21c0bdcffcfb` | unchanged |
| `VENDOR_LOCK.json` | `fc6f8aa34771faba` | **the single re-pin landed** |
| `skills/dsh-qa/scripts/lib/credentials.mjs` / `agent-teams-dispatch.mjs` | `b32f12c7…` / `8da2a61b…` | the authorized exception pair |
| `packages/mpd-agent-teams-plugin/test/adapter-bypass-inventory.test.mjs` | `d40c230bee54b75b` | **MOVED during the review** (see F5) |

**Movement, recorded not hidden.** t23's scanner hash was `7898fd03526a36c0…` (my 16:06:07Z read).
At **16:07:10Z** the file became `d40c230bee54b75be5…`, adding a `LADDER_CAPTURES` exemption; the
settle sandwich (16:09–16:10Z) shows the new bytes stable. Nothing else moved in the wave's file set
during the window (verified by the same sandwich, and re-confirmed by my final re-read: the ONLY
difference from the 16:06:07Z table is that one file). The changed file is GREEN on the new bytes
(my re-run: 6 pass / 0 fail / 1712 expects, and the full two-package re-run 461 pass / 0 fail) and my
audit shows the exemption suppresses NOTHING today (`logs/ladder-captures-audit.log`) — but see F5:
it landed unannounced, owned by no open task. Separately, the verification lane's own attempt-7
`result.json` LANDED at 16:10Z while this review was running (verdict PASSED for its lane, with its
24-file set re-anchored 16:09:11Z → 16:10:01Z after it caught the t23 AGENTS.md edit); I read it and
folded it into the AC10–AC13/AC16 rows below.

Commands I ran myself on this revision (logs under `logs/`): `node scripts/patch-agent-teams-fixes.mjs
--check` (exit 0, `151 … across 13`), `bun test packages/mpd-agent-teams-plugin
packages/mpd-dsh-adapter-plugin` (first run 461 pass / 0 fail; re-run on the moved test file in
`logs/bun-test-both-packages-rerun.log`), `bun test …/adapter-bypass-inventory.test.mjs` (6 pass /
0 fail), `bun run verify:gates` (PASS 5/5, exit 0), `bun run typecheck` (exit 0), an independent
closure census (`logs/closure-census.log`), an adversarial probe of the hardened scanner
(`logs/scanner-probe-v2.log`), the LADDER_CAPTURES audit, and the settle sandwich.

I also READ (not merely cited) the verification lane's fresh attempt artifacts at
`evidence/agent-teams/adapter-wiring/verification/20260919T160002Z/`: `ac13-static-gates.log`,
`ac13-suite-gates.log`, `ac13-verify-gates.raw.log`, `ac12-preset-conformance.log`,
`ac10-bundle-lifecycle.log`, `ac10-11-instrumented-boots.log`, `ac-three-arm-and-bridge-tests.log`,
`v1-before-after.log`, `start.txt`, plus the captain's `bridge/round2-repair/item1-gates.log`.

## 1. AC-by-AC verdict table

| AC | Verdict | Evidence |
|---|---|---|
| AC1 | **PASS** | 14 methods with arities + 12 flags green in `packages/mpd-dsh-adapter-plugin/test/adapter-agent-teams-surface.test.ts` (my run); `bun run typecheck` exit 0 (`logs/typecheck.log`); `src/index.ts` unchanged from round 1, where I read every method and the `capabilities()` body |
| AC2 | **PASS** | the same test's `Object.is` arm against the real `tools.register` (green in my run); unchanged bytes |
| AC3 | **PASS** | `packages/mpd-agent-teams-plugin/test/adapter-routing.test.mjs` green (my run): apply + five installers + consumer paths against a throwing raw ctx, `rawHits === []`, with the negative-control arm |
| AC4 | **PASS** | `test/adapter-facade.test.mjs` green (my run): modal witness semantics, PENDING ≠ ABSENT, re-probe |
| AC5 | **PASS** | `git status --porcelain` over `test/` + `self-fix-tests/` shows ONLY `??` new files (no ` M `); package suite green |
| AC6 | **PASS** | `test/adapter-tool-parity.test.mjs` green: 21 definitions both lanes, order + canonical form + `Object.is` |
| AC7 | **PASS** | `--check` exit 0 (151/13); the six bridged files are byte-identical to my round-1 read, where the hunk checker proved 36/36 hunks inside `mpd-delta` spans (`round2/logs/` carries the round-1 checker output path; the bytes it judged are unchanged) |
| AC8 | **PASS** | my round-1 scratch-tree experiment (loud `--check` by name with zero ENOENT, byte-faithful `--write`, non-mpd control never created) on unchanged CLI bytes `f0789ea0…`; `mpd-owned-file-restore.test.mjs` green in my run |
| AC9 | **PASS** (2 low findings) | `verify:docs` PASS (`pairs=38 failed=0 violations=0 dead=0`) in my `verify:gates` run, derived count `carried **151**/13 vs derived 151/13`; AGENTS.md fixed by t23 (residual qualifier in §1 + §6, the three childCtx uses named, the precise flags wording). Findings F2/F3: the same two sentences remain unqualified in `docs/design.md` + `.zh-CN.md`, and the "its own flag" wording remains in four other spots |
| AC10 | **PASS** | t8 attempt-7 fresh artifacts: `ac10-bundle-lifecycle.log` (unmodified case PASS, exit 0, stamp `2026-09-19T16-00-10.971Z`) and `ac10-11-instrumented-boots.log` (enabled arm PASS, 21/21 tools, mounted witness ×1, fallback 0) |
| AC11 | **PASS** | the same fresh artifacts: disabled arm PASS, adapter row occurrences 0, `absent=1 / pending=0 / mounted=0`, isolation asserted |
| AC12 | **PASS** | `ac12-preset-conformance.log`: `--self-test` exit 0 AND the REAL run `[preset-conformance] PASS` exit 0 at stamp `2026-09-19T16-01-07.071Z` (auth, sessionCreate 200 `agentPreset: mpd`, bootLog signatures [], negativeControl firing) |
| AC13 | **PASS** (qualified) | my `verify:gates` PASS 5/5 (vendor, dist-fresh, rows, docs, preset-conformance); t8's `ac13-suite-gates.log` and its fresh `result.json`: `bun test packages` 1152 pass / 0 fail, `bun run typecheck` exit 0, dist-fresh/docs/rows exit 0, `bun run test:qa` exit 0 (`all self-tests passed`, also anchored by the captain's `bridge/round2-repair/item1-gates.log`). QUALIFICATION: the BARE `bun test` spelling exits 1 on 605 failures found under `evidence/mpd-naming/wave2/raw/scratch/**` — t8's fresh measurement shows those 411 `*.test.ts` files are UNTRACKED and GITIGNORED by design (`.gitignore` rule `evidence/**/raw/scratch/`), and the captain ACCEPTED it as an environment note with no code change; the sanctioned gate is `bun test packages` (the repo's own `test` script), which is green. I judge the wave's AC13 intent satisfied and record the bare spelling as a pre-existing environment note, not a wave defect |
| AC14 | **UNPROVEN** | no re-pack and no `verify-pack-closure` evidence exists; owner task t10 (integration) is blocked because the platform sequences it after THIS review. Finding F1 |
| AC15 | **PASS** | hardened scanner green on the moved bytes (6 pass / 0 fail); my independent census on the same bytes classifies **83** seam sites across 18 server files — 39 facade, 18 in-region, 24 bridge fallback, 2 counted childCtx — with **0 unrouted** (`logs/closure-census.log`); the contract's AC15 row now DECLARES the scanner a bounded heuristic. F4 records the remaining narrow gaps; F5 records the unannounced edit |
| AC16 | **PASS** | t8's fresh attempt-7 `result.json` (landed 16:10Z, verdict PASSED for its lane): 24 files, DRIFT detected on `AGENTS.md` (the t23 docs edit) and RE-ANCHORED, `start2 16:09:11Z == end 16:10:01Z` — IDENTICAL, with the docs gates re-run on the settled revision; my own independent sandwich on the same bytes is START == END over 50 s and identical to my 16:06:07Z read (`logs/settle-sandwich.log`), with my final re-read confirming the only movement is the scanner test recorded in §0 |

## 2. The ordered attacks (round 2)

**(a) Closure — no surviving raw harness-seam access.** NOT falsified. My census re-run on the
current bytes reports 0 unrouted sites; the only non-facade reaches remain the two counted
`childCtx.on(...)` subscriptions (members.js:383/:434) plus the vendored hand-off. No alias,
destructure, bracket, `Reflect.get`, dynamic-name or second-module spelling exists anywhere in
`lib/`.

**(b) The hardened scanner is real, not decorative.** I re-probed the t23 rules with my own synthetic
set (`logs/scanner-probe-v2.log`): the four shapes I demonstrated in round 1 are now CAUGHT
(`facade.alias`, `facade.destructure`, `facade.bracket`, `facade.reflect`), as are the second
bracket form and the subagents value-use. The childCtx skip is identity-based and the counted lines
are still scanned. Residual gaps remain (F4): a late assignment (`let a; a = ctx.agents;`), a
parenthesized receiver (`(ctx).agents`), a `ctx.get` extraction (`const g = ctx.get; g('agents')`), a
scoped-ctx member extraction (`const t = agent.ctx.tools;`) and function-parameter aliases still
evade — none exists in the tree, and the contract now declares the scanner a bounded heuristic whose
primary evidence is the census.

**(c) Parity.** NOT falsified (files unchanged since round 1; tests green in my re-run).

**(d) Delta restore.** NOT falsified (CLI bytes unchanged; `--check` exit 0; the round-1 scratch
experiment stands on the same sha256 `f0789ea0…`).

**Residuals R1–R5, judged as DECISIONS against the code (acceptance item 3):**
- **R1 TRUE.** `registerHostTool` resolves `tools` from the adapter's own ctx and calls
  `tools.register(definition)` there, so the registration belongs to the ADAPTER row's fiber — a
  plugin-only unload would not revoke it. Code matches the claim.
- **R2 TRUE.** `guardSubagentDelivery` resolves `runtime = subagentRuntimeOf(ctx)` and then reads and
  PATCHES that object (it captures `Object.getOwnPropertyDescriptor` for `followup`/`prompt`/
  `[HOST_PROMPT_QUEUE]`/`sendMessage` and restores them on teardown). Delivery policy is still in the
  plugin; the adapter owns resolution only.
- **R3 TRUE.** `lib/client.js` is untouched in the working tree and `scripts/patch-agent-teams-client.mjs`
  exists and is referenced by `scripts/build-mpd-client.mjs`, exactly as the residual states.
- **R4 TRUE.** `liveAgents()` returns `[]` on a missing/throwing registry, `liveAgent()` degrades the
  same way, and `onEvent` catches and returns `undefined` — the swallow-and-degrade the residual
  claims, versus the raw ctx's throw.
- **R5 TRUE.** The deltas count sentence is byte-identical to HEAD's wording (only `123/10` → `151/13`
  moved), the docs gate's fixed regex matches it, and `verify:docs`'s derived note agrees
  `151/13 == 151/13`. No divergence found in any of R1–R5.

**(e) Docs truthfulness.** Substantially TRUE now: AGENTS.md §1 and §6 were corrected by t23 and match
the code (five counted lines; the two raw subscriptions named; "one flag may cover two methods;
`subagentRuntime` reuses the existing `subagents` flag"). Residue in three other surfaces → F2/F3.

**(f) Verification evidence.** The fresh attempt exists with harness-side exit codes (NOT model prose)
for every command, and I read each log; its final `result.json` is still pending → F6.

## 3. Findings

**F1 — medium — AC14 has no evidence, and its owner lane is blocked BY this review (sequencing).**
`AC14` ("packed artifact refreshed and closure-proven") is owned by the integration task t10, which
the platform blocks on the review gate; no `pack-mpd`/`verify-pack-closure` run exists on this
revision. A review cannot certify an AC whose evidence can only be produced after it. Required fix
(captain's decision, ONE of): (a) AMEND this review's contract to scope review rounds to
AC1–AC13/AC15/AC16 and carry AC14 in t10's own acceptance (matches the profile's stage order
requirements → implementation → verification → review → integration), so a round-3 review can pass;
or (b) keep the strict reading and accept a round-3 review after t10 runs.

**F2 — low — two human-facing docs still carry the absolute closure sentence.**
`docs/design.md` ("the adopted `agent-teams` plugin … reaches every harness seam through this
adapter") and `docs/design.zh-CN.md` ("现在每个 Harness 接缝都经由本适配器") were NOT qualified by
t23, which fixed AGENTS.md §1/§6 only; `agent-references/agent-teams-deltas.md` carries the same
absolute clause in its wave paragraph. Each is followed by the pointer to AGENTS.md §6's residual
set, so a careful reader is routed — but the acceptance makes an overstating sentence a finding.
Required fix: qualify the two design sentences (EN + zh-CN in the same change) with the counted
`setup(childCtx, child)` residual, and optionally the deltas sentence.

**F3 — low — the flags wording was fixed in ONE of five places.**
AGENTS.md now says "each behind a `capabilities()` flag (one flag may cover two methods;
`subagentRuntime` reuses the existing `subagents` flag)", while `docs/design.md`,
`docs/design.zh-CN.md`, `packages/mpd-dsh-adapter-plugin/README.md` and `README.zh-CN.md` still say
each method carries "its own" flag. The README pair's 13-name flag list is ALSO incomplete: the
bridge gates `commands.register` on `commandsRegister` (a pre-existing flag), so the number of flags
the bridge actually branches on is **14** — the same correction t8's fresh result records
(`capability_flags_used_by_the_bridge = 14`). Required fix: reuse AGENTS.md's parenthetical in the
four remaining spots and add `commandsRegister` to the README pair's list.

**F4 — low — the hardened scanner keeps named narrow gaps.** Measured with the test's own rules
(`logs/scanner-probe-v2.log`): late assignment, parenthesized receiver, `ctx.get` extraction,
scoped-ctx member extraction (`const t = agent.ctx.tools;` then `t.restrict(...)`) and
function-parameter aliases evade. No instance exists in the tree (census: 0 unrouted) and AC15 now
declares the bound, so this is recorded, not blocking. Required fix (optional hardening): add a
`ctx.get` extraction rule and a `.ctx.<member>` extraction rule (not only the three call forms).

**F5 — medium — an UNANNOUNCED edit to the guarded scanner test landed during this review.**
`packages/mpd-agent-teams-plugin/test/adapter-bypass-inventory.test.mjs` changed at **16:07:10Z**
(`7898fd03526a36c0…` → `d40c230bee54b75b…`), adding the `LADDER_CAPTURES` exemption. No task open at
that moment owns that path (t23 completed ~16:04Z; t24 is this read-only review; t8's declared scope
is `evidence/**`), and the change was not announced. My audit shows it suppresses NOTHING on the
current bytes (`logs/ladder-captures-audit.log`) — so it is neither a fix nor a proven necessity —
while it DOES widen the harness-compat.js exemption to five receiver names for every rule.
Required fix: declare the edit's owning task/author (and, if it came from the verification lane, note
that its inScope did not cover the path), or revert it and land it with a task that owns the file;
if kept, add a falsifiability arm for the `prompt.call(runtime, …)` shape it anticipates.

**F6 — RESOLVED inside the review window — t8 landed its fresh `result.json`.**
At my first read (16:10Z) the attempt-7 directory held the logs and `start.txt` but no `result.json`,
so AC16's named anchor still resolved to the OLD pre-re-pin FAILED verdict. The file landed while this
review was running (9419 bytes, mtime 16:10Z, verdict PASSED for the verification lane) with the
24-file DRIFT→RE-ANCHOR record (`AC16_settled_hashes.RE_ANCHORED`: 16:09:11Z == 16:10:01Z) and the
docs gates re-run on the settled revision — so AC16's anchor now points at fresh, settled evidence.
No action remains; recorded so a reader can see the evidence arrived late rather than never.

## 4. What unblocks the wave

1. Resolve F1 (one contract amendment, or a round-3 review after t10) — the ONLY blocking item.
2. Fold F2/F3 into one small docs repair (design EN + zh-CN + the two adapter READMEs, one commit).
3. Declare or revert the F5 edit (F6 already resolved itself: t8's fresh `result.json` landed).
4. Then t10 integration produces AC14's evidence (T-91: freshness read from the `expected-after-pack`
   list, never from the exit code) and the wave can close.

No fix was applied by this read-only seat; every write of mine is confined to
`evidence/agent-teams/adapter-wiring/review/round2/**`.
