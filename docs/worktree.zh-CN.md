# Agent 工作树

**中文** | [English](./worktree.md)

团队或 cellwork 成员是独立会话，但默认和队长共用同一份 checkout。两个有写权限的成员就会争抢同一个
`.git/HEAD`，一个座位里误跑一次 `reset`，就会把别的座位脚下的分支一起挪走。工作树特性给每个有写权限的成员
一份自己的 git 工作树与自己的分支，并把它作为子会话的**有效**工作目录（`cwd`）下发，于是成员可以并行编辑、
并行提交，队长按任务顺序把它们的分支合并进波次分支。

## 概念

- 工作树是**同一仓库**的第二份 checkout，有自己的 `HEAD`。成员工作树位于
  `<workspace>/.mpd/worktrees/<teamId>/<memberSlug>`，分支为 `agent/<teamId>/<memberSlug>`，以创建时主
  checkout 的 `HEAD` 为基点。
- 移动的只有**有效**工作目录，状态根不动（见下文 D1）：team 记录、邮件、验证循环与 journal 都留在父
  workspace，每个成员读到的看板和队长是同一块。
- 工作树属于**成员**而不是任务：同一个座位在它经手的多个任务之间复用同一份工作树。只读座位（Explorer、
  Researcher 以及分析席）永远没有工作树——它们不能写，给 checkout 只是开销。
- 创建发生在成员拉起/激活时，经由 `mpdWorktree` 服务的 `createForMember` 自动完成；手动 `mpd_worktree_*`
  工具操作同一份索引，用于手工开场、合并或清理。

## 保证

### 状态留在父 workspace

D1：子会话的 `session.header.cwd` 从父会话复制且不可变；拉起时传入 `cwd` 只移动有效工作目录。因此子会话的
状态根——以及沙箱边界——仍然是父 workspace。由此可得：`.mpd/team/`、cell 邮件、验证记录与 journal 都共享在
`<workspace>/.mpd` 下，绝不会被复制进工作树；成员对看板的改动队长立即可见。

### 工作树位于 workspace 根目录之内

D2：工作树**必须**位于父 workspace 根目录之内——默认
`<workspace>/.mpd/worktrees/<teamId>/<memberSlug>`。创建时会解析路径，目标落在根目录之外则按 D2 理由拒绝；
插件绝不会注册这样的路径。

### 根目录之外的工作树对成员只读

成员运行在 `workspace-write` 沙箱下，围栏就是父 workspace，并且会重新规范化路径（符号链接式的授权也会被
拒绝）。因此检出在根目录之外的工作树对成员是**不可写**的，即使路径被交给它也一样：实际上就是只读。要放行
必须由**宿主**层添加 `sandbox-policy.additionalWritableRoots` 行，那属于部署方，本 bundle 不负责。

## 成员工作流

1. **创建**——拉起成员时（或按需调用 `mpd_worktree_create`）为它创建工作树与分支，两者都登记在
   `<workspace>/.mpd/worktrees/index.json`。
2. **cwd**——拉起请求把工作树路径作为成员的有效工作目录下发。压缩/重启（reseed）会重新下发同一路径，因此
   被重启的座位仍留在自己的工作树里。
3. **工作与提交**——成员编辑、跑自己的门禁，并在 `agent/<teamId>/<memberSlug>` 上提交。它拥有那个 `HEAD`，
   绝不在主 checkout 里提交。
4. **合并**——评审结论落地后，队长用 `mpd_worktree_merge` 把成员分支合并进波次分支（默认目标：主 checkout
   的当前分支）。
5. **移除**——合并之后（未合并时加 `force`）用 `mpd_worktree_remove` 删除工作树及其分支。

**合并是手工的、由队长驱动。** 没有合并队列，合并后也不会自动跑门禁：合并顺序由队长决定，合并由队长执行，
并在合并后的 tip 上重跑波次门禁。`mpd_worktree_merge` 会拒绝处于 detached 或有被跟踪改动的脏主 checkout，
拒绝受保护分支（`master`、`dev`）除非 `force: true`；发生冲突时执行 `git merge --abort`，报告冲突文件并且
不做任何改动。

## 工具

| 工具 | 作用 |
|---|---|
| `mpd_worktree_create { name, teamId?, member?, base?, branch?, repo? }` | 创建工作树与分支；`slug` 必须匹配 `[a-z0-9][a-z0-9._-]{0,79}`，路径必须在 workspace 根目录之内，路径不得已存在、名字不得已注册；返回 `{ name, path, branch, base, repo }` |
| `mpd_worktree_list {}` | 把 `git worktree list --porcelain` 与索引合并；每条报告 `{ name, path, branch, repo, exists, dirty, ahead, behind, merged }` |
| `mpd_worktree_status { name }` | 单个条目的同一份记录；未知名字是结构化错误 |
| `mpd_worktree_merge { name, into?, force? }` | 把成员分支 `git merge --no-ff` 进 `into`（默认主 checkout 的当前分支）；拒绝上述条件；成功则把条目标为已合并并返回 commit，冲突则中止并返回 `{ merged: false, conflicts: [...] }` |
| `mpd_worktree_remove { name, force? }` | 移除工作树并删除分支；未合并或有脏改动时拒绝，除非 `force`；路径已不存在按 prune 处理，不算错误 |

分支默认是 `<branchPrefix><slug>`（`branchPrefix` 默认 `agent/`）。经由服务创建的成员使用 D3 形状
`agent/<teamId>/<memberSlug>`；`base` 默认主 checkout 的当前 `HEAD`（分离头时用 SHA）。

## 配置

这些旋钮是 `cordis.patch.yml` 中 `mpd-worktree` 挂载行的 row config：

| 键 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关；`false` 时所有成员都在共享 checkout 中拉起 |
| `dir` | `<workspace>/.mpd/worktrees` | 工作树根目录 |
| `repo` | workspace 根目录（当它是 git 仓库时） | 创建工作树所用的仓库 |
| `base` | 主 checkout 的 `HEAD` | 新工作树的基点 ref/分支 |
| `branchPrefix` | `"agent/"` | 默认分支名的前缀 |
| `protectedBranches` | `["master","dev"]` | `mpd_worktree_merge` 拒绝合并的分支，除非 `force: true` |
| `max` | `32` | 已登记工作树的上限 |

## 降级规则

默认开启，降级绝不失败。如果 workspace（或配置的 `repo`）不是 git 仓库、创建失败、或插件被禁用，成员就在
**不带** `cwd` 的情况下拉起——与今天的共享 checkout 行为完全一致——并通过 adapter 的行日志记**一行**。降级
拉起不是错误，也绝不阻塞看板。

官方执行器回退是一条已声明的边界：官方 `teams.spawnTeammate` 路径带不了 `cwd`，因此该成员在共享 checkout
中运行并记一行日志。只读成员同理，它们按设计被跳过。

## 声明边界

- 合并是手工的、由队长驱动；没有自动合并队列，合并后也不会自动跑门禁。
- 在宿主添加 `additionalWritableRoots` 条目之前，workspace 根目录之外的工作树对成员只读；本 bundle 不提供
  这样的条目。
- 工作树所用的仓库必须位于 workspace 根目录处或其之下：插件会规范化该仓库的 git 顶层目录，对落在 workspace
  根目录之外的仓库以 `repo-outside-workspace` 拒绝。因此，本身是更大 git 仓库子目录的 workspace 会被拒绝；
  仓库位于 workspace 根目录或嵌套其下则受支持。
- 官方执行器回退带不了 `cwd`，因此这样的成员在共享 checkout 中运行。
- team 结束时工作树不会被自动销毁；`mpd_worktree_remove` 是显式的。
- 只覆盖原生进程内 subagent 后端。外部/SDK 的 subagent provider 未被追踪，也不作承诺。
