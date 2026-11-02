<!-- Thanks for contributing! Please read CONTRIBUTING.md before opening this pull request. -->

## English

### What does this change?

<!-- One short paragraph. Link the defect or the requirement this serves. -->

### Type of change

- [ ] Bug fix (`fix/<slug>`)
- [ ] New capability (`feature/<slug>`)
- [ ] Documentation (both the English file and its `*.zh-CN.md` twin are in this commit)
- [ ] Tests, QA or gates
- [ ] Chore or refactor

### How was it verified?

<!--
Name the gates you ran and where the evidence landed:
evidence/<domain>/<slug>/<timestamp>/{result.json,output.log}
-->

| Gate | Command | Result |
|---|---|---|
| Static gates | `bun run verify:gates` | |
| Typecheck | `bun run typecheck` | |
| Unit tests | `bun test packages` | |
| Documentation pairs | `bun run verify:docs` | |
| Other (name it) | | |

### Automated reviewer rounds

<!-- The round cap in AGENTS.md §5: at most THREE rounds per automated reviewer on one PR; a FOURTH
needs the user's explicit decision and is stated here. A finding already fixed and verified is
resolved silently; a declined one gets one sentence. -->

- CodeRabbit rounds: `<n>` of 3 — <one line on where the reconciliation lives; say so here if the cap was raised and why>.

### Bounds — what this evidence does NOT prove

<!-- The honest limits: a skipped lane, a null row, a composition-only check. -->

### Checklist

- [ ] The pull request is one focused piece of work, with no unrelated refactors.
- [ ] A source change and its rebuilt `dist/` are in this commit (built from the repository root with
      `bun build packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js`).
- [ ] Every human-facing document I touched ships its English and `简体中文` version in this commit,
      each with its language switch link under the title.
- [ ] Evidence is committed under `evidence/` and contains no credentials, tokens or private data.
- [ ] Nothing in this description claims more than the evidence supports (`--dump-config` is a
      composition check, never proof that a plugin loaded).

## 简体中文

### 这个改动做了什么？

<!-- 一段短说明。链接它所服务的缺陷或需求。 -->

### 改动类型

- [ ] 缺陷修复（`fix/<slug>`）
- [ ] 新能力（`feature/<slug>`）
- [ ] 文档（本提交同时包含英文文件与它的 `*.zh-CN.md` 孪生文件）
- [ ] 测试、QA 或门禁
- [ ] 杂务或重构

### 如何验证？

<!--
写明跑过哪些门禁、证据落在哪里：
evidence/<domain>/<slug>/<timestamp>/{result.json,output.log}
-->

| 门禁 | 命令 | 结果 |
|---|---|---|
| 静态门禁 | `bun run verify:gates` | |
| 类型检查 | `bun run typecheck` | |
| 单元测试 | `bun test packages` | |
| 文档配对 | `bun run verify:docs` | |
| 其他（写明） | | |

### 自动评审轮次

<!-- AGENTS.md §5 的轮次上限：每个自动评审在一个 PR 上最多三轮；第四轮需用户明确决定，并写在这里。
已修复并验证的评论静默解决；被否决的评论用一句话说明理由。 -->

- CodeRabbit 轮次：`<n>` / 3 —— <一行写明对账记录在哪里；若上限被提高，在此说明并给出原因>。

### 边界 —— 这些证据没有证明什么

<!-- 诚实的限制：被跳过的 lane、记为 null 的行、仅验证组合的检查。 -->

### 检查清单

- [ ] 本 pull request 是一块聚焦的工作，不含无关重构。
- [ ] 源码改动与重建后的 `dist/` 在同一个提交里（在仓库根目录用
      `bun build packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js` 构建）。
- [ ] 我改动的每一份面向人的文档，都在本提交里同时提供英文版与简体中文版，标题下各自带语言切换链接。
- [ ] 证据已提交到 `evidence/` 下，且不含凭据、令牌或隐私数据。
- [ ] 本描述中的任何声明都没有超出证据能支持的范围（`--dump-config` 只验证组合，绝不证明插件已加载）。
