# 开发指南

**中文** | [English](development.md)

如何构建、测试、QA、打包与发布本仓库。

## 1. 仓库布局

```
├── AGENTS.md              约束手册（先读）
├── README.md / docs/      公开概览 + 本套文档（docs/index.md 为中心）
├── package.json           根脚本（workspaces: packages/*）
├── tsconfig.json          根 tsgo 配置（覆盖 packages/*/src/**/*.ts）
├── VENDOR_LOCK.json       上游 commit/version/stats + 资产指纹
├── scripts/
│   ├── pack-mpd.mjs       组装 dist/mpd-package/（Plan D bundle）
│   ├── build-mpd-client.mjs  组合合并 web client（client.js）
│   ├── build-mcp.mjs      ast-grep/git-bash/lsp MCP 服务器离线构建
│   ├── vendor-agent-teams.mjs  物化**保留（未挂载）**的 agent-teams server closure（_deps/）
│   ├── install-profile.mjs    旧式安装器（默认 dry-run；--dsh-home 供 QA）
│   ├── mpd-ext.mjs        扩展开发者 CLI：validate / scaffold / list / --self-test
│   ├── bootstrap.mjs      preflight + vendor 检查（P0 时代保留为检查项）
│   ├── verify-vendor.mjs  阻塞性 vendor 门禁
│   └── lib/repo.mjs       共享原语（repoRootFrom、readJson），所有脚本都引用
├── packages/              一个包一个插件（src/ + dist/ + README.md）
├── extensions/            bundle 自带的扩展发现根目录 + 默认禁用的参考扩展
├── skills/                移植的 skill 语料 + dsh-qa（QA skill）
├── tests/                 QA overlays + golden fixtures
└── evidence/              <domain>/<slug>/<timestamp>/{result.json, output.log}
```

## 2. 构建

每个插件（优先零运行时依赖）：

```bash
bun build packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js
```

提交进仓库的 `dist/` 字节本身就是构建产物：`bun run verify:dist` 会把每个 `packages/*/src` 入口
在临时目录中重建两次并与已提交文件逐字节比较，因此源码改动与其重建必须放在同一个提交里。
构建工具链记录在 `package.json` 的 `buildToolchain` 字段（`bun@1.4.2`）：bun 小版本不同会改写注入的
helper 前导代码与压缩器变量名——在固定版本上重建字节完全一致，而在版本漂移时会点亮 `verify:dist`
以及 `packages/mpd-ext-plugin/test/adapter-identity.test.ts`、
`packages/mpd-roles-plugin/test/adapter-identity.test.ts` 的 F1 断言，但语义上并无变化。
然后，对 bundle：

```bash
node scripts/build-mpd-client.mjs   # 重新生成 packages/mpd-bundle-plugin/client.js（agent-teams client 变更后）
node scripts/pack-mpd.mjs          # 仅发布用：重新生成可迁移的 dist/mpd-package/
```

本地安装不需要打包：仓库根 manifest **就是** bundle 包，在仓库根执行 `dsh plugin add .` 即可装好全部内容；
改完代码后重建对应包的 `dist/` 并重启 dsh 即可。安装前请先把仓库依赖落到本地（`bun install`）：
manifest 声明了一个外部运行时依赖 `dsh-better-sidebar`（承载 mpd 两个标签页的社区侧边栏宿主），
而检出目录安装读取的正是本仓库。如果它的传递依赖 `node-pty` 所需的 `node-gyp` 不可用，可以用
`bun add dsh-better-sidebar@0.19.0-alpha.1 --ignore-scripts` 跳过构建脚本安装（只有侧边栏的终端
面板会降级）。打包安装则由 pnpm 负责。

MCP 服务器由 `node scripts/build-mcp.mjs` 构建（从仓库内源码离线构建）。

**扩展资产不需要构建。** `packages/mpd-ext-plugin` 是一个普通插件包（改源码后与其他包一样重建
`dist/`），而*使用*该接口的包以普通目录形式放在 `extensions/<id>/`（内含 `mpd-ext.json` 清单与
各自的资产）—— 没有编译步骤，开发者 CLI 直接从 TypeScript 源码运行（`bun scripts/mpd-ext.mjs …`），
因此它绝不会校验一份陈旧的规则副本。在**打包**产物内没有源码，CLI 于是回退到打包器生成的已编译校验器
入口（`packages/mpd-ext-plugin/dist/validator.js`）：`validate`、`scaffold`、`list`、`--self-test` 与
`--validator` 都能从 `dist/mpd-package/` 运行（bun 或纯 node），其中 `--validator` 会打印本次运行实际
加载了哪个入口（T-51）。**新增** 的插件包还必须加入 `scripts/pack-mpd.mjs` 内的
`PLUGIN_PKGS` 允许列表，否则打包安装会缺少它，并在启动时报 `ERR_MODULE_NOT_FOUND`。

**Harness 接缝（约束性规则，AGENTS.md §6）：** 插件行不得直接调用 `ctx.tools`、
`ctx.subagents`、`ctx.skills`、`ctx.agentPresets`。所有行都经由
`packages/mpd-dsh-adapter-plugin`（`const dsh = resolveDshAdapter(ctx)`；该包同时在 `src/shared.ts`
中承载 bundle 的纯共享工具），
因此 Harness 改变某个接缝时只需改这一个包：编辑
`packages/mpd-dsh-adapter-plugin/src/index.ts`、重新构建、重新 pack——消费方无需改动即可
拿到新的已挂载实例。它的单元测试（`packages/mpd-dsh-adapter-plugin/test/adapter.test.ts`）
同时伪造“完整 Harness”和“空 Harness”，是新增接缝最快的入口。

## 3. 测试

```bash
bun run typecheck                        # 根 tsgo --noEmit（覆盖所有包）
bun test packages                        # 每包单元测试（mock ctx 驱动工具）
bun test packages/<pkg>                  # 单包
```

测试约定（见 `packages/mpd-roles-plugin/test/roles.test.ts`、
`packages/mpd-workmate-plugin/test/workmate.test.ts`）：`makePlugin()` 构造 mock
`ctx`（`tools.register` 捕获定义、`subagents.start` 返回 stub 结果、`provide` 记录服务、
`get` 返回 fixtures）并驱动 `apply(ctx)` —— 纯离线，不需要 DSH 二进制或模型。
涉状态的测试把 `process.env.HOME` 设为临时目录（bun 缓存 `os.homedir()`，所以插件
直接读 `$HOME`）。

## 4. QA（真实 DSH 启动，严格隔离）

QA skill 是 `skills/dsh-qa`（`SKILL.md`）。每个 case 脚本都带 `--self-test`（离线）
加一个隔离的真实启动；证据进 `evidence/<domain>/<slug>/<timestamp>/`。

| Case | 证明什么 | 运行方式（在已批准的权限上下文里） |
|---|---|---|
| `mount-assert` | bundle 行在 `--dump-config` 中出现/缺失 | `bun run test:qa`（全部 self-test） |
| `preset-register` | mpd 预设从 bundle 自己的 `presets/mpd.patch.yml` **PRESET 行**解析（无 `$DSH_HOME/.agent-presets` 副本）+ roster 提供 11 角色 | `node skills/dsh-qa/scripts/preset-register.mjs` |
| `bundle-lifecycle` | 从检出目录一条命令（`dsh plugin add <仓库根>`，无打包步骤）整体安装 → 真实启动从已安装 bundle 供给 preset + skills，并验证 Harness 适配器（`ADAPTER_SEAMS`、`ADAPTER_TOOL_CALL=ok`）→ `dsh plugin remove` 无残留 | `node skills/dsh-qa/scripts/bundle-lifecycle.mjs` |
| `skill-catalog-probe` | 已安装 bundle 供给技能目录（18 个 bundled 技能，fixture 可加载），且无 `$DSH_HOME/skills` 副本 | `node skills/dsh-qa/scripts/skill-catalog-probe.mjs` |
| `relocate-smoke` | 迁移后的 bundle 供给 preset + 语料库，无 dev 路径泄漏、无 home 副本 | `node skills/dsh-qa/scripts/relocate-smoke.mjs` |
| `workmate-library` | 针对沙箱 HOME 的 init→list→spawn→reflect→match；self-test 同时钉住重命名/删除 host 路由、服务面与 §D reason 矩阵 | `node skills/dsh-qa/scripts/workmate-library.mjs` |
| `workmate-team-member` | workmate 实例参与一次真实 headless 团队运行，并在之后自己执行 `mpd_workmate_reflect`。注意：workmate 的 persona/记忆只能通过 `spawn_teammate` 的**提示词**进入队友 —— 本 case 当初针对的自动 `memberPersona` 注入属于已退役的内置插件 | `node skills/dsh-qa/scripts/workmate-team-member.mjs` |
| `web-client-adapt` | `@mpd-dsh/mpd` 的 boot-graph client entry + client.js id + workmate host 路由（含 client 的重命名/删除 URL） | `node skills/dsh-qa/scripts/web-client-adapt.mjs` |
| `preset-conformance` | 每一个 Harness 自有行配置（preset + bundle patch + QA overlay）都与**已安装**的 Harness schema 相符，`mpd` preset 的行集合与已安装 `standard` preset 完全一致，并且以 `agentPreset: "mpd"` 真实创建的会话确实**挂载成功** —— 并带一个必须失败的负向对照 | `node skills/dsh-qa/scripts/preset-conformance.mjs` |
| `tui-mount` | **真实** dsh-TUI 启动：bundle 作为第三层 patch 层（`dsh.profile.bundles` = [dsh-base, dsh-tui, @mpd-dsh/mpd]）、`mpd-tui` 行已被组合、原始日志中**零**条 apply-crash 特征、状态行已渲染，且该次启动自己产生的会话记录携带 `agentPreset: "mpd"` | `bun skills/dsh-qa/scripts/tui-mount.mjs` |
| `tui-panels` | 七个需激活的 TUI 界面**确实渲染**（状态行、`/mpd status`、`/mpd` 补全树、看板场景、renderer 行、带桥接+重启披露的 `/settings` 分区，以及受管对话框）—— 渲染不出内容的界面直接判该 lane FAIL；该 lane 还证明 `/mpd` 从未到达模型，并在同一批 pane 上用一条不可能成立的期望重跑引擎作为负向对照 | `bun skills/dsh-qa/scripts/tui-panels.mjs` |
| `tui-admission` | 用**宿主自己的**固定版准入算法检验 bundle 级 `dsh-plugin.json`：vendored `@dsh-std/manifest` 解析 + 投影 + 宿主的 `validatePlugin` + 五态 `negotiate`，再在真实 TUI 内驱动宿主的 `/plugins check`；spec 数据根必须先**解析成功**，并记录三条负向对照 | `bun skills/dsh-qa/scripts/tui-admission.mjs` |
| `tui-distribution` | 用 dsh-distribution 协议**自带**的一致性 CLI（在沙箱内拷贝协议仓库）校验 `dsh-distribution.json`；构建无法完成时逐字记录具体阻塞点，并把该描述符标记为**未完全验证**，而不是近似成通过 | `bun skills/dsh-qa/scripts/tui-distribution.mjs` |
| `tui-spec-conformance` | 用**宿主自己**的固定版一致性套件检验我们的 manifest 与捕获到的 host descriptor，记录套件 revision 与每一份输入摘要，并重新测量载荷的三方 sha256 一致性 | `bun skills/dsh-qa/scripts/tui-spec-conformance.mjs` |
| `tui-settings-bridge` | settings 桥接的 TUI 分支，判定对象是**构建后的字节**：每条 `/settings` 提示都带桥接后的真实披露（`a save writes <workspace>/.mpd/mpd.jsonc … after a restart`）、桥接前那句 "not bridged" 已**删除**、`no-live-session` 运行时提示既存在又已接入状态行组合，且 TUI dist **零**文件系统写入 | `bun skills/dsh-qa/scripts/tui-settings-bridge.mjs` |

| `agent-teams-adopt`（历史 C1 —— 已**退役**的内置主体；团队路径现在跑在官方插件上） | MIT 声明 + 采纳接线 | `node skills/dsh-qa/scripts/agent-teams-adopt.mjs` |
| `extension-lifecycle`（**新增**） | 在**真实挂载启动**上验证扩展接口（沙箱 `DSH_HOME` + `HOME` + 会话 cwd；各行均从**本检出**组合，且模型步骤由本地 OpenAI 形状的 stub 应答，因此不需要 provider 凭据）：放进 `<sandbox-ws>/.mpd/extensions/` 的数据面扩展出现在 `mpd_ext_list` 中、它的 flow 可加载、它的 role 可 spawn；每一种坏扩展都不会影响正常扩展，且同一主机上两个 cwd 不同的会话只看到各自工作区的工程扩展 | `bun skills/dsh-qa/scripts/extension-lifecycle.mjs` |
| `extension-mcp-bridge`（**新增**） | 在同一套**真实挂载启动** + stub 配方上验证运行时 stdio MCP 桥：声明的服务器在两次工具列表读取中都出现 `mcp__<server>__<tool>`，且真实工具调用成功；dead/hang/schema/dup 四个分支证明单台服务器失败不会影响其他服务器 | `bun skills/dsh-qa/scripts/extension-mcp-bridge.mjs` |

两个 case 都引用同一个共享证据辅助模块 `skills/dsh-qa/scripts/extension-isolation.mjs`——本地 OpenAI 形状的 stub 模型、沙箱/启动配方、会话证据读取器，以及多会话隔离分支。它**故意不是一个 case 行**（`skills/dsh-qa/SKILL.md` 原文如此）：它**没有 lane 模式**——不带 `--self-test` 调用时它什么都不做并以 0 退出——它唯一的离线证明是自身的 `--self-test`，即 `bun skills/dsh-qa/scripts/extension-isolation.mjs --self-test`；该自检只校验 stub 协议、描述符契约、随包示例与启动配方，不启动任何会话。这也是它没有被列入 `package.json` 的 `test:qa:all` case 枚举的原因。

两个 npm 脚本，两条通道（t8）：`bun run test:qa` 运行**每个** case 的离线 `--self-test`；
`bun run test:qa:all` 运行“重量/联机子集”的**真实通道**，其成员在 `package.json` 中按名字逐一列举
（判据：该 case 需要真实的 headless dsh 启动和/或真实 provider）。显式白名单保证新 case 不会被静默当作重量用例。

**在沙箱内运行实时 lane。** 两个环境事实决定了 lane 到底有没有真的测到东西。(1) `BUN_TMPDIR` 必须指向工作区
内部（`BUN_TMPDIR="$PWD/.bun-tmp"`）：当 `$BUN_INSTALL`（`~/.bun`）不在沙箱可写集合内时，任何会 spawn `bun`
的 lane 都会立刻以 `EROFS accessing temporary directory` 死掉，case 在几毫秒内报 FAIL —— 这正是"根本没跑到断言"
的样子。(2) 把某个脚本或插件 `src/` **复制**进临时树的 case，必须同时把该副本会 import 的共享模块（`scripts/lib/`，
或同级的 `packages/mpd-dsh-adapter-plugin/src/`）一起 stage，否则该分支会以 `ERR_MODULE_NOT_FOUND` 变红，而原因
与它要测的东西无关；脚本形态的 helper 是
`packages/mpd-agent-teams-plugin/self-fix-tests/scratch-scripts.mjs` 里的 `stageScript()`。

**TUI lane 与 TUI 打包路径。** 上面六个 DSH-TUI case 照例带离线 `--self-test`，但它们的**实时**分支需要
真实终端：stdout 不是 TTY 时 `dsh-tui` 拒绝启动，所以它们在 tmux 中驱动界面并抓取 pane —— 这也是它们不在
`bun run test:qa` 的 self-test 扫描范围之内的原因（`docs/tui.zh-CN.md` §2）。打包步骤同样覆盖 TUI 形态：
`node scripts/pack-mpd.mjs` 会把 `packages/mpd-tui-plugin/{dist/**, README.md, README.zh-CN.md,
themes/mpd-tui.json, skills/mpd-tui/SKILL.md}` 写进 `dist/mpd-package/`，并把打包后 patch 里的 `mpd-tui`
行保持为可解析的 specifier `@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js`；安装仍是普通那一条
（`dsh plugin --profile dsh-tui add <repo | dist/mpd-package>`）。

**TUI 版本的 NOT-CLAIMED 纪律。** 本环境既没有 TTY 也没有浏览器，因此渲染相关的验收标准一律记为
**not-claimed**，绝不写成 "passed"：清单在 `docs/tui.zh-CN.md` §10，而每个 lane 会记录它无法驱动的
限制（击键分支、浏览器渲染），而不是用代理指标顶替。格式或解析器校验通过不等于安全或行为结论 ——
兼容性、验证级别与限制必须分开陈述。

**QA 硬规则**（AGENTS.md §7）：沙箱 `DSH_HOME=<mktemp>`；只复制一次凭据；断言沙箱
路径；绝不碰真实 `~/.dsh`；workmate 类 case 额外沙箱化 `HOME`（`~/.mpd/workmate`
是用户批准的 HOME 例外）。

**live 模型步骤需要已配置的 provider 路由** —— QA 用机器的 DSH 凭据启动。本机就是
在 case 命令里 export `DEEPSEEK_API_KEY`（运行的 DSH host 从 `~/.bashrc` 继承；
shell 子进程没有 —— 在 case 命令里显式导出）。

**Web case**：当无法访问 pnpm store 时用手工拷贝流程（把 `dist/mpd-package/` 复制到
沙箱 profile 的 `node_modules/@mpd-dsh/mpd`）；打包的 `dsh plugin add` 流程是主方式。

## 5. 门禁（AGENTS.md §4）

| 门禁 | 命令 |
|---|---|
| Vendor | `node scripts/verify-vendor.mjs`（需 `MPD_UPSTREAM_ROOT`） |
| 测试 | `bun test packages` + `bun run typecheck` |
| QA self-tests | `bun run test:qa` + 每个 case `--self-test` |
| QA 真实 case | `node skills/dsh-qa/scripts/<case>.mjs` |
| 安装器 | `node scripts/install-profile.mjs --dry-run` / `--self-test` |
| 启动检查（MOUNT） | 在隔离 `DSH_HOME` + 沙箱 `HOME` 中真正 apply 各行的启动：`bun skills/dsh-qa/scripts/bundle-lifecycle.mjs`（host 行）/ `node skills/dsh-qa/scripts/preset-conformance.mjs`（`mpd` preset 的 standing 挂载）。`node scripts/dump-config.mjs --profile <p>`（仓库包装器，自身就会打印该警告）只组合行，**不是**该门禁（AGENTS.md §4） |
| 扩展 CLI | `bun scripts/mpd-ext.mjs --self-test`（离线）+ `bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example`（退出码 0；故意写坏的扩展必须退出码 1 并逐条目报错） |

门禁没有磁盘上的证据 = 变更不算完成。

## 6. 发布流程

1. 先把本次发布的改动落到 `dev` —— `feature/<slug>` / `fix/<slug>` 分支，每个分支连同证据一起提交。
   `master` 只接受发布合并。
2. 从 `dev` 切出 `release/vX.Y.Z`；更新 `package.json` 中的版本（以及本套文档中出现的任何版本引用），
   并写下 changelog 条目。
3. 跑完整门禁扫描，全部为绿且证据在盘：`node scripts/verify-vendor.mjs`、`bun run typecheck`、
   `bun test packages`、`bun run test:qa`（每个 case 的离线 `--self-test`）、真实通道子集
   `bun run test:qa:all`，以及启动检查（§5：`preset-conformance` 加挂载证明 —— 绝不能只看
   `--dump-config`）。
4. **`VENDOR_LOCK.json` 配对规则**：`skills/**` 的改动会使语料 `treeSha` 失效，而重新钉住必须与
   该改动落在**同一个提交**里。`skills/**` 每一波只有一个写入者，因此一波只有一次重新钉住 —— 请
   核对它确实存在，且没有任何 `skills/**` 改动是在缺少它的情况下提交的。
5. 打包：`npm run pack`（`node scripts/pack-mpd.mjs`）组装可迁移的 `dist/mpd-package/`。请核对打包
   产物确实包含每个插件的 dist、`extensions/` 资产、脚手架 `templates/`、`docs/` 文档配对
   （`node scripts/verify-docs-parity.mjs --root dist/mpd-package`）以及 `scripts/mpd-ext.mjs`（漏掉一个
   `PLUGIN_PKGS` 条目会以退出码 0 静默通过，却在启动时崩掉）。自 2026-09-17 的打包变更起，这些不再靠
   肉眼看：`node scripts/verify-pack-closure.mjs` 会断言打包器的根资产表，并在产物存在时断言每个已声明
   资产确实到达、`docs/`+`templates/`+`agent-references/` 与源目录逐文件一致、三个具名参考文件
   （`index.md`、`troubleshooting.md`、`agent-teams-deltas.md`）都在、打包 manifest 的 `files`/`exports`
   与磁盘内容相符、以及 CLI 的已编译校验器入口存在。
6. 以 `--no-ff` 合并进 `master`，提交信息为 `release: vX.Y.Z …`，打附注标签
   （`git tag -a vX.Y.Z`），并推送 `master` + 标签（以及 `dev`）。

## 7. Git 模型

`master`（发布，仅合并）← `dev`（集成）← `feature/<slug>` / `fix/<slug>`。
提交：`<type>(<scope>): <summary>`；合并用 `--no-ff` + 描述性消息；永不 rebase 已发布
分支；修复要引用缺陷并带复现证据。

## 8. Vendor 与基线

- `scripts/vendor-agent-teams.mjs` 从 host 安装（`DSH_HOST_NM`）重新物化**保留（未挂载）**的
  agent-teams server 运行时闭包（`packages/mpd-agent-teams-plugin/_deps/`），把裸
  `@deepseek-ai/*` + `zod` 导入重写为相对路径 —— client bundle 保留裸导入（web app
  的 bundler 提供它们）。
- `VENDOR_LOCK.json` 钉住上游 commit/version + 资产指纹；`verify-vendor.mjs` 不匹配即
  阻塞。从不追上游 —— 基线变更需要专门分支 + 证据。

## 9. 常见坑（来自真实事故）

| 坑 | 修法 |
|---|---|
| bundle client 不出现在 web GUI | patch 必须含 `mpd-web-compat` 自引用行（`name: '@mpd-dsh/mpd'`）且 manifest 的 `main`/`exports["."]` 指向 mpd-bundle-plugin。用 `node scripts/build-mpd-client.mjs && node scripts/pack-mpd.mjs` 重生成 |
| `mpd_workmate_*` / `mpd_modelchain_resolve` 拿不到 `mpdRoles` | 在工具 execute 内惰性读服务（而不是 apply 时） |
| QA 启动失败 `ERR_SQLITE_ERROR unable to open database file` | pnpm store 在 workspace 外；用手工拷贝 web 流程或获批的更宽权限运行 |
| `os.homedir()` 忽略测试的 `HOME` | bun 缓存了它；插件应优先读 `process.env.HOME` |
| QA 证据含密钥 | 提交前扫描证据日志 |
| QA 里 workmate 写到真实 HOME | web/headless QA 一律以 `HOME=<sandbox>` 启动 |
