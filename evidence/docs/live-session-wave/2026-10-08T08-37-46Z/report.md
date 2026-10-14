# Lane DOC — the human docs now state the live-session wave's three behaviours

**Writer:** Junior Engineer (one agent). **Verifier:** a DIFFERENT agent (blind), per the captain.
**Loop id:** `loop-20261008T083221-fbf787`. **Contract:** `.mpd/plans/lane-doc-human-docs.md`.
**Depends on:** `.mpd/plans/lane-td-session-scope-and-push.md` (the lane's FINAL code + its evidence).
**UTC:** 2026-10-08T08:37:46Z. **Language:** this record is agent-facing, English only.

## 1. Gate result

```
$ bun run verify:docs
[verify-docs-parity] links=424 checked=396 resolved=396 dead=0 exemptProvenance=0 absentSite=0 ignoredExternal=24 ignoredAnchorOnly=4 files=113
[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=47 failed=0 violations=0 exempt=22 derived=3 links=424 dead=0 — PASS
exit 0
```

Raw log: `verify-docs.log`. Pairs count **47** — unchanged from the lane's own pre-doc reading
(`evidence/tui/session-scope-and-push/2026-10-08T08-22-12Z/output.log`: `pairs=47 failed=0`).

## 2. Files CHANGED (4)

| File | Change |
|---|---|
| `docs/tui.md` | §3.3 one phrase; §3.4 lead paragraph + TWO new bullets (session scope, push); §3.4 legend bullet corrected; §11.6 one verb |
| `docs/tui.zh-CN.md` | the same edits as a real translation (same headings, same claims) |
| `docs/tui-parity.md` | row 16's `<reason>` cell + §3's "Archived teams" paragraph (the stale "one newest record" selection rule) |
| `docs/tui-parity.zh-CN.md` | the same two corrections |

Hashes after the edit: `doc-sha256.txt`. Full diff of the docs band: `doc-diff.patch`
(`git diff -- docs/`; the four files were clean at HEAD, so the patch is exactly this lane's change).

## 3. Files CHECKED and LEFT ALONE (with the reason)

| File | Why untouched |
|---|---|
| `docs/user-guide.md` | Checked. Its TUI text is §7.1's seam-equivalence table and §7.2's `/settings` bridge; neither states a team-selection rule, a drawing-owned state key, or a refresh mechanism. §8's "a roster or task change refreshes while the panel is open" is about the official **Web** client plugin's session-store projection — a different surface, still true — not the TUI panel. |
| `docs/user-guide.zh-CN.md` | Checked. Same content as its English twin; nothing to correct. |
| `packages/mpd-tui-plugin/README.md` + `README.zh-CN.md` | Checked as the CONSISTENCY SOURCE (they already carry the three-state table, the 76–85 ms number and the fallback ticks — the lane's writer updated them). Out of this lane's write scope, and correct. |
| `docs/tui.md` §6.1 / §7 / §11.3 / §11.5 | Checked. Their "the workspace's team projection holds a team" sentences describe the LEGACY `Ctrl+A` contact on a pre-0.13.0 host, which by construction has no session id to scope by — that is exactly the marked `workspace-level` state the new bullet records, so those lines are still true (and §11.3/§11.5 are historical records). |

## 4. The exact sentences corrected (before → after, both languages)

### 4.1 §3.4 lead — what the panel draws

EN before:

> The MPD panel renders the current workspace's team dependency DAG with the host's curated subagent rows
> ABOVE the drawing, inside one rich frame the pre-merge merged page could not afford: …

EN after:

> The MPD panel renders the CALLING SESSION's own team dependency DAG — never the workspace's latest one
> (the session-scope bullet below) — with the host's curated subagent rows ABOVE the drawing, inside ONE
> rich frame the pre-merge merged page could not afford: …

ZH before:

> MPD 面板把当前工作区团队的依赖 DAG 渲染出来，宿主自己整理的子代理行位于图形**上方**，两者同处一个合并前
> 的旧合并页负担不起的富外框之内：…

ZH after:

> MPD 面板渲染的是**调用会话（本会话）自己**的团队依赖 DAG —— 绝不是工作区最新的那一个（见下方「本会话」
> 条目）—— 宿主自己整理的子代理行位于图形**上方**，两者同处一个合并前的旧合并页负担不起的富外框之内：…
> 带边框的框架、点名团队与进度的表头、图形本体、显式图例、只列本页处理按键的页脚、状态徽标，以及钉住的
> 详情体。（…）

### 4.2 §3.3 sidebar page description (one phrase)

EN before: `…ABOVE the MPD dependency DAG for the current workspace's team, inside the DAG page's own frame…`
EN after: `…ABOVE the MPD dependency DAG for the calling session's own team (§3.4), inside the DAG page's own frame…`

ZH before: `在**上方**，当前工作区团队的 MPD 依赖 DAG 在下方，两者同处 DAG 页自己的外框…`
ZH after: `在**上方**，**本会话**自己团队的 MPD 依赖 DAG 在下方（见 §3.4），两者同处 DAG 页自己的外框…`

### 4.3 §3.4 legend — the drawing's own state key is HISTORY, one key lives now

EN before:

> The legend's rows were keyed `legend-${line.slice(0, 24)}`, and the drawing's own state-key line and the
> legend's first wrapped line both begin `✓ completed · ◐ running` — so two children shared one key, …

EN after (new paragraph inserted before the defect history, and the history's tense corrected):

> **There is ONE state key now, and it is this legend's own (user requirement
> 「删除TUI DAG界面的多余图例（目前有两行）」).** `panel-core.ts`'s `legendLinesFor` composes it from the
> frozen six-state contract (`DAG_STATE_TONES` + `DAG_TONE_GLYPH`) and names all six states, so
> `blocked` and `open` are told apart by the twin each entry carries; `graph.ts` carries no state key of
> its own — its own five-state key (`LEGEND_STATES` / `LEGEND_SHORT` / `LEGEND_KEY`) was DELETED with
> the redundant row, because it omitted `blocked` and printed under the contract's key it was the same
> legend a second time.
> **The accumulating-legend defect (user report 「越点越多直到撑爆屏幕」) was a duplicate React KEY, and it
> is fixed and pinned (§11.6).** The legend's rows were keyed `legend-${line.slice(0, 24)}`, and the
> drawing's own state-key line — **the one deleted with the redundant row** — and the legend's first
> wrapped line both **started** `✓ completed · ◐ running` — so two children shared one key, …

ZH before:

> **"图例越点越多"的缺陷（用户原话「越点越多直到撑爆屏幕」）根因是一个重复的 React key，已修复并钉住
> （§11.6）。** 图例的行原本以 `legend-${line.slice(0, 24)}` 作为 key，而图形自己的状态键行与图例紧随其后的
> 第一行折行后都以 `✓ completed · ◐ running` 开头——…

ZH after:

> **现在只有一张状态键，而且就是本图例自己的（用户条款「删除TUI DAG界面的多余图例（目前有两行）」）。**
> 它由 `panel-core.ts` 的 `legendLinesFor` 从冻结的六态契约（`DAG_STATE_TONES` + `DAG_TONE_GLYPH`）组合
> 而成，六个状态全都在其中，所以 `blocked` 与 `open` 靠各自条目携带的同形字（twin）区分；`graph.ts`
> 自己不再携带任何状态键——它那份五态键（`LEGEND_STATES` / `LEGEND_SHORT` / `LEGEND_KEY`）已随多余的
> 那一行**删除**：那份键漏掉了 `blocked`，而挂到契约这张键下面它只是同一份图例的第二次出现。
> **"图例越点越多"的缺陷（用户原话「越点越多直到撑爆屏幕」）根因是一个重复的 React key，已修复并钉住
> （§11.6）。** 图例的行原本以 `legend-${line.slice(0, 24)}` 作为 key，而图形自己的状态键行——即随多余
> 那一行一并删除的那条——与图例紧随其后的第一行折行后都以 `✓ completed · ◐ running` 开头——…

### 4.4 §11.6 (historical record, ONE verb only)

EN before: `…and the drawing's state-key line and the legend's first wrapped line both **start** `✓ completed · ◐ running`…`
EN after: `…both **started** `✓ completed · ◐ running`…`
(The Chinese row already reads historically via 「原本」, so its history is untouched — the contract says leave §11.6's history alone.)

### 4.5 `docs/tui-parity.md` — the stale selection rule in the present tense

EN row 16 before: `measured: the TUI reads the live state root only and selects one newest record (`packages/mpd-tui-plugin/src/state.ts:107-109`); archived teams are not projected`
EN row 16 after: `measured: the TUI reads the live state root only and resolves exactly ONE record — since the live-session wave, THIS SESSION's own, with the marked `workspace-level` fallback where no session id is readable (`packages/mpd-tui-plugin/src/team-state.ts`'s `readScopedWorkflow`, `docs/tui.md` §3.4); archived teams are not projected`

EN §3 before: `**Archived teams (row 16).** The TUI resolves exactly one newest live record per workspace (`state.ts:107-109`, the board's own rule) so that the board and the team scene can never disagree about which team is "the" team.`
EN §3 after: `**Archived teams (row 16).** The TUI resolves exactly ONE live record — and, since the live-session wave, that record is THIS SESSION's own, with the marked `workspace-level` fallback only where no session id is readable (`team-state.ts`'s `readScopedWorkflow`) — so that the board and the team scene can never disagree about which team is "the" team.`

ZH row 16 before: `实测：TUI 只读活动状态根目录，并只选取一条最新记录（`packages/mpd-tui-plugin/src/state.ts:107-109`）；归档团队不被投影`
ZH row 16 after: `实测：TUI 只读活动状态根目录，并且只解析**一条**记录 —— 自本会话波次起是本**会话自己**的那一条，只有读不到会话 id 时才退到带 `workspace-level` 标记的兜底（`packages/mpd-tui-plugin/src/team-state.ts` 的 `readScopedWorkflow`，见 `docs/tui.zh-CN.md` §3.4）；归档团队不被投影`

ZH §3 before: `**归档团队（第 16 行）。** TUI 每个工作区只解析一条最新的活动记录（`state.ts:107-109`，即面板自身的规则），…`
ZH §3 after: `**归档团队（第 16 行）。** TUI 只解析**一条**活动记录——自本会话波次起，那是本**会话自己**的那一条，只有读不到会话 id 时才退到带 `workspace-level` 标记的兜底（`team-state.ts` 的 `readScopedWorkflow`）——…`

## 5. New content added (both languages, §3.4)

Two bullets were ADDED to §3.4's existing list (no heading changed, no section moved):

1. **The drawing is THIS SESSION's team — the workspace's latest one is never substituted for it.**
   Records the user's report (「我new了一个session，老session的DAG图还摆在那儿」) as the defect, then the
   shipped rule: every surface that draws team state reads its OWN session id (`host.snapshot().sessionId`
   for the page, `props.channel.sessionId` for the scenes) and resolves through
   `mpdTeams.active(workspace, sessionId)`, degrading to the record's own `leadSessionId`; the reader
   reports `TeamWorkflow.source.scope` and the three states are drawn as such — **`session`** (that team's
   DAG and nothing else), **`none`** (a session id was readable and this session has NO team: the marker
   `no team in this session` plus how many teams the workspace holds, never another session's board), and
   **`workspace`** (no session id readable: the old workspace-principal rule, marked `workspace-level`).
   The two constants (`NO_SESSION_TEAM_MARKER`, `WORKSPACE_SCOPE_MARKER`) are named. The WEB tab's prior
   session scoping (`?sessionId=`, workspace listing when the session has no team) and the ONE surface that
   cannot be scoped (the legacy `Ctrl+A` status view — no `host`, no `channel`) are recorded.
2. **The surfaces update by PUSH, and the timers stay as the fallback.** `mpdTeams.subscribe(workspace,
   listener)` + the SSE route `/plugins/mpd-team/events`; **76–85 ms** across six trials on a real
   dsh-tui 0.14.0 PTY, against the **1000 ms** `DAG_PANEL_REFRESH_MS` fallback; the feed watches the teams
   directory, so a change made by ANOTHER PROCESS is seen; the 1000 ms / 2000 ms ticks stay as the fallback.

## 6. Where every number came from

| Claim in the docs | Artifact it was read from |
|---|---|
| **76–85 ms** across six trials | `evidence/tui/session-scope-and-push/2026-10-08T08-22-12Z/pty-latency/latency.jsonl` — `latency_ms` = 85, 76, 79, 77, 78, 82; identical to `…/pty-latency/run.log` trial lines and to `result.json`'s `T-P3.latencies_ms` |
| The **1000 ms** fallback baseline | `…/pty-latency/tick-baseline.txt` (`DAG_PANEL_REFRESH_MS=1000 ms`); code: `packages/mpd-tui-plugin/src/panel-dag.ts` |
| The **2000 ms** scene tick | `packages/mpd-tui-plugin/src/scenes.ts` (`BOARD_REFRESH_MS`), `subagent-scene.ts` (`REFRESH_MS`), `panel-workmate.ts` (`WORKMATE_PANEL_REFRESH_MS`) |
| The three states + both markers | `packages/mpd-tui-plugin/src/team-state.ts` (`readScopedWorkflow`, `NO_SESSION_TEAM_MARKER`, `WORKSPACE_SCOPE_MARKER`, `teamWorkflowLines`); `result.json` `sessionScopingRule`; PTY frames `pty/P1-sidebar-other-session.txt`, `pty/S1-scene-other-session.txt` |
| The WEB tab was already session-scoped | `…/web-probe.log` (`session with a record`: `team=team-a`; `session without a record`: `team=null workspaceTeams=1`; no session id: no principal team) + `mpd-bundle-plugin/client.js` carrying `?sessionId=` |
| ONE state key in `panel-core.ts`, the drawing's five-state key DELETED | `packages/mpd-tui-plugin/src/panel-core.ts` (`legendLinesFor`), `packages/mpd-tui-plugin/src/graph.ts` (`legendLines`); `grep -rn "LEGEND_STATES\|LEGEND_SHORT\|LEGEND_KEY" packages/ --include=*.ts` → only the deletion comment in `graph.ts` |
| The feed is `mpdTeams.subscribe` + `/plugins/mpd-team/events`, and another PROCESS's write is seen | `packages/mpd-team-core-plugin/src/index.ts` (the `subscribe` member), `src/change-feed.ts` (`fs.watch` + the self-notify hook + the debounce window), `src/team-web.ts` (`TEAM_EVENTS_PATH = "/plugins/mpd-team/events"`) |

## 7. Honest bounds

- **The void first PTY run is not quoted.** The lane's FIRST latency run (517 ms and a NEGATIVE value) is
  VOID — this box's `date` is uutils coreutils 0.10.0 whose `%3N` is not offset by the fractional second —
  and the docs quote only `pty-latency/`, whose clock is bash's `$EPOCHREALTIME`. The docs do not mention the
  void run at all, so no reader can take it as a result.
- **No heading was added.** §11's amendment subsections stay at §11.1–§11.6: the contract forbids
  restructuring, and the new material lives where a reader looks for the panel's behaviour (§3.4). The
  evidence path is cited inline, in the page's existing voice.
- **State 2 is described by ITS OWN marker only.** The docs deliberately do not call the `none` state
  `workspace-level`-prefixed: that token belongs to the no-session-id state alone.
- **Docs only.** No package source, no README, no `.mpd/**`, no `AGENTS.md` was touched; the four doc files
  were the only writes, plus this evidence directory.
