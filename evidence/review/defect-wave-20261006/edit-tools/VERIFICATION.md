# Branch 2 — `fix/edit-tools`: VERIFICATION record (E1–E8)

Verifier: Senior Engineer (delegated). Branch: `fix/edit-tools` @ `82f7663e` + the interrupted writer's
uncommitted diff. Every fix below was treated as a CLAIM and re-tested, not trusted.

**Spec note — the binding spec file is MISSING.** This record was to be driven by
`evidence/review/defect-wave-20261006/FINDINGS.md`. That file **does not exist on disk**; the directory
holds only `edit-tools/interrupted-run.patch`, `team-plane/PR-BODY.md` (a DIFFERENT branch, findings
T1–T7) and `gate-sweep.log.pid`. E1–E8 were therefore worked from the finding text in the task
statement. A repo-wide search found no other `FINDINGS.md` for this wave.

## Method

The writer left no verification record, so each finding was driven **PIN → RED → GREEN**:
the on-disk fix was temporarily reverted to its pre-fix expression, the regression test was run and the
failure text captured, then the fix was restored **byte-for-byte** (verified by `diff` against a
pre-revert snapshot) and re-run to green. All eight fixes were found already present and CORRECT; none
was REFUTED and none needed rewriting.

Snapshot discipline: `/tmp` is wiped between bash calls (AGENTS.md T-23), so snapshots were kept in the
gitignored `.mpd/et-verify/` and removed after use. Final `diff` against every snapshot: **identical**.

## Per-finding ledger

| # | Status | Fix shape (one line) | Test that pins it | RED observed |
|---|---|---|---|---|
| E1 | **FIXED** | `mpd-tools-plugin/src/index.ts#sessionTarget` resolves a relative `file_path` via `dsh.workspaceRoot(exec)`; the guard probes `target`, not `fp` | `write-guard resolves a RELATIVE file_path against the session workspace, not process.cwd()` | `Expected to contain: "use the edit tool"` / `Received: ""` |
| E2 | **FIXED** | `#apply` truncation: `tailChars = Math.max(1, Math.floor(budget * 0.3))`, so `-0 === 0` can no longer make `slice(-0)` return the whole text | `truncation near the banner-length boundary never inflates the output` | `maxBytes=75` — `Expected: <= 75` / `Received: 100074` |
| E3 | **FIXED** | `src/vendor/diff-utils.ts#generateUnifiedDiff` uses `-1` as the unset sentinel for `aStart`/`bStart`, so line index 0 is legal | `unified diff hunk header names line 1 when the hunk starts at the head of the file` | `Expected to contain: "@@ -1,4 +1,4 @@"` / `Received: "--- f.txt\n+++ f.txt\n@@ -2,4 +2,4 @@\n-a\n+A\n b\n c\n \n"` |
| E4 | **FIXED** | `src/index.ts#sourceLineCount` is the ONE count; read / format / edit all call it (view-based `split("\n")` counts retired) | `read, format and edit report the same source-line count for a terminated file` | `Expected: 2` / `Received: 3` |
| E5 | **FIXED** | `#readEnvelope` + `restoreFileText` wired into `#editFile`'s read AND write-back, so the BOM/CRLF envelope survives an anchored edit | `an anchored edit keeps a CRLF file's line endings and a BOM file's BOM` (+ the BOM probe below) | CRLF arm: `Expected "alpha\r\nBETA\r\n"`, received LF-only. BOM arm (probe): `"alpha\nBETA\n"`, `BOM preserved: false` |
| E6 | **FIXED** | `mpd-memory-plugin/src/index.ts#mpd_memory_reflect_complete` throws unless `triggered === true \|\| reservation.status === "pending"` — the exact predicate `mpd_memory_reflect` reports `due` under | `mpd_memory_reflect_complete refuses when no reflection is due or reserved` | `Expected to contain: "no reflection is due"` / `Received: "RESOLVED: the completion was recorded"` |
| E7 | **FIXED** | `mpd-boulder-plugin/src/index.ts#planPathFor` resolves a relative `planPath` against the state root; `#mpd_boulder_plan_progress` reports an unresolvable one; the same resolution was applied to `mpd_boulder_status`'s `planProgress` | `mpd_boulder_plan_progress resolves a relative plan path and REPORTS an unresolvable one` | arm 1: `{completed: 1, total: 3}` expected, `{completed: 0, total: 0}` received. arm 2 (probe): `ANSWERED (silent zeroes / no error)` |
| E8 | **FIXED** | `mpd-comment-checker-plugin/src/index.ts#apply`'s `autoCheck` hook resolves `file_path` via `dsh.workspaceRoot(exec)`; a failed read is a DECLARED miss naming the resolved path | `autoCheck: the hook resolves a relative file_path against the session workspace` | `Expected to contain: "[mpd-comment-checker] comments/docstrings detected"` / `Received: "[mpd-comment-checker] auto-check skipped notes.js: ENOENT: no such file or directory, open 'notes.js'"` |

### Two RED arms that the committed tests cannot reach

Each of the E5 and E7 tests asserts its first arm before its second, so the second arm is unreachable in
a failing run. Both were driven through the REAL tool path by a throwaway probe (since removed):

- **E5 BOM arm** — with the fix reverted the edit left `"alpha\nBETA\n"` (`BOM preserved: false`, RED);
  with the fix restored `"alpha\nBETA\n"` with the BOM (`BOM preserved: true`, GREEN).
- **E7 report arm** — with the fix reverted, an unresolvable relative path answered
  `ANSWERED (silent zeroes / no error)` (RED); with the fix restored, `REFUSED` and the refusal text
  names the resolved path `<ws>/.mpd/plans/ghost.md` (GREEN).

**E8 arm 2 is DERIVED, not observed.** The test aborts at arm 1, so its `toContain(join(ws, "absent.js"))`
assertion was never reached. Under the revert the same single reverted line makes `target === "absent.js"`,
which cannot contain the session-absolute path — but that is reasoning, not a measurement.

## Corrections to the interrupted writer's work

1. **INCOMPLETE — `bun run verify:comments` was RED (exit 1), 6 violations, all introduced by this
   writer's own new tests** (a standing user-mandated gate, AGENTS.md §4). Every declaration needs a
   comment directly above it; six lacked one:
   `packages/mpd-hashline-plugin/test/tool-schema.test.ts` lines 185 (`format`), 198 (`edited`),
   214 (`read`), 215 (`edit`), 231 (`bomView`) and `packages/mpd-memory-plugin/test/memory.test.ts`
   line 139 (`complete`). **Fixed by this verification pass** — six one-line comments added, no logic
   touched. Gate now `VERDICT: PASS`.
2. Minor, left as-is: the E2 test's comment says "The banner is 74 chars for these budgets" — correct
   (measured: the RED at `maxBytes=75` gave `100074 = 100000 + 74`), so the boundary window `[74..80]`
   does bracket the real `budget ∈ {1,2,3}` region. No change needed.

## E7 scope — a sibling checked, not assumed

`mpd_boulder_start` also takes a `planPath` and still stores it RAW. That is CORRECT, not an omission:
the vendor resolves a RECORDED relative path against the state root itself
(`src/vendor/storage/path.ts#resolveTrackedPath` — `isAbsolute(p) ? resolve(p) : resolve(baseDirectory, p)`,
consumed at `src/vendor/storage/read-state.ts:231`). The new `planPathFor` mirrors that same rule for the
DIRECT caller-supplied read paths. `mpd_boulder_start` answers no silent zeros, so the finding's stated
defect class does not reach it.

## Gates — observed output

```
bun test packages/mpd-tools-plugin           10 pass  0 fail
bun test packages/mpd-hashline-plugin        14 pass  0 fail
bun test packages/mpd-memory-plugin           5 pass  0 fail
bun test packages/mpd-boulder-plugin          7 pass  0 fail
bun test packages/mpd-comment-checker-plugin  1 pass  3 skip  0 fail
node scripts/verify-dist-fresh.ts   ok: 29/29 targets fresh (each rebuilt twice, byte-identical) — 7 NOT COVERED files listed
bun run verify:comments             VERDICT: PASS — 394 files, 32320 declarations
node scripts/verify-rows-parity.ts  ok: 33 row ids match the 2-file bundle patch layer
bun run verify:docs                 pairs=45 failed=0 violations=0 dead=0 — PASS
bun run typecheck                   4 errors, ALL in skills/programming/scripts/typescript/check-no-excuse-rules.ts (pre-existing, branch 3); 0 added here
```

Rebuilt every touched package FROM THE REPO ROOT with the PINNED toolchain
(`.toolchain/bun/bin/bun --version` → `1.4.0`); `verify-dist-fresh` confirms the committed bytes.

No `git` write command was run (the captain is the only git writer). `git status --short` shows exactly
the 21 tracked files of `interrupted-run.patch` and nothing else.

## Honest bounds

- `FINDINGS.md` was absent, so E1–E8's wording came from the task statement, not the file. If that file
  exists elsewhere with different text, this record's mapping has not been re-checked against it.
- `bun run verify:typecheck`'s 4 errors are pre-existing and out of this branch's five packages.
- The E8 second assertion is derived, not measured (see above).
- No live `dsh` boot was run: every fix here is unit-level and its seam is already covered by the
  existing suite. Mount-level proof is the captain's integration step.
