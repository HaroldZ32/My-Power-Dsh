# t7 — integration readiness / dispatch blocker (Architect, attempt 3)

**Measured** 2026-09-20T04:16:36Z–04:19Z UTC by Architect (read-only seat) on the shared checkout at
`/root/dshProj/my-power-dsh`. **No write was performed except this file.** No re-pin, no pack, no prune,
no `git add/commit/branch/merge`, no source edit.

---

## 1. Why t7 was NOT executed by this attempt

t7's own contract says **“CAPTAIN-OWNED integration”**, *“the captain is the only git writer in the shared
checkout”*. Three independent reasons make a member execution wrong, not merely inconvenient:

1. **AGENTS.md §5 (binding, repo manual):** *“a teammate NEVER runs `commit`/`add`/`checkout`/`switch`/
   `reset`/`stash`/`merge`/`branch`/`rebase`/`tag` … the captain alone commits and branches — or the captain
   serializes ONE delegated writer and freezes everyone else first.”* No such serialization was declared.
2. **The re-pin is guarded by its own human-role flag:** `node scripts/repin-vendor.mjs --write
   --i-know-this-is-the-captains-step` (AGENTS.md §4/§9/§11). A member invoking that flag is exactly what the
   guard exists to prevent; the wave's single re-pin must land in the same commit as the `skills/**` change.
3. **Seat discipline:** this member is Architect — read-only (requirements/review/analysis), never edits files.

**Recovery (captain action, one step):** `agent_teams_reassign_task` t7 → `assignee=captain` (or create the
integration task on the captain's own desk) and run §4 below; every measurement in §2/§3 was taken to make that
turn mechanical. All other members are idle, so the checkout is effectively frozen.

---

## 2. The frozen revision (independently re-hashed — matches t5 and t12)

| File | sha256 | sha256 at |
|---|---|---|
| `packages/mpd-bundle/cordis.patch.yml` | `e70a179e1ed13c5e4fa9926fb89fda9de4e17c1935aac1d517b37fa0b7b4b28e` | 2026-09-20T04:16:36Z |
| `scripts/install-profile.mjs` | `1820242d3a9af2a8ad5d4949bb6b61ae53229e3d4cb5b237b1ad0b6ea9ec1dd6` | 2026-09-20T04:16:36Z |
| `package.json` | `64e9797767e086db02428946fa9c4764786695f493fe9c14352b065a099a634f` | 2026-09-20T04:16:36Z |
| `scripts/pack-mpd.mjs` | `52b4245dc46e8f3f1de87b7f16ac0adda11370fb5606a420d9ea97b7836cdb07` | 2026-09-20T04:16:36Z |
| `skills/dsh-qa/scripts/install-dependencies.mjs` | `108134dc4698af32c93e3ec716fb3444bf5950ce00ff098491b40f1a216a5a66` | 2026-09-20T04:16:36Z |
| `skills/dsh-qa/SKILL.md` | `8afc6a716321eeabe095c26bfcd565fb1c688de2fd466bd4fa19a9d500fb63a5` | 2026-09-20T04:16:36Z |
| `skills/dsh-qa/cases.json` | `646e16d2518d8f95d6efe3ffff641838f3ccd678da8211ce2af43cd79da8b381` | 2026-09-20T04:16:36Z |
| `VENDOR_LOCK.json` (unmodified) | `fc6f8aa34771faba879a4c448ce837dac506ffb461bd8c0586adbe406e3672fb` | 2026-09-20T04:16:36Z |

The patch/installer pair equals t5's settled pair and t12's reviewed pair — the revision IS frozen, and the
settle discipline of AGENTS.md §7 is already satisfied at this instant (re-check after the captain's own settle
window before committing).

---

## 3. Measured pre-state (the four things that decide the captain's turn)

### 3.1 The review gate: t6 is terminal FAILED, superseded by t12 PASS
The contract's step 1 says *“confirm t5 (verification) and t6 (review) are terminal and green”*. **t5 is green**;
**t6 is terminal but `needs_revision`**, and the automatic loop repaired it (t11) and re-reviewed it (t12:
*“review round 2 → verdict PASS”*). The literal precondition is met only through that supersession — **record
the decision explicitly** rather than reading t6's status as green.

### 3.2 `verify-vendor` red with exactly the two expected failures (pre-re-pin)
```
[verify-vendor] commit OK: 8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29
[verify-vendor] version OK: 5.0.0-beta.20
[verify-vendor] stats OK: 9131 files / 1470231 loc
[verify-vendor] asset OK: packages/mpd-agent-teams-plugin/_deps 635 files
[verify-vendor] asset OK: packages/mpd-mcp-astgrep/dist/cli.js 1 files
[verify-vendor] asset OK: packages/mpd-mcp-gitbash/dist/cli.js 1 files
[verify-vendor] asset OK: packages/mpd-mcp-lsp/dist/cli.js 1 files
[verify-vendor] asset OK: packages/mpd-mcp-codegraph/dist/serve.js 1 files
[verify-vendor] FAIL - asset skills count drifted: 327 vs 326
[verify-vendor] FAIL - asset skills treeSha mismatch
EXIT=1
```
The +1 drift is `skills/dsh-qa/scripts/install-dependencies.mjs` (new, untracked) plus the SKILL.md/cases.json
edits — i.e. **exactly the wave's single legitimate re-pin**, and the post-re-pin expectation to write into
`VENDOR_LOCK.json` is **327 files**.

### 3.3 R7 is ALREADY closed by measurement (the premise in the contract is stale)
```
sha256 packages/mpd-bundle/cordis.patch.yml  e70a179e…b28e
sha256 dist/mpd-package/cordis.patch.yml     e70a179e…b28e
cmp  → BYTE-IDENTICAL (40203 bytes; guard scalar 3384 chars on the row line)
dist/mpd-package/package.json dependencies → {"dsh-better-sidebar":"0.19.0-alpha.1"}
```
The canonical packed artifact carries the SAME bytes as the reviewed source, so the *“stale copy still held the
pre-repair 2493-byte scalar”* premise no longer holds at 04:16Z. (`3384 − len('disabled: !!js ') − 2 quotes =
3367` — the contract's 3367-byte body figure, consistent.) Re-pack (`node scripts/pack-mpd.mjs`) is idempotent
if the captain wants the re-pack in the record; either way, read freshness from the `expected-after-pack` list,
never from the closure gate's exit code (AGENTS.md §4, T-91).

### 3.4 EVIDENCE HYGIENE — the declared prune patterns do NOT by themselves satisfy the acceptance
Measured tree: **590 files / 52 MB** (the plan's pre-flight said 528 / 14.0 MB — re-measure).
After removing the declared patterns (`**/node_modules/**`, `**/cache/**`, `**/sandboxes/**`, `dsh/**` homes):
**334 files / 4.22 MB**.

| Check | Result |
|---|---|
| `.credentials.yaml` + `settings.yaml` copies | 30, **all** inside the prune patterns; `.credentials.yaml` is additionally `.gitignore` line 18 |
| real API keys (`\bsk-[A-Za-z0-9]{20,}`) | **0** |
| `"apiKey": "…"` values | **0** |
| files **surviving** the prune that contain `token=` | **73** — 111 occurrences of 43-char DSH web-server access tokens; 32 of them are arm-result JSONs (`verification/20260920T034521Z/arms-final/*.json`), plus `real-web-final/boot.log`, `real-web-final/boot-client-probe.log`, `implementation/w1-five-compositions/run-20260920T0328Z/comp*/boot.log`, `implementation/README.md` and 9 `implementation/scratch/*` scripts |

(An initial loose scan reported 17 “key” files; the stricter regex shows all 17 were false positives from the
word *“task-…”* — recorded so nobody re-opens that thread.)

**Consequence:** acceptance item 3 (`no token or key`) is not met by pruning alone. The remedy that keeps the
other half of the item (every path a kept `result.json` cites still exists) is **in-place redaction** — replace
the token bytes with `<redacted-token>` in the kept files, keeping paths and citations intact — and delete
`implementation/scratch/` outright if nothing cites it.

---

## 4. Remaining captain sequence (write/git only; everything is measured)

1. Record the t6→t11→t12 supersession decision; re-hash the two frozen files after a settle window.
2. `node scripts/pack-mpd.mjs` (or delete `dist/mpd-package/`) → then `node scripts/verify-pack-closure.mjs`;
   read freshness from the `expected-after-pack` list, not the exit code.
3. Evidence: prune the four patterns → redact the 73 token-bearing kept files → re-check with `find` for
   `.credentials.yaml`/`settings.yaml` and a `token=` scan → assert every path cited by a kept `result.json`
   still exists.
4. `node scripts/repin-vendor.mjs --write --i-know-this-is-the-captains-step` → `node scripts/verify-vendor.mjs`
   (expect 327 files, exit 0).
5. Gate sweep with raw output under `evidence/install-deps/integration/`: `node scripts/verify-vendor.mjs`,
   `bun run verify:rows`, `node scripts/verify-dist-fresh.mjs`, `bun run verify:docs`,
   `node scripts/verify-pack-closure.mjs`, `node scripts/verify-rows-parity.mjs`,
   `node scripts/install-profile.mjs --dry-run`, `node scripts/run-qa-lanes.mjs --check-drift`, `bun run test:qa`.
6. Re-run `node skills/dsh-qa/scripts/install-dependencies.mjs` (or cite the repair lane's 5/5 rerun anchored to
   `e70a179e…`) and re-check the F3 cross-check sandbox against that same hash.
7. `fix/<slug>` from `dev` → ONE commit citing the defect → `merge --no-ff` into `dev`.
   Current git state: branch `dev`, HEAD `c4a278a58f14be30036d79f3182f8c76005f5eae`, 23 dirty entries.

---

## 5. BOUNDS the final report must carry (verbatim, so they cannot be dropped)

- **R6** — legacy installer row-id mirroring (pre-existing).
- **R8** — the round-1 fiber-count probe witness is unavailable by construction; substitutes are named in the
  review artifacts.
- A sidebar mounted from **CODE** rather than a patch stays invisible to a declaration scan (documented bound of
  the guard's own over-approximation).
- The **legacy installer** writes the row without installing the package (degrades; the boot stays green).



---

## CORRECTION (appended by t16, 2026-09-20T04:33Z)

**§3.3 above is SUPERSEDED.** It reported R7 as already closed, on the measurement that
`dist/mpd-package/cordis.patch.yml` was byte-identical to the source (`e70a179e…`). Repair F1 (t14) then changed the
source guard (3384 → 5922 characters; the source patch is now `1b316b68…`), so the packed copy is stale again and
**R7 is OPEN**: `dist/mpd-package/` must be re-packed or deleted in t7, and the packed-leg parity check re-run
(`evidence/install-deps/repair-r2/pack-verified-sha256.txt` is pinned to the old hash). Everything else in this file
still measures as written. See `REVIEW-integration-boundary.md` finding I-1.
