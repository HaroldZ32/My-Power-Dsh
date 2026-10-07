# TUI 界面一致性台账 —— Web 版与 DSH-TUI 版逐项对照
[English](./tui-parity.md) | **中文**

> **状态已重新定位（de-vendor-and-verify-law，2026-10-07）。** oh-my-openagent 是一份**早期参考**，
> 而不是一致性目标。曾用它衡量本仓库的身份校验已被**删除**，没有任何关卡会去读取上游 checkout，也不
> 欠任何同步义务 —— 名册、十一个角色描述与模型链术语来自那个项目，其归属记录在
> [`LICENSE-NOTICES.md`](../LICENSE-NOTICES.md) 与根 README 中。因此下文全部内容都是对某项能力面的
> **历史测量**，保留下来是因为这份对照仍有信息量；请把 ✅ 读作“这曾经发布”，绝不读作“至今仍与上游
> 一致”，也不要把这里任何一句读成“逐版本跟随上游”的承诺。

> 波次：`tui-team-surface`。状态：**已集成 —— 下表的每一行都在冻结修订版上实测过；两项实测偏差与三项已知限制均以“未修复”状态如实保留（绝不被说成已修复），也没有为了表格好看而删掉任何一行。**
>
> 本页所对照的冻结接口是 `.mpd/plans/tui-team-surface.md`（界面契约，含 AMENDMENT A1）。本波次的 TUI 一侧是
> `packages/mpd-tui-plugin/src/{scenes.ts,team-state.ts,state.ts,sanitize.ts,commands.ts,command-trees.ts}`；
> Web 一侧是 `packages/mpd-agent-teams-plugin/lib/**`（采用的 MIT 插件，本波次只读）与
> `packages/mpd-bundle-plugin/src/**`（我们自己的 Web 页面）。

> **基线状态 —— 引用任何团队行之前请先读这段（0.1.7-rc.2）。** 本台账所对照的 Web 一侧是**内置的
> `agent-teams` 插件，它现已从组合中退役**：没有任何 loader 行挂载它，因此它的路由
> （`/plugins/dsh-agent-teams/**`）、它的 `.mpd/team` 记录与它的侧边栏面板都不存在于随包会话中。
> 下文每一行与每一节都是那一波对该基线的**实测** —— 是历史，而不是当前能力。
>
> 两个后果在此明说，而不是留给读者在引用某一行团队条目时自行推断：**整个计划批准族已不存在**
> （暂存计划、`approve <teamId>` + `Ctrl+X`、`Ctrl+D` 丢弃、计划成员/任务编辑器、`plan-continue`），
> 因为本 bundle 挂载的**官方** Agent Teams 插件**没有暂存计划、也没有批准步骤** —— Lead 用
> `spawn_teammate` 创建队友、用 `team_task_create` 开通道，共享任务板**就是**计划；而 TUI 场景所能
> 读取的团队状态是 Lead 的会话日志，不是 `.mpd/team/team.json`。当前团队能力请读
> `docs/user-guide.zh-CN.md` §6、`docs/tui.zh-CN.md` §3.2 与 `docs/plan-0.1.7-adaptation.md`。

这是一份长期维护且面向人的台账，回答一个问题：**本 bundle 的 Web 版提供的每一个界面，DSH-TUI 版对应提供什么；如果答案是“什么都没有”，为什么这是可接受的？** 这里的“一致”从不意味着布局、样式、动画、拖拽、缩放、面板几何或本地化相同，而是指同样的**事实**与同样的**操作**可以到达。该边界冻结在契约的 NOT-CLAIMED #1 中，并在下文 §5 重申。

## 1. 如何阅读本台账

### 1.1 三种状态

| `tui_status` | 它断言什么 | 它绝不声称什么 |
|---|---|---|
| `present` | 存在一个 TUI 界面能到达同样的事实（或同样的操作），证据层级见 §1.2 | 它长得像 Web 界面，或由同一个手势驱动 |
| `absent` | 没有任何 TUI 界面能到达它，且原因记录在本页 | Web 能力被移除了——它仍在 Web 版中 |
| `not-applicable` | 该 Web 界面在终端里没有意义（浮动几何、HTTP 状态码、图片资源、浏览器侧本地化） | 有什么坏了；根本没有可移植的东西 |

一行 `absent` 是一个**结论**，而不是本页的遗漏：删掉它才是缺陷。§3 为每一行单独给出说明。

### 1.2 证据层级

每个 `tui_evidence` 单元格都给出 `evidence/tui/` 下的一个路径；下表说明这些运行各自能证明与不能证明什么：

| 标签 | 路径 | 它能证明什么 |
|---|---|---|
| **E1** | `evidence/tui/team-surface-verify/2026-09-16T14-19-18.574Z/` | t3 的受认可判定运行。Arm 1 从 `dist/` 取出插件**真实的** `apply()`，用宿主替身渲染已注册场景；Arm 2 在沙箱中通过真实 tmux 按键驱动**真实的** `dsh` TUI，并由真实采用的运行时**真正提交**了一次批准。其负向对照以三种方式绕过确认，且每次都**必须**失败。 |
| **E2** | `evidence/tui/team-surface/20260916T140135Z/` | t6 的修复测试套件及其第二轮负向对照：对真实源码施加九处变异，每处都让一组具名测试变红，所有文件按 sha256 逐字节还原，最终套件全绿。这是行级断言的**可证伪性**见证。 |
| **E3** | `evidence/tui/live/20260915T063140Z/result.json` | 本版本的真机实况通道（t8）：在评审者自己新建的干净根目录上渲染了七个 TUI 接缝中的六个——状态行、命令、树、场景、设置区块、对话框。 |
| **E4** | `evidence/tui/plugin/20260915T060934Z/mount/` | 真实 TUI 的面板截图：`02-mpd-status`、`04-board-scene`、`11-board-by-command`、`14-workmate-dialog`、`15-settings`、`16-command-completion`。 |
| **E5** | `evidence/tui/team-surface-integrate/2026-09-16T14-17-24.000Z/` | **本页自身**在冻结修订版上重跑的门禁扫描：`bun test packages`、typecheck、`test:qa`、`verify-vendor`、`verify:docs`、`delta --check`、各 TUI 通道，以及语料库指纹。 |

这里如实说明该证据的三项局限：**E1 的 Arm 1** 通过录制替身作答，因此它证明的是确认**门禁**、适配器对 `exec.agent` 的透传，以及场景对工具自身结构化结果的渲染——绝不证明 Arm 1 批准了某个团队；真正的批准是 Arm 2 的主张。**团队场景的行渲染**是在套件层级（E2）与场景注册（E1 A1）上证实的，并没有团队场景本身的活动面板截图——本版本自身的 NOT-CLAIMED #5 已记录：自动扫描不驱动它的真实按键。另外 **`alt+t`** 按契约（§5.3）只是尽力而为，任何地方都未实际演练。

## 2. 台账

只有一张表，每个 Web 界面一行，顺序即冻结契约 §8 的顺序（第 1–20 行是契约的强制枚举；第 21–25 行是本波次任务书额外点名的 Web 界面，每一行都锚定到一个实测的 Web 产物）。`—` 表示没有可指名的 TUI 界面。

| `web_surface` | `web_evidence` | `tui_status` | `tui_surface` | `tui_evidence` | `reason` |
|---|---|---|---|---|---|
| `activity-panel/team-header`（id/名称/阶段） | `packages/mpd-agent-teams-plugin/lib/snapshot.ts:87-91`；面板渲染门 `lib/client.js:2437` | present | `mpd-tui-team`：`/mpd team`，或在 `mpd-tui-board` 上按 `a` | E1（A1 注册该场景）、E2 | §3.1 第 1 项 |
| `activity-panel/plan-review-state` | `lib/snapshot.ts:92-93` | present | `mpd-tui-team`（同组行） | E2 | §3.1 第 1 项 |
| `activity-panel/roster`（状态/模型/进度/当前任务/未读） | `lib/snapshot.ts:56-82` | present | `mpd-tui-team` | E2 | §3.1 第 3 项 |
| `activity-panel/task-dag`（id/kind/状态/负责人/尝试/轮次/判定/依赖/深度） | `lib/snapshot.ts:95-118` | present | `mpd-tui-team` | E2（变异 R2 让 6 个测试变红） | §3.1 第 4 项 |
| `activity-panel/failed-dependency marking` | `lib/snapshot.ts:95-118`（`failedDependencies`） | present | `mpd-tui-team`（`failed-dep=`） | E2 | §3.1 第 4 项 |
| `activity-panel/message-count + captain inbox tail` | `lib/snapshot.ts:119-125` | present | `mpd-tui-team`（邮箱尾部） | E2 | §3.1 第 6 项 |
| `activity-panel/halted flag` | `lib/snapshot.ts:94` | absent | — | — | 实测：TUI 改为报告看门狗 **HOLD** —— `packages/mpd-tui-plugin/src/watchdog.ts:24-30,64-83`（见第 22 行）；`halted` 与 hold 是不同的事实（§3.1 第 2 项） |
| `activity-panel/plan-approval`（批准） | `lib/index.ts:325,371-381`；`lib/client.js:1501-1516,1695-1696` | present | `mpd-tui-plan`：`/mpd plan` 或在 `mpd-tui-team` 中按 `a`；逐字输入 `approve <teamId>` 后按 `Ctrl+X` | E1（Arm 1 的 A4–A8；Arm 2 的 H1–H6） | §4.2；真实提交后的判定行自 t8 修复起已渲染（§4，D1） |
| `activity-panel/plan-discard`（两步） | `lib/client.js:1540-1556,1680-1687,1717` | present（语义缩减） | `mpd-tui-plan`：在 10 秒布置窗口内按两次 `Ctrl+D` | E1（A2 注册该场景） | §4.3；TUI 不再写任何其他东西——Web 的 `lib/tools.ts:577` 中「captain 注入 + 取消」那一半在 TUI 没有对应物 |
| `activity-panel/plan-continue`（请求修改） | `lib/client.js:1518-1538,1705`；`lib/index.ts:391` | absent | — | — | NOT-CLAIMED #3 / §4.4 —— `continue` 没有工具界面，因此 TUI 不自行发明一个 |
| `plan-member-editor`（批准前改 provider/model） | `lib/index.ts:407`（`update_member`）；成员选择器 `lib/client.js:2583` | absent | — | — | NOT-CLAIMED #2 —— TUI 界面是只读的 |
| `plan-task-editor`（主题/负责人/依赖） | `lib/index.ts:426`（`update_task`） | absent | — | — | NOT-CLAIMED #2 |
| `plan-add-task` | `lib/index.ts:443`（`add_task`） | absent | — | — | NOT-CLAIMED #2 |
| `plan-remove-task` | `lib/index.ts:458`（`remove_task`） | absent | — | — | NOT-CLAIMED #2 |
| `plan-pre-approval editing / merge` | `lib/index.ts:405-475`（编辑器动作块）；`lib/tools.ts:759`（该插件的 edit-plan 工具） | absent | — | — | NOT-CLAIMED #2；契约中该行标签 `merge-autonomous-plan` 在采用的客户端字节里找不到可定位锚点——见偏差 D2。（整个计划批准族已退役 —— 见顶部横幅。） |
| `activity-panel/archived-teams view (?archived=1)` | `lib/index.ts:255-272`；`lib/client.js:360-367` | absent | — | — | 实测：TUI 只读活动状态根目录，并只选取一条最新记录（`packages/mpd-tui-plugin/src/state.ts:107-109`）；归档团队不被投影 |
| `activity-panel/panel-geometry + drag/resize` | `lib/client/panel-geometry.ts:121` | not-applicable | — | — | 终端场景没有浮动几何（§7.1） |
| `activity-panel/localization (t())` | `lib/client/locales.ts` | not-applicable | 注入的 `tuiCommandTrees` 携带 `descriptions.zh`（`src/command-trees.ts:18-25`）；场景文案保持英文 | E4（`16-command-completion.pane.txt`） | §5.1 与 §7.1 —— 不声称任何场景文案本地化 |
| `activity-panel/member-artwork (assets route)` | `lib/index.ts:492`（`/plugins/dsh-agent-teams/assets`） | not-applicable | — | — | 终端场景渲染文本 |
| `plan-route HTTP semantics (405/409/404, no-store)` | `lib/index.ts:325-332,364-370` | not-applicable | — | — | TUI 不走 HTTP；等价的拒绝是场景内错误行（§4.5）与「captain 未接入」拒绝（§6.2） |
| `activity-panel/stop-team`（halt） | `lib/index.ts:276`（halt 路由）；`lib/client.js:292,2360` | absent | — | — | 实测：任何 TUI 场景都不存在停止控件；TUI 的变更集冻结为批准/丢弃（§3.2、§4），且 §7.2 禁止写入 |
| `team-watchdog/banner`（hold、未读事件、确认） | `packages/mpd-bundle-plugin/src/watchdog-web.ts:26-27`；`src/team-page.ts:558-584` | present（hold 行 + 重放对话框） | `mpd-tui-board`：`team-hold held (…)` 行（`src/state.ts:306`）以及重放事件时的确认对话框（`src/watchdog.ts:24-30,93`） | E3、E4（`02-mpd-status.pane.txt`） | 实测：当 `mpdWatchdog` 缺席时该行被省略——绝不渲染成「未 hold」（§7.8） |
| `workmate-library/tab`（列表） | `packages/mpd-bundle-plugin/src/web-client.ts`（workmate Tab factory） | present（缩减为只列清单） | `/mpd workmates`（`src/commands.ts` 中的 `/mpd` 命令处理） | E4（`14-workmate-dialog.pane.txt`） | 实测：TUI 的全部界面就是这份清单（`state.workmates.count/names`） |
| `workmate-library/mutations`（初始化/改名/删除/归档） | `src/web-client.ts`（同一个 factory） | absent | — | — | 实测：TUI 不暴露任何写入库的路径，而该库位于用户 HOME（`~/.mpd/workmate`，AGENTS.md §6 State 例外）；Web 标签页是唯一的变更入口 |
| `settings-section`（设置 → MPD，25 个旋钮） | `packages/mpd-bundle-plugin/src/settings-card.ts`（`FIELDS` / `readCatalog` / `optionsFor` / `optionElements`） | present | `/settings` —— 通过 `tuiSettingsSections` 接缝渲染的 mpd 区块（`src/settings.ts`） | E3、E4（`15-settings.pane.txt`） | 实测：该区块在界面内披露了到 `<workspace>/.mpd/mpd.jsonc` 的桥接与重启注意事项（docs/tui.md §6.2）；十二个 `teamModels` 叶子是由目录驱动的选择项，回退到声明列表 |

## 3. 为什么每一行 `absent` 或 `not-applicable` 都保留

**`halted` 是有意缺席的（第 7 行）。** Web 快照携带 `team.json.halted`；TUI 改为报告团队看门狗的 HOLD。二者是归属不同的事实：hold 由看门狗边车文件写入，它暂停**派发**而不取消任何东西；而 `halted` 是团队记录里的一个字段。把其中一个当成另一个来报告就是虚假的一致性声明，因此 TUI 展示它真正能读到的 hold，而这一行保持 `absent`。

**`plan-continue`（第 10 行）、四个计划编辑器（第 11–14 行）与批准前编辑（第 15 行）。** 这六行是同一个决定：除批准与丢弃外，TUI 的计划界面是只读的。想在 TUI 里改掉一处主题笔误的用户必须去问 captain——这一后果写在契约的 NOT-CLAIMED #2 里而不是被藏起来；而 `continue` 还额外没有可采用的工具界面（NOT-CLAIMED #3），所以即使 TUI 想接也无处可接。

**归档团队（第 16 行）。** TUI 每个工作区只解析一条最新的活动记录（`state.ts:107-109`，即面板自身的规则），这样面板与团队场景永远不会对「哪一个是当前团队」产生分歧。归档团队是 Web 侧的浏览便利；TUI 没有第二个状态根可读。

**面板几何（第 17 行）、本地化（第 18 行）、成员插图（第 19 行）。** 不移植，因为目标媒介没有等价物：终端场景没有可拖拽的浮动窗口、没有图片资源，而它的场景文案与所有其他 TUI 界面一样只有英文——mpd TUI 中真正本地化的是命令树的 `descriptions.zh`，那是另一种机制，而不是这些面板的翻译。

**HTTP 语义（第 20 行）。** Web 的 405/409/404 拒绝与 `cache-control: no-store` 在一个从不说 HTTP 的界面里没有对应物；相应的拒绝以场景内错误行渲染，其中包括当记录里指名的 captain 会话在本进程未接入时的**响亮**拒绝（预检实测：`the captain session <id> is not attached in this process`，记录未被触碰——`evidence/tui/team-surface-verify/preboot-probe/`）。

**停止团队 / halt（第 21 行）。** 该控件存在于 Web 面板与采用的 halt 路由中；TUI 有意不携带它。它的变更集是冻结的批准/丢弃这一对，而 NOT-CLAIMED #7（「永不写入团队状态」）正是让这些只读界面值得信赖的不变量。加一个停止控件等于新增一条写入接缝，而不是修复一致性。

**workmate 变更（第 24 行）。** 该库位于用户 HOME 之下、跨项目，其变更操作（初始化、改名、删除/归档）是有后果的用户数据操作，并带有各自的拒绝规则（使用中检查、先归档）。TUI 只提供只读清单；Web 标签页是变更入口。把这一行拆成两行是刻意的——它区分了「事实可见」与「操作可用」，合并会夸大一致性。

## 4. 记录在案的、未修复的实测偏差

**D1 —— 真实提交后批准判定行曾不可见（严重度 medium；先实测为未修复，后由 t8 关闭——这里把**两种状态**都记录下来，因为第一种状态正是本波次发现的东西）。** 契约 §4.5 把成功渲染钉为 `approved: <teamId> running · members <n> · tasks <n>`。在真实宿主上实测（E1 Arm 2 的首次运行）：批准**确实提交**——记录从 `phase: staged → running`、`approvedAt` 被写入、`planReviewState` 被删除，这是只有采用的 `approveStagedTeam` 才会留下的签名——而面板显示的是提交后的空状态，因为调用后的重新读取已看不到 staged 记录。Arm 1（录制替身）**确实**渲染了工具的结构化结果，这正是为什么它是真实宿主的偏差、而不是场景的渲染缺陷。**修复（t8，`repair`，Senior Engineer）：** 已结束但不再可用的记录现在会把运行时产出的消息渲染为第一行正文（`packages/mpd-tui-plugin/src/scenes.ts:731-750`），并重建了该包的 dist。**修复后重新实测：** 本波次自己的通道重跑报告 `arm2.outcome = approved-by-the-adopted-runtime/verdict-visible`、`outcomeLines.approved = "approved: mpd-fixture-1 running · members 2 · tasks 2"`、`findings: []`（`evidence/tui/team-surface-verify/2026-09-16T14-24-22.312Z/result.json`）。首次读数作为这次测量的历史保留在本台账中，而不作为当前状态。

**D2 —— 一个冻结行标签在 Web 侧找不到可定位锚点（严重度 low；责任方：冻结契约；仍未修复）。** 强制行 `activity-panel/merge-autonomous-plan` 被保留（漏掉一行就是缺陷），但该标签本身在采用的客户端字节里无法定位：对 `packages/mpd-agent-teams-plugin/lib/client.js` 与 `lib/client/**` 做 `autonomous|merge` 的大小写不敏感搜索，命中数为零。因此该行锚定到最近的**实测** Web 界面——批准前的计划编辑器动作块（`lib/index.ts:405-475`）与该插件的 edit-plan 工具（`lib/tools.ts:759`）。这里选择记录而不是悄悄改名：把本页与契约对照的读者能够看到这处不一致及其原因。

**D3 —— 该通道的受认可判定运行描述的是过期的通道字节（严重度 medium；实测后在同一波次内解决）。** t3 第一次尝试的判定运行记录了测量它的通道摘要 `skills/dsh-qa/scripts/tui-team-surface.ts` → `21a9eb5c14a30410…`，而磁盘上的文件摘要是 `91a05314c38f263cc8c481174dfa3debd6b7e6914512dc94857c1064f792cf2f`，其修改时间（UTC 14:16:22）**晚于** t3 自身的最后更新（UTC 14:14:56）。因此在活动树上重新计算的语料库指纹是 `303e1631…`，而**不是** t3 报告要求 captain 固定的 `303e163148af…`。当时记录了两项后果：固定 `303e163148af…` 会让 `verify-vendor` 继续为红；该判定运行已不再描述磁盘上的通道字节。**解决（实测而非假定）：** 采用了本页的独立重算值——captain 把 `VENDOR_LOCK.json` 的 `assets.skills` 重新固定为 `fileCount 319 / treeSha 303e1631…`，与 `skills/**` 变更同处一次提交；`verify-vendor` 现于冻结树上报告 PASS；t3 也按当前通道字节**重试**（第二次尝试）并转绿。留下来的是一条规则而不是缺陷：判定运行中的通道摘要把该判定绑定到测量它的那些字节上，之后的任何改动都会让这个绑定失效。证据：`evidence/tui/team-surface-integrate/2026-09-16T14-17-24.000Z/raw/fingerprint.log`、`REVISION.json`，以及同目录的 `gates.result.json`（`verifyVendor.exitCode = 0`）。

## 5. 明确不声明（NOT-CLAIMED）

**继承自冻结契约 §7（九条全部仍然有效）：**

1. **仅功能一致** —— 只求事实相同，绝不声称布局、样式、动画、拖拽、缩放、面板几何或本地化相同。
2. **TUI 内不做行内计划编辑** —— TUI 不能编辑成员的 provider/model，也不能编辑任务的主题/负责人/依赖；所列举的后果（去问 captain）本身就是声明的一部分。
3. **没有「带原因继续」** —— Web 的 `continue` 没有对应的工具界面。
4. **不声明 captain 模型对 TUI 批准的反应**（契约 §6.3）。
5. **自动扫描不驱动真实按键** —— TUI 只在真实 TTY 上启动，因此 tmux 通道被排除在 `bun run test:qa` 之外；面板文本证明渲染，记录翻转证明动作。（E1 为本波次界面自建了 tmux 臂，比本版本原有通道更强，但仍不属于 `test:qa`。）
6. **不发明新的宿主接缝** —— 当 `tuiScenes`/`tuiDialogs` 缺席时，`/mpd team` 与 `/mpd plan` 返回既有的命令错误。
7. **永不写入团队状态** —— TUI 包内不含任何写原语。
8. **`mpdWatchdog` 缺席** → hold 行被省略，绝不渲染成「未 hold」。
9. **`alt+t`** 只是尽力而为且可能被拒绝；`/mpd team` 才是保底入口。

**从 t4 独立评审与 captain 裁定（风险类别 (c)）带过来的具名限制 —— 已被**控制**、**未修复**、且刻意不属于本波次：** 一个**无界的 `dependencies` 数组**仍可能让投影在深度遍历深处抛错（`Math.max(...)` 展开），从而退化为受控的读取失败行，而不是它本应渲染的 §5.5 注释。它不会让 TUI 循环崩溃——读取路径会捕获它并渲染失败行——这正是它属于「已控制」而非阻塞的原因。它**不**属于本波次，本页任何地方都**没有**把它描述为已修复。它超出范围的原因：加依赖上限必须改动冻结的 §5.5 上限清单（`MAX_TASKS`、`MAX_TEAMS`、`MAX_PROBLEMS`），那是接口而非实现。把它记录在此，就是本波次唯一可用的补救。

**本波次自身新增：** 团队场景的各行是在套件层级（E2）与场景注册（E1 A1）上证实的，而非团队场景的活动面板截图；`alt+t` 仍未被演练；此外本页不声称任何 Web 浏览器渲染（本环境没有浏览器二进制——Web 一列与契约 §2 一样只引用源码）。

## 6. 如何打开每一个 TUI 界面

**下表中的团队行描述的是已退役的基线（见顶部横幅）：暂存计划、`approve <teamId>` + `Ctrl+X` 与
`team-plan …` 面板行在随包会话中都已不存在。** 当前会话能打开的是 `/mpd team`、`/mpd board`、
`/mpd status`、`/mpd workmates`、`/settings` 与 `/mpd` 语法 —— TUI 动作清单就是
`packages/mpd-tui-plugin/src/command-trees.ts`。

| 界面 | 如何打开 | 接下来 |
|---|---|---|
| 团队工作流 | `/mpd team`（或 `/mpd` → 选择器，或在 `mpd-tui-board` 中按 `a`） | `p` 跳到面板；`r` 重新读取 |
| ~~计划批准~~（已退役 —— 不存在暂存计划；请用官方 `team_task_*` 工具） | — | — |
| 面板 | `/mpd board`、配置的快捷键，或从选择器进入面板 | `team-hold held (…)` 行（仅当看门狗 hold 持续期间） |
| workmate 库（清单） | `/mpd workmates` | 打印数量与名称；变更只在 Web 侧（第 24 行） |
| 状态行 | `/mpd status`（或配置的状态接缝） | 一行团队摘要，hold 持续期间也包含它 |
| 设置区块 | `/settings`，然后进入 `mpd` 区块 | 修改一个旋钮；该区块会说明桥接与重启注意事项 |
| 完整语法 | `/mpd` | 宿主自己的选择器对话框会列出条目及其中文描述 |

## 7. 本页的验证状态

- **门禁扫描**（原始日志、逐门禁退出码与按摘要钉定的修订版）：`evidence/tui/team-surface-integrate/2026-09-16T14-17-24.000Z/`。**记录了两趟，而第一趟撞上了一次修复**：t8 的判定行修复在 14:22:21 重建了 `packages/mpd-tui-plugin/dist/index.js`，而第一趟正在运行，因此第一趟的早期门禁测的是一个修订版、其通道测的是另一个。第二趟（同目录下的 `second-pass/`）在**已稳定**的修订版上重跑了整套，并做了起始/结束摘要校验，本页的主张以那一趟为准。那里的读数：`typecheck` PASS、`bun run verify:docs` PASS（37 对）、`bun run test:qa` PASS、`node scripts/patch-agent-teams-fixes.ts --check` PASS、`verify-vendor` 在 captain 重新固定后 PASS、`bun test packages` 两个读数（见下），以及各通道：`tui-mount`/`tui-panels` 退出 0（前置条件缺失而跳过，通道自身的约定）、`tui-admission`、`tui-spec-conformance`、`tui-settings-bridge`、`tui-distribution` 与 `tui-team-surface` 全部 PASS。**有一条通道是红的，而且不是本波次造成的**：`web-settings-bridge` 报告 `[card] W2a=FAIL W2b=FAIL`，因为它的断言仍在期待卡片移动**之前**的注册形态（`settings.plugin.item`），而构建产物中的客户端注册的是 `settings.section`——这是 2026-09-16 早些时候设置区块迁移引入的过期通道缺陷，由该通道**自己的**历史运行证明其先于本波次存在（当日 08:03:20 与 07:57:19 两次运行中 W2a/W2b 已是 `false`，最后一次全绿是 2026-09-15T095438Z），且本波次未改动任何 `packages/mpd-bundle-plugin/**` 文件。
- **双语文档配对** —— 本文件与 `docs/tui-parity.md` 由紧贴标题下方的切换链接互相指向，且标题树一致，由 `bun run verify:docs` 强制：**PASS**（37 对，0 失败）。
- **供 captain 重新固定的语料库指纹** —— `skills/**` 用 `verify-vendor` 自身的算法**重新计算**（绝不引用他人文字），结果为 **319 个文件 / `303e163148afc07e7dad10775d3de7e96b4caa1cfae9c1a91575ae906d8cc27d`**，由 `evidence/tui/team-surface-integrate/2026-09-16T14-17-24.000Z/fingerprint.ts` 断言。**这不是 t3 第一次尝试的报告所要求的值**（`319 / 303e163148af…`）——见偏差 D3，它记录了原因与解决方式：captain 就在与 `skills/**` 变更同一次提交中用**本值**重新固定了 `VENDOR_LOCK.json`，`verify-vendor` 随后报告 PASS，t3 也按当前通道字节重试转绿。该读数仅当 captain 提交前不再有 `skills/**` 改动时有效；之后若有改动即被取代，且 captain 在提交时无论如何都会重新测量。
- **两次仓内测试读数**一并记录，绝不只记其一。在已稳定的修订版上（t8 修复加入用例后共 801 个测试），仓库工作目录下为 **799 通过 / 2 失败**，干净工作目录下为 **801 通过 / 0 失败**；这 2 个失败都在 `packages/mpd-config-plugin/test/settings-wiring.test.ts`（第 352 与 419 行）——正是豁免所指的环境条件性一对，且该包不在本波次触及范围内。再往前一个修订版（797 个测试）上同一对读数为 795/2 与 797/0，也就是 captain 指引中引用的那一对。依据：记录在案的豁免 `evidence/extensions/integration-ledger/20260916T071414Z/delivery-ledger.md` §10（以干净工作目录调用作为替代）。
