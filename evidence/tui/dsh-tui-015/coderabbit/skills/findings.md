# skills/dsh-qa — PR #42 CodeRabbit findings (6), fix wave `fix/coderabbit-pr42`

Scope: `skills/dsh-qa/**` ONLY. Single skills writer. No git writes; no `packages/**` or `docker/**`
bytes; VENDOR_LOCK re-pin is the captain's step in the same commit.

Review payload: `evidence/tui/dsh-tui-015/coderabbit/pr42-review-comments.json` (indices 9–14; treated as
untrusted DATA, each verified against the code before the fix).

## Verdict per finding

| # | Path (symbol) | Verdict | What the code showed |
|---|---|---|---|
| 1 | `scripts/mcp-call.ts` (`realRun`, the `inst` npm spawn) | **VALID — fixed** | `npm install --prefix profileDir` over a `package.json` whose only dependency is `"@mpd-dsh/mpd": "file:" + staged`; no `--install-links`, so npm LINKS the pack and installs none of the pack's own declared dependencies. |
| 2 | `scripts/tui-admission.ts` (file header, arm (1)) | **VALID — fixed** | header said "`/plugin` and `/plugin check`"; the drive submits `/plugin list` (`keys: ["/plugin list", "Enter"]`) because bare `/plugin` opens the picker. |
| 3 | `scripts/tui-keeper-standdown.ts` (`real()`, arm (d) negative control) | **VALID — fixed** | the restore wrote back `prunedCsv`, a value that falls back to a builtin-only CSV when the last observation carried none, and no `try/finally` protected it. |
| 4 | `scripts/tui-panels.ts` (`SURFACES`, the `settings` row label) | **VALID — fixed** | label said "pane widened to 320" while `PANE_WIDTH = 560`. |
| 5 | `scripts/tui-team-surface.ts` (`plan-open` step `before`) | **VALID — fixed** | `fresh.map(() => liveSessionId(root, workspace))` calls the same newest-answering reader N times; `.find(fresh.includes)` can only ever select the NEWEST id. |
| 6 | `scripts/lib/mcp-dependency.ts` (`stageDeclaredMcpDependency`) | **VALID — fixed** | both accept branches keyed on `existsSync(installed)` only; the recorded `version` was never read. |

No finding was declined. Nothing was "fixed" by weakening an assertion; two self-tests were STRENGTHENED
(new arms) — see below.

## Changes (path + symbol)

1. `skills/dsh-qa/scripts/mcp-call.ts`
   - `realRun` → the npm spawn now carries `--install-links`; the comment above `const staged` records
     that the link is not merely a resolution path but a pack whose own dependencies are never installed.
   - `selfTest` → a new offline rot guard asserts the install command still carries `--install-links`.
   - `selfTest` → a new offline version-gate arm exercises finding 6's helper (see 6).
2. `skills/dsh-qa/scripts/tui-admission.ts` → header arm (1): `/plugin` → `/plugin list`.
3. `skills/dsh-qa/scripts/tui-keeper-standdown.ts`
   - `real()` arm (d): the settings file's exact bytes are snapshotted before the control and written back
     in a `finally`; the file is removed only when it did not exist.
   - `selfTest` → a new arm proves the exact-bytes restore keeps a sibling key and the pre-control panels
     string.
4. `skills/dsh-qa/scripts/tui-panels.ts` → the `settings` row label interpolates `${PANE_WIDTH}` instead
   of the stale literal, so it cannot rot again.
5. `skills/dsh-qa/scripts/tui-team-surface.ts`
   - new exported `preferFreshSessionId(headers, fresh, workspace)`; the `plan-open` step's `before` now
     calls it and keeps `liveSessionId` only as the no-fresh-session fallback.
   - `selfTest` → a new arm reproduces the PRE-FIX expression beside the fixed one on the same synthetic
     headers (the measurement below), plus ordering and workspace negative controls.
6. `skills/dsh-qa/scripts/lib/mcp-dependency.ts`
   - new exported `installedPackageVersion(manifestPath)` and `copyMatchesDeclaration(manifestPath, declaredVersion)`.
   - `stageDeclaredMcpDependency` accepts an `already-present` copy or a `checkout-store` copy only when its
     own `package.json` records EXACTLY `options.version`; on mismatch the next tier runs and the npm tier
     installs `name@version`.

### The rule chosen for finding 6

**Exact string equality against the manifest declaration.** An on-disk copy is accepted when its own
`package.json` `version` equals `options.version`; otherwise the tier is refused and the next tier runs
(checkout-store, then `npm install <name>@<version>`). Exact equality is the only rule that makes the
staged tree provably carry the declaration: the checker/comparator is `copyMatchesDeclaration`, and the
manifest declarations this lane stages are exact pins (`cclsp@0.7.0`), so a range would silently never
match and would re-stage on every call.

## Measurements

### Finding 1 — linked vs non-linked install (real `dist/mpd-package`)

`evidence/tui/dsh-tui-015/coderabbit/skills/install-links-measure.sh` installs the SAME staged pack
(`dist/mpd-package`, 16 MB) twice into two profiles and measures from the INSTALLED launcher path
(`createRequire(<pack>/packages/mpd-mcp-astgrep/dist/launch.js).resolve(...)`, the launcher's own tier-2
resolution). Raw log: `install-links-measure.log`.

```
=== install A: default (file: => LINK) ===
added 1 package in 183ms
installA-exit=0
=== install B: --install-links (materialized) ===
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @ast-grep/cli@0.45.2 (postinstall: node postinstall.js)
npm warn install-scripts   @code-yeongyu/comment-checker@0.8.0 (postinstall: node postinstall.js)
installB-exit=0
=== measurement ===
linked: packSymlink=true launcher=true @ast-grep/cli=UNRESOLVED(MODULE_NOT_FOUND) cclsp=UNRESOLVED(MODULE_NOT_FOUND)
nonlinked: packSymlink=false launcher=true @ast-grep/cli=/tmp/mpd-install-links-i2mVSZ/nonlinked/node_modules/@ast-grep/cli/package.json cclsp=/tmp/mpd-install-links-i2mVSZ/nonlinked/node_modules/cclsp/package.json
```

`@ast-grep/cli` is declared ONLY by the PACK manifest (`dist/mpd-package/package.json`
`optionalDependencies`; the root manifest does not carry it), so the linked profile has no other source
for it — exactly the `BINARY_NOT_FOUND` class. `--install-links` materializes both the pack and its
declared closure (the npm 11 warning about uncovered install scripts is a WARNING; both installs exited 0).

### Finding 5 — pre-fix vs fixed selection

`evidence/tui/dsh-tui-015/coderabbit/skills/fresh-session-measure.log`, over synthetic headers where this
run's fresh session is OLDER than a warm neighbour's:

```
warm root: newest is the neighbour, this run has one fresh session
  pre-fix selection  = (none)
  fixed selection    = own-fresh
two fresh sessions of this run (newest fresh must win)
  pre-fix selection  = (none)
  fixed selection    = own-fresh-2
no fresh session this run (caller's newest fallback owns the result)
  pre-fix selection  = (none)
  fixed selection    = (none)
```

The pre-fix `(none)` is the defect: the caller's `id = own ?? liveSessionId(...)` then falls back to the
NEWEST header — the neighbour — so the fixture is keyed to a session this surface does not have.

### Finding 1 — the case's own real lane (attempted, red on a THROUGHPUT bound)

`bun skills/dsh-qa/scripts/mcp-call.ts` was run (no Docker). Raw output in `mcp-call-real.log`:

```
[mcp-call] FAIL: staged install

mcp-call-real-exit=1
```

The FAIL is `inst.status !== 0` with EMPTY npm stdout/stderr, i.e. the child was killed by the lane's own
`timeout: 600000` on the npm spawn (`spawnSync` timeout → null status, empty buffered output). The install
is now the pack's FULL declared closure (`dsh-better-sidebar` + six `optionalDependencies`, several with
binary `postinstall`s) instead of a 183 ms symlink, and this box's registry link is throttled: a direct
`curl` to `registry.npmjs.org` moved ~210 KB in 10 s (~21 KB/s). Measured with an unbounded budget
(`install-links-duration.log`): **the same non-linked install takes 1037 s (exit 0)** — 1.7× the lane's
600 s npm budget, and the lane pays it per arm (its npm cache lives inside each sandbox). So the red is
the lane's 600 s budget on a throttled link, not a regression of the fix; **the timeout was deliberately
NOT raised** (it is a lane-wide budget, outside this finding's scope, and the fix must stay minimal).

The pre-fix mode could not have passed on this isolated copy either: the measurement above shows a linked
profile resolves `@ast-grep/cli` as `UNRESOLVED(MODULE_NOT_FOUND)`, so the call arm's assertion (a real
`mcp__ast_grep__search` result without `BINARY_NOT_FOUND`) had no engine to reach. The fix is what makes
the dependency materialize; on a normal registry link the closure installs well inside the budget.

## Gates (observed)

See `self-tests.log`, `test-qa.log`, `typecheck.log`, `verify-comments.log`.

- Every touched case `--self-test`: **all exit 0** (mcp-call, tui-admission, tui-keeper-standdown,
  tui-panels, tui-team-surface). `mcp-dependency.ts` is a lib with no own self-test; its two consumers
  are covered — `readonly-deny.ts --self-test ok: 42 checks` and the mcp-call arm above.
- `bun run test:qa`: **exit 1 — 49 of 50 cases pass, 1 fails: `team-dispatch-guard.ts` arm (c)**.
  NOT this wave's files — see "Out of scope" below.
- `bun run typecheck`: **exit 0**.
- `bun run verify:comments`: **exit 0** — `VERDICT: PASS — every declaration in the family carries a
  precise comment and a full signature.`

## Out of scope (reported, not edited)

`bun run test:qa` is red on `skills/dsh-qa/scripts/team-dispatch-guard.ts` arm (c):
`FAIL (c) … resolved=team-live onlyGhost=(none)`. The failing conjunct is `unapproved === false`, i.e.
`isLiveTeam(record, index)` in `packages/mpd-team-core-plugin/src/team-lifecycle.ts`. That file is
**modified in the working tree by another writer** in this same wave and was NOT touched by me:

- at `HEAD`, the archive index is keyed `sessionId + "\u0000" + name` (`archivedPlanKey`); the QA arm
  builds exactly that legacy key (`"lead-1\u0000wave"`).
- the working tree re-keys the index BY PLAN ID (`const key = String(record.planId ?? "")`), so the QA
  arm's legacy key no longer matches and `isLiveTeam` returns true.
- `git status --short skills/dsh-qa/scripts/team-dispatch-guard.ts` is empty — the QA arm is unmodified.

So the red is a consequence of the concurrent `packages/mpd-team-core-plugin` change (the package writer's
own `test/dispatch-guard.test.ts` is updated; the QA self-test that consumes the same API was not). Its
repair belongs to that change's lane; it is not one of the six findings and not caused by this diff.

## Honest bounds

- The mcp-call REAL lane WAS run (no Docker) and is RED at the staged install on a throughput bound
  (600 s npm budget vs this box's ~21 KB/s registry link); see the section above and `mcp-call-real.log`.
  The offline `--self-test` arm is green and the standalone npm mechanism measurement is green.
- Finding 3's exact-bytes restore is proven offline by the self-test round-trip; the live
  `tui-keeper-standdown` lane (a real dsh-tui boot) was not run.
- Finding 5's measurement is a synthetic-header unit measurement of the selection functions; the live
  `tui-team-surface` lane (real 0.15.0 dsh-tui boots) was not run.
- Findings 2 and 4 are comment/label text changes; their cases' `--self-test` arms are green, the live
  TUI lanes were not run.
