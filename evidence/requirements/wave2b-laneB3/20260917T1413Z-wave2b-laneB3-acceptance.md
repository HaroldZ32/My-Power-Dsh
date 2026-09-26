# Wave-2b LANE B3 — executable acceptance (r-B3, frozen BEFORE any implementation)

**Seat:** Architect (requirements, read-only), through the platform artifact channel — the only write a denied seat has.

**Authority:** `.mpd/plans/friction-p2-wave-2b.md` — body byte-identical at sha256 `0dd3d2fd4744802d37031477…` (cited as the plan cites
it), §4 (lane map + write set), §5 (lane B3 table), §6 (DAG), §7 (serialization), §8 (lane-scoped gates), §9 (evidence convention),
**A2.1** (the verify-substitute rule), **A2.3** (T-89's three halves) and **A2.6** (the B3-before-the-pack ordering). Register:
`.mpd/TODO.md`. Lane inputs used as INPUT: lane A's note `evidence/agent-teams/wave2b-notes/20260917T091500Z/2b-refinements.md` §4e (the
six addressing parameters) and B3's own `reading_bound.for_wave_2b` (cited by the FIELD NAME and the clause's heading, never by its count
— the plan's amendment A4 states that rule).

**Moment of this freeze:** the `t10` record's own timestamps — `createdAt` 1789653786137 = 2026-09-17T14:03:06Z, `updatedAt`
1789654380480 = **2026-09-17T14:13:00Z** (its claim; read from `.mpd/team/friction-p2-wave/team.json` read-only). The file was written
after that instant; the stamp names the CLAIM, because this seat has no shell and will not invent a clock.

**What is frozen — SEVEN ids, in register order:** **T-28, T-29, T-30** (§8.5 P2 16; detail §4), **T-47** (§8.5; detail §4),
**T-91** (§8.6), **T-90** (§8.6, doctrine) and **T-88** (§8.6, doctrine half). The plan's §4 parenthetical says "6 + 2 doctrine
halves" while its own id list names seven ids (five docs/gate rows + two doctrine halves); **the id list is the authority** and this
file covers all seven.

---

## 1. WRITE SET — file-exact (plan §4's B3 row)

- `AGENTS.md` — the manual: T-28's policy sentence, T-91's gate row + bound sentence, T-90's and T-88's doctrine
- `scripts/verify-docs-parity.mjs` — the docs gate itself (T-29's discovery/classification, T-30's exemption mechanism)
- `templates/**/README.md` + `templates/**/README.zh-CN.md` — T-47's pair (EN + zh-CN, SAME change)
- `docs/**` — ONLY if a pair is needed; a docs edit carries the bilingual obligation in the same change

**NOT in this set, named so nobody re-globs it:** `agent-references/**` (the agent-facing English-only band the docs gate deliberately
does not discover — T-28's sentence is ABOUT it, not an edit to it; the one exception in 2b is lane A's
`agent-references/agent-teams-deltas.md`); `scripts/verify-pack-closure.mjs`, `scripts/verify-rows-parity.mjs`, `scripts/repin-vendor.mjs`,
`scripts/run-qa-lanes.mjs`, `.gitignore`, `package.json` (lane B's); `scripts/check-citations.mjs` (B2's); `skills/**` (lane D's, the
one corpus writer); `packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`, `.mpd/plans/**` (the captain's integration).

**HOP CANDIDATES (named, never silently dropped — plan §7.8):**
1. **`agent-references/index.md`** — the docs gate checks the delta-table pointer in BOTH `AGENTS.md` and this file (a hand-carried
   DERIVED value, T-75), and this file is in NO lane's 2b write set. A pointer fix there is a hop request or a captain declaration.
2. `docs/**` beyond a pair the row needs (a docs edit drags the bilingual obligation with it).
3. `scripts/verify-pack-closure.mjs` — this lane READS its behaviour for T-91's sentence but never edits it (lane B's file).

---

## 2. VERIFY — lane-scoped, `./`-formed

- `node scripts/verify-docs-parity.mjs --self-test` (the gate's own arms)
- `node scripts/verify-docs-parity.mjs --json ./evidence/docs/<slug>/<stamp>/docs-parity.json` (the CENSUS reading: which pairs were
  checked, which paths were exempted, and the derived-value comparison against the registry)
- `bun run verify:docs` — green in-lane ONLY under §6 F2's ordering rule (its T-75 half re-derives the delta pointer/count from the
  registry LANE A regenerates)
- T-47: a COPY of the corrected debranding prober in this lane's own evidence dir, with an explicit target:
  `node ./evidence/docs/<slug>/<stamp>/verify-debranding-full.mjs --template-root ./templates/mpd-extension --json-out ./evidence/docs/<slug>/<stamp>/debranding.json`
  (source: `evidence/extensions/debranding-probe/20260916T061807Z/verify-debranding-full.mjs`; it is immutable-by-default and refuses
  an existing target — never write into the foreign evidence directory)
- T-91's truth check: `node scripts/verify-pack-closure.mjs --self-test` (fixture-driven, so it is safe and green in-lane — the same
  command the plan gives lane B; its arms are the evidence that the sentence describes real behaviour)
- the BUDGET reading after any AGENTS.md edit: `node ./evidence/gates/agents-budget/20260917T011651Z/budget-check.mjs`
  (`MAX_BYTES` default 65,536; it prints the headroom)

**FORBIDDEN here, by name:** `bun run verify:gates` · `bun run test:qa` · `bun run test:qa:all` · `node scripts/verify-vendor.mjs` ·
`node scripts/verify-dist-fresh.mjs` · `bun run typecheck` · `node scripts/verify-rows-parity.mjs` (lane B's) ·
`node scripts/verify-pack-closure.mjs` WITHOUT `--self-test` (a real pack read is a post-pack integration reading). A red this lane cannot
keep green belongs in EVIDENCE, never in a verify list (A2.1's round-2 rule; T-84's extended §Fix).

---

## 3. THE TWO PACKED-FILE ROWS, AND ONE MEASURED CORRECTION

- **T-47 (`templates/**`) is a REAL packed asset** — `templates` is in the packer's `ROOT_ASSET_DIRS` — so its pair MUST land BEFORE
the wave's single pack (plan A2.6). The pack's own before/after requirement, restated: the integration re-packs ONCE and reads the
closure gate's post-pack membership — the files the pack SUPPOSED to absorb must DROP OUT of the `expected-after-pack` set; a bare
`exit 0` is not freshness.
- **T-91 (`AGENTS.md`) is NOT in the artifact** — the packer's own comment: "AGENTS.md itself deliberately stays out of the artifact
  (it is the repository's contributor manual)". So the row's "the file is PACKED" is measured FALSE. The pre-pack ORDER is harmless and
  may be kept, but it is not required by the artifact. (Reported to the captain once already; restated here because this row's text will
  be read again by whoever lands 2c — the label is the only part that is wrong.)

---

## 4. PER-ROW ACCEPTANCE

### T-28 — `§8.5` · detail §4 · friction · P2 · "an explicit `docs/agent/**` band exempted by policy" (register §Fix) — **SUBSTITUTED**
- **The substitution, stated rather than copied:** the plan's §5 shape (authoritative, from the ruling recorded in
  `.mpd/plans/wave2-triage.md`) closes this row with a POLICY SENTENCE naming **`agent-references/**`** as the agent-facing English-only
  band the docs gate deliberately does not discover — not by creating a `docs/agent/**` directory. This acceptance follows the plan.
- **DELIVERABLE:** the policy sentence, in a place its readers meet it (the manual's language-policy area — `AGENTS.md` is agent-facing
  and English-only, so the sentence itself needs no twin).
- **OBSERVABLE:** the sentence exists AND is TRUE: a census run's report contains **no** `agent-references/` path among the checked
  pairs.
- **DECISIVE:** the `--json` census read (no `agent-references/` path) plus a byte read of the sentence.
- **NEG CONTROL:** an EN `*.md` with no twin placed under `agent-references/` must NOT redden the gate (the band is outside discovery),
  while the same fixture under `docs/` MUST redden — the two runs are the arm.
- **EVIDENCE:** `evidence/docs/<slug>/<stamp>/` with both runs + the census JSON.

### T-29 — `§8.5` · detail §4 · trap · P2 · M · "classification stops being directory-sensitive … classify by an explicit marker rather than by directory, and add `templates/**` to the discovery roots"
- **DELIVERABLE:** (i) `templates/**` README pairs enter the discovery set; (ii) classification by an explicit marker (a front-matter
  `doc:` field or an equivalent DECLARED rule) instead of directory position.
- **OBSERVABLE:** `templates/mpd-extension/README.md` + `.zh-CN.md` are reported as a POLICED pair; a misplaced doc (an EN `*.md` with no
  twin under `templates/` or `extensions/`) reddens instead of escaping.
- **DECISIVE:** the census lists the template pair; the misplaced-doc fixture reddens.
- **NEG CONTROL:** `extensions/**` NON-README `*.md` (skills, personas) stay ASSETS — never asked for a twin; and the one recorded
  package exemption (`packages/mpd-mcp-shared`) stays a REPORTED exemption, not a violation.
- **EVIDENCE:** census + both fixture runs. **Ordering with T-47:** the discovery change makes T-47's pair policed, so the two land in
  ONE task/edit cycle (discovery first, then content), never in two windows where the pair is policed-but-unfinished.

### T-30 — `§8.5` · detail §4 · friction · P2 · "derive exemptions from a pattern or a header line in the doc itself"
- **DELIVERABLE:** the process-record exemption mechanism derived from the doc itself (marker/header) rather than a hand-maintained
  prose map (`EXEMPT_LONE_FILES`).
- **OBSERVABLE:** a new historical doc carrying the marker is exempt WITHOUT editing the gate; the same doc without the marker is a
  VIOLATION.
- **DECISIVE:** two fixture docs (marker present / absent) → exempt / violation, asserted from the gate's own output.
- **NEG CONTROL (the one that matters):** the TWO ANTICIPATORY entries the gate's header records by design (`docs/adder4.md`,
  `docs/cnt8.md`) must not silently vanish in the migration — the acceptance requires them either carried by the new mechanism with
  their design intent recorded, or retired by an explicit captain decision. Silence is the failure mode this row exists to remove.
- **EVIDENCE:** the census before/after + both fixture runs.

### T-47 — `§8.5` · detail §4 · friction · P2 · "quote the remaining snippet values in `templates/mpd-extension/README.md` + `.zh-CN.md`" — **PACKED**
- **DELIVERABLE:** the template README pair quotes the remaining manifest snippet values (2 of 13 today), EN and zh-CN in the SAME
  change — or the deliberate-decision sentence ("the template README does not mirror the manifest, and here is why"), which is the
  register's own alternative.
- **OBSERVABLE:** the corrected prober's per-kind inventory reports 13/13 for the template root (today: 2 quoted, 11 "not quoted").
- **DECISIVE:** `verify-debranding-full.mjs --template-root ./templates/mpd-extension --json-out …` reports no unquoted field.
- **NEG CONTROL:** the prober's own mutation arm — ONE byte of ONE probed field changed in a TEMP copy must redden it (`--self-test`).
- **EVIDENCE:** the run's JSON + the pair's diff. **PACKED → before the single pack.**

### T-91 — `§8.6` · gap · P2 · "the MANUAL's gate table omits the closure gate AND its post-`t26` bound"
- **DELIVERABLE:** one row in `AGENTS.md` §4's gate table + the bound sentence, and §11's release sweep naming the same gate; the row's
  own fix sentence is quoted in the register: *"a green `verify-pack-closure` certifies completeness + the byte identity of files whose
  sources did not move; freshness is read from the `expected-after-pack` list — the absorbed files GONE at the re-pack — never from the
  exit code alone"*.
- **OBSERVABLE:** the table carries the row; the sweep names it; the sentence states the post-`t26` discriminator (TIMESTAMP ORDER;
  membership of the `expected-after-pack` list; `--pack-stamp` for a reviewer mutating a copy) rather than a blanket freshness claim.
- **DECISIVE:** the closure gate's own `--self-test` runs green (its arms are the evidence that the sentence describes REAL behaviour),
  plus byte readings that the table row and the sweep line exist.
- **NEG CONTROL:** the falsifiability requirement — if the sentence claims more than the gate does, the arm that must redden is the
  gate's EXPECTED-class red side (its 20c-style arm); an acceptance that only greps for the row's presence is not accepted.
- **EVIDENCE:** the self-test run + the manual's diff. Agent-facing English-only → NO bilingual pair (stated per row, not assumed).

### T-90 — `§8.6` · trap · P2 · **DOCTRINE HALF** · "a citation to a MAILBOX record rots by MAILBOX CLEARING"
- **DELIVERABLE:** the durable-anchor doctrine in `AGENTS.md` §7 — an ARTIFACT PATH (or a run record's own field) is the anchor; a
  relay is secondary; **a mailbox id is not a link** — PLUS the CLASS CLAUSE (an `attemptId`/session id is DATA, so the rule is
  class-based, and a shape scan is only a DISCOVERY HEURISTIC) with its CALIBRATION BOUND (the measured 31-of-31 false positives on a
  shape scan), PLUS the operational half: a seat that must cite an exchange copies the quoted bytes into its own artifact when the
  exchange is identified (the register's own next step).
- **OBSERVABLE:** the three clauses + the bound are stated, and the copy-the-bytes step is named as an action rather than a preference.
- **DECISIVE:** byte readings of the clauses; and the doctrine's own instance is cited BY ARTIFACT (the register records that the
  mailbox id became unretrievable while the relay and the artifact stayed readable — the artifact is what the text must name).
- **NEG CONTROL:** a fixture text containing a mailbox-ID-SHAPED string that is DATA (an `attemptId`) must NOT be flagged by the class
  rule — the bound is what keeps the doctrine from becoming a shape hunt.
- **EVIDENCE:** the manual's diff + the fixture reading.

### T-88 — `§8.6` · trap · P2 · **DOCTRINE HALF** · "the derived-surface rule where a planner reads it (`AGENTS.md` §7), so 2c declares it at plan time"
- **DELIVERABLE:** the rule text — derived surfaces (`packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`, `.mpd/plans/**`)
  are DECLARED on the integration task at CREATION; the hop is the mid-wave escape; the three measured routes are named with route 3
  (request the hop with the exact amendment text, one message, no work) as the working one.
- **OBSERVABLE:** the text names the class, the declare-at-creation rule, and the escape.
- **DECISIVE:** byte readings; and the rule's instance is cited by the wave's own refusal shape (`1 changed path(s) not covered by
  inScope: …`) rather than by recollection.
- **NEG CONTROL:** the distinction that must NOT collapse — the text must not instruct a LANE to declare a `dist/**` pattern, because
  the platform's `inScope overlaps` validator refused exactly that mid-wave (measured) and the register's own note says the declaration
  belongs at PLAN time. An acceptance that asks a lane for the pattern contradicts the platform.
- **EVIDENCE:** the manual's diff. (Lane B's half is the DAG DEMONSTRATION; this half is the TEXT — one row, two owners, stated.)

---

## 5. THE BILINGUAL OBLIGATION, PER ROW (stated, never assumed)

| row | file(s) | human-facing? | obligation |
|---|---|---|---|
| T-28 | `AGENTS.md` (sentence) | agent-facing, English-only | none |
| T-29, T-30 | `scripts/verify-docs-parity.mjs` | code | none |
| T-47 | `templates/mpd-extension/README.md` + `.zh-CN.md` | YES (template users) | BOTH, SAME change, closed by the docs gate once T-29 lands |
| T-91, T-90, T-88 | `AGENTS.md` | agent-facing, English-only | none |
| any `docs/**` edit | the pair | YES | EN + `*.zh-CN.md` in the same change |

The gate itself (`bun run verify:docs` / `node scripts/verify-docs-parity.mjs`) is the enforcer for every YES row above.

---

## 6. FINDINGS

**F1 — T-91's "PACKED" label is measured FALSE for `AGENTS.md`** (see §3): the packer excludes it by design; `templates/**` (T-47) is the
real packed path. The pre-pack order is harmless for T-91 and REQUIRED for T-47.

**F2 — `bun run verify:docs` is a DERIVED-VALUE gate, so it cannot be green in-window while LANE A's region change is unreconciled:** the
gate's T-75 half compares the delta-table pointer in `AGENTS.md` and `agent-references/index.md` AND the registry's region/file count
statement against the GENERATED `lib/mpd-deltas.js` — the file lane A regenerates with `--write-registry`. The lane's rule: re-take the
pointer/count at the WRITE (B3 clause (b): row id + region ids + registry sha, never inherited), land the manual edit in the same window
as the registry's final value, and if the value moves afterwards route the re-take to the INTEGRATION step rather than keeping a verify
entry that cannot pass.

**F3 — the gate's second pointer site is unowned in 2b:** `agent-references/index.md` is in no lane's write set (hop 1).

**F4 — the instruction budget is a hard constraint on the three doctrine rows:** `AGENTS.md` once measured 78,283 B against a 65,536 B
budget and the harness silently DROPPED THE TAIL (injected as 65,143 B). The instrument exists and is readable:
`evidence/gates/agents-budget/20260917T011651Z/budget-check.mjs` (`MAX_BYTES` default 65,536, headroom printed). Every row that edits
the manual ends with that reading; a green docs gate says nothing about it.

**F5 — the plan's §4 parenthetical ("6 + 2 doctrine halves") disagrees with its own seven-id list** for this lane; the id list is the
authority and all seven are covered above.

---

## 7. VERDICT OF THIS FREEZE

Lane B3 can start: seven ids with named deliverables, a file-exact write set, a lane-scoped verify list whose one derived-value command
carries its ordering rule (§6 F2), the two packed-file rows marked with the MEASURED truth about which of them actually enters the
artifact (§3), the bilingual obligation stated row by row (§5), and a red side for every row — including the two anticipatory exemptions
that must not vanish silently (T-30) and the shape-scan calibration bound that keeps T-90's doctrine a class rule rather than a hunt.


---

## ADDENDUM B (appended after completion; nested, never a rewrite) — plan amendments A5 and A6, cited here as the captain asked

**A5 — the LABEL, corrected at the plan level.** The T-91 note that `AGENTS.md` is "PACKED → before the pack" is WRONG,
and the packer's own words are the authority: *"AGENTS.md itself deliberately stays out of the artifact (it is the repository's
contributor manual)"*, while `ROOT_ASSET_DIRS` confirms `templates/**` (T-47) IS packed. The ORDER is unchanged and harmless;
the REASON changes: the pre-pack requirement that bites is T-47's `templates/**` README pair **plus any `docs/**`,
`agent-references/**` or root-asset edit** — not the manual. This file's §3 and F1 recorded the measurement; A5 is now the
authority a reader follows, cited here so the corrected reason travels with the acceptance.

**A6(1) — F3 is RESOLVED by declaration.** `agent-references/index.md` (the docs gate's SECOND pointer site) is now DECLARED on
`impl-B3` (`t16`) by captain amendment, so the pointer re-take has a legal writer. §1's hop 1 and §6's F3 therefore close: the path
is no longer a hop. The other two hops stay named and UNGRANTED per A4 (`packages/mpd-agent-teams-plugin/lib/snapshot.js`;
`packages/mpd-agent-teams-plugin/test/**`).

**A6(2) — F2 is adopted as a STANDING requirement.** `impl-B3` must either RE-TAKE the derived values at the write (the pointer text
and the registry count, re-derived after lane A's `--write-registry` regeneration, never inherited) or route the re-take to the
integration step with a lane-scoped substitute named — which is what §6 F2 states, now at plan level.

**A6(3) — F4 is adopted as a STANDING requirement.** Every `AGENTS.md` edit ends with the budget reading
(`evidence/gates/agents-budget/20260917T011651Z/budget-check.mjs`) quoted as a recorded reading; the docs gate cannot catch it.

**Net effect on this acceptance:** scopes and rows unchanged; §1's hop list loses one item (index.md, now owned by `impl-B3`) and
§6's F2/F3/F4 gain plan-level authority. No row changes shape, and nothing here supersedes the frozen body above.
