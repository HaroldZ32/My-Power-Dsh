# mpd-boulder-plugin
**中文** | [English](./README.md)

Plan C / C5 — 在 DSH tool seam 上的持久化工作状态机（"boulder"）。

Vendored core：上游项目 `packages/boulder-state`。改编：state root 已改为 `.mpd` 约定；本 bundle **写入**的 session id 带 `dsh:` 前缀，而读取时仍**接受**遗留前缀（`codex:` / `opencode:` / `senpi:`），因此改根之前写入的记录仍能继续 resume（见 `src/vendor/constants.ts`、`src/vendor/storage/shared.ts`）。

## 工具

| Tool | Purpose |
|---|---|
| `mpd_boulder_status` | Ledger view (works, resume options, optional plan progress). |
| `mpd_boulder_start` | Start a work bound to a plan file (creates `.mpd/boulder.json`). |
| `mpd_boulder_complete` | Complete a work (status + elapsed_ms). |
| `mpd_boulder_task_timer` | Start/end a per-task session timer (TODO key). |
| `mpd_boulder_plan_progress` | Parse TODOs + Final Verification Wave progress. |
| `mpd_boulder_plans` | List plan files under `.mpd/plans`. |

## 构建 / 测试

```sh
bun build src/index.ts --outdir dist --target node --format esm
bun test
```
