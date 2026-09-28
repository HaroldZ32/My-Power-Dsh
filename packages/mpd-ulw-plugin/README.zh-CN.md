# mpd-ulw-plugin
**中文** | [English](./README.md)

Plan C / C2 — 在 DSH subagent seam 上的固定策略 ultrawork 引擎（v2，取代 B3 loop；`mpd_ulw` 仍以轻量兼容别名形式存在）。

## 命令

- `/ulw <objective>` 与 `/ultrawork <objective>`（行为完全一致）——为该目标注入 ULW 激活指令并启动运行；空输入返回用法。
- 无命令界面（headless）：纯文本 `/ulw …` / `/ultrawork …` 消息会在插件的 `agent/pre-step` 边界被识别，并收到同一条指令。

## 自主策略（由激活指令携带）

被激活的 ULW 运行不向用户提出任何问题：

1. **先甄别（Triage first）**——目标不清晰、或属于「先调查再执行」的任务，先跑一轮普通 MPD 调查，再进入 gate、团队或循环。
2. **同一复杂度 gate**——运行评估与 session-start gate 相同的判定式：显式 `team:` / `!team` 标记，或任一命中信号（A 显式标记、B 交付类动词、C 枚举步骤、D 已存在的 `.mpd/plans` 计划文件）。绝不另立第二套判定。
3. **需要时才建团队**——gate 触发（或工作确实复杂）时，由本次运行**自己**用官方 Agent Teams 工具建团：每个 roster 成员一次 `spawn_teammate({name, description, prompt})`，再用 `team_task_create({subject, description, blocked_by?, write_scopes?})` 建出 DAG——由 captain 自行设计并直接运行，无需用户确认。0.1.7 上已不存在 `agent_teams_create` / `agent_teams_*` 工具；团队状态就是 Lead 会话自身的状态。
4. **循环至完成**——绝不中途停下询问；持续迭代直到每条成功标准都干净。
5. **就地修复（Fix on sight）**——运行中发现的缺陷在当轮立即修复；绝不上报后等待，也绝不请求用户批准。
6. **有证据才收尾**——只有当 verification gate 与 quality-gate ledger 双双通过后才报告完成。

## 策略（改编自上游 ultrawork，base 8c57e46）

- Discovery waves：每轮一个全新 child；在为有界波次内并发执行独立工作；连续 2 个无果的 discovery wave 后停止。
- Per-criterion loop：PIN → RED → GREEN → SURFACE → CLEAN，直到所有 criterion 干净。
- Plan gate：Prometheus planner 写入 `.mpd/plans/<slug>.md` + checklist；当 heavy/sensitive 时由 Momus 做 plan review（最多 2 次 review 复审）。
- Verification gate：当存在 plan 且（tier=heavy OR strictReview OR plan review failed）时，由只读的 Momus reviewer 处理（最多 2 次 re-review）。
- Final quality gate：gate reviewer 为每条 lane 盖章 ledger（`.mpd/ulw/<id>/ledger.jsonl`：code quality、hands-on QA、goal verification）；任一 FAIL 都会阻止完成。
- Subagent barrier 与 evidence-never-suppressed 规则属于该固定 directive 的一部分。
- 可选 hyperplan wave：5 个对抗性 category reviewers（unspecified-low/high、deep、ultrabrain、artistry）→ insight bundle → planner。

## 工具

- `mpd_ultrawork({objective, tier?, plan?, hyperplan?, strictReview?, maxRounds?})`
- `mpd_ulw({objective, maxRounds?})` — 别名（light tier，无 plan）。

## 状态

`.mpd/ulw/<id>/{state.json, ledger.jsonl}`；plans 落在 `.mpd/plans/`。

## 构建 / 测试

在仓库根目录、使用带路径参数的命令（规范形式）。在包目录内构建会写入不同的 bundler 路径注释，`node scripts/verify-dist-fresh.ts` 会将其判为 stale：

```sh
bun build packages/mpd-ulw-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ulw-plugin/dist/index.js
```

测试：`bun test packages/mpd-ulw-plugin`。
Live QA：`node skills/dsh-qa/scripts/ultrawork-smoke.ts`。
