# MPD 扩展 —— 开发者指南

**中文** | [English](./extensions.md)

本指南的英文原件为 `docs/extensions.md`（本文件 `docs/extensions.zh-CN.md` 是其简体中文版，内容一一对应）。

`@mpd-dsh/mpd` bundle 的扩展接口：通过一份**冻结契约**，让一个插件包——或者磁盘上的一个普通目录——在不改动核心 bundle 的前提下贡献 **skill**、**flow**、**MCP server** 与 **role**。Loader row id 为 `mpd-ext`，cordis service 为 `mpdExtensions`。

本指南面向希望加入 编写流程、HarmonyOS 移植流程、skill 包或 MCP server 的插件作者。下文每个示例都取自实际发布的代码（`packages/mpd-ext-plugin`、`extensions/mpd-ext-example`、`scripts/mpd-ext.mjs`），每条命令都按原样运行过——见 [§12](#12-本指南中的示例如何验证)。

---

## 1. 已经可行的事 —— 以及本接口新增了什么

一个插件包**本来就能**在零核心改动下为本 bundle 做出贡献：任何自带 `dsh.bundle.patch` 的包都会作为第二层 bundle layer 加入 loader（`dsh plugin add <package>` 会追加它），而自带 `dsh-mcp-client` row 的包可以免费获得 MCP 命名、重连、分页、schema 回滚与释放。

这就是**安装面路径**（install plane），它是一等公民，本接口**不**取代它。

| | 安装面（自带 `dsh.bundle.patch` 的包） | 扩展接口（本指南） |
|---|---|---|
| 你交付什么 | 一个带 patch layer 的 npm 形态包 | 一个含 `mpd-ext.json` 的目录，或一个调用 `register()` 的 plugin row |
| 谁来安装 | 用户执行 `dsh plugin --profile <p> add <package>` | 没人需要安装——manifest 文件从已知根目录被自动发现 |
| 可贡献什么 | patch row 能组合的一切（rows、MCP server、tool、preset） | skill、flow、MCP server（stdio）、role |
| 校验方式 | loader 自身的 row/schema 规则 | §3 的冻结契约，逐项校验 |
| 更新运行中的宿主 | 重装 + 重启 | 直接改 manifest；project plane 按调用重新读取 |

本接口在安装面之上新增四件事：

1. 一份**冻结契约**（`packages/mpd-ext-plugin/src/sdk.ts`），让每个贡献者以同一方式声明能力，并获得同一套校验、命名空间与失败策略；
2. **数据面**（data plane）——一个含 `mpd-ext.json` 及其资源的目录：无需打包、无需 `dsh plugin add`、无需改动 profile；
3. **flow**——声明式流程（JSON），被渲染成 skill 文档，因为 harness 自身没有 flow seam；
4. 一套**运行时 stdio MCP 桥**，用于那些不应成为 profile patch row 的 server（按项目或按用户目录的 server、无法重装 profile 的场景）。

选择经验：要交付的是一个带自有 row、preset 或自定义 tool 的一等包，就用**安装面**；要交付的是能力内容（skill、flow、辅助 MCP server、专家 role），且希望用户能按项目或按 home 目录直接放入，就用**扩展**。

## 2. 两种编写形态，一份契约

两种形态产出同一条 registry 记录，唯一差别是 `origin` 元数据（`"plugin"` | `"directory"`），而 `origin`/`plane` 永远不是作者输入。

**代码面（code plane）**——任何 plugin row 在自身 apply 时注册：

```ts
import { defineExtension } from "@mpd-dsh/mpd/packages/mpd-ext-plugin/dist/sdk.js"

// 在你插件自己的 apply 阶段执行；`root` 是你的资源所在目录
const ext = ctx.get("mpdExtensions")
ext?.register(
  defineExtension({
    apiVersion: 1,
    id: "authoring-flows",
    description: "Authoring flows for code changes, shipped by the authoring package",
    contributes: { skills: [{ root: "skills" }], flows: [{ dir: "flows" }] },
  }),
  { root: pkgRoot }, // 你的资源所在目录——请从自己的包位置解析，
                     // 例如 dirname(fileURLToPath(import.meta.url))
)
```

`defineExtension()` 只是给作者用的恒等辅助函数（提供类型、零运行时行为）；真正的调用是 `register(descriptor, { root })`。请**惰性**解析服务（`ctx.get`），绝不要写进 `inject`：在本 harness 中，声明了却未注册的服务是一个致命的 `pending` loader entry，而扩展 row 完全可能不存在。

**数据面（data plane）**——目录名即 root，内含一个 manifest 文件：

```text
~/.mpd/extensions/authoring-flows/
├── mpd-ext.json          # 描述符（root 由本文件所在目录定义）
├── skills/               # { "root": "skills" }
│   └── change-triage/SKILL.md
├── flows/                # { "dir": "flows" }
│   └── change-triage-flow.json
├── personas/             # { "roles": [{ "persona": "personas/…" }] }
│   └── code-reviewer.md
└── server.mjs            # { "mcp": [{ "command": "node", "args": ["server.mjs"] }] }
```

manifest 文件名固定为 `mpd-ext.json`（`MPD_EXT_CONTRACT.manifestFile`），且必须是严格 JSON——与 `.mpd/mpd.jsonc` 不同，manifest 不支持 JSONC 注释。

## 3. 描述符参考

下文每个键都取自机器可读的契约（`packages/mpd-ext-plugin/src/sdk.ts` 中的 `MPD_EXT_CONTRACT`），运行时校验器与开发者 CLI **共用**这份契约：校验器不会另写一套规则，因此任何未列出的键都是未知键，会被拒绝。

### 3.1 顶层

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `apiVersion` | number | **是** | — | 必须精确等于 `1`；其它取值会让整个扩展被拒绝 |
| `id` | string | **是** | — | 语法 `^[a-z0-9][a-z0-9-]{0,63}$`（1–64 字符，小写 ASCII、数字、连字符） |
| `description` | string | 否 | `""` | 由 `mpd_ext_list` / `mpd_ext_show` 展示 |
| `enabled` | boolean | 否 | `true` | 配置里的 `disable` 仍然优先于它（§4.3） |
| `contributes` | object | 否 | `{}` | 只允许下面四个键；其它键一律拒绝 |

**任何位置的未知键——顶层、`contributes` 内、任一条目内——都会逐项被拒绝并记录在该扩展上。** 这是刻意设计：本仓库已经实测过相反方向的失败模式（schema 静默保留未知键，于是被改名的选项被接受却毫无作用）。在这里，拼错一个键是响亮的。

### 3.2 `contributes`

| 键 | 条目类型 | 必填项字段 | 可选项字段（默认值） |
|---|---|---|---|
| `skills` | array | `root` | `rank`（`300`） |
| `flows` | array | `dir` | `rank`（`300`） |
| `mcp` | array | `serverName`、`transport`、`command` | `args`（`[]`）、`env`（`{}`）、`cwd`（`"."`）、`toolCallTimeoutMs`（`60000`）、`connectTimeoutMs`（`10000`） |
| `roles` | array | `name`、`persona` | `description`（`""`）、`readonly`（`false`）、`provider` + `model`（必须同时提供） |

`skills` 条目——一个目录，其**直接子目录**各自含一个 `SKILL.md`：

```json
{ "root": "skills", "rank": 300 }
```

`flows` 条目——一个存放 `*.json` flow 文档的目录（一个文件一个 flow）：

```json
{ "dir": "flows", "rank": 300 }
```

`mcp` 条目——一个 stdio MCP server（v1 不支持 HTTP/SSE）：

```json
{
  "serverName": "lint-mcp",
  "transport": "stdio",
  "command": "node",
  "args": ["server.js"],
  "env": { "PROJECT_ROOT": "." },
  "cwd": ".",
  "toolCallTimeoutMs": 60000,
  "connectTimeoutMs": 10000
}
```

`roles` 条目——名册中的一位专家：

```json
{
  "name": "Code Reviewer",
  "description": "Reviews a code change read-only before review.",
  "readonly": true,
  "persona": "personas/code-reviewer.md",
  "provider": "deepseek-official",
  "model": "deepseek-v4-flash"
}
```

### 3.3 语法与资源路径规则

| 取值 | 规则 | 来源 |
|---|---|---|
| 扩展 `id` | `^[a-z0-9][a-z0-9-]{0,63}$` | `MPD_EXT_CONTRACT.idPattern` |
| skill 名（frontmatter `name`）与 **flow id** | `^[a-z0-9]+(?:-[a-z0-9]+)*$` | `skillNamePattern`——flow id 必须满足这条**更严**的语法，因此 `a--b` 会被拒绝 |
| MCP `serverName` | `^[A-Za-z0-9_-]{1,32}$` | `serverNamePattern`（与 harness 的 `dsh-mcp-client` 常量一致） |
| 资源引用（`skills.root`、`flows.dir`、`roles.persona`） | 只能是扩展根目录相对路径 | 绝对路径与 `..` 逃逸会被逐项拒绝——没有任何扩展能伸手到自己的 root 之外 |

`rank` 必须显式声明，只对 `skills` 与 `flows` 有意义。完整阶梯，**同层内数值越小越优先**：`100` project-dsh < `200` project-agents < `250` runtime < `300` custom（默认）< `400` user-dsh < `500` user-agents < `600` bundled。

`origin`、`plane` 以及"加载结果"里的一切都是 **registry 元数据，绝不是作者输入**：描述符里出现 `origin` 或 `plane` 会作为未知键被拒绝。

### 3.4 flow 文档

flow 文件是一个 JSON 对象，键如下（校验逻辑见 `packages/mpd-ext-plugin/src/flows.ts`）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | **是** | 必须满足 skill 名语法，因为 flow 会以该名字作为 skill 候选被提供 |
| `title` | string | **是** | 非空；渲染后成为流程的 `#` 标题 |
| `description` | string | **是** | 非空；成为模型读取的 skill 描述 |
| `whenToUse` | string | 否 | 渲染进 `## When to use` 段落 |
| `steps` | array | **是** | 非空 |
| `steps[].title` | string | **是** | 非空 |
| `steps[].detail` | string | 否 | 要执行的动作 |
| `steps[].tool` | string | 否 | 工具提示（`read`、`bash`、`mcp__server__tool` …） |
| `steps[].output` | string | 否 | 该步骤预期产出什么 |

未知键会逐文件被拒绝。flow 是**声明式**的：渲染器输出一份 `SKILL.md` 形态的文档（`name` = flow id，`content` = 渲染后的流程）进入 skills 目录。没有任何东西会替你执行 flow——模型用自己的工具按步骤推进。

## 4. 发现机制：三个根目录，两种生命周期

### 4.1 根目录

| 根目录 | 生命周期 | 可贡献 |
|---|---|---|
| `<session workspace>/.mpd/extensions/*/mpd-ext.json` | **按调用**——工具侧从调用会话的 workspace 解析；skills 面走 harness 自己的 `provider.list({ cwd })` | **仅 skills + flows** |
| `~/.mpd/extensions/*/mpd-ext.json` | 宿主机范围，在 apply 时发现 | skills、flows、mcp、roles |
| `<bundle>/extensions/*/mpd-ext.json` | 宿主机范围，apply 时从 bundle 路径发现 | skills、flows、mcp、roles |

### 4.2 project plane 为何受限

本 harness 中 tool 与 provider 的注册是**进程级全局**的——它没有 session 作用域。因此"按会话的 MCP server 或名册 role"无法被如实表达，project 级 manifest 一旦声明它们，就会**针对该项**被响亮拒绝，理由原文为：

> project-level extensions may contribute skills and flows only: tool and provider registration is
> process-global and cannot be scoped to a session

拒绝是逐项的：该扩展的其余部分照常加载。绝不会出现静默的半加载。

### 4.3 优先级、遮蔽与配置键

id 相同时发现优先级为 **project → user → bundle**（先到者胜）。被遮蔽的条目会被记录并由 `mpd_ext_list`（`shadowed`）报告——永不致命，也永不静默。

配置位于 `.mpd/mpd.jsonc`（project 层）叠加在 `$DSH_HOME/mpd.jsonc`（user 层）之上（project 胜出）：

| 键 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `extensions.enable` | string[] | `[]` | 强制启用这些扩展 id |
| `extensions.disable` | string[] | `[]` | 强制禁用这些扩展 id |
| `extensions.mcp.enabled` | boolean | `true` | 置为 `false` 时断开所有已声明的 MCP server（由 `mpd_ext_list` / `mpd_ext_show` 反映） |
| `extensions.mcp.connectTimeoutMs` | number > 0 | `10000` | 未自行声明的 server 的默认连接预算 |
| `extensions.mcp.toolCallTimeoutMs` | number > 0 | `60000` | 默认的单次工具调用预算 |

生效的启用状态判定顺序为：`disable[]` → `enable[]` → 描述符的 `enabled` 标志。在依赖这些键之前，有两个必须知道的诚实限制：

- **`extensions.*` 是进程级的，不是会话级的。** `mpdConfig` 从进程层配置栈解析它，因此某个项目的 `enable`/`disable` 并不是按会话的开关。扩展接口刻意不在每次 skill 快照时调用 `reload(exec)`：那会让 skills provider 的视图与工具的视图互相矛盾，比一条写明的限制更糟。`extensions.roots[]` 这个键**不存在**——声明式根目录列表只会带来路径逃逸与优先级问题，对 v1 没有任何价值。
- **enable/disable 只过滤被"提供"的内容**；它们从不作为注册的门禁。

## 5. 完整示例

四种类型全部取自实际发布的参考扩展 `extensions/mpd-ext-example/`（默认禁用——启用它即可端到端观察本接口）。

### 5.1 skill（`skills`）

manifest 行：`"skills": [{ "root": "skills", "rank": 300 }]`，以及 `extensions/mpd-ext-example/skills/change-triage/SKILL.md`：

```markdown
---
name: change-triage
description: "Reference extension skill: triage a code change before review (what changed, what it touches, which risks deserve a reader). Use when a code diff needs a first pass before a human or reviewer looks at it."
---

# change-triage

…流程正文…
```

frontmatter 需要一个非空的 `name`（skill 名语法）与非空的 `description`。其解析器是一个刻意做小的 YAML 子集：顶层标量，以及 `name`、`description`、`user-invocable`、`disable-model-invocation`（布尔）。`userInvocable`/`modelInvocable` 是旧拼写，会带着"应改用哪个名字"的提示被拒绝。

### 5.2 flow（`flows`）

manifest 行：`"flows": [{ "dir": "flows", "rank": 300 }]`，以及 `extensions/mpd-ext-example/flows/change-triage-flow.json`（此处只摘录前两步）：

```json
{
  "id": "change-triage-flow",
  "title": "Change triage before review",
  "description": "Walk a code change through the reference extension's triage skill, then hand the result to a reviewer. Use before a code change is reviewed.",
  "whenToUse": "Use when a code change needs a first pass before review.",
  "steps": [
    {
      "title": "Collect the change",
      "detail": "Read the diff and list the touched files.",
      "tool": "bash",
      "output": "The list of touched files with a one-line purpose each."
    },
    {
      "title": "Apply the triage skill",
      "detail": "Follow the `change-triage` skill: classify functional vs editorial, then name the contract each functional change can break.",
      "tool": "read",
      "output": "A ranked list of risks with file and line."
    }
  ]
}
```

### 5.3 MCP server（`mcp`）

manifest 条目（`extensions/mpd-ext-example/mpd-ext.json`）：

```json
{
  "mcp": [
    {
      "serverName": "lint-mcp",
      "transport": "stdio",
      "command": "node",
      "args": ["server.mjs"],
      "cwd": ".",
      "env": {},
      "connectTimeoutMs": 10000,
      "toolCallTimeoutMs": 60000
    }
  ]
}
```

server 必须在 stdio 上说换行分隔的 JSON-RPC 2.0（`initialize`、`tools/list`、`tools/call`；`notifications/tools/list_changed` 也会被响应）。实际发布的 `extensions/mpd-ext-example/server.mjs` 就是一个完整、零依赖的示例，而 `scripts/mpd-ext.mjs scaffold <name> --with-mcp` 会写出等价的一份。

作者最容易弄错的两点：

- **`cwd` 是扩展根目录相对的。** `"cwd": "."` 指该扩展自己的目录，而不是 dsh 进程的工作目录；`command` 与 `args` 按你写的原样使用。
- **工具名是推导出来的，不能自选。** server `lint-mcp` 上发现的原始工具名 `foo` 会变成 `mcp__lint-mcp__foo`。`[A-Za-z0-9_-]` 之外的字符变为 `_`，整体长度上限 64 字符，并且**任何有损变换（净化或截断）都会追加 `_<12 位十六进制 sha256(serverName + NUL + rawName)>`**，从而两个不同的原始名永远不会相撞。flow 的步骤随后就可以把 `mcp__lint-mcp__foo` 作为工具提示引用。

### 5.4 role（`roles`）

manifest 条目及其 persona 文件（`extensions/mpd-ext-example/personas/code-reviewer.md`）：

```json
{
  "roles": [
    {
      "name": "Code Reviewer",
      "description": "Reference extension role: reviews a change read-only against the extension contract and reports findings without editing files.",
      "readonly": true,
      "persona": "personas/code-reviewer.md"
    }
  ]
}
```

被贡献的 role 由 `mpd-roles-plugin` **按调用**解析：它在工具执行时惰性读取 registry（绝不是 apply 期的合并——那会静默丢掉所有扩展 row 晚于名册 apply 的 role）。此后它与基础专家完全一致：

- `mpd_roles_list` 会连同其所属扩展列出它（`extension: <扩展 id>`），其稳定 id 带命名空间 `ext-<扩展 id>-<名称 slug>`；
- `mpd_role_spawn` 可用声明的 `name` 以任意大小写/空格/连字符拼写称呼它，以该名称给 subagent 打标签，并对 `readonly: true` 的 role 施加与只读基础 role 相同的 write-deny 工具过滤；
- `mpd_role_persona` 返回 persona 文本，`mpd_workmate_init base="<role 名>"` 可将其用作 workmate BASE 模板；
- `provider` + `model`（必须同时提供）成为它的 route；两者都缺省则使用名册默认值。

**role 不会自己变成 teammate。** 队友名册是 Lead 用官方 `spawn_teammate` 工具按名字创建出来的；它是一个面向模型的工具调用，而不是注册面，因此扩展插件无法往里面加成员。请以一次性 spawn 或 workmate base 的方式使用它。

## 6. 失败与冲突策略

一个扩展、它的某一项、某个 flow 文件、某个 MCP server 或某个 role 的失败，**不会**影响其它任何东西。每次失败都以一行理由记录在该扩展的加载结果中，并由 `mpd_ext_list` / `mpd_ext_show` 呈现。扩展接口中没有任何代码会把异常抛出 `apply`，也没有任何失败会中断另一个扩展的激活。

| 情形 | 结果 |
|---|---|
| 描述符、`contributes` 或任一条目含未知键 | 逐项拒绝并记录；该扩展其它合法条目照常 |
| `apiVersion` ≠ 1，或 `id` 不合法 | 整个扩展被**拒绝**（无法安全解释它的任何部分） |
| 资源路径为绝对路径或用 `..` 逃逸 | 该项被拒绝 |
| project manifest 声明 `mcp` 或 `roles` | 逐项拒绝，理由见 §4.2 原文 |
| `SKILL.md` 的 `name` 或 `description` 缺失/不合法 | 该候选**被跳过并告警**——刻意比 harness 更严：harness 把 `invocation` 视为可选，却在每个会话的 pre-step 中无保护地解引用它 |
| **同一个扩展内**两个 skill 同名 | 跳过 + 告警 + 记录加载错误 |
| skill 名与更低 rank 的 provider 相撞 | 由 rank 阶梯裁定，落败的候选会被 harness 丢弃；现在两种情形都会被报告：两个**扩展**之间的相撞会标注在落败方（其错误列表里出现 `skill surface:`，写明赢家与双方的 rank），而每个被声明的名字都会由 `mpd_ext_list` / `mpd_ext_show` 与 harness 自身的目录比对（`skillServing.served` / `.notServed`） |
| MCP 工具名与已存在的工具相撞 | 该工具被跳过并记录；一次失败的 swap 之后存活的工具数是 **零**，绝不会是半挂载的 server |
| MCP server 不可达、卡住或退出 | `mpd_ext_show` 给出每个 server 的状态 `connecting`/`connected`/`unavailable`/`failed`/`disabled` 以及 stderr 尾部；启动既不被阻塞也不失败 |
| role 名已被基础 role 或另一个扩展占用 | 逐个 role 拒绝，且**两侧都会报告**（扩展 `errors` 中的 `refused: …` 行，以及 `mpd_roles_list` 的 `refused` 列表），并记录一次日志；名册与启动照常工作 |
| role 的 persona 文件无法读取 | 逐个 role 拒绝，理由中带上路径 |
| 两个扩展 id 相同 | 先到的 plane 胜出，被遮蔽者被记录（`shadowed`） |

## 7. 面向模型的工具

v1 提供**四个**工具——早期计划里数到五个，其中 `mpd_ext_reload` 已被**砍掉**：reload 是一个自带失败类别的状态机，而本仓库实测的规则是插件模块的改动本来就需要进程重启。**诚实的 reload 就是重启。**

| 工具 | 它回答什么 |
|---|---|
| `mpd_ext_list` | 本宿主已知的每个扩展：id、origin（`plugin`/`directory`）、plane（`project`/`user`/`bundle`）、root、**生效的**启用状态、各类贡献计数、逐项错误、pending 类型、被遮蔽的 id、被拒绝的 manifest，以及每个扩展声明的 skill 名里有哪些真的被 harness 目录**服务** |
| `mpd_ext_show` | 单个扩展的完整信息：描述符（**`env` 值已脱敏**）、解析后的资源根、贡献的 skill/flow/role 名称、每个声明名的服务校验、每个 MCP server 的状态 + 发现的工具名 + stderr 尾部，以及错误列表（未知 id 会报出已知 id） |
| `mpd_flow_list` | 来自已启用扩展的每个 flow：id、title、`whenToUse`、步骤数、所属扩展 |
| `mpd_flow_show` | 单个 flow 的完整内容：description、`whenToUse`，以及每一步的工具提示与预期产出 |

开发者 CLI（§8）另有 `validate`、`scaffold`、`list`；它们是 shell 命令，不是模型工具。

## 8. 开发者工作流

从零到可用的扩展，命令与输出照实给出（在 bundle 仓库根目录执行；因为 CLI 直接导入 TypeScript 契约源码，所以需要 `bun`）：

```sh
# 1. 直接脚手架出一个最小、可加载的扩展到一个发现根目录。
#    四种类型都贡献时，user plane 才是正确选择；project plane
#    （<workspace>/.mpd/extensions）只接受 skills + flows。
bun scripts/mpd-ext.mjs scaffold demo-ext --dir ~/.mpd/extensions
# [mpd-ext] scaffolded "demo-ext" at /home/<you>/.mpd/extensions/demo-ext
#   contributes: 1 skill(s), 1 flow(s), 1 role(s), 0 mcp server(s)
#   next: bun scripts/mpd-ext.mjs validate /home/<you>/.mpd/extensions/demo-ext

# 2. 用运行时**同一个**校验器验证它（exit 0 = 可加载）。
bun scripts/mpd-ext.mjs validate ~/.mpd/extensions/demo-ext
# [mpd-ext] validate /home/<you>/.mpd/extensions/demo-ext (plane=user)
#   extension "demo-ext": loadable
# [mpd-ext] ok

# 3. 看看本宿主会逐 plane 发现什么（含 bundle plane）。
bun scripts/mpd-ext.mjs list

# 4. 编辑 manifest：写入你的真实内容并把 "enabled": true
#    （脚手架出来的扩展默认是禁用的，这是刻意的）。
$EDITOR ~/.mpd/extensions/demo-ext/mpd-ext.json

# 5. 重启 dsh —— v1 没有 reload 工具；重启**就是** reload。

# 6. 在会话里使用它：先问模型看到了什么，再使用内容。
#    mpd_ext_list      -> demo-ext [user/directory] enabled skills=1 flows=1 ...
#    mpd_flow_list     -> demo-ext-flow ...
#    mpd_roles_list    -> <role 名称> [..., extension:demo-ext]
```

不修改 manifest 也可启用：描述符里写 `"enabled": true`，或在 `.mpd/mpd.jsonc` 里写 `extensions.enable: ["demo-ext"]`（§4.3）。被**禁用**的扩展在任何地方都不贡献——skill、flow、MCP、role 皆无；另外 CLI 的 `list` 展示的是 manifest 自身的标志，而 `mpd_ext_list` 展示的是**生效**状态（因此当配置列表覆盖 manifest 时，两者可以不同）。

CLI 也会自检：

```sh
bun scripts/mpd-ext.mjs --self-test   # scaffold -> validate -> list，仅使用临时目录
```

关于 `validate` 输出的一点说明：它会为每个已声明的 MCP server 打印一条 `pending` 记录，因为 CLI 是一个**离线检查器**——它只校验契约，从不连接任何东西。运行时则由桥在 apply 阶段连接 server，`mpd_ext_show` / `mpd_ext_list` 会用该 server 的实时状态（`connecting` / `connected` / `unavailable` / `failed` / `disabled`）取代那条记录。请把 `pending` 行理解为"已声明，状态尚未观测"。

## 9. MCP：安装面 row 与运行时桥

两条路径都是一等公民，它们回答不同的问题。

| | 安装面 `dsh-mcp-client` row | 运行时桥（本接口） |
|---|---|---|
| server 在哪里声明 | 包或 profile 中的 patch row | `mpd-ext.json`（`mcp` 条目） |
| 谁能添加 | 谁拥有该 patch 谁才能 | 用户，按 home 目录或 bundle |
| 作用域 | row 被组合到的位置 | user / bundle plane（非按会话，§4.2） |
| 子进程归属 | loader 拥有子进程 | 扩展 row 拥有子进程 |
| 命名、schema 处理、回滚、释放 | harness 自家久经考验的路径 | 本插件复刻了命名常量与 keep-or-drop 的 schema 姿态 |
| 改动成本 | 重装/重启 | 改 manifest + 重启 |

当 server 属于"你的包**本身**是什么"的一部分（并且你想要 harness 自身的 client 语义、传输与重连行为）时，选**安装面**；当 server 是用户应当能不改 profile 就增删的内容、且 stdio 足够时，选**运行时桥**。

桥复刻了 harness 的公开命名（`mcp__<server>__<tool>`，64 字符上限，有损变换时追加 `_<hash>`），因此在一条路径上写下的工具调用在另一条路径上依然可用。它对**外来 `output.schema`** 也采用 harness 的态度：满足受支持子集就保留，否则**丢弃的是 schema、保留的是工具**——该工具会在没有 `structuredContent` 的情况下注册，并记录原因：绝不重写第三方的 schema（被重写就不再描述 server 实际返回的内容），而且 harness 自带的 `supportedOutputSchema` 正是这么做的。`inputSchema` 会被投影到受支持子集，且**根会被归一化到 object**（工具调用携带的永远是一个参数对象，因此标量或数组根会把载荷移入单一的 `value` 属性，并作为一条 notice 记录）；只有连参数都无法描述的工具才会被跳过。参数净化器是对未来 harness 的纵深防御（本版本在注册时并不校验 `parameters`）。

## 10. 信任模型

- **代码面**扩展就是一个 plugin row：`register()` 由运维者已经安装的代码在宿主进程内调用。它以**进程内、完全信任**的方式运行——它拥有宿主所能做的一切。这里没有沙箱，也没有尝试去造一个。
- **数据面**扩展是内容而非代码：skill 与 flow 是提供给模型的文本，其资源不会越出自己的 root（路径经过校验，§3.3）。它的可信度等于它所在目录的可信度——任何能写 `~/.mpd/extensions/` 的东西都能改变模型读到什么。
- **MCP server** 是从 manifest 启动的**子进程**：你写的 command 会被执行。它的环境由一份安全继承清单构建，并剔除凭据形态的变量名（`*_TOKEN`、`*_KEY`、`*_SECRET`、`*PASSWORD*`、`*_CREDENTIAL*`），其 stderr 被截取为有界尾部供 `mpd_ext_show` 展示，插件释放时子进程会被回收。除此之外子进程不受限制：manifest 就是一次信任决策，与 patch row 完全相同。

## 11. v1 限制与后续项

直说在前，免得有人从失败里才发现：

- **仅 stdio MCP**——不支持 HTTP/SSE 传输，不支持 MCP resources 或 prompts（只有工具）。
- **仅 JSON flow 文件**——YAML flow 属于后续项；flow 是声明式的，没有执行状态机。
- **不支持扩展贡献 agent preset**——preset 面被刻意排除在范围外（没有干净的运行时 seam）。
- **扩展 role 不会自己变成 teammate**——只有 Lead 用官方 `spawn_teammate` 按名字创建，才存在队友。
- **没有 reload**——重启 dsh；失败的 MCP server 会在下次启动时重试。
- **`extensions.*` 配置是进程级、不是按会话的**（§4.3），因为 `mpdConfig` 是 apply 期的进程级快照。
- **跨 provider 的 skill 遮蔽需要读一次目录才可见**——我们自己的注册表只能比较扩展之间，因此 `mpd_ext_list` / `mpd_ext_show` 会去问 harness 的目录（`ctx.skills.list`），并把每个声明报成 `served` 或 `notServed`；若这次读取失败，报告会给出 `checked: false` 与原因，而不是猜测。
- **被名册拒绝的 role 现在两侧都会报告。** `mpd_ext_list` 会重新推导出相同的拒绝原因（扩展 `errors` 中的 `refused: …` 行，由 `src/registry.ts` 的 `annotateRoleSurfaces` 生成），并且只列出可用的 role 名，因此其视图与 `mpd_roles_list.refused` 一致——原先的后续项已经关闭。
- **没有 GUI 面板、没有市场、没有远程下载、没有版本求解。**
- 特定语言与领域的能力面**本身不在此构建**：本版本交付的是让它们作为独立扩展或独立包到来的接口。

## 12. 本指南中的示例如何验证

上文每一份 manifest、资源与命令都取自并核对以下已发布源码：

```sh
# 实际发布的参考扩展可通过校验，exit 0（四种类型齐全）
bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example

# §8 的工作流端到端（scaffold -> validate -> enable -> list）
SB=$(mktemp -d); HOME=$SB bun scripts/mpd-ext.mjs scaffold demo-ext --dir $SB/.mpd/extensions
HOME=$SB bun scripts/mpd-ext.mjs validate $SB/.mpd/extensions/demo-ext

# CLI 自身的检查（仅使用临时目录）
bun scripts/mpd-ext.mjs --self-test

# 本指南引用的契约常量
grep -n "defaultRank\|idPattern\|skillNamePattern\|serverNamePattern" packages/mpd-ext-plugin/src/sdk.ts
```

若本文档中的示例与实际代码出现分歧，以代码为准——契约常量位于 `packages/mpd-ext-plugin/src/sdk.ts`，而且 CLI 接受的 manifest 就是 loader 接受的 manifest，因为二者调用的是同一个校验器。

## 13. 常见问题

**需要打包或发布什么吗？** 不需要。一个含 `mpd-ext.json` 的目录放进发现根目录就够了；不会安装任何东西，也没有人替你管理版本。

**我的扩展应该放在哪里？** 按项目：`<workspace>/.mpd/extensions/`（skills + flows）。需要包含 role 与 MCP server 时：`~/.mpd/extensions/`（若随 bundle 发布则放 `<bundle>/extensions/`）。

**我在 project 扩展里写了 role/MCP 条目，结果被拒绝了。** 这是刻意的（§4.2）：这些类型是进程级全局的，无法限定到某个会话。请把扩展移到 `~/.mpd/extensions/`。

**我改了一个键名，却什么都没发生。** 在这里不可能：未知键会被逐项拒绝并记录，这正是校验器不依赖"静默宽容 schema"的原因。

**为什么扩展被列出了，它的 skill 却不见了？** 先看生效的启用状态（manifest 里的 `enabled: false`，或配置里的 `disable`），再看 `mpd_ext_show` 打印的 `skillServing` 区块：`notServed` 会列出每一个被目录判给别处的声明（并给出赢家 provider），而 `checked: false` 表示这次目录读取本身失败了。

**为什么 `validate` 会对某个 MCP server 打印 `pending`？** 因为 CLI 从不连接：它是一个离线契约检查器。运行时桥会在 apply 阶段连接该 server，实际状态以 `mpd_ext_show` 为准。

**改了扩展怎么重新加载？** 重启 dsh。project plane 按调用重新读取，所以 project manifest 的改动会被后续调用看到；user/bundle plane 的 manifest 在 apply 时读取。

**flow 会执行什么吗？** 不会。它是一份被渲染成 skill 文档的流程；模型用自己的工具按步骤推进。

**我能不能仍然把辅助 MCP server 声明为 patch row？** 可以——那正是安装面，§9 说明了何时它是更好的选择。
