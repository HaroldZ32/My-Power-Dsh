# Plan record — the live-session wave (TUI/WEB surfaces + a captain that delegates reconnaissance)

**Date:** 2026-10-08. **Branch:** `feature/live-surfaces-and-lean-captain`. **Base:** `dev` @ `3e144c15`.
**Version:** deliberately NOT bumped (the user asked to hold the version).

This is the reviewable record of a wave that was dispatched as EIGHT frozen contracts, each written by ONE
agent and judged by a DIFFERENT agent working BLIND from the contract plus the plugin's own gate evidence
(AGENTS.md §5 rule 4, the verification law). The contracts themselves live in `.mpd/plans/**` (gitignored
runtime state); this page is their committed index. Verdicts are in `.mpd/verify/loops/**`.

## 0. The user's requirements, verbatim

> 1. 删除TUI DAG界面的多余图例（目前有两行）
> 2. 根据当前版本，完成实机验证，这次要求跑个贪吃蛇出来，确保没问题后，迭代一个小版本号
> 3. 哦对，多个需求，目前MPD的侧栏和全屏页面都缺了实时刷新，DAG图还都是老版本的…
>    有一个需求，面向用户的主agent如果可以的话所有调查工作也剥离其职能，尽量减少主agent的上下文占用，
>    让持续开发能做更大的工程
> 4. （澄清）不是那个老版本的意思，是说不是一个session的图还能明晃晃摆在那里，我new了一个session，
>    老session的DAG图还摆在那儿
> 5. （裁决）范围：侧栏 + WEB 一起；刷新：变更即推送（<200ms）；主 agent：机械禁用 read/grep/glob；
>    实机：Docker 裸机通道里跑贪吃蛇；版本号先不要提。

## 1. The lanes, their acceptance and their verdicts

| # | Lane | Contract | Requirement | Verdict |
|---|---|---|---|---|
| A | legend de-duplication | `.mpd/plans/lane-a-legend-redundancy.md` | 1 | PASS `rec-20261008T075349-cbae1f` |
| L | the captain delegates reconnaissance | `.mpd/plans/lane-l-captain-investigation.md` | 3 (agent) | PASS `rec-20261008T080453-ebf1a4` |
| W | the WEB team view follows the feed | `.mpd/plans/lane-w-web-push.md` | 3 (web) | PASS `rec-20261008T075814-71ba85` |
| E1 | the Docker lane takes a caller-supplied task | `.mpd/plans/lane-e1-live-prompt-knob.md` | 2 | PASS `rec-20261008T080143-5c8015` |
| S | team changes are PUBLISHED (subscribe + SSE) | `.mpd/plans/lane-s-change-feed.md` | 3 (substrate) | FAIL `rec-20261008T080839-04ea08` → repair → PASS `rec-20261008T082327-b6453c` |
| TD | the TUI draws THIS SESSION's team, live | `.mpd/plans/lane-td-session-scope-and-push.md` | 4 + 3 (tui) | PASS `rec-20261008T083541-7e3a91` |
| DOC | the human docs tell the truth | `.mpd/plans/lane-doc-human-docs.md` | all user-visible | PASS `rec-20261008T084046-34eaa8` |
| FOCUS | Escape releases the keyboard; the status row names its own scope | `.mpd/plans/lane-focus-escape-release.md` | found by verification | PASS `rec-20261008T085011-158db2` |
| E2 | the snake real-machine acceptance run | `.mpd/plans/lane-e2-snake-verification.md` | 2 | run evidence under `evidence/docker/snake/` |

## 2. What each lane actually changed (the short form)

- **A** — `graph.ts` no longer carries a state key of its own (`LEGEND_STATES`/`LEGEND_SHORT`/`LEGEND_KEY`
  deleted); `panel-core.ts`'s `legendLinesFor` is the ONE producer of the six-state key. 156 columns:
  3 legend rows → 2; swept 1..400 columns, no state entry printed twice.
- **L** — a mechanical guard denies the workspace's TOP-LEVEL session `read`/`grep`/`glob` on SOURCE paths
  (the documentation band stays readable; a call with no usable path is refused fail-closed), switchable with
  `captain.investigation: "deny" | "allow"`, reported on the boot line. The preset's self-contradiction about
  who verifies what is gone, and `AGENTS.md` gained the clause while MEASURING SMALLER (64870 → 64831 B).
  Three real isolated headless boots evidence it: refusal + doc-band allowance under denial + the knob's
  positive control.
- **S** — `mpdTeams.subscribe(workspace, listener)` + `revision(workspace)`, a debounced non-recursive
  `fs.watch` of the team state (so EXTERNAL writers are seen), one bounded degrade line when the watch is
  refused (and a proven re-arm), and the SSE route `/plugins/mpd-team/events` (`retry: 1000`,
  `event: hello` + `data: {"rev":N}`, a 15 s `: ping` keep-alive, cleanup on client close). Measured on a real
  isolated boot: **50 ms** from a separate process's write to the frame; `/state` payload byte-identical.
  The first verdict FAILED it for a pasted, non-reproducing hash, an un-evidenced keep-alive and a plaintext
  boot token in a log; all three were repaired and re-reviewed by a different seat.
- **TD** — one reader (`team-state.ts :: readScopedWorkflow`) decides WHICH team every TUI surface draws:
  the calling session's own (`mpdTeams.active(workspace, sessionId)`, degrading to a session-scoped
  `leadSessionId` scan), with the three states carried as DATA (`source.scope ∈ session|workspace|none`) and
  the markers `no team in this session` / `workspace-level`. The panel reads the session id from
  `host.snapshot().sessionId` (previously read and DISCARDED); the scenes from `props.channel.sessionId`.
  The same change adds the push (`useTeamFeed`), the timers staying as the fallback. Real PTY: session B's
  panel says `no team in this session` with ZERO occurrences of session A's board; six record rewrites
  measured **85/76/79/77/78/82 ms** against the 1000 ms tick.
- **FOCUS** — Escape is consumed ONLY when a task is pinned, so the host's `escape → setFocus('chat')`
  fallback returns the keyboard (real PTY: pre-fix the command never reached the registry; post-fix the
  composer echoes and the registry answers). The keyed STATUS ROW — the one surface whose render path gets no
  props at all, proven from the host's own status seam — now marks itself `(workspace-level)` instead of
  silently presenting another session's board; a row that resolves no team is not marked. The
  `workspace-level` token was orthogonalized so it names the no-session-id state ALONE.
- **W / DOC** — the browser team view opens an `EventSource` and runs the SAME read path the interval runs
  (the interval provably not firing in the arm), and the human docs now state the three shipped behaviours in
  both languages.

## 3. Extra findings this wave produced (not requested, all evidenced)

1. **Big boards degrade by design**: >12 ranks puts the fullscreen drawing on the RAIL and >24 tasks puts the
   sidebar page on the dense LIST (frozen refusals, re-measured — `evidence/tui/live-refresh/2026-10-08T07-32-09Z/`).
2. **The focus trap** (fixed by FOCUS) and the **status-row leak** (marked by FOCUS).
3. **The status seam cannot be scoped**: the host's status APIs carry no session identity — quoted from the
   host's own types as "deliberately receives no input, channel, or raw-terminal capability".
4. **A leftover sandbox credential file** in a gitignored evidence sandbox (never committed; removed) and two
   stray `pnpm-*` files a QA lane left at the repo root (removed).

## 4. Where the evidence lives

`evidence/tui/legend-redundancy/`, `evidence/tui/live-refresh/`, `evidence/tui/session-scope-and-push/`,
`evidence/tui/focus-release/`, `evidence/team/change-feed/`, `evidence/web/push-refresh/`,
`evidence/roles/captain-investigation/`, `evidence/docker/live-prompt-knob/`, `evidence/docker/snake/`,
`evidence/docs/live-session-wave/`, plus the gate logs under `.mpd/verify/evidence/` and the verdicts under
`.mpd/verify/loops/`.

Every lane's own `result.json` carries `{name, ok, reason, raw}` rows; an arm that could not run is recorded
`ok: null` with its blocker, never as a pass.
