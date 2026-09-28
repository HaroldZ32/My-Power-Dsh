# 外部插件适配 —— 现状报告

**中文** | [English](./extension-adaptation-report.md)

本报告是对 `@mpd-dsh/mpd` 发行包在 HEAD `8777e43` 上的现状审计，材料来自本波的四份清点（t2–t5）、架构评估（t6）与真实端到端验证（t7）。每节与每条断言都标注依据：**code-read**（读过某个 `path:line`）、**evidence-on-disk**（`evidence/` 下的产物）、**live-verified**（真实挂载的 `dsh` 启动，其工具调用取自 harness 会话日志，而非模型自述）。

## 1. 执行摘要与结论

**结论：可以——第三方今天就能加入本部署，而且有两条受认可路径；其中较新的一条（扩展接口）已在本棵代码树上通过真实端到端验证。** 剩下的缺口不是能力缺失，而是：(a) 一处可能让接口“静默降级”的潜在缺陷；(b) 缺少一条面向作者的“该用哪条路径”的唯一判据；(c) 代码里已经实现得不错的隔离姿态尚未写进文档。

今天一位决策者可以依赖的事实（扩展接口的两条为 live-verified，见 §5；安装面一条为 code-read，见 §2）：

- 自带 `dsh.bundle.patch` 的包会作为又一层 bundle 加入加载器（`dsh plugin --profile <p> add <pkg>`）——安装面（**code-read**，本波的真实验证未覆盖该路径）；
- 一个只含 `mpd-ext.json`（及其资源）的普通目录会从三个根目录被发现，无需打包、无需重装——扩展接口；
- 在真实挂载启动中，外部提供的扩展会被列出、其 flow 可被提供、其 skill 经技能目录加载、其 role **按调用**解析并真实 spawn，且声明的 stdio MCP 服务器发布的工具被成功调用（调用与非错误结果均取自 harness 会话日志）。

缺失或脆弱的点：adapter 身份回退分支没有埋点（P0，§7）；没有一页纸的选面判据（P1）；子进程环境白名单与隔离姿态的残留风险未写入文档（P2）；审计还发现了一批文档漂移——全部已在本波修正或修复（§8）。

依据：code-read + evidence-on-disk + live-verified（t7）。

**关于证据强度的诚实说明。** 所有 live 断言都完全依赖验证任务的产物（`evidence/extensions/t7-verify/20260916T045829Z/` 及其点名的两个 lane 目录）；该任务的锚点是 HEAD `8777e43` **加上** lane 对象的 sha256，因为让最后两条红色分支转绿的修复仍停留在未提交的工作树里。本波任何地方都没有把 `--dump-config` 当作加载证据（AGENTS.md §4）。

## 2. 两条路径，以及各自适合谁

| | 安装面 | 扩展接口 |
|---|---|---|
| 单元 | 自带 `dsh.bundle.patch` 的 npm 包 | 含 `mpd-ext.json` 的目录 |
| 接入方式 | `dsh plugin --profile <p> add <pkg>`（第二层 bundle） | 文件系统发现——没有安装步骤 |
| 可贡献 | 新的 profile 行（包括 `dsh-mcp-client` 的 MCP 行）；依赖锁定；安装期代码 | skills、flows、mcp（stdio）、roles——纯数据 |
| 生命周期 | 重装 + 重启 | 项目面**按调用**；user/bundle 面在 **apply** 时 |
| 会话作用域 | 完整（它拥有行） | 工具/角色没有（注册是进程级的） |
| 每项保证 | 行存在、重连、分页、schema 回滚、释放 | 逐项校验并逐项拒绝；坏条目不会拖垮其余部分 |

依据：code-read。路径 1 被文档明确写成一等公民且不被取代（`docs/extensions.md:24`）；路径 2 是内建行 `mpd-ext`（`packages/mpd-bundle/cordis.patch.yml:262-263`），提供 `mpdExtensions` 服务（`packages/mpd-ext-plugin/src/index.ts:457`）。

**选安装面**：贡献必须新增 profile 行、需要安装期或依赖工作、或以版本化包形式分发给许多用户时。**选扩展接口**：一组声明目录就够用时——某个项目的 skill/flow 集合，或在不动发行包的前提下提供宿主级的 skills、flows、MCP 服务器与 roles。

关键的不对称在于：*同一份* `mpd-ext.json` 落在不同面时，允许的贡献种类不同——项目面**只能贡献 skills + flows**，而 user 与 bundle 面可以贡献全部四种。该限制是刻意的，理由也真实（`packages/mpd-ext-plugin/src/sdk.ts:144-145`，逐项拒绝实现在 `packages/mpd-ext-plugin/src/registry.ts:673-680`）：本 harness 的工具与 provider 注册是进程级的，因此“仅本会话”的 MCP 服务器或名册角色无法被诚实表达。

## 3. 扩展接口能力清单

依据：code-read（t2、t4，以及本报告自己的复核阅读）。

- **冻结契约 v1**（`packages/mpd-ext-plugin/src/sdk.ts:113-146`）：`apiVersion` 必须等于 `1`，否则整份描述符被拒；存在两套 id 语法——描述符 id（`sdk.ts:29`）与更严格的技能名语法，**flow id** 也必须满足后者（`sdk.ts:36`）；未知键按条目被拒绝（`registry.ts:191-197`）。
- **四种贡献种类**，各自有校验与默认值：`skills`（相对根目录、有限 rank，默认 **300**）、`flows`（JSON 文档键；渲染成内存中的技能文档，因为 harness 没有 flow 接口）、`mcp`（仅 stdio，`args`/`env`/`cwd`/`toolCallTimeoutMs`/`connectTimeoutMs` 均有默认值）、`roles`（`description` 默认 `""`、`readonly` 默认 `false`，且 `provider`/`model` 必须成对提供）。
- **三个根目录、两种生命周期**（`docs/extensions.md:208-212`）：`<会话工作区>/.mpd/extensions` **按调用**读取，只贡献 skills + flows；`~/.mpd/extensions` 与 `<bundle>/extensions` 在 **apply** 时读取，可贡献全部四种。同 id 优先级为 project → user → bundle（先到者胜），被遮蔽的条目会被报告，绝不静默丢弃。
- **四个只读检查工具**：`mpd_ext_list`、`mpd_ext_show`、`mpd_flow_list`、`mpd_flow_show`。`mpd_ext_show` 会对 `env` 值脱敏；两个 list 工具都会拿每个声明的技能名去比对 harness 自身的目录，报成 `served` / `notServed`（或给出 `checked: false` 与原因），而不是直接断言。
- **开发者 CLI**（`scripts/mpd-ext.ts`）：`validate`、`scaffold`、`list` 以及离线 `--self-test`——对同一批目录的独立 oracle。
- **随包参考扩展**（`extensions/mpd-ext-example/`，默认禁用）：四种种类齐备，含一台零依赖 stdio MCP 服务器，其唯一原始工具变成 `mcp__lint-mcp__describe_extension`。
- **已声明的 v1 限制**：没有 reload（重启就是 reload，`docs/extensions.md`）；仅 stdio MCP；仅 JSON flow；无 MCP resources/prompts；无 GUI 面板、市场、远程下载或版本求解；扩展不能贡献 agent preset，扩展 role 也不会自己成为队友（见 `docs/extensions.md`）。

## 4. 运行时行为与隔离姿态

依据：code-read。

**关键运行时行为。**

- MCP 桥在 **apply 时**连接：并行、按超时限制，绝不惰性（`packages/mpd-ext-plugin/src/index.ts:983-1001`；`:983` 的注释写明了该契约）。因此第一代工具在 `apply` 返回前就已发布，且激活本身永不 reject。
- 每台服务器都有真实状态机：`connecting` / `connected` / `unavailable` / `failed` / `disabled`（`packages/mpd-ext-plugin/src/mcp.ts:34`）。只有服务器不是 `connected` 时才保留一条 `pending`（`mcp.ts:188-213`）；失败时会记录截断后的子进程 stderr 片段（`mcp.ts:216-226`）。
- 工具注册是**两阶段**的：先构建完整的下一代，再整体换入；中途冲突会把这一代完整回滚（`mcp.ts:266-305`）。外来的 `outputSchema` 只让工具失去 **schema**，绝不失去工具本身（`mcp.ts:354-375`，由 `packages/mpd-ext-plugin/test/mcp.test.ts:642` 钉住）。
- 扩展 **role 由 `mpd-roles-plugin` 按调用解析**（`packages/mpd-roles-plugin/src/index.ts:336`，经 `:225` 的 `extensionRoles`），获得命名空间 id `ext-<extension-id>-<slug>`（`:194`），重名时基础名册优先。两侧视图一致：`mpd_ext_list` 会重新推导出相同的拒绝原因并写入该扩展的 `errors`，且只列出可用的名字（`packages/mpd-ext-plugin/src/registry.ts:285-326`），由双面一致性测试钉住（`packages/mpd-ext-plugin/test/core.test.ts:1085-1090`）。

**隔离姿态。**

- 子进程环境是**白名单，不是继承**：unix 上六个名字（`HOME`、`LOGNAME`、`PATH`、`SHELL`、`TERM`、`USER`；win32 上十二个），加上扩展自己声明的值；任何“形似凭据”的名字都会被额外剔除（`packages/mpd-ext-plugin/src/mcp-client.ts:69-116`）。这一实现质量很高，而在本波之前它**没有任何文档**（P2 建议）。
- 资源引用只能相对于扩展根目录；绝对路径与 `..` 越界按条目被拒绝（`docs/extensions.md:174`；拒绝阶梯在 `registry.ts` 中）。
- 注册是进程级的，这正是三根目录划分存在的原因，也是项目面逐项拒绝 `mcp`/`roles` 的原因。
- 诚实说明残留风险：被 spawn 的子进程与宿主同属一个 OS 用户、文件系统权限相同，且继承了 `HOME`，因此它可以从**磁盘**读取 `~/.dsh/.credentials.yaml`——白名单缩小了爆炸半径，但并未沙箱化进程；manifest 声明的 `env` 是作者可见的配置，因此扩展可以被刻意交付一个密钥；发现机制基于文件系统信任，没有签名或审查环节。

## 5. 本棵代码树上真实验证过的内容

依据：evidence-on-disk（t7 第 2 次尝试，判定 PASS；其修复经 t14 复核 PASS）。产物：`evidence/extensions/t7-verify/20260916T045829Z/`、`evidence/extensions/extension-lifecycle/2026-09-16T04-58-41.378Z/`、`evidence/extensions/extension-mcp-bridge/2026-09-16T04-59-18.173Z/`。

- **运行情况：全部 `--no-skip`，退出码 0**：`extension-lifecycle.ts`（install / main / failure / isolation / packed 五个分支）、`extension-mcp-bridge.ts`（install / live / dead / hang / schema / dup / containment 七个分支）、`extension-isolation.ts --self-test`。没有任何 `[mpd-qa] SKIP` 标记。
- **是挂载，不是组合**：启动日志打印
  `[mpd-ext] mpdExtensions provided (apiVersion 1) | tools: mpd_ext_list, mpd_ext_show, mpd_flow_list, mpd_flow_show | skill providers: …`
  （lifecycle 的 `output.log:40`、bridge 的 `output.log:38`）；harness 自己的 `request/header` 记录在 99 个工具中提供了这四个工具以及 `mpd_role_persona` / `mpd_role_spawn`（`raw/main.session.decoded.jsonl:13`）；两份日志中都没有任何 apply 崩溃特征串。
- **扩展端到端**（`raw/main.session.decoded.jsonl`，调用 → 结果）：`mpd_ext_list` 18→20 报告三个扩展（`qa-ext-proj` project、`qa-ext-user` user、`mpd-ext-example` bundle 且已禁用），并按条目拒绝项目面的 `roles`/`mcp` 且给出原因；`mpd_ext_show` 24→25；`mpd_flow_show` 34→35 返回 `QA-MARKER-FLOW-PROJ`；`skill` 工具 39→40 经技能目录返回 `QA-MARKER-SKILL-PROJ`；`mpd_role_persona` 44→45；`mpd_role_spawn` 49→51 启动了一个**真实**子进程，其回答是 `QA-CHILD-MARKER-ROLE-OK`。
- **那次真实 MCP 调用**：`raw/mcp.session.decoded.jsonl:39` 是对 `mcp__qa_mcp_live__status` 的 `tool/call`，`:40` 是其非错误 `tool/result`，内容来自仓库自带的 stdio 服务器；该工具在**两次**读取中都出现（stub 的请求数组与 harness 头部，109 个工具）。容器化失败分支：dead → 零工具且带 ENOENT 原因；hang → “initialize timed out after 1500ms”；重名 → 零工具；三者在 harness 头部也都不出现。
- **隔离是被断言的，不是默认的**：每次启动都使用沙箱 `DSH_HOME`、沙箱 `HOME` 与沙箱会话 cwd；`assertSessionsSandboxed` 返回 ok，只看到沙箱内的会话键（分别检查 4 / 1 / 1）；多会话诱饵对照非空转。
- **锚定**：HEAD `8777e43` 加上 lane 对象的 sha256，在运行前、运行后以及运行后 1 分 47 秒各钉一次；受跟踪文件清单前后一致，说明各 lane 只写了自己的证据目录。

修复前为红色的两条分支（打包器的闭包分支与桥 lane 的 schema 分支）在这里都是绿的；修复本身是本波唯一一次 skills 写入权变更、一行打包器改动，以及本波唯一一次 `VENDOR_LOCK.json` 重新钉版（`evidence/extensions/t13-repair/20260916T045324Z/`，`treeSha 9e643d07… → 7a48fdad…`），并由复审者独立重跑并判 PASS。

## 6. 风险与缺口

依据：code-read + evidence-on-disk。

- **F1（中）—— adapter 身份回退分支是静默的。** `mpd-ext` 与 `mpd-roles` 都以 `ctx.get("mpdDsh") ?? createDshAdapter(ctx)` 解析 adapter（`packages/mpd-ext-plugin/src/index.ts:207`、`packages/mpd-roles-plugin/src/index.ts:318`）。一旦挂载查找落空，该行就会在树里已挂载的 adapter 之外**再构造一个**，违反“单一接触面”规则（AGENTS.md §6），且没有任何告警。同一类被吞掉的错误曾在同一个文件里导致四个工具根本没注册（`src/index.ts:44-51`），这正是该行现在要统计注册结果的原因（`:462-475`）——回退分支是唯一仍未埋点的分支。
- **F2（中，文档）—— 没有唯一的选面判据。** 事实是齐的（`docs/extensions.md:24`、`:208-212`、`:216-223`），但没有任何一处回答“我这个贡献该放哪一面？”。代价是写错面的作者只能在发现阶段收到逐项拒绝。
- **F3（中）—— 隔离姿态及其残留风险没有文档。** 子进程环境白名单与凭据名剔除都很强，却完全没有描述；被接受的残留（同 OS 用户的磁盘访问、作者声明的 `env` 机密、文件系统信任）也都未写明。
- **F4（低）—— 重启不对称。** 项目面的 `skills`/`flows` 按调用重读，而 user/bundle 面的 `mcp`/`roles` 需要重启；两个事实都有文档，却从未并列出现过。
- **F5（低，观感）—— 同一风险、两半注释。** bundle 补丁警告了“第二个 adapter”风险（`packages/mpd-bundle/cordis.patch.yml:244-260`），而行自身的注释（`packages/mpd-ext-plugin/src/index.ts:44-54`）只写了惰性解析。
- **F6（中）—— 证据新鲜度。** 有八个证据目录早于当前扩展代码（`c239407`）：`mcp-bridge-framing`、`mcp-bridge-gates`、`registered-tool-schemas`、`sanitizer-crosscheck`、`roles-wiring`（×2）、`v0.9.1-defect-fixes`、`extensions-repair/t16-pins-and-plane-guard`、`mpd-ext-repair/roles-report`。在未重跑之前，它们都不能支撑现状断言。
- **F7（低）—— 一个证据检查器过度声称。** `evidence/mpd-ext-debranding/20260915T074904Z/verify-debranding.mjs:40-49` 打印“文档引用的片段与随包示例逐字一致”，却只探测了 skill 与 flow 字段，于是给它放行的字节里其实还带着 §5.3/§5.4 的漂移（即下文 D4/D5）。
- **F8（低，本波刻意豁免）—— lifecycle lane 仍叙述修复前的预期。** `skills/dsh-qa/scripts/extension-lifecycle.ts:35-42` 仍写着“This wave's expectation is a RED … THE FIX IS t11's”，其打包分支仍返回 `greenOwner: "t11"`（`:386`）。这是刻意豁免而非遗漏：技能语料库每波只有一个写入者，第二次改动 `skills/**` 会强制第二次 `VENDOR_LOCK.json` 重新钉版，而本波只保留一次（AGENTS.md §9/§11）——且这一次已经用在 mcp-bridge schema 分支的修正上（`evidence/extensions/t13-repair/20260916T045324Z/`）。此处记录，供下一波并入其唯一一次重新钉版。
- **F9（低，同属豁免家族）—— 某一行引用的并不是该分支的判据。** `skills/dsh-qa/SKILL.md:77` 引用 `extension-lifecycle.ts:385` 来支撑“the case exits 0”，但该分支的 `ok` 是 `packRun.status === 0 && hasRow && (hasPlugin && hasExtensions ? true : red)`（`extension-lifecycle.ts:377`），在 GREEN 与 RED 两种状态下都为 TRUE——因此退出码 0 并不由打包树是否为 GREEN 决定。属一次单文件跟修 + 本波唯一一次重新钉版。
- **F10（低）—— 子进程 stderr 片段这一条没有任何 lane 覆盖。** 没有 lane 断言桥的状态报告里的“截断后的子进程 stderr 片段”；两条 lane 里仅有的 `stderr` 引用是 fixture 自己的错误写出（`extension-mcp-bridge.ts:121`）与 CLI 探针的尾部（`extension-lifecycle.ts:135`、`:335`）。该条款目前只有代码与单元测试支撑。
- **F11（低）—— R11 这一类断言没有测试套件归宿。** R11（`PLUGIN_PKGS` 遗漏类检查）只作为一条记录在 `.mpd/plans/dsh-tui-edition.md:179-183` 的命令存在；每次打包真正运行的守卫是打包器自身的正向闭包检查（`scripts/pack-mpd.ts:260-269`，2026-09-17 重新定位）。见 §7 的 P2 建议。

## 7. 按优先级排序的建议

每条给出理由、工作量与它会触及的路径。本波不实现任何一条——本波只做审计与文档。

- **P0 —— 给 adapter 回退分支埋点**（走到空值分支时用解析到的 adapter 身份告警一次）。路径：`packages/mpd-ext-plugin/src/index.ts:207`、`packages/mpd-roles-plugin/src/index.ts:318`。理由：保护绑定性的“单一接触面”规则，把静默降级变成可见事件；静默丢能力的先例就在同一个文件里。工作量：小。
- **P1 —— 在指南里补一条选面判据**。路径：`docs/extensions.md` §4 与其 zh-CN 孪生文件。理由：这是贡献者最常犯的错误（F2）；材料都已存在，只差归到一处。工作量：小。
- **P1 —— 把子进程环境隔离姿态及其已接受的残留写进文档。** 路径：`docs/extensions.md` §5/§10 与 zh-CN 孪生文件。理由：一项已实现的长处目前不可见，而残留（子进程能从磁盘读 `~/.dsh`、作者声明的 `env` 机密、文件系统信任）需要一个明确的接受/拒绝决定。工作量：小到中。
- **P2 —— 用一句话把两种存活性并列。** 路径：`docs/extensions.md:525` 与 zh-CN 孪生文件。理由：消除 F4 带来的意外感。工作量：小。
- **P2 —— 让 adapter 挂载风险的两半注释互相引用。** 路径：`packages/mpd-bundle/cordis.patch.yml:244-260`、`packages/mpd-ext-plugin/src/index.ts:44-54`。理由：同一个事实目前被拆在两条注释里。工作量：极小（注释改动，因此属于代码任务）。
- **P2 —— 淘汰或重跑过期证据目录**（F6），使证据索引不再包含 `c239407` 之前的断言。路径：`evidence/extensions/**`。理由：读者无法分辨哪些是现状断言、哪些已被取代。工作量：中。
- **P2 —— 给 R11 一个测试套件归宿**（F11）。路径：`skills/dsh-qa/`（新增一个 case，或在既有 lane 中加一个分支）+ `.mpd/plans/dsh-tui-edition.md`（撤下那段命令式散文）。理由：只活在计划文档里的类级守卫离失传只差一次编辑，而该类已经复发四次（打包器的闭包检查会在每次打包时拦住“被挂载行”那一半，但没有任何 CI 在跑 `PLUGIN_PKGS` 相等性检查）。工作量：小——**但并非零成本：测试套件归宿意味着改动 `skills/dsh-qa/**`，因此必须在同一次改动中对 `VENDOR_LOCK.json` 重新钉版**（与 F8/F9 引用的是同一条“每波只钉一次”的纪律），所以它必须搭上某一波的唯一一次重新钉版。

## 8. 本次审计发现的文档漂移

依据：code-read + evidence-on-disk。每条都给出过时行、修正内容与承接它的任务。**结论：本次审计发现的每一条漂移都已在本波修正或修复，没有任何一条被推迟。** D1–D5 与角色拒绝条目由 t9 修正（t11 复核 PASS）；D6 由 t15 修正（t16 复核 PASS，措辞跟项由 t19 关闭）；角色拒绝条目自身的记录是 t17（t18 复核 PASS）；`skills/**` 两项由 t13 作为本波唯一 skills 写入者修复（t14 复核 PASS）。

- **本波已修正（t9，t11 复核 PASS）**——`packages/mpd-ext-plugin/README.md:26`、`:148-149`、`:168-170` 与 `README.zh-CN.md:16`、`:105`、`:112`：MCP 桥与角色解析曾被写成“后续任务”/“尚未连接”/“待角色表的每次调用解析函数落地”。它们现在都是实时的（§4、§5）。
- **本波已修正（t9）**——`docs/extensions.md:314`（`serverName` 由 `"example"` 改为 `"lint-mcp"`）与 `:344`、`:350`、`:353`（`Example Reviewer` / `example-reviewer.md` 改为 `Code Reviewer` / `personas/code-reviewer.md`），zh-CN 孪生文件对应为 `:267`、`:289`、`:295`、`:298`。随包的 `extensions/mpd-ext-example/mpd-ext.json` 是唯一事实来源；两段片段现在与它 JSON 等价。
- **本波已修复（t17，t18 复核 PASS）**——`docs/extensions.md:531-534` 与 `docs/extensions.zh-CN.md:423` 曾声称被拒的 role 只有名册侧报告，且“让两侧一致属于后续项”。该后续项已关闭：两侧都会报告（`registry.ts:285-326`、`test/core.test.ts:1085-1090`）。该条在修订版 sha256 `541b86fe…`（EN）/ `396eef30…`（zh-CN）时修正；随后 t17 把同一主题扩展到 §6 的拒绝表行（`docs/extensions.md:394`），t18 的 PASS 锚定在由此得到的修订版上（`f860593a…` / `be0a8814…`）。它不是开放项。
- **本波已修正（t15，t16 复核 PASS；其 T16-F1 措辞问题由 t19 关闭）**——`docs/development.md:112` 与 `docs/development.zh-CN.md:105` 曾把 `extension-isolation` 当作第三条 case 通道。它是两个真实 case 共同引用的共享证据辅助模块，且刻意不是一个 case 行（`skills/dsh-qa/SKILL.md:92`）；它**没有 lane 模式**——不带 `--self-test` 调用时什么都不做并以 0 退出——唯一的离线证明是自身的 `--self-test`。
- **已修复，而非推迟（t13，t14 复核 PASS）**——两项 `skills/**` 条目，任何文档任务都碰不得，因为技能语料库每波只有一个写入者，且其 `VENDOR_LOCK.json` 的 `treeSha` 是阻塞门（AGENTS.md §9/§11）：`skills/dsh-qa/SKILL.md` 的扩展行不再承诺一条“必须为红”的打包分支，桥 lane 的 `schema` 分支现在断言实际发布的 keep-or-drop 规则。同一次改动携带了本波唯一一次重新钉版（`9e643d07… → 7a48fdad…`）。
- **仅报告、未修复**——`evidence/mpd-ext-debranding/20260915T074904Z/verify-debranding.mjs:40-49`（F7）：它打印的结论比它实际探测的范围更宽。把它扩展到 `mcp`/`role` 片段字段是一次函数级改动，属证据负责人。

## 9. 未验证项 / 开放问题

- F1（静默的 adapter 回退）是从代码与已记录的同类先例推导出来的；并未在一个确实找不到 `mpdDsh` 的启动里复现。
- 子进程环境白名单的 win32 分支仅为 code-read；本波所有真实运行都在 linux 上。
- §4 的残留风险（可从磁盘读取凭据、作者声明的 `env` 机密、文件系统信任）是姿态评估，不是已执行的攻击验证。
- 八个过期证据目录（F6）只做了清点，没有重跑；在有人重跑之前，它们对当前树而言仍未验证。
- 插件模块热重载问题在设计上已经定论（v1 没有 reload——重启），但没有任何测试断言“被改动的扩展目录在项目面只在下次调用时重读”。
- 打包布局对扩展仍然可用这一点，由打包器的正向闭包检查（`scripts/pack-mpd.ts:260-269`）与 lane 的打包分支断言，而不是本波把 `dist/mpd-package/` 全新安装进干净 profile 验证的。

## 10. 附录 A —— 复现命令

```sh
# 两条真实 lane（真实挂载 dsh，沙箱 DSH_HOME + HOME + 会话 cwd）
bun skills/dsh-qa/scripts/extension-lifecycle.ts --no-skip
bun skills/dsh-qa/scripts/extension-mcp-bridge.ts --no-skip
bun skills/dsh-qa/scripts/extension-template.ts --no-skip
# 共享证据辅助模块自身的离线守卫（不是 case 通道）
bun skills/dsh-qa/scripts/extension-isolation.ts --self-test
# 接口自身的测试套件
bun test packages/mpd-ext-plugin
# 开发者 CLI 作为对示例的独立 oracle
node scripts/mpd-ext.ts validate extensions/mpd-ext-example
node scripts/mpd-ext.ts --self-test
# 修复必须保持绿色的打包与 vendor 门
node scripts/pack-mpd.ts
node scripts/verify-vendor.ts
# 本报告对的bilingual 门
node scripts/verify-docs-parity.ts
```

## 11. 附录 B —— 证据索引

| 证据路径 | 支撑什么 | 新鲜度 |
|---|---|---|
| `evidence/extensions/t7-verify/20260916T045829Z/` | 本波的真实验证：挂载、扩展端到端、真实 MCP 调用、隔离、锚定 | 当前（HEAD `8777e43` + lane 对象 sha256） |
| `evidence/extensions/extension-lifecycle/2026-09-16T04-58-41.378Z/` | lifecycle lane，全部分支绿色 | 当前 |
| `evidence/extensions/extension-mcp-bridge/2026-09-16T04-59-18.173Z/` | bridge lane，全部分支绿色（含修正后的 schema 分支） | 当前 |
| `evidence/extensions/extension-lifecycle/2026-09-16T06-31-40.371Z/` | skills pass：F8/F9 已修、打包谓词的反向控制，以及本 wave 唯一一次重新钉版的记录（`t8-skills-pass-summary.json`） | 当前 |
| `evidence/extensions/extension-mcp-bridge/2026-09-16T06-31-25.127Z/` | F10 stderr 分支：来自失败子进程的真实有界尾部（上限 2000） | 当前 |
| `evidence/extensions/extension-template/2026-09-16T06-31-12.171Z/` | 模板 lane 的 GREEN：脚手架拷贝的四种 kind 全部可用，读自 session log（前两次留痕见上文说明） | 当前 |
| `evidence/extensions/t13-repair/20260916T045324Z/` | 两条红色分支的修复、重新钉版脚本及其结果 | 当前 |
| `evidence/extensions/extension-lifecycle/2026-09-16T04-43-51.532Z/`、`…04-54-42.210Z/`、`…04-58-47.578Z/`、`evidence/extensions/extension-mcp-bridge/2026-09-16T04-44-32.737Z/`、`…04-54-24.090Z/`、`…04-56-15.636Z/`、`…04-58-11.355Z/` | 修复前后各次 lane 运行（修复前各有一条红色分支） | 已被上面的绿色运行取代 |
| `evidence/extensions/t7-verify/20260916T044344Z/` | 验证的第 1 次尝试（FAILED） | 已被取代 |
| `evidence/mpd-ext-debranding/20260915T074904Z/` | 去品牌与文档引用摘要（探测范围窄，见 F7） | 当前，但窄于其措辞 |
| `evidence/extensions/{mcp-bridge-framing,mcp-bridge-gates,registered-tool-schemas,sanitizer-crosscheck,roles-wiring×2,v0.9.1-defect-fixes}`、`evidence/extensions-repair/t16-pins-and-plane-guard/`、`evidence/mpd-ext-repair/roles-report/` | 更早的接口工作 | **过期**——全部早于 `c239407`，不能用于现状断言 |

只有前四行支撑本报告的当前文本：第三行（`t13-repair`）支撑 §8 的修复结论，前三行支撑 §5 的每一条 live 断言。其余各行仅为完整性而列出——修复前的那次运行（`extension-mcp-bridge/2026-09-16T04-44-32.737Z/`，`ok:false`）、验证失败的第 1 次尝试，以及其他复核者的并发 lane 运行，都**已被取代**，且在本指南（以及它所复核的文档）中没有任何一处把它们当作支撑引用。

## 12. 后续 wave 之后的状态（2026-09-16）

依据：修复任务自己在磁盘上的产物，在写作时读取。以下没有任何一行是从任务描述推断出来的，也没有任何
一行宣称一个证据尚不存在的修复。§6 的登记表刻意保持原样——它是本次审计对"当时发现了什么"的记录；
本节是在它之上的后续映射。

| 条目 | 状态 | 修复所在位置 | 证据 |
|---|---|---|---|
| F1 —— 适配器身份回退是静默的 | **已修复** | 规范注释（提示 `:59-100`）与（`dshAdapterIdentity`, `packages/mpd-ext-plugin/src/index.ts:593`），并已进入重新构建的 `packages/mpd-ext-plugin/dist/index.js`；`mpd-roles-plugin` 交叉引用它 | `evidence/extensions/f1-adapter-identity/20260916T061318Z/` |
| F5 —— 同一个隐患被写成两处半截注释 | **已修复** | （`"CANONICAL NOTE"`, `packages/mpd-ext-plugin/src/index.ts:62`）的唯一规范注释，`packages/mpd-roles-plugin/src/index.ts` 改为指向它而不是复述 | `evidence/extensions/f1-adapter-identity/20260916T061318Z/` |
| F7 —— 一个证据检查器宣称过宽 | **已修复** | 修正后的探测器 `evidence/extensions/debranding-probe/20260916T061807Z/verify-debranding-full.mjs`（新目录；`evidence/mpd-ext-debranding/20260915T074904Z/` 按字节保持原样，作为那次窄探测的记录） | `evidence/extensions/debranding-probe/20260916T061807Z/` |
| F11 —— R11 这类断言没有测试套件归属 | **已修复** | `scripts/verify-pack-closure.ts`——单独运行、解析打包器真实的列表、并在临时夹具上重放红色——已接入 `package.json` 的 `test:qa:all` | `evidence/extensions/pack-closure-check/20260916T061527Z/` |
| F8 —— lifecycle lane 仍在叙述修复前的预期 | **已修复** | `skills/dsh-qa/scripts/extension-lifecycle.ts`：打包分支的叙述改为当前不变量，`greenOwner: "t11"` 已删除 | `evidence/extensions/extension-lifecycle/2026-09-16T06-31-40.371Z/`（真实 lane 运行：`result.json` + `output.log`），并在 `…/t8-skills-pass-summary.json` 汇总 |
| F9 —— 某一行的引用并不是真正把关该分支的条件 | **已修复** | 分支的 `ok` 现在是纯谓词 `packedStateOk()`（位于 `skills/dsh-qa/scripts/extension-lifecycle.ts`，提示 `:412`、使用点 `:383`），并由 `packedNegativeDriver()`（`:435`）在四棵夹具打包树上证明其可证伪；`skills/dsh-qa/SKILL.md` 改为引用这些锚点，不再写旧的“exits 0 (`:385`)” | `evidence/extensions/extension-lifecycle/2026-09-16T06-31-40.371Z/` —— `steps.packed.negativeControl`：`falsifiable: true`、`packerExitGated: true`，三棵破损夹具树 `ok: false` |
| F10 —— 子进程 stderr 尾部这一条没有 lane 分支 | **已修复** | `skills/dsh-qa/scripts/extension-mcp-bridge.ts` 新增 `stderr` 分支：夹具子进程向 stderr 洪泛 3053 字节带标记内容并在握手前退出；该分支断言报告的尾部保留尾部标记、丢弃头部标记，且长度等于从 `packages/mpd-ext-plugin/src/mcp-client.ts` 读出的上限 | `evidence/extensions/extension-mcp-bridge/2026-09-16T06-31-25.127Z/` —— `steps.stderr`：`cap 2000`、`reportedTailLength 2000`、`headDropped true`、`tailKept true`、`vacuous false` |
| F2 —— 没有唯一的平面选择规则 | **已由指南吸收** | `docs/extension-authoring-guide.zh-CN.md` §2 承载唯一的那条规则，英文版承载同一条 | 本指南对，已从 `docs/index.zh-CN.md` 链接 |
| F3 —— 隔离姿态及其残余风险没有文档 | **已由指南吸收** | `docs/extension-authoring-guide.zh-CN.md` §3 陈述该姿态并列出四项已接受的残余风险，锚定（`INHERITED_ENV_VARS`, `packages/mpd-ext-plugin/src/mcp-client.ts:69-85`）与 `:87-97` | 本指南对 |
| F4 —— 重启行为不对称 | **已由指南吸收** | `docs/extension-authoring-guide.zh-CN.md` §4 即把两种模式并列的生命周期与重启矩阵 | 本指南对 |
| F6 —— 证据新鲜度 | **延后，并已标记边界** | 早于 `c239407` 的各目录仅被清点，既未重跑、也未编辑或删除 | `evidence/extensions/boundary-index/INDEX.md` |

有两点本表刻意不说：它不从任务描述推断 F8/F9/F10 已被验证——上表三行各自都写明了交付它的那次 lane
运行，没有任何一行是推断来的；而且这三条 lane 都由本 wave 的验证任务
（`evidence/extensions/verify-skills/20260916T064350Z/`）独立重跑并重新读取过。本 wave 新的模板 lane `skills/dsh-qa/scripts/extension-template.ts`
（case 行 `extension-template`）是扩展 gate 列表中的第四项，并且已在
`evidence/extensions/extension-template/2026-09-16T06-31-12.171Z/` 记录了一次绿色的真实挂载
（技能、流程、角色以及模板自带的 MCP 工具，每一条结论都读自 harness 的 session log）。而本 wave
唯一的一次 skills 重新钉版已经落地：`VENDOR_LOCK.json` 现在读作 `fileCount 318` /
`treeSha a8ba96b8108b2df3cce707e7b69d038f71514cea9e0c488683ba79012efc8d12`，取代修复前的值
（`fileCount 317` / `treeSha 7a48fdad90cc30f9c1e71009be216aeb8b2a1de797eb2bb1897032c41f6b51aa`）——
同一次改动、与 F8/F9/F10 的修改在同一变更集内（AGENTS.md §9/§11），并由 `node scripts/verify-vendor.ts`
验证（PASS）。下文披露的打包树 CLI 偏差已被测量，且在本 wave **未**修复。

### 一处已测量的偏差：开发者在打包产物内是红的

**本 wave 未修复**（记录为 wave 台账 T-51，该台账已从仓库移除）。打包器只复制 `packages/<pkg>/dist`
（`cpDist`, `scripts/pack-mpd.ts`），从不复制 `src`；而开发者 CLI 从 `src` 导入其校验器
（`"../packages/mpd-ext-plugin/src/registry.ts"`, `scripts/mpd-ext.ts:45`；源码表为
`SOURCE_VALIDATOR`, `scripts/mpd-ext.ts:48-56`，已编译回退在 `:60`）。因此在打包树内，每一个 CLI
入口都以 `Cannot find module '<packed>/packages/mpd-ext-plugin/src/registry.ts'` 退出 1。该结论在一棵由
打包器自身产物构建的探针树上测得
（`evidence/extensions/template-scaffold/20260916T063710Z/raw/packed-tree-probe.json`，分支 A 与 B）：
按打包原样，`validate`、`scaffold`、`--self-test` 全部退出 1；还原 `packages/*/src` 后 `validate` 返回 0，
而 `scaffold` 与 `--self-test` 仍失败，因为 `templates/` 也没有被打包。因此 AGENTS.md §4 的
Extension-CLI gate 在 CHECKOUT 中成立（那里 `src` 与 `templates/` 都在），而在打包产物中是红的，
直到打包器把它们一起交付。该限制在 agent 契约中的副本见 `EXTENSIONS-FOR-AGENTS.md` §9。

**已修复 2026-09-17（friction wave，lane E —— T-35/T-36/T-45/T-51）。** 打包器现在交付
`templates/` 与 `docs/` 文档集（用户决定：打包安装是面向作者的），并生成一个已编译校验器入口 <!-- citation-check: illustrative: a pack-time artifact emitted by the packer into the artifact, not a repo path -->
`packages/mpd-ext-plugin/dist/validator.js`——即已交付的 bundle 加上一行 `export { … }`，插件模块本身
不被改动——当 `src` 不存在时 `scripts/mpd-ext.ts` 会回退到它。在刚打包出的 `dist/mpd-package/` 上实测：
`validate`（示例与模板）、`scaffold`（拷进临时目录）与 `--self-test` 在 bun 与纯 `node` 下全部退出 0，
且在人为抽掉资产时 `node scripts/verify-pack-closure.ts` 会大声失败。证据：
`evidence/pack-closure/impl/20260917T011849Z/result.json`。上面那段保留为撰写它的那一波所测得的记录——
它记录的限制已经关闭。


### 证据说明：模板 lane 的三次留痕

`evidence/extensions/extension-template/` 保存着同一小时内的三次运行——`2026-09-16T06-30-30.275Z/`
（RED）、`2026-09-16T06-31-12.171Z/`（GREEN），以及独立验证者当小时后段在另一个沙箱里得到的 GREEN。
lane 在前两次运行之间被修改过，且它是未跟踪文件，因此它修复前的预期**无法仅凭仓库重建**：第三方
无法重新推导出第一次留痕为何是红的。复核者从已记录产物中得到的事实是精确的——首次运行的 MCP
`tool/result` 已经带有拷贝自身的 id、它自己的根、`enabled:true` 以及全部四种 kind 字符串，而且
`server process exited (code=0)` 这一正常收尾行在三次运行中完全相同——因此 RED 来自 **case 自身的
预期**（它的 `mcp` 步骤读到 `ok:false`，且该步骤缺少 `servedOwnRoot` / `servedFourKinds` 两个键），
**不是**产品缺陷，也没有抖动信号。预期在下一次留痕中被修正；产品结果本来就是正确的。
