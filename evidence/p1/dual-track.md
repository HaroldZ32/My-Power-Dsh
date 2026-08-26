# P1 证据：DeepSeek 双轨（headless 真实调用）

## 挂载证明（dsh --dump-config，隔离 DSH_HOME）

bundle patch 组合后，composed tree 中存在：

- `- id: llm-deepseek`（@deepseek-ai/dsh-llm-deepseek，apiKeyEnv: DEEPSEEK_API_KEY，thinking: enabled，reasoningEffort: high，maxTokens: 256000）
- `- id: llm-pi-ai`（@deepseek-ai/dsh-llm-pi-ai，providers.deepseek.apiKeyEnv: DEEPSEEK_API_KEY + reasoningEfforts 覆盖）
- `- id: agent-default-model`（provider: deepseek-official，model: deepseek-v4-flash）

headless 与 web 模板均可组合（web 组合日志见 evidence/verify-web-compose.log）。

## 双轨真实冒烟（任务：bash 工具 pwd+ls → 回答调用工具与文件数）

| 轨 | provider 路由 | 结果 | 耗时 | 工具调用证据 |
|---|---|---|---|---|
| 官方轨 | deepseek-official (dsh-llm-deepseek) | PASS，EXIT=0 | 7.8s | 回答含"bash/pwd/ls"；会话输出落盘 |
| 兼容轨 | deepseek (dsh-llm-pi-ai) | PASS，EXIT=0 | 7.9s | 回答含"bash/pwd/ls"；会话输出落盘 |

原始输出：evidence/dsh-qa/llm-dual-track/<track>/<ts>/output.log + result.json；
汇总表：evidence/dsh-qa/llm-dual-track/dual-track.tsv。

## 结论

- DeepSeek 官方 API 在 DSH headless 全链路（凭据解析 → 模型 → 工具调用 → 回答）可用；
- pi-ai 兼容轨（同名模型 deepseek-v4-flash）可用，双轨可随时切换；
- 隔离纪律：两条冒烟均使用临时 DSH_HOME（凭据文件复制进沙盒，未读写真实 ~/.dsh）。
