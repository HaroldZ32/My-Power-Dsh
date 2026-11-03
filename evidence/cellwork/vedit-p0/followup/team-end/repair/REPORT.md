# T8 — N3 repair: close the end-verb auth bypass (B1) + M1 + N1/N2/N3 + T16 N4

- Wave: 0.17.2 team · row **T8** (repair of T3/N3) · loop `loop-20261103T061032-b0639d`
- Contract: `.mpd/plans/vedit-p0-followup.md` + the captain's T8 scope (incl. the T16 Nit extension)
- Review basis: `../review-b2/REPORT.md` (B1, M1, N1–N4) + `../review-b2/11-auth-probe.log`
- Owner: `se-consume` (Senior Engineer) · Date: 2026-11-03
- Evidence: this directory (`evidence/cellwork/vedit-p0/followup/team-end/repair/`)
- The pre-repair diff is `../diff.patch`; `diff.patch` here is the full working-tree diff (N3 + repair).

## B1 (BLOCKER) — the auth bypass, old vs new logic, exactly

### Old (pre-repair, `endTeam`)

```ts
/** Every spelling that identifies the caller: its own id plus the ancestors the harness recorded. */
const spellings = [caller.sessionId, ...caller.lineage].filter((id) => id !== "")
...
if (!recordNamesLead(record, spellings)) { … refuse … }
```

`caller.lineage` is `where()`'s recorded ancestry. `where()` empties it only when the harness stamped
`origin:"subagent"` or `delegationDepth >= 1`. A spawned member's session also carries the Lead as
`parentSession`, so a member WITHOUT those two stamps presented `[memberId, leadId]` and
`recordNamesLead` matched `leadId` — captaincy borrowed from the parent. That is the F-B/CWE-863 shape
PR #42 already repaired in `callerIdentity`, and ending is the one irreversible mutation in the plane.

### New (`team-actions.ts#leadAuthorityOf`, used by `endTeam`)

```ts
function leadAuthorityOf(record: TeamRecord, caller: TeamActionCaller): { ownMember?: TeamMemberRecord; lead: boolean } {
  /** The roster row this session IS, matched by its OWN id only — ancestry never names a member. */
  const ownMember = memberNamedBy(record, [caller.sessionId])
  /** A roster member borrows no ancestry; a caller the roster does not name keeps the recorded lineage. */
  const spellings = ownMember === undefined ? [caller.sessionId, ...caller.lineage].filter((id) => id !== "") : [caller.sessionId]
  return { ...(ownMember === undefined ? {} : { ownMember }), lead: recordNamesLead(record, spellings) }
}
```

- A caller the roster names as a **member** → `[ownId]` only → the Lead check cannot match the parent →
  refused with "… is a member, not the Lead".
- A caller the roster does **not** name → the C7-4 lineage stays, so a **forked/resumed Lead** still ends
  its team (the reviewer's arm 4).
- The member row is resolved by the caller's OWN session id only (never through lineage), so the refusal
  sentence (`is a member, not the Lead` vs `not on the team's roster`) is also computed from the
  narrowed identity.

### F-B probe result (`auth-probe.log`, exit 0)

The reviewer's probe script was not kept on disk, so I reconstructed its four arms from
`11-auth-probe.log` + the report and saved it as `auth-probe.ts` (re-runnable: `bun <this dir>/auth-probe.ts`).
It drives the REAL tool and REAL store:

| arm | session shape | observed |
|---|---|---|
| A | member handle + `{parentSession: lead}` (no origin/depth) — the bypass | **refused**: "only the Lead of team … may end it (senior-engineer-1 is a member, not the Lead)"; record stays `active` |
| A-discriminator | the OLD raw expression on the same record | `recordNamesLead(record, [memberHandle, lead]) === true` — i.e. the pre-repair check WOULD have authorized, so the arm is not vacuous |
| B | same member + `origin:"subagent"` | refused, same sentence |
| C | same member + `delegationDepth:1` | refused, same sentence |
| D | forked Lead (not on the roster, `parentSession` = Lead) | **ends**: `changed:true`, record `phase:"ended"` |
| M1 | default `end`, then the identical call | first `changed:true`; repeat `changed:false` with the SAME `endedAt`/`reason`/`teamId` |

`PROBE PASS`, exit 0.

## M1 (MEDIUM) — the default-target repeat is a reported no-op

`endTeam` now reads the caller's bound index entry when the live resolution finds nothing:
`boundEndedTeamOf(caller)` walks `[sessionId, ...lineage]` through `activeTeamId` → `readTeam`, returns
ONLY an already-ended record, and the same `leadAuthorityOf` check runs on it before the no-op payload
is returned. So a repeated `{action:"end"}` with no `team_id` answers
`{ok:true, teamId, endedAt:<first>, reason:<first>, changed:false}` instead of
`no team record in this workspace — approve a plan first`. A non-Lead bound to an ended team still gets
the ordinary refusal (authority precedes the no-op).

## N1 — the ending is journaled

`team-journal.ts#TeamJournalEvent` gains `"team-ended"`; `endTeam` appends
`{event:"team-ended", teamId, at, reason:<stored archivedReason>}` **once per actual ending** — never on
the idempotent repeat. The record's `endedAt` and the journal row share ONE `deps.now()` reading.

## N2 — a workspace halt survives the end (decided: documented, not cleared)

The hold `halt` writes is **workspace-wide** (`.mpd/team/hold.json`, no team id in it); it pauses EVERY
team of the workspace. Clearing it from one team's ending would silently resume a sibling's dispatch, so
`end` deliberately does NOT lift it: `resume` remains the only verb that clears a halt. The decision is
written into `endTeam`'s doc comment and pinned by an arm ("N2: a workspace halt SURVIVES the end, and
resume is the only verb that lifts it"). The control tool's description could not carry the clause (the
measured surface has 10 characters of headroom and the budget gate is binding), so the README's Known
limits must state it — exact wording for N6 below.

## N3 — the repair-target authority is discriminated by arms

- `N3: a declared id authorizes by RECORD, not by the index binding` — `unbindActiveTeam` removes
  `teams.json`'s entry, then the declared-id `end` still succeeds.
- `N3 negative control: the Lead of ANOTHER team cannot end this one by declaring its id` — a second
  team is approved by a second Lead session in the same workspace; that Lead names the first team's id
  and is refused ("not on the team's roster"), both records stay live, and the second Lead can still end
  its OWN team (so the refusal is about authority, not a broken verb).

## N4 (T16 Nit, captain's scope extension) — the packer's NOTE no longer lies

`scripts/pack-mpd.ts`, the unreachable NOTE for a declared-but-unanchored root file. NOTE on ownership:
`diff.patch` shows TWO hunks in that file — the `ROOT_FILES` anchor addition is T16's uncommitted work
(another lane), not part of this repair; the N4 delta is exactly the comment + reworded `console.log`
below.

- old: `… extend the anchor in scripts/pack-mpd.ts so the gate byte-checks them too`
- new: `… add them here so the NOTE stops, and add them to scripts/verify-pack-closure.ts#REQUIRED_ROOT_FILES so the gate byte-checks them`,
  with a three-line comment above it stating that the byte rule is the GATE's own list
  (`verify-pack-closure.ts#REQUIRED_ROOT_FILES`; the packer anchor only feeds the gate's self-test
  fixture). No packaging behaviour changed; the sentence remains unreachable today (all declared root
  files are anchored).

## Tests

`test/team-end.test.ts` grows from 6 to **13 arms** (the six original arms are unchanged):
B1 F-B bypass + origin/depth controls; B1 forked-Lead control; M1 default repeat; N1 journal row +
history; N2 halt survives + resume; N3 unbound Lead; N3 other-team Lead negative control.

## Gates (final tree; logs here)

| Gate | Command | Observed |
|---|---|---|
| Package tests | `bun test packages/mpd-team-core-plugin` | **588 pass / 0 fail**, 2849 expect(), 40 files — `tests-package.log`, exit 0 |
| Repair arms | `bun test …/test/team-end.test.ts` | **13 pass / 0 fail**, 92 expect() — `tests-team-end.log`, exit 0 |
| Typecheck | `bun run typecheck` | `tsgo --noEmit`, no output, **exit 0** — `typecheck.log` |
| Comments | `node scripts/verify-comment-coverage.ts` | `… VERDICT: PASS …`, **exit 0** — `comments.log` |
| Auth probe | `bun …/repair/auth-probe.ts` | `PROBE PASS`, **exit 0** — `auth-probe.log` |

No git write; no dist build. `diff.patch` (423 lines) carries the full working-tree diff of the touched
files (N3 + repair).

## README wording for N6 (docs lane) — the repair's additions

The pre-repair REPORT's wording (`../REPORT.md`, "README wording for N6") still stands. The repair adds
TWO facts N6 must carry, in both languages, in the same commit:

**(1) Known limits — add ONE bullet after the hold bullet (README.md line 454):**

```markdown
- **`end` does not lift a workspace `halt`.** The hold is workspace-wide — it pauses every team of the
  workspace — so clearing it from one team's ending would resume a sibling's dispatch; `resume` stays
  the only verb that clears it, and ending a halted team leaves the hold in force.
```

**zh-CN twin (README.zh-CN.md, 已知边界, after the first hold bullet at line 358):**

```markdown
- **`end` 不会解除工作区的 `halt`。** hold 是**工作区级**的——它会暂停同一工作区内的每一支团队——所以若在结束一支团队时顺手清除，就会把兄弟团队的派工也一并恢复；`resume` 仍是唯一能清除它的动词，结束一支处于暂停状态的团队后，hold 依然生效。
```

**(2) The existing "A halt is not an ending; `end` is." bullet (README.md line 302 / zh line 240):
append ONE sentence at the end of that bullet:**

EN: `Ending a team appends one \`team-ended\` row to \`.mpd/team/journal.jsonl\`; the idempotent repeat appends none.`

zh: `结束一支团队会在 \`.mpd/team/journal.jsonl\` 追加一行 \`team-ended\`；幂等的重复调用不会再追加。`

## Bounds (stated)

- **No dist build** (per the brief): `packages/mpd-team-core-plugin/dist/index.js` still lacks the
  `end` verb; `verify-dist-fresh` stays red for this package until the captain's integration rebuild.
- **README untouched** (docs lane N6): the package README still lists `halt, resume` and has neither the
  `end` clause nor the halt-survives-end limit. Exact wording above (and in `../REPORT.md`).
- **The control tool's description does not carry the halt/end interaction**: the surface measures 6,390
  of a 6,400 bound (10 characters), and the budget gate's own rule forbids moving the number, so the
  contract lives in the code doc, the test arm and the README.
- **The workspace hold is left in place by design** (N2): an operator who halts, ends the team and then
  starts a new team must `resume` first. That is the documented semantic, not an oversight.
- **`teams.json` keeps the ended team's binding** (needed by M1's no-op lookup); resolution filters the
  terminal record, so the binding still cannot win. The original test still asserts both facts.
- **No journal row on the idempotent repeat** — history says the team ended once; a retry is not a
  second event.
- **Verification basis**: stub executor + real plugin/store, in-process (the reviewer's probe shape).
  No live harness mount was run for this repair; the captain's wave gates remain the integration check.
- **N2's clear-vs-document decision** is a stated semantic, not a mechanism: if the captain prefers
  clearing the hold on end, that is a one-line change in `endTeam` plus the README text replacing this
  bound.
