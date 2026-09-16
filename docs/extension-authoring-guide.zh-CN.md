# 扩展编写指南 —— 何时写、放在哪里、怎么写

[English](./extension-authoring-guide.md)

这是一份面向**人**的任务型指南：想给本 bundle 增加一项能力，又不想改 bundle 本身时，该怎么做。
它回答的是"为什么、什么时候、放在哪里"；逐字段的契约仍在 [`extensions.md`](./extensions.md)，
插件自身的参考在 [`../packages/mpd-ext-plugin/README.md`](../packages/mpd-ext-plugin/README.md)，
面向智能体的机器契约在 [`../EXTENSIONS-FOR-AGENTS.md`](../EXTENSIONS-FOR-AGENTS.md)。本指南
**刻意不包含任何 schema 表格**：把表格抄第二遍，正是两份文档开始互相矛盾的方式。

## 1. 为什么用扩展，以及什么时候它并不合适

扩展就是一个**带有 `mpd-ext.json` 清单的目录**。宿主从文件系统发现它，因此没有安装步骤、没有发布
步骤、没有 profile 补丁、也不需要重新构建：写好文件、校验、重启 `dsh`，能力就存在了。这是让一项
能力存在起来最便宜的方式，而它的适用范围也刻意很窄。

扩展只表达**声明式数据**——一个技能、一个流程、一个 stdio MCP 服务器、一个只读名册角色。如果你
需要的不是这四者之一，那扩展就是错的工具：

| 你需要的是 | 应该用 |
|---|---|
| 新的 profile 行、锁定依赖、安装期执行的代码，或给很多用户使用的带版本包 | **安装平面**：插件 bundle（[`extensions.md`](./extensions.md) §1） |
| 一条只执行一次的指令 | 不需要新东西——写进任务里，或写进语料库中的技能 |
| 图形面板、应用市场、远程下载或版本求解 | v1 中都不存在（[§7](#7-分发)） |

本节选的是**工具**，它从不选根目录。本指南中回答"放在哪个根"的地方只有 §2，且只回答一次。

剩下的事由两个问题决定，且都在下文回答：目录放在**哪个根**（§2），宿主**什么时候重新读取**它（§4）。

## 2. 唯一的一条平面选择规则

**选择根目录只有一条规则，就是它：**

> 当扩展声明的每一种类型都只是**技能或流程**、并且它应当跟随某个工作区时，把它放在
> `<会话工作区>/.mpd/extensions/<id>/`。当它声明了 **MCP 服务器或角色**——这两种类型在项目
> 平面不合法——或者当它必须对本机上**每一个**会话可见时，把它放在 `~/.mpd/extensions/<id>/`。
> `<bundle>/extensions/<id>/` 是同一个决定、不同的归属：它用于随 bundle 一起分发、而不是放在
> 用户主目录里的扩展。

这条限制不是装饰。在本 harness 中，注册工具或技能提供者是**进程级全局**的，所以"每会话"的 MCP
服务器或名册角色无法被诚实地表达。项目平面清单如果声明 `mcp` 或 `roles`，会被**逐项**拒绝并给出
明确原因（`refuseHostKind`, `packages/mpd-ext-plugin/src/registry.ts:678-685`）——拒绝是响亮的、会指出具体条目，
而同一个清单里的技能与流程照常加载。

请在写清单**之前**读这条规则，而不是在第一次被拒之后：这是最常见的选错平面错误，而拒绝只在发现
阶段才会到达。

## 3. 隔离姿态，以及我们接受的残余风险

被声明的 MCP 服务器是一个**子进程**，它拿到的环境被刻意压到最小。只有 SDK 实测安全的白名单会进入
子进程——POSIX 下是 `HOME`、`LOGNAME`、`PATH`、`SHELL`、`TERM`、`USER`（win32 下是 `APPDATA`、
`HOMEDRIVE`、`HOMEPATH`、`LOCALAPPDATA`、`PATH`、`PROCESSOR_ARCHITECTURE`、`SYSTEMDRIVE`、
`SYSTEMROOT`、`TEMP`、`USERNAME`、`USERPROFILE`、`PROGRAMFILES`），声明位置见
（`INHERITED_ENV_VARS`, `packages/mpd-ext-plugin/src/mcp-client.ts:69-85`）。在此之上，任何看起来像凭证的变量名即使属于白名单
也会被丢弃（`isCredentialShapedEnvName`, `packages/mpd-ext-plugin/src/mcp-client.ts:87-97`），因此 harness 自己的 provider 密钥
不会被意外继承。扩展在清单 `env` 中声明的内容**会**被传入——那是作者写下的、可见的配置，而不是继承
（`childEnv`, `packages/mpd-ext-plugin/src/mcp-client.ts:99-117`）。

这份姿态是真实的，它接受的残余风险同样真实。之所以写在这里，是因为一个没人写下来的"接受"决定，
和一个疏漏无法区分：

1. **同一操作系统用户的磁盘访问。** 子进程以你的身份运行，拥有你的文件权限。只要有东西告诉它路径，
   它就能读你的用户能读的任何文件，包括凭证文件。白名单阻止的是**环境变量**层面的意外泄漏，它不是
   沙箱。
2. **作者声明的密钥就是真实密钥。** 你写进清单 `env` 的任何内容，在磁盘上的清单里都是可读的。
   `mpd_ext_show` 会抹掉**值**（键仍可见，`redactedDescriptor`, `packages/mpd-ext-plugin/src/index.ts:659`），所以
   会话日志里的工具结果不会泄漏它们——但文件本身没有加密，你写下来的值就是你要负责的值。
3. **文件系统信任。** 安装一个扩展就意味着执行一个你或别人提供的 stdio 服务器。这里没有签名、没有
   沙箱命名空间、没有 seccomp 配置、没有能力裁剪。
4. **原生代码不受这份姿态约束。** 服务器自己可以再启动任何东西；它往外传什么环境，是它自己的事。

第三方工具 schema 遵循同样的"保留工具、丢弃无法兑现的部分"原则：超出 harness 子集的 `inputSchema`
会被投影、并把参数根归一到对象；而超出子集的 `outputSchema` 只会让该工具**失去 schema**，永远不会
失去工具本身。

关于来源的一点精确说明：上面四项残余风险是阅读启动与注册路径后得出的姿态评估——它们是一项显式的
"接受"决定，而不是实际执行过的攻击结果。[`extension-adaptation-report.zh-CN.md`](./extension-adaptation-report.zh-CN.md)
§9 记录了首次给出这些结论的审计对同一问题的说明。

## 4. 生命周期与重启矩阵

v1 没有重新加载工具：**重启就是重新加载**（`"No reload"`, `docs/extensions.md:524`）。下面这张表是最容易出错的
部分，因为同一个目录会因为类型与平面不同而表现不同。

| 类型 | 平面 | 何时读取 | 修改后需要重启吗 |
|---|---|---|---|
| `skills` | 项目 | **每次调用**，从调用会话的工作区解析 | 不需要 |
| `flows` | 项目 | **每次调用** | 不需要 |
| `skills`、`flows` | user、bundle | 在 **apply** 时发现 | 需要 |
| `mcp` | user、bundle | 扩展在 apply 时被发现，服务器也在 **apply 时连接**——并行、受 `connectTimeoutMs` 限时、绝不惰性（`connectExtensionMcpServers`, `packages/mpd-ext-plugin/src/index.ts:1062`） | 需要 |
| `roles` | user、bundle | 声明在 apply 时被发现；角色本身由名册平面**每次调用**解析，并重新读取 persona 文本（`extensionRoles`, `packages/mpd-roles-plugin/src/index.ts:225-292`） | 新增或改名需要；只改 persona 正文不需要 |

三个值得记住的推论：

- 项目平面里的"每次调用"类型，是唯一表现得像活文件的组合：改完技能或流程，下一次调用就能用，无需
  重启。
- MCP 服务器失败不会拖垮启动。它进入 `unavailable` 或 `failed` 状态，并带一段有界的子进程 stderr
  尾部（`stderrTail`, `packages/mpd-ext-plugin/src/mcp.ts:42`），其他扩展照常激活；下一次启动会重试它。
- `.mpd/mpd.jsonc` 中的 `extensions.enable` / `extensions.disable` 是**进程级**的，不是按会话的
  开关；而且它们只过滤"被提供"的内容，从不为注册把关，所以被禁用的扩展不会破坏别的东西。

## 5. 从模板到一个正在运行的扩展

可直接拷贝的骨架在 [`../templates/mpd-extension/`](../templates/mpd-extension)——包含全部四种类型，
其 id 是占位符，由脚手架在拷贝时改写。两种入口，结果相同：

```bash
# A. 脚手架：拷贝模板并改写 id 与所有派生名
bun scripts/mpd-ext.mjs scaffold my-extension --dir ~/.mpd/extensions
# ... 加上 --with-mcp 得到四种类型的拷贝（技能 + 流程 + 角色 + stdio MCP 服务器）；
#     不加则是一个三种类型的扩展。

# B. 或者你自己拷贝——它就是一个普通目录
cp -r templates/mpd-extension ~/.mpd/extensions/my-extension
```

然后走每个扩展都要走的同样五步：

```bash
# 1. 校验——用的是运行时同一个校验器，退出码 0 意味着"本宿主会加载它"
bun scripts/mpd-ext.mjs validate ~/.mpd/extensions/my-extension

# 2. 看看本宿主按平面会发现什么（含 bundle 平面）
bun scripts/mpd-ext.mjs list

# 3. 编辑清单：写上真实的 id、描述与内容，然后把 "enabled" 设为 true
#    （拷贝出来的扩展之所以默认禁用，是因为**模板**里写的是 "enabled": false——运行时默认值正好
#     相反：干脆省略该键的扩展就是启用的）

# 4. 重启 dsh——§4 解释了为什么没有别的办法让 user 平面的修改生效

# 5. 在会话中使用：mpd_ext_list 列出它与它的平面和加载状态，mpd_ext_show 给出解析后的根、
#    技能/流程/角色名以及每个 MCP 服务器的状态，mpd_flow_list / mpd_flow_show 读取贡献的流程。
#    被保留的 stdio 服务器会以 mcp__<serverName>__<tool> 的形式发布工具。
```

发布出来的名字通常就是 `mcp__<serverName>__<tool>`，但并不总是：当该字符串含有 `[A-Za-z0-9_-]`
以外的字符、或长度超过 64 时，非法字符会变成 `_`、名称被截断，并追加
`_<12 位十六进制 sha256(serverName NUL tool)>` 后缀，使两个不同的工具绝不会塌缩成同一个公开名
（`publicToolName`, `packages/mpd-ext-plugin/src/mcp-client.ts:129-135`）。请从会话的工具列表里读取真实
名字，而不是想当然。

两个能省掉一轮排错的细节：清单里的 `skills.root` 与 `flows.dir` 相对于扩展根，且不允许逃逸出根；
stdio 服务器的 `command` 是 `node`、`args` 是 `["server.mjs"]`、`cwd` 是 `"."`——工作目录就是扩展
根，所以服务器能找到自己的清单。你完全不需要宿主就能冒烟测试这个服务器：

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node ~/.mpd/extensions/my-extension/server.mjs
```

如果你要写的是**项目平面**扩展，同一套流程适用，只有两处不同：根是
`<会话工作区>/.mpd/extensions/my-extension/`，并且 `mcp`/`roles` 在那里会被拒绝（§2）——所以项目
平面的拷贝是三种类型的那个。

## 6. 发布前如何验证

校验回答的是"它能加载吗"，而 QA lane 回答的是"它的行为对吗"。两者都能在检出目录里直接运行：

```bash
# 接口自身的测试
bun test packages/mpd-ext-plugin

# 开发者 CLI，含它自己的离线自检（只在临时目录里操作）
bun scripts/mpd-ext.mjs --self-test

# 真实 lane：在沙箱化的 DSH_HOME + HOME + 会话 cwd 中真正挂载 dsh
bun skills/dsh-qa/scripts/extension-lifecycle.mjs --no-skip
bun skills/dsh-qa/scripts/extension-mcp-bridge.mjs --no-skip
bun skills/dsh-qa/scripts/extension-template.mjs
```

中间两条端到端驱动随包示例——发现、项目平面的按调用解析、桥接、隔离断言——第三条把模板脚手架出来，
并对拷贝做一次真实挂载验证。`skills/dsh-qa/scripts/extension-isolation.mjs` 是这些 lane 共同 import
的证明辅助模块；它**不是** case 通道，它唯一的离线证明是自己的 `--self-test`。

关于证据有一条铁律：`dsh --profile <p> --dump-config` 只组合行、不执行任何代码，因此它**永远**不能
证明某个插件或扩展被加载了。请使用真实挂载的启动，或一次真实的工具调用。

## 7. 分发

扩展以**目录**为单位分发，整个目录就是分发单元：清单里的资产路径相对扩展根解析，所以残缺的拷贝就是
坏掉的拷贝。放在哪里由 §2 的决定给出——本节只讲字节怎么到达那里：

- **自己用、一台机器：** 把目录放进 `~/.mpd/extensions/<id>/`。拷贝、重启，完成。
- **作为 bundle 的一部分：** 放进 `<bundle>/extensions/<id>/`。它随后就像任何随包扩展一样在 apply
  时被发现，用户不需要任何安装步骤。
- **给别人、且不在 bundle 内：** 直接把目录交出去（打个压缩包也行）。这里没有注册表、没有版本求解、
  没有依赖图：接收方放进去、校验、重启。

有一条已测量的限制专门针对**打包**产物：打包器只交付 `packages/<pkg>/dist`，不交付 `src`
（`cpDist`, `scripts/pack-mpd.mjs:67-77`），而开发者 CLI 从 `src` 导入校验器
（`"../packages/mpd-ext-plugin/src/registry.ts"`, `scripts/mpd-ext.mjs:35`），因此在 `dist/mpd-package/` 内
每一个 CLI 入口都以
`Cannot find module '<packed>/packages/mpd-ext-plugin/src/registry.ts'` 退出 1——`validate` 在 checkout 中
可用、在那里不可用，而且即使还原了 `src`，`scaffold` 仍会因为 `templates/` 未被一起打包而失败。这是
已测量的结论，并已在撰写本指南的那个 wave 中记录、引用，且**未**修复
（`evidence/extensions/template-scaffold/20260916T063710Z/raw/packed-tree-probe.json`；记录为
`.mpd/TODO.md` T-51）。

v1 中**不存在**、因此不要围绕它做规划的东西：`mpd_ext_reload`、YAML 流程、MCP resources/prompts、
图形面板、应用市场或远程下载、由扩展贡献的 agent preset，以及扩展角色成为 agent-teams 队友。

## 8. 故障排查

| 你看到的现象 | 最可能的原因 | 怎么办 |
|---|---|---|
| `mpd_ext_list` 能看到扩展，但缺了一种类型并带一条逐项错误 | 清单声明的类型缺少对应资产，或任意位置出现未知键 | 运行 `bun scripts/mpd-ext.mjs validate <dir>`：它会逐项打印原因 |
| 项目平面扩展被拒绝，并给出平面相关的原因 | 它声明了 `mcp` 或 `roles`，这两种是宿主级类型 | 移到 `~/.mpd/extensions/`，或去掉该类型（§2） |
| 扩展能加载，但技能没有出现在目录里 | 名字输给了 rank 更高的提供者，或 frontmatter 的 `name` 与目录名不一致 | `mpd_ext_list` 会对照 harness 目录逐个报告 `served` / `notServed` |
| MCP 工具缺失 | 服务器处于 `unavailable` 或 `failed` | `mpd_ext_show` 会打印状态与有界的 stderr 尾部；检查 `command`、`args`、`cwd` 与声明的 `env` |
| 对 user 平面扩展的修改没有生效 | 它在 apply 时被发现 | 重启 `dsh`（§4） |
| 对项目平面技能或流程的修改没有生效 | 当前会话的工作区不是你编辑的目录 | 项目平面是按**调用会话**的工作区解析的 |
| 两个扩展用了同一个 id | 先到先得：项目 → user → bundle | 被遮蔽的条目会被报告、绝不静默丢弃——改名即可 |
| `enabled` 是 `true` 却没有任何效果 | 配置层强制禁用了它，且 `disable` 优先于 `enable` | 检查 `.mpd/mpd.jsonc` 的 `extensions.enable` / `extensions.disable` |

## 9. 字段级参考在哪里

- [`extensions.md`](./extensions.md) —— 描述符参考（顶层、`contributes`、语法与资产路径规则）、
  每种类型的可用片段、失败与冲突策略、面向模型的工具、与安装平面的对比，以及 v1 限制。**表格都在
  那里。**
- [`../packages/mpd-ext-plugin/README.md`](../packages/mpd-ext-plugin/README.md) —— 插件自身的
  参考：配置、四个检查工具、失败策略、schema 姿态，以及已记录的边界。
- [`../extensions/README.md`](../extensions/README.md) —— 随包提供的发现根，以及默认禁用的参考扩展
  `mpd-ext-example`。
- [`../templates/mpd-extension/README.md`](../templates/mpd-extension/README.md) —— 你拷贝的模板、
  它的 `--with-mcp` 语义，以及它自己的验证命令。
- [`../EXTENSIONS-FOR-AGENTS.md`](../EXTENSIONS-FOR-AGENTS.md) —— 机器契约：逐类型要求、一份可校验
  的清单骨架、错误特征与拒绝清单。
