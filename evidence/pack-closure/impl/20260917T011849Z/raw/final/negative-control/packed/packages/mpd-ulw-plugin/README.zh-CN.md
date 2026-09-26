# mpd-ulw-plugin
**中文** | [English](./README.md)

Plan C / C2 — 在 DSH subagent seam 上的固定策略 ultrawork 引擎（v2，取代 B3 loop；`mpd_ulw` 仍以轻量兼容别名形式存在）。

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

```sh
bun build src/index.ts --outdir dist --target node --format esm
```

Live QA：`node skills/dsh-qa/scripts/ultrawork-smoke.mjs`。
