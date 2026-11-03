# T28 — CR1 documentation Nit: the fork-bound phrase is corrected

- Wave: 0.17.2 team · row **T28** (documentation repair; source row T24) · loop `loop-20261103T080819-5165ba`
- Review basis: `evidence/cellwork/vedit-p0/followup/review-cr-code/REPORT.md` — Nit N1 (CR round 1)
- Owner: `se-consume` (Senior Engineer) · Date: 2026-11-03
- Evidence: this directory (`evidence/cellwork/vedit-p0/followup/codereview/fork-bound/`)
- **NO code change, no test change** — the target is the T22 REPORT's wording only.

## The Nit (T24 N1)

The T22 REPORT's Bounds said a seat-naming fork "is read as that seat **until the heal records it**" — but
the same paragraph (and `healLeadBinding`) says the heal is SKIPPED for any session the identity plane
names as a member. Such a fork is therefore **never healed** on that record; the closing phrase implied a
future heal that the code will never perform. The substance was already fail-closed (no authority leak);
only the sentence was loose.

## (a) The corrected sentence — T22 REPORT, Bounds

Replaced, with the correction marked in place (the report is evidence, so the fix is visible rather than a
silent rewrite):

> - **The fork bound stands (CORRECTED 2026-11-03, T28):** a FORKED Lead's new session id is recorded only
>   when `healLeadBinding` runs, and the heal is SKIPPED for any session the identity plane names as a
>   member — so a fork whose title names a seat is **NEVER healed on that record** and stays identified as
>   that seat (seat-blocked, fail-closed: it can borrow no Lead ancestry) for as long as the title keeps
>   naming one. The earlier closing phrase implied the heal would eventually run and contradicted the very
>   rule it stated; it is replaced here. The code comment carries the same deferred-heal imprecision and is
>   FLAGGED, not edited, in `../fork-bound/REPORT.md` (T28's scope is documentation of this report only).
>   That is the T12 residual, unchanged and documented at the arm.

## (b) The N6 README wording — restated consistently

The same REPORT's "README wording for N6" block carried the same implication ("not recorded until its heal
writes `leadHistory` … still read as that seat"). Restated so the release docs can be copied verbatim:

**EN**

```markdown
A RECORDED Lead is never read as a member by its title: the captain identity is checked before the title
arm, so a Lead persona that happens to contain a roster role can never be addressed by a member id. (A
FORKED Lead's new session id is recorded only when the churn heal runs — and the heal SKIPS any session
the identity plane names as a member, so a fork whose title names a seat is NEVER healed on that record
and stays identified as that seat, fail-closed, while its title keeps naming one. That is the stated
bound.)
```

**zh-CN**

```markdown
被记录的 Lead 绝不会因为标题而被当作成员解析：队长身份在标题分支之前判定，所以队长人设里即使出现 roster role，
也绝不可能被用成员 id 寻址。（被 fork 的 Lead 的新 session id 只有在 churn heal 运行时才会被记录——而 heal 会跳过
身份面认定为成员的会话，所以标题点名席位的 fork 在该记录上**永远不会**被 heal，会一直按该席位处理（fail-closed），
只要标题还点名该席位。这是已声明的边界。）
```

## Verification (greps in this directory)

| file | what it shows |
|---|---|
| `01-before-grep.log` | the old phrase in the T22 REPORT (lines 110/133) and the flagged src comment |
| `02-after-grep-t22-report.log` | `grep -n "until the heal\|until its heal\|until then\|still read as that seat"` on the T22 REPORT → **no matches, exit 1** |
| `03-corrected-excerpts.log` | the three corrected passages, verbatim |
| `04-scoped-grep.log` | scoped repo grep: the literal old phrase survives ONLY in the historical T24 review (which quotes it to report the Nit) and in the src comment flagged below; `packages/ scripts/ docs/` are clean |
| `05-tree-state.log` | the sha256 of the touched sources/tests and the working-tree diffstat (identical to the T22 delta — T28 wrote no code) |

## FLAG (out of T28's scope, for the next src touch)

`packages/mpd-team-core-plugin/src/team-store.ts` (~line 1297) still reads:

> THE BOUND: a FORKED Lead's NEW id is not recorded until its heal writes `leadHistory`, so a fork whose
> title names a seat is still read as that seat **until then** (the T12 residual) …

That "until then" is the SAME deferred-heal imprecision the Nit corrected. T24's report judged the code
comment correct on the substance, and it is (the direction is fail-closed), but the clause should say the
heal is skipped so the seat identification persists. **T28 forbids src edits, so it is flagged here rather
than changed.** Recommended one-line doc fix in the next src touch:

> THE BOUND: a FORKED Lead's NEW id is recorded only when the heal runs, and the heal SKIPS any session
> the identity plane names as a member — so a fork whose title names a seat is NEVER healed on that record
> and stays identified as that seat (fail-closed) while its title names one (the T12 residual).

The T24 review report itself keeps the old quotation — it is that Nit's historical evidence and must not be
rewritten.

## No code change — stated and checkable

- This turn wrote only `evidence/cellwork/vedit-p0/followup/codereview/fork-bound/**` and edited the T22
  REPORT's prose (same directory tree, documentation).
- `05-tree-state.log` records the sha256 of `team-actions.ts`, `team-store.ts`, `identity-plane.test.ts`
  and `codereview-cr1.test.ts`, plus the package diffstat — the source/test state is exactly the T22
  delta, whose snapshot is `../t22-identity-and-journal/diff.patch`.
- No gate re-run was needed (documentation-only); T22's green gates remain valid for this tree.
