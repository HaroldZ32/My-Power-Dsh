# 决策台账（P1–P3 已拍板）

| 决策点 | 结论 | 依据 |
|---|---|---|
| D1 profile 形态 | 暂用"隔离 headless + --patch overlay"完成 QA；生产 profile 模板延到 P4/P5 需要真实会话时再建 | P1–P3 等价验证已充分；web 真实 profile 待用户决定何时并入 |
| D2 lsp 构建策略 | **不延迟**：lsp-daemon 可离线 bun build（仅 workspace 源码，无外部 npm 依赖），已交付 | lsp-tools-mcp/lsp-daemon 依赖审计 |
| D3 首批 agent | oracle + librarian + prometheus + hephaestus（最小版） | 沿用计划 |
| D4 双轨主轨 | deepseek-official 主轨；pi-ai deepseek 兼容轨；双轨实测均 PASS（7.8s / 7.9s） | evidence/p1/dual-track.md |
| D5 技能清单 | 7 个技能已 vendor（ulw-plan/init-deep/lsp-setup/git-master/review-work/programming/ast-grep） | P2 |
| D6 tool-presentation | 待 P4 预设层决定 | — |
| D7 插件边界 | 已落地：纯装配=官方插件实例化（含 !!js 路径解析）；有逻辑=自研 cordis 插件（P4 起：presets/hephaestus） | P2/P3 |
| D3a（新增）运行时前置 | ast-grep 服务器需 sg 二进制（缺失返回 BINARY_NOT_FOUND 分类错误+安装提示）；codegraph 需 codegraph 二进制（缺失返回 skip hint）；lsp 需语言服务器（返回 daemon 缺失提示）；git-bash 按 omo 原设计仅 Windows（bundle 行已按平台门控） | evidence/p3/*-call.log |

## 平台与前置说明（更新 2026-08-26：本机有网）

- 已安装本地 toolchain（.toolchain/，npm 网络安装，@ast-grep/cli 0.45.2 + @colbymchenry/codegraph 1.5.0）：
  - ast-grep：真实调用已 PASS（evidence/dsh-qa/mcp-call/<ts>/call.log：ok=true, 1 match, 4ms）；
  - codegraph：OMA_CODEGRAPH_BIN 已注入，但项目策略仍返回 skip hint（需在项目内按 omo 约定初始化，记录为后续项）；
  - 各语言 LSP server：仍为运行时前置（status 已可达）。
- 全局 npm 因沙盒缓存只读失败，故 toolchain 放仓库内（.toolchain/ 已被 gitignore）。
- git_bash MCP 在 omo 中即 Windows-only（run 仅 native Windows 可用），本 bundle 以
  disabled: !!js process.platform === 'win32' ? false : true 门控。

## P5 批跑发现（F10/F11，已修）

- F10：codegraph 缺失时 provision 崩溃（~/.omo 只读）→ bundle 默认 disabled: true；启用步骤见注释。
- F11：金标直跑未注入 sg 路径 → mcp-astgrep 行 env 注入 OMO_AST_GREP_SG_PATH（toolchain 兜底）。

## P4 补充决策（预设交付路径）

- **F9（研究项）**：headless 运行时 agent-presets 行的 config.roots 未生效（ROOTS 只含 shipped+user 根；probe 实证），
  与 dump 组合结果不一致——疑似 boot 侧 patch/config 语义差异。**规避**：预设落地走 DSH 官方支持的用户根
  '$DSH_HOME/.agent-presets'（自动扫描；copy() 即此路径）。
- **P4 交付路径**：4 个预设随 omo-presets-plugin/presets/ 发布；bootstrap/安装步骤将其拷贝到 '$DSH_HOME/.agent-presets/'
  （用户根 trust=user）；QA 在沙盒 .agent-presets 中验证（preset-register PASS）。
- **预设内容**：oracle/librarian/prometheus/hephaestus 人格由 OMO 原版 prompt 抽取并做 DeepSeek 适配
  （删 Claude 专有措辞、工具名映射到 DSH 的 mcp__ast_grep__*/mcp__lsp__*/web 等），记录于 tests/prompt-adaptation-log.md；
  persona 冒烟 PASS（Prometheus 自识别正确）。
