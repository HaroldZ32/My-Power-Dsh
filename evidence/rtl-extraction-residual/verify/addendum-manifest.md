# The two post-completion addenda — manifest, provenance and numbered claim index

**Filed by**: Architect (task t13, kind `work`, read-only role) · **First filed**: 2026-09-13 15:53 · **Extended**: under the captain's direction (t13 scope change: the manifest now covers both addenda)
**Subjects (read-only here)**: (1) `verify/addendum-gates-and-criteria.md` — the **t5** extension; (2) `review/review.md` **§8** — the **t6** addendum (+ `review/raw/guard-blind-spot-sweep.txt` and `review/raw/sweep/**`)
**Pin**: mpd `32ae54dd10db7ea46e1c1263143d56f266fd1f78` (`dev`) · silicon `bf3dae2530949d9fe410cec9b25b5581bdbcc58e`
**Purpose**: give **both** post-terminal addenda one formal, citable home — provenance, an `A1..An` index per addendum, the raw path that carries each claim, the hash lineage, and the open-item ownership — so the lead's report (t7), the repair (t8) and its verification (t11) can cite them without re-opening or re-editing a terminal task's deliverable.

This file is a pointer/manifest only. It re-measures nothing, re-interprets nothing and extends neither addendum. Every claim below belongs to its producing task; the raw path is where the measurement lives.

> **Line numbers are hash-relative.** `review/review.md` was still being edited when this index was written (see §4). Section anchors (`§8.1`, `C9`, …) are stable; the line numbers given are valid only for the hash printed next to them. **Cite the hash you read.**

> **FROZEN at this revision (v3).** No further edits are made by the owner; **corrections go to the captain as messages** and are applied by the captain's direction, never silently. The frozen bytes/sha256 of this file are reported to the captain and are intended to be pinned in `captain-attestation.md` when that captain-owned record is next refreshed; this file does not pin itself (a self-referential hash is the one pin that can never be verified).

---

## 1. Provenance and the two ledger facts

### 1.1 The two ledger facts — one line each (so no later reader is confused)

* **Fact 1 — the t5 addendum exists because a wake arrived after completion:** `verify/addendum-gates-and-criteria.md` was produced *after* t5 had reached a terminal `verdict=pass`, because the captain's follow-up probe request arrived when the task could no longer be re-claimed; it does **not** change t5's verdict and is an extension of the evidence base under the captain's rulings.
* **Fact 2 — the t6 §8 addendum exists for the same reason:** `review/review.md` §8 was appended (and §8.1 + §6 C1 later reworded) *after* t6 had reached its terminal `verdict=pass`, because the captain's adjudications R7.7–R7.10 and a probe request arrived when the task was terminal; it does **not** change t6's verdict and is likewise an extension of the evidence base under the captain's rulings.

### 1.2 Addendum 1 (t5) provenance

| Fact | Value |
|---|---|
| Originating task / attempt | **t5** (independent re-verification), **attempt 1**, terminal with `verdict=pass` |
| Pin at production | mpd `32ae54dd10db7ea46e1c1263143d56f266fd1f78` |
| Author | the t5 verifier (Reviewer role, same member session) |
| Produced at | `2026-09-13 15:49:58 +0800` (file mtime), i.e. **after** `verify/verdict.md` (`15:47:02`) and **before** `review/review.md` (`15:50:05`) |
| Why it exists | the captain's wake asking for extra probes arrived **after** t5 was already terminal; the scheduler correctly refuses to re-claim a terminal task, and t6 had already started reviewing. Rather than re-open or edit t5's reviewed deliverables, the new measurements were filed as an addendum **in the same `inScope` directory** (`verify/`). Declared in the addendum itself at `addendum-gates-and-criteria.md:3-7`. |
| Effect on t5's verdict | **none** — it does not change the t5 verdict; it extends the evidence base (addendum `:6-7`) |
| Contract hook | t13: "Manifest and index the t5 addendum so it is citable evidence" |

### 1.3 Addendum 2 (t6) provenance

| Fact | Value |
|---|---|
| Originating task / attempt | **t6** (adversarial review), **attempt 1**, terminal `verdict=pass` (attempt `ad3378f4-…`, per `review.md` §8 provenance) |
| Artifact | `review/review.md` **§8** ("Addendum — captain adjudications R7.7–R7.10 and the 'guard that cannot fail' sweep"), §8.1–§8.6 |
| Raw evidence | `review/raw/guard-blind-spot-sweep.txt` + `review/raw/sweep/{p1,p2,p3}/**` (t6's own captures) |
| Produced at | after t6's terminal record; lineage **225 → 326 → 333 → 338 (in-flight, superseded in the same edit sequence) → 395 (FROZEN)** — the single authoritative chain and the frozen identity are in §4 |
| Why it exists | the captain's adjudications R7.7–R7.10 and a probe request arrived **after** t6 was terminal; rather than open a second file t7 might miss, the material was appended as a labelled §8 of the same review. Declared at `review.md` §8 provenance (lines 253–258). |
| Effect on t6's verdict | **none** — `^verdict: pass` remains at the start and the end of the file |
| Contract hook | t13 scope change: "it now covers TWO addenda" (captain, by mail) |

---

## 2. Addendum 1 (t5) — numbered index `A1..A22`

Index convention: `A<n>` is a claim of addendum 1, citable as `addendum 1 A<n>` with this file as the pointer. "Raw" = the log under `verify/raw/` that carries the measurement. Ownership of `verify/raw/` is mixed — see §7 before citing anything.

### A · Gate re-runs (the addendum's §1, `addendum-gates-and-criteria.md:20-31`)

| Id | Claim | Raw |
|---|---|---|
| A1 | `node scripts/verify-vendor.mjs` → **exit 0**, `[verify-vendor] PASS` | `raw/g5-verify-vendor.log`, `raw/g5-exits.txt`, `raw/g5-summary.log` |
| A2 | `node scripts/verify-rows-parity.mjs` → **exit 0**, `21 row ids match the bundle patch insert list` | `raw/g5-verify-rows-parity.log`, `raw/g5-exits.txt` |
| A3 | `node scripts/verify-rtl-references.mjs` → **exit 0**, `PASS — 42 resolved, 6 pending-by-design, 0 unresolved` | `raw/g5-verify-rtl-references.log`, `raw/g5-exits.txt` |
| A4 | `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` → **exit 1**, `ok=false`, `[roles-probe] SKILLS=19 BUNDLED=19` then `FAIL` — the RED is **reproduced**, not quoted | `raw/g5-bundle-lifecycle.log`, `raw/g5-exits.txt`, `raw/g5-summary.log` |
| A5 | `bun test packages` → **exit 1**, `295 pass / 3 fail`, `Ran 298 tests across 64 files` (the same three agent-teams self-fix names) — RED **reproduced** | `raw/g5-bun-test-packages.log`, `raw/g5-exits.txt`, `raw/g5-summary.log` |
| A6 | The five gate exit codes are recorded as a set: `verify-vendor 0`, `verify-rows-parity 0`, `verify-rtl-references 0`, `bundle-lifecycle 1`, `bun-test-packages 1` | `raw/g5-exits.txt` |

### B · Re-derived surfaces (the addendum's §2–§3, `:33-53`)

| Id | Claim | Raw |
|---|---|---|
| A7 | All six stranded RTL docs are tracked, content-heavy and present: `rtl-verif-guide{,.zh-CN}` 159/167 token hits, `rtl-ip-flow-guide{,.zh-CN}` 20/19, `rtl-gap-assessment{,.zh-CN}` 149/149; `ls docs/rtl-*.md \| wc -l` = 6; `rtl-verif-guide.md:20` documents the eight `mpd_verif_*` tools as a live row that no longer exists | `raw/supp-six-docs-and-skip.log` |
| A8 | With `MPD_SILICON_ROOT=/nonexistent/mpd-silicon`, **both RTL cases were executed** (not quoted): `--self-test` → **exit 0** + `SKIP: silicon bundle not present … (1 group(s) skipped)`; a real (non-self-test) run → **exit 0** printing `SKIP …` then `PASS (nothing to probe: bundle absent)` | `raw/c7-skip-probe.log`, `raw/c7-rtl-verif-selftest.log`, `raw/c7-rtl-verif-nosilicon.log`, `raw/c7-rtl-ip-profile-selftest.log`, `raw/c7-rtl-ip-profile-nosilicon.log`, `raw/c7-gate.out` |
| A9 | Consequence of A8: `bun run test:qa` counts both RTL cases as green while they verify nothing on a machine without the silicon checkout — t1's F2 claim **confirmed by execution** | `raw/c7-skip-probe.log` |

### C · C1–C10 cross-check and the three criterion defects (the addendum's §4, `:55-86`)

| Id | Claim | Raw |
|---|---|---|
| A10 | C1–C10 measured against the tree: C1 HOLDS (329 / no `rtl-*` trees), C2 HOLDS (plugin absent; 7 textual hits = the declared set), **C3 FAILS** (template PRESENT; 12 overlay+dist hits), **C4 FAILS** (six docs present), C5 FAILS/HOLDS (fixtures present; live-consumer hits 0), **C6 FAILS on both remnants**, C7 partially (row sub-check invalid), **C8 FAILS** (6 FULL-STRIP paths in the pack), C9 UNVERIFIABLE (silicon-side), C10 pin HOLDS / ledger equation not reproduced | `raw/criteria-C1-C10.log` |
| A11 | **Criterion defect 1 (C7 vacuity):** the criterion command `grep -c '^\| rtl-verif ' skills/dsh-qa/SKILL.md` treats `^` as an alternation branch, so it matches every line: measured **73**, equal to the file's line count, while the strict row test returns **0** and the `rtl-ip-profile` row returns **1** → the sub-check passes unconditionally and verifies nothing | `raw/criteria-C1-C10.log` (C7 block) |
| A12 | **Criterion defect 2 (C7 superseded):** C7 requires the two RTL cases to exist and print SKIP, while C1–C5 / R3 retire them — a post-repair run of the criterion is impossible as written; it needs re-specification | addendum `:78-81` + `raw/criteria-C1-C10.log` |
| A13 | **Criterion defect 3 (C6 red both ways):** `presets/rtl-ip.profile.json` is correctly absent, but `git grep 'rtl-ip.profile.json' -- packages scripts presets` = **0** (criterion requires ≥1) and `grep -ni silicon README.md` = **0** (criterion requires ≥1); per t2's own verdict rule these are **bridge gaps**, never a residual and never a pass | `raw/criteria-C1-C10.log` (C6 block) |

### D · The new residual family (the addendum's §5, `:88-99`)

| Id | Claim | Raw |
|---|---|---|
| A14 | `scripts/install-mcp.mjs:32-35` — `LSP_TARGETS` downloads/installs **`verible-verilog-ls`** and **`slang-server`** into the toolchain, and `:306` makes the script's self-test **require both** → an mpd-owned HDL installation path; same class as C3, invisible to a name-based sweep | `raw/supp-installer-build-wiring.log`, `raw/p16-classify.log` |
| A15 | `scripts/build-mcp.mjs:37-44` — `BUILTIN_BUILD_ANCHOR = "mpd-rtl-overlay-v1"`, `LSP_OVERLAY_FILES`, and `applyLspOverlay(...)` which **exits 1 loudly** when the overlay or its anchor is missing/stale or the upstream baseline drifted → a **repair constraint**, not an RTL residual: the anchor rename and the guard must change together, and the guard must still trip afterwards | `raw/supp-build-guard.log`, `raw/supp-installer-build-wiring.log` |
| A16 | Content-only mentions with no capability behind them: `scripts/pack-mpd.mjs:75` (comment names the HDL binaries), `package.json:33` (`verify:rtl-refs` row for the re-pointed gate), `.gitignore:23-34` (RTL scratch ignores) → keep-with-record unless a rename is honest | `raw/p16-classify.log`, `raw/p16-full.txt` |

### E · Expanded false-negative probes P14–P20 (the addendum's §6, `:101-111`)

| Id | Claim | Raw |
|---|---|---|
| A17 | P14 extension/case-variant axis (`.V .SV .SVH .VH .vhd .vhdl .f .do .sdc .xdc .fst .vcd .sdf .tcl .qsf .ucf`): **0 tracked, 0 untracked-not-ignored** — nothing-probe | `raw/probes-P14-P20.log` |
| A18 | P15 ignored/untracked leftovers: exactly **2** (`.venv-rtl/` ignored + the audit's own evidence dir); P17 patch/YAML/manifest rows: **0** — nothing-probe | `raw/probes-P14-P20.log` |
| A19 | P16 the axis a name filter misses: **25** content-mention files (authoritative list `raw/p16-full.txt`, 25 lines; the inline block in `raw/probes-P14-P20.log` lists a 20-entry subset — cite `p16-full.txt` for the count) → this axis surfaced §D | `raw/p16-full.txt`, `raw/p16-classify.log`, `raw/probes-P14-P20.log` |
| A20 | P18: `VENDOR_LOCK.json:39` sha-pins `packages/mpd-mcp-lsp/dist/cli.js` — the vendor gate enforces the exact bytes that carry the HDL registrations; P19 `dist/`: **5** paths (2 retired case scripts + both HDL reference dirs + `skills/lsp-setup/scripts/verify-lsp.ts`); P20 skills-corpus README/`SKILL.md`: exactly **1** file (`skills/lsp-setup/SKILL.md`, already correctly repointed at silicon) | `raw/probes-P14-P20.log` |
| A21 | Content-only survivor classification (keep-with-record, never a silent omission): process records (`PLAN.md`, `.silicon-extraction/removal.log`, `t5-closure-evidence/*`, `docs/review-p0-p3.md`, `docs/track-a-report.md`, `AGENTS.md:139`); string-only test/sample fixtures (agent-teams self-fix test, workmate tests, bootstrap test, `workmate-library.mjs`, `dual-track-smoke.mjs`, `packages/mpd-qa-roles-probe/src/index.ts:34`); **genuine false positive** — `skills/frontend/references/design/layout-skill.md:101`, where "RTL" means *right-to-left* layout and must not enter any residual ledger | `raw/p16-classify.log`, `raw/p16-full.txt` |

### F · Tree state after the addendum round (the addendum's §8, `:129-144`)

| Id | Claim | Raw |
|---|---|---|
| A22 | `git status --porcelain` = **5** untracked entries, **zero tracked modifications**; `HEAD` still `32ae54dd…`; the seven subject hashes were untouched by the round; the addendum's own raw set is `g5-*.log`, `g5-exits.txt`, `g5-summary.log`, `supp-*.log`, `criteria-C1-C10.log`, `c7-*.log`, `probes-P14-P20.log`, `p16-*.{txt,log}` | `raw/g5-summary.log` §"tree after my gate runs"; addendum `:129-144` |

---

## 3. Addendum 2 (t6) — numbered index `A23..A34`

Citable as `addendum 2 A<n>` with this file as the pointer. Anchors are given as section + line range **at the `review.md` hash printed in §4**; `review/raw/**` is t6's own tree (see §7).

| Id | Claim | Where it lives (review.md + raw) |
|---|---|---|
| A23 | **(a) V1 — census bucketing is superseded by R1.1 (R7.7).** `repo-scan/raw/census.tsv:4368-4370` marks `dist/cli.js` + `overlay/lsp/{server-definitions,language-mappings}.ts` as `BRIDGE-BY-DESIGN / ACCEPTABLE / none`; that judgement is **SUPERSEDED by R1.1**. The census is a *discovery input*, the rulings are the *contract*; the repair list reconciles both and **the ruling wins on conflict**. Why the census was wrong (kept visible, not smoothed): **liveness** — the bundle's `mcp-lsp` row launches exactly `dist/cli.js` and `VENDOR_LOCK.json:39-43` sha-pins those bytes, so the HDL service is **MOUNTED**, not dormant source; category lookup cannot see mounting. **Reviewer's disagreement kept on the record:** the `ACCEPTABLE` verdict was a false negative that would have dropped the only live RTL capability from the repair list; a re-run of the sweep needs a liveness test at classification time, not a later correction in a rulings file. | `review.md` §8.1 · `repo-scan/raw/census.tsv:4368-4370` · `VENDOR_LOCK.json:39-43` · liveness raw: `verify/raw/claim1-liveness2.log` |
| A24 | **(b) V2 — one answer per artifact (R7.8).** `tests/golden/fixtures/verilog/**` (4 tracked files) is **DELETED** (§5 names "the golden fixtures"; silicon holds all four byte-identically; zero live mpd consumer). `docs/adder4.md` + `docs/cnt8.md` **STAY** as internal QA/golden reference records under the `AGENTS.md` §3 exemption, with their `Source file:` lines repointed at the silicon path plus a moved-note. Rationale on the record: §5 governs RTL **product capability**, and a doc describing a golden reference design is internal QA provenance — these two are the **named, deliberate exception** if §5 is ever read literally. | `review.md` §8.2 · `review/raw/parity-and-dangling.txt` · `review/raw/golden-fixture-consumers.txt` |
| A25 | **(c) V3 — the reference gate may never carry the strip claim (R7.9).** `scripts/verify-rtl-references.mjs` may be reported green **only as a current-health fact**, never as strip coherence: `considered: 0` → PASS; the same token with opposite ownership in the same bucket; `resolved` holding five MPD-ABSENT tokens; `PENDING` pre-absolution of every audited family; **and the correction** — with the sibling absent it *does* fail loudly (exit 1), so the blindness is "green while its subject is not mpd", not "cannot fail at all". Weight returns only after **t8 re-points it and t11 re-measures it** in that state. | `review.md` §8.3 · `verify/raw/demo-blindness-{A,B,B2C}.log`, `verify/raw/claim5-gate-run.log` (t5) · `review/raw/gate-probe.txt` |
| A26 | **(d) V9 — evidence attribution (R7.10).** Raw files are attributed per `verify/raw/t5-raw-manifest.md`; no task rewrites another's evidence. This review touches neither `gates/raw/**` nor `verify/raw/**`; its own captures live in `review/raw/**`. | `review.md` §8.4 · `verify/raw/t5-raw-manifest.md` (incl. the **NOT t5-owned** list) |
| A27 | **(e1) Guard-1 (new, medium) — `scripts/verify-rows-parity.mjs`.** Byte-copy + a patch with **no `- insert:` block** + an installer printing nothing → `[verify-rows-parity] ok: 0 row ids match the bundle patch insert list ()` → **exit 0**. The count is *printed but never asserted*, so every exit-code consumer (CI, agents, the audit's own "gates green" lists) reads PASS. Reachable only when **both** parsers come up empty (one-sided drift fails loudly via `extra`/`missing`). Silicon §4 names this gate as the one to update with a corpus deletion → it sits on the repair path. | `review.md` §8.6 Guard-1 row · `review/raw/guard-blind-spot-sweep.txt` §P1 · `review/raw/sweep/p1/**` |
| A28 | **(e2) Guard-2 (new, low-medium) — `scripts/verify-vendor.mjs`.** Byte-copy + the real lock with `assets` emptied **7 → 0** + real `MPD_UPSTREAM_ROOT` → `commit OK / version OK / stats OK / PASS` → **exit 0 with zero fingerprints checked** (`Object.entries(lock.assets \|\| {})` silently deletes the whole asset stage; stats drift is warning-only by design). Reachable by a truncated or hand-edited lock, not by ordinary drift. | `review.md` §8.6 Guard-2 row · `guard-blind-spot-sweep.txt` §P2 · `review/raw/sweep/p2/**` |
| A29 | **(e3) Guard-3 (known, contained).** Exactly **2 of 25** QA cases are skip-capable — `rtl-verif.mjs` (7 `skip()` sites) and `rtl-ip-profile.mjs` (5) — both **exit 0** with a printed `SKIP` when the sibling is absent; **R3 retires both**; the class does **not** extend to the other 23 cases. | `review.md` §8.6 Guard-3 row · `guard-blind-spot-sweep.txt` §P4/§P5 · `verify/raw/c7-skip-probe.log` (A8) |
| A30 | **(e4) The four counter-arguments that FAILED — kept as negative results.** (1) `bun run test:qa` with an empty corpus glob → **exit 1** (POSIX passes the unmatched glob literally; `bun` fails; the `\|\| { … exit 1; }` fires) — "my counter-argument failed to land"; (2) the four other standing cases (`preset-conformance`, `bundle-lifecycle`, `mount-assert`, `relocate-smoke`) have **no skip path** and assert explicit subjects (31/31 rows, the bundle list, `WORKMATE_TOOLS` 7/7); (3) `verify-vendor` / `build-mcp.mjs` non-mpd subject roots **cannot pass without a subject** (`verify-vendor` fails loudly: `FAIL - upstream checkout not found`); (4) the `rtl-verif.mjs` "file-name axis" hit is a **false positive** — it writes its own inline `GOLDEN_ADDER_V`/`GOLDEN_ADDER_TB` into a sandbox and roots its other paths at silicon; it never reads `tests/golden/fixtures/verilog`. | `review.md` §8.6 "Not an instance" rows + §8.5 · `guard-blind-spot-sweep.txt` §P3/§P6 · `review/raw/sweep/p3/{loop.sh,empty/}` · `review/raw/golden-fixture-consumers.txt` |
| A31 | **(f1) C9 (binding condition) — the sweep findings are NOT extraction residuals.** Guard-1 and Guard-2 must be carried into the report as **pre-existing guard-quality findings**, explicitly **NOT extraction residuals**: measured at the pin, but on paths the extraction never touched; they must not silently enter t8's residual scope without a captain ruling, and if folded in it counts as a repair-scope decision the way R7.5 labels `test:qa`. | `review.md` §6 C9 |
| A32 | **(f2) C10 (binding condition) — the section postdates the terminal record.** §8 was written after t6's terminal record; the report must cite `review.md` as **one document** while noting that R7.7–R7.10 are the **captain's adjudications over it**, not review-authored rulings. | `review.md` §6 C10 |
| A33 | **(g) R7.15 overrules the reviewer's defer recommendation — the guard blind spots are IN SCOPE for the repair.** Guard-1 and Guard-2 get **minimal subject-count assertions** (fail when the enumerated subject set is empty, and say which set was empty) in the same repair pass, each with a falsifiability probe (empty-subject copy → exit 1, non-empty → exit 0); **t8 lands them, t11 re-measures**. The stated reason must be reported wherever this is reported: these two gates are the very instruments the repair uses to prove correctness, so a green from a zero-subject run is exactly the class this audit exists to expose. **The reviewer's own recommendation to defer STANDS IN `review.md` §8 as the dissent.** | `captain-rulings.md` R7.15 (L380–400) · `review.md` §8.6 recommendation |
| A34 | **Provenance/lineage of the t6 addendum itself.** `review.md` §1–§7 are t6's terminal deliverable (`completed`, `verdict=pass`, attempt `ad3378f4-…`); §8 was appended **after** that record at the captain's direction "so the audit has one citable review instead of a second file that t7 might miss"; it "changes no measurement above" and says so where it disagrees. Lineage recorded in §4. | `review.md` §8 provenance, §6 C1, and the `^verdict: pass` lines · `captain-attestation.md` §2.2 |

---

## 4. Byte-identity and hash lineage (read this before citing a hash)

**Recorded as the addendum declares** (`addendum-gates-and-criteria.md:3-7`): to keep t6's reviewed artifact
stable, `verdict.md` and `false-negative-probes.md` were **left byte-identical** to the versions under
review; everything new went into the addendum. **The addendum does not change the t5 verdict.**

Measured basis (this task, read-only) — no downstream reader has to wonder whether the addendum rewrote them:

| File | Lines | mtime | sha256 (measured by t13) |
|---|---|---|---|
| `verify/verdict.md` | 202 | 2026-09-13 15:47:02 | `b527d1103ce3ee36d51366c9ad004770c78746a70453401200c0ab2f90a71a63` |
| `verify/false-negative-probes.md` | 47 | 2026-09-13 15:46:21 | `24aa5ee0ef4e213e887da044be6d37595c12e1b1f5197226f690ef5ac83bf67d` |
| `verify/addendum-gates-and-criteria.md` (**subject — as indexed (r1); point-in-time snapshot**) | 144 | 2026-09-13 15:49:58 | **deferred by design — authoritative revision + fingerprint: `verify/raw/addendum-revision-log.txt`** (r1/r3). Do **not** compare this snapshot against the current file; it is out of the falsification domain below |

* t6's review states it performed a `read` of `verify/verdict.md` **"all 202 lines"** (`review/review.md:36`);
  today's file is **202 lines** — the size the review read.
* Both files' mtimes **precede** the addendum's and the review's mtimes (15:46:21 / 15:47:02 < 15:49:58 < 15:50:05):
  no writer touched them after the review, and the addendum is the only file written between them.
* No earlier hash of either file is recorded anywhere in the audit tree (searched `b527d110…`, `24aa5ee0…`:
  0 hits), so byte-identity is **anchored on the addendum's declaration plus this measurement**, not on a
  pre-review checksum.
* **Falsification check for any later reader** (run from the repo root): the comparison is **defined only
  over the two protected rows** — `verify/verdict.md` and `verify/false-negative-probes.md`. If either hash
  differs from the value recorded above, the byte-identity claim is **falsified** and the difference must be
  attributed before the addendum or the verdict is cited. **Every other row of this table is a labelled
  point-in-time snapshot and lies outside the comparison's domain** — the addendum row defers to
  `verify/raw/addendum-revision-log.txt`, and the `review/review.md` / `verify/addendum-manifest.md` rows
  defer to §4's lineage table and `review/CHANGELOG.md`. A superseded row therefore **cannot raise a false
  alarm**: if a whole-table `sha256sum` sweep flags one, that sweep is applying this instruction outside its
  stated domain, and the flag is a script error rather than evidence of tampering.

---

**Addendum 2 — what can and cannot be proven.** The lineage, stated in full in this one place:
**225 → 326 → 333 → 338 (in-flight, superseded inside the same edit sequence) → 395 (FROZEN)**. That is
the chain `review/CHANGELOG.md` records; rows 1–2 of it have **no** recorded checksum anywhere (no
pre-review hash existed), row 3 is wording-only, row 4 landed §9 with conditions C11 + the C4/C5 widening,
row 5 is fingerprint bookkeeping — authority: `review/CHANGELOG.md` (frozen identity table + the five
revision rows) and `captain-attestation.md` §2.2. What *is* verifiable is the labelled-addendum
discipline: the §8 heading and its provenance paragraph stand in the file, the `^verdict: pass` marker
remains at both the start and the end, and the frozen revision's identity is named in the lineage table
below (`826f9c5b…` / md5 `f3c69a63…` / L13 + L395). **Cite the hash you read; cite `review/CHANGELOG.md`
whenever a downstream document was synthesised against an earlier revision.**

**Post-index revisions (both hosts grew while this index was being written; no finding or verdict changed):**

* **Addendum 1 (t5) → r2 + r3.** r2 corrected the rendering of the C7 "strict check" command in the §4
  defect list (it had been printed in the escaped form it was contrasted against) and added a precision
  note limiting the finding to the shipped escaped form; r3 added the header's **"Attribution /
  formal-verdict status"** block (t6's condition **C11**) and a **§9 Revision log**. The file's own §9
  states it plainly: the fingerprint recorded here for r1 is superseded; use
  `verify/raw/addendum-revision-log.txt` or cite by path. **No finding, severity or verdict changed.**
* **Addendum 2 host (t6) gained a §9.** `review/review.md` §9 ("Addendum 2 — t5's
  `verify/addendum-gates-and-criteria.md`, independently adjudicated", §9.1–§9.4) is a **third**
  post-terminal section: it independently reproduces the t5 addendum's claims and raises condition **C11**
  (the t7 verdict must cite the addendum by name and attribution; t8's repair list must carry §5's residual
  family under the R7.7 reconciliation rule). §9 is **not** covered by the `A23..A34` index, which was
  scoped to §8; if the captain wants §9 indexed too, that is a one-row addition — it is named here so the
  index cannot be mistaken for complete coverage of the file.
* The t5 addendum's own §9 also records the working-tree drift (task t8 in flight) and warns that its
  §1–§7 gate exits are a **pre-repair baseline for the pinned revision**: t11 must re-measure the repaired
  tree rather than compare against them.
* **This manifest itself — v2.2 (Reviewer relay) and v3 (t14, FROZEN).** The Reviewer's read-only relay
  flagged two internally stale rows; the captain's t14 then asked for the safe final form. Applied: the §4
  byte-identity table's addendum row now **defers to `verify/raw/addendum-revision-log.txt`** instead of
  duplicating a moving hash (no fourth generation of the same pin); the falsification instruction is
  **defined only over the two protected t5 rows**, so a superseded snapshot cannot fire a false alarm; the
  `review/review.md` chain is stated in full in one place with the frozen identity named; a **hash-discipline
  note** was added; and the file declares itself **FROZEN** in its header. §8's paste is labelled
  attribution evidence rather than a frozen state. **No claim, no subject-artifact hash and no attribution
  changed.** The hash lineage above records v1 / v2 / v2.2 / v3 so a citation that pins an older value is
  not mistaken for tampering.

| Artifact | Measured state | sha256 |
|---|---|---|
| `verify/verdict.md` (t5, protected) | 202 lines, 21 476 B, mtime 15:47:02 | `b527d1103ce3ee36d51366c9ad004770c78746a70453401200c0ab2f90a71a63` |
| `verify/false-negative-probes.md` (t5, protected) | 47 lines, 7 448 B, mtime 15:46:21 | `24aa5ee0ef4e213e887da044be6d37595c12e1b1f5197226f690ef5ac83bf67d` |
| `verify/addendum-gates-and-criteria.md` (addendum 1) — **as indexed (r1)** | 144 lines, 11 766 B, mtime 15:49:58 | `fada192fb3fc0c1c0a0d0cb1bc393afdb5e200e63bea720ac25eae80888e1cb3` |
| `verify/addendum-gates-and-criteria.md` — **current (r3)** | 181 lines, 14 897 B, mtime 15:58:03 | `596c26b07fae5faeae38843e672e3de2772f2f6cc79b50954390d8b6ebcb6ac2` — authoritative revision log: `verify/raw/addendum-revision-log.txt` (r1/r3 fingerprints + the r2/r3 reasons) |
| `review/review.md` (addendum 2 host) — **attested state** | 333 lines, 36 295 B | `7a346ab7b2c380e38bff01a6f0852414…` (`captain-attestation.md` §1) |
| `review/review.md` — **in-flight state (superseded inside the same edit sequence)** | 338 lines, 36 728 B, mtime 15:55:32 | `77429cbd311056262d740c70291c0dbf5cfe1df70ec134ed77305ab8722e1c1f` |
| `review/review.md` — **FROZEN (carries §8 and §9)** | **395 lines**, 42 475 B, mtime 15:58:04 | sha256 `826f9c5b83df766ba5c7a50d2ef549a7053c5303421035808b9960ef64e83e8b` · md5 `f3c69a63cf6f5275484a94867f73b533` · `^verdict: pass` at **L13** and **L395** · authority: `review/CHANGELOG.md` + `captain-attestation.md` |
| `verify/addendum-manifest.md` — **v1** (t5 addendum only; attested) | 18 533 B, mtime 15:53:08 | `8a859e24a6b31d0bc60bcca1cd1ec39b…` (`captain-attestation.md` §1) |
| `verify/addendum-manifest.md` — **v2** (both addenda) | 38 623 B, mtime 16:01:15 | `2d6bb047d44a2355d017f2448196c6fdd2646a2ef637ae4c2a310df0515f1f98` |
| `verify/addendum-manifest.md` — **v2.2** (Reviewer relay: two stale-row fixes + the §8 snapshot clarification) | 40 488 B, mtime 16:04:04 | `0e3e67056ec459f83b2808664c295736704f5fde4c17cd65e32e9ffcc42d6524` |
| `verify/addendum-manifest.md` — **v3 = THIS REVISION, FROZEN** (t14 residues fixed: the addendum row defers to the revision log, the falsification domain is scoped, the full `review.md` chain + frozen identity sit in one place, the hash-discipline note is added, and the file declares itself frozen; no claim changed. t14, the Researcher-owned fix task, failed on the moving-target condition without writing anything; the captain directed this pass to the manifest's owner) | re-measure with `sha256sum` | cite the hash **you** read — this revision is the freeze point |

**Hash discipline (binding for this ledger — the rule the captain adopted, plus this audit's own instance).**
1. **A pin is valid only for the revision it names.** A path without a revision/hash is not a citation.
2. **A snapshot is labelled with its own time** and is never presented as the current state — that is why
   the addendum row above defers to `verify/raw/addendum-revision-log.txt` instead of re-pinning a hash that
   will move again.
3. **A record composed AFTER its subject's last edit is the preferred form:** it cannot go stale inside the
   same edit sequence. `review/CHANGELOG.md` (composed after `review.md` froze) and
   `verify/raw/addendum-revision-log.txt` (composed after r3) are the two working examples.
4. **A negative verification result is not evidence until the tool's semantics are proven.** A check that
   cannot fail, or that fails for the wrong reason, proves nothing: this audit's instances are the C7
   `^\|`-alternation defect, where the "row check" matched every line (**A11**), and the two zero-subject
   guards that print PASS on an empty subject set (**A27/A28**).

**Reader caution — the attestation's hash column is sha256[:32], not md5**, despite its "md5[:32]" label:
the rows for `verify/verdict.md`, `review/review.md` and `verify/addendum-manifest.md` all match my
`sha256sum` prefixes (`b527d110…`, `7a346ab7…`, `8a859e24…`), while the md5 of `addendum-manifest.md` is
`e8f340582a79869b317e01d6582eda3e`. Comparing with md5 would raise a false "evidence changed" alarm.

**This extension supersedes the attested hash of this file.** `captain-attestation.md` §1 pinned
`verify/addendum-manifest.md` at 18 533 B / `8a859e24…`; the captain then ordered this file to cover both
addenda, so that row now identifies the **pre-extension** state. The lineage is recorded here rather than
silently overwritten: treat 18 533 B / `8a859e24…` as "manifest v1 (t5 addendum only)".

---

## 5. OPEN items — owner and forward pointers (nothing here is a pass)

### 5.1 From addendum 1 (owner: repair t8, per the captain's rulings)

These are the addendum's findings that are **not** passes. Nothing in this task's output reports them as
passed, and the addendum itself records them as defects/findings (addendum `:70-99`). The captain's rulings
already own them: `captain-rulings.md` R7.12 (installer/build family), R7.13 (the three criterion defects),
R7.14 (the retained gate's failure channel).

| Open item | Source claim | Owner / ruling |
|---|---|---|
| C7's registration sub-check is **vacuous** (`^` alternation → 73 = every line) | A11 | repair t8 — R7.13: correct it to a strict row test in the corpus probe; never inherited as a pass |
| C7's case requirement is **superseded** by R3's retirement of the two RTL cases | A12 | repair t8 — R7.13 + R7.2: recorded SUPERSEDED, never passed |
| **C6 red on both allow-list remnants** (no carrier hook; no README pointer note) | A13 | repair t8 — R5.2/R5.3 deliver the hook and the pointer note; reported as bridge gaps until the mount proof exists |
| **New residual family**: `scripts/install-mcp.mjs:32-35` provisions the HDL language servers and `:306` requires them in its self-test | A14 | repair t8 — R7.12: mpd stops provisioning HDL servers; silicon owns that provisioning (state it, or it becomes a silent capability loss) |
| **New residual family / repair constraint**: `scripts/build-mcp.mjs:37-44` anchor + loud overlay guard | A15 | repair t8 — R7.12: rename the anchor to a non-RTL name in the SAME change, keep the guard functional, and prove it still trips when it should |
| Content-only mentions (`pack-mpd.mjs:75`, `package.json:33`, `.gitignore:23-34`) | A16 | repair t8 — R7.12: rename where honest, otherwise record in keep-with-record with the choice stated |
| C3 / C4 / C5 / C8 measured FAILS at the pin | A10 | repair t8 — R1.1 / R2 / R6 (the residual list proper) |

**Standing rule (restated so it survives):** a non-passing criterion is reported as `FAILS` / `SUPERSEDED` /
`bridge gap` / `not an extraction residual` / `UNVERIFIABLE` — never as a pass, and never silently dropped.
A guard that cannot fail (§A11, §A27, §A28) is itself a finding.

### 5.2 From addendum 2 (owner: repair t8, over the reviewer's dissent)

| Open item | Source | Owner / ruling |
|---|---|---|
| **Guard-1** `scripts/verify-rows-parity.mjs`: a zero-subject run prints `ok: 0 row ids …` and exits 0 | A27 | **t8 — IN SCOPE by R7.15** (over the reviewer's defer recommendation): add a minimal subject-count assertion that fails on an empty enumerated set and says which set was empty, plus a falsifiability probe (empty-subject copy → exit 1; non-empty → exit 0); t11 re-measures |
| **Guard-2** `scripts/verify-vendor.mjs`: `assets` emptied 7→0 → PASS with zero fingerprints checked | A28 | **t8 — IN SCOPE by R7.15**: same minimal assertion (`Object.keys(lock.assets).length >= 1`) and probe; t11 re-measures |
| Guard-3 (2 of 25 cases skip-capable) | A29 | **Not a new repair item** — R3 retires both cases; contained by design |
| The four failed counter-arguments | A30 | Negative results — carried, never reported as findings against the guards |
| **Dissent kept visible:** the reviewer recommended deferring Guard-1/Guard-2 to a follow-up with its own evidence on scope-discipline grounds; R7.15 overrules that, and the recommendation **stays in `review.md` §8 as the dissent** | A33 | Recorded; the ruling's stated reason (these two gates are the instruments the repair uses to prove correctness) must be reported wherever the fix is reported |

### 5.3 Forward-pointer status (measured, not assumed)

* **Addendum 1 is cited by path from both governing documents.** `captain-rulings.md` R7.12 (L334–336)
  reads "t5 addendum — `evidence/rtl-extraction-residual/verify/addendum-gates-and-criteria.md`; indexed by
  `verify/addendum-manifest.md` §2, claims A1–A22"; the lead's `verdict.md`
  (`evidence/rtl-extraction-residual/verdict.md`, + its zh-CN twin; t7 **completed**) cites the addendum
  family 11+ times, including the X2/X7/X12 ledger rows and the artifact table.
  *Citation-precision nit for the captain/lead:* the report's artifact table says **"claims A1..A20"**,
    while the authoritative index is **A1..A22** — A21 (content-only classification, incl. the
    `frontend` "RTL = right-to-left" false positive) and A22 (tree state) exist and are cited in the report's
    own ledger. A one-word fix (or a re-read of §2) closes it.
* **Addendum 2 is now carried into the report.** `captain-rulings.md` R7.15 (L400) names `review.md` §8 as
  the dissent's location, and the lead's `verdict.md` (measured at 54 114 B / mtime 15:59:15) records
  Guard-1/Guard-2 as **"pre-existing guard-quality defects that are NOT extraction residuals"**, notes that
  the review gained §8/§9 (C9–C11) and that R7.7–R7.10 are the captain's adjudications over it. The
  earlier "not yet carried" state is therefore **superseded**; the only remaining forward pointer for §8 is
  t8's in-scope fix of the two guards (A33) and t11's re-measurement.
* `captain-attestation.md` (the captain's integrity record) cites both addenda and `addendum-manifest.md §3`
  by path, and is the authority for the pre-extension hashes in §4. If it is re-taken after this extension,
  its `addendum-manifest.md` row should be refreshed (see §4).

---

## 6. Governing-document pointer check — UPDATED (both addenda are now citable)

t13's acceptance asks that **`captain-rulings.md` and the lead's `verdict.md` reference the addendum by
path**. Measured state at the **first** filing (15:53) and **now** (this extension):

| Document | At first filing | Now |
|---|---|---|
| `captain-rulings.md` (captain-owned; outside this task's `inScope`) | descriptive mention only (`:334` "t5 addendum", no path) | **SATISFIED for addendum 1**: R7.12 (L334–336) names `evidence/rtl-extraction-residual/verify/addendum-gates-and-criteria.md` **and** `verify/addendum-manifest.md` §2; **addendum 2** is named in R7.15 (L400) as `review.md` §8, the dissent's location |
| the lead's `verdict.md` (`evidence/rtl-extraction-residual/verdict.md`, + zh-CN) | did not exist yet | **SATISFIED**: cites the addendum by path throughout (artifact table + the X2/X7/X12 ledger rows), and after t7 completed it also records Guard-1/Guard-2 as pre-existing guard-quality defects and the review's §8/§9 conditions (C9–C11) — see §5.3 |
| `verify/verdict.md` (t5, read-only by contract) | 0 "addendum" occurrences; predates the addendum (15:47:02 < 15:49:58) | unchanged — it cannot cite the addendum without an edit its contract forbids, and none is needed: the **lead's** verdict is the report |
| other path-form citations | `verify/raw/t5-raw-manifest.md:30`, `repair/prep-note.md:331` | plus `captain-attestation.md` §2 (both addenda + `addendum-manifest.md §3`) |

**Status: satisfied** for addendum 1 on both named documents, and satisfied for addendum 2 on the captain's
side; the only open pointer is the lead's report carrying the guard-sweep family (§5.3), owned by t7/t11 —
not by this task.

---

## 7. Where the raw evidence lives and who owns it

| Tree | Owner | Cited by |
|---|---|---|
| `verify/raw/**` | **mixed** — t5's own logs + ten t12 logs; the authoritative attribution table is `verify/raw/t5-raw-manifest.md` (its "NOT t5-owned" list: `bundle-lifecycle{,-capture}.log`, `bundle-lifecycle.exit`, `bun-test-packages{,.exit}`, `byte-compare.txt`, `gate-comparison.log`, `drift-and-artifacts.log`, `my-log-hashes.txt`, `verify-vendor.log`, `verify-rows-parity.log`, `verify-rtl-references.log`) | addendum 1 (A1–A22) |
| `review/raw/**` | t6 (its own captures: `guard-blind-spot-sweep.txt`, `sweep/{p1,p2,p3}/**`, `parity-and-dangling.txt`, `golden-fixture-consumers.txt`, `gate-probe.txt`, `f2-baseline-log-anomaly.txt`, `ledger-hook-index-state.txt`, …) | addendum 2 (A23–A34) |
| `gates/raw/**` | t4 / t12 — neither addendum touches it | — |

Rule (R7.10 / A26): no task rewrites another's evidence. Cite `g5-*`, `supp-*`, `criteria-*`, `c7-*`,
`probes-P14-P20*`, `p16-*` for addendum 1 and `review/raw/**` for addendum 2; **never** cite a t12 log as
t5 evidence and never cite `verify/raw/**` as t6 evidence.

---

## 8. Tree state and scope discipline (pasted at this writing)

`git status --short` (verbatim; HEAD `32ae54dd10db7ea46e1c1263143d56f266fd1f78`, branch `dev`; **captured 2026-09-13 16:07 +0800 — 48 entries at capture, 51 two minutes later, because t8's repair writes continuously and the guard fixes R7.15 ordered had by then landed too**):

```
 M README.md
 M README.zh-CN.md
 M docs/adder4.md
 M docs/cnt8.md
 M docs/development.md
 M docs/index.md
 M docs/index.zh-CN.md
D  docs/rtl-gap-assessment.md
D  docs/rtl-gap-assessment.zh-CN.md
D  docs/rtl-ip-flow-guide.md
D  docs/rtl-ip-flow-guide.zh-CN.md
D  docs/rtl-verif-guide.md
D  docs/rtl-verif-guide.zh-CN.md
 M packages/mpd-agent-teams-plugin/lib/index.js
 M packages/mpd-agent-teams-plugin/lib/mpd-deltas.js
 M packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs
 M packages/mpd-agent-teams-plugin/self-fix-tests/scope-glob-and-contract.test.mjs
 M packages/mpd-bundle/README.md
 M packages/mpd-bundle/README.zh-CN.md
 M packages/mpd-mcp-lsp/README.md
 M packages/mpd-mcp-lsp/README.zh-CN.md
 M packages/mpd-mcp-lsp/dist/BUILD.lock
 M packages/mpd-mcp-lsp/dist/cli.js
 M packages/mpd-mcp-lsp/overlay/lsp/language-mappings.ts
 M packages/mpd-mcp-lsp/overlay/lsp/server-definitions.ts
D  packages/mpd-mcp-lsp/templates/rtl-lsp-client.json
 M packages/mpd-qa-roles-probe/dist/index.js
 M packages/mpd-qa-roles-probe/src/index.ts
 M scripts/build-mcp.mjs
 M scripts/install-mcp.mjs
 M scripts/pack-mpd.mjs
 M scripts/patch-agent-teams-fixes.mjs
 M scripts/verify-rtl-references.mjs
 M skills/dsh-qa/SKILL.md
 M skills/dsh-qa/scripts/dual-track-smoke.mjs
D  skills/dsh-qa/scripts/rtl-ip-profile.mjs
D  skills/dsh-qa/scripts/rtl-verif.mjs
D  tests/golden/fixtures/verilog/README.md
D  tests/golden/fixtures/verilog/modules/adder4.v
D  tests/golden/fixtures/verilog/modules/cnt8.v
D  tests/golden/fixtures/verilog/tb/tb_adder4.v
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-37-13.539Z/
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-43-55.289Z/
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-48-22.924Z/
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T08-02-54.465Z/
?? evidence/dsh-qa/preset-conformance/2026-09-13T07-36-29.035Z/
?? evidence/rtl-extraction-residual/
?? packages/mpd-agent-teams-plugin/self-fix-tests/fixtures/
?? skills/dsh-qa/scripts/software-smoke.mjs
```

Scope confirmation:

* The **only** file written by this task is `evidence/rtl-extraction-residual/verify/addendum-manifest.md`
  — first at 15:53 (t13 v1), extended to both addenda (v2), corrected after the Reviewer's relay (v2.2),
  and given its final t14 consistency pass (v3, this revision). Nothing outside
  `evidence/rtl-extraction-residual/verify/` was touched by this task.
* Everything else visible above is **t8's in-flight repair** (docs removal, HDL removal + rebuilt `dist/`,
  the mpd-delta/registry edits, R7.12 `build-mcp`/`install-mcp`/`pack-mpd` edits, R3's retirement of the two
  RTL cases and the golden fixtures, `software-smoke.mjs` and the new self-fix fixture directory). The
  addendum-1 r2/r3 revisions and `review/review.md` §9 were made by their owners (see §4), and the protected
  files are re-verified against the §4 hash table, so a reader can tell those edits from mine.
* **This paste is attribution evidence, not a frozen state** — the repair keeps writing (this list grew
  from 18 to 48 entries while this file was being finished); run `git status --short` for the live tree.
  The t5 addendum's §9 records the same drift and warns that its §1–§7 gate exits are a **pre-repair
  baseline** for the pinned revision — t11 must re-measure the repaired tree.
* **Task-state note:** t13 had already reached `completed` when the captain extended its scope, and a
  terminal task **cannot be re-claimed** (`agent_teams_claim_task` → *"task status cannot move from
  completed to claimed"*); the follow-up task **t14** was assigned to Researcher and failed on the
  moving-target condition without writing anything, and the captain directed this final pass to the
  manifest's owner. Neither extension has a re-opened attempt of its own.

---

**FROZEN at this revision.** Corrections go to the captain **as messages** and are applied only by the
captain's direction; the owner makes no further edits. The frozen bytes and sha256 are reported to the
captain with this pass; §4's v3 lineage row records the revision history.
