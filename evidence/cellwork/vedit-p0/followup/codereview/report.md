# T23 — CodeRabbit round-1: the lane really runs THREE live boots, and the docs now say so

**Task:** T23 (follow-up wave 0.17.2), CodeRabbit CR1 on PR #93. **Loop:** `loop-20261103T080819-893695`.
**Scope:** `skills/dsh-qa/scripts/tui-admission.ts` (comments only), `skills/dsh-qa/SKILL.md` (one row), this
evidence subtree. **No code line changed** — verified below. No `src`, no `dist`, no git write.

## 1. The findings and the fix

| # | where | finding | fix |
|---|---|---|---|
| 1 | `tui-admission.ts` header (~21–27) | the C3' block still said "measure BOTH postures over **TWO** boots", while the lane drives THREE (`shipped`, `clone`, `shipped-granted`) | the block now says **THREE boots — one boot per grants-file state**, and every arm names the boot that produces it: (1) BOOT 1 `/plugin check` + `/plugin list` on the shipped manifest, (1b) BOOT 3 the shipped manifest WITH one grant, (2) BOOT 1 the admission-loader line, (3) BOOT 2 the clone's three states, (4) BOOT 1 the chat turn, (5) BOOT 2 the revocation. The 0.15.0 rename note now sits under the boot-1 item it belongs to (it had drifted under the third-boot item, which the same comment edit introduced). |
| 1 | `tui-admission.ts` header (~86–87) | the `Evidence ->` line named only `shipped/,clone/,grant-clone/` | it now names `shipped/,clone/,shipped-granted/,grant-clone/` — the third boot writes `shipped-granted/` |
| 1 | `tui-admission.ts` ~1186 (comment typo) | `the shipped-bond-with-grant lifecycle` | `the shipped-with-grant lifecycle` |
| 2 | `SKILL.md` row `tui-admission` | "LIVE, over **two** boots" | "LIVE, over **THREE** boots — one per grants-file state:", with the third boot described: the shipped posture WITH one grant in a fresh boot, the row staged BEFORE the boot, ONE `/plugin check` answering `compatible` with **exactly one decision line** so a swallowed step reddens instead of re-reading the neighbouring verdict. The T14-corrected shipped / clone / conditional-arm3 wording is untouched. |

The SKILL.md row still parses as a table row (5 `|` separators, identical to its neighbours), and the file
remains English-only prose inside the agent-facing `skills/**` band (no `verify:docs` exposure — `skills/**`
is not in that gate's discovery band).

## 2. No code changed this round

A comment-stripped diff over `tui-admission.ts` prints NOTHING (only `//` and `/** … */` lines moved), so the
lane's behaviour is byte-identical to the run that already passed: live lane `ok=true`, exit 0,
`evidence/tui/lanes/2026-11-03T07-33-03.109Z` (T20). The live case was deliberately NOT re-run for a
comment-only change; the gates below re-prove the executable surface.

## 3. Gates (quoted exits; full text in `gates.log` / `test-qa.log`)

| command | observed |
|---|---|
| `bun skills/dsh-qa/scripts/tui-admission.ts --self-test` | `ok: structural rules, pane classification and spec-root resolution are two-sided` — **exit 0** |
| `bun skills/dsh-qa/scripts/tui-admission.ts --static-only` | `static result ok=true`, `ok=true -> evidence/tui/lanes/2026-11-03T08-09-14.603Z` — **exit 0** |
| `bun run test:qa` | `[test:qa] all self-tests passed` — **exit 0** |
| `bun run typecheck` (`tsgo --noEmit`) | no output — **exit 0** |
| `node scripts/verify-comment-coverage.ts` | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature` — **exit 0** |

## 4. Bounds

- Comment/documentation only: no arm, predicate or evidence field changed, so the non-vacuity proof, the
  three-way clone control and the `inapplicable` arm3 record stand exactly as T20/T18 measured them.
- The live case was not re-run (comment-only change; see §2). Its last measured artifact is cited above.
- `VENDOR_LOCK.json` untouched — `skills/**` changed again (this is the fourth skills edit of the wave), so the
  captain's SINGLE re-pin must carry `SKILL.md` + `tui-admission.ts` + `surface-pin.ts`; until it lands,
  `verify-vendor` stays red on the corpus `treeSha` (expected, recorded by the earlier reviewers).

## 5. Evidence in this directory

```
report.md  gates.log  test-qa.log
```
