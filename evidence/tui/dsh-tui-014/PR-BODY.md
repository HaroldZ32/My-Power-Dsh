# Pull request — `feature/tui-014-adaptation` → `dev`

Human-facing review surface. BILINGUAL by the repository's rule: English first, 简体中文 second, in
ONE description. Every claim below is backed by an artifact path or a command whose observed result is
quoted; the honest bounds are at the end of each section rather than in a footnote.

---

## English

### What changed

**1. The bundle is adapted to `@deepseek-harness-tui/dsh-tui` 0.14.0.**
The fifteen plugin-facing `ctx.tui*` seam modules are **byte-identical** between 0.13.0 and 0.14.0, so
the adapter needed no change for its seam surface; the harness `peerDependencies` range is unchanged,
so the harness pin does not move. Every DSH-TUI release carrier now names `0.14.0` — `docker/**`
(entrypoints, both compose defaults and their comments, the lane script), the QA lanes' host
specs/prereqs/remedies (7 files under `skills/dsh-qa/scripts/`), `dsh-distribution.json`'s `host-tui`
ref, and the prose of `docker/README{,.zh-CN}.md`. Deliberately unmoved: `MPD_E2E_DSH_VERSION` (peer
range unchanged) and `dsh-plugin.json`'s `compat.hosts = …@0.10.1` (it records the 0.10.1
extension-admission measurement, not the edition this bundle targets).

**2. One measured breakage, repaired onto the invariant rather than a new literal.**
0.14.0 changed the host's default enabled-panel CSV from 3 builtins to 8
(`todo,jobs,agents,info,trajectory,workspace,btw,companion`). The two arms that pinned the old literal
now assert what the clause is for: the default names builtins only and NOTHING of ours, every id passes
the host's own grammar, and `normalizeSidePanelPanels` is idempotent.

**3. The sidebar carries exactly TWO MPD pages** (the user's clause).
`MPD` (slug `team`, icon `❖`, order 10) now RENDERS the rich DAG page — bordered frame, team header
with progress, legend, key-hint footer, click-to-pin detail body, three layouts, the `⤢` control —
with the host's curated subagent rows ABOVE the drawing inside that same frame; the workmate page
(slug `workmate`, icon `⬢`, order 12) is unchanged. The old merged page's registration and the
standalone `dag` registration are retired, `DAG_PANEL_SLUG` deleted (zero readers), `/mpd dag` re-aims
onto the MPD panel with the team scene as its fallback, and the `/mpd dag` picker description
(user-visible text) was corrected. No route, picker entry or full-screen route is a dead end.

**4. The reported defect — "an extra legend row on every click until the screen overflows" — was real,
in our code, and is fixed fail-first.**
The legend rows were keyed `legend-${line.slice(0, 24)}`, and the drawing's own state line and the
legend's first wrapped line both begin `✓ completed · ◐ running`: two children shared ONE React key, and
React rendered the collided row once more on EVERY re-render. Measured on a mounted instance with the
host's own React/ink while driving the click/pin interaction: **pre-fix `[4,5,5,5,6,6,6,7,7]` legend
rows; post-fix `[4,4,4,4,4,4,4,4,4]`**. The fix is position keys (legend, pinned detail body, workmate
rows). The keeping arm asserts the row count is STABLE across N clicks, and an in-file NEGATIVE CONTROL
asserts the pre-fix key shape still accumulates, so the green arms cannot be vacuous.

**5. The full-screen control and surface.** The page's own `⤢` and `/mpd dag` open the RICH full-screen
team scene (frame / legend / keys / pin); the subagents scene stays the route fallback. The host's own
`⤢` remains unreachable for a plugin panel on 0.14.0 (`capabilities` is still absent from the frozen
descriptor and `canExpand` still reads it), and this bundle does not ship a button that cannot work.

**6. Panel visibility — why the sidebar showed nothing of ours, and the two-sided repair.** The host
rewrites the enable CSV from `config.sidePanel?.panels` seconds after boot, dropping the ids a
registration appends; the keeper now follows the host's OWN change feed
(`subscribeSidePanelPanels`) and repairs the rewrite, standing down for good as soon as the list names
ANY of our ids (a user's choice always wins). The discovered-id record became version 2 with
`provenance {hostRoot, hostVersion, readBack, activation}`, and BOTH sides refuse an unprovable record —
the adapter will not write one, and `scripts/mpd-tui-panels.ts` will not read one
(`REFUSED: … it carries no \`provenance\` block (a version-1 record, whose ids cannot be traced to a
boot) … or pass --ids <a,b,c>`), because a unit-test run had been able to poison it with `act0:*`,
ids the host cannot compose.

**7. Docs + CHANGELOG.** `docs/tui.md` + `docs/tui.zh-CN.md` gain a §11.6 amendment (0.13.0/0.12.0
statements kept readable as history), the README pairs and `agent-references/seam-adapters.md` are
updated, and `CHANGELOG.md` gains one entry in the file's existing voice.

**8. The branch ALSO carries a second, independent commit — `fix(verify,roles)`: the captain is the
workspace's top-level session, never a preset name.**
The manual already documented that classification (§5, written by the captain on the user's own
instruction) and `agent-references/troubleshooting.md`'s `T-92` entry already called the defect fixed —
but the CODE still decided "is this the workspace's captain" through `sessionQualifies()`, whose preset
conjunct (`presets: ["mpd"]`) is UNREACHABLE on this deployment: every top-level session here records
`agentPreset: "cordis"`, so no live session could be the workspace's git writer and the user's own
`git add` / `git commit` were refused by a sentence asserting a fact the code never tested. The commit
makes the code true: ONE exported, PRESET-FREE predicate (`sessionIsTopLevel`, with `sessionRank`
reporting the class) that BOTH §5's git rule and the captain's write rule read; the guard's
`presets: ["mpd"]` knob deleted; `sessionQualifies` kept with its name and behaviour for the
session-start gate and the roster section, and a doc that says plainly it is NOT the captain test; and
both denial sentences rewritten to state the class that was actually decided (member/child, or
headerless fail-closed) and to name the one legitimate route — the user's own shell. **It lands in this
branch because the manual's claim and the code must not diverge**: shipping the doc half alone would
have shipped a manual that lies. Verification is independent and recorded — loop
`loop-20261008T055942-e51e88`, blind seat, **PASS** `rec-20261008T061038-a66ee9`, six gate-evidence logs
committed under `evidence/verify/captain-predicate-2026-10-08/`. The commit also repairs one red the
branch had inherited: `node scripts/verify-manual-paths.ts` was RED at `HEAD`, because §1 spelled the
boulder ledger as a root-relative literal (`.mpd/boulder.json`) while it is gitignored RUNTIME STATE
that no fresh clone has; it now reads `<workspace>/.mpd/boulder.json` and the gate is green.

**Commits on this branch, in order:** (1) `feat(tui)` — the 0.14.0 adaptation of items 1–7; (2)
`fix(verify,roles)` — item 8. `evidence/tui/dsh-tui-014/land-pr.sh` was DELETED rather than shipped: it
was the previous session's handover, its header states the very belief commit 2 falsifies, and running
it against an already-committed tree is a footgun. `GIT-HANDOFF.md` beside it now carries a SUPERSEDED
banner and keeps the incident text verbatim.

### Evidence

- Wave record (contract, FACTS, bounds, incidents): `evidence/tui/dsh-tui-014/WAVE-REPORT.md`
- Independent verification records: `rec-20261008T030715-f1a2ad` and `rec-20261008T032957-8ebe48`
  (PASS, blind seats, code loop `loop-20261008T015701-2161e0`), with their gate evidence under
  `.mpd/verify/evidence/`
- Real-host lanes (installed 0.14.0, sandbox `DSH_HOME`/`HOME`/cwd):
  `evidence/tui/lanes/2026-10-08T03-02-56.630Z/` (mount PASS),
  `evidence/tui/lanes/2026-10-08T03-48-12.424Z/` (Ctrl+A PASS: the host's own key stayed the host's),
  `evidence/tui/lanes/2026-10-08T03-10-38.473Z/` (the two-page sidebar, the rich panel body, the id
  provenance) and `…/2026-10-08T03-49-25.481Z/` (the consolidated lane record)
- Docker real-PTY lane: `evidence/docker/client-install/2026-10-08T03-18-21Z/` — and the closing run
  after the last write, recorded in the wave report §6
- The SECOND commit's committed anchor (the ledger under `.mpd/verify/**` is gitignored, so its
  artifacts are copied here): `evidence/verify/captain-predicate-2026-10-08/` — `CONTRACT.md` (the
  frozen contract), `record.json` (the PASS record), `loop.json`, `gates/` (the six gate logs) and
  `final-sweep.log` (the landing sweep, which covers the WHOLE branch)

### Gates run (observed)

`bun test packages` → **1643 pass / 3 skip / 2 fail** (the SAME two declared environment defects; the
count is 11 higher because commit 2 adds falsifier arms) · `bun test packages/mpd-tui-plugin
packages/mpd-tui-adapter-plugin` → **469 pass / 0 fail** · `bun run typecheck` exit 0 · `bun run
verify:docs` PASS (`pairs=47 failed=0 violations=0 dead=0`) · `bun run verify:rows`, `verify:comments`
and `verify:manifest` exit 0 (`VERDICT: PASS`) · `node scripts/verify-no-host-override.ts` exit 0 ·
**`node scripts/verify-manual-paths.ts` PASS — it was RED at `HEAD` (item 8)** · `node
scripts/verify-vendor.ts` PASS after the wave's single re-pin · `node scripts/verify-dist-fresh.ts`
30/30 fresh on the pinned `bun@1.4.0` · `node scripts/verify-pack-closure.ts` 0 drift (553 compared /
551 identical / 2 expected-after-pack) · `node skills/dsh-qa/scripts/verify-law.ts --self-test` exit 0 ·
`bun run verify:gates` PASS — 8/8 member gates green. Full log:
`evidence/verify/captain-predicate-2026-10-08/final-sweep.log`.

### Bounds — the part that matters

- `tuiRenderers` (red in every lane run since 2026-09-15) and `H4` (red 2026-09-30) are PRE-EXISTING
  and were not repaired; `tui-distribution` SKIPS with `absent-fixture` (proven unrunnable from the
  pinned checkout) and `tui-spec-conformance` is an environment red, falsified green by
  `DSH_TUI_ROOT=/root/dshProj/tui/dsh-TUI`.
- No lane drives the panel's own `⤢`; C5's full-screen surface rests on unit arms plus the Docker
  lane's scene rows.
- The docker lane's `node:24-bookworm` came from a mirror retag (`registry-1.docker.io` is unreachable
  here), and the sandbox lanes export this host's pnpm registry; both are declared deviations.
- A writer truncated `packages/mpd-tui-plugin/test/plugin.test.ts` to 0 bytes and reported a green
  suite while 44 tests were missing; the captain caught it, the file was restored byte-identically and
  then given three justified edits. The incident and the test-count reconciliation are in the wave
  report.
- The stale `.mpd/logs/mpd-tui-panels.json` still holds the polluted version-1 record; it is refused by
  design until a real boot rewrites it.
- The keeper's residual: a user who deletes ALL of our panel ids is indistinguishable from a fresh
  profile, so one further rewrite is repaired.
- **Commit 2 cannot take effect in a RUNNING host.** T-21 (no plugin-module hot reload): the guard this
  process installed keeps the old classification until `dsh` restarts. There is no live end-to-end
  witness that a top-level `cordis` session really runs `git commit`; the falsifiers are unit-level and
  the restart bound is the contract's own.
- **F6's code-comment half was NOT verified by the blind seat.** The verifier declared it undecidable
  inside its envelope (reading `packages/**` is exactly what blindness forbids) and recorded that as a
  bound instead of assuming it held; the CAPTAIN closed it by reading the comments after the verdict —
  that closure is INTEGRATION, not independent verification, and is declared as such.
- **The two suite reds, with their readable causes** (neither reachable from the guard predicate, and
  neither repaired here): `packages/mpd-mcp-shared/log-sink.test.ts` asserts the inherited stderr is the
  LOWEST free descriptor, and this sandbox reports `rebind=not-lowest` (an fd / launch-environment
  condition). `packages/mpd-roles-plugin/test/team-plane.test.ts` reads the repository's REAL
  `.mpd/boulder.json`, which has never been tracked (`git log -- .mpd/boulder.json` is empty;
  `.gitignore:21`) — so it ENOENTs on any fresh clone. The second is recorded as a separate housekeeping
  item, not silently skipped.
- **The gate repaired in item 8 has a blind spot, stated rather than hidden:** `verify-manual-paths`'s
  rule cannot tell a gitignored RUNTIME STATE file from a shipped asset, so any future runtime path
  spelled root-relative will redden the same way.

---

## 简体中文

### 变更内容

**1. 本捆绑已适配 `@deepseek-harness-tui/dsh-tui` 0.14.0。**
十五个面向插件的 `ctx.tui*` 接缝模块在 0.13.0 与 0.14.0 之间**逐字节相同**，因此适配器在接缝层无需改动；
harness 的 `peerDependencies` 范围未变，harness 钉不动。所有 dsh-tui 版本载体都已指向 `0.14.0`：
`docker/**`（两个 entrypoint、compose 的两处默认值及其注释、车道脚本）、QA 车道的 host spec/前置条件/补救命令
（`skills/dsh-qa/scripts/` 下 7 个文件）、`dsh-distribution.json` 的 `host-tui` 引用，以及
`docker/README{,.zh-CN}.md` 的说明文字。**刻意不动**的两处：`MPD_E2E_DSH_VERSION`（peer 范围未变）与
`dsh-plugin.json` 的 `compat.hosts = …@0.10.1`（它记录的是 0.10.1 的扩展准入**实测**，不是本捆绑面向的版本——文档已写明）。

**2. 一处实测破损，修在“不变量”上而不是换一个新的字面量。**
0.14.0 把宿主默认启用的面板列表从 3 个内置改成 8 个
（`todo,jobs,agents,info,trajectory,workspace,btw,companion`）。原先钉住旧字面量的两条断言，现在断言这条
子句真正要求的东西：默认列表只含内置面板、**不含本捆绑任何 id**，其中每个 id 都能通过宿主自己的 id 语法，
且 `normalizeSidePanelPanels` 是幂等的。

**3. 侧边栏恰好两个 MPD 页面**（用户子句）。
`MPD`（slug `team`，图标 `❖`，order 10）现在**渲染富外观的 DAG 页**——带边框的框架、队头与进度、图例、
按键提示行、点击固定详情、三种视图、`⤢` 控件——并把宿主的 subagent 行画在图的**上方**、同处一个框架内；
workmate 页（slug `workmate`，图标 `⬢`，order 12）保持不变。旧的合并页注册与独立的 `dag` 注册均已退役，
`DAG_PANEL_SLUG` 已删除（无任何读取方），`/mpd dag` 改为指向 MPD 面板、并以团队场景为回退；`/mpd dag` 在
命令面板里的描述（用户可见文案）也已更正。没有任何路由、选择项或全屏入口变成死路。

**4. 用户报告的缺陷——“每次点击多刷一行图例，直到撑爆屏幕”——真实存在、就在我们的代码里，并且按“先失败”修复。**
图例行原先用 `legend-${line.slice(0, 24)}` 作 key，而绘制模块自己的状态行与图例的第一折行都以
`✓ completed · ◐ running` 开头：两个子节点共用一个 React key，React 于是**每次重渲染都多画一遍**被撞的行。
用宿主自己的 React/ink 挂载真实组件并驱动点击/固定交互实测：**修复前 `[4,5,5,5,6,6,6,7,7]` 行，修复后
`[4,4,4,4,4,4,4,4,4]` 行**。修法是位置 key（图例、固定详情体、workmate 行）。保持用的断言要求“行数在 N 次点击后
**稳定不变**”，且同文件内有一条**负向对照**断言修复前的 key 形状仍会累积——绿色的臂因此不是空转的。

**5. 全屏按钮与全屏界面。** 页面自己的 `⤢` 与 `/mpd dag` 现在打开**富外观**的全屏团队场景（框架/图例/按键/固定）；
subagents 场景保留为路由回退。在 0.14.0 上，宿主自己的 `⤢` 对插件面板依旧不可达（冻结的描述符里仍没有
`capabilities`，而 `canExpand` 仍在读它），本捆绑**不**交付一个按不动的按钮。

**6. 面板可见性——侧边栏为什么看不到我们的面板，以及两侧的修复。** 宿主在启动后约几秒会用
`config.sidePanel?.panels` 重写启用列表，把注册时追加的 id 冲掉；现在的 keeper 订阅**宿主自己的变更通道**
（`subscribeSidePanelPanels`）并修复这次重写，而一旦列表里出现我们的**任一** id 就永久停手（用户的选择永远优先）。
被发现 id 的记录升级为 version 2，带 `provenance {hostRoot, hostVersion, readBack, activation}`，且**写入侧与读取侧
都拒绝**无法自证的记录——适配器不写，`scripts/mpd-tui-panels.ts` 也不读
（`REFUSED: … it carries no \`provenance\` block (a version-1 record, whose ids cannot be traced to a boot) …
or pass --ids <a,b,c>`），因为此前一次单元测试运行就能用 `act0:*`（宿主**不可能**生成的编号）污染它。

**7. 文档与 CHANGELOG。** `docs/tui.md` 与 `docs/tui.zh-CN.md` 新增 §11.6 修订（0.13.0/0.12.0 的表述保留为历史），
README 双语文档与 `agent-references/seam-adapters.md` 已更新，`CHANGELOG.md` 按既有体例新增一条。

**8. 本分支还带有一个独立的第二个提交——`fix(verify,roles)`：队长是工作区的顶层会话，不是 preset 名。**
手册早已这样定义（§5，由队长依据用户的直接指令写入），`agent-references/troubleshooting.md` 的 `T-92` 条目也已称其
“已修复”——但**代码**仍在用 `sessionQualifies()` 的 preset 合取项（`presets: ["mpd"]`）判断“本会话是不是队长”，
而本机上**每一个顶层会话记录的都是 `agentPreset: "cordis"`**：队长分支因此不可达，用户自己的 `git add` /
`git commit` 被一句断言了“代码从未检验的事实”的拒绝语挡下。该提交让代码与手册一致：导出**唯一且不读 preset** 的判定
（`sessionIsTopLevel`，并由 `sessionRank` 报告类别），§5 的 git 规则与队长写规则**共用**它；守卫的
`presets: ["mpd"]` 旋钮删除；`sessionQualifies` 保持原名与行为、只服务会话启动闸门与花名册段落，并在注释里写明它
**不是**队长判定；两句拒绝语改写为陈述**实际判定的类别**（成员/子会话，或无 header 时 fail-closed），并指出唯一合法
路径——用户自己的终端。**它与本波次同分支落地，因为手册的声明与代码不允许分叉**：只交付文档那一半，等于交付一份
撒谎的手册。验证独立且已记录：环 `loop-20261008T055942-e51e88`，盲席，**PASS** `rec-20261008T061038-a66ee9`，
六份闸门证据日志提交在 `evidence/verify/captain-predicate-2026-10-08/`。该提交还修掉一条本分支继承来的红灯：
`node scripts/verify-manual-paths.ts` 在 `HEAD` 上就是红的——§1 把 boulder 账本写成根相对字面量
（`.mpd/boulder.json`），而它是被 gitignore 的**运行态**文件、任何新克隆里都不存在；现改为
`<workspace>/.mpd/boulder.json`，闸门转绿。

**本分支的提交顺序：**（1）`feat(tui)`——第 1–7 条所述的 0.14.0 适配；（2）`fix(verify,roles)`——第 8 条。
`evidence/tui/dsh-tui-014/land-pr.sh` **已删除**而非随分支交付：它是上一个会话的交接脚本，其文件头陈述的正是第 2 个
提交所推翻的判断，而对一棵已提交的树运行它是纯粹的坑；同目录的 `GIT-HANDOFF.md` 现带有 SUPERSEDED 标记并保留事故原文。

### 证据

- 波次记录（契约、实测事实、边界、事故）：`evidence/tui/dsh-tui-014/WAVE-REPORT.md`
- 独立验证记录：`rec-20261008T030715-f1a2ad` 与 `rec-20261008T032957-8ebe48`（PASS，盲席，代码环
  `loop-20261008T015701-2161e0`），其闸门证据在 `.mpd/verify/evidence/`
- 真机车道（已安装的 0.14.0，隔离 `DSH_HOME`/`HOME`/cwd）：
  `evidence/tui/lanes/2026-10-08T03-02-56.630Z/`（挂载 PASS）、
  `evidence/tui/lanes/2026-10-08T03-48-12.424Z/`（Ctrl+A PASS：宿主的键仍是宿主的）、
  `evidence/tui/lanes/2026-10-08T03-10-38.473Z/`（两页侧边栏、富外观面板体、id 来源证明）与
  `…/2026-10-08T03-49-25.481Z/`（汇总车道记录）
- 真实 PTY 的 Docker 车道：`evidence/docker/client-install/2026-10-08T03-18-21Z/`——最后一次写入之后的收官
  运行记录在波次记录 §6
- 第二个提交的**已提交锚点**（`.mpd/verify/**` 被 gitignore，故其产物复制至此）：
  `evidence/verify/captain-predicate-2026-10-08/`——`CONTRACT.md`（冻结契约）、`record.json`（PASS 记录）、
  `loop.json`、`gates/`（六份闸门日志）与 `final-sweep.log`（覆盖**整条分支**的落地闸门全量）

### 已运行的闸门（实测结果）

`bun test packages` → **1643 通过 / 3 跳过 / 2 失败**（仍是那两条**已声明环境缺陷**；数量多 11 条是因为第 2 个提交
新增了伪证臂）· `bun test packages/mpd-tui-plugin packages/mpd-tui-adapter-plugin` → **469 通过 / 0 失败** ·
`bun run typecheck` 退出 0 · `bun run verify:docs` PASS（`pairs=47 failed=0 violations=0 dead=0`）·
`bun run verify:rows`、`verify:comments`、`verify:manifest` 均退出 0（`VERDICT: PASS`）·
`node scripts/verify-no-host-override.ts` 退出 0 · **`node scripts/verify-manual-paths.ts` PASS——它在 `HEAD` 上是红的
（见第 8 条）** · `node scripts/verify-vendor.ts` 在本波次唯一一次 re-pin 后 PASS ·
`node scripts/verify-dist-fresh.ts` 在钉住的 `bun@1.4.0` 下 30/30 全新鲜 ·
`node scripts/verify-pack-closure.ts` 0 漂移（553 比较 / 551 一致 / 2 expected-after-pack）·
`node skills/dsh-qa/scripts/verify-law.ts --self-test` 退出 0 · `bun run verify:gates` PASS——8/8 成员闸门全绿。
完整日志：`evidence/verify/captain-predicate-2026-10-08/final-sweep.log`。

### 边界——最要紧的部分

- `tuiRenderers`（自 2026-09-15 起每次车道运行都是红的）与 `H4`（2026-09-30 起红）属于**既有**问题，本波次未修；
  `tui-distribution` 以 `absent-fixture` 跳过（已证明在钉住的 checkout 上无法运行），`tui-spec-conformance` 是环境红灯，
  用 `DSH_TUI_ROOT=/root/dshProj/tui/dsh-TUI` 可反向证伪为绿。
- 没有任何车道真正按下面板自己的 `⤢`；C5 的全屏界面依赖单元臂与 Docker 车道的场景行。
- Docker 车道的 `node:24-bookworm` 来自镜像重打标签（本机到 `registry-1.docker.io` 超时），沙箱车道导出本机的
  pnpm 镜像源；两处都已声明。
- 一位写作者曾把 `packages/mpd-tui-plugin/test/plugin.test.ts` 截断为 0 字节，并在丢掉 44 条测试的情况下报告套件全绿；
  队长在树上发现后驳回，该文件按 HEAD 逐字节还原，随后只做了三处有理由的修改。事故与测试数对账见波次记录。
- `.mpd/logs/mpd-tui-panels.json` 仍是被污染的 version-1 记录；在真实启动重写它之前，脚本按设计拒绝读取。
- keeper 的残留边界：把我们的面板 id **全部**删掉的用户，与全新 profile 无法区分，因此还会被修复一次。
- **第 2 个提交在正在运行的宿主里无法生效**（T-21：插件模块无热重载）：本进程已安装的守卫仍按旧分类判断，直到 `dsh`
  重启。本记录里没有“顶层 `cordis` 会话真的跑通 `git commit`”的端到端见证；伪证臂只到单元层，重启边界是契约自述的。
- **F6 的“代码注释”那一半并非由盲席验证。** 验证席声明它在其信封内**不可判定**（读 `packages/**` 正是盲性所禁止的），
  并把它记为边界而不是假定它成立；随后由**队长**在判决记录之后再读注释关闭——那次关闭属于**集成**，不是独立验证，
  已如实声明。
- **两条套件红灯及其可读成因**（都从守卫判定不可达，也都未在此修复）：`packages/mpd-mcp-shared/log-sink.test.ts`
  断言继承的 stderr 落在**最小**空闲描述符上，而本沙箱给出 `rebind=not-lowest`（fd / 启动环境条件）；
  `packages/mpd-roles-plugin/test/team-plane.test.ts` 读仓库**真实**的 `.mpd/boulder.json`，而该文件从未被跟踪
  （`git log -- .mpd/boulder.json` 为空；`.gitignore:21`），任何新克隆都会 ENOENT。后者作为独立清理项记录，未被悄悄跳过。
- **第 8 条修好的闸门有盲区，已声明而非隐藏：** `verify-manual-paths` 的规则无法区分“被 gitignore 的运行态文件”与
  “随仓库交付的资产”，因此未来任何以根相对写法出现的运行态路径都会以同样方式变红。
