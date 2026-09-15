# t50 — settings-bridge integration: bilingual docs, records, evidence index

- **Task:** t50 (Lead; attempt `1eaded5a-3a92-4acf-89e5-fc80673e3c91`)
- **Date:** 2026-09-15
- **Objective:** integrate the settings bridge into the delivered documentation and records — kill the
  stale "not bridged" prose in both languages, document the duplicate-key rule and the Web card at their
  true evidence level, amend the ledger and the report without rewriting them, index the bridge evidence,
  and hand the captain a merge-ready summary.
- **What this pass did NOT do:** it wrote no product artifact, changed no `dist/`, and touched neither
  `VENDOR_LOCK.json` nor anything under `skills/**` (both explicitly outside t50's scope).

## 1. Changes

| File | Change |
|---|---|
| `docs/tui.md` / `docs/tui.zh-CN.md` | §6.2 rewritten from "not bridged" to the BRIDGED behaviour (precedence L0<L1<L2<L3; write-back with comments/key order/trailing commas preserved; workspace-target rule with `no-live-session` / `ambiguous-multi-root` and the never-lost clause; `applies: 'restart'`; honest evidence level). New §6.5 duplicate-key table. New §3.1 Web-card subsection (registration + built bytes `Observed`, browser render NOT witnessed, repro steps). §10 item 9 narrowed, §3 settings row re-pointed, new §11.1 superseding table. Both languages carry the same heading set (checked). |
| `packages/mpd-tui-plugin/README.md` / `README.zh-CN.md` | the zh settings row still read "**未与文件打通**" — corrected to mirror the EN row; the package-local skill citation made repo-relative (`packages/mpd-tui-plugin/skills/mpd-tui/SKILL.md`). |
| `packages/mpd-config-plugin/README.md` / `README.zh-CN.md` | new `/settings` bridge (write-back) section in both languages: precedence, trigger + lock/CAS/atomic rename, comment preservation, workspace-target rule + never-lost clause, restart timing, degenerate targets, the duplicate-key rule, evidence citations. |
| `docs/tui-edition-report.md` and `.mpd/plans/dsh-tui-edition-report.md` | Amendment 3 + §9 (the wave's record, re-measured pins, the corrected gate statement and the merge blocker). The pair stays identical apart from the committed copy's 9-line "why this file lives here" header (verified by `diff`). |
| `evidence/tui/ACCEPTANCE-LEDGER.md` | third amendment: AC-16 re-witnessed on the t50 text; AC-17 extended, no status change; the t29 checker's stale `entry-unmoved` pin named; the phantom-reference class closed; pins re-measured; the merge blocker recorded (item 7). **No AC row changed status.** |
| `evidence/tui/EVIDENCE-INDEX.md` | new §7.1 indexing every bridge evidence directory, the two bridge lanes, the ruling, the re-review, the two boots, and this pass's own raw output — with re-run commands. |
| `evidence/mpd-bridge/integration/` | this report, `result.json`, the amendment artifacts (`AMENDMENT-3.md`, `LEDGER-AMENDMENT-T50.md`, `INDEX-SECTION-T50.md`) and `raw/`. |

## 2. Verification (all commands run from the repository root)

| Command | Result |
|---|---|
| `node evidence/tui/docs/20260915T070743Z/doc-assertion.mjs` | **PASS** — `"verdict": "passed"`, 28/28 items, exit 0, on `docs/tui.md` `ee99c11e…` / `docs/tui.zh-CN.md` `63f282fa…` → `raw/doc-assertion-t27-t50.log` |
| `node evidence/tui/delivery/20260915T072355Z/cited-paths-exist.mjs <nine amended files>` | **PASS** — `total missing: 0`, exit 0 (it previously flagged 11: bare `<workspace>/.mpd/mpd.jsonc` tokens are workspace-relative, the package-local skill path, one protocol-checkout command path) → `raw/cited-paths-t50.log` |
| EN/zh heading parity (`docs/tui.md` vs `docs/tui.zh-CN.md`) | **PASS** — 20 headings each, identical numbering incl. the new §3.1 / §6.5 / §11.1 |
| `sha256sum` / `stat -c %s` on the amended files and artifacts | recorded in `raw/changed-files-hashes.txt` (measured at write time, never derived) |
| `diff docs/tui-edition-report.md .mpd/plans/dsh-tui-edition-report.md` | only the committed copy's 9-line header differs — the amendment text is byte-identical |
| `node evidence/tui/composition/20260915T071619Z-docs-mpd-command/doc-assertion-t29.mjs` | **exit 1, 2 failures, neither caused by this pass's text** — the recorded predicate residual (`item3.docs/tui.zh-CN.md`) plus `entry-unmoved`, because that frozen script pins the superseded TUI-edition digest `5dce2563…`. Left untouched (another task's evidence) → `raw/doc-assertion-t29-t50.log` |
| `node scripts/verify-vendor.mjs` | **exit 1 on the working tree** — `FAIL - asset skills count drifted: 310 vs 307` + treeSha mismatch → `raw/verify-vendor-t50.log` |
| `bun run test:qa` | **exit 1 on the working tree** — `agent-teams-messaging` fails with `VENDOR_LOCK skills asset is stale: lock=307/ba0c39228896 tree=310/8ec53287296e`; every case before it passed → `raw/test-qa-t50.log` |

## 3. Merge blocker (measured here, owned by the captain)

The bridge wave (t35–t49) added three lane scripts under `skills/`
(`skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs`, `skills/dsh-qa/scripts/tui-settings-bridge.mjs`,
`skills/dsh-qa/scripts/web-settings-bridge.mjs`) and modified three tracked ones (`skills/dsh-qa/SKILL.md`,
`skills/dsh-qa/scripts/tui-panels.mjs`, `skills/dsh-qa/scripts/extension-isolation.mjs`) **after** the
wave's single `VENDOR_LOCK` re-pin (307 / `ba0c3922…`). The three new files are still untracked
(`git status`), so the second invalidation has no re-pin: the vendor gate and `bun run test:qa` are red on
the working tree. Remedy: the captain's single re-pin of `assets/skills` in the same commit as those
`skills/**` changes (AGENTS.md §9/§11). **t50 may not perform it** — `VENDOR_LOCK.json` and `skills/**`
are outside its declared scope — so this is reported, not repaired.

The earlier green sweep remains the record for the FROZEN revision; no document written by this pass
claims a gate the current tree fails.

## 4. Not claimed after this pass

The Web card's real browser render (registration + built bytes only), a specific front door's rendering,
the decision-event seam, the seventh activation-gated surface (NOT-CLAIMED #10), AC-4's 6/7 status,
AC-20's blocked host gates, and the packed-install e2e boot — all unchanged. The bridge's two skip cases
are disclosed behaviour (no file written, value never lost), never silent success.

## 5. Correction appended by t51 (2026-09-15)

§3 above is kept as the record of the moment t50 measured it, and one of its statements has since been
superseded: **the re-pin LANDED during t51.** `VENDOR_LOCK.json` `assets/skills` is now **310 files /
treeSha `8ec53287296edb43b1f622046ff932a8e339f081184622854db4a2c0445a3268`**,
`node scripts/verify-vendor.mjs` exits **0** (`asset OK: skills 310 files`, `PASS`) and `bun run test:qa`
is re-measured in the same pass — logs under `evidence/mpd-bridge/integration/t51/raw/`
(`verify-vendor-t51.log`, `test-qa-t51.log`). The merge blocker and the owed re-pin are therefore
**closed**; the earlier text is not rewritten. `result.json` in this directory remains t50's terminal
payload and is left byte-unchanged; the current state is recorded here, in the ledger's fourth
amendment, in the report pair, and in `t51/result.json`.
