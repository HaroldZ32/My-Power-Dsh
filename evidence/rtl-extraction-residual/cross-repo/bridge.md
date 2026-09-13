# Bridge reachability — does every surviving RTL reference in `mpd` still point at something real?

Task: t3 (verification r1). Date: 2026-09-13. Role: Researcher (read-only).
Destination repo `/root/dshProj/my-power-dsh-silicon` was inspected **read-only** (no boot, no
install, no edit). All paths below are relative to `/root/dshProj/my-power-dsh` unless prefixed.

## 1. Method (exact commands; raw logs under `raw/`)

```bash
# authoritative bridge resolver in the mpd repo (read-only; 3-bucket audit)
node scripts/verify-rtl-references.mjs --json > raw/verify-rtl-references.json   # exit 0
# per-token resolution: does the target exist in mpd, in silicon, or both?
node -e '… readFileSync(raw).slice(0,lastIndexOf("}")) → existsSync(MPD+"/"+t), existsSync(SIL+"/"+t) …' \
  | tee raw/resolved-where.tsv
# the dangling experiment: silicon root pinned to a non-existent path (no writes)
MPD_SILICON_ROOT=/nonexistent/mpd-silicon node scripts/verify-rtl-references.mjs \
  > raw/verify-rtl-refs-silicon-absent.log 2>&1 ; echo "exit=$?"
# mpd-side dependency on the silicon package name / sibling path
grep -rn --exclude-dir={.git,node_modules,evidence,.mpd,dist} -E '@mpd-dsh/silicon|my-power-dsh-silicon' . \
  > raw/bridge-audit.log
```

Measured baseline: `[rtl-refs] PASS — 42 resolved, 6 pending-by-design, 0 unresolved`
(`raw/verify-rtl-references.json`). That PASS is **necessary but weak**: the resolver accepts a
token present in **either** root (`scripts/verify-rtl-references.mjs:79-80`, `roots: [SILICON,
repoRoot]`), so "resolved" alone does not prove the *intended* owner holds it. §3 splits the 42 by
actual location, which is what exposes the split-brain.

## 2. Bridge table

`where` = measured location of the target (exact command in §1; per-token rows in
`raw/resolved-where.tsv`). `resolves where` is the bucket the mpd guard assigns.

| # | Bridge | referenced from (file:line) | resolves where | runtime consequence if dangling |
|---|---|---|---|---|
| B1 | silicon bundle root (`$MPD_SILICON_ROOT` / sibling `../my-power-dsh-silicon`) | `scripts/verify-rtl-references.mjs:24`; `skills/dsh-qa/scripts/rtl-verif.mjs:32,79`; `skills/dsh-qa/scripts/rtl-ip-profile.mjs:23,69,114` | silicon (present) | **Guard:** 3 tokens go `unresolved` → `verify-rtl-references` **exits 1** (measured, §2.1). **Cases:** both RTL QA cases print `SKIP` and **exit 0** → a CI run without the silicon checkout reports green without ever checking the handover. |
| B2 | `packages/mpd-verif-plugin/dist/index.js` | `skills/dsh-qa/scripts/rtl-verif.mjs:33` (and the six docs) | silicon only (`mpd`: absent) | Without silicon: B1's exit 1. With silicon but unbuilt: `rtl-verif.mjs` calls `fail("silicon plugin dist missing (bun build first)")` → **exit 1** (`rtl-verif.mjs:115`). Correctly hard-fails. |
| B3 | `presets/rtl-ip.profile.json` | `skills/dsh-qa/scripts/rtl-verif.mjs:36`; `skills/dsh-qa/scripts/rtl-ip-profile.mjs:24` | silicon only (`mpd`: **absent** — no rtl-ip profile and no `rtl` string anywhere in `presets/`) | Without silicon: B1's exit 1. With silicon, by design `rtl-ip-profile.mjs:141` skips when the mpd-side carrier (task t15) has not landed: "this bundle ships the profile as DATA only". So today the profile is **data with no mpd runtime bridge**. |
| B4 | silicon `packages/mpd-bundle/cordis.patch.yml` | `rtl-verif.mjs:34`; `rtl-ip-profile.mjs:25` | silicon only | Without silicon: B1's exit 1. With silicon: asserts the 4 `silicon-*` rows exist (`rtl-verif.mjs:108-109`). |
| B5 | silicon `packages/mpd-mcp-lsp/dist/cli.js` | `rtl-verif.mjs:37,140` (and the six docs) | **BOTH, byte-identical** (235271 B, `sha256 04b49f8c…73a9` both sides) | The mpd `skip()` at `rtl-verif.mjs:140-141` fires when the **silicon** CLI is absent, so the mpd copy does not satisfy this bridge — see F2 in `findings.md`. |
| B6 | silicon `skills` + the three RTL trees | `rtl-verif.mjs:35,41`; `rtl-ip-profile.mjs:26` | silicon only (9+6+20 files, §`parity.md` 2.2) | Without silicon: B1's exit 1. With silicon: tree counts asserted. Correct. |
| B7 | silicon `docs/` (the six RTL docs) | `rtl-ip-profile.mjs:27,103` | silicon (present) | Asserts the bilingual guides exist in silicon. Correct. |
| B8 | `skills/lsp-setup/references/{verilog,systemverilog}/README.md` | `docs/rtl-verif-guide*.md:129-130` (both repos); `skills/lsp-setup/SKILL.md:46-47` | **moved**: those two READMEs are **gone from mpd** (`ls skills/lsp-setup/references/` has no `verilog`/`systemverilog`) and present in silicon at `packages/mpd-mcp-lsp/references/{verilog,systemverilog}/README.md` | The two tokens sit in the guard's `pending` bucket with owner `migrated (t17)` (`verify-rtl-references.mjs:33`) — named, not silent. **Runtime:** the `lsp-setup` skill's HDL rows reference the sibling silicon path, so on a machine with no silicon checkout that row is unreachable text (skill routing itself still succeeds). |
| B9 | `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` | `docs/rtl-verif-guide*.md:129-131` (both repos) | **BOTH**, byte-identical (`sha256 a9c98a86…ac61`, 263 B) | Documented as "silicon-owned; the MCP-LSP assets land with task t16" in the silicon copy, yet mpd still ships the same file. No command fails; the divergence risk is ownership (see F2). |
| B10 | `mpd-bundle/cordis.patch.yml` | six silicon docs; no mpd RTL row | **BOTH** (different files by design) | `grep -c 'silicon-' packages/mpd-bundle/cordis.patch.yml` = **0** → mpd declares **no** RTL row, so mpd never composes a silicon row. Correct after the strip. |
| B11 | `docs/adder4.md`, `docs/cnt8.md` | six silicon docs; also shipped in both repos | **BOTH and byte-identical** (`169c9e26…f102`, `150cfdc8…af47`; distinct inodes → two copies, not a hardlink) | Declared `pending (t16 (landed))` at `verify-rtl-references.mjs:31-32`. No runtime consequence; recorded as a duplication with an owner. |
| B12 | `skills/rtl-dev` | six silicon docs (proposed capability) | **NOWHERE** — never created | Named `pending (historical)` at `verify-rtl-references.mjs:34`: "proposed in the preserved gap assessment and never created". Correctly bucketed, not a defect. |
| B13 | EDA binaries (`iverilog`, `verilator`) | `rtl-verif.mjs:239` skip path; `packages/mpd-verif-plugin` src | **mpd runtime** — not a repo asset: `/opt/osscad/oss-cad-suite/bin/{iverilog,verilator}` on PATH; `.toolchain/` holds **no** EDA binary | Present here (`verilator --version` → 5.051; `iverilog` present). On a box without them, `rtl-verif.mjs:239` prints a `SKIP` with the exact remediation (`MPD_DSH_VERIF_IVERILOG`/`MPD_DSH_VERIF_VERILATOR`) — evidenced skip, exit 0. |
| B14 | project cocotb venv (cocotb iron rule) | `rtl-verif.mjs:38` `VENV_CANDIDATES = [$MPD_DSH_VERIF_VENV, silicon/.venv-rtl, mpd/.venv-rtl]` | **mpd side only**: `mpd/.venv-rtl` present with `cocotb 2.1.0`; `silicon/.venv-rtl` **absent** | Not dangling (candidate 3 covers it) and `.venv-rtl` is gitignored (`git check-ignore` → `.gitignore:26`), so it is workspace scratch. But the silicon repo cannot satisfy its own cocotb segment from a fresh clone — the venv stays in the mpd workspace. |
| B15 | mpd bundle row ids vs silicon `silicon-*` rows | mpd `packages/mpd-bundle/cordis.patch.yml` (0 hits); silicon patch (4 rows) | disjoint | Correct per silicon `sync-policy.md` §3; no duplicate-id failure path from this side. |

## 3. The 42 "resolved" tokens split by real location

From `raw/resolved-where.tsv` (counts: **BOTH 5 · silicon 11 · mpd-only 4**; note the guard
de-duplicates, so these are 20 unique tokens over 42 occurrences):

| Resolution | Tokens | Reading |
|---|---|---|
| **silicon** (11) | `packages/mpd-verif-plugin/dist/index.js`, `…/evidence/smoke/`, `presets/rtl-ip.profile.json`, `skills/rtl-codestyle`(+3 templates), `skills/rtl-verif`(+3 fixtures/uvm) | Correct — these are silicon-owned and exist only there. |
| **mpd-only** (4) | `scripts/install-mcp.mjs`, `skills/ast-grep/scripts/ast_grep_helper.py`, `skills/dsh-qa/scripts/rtl-verif.mjs`, `skills/lsp-setup/references/` | Correct — mpd-resident harness material the RTL workflow also uses; silicon `AGENTS.md:108-110` says the QA probe stays in mpd. |
| **BOTH** (5) | `docs/adder4.md`, `docs/cnt8.md`, `packages/mpd-bundle/cordis.patch.yml`, `packages/mpd-mcp-lsp/dist/cli.js`, `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` | The duplication surface. Two are declared pending-by-design (adder4/cnt8); two are bundle-specific patch files; two (`mpd-mcp-lsp` dist/template) are annotated **silicon-owned** in the silicon docs while still shipping in mpd → F2. |

## 3-bis. The stranded-duplication ruling for the six mpd-side RTL docs (task item 3)

Measured state (`raw/dual-copy-docs.tsv`, `raw/diff-*.txt`):

| Doc | mpd sha256 (size) | silicon sha256 (size) | relation |
|---|---|---|---|
| `rtl-verif-guide.md` | `b763ba9a…fd61` (14311) | `c6b33b2b…032e` (14402) | **DIVERGENT** (91 B) |
| `rtl-verif-guide.zh-CN.md` | `eb7951d1…1b7c` (14401) | `47865b94…adfb` (14482) | **DIVERGENT** |
| `rtl-ip-flow-guide.md` | `e7865096…9999` (5166) | `e7865096…9999` (5166) | IDENTICAL |
| `rtl-ip-flow-guide.zh-CN.md` | `f786e018…8bbb` (4806) | `f786e018…8bbb` (4806) | IDENTICAL |
| `rtl-gap-assessment.md` | `eeec2c26…ba32` (22347) | `817142e7…48f4` (22394) | **DIVERGENT** |
| `rtl-gap-assessment.zh-CN.md` | `a3d7b4a7…9ee9` (21974) | `b59d15da…f995` (22031) | **DIVERGENT** |

**Ruling: the mpd copies are STRANDED copies of "moved to silicon" content that should no longer be
tracked here — not intentional retained copies with a live owner.** Evidence, strongest first:

1. **Metadata.** All six are `git ls-files`-tracked at HEAD in mpd (`git ls-files docs/rtl-*.md`
   returns all six), last touched by commit `e3de0cc fix(mcp): wave-mcp row must NOT pass
   --session at startup` — i.e. no commit has ever marked them as superseded or removed.
2. **The destination already owns them.** `../my-power-dsh-silicon/docs/rtl-docs-port-record.md:5-24`
   records a byte-for-byte copy of all six and lists the size table
   (14311/14401/5166/4806/22347/21974) — **exactly** the mpd sizes measured above — then documents
   the corrections it applied (`:26-41`). So the silicon copy is derived *from* the mpd copy and is
   the **later** revision; mpd holds the pre-correction text.
3. **The governing policy forbids retention.** `../my-power-dsh-silicon/docs/sync-policy.md` §1
   ("After the strip, the source project (`@mpd-dsh/mpd`) carries no RTL capability at all … No RTL
   content is duplicated there"), §2.2 ("The source repository must not receive RTL edits … its
   copies exist for comparison only"), and §5 — whose Chinese text is normative
   (`sync-policy.md:175-176`): "**不得**保留：任何 RTL skill 语料树副本、verif 插件、LSP overlay、
   **RTL 指南**、golden fixture…" ("must NOT retain … RTL guides …"). The six files are RTL guides.
   The same doc names silicon as "The single authoritative source for every RTL capability" (§1).
4. **The mpd side's own record already planned the deletion.** `.silicon-extraction/removal.log:114`
   (`A3 kept on purpose`): "KEEP docs/rtl-{verif,ip-flow}-guide*.md, rtl-gap-assessment*.md —
   migrate to silicon: follow-up (**t20**), then **delete here**", and
   `t5-closure-evidence/t5-closure.md:102-103` repeats it: "intentionally **not deleted** in this
   round; **migration → t20**, deletion follows migration."
5. **The mpd guard was scoped to the silicon copies, not these.** `scripts/verify-rtl-references.mjs:25,79`
   reads the six documents **from `SILICON/docs/`** and never asserts anything about `mpd/docs/`.
   The guard therefore cannot detect stale mpd copies — consistent with them being leftovers rather
   than protected artifacts.
6. **The mpd index already describes them as mid-migration** — `docs/index.md:19` /
   `docs/index.zh-CN.md:18`: "being moved to the silicon sub-bundle … until then this file
   describes the pre-extraction checkout". That is a transitional label, not an ownership claim; the
   port record (`rtl-docs-port-record.md:12-24`) shows the copy already happened, so the label is now
   factually stale.

**Residual nuance that makes this "stranded" rather than "malicious duplication":** the removal log
records a **named owner and a follow-up** (t20) for the migration/delete, so the state is a
documented in-flight plan — but at the measured HEAD (`e3de0cc`, plus `32ae54d` for the t17
re-lock) the deletion has not happened, the mpd copies are still tracked, and four of the six now
carry **older, contradicting text** than the authoritative silicon copies (they still describe the
pre-extraction checkout, e.g. mpd `rtl-verif-guide.md:129-131` lacks the "silicon-owned … t16"
annotation the silicon copy has). A reader who lands on the mpd copy gets the pre-move story.

**Consequence of ruling wrongly.**
- If they *were* intentional retained copies and a repair deleted them → the mpd docs index and any
  bookmark would 404 and the "comparison window" copies would be lost. Mitigation: nothing
  references the mpd copies except `docs/index*.md` (which is itself being repointed) — measured by
  the BOTH/mpd-only split in §3.
- If they *are* stranded (this ruling) and nothing deletes them → the split-brain persists: two
  tracked copies, one stale, with the authoritative one in a *different repository*, so a doc fix
  applied here is silently overwritten by re-stripping (sync-policy §2.2) and a reader cannot tell
  which revision is current. That is the status quo the audit is meant to end.

## 4. Bridge verdict

- **Zero references resolve NOWHERE** except the two explicitly-named buckets (B8 `t17`-migrated,
  B12 `skills/rtl-dev` historical) — the mpd guard exits 0 today, and both exceptions are named in
  code rather than tolerated silently.
- **Three silicon-owned bridges (B2, B3, B4) have no mpd fallback**; when the silicon checkout is
  absent the guard hard-fails (exit 1) but the two **QA cases silently SKIP and exit 0** — a green CI
  run that never verified the handover. Medium finding F1.
- **Two bridges resolve in BOTH repos with no stated authority** (`mpd-mcp-lsp` dist + template,
  byte-identical on both sides today) → F2. **Six docs resolve in BOTH with the mpd copy stale** →
  F3 (ruling above).
- **One bridge is unreachable by design but unowned at runtime**: the `rtl-ip` profile data exists
  only in silicon (`presets/rtl-ip.profile.json`), while `rtl-ip-profile.mjs:141` documents that the
  mpd-side carrier "has not landed". Reported as an observation, not a defect (the carrier is a
  separate task).
