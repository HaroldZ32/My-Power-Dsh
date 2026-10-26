# T3 report — truth fixes invalidated by the dsh-tui 0.16.1 → 0.17.0 pin (mechanical, behaviour-neutral)

Task T3 (team `team-20261025152913561-aucj-002`), owner `senior-engineer`, run 2026-10-25.
No git write was performed. No logic, constant or test was changed.

## 1. What changed — three files

### 1.1 `packages/mpd-tui-adapter-plugin/src/index.ts` (docblock only, above the constant)
The parenthetical `0.16.1 is the release this bundle is admitted on (dsh-plugin.json compat)` was FALSE
after T1 moved `compat.hosts` to 0.17.0. Replaced with a version that separates the two facts — the
constant's history and the admission declaration:

```
 * 0.16.1 is the release that INTRODUCED host ownership — the behaviour this gate retires the keeper
 * for — so the constant keeps 0.16.1 forever: `TuiPanelRuntime.register()` enables a panel on
 * registration, `dispose()` removes it, and the boot and settings applies union every registered id
 * back. There is therefore NO enable-list state this adapter could still author — anything it wrote
 * would be a second writer racing the host's own merge, which is exactly the incident class
 * (`fix/sidebar-015-keeper-migration`) this gate retires. Which host the bundle is ADMITTED on is a
 * different fact, declared in `dsh-plugin.json` `compat.hosts` (0.17.0 since v0.15.5).
```

`PANEL_CSV_HOST_OWNED_SINCE`, `PANEL_CSV_SELF_HEAL_SINCE`, `hostOwnsPanelCsv`, `hostSelfHealsPanelCsv`
and every fixture are UNCHANGED (verified by the diff in `36-diff-summary.txt`).

### 1.2 `packages/mpd-tui-plugin/README.md` + `README.zh-CN.md` (one table cell each, same edit)
* EN: `| Sidebar pages (dsh-tui 0.13.0+, adapted to 0.16.1) |` → `… adapted to 0.17.0) |`
* zh: `| 侧栏页面（dsh-tui 0.13.0+，已适配 0.16.1） |` → `… 已适配 0.17.0） |`

`0.13.0+` stays: it records when the seam arrived. Every other version mention in those files is a DATED
MEASUREMENT and was left verbatim (`dsh-tui 0.12.0` / `0.13.0` / `0.14.0` / `0.15.0` sentences,
e.g. "Measured on the real dsh-tui 0.14.0 PTY"). Language-switch links and heading trees untouched —
the docs gate proves the pair still passes (§2).

## 2. Gates — observed results (logs in this directory)

| # | Command | Exit | Observed |
|---|---|---|---|
| 30 | `node scripts/verify-dist-fresh.ts` (post-src-edit) | **0** | `ok: 33/33 targets fresh (each rebuilt twice, byte-identical)`; gate reports `build toolchain: bun 1.4.0 from the repository toolchain` |
| 31 | manual rebuild proof: `./.toolchain/node_modules/.bin/bun build packages/mpd-tui-adapter-plugin/src/index.ts --target node --format esm --outfile <scratch>/tui-adapter.js` then `cmp` | **0** | `BYTE-IDENTICAL to the committed dist/index.js` |
| 32 | `.toolchain/node_modules/.bin/bun run verify:comments` | **0** | 444/444 files, 39790 declarations, `VERDICT: PASS` |
| 33 | `.toolchain/node_modules/.bin/bun run verify:docs` | **0** | `pairs=50 failed=0 violations=0 … dead=0 — PASS` |
| 34 | `.toolchain/node_modules/.bin/bun run typecheck` | **0** | `tsgo --noEmit`, no diagnostics |
| 35 | `.toolchain/node_modules/.bin/bun test packages` (FULL suite, not scoped) | **0** | `2460 pass, 6 skip, 0 fail, 40700 expect() calls, 148 files, 31.90s` — the 6 skips are the documented environment skips (svn toolchain absent; comment-checker binary absent ×4; official-live team readonly) |
| 37 | `node scripts/verify-dist-fresh.ts` (FINAL, after every activity) | **0** | `33/33 targets fresh … 738ms` |
| 36 | `git diff --stat` of the three files | — | 3 files, +9/−7; `packages/*/dist` modified files = **0** |

Scratch rebuilds were written to `<ws>/.mpd/tmp/t3-rebuild/` only (never to `dist/`).

## 3. The dist fan-out is EMPTY — and here is the measurement, not an assumption

The task anticipated a fan-out because "an adapter edit re-emits every package that imports it". That is
true for CODE edits, and it is NOT true for this one: **`bun build` emits zero comments**, so a
comment-only source edit cannot change a single emitted byte.

Measured:
* `grep -c '/\*\*' packages/mpd-tui-adapter-plugin/dist/index.js` → **0** (no comment survives the build);
  the old text (`admitted on`) and the new text (`ADMITTED on is a`) are both absent from `dist/`.
* Cross-check across every committed `packages/*/dist/*.js`: 2 of 34 files contain a `/**` sequence and
  BOTH are string literals (`"/rules/**"` in `mpd-boulder-plugin/dist/index.js:440`, a glob inside a
  prose message in `mpd-roles-plugin/dist/index.js:646`) — **zero dist files carry an emitted comment**,
  so a comment-only src edit is a byte-level no-op everywhere in this tree, not just in this package.
* `node scripts/verify-dist-fresh.ts` run AFTER the src edit → **33/33 FRESH** (the gate rebuilds each
  target twice from `src/` with the PINNED bun 1.4.0 and compares bytes).
* An independent manual rebuild of the adapter with the pinned binary → `cmp` reports **byte-identical**
  to the committed `dist/index.js`.
* `git status -- porcelain -- 'packages/*/dist'` → **0** modified files.

Per the task's instruction ("rebuild exactly what it reports stale"), ZERO targets were rebuilt — there
was nothing stale to rebuild. Re-running the gate until it PASSES is satisfied: it passed on the first
post-edit run and again on the final run.

## 4. Guards respected

* No constant / logic / test / fixture edit: the three diffs are a docblock body and two table cells.
* `VENDOR_LOCK.json`: NOT touched by me. NOTE: it is MODIFIED in the worktree by the CAPTAIN's single
  `skills` re-pin (`treeSha bd6b06e7… → 4a7e6ed2…`); with that change in place `node scripts/verify-vendor.ts`
  now reports `PASS - 7 shipped asset(s) fingerprinted` (I ran it read-only to confirm the interaction; no
  write). This resolves T1's expected-red vendor state.
* `dist/mpd-package/**`, `package.json` versions, `.mpd/**` (beyond my scratch dir), `evidence/**`
  history, and every other plugin's `src` are untouched.

## 5. Noticed but NOT touched (out of T3's scope) — finding for the Lead

**A SECOND stale current-pin claim survives this wave, in a package README pair T3 was not given:**

* `packages/mpd-better-sidebar-host/README.md:47` — "…repository pins `0.2.1-rc.2`, so the row mounts
  on every supported composition."
* `packages/mpd-better-sidebar-host/README.zh-CN.md:39` — "…本仓库固定的是 `0.2.1-rc.2`，因此在所有受支持的组合里该行都会挂载。"

Both state the CURRENT repo pin, which T1 moved to `0.2.1-rc.3`. They need the same mechanical treatment
(both languages, one edit, then `verify:docs`) — a small follow-up, not something I widened T3 to absorb.

Classified as CORRECTLY LEFT (historical, not stale-target):
* `packages/mpd-bundle/README.md:100` + zh — "harness 0.2.1-rc.2's schema no longer declares it" (a
  historical schema fact).
* `packages/mpd-dsh-adapter-plugin/README.md:113` + zh — "Honest bound on harness 0.2.1-rc.2: `dispose()`…"
  (a bound measured on rc.2).
* `packages/mpd-tui-adapter-plugin/README.md:117,121` + zh — `>= 0.16.1` gate-threshold statements (the
  §4 invariants of the wave contract).

## 6. Bounds

No host was booted (no rc.3 mount, no 0.17.0 PTY), no Docker lane ran, no browser render: T3 is a
comment/docs truth fix plus a fan-out check. "Behaviour unchanged" rests on two independent proofs — the
byte-identical dist rebuild and the full green package suite — not on inspection alone.

## 7. Evidence index

`30-dist-fresh-post-src-edit.log` · `31-adapter-manual-rebuild-proof.log` · `32-verify-comments.log` ·
`33-verify-docs.log` · `34-typecheck.log` · `35-bun-test-packages.log` · `36-diff-summary.txt` ·
`37-dist-fresh-final.log` · `REPORT.md`.
