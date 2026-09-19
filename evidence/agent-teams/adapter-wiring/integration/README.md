# Integration lane (team task `t10` / contract lane `t8`) — pack refresh + closure proof

Seat: Lead (worker) · wave: w1 · team: `agent-teams-adapter-wiring` · report moment
**2026-09-19T16:24Z**.
Frozen authority: `evidence/agent-teams/adapter-wiring/requirements-contract.md` §7 **AC14** and §4's
T-91 note. Gate-in: review round 3 returned **pass** on AC1–AC13/AC15/AC16
(`review/round3/verdict.md`), carrying **AC14** to this lane by the captain's ruling.

## 1. Settle check (before touching anything)

`integration/settle-sandwich.sh` hashed the 18 decisive files at **START 16:22:53Z**, waited 50 s, and
re-hashed them at **END 16:23:43Z**: **IDENTICAL** (`settle-sandwich.log`). The values match the
reviewer's independent round-3 table (read 16:18:53Z), so both seats sampled the same settled bytes.
Nothing in this lane's work can be attributed to a moving revision.

## 2. What this lane ran (exactly these, from the repo root)

| # | Command | Exit | Reading |
|---|---|---|---|
| 1 | `node scripts/pack-mpd.mjs` | 0 | `modes normalized: 1194 files (644: 1182, 755: 12)`; staged to `dist/mpd-package` (`pack.log`) |
| 2 | `node evidence/agent-teams/adapter-wiring/integration/pack-bytes-proof.mjs` | 0 | the byte identities of §3 (`pack-bytes-proof.log`) |
| 3 | `node scripts/verify-pack-closure.mjs` | 0 | freshness read from the `expected-after-pack` list, not the code (`pack-closure.log`) |
| 4 | `git status --porcelain` (READ-ONLY) | 0 | the changed-path census (`git-status-porcelain.txt`) |

No git **write** command was run: the captain is the only git writer.

## 3. The pack really carries the bridge (byte-identity proof)

`dist/mpd-package` vs the repo, sha256 on both sides:

- **bridge** `packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js` —
  `01fd9125510885fb334935c9b0a589e5c63614f3e976234fbd364e7ed89a27d3` in BOTH trees: **identical**.
  A pack that dropped this file would ship a plugin that cannot load.
- **six bridged adopted files** (`index.js`, `tools.js`, `members.js`, `command.js`,
  `capabilities.js`, `harness-compat.js`): 6 compared, **6 identical**.
- **all 55 files** of the adopted `lib/` tree: 55 identical (wider than the acceptance asks, so a
  dropped sibling is visible rather than merely unchecked).
- **adapter dist** `packages/mpd-dsh-adapter-plugin/dist/index.js` —
  `d8e8fa36cb214d0492bf5b82bfc0bf1988f694b09ad930572f5f7b62143bddf4` in BOTH trees: **identical**
  (the pack does not ship a stale adapter).
- all `packages/*/dist/**` entries: 25 compared, 24 identical, **1 absent —
  `packages/mpd-qa-roles-probe/dist/index.js`**, which `scripts/pack-mpd.mjs` excludes as QA-only and
  which the closure gate prints as a **declared exemption**. A root `AGENTS.md` is likewise
  deliberately not shipped, so its absence from the pack is design, not loss.

## 4. Freshness, read the way T-91 requires

`node scripts/verify-pack-closure.mjs` exit 0, and the signal is the list, not the code:

```
content bytes: 1185 file(s) compared, 1185 identical, 0 drift, 0 expected-after-pack
completeness: 409 declared source file(s) compared, 408 present, 1 declared exemption(s), 0 absent
17 dist/index.js row(s) + 1 adopted lib/index.js row(s) + 4 mcp row(s) … all resolve;
23/23 declared packages present in the artifact; agent references 3/3; root files 1/1;
CLI validator surface 9 exports in step; pack stamp 2026-09-19T16:23:55.148Z
```

**`0 expected-after-pack`** is the freshness proof: a non-empty list would mean files the pack was
supposed to absorb are missing or drifted at the re-pack. `0 drift` over 1185 compared content files
is the byte-identity half. The exit code alone would not have been the signal.

## 5. What is NOT claimed by this lane

1. The pack was **not installed into a fresh profile and booted**. AC10/AC11/AC12 were proven by a
   checkout boot (verification lane); closure proves packed BYTES, never packed-tree behaviour.
2. `bun run verify:gates` and the suite gates were run by the docs and review lanes on the same
   settled revision — this lane did **not** re-run them, and it ran with a dirty tree by construction
   (the wave's own files are untracked until the captain commits).
3. `bun test` (bare spelling) stays red on 411 untracked+gitignored scratch copies under
   `evidence/mpd-naming/wave2/raw/scratch/**`; the captain accepted `bun test packages`. Environment
   note, not a claim.
4. No release act: no version bump, commit, tag, push or merge.

## 6. Wave report and index

- `.mpd/plans/agent-teams-adapter-wiring-report.md` — the wave report: settled hashes with their UTC
  moments, the AC-by-AC status with per-lane attribution, R1–R5 as decisions plus the counted
  `childCtx` bypass, the AC14 proof, the explicit non-claims, the review history (two
  `needs_revision` rounds before the pass) and the exact changed paths.
- `INDEX.md` — the evidence index for the whole wave, so a reader can walk contract → lanes →
  verification → review → integration without a chat log.
