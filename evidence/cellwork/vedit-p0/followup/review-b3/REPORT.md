# Review B3 — the N3 repair (T8): B1 / M1 / N1 / N2 / N3 + the T16 N4 reword

- Reviewer: `rev-consume` (Reviewer) · row **T10** (replaces the failed T9) · wave 0.17.2 team
- Loop: `loop-20261103T061032-b0639d` (the same loop that carries my FAIL of T3) — record **PASS**
  `rec-20261103T065421-1f9fcc`
- Contract: `.mpd/plans/vedit-p0-followup.md` (frozen) + the captain's T10 brief
- Repair evidence: `evidence/cellwork/vedit-p0/followup/team-end/repair/` (the T8 REPORT, `auth-probe.ts`,
  its log, the diff, the gate logs)
- My evidence: this directory (`00`..`06`), including two re-runnable probes
- No code was edited; the only writes are this directory and the loop record.

## Assessment

**Risk level: LOW for the repair itself; HIGH for one adjacent, pre-existing issue I found while testing it.**
The repair does what was asked, and it does it at the right layer: `leadAuthorityOf` narrows the Lead
check to the caller's OWN session id whenever `memberNamedBy(record, [caller.sessionId])` names it, which
closes exactly the shape my B1 measured (a roster member with `{parentSession: lead}` and no
`origin`/`delegationDepth` is now refused with "is a member, not the Lead", while a genuine fork still
ends through the recorded lineage); `boundEndedTeamOf` makes the default-target repeat answer
`changed:false` with the FIRST `endedAt`/`reason` instead of the misleading "no team record" refusal;
the ending appends exactly ONE `team-ended` journal row (none on the repeat) and shares one `deps.now()`
reading with the record; the halt-survives-end decision is documented and pinned; and the packer NOTE now
states the truth about where the byte rule lives. My own gates on the settled tree are green: package
**588 pass / 0 fail** (2849 expect, 40 files), the new file **13 pass / 0 fail**, typecheck 0, comments 0.
**However**, while discriminating the fix I found that the identity plane still cannot tell a *resumed
member session* from a *forked Lead* — and the end verb therefore still ends the team for that shape. It is
**pre-existing** (the same session can already append to the live roster and be healed into `leadHistory`),
so it is **not a defect of T8** and does not change my verdict; it is the single item I recommend as a new row.

## Verdict on each item the repair committed to

- **B1 (Blocker) — CLOSED for the reviewed shape.** `team-actions.ts#leadAuthorityOf`: `ownMember` is
  resolved by the caller's own id only; a roster member contributes `[caller.sessionId]` and nothing else;
  a caller the roster does not name keeps `[caller.sessionId, ...caller.lineage]`. My probe
  (`01-auth-probe.log`): the reviewed shape (session id **is** the recorded `executorRef`, `parentSession`
  = Lead) is REFUSED; the `origin:"subagent"` and `delegationDepth:1` controls do not reach the verb
  ("no team record" / refused); a genuine fork (not on the roster) ENDS (`changed:true`). The repair's own
  reconstructed probe passes (`02-repair-auth-probe.log`), and its "old raw expression would authorize"
  discriminator is a real measurement, not a claim.
- **M1 (Medium) — CLOSED.** First default-target end → `changed:true`; the identical call → `changed:false`
  with the SAME `teamId`/`endedAt`/`reason`; the record and the reply agree. A non-Lead bound to the ended
  team is still refused (authority precedes the no-op). `setup` note: `boundEndedTeamOf` reads the index
  directly and only returns an already-ended record, so it can report a terminal team but never end or
  reveal a live one the caller does not lead.
- **N1 (journal) — CLOSED.** `TeamJournalEvent` gains `team-ended`; the row is appended only when
  `outcome.changed`, and the record's `endedAt` and the row share ONE `now` reading. The arm asserts
  exactly one row, the reason, and no second row after the repeat.
- **N2 (halt survives end) — ACCEPTED as the documented semantic.** The hold is workspace-wide
  (`.mpd/team/hold.json`, no team id), so clearing it from one team's ending would silently resume a
  sibling's dispatch. The decision is in `endTeam`'s doc comment, pinned by an arm, and its README wording
  is N6's row. I agree with the trade-off; the one residual is that until N6 lands the semantic is
  documented in code/tests, not in the package README.
- **N3 (repair-target authority) — CLOSED.** Two non-vacuous arms: an unbound Lead ends by declared id, and
  the Lead of ANOTHER team is refused by declaring that id (`not on the team's roster`), with both records
  unchanged and the other Lead still able to end its own team.
- **T16 N4 (packer NOTE) — CLOSED.** The NOTE now reads "… add them here so the NOTE stops, and add them to
  `scripts/verify-pack-closure.ts#REQUIRED_ROOT_FILES` so the gate byte-checks them", with a comment saying
  the byte rule is the GATE's list and that this anchor only feeds its fixture. That matches the design
  verified in T21.

## Findings

### Adjacent, PRE-EXISTING — **High** (not counted against T8; recommend a new row)

**A1 — a session the record cannot name by id can still end the team, because the identity plane cannot
tell a resumed member from a forked Lead.**
*Where:* `packages/mpd-team-core-plugin/src/team-actions.ts#leadAuthorityOf` (falls back to
`[caller.sessionId, ...caller.lineage]` when `memberNamedBy(record, [caller.sessionId])` is undefined),
mirroring `packages/mpd-team-core-plugin/src/index.ts#callerIdentity` — whose title fallback cannot match
the stored roster name; and, in the pre-existing write path, `index.ts#healLeadBinding`, whose member guard
is also id-only (`recordNamesMember(record, [sessionId])`).
*Why the title fallback does not rescue it:* the roster name is the **workmate slug** written by the W3-C
binding (e.g. `senior-engineer-1`), while the session title is the persona text (e.g. "You are the Senior
Engineer, …"); `title.includes(member.name)` compares the title against the slug, so it matches neither the
display name nor the capitalisation. Only `executorRef` reliably identifies a member.
*Measured (my durable probe, `auth-probe.ts` / `01-auth-probe.log`):*
- **T1** — session `member-resumed-77` (id ≠ `executorRef`), header `{parentSession: lead, title: persona}`,
  no origin/depth → `agent_teams_control {action:"end"}` SUCCEEDS: `changed:true`, the record is stamped
  `phase:"ended"`. No heal was involved (`leadHistory` stayed empty on that record).
- **T2** — the same session as a recorded delegation child (`origin:"subagent"`) → refused / not resolvable.
- **T3** — the repaired shape (id == `executorRef`) → refused "is a member, not the Lead".
- **T4** — a genuine fork (not on the roster, no persona title) → ends, by design.
- **T5** — the same title-shaped session's live-roster append → **ALLOWED** (it appended `Sneak`), and the
  record's `leadHistory` gained `member-resumed-77` (the pre-existing `healLeadBinding` promotion). The
  stored roster names were `["senior-engineer-1", "Sneak"]`, which is what defeats the title comparison.
*Why it matters:* ending is irreversible through the bundle; and the heal converts the ambiguity into a
permanent recorded Lead identity.
*Direction (a separate row, not this repair):* persist the member's session id on resume (or bind it the
way the Lead's binding is healed), and/or make `callerIdentity`'s title arm compare against the member's
display/role text rather than the slug; consider refusing the heal for a caller whose title names a roster
member once the comparison works. This is a plane-level identity fix, not a one-line change in `endTeam` —
which is why T8 should not be failed for it.

### Nit

**N1 — the narrowing rule now exists in TWO implementations, and they already disagree.**
`index.ts#callerIdentity` (id + title fallback) and `team-actions.ts#leadAuthorityOf` (id only) encode the
same F-B rule. The disagreement is exactly A1's trigger, and a future change to one will not reach the
other. Direction: move the predicate to `team-store.ts` beside `memberNamedBy`/`recordNamesMember` and let
both callers import it (the repo's own "ONE resolver" principle). Also soften `endTeam`'s doc sentence
("a member whose session records the Lead as its parent cannot borrow captaincy") to the scope the code
actually enforces — a member the RECORD names by `executorRef`.

## Declined to judge (weighed and set aside)

- **Ending a STAGED team** leaves the staged plan in `.mpd/team/staging`; the plan `delete` action remains
  the documented close for an unapproved plan, and the brief is about a live team. Not judged (carried
  from review B2).
- **A record with `phase:"ended"` but no `endedAt`** is re-stamped (as does the reaper). Pre-existing
  terminal rule, not introduced here.
- **Journal append failure after the record write** would surface as an unexpected refusal although the
  end landed — the same ordering every sibling action uses (`writeTeam` then append); not judged.
- **The verify recorder flattens severities to `minor`** in stored records; the ranking in this report and
  in my message to the Lead is authoritative.
- **README wording (N6)** — still owed: the `end` verbs, the halt-survives-end limit, and the journal
  sentence. The repair's REPORT supplies exact EN/zh-CN text for all three.

## Bounds of this review

- **No dist build** (the captain integrates): `packages/mpd-team-core-plugin/dist/index.js` still lacks the
  `end` verb, so the released artifact does not carry it yet; this verdict is source/test-level.
- **No live harness mount**: the probes drive the REAL plugin, tool registry and store in-process with a
  stub executor (the same basis the writer used). I did not observe a real resumed-member session; A1 is
  measured on the session shape the repository's own `callerIdentity`/heal rules are written for, and its
  severity is bounded by that.
- I read the repair REPORT, its probe and log, the diff, the changed sources
  (`team-actions.ts#leadAuthorityOf`/`#boundEndedTeamOf`/`#endTeam`, `team-journal.ts`, the packer NOTE),
  and the new test arms; I did not re-read unrelated packages or the whole working-tree diff.
- No credentials, tokens or connection strings were encountered.

## Evidence index (this directory)

| file | what it proves |
|---|---|
| `00-first-run-auth-probe.log` / `00-first-run-heal-probe.log` | the first exploratory runs (kept for provenance; superseded by the durable probes) |
| `auth-probe.ts` + `01-auth-probe.log` | T1 ends (residual), T2/T3 refused, T4 ends (fork), T5 append ALLOWED + `leadHistory` promotion; gated arms PASS |
| `02-repair-auth-probe.log` | the writer's own four-arm probe, re-run by me: `PROBE PASS` |
| `03-package-tests.log` | `bun test packages/mpd-team-core-plugin` — 588 pass / 0 fail / 2849 expect / 40 files |
| `04-team-end-tests.log` | `bun test .../test/team-end.test.ts` — 13 pass / 0 fail / 92 expect |
| `05-typecheck.log` | `bun run typecheck` — exit 0 |
| `06-comments.log` | `bun run verify:comments` — VERDICT PASS, exit 0 |
