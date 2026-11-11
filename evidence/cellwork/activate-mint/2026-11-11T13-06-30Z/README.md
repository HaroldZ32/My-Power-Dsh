# release 0.18.2 — defects ①②③ fixed on `fix/cellwork-activate-mint`

- Repo: `/home/haroldzhao/MyProj/DshProj/My-Power-Dsh`
- Branch: `fix/cellwork-activate-mint` (cut from `dev`), HEAD `77952e40`
- Worktree before the wave: clean (only pre-existing untracked evidence directories)
- **No git write was performed** (no add/commit/branch/checkout/reset/tag). `git status`/`diff`/`log`
  were the only git invocations.
- Every arm below ran in a temp workspace / isolated sandbox; the repository's own `.mpd/` was never
  written by a test or by the QA case.

## Verdict table

| id | severity | landing | verdict |
|---|---|---|---|
| ① | High | `cellwork_activate` mints a fresh execution team when the planning board was auto-ended; the team-core fallback sentence names the real verb | PASS (unit + QA case + real-run record) |
| ② | Medium | the watchdog never caches an EMPTY team readout, so a lane born inside `teamCacheMs` is named | PASS (default-window arm) |
| ③ | docs | the stop sentence is limited to a SUCCESSFUL stop (EN + zh-CN) | PASS (`verify:docs`) |

---

## ① High — `cellwork_activate` had no mint path after the clean-terminal auto-end

### Root cause (confirmed by the release evidence)

mpd-roles' `autoEndCleanTerminal` (`packages/mpd-roles-plugin/src/session-gate.ts` rule 3) ends a
clean-terminal board. A cell's PLANNING board is clean-terminal exactly between the split's acceptance
and `cellwork_activate`, so the gate ends it. `activate.ts` then appended to the ended record and the
team plane answered:

```
cellwork_activate could not raise "Deep Worker": no team is staged in this session — call agent_teams_create first
```

The measured journal is quoted verbatim in `fail-before/qa-case.log` and in the release evidence
(`evidence/release/0.18.2/2026-11-11T11-05-56Z/exploratory/probe-d1-autoend-arm/`).

### Landing points (file:line + semantics)

- `packages/mpd-cellwork-plugin/src/activate.ts:464` — `isLiveTeamRecord(record)`: a record is writable
  only while it carries no `endedAt` and its phase is `staged` | `active` | `idle` (team-core's live set,
  read structurally — no cross-package import). `undefined` is NOT live: a reader that cannot read the
  board also cannot append to it.
- `packages/mpd-cellwork-plugin/src/activate.ts:508` — `mintExecutionTeam(call, input)`:
  `agent_teams_plan {action:"create"}` → one member (approval refuses an EMPTY shell) → `approve`;
  returns the minted `teamId`. A failed member append archives the empty slot so the retry can re-create.
- `packages/mpd-cellwork-plugin/src/activate.ts:652` — the mint arm in `materializeSplit`, taken only on
  an INITIAL activation (`!resplit`) whose resolved board is not live. The split's first owner seeds the
  plan member; the ended id stays `planningTeamId`.
- `packages/mpd-cellwork-plugin/src/activate.ts:960` / `:1026` — after a mint, the growth stage and the
  final report use the MINTED id directly. A fresh team numbers its board from `T1`, the same ids the
  ended planning board carries, so the activated-task evidence alone cannot distinguish the two records;
  the id this pass created is authoritative.
- `packages/mpd-cellwork-plugin/src/activate.ts:1043` — the `activate` journal row carries
  `mintedTeamId` and `planningTeamId` beside `teamId`, so the mint is a durable fact.
- `packages/mpd-team-core-plugin/src/index.ts:2113` / `:2267` — the two fallback sentences now name the
  REAL verb: `no team is staged in this session — call \`agent_teams_plan {action:"create"}\` first`
  (the retired `agent_teams_create` name is gone; the live call `resolved.refusal` is unchanged).
- The normal path (a board that still resolves) is byte-for-byte the old path: it pays exactly the same
  one `recordFor` read, never calls `create`, and keeps `teamId` == the planning id.

### Fail-before (fix temporarily disabled, then restored — `cmp` proved byte identity)

| arm | command | before | after |
|---|---|---|---|
| unit mint arm | `bun test ./packages/mpd-cellwork-plugin/test/activate-resume.test.ts -t "MINT"` | **exit 1**, `(fail) MINT: …` | exit 0, both MINT arms pass |
| QA case | `bun skills/dsh-qa/scripts/cellwork-activate-mint.ts --self-test` | **exit 1**, `1/2 arms`; observed the exact field error `no team is staged in this session — call agent_teams_create first`, `minted=(none)`, `phase=split` | exit 0, `PASS (2/2 arms)` |
| sentence | `bun test packages/mpd-team-core-plugin -t "no staged plan"` (via `c74-midrun-and-binding.test.ts`) | **exit 1**, received the retired `agent_teams_create` sentence | exit 0, received the real verb |

Logs: `fail-before/cellwork-mint-arm.log`, `fail-before/qa-case.log`,
`fail-before/team-core-sentence.log`.

### After (observed)

- `bun test packages/mpd-cellwork-plugin` → **422 pass / 0 fail** (4205 expect calls, 34 files), exit 0.
- `bun test packages/mpd-team-core-plugin` → **637 pass / 0 fail** (3130 expect calls, 45 files), exit 0.
- The QA case's real run (`qa-case/result.json`) records:
  `activate.ok=true`, `dead=team-…-002 (endedAt=…)`, `minted=team-…-004 (phase=active, tasks=4)`,
  `cell.teamId=<minted>`, `cell.planningTeamId=<ended>`, `phase=executing`, `revision=1`,
  `deadRecordUntouched=true`, `journal.mintedTeamId=<minted>`.

### The new QA case

`skills/dsh-qa/scripts/cellwork-activate-mint.ts` (registered in `skills/dsh-qa/SKILL.md`).

- **Seed**: `/cellwork` opens a real cell; `cellwork_start` stages + approves a REAL planning team
  through the REAL `agent_teams_plan` tools; the planner finalizes the six-section requirements; the
  splitter submits 4 tasks (two work + two reviews). The planning team is then ended through the REAL
  `agent_teams_control {action:"end"}` verb — the same call the auto-end gate makes.
- **Positive assertion**: `cellwork_activate` must MINT a second team (`create` + one member +
  `approve`), land all four split tasks on it, persist `teamId` = minted / `planningTeamId` = ended, and
  journal `mintedTeamId`. It fails on the measured `no team is staged` sentence, on a missing second
  record, on a stale `teamId`, or on an ended record that changed.
- **Negative control**: the same flow with a LIVE planning board must be addressed IN PLACE — exactly one
  team record, `planningTeamId` empty, and ZERO `agent_teams_plan {action:"create"}` calls during
  activation. This is what stops the positive arm from passing by minting unconditionally.
- **Run**: `bun skills/dsh-qa/scripts/cellwork-activate-mint.ts --self-test` (offline falsifier, no
  evidence dir) and the real run `… --out <dir>` → `result.json` + `output.log`.

---

## ② Medium — the watchdog's negative cache blinded every lane shorter than 2 s

### Landing point

- `packages/mpd-team-watchdog-plugin/src/engine.ts:820` — `Engine.teams` writes the per-workspace cache
  ONLY when the readout is non-empty (`teams.length > 0`). An empty read is the NORMAL first observation
  of a lane whose first heartbeat precedes its team record's `createdAt` by ~100 ms, so caching it for
  `teamCacheMs` (default 2000) made every member — the captain included — answer `member: null` for the
  lane's whole life. `Engine.invalidate()` still exists for tests/lanes; no production call site was
  added, because the one condition is the fix.

### New arm (default window)

`packages/mpd-team-watchdog-plugin/test/team-plane.test.ts:263` — `DEFAULT teamCacheMs: an empty readout
is not cached, so a team created inside the window is named`:

1. apply the row WITHOUT `teamCacheMs` (shipped default 2000 ms);
2. stamp once with no team record → `teamId: null`, `member: null`;
3. mount the `mpdTeams` record ~immediately (well inside the window);
4. stamp again → MUST be `team-20261006120000` / `Senior Engineer`.

### Fail-before / after

- Before (`this.teamCache.set` unconditional): **exit 1**, `Expected: "team-20261006120000"`,
  `Received: null` — `fail-before/watchdog-cache-arm.log`.
- After: `bun test packages/mpd-team-watchdog-plugin` → **182 pass / 0 fail** (884 expect calls,
  17 files), exit 0; the new arm passes.

---

## ③ Docs — the stop sentence promised fields on a REFUSED stop

- `docs/cellwork.md:996` — “a SUCCESSFUL stop's answer carries `teamId` … and `endTeamCommand` …”, with a
  following sentence stating that a REFUSED stop answers only its error on purpose (while tasks run,
  suggesting "end that team" contradicts the guard's own reason).
- `docs/cellwork.zh-CN.md:776` — the same qualification in 简体中文.
- No code change: `packages/mpd-cellwork-plugin/src/index.ts` already returns `{ok:false, error}` on the
  guarded refusal and the two fields only on the success path.

---

## Gates (commands, observed output, exit codes)

| gate | command | observed | exit |
|---|---|---|---|
| typecheck | `bun run typecheck` | `tsgo --noEmit`, no diagnostics | 0 |
| comments | `bun run verify:comments` | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.` (634 files) | 0 |
| docs | `bun run verify:docs` | `pairs=59 failed=0 violations=0 exempt=24 derived=3 links=626 dead=0 — PASS` | 0 |
| cellwork tests | `bun test packages/mpd-cellwork-plugin` | `422 pass / 0 fail`, 34 files | 0 |
| watchdog tests | `bun test packages/mpd-team-watchdog-plugin` | `182 pass / 0 fail`, 17 files | 0 |
| team-core tests | `bun test packages/mpd-team-core-plugin` | `637 pass / 0 fail`, 45 files | 0 |
| all packages | `bun test packages` | `4061 pass / 6 skip / 0 fail`, 261 files | 0 |
| dist rebuild | `.toolchain/node_modules/.bin/bun build packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js` (cellwork, team-watchdog, team-core; pinned bun **1.4.0**) | three `index.js` outputs | 0 |
| dist freshness | `node scripts/verify-dist-fresh.ts` | `ok: 34/34 targets fresh (each rebuilt twice, byte-identical) — 1 NOT COVERED files listed` | 0 |
| QA case self-test | `bun skills/dsh-qa/scripts/cellwork-activate-mint.ts --self-test` | `SELF-TEST PASS (2/2 arms)` | 0 |
| QA case real run | `bun skills/dsh-qa/scripts/cellwork-activate-mint.ts --out <dir>` | `PASS`, `result.json` + `output.log` written | 0 |
| QA self-tests (all) | `bun run test:qa` | the new case is listed (`[test:qa] cellwork-activate-mint.ts`) and reports `SELF-TEST PASS (2/2 arms)`; `[test:qa] all self-tests passed` | 0 |
| vendor (EXPECTED RED, out of scope) | `node scripts/verify-vendor.ts` | `FAIL - asset skills treeSha mismatch` — the `skills/**` change needs the captain's single re-pin (see “What this evidence does NOT prove” §3) | 1 |

Logs: `after/typecheck.log`, `after/verify-comments-pass.log`, `after/verify-docs.log`,
`after/cellwork-package.log`, `after/watchdog-package.log`, `after/team-core-package.log`,
`after/bun-test-packages.log`, `after/verify-dist-fresh.log`, `after/qa-case-stdout.log`,
`after/test-qa.log`, `after/verify-vendor-expected-red.log`, `qa-case/{result.json,output.log}`,
`fix.patch`, `git-status.txt`, `git-diff-check.log` (first comments run, which caught two undocumented
locals in the new case: `after/verify-comments-first-run-failed.log`).

---

## What this evidence does NOT prove

1. **No live `dsh` boot and no model.** The QA case drives the REAL rows in-process over a stub harness
   seam (executor spawn/send, verify plane, roster/config services); the team records, plan store, cell
   state and journal are the real files those rows write. It does not re-measure the model-driven
   D1 flow end to end; the release evidence's `probe-d1-autoend-arm` is the measured field failure, and
   this case reproduces its exact state and error.
2. **A re-split whose board is unreadable keeps its existing UNVERIFIED fallback.** The mint arm is
   deliberately limited to an INITIAL activation: a re-split's kept rows are board ids of the team being
   replaced, and re-minting them is a different repair. The resolver already prefers the live execution
   board for a re-split.
3. **`skills/**` changed without a vendor re-pin.** Per AGENTS.md §9/§11 the corpus `treeSha` in
   `VENDOR_LOCK.json` must be re-pinned in the SAME commit by the captain (`node
   scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step`). That is a version-carrier write
   outside this task's declared scope; `node scripts/verify-vendor.ts` is therefore expected to redden
   until the captain's re-pin lands.
4. **`bun run verify:vendor` / `bun run verify:rows` / the Docker lane were not run** — no baseline,
   patch-row or install-path change is in this wave (the Docker lane is a release sweep, not this fix).
5. The watchdog arm uses the REAL wall clock inside the 2 s window (two stamps milliseconds apart); it
   does not sleep, so it cannot be flaky by timing out.
