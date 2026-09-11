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
│   ├── vendor-agent-teams.mjs  物化采纳的 agent-teams server closure（_deps/）
│   ├── install-profile.mjs    旧式安装器（默认 dry-run；--dsh-home 供 QA）
│   ├── bootstrap.mjs      preflight + vendor 检查（P0 时代保留为检查项）
│   └── verify-vendor.mjs  阻塞性 vendor 门禁
├── packages/              一个包一个插件（src/ + dist/ + README.md）
├── skills/                移植的 skill 语料 + dsh-qa（QA skill）
├── tests/                 QA overlays + golden fixtures
└── evidence/              <domain>/<slug>/<timestamp>/{result.json, output.log}
```

## 2. 构建

每个插件（优先零运行时依赖）：

```bash
bun build packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js
```

然后，对 bundle：

```bash
node scripts/build-mpd-client.mjs   # 重新生成 packages/mpd-bundle-plugin/client.js（agent-teams client 变更后）
node scripts/pack-mpd.mjs          # 仅发布用：重新生成可迁移的 dist/mpd-package/
```

本地安装不需要打包：仓库根 manifest **就是** bundle 包，在仓库根执行 `dsh plugin add .` 即可装好全部内容；
改完代码后重建对应包的 `dist/` 并重启 dsh 即可。

MCP 服务器由 `node scripts/build-mcp.mjs` 构建（从仓库内源码离线构建）。

**Harness 接缝（约束性规则，AGENTS.md §6）：** 插件行不得直接调用 `ctx.tools`、
`ctx.subagents`、`ctx.skills`、`ctx.agentPresets`。所有行都经由
`packages/mpd-dsh-adapter-plugin`（`const dsh = ctx.get("mpdDsh") ?? createDshAdapter(ctx)`），
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
| `preset-register` | mpd 预设从 bundle 供给的根解析（无 `$DSH_HOME/.agent-presets` 副本）+ roster 提供 11 角色 | `node skills/dsh-qa/scripts/preset-register.mjs` |
| `bundle-lifecycle` | 从检出目录一条命令（`dsh plugin add <仓库根>`，无打包步骤）整体安装 → 真实启动从已安装 bundle 供给 preset + skills，并验证 Harness 适配器（`ADAPTER_SEAMS`、`ADAPTER_TOOL_CALL=ok`）→ `dsh plugin remove` 无残留 | `node skills/dsh-qa/scripts/bundle-lifecycle.mjs` |
| `skill-catalog-probe` | 已安装 bundle 供给技能目录（22 个 bundled 技能，fixture 可加载），且无 `$DSH_HOME/skills` 副本 | `node skills/dsh-qa/scripts/skill-catalog-probe.mjs` |
| `relocate-smoke` | 迁移后的 bundle 供给 preset + 语料库，无 dev 路径泄漏、无 home 副本 | `node skills/dsh-qa/scripts/relocate-smoke.mjs` |
| `team-route-rewire` | 暂存 bundle 安装 → agent-teams 行组合 → probe 启动 → web `/plugins/dsh-agent-teams/state` 200 | `node skills/dsh-qa/scripts/team-route-rewire.mjs` |
| `workmate-library` | 针对沙箱 HOME 的 init→list→spawn→reflect→match；self-test 同时钉住重命名/删除 host 路由、服务面与 §D reason 矩阵 | `node skills/dsh-qa/scripts/workmate-library.mjs` |
| `workmate-team-member` | workmate 支撑成员注入 + 真实团队中的自我反思 | `node skills/dsh-qa/scripts/workmate-team-member.mjs` |
| `web-client-adapt` | `@mpd-dsh/mpd` 的 boot-graph client entry + client.js id + workmate host 路由（含 client 的重命名/删除 URL） | `node skills/dsh-qa/scripts/web-client-adapt.mjs` |
| `preset-conformance` | 每一个 Harness 自有行配置（preset + bundle patch + QA overlay）都与**已安装**的 Harness schema 相符，`mpd` preset 的行集合与已安装 `standard` preset 完全一致，并且以 `agentPreset: "mpd"` 真实创建的会话确实**挂载成功** —— 并带一个必须失败的负向对照 | `node skills/dsh-qa/scripts/preset-conformance.mjs` |
| `agent-teams-adopt`（历史 C1） | MIT 声明 + 采纳接线 | `node skills/dsh-qa/scripts/agent-teams-adopt.mjs` |

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
| 启动检查（MOUNT） | 在隔离 `DSH_HOME` + 沙箱 `HOME` 中真正 apply 各行的启动：`bun skills/dsh-qa/scripts/bundle-lifecycle.mjs`（host 行）/ `node skills/dsh-qa/scripts/preset-conformance.mjs`（`mpd` preset 的 standing 挂载）。`dsh --profile <p> --dump-config` 只组合行，**不是**该门禁（AGENTS.md §4） |

门禁没有磁盘上的证据 = 变更不算完成。

## 6. Git 模型

`master`（发布，仅合并）← `dev`（集成）← `feature/<slug>` / `fix/<slug>`。
提交：`<type>(<scope>): <summary>`；合并用 `--no-ff` + 描述性消息；永不 rebase 已发布
分支；修复要引用缺陷并带复现证据。

## 7. Vendor 与基线

- `scripts/vendor-agent-teams.mjs` 从 host 安装（`DSH_HOST_NM`）重新物化采纳的
  agent-teams server 运行时闭包（`packages/mpd-agent-teams-plugin/_deps/`），把裸
  `@deepseek-ai/*` + `zod` 导入重写为相对路径 —— client bundle 保留裸导入（web app
  的 bundler 提供它们）。
- `VENDOR_LOCK.json` 钉住上游 commit/version + 资产指纹；`verify-vendor.mjs` 不匹配即
  阻塞。从不追上游 —— 基线变更需要专门分支 + 证据。

## 8. 常见坑（来自真实事故）

| 坑 | 修法 |
|---|---|
| bundle client 不出现在 web GUI | patch 必须含 `mpd-web-compat` 自引用行（`name: '@mpd-dsh/mpd'`）且 manifest 的 `main`/`exports["."]` 指向 mpd-bundle-plugin。用 `node scripts/build-mpd-client.mjs && node scripts/pack-mpd.mjs` 重生成 |
| `mpd_workmate_*` / `mpd_modelchain_resolve` 拿不到 `mpdRoles` | 在工具 execute 内惰性读服务（而不是 apply 时） |
| QA 启动失败 `ERR_SQLITE_ERROR unable to open database file` | pnpm store 在 workspace 外；用手工拷贝 web 流程或获批的更宽权限运行 |
| `os.homedir()` 忽略测试的 `HOME` | bun 缓存了它；插件应优先读 `process.env.HOME` |
| QA 证据含密钥 | 提交前扫描证据日志 |
| QA 里 workmate 写到真实 HOME | web/headless QA 一律以 `HOME=<sandbox>` 启动 |
