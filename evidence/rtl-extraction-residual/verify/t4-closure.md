# t4 closure — independent re-measurement of the five gate-coherence commands

Task: t12 (verification r1) — corrective follow-up for the FAILED t4.
Date: 2026-09-13. Role: Researcher (read-only).
Measured HEAD: **`32ae54dd10db7ea46e1c1263143d56f266fd1f78`** (`32ae54d chore(lsp-setup): retire the orphan
HDL pages and take the single VENDOR_LOCK re-pin (t17)`) — **identical** to the HEAD t4 measured
(`evidence/rtl-extraction-residual/gates/result.json` → `measuredHead`).

Raw logs for every row below: `evidence/rtl-extraction-residual/verify/raw/` (mine) and
`evidence/rtl-extraction-residual/gates/raw/` (t4's, untouched).

## 1. Five-command table

| Gate | t4 said | I measured | Exit code | Agree? |
|---|---|---|---|---|
| `node scripts/verify-vendor.mjs` | PASS, exit 0 | `[verify-vendor] PASS` | 0 | **AGREE** (my log byte-identical to t4's — see §1.1) |
| `node scripts/verify-rtl-references.mjs` | PASS, exit 0, `considered 48`, `unresolved []` | `[rtl-refs] PASS — 42 resolved, 6 pending-by-design, 0 unresolved` | 0 | **AGREE** |
| `node scripts/verify-rows-parity.mjs` | PASS, exit 0, 21 row ids | `[verify-rows-parity] ok: 21 row ids match the bundle patch insert list` | 0 | **AGREE** |
| `cd <repo> && bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` | FAIL, exit 1 — probe demands `bundled.length >= 20`, corpus has 19 | `[bundle-lifecycle] ok=false`; probe `SKILLS=19 BUNDLED=19` then `[roles-probe] FAIL` | **1** | **AGREE — still RED, same cause** |
| `cd <repo> && bun test packages` | FAIL, exit 1 — 295 pass / 3 fail (agent-teams self-fix) | **295 pass / 3 fail**, `Ran 298 tests across 64 files` | **1** | **AGREE — still RED, same cause** |

**Every number t4 reported is re-confirmed. No number changed.** The two red gates are red for the
same two reasons and at the same counts.

### 1.1 The green gates (re-confirmed with my own runs)

```text
$ node scripts/verify-vendor.mjs                    → exit 0  [verify-vendor] PASS
$ node scripts/verify-rtl-references.mjs            → exit 0  [rtl-refs] PASS — 42 resolved, 6 pending-by-design, 0 unresolved
$ node scripts/verify-rows-parity.mjs               → exit 0  ok: 21 row ids match the bundle patch insert list
```

`raw/verify-vendor.log` (`sha256 de6768ea…f193`) and `raw/verify-rows-parity.log`
(`sha256 a029d226…de0b`) are **byte-identical** to t4's copies of the same two files
(same two hashes — full comparison in `raw/byte-compare.txt`), i.e. the same trees produce the same
bytes. `raw/verify-rtl-references.log` (`fc53ef99…347e`) is the human-readable run that matches t4's
recorded JSON (`gates/raw/verify-rtl-references.json`, `sha256 bc2e0d9e…4ce8`: `considered 48`,
`unresolved []`, and the identical summary line `42 resolved / 6 pending-by-design / 0 unresolved` as
its last line). So 48 considered = the 42 + 6 split — **not** a changed count: t4 measured with `--json`
and I ran the default human mode, which de-duplicates the tokens into the same three buckets.

### 1.2 `bundle-lifecycle` — RED, re-confirmed with my own run

```text
$ cd /root/dshProj/my-power-dsh && bun skills/dsh-qa/scripts/bundle-lifecycle.mjs
exit=1
[bundle-lifecycle] ok=false -> …/evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-43-55.289Z
  install:      {"ok":true,"exit":0,"dependency":"link:/root/dshProj/my-power-dsh", …}
  composed:     {"ok":true,"exit":0}
  boot:         {"ok":false,"http":true, …}
  noHomeCopy:   {"ok":true,"skills":[],"presets":[]}
  layerDurability: {"ok":true,"exit":0,"…"}
  uninstall:    {"ok":true,"bundles":[base,web-app],"residue":[],"mpdState":[]}
```

Failing assertion, quoted from the boot log (`…/2026-09-13T07-43-55.289Z/boot.log`):

```text
[roles-probe] SKILLS=19 BUNDLED=19
[roles-probe] SKILL_FIXTURE=ok name=svn-master base=/root/dshProj/my-power-dsh/skills/svn-master bytes=5210
[roles-probe] FAIL
```

The gate's own success predicate is `/roles-probe] PASS/` (`skills/dsh-qa/scripts/bundle-lifecycle.mjs`
line 144), and the probe sets `catalogOk` at
`packages/mpd-qa-roles-probe/src/index.ts:58`:
`catalogOk = fixture !== undefined && bytes > 100 && bundled.length >= 20`.
Measured: `bundled.length = 19` → predicate false → `FAIL` → `ok=false` → exit 1. **Cause identical to
t4's F1.** Note only the threshold is wrong, not the corpus: `SKILL_FIXTURE=ok … bytes=5210` shows the
provider itself serves a real 19-skill corpus.

### 1.3 `bun test packages` — RED, re-confirmed with my own run

```text
$ cd /root/dshProj/my-power-dsh && bun test packages
exit=1
  295 pass
  3 fail
  Ran 298 tests across 64 files. [13.20s]
```

The three failures, quoted verbatim from `raw/bun-test-packages.log`:

```text
(fail) F3: healing a RE-MATERIALIZED upstream file refuses instead of emitting a broken module
(fail) t9: a re-materialized tools.js is REFUSED, byte-untouched, with key counts unchanged
(fail) t9: the targeted re-materialize shape (upstream twins restored at the literal) is REFUSED too
```

All three live in `packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs`
(the same three names t4 reported). t4's own log records the identical triple and the identical
`295 pass / 3 fail` (its per-test durations differ by milliseconds — expected for a timing field).
**Cause identical to t4's F2**: the tests derive their "pristine upstream" fixture from
`git show HEAD:` for files that have carried the mpd-delta bodies since `d510a16`, so the premise is
false at HEAD.

## 2. Drift check — are the red gates still in their pre-repair state?

**Yes for both; nothing has been touched by me or anyone else** (`raw/drift-and-artifacts.log`):

```text
$ git log --oneline 32ae54d..HEAD -- packages/mpd-qa-roles-probe skills/dsh-qa/scripts/bundle-lifecycle.mjs \
      packages/mpd-agent-teams-plugin/self-fix-tests
(empty — no commits since 32ae54d)

$ git status --short -- packages/mpd-qa-roles-probe skills/dsh-qa/scripts/bundle-lifecycle.mjs \
      packages/mpd-agent-teams-plugin/self-fix-tests
(empty — unmodified in the working tree)
```

Hashes of the implicated bytes at HEAD:

| Artifact | sha256 |
|---|---|
| `packages/mpd-qa-roles-probe/src/index.ts` (carries the `>= 20` threshold at line 58) | `95b4644cb5e4e937eed760b86bed6613bee50f7608149e523a01d262119f9dca` |
| `packages/mpd-qa-roles-probe/dist/index.js` (hashed, loaded by the boot) | `37d0693a8b7f76e778d74229d22d1dbd80ce7722254814ceadd2a45ba2fcb639` |
| `skills/dsh-qa/scripts/bundle-lifecycle.mjs` | `ef60fed0d7f835f5474612fa7a965b132076e87c822813f2ba2a50b0447f5bf0` |
| `packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs` | `c0531e6b5092e892390c2f4600c5055ae07df24997ba6e23ffd353f364ba20f3` |
| `…/self-fix-tests/scope-glob-and-contract.test.mjs` | `31256e5d9393d83ffe8e15a9848196e6f3e7c125072704ebe0a1019295fbef6f` |
| `…/self-fix-tests/quality-loop.test.mjs` | `22a4e8b164aaf535b9d7777aadf8a5f889c638f720b0532aaa4a61b225eb2ad9` |
| `…/self-fix-tests/scope-semantics.test.mjs` | `16e32769ab5b193ebdd5dbc23916c0ae77cbb9b08ca5215a1bae3f6f13b83712` |

`dist/index.js` still contains the string `bundled.length >= 20` (grep count 1), so the built probe
and its source are in agreement — the red is a stale *threshold*, not a stale build.

**Context that explains the count deltas without excusing them:** `packages/mpd-verif-plugin` no
longer exists (`ls -d` → No such file or directory; 0 test files), which is why the suite is 298 tests
today versus the 376/3 at the pre-extraction baseline (the removed plugin suite accounts for the
difference). The three failures are present on **both** sides of the strip, so they are
extraction-independent (t4's baseline log records the same three test names).

### 2.1 Local artifacts t4 listed as present (confirm / correct)

| Artifact | t4 said | I measured |
|---|---|---|
| `<repo>/.venv-rtl` | present, 44MB cocotb venv | **CONFIRMED present, 44M** |
| `<repo>/.toolchain/bin/verible-verilog-ls` | present, 6MB | **CONFIRMED present, 6.1M** |
| `<repo>/.toolchain/node_modules/.bin/codegraph` (seen in the boot log, not in t4's list) | — | **PRESENT, 0 bytes** (a dangling symlink target of 0 size); the boot log reports `[mpd-codegraph] init status=fail` accordingly |

All three are untracked/local and produce no tracked-file impact: `git status --short` shows only
untracked evidence directories (§4).

## 3. Evidence attestation — the bytes downstream may rely on

t4's three deliverable files, present and **unedited** (they are the only writer's output; I never
opened them for writing):

| File | Size | sha256 | mtime |
|---|---|---|---|
| `evidence/rtl-extraction-residual/gates/gates.md` | 12616 | `08ab86b2e52fd82320135dcccc05a856b2aa7226b89ac4768249481d31a0860f` | 2026-09-13 15:41:06 +0800 |
| `evidence/rtl-extraction-residual/gates/findings.md` | 8805 | `719adfa20a8e610239682a78903b462e6e46fbb755d4b21ffdf909ab5e94f2de` | 2026-09-13 15:41:09 +0800 |
| `evidence/rtl-extraction-residual/gates/result.json` | 8780 | `ab6d3dc530ab2d39a5e818ab02b9757dd14b8ab8ee14d5b73b6ec22a00663943` | 2026-09-13 15:41:35 +0800 |

t4's raw logs under `evidence/rtl-extraction-residual/gates/raw/` are a superset of my re-run:
`verify-vendor.log` (`de6768ea…f193`) and `verify-rows-parity.log` (`a029d226…de0b`) are
**byte-identical** to mine; `verify-rtl-references.json` (`bc2e0d9e…4ce8`) carries the same
`considered 48 / unresolved []`; `bundle-lifecycle.log` (`f27ccfd2…95c3`) independently shows the same
`boot.ok=false` boot object (it differs from my `bundle-lifecycle-capture.log` only in the run's own
timestamp/paths); `bun-test-packages.log` (`7c9940e2…fe2c`) differs from mine (`6a97fc7e…f782`) only
in per-test duration fields and the run banner — the failing test names and the `295 pass / 3 fail`
counts are identical.
`gates.md`/`findings.md`/`result.json` carry no edits after 15:41:35 +0800, i.e. before this task
started (15:42+).

**One-line attestation:** the three t4 evidence files and its raw logs are present, size- and
sha256-stable, and untouched since t4 wrote them — **downstream MAY rely on them** as the record of
t4's measurements, with the correction noted in §5 (F2's scope/remedy wording only; the numbers hold).

## 4. `git status --short` (pasted verbatim)

```text
$ cd /root/dshProj/my-power-dsh && git status --short
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-37-13.539Z/
?? evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-43-55.289Z/
?? evidence/dsh-qa/preset-conformance/2026-09-13T07-36-29.035Z/
?? evidence/rtl-extraction-residual/
```

**No repo source file is modified.** Every entry is an untracked evidence directory:
`…/bundle-lifecycle/2026-09-13T07-37-13.539Z` and `…/preset-conformance/2026-09-13T07-36-29.035Z`
are t4's byproducts; `…/bundle-lifecycle/2026-09-13T07-43-55.289Z` is this task's byproduct of
re-running the gate (the script writes its own evidence dir by design);
`evidence/rtl-extraction-residual/` is the audit's shared evidence root.
Nothing under `skills/**`, `packages/**`, `scripts/**`, `docs/**`, `package.json` is touched
(the drift check in §2 proves it path-by-path). The sibling silicon repo was not touched at all.

## 5. Corrective verdict

**The audit pipeline may proceed on t4's findings; t4's failure is a verdict-ordering matter, not a
measurement error.** All five commands reproduce t4's results at the same HEAD, with three gates
green (`verify-vendor`, `verify-rtl-references`, `verify-rows-parity`, all exit 0) and two genuinely
red (`bundle-lifecycle` exit 1 because the roles probe still demands `bundled.length >= 20` while the
post-extraction corpus is 19 — `packages/mpd-qa-roles-probe/src/index.ts:58`; `bun test packages`
exit 1 with 295 pass / 3 fail in the agent-teams self-fix tests, which derive their pristine fixture
from `git show HEAD:` and so are false at HEAD by construction). Both red causes are
**extraction-adjacent but not extraction-injected**: the probe threshold is stale relative to the
strip, and the self-fix trio fails identically at the pre-extraction commit `3d99718` (t4's baseline
log). I therefore confirm t4's F1 and F2 as real, differentially diagnosed, and correctly
attributed — the only correction I would make to the t4 record is scoping: F2's remedy is a
test-fixture change, not an RTL-extraction repair, so it belongs to the same repair task as F1 only
because both are standing-gate hygiene. Nothing I measured contradicts a single number in
`result.json`.

The two red gates are explicitly **out of scope here** (the repair task owns them) and remain red:
this closure dispositions the *failure record*, it does not fix the gates. Accordingly t5 may treat
`evidence/rtl-extraction-residual/gates/{gates.md,findings.md,result.json}` as trustworthy input,
with the two red gates carried forward as known-open defects rather than as a blocker on the audit's
conclusions.
