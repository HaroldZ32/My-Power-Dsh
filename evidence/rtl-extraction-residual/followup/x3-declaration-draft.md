# X3 — Project self-declaration: draft and adversarial stress test

**Task**: t19 · requirements round 1 · **Author**: Lead
**Date**: 2026-09-13 · **Tree measured**: `/root/dshProj/my-power-dsh` @ pin `32ae54dd10db7ea46e1c1263143d56f266fd1f78` (`dev`), working tree carrying t8's in-flight repair (62 staged/working changes, none by this task)
**Revision note**: revised in place after the captain's post-completion guidance (t19 was already terminal, `verdict=pass`). The identity spine now follows the user's ruling literally: the project "属于参考了 OMO 与 dsh-agent-teams，和原版关系已不大" and is "已不是 OMO 的 Deepseek harness 移植版" — an **independent bundle with a distant relationship**, whose SUL-1.0 inheritance is stated as a **licence fact, not a lineage claim**. Softening "port" while keeping the fork/derivation frame is explicitly rejected.
**Scope**: `evidence/rtl-extraction-residual/followup/` only. This file is a **draft + verdicts**: nothing under `README.md`, `README.zh-CN.md`, `package.json`, `AGENTS.md`, `docs/` or `packages/` was written; §6 is a proposal.
**User ruling implemented**: identity = independent DSH plugin bundle that drew on OmO **and** on the adopted `dsh-agent-teams` plugin; relationship to the original = distant; licence = **SUL-1.0 inherited from OmO** (strong copyleft, unavoidable); the sanitizer's OMO→mpd renames **stay** (`MPD_UPSTREAM_ROOT`, `mpd-config-core`) — no OMO naming is re-introduced into our own identifiers.

---

## 1. Measured facts this draft rests on

Every row names the file the fact was measured from; all commands were run against the tree above.

| # | Fact | Measured from |
|---|---|---|
| F1 | Upstream provenance is a **pinned snapshot**, not a git relationship: `"upstream": "code-yeongyu/oh-my-openagent"`, `"upstreamCommitSha": "8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29"`, `"upstreamVersion": "5.0.0-beta.20"` | `VENDOR_LOCK.json:2-4` |
| F2 | The repository has **no upstream git lineage**: the only remote is `origin https://gitee.com/nop_chip/my-power-dsh`; the pinned upstream commit object is **absent** locally (`git rev-parse --verify 8c57e46^{commit}` → NO); it is **not an ancestor** of HEAD (`git merge-base --is-ancestor 8c57e46 HEAD` → NO); history is 192 commits of this repo | `git remote -v`, `git rev-parse`, `git merge-base`, `git log` on this tree |
| F3 | The shipped surface is a **DSH plugin bundle**: the repo root IS the package `@mpd-dsh/mpd` (`"name": "@mpd-dsh/mpd"`, `"version": "0.3.2"`) declaring `dsh.bundle.patch` / `dsh.client` / the rows' `exports` map | `package.json:2,5`, `package.json` `dsh` block |
| F4 | The bundle composes **21 plugin rows**: 1 adopted (`agent-teams`), 2 remote MCP rows (`mcp-context7`, `mcp-grepapp`), 18 `mpd` rows written here | `node scripts/verify-rows-parity.mjs` → `ok: 21 row ids match the bundle patch insert list (agent-teams, mcp-astgrep, …)`; `packages/mpd-bundle/cordis.patch.yml` |
| F5 | `packages/` holds **22 plugin packages**, and **exactly ONE is adopted foreign main code** — `packages/mpd-agent-teams-plugin`; the other 21 are written here. The adopted tree keeps its own LICENSE and a vendored `_deps/` closure | `ls -d packages/*/ \| grep -v node_modules \| wc -l` = 22; `LICENSE-NOTICES.md:8-49`; `packages/mpd-agent-teams-plugin/{LICENSE,_deps,lib}` |
| F6 | The adopted component is **MIT and versioned**: `dsh-agent-teams` from NanmiCoder (0.1.14 body + audited upstream `0.1.16-rc.3` deltas, adopted version `0.1.16-rc.3-mpd`), first-class main code, `lib/client.js` still the 0.1.14 build | `LICENSE-NOTICES.md:8-17` |
| F7 | **11 OmO-origin specialists** ship as an adapted roster with normal display names and stable upstream ids, delivered as **teammate templates** and **workmate BASE templates** — **not as presets** | `packages/mpd-roles-plugin/src/roles.data.ts` (11 `"id":` entries) + `packages/mpd-roles-plugin/personas/` (11 files); `AGENTS.md:38-46,51` |
| F8 | The **skill corpus** is 328 files / 19 trees of **mixed provenance**: ported upstream skills + third-party upstream skills + cases written here (`dsh-qa`, `svn-master`, bundle-lifecycle/dispatch/sidebar/workmate QA cases) | `VENDOR_LOCK.json:19-23` (`assets.skills.fileCount` 328 + `source` text); `ls -d skills/*/` |
| F9 | The pinned baseline **is not chased**: update policy is "never chase upstream; a baseline change requires a deliberate branch + evidence" — so the pin is a provenance/compat artifact, **not** a fork or tracking relationship | `AGENTS.md:423` (§9) |
| F10 | This repository is **its own product surface**: the entire RTL/EDA capability was deliberately split out to the sibling `@mpd-dsh/silicon` sub-bundle; zero `rtl-*` skill trees remain | `ls -d skills/rtl-*` = 0; `README.md:43-44` (silicon pointer note) |
| F11 | The **sanitizer renames stay**: `MPD_UPSTREAM_ROOT` points at the pinned checkout (upstream side keeps `omo-config-core` — "upstream is never renamed"); `mpd-config-core` is the sanitized reference | `scripts/verify-vendor.mjs:10-15`, `scripts/bootstrap.mjs:26`, `scripts/build-mcp.mjs:23-30` |
| F12 | The upstream name appears in the self-description 2× per README; `AGENTS.md` and `LICENSE-NOTICES.md` refer to it descriptively ("the upstream project") | `grep -c 'oh-my-openagent'` README.md = 2, README.zh-CN.md = 2, AGENTS.md = 0, LICENSE-NOTICES.md = 0 |
| F13 | Our own licence is **SUL-1.0 inherited from upstream**: "This repository is derived from the upstream project (upstream commit 8c57e463…, v5.0.0-beta.20). License: Sustainable Use License 1.0 (SUL-1.0)." The in-repo MIT text belongs to the adopted component (copyright 程序员阿江(Relakkes)) | `LICENSE-NOTICES.md:1-4` + its MIT block; `LICENSE.md` |
| F14 | The licence **body** must not be rewritten: `LICENSE.md:5` reads "All third party components incorporated into the oh-my-opencode Software are licensed under the original license provided by the owner of the applicable component." (inherited upstream wording, kept verbatim by design) | `LICENSE.md:3,5` |

---

## 2. Verdict on each framing statement

Format: **quoted source** → verdict → measured proof → what must change.

### S1 — `README.md:5` / `README.zh-CN.md:5` (identity sentence)

> "A DeepSeek-Harness plugin bundle that ports the portable capabilities of oh-my-openagent (OmO)."

**Verdict: PARTIALLY TRUE.** The first clause is true; the second describes the *origin* in the present tense and, read as an identity, is no longer accurate.

Measured proof: the bundle is real and self-contained (F3: `package.json:2,5`; F4: 21 rows) but is **not a port surface only** — 18 of 21 rows and 22 packages are written here, exactly one of them adopted (F4, F5, F6); the baseline is pinned and deliberately not chased (F9); and the repository is its own product surface, having split the whole RTL/EDA capability out to `@mpd-dsh/silicon` (F10). "Upstream spec parity" is an *engineering target*, not the definition of the artifact (F1; `AGENTS.md:31-32`). The present-tense "ports" also survives in `AGENTS.md` (S4).

**Change**: keep the identity clause, put the origin in the **past tense**, and name the adopted `dsh-agent-teams` component that the current wording cannot see (F6).

### S2 — `README.md:7-11` / `README.zh-CN.md:7-10` (fork declaration)

> "**Fork declaration**: This project is a fork derived from [oh-my-openagent](…) (commit `8c57e46`, v5.0.0-beta.20) with deep modifications; it inherits upstream **Sustainable Use License 1.0 (SUL-1.0)**. upstream copyright belongs to code-yeongyu and the OmO contributors. Full license text: [LICENSE.md](./LICENSE.md)."
> 中文同段："**Fork 声明**：本项目是 [oh-my-openagent](…)（commit `8c57e46`，v5.0.0-beta.20）的 fork，做了深度修改；继承上游 **Sustainable Use License 1.0 (SUL-1.0)**。上游版权归 code-yeongyu 与 OmO 贡献者所有。完整许可文本： [LICENSE.md](./LICENSE.md)。"

**Verdict: PARTIALLY TRUE — the licence/attribution half is TRUE and must be kept verbatim in substance; the "fork derived from … with deep modifications" half is FALSE as a lineage claim.**

Measured proof: (a) TRUE half — SUL-1.0 inheritance and the upstream copyright are recorded independently of the word "fork" (F13: `LICENSE-NOTICES.md:1-4`; `LICENSE.md`). (b) FALSE half — measured on this tree there is **no git lineage to the upstream repository**: the only remote is this project's own Gitee origin, the pinned upstream commit is not present as an object, and it is not an ancestor of HEAD (F2), and the policy explicitly does not chase the upstream (F9). What exists is a pinned provenance baseline (F1: `VENDOR_LOCK.json:2-4`). "Deep modifications of a fork" also cannot describe a tree whose largest foreign part is a component adopted under a *different* licence from a *different* upstream (F5, F6).

**Change**: keep the licence sentence and the attribution; replace "fork derived from … with deep modifications" with the accurate derivation statement — a **derived work** that pins an upstream snapshot, does not track upstream releases, and whose relationship to the original is historical (the user's "distant" ruling).

### S3 — `package.json:6` (manifest description)

> `"description": "my-power-dsh: DeepSeek Harness plugin-based port of the upstream project capabilities"`

**Verdict: PARTIALLY TRUE.** "DeepSeek Harness plugin-based" is accurate; "port of the upstream project capabilities" is an origin statement presented as an identity, and "the upstream project" is vague where the READMEs name it.

Measured proof: identical to S1 (F3, F4, F5, F6) — plus F12: the manifest is one of the few surfaces where the upstream is not named at all, so the description cannot even be read as a precise provenance claim.

**Change**: a single-line description that keeps the identity and demotes the port to the origin; no licence claim in the description (the manifest's `license` field, if any, must not be invented here — out of this task's scope).

### S4 — `AGENTS.md:27-33` (§1 Overview & Provenance, first paragraph)

> "**my-power-dsh** ports the portable capabilities of the upstream project (GitHub `code-yeongyu`; provenance and inheritance are declared in `README.md`; base commit `8c57e46`, v5.0.0-beta.20) into the DeepSeek Harness (DSH) as a plugin bundle. The capability baseline is pinned to upstream `8c57e46` (v5.0.0-beta.20); upstream spec parity is the engineering target… License: SUL-1.0 (`LICENSE.md`); inheritance declared in `README.md`."

**Verdict: PARTIALLY TRUE.** The pin, the licence and the inheritance pointer are correct; the opening identity sentence overstates a present-tense port, and the section never mentions the adopted `dsh-agent-teams` component at all.

Measured proof: pin/licence TRUE (F1, F9); identity overstatement and omission measured by F4/F5/F7 and by F12 (`AGENTS.md` never spells the upstream repository name, while the adopted component is documented only in `LICENSE-NOTICES.md` and §6's adaptation table).

**Change**: rewrite the opening two sentences to an identity + past-tense origin, name the adopted component, and keep the baseline/parity/licence sentences. The §1 bullets at `AGENTS.md:35-37` (upstream names stay upstream's; our `mpd` prefix) are **consistent with the user's ruling and must not change** (F11).

### Summary table

| # | Statement | Verdict | Keep | Replace |
|---|---|---|---|---|
| S1 | `README.md:5` / `README.zh-CN.md:5` | PARTIALLY TRUE | "DeepSeek-Harness plugin bundle" | present-tense "ports … capabilities" |
| S2 | `README.md:7-11` / `README.zh-CN.md:7-10` | PARTIALLY TRUE (licence TRUE / lineage FALSE) | SUL-1.0 sentence + copyright attribution | "fork derived from … deep modifications" |
| S3 | `package.json:6` | PARTIALLY TRUE | "DeepSeek Harness plugin-based" | "port of the upstream project capabilities" |
| S4 | `AGENTS.md:27-33` | PARTIALLY TRUE | pin / parity / licence sentences | present-tense port identity; add the adopted component |

---

## 3. Adversarial stress test (the draft judged against itself)

Each counter-argument is the strongest one I could build against my own verdicts and wording; the disposition says whether it lands.

| # | Counter-argument | Disposition |
|---|---|---|
| A1 | "The project *did* port upstream capabilities, so calling it a port is factually true — a present-tense 'ports' can describe a maintained port." | **Partially lands** — which is why the verdict is PARTIALLY TRUE, not FALSE. It is answered by tense, not deletion: the origin is kept in the past tense and the current identity is stated positively (F4, F5, F6). Deleting the origin outright would understate the licence derivation that F13 records. |
| A2 | "Removing the word 'fork' weakens the SUL-1.0 inheritance chain and could be read as licence-shopping." | **Does not land** if the licence derivation is asserted explicitly and independently. The draft says "the licence inherited from the upstream project … the upstream copyright belongs to code-yeongyu and the OmO contributors" (F13), so inheritance and attribution survive independent of the word "fork"; and the relationship is stated as what it measurably is, which "fork" was not (F2). |
| A3 | "The adopted `dsh-agent-teams` component is MIT, so the bundle could be described as MIT-licensed." | **Does not land — and must be actively rejected.** The MIT text in this repo is the adopted component's own licence (F6, F13); this project's own licence is SUL-1.0 (F13). The draft states the split in both languages and says the MIT grant covers the adopted component only. This is the single most dangerous way the new wording could go wrong. |
| A4 | "De-OMO'ing the declaration means purging OmO names and paths from our tree." | **Does not land.** The user's chosen sanitizer keeps the renames (F11): `MPD_UPSTREAM_ROOT`, `mpd-config-core` stay, and the upstream side keeps `omo-config-core` ("upstream is never renamed"). Upstream names remain in factual provenance statements (F1) and in §1's binding list (`AGENTS.md:35-37`). The draft proposes **no** OMO naming in our own identifiers. |
| A5 | "`AGENTS.md` §1 is agent-facing; changing it is documentation churn with no user impact." | **Partially lands** — the rewrite is nonetheless required because §1 is the manual's provenance authority and today contradicts the READMEs' new wording; a reader who finds one document saying "bundle" and the other "ports" has no way to adjudicate. Scope stays minimal: §1's first paragraph only. |
| A6 | "The pin `8c57e46` should be dropped from the declaration to make the relationship look 'distant'." | **Does not land.** The pin is the provenance evidence that makes the derivation verifiable (F1) and is what `verify-vendor` enforces; the policy already says the baseline is not chased (F9). "Distant" describes identity and tracking, not the removal of the pinned snapshot. |
| A8 | "Just fix the 'oh-my-opencode Software' wording in `LICENSE.md` while we are at it." | **Does not land — explicitly out of bounds.** The licence body is inherited legal text and must not be rewritten (F14). If provenance clarity is wanted it goes to `LICENSE-NOTICES.md` as a note, flagged separately from the declaration change (§6a) — never folded into it. |
| A7 | "A Chinese declaration block is optional because the audience is technical." | **Does not land.** `AGENTS.md`'s language policy makes every human-facing doc bilingual with a switch link, and the two READMEs are a pair; an EN-only change would desynchronise them and fail the repo's own gate. Both blocks are therefore provided (§4, §5) to land in one change. |

**Residual risks that survive the stress test** (to be carried by whoever lands the change):
- The replacement lines sit in files currently modified by t8's repair (62 entries in `git status --porcelain`), so the line ranges in §6 are **working-tree ranges at pin + t8 state**; a landing task must re-measure them before editing (the pin-discipline rule the audit already uses).
- `README.md:5` and `AGENTS.md:29` are quoted with the numbers measured here; any earlier commit-level reading is stale by construction.
- No wording here can settle whether the *owner* considers the derivation "distant"; the draft states the measurable facts (no git lineage, pinned snapshot, one MIT-adopted component) and leaves the adjective to the owner.

---

## 4. Proposed English declaration block

**Block EN-A — replaces the identity sentence (`README.md:5`):**

```markdown
**my-power-dsh** is an independent DeepSeek Harness (DSH) plugin bundle — the package `@mpd-dsh/mpd`,
with its own plugin rows, one `mpd` agent preset and a served skill corpus, installed with a single
`dsh plugin add`.
```

**Block EN-B — replaces the fork declaration (`README.md:7-11`):**

```markdown
It is not the OMO DeepSeek-Harness port. Its provenance is factual rather than a lineage: a pinned
baseline of [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (OmO; commit `8c57e46`,
v5.0.0-beta.20 — a baseline this repository does not chase), whose 11 specialists ship as adapted
teammate templates and workmate BASE templates; a 328-file skill corpus that mixes ported upstream
skills with third-party upstream skills and cases written here; and one adopted component — the
`agent-teams` plugin from [dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) (MIT),
vendored as first-class main code with local adaptations. Everything else is written here, and the
RTL/EDA surface is not part of this repository: it was split out to the sibling `@mpd-dsh/silicon`
sub-bundle.

> **License**: SUL-1.0 — the licence inherited from the upstream project (strong copyleft; full text in
> [LICENSE.md](./LICENSE.md)); the upstream copyright belongs to code-yeongyu and the OmO contributors.
> The adopted `agent-teams` component keeps its own MIT License (notices in
> [LICENSE-NOTICES.md](./LICENSE-NOTICES.md)); that MIT grant covers the adopted component only — this
> project's own code is not MIT-licensed.
```

**Block EN-C — replaces the manifest description (`package.json:6`):**

```json
"description": "my-power-dsh: an independent DeepSeek Harness plugin bundle (provenance: a pinned oh-my-openagent baseline)"
```

**Block EN-D — replaces §1's first paragraph (`AGENTS.md:29-33`):**

```markdown
**my-power-dsh** is an independent DeepSeek Harness (DSH) plugin bundle. Its provenance is factual
rather than a lineage: a pinned baseline of the upstream project (`code-yeongyu/oh-my-openagent`; base
commit `8c57e46`, v5.0.0-beta.20, recorded in `VENDOR_LOCK.json` and not chased per §9), whose 11
specialists ship as adapted teammate templates and workmate BASE templates; and one adopted component,
the `agent-teams` plugin from dsh-agent-teams under the MIT License, vendored as first-class main code.
Everything else is written here. The upstream snapshot stays pinned for provenance, and upstream spec
parity remains an engineering reference rather than an identity claim. License: SUL-1.0 (`LICENSE.md`);
inheritance and attribution are declared in `README.md` and `LICENSE-NOTICES.md`.
```

---

## 5. Proposed Chinese declaration block

**ZH-A — replaces `README.zh-CN.md:5`:**

```markdown
**my-power-dsh** 是一个独立的 DeepSeek Harness（DSH）插件 bundle —— 即包 `@mpd-dsh/mpd`：拥有自己的
插件行、一个 `mpd` agent preset 以及随包提供的 skill 语料库，用一条 `dsh plugin add` 即可安装。
```

**ZH-B — replaces `README.zh-CN.md:7-10`:**

```markdown
它**不是** OMO 的 DeepSeek Harness 移植版。它的来源是事实性的，而非血统关系：一份
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)（OmO；commit `8c57e46`，
v5.0.0-beta.20 —— 本仓库并不跟随推进的基线）的固定基线，其 11 个 specialist 以适配后的 teammate
模板与 workmate BASE 模板形式随包发布；一个 328 个文件的 skill 语料库，混合了上游移植 skill、第三方
上游 skill 与本仓库编写的用例；以及一个被采纳的组件 —— 来自
[dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) 的 `agent-teams` 插件（MIT），以一等
主代码形式内联并带本地适配。其余部分均在本仓库编写；RTL/EDA 表面不属于本仓库，它已拆分到兄弟子
bundle `@mpd-dsh/silicon`。

> **许可**：SUL-1.0 —— 继承自上游项目的许可（强 copyleft；完整文本见 [LICENSE.md](./LICENSE.md)）；
> 上游版权归 code-yeongyu 与 OmO 贡献者所有。被采纳的 `agent-teams` 组件保留其自身的 MIT 许可
> （声明见 [LICENSE-NOTICES.md](./LICENSE-NOTICES.md)）；该 MIT 授权仅覆盖被采纳组件 —— 本项目自身
> 代码不是 MIT 许可。
```

---

## 6. Replacement map (exact files and line ranges)

Ranges are **working-tree line numbers measured in §1's tree state** (pin `32ae54dd` + t8's in-flight repair). Re-measure before applying.

| Block | File | Lines replaced | Replaced text (first words) |
|---|---|---|---|
| EN-A | `README.md` | **5** | "A DeepSeek-Harness plugin bundle that ports the portable capabilities of oh-my-openagent (OmO)." |
| EN-B | `README.md` | **7-11** | "> **Fork declaration**: This project is a fork derived from …" |
| EN-C | `package.json` | **6** | `"description": "my-power-dsh: DeepSeek Harness plugin-based port of the upstream project capabilities"` |
| EN-D | `AGENTS.md` | **29-33** | "**my-power-dsh** ports the portable capabilities of the upstream project … License: SUL-1.0 …" |
| ZH-A | `README.zh-CN.md` | **5** | "my-power-dsh 是一个 DeepSeek-Harness 插件 bundle，移植了 oh-my-openagent (OmO) 的可移植能力。" |
| ZH-B | `README.zh-CN.md` | **7-10** | "> **Fork 声明**：本项目是 [oh-my-openagent](…) 的 fork，做了深度修改 …" |

### 6a. Explicitly-flagged separate recommendation (NOT part of the blocks above)

`LICENSE.md:5` reads: *"All third party components incorporated into the oh-my-opencode Software are licensed under the original license provided by the owner of the applicable component."* — this is **inherited upstream licence text** (`LICENSE.md:3,5`) and **must not be rewritten**. If the owner wants the provenance clarified, the correction belongs as a **note in `LICENSE-NOTICES.md`** (e.g. "the inherited licence text refers to the upstream project's software; that wording is kept verbatim"), landed as its **own change**, separate from the declaration blocks, and only on the owner's decision. Folding it into this declaration would touch legal text — rejected (A8).

**Explicitly not replaced** (measured as already consistent with the ruling):
`AGENTS.md:35-37` (upstream names stay upstream's; our `mpd` prefix) · `LICENSE.md` (full SUL-1.0 text, untouched) · `LICENSE-NOTICES.md:1-4` (derivation + SUL-1.0 statement; **optional** precision: name `code-yeongyu/oh-my-openagent` instead of "the upstream project") · `VENDOR_LOCK.json:2-4` (the pin itself) · `scripts/verify-vendor.mjs:10-15` and `scripts/build-mcp.mjs:23-30` (sanitizer renames stay).

**Landing rules for whoever applies this** (from the repo's own manual): English and Chinese change in the **same** commit; each bilingual file keeps its language-switch link under the title; the publication surface is human-facing docs only — no code, patch or `VENDOR_LOCK` change is implied by this draft.

---

## 7. Constraint check against the acceptance criteria

| Requirement | Status |
|---|---|
| Verdict (TRUE / PARTIALLY TRUE / FALSE) per framing statement, with quoted source + measured proof | §2, S1–S4, each with the quote and the fact ids it rests on |
| Covers the four named sources (`README.md:5`, `README.md:7-11`, `package.json`, `AGENTS.md` §1) | §2 S1–S4; the Chinese twins are covered by the same verdicts (§5) |
| Facts measured from THIS repo and naming their file | §1 F1–F14, each row naming its file/command |
| SUL-1.0 inheritance + OMO attribution kept; never claims our code is MIT | §4 EN-B and §5 ZH-B licence blocks (F6, F13); §3 A3 is the adversarial guard for exactly this |
| De-OMO'd as ruled, and the identity spine follows the user's own words ("已不是 OMO 的 Deepseek harness 移植版", relationship distant), with the licence stated as a licence fact rather than a lineage claim | §4/§5 open with the independent identity and the explicit "It is not the OMO DeepSeek-Harness port"; provenance is listed as fact (F5, F7, F8, F10); licence is a licence fact (F13); F11 keeps the sanitizer renames; §3 A4 |
| No file outside `evidence/rtl-extraction-residual/followup/` written | this task wrote only this file; verification command 2 in the task contract is the check (its output must be read with t8's pre-existing repair changes in mind) |
