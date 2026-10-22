# mpd-project-init-plugin

[English](./README.md) | **中文**

新项目的一次性 `AGENT.md` 脚手架。在**顶层会话**的第一次 `agent/pre-step` 时，本行检查会话工作区；
仅当该工作区是一个尚无 agent 指令文件的新项目时，才写入一份通用的英文 `AGENT.md`，记录
`<workspace>/.mpd/project-init.json`，并向 `<workspace>/.mpd/logs/mpd-project-init.log` 追加一行。
它从不覆盖已有文件，也从不写入会话工作区之外的位置。

## 触发时机

- 每个 agent 一个 `agent/pre-step` 监听器，通过 `mpd-dsh-adapter`（`registerAgentPreStep`）
  注册在该 agent 自己的作用域内——这是投递确实能到达的位置。
- 分类发生在**步骤执行时**，而不是注册时：仅限顶层会话（已记录的 `origin: "subagent"` 或
  `delegationDepth` 大于等于 `1` 视为子会话；缺少 header 时按失败关闭处理；从不读取预设名——见 T-92）。
- 每个 agent 句柄只检查一次；同一会话之后的每一步都不再执行。

## 跳过条件（全部静默——不写任何内容）

- 会话工作区就是 HOME 或文件系统根目录。
- `AGENT.md`、`AGENTS.md`、`CLAUDE.md` 中任意一个已存在（大小写不敏感）。
- `<workspace>/.mpd/project-init.json` 已存在。
- 该目录不像一个项目：它有可见内容，但既没有 `.git` 也没有项目清单文件。空目录或只有点文件
  （也就是刚执行过 `git init`）**算作**项目，因为这正是本行要服务的“新项目”。

## 写入内容

- `AGENT.md`：通用的英文操作说明——会话先读规则、先计划、小步差异、命令占位符、验证、
  分支加拉取请求纪律、委派加证据、安全。所有项目相关的值都是明显的 `<fill in: …>` 占位符；
  脚手架从不臆造命令。第一行是注明本行与创建时刻的来源注释。
- `.mpd/project-init.json`：标记文件（`version`、`plugin`、`file`、`createdAt`），保证写入只发生一次。
  它从不覆盖不是本行创建的文件。
- `.mpd/logs/mpd-project-init.log`：记录本次创建的一行日志。

## 边界

harness 在会话**开始**时加载 agent 指令，因此在本次会话第一次 pre-step 期间写入的 `AGENT.md`
要到**下一次会话**才会被注入，绝不会追溯生效。

## 配置

| 键 | 类型 | 默认值 |
|---|---|---|
| `enabled` | boolean | `true` |

## 为什么需要它

新仓库没有任何操作说明，于是之后每个会话都要从头重新推导同样的约定。只写一次——绝不覆盖、
绝不臆造命令——是最小的长期修复，而标记文件让这件事保持为一次性动作。
