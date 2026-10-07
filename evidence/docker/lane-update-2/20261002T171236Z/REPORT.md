# Merged-panel assertions in the real-PTY TUI lane — run record

**Change (lane/QA only, no product code):** `docker/tui-lane.sh` gained a MERGED-PANEL assertion group
(`tui.mergedPanelOpens`, `tui.mergedPanelOrder`, `tui.hostDashboardKeyIntact`, `tui.noDirectTuiSeam`),
its coverage floor moved **15 → 19**, `docker/entrypoint.sh` now hands `OUT_DIR` to the lane so every
captured pane is written into the run's own evidence dir (`<evidence>/tui-panes/`, one raw file per
captured step), and `docker/lib/report.ts`'s `EXPECTED` list gained the four names.

**Both lanes: `ok=true`.**

```
source    : [driver] ok=true complete=false passed=56 failed=0 null=1 NULL=[boot.llmTurn]
            evidence -> evidence/docker/client-install/2026-10-02T17-12-39Z
oneclick  : [driver] ok=true complete=false passed=58 failed=0 null=3 NULL=[build.bunInstall,build.dists,boot.llmTurn]
            evidence -> evidence/docker/client-install-oneclick/2026-10-02T17-16-14Z
```

The one-click run installs `github:HaroldZ32/My-Power-Dsh#feature/seam-convergence` (the PUSHED
branch); the lane script itself is baked into the image from the LOCAL build context
(`docker/Dockerfile`: `COPY docker/tui-lane.sh /opt/mpd-e2e/`), which is why the new arms ran there
too. The nulls are pre-existing and mode-specific (credential-gated live turn; the two build arms that
do not apply when the published package ships its own deps/dist).

## Captured raws (verbatim, from each run's `result.json`)

| record | source run | one-click run |
|---|---|---|
| `tui.mergedPanelOpens` | `title="MPD subagents + team" titleHits=1 subagentSectionHits=2 teamBodyHits=3 pane=pane-merged.txt chars=3345` | `… chars=3358` |
| `tui.mergedPanelOrder` | `subagentMarker=line 4 [the host's own empty-state line (this session carries NO host subagent row)] teamMarker=line 14 header=line 3 emptyState=line 4 pane=pane-merged.txt` | identical |
| `tui.hostDashboardKeyIntact` | `hostDashboard=opened ctrlA=host-dashboard ctrlAOpenedMpdPanel=no title=<the host's own subagent-dashboard-title, EN or zh> hits=1 pane=pane-hostkey.txt` | identical |
| `tui.noDirectTuiSeam` | `gate exit=0 subject=byte-identical (cmp over every copied .ts and the gate file itself) source=/root/sandbox-dsh/profiles/dsh-tui/node_modules/@mpd-dsh/mpd scanned: 25 package(s), 114 .ts file(s) RESULT: PASS (0 findings)` | identical |
| `tui.laneExit` | `records=19` | `records=19` |

## The screens the assertions judged (raw captures)

`<run>/tui-panes/pane-merged.txt` (order markers on the captured file, 1-based):

```
1  (blank)
2    MPD subagents + team · 216x48                       <- the scene's own title
3    subagents  0 total · 0 running · 0 completed · 0 failed   <- the subagent SECTION header
4    ⚪ No subagents in the current session               <- the host's own empty-state line
…    team / phase / captain / roster / tasks …
18   task dependency graph                              <- the team body's first marker
```

`<run>/tui-panes/pane-hostkey.txt` — what `Ctrl+A` produced on the chat screen:

```
   ────── 子代理面板 ──────       0 运行中   0 已完成        ✕
```

i.e. the HOST's own dashboard. The lane boots `env -i` with **no LANG**, and dsh-tui's
`detectLocaleLang()` returns `'zh'` for an absent locale, so the host chrome is Chinese while the MPD
scene's own strings are hard-coded English — the arm matches the host's title in BOTH spellings, which
is why the positive branch (not the negative form) is what this container measured.

## Local pre-flight evidence (no container)

* `bash -n docker/tui-lane.sh` and `bash -n docker/entrypoint.sh` — clean.
* `.mpd/tui-lane-selftest/run.sh` (scratch, deleted afterwards) evaluated the **extracted lane code**
  (the real helpers + the real 4b/4c/4d block, `awk`-sliced out of `docker/tui-lane.sh`) against
  synthetic panes under a faithful `trap … ERR`: 15 checks, 3 of them NEGATIVE CONTROLS —
  order flipped → `tui.mergedPanelOrder=false`; `Ctrl+A` producing the MPD panel →
  `tui.hostDashboardKeyIntact=false`; `Escape` failing to close → the unrun-control `false`.
  Verdict: `HARNESS: ALL ARMS HELD`.
* The D6 gate really ran inside that harness on a byte-identical copy: `scanned: 25 package(s),
  114 .ts file(s)`, `RESULT: PASS (0 findings)` — the same counts the gate reports in place, so the
  scratch copy covers the identical band.
* `tmux send-keys M-a` emits `^[a` and `C-a` emits `^A` (byte-verified with `cat -v` under the same
  tmux the container installs) — exactly the `key.meta+a` / `key.ctrl+a` the host matcher reads.

## Gates re-run

* `node scripts/docker-e2e.ts --self-test` → `all arms passed (offline: no docker, no network)`.
* `node scripts/verify-comment-coverage.ts` → `VERDICT: PASS` (376 files, 29676 declarations).
