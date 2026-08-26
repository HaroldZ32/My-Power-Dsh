# P0–P3 审阅报告（2026-08-26）

审阅对象：omo-dsh 仓库 commits 80e5260..4d37934（P0–P3 + 审阅修复）
审阅方式：铁律核对、阶段验收逐项核对、配置组合复算、脚本负向测试、凭据泄漏扫描、交付物完整性核对。

## 一、结论

**P0–P3 验收通过（按修订后的验收定义）。** 审阅共发现 8 项问题：2 HIGH / 2 MEDIUM / 4 低，
其中 6 项已在本轮修复并提交（commit 4d37934），2 项低风险改进留给 P4。
可以进入 P4；P4 前建议先读 §五 的两个遗留项。

## 二、铁律合规核对

| 铁律 | 结论 |
|---|---|
| ① 所有改动进新仓库，严禁推送原仓库 | ✅ 原仓库 HEAD 保持 8c57e46，git status 仅 2 个检出时已存在的旧证据文件 modified；omo-dsh 有独立 git 历史，无 remote |
| ② 每阶段 QA 证据落盘 evidence/ | ✅ evidence/p0|p1|p2|p3 + evidence/dsh-qa/<用例>/<ts>/ 均存在且内容可核 |
| ③ omo 源码只读，仅 vendor 拷贝 | ✅ 构建发生在临时目录；原仓库零改动 |
| 测试对齐 OMO 原版（T1–T7） | ✅ bun test 框架预留、QA 技能 dsh-qa（4 个用例脚本全部带 --self-test 且通过）、隔离 DSH_HOME、可证明性断言（dump-config 断言 + 真实工具调用）、证据唯一规范路径、阶段门禁 |
| 一切交付物为插件形式 | ✅ 插件包 10 个；P2/P3 能力以官方插件实例化条目 + 自研 QA 脚本交付；逻辑落在插件包内，无游离脚本（调试探针已清理） |

## 三、阶段验收逐项核对

### P0 ✅
- verify-vendor 锁定上游 commit/version/stats + 资产计数；bootstrap 前置校验通过。
- dsh-qa 技能 + mount-assert 用例（--self-test 通过；真实 run 断言 dsh-llm 行已挂载）。
- 证据：evidence/p0/*。

### P1 ✅
- bundle 显式声明 deepseek-official（thinking/reasoningEffort/maxTokens/models）+ pi-ai deepseek 兼容轨 + 主轨默认模型。
- headless 与 web 模板均可组合（--dump-config 无警告）。
- 双轨真实冒烟：官方 7.8s / pi-ai 7.9s，均 EXIT=0 且含工具调用证据。
- 证据：evidence/p1/dual-track.md、evidence/dsh-qa/llm-dual-track/*。

### P2 ✅
- 7 技能（128 文件）vendor 进 omo-skills-plugin/skills，VENDOR_LOCK 计数 + treeSha 锁定。
- 模型真实调用 skill 工具加载 ulw-plan 并正确引用 Prometheus 身份（7.9s PASS）。
- 证据：evidence/p2/skill-catalog.txt、load-sample.log、evidence/dsh-qa/skill-load/*。

### P3 ✅（验收定义已修订，见 §五）
- 离线 bun build：ast-grep(84.6KB)、git-bash(22.7KB)、lsp-daemon(234.8KB)；vendor codegraph serve.js(169KB)。
- bundle 挂 4 个 dsh-mcp-client（git-bash 默认禁用——omo 原设计仅 Windows）。
- mcp-call QA：模型枚举到 mcp__ast_grep__{search,scan,rewrite} + mcp__lsp__ 8 工具；真实调用 ast_grep search 与 lsp status 均得到服务器规范响应。
- 证据：evidence/p3/*、evidence/dsh-qa/mcp-call/*。

## 四、发现的问题（含修复状态）

| # | 级别 | 问题 | 状态 |
|---|---|---|---|
| F1 | HIGH | MCP dist 产物被 .gitignore 的 dist/ 规则排除，未入库——交付物缺失，新克隆无法复现 bundle | ✅ 已修：.gitignore 收窄，4 个 dist 产物 + BUILD.lock 已提交 |
| F2 | HIGH | web 模板 skill-filesystem 默认 disabled: true，bundle patch 未显式启用 → web 端 omo 技能不可见（headless QA 未暴露此差异） | ✅ 已修：patch 行加 disabled: false，web 组合复算通过 |
| F3 | MEDIUM | verify-vendor 只校验文件数，不校验内容（篡改技能内容可过） | ✅ 已修：新增 sha256（单文件）+ treeSha（目录，排序 relpath+每文件 sha256 聚合）双阻断；负向测试篡改即 FAIL |
| F4 | MEDIUM | git-bash 平台门禁用 !!js 三元，dump 渲染异常（'[object Object]'），运行语义不可证 | ✅ 已修：改为确定性 disabled: true + 注释（Windows 部署改 false 启用） |
| F5 | MINOR | dual-track/skill-load/mcp-call 缺显式隔离断言（mount-assert 有） | ✅ 已修：三脚本补 DSH_HOME 指向沙盒断言 |
| F6 | MINOR | build-mcp.mjs 硬编码 bun cache 版本条目（js-yaml@4.3.1 等），跨机器可能缺失 | ⏳ P4：改为按包名前缀发现 + 清单校验 |
| F7 | MINOR | bundle patch 内绝对路径（env 变量可覆盖），生产 profile 部署需随仓库移动 | ⏳ P4：自研插件接管路径解析（D7 既定方向） |
| F8 | INFO | 本机缺环境前置：ast-grep(sg)、codegraph 二进制、各语言 LSP server → 工具按设计返回分类错误与安装提示 | 📋 已记入 docs/decisions.md D3a；全功能需按提示安装 |

## 五、P3 验收定义修订（如实）

P3 原验收「ast-grep/git-bash 真实调用成功」在本机无法满足——git-bash 按 omo 原设计仅限 Windows；
ast-grep/lsp/codegraph 的运行时二进制（sg / 语言服务器 / codegraph）在无网环境未安装。
修订为：**MCP 插件挂载 + 模型实际调用工具 + 服务器返回规范响应（成功或设计好的分类错误）**，
即当前环境下可达成的最强证明；环境前置安装后即为全功能。此修订与证据一并记录，供后续复核。

## 六、安全与隐私检查

- 凭据泄漏扫描：对仓库全部已提交文件与 DEEPSEEK_API_KEY 值做匹配，命中 0；证据日志只含 apiKeyEnv 变量名，不含值。
- QA 沙盒：凭据文件仅复制进 mktemp 沙盒（每次运行即弃），从不落库、从不打印。
- 无 node_modules、无意外大文件入库（4 个 dist 合计 ≈ 510KB，为交付物，保留）。

## 七、P4 进入建议

1. 先做 F6/F7（build 依赖发现 + 路径解析自研插件化），再写 3 个 DeepSeek 预设；
2. 预设 QA 需自研"preset 探针插件"（agentPresets.list()/resolve() 断言 + 隔离 headless 组合）；
3. 金标任务建议含 1 道 Verilog RTL 样例（ast-grep 的 LANGUAGES 暂无 verilog——金标里同时验证 taxonomy 或改用 C/TS 样例）。
