# PR #110 blind-review FAIL #2 — the fifth state no longer takes a TERMINAL record (H1-2/M1/N-a/N-b/N-c)

- Repo: `/home/haroldzhao/MyProj/DshProj/My-Power-Dsh`
- Branch: `fix/cellwork-activate-mint` (PR #110), HEAD `76254694`
- Verdict repaired: `rec-20261111T144302-711f96` (second blind **FAIL**; M2/N1/N2/N3-carry passed,
  **H1** was not closed — a readable TERMINAL recorded team was still reachable through the fifth state)
- Worktree before the wave: clean apart from pre-existing untracked `evidence/**` directories. After the
  wave: 10 modified files (`git-status.txt` / `changes.diff`); the three previous evidence rounds are NOT
  rewritten.
- **No git write was performed** (no add/commit/branch/checkout/reset/tag/stash). Only read-only
  `status`/`log`/`diff`/`show`/`archive` were used.
- **No `skills/**` file was touched and no vendor re-pin was run**: `skills` stays 393 files /
  `2997619a891615643e81f91ae051f99f79f23053fae6fdc45165a3904baad3de` (`after/verify-vendor.log`).
- `AGENTS.md`, `agent-references/**`, `VENDOR_LOCK.json` and the version carriers are untouched.

## Verdict table

| id | severity | landing | verdict |
|---|---|---|---|
| H1-2 | High | the fifth state is gated on "recorded record unreadable OR not terminal"; a readable terminal record is REFUSED by name | PASS (flow-level arm + fail-before red at the append attempt) |
| M1 | Medium (evidence gap) | `after.mintedTeamId === ""` asserted on MINT success and on BOTH retry successes | PASS (3 assertions; green on HEAD too — coverage gap, not behaviour) |
| N-a | Normal | fail-before support for "the retry mints team-3 / appends to the dead board" produced by two pre-repair probes; the claim is restated to exactly what the probes show | PASS |
| N-b | Normal | `mintedTeamId` added to the `state.json` field list; the terminal-minted retry bound added to "Declared bounds" (EN+zh) and to the resolver's step-0 comment | PASS |
| N-c | Normal | the `teamRecordPath` import is re-classified from §4 class 3 (shared PURE module) to a FROZEN DOWNGRADED EXCEPTION: `team-store` is an I/O module | PASS (inventory unchanged, self-test 14/14) |

## H1-2 — a readable terminal recorded team is refused, never a landing target

### The defect, restated

`resolveCellTeam` already refuses a terminal recorded record (returns `teamId:""`, `resolution:"none"`),
which is EXACTLY the shape `activate.ts#materializeSplit` read as "nothing resolved". Its `unverified`
branch then fell back to `cell.teamId` — the same terminal id the resolver had just rejected — and the
re-split appended to the dead board. The `boardNote` simultaneously said "continues on the RECORDED
team" and carried the resolver's "never a landing target" sentence.

### Landing points (file:line)

- `packages/mpd-cellwork-plugin/src/state.ts:706` — `CellTeamResolution.recordedTerminal: boolean`: the
  resolver now SAYS whether the recorded id is readable-and-terminal (`:816` computes it,
  `:915` returns it). False for an unreadable record — that is the case the fallback exists for.
- `packages/mpd-cellwork-plugin/src/activate.ts:615` — `fallbackToRecorded` is the documented fifth
  state's precondition (no resolver evidence + a recorded id).
- `packages/mpd-cellwork-plugin/src/activate.ts:621` — `terminalRecorded`; `:622-627` REFUSES before any
  write, naming the team id, the terminal evidence, "never a landing target", "wrote nothing", and the
  recovery (`cellwork_stop` + `/cellwork`).
- `packages/mpd-cellwork-plugin/src/activate.ts:629` — `unverified` now also requires
  `resolved.recordedTerminal !== true`; `:630-632` records that the two note statements are mutually
  exclusive (a `boardNote` only exists when the resolver did NOT prove the record terminal).
- `packages/mpd-cellwork-plugin/src/state.ts:776-779` — step 0 (the explicit minted id) keeps its own
  authority; the newly documented bound (N-b) sits beside it.

### New arms (seed + assertions)

`packages/mpd-cellwork-plugin/test/activate-resume.test.ts:1279` — **H1-2 flow-level refusal arm**
(through the `cellwork_activate` TOOL, not the resolver and not a direct `materializeSplit` call):

- Seed: the harness starts a cell, finalizes requirements, submits the 4-task split, and ACTIVATES
  revision 1 on the still-live planning team (`teamId = team-1`). The recorded team is then made
  READABLE + TERMINAL (`phase:"ended"`, `endedAt`), the requirements move on (`update`), and revision 2
  is submitted and accepted.
- Asserts, in this order:
  1. `teamWriteCalls(harness)` is unchanged — NO `agent_teams_plan {add_member|create_task}` was even
     attempted (this is the assertion the pre-repair build reds on: 12 vs 11).
  2. the call is refused (`ok:false`) and the sentence names `"team-1"`, `"TERMINAL"`,
     `"never a landing target"` and `"REFUSES"`;
  3. the terminal record is `JSON.stringify` BYTE-IDENTICAL and its row count unchanged;
  4. no `create` was spent, the cell record still names `team-1`, `activatedRevision` is still 1,
     `activationInFlight` is null and the phase is still `executing`;
  5. the journal has no `activate` row for revision 2 and no `cell-activation-partial` row.
- `packages/mpd-cellwork-plugin/test/activate-resume.test.ts:1339` — **negative control**: the SAME
  re-split with the recorded team present on disk but UNREADABLE (`teams.get` answers `undefined`) still
  takes the documented fifth state: `ok:true`, `revision:2`, `boardNote` contains `UNVERIFIED` and
  `team-1`, the board really grew, the journal carries `boardResolution:"unverified"` and
  `mintedTeamId` stays `""`. Behaviour unchanged.
- `packages/mpd-cellwork-plugin/test/resolve-cell-team.test.ts:69` — the resolver exposes
  `recordedTerminal:true` on the terminal arm, `false` on the unreadable arm (`:82`, new) and `false` on
  the live control (`:136`).

### Fail-before (source extracted with `git archive 76254694`; the fixed tests copied in)

`fail-before/h1-2-flow-terminal.log` — the flow arm REDS on HEAD at exactly the behavioural assertion:

```
expect(teamWriteCalls(harness)).toBe(writesBefore)
Expected: 11
Received: 12
(fail) H1-2: a re-split onto a READABLE TERMINAL recorded team is refused by name and appends nothing
(pass) H1-2 NEGATIVE CONTROL: an UNREADABLE recorded team still takes the documented fifth state
```

So on HEAD the fifth state DID attempt an append against the ended board; the control was already green.

`fail-before/h1-2-resolver-field.log` — the three resolver arms red on HEAD at the NEW FIELD
(`recordedTerminal` undefined), which is expected: the field does not exist there. This is the
compile-level red; the behavioural red is the flow arm above.

Fixed-tree run of the six touched arms: `after/new-arms-filtered.log` — 6 pass / 0 fail
(`MINT`, `MINT NEGATIVE CONTROL`, `MINT RETRY A`, `MINT RETRY B`, `H1-2`, `H1-2 NEGATIVE CONTROL`).

## M1 — the successful clearing of `mintedTeamId` is now asserted

- `activate-resume.test.ts:1090` (MINT success), `:1227` (MINT RETRY A success) and `:1272`
  (MINT RETRY B success): `expect(after.mintedTeamId).toBe("")`.
- Why it matters: resolver step 0 returns `mintedTeamId` on its own authority EVEN WHEN that team reads
  terminal, so a marker left behind after success would make a LATER re-split land on the ended
  execution team. With the field empty, step 0's `minted !== ""` gate is inert.
- `packages/mpd-cellwork-plugin/src/flow.ts:1265` already writes `mintedTeamId: ""` on success; the
  shipping code needed no change. `fail-before/m1-mint-arms-on-head.log` shows the four MINT/retry arms
  (with the new assertions) are GREEN on HEAD: M1 is a COVERAGE gap, not a behavioural one — stated
  rather than claimed as a fix.

## N-a — the round-3 sentence now has probe support

The round-3 README says: "On HEAD the retry mints `team-3` / appends to the dead board." Its fail-before
log reds at `expect(failed.mintedTeamId).toBe("team-2")` because bun stops at the first failure — the
behavioural assertions were never reached, so that sentence was not supported. The file cannot be
rewritten without breaking the blind record that cites its sha256
(`rec-20261111T144302-711f96` → `f0a1cafc8e83b8f13ec8ce98d82738f8cc9ec3bfea8015d51cef54a00988ea11`,
verified against the file), so this round produces the missing support on the SAME pre-repair source
(`git archive 4affc62d`) with probes that assert ONLY behaviour:

- `fail-before/na-probe-mint-on-4affc62d.log` (**pass**, 10 expects) — `fail-before/probes/na-probe-mint-test.fragment.ts`.
  Seed: the arm-A flow (ended planning board; first LIVE member append fails after the mint). Asserts:
  first pass `create` = staging + 1; retry succeeds with `create` = staging + **2**, `teamRecords.size`
  = **3** and `team-3` EXISTS; the dead planning board is untouched. That is literally "the retry mints
  team-3".
- `fail-before/na-probe-resolver-on-4affc62d.log` (**pass**) — `fail-before/probes/na-probe-resolver.test.ts`.
  Seed: the arm-B cell slice (`teamId:"team-1"`, `activatedTasks:{auth-core:"T1"}`) against an ENDED
  `team-1` whose staging row is `T1`. Asserts the pre-repair resolver answers `teamId:"team-1"`,
  `resolution:"state.teamId"` — the ended board IS the retry's target ("appends to the dead board" as
  the append TARGET; the package harness does not route writes by team id, so the write itself is a
  bound, stated below).
- **Falsifiability controls**: the same two probes run against a tree with THIS round's `activate.ts` +
  `state.ts` pasted in are RED — `fail-before/na-probe-mint-fixed-negative-control.log`
  (`Expected: 3 / Received: 2`) and `fail-before/na-probe-resolver-fixed-negative-control.log`
  (`Expected: "team-1" / Received: ""`). The probes measure the defect, not a constant.
- Precise restatement, for the record: on `4affc62d` arm A's retry MINTS team-3, and arm B's retry
  RESOLVES the ended recorded board (`team-1`) as its append target. "On HEAD the retry mints team-3 /
  appends to the dead board" is accurate only in that expanded form.

## N-b — the field list and the bound

- `docs/cellwork.md` ("State on disk") + `docs/cellwork.zh-CN.md`: `state.json`'s field list now names
  `mintedTeamId` (the execution team a FAILED activation minted; cleared to `""` on success).
- `docs/cellwork.md` ("Declared bounds") + zh: new bullet "A terminal-MINTED retry is accepted by step 0
  and then fails at the board" — it stays resumable but cannot succeed until an operator intervenes; no
  arm exercises it.
- `packages/mpd-cellwork-plugin/src/state.ts:776-779`: the same bound as a `DECLARED BOUND` paragraph
  on resolver step 0.

## N-c — `teamRecordPath` is not class 3

`packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts:364-374`: the entry is now
described as **frozen downgraded exception**, explicitly NOT class 3 (class 3 is a shared PURE module;
`team-store` performs filesystem I/O) and NOT class 4 (the import is a runtime value). `docs/independence.md`
§4 + zh carry the same paragraph, naming the reason the edge stays (one definition of the path and its
sanitizer; the M2 "exists but unreadable" refusal names that exact path) and noting that the inventory
freezes it so it cannot grow. The inventory entries themselves are unchanged; `after/coupling-gate.log`:
2 pass + `SELF-TEST: PASS (14/14 checks)`.

## Docs (requirement 3)

- `docs/cellwork.md` / `docs/cellwork.zh-CN.md`, "The fifth state": the precondition is stated as
  "only when the recorded team cannot be read or is not terminal", followed by a dedicated paragraph
  "A READABLE but TERMINAL recorded team is REFUSED, never a landing target" (names the id, writes
  nothing, recovery `cellwork_stop` + `/cellwork`, and why the two sentences cannot both print).
- "State on disk" and "Declared bounds" as in N-b.
- `docs/independence.md` / zh: the N-c declared exception.

## Gates (observed, final tree)

| gate | command | result |
|---|---|---|
| typecheck | `bun run typecheck` (`tsgo --noEmit`) | **exit 0** (`after/typecheck.log`) |
| comments | `node scripts/verify-comment-coverage.ts` | **exit 0**, `VERDICT: PASS` (`after/verify-comments.log`) |
| docs | `node scripts/verify-docs-parity.ts` | **exit 0**, `pairs=59 failed=0 violations=0 … PASS` (`after/verify-docs.log`) |
| cellwork package | `.toolchain/node_modules/.bin/bun test packages/mpd-cellwork-plugin` | **exit 0**, 436 pass / 0 fail, 35 files (`after/cellwork-package.log`) |
| all packages | `.toolchain/node_modules/.bin/bun test packages` | **exit 0**, 4069 pass / 6 skip / 0 fail, 262 files (`after/bun-test-packages.log`) |
| QA self-tests | `bun run test:qa` | **exit 0**, `[test:qa] all self-tests passed` (`after/test-qa.log`) |
| dist freshness | pinned `.toolchain` bun 1.4.0 rebuild + `node scripts/verify-dist-fresh.ts` | **exit 0**, `34/34 targets fresh` (each rebuilt twice, byte-identical) (`after/verify-dist-fresh.log`) |
| vendor | `node scripts/verify-vendor.ts` | **exit 0**, `PASS - 8 shipped asset(s)`; `skills` 393 files, lock unchanged (`after/verify-vendor.log`) |
| coupling inventory | `.toolchain/.../bun test packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` | **exit 0**, 2 pass + `SELF-TEST: PASS (14/14 checks)` (`after/coupling-gate.log`) |

The `cellwork` dist was rebuilt with the PINNED toolchain
(`.toolchain/node_modules/.bin/bun build packages/mpd-cellwork-plugin/src/index.ts --target node --format
esm --outfile packages/mpd-cellwork-plugin/dist/index.js`, bun 1.4.0).

## Reproducing the fail-before runs

The two pre-repair trees were extracted READ-ONLY (`git archive`) into gitignored runtime state, then the
fixed test files were copied in. Trees are disposable; the logs and probe sources here are the artifacts.

```sh
mkdir -p .mpd/tmp/activate-mint-w4/{head-76254694,base-4affc62d}
git archive 76254694 | tar -x -C .mpd/tmp/activate-mint-w4/head-76254694   # current HEAD: H1-2 red
git archive 4affc62d | tar -x -C .mpd/tmp/activate-mint-w4/base-4affc62d   # round-3 HEAD: N-a probes
cp packages/mpd-cellwork-plugin/test/{activate-resume,resolve-cell-team}.test.ts \
   .mpd/tmp/activate-mint-w4/head-76254694/packages/mpd-cellwork-plugin/test/
BUN=.toolchain/node_modules/.bin/bun
(cd .mpd/tmp/activate-mint-w4/head-76254694 && \
  $BUN test packages/mpd-cellwork-plugin/test/activate-resume.test.ts -t "H1-2" && \
  $BUN test packages/mpd-cellwork-plugin/test/resolve-cell-team.test.ts)
```

The N-a probes: copy `activate-resume.test.ts` + the `fail-before/probes/na-probe-mint-test.fragment.ts`
block into the `base-4affc62d` tree, copy `fail-before/probes/na-probe-resolver.test.ts` beside it, and run
`-t "N-a PROBE"` / the probe file. The negative controls copy THIS round's `src/{activate,state}.ts` over a
`head-76254694` tree and run the same two probes (both must RED).

## Files changed

- `packages/mpd-cellwork-plugin/src/activate.ts`
- `packages/mpd-cellwork-plugin/src/state.ts`
- `packages/mpd-cellwork-plugin/dist/index.js` (pinned rebuild)
- `packages/mpd-cellwork-plugin/test/activate-resume.test.ts` (M1 assertions + H1-2 refusal arm + control)
- `packages/mpd-cellwork-plugin/test/resolve-cell-team.test.ts` (+`recordedTerminal` arms)
- `packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` (comment re-classification only)
- `docs/cellwork.md`, `docs/cellwork.zh-CN.md`, `docs/independence.md`, `docs/independence.zh-CN.md`
- full diff: `changes.diff` (481 lines); `git-diff-stat.txt`

## What this evidence does NOT prove (bounds)

1. **The fake team service, not a live DSH boot.** Records live in a Map; the unreadable control models
   the reader's `undefined` instead of exercising `readTeam` on disk. The H1-2 refusal is proven at the
   tool/flow level against that double, not on a real team-plane process.
2. **The append attempt is not the append.** The package double does not route `agent_teams_plan` writes
   by team id (it mutates the harness's CURRENT record), so the pre-repair "appends to the dead board"
   claim is proven as the RESOLVED TARGET (`na-probe-resolver`), not as bytes landing on `team-1`. The
   repaired build refuses BEFORE any write, so the fix does not depend on that fidelity gap.
3. **The refusal's recovery path is documented, not arm-proven**: `cellwork_stop` + a new
   `/cellwork` is named in the sentence and the docs, but no arm runs that sequence.
4. **The terminal-minted retry bound is still unexercised** (N-b): a minted team that ends between the
   failure and the retry is accepted by step 0 and fails at the append; no arm covers it.
5. **N3 remains a CARRY** (unchanged): `skills/dsh-qa/scripts/cellwork-activate-mint.ts` still asserts
   `phase !== "ended"`; the exact phase is proven at package level only. This wave used no `skills/**`
   edit and no re-pin.
6. **No real-machine / Docker lane and no live-LLM QA case were run**: this change touches no mount,
   manifest or install path.
7. **The pre-repair trees are temporary**: `.mpd/tmp/activate-mint-w4/{head-76254694,base-4affc62d,fixed}`
   were extracted with `git archive` for the fail-before runs and have been REMOVED after the logs were
   captured; the logs, the probe sources and the reproduction commands above are the durable artifacts.
