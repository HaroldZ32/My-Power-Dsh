# mpd-memory-plugin
**中文** | [English](./README.md)

Plan C / C6 — 基于 git/svn 的记忆引擎，带一个 reflection（反思）状态机。

改编自上游包 `memory-core` 的语义（base 8c57e46；依 SUL-1.0 授权）：markdown 记忆文件带 frontmatter（`description`/`kind`/`aliases`/`read_only`）、journal + facts 队列、reflection reducer（step-count / manual / dream 触发、reservation 状态），以及一个同时支持 git 与 svn 后端的 VCS 抽象。

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
bun build src/index.ts --outdir dist --target node --format esm
bun test    # git backend (real commits) + svn backend (fake CLI wiring)
```
