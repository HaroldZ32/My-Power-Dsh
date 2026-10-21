# Chinese-locale docs capture (post-fix Team view)

- Commit: `83796fb40d3686eef28c0a07603cf2a8dc9cad11` (container `ui-ui-1`, image built 2026-10-21T16:06:38+08:00;
  `/src/packages/mpd-bundle-plugin/client.js` sha256 `6f517b58…` = the checkout)
- Command:

```
docker/ui/seed-team-fixture.sh --board=normal
docker exec -e MPD_UI_BOARD=normal -e MPD_UI_LANG=zh ui-ui-1 bash -lc 'bash /data/run-capture.sh'
# exit 0; log: capture-zh.log
```

- **Locale value that worked: `MPD_UI_LANG=zh`.** `run-capture.sh` forwards it as `--lang zh`; `capture.mts` sets the
  Playwright context locale, and the recorded `report.json` says `"browserLocale": "zh"`. The whole UI chrome is Chinese
  (`新会话 / 插件 / 自动化任务 / 工作区 / 团队 / 成员 / 任务 / 标准模式 / 请选择模型 / 进度 / 执行器`), and the hover card reads
  `状态 受阻 / 负责人 未分配 / 耗时 - / 任务 … / 进度 0%`. No fallback to `zh-CN` was needed.
- Capture output directory inside the runner: `/data-out/shots-zh` → host `docker/ui/out/shots-zh/` (untracked).
- Checks: **18/18 true, 9/9 steps ok**, `ok: true`, viewport 1600×1000, `consoleErrors: []`.

Files here (full 1600×1000 PNG, fresh 2026-10-21 16:56):

```
f1a7324f11150d8fc11f3cf564656622c0ad52864a9e4a5ce33c9fd4ee81d2d3  07-team-graph-hover.png
81c3984a9de95bc950bac8d3d51f620436739de33cf395a0ca381fe888eb0fc3  06b-team-board.png
72485 bytes                                                        report.json
```

`07` shows the hover card beside `T6` (below-left) with the Chinese card labels; `06b` shows the board without a card
and the running `T2` blue halo. Task subjects remain the fixture's English strings — the UI CHROME is Chinese.

No code/test/package edit, no commit. The zh runner wrote only the untracked `docker/ui/out/shots-zh/`; the tracked
`docker/ui/out/shots/` was not touched by this run (nothing to restore).
