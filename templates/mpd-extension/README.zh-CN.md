# MPD 扩展模板 —— 可直接拷贝的骨架

[English](./README.md)

`templates/mpd-extension/` 是**上游模板目录**，也是新建 MPD 外部扩展（加载器行 `mpd-ext`）的
唯一事实来源。它是一个完整、可加载的骨架，声明了全部四种贡献类型；`scripts/mpd-ext.ts scaffold`
做的只是**拷贝它**——CLI 不再自己生成任何代码，只改写名字。本文中凡是说"你的拷贝"的地方，都指你
放进某个发现根的那个扩展目录。

## 1. 拷贝它

```bash
bun scripts/mpd-ext.ts scaffold <name> --dir <where>              # 技能 + 流程 + 角色
bun scripts/mpd-ext.ts scaffold <name> --dir <where> --with-mcp   # 再加上 stdio MCP 服务器
bun scripts/mpd-ext.ts validate <where>/<name>
```

两种拷贝之间的差别就是这一个开关，而且是刻意设计的：

| 分支 | 拷贝出的 `contributes` | 文件 |
|---|---|---|
| 默认（不带开关） | `skills`、`flows`、`roles`——**三种类型** | `mcp` 配置块与 `server.ts` 被**丢弃** |
| `--with-mcp` | `skills`、`flows`、`roles`、`mcp`——**四种类型** | 保留 `server.ts` |

两种拷贝都能加载，CLI 的 `--self-test` 正是这么断言的：先校验本模板，再把两个分支
都脚手架到临时目录，**分别重新校验拷贝**，逐文件与本模板做字节级比对（只允许名字改写
和已说明的 `mcp` 丢弃），最后故意破坏一个拷贝，证明 `validate` 会逐项报错。

一次拒绝**什么都不会写入**：拷贝先在暂存目录里生成，只有运行时校验器接受了它才会被移动到
目标位置，因此被拒绝的 `scaffold` 绝不会留下一个写了一半的扩展。`scaffold` 会在给出原因、
且目标保持为空的情况下拒绝：

- 不符合 `^[a-z0-9][a-z0-9-]{0,63}$` 的 id；
- 派生出的技能名或流程名不符合技能名语法；
- 已经存在的目标目录——脚手架从不覆盖；
- 派生出的角色名与**基础名册**的名字键重合：`scaffold plan` 会被拒绝，因为 `plan reviewer`
  已经被名册里的 `Plan Reviewer` 占用。

## 2. 拷贝时改写了什么

占位符就是本模板**自己的清单 `id`**（见 `mpd-ext.json`；它是专门起的，与随包示例
`mpd-ext-example` 不同）。拷贝时该占位符的每一次出现都会被替换成新的扩展名——包括所有
文本文件（`.json`、`.md`、`.ts`）的内容**以及每一级文件与目录名**。除此之外没有任何
改动，因此派生名是：

| 位置 | 派生值 |
|---|---|
| `mpd-ext.json` → `id` | `<name>` |
| `mpd-ext.json` → `mcp[0].serverName` | `<name>`，按契约自身的上限截断（当前是 32，且从 `serverNamePattern` 读出）；更长的 id 会**在 stderr 上给出警告**后截断，绝不静默 |
| `skills/<…>/SKILL.md` 及其目录 | `<name>-skill` |
| `flows/<…>.json` → 文件名、`id`、`title` | `<name>-flow` |
| `personas/<…>.md` 与 `roles[0].persona` | `<name>-reviewer.md` |
| `roles[0].name` | `<name> reviewer` |
| `mpd-ext.json` → `description`、角色描述、技能/流程正文 | 占位符替换为 `<name>` |

本 README 对没有占位符，因此会被原样拷贝——这正是它写成"位置中立"的原因：同一段文字既描述
上游模板，也描述你的拷贝。

## 3. 四种贡献类型

| 类型 | 位置 | 说明 |
|---|---|---|
| `skills` | `skills/<name>-skill/SKILL.md` | 模型可加载的流程说明；frontmatter 的 `name`/`description` 必填，技能的身份就是 frontmatter 里的 `name`——目录名可以随意 |
| `flows` | `flows/<name>-flow.json` | **声明式**流程，会被渲染成技能候选；流程 `id` 必须满足技能名语法 |
| `roles` | `personas/<name>-reviewer.md` | 按调用解析的名单型专家；`readonly: true` 会拒绝其写入工具，所以模板自带的是只读评审者。`provider`/`model` 是可选的，且必须**一起给或都不给**——模板保持默认路由，所以两者都没有声明 |
| `mcp` | `server.ts` | **零依赖**的 stdio MCP 服务器（只用 node 标准库）；其工具以 `mcp__<serverName>__<tool>` 发布 |

不需要的部分请删掉——同时删掉 `mpd-ext.json` 中对应的 `contributes` 条目：声明了类型
却缺少资产是加载错误，而没人声明的资产只是永远不会被读取。

## 4. 每种类型允许出现在哪个平面

模板本身永远不会被发现（见第 6 节）；拷贝出来的扩展放进下面三个发现根之一：

| 根目录 | 生命周期 | 可贡献类型 |
|---|---|---|
| `<会话工作区>/.mpd/extensions/<id>/` | 每次调用，从调用会话的工作区解析 | 仅 `skills` + `flows` |
| `~/.mpd/extensions/<id>/` | 宿主级，apply 时发现 | `skills`、`flows`、`mcp`、`roles` |
| `<bundle>/extensions/<id>/` | 宿主级，apply 时发现 | `skills`、`flows`、`mcp`、`roles` |

工具与技能提供者的注册是进程级全局的，没有会话级接缝，因此项目平面清单一旦声明 `mcp`
或 `roles` 就会被**逐项**大声拒绝。四种类型的扩展应放在 `~/.mpd/extensions/`（或
bundle 内）。

## 5. 校验拷贝

```bash
bun scripts/mpd-ext.ts validate <dir>   # 退出码 0 = 本宿主可加载；退出码 1 = 每项一行错误
bun scripts/mpd-ext.ts list             # 本宿主按平面会发现的扩展
```

校验不是走过场：清单里的 `"enabled": false` 意味着被发现后仍然不生效，直到你把它改成
`true`。任何位置（描述符、`contributes` 或任一条目）的未知键都会被拒绝，而不是被静默
忽略——被改名的键绝不能出现“接受了却什么都不做”。

## 6. 为什么本目录既不会被发现、也不会被打包

`templates/` 不在上面三个发现根之内，所以这里的内容不会被挂载——在本目录出现前后，未改动的
代码树启动时发现的扩展完全相同。而且模板**不会被扩展加载器发现**，但它**确实会被打包**：发布打包脚本在其
`ROOT_ASSET_DIRS` 中点名了 `templates`（读自 `scripts/pack-mpd.ts`），因此
`dist/mpd-package/templates/mpd-extension` 会随产物一同交付；若模板从打包中掉失，那就是
交付资产的缺失（即打包器会高声拒绝的 T-38 类）。

这件事有一个你在打包安装里伸手拿 CLI 之前应当知道的后果：打包器确实会拷贝
`scripts/mpd-ext.ts`，但它只拷贝 `packages/<pkg>/dist`、从不拷贝 `packages/<pkg>/src`，而这个
CLI 从 `src/` 导入唯一的校验器。因此在一个打包树里 CLI 根本无法运行；把 `src/` 补回去之后，
`validate`/`list` 可以运行，而 `scaffold`（以及 `--self-test` 的模板分支）仍然需要本目录。
**所以 AGENTS.md §4 的 Extension-CLI 关卡是一个检出关卡：在打包树里它是红的。** 该结论由上游仓库
在 `evidence/extensions/template-scaffold/` 下的 packed-tree 探针实测得出。

## 7. stdio MCP 服务器（仅 `--with-mcp` 拷贝带有）

`server.ts` 是 `--with-mcp` 分支的载荷；默认拷贝不带它。它在 stdin/stdout 上使用按行分隔的
JSON-RPC 2.0（`initialize` → `notifications/initialized` → `tools/list` → `tools/call`），
stdout 只承载协议数据，并从自己的 `mpd-ext.json` 读取 `serverInfo.name` 以及
`describe_extension` 工具的回答。无需宿主即可自测，在它所在目录执行：

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node <扩展根>/server.ts
```

## 8. 本 README 引用的清单取值

去品牌探针（`verify-debranding-full.mjs`）会检查本 README **对**逐字引用了模板清单里的片段取值，
这样 `mpd-ext.json` 与文档之间的漂移就不会悄无声息地通过。以下为当前取值（`scaffold` 会改写你的拷贝里的
**名称**；说明文字与 `stdio`/`node` 这对取值保持如下，直到你替换它们）：

| 位置 | 字段 | 取值 |
|---|---|---|
| `skills/mpd-extension-template-skill/SKILL.md` | `skills.name` | `mpd-extension-template-skill` |
| `skills/mpd-extension-template-skill/SKILL.md` | `skills.description` | `The mpd-extension-template extension's first skill. Replace this description with what the skill does and when an agent should use it; keep the load-bearing sentence first.` |
| `flows/mpd-extension-template-flow.json` | `flows.id` | `mpd-extension-template-flow` |
| `flows/mpd-extension-template-flow.json` | `flows.title` | `mpd-extension-template flow` |
| `flows/mpd-extension-template-flow.json` | `flows.description` | `The mpd-extension-template extension's first flow. Replace this procedure with the real one, or delete the flows directory and the flows entry in mpd-ext.json.` |
| `flows/mpd-extension-template-flow.json` | `flows.whenToUse` | `Use when a task needs the repeatable procedure this flow describes.` |
| `mpd-ext.json` | `roles.name` | `mpd-extension-template reviewer` |
| `mpd-ext.json` | `roles.description` | `Read-only reviewer contributed by the mpd-extension-template extension: checks a change against this extension's own contract and reports findings with evidence.` |
| `mpd-ext.json` | `roles.persona` | `personas/mpd-extension-template-reviewer.md` |
| `mpd-ext.json` | `mcp.serverName` | `mpd-extension-template` |
| `mpd-ext.json` | `mcp.transport` | `stdio` |
| `mpd-ext.json` | `mcp.command` | `node` |
| `mpd-ext.json` | `mcp.args` | `["server.ts"]` |
