# X6 — declaration landed across the human-facing surfaces (implementation report)

**Task**: t26 · implementation round 1 · **Author**: Lead · **Attempt**: 1 (`ec34ac35-9d44-4dc3-9d8a-dcbe195e375a`)
**Date**: 2026-09-13 · **Pin**: `32ae54dd10db7ea46e1c1263143d56f266fd1f78` (`dev`), staged tree (nothing committed)
**Source of truth for the wording**: `evidence/rtl-extraction-residual/followup/x3-declaration-draft.md` (225 lines; facts F1–F14, rows A1–A8), as amended after the captain's rulings.
**Rule applied to every edit**: the repo-level port/fork/derivation claim is factually false (the pinned upstream commit object is absent locally and is not an ancestor of HEAD) → replaced by an independent-identity statement with SUL-1.0 + attribution stated as a **licence fact**; **per-file provenance statements stay**.

---

## 1. Apply set — re-measured ranges, before → after

Every range was re-measured immediately before the edit (the tree already carried other lanes' staged changes) and verified after.

| # | File | Range (pre-edit) | Before (first words) | After (first words) |
|---|---|---|---|---|
| 1 | `README.md` | 5 + 7-11 (contiguous 5-11) | "A DeepSeek-Harness plugin bundle that ports the portable capabilities of oh-my-openagent (OmO)." / "> **Fork declaration**: This project is a fork derived from …" | "**my-power-dsh** is an independent DeepSeek Harness (DSH) plugin bundle — the package `@mpd-dsh/mpd`, …" / "It is not the OMO DeepSeek-Harness port. Its provenance is factual rather than a lineage: …" + the licence blockquote |
| 2 | `README.zh-CN.md` | 5 + 7-10 (contiguous 5-10) | "my-power-dsh 是一个 DeepSeek-Harness 插件 bundle，移植了 oh-my-openagent (OmO) 的可移植能力。" / "> **Fork 声明**：本项目是 … 的 fork，做了深度修改；…" | "**my-power-dsh** 是一个独立的 DeepSeek Harness（DSH）插件 bundle —— 即包 `@mpd-dsh/mpd`：…" / "它**不是** OMO 的 DeepSeek Harness 移植版。它的来源是事实性的，而非血统关系：…" + 许可块 |
| 3 | `package.json` | 6 (description only) | `"my-power-dsh: DeepSeek Harness plugin-based port of the upstream project capabilities"` | `"my-power-dsh: an independent DeepSeek Harness plugin bundle (provenance: a pinned oh-my-openagent baseline)"` |
| 4 | `AGENTS.md` | §1, 29-33 | "**my-power-dsh** ports the portable capabilities of the upstream project (GitHub `code-yeongyu`; …" | "**my-power-dsh** is an independent DeepSeek Harness (DSH) plugin bundle. Its provenance is factual rather than a lineage: …" |
| 5 | `packages/mpd-memory-plugin/README.md` | 6-7 | "Focused port of the upstream project `memory-core` semantics (base 8c57e46, / SUL-1.0 fork terms): …" | "Adapted from the upstream package `memory-core` semantics (base 8c57e46; covered by / SUL-1.0): …" |
| 6 | `packages/mpd-memory-plugin/README.zh-CN.md` | 6 | "上游项目 `memory-core` 语义的聚焦移植（base 8c57e46，SUL-1.0 fork 条款）：…" | "改编自上游包 `memory-core` 的语义（base 8c57e46；依 SUL-1.0 授权）：…" |
| 7 | `packages/mpd-comment-checker-plugin/README.md` | 7-8 | "Vendored parser: the upstream project `packages/comment-checker-core` (base / 8c57e46, SUL-1.0 fork terms; `isRecord` inlined). …" | "Vendored parser: the upstream project `packages/comment-checker-core` (base / 8c57e46; covered by SUL-1.0; `isRecord` inlined). …" |
| 8 | `packages/mpd-comment-checker-plugin/README.zh-CN.md` | 7-8 | "Vendored 解析器：上游项目 `packages/comment-checker-core`（base 8c57e46，SUL-1.0 / fork 条款；`isRecord` 已内联）。…" | "Vendored 解析器：上游项目 `packages/comment-checker-core`（base 8c57e46；依 SUL-1.0 / 授权；`isRecord` 已内联）。…" |
| 9 | `packages/mpd-hashline-plugin/README.md` | 6-7 | "Vendored core: the upstream project `packages/hashline-core` (base commit / 8c57e46, SUL-1.0 fork terms). …" | "Vendored core: the upstream project `packages/hashline-core` (base commit / 8c57e46; covered by SUL-1.0). …" |
| 10 | `packages/mpd-hashline-plugin/README.zh-CN.md` | 6 | "Vendored core：上游项目 `packages/hashline-core`（base commit 8c57e46，SUL-1.0 fork 条款）。…" | "Vendored core：上游项目 `packages/hashline-core`（base commit 8c57e46；依 SUL-1.0 授权）。…" |

**Provenance text preserved EXACTLY** (verified after the edit): `Vendored core: the upstream project `packages/hashline-core` (base commit` (hashline EN:6) and `Vendored parser: the upstream project `packages/comment-checker-core` (base` (comment-checker EN:7). `packages/mpd-boulder-plugin/README{,.zh-CN}.md` — **no fork claim existed → touched nothing**.

**Bilingual discipline**: every reworded paragraph has its zh twin changed in the same pass; both READMEs keep their language-switch links directly under the title (`README.md:3` = `**English** | [中文](./README.zh-CN.md)`, `README.zh-CN.md:3` = `**中文** | [English](./README.md)`).

**Licence discipline verified**: "not MIT-licensed" appears once in `README.md` and "代码不是 MIT 许可" once in `README.zh-CN.md`; the MIT grant is attributed to the adopted `agent-teams` component only; SUL-1.0 + `code-yeongyu`/OmO attribution is explicit in both languages.

**Not touched** (explicit): `LICENSE.md` (inherited licence body), `VENDOR_LOCK.json`, `bun.lock`, `skills/**`, `PLAN.md`, `docs/decisions.md`, `docs/bline-report.md`, `docs/omo-parity-gap.md`, `docs/review-p0-p3.md`, `docs/track-a-report.md`, `docs/ulw-deepseek-optimization.md`, `docs/plan-c.md`, `docs/plan-d.md`, `docs/plan-f.md`, and every `evidence/` path except this task's own directory. `package.json`'s `scripts` field is untouched (only the `description` line changed) — the relocate lane owns it.

---

## 2. Exemption list (E1–E13) — for the wave verifier's whitelist

Each entry quotes the surviving text and gives the reason it is not a project self-declaration.

| Id | Path (line) | Quoted text | Reason |
|---|---|---|---|
| E1 | `skills/ast-grep/README.md:133` | "… this skill is a port of its pattern-hint detection and two-pass-write strategy." | Captain RULING 1: describes the SKILL's provenance to its original author; inherited third-party content; editing `skills/**` forces a corpus `treeSha` → VENDOR_LOCK re-pin owned by another lane. |
| E2 | `skills/ast-grep/AGENTS.md:7` | "… vendored as a sync; do not fork-drift …" | Same `skills/**` exemption; a vendoring contract, not a project claim. |
| E3 | `packages/mpd-agent-teams-plugin/README.md:133`, `README_ZH.md:122` | "(`spawn` / `fork`)" | "fork" is the sub-agent runtime's API term, not a lineage claim. |
| E4 | `packages/mpd-agent-teams-plugin/self-fix-tests/README.md:3,6` | "Fork-maintenance record …" / "this fork-owned note …" | Internal, agent-facing note about maintaining our copy of the ADOPTED component. |
| E5 | `docs/development.zh-CN.md:24`, `docs/index.zh-CN.md:14`, `docs/feature-audit.zh-CN.md:5` | "… 移植的 skill 语料 …" / "与本移植现状 …" | RULING 3: our engineering baseline vs upstream spec parity, not a self-declaration (and no exact `移植了` match). |
| E6 | `docs/feature-audit.md`, `PLAN.md`, `docs/plan-*.md`, report records | — | AGENTS.md §3 process-record exemption + this task's outOfScope list. |
| E7 | `packages/*/_deps/**` | — | Vendored upstream code. |
| E8 | `.qa-reloc/**`, `.tmp-cache/**` | — | Untracked QA sandbox output; never editable (also the source of false-positive grep hits). |
| E9 | `packages/mpd-boulder-plugin/README{,.zh-CN}.md` | — | No fork/port claim at all → nothing to change. |
| E10 | `README.zh-CN.md:106` | "移植计划：[PLAN.md](./PLAN.md)" | Captain ruling: labels a historical record; claims nothing about current identity/lineage; matches no acceptance grep. Kept verbatim. |
| E11 | `packages/mpd-memory-plugin/src/index.ts:2` | "// Focused port of the upstream project memory-core semantics (base 8c57e46, …" | Source-code comment (agent-facing, English-only), per-file provenance about the vendored `memory-core` semantics — lawful under RULING 3's second clause; the file is **outside this task's inScope**, so it was not edited. If the owner wants the wording aligned with the new README line, that needs a task that declares `packages/mpd-memory-plugin/src/` in scope. |
| E12 | `packages/mpd-tools-plugin/src/index.ts:1` | "// B1 mpd-tools-plugin: port of upstream tool-level hooks onto DSH tool pipeline." | Same class as E11: source comment, per-file provenance, outside inScope. |
| E13 | `packages/mpd-agent-teams-plugin/_deps/dsh-llm/lib/types/attribution.js:12` | "// export of this package; the relative path resolves from both `src/` and" | Substring false positive: the matcher hits "ex**port of**" in vendored upstream code; no claim of any kind. |

---

## 3. Verify outputs (verbatim)

**V1 — zero-grep over `git ls-files` (contract command):**

```
$ git ls-files | xargs grep -n 'ports the portable\|Fork declaration\|移植了\|Fork 声明\|fork derived\|port of' | grep -v '^skills/\|^evidence/\|^docs/plan-\|^PLAN.md\|README.zh-CN.md:106\|feature-audit'
packages/mpd-agent-teams-plugin/_deps/dsh-llm/lib/types/attribution.js:12:// export of this package; …
packages/mpd-memory-plugin/src/index.ts:2:// Focused port of the upstream project memory-core semantics (base 8c57e46,
packages/mpd-tools-plugin/src/index.ts:1:// B1 mpd-tools-plugin: port of upstream tool-level hooks onto DSH tool pipeline.
```

**All three residual hits are exempted (E13, E11, E12)** and none is a human-facing declaration surface: one is a substring false positive in vendored code, two are source-code comments outside this task's declared scope. **Zero unexempted hits remain**; every hit on a human-facing surface has been removed.

**V2 — README heads (declaration + switch link):**

```
$ head -8 README.md                                  $ head -8 README.zh-CN.md
# my-power-dsh                                       # my-power-dsh
                                                     
**English** | [中文](./README.zh-CN.md)              **中文** | [English](./README.md)
                                                     
**my-power-dsh** is an independent DeepSeek …        **my-power-dsh** 是一个独立的 DeepSeek Harness …
with its own plugin rows, one `mpd` agent preset …   插件行、一个 `mpd` agent preset …
`dsh plugin add`.                                    用一条 `dsh plugin add` 即可安装。
```

**V3 — manifest description:**

```
$ node -e "…p.description"
desc: my-power-dsh: an independent DeepSeek Harness plugin bundle (provenance: a pinned oh-my-openagent baseline)
```

**V4 — fork claims in the plugin READMEs:**

```
$ grep -n 'fork' packages/mpd-{memory,comment-checker,hashline}-plugin/README*.md
(no output)          # 0 fork claims in all six files
```

**Additional checks**: `grep -c -i fork` = **0** in each of the six plugin README files; `covered by SUL-1.0` present in the three EN files (memory's is line-wrapped after "covered by"), `依 SUL-1.0 授权` present in the three ZH files; the two preserved provenance strings are byte-identical to their pre-edit form; boulder untouched.

---

## 4. Acceptance mapping

| Criterion | Status | Evidence |
|---|---|---|
| READMEs carry the approved declaration, switch links, no port claim / no Fork declaration heading / no fork lineage claim | passed | §1 rows 1-2, §3 V2, §3 V4 |
| Ten-file set landed EN+ZH in step; `SUL-1.0 fork terms` → licence statement; provenance text EXACT; boulder untouched | passed | §1 rows 5-10 + the preservation check in §1 |
| `package.json` scripts untouched; `VENDOR_LOCK.json` / `LICENSE.md` untouched | passed | §1 "Not touched" (only the `description` line changed) |
| SUL-1.0 + code-yeongyu/OmO attribution explicit; MIT attributed to the adopted component only; no touched file claims our code is MIT | passed | §1 "Licence discipline verified" |
| Zero unexempted grep hit + E1–E10 exemption list (incl. `README.zh-CN.md:106`) | passed | §2 (E1–E13; E11–E13 added for the three non-declaration residuals), §3 V1 |
| This report carries before/after quotes, re-measured ranges, exemptions, verify outputs | passed | this file |
| No file outside the declared scope written | passed | §1 apply set ⊆ inScope; `changedPaths` in the task update lists exactly those files + this report |

**Ambient note**: the working tree also carries other lanes' staged changes (t8's repair, t20/t21); this task staged nothing and committed nothing — the captain owns staging.
