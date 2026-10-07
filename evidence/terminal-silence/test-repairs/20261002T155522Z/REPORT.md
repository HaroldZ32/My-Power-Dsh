# R5 terminal-silence — test-arm repairs (four packages)

UTC start: 2026-10-02T15:55:22Z · repo root `/home/haroldzhao/MyProj/DshProj/My-Power-Dsh`
No `git` command was run in this session (the captain is the only git writer).

## 0. Constraint note

`subagent` cannot be used from this session (`Error: subagent depth 2 exceeds maxDepth 1`), so the four
units were executed directly, in one process, with the captain's own verification commands run
afterwards.

## 1. Root cause (as given, re-confirmed here)

R5 moved every MPD runtime diagnostic from `console`/stdout/stderr to
`<root>/.mpd/logs/<row>.log`. Two producers are involved in the failures:

* `rowLogLine(name, line)` in `packages/mpd-dsh-adapter-plugin/src/index.ts` — resolves its root from
  `DSH_WORKSPACE_ROOT` (fallback `process.cwd()`, **never** `MPD_MCP_LOG_DIR`; it passes explicit
  roots to the sink) and caches one sink per ROW NAME.
* the `!!js` guard snippet in `cordis.patch.yml` — its own `logGuard` mirrors the sink chain
  `MPD_MCP_LOG_DIR` -> `DSH_WORKSPACE_ROOT` -> cwd -> `os.tmpdir()`, writing
  `<root>/.mpd/logs/mpd-patch-guards.log`.

Arms that captured `console.warn`/stdout therefore observe nothing. Every repaired arm now reads the
APPENDED bytes of a sandbox-rooted row log (`mkdtempSync`); no arm reads or asserts on the repository's
own `.mpd/logs`.

## 2. Edits (7 test files, 11 arms — no `src` change)

| File | Arms repaired | Mechanism |
|---|---|---|
| `packages/mpd-dsh-adapter-plugin/test/adapter.test.ts` | 2 (`llm catalog plane`) | new `inRowLog(row, run)` helper pins `MPD_MCP_LOG_DIR` + `DSH_WORKSPACE_ROOT` to a temp sandbox, marks the byte offset of `<sandbox>/.mpd/logs/mpd-dsh-adapter.log`, runs, returns the appended lines. Asserts exactly ONE line (`toHaveLength(1)`) matching `/llmCatalog degraded/` + `/llm service is unavailable/`, resp. containing `resolveModelInfo`. The pre-existing `console.warn` spy is kept and now asserted EMPTY (R5: nothing reaches the terminal). |
| `packages/mpd-mcp-shared/log-sink.test.ts` | 1 (`capture and restore`) | the arm now exercises the real `MPD_MCP_STDERR_REBIND=0` opt-out through the documented `env` option (no `process.env` mutation) instead of the `rebindStderr:false` option, and asserts the documented outcome `"disabled"` (the implementation reports `"disabled"` — `log-sink.ts` line ~619 — and never `"skipped"` for a caller-disabled rebind). Writer-layer assertions are unchanged: `process.stderr.write`/`console.log` replaced and all four lines land in the log. |
| `packages/mpd-bundle-plugin/test/sidebar-guard-profile-dir.test.ts` | 4 (`sidebar mount guard: profile-dir derivation`) | `decide()` still returns `{disabled, warnings}` so all four arms keep their original assertions; internally it now pins `MPD_MCP_LOG_DIR` to the file's existing temp `SANDBOX`, marks the byte offset of `<SANDBOX>/.mpd/logs/mpd-patch-guards.log`, and returns the appended text. The vacuous-looking negative arm gained the positive `toContain("ENABLED")` first. |
| `packages/mpd-team-watchdog-plugin/test/support.ts` | — (helper) | new exported `captureRowLog(workspace)` (`RowLogCapture`: `appended()` / `restore()`), same pin + offset + append-read discipline. |
| `packages/mpd-team-watchdog-plugin/test/failsafe.test.ts` | 2 (AC-15) | read `log.appended()` for `tick threw 1 time(s)` and `heartbeat write failed at`; `console.warn` capture kept and asserted EMPTY. |
| `packages/mpd-team-watchdog-plugin/test/scene.test.ts` | 1 (`unwritable scene location`) | reads `scene write failed at` out of `log.appended()`; `console.warn` capture kept and asserted EMPTY. |
| `packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts` | 1 (T-18 RED control — a *4th*, non-console failure) | `scratchWatchdogSrc()` now also mirrors `packages/mpd-mcp-shared` at the same relative depth. R5 added `import … from "../../mpd-mcp-shared/log-sink"` to the adapter, so the scratch tree failed to load with `Cannot find module '../../mpd-mcp-shared/log-sink'`. No assertion was relaxed. |

Touched-file hashes (sha256; read twice across the settled window and identical both times —
first read before 2026-10-02T15:57:03Z, re-read at 2026-10-02T15:57:12Z, with the four-package suite
re-run green in between):

```
30e1a6c2ad7bfed64412d1b614625e2d7d9e4722e6d1af0c0c4b3019cb7289bb  packages/mpd-dsh-adapter-plugin/test/adapter.test.ts
d1ad6bbf45c3eb640289ce9059d1c064802debc07cc73741b2c2418529da41d6  packages/mpd-mcp-shared/log-sink.test.ts
c18ba06f3ebe00664aa7cbe44fa4b9bba544844aa6a0cbec81346393fef37561  packages/mpd-bundle-plugin/test/sidebar-guard-profile-dir.test.ts
f7cfa6b17b9c970faf2e919c54e857de23f7cf4a24e254179fada490eff2c452  packages/mpd-team-watchdog-plugin/test/failsafe.test.ts
fb561305ddec42a51c6513fdcfe3f2f56acf99890315bae42eea192dda754120  packages/mpd-team-watchdog-plugin/test/scene.test.ts
efb25891cdaec7ab45850a700856cebf6608333021efc2b228c479ba436b1ed3  packages/mpd-team-watchdog-plugin/test/support.ts
e3d6596852ae18ca84118a0f36c9bb74100073679d73bed380cfb794d07c83a9  packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts
```

## 3. Test results (before -> after)

| Package | Before | After | Log |
|---|---|---|---|
| `mpd-dsh-adapter-plugin` | 168 pass / 2 fail (170 tests) — observed | **170 pass / 0 fail** | `pkg-mpd-dsh-adapter-plugin-after.log` |
| `mpd-bundle-plugin` | 99 pass / 4 fail (103 tests) — derived\* | **103 pass / 0 fail** | `pkg-mpd-bundle-plugin-after.log` |
| `mpd-team-watchdog-plugin` | 137 pass / 4 fail (141 tests) — observed | **141 pass / 0 fail** | `pkg-mpd-team-watchdog-plugin-after.log` |
| `mpd-mcp-shared` | 24 pass / 1 fail (25 tests) — derived\* | **25 pass / 0 fail** | `pkg-mpd-mcp-shared-after.log` |
| all four together | 260 pass / 9 fail (269 tests) across the three non-mcp packages — observed | **439 pass / 0 fail, 31 files** | `four-packages-after.log` |

\* derived from the observed combined pre-fix run (`260 pass / 9 fail`, `Ran 269 tests across 22 files`)
plus each package's unchanged post-fix test count (103 + 25 + 141 = 269) and the printed failure list
(4 sidebar arms + 1 stderrRebind arm + 3 AC-15/scene arms + 1 T-18 arm). The adapter's `168 pass / 2 fail`
and the watchdog's `137 pass / 4 fail` were measured directly before any edit.

Settled re-run after the last write (2026-10-02T15:57:03Z, same four paths): `439 pass / 0 fail`
(`2960 expect() calls`, `Ran 439 tests across 31 files`).

## 4. Gates

* `bun run typecheck` → exit 1, and the ONLY errors are the 4 pre-existing ones under
  `skills/programming/scripts/typescript/check-no-excuse-rules.ts` (TS2307 x3, TS7006 x1). Zero errors
  in any touched file. Log: `typecheck.log`.
* `bun run verify:comments` → `VERDICT: PASS — every declaration in the family carries a precise comment
  and a full signature.` exit 0. Log: `verify-comments.log`.
* `node scripts/verify-dist-fresh.ts` → `ok: 24/24 targets fresh (each rebuilt twice, byte-identical) —
  7 NOT COVERED files listed`, exit 0. No `src` was edited, so no rebuild was needed.
  Log: `verify-dist-fresh.log`.

## 5. OUT-OF-SCOPE FINDING (not fixed on purpose)

The task map said the remaining "F1" arms live "in this package's suite" (the adapter package).
**They do not.** `bun test ./packages/mpd-dsh-adapter-plugin` is fully green and reports no F1 arm.
The F1 arms live in two packages that are NOT among the four in scope, and the scope line forbids
touching "any other package":

```
packages/mpd-ext-plugin/test/adapter-identity.test.ts    3 fails
packages/mpd-roles-plugin/test/adapter-identity.test.ts  3 fails
```

Same R5 causation, verified: those arms read captured STDOUT and filter for `"ADAPTER FALLBACK"` /
`"adapterIdentity="`, while the producer is `createLazyDshAdapter`'s `warning` helper
(`packages/mpd-dsh-adapter-plugin/src/index.ts`), which now routes to
`rowLogLine("mpd-dsh-adapter", …)` unless a caller overrides it via `options.warn`. Failure shape:
`Expected: 1 / Received: 0`. The adapter package's own T-50 arms pass because they inject
`warn: (line) => lines.push(line)`.

Remediation for a follow-up lane (same pattern as this report, no `src` change): in each
`adapter-identity.test.ts`, pin `DSH_WORKSPACE_ROOT` (and `MPD_MCP_LOG_DIR`) to a temp sandbox, mark the
byte offset of `<sandbox>/.mpd/logs/mpd-dsh-adapter.log`, run `apply(fake.ctx)`, and assert the appended
lines — `fallbackWarnings(appended) === 1` naming `adapterIdentity=fallback:…`, and for the healthy arm
exactly ONE `adapterIdentity=mounted:mpdDsh` line and zero fallback lines (the healthy arm's only other
expectation is the `mpdRoles.adapterIdentity` service field, which still passes).

## 6. Other full-suite noise (pre-existing, not caused by these edits)

A bare repo-root `bun test` (AGENTS.md §4 sanctions `bun test` **per package**) also discovers the
`*.test.ts` files frozen inside `evidence/**` scratch/packed copies: 13 further fails and all 8 errors
come from those stale copies (`Cannot find module 'typescript/package.json'`, `Cannot find module
'./sanitize.js'`, a packed tree pointing at `/root/dshProj/my-power-dsh/...`, and the `visual-qa` cli
arm "without Bun on PATH"). Full log: `full-bun-test-after.log` (1605 pass / 3 skip / 19 fail / 8 errors,
exit 1). None of those files was edited by this session.

## 7. Uncertain / not verified

* The `evidence/**` and `skills/**` failures above were NOT repaired (out of scope) and were not proved
  pre-existing by a before/after run of the full suite; they are attributed by file location and failure
  mode only.
* The "before" counts marked *derived* in §3 were not captured as raw logs before the edits landed.
* `log-sink.ts`'s `StderrRebind` doc for `"skipped"` still contains the clause "or a caller disabled it",
  which contradicts the implementation (a caller-disabled rebind is reported `"disabled"`, as its own
  comment at the opt-out states). Left untouched: `src` changes would invalidate a dist, and the runtime
  defect is only in the doc clause.
* The repository's own `.mpd/logs/*` files are still appended to by UNTOUCHED arms in these packages
  during a test run (observed mtimes 2026-10-02 23:55–23:56 local). The repaired arms provably do not
  write there: they assert content read back from their sandbox file, which would fail otherwise.
