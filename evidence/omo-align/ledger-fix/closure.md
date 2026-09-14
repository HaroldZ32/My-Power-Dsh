# Ledger fix — contradiction closure (t40)

This task landed the correction draft produced by t37 into the two ledger files and closed every
contradiction that draft listed. Nothing here is a paraphrase of t37: the numbers below were
**recomputed in this working tree** before being written into the ledger, and each gate was **re-run**
so the §8 table reports measurements, not a summary of someone else's summary.

Scope of this change: `docs/omo-parity-ledger.md`, `docs/omo-parity-ledger.zh-CN.md`,
`docs/index.md`, `docs/index.zh-CN.md` (English and Chinese together, same commit) plus this evidence
directory. No `skills/**`, no `packages/**`, no `VENDOR_LOCK.json`, no git write.

## 1. The two anchors

| Anchor | Value |
|---|---|
| `HEAD` when the gate run started | `3096455` |
| `HEAD` when it finished (captain landed the wave concurrently) | `e89fa2a` |
| `evidence/omo-align/requirements/frozen-contract.json` | `09949c8095d7ccd533329b114a2ef22bad1ce81bd24338240e68cfd0fd66be41` |
| `packages/mpd-agent-teams-plugin/lib/session-start.js` | `8cfaef47e9959ef7def01003640f768ff4befa50e9c202ff692a0629ca0a2aa6` |

Because the commit id moved during the run (a sibling slot's landing), the ledger records the
**content** hashes as the anchors and states that the tree moved — an honest anchor rather than a
single revision id that would silently misdescribe half the table.

## 2. Recomputation of the numbers written into §3 / §8

The rate study was re-run from its own raw data, not re-quoted:

```
node evidence/omo-parity-rate/raw/probe.mjs --json
```

| Quantity | Recomputed value |
|---|---|
| dataset | 20 rows, all CJK, 5 `session-start` + 15 `follow-up` |
| triggered | 0 (session-start 0/5, follow-up 0/15) |
| signal breakdown | A 0, B 0, C 0, D 0 |
| anchors printed by the probe | `session-start.js 8cfaef47…`, `state.js 751a4c1e…`, `frozen-contract.json 09949c80…`, `raw/prompts.jsonl 123dca67…` |
| richest session-start prompt | exactly 1 distinct B verb (`对齐`, threshold 4) and 1 distinct C2 verb (threshold 3) → no signal |
| 95% upper bound, overall (n=20) | 13.9% (Clopper–Pearson one-sided); rule-of-three 15.0% |
| 95% upper bound, session-start only (n=5) | 45.1% (Clopper–Pearson one-sided); rule-of-three 60.0% |

The verb counts were re-derived independently by matching the gate's **exported** `ACTION_VERB_PATTERN`
/ `CLAUSE_ACTION_PATTERN` against `raw/prompts.jsonl` (not by trusting the earlier probe's summary):
P01 B=1 `对齐`, C2=1, C3=0, enumerated lines 0; P02–P05 all zero.

## 3. Contradiction closure (every item from t37's `ledger-delta.md`)

| Id | t37 finding | Terminal state in this change |
|---|---|---|
| `CF-1` | §3 threshold said `>= 2`, contract and code say `>= 1` | **corrected** — §3 (both languages) now reads `trigger = anyExplicitFlag OR (matchedSignals >= 1)`, with the supersession history and the accepted cost spelled out |
| `CF-2` | §3 C row said "lines OR verbs" and omitted C3 | **corrected** — §3 now states C is one signal satisfied at **2-of-3** sub-signals, names C1/C2/C3, and says they are never top-level signals |
| `CF-3a` | B row flagged for checking | **checked, no change needed** — the B verb list in the ledger matches the contract's B table |
| `CF-3b` | C row's verb table was stale and asymmetric (7 EN + 6 CJK missing) | **corrected** — §3 now carries the harmonized union (14 EN, 12 CJK), states the pre-R3 asymmetry, and explains that C2/C3 differ only in role |
| `CF-4` | §8 entirely `pending` / `待跑` | **corrected** — §8 flipped to verified with the command result for each gate, the log sha256s, and the content anchors |
| `CF-5` | the module doc inside `session-start.js:29` contradicted its code at `:206` | **not this task's scope, and deliberately not "fixed" here**: the file is plugin code owned by its single writer, and editing `packages/**` was explicitly out of scope. It is closed as a **boundary** item, not as a contradiction in the ledger. The ledger no longer repeats the doc's stale wording, so a reader of the ledger cannot inherit it. Carried forward to the owning slot |
| `CF-6a` | §4 quoted S2's pre-reconciliation wording | **corrected** — §4 now quotes the frozen `S2.assert` verbatim (transitive dependents; the no-re-run guarantee scoped to unchanged transitive inputs) |
| `CF-6b` | §7 `O5` presented a resolved conflict as open | **corrected** — `O5` is marked closed with the reconciliation, and the missing upstream citation is recorded as a limitation (`S2.evidenceProvenance`) |
| beyond t37 | §7 `O3`/`O4` described open work; §6 `L6` pinned a stale `mode === 'auto'`; §6 `L4`/`L5` named section headings that no longer exist | **corrected** — `O3` closed with `uncertain` recorded, `O4` closed (the shipped predicate has no unconditional-notice path and the two-sided case measures 3/3 silent), `L6` now names `mode === "off"` + `autoRoute === true`, `L4`/`L5` name the shipped headings `Session-start team gate (binding)` / `会话启动团队门（强制）` |
| accepted cost (not a contradiction) | a multi-clause prompt can route to a team via C's own 2-of-3 bar | **kept and documented**, in §3 (both languages) and `O1` — this is the ratified Option A behaviour, not a ledger defect |

Nothing in the list is left hanging.

## 4. Gate evidence

Each gate was re-run in this tree; raw output is kept next to this file.

| Gate | Exit / result | Raw log |
|---|---|---|
| `bun run typecheck` | 0 | `gates/typecheck.log` |
| `bun test packages/mpd-agent-teams-plugin` | 0 — 161 pass / 0 fail, 42 files | `gates/plugin-tests.log` |
| `bun run test:qa` | 0 — all self-tests passed | `gates/test-qa.log` |
| `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | 0 — PASS | `gates/bundle-lifecycle.log` |
| `bun skills/dsh-qa/scripts/session-start-team.mjs` | 0 — PASS (simple 3/3 silent, complex 3/3 one staged team + one notice, negative control `disarmed: true`) | `gates/session-start-team.log` |
| `node skills/dsh-qa/scripts/preset-conformance.mjs --self-test` | 0 — 30 harness rows conform, row parity 31/31 | `gates/preset-conformance-selftest.log` |
| `node scripts/install-profile.mjs --self-test` | 0 | `gates/installer-selftest.log` |
| `node scripts/verify-vendor.mjs` | 0 — PASS | `gates/vendor.log` |

The per-log sha256 values are recorded in `result.json` under `gates[].logSha256`, and a reader can
re-verify each one against the file next to this document. The copied logs are byte-identical to the
captured output except for ONE neutralised vendor-scope token in `gates/test-qa.log`
(`@nanmicoder` -> `<vendor-scope>`), so this evidence text carries no retired external project
identifier; the recorded hashes are of the sanitised files.

## 5. Falsifiability of this change

* `git grep -nE '>= *2' -- docs/omo-parity-ledger.{md,zh-CN.md}` returns no match. The raw scan was
  run against the working tree (both ledger files are new/untracked, so `git grep` cannot see them
  until the captain commits — noted rather than worked around with a staging command).
* The remaining `≥ 3` occurrences are the **sub-signal** thresholds inside C1/C2/C3, which the
  contract sets at 3; the gate-level threshold appears only as `>= 1`.
* The bilingual pair check passes in both directions, and both files keep their switch link directly
  under the title.
