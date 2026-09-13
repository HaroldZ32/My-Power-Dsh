# t5 addendum — gate re-runs, C1–C10 cross-check, expanded false-negative hunt

**Why this file exists.** Task t5 was already **completed by me** (attempt 1, `verdict=pass`) when the
captain's wake arrived asking for an expanded re-measurement; the scheduler refuses to re-claim a
terminal task, and t6 had already started reviewing. To keep t6's reviewed artifact stable,
**`verdict.md` and `false-negative-probes.md` were left byte-identical**; everything new measured in
response to the wake is here. **This addendum does not change the t5 verdict** — it adds:

* my own re-runs of all five standing gates (exit codes),
* my own re-derivation of the six stranded RTL docs and of the two cases' SKIP behaviour,
* the t2 **C1–C10** cross-check (including three criterion defects),
* a **new residual family** the audit's defect list missed (installer/build/pack wiring),
* expanded false-negative probes **P14–P20**.

**Attribution / formal-verdict status.** Plan Reviewer's t6 review (`evidence/rtl-extraction-residual/review/review.md`
§9 "Addendum 2") independently re-checked this file and raised it to condition **C11**: the t7
integrated verdict must cite `verify/addendum-gates-and-criteria.md` by name and attribution (author:
Reviewer, t5 — distinct from `verdict.md`), and t8's repair list must carry the new residual family of
§5 under the review's R7.7 reconciliation rule. The §4 precision note on the C7 command records the one
wording correction t6 contributed; no verdict or finding changed.

Pin: `32ae54dd10db7ea46e1c1263143d56f266fd1f78`. Raw: `raw/g5-*.log`, `raw/supp-*.log`,
`raw/probes-P14-P20.log`, `raw/p16-*.{txt,log}`, `raw/criteria-C1-C10.log`, `raw/c7-*.log`.

---

## 1. All five standing gates, re-run by me (exit codes)

| Gate | My exit | Decisive output | Reproduces t4/t12? |
|---|---|---|---|
| `node scripts/verify-vendor.mjs` | **0** | `[verify-vendor] PASS` (`raw/g5-verify-vendor.log`) | yes (green) |
| `node scripts/verify-rows-parity.mjs` | **0** | `[verify-rows-parity] ok: 21 row ids match the bundle patch insert list` | yes (green) |
| `node scripts/verify-rtl-references.mjs` | **0** | `[rtl-refs] PASS — 42 resolved, 6 pending-by-design, 0 unresolved` | yes (green) — **and structurally blind, see verdict.md V3** |
| `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | **1** | `ok=false`; `[roles-probe] SKILLS=19 BUNDLED=19` → `FAIL`; `result.json ok:false` (`raw/g5-bundle-lifecycle.log`) | **yes — RED reproduced** |
| `bun test packages` | **1** | `295 pass / 3 fail`, `Ran 298 tests across 64 files` (same 3 agent-teams self-fix names) | **yes — RED reproduced** |

The full `--ignored`/porcelain tree state is unchanged by the runs; my run's only byproduct is
`evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-48-22.924Z/` (untracked). HEAD still `32ae54dd`.

## 2. Six stranded RTL docs, re-derived by me

All six are tracked, content-heavy and present: `rtl-verif-guide{,.zh-CN}` (159/167 precise-token
hits), `rtl-ip-flow-guide{,.zh-CN}` (20/19), `rtl-gap-assessment{,.zh-CN}` (149/149);
`ls docs/rtl-*.md | wc -l` = 6. Their content contains the removed surface itself (e.g.
`rtl-verif-guide.md:20` documents the eight `mpd_verif_*` tools as a live bundle row — the row no
longer exists). `raw/supp-six-docs-and-skip.log`.

## 3. The two RTL QA cases: SKIP-and-exit-0, measured (not quoted)

With `MPD_SILICON_ROOT=/nonexistent/mpd-silicon`:

* `… rtl-verif.mjs --self-test` → **exit 0**, `[rtl-verif] SKIP: silicon bundle not present …
  (1 group(s) skipped)`
* `… rtl-ip-profile.mjs --self-test` → **exit 0**, same shape.
* real (non-self-test) run, both cases → **exit 0** and print
  `SKIP: silicon bundle not present …` followed by **`PASS (nothing to probe: bundle absent)`**.

So `bun run test:qa` counts both RTL cases as green while they verify nothing on a machine without
the silicon checkout. (t1's F2 claim is thereby **confirmed by execution**, not by reading.)
`raw/c7-skip-probe.log`.

## 4. t2's acceptance criteria C1–C10 against the tree as measured

| Criterion | My measurement today | State today | Measurable? |
|---|---|---|---|
| C1 | `git ls-files skills \| wc -l` = **329**; all three `skills/rtl-*` absent; `verify-vendor` exit 0 | **HOLDS** | yes |
| C2 | `packages/mpd-verif-plugin` absent; textual hits = **7**, exactly the declared set (5 in the agent-teams self-fix test, 2 in `verify-rtl-references.mjs`); `verify-rows-parity` exit 0 | **HOLDS** | yes |
| C3 | `templates/rtl-lsp-client.json` **PRESENT**; `grep -rniE 'verible\|slang-server' overlay/ dist/` = **12** hits (expected 0) | **FAILS — repair target** | yes |
| C4 | all six `docs/rtl-*.md` present; hub link resolves today | **FAILS** | yes |
| C5 | fixtures present; live-consumer hits = **0** | first half **FAILS**, second half **HOLDS** | yes |
| C6 | `presets/rtl-ip.profile.json` absent ✓; `git grep 'rtl-ip.profile.json' -- packages scripts presets` = **0** (criterion requires ≥1); `grep -ni silicon README.md` = **0** (criterion requires ≥1); hook behaviour needs a mounting boot | **FAILS on both allow-list remnants** | partially — the boot half is not measurable by me |
| C7 | gate exit 0 ✓; `git grep '/root/dshProj' -- scripts skills docs` = 0 ✓; cases exit 0 + SKIP ✓; row check **VACUOUS (see below)**; `rtl-ip-profile` row still claims mpd ships the profile (stale) | partially | row sub-check is **not** a valid check |
| C8 | ignore entries confirmed (`.venv-rtl`, `.mpd`, `dist/mpd-package`; `.toolchain/` via `.gitignore:6`); `find dist/mpd-package \( -path '*rtl-*' -o … \)` = **6 FULL-STRIP paths** (the two retired-case scripts + both HDL pages) | **FAILS** | yes |
| C9 | silicon-side (status/HEAD/own gates/73 DEL homes) | **UNVERIFIABLE by me** | out of my scope |
| C10 | HEAD `32ae54dd…` ✓; `git status --porcelain` = 5 entries (all untracked evidence roots); axis sizes = **652** path hits / **38** content files | pin half **HOLDS**; the ledger-equation half **not independently reproduced** | equation is bookkeeping I cannot falsify from here |

### Three criterion defects (report these as findings, do not mark them passed)

1. **C7's registration sub-check is vacuous.** The criterion's command
   `grep -c '^\| rtl-verif ' skills/dsh-qa/SKILL.md` treats `^` as an alternation branch, so it
   matches **every line**: measured `73`, which equals the file's line count (`wc -l` = 73) while the
   anchored row form `grep -c '^| rtl-verif '` returns **0** and the
   `rtl-ip-profile` row returns **1**. The criterion therefore passes unconditionally and verifies
   nothing. `raw/criteria-C1-C10.log`.
   *Precision note (accepted from Plan Reviewer t6 §9; the command rendering above is corrected here):
   the defect is the **shipped escaped form** (`'^\| rtl-verif '`), which is vacuous; the bare/anchored
   pattern (`'^| rtl-verif '`) is a valid check that correctly reports 0. Re-specify the command —
   this finding must not be widened to "the registration check cannot work".*
2. **C7's case command cannot survive the repair its own sibling criteria demand.** It requires the
   two RTL cases to exist and print SKIP, while C1–C5/R3 retire them; a post-repair run of the
   criterion is impossible as written. It needs re-specification (either a pre-repair bridge
   criterion, or drop the case command).
3. **C6 is red on both allow-list remnants** — and per t2's own verdict rule a declared-but-absent
   allow-list item is a **bridge gap**, not a residual and never a pass: the mpd root `README.md`
   carries **no** silicon pointer (`grep -ni silicon README.md` = 0) although R5/R1 §5 require the
   "RTL capability moved" note, and no mpd-side reference to the carrier-hook contract exists
   (`rtl-ip.profile.json` refs = 0). C6's hook half additionally needs the mounting boot.

## 5. New residual family the defect list missed — extends verdict.md V1 (high)

A P16-axis result (content mentions in paths that do not look RTL) — none of these is in t1's 16
defects, and the first two are live wiring, not documentation:

| Path | What it carries | Why it matters |
|---|---|---|
| `scripts/install-mcp.mjs:32-35` | `LSP_TARGETS` downloads/installs **`verible-verilog-ls`** and **`slang-server`** into `<toolchain>/bin`; `:306` self-test **requires** both entries | the HDL language-service assets are installed by an mpd-owned script — same class as C3 |
| `scripts/build-mcp.mjs:37-44,49-88` | `BUILTIN_BUILD_ANCHOR = "mpd-rtl-overlay-v1"`, `LSP_OVERLAY_FILES`, `applyLspOverlay` with a loud drift guard | **repair constraint:** the overlay files must keep the anchor (or `BUILTIN_BUILD_ANCHOR` must change in the same commit) or `node scripts/build-mcp.mjs` FAILS loudly — the R1.1 repair cannot just delete the HDL rows |
| `scripts/pack-mpd.mjs:75` | comment names the verible/slang binaries | content-only mention in the release script |
| `package.json:33` | `"verify:rtl-refs": "node scripts/verify-rtl-references.mjs"` | live manifest row for the structurally blind gate (V3) |
| `.gitignore:23-34` | RTL scratch ignores (`.venv-rtl/`, verilator/cocotb artifacts, `simv_iverilog`) | keep-with-record, must be declared |

## 6. Expanded false-negative probes P14–P20 (captain's requested axes)

| Probe | Axis | Result |
|---|---|---|
| P14 | extension/case variants: `.V .SV .SVH .VH .vhd .vhdl .f .do .sdc .xdc .fst .vcd .sdf .tcl .qsf .ucf` | **0 tracked, 0 untracked-not-ignored** — nothing-probe (`raw/probes-P14-P20.log`) |
| P15 | gitignored/untracked leftovers | only `.venv-rtl/` (ignored) and the audit's own evidence dir; nothing else RTL-named (`raw/probes-P14-P20.log`) |
| P16 | content mentions in non-RTL-looking paths | **25 files** — classified in §5 + §7; this is the axis that surfaced the installer/build wiring (`raw/p16-full.txt`, `raw/p16-classify.log`) |
| P17 | patch/YAML/manifest rows | `mpd-verif\|rtl-ip\|mpd_verif\|silicon-verif` in `*.yml/*.yaml/*.json/package.json` (excl. evidence) = **0** — nothing-probe |
| P18 | `VENDOR_LOCK.json` entries naming RTL/HDL | only `packages/mpd-mcp-lsp/dist/cli.js` (the HDL-bearing dist, sha-pinned) — confirms the vendor gate enforces the residual bytes |
| P19 | `dist/` (all, not just the pack) | **5** paths: the pack's two RTL case scripts + both HDL reference dirs + `skills/lsp-setup/scripts/verify-lsp.ts` (`raw/probes-P14-P20.log`) |
| P20 | skills-corpus README/`SKILL.md` axis | exactly **1** file (`skills/lsp-setup/SKILL.md`, already correctly repointed at the silicon bundle) — nothing-probe for the rest |

## 7. Content-only survivors — classification (keep-with-record, never a silent omission)

* **Process records (exempt per `AGENTS.md` §3 and t2 §5):** `PLAN.md`, `.silicon-extraction/removal.log`,
  `t5-closure-evidence/*`, `docs/review-p0-p3.md`, `docs/track-a-report.md`, `AGENTS.md:139`
  (which correctly documents the move and is the closest thing to the required pointer note).
* **String-only test/sample fixtures (keep-with-record):** `packages/mpd-agent-teams-plugin/self-fix-tests/scope-glob-and-contract.test.mjs`
  (uses `packages/mpd-verif-plugin/test/**` as a scope-glob **sample path**),
  `packages/mpd-workmate-plugin/test/workmate.test.ts`, `packages/mpd-bundle-plugin/test/sidebar-tab.test.mjs`
  ("Writes RTL testbenches" workmate note), `packages/mpd-bootstrap-plugin/test/bootstrap.test.ts`,
  `skills/dsh-qa/scripts/workmate-library.mjs`, `skills/dsh-qa/scripts/dual-track-smoke.mjs`,
  `packages/mpd-qa-roles-probe/src/index.ts:34`.
* **Genuine false positive:** `skills/frontend/references/design/layout-skill.md:101` — "RTL" means
  right-to-left layout. Must not enter any residual ledger.
* **Bridge files already in the defect list:** `packages/mpd-bundle/README{,.zh-CN}.md` (F4),
  `skills/dsh-qa/SKILL.md:62` (F5), the six docs (F1), the two cases (F2).

## 8. Tree state and hashes after this round

`git status --porcelain` (5 untracked entries, zero tracked modifications):

```
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-37-13.539Z/
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-43-55.289Z/
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-48-22.924Z/
?? evidence/dsh-qa/preset-conformance/2026-09-13T07-36-29.035Z/
?? evidence/rtl-extraction-residual/
```

HEAD unchanged (`32ae54dd…`); the seven subject hashes of §5 in `verdict.md` are untouched by this
round (no measured file changed). Raw logs produced here: `g5-*.log`, `g5-exits.txt`, `g5-summary.log`,
`supp-*.log`, `criteria-C1-C10.log`, `c7-*.log`, `probes-P14-P20.log`, `p16-*.{txt,log}` — all t5-owned
(the ownership manifest `raw/t5-raw-manifest.md` covers the earlier round; t12's files remain t12's).

## 9. Revision log (post-index corrections) — read before citing a fingerprint

Two corrective edits were made **after** `verify/addendum-manifest.md` (task t13) and
`review/review.md` §9 (task t6) indexed this file. **No finding, severity or verdict changed**; the
edits correct one command rendering and add attribution/precision notes:

| Rev | Change | Why |
|---|---|---|
| r1 (original) | as indexed by t13 (144 lines) and quoted by t6 §9 | the version both reviews consumed |
| r2 | §4 defect 1: the "strict check" command was rendered as `'^\| rtl-verif '`, i.e. the same escaped form it was contrasted against; corrected to the anchored form actually run, `'^| rtl-verif '` (returns 0), plus a precision note limiting the finding to the **shipped escaped form** (the bare pattern is a valid check) | an accuracy defect in my own file; the precision was contributed by Plan Reviewer t6 §9 |
| r3 | header: "Attribution / formal-verdict status" (t6 §9 → condition **C11**); this §9 | so the file carries its own formal home and revision history |

**Fingerprint drift:** `verify/addendum-manifest.md` records this file as 144 lines with
`sha256 fada192fb3fc0c1c0a0d0cb1bc393afdb5e200e63bea720ac25eae80888e1cb3`; that fingerprint is the
**r1** revision. The current revision's hash and line count are recorded in
`raw/addendum-revision-log.txt` (written after the final edit, so it cannot go stale against §9).
Citers must use the newer hash, or cite by path/attribution only.

**Tree drift after this round (for t11).** The §8 tree snapshot ("5 untracked entries, zero tracked
modifications") was true at measurement time. By the r2/r3 edits the working tree carried the in-flight
repair (task t8): `M skills/dsh-qa/SKILL.md`, `M skills/dsh-qa/scripts/dual-track-smoke.mjs`,
`D skills/dsh-qa/scripts/rtl-{verif,ip-profile}.mjs`, `?? skills/dsh-qa/scripts/software-smoke.mjs`,
with HEAD still `32ae54dd`. Everything in this addendum §1–§7 is therefore a **pre-repair baseline for
the pinned revision** — t11 must re-measure the repaired tree rather than compare against §1's gate
exits (which are expected to change, e.g. the F1 threshold red).
