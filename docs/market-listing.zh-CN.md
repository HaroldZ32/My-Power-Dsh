# 把 bundle 上架到插件目录

[English](./market-listing.md)

两个目录的做法不同：dshfind 靠 GitHub 索引，DSH Go 市场靠对版本化目录提 PR。这一页写清各自要什么，
以及我们的提交文件放在哪里。

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

## 提交前还缺的三件事

1. 发布条目写的那个版本，并在同一次改动里更新条目的 `version`。
2. 把真实截图放进 `docs/assets/`，引用它们的 HTTPS 地址（最多四张）。
3. 让仓库简介、npm 的 `description`、`dshGo` 标题和 README 首段保持一致——三张目录卡片各引一份。
