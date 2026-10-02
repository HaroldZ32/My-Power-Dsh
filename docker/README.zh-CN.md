# Docker 客户端安装端到端测试（ubuntu 24.04 + compose）

[English](./README.md)

在仓库根目录执行一条命令：

```bash
node scripts/docker-e2e.ts
```

它会通过 `docker/docker-compose.yml` 构建 `docker/Dockerfile`（一个纯净的 `ubuntu:24.04`，其中没有
node、没有 bun、没有 pnpm、也没有 dsh），运行 `mpd-client` compose 服务，把容器控制台实时输出到终端，
并把证据写入
`evidence/docker/client-install/<UTC 时间戳>/{result.json, output.log, console.log, driver.json}`。
仓库内不会产生任何副本：构建上下文就是仓库根目录，由 `docker/Dockerfile.dockerignore` 负责过滤。

退出码：`0` 表示每个断言都为真或显式为 `null`；`1` 表示至少有一个断言为假；`2` 表示本次运行完全没有产出
`result.json`；`3` 表示宿主机上没有可用的 docker。

## 容器内实际执行的步骤

`docker/entrypoint.sh` 按顺序执行，并为每一项观测记录一个断言：

1. 断言构建上下文已被过滤（`copy.contextFiltered`）。如果宿主机的 `node_modules`、`.git`、
   `evidence`、`.toolchain` 或打包产物 `dist/` 泄漏进镜像，`bun install` 就可能"借用"宿主机已有的模块
   而假装成功；此时本次运行会直接中止，而不是靠借来的零件变绿。
2. `apt-get update` 与 `apt-get install -y --no-install-recommends curl git ca-certificates unzip
   xz-utils` —— `ubuntu:24.04` 一个都没有。
3. 用官方 tarball 安装 Node.js 24，并**用官方发布的 `SHASUMS256.txt` 校验 sha256**；再用官方安装脚本
   安装 `bun`。两者版本都被断言。
4. 安装 `pnpm`（`npm i -g pnpm@…`）。这不是装饰：`dsh plugin <args>` 会在 profile 目录里转发给
   `pnpm`，缺少它时 harness 会打印 `pnpm was not found; install pnpm and make it available on PATH`。
   没有 pnpm 的机器根本无法安装 bundle。
5. `npm i -g @deepseek-ai/dsh@0.2.0-rc.2`（默认 pin；可用 `MPD_E2E_DSH_VERSION=<版本>` 覆盖 ——
   `docker/docker-compose.yml` 负责透传，`docker/entrypoint.sh` 负责读取），然后断言 `dsh --version`
   打印的字符串**完全等于**该版本号。
6. 把检出复制到 `/opt/mpd`，执行 `bun install`，并按 `AGENTS.md` §6 的规范仓库根命令**从源码重建每一个**
   `packages/*/dist` 条目（`bun build packages/<pkg>/src/<entry>.ts --target node --format esm --outfile
   packages/<pkg>/dist/<entry>.js`）。
7. 切换到隔离的 `HOME=/root/sandbox-home` 与 `DSH_HOME=/root/sandbox-dsh`，然后执行真正的客户端安装：
   `cd /opt/mpd && dsh plugin --profile web add .`。
8. 用受认可的封装器组合 profile（`node scripts/dump-config.ts --profile web`），断言 mpd 行 id、
   `preset-mpd` 行，以及三个官方 agent-team 行及其包名。**这一步只是 COMPOSITION（组合）证据**——它不会
   执行任何插件代码。
9. 通过 `--patch` 插入注册插桩（`docker/probe.ts`）来**启动**已安装的 profile，并从启动日志断言插件树
   确实挂载了：探针的 `apply()` 执行过；适配器提供了 `mpdDsh`；通过适配器发起的一次内部工具调用返回
   `ok`；每一个核心 mpd 工具都从活体工具注册表应答；官方 TeamService 已挂载（`ctx.get("agentTeams")`
   → 类 `TeamService`，即 `mpd-agent-team` 行提供的服务）；官方 agent-team 工具同样从注册表应答；Web 应用
   返回 HTTP 200；并且没有致命的 apply/模块错误特征。第三行 `mpd-ui-agent-team` 是浏览器侧发现的插件，其
   宿主侧只是一个空的 `apply()`——证据把它能拿到的最强服务端事实（已组合、无 apply 失败、包已在 profile
   中落地且 `dsh.client.platform=web`）记为 observation，而不是暗示一个并不存在的加载证明。
10. 通过 `POST /api/session/create`（`agentPreset: "mpd"`，沙箱 `cwd`）**创建会话**，并断言
    `result.ok === true` 且 `agentPreset: "mpd"`（`boot.presetMount`）。只要该 preset 有任何一行未能激活，
    网关就会拒绝该请求，因此这就是 preset 的**挂载**证明——与第 8 步的"仅组合"不同。鉴权走**签名 Cookie**：
    网关在携带启动日志中 `?token=` 的根请求上签发 Cookie，且仅凭该 Cookie 放行 `/api/*`，因此这一步像浏览器
    一样使用 cookie jar（裸 POST 会得到 `401 unauthorized`，2026-09-27 实测）。token 行是**轮询获取**而不是只读
    一次：`dsh web: …?token=…` 只有在整棵插件树挂载完成后才会打印，提前读取会得到空 token、没有 Cookie，进而
    401——这正是"同一天同一插桩先绿后红"的实测原因。请求体是 RPC 信封
    `{type:"client-request", rpcId, method, payload}`（不是裸 body），`method` 必须是完整 endpoint
    `session/create`，且会话创建还会校验响应回显的 `rpcId` 与请求一致。
11. **在官方团队工具真正所在的层面判定它们。** 它们注册在**唯一确定的 Agent 作用域**内
    （`@deepseek-ai/dsh-experimental-tool-agent-team` 按 agent 调用 `scoped.tools.register(...)`），因此根层
    读取返回 `0/9` 是**设计如此**——本 lane 第一次 Docker 运行就测到了这一点：根层读数看起来像失败，而插件树
    其实是健康的。探针因此把根层读数记为 observation，并为它看到的每个 agent 打印一行；第 10 步创建的会话
    提供了那个 agent，`boot.agentTeamTools` 就以该 Agent 作用域的行为准。
12. **断言会话门是"活的"而不只是"挂着的"。** 会话创建之后，启动日志必须包含
    `[mpd-roles] session gate listener registered for agent "…" agentPreset=mpd`
    （`boot.sessionGateListener`）。在 v0.10.0 中，会话启动复杂度门虽然挂载却从未触发——"行已组合"从来不是该契约的
    证据——因此这一行（在本轮运行创建的会话的 `agent/created` 上打印）才是它的存活证明。
13. 断言隔离：沙箱 `HOME`/`DSH_HOME` 确实生效；真实 `/root` 下不存在任何 harness 或工具链标记
    （`.dsh`、`.mpd`、`.npm`、`.bun`）；没有任何凭据文件携带形似密钥的**值**（harness 在沙箱 home 中生成的
    空 `.credentials.yaml` 是预期行为，并连同其大小一起登记）。随后 reporter 会重新读取自己写出的产物，拒绝
    让任何 token 形状残留其中（`evidenceScrubbed`；一旦泄漏即判定为红，并用定向清洗重写两个文件）。
14. 把 `boot.llmTurn` 记为 **`null` 并附原因**——见下。
15. **跑一遍 DSH-TUI 版本**（`docker/tui-lane.sh`）——这是开发机唯一无法演练的 profile：TUI 宿主必须从 npm
    装进一个可写的全局前缀，并在真正的 PTY 上启动。该步安装 `@deepseek-harness-tui/dsh-tui@0.12.0`
    —— 其 peer 范围覆盖本 lane 会跑的整段区间（`0.1.7-rc.2`、`0.2.0-rc.1` 与 `0.2.0-rc.2`）；`0.11.2`
    只到 `0.2.0-rc.1`，对上 `0.2.0-rc.2` 时 `dsh plugin --profile dsh-tui add` 会因 peer 范围被拒。
    可用 `MPD_E2E_TUI_VERSION` 覆盖，并与 `MPD_E2E_DSH_VERSION` 保持配套。它把本 bundle 作为第三层 patch 装进 `dsh-tui`
    profile，并记下十一条断言：宿主安装、两次 `plugin add`、组合、**TUI 自带作用域注册表行携带
    `default: mpd`**、`preset-mpd` / `mpd-tui` / 官方团队行、真实 tmux PTY 启动并到达聊天界面、无致命签名，
    以及所创建会话**实际**运行的预设——从 harness 自己的会话存储读出（`agentPreset: "mpd"`），绝不从界面文本
    推断。若默认仍是 `standard`，TUI 就会去启动一个该组合并未声明的预设，因此这是一次真正的验收，不是冒烟。

## 它证明了什么——以及没有证明什么

证明：

- 干净的 `ubuntu:24.04` 能获取工具链，并按固定版本安装 `@deepseek-ai/dsh`；
- bundle 能用**一条命令**从**本检出的副本**安装（无需打包步骤、不依赖宿主机工作区、不要求预构建的
  `dist/`——dist 全部从源码重建）；
- 已安装的 profile **组合**出了 mpd 行与官方 agent-team 行（**仅组合**——`result.json` 把这一主张单独放在
  `provesCompositionOnly` 字段里，绝不与加载证明混在一起）；
- 已安装的 profile **确实挂载**：插件代码执行了，适配器提供了服务，mpd 工具已注册，官方 TeamService 已挂载，
  官方团队工具在 Agent 作用域内应答，mpd 会话门监听器为真实会话完成注册，`mpd` preset 能为真实会话激活，
  Web 应用在提供服务。

没有证明：

- **任何真实的 LLM 回合或模型路由。** 容器内不复制、不读取、不写入任何凭据（`AGENTS.md` §10），因此不会发起
  模型请求。该断言以 `null` 加原因记录——绝不记为通过。
- 组合出的行列表与挂载的行列表完全一致。`--dump-config` 只组合行、从不执行插件代码（`AGENTS.md` §4）；证据中
  它被标注为仅组合，所有挂载主张都来自第 9 步的启动或第 10 步的会话创建。
- 打包/tarball 安装（`dist/mpd-package`）或迁移安装；
- 离线运行：apt、nodejs.org、bun.sh、npm 与包注册表都会被使用。

## 仓库是如何进入镜像的

`docker/docker-compose.yml` 使用 `context: ..`（仓库根目录）与 `dockerfile: docker/Dockerfile` 构建；
Dockerfile 把该上下文复制到 `/src`。**磁盘上不存在任何暂存目录或临时副本**——本 lane 早期的一个版本曾把整棵树
复制到 `docker/src`，而那份仓库内副本被 `bun test` 的 glob 以及所有遍历目录的门禁拾取（2026-09-27 实测），
因此该机制被移除而不是换个位置。

上下文携带什么由 `docker/Dockerfile.dockerignore` 决定，BuildKit 会为 `docker/Dockerfile` 的构建应用它
（已在 Docker 29.8.1 上验证）。该文件与被它约束的 Dockerfile 放在一起，因此本仓库不需要根级
`.dockerignore`。它排除：

| 被排除项 | 原因 |
|---|---|
| `.git`、`.gitignore`、`.gitattributes` | 安装不应依赖历史 |
| `node_modules`、`**/node_modules` | `bun install` 会在容器内重建 |
| **根级** `dist/` | 本仓库的打包产物，不是源码输入 |
| `evidence`、`.qa-*`、`.toolchain`、`.codegraph`、`.t18ev`、`.t28ev`、`.bun-tmp`、`.mpd` | 宿主机本地状态 |

`packages/*/dist` 是**刻意保留**的：容器会从源码重建它们，而这次重建本身就是一个断言，不是走过场。过滤结果还会
在容器内被断言（`copy.contextFiltered`），因此泄漏的上下文绝不可能产生假绿。

**该主张的边界，明确写在这里以免被过度解读：** `docker/Dockerfile.dockerignore` 仅在**用该 Dockerfile 路径
进行 BuildKit 构建**时生效——Docker 29.8.1 自带的 docker CLI（`docker compose build`、
`docker build -f docker/Dockerfile`）满足该条件，且驱动还会在容器内断言过滤结果。若审阅者用**其他构建器**
（或把 Dockerfile 复制到别的路径——那会改变 BuildKit 查找的 ignore 文件名）构建同一上下文，则不得把本次运行
读作"上下文已被过滤"的证明：请查看 `result.json` 中的 `copy.contextFiltered`，它在容器内求值，因此对产生该
镜像的任何构建器都成立。

## 环境（Environment）

本 lane 所处的沙箱禁止在仓库之外写入，而 docker CLI 会把 buildx 状态放在 `$DOCKER_CONFIG`（默认
`~/.docker/buildx`），因此直接 `docker build` 会失败：
`mkdir <home>/.docker/buildx: read-only file system`。驱动因此为每个 docker 子进程把 `BUILDX_CONFIG`
指向一个私有可写临时目录（调用方自己设置的值优先），并在结束时删除；真实 `~/.docker` 中的 rootless docker
上下文仍被使用，且**不会复制任何凭据文件**。手工执行时，先 `export BUILDX_CONFIG=$(mktemp -d)` 再调用
compose。

构建还需要**守护进程**（而不是驱动进程）能从 Docker Hub 解析两个基础镜像——`node:24-bookworm` 与
`ubuntu:24.04`；本地镜像库为空时这就是硬前置条件而非缓存命中：路由不通时运行会在 buildx 的
`load metadata` 阶段就失败，此时一层都还没构建。2026-10-02 在一台「IPv6 出网全部被重置、IPv4 可达
registry」的机器上实测：守护进程拨的是 AAAA 记录，连续三次运行都死在
`read: tcp [...]:443: read: connection reset by peer`。解法不需要改守护进程配置——改从一个**不发布
AAAA 记录**的镜像源拉取（这样只能走 IPv4），再打回 Dockerfile 中 `FROM` 使用的官方名字：

```bash
# 实测使用 docker.m.daocloud.io；任何纯 IPv4 镜像源同样可行
docker pull docker.m.daocloud.io/library/ubuntu:24.04
docker tag  docker.m.daocloud.io/library/ubuntu:24.04 ubuntu:24.04
docker pull docker.m.daocloud.io/library/node:24-bookworm
docker tag  docker.m.daocloud.io/library/node:24-bookworm node:24-bookworm
```

此后 `docker compose build` 会直接从本地镜像库解析两个 `FROM` 阶段，lane 无需任何改动即可运行。

## 隔离模型

- `docker/docker-compose.yml` 只声明**一个**服务与**一个**绑定挂载：证据目录 `/out`。它不挂载 `$HOME`、
  `~/.dsh`、`~/.mpd`、`~/.agents`、docker socket 或仓库本身，并且
  `node scripts/docker-e2e.ts --self-test` 会静态断言这一点。
- 容器内的 `HOME` 与 `DSH_HOME` 在工具链运行**之前**就被重定向到沙箱路径，`NPM_CONFIG_CACHE` /
  `BUN_INSTALL` 指向 `/opt/toolchain`，因此连包管理器缓存都不会落到真实 home。
- 证据中的本地 Web UI token 由两道彼此独立的脱敏（容器内的 reporter 与宿主机驱动）清除；reporter 还会重新读取
  自己写出的产物，以证明没有任何 token 形状残留（`evidenceScrubbed`；其触发路径在 `--self-test` 中有负向对照）。

## 开关与退出码

```bash
node scripts/docker-e2e.ts --self-test   # 离线：不需要 docker，也不需要网络
node scripts/docker-e2e.ts --no-build    # 复用已有的 mpd-docker-e2e:local 镜像
```

不需要驱动时的原始 compose 路径：

```bash
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml run --rm mpd-client
# 除非 MPD_DOCKER_OUT 指向别处，证据会落在 docker/out/
```

若失败信息为 `mkdir <home>/.docker/buildx: read-only file system`，见上文 **环境（Environment）**
（`export BUILDX_CONFIG=$(mktemp -d)`）。

退出码：`0` 所有断言为真或 `null`；`1` 至少一个为假；`2` 没有 `result.json`；`3` 宿主机上没有可用的
docker。

## 如何阅读一次红色运行

1. `evidence/…/result.json` → `summary.failedNames` 列出失败的断言；每一项都带有 `reason` **以及**支撑该判定
   的原始日志行。
2. `evidence/…/output.log` → 同样的判定，外加每一步的完整输出（已脱敏）。底部的断言清单是最快的读法。
3. `evidence/…/console.log` → 宿主机看到的容器原始控制台输出。
4. `evidence/…/driver.json` → 宿主机做了什么：镜像大小、确切的 docker 命令及其退出状态、以及使用的 buildx
   状态目录。

记为 `null` 的断言**不是**通过：它表示本次运行在到达该断言之前就停止了（`reason` 会说明），或该断言被有意排除在
范围之外（目前只有 `boot.llmTurn`）。`result.json` 还带有 `evidenceScrubbed` 字段——它是从已写出的产物重新读回
得出的，而不是来自内存。

## 自检

`node scripts/docker-e2e.ts --self-test` 是离线的，既不需要 docker 也不需要网络。它检验驱动自身的记账逻辑
——UTC 证据时间戳、判定到退出码的映射、脱敏规则、BUILDX_CONFIG 注入——以及 compose 文件、Dockerfile、
ignore 文件与 entrypoint 的静态规则，并对证据写入做一次往返验证。记账未被检验的驱动只会产出自信的废话，
所以它先被检验。
