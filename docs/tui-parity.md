# TUI surface-parity ledger — the Web edition against the DSH-TUI edition
**English** | [中文](./tui-parity.zh-CN.md)

> Wave: `tui-team-surface`. Status: **INTEGRATED — every row below was measured on the frozen
> revision; two measured deviations and three known limits are carried OPEN (never described as
> fixed), and no row was dropped to make the table look better.**
>
> The frozen interface this page reports against is `.mpd/plans/tui-team-surface.md` (surface
> contract, incl. AMENDMENT A1). The TUI side of the wave is
> `packages/mpd-tui-plugin/src/{scenes.ts,team-state.ts,state.ts,sanitize.ts,commands.ts,command-trees.ts}`;
> the Web side is `packages/mpd-agent-teams-plugin/lib/**` (the adopted MIT plugin, read-only for
> this wave) and `packages/mpd-bundle-plugin/src/**` (our own Web pages).

> **BASELINE STATUS — read this before quoting any team row (0.1.7-rc.2).** The Web side this ledger
> scores against is the **vendored `agent-teams` plugin, which is now RETIRED from the composition**:
> no loader row mounts it, so its routes (`/plugins/dsh-agent-teams/**`), its `.mpd/team` records and
> its sidebar panel do not exist in a shipped session. Every row and section below is that wave's
> MEASUREMENT of that baseline — history, not current capability.
>
> Two consequences, stated rather than left to be inferred when a team row is cited:
> **the whole plan-approval family does not exist any more** (a staged plan, `approve <teamId>` +
> `Ctrl+X`, `Ctrl+D` discard, the plan member/task editors, `plan-continue`), because the OFFICIAL
> Agent Teams plugin this bundle mounts has **no staged plan and no approval step** — the Lead spawns
> a teammate with `spawn_teammate`, opens its lane with `team_task_create`, and the shared board IS
> the plan; and **the team state a TUI scene could read** is the Lead's session log, not
> `.mpd/team/team.json`. For the current team capability read `docs/user-guide.md` §6,
> `docs/tui.md` §3.2 and `docs/plan-0.1.7-adaptation.md`.

This is the persistent, human-facing ledger for one question: **for every surface the Web edition
of this bundle offers, what does the DSH-TUI edition offer instead, and if the answer is
"nothing", why is that acceptable?** "Equal" here never means equal layout, styling, animation,
dragging, resizing, panel geometry or localization: it means the same *facts* and the same
*actions* are reachable. That boundary is frozen in the contract's NOT-CLAIMED #1 and restated in
§5 below.

## 1. How to read this ledger

### 1.1 The three statuses

| `tui_status` | What it asserts | What it never asserts |
|---|---|---|
| `present` | a TUI surface exists that reaches the same facts (or the same action), at the evidence level named in §1.2 | that it looks like the Web surface, or that it is driven by the same gesture |
| `absent` | no TUI surface reaches it, and the reason is recorded here | that the Web capability was removed — it is still there, in the Web edition |
| `not-applicable` | the Web surface has no meaning in a terminal (floating geometry, HTTP status codes, image assets, browser-side localization) | that something is broken; there is nothing to port |

An `absent` row is a **result**, not a gap in this page: dropping it would be the defect. §3 gives
each one its own paragraph.

### 1.2 Evidence levels

Every `tui_evidence` cell names a path under `evidence/tui/`; these are the runs it refers to, with
what each one can and cannot prove:

| Label | Path | What it proves |
|---|---|---|
| **E1** | `evidence/tui/team-surface-verify/2026-09-16T14-19-18.574Z/` | **the accepted verdict run** (t3, attempt 2 — green on both of its verify commands: arm 1 13/13, arm 2 7/7, and the negative control red three ways). Arm 1 drives the plugin's REAL `apply()` out of `dist/` and renders the registered scenes with a host double; arm 2 drives the REAL `dsh` TUI over real tmux keystrokes in a sandbox and the real adopted runtime COMMITS an approval. The earlier run `…14-12-48.394Z/` is SUPERSEDED and is cited nowhere on this page. E1 is the PRE-repair measurement: it still records the verdict-line finding F1, and its own `panes/approve-attempt.pane.txt` shows the post-commit empty state; the post-repair re-measurement is the settled-revision lane run named in §4 D1. |
| **E2** | `evidence/tui/team-surface/20260916T140135Z/` | t6's repair suite plus its round-2 negative control: nine mutations applied to the real source, each reddening a named set of tests, every file restored byte-identical (sha256), final suite green. This is the falsifiability witness for the row-level assertions. |
| **E3** | `evidence/tui/live/20260915T063140Z/result.json` | the edition's live lane (t8): six of the seven TUI seams rendered on a reviewer-owned fresh root — status line, commands, tree, scene, settings section, dialog. |
| **E4** | `evidence/tui/plugin/20260915T060934Z/mount/` | real-TUI pane captures: `02-mpd-status`, `04-board-scene`, `11-board-by-command`, `14-workmate-dialog`, `15-settings`, `16-command-completion`. |
| **E5** | `evidence/tui/team-surface-integrate/2026-09-16T14-17-24.000Z/` | THIS page's own gate sweep, re-run on the frozen revision: `bun test packages`, typecheck, `test:qa`, `verify-vendor`, `verify:docs`, `delta --check`, the TUI lanes, and the corpus fingerprint. |

Three honest limits of this evidence, stated rather than implied: **E1 arm 1** answers through a
recording double, so it proves the confirmation GATE, the adapter's forwarding of `exec.agent` and
the scene's rendering of the tool's own structured result — never that arm 1 approved a team; the
real approval is arm 2's claim. **The team scene's row rendering** is proven at suite level (E2)
and by scene registration (E1 A1), not by a live-pane capture of the team scene itself — the
edition's own NOT-CLAIMED #5 records that the automated sweep drives no real keystrokes for it.
And **`alt+t`** is best-effort by contract (§5.3) and is not exercised anywhere.

## 2. The ledger

One table, one row per Web surface, in the frozen §8 order (rows 1–20 are the contract's mandatory
enumeration; rows 21–25 are the Web surfaces this wave's brief names in addition, each anchored to
a measured Web artifact). `—` means there is no TUI surface to name.

| `web_surface` | `web_evidence` | `tui_status` | `tui_surface` | `tui_evidence` | `reason` |
|---|---|---|---|---|---|
| `activity-panel/team-header` (id/name/phase) | `packages/mpd-agent-teams-plugin/lib/snapshot.js:87-91`; panel render gate `lib/client.js:2437` | present | `mpd-tui-team` via `/mpd team`, or `a` on `mpd-tui-board` | E1 (A1 registers the scene), E2 | §3.1 item 1 |
| `activity-panel/plan-review-state` | `lib/snapshot.js:92-93` | present | `mpd-tui-team` (same rows) | E2 | §3.1 item 1 |
| `activity-panel/roster` (status/model/progress/currentTask/unread) | `lib/snapshot.js:56-82` | present | `mpd-tui-team` | E2 | §3.1 item 3 |
| `activity-panel/task-dag` (id/kind/status/assignee/attempt/round/verdict/deps/depth) | `lib/snapshot.js:95-118` | present | `mpd-tui-team` | E2 (mutation R2 reddens 6 tests) | §3.1 item 4 |
| `activity-panel/failed-dependency marking` | `lib/snapshot.js:95-118` (`failedDependencies`) | present | `mpd-tui-team` (`failed-dep=`) | E2 | §3.1 item 4 |
| `activity-panel/message-count + captain inbox tail` | `lib/snapshot.js:119-125` | present | `mpd-tui-team` (mailbox tail) | E2 | §3.1 item 6 |
| `activity-panel/halted flag` | `lib/snapshot.js:94` | absent | — | — | measured: the TUI reports the watchdog HOLD instead — `packages/mpd-tui-plugin/src/watchdog.ts:24-30,64-83` (see row 22); `halted` and a hold are different facts (§3.1 item 2) |
| `activity-panel/plan-approval` (approve) | `lib/index.js:325,371-381`; `lib/client.js:1501-1516,1695-1696` | present | `mpd-tui-plan` via `/mpd plan` or `a` in `mpd-tui-team`: type `approve <teamId>`, then `Ctrl+X` | E1 (A4–A8 arm 1; H1–H6 arm 2) | §4.2; the verdict line after a real commit is rendered as of the t8 repair (§4, D1) |
| `activity-panel/plan-discard` (two-step) | `lib/client.js:1540-1556,1680-1687,1717` | present (reduced semantics) | `mpd-tui-plan`: `Ctrl+D` twice inside the 10 s arm window | E1 (A2 registers the scene) | §4.3; the TUI writes nothing else — the Web's `lib/tools.js:577` captain-inject/cancel half has no TUI counterpart |
| `activity-panel/plan-continue` (request changes) | `lib/client.js:1518-1538,1705`; `lib/index.js:391` | absent | — | — | NOT-CLAIMED #3 / §4.4 — no tool surface exists for `continue`, so the TUI does not invent one |
| `plan-member-editor` (provider/model before approve) | `lib/index.js:407` (`update_member`); member picker `lib/client.js:2583` | absent | — | — | NOT-CLAIMED #2 — the TUI surfaces are read-only |
| `plan-task-editor` (subject/assignee/dependencies) | `lib/index.js:426` (`update_task`) | absent | — | — | NOT-CLAIMED #2 |
| `plan-add-task` | `lib/index.js:443` (`add_task`) | absent | — | — | NOT-CLAIMED #2 |
| `plan-remove-task` | `lib/index.js:458` (`remove_task`) | absent | — | — | NOT-CLAIMED #2 |
| `plan-pre-approval editing / merge` | `lib/index.js:405-475` (the editor action block); `lib/tools.js:759` (the plugin's edit-plan tool) | absent | — | — | NOT-CLAIMED #2; the contract's row label `merge-autonomous-plan` has no locatable anchor in the adopted client bytes — see deviation D2. (The whole plan-approval family is retired — see the banner.) |
| `activity-panel/archived-teams view (?archived=1)` | `lib/index.js:255-272`; `lib/client.js:360-367` | absent | — | — | measured: the TUI reads the live state root only and selects one newest record (`packages/mpd-tui-plugin/src/state.ts:107-109`); archived teams are not projected |
| `activity-panel/panel-geometry + drag/resize` | `lib/client/panel-geometry.js:121` | not-applicable | — | — | a terminal scene has no floating geometry (§7.1) |
| `activity-panel/localization (t())` | `lib/client/locales.js` | not-applicable | the injected `tuiCommandTrees` carries `descriptions.zh` (`src/command-trees.ts:18-25`); scene text stays English | E4 (`16-command-completion.pane.txt`) | §5.1 plus §7.1 — no scene-text localization is claimed |
| `activity-panel/member-artwork (assets route)` | `lib/index.js:492` (`/plugins/dsh-agent-teams/assets`) | not-applicable | — | — | terminal scenes render text |
| `plan-route HTTP semantics (405/409/404, no-store)` | `lib/index.js:325-332,364-370` | not-applicable | — | — | the TUI does not go over HTTP; the equivalent refusals are the in-scene error lines (§4.5) and the unattached-captain refusal (§6.2) |
| `activity-panel/stop-team` (halt) | `lib/index.js:276` (the halt route); `lib/client.js:292,2360` | absent | — | — | measured: no halt control exists in any TUI scene; the TUI's mutation set is frozen to approve/discard (§3.2, §4) and §7.2 forbids writes |
| `team-watchdog/banner` (holds, unread incidents, acknowledge) | `packages/mpd-bundle-plugin/src/watchdog-web.ts:26-27`; `src/team-page.ts:558-584` | present (hold row + replay dialog) | `mpd-tui-board`: the `team-hold held (…)` row (`src/state.ts:306`) and the acknowledge dialog for replayed incidents (`src/watchdog.ts:24-30,93`) | E3, E4 (`02-mpd-status.pane.txt`) | measured: the row is omitted — never rendered as "not held" — when `mpdWatchdog` is absent (§7.8) |
| `workmate-library/tab` (listing) | `packages/mpd-bundle-plugin/src/web-client.ts` (the workmate-tab factory) | present (reduced: listing only) | `/mpd workmates` (the `/mpd` command handler in `src/commands.ts`) | E4 (`14-workmate-dialog.pane.txt`) | measured: the listing is the whole TUI surface (`state.workmates.count/names`) |
| `workmate-library/mutations` (init/rename/delete/archive) | `src/web-client.ts` (the same factory) | absent | — | — | measured: the TUI exposes no write path to the library, which is HOME-scoped (`~/.mpd/workmate`, AGENTS.md §6 State exception); the Web tab is the only mutation door |
| `settings-section` (Settings → MPD, the 25 knobs) | `packages/mpd-bundle-plugin/src/settings-card.ts` (`FIELDS` / `readCatalog` / `optionsFor` / `optionElements`) | present | `/settings` — the mpd section via the `tuiSettingsSections` seam (`src/settings.ts`) | E3, E4 (`15-settings.pane.txt`) | measured: the section discloses the bridge to `<workspace>/.mpd/mpd.jsonc` and its restart caveat in-section (docs/tui.md §6.2); the twelve `teamModels` leaves are catalog-derived selections with the declared lists as fallback |

## 3. Why each `absent` or `not-applicable` row stays

**`halted` is absent on purpose (row 7).** The Web snapshot carries `team.json.halted`; the TUI
reports the team watchdog's HOLD instead. These are different facts with different owners: a hold is
written by the watchdog sidecar and pauses *dispatch* without cancelling anything, while `halted` is
a field of the team record. Reporting one as the other would be a false parity claim, so the TUI
shows the hold it can actually read and this row stays `absent`.

**`plan-continue` (row 10), the four plan editors (rows 11–14) and pre-approval editing (row 15).**
All six are the same decision: the TUI plan surface is READ-ONLY apart from approve and discard. A
TUI user who wants a subject typo fixed must ask the captain — that consequence is stated in the
contract's NOT-CLAIMED #2 rather than hidden, and `continue` additionally has no tool surface to
adopt (NOT-CLAIMED #3), so there is nothing to wire even if the TUI wanted to.

**Archived teams (row 16).** The TUI resolves exactly one newest live record per workspace
(`state.ts:107-109`, the board's own rule) so that the board and the team scene can never disagree
about which team is "the" team. Archived teams are a Web-side browsing affordance; the TUI has no
second state root to read them from.

**Panel geometry (row 17), localization (row 18), member artwork (row 19).** Not ported because the
target has no equivalent medium: a terminal scene has no floating window to drag, no image assets,
and a text UI whose scene copy is English-only like every other TUI surface — the localized part of
the mpd TUI is the command tree's `descriptions.zh`, which is a different mechanism, not a
translation of these panels.

**HTTP semantics (row 20).** The Web's 405/409/404 refusals and `cache-control: no-store` have no
analogue in a surface that never speaks HTTP; the corresponding refusals are rendered as in-scene
error lines, including the loud refusal when the named captain session is not attached in this
process (measured pre-flight: `the captain session <id> is not attached in this process`, the record
untouched — `evidence/tui/team-surface-verify/preboot-probe/`).

**Stop-team / halt (row 21).** The control exists in the Web panel and in the adopted halt route;
the TUI deliberately does not carry it. Its mutation set is the frozen approve/discard pair, and
NOT-CLAIMED #7 ("no writing of team state, ever") is the invariant that makes the read-only
surfaces trustworthy. Showing a halt control would be a new write seam, not a parity fix.

**Workmate mutations (row 24).** The library lives under the user's HOME, cross-project, and its
mutations (initialize, rename, delete/archive) are consequential user-data operations with their own
refusal rules (in-use checks, archive-first). The TUI offers the read-only listing; the Web tab is
the mutation door. Splitting the row in two is deliberate — it is the difference between "the facts
are visible" and "the action is available", and merging them would have overstated parity.

## 4. Measured deviations carried open

**D1 — the approval verdict line was not visible after a REAL commit (severity medium; measured
OPEN, then CLOSED by t8 — recorded here in BOTH states, because the first state is what the wave
found).** The contract's §4.5 pins the success rendering as `approved: <teamId> running · members
<n> · tasks <n>`. Measured on the real host (E1 arm 2, first run): the approval COMMITTED — the
record went `phase: staged → running`, `approvedAt` was set and `planReviewState` deleted, a
signature only the adopted `approveStagedTeam` writes — while the pane showed the post-commit empty
state instead, because the post-call re-read no longer saw a staged record. Arm 1 (recording double)
did render the tool's structured result, which is why this was a real-host deviation and not a scene
rendering bug. **Repair (t8, `repair`, Senior Engineer):** a settled record that is no longer usable
now renders the message the runtime produced, as the first body row
(`packages/mpd-tui-plugin/src/scenes.ts:731-750`), and the package dist was rebuilt.
**The OPEN state is evidenced by the ACCEPTED run's own pane**, not by a superseded artifact:
`evidence/tui/team-surface-verify/2026-09-16T14-19-18.574Z/panes/approve-attempt.pane.txt` shows
`MPD plan approval — no staged plan for team mpd-fixture-1 (phase running)` with zero occurrences of
the verdict line, beside the same run's `result.json`
(`arm2.outcome = approved-by-the-adopted-runtime/verdict-NOT-visible-after-commit`, finding
`F1-approval-verdict-not-visible`).
**Re-measured after the repair:** the lane re-run on this wave's settled revision reports
`arm2.outcome = approved-by-the-adopted-runtime/verdict-visible`, `outcomeLines.approved = "approved:
mpd-fixture-1 running · members 2 · tasks 2"` and `findings: []`
(`evidence/tui/team-surface-verify/2026-09-16T14-29-54.081Z/result.json`, from gate pass 2 in E5; the
lane's earlier post-repair run `…14-24-22.312Z` agrees). The first reading stays
in this ledger as the history of the measurement, not as a current status.

**D2 — one frozen row label has no locatable Web anchor (severity low; owner: the frozen contract;
STILL OPEN).**
The mandatory row `activity-panel/merge-autonomous-plan` is kept (an omitted row is a defect), but
the label itself could not be located in the adopted client bytes: a case-insensitive search for
`autonomous|merge` over `packages/mpd-agent-teams-plugin/lib/client.js` and `lib/client/**` returns
zero hits. The row is therefore anchored to the nearest MEASURED Web surface — the pre-approval plan
editor action block (`lib/index.js:405-475`) and the plugin's edit-plan tool (`lib/tools.js:759`). This
is recorded rather than silently re-labelled: a reader comparing this page with the contract sees
the discrepancy and its cause.

**D3 — the lane's accepted verdict run described stale lane bytes (severity medium; measured, then
RESOLVED inside the same wave).** t3's attempt-1 verdict run recorded the digest of the lane that
measured it, `skills/dsh-qa/scripts/tui-team-surface.ts` → `21a9eb5c14a30410…`. The file on disk
hashed to `91a05314c38f263cc8c481174dfa3debd6b7e6914512dc94857c1064f792cf2f`, and its mtime
(14:16:22 UTC) was LATER than t3's own last update (14:14:56 UTC). The corpus fingerprint recomputed
on the live tree was therefore `303e1631…`, **not** the treeSha that attempt-1's report asked the
captain to pin — that stale value is recorded verbatim in the attempting run's own `result.json` and
is deliberately NOT restated here, because a stale hash literal in prose is exactly the trap this row
describes. Two consequences were recorded at the time: pinning that stale value would have left
`verify-vendor` RED, and the verdict run no longer described the lane bytes on disk. **Resolution
(measured, not assumed):** this page's independent recomputation was used. The pinned value is read
from `VENDOR_LOCK.json` `assets.skills` on 2026-09-16: `fileCount 319` / `treeSha
303e163148afc07e7dad10775d3de7e96b4caa1cfae9c1a91575ae906d8cc27d`, and the deriving check is
`node evidence/tui/team-surface-integrate/2026-09-16T14-17-24.000Z/fingerprint.mjs`, which recomputes
the corpus with `verify-vendor`'s own algorithm and prints the pin beside it (currently
`drift: false`). `verify-vendor` reports PASS and the QA self-test sweep (incl.
`agent-teams-messaging.ts --self-test`) agrees on the same bytes, and t3 was RETRIED
(attempt 2, accepted run `…14-19-18.574Z`) green on the current lane bytes. What survives is the rule,
not a defect: a lane digest in a verdict run binds that verdict to the bytes which measured it, and a later edit invalidates the
binding. Evidence: `evidence/tui/team-surface-integrate/2026-09-16T14-17-24.000Z/raw/fingerprint.log`,
`REVISION.json`, and `gates.result.json` (`verifyVendor.exitCode = 0`) in the same directory.

## 5. NOT-CLAIMED

**Inherited from the frozen contract §7 (all nine still stand):**

1. **Functional parity only** — equal facts, never equal layout, styling, animation, dragging,
   resizing, panel geometry or localization.
2. **No inline plan editing in the TUI** — the TUI cannot edit a member's provider/model or a
   task's subject/assignee/dependencies; the listed consequence (ask the captain) is part of the
   claim.
3. **No "continue with a reason"** — no tool surface exists for the Web's `continue`.
4. **The captain model's reaction to a TUI approval is not claimed** (contract §6.3).
5. **No real keystroke drive in the automated sweep** — the TUI boots only on a real TTY, so the
   tmux lane is excluded from `bun run test:qa`; pane text proves rendering and the record flip
   proves the action. (E1 builds its own tmux arm for this wave's surfaces, which is stronger than
   the edition's original lane but still not part of `test:qa`.)
6. **No new host seam is invented** — with `tuiScenes`/`tuiDialogs` absent, `/mpd team` and
   `/mpd plan` answer the existing command error.
7. **No writing of team state, ever** — the TUI package contains no write primitive.
8. **`mpdWatchdog` absent** → the hold row is omitted, never rendered as "not held".
9. **`alt+t`** is best-effort and may be refused; `/mpd team` is the guaranteed entry point.

**Named limit carried from t4's independent review and the captain's ruling (risk class (c)) —
CONTAINED, NOT FIXED, and deliberately out of this wave:** an **unbounded `dependencies` array** can
still make the projection throw deep in the depth walk (the `Math.max(...)` spread) and degrade to
the bounded read-failure line instead of the §5.5 note it would otherwise render. It cannot crash
the TUI loop — the read path catches it and renders the failure line — which is why it is contained
rather than blocking. It is **not** in this wave and it is **not** described as fixed anywhere on
this page. Reason it is out of scope: a dependency cap would have to change the frozen §5.5 cap list
(`MAX_TASKS`, `MAX_TEAMS`, `MAX_PROBLEMS`), i.e. the interface, not the implementation. Recording
it here is the whole remedy available to this wave.

**This wave's own additions:** the team scene's rows are proven at suite level (E2) and by scene
registration (E1 A1), not by a live-pane capture of the team scene; `alt+t` remains unexercised; and
nothing on this page claims a Web-browser render (no browser binary exists in this environment — the
Web column cites source, exactly as the contract's §2 does).

## 6. How to open each TUI surface

**The team rows in this table describe the RETIRED baseline (see the banner at the top): a staged
plan, `approve <teamId>` + `Ctrl+X` and the `team-plan …` board row do not exist in a shipped
session any more.** What a current session can open is `/mpd team`, `/mpd board`, `/mpd status`,
`/mpd workmates`, `/settings` and the `/mpd` grammar — the TUI action list is
`packages/mpd-tui-plugin/src/command-trees.ts`.

| Surface | How to open it | Then |
|---|---|---|
| The team workflow | `/mpd team` (or `/mpd` → picker, or `a` while `mpd-tui-board` is open) | `p` jumps to the board; `r` re-reads |
| ~~The plan approval~~ (RETIRED — no staged plan exists; use the official `team_task_*` tools) | — | — |
| The board | `/mpd board`, the configured shortcut, or picking the board | the `team-hold held (…)` row (only while a watchdog hold lasts) |
| The workmate library (listing) | `/mpd workmates` | prints the count and names; mutations are Web-only (row 24) |
| The status line | `/mpd status` (or the configured status seam) | the one-line team summary, including the hold when one lasts |
| The settings section | `/settings`, then the `mpd` section | edit a knob; the section states the bridge and the restart caveat |
| The full grammar | `/mpd` | the host's own picker dialog lists the entries with their zh descriptions |

## 7. Verification of this page

- **The gate sweep** (raw logs, per-gate exit codes and a digest-pinned revision):
  `evidence/tui/team-surface-integrate/2026-09-16T14-17-24.000Z/`. **Two passes are recorded, and
  the first one straddled a repair**: the t8 verdict-line repair rebuilt
  `packages/mpd-tui-plugin/dist/index.js` at 14:22:21 while pass 1 was running, so pass 1's early
  gates measured one revision and its lanes another. Pass 2 (`second-pass/`, same directory) re-ran
  the whole set on the settled revision with a start/end digest check, and the claims on this page
  rest on that pass. Readings there: `typecheck` PASS, `bun run verify:docs` PASS (37 pairs),
  `bun run test:qa` PASS, `node scripts/patch-agent-teams-fixes.ts --check` PASS,
  `verify-vendor` PASS after the captain's re-pin, `bun test packages` two readings (below), and the
  lanes: `tui-mount`/`tui-panels` exit 0 (prerequisite-absent skip, the lanes' own convention),
  `tui-admission`, `tui-spec-conformance`, `tui-settings-bridge`, `tui-distribution` and
  `tui-team-surface` PASS. **One lane is RED and it is NOT this wave's**: `web-settings-bridge`
  reports `[card] W2a=FAIL W2b=FAIL` because its assertions still expect the pre-move card
  registration shape (`settings.plugin.item`), while the built client registers
  `settings.section` — a stale-lane defect introduced by the settings-section move earlier on
  2026-09-16, proven pre-existing by the lane's OWN earlier runs (W2a/W2b already `false` at
  08:03:20 and 07:57:19 that day, last green 2026-09-15T095438Z) and untouched by this wave, which
  changes no `packages/mpd-bundle-plugin/**` file.
- **Bilingual pairing** — this file and `docs/tui-parity.zh-CN.md` are linked by the switch link
  directly under the title and carry the same heading tree, enforced by `bun run verify:docs`:
  **PASS** (37 pairs, 0 failed).
- **The corpus fingerprint** — the authoritative value is the pin in `VENDOR_LOCK.json`
  `assets.skills`, read on 2026-09-16: **`fileCount 319` / `treeSha
  303e163148afc07e7dad10775d3de7e96b4caa1cfae9c1a91575ae906d8cc27d`**. DERIVE it rather than trust
  prose: `node evidence/tui/team-surface-integrate/2026-09-16T14-17-24.000Z/fingerprint.mjs`
  recomputes `skills/**` with `verify-vendor`'s own algorithm (never quoted from another member's
  message), prints the recomputed value, the pin and the `drift` flag side by side — currently
  `drift: false` — and, given the two literals, ASSERTS them
  (`second-pass/raw/fingerprint-asserted.log`). The value t3's attempt-1 report asked the captain to
  pin was a DIFFERENT, stale treeSha (see deviation D3, which also says where that value is
  recorded); acting on it would have left `verify-vendor` RED — as it stands, `verify-vendor` reports
  PASS and `bun run test:qa` (which includes `agent-teams-messaging.ts --self-test`) agrees on the
  same bytes. The reading remains valid only if no further `skills/**` edit lands before
  the commit; a later edit supersedes it, and the captain re-measures at commit time regardless.
- **The two in-repo test readings** are recorded TOGETHER, never singly. On the settled revision
  (801 tests, after the t8 repair added its cases) the repo cwd reads **799 pass / 2 fail** and a
  clean cwd reads **801 pass / 0 fail**; the two failures are both
  `packages/mpd-config-plugin/test/settings-wiring.test.ts` (lines 352 and 419) — the
  environment-conditioned pair the waiver names, in a package this wave does not touch. One revision
  earlier (797 tests) the same pair read 795/2 and 797/0, which is the pair the captain's guidance
  cites. Authority: the standing waiver
  `evidence/extensions/integration-ledger/20260916T071414Z/delivery-ledger.md` §10 (clean-cwd
  invocation as the replacement).
