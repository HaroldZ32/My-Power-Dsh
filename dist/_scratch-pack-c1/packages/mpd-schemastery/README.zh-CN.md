# @mpd-dsh/schemastery

[English](./README.md)

本包是 mpd 自有的 schemastery 校验器安置处——本 bundle 中四个声明 schema 的插件都导入它——
同时收纳本仓库测试套件直接驱动的 DSH 运行时模块。此处每一字节都从已退役的
`packages/mpd-agent-teams-plugin/_deps/**` 闭包中迁出；构建期与安装期都不会抓取任何外部内容。

## 本包为何存在

在 `de-vendor-and-verify-law` 这一波之前，本 bundle 通过
`packages/mpd-agent-teams-plugin/_deps/schemastery` 取得其 schema 校验器——那是一个位于**被采纳的**
`dsh-agent-teams` 主体内部的目录。该包已被删除，因此校验器（以及测试套件所需的框架模块）与删除
动作在**同一个提交**中迁移到这里，成为 mpd 自有代码。

## 内容清单

| 路径 | 是什么 | 谁读它 |
|---|---|---|
| `lib/index.ts` | schemastery 校验器（`Schema`，默认导出） | **随包发布的代码**：`mpd-config-plugin/src/{index,settings-schema}.ts`、`mpd-team-watchdog-plugin/src/index.ts`、`mpd-tui-plugin/src/index.ts` |
| `lib/cosmokit.ts` | schemastery 自身的依赖（`Binary`、`clone`、`deepEqual` 等） | `lib/index.ts`、`harness/cordis/lib/index.ts` |
| `lib/types/index.d.ts` | schemastery 的类型声明；它同时声明了**全局** `Schemastery<T>` 接口与 `Schemastery` 命名空间 | 上述四个导入方，经由本包的 `exports.types` |
| `harness/cordis/` | cordis 运行时（`Context`、`Service`、事件派发器） | **仅测试** |
| `harness/dsh-tools/` | harness 工具层（`assertSupportedJsonSchema`、`validateJsonSchemaValue`、`defineTool` 等） | **仅测试** |
| `harness/dsh-llm/` | harness LLM 层（`createUserMessage`、`LlmError` 等） | **仅测试** |
| `harness/dsh-session/` | harness 会话层（`isJsonValue`、`freezeMessage` 等） | **仅测试** |
| `harness/dsh-scope/` | harness 作用域层（`scopeOf`、`scopeTarget` 等） | **仅测试** |
| `harness/dsh-timeout/` | harness 超时常量（`MAX_TIMER_DELAY_MS`） | **仅测试** |

**harness 模块为何保留 `<name>/lib/index.ts` + `<name>/package.json` 的形状。**
这是上游自身的布局，而且是**承重的**、并非装饰：`harness/dsh-llm/lib/index.ts` 在运行时用
`createRequire(import.meta.url)("../package.json")` 读取其同级 manifest，用来构造 harness 产品身份的
`User-Agent` 版本号。把该模块上提一层会让这次读取解析到错误的目录，因此这两层保持在上游放置的位置。

后六个模块由四个测试文件传递性引入——它们需要**真实的** cordis 派发器或**真实的** harness 校验器，
而不是替身：`packages/mpd-team-watchdog-plugin/test/{pre-step-waterfall,tool-inflight}.test.ts`、
`packages/mpd-tui-plugin/test/plugin.test.ts`、
`packages/mpd-dsh-adapter-plugin/test/adapter.test.ts` 与
`packages/mpd-ulw-plugin/test/engine.test.ts`。这八个迁入文件是自足的：除本包内部与 `node:*`
内建模块外不导入任何东西，因此测试套件无需网络，也不新增任何 npm 依赖。

## 导入形态

- 四个随包发布的插件以**包目录**形式导入校验器 —
  `import z from "../../mpd-schemastery"` — 正是这一形态让本包的 `exports.types` 加载
  `lib/types/index.d.ts`。该文件是全局 `Schemastery<T>` 接口的唯一声明处，而
  `export const Config: Schemastery<Config>` 依赖这个接口；若改为直接导入 `lib/index.ts`，
  `z` 会静默变成无类型。
- 测试文件以**带显式 `.ts` 扩展名的文件路径**导入其 harness 模块，例如
  `import { Context } from "../../mpd-schemastery/harness/cordis/lib/index.ts"`。

## 本包所受的约束

- **此处不做类型标注。** 每个迁入文件首行都带 `@ts-nocheck`：它是本仓库**迁移**的上游代码，而非
  本仓库**编写**的代码；因此 `scripts/verify-comment-coverage.ts` 通过 `EXCLUDED_PATH_PREFIXES`
  豁免整个 `packages/mpd-schemastery/{lib,harness}`，这些导入按设计保持无类型。
- **无构建。** 本包没有 `src/`、没有 `dist/`、也没有 `scripts.build`：没有任何东西打包它。
  `bun build` 会把这些文件**内联**进导入它们的插件，`node scripts/verify-dist-fresh.ts`
  在本包没有任何比对目标。
- **MIT。** `LICENSE` 完整复制了两份上游声明（schemastery/cosmokit/cordis 归 Shigma，
  `@deepseek-ai/dsh-*` 模块归 DeepSeek）。两者同样在本仓库的 `LICENSE-NOTICES.md` 中致谢。
