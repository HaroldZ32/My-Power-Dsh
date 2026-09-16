# t12 delivery ledger — external-plugin adaptation wave

Integration record written by **Lead** (task `t12`, attempt 1, attempt id
`fb883675-75f7-4407-b6ff-f01afffc9581`). Domain: the `mpd-ext` extension interface (PLANE 2) and the
install plane (PLANE 1), audited and documented — **no source change is part of this wave**.

## 0. Revision pin, and the moving-target event

| Fact | Value |
|---|---|
| HEAD | `8777e4340f8b4cd0a8d0c0ac683054523d4b5739` (2026-09-16 12:37:59 +0800) |
| Worktree | **DIRTY / UNCOMMITTED** — this whole wave lives in the working tree; the captain is the only git writer |
| Report pair, settled revision | EN `0ebfadb5e3b4f3adcb289a2d8dcf3bff85c280582aa9697c28428824beb64b37` (361 lines, mtime 13:30:18) · ZH `b5adfbda661adef78e5d6d0068abb4adddaa75e0010b2329570c259a7b133751` (166 lines, mtime 13:30:18) |
| Settle proof | identical at 13:30:18 → 13:32:2x (55 s window) **and** identical immediately before/after sweep B |

**Moving-target event (measured, not assumed).** At the start of this task (13:28:36 local) the report
pair was `eb3d385b…` / `a4906c5b…` — exactly the revision t24 reviewed PASS. While this integration was
running, **t21 (Senior Engineer, the report's residual/waiver record) wrote the pair twice**:
13:28:57/13:29:08 → `33604267…` / `c308fd6c…`, then 13:30:18 → the settled `0ebfadb5…` / `b5adfbda…`.
Sweep A therefore ran on the *t24-reviewed* revision and sweep B on the *settled* revision; **no gate
result below is attributed to a revision other than the one named for it.** All other deliverables were
byte-identical across both sweeps (verified by hash).

**Resolution of the event (measured after the sweep).** The two writes were **t21's own delivery**
(record-only — the residual/waiver content was already on disk in both twins — plus three additive
clauses) and **t22 then reviewed the settled revision with verdict PASS** at `0ebfadb5…` / `b5adfbda…`.
Those bytes are the ones pinned throughout this ledger, so the wave's headline artifact is review-covered
at exactly the revision recorded here. See §0.1 and §4.A.

## 0.1 Correction record (additive; the corrected artifact is NOT edited)

Per the captain's ruling, this ledger carries an **additive** correction for a wrong line-number field in
an evidence artifact — see **`CORRECTION.md`** in this directory (same record, full detail).

| Item | Value |
|---|---|
| Artifact | `evidence/extensions/t7-verify/20260916T045829Z/result.json` (sha256 `4c972fb1b64f4d1370e66fe09b61bc77ea186158daf2d56a11d8c3a071f29803`) |
| Field | `mountEvidence.lifecycleApplyLine` / `mountEvidence.mcpBridgeApplyLine` |
| Wrong values | lifecycle `output.log:37`; bridge `output.log:35` |
| Measured values | lifecycle **`output.log:40`** (all occurrences `:40 :50 :70 :80 :90` — the lane's five boots); bridge **`output.log:38`** |
| Identity of the misnamed lines | lifecycle `:37` = `[mpd-dsh-adapter] mpdDsh provided …`; bridge `:35` = `[mpd-config] settings bridge: registered the "mpd" namespace …` |
| Propagation | **closed**: the report pair was corrected under t23 and cites the measured lines at EN:155 / ZH:77 (`` `output.log:40` lifecycle, `output.log:38` bridge ``); `grep -n 'output.log:37\|output.log:35'` over both twins → no match (exit 1) |

The quoted line TEXT was always correct; only the numbers were wrong. The artifact is deliberately left
byte-untouched (its value is that it records what a run measured), which is why the correction is a
separate file named by digest rather than an edit.

## 1. Gate sweep (contract order, exit codes)

Raw output: `evidence/extensions/t12-integration/20260916T052836Z/output.log` (sweep A) and
`…/20260916T053019Z/output.log` (sweep B).

| # | Command | Sweep A (`eb3d385b…`/`a4906c5b…`) | Sweep B (settled `0ebfadb5…`/`b5adfbda…`) | Key line |
|---|---|---|---|---|
| 1 | `bun test packages/mpd-ext-plugin` | exit 0 | exit 0 | `66 pass / 0 fail / 531 expect() calls — Ran 66 tests across 4 files` |
| 2 | `bun scripts/mpd-ext.mjs --self-test` | exit 0 | exit 0 | `[mpd-ext] --self-test passed (19 checks)` |
| 3 | `bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example` | exit 0 | exit 0 | `[mpd-ext] ok` |
| 4 | `node scripts/verify-docs-parity.mjs` | exit 0 | exit 0 | `pairs=35 failed=0 violations=0 exempt=16 — PASS` (includes the report pair) |
| 5 | `node scripts/verify-vendor.mjs` | exit 0 | exit 0 | `[verify-vendor] PASS` |

Gate 5 is the blocking corpus gate: it passes with `VENDOR_LOCK.json`'s `skills.treeSha`
`7a48fdad90cc30f9c1e71009be216aeb8b2a1de797eb2bb1897032c41f6b51aa` — i.e. the wave's **single** re-pin
matches the t13-modified `skills/**` corpus. No second re-pin exists.

**No gate failed. No artifact named by a feeding task is missing** (all paths below were opened /
statted, hashed and, where applicable, re-hashed after the sweep).

## 2. Artifacts delivered (path · digest · what it proves · produced by · review state)

Digests are sha256, first 16 hex here, full values in `result.json`.

### 2.1 The headline deliverable (CL1/CL2)

| Path | Digest | What it proves | Produced by | Review state |
|---|---|---|---|---|
| `docs/extension-adaptation-report.md` | `0ebfadb5e3b4f3ad` | the bilingual current-state report: §1 verdict, §2 the two planes + who should use which, §3 capability inventory, §4 runtime/isolation posture, §5 what was live-verified, §6 F1–F11 risks, §7 P0/P1/P2 recommendations, §8 drift, §9 unverified list, §10 reproduction, §11 evidence index | t8, repaired t23, residual record t21 | t24 PASS on the **pre-t21** revision `eb3d385b…`; **the settled revision awaits t22** |
| `docs/extension-adaptation-report.zh-CN.md` | `b5adfbda661adef7` | zh-CN twin, same heading tree + switch link (gate 4) | t8 / t23 / t21 | same, `a4906c5b…` → settled |
| `docs/index.md` | `4d0ba0e5127040fc` | hub "Reading order" row linking the report pair (EN) | t8 | byte-identical across both sweeps |
| `docs/index.zh-CN.md` | `df82aa364d790cd0` | zh hub row | t8 | byte-identical across both sweeps |

### 2.2 The drift fixes (CL4)

| Path | Digest | What it proves | Produced by | Review state |
|---|---|---|---|---|
| `docs/extensions.md` | `f860593aedb45974` | D4/D5: the quoted example snippets now match `extensions/mpd-ext-example/` field-for-field (`serverName` `lint-mcp`, `personas/code-reviewer.md`); plus t17's role-refusal bullet + §6 table row | t9 (D1–D5), t17 | t11 PASS, t18 PASS |
| `docs/extensions.zh-CN.md` | `be0a8814aadf1f6b` | zh twin of the same | t9, t17 | t11 PASS, t18 PASS |
| `packages/mpd-ext-plugin/README.md` | `b60b960ccaf41444` | D1/D2/D3: the bridge **connects at apply** (never lazily), a partial generation is rolled back by the two-phase fetch/swap, and both host-wide kinds (mcp + roles) are live in v1 with the five-state server machine | t9 | t11 PASS |
| `packages/mpd-ext-plugin/README.zh-CN.md` | `5e4a1b174a6b70cd` | zh twin | t9 | t11 PASS |
| `docs/development.md` | `5c49dcaf2628e973` | D6 + T16-F1: `extension-isolation` is the shared proof helper, **not** a case lane, and has no lane mode — invoked without `--self-test` it does nothing | t15 (D6), t19 (wording) | t16 PASS, t20 PASS |
| `docs/development.zh-CN.md` | `64391712a2b0dab3` | zh twin | t15, t19 | t16 PASS, t20 PASS |
| `package.json` | `039d222f5de0593d` | t19 item 2: the vacuous `extension-isolation` member is gone from `test:qa:all` (26 members, every one resolves to a real case script) | t19 | t20 PASS |

### 2.3 The `skills/**` repair and the wave's single re-pin (not touched by t12)

| Path | Digest | What it proves | Produced by | Review state |
|---|---|---|---|---|
| `skills/dsh-qa/SKILL.md` | `b20d73118f4db8ce` | the extension rows no longer promise a packed arm that must be red | t13 (wave's single skills writer) | t14 PASS |
| `skills/dsh-qa/scripts/extension-mcp-bridge.mjs` | `3f2169889bc536b1` | the bridge lane's `schema` arm now asserts the shipped keep-or-drop rule | t13 | t14 PASS |
| `VENDOR_LOCK.json` | `d226534d3b2f9708` (`skills.treeSha` `7a48fdad…`) | the **single** corpus re-pin, riding the same change as the `skills/**` edit that invalidated it (AGENTS.md §9/§11) | t13 | gate 5 PASS |
| `scripts/pack-mpd.mjs` | `8beb91c3f62640b5` | the packer's positive-closure check caught a **missing `mpd-team-watchdog-plugin`** in `PLUGIN_PKGS` (the 4th occurrence of the silent-omission class, measured at `evidence/extensions/extension-lifecycle/2026-09-16T04-43-51.532Z/output.log:97`); the entry was added | the wave's repair round (t7/t13 lane) — **not t12** | bytes are exactly the `scripts/pack-mpd.mjs` sha256 t7 pinned in its lane-subject hash set (`8beb91c3…`) |

### 2.4 Source of truth for the drift fixes (pre-existing, untouched this wave)

| Path | Digest | What it proves |
|---|---|---|
| `extensions/mpd-ext-example/mpd-ext.json` | `72b395d6b9e388b4` | the shipped 4-kind example — the artifact D4/D5 were corrected **to** (untouched: `a647d47`) |
| `extensions/mpd-ext-example/server.mjs` | `6e8a2bde3d9c42d3` | its stdio server publishing `mcp__lint-mcp__describe_extension` (untouched: `4bc2157`) |

### 2.5 Live-verification evidence (CL3) — cited, never re-run by t12

| Evidence path | What it proves | Produced by |
|---|---|---|
| `evidence/extensions/t7-verify/20260916T045829Z/` | the wave's **only** live evidence: real mounted sandbox boot, extension E2E, the real MCP tool call read from the harness session log, isolation; `verdict: PASS`, anchored to HEAD `8777e43` **plus** the lane-subject sha256 pre/post/settle (HEAD alone is insufficient — the repair is uncommitted) | t7 attempt 2 |
| `evidence/extensions/extension-lifecycle/2026-09-16T04-58-41.378Z/` | lifecycle lane, all arms green | t7 |
| `evidence/extensions/extension-mcp-bridge/2026-09-16T04-59-18.173Z/` | bridge lane, all arms green incl. the corrected `schema` arm | t7 |
| `evidence/extensions/t13-repair/20260916T045324Z/` | the two red-arm repairs, the re-pin script/result, `verify-vendor.log`, the architect re-run | t13 |
| `evidence/extensions/t12-integration/20260916T052836Z/output.log` | sweep A on the t24-reviewed revision (5/5 exit 0) | t12 (this task) |
| `evidence/extensions/t12-integration/20260916T053019Z/{output.log,delivery-ledger.md,result.json,CORRECTION.md}` | sweep B on the settled revision (5/5 exit 0) + this ledger + the additive mount-evidence correction | t12 (this task) |

## 3. Review chain — terminal states with verdicts

| Chain | State |
|---|---|
| t1 requirements → **PASS** | terminal |
| t2/t3/t4/t5 inventories, t6 architecture assessment | terminal (t6 verdict delivered) |
| t7 real end-to-end verification | terminal, **PASS** (attempt 2; attempt 1 FAILED and is superseded) |
| t8 report → t10 review → **FAILED with findings** → t23 repair → t24 review → **PASS** | terminal |
| t9 drift fix → t11 review → **PASS** | terminal |
| t13 skills repair → t14 review → **PASS** | terminal |
| t15 D6 fix → t16 review → **PASS** → t19 follow-ups → t20 review → **PASS** | terminal |
| t17 role-refusal fix → t18 review → **PASS** | terminal |
| t21 residual record → t22 review | **terminal: t21 completed (record-only + three additive clauses); t22 verdict PASS at the settled revision `0ebfadb5…` / `b5adfbda…`** |
| t12 integration (this task) | terminal at this update |

## 4. Open / deferred items — one place

### A. CLOSED — the settled report revision IS review-covered
t21 landed (record-only: the residual/waiver content was already on disk in both twins; plus three
additive clauses) and **t22 returned verdict PASS at the settled revision `0ebfadb5…` / `b5adfbda…`** —
the pair's mtimes (13:30:18) and digests have not moved since, so no writer is licensed to change them.
Both PASS records now stand: t24 on the earlier revision `eb3d385b…`/`a4906c5b…` and t22 on the settled
one. Substance re-checked at the settled revision: t23's `code-read` caveats survive (§1 EN:20/:23,
ZH:11/:13), no `--dump-config` evidence is cited, and t24-F1's one-word citation fix IS applied (EN:221 /
ZH:97 cite `extension-lifecycle.mjs:377`, where the lane's `ok:` expression really is).
`node scripts/verify-docs-parity.mjs` was re-run on these exact bytes (exit 0) after t21/t22 landed, and
all 17 artifact digests re-matched. **No delivery condition remains** on the report pair.

### B. Waived `skills/**` drift (deliberately not fixed this wave)
- **F8** `skills/dsh-qa/scripts/extension-lifecycle.mjs:35-42` still narrates the pre-repair expectation
  and its packed arm still returns `greenOwner: "t11"` (`:386`).
- **F9** `skills/dsh-qa/SKILL.md:77` cites `extension-lifecycle.mjs:385` for "the case exits 0", but the
  arm's `ok` is true in both the GREEN and the RED state.
Waived, not overlooked: the corpus has ONE writer per wave and a second `skills/**` edit would force a
second `VENDOR_LOCK.json` re-pin; this wave's single re-pin is already spent on t13's schema-arm fix. Fold
both into the next wave's single re-pin.

### C. Report §9 — unverified / open questions (6, restated verbatim in substance)
1. F1 (silent adapter fallback) is reasoned from code + precedent, never reproduced live in a boot that
   misses `mpdDsh`.
2. The win32 branch of the child-env allowlist is code-read only; every live run was linux.
3. The §4 residuals (disk-readable credentials, author-declared `env` secrets, filesystem trust) are
   posture assessments, not executed exploits.
4. The eight stale evidence directories (F6) were inventoried, not re-run.
5. No test asserts that a *changed* extension directory is re-read only per call in the project plane.
6. The packed layout for extensions is asserted by the packer's closure check + the lane's packed arm —
   not by a fresh install of `dist/mpd-package/` into a clean profile in this wave.

### D. Recommendations NOT implemented this wave (report §7 says so explicitly)
- **P0** instrument the adapter fallback (`packages/mpd-ext-plugin/src/index.ts:207`,
  `packages/mpd-roles-plugin/src/index.ts:318`).
- **P1** one plane-selection decision rule (`docs/extensions.md` §4 + twin).
- **P1** document the child-env isolation posture and its accepted residuals (`docs/extensions.md` §5/§10 + twin).
- **P2** juxtapose the two liveness modes (`docs/extensions.md:524` + twin).
- **P2** cross-reference the adapter-mount hazard between the bundle-patch comment and the row comment.
- **P2** retire or re-run the stale evidence directories (F6).
- **P2** give R11 a test-suite home (`skills/dsh-qa/` + `.mpd/plans/dsh-tui-edition.md`).

### E. Other reported-not-fixed findings
- **F6** eight evidence directories predate extension code `c239407`: `mcp-bridge-framing`,
  `mcp-bridge-gates`, `registered-tool-schemas`, `sanitizer-crosscheck`, `roles-wiring` (×2),
  `v0.9.1-defect-fixes`, `extensions-repair/t16-pins-and-plane-guard`, `mpd-ext-repair/roles-report`.
- **F7** `evidence/mpd-ext-debranding/20260915T074904Z/verify-debranding.mjs:40-49` prints a claim broader
  than its probe (skill/flow fields only); it green-lit the bytes that carried D4/D5.
- **F2/F3/F4/F5/F10/F11** remain open risks/gaps as described in report §6.

### F. Nothing is committed
The entire wave is uncommitted in the shared worktree; the captain performs the commit(s) and the branch
work (AGENTS.md §5). Delivered set = the 12 modified paths in §2.1–§2.3 + the two untracked report files +
the untracked `evidence/extensions/**` directories listed in §2.5.

## 5. What t12 explicitly did NOT do

- No source-code change of any kind; no edits to any artifact owned by another task.
- Did **not** re-run the two real extension lanes (that evidence is owned by t7/t13 — cited, not re-derived).
- Did not touch `skills/**` or `VENDOR_LOCK.json`; did not commit, branch, checkout, reset or stash.
- Did not "fix" F6/F7/F8/F9 or any §4 item — they are reported here for the captain.

## 6. Reproduction

```bash
# gates, in contract order
bun test packages/mpd-ext-plugin
bun scripts/mpd-ext.mjs --self-test
bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example
node scripts/verify-docs-parity.mjs
node scripts/verify-vendor.mjs
# the report-pair pin
sha256sum docs/extension-adaptation-report.md docs/extension-adaptation-report.zh-CN.md
# sweep logs
cat evidence/extensions/t12-integration/20260916T052836Z/output.log   # sweep A (pre-t21 revision)
cat evidence/extensions/t12-integration/20260916T053019Z/output.log   # sweep B (settled revision)
```
