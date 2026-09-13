# RTL 抽取判定结论 —— `@mpd-dsh/mpd` 的 RTL 面是否已被完全剥离？

[English](./verdict.md)

**任务**：t7 · 集成第 1 轮 · **作者**：Lead（编排 / 集成）
**文档性质**：**修复前基线（PRE-REPAIR BASELINE）**。目前尚未修复任何问题。下文列出的每一项残留
在测量时都仍存在于工作树中；修复由任务 **t8** 执行，其验证由任务 **t11** 执行。本文档是审计
锚点处面向用户的答复，不是完成证书。
**锚定版本（已稳定；写入时复核）**：mpd
`32ae54dd10db7ea46e1c1263143d56f266fd1f78`（分支 `dev`，受跟踪工作树干净——仅有未跟踪的
`evidence/**` 条目）· silicon `bf3dae2530949d9fe410cec9b25b5581bdbcc58e`（工作树干净）。
**审计日期**：2026-09-13（测量时段 07:34Z–07:52Z；本综合文档在 07:52Z 以只读方式复核了锚点与
各项存活事实）。
**裁决记录**：`evidence/rtl-extraction-residual/captain-rulings.md`（R1、R1.1、R2–R7）。当某个
任务自身的分桶与裁决不一致时，**以裁决为准**，分歧记录于 §4.6，不做静默了结。
**本任务范围**：仅本文件与 `verdict.zh-CN.md`。t7 未写入或修改任何 `skills/**`、`packages/**`、
`scripts/**`、`docs/**`、`package.json`、`VENDOR_LOCK.json` 下的文件，也未触碰兄弟 silicon 仓库。
**修订说明（同一交付物；在 t7 首次完成之后）。** 当裁决文件扩充至 R7.12–R7.15、评审新增 §8/§9
（C9–C11）时，本文件就地扩充。变更点：t5 附录及其清单现在作为具名证据被引用；安装器/构建族随其裁决
原文一并结转；Guard-1/Guard-2 被记录为**既有的守卫质量缺陷，明确不属于抽取残留**；保留的参考门禁的
失败通道按实测精确表述（R7.14），不再沿用 t5 更宽的措辞。**结论、红门禁事实与残留集合均未改变**——
该附录不是判定变更，也未作为判定变更呈报。

---

## 1. 本文档回答什么，依据谁的记录

问题**不是**“mpd 仓库是否还在某处提到 RTL”，而是**“mpd 仓库是否仍携带 RTL 能力”**，且依据
拆分自身的治理记录来判断——t2 已将该记录采纳为验收契约（`scope/acceptance.md`，建立在 silicon
`docs/sync-policy.md` §1/§5 与 mpd 侧移除记录之上）：“RTL 能力” = `mpd_verif_*` 工具面、三棵 RTL
技能树、`rtl-ip` 团队档案数据、HDL 语言服务资产（Verible / slang-server）、波形读取行、RTL 指南
以及 golden Verilog fixtures。

输入材料，按裁决使其具约束力的顺序：

| 输入 | 任务 / 作者 | 在本判定中的作用 |
|---|---|---|
| `captain-rulings.md` | 队长 | **决定每一条有争议的路径**（R1/R1.1 LSP、R2 文档、R3 用例、R4 部分拷贝丢失、R5→R5.1–R5.3 钩子、R6 fixtures/pack、R7.1–R7.15，含 R7.12 安装器/构建族、R7.13 判据缺陷、R7.14 保留门禁的通道、R7.15 Guard-1/Guard-2） |
| `review/review.md` | t6 Plan Reviewer（`^verdict: pass`） | 对抗式评审；其 §6 条件 **C1–C11** 对本综合文档**具有强制性**（§6.3 给出映射）。按 C10 与评审 §8–§9：`review.md` 是一份文档，但其 §8.6/§9 写于 t6 终态记录之后，且 R7.7–R7.10 是**队长对其作出的裁决**，而非评审撰写的裁决 |
| `scope/acceptance.md` | t2 Architect | 验收契约：桶 B1–B4、判据 C1–C10、判定规则（§6：C1–C8/C10 成立 ⇒ 已剥离；任一失败 ⇒ 残留；清单中“已声明但缺失”项 ⇒ **桥接缺口**） |
| `repo-scan/findings.md` + `summary.json` + `raw/census.tsv` | t1 Explorer | 双轴穷举普查：4537 条不同命中路径，16 条 `FULL-STRIP-DEFECT`（F1–F6），外加已声明分桶 |
| `cross-repo/{parity,bridge,findings}.md` | t3 Researcher | 交接一致性（声称 73 项 / 落地 64 项 / 缺失 9 项 / 0 内容不符）、桥接可达性、F1–F7 |
| `gates/{gates,findings}.md` + `result.json` + `raw/` | t4（**失效门禁发现**） | 常设门禁测量与“活主体”表 |
| `verify/verdict.md`、`verify/false-negative-probes.md`、`raw/` | t5 Reviewer（所有者） | 独立复核（K1–K5、A1–A6、P1–P20）与 V1–V9 上报 |
| **`verify/addendum-gates-and-criteria.md`**（t5 所有者之作，在 t5 终态记录之后**另行存档**）+ **`verify/addendum-manifest.md`**（t13 索引：**§2 = 附录声明 A1..A22**、**§3 = `review.md` §8 的 A23..A34（§9 直接引用，不在索引内）**、**§4 = 字节同一性/哈希谱系**） | t5 Reviewer / t13 Architect | **本判定证据基础的组成部分**：它自己对五条门禁的重跑（A1–A6）、两个 RTL 用例 SKIP-且-退出-0 的**实际执行**（而非引用，A8/A9）、**三项判据缺陷**（A11–A13）、**安装器/构建残留族**（A14–A16）以及探针 P14–P20。它**不是**判定变更，也未作为判定变更呈报（清单 §1.1/§4：t5 的判定不变；`verdict.md` 与 `false-negative-probes.md` 记录为**字节未变**，哈希见清单 §4） |
| `verify/t4-closure.md` | t12 Researcher | 在同一 HEAD 上对五条门禁一致性命令的独立重测（上下文；见 §6.3 C6） |
| `qa-standard/{standard.md,inventory.md}` | t9 Planner | 软件型用例标准、语料规则 C1–C7、工作示例、有序落地清单 |
| `repair/prep-note.md` | t8 工作单（已编排） | 修复将遵循的执行顺序；仅作上下文 |

**归属规则（R7.10 / V9；评审 §8.4；清单 §7）。** `verify/raw/` 为混合归属：本文档按
`verify/raw/t5-raw-manifest.md` 读取文件。任务 t12 写入该目录的十份门禁日志归属 t12，绝不当作 t5
证据读取——尤其 `raw/verify-rtl-references.log` 是 **t12** 对参考门禁的运行，不是 t5 的。就**附录**
的声明而言，可引用的 raw 集合是 `g5-*`、`supp-*`、`criteria-C1-C10.log`、`c7-*`、`probes-P14-P20.log`、
`p16-*`；`verify/raw/` 下的 `verify-*.log`、`bun-test-packages.log`、`drift-and-artifacts.log`
**绝不**作为附录证据引用。本文档不会改写任何其他任务的证据；`review.md` 在 t6 终态记录之后的章节
（§8.1–§8.4 = R7.7–R7.10、§8.5–§8.6、§9 = C11 的附录核查）在此均**按记录其中的队长裁决**引用，
而非评审撰写的裁决。

---

## 2. 结论

> ## **答复：YES-EXCEPT-LISTED-RESIDUALS（除已列残留外，是）**

**一句话。** RTL 面的大部分确已离开 mpd——三棵 RTL 技能树、整个 `mpd-verif-plugin`、`rtl-ip`
档案数据以及收缩后 bundle 中的所有 RTL 行都已消失，vendor 指纹也收敛到 329 个 skills 文件——但
剥离**并不完整**：锚点处仍留有活的 RTL 能力（已挂载的 HDL 语言服务器注册项，以及一个会下载 HDL
服务器的安装器）、滞留的 RTL 内容（六份 RTL 指南、四个 Verilog fixtures、一个 HDL 模板、一份陈旧
的可安装 pack）、两个“绿色但空转”的 RTL QA 用例，以及两个未闭合的桥接缺口（`rtl-ip` 载体钩子与
README 指针说明）。

* **为什么不是 `NO`。** 策略点名的各项能力类别都有逐项交代：C1、C2 成立（§3.1）；RTL 行已从所有
  preset/patch/manifest 中消失（P11/P17）；语料指纹收敛于 329 文件且仅一次重钉；跨仓库交接为
  64/73 落地，**0 内容不符**、**0 个 mpd 侧原件仍存在**（t3）。这里没有一处说明抽取失败，只说明
  抽取尚未完成。
* **为什么不是无条件 `YES`。** C3、C4、C5（前半）、C6、C8 按测量均失败（§3.1）；HDL 注册项并非
  休眠源码，而是已挂载会话实际运行的产物（§4.1 X1 行）；普查对这四条路径给出的
  `BRIDGE-BY-DESIGN / ACCEPTABLE` 标签已被 R1.1 取代（§4.6）。
* **绿色门禁不构成 `YES` 的证据。** `verify-vendor`、`verify-rtl-references`、`verify-rows-parity`
  为绿色，**但它们无法见证剥离**：按 V3/R7.9——并由 R7.14 收敛为精确表述——参考门禁的失败通道
  **在兄弟仓库存在时、恰好在关键处不可达**：silicon 自有但**在 mpd 中并不存在**的路径会被判为
  `resolved`（任一根解析），`PENDING` 列表预先开脱了每一个受审残留族，而常设运行把 `considered: 0`
  当作 PASS。**在兄弟仓库缺席时它确实会失败**（`MPD_SILICON_ROOT=/nonexistent node
  scripts/verify-rtl-references.mjs` → 退出 1，3 条未解析），所以成立的事实比“结构上不可达”更窄；
  而 R7.14 使修复后重指的门禁**严格强于**今天：保留一个正向的 mpd 侧不变量、在 silicon 侧缺席时
  仍然失败、在常设运行中打印 `considered`，并把 `considered: 0` 读作降级运行而非静默通过。任何绿色
  门禁都不得把本结论上调为 `YES`（评审 §6 C6；评审 **§8.3**，裁决 **R7.9**）。**该门禁只有在 t8
  完成重指、且 t11 在该状态下重测之后才重新获得证据效力**——在此之前，它的绿色**只能作为当前健康
  事实**复述，绝不作为剥离一致性。

---

## 3. 验收契约与两条常设门禁

### 3.1 锚点处判据 C1–C10

| # | 桶 | 锚点处状态 | 决定性测量（t5 附录 §4；t7 已标注处为复核项） |
|---|---|---|---|
| C1 | B1 | **成立** | `git ls-files skills \| wc -l` = **329**；`skills/rtl-{ip-flow,codestyle,verif}` 不存在；`verify-vendor` 退出 0 |
| C2 | B1 | **成立** | `packages/mpd-verif-plugin` 不存在；文本命中 = **7**，恰为已声明的字符串夹具集合；`verify-rows-parity` 退出 0（21 个 id） |
| C3 | B1 | **失败——残留** | `templates/rtl-lsp-client.json` 存在；`grep -rniE 'verible\|slang-server' overlay/ dist/` = **12**（期望 0；仅 `dist/cli.js` 就含 4 个 `verible` + 4 个 `slang-server`） |
| C4 | B1 | **失败——残留** | 六份 `docs/rtl-*.md` 全部存在；`docs/index.md:19` / `.zh-CN.md:18` 仍链接/承载该行（删除后将悬空） |
| C5 | B1 | **前半失败 / 后半成立** | 4 个受跟踪 fixtures 存在；活消费者命中 = **0**——不存在任何可执行读取方（这正是删除安全的原因，而非合规的原因） |
| C6 | B2 | **失败——未闭合的桥接缺口**（绝不可写“已被取代”，也绝不可写成残留） | `presets/rtl-ip.profile.json` 不存在 ✓；`packages/ scripts/ presets/` 中 `rtl-ip.profile.json` 引用 = **0**（判据要求 ≥1）；`grep -ci silicon README.md` = **0**（判据要求 ≥1） |
| C7 | B2 | **用例登记子句已被 R3 取代——绝不报告为通过**；其余部分部分成立 | 门禁退出 0（但结构性盲，见 §2）；`git grep '/root/dshProj' -- scripts skills docs` = 0 ✓；两个用例退出 0 且打印 `SKIP` ✓；行检查**空转**（契约缺陷，§3.2）且 `SKILL.md:62` 已陈旧 |
| C8 | B4 | **失败——分发残留** | `find dist/mpd-package ( -path '*rtl-*' -o -path '*mpd-verif*' -o -path '*verilog*' -o -path '*systemverilog*' )` = **6** 条 FULL-STRIP 路径 |
| C9 | B3 | **此处未重测**——仅按 t3 记录呈报 | t3：声称交接的 73 项中 64 项落地，**9 项 MISSING**（7 个可评审证据文件 + 2 个临时产物），0 项 CONTENT-MISMATCH，目标仓库自洽；t5 在其范围内将 A3 标记为 `UNVERIFIABLE` |
| C10 | all | **锚点部分成立；台账等式部分未被独立复现** | HEAD `32ae54dd…` 在静置窗口后复核，t7 于 07:52Z 再次复核；轴规模 652 条路径命中 / 38 个内容文件（t5）；普查等式是 t5 在其范围内无法证伪的记账项 |

**判定规则的适用。** C1–C8 中任一失败即为残留（修复输入）；清单中**已声明但缺失**的项是**桥接
缺口**，必须单独报告——绝不可并入“残留”（那会宣称过度剥离），也绝不可并入“通过”（那会掩盖跨仓库
契约已断裂）。因此 C6 位于本判定的桥接缺口章节，C7 的登记子句被标记为“已被取代”而非“通过”。

### 3.2 三项契约缺陷：随文结转，不作为通过继承（R7.13：予以纠正，而非继承）

1. **C7 的行检查空转。** `grep -c '^\| rtl-verif ' skills/dsh-qa/SKILL.md` 把 `^` 当作选择分支，
   因而匹配**每一行**（实测 73 = 该文件行数），而严格的行形式返回 **0**。该判据因此无条件通过、
   实则未验证任何内容；修复必须以严格行测试取代之，并在报告中说明。这与 R7.9 属同一“无法失败的
   守卫”家族——**刻意点名两次**，因为这一例位于审计**自身的契约**之内
   （`verify/addendum-gates-and-criteria.md` §4，声明 A11；R7.13）。精确性：该发现针对**随包发布的
   转义写法**，不得被扩大为“该模式无法工作”——严格形式确实有效（评审 §9.3）。
2. **C7 的用例命令无法在其自身兄弟判据成立后存活**：它要求两个 RTL 用例存在并 SKIP，而 C1–C5/R3
   要退役它们；它需要被重新定义，而不是在修复后照跑（声明 A12；R7.13 + R7.2——保持
   SUPERSEDED，绝不通过）。
3. **C6 在两项清单残留上均为红**（无钩子、无指针说明）——见 §3.3 与 §4.5
   （声明 A13；R7.13：在 R5.2/R5.3 的钩子与挂载证明存在之前，报告为桥接缺口；在本修复前基线中
   绝不报告为通过）。

### 3.3 锚点处的两条常设门禁处于 RED——作为**事实**陈述，并附限定条件

**事实。** 在 `32ae54dd10db7ea46e1c1263143d56f266fd1f78` 上，两条常设门禁为 **红**：必需的
MOUNT/启动门禁退出 **1**，测试门禁退出 **1**。二者均由 t4 确认、由 t12 独立重测，并由 t5 再次
运行——同样的两个原因、同样的计数（`verify/raw/g5-exits.txt`：`bundle-lifecycle exit=1`、
`bun-test-packages exit=1`）。

**F1 —— `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` → 退出 1**（`boot.ok=false`）。

* 原因：roles 探针的语料期望 `bundled.length >= 20`
  （`packages/mpd-qa-roles-probe/src/index.ts:58`，并在构建产物 `dist/index.js:282` 中镜像）对上一个
  抽取后为 **19** 的语料（`SKILLS=19 BUNDLED=19` → `[roles-probe] FAIL`）。
* **限定条件 1（R7.6）：该红是期望漂移（EXPECTATION DRIFT）。** 同一份启动日志在其他所有项上都是
  绿的——`install ok`、`composed ok`、`http:true`、`mpd` preset 已挂载、`ADAPTER_TOOL_CALL=ok`、
  11 角色的 `ROSTER=…` 行、`SKILL_FIXTURE=ok name=svn-master bytes=5210`、`noHomeCopy ok`、
  `layerDurability ok`、`uninstall ok`、residue `[]`。若不带此限定条件而写“MOUNT 门禁是红的”，
  会被误读为“挂载坏了”。
* **限定条件 2（R7.6）：这是抽取提交自身的一次未完成重基线。** `12291a7` 在
  `packages/mpd-bootstrap-plugin/test/bootstrap.test.ts` 中做了同一个 `20 → 19` 重基线（其提交信息
  以 RTL 迁移为理由），却**漏掉**了 `packages/mpd-qa-roles-probe/src/index.ts:58`——该提交对
  `mpd-qa-roles-probe` 下的文件改动数为零（t7 复核：`git show 12291a7 --name-only | grep -c
  mpd-qa-roles-probe` = 0）。抽取执行了这一类修复，却遗留了一个实例。
* 版本键：**在 `32ae54d` 为 RED；在 `3d99718` 为 GREEN**（抽取前的工作树，探针当时为
  `SKILLS=22 BUNDLED=22` / `PASS` / `ok=true`）。修复只需一行重基线。

**F2 —— `bun test packages` → 退出 1（295 通过 / 3 失败，`Ran 298 tests across 64 files`）。**

* 原因：`packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs`（2 例）与
  `scope-glob-and-contract.test.mjs`（1 例）用 `git show HEAD:…/lib/tools.js`
  （以及 `quality-gates.js`）构造其“上游原件”夹具，并断言其中 **零** 个 `mpd-delta` 标记。
  `d510a16` 已把 delta 主体提交进该文件，故此前提在 HEAD 上为假（t7 复核：
  `git show HEAD:…/lib/tools.js | grep -c mpd-delta` = **10**）。
* **限定条件（R7.6）：F2 并非抽取造成——它自 `d510a16` 起就已存在。** 由**祖先关系**证明：
  `git merge-base --is-ancestor d510a16 3d99718` → 退出 0（t7 重跑过），即基线提交已携带这些标记；
  并由**字节同一性**证明：`git diff 3d99718 HEAD -- packages/mpd-agent-teams-plugin/` = **0 行差异**
  （插件树与 self-fix 测试完全一致；t7 重跑过）。它**不是**由
  `raw/bun-test-baseline-3d99718.log` 该日志证明的：该日志的两处异常（同一套件出现两种路径拼写；
  对字节一致文件报告 6 与 3 两种失败数）使其不适合作证据；该日志按原样保留，且不得被引用。
* 版本键：**抽取前与抽取后均为 RED**（`3d99718` 与 `32ae54d`）；`bun test` 计数从 376 变为 298，
  只是因为被移除的插件套件随剥离一同离开。

**引用纪律（评审 §6 C7 / C6）。** 本文档引用 t4 时一律作为**失效门禁的发现者**，绝不作为“守卫
一致性”——t4 自身的改派理由指出该工作树并不一致。t12 的收尾把 `verify-vendor`、
`verify-rtl-references`、`verify-rows-parity` 计入“三条绿色门禁”；此处**仅按单条命令**结转，
绝不作为剥离一致性的信号（V3/K5，R7.9）。

### 3.4 锚点处完整门禁台账（数字均为引用；命令由 t4/t12/t5 运行，t7 未重跑）

标注 **t5** 的行来自 t5 附录——`verify/addendum-gates-and-criteria.md` §1，即
`verify/addendum-manifest.md` §2 索引的声明 **A1–A6**——其自身运行把五个退出码记入
`raw/g5-exits.txt`；因此两条红门禁是**由 t5 自身运行复现的，而非引用**（A4/A5）。表下方的
**Guard-1 与 Guard-2** 属于*既有的守卫质量缺陷，明确不属于抽取残留*（t6 §6 C9 / R7.15），
其处置见 §4.3 X14/X15。

| 门禁命令 | 退出码 | 解读 | 测量者 |
|---|---|---|---|
| `node scripts/verify-vendor.mjs` | **0** | `[verify-vendor] PASS`——commit/version/stats/asset 全部 OK，skills 329 文件 | t4、t12（日志字节一致）、t5 |
| `bun test packages` | **1** | 295 通过 / 3 失败——见上 F2 | t4、t12、t5 |
| `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | **1** | `ok=false`——见上 F1 | t4、t12、t5 |
| `node scripts/verify-rtl-references.mjs` | **0** | 42 resolved / 6 pending-by-design / 0 unresolved——**不构成剥离证据**：兄弟存在时在关键处盲（mpd 缺席的路径被判为 `resolved`；`PENDING` 预先开脱受审诸族），兄弟缺席时则**确实失败**（R7.14/V3/R7.9） | t4、t12、t5 |
| `node scripts/verify-rows-parity.mjs` | **0** | 21 个 row id 与 bundle patch 插入清单一致 | t4、t12、t5 |
| `bun run typecheck`（`tsgo --noEmit`） | **0** | 输出为空；可证伪探针产生 TS2322 → 退出 1（探针已移除） | t4 |
| `bun run test:qa` | **0** | 全部自检通过——**在两个 RTL 用例仅打印 SKIP 的同时保持绿色**（t3 的 F1） | t4、t9 |
| `bun skills/dsh-qa/scripts/preset-conformance.mjs` | **0** | 31/31 preset 行，真实 `session/create` 200，负对照为红，0 条 apply 崩溃特征 | t4 |
| `node scripts/install-profile.mjs --dry-run` / `--yes`（隔离 home） | **0** / **0** | “nothing written” / “wrote profile/ home patch/ presets(1)” | t4 |
| `node scripts/bootstrap.mjs` | **0** | 预检 + vendor OK | t4 |

**锚点处测得的守卫质量缺陷（不属于抽取残留；t6 §6 C9 / R7.15）。** 一次守卫侧清查（评审 §8.6）
加上 t5 附录，发现两个保留的守卫在**什么都没验证**的情况下退出 **0**：**Guard-1**
`scripts/verify-rows-parity.mjs`——用字节副本、其 patch 不含 `- insert:` 块且安装器不打印任何内容
时，它打印 `ok: 0 row ids match the bundle patch insert list ()` 并退出 **0**（计数被打印但从不
断言）；**Guard-2** `scripts/verify-vendor.mjs`——把 `assets` 清空（7 → 0）后它打印
`commit OK / version OK / stats OK / PASS` 并退出 **0**，**零**指纹被校验。二者都位于抽取从未触碰
的路径上；R7.15 裁定它们**属于 t8 的范围**（推翻评审“另立后续任务”的建议，该异议保留记录于
`review.md` §8.6），以主体计数断言加可证伪探针作为证明。处置见 §4.3 X14/X15。

**哪三条是“三条仓库级门禁”？** AGENTS.md §4 在仓库级绑定的三条——**Vendor**
（`verify-vendor`，退出 **0**）、**Tests**（`bun test packages`，退出 **1**）与 **MOUNT/启动检查**
（`bundle-lifecycle`，退出 **1**）——已在上表附退出码引用，其中两条为红。（t12 标注为“三条绿色
门禁”的是另一组三元组，属于按命令计的健康事实；见 §3.3。）

---

## 4. 残留台账（按严重度排序；每行均给出桶、严重度、证据路径与后果）

处置标记：**[FIX]** = 本次修复确认为待修（t8）· **[DEF]** = 有记录理由的延后 · **[KEEP]** =
保留并记录（已声明豁免，绝不静默省略）。桶标签采用验收契约的标签（B1 FULL-STRIP ·
B2 BRIDGE-BY-DESIGN · B3 SILICON-CONTENT · B4 UNTRACKED-BUILD-ARTIFACT）。

### 4.1 高（High）

| # | 路径 | 桶 | 证据路径 | 用户可见后果 | 处置 |
|---|---|---|---|---|---|
| **X1** | `packages/mpd-mcp-lsp/overlay/lsp/server-definitions.ts`（HDL 头注释 `:13-15`、安装提示 `:68-69`、内建注册 `:173-174`）、`overlay/lsp/language-mappings.ts`（`:13-15`、`:186-189`）、**构建产物 `dist/cli.js`**（4 个 `verible` + 4 个 `slang-server`）、`README.md:34-52` + `README.zh-CN.md` | **按 R1.1 属 B1**（普查曾判 B2/ACCEPTABLE——已被取代，§4.6） | `verify/verdict.md` §1 K1；`raw/claim1-lsp-hdl.log`、`raw/claim1-liveness2.log`；t5 附录 §4 C3（`raw/criteria-C1-C10.log`：12 处命中）——t7 复核了这 12 处命中以及 `dist/cli.js` 中 4 个 `verible` + 4 个 `slang-server` 的分布 | 已挂载的 `mcp-lsp` 行启动的正是该文件（`cordis.patch.yml:64-73`），且 `VENDOR_LOCK.json:39-43` 对其字节（`04b49f8c…`）做 sha 钉扎——**HDL 语言服务是已挂载的，不是休眠源码**；README 宣传的 `references/{verilog,systemverilog}/README.md` 已被 `32ae54d` 删除，即随包发布了一个并不存在的安装路径 | **[FIX]** 删除注册项 + README 章节（双语同步）；通过 `node scripts/build-mcp.mjs` 重新生成 `cli.js`；做行为检查（`initialize` + `tools/list`，非 HDL 内建数量不变）；**一次** `VENDOR_LOCK` 重钉。若无法诚实完成再生成 → **[DEF]**，附失败命令/退出码/repr；绝不手改 `cli.js` |
| **X2** | `scripts/install-mcp.mjs:32-35`（`LSP_TARGETS`：`verible-verilog-ls`、`slang-server`）+ `:306`（自检**要求**二者存在） | **B1**（安装器/构建族——不在 t1 的任何缺陷行中） | `verify/addendum-gates-and-criteria.md` §5（声明 **A14**，见 `verify/addendum-manifest.md` 索引）+ `raw/p16-classify.log`；R7.12 | mpd 自有的脚本会把 HDL 语言服务器安装进 toolchain，且其自检在二者缺失时失败——mpd 端到端地提供 RTL 能力，**且 `scripts/pack-mpd.mjs:75-77` 会把这个安装器复制进发布产物**，因此随包发布的产物携带同一套供给能力 | **[FIX]（R7.12）** 移除两个条目并让自检不再要求它们；保留其他所有服务器；已安装到本地的二进制按 R6 的本地产物条款作为**工作区产物**处理。**须明确陈述以免成为静默能力丢失的后果：**改动后 mpd **完全不**安装 HDL 语言服务器——若 silicon 的 LSP 路径要在干净机器上工作，其供给必须由 silicon 自己承担 |
| **X3** | `docs/rtl-verif-guide{,.zh-CN}.md`、`docs/rtl-ip-flow-guide{,.zh-CN}.md`、`docs/rtl-gap-assessment{,.zh-CN}.md`（6 个受跟踪文件；其中 4 个相对 silicon 已陈旧——`rtl-verif-guide*` 与 `rtl-gap-assessment*`） | **B1** | t1 F1（`repo-scan/summary.json`）；t3 `bridge.md` §3-bis + `raw/dual-copy-docs.tsv`、`raw/diff-*.txt`；t2 C4；t5 附录 §2；t7 复核六个文件在锚点处仍全部受跟踪 | 同一份“已迁移”内容在两个仓库各有一份受跟踪副本，且 mpd 版本更旧、与权威版本互相矛盾；mpd 的文档枢纽仍称其“正在迁移”——读者落在这里读到的是迁移前的叙事，而在此处做的文档修订会在再次剥离时丢失（sync-policy §2.2） | **[FIX]** 删除六份；同一改动内修好所有入链（`docs/index.md:19` + `.zh-CN.md:18`、`packages/mpd-bundle/README*.md`、`AGENTS.md:139`、`scripts/verify-rtl-references.mjs` 的 `DOCS` 数组） |
| **X4** | `skills/dsh-qa/scripts/rtl-verif.mjs`、`skills/dsh-qa/scripts/rtl-ip-profile.mjs`、`skills/dsh-qa/SKILL.md:62` 行 | **B2**（桥接；仅在已登记且诚实时合法） | t3 F1 + `raw/bridge-audit.log`；t5 附录 §3（`raw/c7-skip-probe.log`）：在 `MPD_SILICON_ROOT=/nonexistent` 下两个用例均退出 **0** 并打印 `SKIP … PASS (nothing to probe: bundle absent)` | 任何没有 silicon checkout 的机器上，`bun run test:qa` 都把这两个 RTL 用例计为绿色**而它们什么都没验证**——CI 机器会在从未检查交接的情况下报告 RTL 验证通过；且 `test:qa` 实际运行的 `rtl-verif` 用例在 `SKILL.md` 中**没有**行，而描述已退役布局的 `rtl-ip-profile` 行却仍在 | **[FIX]** 退役两个用例与该陈旧行（R3），落地软件型脚手架（t9 `standard.md` §7）；让 `test:qa` 与 `test:qa:all` 重新诚实（L1/R7.5——属于超出本次抽取范围的修复决策） |
| **X5** | `tests/golden/fixtures/verilog/**`（4 个受跟踪文件：`README.md`、`modules/adder4.v`、`modules/cnt8.v`、`tb/tb_adder4.v`） | **按 R6 属 B1**（普查曾判 B2/ACCEPTABLE——已被取代，§4.6） | t2 C5；t5 `verdict.md` §1 K3 + `raw/claim3-golden-fixtures.log`；`raw/probes-P8-P12.log`（受跟踪树中 HDL 扩展名文件共 3 个） | 与 silicon 自有的 golden fixtures 字节一致的重复副本，且 mpd 侧**零活消费者**；`docs/adder4.md:7` / `docs/cnt8.md:7` 仍引用 mpd 路径 | **[FIX]** 删除 fixture 树；把两处 `Source file:` 行重指向 silicon fixture 路径并加“已迁移”说明（R6/R7.4——两份文档**保留**；见 §4.5 [KEEP]） |

### 4.2 中（Medium）

| # | 路径 | 桶 | 证据路径 | 用户可见后果 | 处置 |
|---|---|---|---|---|---|
| **X6** | `dist/mpd-package/**`——**恰好 6 条 FULL-STRIP 路径** = 两个已退役的 RTL 用例脚本（`skills/dsh-qa/scripts/rtl-{verif,ip-profile}.mjs`）+ 两个 HDL 参考目录（`skills/lsp-setup/references/{verilog,systemverilog}`）+ 其中的两个 `README.md` | **B4**（分发卫生；`dist/` 已被 gitignore） | t5 K4 `raw/claim4-stale-pack.log`；t2 C8；t7 复核 `find …` = **6** 且逐条核对这六个路径（t5 的 P19 `dist/` 扫描另列 `skills/lsp-setup/scripts/verify-lsp.ts`，它不在此 `find` 的模式集合内） | `dsh plugin add dist/mpd-package` 会**安装**已退役的 HDL 内容（两份已删除的 HDL 页面，2783 B / 3093 B），即一个可分发产物携带了工作树中已不存在的内容 | **[FIX]** 重新打包（`node scripts/pack-mpd.mjs`），且必须在再生成的 `cli.js` **之后**；或删除该目录并记录所选项（R6/R7.5 顺序） |
| **X7** | `scripts/build-mcp.mjs:37-44` 的 `BUILTIN_BUILD_ANCHOR = "mpd-rtl-overlay-v1"`（锚点值）与 `LSP_OVERLAY_FILES` 及 `applyLspOverlay` 内的多道响亮漂移守卫（overlay 文件缺失；overlay 中无锚点；上游源缺失；上游导出的锚定符号漂移；复制后锚点消失） | **R1.1 的构建约束——并非 RTL 残留**（R7.12；声明 **A15**，其 raw 载有守卫的精确行号） | `verify/addendum-gates-and-criteria.md` §5 + `verify/addendum-manifest.md`；t7 复核该锚点字符串与守卫块（引用守卫行号时以附录自身的测量为准——该文件已被 t8 触及，其当前行号不是锚点事实） | 该锚点守卫使得一旦 overlay 文件失去锚点，`node scripts/build-mcp.mjs` 会**响亮失败**：R1.1 的修复不能只是删掉 HDL 行；而让守卫在改名后悄然不再触发，就会再造一个“无法失败”的缺陷 | **[FIX]（R7.12）** 在**同一改动**中把锚点改为非 RTL 名称并保持守卫有效；证明 = 构建自身成功**加上**失败侧（该触发时守卫仍会触发） |
| **X8** | `packages/mpd-bundle/README.md:8,11` + `README.zh-CN.md:4`（波形读取行 `mcp-wave-mcp`/`mcp-traceweave`、`verif` 插件、RTL 指南指针） | **B4/B1 文本**（V6） | t5 `verdict.md` §2 V6（`raw/census.log`）；t1 F4；P11：这些行是**被注释掉的**（`cordis.patch.yml:92-125`） | bundle README 宣传随包 patch 并未挂载的插件与行；没有活能力，但读者会据此期待实际不存在的波形/verif 工具 | **[FIX]** 去掉 `mpd-verif`/波形相关声明，重指或移除 RTL 指南指针；双语同改 |
| **X9** | F1（探针阈值）与 F2（self-fix 夹具）——两条常设红门禁本身 | 不适用（仓库守卫缺陷） | `gates/findings.md` F1/F2；`verify/t4-closure.md` §1；上文 §3.3 | `dev` 无法带着所需的绿色扫描被签收；红色启动日志还会**掩盖同一日志中真实的 apply 崩溃特征**；测试门禁与 RTL 工作无关地保持红色，从而掩盖未来回归 | **[FIX]** 将探针重基线到实际随包语料（更好：派生该值，或断言具名 fixtures）；把 self-fix 的“上游原件”夹具钉到早于 `d510a16` 的版本，或内嵌原件副本。注（t12 §5）：F2 的补救属于测试夹具卫生，不是 RTL 修复 |

### 4.3 低 / 信息（Low / info）

| # | 路径 | 桶 | 证据路径 | 用户可见后果 | 处置 |
|---|---|---|---|---|---|
| **X10** | `skills/dsh-qa/SKILL.md:62` 行文本，声称“bundle patch ships the rtl-ip roster profile” | **B2**（V5） | t5 `verdict.md` §2 V5；`raw/checks-A4-A6.log`、`raw/probes-P8-P12.log` | 用例索引断言了一种已不复存在的布局（数据归 silicon 所有） | **[FIX]** 随 R3 删除该行，并落地软件型行 + 语料说明句 |
| **X11** | `docs/index.md:19` / `docs/index.zh-CN.md:18` 的“being moved … until then this file describes the pre-extraction checkout” | **B2 文本**（V8） | t5 `verdict.md` §2 V8（`raw/checks-A4-A6.log`） | 过渡性措辞在删除后仍残留，随后描述的是一个已不存在的文件 | **[FIX]** 与 R2 文档删除一并移除该叙事框架 |
| **X12** | `scripts/pack-mpd.mjs:75` 提及 verible/slang 二进制的注释；`package.json:33` 的 `verify:rtl-refs` 行；`.gitignore:23-34` | **B1 文本**（安装器/构建族，声明 **A16**） | `verify/addendum-gates-and-criteria.md` §5 + `verify/addendum-manifest.md` §2；R7.12 | 发布脚本与 manifest 中的纯文本提及；该 manifest 行让参考门禁保持接线（而发布脚本会整体复制 `skills/`，故安装器的 HDL 目标也会进入发布产物） | **[FIX]/[KEEP]（R7.12）** 修正应当诚实修正的部分（注释中的名称）；保留 `package.json:33` 供重指后的门禁使用；`.gitignore` 的 RTL 临时模式保留——选择须明说而非默认 |
| **X13** | `<repo>/.venv-rtl/`（44 MB cocotb venv）、`<repo>/.toolchain/bin/verible-verilog-ls`（6 MB） | **B4**（F4；已安装的 HDL 二进制按 R7.12 属 R6 本地产物条款下的**工作区产物**） | `gates/findings.md` F4；`verify/t4-closure.md` §2.1——t7 在锚点处复核了两条路径均存在（`.venv-rtl/` 目录；`.toolchain/bin/verible-verilog-ls` 6 295 856 字节） | 未跟踪、已 gitignore 的机器状态；对任何受跟踪文件扫描不可见，但**打包安装不得拾取它们**（C8） | **[KEEP]** 已声明并证明被忽略；RTL 专属的 `.gitignore:23-34` 模式保留（见 §4.5） |
| **X14** | **Guard-1** `scripts/verify-rows-parity.mjs`——空主体集合即通过 | **既有的守卫质量缺陷，明确不属于抽取残留**（t6 §6 C9；R7.15） | 评审 `review.md` §8.6（Guard-1 行；`review/raw/guard-blind-spot-sweep.txt`）；R7.15 | 当 patch 不含 `- insert:` 块且安装器不打印任何内容时，门禁打印 `ok: 0 row ids match the bundle patch insert list ()` 并**退出 0**——退出码的每一个消费者（CI、代理、审计自身的“门禁全绿”清单）都会从一次**零主体**的运行中读到 PASS；silicon 的同步策略点名的正是这条门禁需随语料删除而更新，因此它就在修复路径上 | **[FIX]（R7.15，推翻评审的延后建议）** 加入最小的主体计数断言（枚举集合为空即失败，并指明是哪个集合）；证明 = 可证伪探针：空主体副本 → 退出 1，非空 → 退出 0 |
| **X15** | **Guard-2** `scripts/verify-vendor.mjs`——零指纹即通过 | **既有的守卫质量缺陷，明确不属于抽取残留**（t6 §6 C9；R7.15） | 评审 `review.md` §8.6（Guard-2 行；`review/raw/guard-blind-spot-sweep.txt`）；R7.15 | 把真实 lock 截断使 `assets` 为空（7 → 0）后，它打印 `commit OK / version OK / stats OK / PASS` 并**退出 0**，**零**指纹被校验；被截断或手工编辑的 lock 因此会被读作“vendor 基线已完整校验” | **[FIX]（R7.15）** 断言资产集合非空（`Object.keys(lock.assets).length >= 1`）并指明空集合；同一可证伪探针。**须保持可见的理由（R7.15）：**这两条门禁正是修复用来证明正确性的工具，因此零主体的绿色恰是本次审计存在的意义所要暴露的那一类问题 |

### 4.4 延后（Deferred）

| # | 事项 | 延后理由 | 必须随行的内容 |
|---|---|---|---|
| **D1** | R1.1 的 `cli.js` 再生成——**仅当**构建路径无法诚实完成时（上游源缺失、构建失败、行为检查红） | 带证据的产物改动延后是可接受的；手改 `cli.js` 不可接受 | 精确的失败命令、其退出码、repr，以及下次尝试可复现的构建命令——同时保持工作树其余部分为绿（R1.1 §5） |
| **D2** | 迁移中丢失的 7 个可评审 `mpd-verif-plugin/evidence/smoke/*` 文件（`adder_tb.py`、`adder.v`、`results.json` 以及 4 个 `workspace/rtl/*` 文件） | 记录，而不是编造恢复：mpd 不得重新加入 RTL 载荷，这些文件也不得在此凭记忆重建（R4） | 该记录写入修复报告；若属主需要，则在 silicon 侧跟进——部分拷贝的佐证（同目录的 `smoke.mjs` 已落地）见 t3 `parity.md` §2.1 |
| **D3** | 两个临时产物丢失（`__pycache__/*.pyc`、`.mpd/verif/logs/*.log`） | 派生/临时；silicon 的 `.gitignore` 同时忽略二者 | 无需动作（R4） |

### 4.5 保留并记录（最不可静默省略的一类）

| 条目 | 为何保留 | 依据 |
|---|---|---|
| `docs/adder4.md`、`docs/cnt8.md` | 内部 QA/golden 参考记录：其技术内容已在 silicon；§5 的“不得保留 RTL 内容”约束的是**产品能力**，而非内部 QA 溯源。**已记录残余风险：**若把 §5 按字面理解，它们应被删除——它们是此处点名的有意例外 | **R7.4 / R7.8 / V2**；其 `Source file:` 行仍重指向 silicon fixtures 并附“已迁移”说明 |
| `packages/mpd-workmate-plugin/test/workmate.test.ts`（“implemented the verilog counter”、“wrote cnt8.v”）；`skills/dsh-qa/scripts/workmate-library.mjs:19,23,129`（“Verilog counter specialist”）；`packages/mpd-bundle-plugin/test/sidebar-tab.test.mjs`；`packages/mpd-bootstrap-plugin/test/bootstrap.test.ts`；`skills/dsh-qa/scripts/dual-track-smoke.mjs:21`；`packages/mpd-qa-roles-probe/src/index.ts:34`；`packages/mpd-agent-teams-plugin/self-fix-tests/scope-glob-and-contract.test.mjs:9,56`（把 `packages/mpd-verif-plugin/test/**` 用作 scope-glob **样例路径**） | 纯字符串的测试/样例数据，不是能力；改写它们会无收益地使被采纳插件的 self-fix 证据失效 | **V7 / R7.12（安装器/构建族，声明 A16）**——每项在此列出并给出理由 |
| `.gitignore:23-34`（`.venv-rtl/`、`simv_iverilog`、cocotb/verilator 临时产物） | 保护性临时规则；`simv_iverilog` 是唯一 RTL 专属模式 | **V7 / R7.12（声明 A16）**——说明哪些保留以及为何 |
| `PLAN.md`、`.silicon-extraction/removal.log`、`t5-closure-evidence/**`、`docs/review-p0-p3.md`、`docs/track-a-report.md`、`evidence/**`（锚点处 633 条 RTL 命名的受跟踪路径）、`evidence/dsh-qa/rtl-*/**` | 过程/历史记录，豁免改写 | **AGENTS.md §3/§7 + R1 §2 + R6**——计数并声明，绝不静默跳过 |
| `AGENTS.md:139` | 正确记录了迁移；是当前最接近所需“指针说明”的内容 | 作为 R2 的入链计入，不在可删除范围 |
| `skills/frontend/references/design/layout-skill.md:101`（“RTL” = right-to-left 布局） | **真实假阳性**——完全不属于 RTL/EDA 内容 | **V7 附录 §7**——绝不可进入任何残留台账 |

### 4.6 已记录的分歧（裁决为准；分歧不做静默了结）

1. **普查对活 HDL 产物的分桶已被取代（V1/R7.7）。** `census.tsv` 第 4368–4370 行把
   `overlay/lsp/{server-definitions,language-mappings}.ts` 与 `dist/cli.js` 判为
   `BRIDGE-BY-DESIGN / ACCEPTABLE / none`，引用的是一条随后被 R1.1 扩展的 R1。**以 R1.1 为准**：
   理由是裁决给出的存活证据——`mcp-lsp` 行启动的正是该 `dist/cli.js`，且 `VENDOR_LOCK.json:39-43`
   对其做 sha 钉扎，即 HDL 服务是**已挂载**的，不是休眠源码。仅凭普查分桶推导修复清单，会**漏掉
   工作树中唯一活着的 RTL 能力**（评审 §6 C1；评审 **§8.1**，裁决 **R7.7**）。准确规则是：普查是
   **发现输入**，t8 **可以**用它确保没有任何已发现项被丢弃；**裁决才是契约**，决定每条路径的去向。
   修复清单绝不能仅由普查分桶推导：普查保留任何裁决未命名的发现（J1/J2 类、留档类），裁决决定它
   命名的每一条路径——即**普查覆盖面加裁决处置的调和**，二者冲突时以裁决为准。
2. **fixtures/文档：三种答案，各自一个处置（V2/R7.8；评审 §8.2）。** t1 将 fixtures 判为
   `BRIDGE/ACCEPTABLE`；t9 的标准/清单把它们（以及 `docs/adder4.md`/`docs/cnt8.md`）列为待退役删除
   目标；t2 §1+§5 则把它们称为 mpd 不得保留的能力。裁决：四个 fixtures **删除**；两份文档在 §3 豁免
   下**保留**，并重指向其 `Source file:` 行。
3. **t9 清单 §7（“docs/rtl-*.md——留给 t20”）与 R2（“现在就删”）冲突。** 以 R2 为准：删除属于本次
   修复，且 t9 自己的 `standard.md` §7 第 4 步同样要求删除。此处记录，使矛盾可见。
4. **t9 标准 §7 第 4 步（删除 `docs/adder4.md`/`cnt8.md`）与 R7.4（保留）冲突。** 以 R7.4 为准：
   修复保留两份文档并重指向其来源行。
5. **t5 的 V3 在某一方向上说过头了；R7.14 给出精确表述（评审 §4a/§9.3）。** “失败通道在结构上
   不可达”是从合成 scratch 根推广而来：在真实布局下、兄弟仓库缺席时，实测参考门禁退出 **1**
   （3 条未解析）。成立的事实更窄，也是本文档所用：**兄弟存在时**，运行会把 silicon 自有但
   **mpd 中并不存在**的路径判为 `resolved`，并通过 `PENDING` 预先开脱每一个受审残留族，因此该通道
   恰好在关键处不可达；**兄弟缺席时它确实会失败。** 对修复具约束力的后果（R7.14，收窄 R7.9）：
   重指后的门禁保留一个**正向的 mpd 侧主体**（本地“禁止路径”不变量），**在 silicon 侧缺席时仍然
   失败**（绝不把今日的退出 1 变成带 SKIP 行的退出 0），在**常设**运行中打印 `considered`，并使
   `considered: 0` 被读作降级运行——该改写最终**严格强于**今日行为。
6. **t5 原始 `claim3` 的“文件名轴”是假阳性**（`rtl-verif.mjs` 写入的是它自己的内联 Verilog）；
   该原始日志不得作为 K3 证据引用（评审 §4b）。
7. **t5 的 A4 “就实质而言 PASS”不是启动复验**，不得被当作挂载结果传播（评审 §4d）；F1 的判定依赖
   t4 第 3 次尝试 / t12 的挂载启动。
8. **Guard-1/Guard-2：评审的延后被推翻（R7.15 对评审 §8.6 / §6 C9）。** 评审清查了保留的守卫，
   发现两条零主体即 PASS 的路径，并建议**另立带独立证据的后续改动**，将其归类为抽取从未触碰路径上的
   既有守卫质量问题（该建议作为**异议**保留在 `review.md` §8.6 与条件 C9 中）。队长在范围上作出相反
   裁决：它们**在本次**一并修复，因为这两条门禁正是修复用来证明正确性的工具，绝不能在零主体时读出
   PASS。它们仍归类为**既有的守卫质量缺陷，明确不属于抽取残留**——因此剥离判定不因它们而被抬高
   （§4.3 X14/X15）。
9. **附录是证据，不是判定变更（评审 §9.4 / C11）。** `review.md` 作为一份文档被引用，其 §8–§9 与
   §6 C9–C11 写于 t6 终态记录之后，而 R7.7–R7.10、R7.12–R7.15 是**队长对其作出的裁决**，而非评审
   撰写的裁决（C10）。

---

## 5. 覆盖诚实性——哪些内容**没有**被验证

* **除 t3 的只读一致性检查外，silicon 侧没有任何内容被复验。** t5、t7 乃至整个审计（除 t3 的只读
  检查外）都没有读取、哈希、启动或编辑任何 silicon 文件。C9 按 t3 的记录呈报；`A3` 在 t5 范围内为
  `UNVERIFIABLE`；R1.1 的 silicon 侧一半（silicon 自身副本是否保持字节一致）**不在此判定**。
* **挂载门禁未被 t5 重跑。** t5 的 A4 只重测 F1 的*实质*（语料 19 对阈值 20）并已说明；对启动本身的
  判定必须来自带注册插桩的挂载启动，绝不能来自 `--dump-config`（AGENTS.md §4）。
* **`bun test` 未被 t5 重跑。** §3.3 中 F2 的结论依据 t4/t12 的测量加上祖先关系与字节同一性证明；
  t5 明确拒绝重跑并已披露（评审 §4c）。
* **载体钩子行为（C6）今日没有任何证明**，因为尚无任何落地：没有钩子，也没有指针说明。其证明
  义务——在 scratch `DSH_HOME` 上的真实挂载启动，显示 `agent-teams` 行在 `config.profiles` 下同时
  携带 **`mpd` 与 `rtl-ip`**，且 `profiles.mpd` 仍保有完整花名册，**加上** silicon 缺席时的 `{}`
  回退启动——**目前尚不存在**（R5.2/R7.1；评审 §6 C4）。
* **台账完整性等式（C10 的后半）未被独立复现**；普查的行算术是 t5 在其范围内无法证伪的记账项。
* **t7 未运行的命令。** 本综合文档只做**只读**复核：`git rev-parse`、`git branch`、`git status`、
  `git ls-files`、`git ls-tree`、`git diff`、`git show`、`git merge-base --is-ancestor`、`grep`、
  `sed`、`ls`、`find`。**t7 未执行任何门禁**——没有 `verify-vendor`、没有 `bun test packages`、没有
  `bundle-lifecycle`、没有 `preset-conformance`、没有 `test:qa`、没有安装器、没有挂载启动。本文档
  中的每个门禁数字都是**引用** t4/t12/t5 并附归属与版本键；这里没有任何数字是作为 t7 测量呈报的。
* **t7 实际复测了什么（只读，07:52Z，在锚定工作树上——这是本文档中仅有的 t7 测量）。**
  mpd HEAD = `32ae54dd10db7e…`，分支 `dev`，受跟踪树干净（仅 `??` 证据条目）·
  silicon HEAD = `bf3dae2530…`，`git status --porcelain` 为空 ·
  `git ls-files skills | wc -l` = **329** · 六份 `docs/rtl-*.md` 全部受跟踪 · 四个
  `tests/golden/fixtures/verilog/**` 全部受跟踪 · `templates/rtl-lsp-client.json` 存在 ·
  `grep -rniE 'verible|slang-server' packages/mpd-mcp-lsp/{overlay,dist}` = **12** · 两个 RTL QA 用例
  均存在 · `grep -ci silicon README.md` = **0** · `git grep 'rtl-ip.profile.json' -- packages scripts
  presets` = **0** · `find dist/mpd-package ( … )` = **6** 条 FULL-STRIP 路径 · `git merge-base
  --is-ancestor d510a16 3d99718` → 退出 **0** · `git diff 3d99718 HEAD --
  packages/mpd-agent-teams-plugin/` = **0** 行 · `git show HEAD:…/lib/tools.js | grep -c mpd-delta`
  = **10** · `12291a7` 对 `mpd-qa-roles-probe` 下的文件改动数为 **0** · `mcp-lsp` 行的启动路径与
  `VENDOR_LOCK.json:39-43` 的 `cli.js` sha 钉扎均为读源确认。本文档其余内容均引自 t1–t6/t9/t12。
* **这条“绿色但盲”的门禁不能说明的事。** `verify-rtl-references.mjs` 绝不可被引作 mpd 面已剥离
  的证据（V3/R7.9；评审 §8.3）。精确地说（R7.14）：**兄弟存在时**，其 `resolved` 桶中装的是 **mpd 中并不存在**
  的路径，且其 `PENDING` 列表预先开脱了每一个受审残留族，故绿色运行与 §4 中每一项残留同时存在并不
  矛盾——已用该门禁的未修改字节副本演示（`raw/demo-blindness-A.log`）；**兄弟缺席时**它退出 **1**。
  因此修复的改写必须严格更强（§6.1 步骤 2），而不是 SKIP-到-绿。
* **附录自身的限度与谱系。** `verify/addendum-gates-and-criteria.md`（声明 **A1..A22**，见
  `verify/addendum-manifest.md` **§2**）是 t5 所有者之作、与 `verdict.md` **分开**归档；它是本判定
  证据基础的一部分，但**不是**判定变更——t5 的判定不变，且 `verdict.md` 与
  `false-negative-probes.md` 记录为字节未变（哈希与证伪检查见清单 **§4**）。该附录在建立索引之后
  经过更正（**r1 → r3**；谱系见清单 §4 与 `verify/raw/addendum-revision-log.txt`），因此清单中
  索引版 r1 的指纹与当前文件不同属于预期，并非异常。其 C9 一行在 silicon 侧保持
  `UNVERIFIABLE`，其 C10“台账等式”一半是它并未独立复现的记账项——与 §3.1 完全一致。
  **引用闭环：两侧均已闭合。** 本判定以**路径加归属**引用该附录（并以清单索引其声明，及
  `review.md` 侧的 A23..A34），满足清单指针事项中属于 lead 的一半，并承载守卫清查族（清单 §6，
  现标注“UPDATED — both addenda are now citable”）；队长一侧同样满足——`captain-rulings.md`
  **R7.12（L334–336）以路径点名 `evidence/rtl-extraction-residual/verify/addendum-gates-and-criteria.md`
  与 `verify/addendum-manifest.md` §2**，t6 附录则在 R7.15（L400）以 `review.md` §8 及异议位置点名。
  `verify/verdict.md` 按契约保持字节未变且早于该附录，因此它既不引用它、也无须引用：**本判定即
  lead 的报告**。**章节编号提示：**清单在首次归档后被扩充，因此旧的指针若称**§3** 为字节同一性记录，
  指的是现在的 **§4 “Byte-identity and hash lineage”**；需要精确时请按章节名引用。
* **修复进行中（本文档定稿时的工作树状态）。** t8 已在工作树中开始落地修复——例如
  `build-mcp.mjs` 的锚点现已改为 `mpd-lsp-overlay-v1`，六份 RTL 文档 / 两个用例 / 四个 fixtures 已
  删除，`mpd-delta rtl-ip-carrier` 区域已落地到被采纳插件中。**本文档任何内容都未更新到修复后的
  状态：**上文每一条陈述、计数、哈希与门禁结果都是**修复前锚点** `32ae54d` / `bf3dae2`；t11 将
  按 C1–C10 与挂载证明重测修复后的工作树。
* **审计期例外：** `repair/prep-note.md` 是 t8 的已编排工作单，在撰写本判定时仍在扩充
  （326 → 382 行）。因此本文档仅将其作为上下文引用，绝不作为测量结果。

---

## 6. 后续动作，以及上文每个数字的来源

### 6.1 有序的最小工作（t8 负责执行；t11 负责验证）

1. **退役两个 RTL QA 用例并落地软件型脚手架**（R3 / t9 §7 步骤 1–3）：新增 `software-smoke` 用例与
   其 `SKILL.md` 行及语料规则，删除 `rtl-{verif,ip-profile}.mjs` 与 `rtl-ip-profile` 行，改写
   `dual-track-smoke.mjs:21` 注释，修正 `llm-dual-track` ↔ `dual-track-smoke` 的 slug 不匹配。
   *证明*：`bun run test:qa` 在新语料上退出 0，列出 `software-smoke` 且已退役 slug 不再出现；
   `software-smoke` 真实通道一次 `ok=true`。
2. **删除六份滞留 RTL 文档并修复所有入链**（R2），随后**让参考门禁保持诚实且严格更强
   （R7.14，收窄 R7.9）**：`CASES = []`、更新头部/用法文本、保留一个**正向的 mpd 侧主体**（本地
   “禁止路径”不变量）、打印一行 `mpd-side cases: 0 (retired by t8 …)` 披露、在**常设**运行中打印
   `considered` 且 `considered: 0` 被读作**降级运行**（而非静默 PASS）、控制项不动，并且门禁在
   **silicon 侧缺席时仍然失败**——今日“兄弟缺席即退出 1”不得被改写成带 SKIP 行的退出 0。
   *证明*：`node scripts/verify-rtl-references.mjs` 退出 0 **并**带该披露行（仅作为桥接健康事实
   引用）；`ls docs/rtl-*.md` 为空；`git grep -n '/root/dshProj' -- scripts skills docs` = 0。
3. **R1.1 与安装器/构建族在同一改动内（R7.12 / 声明 A14–A16）**：移除 HDL 注册项，把
   `BUILTIN_BUILD_ANCHOR` 改为非 RTL 名称（**同一改动内**），通过 `node scripts/build-mcp.mjs`
   再生成 `cli.js`，删除 HDL 模板与 README 的 RTL 章节（双语），从 `install-mcp.mjs` 移除
   `LSP_TARGETS` 及其自检要求，删除 `templates/rtl-lsp-client.json`；陈述改动后 mpd **不**安装任何
   HDL 语言服务器这一后果（供给归 silicon），并记录 `.gitignore` / `pack-mpd.mjs:75` /
   `package.json:33` 的选择。
   *证明*：构建自身成功**加上**锚点守卫的失败侧；再生成的 `cli.js` 仍能应答 `initialize` +
   `tools/list`，非 HDL 内建数量不变；**一次** `node scripts/verify-vendor.mjs` **重钉**（退出 0）。
4. **删除 Verilog fixture 树并重指两份参考文档**（R6/R7.4）。
   *证明*：`git ls-files tests/golden/fixtures/verilog` 为空；两份文档仍在且带 silicon 路径 +
   迁移说明；`git grep -l 'fixtures/verilog' -- tests packages skills scripts presets` 为空。
5. **实现 `rtl-ip` 载体钩子（R5.2/R5.3）与 README 指针说明（R5.1）。**
   在 `packages/mpd-agent-teams-plugin/lib/index.js` 的 `apply(ctx, config)` 顶部加入**一个附加型**
   `mpd-delta` 区域；apply() 时读取；缺失/损坏 JSON 时回退 `{}`；合并
   `{ ...loadSilicon(), ...(config.profiles ?? {}) }`；≤16 个 profiles；用 `--write-registry` 重新
   生成注册表且 `--check` 干净；补 AGENTS.md §6 适配表条目。
   *证明（C6 子句）*：在 scratch `DSH_HOME` 上的真实**挂载**启动，显示 `config.profiles` 下同时有
   `mpd` 与 `rtl-ip` 且 mpd 花名册完整，**加上** silicon 缺席时的 `{}` 回退启动。`--dump-config`
   不是加载证据，不得引用。
6. **修复两条常设红门禁与两条零主体守卫**（F1 探针重基线；F2 self-fix 夹具钉扎；**Guard-1**
   `verify-rows-parity.mjs` 主体计数断言；**Guard-2** `verify-vendor.mjs` 的 `assets` 非空断言——
   R7.15，归类为既有守卫质量，**不是**抽取残留）。
   *证明*：`bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` 退出 0；`bun test packages` 退出 0；
   以及 Guard-1/Guard-2 的可证伪探针对——空主体副本 → **退出 1**（指明空集合），非空 → **退出 0**。
7. **重新打包 `dist/mpd-package`**（在再生成的 `cli.js` 之后），或删除并记录所选项。
   *证明*：C8 的 `find` 不再返回任何 FULL-STRIP 路径。
8. **一个提交、一次 `VENDOR_LOCK` 重钉**（`skills/**` 单一写入者，AGENTS.md §9/§11）：R1.1 的
   `cli.js` 再生成与 R3 的 `skills/**` 退役使同一个指纹失效，必须一同落地（R7.5）；重新打包严格
   在其后。
   *证明*：完整扫描——`bun run typecheck`、`bun test packages`、`node scripts/verify-vendor.mjs`、
   `node scripts/verify-rtl-references.mjs`、`node scripts/verify-rows-parity.mjs`、`bun run test:qa`
   ——加上 `git status --short`，全部粘贴进 `repair/report.md`。
9. **t11 复验修复后的工作树**（稳定哈希；C1–C10 命令 + 挂载证明）并闭环；修复后的版本届时取代本
   基线。

**t8 的范围，按 V1/C1 规则表述：** **普查是发现输入**（t8 可以用它确保没有任何已发现项被丢弃），
**裁决是决定每条路径去向的契约**；修复清单是**两者的调和——普查覆盖面加裁决处置**。普查找到的
任何东西都不得被丢弃，包括留档字符串与安装器/构建族（附录的发现按“普查级覆盖”进入，而非按桶；
R7.12 现已明确处置该族）；两者冲突时以裁决为准，且分歧保留在记录中。评审 §6 条件 C1 正是这一调和。

### 6.2 溯源

* **任务**：t1 Explorer（普查/台账）· t2 Architect（验收契约）· t3 Researcher（跨仓库一致性与
  桥接）· t4 Deep Worker（常设门禁；失效门禁的发现者）· t5 Reviewer（独立复核；V1–V9；
  **`verify/addendum-gates-and-criteria.md`**——门禁重跑、判据缺陷与安装器/构建族，在 t5 终态记录
  之后另行归档）· t6 Plan Reviewer（对抗式评审，`^verdict: pass`，§6 C1–C11 + §8/§9）· t9 Planner
  （软件型用例标准）· t12 Researcher（t4 收尾重测）· **t13 Architect**
  （`verify/addendum-manifest.md`——附录声明 A1..A22 与 `review.md` §8（A23..A34）的索引；§9 直接引用，不在索引内）·
  t7 Lead（本综合文档）。
* **裁决记录**：`evidence/rtl-extraction-residual/captain-rulings.md`（R1、R1.1、R2–R7，含 R7.12
  安装器/构建族、R7.13 判据缺陷、R7.14 保留门禁的通道、R7.15 Guard-1/Guard-2 属 t8 范围）。
* **附录引用（按清单请求）**：测量 →
  `evidence/rtl-extraction-residual/verify/addendum-gates-and-criteria.md`；索引 →
  `evidence/rtl-extraction-residual/verify/addendum-manifest.md`（**§2**「Addendum 1 (t5) — numbered
  index `A1..A22`」· **§3**「Addendum 2 (t6) — numbered index `A23..A34`」· **§4**「Byte-identity and
  hash lineage」· **§6** 治理文档指针核查 · **§7**「Where the raw evidence lives and who owns it」）。
  该附录**不是**判定变更；旧的指针若称 §3 为字节同一性记录，则早于 §3 被复用于 t6 索引——请按
  章节名引用。
* **锚点处三条仓库级门禁命令与退出码**（由 t4/t12/t5 测量，此处引用——t7 未重跑）：
  * `node scripts/verify-vendor.mjs` → **退出 0**（`PASS`，skills 329 文件）
  * `bun test packages` → **退出 1**（295 通过 / 3 失败；F2，自 `d510a16` 起即存在）
  * `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` → **退出 1**（`boot.ok=false`；F1，期望漂移——
    探针阈值 `>= 20` 对语料 19）
* **审计时的 HEAD 版本**：mpd `32ae54dd10db7ea46e1c1263143d56f266fd1f78`（分支 `dev`，受跟踪树
  干净）· silicon `bf3dae2530949d9fe410cec9b25b5581bdbcc58e`（工作树干净）。
* **稳定哈希锚点**：t5 的首次/稳定主体哈希完全一致（diff 为空）；t7 于 2026-09-13T07:52Z 以只读方式
  复核了锚点与两项残留计数，仍然成立。
* **原始证据根**：`evidence/rtl-extraction-residual/{scope,repo-scan,cross-repo,gates,verify,review,qa-standard,repair}/`。

### 6.3 与评审 §6 具约束力条件（C1–C11）的映射

| 评审 §6 条件 | 本文档中的落实位置 |
|---|---|
| C1——修复清单 = t1 普查 ∪ 验收 C1–C10 ∪ R1–R7 处置的**调和**；活的 HDL 产物不得遗漏 | §2、§4.1 X1–X5、§4.2 X6–X9（附录族）、§4.3 X14/X15、§4.6(1)；X1 明确承载普查的三条路径 |
| C2——把 V6、V7、V8、V9 带入报告 | V6 = X8 · V7 = §4.5 · V8 = X11 · V9 = §1 归属规则 |
| C3——两条门禁按 R7.6 限定条件与版本键台账呈报 | §3.3（两条限定条件；版本键）、§3.4 |
| C4——在挂载启动证明存在前，C6 是未闭合的桥接缺口（兄弟存在**与**缺席两种情形）；不得标为已被取代；两项残留均为红 | §3.1 C6、§3.2(3)、§5、§6.1 步骤 5 |
| C5——C7 的用例登记子句被 R3 取代；绝不报告为通过——且其自身检查即空转 | §3.1 C7、§3.2(1)(2)、§4.3 X10 |
| C6——绝不把 `verify-rtl-references.mjs` 引作剥离证据；t12 的“三条绿色门禁”仅按命令计 | §2、§3.1、§3.3、§3.4、§5 |
| C7——t4 引作“失效门禁的发现者”，而非守卫一致性 | §3.3 结尾说明、§6.2 |
| C8——R7.5 的顺序可见（再生成的 `cli.js` 行为检查、一个提交、一次重钉、其后重新打包） | §4.1 X1、§4.2 X6/X7、§6.1 步骤 3、7、8 |
| **C9**——Guard-1/Guard-2 作为**既有的守卫质量发现、明确不属于抽取残留**结转；将其并入 t8 属修复范围决策 | §3.4 守卫质量块、§4.3 X14/X15（R7.15）、§4.6(8)、§6.1 步骤 6 |
| **C10**——把 `review.md` 引作一份文档，同时说明 R7.7–R7.10 是队长对其作出的裁决，而非评审撰写的裁决 | §1 评审行、§4.6(9)、§6.2 |
| **C11**——附录必须成为正式判定的一部分，**以名称加归属**引用，且 t8 的清单要承载其新残留族 | §1 两行（附录 + 清单）、§3.2、§3.4、§4.1 X2、§4.2 X7/X12、§5、§6.1 步骤 2、3、6、§6.2。**台账归属：**因 t5 与 t6 已不可变，队长将该附录并入本判定与 t8 的范围（R7.12/R7.13/R7.15）——未另立后续任务 |

## 7. 附录——两次终态后扩展（闭合 C11）

**说明行：**上文由锚点处的审计记录综合而成；本附录记录紧随其后的两次终态后扩展，且不改写上文任何内容。

**1. 终态后扩展属于证据基础。** 两者之所以存在，是因为队长的追加请求在这两个任务进入终态之后
才到达；**且都没有改变各自任务的判定**：
* `verify/addendum-gates-and-criteria.md`——t5 完成后的扩展（t5 所有者；与 `verify/verdict.md`
  分开归档），由 `verify/addendum-manifest.md` **§2** 索引为声明 **A1–A22**。**按 r3 引用：181 行 /
  14897 B / sha256 `596c26b07fae5faeae38843e672e3de2772f2f6cc79b50954390d8b6ebcb6ac2`**，
  或经权威组合 `verify/raw/addendum-revision-log.txt` 引用——t13 清单正在被改为指向该修订日志、而非
  复制一个会变动的哈希，因此**引用清单时请优先引用修订日志**。r2 更正的是它自身对 C7 严格检查的
  渲染（锚定形式 `'^| rtl-verif '` 返回 **0**；**随包发布的转义形式** `'^\| rtl-verif '` 才是空转
  的那一个），r3 增加了 C11 归属头与修订日志——**发现与 t5 的判定均未改变**。若 **t6 §9** 的溯源
  pin 指向较早的附录版本，该 pin 记录的是 **§9 在 15:49 读到的内容**；它**是被取代，而非错误**。
* `review/review.md` **§8**（守卫盲点清查，raw 见 `review/raw/guard-blind-spot-sweep.txt`）与
  **§9 附录 2**（其对 t5 附录的独立裁定），以及 §6 中被拓宽的条件 **C9–C11**。

**清单范围——把它作为两次扩展的发现入口，按章节引用。** 其 **§2 = A1..A22** 覆盖 t5 完成后的
扩展（A21 = 纯内容分类，含 `skills/frontend/…/layout-skill.md` 的“RTL = 从右到左”假阳性；A22 =
工作树状态）；其 **§3 = A23..A34** 覆盖 t6 的 §8 守卫清查（普查被 R1.1 取代及其存活理由、
fixtures/文档的裁定、各守卫发现及其 raw 日志、四条未能成立的对抗论证作为负结果、C9/C10，以及 A33
记录 R7.15 将两条守卫纳入范围并保留评审的延后建议为异议）。**来自其 §4 哈希谱系的提醒：§9 被刻意
排除在 A23..A34 之外——该索引仅覆盖 §8**——因此绝不可把它误当成对 `review.md` 全文件的覆盖。该清单
是**活索引**：其谱系表记录自身的 v2 版本（38 623 B / sha256
`2d6bb047d44a2355d017f2448196c6fdd2646a2ef637ae4c2a310df0515f1f98`，8 个章节共 34 条声明），而
撰写本附录时实测的磁盘版本已经更大——因此**按章节引用，绝不复制字节数**；权威的非过期指纹见
`verify/raw/addendum-revision-log.txt` 与 `captain-attestation.md` §1。

**本判定实际消费的 review 版本。** 本判定的 §6 **C1–C8** 依据 `review.md` 的 225 行状态综合，
随后为 §8/§9/**C9–C11** 重新读取该文件；最终消费的是冻结版本 **395 行 / 42475 B / md5
`f3c69a63cf6f5275484a94867f73b533`**（sha256 前缀 `826f9c5b83df766ba5c7a50d`），`^verdict: pass`
字面位于 L13 与 L395。版本链为**五个状态：225 → 326 → 333 → 338 → 395（冻结）**——其中 **338 行
状态是瞬态的**（C4/C5 拓宽 + C11 插入到 §9 之前以及条件重排）——更早的状态**任何人都无法证明**；
333 行状态下队长实测的哈希为 36295 B / md5 前缀 `7a346ab7b2c380e38bff01a6f0852414`。这些字节的
哈希权威见 `captain-attestation.md` **§1**；各版本按 **BASELINE / NEW EVIDENCE / WORDING
REFINEMENT ONLY / HASH DISCIPLINE ONLY** 的分类见 `review/CHANGELOG.md`（评审新增的配套文件）。

**2. C11 条目——新族以“调和”方式进入范围，而非经由普查分桶。** 相关路径为
`scripts/install-mcp.mjs:32-35`（HDL 语言服务器安装器；`:306` 要求两者都存在）与
`scripts/pack-mpd.mjs:75-77`（把该安装器复制进发布产物）；外加 `scripts/build-mcp.mjs:40` 的
`mpd-rtl-overlay-v1` 锚点及其位于 `:58-59` 与 `:73-74` 的响亮守卫（守卫行号以附录自身 raw 为准，
声明 **A15**）；外加 `package.json:33` 与 `.gitignore:23-34` 的纯文本提及。**分类：**这些是
**R7.7 调和规则**下的发现——**不是**由普查分桶推导，也**不是**抽取残留（t6 **C9**）。**其中两项
属于修复约束而非删除：**锚点必须在改名后保持自洽并**证明失败侧**；安装器必须在**源码树与打包
产物两处**都停止供给 HDL 服务器（§4.1 X2、§4.2 X7、§4.3 X12）。

**3. C4/C5 经独立重测被拓宽——两半均予记录。**
* **C6 两半皆红：**载体钩子缺失，**且**指针说明缺失（`grep -ci silicon README.md` = 0）。修复需
  补齐**两半并附挂载启动证明**——兄弟存在且 mpd 花名册完整，以及兄弟缺席时以 `{}` 干净启动。
* **C7 随包发布的行检查本身空转：**`grep -c '^\| rtl-verif ' skills/dsh-qa/SKILL.md` = **73** =
  该文件行数，因为在 GNU BRE 中 `\|` 是选择分支，故 `^` 这一支匹配每一行；严格形式返回 **0**，且
  不存在 `rtl-verif` 行。**未转义**的形式才是正确的——“空转”仅适用于**随包发布的转义写法**，
  而非该模式本身。C7 的用例登记子句仍**已被 R3 取代**，且**绝不报告为通过**。

**4. 独立收敛，作为加强来陈述。** t5 的扩展与 t6 的 §8.6 清查从**不同入口**得到同样三项结果：
仅两个可 SKIP 的用例（25 个中的 **2 个**）、陈旧 pack 中相同的**六**条 FULL-STRIP 路径、以及
同一条“锚点在修复路径上”的约束。正是这种一致，使这些事项**进入范围而非被延后**。

**5. 一个已确认的假阳性，刻意排除。** `skills/frontend/references/design/layout-skill.md` 中的
“RTL”指 **CSS 从右到左布局**。它绝不可进入台账；把它写下来，正是防止未来的读者重新开案。

**6. Guard-1/Guard-2 的修复状态（R7.15）。** `scripts/verify-rows-parity.mjs`（空主体集合 →
`ok: 0 row ids …` 且**退出 0**）与 `scripts/verify-vendor.mjs`（`lock.assets` 清空 **7 → 0** 时仍
PASS）**属于修复范围**，分类为**既有的守卫质量缺陷，不是抽取残留**；评审的延后建议作为**异议**
保留在案（`review.md` §8.6 / 条件 C9）。

**7. 本次审计三次撞上的常设规则——pin 纪律。** **pin 仅对其命名的版本有效；快照须标注自身时间；
在对象最后一次编辑之后组装的记录才是首选形式。** 三个实测实例：本文档自身早先的行锚定声明
（已在 §5/§4.2 更正）、**t6 §9 的附录溯源 pin**（记录的是 §9 在 15:49 读到的内容——被取代，而非
错误）、以及 **t13 清单的行**（正在被改为指向 `verify/raw/addendum-revision-log.txt`，而非复制一个
会变动的哈希）。对任何下游读者的后果：重读注册表/记录，而不要复用记忆中的数字；优先修订日志，而
不是被复制过的哈希。

**本附录所依据的 review 冻结版本。** `review/review.md` = 395 行 / 42475 B / md5 `f3c69a63cf6f5275484a94867f73b533` / sha256 `826f9c5b83df766ba5c7a50d…`，`^verdict: pass` 位于 L13 与 L395；各版本触发原因见 `review/CHANGELOG.md`（74 行 / 6559 B / md5 `07c413fd9ceebf5f0572f78b0216674f`）。本判定书自身已冻结；其字节的哈希权威见 `captain-attestation.md` §1（文件内自哈希无法自洽），下游文档引用冻结版本而非“最新版”。
