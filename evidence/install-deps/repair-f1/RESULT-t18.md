# t18 — repair round 2: the t16 integration blockers (I-1 packed leg, I-2 tokens, I-3 anchors)

**Author:** Deep Worker (team `mpd-install-deps`, task `t18`, attempt 1, `attempt_id`
`d4b39099-5cf7-456a-b316-3a95c02d665f`). **Kind:** repair (round 2).
**Verdict:** I-1 CLOSED · I-2 CLOSED in substance (0 secret values; the literal `grep` residue is
classified and named, see §2) · I-3 CLOSED (five strings rewritten, sweep re-run) · I-4 optional and
out of scope (reported) · I-5 recorded.

**On the Objective line:** t18's objective repeats "close verification finding F1" — that finding was
already closed by `t14` (guard body `5859cb4e…`, row-aware rule, 11-arm ledger in
`evidence/install-deps/repair-f1/`). What t18 actually carries is the t16 integration pass's
`needs_revision` blockers, and that is what this document records. No guard change was made here.

## 1. I-1 (high) — the packed leg is current again

| leg | before | after |
|---|---|---|
| `dist/mpd-package/cordis.patch.yml` | `e70a179e…` (pre-F1 guard, 3384 chars) | **`1b316b68850fbe3958b16088ac723abcd50faabd178668de7ed6044811107e8f`** |
| `packages/mpd-bundle/cordis.patch.yml` | `1b316b68…` | `1b316b68…` |
| packed patch byte-identical to source | no | **yes** (`packed === src`) |
| packed carries the F1 guard scalar | **false** | **true** |
| installer carries the same scalar | true | true |
| packed `dependencies` arm | `{"dsh-better-sidebar":"0.19.0-alpha.1"}` | unchanged |

Commands: `node scripts/pack-mpd.mjs` (canonical `dist/mpd-package/`, exit 0; `dist/**` is gitignored,
so the commit tree is unaffected either way) then `node scripts/verify-pack-closure.mjs` (exit 0).
**Freshness is read from the expected-after-pack list, never the exit code (AGENTS.md §4, T-91):**
`content bytes: 1186 file(s) compared, 1186 identical, 0 drift, **0 expected-after-pack**` — i.e. the
pack absorbed everything it owed and nothing is left pending. Completeness: `410 declared source
file(s) compared, 409 present, 1 declared exemption(s), 0 absent`.

Raw: `packed-leg.before.txt`, `packed-leg.after.txt`.
**Still stale (out of this task's scope):** `evidence/install-deps/repair-r2/pack-verified-sha256.txt`
is pinned to the old `e70a179e…`; this task pins the current pair in `packed-leg.after.txt`.

## 2. I-2 (high) — evidence tokens redacted; the literal re-scan residue classified

The redactor is in this task's scope and was **hardened** while running it:

* `statSync` → **`lstatSync`**, and a symlink is REPORTED, never followed (the t16 optional hardening).
* The marker no longer carries the `<KEY>=` literal: the replacement is `token[redacted:Nch]`, the
  legacy marker `token=<redacted:Nch>` is normalized to the same form, and the script's own regex is
  assembled from `KEY` so the scanner cannot poison its own re-scan. It is now **idempotent**.

| measurement (UTC) | result |
|---|---|
| `redact-tokens.mjs --write` (first pass, 04:33Z) | 77 token values in 47 of 401 files |
| `redact-tokens.mjs --write` (hardened pass, 04:35Z) | 90 values (redactions + legacy-marker normalizations) in 60 of 423 files |
| dry run after the pass | **0 token value(s) in 0 file(s)** — nothing left to redact |
| secret-shaped values (`token=` + 20+ URL-safe chars) in `evidence/install-deps` | **0** |
| the same scan across the WHOLE `evidence/` tree | **131** — outside this wave's tree, reported (§7) |
| literal `grep -rl 'token=' evidence/install-deps …` | **62 files**, all classified below; **0 secrets** |

Residue by subtree (62): `verification` 48, `repair-f1` 5, `implementation` 4, `repair-r2` 2,
`integration` 2, `verification-final` 1. Shapes: extraction REGEX sites in other lanes' probe scripts
(`token=([A-Za-z0-9_-]+)`), URL templates and placeholders (`?token=$TOKEN`, `token=<…>`, `token=…`),
prose quoting the acceptance's own scan command (both integration records), and this task's own
measurement record.

**Why the literal 0 is deliberately NOT chased:** every remaining match is a NON-SECRET use of the
string in ANOTHER LANE'S records/scripts (or in the two integration records quoting this very
acceptance line). Reaching a literal 0 would require rewriting those historical records and probe
scripts — including the reviewer's quote of the command being run — which removes no secret and
falsifies evidence. The §10 requirement (no secret material in committed evidence) is met and
measured: 0 secret-shaped values, redactor idempotent at 0 files.

Raw: `redact-before.txt` (04:33:32Z: 107 files / 53 distinct values by the blunt grep), `redact-write.log`,
`redact-normalize.log`, `redact-after-secrets.txt`, `redact-residue-files.txt`, `redact-write.log`.

## 3. I-3 (medium) — the three dangling anchors fixed; sweep re-run

| string (before) | rewritten to | file |
|---|---|---|
| `…/evidence/install-deps/qa-case/2026-09-20T04-23-33.669Z/tui-tui-plane/{boot.pane.txt,tui-pane.log}` | `…/repair-f1/qa-case-rerun/2026-09-20T04-23-33.669Z/tui-tui-plane/…` | `repair-f1/qa-case-rerun/2026-09-20T04-23-33.669Z/result.json` (2 strings) |
| `…/evidence/install-deps/qa-case/2026-09-20T03-59-54.395Z/tui-tui-plane/…` | `…/repair-r2/qa-case-rerun/2026-09-20T03-59-54.395Z/tui-tui-plane/…` | `repair-r2/qa-case-rerun/2026-09-20T03-59-54.395Z/result.json` (2 strings) |
| `evidence/install-deps/captain-cross-check/20260920T033505Z/result.json` | `…/20260920T033545Z/result.json` (the directory on disk) | `captain-cross-check/20260920T034916Z-f3-repro/result.json` (1 string) |

All five targets verified present after the rewrite (`citation-fixes.txt`). The sweep was re-run with a
shipped, re-takeable tool (`citation-sweep.mjs` → `anchor-scan/citation-sweep.result.json`):
**422 files scanned · 271 distinct cited strings · 232 resolved · 0 pattern-shaped · 39 unresolved** —
the same 39 the t16 pass reported, and every one of them in the classes it named as NOT defects:
`prune-check.json`'s own manifest (18), boot logs/dumps printing pruned sandbox cwds (8 + 3),
`verification-summary.json`'s `bootLogMissing` marker (1), the removed `repair-r2` staging `--out`
(2), this task's own fix record quoting the repaired strings (3), plus **two citations in other lanes
newly surfaced by the sweep and reported rather than edited** (see §7).

## 4. I-4 (low, optional) — NOT actioned, reported

`AGENTS.md` §1's adopted-plugin bullet still carries only the pre-wave half of the dependency mechanism.
The t18 acceptance itself labels this "Optional, and outside my scope", and the same contract lists
`AGENTS.md` under out-of-scope ("other lanes"), so it was deliberately left untouched; the two files
that already carry both halves are `scripts/pack-mpd.mjs#writeManifest` and `docs/design.md`.

## 5. I-5 (info) — the counting trap, recorded

`packages/mpd-bundle/cordis.patch.yml`: **28 live `- id:` rows** (26 inserts + the 2 id-targets) and
**2 COMMENTED rows** at lines 252/263 (`# - id: mcp-wave-mcp`, `# - id: mcp-traceweave`). The naive
`grep -c -- "- id: "` returns **30**; `node scripts/verify-rows-parity.mjs` names exactly **26** insert
ids. No shipped sentence says 30 and none was "corrected" toward it. Raw: `t18-counted-claims.txt`.

## 6. Gates (all exit 0, 2026-09-20T04:37:41Z)

`node scripts/verify-rows-parity.mjs` · `bun run verify:rows` · `node scripts/verify-dist-fresh.mjs`
(`20/20 targets fresh`) · `node scripts/install-profile.mjs --self-test` · `bun run verify:docs`
(`pairs=38 failed=0 violations=0 … PASS`). Raw: `t18-gates.txt`.

## 7. Findings handed to the captain (outside this task's inScope)

1. **Tokens outside the wave's tree:** the whole-repo scan finds **131** secret-shaped values under
   `evidence/**` beyond `evidence/install-deps/**` (other waves' boot logs). The redactor is scoped to
   this wave by design; a global sweep is the captain's call.
2. **Two dangling citations surfaced by the sweep, in other lanes' evidence:**
   `verification/20260920T034521Z/r1-f3-recheck/ADDENDUM.md` cites
   `evidence/install-deps/captain-cross-check/20260920T035736Z-f3-repro/` (the directory on disk is
   `20260920T034916Z-f3-repro`; the same stale stamp appears in the dispatch text), and
   `verification-final/arms/A4-tui-plane.json` cites `logs/A4-tui-plane.boot.log`, which no lane
   produced (the TUI arm's durable artifacts are `A4-tui-plane.tui-pane.txt` /
   `A4-tui-plane.tui-raw.log`; the earlier lane has no `.boot.log` for A4 either).
3. **Stale pin:** `repair-r2/pack-verified-sha256.txt` still names the pre-F1 packed hash.
