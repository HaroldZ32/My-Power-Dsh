# T26 — the `SKILL.md` row explains the third boot ONCE

**Task:** T26 (follow-up wave 0.17.2; source: the T25 review's non-blocking Nit).
**Loop:** `loop-20261103T081429-a906e2`. **Scope:** `skills/dsh-qa/SKILL.md` (one table row) + this evidence
subtree. No other file. No git, no dist.

## 1. The Nit and the fix

The STATIC half of the `tui-admission` row and the new LIVE item (3) had become near-synonyms: both spelled
the third-boot mechanism (grants staged before the boot, one `/plugin check`, exactly one decision line, a
swallowed step reddening).

| | text |
|---|---|
| BEFORE (static half) | "…with NO grant AND with that row granted **(measured twice: the static `negotiate` on both grant sets, and a live `/plugin check` of the SHIPPED manifest in a boot of its OWN, with the clone's row staged in the grants file BEFORE the boot: the arm requires EXACTLY ONE decision line, so a swallowed step reddens rather than re-reading a neighbour's verdict — a stray grant cannot flip a permission-less manifest)**." |
| AFTER (static half) | "…with NO grant AND with that row granted **(the with-grant half is re-checked on the THIRD LIVE BOOT — see LIVE (3))**." |

The MECHANISM is now explained in exactly one place — LIVE item (3) — which also keeps the reason the static
clause used to carry ("a stray grant cannot flip a permission-less manifest"). Nothing was dropped from the
row's factual content:

| fact | occurrences in the row |
|---|---|
| shipped manifest declares `permissions: []` (the reason the clone is used) | 1 |
| the static three-way control (ungranted `waiting_authorization` / that row granted `compatible` / wrong scope `waiting_authorization`) | present, unchanged |
| **shipped stays `compatible` with NO grant AND with that row granted**, with a pointer to the live re-check | 1 |
| LIVE over THREE boots — (1) shipped no grants, (2) the clone's four readings incl. the revocation, (3) shipped-with-grant | 1 |
| arm3 CONDITIONAL, recorded as the string `inapplicable` | 1 |
| the third-boot mechanism (staged BEFORE the boot / EXACTLY ONE decision line / swallowed step) | **1** (was 2) |

`measured twice` no longer appears; `EXACTLY ONE decision line`, `BEFORE the boot` and `swallowed step` each
appear exactly ONCE. The row is still a valid 5-pipe table row, the T14/T23 wording (THREE boots, the
conditional arm3, the shipped/clone split) is intact, and the file stays English-only agent-facing prose in
`skills/**` (outside the `verify:docs` discovery band).

## 2. Gates (quoted exits; full text in `gates.log`)

| command | observed |
|---|---|
| `bun run test:qa` | `[test:qa] all self-tests passed` — **exit 0** |
| `node scripts/verify-comment-coverage.ts` | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature` — **exit 0** |
| `bun skills/dsh-qa/scripts/surface-pin.ts` | `PASS — every surface …` — **exit 0** (it asserts this very case-table row) |
| `bun skills/dsh-qa/scripts/tui-admission.ts --self-test` | `ok: structural rules, pane classification and spec-root resolution are two-sided` — **exit 0** |
| row shape | `|` separators: **5**, identical to its neighbours |

## 3. Bounds

- Documentation only: no case, arm, predicate or evidence field changed, so the measured artifacts of T20/T23
  stand (`evidence/tui/lanes/2026-11-03T07-33-03.109Z` for the live lane, `…07-33-03.053Z` for the static one).
- The live case was not re-run for a single-row prose edit; the executable surface is re-proved by the gates
  above (including the case-table row assertion inside `surface-pin`).
- `VENDOR_LOCK.json` untouched — `skills/**` changed once more, so the captain's SINGLE re-pin must still
  carry `SKILL.md` + `tui-admission.ts` + `surface-pin.ts`; `verify-vendor` stays red on the corpus `treeSha`
  until it lands (expected).

## 4. Evidence in this directory

```
report.md  gates.log
```
