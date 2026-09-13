# mpd-boulder-plugin
**English** | [中文](./README.zh-CN.md)

Plan C / C5 — durable work-state machine ("boulder") on the DSH tool seam.

Vendored core: the upstream project `packages/boulder-state`. Adaptations:
state root `.mpd` → `.mpd` and the default session platform `upstream host` → `dsh`
(see `src/vendor/constants.ts`, `src/vendor/storage/shared.ts`).

## Tools

| Tool | Purpose |
|---|---|
| `mpd_boulder_status` | Ledger view (works, resume options, optional plan progress). |
| `mpd_boulder_start` | Start a work bound to a plan file (creates `.mpd/boulder.json`). |
| `mpd_boulder_complete` | Complete a work (status + elapsed_ms). |
| `mpd_boulder_task_timer` | Start/end a per-task session timer (TODO key). |
| `mpd_boulder_plan_progress` | Parse TODOs + Final Verification Wave progress. |
| `mpd_boulder_plans` | List plan files under `.mpd/plans`. |

## Build / test

```sh
bun build src/index.ts --outdir dist --target node --format esm
bun test
```
