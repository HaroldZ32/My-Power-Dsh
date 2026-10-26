# T12 report — stop the manual from shipping stale version claims

Task T12 (team `team-20261025152913561-aucj-002`), owner `senior-engineer`, run 2026-10-26.
Repair driven by the USER finding after the v0.15.5 publish: "下次版本和手册一起改，NPM那边的手册上面甚至
还写着0.15.1…". No git write was performed. Changed files: **3** (`AGENTS.md`, `README.md`,
`README.zh-CN.md`); +36/−38 lines.

## 1. The four edits

### 1.1 `AGENTS.md` §8 — the rottable registry measurement is GONE
Removed the construction `— LIVE on the registry at **0.15.5** (measured 2026-10-26T02:36Z)` entirely
(a registry measurement inside a shipped manual is stale the moment the pack is cut) and replaced it
with a statement that is true by construction at tag time:

```
  `dsh plugin --profile web add @mpd-dsh/mpd@0.15.5` (this release, named by explicit spec) or the
  unversioned `@mpd-dsh/mpd`, which takes whatever `latest` the registry serves;
  `dsh plugin --profile web add github:HaroldZ32/My-Power-Dsh` is the same one
  command from the repository (and the Docker lane's proof spec, §4). …
```

The `github:` line and the rest of the bullet are unchanged. **No new date, no new registry claim.**
`grep -c 'LIVE on the registry' AGENTS.md` → **0**.

### 1.2 `AGENTS.md` §11 — the version+docs pairing rule (2 lines, as a sub-bullet of step 1)
```
   - **Version + docs move TOGETHER:** every version literal and every published-version statement
     (README table row + Notes, §8's install line) lands in THIS commit — no post-publish docs PR.
```

### 1.3 `AGENTS.md` §11 step 2 — the duplicated gate enumeration compressed (byte budget)
The long command list (which repeated §4's gate table) became a pointer plus only what §4 does NOT
carry. Every obligation stays reachable:
* §4's table is named as the authority ("run every row it marks for this change");
* the two §4-extra commands: `node scripts/verify-no-host-override.ts` (NOT a `verify:gates` member) and
  `node scripts/verify-manual-paths.ts` (whenever `AGENTS.md` changed);
* the smoke cases `dual-track-smoke` + `mcp-call`, and `bun run verify:gates` as the nine-member aggregate;
* the two easy-to-miss preconditions: `verify:vendor` only AFTER the wave's single `repin-vendor`
  re-pin when `skills/**` changed, and a REPO-ROOT `bun test` (unlike `bun test packages`) also scanning
  `evidence/**` fixtures;
* the Docker lane: "per §4's Docker row — BOTH runs, both stamps cited", keeping the unique knowledge
  §4 does not carry (the credential-free `--no-browser` regression run and why a credentialed run cannot
  see an empty-model-catalog path; `--no-browser` because a browser-enabled credential-free run records
  `ui.replyRendered` as a DECLARED BOUND the required-arm gate turns into exit 3 by design; `--live`
  with no key exits 3 before the build);
* the VENDOR_LOCK pairing checklist line is untouched.

Steps 1–5 keep their numbering; no obligation was dropped.

### 1.4 `README.md` + `README.zh-CN.md` — the version table is now unambiguous
ONE caption line directly above the table in each language, and a filled Notes column. **No version
number changed, no row added or removed** (diff proves it).

EN: `**The newest row is the version this package publishes; the rows below it are the pins of earlier releases, kept as history.**`
* 0.15.5 → `the current release — installable from the registry`
* 0.15.4 / 0.15.2 / 0.15.1 / 0.15.0 → `previous`
* 0.14.0 → `previous — the harness-0.2.1 adaptation release`

zh: `**最新一行是本包当前发布的版本（可从 registry 安装）；其下各行是更早版本钉定的组合，标注为 \`previous\`，作为历史保留。**`
* 0.15.5 → `本次发布 —— 可从 registry 安装`
* 0.15.4 / 0.15.2 / 0.15.1 / 0.15.0 → `` `previous` ``
* 0.14.0 → `` `previous` —— harness 0.2.1 适配发布 ``

## 2. Byte budget — MEASURED

| measure | bytes |
|---|---|
| `AGENTS.md` BEFORE (git HEAD at task start) | **64165** |
| `AGENTS.md` AFTER | **63478** |
| delta | **−687** |
| reserved cut (`agent-instructions.config.maxBytes`) | 65536 |
| margin to the cut | **2058** (manual §3 wants ≥ 2048) |
| mandatory target ≤ 64165 | MET |
| ideal target ≤ 63600 | **MET** |

Honest trace of the number: first pass 63505 → two micro-trims (§11 wording) 63475 → one cosmetic
re-wrap of a single over-long line 63478 (+3 bytes = newline + 3-space indent; **no text changed**).
The four additions cost ~+240 bytes; the §11 compression repaid ~−930.

## 3. Gates — OBSERVED

| # | Command | Exit | Observed |
|---|---|---|---|
| 42 | `.toolchain/node_modules/.bin/bun run verify:docs` (final run) | **0** | `pairs=50 failed=0 violations=0 … dead=0 — PASS` — the bilingual pair, switch links and heading trees still pass |
| 41 | `node scripts/verify-manual-paths.ts` (final run) | **0** | `PASS resolved=152 over-report=73 under-report=79 declared=2` — every audited path the manual spells still exists |
| 40 | `wc -c AGENTS.md` before/after | — | `64165 → 63478` (see §2) |

Both required gates were re-run AFTER the last write (the cosmetic re-wrap), so the logs match the
bytes on disk.

## 4. The "did another doc repeat a measured registry claim?" check

```
grep -rn 'LIVE on the registry|on the registry at|registry at \*\*' --include='*.md' .
  (excluding node_modules, evidence, dist, .mpd, .git)
→ ./AGENTS.md:507  (the line this task removed)
```
**No other markdown file in the tree carried the claim** — `docs/**` is clean, so nothing outside the
declared scope needed touching. A second grep for the residue of that measurement
(`measured 2026-10-26`) returns nothing outside `evidence/**`/`.mpd/**`.

## 5. Guards respected (explicitly NOT touched)

`package.json` / `dsh-plugin.json` / `dsh-distribution.json` versions and pins · `CHANGELOG.md` history ·
`docs/**` (no stale registry claim existed there, §4) · `evidence/**` history · `dist/**` ·
`dist/mpd-package/**` · `VENDOR_LOCK.json` · every `packages/**` source. The only files with a diff are
the three named in §1.

## 6. Deliberate non-edit and bounds

* **`AGENTS.md` §3's "Measured re-baselines" line was NOT extended** with this wave's sizes: that would
  be a fifth edit, it grows the file, and this task's numbers are recorded here and in `40-bytes.log`.
  If the captain wants the manual's own measurement log to carry it, it is a one-line append
  (`2026-10-26 **63478**`).
* No host was booted and no Docker lane ran: this is a documentation-only truth fix; the two gates in
  §3 are the ones the task names, and neither needs a mount.
* Not run (not named by the task, and unaffected): `verify:manifest`, `verify:comments`, `typecheck`,
  `test:qa`, `bun test`, `verify:vendor`. `verify:docs`'s own link/pair scan is the one that covers this
  change.

## 7. Evidence index (this directory)

`40-bytes.log` · `41-verify-manual-paths.log` · `42-verify-docs.log` · `43-diff.txt` ·
`44-tables-final.txt` · `REPORT.md`.
