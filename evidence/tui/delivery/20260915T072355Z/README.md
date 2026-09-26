# Captain's final gate sweep — DSH-TUI edition (commit-time)

Every command below was run by the captain on branch `feature/tui-edition` **after** the wave's last
`skills/**` writer stopped and after the single `VENDOR_LOCK.json` re-pin, on the frozen revision
pinned in `evidence/tui/ACCEPTANCE-LEDGER.md`. Raw output is in `raw/`; nothing here is transcribed
from a task record.

| Gate | Command | Result | Raw |
|---|---|---|---|
| vendor | `node scripts/verify-vendor.mjs` | **PASS** — `asset OK: skills 307 files`, all five other assets OK, commit/version/stats OK | `raw/verify-vendor-after-repin.log` |
| QA self-tests (R3) | `bun run test:qa` | **all self-tests passed**, exit 0 | `raw/test-qa-after-repin.log` |
| typecheck (R1) | `bun run typecheck` | exit 0 (`tsgo --noEmit`) | `raw/typecheck-tests-installer.log` |
| package tests | `bun test packages` | **547 pass / 0 fail**, 4261 expect() calls, 110 files | `raw/typecheck-tests-installer.log` |
| rows parity (R4) | `node scripts/verify-rows-parity.mjs` | ok — 24 row ids incl. `mpd-tui` | `raw/regression-r4-r5.log` |
| preset conformance (R5) | `node skills/dsh-qa/scripts/preset-conformance.mjs` | **PASS** — 31 rows, parity 31/31, live session `agentPreset: mpd`, negative control RED as required | `raw/regression-r4-r5.log` |
| web profile boot (R6) | `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | **PASS** — install/compose/boot/`noHomeCopy`/`layerDurability`/uninstall all ok, exit 0 | `raw/web-profile-boot.log` + `evidence/dsh-qa/bundle-lifecycle/2026-09-15T07-24-59.974Z/` |
| doc wiring (R7, R8) | the contract's own one-liners | ok — switch links both languages, index/README linkage, R8 keys present | `raw/regression-cheap.log` |
| `PLUGIN_PKGS` pack parity (R11) | the contract's own one-liner | ok — 16 patch plugin rows all listed in `scripts/pack-mpd.mjs` | `raw/regression-cheap.log` |
| installer | `node scripts/install-profile.mjs --dry-run` | exit 0, nothing written | `raw/typecheck-tests-installer.log` |
| cited-path existence | `node cited-paths-exist.mjs docs/tui-edition-report.md evidence/tui/ACCEPTANCE-LEDGER.md evidence/tui/EVIDENCE-INDEX.md` | **PASS** — 102 repo-relative citations, 0 missing | this directory (`cited-paths-exist.mjs`) |

**Not run by the captain, and why.** The five TUI lanes (`tui-mount`, `tui-panels`, `tui-admission`,
`tui-distribution`, `tui-spec-conformance`) were run by their author (t7), independently re-run by the
Reviewer from its own sandbox (t8, `evidence/tui/live/20260915T063140Z/`), and re-run again hardened by
t26 (`evidence/tui/lanes/2026-09-15T07-0*`); the protocol's own distribution CLI ran in-sandbox (t9,
`evidence/tui/conformance/20260915T064521Z/`). The captain's sweep re-ran the REGRESSION half instead
of a third pass over lanes whose witnesses are already independent. The host's own `verify:plugin-*`
gates remain BLOCKED (`ERR_MODULE_NOT_FOUND` for `tsx` in the unbuilt read-only host copy) — AC-20.

## The re-pin this directory proves

`VENDOR_LOCK.json` `assets.skills` moved `301 / 0dd4a6ee68e0…` → **`307 /
ba0c3922889614225dfd3c30b97ed369ee9b5b0ae374635a5d52d561123816ef`**, with the `source` prose extended to
name the five TUI lanes and their shared `lib/tui-lane.mjs` harness, and `lockedAt` set to
`2026-09-15T07:26:59Z`. The value is not asserted: `verify-vendor` recomputes it from the working tree
with the same sorted-relpath + per-file-sha256 aggregation and passes (`asset OK: skills 307 files`),
and `bun run test:qa` — whose `agent-teams-messaging` case gates exactly this pairing — went from
`lock=301/0dd4a6ee68e0 tree=307/ba0c39228896` RED to fully green in the same run pair.

## Captain-directed post-review edit (bilingual, disclosed)

The two process records the wave commits — `docs/plan-tui-edition.md` and `docs/tui-edition-report.md`
— were not named anywhere in the docs hub, so the captain appended one sentence to the existing
"Historical planning docs" paragraph of **both** languages of the index (the binding bilingual rule):
`docs/index.md` → sha256 `0639c2cfab773ccf…` (4857 B, 15:29:20) and `docs/index.zh-CN.md` → sha256
`032abdb24c30d66f…` (4853 B, 15:29:36). Both files were already part of this wave's change set (t6
linked the TUI page from them), so this is the same treat-the-pair-together edit, not a new scope.
R7 was re-run after it (`ok`), and neither file appears in any digest the delivery pins.

## Before / after, same command

| | before the re-pin | after |
|---|---|---|
| `verify-vendor` | exit 1 — `asset skills count drifted: 307 vs 301`, `treeSha mismatch` | exit 0 — PASS |
| `test:qa` | exit 1 — `FAILED: skills/dsh-qa/scripts/agent-teams-messaging.mjs` (VENDOR_LOCK skills asset is stale) | exit 0 — `all self-tests passed` |
