# PR #110 blind-review FAIL — the MINT's failure/retry path (H1/M2/N1/N2/N3)

- Repo: `/home/haroldzhao/MyProj/DshProj/My-Power-Dsh`
- Branch: `fix/cellwork-activate-mint` (PR #110), HEAD `4affc62d`
- Verdict repaired: `rec-20261111T134325-bb86f4` (blind **FAIL**: happy path and docs correct, High on
  the mint's failure/retry path)
- Worktree before the wave: only pre-existing untracked `evidence/**` directories
- **No git write was performed** (no add/commit/branch/checkout/reset/tag/stash). `git status`/`diff`/
  `show` are read-only and are the only git invocations.
- **No `skills/**` file was touched and no vendor re-pin was run**: `skills` stays 393 files /
  `2997619a891615643e81f91ae051f99f79f23053fae6fdc45165a3904baad3de` (see `after/verify-vendor.log`).
- `AGENTS.md`, `agent-references/**`, version carriers and `VENDOR_LOCK.json` are untouched.

## Verdict table

| id | severity | landing | verdict |
|---|---|---|---|
| H1 | High | mint persisted on the failure path; retry resolves/never re-mints it | PASS (arms A/B + fail-before red) |
| M2 | Medium | exists-but-unreadable REFUSES the mint (named path); `mintTrigger` journaled + in the reply | PASS (arm + docs) |
| N1 | Normal | live-phase set typed against `TeamPhase` + team-core parity arm | PASS |
| N2 | Normal | the mint's cleanup `delete` result is checked and named in the sentence | PASS (arm) |
| N3 | Normal | QA positive arm's `phase !== "ended"` — **CARRIED, not changed**: it lives in `skills/**` | CARRY (see “N3 carry”) |

Two compile-time edges were added deliberately and frozen in the independence inventory
(`packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts`, 2 entries, both
sanctioned classes from `docs/independence.md` §4: a shared pure module imported instead of forked, and
a type-only import). No other coupling moved.

## H1 — a minted team is persisted on failure, and a retry never mints a second one

### Landing points (file:line)

- `packages/mpd-cellwork-plugin/src/activate.ts:244` — `ActivatePartial` gains `mintedTeamId?: string`,
  `minted?: boolean` and `mintTrigger?: MintTrigger` (`:258`), so the failure snapshot can carry the mint.
- `packages/mpd-cellwork-plugin/src/activate.ts:598` — `recordedMinted = cell.mintedTeamId` and `:604`
  `resplit = recordedMinted !== "" || <any activated board id>`: a RETRY of a minted pass is a re-split
  for every resolution/append purpose, so the mint arm cannot run again.
- `packages/mpd-cellwork-plugin/src/activate.ts:735` — the mint arm starts with `mintTriggerFor(...)`
  (M2, below), then `:760`/`:768` records `mintedTeamId`, `minted: true`, `mintTrigger` on the partial and
  sets `mutated = true` (a mint creates a team + a live seed seat without journaling an artifact row).
- `packages/mpd-cellwork-plugin/src/activate.ts:509` — `mintTriggerFor`: `ended` for a readable terminal
  record, `unreadable` when a record FILE exists, `absent` otherwise.
- `packages/mpd-cellwork-plugin/src/flow.ts:1175` — `persistPartial` now writes `mintedTeamId` into the
  cell record, moves `teamId` onto the minted team, preserves the ended planning id as `planningTeamId`
  (never overwriting one an earlier activation preserved), and journals `mintedTeamId` + `minted` +
  `mintTrigger` on the `cell-activation-partial` row.
- `packages/mpd-cellwork-plugin/src/flow.ts:1241` — the `!activated.ok` reply carries `mintedTeamId`.
- `packages/mpd-cellwork-plugin/src/flow.ts:1265` — a SUCCESSFUL activation clears `mintedTeamId`
  (`teamId` names the execution team from then on), and `:1270`/`:1288` journal/report the mint on success.
- `packages/mpd-cellwork-plugin/src/state.ts:238` — `CellState.mintedTeamId` (tolerant read at `:1050`
  area; a pre-fix record reads as “no mint in flight”).
- `packages/mpd-cellwork-plugin/src/state.ts:789`/`:811` — `resolveCellTeam` step 0: the recorded minted
  id is the FIRST candidate and is returned on its own authority (even if its phase reads terminal).
- `packages/mpd-cellwork-plugin/src/state.ts:677` — `isTerminalTeamRecord`: `endedAt`, `ended` or the
  hand-patched `archived` is PROVEN terminal; an unknown spelling is not. `:804`/`:837`/`:864`/`:879`
  apply it to the recorded fast path, the plane, the activated-id scan and the planning fallback.
- `packages/mpd-cellwork-plugin/src/activate.ts:491` — `isLiveTeamRecord` now delegates to that ONE rule
  (N1), so the old untyped literal live subset is gone.

### New arms (package tests only, no `skills/**`)

`packages/mpd-cellwork-plugin/test/activate-resume.test.ts`:

- **A — `:1167` “MINT RETRY A: a failure BEFORE the first board row …”**
  Seed: a cell whose planning team `team-1` is ended (`phase:"ended"`, `endedAt`), an accepted 4-task
  split; the fake's first LIVE member append fails after the mint's approval (no `create_task` ran).
  Asserts: the failed reply carries `mintedTeamId=team-2`; the cell record carries
  `mintedTeamId/teamId=team-2` and `planningTeamId=team-1`; the `cell-activation-partial` row carries
  `mintedTeamId=team-2`, `minted=true`, `mintTrigger="ended"`; **`create` count = staging + exactly 1**
  (`expect(createCalls(harness)).toBe(createsBefore + 1)`, `:1206`) and the RETRY adds **zero** further
  `create` calls (`:1209`, the “create 调用次数仍为 1” assertion — one create for activation, none on
  retry); retry succeeds, `teamRecords.size === 2`, the minted board holds 4 rows, the dead planning board
  keeps its row count.
- **B — `:1214` “MINT RETRY B: a failure AFTER the first board row …”**
  Seed: same ended planning board; the SECOND `create_task` fails, so the partial records
  `activatedTasks={auth-core:"T1"}` on the minted team. Asserts: `mintedTeamId=team-2`, minted board has
  1 row after the failure; the retry succeeds, the DEAD planning record is **byte-for-byte identical**
  (`JSON.stringify(planning)` before/after), the minted board GROWS 1 → 4 rows, `teamRecords.size === 2`,
  and no `create` is spent on the retry.

Fail-before (final test file, HEAD `4affc62d` sources staged, then restored byte-identically —
`sha256sum -c` proved the restore): `fail-before/activate-resume-mint.log` → **1 pass / 3 fail** —
`(fail) MINT …`, `(fail) MINT RETRY A …`, `(fail) MINT RETRY B …`; the negative control (live board, no
second team) passes. On HEAD the retry mints `team-3` / appends to the dead board.

## M2 — an existing-but-unreadable record REFUSES the mint; the trigger is visible

- `packages/mpd-cellwork-plugin/src/activate.ts:735-742` — when the resolved board is not live,
  `mintTriggerFor` is consulted FIRST; `unreadable` returns a refusal naming the record's absolute path
  (`teamRecordPath`, the team store's own helper) and writes NOTHING (fail-closed, no `create`).
- The successful mint records `mintTrigger` (`ended` | `absent`) on the partial → the cell record's
  `cell-activation-partial` journal row (`flow.ts:1206`) and, for a success, on the `cell-activation` row
  (`flow.ts:1275`), in the tool REPLY (`flow.ts:1293`; `ActivateOutcome.mintTrigger`, `activate.ts:215`)
  and in the tool's declared OUTPUT SCHEMA (`flow.ts`, `mintedTeamId` + `mintTrigger` properties).
- Docs: `docs/cellwork.md` (“A mint names its trigger, and an unreadable record refuses the mint”) and
  `docs/cellwork.zh-CN.md` mirror.
- Arm: `activate-resume.test.ts:1258` — a record FILE is written at `teamRecordPath(ws,"team-1")` with an
  unparsable body while the service answers `undefined`; asserts the call is REFUSED, the error contains
  `could not be read` **and the path**, the `create` count is unchanged and only ONE team exists.
  Fail-before: `fail-before/m2-unreadable.log` → `Expected: false / Received: true` (HEAD mints `team-2`).
- Reply/journal evidence for the trigger: `activate-resume.test.ts:1078`/`:1080` assert the successful
  reply's `mintedTeamId`/`mintTrigger`; `:1196` asserts the FAILURE row's `mintTrigger`.

## N1 — the live-phase set is bound to `TeamPhase`

- `packages/mpd-cellwork-plugin/src/state.ts:654` — `LIVE_CELL_TEAM_PHASES: readonly TeamPhase[]`
  (`import type { TeamPhase }` at `:26`, erased by the build; frozen as a sanctioned type-only coupling).
- `state.ts:664`/`:677` — `KNOWN_TEAM_PHASES` = live set + `ended` + `archived`;
  `isTerminalTeamRecord` is the ONE rule now used by the resolver AND by activate's write gate.
- Arm: `packages/mpd-cellwork-plugin/test/resolve-cell-team.test.ts:44` — asserts the cellwork list equals
  team-core's runtime `LIVE_TEAM_PHASES` (widening upstream reddens it) and types the value as
  `readonly TeamPhase[]` (a renamed/removed spelling stops type-checking). A negative control at `:96`
  proves an UNKNOWN phase spelling is not treated as terminal (legacy records keep resolving).
- Fail-before: `fail-before/resolve-cell-team.log` → `(fail) N1 …` (the export did not exist).

## N2 — the mint's cleanup answer is checked

- `packages/mpd-cellwork-plugin/src/activate.ts:560-568` — the `delete` result is captured; the refusal
  sentence now says either `(the empty plan slot was deleted)` or `(AND the empty plan slot could NOT be
  deleted: <reason> — clear that staged plan before retrying)`.
- Arm: `activate-resume.test.ts:1285` — the seed-member append AND the cleanup `delete` both fail; asserts
  the sentence names BOTH failures and that `delete` was actually attempted; no team was minted.
- Fail-before: `fail-before/n2-delete.log` → `Expected to contain: "could NOT be deleted"`; received only
  `…the mint member could not be staged: the injected plan-member failure`.

## N3 carry — the QA script's loose assertion (NOT changed)

`skills/dsh-qa/scripts/cellwork-activate-mint.ts:446` still asserts `minted?.phase !== "ended"`. The
captain's ruling (2026-11-11) keeps this as a **carry**: this wave's single vendor re-pin is already spent
on `4affc62d` (lock 393 / `2997619a…`), and a second `skills/**` edit would need a second re-pin in the
same wave. The EXACT-phase guarantee is asserted at package level instead
(`activate-resume.test.ts:1109`, `expect(minted.phase).toBe("active")`, on a fake approval that stamps the
real `phase:"active"`), and the intended one-line QA change is:

```diff
-      && minted?.phase !== "ended"
+      && minted?.phase === "active"
```

No `skills/**` file was modified and no `repin-vendor` was run (`after/verify-vendor.log`: PASS,
asset OK `skills`, lock unchanged).

## Gates (observed, final tree)

| gate | command | result |
|---|---|---|
| typecheck | `node_modules/.bin/tsgo --noEmit` | **exit 0** (`after/typecheck.log`, empty) |
| comments | `node scripts/verify-comment-coverage.ts` | **exit 0**, `VERDICT: PASS` (`after/verify-comments.log`) |
| docs | `node scripts/verify-docs-parity.ts` | **exit 0**, `pairs=59 failed=0 violations=0 … PASS` (`after/verify-docs.log`) |
| cellwork package | `.toolchain/node_modules/.bin/bun test packages/mpd-cellwork-plugin` | **exit 0**, 433 pass / 0 fail, 35 files (`after/cellwork-package.log`) |
| team-core package | `… bun test packages/mpd-team-core-plugin` | **exit 0**, 637 pass / 0 fail (`after/team-core-package.log`) |
| watchdog package | `… bun test packages/mpd-team-watchdog-plugin` | **exit 0**, 182 pass / 0 fail (`after/watchdog-package.log`) |
| all packages | `… bun test packages` | **exit 0**, 4066 pass / 6 skip / 0 fail, 262 files (`after/bun-test-packages.log`) |
| QA self-tests | `node scripts/run-qa-selftests.ts` (`bun run test:qa`) | **exit 0**, `[test:qa] all self-tests passed` (`after/test-qa.log`) |
| dist freshness | pinned `.toolchain` bun 1.4.0 rebuild + `node scripts/verify-dist-fresh.ts` | **exit 0**, `34/34 targets fresh` (`after/verify-dist-fresh.log`) |
| vendor | `node scripts/verify-vendor.ts` | **exit 0**, `PASS - 8 shipped asset(s)`; `skills` 393 / `2997619a…` unchanged (`after/verify-vendor.log`) |
| coupling inventory | `… bun test packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` | **exit 0**, 2 pass + `SELF-TEST: PASS (14/14)` (`after/coupling-gate.log`) |

The `cellwork` dist was rebuilt with the PINNED toolchain
(`.toolchain/node_modules/.bin/bun build packages/mpd-cellwork-plugin/src/index.ts --target node --format
esm --outfile packages/mpd-cellwork-plugin/dist/index.js`, bun 1.4.0) and `verify-dist-fresh` rebuilt all
34 targets twice byte-identically.

## Files changed

- `packages/mpd-cellwork-plugin/src/activate.ts`
- `packages/mpd-cellwork-plugin/src/flow.ts`
- `packages/mpd-cellwork-plugin/src/state.ts`
- `packages/mpd-cellwork-plugin/dist/index.js` (pinned rebuild)
- `packages/mpd-cellwork-plugin/test/activate-resume.test.ts` (arms A/B, M2, N2, exact-phase + reply assertions)
- `packages/mpd-cellwork-plugin/test/resolve-cell-team.test.ts` (**new**, untracked: resolver unit arms + N1 parity)
- `packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` (+2 frozen entries, `9` lines)
- `docs/cellwork.md` / `docs/cellwork.zh-CN.md`

## What this evidence does NOT prove (bounds)

1. **N3 is a carry, not a fix**: the shipped QA script still asserts `phase !== "ended"`; the exact phase is
   proven at package level only. Closing it needs the one-line `skills/**` edit + the wave's re-pin (captain).
2. **The fake team service, not a live DSH boot.** The package arms use the suite's in-memory team plane
   (records live in a Map, not on disk), so the M2 arm writes the record FILE itself to model
   “exists but unreadable”. The real team-store read (`readTeam`/`readJson` collapsing absent/unparsable/
   version/IO into `undefined`) is not re-exercised here; `teamRecordPath` is imported from team-core, so
   the path is the store's own.
3. **A process that DIES mid-pass is still not resumable** (unchanged, and documented): only a RETURNED
   failure writes the checkpoint. The mint persistence closes the returned-failure window only.
4. **Unknown phase spellings are treated as NOT terminal** (deliberate, to keep legacy/foreign records
   resolving; e.g. the barrier fixture's `phase:"executing"`). A record in an unknown phase is therefore a
   landing target for reads and is refused by team-core if it is really dead — not proven dead here.
5. **`mintedTeamId` is cleared on success**; a later re-split resolves by board evidence. A cell whose
   execution team ends before a LATER re-split still falls back to the documented `unverified` path.
6. **A minted team that itself ends between the failure and the retry** is still accepted by step 0 (the
   spec's explicit-minted-id exception); the append then fails with the team service's own sentence, so
   the pass stays resumable but cannot succeed until an operator intervenes. Not exercised by an arm.
7. No real-machine / Docker lane and no live-LLM QA case were run: this change touches no mount, manifest
   or install path. The previous wave's real-run QA record lives at
   `evidence/cellwork/activate-mint/2026-11-11T13-06-30Z/qa-case/result.json` and was not re-run.
