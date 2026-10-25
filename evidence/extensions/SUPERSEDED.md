# SUPERSEDED extension evidence — read this before citing `evidence/extensions/**`

**Status: record-only boundary, written 2026-10-25 (audit wave `audit-20261025`, item D-14).**
Nothing in this file re-runs, edits or deletes an evidence record: a historical `result.json` /
`output.log` is provenance and stays byte-identical.

## 1. The boundary commit

The extension interface's current code is `c239407` — `fix(ext): close the v0.9.1 review findings
F1-F7 in the extension interface`, committed **2026-09-15 09:17:55 +0800** (2026-09-15T01:17:55Z).
Every stamp named below is EARLIER than that commit, so it measured a tree that no longer exists:
the extension plane was rewritten after it (flows/skills rendering, the mcp-bridge framing, the
read-only role wiring and the delivery-schema pins all moved).

## 2. The eight pre-`c239407` directories

`stamp` is the directory under that path that actually holds the record — a path with no stamp
discloses that too. Every one of these is STALE for a current-state claim.

| # | Record | What it measured | Why it is stale |
|---|---|---|---|
| 1 | `evidence/extensions/mcp-bridge-framing/20260914T171058Z/` | an MCP-bridge framing probe (`probe.ts`: server, framing, handshake, client run) | pre-`c239407`: the bridge framing changed in that commit |
| 2 | `evidence/extensions/mcp-bridge-gates/20260914T171058Z/` | the mcp-bridge gate run (`run-gates.ts` + `dist-load.ts`, `verdict: pass` with a negative control) | same boundary; the gates and the dist load it exercised were replaced |
| 3 | `evidence/extensions/registered-tool-schemas/20260914T171058Z/` | the registered tool schemas the harness accepted (`toolsChecked`, `failed: 0`, `verdict: pass`) | the tool-schema arm was corrected after `c239407`, so this pass does not describe today's registration |
| 4 | `evidence/extensions/sanitizer-crosscheck/20260914T171058Z/` | the sanitizer cross-check against the harness corpus (`corpusSize`, `mismatches: 0`, `verdict: pass`) | pre-`c239407` corpus and comparator |
| 5 | `evidence/extensions/roles-wiring/2026-09-14T170418Z/` | the read-only role wiring (`row`, `gates`, `findings`) | pre-`c239407` wiring |
| 6 | `evidence/extensions/roles-wiring/2026-09-14T171119Z-parity/` | the same lane's parity round (`installer_rows_added`, `self_test_pinned`) | pre-`c239407`; it is the SECOND stamp of the same directory, counted separately by the F6 inventory |
| 7 | `evidence/extensions/v0.9.1-defect-fixes/20260915T011354Z/` | the v0.9.1 findings-to-fixes record (`findings`, `gates`, `notFixed`, `red-before-run.sh`) | committed minutes before the boundary and superseded by it |
| 8 | `evidence/extensions-repair/t16-pins-and-plane-guard/2026-09-14T174824Z/` | the T16 seam-pin + project-plane role-leak repair (`fix_1_seam_pins`, `fix_2_project_plane_role_leak`, `fails_before_the_fix`) | pre-`c239407` repair record |
| 9 | `evidence/mpd-ext-repair/roles-report/20260914T172801Z/` | the role-report repair run (before/after probes, `dist-vs-src`, gates) | pre-`c239407` repair record |

Rows 1-7 live under `evidence/extensions/**`; rows 8-9 live under `evidence/extensions-repair/` and
`evidence/mpd-ext-repair/`. They are listed together because the F6 inventory in
`docs/extension-adaptation-report.md` names all NINE STAMPS as **EIGHT directories** (`roles-wiring`
holds two of the stamps) — dropping the two rows outside `evidence/extensions/` would silently
shrink that inventory.

**None of the nine stamps supports a current-state claim about the extension interface.** They are
kept because they are the record of what was measured then; they are not re-run, not edited and not
deleted (that boundary is the F6 decision, indexed earlier at
`evidence/extensions/boundary-index/INDEX.md`).

## 3. The later green artifacts that supersede them

Two artifacts are green TODAY and cover the classes of claim the stale records were cited for. Cite
these instead — with their own declared bounds, which are narrower than "the extension interface
works":

| Artifact | What it does prove | What it does NOT prove |
|---|---|---|
| `evidence/gates/qa-selftest-repair/20261022T172600Z/` (`result.json`, `output.log`, `script-diff.txt`) | the QA SELF-TEST lane runs green again after the T18 repair — the `model-config-live-refresh` self-test was re-pinned to the slot single-source contract and re-run | it is a repair record for ONE self-test, not a full `bun run test:qa` sweep, and it exercises no extension-materialisation path |
| `evidence/docker/client-install-oneclick/2026-10-25T09-51-46Z/` (`result.json`, `output.log`, TUI panes/shots) | a real `ubuntu:24.04` installs the bundle with ONE command and boots it: rows activate, the mpd tools register, the mpd preset mounts, and 108 of 122 assertions pass with 0 failures (`ok: true`) | `complete: false` — 14 assertions are NULL (`build.*`/`pack.*` rebuild arms, and every `ui.*` row, because the run staged no credentials). So it is NOT a live-LLM, NOT a `dist/mpd-package` tarball, and NOT an extension-corpus claim |

## 4. The rule a future reader needs

**Re-run the two lanes into a FRESH stamp before citing any of the nine directories above.** The two
lanes are:

1. the offline QA self-test lane — `bun run test:qa` (see the `evidence/gates/qa-selftest-repair/`
   stamp for the shape of a repaired-and-re-run record);
2. the real-machine lane — `node scripts/docker-e2e.ts --mode oneclick --spec
   github:HaroldZ32/My-Power-Dsh` (see the `evidence/docker/client-install-oneclick/` stamp; and note
   its `doesNotProve` list before quoting it).

Then cite the NEW stamp. Do not cite an old one for a present-tense claim, do not edit an old
`result.json`/`output.log` to make it current, and do not read a NULL assertion in the Docker stamp as
a pass: a NULL row is a declared bound (AGENTS.md §7, §11).
