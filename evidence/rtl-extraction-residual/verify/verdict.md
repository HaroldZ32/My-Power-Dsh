# t5 verdict — independent re-verification of the RTL-extraction residual audit

**Task**: t5 · verification round 1 · **Verifier**: Reviewer (correctness / risk review, read-only)
**Pinned revision (mpd)**: `32ae54dd10db7ea46e1c1263143d56f266fd1f78` (`dev`)
**Settled-hash discipline**: every subject was hashed before the measurement window and re-hashed
after it; both measurements are identical (`raw/subject-hashes-first.txt` vs
`raw/subject-hashes-settled.txt`, diff empty). All verdicts below are anchored to those hashes.
**Scope**: `evidence/rtl-extraction-residual/verify/` only. Nothing under `skills/**`,
`packages/**`, `scripts/**`, `docs/**`, `package.json`, `VENDOR_LOCK.json` or the sibling silicon
repo was written or modified; see §6 for the pasted `git status --short`.
**Method**: every claim was re-measured with my own command against the pinned tree. No claim is
marked PASS on another task's output. Where the deciding evidence lives in the silicon repo
(out of my `inScope`), the verdict is `UNVERIFIABLE` and says so.
**Claimability note**: at measurement time the scheduler still refused the t5 claim
(`blocked by unfinished dependencies: t1, t4`; t1 was `in_progress`, t4 had `failed` and was
retried by the captain). The measurement was performed on the captain's direct note plus the t5
contract; the formal claim is retried before this verdict is reported.

---

## 0. Verdict summary

| Id | Claim (re-measured) | Verdict | My command (raw log) |
|---|---|---|---|
| K1 | `mpd-mcp-lsp` still ships HDL language-service content: `verible` + `slang-server` in `overlay/lsp/server-definitions.ts` (comments, install hints, builtin table) and `overlay/lsp/language-mappings.ts`, plus 4+4 hits in the built `dist/cli.js`; byte-parity with the silicon copy proves nothing about single ownership | **PASS** | `grep -n -iE 'verible\|slang\|verilog\|systemverilog' …` + counts (`raw/claim1-lsp-hdl.log`); liveness: bundle row `mcp-lsp` + `VENDOR_LOCK` pin (`raw/claim1-liveness2.log`) |
| K2 | `packages/mpd-mcp-lsp/README.md` (+ zh-CN twin) advertises RTL LSP and points at `references/{verilog,systemverilog}/README.md` — paths **deleted** by `32ae54d`; the shipped README advertises a setup path that does not exist | **PASS** | `grep -n … README*.md`; `ls skills/lsp-setup/references/`; `git ls-files \| grep lsp-setup/references/(verilog\|systemverilog)`; `git show --stat 32ae54d` (`raw/claim2-readme.log`, `raw/settle-and-readme.log`) |
| K3 | `tests/golden/fixtures/verilog/**` (4 files) has **zero live mpd consumer**; `docs/adder4.md:7` + `docs/cnt8.md:7` cite that fixture path | **PASS** | `git ls-files tests/golden/fixtures/verilog`; path- and name-axis consumer search over `tests/ scripts/ skills/ packages/ presets/` (`raw/claim3-golden-fixtures.log`, `raw/claim3-4-supplement.log`) |
| K4 | `dist/mpd-package/skills/lsp-setup/references/{verilog,systemverilog}/README.md` exists in the **stale pack** and would be installed by `dsh plugin add dist/mpd-package`; `dist/` is gitignored (distribution hygiene, not tracked content) | **PASS** | `ls -la dist/mpd-package/skills/lsp-setup/references/{verilog,systemverilog}/README.md`; `git check-ignore -v`; pack mtimes vs commit times (`raw/claim4-stale-pack.log`, `raw/claim3-4-supplement.log`) |
| K5 | `scripts/verify-rtl-references.mjs` resolves a token against **either** repo root and its `DOCS` array reads the six RTL docs **from silicon**, so a `resolved` token is not evidence the mpd copy is gone; with the two RTL cases retired the gate can pass while checking nothing of its own | **PASS — and stronger than claimed** | Source read (`:24-37`, `:65-71`, `:79-80`); live run (`raw/claim5-gate-run.log`); `MPD-ABSENT` discriminator (`raw/demo-blindness-B.log`); unmodified-copy blindness demo (`raw/demo-blindness-A.log`, `raw/demo-blindness-B2C.log`) |
| A1 | t1's ledger: 16 `FULL-STRIP-DEFECT` paths (6 stranded RTL guides, 2 doc-hub rows, 2 bundle READMEs, LSP README pair + HDL template, `dsh-qa/SKILL.md`, 2 RTL QA cases) | **PASS on existence/content — DISPUTED on completeness** | My both-axis sweep reproduced every one of the 16 (`raw/axisA-paths.txt`, `raw/axisB-files.txt`, `raw/axisB-classify.log`); the ledger's own `census.tsv` rows 4368–4370 put the live HDL registrations in `BRIDGE-BY-DESIGN` |
| A2 | t2's acceptance contract (B1–B4 buckets, C1–C10, verdict rule) | **ADOPTED; 3 of its B1 classes independently instantiated by me — its governance quotes UNVERIFIABLE** | The RTL guides, the golden Verilog fixtures and the HDL language-service assets are all measured present (`raw/census.log`); `sync-policy.md` is silicon-side |
| A3 | t3's cross-repo parity / dangling-bridge result (73 DEL items, 9 MISSING, 0 mpd-side originals) | **UNVERIFIABLE (silicon repo out of my scope)** | Not re-run by design; t3's *mechanism* F5 is independently confirmed under K5 |
| A4 | t4 F1: corpus is 19 while the mounting probe requires `bundled.length >= 20`, so the MOUNT gate is red | **PASS on substance (my own commands); full boot re-run NOT repeated** | `ls -d skills/*/ \| wc -l` → 19; threshold at `packages/mpd-qa-roles-probe/src/index.ts:58` and `dist/index.js:282` (`raw/checks-A4-A6.log`). Context only, not my evidence: t12's closure (`verify/t4-closure.md`) independently re-confirms both red gates at the same HEAD |
| A5 | t9: the two RTL QA cases are the only silicon-coupled cases and are retirement targets | **PASS** | `grep -ln 'MPD_SILICON_ROOT\|SILICON' skills/dsh-qa/scripts/*.mjs` → exactly `rtl-verif.mjs`, `rtl-ip-profile.mjs` (2 of 25 scripts) (`raw/checks-A4-A6.log`) |
| A6 | t1 F6: the only RTL-doc inbound link is `docs/index.md:19` / `docs/index.zh-CN.md:18` | **PASS** | `grep -n 'rtl-.*\.md' docs/index.md docs/index.zh-CN.md` → exactly those two lines (`raw/checks-A4-A6.log`) |

**Bottom line for the user-facing report.** The five post-hoc claims are true — I reproduced every
one of them, several of them more strongly than stated. But the audit as a whole must **not** be
reported as coherent: two classification conflicts inside its own artifacts (V1, V2) decide whether
the *live* HDL language service and the *tracked* Verilog fixtures are repaired at all, and the one
standing guard that is supposed to witness this class (V3) is structurally incapable of failing on
any of the audited residual families. Details in §2.

---

## 1. K1–K5, re-measured in detail

### K1 — the HDL language service is live, shipped, and sha-pinned — **PASS**
* `overlay/lsp/server-definitions.ts` (sha256 `95ade5ae07c07b1f…`): HDL header comment at `:13-15`,
  install hints at `:68-69`, builtin registrations at `:173-174`
  (`verible: {command:["verible-verilog-ls"], extensions:[".v",".vh"]}`,
  `"slang-server": {command:["slang-server"], extensions:[".sv",".svh"]}`). Occurrence counts:
  `verible=6 slang=6 verilog=4 systemverilog=1`.
* `overlay/lsp/language-mappings.ts` (`2173ab02aefb9d92…`): same header comment `:13-15`, extension
  map `:186-189` (`.v/.vh → verilog`, `.sv/.svh → systemverilog`).
* `dist/cli.js` (`04b49f8c192d03b5…`): **exactly 4 `verible` + 4 `slang` hits** as claimed — hints at
  `:3643-3644`, builtins at `:3746-3747`. The exported tables are `BUILTIN_SERVERS`/`LSP_INSTALL_HINTS`
  inlined from the overlay (`:3599`, `:3646`).
* **Liveness (my addition, decisive for severity):** bundle row `mcp-lsp`
  (`packages/mpd-bundle/cordis.patch.yml:64-73`) launches exactly this file
  (`…/packages/mpd-mcp-lsp/dist/cli.js`), and `VENDOR_LOCK.json:39-43` sha-pins those bytes.
  So the HDL registrations are not dormant source: they are the artifact a mounted session runs, and
  the vendor gate enforces the exact bytes that carry them.
* The claim's *inference* point — byte-parity cannot establish single ownership — is affirmed: mpd
  ships and mounts its own copy, so ownership is decided by what each repo **ships and mounts**, not
  by whether two files happen to be equal. I did **not** read the silicon copy (out of scope), so I
  neither confirm nor deny the byte-parity fact itself; that half belongs to t3/R1.1.

### K2 — the shipped README advertises a path that no longer exists — **PASS (dangling confirmed)**
`packages/mpd-mcp-lsp/README.md:44-45` (verbatim): *"the `lsp-setup` skill routes `.v/.vh` →
`references/verilog/README.md` and `.sv/.svh` → `references/systemverilog/README.md` for
install/verify steps"*; the zh-CN twin says the same at `:43-44`. Measured: `skills/lsp-setup/references/`
holds 20 language dirs and **no** `verilog/` or `systemverilog/`; `git ls-files | grep
'lsp-setup/references/(verilog|systemverilog)'` → 0 hits; `32ae54d` deleted both files
(`…/systemverilog/README.md | 83 --------`, `…/verilog/README.md | 79 --------`). The skill's own
`SKILL.md:46-47` was repointed at `../my-power-dsh-silicon/packages/mpd-mcp-lsp/references/…`, so the
**skill** is coherent while the **package README** still names the deleted in-repo path. This is a
dangling reference, not merely an absent file.

### K3 — the Verilog fixtures have zero live consumer — **PASS**
Exactly 4 tracked files: `README.md`, `modules/adder4.v`, `modules/cnt8.v`, `tb/tb_adder4.v`
(the README is a task prompt: *"Create modules/adder4.v … No simulator needed"*). Consumer search
over `tests/ scripts/ skills/ packages/ presets/ docs/`:
* path axis (`fixtures/verilog`) → only **documentation** citations: `docs/adder4.md:3,7`,
  `docs/cnt8.md:3,7`, `docs/rtl-gap-assessment.md:29,180,243` (+ zh twin). No executable reader.
* name axis (`adder.v|adder_tb|good.v|bad.v`) → one code hit, `skills/dsh-qa/scripts/rtl-verif.mjs`,
  which is **not** a consumer: it *writes its own* `adder.v`/`adder_tb.py` from inline constants
  (`GOLDEN_ADDER_V`/`GOLDEN_ADDER_TB` at `:201-202`) and never reads `tests/golden/fixtures/verilog`.
* `tests/golden/` contains no harness that walks fixtures; `tests/golden/out/**` (3 tracked files)
  references `tests/mcp-fixtures/sample.c`, not the Verilog fixtures.
* Remaining mentions live only in untracked archived team state
  (`.mpd/team/archive/rtl-dev/team.json`), which is not a consumer.
`docs/adder4.md:7` and `docs/cnt8.md:7` cite the path exactly as claimed.

### K4 — the stale pack carries the deleted HDL pages — **PASS**
`dist/mpd-package/skills/lsp-setup/references/verilog/README.md` (2783 B) and
`…/systemverilog/README.md` (3093 B) exist; the pack also carries
`packages/mpd-mcp-lsp/{README.md,README.zh-CN.md,dist/cli.js}`, i.e. the RTL README section and the
HDL-bearing server binary a `dsh plugin add dist/mpd-package` would install.
`git check-ignore -v` → `.gitignore:12:dist/mpd-package/`, so this is distribution hygiene, not
tracked content. Staleness measured: pack files mtime `2026-09-13 01:04:09`, extraction commit
`12291a7` at `01:04:32`, HDL-page deletion `32ae54d` at `01:51:10` — the pack predates both, and it
contains 19 skills with no `rtl-*` tree, i.e. it was built from a worktree where the RTL skill trees
were already gone but the HDL pages were not. `scripts/pack-mpd.mjs:50-51` copies `skills/`
wholesale, so a fresh pack from the current tree would not reproduce them.

### K5 — the standing reference gate cannot witness this class — **PASS (stronger)**
Source facts: `DOCS.map(… join(SILICON,"docs",name) … roots:[SILICON, repoRoot])` (`:79`), CASES read
from mpd with `roots:[repoRoot, SILICON]` (`:80`), and `resolve()` returns `resolved` when the token
exists in **either** root (`:65-66`). My probes:
1. **`resolved` ≠ present in mpd.** The live run reports 48 references and puts
   `skills/rtl-codestyle`, `skills/rtl-verif`, `skills/rtl-verif/fixtures/adder4`,
   `packages/mpd-verif-plugin/evidence/smoke/`, `packages/mpd-verif-plugin/dist/index.js` in the
   `resolved` bucket; `test -e` shows **every one of them is absent from mpd**. They resolve through
   the silicon root, so the bucket cannot testify about the mpd side in either direction
   (`raw/demo-blindness-B.log`).
2. **Same token, opposite ownership, same bucket.** In a scratch pair of roots, a token that exists
   *only* on the mpd side and the same token existing *only* on the silicon side both report
   `resolved` / exit 0 (`raw/demo-blindness-B2C.log`, states 1 and 2).
3. **Green while checking nothing.** An **unmodified byte-copy** of the gate
   (sha256 `34a1c8d6e5ca46a0…`, identical to the repo file) run from a repo-shaped scratch root with
   both RTL cases absent and an empty silicon root prints
   `PASS — 0 resolved, 0 pending-by-design, 0 unresolved` and exits **0** with `"considered": 0` —
   while every mpd-side residual in this audit was simultaneously present
   (`raw/demo-blindness-A.log`). The `considered === 0` guard exists **only in `--self-test`**
   (`:110`); the standing run has no such check.
4. **Pre-absolution.** Every audited residual family is either resolvable in silicon or matched by a
   `PENDING` prefix (`:29-35`: `packages/mpd-mcp-lsp`, `docs/adder4.md`, `docs/cnt8.md`,
   `skills/lsp-setup/references`, `skills/rtl-dev`), and `resolve()` classifies such a token as
   `pending`, never `unresolved` (`:67-70`). The gate's only failure channel is therefore
   structurally unreachable for exactly the paths under audit.

---

## 2. Cross-cutting findings (what must change before the report reaches the user)

| Id | Severity | Finding | Evidence |
|---|---|---|---|
| **V1** | **high (classification conflict, blocks the repair list)** | t1's ledger classifies the **live** HDL registrations as `BRIDGE-BY-DESIGN / ACCEPTABLE / none` (`census.tsv:4368-4370`: `dist/cli.js`, `overlay/lsp/language-mappings.ts`, `overlay/lsp/server-definitions.ts`), citing R1 as "explicitly retained"; the current ruling **R1.1** (`captain-rulings.md:47-86`) orders exactly those artifacts removed and `dist/cli.js` regenerated + `VENDOR_LOCK` re-pinned. A repair list derived from t1's 16 defects therefore **omits the only live RTL capability in the tree**. | `raw/t1-coverage-check.log`; `captain-rulings.md:15-19,47-86` |
| **V2** | **high (classification conflict)** | The 4 tracked Verilog fixtures + `docs/adder4.md`/`docs/cnt8.md` are `BRIDGE-BY-DESIGN` in t1 (t16-landed), "RETIRE" targets in t9's checklist, and named RTL capability in t2's adopted §1 definition ("the golden Verilog fixtures") + §5 "must not keep". Three artifacts, three answers; the deciding governance text is silicon-side and outside my scope, so I do not adjudicate — but the report cannot present a single verdict without one explicit ruling. | `raw/census.log`, `raw/claim3-golden-fixtures.log`; t9 `qa-standard/standard.md` checklist |
| **V3** | **high** | `verify-rtl-references.mjs` must not be cited anywhere as evidence that the mpd surface is stripped (K5.1–K5.4). Its three blind spots are structural, not incidental: either-root resolution, silicon-owned `DOCS` subjects, `PENDING` pre-absolution; plus a plain-run path that treats `considered: 0` as PASS. A subject-scoped replacement or an added `considered > 0` + mpd-absence assertion is required before the gate can carry a strip claim. **Live risk, measured:** t12's closure lists this gate among the "three gates green" (`t4-closure.md:25-31,191-194`), so the green must not be carried into the user report as a coherence signal for the strip. | `raw/claim5-gate-run.log`, `raw/demo-blindness-{A,B,B2C}.log`, `verify/t4-closure.md` |
| **V4** | medium | The stale `dist/mpd-package/` would install the deleted HDL pages, the RTL README section and the HDL-bearing `cli.js` via `dsh plugin add dist/mpd-package`. `dist/` is gitignored, so this is not tracked content — but it is the artifact a tarball/relocation test would exercise, and it must be repacked after the repair. | `raw/claim4-stale-pack.log` |
| **V5** | medium | `skills/dsh-qa/SKILL.md:62` still carries the `rtl-ip-profile` case row while the `rtl-verif` case (which `test:qa` actually runs) has no row — the index does not describe its own corpus. Classified a bridge gap, never a pass. | `raw/checks-A4-A6.log`, `raw/probes-P8-P12.log` |
| **V6** | low | `packages/mpd-bundle/README*.md` still advertise the waveform-read rows (`mcp-wave-mcp`/`mcp-traceweave`) and the `verif` plugin; measured composition: those rows are **commented out** in `cordis.patch.yml:92-125` (`grep -c 'mpd-verif\|rtl-ip\|mpd_verif' presets/mpd/* packages/mpd-bundle/cordis.patch.yml` → 0). Text residue, no live capability. | `raw/census.log` |
| **V7** | info (keep-with-record — **never a silent omission**) | String-only survivors that are test/sample data, not capability: `packages/mpd-workmate-plugin/test/workmate.test.ts` ("implemented the verilog counter", "wrote cnt8.v"), `skills/dsh-qa/scripts/workmate-library.mjs:19,23,129` ("Verilog counter specialist"), `.gitignore:23-34` (`.venv-rtl/`, `simv_iverilog`), `PLAN.md` (historical plan), `.silicon-extraction/removal.log` + `t5-closure-evidence/*` (process records). One of each must appear in the ledger's exemption list with its reason. | `raw/axisB-classify.log` |
| **V8** | low | `docs/index.md:19` / `docs/index.zh-CN.md:18` still describe the RTL guide as "being moved … until then this file describes the pre-extraction checkout" — stale wording that survives the deletion ordered by R2 and would point at a missing file afterwards. | `raw/checks-A4-A6.log` |
| **V9** | low (evidence hygiene) | **Scope collision:** task t12 wrote 10 raw logs into t5's `inScope` directory (`verify/raw/`: `bundle-lifecycle*`, `bun-test-packages*`, `verify-vendor.log`, `verify-rows-parity.log`, `verify-rtl-references.log`, `byte-compare.txt`, `gate-comparison.log`, `drift-and-artifacts.log`, `my-log-hashes.txt`), so `verify/raw/` is mixed-ownership. The t5 verdict cites only the files it produced (listed in `raw/t5-raw-manifest` — see §6); the final report must attribute t12's logs to t12 and must not read `raw/verify-rtl-references.log` as t5 evidence. | `ls -1 verify/raw/`; `verify/t4-closure.md:9` |

---

## 3. Acceptance mapping (t5 contract)

| Acceptance criterion | Status | Evidence |
|---|---|---|
| `verdict.md` classifies every re-measured claim PASS / DISPUTED / UNVERIFIABLE with the verifier's own command and raw output | **met** | §0 table (12 rows), §1 details, `raw/*.log` |
| At least five independent false-negative probes documented, each with command and result, including probes that found nothing | **met** | `false-negative-probes.md` P1–P13 (13 probes; P4, P9, P11, P12b are nothing-probes; P13 is a self-correction) |
| No claim marked PASS on the strength of another task's output alone | **met** | A3 is `UNVERIFIABLE`; A2 is partial by construction; every PASS row cites a command I ran |
| `git status --short` pasted and shows no repo modification | **met** | §6 |

---

## 4. What I did not verify (honesty)

* **The silicon repo** (out of `inScope`): no parity row, no `sync-policy.md` quote, no silicon-side
  hash, no `MPD_SILICON_ROOT`-absent behaviour was re-measured by me. A3 and the silicon half of
  R1.1 stay `UNVERIFIABLE` here.
* **The mounting gates as a whole**: I did not re-run `bundle-lifecycle.mjs` / `preset-conformance.mjs`;
  A4 re-measures only F1's substance (corpus 19 vs threshold 20). The boot re-run belongs to t4
  attempt 3 / t12, and a verdict on it must come from a mounting boot with registration
  instrumentation, never from `--dump-config`.
* **`bun test` / F2**: not re-run by me; F2 is t4's measurement and is now owned by the retry.
* I did not adjudicate the residual-vs-bridge questions in V1/V2: the deciding text is silicon-side.
* **t4 is now closed independently** (`verify/t4-closure.md`, task t12): it re-confirms all five gate
  results at this same HEAD, including the two red gates (F1 stale threshold, F2 self-fix fixture
  derivation). I cite it only as context; my A4 substance check is my own command. The two red gates
  remain **open defects** and must not be reported as green.

## 5. Settled hashes (first measurement == settled re-check)

| Subject | sha256 |
|---|---|
| `packages/mpd-mcp-lsp/overlay/lsp/server-definitions.ts` | `95ade5ae07c07b1f82695fbd2b9439e71004f5394deb9248303096eb03ac0d42` |
| `packages/mpd-mcp-lsp/overlay/lsp/language-mappings.ts` | `2173ab02aefb9d92ba3a3436021117de0d0d5be79d6dfac0f73328afc9f58075` |
| `packages/mpd-mcp-lsp/README.md` | `ec33b3024b7511906e466210e1a36ffcec71dc77ec40c1b3704d9f68232d6194` |
| `packages/mpd-mcp-lsp/README.zh-CN.md` | `a4ba74bd1278f884b0add86b40b68b2a065bdbc01d0e855b98579c1f4b748697` |
| `packages/mpd-mcp-lsp/dist/cli.js` | `04b49f8c192d03b5a9cdf1e1f17861d8f4c6741792a4c455e78d0ca8e0a973a9` |
| `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` | `a9c98a865d12b3747c489afde37e972d99e232c2800ed35721764b946432ac61` |
| `scripts/verify-rtl-references.mjs` | `34a1c8d6e5ca46a00cb4d5e416c1068c45c14fce4e8255ec7d8a580fa15ad6db` |

Raw: `raw/subject-hashes-first.txt`, `raw/subject-hashes-settled.txt`.

## 6. `git status --short` (pasted; no repo modification)

```
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-37-13.539Z/
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-43-55.289Z/
?? evidence/dsh-qa/preset-conformance/2026-09-13T07-36-29.035Z/
?? evidence/rtl-extraction-residual/
```

No tracked file modified; the only entries are untracked evidence directories (the audit's own and
the QA runs of other tasks). HEAD `32ae54dd10db7ea46e1c1263143d56f266fd1f78`.
