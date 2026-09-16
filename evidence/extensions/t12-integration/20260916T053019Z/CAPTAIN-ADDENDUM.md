# Captain addendum to the t12 delivery ledger

Written by the captain after t12 (integration) and t22 (the round-2 review of t21) both went terminal.
This file is ADDITIVE: it does not modify `delivery-ledger.md`, whose sections 0 and 4-A describe the
state as it stood while t12 ran. Nothing here overrides a measured value; it closes two items that no
member task could carry once the DAG went terminal.

## 1. Item A (DELIVERY CONDITION) is CLOSED — the settled revision is reviewed

t22 (review of t21) COMPLETED with **verdict PASS**, anchored to the revision this ledger pins:

| Twin | sha256 | mtime |
|---|---|---|
| `docs/extension-adaptation-report.md` | `0ebfadb5e3b4f3adcb289a2d8dcf3bff85c280582aa9697c28428824beb64b37` | 13:30:18 |
| `docs/extension-adaptation-report.zh-CN.md` | `b5adfbda661adef78e5d6d0068abb4adddaa75e0010b2329570c259a7b133751` | 13:30:18 |

The reviewer pinned, re-pinned after a 55 s settle window and confirmed the pair unchanged through its
gate run. What it verified in BOTH twins: t21's three additions (F8's spent-re-pin clause naming the
mcp-bridge schema-arm correction and its `evidence/extensions/t13-repair/20260916T045324Z/` path; the
R11 P2 cost clause — a test-suite home means editing `skills/dsh-qa/**`, which forces a
`VENDOR_LOCK.json` re-pin in the same change; and the two measured line corrections, F9 →
`extension-lifecycle.mjs:377` and the D11 range → `docs/extensions.md:531-534`); that the waiver states
the one-re-pin rule correctly (a SECOND `skills/**` edit is what is forbidden — never skills edits as
such); that the child-stderr-tail residual is true as written and framed as lane coverage rather than
as a defect; that R11's plan-doc home and the packer's closure check resolve as cited; that the
bilingual pair is in step (switch links under both titles, 12/12 heading shapes, F=11 / P=7 in both,
`node scripts/verify-docs-parity.mjs` exit 0 — `pairs=35 failed=0 violations=0 exempt=16`); and that
nothing t10/t24 passed was weakened, with no residue of the retired "only direct entry" clause, no
stale t15/t16 status and no duplicated register item (one waiver marker per twin).

Review chain, final: t14 pass · t11 pass · t16 pass · t20 pass · t18 pass · t24 pass · **t22 pass**,
with t10's `needs_revision` superseded by t23 and cleared in t24. One informational observation
remains open by choice (t22-O1): F8 attributes the spent re-pin to "the mcp-bridge schema-arm
correction" while t13's single change also carried its `SKILL.md` row and the packer line — §8's t13
bullet keeps that record honest, so this is framing for a future pass, not a defect.

## 2. Evidence-field correction (assigned to t12, not carried by it)

The t12 ledger was not written with this note, so it is recorded here — additively, for the same reason
the artifact below is left byte-identical.

- **Artifact:** `evidence/extensions/t7-verify/20260916T045829Z/result.json`, field `mountEvidence`.
- **Values as recorded there:** the mpd-ext mount line at lifecycle `output.log:37` and bridge
  `output.log:35`. This is inherited from the lane output; the report writer took the field as given,
  which is how the wrong numbers propagated into the report once (corrected under t23).
- **Measured truth:** lifecycle `output.log:40` and bridge `output.log:38`.
  The lifecycle mount line also appears at `:50`, `:70`, `:80` and `:90` — the lane boots several
  sessions, so any of those lines carries the same text; the canonical first occurrence is `:40`.
- **What `:37` and `:35` actually contain:** `:37` is
  `[mpd-dsh-adapter] mpdDsh provided (harness seams resolved lazily, inject-free)`; `:35` is
  `[mpd-config] settings bridge: registered the "mpd" namespace…`.
- **Why the artifact is NOT edited:** an evidence artifact records what a run measured at the time, and
  rewriting a field after the fact would destroy exactly the property that makes it worth keeping. The
  wrong values are part of the record; the correction belongs beside it, which is this section.
- **Measured independently by:** the t10 reviewer (who raised it), the Deep Worker during the t21
  attempt (which also re-read `extension-lifecycle.mjs:377` for the same wrong-line class), and the
  captain.
- **Propagation status:** stopped in the deliverable — the report pair cites `output.log:40` /
  `output.log:38` in both twins (EN:155 / ZH:77) and `grep 'output.log:37\|output.log:35'` over both
  twins returns nothing.
