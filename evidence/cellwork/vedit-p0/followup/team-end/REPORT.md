# N3 — a real team-end verb (`agent_teams_control {action:"end"}`)

- Wave: 0.17.2 team · row **T3** (lane B) · loop `loop-20261103T061032-b0639d`
- Contract: `.mpd/plans/vedit-p0-followup.md` + the captain's close diagnosis (no supported verb ends a live team)
- Owner: `se-consume` (Senior Engineer) · Date: 2026-11-03
- Scope written: `packages/mpd-team-core-plugin/src/{team-store,team-actions,index}.ts`,
  `packages/mpd-team-core-plugin/test/{team-end,tool-surface}.test.ts`
- Evidence: this directory (`evidence/cellwork/vedit-p0/followup/team-end/`)

## The defect this closes

Before this change **no supported call could end a LIVE team**:

| surface | what it actually does | why it is not an ending |
|---|---|---|
| `agent_teams_plan {action:"delete"}` | `archivePlan` of the session's STAGED plan | ends nothing once a team exists |
| `agent_teams_control {action:"halt"}` | workspace-wide hold (`placeHold`) | a pause; README: "A halt is not an ending" |
| `mpd_team_compact_run` | audit record under `.mpd/team-compact/` | audit-only |
| `reapReapedTeams` | stamps records that are ALREADY non-live | skips live teams by design |
| `deleteTeam` / `unbindActiveTeam` | store helpers | no callers |

So the only close was a hand edit of `phase:"ended"` + `endedAt`. The tool description itself pointed at
`agent_teams_plan {action:"delete"}` — a false pointer.

## What changed

1. **`src/team-store.ts` — `endTeamRecord(workspace, teamId, reason, now)`** (new, exported)
   - reads the record, stamps `phase:"ended"` + `endedAt` + `archivedReason`, persists through
     **`writeTeam`** (never a raw file write, so `teamStateChanged`/the change feed observe it);
   - **idempotent by the record**: a record already carrying `endedAt` is returned unchanged with
     `changed:false` — the FIRST ending owns the instant and the reason, so a retry never restamps the
     audit trail;
   - empty reason → the stored default `"ended by the team Lead"`;
   - returns `undefined` when no such team exists.
   - `TeamRecord.archivedReason`'s doc comment was widened to say an explicit end writes it too.

2. **`src/team-actions.ts` — `endTeam(deps, caller, input)`** (new, exported; `TeamEndInput` /
   `TeamEndPayload`)
   - **team-scoped**: a declared `team_id` is read directly (explicit repair target), absent means the
     caller's own resolved team (`deps.resolveTeam`, i.e. the bound index → recorded Lead → roster arms,
     live teams only);
   - **Lead-only**: `recordNamesLead(record, [sessionId, ...lineage])` — `lineage` is empty for a
     recorded delegation child (`where()` drops a member's parent, so captaincy is never inherited);
     refusal sentence distinguishes a roster member (`"… is a member, not the Lead"`) from a stranger
     (`"this session is not on the team's roster"`), and **writes nothing**;
   - an unknown declared id answers `no team record is named "<id>" in this workspace`;
   - an already-ended team answers `{ok:true, changed:false, endedAt:<first>, reason:<first>}`.

3. **`src/index.ts` — the control tool**
   - `action` enum gains `end`; new `team_id` argument; `reason` now documented for `halt/fence/end`;
   - description **rewritten** (the `delete` pointer is gone):
     `` `halt` stops NEW DISPATCH only; `resume` clears the hold; `fence`/`unfence` close/reopen ONE
     seat, then never messaged (Lead only); `end` closes the team (Lead only, idempotent). ``
   - output schema gains `endedAt` and `changed`; the render reports both the ending and the no-op
     (`team <id> was already ended at <instant> — nothing changed`);
   - the `end` branch rethrows a refusal exactly like `fence` (tool callers keep the old error shape);
   - unknown-action sentence now lists `end`.

4. **`test/tool-surface.test.ts`** — the control action contract gains `end` (sorted enum), and the
   context-budget comment records the re-measurement: **6,390 < 6,400** (the addition was paid for by
   tightening the halt sentence; the bound was NOT moved).

5. **`test/team-end.test.ts`** (new, 6 arms) — real tool → real store, stub executor for the approval:
   - a live team ends via a **declared `team_id`**, record carries `phase:"ended"`, the reply's
     `endedAt`, and `archivedReason` = the reason;
   - after the end the team **resolves for nobody**: `mpdTeams.active()` is `undefined` for the Lead AND
     for the member handle, `status.team` is `null` — while `activeTeamId()` still returns the id, which
     proves the **liveness filter** is what closes the binding (the index was not hand-cleared);
   - a **member is refused** and a **stranger is refused** (declared id), both with the right sentence,
     and the record keeps no `endedAt`;
   - a **repeat is a no-op**: `changed:false`, the reply returns the stored ending, and a sentinel
     `endedAt` planted on disk survives a second `end` with a different reason (no restamp);
   - an end with no reason stores the default sentence;
   - an unknown declared id is refused.

Not touched (deliberate): `packages/mpd-team-core-plugin/README.md` / `README.zh-CN.md` (docs lane
N6 — exact wording below), `dist/**` (captain integrates), `teams.json` (see Bounds).

## Gates (all run on the final tree; logs in this directory)

| Gate | Command | Observed |
|---|---|---|
| Package tests | `bun test packages/mpd-team-core-plugin` | **581 pass / 0 fail**, 2800 expect() calls, 40 files — `tests-package.log`, exit 0 |
| New arms | `bun test packages/mpd-team-core-plugin/test/team-end.test.ts` | **6 pass / 0 fail** — `tests-team-end.log`, exit 0 |
| Typecheck | `bun run typecheck` (`tsgo --noEmit`) | no output, **exit 0** — `typecheck.log` |
| Comments | `node scripts/verify-comment-coverage.ts` | `scanned 592 … inspected 51861 declaration(s) … VERDICT: PASS`, **exit 0** — `comments.log` |

Diff of the touched source/test files: `diff.patch` (281 lines). No git write was performed.

## README wording for N6 (docs lane) — exact

N6 must edit BOTH READMEs in the same commit (bilingual pair). Three spots.

**(a) EN table row (README.md, line 25):**

```markdown
| `agent_teams_control` | `halt`, `resume`, `fence`, `unfence`, `end` | a hold that stops new dispatch and nothing else; `fence`/`unfence` close one seat; `end` closes the team for good (Lead only, idempotent) |
```

**(b) EN bullet (README.md, line 302), replace the whole line:**

```markdown
- **A halt is not an ending; `end` is.** `halt` records a hold: no member is interrupted and nothing is
  archived, so the roster, board and bindings stay and `resume` lifts it. `end`
  (`agent_teams_control {action:"end", team_id?, reason?}`, Lead only) is the terminal verb: it stamps
  `phase: "ended"`, `endedAt` and `archivedReason` on the mpd record THROUGH THE STORE (`endTeamRecord`,
  which calls `writeTeam`), so the team stops resolving for every seat — dispatch, claim and mailbox
  writes can no longer reach it — while the record itself stays on disk as history. A repeated `end` is a
  reported no-op (`changed: false`) that keeps the first ending's instant and reason.
```

**(c) zh-CN table row (README.zh-CN.md, line 22):**

```markdown
| `agent_teams_control` | `halt`、`resume`、`fence`、`unfence`、`end` | 只停派工、别的什么都不做的暂停；`fence`/`unfence` 只关闭一个席位；`end` 彻底结束团队（仅 Lead、幂等） |
```

**(d) zh-CN bullet (README.zh-CN.md, line 240), replace the whole line:**

```markdown
- **暂停不是结束，`end` 才是。** `halt` 只记录一次 hold：不打断任何成员，也不归档任何东西，因此名册、看板与绑定都还在，`resume`
  可以撤销。`end`（`agent_teams_control {action:"end", team_id?, reason?}`，仅 Lead 可调用）是终局动词：它**经由 store**
  （`endTeamRecord`，即 `writeTeam`）在 mpd 记录上盖下 `phase: "ended"`、`endedAt` 与 `archivedReason`，此后这个团队对所有席位都不再解析——
  派工、认领与邮件都再触不到它，而记录本身作为历史留在磁盘上。重复调用 `end` 是会被报告的 no-op（`changed: false`），
  保留首次结束的时刻与原因。
```

**Optional intro touch (README.md line 7 / README.zh-CN.md line 7):** the sentence listing "a halt, and an
archive" may add "an end" (`… a task contract frozen at claim time, a halt, an end, and an archive.` /
`…暂停、结束，以及归档。`). Not required by the contract; N6's call.

## Bounds (stated, not hidden)

- **No dist build** (per the brief): `packages/mpd-team-core-plugin/dist/index.js` is stale until the
  captain's integration rebuild. A `link:` install reads `src` only through the build, so the shipped
  dist must be regenerated with the pinned toolchain before release.
- **No README edit** (per the brief): the package README still says `agent_teams_control` =
  `halt`, `resume` and still says "A halt is not an ending." without the `end` clause. That is N6's row.
- **The binding is left on disk on purpose.** `end` stamps the RECORD; `teams.json` keeps pointing at
  the ended team, and `isLiveTeam`/`resolveTeamRecord` filter it out (the same rule the reaper relies
  on). The test asserts both facts, so a future "cleanup" that skips the filter still reddens.
- **No web/panel surface for `end`.** `mpdTeamActions` (the service the HTTP routes and panel call) does
  not expose `end`; the tool is the only surface. Adding the service/route method is a follow-up, not
  part of this contract.
- **No concurrency lock.** An `end` issued while a dispatch pass is mid-flight can land after that pass
  already paired a row; there is no cross-surface lock for end (same class as the existing actions).
- **A member can no longer close its row after the end** — resolution finds no team, so `claim`/
  `complete` refuse. That is by design (the wave is over), but a stranded `in_progress` row remains on
  the ended record as history and is never auto-cancelled by `end`.
- **Verification basis:** stub executor + real plugin/store in-process. No live harness mount / real
  `dsh` boot was run for this verb (the brief's gate list did not include one); the captain's wave
  gates (`bun test packages`, preset conformance) remain the integration-level check.
- Cross-package suites were not run by this lane (only the commands the brief names); `bun run
  typecheck` type-checks the whole repo and is green.
