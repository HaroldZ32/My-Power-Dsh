# t5 closure ledger — final read-only reconciliation of the RTL strip

**Task**: t23 (verification) · **Executed by**: Senior Engineer · **Date**: 2026-09-13
**Subject**: the source-repo RTL strip delivered by t5, committed as `12291a7`.
**Discipline**: read-only reconciliation — **no deletion was redone and no implementation change
was made** by this task. The only file written is this one.

> **Root-cause verdict (required statement)**
> **t5's three `failed` attempts were caused by a contract-definition defect, not by
> implementation quality**: the t5 contract declared `In scope: /root/dshProj/my-power-dsh/`
> while `Out of scope: packages/, skills/, docs/, cordis.patch.yml, package.json` — the two are
> mutually negating, and the out-of-scope list is exactly what contract item A ordered to be
> edited. Performing A therefore always exceeded `outOfScope`; honoring `outOfScope` left the
> acceptance items empty. The completion validator rejected 83 of 84 changed paths on that
> basis. The work itself was complete and committed before the third attempt.

---

## 1. Starting state (gate for this reconciliation)

| Check | Command | Observed |
| --- | --- | --- |
| HEAD | `git log --oneline -1` | `12291a7 feat(rtl-extraction): remove the RTL surface from the mpd repo (moved to @mpd-dsh/silicon)` |
| worktree | `git status --porcelain \| wc -l` | `0` (clean) |
| branch / parent | `git rev-parse --abbrev-ref HEAD`, `HEAD^` | `dev` / `3d99718` |

## 2. Commit facts

- `git show --shortstat --oneline 12291a7` → **84 files changed, 166 insertions(+), 9052 deletions(-)**.
- Classification: **A 1 / D 72 / M 11**.
- Mode changes: **0** (`git show --summary 12291a7` reports none — no `chmod` was mixed into the
  deletion commit).
- Staged-package evidence (non-committed step from t5): `node scripts/pack-mpd.mjs` → staged
  package contains **no `mpd-verif-plugin`**, and all 14 `PLUGIN_PKGS` entries are present.

### 2.1 Baseline change `f2dd7d7` → `12291a7` (F4 ruling)

`f2dd7d7` was amended under the captain's F4 ruling (re-pin `VENDOR_LOCK` + `test:qa`
disposition). It remains resolvable as a dangling object but describes the superseded baseline.

| | files | insertions/deletions | A/D/M |
| --- | --- | --- | --- |
| `f2dd7d7` (old) | 82 | +135 / −9048 | A1 / D72 / M9 |
| `12291a7` (now) | **84** | **+166 / −9052** | **A1 / D72 / M11** |

`git diff --stat f2dd7d7 12291a7` shows the increment is exactly **`VENDOR_LOCK.json` (6 lines)
+ `package.json` (3 lines)** — the two items F4 authorized.

## 3. Deletion and edit facts

### 3.1 Deletions

| Item | Evidence |
| --- | --- |
| `packages/mpd-verif-plugin/` (whole directory, 38 files) | `test ! -d packages/mpd-verif-plugin` → `PLUGIN-DIR-GONE` |
| Three RTL skill trees, **35** files (9 + 6 + 20) | `test ! -d skills/rtl-ip-flow` → `CORPUS-GONE`; zero `skills/rtl-*` directories remain |

Every deleted path is paired with its new home in `.silicon-extraction/removal.log`
(committed, 145 lines: §A deletions→homes, §A2 the eight edits, §A3 retained items with owners,
§C re-pin #1 of 2, §D `test:qa` disposition, §E raw gate logs).

### 3.2 The eight edits, all in place

| # | Site | Verified state |
| --- | --- | --- |
| 1 | `packages/mpd-bundle/cordis.patch.yml` — `mpd-verif` row + comment | removed; inserts 22→21; `mpd-verif` has 0 hits |
| 2 | `packages/mpd-bundle/cordis.patch.yml` — agent-teams `profiles.rtl-ip` block | removed; YAML parses; `profiles` = `['mpd']` |
| 3 | `scripts/install-profile.mjs` — row + B9 self-test assertion | removed (stale `mpd_verif_*` comment also rewritten) |
| 4 | `scripts/pack-mpd.mjs` — `PLUGIN_PKGS` | **14** entries, `mpd-verif-plugin` absent |
| 5 | `scripts/verify-rows-parity.mjs` — comment + success wording | neutralized; **assertions and exit codes untouched** |
| 6 | `packages/mpd-bootstrap-plugin/test/bootstrap.test.ts` | threshold `toBeGreaterThanOrEqual(19)`; three `rtl-*` `toContain` entries removed |
| 7 | `skills/dsh-qa/SKILL.md` | `rtl-verif` case row removed |
| 8 | `AGENTS.md`, `docs/index.md`, `docs/index.zh-CN.md` | RTL references repointed to `gitee.com/nop_chip/my-power-dsh-silicon` (bilingual, same commit) |

**`profiles.mpd` is byte-identical**: extracted from `HEAD` and from the worktree, the block is
80 lines in both, line-for-line equal, and both hash to
`cf0c0a3fa43637b9768c2a1eee3b3128bab02fe48c7aa857f4f49751bd1f13ba`.

## 4. Gate terminal state

| Gate | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `node scripts/verify-vendor.mjs` | **exit 0** (`asset OK: skills 331 files`) — after re-pin #1 of 2 |
| `node scripts/verify-rows-parity.mjs` | exit 0 (21 row ids match the patch insert list) |
| `npm run test:qa` | exit 0 (`all self-tests passed (2 RTL cases skipped: known-stale until t19)`) |
| `install-profile.mjs --dry-run` (isolated `DSH_HOME` + `HOME`) | exit 0 |
| `pack-mpd` evidence step | pass (staged package without `mpd-verif-plugin`; 14/14 `PLUGIN_KGS`-listed packages present) |
| `bun test packages` | **298 pass / 3 fail / 0 skip — judged ZERO REGRESSION** |

### 4.1 Zero-regression evidence

A stash A/B measurement on the unmodified tree gave **HEAD 376 tests / 3 fail**; the stripped
tree gives **298 / 3 fail**. The difference of **78** is exactly the deleted
`mpd-verif-plugin` suite. The three remaining failures all live in
`packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs`
(F3 / t9 re-materialize) and have no path intersection with this strip: **pre-existing, zero
regression**, so the criterion is zero regression rather than a literal `exit 0`.

## 5. Exemptions and ownership

1. **Six RTL documents** (`rtl-verif-guide`, `rtl-ip-flow-guide`, `rtl-gap-assessment`, EN+ZH) —
   intentionally **not deleted** in this round; **migration → t20**, deletion follows migration.
2. **Two RTL QA cases** (`skills/dsh-qa/scripts/rtl-verif.mjs`, `rtl-ip-profile.mjs`) — kept and
   **skipped by name** in `test:qa` with the printed reason `known-stale until the t19 repoint`;
   **repointing → t19**. Auditability: the added `test:qa:all` (no allowlist) exits **1** today,
   proving the skip cannot hide a case.
3. **`VENDOR_LOCK.json` is no longer an exemption**: F4 authorized and this commit performed
   **re-pin #1 of 2** — `fileCount 366 → 331`, `treeSha 3259d07a… → 23e18d7c…`, measured with
   verify-vendor's own algorithm and independently recomputed; `verify-vendor` is now green.
   Lock value (`331`) equals the measured corpus count (`331`).
4. **Three pre-existing `bun test` failures** belong to the agent-teams plugin itself and are
   outside this objective (captain ruling (a)).

## 6. Convergence value for the follow-up re-pin

**t17 convergence = 329**: starting point is the *actual lock value at that time* (currently
**331**, after re-pin #1) minus the 2 orphan `skills/lsp-setup/references/{verilog,systemverilog}/README.md`
⇒ **331 − 2 = 329**. The earlier `366 − 37 − 2 = 327` is void: it rested on two premises that were
later overturned (35 files deleted, not 37; and the lock has been re-pinned). The value must again
come from `node scripts/verify-vendor.mjs` output — never hand-written.

Tooling note for t17/t19: `node scripts/pack-silicon.mjs --fix` → `--check` → `--self-test`
(invoke node directly; there is no npm alias). This script exists only in the silicon repo and
must **not** be run against the source repo, whose 22 package directories its manifest does not
describe.

## 7. Contract vs captain ruling (five recorded deltas)

| # | Contract text | Governing ruling |
| --- | --- | --- |
| 1 | delete three QA scripts | keep all three; skip by name this round (repoint → t19) |
| 2 | move out the six RTL docs | keep this round (migrate → t20, delete after) |
| 3 | re-pin `VENDOR_LOCK` | first forbidden, then authorized by F4 → re-pin #1 of 2 done |
| 4 | all five gates `exit 0` | `bun test` judged by **zero regression**; the other four are 0 |
| 5 | "37 files deleted / t17 = 327" | measured: **35 files deleted / t17 = 329** |

## 8. Open items / 待解 (recorded at captain's request)

### 8.1 The `verify-corpus` fidelity cross-check lost its comparison target (silicon side)

Owner: **t20** (it has taken over that script). Recorded here, not fixed here.

- **The loss**: the silicon repo's `scripts/verify-corpus.mjs` used the SOURCE repo's
  `skills/<tree>` as its fidelity baseline. The RTL strip removed those three source trees, so
  the cross-check no longer has an object to compare against. It now prints, per tree:
  `SKIP  fidelity cross-check: tree <name> is not present in the source checkout at
  /root/dshProj/my-power-dsh/skills (expected after the RTL strip)` (`verify-corpus.mjs:232`).
  This is a REAL loss of one assertion layer caused by the extraction.
- **Why the gate is nevertheless green today**: the correction that landed earlier pins the
  corpus **inside the silicon repo** — `evidence/verification/corpus-baseline.json`, per-file
  sha256 for all 35 files (`BASELINE_PATH` at `:46`) — so the gate still proves fidelity without
  the source tree, and cross-checks against the source only when it is present (`:240`,
  `:243-244`). Independent evidence: `evidence/verification/t5-corpus-gate-crosscheck.md`.
- **Captain's ruling for the remaining work — option (b), not (a)**: the cross-check must be
  reworked into an assertion against the **recorded fingerprints** (`corpus-baseline.json` plus
  the port record), preserving its bite. Option (a) — rewriting the criterion so that a skip is
  acceptable — is **rejected**: it would turn the gate into a permanently green no-op.

### 8.2 Do not conflate two different "skips" in this strip

| Skip | Where | Cause | Owner |
| --- | --- | --- | --- |
| two RTL QA cases skipped **by name** | source repo `test:qa` (`rtl-verif.mjs`, `rtl-ip-profile.mjs`) | their assertions target rows/trees this strip removed (`mpd-verif` row, `rtl-ip` profile, `rtl-*` trees) | **t19** — repoint at the silicon bundle |
| per-tree fidelity **cross-check** skip | silicon `verify-corpus.mjs:232` | the strip removed the source-side comparison object | **t20** — rework to recorded-fingerprint assertions (ruling (b)) |

Both are genuine losses with named owners, not silent passes. Neither was used to make a red gate
look green: the first is auditable via `test:qa:all` (no allowlist, measured **exit 1**), the
second is visible in the gate's own output text.

### 8.3 Measurement note (do not mix two suites)

The gate line in §4 (`bun test packages` → **298 pass / 3 fail / 0 skip**, judged zero
regression) is the **source repo's** suite. A figure of the form "130 pass / 0 fail / 1 skip"
belongs to a different repository/suite and must not be substituted into this ledger's
source-repo record.

## 9. Scope statement

This reconciliation re-ran read-only commands and wrote exactly one file (this document). It
redid no deletion, introduced no implementation change, softened no guard, skipped no case, and
mislabelled no red item as green. The source repo's HEAD and clean worktree are unchanged by it.

### 9.1 Addendum provenance

§8 was added after t23's completion, at the captain's explicit request ("另请你把这条写进 t23
报告的待解栏"), as an **addendum to the same deliverable**; §§1–7 were not altered. Re-verified
after the edit: file mode 644, `git status --porcelain` still exactly one entry
(`?? t5-closure-evidence/`), and the source repo's HEAD remains `12291a7` with a clean worktree
apart from this deliverable.
