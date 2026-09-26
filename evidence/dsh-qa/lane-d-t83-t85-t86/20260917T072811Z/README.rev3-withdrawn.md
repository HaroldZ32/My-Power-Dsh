# Lane D — T-85 / T-86 / T-83 (wave 2, task t11, attempt 9)

**Author:** `qa-lane-engineer` (the wave's single `skills/**` writer) · **stamp** `20260917T072811Z`
**Contract:** t11 revision 3 (captain's frozen T-83 shape + corrected membership) · **tree:** `.mpd/team/friction-p2-wave`
**Write set (10 files, hashes in `lane-d-write-set.sha256`):** `skills/dsh-qa/cases.json`,
`skills/dsh-qa/scripts/extension-lifecycle.mjs`, six `skills/dsh-qa/scripts/team-watchdog-*.mjs`,
`scripts/run-qa-lanes.mjs`, `scripts/reconcile-register.py` (new).

---

## 1. T-85 — a QA lane no longer writes the CANONICAL artifact

**Route used (the contract asked which): the t70 scratch-COPY pattern, not a `--out` flag.**
`scripts/pack-mpd.mjs` takes no `--out` — `const outDir = join(repoRoot, "dist", "mpd-package")` is
hardcoded at its line 14 — so the sanctioned flag does not exist on disk. The lane now copies the real
packer, rewrites EXACTLY two path constants (`repoRoot`, `outDir`), REFUSES a packer whose anchors do
not match exactly once, and packs into `<this run's evidence dir>/scratch-pack/mpd-package`.

**Real run (full lane, not `--self-test`): `exit 0`, `ok: true`, all six arms green**
(`install main failure isolation packed isolationFinal`). The packed arm's own numbers:

| reading | value |
|---|---|
| `steps.packed.ok` | `true` |
| `packExit` / `scratch.refused` | `0` / `false` |
| scratch out-dir | `evidence/extensions/extension-lifecycle/2026-09-17T07-30-20.128Z/scratch-pack` |
| scratch pack size | **1,190 files** — the same count as the canonical tree, i.e. a FULL pack and not a partial patch (the register's own T-85 discriminator: one bucket of 1,190 vs "a few files") |
| packer provenance | `scripts/pack-mpd.mjs` sha `79563bc5fdd6518e` → patched sha `3a104788f72a4765` (2 lines rewritten) |
| packed facts | row `true`, plugin `true`, extensions asset `true`; negative control `falsifiable: true` |

**Canonical artifact stamp — before `==` after, `canonical.unmoved: true`:**

```
{"present":true,"files":1190,
 "manifestSha256":"eaa0919702bf5b334332d5b701b6a2a85ab5aa0a84cc4d9b4faa6636ebf61c",
 "patchSha256":"a9891438e87d3dec1fc0e4ac91554cfa5881eecb120d93120a5a11767a03f270"}
```

Independent corroboration: `dist/mpd-package` mtime is `2026-09-17 13:19:48.265 +0800`
(`05:19:48Z`) — it PREDATES this lane run and is the same stamp §8.7 already records
(manifest `eaa0919702bf5b33…`, 1,190 files), so nothing packed the delivered artifact during the run.
Evidence: `evidence/extensions/extension-lifecycle/2026-09-17T07-30-20.128Z/result.json` →
`steps.packed`; log `extension-lifecycle-run2.log`.

**In-lane falsifiability of the new guard (offline, `--self-test` arm 7):** the patcher rewrites
exactly two anchors of the REAL packer, the patched source no longer contains
`join(repoRoot, "dist", "mpd-package")`, and a drifted packer plus an anchor-less source are both
REFUSED. Without that arm "this lane packs into a scratch dir" would be a claim no packer could
contradict.

## 2. T-86 — the reconciliation survives the wave it reconciles

**New durable path:** `scripts/reconcile-register.py` (sha `840edb279f662b3d…`, 15.4 KB, py_compile OK).
**The sealed wave-1 copy is byte-untouched:** `evidence/wave1-integration/20260917T052400Z/reconcile-register.py`
sha `b777b2741c04415c…` (`sealed-wave1-script.sha256`) — never opened for writing.

All four required properties are proven by execution, not by reading:

| # | property | command | result |
|---|---|---|---|
| a | resolves the ARCHIVED team and exits 0 with current artifacts | `python3 scripts/reconcile-register.py --team friction-p1-wave --out …` | **exit 0**, prints `.mpd/team/archive/friction-p1-wave/team.json (archive, team friction-p1-wave)` |
| b | RELOCATION-PROOF root (no hardcoded depth) | same script run from `/tmp`, and from a COPY at `/tmp/t86-fake/scripts/` | root resolved by the marker walk; the copy reconciled ITS OWN tree (`todo_path=/tmp/t86-fake/.mpd/TODO.md`) |
| c | live dir resolution | `--team friction-p2-wave` | **exit 1** (mid-wave: the register's §8.1–§8.5 partition is still the wave-1 reading while the live coverage lists wave-2 rows) — a reading of the REGISTER's state, not of this script |
| d | FAILURE MARKER + stale-artifact impossibility | disagreement run; then a re-run into the same `--out` | exit 1 with `register-partition-check.FAILED` naming all 61 disagreements; a re-run into a populated `--out` REFUSES with exit 3; a successful run REMOVES a stale marker |

Also exercised: `--team nope` → exit 3; no `--team` with 10 coverage-carrying records → exit 3
listing all candidates (`friction-p2-wave [live] … friction-p1-wave [archive] …`) rather than
guessing. Exit codes are in the docstring/`--help`: **0 reconciled · 1 disagreement · 3 unusable input**.

The replacement also fixes the two defects the register row did not carry: `ROOT` comes from a marker
walk with a `git rev-parse --show-toplevel` fallback (never `HERE.parents[2]`), and the team id is
taken from `--team`/`--team-file` (live OR archive) instead of a hardcoded literal.

## 3. T-83 — the absence is loud at the runner level; the key drivers migrated

**Shape (frozen):** a MANDATORY per-lane string `immutabilityGuard` in `skills/dsh-qa/cases.json`,
valued `"required"` or `"exempt: <reason>"`. Declared on **45/45 lanes** — 7 `required`,
36 `exempt: no caller-supplied output target …`, 2 `exempt: the driver writes no file`.
Rides the EXISTING `--check-drift` / `qa-lane-drift` gate; no new gate. The static assertion is the
literal specifier `./lib/immutable-output.mjs`, not the export list.

**Why the set is DECLARED and not derived — four predicates, all measured and all failing:**

| candidate predicate | measurement | verdict |
|---|---|---|
| driver touches `result.json` | **45/45** | would be the forbidden 45-driver sweep |
| driver uses `writeFileSync` | **40/45** | same |
| `grep -l -- "--out"` | 12 files: 3 were `--outfile` remedy text, 5 usage COMMENTS, 2 real parsers | false predicate (retracted) |
| "the 12 that take `--out`" as the required set | refuted by the line above | superseded |

**Membership actually declared (7 `required`, 6 newly migrated + 1 pre-existing):**
`team-watchdog-{config,fault,heartbeat,notify,scene}` (they take a caller-supplied evidence dir via the
SHARED `lib/watchdog-lane.mjs` `evidenceDir(argv, slug)`), `team-watchdog-boot.mjs` (inline), and
`watchdog-redesign.mjs` (already imported). Criterion quoted verbatim in the manifest rule:
*the evidence target can be CALLER-SUPPLIED, so a re-run can be pointed at an existing directory —
precisely what `refuseOverwrite`/`writeImmutable` refuse.*
The census that backs the exemptions: over all 45 drivers the only value-taking flags are
`--require-pack` (4×, boolean STRICT), `--tool`/`--profile-source`/`--reparse` (single-use, no output
target), and no `process.env.*OUT|DIR|EVIDENCE*` output target exists anywhere in the drivers or the
shared libs. **The earlier "unresolved" candidate `tui-team-surface.mjs` is RESOLVED:** its
`EVIDENCE_ROOT` is fixed but `outDir = join(EVIDENCE_ROOT, stamp)` (`:792`) is stamped, so a re-run
cannot address an existing target — legitimately exempt, no bound left open.

**Migration is load-bearing, not decorative** — every required driver IMPORTS and CALLS the guard at
its evidence-dir site (`import=1 refuseOverwrite=1 exitOnRefusal=1` for all 7), so a re-run aimed at an
existing `--out` refuses with the T-53 remedy instead of silently rewriting a record.

**BOTH frozen falsifications, run on the real tree and byte-restored:**

```
(a) delete ONE import from a required driver  → exit 1
    [run-qa-lanes] immutability guard: required driver skills/dsh-qa/scripts/team-watchdog-fault.mjs
    (team-watchdog-fault) does not import ./lib/immutable-output.mjs
    driver sha 1ae0df63d8d60e62 -> 23984a831f950aa6 -> restored 1ae0df63d8d60e62 (identical)
(b) delete one declaration                    → exit 1
    [run-qa-lanes] immutability guard: lane team-watchdog-scene carries no immutabilityGuard
    declaration (declare `required` or `exempt: <reason>`)
    cases.json sha ca50d08dc332beeb -> c380846efb91efb1 -> restored ca50d08dc332beeb (identical)
```
After both restores `--check-drift` exits 0 again. Raw output: `falsification-a.{stdout,stderr}`,
`falsification-b.{stdout,stderr}`, `hashes-after-restore.txt`.

**Every run prints the resolved set** — including `required=0`, which is a RED, and an EMPTY resolved
set is a RED (the rule that closes the "more than zero" reading from the other side):

```
[mpd-qa:(only)] immutability required=7: team-watchdog-boot, team-watchdog-config, …
[run-qa-lanes] immutability required=7: … exempt=38
```
The runner's `--self-test` gained the arms that prove all three (missing import named, undeclared lane
named, empty-set RED) plus a fixture lane that really imports and drives a stub of the helper —
**`node scripts/run-qa-lanes.mjs --self-test` exits 0**.

## 4. The corpus reading for the captain's SINGLE re-pin

Produced by the repo's own derivation (`node scripts/repin-vendor.mjs`, DRY RUN — nothing written),
full text in `repin-vendor-dry-run.log`:

```
asset        : skills
  locked     : treeSha=68318157344aafecabb641b9d947d0f17ab6a4bce5c399b486f18790cc7e3a9c fileCount=323
  computed   : treeSha=c0ea162268740e15a0da39965d9494e2364ed2e6dd0f71b49053c135a9f2737a fileCount=323
               (1 file(s) LF-normalized)
  raw-bytes  : a46a9f0858af2a30f8b6cbec7d02d6f9de0d11300a47c18d2011585c571f4497   <- NEVER write this one
  DELTA      : 68318157344a… -> c0ea16226874…      [repin-vendor] DRY RUN: 1 asset(s) would be re-pinned
```
**Cause, exactly:** the corpus half of lane D — the 6 migrated drivers + `skills/dsh-qa/cases.json` +
T-85's `extension-lifecycle.mjs` (8 files). **NOT corpus:** `scripts/run-qa-lanes.mjs`
(44,774 B before the change, `6bea2b38de2a…`) and `scripts/reconcile-register.py` (new, under `scripts/`).
File count is unchanged (323 → 323), so the re-pin is a pure `treeSha` move.

## 5. Declared reds, reported as-is with provenance

1. **`bun run test:qa` → exit 1**, and the sweep is otherwise perfect: **45 lanes, exactly 1 failing**,
   `agent-teams-messaging.mjs --self-test`, whose only failing line is
   `VENDOR_LOCK skills asset is stale: lock=323/68318157344a tree=323/c0ea16226874 (re-pin in the same
   commit, AGENTS.md §9)` — i.e. the §4 re-pin, which is the CAPTAIN's step by contract (t11 non-goal:
   "writing `VENDOR_LOCK.json` (the captain's single re-pin step)"). Raw: `selftest-sweep.txt`.
2. **`node scripts/verify-dist-fresh.mjs` → exit 1**: `STALE packages/mpd-team-watchdog-plugin/dist/index.js`
   (committed `153319 B / 7b821135d24a…` vs fresh build `156335 B / f68477bc15d2…`). **Attribution:
   lane C's in-flight edits, not lane D** — that package's `src/{actions,engine,machine,index,config-file}.ts`
   carry mtimes `15:26–15:30` while its committed `dist/index.js` is `13:42`; its diff is 7 files /
   220 insertions; lane D's write set contains **zero** `packages/**` paths. Raw + file:line anchors:
   `verify-dist-fresh.log`, `verify-dist-fresh-attribution.txt`.

## 6. Bounds (what this evidence does NOT claim)

- The live `friction-p2-wave` reconciliation is RED today (§2c). That is the register's current state —
  §8.1–§8.5 still hold the wave-1 partition while the live coverage lists wave-2 rows — and closing it
  belongs to `t18`, not to this script.
- The scratch-pack route exists because the packer has no `--out`; if lane B later lands the sanctioned
  flag, the arm should switch to it (the route string in `steps.packed` makes the switch visible).
- `immutabilityGuard: "exempt: …"` is a DECLARATION, not proof that a lane writes nothing; what keeps
  it honest is that the declaration is mandatory, is printed, and reddens when deleted (falsification b).
- Two earlier attempts to run the lane died before producing output: a nested `nohup` inside a managed
  job, then `mpd-bg run` — whose child is DETACHED, so it died with the sandbox that started it
  (T-23's exact warning; `mpd-bg run` exits 0 when it has merely STARTED the process, which is not the
  lane's exit code). Their leftovers are `extension-lifecycle-real.log` (0 bytes) and the empty dir
  `…T07-28-22.420Z/` (0 files). The run §1 quotes is `…T07-30-20.128Z/` (1,203 files), started as a
  managed background job whose log is `extension-lifecycle-run2.log`; the two share the sandbox id
  `mpd-extension-lifecycle-IyYVc0`, which is what ties that `result.json` to that log.
