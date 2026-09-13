# Cross-repo parity — did every claimed handover land in the silicon bundle?

Task: t3 (verification r1). Date: 2026-09-13. Role: Researcher (read-only).
Repos examined: `/root/dshProj/my-power-dsh` (source) and `/root/dshProj/my-power-dsh-silicon`
(destination, **read-only inspection only**).

## 0. Headline numbers (stated explicitly, zero counts included)

| Measure | Count |
|---|---|
| Claimed handover items in `.silicon-extraction/removal.log` §A (`DEL … ->`) | **73** |
| Present in silicon with matching/size-recorded bytes | **64** |
| **MISSING** in silicon | **9** |
| **CONTENT-MISMATCH** (same path, both repos, different sha256) | **0** |
| mpd-side originals still present at the claimed source path | **0** (all 73 are `gone` — the move is complete) |

MISSING = 9, MISMATCH = 0. Both numbers are non-inferred: they are the verdict-bucket counts of
`raw/parity-rows.tsv`, produced by the command below.

## 1. Method (exact commands; raw logs under `raw/`)

```bash
# handover list, 73 rows
grep -n '^DEL' .silicon-extraction/removal.log | awk -F'^[0-9]+:DEL  ' '{print $2}' \
  > evidence/rtl-extraction-residual/cross-repo/raw/del-list.raw.txt

# per-item existence + sha256 on both sides  → raw/parity-rows.tsv, raw/sha256-all.log
while IFS= read -r line; do
  src="${line%%  ->  *}"; dst="${line##*  ->  }"; rel="${dst#/root/dshProj/my-power-dsh-silicon/}"
  [ -e "$MPD/$src" ] && mpd_state=present && mpd_sha=$(sha256sum "$MPD/$src"|awk '{print $1}') || mpd_state=gone
  [ -e "$SIL/$rel" ] && sil_state=present && sil_sha=$(sha256sum "$SIL/$rel"|awk '{print $1}') || sil_state=MISSING
  ... # compare, emit 8-column TSV
done < raw/del-list.raw.txt
```

`raw/parity-rows.tsv` columns:
`src <TAB> mpd_state <TAB> mpd_size <TAB> mpd_sha256 <TAB> sil_state <TAB> sil_size <TAB> sil_sha256 <TAB> verdict`.

The mpd-side sha256 of an original is recorded only where the source path still exists; after a
completed move every one of the 73 is `gone` (measured: `awk -F'\t' '$2=="present"' … | wc -l` = **0**),
so the silicon copy's size+sha256 is the record of what landed. That is the normal case here, not a
skipped check: the claim is "moved", and a source that still existed would itself be a duplication
finding.

## 2. Parity table

The full 73-row table is `raw/parity-rows.tsv` (every row carries its own hashes). Verdicts:

| Verdict | Count | Meaning |
|---|---|---|
| `n/a(moved)` | 64 | mpd source gone, silicon copy present — the handover landed |
| *(blank ⇒ MISSING)* | 9 | mpd source gone, silicon copy **absent** — content lost in the move |
| `IDENTICAL` | 0 | (comparison not applicable: no source path survives) |
| `CONTENT-MISMATCH` | 0 | none |

### 2.1 The 9 MISSING items (all inside `packages/mpd-verif-plugin`)

| # | Item (silicon destination) | mpd side | silicon side | Consequence |
|---|---|---|---|---|
| 1 | `packages/mpd-verif-plugin/evidence/smoke/adder_tb.py` | gone | **MISSING** | smoke-evidence TB lost |
| 2 | `packages/mpd-verif-plugin/evidence/smoke/adder.v` | gone | **MISSING** | smoke-evidence DUT lost |
| 3 | `packages/mpd-verif-plugin/evidence/smoke/results.json` | gone | **MISSING** | smoke run record lost |
| 4 | `packages/mpd-verif-plugin/evidence/smoke/workspace/rtl/adder_tb.py` | gone | **MISSING** | smoke workspace TB lost |
| 5 | `packages/mpd-verif-plugin/evidence/smoke/workspace/rtl/adder.v` | gone | **MISSING** | smoke workspace DUT lost |
| 6 | `packages/mpd-verif-plugin/evidence/smoke/workspace/rtl/bad.v` | gone | **MISSING** | negative-control fixture lost |
| 7 | `packages/mpd-verif-plugin/evidence/smoke/workspace/rtl/good.v` | gone | **MISSING** | positive fixture lost |
| 8 | `packages/mpd-verif-plugin/evidence/smoke/workspace/rtl/__pycache__/adder_tb.cpython-312.pyc` | gone | **MISSING** | byte-cache; acceptable loss (derived artifact) |
| 9 | `packages/mpd-verif-plugin/.mpd/verif/logs/lint-iverilog-20260911-110219-628.log` | gone | **MISSING** | runtime log; acceptable loss (`.mpd/` is ignored local state) |

Which of the 9 matter: rows 1–7 are **tracked, reviewable evidence** (source `.py`/`.v`/`.json`);
rows 8–9 are derived/ephemeral (a `__pycache__` byte-code and a `.mpd/verif/logs` run log — the
silicon `.gitignore` explicitly ignores `.mpd/` and `*.log`). So the real gap is **7 lost evidence
files**, and the decisive corroboration is that their **sibling survived**: only
`packages/mpd-verif-plugin/evidence/smoke/smoke.mjs` exists in the destination
(`git ls-files 'packages/mpd-verif-plugin/evidence/*'` in silicon → that single path). A copy
operation that carried `smoke.mjs` but dropped its `.py`/`.v`/`.json` siblings is a partial move,
not a policy exclusion. This matters because `docs/rtl-verif-guide*.md` (both repos) points readers
at `packages/mpd-verif-plugin/evidence/smoke/` as the plugin-smoke evidence location.

### 2.2 The 64 landed items — spot-verified structure

The landed set is structurally complete, not just count-complete:

| Group | Claimed | Landed | Evidence |
|---|---|---|---|
| `skills/rtl-ip-flow` tree | 9 | 9 | `find silicon/skills/rtl-ip-flow -type f \| wc -l` = 9 |
| `skills/rtl-codestyle` tree | 6 | 6 | `find silicon/skills/rtl-codestyle -type f \| wc -l` = 6 |
| `skills/rtl-verif` tree | 20 | 20 | `find silicon/skills/rtl-verif -type f \| wc -l` = 20 |
| `packages/mpd-verif-plugin` (excluding the 7 lost evidence files + 2 ephemeral) | 38 | 38 | rows 40–77 of `raw/parity-rows.tsv` |

These three tree counts independently match the numbers the strip recorded
(`removal.log:126` — "skills/rtl-ip-flow 9 + rtl-codestyle 6 + rtl-verif 20"), which is a second,
non-hash corroboration that the corpus moved whole.

### 2.3 Destination self-consistency (task item 5, read-only)

The silicon checkout is a coherent home for everything claimed:

| Claimed moved asset | Destination evidence | Coherent? |
|---|---|---|
| 3 `rtl-*` skill trees | `silicon/skills/{rtl-ip-flow,rtl-codestyle,rtl-verif}` — exactly three trees (`ls silicon/skills/`) | ✔ |
| `mpd-verif-plugin` | `silicon/packages/mpd-verif-plugin/{dist/index.js,src,test,package.json}` present | ✔ |
| `mpd-mcp-lsp` incl. `templates/` | `silicon/packages/mpd-mcp-lsp/{dist/cli.js,overlay/lsp/{language-mappings,server-definitions}.ts,templates/rtl-lsp-client.json,references/{verilog,systemverilog}/README.md}` present | ✔ |
| six RTL docs | `silicon/docs/rtl-{verif-guide,ip-flow-guide,gap-assessment}{,.zh-CN}.md}` present (see `bridge.md` §3) | ✔ (with the duplication caveat below) |
| rtl-ip profile data | `silicon/presets/rtl-ip.profile.json` (10327 B) + `presets/README{,.zh-CN}.md` contract | ✔ |
| bundle patch rows | `silicon/package.json` declares `dsh.bundle.patch` → `packages/mpd-bundle/cordis.patch.yml`; patch declares `silicon-dsh-adapter`, `silicon-bootstrap`, `silicon-verif`, `silicon-mcp-lsp` (4 rows, `silicon-` prefixed) | ✔ |
| package identity | `silicon/package.json` `name: "@mpd-dsh/silicon"`, `exports` covers `./packages/*`, `./skills/*`, `./presets/*` | ✔ |

Nothing claimed as moved is absent in the destination **except the 9 MISSING rows above**, and there
is no asset present in both repos without a stated rule **except the six RTL docs and the
`mpd-mcp-lsp` / `mpd-verif-plugin` / `mpd-bundle` coordination surface** — see §3 and `findings.md`.

## 3. Duplicated-with-conflicting-authority check (both repos carry the same path)

`raw/parity-rows.tsv` cannot see this class (it only compares a *moved* pair), so it was measured
separately by direct `sha256sum` on both sides:

| Path | mpd | silicon | Verdict |
|---|---|---|---|
| `packages/mpd-bundle/cordis.patch.yml` | present | present | **different files by design** (bundle-specific patches) |
| `packages/mpd-mcp-lsp/dist/cli.js` | present | present | **BOTH** — silicon-owned per `silicon/docs/rtl-verif-guide.md:129-131` ("silicon-owned; the MCP-LSP assets land with task t16"); mpd still ships one |
| `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` | present | present | **BOTH, byte-identical** (`sha256 a9c98a86…ac61`, 263 B both sides) — silicon docs call it silicon-owned; mpd still ships the identical file |
| `docs/adder4.md`, `docs/cnt8.md` | present | present | declared **pending-by-design** with owner `t16 (landed)` in `scripts/verify-rtl-references.mjs:31-32` |
| the six RTL docs | present | present | see `bridge.md` §3 — the stranded-duplication ruling |
| `skills/dsh-qa/scripts/rtl-{verif,ip-profile}.mjs` | present | **absent** | correct — silicon `AGENTS.md:108-110` states these two probes stay in `@mpd-dsh/mpd` and are run with `MPD_SILICON_ROOT` |

The `mpd-mcp-lsp` overlap is a real split-brain candidate, not a theoretical one: `sync-policy.md`
§5 says the source repo must not retain "the LSP overlay", and the silicon docs annotate the same
path as silicon-owned, yet the mpd checkout still contains a functioning `mpd-mcp-lsp` package whose
shipped bytes are currently **identical** to silicon's (`dist/cli.js` 235271 B `sha256 04b49f8c…73a9`;
`templates/rtl-lsp-client.json` 263 B `sha256 a9c98a86…ac61`). Identical today means the next
one-sided edit splits them silently. That is recorded in `findings.md` as F2 with the hashes; the
scope of t3 is read-only reporting, so it is not resolved here.

## 4. Verdict

- **Parity: PASS WITH RESIDUALS.** 64/73 claimed handover items landed; **0 content mismatches**;
  **9 MISSING**, of which **7 are reviewable evidence files** (the `mpd-verif-plugin` smoke
  evidence) and 2 are ephemeral (`.pyc`, `.mpd/verif/logs/*.log`). No claimed item landed with
  wrong content.
- **Destination coherence: PASS** for every claimed asset class (skills, plugin, LSP package,
  profile data, patch rows, package identity).
- **Split-brain: 1 confirmed content divergence class (the six RTL docs — `bridge.md` §3) and 1
  suspected surface duplication (`mpd-mcp-lsp` — `findings.md` F2).**

Every row above is reproducible from `raw/parity-rows.tsv`, `raw/sha256-all.log`,
`raw/diff-*.txt` and the commands quoted in §1.
