# t33 — X8 final verification (wave gate)

**Pin**: HEAD `32ae54dd` · porcelain **before 75 → after 77**; the delta is exactly two evidence dirs
this run produced (`evidence/dsh-qa/bundle-lifecycle/…`, `evidence/dsh-qa/preset-conformance/…`) —
**no repo file modified, nothing committed** (`raw/status-before.txt` / `status-after.txt`, `raw/head.txt`).
**Method**: every number below was produced by a command I ran in this task; lane summaries were used
only to know *what* to test, never as evidence.

## 1. Gates — my own runs, exit codes, logs in `raw/`

| Command | Exit | Log |
|---|---|---|
| `bun run typecheck` | **0** | `raw/g-typecheck.log` |
| `bun test packages` | **0** (298 pass) | `raw/g-bun-test.log` |
| `node scripts/verify-vendor.mjs` | **0** (PASS) | `raw/g-verify-vendor.log` |
| `node scripts/verify-rtl-references.mjs` | **0** | `raw/g-verify-rtl-refs.log` |
| `node scripts/verify-rows-parity.mjs` | **0** | `raw/g-verify-rows.log` |
| `node scripts/patch-agent-teams-fixes.mjs --check` | **0** | `raw/g-delta-check.log` |
| `bun run test:qa` | **0** (all self-tests passed, **0 SKIP** lines) | `raw/g-test-qa.log` |
| `bun run test:qa:strict` | **0** | `raw/g-test-qa-strict.log` |
| `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | **0** | `raw/g-bundle-lifecycle.log` |
| `node skills/dsh-qa/scripts/preset-conformance.mjs` | **0** | `raw/g-preset-conformance.log` |

## 2. Lane reproduction

| Lane | My measurement | Verdict |
|---|---|---|
| **X4** guard | `scripts/build-mcp.mjs` carries every vector (`OMO_PROVISION_HINT`, `omoRuntimeCandidates`, `omo/ping`, `omo-git-bash`, `platformFromOptions`); a **seeded foreign token is detected** by the guard's pattern list (`["omo/ping","omoRuntimeCandidates"]`), while the committed git-bash bytes contain **0** of them (`raw/lane-checks-2.txt`) | **partially reproduced**: matcher-level negative control executed; the full end-to-end guard run was t32's (`followup/raw/x4-brand-guard-probe.mjs`, 7/7) and I did not re-run it |
| **X5** placeholder/locks | `the upstream project` = **0** in `scripts/build-mcp.mjs` **and** all three `packages/mpd-mcp-*/dist/BUILD.lock` (astgrep/gitbash/lsp; codegraph has no lock). Every BUILD.lock's `artifact.sha256` **and** `bytes` **AGREE** with its `cli.js`; all three `source: "8c57e46"` | **reproduced** |
| **X5** git-bash artifact chain | `cli.js` sha `0484a8ff1714c949…` / 22651 B = BUILD.lock artifact = **VENDOR_LOCK** entry | **reproduced (agreement)** |
| **X5** bun.lock | 19 workspace-capable dirs (have `package.json`) vs **19 lock entries, 0 missing, 0 ghosts**; the three dirs absent from the lock text (`mpd-codegraph-plugin`, `mpd-mcp-codegraph`, `mpd-mcp-shared`) have **no `package.json`**, so they are not workspaces — my initial 4-"missing" read was a false alarm I then disproved (`raw/lane-checks-3.txt`) | **VERIFIED-BY-MEASUREMENT** (lock internal consistency); t27's `bun install --frozen-lockfile` **exit 0** remains **CLAIMED-by-t27**, not re-run by me |
| **X6** declaration | README pair carries the new declaration; repo-wide grep for `fork`/`port of`/`移植` (tracked, non-historical) returns only the **negation** ("它不是 … 移植版"), descriptive uses (`上游移植 skill`, the `PLAN.md` link) and the **adopted upstream docs** (`packages/mpd-agent-teams-plugin/README*.md`, verbatim provenance) | **partially reproduced**: no unexempted port/fork **claim** found; the EN/zh-CN sentence-by-sentence 1:1 mapping was **not** exhaustively verified |
| **X7** relocate/route/skill lanes | pack-present `test:qa` = exit 0 with **0 SKIP** lines; all three converted case scripts carry `--no-skip` | **pack-present side reproduced**; the **fresh-clone 3-SKIP lane** and the full AM1–AM7 matrix were **not re-run by me** (t31's measurement stands un-refuted, not independently confirmed). A literal grep for the marker text is inconclusive because the markers are constructed, not literal strings |
| **X7** single skills re-pin | `VENDOR_LOCK.assets.skills` = `fileCount 328`, `treeSha bb52bff419…`; `verify-vendor` PASS on the final state | **reproduced** |

## 3. Negative controls

* **Executed**: X4 seeded-token control (a synthetic payload containing `omo/ping` + `omoRuntimeCandidates`
  is matched by the guard's pattern list; the committed bytes contain neither).
* **Executed**: X5 placeholder control (the same grep vector returns **0** across 4 files, and the three
  BUILD.lock artifacts independently agree with their files, so a "0 because the file is empty" reading
  is excluded).
* **NOT executed by me**: an end-to-end flip of the brand guard to non-zero (t32's 7/7 probe is the
  evidence), the X7 present-but-broken-pack case (AM3), and any X6 textual falsification control.

## 4. Freshness and what is NOT verified

* Revision pinned at `32ae54dd`; status before/after differ **only** by this run's two evidence dirs.
* **NOT verified by me**: (1) the end-to-end brand-guard run; (2) the X7 fresh-clone suite (3 SKIP lines)
  and the AM1–AM7 matrix, including the present-but-broken-pack control; (3) the X6 EN/zh-CN
  1:1 sentence mapping (spot-checked only); (4) t27's `bun install --frozen-lockfile` claim — I verified
  the lockfile's internal consistency instead and label that claim **CLAIMED**.
* No `--dump-config` was used anywhere, and no result is quoted from another lane's summary.
