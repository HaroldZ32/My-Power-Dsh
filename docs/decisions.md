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

## 平台与前置说明

- 本机（linux-x64）缺：ast-grep(sg)、codegraph 二进制、各语言 LSP server —— 均为 omo 服务器设计内的环境前置，
  不影响插件挂载与调用链路验证；安装建议由服务器响应文本直接给出。
- git_bash MCP 在 omo 中即 Windows-only（run 仅 native Windows 可用），本 bundle 以
  disabled: !!js process.platform === 'win32' ? false : true 门控。
