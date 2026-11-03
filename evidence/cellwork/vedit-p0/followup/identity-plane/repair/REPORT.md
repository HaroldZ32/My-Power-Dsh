# T16 — identity Nits: longest-role match (N1) + the stored-name rule (N2)

- Wave: 0.17.2 team · row **T16** (repair; source row T13) · loop `loop-20261103T071147-3a898e`
- Contract: `.mpd/plans/vedit-p0-followup.md` + the captain's T16 brief
- Review basis: `../review-b4/REPORT.md` (N1/N2) and its probe `../review-b4/07-identity-edge-probe.log`
- Owner: `se-consume` (Senior Engineer) · Date: 2026-11-03
- Evidence: this directory (`evidence/cellwork/vedit-p0/followup/identity-plane/repair/`)
- `diff.patch` is the full working-tree diff for the touched package (it also carries the still-uncommitted
  T8 + T12 deltas; this row's delta is the `titleMatchLength`/`memberIdentityOf` rewrite, the corrected
  docs and the two new test arms).

## N1 — longest match before ambiguity (CLOSED)

`titleNamesMember` (boolean, "any text matches") became **`titleMatchLength`** (a LENGTH), and
`memberIdentityOf` chooses the most specific match:

- per seat, **ROLE first, then the seat's stored name** → the matched text's length (0 = no match);
- across the roster, the **LONGEST** match wins — `plan reviewer` (13) is strictly more specific than
  `reviewer` (8), so a Plan Reviewer title names the Plan Reviewer seat;
- only a genuine tie at the **same specificity** stays fail-closed (`named: true`, `member: undefined`) —
  the T12 twin-role shape, unchanged. The tie result is order-independent (no roster-order guess).

Measured before/after (`00-before-reviewer-edge-probe.log` vs `01-identity-edge-probe-after.log`):

| case | BEFORE | AFTER |
|---|---|---|
| Plan Reviewer title on a `Reviewer` + `Plan Reviewer` roster | `named: true`, **no member** (seat lockout) | `member: M2` (Plan Reviewer) |
| Reviewer's own title | `member: Reviewer` | `member: Reviewer` (unchanged) |
| two seats sharing `Reviewer` | `named: true`, no member | `named: true`, no member (fail-closed kept) |
| genuine fork's title | named false | named false |

## N2 — the stored-name rule is now stated AND asserted (CLOSED)

The T12 report claimed "never the workmate slug"; the code compares `member.name`, which for a W3-C-bound
seat IS the workmate slug — and a title containing that exact slug DOES name the seat. That behaviour is
kept and documented as the rule:

> **role first, then the seat's STORED name** — for a W3-C-bound seat the stored name is the workmate
> slug, so a title that literally contains it names that seat; a different seat's slug names nothing.

- `titleMatchLength`'s doc states the rule and why the title is a signal at all (a resumed session's new
  id vs the durable `executorRef`).
- `MemberIdentity`, `memberIdentityOf`, `TeamActionCaller.title`, `leadAuthorityOf`, `callerIdentity` and
  `endTeam`'s docs all say "ROLE, then its stored name" — no "never the slug" claim remains (grep over
  `src/` is clean).
- The unit arm is no longer vacuous: it now asserts the seat's **ACTUAL** stored name
  (`senior-engineer-1`) DOES name it, and a DIFFERENT slug (`senior-engineer-9`) names nothing — both
  directions.

## Tests

`test/identity-plane.test.ts` grows **10 → 12 arms** (the T12 arms unchanged):

- rewritten unit arm: role first, then the seat's OWN stored name (same-slug accepted, different-slug
  refused);
- new unit arm: longest match on the `Reviewer` / `Plan Reviewer` roster (both titles name their own
  seat);
- new tool arm "T16 edge": a resumed Plan Reviewer (`{parentSession: lead, title: persona}`) resolves to
  its seat through `context`, AND is still refused on `end` with "is a member, not the Lead" (naming the
  seat never grants captaincy).
- The 13 `team-end.test.ts` arms and the reviewer's T12 auth probe are unchanged and green.

## Gates (final tree; logs here)

| Gate | Command | Observed |
|---|---|---|
| Edge probe | `bun …/repair/identity-edge-probe.ts` | `EDGE PROBE PASS`, **exit 0** — `01-identity-edge-probe-after.log` |
| T12 auth probe | `bun …/review-b3/auth-probe.ts` | `PROBE PASS (gated arms)`, **exit 0** — `02-reviewer-auth-probe.log` |
| Package tests | `bun test packages/mpd-team-core-plugin` | **600 pass / 0 fail**, 2887 expect(), 41 files — `03-package-tests.log`, exit 0 |
| Identity + end arms | the two files together | **25 pass / 0 fail** (12 + 13), 130 expect() — `04-identity-and-end-tests.log`, exit 0 |
| Typecheck | `bun run typecheck` | `tsgo --noEmit`, no output, **exit 0** — `05-typecheck.log` |
| Comments | `node scripts/verify-comment-coverage.ts` | `… VERDICT: PASS …`, **exit 0** — `06-comments.log` |

No git write; no dist build.

## README wording for N6 (docs lane) — correction of the T12 bullet

The T12 hand-off bullet said "…matched against the seat's ROLE or display name — **never the workmate
slug**". Replace that clause (and its zh twin) with the corrected rule:

EN:

```markdown
- **A roster seat is identified by the RECORD, never by a guess.** `team-store.ts#memberIdentityOf` is the
  ONE narrowing every Lead check uses: the session's own id (a member's `name`/`executorRef`), then a
  recorded ANCESTOR (a resumed session whose parent is the member's old session), then the persona TITLE
  matched against the seat's ROLE first and then the seat's STORED name (for a W3-C-bound seat that stored
  name is the workmate slug, so a title that literally contains it names that seat). The LONGEST match
  wins — a `Plan Reviewer` title names the Plan Reviewer rather than colliding with `Reviewer` — and a
  genuine equal-length tie names a member but picks no seat, so it can borrow no Lead ancestry and cannot
  act as one seat.
```

zh-CN twin:

```markdown
- **名册席位由 RECORD 识别，绝不靠猜。** `team-store.ts#memberIdentityOf` 是所有 Lead 校验共用的**唯一**收窄：
  先看会话自己的 id（成员的 `name`/`executorRef`），再看**记录中的祖先**（恢复的会话以成员旧会话为父），最后看
  persona TITLE 是否命中席位的 **role**，其次才是席位的**存储名**（W3-C 绑定的席位里，这个存储名就是 workmate slug，
  所以标题若原样包含它，就认作该席位）。**最长匹配优先**——`Plan Reviewer` 的标题会认作 Plan Reviewer，而不会与
  `Reviewer` 撞车；长度相同的真正歧义仍会判为"是成员、但认不出具体席位"，因此既不借 Lead 祖先、也不能冒充某个席位。
```

## Bounds (stated)

- The rule is **case-insensitive substring** matching over role, then stored name, with **length as
  specificity**. A shorter role is superseded by any longer matching text — that is what fixes the
  `Reviewer`/`Plan Reviewer` lockout, and it means a deliberate substring collision between two seats of
  EQUAL text length stays fail-closed (by design).
- A title containing a seat's stored slug (a W3-C workmate name) names that seat — accepted and documented,
  not enforced away: for a non-W3-C seat the stored name IS the display name, and the runtime cannot tell
  the two apart.
- The T12 residual is unchanged: a resumed member whose header carries neither its own id, nor a member
  ancestor, nor a title naming its seat stays indistinguishable from a Lead fork.
- No README edit (N6), no dist build (the captain integrates), verification is the real plugin + store over
  a stub executor plus the store-level edge probe.
