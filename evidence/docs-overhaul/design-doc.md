# t3 evidence — the detailed design document (`docs/design.md` + zh twin)

Task: t3 (implementation, attempt 2, attempt_id e178c062-7bbe-4a26-9f12-1b443804885d), assignee Senior
Engineer. Workspace: /root/dshProj/my-power-dsh · branch dev · pre-wave baseline dev@a9c3c3e.

Delivered files (final hashes, measured after the last edit):

| File | sha256 | lines | state |
|---|---|---|---|
| `docs/design.md` | 3e792155bcac83e40c24151e51835b7765ae426d483a315f624d1aa9804f81f2 | 588 | `??` (new) |
| `docs/design.zh-CN.md` | 060a6f6112ff84340432a66d6e6bc7f7e49c390b10191a3d1cfa6f24fdf8a2ff | 499 | `??` (new) |
| `docs/architecture.md` | — | — | `D` (rename source, deleted) |
| `docs/architecture.zh-CN.md` | — | — | `D` (rename source, deleted) |

The rename was done with plain `mv` (git detects it at commit time); the captain is the single git
writer and made no commit in this lane.

## 1. What the document now is

`docs/design.md` is the engineer-facing DESIGN document; the README/user guide stay the user manual
and link here. Section tree (identical numbering in the Chinese twin, verified by comparing
`grep -n '^## '` output — 14 sections each, §0 … §8b):

- **§0 What this document designs** — the system under design is the BUNDLE, not the host.
- **§0b Design principles** — 7 principles (agent-is-the-worker; one seam contact surface;
  plugin form + config by reference; workspace-scoped state resolved per call; evidence without
  evidence is incomplete; QA isolation; baseline discipline + minimal diffs).
- **§1 Big picture** — the measured contribution: **25 inserted rows**, **2 id-targets**, the
  adapter, the `mpd` preset + skill corpus, the combined web client.
- **§2 Bundle and package structure** (retitled from "Bundle assembly") — manifest invariants and
  the pack step.
- **§3 Patch layer, boot chain & the web-compat self-row** (retitled) — the four-step boot chain.
- **§4 Plugin inventory** — every patch row, by composition (see §3 below).
- **§5 Interaction flows** · **§6 State layout** · **§6b Harness adapter** · **§6c Agent preset
  plane** · **§7 Web client wiring** · **§7b TUI edition wiring** · **§8 Security & isolation** —
  carried from the predecessor, corrected where it was wrong.
- **§8b Known limits of the design** (new) — ten stated limits plus the residual-gap subsection.

## 2. Drift FIXED in this lane (each with its evidence)

| # | Drift in the predecessor | Fix | Evidence |
|---|---|---|---|
| 1 | §1 said "**8 MCP servers**" while naming six | now "**6 MCP client rows**" (4 in-repo stdio + 2 remote) | patch rows `mcp-astgrep/gitbash/lsp/codegraph/context7/grepapp`; t1 fact base §7 M-3 |
| 2 | §1 said "**13 host plugins**" and named 13 | now "**17 `mpd-*` plugin rows + the `mpd-web-compat` self-row**" = 18 `mpd-*` rows, inside the 25-insert arithmetic | patch `- id:` scan (18 `mpd-*` ids); t1 §7 D-1 |
| 3 | §4's table omitted **`mpd-team-watchdog`**, **`mpd-team-compact`**, **`mpd-tui`** | all three now have their own row (ids, package, composition, purpose, tools, config) | t1 §7 D-1 residual; patch lines for those ids |
| 4 | §4 had no composition information at all | new **`Composition` column** on every row + a separate id-target table | t1 §5 (composition), stored `evidence/tui/composition/20260915T053445Z/raw/{web,dsh-tui}-dump-config*.txt` |
| 5 | §5 claimed "**`/roster` never serves an id either**" — no such command exists | clause replaced: the roster surface is the **`mpd_roles_list` TOOL**, and no `/roster` command exists | t1 §7 M-2 (registered commands are exactly the seven in its §3) |
| 6 | No section stated the design's limits | new **§8b** with 10 limits + the residual-gap subsection | the document's own cited gates; t1 §10; t2 §4–§6 |

`/roster` was the ONLY non-existent command claim in the pair (t1 §9.8 measured every other
backticked identifier as a real registration).

## 3. Inventory completeness — measured, both languages

- `packages/mpd-bundle/cordis.patch.yml` carries **27 `- id:` entries** in two kinds: 25 additive
  install rows (`insert:`) and 2 top-level **id-targets** (`agent-presets`,
  `dsh-tui-agent-presets`).
- The doc's inventory table has **27 id rows** — a per-id comparison (patch ids extracted by regex,
  then searched in each document) reports **EN missing: []**, **ZH missing: []**, and
  **in doc but not patch: []**. The 25 inserts are listed one row per id (not aggregated), so the
  per-id check is mechanical for the verifier.
- Composition is stated per row: the 25 inserts reach `web + dsh-tui`; `mpd-tui` is annotated
  "active in dsh-tui, degrades elsewhere"; `mcp-gitbash` is annotated "disabled by default"; the two
  id-targets are documented as web-plane and dsh-tui-plane respectively.

## 4. Commands run and their exit codes (re-run on the FINAL bytes)

| Command | Exit | Evidence |
|---|---|---|
| `node scripts/verify-rows-parity.mjs` | **0** | `ok: 25 row ids match the bundle patch insert list (…25 ids…)` |
| `bun run verify:docs` | **0** | `root=… pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS` |
| `bun run verify:vendor` | **0** | `[verify-vendor] PASS` |
| id-coverage script (python: patch ids vs each document) | **0** | 27 patch ids, 0 missing in EN, 0 missing in zh, 0 invented in the table |
| `grep -n "8 MCP\|13 host plugins"` over the pair | **1** (no match) | both stale counts are gone |
| section-tree comparison (`grep -n '^## '` on both files) | **0** | 14 sections each, same numbering |

## 5. Inbound references to the removed filename — attributed observations (NOT edited here)

Per the captain's ruling (copied in §7), this lane keeps `inScope` exactly at its four declared
paths and reports the remaining live hits as observations attributed to their owners — it does not
edit them and does not describe them as residual gaps:

| Remaining live hit | Owning task / lane |
|---|---|
| `docs/index.md`, `docs/index.zh-CN.md` | **t12** (repoint the cross-references the rename orphans) |
| `AGENTS.md` §3 layout tree | **t12** |
| the comment line in `packages/mpd-bundle/cordis.patch.yml` | **t12** |
| `README.md`, `README.zh-CN.md` | **t4** (README rewrite lane) |
| `docs/user-guide.md`, `docs/user-guide.zh-CN.md` | **t5** (user-guide lane) |

Inside this lane's own pair the switch links ARE fixed (`docs/design.md` line 3 →
`[中文](design.zh-CN.md)`; `docs/design.zh-CN.md` line 3 → `[English](design.md)`), and the pair's
internal inbound links use the new names only. `docs/decisions.md` and the prior-phase reports keep
the old spelling on purpose: they are historical records.

## 6. Reconciliation with the two required inputs

- **t1 fact base** (`evidence/docs-overhaul/plugin-inventory.md`, 375 lines) — its four MISMATCH
  findings and four drift findings were all applied or accounted for: M-1 (git-bash availability)
  was already correct in this pair and is now explicit in §4; M-2 fixed (§2 row 5 above); M-3 fixed;
  M-4 is code-side and was repaired by task t13 (see `evidence/docs-overhaul/slot4-string.md`). D-1's
  residual (three missing rows) is fixed; D-2's wording split (25 inserts vs 2 replaces) is stated in
  §1 and §4; D-3 (the twin mid-flight) is resolved — both files are rewritten and the doc gate
  passes; D-4 (stale pointers) is other tasks' owned work, named in §8b.
- **t2 baseline metrics** (`evidence/docs-overhaul/baseline-metrics.md`) — the knob arithmetic is
  audited there as CORRECT (`25 = 13 + 12`), and it measured that this document's predecessor carried
  NO knob count. This document still carries none by design; §8b states that, plus the "13 = 6
  single-key sections + 7 `watchdog.*` fields" precision and the FOUR-slot authority.

## 7. Captain ruling — bytes copied into this artifact (AGENTS.md T-90: the artifact is the anchor)

> "RULING on your t3 amendment request: DENIED as an amendment — and the reason is that your lane
> does not need it. The two index-hub files and `AGENTS.md` are already owned by a task created after
> the plan closed: **t12** … assigned to the Junior Engineer, deps t3, inScope = `docs/index.md`,
> `docs/index.zh-CN.md`, `AGENTS.md`, plus the comment line in `packages/mpd-bundle/cordis.patch.yml`.
> … Consequences for t3 …: keep inScope exactly `docs/design.md`, `docs/design.zh-CN.md`,
> `docs/architecture.md`, `docs/architecture.zh-CN.md`. Your acceptance bullet about inbound
> references is satisfied by reporting the REMAINING live hits as attributed observations (owning
> lane = t12 for the index/AGENTS/patch-comment set, t4 for README*, t5 for docs/user-guide*), not by
> editing them. Fix the switch links inside the renamed pair yourself (that is your pair), and do not
> widen your scope. Also: do not state the AGENTS.md line as a residual gap in the design doc's
> known-limits section — it is an owned, scheduled edit (t12), not a gap. … the plugin inventory must
> show which composition each row reaches (web / dsh-tui / both), because `mpd-tui`,
> `mpd-team-watchdog` and `mpd-team-compact` are inserted by the patch unconditionally and the tui
> row degrades warn-once where no TUI seams exist."

All four requirements are satisfied: inScope unchanged; the remaining hits reported as attributed
observations (§5) and not edited; the pair's own switch links fixed; §8b of the design document
describes the inbound fan-out as OWNED WORK (never as a residual gap); §4 carries the per-row
Composition column, with `mpd-tui` annotated as degrading where no TUI seams exist.

## 8. Residual gaps carried from the fact base and the baseline measurement (as the acceptance requires)

Stated in `docs/design.md` §8b itself; repeated here so the evidence is self-contained:

- **Composition evidence, not load evidence.** The fact base's composition section rests on the
  patch, the two installed profile manifests and a live tool list — its own `dump-config` runs failed
  on a read-only filesystem — so §4 cites the stored `evidence/tui/composition/20260915T053445Z`
  artifacts. **No mounting boot in an isolated `DSH_HOME` was run for this document**;
  `preset-conformance.mjs` / `bundle-lifecycle.mjs` remain the gates that would prove a load.
- **The fact base is hash-anchored and therefore perishable** — measured while this document was
  being rewritten, so its line references describe pre-rewrite bytes even though every finding it
  reports is fixed here.
- **The settings-knob count is deliberately not restated** in the design document (it belongs to the
  README / user-guide / schema): `25 = 13 + 12`, where the 13 are 6 single-key sections + 7
  `watchdog.*` fields, and FOUR `teamModels` slots are authoritative.
- **The transient scratch directory is consolidated and attributable.** The
  `dump-config` output a lane produced during the baseline window now lives at
  `evidence/docs-overhaul/raw/{web,tui}-cfg.{txt,err}` (recorded as t1's lane evidence); the former
  `_work/` path no longer exists. It is captain-owned and reported with the wave; it is simply not a
  lane's shipped deliverable, and therefore appears in no lane's `changedPaths`.

## 9. What this evidence does NOT prove

- **No load/mount proof.** Nothing here boots the bundle; the three gates are
  static/composition-level. `docs/design.md` §4's composition column is composition evidence and
  says so; a mounting boot (`preset-conformance`, `bundle-lifecycle`) is the gate that would prove a
  load and was NOT run by this lane.
- **The rename's other referrers are other lanes' work** (§5) and were verified still-live at the
  time of writing; this lane neither edited nor claims them fixed. `docs/design.md` §8b names them as
  owned work rather than claiming they are already repointed.
- **Line-number citations are perishable.** Per AGENTS.md T-55, all claims above are anchored to
  symbols, row ids, hashes and task ids, not to line numbers.

## 10. POST-COMPLETION RE-MEASUREMENT (added after a captain gate report of a RED doc gate)

The captain reported `node scripts/verify-docs-parity.mjs` RED with
`FAIL docs/design.md — heading tree differs: EN [1,2,2,2,2,2,2,2,3,3,3,3,2,2,2,2,2,2,2] vs zh
[1,2,2,2,2,2,2,2,3,3,3,3,2,2,2,2,2,2]`, and stated that the zh §4 still omits
`mpd-team-watchdog`, `mpd-team-compact`, the two id-target rows and 5 of the 6 MCP ids. Both
statements were re-measured against the bytes on disk at the moment of this note, read-only:

| Measurement | Result |
|---|---|
| `node scripts/verify-docs-parity.mjs` | **exit 0** — `ok   docs/design.md` … `pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS` |
| `sha256sum docs/design.md` | 3e792155bcac83e40c24151e51835b7765ae426d483a315f624d1aa9804f81f2 (identical to the completion payload) |
| `sha256sum docs/design.zh-CN.md` | 060a6f6112ff84340432a66d6e6bc7f7e49c390b10191a3d1cfa6f24fdf8a2ff (identical) |
| mtimes | `docs/design.md` 2026-09-19 18:27:32 +0800; `docs/design.zh-CN.md` 2026-09-19 18:27:37 +0800 |
| `grep -n '^## '` on both files | 14 headings each, same numbering, **including `8b` in both** (EN "8b. Known limits of the design", zh "8b. 设计的已知限制") |
| §4 literal first-column id census (regex over the §4 block of each file) | EN **27** ids, zh **27** ids; `zh missing vs patch: []`, `en missing vs patch: []` |
| zh §4 slash-list artifact (`mcp-astgrep/gitbash/lsp…`) | **absent** (`False`) |

The zh §4's 27 literal rows are: mcp-astgrep, mcp-gitbash, mcp-lsp, mcp-codegraph, mcp-context7,
mcp-grepapp, mpd-web-compat, mpd-dsh-adapter, mpd-config, mpd-team-watchdog, mpd-tools,
mpd-modelchain, mpd-ext, mpd-roles, mpd-ulw, mpd-hashline, mpd-boulder, mpd-comment-checker,
mpd-codegraph, mpd-memory, mpd-workmate, mpd-team-compact, mpd-bootstrap, mpd-tui, agent-teams,
agent-presets, dsh-tui-agent-presets.

Conclusion, stated as a measurement rather than a claim: the reported failure and the reported zh §4
gaps describe the mid-flight revision (the window t1 recorded as D-3 "the bilingual pair is
mid-flight"), not the tree as it stands. Every point of the captain's definition of done is met on
the current hashes: the gate exits 0 with `failed=0`, the two section trees match 1:1 (14 `##`
headings each, `8b` included), and the zh §4 carries all 27 ids as literals. No repair edit was
applied, because the bytes already satisfy the check — re-running the gate on the current tree is the
verification.

## 11. POST-COMPLETION CORRECTION (captain-directed M-2: no dead slash-command token)

The captain directed (message "final fact-base corrections for t3", item 2) that the pair must not
name a slash command that does not exist. Two spots did — both as negations — and were reworded.
This is the ONLY content change after completion; nothing else in either file moved.

| File · section | Before | After |
|---|---|---|
| `docs/design.md` §5 (workmate addressing) | "…the roster surface is the `mpd_roles_list` TOOL — no `/roster` command exists anywhere in the bundle, and neither surface ever serves a roster id" | "…the roster surface is the `mpd_roles_list` TOOL, and neither it nor any other registered surface ever serves a roster id" |
| `docs/design.md` §8b (residual gaps) | "the `/roster` command that does not exist" | "a roster surface claimed as a slash command that has no registration anywhere in the bundle" |
| `docs/design.zh-CN.md` §5 | "……名册界面是 `mpd_roles_list` **工具**——bundle 里根本不存在 `/roster` 命令，两个界面也都从不返回 roster id" | "……名册界面是 `mpd_roles_list` **工具**，它与任何其他已注册界面都从不返回 roster id" |
| `docs/design.zh-CN.md` §8b | "根本不存在的 `/roster` 命令" | "把名册界面说成一个在 bundle 中毫无注册的斜杠命令" |

Verification AFTER the correction (all three contract gates re-run):

| Command | Exit | Evidence |
|---|---|---|
| `bun run verify:docs` / `node scripts/verify-docs-parity.mjs` | **0** | `pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS` |
| `node scripts/verify-rows-parity.mjs` | **0** | `ok: 25 row ids match the bundle patch insert list` |
| `node scripts/verify-vendor.mjs` | **0** | `[verify-vendor] PASS` |
| `grep -n '`/roster`' docs/design.md docs/design.zh-CN.md` | **1** (no match) | the bare token is gone; the only remaining `roster` hits are the `mpd_roles_list` tool and the workmate web route `GET /plugins/mpd-workmate/roster` |
| `grep -c '^## '` on both files | **14 / 14** | `8b` present in both languages |

New hashes (these SUPERSEDE the ones in the completion payload, which describe the bytes before this
correction):

- `docs/design.md` sha256 13914155a6936941e60d50a94441f4c2bdb6b6b9a9bfe920293fbc122fe9fd4b
- `docs/design.zh-CN.md` sha256 bec5db9e20d3b600758faeb7e4be743e58d96709f47ab9d37fbe2bf1dcf15560

Provenance caveat, recorded so the ledger is not misread: **t3 was already terminal when this
correction was requested**, so the edit is not covered by an open attempt. It was made under the
captain's explicit direction, on files inside t3's inScope, and it must be re-anchored by the
verification lane (t7) or recorded in a repair task — otherwise a hash comparison against the
completion payload will read these two prose lines as unexplained drift.

## 12. POST-COMPLETION CORRECTION 2 (captain-directed: §8b must state only durable facts)

The captain reported (from t2's audit of the §8b text) that §8b asserts the former
`docs/architecture.md` filename "is gone from the documentation set (the hub `docs/index.md`, the
README, the user guide and this document all point at `docs/design.md`)". Measured on the CURRENT
bytes: **that sentence is not present** — `grep -n "gone from the documentation set\|all point at"`
over both files exits 1. It was the FIRST version of the bullet, replaced by the "inbound references
are owned work" wording before t3 completed; the audit read the pre-rewrite hash (the same D-3 class
as the earlier reports).

The underlying point was still valid and acted on: the replacement enumerated THIS WAVE'S tasks
("by the cross-reference repoint task, the README lane, the user-guide lane"), which rots the moment
those tasks land. §8b's first bullet in both languages now states durable facts only:

| File | New bullet (verbatim) |
|---|---|
| `docs/design.md` §8b | "**The rename and this document's role.** This document IS the design document the bundle links to (`docs/design.md`, with `docs/design.zh-CN.md` as its twin); its own switch links and the links inside the pair are maintained here. Records that predate the rename — `docs/decisions.md` and the prior-phase reports — keep the former filename on purpose: they are historical records, not live documentation." |
| `docs/design.zh-CN.md` §8b | "**本次改名与本文档的角色。** 本文档**就是** bundle 所引用的详细设计文档（`docs/design.md`，其孪生为 `docs/design.zh-CN.md`）；这一对自身的切换链接与对内链接由本文档维护。早于改名的记录——`docs/decisions.md` 与各阶段报告——**有意**保留旧文件名：它们是历史记录，而不是现行文档。" |

No claim about any other file's current state survives, and no task id is named in either file (the
attribution table in §5 of this evidence file is the place for that).

Verification AFTER the correction:

| Check | Result |
|---|---|
| `node scripts/verify-docs-parity.mjs` | **exit 0** — `ok   docs/design.md` … `pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS` |
| `node scripts/verify-rows-parity.mjs` | **exit 0** |
| `node scripts/verify-vendor.mjs` | **exit 0** |
| `## ` heading count / `8b` present | 14 / 14, `8b` in both languages |
| §4 id census | 27 in EN, 27 in zh, 0 missing vs the patch |
| bare `` `/roster` `` token / wave-task enumeration | absent in both (both False) |

**Transient-red observation (recorded so it is not mis-attributed):** the FIRST gate run immediately
after this edit reported `pairs=38 failed=1 violations=0 — FAIL`, while the run seconds later reported
`failed=0` with `ok docs/design.md` in both. The failing pair was not this one — other lanes were
editing concurrently (t5 on the user-guide pair, t6 on the README pair), so the red was a
mid-flight-edit artifact of the shared tree, exactly the class AGENTS.md §7 warns about. The
conclusion is measured on the settled bytes, and the verifier should re-run rather than trust a single
sample.

New hashes (SUPERSEDE §11's and the completion payload's):

- `docs/design.md` sha256 b823f58b3de61c960790a3ccd512f5d671779817b66c8e7f1ca22b1cb57e4737
- `docs/design.zh-CN.md` sha256 3761f804da0e6b4e5b00de3c5fbf42c2e03066c88f5a303bf6c631a71bd6994c

Provenance caveat unchanged from §11: t3 is terminal, so these two corrections have no open attempt
covering them; both were made under explicit captain direction on files inside t3's inScope and must be
re-anchored by the verification lane or carried by a repair task.

## 13. t15 — the two t7 findings applied (contract revision 8)

Task: t15 (work, attempt 7, attempt_id a9ec1826-140d-43e8-86f7-b9e259d9386b). Starting hashes as the
contract states: `docs/design.md` b823f58b… / `docs/design.zh-CN.md` 3761f804… — re-measured before
the edit and confirmed to match, so the contract's anchor was current.

**DELTA 2 is CANCELLED by revision 8, and was never applied** — `grep -c "not TUI-only\|并非 TUI 专属"`
over both files = **0 / 0**, so there was nothing to revert; §4's closing paragraph is byte-identical
to the pre-t15 text.

**F1 (low) — attribution corrected in both languages.** The boot-safety adaptation is implemented in
`lib/harness-compat.js`, not `lib/members.js`; source proof, measured:

| Site | Fact |
|---|---|
| `packages/mpd-agent-teams-plugin/lib/harness-compat.js:66` | `export function installContinuableMemberSetup(ctx, setup)` — the implementation, wrapping the host's `registerContinuableSetup` (lines 68–72) |
| `packages/mpd-agent-teams-plugin/lib/members.js:21` | imports it: `import { …, installContinuableMemberSetup, … } from "./harness-compat.js"` |
| `packages/mpd-agent-teams-plugin/lib/members.js:323` | calls it: `installContinuableMemberSetup(ctx, (childCtx, hostChild) => {…})` |

- EN §6b now reads: "… exactly one local adaptation: the `installContinuableMemberSetup` boot-safety
  guard in `lib/harness-compat.js` (wrapping the host's `registerContinuableSetup`), which
  `lib/members.js` merely calls (see LICENSE-NOTICES.md)."
- ZH §6b mirrors it: "…唯一一处本地适配：`lib/harness-compat.js` 中的
  `installContinuableMemberSetup` 启动安全守卫（包装宿主的 `registerContinuableSetup`），
  `lib/members.js` 至多是它的调用方（见 LICENSE-NOTICES.md）。"
- `grep -n "harness-compat"` now hits `docs/design.md:352` and `docs/design.zh-CN.md:299`; before the
  edit the token appeared in NEITHER file.

**F2 (medium) — the §8b scratch-directory bullet DELETED from both languages.** The EN bullet
carrying the stale scratch-directory narrative (and its zh twin) are gone; the accurate resolution is
recorded in §8 above — that content was consolidated into
`evidence/docs-overhaul/raw/{web,tui}-cfg.{txt,err}`, it is captain-owned and attributable, and it is
not a lane's shipped deliverable. Rationale recorded as binding: the bullet was both factually
superseded and the exact class this wave polices (a shipped design document must not assert or direct
the state of a scratch directory it does not control). §8b now keeps only the genuine limits:
composition-evidence-vs-load, the hash-perishable fact base, and the knob-count / slot authority.

Definition-of-done checks, all measured after the edit:

| Check | Result |
|---|---|
| `grep -n "_work/" docs/design.md docs/design.zh-CN.md` | **exit 1, prints NOTHING** |
| `grep -c "mpd_workmate_"` per file | **10 / 10** (untouched, as the contract requires) |
| `grep -c '`/roster`'` per file | **0 / 0** (applied fix not regressed) |
| durable-facts §8b bullet present | **1 / 1** |
| `grep -c '^## '` per file | **14 / 14** (no heading added, removed or re-levelled; §8b intact) |
| DELTA 2 sentence absent | **0 / 0** |

Commands run (contract verify list), exit codes on the settled post-edit bytes:

| Command | Exit | Evidence |
|---|---|---|
| `bun run verify:docs` | **0** | `pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS` |
| `node scripts/verify-rows-parity.mjs` | **0** | `ok: 25 row ids match the bundle patch insert list (…25 ids…)` |

NEW hashes (post-edit, superseding every earlier pair in this file):

- `docs/design.md` sha256 62bd827a9449aa58900f0baf6df23ddf4fdfdc636641a4106b50f57d3c946228
- `docs/design.zh-CN.md` sha256 e964888bbb626f5e6ab3483f77a69efdf1955c4fe3c953bc6d8142c831726e6a

No other change: the §1 grouping stays exactly as filed (captain ruled regrouping is presentation-only),
and nothing outside `docs/design.md`, `docs/design.zh-CN.md` and this evidence file was touched.
