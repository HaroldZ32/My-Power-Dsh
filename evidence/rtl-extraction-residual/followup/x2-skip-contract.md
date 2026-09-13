# X2 — fresh-clone SKIP contract for the QA suite (normative)

**Task**: t18 `X2 requirements` (round 1) · **Author**: Planner (read-only) · **Date**: 2026-09-13
**Deliverable**: this file — `evidence/rtl-extraction-residual/followup/x2-skip-contract.md`
**Status**: DECIDED. Every choice below is made; the implementation task **t23 (Junior Engineer)** —
called *X7* in the first draft — executes it without further decisions (§11–§12). This task writes
nothing outside `evidence/rtl-extraction-residual/followup/` — no `skills/`, `scripts/`,
`packages/` or `docs/` edit.

**Revision v2 — in-place amendment after captain guidance (same day; the raw measurement logs under
`raw/` are untouched).** Four interface decisions were tightened, and the old wording they replace is
named here so nothing changes silently:

1. **Strict flag.** The canonical generic flag stays **`--no-skip`**, and **t23's reserved spelling
   `--require-pack` is accepted as an exact synonym by `relocate-smoke`** — t23 must implement
   *both*, with identical semantics (§6). *Said loudly:* the two names are a deliberate,
   documented allowance, not an accident; the reserved name quoted by t23 works.
2. **Marker position.** The canonical marker is the **FIRST stdout line** of a case's output on the
   skip/fail path (previously: last), so each `[test:qa] <script>` block reads verdict-first (§4).
3. **This case's skippable prerequisite is exactly `dist/mpd-package/package.json`**, in both lanes.
   An absent credential keeps `relocate-smoke`'s existing **loud** failure (exit 1, no skip); the
   credential lanes stay the separate follow-up F-4 (§3, §9.1).
4. **Unconditional checks are enumerated explicitly** (§9.1): nothing that does not depend on the
   pack may be skipped, and no other case's assertions are affected by this contract.

## 0. The decision this contract encodes

The user decided (captain's contract text, verbatim):

> `node skills/dsh-qa/scripts/relocate-smoke.mjs --self-test` must exit 0 with an explicit SKIP
> reason when `dist/mpd-package/package.json` is absent (`dist/mpd-package` is gitignored by
> `.gitignore:12`), while an EXPLICIT request (a named flag) must still fail loudly with exit 1.

So: **an absent prerequisite is a SKIP (exit 0, reason printed, remedy named)**; **a caller who
explicitly demands the prerequisite gets a FAIL (exit 1)**; and **a prerequisite that is present but
broken is ALWAYS a FAIL** — a skip may never mask a broken build. §3–§7 make that precise; §8 states
what `bun run test:qa` does in a fresh clone; §11–§12 make t23 mechanical.

---

## 1. Vocabulary (binding definitions)

| Term | Definition |
|---|---|
| **lane** | one of the two execution lanes of a case: `self-test` (`--self-test`, offline per SKILL.md hard rule 4) and `real` (the default run that boots `dsh` and writes evidence). |
| **prerequisite** | an artifact a case needs but does not own and must not silently build inside a lane (a staged pack, a toolchain binary, a credential file, a model route, the `dsh` binary, the harness closure, a runtime). |
| **absent** | a **positive existence probe** of the exact prerequisite (`existsSync(<exact path>)`, or a process/binary probe such as `which dsh`) returns false. Evaluated by the case itself, before any operation that needs it. |
| **broken** | the prerequisite exists, but a check on it fails: unreadable, malformed, wrong shape, path-leaking, or a producer/installer/boot command that fails. |
| **skip** | the case declines to run the prerequisite-dependent portion and says why. Not a pass, not a failure. Exit 0, one canonical marker line, **no evidence directory**. |
| **strict request** | the flag **`--no-skip`** appears in the case's argv. |
| **PASS** | the case's assertions ran and all held: exit 0 and **no SKIP marker line**. |
| **FAIL** | exit 1 (assertion failure, broken prerequisite, or an absent prerequisite under `--no-skip`). |

A skip is only ever allowed for **absence**. Brokenness always fails (§7 AM3).

---

## 2. Prerequisite classes and who hits them (measured)

Probe commands and raw outputs: `raw/x2-testqa-baseline.log`, `raw/x2-fakeroot-probe.log`,
`raw/x2-strict-flag-sweep.log`; line numbers are at the measured revision (§15).

| # | reason code | prerequisite (sentinel) | gitignored? | cases that probe it today |
|---|---|---|---|---|
| P1 | `absent-staged-pack` | `dist/mpd-package/package.json` | yes (`.gitignore:12`) | `relocate-smoke` self-test:20 + real:35 · `team-route-rewire` self-test:53 + real:69 · `codegraph-smoke` real:46 · `mcp-call` real:68 |
| P2 | `absent-toolchain-binary` | `.toolchain/node_modules/.bin/<name>` | yes (`.gitignore:6`) | `codegraph-smoke` real:26 |
| P3 | `absent-credentials` | `~/.dsh/.credentials.yaml` (and no env model route) | no (home) | 13 real lanes (e.g. `relocate-smoke:28`, `team-route-rewire:59`, `mcp-call:26`, `memory-smoke:29`, `plan-c-smoke:37`, `preset-register:83`, `session-start-team:95`, `skill-catalog-probe:34`, `tool-output-validation:75`, `bundle-lifecycle:66`, `agent-teams-adopt:77`, `agent-teams-dispatch:233`, `ultrawork-smoke`/`workmate-*` guards) |
| P4 | `absent-dsh-binary` | `dsh` on `PATH` | n/a | `agent-teams-dispatch` **self-test**:93 (`fail("dsh not on PATH; …")`) |
| P5 | `absent-harness-closure` | `node_modules/@deepseek-ai/dsh-subagent` beside the `dsh` install or in the repo | yes (`node_modules/`) | `agent-teams-dispatch` self-test, `readonly-deny` self-test:142 |
| P6 | `absent-model-route` | credentials OR an env key (`DEEPSEEK_API_KEY` / configured chain) | n/a | the live lanes that accept an env route (`agent-teams-dispatch:233`) |
| P7 | `absent-runtime` | `node`/`bun`/`python3` as required by the case | n/a | none today (all cases require node/bun implicitly) |
| P8 | `absent-fixture` | a repo fixture the case ships | no (tracked) | none today |
| P9 | `unsupported-platform` | OS/arch the case cannot run on | n/a | none today |

### 2.1 The fresh-clone derivation (what makes `test:qa` red today)

`bun run test:qa` runs every `skills/dsh-qa/scripts/*.mjs` with `--self-test` and exits 1 on the
first non-zero case. A fresh clone has no `dist/mpd-package/` (gitignored), no `.toolchain/`
(gitignored), no `node_modules/` (gitignored) and no credentials, so:

* **self-test blockers (measured, §15 M2):** `relocate-smoke` → exit 1
  `[relocate-smoke self-test] FAIL: run node scripts/pack-mpd.mjs first`; `team-route-rewire` →
  exit 1 `[team-route-rewire self-test] FAIL: run node scripts/pack-mpd.mjs first`. Both are P1.
* **all other self-tests** pass on a machine that has `dsh`/`node`/`bun` (baseline run §15 M1);
  the `packages/*/dist` files they read are **tracked** (verified: `git ls-files
  packages/mpd-qa-roles-probe/dist/index.js` → tracked), and `packages/mpd-agent-teams-plugin/_deps`
  is tracked (635 files) — so those are not fresh-clone blockers.
* **caveat, stated honestly:** on a machine without `dsh` on `PATH`, `agent-teams-dispatch`
  (P4/P5) also fails its self-test, and `readonly-deny`'s harness-closure check may fail (P5).
  Those are classified follow-ups, §14 F-2/F-3 — **not** part of t23's mandatory set.
* therefore, after t23 converts P1 in both cases, `bun run test:qa` in a fresh clone on a
  `dsh`-bearing machine is **green with exactly two SKIP lines** (§8.1).

---

## 3. Exit-code matrix (normative)

| lane | prerequisite | `--no-skip` / `--require-pack` | exit | stdout | evidence dir |
|---|---|---|---|---|---|
| `self-test` | present | either | 0 | the case's existing `[<slug> self-test] ok: …` | none (unchanged) |
| `self-test` | absent | no flag | **0** | one canonical **SKIP** line, **FIRST line on stdout** | none |
| `self-test` | absent | either flag | **1** | one canonical **FAIL** line, **FIRST line on stdout**, same field values as the SKIP | none |
| `self-test` | present but broken | either | **1** | the case's own FAIL (may add the canonical FAIL line) | none |
| `real` | present | either | per assertions: 0 PASS / 1 FAIL | PASS/FAIL, canonical markers only on the prerequisite path | `evidence/<domain>/<slug>/<ts>/` (unchanged) |
| `real` | absent pack | no flag | **0** | one canonical **SKIP** line, **FIRST line on stdout** | **none written** (see §3.2) |
| `real` | absent pack | either flag | **1** | one canonical **FAIL** line, FIRST line on stdout | none written |
| `real` | absent **credentials** (NOT a skippable prerequisite of this case, §3.3) | any | **1** | the case's existing `[relocate-smoke] missing credentials` | none |
| `real` | present but broken | either | **1** | the case's own FAIL | as the case defines |

### 3.1 The caller's decision procedure (no prose reading)

1. `exit 0` **and** line 1 matches `^\[mpd-qa\] SKIP ` ⇒ **SKIP** (never count it as a pass).
2. `exit 0` **and** no line matching `^\[mpd-qa\] (SKIP|FAIL) ` anywhere in the output ⇒ **PASS**.
3. `exit 1` ⇒ **FAIL** (with or without a `[mpd-qa] FAIL` marker).

The marker is the first stdout line, so `head -1` is sufficient for a single case; a suite log
containing many cases is still counted correctly with `grep -c '^\[mpd-qa\] SKIP '` (one line per
case, §4).

### 3.3 Skippable vs non-skippable prerequisites of THIS case (normative scope)

The user's decision and the captain's guidance scope this contract to the **pack**:
`relocate-smoke`'s skippable prerequisite is **exactly `dist/mpd-package/package.json`**, in both
lanes, reported as `reason=absent-staged-pack`. The real lane's credential check is **not** part of
the skip set: it keeps today's behaviour — `[relocate-smoke] missing credentials`, exit **1**, no
marker — because a missing credential is an environment/deployment fault with a documented remedy
(AGENTS.md §7), not an absent build artifact. Converting the credential lanes is follow-up **F-4**,
a separate decision. `--no-skip` / `--require-pack` therefore only governs the pack.

### 3.2 Ruling: a skip writes no evidence directory

A skip executed nothing, so there is nothing to attest: no `result.json`, no `output.log`, no
`evidence/<domain>/<slug>/<ts>/` directory — in **both** lanes. Reasons: (a) SKILL.md hard rule 3
("each case writes result.json + raw output") governs *runs*, and a skip is not a run; (b) a bulk
`test:qa:all` on a machine missing a prerequisite would otherwise create one no-op evidence
directory per case, which is exactly the noise this contract exists to prevent; (c) the skip stays
auditable through the canonical marker line, which the suite log captures. t23 must NOT create an
evidence directory on the skip path.

---

## 4. Canonical marker grammar (the machine-readable signal)

Exactly **one** marker line per invocation, printed to **stdout**, as the **FIRST stdout line** of
the case's own output (human-readable prose may follow it; nothing of the case's own may precede it).
The marker is emitted on **stdout in both modes** — `SKIP` and `FAIL` — so a captured stdout always
carries the verdict. Two forms:

```
[mpd-qa] SKIP case=<slug> lane=<self-test|real> reason=<code> prereq=<path|probe> remedy="<value>"
[mpd-qa] FAIL case=<slug> lane=<self-test|real> reason=<code> prereq=<path|probe> remedy="<value>"
```

Field rules:

| field | value |
|---|---|
| `case` | the case slug — the same string as the `SKILL.md` case-table row and the file basename (`relocate-smoke`). |
| `lane` | `self-test` or `real` (literal). |
| `reason` | one code from the closed list in §5. |
| `prereq` | **no spaces**: a repo-relative POSIX path (`dist/mpd-package/package.json`), a home-relative path (`~/.dsh/.credentials.yaml`), or a probe token (`binary:dsh`, `binary:bun`, `env:DEEPSEEK_API_KEY`). |
| `remedy` | a double-quoted string containing **no double quote**: either one shell command runnable from the repo root, the doc-pointer form `doc:<path>#<section>`, or `-` when no single command exists. |

Parse regex (byte-exact, POSIX `grep -E` and JS compatible):

```
^\[mpd-qa\] (SKIP|FAIL) case=([a-z0-9-]+) lane=(self-test|real) reason=([a-z0-9-]+) prereq=([^ ]+) remedy="([^"]*)"$
```

Worked byte example (the exact two lines t23 must emit for the pack-absent self-test — marker first,
human prose second):

```
[mpd-qa] SKIP case=relocate-smoke lane=self-test reason=absent-staged-pack prereq=dist/mpd-package/package.json remedy="node scripts/pack-mpd.mjs"
[relocate-smoke] staged package absent at dist/mpd-package/package.json; skipping (not a failure)
```

The `--no-skip` / `--require-pack` variant of the same run (marker first on **stdout**, prose on
**stderr**) — the same five field values, only the verdict word changes:

```
[mpd-qa] FAIL case=relocate-smoke lane=self-test reason=absent-staged-pack prereq=dist/mpd-package/package.json remedy="node scripts/pack-mpd.mjs"
```

Counting skips in a suite run (documented in SKILL.md, §16):

```bash
bun run test:qa 2>&1 | grep -c '^\[mpd-qa\] SKIP '
```

The marker uses ONE reserved prefix `[mpd-qa] ` — a case must not print that prefix for any other
purpose.

---

## 5. Reason codes and remedies (closed tables)

| reason code | prerequisite | canonical `prereq=` value | canonical `remedy=` |
|---|---|---|---|
| `absent-staged-pack` | staged relocatable package | `dist/mpd-package/package.json` | `node scripts/pack-mpd.mjs` |
| `absent-toolchain-binary` | toolchain binary (e.g. codegraph) | `.toolchain/node_modules/.bin/codegraph` | `npm install --prefix .toolchain` |
| `absent-credentials` | local DSH credentials | `~/.dsh/.credentials.yaml` | `doc:AGENTS.md#7` |
| `absent-model-route` | any usable model route | `env:DEEPSEEK_API_KEY` | `doc:AGENTS.md#7` |
| `absent-dsh-binary` | the `dsh` binary | `binary:dsh` | `doc:AGENTS.md#8` |
| `absent-harness-closure` | installed harness packages | `node_modules/@deepseek-ai/dsh-subagent` | `doc:AGENTS.md#12` |
| `absent-runtime` | required interpreter | `binary:<name>` | `doc:AGENTS.md#12` |
| `absent-fixture` | a case-owned fixture | `<repo-relative path>` | the case's documented build command |
| `unsupported-platform` | OS/arch | `platform:<os>-<arch>` | `-` |

New codes require a one-line addition to this table **and** to SKILL.md — never an ad-hoc string.
This is the **vocabulary** available to any case; it does not widen *this* case's skip set, which
§3.3 fixes to the pack alone. `absent-credentials` in particular is listed for future cases that
declare it (follow-up F-4), not for `relocate-smoke`.

---

## 6. `--no-skip` / `--require-pack` (the explicit request)

1. **Semantics.** When **either** flag is in argv, an absent *skippable* prerequisite (§3.3)
   produces the canonical `[mpd-qa] FAIL …` line with the **same** `reason`/`prereq`/`remedy` values
   that the SKIP line would have carried, and the process exits **1**. The two modes must never
   disagree about *why*.
2. **Lane-independent.** The flags apply to `--self-test` and to the real lane. They never change
   which prerequisite is checked (§10.3), and they never make a non-skippable prerequisite (§3.3)
   skippable.
3. **No-op when the prerequisite is present.** With the pack present, the case's stdout and exit
   code must be **byte-identical** with and without either flag — and the two flags must be
   byte-identical to each other. t23 proves all three with an A/B/C diff (§12 A3).
4. **Unknown-flag tolerance (measured).** Neither flag may break a case that does not implement the
   contract: the full corpus was swept with `--self-test --no-skip` and **all 24 cases exited 0**
   (`raw/x2-strict-flag-sweep.log`) — so the strict suites in §8 may pass the flag corpus-wide
   without a compatibility list. New cases must keep that tolerance (ignore unknown argv entries).
5. **Naming — both spellings are normative for `relocate-smoke`.** The flag is **exactly**
   `--no-skip` (the reusable, corpus-wide name) **and exactly** `--require-pack` (the reserved,
   case-specific name quoted in t23's contract). `relocate-smoke` accepts **both**, with identical
   semantics; passing both together is equivalent to passing one. *Said loudly:* this is a
   deliberate, documented two-name allowance, not a fork — the reserved name t23 already quotes is
   valid, and t23 must not have to choose. No **other** alias exists; a future case may declare one
   `--require-<prerequisite>` spelling plus the generic `--no-skip`, and the two must stay
   semantically identical.

---

## 7. Anti-mask rules (AM1–AM7) — the heart of the contract

| id | rule |
|---|---|
| **AM1** | The skip decision comes from a **positive probe** of the exact prerequisite (a specific `existsSync` path, or a binary/process probe) — **never** from catching an exception thrown by a failed operation. A case may not `try { use(prereq) } catch { skip() }`. |
| **AM2** | Under **either** strict flag (`--no-skip` or `--require-pack`) the same absence is a loud FAIL (exit 1) carrying the same `reason`/`prereq`/`remedy` (§6.1). Skip and fail messages cannot drift. |
| **AM3** | A prerequisite that is **present but broken is always a FAIL** (exit 1), in every mode, with or without `--no-skip`: a staged pack whose patch leaks a dev path, a malformed pack, an unreadable credential, a stale/incomplete pack, a failing `npm install` / boot. **Skip is reserved for absence.** |
| **AM3b** | **Prerequisite-independent assertions run first and are never skipped.** If any assertion that does not need the absent prerequisite fails, the case FAILS (exit 1) and prints no SKIP line. The skip covers only the prerequisite-dependent portion. |
| **AM4** | A **producer failure is never a skip**: if the case attempts the remedy command (it normally must not, §13) and it fails, the case exits 1. |
| **AM5** | A skip must never look like a pass: the skip path prints **no** `ok`/`PASS` line, writes no evidence, and must not set any `ok: true`-shaped value anywhere. |
| **AM6** | Exactly **one** marker line per invocation, and it is the **FIRST stdout line** of the case's own output — a caller may use `head -1` for one case, and grepping a whole suite log still counts each case once. |
| **AM7** | The skip path must be **reachable only through the declared probe**: the prerequisite declaration (§10.1) and the probe must be in sync; a probe that can never be false (e.g. testing a path the case never uses) is a defect. |

**The guard against SKIP masking a broken build**, in one sentence (AM1+AM2+AM3+AM3b): *skipping is
allowed only for an artifact that has been probed and is genuinely absent; anything present is
checked, anything broken fails, anything requested explicitly fails.*

---

## 8. Aggregate runners and what they do

### 8.1 `bun run test:qa` (self-tests) — unchanged, flag-free

The script keeps its current form (glob over `skills/dsh-qa/scripts/*.mjs`, `bun "$f" --self-test`,
exit 1 on the first non-zero case) — **no flag is passed**, so it is the lane that must be green in
a fresh clone. After t23:

| environment | expected `bun run test:qa` |
|---|---|
| fresh clone, `dsh`/`node`/`bun` present, no `dist/mpd-package` | **exit 0**; exactly 2 canonical SKIP lines (`relocate-smoke`, `team-route-rewire`, both `reason=absent-staged-pack`, `remedy="node scripts/pack-mpd.mjs"`); every other case prints its self-test `ok:` line; no case prints both a SKIP line and an `ok`/`PASS` line |
| this workspace (pack built) | **exit 0**; **zero** SKIP lines — the same 24 passes as today (regression proof, §12 A9) |

The fresh-clone run must be recorded by t23 with the counting one-liner of §4 (§12 A8).

### 8.2 `bun run test:qa:strict` (NEW — self-tests, strict)

```
for f in skills/dsh-qa/scripts/*.mjs; do echo "[test:qa:strict] $f"; bun "$f" --self-test --no-skip || { echo "[test:qa:strict] FAILED: $f"; exit 1; }; done; echo "[test:qa:strict] all self-tests passed with no skips"
```
Semantics: prerequisites must be present; **any skip becomes a loud failure**. This is the cheap
guard that a skip is not hiding a missing/broken build on a machine that is supposed to have one.
Usable corpus-wide because of §6.4.

### 8.3 `bun run test:qa:all` (real lanes) — becomes strict

t8's `test:qa:all` runs each case's **real lane** (`bun skills/dsh-qa/scripts/<c>.mjs`). A skipped
real lane is exactly the vacuity this contract guards against, so t23 appends **`--no-skip`** to
every invocation in that script: a real-lane run on a machine without the pack/credentials fails
loudly with the canonical FAIL line naming the prerequisite and remedy (instead of silently
"passing" as a set of skips).

### 8.4 What a caller sees in a fresh clone (example log shape)

```
[test:qa] skills/dsh-qa/scripts/relocate-smoke.mjs
[mpd-qa] SKIP case=relocate-smoke lane=self-test reason=absent-staged-pack prereq=dist/mpd-package/package.json remedy="node scripts/pack-mpd.mjs"
[relocate-smoke] staged package absent at dist/mpd-package/package.json; skipping (not a failure)
[test:qa] skills/dsh-qa/scripts/team-route-rewire.mjs
[mpd-qa] SKIP case=team-route-rewire lane=self-test reason=absent-staged-pack prereq=dist/mpd-package/package.json remedy="node scripts/pack-mpd.mjs"
[team-route-rewire] staged package absent at dist/mpd-package/package.json; skipping (not a failure)
…
[test:qa] all self-tests passed
```

The verdict is the **first line after the `[test:qa] <script>` header**, so a reader — and
`head -1` — sees SKIP vs PASS without parsing the prose.

### 8.5 Out of the contract's scope (but recorded)

`test:qa:all`'s real lanes are credential-heavy; this contract does **not** convert the 13
credential-blocked cases now (§14 F-1/F-4). They keep failing loudly on an absent credential, which
is safe (loud), just not yet uniform.

---

## 9. The present path is unchanged (byte-compatibility)

When `dist/mpd-package/package.json` exists:

* `relocate-smoke --self-test` must do exactly what it does today: read the staged patch, assert no
  dev-path leak, print `[relocate-smoke self-test] ok: staged patch is path-clean`, exit 0.
  With or without `--no-skip` the stdout must be identical (§12 A3).
* The real lane is unchanged: same gates after the prerequisite check, same assertions, same
  `evidence/plan-d/relocate/<ts>/` path, same exit codes.
* No existing assertion, message or FAIL path may be weakened, reworded or re-ordered except for the
  insertion of the gate and the marker lines.

### 9.1 Which checks stay unconditional (explicit)

A skip is **case-local and prerequisite-local**. Nothing that does not depend on the absent pack may
be skipped, and no other case's assertions are affected:

| # | check | when it runs |
|---|---|---|
| U1 | `relocate-smoke`'s staged-pack assertions (patch path-clean) | whenever the pack exists — the case either runs them or prints SKIP; it can never run them and skip them at once |
| U2 | `team-route-rewire`'s 12 offline checks (vendor closure present, closure self-contained, patch rows, web-compat self-row, pack-script exports) | **always**, before the gate (AM3b). A defect in any of them is exit 1, never a skip |
| U3 | every other case in the corpus (`plan-c-smoke`'s row checks, `preset-conformance`'s row/schema checks, `bundle-lifecycle`, `mount-assert`, …) | untouched: this contract changes nothing outside `relocate-smoke` and `team-route-rewire`, so a broken **source** bundle patch still fails loudly in the cases that read it |
| U4 | the pack-present path of both converted cases | unchanged and byte-compatible (§9) |
| U5 | the strict suites `test:qa:strict` / `test:qa:all` (`--no-skip`) | on a machine where the prerequisites are expected, any skip becomes a loud failure (§8.2/§8.3) |

The one thing a fresh clone legitimately cannot check is the **staged** pack's content (the pack does
not exist there) — that is the absence the SKIP reports, and U2/U3 keep the source-side integrity
covered by the cases that do not need the pack.

---

## 10. The reusable general rule (normative for every future case)

1. **Declaration.** A case that can skip declares each prerequisite in its header, one line each,
   in **check order**:
   ```
   // PREREQ: <reason-code> <repo-relative-path-or-probe> <remedy>
   // PREREQ: absent-credentials ~/.dsh/.credentials.yaml doc:AGENTS.md#7
   ```
   The `SKILL.md` row text must mention the same prerequisite(s) in one clause. The declaration is
   the single source the strict tooling and reviewers read.
2. **Per-lane, and the probe is lane-aware.** A prerequisite is declared with the lane(s) it affects
   (`self-test`, `real`, or `both`); a case may pass its self-test and skip its real lane (the common
   case). The probe must respect that: a `self-test` must never require credentials or a model route,
   so a lane-dependent prerequisite (e.g. `absent-credentials`, in a case that declares it) is probed
   only in the lane that needs it. Every **declared skippable** prerequisite is decided in exactly one
   place per lane. A prerequisite that is **not** declared skippable — for `relocate-smoke`:
   credentials (§3.3) — keeps its existing loud failure untouched and is not routed through the gate.
3. **Order and single marker.** Prerequisites are probed in declaration order; the **first absent**
   one is reported, once, in one marker line (AM6). The pack-first order is normative where both a
   repo artifact and credentials are needed: the artifact defines the case's subject.
4. **Independent assertions first (AM3b).** Offline checks that do not need the prerequisite run
   before the gate; their failure is a FAIL, never a skip.
5. **Never auto-build.** A lane must not run the remedy itself (a self-test that packs the bundle
   would be neither offline nor fast, SKILL.md hard rule 4). The remedy is **printed**, not executed.
6. **No new exit codes.** SKIP is exit 0, FAIL is exit 1; exit 2 stays "usage error"
   (`mount-assert` today). No third code.
7. **Silence is forbidden.** A skip that does not print the canonical marker does not exist; a
   branch that returns early without a marker is a defect.

---

## 11. t23 implementation spec (decision-complete)

### 11.1 `skills/dsh-qa/scripts/relocate-smoke.mjs`

Add near the top (after `repoRoot`):

```js
const SLUG = "relocate-smoke"
const PACK = join(repoRoot, "dist", "mpd-package", "package.json")
const PACK_PREREQ = { reason: "absent-staged-pack", prereq: "dist/mpd-package/package.json", remedy: "node scripts/pack-mpd.mjs" }
// Both spellings are normative (§6.5): the generic name and t23's reserved case-specific name.
const STRICT = process.argv.includes("--no-skip") || process.argv.includes("--require-pack")

/** AM1: a positive probe of the exact prerequisite. The ONLY skippable prerequisite of this case
 *  is the pack (§3.3): credentials are NOT part of the skip set and keep their loud failure. */
function absentPrereq() {
  return existsSync(PACK) ? null : PACK_PREREQ
}

/** SKIP (exit 0) or, under a strict flag, FAIL (exit 1) — the same field values in both modes
 *  (AM2). The marker is the FIRST stdout line (§4); prose follows on stdout (skip) or stderr (fail). */
function gate(lane) {
  const p = absentPrereq()
  if (p === null) return
  console.log(`[mpd-qa] ${STRICT ? "FAIL" : "SKIP"} case=${SLUG} lane=${lane} reason=${p.reason} prereq=${p.prereq} remedy="${p.remedy}"`)
  const prose = `[${SLUG}] prerequisite absent: ${p.prereq} (${p.reason}); ${STRICT ? "failing (strict flag)" : "skipping (not a failure)"}`
  if (STRICT) console.error(prose)
  else console.log(prose)
  process.exit(STRICT ? 1 : 0)
}
```

* `selfTest()`: call `gate("self-test")` **as its first statement** (replacing the current
  unconditional FAIL at `:20`); when the pack exists, the staged-pack assertions run unchanged.
* `runReal()`: call `gate("real")` **as its first statement** to decide the pack, then **keep** the
  existing credentials check unchanged (`if (!existsSync(creds)) { console.error("[relocate-smoke]
  missing credentials"); process.exit(1) }` at `:28`) — credentials are deliberately **not**
  skippable (§3.3). The remaining body (`cpSync`, `npm install`, `dump-config`, the boot, the
  assertions, the evidence write) is unchanged.
* Header: declare exactly the one skippable prerequisite —
  `// PREREQ: absent-staged-pack dist/mpd-package/package.json node scripts/pack-mpd.mjs`.

### 11.2 `skills/dsh-qa/scripts/team-route-rewire.mjs`

Same helper/gate (slug `team-route-rewire`), same **single skippable prerequisite** as §11.1 (the
pack) and the same two flag spellings. Minimal change: keep the existing offline `checks` block
**before** the gate (AM3b — it already is; a failing check is exit 1, never a skip), replace the pack
guard at `:53` with `gate("self-test")`, and in `runReal()` insert `gate("real")` **before** the
existing credentials check at `:59` while **keeping that check unchanged** (credentials are not
skippable, §3.3).

### 11.3 `skills/dsh-qa/SKILL.md`

Add one subsection (verbatim text in §16) documenting the marker grammar, the `--no-skip` flag, the
reason-code table, AM1–AM7 in short form, the `PREREQ:` header convention, and the skip-counting
one-liner. Add the prerequisite clause to the two cases' rows in the case table.

### 11.4 `package.json`

* **add** `test:qa:strict` exactly as in §8.2;
* **edit** `test:qa:all` to append `--no-skip` to each case invocation (§8.3);
* **leave** `test:qa` untouched (§8.1).

### 11.5 Evidence and the vendor re-pin

* Evidence for every lane t23 measures goes to
  `evidence/rtl-extraction-residual/followup/x7-skip-implementation/{result.json,output.log,raw/}`
  (or the captain's assigned path) with the exact commands and exit codes.
* `relocate-smoke.mjs`, `team-route-rewire.mjs` and `SKILL.md` are all under `skills/**` ⇒ the
  **single-skills-writer** rule applies: t23 is the wave's only `skills/**` writer, and the
  `VENDOR_LOCK.json` re-pin (whose `treeSha`/`fileCount` change) rides in the **same commit**
  (AGENTS.md §9/§11), the value taken from `node scripts/verify-vendor.mjs`'s own output.

---

## 12. t23 acceptance criteria (each independently checkable)

| id | criterion | command / measurement |
|---|---|---|
| **A1** | Pack-absent self-test SKIPs: exit 0, exactly one canonical SKIP line matching the §4 regex and appearing as the **FIRST stdout line** (verify with `head -1`), with `reason=absent-staged-pack` and `remedy="node scripts/pack-mpd.mjs"`; no `ok`/`PASS` line printed. | run the case in a pack-absent sandbox (the fake-root method of §15 M2) and quote stdout + `echo $?` + `head -1` + `grep -c '^\[mpd-qa\] SKIP '`. |
| **A2** | Pack-absent + strict flag: **both** `--no-skip` and `--require-pack` exit 1 with exactly one canonical FAIL line each, carrying the same `reason`/`prereq`/`remedy` fields as A1's SKIP line, and the two flag runs are byte-identical to each other. | same sandbox, two runs; quote output + exit codes; show the field sets are equal and `diff` between the two runs is empty. |
| **A3** | Pack-present, all three modes byte-identical: `diff` of stdout/exit between `--self-test`, `--self-test --no-skip` and `--self-test --require-pack` is empty; the existing `ok:` line and exit 0 unchanged. | A/B/C run in the real workspace; quote all three `diff`s (empty) + the three exit codes. |
| **A4** | Real-lane absent pack: exit 0 + one canonical SKIP line (first on stdout) with `lane=real`, and **no** evidence directory created; with either strict flag exit 1. | `node skills/dsh-qa/scripts/relocate-smoke.mjs` with the pack hidden (fake root or a run whose `repoRoot` lacks `dist/`), plus a pre/post `ls evidence/plan-d/relocate` comparison (unchanged). |
| **A5** | The **non-skippable** prerequisite stays loud (§3.3): pack present + credentials absent (`HOME` sandboxed, `DEEPSEEK_API_KEY` unset) → exit 1 with the existing `[relocate-smoke] missing credentials`, **no** `[mpd-qa]` marker, no evidence dir — in all three flag modes. | `env -u DEEPSEEK_API_KEY HOME=$(mktemp -d) node skills/dsh-qa/scripts/relocate-smoke.mjs` (+ the two strict-flag variants); quote exit codes and the absence of a marker. |
| **A6** | Present-but-broken is a FAIL in **both** modes (AM3): stage a copy of the real pack, seed a dev-path leak in its patch copy, and run both modes → exit 1, no SKIP line. | the seeded-broken-pack lane; quote exit codes + the FAIL text. |
| **A7** | AM3b: `team-route-rewire`'s offline `checks` still run before the gate — provable from the diff (checks block precedes the gate) **and** by one run with a seeded broken input that one check reads → exit 1, not a SKIP. | the diff + the seeded-input run. |
| **A8** | Fresh-clone statement reproduced and recorded: pack-absent sandbox → the two self-tests SKIP (exit 0 each), skip count `2`; and the workspace A9 run has skip count `0`. | `grep -c '^\[mpd-qa\] SKIP '` on both captured logs. |
| **A9** | No regression with prerequisites present: `bun run test:qa` exit 0 and **zero** SKIP lines (24 passing self-tests), `bun run test:qa:strict` exit 0, `bun run test:qa:all` unchanged-or-stricter per §8.3. | the three commands with exit codes + the skip counts. |
| **A10** | Documentation landed: SKILL.md carries the §16 block (marker grammar, flag, reason codes, `PREREQ:` convention, counting one-liner) and both case rows name the prerequisite. | `grep -n '\[mpd-qa\]' skills/dsh-qa/SKILL.md` + the two case-table rows quoted. |
| **A11** | Standing gates green after the edit, exit codes quoted: `bun run typecheck`, `bun test packages`, `node scripts/verify-vendor.mjs`, `node scripts/verify-rtl-references.mjs`, `node scripts/verify-rows-parity.mjs`, `bun run test:qa`. | the six commands. |
| **A12** | Vendor discipline: exactly ONE `VENDOR_LOCK.json` re-pin in the same commit as the `skills/**` change, value from `verify-vendor` output; `verify-vendor` exit 0. | `git show --stat` of the commit + the verify-vendor run. |

---

## 13. t23 non-goals (do not do these)

1. Do not convert the other 21 cases (their prerequisite handling is classified in §14).
2. Do not modify `scripts/pack-mpd.mjs` or make any lane build the pack (§10.5).
3. Do not add dependencies, network calls, or a new exit code (§10.6).
4. Do not rewrite unrelated FAIL messages, assertions, or evidence paths (§9).
5. Do not weaken the existing `checks` of `team-route-rewire` or the patch-leak assertion of
   `relocate-smoke`.
6. Do not create evidence directories on skip paths (§3.2).
7. Do not use `--no-skip` to change *which* prerequisite is reported (§6.2).
8. Do not touch `evidence/rtl-extraction-residual/verify/**`, `repair-verify/**` or any historical
   evidence (never rewrite history).

---

## 14. Classified follow-ups (recorded, with owners — not t23's scope)

| id | finding (measured, §15) | required fix | owner |
|---|---|---|---|
| **F-1** | `codegraph-smoke.mjs` has **no** credential guard and calls `cpSync(creds, …)` twice (`:31`, `:35`) — on a machine without `~/.dsh/.credentials.yaml` it dies with an uncaught `ENOENT` stack trace instead of a skip: the exact AM1 counter-example. | add the §11-style gate with `absent-credentials` / `absent-toolchain-binary` / `absent-staged-pack` (in that case's declared order) | next wave (needs a task) |
| **F-2** | `agent-teams-dispatch.mjs` self-test fails when `dsh` is absent (`:93`) — a P4 prerequisite in a **self-test** lane, so a clone on a `dsh`-less machine is red. | gate with `absent-dsh-binary` / `absent-harness-closure` | next wave |
| **F-3** | `readonly-deny.mjs` self-test `:142` requires the harness closure (P5); tolerated on `dsh`-bearing machines only. | gate with `absent-harness-closure` | next wave |
| **F-4** | 13 real lanes exit 1 on absent credentials with case-specific wording (no marker). Loud, but not uniform; `test:qa:all` (§8.3) makes them loud by design until converted. | convert per §10 when each case is next touched | next wave |
| **F-5** | `test:qa:all` (t8) runs real lanes for all cases; before t23's §8.3 edit it could "pass" as a set of skips. | §8.3 (`--no-skip`) | **t23** |

---

## 15. Measurements and provenance (what is measured vs inferred)

All commands ran from `/root/dshProj/my-power-dsh`; the working tree carries t8's staged repair
(uncommitted) as of this task, `HEAD = 32ae54dd10db7ea46e1c1263143d56f266fd1f78`.

| id | measurement | command | result |
|---|---|---|---|
| M1 | current suite baseline | `bun run test:qa` | exit 0, 24 cases, zero SKIP lines (no marker exists yet) — `raw/x2-testqa-baseline.log` |
| M2 | **the pre-state: pack absent ⇒ FAIL** | fake-root farm (`raw/x2-fakeroot/`: tracked files symlinked, `dist/` absent) + the real case bytes → `node <farm>/skills/dsh-qa/scripts/relocate-smoke.mjs --self-test`; same for `team-route-rewire.mjs` | `relocate`: exit **1** `[relocate-smoke self-test] FAIL: run node scripts/pack-mpd.mjs first`; `team-route-rewire`: exit **1** `[team-route-rewire self-test] FAIL: run node scripts/pack-mpd.mjs first` — `raw/x2-fakeroot-probe.log` |
| M3 | unknown-flag tolerance | `for f in skills/dsh-qa/scripts/*.mjs; do bun "$f" --self-test --no-skip; done` | **24/24 exit 0** — `raw/x2-strict-flag-sweep.log` |
| M4 | fresh-clone blocker set | guards grep across the corpus (§2 table) | exactly two **self-test** P1 blockers (`relocate-smoke:20`, `team-route-rewire:53`); `packages/*/dist` and `_deps` are tracked, so not blockers |
| M5 | case bytes measured | `sha256sum` | `relocate-smoke.mjs 2680a540df6dfc19360bc067ae411b14a7ddfff95dc846c716d2f94598b828c3`; `team-route-rewire.mjs 15bc6ef9b196b2665347bc8a4e84d2db26116654542dad61f862b768cd6bc1dc` |
| M6 | `.gitignore:12` is `dist/mpd-package/` | `cat -n .gitignore` | confirmed (`:6` = `.toolchain/`) |
| M7 | t8's `test:qa:all` is the real-lane runner | `git diff --cached package.json` | `test:qa:all` runs `bun skills/dsh-qa/scripts/<c>.mjs` per case |
| M8 | the **non-skippable** prerequisite is already loud (A5 pre-state), and both strict-flag spellings are currently **ignored** | `env -u DEEPSEEK_API_KEY HOME=$(mktemp -d) node skills/dsh-qa/scripts/relocate-smoke.mjs` (+ `--no-skip`, + `--require-pack`) | all three: exit **1**, `[relocate-smoke] missing credentials` — `raw/x2-a5-credential-loud.log` |

**Inferred (not measured) and therefore required as t23 evidence (A8/A9):** that a fresh clone on a
machine with `dsh`/`node`/`bun` yields `test:qa` exit 0 with exactly two SKIP lines. The inference
rests on M1 (all other self-tests pass) + M4 (only those two blocks depend on a gitignored
artifact); the fake-root farm reproduces the pack-absence condition but is **not** a byte-for-byte
clone (it symlinks tracked trees and keeps `node_modules`), which is stated here rather than hidden.

---

## 16. Verbatim SKILL.md block for t23 (§11.3)

```markdown
### Absent prerequisites: SKIP with a reason (fresh clones)

A case whose prerequisite is not present must SKIP, not FAIL — while an explicit strict request
must still fail loudly, and a *broken* prerequisite always fails:

| lane | prerequisite | strict flag | exit | stdout |
|---|---|---|---|---|
| `--self-test` | absent | none | 0 | one `[mpd-qa] SKIP …` line as the FIRST stdout line |
| `--self-test` | absent | `--no-skip` or `--require-pack` | 1 | one `[mpd-qa] FAIL …` line (first on stdout) |
| real run | absent pack | none | 0 | one `[mpd-qa] SKIP …` line (first on stdout), NO evidence directory |
| real run | absent pack | either strict flag | 1 | one `[mpd-qa] FAIL …` line |
| real run | absent credentials in a case that does NOT declare them skippable | any | 1 | the case's own failure (e.g. `missing credentials`) |
| any | present but broken | any | 1 | the case's own FAIL — a skip is never allowed here |

Marker grammar (exactly one line per invocation, the FIRST stdout line of the case's output; emitted
on stdout in both the SKIP and the FAIL mode):
[mpd-qa] SKIP case=<slug> lane=<self-test|real> reason=<code> prereq=<path|probe> remedy="<command|doc:path#section|->"
[mpd-qa] FAIL case=<slug> lane=<self-test|real> reason=<code> prereq=<path|probe> remedy="<command|doc:path#section|->"

Reason codes: absent-staged-pack / absent-toolchain-binary / absent-credentials /
absent-model-route / absent-dsh-binary / absent-harness-closure / absent-runtime /
absent-fixture / unsupported-platform.

Rules: probe the exact prerequisite positively (never catch a failure); run prerequisite-independent
assertions first; a present prerequisite is always checked and always fails loudly when broken;
a prerequisite that is not declared skippable is never routed through the gate; never build/execute
the remedy from a lane; never print a PASS after a skip; one marker per case.

Callers: exit 0 + a SKIP line = skipped (never a pass); exit 0 with no marker = pass; exit 1 = fail.
Count skips: `bun run test:qa 2>&1 | grep -c '^\[mpd-qa\] SKIP '`.
Strict suites (no skips tolerated): `bun run test:qa:strict` (self-tests), `bun run test:qa:all` (real lanes).
Declare prerequisites in the case header, one line each, in check order:
`// PREREQ: <reason-code> <repo-relative-path-or-probe> <remedy>`
Strict flag spellings: `--no-skip` (generic) and `--require-pack` (the reserved, case-specific name for
the staged pack); a case that has both accepts either, with identical semantics.
```
