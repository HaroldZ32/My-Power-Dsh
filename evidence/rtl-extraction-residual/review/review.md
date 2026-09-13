# t6 — adversarial review of the RTL-extraction residual audit before it reaches the user

**Task**: t6 · review round 1 · **Reviewer**: Plan Reviewer (work-plan QA review, read-only)
**Reviewed task**: t5 (independent re-verification of the residual audit) · **attempt**: 1
**Pinned revision (mpd)**: `32ae54dd10db7ea46e1c1263143d56f266fd1f78` (`dev`) — re-checked at the
start and the end of this review; the tracked tree carries no modification from this task (§7).
**Silicon revision referenced**: `bf3dae2` (read-only; the sibling repo was never written to).
**Scope written**: `evidence/rtl-extraction-residual/review/` only (`review.md` + `raw/`).
**Method**: every claim below is answered from my own read or my own command against the pinned
tree; t5's verdict is treated as ONE input, never as the truth. Where I only inspected t5's
evidence, the row says so. Raw outputs: `raw/*.txt` (7 files, listed in §7).

^verdict: pass

*(Plain-language form: the audit's verification work is sound and may proceed to the lead's
synthesis — subject to the eight binding conditions in §6, of which C1 is mandatory before the
report reaches the user. A pass here does not mean the RTL surface is stripped: it is NOT, and no
document may say it is.)*

---

## 1. Coverage table — every surface this review inspected

| # | Surface | What I did (command / read) | Result |
|---|---|---|---|
| 1 | Commit graph and ancestry | `git rev-parse HEAD`, `git log --oneline -6`, 4× `git merge-base --is-ancestor` (`raw/ancestry.txt`) | HEAD = `32ae54dd10d`; `d510a16 ⊂ 3d99718 ⊂ HEAD`; `12291a7 ⊂ HEAD` |
| 2 | Extraction commit `12291a7` | `git show --stat --oneline`, `--name-only`, `git log -1 --format=%B` | removes the 3 `rtl-*` skill trees; touches neither the probe nor the self-fix tests; its own message documents a `20 → 19` threshold update in `bootstrap.test.ts` |
| 3 | `bootstrap.test.ts` threshold | `git show 12291a7 -- packages/mpd-bootstrap-plugin/test/bootstrap.test.ts` (`raw/f1-threshold-history.txt`) | `toBeGreaterThanOrEqual(20)` → `(19)`, with the RTL move as the stated reason |
| 4 | Roles-probe threshold (F1 mechanism) | `sed -n '58p' packages/mpd-qa-roles-probe/src/index.ts`; `sed -n '275,290p' dist/index.js` | `bundled.length >= 20` in source AND in the built twin |
| 5 | Probe/corpus history | `git log --follow` on the probe; `git ls-tree <rev> skills/ \| wc -l` at `9735c5a`, `80d1e54`, `3d99718` (`raw/f1-threshold-history.txt`) | probe added at `9735c5a` with NO catalog check, corpus 19; `>= 20` added at `80d1e54`, corpus 22; corpus 19 at HEAD |
| 6 | F2 subject bytes | `git diff --quiet 3d99718 HEAD -- packages/mpd-agent-teams-plugin/{,self-fix-tests/}`; same for the probe dir (`raw/ancestry.txt`) | plugin tree IDENTICAL; self-fix tests IDENTICAL; probe IDENTICAL |
| 7 | F2 marker premise | `git show 3d99718:…/lib/{tools,quality-gates}.js \| grep -c mpd-delta` | 10 and 14 — the test's "HEAD carries zero markers" premise is already false at the baseline |
| 8 | F2/F1 baseline log | `read` + `grep -n` over `gates/raw/bun-test-baseline-3d99718.log`; `tail` of `bun-test-packages.log` (`raw/f2-baseline-log-anomaly.txt`) | anomaly confirmed: two path spellings for the same suites, 6 fails vs 3 at HEAD for byte-identical files |
| 9 | t4 deliverables | `read` of `gates/gates.md` and `gates/findings.md`; the two raw gate logs | 10 commands inventoried; F1 exit 1 at the pin, exit 0 at the `3d99718` worktree |
| 10 | t4 task record | `agent_teams_task_contract t4` | attempt 3, captain-owned; verdict pass on a **reshaped** acceptance; the reassignment reason states the tree is NOT coherent |
| 11 | t5 deliverables | `read` of `verify/verdict.md` (all 202 lines) and its raw claim logs `claim1…claim5`, `axisA/B`, `checks-A4-A6` | K1–K5 PASS; V1–V9 escalated; A3 UNVERIFIABLE; 13 false-negative probes |
| 12 | t12 closure | task output + `verify/t4-closure.md` | all five gate numbers re-confirmed at the same HEAD; lists `verify-rtl-references` among "three gates green" |
| 13 | Acceptance contract | `read` of `scope/acceptance.md` (§2 buckets, §3 C1–C10 + per-criterion detail, §6 verdict rule) | C6 requires the carrier hook + mounting-boot proof; C7 requires the two RTL cases registered; verdict rule names C6/C7 failures as BRIDGE GAPS |
| 14 | Captain rulings | `read` of `captain-rulings.md` R1–R7 (270 lines) | R5 reversed (hook IS in scope); R7.1–R7.6 resolve H1/H2/M1/M2/ordering/qualifiers |
| 15 | Silicon governance record | `read` of `docs/sync-policy.md` §1/§4/§5 (EN + zh) in the sibling repo | §5 EN+zh: mpd KEEPS the pointer note AND the `rtl-ip` carrier hook; must NOT keep skill trees, verif plugin, LSP overlay, RTL guides, golden fixtures, profile data |
| 16 | Silicon artifact copies | `sha256sum` of 8 mpd files vs their silicon counterparts (`raw/parity-and-dangling.txt`) | all 8 IDENTICAL (4 LSP artifacts + 4 golden Verilog fixtures) |
| 17 | LSP package state | `ls`, `grep -n` README + zh-README, `grep -o` counts on `dist/cli.js`, `sed -n '64,73p' packages/mpd-bundle/cordis.patch.yml` | HDL registrations present in overlay + dist (4 `verible` + 4 `slang-server`); README pair points at `references/{verilog,systemverilog}/README.md`; both paths MISSING; the `mcp-lsp` row launches `dist/cli.js` |
| 18 | `32ae54d` scope | `git show --stat --oneline 32ae54d` | deleted the two HDL reference pages (162 lines) and took the VENDOR_LOCK re-pin |
| 19 | VENDOR_LOCK | `sed -n '39,44p' VENDOR_LOCK.json`; assets/key inspection | per-file `cli.js` sha256 entry exists AND the skills tree fingerprint exists → R1.1's re-pin is mechanically possible |
| 20 | Golden fixtures + consumers | `git ls-files tests/golden/fixtures/verilog`; `git grep 'fixtures/verilog'`; `grep -n '"test"' package.json`; source read of `skills/dsh-qa/scripts/rtl-verif.mjs` (`raw/golden-fixture-consumers.txt`) | 4 tracked files; only doc citations; `bun test packages` never scans `tests/golden`; `rtl-verif.mjs` is NOT a consumer (inline `GOLDEN_ADDER_V`, silicon-rooted paths) |
| 21 | Stale pack | `ls -la dist/mpd-package/skills/lsp-setup/references/{verilog,systemverilog}/README.md`; `find` for `rtl-*` | both HDL pages present (2783 B / 3093 B); the two RTL QA cases also present |
| 22 | t1 ledger rows (V1) | `census.tsv` rows 4368–4370 (`raw/ledger-hook-index-state.txt`) | the three LIVE HDL artifacts are classified `BRIDGE-BY-DESIGN / ACCEPTABLE / none` |
| 23 | C6 hook state | `grep -rn 'rtl-ip' packages/mpd-bundle/cordis.patch.yml presets/`; `grep -rln 'rtl-ip.profile.json'` over plugin sources/scripts (`raw/ledger-hook-index-state.txt`) | nothing — no hook and no `rtl-ip` row exist in mpd at the pin |
| 24 | Case index + doc residue | `grep -n` on `skills/dsh-qa/SKILL.md`; `packages/mpd-bundle/README.md`; `docs/adder4.md:7`, `docs/cnt8.md:7` | `rtl-ip-profile` row at `SKILL.md:62` with no `rtl-verif` row; bundle README names waveform rows; both docs still cite the mpd fixture path |
| 25 | Retained repo gate (V3) | source read (`:24-37,:65-80`); 4 own runs: sibling absent / present / `--json` / `--self-test` (`raw/gate-probe.txt`) | sibling absent → **exit 1, 3 unresolved**; sibling present → exit 0, 42 resolved / 6 pending; the `resolved` bucket holds paths ABSENT from mpd |
| 26 | Repo cleanliness | `git status --short` at the end | only `??` evidence directories; no tracked file modified |
| 27 | Working rules cited | `AGENTS.md` §3 (process records), §4 (gates + MOUNT), §9/§11 (single skills writer / one re-pin), §12 | used for the severity calibration in §5 and the conditions in §6 |
| 28 | Guard corpus (sweep, §8.6) | `ls scripts/*.mjs` (12) + `ls skills/dsh-qa/scripts/*.mjs` (25); grep each for a skip-to-green path and a subject-count assertion (`raw/guard-blind-spot-sweep.txt` §corpus) | 2 of 25 cases skip-capable (both RTL, retired by R3); 3 scripts lack a subject-count guard |
| 29 | `verify-rows-parity.mjs` empty-subject probe | byte-copy in a scratch root + a patch with no `- insert:` block + an installer printing nothing (`raw/guard-blind-spot-sweep.txt` P1) | **`ok: 0 row ids match …`, exit 0** — new blind-spot instance |
| 30 | `verify-vendor.mjs` empty-subject probe | byte-copy in a scratch root + the real lock with `assets` emptied 7→0, real `MPD_UPSTREAM_ROOT` (same file, P2) | **`PASS`, exit 0** with zero fingerprints checked — new instance |
| 31 | `test:qa` empty-corpus probe (counter-argument) | the exact package.json shell loop pointed at an empty directory (same file, P3) | exit 1 — `test:qa` is NOT blind; my counter-argument failed to land |
| 32 | Remaining guard families | skip-path grep over the 23 non-RTL cases + `preset-conformance`/`bundle-lifecycle`/`mount-assert`/`relocate-smoke` assertion shapes; root-resolution scan (same file, P4–P6) | no further instances; the two known skip-capable cases are the whole class |

---

## 2. Steelman matrix — one adversarial counter-argument per defect claim

"Counter-argument verdict" reads: **did not land** (claim survives, my attempt to break it failed),
**partially landed** (claim survives but its scope/wording must change), **landed** (the claim as
written cannot stand). Counter-arguments that FAILED are explicitly kept, per the t6 acceptance.

| Claim | Adversarial counter-argument I built | Counter-argument verdict | What settles it |
|---|---|---|---|
| **F1** corpus 19 < threshold 20 breaks the MOUNT gate, extraction-caused | "It is a pre-existing threshold bug the extraction merely exposed; `>= 20` was never bound to the corpus, so the extraction is not the cause." | **Did not land** | `12291a7`'s own message + diff: the same commit performed the identical `20 → 19` re-baseline in `bootstrap.test.ts` and missed the probe instance. The extraction administered the fix class and left one instance behind. |
| F1 (second angle) | "The probe was red from birth, so nothing was broken by the extraction." | **Did not land** | The probe was added at `9735c5a` with no catalog check at all; `>= 20` arrived at `80d1e54` when the corpus was 22. Green until the extraction. |
| **F2** `bun test packages` 295/3 is pre-existing, not extraction-caused | "The cited baseline run is unfit: its log mixes `.mpd/tmp-baseline-3d99718/…` and real-repo absolute paths for the same assertion and reports 6 failures where HEAD reports 3 for byte-identical files." | **Landed — against the EVIDENCE, not the claim** | The log stays as Deep Worker emitted it (captain's order) and must not be cited. The claim survives on stronger proof: `d510a16 ⊂ 3d99718` (so `git show HEAD:lib/tools.js` already carries 10 markers at the baseline) plus byte-identity of the plugin tree and test files across `3d99718..HEAD`. |
| **F3** the two RTL cases cannot reach a real pass in a sandboxed HOME (pnpm store) | "The cases' subjects are live and their offline self-tests pass, so the 'cannot reach a real pass' framing overstates a harness artifact." | **Partially landed** | t4 already files F3 as an env defect and does not upgrade the cases to PASS. R3 retires the cases, which makes F3 moot for the repair — but the *observability* point stands. |
| **F4** untracked RTL leftovers (`.venv-rtl`, `verible-verilog-ls`) | "Untracked, gitignored artifacts are not repo content, so they cannot be residuals." | **Landed (severity only)** | Already `info` in t4/F4. They remain in scope for the sweep because a packed install must not pick them up (acceptance C8). |
| **K1** the HDL language service is shipped and live | "The registrations are inert: `verible`/`slang-server` only resolve when the executables are on `PATH`, which is environmental, not product." | **Did not land** | Liveness does not depend on PATH: the `mcp-lsp` row launches `dist/cli.js`, the file carries the registrations (4+4 occurrences) and `VENDOR_LOCK` sha-pins those bytes. Registration is content mpd ships. |
| **K2** the LSP README advertises a deleted setup path | "`references/` exists in silicon, so the advertised path is still resolvable." | **Partially landed** | It resolves only against the sibling checkout, which the README does not name, and `skills/lsp-setup/SKILL.md` has been repointed while the package README has not. As written, the claim holds. R1.1's README rewrite is the remedy. |
| **K3** the Verilog fixtures have zero live consumer | "`skills/dsh-qa/scripts/rtl-verif.mjs` consumes them by file name." | **Did not land** | Source read: it embeds `GOLDEN_ADDER_V`/`GOLDEN_ADDER_TB` as constants, writes its own files into a sandbox, and roots every other path at the silicon checkout. t5's raw `claim3` "file-name axis" hit is a false positive (see §4b). |
| K3 (second angle) | "The two docs that cite the fixture path are consumers." | **Landed (scope only)** | Citations are not live consumers; acceptance C5's own consumer scope is `tests packages skills scripts presets`, and those docs are R2/R6 artifacts. |
| **K4/V4** the stale pack would install the deleted HDL pages | "`dist/` is gitignored, so this is not repo content." | **Landed (severity only)** | Correct, and t5 already says so: it is distribution hygiene. It is still a real installable artifact carrying retired assets, and R6/R7.5 order the repack after the repair. |
| **K5/V3** the retained reference gate must not be cited as strip evidence | "The gate is not blind: with the sibling absent it fails." | **Partially landed — my own measurement** | I measured `MPD_SILICON_ROOT=/nonexistent node scripts/verify-rtl-references.mjs` → **exit 1** (3 unresolved). So "the failure channel is structurally unreachable" is too strong in the real layout. What survives: with the sibling present the run is green while `resolved` holds paths ABSENT from mpd (`skills/rtl-codestyle`, `skills/rtl-verif`, `packages/mpd-verif-plugin/…`), and an empty/scratch root passes at `considered: 0`. Conclusion unchanged: it cannot witness strip, and must not be cited as such. |
| **V1** t1's ledger conflicts with R1.1 | "R1.1 supersedes R1 inside the same document, so t8 receives the removal order anyway." | **Partially landed** | The ruling does bind t8, but the audit's own 16-defect ledger still marks the three live HDL artifacts `ACCEPTABLE`, and no ruling requires the repair list to be the union of the ledger and the rulings. That is condition **C1** below. |
| **V2** fixtures and their two docs have three answers across t1/t2/t9 | "The captain's rulings resolve them." | **Landed as a conflict, now disposed** | R6 deletes the fixtures; R7.4 keeps the two docs with the exemption written down. |
| **V5** `SKILL.md:62` advertises the `rtl-ip-profile` case while the case that `test:qa` runs has no row | "A stale index row is cosmetic." | **Landed (low)** | It is a bridge gap by the acceptance contract's own rule; R3/R5 retire the row. |
| **V6** bundle READMEs advertise waveform/verif rows | "Commented-out rows are not capability." | **Landed (low)** | True — but R2's inbound-reference sweep should reach these lines; R7 does not name them (condition **C2** below). |
| **V7** string-only survivors (workmate tests, `.gitignore`, `PLAN.md`, `.silicon-extraction/`) | "Test/string fixtures are not residue at all." | **Landed (info)** | Each must appear in the exemption list with its reason — never a silent omission. |
| **V8** `docs/index{,.zh-CN}.md` still describe the RTL guide as "being moved" | "R2 fixes the index." | **Landed (low)** | R2 does order the index fix; the wording must not survive the doc deletion. |
| **V9** t12 wrote 10 logs into t5's `inScope` directory | "Mixed raw/ directories are harmless." | **Landed (evidence hygiene)** | The verdict must attribute those logs to t12 and must not read `raw/verify-rtl-references.log` as t5 evidence. |
| **H1** R5 (no carrier hook) vs C6 + silicon §5 | "The hook re-introduces silicon capability into mpd." | **Landed — ruling reversed** | R5.2 now implements the hook with the frozen t15 contract; C6 is not superseded. |
| **H2** R3 (retire the cases) vs C7 (they must stay registered) | "C7 is the newer contract, so R3 must fail." | **Landed — C7 clause superseded** | R7.2: mark C7's case-registration clause superseded by R3 on the user's software-type instruction; never report C7 as passed. |
| **M1** R3's "no cross-repo gate" vs the retained sibling-reading guard | — | **Landed — rule re-worded** | R7.3 replaces the absolute rule with "a QA case must not be green while verifying nothing; a repo guard must not silently pass without its subject". |
| **M2** R6 keeps two RTL reference docs while R2 deletes six on the same basis | — | **Landed — exemption recorded** | R7.4 records path, AGENTS.md §3 basis and the literal-§5 deletion risk. |
| **Ordering** R1.1 `cli.js` re-pin + R3 `skills/**` retirement | "Two invalidations may land as two commits." | **Landed — mandatory** | R7.5: one change, one `VENDOR_LOCK` re-pin, regenerated `cli.js` before the R6 repack. |

---

## 3. Requirement-vs-delivery ruling

**The user goal** (from the captain's record of the user's instruction): (a) establish whether the
RTL surface really left `@mpd-dsh/mpd`, (b) repair the confirmed residuals, (c) use software-type
test cases from now on.

**What has been delivered.** An evidence-grounded, falsifiable residual inventory plus rulings:
t1's both-axis sweep (16 in-scope defect paths), t2's acceptance contract on the split's own
governance record, t3's cross-repo parity (73 claimed handover items / 64 landed / 9 missing), t4's
gate coherence measurement (two standing gates red at the pin, root-caused), t5's independent
re-verification (all five post-hoc claims reproduced; V1/V2/V3 escalated), t9's software-type case
standard, and R1–R7. That satisfies (a) and (c) and defines (b).

**What has NOT been delivered.** The strip itself. Residuals are open and measured: the live HDL
registrations in `overlay/lsp/*` + `dist/cli.js`, the dangling LSP README setup path, the six RTL
docs, the two RTL QA cases, the fixtures, the stale pack, and the `rtl-ip` carrier hook that C6
requires and that does not exist in mpd at the pin (verified: no `rtl-ip` hit in the bundle patch or
`presets/`, no `rtl-ip.profile.json` reader in any plugin source). Repair is t8 and its verification
is t11.

**Ruling.** The verification work satisfies the goal; the *outcome* does not, and the user-facing
verdict must be phrased as "extraction verified incomplete; residuals enumerated; repair lane
defined" — never as "the RTL surface is stripped". Against the acceptance contract's verdict rule:

* **C1 and C2 are measured and HOLD at the pin**: `git ls-files skills | wc -l` = 329 with 0
  `rtl-*` tree hits, and `packages/mpd-verif-plugin` is absent.
* **C3, C4 and C5 are measured and FAIL as residuals**, each for its own reason: the HDL template
  `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` is still present (C3), all six RTL docs are
  still present (C4), and the 4 Verilog fixtures are still tracked (C5) — the last one with no live
  consumer, which is what makes deleting it safe rather than what makes it compliant.
* **C6** currently FAILS as a **bridge gap**: no carrier hook exists. Per the verdict rule it must
  be reported in the bridge-gap section, never converted into a pass and never into a residual.
  R7.1 makes it satisfiable; the repair owes the mounting-boot proof (not `--dump-config`).
* **C7**'s case-registration clause is **SUPERSEDED** by R3/R7.2 and must not be reported as passed;
  the rest of C7 (referential integrity of the remaining bridge) still applies.
* **C8** is the stale-pack clause and is currently failing (measured); **C9** stays silicon-side
  (t3, UNVERIFIABLE for t5 and for me); **C10**'s settled-hash discipline is satisfied by t5's
  first/settled hash pair.

**On the audit's headline.** It must carry, as a fact at the pin, "two standing gates red"
(`bundle-lifecycle` exit 1; `bun test packages` 295 pass / 3 fail) with the two qualifiers now in
R7.6, and with a two-line ledger keyed by revision so a post-repair reader cannot mistake the pin's
state for the current one. And it must NOT cite t4-as-reshaped as "guard coherence": t4's own
reassignment reason states the tree is NOT coherent; the correct citation is "the broken-gate
discovery".

---

## 4. Disagreements with t5 (recorded, as instructed)

(a) **V3 is over-stated in one direction.** t5's "the failure channel is structurally unreachable"
and "pre-absolution" generalize from a synthetic scratch root. Measured here: in the real layout
with the sibling absent the gate exits **1**. The accurate statement is t5's other two facts
(green while `resolved` holds mpd-absent paths; `considered: 0` exits 0). Consequence for R7.3:
the chosen fix (skip-and-disclose + a local negative forbidden-path invariant) must keep a positive
mpd-side subject, or it becomes strictly weaker than today's absent-sibling FAIL.

(b) **t5's raw `claim3` file-name axis is a false positive** (`rtl-verif.mjs`). t5's verdict
disposes it correctly at `verdict.md:86-88`; the raw log line can still mislead a later reader, so
the raw log must not be cited as K3 evidence.

(c) **F2 is not re-founded by t5.** It declines to re-run `bun test` and marks only F1's substance;
that is disclosed, but the verdict's F2 sentence must rest on ancestry + byte-identity, not on the
muddled baseline log (R7.6 now says exactly this).

(d) **t5's A4 "PASS on substance" is not a boot re-verification**, and its own §4 says so. The lead
must not let "PASS" in that row travel as a mount result.

I agree with the rest of t5's verdict, including its PASS classifications and its V1/V2/V3
escalation; the two hard contradictions I raised independently (R5↔C6, R3↔C7) were accepted and are
now R7.1/R7.2.

---

## 5. Severity calibration

| Severity | Items | Why this level |
|---|---|---|
| **Blocker for the user report** (must be stated, not softened) | F1 and F2 red at the pin; C6 open bridge gap (no carrier hook); C7 clause superseded, not passed; the V1 classification conflict on the only live RTL capability | Each one changes what the user is told about "done" or what the repair must contain. None of them is a reason to withhold the report — they are reasons the report must be written precisely. |
| **High (repair content)** | K1/V1 live HDL registrations; K2 dangling README; K5/V3 no-citation rule; R1.1 regeneration + behaviour check | These are the residuals that carry live capability or a false signal. |
| **Medium** | K4/V4 stale pack; V5 index row; R7.5 ordering (one commit, one re-pin) | Real but bounded; a mistake here ships a stale artifact rather than wrong software. |
| **Low / info** | V6 text residue; V7 string survivors; V8 docs index wording; V9 evidence attribution; F4 untracked leftovers | Record-and-disclose items; none may be silently omitted. |
| **Not a defect** | The audit's own process artifacts (`.silicon-extraction/`, `PLAN.md`, historical `evidence/rtl-verif/**`, baseline logs) | Process records per `AGENTS.md` §3; the baseline log stays exactly as emitted even though it is unfit as proof. |

---

## 6. Binding conditions on the lead's synthesis (t7) and the repair (t8)

1. **C1 (mandatory before the user sees the report).** Build the repair list as the **reconciliation**
   of t1's census coverage, acceptance C1–C10, and the R1–R7 dispositions — census coverage kept so
   nothing t1 found is dropped (including findings no ruling covers: the J1/J2 class and the V7
   keep-with-record string hits), ruling dispositions applied to every path they name, and where the
   two disagree the ruling wins. Specifically: `census.tsv:4368-4370` still classifies
   `overlay/lsp/{server-definitions,language-mappings}.ts` and `dist/cli.js` as
   `BRIDGE-BY-DESIGN / ACCEPTABLE / none`; R1.1 orders them removed. The only LIVE RTL capability in
   the tree must not be missing from the repair list.
2. **C2.** Carry V6 (bundle README waveform/`verif` residue), V7 (exemption list), V8 (docs index
   wording) and V9 (log attribution) into the repair report; R7 does not name V6/V7/V9.
3. **C3.** Report the two gates with the R7.6 qualifiers and a revision-keyed ledger (§3).
4. **C4.** C6 must be reported as an OPEN bridge gap until R5.2's mounting-boot proof exists
   (sibling-present and sibling-absent cases), and must not be marked superseded. It is red on
   **both** allow-list remnants, measured: the hook (no mpd-side reader) AND the pointer note
   (`grep -ci silicon README.md` = 0). See §9.1.
5. **C5.** Mark C7's case-registration clause superseded by R3 (R7.2); never report C7 as passed —
   and record why the clause could not witness anything even before retirement: its own check is
   vacuous as shipped (the literal `grep -c '^\| rtl-verif '` returns all 73 lines of `SKILL.md`,
   while the strict form returns 0 and no `rtl-verif` row exists). See §9.1.
6. **C6.** Never cite `scripts/verify-rtl-references.mjs` as strip evidence, and carry t12's
   "three gates green" only as per-command results — its `verify-rtl-references` line is not a
   strip-coherence signal (V3, K5).
7. **C7.** Cite t4 as "the broken-gate discovery", never as guard coherence.
8. **C8.** Keep R7.5's ordering visible in the repair plan: R1.1's regenerated `cli.js` must still
   initialize and answer `tools/list` with the non-HDL builtin count unchanged, one commit, one
   `VENDOR_LOCK` re-pin, repack after.
9. **C9 (sweep findings, new).** Carry Guard-1 and Guard-2 from §8.6 into the report as
   **pre-existing guard-quality findings, explicitly NOT extraction residuals**. They are measured
   at the pin but on paths the extraction never touched; they must not silently enter t8's residual
   scope without a captain ruling. If the captain folds Guard-1 into t8 (it sits on the repair path),
   count it as a repair-scope decision the way R7.5 labels `test:qa`.
10. **C10.** The addendum in §8 was written after t6's terminal record; the report must cite
   review.md as one document while noting that R7.7–R7.10 are the captain's adjudications over it,
   not review-authored rulings.
11. **C11 (formal-verdict ownership).** `verify/addendum-gates-and-criteria.md` must be part of the
    formal verdict: t7 cites it **by name and attributed** (t5's owner, distinct from
    `verdict.md`), and t8's list carries its new residual family (section 9.1). Both t5 and t6 are
    immutable, so the captain owns the ledger call - a follow-up task, or an explicit fold into
    t7/t8; this review cannot create it.

---

## 7. Acceptance mapping, artifacts and cleanliness

| t6 acceptance criterion | Status | Evidence |
|---|---|---|
| `review.md` contains the steelman matrix, coverage table, requirement-vs-delivery ruling, severity calibration and an explicit `^verdict:` line | met | §2, §1, §3, §5, and the `^verdict: pass` line above |
| The coverage table names every inspected surface with the command or read behind each row | met | §1, 27 rows, each with its command/read and the raw file or source location |
| At least one adversarial counter-argument is recorded per defect claim, including the ones that fail | met | §2, 26 rows across F1–F4, K1–K5, V1–V9, H1/H2/M1/M2 and the ordering item; four counter-arguments did **not** land and are kept as such |
| No repo file is modified | met | `git status --short` below; only `?? evidence/…` (see `raw/` of this task) |

Artifacts written by this task (nothing else):
`evidence/rtl-extraction-residual/review/review.md`,
`evidence/rtl-extraction-residual/review/raw/{ancestry,f1-threshold-history,f2-baseline-log-anomaly,gate-probe,parity-and-dangling,golden-fixture-consumers,ledger-hook-index-state}.txt`.

`git status --short` at the end of this review (HEAD `32ae54dd10d`, unchanged):

```
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-37-13.539Z/
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-43-55.289Z/
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-48-22.924Z/
?? evidence/dsh-qa/preset-conformance/2026-09-13T07-36-29.035Z/
?? evidence/rtl-extraction-residual/
```

No tracked file was modified; the sibling silicon repo was read only
(`docs/sync-policy.md`, artifact hashes) and never written.

---

## 8. Addendum — captain adjudications R7.7–R7.10 and the "guard that cannot fail" sweep

**Provenance.** Sections 1–7 are t6's terminal deliverable (task record: `completed`,
`verdict=pass`, attempt `ad3378f4-…`). This addendum was written **after** that record, at the
captain's direction, so the audit has one citable review instead of a second file that t7 might
miss. It changes no measurement above. Where it disagrees with a sentence above, it says so.

### 8.1 V1 — census bucketing is superseded by R1.1 (R7.7)
* **Adjudicated fact.** `repo-scan/raw/census.tsv:4368-4370` marks
  `packages/mpd-mcp-lsp/dist/cli.js`, `overlay/lsp/language-mappings.ts` and
  `overlay/lsp/server-definitions.ts` as `BRIDGE-BY-DESIGN / ACCEPTABLE / none`. That judgement is
  **SUPERSEDED by R1.1**. The census is a *discovery input* — an exhaustive inventory whose
  bucketing is provisional; the captain's rulings are the *contract*. **t1's census found the paths
  and its bucketing of these three is superseded by R1.1; the repair list reconciles BOTH — census
  coverage plus ruling dispositions — and where the two disagree, the ruling wins.** Deriving the
  list from the census *buckets* alone is what would have dropped the live capability; treating the
  census as unusable would be equally wrong, because t8's scope still includes t1's discoveries that
  no ruling covers (the J1/J2 class and the keep-with-record string hits in V7).
* **Why the census was wrong on those three paths** (keep this visible, do not smooth it):
  liveness. The bundle's `mcp-lsp` row launches exactly `dist/cli.js`, and
  `VENDOR_LOCK.json:39-43` sha-pins those bytes — the HDL service is **MOUNTED**, not dormant
  source. Category lookup cannot see mounting; only liveness can.
* **Disagreement, on the record.** The census's `ACCEPTABLE` verdict is a false negative that would
  have omitted the only live RTL capability from the repair list had the rulings not overridden it.
  If the sweep is ever re-run, its bucketing rule needs a liveness test at the point of
  classification, not a later correction in a rulings file.

### 8.2 V2 — one answer per artifact (R7.8)
* `tests/golden/fixtures/verilog/**` (4 tracked files) is **DELETED**: §5 names "the golden
  fixtures", silicon holds all four byte-identically (verified — `raw/parity-and-dangling.txt`), and
  the consumer search found zero live mpd consumer (§1 row 20).
* `docs/adder4.md` + `docs/cnt8.md` **STAY** as internal QA/golden reference records under the
  `AGENTS.md` §3 exemption, with their `Source file:` lines repointed at the silicon path plus a
  moved-note. The rationale is now on the record so a future literal re-read of §5 does not have to
  guess: §5 governs RTL **product capability**; a doc describing a golden reference design is
  internal QA provenance whose content already lives in silicon — and these two are the **named,
  deliberate exception** if the owner ever reads §5 literally.
* My earlier M2 condition is satisfied as written: the repointed path resolves only with a sibling
  checkout present, and the moved-note is what covers the absent case.

### 8.3 V3 — the reference gate may never carry the strip claim (R7.9)
Accepted as a hard rule. `scripts/verify-rtl-references.mjs` may be reported green **only as a
current-health fact**, never as coherence for the strip. The reason is the t5 demos plus my own
measurement (§4a): `considered: 0` → `PASS`; the same token with opposite ownership in the same
bucket; `resolved` holding five MPD-ABSENT tokens; `PENDING` pre-absolution of every audited family;
and — the correction I added — the real layout still **fails loudly** (exit 1) when the sibling is
absent, so the blindness is "green while its subject is not mpd", not "cannot fail at all". The gate
earns evidentiary weight back only after **t8 re-points it and t11 re-measures it in that state**.

### 8.4 V9 — evidence attribution (R7.10)
Raw files are attributed per `verify/raw/t5-raw-manifest.md`; no task rewrites another's evidence.
This review touches neither `gates/raw/**` nor `verify/raw/**`; its own captures live in
`review/raw/**`.

### 8.5 My two folded-in disagreements
* **F2** rests on **ancestry + byte-identity**: `d510a16` is an ancestor of `3d99718`, so the
  baseline worktree's `git show HEAD:packages/mpd-agent-teams-plugin/lib/tools.js` already carries
  the 10 `mpd-delta` markers, and the plugin tree and self-fix tests are byte-identical across
  `3d99718..HEAD`. `gates/raw/bun-test-baseline-3d99718.log` **stays exactly as emitted** and must
  not be cited; its anomaly (two path spellings for the same suites, 6-vs-3 failures for
  byte-identical files) is recorded in §7 and `raw/f2-baseline-log-anomaly.txt`.
* The **`rtl-verif.mjs` "file-name axis" hit is a false positive** — it writes its own inline
  `GOLDEN_ADDER_V`/`GOLDEN_ADDER_TB` into a sandbox and roots its other paths at the silicon
  checkout; it never reads `tests/golden/fixtures/verilog`.

### 8.6 The sweep — does any OTHER retained guard have the same blind spot?

**Question.** A standing run that (i) treats an empty subject set as PASS, (ii) resolves its
subjects against a root that is not mpd, or (iii) silently SKIPs to green on the standing path.
**Method.** Enumerated the `AGENTS.md` §4 gate set + all 12 `scripts/*.mjs` + all 25
`skills/dsh-qa/scripts/*.mjs`; grepped each for a skip-to-green path and for a subject-count
assertion; then ran four falsifiability probes in scratch copies (no repo modification). Raw:
`raw/guard-blind-spot-sweep.txt`.

| Id | Guard | Probe | Result | Class |
|---|---|---|---|---|
| **Guard-1 (new, medium)** | `scripts/verify-rows-parity.mjs` | byte-copy + a patch with **no `- insert:` block** + an installer that prints nothing | `[verify-rows-parity] ok: 0 row ids match the bundle patch insert list ()` → **exit 0** | empty subject set = PASS; the count is *printed* but never asserted, so every consumer of the exit code (CI, agents, t4/t12's "gates green" lists) reads PASS. Reachable only when **both** parsers come up empty (one-sided drift fails loudly via `extra`/`missing`), which is why it has never fired. Silicon §4 names this gate as the one to update with a corpus deletion, so it sits on the repair path. |
| **Guard-2 (new, low-medium)** | `scripts/verify-vendor.mjs` | byte-copy + the real `VENDOR_LOCK.json` with `assets` emptied 7→0, real `MPD_UPSTREAM_ROOT` | `commit OK / version OK / stats OK / [verify-vendor] PASS` → **exit 0** with **zero** fingerprints checked | `for (const [rel, meta] of Object.entries(lock.assets \|\| {}))` — an empty/absent `assets` map silently deletes the whole asset-verification stage (stats drift is a warning-only check by design). Reachable by a truncated or hand-edited lock, not by ordinary drift. |
| **Guard-3 (known, contained)** | `rtl-verif.mjs` (7 `skip()` sites), `rtl-ip-profile.mjs` (5) | `MPD_SILICON_ROOT=/nonexistent … --self-test` | both **exit 0** with a printed `SKIP` | Exactly **2 of 25** cases are skip-capable; R3 retires both. The class does **not** extend to the other 23. |
| Not an instance | `bun run test:qa` empty corpus | the exact package.json shell loop pointed at an empty directory | **exit 1** — the POSIX shell passes the unmatched glob literally, `bun` fails on it, `\|\| { … exit 1; }` fires | **My counter-argument failed to land** (kept per the t6 acceptance): no blind spot. |
| Not an instance | `preset-conformance`, `bundle-lifecycle`, `mount-assert`, `relocate-smoke` | source read + skip-path grep | no skip path; each asserts explicit subjects (31/31 rows, the bundle list, `WORKMATE_TOOLS` 7/7) rather than a count of whatever it found | no blind spot |
| Not an instance | `verify-vendor` / `build-mcp.mjs` roots | root-resolution scan (`../../..` fallback, `MPD_UPSTREAM_ROOT`) | `verify-vendor` **fails loudly** when the checkout is absent (`FAIL - upstream checkout not found`) | subject lives outside mpd by design, but cannot pass without one |
| Note for t8 | `build-mcp.mjs` R1.1 path | source read | the `mpd-rtl-overlay-v1` anchor must exist in **both** the overlay and the applied source or the build **fails loudly** | relevant to R1.1: removing the HDL rows must keep the anchor contract coherent, else the build fails loudly rather than shipping a silently wrong `cli.js` |

**Recommendation (not a residual).** Guard-1 and Guard-2 are one-line hardening changes
(`installerSet.size >= 1` / no-insert-block failure; `Object.keys(lock.assets).length >= 1`). Both
are pre-existing guard quality on paths the extraction never touched; per the L1 lesson they belong
in a follow-up change with their own evidence, not silently folded into t8's residual repair. The
captain owns that scope call — hence condition C9.

---

## 9. Addendum 2 — t5's `verify/addendum-gates-and-criteria.md`, independently adjudicated

**Provenance.** t5 is immutable (`completed`, `verdict=pass`, attempt 1), so its owner filed the
later captain-requested re-measurement as a **new file**, `verify/addendum-gates-and-criteria.md`,
and left `verdict.md` + `false-negative-probes.md` untouched rather than rewriting what I was
reviewing. That is the right call and it matches what I had to do for t6 (§8). Sections 1–8 stand
unchanged; this section is my own check of that addendum and is written after t6's terminal record. **Hash discipline:** I read the 11766-byte state at 15:49; the file is now 155 lines / 12726 bytes / md5 `186ab3f6ce8fa62f84cddb75fefdcea4` (15:57:33). The delta is §8 bookkeeping (tree state + raw-log inventory) and every claim adjudicated below is still present verbatim, so these verdicts stand against either state — but a citation must name the hash it read.

### 9.1 What I independently reproduced (my commands, not theirs)

| Addendum item | My check | Result |
|---|---|---|
| Both red gates re-run | Not re-run by me as a boot; I re-measured F1's substance (corpus 19 vs `>= 20`, §1 rows 4–5) and F2's proof (ancestry + byte-identity, §1 rows 6–8); t12 re-ran all five at the same HEAD | **agree** — numbers match t4/t12 and the addendum |
| The two RTL cases SKIP → exit 0 | `MPD_SILICON_ROOT=/nonexistent bun skills/dsh-qa/scripts/{rtl-verif,rtl-ip-profile}.mjs --self-test` | **exit 0 both** (§8.6 Guard-3); agree |
| **C7's registration sub-check is vacuous** | `grep -c '^\| rtl-verif ' skills/dsh-qa/SKILL.md` → **73** (the whole 73-line file: GNU BRE treats `\|` as alternation, so `^` matches every line); strict form `grep -c '^| rtl-verif '` → **0**; `grep -n rtl-verif skills/dsh-qa/SKILL.md` → **no row at all** | **confirmed**, with one precision correction: the bare pattern without the escape returns the correct 0, so the defect is that the criterion ships a copy-paste form that is vacuous, not that the language is unverifiable |
| **C6 red on both remnants** | `grep -ci silicon README.md` → **0** (pointer note absent); `git grep -n rtl-ip.profile.json -- . ':!evidence'` → 4 hits, **all inside the two to-be-retired cases** (`rtl-ip-profile.mjs:24`, `rtl-verif.mjs:36`) and resolvable only against the silicon root | **confirmed** — no mpd-side reader, and no pointer note either |
| C8 pack scan | `find dist/mpd-package \( -path '*rtl-*' -o -path '*mpd-verif*' -o -path '*verilog*' -o -path '*systemverilog*' \)` | **6 paths exactly**: the two retired-case scripts, both HDL reference dirs and their two READMEs |
| New residual family | `install-mcp.mjs:32-35` (`LSP_TARGETS` = `verible-verilog-ls` + `slang-server`; `:306` self-test *requires* both) and `pack-mpd.mjs:75-77` (that installer is copied into the release artifact); `build-mcp.mjs:40` `BUILTIN_BUILD_ANCHOR = "mpd-rtl-overlay-v1"` with loud guards at `:58-59` / `:73-74`; `package.json:33` `verify:rtl-refs`; `.gitignore:23-34` | **all confirmed** — and all invisible to a filename-axis sweep |
| False positive | `skills/frontend/references/design/layout-skill.md:101` — "if the app supports RTL, the layout uses logical properties" (CSS right-to-left) | **confirmed false positive**; must never enter the residual ledger |

### 9.2 What this changes in the review

* **C4 (C6)** widened: the bridge gap is red on **both** allow-list remnants — the hook *and* the
  pointer note — so the repair owes both halves plus the mounting-boot proof.
* **C5 (C7)** widened: the clause is superseded by R3 *and* its own check could never have failed,
  so "reported as passed" stays forbidden for a second, independent reason.
* **C1 reconciliation** gains the addendum's family: these are discoveries no ruling names, so under
  R7.7 they enter t8's scope as census-class coverage, not by bucket. Two of them carry repair
  constraints rather than mere deletions: R1.1's regeneration must keep or rename
  `mpd-rtl-overlay-v1` coherently (otherwise `build-mcp.mjs` fails loudly — loud is acceptable,
  silent is not), and the HDL toolchain installer plus the `verify:rtl-refs` script row need
  explicit dispositions (the installer also ships inside the release artifact via `pack-mpd.mjs`).
* **Verdict unchanged**: `^verdict: pass` — these are added findings and conditions, not blockers
  for t7.

### 9.3 Divergences and convergences

* One precision divergence, recorded above: the "vacuous" characterisation is right about the
  shipped escape form and must not be widened into "the pattern cannot work".
* Independent convergence worth noting (not duplication): the addendum reached the two skip-capable
  cases, the six pack paths and the `mpd-rtl-overlay-v1` repair constraint by its own runs, while
  §8.6 reached the same points from the guard-side sweep. Two different entry points, same result.

### 9.4 The addendum's own question — must it be part of the formal verdict?

**Yes.** t7 must cite `verify/addendum-gates-and-criteria.md` by name and attribution (it is t5's
owner's work, filed separately from `verdict.md`), and t8's repair list must carry its new residual
family. Because t5 and t6 are both immutable now, the ledger entry is the captain's call — hence
condition **C11**.

^verdict: pass
