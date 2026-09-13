# t8 prep note — work order staged while the DAG gate holds the claim

Status: **PREP ONLY — not the repair report, no deliverable edited yet.** Owner: Senior Engineer.
Reason: `agent_teams_claim_task t8` is refused by the scheduler ("blocked by unfinished dependencies:
t7"); t7 waits on t6 ← t5 ← t1–t4. This note converts captain-rulings.md (R1–R4) + the captain's
follow-up + t9's standard.md + t2's acceptance.md into an executable edit list so the repair runs in
one pass when t7 lands.

## 0. Baseline measured at the pin (mpd `32ae54d`, branch `dev`)

| Measurement | Value |
|---|---|
| `git rev-parse HEAD` / branch | `32ae54dd…` / `dev` (tree clean except untracked `evidence/`) |
| tracked targets: 6 RTL docs / LSP template / 2 RTL cases | 6 / present / 2 (all tracked) |
| `git ls-files skills \| wc -l` (acceptance C1) | 329 |
| `git ls-files tests/golden/fixtures/verilog` (C5) | 4 files (README.md, modules/adder4.v, modules/cnt8.v, tb/tb_adder4.v) |
| `node scripts/verify-rtl-references.mjs` (C7 baseline) | 48 references, 42 resolved, 6 pending-by-design, 0 unresolved, exit 0 |
| BOTH-resolution set (`resolved-where.tsv`, summary line excluded) | **5 tokens**: docs/adder4.md, docs/cnt8.md, packages/mpd-bundle/cordis.patch.yml, packages/mpd-mcp-lsp/dist/cli.js, packages/mpd-mcp-lsp/templates/rtl-lsp-client.json |
| `package.json:29-30` `test:qa` vs `test:qa:all` | byte-identical |
| dsh-qa corpus (t9 C1) | 25 scripts vs 24 rows: `llm-dual-track` (row, no script), `dual-track-smoke` + `rtl-verif` (scripts, no rows) |
| callers of `verify:rtl-refs` | `package.json:33` only (not in AGENTS.md §4 gate table, not in `test:qa`) |
| docs/development{,.zh-CN}.md mentions of the retired/added cases | 0 RTL mentions; 0 `software-smoke` → t9 C4 row must be added |

## 1. Ordered edit list

1. **R3a — land the software-type worked example** (t9 §5.6, exactly two deltas):
   `cp evidence/rtl-extraction-residual/qa-standard/raw/software-smoke.prototype.mjs
   skills/dsh-qa/scripts/software-smoke.mjs`; (i) repo-root → house
   `dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))`; (ii) import →
   `./lib/workspace-isolation.mjs`; point evidence at `evidence/dsh-qa/software-smoke/<stamp>/`,
   drop `MPD_SMOKE_OUT`/evidence-dir default. Proof: `--self-test` green, one real lane `ok=true`,
   `bun run test:qa` exit 0.
2. **R3b — corpus rules**: add t9 §5.7 SKILL.md row (verbatim, one line) + the C3 software-type
   sentence; delete `skills/dsh-qa/scripts/rtl-verif.mjs` + `rtl-ip-profile.mjs` and the
   `rtl-ip-profile` row (`SKILL.md:62`); reword `dual-track-smoke.mjs:21` comment; resolve the
   `llm-dual-track` ↔ `dual-track-smoke` slug mismatch so t9 C1's diff prints nothing.
3. **R1 — LSP template**: delete `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` (dir becomes
   empty); drop the "Custom binary escape hatch" section from `README.md` + `README.zh-CN.md`
   (both languages, one change). Package, `dist/cli.js`, `overlay/`, build wiring stay.
   Expect the BOTH set 5 → **4** (only the template leaves it).
4. **R2 — six stranded docs**: delete
   `docs/rtl-{verif,ip-flow}-guide{,.zh-CN}.md`, `docs/rtl-gap-assessment{,.zh-CN}.md`, then fix
   inbound: `docs/index.md:19` + `docs/index.zh-CN.md:18` (delete the row AND remove the
   "being moved to the silicon sub-bundle … until then this file describes the pre-extraction
   checkout" in-progress framing), `packages/mpd-bundle/README.md:8` + `README.zh-CN.md:4`,
   `AGENTS.md:139`, `scripts/verify-rtl-references.mjs` `DOCS` list (:25).
5. **verify-rtl-refs honesty (R2/C5)**: `CASES = []`, header/usage text updated, run line prints
   `mpd-side cases: 0 (retired by t8 — the corpus carries no RTL case)`; controls untouched.
   Decide retire vs repoint (see §3-a).
6. **test:qa:all honesty (R3)**: collapse or differentiate (see §3-c).
7. **Out-of-ruling RTL remains (C5/C6, see §3-b)**: `tests/golden/fixtures/verilog/**` (4 files) and
   the `Source file:` lines of `docs/adder4.md` / `docs/cnt8.md` → repoint at silicon fixtures
   (acceptance C5 + I6).
8. **Docs fan-out**: `docs/development.md` + `.zh-CN.md` gain the `software-smoke` catalog entry
   (t9 C4); hub/README reference fixes from step 4 in both languages.
9. **VENDOR_LOCK re-pin**: `node scripts/verify-vendor.mjs` → re-pin `fileCount`/`treeSha` from the
   gate's own output, same commit as the `skills/**` change (single `skills/**` writer = this task).
10. **Report**: `evidence/rtl-extraction-residual/repair/report.md` (§2 format) + `git status --short`.

## 2. Report format (from the captain; `repair/report.md`)

One row per defect: `id | path | fix | proving command | exit code`; then a **DEFERRED** section with
reasons; then `git status --short` after the repairs. Rows to include: R1 template + README pair,
R2 six docs + each inbound reference, R3 two cases + SKILL.md rows + corpus bijection, the
software-smoke landing, the gate-honesty change, and (if ruled in) the C5/C6 items.

Explicit statements the captain asked for in the report:
- `verify-rtl-references.mjs:79-80` resolves a token against **either** root, so the gate stays
  green only while the silicon copies remain in place; the either-root resolution is **intentional**
  (silicon owns the RTL bundle, mpd keeps the harness material the workflow also uses) — and it is
  the reason a stale mpd copy can mask a silicon-owned path (t3 F5), which R2 neutralizes by
  removing the stale copies rather than by changing the resolver.
- BOTH-resolution before/after counts (5 → 4 expected) so the shrinkage is not read as damage.
- t3 F4: the 7 `mpd-verif-plugin/evidence/smoke/*` files are a partial-copy loss recorded for a
  **silicon-side** follow-up; mpd does not re-add RTL payload to close it.
- Supersession: acceptance.md C7 asserts the two RTL cases' self-tests and `rtl-verif`'s SKILL.md
  row; R3 deliberately supersedes those two bullets. C7's other bullets and C1–C5 stay in force.
  Anything not repaired (C6 carrier hook, golden software benchmark) goes to DEFERRED with reasons.

## 3. Open decisions (asked; captain may veto rather than answer)

- **(a) `verify:rtl-refs` after R2/R3** — recommended: KEEP the guard, drop `CASES`, keep auditing
  the silicon docs (their copies remain), print the mpd-side case count with the retirement reason,
  and add a vacuity disclosure (`0 subjects` must not print as PASS). Alternative: retire the script
  and the npm script with the reason recorded. Not doing nothing: a gate whose output implies
  coverage it no longer has is the defect t11 will look for.
- **(b) out-of-ruling RTL remains** — recommended: include the C5 fixtures + I6 `Source file:`
  repoints (acceptance contract, bucket B1) in this repair; EXCLUDE the C6 `rtl-ip` carrier hook
  (a bridge gap, needs a mounting boot — DEFERRED with owner).
- **(c) `test:qa:all`** — R3 stands; recommended collapse to a single script with the reason
  recorded (t9 §C6's "leave it" is the pre-ruling recommendation; it conflicts with R3).

## 4. FINAL (captain's answers — supersede §3 and every pre-ruling scope note above)

The captain's contract message + `captain-rulings.md` R1/R1.1/R2/R3/R4/R5/R6 are the binding t8
contract. t8 stays behind t7 by design (do not ask for the dep to be dropped).

- **(a) `verify:rtl-refs` → REPOINT, do not retire.** Keep script + npm script: (i) NEGATIVE
  invariant over an explicit forbidden-path list (six RTL guides, `packages/mpd-verif-plugin`,
  `tests/golden/fixtures/verilog`, `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json`, the two
  retired QA cases, the HDL registrations in `packages/mpd-mcp-lsp/overlay/lsp/*`) — existing OR
  tracked on the mpd side ⇒ exit 1; (ii) the silicon-side resolution becomes SKIPPED-with-disclosure
  when the silicon checkout is absent (SKIP line naming the missing root; never a silent pass);
  PENDING + named owners kept; self-test controls extended, not removed.
- **(b) `tests/golden/fixtures/verilog/**` IN SCOPE, DELETE (4 files).** `docs/adder4.md` +
  `docs/cnt8.md` are RETAINED process records: repoint their `Source file:` line at the silicon path
  + one-line "fixture moved to the silicon bundle" note; do not delete, do not promote to bilingual
  public docs; if a zh twin exists, update both together.
- **(c) `test:qa:all` → DIFFERENTIATE, do not collapse.** `test:qa` = every case `--self-test`;
  `test:qa:all` = the real (heavy/live) lane for an explicit allowlist enumerated by case script name
  in `package.json`, criterion "requires a real headless boot and/or live provider", membership +
  criterion recorded in the report. Fallback only if the list would be empty: collapse + record.
- **NEW R1.1**: strip the HDL registrations from `overlay/lsp/server-definitions.ts` +
  `language-mappings.ts`, then regenerate `dist/cli.js` via `node scripts/build-mcp.mjs` (never hand-
  edit; upstream checkout `.mpd-dsh/upstream/packages/lsp-daemon` present, `build-mcp.mjs:39-62`
  applies the overlay); re-pin VENDOR_LOCK, prove with `verify-vendor`, and behaviour-prove the new
  binary (initialize + `tools/list` + non-HDL builtin server count unchanged). If it cannot be done
  honestly → DEFER with failing command + exit code + reproducible command. Report the consequence:
  mpd/silicon LSP overlays become intentionally non-identical.
- **NEW R5**: pointer note in root `README.md` + `README.zh-CN.md` (RTL capability now in the silicon
  bundle `@mpd-dsh/silicon`, sibling checkout named) + record the explicit decision that mpd does NOT
  carry a silicon agent-teams profile (would re-introduce silicon capability into mpd teams).
- **NEW R6**: delete the fixtures; stale `dist/mpd-package/` repacked (`node scripts/pack-mpd.mjs`) or
  removed — record which; `dist/` is gitignored (distribution hygiene).
- **Acceptance**: the six repo-level commands re-run AFTER the last edit, exit codes quoted
  (`verify-vendor`, `verify-rtl-references`, `verify-rows-parity`, `bun run typecheck`,
  `bun test packages`, `bun run test:qa`); skills/** edited by this task only with the single
  VENDOR_LOCK re-pin in the same change; bilingual pairs updated with switch links intact; corpus
  RTL-free with the software-type scaffold self-testing green; report table + DEFERRED + before/after
  (incl. cli.js sha256) + BOTH-set shrinkage note + `git status --short`.

## 5. Gate defects F1/F2/F3 (captain addendum, t4's measurement)

**F1 — blocker, mine.** `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` exit 1: the roles probe's
final conjunct `bundled.length >= 20` (`packages/mpd-qa-roles-probe/src/index.ts:58`, mirrored at
`dist/index.js:282`) against a served corpus of **19** after the three `rtl-*` skill trees left
(baseline `3d99718`: SKILLS=22, PASS). Planned fix (no numeric floor): assert NAMED fixtures from the
served listing + the count relationship `summaries.length === bundled.length` (every served skill is
bundled) + keep the loaded-fixture bytes check; print a quotable line; rebuild
`packages/mpd-qa-roles-probe/dist/index.js` with
`bun build src/index.ts --target node --format esm --outfile dist/index.js` (src + dist both land);
re-run the gate quoting exit code, SKILLS/BUNDLED and the case's own FAIL-side port round trip; state
that the red was masking apply-crash signatures in the same boot log and that the green run covers
that check again.

**F2 — medium, mine.** `bun test packages` = 295 pass / 3 fail
(`self-fix-tests/registry-context-heal.test.mjs` ×2, `self-fix-tests/scope-glob-and-contract.test.mjs`
×1; the same assertions also fail on the pre-extraction baseline). Cause: the "pristine upstream"
fixture is `git show HEAD:…lib/{tools.js,quality-gates.js}`, and `d510a16` committed the `mpd-delta`
markers into HEAD, so the fixture is no longer pristine by construction.
Measured: current `lib/tools.js` 2409 L / 137,565 B, `lib/quality-gates.js` 1069 L / 50,559 B;
`d510a16^` versions 2279 L / 128,218 B and 862 L / 40,467 B, both with **0** `mpd-delta` occurrences.
Rejected options: `.mpd-dsh/upstream` is gitignored (`git check-ignore` → `.gitignore:11`), so not a
stable fixture source, and its `team-core` is the OMO TS package with no `lib/tools.js`; a naive
registry-strip reconstruction cannot restore the REPLACEMENT-shaped regions (the upstream
`description:` line and the upstream `pathMatchesScope` declarations were replaced, and the tests'
premises need them present). Plan: check in the pristine texts once as
`self-fix-tests/fixtures/upstream/{tools.js,quality-gates.js}` generated from `d510a16^`, with a
provenance README (commit, sha256, sizes) and sha256 pins asserted in the tests; the tests read the
fixture instead of git. Falsifiability probe to quote in the report: break one region on a scratch
copy and watch the test go red. Constraint: do NOT touch `lib/**` or the delta registry
(AGENTS.md §6) — the edit lives in `self-fix-tests/**` only, and the report must note that this is the
adopted-upstream tree.

**F3 — do NOT fix.** The two repointed RTL cases' missing `--store-dir` in a sandboxed HOME
(t4 `raw/rtl-verif-real.log`, `raw/rtl-ip-profile-real.log`) is **moot after R3** (both cases are
retired); no `--store-dir` added to scripts being deleted.

## 6. Captain decisions on t9's flagged items + carry-overs (verbatim scope)

- **(a) six docs' incoming links: DEFER — resolved by deletion, not deferred.** No hand-editing of
  lines in files that R2 deletes (`docs/rtl-verif-guide.md:255`, `docs/rtl-verif-guide.zh-CN.md:241`
  vanish with them). The report records the dangling-reference class as "resolved by deletion".
- **(b) `skills/dsh-qa/scripts/workmate-library.mjs` — GRANTED EXEMPTION, recorded, not silent.**
  Do not reword (`:19` note sample, `:23` match task, `:129` assertion) and do not re-run its live
  lane. The report carries an **exemptions section**: path, line, the sample-text reason, and the
  rule it would otherwise violate (standard.md §C2b). The strict C2b probe is expected to flag it.
- **`scripts/verify-rtl-references.mjs`**: implement BOTH — `CASES = []` with header/usage updated
  and run output disclosing the narrowed scope (the "green AND honest" clause) **and** the earlier
  addendum's negative forbidden-path invariant; keep the controls and the silicon-side resolution.
- **Coupled-file map (anchors re-verified this turn, all present)**: `AGENTS.md:18-19,144,367`;
  `docs/development.md` §4 + `docs/development.zh-CN.md` (QA section, both languages);
  `packages/mpd-bundle/README.md:8,11` + `README.zh-CN.md:4`;
  `skills/dsh-qa/scripts/dual-track-smoke.mjs:21` (comment naming the retired case set);
  `scripts/verify-rtl-references.mjs:26,31-32`.
- **C1 row↔script bijection**: fix `llm-dual-track` (row) ↔ `dual-track-smoke` (script) and quote the
  EMPTY diff of the C1 command in the report.
- **Exactly ONE `VENDOR_LOCK.json` re-pin**, riding in the same change as the `skills/**` edit.

## 7. Captain's final confirmations (no further confirmation needed; execute in one pass)

1. **C5 + I6 INCLUDE** (bucket B1; fixtures sha256-identical to silicon, deletion loses nothing):
   delete `tests/golden/fixtures/verilog/**`, repoint `docs/adder4.md` / `docs/cnt8.md` `Source file:`
   + moved-note. **C6 (`rtl-ip` carrier hook) → DEFERRED** for the two recorded reasons: it needs a
   mounting boot, and R5 already decides mpd carries no silicon profile — a decision on the record,
   not an omission. **C7's two RTL-case bullets → recorded as SUPERSEDED BY R3** explicitly, so t11
   cannot read it as a violation (C7's other bullets stay in force).
2. **verify:rtl-refs = BOTH clauses** (not optional): `CASES = []` + narrowed-scope disclosure
   (0 subjects must never print PASS) AND the negative forbidden-path invariant over the explicit
   list — six RTL guides, `packages/mpd-verif-plugin`, `tests/golden/fixtures/verilog`,
   `templates/rtl-lsp-client.json`, the two retired cases, HDL registrations in `overlay/lsp/*` —
   present OR tracked on the mpd side ⇒ exit 1; controls + silicon-side resolution kept.
3. **`test:qa:all` = allowlist FIRST** (heavy/live cases by name in `package.json`, criterion: real
   headless boot or live provider); collapse into `test:qa` only if the allowlist would genuinely be
   empty, with that reason recorded. t9 §C6 is the fallback, not the first move.
4. Pipeline note: t4 is terminal as **FAILED** (its acceptance required green gates); its two red
   findings (F1, F2) are mine to close; t5 → t6 → t7 → then the scheduler wakes me for the single
   end-to-end pass: R1 + R1.1 + R2 + R3 + R4 + R5 + R6, F1 + F2, the t9 landing deltas, one
   VENDOR_LOCK re-pin, then the six-command sweep AFTER the last edit with exit codes quoted.

## 8. Captain clarifications (t1's sweep) — F4 + line-number discipline

- **Lines: use mine/t1's, never the captain's earlier numbers.** Hub rows are
  `docs/index.md:19` + `docs/index.zh-CN.md:18`. `AGENTS.md` has **no** exact-name reference to the
  six docs — do not invent one; touching `AGENTS.md:144` is only for case-table/verif wording (the
  real RTL mention is `AGENTS.md:139`, the skills-tree line).
- **F4 (medium, NEW, in the file already being edited)**: `packages/mpd-bundle/README.md:5,8,11` +
  `README.zh-CN.md:4` advertise capabilities the bundle does NOT mount. Verified this turn by grep:
  `cordis.patch.yml:92-123` has `mcp-wave-mcp` / `mcp-traceweave` COMMENTED OUT (`:107`, `:118`), and
  `packages/mpd-verif-plugin` is **ABSENT** while the README lists `verif` among mounted plugins.
  Fix = correct the advertised mount list (state plainly that the waveform rows are not mounted; the
  patch already says so at `:92`), drop the `docs/rtl-verif-guide.md` install-policy pointer (deleted
  by R2). Verify the final text against the patch rows by grep and quote that grep in the report.
- **Golden fixtures**: R6 stands (delete). t1 labelled them "ACCEPTABLE per AGENTS.md §3"; §3's
  exemption concerns the BILINGUAL requirement for reference docs, not whether RTL payload may stay
  in mpd, and silicon's sync policy forbids keeping "the golden fixtures". If the report notes the
  t1-vs-R6 reading difference, it must cite both and leave t11 to adjudicate — never silently follow
  the looser reading.
- Everything previously ruled stands: C5+I6 in scope, C6 deferred as a recorded decision, C7
  superseded by R3 (stated), verify:rtl-refs with `CASES=[]` + disclosure + the negative
  forbidden-path invariant, `test:qa:all` allowlist first, one VENDOR_LOCK re-pin, six-command sweep
  after the last edit.

## 9. F1/F2 approved (captain) + execution-time verifications

- **F1 approved exactly as planned.** Named fixtures from the served listing +
  `summaries.length === bundled.length` + the svn-master load/bytes check, no numeric floor, quotable
  `[roles-probe] SKILL_FIXTURES=…` line, src AND dist landed. Report cites 22 at `3d99718` (PASS) →
  19 now with exactly the three `rtl-*` trees as the delta, and quotes the FAIL-side port round trip
  so the assertion is shown falsifiable, not assumed. The fix must be a real assertion: a
  served/bundled mismatch, a missing named fixture, or a lost svn-master load must each be able to
  turn the case red.
- **F2 RULING: plain text, not gzip.** The provenance README must state the trade-off (~169 KB vs an
  unreadable indirection an agent cannot read to understand a failure) so it reads as a decision.
  Check in `d510a16^` texts with commit + sha256 + sizes, pin sha256 inside the tests, tests read the
  fixture and never git. Report records the measured rejection of both alternatives (`.mpd-dsh`
  gitignored + `team-core` has no `lib/tools.js`; registry-strip cannot restore REPLACEMENT-shaped
  regions and would corrupt three tests' premises). Conditions: (1) the falsifiability probe (break
  one region on a scratch copy → red) is quoted in the report; (2) change confined to
  `self-fix-tests/**`, `lib/**` and `lib/mpd-deltas.js` untouched, and the report states this is the
  adopted-upstream tree where only the test surface changed.
- **Verify, do not assume (execution time)**: adding `self-fix-tests/fixtures/**` must NOT invalidate
  `VENDOR_LOCK.json` (it fingerprints the skills corpus and vendored assets; the agent-teams plugin is
  main code). The ONE re-pin owed is for `skills/**`. If the final `node scripts/verify-vendor.mjs`
  disagrees, quote it as a finding — never re-pin twice.
- **F3**: confirmed moot after R3, recorded with t4's raw-log paths; no `--store-dir` added.

## 10. R5 REVERSED — the `rtl-ip` carrier hook is IN SCOPE (R5.2 + R7) — mechanism + ordering

Read the updated rulings (R5.2 rewritten, R7 item 1): the hook IS implemented; C6 must NOT be marked
superseded. Frozen behaviour contract (verbatim from silicon `presets/README.md` §"The t15 hook
contract", a cross-repo read to cite): read at **apply() time** (never import time); resolve
bundle-relatively by walking up to
`node_modules/@mpd-dsh/silicon/presets/rtl-ip.profile.json`, or
`require.resolve('@mpd-dsh/silicon/presets/rtl-ip.profile.json')` when available (preferred); missing
file is NORMAL → `{}`, boot unchanged, no per-boot warning (one debug line at most); corrupt /
non-object JSON must not abort boot → catch, `{}`, log once; merge
`profiles: { ...fromSilicon, mpd: <mpd's own> }` (mpd wins a future collision); `MAX_TEAM_PROFILES =
16` (2 here); do NOT pre-validate member shape — `resolveTeamProfile` already rejects unknown names,
empty/duplicate keys and >16 profiles at create time.
**Proof (C6 clause, not optional):** a real MOUNTING BOOT on a scratch `DSH_HOME` (never
`--dump-config`) showing the `agent-teams` row carrying BOTH `mpd` and `rtl-ip` under
`config.profiles` while `profiles.mpd` keeps the full mpd roster, PLUS the absent-silicon case proving
the `{}` fallback still boots; AGENTS.md §4's mount-proof pattern is the shape.

**Mechanism analysis (measured, read-only):** `packages/mpd-agent-teams-plugin/lib/index.js` consumes
the row config in FOUR places — `:125` (`resolved.profiles`), `:151` (captain prompt),
`:169` (slash command), `:171` (gesture boundary) — and `:53` declares `profiles: z.dict(z.object(...))`,
so the merged object must exist at CONFIG level or every consumer needs its own fix. The patch's
`!!js` expressions (e.g. `:31`) see only `baseUrl`/`process`; a YAML sibling is unreachable, and
schemastery silently keeps unknown keys, so an extra "profilesFrom" key would be a silent no-op.
Candidates: **(A)** one ADDITIVE `mpd-delta` region at the top of `apply(ctx, config)` in
`lib/index.js` that re-binds `config = { ...config, profiles: { ...loadSilicon(), ...(config.profiles ?? {}) } }` —
one region fixes all four consumers, roster stays single-sourced in the patch; cost = first region in
`index.js`, so the registry must be regenerated with
`node scripts/patch-agent-teams-fixes.mjs --write-registry` (D8: never hand-edit) and re-`--check`ed,
and the report must present it as a governed AGENTS.md §6 change. **(B)** move the mpd roster out of
the patch into a bundle-shipped JSON and have a `!!js` expression merge both files — keeps `lib/**`
pristine but relocates data out of the human-readable patch and adds a packed artifact/exports
dependency. **(C)** inline `!!js` expression with the roster embedded — rejected (duplication +
unreadable). **DECIDED: (A)** — captain ruling **R5.3** (captain-rulings.md item 11), on the record so
no future reader re-opens it. Mandatory conditions:
1. Region minimal + additive, carrying a comment that says what it does and why it must run FIRST in
   `apply()` (it is the first region in `index.js`).
2. Registry regenerated with `node scripts/patch-agent-teams-fixes.mjs --write-registry` (never
   hand-edited), `--check` clean afterwards; if the context-pair addressing needs adjusting for a
   region this early, do it the tool's way and say so in the report.
3. Full regression green: `bun test packages`,
   `bun skills/dsh-qa/scripts/agent-teams-dispatch.mjs --self-test`,
   `bun skills/dsh-qa/scripts/agent-teams-sidebar.mjs` — the adopted tree's green suite is the
   evidence that the additive region did not disturb the plugin.
4. R5.2 semantics INSIDE the region per the frozen contract: apply-time read; `require.resolve` of
   `@mpd-dsh/silicon/presets/rtl-ip.profile.json` preferred, bundle-relative walk-up as fallback;
   missing → `{}`, no per-boot warning (one debug line at most); corrupt/non-object JSON → catch,
   `{}`, log once; merge `{ ...loadSilicon(), ...(config.profiles ?? {}) }` so mpd wins a collision.
5. Mount proof still mandatory (real boot: both profiles, roster intact, absent-silicon `{}` run).
6. Report as a governed AGENTS.md §6 change — a NEW adaptation-table entry (**A7** unless the table's
   numbering differs then), naming the region, its marker, and the registry regeneration.
7. Cite the frozen contract's source: SILICON `presets/README.md` §"The t15 hook contract" — a
   cross-repo read a reviewer must be able to trace.
**STOP rule:** if condition 4 cannot be met inside ONE region without changing a second file, stop and
report an honest DEFER with the failing evidence instead of a two-file divergence.

**Ordering (R7 item 5, mandatory):** R1.1's `cli.js` regeneration and R3's `skills/**` retirement
invalidate the same fingerprint → ONE change, ONE `VENDOR_LOCK` re-pin, and the regenerated `cli.js`
must exist BEFORE R6's repack of `dist/mpd-package`. Two re-pins, or repacking the pre-repair
`cli.js`, ships a stale pack.
**R7 wording/labels for the report:** the cross-repo rule is "a QA CASE must not be green while
verifying nothing, and a repo-level guard must not silently pass without its subject" (retire the
cases AND keep `verify-rtl-references.mjs` with SKIP-and-disclose + the local negative invariant);
`docs/adder4.md`/`cnt8.md` exemption recorded (path, AGENTS.md §3 basis, why silicon §5 does not bite,
plus the residual risk that a literal §5 read would delete them); `test:qa` vs `test:qa:all` labelled
a repair-scope decision beyond the extraction (fixes a pre-existing dishonesty t3 measured); F1's red
qualified as **expectation drift** and F2 as pre-existing/unrelated (ancestry + byte-identity proof,
NOT the `raw/bun-test-baseline-3d99718.log`, whose duplicate suite paths and 6-vs-3 counts make it
unfit).

## 11. t5 addendum — installer/build family (J1/J2) + criterion defects (R7.12/R7.13)

Source to cite directly (the manifest/index may not exist yet):
`evidence/rtl-extraction-residual/verify/addendum-gates-and-criteria.md` (+ `false-negative-probes.md`,
`raw/`).

**ITEM 1 — installer/build family (in scope, none of it in t1's 16 defects):**
- **(a) `scripts/install-mcp.mjs:32-35`** `LSP_TARGETS` downloads/installs `verible-verilog-ls` +
  `slang-server`, and `:306` makes the self-test REQUIRE both. Remove those entries and drop the
  self-test's requirement; keep every other server intact. Report the consequence explicitly: after
  this change mpd provisions **no** HDL language server, so silicon owns that provisioning if its LSP
  path must work on a clean machine — the note is what stops it from being a silent capability loss.
- **(b) `scripts/build-mcp.mjs:37-44`** pins `BUILTIN_BUILD_ANCHOR = "mpd-rtl-overlay-v1"` and
  `applyLspOverlay` fails LOUDLY when the anchor is missing. Rename the anchor to a non-RTL name **in
  the same change** and keep the guard functional (a loud guard that stops firing after a rename is
  another "cannot fail" defect). Proof = the build's own success **plus** the failure side (the anchor
  guard still trips when it should).
- **(c) content-only mentions**: `scripts/pack-mpd.mjs:75` (comment naming the verible/slang
  binaries); `package.json:33` (the `verify:rtl-refs` row, kept for the re-pointed gate);
  `.gitignore:23-34` (RTL scratch ignores — `simv_iverilog` is the only RTL-specific pattern;
  `.venv-rtl`/`simv_iverilog` may stay if judged harmless, but say which and why). Correct what is
  honest to correct; record the rest in the keep-with-record list.

**ITEM 2 — acceptance criteria are CORRECTED, not inherited (R7.13):**
- **C7's row check is VACUOUS**: `grep -c '^\| rtl-verif ' skills/dsh-qa/SKILL.md` matches every line
  (73 = the file's line count) because `^` is an alternation branch; the strict row form returns 0.
  Fix it to a strict row test inside whatever corpus probe lands, and state in the report that the
  audit's own contract carried a "cannot fail" check.
- **C7's case-registration clause stays SUPERSEDED by R3** — never reported as passed.
- **C6's remnants are red today** (root `README.md` has zero silicon pointer lines; `git grep
  rtl-ip.profile.json -- packages scripts presets` = 0): report them as **bridge gaps** until the hook
  + mount proof exist.
- Addendum §7 keep-with-record list (string-only fixtures: `self-fix-tests/scope-glob-and-contract`
  sample path, `mpd-workmate-plugin/test`, `mpd-bundle-plugin/test/sidebar-tab`,
  `mpd-bootstrap-plugin/test`, `workmate-library.mjs`, `dual-track-smoke.mjs`,
  `mpd-qa-roles-probe/src/index.ts:34`) and the genuine false positive
  (`skills/frontend/references/design/layout-skill.md:101` — "RTL" = right-to-left) belong in the
  report's exemptions/keep-with-record sections.

## 12. R7.14 — the retained gate's failure channel, measured precisely (SUPERSEDES the SKIP wording)

Read in `captain-rulings.md` item 14. t5's "structurally unreachable" and the Plan Reviewer's measured
`MPD_SILICON_ROOT=/nonexistent …` → exit 1 (3 unresolved) are both right about different cases:
**with the sibling present** the channel is unreachable exactly where it matters (silicon-owned,
mpd-absent paths resolve as "resolved", and `PENDING` pre-absolves every audited residual family);
**with the sibling absent** it does fail today. Binding consequences — the rewrite must be STRICTLY
STRONGER, never weaker, and this replaces every earlier "SKIP-and-disclose" line in this note:

1. The local negative forbidden-path invariant is the POSITIVE mpd-side subject and always runs.
2. Silicon side absent ⇒ the gate still **FAILS (exit 1)** — today's absent-sibling exit 1 must never
   become an exit 0 with a SKIP line.
3. Print `considered` in the **STANDING** run (not only `--self-test`), and make `considered: 0` read as
   a **degraded run**, not a silent PASS (the same C7-vacuity class being fixed in the corpus probe).
4. Keep the `PENDING` buckets and their named owners; if the either-root resolution stays, say in the
   script's own output why it is deliberate.

## 13. R7.15 — two zero-subject guards fixed in this pass (over the reviewer's deferral)

Read in `captain-rulings.md` item 15. Both are IN SCOPE, and the reason must be stated in the report:
these two gates are the instruments this repair uses to prove correctness, so a green from a
zero-subject run is exactly the class the audit exists to expose. The reviewer's recorded
recommendation to defer stays in `review.md` §8 as the dissent (deliberate, not an oversight).
- **Guard-1 (medium) `scripts/verify-rows-parity.mjs`**: with no `- insert:` block in the bundle patch
  and an installer printing nothing it prints `ok: 0 row ids match the bundle patch insert list ()`
  and exits 0. Fix: assert the enumerated subject set is non-empty and name which set was empty.
- **Guard-2 (low-medium) `scripts/verify-vendor.mjs`**: with the lock truncated so `assets` is empty
  (7 → 0) it prints `commit OK / version OK / stats OK / PASS` and exits 0 with zero fingerprints.
  Fix: same minimal subject-count assertion (stats drift stays warning-only).
- Each fix needs a **falsifiability probe in the report**: empty-subject copy → exit 1; real tree →
  exit 0.
- **Classification**: PRE-EXISTING guard-quality defects, explicitly NOT extraction residuals (t6 §6
  C9) — the strip verdict must not be inflated by them.

**Bounding the "cannot fail" family (guard-sweep negative results, cite in the report):** Guard-3 —
exactly 2 of 25 QA cases are skip-capable and both are being retired by R3; NON-instances —
`test:qa` with an empty glob exits 1; `preset-conformance` / `bundle-lifecycle` / `mount-assert` /
`relocate-smoke` have no skip path and assert explicit subjects; `verify-vendor`'s upstream root
fails loudly when absent. Note that `build-mcp.mjs`'s anchor guard failing loudly is the DESIRED
behaviour.
