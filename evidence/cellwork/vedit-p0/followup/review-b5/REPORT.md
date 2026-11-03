# Review B5 — the identity-Nits repair (T16): longest match + the stored-name rule

- Reviewer: `rev-consume` (Reviewer) · row **T17** · wave 0.17.2 team
- Loop: `loop-20261103T071147-3a898e` — record **PASS** `rec-20261103T071846-d60e0c`
- Contract: `.mpd/plans/vedit-p0-followup.md` (frozen) + the captain's T17 brief
- Repair evidence: `evidence/cellwork/vedit-p0/followup/identity-plane/repair/` (REPORT, before/after edge
  probes, `diff.patch`, gate logs)
- My evidence: this directory (`01`..`06`), including my edge probe reconstructed durably
- No code was edited; the only writes are this directory and the loop record.

## Assessment

**Risk level: LOW.** Both Nits are closed, and closed the way the review asked rather than by weakening the
rule: `titleNamesMember`'s boolean became `titleMatchLength`, and `memberIdentityOf` now keeps the LONGEST
match across the roster (per seat: ROLE first, then the seat's STORED name), so the `Reviewer`/`Plan
Reviewer` lockout is gone while a genuine equal-length tie still stays fail-closed; and the "never the
workmate slug" claim is replaced by the rule the code actually enforces — a title containing the seat's
stored name (the W3-C slug for a bound seat) names it — with the vacuous unit arm replaced by a real
both-ways assertion. My independent re-runs agree with every claim: my own edge probe (rebuilt durably
from the review-B4 measurements) returns Plan Reviewer → the Plan Reviewer seat, Reviewer → the Reviewer
seat, a twin-role tie → `named:true, member:undefined`, the seat's own slug → that seat, a different slug
→ nothing, a fork title → `named:false`; my ORIGINAL T12 auth probe re-run **unmodified** still passes with
the resumed member refused on `end`/append and a genuine fork still ending; the suite is 600 pass / 0 fail
with the identity file at 12 arms and the 13 team-end arms unchanged. The residual bound is stated
honestly. Nothing blocks the wave.

## Judgment on each item the captain named

- **(a) `titleMatchLength` gives the LONGEST match — YES, verified on MY OWN probe.** `01-identity-edge-probe.log`:
  - Plan Reviewer's title on a `Reviewer` + `Plan Reviewer` roster → `member: M2` (the Plan Reviewer seat);
  - the Reviewer's own title → `member: M1` (still unambiguous);
  - a genuine equal-length tie (two seats sharing one role) → `named:true, member:undefined` (fail-closed
    kept, order-independent — the implementation keeps every seat at the strongest match length);
  - an unrelated fork title → `named:false`.
  The implementation does what the report says: `titleMatchLength` returns the matched role's length (or,
  failing a role match, the stored name's length), and `memberIdentityOf` keeps only the seats at
  `Math.max(...strengths)`.
- **(b) the rule is "role first, then the seat's STORED name" — YES.** The same probe measures both ways:
  a title containing the seat's ACTUAL stored slug (`senior-engineer-1`) names that seat; a title
  containing a DIFFERENT slug (`senior-engineer-9`) names nothing. The stale claim is gone from `src/**`
  and the docs (the only remaining "slug" sentence in `team-store.ts` says the rule is the stored name,
  *not* "never the slug"), the package README never carried the claim, and the rewritten unit arm
  (`identity-plane.test.ts`, "… ROLE first, then the seat's OWN stored name") asserts both directions —
  no longer vacuous.
- **(c) the T12 arms and the 13 team-end arms stay green; no weakening.** 12 identity arms (10 unchanged +
  longest-match + the T16 tool edge) and 13 team-end arms: **25 pass / 0 fail / 130 expect**. The package is
  **600 pass / 0 fail / 2887 expect / 41 files**. My ORIGINAL auth probe re-run unmodified
  (`02-reviewer-auth-probe.log`) still shows T1/T5 REFUSED with the record and `leadHistory` unchanged,
  T2/T3 refused, T4 genuine fork ending. The new T16 tool arm is non-vacuous: a resumed Plan Reviewer
  resolves to its seat through `context` AND is still refused on `end` with "is a member, not the Lead",
  leaving the record `active` — naming a seat never grants captaincy.
- **(d) the residual bound is stated honestly.** The repair REPORT and the `titleMatchLength` /
  `memberIdentityOf` docs both say that a session with no id, no member ancestor and no title naming its
  seat is still read as a Lead fork on a record-only plane. That is inherent, not hidden.

## Findings

None blocking. The two Nits from review B4 are closed as asked; I found no new defect in the delta.

## Declined to judge (weighed and set aside)

- **Specificity is LENGTH across matched texts**, so a longer stored-name match can outrank a shorter role
  match from another seat (`titleMatchLength` returns the role length when the role matches, else the name
  length; `memberIdentityOf` keeps the max). Documented as the rule; only reachable with a contrived title
  that contains another seat's full stored name, and the tie direction stays fail-closed. Not judged.
- **The title is harness-set** (`sessionTitleOf` reads the session header, never a tool argument), so
  title spoofing through the surface is not a vector; unchanged from T12. Not judged.
- **README wording (N6)** — the T16 REPORT supplies the corrected EN/zh-CN bullet replacing T12's
  "never the workmate slug" clause; the package README is not edited in this row. Owed by N6.
- The recorder flattens severities to `minor`; this report's ranking is authoritative.

## Verdict

**Approve.** Both Nits are closed by the rule the review asked for (longest match, stored-name stated and
asserted), my own probes reproduce every claim, and the T12 protections and the 13 end arms are intact —
no weakening, no new finding.

## Bounds of this review

- **No dist build** (the captain integrates): `packages/mpd-team-core-plugin/dist/index.js` still carries
  neither `end` nor this narrowing; the released artifact does not have the fix yet, so this verdict is
  source/test-level.
- **No live harness mount**: verification is the real plugin + real store over a stub executor for the
  tool arms, plus a store-level predicate probe for the matcher; I did not observe a live session title.
- I read the repair REPORT, its diff, `titleMatchLength`/`memberIdentityOf`, the corrected docs, the two
  new/rewritten test arms and the gate logs; I did not re-read unrelated packages or the whole
  working-tree diff.
- No credentials, tokens or connection strings were encountered.

## Evidence index (this directory)

| file | what it proves |
|---|---|
| `identity-edge-probe.ts` + `01-identity-edge-probe.log` | the review-B4 edges, durably re-runnable: Plan Reviewer→M2, Reviewer→M1, twin-role tie→named/no-row, own slug→seat, other slug→none, fork→named:false — EDGE PROBE PASS |
| `02-reviewer-auth-probe.log` | my ORIGINAL T12 probe re-run unmodified — PROBE PASS (gated arms): T1/T5 refused, record+leadHistory unchanged, T4 fork ends |
| `03-package-tests.log` | `bun test packages/mpd-team-core-plugin` — 600 pass / 0 fail / 2887 expect / 41 files |
| `04-identity-and-end-tests.log` | identity-plane + team-end — 25 pass / 0 fail / 130 expect (12 + 13) |
| `05-typecheck.log` | `bun run typecheck` — exit 0 |
| `06-comments.log` | `bun run verify:comments` — VERDICT PASS, exit 0 |
