# 把 bundle 上架到插件目录

[English](./market-listing.md)

三个目录的做法不同：dshfind 靠 GitHub 索引，DSH Go 市场靠对版本化目录提 PR，dsh-TUI 生态目录靠在唯一
一份 `plugins.json` 上提 PR。这一页写清各自要什么，以及我们的提交文件放在哪里。

## dshfind

dshfind 用 GitHub 话题 **`dsh-plugin`** 建市场。给公开仓库打上它，等每天 02:17（UTC）那次同步，
插件就会出现——不需要提 issue，也不需要提 PR。

- 本仓库已打上该话题。
- 卡片内容取自仓库简介、README 和话题，所以简介必须和 npm 的 `description`、README 首段说同一件事。
  改一处就三处一起改。
- 两次同步后仍未收录，通常是仓库私有、已归档或被判定为跑题；这种情况才值得开 issue。

## DSH Go 市场

目录仓库是 `ccch1mneyyy/dsh-go-market`。每个插件一个 JSON，放在 `plugins/` 下：非 scoped 包用
`<包名>.json`，scoped 包用 `@scope__name.json`。我们的文件是
[`docs/market/dsh-go-entry.json`](./market/dsh-go-entry.json)——它写的版本发到 npm 之后，把文件复制进
那个仓库，再向 `main` 提 PR。检查在 PR 上跑，通过后自动合并；风险特征写给用户看，不挡上架。

条目只有这几个字段：

| 字段 | 规则 |
|---|---|
| `name` | npm 包名 |
| `version` | 一个已发布的确切版本——不能是 `latest`、范围或 git 地址 |
| `title` | `{ "zh": …, "en": … }`，`en` 必填 |
| `summary` | `{ "zh": …, "en": … }`，各一句，`en` 必填 |
| `category` | `tools`、`media`、`productivity`、`communication` 或 `other` |
| `screenshots` | 只收 HTTPS，最多四张 |
| `homepage` | 可选 |

**不要**提交 `tier`、风险等级、完整性数据或审核结论：这些由目录自己的扫描产出，官方身份只来自它的
`policy.json`。

以下情况会被拦下：确切版本在 npm 上不存在；许可证不在 OSI 清单里；压缩或展开体积超过 50 MiB；
包身份、SHA-512 或 DSH bundle patch 对不上；格式 1 条目无效；该版本命中 high/critical 公告。我们的
许可证是 MIT，bundle patch 在 `package.json` 里声明，所以许可证与身份两条天然满足；版本这一条意味着
要先发布再提交。

### 市场如何判断插件有原生界面

它读的是 App 读的同一个 `dshGo` 块，来自 `package.json`。当该块通过 SDK 清单 schema，**并且**真的贡
献了东西（面板、状态条、胶囊或源码里的 `dsh-go/view`）时，插件才被标为已适配；空声明会停在
`not-adapted`，`minApp` 则从清单里取。我们有两个面板、一条状态条、两个输入框胶囊、两个长按动作和
十四张工具卡，所以这个块不是摆设；我们**不写** `minApp`，因为老版本 App 走 `adaptView` 降级，而不是
什么都不显示。

静态检查通过不等于在 App 里跑过，这件事由截图和发布说明负责。

## dsh-TUI 生态目录

第三个目录是 dsh-TUI 生态列表。它的目录文件是仓库 `dsh-tui-ecosystem/dsh-tui-ecosystem` 里的
`plugins.json`。加一个条目就是向 `main` 提一个 PR：workflow 先跑校验，之后是可选的 AI 复核，两者都过了
由 `MERGE_TOKEN` 做 squash 合并。

校验脚本是 `.github/scripts/validate-plugins.mjs`，一共五条机器检查：

1. `plugins.json` 是合法 JSON，且 `plugins` 是数组。
2. 每个条目必须有 `name`、`displayName`、`description`、`author`、`repo`、`kind` 和 `addedAt`，且
   `kind` 只能是 `plugin`、`template` 或 `core`。
3. `repo` 必须匹配 `https://github.com/owner/repo`，插件名和仓库 URL 都要大小写不敏感地唯一。
4. 对**新**条目，仓库必须存在且公开，PR 作者必须是该仓库的 owner 或 collaborator。
5. 对**新**条目，仓库 README 必须包含 `https://dshtui.com` 或 `https://github.com/ccch1mneyyy/dsh-tui`。

有两个细节容易踩。校验脚本会先把 README **转成小写**再匹配，所以我们 README 里写 `dsh-TUI` 也算过第 5 条。
另外它读的是仓库的**默认分支**，我们是 `master`——只存在于 `dev` 的反向链接不算过第 5 条。

我们的条目是
[`docs/market/dsh-tui-ecosystem-entry.json`](./market/dsh-tui-ecosystem-entry.json)。这个文件**只是一个
条目对象**，不是整份目录：向 `main` 提 PR 时把它追加进 `plugins.json` 的 `plugins` 数组。条目只有这几个字段：

| 字段 | 规则 |
|---|---|
| `name` | 插件名，大小写不敏感地唯一 |
| `displayName` | 卡片标题 |
| `description` | 一句中文，通常以安装命令结尾 |
| `author` | 提交该条目的 GitHub 账号 |
| `repo` | `https://github.com/owner/repo` |
| `npm` | npmjs.com 的包地址，或 `null` |
| `tags` | 一小串中文或英文标签 |
| `kind` | `plugin`、`template` 或 `core` |
| `featured` | `true` 或 `false`，留给目录自己挑选 |
| `addedAt` | 提交日期，`YYYY-MM-DD` |

一条收录不是背书：**收录 ≠ 准入 ≠ 背书**。条目只说明仓库是公开的、作者自己提交了它、它的 README 链了回来。
除此之外校验脚本什么都不查——不查包是否在 npm 上、不查名字是裸名还是 scoped、不查有没有
`dsh-plugin.json`、不查清单能不能解析、不查来源，也不查声明了哪些能力。把收录当成一个指向公开仓库的指针，
而不是对它的评审。

命名也不是关卡。指南把 `@dsh-tui-ecosystem/<name>` 和 `github.com/dsh-tui-ecosystem/<name>` 称作**生态
约定**，并明确写了**不要求组织仓库**、**不因命名被拒**。我们的包仍是 `HaroldZ32/My-Power-Dsh` 里的
`@mpd-dsh/mpd`。

对照这五条：第 1、2、3、4 条都过——仓库是公开的、MIT，`v0.17.4` 已打标签并发布，PR 会由仓库 owner 提交。
第 5 条曾是唯一没过的一条，现在补上 README 的反向链接就闭合了。

## 提交前还缺的几件事

1. 把 DSH Go 条目更新到已发布的版本。仓库里这一条现在写的还是 `0.17.0`，而套件已经是 `0.17.4`；
   在发布新版本的同一次改动里把该条目的 `version` 一起改掉，不要提交一个确切版本在 npm 上不存在的条目。
2. 把 README 的反向链接带到 `master`。dsh-TUI 的校验读的是默认分支的 README，只合到 `dev` 的话第 5 条
   仍然不过；带着这份 README 的那次发布才会让它变绿。
3. 把真实截图放进 `docs/assets/`，引用它们的 HTTPS 地址（最多四张）。
4. 让仓库简介、npm 的 `description`、`dshGo` 标题和 README 首段保持一致——三张目录卡片各引一份。
