# Hash ledger — documentation wave (w1), final revisions

Measured by the captain in `/root/dshProj/my-power-dsh` with `sha256sum`, at the moments recorded.
Every lane cites THIS file instead of re-anchored quotes; a hash without its measurement moment is
what produced four stale-reading rounds during the wave.

## Shipped files, final bytes

| File | sha256 (16-char prefix → full) | Measured |
|---|---|---|
| `README.md` | `9d58873d602a9425…` | 2026-09-19T10:58:09Z, re-checked 10:59:24Z |
| `README.zh-CN.md` | `61f7dadf721b0514…` | same |
| `docs/design.md` | `62bd827a9449aa58…` | same |
| `docs/design.zh-CN.md` | `e964888bbb626f5e…` | same |
| `docs/index.md` | `9a824fe66982a355…` | same |
| `docs/index.zh-CN.md` | `b256e8bdf8fd3692…` | same |
| `docs/user-guide.md` | `235d01eeb63da62d…` | same |
| `docs/user-guide.zh-CN.md` | `5a4b1b6b2ce4f0ec…` | same |
| `AGENTS.md` | `d74a934d6653265083453d937fdd3d6eb1c77e79b3093cfe9d3878c290fee50a` | 10:59:24Z (after t19) |
| `packages/mpd-bundle/cordis.patch.yml` | `d141f70771c18cc0…` | 10:58:09Z |
| `packages/mpd-config-plugin/src/index.ts` | `e43e6a8483c8dd73…` | same |
| `packages/mpd-config-plugin/dist/index.js` | `566af9ee75394327…` | same |

Full values (untruncated) are in the commit message of the wave commit and in each task payload.

**Deleted by the wave:** `docs/architecture.md`, `docs/architecture.zh-CN.md` (the rename source of
the design document; `git mv` semantics, staged as deletions).

## The design pair's four-revision chain (provenance, not drift)

The pair legitimately moved four times; the chain is recorded on disk in
`evidence/docs-overhaul/design-doc.md` §§7/10/11/12/13 and was observed independently by two seats.

| Revision | `docs/design.md` | Lines | What moved it |
|---|---|---|---|
| completion payload | `3e792155bcac83e4…` | 588 | t3 as filed |
| §11 | `13914155a6936941…` | 589 | captain M-2: the non-existent `/roster` command replaced by `mpd_roles_list` |
| §12 | `b823f58b3de61c96…` | 587 | §8b rewritten to durable facts only (drop the "all point here" claim) |
| **t15 (final)** | `62bd827a9449aa58…` | 584 | F1 guard attribution → `lib/harness-compat.js`; F2 scratch bullet deleted |

`docs/design.zh-CN.md` moved in lockstep: `060a6f61…` → `bec5db9e…` → `3761f804…` → `e964888b…`.

## Gate exit codes, measured on these bytes

| Gate | Exit | Output |
|---|---|---|
| `node scripts/verify-gates.mjs` | 0 | `PASS - 5/5 member gate(s) green` (vendor, dist-freshness, rows, docs-parity, preset-conformance) |
| `node scripts/verify-docs-parity.mjs` | 0 | `pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS` |
| `node scripts/verify-rows-parity.mjs` | 0 | `ok: 25 row ids match the bundle patch insert list` |
| `bun run test:qa` | 0 | `[test:qa] all self-tests passed` |
| `bun run typecheck` | 0 | `tsgo --noEmit` clean |
| `node scripts/pack-mpd.mjs` | 0 | staged pack; assertions below |
| `node scripts/verify-pack-closure.mjs` | 0 | `1184 file(s) compared, 1184 identical, 0 drift, 0 expected-after-pack`; completeness 408/409 present with 1 declared exemption; 382 asset files in the packed tree (raw log: `raw/t11/pack-closure.log`) |
| `node scripts/install-profile.mjs --dry-run` | 0 | `DRY-RUN done (nothing written)` |
| `bun run verify:vendor` | 0 | commit `8c57e463…` / `5.0.0-beta.20` / skills 326 files |

Baseline before the wave (`dev@a9c3c3e`): the same five static gates all exit 0
(`evidence/docs-overhaul/baseline-metrics.md`), so every green above is a post-wave re-measurement,
not inherited state.

## Re-pack assertions (the pre-wave artifact was stale)

The pack on disk before this wave was dated 2026-09-18 10:25 and still carried the RETIRED
`architecture.md` / `architecture.zh-CN.md`, with a README/user-guide predating the rewrite. After
`node scripts/pack-mpd.mjs` (no script change; the packer `rmSync`s its output dir first):

- `dist/mpd-package/docs/architecture.md`, `architecture.zh-CN.md` — **ABSENT** (asserted)
- `dist/mpd-package/docs/design.md` (47579 B), `design.zh-CN.md` (46793 B) — **PRESENT** (asserted)
- `dist/mpd-package/README.md` sha256 `9d58873d…` = repo `README.md`; `dist/mpd-package/docs/user-guide.md` sha256 `235d01ee…` = repo `docs/user-guide.md` — the pack now mirrors the wave.

`dist/mpd-package/` is gitignored build output (`.gitignore:12`; `git ls-files dist/` is empty), so
it is not part of the commit — the assertion above is the check that the artifact stops shipping the
retired names.

## Counting convention (so two true numbers never read as drift)

The README evidence and the README verifier disagreed by exactly one line: `734` vs `735`.
`split(/\r?\n/).length` counts the empty trailing element a final newline produces, so it equals
`wc -l + 1` on a newline-terminated file. Both files end with a newline; sha256 and byte size are the
convention-free anchors (`44472` / `44181`).

## Attribution

Per AGENTS.md §5, attribution comes from task ownership + content, never from git's author field —
the shared checkout writes every commit under one identity. The wave's map:

| Task | Owner (seat) | Output |
|---|---|---|
| t1 | Architect | `plugin-inventory.md` |
| t2 | Researcher | `baseline-metrics.md`, `baseline-commands.txt` |
| t3, t13, t15, t16 | Senior Engineer | `design.md` + zh, `mpd-config-plugin/{src,dist}`, `design-doc.md`, `slot4-string.md` |
| t4, t14 | Deep Worker | `README.md` + zh, `readme.md` |
| t5, t17 | Lead | `user-guide.md` + zh, `user-guide.md` (evidence) |
| t6, t12, t19 | Junior Engineer | `verify-readme.json`/`.log`/`.mjs`, `repoint.md`, `AGENTS.md` |
| t7 | Explorer | `verify-design.json`, `verify-design-reverify.json` |
| t8, t9, t18 | Plan Reviewer | `verify-userguide.json`, `verify-userguide-reverify.json`, `self-review.md` |
| t10 | Reviewer | `review-round1.md`, `review-round1-checks.mjs` |
| t11 | Captain | this ledger, `SUMMARY.md`, the commit |
