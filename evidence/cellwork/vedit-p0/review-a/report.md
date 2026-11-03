# Review A — lane A: the cellwork compaction engine, the live-parent reseed, the split warnings and the activation notice

**Loop:** `loop-20261103T034211-67e4f3` (task T2)<br>
**Board row:** T4 — Review A<br>
**Writer judged:** `se-cellwork` (session `b45e8eae-6f68-400d-aaaf-697dd8e76995`), `writer_reason: "member: se-cellwork"`<br>
**Contract:** `.mpd/plans/cellwork-vedit-p0-fix-r2.md` (revision 2, frozen)<br>
**Tree judged:** HEAD `d2032bf3` + both code lanes' working tree + the integration lane's derived `dist/` rebuild<br>
**Verdict: PASS** — risk level **LOW** (five Nits, no Blocker/High/Medium).

## 1. Assessment

Lane A does what the frozen contract asks, and it does it on evidence rather than on prose. All four
items reproduce RED on `d2032bf3` and are green afterwards: the `agent/turn-stopping` listener now
returns a promise (arm `D1/C6(a)` asserts `toBeInstanceOf(Promise)`, and the red log shows the old
`undefined`), the engine comes from the live handle with the registry empty (arm `D1/C6(b,c,d)`:
`engine.calls.length === 1`, `calls[0].agent === member`, directive `PROMOTED`, `reseeds.length === 0`,
no `fenced` key on the stored row), the reseed parent is the live parent object then the captain then
`reseed-parent-unavailable` (arms `C6(e)`, `C6(f)`, `C6(g)`, each asserting object identity and the
journal row), and `deps.agent` is never the parent (arm `C6(e)` asserts `reseeds[0].parent` **is**
`harness.parent` and **not** the member). The registry double really enforces the host's condition
(`if (request.parent === undefined || registry.get(request.parent.id) !== request.parent) throw …"UNAUTHORIZED…"`),
so the old fence is reproduced rather than described. The R2 bookkeeping holds exactly: four deleted
lines in the test tree, all four named in the lane report and each verified in the diff, and the kept
task's frozen contract bytes are asserted unchanged on the re-split (`readFileSync(path,"utf8")).toBe(contractBefore)`).
Gates on the settled tree are green (`tests` 3450/0, `typecheck` exit 0, `comments` exit 0), the write
scope is respected to the file, no `mpd-gates.json` is anywhere in the checkout, and the one black-box
probe I ran confirms the shipped `cellwork_send` description discloses the bound, its config key and
both recovery paths. What I cannot do from documents is prove two of C1's *ordering* clauses with a
discriminating arm, and two disclosure/assertion details rest on prose rather than on a test — five
Nits below, none of which changes a user-visible outcome.

## 2. The contract criteria, one by one

| # | criterion | verdict | evidence |
|---|---|---|---|
| a | red-first on HEAD `d2032bf3`, the log shows the failure | **PASS** | `lane-a/red-first/*.log`: six headers `# RED-FIRST on HEAD d2032bf3 — <UTC>` + command; `d1` 0 pass/8 fail, `c1` 0/3, `d3-split-warnings` 0/4, `d3-split-render` 0/1, `d4-activate-notice` 0/1, `c3-mail-bound` 1/2 (the pass is the absent-key control, stated in the log). Failure texts are the defect itself: `Expected constructor: [Function: Promise] / Received value: undefined`; `expect(engine.calls.length).toBe(1) / Received: 0`; `verdict.warnings` undefined; `resplit.notice` undefined; `compactionEngineForLiveAgent` not a function |
| b | engine resolved from the LIVE handle before any sleep; `compactNow` on attempt 1 | **PASS, bounded** (Nit N1, N2) | `barrier-live-engine.test.ts :: D1/C6(b,c,d)` drives the handle's engine with the registry empty; `barrier-live-engine.test.ts :: "C1: no sleep happens before the FIRST attempt"` configures `idleBarrierDelayMs: 1500` and requires the first drive `< 500 ms` with `calls.length === 1` |
| c | the listener returns an awaitable so the serial dispatch waits | **PASS** | `barrier-live-engine.test.ts :: D1/C6(a)` — `expect(returned).toBeInstanceOf(Promise)`, then `await returned`, then the engine was driven once |
| d | a compacted member is promoted and not fenced | **PASS** | `barrier-live-engine.test.ts :: D1/C6(b,c,d)` — mode `subcaptain`, `handoffReady:false`, `"fenced" in stored === false`, journal `compaction/outcome:"promoted"`, no `checkpoint-unrecoverable` row, one directive containing `PROMOTED`, zero reseeds |
| e | reseed parent order member-parent → captain → `reseed-parent-unavailable`, never `deps.agent` | **PASS** | `C6(e)` (`parent` identity is the live object; `not.toBe(member)`), `C6(f)` (captain used, journal `reseed-parent` with `parentSource:"captain"`, both ids), `C6(g)` (no child raised, reason contains `reseed-parent-unavailable` **and** the engine classification `no-safe-range`, and does **not** contain `UNAUTHORIZED`); host-throw sentence appended (`C2` arm) |
| f | the three-value union is unchanged | **PASS, bounded** | contract R5 + lane report (`promoted \| reseeded \| refused`); every `outcome` value asserted anywhere in `packages/mpd-cellwork-plugin/test/**` is one of those three (3× `reseeded`, 1× `promoted`, 2× `refused`) and no fourth value appears; the type declaration itself was not read (bound §6) |
| g | the split warnings channel is non-fatal and rendered | **PASS** | `split-scope-warnings.test.ts` (accepted stays true, `findings` empty, `warnings[0].code === "write-scopes-empty"` by key for `work`/`repair`/`integration`, none for `review`, empty graph → no warning; contract doc carries the recovery "BEFORE the first write") + `flow.test.ts :: D3/C4` renders `cellwork_split` and finds "no path" in the model-visible text |
| h | the activation notice is present and the kept contract bytes did not change | **PASS** | `flow.test.ts :: D4/C5` — initial activation has no notice; the re-split carries "2 kept", "NOT rewritten", "re-freeze", "new verify loop", the stage-4 exception ("loop"/"rebuilt") and "dispatched"; `readFileSync(keptContractPath,"utf8")).toBe(contractBefore)`; and `renderText(harness,"cellwork_activate",resplit)` contains "2 kept" |
| i | no test was weakened | **PASS** | `git diff --numstat`: `flow.test.ts` 96+/3−, `cross-package-coupling-inventory.test.ts` 6+/1− — exactly the four replaced lines R2 names and nothing else; the B8 arm keeps `expect(reseeded.outcome).toBe("reseeded")` and `expect(interrupted).toBe(true)`; the coupling inventory keeps ONE import line from the same module (count unchanged); three `dsh:` literals gained the two new `Pick` members (required by the type, no assertion moved); every new test file is one the report names |
| j | write scope respected | **PASS** | `git status --porcelain`: lane A touched only `packages/mpd-cellwork-plugin/{src,test}` and `packages/mpd-dsh-adapter-plugin/{src,test}`; the four new test files are inside those packages; the `mpd-team-core-plugin` rows belong to lane B; `evidence/cellwork/vedit-p0/lane-a/**` only |
| k | no `mpd-gates.json` left in the checkout | **PASS** | `find . -name mpd-gates.json -not -path './node_modules/*'` → nothing, checked before the review and again after every gate run |
| l | declarations/comments/typed functions per `verify:comments` | **PASS** | my own gate run `ev-20261103T040524-5948df`: `bun run verify:comments` exit 0, 591/591 files, 51 772 declarations inspected |

Additional disclosure check, black-box (not a contract row but the C3/C4 disclosure intent):
`probe-descriptions.log` prints the registered `cellwork_send` description and it carries the
`mail.maxUndelivered` key, the default 8, the shared-with-`agent_teams_mail` sentence and both
recoveries (`cellwork_inbox`, `reassign`).

## 3. Gate evidence (this seat, this tree)

| gate | evidence id | observed |
|---|---|---|
| `tests` | `ev-20261103T040724-96b7de` | `bun test packages` → **3450 pass, 6 skip, 0 fail**, 229 files, 33.89 s, exit 0 |
| `typecheck` | `ev-20261103T040517-ea365e` | `bun run typecheck` → `tsgo --noEmit`, exit 0 |
| `comments` | `ev-20261103T040524-5948df` | `bun run verify:comments` exit 0 |

**Pre-rebuild trace, NOT scored against lane A:** my first `tests` run
(`ev-20261103T040348-6368dd`) exited 1 with **exactly two** failures, both the T-62 byte-identity arms
(`(fail) F1 shipped artifact > the committed dists are the byte-identical products of a canonical build`
and its singular twin). Cause: the adapter edit inlines into its dependents and their committed `dist/`
was stale — `packages/*/dist/**` is the integration lane's declared scope (contract §3, §6), and the
captain rebuilt 34/34 targets with the pinned toolchain afterwards. No other test failed in that run,
so no lane-A arm was ever red on the settled source.

## 4. Findings (ranked; no Blocker, no High, no Medium)

**N1 — Nit — C1's "before any registry-by-id lookup" is not discriminated by an arm.**
Where: `packages/mpd-cellwork-plugin/test/barrier-live-engine.test.ts` :: `D1/C6(b,c,d)` and
`"C1: the registry lookup is the FALLBACK…"`.
What: the first arm runs with `detached: true` (the registry misses) and the second with the live-handle
seam absent, and in both the registry's engine and the handle's engine are the SAME object. A
`registry-first-then-handle` implementation would pass both.
Why it matters: C1 freezes an order (live handle first) so a recycled session id can never serve a
previous incarnation's engine; the suite verifies *reachability*, not *priority*, so the clause rests on
code review alone.
Direction: add one arm whose harness keeps the member in the registry while the registry answers a
DIFFERENT engine from `agent.ctx.get("compaction")`, and assert the handle's engine is the one driven.

**N2 — Nit — the "no sleep" arm cannot catch the sleep that was actually measured.**
Where: `packages/mpd-cellwork-plugin/test/barrier-live-engine.test.ts` :: `"C1: no sleep happens before
the FIRST attempt"`.
What: it configures `idleBarrierDelayMs: 1500` and bounds the first drive at `< 500 ms`; the D1
observation this contract removes was a **200 ms** sleep, which would pass that bound.
Why it matters: the clause is "no sleep before the FIRST attempt", and the arm proves only "no sleep of
the *configured* barrier delay".
Direction: assert on order, not duration — e.g. have the fake engine record a monotonic sequence and
assert the drive precedes any retry/delay seam call, or inject a clock.

**N3 — Nit — C4's "tool descriptions state the warning rule" is pinned by no arm.**
Where: `packages/mpd-cellwork-plugin/test/flow.test.ts` (D3/C4 arm renders the result) and
`packages/mpd-cellwork-plugin/test/mail-bound-config.test.ts` (which DOES pin `cellwork_send`'s
description).
What: every other description obligation in this wave has an assertion; the `cellwork_split`
description's warning rule does not. My probe captured `cellwork_split` as **not registered** by
`installCellworkProtocol` (it is registered by the flow plugin's `apply`), so I could not confirm it
black-box without rebuilding the full flow harness.
Why it matters: the description is the only place a model learns the rule exists; C4 names it explicitly.
Direction: one 3-line arm in `flow.test.ts` reading the captured `cellwork_split` description, in the
shape `mail-bound-config.test.ts` already uses.

**N4 — Nit — the promoted arm never asserts "no interrupt".**
Where: `packages/mpd-cellwork-plugin/test/barrier-live-engine.test.ts` :: `D1/C6(b,c,d)`.
What: C1 says a compacted answer takes the promoted path with "no interrupt, no reseed"; the arm asserts
`reseeds.length === 0` and the directive, but never `harness.interrupts.length === 0`, although the
harness collects interrupts.
Why it matters: an interrupt in the promoted path would kill the member the arm is proving stays live.
Direction: one assertion.

**N5 — Nit — one red-first header repeats the hash.**
Where: `evidence/cellwork/vedit-p0/lane-a/red-first/d1-barrier-red.log` line 1:
`# RED-FIRST on HEAD d2032bf3 — d2032bf3 — 2026-11-03T03:49:45Z`.
What: the lane report says every red log carries `# RED-FIRST on HEAD d2032bf3 — <UTC>`; the other five
logs do, this one duplicates the hash in the instant slot.
Why it matters: cosmetic only — the timestamp is still present, so the standardisation claim is
*almost* true rather than true.
Direction: fix the header string (and keep the report's template as the source of it).

## 5. Declined to judge (nothing disappears silently)

- **Promoted member's persisted `mode` becomes `subcaptain`** (`barrier-live-engine.test.ts` D1/C6(b,c,d), `expect(stored.mode).toBe("subcaptain")`) — DECLINED as a finding: HEAD already asserts the same mode for a reseeded member (`dispatch-fenced.test.ts`), so the value is pre-existing and the frozen contract does not speak about modes. I could not determine from documents alone whether that mode keeps the member's file tools, because the guard's seat derivation is implementation; **recommended follow-up** (one confirmation, not a repair): show that a promoted member still has its write tools, since C1's intent is "the member stays live" and works.
- **C3's shared store, ack/delivery slot accounting, retired-team and legacy-row counting** — lane B's half by contract §3; not judged here.
- **C4's `agent_teams_plan create_task` warning + output-schema entry** — lane B's half; not judged here.
- **`dist/**` rebuild, `preset-conformance` on a real mount, `verify-dist-fresh`, Docker lane** — integration lane by contract §3/§6 and §5 (PASS scope here is the code lane). The pre-rebuild red `tests` row is integration debt, not a lane-A defect (see §3).
- **README wording for the new seam/behaviour** — docs lane T6 owns `packages/*/README*.md`; lane A left the READMEs untouched, which is correct for its scope. Note for T6: `packages/mpd-dsh-adapter-plugin/README.md` names no compaction seam at all today, so `compactionEngineForLiveAgent` needs a row there.
- **"A returned promise is awaited by the host's serial dispatch"** — rests on the vendored cordis `serial` implementation and the repository note, exactly as contract §8 declares; no live host boot was run. Declared bound, not a finding.
- **The older VEdit observations (mail reach for later-added members, the 8-child cap on the reassign path, reassign-vs-open-blocker, raise failure without a seat)** — R1 makes them REPORT-ONLY; lane A reported three LIVE and one PARTLY LIVE with symbols. Not scored as defects; whether they become tasks is the captain's call.
- **Red-first provenance** — the six logs are self-attested ("on HEAD d2032bf3"); the shipped red text is consistent with the pre-fix code paths (undefined return, zero engine calls, absent `warnings`/`notice`). I could not re-create the red state myself without reverting the lanes' source, which is a git write and the captain's alone. Stated as a bound, not a contradiction.
- **`mail.maxUndelivered`'s value semantics** (the resolver's clamp/default/0 behaviour) — lane B's one implementation; lane A proves only the call-site wiring and the `0` edge.

## 6. Bounds of this review

- I read **no implementation**: no file under `packages/*/src/**`. My inputs were the frozen contract,
  the cellwork and adapter package READMEs, `AGENTS.md` (its §4 gate table and §5 verification law), the
  lane's report and logs, and the **tests** (allowed by the seat brief). Behaviour I did observe was
  black-box: `bun test packages`, the three gate commands, and one probe that imported the plugin to
  capture a registered tool description — its log only (`probe-descriptions.log`) is kept; the script
  lived under `mktemp -d` and was deleted.
- I did not run a real host boot, a live LLM checkpoint, `preset-conformance` on a mount, `verify-dist-fresh`,
  the Docker lane, `verify:docs`, or the bilingual doc pair check.
- The `PromotionResult` union (criterion f) is judged from the contract, the lane report and the three
  outcome values the tests use; the type declaration was not read. A strict type-level assertion remains
  a post-verdict diagnosis item, not something this seat observed.
- I did not re-run the red-first state (needs a source revert = a git write).
- The tree I judged is pinned by hash in §7; the derived `dist/**` changed after my first gate run and
  before the green one, by the integration lane, and that is the only change.

## 7. The tree, by hash

`scope-start.sha256` lists the 12 lane-A source/test files as judged; `scope-end.sha256` is the same file
rewritten after the verdict was recorded, and `diff` between the two is empty (see `hash-sandwich.log`).
HEAD is `d2032bf3`; `mpd-gates.json` is absent before and after; `git status --porcelain` shows lane A's
12 paths (8 modified + 4 new test files) and lane B's 5 (4 modified + 1 new), plus the integration
lane's 24 `dist/` files.
