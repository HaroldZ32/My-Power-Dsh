# Case-corpus inventory & migration table (mpd) — companion to `standard.md`

**Task**: t9 (`work`, Planner, design-only) · **Date**: 2026-09-13 · **HEAD**: `32ae54dd10db7ea46e1c1263143d56f266fd1f78`
**Purpose**: enumerate *every* test-case asset in `/root/dshProj/my-power-dsh`, classify it, and give the
repair task (t8) the exact disposition, the coupled-file map and the machine-checkable acceptance — so
that after the repair the corpus carries no RTL/EDA case and nothing is silently dropped.
**Companion**: `standard.md` (the normative rules C1–C7 / A1–A10 / R1–R6 and the worked example).
All lists below were produced by the commands quoted in the sections; raw logs in `raw/`.

---

## 1. Method and anchors

| Item | Value |
|---|---|
| HEAD at measurement | `32ae54dd10db7ea46e1c1263143d56f266fd1f78` (`chore(lsp-setup): retire the orphan HDL pages … (t17)`) |
| Working tree | clean except untracked evidence dirs (§10) |
| Baseline `bun run test:qa` | **exit 0**, 25 scripts, every `--self-test` green (`raw/test-qa-baseline.log`) |
| Case scripts | `ls skills/dsh-qa/scripts/*.mjs` → 25 files |
| SKILL.md rows | 24 rows (via `grep -oP '^\|\s*\K[a-z0-9][a-z0-9-]*(?=\s*\|)'`) |
| Golden fixtures | `tests/golden/fixtures/{math.js,math.bench.mjs,verilog/**}` |
| Silicon sibling | `/root/dshProj/my-power-dsh-silicon` (present; used only for the sha256 parity checks) |
| Settled hashes | `raw/settled-hashes-*.txt` (SKILL.md `e174a178…`, `rtl-verif.mjs c5d2414c…`, `rtl-ip-profile.mjs 74f1cee9…`, `dual-track-smoke.mjs 6cff9b97…`, `verify-rtl-references.mjs 34a1c8d6…`, `development.md 0ed75394…`, `development.zh-CN.md aea3b35f…`, `adder4.md 169c9e26…`, `cnt8.md 150cfdc8…`, `AGENTS.md 0c7e543e…`) |

---

## 2. Case inventory (all 25 scripts)

Type: **SOFTWARE** = subject is the harness/bundle software surface (per `standard.md` §1);
**RTL/EDA** = subject needs an HDL artifact or an EDA toolchain. "Row" = a `SKILL.md` case-table row.

| # | slug (`skills/dsh-qa/scripts/`) | Subject (one line) | Type | Row | Silicon coupling | Disposition |
|---|---|---|---|---|---|---|
| 1 | `mount-assert` | `--dump-config` contains/lacks expected rows | SOFTWARE | yes | none | KEEP |
| 2 | `dual-track-smoke` | both DeepSeek routes serve a real headless task (dev-flavor boot) | SOFTWARE | **no — row is `llm-dual-track`** | none | KEEP + fix C1 (rename the row to `dual-track-smoke`) |
| 3 | `mcp-call` | ast-grep / lsp MCP servers callable, sandboxed home | SOFTWARE | yes | none | KEEP |
| 4 | `preset-register` | mpd preset resolves from the bundle-served root + roster serves 11 roles | SOFTWARE | yes | none | KEEP |
| 5 | `codegraph-smoke` | codegraph binary resolve → init → real tool call | SOFTWARE | yes | none | KEEP |
| 6 | `agent-teams-adopt` | agent-teams adoption wiring + stateDir override + archive on delete | SOFTWARE | yes | none | KEEP |
| 7 | `ultrawork-smoke` | plan gate / rounds / verification gate / ledger | SOFTWARE | yes | none | KEEP |
| 8 | `plan-c-smoke` | config + boulder + hashline tools in one session | SOFTWARE | yes | none | KEEP |
| 9 | `memory-smoke` | memory write → commit → read → reflection hint | SOFTWARE | yes | none | KEEP |
| 10 | `vision-smoke` | deterministic PNG + real vision route, image-grounded answer | SOFTWARE | yes | none | KEEP |
| 11 | `tool-output-validation` | tool results are host-validated lossless JSON | SOFTWARE | yes | none | KEEP |
| 12 | `skill-catalog-probe` | corpus served from `<bundle>/skills`, no home copy | SOFTWARE | yes | none | KEEP |
| 13 | `relocate-smoke` | relocated package installs with zero fixed checkout paths | SOFTWARE | yes | none | KEEP |
| 14 | `team-route-rewire` | staged install serves agent-teams from the bundle + preset conventions | SOFTWARE | yes | none | KEEP |
| 15 | `workmate-library` | init→list→spawn→reflect→match against a sandbox HOME + routes | SOFTWARE | yes | none | KEEP + §7 exemption (sample task text says "Verilog") |
| 16 | `workmate-team-member` | workmate joins a team, injects memory, self-reflects | SOFTWARE | yes | none | KEEP |
| 17 | `web-client-adapt` | web boot graph + `/plugins/...` routes + client ids | SOFTWARE | yes | none | KEEP |
| 18 | `agent-teams-dispatch` | scheduler wakes the next batch; delivery seam contract | SOFTWARE | yes | none | KEEP |
| 19 | `session-start-team` | session-start team policy stages an 11-member team | SOFTWARE | yes | none | KEEP |
| 20 | `bundle-lifecycle` | one-command install/uninstall, adapter seams, no residue | SOFTWARE | yes | none | KEEP |
| 21 | `preset-conformance` | installed-harness row schemas + preset mount + negative control | SOFTWARE | yes | none | KEEP |
| 22 | `agent-teams-sidebar` | GUI sidebar tab auto-open + served client bytes | SOFTWARE | yes | none | KEEP |
| 23 | `readonly-deny` | read-only spawn really restricted (stub-driven, no credential) | SOFTWARE | yes | none | KEEP — the pattern donor for `standard.md` A6/A10 |
| 24 | `rtl-ip-profile` | the `rtl-ip` roster profile (bundle patch + silicon preset data) | **RTL/EDA** | yes (`SKILL.md:62`) | **yes** (`SILICON` const) | **RETIRE** (R1/R2) — coverage → silicon §8 |
| 25 | `rtl-verif` | RTL verification deliverable: `mpd_verif_*` tools, cocotb/iverilog/verilator/VCS/UVM, HDL LSP, corpus trees | **RTL/EDA** | **no** (row removed by the strip) | **yes** | **RETIRE** (R1) — coverage → silicon §8 |

**Silicon coupling today is exactly the two retired cases**
(`git grep -ln "my-power-dsh-silicon\|MPD_SILICON_ROOT" -- skills/dsh-qa/` → `rtl-ip-profile.mjs`,
`rtl-verif.mjs`). After the repair the mpd corpus has **zero** cross-repo coupling.

Both retired cases' self-tests are green today only because the silicon checkout is present
(`raw/test-qa-baseline.log:45,47`): `rtl-ip-profile` asserts the silicon preset/skill/templates and
`rtl-verif` asserts the silicon patch/`dist` surface. That is the evidence that their subject **is**
the silicon bundle, and that mpd's corpus is the wrong home for them.

---

## 3. Row ↔ script reconciliation (C1)

```bash
diff <(ls skills/dsh-qa/scripts/*.mjs | xargs -n1 basename | sed 's/\.mjs$//' | sort) \
     <(grep -oP '^\|\s*\K[a-z0-9][a-z0-9-]*(?=\s*\|)' skills/dsh-qa/SKILL.md | grep -v '^slug$' | sort)
```
Measured (exit 1):
```
6c6
< dual-track-smoke
---
> llm-dual-track
16d15
< rtl-verif
```
| Defect | Meaning | Fix |
|---|---|---|
| `dual-track-smoke` vs `llm-dual-track` | one case, two names | rename the row to `dual-track-smoke` (the script name is the slug; the row text keeps its content) |
| `rtl-verif` with no row | orphan script left by the strip (`removal.log:106` removed the row, `:112` kept the script) | the retirement in C2 deletes the script — the mismatch disappears with it |

Target after t8: the command prints nothing.

---

## 4. RTL/EDA binary assets outside the case corpus

### 4.1 Golden RTL fixtures — duplicates already in silicon (sha256-verified)
```bash
for f in tb/tb_adder4.v modules/adder4.v modules/cnt8.v README.md; do
  sha256sum tests/golden/fixtures/verilog/$f /root/dshProj/my-power-dsh-silicon/tests/golden/fixtures/verilog/$f
done
```
| Path (mpd) | sha256 (16 chars) | silicon copy | Verdict |
|---|---|---|---|
| `tests/golden/fixtures/verilog/tb/tb_adder4.v` | `0e43651a69d32111` | IDENTICAL | retire (no content loss) |
| `tests/golden/fixtures/verilog/modules/adder4.v` | `ab0d0cbcb4fb1ae1` | IDENTICAL | retire |
| `tests/golden/fixtures/verilog/modules/cnt8.v` | `eeecd69467ecd5e2` | IDENTICAL | retire |
| `tests/golden/fixtures/verilog/README.md` | `1b7a16381dffdd1b` | IDENTICAL | retire |

These are RTL/EDA **development test assets** (the user's directive names them explicitly: future
development cases are software-type). They are not discovered by `bun test`
(`math.bench.mjs:5` documents the convention) and nothing in `package.json` runs them.

### 4.2 Golden reference docs for those fixtures — also duplicates
| Path (mpd) | sha256 | silicon copy | Verdict |
|---|---|---|---|
| `docs/adder4.md` | `169c9e264c429d69` | IDENTICAL (`silicon/docs/adder4.md`) | retire |
| `docs/cnt8.md` | `150cfdc8bc4f51b2` | IDENTICAL (`silicon/docs/cnt8.md`) | retire |

Both are marked "Internal QA artifact — golden-fixture reference doc" and cite the fixture paths;
after the fixtures move they are silicon content.

### 4.3 Software-type golden assets — KEEP
`tests/golden/fixtures/math.js` + `math.bench.mjs` (a seeded-bug fixture, run explicitly, RED by
design) and `tests/golden/out/**` (historical run outputs) are software-type; the worked example's
golden variant should follow the `math.bench.mjs` convention (`standard.md` §6). `tests/mcp-fixtures/sample.c`
is a software fixture — KEEP.

### 4.4 Workspace-local RTL residue (untracked / gitignored)
| Path | State | Disposition |
|---|---|---|
| `.venv-rtl/` (cocotb venv) | untracked, gitignored (`.venv-rtl/`, `.venv*/`) | t8 deletes it (t8 contract item 3); nothing depends on it (`rtl-verif.mjs` treats its absence as a printed SKIP) |
| `.mpd/verif/{logs,sim}/` | untracked runtime state | t8 deletes it |
| `.toolchain/` verible/HDL entries | `.toolchain/node_modules/.bin` holds only `ast-grep`, `codegraph`, `comment-checker`, `sg` — **no HDL binary present**; nothing to delete, but the `lsp` row's HDL templates are already migrated (t16) | verify only: `ls .toolchain/node_modules/.bin` |
| root scratch `20260911T094211Z.tmp` | untracked (`*.tmp` gitignored) | t8 deletes it (t8 contract item 3) |
| `.gitignore` RTL rules (`.venv-rtl/`, `simv_iverilog`, `.sim_build/`, `obj_dir/`, `*.o`, `*.a`, `compile.log`) | protective ignore rules, not functionality | **KEEP** (exemption §7): deleting them risks committing compiled objects if any lane ever runs an EDA tool; a 3-line cleanup is a listed follow-up, not part of the minimal repair |

---

## 5. RTL docs: divergence and the dangling case reference (t20 adjacency)

```bash
for f in rtl-verif-guide.md rtl-verif-guide.zh-CN.md rtl-ip-flow-guide.md rtl-ip-flow-guide.zh-CN.md \
         rtl-gap-assessment.md rtl-gap-assessment.zh-CN.md; do
  sha256sum docs/$f /root/dshProj/my-power-dsh-silicon/docs/$f
done
```
| Doc pair | mpd vs silicon | Consequence |
|---|---|---|
| `rtl-ip-flow-guide{,.zh-CN}.md` | IDENTICAL | t20 deletion is a no-loss delete |
| `rtl-verif-guide{,.zh-CN}.md` | **DIFFER** | t20 must reconcile before deleting the mpd copies |
| `rtl-gap-assessment{,.zh-CN}.md` | **DIFFER** | same; also the docs that describe the golden fixtures |

**Dangling reference created by the retirement:** `docs/rtl-verif-guide.md:255` and
`docs/rtl-verif-guide.zh-CN.md:241` point at `skills/dsh-qa/scripts/rtl-verif.mjs`; the silicon
copies repeat the claim (`silicon/docs/rtl-verif-guide.md:74,256-257`). After t8 deletes the script
the reference is dead. Recommended: leave the six RTL docs to t20 (they are silicon-bound and
carry a "being moved" banner) and record the dangling reference as a **DEFERRED** item with owner
t20 in `repair/report.md`; the alternative (t8 repointing those two lines in the mpd EN+ZH pair) is
allowed but larger. Either way it is recorded, never silently dropped. → captain decision §9.1 of
`standard.md`.

---

## 6. Inbound-reference map (per retirement target → exact action)

Line anchors are from HEAD `32ae54dd…`; every target below is inside the tracked tree.

| Retired / changed path | Inbound reference | Action |
|---|---|---|
| `skills/dsh-qa/scripts/rtl-verif.mjs` | `scripts/verify-rtl-references.mjs:26` (`CASES`) | drop from `CASES` (→ `[]`, C5) |
| | `skills/dsh-qa/scripts/dual-track-smoke.mjs:21` (comment "preset-register/rtl-verif pattern") | reword to name live cases only |
| | `docs/rtl-verif-guide.md:255`, `.zh-CN.md:241`, silicon copies | DEFERRED → t20 (§5) |
| | `.silicon-extraction/removal.log:112,132`, `t5-closure-evidence/t5-closure.md:104-107`, `evidence/dsh-qa/rtl-verif/**` | **history — untouched** (R6) |
| `skills/dsh-qa/scripts/rtl-ip-profile.mjs` | `skills/dsh-qa/SKILL.md:62` (row) | delete the row (R1) |
| | `scripts/verify-rtl-references.mjs:26` (`CASES`) | drop from `CASES` |
| | `.silicon-extraction/removal.log:113,133`, `evidence/dsh-qa/rtl-ip-profile/**` | **history — untouched** |
| `tests/golden/fixtures/verilog/**` | `docs/rtl-gap-assessment.md:29,180,183,243` + `.zh-CN.md:25,166,169,219` | one status line in the pair (post-extraction: fixtures live in silicon) — or the same DEFERRED-to-t20 route as §5; the paths must not stay presented as current |
| | `docs/adder4.md:3,7`, `docs/cnt8.md:3,7` (source-file pointers) | files retire together |
| | `scripts/verify-rtl-references.mjs:31-32` (`PENDING` entries for `docs/adder4.md`/`docs/cnt8.md`) | drop the two PENDING entries |
| | `AGENTS.md:18-19,144` (the "internal QA/golden reference docs (adder4.md, cnt8.md)" clauses) | rewrite the clauses (docs/ has no RTL golden refs any more) |
| `docs/adder4.md`, `docs/cnt8.md` | `AGENTS.md:18-19,144`; `docs/rtl-gap-assessment*.md` (§5) | as above |
| stale `verif` row / RTL-guide pointer | `packages/mpd-bundle/README.md:8,11`; `README.zh-CN.md:4` | bilingual pair: drop `mpd-verif` from the plugin list, re-point or remove the `docs/rtl-verif-guide.md` pointer |
| new case `software-smoke` | `skills/dsh-qa/SKILL.md` (row + C3 sentence); `docs/development.md` + `.zh-CN.md` §4 catalog | add both (C3/C4) |
| corpus rule (C3) | `AGENTS.md:367` ("New case checklist") | add one clause: cases are software-type; RTL/EDA cases belong to the silicon sub-bundle; pointer to `standard.md` |
| `VENDOR_LOCK.json` | every `skills/**` edit above | exactly ONE re-pin, same commit, value from `verify-vendor` output (C7) |

Not in the table because nothing references them: the two retired cases have **no** other callers
(`git grep -nE "rtl-verif|rtl-ip-profile" -- . ':!evidence' ':!docs/rtl-*' ':!.silicon-extraction' ':!t5-closure-evidence'`
returns only the lines listed above).

---

## 7. Explicit exemptions (recorded rulings, not silent passes)

| Item | Why it is not an RTL/EDA case | Ruling |
|---|---|---|
| `skills/dsh-qa/scripts/workmate-library.mjs:19,23,129` — "Verilog counter specialist", "implement a verilog counter and verify", `note.includes("Verilog")` | the subject is the **workmate library** (init/spawn/match/reflect); the HDL words are sample task text, and the case's live lane runs a real model | **KEEP as-is** this repair; the 3-line reword + assertion update is a listed optional cleanup that would require re-running the credential-needing live lane. C2b's lexicon does not match `verilog`? — it does; this file is the one expected exception and is named here so the C2b probe result is interpreted, not silently ignored |
| `packages/mpd-agent-teams-plugin/self-fix-tests/scope-glob-and-contract.test.mjs:9,56` — `packages/mpd-verif-plugin/test/**` strings | a **glob-engine fixture string** pinning `pathMatchesScope` semantics (`**` crosses separators); it is not packaging data and the file is part of the adopted plugin's self-fix suite with its own evidence trail | **KEEP**; rewriting it would invalidate the delta-registry/self-fix evidence for zero benefit |
| `docs/rtl-*.md` (6 files) | silicon-bound docs with a migration banner | leave to t20 (§5, §9.1 of `standard.md`) |
| `.gitignore` RTL rules | protective scratch rules | KEEP (§4.4) |
| `evidence/dsh-qa/rtl-verif/**`, `evidence/dsh-qa/rtl-ip-profile/**`, `.silicon-extraction/removal.log`, `t5-closure-evidence/**` | process records | **never rewritten** (R6) |
| `package.json` `test:qa:all` (differs from `test:qa` only in its log label) | pre-existing redundancy, not an RTL trace | leave; note in the report (C6) |

---

## 8. Where the retired coverage goes (no silent drop — R3)

| Retired case | Coverage | New owner | State after the repair |
|---|---|---|---|
| `rtl-verif` | silicon bundle composition (4 additive rows) + `mpd_verif_*` tool flow on a golden adder (lint/sim/cocotb/regression, iron rule) | **silicon repo** (`@mpd-dsh/silicon`: owns `mpd-verif-plugin`, the RTL corpus, the `rtl-ip` profile, the HDL LSP templates) | mpd keeps **no** RTL case; the silicon repo's own QA is a named follow-up there |
| `rtl-ip-profile` | the `rtl-ip` roster profile served as data | **silicon repo** (owns `presets/rtl-ip.profile.json`; mpd's bundle patch deliberately stays free of an `rtl-ip` block — asserted by the case itself at `:87`) | same |
| `tests/golden/fixtures/verilog/**` + `docs/adder4.md`/`cnt8.md` | RTL golden benchmark fixtures + reference docs | **silicon repo** (byte-identical copies verified in §4.1/§4.2) | delete in mpd, zero loss |

This is a **scope decision** (the user's 2026-09-13 directive + the extraction's own bucket model),
not a silent gap. It must be stated in `repair/report.md` and in the t7 verdict report.

---

## 9. Acceptance instantiation (what t11 will measure)

| Rule | Today (measured) | Required after t8 |
|---|---|---|
| C1 | 2 mismatches (printed in §3) | `diff …` prints nothing |
| C2a | `rtl-ip-profile.mjs`, `rtl-verif.mjs` | `ls skills/dsh-qa/scripts \| grep -Ei '^(rtl\|verif\|hdl\|uvm)'` prints nothing |
| C2b | 3 files + 1 comment mention | `git grep -nEi 'iverilog\|verilator\|cocotb\|verible\|slang-server\|mpd_verif_\|systemverilog\|verilog\|rtl-ip\|rtl-verif' -- skills/dsh-qa` → only the §7 exempt `workmate-library.mjs` sample line (or nothing, if the captain opts for the reword) |
| C2c | `tests/golden/fixtures/verilog` present | directory gone |
| C3 | sentence absent | present in `SKILL.md` |
| C4 | catalog lacks the case | `grep -c software-smoke docs/development.md docs/development.zh-CN.md` ≥ 1 each |
| C5 | gate scope claims two mpd cases | exit 0 + disclosure line `mpd-side cases: 0 …` |
| C6 | `test:qa` exit 0 over 25 scripts | exit 0 over 24 scripts, `software-smoke` listed, retired slugs absent |
| C7 | lock consistent (`verify-vendor` exit 0) | one re-pin; `verify-vendor` exit 0; `fileCount` = the script's own measured value |
| A1–A10 (new case) | — | `software-smoke` self-test green, real lane `ok=true`, evidence under `evidence/dsh-qa/software-smoke/<ts>/` |

---

## 10. Provenance of the sweep

| Check | Command | Raw output |
|---|---|---|
| corpus baseline | `bun run test:qa` | `raw/test-qa-baseline.log` (exit 0) |
| rows ↔ scripts | §3 command | `raw/skill-case-table.txt` |
| RTL content probe | §2 C2b grep | this file §2/§3 (re-run in `repair-verify` by t11) |
| silicon parity | `sha256sum` pairs (§4.1, §4.2, §5) | §4/§5 tables |
| prototype lanes | `standard.md` §5.5 | `raw/software-smoke-selftest.log`, `raw/software-smoke-real.log`, `raw/prototype-evidence/` |
| anchors | `git rev-parse HEAD` + `sha256sum` of the touched files | `raw/settled-hashes-*.txt` |

Working-tree note for t11's `git status --short`: at measurement time the untracked entries were
`evidence/rtl-extraction-residual/` (this audit) and two sibling case evidences
(`evidence/dsh-qa/bundle-lifecycle/…`, `evidence/dsh-qa/preset-conformance/…` — other members'
runs). The repair's own `git status` must be read against that baseline, not against an empty tree.
