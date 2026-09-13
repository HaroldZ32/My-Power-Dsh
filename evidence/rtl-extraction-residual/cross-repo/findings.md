# Findings — cross-repo parity + dangling-bridge residual list

Task: t3 (verification r1). Date: 2026-09-13. Role: Researcher (read-only).
Angle: what the mpd repo *claims* to have handed to `/root/dshProj/my-power-dsh-silicon` versus
what is actually there, and what each surviving mpd-side RTL reference resolves to.
Verdict summary: **9 MISSING handover items · 0 CONTENT-MISMATCH · 0 references resolving NOWHERE
outside two named buckets · 3 residual classes (F1–F3) reported below.**

No file outside `evidence/rtl-extraction-residual/cross-repo/` was written; the silicon repo is
byte-untouched (`git status` clean in both repos except this task's evidence dir).

## Residual list

| Id | Severity | Finding | Evidence path |
|---|---|---|---|
| **F1** | medium | **The handover can pass CI without ever being verified.** The two repointed RTL QA cases (`rtl-verif.mjs`, `rtl-ip-profile.mjs`) print `SKIP` + `exit 0` when the silicon checkout is absent (`rtl-verif.mjs:103,183`; `rtl-ip-profile.mjs:69-70,114-115`). `test:qa` runs **every** `skills/dsh-qa/scripts/*.mjs` `--self-test` with no allowlist and no silicon presence requirement (`package.json:29-30` are byte-identical, so `test:qa:all` no longer adds coverage). A CI box without `../my-power-dsh-silicon` therefore reports RTL verification green while asserting nothing about the handover. | `raw/bridge-audit.log` (silicon-absent experiment), `raw/verify-rtl-refs-silicon-absent.log`, `package.json:29-30` |
| **F2** | medium | **`mpd-mcp-lsp` is a live split-brain surface with no stated authority.** The silicon docs annotate the path as silicon-owned (`silicon/docs/rtl-verif-guide.md:129-131`: "silicon-owned; the MCP-LSP assets land with task t16") and `silicon/docs/sync-policy.md` §1/§5 say the source project must not retain the LSP overlay or duplicated RTL content — yet the mpd checkout still ships `packages/mpd-mcp-lsp/{dist/cli.js,templates/rtl-lsp-client.json,README*.md,package.json}`. Both shipped artifacts are **byte-identical** on the two sides — `dist/cli.js`: 235271 B, `sha256 04b49f8c…73a9` both; `templates/rtl-lsp-client.json`: 263 B, `sha256 a9c98a86…ac61` both — so this is *identical duplication*, not yet *conflicting* duplication: both copies are in sync right now, but the moment one side is fixed the other becomes stale silently, and the policy says only silicon's copy may be edited. Falsifiable consequence: a fix applied to the mpd copy is lost at re-strip (sync-policy §2.2), and the mpd `rtl-verif.mjs:140` skip fires on the **silicon** absence, so the mpd copy does not satisfy the bridge. | `raw/resolved-where.tsv` (BOTH), `raw/bridge-audit.log`, `parity.md` §3 |
| **F3** | medium | **The six mpd-side RTL docs are stranded tracked copies of silicon-owned content, and 4 of 6 now contradict the authoritative copy.** mpd still tracks all six (`git ls-files docs/rtl-*.md` → 6 paths, last touched `e3de0cc`), while silicon holds the later, corrected revisions (`silicon/docs/rtl-docs-port-record.md:12-41`). Divergent pairs: `rtl-verif-guide{,.zh-CN}.md` (mpd 14311/14401 B vs silicon 14402/14482 B) and `rtl-gap-assessment{,.zh-CN}.md` (22347/21974 vs 22394/22031); `rtl-ip-flow-guide{,.zh-CN}.md` remain byte-identical. The governing rule is `silicon/docs/sync-policy.md` §1 ("the source project carries no RTL capability at all … No RTL content is duplicated there") and §5's normative Chinese list ("**不得**保留 … **RTL 指南**"); the mpd side's own record already scheduled the deletion (`.silicon-extraction/removal.log:114`, `t5-closure-evidence/t5-closure.md:102-103`, owner **t20**). The mpd guard reads the docs **from silicon** (`scripts/verify-rtl-references.mjs:25,79`) and cannot see these leftovers. | `raw/dual-copy-docs.tsv`, `raw/diff-rtl-verif-guide.md.txt`, `raw/diff-rtl-gap-assessment.md.txt`, `parity.md` §3, `bridge.md` §3-bis |
| **F4** | low | **7 reviewable evidence files were lost in the move** (`packages/mpd-verif-plugin/evidence/smoke/{adder_tb.py,adder.v,results.json,workspace/rtl/{adder_tb.py,adder.v,bad.v,good.v}}`). Their sibling `smoke.mjs` **did** land (`silicon: git ls-files 'packages/mpd-verif-plugin/evidence/*'` → only that path), so this is a partial copy, not a `.gitignore` exclusion. Two further MISSING rows are ephemeral by design (`__pycache__/*.pyc`, `.mpd/verif/logs/*.log` — `silicon/.gitignore` ignores `.mpd/` and `*.log`). Both repo copies of `docs/rtl-verif-guide*.md` still point readers at `packages/mpd-verif-plugin/evidence/smoke/` as the smoke-evidence location, and silicon `AGENTS.md:67` advertises `evidence/smoke` as part of the plugin tree. | `raw/parity-rows.tsv` (9 MISSING rows), `parity.md` §2.1 |
| **F5** | low | **`verify-rtl-references` cannot distinguish owner from fallback.** Its resolver accepts a token found in **either** root (`scripts/verify-rtl-references.mjs:79-80`, `roots: [SILICON, repoRoot]`), so the 5 BOTH-resolving tokens — including the silicon-owned `mpd-mcp-lsp` pair — are reported simply as `resolved`. A future deletion of a *silicon* copy would be masked as long as the stale mpd copy exists. Recorded as a guard-quality observation, not a broken gate. | `raw/resolved-where.tsv`, `raw/verify-rtl-references.json` |
| **F6** | info | **The silicon repo cannot satisfy its own cocotb segment from a fresh clone.** `rtl-verif.mjs:38` lists the venv candidates `[$MPD_DSH_VERIF_VENV, silicon/.venv-rtl, mpd/.venv-rtl]`; measured: `mpd/.venv-rtl` present (`cocotb 2.1.0`), `silicon/.venv-rtl` **absent**. `.venv-rtl` is gitignored scratch (`git check-ignore` → `.gitignore:26`), and silicon `AGENTS.md` does not list a venv, so this is expected — but the "every asset verifiable from silicon alone" goal (sync-policy §2.5) is only met for the venv segment because the vet resolves the mpd workspace copy. | `raw/bridge-runtime.log`, `bridge.md` B14 |
| **F7** | info | **The `rtl-ip` profile is data with no mpd runtime bridge.** `presets/rtl-ip.profile.json` exists **only** in silicon (10327 B); the mpd `presets/` tree contains no `rtl` reference and the mpd bundle patch declares **0** `silicon-` rows, while `rtl-ip-profile.mjs:141` documents that the mpd-side carrier (task t15) "has not landed". Named-and-skipped in code, so not dangling — but the profile is currently reachable only through the silicon bundle. | `raw/resolved-where.tsv`, `raw/bridge-audit.log` |

## Explicit zero counts (the audit's negative results)

- **CONTENT-MISMATCH between a moved pair: 0** (no source path survives in mpd, so no divergence is
  possible; the class that *can* diverge is measured separately in `parity.md` §3).
- **Claimed handover items whose mpd-side original still exists: 0 of 73** (`awk -F'\t' '$2=="present"'`
  over `raw/parity-rows.tsv`).
- **References resolving NOWHERE, unaccounted: 0.** The guard's only `NOWHERE`-class token,
  `skills/rtl-dev` (`raw/resolved-where.tsv` under the pre-split resolution), is explicitly named in
  `scripts/verify-rtl-references.mjs:34` as `historical — never created`, together with the
  `t17`-migrated LSP references at `:33`; both are named buckets rather than silent tolerances.
- **Duplicate row ids / mpd-side RTL rows: 0** (`grep -c 'silicon-' packages/mpd-bundle/cordis.patch.yml`
  → 0), so the disjointness constraint in `silicon/docs/sync-policy.md` §3 is not at risk from this side.

## Scope statement

In scope and done: the 73-row handover parity (`parity.md`), the bridge table over every surviving
RTL reference (`bridge.md`), the six-doc stranded-duplication ruling with cited evidence, and the
read-only destination self-consistency check. Out of scope and **not** done here: editing either
repo, evaluating test-gate health, and re-running the repo-local name/content sweep (other tasks).
No boot, install, or edit was performed in the silicon repo.
