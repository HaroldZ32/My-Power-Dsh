# 把 `mpd` 预设设为默认

[English](./preset-default.md)

本页说明**部署默认 agent 预设**究竟由谁决定、为什么本 bundle 不能替你设置它，以及切实可行的设置步骤
——分别针对 dsh-tui 配置与 web/headless 配置。如果你在升级本 bundle 之后发现新会话不再默认使用 `mpd`
预设，请读这一页。

## 部署默认值属于宿主（host）的行

默认预设是**宿主的一行**上的 `config.default`，即 `@deepseek-ai/dsh-agent-preset-registry`。
有两个宿主层会各自在自己的组合里声明它：

| 组合 | 行 id | 声明方 | 出厂默认值 |
|---|---|---|---|
| web / headless | `agent-preset-registry` | `@deepseek-ai/dsh-web-app` 自带的 `cordis.patch.yml` | `standard` |
| dsh-tui | `dsh-tui-agent-preset-registry` | `@deepseek-harness-tui/dsh-tui` 自带的 `cordis.patch.yml` | `standard` |

本 bundle 以**追加（additive）**方式提供 `mpd` 预设 —— 即
[`presets/mpd.patch.yml`](../presets/mpd.patch.yml) 中的 `preset-mpd` 行，它是清单
`dsh.bundle.patch` 数组的第二层 —— 因此安装本 bundle 之后，`mpd` 在两种组合里都是**可用**的，
但都**不是默认值**。

本 bundle 有意**不覆盖**上述行（strict zero-override，见 [`cordis.patch.yml`](../cordis.patch.yml)）。
有两个事实决定了这是唯一正确的做法：

1. **对宿主行做 id-target 就是替换宿主的决定**。本 bundle 发布的插件行可以增加能力，但不能悄悄接管
   本属于部署方的选择 —— 而被删除的那两个 id-target 做的正是这件事。
2. **再加一行注册表行同样行不通**，而且这是实测而非推断：两行同时挂载
   `@deepseek-ai/dsh-agent-preset-registry`，都会提供 `agentPresets` 服务，第二行的挂载会失败并报
   `Error: service "agentPresets" has been registered at <AgentPresetRegistry>`（在隔离沙箱中用这样一行
   追加行实测得到）。整个组合仍能继续，但那一行永远不会激活 —— 所以它不是修改部署默认值的途径。
   默认值仍然要由你通过下面受支持的渠道来设定。

## 把 `mpd` 设为默认

### 方案 1 —— dsh-tui：`/preset mpd`

在 dsh-tui 里执行 `/preset`，选择 **MPD (Main Working Agent)**。TUI 会把你的选择持久化到
`~/.dsh-tui/agent-preset.json`，重启后依然有效。这是官方推荐的交互路径，不需要手工改任何文件。

### 方案 2 —— dsh-tui：`DSH_TUI_PRESET=mpd`

在**你自己的** profile patch（`<DSH_HOME>/profiles/<profile>/cordis.patch.yml`）中，TUI 宿主行接受
显式指定的预设：

```yaml
- id: dsh-tui
  name: "@deepseek-harness-tui/dsh-tui"
  config:
    preset: mpd
```

从环境变量读取 `DSH_TUI_PRESET` 是等价的一行写法
（`preset: !!js process.env.DSH_TUI_PRESET ?? undefined`），而且它**优先于**上面那个持久化偏好文件。
需要把整个配置固定下来的场景（例如容器镜像）优先用这一种。

### 方案 3 —— web 与 headless：设置里的 `selectedDefault`

在 Web UI 中打开 **设置（Settings）→ Agent preset**，选择 `mpd`。这会写入
`agent-preset-registry` 条目的 `selectedDefault` **volatile 字段**；注册表在为新建会话解析默认值时，
会优先采用它而不是部署的 `default`。整个过程不改文件、不覆盖任何宿主行。这一平面没有偏好文件 ——
该字段就是通道。

### 方案 4 —— 一条命令的助手脚本

```
node scripts/set-default-preset.ts                 # 试运行：打印解析后的路径与将要写入的字节
node scripts/set-default-preset.ts --yes           # 真正应用（写入 ~/.dsh-tui/agent-preset.json）
node scripts/set-default-preset.ts --profile web   # web/headless：打印设置步骤，不写任何文件
node scripts/set-default-preset.ts --home /tmp/qa  # 为 QA 指定沙箱 HOME
```

该助手**默认是试运行（dry-run）**，并且总是先打印解析后的绝对路径；必须加 `--yes` 才会落盘。对
dsh-tui 配置，它写入的字节与 dsh-tui 自己的写入函数完全一致；对 web/headless 配置，它不写任何东西，
只打印设置界面与 `DSH_TUI_PRESET` 两条路径。`--home` 与 `--dsh-home` 用于把它指到沙箱；只有当解析
出的目标**确实**是真实的 `~/.dsh-tui` **且**传了 `--yes` 时，才会写入真实主目录。

## 文件的确切格式

`~/.dsh-tui/agent-preset.json` 只有一个键。下面就是 dsh-tui 自带的 `writePresetPref` 写出的
逐字节内容 —— 两空格缩进 JSON，**结尾没有换行符**：

```json
{
  "preset": "mpd"
}
```

超出 dsh-tui 自身边界（`^[a-z0-9][a-z0-9-]*$`）的 id 会被它的读取逻辑忽略，因此助手脚本会直接拒绝这类
id，而不会写出一个注定被丢掉的文件。

## 对已有用户意味着什么

如果你安装过本 bundle 的较早版本，那两个 id-target 曾让 `mpd` 成为你的默认值。它们已被删除，这意味着：

- **在你自己执行上面四个方案之一以前，默认值不再是 `mpd`。** 本 bundle 仍然提供 `mpd` 预设，
  只是它现在需要你显式选择。
- 在 **dsh-tui** 配置下，回退值是宿主默认的 `standard`，而 dsh-tui 并不提供这个预设行。**实测**：会话仍会
  启动，且会话自己的记录读到 `agentPreset: "standard"`，但它**不会**组合 `mpd` 预设——mpd 的人格、指令与工具行
  都没有生效。解析路径来自源码而非观测：注册表在遇到自己没有记录的 id 时会回答 `agent-preset/not-found`
  （`Unknown agent preset: standard`），而 TUI 照旧组合下去。这条警告**没有被捕获**——在四次沙箱启动的终端字节流
  （该字节流同时合并 stdout 与 stderr）中它一次都没有出现，配置目录下的任何文件也没有记录它。方案 1 与方案 2
  一步即可解决。
- 在 **web/headless** 配置下，回退值是该配置原本的 `default`，通常是 `standard`，而那个平面确实提供
  它。
- 其他方面没有损失：没有任何能力被移走，没有任何行消失；显式请求 `agentPreset: mpd` 的会话与以往
  完全一致。

## 验证默认值已生效

有两个仓库门禁覆盖该策略与挂载：

```
node scripts/verify-no-host-override.ts            # 任何发布行若 id-target 宿主行就会失败
node scripts/verify-no-host-override.ts --self-test
node skills/dsh-qa/scripts/preset-conformance.ts  # `mpd` 预设确实能在已安装的宿主上挂载
```

两者都带有含负向对照的 `--self-test` 分支，所以绿灯是可证伪的。若要端到端确认用户侧通道，请用
`--home <沙箱>` 运行助手脚本，再用 `HOME=<沙箱>` 启动一个 dsh-tui 会话：该会话会从助手写出的文件里
解析出 `mpd`。

返回文档中心：[`docs/index.md`](./index.md)。
