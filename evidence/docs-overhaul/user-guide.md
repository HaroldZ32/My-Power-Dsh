# t5 — User guide: explicit command/usage coverage and attribution (Lead, attempt 3)

Task: `t5` (implementation). Attempt id `f8bcd406-5d5a-4c17-a8b9-360abcfac84f`.
Dependencies consumed as source material: `t1` (`evidence/docs-overhaul/plugin-inventory.md`, the
verified plugin + tool/command fact base) and `t3` (`docs/design.md` + `docs/design.zh-CN.md` now
carry the detailed design document; `docs/architecture{,.zh-CN}.md` are gone).

> **Latest revision — t17 repair (attempt 1, `c9ecfd9e-1377-4917-9bdd-ce54a2b9c327`).** Two findings
> from the t8 verification were closed; the CURRENT hashes and gate results are in §8, which
> supersedes §1 and the §4 row-3 link counts. §1 keeps the t5-completion values as history.

## 1. Deliverables (t5 completion state — superseded by §8)

| Path | Bytes | sha256 |
|---|---|---|
| `docs/user-guide.md` | 762 lines | `0a3b269046167e06f116f713196440d4451cc15955c2eec00dd473b5e04465f3` |
| `docs/user-guide.zh-CN.md` | 698 lines | `49664178531496c29e65f18ad03bf7c6c1248dd2501fbc613503e943472673f7` |

Diff scope: `docs/user-guide.md` +286/−5, `docs/user-guide.zh-CN.md` +269/−5. Nothing outside
`inScope` was touched (see §6).

## 2. What was added, against the acceptance criteria

1. **Complete slash-command table** — new `§12. Command reference` (§12 `命令参考`): all eight
   commands that exist (`/ulw`, `/ultrawork`, `/mpd-codegraph`, `/agent-teams`, `/agent-teams-mpd`,
   `/mpd` TUI-only, `/settings` TUI-only, host `/goal` carried by the `mpd` preset), each with what it
   does and where it works, plus the explicit negative: **there is no `/roster` command** (the roster
   is `mpd_roles_list`).
2. **End-to-end recipes** — new `§13. Recipes: literal calls` (`§13. 配方：可直接照抄的调用`), with nine
   subsections: 13.1 teams in **every approval mode** (`required` two-phase with
   `agent_teams_create`/`_add_member`/`_create_task`/`_edit_plan`/`_approve`, `automatic` single call,
   the running-team calls, the stop/resume/delete path), 13.2 the ULW loop and its gates, 13.3
   `mpd_role_spawn`, 13.4 `mpd_workmate_*`, 13.5 `mpd_hashline_*`, 13.6 `mpd_boulder_*`, 13.7
   `mpd_memory_*`, 13.8 `mpd_ext_*`/`mpd_flow_*` + the extension CLI, 13.9 the `agent_teams_*` loop for
   leaders and members. `§6` gained a `The call shapes` subsection (`§6` → `调用形态`) that names the
   one field that separates the approval modes.
3. **Per-knob restart behaviour** — new `§9.1 When a saved knob takes effect` (`§9.1 保存的旋钮何时生效`):
   a per-family table (read when → takes effect when) with the two verified non-restart paths
   (immediate read-back through `mpd_config_get`/`mpd_config_reload`; `watchdog.*` re-read live) and the
   `mpd-codegraph` row-option exception.
4. **Attribution facts** — new `§14. Where these capabilities come from` (`§14. 这些能力的来源`): a
   per-capability table (capability → upstream project/author → licence+version → where it is
   recorded), consistent with `README.md` §Acknowledgements and pointing at `LICENSE-NOTICES.md` as the
   authoritative record.
5. **The routed defect is fixed** — both dead references to the removed architecture files now point at
   the design document (`design.md` from the English file, `design.zh-CN.md` from the Chinese one), and
   `§3`'s tool table no longer advertises `mcp__git_bash__*` as available: it is now documented as
   **disabled by default**, with the enable instruction.

Section numbering was deliberately preserved: `§1`–`§11` keep their numbers and titles (new material is
appended as `§12`–`§14`), so `README.md`'s reference to "`docs/user-guide.md` §11 is the quick map"
still resolves.

## 3. The routed defect — two-pattern sweep, before and after

**BEFORE** (captured on the pre-edit tree):

```
$ git grep -nE "architecture(\.zh-CN)?\.md" -- 'docs/user-guide*.md'
docs/user-guide.md:7:[architecture.md](architecture.md).
docs/user-guide.zh-CN.md:6:[README](../README.zh-CN.md)；想了解内部原理请看 [architecture.zh-CN.md](architecture.zh-CN.md)。
[exit 0 — 2 hits, both DEAD links: the targets were deleted by t3]

$ git grep -nE "architecture\.md" -- 'docs/user-guide*.md'      # the naive single-pattern form
docs/user-guide.md:7:[architecture.md](architecture.md).
[exit 0 — 1 hit; the zh-CN line is INVISIBLE to it]
```

**AFTER** (both files, current tree):

```
$ git grep -nE "architecture(\.zh-CN)?\.md" -- 'docs/user-guide*.md'
docs/user-guide.md:546:- **A document link 404s after an upgrade** → the design document was RENAMED in this release (it used
docs/user-guide.zh-CN.md:493:- **升级后某个文档链接 404** → 本次发布**重命名**了设计文档（它原名 `architecture.md`，
[exit 0 — 2 hits, both deliberate PROSE inside the upgrade troubleshooting bullet: they name the old
filename as history so a reader understands the 404. Neither is a link; §4 below proves no link target
is missing.]
```

A full relative-link sweep (every `](…)` target resolved on disk) reports **0 dead links** in both
files — 7 distinct relative targets in the English file, 8 in the Chinese one (the twin adds the
language switch pair).

## 4. Verification commands and exit codes

| # | Command | Exit | Observed |
|---|---|---|---|
| 1 | `bun run verify:docs` | **0** | `[verify-docs-parity] root=/root/dshProj/my-power-dsh pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS`; the run lists `ok docs/user-guide.md` (the pair is discovered and checked: switch link, heading tree, real CJK content) |
| 2 | `bun run verify:rows` | **0** | `[verify-rows-parity] ok: 25 row ids match the bundle patch insert list (…)` |
| 3 | relative-link resolution check (node, walks every `](…)` target and `existsSync`s it) | 0 | `docs/user-guide.md: 0 dead of 7 distinct relative links` / `docs/user-guide.zh-CN.md: 0 dead of 8 distinct relative links` — as measured at t5 completion; the ZH figure was 8 then and is **7** now, see the correction in §8 (0 dead either way) |
| 4 | heading-tree parity (node, `##`/`###` with code fences excluded) | 0 | `EN heading count 34 ZH 34`; numbered tree `["1"…"14"]` **IDENTICAL** on both sides |
| 5 | tool-identifier resolution (node; every backticked `mpd_*`/`agent_teams_*`/`session-watchdog-*`/`mcp__*` token checked against the 63 registered tools + 16 MCP tools of the t1 fact base) | 0 for real tools | the ONLY unresolved token is `agent_teams_halt`, and it appears exactly twice per file **as prose saying it is not a tool**; `grep -n "agent_teams_halt *{"` returns nothing (exit 1 — no invocation shape anywhere) |
| 6 | command coverage (each of the 8 commands present in both files) | 0 | `/ulw` 4/4, `/ultrawork` 2/2, `/mpd-codegraph` 1/1, `/mpd` 6/6, `/agent-teams` 2/2, `/agent-teams-mpd` 1/1, `/settings` 6/6, `/goal` 1/1 (EN/ZH) |
| 7 | required call shapes (20 literal invocations from the acceptance list present in both files) | 0 | 20/20 OK in each file — `agent_teams_create {`, `agent_teams_approve {`, `agent_teams_edit_plan {`, `agent_teams_status {}`, `agent_teams_reassign_task {`, `mpd_ulw {`, `mpd_ultrawork {`, `mpd_role_spawn {`, `mpd_workmate_init/spawn/delete {`, `mpd_hashline_read/edit {`, `mpd_boulder_start {`, `mpd_boulder_task_timer {`, `mpd_memory_save/write {`, `mpd_ext_list/show {`, `mpd_flow_list {` |
| 8 | cross-document links at their own file depth (node, 10 pairings) | 0 | 10/10: `README.md→docs/user-guide.md`, `README.zh-CN.md→docs/user-guide.zh-CN.md`, `README.md→docs/design.md`, `README.zh-CN.md→docs/design.zh-CN.md`, `docs/design.md→user-guide.md`, `docs/design.zh-CN.md→user-guide.zh-CN.md`, `docs/user-guide.md→design.md`, `docs/user-guide.zh-CN.md→design.zh-CN.md`, `docs/user-guide.md→../README.md`, `docs/user-guide.zh-CN.md→../README.zh-CN.md` |

No gate was run against the real `~/.dsh`, and no `--dump-config` result is cited as load evidence:
this task changed documentation only.

## 5. Facts used, by SOURCE SYMBOL (never by line number)

- `packages/mpd-bundle/cordis.patch.yml` row `mcp-gitbash` → `disabled: true` with the upstream-design
  comment (Windows-only) — the correction in `§3` and the new `§11` bullet.
- `mpd-config`: service `mpdConfig.get`/`reload`, the settings-namespace registration with
  `applies: "restart"`, the file watcher that calls `reloadAt` after a settings write, and the tools
  `mpd_config_get` (re-reads per call) / `mpd_config_reload` — the `§9.1` rule and its read-back
  exception.
- `mergedConfig(ctx, config)` called inside `apply()` in `mpd-ulw`, `mpd-hashline`, `mpd-boulder`,
  `mpd-comment-checker`, `mpd-memory`, and the equivalent overlay in `mpd-modelchain` — "captured at
  mount" for those families.
- `packages/mpd-team-watchdog-plugin/src/engine.ts` `refreshKnobs` (re-read at apply, on a
  settings-document update, and once per tick; the file layer wins live) plus the
  `session-watchdog-status` LIVE/FILE + `restartRequired` surface — the `watchdog.*` live exception.
- The adopted team-model slot resolver (`mpd-deltas.js` region `team-model-slot-routes`) reading
  `ctx.get("mpdConfig").get("teamModels.slot<N>")` at STAGING time — the `teamModels` row.
- `packages/mpd-bundle-plugin/src/index.ts` `stateDirResolver` (per-call `team.stateDir` read) and the
  `agent-teams` row's `stateDir: .mpd/team` option.
- `packages/mpd-config-plugin/src/settings-schema.ts` `SettingsSchema` — 6 single keys + 7 `watchdog`
  fields + 12 `teamModels` leaves = the 25 knobs.
- `packages/mpd-agent-teams-plugin/lib/tools.js` — the 21 tool registrations, the `approval` enum
  (`required|automatic`), the `edit_plan` `operations[].action` enum, the `create_task` `kind` enum,
  and `agent_teams_approve`'s required `confirmation`; the absence of a `halt` registration (the pause
  mechanism is a string constant reached through the Web Stop-team route).
- `presets/mpd/agent.cordis.yml` rows `command-goal` + `tool-goal` — why `/goal` works in both
  compositions.
- `LICENSE-NOTICES.md` (§ dsh-agent-teams, § comment-checker) and `packages/mpd-agent-teams-plugin/LICENSE`
  (MIT, © 2026 程序员阿江 (Relakkes)) — the `§14` attribution rows.

## 6. Boundary

- Changed: `docs/user-guide.md`, `docs/user-guide.zh-CN.md`, this evidence file. Nothing else.
- Not touched (owned by other lanes): `README.md`, `README.zh-CN.md` (t4), `docs/design.md`,
  `docs/design.zh-CN.md` (t3), `docs/index.md`, `docs/index.zh-CN.md`, `AGENTS.md`, the patch comment
  (t12), `packages/**`, `skills/**`.
- The remaining old-filename strings are intentional prose (§3 above). If a later sweep must be
  grep-clean of `architecture.md` as a *link*, the correct test is link resolution (row 3), not a
  substring count.

## 7. Restart-time re-check

File hashes re-read after the settle window and re-compared before completion; the values in §1 are the
settled ones (see the completion payload for the re-check result).

## 8. t17 repair — the two t8 verification findings, closed (attempt 1, `c9ecfd9e-1377-4917-9bdd-ce54a2b9c327`)

This section SUPERSEDES §1's hashes and §4 row 3's link counts; §1 and §4 stay as the t5-completion
record.

### Current deliverables (settled)

| Path | Bytes | sha256 |
|---|---|---|
| `docs/user-guide.md` | 767 lines | `235d01eeb63da62d5792d47d9e06d03dee60fb02c8785fafd4f1f88579c84fb7` |
| `docs/user-guide.zh-CN.md` | 702 lines | `5a4b1b6b2ce4f0ec8339b0408656cf69822883e37d72f6cd11e076c62bc8acb1` |

### T8-F1 (high, BLOCKING) — `memberName` → `member_name` in the §13.1 recipe, BOTH twins

BEFORE (`docs/user-guide.md`, `§13.1`):

```
agent_teams_edit_plan { "operations": [ { "action": "update_task", "task_id": "t1", "assignee": "Deep Worker" }, { "action": "add_task", "subject": "Verify the README pair", "kind": "verification" }, { "action": "remove_member", "memberName": "Researcher" } ] }
```

BEFORE (`docs/user-guide.zh-CN.md`, `§13.1`) — the same line with the Chinese subject text:

```
agent_teams_edit_plan { "operations": [ { "action": "update_task", "task_id": "t1", "assignee": "Deep Worker" }, { "action": "add_task", "subject": "验证 README 文档对", "kind": "verification" }, { "action": "remove_member", "memberName": "Researcher" } ] }
```

AFTER (identical in both files, only the key changed): `… { "action": "remove_member", "member_name": "Researcher" } …`

Source of truth, by SYMBOL (never by line number): `packages/mpd-agent-teams-plugin/lib/tools.js` —
the `agent_teams_edit_plan` input schema's `operations.items` object carries
`additionalProperties: false` and declares **`member_name`** (there is no `memberName` property), and
the executor reads `operation.member_name?.trim()` and throws `<label> requires member_name` when it is
empty. Snake_case is also what the sibling keys use there (`task_id`, `reasoning_effort`); the only
camelCase keys in that object are `inScope` / `outOfScope`, which the recipe does not use.

Definition of done: `grep -n "memberName" docs/user-guide.md docs/user-guide.zh-CN.md` prints nothing
(exit 1), and `grep -c "member_name"` returns 1 in each file.

### T8-F2 (low) — §12's preamble no longer claims every listed command is bundle-registered

BEFORE (`docs/user-guide.md`, `§12`):

```
Every slash command this bundle registers, with where each one works. Nothing else exists — in
particular **there is no `/roster` command**: the roster is reached with the `mpd_roles_list` tool.
```

AFTER (EN):

```
Every slash command a session can use, with where each one works. The table carries two classes: the
**six commands this bundle contributes** (`mpd-ulw` registers `/ulw` and `/ultrawork`,
`mpd-codegraph` registers `/mpd-codegraph`, `mpd-tui` registers `/mpd`, and the adopted `agent-teams`
plugin registers `/agent-teams` and `/agent-teams-mpd`), and the **two HOST-provided commands the
bundle only documents** — `/settings`, the host's TUI settings screen (whose MPD section the bundle
extends), and `/goal`, the host goal command the `mpd` preset mounts. Nothing else exists — in
particular **there is no `/roster` command** …
```

BEFORE (ZH): `本 bundle 注册的全部斜杠命令，以及各自可用的位置。…`
AFTER (ZH): `会话中可用的全部斜杠命令，以及各自可用的位置。表里有两类：本 bundle **贡献的六条命令**（…）以及本 bundle 只是**记录**的两条 **宿主命令** —— `/settings`（…）与 `/goal`（…）。…`

### What did NOT change

- The 8-command table keeps the same rows in both files (8 rows counted in each).
- Heading tree: EN 35 / ZH 35 headings (H1 + `##` + `###`, code fences excluded), level sequence
  identical, numbered tree identical.
- Exactly four lines differ from the pre-repair pair (2 × F1 recipe line, 2 × F2 preamble), and
  nothing under `packages/**` was touched: the fix is documentation-only and the recipe stays a
  literal, copy-pasteable call.

### Gates on the repaired bytes

| Command | Exit | Observed |
|---|---|---|
| `bun run verify:docs` | **0** | `[verify-docs-parity] root=/root/dshProj/my-power-dsh pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS` |
| `node scripts/verify-rows-parity.mjs` | **0** | `[verify-rows-parity] ok: 25 row ids match the bundle patch insert list (…)` |
| regression, relative-link resolution | 0 | `docs/user-guide.md: 0 dead of 7 distinct relative links` / `docs/user-guide.zh-CN.md: 0 dead of 7 distinct relative links` |
| regression, tool-identifier resolution | 0 for real tools | unchanged: the only unresolved token is `agent_teams_halt`, documented AS not a tool, in no invocation shape |

**Correction to §4 row 3:** the ZH count there says 8; the current and correct count is **7**. The
eighth target was the `design.md` link that lived inside the §11 upgrade bullet, which was reworded to
prose (deliberately, so the only remaining old-name strings are non-links) in the last t5 edit — after
row 3's measurement. The design document is still linked from the ZH file's own depth, as
`design.zh-CN.md` in the intro. `grep -c "design.md" docs/user-guide.md` = 1 and
`grep -c "design.zh-CN.md" docs/user-guide.zh-CN.md` = 2.
