# mpd-boulder-plugin
**中文** | [English](./README.md)

Plan C / C5 — 在 DSH tool seam 上的持久化工作状态机（"boulder"）。

Vendored core：上游项目 `packages/boulder-state`。改编：state root `.mpd` → `.mpd`，默认 session platform `upstream host` → `dsh`（见 `src/vendor/constants.ts`、`src/vendor/storage/shared.ts`）。

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
