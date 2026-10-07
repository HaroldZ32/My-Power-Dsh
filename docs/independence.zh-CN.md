# 独立性契约

[English](./independence.md) | **中文**

本页是验收标准 **A1.3**（`docs/plan-0.1.7-adaptation.md`，波次 `mpd-seam-convergence`）的书面形式：
本 bundle 的各部分是 **相互独立的包**，而它们之间仍然存在的耦合是**被计数**的，而不是被当作不存在。
本页说明测到了什么、用什么工具测的，并在最后一节说明它**刻意不声明**什么。

契约有五条，每条都有一个可执行的见证：

| 条款 | 见证 |
|---|---|
| 包是独立单元：自己的源码树、自己的构建入口、自己的 `dist/` | `node scripts/verify-dist-fresh.ts` 重建每个入口并逐字节比对 |
| 包只能通过适配器的接缝名清单触达宿主 | 清单由 `packages/mpd-dsh-adapter-plugin/src/index.ts` 导出，各行 import 它 |
| 没有任何包在运行时改写另一个包的对象 | 耦合门禁的 `global-write` 规则 |
| 跨包边界是源码级 import，按产物各自内联 | 耦合门禁的 `cross-package-import` 规则 + `verify-dist-fresh` |
| 残余耦合是冻结的、以身份为键、且只能收缩的集合 | `packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` |

## 1. 测了什么，用什么测的

### 1.1 一个包就是一个单元

`packages/` 下的每个目录都是自洽单元：一棵 `src/` 源码树（一个或多个入口）、它自己的 `dist/`
产物，以及**需要时才有的**清单。2026-10-02 实测：**30 个包目录，其中 26 个自带 `package.json`。**

没有清单的四个并不是独立性的例外，而是元数据放在别处的包：`mpd-codegraph-plugin` 由自己的行
经 bundle 的 `exports` 映射挂载，两个 MCP 服务器（`mpd-mcp-codegraph`、`mpd-mcp-shared`）经各自的
`launch.ts` 启动，而 `mpd-tui-adapter-plugin` 正是本波次新建的包。**本树中没有任何包把本树的另一个包
声明为依赖** —— 不在 `dependencies`、不在 `devDependencies`、不在 `peerDependencies`、也不在
`optionalDependencies`。实测：26 份清单里的 `@mpd-dsh/*` 规格符数量为零。本仓库里的每一条跨包边界
都是**源码级相对 import**，这正是下面两节的主题。

### 1.2 一个包对应一行

包通过被写进两个随包发布的补丁层之一而成为能力 —— `cordis.patch.yml`（宿主平面）或
`presets/mpd.patch.yml`（预设平面）—— 而绝不通过改动宿主、手写 home 目录，或把行推进另一层
（AGENTS.md §8）。2026-10-02 实测：`cordis.patch.yml` 中有 **23 个不同的
`packages/*/dist/*.js` 行目标**。行只寻址包内的路径，绝不伸手进另一个包的内部去改它的配置。

## 2. 无运行时改写，无运行期交接

契约禁止那种「每个 `import` 看起来都干净，但『独立』已经不成立」的形态：一个包**通过进程**
去够到另一个包。这个形态就是写入共享全局。因此门禁拥有 `global-write` 规则，而测量结果是：

* **`packages/*/src` 中对进程全局的写入为零。** 2026-10-02 实测：整个 band 里 `globalThis` 只出现
  三次，全部在 `mpd-hashline-plugin` 内置的 xxhash 里 —— 两句文档说明，以及一次**读取**
  （`const runtime = globalThis as typeof globalThis & { Bun?: BunHashRuntime }`，即该插件对原生快
  速路径的运行时探测）。
* **bundle 唯一会写的全局，全部位于随包发布的补丁表达式里**，也就是 `cordis.patch.yml` 中由 loader
  求值的守卫，而不是任何包的模块体：**两个 warn-once 注册表，分布在三条表达式中** ——
  `globalThis.__mpdSidebarGuardSeen`（`mpd-better-sidebar` 挂载守卫）与
  `globalThis.__mpdTuiPlaneGuard`（两条 TUI 平面团队守卫）。每一个都只是该守卫自己的「这句话我说过
  没有？」标志，以自己的消息为键。它是**关于一条警告**的进程级状态，绝非包之间的通道：没有任何代码
  读取这些键来获取另一个包的对象。有一个测试会预置 `__mpdSidebarGuardSeen`
  （`packages/mpd-bundle-plugin/test/sidebar-guard-profile-dir.test.ts`），除此之外没有别的消费者。

第二种被禁止的形态是行**提供（provide）**一个宿主拥有的服务 id —— 那是 bundle 借以替换宿主组件、
而不是为其增补的机制。门禁的 `harness-service-provide` 规则会把 `ctx.provide("<name>", …)` 与宿主接缝
名清单比对，测量结果是：**band 只提供 MPD 自有的服务** —— `mpdDsh`、`mpdRoles`、`mpdConfig`、
`mpdExtensions`、`mpdWorkmate` —— 宿主接缝 id **为零**。

## 3. 跨包 import 是源码级的，构建会把它们内联

本仓库的每一条跨包边界都写成**指向兄弟包 `src/` 树的相对规格符**，例如
`../../mpd-dsh-adapter-plugin/src/index`。2026-10-02 实测：**对兄弟包 `dist/` 的 import 为零**，兄弟包
`package.json` 依赖也为零（§1.1）。

这带来三个后果，且三者都可核验：

1. **不存在共享的模块身份。** `bun build` 在构建期解析该规格符，并把兄弟包的**模块体内联**进消费者自己
   的 `dist/index.js`（任何打包器对源码级 import 都是如此）。实测：适配器的模块体出现在 **18 个不同的
   `dist/index.js` 产物**中；`function dshSeamInject` 以及适配器的若干辅助函数原样出现在例如
   `packages/mpd-boulder-plugin/dist/index.js` 里。两个都「import 了适配器」的行并不共享对象图 —— 它们
   各自拥有一份副本。
2. **适配器的改动会改变消费它的那些行的产物**，而且只改变这些：消费者从未引用的导出会被 `bun build`
   摇树移除。在把接缝名收敛到单一来源的实测中：适配器导出新常量之后，重建一个**不消费**它们的消费者
   （`mpd-codegraph-plugin`、`mpd-bundle-plugin`）得到的产物里，新名字出现次数为**零**。
3. **绑定者是 `node scripts/verify-dist-fresh.ts`。** 它从仓库根重建每个入口并逐字节比对产物，正是它把
   「你把自己弄失效的东西重建了吗？」从一个习惯变成可核验的问题。当产物因为与内容无关的原因变化时，
   它也是诚实的仲裁者。2026-10-02 实测：六个产物报 `STALE`，而其中**没有一个是**由本波次适配器改动带来的
   内容变化造成的：四个（`mpd-bundle-plugin`、`mpd-codegraph-plugin`、`mpd-qa-roles-probe`、
   `mpd-team-watchdog-plugin`）只带 bun 自身的代码生成签名 —— 记录在案的构建工具链是 **bun@1.4.0**，而本
   检出运行 **bun 1.4.2**，它对同名绑定的改名方式不同（`config2` → `config`），模块辅助前导码也不同 ——
   另外两个（`mpd-tui-plugin`、`mpd-team-core-plugin`）是本波次其它泳道正在就地编辑的行。这正是该门禁
   会打印它所用工具链的原因。

## 4. 被认可的耦合类别

有四类耦合是**允许**的；在此点名，是为了让「独立」永远不会被读成「没有 import」，而且每一类都由门禁
强制执行，而不是靠信任：

1. **行 import 适配器。** `packages/mpd-dsh-adapter-plugin` 是与宿主唯一的代码级接触面（AGENTS.md §6）；
   一个包开始 import 适配器，是变得**更**独立，因此指向适配器的 import **豁免于冻结清单，且允许增长**。
   该豁免是一份包**名字**白名单，绝不是 `*-adapter-plugin` 后缀规则 —— 后缀规则会让任何包靠改名把自己
   改名进豁免区。2026-10-02 实测：**47 条**此类 import。
2. **行 import 适配器的接缝名清单。** cordis 的 `inject` 数组不再把宿主服务 id 写成随手字面量。
   `DSH_SEAM_TOOLS`、`DSH_SEAM_SUBAGENTS`、`DSH_SEAM_SKILLS`、`DSH_SEAM_AGENTS`、`DSH_SEAM_COMMANDS`、
   `DSH_SEAM_SESSIONS`、`DSH_SEAM_WEB_SERVER`、`DSH_SEAM_WEB_RUNTIME`、`DSH_SEAM_AGENT_PRESETS` 由适配器
   导出，行用 `dshSeamInject(...)` 构造自己的数组，返回的字符串完全相同。宿主改名如今只需改**一个
   文件**。运行期取值未变是通过 import 每个重建后的 `dist/index.js` 并打印其 `inject` 来核验的。
3. **共享纯模块，而不是各自分叉。** `mpd-bootstrap-plugin` import `mpd-ext-plugin` 的 skill frontmatter
   子集，`mpd-roster-provider-plugin` import `mpd-config-plugin` 的 slot 表，`mpd-ext-plugin` import
   `mpd-roles-plugin` 的 roster 数据。每一种情形下都只有**一份**声明是契约；第二份副本正是两种写法开始
   漂移的起点。
4. **跨包的仅类型 import。** 形如 `import type { TeamRecord } from
   "../../mpd-team-core-plugin/src/team-store.js"` 的语句在构建时被**擦除**，不产生任何运行期边 —— 但它
   依然是对兄弟包内部模块路径的源码级依赖，因此与其它耦合一样被冻结。

## 5. 钉住的债：已退役主体内置的 `schemastery` —— 已关闭

**状态：由 `de-vendor-and-verify-law` 波次关闭（2026-10-07）。** 关闭度量即后续动作当初指明的那一项，
与删除在同一次提交中取得：

* 采纳主体 `packages/mpd-agent-teams-plugin/**` 已**删除** —— 实测计数为 **768 个文件**（含 `_deps/`），
  删除前 `git ls-files` 报出的也是同一数字 768；
* 内置树迁往 mpd 自有的家：`packages/mpd-schemastery/lib/` 承载校验器（`index.ts`）、它自身的依赖
  （`cosmokit.ts`）与声明集（`types/index.d.ts`），MIT 声明全文收录于
  `packages/mpd-schemastery/LICENSE`；
* 下文点名的**四个现役 import 方**在**同一次提交**中改指向：由
  `../../mpd-agent-teams-plugin/_deps/schemastery` 改为 `../../mpd-schemastery` —— 以
  `grep -rn "mpd-agent-teams-plugin" packages/*/src` 只返回历史注释、不返回任何 import 为证；
* 门禁的冻结集仍恰好保留这四条边（它们被改指向，而不是被丢弃），因此该后续动作不会长出第五个：见
  `packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts`。

有一处**实测的扩大范围**，因合同并未点名而记录在此：同一次删除也带走了四个测试文件对
`_deps/cordis`、`_deps/dsh-llm` 与 `_deps/dsh-tools` 的 import（它们需要**真实的**派发器或**真实的**
harness 校验器），因此它们那 8 个文件的传递闭包（schemastery、cosmokit 与六个 `@deepseek-ai/dsh-*`
模块）一并迁入同一个家的 `harness/` 之下。该闭包是自足的 —— 不需要网络，也不新增任何 npm 依赖 —— 拒绝
走 `cordis` 系 `devDependencies` 路线的理由写在 `packages/mpd-schemastery/README.md`。

### 这笔债当时的样子（历史记录，已被上文关闭动作取代）


bundle 曾整体采纳了一个第三方插件（`agent-teams` 主体），它当时**已从组装中退役**，但仍留在
`packages/mpd-agent-teams-plugin`。它的树里带有一份内置依赖，而现役包 import 的正是**那一份**：

* 该树：`packages/mpd-agent-teams-plugin/_deps/schemastery` —— **6 个文件、65,846 字节内容**
  （`du` 报告为 92 KB），含 `lib/index.ts`、`lib/index.cts`、声明映射与 `LICENSE`；
* **四个现役文件** import 它：`mpd-config-plugin/src/index.ts`、
  `mpd-config-plugin/src/settings-schema.ts`、`mpd-team-watchdog-plugin/src/index.ts`、
  `mpd-tui-plugin/src/index.ts`；
* 主体自己的 `lib/index.ts` 以另一个规格符（`../_deps/schemastery/lib/index.ts`）import 同一棵树。

这是**被钉住的债，不是疏忽**。在主体仍然需要它的时候把该树搬走，等于复制一份第三方库，因此这笔债记录
在此并附**具名后续动作**：当主体被删除时，其 `_deps/schemastery` 树迁往一等公民的住处，四个 import 方
在同一次提交里一并改指向。门禁冻结这四个 import 方，使这笔后续动作不会再长出第五个。

## 6. 计数清单：以身份为键、冻结、且只能收缩

执行者是 `packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts`。它扫描
`packages/mpd-<name>/src/**/*.ts`（先剥掉注释，保留行结构），并报告三类：跨包 import、全局写入、
提供宿主服务。

* **用身份，绝不用位置。** 一条记录是 `file :: 规范化后的行文本`。行号会随其上方任意一次编辑而腐坏
  （T-55），因此它不是键的一部分。
* **冻结意味着只能收缩。** 没有对应记录的耦合会以 **NEW** 失败；匹配不到任何东西的记录会以 **STALE**
  失败。因此删除记录就是退役一条耦合的方式 —— 在退役它的那次提交里有意为之 —— 而这个集合永远不会漂移
  成一句无人背书的话。
* **冻结集合为 14 条**，另有 47 条豁免的适配器 import，均为 2026-10-02 实测。
* **两个方向都被证明。** `--self-test` 会用一棵夹具树种下每条规则必须接受或拒绝的形态（14 条手臂）；真实
  band 则用真实清单扫描：种下违例时为红，树保持现状时为绿。
* **盲区一律被声明，绝不静默** —— 即
  `packages/mpd-dsh-adapter-plugin/test/no-direct-team-access.test.ts` 立下的纪律：被扫描 `src/` 下的
  非 `.ts` 文件打印为 NOT COVERED；首参为常量的 `ctx.provide(...)` 打印为 NOT STATICALLY READABLE；已退役
  主体的 `lib/` 树打印为 DECLARED OUT OF BAND 并附实时文件数（55 个文件），使这项排除是被测量的，而不是
  被假定的。

在有意且经过评审的改动之后，用
`bun packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts --print-inventory`
（只读）重新生成清单。

## 7. 本契约不声明什么

* **它不声明没有耦合。** 它声明的是：耦合被枚举、被计数，并且在收缩。
* **它不覆盖 TUI 平面的 Web 服务耦合。** `betterSidebar`、`shortcuts`、`locale`、`configForms` 与
  `sidebarRightTabs` 是另一份、另行冻结的清单，并附具名的后续适配器（计划 A2.3）；DSH-TUI 平面自身的
  收敛是计划 A2.2。
* **它不改动 QA 探针。** `packages/mpd-qa-roles-probe/src/index.ts` 仍在字面量地写
  `["agentPresets", "tools"]`。它是一个仅用于 QA 的探针，不属于本波次任何泳道，因此原样保留并在此点名，
  而不是被悄悄留下。
* **它是静态门禁。** 经由变量、经由 re-export 桶文件、或经由动态计算的规格符路由的耦合，行扫描看不见；
  「不可读的 provide」那一栏点出了该边界中门禁实际能观察到的那部分。
