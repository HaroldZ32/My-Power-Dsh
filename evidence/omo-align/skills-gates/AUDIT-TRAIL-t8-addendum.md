# t23 — Audit-trail record: the t8 skill-gate addendum (attribution + evidence)

Created by **Architect** under task **t23** (`记录（技能门禁补记审计轨迹）`, attempt 1, attempt_id `7e9df0e2-0368-40cd-a427-86451d7ecb5a`), 2026-09-13.
Purpose: give the t8 skill-gate finalisation a **task-board record**. Task **t8 is terminal** (completed, immutable), so the addendum that produced the finalised gate artefacts could not carry an attempt_id of its own; **this record task carries the audit trail instead**.

Scope discipline: this task **added one record file** and **modified no existing artefact**.

---

## 1. The three finalised artefacts (current disk state, measured here)

| artefact | bytes | sha256 | mtime |
|---|---|---|---|
| `evidence/omo-align/skills-gates/verdict-table.md` | 40,486 | `0eb68e4f7707fd727c7d9605a8af90d1f6d915dc3b4d8f96e9833f5228c5e0bc` | 22:48 |
| `evidence/omo-align/skills-gates/gate-rubric.json` | 29,699 | `45b9e4fc6595cc27a41ce46ec67a24598460c78507dbca73122d4c8ca85b2d9b` | 22:50 |
| `evidence/omo-align/skills-gates/decisions.json` | 27,415 | `95aeb32587e3f8767bb0cc9f8b51f9cbed274993f9d7c1fd757597090b63cff1` | 22:50 |

### ⚠ Reported discrepancy (do NOT fix in place — the t23 contract requires a report)

The t23 contract's acceptance expects the prefixes **`65a77f6c…` (verdict-table) · `d5cde3ef…` (gate-rubric) · `38b5bad5…` (decisions)**. **None of those prefixes matches any current file.** They are *intermediate states of the same three artefacts*, produced by the two later scoped instructions in the same wave and superseded before this record was written:

| expected in contract | what it was | superseded by |
|---|---|---|
| `65a77f6c…` verdict-table | after the "stale `t5 pending` notes + anchor `:107→:122`" cleanup | the `git-master` B-basis rewrite + §3.1 row removal ⇒ `0eb68e4f…` |
| `d5cde3ef…` gate-rubric | after the `flagDerivationRule` **alias** was added | the contract-pin refresh (`classMapping.contractSha256/contractBytes/contractPinNote`) ⇒ `45b9e4fc…` |
| `38b5bad5…` decisions | after the `flagDerivationRule` alias sync | the same pin refresh + rubric re-pin ⇒ `95aeb325…` |

⇒ The record follows the contract's own rule: **report the mismatch, do not rewrite the artefacts.** All three artefacts above are the states the captain **accepted** ("技能门禁收工确认"); the expected prefixes were authored against the pre-finalisation states.

---

## 2. What changed relative to the t8 initial version

| item | t8 initial (fv1 inputs, rubric 1.0.1) | finalised (fv4 inputs, rubric 1.1.0) |
|---|---|---|
| action set | **adapt 4 / skip 6** | **adapt 3 / skip 7** |
| `skills/remove-deadcode` | 18 ⇒ `adapt-then-install` | **14 ⇒ skip** — the only action change; listed in `userApprovedOverrides` (user-approved, now below X=15; t19 independently measured `no-seam-required`) |
| `skills-loader-core/git-master` | 13 ⇒ skip | **14 ⇒ skip** — `binaryDependency=FALSE` (its `make`/`git` blocks are **subject-matter examples**, not its own workflow entry point) ⇒ counted=0 ⇒ D3=1; **not borderline, not in `userApprovedOverrides`** |
| `skills/security-research` / `skills/tech-debt-audit` / `skills-loader-core/security-research` | 17 / 16 / 17 ⇒ adapt | 19 / 18 / 19 ⇒ adapt (recomputed) |
| rubric | 1.0.1 | **1.1.0**: added `classMapping` / `evidenceQuality` / `D3Rule` (+ `flagDerivationRule` alias) / `d4Mapping` / `threshold`; **all 1.0.x rule sections and `rulesSha256 = 95cfbc5a8be265cb0a2e7e7eaf0f947a18c0f8065408dc2776447049165e79fa` untouched**; extended digest `rulesSha256_v1_1_0 = 23ed8c7e65779f95e478d248436f58c3961ed8c86ee11088efba7e96e8c242e2` |
| header | — | `input revision fv4 = cade32a6ae0346bf…` (82,509 B) + snapshot `revisions/fv4-2026-09-13T14-00-29-361Z/manifest.json` |

---

## 3. Honest declarations (required by the t23 contract)

1. **No `attempt_id` for the addendum.** t8 is terminal and immutable, and no addendum task existed while the work was done; the delivery was executed under the captain's GO and recorded in the artefacts plus the mailbox. **This t23 record is the task-board record for that work**; the audit trail is: three artefacts (§1) + this record + the captain's acceptance. (The captain stated he would note in the ledger: "t8 终版补记：无任务记录，依据 captain GO".)
2. **Two advisory score differences remain registered, action-neutral**, at `verdict-table.md` §3.2 and `decisions.json::inputs.gapR2`:
   - `omo-senpi/dag-library`: gate recomputation **26** vs the captain-advisory **23**;
   - `omo-senpi/mass-ulw`: gate recomputation **25** vs the captain-advisory **22**.
   Both rows are **vetoed by V4 (`dagRunId`)** ⇒ `skip` either way; the difference comes from the contract's `binaryDependencyRule` worked values (B=TRUE for both) versus `gap-r2.json`'s derivation table (B=false), and from D4 banding, which `classScoring` **delegates to this gate's published rubric**.
3. **Three contract readings are recorded** (the authority file was edited repeatedly during the wave); the location is `decisions.json::inputs.readings`:
   - implementation-time read: `28,243 B / a9dfb311…` (clauses used: `(a)(b)(g)` + `rowSet`, read verbatim);
   - final re-read: **`31,705 B / a0d28ebeaf3f204e4a33480670f44f204415b16758999ce22309a99e3c9c2d65`** (mtime 22:38:13, PARSE OK) — the captain confirmed this is the final version and that earlier values (`28,403 B/380ffc41…`, `26,556 B/19dc4ddd…`, `25,097 B/0ec6bbb1…`, `26,013 B/4c3c2ded…`) are superseded middle versions and must not be cited in the ledger;
   - the `(a)(b)(g)` / `rowSet` / `binaryDependencyRule` clauses are textually identical between the implementation-time and final readings, so no score depends on which of the two is cited.

---

## 4. Verification commands run for this record

```
cd /root/dshProj/my-power-dsh && ls -la evidence/omo-align/skills-gates/{verdict-table.md,gate-rubric.json,decisions.json}
cd /root/dshProj/my-power-dsh && sha256sum evidence/omo-align/skills-gates/verdict-table.md | cut -c1-16   # -> 0eb68e4f7707fd72
cd /root/dshProj/my-power-dsh && sha256sum evidence/omo-align/skills-gates/{verdict-table.md,gate-rubric.json,decisions.json}   # full shas as in §1
cd /root/dshProj/my-power-dsh && grep -E '^(65a77f6c|d5cde3ef|38b5bad5)' <(sha256sum evidence/omo-align/skills-gates/*.json evidence/omo-align/skills-gates/*.md)   # -> no match (intermediate states)
```

**Statement of non-modification:** this task added `AUDIT-TRAIL-t8-addendum.md` (this file) and changed no other artefact in `evidence/omo-align/skills-gates/**`; `packages/**`, `presets/**`, `scripts/**`, `skills/**`, `docs/**`, `VENDOR_LOCK.json` were not touched.
