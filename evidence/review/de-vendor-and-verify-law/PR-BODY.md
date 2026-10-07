<!-- docs-parity: exempt process record (the PR description, bilingual by §5), not a policed human-facing doc -->
# Wave `de-vendor-and-verify-law` — de-vendor the adopted body, make the workload gate language-aware, and make A-writes/B-verifies mechanical

Bilingual by AGENTS.md §5: **English first, 简体中文 below**. Every claim below is backed by an artifact
path under `evidence/`; the honest bounds are stated rather than implied.

## English

### The instruction this wave answers

> 脱去该项目对于Oh-my-openagent与dsh-agent-teams项目的源码的所有依赖及检查，文档里只写参考鸣谢与License；验证当前工作量门，现在貌似用户只要不提，不论如何都不会建队；不论如何工作量，帮我找一个办法尽量避免面向用户的主代理去直接写/验证代码，做这些事情由子代理去干，并且该插件的PRESET硬要求无论什么模式下，A写出来的一部分代码必须由B验证，两agent必须独立，且要求不直接看代码只看文档，若有问题打回去改

Four workstreams: (W1) strip every source dependency on and every CHECK of `code-yeongyu/oh-my-openagent`;
(W2) the same for the retired vendored `dsh-agent-teams` body, relocating what still ships; (W3) fix and
VERIFY the session-start workload gate; (W4) make the A-writes/B-verifies law a MECHANICAL requirement of
the `mpd` preset in every mode — an independent verifier, a documentation-only basis, and a problem that
bounces back to a writer.

### What changed

**W1 — upstream decoupling + the MCP source snapshot (Lane A, `evidence/gates/upstream-decouple/20261007T103121Z/`)**
- `scripts/verify-vendor.ts`: the three upstream-identity sections are DELETED — no env read, no path
  resolution, no fallback. The gate's subject is now the bytes this repository ships. `--require-upstream`
  REFUSES by name (exit 1) instead of accepting a flag that can no longer mean anything; unknown flags
  fail; `--help` exits 0. The asset half stays a blocker with its zero-subject guard intact.
- `VENDOR_LOCK.json`: the five upstream identity fields are gone (the commit survives as a `_note`
  historical reference), the `_deps` asset entry is dropped, and a NEW `assets["vendor/mcp-src"]` entry
  pins the snapshot (459 files).
- `scripts/build-mcp.ts` resolves the three MCP servers from the in-repo snapshot only (459 files, 7
  packages, provenance READMEs); `.github/workflows/gates.yml`'s baseline fetch step and env block are
  DELETED, not disabled.
- **The gate now ships its falsifier**: `node scripts/verify-vendor.ts --self-test` → 8/8 arms, each on
  COPIES of the gate and the lock.
- Attribution SURVIVED: `README.md`/`README.zh-CN.md`/`LICENSE-NOTICES.md` carry the acknowledgement.
  A measured licence correction was made: the upstream's own LICENSE.md is SUL-1.0 and 6 of the 7
  snapshotted packages declare no licence field, so the snapshot records the measurement instead of
  claiming MIT.

**W2 — the adopted body removed, what shipped relocated FIRST (Lane B, `evidence/packaging/agent-teams-strip/2026-10-07T10-41-45.000Z/`)**
- DELETED `packages/mpd-agent-teams-plugin/**` (**768 files**, `git ls-files` agrees), the four
  vendor/patch/reclaim scripts, `scripts/lib/vendored-agent-teams.d.ts`,
  `agent-references/agent-teams-deltas.md`, and two test files whose subject went with it. Proof of
  deletion is specifier-level: static and dynamic import scans across `packages/ scripts/ docker/ skills/`
  → NONE.
- RELOCATED in the same change: `packages/mpd-schemastery/**` (the schemastery validator four shipped
  plugins import, plus the six-module DSH runtime closure four tests drive) and
  `packages/mpd-bundle-plugin/adopted/agent-teams-client.js`. The rebuilt client differs from the old
  bytes by EXACTLY one line and +12 bytes — the difference being `sourceMappingURL`.
- Aligned: four shipped importers, six test importers, `bun.lock`, `tsconfig.json`, eight scripts,
  `docker/**`, the coupling inventory, the READMEs, `docs/**`, `agent-references/**`, CHANGELOG.
- A REAL gate defect was fixed on the way: `verify-pack-closure.ts`'s last arm required the artifact to be
  older than a source file, so running the packer (which §4 requires) before `--self-test` reddened a
  green gate.
- Test-count delta accounted: 147 test files → 98. The 52 removed are 51 under the adopted tree plus the
  ONE named `lane-c-wave2.test.ts`. **No test of ours was lost.**

**W3 — the workload gate (Lane C, `evidence/gates/complexity-gate/2026-10-07T10-32-25Z/`)**
- Root cause, measured: the frozen predicate `trigger = explicit flag OR (matchedSignals >= 1)` was
  English-centric — `CLAUSE_SEPARATOR_PATTERN` never split on `、，。；：` and the CJK lexicon was a handful
  of words — so the owner's own Chinese instruction measured **B=0, C1=0, C2=1, C3=0, D=absent**, i.e.
  **no trigger, no staged shell, no team, whatever the workload.** That is the reported defect.
- The fix: full-width separators, the CJK verb lexicon the repository actually uses, and ONE new signal
  **E** (≥ 60 Han characters AND ≥ 2 distinct action verbs) calibrated by measurement.
- Falsifiability: the corpus moves **exactly ONE verdict** (the owner's verbatim instruction:
  `false []` → `true ["E"]`), every English case is byte-identical, reverting the source reddens the
  self-test with the exact failure (`cjk-positive: … must trigger with signal E, got {"trigger":false,…}`),
  the restored file hashes identically, and a fourth permanent `cjkBlind` control keeps that arm honest.
- **C7**: a session already LEADING a team stages nothing (read from the team record). **C8**: only
  `user`-tagged or untagged messages are the human turn — the marker EXISTS
  (`{kind:"team-message",…}` for a teammate, `{kind:'agent-message', form:'relay'}` for a relayed child,
  `{kind:"user"}` for a human), so the gate distinguishes precisely and no honest bound was needed.
- THE LIVE ARM, 14 sides green (`failed: []`): the row's own log reads
  `session gate fired … signals=E mode=mechanical staged=1 plan=plan-20261007103657`, the notice carries
  the SAME plan id, and the staged slot shows `stagedMembers=0 stagedTasks=0 records=0` — three-source
  agreement, nothing spawned. The three Chinese negatives are silent with `gateInstalled: true`.
- The `skills/**` sweep is declared lane by lane (`skills-retirement-sweep.md`): five cases retired
  (subject = the deleted body), two arms dropped with named declarations, two retargeted to
  `packages/mpd-schemastery/harness/cordis`, and `run-qa-lanes --check-drift` → exit 0 (42 listed,
  0 unlisted) — including **two lanes that were ALREADY unlisted at `HEAD`** (inherited drift).
- A latent CASE bug was fixed at its root: the workmate live prompt passed a roster-internal STABLE ID
  (`base:"hephaestus"`) to a tool that addresses bases by functional NAME, so the lane passed only when
  the model silently repaired the argument — a ~42%-lifetime flake that was never model nondeterminism.

**W4 — the law (Lane D, `evidence/gates/verify-law/`, `evidence/verify-law/**`)**
- NEW `packages/mpd-verify-plugin/**`: the ledger under `<ws>/.mpd/verify/`, the record validator with its
  **eleven refusals**, the fixed gate table (ten ids incl. `vendor`), the content-free artifact probe, the
  observation log, and five `mpd_verify_*` verbs.
- ONE extra `guardTool` install at the roles row's site (`packages/mpd-roles-plugin/src/verify-guard.ts`),
  reading the published service rather than a module singleton (`bun build` inlines imports).
- The record is what makes the law real: `verifierId === writerId` is REFUSED; a PASS with no cited
  documents or no gate evidence is REFUSED; a FAIL without findings is REFUSED; a PASS from a seat that has
  already unlocked implementation reading is REFUSED; the `pre-plugin` exemption CLOSES ITSELF at the law's
  first boot marker. A FAIL bounces back as a `kind=repair` task.
- The board gained its **terminal verbs** (`agent_teams_task {action:"complete"|"fail"}`, owner-only, CAS)
  and **owner-first dispatch** with the fallback reason reported — without which no dependency edge could
  ever be satisfied and the DAG could not advance. §5's one-git-writer rule is now MECHANICAL for member
  sessions (read-only git stays open; a command that merely mentions git is allowed; the evasion bound is
  stated and asserted).
- `AGENTS.md` carries the law as a standing rule (§5.4/§5.5) and REWRITES the two sentences it replaces;
  the manual is back under the injection budget (**64996 B**) with the move-first rule recorded.
- THE LIVE ARM — the AC5 falsifier — 9/9 GREEN: `mounted`, `denied`, `codeNotWritten`, the falsifiable
  control pair `controlNotDenied` + `controlWritten`, `docsAllowed`, `sandboxMarker`,
  `realMarkerUnchanged`, `sessionsSandboxed`. Run 1 was RED and CAUSALLY CORRECT (the row was not
  installed, so nothing mounted); the assertion was then corrected to BEHAVIOUR (`called && codeNotWritten`)
  because a pre-dispatch guard denial cannot appear in a `tool/result`, and run 2's single red was the
  writer's own evidence channel, not the law.

### Independent verification (Lane E — eight record pairs, docs-only basis, verdict before any implementation read)

| Lane | Verdict | Record |
|---|---|---|
| pre-flight baseline | published | `evidence/verify-law/preflight/2026-10-07T102816Z/` · `bd10dd83…` |
| A — upstream decoupling | **PASS** | `lane-a/2026-10-07T1035Z` · `ce6cc194…` |
| B — adopted-body strip | FAIL `87a4e101…` → **re-verified PASS** `6d24c8d7…` | `lane-b/…`, `lane-b-reverify/2026-10-07T1058Z` |
| C — gate + sweep | FAIL `8d49854d…` → **re-verified PASS** `cf707d5d…` | `lane-c/…`, `lane-c-reverify/2026-10-07T1051Z` |
| D — the law + the manual | FAIL `f2d7aa38…` → **re-verified PASS** `a70ef165…` | `lane-d/…`, `lane-d-reverify/2026-10-07T1055Z` |

### Gates, each with its observed result

| Command | Result |
|---|---|
| `env -u MPD_UPSTREAM_ROOT node scripts/verify-vendor.ts` | **exit 0** — `PASS - 6 shipped asset(s) fingerprinted, upstream identity not checked`, with no upstream checkout, no `.mpd-dsh/upstream` and no network |
| `node scripts/repin-vendor.ts --check` | **GREEN** (drift=0, problems=0) |
| `node scripts/verify-pack-closure.ts` | **exit 0** — `542 file(s) compared, 542 identical, 0 drift`, `declared packages 28/28 present` (gate; independent of the self-test) |
| `node scripts/verify-pack-closure.ts --self-test` | **exit 0 — 34/34 arms** (35 PASS lines, 0 FAIL). A writer landing AFTER the pack is reported as `expected-after-pack` and NAMED, with 0 drift — verified with two tracked files landing 61 s after the stamp `2026-10-07T10:54:21.952Z`. `--pack-stamp <t>` remains the HARD mode (its arm still expects exit 1) |
| `bun test packages` | **PASS** — 1570 pass / 3 skip / 0 fail (98 files) |
| `bun run typecheck` | **exit 0** (after the fix below) |
| `bun run test:qa` | **PASS** — "all self-tests passed" |
| `bun run verify:gates` | **PASS** (aggregate: vendor, dist freshness, row parity, doc pairs, preset conformance) |
| `node scripts/verify-dist-fresh.ts` | **PASS — 30/30 fresh**, built with the PINNED toolchain |
| `bun run verify:docs` | **PASS** — 47 pairs, 0 dead links, 0 violations |
| `bun run verify:rows` | **PASS** — 34 row ids match the 2-file patch |
| `bun run verify:manifest` | **PASS** — 556 packed files, every row path resolves |
| `bun run verify:comments` | **PASS** — 357 files, 31138 declarations |
| `node scripts/verify-no-host-override.ts` | **PASS** — 34 additive rows, 0 id-targets (0 of 0 collide with the 205 host-declared ids) |
| `node scripts/verify-manual-paths.ts` | **PASS** — resolved 147, unresolved 0 |
| `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | **PASS** — 32 rows conform; negative controls 4/4 reddened |
| `node scripts/install-profile.ts --dry-run` | **PASS** |
| `bun scripts/mpd-ext.ts --self-test` | **PASS** |
| `node skills/dsh-qa/scripts/session-start-team.ts` (LIVE) | **PASS** — 14 sides, `failed: []`, rev `cae00e5a…`, gate sha `995564251c877723…` |
| `node skills/dsh-qa/scripts/verify-law.ts` (LIVE) | **PASS — 9/9 arms**; the real workspace's `.mpd/verify/boot.json` ABSENT before and after |
| Docker real-machine lane (`--mode source` then `--mode oneclick --spec github:HaroldZ32/My-Power-Dsh#feature/de-vendor-and-verify-law`, BOTH with `--require-docker`) | **exit 0 / exit 0** on a real ROOTLESS daemon — `[report] ok=true passed=66 failed=0 null=32`; `[browser-lane] rows=8 failed=0`; `[record] tui.noDirectTuiSeam=true` on a byte-identical copy of the INSTALLED tree. The 32 NULLs are CREDENTIAL-GATED live turns (`live.*`, `boot.llmTurn` — "not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum") plus one arm this host cannot observe, recorded as such rather than as a pass. Evidence: `evidence/docker/de-vendor-and-verify-law/20261007T105818Z/` |

**The wave's single `skills/**` re-pin landed in the SAME commit as the change that invalidated it**
(`skills.treeSha f8d30d96… → bebc42ea… → 7095adc6…`, fileCount 335 → 331), per §9/§11.

### One red the lanes did not catch, and what it proves

The final sweep found `bun run typecheck` **exit 1** on the law's own QA case
(`Property 'succeeded' does not exist on type …`) AFTER four lane records had passed it. The cause was the
case's local injected STUB, whose hand-written shape omitted a field the real reader declares; the fix
annotates the stub with the real type. This is the cleanest illustration of the repo's rule: **a verifier
proves BEHAVIOUR, a type checker proves TYPES, and neither retires the other** — no PASS exempts a gate that
has not been re-run after the last write.

### Honest bounds (stated, not implied)

1. **The law and the board's new verbs load at the NEXT boot** (T-21: no module hot reload). The wave's own
   writers were therefore unaffected while it ran; a session started before this merge keeps the old
   surface until `dsh` restarts.
2. **Watchdog fault-injection coverage is REDUCED** and declared: the fixture that drove the adopted
   scheduler had no subject left. Rebuilding an equivalent fixture for the official runtime
   (`mpd-team-core` + `mpdTeams`) is recorded as a follow-up, not done here.
3. **The workmate auto-injection was already inert.** It was a patch on a body mounted by NO loader row
   since the 2026-09-27 retirement, so this wave removed DEAD CODE and changed no runtime behaviour; the
   follow-up (re-establishing it on the OFFICIAL path via `mpd-roster-provider-plugin`) is recorded.
4. **`vendor/mcp-src/**` is deliberately NOT packed**: it is a build-time input for a checkout, while the
   published package ships the built `dist/`.
5. **`verify-vendor.ts`, `build-mcp.ts` and `VENDOR_LOCK.json` still NAME the retired upstream** in
   message/`_note` text on purpose — a removal notice must name what was removed. A grep-only auditor will
   see those strings; they are correct.
6. **`package.json`'s `!packages/*/_deps/**` allowlist entry is now vacuous** (no `_deps` directory
   exists). It is kept as a forward guard and named here rather than silently removed.
7. **The `mpd` preset's `persona` block states the law**, but a composition without the `tools.guard` seam
   degrades to bookkeeping and says so on its boot line (`verifyGate=absent`) — the bound is stated on
   every boot, never implied.
8. **Two lanes were ALREADY unlisted in `cases.json` at `HEAD`** (`goal-bridge`, `tui-deps-ctrla`); this
   wave registered them with their real classification, so the fix repaired inherited drift rather than
   creating it.
9. **The rebuild toolchain is pinned**: a PATH `bun` 1.4.2 produced **24 of 30 targets STALE** where
   `.toolchain/node_modules/.bin/bun` 1.4.0 produced **30/30 fresh**. §6 now carries the trap.
10. **`AGENTS.md` sits 540 B under the 65536-byte injection budget**; the manual now carries a MOVE-FIRST
    rule with a real target and a 2 KB margin requirement.

### Follow-ups recorded, not silently dropped

Adopt a harness-level guard-denial event as the verifier's PRIMARY channel if one ever exists (the
behavioural pair stays the fallback); rebuild the watchdog fault fixture for the official runtime;
re-establish the workmate persona injection on `mpd-roster-provider-plugin`; delete the two remaining dead
references if the retired path is ever reintroduced; move another long form out of `AGENTS.md` before the
next addition.

## 简体中文

### 本波回应的指令

> 脱去该项目对于Oh-my-openagent与dsh-agent-teams项目的源码的所有依赖及检查，文档里只写参考鸣谢与License；验证当前工作量门，现在貌似用户只要不提，不论如何都不会建队；不论如何工作量，帮我找一个办法尽量避免面向用户的主代理去直接写/验证代码，做这些事情由子代理去干，并且该插件的PRESET硬要求无论什么模式下，A写出来的一部分代码必须由B验证，两agent必须独立，且要求不直接看代码只看文档，若有问题打回去改

四条工作流：(W1) 剥离对 `code-yeongyu/oh-my-openagent` 源码的**所有依赖与所有检查**；(W2) 对已退役的
vendored `dsh-agent-teams` 主体做同样的事，并把仍在发货的部分**先搬迁**；(W3) 修复并**验证**会话启动的
工作量门；(W4) 把「A 写、B 验」做成 `mpd` preset 在**任何模式下**的**机械**要求 —— 验证者独立、只看文档、
有问题打回写者。

### 改了什么

**W1 —— 上游脱钩 + MCP 源码快照（Lane A）**
- `scripts/verify-vendor.ts` 的三节上游身份检查**删除**：不读环境变量、不做路径解析、没有回退；门的对象
  变成「本仓实际发货的字节」。`--require-upstream` **按名字响亮拒绝**（exit 1），未知旗标失败，`--help`
  exit 0；资产半仍是阻塞项，零主体守卫保留。
- `VENDOR_LOCK.json` 的五个身份字段消失（提交号以 `_note` 作为**历史参考**留存），`_deps` 条目删除，**新增**
  `assets["vendor/mcp-src"]`（459 文件）把快照钉住。
- `scripts/build-mcp.ts` 只从仓内快照解析三个 MCP 服务；`.github/workflows/gates.yml` 的按 SHA 拉基线步骤与
  env 块**删除**（不是禁用）。
- **门现在自带证伪器**：`verify-vendor.ts --self-test` → 8/8 臂，每条都在门与锁的**副本**上跑。
- **鸣谢存活**：`README.md` / `README.zh-CN.md` / `LICENSE-NOTICES.md` 保留署名；并做了一处**实测更正的
  许可证声明** —— 上游自己的 LICENSE.md 是 SUL-1.0，7 个快照包里 6 个没有 licence 字段，所以快照记录**测量
  结果**而不谎称 MIT。

**W2 —— 先搬迁、后删除（Lane B）**
- 删除 `packages/mpd-agent-teams-plugin/**`（**768 文件**，`git ls-files` 独立一致）、四个 vendor/patch/
  reclaim 脚本、`scripts/lib/vendored-agent-teams.d.ts`、`agent-references/agent-teams-deltas.md`，以及两个
  主体已随删除消失的测试文件。删净证明是 **specifier 级**的：静态与动态 import 全扫 → 无。
- 同一次改动里**搬迁**：`packages/mpd-schemastery/**`（四个已发货插件在用的 schemastery 校验库 + 四个测试
  驱动的六个 DSH 运行时模块）与 `packages/mpd-bundle-plugin/adopted/agent-teams-client.js`；重建后的客户端
  与旧字节**只差一行、+12 字节**（差异仅为 `sourceMappingURL`）。
- 同步对齐：四个已发货 import、六个测试 import、`bun.lock`、`tsconfig.json`、八个脚本、`docker/**`、耦合
  清单、各 README、`docs/**`、`agent-references/**`、CHANGELOG。
- 途中修掉一个**真实门缺陷**：`verify-pack-closure.ts` 最后一条臂曾要求产物比源文件更旧，于是按 §4 先打包
  再 `--self-test` 会把一扇绿门弄红。
- 测试数账目：测试文件 147 → 98；删掉的 52 = 51 个 adopted + **恰好 1 个具名文件**。**我们自己的测试一个
  都没丢。**

**W3 —— 工作量门（Lane C）**
- 实测根因：冻结谓词 `trigger = 显式旗标 OR (命中信号 ≥1)` 是**英文中心**的 —— `CLAUSE_SEPARATOR_PATTERN`
  从不按 `、，。；：` 切分，CJK 动词表只有寥寥几个词 —— 于是**用户自己的中文指令实测为 B=0、C1=0、C2=1、
  C3=0、D 不成立**：**不触发、不 staged、不建队，工作量再大也一样**。这就是被报告的那个缺陷。
- 修复：全角分隔符 + 本仓真实使用的中文动词表 + **一条按实测校准的新信号 E**（≥60 个汉字且 ≥2 个不同动作
  动词）。
- 可证伪性：整个语料**只有一条判定移动**（用户原话 `false []` → `true ["E"]`），所有英文用例逐字节不变，
  把源码回退即让自测变红并给出确切失败文本，恢复后哈希一致；另有第四条永久负控 `cjkBlind` 守着这条臂。
- **C7**：**已经在带队**的会话不再 staged（读团队记录判定）。**C8**：只有 `user` 标记或无标记的消息才是人类
  回合 —— 标记**确实存在**（队友 `{kind:"team-message",…}`、被中继子代理 `{kind:'agent-message', form:'relay'}`、
  人类 `{kind:"user"}`），所以无需写诚实边界。
- **真机臂 14 侧全绿**（`failed: []`）：行日志 `session gate fired … signals=E mode=mechanical staged=1
  plan=plan-20261007103657`，通知携带**同一** plan id，staged 槽 `stagedMembers=0 stagedTasks=0 records=0`
  —— **三源一致，什么都没生成**；三条中文负控沉默且 `gateInstalled: true`。
- `skills/**` 清扫逐条具名声明：5 个用例退役、2 条臂带声明丢弃、2 个改指
  `packages/mpd-schemastery/harness/cordis`；`run-qa-lanes --check-drift` → exit 0（42 listed / 0 unlisted）
  ——其中包括**两个在 `HEAD` 上就已未登记**的车道（继承来的漂移）。
- 修掉一个**潜伏的用例 bug**：workmate 活用例的 prompt 把 roster 的**内部稳定 id**（`base:"hephaestus"`）
  传给一个只认**功能名**的工具，于是「通过」全靠模型悄悄替它改对参数 —— 终身约 42% 的红，根本不是模型抖动。

**W4 —— 法律（Lane D）**
- 新增 `packages/mpd-verify-plugin/**`：`<ws>/.mpd/verify/` 账本、带**十一条拒绝理由**的记录校验器、固定闸门
  表（十个 id，含 `vendor`）、**无内容产物探针**、观测日志与五个 `mpd_verify_*` 动词。
- 在 roles 行既有位置**唯一一次**追加 `guardTool` 安装，读**已发布服务**而不是模块单例（`bun build` 会内联）。
- **记录才是法律落地的地方**：`verifierId === writerId` 拒绝；无引用文档或无门证据的 PASS 拒绝；无 findings
  的 FAIL 拒绝；已解锁过实现阅读的席位再给 PASS 拒绝；`pre-plugin` 豁免在法律的**首次启动标记处自行关闭**。
  FAIL 以 `kind=repair` 任务打回。
- 板子获得**终态动词**（`complete`/`fail`，仅 owner、CAS）与**owner 优先派工**（回退必须报出理由）—— 没有
  它们，任何依赖边都无法被满足、DAG 永远无法推进。§5 的「唯一 git 写者」对成员会话**变成机械约束**（只读
  git 仍开放；只是**提到** git 的命令允许；混淆规避的边界被写明并有用例断言）。
- `AGENTS.md` 把法律写成常设条文（§5.4/§5.5），并**改写**它取代的那两句话；手册回到注入预算内（**64996 B**）
  且留下了「先搬后加」规则。
- **真机臂 —— AC5 的证伪器 —— 9/9 全绿**；第 1 次运行**红得有因果**（行没被安装所以没挂载），随后断言被
  改成**行为证据**（`called && codeNotWritten`），因为派发前的守卫拒绝不可能出现在 `tool/result` 里；第 2 次
  的唯一红是写者自己的证据通道，不是法律。

### 独立验证（Lane E —— 八份记录对，只看文档，裁决先于任何实现阅读）

| 车道 | 判定 | 记录 |
|---|---|---|
| 预检基线 | 按冻结形状发布 | `preflight/2026-10-07T102816Z/` · `bd10dd83…` |
| A 上游脱钩 | **PASS** | `lane-a/2026-10-07T1035Z` · `ce6cc194…` |
| B 主体剥离 | FAIL `87a4e101…` → **复验 PASS** `6d24c8d7…` | `lane-b/…`、`lane-b-reverify/2026-10-07T1058Z` |
| C 门 + 清扫 | FAIL `8d49854d…` → **复验 PASS** `cf707d5d…` | `lane-c/…`、`lane-c-reverify/2026-10-07T1051Z` |
| D 法律 + 手册 | FAIL `f2d7aa38…` → **复验 PASS** `a70ef165…` | `lane-d/…`、`lane-d-reverify/2026-10-07T1055Z` |

### 门：逐条实测结果

| 命令 | 结果 |
|---|---|
| `env -u MPD_UPSTREAM_ROOT node scripts/verify-vendor.ts` | **exit 0** —— `PASS - 6 shipped asset(s) fingerprinted, upstream identity not checked`，且无上游 checkout、无网络 |
| `node scripts/repin-vendor.ts --check` | **GREEN**（drift=0, problems=0） |
| `node scripts/verify-pack-closure.ts` | **exit 0** —— `542 file(s) compared, 542 identical, 0 drift`、`28/28 declared packages present`（**门**，与自测是两条命令） |
| `node scripts/verify-pack-closure.ts --self-test` | **exit 0 —— 34/34 臂**（35 条 PASS、0 FAIL）。打包**之后**落地的写者会被报为 `expected-after-pack` 并**具名**、drift 为 0 —— 以「两个跟踪文件在戳后 61 秒落地」为证。`--pack-stamp <t>` **仍是硬模式**（其臂仍期望 exit 1） |
| `bun test packages` | **PASS** —— 1570 pass / 3 skip / 0 fail（98 文件） |
| `bun run typecheck` | **exit 0**（修复后） |
| `bun run test:qa` | **PASS** —— "all self-tests passed" |
| `bun run verify:gates` | **PASS**（聚合：vendor、dist 新鲜度、row 一致性、文档对、preset 一致性） |
| `node scripts/verify-dist-fresh.ts` | **PASS —— 30/30 fresh**，用**钉住的工具链**构建 |
| `bun run verify:docs` | **PASS** —— 47 对、0 死链、0 违例 |
| `bun run verify:rows` | **PASS** —— 34 个 row id 与 2 文件 patch 相符 |
| `bun run verify:manifest` | **PASS** —— 556 打包文件，每个 row 路径都能解析 |
| `bun run verify:comments` | **PASS** —— 357 文件 / 31138 声明 |
| `node scripts/verify-no-host-override.ts` | **PASS** —— 34 行新增、0 个 id-target |
| `node scripts/verify-manual-paths.ts` | **PASS** —— resolved 147 / unresolved 0 |
| `preset-conformance --self-test` | **PASS** —— 32 行一致；负控 4/4 变红 |
| `install-profile.ts --dry-run` / `mpd-ext.ts --self-test` | **PASS** |
| `session-start-team.ts`（真机） | **PASS** —— 14 侧、`failed: []`、rev `cae00e5a…`、门哈希 `995564251c877723…` |
| `verify-law.ts`（真机） | **PASS —— 9/9 臂**；真工作区 `.mpd/verify/boot.json` 前后均 ABSENT |
| Docker 真机车道（`--mode source`，再 `--mode oneclick --spec github:HaroldZ32/My-Power-Dsh#feature/de-vendor-and-verify-law`，**两者都带 `--require-docker`**） | **exit 0 / exit 0**，跑在**真实 rootless** 守护进程上 —— `[report] ok=true passed=66 failed=0 null=32`；`[browser-lane] rows=8 failed=0`；`[record] tui.noDirectTuiSeam=true`（在**已安装树**的逐字节副本上）。32 个 NULL 是**凭据受限**的活体轮次（`live.*` 与 `boot.llmTurn`，理由原文：「未尝试：活体轮次需要 `MPD_E2E_LIVE=1` 与按名转发的凭据；挂载断言就是无凭据下的最大值」），外加一个本宿主**不可观测**的臂 —— 如实记为不可观测，而不是记成 pass。证据：`evidence/docker/de-vendor-and-verify-law/20261007T105818Z/` |

**本波唯一一次 `skills/**` re-pin 与使它失效的改动落在同一提交**（`skills.treeSha f8d30d96… → bebc42ea… →
7095adc6…`，文件数 335 → 331），符合 §9/§11。

### 一条四条车道都没抓到的红，以及它证明了什么

终局扫门发现 `bun run typecheck` **exit 1**，位置是法律自己的 QA 用例（`Property 'succeeded' does not exist
on type …`），而**四份车道记录此前都放过了它**。原因是该用例**本地注入的替身**手写形状漏了真实 reader 声明的
字段；修复是给替身标注真实类型。这是本仓规则最干净的一次示范：**验证者证明行为，类型检查器证明类型，两者互不
注销** —— 任何 PASS 都不能豁免一扇在最后一次写入之后没有被重跑的门。

### 诚实边界（明说，不暗示）

1. **法律与板子的新动词在下次启动才加载**（T-21 无模块热重载）。因此本波运行期间本波自己的写者不受影响；
   本次合并之前已启动的会话，在 `dsh` 重启之前仍使用旧工具面。
2. **watchdog 故障注入覆盖面缩减**并已声明：驱动 adopted 调度器的夹具失去了主体。为官方运行时
   （`mpd-team-core` + `mpdTeams`）重建等价夹具记为后续项，本波不做。
3. **workmate 自动注入早已失效**：它是打在**自 2026-09-27 起就无任何 loader 行挂载**的 body 上的补丁，
   所以本波删除的是**死代码**、未改变任何运行时行为；后续项（在**官方路径**
   `mpd-roster-provider-plugin` 上重建）已记录。
4. **`vendor/mcp-src/**` 有意不进包**：它是 checkout 的构建输入，发布包只带构建产物 `dist/`。
5. **`verify-vendor.ts` / `build-mcp.ts` / `VENDOR_LOCK.json` 仍会在文案/`_note` 里提到已退役的上游**，
   这是**有意**的：删除通知本就该写明删了什么。只看 grep 的审计者会看到这些字符串，它们是对的。
6. **`package.json` 的 `!packages/*/_deps/**` 条目现在已无实际对象**（不存在 `_deps` 目录）。保留为前瞻
   守卫并在此具名，而不是悄悄删掉。
7. **`mpd` preset 的 `persona` 写明法律**，但缺少 `tools.guard` 接缝的组合会退化为「仅记账」，并在启动行上
   明说 `verifyGate=absent` —— 边界**每次启动都写明**，从不暗示。
8. **两个车道在 `HEAD` 上本来就没登记**（`goal-bridge`、`tui-deps-ctrla`）；本波按真实分类登记了它们，即
   修复的是**继承来的漂移**而非新造。
9. **重建工具链是钉住的**：PATH 上的 `bun` 1.4.2 会产出 **24/30 STALE**，而
   `.toolchain/node_modules/.bin/bun` 1.4.0 产出 **30/30 fresh**；§6 已写下这个坑。
10. **`AGENTS.md` 距 65536 字节注入预算还有 540 B 余量**；手册现在带有「**先搬后加**」规则、真实目标与
    2 KB 余量要求。

### 已记录的后续项（没有悄悄丢掉）

若将来出现 harness 级「守卫拒绝」事件，把它作为验证者的**首选**通道（行为对保留为回退）；为官方运行时重建
watchdog 故障夹具；在 `mpd-roster-provider-plugin` 上重建 workmate 人格注入；`AGENTS.md` 下次增补前先搬走
一段长体。
