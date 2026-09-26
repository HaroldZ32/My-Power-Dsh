# WAVE 2b — THE SINGLE RE-PIN (landed by the captain, 2026-09-17)

**One re-pin per wave (AGENTS.md §9/§11), and this is it.** The write happened in the working tree; the COMMIT happens at the
integration with the corpus change that invalidated the lock, in one commit, as the rule requires.

## The state pair, both moments recorded

| moment | command | reading |
|---|---|---|
| PRE-WRITE | `node scripts/repin-vendor.mjs --check` | **exit 1** — `RED - lock does not match the working tree (drift=1, problems=0)` |
| PRE-WRITE | `git status --porcelain -- VENDOR_LOCK.json` | **empty** (the lock was BYTE-UNCHANGED) |
| PRE-WRITE | `sha256sum VENDOR_LOCK.json` | `c9a827004c8d94624a5c5b8c613acf5c5d7928f594ae58b5d40af2aed7322d22` |
| WRITE | `node scripts/repin-vendor.mjs --write --i-know-this-is-the-captains-step` | **exit 0** (3434 bytes, 2 treeSha assets) |
| POST-WRITE | `node scripts/repin-vendor.mjs --check` | **exit 0** — `GREEN - lock matches the working tree (drift=0, problems=0)` |
| POST-WRITE | `node scripts/verify-vendor.mjs` | **exit 0 — PASS** (`asset OK: skills 324 files`) |
| POST-WRITE | `sha256sum VENDOR_LOCK.json` | `271258241bc6b997760ebd0819eeb05499ef025f8275a3b59148d85dbdff09ff` |

## The value written, and the value NEVER written

- **locked → computed (LF) = `b9097d115ae0742828744d9a305c145fe2efeaef11d6a4e641bf666687102620` / 323 → `5fbe9dbcd5c52c50a0148f9b2c14b07e6210f4b710e4d7060aeee94a8887b71a` / 324**, with **1 file LF-normalized**.
- **raw-bytes `26ec1af28bb29eee4b1b5b4b6282d0baf4f24c4776bc4a0c2f4b1a7db9dd41cc` — NEVER written.** The LF value is what the gate
  computes, so writing the raw bytes would have produced a lock that fails its own check.
- The AUTHORITY for the write was the **dry run taken immediately before it** (`repin-check-pre.out`), not any earlier preview.

## Every superseded preview, NAMED as superseded (the rule the last three waves applied)

`7aef5fd2…` / `8ea212eb…` → `2c748d48…` / `fb0d4ce3…` → `b9097d11…` → **`234010aeb8e359a0f61b701b616d091edc7ea54acd999413716cefc001fd8c70` / 324 (the t18 request — SUPERSEDED)** →
**`5fbe9dbcd5c52c50a0148f9b2c14b07e6210f4b710e4d7060aeee94a8887b71a` / 324 (CURRENT, written)**.

## The cause, as a UNION and not a sum

`skills/**` changed by **t38** = 8 files (the five F1 lanes + `session-start-team.mjs` + `wave2b-lane-d.mjs` + `SKILL.md`), all
already inside **t18**'s 14-file set → the wave's set stays **14 distinct = 13 modified + 1 untracked, all corpus, 0
non-corpus**. `|A ∪ B|`, never `|A| + |B|`: the repair's README names `mount-assert.mjs` under TWO sections, and a per-section
sum would double-count it (the reviewer tested exactly that).

## The sibling asset

`packages/mpd-agent-teams-plugin/_deps` was **already in sync** (`d1d106032b198d2392ca2fe36ea4b563c3010496192791a6e4812638b7cf8e37` /
635) before and after, so **exactly ONE asset moved** — which is why the delta is attributable to the corpus paths alone.
