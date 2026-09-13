# t5 — independent false-negative probes

Task t5 · verifier Reviewer · pinned revision `32ae54dd10db7ea46e1c1263143d56f266fd1f78`.
Each probe is an independent falsification attempt: a *nothing-probe* is a probe whose designed
answer was "the earlier tasks' claim should leave a trace here" and whose measured answer was empty.
Probes are deliberately on **both axes** required by t2's contract: a **path/name axis** (A-series)
and a **content axis** (B/C-series), because a name filter misses `docs/index.md`'s hub link, the LSP
README and the overlay rows, while a content grep misses the stale pack.
All raw output is under `raw/`; commands below are byte-exact except for shortened paths.

| Probe | Axis | Command (short) | Result | Raw |
|---|---|---|---|---|
| P1 | path/name (tracked, whole repo) | `git ls-files \| grep -iE '(^|/)(verilog\|systemverilog\|hdl)\|\.(v\|vh\|sv\|svh)$\|rtl\|verif\|verible\|slang\|cocotb\|adder4\|cnt8\|iverilog\|verilator'` | **652** hits — 633+ of them under `evidence/**` (process records); outside evidence the residual set is exactly the families in this audit | `raw/axisA-paths.txt`, `raw/axisAB-sweep.log` |
| P2 | content (tracked, evidence excluded) | `git grep -l -iE 'verible\|slang-server\|iverilog\|verilator\|cocotb\|mpd_verif\|mpd-verif\|rtl-ip\|\bverilog\b' -- . ':!evidence' ':!.mpd'` | **38** files, including the two `docs/index*` hub rows and the LSP READMEs a name-only filter would miss | `raw/axisB-files.txt`, `raw/axisAB-sweep.log` |
| **P3** | **falsifiability control** | `git grep -l 'mpd-mcp-lsp' -- . ':!evidence'` (a token *known* to exist) | **10 files** — proves the P1/P2 pipeline finds real hits, so an empty probe result below is informative, not a broken search | `raw/axisAB-sweep.log` |
| P4 | path+name, consumer search (**nothing-probe**) | `grep -rn 'fixtures/verilog' tests/ scripts/ skills/ packages/ presets/ docs/` and `grep -rln -E 'adder\.v\|adder_tb\|good\.v\|bad\.v' tests/ scripts/ skills/ packages/ presets/` | Only **documentation** hits + one non-consumer code hit (`rtl-verif.mjs` writes its **own** inline `adder.v`/`adder_tb.py`, `:201-202`). No executable reader of `tests/golden/fixtures/verilog/**` exists. Confirms K3's zero-consumer claim. | `raw/claim3-golden-fixtures.log`, `raw/claim3-4-supplement.log` |
| P5 | content, live-artifact + wiring | `grep -n -iE 'verible\|slang' …/dist/cli.js`; `grep -n -B2 -A12 'id: mcp-lsp' packages/mpd-bundle/cordis.patch.yml`; `grep -n -A4 'mpd-mcp-lsp' VENDOR_LOCK.json` | **4 verible + 4 slang** in the dist; the `mcp-lsp` row launches that exact file; `VENDOR_LOCK` sha-pins it. HDL capability is live, not dormant source. | `raw/claim1-lsp-hdl.log`, `raw/claim1-liveness2.log` |
| P6 | gate-parasitism audit (**nothing-probe**) | `node scripts/verify-rtl-references.mjs --json` + `test -e` on each `resolved` token | Gate considers **48** references; its subjects are the six silicon docs + the two mpd cases. None of the audited mpd-side residuals (overlay, dist, fixtures, RTL guides, LSP README/template) is ever a subject; five "resolved" tokens are **absent from mpd** (`skills/rtl-codestyle`, `skills/rtl-verif`, `…/fixtures/adder4`, `packages/mpd-verif-plugin/evidence/smoke/`, `…/dist/index.js`). | `raw/claim5-gate-run.log`, `raw/demo-blindness-B.log` |
| P7 | untracked / ignored axis | `for p in .venv-rtl .toolchain/bin/verible-verilog-ls dist/mpd-package; do … git check-ignore …; done` | All three present and gitignored; `.toolchain/bin/verible-verilog-ls` (6 MB) and `.venv-rtl/` (cocotb) are machine-state leftovers invisible to any tracked-file sweep. | `raw/probes-P8-P12.log` |
| P8 | HDL-extension axis (tracked, evidence excluded) | `git ls-files \| grep -vE '^evidence/\|^\.mpd/' \| grep -E '\.(v\|vh\|sv\|svh)$'` | **3** files — the Verilog fixtures. No stray HDL source elsewhere in the tracked tree. | `raw/probes-P8-P12.log` |
| P9 | fixture-purpose probe (**nothing-probe**) | `head -20 tests/golden/fixtures/verilog/README.md`; `ls tests/golden/out` | The fixture `README.md` is a **task prompt** ("Create modules/adder4.v … No simulator needed"); `tests/golden/out/**` references `tests/mcp-fixtures/sample.c`, not the Verilog fixtures. No harness, no wiring. | `raw/probes-P8-P12.log` |
| P10 | stale-pack axis | `ls -la dist/mpd-package/skills/lsp-setup/references/{verilog,systemverilog}/README.md`; `git check-ignore -v dist/`; mtimes vs `git log --format=%ci` of `12291a7`/`32ae54d` | Both deleted HDL pages present in the pack (2783/3093 B), pack built `01:04:09` vs extraction `01:04:32` and page deletion `01:51:10`; `.gitignore:12` covers `dist/mpd-package/`. | `raw/claim4-stale-pack.log` |
| P11 | composition probe for removed capability (**nothing-probe**) | `grep -rn -c 'mpd-verif\|rtl-ip\|mpd_verif' presets/mpd/ packages/mpd-bundle/cordis.patch.yml` | **0** on every file — no live preset/patch row carries the removed RTL capability; the waveform rows are commented out only (`cordis.patch.yml:92-125`). | `raw/probes-P8-P12.log`, `raw/census.log` |
| P12 | stale case-index probe | `grep -c 'rtl-ip-profile' skills/dsh-qa/SKILL.md` / `grep -c 'rtl-verif' …`; `grep -ln 'MPD_SILICON_ROOT\|SILICON' skills/dsh-qa/scripts/*.mjs` | **1** row for `rtl-ip-profile`, **0** for the `rtl-verif` case that `test:qa` actually runs; exactly the 2 RTL cases are silicon-coupled out of 25 scripts. (P12b: the `rtl-verif` count is the nothing-result.) | `raw/probes-P8-P12.log`, `raw/checks-A4-A6.log` |
| **P13** | **self-correction probe** | `git grep -n -iE '<axis-B pattern>' -- skills/ast-grep/scripts/ast_grep_helper.py`; `grep -n 'ast-grep' raw/axisB-files.txt` | I first read `skills/ast-grep/scripts/ast_grep_helper.py` as an axis-B content hit; the dedicated re-grep returns **exit 1 (no match)** and the file is **not** in `raw/axisB-files.txt` — it appears only in the *gate's* resolved-token list (a silicon-doc token that legitimately resolves to an mpd file). Corrected here so the probe list carries no false positive. | `raw/t1-coverage-check.log` |

## Blindness demonstration (the K5 falsification proper)

Two demonstrations, both using an **unmodified byte-copy** of `scripts/verify-rtl-references.mjs`
(sha256 `34a1c8d6e5ca46a00cb4d5e416c1068c45c14fce4e8255ec7d8a580fa15ad6db`, verified equal to the
repo file before the run — the copy is the *instrument*, not an edit):

* **Demo A (green while checking nothing).** A repo-shaped scratch root with **both RTL cases absent**
  (post-retirement shape) and an empty silicon root →
  `[rtl-refs] PASS — 0 resolved, 0 pending-by-design, 0 unresolved`, exit **0**,
  `"considered": 0` — while every audited mpd residual was present in the real tree.
  `raw/demo-blindness-A.log`
* **Demo B2/C (same bucket, opposite ownership).** A token present **only** on the mpd side and the
  same token present **only** on the silicon side both report `resolved` / exit 0; and every known
  residual family is matched by a `PENDING` prefix, so `resolve()` can never return `unresolved` for
  it. `raw/demo-blindness-B2C.log`, `raw/demo-blindness-B.log`

## Probe coverage statement

13 probes executed on both axes; 4 are nothing-probes (P4, P6, P9, P11) and 1 is a falsifiability
control (P3); 1 (P13) corrected a false positive of my own reading. Nothing in this file is copied
from another task's conclusion — the P-series commands were run by me against the pinned tree.
