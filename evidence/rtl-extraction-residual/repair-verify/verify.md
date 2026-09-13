# t11 — independent verification of the RTL-extraction repair

**Task**: t11 · verification round 1 · **Verifier**: Reviewer (read-only; no repairs performed)
**Reviewed task**: t8 (repair) · **Pin measured**: mpd `32ae54dd10db7ea46e1c1263143d56f266fd1f78` (`dev`)
**State**: **STAGED, NOT COMMITTED** — `git diff` (worktree↔index) is empty while `git diff --cached`
carries the repair: **52 staged paths** (plus untracked evidence dirs), porcelain-before **61** →
porcelain-after **62** (the single new entry is the `bundle-lifecycle` evidence dir this run produced).
Every number below is anchored to that staged revision, and the subjects are hashed in
`raw/final-subject-hashes.txt`.
**Scope honoured**: all writes under `evidence/rtl-extraction-residual/repair-verify/`; nothing under
`repair/**`, no repo file edited, silicon not touched.
**Verdict**: **PASS** — every re-measured defect is closed, all eight gates exit 0, and the repair
introduced no new dangling reference; three carried-forward items are recorded in §6/§8.

## 1. Gates re-run by me — exit codes

| Gate (contract order) | Exit | Evidence |
|---|---|---|
| `node scripts/verify-vendor.mjs` | **0** | `raw/gate-verify-vendor.log` |
| `node scripts/verify-rtl-references.mjs` | **0** | `raw/gate-verify-rtl-references.log` |
| `node scripts/verify-rows-parity.mjs` | **0** | `raw/gate-verify-rows-parity.log` |
| `bun run typecheck` | **0** | `raw/gate-typecheck.log` |
| `bun test packages` | **0** (298 pass / 0 fail; was 295/3) | `raw/gate-bun-test-packages.log` |
| `bun run test:qa` | **0** | `raw/gate-test-qa.log` |
| `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | **0** (was 1) | `raw/gate-bundle-lifecycle.log` |
| `node scripts/patch-agent-teams-fixes.mjs --check` | **0** (`13 mpd delta region(s) across 3 adopted file(s)`) | `raw/gate-delta-check.log` |

Raw exit block: `raw/gate-exits.txt`. Note `test:qa`'s precondition: `relocate-smoke.mjs:20` hard-fails
when `dist/mpd-package/package.json` is absent, and `package.json:29` runs every case's `--self-test`,
so **`test:qa` requires a prior `pack-mpd.mjs` run** — a real, currently undocumented precondition
(§6.2), not a flake.

## 2. Defect re-measurement (PASS/FAIL)

| # | Defect (source) | Re-measurement (my command) | Verdict |
|---|---|---|---|
| 1 | Six stranded RTL guides (t1 F1 / t5 A1) | all six appear in `git status --porcelain` as `D` (`raw/deleted-paths.txt`); inbound sweep §4 shows no live reader | **PASS (closed)** |
| 2 | Two RTL QA cases (t1 F2) | both deleted; `test:qa` green over the remaining corpus; `skills/dsh-qa/SKILL.md` has **0** `rtl*` rows and a new `software-smoke` row (`:71`) | **PASS (closed)** |
| 3 | HDL registrations live in the LSP server (t5 K1/V1) | overlay pair HDL-free; `dist/cli.js` **234 827 B / `9f41d425…`**, 0 hits for verible/slang/verilog/systemverilog/`.vh"`/`.svh"` (was 4+4+5+2); anchor renamed to `mpd-lsp-overlay-v1` in `build-mcp.mjs:41` and both overlays `:2`, trip points intact at `:59-60`/`:74` | **PASS (closed)** |
| 4 | LSP README pair + HDL template (t5 K2/V1) | RTL sections removed: **0** RTL/HDL hits in `README.md` and `README.zh-CN.md`; `packages/mpd-mcp-lsp/templates/` **gone** | **PASS (closed)** |
| 5 | Golden Verilog fixtures + their two QA docs (t5 K3/V2) | fixtures deleted; `docs/adder4.md:3-9` and `docs/cnt8.md:3-9` repointed to `@mpd-dsh/silicon tests/golden/fixtures/verilog/modules/*.v` with an explicit "moved… deleted by t8" note → not dangling | **PASS (closed)** |
| 6 | `install-mcp.mjs` HDL LSP targets (t5 addendum §5) | `grep -nE 'LSP_TARGETS|verible|slang' scripts/install-mcp.mjs` → **no hits** (targets removed) | **PASS (closed)** |
| 7 | Stale `dist/mpd-package` pack (t5 K4/V4) | pack clean: 0 retired cases, 0 HDL pages, 0 HDL strings; 1119-file listing; LSP/astgrep/gitbash packed `cli.js` all equal their `VENDOR_LOCK` pins | **PASS (closed)** |
| 8 | Standing reference gate structurally blind (t5 K5/V3) | `CASES = []` + an explicit `mpd-side cases: 0` disclosure and a labelled PENDING bucket ("t8 (retired in mpd)") instead of a silent tolerance; the gate no longer denies its own subject set | **PASS (mitigated as ruled)** |
| 9 | R7.15 guard falsifiability | Guard-1 four directions + Guard-2 two shapes, §3 — both refuse zero-subject runs **by name** | **PASS** |
| 10 | Carrier hook corrupt-fallthrough (t5 V-hook-corrupt-fallthrough) | live semantics = "presence decides"; six-direction matrix §3 | **PASS (ruling implemented)** |
| 11 | Rebrand regression on rebuild (captain-restored) | work = pack = `VENDOR_LOCK` for both servers, 0 OMO spellings, `verify-vendor` 0 | **PASS (green now)** |
| 12 | Pointer note for the moved capability (C6 second half) | `README.md` and `README.zh-CN.md` carry the silicon pointer (2 lines each; was 0 in `README.md` pre-repair) | **PASS** |

## 3. Carrier-hook matrix — verbatim region, all six directions

Driven from the **verbatim** region (`lib/index.js`, slice 53 lines, sha256 `5b40c5b180a8…`) wrapped in a
probe function; script `raw/probes-t11.mjs`, results `raw/probes-t11-out/probes-t11-result.json`.

| Direction | Warnings | `rtl-ip` merged | Expected | Verdict |
|---|---|---|---|---|
| (d) valid nearest | 0 | yes (`rtl-ip`), `mpd` kept | merge + no warning | **PASS** |
| (a) corrupt nearest + valid farther | **1** (names the corrupt path) | **no** — farther demonstrably not merged | stop + one warning | **PASS** |
| (a2) unreadable (ELOOP) nearest + valid farther | **1** | no | stop + one warning | **PASS** |
| (a3) all unreadable (ELOOP) | **1** | no | `{}` + one warning | **PASS** |
| (b) all corrupt | **1** | no | `{}` + one warning | **PASS** |
| (c) all absent | **0** | no | silent `{}` | **PASS** |
| (d2) dangling symlink nearest + valid farther | 0 | yes (`rtl-ip-FARTHER`) | *accepted residual*: ENOENT ⇒ treated as absent | **PASS as designed, gap recorded** |

Fixture mechanics: `ELOOP` via a true symlink cycle (`chmod 000` is a **no-op as root** — measured
`READ OK`); the full-module harness (`raw/hook-harness.mjs`) additionally showed that Node's resolver
pre-empts an unreadable *nearest* when a farther copy is resolvable — a probe-constructibility property
(`raw/hook-a2-debug.txt`), not a code defect; the region probe exercises the intended path.

## 4. Inbound-reference sweep for every deleted path

13 deleted paths (`raw/deleted-paths.txt`), each swept with `git grep -l -F <basename>` over the tracked
tree (evidence excluded): `raw/inbound-sweep-and-final.txt`. Outcomes: **no live reader**; the only
non-`NO-INBOUND-REFERENCE` hits are (i) `scripts/verify-rtl-references.mjs`, which now carries the
retired names as a **labelled PENDING/disclosure bucket** (it does not read them — `CASES = []`),
(ii) `docs/adder4.md`/`docs/cnt8.md`, **repointed** to the silicon bundle, (iii) `tests/golden/fixtures/
verilog/README.md` named from process records (`AGENTS.md`, `PLAN.md`, `README.md`) — checked: the
targeted grep for `fixtures/verilog` in `README.md`/`README.zh-CN.md`/`AGENTS.md`/`PLAN.md` returns
**nothing**, so those earlier matches were incidental words, not stale paths.

## 5. Repair-induced damage — none found, and what was looked for

Searched for: rebuilds that revert fixes, gate subjects emptied out, stale distributed artifacts, and
dangling links after deletions.

* **None found on the settled bytes.** The pack, the three packed `cli.js` files, `VENDOR_LOCK` and
  `verify-vendor` agree; every gate is green; the deleted docs/cases have no live reader (§4).
* **Class instance examined and closed:** the `build-mcp.mjs` rebuild regression the captain found and
  restored (pre-rebrand `OMO_*`/`platformFromOptions`/`Usage: omo-git-bash` regenerated into the astgrep
  and gitbash dists, which is what turned those two vendor assets red). Asserts re-run by me:
  astgrep `f06bba31…`, gitbash `cb9ce8f3…` — work = pack = `VENDOR_LOCK`, **0** OMO spellings,
  `verify-vendor` exit 0. Mechanism recorded for the report: the scrub at `build-mcp.mjs:104-152` is a
  targeted key list whose coverage (not its existence) is the gap — `git-bash`'s only entry/residual is
  `omo-git-bash-run-`, so the usage string and `platformFromOptions` sit outside both and would revert
  **silently**; the vendor fingerprint is the only guard. Follow-up belongs to its own pass.
* **§6.2 `test:qa` precondition** and **§6.3 the gate's `CASES = []` disclosure** are the two honest
  carry-forwards, both described below.

## 6. Carried-forward items (not defects of the repair)

1. **Rebrand guard absent** — a rebuild for any unrelated server can still revert the astgrep/gitbash
   rebrand silently; the vendor pin is the only detector (recommend brand-shaped residuals in a scoped
   follow-up).
2. **`test:qa` ordering precondition** — `relocate-smoke` requires a prior `pack-mpd.mjs`; the mechanism
   should be documented (or the case made to SKIP-with-reason when the pack is absent), else a fresh
   checkout fails `test:qa` with a message that looks like a flake.
3. **Reference gate is now honest but narrow** — `CASES = []` means its mpd-side subject set is empty by
   construction; the `considered > 0` / subject-count assertion the ruling contemplated (R7.15 sibling)
   is the natural next step so a future zero-subject run cannot pass unnoticed.
4. **Mount-proof half of the hook not exercised by me** — I verified the hook's code path from the
   verbatim region, but did not perform a full **mounting boot with `@mpd-dsh/silicon` genuinely
   installed** (the present-direction sandbox); the four-consumer merge (`resolved.profiles`, captain
   prompt, slash command, gesture boundary) therefore remains evidenced by code path + region probe, not
   by a live boot. `--dump-config` was not used and is not sufficient.

## 7. State, hashes, and what changed during the run

```
HEAD            32ae54dd10db7ea46e1c1263143d56f266fd1f78   (staged, uncommitted)
porcelain       61 before → 62 after   (new entry: this run's bundle-lifecycle evidence dir)
staged paths    52
```
Subject hashes (`raw/final-subject-hashes.txt`): `lib/index.js fd436f0f…`, LSP `cli.js 9f41d425…`,
astgrep `f06bba31…`, gitbash `cb9ce8f3…`, `VENDOR_LOCK.json 92f4acea…`,
`verify-rows-parity.mjs d2100f01…`, `verify-vendor.mjs a3df81fb…`.
`VENDOR_LOCK` diff = 5+/5− (the **single** re-pin; skills `fileCount` 328, `treeSha 2b55ab84…`).

## 8. Honesty — what this verification does NOT cover

* Nothing silicon-side (C9 and all parity claims) — out of scope by contract.
* No full mounting boot for the carrier hook (§6.4) and no pack-to-a-scratch-location reproduction
  (`pack-mpd.mjs` writes `dist/`); the packed copies were compared in place instead.
* I audited the repair's own artifacts as inputs, never as evidence; every number above was produced by
  the commands in this directory's raw logs.
