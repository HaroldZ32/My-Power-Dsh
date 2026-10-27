# shots-fix3 — retire the bad zh TUI asset, share the measured EN render

Timestamp (UTC): 2026-10-27T07:28:44Z. Narrow change only: one asset deleted, two documentation
lines re-pointed/annotated, three live assets re-measured. No other asset touched, nothing re-shot,
nothing under `docker/ui/**` touched, no git command run.

## 1. Deleted asset (file deletion, not a git command)

| Field | Value |
|---|---|
| Path | `docs/assets/images/zh-CN/tui-team-dag.png` |
| sha256 (before delete) | `0e07c9c02369dcbe829de9c8dc8d2ed22805372449cc94e4c012cf124312a2bd` |
| Size | 4320x1520 RGB (218-column zh geometry) |
| Evidence | `before/tui-team-dag.zh-CN.sha256`, `before/tui-team-dag.zh-CN.size.txt` |

## 2. The FAIL that justified it (measured BEFORE the delete)

Command:

```bash
python3 docker/ui/measure-shots.py tui \
  --pane evidence/cellwork/shots-fix2/2026-10-27T06-58-28Z/before/tui-team-dag.zh-CN.transcribed.pane.txt \
  --png docs/assets/images/zh-CN/tui-team-dag.png \
  --rows 0:40 --cols 0:216 --scale 2 \
  --json evidence/cellwork/shots-fix3/2026-10-27T07-28-44Z/before/tui-team-dag.zh-CN.measure.json
```

Result: **exit 1**, `max corner |dx| = 6.0px (worst: 4,6-13,8.top-right); missing vertical-side
pixels = 102; frames cut = 0` -> **FAIL**. Full output in `before/tui-team-dag.zh-CN.measure.log`.
The pane transcription is the one this asset was already measured with in `shots-fix2` (same
content: the TUI scene body stays English).

## 3. Documentation change

`docs/index.zh-CN.md` (line 113), the `tui-team-dag.png` row:

- before: `| [`tui-team-dag.png`](./assets/images/zh-CN/tui-team-dag.png) | [README](../README.zh-CN.md#一个插件两个端) | 同一个团队渲染成一整屏 DSH-TUI 场景，任务图用制表符画出。 |`
- after:  `| [`tui-team-dag.png`](./assets/images/tui-team-dag.png) | [README](../README.zh-CN.md#一个插件两个端) | 同一个团队渲染成一整屏 DSH-TUI 场景，任务图用制表符画出。此图引用与英文版**共用**的英文体截图（TUI 场景正文按设计保持英文）；原先的 `zh-CN/` 图是修复前的栅格化产物（角偏 6.0px / 102 个缺失竖边像素），已撤下。 |`

`docs/index.zh-CN.md` (capture paragraph): one parenthetical added so the "the zh set is a separate
render, not a renamed copy" sentence stays true — `（TUI 任务图例外：场景正文按设计保持英文，故与英文版共用同一张图）`.

`docs/index.md` (line 116), the same asset's row: one sentence appended — `The 简体中文 page shares
this render — the TUI scene body stays English by design.`

Exact diff (working tree vs HEAD, which also carries the previous wave's uncommitted edits):
`docs.diff`.

Live references to the deleted path after the change:

```bash
grep -rn "zh-CN/tui-team-dag\.png" README.md README.zh-CN.md docs/
# -> NONE
```

## 4. Gates and measurements (observed)

| Check | Command | Result |
|---|---|---|
| Doc pairs | `bun run verify:docs` | **exit 0** — `pairs=52 failed=0 violations=0 exempt=24 derived=3 links=473 dead=0 — PASS` (link pass: `links=473 checked=441 resolved=441 dead=0`) |
| Measurement self-test | `python3 docker/ui/measure-shots.py --self-test` | **exit 0** — 7 arms, 5 red as designed (`tui` good/pass, corner-drift/red, side-hole/red, band-narrow/red; `web` fits/pass, cut/red, scrolled/red) |
| Web EN (shared) | `measure-shots.py web --facts evidence/cellwork/shots/2026-10-26T16-25-00Z/shot-facts.json --png docs/assets/images/web-team-dag-groups.png` | **exit 0** — 2608x1094 @2.0x, 10 boxes, content 1234x104 in a 1280x114 viewport, scroll (0,0), headroom 46/10 px -> PASS |
| Web zh | same with `--facts evidence/cellwork/shots-fix2/2026-10-27T06-58-28Z/shot-facts.zh-CN.json --png docs/assets/images/zh-CN/web-team-dag-groups.png` | **exit 0** — identical geometry: 10 boxes, 1234x104 in 1280x114, scroll (0,0) -> PASS |
| TUI EN (now also the zh page's image) | `measure-shots.py tui --pane evidence/cellwork/shots-fix2/2026-10-27T06-58-28Z/tui/tui-team-dag.wired.pane.txt --png docs/assets/images/tui-team-dag.png --rows 1:36 --cols 0:109 --scale 2` | **exit 0** — 2180x1330, 6 frames, max corner \|dx\| = 0.0px, missing vertical-side pixels = 0, cards cut = 0, scene frame running off the window edge = 1 (tolerated) -> PASS |

Logs: `verify-docs.log`, `measure-self-test.log`, `after/web-en.measure.log` (+ `.json`),
`after/web-zh.measure.log` (+ `.json`), `after/tui-en.measure.log` (+ `.json`).
Asset hashes and sizes after the change: `after/shipped.sha256`, `after/shipped.size.txt`.

## 5. Directory state after the delete

`after/zh-CN.listing.txt` (eight files left; the TUI DAG tile is gone):

```text
hero-web-tui-v2.png
tui-status-line.png
tui-workmates.png
web-agent-presets.png
web-plugins-installed.png
web-settings-mpd.png
web-team-board-v2.png
web-team-dag-groups.png
```

`after/images.listing.txt` — the top-level `docs/assets/images/` PNG set (the shared
`tui-team-dag.png` 2180x1330 is still there and is now the image both pages show).

## 6. Bounds

- The three measurements reuse the pane/facts inputs those same assets were captured with; no capture
  was re-run (the task forbids re-shooting).
- The working tree already carried uncommitted edits from the preceding wave (`shots-fix2`: three
  PNGs, the EN "109 of 158 columns" clause and the measurement paragraphs). `docs.diff` shows them
  together with this wave's three edits; this wave added only the row re-point, its reason sentence,
  the one-clause paragraph correction and the EN sync sentence.
- Nothing was committed (git writes belong to the captain).
