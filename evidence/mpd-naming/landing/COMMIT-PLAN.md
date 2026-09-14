# t20 landing plan — the wave in ONE commit

## STATE UPDATE (read this first)

**The captain landed the wave while this package was being assembled.** Commit
`ff1932f21ba4e5fe536e617faf2b5f8b2acca86b` — `chore(naming): land the OMO/Codex/OpenCode to DSH naming wave`
— carries 189 files (+40697 / −136). Verified properties of that commit:

| check | measurement |
|---|---|
| the lock rides WITH all four `skills/**` edits (§9/§11) | `VENDOR_LOCK.json`, `skills/ast-grep/AGENTS.md`, `skills/ast-grep/scripts/ast_grep_helper.py`, `skills/ast-grep/tests/smoke.sh` and `skills/ulw-plan/scripts/scaffold-plan.mjs` are all in `ff1932f` — one commit, none left behind |
| no history modification | `git diff --diff-filter=MD 3c1a850 ff1932f -- evidence/` = **0 paths** |
| process records untouched | 0 paths changed between `3c1a850` and `ff1932f` |
| the scratch tree | **NOT committed** — `git ls-tree -r --name-only ff1932f -- …/scratch \| wc -l` = 0, so decision 1 below was taken as *exclude* |
| gate | `node scripts/verify-vendor.mjs` exit 0 / `[verify-vendor] PASS` at the landed revision |

The sections below are therefore the **historical pre-landing plan** (pinned revision
`53d617e6c2d29dfadec06278bc4130061055378e`), kept as the record of what the captain landed and of the
lane attribution. Post-landing measurements: `raw/33-post-landing-state.log`.

**What remains uncommitted now** (evidence only — no product source): 1214 paths =
1208 files of t14's scratch tree (deliberately excluded from the landing commit) + this landing package's
6 files. A follow-up evidence-only commit is all that is left:

    git add --pathspec-from-file=evidence/mpd-naming/landing/raw/34-remaining-uncommitted-path-list.txt
    git commit -m "chore(evidence): file the t20 landing package for the naming wave"
    # or land the scratch tree too by adding evidence/mpd-naming/wave2/raw/scratch separately


Prepared by Lead (t20, attempt 1, attempt_id `3935069e-8eeb-4627-bf2a-c0d887886dfd`) for the captain,
who alone commits and pushes (AGENTS.md §5). **No git write command was run to produce this package.**

- branch: `dev`
- pinned revision: `53d617e6c2d29dfadec06278bc4130061055378e` (dirty tree: 39 modified tracked files + 1345 untracked evidence files)
- pre-wave revision for every history comparison: `3c1a850`
- path list (paste-ready, generated LAST so it includes this package): `evidence/mpd-naming/landing/raw/23-landing-path-list.txt`
- evidence index (1387 artifacts, sha256 each): `evidence/mpd-naming/landing/raw/24-evidence-index.json`
- history proof: `evidence/mpd-naming/landing/raw/26-history-proof.log`
- lane assignment: `evidence/mpd-naming/landing/raw/22-lane-assignment.json`

---

## 0. History is proven untouched (the two ruled invariants)

| check | command | measured |
|---|---|---|
| no evidence history modified/deleted | `git diff --name-status --diff-filter=MD 3c1a850 -- evidence/` | **empty** (3673 tracked evidence files; 0 changed) |
| every evidence path in the wave diff is NEW | `git cat-file -e 3c1a850:<path>` per path | 6 paths, all **absent at 3c1a850** (corpus-gate-bytecode/{green.log,red.log,result.json}, verifier-contract/{measure-overlap-relation.mjs,overlap-relation-output.log,overlap-relation-result.json} — the captain's own commits) |
| process records untouched | `git diff --stat 3c1a850 -- docs/plan-*.md docs/omo-parity-gap.md docs/decisions.md docs/bline-report.md docs/review-p0-p3.md docs/track-a-report.md docs/ulw-deepseek-optimization.md` | **empty**, and all 10 files byte-identical by explicit `git show 3c1a850:<p> | sha256sum` vs `sha256sum <p>` compare (26-history-proof.log §3–§4) |

**Precise reading of the acceptance wording:** "`git diff --name-only 3c1a850` must contain no `evidence/**`
path" is literally unsatisfiable — the wave's own new evidence is tracked, and the captain's commits added 6
`evidence/mpd-naming/**` files. What holds, and is what the ruling requires, is: **no pre-existing history
path is modified or deleted** (measured: 0), and the 6 evidence paths in the diff are pure additions.

---

## 1. Already landed in wave commits — do NOT re-commit (19 diff entries)

`.gitignore`, `scripts/verify-vendor.mjs` (bytecode-cache hardening, `0cbf505`), `packages/mpd-agent-teams-plugin/lib/{mpd-deltas.js,quality-gates.js}` + `self-fix-tests/scope-glob-and-contract.test.mjs` (B7 overlap relation, `4d8a130`), `docs/index.md`, `docs/index.zh-CN.md` (t15's hub rows, `53d617e6`), the two rename pairs — `docs/omo-parity-ledger.md → docs/upstream-parity-ledger.md`, `docs/omo-parity-ledger.zh-CN.md → docs/upstream-parity-ledger.zh-CN.md` (R096) and `tests/overlays/omo-bline.yml → tests/overlays/bline.yml` (R100) — plus the 6 added evidence files above.

---

## 2. The one landing commit — 39 modified tracked + the evidence set

> The authoritative path list is `raw/23-landing-path-list.txt`, regenerated as the LAST action of t20 so it
> includes this landing package itself; its exact line count is printed in the `FINAL PACKAGE STATE` block at
> the end of `output.log`. At the capture before this package existed it was 39 tracked + 1345 untracked.

### 2a. 39 modified tracked files, by lane

| lane | paths |
|---|---|
| **t17 re-pin — the wave's SINGLE `VENDOR_LOCK.json` change** | `VENDOR_LOCK.json` |
| **t14 dists lane** | `scripts/build-mcp.mjs`, `packages/mpd-mcp-gitbash/dist/cli.js`, `packages/mpd-mcp-lsp/dist/cli.js`, `packages/mpd-mcp-{astgrep,gitbash,lsp}/dist/BUILD.lock` |
| **t16 skills lane** | `skills/ast-grep/scripts/ast_grep_helper.py`, `skills/ast-grep/tests/smoke.sh` |
| **t16 + captain sk-07 (same file, two writers)** | `skills/ast-grep/AGENTS.md` |
| **captain out-of-lane sk-08** | `skills/ulw-plan/scripts/scaffold-plan.mjs` |
| **t2 text lane (manual / overview / manifest / preset)** | `AGENTS.md`, `README.md`, `README.zh-CN.md`, `LICENSE-NOTICES.md`, `package.json`, `presets/mpd/agent.cordis.yml` |
| **t2 text lane (bilingual docs prose)** | `docs/architecture.md`, `docs/architecture.zh-CN.md`, `docs/feature-audit.md`, `docs/feature-audit.zh-CN.md`, `docs/user-guide.md`, `docs/user-guide.zh-CN.md` |
| **t2 text lane (package READMEs)** | 12 files: `packages/mpd-{boulder,bundle,modelchain,qa-roles-probe,roles,workmate}-plugin/README{,.zh-CN}.md` |
| **t2 text lane (roster/workmate prose + roles data)** | `packages/mpd-roles-plugin/package.json`, `packages/mpd-roles-plugin/src/index.ts`, `packages/mpd-roles-plugin/src/roles.data.ts`, `packages/mpd-workmate-plugin/src/index.ts` |

The t2 rows are one-line OMO-label retirements each (verified by `git diff`: e.g. `roles.data.ts` "The OMO-origin agent roster." → "The specialist roster.", `package.json` description "OMO-origin agent roster" → "specialist roster").

### 2b. 1345 untracked evidence files (all under `evidence/mpd-naming/**`)

| dir | files |
|---|---|
| `evidence/mpd-naming/wave2/**` (t14) | 1217 — of which **1208 are the `raw/scratch/**` reproduction tree** (8.8 MB: ast-grep / git-bash / lsp build scratch, pre-scrub + scrubbed artifacts) |
| `evidence/mpd-naming/re-pin/**` (t17) | 41 |
| `evidence/mpd-naming/verification/**` (t18) | 28 |
| `evidence/mpd-naming/brand-cleanup/**` (t1/t2/t13/t14 lineage) | 67 |
| `evidence/mpd-naming/final-allowlist/**` (t13) | 11 |
| `evidence/mpd-naming/skills-lane/**` (t16) | 9 |
| `evidence/mpd-naming/docs-lane/**` (t15) | 4 |
| `evidence/mpd-naming/captain-rulings/` (R14), `review/` (t19), `landing/` (t20) | 2 + 2 + the landing package itself |

No symlink or `node_modules` path enters the commit: the scratch tree's 21 `node_modules` symlinks (absolute, pointing into `/root/.bun/install/cache/…` and back into the scratch `src/`) are excluded by `.gitignore:1` (`node_modules/`), so the committed scratch set is 1208 real files.

**Captain's call (reported, not decided here):** committing the 1208-file / 8.8 MB scratch tree is
legitimate (it is t14's reproducibility proof) but it is reproduction scratch. To land without it:

    git add --pathspec-from-file=evidence/mpd-naming/landing/raw/23-landing-path-list.txt
    # then, if the scratch tree is to be excluded instead:
    git add -A evidence/mpd-naming ':!evidence/mpd-naming/wave2/raw/scratch'

and state the exclusion in the commit body so the proof's location stays discoverable. Whichever way, the
evidence index records the scratch artifacts and their sha256 either way.

### 2c. Staging command (paths safe for `--pathspec-from-file`: no spaces, no newlines)

    cd /root/dshProj/my-power-dsh
    git add --pathspec-from-file=evidence/mpd-naming/landing/raw/23-landing-path-list.txt
    git commit -F evidence/mpd-naming/landing/COMMIT-MESSAGE.txt   # message prepared below

Do NOT `git add -A` blind: it would also stage nothing else today, but the path list keeps the commit
reviewable and keeps the ignored scratch `node_modules` out by construction.

---

## 3. Suggested commit message (ready to paste)

Subject:

    feat(naming): retire the upstream identity from shipped text and artifacts, with the wave's single vendor re-pin

Body:

    Owner rulings implemented (frozen in evidence/mpd-naming/final-allowlist/rule.json):
    (a) ast-grep omo_* identifiers -> mpd_*: skills/ast-grep/scripts/ast_grep_helper.py (mpd_env_binary,
        mpd_runtime_slug, mpd_runtime_binary) + tests/smoke.sh + AGENTS.md labels; `git grep omo_ --
        skills/ast-grep` = 0, and the smoke suite exercises the renamed calls (15 PASS / 0 FAIL).
    (b) codegraph [senpi]/MIGRATION_ID and the lsp .codex discovery defaults are KEPT and allowlisted:
        codegraph dist/serve.js:8819/:8877 MIGRATION_ID + the [upstream]/[senpi] migration reads, and
        lsp dist/cli.js:366/:367 .codex/lsp-client.json + .codex/lsp-install-decisions.json.
    (c) git-bash OMO_CODEX_* DELETED: the env-key declaration, the env-lookup tier, the install hint and
        the two prefixed timeout keys are gone from packages/mpd-mcp-gitbash/dist/cli.js (22651 -> 22137 B);
        repo-wide `grep -n OMO_CODEX` = 0 (was 3 dist + 6 build-mcp literals).

    Dists lane: scripts/build-mcp.mjs narrative sweep (bm-01..bm-17, BRAND_ALLOWLIST now empty by design)
    with the scrub tables rebuilt; dists are byte-reproducible from the script (t14 evidence).
    Text lane: the OMO identity is retired from the manual, READMEs, package descriptions and the roster
    data; the cross-agent skill was purged and the corpus figures corrected.
    Docs lane: docs/omo-parity-ledger{,.zh-CN}.md -> docs/upstream-parity-ledger{,.zh-CN}.md (both
    languages in one change, language-switch links under each title, hub rows retargeted on href + text +
    description) and tests/overlays/omo-bline.yml -> tests/overlays/bline.yml.

    VENDOR_LOCK.json — THE WAVE'S SINGLE RE-PIN, computed on the settled bytes after two >=50 s
    byte-identical reads (AGENTS.md 7/9/11): skills 297 files / treeSha
    a0f1febb4111d5884c9af3385963b06753c3f5a38423f7b66f6852c284725f95; mpd-mcp-gitbash/dist/cli.js sha256
    6458a82ee2cfcec319a03d2ffe8100c695d0980e7a366408fa5ef1467ca157b5; mpd-mcp-lsp/dist/cli.js sha256
    a7cebcf9ec79ec480c98d3a9cd1392837927ada57bf9bbb18e0620ba863f3148; lockedAt 2026-09-14T10:15:51.000Z.
    _deps (635/d1d10603...), astgrep (f06bba31...) and codegraph (ab287cdc...) were recomputed and are
    unchanged. The re-pin rides in this commit together with all four skills/** edits, as ruled.

    History stays byte-identical: no pre-existing evidence file is modified or deleted (0 of 3673 tracked
    evidence paths changed since 3c1a850), the 6 evidence paths in this wave's diff are pure additions, and
    docs/plan-*.md, docs/omo-parity-gap.md, docs/decisions.md and the prior-phase reports are byte-identical
    by explicit sha256 compare.

    Gates (exit codes): verify-vendor 0 (PASS, no FAIL line) - patch-agent-teams-fixes --check 0
    ("already applied: 40 mpd delta region(s) across 9 adopted file(s)") - typecheck 0 -
    bun test packages 408 pass / 0 fail - bun run test:qa 0 ("all self-tests passed").
    Verification: t18 PASS (0 blocking, 4 disclosed residuals); review: t19 PASS (0 high/blocker).
    Evidence index: evidence/mpd-naming/landing/raw/24-evidence-index.json.

    Known residuals (accepted, recorded): R1 the frozen KEEP KH-02 location moved with the rename
    (the historical wave id is still present, at docs/upstream-parity-ledger{,.zh-CN}.md:4);
    R3 nonEmptyEnvValue() is now dead code in the git-bash dist; R4 the _omo -> _mpd lsp envelope rename
    breaks an already-running version-scoped daemon loudly (AUTH_ERROR_CODE -32001, then
    DaemonUnreachableError) - remedy: restart or clear ~/.mpd/lsp-daemon/v<version>.

---

## 4. Gate summary

| gate | command | exit | source |
|---|---|---|---|
| vendor | `node scripts/verify-vendor.mjs` | **0** — `[verify-vendor] PASS`, no FAIL line (skills 297 files, _deps 635, 4 dists) | t20 re-ran (`raw/29-verify-vendor.log`); t18 and t19 also measured 0 |
| delta check | `node scripts/patch-agent-teams-fixes.mjs --check` | **0** — "already applied: 40 mpd delta region(s) across 9 adopted file(s)" | t20 re-ran (`raw/30-patch-check.log`); t18 measured 0 |
| typecheck | `bun run typecheck` | **0** | t18 (`verification/raw/gates/42-typecheck.log`); t19 re-ran 0 |
| plugin suite | `bun test packages` | **0** — 408 pass / 0 fail | t19 (`t19-review.json`.`gates_run_by_reviewer`) |
| adopted-plugin suite | `bun test packages/mpd-agent-teams-plugin` | **0** — 206 pass / 0 fail, 1457 expect() | t18 (`verification/raw/gates/43-agent-teams-tests.log`) |
| QA self-tests | `bun run test:qa` | **0** — "all self-tests passed" | t18 (`verification/raw/gates/44-test-qa.log`) |
| status / diff verify | `git status --porcelain` (50 lines) · `git diff --name-only 3c1a850` (55 paths) | **0** / **0** | t20 ran (`raw/27-verify-status.log`, `raw/28-verify-diff-3c1a850.log`) |

Not re-run here on purpose: the full sweep was executed by t18 at this revision and the review re-ran three
of its gates; t20's contract is assembly, and re-deriving the sweep would duplicate settled evidence.

---

## 5. Decisions the captain should record in the landing notes

1. **Scratch tree**: land it (8.8 MB, 1208 files, t14's reproducibility proof) or exclude it with the
   pathspec above — either way say which, because the exclusion changes what "the wave's evidence" means.
2. **F2 (t19)**: the frozen rename target was `docs/parity-ledger{,.zh-CN}.md`; the landed name is
   `docs/upstream-parity-ledger{,.zh-CN}.md`. The landing keeps the landed name and the freeze text is not
   edited (ruling R17) — an intentional, recorded divergence.
3. **The single re-pin must ride with the skills set** (t19 F1): `VENDOR_LOCK.json` is in the path list, and
   all four `skills/**` edits are too; do not commit either without the other.
