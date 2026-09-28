# mpd-ext-plugin — MPD 扩展接口

[English](./README.md)

`mpd-ext-plugin` 是 `@mpd-dsh/mpd` 发行包的扩展接口：通过一份冻结的契约，让插件包——甚至只是一个普通目录——在不改动核心发行包的前提下贡献 **技能（skills）**、**流程（flows）**、**MCP 服务器** 与 **角色（roles）**。加载器行 id：`mpd-ext`；Cordis 服务：`mpdExtensions`。

## 它新增了什么，以及本来就能用的路径

一个插件包**本来就可以**零改动地为本发行包贡献能力：任何自带 `dsh.bundle.patch` 的包都会作为第二层 bundle 加入加载器（`dsh plugin add <pkg>`）；如果它自带 `dsh-mcp-client` 行，就自动获得 MCP 命名、重连、分页、schema 回滚与释放。这就是**安装面路径（install-plane path）**，它始终是一等公民——本插件并不取代它。

本插件在其之上新增四件事：

1. **冻结契约**（`src/sdk.ts`）：所有贡献者用同一种方式声明能力，并用同一套校验、命名空间与失败策略；
2. **数据面**：包含 `mpd-ext.json` 及其资源的目录——无需打包、无需 `dsh plugin add`、无需改 profile；
3. **流程（flows）**：以 JSON 声明的过程，渲染成内存中的技能文档（因为 harness 本身没有 flow 接口）；
4. **运行时 stdio MCP 桥**：用于那些不该变成 profile 补丁行的服务器——声明的服务器在 apply 时连接：并行、按 `connectTimeoutMs` 限时、绝不惰性连接（`connectExtensionMcpServers` 在 `apply` 中被 await；`src/index.ts`、`src/mcp.ts`），每台服务器的实时状态由 `mpd_ext_show` 报告。

## 契约

两种编写形式产生完全相同的注册表条目：

```jsonc
// 代码面：ctx.get("mpdExtensions")?.register(descriptor, { root })
// 数据面：<root>/mpd-ext.json —— 该目录本身就是 root
{
  "apiVersion": 1,                       // 必填，必须等于 1
  "id": "authoring-flows",                   // 必填，^[a-z0-9][a-z0-9-]{0,63}$
  "description": "面向变更的编写流程",
  "enabled": true,                       // 默认 true
  "contributes": {
    "skills": [{ "root": "skills", "rank": 300 }],
    "flows":  [{ "dir": "flows",  "rank": 300 }],
    "mcp":    [{ "serverName": "lint-mcp", "transport": "stdio", "command": "node",
                 "args": ["server.js"], "env": { "K": "V" }, "cwd": ".",
                 "toolCallTimeoutMs": 60000, "connectTimeoutMs": 10000 }],
    "roles":  [{ "name": "Code Reviewer", "description": "…", "readonly": true,
                 "persona": "personas/code-reviewer.md",
                 "provider": "deepseek-official", "model": "deepseek-v4-flash" }]
  }
}
```

真正被强制执行的规则（不只是文档约定）：

- **任何位置的未知键都会按条目被拒绝并记录**在该扩展上。本仓库实测过相反方向的失效模式（某 schema 会静默保留未知键，于是改名的键被接受却什么也不做）；本校验器不会重蹈覆辙。
- `origin`、`plane` 与加载结果是**注册表元数据，绝不是作者输入**——在描述符里写 `origin` 或 `plane` 会作为未知键被拒绝。
- 所有资源引用都相对于扩展根目录；绝对路径与 `..` 越界会被拒绝。任何扩展都无法访问自己根目录之外的内容。
- `rank` 必须显式（默认 **300**，即 `custom` 档）。完整梯度（同一层内数值越小越优先）：`100` project-dsh < `200` project-agents < `250` runtime < `300` custom < `400` user-dsh < `500` user-agents < `600` bundled。
- 流程 id 必须满足**技能名语法**（`^[a-z0-9]+(?:-[a-z0-9]+)*$`）——描述符 id 语法更宽松，因此像 `a--b` 这样的 id 会按文件被明确拒绝。
- **角色默认值**：`description` 默认 `""`，`readonly` 默认 `false`，且 `provider`/`model` 必须**成对**提供——只给一半会按条目被拒绝。MCP 条目默认 `args: []`、`env: {}`、`cwd: "."`、`toolCallTimeoutMs: 60000`、`connectTimeoutMs: 10000`。

## 共享的 frontmatter 解析器

skill frontmatter 的读取并不是本包私有的。`src/skill-frontmatter.ts` 是语料所用那套刻意精简的
YAML 子集（顶层标量、一层嵌套映射、可选块标量）以及 `stringField` / `frontmatterBoolean` /
`parseInvocation` 读取逻辑的唯一实现——而 `mpd-bootstrap-plugin` 为自己的语料消费同一个模块。

共享本身就是重点：bundle 语料与扩展语料是读取同一文件格式的两个面，而**解析器**存在两份副本，
正是两者开始接受不同文档的起点。该子集由
`packages/mpd-bootstrap-plugin/test/bootstrap.test.ts` 对每一个随包发布的 `SKILL.md` 钉住。

## 三个根目录，两种生命周期

| 根目录 | 生命周期 | 可贡献的种类 |
|---|---|---|
| `<会话工作区>/.mpd/extensions/*/mpd-ext.json` | **每次调用**解析——工具走 `dsh.workspaceRoot(exec)`，技能面走 harness 自己的 `provider.list({ cwd })` | **仅 skills + flows** |
| `~/.mpd/extensions/*/mpd-ext.json` | 宿主级，在 apply 时发现 | skills、flows、mcp、roles |
| `<bundle>/extensions/*/mpd-ext.json` | 宿主级，在 apply 时发现 | skills、flows、mcp、roles |

这个划分是被 harness 强制的：工具与 provider 注册是进程级的、没有会话作用域，因此无法表达“仅本会话”的能力。**项目级 manifest 若声明 `mcp` 或 `roles`，会按条目被明确拒绝**，理由为：

> project-level extensions may contribute skills and flows only: tool and provider registration is process-global and cannot be scoped to a session

同 id 的发现优先级为 **project → user → bundle**（先到者胜）。被遮蔽的条目由 `mpd_ext_list` 报告——既不致命，也不静默。

## 工具

| 工具 | 用途 |
|---|---|
| `mpd_ext_list` | 列出全部扩展：id、origin、plane、root、有效启用状态、贡献数量、声明的技能名里有哪些真的被 harness 目录**服务**、按条目错误、待实现种类、被遮蔽的重复 id 与被整体拒绝的 manifest |
| `mpd_ext_show` | 查看单个扩展的完整信息：描述符（**`env` 值已脱敏**）、解析出的根目录、技能/流程/角色名及其服务校验、MCP 服务器及状态、错误列表 |
| `mpd_flow_list` | 列出全部流程：id、标题、whenToUse、步骤数、所属扩展、是否可加载 |
| `mpd_flow_show` | 展示单个流程的完整过程（步骤、工具提示、期望输出） |

**v1 没有 `mpd_ext_reload`。** 释放并重新注册 provider、工具与子进程本身是一套带独立故障类的状态机，而且插件模块的改动本来就不会热重载——**诚实的重载就是重启**。

## 配置（`.mpd/mpd.jsonc`）

```jsonc
{
  "extensions": {
    "enable": ["authoring-flows"],           // 强制启用
    "disable": ["noisy-experiment"],     // 强制禁用（优先于 enable）
    "mcp": { "enabled": true, "connectTimeoutMs": 10000, "toolCallTimeoutMs": 60000 }
  }
}
```

配置在使用时**惰性读取** `mpdConfig` 服务——绝不在 apply 时快照。

**已声明的 v1 限制：`extensions.*` 是进程级的。** `mpdConfig` 从 `<进程工作区>/.mpd/mpd.jsonc` 与 `$DSH_HOME/mpd.jsonc` 解析它，因此它**不具备会话作用域**，项目级的 `enable`/`disable` 不是“每会话开关”。我们刻意不通过“每次技能快照都调用 `mpdConfig.reload(exec)`”来掩盖这一点：每次快照都改写共享配置缓存，会让技能 provider 的视图与工具的视图互相矛盾，这比一条写清楚的限制更糟。`enable`/`disable` 只过滤**被提供的内容**，绝不会阻断注册，因此被禁用的扩展不会影响其他任何东西。`mpdConfig` 缺失或出错时退化为上述默认值；并刻意不提供“由配置声明的发现根目录”列表。

## 扩展开发者

- 从已安装的发行包导入 SDK：
  `import { defineExtension } from "@mpd-dsh/mpd/packages/mpd-ext-plugin/dist/sdk.js"`。
  同一份机器可读契约（`MPD_EXT_CONTRACT`）同时支撑运行时校验器、工具与开发者 CLI——永远不存在第二份事实来源。
- **技能（skills）** 根目录下是直接子目录，每个子目录含 `SKILL.md`（YAML frontmatter：`name` 满足技能名语法、非空 `description`，可选 `whenToUse`、`user-invocable`、`disable-model-invocation`）。
- **流程（flows）** 目录下是 `*.json` 文档：
  `{ "id", "title", "description", "whenToUse?", "steps": [{ "title", "detail?", "tool?", "output?" }] }`。
  流程以技能候选（skill candidate）的形式提供，因此 `mpd_flow_list` 与技能目录看到的是同一件事。

## 失败策略（强制）

扩展、它的某个条目、某个流程文件、某台 MCP 服务器或某个角色都可以失败，而**不影响**其他任何东西：失败会附带一行原因被记录，并由 `mpd_ext_list` / `mpd_ext_show` 呈现。本插件不会让异常抛出 `apply`，任何失败也不会中止其他扩展的激活。有三处接口需要显式护栏，且都已具备：技能 provider（一个畸形候选会破坏每个会话的 pre-step，因此每个候选都会被预校验，违规者按条目**跳过并告警**）、技能 provider 注册（重名会抛异常，因此名字在构造上唯一且注册被包裹）、MCP 工具代际切换（部分代际由 `src/mcp.ts` 的两阶段 fetch/swap 完整回滚）——三处护栏在 v1 中均已落地。

第三方 schema 遵循两条不同的规则，且都不会改写作者的 schema：MCP 工具的 `inputSchema` 会被投影到 harness 子集，且**根会被归一化到 object**（工具调用携带的永远是一个参数对象）；而超出子集的 `outputSchema` 只让该工具失去 **schema**、不会失去工具本身——它会在没有 `structuredContent` 的情况下注册并记录原因，这正是 harness 自带 `supportedOutputSchema` 的姿态。只有连**参数**都无法描述的工具才会被跳过。

## 状态与已记录的 v1 限制

- **与更低 rank 的 provider 同名的技能会被其遮蔽。** harness 会按 rank 告警并丢弃落败的候选。这是正确的优先级行为（project-dsh 100、project-agents 200、runtime 250 都高于我们默认的 300），不是错误——而且它不再不可见：两个**扩展**之间的相撞会标注在落败方（其载入错误里出现 `skill surface:`，写明赢家与双方 rank），两个工具还会把每个声明拿去与 harness 自身的目录（`ctx.skills.list`）比对，报成 `served` / `notServed`。这次目录读取是唯一能看见**非扩展** provider（语料库、用户技能根）投下遮蔽的方式；读取失败时报告会给出 `checked: false` 与原因，而不是下断言。
- **两种宿主级种类在 v1 中均已落地。** 声明的 `mcp` 服务器在 apply 时连接（`connectExtensionMcpServers`，`src/mcp.ts`），`mpd_ext_show` 报告每台服务器的状态（`connecting` / `connected` / `unavailable` / `failed` / `disabled`），失败时还附上截断后的子进程 stderr 片段——只有当服务器不是 `connected` 时才会保留一条 `pending` 记录。声明的 role 由 `mpd-roles-plugin` **每次调用**解析（`extensionRoles`），因此 `mpd_roles_list` 会以命名空间 id `ext-<extension-id>-<slug>` 列出它，`mpd_role_spawn` 也能启动它。项目级 `mcp` 或 `roles` 条目仍按条目被拒绝。
- 仅 stdio MCP；仅 JSON 流程文件（YAML 为后续项）；无 MCP resources/prompts；无 GUI 面板；无市场/注册表/远程下载/版本求解；扩展不能贡献 agent preset；扩展角色不会成为 agent-teams 队友（该成员列表是静态补丁配置）。

## 测试

```sh
bun test packages/mpd-ext-plugin
bun run typecheck
bun build packages/mpd-ext-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/index.js
```
