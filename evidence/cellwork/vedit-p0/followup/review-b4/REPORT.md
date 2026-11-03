# Review B4 — the identity-plane repair (T12): a resumed member is a member

- Reviewer: `rev-consume` (Reviewer) · row **T13** · wave 0.17.2 team
- Loop: `loop-20261103T065530-23984a` — record **PASS** `rec-20261103T071018-33b8a2`
- Contract: `.mpd/plans/vedit-p0-followup.md` (frozen) + the captain's T13 brief
- Repair evidence: `evidence/cellwork/vedit-p0/followup/identity-plane/` (REPORT, before/after logs,
  `diff.patch`, gate logs)
- My evidence: this directory (`01`..`07`), including my ORIGINAL probe re-run **unmodified**
- No code was edited; the only writes are this directory and the loop record.

## Assessment

**Risk level: LOW.** The repair fixes A1 at the right layer and does it with ONE predicate instead of
three drifting copies: `team-store.ts#memberIdentityOf` (own id → recorded ancestor → persona title over
the seat's role/display text) now feeds `team-actions.ts#leadAuthorityOf`, `index.ts#callerIdentity` and
`index.ts#healLeadBinding`, and its `{member?, named}` split is the exact distinction the plane needed —
"is this a member at all" (narrow authority) versus "which row" (act as that seat). My own probe from
review B3, **re-run byte-for-byte unmodified**, now measures the acceptance result: the resumed member's
`end` is REFUSED with the record left `active` and `leadHistory: []`, its live-roster append is REFUSED
with the roster unchanged and no heal, the origin/depth and reviewed shapes stay refused, and a genuine
fork still ends the team. The new 10-arm `identity-plane.test.ts` is non-vacuous (it builds the W3-C slug
seat, the ambiguous twin-role roster and the resumed-member handoff/context arms), the 13 team-end arms
are unchanged and green, and the package as a whole is **598 pass / 0 fail**. Two Nits remain (title
substring ambiguity, and a slug claim the implementation does not actually enforce); neither weakens the
security direction, and neither blocks the wave.

## Judgment on each item the captain named

- **`memberIdentityOf` is ONE narrowing beside `memberNamedBy`, used by BOTH callers — YES.** Verified in
  source: `leadAuthorityOf` calls it and uses `identity.named ? [caller.sessionId] : [there, ...lineage]`;
  `callerIdentity` calls it and answers `ancestry: []` for any `named` caller. The two former
  implementations are gone (the T10 Nit's disagreement cannot recur). `healLeadBinding` was also rewired
  and now returns the record untouched for a `named` session — the write that made A1 durable is closed.
- **The three arms + `{member?, named}` — YES, and the semantics are the right ones.** Arm 1 own id
  (name/`executorRef`); arm 2 a recorded ancestor that IS a member's handle (the resumed session's own
  header names its old session); arm 3 the persona title over the seat's ROLE then display text, never
  the workmate slug *as the signal*. `named` is true for an ambiguous title with `member` absent, so the
  session borrows no ancestry but cannot act as one seat — measured in the unit arms and my probe.
- **The reviewer's probe, unmodified — PASS with the exact expected outcomes.** `01-reviewer-probe-unmodified.log`:
  T1 REFUSED ("… senior-engineer-1 is a member, not the Lead"), record `active`, `endedAt` absent,
  `leadHistory []`; T5 append REFUSED, roster still `["senior-engineer-1"]`, `leadHistory []`; T2/T3
  refused; T4 genuine fork `changed:true` and the record ends; `PROBE PASS (gated arms)`.
- **The new identity-plane tests + the 13 team-end arms — PASS.** `identity-plane.test.ts` 10/10 (30
  expect) covering the unit arms (id/executorRef, ancestor, role title, slug non-signal, ambiguous,
  foreign), T1, the ambiguous T1 twin, T5 + no-heal, `context` seat resolution, the resumed member's OWN
  handoff via the ancestor arm, and the genuine fork; `team-end.test.ts` 13/13 (92 expect) unchanged.
- **The stated bound — ACCEPTED.** A resumed member whose header carries neither its own id, nor a
  member ancestor, nor a persona title naming its seat stays indistinguishable from a Lead fork and keeps
  the lineage. That is inherent to a record-only identity plane (the record has no other fact to match),
  the direction is fail-closed elsewhere, and the practical shape is covered: the roster personas' first
  lines are `You are the <Role>, …`, which is the text the harness title takes from the prompt prefix — I
  checked the eleven persona first lines and the harness's session-title normalisation, and did not
  mount a live harness to observe the exact generation (declared below).
- **The softened `endTeam` doc — accurate.** It now says a session the RECORD NAMES (own id, recorded
  ancestor, or persona title over role/display text) cannot borrow captaincy, and that a session the
  record cannot name at all is still a Lead fork — which is exactly what the code does.

## Findings (ranked; neither blocks)

### Nit

**N1 — the title arm's substring matching can make a RESUMED member seat-less when roster roles overlap.**
`team-store.ts#titleNamesMember` matches a seat when the title contains its role text or stored name as a
case-insensitive substring. A roster holding BOTH a `Reviewer` and a `Plan Reviewer` seat therefore has
the Plan Reviewer's own title ("You are the Plan Reviewer, …") match **both** rows: `memberIdentityOf`
answers `named:true, member:undefined` (measured in `07-identity-edge-probe.log`), so the resumed Plan
Reviewer cannot act as its seat (`claim`/`complete`/`handoff`/`context` need the row) — a fail-closed but
real lockout, and the same class applies to short display names that are substrings of other seats.
*Direction:* when several role texts match, prefer the LONGEST match (most specific) before declaring
ambiguity — that selects `Plan Reviewer` for a Plan Reviewer title and leaves the Reviewer seat's title
unambiguous; a token-boundary rule alone would not separate them, a longest-match does.

**N2 — "never the workmate slug" is not what the code enforces, and the unit arm that claims it is vacuous.**
`titleNamesMember`'s texts include `member.name`, which for a W3-C-bound seat IS the workmate slug; a title
containing the exact slug (`"You are senior-engineer-1, …"`) names that seat (`07-identity-edge-probe.log`).
That behaviour is defensible (the title names the stored seat name), but the report's wording and the
unit arm "the workmate slug alone never does" do not test it: the arm uses `senior-engineer-9` against a
record whose seat is `senior-engineer-1`, so it passes for the wrong reason and would not catch a
regression to slug-as-signal. *Direction:* state the rule as "role first, then the seat's stored name",
and either assert the same-slug case (and accept it) or drop the name text; keep the doc and the arm in
step.

## Declined to judge (weighed and set aside)

- **Title trust.** The title is read from the harness session header (`sessionTitleOf`), never from a tool
  argument, so a caller cannot choose it through the surface; a subagent prompt could in principle be
  crafted with a seat's persona prefix, but under this bundle's delegation gate a member cannot spawn a
  session to do so, and a Lead impersonating its own member gains nothing. Not judged.
- **Official-plane membership** (`dsh.teamMembership`) is untouched; this row narrows only the mpd
  RECORD's identity plane. Out of this repair's scope.
- **Persistence of the resumed session id** (rewriting `executorRef`/binding on resume) is a larger
  harness-semantics change; the row states it as a bound rather than guessing. Accepted.
- **A fork whose title contains a roster role** loses Lead authority (fail-closed) — accepted as the safe
  direction; no roster persona first line collides with the captain persona.
- The recorder flattens severities to `minor`; this report's ranking is authoritative.

## Verdict

**Approve.** A1 is closed on the live check that matters — my own probe, unmodified — the narrowing is one
predicate used by every surface that previously disagreed, the heal can no longer manufacture a Lead, and
the suite is green; the two Nits are wording/specificity improvements for the next identity touch, not
security defects.

## Bounds of this review

- **No dist build** (the captain integrates): `packages/mpd-team-core-plugin/dist/index.js` still carries
  neither `end` nor this narrowing, so the released artifact does not have the fix yet; this verdict is
  source/test-level.
- **No live harness mount**: verification is the real plugin + real store over a stub executor (the same
  basis as the writer). I did not observe a real resumed-member session header; the title premise is
  checked against the eleven roster persona first lines and the harness's session-title normalisation, not
  a live boot.
- I read the repair REPORT, its diff, the changed sources (`memberIdentityOf`/`titleNamesMember`,
  `callerIdentity`, `leadAuthorityOf`, `healLeadBinding`, the handoff/context reads), the new test file and
  the gate logs; I did not re-read unrelated packages or the whole working-tree diff.
- No credentials, tokens or connection strings were encountered.

## Evidence index (this directory)

| file | what it proves |
|---|---|
| `01-reviewer-probe-unmodified.log` | my review-B3 probe, run unmodified: T1/T5 REFUSED with record+`leadHistory` unchanged, T2/T3 refused, T4 fork ends, PROBE PASS |
| `02-package-tests.log` | `bun test packages/mpd-team-core-plugin` — 598 pass / 0 fail / 2879 expect / 41 files |
| `03-identity-tests.log` | `identity-plane.test.ts` — 10 pass / 0 fail / 30 expect |
| `04-team-end-tests.log` | `team-end.test.ts` — 13 pass / 0 fail / 92 expect |
| `05-typecheck.log` | `bun run typecheck` — exit 0 |
| `06-comments.log` | `bun run verify:comments` — VERDICT PASS, exit 0 |
| `07-identity-edge-probe.log` | the two Nits: same-slug title matches (N2); a Plan Reviewer title matches both a Reviewer and a Plan Reviewer seat → `named:true, member:undefined` (N1) |
