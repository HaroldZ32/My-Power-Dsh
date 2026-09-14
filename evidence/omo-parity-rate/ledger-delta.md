# Ledger ↔ frozen-contract delta (t37)

This file lists every inconsistency between the parity ledger in both languages and the frozen
contract, then gives a ready-to-apply replacement draft for §3 and §8 in English and Chinese
(简体中文).

**This task did not modify any page under `docs/`.** The ledger's actual replacement is another
slot's job; this file is the draft plus the conflict record.

Anchors used for this comparison (settled, read twice 50 s apart, byte-identical):

| file | sha256 |
|---|---|
| `docs/omo-parity-ledger.md` | 0454431a2efe064bf9062dddb282ee79c3883928548847309df4b9c56e2a1f08 |
| `docs/omo-parity-ledger.zh-CN.md` | 7398ec2d62ea20db0a39cca6104d22d1a7db5066b1a343058b22abb0f5032cd4 |
| `evidence/omo-align/requirements/frozen-contract.json` | 09949c8095d7ccd533329b114a2ef22bad1ce81bd24338240e68cfd0fd66be41 |
| `packages/mpd-agent-teams-plugin/lib/session-start.js` | 8cfaef47e9959ef7def01003640f768ff4befa50e9c202ff692a0629ca0a2aa6 |

**Post-t35 re-verification.** After the plugin implementation landed (dev `3096455`, merging `facb2de` plugin / `98af744` QA + corpus re-pin / `9132213` evidence), every conflict row was re-read against the now-committed revision:

- the four lib/delta hashes and the contract hash above are **identical to the committed bytes** (`git show 3096455:<path>`), so the measurement is anchored to an addressable revision rather than to a working-tree copy;
- that work did not touch the ledger: its two hashes are unchanged and **CF-1 / CF-2 / CF-3 / CF-4 / CF-6 are still present at the same lines**;
- **CF-5 is closed** by `facb2de` and is recorded below as resolved, not open.

The measured revision also carries the R3 harmonized verb tables (`ACTION_VERB_PATTERN` = 14 English + 12 CJK), `C_SUBSIGNAL_MIN = 2` and `signals.length >= 1` — exactly the predicate this task was told to measure with.

---

## 1. Conflict table

Ordered by severity. "Ledger" quotes are verbatim; "contract/code" quotes are verbatim from the
file named in the row.

### CF-1 — trigger threshold: ledger says `>= 2`, contract and code say `>= 1` (blocker)

| | |
|---|---|
| **Ledger EN** | `docs/omo-parity-ledger.md:45` — `` `trigger = (matchedSignals >= 2) OR anyExplicitFlag` `` |
| **Ledger ZH** | `docs/omo-parity-ledger.zh-CN.md:43` — `` `trigger = (matchedSignals >= 2) OR anyExplicitFlag` `` |
| **Contract** | `frozen-contract.json` → `complexityGate.logic` — `trigger = anyExplicitFlag OR (matchedSignals >= 1), where a matched signal means: …` |
| **Code** | `lib/session-start.js:206` — `const trigger = input.explicitFlag === true || signals.length >= 1;` |
| **Effect** | A reader who samples data through the ledger's rule gets a systematically LOWER trigger rate; the ledger's §3 predicate is the superseded one. |

### CF-2 — signal C rule: ledger says "lines OR verbs", contract says "2-of-3 sub-signals" (high)

| | |
|---|---|
| **Ledger EN** | `docs/omo-parity-ledger.md:51` — `` | `C_enumeratedSteps` | soft | ≥ 3 enumerated lines (`^\s*(\d+[.)]\|[-*])\s`) **or** ≥ 3 distinct action verbs (`add\|build\|change\|check\|implement\|verify\|设计\|实现\|验证\|改造\|补充`) | `` |
| **Ledger ZH** | `docs/omo-parity-ledger.zh-CN.md:49` — `编号/项目符号行（…）≥ 3 行 **或** 去重动作动词（`add\|build\|change\|check\|implement\|verify\|设计\|实现\|验证\|改造\|补充`）≥ 3 个` |
| **Contract** | `complexityGate.signals.C_enumeratedSteps.detect` — `C fires when TWO OR MORE of its three independent sub-signals hold: C1 enumerated lines (^\s*(\d+[.)]\|[-*])\s) >= 3; C2 distinct action verbs (…) >= 3; C3 action clauses (>= 3 clauses that each pair an action verb with an object, whether or not numbered) >= 3.` |
| **Code** | `lib/session-start.js:194-200` — `const cSubSignals = [ … ].filter(Boolean).length; if (cSubSignals >= C_SUBSIGNAL_MIN) signals.push('C');` with `C_SUBSIGNAL_MIN = 2` |
| **Effect** | The ledger's rule is the *literal* wording the contract explicitly supersedes (`revisionNote`), and it omits sub-signal **C3** entirely. |

### CF-3 — the two verb tables are stale AND asymmetric (high)

Two separate defects in the same rows:

| | |
|---|---|
| **CF-3a (B row)** | Ledger `docs/omo-parity-ledger.md:50` lists `…\|审计\|移植\|梳理\|全量` — that set matches the contract's B table (15 verbs, including 审计 移植 梳理). **B is consistent; recorded here only to show it was checked.** |
| **CF-3b (C row)** | Ledger `docs/omo-parity-ledger.md:51` / `.zh-CN.md:49` list only `add\|build\|change\|check\|implement\|verify\|设计\|实现\|验证\|改造\|补充`. The contract's C2/C3 table and the shipped table both carry the **harmonized union**: 14 English (`add, align, audit, build, change, check, consolidate, implement, migrate, overhaul, port, refactor, rewrite, verify`) + 12 CJK (`设计, 实现, 验证, 改造, 补充, 对齐, 重构, 迁移, 审计, 移植, 梳理, 全量`). |
| **Where the truth is** | `frozen-contract.json` → `complexityGate.signals.C_enumeratedSteps.harmonizedVerbTables` (with `revision: "R3 …"`) and `complexityGate.logicRevisionNote`; shipped regexes `ACTION_VERB_PATTERN` / `CLAUSE_ACTION_PATTERN` in `lib/session-start.js`. |
| **Effect** | The ledger understates the C verb table by 7 English + 6 CJK entries — exactly the asymmetry that makes a CJK-only or English-only reading of the ledger misleading. |

### CF-4 — §8 verification table is entirely stale (high)

| | |
|---|---|
| **Ledger EN** | `docs/omo-parity-ledger.md:130-137` — every row reads `pending` (typecheck, plugin tests, QA self-tests, runtime boot, two-sided gate case, preset/patch rows, installer, vendor) |
| **Ledger ZH** | `docs/omo-parity-ledger.zh-CN.md:123-130` — every row reads `待跑` |
| **Measured state** | The wave's gates have landed and are green: typecheck 0, plugin suite green, two-sided gate PASS with negative control, preset-conformance PASS with negative control red, `verify-vendor` PASS. |
| **Effect** | The ledger tells a reader the wave is unverified while its own committed evidence says otherwise. |

### CF-5 — the module doc contradicted the code in the same file — **RESOLVED in t35** (closed, not open)

| | |
|---|---|
| **Before (the defect this task found)** | `lib/session-start.js:29` read `` * `complexityGate`) is `trigger = (matchedSignals >= 2) OR anyExplicitFlag`: `` while the same file's code read `… signals.length >= 1` at `:206` — the root cause of the "measure through the documentation" class of error. |
| **Fix** | Corrected by the plugin's single writer **t35**, commit **`facb2de`** (`feat(agent-teams): idempotent message channel, archive-first mailbox clear, and a first-class interjection queue`). |
| **After (current revision, verified by this task)** | `lib/session-start.js:29` now reads `` * `complexityGate`) is `trigger = anyExplicitFlag OR (matchedSignals >= 1)` — the `` and `:32` reads `` * 2-of-3 majority of its sub-signals (C1/C2/C3). The superseded `matchedSignals >= 2` `` — i.e. the doc now states Option A and names the superseded rule explicitly. |
| **Status** | **Closed.** This row is retained only so t39/t40 can see the before/after and the commit that closed it. Do **not** list it as an open conflict in the ledger replacement. |

### CF-6 — §4 S2 quote is the pre-reconciliation wording, and §7 O5 is resolved (medium)

| | |
|---|---|
| **Ledger EN** | `docs/omo-parity-ledger.md` §4 table, S2 row — `"revising a task definition re-runs only the changed task **and its dependents**; completed upstream tasks keep their results"` |
| **Ledger EN §7** | `docs/omo-parity-ledger.md:77` and `:123` — the `O5` conflict note says the two wordings "differ exactly when a *dependent* has already completed" and "needs one of the two resolutions" |
| **Contract** | `massUlwSemantics.items[S2].assert` — `amending a task definition re-runs ONLY the changed task and its TRANSITIVE DEPENDENTS. A completed node whose own definition is unchanged AND none of whose transitive dependencies were changed/added/xor-moved keeps its cached result …` plus `S2.resolves: "Planner R4F1 … The two are reconciled by scoping the no-re-run guarantee to nodes whose transitive inputs did not change."` |
| **Effect** | The ledger presents as OPEN a conflict the contract has already reconciled; its S2 quote is not the frozen assertion. |

### Checked and CLEAN (no conflict)

| Item | Result |
|---|---|
| §3 `testPrompts` description ("simple" / "complex", two-sided) | contract has exactly 3 simple + 3 complex; the ledger's description matches |
| §3 signal A predicate text | matches the contract verbatim in meaning |
| §3 signal D predicate text | matches the contract |
| §2 verb tables vs `frozenDecisions` | no verbatim deviation found; `autoRoute` key present in both |
| §3 §8 language switch links | both files carry the link directly under the title (preserved by the draft below) |

---

## 2. Replacement draft — §3

### English (replace `docs/omo-parity-ledger.md` lines 43-63, i.e. the whole §3 body)

````markdown
## 3. Complexity gate (falsifiable by construction)

`trigger = anyExplicitFlag OR (matchedSignals >= 1)`

Signal ids: **A** hard, **B/C/D** soft. C counts as ONE signal and fires only when at least two of
its three sub-signals hold.

| Id | Kind | Detect |
|---|---|---|
| `A_explicitFlag` | hard | the trimmed user text starts with `team:` or contains `!team` (case-insensitive); the matched prefix is consumed and is not part of the goal |
| `B_deliverableVerbs` | soft | ≥ 4 distinct matches of `align\|migrate\|refactor\|audit\|overhaul\|port\|rewrite\|consolidate\|对齐\|重构\|迁移\|审计\|移植\|梳理\|全量` |
| `C_enumeratedSteps` | soft | a satisfied C is **2-of-3** sub-signals: `C1` ≥ 3 enumerated lines (`^\s*(\d+[.)]\|[-*])\s`); `C2` ≥ 3 distinct action verbs; `C3` ≥ 3 action clauses. C1/C2/C3 are never separate top-level signals |
| `D_planArtifact` | soft | a `.mpd/plans/*.md` file exists for the session workspace at the first pre-step |

**Harmonized verb tables (behaviour change, R3).** `C2` and `C3` share one verb set: 14 English —
`add, align, audit, build, change, check, consolidate, implement, migrate, overhaul, port, refactor,
rewrite, verify` — and 12 CJK — `设计, 实现, 验证, 改造, 补充, 对齐, 重构, 迁移, 审计, 移植, 梳理,
全量`. The two differ only in ROLE: `C2` counts a verb anywhere in the text, `C3` counts a clause
that opens with one.

**Option A, and why the threshold is 1.** `>= 2` counted signals is SUPERSEDED
(`complexityGate.logicRevisionNote`). Measured: the frozen complex prompts #1 and #3 carry no B/D/flag
at all, so C is their only signal, and a two-signal bar made the gate unreachable against its own
frozen expectation. A satisfied C therefore triggers on its own. **Accepted and ledgered cost:** a
multi-clause request such as “Check the test, build the package, verify the output.” satisfies C
(C2+C3) and therefore DOES route to a team; it is not distinguishable from complex prompt #1 by any
rule operating on C alone.

**Two-sided test (`testPrompts` in the frozen contract).** Every `simple` prompt must leave
`.mpd/team` empty and the log free of the startup notice; every `complex` prompt must produce exactly
one staged team and one notice. A run where either side is not observed is a `FAIL`, and a gate that
cannot fail this test is not accepted. Both directions must run on the same settled revision hash, in
a sandboxed workspace (`sandboxWorkspace` + `assertSessionsSandboxed`).

**Measured false-positive cost on real prompts (t37).** 20 real ordinary prompts (all containing
Chinese) sampled from the session logs: **0 triggered** — no finite "one needless approval every N"
exists in that sample; the 95% upper bound on the false-positive share is ≈14% overall and ≈46% from
the session-start stratum alone (5 prompts). The observable cost in the same sample runs the other
way: a genuinely complex session-start prompt matched only 1 distinct B verb (threshold 4) and 1
distinct C2 verb (threshold 3), so the gate stayed silent. See
`evidence/omo-parity-rate/result.json`.
````

### 简体中文 (替换 `docs/omo-parity-ledger.zh-CN.md` 第 41-59 行，即 §3 全段)

````markdown
## 3. 复杂度门（构造即可证伪）

`trigger = anyExplicitFlag OR (matchedSignals >= 1)`

信号编号：**A** 硬，**B/C/D** 软。C 只算**一个**信号，且仅当其三个子信号中至少两个成立时才命中。

| Id | 类型 | 判定 |
|---|---|---|
| `A_explicitFlag` | 硬 | 去掉首尾空白后的用户文本以 `team:` 开头，或包含 `!team`（大小写不敏感）；命中的前缀被消费、不计入目标文本 |
| `B_deliverableVerbs` | 软 | `align\|migrate\|refactor\|audit\|overhaul\|port\|rewrite\|consolidate\|对齐\|重构\|迁移\|审计\|移植\|梳理\|全量` 去重后 ≥ 4 个 |
| `C_enumeratedSteps` | 软 | C 命中 = **三取二**：`C1` 编号/项目符号行（`^\s*(\d+[.)]\|[-*])\s`）≥ 3 行；`C2` 去重动作动词 ≥ 3 个；`C3` 动作子句 ≥ 3 个。C1/C2/C3 从不作为独立顶层信号 |
| `D_planArtifact` | 软 | 首个 pre-step 时，会话工作区存在 `.mpd/plans/*.md` |

**动词表已和谐化（行为变更，R3）。** `C2` 与 `C3` 共用同一动词集：英文 14 个 ——
`add, align, audit, build, change, check, consolidate, implement, migrate, overhaul, port, refactor,
rewrite, verify`；中文 12 个 —— `设计, 实现, 验证, 改造, 补充, 对齐, 重构, 迁移, 审计, 移植, 梳理,
全量`。两者只差**角色**：`C2` 统计文本中任意位置出现的动词，`C3` 统计以动词开头的子句。

**Option A 与「阈值为 1」的理由。** `>= 2` 个计数信号已被取代
（`complexityGate.logicRevisionNote`）。实测：冻结的 complex 提示 #1 与 #3 完全不携带 B/D/标记，
C 是它们唯一的信号；两信号门槛会让门对不上它自己冻结的预期。因此一个满足的 C 自身即可触发。
**已接受并已登记的代价：** 形如「Check the test, build the package, verify the output.」的多子句
请求会满足 C（C2+C3）从而**确实**进入建队路径；仅凭 C 上的任何规则都无法把它与 complex #1 区分开。

**双向测试（冻结契约中的 `testPrompts`）。** 每个 `simple` 提示必须使 `.mpd/team` 为空且日志中
无启动通知；每个 `complex` 提示必须恰好产生一个 staged 团队与一条通知。任一侧未观察到即
`FAIL`，且**无法失败的门不被接受**。两侧必须跑在同一稳定修订 hash 上，且在沙箱工作区中
（`sandboxWorkspace` + `assertSessionsSandboxed`）。

**真实提示上的误触发实测（t37）。** 从会话日志抽取 20 条真实普通提示（全部含中文）：
**0 条触发** —— 该样本中不存在有限的「每 N 条一次无谓审批」；误触发占比的 95% 上界约为整体
14%、仅 session-start 分层（5 条）约 46%。同一样本中可观察到的代价恰好相反：一条确实复杂的
session-start 提示只命中 1 个去重 B 动词（阈值 4）与 1 个去重 C2 动词（阈值 3），门因此沉默。
详见 `evidence/omo-parity-rate/result.json`。
````

---

## 3. Replacement draft — §8

Both tables flip `pending` / `待跑` to `verified` with the measured command result. Fill the hash
column from the terminal evidence of the slot that performs the replacement; the value below is the
one this task measured.

### English (replace `docs/omo-parity-ledger.md` lines 126-140, i.e. the whole §8 body)

````markdown
## 8. Verification state

All gates below were run on revision hash `<settled-hash>` (fill in when landing).

| Gate | Command | State |
|---|---|---|
| typecheck | `bun run typecheck` | verified (exit 0) |
| plugin tests | `bun test packages/mpd-agent-teams-plugin` | verified (161 pass / 0 fail) |
| QA self-tests | `bun run test:qa` | verified (exit 0) |
| runtime boot | `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | verified (PASS) |
| two-sided gate case | `bun skills/dsh-qa/scripts/session-start-team.mjs` | verified (PASS: 3/3 simple silent, 3/3 complex staged, negative control disarmed) |
| preset/patch rows | `node skills/dsh-qa/scripts/preset-conformance.mjs` | verified (PASS; negative control still red) |
| installer | `node scripts/install-profile.mjs --self-test` | verified (exit 0) |
| vendor | `node scripts/verify-vendor.mjs` | verified (PASS; skills corpus re-pinned once in this wave) |
| gate false-positive study | `node evidence/omo-parity-rate/raw/probe.mjs` | verified (0/20 real ordinary prompts triggered; see `evidence/omo-parity-rate/result.json`) |

This ledger is updated **in the same commit as the change it records**; an evidence-free pass is not
a pass (AGENTS.md `§2.3`, `§4`).
````

### 简体中文 (替换 `docs/omo-parity-ledger.zh-CN.md` 第 119-132 行，即 §8 全段)

````markdown
## 8. 验证状态

下列门禁均在修订 hash `<settled-hash>` 上执行（落地时填入）。

| 门禁 | 命令 | 状态 |
|---|---|---|
| typecheck | `bun run typecheck` | 已验证（退出码 0） |
| 插件测试 | `bun test packages/mpd-agent-teams-plugin` | 已验证（161 通过 / 0 失败） |
| QA 自检 | `bun run test:qa` | 已验证（退出码 0） |
| 运行时启动 | `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | 已验证（PASS） |
| 双向门控用例 | `bun skills/dsh-qa/scripts/session-start-team.mjs` | 已验证（PASS：3/3 静默、3/3 各建一支、负控制 disarmed） |
| preset/patch 行 | `node skills/dsh-qa/scripts/preset-conformance.mjs` | 已验证（PASS；负控制仍红） |
| 安装器 | `node scripts/install-profile.mjs --self-test` | 已验证（退出码 0） |
| vendor | `node scripts/verify-vendor.mjs` | 已验证（PASS；本波语料仅 re-pin 一次） |
| 门误触发研究 | `node evidence/omo-parity-rate/raw/probe.mjs` | 已验证（20 条真实普通提示 0 条触发；见 `evidence/omo-parity-rate/result.json`） |

本台账与其记录的变更**在同一提交内更新**；无证据的通过不算通过（AGENTS.md `§2.3`、`§4`）。
````

---

## 4. Minimal-diff alternative (if a full §3 rewrite is too large for the landing slot)

If the landing slot must keep the diff small, only these three lines must change for correctness,
and the two §8 tables flip as shown:

| File | Line | Change |
|---|---|---|
| `docs/omo-parity-ledger.md` | 45 | `>= 2` → `>= 1` |
| `docs/omo-parity-ledger.md` | 51 | replace the "lines OR verbs" cell with the 2-of-3 rule and the harmonized union table |
| `docs/omo-parity-ledger.md` | 130-137 | `pending` → `verified` (+ the optional ninth row for the rate study) |
| `docs/omo-parity-ledger.zh-CN.md` | 43 | `>= 2` → `>= 1` |
| `docs/omo-parity-ledger.zh-CN.md` | 49 | same C-row correction in Chinese |
| `docs/omo-parity-ledger.zh-CN.md` | 123-130 | `待跑` → `已验证` (+ the optional ninth row) |

`CF-6` (the §4 S2 quote and the §7 `O5` note) is **not** covered by the minimal diff; it needs the
S2 assertion re-quoted from the contract and `O5` marked resolved, in both languages.
