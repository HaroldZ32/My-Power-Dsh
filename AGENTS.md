# AGENTS.md — my-power-dsh 仓库门禁与 Git 工作流

## 1. Git 开发/发布/缺陷分离模型（本仓库纪律）

| 分支 | 用途 | 规则 |
|---|---|---|
| `master` | **发布线**（只进发版合并） | 仅由 release 流程写入；禁止直接推送/开发提交 |
| `dev` | **集成线** | feature/fix 合流至此；在 dev 上跑全量门禁 |
| `feature/<slug>` | 新功能 | 从 dev 切出；命名 kebab-case；独立提交 + 证据 |
| `fix/<slug>` | **缺陷修复** | 从 dev 切出；**一缺陷一分支**；修复必须附带复现证据 + QA 通过才合并；合并后按 `fix/<slug>-closed` 记录 |
| `release/vX.Y.Z` | 发布准备 | 从 dev 切出；只做版本/文档修正；合并回 master 并打 tag |

**硬规则**
- 任何改动不得直接推到 `master`；先走 feature/fix → dev。
- dev 全绿（bun test / tsgo / dsh-qa 证据齐备）才允许 release。
- 提交信息：`<type>(<scope>): <summary>`，type ∈ feat/fix/docs/test/chore/release；修复类必须引用缺陷编号或描述。
- 与 Gitee 远端同步按同样模型：push 只允许 feature/* → dev → release/v* → master（tag）。

## 2. 开发纪律（沿用已确立门禁）

1. **只在本仓库开发**：严禁修改/推送上游 oh-my-openagent 仓库；vendor 拷贝只读，基线由 VENDOR_LOCK.json 锁定。
2. **插件形态铁律**：一切交付物为 cordis 插件（自研插件 或 bundle 内官方插件条目）；逻辑禁止散落 profile/脚本/用户家目录。
3. **测试门禁**：每个插件包 `bun test` + `tsgo --noEmit` 全绿，方可提交。
4. **QA 门禁**：运行时行为改动必须跑 `skills/dsh-qa` 对应用例（脚本带 `--self-test`），证据落盘 `evidence/<域名>/<slug>/`；无证据 = 未完成。
5. **隔离纪律**：QA 使用隔离 DSH_HOME（临时目录），脚本内断言隔离生效，绝不读写用户真实 `~/.dsh`。
6. **基线纪律**：omo 资产锁定 `VENDOR_LOCK.json`（commit + 计数 + sha/treeSha 双校验），不追新；更新基线先跑 `scripts/verify-vendor.mjs`。
7. **安装器纪律**：`scripts/install-profile.mjs` 是唯一写入用户 DSH_HOME 的通道（--dry-run 默认；--yes 才写；--dsh-home 供隔离 QA）。
