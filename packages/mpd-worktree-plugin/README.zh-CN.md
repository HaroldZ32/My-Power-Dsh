# mpd-worktree-plugin

**中文** | [English](./README.md)

为 team 与 cellwork 的写入型 agent 提供「每位成员一个」git worktree。每个有写权限的成员都可以拥有
自己的 worktree 与分支，并作为子会话的**有效工作目录**（effective cwd）下发，于是成员可以并行写入而
不必共享 `.git/HEAD`。由 captain 手工把他们的分支合并进 wave 分支。

本包实现的冻结契约是 `.mpd/plans/agent-worktrees.md` §3 Lane A；它遵守的仓库级规则见
[AGENTS.md](../../AGENTS.md) §5（git 模型）与 §6（插件编写）。

## 工具

| 工具 | 作用 |
|---|---|
| `mpd_worktree_create { name, teamId?, member?, base?, branch?, repo? }` | 在 `<worktree dir>/<name>` 创建新分支（默认 `agent/<name>`）的 worktree，起点是主 checkout 的 HEAD，并记录到索引。已存在的路径、已注册的名字、已存在的分支都会被拒绝。 |
| `mpd_worktree_list {}` | 把每条记录与 `git worktree list --porcelain` 合并：`name, path, branch, repo, exists, dirty, ahead, behind, merged`。 |
| `mpd_worktree_status { name }` | 单个 worktree 的同一条记录。未知名字是结构化拒绝，并列出已知名字。 |
| `mpd_worktree_merge { name, into?, force? }` | 用 `git merge --no-ff` 把分支合并进主 checkout 的当前分支。冲突时执行 abort 并返回 `{ merged: false, conflicts }`，不改变任何东西。 |
| `mpd_worktree_remove { name, force? }` | 删除 worktree 目录并删除其分支。dirty 或未合并的 worktree 在缺少 `force: true` 时拒绝；目录已缺失则执行 prune，不视为错误。 |

`merged` 表示该分支是主 checkout 当前分支的祖先。`ahead`/`behind` 来自
`git rev-list --left-right --count <branch>...<main>`。

## 服务

除工具外，本行还发布 cordis 服务 `mpdWorktree` —— team-core 与 cellwork 两个 lane 唯一允许调用的
接口：

- `createForMember(exec, { teamId, member }) -> { path, branch } | undefined` —— 按
  `{teamId, member}` 幂等；worktree 落在 `<worktree dir>/<teamId>/<member slug>`，分支为
  `agent/<teamId>/<member slug>`。
- `cwdForMember(exec, { teamId, member }) -> string | undefined` —— compaction reseed 使用的只读查询。

两个方法**永不抛出**。工作区不是 git 仓库、本行被禁用或创建失败时返回 `undefined`，并在行日志里写
**恰好一行**；成员随后回落到共享 checkout —— 也就是今天的行为。

## 配置

`cordis.patch.yml` 中的行配置（挂载行自带 `config: {}`）：

```yaml
- id: mpd-worktree
  name: '@mpd-dsh/mpd/packages/mpd-worktree-plugin/dist/index.js'
  config:
    enabled: true                      # 默认 true；false 时不注册工具也不提供服务
    dir: .mpd/worktrees                # 相对工作区根目录（默认值）
    repo: .                            # 仓库；默认工作区根目录（若它是 git 仓库）
    base: main                         # 新分支的起点；默认主 checkout 的 HEAD
    branchPrefix: "agent/"             # 默认值
    protectedBranches: ["master", "dev"]  # 创建拒绝该分支名；删除/合并拒绝记录中的分支；合并目标需 force: true
    max: 32                            # 同时 ACTIVE 的 worktree 上限
```

当组合中存在 `mpd-config-plugin` 时，同一组叶子也可以在 workspace 的 `.mpd/mpd.jsonc` 的
`worktree` 段里设置（`worktree.enabled`、`worktree.dir` 等），文件按 key 覆盖行配置。缺少该服务时，
本行是**仅行配置**（row-config-only）——它不会自己读取 `mpd.jsonc`。

## 状态

持久状态在 `<workspace>/.mpd/worktrees/index.json`，版本 1：

```json
{ "version": 1, "worktrees": [
  { "key": "plan-abc/senior-engineer", "name": "plan-abc/senior-engineer",
    "teamId": "plan-abc", "member": "Senior Engineer", "repo": "/abs/repo",
    "path": "/abs/ws/.mpd/worktrees/plan-abc/senior-engineer",
    "branch": "agent/plan-abc/senior-engineer", "base": "main",
    "createdAt": "2026-11-12T00:00:00.000Z", "status": "active" }
] }
```

团队成员 `key` 为 `<teamId>/<member>`，其余为 `manual/<name>`。`status` 是 `active`、`merged` 或
`removed`。写入是原子的（同目录临时文件 + `rename`）；损坏或缺失的文件读作**空索引**，而不是让所有
操作卡死，畸形记录会被丢弃。

## 保证

- **D1 —— 状态保持共享。** 子会话的状态根是父工作区（`session.header.cwd` 被复制且不可变），只有
  **有效目录**移动。因此 team 记录、邮件与 verify loop 仍留在 `<parent workspace>/.mpd`。本包从不
  改变状态根。
- **D2 —— worktree 必须位于工作区内部。** 默认是 `<workspace>/.mpd/worktrees/<teamId>/<member>`；
  解析后的路径若离开工作区根目录，就以 D2 的理由拒绝。工作区之外的 worktree 在 `workspace-write`
  下对成员不可写；要开启需要 host 级的 `sandbox-policy.additionalWritableRoots` 行，那由部署方决定，
  不在本包范围内。
- **D3 —— 每位成员一个 worktree**，分支 `agent/<teamId>/<memberSlug>`，创建时基于主 checkout 的
  当前 HEAD。
- **D5 —— 每个 worktree 一个 git 写入者。** 成员只能在自己的 worktree（独立 HEAD）里执行 git 写入；
  主 checkout 与所有合并只归 captain。
- **受保护分支。** `mpd_worktree_merge` 拒绝把 `protectedBranches` 中的分支当作目标，除非
  `force: true`（默认 `["master","dev"]`），于是成员分支不会意外落到发布线上。在任一操作使用记录中的
  分支之前，`mpd_worktree_remove` 与 `mpd_worktree_merge` 都会用 git 为该 worktree 报告的符号分支
  （`git symbolic-ref --quiet HEAD`，去掉 `refs/heads/` 前缀）重新校验它，并对两种操作都拒绝
  `protectedBranches` 中的分支，即使 `force: true`。worktree 目录已消失时无法回答 HEAD：删除会剪除
  陈旧记录而不做实时比较（分支已不存在时 `branchDeleted: false`），合并仍然拒绝。创建在
  `git worktree add` 之前就应用同一列表：`mpd_worktree_create` 与成员服务的 reattach 恢复都会以
  `protected-branch` 拒绝 `protectedBranches` 中的分支名，并且只接受短分支名（`refs/...` 写法会以
  `invalid-branch` 拒绝，且发生在任何分支、HEAD、工作树或索引变更之前），因此工作树不可能建在
  受保护分支上、再被上述复检卡死。
- **冲突中止。** 冲突的合并会执行 `git merge --abort`，返回冲突路径，且不改变任何东西 —— HEAD 不动、
  没有进行中的合并、没有冲突标记。

## 手工合并流程

1. 成员创建或获得自己的 worktree，并在 `agent/<teamId>/<memberSlug>` 上提交。
2. captain 先查看（`mpd_worktree_status`），然后合并：`mpd_worktree_merge { name }` —— 目标是主
   checkout 的**当前**分支。
3. wave 落地后 captain 移除 worktree：`mpd_worktree_remove { name }`（记录保留为 `removed` 墓碑）。

没有自动合并队列，也没有合并后的自动 gate 运行。

## 已声明的边界

- official-executor 回退路径无法设置子会话 cwd（契约 D7）；这样的成员运行在共享 checkout 中，日志会
  说明这一点。
- 成员仍运行在父工作区的 sandbox 边界内；见上文 D2。
- 工作树所用的**仓库**必须位于工作区根目录处或其之下：插件会规范化该仓库的 git 顶层目录，对落在工作区根
  目录之外的仓库以 `repo-outside-workspace` 拒绝。因此，本身是更大 git 仓库子目录的工作区会被拒绝；仓库
  位于工作区根目录或嵌套其下则受支持。
- team 结束时**不会**自动销毁 worktree；`mpd_worktree_remove` 是显式操作。
- 未追踪外部/SDK subagent provider；只声明原生进程内（native in-process）后端。
- `.mpd/mpd.jsonc` 的 `worktree.*` 覆盖依赖已组合的 `mpdConfig` 服务；单独运行时本行只读行配置。

## 构建 / 测试

在仓库根目录用**固定的**工具链构建（PATH 上的 `bun` 是已测量的陷阱；见 AGENTS.md §6）：

```sh
.toolchain/node_modules/.bin/bun build packages/mpd-worktree-plugin/src/index.ts \
  --target node --format esm --outfile packages/mpd-worktree-plugin/dist/index.js
bun test packages/mpd-worktree-plugin
```

测试套件用一个**真实的**临时 git 仓库驱动工具所注册的同一批操作：创建、list/status 字段、重复创建
拒绝、越界路径拒绝、合并成功、冲突中止且主 checkout 干净、受保护分支、带/不带 `force` 的移除、索引
持久化与损坏读容忍，以及永不抛出的成员服务。
