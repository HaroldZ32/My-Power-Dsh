# PR: v0.18.0 — three-plane upstream adaptation + a DSH-Go hard gate

> Independent verification recorded **FAIL** on its first pass (requirement R6 — "a gate asserts the band" — was false) and the repairs are in this commit; a re-verification is in flight.
> Base: `dev` · Head: `feature/upstream-0.18.0` · Version: 0.18.0

## English

### What changed

**1. DSH core — `@deepseek-ai/dsh` 0.2.1-rc.5 → 0.2.2-rc.1**
- The three `@deepseek-ai/dsh-experimental-*` packages move in lockstep; `engines.node` → `>=24.9.0`.
- `engines.dsh` is now declared and spans BOTH harness lines.
- The four headline breaking changes of 0.2.2 (model routing through `agent.model`, `tools.resolve`/
  `executable`, asynchronous Session Projection registration, the Agent Team inbox move) **do not touch
  this tree**: an inventory proved there is no `agent/request` listener, no `tools.resolve`, no
  `executable` tool property and no projection registration here. Model selection runs through four
  `agentOptions` sites, and this PR carries a run that shows which model actually served the turn.
- No routing rewrite was performed. If `agentOptions` had stopped selecting the model, that would have
  been reported as a Blocker rather than silently reworked. It still selects the model on 0.2.2,
  proven by the child session's own request header (the child ran the configured `agentRoutes`
  "Junior Engineer" model while the parent ran a different one).
- **One real 0.2.2 breaking change the release notes did not name**: `ToolsService.execute` changed
  from a single `ToolExecutionInput` to a batch `ToolBatchInput { calls: [{type:'tool-call', id, name,
  arguments: <raw JSON string>}], … }` → `ToolBatchResult`. A mount caught it (`ADAPTER_TOOL_CALL=fail:
  Tool batch execution failed`); our inventory had searched `tools.resolve`/`executable` and missed it.
  The adapter now feature-detects the generation from a capability the 0.2.2 service added
  (`executable()`/`resolve()`) — no version string, no discovery by throwing — and sends the shape the
  host expects. Both harness lines are green, and a genuine tool error still surfaces (a unit arm
  proves there is no blind retry).
- **Declared capability delta on the old host**: 0.2.2 removed the `./list-agents` subpath export, so
  the `mpd` preset's `tool-subagent-list-agents` row had to go. A row's module is resolved before
  `disabled` is honoured, so a conditional row is not a fix. On 0.2.1-rc.5 the bundle still installs,
  mounts and runs (verified), but `list_agents` is no longer mounted there. That is the price of
  straddling one preset across two harness lines, stated plainly rather than hidden.

**2. dsh-TUI — declared/measured host 0.18.0 → 0.19.0**
- The admission rulebook did **not** change: the guide (`6b9dfd3…`, 99,723 B), the contract/permission
  registries and all eleven admission-decision source files are byte-identical at v0.18.0 and v0.19.0.
  There was no admission rework to do, and this PR does not pretend otherwise.
- `compat.hosts` becomes a BAND (`0.18.0` and `0.19.0`); `dsh-distribution.json`'s `host-tui` ref and the
  Docker lane defaults move to 0.19.0.

**3. DSH-Go — the adaptation becomes a real gate**
- `scripts/verify-dshgo-standard.ts` encodes the official native-plugin standard: manifest identity and
  byte cap, cross-slot id uniqueness, per-slot counts, per-locale character limits, `wants` pairing,
  static effect kinds, strip→panel references, `package.json.engines.dsh`, and the view budgets
  (tool card 8192 B / 40 nodes / depth 6, panel 32768 / 120 / 8, strip 2048 / 8 / 3).
- It is a `verify:gates` member (eleven now) and therefore runs in CI. Before this PR the DSH-Go gate was
  orphaned — no npm script, not in the aggregate, absent from every workflow.
- A **compatibility arm** asserts the older-app path: both static views are v1, a v2-only component may
  not leak into a declared static view, and the view kit keeps downgrading a v2 tree.
- An **official cross-check arm** runs `@dsh-go/plugin-kit`'s `check.mjs` when a checkout is supplied via
  `MPD_DSHGO_KIT`. The SDK is `private: true` and not on npm, so it is not vendored; when absent the arm
  reports NOT-PASSED rather than a silent green.
- The host half binds through the adapter with a deferred `ctx.inject(['dshGo'], …)`, satisfying the
  standard's binding form while keeping the bundle's seam rule (no plugin touches a harness service).

**4. Backward compatibility is now a binding rule**
- `AGENTS.md` gains the rule: any upstream adaptation keeps the new capability optional and the older host
  supported, with a gate carrying a compatibility arm.
- The compatibility matrix ships as `docs/compatibility.md` (+ zh-CN).

**5. Plugin display metadata (the web settings/plugin-manager surface)**
- The icon contract did not change: `package.json.icon` is a top-level, optional, version-stable path, and
  this bundle already declares `./icon.svg`, ships it, and exports it. Verified, not changed.
- A pre-existing gap is fixed: `locale/*.json` were flat `{title, description}` while the host reads
  `{"meta": {...}}` — our localized title/description were likely never read. Both files are rewritten.
- New: `meta.detail` points at `docs/plugin-details.md` / `.zh-CN.md`, which renders as the plugin's
  rich-text detail page in 0.2.2's plugin manager.

### Evidence

| Item | Path | Result |
|---|---|---|
| pins, install, dual mount, routing proof | `evidence/upstream/0.2.2/` | PASS — mount on 0.2.2-rc.1 AND on 0.2.1-rc.5; `agentOptions` still selects the model (child session request header) |
| DSH-Go gate run + self-test + negative control | `evidence/dshgo/standard/` | gate exit 0 LEGAL with the kit, exit 3 NOT-PASSED without it, exit 1 on a broken manifest naming `id-duplicate`; self-test 44 arms |
| dsh-TUI admission against 0.19.0 (and 0.18.0) | `evidence/tui/`, `evidence/dshgo/tui-admission/` | compatible on both hosts |
| full gate sweep | `evidence/release/0.18.0/2026-11-07T06-55-08Z/result.json` | every row PASS; the ONE retained non-PASS row is the intermediate oneclick run, kept on purpose so the stale-pack failure stays auditable; the credentialed Docker `--live` runs are an OWED bounds entry, not a row; 1 declared skip |

### Gates run

| Gate | Observed |
|---|---|
| `verify:gates` (11 members) | **exit 0 — 11/11 green**, `dshgo` member LEGAL with the official cross-check agreeing |
| `verify-dist-fresh` | exit 0 — 34/34 targets fresh, 1 declared NOT COVERED (sha-pinned vendored file) |
| `verify-pack-closure` | exit 0 — 667 files compared, 667 identical, 0 drift |
| `verify-plugin-manifest --pack` | exit 0 — 1256 packed files, 0 required paths absent |
| `verify-comment-coverage` | exit 0 — 614 files, 54,925 declarations |
| `verify-vendor` | exit 0 — after the wave's single re-pin |
| `verify-no-host-override` | exit 0 — 0 of 0 id-targets collide with 214 host-declared ids |
| `verify-manual-paths` | exit 0 — resolved 155, over-report 69, under-report 79 |
| `typecheck` | exit 0 |
| `bun test packages` | exit 0 — 3,699 tests / 246 files / 0 fail / 6 skip |
| `test:qa` (pinned harness) | exit 0 — all self-tests passed |
| QA real cases | `dshgo-standard` PASS, `preset-conformance` PASS (negative control reddens), `dual-track-smoke` PASS, `mcp-call` PASS, `bundle-lifecycle` PASS, `tui-admission` SKIP (absent fixture) |
| Docker | source `--no-browser` **exit 0 PASS**; **oneclick exit 0 PASS** after a re-pack (its first run exposed a stale artifact: `dist/mpd-package/` predated the vendor re-pin, `pack.staticCoherence` drifted, so the pack was re-made and the lane re-run); credentialed `--live` runs **OWED before the tag** — no key was staged, so `exit 3` there is a MISSING PREREQUISITE, not a designed bound |

### Honest bounds

- No Flutter/DSH-Go app exists in this repository: the native half is proven against the published
  standard, the pinned spec data and service doubles — **not** on a device.
- The official checker is not vendored; its absence is reported, never green.
- The Docker real-machine lane may skip without a rootless daemon; a skip is not a pass.
- `compat.hosts` is a published claim, not an admission input — no host code reads it.

---

## 简体中文

### 改了什么

**1. DSH 内核 — `@deepseek-ai/dsh` 0.2.1-rc.5 → 0.2.2-rc.1**
- 三个 `@deepseek-ai/dsh-experimental-*` 同步升级；`engines.node` → `>=24.9.0`。
- 新增 `engines.dsh`，范围同时覆盖新旧两条 harness 线。
- 0.2.2 宣称的四项破坏性变更（模型路由改走 `agent.model`、`tools.resolve`/`executable`、Session
  Projection 异步注册、Agent Team inbox 迁移）**不涉及本仓库**：盘点证明这里没有 `agent/request`
  监听、没有 `tools.resolve`、没有 `executable` 工具属性、也没有投影注册。模型选择走四处
  `agentOptions`，本 PR 附一次真实运行，证据来自 harness 会话日志中真正服务的模型，而不是模型的自述。
- 没有做静默的路由重写。若 `agentOptions` 在 0.2.2 上不再生效，本波会以 Blocker 上报。

**2. dsh-TUI — 声明/实测宿主 0.18.0 → 0.19.0**
- 准入规则**没有变化**：准入指南（`6b9dfd3…`，99,723 字节）、契约与权限注册表、以及全部 11 个准入判定
  源文件在 v0.18.0 与 v0.19.0 逐字节相同。所以本 PR 没有做合规返工，也不假装做过。
- `compat.hosts` 改为区间（同时列出 `0.18.0` 与 `0.19.0`）；`dsh-distribution.json` 的 `host-tui`
  引用与 Docker lane 默认值升到 0.19.0。

**3. DSH-Go — 把适配变成真门**
- `scripts/verify-dshgo-standard.ts` 落实官方原生插件标准：清单标识与字节上限、跨插槽 id 唯一性、
  各插槽数量、**按语言分别测量**的字符上限、`wants` 配对、静态 effect 种类、状态条→面板引用、
  `package.json.engines.dsh`，以及视图预算（工具卡 8192 B / 40 节点 / 深度 6，面板 32768 / 120 / 8，
  状态条 2048 / 8 / 3）。
- 它现在是 `verify:gates` 的成员（共十一个），因此在 CI 中运行。本 PR 之前，DSH-Go 门是**孤儿**：
  没有 npm script、不在聚合门里、不在任何 workflow 中。
- 新增**兼容臂**：两个静态视图保持 v1、v2-only 组件不得泄漏进声明的静态视图、视图套件继续把 v2 树降级。
- 新增**官方交叉验证臂**：当 `MPD_DSHGO_KIT` 指向上游 checkout 时运行 `@dsh-go/plugin-kit` 的
  `check.mjs`。该 SDK 是 `private: true`、npm 上没有，因此不 vendor；缺失时该臂报 NOT-PASSED，而不是
  静默通过。
- 宿主半侧通过适配器以延迟 `ctx.inject(['dshGo'], …)` 绑定，既满足标准的绑定形式，也守住本仓库的
  接缝规则（任何插件不得直接触碰 harness service）。

**4. 向下兼容成为绑定规则**
- `AGENTS.md` 新增规则：任何上游适配都必须让新能力可选、旧宿主继续可用，并由门携带兼容臂。
- 兼容矩阵落地为 `docs/compatibility.md`（含 zh-CN）。

**5. 插件展示元数据（web 设置/插件管理面）**
- 图标契约未变：`package.json.icon` 是顶层、可选、跨版本稳定的路径；本仓库已声明 `./icon.svg`、
  已随包发布、已导出。此项是核实，不是修改。
- 修掉一个早于 0.2.2 就存在的缺口：`locale/*.json` 原本是扁平 `{title, description}`，而宿主读取的是
  `{"meta": {...}}` —— 我们的本地化标题/描述很可能从未被读到。两个文件已重写。
- 新增：`meta.detail` 指向 `docs/plugin-details.md` / `.zh-CN.md`，在 0.2.2 的插件管理页渲染为
  富文本详情页。

### 证据

| 项目 | 路径 | 结果 |
|---|---|---|
| 版本锚点、安装、双宿主挂载、路由实证 | `evidence/upstream/0.2.2/` | PASS — 0.2.2-rc.1 与 0.2.1-rc.5 双线挂载；`agentOptions` 仍能选中模型（子会话 request header） |
| DSH-Go 门运行 + 自测 + 负控 | `evidence/dshgo/standard/` | 带 kit 时 exit 0 LEGAL，无 kit 时 exit 3 NOT-PASSED，坏清单 exit 1 并点名 `id-duplicate`；自测 44 臂 |
| 对 0.19.0（及 0.18.0）的 TUI 准入 | `evidence/tui/`、`evidence/dshgo/tui-admission/` | 双宿主均 compatible |
| 全门扫描 | `evidence/release/0.18.0/2026-11-07T06-55-08Z/result.json` | 所有行 PASS；唯一保留的非 PASS 行是 oneclick 的中间那次运行，故意留着以便那次陈旧打包的失败可审计；带凭据的 Docker `--live` 是**欠账边界条目**，不是一行门记录；1 项声明性跳过 |

### 跑过的门

| 门 | 实测 |
|---|---|
| `verify:gates`（11 个成员） | **exit 0 — 11/11 全绿**，`dshgo` 成员 LEGAL 且官方交叉验证一致 |
| `verify-dist-fresh` | exit 0 — 34/34 目标新鲜，1 个声明性 NOT COVERED（sha 钉死的 vendored 文件） |
| `verify-pack-closure` | exit 0 — 667 文件对比，667 一致，0 漂移 |
| `verify-plugin-manifest --pack` | exit 0 — 打包 1256 文件，0 必需路径缺失 |
| `verify-comment-coverage` | exit 0 — 614 文件、54,925 个声明 |
| `verify-vendor` | exit 0 — 在本波唯一一次 re-pin 之后 |
| `verify-no-host-override` | exit 0 — 0 个 id-target 与 214 个宿主声明 id 冲突 |
| `verify-manual-paths` | exit 0 — resolved 155，over-report 69，under-report 79 |
| `typecheck` | exit 0 |
| `bun test packages` | exit 0 — 3,699 测试 / 246 文件 / 0 失败 / 6 跳过 |
| `test:qa`（钉死 harness） | exit 0 — 全部自测通过 |
| QA 真实 case | `dshgo-standard` PASS、`preset-conformance` PASS（负控可红）、`dual-track-smoke` PASS、`mcp-call` PASS、`bundle-lifecycle` PASS、`tui-admission` SKIP（缺 fixture） |
| Docker | source `--no-browser` **exit 0 PASS**；**oneclick exit 0 PASS**（需重打包：首跑暴露了陈旧产物——`dist/mpd-package/` 早于 vendor 重锚，`pack.staticCoherence` 漂移，已重打包并重跑）；带凭据的 `--live` 两条 **发版前仍欠账**——未注入密钥，那里的 `exit 3` 是**缺失前置**，不是设计上的边界 |

### 诚实的边界

- 本仓库没有 Flutter / DSH-Go App：原生半侧是对照公开标准、钉死的规格数据与服务替身证明的，
  **不是**真机验证。
- 官方校验器没有 vendor；它的缺失会被报告，绝不当作通过。
- Docker 真机 lane 在没有 rootless daemon 时会跳过；跳过不是通过。
- `compat.hosts` 是公开发布声明，不是准入输入——宿主代码不读它。

