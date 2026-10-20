# v0.14.0 — DeepSeek Harness 0.2.1-rc.2 + dsh-tui 0.16.1, one shared plan→graph model, and a real-team acceptance lane

Minor release over v0.13.2, and a **BREAKING** one. The bundle now targets DeepSeek Harness
**0.2.1-rc.2** and dsh-tui **0.16.1**; the plan→graph model is computed once in the host plane and drawn
by both surfaces; and the 2026-10-10/11 guard ceremony is withdrawn, so the top-level agent holds its
tool pack directly again. A real two-member team now builds and tests a small project through the Web
composer and the TUI PTY in the Docker acceptance lane.

## English

### Breaking / host adaptation

- **DeepSeek Harness 0.2.1-rc.2.** `startContinuable()` / `start()` are removed; the adapter rebuilds
  the native team executor and the spawn path on `startActivation()` + `waitForChildren()`, with
  `delivery` as a required spec field and `result.output` read as `ContentBlock[]`. `webRuntime` became
  `webApp`, so the sidebar row probes both names and self-disables with a printed reason when neither
  carries `trustedHosts`.
- **dsh-tui 0.16.1.** 0.16.1 is the harness-0.2.1 release: all 36 `@deepseek-ai/dsh-*` peers admit
  `0.2.1-rc.2`. A declaration-level comparison against 0.15.0 found nothing breaking for the adapter
  (same fifteen `tui*` seams, same six shapes, `close(): void` + `active.id`, `tuiPanels` unchanged,
  `tuiPrompt` still a phantom), so the pins were the whole change. `dsh-plugin.json`'s stale
  `compat.hosts` moved with them.
- **Preset / row parity** follows the 0.2.1 `standard` preset: `time-context`, `tool-schedule` and the
  disabled `tool-plugin-manager` / `tool-plugin-market` are in; `tool-ralph`,
  `tool-subagent-codex` and `tool-subagent-claude-code` are out; `backgroundMode` and
  `maxPendingMessagesPerMember` are gone from the rows that no longer declare them.
- **The 2026-10-10/11 guard ceremony is withdrawn.** The top-level `mpd` agent holds `read`, `write`,
  `edit`, `bash`, `grep`, `glob` and `subagent` directly again, steered by the persona prompt. The
  roster's eight-name read-only deny and the `ask_user_question` schema backstop REMAIN installed; the
  roster, team, verify, memory, boulder and ULW surfaces stay shipped and callable. `team.gate`
  defaults to `off`. The boot line reports each withdrawn guard as `absent` with its reason.
- **Honest consequence:** the mechanical single-git-writer denial for member sessions is gone too. That
  rule is prose from this release on; its enforcement is the dispatch contract (members edit files and
  run gates, the captain commits) plus review.

### Added

- **One shared plan→graph model** (`packages/mpd-graph-core`). One tolerant plan parser, one
  board+plan merge with its six-case report, one rank derivation (moved verbatim out of the TUI) and
  one debounced watcher. The host plane computes `buildModel({ board, plan })` once per team and
  publishes it on `mpdTeams.graph(...)` and the `/plugins/mpd-team/state` payload (`model` +
  `tasks[].rank`, additive); the web client derives nothing and the TUI renders the same model.
  Plan-only nodes are drawn as ghosts (`planned: true`, `visual: "planned"`) and plan-only edges are
  drawn too. New gate: `bun run verify:graph` (`--self-test` 8/8, `--seed-wrong-edge` negative
  control).
- **A real-team acceptance lane.** `MPD_E2E_TEAM_PROJECT=1` drives a real two-member team through the
  Web composer and the TUI PTY: stage a two-task plan (T2 blocked by T1), approve, dispatch, wait,
  re-dispatch, close both rows while the members write and test `team-project-web/` /
  `team-project-tui/`. `docker/lib/team-project-verdict.ts` reads the verdict from the record and the
  artifacts (members raised, a resolvable dependency edge, credited completions, files written during
  the step, the team's own test and a verifier-owned `sum(2, 3) === 5` assertion) and ships a 10-arm
  `--self-test`.

### Fixed

- The team web routes resolve the workspace from the SESSION the request names (new
  `workspaceRootForSession`) instead of the dsh process cwd, so the panel no longer says “No team in
  this workspace yet” beside a completed board.
- A task claimed under a member's EXECUTOR HANDLE is credited to that member everywhere (core progress,
  dispatch idle pool, TUI projection); member cards no longer read `0/0`.
- A nested failure line no longer ends the reply wait while the lead keeps working; a headless live
  turn after `approve` is bounded instead of hanging while a teammate stays alive.
- Docker live rows: skipped rows are separated from a refused run, the credential-free WEB check is
  scoped to the non-live reason, and real WEB / TUI turns are graded for prompt-variable failures.
- The packer ships `packages/mpd-graph-core/dist`, closing the pack-closure gap.

### Install / upgrade

Upgrade the host first: DeepSeek Harness **0.2.1-rc.2** and dsh-tui **0.16.1**. Then, from a checkout:

```bash
dsh plugin --profile web add .
```

or against the published artifact (after the release is public):

```bash
dsh plugin --profile web add github:HaroldZ32/My-Power-Dsh
# or, once npm has the version: dsh plugin --profile web add @mpd-dsh/mpd
```

npm publishing stages through trusted publishing; the stage is not public until a human approves it.

### Verified by the release sweep

| Gate | Result |
|---|---|
| `verify:vendor` | PASS — 7 shipped assets fingerprinted |
| `verify:rows` | PASS — 35 row ids |
| `verify:docs` | PASS — 48 pairs, 438 links, 0 dead |
| `verify:manifest --pack` | PASS — 1009 packed files, every required path present |
| `verify:comments` | PASS — 424 files, 37,359 declarations |
| `verify:graph` | PASS — nodes/edges/ranks/cycles equal the declared input |
| `verify:no-host-override` | PASS — 0 of 0 collisions with 213 host row ids |
| `verify:manual-paths` | PASS — 166 resolved, declared/anticipatory class counted apart |
| `verify-dist-fresh` | PASS — 32/32 targets fresh, each rebuilt twice byte-identical |
| `verify:gates` aggregate | PASS — 9/9 member gates green |
| `typecheck` (tsgo) | exit 0 |
| `bun test packages` | 2,129 pass / 0 fail — 2,132 tests across 133 files |
| `test:qa` | PASS — every case, plus `mpd-ext --self-test` (53 checks) and `validate` |
| `preset-conformance --self-test` | PASS — 32 harness rows, 29 preset child rows, 27/27 parity, 4/4 negative controls |
| `pack` + `verify-pack-closure` (twice) | PASS — 608/608 content files identical, 0 drift, 0 expected-after-pack |
| `dual-track-smoke` | official track PASS; gateway track cannot run on this host (`NO_ADAPTER` for provider `deepseek`, identical to the v0.13.2 evidence — the host carries no `dsh-llm-pi-ai` adapter) |
| `mcp-call` | PASS — 108 recorded tools, `mcp__ast_grep__` + `mcp__lsp__` present, a real ast-grep call recorded |
| Docker `source` (`--require-docker --live`) | PASS — 117 passed / 0 failed / 5 declared NULL (rootless; `evidence/docker/client-install/2026-10-20T02-44-13Z/`) |
| Docker `oneclick` (`--require-docker --live`) | PASS — 116 passed / 0 failed / 6 declared NULL (rootless; `evidence/docker/client-install-oneclick/2026-10-20T02-57-09Z/`) |

Full logs: [`gates/`](./gates/). Docker evidence: `evidence/docker/client-install*/`.

## 简体中文

较 v0.13.2 的 **minor（破坏性）** 版本。本版把宿主基线推进到 DeepSeek Harness **0.2.1-rc.2** 与
dsh-tui **0.16.1**；plan→graph 模型改为在宿主平面只计算一次、由 Web 与 TUI 共同渲染；撤销
2026-10-10/11 的守卫仪式，顶层 agent 重新直接持有完整工具包；Docker 验收车道新增真实双成员团队
分别通过 Web 输入框与 TUI PTY 完成一个小工程的判定。

### 破坏性变更 / 宿主适配

- **DeepSeek Harness 0.2.1-rc.2。** `startContinuable()` / `start()` 已移除；适配器改用
  `startActivation()` + `waitForChildren()` 重建原生团队执行器与 spawn 路径，`delivery` 成为必填字段，
  `result.output` 按 `ContentBlock[]` 读取。`webRuntime` 更名 `webApp`：侧栏行同时探测两个名字，两者都
  不带 `trustedHosts` 时打印原因并自禁用。
- **dsh-tui 0.16.1。** 0.16.1 就是 harness-0.2.1 版本：36 个 `@deepseek-ai/dsh-*` peer 全部接受
  `0.2.1-rc.2`。与 0.15.0 的声明级比较未发现适配器破坏（仍是十五个 `tui*` 接缝、六个形状、
  `close(): void` + `active.id`、`tuiPanels` 不变、`tuiPrompt` 仍为 phantom），所以这次只动版本钉。
  `dsh-plugin.json` 里陈旧的 `compat.hosts` 一并更新。
- **Preset / 行对齐** 跟随 0.2.1 `standard`：加入 `time-context`、`tool-schedule` 与禁用的
  `tool-plugin-manager` / `tool-plugin-market`；移除 `tool-ralph`、`tool-subagent-codex`、
  `tool-subagent-claude-code`；schema 不再声明的 `backgroundMode` 与 `maxPendingMessagesPerMember`
  从对应行移除。
- **撤销 2026-10-10/11 守卫仪式。** 顶层 `mpd` agent 重新直接持有 `read`、`write`、`edit`、`bash`、
  `grep`、`glob`、`subagent`，由 persona 提示词约束。名册的八名只读拒绝清单与
  `ask_user_question` schema 兜底**仍然保留**；名册、团队、verify、memory、boulder、ULW 面继续随包
  发布且可调用。`team.gate` 默认 `off`。启动行把每个被撤销的守卫记为 `absent` 并带原因。
- **需要明说的后果：** 成员会话的机械式单 git writer 拒绝也一并消失。该规则从本版起是**文字约定**，
  靠派发契约（成员改文件、跑门禁，队长提交）与评审执行。

### 新增

- **共享 plan→graph 模型**（`packages/mpd-graph-core`）：一个宽容的 plan 解析器、一个 board+plan
  合并与六类冲突报告、一份从 TUI 原样搬出的 rank 推导、一个防抖 watcher。宿主平面每队只计算一次
  `buildModel({ board, plan })`，发布到 `mpdTeams.graph(...)` 与 `/plugins/mpd-team/state`
  （`model` + `tasks[].rank`，纯增量）；Web 客户端不再自行推导，TUI 渲染同一模型。仅 plan 声明的
  节点作为 ghost 画出（`planned: true`、`visual: "planned"`），仅 plan 的边也画出。新门禁
  `bun run verify:graph`（`--self-test` 8/8，`--seed-wrong-edge` 反向控制）。
- **真实团队验收车道。** `MPD_E2E_TEAM_PROJECT=1` 让真实双成员团队分别经 Web 输入框与 TUI PTY
  完成一个工程：拟定两任务计划（T2 被 T1 阻塞）→ 批准 → 派发 → 等待 → 二次派发 → 关闭两行，成员
  写出并测试 `team-project-web/` / `team-project-tui/`。`docker/lib/team-project-verdict.ts`
  从记录与产物读取判定（成员被拉起、可解析依赖边、完成归属、步骤内写文件、团队自测与验证器自写的
  `sum(2, 3) === 5`），附 10 臂 `--self-test`。

### 修复

- 团队 Web 路由按请求命名的 **session** 解析工作区（新增 `workspaceRootForSession`），不再用 dsh
  进程 cwd，面板不会再在已完成看板旁显示“本工作区还没有团队”。
- claim 后 owner 存的是成员 **executor 句柄**，现在在 core 进度、dispatch 空闲池与 TUI 投影中统一
  归到该成员；成员卡不再显示 `0/0`。
- 嵌套失败行不再在 lead 继续工作时提前结束回复等待；`approve` 后的 headless 实时回合有超时，
  不会因队友仍存活而挂死。
- Docker live 行：跳过与拒绝运行分开记录；无凭据的 WEB 检查只归因于非 live 原因；真实 WEB / TUI
  回合按提示词可变失败判定。
- 打包器补上 `packages/mpd-graph-core/dist`，闭合 pack-closure 缺口。

### 安装 / 升级

先把宿主升级到 DeepSeek Harness **0.2.1-rc.2** 与 dsh-tui **0.16.1**。然后在 checkout 里：

```bash
dsh plugin --profile web add .
```

发布公开后可用：

```bash
dsh plugin --profile web add github:HaroldZ32/My-Power-Dsh
# 或 npm 上已有该版本后：dsh plugin --profile web add @mpd-dsh/mpd
```

npm 发布走 trusted publishing 的 **stage** 流程，需人工 approve 后才公开。

### 本版验收（实测）

| 门禁 | 结果 |
|---|---|
| `verify:vendor` | PASS —— 7 个随包资产指纹 |
| `verify:rows` | PASS —— 35 个行 id |
| `verify:docs` | PASS —— 48 对文档、438 条链接、0 死链 |
| `verify:manifest --pack` | PASS —— 1009 个打包文件，所有必需路径存在 |
| `verify:comments` | PASS —— 424 个文件、37,359 个声明 |
| `verify:graph` | PASS —— 节点/边/rank/环与声明输入一致 |
| `verify:no-host-override` | PASS —— 0/0 与 213 个宿主行 id 冲突 |
| `verify:manual-paths` | PASS —— 166 个路径解析成功，声明/预留类单独计数 |
| `verify-dist-fresh` | PASS —— 32/32 目标新鲜，每个重建两次逐字节一致 |
| `verify:gates` 聚合 | PASS —— 9/9 成员门禁全绿 |
| `typecheck`（tsgo） | exit 0 |
| `bun test packages` | 2,129 通过 / 0 失败 —— 133 个文件、2,132 项 |
| `test:qa` | PASS —— 全部 case，加上 `mpd-ext --self-test`（53 项）与 `validate` |
| `preset-conformance --self-test` | PASS —— 32 个 harness 行、29 个 preset 子行、27/27 对齐、4/4 反向控制 |
| `pack` + `verify-pack-closure`（两次） | PASS —— 608/608 内容文件一致、0 漂移、0 expected-after-pack |
| `dual-track-smoke` | official 轨道 PASS；gateway 轨道在本机无法运行（provider `deepseek` 报 `NO_ADAPTER`，与 v0.13.2 证据一致——本机没有 `dsh-llm-pi-ai` 适配器） |
| `mcp-call` | PASS —— 108 个已记录工具，`mcp__ast_grep__` + `mcp__lsp__` 存在，记录了真实 ast-grep 调用 |
| Docker `source`（`--require-docker --live`） | PASS —— 117 通过 / 0 失败 / 5 条声明式 NULL（rootless；`evidence/docker/client-install/2026-10-20T02-44-13Z/`） |
| Docker `oneclick`（`--require-docker --live`） | PASS —— 116 通过 / 0 失败 / 6 条声明式 NULL（rootless；`evidence/docker/client-install-oneclick/2026-10-20T02-57-09Z/`） |

完整日志见 [`gates/`](./gates/)；Docker 证据见 `evidence/docker/client-install*/`。
