# LIVE ROT, measured while this task ran — `cpDist` (T-72's friction, in the real repo)

T-72's row says a line-number anchor makes a citation rot. This is that rot happening in the wild
during the wave, caught by the durable checker, and repaired with the discipline the task enforces.

## Timeline (all times UTC, 2026-09-17)

| time | event | evidence |
|---|---|---|
| ~07:24 | baseline: the docs' anchors all resolve — the repo-wide run is green | `checker-before-plain/result.json` |
| 07:29:55 | first AFTER run: green, 17 symbol-first / **32 line-dependent** / 0 rot | `checker-after-plain/result.json` |
| 07:32:49 | a CONCURRENT lane rewrites `scripts/pack-mpd.mjs` (its file; the wave's packaging lane). `cpDist` moves out of the cited range: `function cpDist()` now sits at **line 176**, while both docs cite `scripts/pack-mpd.mjs:120-132` — which now carries the packer's `FILES` list entries | `git status`: `M scripts/pack-mpd.mjs`; `grep -n cpDist scripts/pack-mpd.mjs` → `176:function cpDist() {` |
| 07:35:11 | the very next verification pass is **RED**: 2 failures, both `the cited line/range does not carry the claim \`cpDist\` (scripts/pack-mpd.mjs:120-132)` — one per bilingual twin. No document was edited to cause this; the CITED FILE moved under a correct document. | `final-verify-2.log`, `final2-plain.stdout` |
| 07:36 | repair, symbol-first: (`` `cpDist`, `scripts/pack-mpd.mjs:120-132` ``) → (`` `cpDist`, `scripts/pack-mpd.mjs` ``) in `docs/extension-adaptation-report.md:405` **and** `docs/extension-adaptation-report.zh-CN.md:207` (both twins, same change) | the two files' current content |
| 07:36:28 | green again: self-test 21/21, repo-wide 13/13, `verify:docs` PASS — and the counters MOVED: **19** symbol-first / **30** line-dependent | `final-verify-3.log`, `final3-plain.stdout` |

## Why this matters

* It is the empirical proof of T-72's premise, produced by the repo itself rather than by a fixture:
  a source edit that shifts a range turned a CORRECT document into a FAILING one, and the checker
  named the exact anchor, the file and the line.
* It is also the answer to "how many anchors stop being line-dependent": **2** — the two `cpDist`
  anchors, and they stopped being line-dependent precisely because they had rotted and were rewritten
  in the symbol-first form. The rest (30) stay as verified line hints, deliberately (acceptance (c)).
* The repaired form is rot-immune: `` `cpDist`, `scripts/pack-mpd.mjs` `` is resolved against the
  whole file, so any further move of `cpDist` inside `scripts/pack-mpd.mjs` cannot redden the doc.

## Scope note

The two repaired files are `docs/**`, inside this task's `inScope`. `scripts/pack-mpd.mjs` is NOT
touched (it belongs to the wave's packaging lane and is being edited right now). Reported to the
captain as a measured cross-lane finding.
