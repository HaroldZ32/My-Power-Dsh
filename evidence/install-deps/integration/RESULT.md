# t7 — wave integration record (captain-owned)

**Objective this turn:** land the install-dependency wave — single `VENDOR_LOCK.json` re-pin, full
gate sweep, evidence hygiene, one commit on a `fix/…` branch merged `--no-ff` into `dev`.

## 1. The frozen revision this land is anchored to

Read at **2026-09-20T04:48:07Z** (captain), matching t5's settled pair, t12's and t15's reviewed
pairs and t17's final verification:

| Path | sha256 |
|---|---|
| `packages/mpd-bundle/cordis.patch.yml` | `1b316b68850fbe3958b16088ac723abcd50faabd178668de7ed6044811107e8f` |
| `scripts/install-profile.mjs` | `2809ccfc23b37fd9f8eff73d0feb689397fc92c7c958aec93d39045049affc67` |
| `package.json` | `64e9797767e086db02428946fa9c4764786695f493fe9c14352b065a099a634f` |
| `scripts/pack-mpd.mjs` | `52b4245dc46e8f3f1de87b7f16ac0adda11370fb5606a420d9ea97b7836cdb07` |
| `skills/dsh-qa/scripts/install-dependencies.mjs` | `108134dc4698af32c93e3ec716fb3444bf5950ce00ff098491b40f1a216a5a66` |
| `VENDOR_LOCK.json` (before the re-pin) | `fc6f8aa34771faba879a4c448ce837dac506ffb461bd8c0586adbe406e3672fb` |

## 2. Evidence hygiene (the commit's own payload)

| Measure | Before | After |
|---|---|---|
| token VALUES in `evidence/install-deps/**` | 8 (5 files, produced after the lanes' own passes) | **0** |
| `.credentials.yaml` / `settings.yaml` / `.modules.yaml` copies | 0 | 0 |
| `sk-`-style keys | 0 | 0 |
| sandbox trees (`node_modules` / `cache` / `sandboxes`) | 0 (each lane pruned its own) | 0 |
| tree size / files | 7.3 MB / 478 | 7.3 MB / 478 |

Redaction is **in place** (`evidence/install-deps/integration/redact-tokens.mjs --write`): file,
line count and line structure are preserved, so every citation into a redacted file still resolves.
DISCLOSED DEVIATION, carried from t18: a literal `grep -rl 'token='` still matches non-secret sites
(other lanes' probe regexes, URL templates, and records quoting that command). Driving that literal
to zero would rewrite historical records and other lanes' harness code while removing no secret, so
it was measured, classified and reported instead. 131 secret-shaped values OUTSIDE this wave's
evidence tree are NOT ours to rewrite and were reported by the repair lane.

## 3. Derived surfaces

* **Re-pack LAST** (after every writer stopped): `node scripts/pack-mpd.mjs` exit 0 — the canonical
  `dist/mpd-package/cordis.patch.yml` is now byte-identical to the source (`1b316b68…`), and the
  packed manifest carries `dependencies: {"dsh-better-sidebar": "0.19.0-alpha.1"}`. This gitignored
  artifact went stale three times behind successive writers during the wave (R7, T1, I-1); the
  ordering rule is the fix.
* **Single vendor re-pin**: `node scripts/repin-vendor.mjs --write --i-know-this-is-the-captains-step`
  — the `skills` asset moves `fileCount 326 → 327` and `treeSha 82f38bd8… → 220ddd2cf5c15d6e…`, i.e.
  exactly one re-pin for the wave, landing in the same commit as the `skills/**` change that
  invalidated it (§9/§11). `node scripts/verify-vendor.mjs` → **PASS** afterwards.

## 4. Gate sweep (raw transcripts: `gates.log`, `test-qa.log`)

All exit 0: `verify-rows-parity` · `bun run verify:rows` · `verify-dist-fresh` (20/20) ·
`bun run verify:docs` · `verify-pack-closure` · `install-profile --dry-run` ·
`run-qa-lanes --check-drift` · `verify-manual-paths` · `verify-vendor`.

The wave's permanent QA case was re-run **on this exact revision** by the final verification lane
(`evidence/install-deps/qa-case/2026-09-20T04-43-31.096Z/`, `ok=true`, arms=5, skipped=0), so the
commit cites that run rather than duplicating it: it is anchored to `1b316b68…`.

## 5. The quality ledger this commit rests on

| Lens | Seat | Verdict |
|---|---|---|
| requirements (AC-1…AC-10, inventory) | Architect | pass |
| review round 1 | Reviewer | **needs_revision** — found the high duplicate-mount defect; the captain reproduced it as a dead boot |
| repair round 2 + review round 2 | Deep Worker / Reviewer | pass |
| review round 3 (row-aware predicate, both directions) | Reviewer | pass |
| verification (10-arm matrix + F3-class addendum) | Lead | reproduced, RED anchored |
| adversarial integration pass | Architect | needs_revision — **no source defect**; 3 derived-surface items, all closed |
| final verification on the frozen revision | Lead | **GREEN 15/15**, decoys re-measured, negative control red-able |
| integration (this record) | captain | the commit below |

Auto-generated follow-ups were NOT blindly executed: t18's hygiene repair was completed after a
scope HOP (its own acceptance text routed the re-pack to t7, and its inScope could not cover the
~107 evidence files the redaction rewrites), and t19 — a fourth review round over that same
derived-surface work — was cancelled with a stated reason, because those paths are
integration-write-restricted and t7's acceptance already carries t16's exact checklist.

## 6. Carried bounds (named, not buried)

R6 the legacy installer mirrors the row id and does not dedupe inserts (pre-existing); R8 the
round-1 fiber-count probe witness is unavailable by construction (substitutes named); a sidebar
mounted from CODE rather than a patch stays invisible to a declaration scan; the legacy installer
writes the row without installing the package (degrades, boot stays green); a foreign mount whose
NAME is not literally spelled (YAML anchor/alias, `!!js` name) would still slip past the row rule;
predicate 4's forward-blindness is unproven against a booting composition; the standalone
client-module URL needs the entry's own rev; and the PACKED artifact was built and read here but not
installed and booted.
