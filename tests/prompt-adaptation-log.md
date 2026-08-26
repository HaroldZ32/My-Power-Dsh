# Prompt Adaptation Log（omo -> DeepSeek）

| 迭代 | 对象 | 改动 | 依据 |
|---|---|---|---|
| P4-1 | omo-oracle | 从 ORACLE_DEFAULT_PROMPT 抽身份/专长/决策框架/输出规范；XML->Markdown；删 Claude 特化表述；新增 deepseek_notes（思考内部化、不暴露链式思维、结构紧凑） | 对齐 OMO 原版 + DeepSeek thinking 适配 |
| P4-1 | omo-librarian | 从 LIBRARIAN prompt 抽身份+证据纪律+日期意识；工具段映射 DSH 现有面（mcp__ast_grep__*、mcp__lsp__*、web 检索、bash）；保留 PHASE 0 分类（缩写版）与"结论先行+证据引用+不确定性标注" | 对齐 OMO 原版 + DSH 工具面 |
| P4-1 | omo-prometheus | 基本原样移植 prometheus/default.md（其依赖的 ulw-plan 技能已在 bundle 内） | OMO 原版即模型无关 |
| P4-1 | omo-hephaestus | 依据 Hephaestus agent 职责编写 DeepSeek 原生"配置管理器"人格（只读+diff+风险注记+DSH 术语） | 最小版定义 |
| P4-1 | 全部 | 增加：运行于 DeepSeek；计划/输出须"决策完备/结构紧凑"；不暴露思考链 | persona 冒烟（Prometheus 自识别）PASS |

待办（P5 金标后）：按 rubric 失败项做 <=3 轮迭代，并在本表追加记录。
