# X7 (t28 + t31) — fresh-clone SKIP lane: implementation report

**Task (this revision):** t31 — X7 (third blocker): the third fresh-clone blocker measured, converted, and the suite re-measured
**Attempt (t31):** `0c4b4c21-4b95-46b5-b4a4-9328217d50bb` — **status: complete** (supersedes the t28 attempt below, whose one blocked item is now closed; see §7)
**Task (previous revision):** t28 — X7 (re-created): both fresh-clone QA cases skip with a reason, plus the skills re-pin
**Attempt (t28):** `2530467a-2967-4d82-9268-a34d3785778f` — status: failed, single blocker finding `X7-BLOCKER-1` (outside inScope)
**Spec:** `evidence/rtl-extraction-residual/followup/x2-skip-contract.md` (v2, 564 lines / 41 380 B)
**Pin at start:** `HEAD = 32ae54dd10db7ea46e1c1263143d56f266fd1f78` (branch `dev`, working tree already carrying t8's staged repair; nothing committed by this task)
**Raw logs:** `raw/` (every command below wrote a file there)

> **Label mapping (read this first):** §11 / §12 of x2 v2 are THIS task's spec; the contract's
> internal `t23` labels (`## 11. t23 implementation spec`, `## 12. t23 acceptance criteria`) are the
> author's own numbering, not board ids. On the board, `t23` = X6 declaration (Lead), `t24`/`t28`/`t31` = X7
> (this task), `t25` = X4-repair (Senior Engineer). The captain confirmed this verbally and is
> recording the mapping in the wave closeout.

---

## 1. Result summary

| item | state |
|---|---|
| `relocate-smoke.mjs` gate (x2 §11.1) | **done** — both strict spellings, SKIP/FAIL marker first on stdout, positive probe |
| `team-route-rewire.mjs` gate (x2 §11.2) | **done** — same gate, 12 offline checks before it (AM3b) |
| `skill-catalog-probe.mjs` gate (t31, the third blocker) | **done** — same gate, its two `mpd-bootstrap` dist checks run before it (AM3b), incomplete-corpus pack still FAILS |
| `SKILL.md` §16 block verbatim + prerequisite clause on all three case rows (x2 §11.3) | **done** (block byte-identical to the contract's fence) |
| `package.json` §11.4 (`test:qa:strict` added, `test:qa:all` strict, `test:qa` flag-free) | **done** |
| single `skills/**` VENDOR_LOCK re-pin (x2 §11.5) | **done** — `assets.skills.treeSha` only, fileCount 328, `verify-vendor` exit 0 (recomputed once, after all three case edits, §7) |
| acceptance criteria A1–A12 (all three cases) | **passed** — see §4 and §7 |

**Corrected blocker count — THREE, and all three are now converted.** The contract's M4 claim
("exactly two self-test P1 blockers") was **falsified by direct measurement** in t28: a third
tracked, unmodified case (`skills/dsh-qa/scripts/skill-catalog-probe.mjs:21-23`) hard-failed on the
same missing staged pack, aborting `bun run test:qa` before `team-route-rewire` ran (exit 1, only
1 SKIP line). t31 converted it under an extended inScope, and the suite is now green in both
conditions:

| condition | `bun run test:qa` |
|---|---|
| fresh clone (pack moved aside) | **exit 0**, 24 cases, **exactly 3 SKIP lines** (`skill-catalog-probe`, `relocate-smoke`, `team-route-rewire`) |
| workspace (pack present) | **exit 0**, 24 cases, **0 SKIP lines** |

The falsified M4 sentence is preserved here deliberately: it is the reason the t28 attempt failed
and the reason the contract's "2 SKIP lines" target became "3". Historical note: the t28 attempt's
inScope excluded `skills/dsh-qa/scripts/*.mjs` (all other cases) and x2 §13 non-goal 1 said "do not
convert the other 21 cases", so the third conversion could only happen after a captain-issued scope
extension (t31).


---

## 2. What changed

| file | change |
|---|---|
| `skills/dsh-qa/scripts/relocate-smoke.mjs` | `// PREREQ:` header line; `SLUG`/`PACK`/`PACK_PREREQ`/`STRICT` consts; `absentPrereq()` (AM1 positive `existsSync` probe); `gate(lane)`; `selfTest()` calls `gate("self-test")` as its first statement (was the unconditional FAIL at old `:20`); `runReal()` calls `gate("real")` as its first statement; the existing credentials check is **kept unchanged** (not skippable, §3.3) |
| `skills/dsh-qa/scripts/team-route-rewire.mjs` | same header/consts/`absentPrereq`/`gate`; the 12 offline `checks` still run **before** the gate (AM3b); the old pack guard at `:53` is replaced by `gate("self-test")`; `gate("real")` inserted before the credentials check, which is kept unchanged |
| `skills/dsh-qa/SKILL.md` | §16 block inserted verbatim (35 lines / 2 515 B, byte-compared against the contract fence) after the case table; prerequisite clause added to the `relocate-smoke` and `team-route-rewire` case-table rows (English) |
| `package.json` | added `test:qa:strict` (§8.2, byte-exact); `test:qa:all` case invocation gained ` --no-skip` (§8.3); `test:qa` untouched/flag-free (§8.1) |
| `VENDOR_LOCK.json` | exactly one field: `assets.skills.treeSha` `2b55ab84…47585f` → `36afa7e2…183014`; `fileCount` stays `328` |

Implementation note (documented divergence): x2 §11.1's code sketch phrases the human prose as
`prerequisite absent: <prereq> (<code>)`, while §4's "worked byte example … the exact two lines" and
§8.4's caller-log shape phrase it `staged package absent at <prereq>`. Both cannot be reproduced
byte-for-byte; the implementation follows §4/§8.4 (the captain cited §8.4 as "the resulting log
shape"), and the **marker line — the machine-readable signal — is byte-identical to both** and to the
§4 parse regex. The two spellings do not differ in any field.

---

## 3. BLOCKER — the fresh-clone blocker set is 3, not 2 (measured)

Commands and raw files:

```
raw/a8-testqa-freshclone.out   bun run test:qa   (dist/mpd-package moved aside)
raw/a8-freshclone-fullsweep.txt  per-case sweep, pack absent, no abort
```

`bun run test:qa` in the pack-absent condition:

```
[test:qa] skills/dsh-qa/scripts/relocate-smoke.mjs
[mpd-qa] SKIP case=relocate-smoke lane=self-test reason=absent-staged-pack prereq=dist/mpd-package/package.json remedy="node scripts/pack-mpd.mjs"
[relocate-smoke] staged package absent at dist/mpd-package/package.json; skipping (not a failure)
[test:qa] skills/dsh-qa/scripts/session-start-team.mjs
[session-start-team self-test] ok: policy module + bundle patch + installer + persona verified
[test:qa] skills/dsh-qa/scripts/skill-catalog-probe.mjs
[skill-catalog-probe self-test] FAIL: run node scripts/pack-mpd.mjs first (staged skills missing)
[test:qa] FAILED: skills/dsh-qa/scripts/skill-catalog-probe.mjs
error: script "test:qa" exited with code 1
```

* exit **1**; canonical SKIP lines in the whole log: **1** (not 2 — the suite aborts at
  `skill-catalog-probe`, which sorts before `team-route-rewire`); `team-route-rewire` is never reached.
* `raw/a8-freshclone-fullsweep.txt`: 24 cases run individually, **exactly one non-zero exit** —
  `skill-catalog-probe.mjs` (`1`). `relocate-smoke` and `team-route-rewire` both exit `0` with their
  canonical SKIP marker as the first line. So the complete fresh-clone self-test blocker set is
  exactly **three**, and the two in scope are fixed.

Why this is not a bug in this task's bytes:

* `skills/dsh-qa/scripts/skill-catalog-probe.mjs` is **tracked and unmodified**
  (`git status --porcelain` empty for it; mtime 2026-09-09 17:20).
* Line 21–23: `const marker = join(staged, "skills", "svn-master", "SKILL.md"); if (!existsSync(marker)) { … FAIL … process.exit(1) }`
  where `staged = <repoRoot>/dist/mpd-package` — the same gitignored artifact (`.gitignore:12`
  `dist/mpd-package/`; `git ls-files dist` → empty).
* x2 v2 §2.1/§15 M4 asserted exactly two blockers; M1's "24 cases, exit 0" baseline was measured with
  the pack **present**, so it could not see this third blocker.

**Required remedy (outside this task's inScope — needs a scope decision):** apply the identical
§11-style gate to `skill-catalog-probe.mjs` (slug `skill-catalog-probe`, same single skippable
prerequisite `dist/mpd-package/package.json` / `absent-staged-pack` / `node scripts/pack-mpd.mjs`,
probe before the two `mpd-bootstrap-plugin/dist` checks, AM1–AM7, plus its `// PREREQ:` header line
and its SKILL.md row clause). With that third case converted, the sweep says the suite reaches all 24
cases and `test:qa` returns exit 0 with exactly **2** SKIP lines. **No other fresh-clone blocker
exists** (the sweep is exhaustive over `skills/dsh-qa/scripts/*.mjs`).

---

## 4. Acceptance matrix (x2 v2 §12 / task acceptance)

### A1 — pack-absent self-test SKIPs (exit 0, marker first, no `ok:`)
`bun skills/dsh-qa/scripts/relocate-smoke.mjs --self-test` (pack moved aside), `raw/a1-relocate-self-plain.*`:
```
exit=0
stdout line 1: [mpd-qa] SKIP case=relocate-smoke lane=self-test reason=absent-staged-pack prereq=dist/mpd-package/package.json remedy="node scripts/pack-mpd.mjs"
stdout line 2: [relocate-smoke] staged package absent at dist/mpd-package/package.json; skipping (not a failure)
grep -c '^\[mpd-qa\] SKIP ' = 1   ; no "ok:"/"PASS" anywhere
```
Same for `team-route-rewire` (`raw/a1-rewire-self-plain.*`), exit 0, 1 SKIP line, first line
`[mpd-qa] SKIP case=team-route-rewire lane=self-test reason=absent-staged-pack …`.

### A2 — pack-absent + either strict spelling → exit 1, identical fields, byte-identical runs
```
raw/a2-relocate-self-noskip.*   exit=1  line 1: [mpd-qa] FAIL case=relocate-smoke lane=self-test reason=absent-staged-pack prereq=dist/mpd-package/package.json remedy="node scripts/pack-mpd.mjs"
raw/a2-relocate-self-reqpack.*  exit=1  line 1: (same line, byte-identical)
diff (stdout+stderr) --no-skip vs --require-pack : EMPTY
raw/a2-rewire-self-noskip.*     exit=1  line 1: [mpd-qa] FAIL case=team-route-rewire lane=self-test reason=absent-staged-pack …
raw/a2-rewire-self-reqpack.*    exit=1  line 1: (same line)
diff (stdout+stderr) --no-skip vs --require-pack : EMPTY
```
Field equality SKIP↔FAIL: `reason=absent-staged-pack`, `prereq=dist/mpd-package/package.json`,
`remedy="node scripts/pack-mpd.mjs"` — identical in all four runs; only the verdict word changes.

### A3 — pack-present, all three modes byte-identical
```
raw/a3-relocate-plain.out / -noskip.out / -reqpack.out : exit 0,0,0 ; diff plain↔no-skip EMPTY ; diff plain↔req-pack EMPTY
  stdout: [relocate-smoke self-test] ok: staged patch is path-clean
raw/a3-rewire-plain.out / -noskip.out / -reqpack.out   : exit 0,0,0 ; both diffs EMPTY
  stdout: [team-route-rewire self-test] ok: 12 checks + staged bundle present
```

### A4 — real lane, pack absent: exit 0 + `lane=real` SKIP, **no evidence directory**; strict → exit 1
```
raw/a4-relocate-real-plain.*  exit=0  line 1: [mpd-qa] SKIP case=relocate-smoke lane=real reason=absent-staged-pack …
raw/a4-relocate-real-noskip.* exit=1  line 1: [mpd-qa] FAIL case=relocate-smoke lane=real …
raw/a4-rewire-real-plain.*    exit=0  line 1: [mpd-qa] SKIP case=team-route-rewire lane=real …
raw/a4-rewire-real-noskip.*   exit=1  line 1: [mpd-qa] FAIL case=team-route-rewire lane=real …
evidence/plan-d/relocate entries: 24 before → 24 after
evidence/plan-e/e4-team-vendor entries: 7 before → 7 after   (no skip-path evidence directory, §3.2)
```

### A5 — the non-skippable prerequisite stays loud (pack present, sandbox HOME, `DEEPSEEK_API_KEY` unset)
```
raw/a5-credentials-loud.txt
mode=none          exit=1 output=[relocate-smoke] missing credentials  [mpd-qa] markers: 0
mode=--no-skip     exit=1 output=[relocate-smoke] missing credentials  [mpd-qa] markers: 0
mode=--require-pack exit=1 output=[relocate-smoke] missing credentials [mpd-qa] markers: 0
```
No marker, no evidence directory, in all three modes.

### A6 — present-but-broken pack FAILS in every mode (AM3)
`raw/a6-broken-pack.txt` — real pack copied, one dev-path line appended to its `cordis.patch.yml`:
```
mode=--self-test                    exit=1 skip_marker=0  [relocate-smoke self-test] FAIL: dev path leak in staged patch
mode=--self-test --no-skip          exit=1 skip_marker=0  (same)
mode=--self-test --require-pack     exit=1 skip_marker=0  (same)
```

### A7 — AM3b: `team-route-rewire`'s checks run before the gate
`raw/a7-seeded-check.txt` — fake-root farm (`x2 §15 M2` method, no `dist/` in the farm):
```
unseeded control lane        : exit=0  1 SKIP line, first line = canonical SKIP (pack absent ⇒ skip)
seeded broken check          : exit=1  0 SKIP lines, stderr = [team-route-rewire self-test] FAIL: ulw-execute row: roster + agent-teams team, no bespoke team
same break + --no-skip       : exit=1  0 SKIP lines, same check FAIL (the gate is never reached)
```
(`ulw-execute/SKILL.md` seeded by stripping `mpd_role_spawn` + `agent_teams_create`, i.e. a defect in
one of the 12 offline checks must fail — never skip.) Diff proof: in both case files the `checks`
block / path-clean check precedes `gate(...)`.

### A8 — fresh-clone suite statement — **FAILED (blocked)**
See §3. Measured: `test:qa` exit **1**, SKIP lines **1**, aborted at
`skill-catalog-probe.mjs`. Best achievable result for the two in-scope cases is proven by the
exhaustive sweep (both exit 0 with their SKIP marker).

### A9 — no regression with prerequisites present
```
raw/a9-pack-present.txt + raw/a9-testqa-packpresent.out
bun run test:qa         exit=0  cases run=24  SKIP count=0  -> "[test:qa] all self-tests passed"
bun run test:qa:strict  exit=0  SKIP count=0  -> "[test:qa:strict] all self-tests passed with no skips"
```
`test:qa:all` — the §8.3 flag edit is verified statically (`bun "skills/dsh-qa/scripts/$c.mjs" --no-skip`),
not executed: its real lanes are credential-heavy and, per §8.5, 13 of them were already failing
loudly on absent credentials before this task; running the full real-lane suite is out of this task's
verification budget and its result is not part of the task's acceptance criteria.

### A10 — documentation landed
```
raw/a10-skillmd.txt
grep -n '\[mpd-qa\]' skills/dsh-qa/SKILL.md  -> lines 80-83 (exit matrix rows), 89-90 (grammar)
§16 block byte-identical to the contract fence: true (raw/section16-block.md, 35 lines / 2 515 B)
case rows 59 + 60 carry the prerequisite clause ("prerequisite: the staged pack (`dist/mpd-package/package.json`, reason `absent-staged-pack`)")
```

### A11 — standing gates
```
raw/a11-gates.txt
bun run typecheck                    exit=0
bun test packages                    exit=0  (298 pass / 0 fail, 96 files, 13.27s)
node scripts/verify-vendor.mjs       exit=0  (raw/a12-verify-vendor.out, PASS)
node scripts/verify-rtl-references.mjs exit=0 ("PASS — 13 invariant subject(s) clean, 35 resolved, 8 pending-by-design, 0 unresolved")
node scripts/verify-rows-parity.mjs  exit=0  ("ok: 21 row ids match the bundle patch insert list")
bun run test:qa                      exit=0  (0 SKIP lines, 24 cases)
```

### A12 — vendor discipline
```
raw/a12-repin.txt
git diff -- VENDOR_LOCK.json : assets.skills.treeSha 2b55ab84…47585f -> 36afa7e2…183014 ; assets.skills.fileCount stays 328
node scripts/verify-vendor.mjs : exit 0
[verify-vendor] asset OK: skills 328 files
[verify-vendor] PASS
```
The `git diff` also shows a `packages/mpd-mcp-gitbash/dist/cli.js` `sha256` hunk
(`cb9ce8f3…` → `0484a8ff…`). **That hunk is not this task's**: it belongs to the X4-repair / X5 lane
(t25/t27), was already in the working tree before this task's first command (baseline `verify-vendor`
was PASS at 11:0x with the working-tree value `0484a8ff…` while the index still held `cb9ce8f3…`), and
this task's only VENDOR_LOCK edit is the single `assets.skills.treeSha` line. No dist file was touched
and no foreign fingerprint was re-pinned.

---

## 5. Fresh-clone simulation — honest before/after state

`raw/a8-freshclone-state.txt` (move-aside method, captain's instruction):

| step | observed |
|---|---|
| before | `dist/mpd-package` present; `package.json` sha256 `f8c94451d01e31568d2fd26fdddf32b99a2b79ac429602c031d38c34413b5235`; 1 119 files; `evidence/plan-d/relocate` = 24 entries |
| move | `mv dist/mpd-package dist/mpd-package.QA-X7-BACKUP`; `existsSync(dist/mpd-package/package.json)` = `false` |
| during | A1/A2/A4/A8 runs above; no evidence directory created by any skip |
| restore | `mv` back; `package.json` sha256 **identical**; 1 119 files |
| whole-tree digest | computed before the A5/A6 block and after the A6 restore: `2bfcefb539ca0648d5bcc44ec0147e3ecf85ebabe99309a6655f23951099a394` both times (`raw/pack-tree-digest.txt`) |

The move-aside condition is exact for `dist/mpd-package`; the fake-root farm of §A7 additionally
proves the `repoRoot`-independent behaviour (it symlinks tracked trees and keeps no `dist/`), and
§15's caveat that the farm is not a byte-for-byte clone is carried here unchanged.

---

## 6. Boundaries

Touched (all inScope, all uncommitted — the captain stages/commits):

```
skills/dsh-qa/scripts/relocate-smoke.mjs
skills/dsh-qa/scripts/team-route-rewire.mjs
skills/dsh-qa/scripts/skill-catalog-probe.mjs   (t31 scope extension)
skills/dsh-qa/SKILL.md
package.json
VENDOR_LOCK.json                      (one field: assets.skills.treeSha)
evidence/rtl-extraction-residual/x7/  (report.md, result-t31.json, raw/ — the t28 result.json is archived at raw/result-t28-attempt1.json)
```

Not touched: any other `skills/dsh-qa/scripts/*.mjs` (beyond the three converted cases),
`scripts/**`, `packages/**`, `dist/**` (only moved aside and restored byte-identically),
`bun.lock`, `README.md`, `AGENTS.md`, `docs/`, any other member's evidence directory.
**t31 update:** `skills/dsh-qa/scripts/skill-catalog-probe.mjs` was converted under the
captain-extended inScope (t31); the t28 statement above was written while that conversion was
outside scope and is superseded on exactly that one file — everything else it says still holds.

---

## 7. t31 — third blocker converted, suite re-measured (corrected count = 3)

**Task:** t31 (attempt `0c4b4c21-4b95-46b5-b4a4-9328217d50bb`), inScope extended to
`skills/dsh-qa/scripts/skill-catalog-probe.mjs`. Two-case work from t28 was **not** redone; only the
third conversion + the honest re-measurement + one re-pin (recomputed after all skills edits) followed.

### 7.1 What changed in the third case

* Header: `// PREREQ: absent-staged-pack dist/mpd-package/package.json node scripts/pack-mpd.mjs`.
* Same `SLUG`/`PACK`/`PACK_PREREQ`/`STRICT` + `absentPrereq()` + `gate(lane)` block as the two
  converted cases (`STRICT = argv.includes("--no-skip") || argv.includes("--require-pack")`).
* `selfTest()` re-ordered for AM3b: the **two prerequisite-independent `mpd-bootstrap` dist checks
  run first** (they read tracked files), then `gate("self-test")`, then the case's own
  present-but-broken assertion — the staged `skills/svn-master/SKILL.md` marker must exist, and its
  absence is a **FAIL** (exit 1), never a skip (AM3, "an incomplete pack is not an absent pack").
* `runReal()`: `gate("real")` as its first statement; the existing credentials check is kept
  unchanged (not skippable).
* `SKILL.md` row 58 now carries the same prerequisite clause as rows 59/60 (all three rows, English).

### 7.2 Fresh-clone suite re-measured (A2/A8 of the corrected matrix)

```
raw/t31-testqa-freshclone.out   bun run test:qa   (dist/mpd-package moved aside)
  test:qa exit=0 ; cases run=24 ; SKIP count=3 ; last line: [test:qa] all self-tests passed
  [mpd-qa] SKIP case=relocate-smoke        lane=self-test reason=absent-staged-pack prereq=dist/mpd-package/package.json remedy="node scripts/pack-mpd.mjs"
  [mpd-qa] SKIP case=skill-catalog-probe   lane=self-test reason=absent-staged-pack prereq=dist/mpd-package/package.json remedy="node scripts/pack-mpd.mjs"
  [mpd-qa] SKIP case=team-route-rewire     lane=self-test reason=absent-staged-pack prereq=dist/mpd-package/package.json remedy="node scripts/pack-mpd.mjs"

raw/t31-freshclone-sweep.txt    per-case sweep, pack absent, no abort
  24 rows run ; 0 non-zero exits ; 3 SKIP markers — the corrected blocker set is fully converted
  and NO other fresh-clone blocker exists.

raw/t31-testqa-packpresent.out  bun run test:qa        (pack present)  exit=0 ; 24 cases ; SKIP=0
raw/t31-testqa-strict.out       bun run test:qa:strict (pack present)  exit=0 ; SKIP=0
```

### 7.3 Exit matrix + anti-mask controls for all three cases

`raw/t31-exit-matrix.txt` (pack absent, per case):

```
case=skill-catalog-probe mode=none           exit=0 line1=[mpd-qa] SKIP … reason=absent-staged-pack prereq=dist/mpd-package/package.json remedy="node scripts/pack-mpd.mjs"
case=skill-catalog-probe mode=--no-skip      exit=1 line1=[mpd-qa] FAIL … (identical fields)
case=skill-catalog-probe mode=--require-pack exit=1 line1=[mpd-qa] FAIL … (identical fields)
case=relocate-smoke      mode=none/--no-skip/--require-pack      exit=0/1/1  same fields
case=team-route-rewire   mode=none/--no-skip/--require-pack      exit=0/1/1  same fields
```
Fields identical across SKIP and both FAIL spellings in all three cases (`reason=absent-staged-pack`,
`prereq=dist/mpd-package/package.json`, `remedy="node scripts/pack-mpd.mjs"`); only the verdict word
changes.

Real lane, pack absent (`raw/t31-probe-real-skip.out`, `raw/t31-probe-real-noskip.out`):
`skill-catalog-probe` → exit 0 + `lane=real` SKIP (no evidence dir: `evidence/plan-d/skill-catalog`
entries 2 → 2); with `--no-skip` → exit 1 + `lane=real` FAIL.

Seeded controls (`raw/t31-seeded-controls.txt`) — present-but-broken FAILS in every mode, and each
case's prerequisite-independent checks precede its gate:

| case | seeded condition | result |
|---|---|---|
| `relocate-smoke` | dev-path leak appended to the staged patch | exit 1 in all 3 modes, 0 SKIP markers, `FAIL: dev path leak in staged patch` |
| `skill-catalog-probe` | `package.json` present but the staged corpus incomplete (marker missing) | exit 1 in all 3 modes, 0 SKIP markers, `FAIL: staged skill corpus incomplete …` |
| `skill-catalog-probe` | farm: `mpd-bootstrap` dist check broken + pack absent | unseeded farm → exit 0 SKIP; seeded → exit 1 `FAIL: mpd-bootstrap dist does not register the corpus provider`, 0 SKIP markers (also with `--no-skip`) |
| `team-route-rewire` | farm: one offline check's input broken + pack absent | unseeded farm → exit 0 SKIP; seeded → exit 1 `FAIL: ulw-execute row …`, 0 SKIP markers |

Credentials (A5, `raw/t31-a5-credentials.txt`): `relocate-smoke` with pack present, sandbox HOME,
`DEEPSEEK_API_KEY` unset → exit 1, `[relocate-smoke] missing credentials`, **0** `[mpd-qa]` markers,
in all three modes.

### 7.4 Pack-aside / restore, byte-identical proof

`raw/t31-freshclone-state.txt`: before `dist/mpd-package` = `package.json` sha256
`f8c94451d01e31568d2fd26fdddf32b99a2b79ac429602c031d38c34413b5235`, 1 119 files; after the move-aside
window and all seeded lanes the same sha256 and file count; whole-tree digest
`2bfcefb539ca0648d5bcc44ec0147e3ecf85ebabe99309a6655f23951099a394` identical before and after
(`raw/t31-seeded-controls.txt` tail).

### 7.5 Single re-pin (recomputed after ALL skills edits) + gates

`raw/t31-repin.txt` / `raw/t31-gates.txt` / `raw/t31-contract-verify.txt`:

```
git diff -- VENDOR_LOCK.json : assets.skills.treeSha 2b55ab84…47585f -> bb52bff4…d3456b32 ; fileCount stays 328
node scripts/verify-vendor.mjs : exit 0  ([verify-vendor] asset OK: skills 328 files ; PASS)
bun run typecheck              : exit 0
bun test packages              : exit 0  (298 pass / 0 fail, 96 files)
node scripts/verify-rtl-references.mjs : exit 0 (PASS, 0 unresolved)
node scripts/verify-rows-parity.mjs    : exit 0 (21 row ids)
bun run test:qa (pack present) : exit 0, 0 SKIP lines
bun run test:qa:strict          : exit 0, 0 SKIP lines
bun skills/dsh-qa/scripts/{skill-catalog-probe,relocate-smoke,team-route-rewire}.mjs --self-test : exit 0 each
§16 block byte-identical to the contract fence: true
```

The one re-pin covers **all three** case files plus `SKILL.md` (the treeSha was computed once, after
every `skills/**` edit landed); no second re-pin exists. The `packages/mpd-mcp-gitbash/dist/cli.js`
`sha256` hunk that also appears in `git diff -- VENDOR_LOCK.json` is **not** this task's — it belongs
to the X4-repair/X5 lane and predates this work (baseline `verify-vendor` was already PASS on it);
no dist file was written and no foreign fingerprint was touched.

Boundary (`raw/t31-boundary-status.txt`): working-tree changes are limited to
`skills/dsh-qa/scripts/{skill-catalog-probe,relocate-smoke,team-route-rewire}.mjs`,
`skills/dsh-qa/SKILL.md`, `package.json`, `VENDOR_LOCK.json` (+ untracked
`evidence/rtl-extraction-residual/x7/`). Nothing committed; the captain stages all five fix branches.

