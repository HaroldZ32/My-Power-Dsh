# mpd-memory-plugin
**中文** | [English](./README.md)

Plan C / C6 — 基于 git/svn 的记忆引擎，带一个 reflection（反思）状态机。

**本包是 mpd 自有代码。** 引擎的语义——markdown 记忆文件带 frontmatter（`description`/`kind`/`aliases`/`read_only`）、journal 加 facts 队列（属于已记录的存储布局；目前没有工具写入它）、以及一个按步数计数的 reflection reducer——是依据上游包 `memory-core` 的**已记录行为**（base 8c57e46，SUL-1.0）在此**重新表达**的。没有翻译任何上游源码，也没有复制任何上游提示词或文本。

**VCS 抽象与 svn 后端是我们自己的，不属于上游。** 上游 `memory-core` 是**仅 Git** 的（`GitMemoryRepo`；并不存在 `SvnMemoryRepo`），因此 `git | svn | both` 模式及其 svn 一侧的全部实现都是本包自己的工作——绝不可把这套框架说成源自上游。

*历史。* reducer 的早期草稿沿用了上游的状态机词汇（`reflected_completed_steps`、`steps_since_last_successful_reflection`、`reservation`，以及某个工具描述里的 `completeTransition`）。**de-omo wave F 已用本包自己的词汇替换之**：`reflectionsCompleted`、`stepsSinceReflection`、`pendingReflection`。

## 持久化状态

状态文件是 `<runtime>/reflection.json`，它是真实的用户数据：wave F 之前写入的记录带有旧字段名，因此读取端**仍然接受**它们并映射为当前字段（`adoptLegacyState`）。该映射只读——下一次 reflection 更新只会持久化当前字段名，不残留任何旧键，因此不需要单独的迁移步骤。仓库中没有其他地方读取这些字段：`skills/dsh-qa` 的 memory smoke 用例只读写入计数器 `steps`。

## VCS 后端（`memory.vcs`: git | svn | both）

- `git`：`repo/.git` 工作副本；每次写记忆即提交。
- `svn`：用 `svnadmin create`（file:// URL）创建 `root/svn-repo`，再检出到 `repo/`；每次写入执行 `svn add --force` + `svn commit`。
- `both`：同时提交到 git 与 svn（svn primaries 位于 svn-repo 之下）。
- svn 依赖 `svn` CLI（安装：Debian/Ubuntu 上 `apt install subversion`，macOS 上 `brew install subversion`，Windows 上使用 TortoiseSVN CLI）。
- **已用真实 svn 1.14.5 验证**：`svnadmin create` → checkout → write → `svn commit` → `svn log` 显示该记忆提交（evidence/plan-c/c6-memory/svn-real）。

## 路径

`<workspace>/.mpd/memory/agents/<slug>/{repo, runtime/{reflection.json, journal.jsonl}}`
（slug = `config.agentSlug`，或由 workspace 基线名推导）。

## 工具

- `mpd_memory_write({title, content, kind?, tags?, readOnly?})` — 持久化 + 提交；递增 reflection 步数计数器（跨过 `reflectionEvery` 时给出“到期”提示）。
- `mpd_memory_read({query?, kind?, limit?})` — 在条目上做子串/别名搜索。
- `mpd_memory_reflect` / `mpd_memory_reflect_complete` — reflection 状态机。
- `mpd_memory_status` — vcs 模式、路径、条目计数、reflection 计数器。

## 构建 / 测试

```sh
bun build packages/mpd-memory-plugin/src/index.ts --target node --format esm --outfile packages/mpd-memory-plugin/dist/index.js
bun test    # git backend (real commits) + svn backend (fake CLI wiring)
```
