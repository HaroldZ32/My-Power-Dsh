# Acceptance contract — "the RTL surface is completely stripped from `@mpd-dsh/mpd`"

**Task**: t2 · requirements round 1 · **Author**: Architect (read-only role)
**Audit**: RTL-extraction residual sweep (`evidence/rtl-extraction-residual/`)
**Audited revision (pinned, mpd)**: `32ae54dd10db7ea46e1c1263143d56f266fd1f78` (`dev`)
**Audited revision (pinned, silicon)**: `bf3dae2530949d9fe410cec9b25b5581bdbcc58e`
**Deliverable of record**: this file. It is the *only* path this task writes; it defines the
contract, it does not execute the sweep (t1) or the repair (t8).

---

## 0. What this contract decides, and on whose authority

The question is **not** "does the mpd repo still mention RTL somewhere" — it is
**"does the mpd repo still carry RTL capability"**. The split's own governance record already
rules that question, so this contract adopts that ruling instead of inventing a standard:

> silicon `docs/sync-policy.md` **§5 "What the source repository keeps (pointer policy)"**
> (lines 83–91): *"After the strip, the source repository keeps: a short 'RTL capability moved'
> note in its README and, if useful, in its docs index, naming this repository …; the `rtl-ip`
> carrier hook, whose contract is frozen by the profile data's companion README. **It must not
> keep: any copy of the RTL skill trees, the verif plugin, the LSP overlay, the RTL guides, the
> golden fixtures, or the profile data itself.**"*
>
> `sync-policy.md` §1 (lines 14–23): *"After the strip, the source project (`@mpd-dsh/mpd`)
> carries no RTL capability at all. It keeps exactly two things: the `rtl-ip` carrier hook …
> and a short pointer naming this repository. No RTL content is duplicated there."*
> §1 also defines the term: **"RTL capability" = the `mpd_verif_*` tool surface, the three RTL
> skill trees, the `rtl-ip` team profile data, the HDL language-service assets
> (Verible / slang-server), the waveform-read rows, the RTL guides, and the golden Verilog
> fixtures.**

**Verdict rule.** The surface is *completely stripped* iff criteria **C1–C8 and C10** hold at the
pinned revision, with **C9** supplying cross-repo parity evidence. A failure of any of C1–C8 is a
**residual** (repair input). A **declared-but-absent** item on the §5 allow-list (the carrier
hook, the README "moved" note) is a **bridge gap**, reported separately — it must never be folded
into "residual" (that would claim an over-strip) and never into "pass" (that would hide a broken
cross-repo contract).

Downstream use: **t1** classifies every survivor into a bucket and emits the ledger (§5);
**t3** executes C9 (parity/dangling bridges); **t4** executes C7/C8/C10 gates; **t5** re-runs
every criterion independently; **t8** repairs exactly the residual list the ledger produces.

---

## 1. Records this contract derives from (all read at the pinned revisions)

| # | Record | Pointer | What it rules |
|---|---|---|---|
| R1 | silicon `docs/sync-policy.md` | §1 L14–23, §2 L32–39, §3 L66–78, §5 L83–91 | the authoritative remnant allow-list and the "must not keep" list |
| R2 | silicon `presets/README.md` | §"The t15 hook contract" (L41–70), L5–9 | the carrier hook's frozen read contract (apply-time read, `{}` fallback, merge order, ≤16 profiles) |
| R3 | `.silicon-extraction/removal.log` | §A L4–78 (73 `DEL` lines), §A2 L100–107, §A3 L109–115, §C L121–129, §D L130–136, §E L138–145 | the per-path removal record, the KEEP list with named owners, and the measured gate logs |
| R4 | `12291a7` (extraction commit) | message + `--diff-filter=D` (72 paths) | the physically removed surface, the re-pin #1 (skills 366→331) |
| R5 | `32ae54d` (t17 commit) | message (`skills 331 → 329`, `asset OK: skills 329 files`) | the second and LAST re-pin; the 2 orphan HDL pages removed; the HDL routing rows repointed at silicon |
| R6 | `d50934e` (t19 commit) | message + `skills/dsh-qa/scripts/rtl-*.mjs` | the two RTL QA cases repointed at `$MPD_SILICON_ROOT`; `verify-rtl-references.mjs` added |
| R7 | silicon `docs/rtl-docs-port-record.md` | L12–L42, L49 | the six RTL guides were ported (byte-for-byte, then corrected) — the migration half of removal.log L114 |
| R8 | silicon `evidence/verification/t20-repair.md` | §1 (corpus baseline), §3 | t20 landed: the ported corpus is self-held with a committed per-file sha256 baseline |
| R9 | silicon `evidence/verification/t19-qa-repoint.md` | L5–L12, L58 | the repointed cases' scope; **"the mpd-side carrier (task t15) has not landed"** |
| R10 | silicon `evidence/review/t21-rereview.md` | F4 row (L24) | the source repo's gates are green and "the two RTL cases live again (t19)" |
| R11 | `AGENTS.md` | §3 L139, §4 (MOUNT gate), §7 (case checklist, settled hashes), §12 | repo conventions this contract must respect |
| R12 | `scripts/verify-rtl-references.mjs` | L24–37 (roots, `PENDING`, `IGNORE`), L65–78 (`resolve`/`audit`), L138 | the standing reference gate and its three buckets |
| R13 | `VENDOR_LOCK.json` | L19–22 (`assets.skills`: `fileCount` 329, `treeSha` `8a0f05f0…`) | the fingerprint every `skills/**` change must re-pin in the same commit |

---

## 2. The four buckets

### B1 · FULL-STRIP — **IN SCOPE** (a survivor here is a residual)
**Definition.** A tracked path, or a content fragment inside a tracked file, that instantiates an
"RTL capability" class from R1 §1 whose class R1 §5 says mpd *must not keep*: the three RTL skill
trees, the verif plugin, the LSP overlay, the RTL guides, the golden fixtures, the profile data.
**Concrete paths (measured at the pinned revision, non-exhaustive by construction — see C10's
completeness equation).**
* `skills/rtl-ip-flow/**`, `skills/rtl-codestyle/**`, `skills/rtl-verif/**` (35 files) — **absent, verified**
* `packages/mpd-verif-plugin/**` (24 committed paths + 1 gitignored log) — **absent, verified**
* `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` — **PRESENT (residual)**; HDL rows inside
  `packages/mpd-mcp-lsp/overlay/lsp/{server-definitions.ts,language-mappings.ts}` and the built
  `packages/mpd-mcp-lsp/dist/cli.js`, plus the RTL section of `packages/mpd-mcp-lsp/README.md`
  (L34–L52) and `README.zh-CN.md` (L51) — **PRESENT (residual)**
* `docs/rtl-verif-guide{,.zh-CN}.md`, `docs/rtl-ip-flow-guide{,.zh-CN}.md`,
  `docs/rtl-gap-assessment{,.zh-CN}.md` — **PRESENT (6 paths, residual)**
* `tests/golden/fixtures/verilog/{README.md,modules/adder4.v,modules/cnt8.v,tb/tb_adder4.v}` —
  **PRESENT (residual)**
* `skills/lsp-setup/references/{verilog,systemverilog}/README.md`, `presets/rtl-ip.profile.json` —
  **absent, verified**
**Classification rule.** A path is B1 iff (a) R1 §5's must-not-keep list names its class, or
(b) R3 §A's `DEL` list contains it. Anything else that merely *mentions* RTL belongs to B2/B3/B4.

### B2 · BRIDGE-BY-DESIGN — **IN SCOPE** (must be coherent, not merely present)
**Definition.** A tracked, mpd-resident path or string that names RTL but carries no RTL content,
existing solely to connect mpd to the silicon bundle. It is legitimate **only while a formal
record designates it**, and it must resolve at the audited revision.
**Concrete paths (measured).** `scripts/verify-rtl-references.mjs`; `skills/dsh-qa/scripts/rtl-verif.mjs`;
`skills/dsh-qa/scripts/rtl-ip-profile.mjs`; the `rtl-ip-profile` row of `skills/dsh-qa/SKILL.md`
(L62); `skills/lsp-setup/SKILL.md` L46–47 (HDL routing rows → silicon paths); `docs/index.md` L19 /
`docs/index.zh-CN.md` L18; `AGENTS.md` L139; and the two §5 allow-list items — the `rtl-ip` carrier
hook and the README "RTL capability moved" note (**both currently absent → bridge gaps, not
residuals**).
**Ruling.** IN SCOPE and *conditionally* legitimate: each instance is checked for (i) a designating
record, (ii) resolution of its silicon target, (iii) SKIP-with-reason when silicon is absent,
(iv) no assertion of the removed mpd-side layout, (v) registration where the case owns a script.
A bridge instance may also be **retired** instead (that is a lawful disposition — see I4); what is
never lawful is an *unregistered*, *dangling*, or *layout-asserting* bridge.

### B3 · SILICON-CONTENT — **OUT OF SCOPE as content; IN SCOPE as the parity target**
**Definition.** Everything under the sibling checkout `my-power-dsh-silicon` (resolved as
`$MPD_SILICON_ROOT` else `../my-power-dsh-silicon`, R12 L24): `packages/mpd-verif-plugin/**`,
`packages/mpd-mcp-lsp/**` (incl. `references/{verilog,systemverilog}/`), `skills/rtl-{ip-flow,codestyle,verif}/**`,
`presets/rtl-ip.profile.json`, `tests/golden/fixtures/verilog/**`, the six `docs/` guides,
`docs/dependency-map{,.zh-CN}.md`, `docs/sync-policy.md`, `evidence/**`.
**Ruling.** OUT OF SCOPE for mpd's tree audit (mpd must not edit it: R1 §2 L32, `AGENTS.md` §5).
IN SCOPE for exactly two things: **(a)** every path R3 §A moved must exist at its recorded new
home, and **(b)** the silicon-side gates must be green so an mpd survivor cannot be justified by
"it exists in silicon" (C9). A bridge whose target is missing in B3 is a **dangling bridge**.

### B4 · UNTRACKED-BUILD-ARTIFACT — **OUT OF SCOPE as repo content; IN SCOPE as distribution hygiene**
**Definition.** Bytes in the mpd workspace that are gitignored or uncommitted: `.venv-rtl/`
(ignored, `.gitignore` L23–26), `.mpd/` incl. `.mpd/verif/{sim,logs}` (L21), `.mpd-dsh/` (L11),
`.toolchain/` (L6), `dist/mpd-package/` (L12), plus stray sim outputs (`*.vvp`, `sim_build/`).
**Measured instances.** `.venv-rtl/` present; `.mpd/verif/{sim,logs}` present; `dist/mpd-package/`
present and **stale**: it still contains `skills/lsp-setup/references/{verilog,systemverilog}/README.md`,
two paths deleted from the tree by R5 (pack built 2026-09-13T01:04, deletion at 01:51) — a
**distribution residual** because `dsh plugin add dist/mpd-package` would install it.
**Ruling.** OUT OF SCOPE as a "repo residual" (never committed, never shipped by
`dsh plugin add .` — pack surface = R12-adjacent `scripts/pack-mpd.mjs` L21–64); IN SCOPE for a
declaration + hygiene check: every instance must be proven ignored (C8) and **no installable
artifact may carry a B1 path**. A **tracked** path is *never* B4 by definition — that is the line
that keeps this bucket from swallowing real residuals.

### Declared out-of-scope records (must be enumerated, never silently skipped)
`evidence/**` (633 tracked RTL-named paths), the tracked process dirs `.silicon-extraction/**` and
`t5-closure-evidence/**`, and `docs/adder4.md` / `docs/cnt8.md` (internal QA reference docs named
by `AGENTS.md` §3) are **historical/process records**: R1 §2 and `AGENTS.md` §3/§7 exempt them and
forbid rewriting them. They are OUT OF SCOPE as content, but C10 requires the ledger to state their
counts, so "everything is history" cannot be used as a silent blanket.

---

## 3. Acceptance criteria

| ID | Bucket | Falsifiable assertion | Re-runnable check | Formal record |
|---|---|---|---|---|
| C1 | B1 | No RTL skill tree survives and the corpus fingerprint is converged at 329 files | `git ls-files skills \| wc -l` = 329; `test ! -e skills/rtl-ip-flow && test ! -e skills/rtl-codestyle && test ! -e skills/rtl-verif`; `node scripts/verify-vendor.mjs` exit 0 | R3 §A/§C L121–129, R4 (35 files), R5, R13 |
| C2 | B1 | No verif-plugin surface or row survives in the shipped tree or any manifest, and every remaining textual hit is a declared string fixture | `test ! -d packages/mpd-verif-plugin`; `git grep -n -E 'mpd-verif-plugin\|mpd_verif_' -- packages scripts package.json ':!evidence'` = only the 7 declared string hits (below); `node scripts/verify-rows-parity.mjs` exit 0 (21 ids); `node scripts/pack-mpd.mjs` stages no `mpd-verif-plugin` | R3 §A2 L101–103, R4, `AGENTS.md` §12 |
| C3 | B1 | No HDL language-service asset is registered or shipped by mpd | `test ! -e packages/mpd-mcp-lsp/templates/rtl-lsp-client.json`; `grep -rniE 'verible\|slang-server' packages/mpd-mcp-lsp/{overlay,dist}` = 0; RTL section gone/repointed in `packages/mpd-mcp-lsp/README{,.zh-CN}.md` | R1 §1 L14–17 + §5 L85–91, R7 L34/L49, R5 |
| C4 | B1 | None of the six RTL guides remains in `docs/`, and no index link dangles after removal | `for f in rtl-verif-guide{,.zh-CN}.md rtl-ip-flow-guide{,.zh-CN}.md rtl-gap-assessment{,.zh-CN}.md; do test -e docs/$f && echo RESIDUAL; done` = no output; every RTL row of `docs/index.md`/`.zh-CN.md` link resolves | R1 §1 L20–23 + §5 L85–91, R3 §A3 L114, R7, R8 |
| C5 | B1 | The golden Verilog fixtures have exactly one live home (silicon), or an mpd copy is BY-DESIGN with a named record | `git ls-files tests/golden/fixtures/verilog` = empty; `git grep -l 'fixtures/verilog' -- tests packages skills scripts presets` = empty (no live mpd consumer) | R1 §1 L20–23 + §5 L90–91, R6, measured sha256 parity with silicon |
| C6 | B2 | The two §5 allow-list remnants exist and work: the profile **data** stays out, the carrier hook and pointer note are in | `test ! -e presets/rtl-ip.profile.json`; `git grep -n 'rtl-ip.profile.json' -- packages scripts presets ':!evidence'` ≥ 1; `grep -ni silicon README.md` ≥ 1; hook behaviour per R2 (apply-time read, absent/corrupt → `{}`, `{...fromSilicon, mpd}` merge, ≤16 profiles) proven by a **mounting** boot, not `--dump-config` | R1 §1 L20–23, §5 L83–91; R2 (hook contract); R9 L58 |
| C7 | B2 | Every remaining RTL-named bridge resolves against silicon, never against the removed mpd layout, and owns its registration | `node scripts/verify-rtl-references.mjs` exit 0 (0 unresolved); `MPD_SILICON_ROOT=/nonexistent node skills/dsh-qa/scripts/rtl-{verif,ip-profile}.mjs --self-test` exit 0 with a printed SKIP; `grep -c '^\| rtl-verif ' skills/dsh-qa/SKILL.md` ≥ 1; `rtl-ip-profile` row text no longer claims the mpd patch ships the profile; `git grep -n '/root/dshProj' -- scripts skills docs ':!evidence'` = 0 | R6, R7 L49, R10 F4, R12 L24–37/L65–78, `AGENTS.md` §7 |
| C8 | B4 | Every uncommitted/ignored artifact is declared, proven ignored, and no installable artifact carries a B1 path | `git status --porcelain --ignored` records the set; `git check-ignore -v .venv-rtl .mpd dist/mpd-package .toolchain`; `find dist/mpd-package \( -path '*rtl-*' -o -path '*mpd-verif*' -o -path '*verilog*' -o -path '*systemverilog*' \)` = no FULL-STRIP path | `.gitignore` L6/L11/L12/L21/L23–26, `scripts/pack-mpd.mjs` L21–64, R3 §A (73 logged vs 72 committed deletions) |
| C9 | B3 | The silicon bundle holds every moved asset at its recorded home, with green own-side gates (parity target, not mpd content) | `git -C $MPD_SILICON_ROOT status --porcelain` clean + `rev-parse HEAD` = `bf3dae2…`; `node $MPD_SILICON_ROOT/scripts/verify-corpus.mjs` exit 0; `node $MPD_SILICON_ROOT/scripts/verify-rows-disjoint.mjs` exit 0; each of R3 §A's 73 `DEL` paths exists at its recorded new home | R1 §1 L14–19/§3 L66–78, R3 §A, R8 §1, measured mpd↔silicon sha256 table |
| C10 | all | The verdict is pinned to settled hashes, and the ledger's row set equals the union of the two enumeration axes plus the declared exclusions | `git rev-parse HEAD` = `32ae54dd…` re-checked after a settle window; `git status --porcelain`; ledger row count = (path-pattern axis ∪ content-pattern axis) − declared exclusions | `AGENTS.md` §7 ("Verify on SETTLED hashes"), §3 (process records), R12 L37 (`IGNORE`) |

### Per-criterion detail (exact commands, expected observation, measured state at the pin)

**C1 — RTL skill trees + fingerprint.**
```bash
git ls-files skills | wc -l                                  # expect 329
git ls-files skills | grep -c 'rtl-\(ip-flow\|codestyle\|verif\)/' # expect 0
node scripts/verify-vendor.mjs                               # expect exit 0
```
Record: R3 §A lists 35 skill-tree deletions; R4 re-pinned 366→331; R5 re-pinned 331→**329** and
reported `asset OK: skills 329 files`; R13 pins `fileCount` 329 / `treeSha` `8a0f05f0…`. Measured:
`git ls-files skills | wc -l` = **329** and no `rtl-*` tree present → C1 holds at the pin.

**C2 — verif plugin + row surface.**
```bash
test ! -d packages/mpd-verif-plugin                          # expect true
git grep -n -E 'mpd-verif-plugin|mpd_verif_' -- packages scripts package.json ':!evidence'
node scripts/verify-rows-parity.mjs                          # expect exit 0, 21 row ids
node scripts/pack-mpd.mjs && ls dist/mpd-package/packages    # expect no mpd-verif-plugin
```
Record: R3 §A2 (L101 patch row + `profiles.rtl-ip` block removed; L102 install-profile row and its
B9 assertion removed; L103 `PLUGIN_PKGS` 15→14); R4. Measured: the plugin directory is **absent**,
and the grep returns exactly **7 textual hits, none of them a live reference** — 5 string fixtures
in `packages/mpd-agent-teams-plugin/self-fix-tests/scope-glob-and-contract.test.mjs`
(L9/L56/L57/L159/L172, a scope-glob test whose sample paths happen to spell the old plugin dir) and
2 synthetic self-test controls in `scripts/verify-rtl-references.mjs` (L99/L107), which are
*designed* to resolve against the silicon root. **Disposition: keep-with-record** — the ledger must
enumerate these 7 sites and state that no artifact, row, or path resolution in the mpd tree still
depends on the removed plugin. **Note:** the tool names (`mpd_verif_*`) are declared by the plugin,
not by the patch, so a patch-only check cannot see them; the content grep above is the check.

**C3 — HDL language-service assets (the sharpest live residual class).**
```bash
test ! -e packages/mpd-mcp-lsp/templates/rtl-lsp-client.json # expect true
grep -rniE 'verible|slang-server' packages/mpd-mcp-lsp/overlay packages/mpd-mcp-lsp/dist
grep -niE 'verible|slang-server|references/(verilog|systemverilog)' packages/mpd-mcp-lsp/README.md packages/mpd-mcp-lsp/README.zh-CN.md
```
Record: R1 §1 names the HDL language-service assets as silicon-owned; R1 §5 forbids keeping "the
LSP overlay"; R7 L34 and L49 name `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` and
`packages/mpd-mcp-lsp/dist/cli.js` as silicon-owned (landed with t16); R5 kept the skill-side
routing rows only as pointers. Measured residuals at the pin: the 263-byte
`templates/rtl-lsp-client.json` exists (and is byte-identical to silicon's copy);
`overlay/lsp/language-mappings.ts` L13–15/L186–189 and `overlay/lsp/server-definitions.ts`
L13–15/L173–174 still declare `verible` (`.v .vh`) and `slang-server` (`.sv .svh`); the built
`dist/cli.js` (sha256 `04b49f8c…`, `dist/BUILD.lock`) carries 4 HDL hits, i.e. mpd's `mcp-lsp`
row would still register HDL servers; `README.md` L34–L52 advertises the RTL LSP support and
points at `references/verilog/README.md` / `references/systemverilog/README.md`, which R5 deleted
from `skills/lsp-setup` — **a dangling claim**. Any disposition is acceptable (strip the HDL rows
and rebuild `dist/`, or retire mpd's LSP MCP row) provided the checks above return empty. The
`skills/lsp-setup/SKILL.md` L46–47 routing rows are **B2, not B1** — they carry no HDL body.

**C4 — the six RTL guides.**
```bash
for f in rtl-verif-guide{,.zh-CN}.md rtl-ip-flow-guide{,.zh-CN}.md rtl-gap-assessment{,.zh-CN}.md; do
  test -e "docs/$f" && echo "RESIDUAL docs/$f"; done        # expect no output
grep -n 'rtl-' docs/index.md docs/index.zh-CN.md            # every surviving row must link an existing file or the silicon URL
```
Record: R1 §5 forbids keeping "the RTL guides"; R3 §A3 L114 kept them **with a named owner**
("migrate to silicon: follow-up (t20), then delete here"); R7 L12–L42 shows the migration landed
(six docs copied, then corrected); R8 shows t20 landed. Measured at the pin: **all six present**
in `docs/`; four of the six differ from their silicon twins (measured sha256, mpd↔silicon:
`rtl-verif-guide.md` `b763ba9a…`/`c6b33b2b…`, `.zh-CN` `eb7951d1…`/`47865b94…`,
`rtl-gap-assessment.md` `eeec2c26…`/`817142e7…`, `.zh-CN` `a3d7b4a7…`/`b59d15da…`), i.e. the mpd
copies are stale duplicates; the two `rtl-ip-flow-guide` files are byte-identical
(`e7865096…` / `f786e018…`). `docs/index.md` L19 still links `rtl-verif-guide.md` → the index row
must be repointed to the silicon URL in the same change (R1 §5 L84–86 allows exactly that note).

**C5 — golden Verilog fixtures.**
```bash
git ls-files tests/golden/fixtures/verilog                   # expect empty
git grep -l 'fixtures/verilog' -- tests packages skills scripts presets  # expect empty
sha256sum tests/golden/fixtures/verilog/modules/*.v tests/golden/fixtures/verilog/tb/*.v \
          "$MPD_SILICON_ROOT"/tests/golden/fixtures/verilog/modules/*.v "$MPD_SILICON_ROOT"/tests/golden/fixtures/verilog/tb/*.v
```
Record: R1 §1/§5 name "the golden Verilog fixtures" as silicon-owned and forbidden in mpd; R6
repointed the only case that exercised them so it reads the silicon bundle. Measured at the pin:
`tests/golden/fixtures/verilog/{README.md,modules/adder4.v,modules/cnt8.v,tb/tb_adder4.v}` are
tracked, and their sha256 match the silicon copies exactly (`ab0d0cbc…`, `eeecd694…`, `0e43651a…`,
`1b7a1638…`) with **no mpd-side executable consumer** (only `docs/adder4.md` L7, `docs/cnt8.md` L7,
`docs/rtl-gap-assessment*.md` and historical `evidence/**` reference them). Disposition: delete;
if `docs/adder4.md` / `docs/cnt8.md` stay (they are named internal QA docs by `AGENTS.md` §3), their
`Source file:` lines must be repointed at the silicon fixtures in the same change.

**C6 — the §5 allow-list, both directions (the dangling-bridge criterion).**
```bash
test ! -e presets/rtl-ip.profile.json                        # expect true (DATA stays out)
git grep -n 'rtl-ip.profile.json' -- packages scripts presets ':!evidence'   # expect >= 1 (the HOOK reads it)
grep -ni silicon README.md                                   # expect >= 1 (the pointer note)
```
Record: R1 §1 L14–23 (profile data silicon-owned; mpd keeps exactly the hook + a pointer),
§5 L83–91; R2 freezes the hook contract: read at **apply() time** (never import time), missing or
corrupt file → `{}` and boot unchanged (a mpd-only install is the normal case), merge as
`profiles: { ...fromSilicon, mpd: <mpd's own> }` with the mpd-owned `mpd` key winning, and keep
`MAX_TEAM_PROFILES = 16` in mind; R9 L58 records that the carrier *has not landed*.
Measured at the pin: `presets/rtl-ip.profile.json` **absent** (correct); **0** hits in
`packages/ scripts/ presets/` → the carrier hook is **absent** (a hit in
`skills/dsh-qa/scripts/rtl-ip-profile.mjs` L24 or `rtl-verif.mjs` L36 is a QA-side read of the
*silicon* file and does **not** satisfy this criterion); `README.md` / `README.zh-CN.md` contain
**0** silicon/RTL mentions, i.e. no "moved" note (the note exists only in `AGENTS.md` L139 and
`docs/index.md` L19). The hook is a **bridge gap**, never a residual; its proof is a **mounting**
boot with registration instrumentation on an mpd-only install (silicon absent) **and** on an
mpd+silicon install showing the `rtl-ip` profile in the composed `agent-teams` row —
`--dump-config` is not evidence here (`AGENTS.md` §4).

**C7 — bridge resolution, registration, and layout honesty.**
```bash
node scripts/verify-rtl-references.mjs --self-test && node scripts/verify-rtl-references.mjs
MPD_SILICON_ROOT=/nonexistent node skills/dsh-qa/scripts/rtl-verif.mjs --self-test
MPD_SILICON_ROOT=/nonexistent node skills/dsh-qa/scripts/rtl-ip-profile.mjs --self-test
grep -c '^| rtl-verif ' skills/dsh-qa/SKILL.md   ; grep -n '^| rtl-ip-profile ' skills/dsh-qa/SKILL.md
git grep -n '/root/dshProj' -- scripts skills docs ':!evidence'
```
Record: `AGENTS.md` §7 (a case owns a `SKILL.md` table row; settled-hash discipline); R6 created
the repoint + the gate; R10 F4 certifies "the two RTL cases live again"; R12 L24–37/L65–78 gives
the gate's roots/`PENDING`/`IGNORE`. Measured at the pin: both cases resolve
`$MPD_SILICON_ROOT` else `../my-power-dsh-silicon` (`rtl-verif.mjs` L32,
`rtl-ip-profile.mjs` L23) and print `SKIP` with a reason when it is absent (L72/L103/L183 and
L46/L70/L115) — correct; **`rtl-verif` has NO `SKILL.md` case row (0 matches) while
`rtl-ip-profile` has one (L62) whose text still asserts "bundle patch ships the rtl-ip roster
profile … composed boot shows the profile in the agent-teams row config"**, i.e. the pre-strip
mpd-side layout → two bridge defects to repair (register the live case; rewrite the stale row).
**Gate blind spot the ledger must compensate for:** `resolve()` accepts mpd's own checkout as a
root (`roots: [SILICON, repoRoot]`, R12 L75–76), so a reference that resolves *only* in the mpd
checkout is still bucketed `resolved`; the gate alone cannot prove that no pre-strip mpd path
survived. The ledger must apply the B1/B2 rule to every token the gate reports as `resolved`.

**C8 — untracked artifacts and the pack.**
```bash
git status --porcelain --ignored | grep '^!!'      # declare every ignored instance
git check-ignore -v .venv-rtl .mpd dist/mpd-package .toolchain
find dist/mpd-package \( -path '*rtl-*' -o -path '*mpd-verif*' -o -path '*verilog*' -o -path '*systemverilog*' \)
```
Record: `.gitignore` L6/L11/L12/L21/L23–26; `scripts/pack-mpd.mjs` L21–64 defines what actually
ships (PLUGIN_PKGS + MCP_PKGS + `skills/` + `presets/` + licence/README + patch + install script —
`docs/` and `tests/` never ship); R3 §A logs **73** `DEL` paths while R4's commit removed **72**
files — the extra entry is the gitignored
`packages/mpd-verif-plugin/.mpd/verif/logs/lint-iverilog-20260911-110219-628.log`, which no commit
records. Measured at the pin: `.venv-rtl/`, `.mpd/`, `.mpd-dsh/`, `.toolchain/`, `dist/mpd-package/`
present; the pack **fails** this criterion — `dist/mpd-package/skills/lsp-setup/references/{verilog,systemverilog}/README.md`
(2 files) still exist there after R5 deleted them from the tree. Repair = regenerate the pack (or
delete it) so the installable artifact carries no B1 path.

**C9 — silicon parity (out of scope as content).**
```bash
git -C "$MPD_SILICON_ROOT" status --porcelain ; git -C "$MPD_SILICON_ROOT" rev-parse HEAD
node "$MPD_SILICON_ROOT"/scripts/verify-corpus.mjs         # expect exit 0 (self-held baseline)
node "$MPD_SILICON_ROOT"/scripts/verify-rows-disjoint.mjs  # expect exit 0 (zero row-id intersection)
```
Record: R1 §1 L14–19 (single authority), §3 L66–78 (row-id disjointness is a *necessary* condition —
coexistence is proven by mounting, not by `--dump-config`); R3 §A maps all 73 removed paths to
their new homes; R8 §1 commits the per-file sha256 baseline. Measured: silicon `HEAD` =
`bf3dae2530949d9fe410cec9b25b5581bdbcc58e` with a clean worktree; all sampled moved assets exist
there. **Measurement caveat (must be recorded, not smoothed over):** a hash match proves content
equality only — it is **not** evidence of an independent copy; record inode/link status alongside
each comparison (measured for the pairs checked: different inodes, mpd link count 1, silicon link
count 2) and never write "independent copy" where only equality was measured.

**C10 — pinning and ledger completeness.**
```bash
git rev-parse HEAD                       # expect 32ae54dd10db7ea46e1c1263143d56f266fd1f78
sleep 50 && git rev-parse HEAD           # expect unchanged (settle window, AGENTS.md §7)
git -C "$MPD_SILICON_ROOT" rev-parse HEAD
git status --porcelain
```
Completeness equation the ledger must satisfy:
`rows == (path-pattern axis ∪ content-pattern axis) − declared records`, where
* **path-pattern axis** = `git ls-files` filtered by `rtl|verif|cocotb|uvm|hdl|verilog|systemverilog|\.(v|sv|vh|svh|vinc)$`
  over the shipped surface (~14 real paths + 3 fuzzy false positives at the pin — see §5);
* **content-pattern axis** = `git grep -n -iE 'verible|slang-server|mpd_verif_|rtl-ip|cocotb|uvm' -- packages skills presets scripts docs tests package.json ':(exclude)packages/mpd-agent-teams-plugin/_deps'`
  which is what catches `packages/mpd-mcp-lsp/README.md`, the overlay HDL rows, `docs/index.md` L19
  and the `AGENTS.md` L139 pointer — paths a name filter alone misses;
* **declared records** = `evidence/**` (633 RTL-named tracked paths), `.silicon-extraction/**`,
  `t5-closure-evidence/**`, `docs/adder4.md`, `docs/cnt8.md` — counted, never skipped silently.

---

## 4. Inference register (every non-quoted claim, with its sources and its falsifier)

| ID | Inferred claim | Sources | Falsifier |
|---|---|---|---|
| I1 | The **overlap window** of R1 §2 L32 ("its copies exist for comparison only") is **closed** at the pinned revision, so the six mpd-side RTL guides and the golden fixtures now fall under §5's must-not-keep list rather than under the comparison exemption | R3 §A3 L114 ("migrate to silicon: follow-up (t20), **then delete here**"), R7 L12–42 (port done), R8 §1–§3 (t20 landed), R4 (the inline profile copy already deleted) | any record dated after t20 that extends the window or re-designates an mpd-side copy as a live source |
| I2 | "the LSP overlay" in R1 §5 denotes `packages/mpd-mcp-lsp/{overlay,templates,dist}` (not only a skill-side table), so mpd's HDL registry rows, template and built CLI are B1 | R1 §1 L14–17 (HDL language-service assets = RTL capability), R7 L34/L49, silicon `packages/mpd-mcp-lsp/package.json` description ("the RTL registry overlay, the client template, the HDL reference docs, and the offline-built MCP CLI"), byte-identical overlay files in both checkouts | a record assigning the generic multi-language LSP overlay to the mpd bundle (which would leave only the HDL rows/template as B1) |
| I3 | The `rtl-ip` carrier hook has **not landed** in mpd at the pinned revision (a dangling bridge, not evidence of over-stripping) | measured: 0 non-evidence hits for `rtl-ip.profile.json`; `presets/rtl-ip.profile.json` absent; R9 L58 ("the mpd-side carrier (task t15) has not landed"); R2 (the hook is mpd's to build) | a landed hook in a revision later than the pin, or a record reassigning the hook to silicon |
| I4 | The two mpd RTL QA cases are **bridges by design**, not B1 content — and may lawfully be *retired* instead of kept | R6 (the repoint commit), R10 F4 ("the two RTL cases live again"), `AGENTS.md` §7 (a case owns a table row) — versus the t8 mandate "retire the RTL test cases" | a formal ruling that retires them: then C7's check changes to "absent", and the disposition is recorded per row (the contract accepts either outcome, it only forbids an unregistered/dangling/layout-asserting bridge) |
| I5 | The three fuzzy path matches (`scripts/verify-rows-parity.mjs`, `scripts/verify-vendor.mjs`, `skills/lsp-setup/scripts/verify-lsp.ts`) are **not** RTL paths: they match only the substring `verif` in "verify" (measured: HDL mention count 0 each) | measured in this audit | any of them actually carrying HDL/RTL content |
| I6 | `docs/adder4.md` and `docs/cnt8.md` may remain mpd-resident (named internal QA docs by `AGENTS.md` §3) **only** with their `Source file:` lines repointed at the silicon fixtures once C5 deletes the mpd copies | `AGENTS.md` §3, measured `Source file: tests/golden/fixtures/verilog/...` in both | a ruling moving those docs to silicon, or keeping the fixtures in mpd |
| I7 | The 7 `mpd-verif-plugin` textual hits are **string fixtures, not live references** (5 in `packages/mpd-agent-teams-plugin/self-fix-tests/scope-glob-and-contract.test.mjs` L9/L56/L57/L159/L172; 2 synthetic controls in `scripts/verify-rtl-references.mjs` L99/L107), so C2 is satisfied by their enumeration rather than by a zero-count grep | measured in this audit (`git grep -n -E 'mpd-verif-plugin\|mpd_verif_' -- packages scripts package.json ':!evidence'` → 7) | any hit that resolves, launches, or asserts a path in the mpd tree instead of in the silicon root |
| I8 | The reference gate cannot by itself prove that no pre-strip mpd path survived, because `resolve()` accepts mpd's own checkout as a root | R12 L75–76 (`roots: [SILICON, repoRoot]`), measured `PASS — 42 resolved, 6 pending-by-design, 0 unresolved` at the pin | a gate change that reports the resolving root per token (then the ledger could rely on it directly) |

---

## 5. Ledger requirements (what the sweep must emit) and measurement caveats

1. **One row per survivor**, every row carrying: `path` · `bucket (B1…B4)` · `measured command +
   observed output` · `record citation (file:line or sha)` · `disposition (delete / keep-with-record
   / declare)` · `owner task`. A row without a citation is not admissible.
2. **Both axes, not one.** A path-name filter alone is insufficient (it misses
   `packages/mpd-mcp-lsp/README.md`, the overlay HDL rows, `docs/index.md` L19, `AGENTS.md` L139);
   a content grep alone is insufficient (it misses empty-but-present directories and the stale
   pack). C10's equation is the completeness test.
3. **Exclusions are declared, not implied.** State the `evidence/**` count (633 RTL-named tracked
   paths at the pin), the two root-level process dirs, and the two internal QA docs, with the rule
   that authorizes them (`AGENTS.md` §3/§7 + R1 §2) — so a reviewer can falsify the exclusion.
   The same applies to **string-only hits**: a textual match on a removed path that is a test
   fixture or a synthetic gate control (I7) is `keep-with-record`, not a residual — and never a
   silent omission.
4. **The `DEL` cross-check is mandatory.** All 73 paths in R3 §A must be tested absent, and the
   73-vs-72 delta (the gitignored `.mpd/verif/logs/…` log) must be recorded in B4.
5. **No gate result may be replaced by composition.** The carrier hook (C6) and any row/tool
   question require a **mounting** boot with registration instrumentation; `--dump-config` proves
   composition only (`AGENTS.md` §4). Case self-tests are `--self-test` evidence only; a "real
   pass" for `rtl-verif.mjs`/`rtl-ip-profile.mjs` additionally needs the silicon checkout.
6. **No absolute machine paths** may be introduced by the repair (`git grep -n '/root/' --
   scripts skills docs presets packages ':!evidence'` = 0): R1 §6 forbids machine-specific
   locations; `$MPD_SILICON_ROOT` / `../my-power-dsh-silicon` indirection is the sanctioned form.
7. **Settled hashes only** (C10): record the pin, re-check it after a settle window, and anchor
   every verdict to the hashes actually measured; a half-landing tree invalidates the run.

---

## 6. Verdict rule (restated for the reviewer)

* **PASS — "completely stripped"** iff C1–C8 and C10 hold on the pinned hashes; C9 supplies parity
  evidence (a C9 failure is a cross-repo defect to report, not an mpd residual).
* **FAIL — residual** if any of C1–C8 fails: the failing paths form t8's repair list, one ledger
  row each.
* **Bridge gaps** (C6 hook + README note, C7 case registration / stale case row) are reported in a
  separate section of the verdict: they are *missing link*, not *leftover content*. They must
  never be silently converted into a pass (hides a broken declared contract) nor into a residual
  (overstates the strip failure).
