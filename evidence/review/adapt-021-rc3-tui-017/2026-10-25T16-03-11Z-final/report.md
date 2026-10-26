# Final blessing — v0.15.5 shipped state

**BLESS**

Reviewer: reviewer (team M2, task T7). Scope: the T6 delta (CHANGELOG truth + sidebar header policy
reword) plus the frozen shipped state it produces. Findings only — no file edited.

**Anchor.** HEAD `faa273f5`, branch `release/v0.15.5`, 38 modified tracked paths. Aggregate sha256 over
every modified tracked path (sorted `sha256sum | sha256sum`):
`64da200f2f5d31e1a8ef91786ce3f9f78fcf18cf4b246bbfb1ea2de3aa8bea50`, measured at `16:03:11Z` and
re-measured identically at `16:04:32Z` (81 s settle, past the manual's 50 s window). The tree did not
move while I reviewed it. **Any edit after `16:04:32Z` invalidates this blessing**; re-checking is one
command (`git status --porcelain | grep '^ M' | awk '{print $2}' | sort | xargs sha256sum | sha256sum`).

## 1. CHANGELOG `## v0.15.5` — truthful and complete

- **The behaviour claim is now true.** "no plugin **behaviour** changed" — the wave's plugin-source edits
  are two comments (the adapter docblock, the shim module header); the rest is prose, Docker-lane
  defaults and QA carrier strings. Nothing executable moved, which `verify-dist-fresh` corroborates
  (33/33 fresh byte-identical) and the full suite confirms (2460 pass).
- **The new `**Fixed — stale prose the pin bump invalidated.**` bullet names all four fixes, and every
  one exists in the tree**: (i) the adapter docblock above `PANEL_CSV_HOST_OWNED_SINCE` separating the
  permanent 0.16.1 floor from the admitted host declared in `dsh-plugin.json` `compat.hosts`;
  (ii) `packages/mpd-tui-plugin/README.md` + zh-CN "adapted to" target → 0.17.0; (iii)
  `packages/mpd-better-sidebar-host/README.md` + zh-CN current-pin literal → 0.2.1-rc.3; (iv) the
  `packages/mpd-better-sidebar-host/src/index.ts` module header policy reword. **No invented fix**: each
  claim maps to a diff I read, and the bullet's closing numeric claim ("33/33 targets fresh, each rebuilt
  twice") matches my own run exactly.
- **No history entry was touched.** The entire `CHANGELOG.md` diff versus HEAD is a single hunk
  (`@@ -16,0 +17,54 @@`) that inserts the v0.15.5 block; the v0.15.4 entry and everything below are
  byte-identical to HEAD.
- Nothing material is omitted: the wave's other carriers, pins, docs and the README table were already
  covered by the entry's earlier bullets, and the four previously-missing fixes are now the Fixed bullet.

## 2. Sidebar shim module header — accurate, and the "seam moved twice" line is HISTORY

- **The policy reword is accurate for the whole supported range and cannot rot.** It states that
  `connection` is a cordis Service provided by `@deepseek-ai/dsh-client-connection` from the host's peer
  floor (`0.2.1-rc.1+`) onward, and that the shim mounts the host whenever that service exists — in
  every composition whose installed harness satisfies both the host's peer floor and the pin this bundle
  declares. No bundle-pin literal is named, so the next pin bump cannot falsify it. The mount predicate
  is the runtime service probe (`probeSidebarSeam`), which is exactly what the paragraph describes.
- **The comment-only claim is provable.** The diff is the header block only: no code, no constant, no
  exported symbol (`export const/interface/type/function` list unchanged), no test, and no
  `packages/*/dist` path appears in `git status` at all.
- **Explicit judgement on the line I was asked about** — "THE SEAM MOVED TWICE … 0.2.1-rc.2 provides no
  `webRuntime` at all — `@deepseek-ai/dsh-web-app` now provides only `webApp = { getAdvertisedUrl }`":
  **legitimate release history, NOT a stale current claim.** Why: (a) it sits in the section that
  narrates the seam's two moves (0.2.0-rc.2 → 0.2.1-rc.2 → the measured 0.28 `connection` contract), so
  it names the release at which a behaviour CHANGED — the same semantics as `PANEL_CSV_HOST_OWNED_SINCE`;
  (b) it names no bundle pin and makes no claim about what this bundle pins today; (c) the fact it
  asserts remains true under 0.2.1-rc.3 (contract §0 measured the rc.2→rc.3 `.d.ts` surface identical),
  and the shipped implementation contains **zero** `webRuntime` references — all three mentions live in
  that comment narrative, and the code arms on `connection` — so nothing in the tree contradicts it;
  (d) "no pinned host read any more" is a generic statement about the pinned host line, not a version
  literal. Rewriting it would erase the reason the shim exists.
- No other sentence in the file contradicts the policy: the remaining version statements are the dated
  seam history, the "measured 2026-10-21" 0.28 contract, and generic "pinned 0.28 host" references.

## 3. Nothing else moved — invariants hold

- **Relative to my T5 stamp, exactly TWO tracked paths changed**: the shim module header (23:59:20) and
  `CHANGELOG.md` (23:59:36). The other 36 modified paths and every other tracked file are unchanged
  (mtime scan + identical aggregate hash).
- **No `packages/*/dist` change**: 0 paths.
- **`VENDOR_LOCK.json` is one line** (1 insertion, 1 deletion) — the skills `treeSha` only.
- **No `skills/**` edit after the re-pin**: the latest skills mtime is 23:36:12, the re-pin 23:46:05.
- **Three carriers agree at 0.15.5** (`package.json`, `dsh-plugin.json`, `dsh-distribution.json`);
  `manifestVersion` 0.15; `compat.hosts` `@deepseek-harness-tui/dsh-tui@0.17.0`.
- HEAD still `faa273f5`; no git write was performed by any member.

## Findings

### 1. Nit (non-blocking) — two wording imprecisions

- The shim header says "**No version literal is named here on purpose**" in a paragraph that does name
  `0.2.1-rc.1+` (the host peer floor). The intent — no *bundle-pin* literal — is clear from the clause
  that follows; "no bundle-pin literal" would be exact.
- The changelog's "A **comment-only** pass over the claim sites" also covers README prose; only the
  later "comment-only edits" (scoped to the dist claim) is used precisely.
Neither changes a fact nor affects behaviour. Fix opportunistically or leave.

### 2. Low (operational, non-blocking) — stage the release commit explicitly

The wave's own evidence is untracked (`evidence/adaptation/**`, `evidence/review/**`), alongside **~40
untracked evidence entries from earlier waves** (19 under `evidence/restore`, 16 under `evidence/dsh-qa`,
3 under `evidence/docker`, plus `evidence/merge-20261022` and an `evidence/fix-task-dependency-guard`
log) that were already untracked at 23:29, before T1's first edit. A blanket `git add -A` would pull
that unrelated history into the v0.15.5 commit. Stage the 38 tracked paths plus the wave's evidence
explicitly. (`.mpd/` and `/.qa-*` are gitignored, verified.)

## Declined to judge

- The "seam moved twice / no `webRuntime`" line as a defect: judged legitimate history above, with reasons.
- The Docker lanes: excluded by T7 — the captain is running them, and cite-ability is the captain's. The README's "built and verified against" row for 0.15.5 is backed the moment those stamps land.
- The pack artifact `dist/mpd-package/**`: excluded by T7.
- The vendor re-pin not being named in the changelog: it is derived bookkeeping (§9 pairs it in the commit), not a user-facing change.
- The changelog's "the `skills/dsh-qa` TUI carriers … name `0.17.0` / `0.2.1-rc.3`" compound subject: noted in T2, parenthetical disambiguates, unchanged.
- The untracked earlier-wave evidence directories themselves: not this wave's to judge; only their staging risk matters (finding 2).
- Older CHANGELOG entries, and the README correspondence-table content: out of scope per T7.

## Gates I re-ran myself (logs in this directory)

| Gate | Exit | Observed |
|---|---|---|
| `verify:docs` | 0 | `pairs=50 failed=0 violations=0 exempt=24 derived=3 links=453 dead=0 — PASS` |
| `verify:comments` | 0 | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature` |
| `verify-dist-fresh` | 0 | `ok: 33/33 targets fresh (each rebuilt twice, byte-identical)` — toolchain `bun 1.4.0` from `.toolchain`; 1 NOT COVERED (prebuilt) |
| `verify:manifest` | 0 | `component-ref-version: 6 self-urn ref(s) compared against distribution.version 0.15.5, 0 stale`; `VERDICT: PASS` |
| `verify-vendor` | 0 | `PASS - 7 shipped asset(s) fingerprinted, upstream identity not checked` |
| `bun test packages` (FULL) | 0 | `2460 pass, 6 skip, 0 fail, 40700 expect() calls, Ran 2466 tests across 148 files [30.33s]` |

## Bounds

- **Not run**: the Docker lanes (captain's, excluded), any host boot/PTY, the pack. Registry unreachable
  from this sandbox, so published-artifact facts remain the contract's measurements.
- **Not read**: the writers' transcripts (reports and logs only), and `dist/mpd-package/**`.
- **Blessing is byte-anchored**, not intent-anchored: it covers the tree as hashed at `16:04:32Z`. A
  further edit — including a fix for the Nit or a re-pack touching tracked files — requires a re-hash
  and, if anything under `packages/**`, `skills/**` or `VENDOR_LOCK.json` moves, a re-run of the
  affected gates.
- I judged the tree, not the authors' claims: every writer statement I could check matched my own
  observation.
