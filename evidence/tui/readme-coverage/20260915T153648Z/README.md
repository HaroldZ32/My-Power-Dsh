# t57 evidence — per-package README TUI-coverage audit

`AUDIT.md` is the deliverable: one explicit verdict row per audited package (23), plus the excluded
packages and why. This file lists what every other artifact in the directory proves.

| File | What it shows |
|---|---|
| `AUDIT.md` | The 23-row verdict table (TUI-applicable YES/NO with the evidence for each verdict and the action taken), the excluded packages, the method note and the gate table. |
| `measure.mjs` / `measure.json` | Machine-checked measurements: 23/23 pairs exist, both files carry the switch link, and the two heading trees have identical LEVEL sequences; plus bytes+sha256 before (reconstructed) / after and the exact bytes added for each of the 8 edited files. |
| `pair-headings.log`, `edited-pairs-headings.log` | Raw `grep -n '^#'` output for every pair and for the four edited pairs. |
| `spec-conformance-selftest.log` | `bun skills/dsh-qa/scripts/tui-spec-conformance.mjs --self-test` → exit 0. |
| `pack-mpd.log` | `node scripts/pack-mpd.mjs` (the doc-pair gate located via `grep -rln 'zh-CN' scripts/ skills/dsh-qa/ packages/*/test/`) → exit 0. |
| `result.json` | The t14-facing summary: verdict distribution, exclusions, edited files with digests, gates, the measurement caveat and the build side effect. |
| `measure.err` | Empty (kept so unexpected stderr cannot hide). |

## Honesty notes

- **Before-digests are reconstructions.** The pre-edit bytes were not captured before editing, so
  `before` = current file minus the documented insertion. The method is deterministic for pure
  insertions and is re-runnable from `measure.mjs`; every table entry labels it.
- **Build side effect.** `node scripts/pack-mpd.mjs` rewrote the gitignored build tree
  `dist/mpd-package/**`; that is not a source change and the directory is not a deliverable.
- **No invented surfaces.** Only the four packages with real TUI-relevant behaviour gained text
  (`mpd-bundle`, `mpd-bundle-plugin`, `mpd-dsh-adapter-plugin`, `mpd-config-plugin`); `mpd-tui-plugin`
  was verified against its `src` and `dist` with no change, and 18 packages carry a NO verdict with
  the reason recorded.
