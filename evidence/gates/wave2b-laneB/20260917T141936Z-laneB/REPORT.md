# Wave-2b LANE B — REPORT (gates / packaging / hygiene)

Task `t14`, attempt 1. Evidence: this directory. The machine-readable record is `result.json`
(`60abb992a066b194` at the time of writing — every run rewrites it and prints its own digest);
`run-laneB-evidence.mjs` (`65e69a7b9d070d53`) regenerates every reading below in one command:
`node ./run-laneB-evidence.mjs <this-dir>` from the repository root. Full output per step, never a `tail`.

## 1. Delivered (the declared write set, file-exact)

| path | what | digest (sha256-16) |
|---|---|---|
| `scripts/verify-rows-parity.mjs` | T-68: `--self-test` with a seeded violation + the hermeticity arm | `e622eb2fcf8556b7` |
| `scripts/verify-manual-paths.mjs` | T-66: NEW — the manual's path audit, 15 buckets, two declared error directions | `22d49ea72c12b8a1` |
| `scripts/verify-gates.mjs` | T-70: NEW — the non-short-circuiting aggregate runner | `d6bc7b02ccecfab5` |
| `scripts/repin-vendor.mjs` | T-71: the POLICY wording + its pins in ONE edit | `fc3919ef5d6b07f7` |
| `scripts/run-qa-lanes.mjs` | T-89's RUNNER half: the discovered-count assertion | `2b8ff82cad206aab` |
| `scripts/mpd-doctor.mjs` | T-41: NEW — per-entry path/version/degrade probe | `21b1db27251d8d44` |
| `scripts/install-git-hooks.mjs` | T-34: NEW — the pre-commit guard installer (hook text carried, refuses) | `2708e1f6a02618d1` |
| `scripts/verify-pack-closure.mjs` | HOP (granted by the captain, revision 2): the t26 arm's precision fix | `f59850ba9211c217` |
| `.gitignore` | T-77: the QA scratch family ignored BY SHAPE | `83baa5404c203025` |
| `package.json` | `verify:gates` → `node ./scripts/verify-gates.mjs` (scripts block only) | `ef7d0884e56df8ca` |
| `evidence/gates/wave2b-laneB/**` | this record + drivers + logs | — |

`scripts/verify-docs-parity.mjs` was NOT modified by this lane (it is excluded by name in the freeze —
the round-1 blocker PLAN-F-2). The write-set audit (`write-set-audit.log`) lists the declared set with
its digests, the four NEW scripts (verified ABSENT at the 14:06Z freeze, present now), and a read-only
tree snapshot annotated with the note that authorship cannot be read from a shared checkout.

## 2. Row → instrument → red side (both readings kept)

| row | reading | its red side (measured) |
|---|---|---|
| **T-34** | `node ./scripts/install-git-hooks.mjs --self-test` → **exit 0, 6/6 arms**; the generated hook (sha256 `a40db398…`, 0755) refuses a staged `skills/**` change without the lock, naming the 3-step remedy; the real `.git/hooks` is untouched (no non-sample hooks before/after, dir mtime unchanged) | throwaway repo, corpus staged without the lock → hook non-zero + remedy + lock byte-unchanged; lock staged → 0; non-corpus → 0; an EMPTY/unwired hook reddens; `--force` refusal |
| **T-41** | `node ./scripts/mpd-doctor.mjs --self-test` → **exit 0, 7/7 arms**; live → exit 0 (6 entries, each NAMED individually with path + version); `MPD_AST_GREP_SG_PATH=/nonexistent/sg` → **exit 2** with that entry `MISSING ⇒ degrades: …` | the pin arm + `missing-required-exit1` (exit 1 vs 2 distinction) + the hung-probe arm (a probe that cannot run is MISSING-with-reason, never `ok`) + a fixture env with one binary absent → NAMED |
| **T-66** | `--self-test` → **exit 0, 6/6 arms**; live on `AGENTS.md` (sha `8d0dd92980c353ad`, mtime `2026-09-17 17:02:41`) → **exit 1**, `audited=107 resolved=103 unresolved=4`, over-report 61 / under-report 61 in **separate** buckets | a fixture manual naming a nonexistent path → exit 1, path named; over-report and under-report each in their own named buckets, never folded |
| **T-68** | `--self-test` → **exit 0, 6/6 arms**; live parity → exit 0, `25 row ids match` | a fixture missing row → exit 1 + `MISSING from … ; row-d`; installer-only row → `EXTRA`; duplicate → `DUPLICATE`; empty patch → `zero-subject`; and the run asserts the live patch's bytes + mtime are unchanged |
| **T-70** | `node ./scripts/verify-gates.mjs --self-test` → **exit 0, 9/9 arms**; real aggregate → **exit 0** reporting **all five members** (`vendor/dist-fresh/rows-parity/docs-parity/preset-conformance`, each with its own verdict) | the injected-failing-member arms (first / middle / two red) assert ALL members reported + non-zero + the failing id named; the OLD `&&` chain's short-circuit is shown in `t70-before-chain.log` (forced-red first member → exit 1 and NO later member output) with its limit stated: the natural chain is exit 0 today because the tree is green |
| **T-71** | `--self-test` → **exit 0, 10/10 arms**; `--check` → exit 0 (before AND after: 0/0) | the same self-test pins the new POLICY strings, so wording + pins moved in one edit; a mutated lock still exits 1 (`--check` arm b) |
| **T-77** | `gitignore-shape-driver.mjs` → **exit 0**: a NEW root dir `.qa-w2b-shape-probe` is ignored (`/.qa-*`, `.gitignore:87` names the pattern) and the near-miss `.quarantine-probe` is NOT ignored | the near-miss is the control; the driver also shows the family's existing FILES (`.qa-t15-dir`, `.qa-run-stamp`, `.qa-t17-final`) now ignored, which is why the pattern carries no trailing slash |
| **T-88** | `derived-surface-audit.mjs --self-test` → **exit 0, 5/5 arms**; live audit → **exit 0**: no lane covers a derived surface; the integration task `t25` declares all four (`packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`, `.mpd/plans/**`) | a FIXTURE record with a lane holding `packages/*/dist/**` → flagged + the task named, and the fixture carries the platform's own refusal string (`1 changed path(s) not covered by inScope: …/dist/index.js is undeclared`) |
| **T-89 runner half** | `node ./scripts/run-qa-lanes.mjs --check-drift` → **exit 0**, `discovery: 45 lane script(s) discovered (45 listed, 0 unlisted, 18 outside every suite); .mjs entries 45, underscore-excluded 0`; `--self-test` → exit 0 | fixture corpus with an unlisted `.mjs` (drift named) + the `suites=[]` lane (NOT drift); the count is re-derived from the directory on every run and the partition is asserted (`unexpectedDrop`, zero-subject discovery) |

## 3. The CONTRACT's verify (the two commands the payload carries)

- `node scripts/verify-rows-parity.mjs` → **exit 0**: `25 row ids match the bundle patch insert list (…)`.
- `node scripts/run-qa-lanes.mjs --check-drift` → **exit 0**: the discovery line above + `immutability required=9 … exempt=36` + `manifest and disk agree (51 entries, 45 lane script(s) discovered)`.

## 4. Declared READINGS (evidence, not verdicts — a red this lane cannot keep green lives here, per T-84)

- `node ./scripts/verify-manual-paths.mjs` → **exit 1**: `AGENTS.md` names **4** paths that do not exist at the repo root — `dist/validator.js` (144), `dist/index.js` (269, with the 19 real tails annotated), `client` (440), `node_modules/@mpd-dsh/mpd` (443). All four are loose relative / exports-map spellings, not deleted files; the fix is a docs edit and belongs to lane B3 (hand-off, never an edit from here).
- `node ./scripts/mpd-doctor.mjs` → exit 0 (all six entries ok, individually named).
- `MPD_AST_GREP_SG_PATH=/nonexistent/sg node ./scripts/mpd-doctor.mjs` → exit 2, `verdict=DEGRADED … missingOPTIONAL=ast-grep` (the REQUIRED-vs-OPTIONAL exit-code distinction).
- `node ./scripts/repin-vendor.mjs --check` → exit 0 (in sync in this window).

## 5. The hop this lane requested, and its fix

`scripts/verify-pack-closure.mjs` is not in the freeze's write set (it is hop candidate #2 there). Its
t26-era arm `…stamp pinned -> hard CONTENT-DRIFT…` began flapping: it pinned `--pack-stamp` at
`statSync().mtime` (a Date, millisecond precision) while the gate compares `statSync().mtimeMs`
(sub-millisecond digits), so a source file at `X.400086 ms` read NEWER than a pin of `X.400` and the
HARD verdict silently became the EXPECTED class. The captain granted the hop (contract revision 2 adds
the file to `inScope`); the pin is now built from the float mtime (`Math.floor(mtimeMs) + 1`), and
`--self-test` is **34/34** with the live read exit 0. Both readings (33/34 before, 34/34 after) are kept.

## 6. Bounds carried (stated by the seats that own them, not hidden here)

1. **`scripts/mpd-doctor.mjs` is not in `dist/mpd-package/`**: the packer copies only `install-mcp.mjs`
   and `mpd-ext.mjs` from `scripts/`, so shipping the doctor needs a packer asset-list/`files` edit —
   outside this write set. Its only import (`packages/mpd-mcp-shared/bin-resolve.mjs`) IS packed.
2. **Size, deliberately**: `mpd-doctor.mjs` 828 lines, `verify-manual-paths.mjs` 590, `verify-gates.mjs`
   502, `install-git-hooks.mjs` 388 — each is a single-file deliverable with a mandated fixture suite, so
   the 250-LOC modularization ceiling is knowingly exceeded; splitting needs a second file, which the
   write set does not allow.
3. **The gitignore shape's source is lane D's convention** (plan §4.2). No formal declaration is on disk
   yet, so the shape was DERIVED by measuring the drivers' actual roots (`.qa-reloc`, `.qa-web-client`,
   `.qa-shipped-path`) and the on-disk family; it can only ignore root paths that already begin `.qa-`,
   and the near-miss control pins that boundary. Recorded as a prerequisite, not an assumption.
4. **`/usr/bin/sg` on this machine is shadow-utils' `newgrp`** — a live false-positive trap for any PATH
   `sg` lookup; the doctor rejects it by the `--version` probe and names the rejection.
5. **The `verify:gates` exit semantics changed** from "first failing member's code" to 0 green / 1 any
   member failed / 2 runner-config error. That is the row's own point (report every member), and the
   old shape's behaviour is kept beside it in `t70-before-chain.log`.

## 7. Re-run

```
node evidence/gates/wave2b-laneB/<this>/run-laneB-evidence.mjs evidence/gates/wave2b-laneB/<this>
```
It re-runs all nine §2 commands, the contract's two, the four declared readings and the two drivers,
writes one full log per step and a fresh `result.json` with a digest per artifact.
