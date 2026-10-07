# R5 terminal-silence — test-arm repairs (2) + the `StderrRebind` doc-vs-code fix

UTC start: 2026-10-02T15:57:44Z · last write before the gate sweep ≈2026-10-02T16:00:30Z ·
repo root `/home/haroldzhao/MyProj/DshProj/My-Power-Dsh`
No `git` command was run in this session (the captain is the only git writer).
Toolchain: **pinned bun 1.4.0** (`.toolchain/node_modules/.bin/bun`) for every `bun` command below;
the `bun` on `PATH` is 1.4.2 and was NOT used.

## 1. ITEM 1 — the 6 remaining "F1" arms

### 1.1 Where the lines actually land (a fact that refines the task text)

The task named `<sandbox>/.mpd/logs/mpd-dsh-adapter.log`. These two rows do **not** write there:
both pass their OWN `warn` into `createLazyDshAdapter` (`mpd-ext/src/index.ts`:
`createLazyDshAdapter(ctx, { label: "mpd-ext", warn })`; `mpd-roles/src/index.ts`:
`{ label: "mpd-roles", warn: adapterWarn }`), and the producer is
`(options.warn ?? (text) => rowLogLine("mpd-dsh-adapter", …))` — so with a caller `warn` the
`rowLogLine` row name is the ROW's own. Measured with the real `apply` (probe source quoted in §1.4):

```
SANDBOX /tmp/probe-ext-3OXnER
FILE <sandbox>/.mpd/logs/mpd-ext.log
[2026-10-02T15:58:25.054Z] [mpd-ext] ADAPTER FALLBACK (adapterIdentity=fallback:createDshAdapter): mpdDsh is not provided …
[2026-10-02T15:58:25.057Z] [mpd-ext] mpdExtensions provided (apiVersion 1) | adapterIdentity=fallback:createDshAdapter | tools: …
```

and for roles (`fallback+logger` / `fallback+no-logger` / `mounted+logger`), same file naming:

```
FILE <sandbox>/.mpd/logs/mpd-roles.log
[mpd-roles] ADAPTER FALLBACK (adapterIdentity=fallback:createDshAdapter): …
[mpd-roles] team plane: readOnlyGuard=absent reason=no-guard-seam rosterSection=agent-scoped order=605 sessionGate=advisory
[mpd-roles] mpdRoles provided (base roles: 11) | adapterIdentity=fallback:createDshAdapter
```

So each helper reads back **its own row log** (`mpd-ext.log`, `mpd-roles.log`) — the same pattern the
prior pass used, with the row name corrected to the row that emits. `MPD_MCP_LOG_DIR` **and**
`DSH_WORKSPACE_ROOT` are both pinned to the sandbox; the load-bearing one is `DSH_WORKSPACE_ROOT`
(`rowLogLine` resolves `workspaceRootOf(undefined)`), and pinning both removes any ambient override.

### 1.2 Per-file edits (test-only; no `src` change)

| File | Edit |
|---|---|
| `packages/mpd-ext-plugin/test/adapter-identity.test.ts` | imports +`statSync`; new `appendedAfter(file, offset)` and `inRowLog(row, run)` (sandbox `mkdtemp`, pin both env keys, mark `<sandbox>/.mpd/logs/<row>.log` byte offset, run, read appended lines, restore env + `rmSync` in `finally`); header comment names the R5 destination; `FakeCtxOptions.logger` doc "reaches stdout" → "reaches the ROW LOG"; **3 arms rewritten** |
| `packages/mpd-roles-plugin/test/adapter-identity.test.ts` | same helper pair (sandbox prefix `mpd-roles-rowlog-`), same header/doc correction, **3 arms rewritten**; the three callbacks became `async` to await the helper |

Arms, before → after (nothing weakened; the R5 invariant is ADDED to each):

| Arm | Was asserted | Now asserted |
|---|---|---|
| fallback "warns exactly ONCE …" | stdout fallback lines `=== 1`, logger `=== 1`, line contains `adapterIdentity=fallback:createDshAdapter`, tool registration | **same four assertions** on the ROW LOG + logger, **plus** `expect(stdout.lines).toEqual([])` |
| fallback "…no logger" | stdout fallback lines `=== 1` | row-log fallback lines `=== 1`, `fake.warnings` `=== []` (no logger present), `stdout.lines === []`; title renamed `reaches stdout` → `reaches the row log` (nothing else in the repo pins that title — grep, excluding `evidence/`, returned no hit) |
| healthy "emits NO warning …" | stdout fallback `[]`, logger fallback `[]`, stdout identity lines `=== 1` containing `adapterIdentity=mounted:mpdDsh` / not `fallback:`, service field | **same four assertions** on the ROW LOG, **plus** `stdout.lines === []` |

The identity line is still counted per sink and still `toHaveLength(1)`-style asserted — on the row
log, where R5 put it.

### 1.3 Results (before → after, same 6 files / 133 tests)

```
# before-two-packages.log
 127 pass
 6 fail
 1215 expect() calls
Ran 133 tests across 6 files. [1.96s]          exit=1

# final-two-packages.log (after the last write, settled)
 133 pass
 0 fail
 1235 expect() calls
Ran 133 tests across 6 files. [1.96s]          exit=0
```

The 6 pre-fix failures were `Expected: 1 / Received: 0` at
`mpd-ext-…:167`, `:204`, `:227` and `mpd-roles-…:124`, `:159`, `:182` — exactly the stdout reads.
Per-file runs: `ext-only-1.log` 9 pass / 0 fail · `roles-only-1.log` 8 pass / 0 fail.

### 1.4 Probe sources (reproduce the two facts above)

```ts
// probe-ext: which row log does apply() write?
const sandbox = mkdtempSync(join(tmpdir(), "probe-ext-"))
process.env.MPD_MCP_LOG_DIR = sandbox; process.env.DSH_WORKSPACE_ROOT = sandbox; process.env.HOME = mkdtempSync(…)
await apply(fakeCtxWithNoMountedAdapter)
for (const f of walk(sandbox)) console.log("FILE", f.replace(sandbox, "<sandbox>"), readFileSync(f, "utf8"))
// probe-roles: the same, in three shapes (fallback+logger, fallback+no-logger, mounted+logger)
```

## 2. ITEM 2 — `StderrRebind` doc now states what the code returns

`packages/mpd-mcp-shared/log-sink.ts`, doc comment only (the union is untouched — no code change):

* `"skipped"` — **the contradiction**: it claimed `Never attempted: there is no log file (ring mode),
  or a caller disabled it.` The implementation reports `"disabled"` for BOTH caller opt-outs
  (`if (options.rebindStderr ?? envBag.MPD_MCP_STDERR_REBIND !== "0") … else setRebindOutcome("disabled")`).
  Now: `Never attempted: there is no log file to rebind onto (ring mode), or no capture was installed.`
* `"disabled"` — was `Turned OFF by MPD_MCP_STDERR_REBIND=0 …`; now names BOTH spellings of the
  caller opt-out (`MPD_MCP_STDERR_REBIND=0` in the sink's env bag **or** `rebindStderr: false`), quotes
  the guard `options.rebindStderr ?? env.MPD_MCP_STDERR_REBIND !== "0"`, and records that ONLY the
  descriptor layer is skipped (the writer-based capture stays installed).

**Outcome-list completeness — a count correction, not a shortcut.** The task said "the five outcomes";
the union has **SIX** literals (`rebound`, `unsupported`, `disabled`, `not-lowest`, `failed`,
`skipped`). I kept the list COMPLETE rather than trimming it to five (completeness was the stated
requirement, and changing code to match prose is forbidden). Nothing else in the repo pins a count of
this union (grep for "five outcomes" in `packages/mpd-mcp-shared`, `docs/`, `agent-references/` → no hit).

Every changed clause was verified against the running implementation, fd-2-safely:

```
$ .toolchain/node_modules/.bin/bun run probe-rebind.ts
rebindStderr:false -> disabled                              # the option opt-out (new doc claim)
openLogSink (no capture installed) -> skipped               # no capture => rebindNow() is a no-op
ring mode (file === null) -> skipped                        # the thunk returns before any fd work
```

and the env opt-out arm is covered by the suite itself
(`log-sink.test.ts`: `expect(sink.stderrRebind()).toBe("disabled")` for
`env: { MPD_MCP_STDERR_REBIND: "0" }`):

```
$ .toolchain/node_modules/.bin/bun test ./packages/mpd-mcp-shared
 25 pass / 0 fail / 70 expect() calls — Ran 25 tests across 2 files.
```

## 3. Dist rebuilding (a comment-only `src` change still fans out)

`grep -rn "mpd-mcp-shared/log-sink" packages/*/src/` → exactly TWO direct importers, each with one
dist entry:

```
packages/mpd-codegraph-plugin/src/index.ts:11,12   import { openLogSink } / import type { LogSink }
packages/mpd-dsh-adapter-plugin/src/index.ts:33,34 import { openLogSink } / import type { LogSink }
```

The four other `log-sink` consumers are package-root `launch.ts` files (mpd-mcp-astgrep/gitbash/lsp/
codegraph) that node runs from SOURCE with type stripping — no dist, out of this fan-out.

Rebuilt BOTH, repo root, path-qualified args, pinned toolchain:

```
$ .toolchain/node_modules/.bin/bun build packages/mpd-codegraph-plugin/src/index.ts --target node --format esm --outfile packages/mpd-codegraph-plugin/dist/index.js
Bundled 4 modules in 6ms   index.js  59.63 KB  (entry point)
$ .toolchain/node_modules/.bin/bun build packages/mpd-dsh-adapter-plugin/src/index.ts --target node --format esm --outfile packages/mpd-dsh-adapter-plugin/dist/index.js
Bundled 3 modules in 5ms   index.js  59.26 KB  (entry point)
```

Byte-identical before/after (expected: the emitter ERASES comments, so a doc-only edit cannot change
emitted bytes) — and unchanged again after the whole test run (`dist-hashes.log`):

```
86a96bf0a50b1779606410e7e55c2a3658cc651fcde25efeec0233299d97fa50  packages/mpd-codegraph-plugin/dist/index.js
9397f95fd33dfbe56ce99873e6a4aaa370b08981526262253f5ec8d13ab4c92d  packages/mpd-dsh-adapter-plugin/dist/index.js
```

The sha-pinned prebuilt `packages/mpd-mcp-codegraph/dist/serve.js` (a NOT COVERED file) does **not**
embed the sink: `grep -c "stderrRebind\|MPD_MCP_STDERR_REBIND"` → `0`. No hidden stale dependent.

## 4. Gates

```
$ .toolchain/node_modules/.bin/bun run verify:comments            # exit 0
scanned 376 TypeScript file(s) of 376 in the source set; inspected 29676 declaration(s); skipped 13892 inline callback(s) as out of family
VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.
```

```
$ node scripts/verify-dist-fresh.ts                               # exit 0
[verify-dist-fresh] build toolchain: bun 1.4.0 from the repository toolchain (.toolchain/node_modules/.bin/bun) · recorded buildToolchain bun@1.4.0
[verify-dist-fresh] NOT COVERED (7) — committed dist files no target maps to, listed so nothing is silently skipped: …
[verify-dist-fresh] ok: 24/24 targets fresh (each rebuilt twice, byte-identical) — 7 NOT COVERED files listed — 508ms
```

```
$ .toolchain/node_modules/.bin/bun run typecheck                 # exit 1 — the 4 PRE-EXISTING errors only
skills/programming/scripts/typescript/check-no-excuse-rules.ts(36,31): error TS2307: Cannot find module 'typescript/unstable/ast' …
skills/programming/scripts/typescript/check-no-excuse-rules.ts(39,34): error TS2307: Cannot find module 'typescript/unstable/async' …
skills/programming/scripts/typescript/check-no-excuse-rules.ts(41,34): error TS2307: Cannot find module 'typescript/unstable/ast' …
skills/programming/scripts/typescript/check-no-excuse-rules.ts(265,47): error TS7006: Parameter 'm' implicitly has an 'any' type.
# grep -c "error TS" → 4; every error is in that one untouched file → ZERO errors in any touched file
```

## 5. Settled hashes (`hash-window.log`)

Read twice across a 52 s window with the contract (both suites) re-run in between; identical both
times — so the tree did not move under the verification:

```
T1 2026-10-02T16:01:10Z / T2 2026-10-02T16:02:02Z  (identical)
91c30070cd6a9a7414ae895e66cb6d5056008076b6859382b6ea5440c6571c0c  packages/mpd-ext-plugin/test/adapter-identity.test.ts
78243ebcc46e4556177cd6c114df583eadc75d4fbfde46cba5f56978e64dfc3e  packages/mpd-roles-plugin/test/adapter-identity.test.ts
9e68824641b98b646e0b554a6dfdaf77f75bed62af2028582716486bda3d1dc6  packages/mpd-mcp-shared/log-sink.ts
```

No `src` other than `log-sink.ts` was edited; no `dist/**` was hand-edited (both dists are build output
of the canonical command above and were byte-identical to their inputs).

## 6. Evidence files

`before-two-packages.log` · `after-two-packages.log` · `final-two-packages.log` · `ext-only-1.log` ·
`roles-only-1.log` · `mcp-shared-after.log` · `final-mcp-shared.log` · `verify-comments.log` ·
`verify-dist-fresh.log` · `typecheck.log` · `dist-hashes.log` · `hash-window.log`

## 7. Uncertain / not verified

* The task's `<sandbox>/.mpd/logs/mpd-dsh-adapter.log` is not the file these two rows write (§1.1);
  I used the rows' own logs. If some other consumer expects an `mpd-dsh-adapter.log` line from these
  two rows, that is a `src` question this test-only lane did not touch.
* Two arms per file still call `captureStdout()` without asserting on it (the `mpdExtensions`/
  `mpdRoles` service-field arm and the "tools registered THROUGH the mounted adapter" arm). They pass
  and were outside the 6-arm scope; their captures are now dead weight rather than an assertion.
* `log-sink.ts`'s `MutableSink.setRebindOutcome` doc still says "(the `MPD_MCP_STDERR_REBIND=0`
  opt-out, and nothing else)". Under the mechanism reading ("nothing else is recorded without running
  the rebind") it stays true, and `rebindStderr:false` funnels through that same single call site — so
  I left it, deliberately, to keep the diff to the one contradiction the task named.
* `verify-dist-fresh`'s 7 NOT COVERED files remain unverified by that gate (pre-existing class); only
  `mpd-mcp-codegraph/dist/serve.js` was relevant here and was checked by hand (§3).
* The pre-existing 4 typecheck errors (§4) were not investigated — out of scope, unchanged by this lane.
