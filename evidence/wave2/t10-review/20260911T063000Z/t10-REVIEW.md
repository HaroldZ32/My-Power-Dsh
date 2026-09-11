# t10 — Wave-2 review round 1

**Reviewer:** Reviewer · **Verdict: PASS** · **Reviewed task:** t4 (adopted-tooling divergence)

## 0. Anchored revision (measured, not assumed)

| artifact | sha256 |
|---|---|
| `packages/mpd-agent-teams-plugin/lib/quality-gates.js` | `4e94f7f6f60a8f49433a4cfb49833deab94ed24644949c464d4c1eb41abe0bd5` |
| `packages/mpd-agent-teams-plugin/lib/tools.js` | `fd106fdbf12a7379672452a321b79bd5156990454b233617621338821deb387c` |
| `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js` | `9680c7b816fa129773ceabffc55305b34a74653dc23128de85ee7058ea85c558` |
| `scripts/patch-agent-teams-fixes.mjs` | `aedb9198e1328d2a216f382ac73e13ef71141367167eac07df76cedb0f6a0576` |
| `scripts/vendor-agent-teams.mjs` | `0c6d097afaead13c3e2ab62e60a49fb94f348adc84cc5dd8e77727b7289b5237` |
| `packages/mpd-verif-plugin/dist/index.js` | `d0aee5c79476dfe92ccb1747da6292ea0802a6fdc7d2319735defa8dcabd120e` |
| `packages/mpd-bundle/cordis.patch.yml` | `88ad2cb2d08ab7f5419e894ebd86b17dc6791794835325653ceeff294ca353fb` |
| `VENDOR_LOCK.json` | `aa168d9cf8d65129ec29a658eb586fe306bba5f2746df6184b0b08d847a1ae6b` |

Wave 1 lost a review round to a tree that moved underneath the reviewer, so: these hashes were re-checked after every experiment; all work ran on copies (`guard-copy.mjs`, `guard-fullstrip.mjs`) except one deliberate, byte-restored swap (documented in §4). t14/t15 landed **after** my t9 battery (`quality-gates.js` 14:41, `mpd-deltas.js`/applier 15:08 vs my battery 14:29), so every gate below was re-run on this revision.

## 1. t4 acceptance traced to raw artifacts

| t4 | mark | artifact (raw) |
|---|---|---|
| A1 `**` covers a directory-prefix declaration end to end | **MET** | my `glob-e2e.result.json`: 8 `classifyChangedPath` cases (`packages/foo/test/**` → `in_scope` incl. a nested path; `packages/foo/testx/…` and `srcx/a.ts ~ src/**` stay `undeclared`; `lib/a.js.map ~ lib/a.js` false) **plus a REAL replay of 4 archived wave-1 tasks** whose declarations used `/**` — every recorded changedPath classifies `in_scope` (t7: 12/12). t8 `attempt3/check1-postfix.raw.json` agrees. |
| A2 contradiction impossible, defect reproduced first | **MET** | `classifyChangedPath`/`contractContradiction`/`create-contract-gate` in source (`quality-gates.js:276-330, 410-427`); t8 `attempt3/check2-prefix.raw.json` (pre-fix replay reproduces the recorded t13 contract), `check2-postfix.raw.json` (contradiction `null`, `demandedButNotInScope: []`), `check2b-falsifiability.raw.json` (0/36 contradictory scopes; prohibitions not required by any finding still hold — no over-carve). |
| A3 a running task's contract is READABLE | **MET** | t8 `attempt3/check3-t8-captain.raw.json`: 14 tools registered incl. `agent_teams_task_contract`, 13 fields `allFieldsMatch: true`, `liveUntouched: true`/`sandboxUntouched: true`, unknown-id and blank-id error paths, member-side read. My own cross-check against the live record: `subject`/`kind`/`attempt`/`assignee`/`dependencies`/acceptance-count all still identical. |
| A4 in-source LOCAL ADAPTATION marking | **MET** | `local-adaptation-markers.txt`: 20 markers, 9 registered regions; every region begins `//#region mpd-delta <id> (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)`. |
| A5 durable across a vendor refresh | **PARTIAL — met for `quality-gates.js`, NOT met for `tools.js`** | `guard-copy.result.json`: baseline `--check` exit 0 (9 regions); stripping **each of the 9** regions makes `--check` exit non-zero and NAME the delta; `quality-gates.js` heals back **byte-identical 7/7**; a vendor-realistic full strip of `quality-gates.js` heals to **0 diff lines** (`guard-fullstrip.result.json`). `tools.js` full strip heals to a **58-line divergence** (region at line 1970 vs canonical 1733) — see F2. |
| A6 no regression | **MET** | `gate-battery.txt` on this revision: `bun test packages` 343 pass/0 fail, plugin suite 90 pass/0 fail, typecheck 0, `verify-vendor` 0, `preset-conformance` PASS with `bootLog.signatures: []` and its negative control red as designed, `bundle-lifecycle` PASS, guard `--check` exit 0. |
| A7 wave-1 defect cited | **MET** | in-source: `quality-gates.js:284-286` (t13 contradiction), `:314` (deadlock), `:717` (t13 carve-out); `scope-glob` doc comment carries the B5/pre-fix semantics. |

## 2. The three divergences vs AGENTS.md §6

1. **`**` expansion** (`scope-glob`, `quality-gates.js:103-198`). Smallest-change shape: the exported matcher keeps the no-wildcard branch **bit-identical** (exact path OR directory prefix) and only adds a segment matcher (`*`/`?` single-segment, `**` crossing zero-or-more segments, memoized) behind a wildcard test. Marked in-source. Judged proportionate: it does not widen non-wildcard semantics (negative controls hold), and the end-to-end effect is proven, not asserted.
2. **Contract contradiction** (`contract-contradiction` `:276-313` + `create-contract-gate` `:410-427` + `repair-scope*` `:714-732`). One pure predicate (`contractContradiction`) plus a create-time refusal inside `WRITE_KINDS`, plus the captain-ruled carve-out in `repairScopeFromFindings`. Marked in-source; falsifiability demonstrated by t8's pre/post pair and its no-over-carve probe.
3. **Running-task contract** (`task-contract` in `tools.js`, `task-contract-render`). One read-only tool plus a render helper; `liveUntouched: true` proves the read does not mutate the record. Marked in-source.

Re-apply path: exercised, not asserted — see §3.

## 3. Durability judged from an OBSERVED failure (t10 A4)

I drove the guard myself on a copy (`guard-copy.mjs`): for **all 9** registered deltas, a stripped region makes `--check` exit **non-zero and name the delta** (e.g. `FAIL: delta "mpd-delta scope-glob" is MISSING from … (verify-only mode) — a re-vendor dropped it`), and the file restores byte-identically afterwards. The **loss-prevention** half of the durability contract therefore holds for every delta, on my own raw output. `scripts/vendor-agent-teams.mjs:127` calls `applyAgentTeamsFixes({ write: true })`, so a real refresh fails loudly on a lost delta — it cannot silently drop one.

## 4. Findings

### F1 (medium, NEW, non-blocking) — the guard's marker search is prefix-ambiguous
`findRegion` (`scripts/patch-agent-teams-fixes.mjs`) locates markers with `line.includes(markerText)` and `MPD_DELTA_MARKERS.end(id) = "//#endregion ${id}"`. Three delta ids are **prefixes of a sibling**: `mpd-delta scope-overlap` ⊂ `…-normalize`, `mpd-delta repair-scope` ⊂ `…-fields`, `mpd-delta task-contract` ⊂ `…-render`. Removing only the outer region leaves the sibling's END marker matching the prefix search, so the guard reports a **misdiagnosed** `region "X" has a half-open marker pair (begin@-1, end@N)` and `--write` refuses (exit 1) instead of healing. Reproduced for `scope-overlap` and `repair-scope` (`guard-fullstrip.result.json` → `collisionProbe`). Impact: latent (a real re-vendor removes all regions at once, so both searches return -1 and the insert path is taken), but it makes a partial strip unhealable and its error misleading.
**Required fix (wave 3, cheap):** compare markers as whole lines (`line.trim() === MPD_DELTA_MARKERS.begin(id)` / `end(id)`) instead of `includes`, and add a regression fixture for each colliding pair.

### F2 (medium, KNOWN + captain-deferred) — `tools.js` heals at the wrong site
Full strip of `tools.js`'s two regions → `--check` exit 1 naming `mpd-delta task-contract` (loss-prevention OK) → `--write` exit 0 but the healed file differs from canonical by **58 changed lines** (`task-contract` re-inserted at line **1970** instead of 1733). I then measured the two things t15 could not: (a) `--check` on the healed file reports **`already applied: 9 mpd region(s)`, exit 0** — the guard cannot see the misplacement; (b) the misplaced file is syntactically valid, still registers the tool at module scope, and **passes the whole plugin suite 90 pass / 0 fail** (`divergent-tools-tests.log`, run via a byte-restored swap: `tools.js.before.sha` verified `OK` after restore). So a future `vendor-agent-teams.mjs` run would produce a non-canonical `tools.js` that no current gate detects. Functionally it is an ordering shift among sibling `ctx.tools.register` calls, not a lost tool.
**Required fix (wave 3, owns t15's scope):** the registry needs a deterministic insertion context for a repeated structural anchor (t14's `anchorMarker`/`anchorOccurrence` machinery works for a wrapping region but not for a *registration* block, whose own first line is the repeated anchor), **plus** a position assertion — `--check` should fail on a healed-but-misplaced region, since byte-fidelity is the property t4 A5 claims.

### Carried from t9 (already recorded there, for t11's ledger)
`F-QA-1` (medium): QA `devPatch()` MCP-operand defect + `mcpEnv` pinning the deprecated `.bin/sg` (`preset-register.mjs:30-46`, duplicated in `rtl-verif.mjs:69-77`). `F-B8-1` (medium): codegraph MCP child crashes `ENOENT mkdir '<home>/.mpd/codegraph'` when unresolvable and HOME unwritable. `F-QA-2` (low): `web-client-adapt` 60 s token deadline flakes under load. `F-ENV-1` (low): `mcp-call` does not sandbox HOME / does not copy `settings.yaml`.

## 5. Cumulative change-set review (t2/t3/t5/t6/t7)

- **t2 (B9)**: independently re-verified in t9 — guard 22 ids, my own remove→fail→restore cycle, dry-run shows the row, `skills/**` untouched. No regression found; the guard lives in `scripts/` deliberately so `VENDOR_LOCK` stays untouched.
- **t3 + t12 (R1)**: my own no-session/session-scoped calls on dist `d0aee5c7` (7/7 incl. t12's exec forwarding), source ordering at `regress.ts:143-154`, my own pre-fix control on a copy (10 pass → 3 fail), dist sweep 0 STALE / 16 FRESH.
- **t5 (memory)**: §6 below.
- **t6 (B8)**: my own gate 20/20 (checkout + packed tarball, pins scrubbed, cwd outside the bundle, real search + real codegraph, both negatives), supplementary mount boot 4/4, patch carries **0 `env:` keys** and no binary path, and `scripts/pack-mpd.mjs` ships both launchers (proven by the tarball install, not by reading the script).
- **t7 (QA isolation)**: my own pre-fix negative control created `.mpd/team/mpd-default-587132ea` (27→28) while the fixed case added nothing (28→28, re-confirmed on the frozen tree). `VENDOR_LOCK` skills re-pin is correct (§7).
- Cross-cutting regression checks on the reviewed revision: bundle-lifecycle PASS (`uninstall` residue `[]`), preset-conformance PASS with `bootLog.signatures: []`, typecheck 0.

## 6. Memory migration as DATA handling (t10 A6)

Additive only: source `/root/dshProj/.mpd/memory/agents/agent-dshproj/repo/memory` still holds its **7** files; target holds **27** (was 20) with per-file sha256 7/7 MATCH; the store's own git repo is at HEAD `8635a6e` "memory: wave-2 t5 migration of 7 entries orphaned by the cwd-root bug" (7 files / 117 insertions) with `git status --porcelain` empty. `runtime/reflection.json` is untouched: `7ee2e20805ec59fe8cb06981cadc278a81e3b2e6d30412a3845eb73f04799efc` — identical to the value recorded before the migration, so the reflection state machine was not hand-driven. Visibility proven by a real read (t9): `mpd_memory_status` `root=…/agent-my-power-dsh entries=27`, `mpd_memory_read` surfaces all seven migrated files, `query=workmate` → 6 (including both migrated workmate entries).

## 7. Repository-rule compliance (t10 A5)

| rule | result |
|---|---|
| adapter seam (§6) | PASS — the only `ctx.tools/subagents/skills/agentPresets` hit outside the adopted lib is a **comment** in `mpd-bootstrap-plugin/src/index.ts:6`; the adopted lib is the documented exception. |
| VENDOR_LOCK re-pin rule | PASS — `VENDOR_LOCK.json` diff is 3 lines, all inside the `skills` asset (`fileCount` 364→366, new `treeSha 54155e41…`, upgraded `source` note); `verify-vendor` exit 0. |
| agent-facing text English-only | PASS — no CJK in any changed/added code file (full `git status -uall` expansion, `evidence/` and the adopted prebuilt `client.js` excluded); the bilingual content is user data + human docs. |
| bilingual pairs updated together | PASS — `packages/mpd-mcp-astgrep`, `packages/mpd-mcp-codegraph`, `packages/mpd-codegraph-plugin` and `packages/mpd-comment-checker-plugin` each have EN+`zh-CN` with the switch link under the title. `AGENTS.md` and `skills/dsh-qa/SKILL.md` are agent-facing (English-only by policy); `self-fix-tests/README.md` is an internal test doc, not a human-facing doc. |
| anti-patterns: no cached workspace root, no `chdir`, no `DSH_WORKSPACE_ROOT` from a row | PASS — no `process.chdir` in plugin sources or launchers; no row sets `DSH_WORKSPACE_ROOT`; the only `workspaceRoot(...)` uses are per-call locals (`mpd-memory-plugin/src/index.ts:40`, `mpd-verif-plugin/src/sim.ts:212`). |

## 8. Hygiene (t10 A7)

No `*.bak` / `*.orig` / `.r1pre.bak` / marker files anywhere in the tree; no empty evidence directories; t2's guard lives in `scripts/` (no `skills/**` overlap). The one class worth naming: QA scratch directories at the repo root (`.qa-web-client`, `.qa-reloc`, `.qa-tmp`, `.npm-cache`, `.tmp-cache`, `.venv-rtl`, `.git-home`, `.codegraph`, `.mpd-dsh`) — all gitignored (checked individually) and sanctioned QA state; `.dsh/` is a pre-existing (2026-08-31) stray home, not created by this wave. I removed my own scratch copies (`t9-verification/…/scratch`, `t10-review/…/guard-{copy,fullstrip,repro}`) and left only their result/log artifacts as evidence.

## 9. Verdict

**PASS.** The wave-2 change set is correct on the shipped revision, the adopted-code divergences are small, in-source-marked and re-applied by a guard whose failure mode I exercised myself, the three functional fixes are demonstrated end-to-end (including the wave-1 replay), B8 works in both install layouts, the memory migration is clean data handling, QA isolation has a reproduced negative control, and the repository rules hold. The one unmet sliver (t4 A5 for `tools.js`, F2) is an explicitly captain-deferred, functionally inert heal-order residual already owned by wave 3; it does not silently drop a delta, does not affect the shipped tree, and does not block integration. F1 is a cheap wave-3 hardening that would let `--check` diagnose a partial strip instead of misdiagnosing it.
