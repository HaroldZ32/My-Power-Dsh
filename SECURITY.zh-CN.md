# 安全政策

[English](./SECURITY.md) | **中文**

本仓库是 DeepSeek Harness（DSH）的插件 bundle：它给 DSH 安装添加若干插件行、一个 agent preset 与
若干 MCP 服务器。它自身不运行任何服务，也从不会配置、保存或传输模型凭据 —— 那些由 DSH 掌管。

## 支持的版本

安全修复只落在 `master` 上最新的发布版本（撰写时为 `v0.12.0`）。旧版本不再维护；报告之前请先安装最新
的 tag。

## 报告漏洞

**不要开公开 issue。** 请使用 GitHub 仓库 **Security** 标签页里的私密漏洞报告
（**Security** → **Report a vulnerability**）。如果该入口不可用，就开一个简短 issue，只说明你有一份
安全报告并请求私密渠道 —— 不要把细节写进 issue。

请附上：

- 受影响的版本或 commit；
- DSH profile，以及本 bundle 的安装方式（检出目录还是打包产物）；
- 最小复现 —— 确切的命令、斜杠命令或工具调用；
- 你认为它会造成的影响。

## 范围

- **在范围内。** 本仓库自己的代码：`packages/` 下的插件包、两个 patch 文件、`mpd` preset、扩展接口、
  skill 语料库与仓库脚本。
- **不在范围内 —— 请报给上游。** 本 bundle 挂载的 harness 包、模型 provider，以及它使用的第三方工具
  （`@ast-grep/cli`、`@colbymchenry/codegraph`、`@code-yeongyu/comment-checker`、
  `dsh-better-sidebar`，以及被采纳的 `agent-teams` 主体）。每一份的来源与许可证记录在
  [`LICENSE-NOTICES.md`](./LICENSE-NOTICES.md) 中。
- **报告、补丁与证据里绝不能包含凭据、令牌或私有代码。**
