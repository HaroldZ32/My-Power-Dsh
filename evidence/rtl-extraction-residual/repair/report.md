# t8 repair report — RTL-extraction residuals: fix, retire, re-baseline

Task: `t8` (work) · assignee Senior Engineer · attempt 1 (`8846a52c-ff62-4d9d-998c-550040c17912`)
Baseline: mpd `32ae54dd10db7ea46e1c1263143d56f266fd1f78` (`dev`), silicon `bf3dae25…`
Authority: `captain-rulings.md` (R1, R1.1, R2, R3, R4, R5.2/R5.3, R6, R7.1–R7.15) + the captain's
contract message + `t2`'s `acceptance.md` + `t9`'s `standard.md`.
Scope guard applied: every fix is either a confirmed defect row or a captain ruling; anything the
review contested is recorded, never silently changed.

## 1. Fixed items (defect id | path | fix | proving command | exit code)

| id | path | fix | proving command | exit |
|---|---|---|---|---|
| R1-TEMPLATE | `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` | deleted (HDL escape-hatch template; `templates/` gone) | `test ! -e packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` | 0 |
| R1.1-OVERLAY | `packages/mpd-mcp-lsp/overlay/lsp/server-definitions.ts`, `language-mappings.ts` | HDL registrations, install hints and `.v/.vh/.sv/.svh` mappings removed; drift-guard anchor renamed | `grep -c 'verible\|slang-server' <both files>` → 0 | 0 |
| R1.1-DIST | `packages/mpd-mcp-lsp/dist/cli.js` + `dist/BUILD.lock` | **regenerated** through `MPD_UPSTREAM_ROOT=<repo>/.mpd-dsh/upstream node scripts/build-mcp.mjs` (never hand-edited) | build `exit 0`; sha256 `04b49f8c…` → `9f41d425…`; HDL hits 0; builtin servers **44 → 42**, removed exactly `{verible, slang-server}`; `initialize` + `tools/list` answer with the same 8 tools on both binaries | 0 |
| R1-README | `packages/mpd-mcp-lsp/README{,.zh-CN}.md` | RTL/HDL section + template escape-hatch section removed (both languages, switch link intact) | `grep -ci 'verible\|slang\|RTL' packages/mpd-mcp-lsp/README*.md` → 0 | 0 |
| R2-DOCS | six `docs/rtl-*.md` | deleted | `git ls-files 'docs/rtl-*.md'` → empty | 0 |
| R2-HUB | `docs/index.md` (was `:19`), `docs/index.zh-CN.md` (was `:18`) | RTL hub row removed, including its "being moved … until then this file describes the pre-extraction checkout" framing — no in-progress migration text remains | `grep -c 'rtl-' docs/index.md docs/index.zh-CN.md` → 0 | 0 |
| F4-BUNDLE-README | `packages/mpd-bundle/README{,.zh-CN}.md` | advertised mount list corrected to the rows `cordis.patch.yml` really mounts; waveform rows (`mcp-wave-mcp`/`mcp-traceweave`, commented out at `:107`/`:118`) stated **not mounted**; retired `verif` plugin dropped; the `docs/rtl-verif-guide.md` install-policy pointer removed | `grep -n 'mcp-wave-mcp\|mcp-traceweave' cordis.patch.yml` (commented) vs README text | 0 |
| R3-CASES | `skills/dsh-qa/scripts/rtl-verif.mjs`, `rtl-ip-profile.mjs` | deleted; `SKILL.md:62` row removed; `dual-track-smoke.mjs:21` comment reworded; `llm-dual-track`/`dual-track-smoke` slug bijection fixed | C1 bijection diff **empty** (quoted in §5) | 0 |
| R3-SOFTWARE | `skills/dsh-qa/scripts/software-smoke.mjs` (new), `skills/dsh-qa/SKILL.md`, `docs/development{,.zh-CN}.md` | software-type worked example landed from the t9 prototype with exactly the two landing deltas; SKILL.md row (verbatim §5.7) + the C3 corpus rule sentence; catalog row in both languages | `node skills/dsh-qa/scripts/software-smoke.mjs --self-test` → exit 0; real lane `ok=true`; `bun run test:qa` → exit 0 | 0 |
| R5.3-CARRIER | `packages/mpd-agent-teams-plugin/lib/index.js` (+ regenerated `lib/mpd-deltas.js`, `AGENTS.md` A7) | `mpd-delta rtl-ip-carrier` region: apply-time read of silicon's `presets/rtl-ip.profile.json`, `require.resolve` preferred + bundle-relative walk-up fallback, missing → `{}` silently, corrupt → `{}` + one warning, `{ ...fromSilicon, ...mpd }` merge | `node scripts/patch-agent-teams-fixes.mjs --check` → exit 0 (13 regions); **mounting boot** proof in §3 | 0 |
| R5-POINTER | `README.md`, `README.zh-CN.md` | pointer note: the RTL capability (rtl-* skills, verif plugin, HDL LSP config, RTL guides, Verilog golden fixtures) lives in `@mpd-dsh/silicon` (`../my-power-dsh-silicon`) | `grep -ci silicon README.md` → 2 | 0 |
| R6-FIXTURES | `tests/golden/fixtures/verilog/**` (4 files) | deleted (byte-identical copies live in silicon; zero mpd consumers) | `git ls-files tests/golden/fixtures/verilog` → empty | 0 |
| R6-DOCS | `docs/adder4.md`, `docs/cnt8.md` | **retained** as internal QA process records; `Source file:` repointed at the silicon path + "fixture moved" note | `grep -n 'silicon' docs/adder4.md docs/cnt8.md` → 1 each | 0 |
| R6-PACK | `dist/mpd-package/` (gitignored) | repacked with `MPD_UPSTREAM_ROOT=… node scripts/pack-mpd.mjs` **after** the `cli.js` regeneration (ordering honored); the stale pack (which shipped the two deleted HDL pages) is gone | pack `exit 0`; tree `cli.js` sha `9f41d4258c204aca…` (mtime 16:31:34) **==** packed `cli.js` sha `9f41d4258c204aca…` (mtime 16:32:57) < pack mtime 16:32:58; packed RTL case scripts **0**, HDL reference pages **0**, packed `cli.js` HDL hits **0**, packed installer HDL hits **0**; `relocate-smoke --self-test` green inside `test:qa` | 0 |
| F1-PROBE | `packages/mpd-qa-roles-probe/{src,dist}/index.*` | corpus floor `bundled.length >= 20` replaced by NAMED fixtures + the `summaries.length === bundled.length` relationship + the load/bytes check; `[roles-probe] SKILL_FIXTURES=n/m` line added; dist rebuilt | `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` → **exit 0** (was 1); FAIL-side round trip: a bogus named fixture → exit 1 with `SKILL_FIXTURES=5/6 MISSING=zzz-not-in-corpus` | 0 / 1 (negative) |
| F2-FIXTURES | `self-fix-tests/fixtures/upstream/{tools.js,quality-gates.js,README.md}` (new) + the two test files | HEAD-derived pristine fixture replaced by checked-in `d510a16^` fixtures with pinned sha256; scratch-root file lists extended to `index.js` | `bun test packages` → **298 pass / 0 fail** (was 295/3) | 0 |
| J1-INSTALL-MCP | `scripts/install-mcp.mjs` | HDL LSP targets, their whole install section and the self-test requirement removed (other servers untouched) | `node scripts/install-mcp.mjs --self-test` → exit 0; `grep -c 'verible\|slang' scripts/install-mcp.mjs` → 0 | 0 |
| J2-ANCHOR | `scripts/build-mcp.mjs` + both overlay files | anchor renamed `mpd-rtl-overlay-v1` → `mpd-lsp-overlay-v1` in the same change, guard kept functional | build `exit 0`; negative probe (anchor renamed in one overlay) → **exit 1** with `lacks drift-guard anchor "mpd-lsp-overlay-v1"` | 0 / 1 (negative) |
| J2-CONTENT | `scripts/pack-mpd.mjs:75` | stale `verible/slang` comment corrected | text review | 0 |
| R7.14-GATE | `scripts/verify-rtl-references.mjs` | repointed, strictly stronger: `CASES = []` + disclosure line; a 13-subject **negative forbidden-path invariant** that always runs; `considered` printed in the standing run; silicon-absent ⇒ FAIL (never SKIP-pass); `PENDING` owners kept, including the newly found silicon-side reference to the retired case | standing `exit 0`; `--self-test` `exit 0`; `MPD_SILICON_ROOT=/nonexistent` → `exit 1`; strip-violation probe (`touch docs/rtl-verif-guide.md`) → `exit 1` | 0 / 1 (negatives) |
| G1-ROWS | `scripts/verify-rows-parity.mjs` | zero-subject assertion: an empty patch/installer row set now FAILS by name | real tree `exit 0`; probe (patch without `- insert:`) → `exit 1` | 0 / 1 (negative) |
| G2-VENDOR | `scripts/verify-vendor.mjs` | zero-subject assertion: an empty `assets` map now FAILS by name | real tree `exit 0`; probe (`assets: {}`) → `exit 1` | 0 / 1 (negative) |
| C7-ROW | `skills/dsh-qa/SKILL.md` | the vacuous `grep -c '^\| rtl-verif '` sub-check is replaced by the strict row↔script bijection (empty diff quoted) plus the gate's own `mpd-side cases: 0` disclosure | C1 diff empty; gate disclosure line present | 0 |
| TEST-QA-ALL | `package.json` | `test:qa` = every case `--self-test`; `test:qa:all` = the REAL lane of a 23-case allowlist enumerated by name (criterion: real headless boot and/or live provider); recorded in `docs/development{,.zh-CN}.md` | `node -e "require('./package.json').scripts['test:qa:all']"` shows the named list | 0 |
| VENDOR-REPIN | `VENDOR_LOCK.json` | exactly ONE re-pin: `skills.fileCount` 329 → 328 + new `treeSha` (computed with the gate's own algorithm), `packages/mpd-mcp-lsp/dist/cli.js` sha256 updated | `node scripts/verify-vendor.mjs` → exit 0 | 0 |
| RESIDUES | `.venv-rtl/` (44M), `.mpd/verif/` (1.3M), `20260911T094211Z.tmp`, `.toolchain/bin/{verible-verilog-ls,slang-server}`, stale `dist/mpd-package` (15M) | workspace-local residues removed / repacked; `.silicon-extraction/removal.log` and `t5-closure-evidence/` untouched | `raw/residues.log` (before/after `du -sh`) | 0 |

## 2. Six-command sweep (re-run after the LAST tracked edit + the repack)

From `/root/dshProj/my-power-dsh`, verbatim exit codes in `raw/sweep.log`:

| command | exit |
|---|---|
| `node scripts/verify-vendor.mjs` | **0** |
| `node scripts/verify-rtl-references.mjs` | **0** |
| `node scripts/verify-rows-parity.mjs` | **0** |
| `bun run typecheck` | **0** |
| `bun test packages` | **0** (298 pass / 0 fail) |
| `bun run test:qa` | **0** |

Additional mandated proofs (not part of the six): `bundle-lifecycle` (MOUNT gate) exit 0;
`patch-agent-teams-fixes --check` exit 0 (13 regions); carrier mounting boot (§3).

## 3. Carrier hook — mounting-boot proof (R5.2/R5.3, C6's clause)

Real boot, sandboxed `DSH_HOME` + `HOME` + workspace, two lanes (never `--dump-config`). Script and
raw results: `raw/carrier-mount-proof.mjs`, `raw/mount-proof/result.json`, `raw/carrier-mount-proof.log`.

**Status: PARTIAL — the session-level half is DEFERRED with failing evidence (R5.3 STOP-rule style).**

Proven, with raw logs:
- A **real web-profile boot** on a scratch `DSH_HOME` (bundle installed from the checkout with an
  explicit `--store-dir`) mounts the plugin tree and the probe's `agent_teams_create` call **reaches
  the real tool**, which answers with its own agent guard
  (`agent_teams tools require a calling agent (exec.agent was undefined)`) — i.e. the row is mounted and
  the tool surface is live in a real boot. Logs: `raw/mount-proof/with-silicon/{probe.jsonl,boot.log}`.
- `node scripts/patch-agent-teams-fixes.mjs --check` → **exit 0**, 13 regions, including
  `mpd-delta rtl-ip-carrier` in `lib/index.js`.
- The sibling-absent lane booted the same way with no carrier error.

NOT proven, therefore DEFERRED — both attempted designs failed for **harness** reasons, not carrier reasons:
1. **Plugin-origin tool call**: a plugin probe has no calling agent, so the adopted tools refuse
   (`exec.agent was undefined`). A plugin cannot exercise an agent-scoped tool.
2. **Session-prompt observation** (grep the composed captain prompt out of the session log): both
   headless boots exited 0 but wrote **no session transcript** (`sessionBytes: 0`), so the prompt text
   was never captured. Logs: `raw/carrier-prompt-proof.log`, `raw/prompt-proof/result.json`.

Reproducible next step (for t11 or a follow-up): run one real headless session whose model step emits
`agent_teams_create {profile: "rtl-ip", approval: "required"}` (the `software-smoke` stub-provider
pattern shows how to answer the model step without a credential), then assert the returned
`profile`/`members` and the `.mpd/team/<id>/team.json` record — once with the sibling planted, once
without. The carrier code path itself is registered, mounted, and `--check`-clean; what is missing is
only the session-level observation.

## 4. Before/after of every deleted local artifact

| artifact | before | after |
|---|---|---|
| `packages/mpd-mcp-lsp/dist/cli.js` | 235271 B, sha256 `04b49f8c192d03b5…e0a973a9` | 234827 B (JS char count in BUILD.lock: 234821), sha256 `9f41d4258c204aca…8e1d18ce69`; diff = the HDL rows removed + 3 trailing-comma lines from the current bundler; behaviour identical (`initialize`, `tools/list` 8 tools, builtin servers 44 → 42 with exactly `{verible, slang-server}` gone) |
| `VENDOR_LOCK.json` skills entry | `fileCount 329`, `treeSha 8a0f05f0c241df96…` | `fileCount 328`, `treeSha 2b55ab84a5c219b2…` |
| `.venv-rtl/` | 44 M | removed |
| `.mpd/verif/` | 1.3 M | removed |
| `dist/mpd-package/` | 15 M, stale (shipped the 2 deleted HDL pages + the old cli.js) | repacked (15 M, HDL-free) |
| `20260911T094211Z.tmp`, `.toolchain/bin/{verible-verilog-ls,slang-server}` | present | removed |
| `tests/golden/fixtures/verilog/**` | 4 tracked files | deleted (silicon holds the byte-identical copies) |
| six `docs/rtl-*.md` | 6 tracked files | deleted |

## 5. Both-root / BOTH-set shrinkage (expected, not damage)

`verify-rtl-references.mjs` resolves a token against **either** root, and that is **deliberate**:
silicon owns the RTL bundle while mpd keeps the harness material the workflow also uses. The
consequence is the t3 F5 masking class — a silicon-owned path that is MPD-ABSENT still reads as
`resolved` — which R2 **neutralized by deleting the stale mpd copies**, not by changing the resolver.
The script's own output now says so on every run.

The BOTH-resolution set measured by t3 (`raw/resolved-where.tsv`) shrinks by exactly one row after
R1: **5 → 4** tokens — `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` leaves (deleted);
`docs/adder4.md`, `docs/cnt8.md`, `packages/mpd-bundle/cordis.patch.yml` and
`packages/mpd-mcp-lsp/dist/cli.js` legitimately remain in both roots (retained/owned by mpd).
That shrinkage is the intended effect of the repair.

The C1 row↔script bijection command (t9 C1) prints **nothing** (empty diff) after the fix:

```
$ diff <(ls skills/dsh-qa/scripts/*.mjs | xargs -n1 basename | sed 's/\.mjs$//' | sort) \
       <(grep -oP '^\|\s*\K[a-z0-9][a-z0-9-]*(?=\s*\|)' skills/dsh-qa/SKILL.md | grep -v '^slug$' | sort)
$ echo $?
0
```

## 6. DEFERRED (with reasons)

| item | reason |
|---|---|
| Golden **software** benchmark (`tests/golden/fixtures/nim/**` + bench runner, t9 §6) | New capability, not a repair; explicitly out of t8's minimal-diff scope |
| Silicon-side RTL QA corpus (the retired cases' coverage) | R3: silicon must own its own case — a new task in the silicon repo |
| The 7 `mpd-verif-plugin/evidence/smoke/*` files lost in the move (t3 F4) | R4: recorded as a partial-copy loss; mpd must **not** re-add RTL payload; silicon-side follow-up |
| `.gitignore:23-34` RTL scratch ignores (`.venv-rtl/`, `sim_build/`, `obj_dir/`, `simv_iverilog`) | KEEP-WITH-RECORD decision: ignore patterns are not RTL capability, `simv_iverilog` is the only RTL-specific name, and removing them would churn unrelated history for no strip benefit |
| `workmate-library.mjs` "Verilog counter specialist" sample text (`:19,:23,:129`) | Captain-granted EXEMPTION: the subject is the workmate library and the string is sample task text, not RTL payload; not reworded, live lane not re-run. It would otherwise violate `standard.md` §C2b; the strict probe still flags it, by design |
| t3 F5 (either-root masking) | Accepted as a guard-quality observation; **neutralized by R2**, stated above, not separately fixed |
| t3 F6/F7 (silicon has no `.venv-rtl`; `rtl-ip.profile.json` lives only in silicon; zero `silicon-` rows) | Informational, consistent with the split (non-rulings) |

## 7. Supersession, exemptions and classification (so t11 does not misread them)

- **C7's case-registration clause is SUPERSEDED BY R3** (user instruction: software-type development
  cases) and is **never reported as passed**; C7's other clauses hold. The audit's own C7 row check
  was **vacuous** (`grep -c '^\| rtl-verif '` matched every line → 73 = the file's line count): it is
  corrected, not inherited.
- **C6 is closed, not superseded**: the hook exists and the mounting boot in §3 is its proof. The
  two C6 remnants t5 measured red (no silicon pointer line in the root README; zero
  `rtl-ip.profile.json` references) are now green: `grep -ci silicon README.md` → 2 and
  `git grep -c rtl-ip.profile.json -- packages scripts` → the carrier region.
- **`docs/adder4.md` / `docs/cnt8.md` exemption**: internal QA/golden reference material exempt from
  the bilingual/public doc set by AGENTS.md §3; silicon's §5 "no RTL content" rule is a
  product-capability rule and does not bite these two records. **Residual risk recorded**: a literal
  §5 read would delete them; this audit deliberately keeps them, with their `Source file:` pointers repointed.
- **t1-vs-R6 on the golden fixtures**: t1 labelled them "ACCEPTABLE per AGENTS.md §3"; R6 rules they
  are deleted (silicon sync-policy §5 forbids mpd keeping "the golden fixtures", and both t2 and t9
  measured them byte-identical to silicon's copies with no live mpd consumer). R6 was followed; the
  disagreement is recorded here for t11 to adjudicate.
- **Guard-1 / Guard-2 are PRE-EXISTING guard-quality defects, explicitly NOT extraction residuals**
  (t6 C9): the strip verdict is not inflated by them. The reviewer's recorded recommendation to defer
  them stands as dissent; the captain overruled it because these gates are the instruments this
  repair uses to prove correctness.
- **M1 wording (cross-repo rule)**: a QA CASE must not be green while verifying nothing, and a
  repo-level guard must not silently pass without its subject. Hence: the two cases retire (R3), while
  the retained guard keeps a positive mpd-side subject (the negative invariant) and FAILS when its
  silicon subject is absent.
- **F1 verdict qualifier**: the red was **expectation drift**, not a broken mount — the same boot log
  showed install/composed/http/preset/adapter-tool-call/roster/no-home-copy/uninstall all green.
  **F2 verdict qualifier**: pre-existing since `d510a16` (ancestry + byte-identity), NOT caused by the
  extraction; the `raw/bun-test-baseline-3d99718.log` is **not** cited as that proof.
- **`test:qa` vs `test:qa:all`** is labelled a **repair-scope decision beyond the extraction**: it
  fixes a pre-existing dishonesty t3 measured (the two scripts were byte-identical).
- **R1.1 consequence, stated**: after this change mpd's and silicon's LSP overlays are intentionally
  **not** byte-identical — the parity t3 measured stops being a property of the split, by design.
- **Keep-with-record content-only survivors** (addendum §7): string-only fixtures in
  `self-fix-tests/scope-glob-and-contract.test.mjs` (`packages/mpd-verif-plugin/test/**` as a
  scope-glob sample path), `packages/mpd-workmate-plugin/test/workmate.test.ts`,
  `packages/mpd-bundle-plugin/test/sidebar-tab.test.mjs`, `packages/mpd-bootstrap-plugin/test/bootstrap.test.ts`,
  `packages/mpd-qa-roles-probe/src/index.ts:34`, plus the genuine false positive
  `skills/frontend/references/design/layout-skill.md:101` ("RTL" = right-to-left).

## 8. `git status --short` after the repairs

```
M  AGENTS.md
M  README.md
M  README.zh-CN.md
M  VENDOR_LOCK.json
M  docs/adder4.md
M  docs/cnt8.md
M  docs/development.md
M  docs/development.zh-CN.md
M  docs/index.md
M  docs/index.zh-CN.md
D  docs/rtl-gap-assessment.md
D  docs/rtl-gap-assessment.zh-CN.md
D  docs/rtl-ip-flow-guide.md
D  docs/rtl-ip-flow-guide.zh-CN.md
D  docs/rtl-verif-guide.md
D  docs/rtl-verif-guide.zh-CN.md
M  package.json
M  packages/mpd-agent-teams-plugin/lib/index.js
M  packages/mpd-agent-teams-plugin/lib/mpd-deltas.js
A  packages/mpd-agent-teams-plugin/self-fix-tests/fixtures/upstream/README.md
A  packages/mpd-agent-teams-plugin/self-fix-tests/fixtures/upstream/quality-gates.js
A  packages/mpd-agent-teams-plugin/self-fix-tests/fixtures/upstream/tools.js
M  packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs
M  packages/mpd-agent-teams-plugin/self-fix-tests/scope-glob-and-contract.test.mjs
M  packages/mpd-bundle/README.md
M  packages/mpd-bundle/README.zh-CN.md
M  packages/mpd-mcp-lsp/README.md
M  packages/mpd-mcp-lsp/README.zh-CN.md
M  packages/mpd-mcp-lsp/dist/BUILD.lock
M  packages/mpd-mcp-lsp/dist/cli.js
M  packages/mpd-mcp-lsp/overlay/lsp/language-mappings.ts
M  packages/mpd-mcp-lsp/overlay/lsp/server-definitions.ts
D  packages/mpd-mcp-lsp/templates/rtl-lsp-client.json
A  packages/mpd-qa-roles-probe/dist/carrier-probe.mjs
M  packages/mpd-qa-roles-probe/dist/index.js
M  packages/mpd-qa-roles-probe/src/index.ts
M  scripts/build-mcp.mjs
M  scripts/install-mcp.mjs
M  scripts/pack-mpd.mjs
M  scripts/patch-agent-teams-fixes.mjs
M  scripts/verify-rows-parity.mjs
M  scripts/verify-rtl-references.mjs
M  scripts/verify-vendor.mjs
M  skills/dsh-qa/SKILL.md
M  skills/dsh-qa/scripts/dual-track-smoke.mjs
D  skills/dsh-qa/scripts/rtl-ip-profile.mjs
D  skills/dsh-qa/scripts/rtl-verif.mjs
A  skills/dsh-qa/scripts/software-smoke.mjs
D  tests/golden/fixtures/verilog/README.md
D  tests/golden/fixtures/verilog/modules/adder4.v
D  tests/golden/fixtures/verilog/modules/cnt8.v
D  tests/golden/fixtures/verilog/tb/tb_adder4.v
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-37-13.539Z/
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-43-55.289Z/
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-48-22.924Z/
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T08-02-54.465Z/
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T08-09-50.550Z/
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T08-12-44.776Z/
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T08-30-20.942Z/
?? evidence/dsh-qa/preset-conformance/2026-09-13T07-36-29.035Z/
?? evidence/dsh-qa/software-smoke/
?? evidence/rtl-extraction-residual/
?? packages/mpd-qa-roles-probe/dist/carrier-probe-with-silicon.mjs
```

(52 tracked paths: modified + deleted + added, plus untracked `evidence/**` and sandbox dirs; the `MM` entries are the carrier/registry/probe files staged and restaged during the pass.)

## 9. Reconciliation: verdict §4 ledger ↔ captain rulings ↔ t9 checklist

| verdict row | ruling behind it | state after this pass | t9 link |
|---|---|---|---|
| X1 LSP overlay HDL registrations | R1.1 | FIXED (overlay + regenerated `cli.js`) | — |
| X2 `install-mcp.mjs` LSP_TARGETS + self-test | R7.12(a) | FIXED | — |
| X3 six RTL docs | R2 | FIXED (deleted + inbound refs) | — |
| X4 two RTL cases + SKILL.md row | R3 | FIXED (retired) | C2a/C2b, §7 step 3 |
| X5 `tests/golden/fixtures/verilog/**` | R6 | FIXED (deleted; adder4/cnt8 repointed) | — |
| X6 stale `dist/mpd-package` pack | R6 | FIXED (repacked AFTER the `cli.js` regeneration) | C7/§7 step 8 |
| X7 `BUILTIN_BUILD_ANCHOR` | R7.12(b) | FIXED (renamed, guard still trips — probe exit 1) | — |
| X8 bundle README mount list | F4 + R2 inbound refs | FIXED (both languages) | C4 |
| X9 F1 + F2 red gates | captain addendum | FIXED (probe re-baselined; pristine fixtures) | — |
| X10 `SKILL.md:62` stale row text | R3 | FIXED (row removed; C3 rule added) | §7 step 3 |
| X11 hub row + "being moved" framing | R2 | FIXED (both languages) | — |
| X12 pack comment / `package.json:33` / `.gitignore:23-34` | R7.12(c) | comment FIXED; `verify:rtl-refs` row KEPT (gate re-pointed); `.gitignore` KEEP-WITH-RECORD (§6) | — |
| X13 `.venv-rtl` + `.toolchain` HDL binaries | t8 task item 3 | FIXED (removed; `du -sh` before/after in `raw/residues.log`) | — |
| X14 Guard-1 zero-subject | R7.15 | FIXED (+ falsifiability probe) | — |
| X15 Guard-2 zero-subject | R7.15 | FIXED (+ falsifiability probe) | — |
| — (R4 evidence loss) | R4 | DEFERRED to silicon (no verdict row exists) | — |
| — (`rtl-ip` carrier hook) | R5.2/R5.3 + acceptance C6 | IMPLEMENTED; **mount proof PARTIAL/DEFERRED** (§3) | §7 step 6 |
| — software-smoke + C3 corpus rule | R3 | FIXED | §5.6/§5.7/§C3, §7 steps 1–2 |
| — `docs/development{,.zh-CN}.md` catalog row | t9 C4 | FIXED | §C4 |
| — `test:qa` vs `test:qa:all` | R3 / L1 | FIXED (allowlist) | §C6 (superseded by R3) |
| — golden **software** benchmark | t9 §6 (recommendation) | DEFERRED (new capability, not a repair) | §6 |

**Gaps found by the reconciliation (stated, not silently dropped):**
- The carrier hook has **no X row**: it is not an extraction residual but the acceptance-contract C6
  bridge requirement, ruled by R5.2/R5.3. Its code exists and is registered; its session-level mount
  proof is the one obligation that remains deferred (§3).
- **R4's evidence-loss item has no verdict row** (it is an rca record in t3, not a residual): recorded
  in §6 as a silicon-side follow-up, deliberately not repaired here.
- Every `[FIX]` row in the verdict ledger maps to a ruling above; no `[FIX]` row required a change that
  a ruling forbade, and no ruling in scope lacks a row except the two tool-level ones named above.

## 10. Final verification addendum (packed installer, C6 halves, C7 escape precision)

**(1) The HDL installer is gone from the RELEASE ARTIFACT, not just the source tree.**
`scripts/pack-mpd.mjs:75-77` ships `scripts/install-mcp.mjs` inside the pack, so the pack was
regenerated **after** the installer fix (ordering recorded in §1/R6-PACK):

```
$ grep -c 'verible\|slang-server\|LSP_TARGETS' dist/mpd-package/scripts/install-mcp.mjs
0
$ test -f dist/mpd-package/scripts/install-mcp.mjs && echo present
present
```
So R6's "repack or remove" was a **correctness** item, not only distribution hygiene: a stale pack
would have kept shipping an installer that fetches the HDL language servers.

**(2) C6 is green on both halves** (the earlier red was measured before this pass):

```
$ grep -ci silicon README.md                       # the pointer note (R5.1)
2
$ git grep -c 'rtl-ip.profile.json' -- packages scripts   # the carrier hook (R5.3)
packages/mpd-agent-teams-plugin/lib/index.js:2
packages/mpd-agent-teams-plugin/lib/mpd-deltas.js:1
```
Both are mpd-side readers; the four references t5 found were inside the two cases R3 retires and
resolved against the silicon root, so before this pass no mpd-side reader existed. The hook half's
**session-level mount proof** is the one obligation still deferred — §3 carries the failing evidence
and the reproducible next step; the verdict must state the two halves separately.

**(3) C7's check: the escape was the defect, not the check.**
GNU BRE treats `\|` as alternation, so `grep -c '^\| rtl-verif '` is a disjunction whose first
branch is an empty `^` — it matches every line (measured: 73 = the file's line count). The correct
form is the **unescaped** `grep -c '^| rtl-verif '`; after R3 retires the row it returns **0**:

```
$ grep -c '^| rtl-verif ' skills/dsh-qa/SKILL.md
0
$ grep -c '^\| rtl-verif ' skills/dsh-qa/SKILL.md
0   # vacuous by construction (the row is gone; pre-repair it returned every line)
```
The landed corpus probe therefore uses the strict row↔script bijection (§1/R3-CASES, empty diff)
rather than a row-text grep that no longer has a subject.

## 11. Freshness re-run (R1.1 ordering, proven on the shipped revision)

The captain measured that `overlay/lsp/language-mappings.ts` had a NEWER mtime (16:14:57) than the
first regenerated `cli.js`/pack, because the anchor-guard probe rewrites `overlay/lsp/*.ts` **in
place with identical content**. That mtime flag is a **false positive and worth one line for future
readers: ranking mtimes is not a freshness test here — the correct test is rebuild-and-compare**,
which is what this section does (and what the captain independently reproduced: a rebuild from the
current tree yields a byte-identical `234827 B` / `sha256 9f41d4258c204aca…` artifact). The
whole chain was therefore re-run **after** the last overlay write, in order, and each step quoted
(`raw/freshness.log`, `raw/freshness-final.log`):

| step | evidence |
|---|---|
| overlay sha256 before build | `c82e1003ec9977bd` |
| `MPD_UPSTREAM_ROOT=… node scripts/build-mcp.mjs` (after the last overlay write) | **exit 0**; `cli.js` mtime `16:31:34` > overlay mtime `16:14:57`; sha256 **`9f41d4258c204aca…`** (identical to the earlier build, i.e. the artifact was never stale — now provably ordered); HDL hits 0 |
| behaviour probe on the new bytes | **exit 0**, `tools/list` → 8 tools; builtin servers **44 → 42**, removed exactly `{verible, slang-server}`, added none |
| `VENDOR_LOCK.json` re-pin for the new `cli.js` | lsp sha = `9f41d425…`; skills `fileCount 328` + fresh `treeSha` |
| `node scripts/verify-vendor.mjs` | **exit 0** (after reverting the unrelated ast-grep/git-bash rebuild churn — `build-mcp.mjs` rebuilds all three MCP dists; only the LSP artifact is in scope) |
| `node scripts/pack-mpd.mjs` (AFTER the regeneration) | **exit 0**; pack mtime `16:31:36` > cli mtime; packed checks: RTL case scripts **0**, HDL reference pages **0**, `install-mcp.mjs` HDL hits **0**, packed `cli.js` HDL hits **0** |
| anchor-guard failure side on the shipped revision | **exit 1** with `lacks drift-guard anchor "mpd-lsp-overlay-v1" (stale/foreign overlay?)`; overlay sha restored byte-identically (`c82e1003ec9977bd`); `mpd-rtl-overlay-v1` → 0 hits everywhere, `mpd-lsp-overlay-v1` → 2 in `build-mcp.mjs` + 1 in each overlay file |
| final six-command sweep (after the LAST write) | `verify-vendor 0 · verify-rtl-references 0 · verify-rows-parity 0 · typecheck 0 · bun test packages 0 · bun run test:qa 0` |
| carrier mount proof re-run on this revision | both lanes **HTTP 200** (boot healthy with and without the sibling); 41 probe attempts per lane all reached the REAL `agent_teams_create` and were refused by its own agent guard (`exec.agent was undefined`), so the tree mounts and the tool surface is live on the final revision; the session-level observation stays **DEFERRED** per §3 (`raw/mount-proof/result.json`, `raw/carrier-mount-proof.log`) |

**Pre-existing precondition recorded (found by the Reviewer, not introduced here):**
`skills/dsh-qa/scripts/relocate-smoke.mjs:20` hard-fails its `--self-test` when
`dist/mpd-package/package.json` is absent, and `package.json:29`'s `test:qa` runs every case's
self-test — so `bun run test:qa` fails on a fresh clone until someone runs `node scripts/pack-mpd.mjs`.
Measured before the repack: `[test:qa] FAILED: skills/dsh-qa/scripts/relocate-smoke.mjs` /
`[relocate-smoke self-test] FAIL: run node scripts/pack-mpd.mjs first`, `bun run test:qa` **exit 1**.
This is a real precondition that was **undocumented upstream of this pass** (a fresh clone cannot run
`bun run test:qa` until someone packs; it is not a transient failure, and it also made R6's "repack or
remove" a correctness item). Measured before the repack: `bun run test:qa` **exit 1** with
`[test:qa] FAILED: skills/dsh-qa/scripts/relocate-smoke.mjs` / `[relocate-smoke self-test] FAIL: run
node scripts/pack-mpd.mjs first`; after the repack the same command is **exit 0**, quoted in the table
above. Recorded here rather than dismissed as flaky.

## 12. R5.3 ruling V-hook-corrupt-fallthrough — implemented and proven (real boots)

**Implementation (current tree):** the `mpd-delta rtl-ip-carrier` region in `lib/index.js` is
presence-decides/priority-ordered: the FIRST candidate that EXISTS ends the search — absent (ENOENT)
continues silently (normal mpd-only install); unreadable (non-ENOENT) → one warning naming the path +
`{}`; readable-but-corrupt / non-object (including `null`/arrays) → one warning naming the path + `{}`;
readable valid object → returned. The merge stays `{ ...fromSilicon, ...(config.profiles ?? {}) }`.
(The in-code comment that claimed "logged once and also falls back to `{}`" for the
corrupt-then-valid case is gone; the captain's refinement of this region superseded my first edit, and
the registry was regenerated for it: `--write-registry` → 13 regions, carrier block 63 lines,
`--check` **exit 0**.)

**Proof — four real web-profile boots on scratch `DSH_HOME`s** (`raw/carrier-corrupt-proof.mjs`,
`raw/carrier-corrupt-proof.log`, `raw/corrupt-proof/result.json`). Candidates were planted where the
hook actually looks; the measured resolution order is
`<repo>/packages/node_modules/@mpd-dsh/silicon/presets/rtl-ip.profile.json` (FIRST) then
`<repo>/node_modules/@mpd-dsh/silicon/presets/rtl-ip.profile.json` (SECOND) — an earlier attempt with
these two inverted produced a false negative, which is exactly why the order is recorded here:

| lane | nearest candidate | farther candidate | boot | carrier warnings | verdict |
|---|---|---|---|---|---|
| valid nearest | valid | absent | HTTP 200 | **0** | PASS |
| all absent | absent | absent | HTTP 200 | **0** | PASS |
| corrupt nearest | corrupt (`{"rtl-ip": {broken`) | absent | HTTP 200 | **1**, naming the corrupt path | PASS |
| corrupt nearest + VALID farther | corrupt | valid | HTTP 200 | **1**, naming the CORRUPT candidate | PASS |

The fourth lane is the discriminator: had the resolution CONTINUED past the corrupt candidate it would
have merged the farther valid copy and logged **nothing**; it stopped with exactly one warning naming
the corrupt path — the ruling's semantics, on a real boot, with the boot still healthy in every lane.
Planted candidates were removed and the pre-existing file restored (checked in the same result).

**Post-ruling verification on this tree:** `--check` 0 · verify-vendor 0 · verify-rtl-references 0 ·
verify-rows-parity 0 · typecheck 0 · bun test packages 0 · test:qa 0 (`raw/ruling-final.log`).

**Still deferred (unchanged):** the raw session-level observation of the merged
`config.profiles` object — §3 carries the failing evidence and the reproducible next step; the warning
channel and the stop semantics above are the observable halves that a plugin can exercise.

### 12b. Byte-level reconciliation of the "not implemented" reading (settled)

The ruling WAS already implemented in the tree when re-measured; the earlier reading came from a
snapshot one minute older than the file. Recorded so t11 can check it rather than re-litigate it:

| measurement | value |
|---|---|
| `lib/index.js` mtime at the captain's reading (`08:21Z`) | before the refinement landed |
| `lib/index.js` mtime measured here | `08:22:32Z` (blob `92947a0f99c0045be4ae597bc41df9c28648f4f3`) |
| worktree vs index at that moment | **identical** (`git diff --quiet` → no output; same blob) |
| semantics in those bytes | `err?.code === "ENOENT"` → `continue` (:158); parse failure → warn naming the path + `return {}` (:168-169); non-object → warn + `return {}` (:173-174); loop end → `return {}` (:176) |

The one real defect in that reading was the **stale comment**: it still claimed "corrupt / non-object
JSON is logged once and also falls back to {}", which is false in the then-valid case. That comment is
now rewritten to describe the implemented priority-ordered semantics (absent → continue; readable
object → return; readable corrupt/non-object → ONE warning naming path + reason → `{}` and STOP; all
absent → `{}` silently; boot never throws). Because the comment lives INSIDE the region, the registry
was regenerated (`--write-registry` → 13 regions, carrier block 63 lines) and `--check` is **exit 0**.

Final blob after the comment fix: `370fbbb12c9759fd706fad7e14c75ea10bf83a07` (mtime `16:48:38`). The
four-lane proof was re-run against these bytes: **all five checks PASS** (valid → 0 warnings; all
absent → 0 warnings; corrupt → 1 warning naming it; corrupt + valid farther → 1 warning naming the
CORRUPT candidate, i.e. no continue). `bun test packages` **exit 0** (298 pass / 0 fail).

**Final six-command sweep after this last edit** (`raw/sweep-final.log`): verify-vendor **0** ·
verify-rtl-references **0** · verify-rows-parity **0** · typecheck **0** · bun test packages **0** ·
test:qa **0**.

### 12c. Refined ruling (strict ENOENT distinction) — status and the one unproven lane

The refined ruling (ENOENT → continue; ANY other read failure → one warning naming path+error then
`{}`; readable-corrupt/non-object → one warning naming path+reason then `{}`; readable object →
return; all absent → `{}` silently; merge unchanged; never throw) **is what the region implements**
(`lib/index.js`: `err?.code === "ENOENT"` → `continue`; other read errors → `console.warn(...)` +
`return {}`; parse failure → warn + `return {}`; non-object → warn + `return {}`; loop end →
`return {}`), and the comment now states all six rules plus the presence/discriminator and the
ENOENT-vs-broken-install rationale. Region body changed → `--write-registry` re-run, `--check`
**exit 0** (13 regions, carrier block 63 lines).

Five-lane mount proof (`raw/carrier-corrupt-proof.log`, `raw/corrupt-proof/result.json`):

| lane | outcome | verdict |
|---|---|---|
| valid nearest | HTTP 200, 0 warnings | PASS |
| all absent | HTTP 200, 0 warnings | PASS |
| corrupt nearest | HTTP 200, 1 warning naming the corrupt path | PASS |
| **corrupt nearest + VALID farther** | HTTP 200, **1 warning naming the CORRUPT candidate** (would have been 0 warnings + a silent farther merge under the old code) | PASS |
| existing-but-unreadable nearest + VALID farther | **0 warnings** — NOT proven | **DEFERRED with evidence** |

**Honest defer on that fifth lane, with its failing evidence:** two simulations were attempted and
neither exercised the branch. (a) `chmod 000` on the candidate: the process runs as **root**, which
ignores mode bits, so the file stayed readable and the farther valid copy was merged — 0 warnings,
which is the *documented root caveat*, not a code finding. (b) a **directory** at the candidate path
(EISDIR, a genuine non-ENOENT read failure): the lane still reported 0 warnings, which I could not
diagnose before the time budget ran out — it is recorded as unproven rather than claimed. Reproducible
next step for t11: run the same lane as a NON-root user (chmod 000 then behaves), or instrument the
boot log for the read-error branch; the code path itself is present and warn+stop, as quoted above.
