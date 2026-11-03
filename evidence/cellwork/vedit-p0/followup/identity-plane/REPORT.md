> **SUPERSEDED IN TWO PLACES by T16 (`repair/REPORT.md`)**: the title arm is "role first, then the seat's
> STORED name" (a title containing the seat's own slug DOES name it — the "never the workmate slug"
> wording below is wrong), and the LONGEST title match wins so `Plan Reviewer` no longer collides with
> `Reviewer`.

# T12 — identity plane: a RESUMED member is a member (A1/HIGH from review B3)

- Wave: 0.17.2 team · row **T12** (repair; source row T10) · loop `loop-20261103T065530-23984a`
- Contract: `.mpd/plans/vedit-p0-followup.md` + the captain's T12 brief
- Review basis: `../review-b3/REPORT.md` (A1/HIGH + Nit) and its probe `../review-b3/auth-probe.ts`
- Owner: `se-consume` (Senior Engineer) · Date: 2026-11-03
- Evidence: this directory (`evidence/cellwork/vedit-p0/followup/identity-plane/`)
- `diff.patch` is the full working-tree diff for the touched `packages/mpd-team-core-plugin` sources/tests
  (it therefore also carries the still-uncommitted T8 delta, whose own snapshot is
  `../team-end/repair/diff.patch`; this row's delta is the shared narrowing + the new test file, appended
  to the patch as an untracked-file diff).

## The defect (pre-existing, HIGH)

A session the record cannot name by id was read as a **forked Lead**:

- **T1** — a RESUMED member (`member-resumed-77`, id ≠ the record's `executorRef`) with
  `{parentSession: lead, title: persona}`, no `origin`/`delegationDepth`, could
  `agent_teams_control {action:"end"}` the team: `changed:true`, record stamped `phase:"ended"` — an
  irreversible close.
- **T5** — the same session could append to the LIVE roster (`add_member` → `Sneak`), and the churn heal
  (`healLeadBinding`) promoted it into `leadHistory`, making the ambiguity a durable Lead identity.

Root cause, two halves that had to be fixed together:

1. `index.ts#callerIdentity`'s title fallback compared the persona title against `member.name` — which for
   a W3-C-bound seat is the WORKMATE SLUG (`senior-engineer-1`), never text a persona title contains — so
   the resumed member was never identified; its ancestry (`parentSession` = the Lead) then granted the
   Lead spelling.
2. `team-actions.ts#leadAuthorityOf` (T8) and `healLeadBinding` each had their own id-only member guard,
   and the two identity implementations already disagreed (the review's Nit).

## The fix — `team-store.ts#memberIdentityOf` (the ONE narrowing)

New shared predicate beside `memberNamedBy` (three arms, in precedence order, all durable facts):

| arm | fact | effect |
|---|---|---|
| 1 | the session's OWN id matches a member's `name`/`executorRef` | that member |
| 2 | a RECORDED ANCESTOR matches a member's handle (a resumed member's own header: parent = its old session) | that member |
| 3 | the session TITLE contains the seat's **ROLE** or display name (case-insensitive; **never the workmate slug**) | that member |

It answers `MemberIdentity = { member?, named }`:

- **`named`** — the roster names this session at all (id, ancestor, or ANY row a title matches). A
  `named` session borrows **NO** Lead ancestry, even when `member` is absent.
- **`member`** — the row only when the identification is UNAMBIGUOUS; a title matching two same-role seats
  answers `named: true, member: undefined`, so the plane refuses captaincy but never acts as one seat.

**Callers rewired to it (the T10 Nit's disagreement is gone):**

- `index.ts#callerIdentity` — `named` ⇒ `ancestry: []` (its own member row when unambiguous). This is the
  path every Lead-gated write uses: live-roster append, live-board append, `release`, `depend`,
  `complete`/`fail`, mail.
- `team-actions.ts#leadAuthorityOf` — `named` ⇒ `[caller.sessionId]` only. `endTeam`'s refusal sentence
  now distinguishes three facts: "X is a member, not the Lead" / "this session is on the team's roster,
  not its Lead" (ambiguous) / "this session is not on the team's roster".
- `index.ts#healLeadBinding` — a `named` session is NEVER promoted into `leadHistory` (the write is the
  thing that made A1 durable). It now receives the session title; `resolveForWrite` passes it, and so do
  its nine call sites (`sessionTitleOf(exec)`).
- `team-actions.ts#writeMemberHandoff` and `index.ts`'s `context` seat read — a resumed member now resolves
  to its own member row (handoff writes, seat state) instead of being seat-less.
- `TeamActionCaller` gains the optional `title`, set by the control tool, the task tool's handoff branch
  and the `mpdTeamActions` service's `callerForSession` (which reads it from the resolved live agent).
  Omitting it degrades to the id/ancestor arms — never to a guess.
- `endTeam`'s doc sentence softened to the scope actually enforced: a session the RECORD NAMES (own id,
  recorded ancestor, or persona title over the seat's role/display text) cannot borrow captaincy; a
  session the record cannot name at all is still read as a Lead fork — the plane's stated bound.

**The genuine fork is untouched**: a forked Lead is not on the roster, its ancestry is the Lead, and its
title names no seat ⇒ `named: false` ⇒ it keeps the C7-4 lineage and can still end/append.

## Reviewer's probe, re-run on the fixed tree (their own file, unmodified)

`bun evidence/cellwork/vedit-p0/followup/review-b3/auth-probe.ts` → **exit 0, `PROBE PASS (gated arms)`**
(`01-reviewer-probe-after.log`; the BEFORE log is copied beside it as `00-before-reviewer-probe.log`):

| arm | BEFORE (`review-b3/01-auth-probe.log`) | AFTER |
|---|---|---|
| T1 resumed member ends | `changed:true`, record `phase:"ended"` | **REFUSED**: "… (senior-engineer-1 is a member, not the Lead)"; record stays `active`; `leadHistory: []` |
| T2 same session, `origin:"subagent"` | refused | refused ("no team record" — it cannot resolve at all) |
| T3 reviewed shape (id == `executorRef`) | refused | refused, same sentence |
| T4 genuine fork | ends (`changed:true`) | **still ends** (`changed:true`, `phase:"ended"`) |
| T5 resumed member's live-roster append | **ALLOWED** (`Sneak` appended; `leadHistory` gained `member-resumed-77`) | **REFUSED** ("only the Lead … may append to its live roster or board"); roster still `["senior-engineer-1"]`; `leadHistory: []` |

## Tests

New `test/identity-plane.test.ts` — **10 arms**, all passing:

- `memberIdentityOf` unit arms: own id / `executorRef`; recorded ancestor; persona title by ROLE; the
  workmate slug alone never matches; an ambiguous title names a member but picks no row; a foreign title
  names none.
- Tool arms: T1 resumed member cannot end (record active, no heal); T1 ambiguous-title twin can neither
  end nor act as a seat; T5 live-roster append refused with the roster and `leadHistory` unchanged; the
  resumed session still resolves to its member row (`context` returns the seat name); the resumed member
  writes its OWN handoff (ancestor arm); a genuine fork still ends and the team leaves live resolution.
- The existing 13 `team-end.test.ts` arms are unchanged and green.

## Gates (final tree; logs here)

| Gate | Command | Observed |
|---|---|---|
| Package tests | `bun test packages/mpd-team-core-plugin` | **598 pass / 0 fail**, 2879 expect(), 41 files — `02-package-tests.log`, exit 0 |
| Identity arms | `bun test …/test/identity-plane.test.ts` | **10 pass / 0 fail**, 30 expect() — `03-identity-tests.log`, exit 0 |
| Typecheck | `bun run typecheck` | `tsgo --noEmit`, no output, **exit 0** — `04-typecheck.log` |
| Comments | `node scripts/verify-comment-coverage.ts` | `… VERDICT: PASS …`, **exit 0** — `05-comments.log` |
| Reviewer probe | `bun …/review-b3/auth-probe.ts` | `PROBE PASS (gated arms)`, **exit 0** — `01-reviewer-probe-after.log` |

No git write; no dist build.

## README wording for N6 (docs lane)

The README's `mpdTeamActions` section documents the caller shape and the lineage rule (EN line ~207–214,
zh twin). Two edits, both languages:

**(1) the caller shape sentence** — `{ workspace, sessionId, lineage, agent?, signal? }` becomes
`{ workspace, sessionId, lineage, title?, agent?, signal? }` and "The workspace, session id and `lineage`
are derived exactly as `where(exec)` derives them" becomes "The workspace, session id, `lineage` and the
session TITLE are derived exactly as `where(exec)` derives them". zh twin (README.zh-CN.md line ~165/172):
`caller 就是工具路径的 caller。` 一句里的"工作区、会话 id 与 `lineage`"改为"工作区、会话 id、`lineage` 与会话
TITLE"，并把调用者形状改为 `{ workspace, sessionId, lineage, title?, agent?, signal? }`。

**(2) one new bullet after the caller bullet (EN):**

```markdown
- **A roster seat is identified by the RECORD, never by a guess.** `team-store.ts#memberIdentityOf` is the
  ONE narrowing every Lead check uses: the session's own id (a member's `name`/`executorRef`), then a
  recorded ANCESTOR (a resumed session whose parent is the member's old session), then the persona TITLE
  matched against the seat's ROLE or display name — never the workmate slug. A session the roster names,
  even only ambiguously, borrows NO Lead ancestry; only a session the record cannot name at all is read as
  a forked Lead, which keeps the C7-4 lineage.
```

zh-CN twin:

```markdown
- **名册席位由 RECORD 识别，绝不靠猜。** `team-store.ts#memberIdentityOf` 是所有 Lead 校验共用的**唯一**收窄：
  先看会话自己的 id（成员的 `name`/`executorRef`），再看**记录中的祖先**（恢复的会话以成员旧会话为父），最后看
  persona TITLE 是否命中席位的 **role** 或显示名——**绝不**用 workmate slug。名册能命中的会话（哪怕只能判为"有歧义"）
  一律**不借** Lead 祖先；只有记录完全无法命名的会话才按 fork 的 Lead 处理，保留 C7-4 的祖先链。
```

## Bounds (stated, not hidden)

- **The residual shape**: a RESUMED member whose header carries neither its own id, nor a member ancestor,
  nor a persona title containing its seat's role/display name is still indistinguishable from a Lead fork
  and keeps the lineage. The reviewer's measured shape carries the persona title; the harness stamps it
  on every spawned session, so this is the plane's practical bound, not an unmeasured claim.
- **The title arm is TEXT matching** (case-insensitive substring over role, then display name). It can only
  REMOVE Lead authority — a session that presents a seat's persona title is treated as that seat, which is
  the direction the plane wants; an ambiguous title removes authority without picking a row.
- **No persistence of the resumed session id**: this fix RECOGNISES the resume (id, ancestor, title) but
  does not rewrite `executorRef`/binding. Rewriting the member's dispatch handle on resume is a larger
  change with harness semantics this row cannot prove; stated rather than guessed.
- **A genuine fork whose title happens to contain a roster role/display text** is conservatively treated
  as that seat (it loses Lead authority until the title changes). No such title exists in the roster
  personas; the direction is fail-closed.
- **No identity change to the official-plane membership** (`dsh.teamMembership`) — it is read where it
  already was; this row narrows the mpd RECORD's own identity plane.
- **README untouched** (N6), **no dist build** (the captain integrates — `dist` still lacks `end` and this
  narrowing), and the per-package verification basis is the real plugin + real store over a stub
  executor (no live harness mount).
