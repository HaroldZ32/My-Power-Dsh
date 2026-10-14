# C1 wrap-up — every residual `0.14.0` at the wave's final revision, by class

Measured at HEAD `190e2e1b` (`git grep -c '0\.14\.0' HEAD -- skills packages docker scripts docs`).
NIT-3 of `rec-20261014T170113-33f5e1` asked for the survivor enumeration to be a persisted artifact
instead of living only in seat notes; this is that artifact. Classes: **HIST** = dated measurement /
history sentence that must stay readable; **VA** = version-aware test arm (the 0.14 branch is the
point); **STAY** = the captain-ruled self-test fixtures; **NOT-DSH-TUI** = a different product's
version string.

| File | hits | Class |
|---|---|---|
| `docs/tui.md` | 29 | HIST (the §11.7 supersede table + the 0.14/0.13/0.12 history) |
| `docs/tui.zh-CN.md` | 29 | HIST (the twin) |
| `packages/mpd-tui-plugin/README.md` | 10 | HIST (dated measurements kept per the 0.14 model; current-target sentences moved) |
| `packages/mpd-tui-plugin/README.zh-CN.md` | 10 | HIST (the twin) |
| `packages/mpd-tui-adapter-plugin/test/panel-enable-migration.test.ts` | 9 | VA (the legacy-host arm) |
| `packages/mpd-tui-adapter-plugin/test/adapter-hosts.test.ts` | 9 | VA |
| `skills/ultimate-browsing/engine/AGENTS.md` | 3 | NOT-DSH-TUI (that product's own 0.14.0) |
| `skills/dsh-qa/scripts/tui-deps-ctrla.ts` | 3 | HIST:56 + STAY:647,651 |
| `packages/mpd-tui-adapter-plugin/README.md` | 3 | HIST |
| `packages/mpd-tui-adapter-plugin/README.zh-CN.md` | 3 | HIST |
| `skills/dsh-qa/scripts/tui-mount.ts` | 2 | HIST:146,153 (the MOVED `0.14.0 -> 0.15.0` provenance) |
| `skills/dsh-qa/scripts/lib/tui-lane.ts` | 2 | HIST:525,526 (dated measurement) |
| `scripts/mpd-tui-panels.ts` | 2 | HIST (header) + STAY:1370 |
| `skills/ultimate-browsing/engine/waf_profiles.yaml` | 1 | NOT-DSH-TUI |
| `scripts/docker-e2e.ts` | 1 | STAY:711 (capture-bound comment; re-derive only under a Docker-lane repair) |
| `packages/mpd-tui-plugin/test/panel-visibility.test.ts` | 1 | VA (the version-aware split's comment) |
| `packages/mpd-tui-adapter-plugin/src/index.ts` | 1 | HIST (the C2 gate's provenance comment) |
| `docker/tui-lane.sh` | 1 | HIST ("the pin before it was") |
| `docker/entrypoint.sh` | 1 | HIST ("the pin before it was") |
| `docker/docker-compose.yml` | 1 | HIST (the peer-coverage comment) |
| `docker/README.md` | 1 | HIST |
| `docker/README.zh-CN.md` | 1 | HIST |

Counting notes: `git grep -c` counts LINES, not occurrences (a line naming 0.14.0 twice counts once);
`git grep -o | wc -l` gives 129 occurrences over these 22 files. An earlier seat measured 144/25 with a
wider pathspec (it included files outside these five roots); the FILE SET is unchanged since
`2bd46f21`, which is the invariance the classification rests on.
