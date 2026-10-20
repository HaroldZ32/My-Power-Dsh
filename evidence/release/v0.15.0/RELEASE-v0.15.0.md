# v0.15.0 — the guard split: reconnaissance and delegation delegated again, a mechanical session gate, a stateless TUI panel, and the `cordis-dev` skill

Minor release over v0.14.0, and a behaviourally **BREAKING** one for the `mpd` preset's top-level
session. The 2026-10-17 wave restored the long persona prompt but withdrew all three mechanical guards
with it; the 2026-10-20 ruling splits that bundle: the two DECISIONAL guards come back
(`captain.investigation`, `delegation.gate`), the session-start gate ships `mechanical` again, and the
verification law's write guard (`verify.mode`) STAYS withdrawn — the captain writes code directly while a
DIFFERENT agent records the verdict. The same release fixes a seeded-fork qualification defect in that
gate, hardens the investigation guard's error boundary, makes the TUI sidebar deployment stateless on
dsh-tui ≥ 0.16.1 with a panel attention badge, and teaches the `cordis-dev` skill to load itself. Frozen
contracts: `.mpd/plans/restore-guard-discipline.md` and `.mpd/plans/release-v0.15.0.md`.

## English

### Breaking / host adaptation

- **The `mpd` preset's top-level session delegates reconnaissance again.** `read` / `grep` / `glob` on a
  SOURCE path are refused; the documentation band stays readable. The knob is
  `captain.investigation` — `deny` (default) or `allow`; `allow` restores full access.
- **The generic spawn tools are refused again.** `subagent`, `subagent_fork` and `workflow` are denied
  with the sanctioned routes named (`mpd_role_spawn`, the workmate library, Agent Teams). The knob is
  `delegation.gate` — `deny` (default), `captain` or `allow`. The gate is **preset-scoped**: a top-level
  session of another preset — the deployment default `cordis` included — is released, while the `mpd`
  captain and every member/child session stay covered whatever preset they run.
- **`team.gate` ships `mechanical` again.** On a trigger the session-start complexity gate stages a
  0-member / 0-task **approvable plan shell**; nothing is spawned until the captain extends and approves
  it. `advisory` and `off` stage nothing, and the `mpd-roles` row's `gate: "off"` pin is gone so the code
  default governs.
- **Writes stay direct.** `write` / `edit` / `bash` are NOT gated and no loop needs to be armed; the
  verification law's write guard (`verify.mode`) remains withdrawn. The boot line reads
  `captainInvestigation=deny delegationGate=deny … sessionGate=mechanical` and
  `verifyGate=absent reason=withdrawn:2026-10-17-user-ruling(verify.mode)` — a mode is never reported for
  a withdrawn guard.
- **dsh-tui ≥ 0.16.1 owns the sidebar enable list**, so the bundle's enable keeper goes READ-ONLY there:
  it cancels its ladder, installs no feed and no belt, and writes no config — not even the stale-default
  migration. On 0.15.x the keeper joins the host's self-heal and keeps exactly that one write; below
  0.15 the feed-first keeper is unchanged. There is no state migration on upgrade.

### Added

- **The TUI panel's attention badge and one auto-open, published from apply.** dsh-tui mounts a plugin
  panel only while it is the active page, so the badge is set from the row's apply path through
  `tuiPanels.badge` and reflects only the **displayed** team's watchdog holds. The first publish after
  arming includes the empty case, which clears a stale badge. The auto-open fires **at most once per
  process**, on the NOT-LIVE → LIVE edge of a team — booting into a workspace that already has a team
  never steals the sidebar — retries a host refusal on the next state change, shares its one-shot latch
  across panel-seam re-binds, and is governed by the new `panelAutoOpen` row knob (default `true`).
- **`cordis-dev` loads itself on detection.** Its front-matter description leads with the auto-load rule
  and a "Load on detection" section states every signal (`cordis.patch.yml` or `presets/*.patch.yml`, a
  manifest carrying `dsh.bundle` / `dsh.client`, `dsh-plugin.json`, a `packages/*/src/index.ts` exporting
  `apply`, an `extensions/*` manifest, `mpd.jsonc` / `.mpd/plans/**`), the presence-only check, and the
  negative case (no signal means skip it and say so). Detection parses manifests for a real
  `dsh.bundle` / `dsh.client` entry, so a project that merely depends on a package named `dsh` no longer
  matches. A PROJECT SHAPE persona paragraph tells the captain to load the skill before the first edit,
  gate run or diagnosis.
- **`/mpd status` reports the panel deployment**: the host-assigned panel ids, the seam state and the
  keeper's verdict — the `<pluginId>` half of a panel id is the one fact no document can derive.

### Changed

- **Version carriers**: `package.json`, `dsh-plugin.json` and `dsh-distribution.json` carry **0.15.0**;
  the distribution descriptor's six component refs move from `@0.12.0` to `@0.15.0`; the
  `x-mpd-tui-surfaces` disclosure names the bundle package at 0.15.0 (the separate `@mpd-dsh/mpd-tui`
  package keeps its own 0.1.0).
- **Documentation and UI refresh.** The README pair carries the 0.15.0 badge and current-release line and
  names `cordis-dev` in the capability list; the user-guide pair documents the restored guards and the
  delegation gate's preset scope, corrects "seven write tools" to **eight**, names `tuiPanels` as the
  primary Agent Teams surface, and covers the attention badge, `panelAutoOpen` and the stateless
  deployment; the `tui.md` pair's preamble target is rewritten to dsh-tui **0.16.1** pointing at §11.8
  (the 0.14.0 narrative is kept as history, never bare-swapped); the design pair drops `mode: hard` from
  the `mpd-verify` column while keeping every `mpd-tools` `writeGuard` mention. Documentation images and
  the three hand-authored SVGs are refreshed by the release's UI-refresh lane.

### Fixed

- **The session-start gate qualifies a seeded fork correctly.** `sessionQualifies` now composes
  `sessionRank`, so a seeded-fork top-level session receives the mechanical gate and origin/depth
  children do not; the previous preset-name heuristic misclassified the fork (T-92). Unit and QA
  contract arms cover all four cases.
- **The investigation guard's error boundary.** An internal error in the guard passes the call through
  with one warning instead of failing an unrelated tool call.
- **The no-id staging path is self-consistent.** The mechanical notice now says the staged shell cannot
  be approved and tells the captain not to try, instead of contradicting itself; the QA case's plan-id
  parser accepts the current `plan-<17 digits>-<4-char tag>-<3-char counter>` format (it had parsed the
  previous 14-digit form and gone blind), and `session-gate.ts` emits a row warning when
  `staged && planId === ""`, so a staging call that produced no id cannot read as healthy.
- **The attention badge is truthful.** It counts only the displayed team's watchdog holds and publishes
  once on arm (including the empty case) to clear a stale badge.
- **QA and evidence repairs from the v0.15.0 audit.** `bundle-lifecycle` pins `XDG_RUNTIME_DIR` and the
  npm caches inside its sandbox and repairs three stale assertions; the delegation-gate live arm proves
  `delegationGate=allow` on its released side and pins `agentPreset=none`, so a release cannot be
  confused with a missing guard; a `mechanical-default` side seeds no `team.gate` and asserts
  `sessionGate=mechanical` plus the full staging contract, with the key's absence proved rather than
  assumed; the boulder claim cites current green evidence; the Docker TUI lane pins
  `panelAutoOpen: false` in its profile's user layer so its pre-key control capture measures what it
  claims.

### Install / upgrade

The host baseline is unchanged from v0.14.0: DeepSeek Harness **0.2.1-rc.2** and dsh-tui **0.16.1**.
From a checkout:

```bash
dsh plugin --profile web add .
# or the terminal surface
dsh plugin --profile dsh-tui add .
```

Against the published artifact (after the release is public):

```bash
dsh plugin --profile web add github:HaroldZ32/My-Power-Dsh
# or, once npm has the version: dsh plugin --profile web add @mpd-dsh/mpd
```

Nothing in `.mpd/` changes shape. If you relied on the v0.14.0 withdrawal, the two opt-outs are
`captain.investigation: "allow"` and `delegation.gate: "allow"` in `mpd.jsonc`; the `team.gate` values are
`mechanical`, `advisory` and `off`.

### Verified at this documentation cut

This file was written by the release-docs lane, which ran only the gates its scope can move. Observed
(all under the pinned bun 1.4.0, exit 0):

| Gate | Result |
|---|---|
| `bun run verify:docs` | PASS — 48 pairs, 438 links, 406 checked, 0 dead, 24 exempt, 3 derived, 117 files |
| `bun run verify:manifest` | PASS — version 0.15.0 in both manifests, 27 row module paths, 1011 packed files, every required path present |
| `bun run typecheck` | PASS — `tsgo --noEmit`, no diagnostics, exit 0 |

The full release sweep (tests, QA self-tests, boot lanes, live cases, pack closure, Docker source and
one-click lanes) is graded in [`REPORT.md`](./REPORT.md); its per-gate logs land under `gates/`. This
lane's own evidence is under `docs/20261020T112746Z/`.

## 简体中文

较 v0.14.0 的 minor 版本，但对 `mpd` preset 的顶层会话而言是**行为上的破坏性**变更。2026-10-17 那一波恢复了
长 persona 提示词，却把三道机械守卫一并撤销；2026-10-20 的裁定把这个捆绑拆开：两道**决策类**守卫回归
（`captain.investigation`、`delegation.gate`），会话起点门重新以 `mechanical` 发布，而验证法则的写入守卫
（`verify.mode`）**仍然撤销** —— 由 captain 直接写代码，由**另一个**智能体记录判决。同一版本修复了该门对
seeded fork 的资格判定缺陷、加固了侦察守卫的错误边界、让 TUI 侧栏部署在 dsh-tui ≥ 0.16.1 上变为
stateless 并带上注意力徽标，还让 `cordis-dev` 技能能自动加载自己。冻结契约：
`.mpd/plans/restore-guard-discipline.md` 与 `.mpd/plans/release-v0.15.0.md`。

### 破坏性变更 / 宿主适配

- **`mpd` preset 的顶层会话重新把侦察委派出去。** 在**源码**路径上的 `read` / `grep` / `glob` 会被拒绝；
  文档带仍然可读。旋钮为 `captain.investigation` —— `deny`（默认）或 `allow`，`allow` 恢复完整访问。
- **通用 spawn 工具重新被拒。** `subagent`、`subagent_fork` 与 `workflow` 被拒绝，并在拒绝里点名获准通道
  （`mpd_role_spawn`、workmate 库、Agent Teams）。旋钮为 `delegation.gate` —— `deny`（默认）、`captain`
  或 `allow`。该门**按 preset 划定范围**：别的 preset 的顶层会话（包括部署默认的 `cordis`）会被放行，
  而 `mpd` captain 与每个成员/子会话无论跑哪个 preset 都仍被覆盖。
- **`team.gate` 重新以 `mechanical` 发布。** 命中信号时会话起点复杂度门 stage 一个 0 成员 / 0 任务的
  **可批准 plan shell**；在 captain 扩展并批准之前不会 spawn 任何东西。`advisory` 与 `off` 什么都不
  stage，且 `mpd-roles` 行里 `gate: "off"` 的钉定已移除，由代码默认值说了算。
- **写入仍然直接。** `write` / `edit` / `bash` **不受**门限制，也不需要武装任何回路；验证法则的写入守卫
  （`verify.mode`）保持撤销。启动行显示
  `captainInvestigation=deny delegationGate=deny … sessionGate=mechanical` 与
  `verifyGate=absent reason=withdrawn:2026-10-17-user-ruling(verify.mode)` —— 被撤销的守卫永远不报 mode。
- **dsh-tui ≥ 0.16.1 自己掌管侧栏启用清单**，因此本 bundle 的启用保持器在该宿主上变为**只读**：取消阶梯、
  不装 feed、不装腰带、不写任何配置 —— 连陈旧默认迁移都不写。0.15.x 上保持器加入宿主自愈，只保留那一次
  写入；0.15 以下仍是 feed-first。升级不涉及状态迁移。

### 新增

- **TUI 面板的注意力徽标与一次性自动打开，从 apply 发布。** dsh-tui 只在插件面板是活动页时才挂载它，
  因此徽标经 `tuiPanels.badge` 从行的 apply 路径设置，只反映**当前显示的那个团队**的看门狗 hold。武装后
  的第一次发布包含空状态，用于清掉陈旧徽标。自动打开**每进程最多一次**，触发点是团队从 NOT-LIVE → LIVE
  的边沿 —— 启动时工作区已有团队不会抢走侧栏 —— 宿主拒绝会在下一次状态变化时重试，一次性闩锁在面板接缝
  重绑之间共享，并由新增的 `panelAutoOpen` 行旋钮（默认 `true`）控制。
- **`cordis-dev` 检测到项目形态就自动加载。** 其 front-matter 描述以自动加载规则开头，新增的
  “Load on detection” 一节列出全部信号（`cordis.patch.yml` 或 `presets/*.patch.yml`、清单里带
  `dsh.bundle` / `dsh.client`、`dsh-plugin.json`、导出 `apply` 的 `packages/*/src/index.ts`、
  `extensions/*` 清单、`mpd.jsonc` / `.mpd/plans/**`）、只用存在性检查的一行命令，以及否定情形
  （没有信号就跳过并说明，而不是把 bundle 规则套到非插件项目上）。检测会解析清单里真实的 `dsh.bundle` /
  `dsh.client` 条目，因此仅仅依赖一个名为 `dsh` 的包的项目不再命中。新增的 PROJECT SHAPE persona 段落
  要求 captain 在此类工作区的第一次编辑、跑门禁或诊断之前先加载该技能。
- **`/mpd status` 报告面板部署**：宿主分配的面板 id、接缝状态与保持器的结论 —— 面板 id 的 `<pluginId>`
  那一半是任何文档都推导不出的事实。

### 变更

- **版本载体**：`package.json`、`dsh-plugin.json` 与 `dsh-distribution.json` 均为 **0.15.0**；分发描述符
  的六个组件引用从 `@0.12.0` 移到 `@0.15.0`；`x-mpd-tui-surfaces` 披露把 bundle 包写成 0.15.0（独立的
  `@mpd-dsh/mpd-tui` 包保留自己的 0.1.0）。
- **文档与 UI 刷新。** README 双语对带上 0.15.0 徽标与当前版本行，并在能力清单里点名 `cordis-dev`；
  使用者指南双语对记录恢复的守卫与委派门的 preset 范围，把“七个写入工具”更正为**八个**，把 `tuiPanels`
  写为 Agent Teams 的首要界面，并覆盖注意力徽标、`panelAutoOpen` 与 stateless 部署；`tui.md` 双语对的
  前言目标重写为 dsh-tui **0.16.1** 并指向 §11.8（0.14.0 的叙述作为历史保留，绝不裸换数字）；设计文档
  双语对从 `mpd-verify` 一列去掉 `mode: hard`，同时保留每一处 `mpd-tools` 的 `writeGuard`。文档图片与
  三张手绘 SVG 由本版本的 UI 刷新车道重做。

### 修复

- **会话起点门对 seeded fork 的资格判定正确了。** `sessionQualifies` 现在组合 `sessionRank`，seeded fork
  的顶层会话会拿到机械门，而带 origin/depth 的子会话不会；旧的按 preset 名称判断把该 fork 分类错了
  （T-92）。单元与 QA 契约臂覆盖全部四种情形。
- **侦察守卫的错误边界。** 守卫内部出错时放行该次调用并只警告一次，而不是让一次无关的工具调用失败。
- **无 plan id 的 stage 路径自洽了。** 机械通知现在说明已 stage 的 shell **无法**批准，并让 captain 不要
  尝试，而不是自相矛盾；QA case 的 plan-id 解析器接受当前
  `plan-<17 digits>-<4-char tag>-<3-char counter>` 格式（它此前解析旧的 14 位形式，已经失明），并且
  `session-gate.ts` 在 `staged && planId === ""` 时发一条行警告，使产生不出 id 的 stage 调用不会读成健康。
- **注意力徽标是诚实的。** 只统计当前显示团队的看门狗 hold，并在武装时发布一次（含空状态）以清除陈旧徽标。
- **v0.15.0 审计带来的 QA / 证据修复。** `bundle-lifecycle` 把 `XDG_RUNTIME_DIR` 与 npm 缓存钉进沙箱，
  并修好三条陈旧断言；delegation-gate 的实时臂在其被放行的一侧证明 `delegationGate=allow` 并钉住
  `agentPreset=none`，使“被放行”无法与“守卫缺失”混淆；新增的 `mechanical-default` 侧完全不播种
  `team.gate`，断言 `sessionGate=mechanical` 与完整 staging 契约，且“键确实不存在”是证明出来的而不是假设；
  boulder 主张引用当前绿色证据；Docker TUI 车道在其 profile 的用户层钉住 `panelAutoOpen: false`，使其
  按键前的对照捕获确实测到它声称的东西。

### 安装 / 升级

宿主基线与 v0.14.0 相同：DeepSeek Harness **0.2.1-rc.2** 与 dsh-tui **0.16.1**。在 checkout 里：

```bash
dsh plugin --profile web add .
# 或终端那个端
dsh plugin --profile dsh-tui add .
```

发布公开后可用：

```bash
dsh plugin --profile web add github:HaroldZ32/My-Power-Dsh
# 或 npm 上已有该版本后：dsh plugin --profile web add @mpd-dsh/mpd
```

`.mpd/` 里的状态形状不变。若你依赖 v0.14.0 的撤销状态，两个退出开关是 `mpd.jsonc` 里的
`captain.investigation: "allow"` 与 `delegation.gate: "allow"`；`team.gate` 的取值是
`mechanical`、`advisory`、`off`。

### 本次文档交付的实测

本文件由发布文档车道撰写，只跑了它能影响的门禁。以下为实测（钉定 bun 1.4.0，exit 0）：

| 门禁 | 结果 |
|---|---|
| `bun run verify:docs` | PASS —— 48 对文档、438 条链接、检查 406 条、0 死链、24 条豁免、3 条派生、117 个文件 |
| `bun run verify:manifest` | PASS —— 两份清单版本均为 0.15.0、27 个行模块路径、1011 个打包文件、所有必需路径存在 |
| `bun run typecheck` | PASS —— `tsgo --noEmit` 无诊断，exit 0 |

完整的发布扫尾（测试、QA 自测、启动车道、实时 case、打包闭合、Docker source 与 one-click 车道）在
[`REPORT.md`](./REPORT.md) 中评级，逐门禁日志落在 `gates/` 下。本车道自己的证据在
`docs/20261020T112746Z/`。
