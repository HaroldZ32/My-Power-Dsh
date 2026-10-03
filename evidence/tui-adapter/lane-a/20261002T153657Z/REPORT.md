# Lane A — DSH-TUI seam adapter: package, migration, enforcement, verification

Slug: `tui-adapter` · lane: A · UTC stamp: `20261002T153657Z` · workspace: the `mpd-seam-convergence`
worktree (`/home/haroldzhao/MyProj/DshProj/My-Power-Dsh`).

Contract: `.mpd/plans/mpd-seam-convergence.md` TODO 1 (plus the captain's R5 addition and the API
freeze for Lane C).

## 1. What was delivered

| Artifact | Intent |
|---|---|
| `packages/mpd-tui-adapter-plugin/package.json` (NEW) | `@mpd-dsh/tui-adapter`, private, mirrored on the DSH adapter's manifest |
| `packages/mpd-tui-adapter-plugin/src/index.ts` (NEW, ~1200 lines) | THE single DSH-TUI contact surface: `TUI_SEAMS` (17 ids), the outcome vocabulary, the moved host types, the moved binder primitives (`readableService`/`serviceOf`/`onService`/`effectOn`), `createTuiAdapter`/`resolveTuiAdapter`/`createLazyTuiAdapter`/`apply`, `capabilities()`, `seamOutcomes()`, the file sink |
| `packages/mpd-tui-adapter-plugin/dist/index.js` (NEW, 23.4 KB) | built with the PINNED toolchain, repo root, canonical args |
| `packages/mpd-tui-adapter-plugin/README.md` + `README.zh-CN.md` (NEW) | the bilingual pair, language switch under the title, identical heading tree |
| `packages/mpd-tui-adapter-plugin/test/no-direct-tui-access.test.ts` (NEW) | the A2.2 static gate: 15 `tui*` ids, three spellings, `--self-test` (7 arms), out-of-band NOT COVERED section |
| `packages/mpd-tui-adapter-plugin/test/adapter-hosts.test.ts` (NEW) | the THREE host shapes + the late-bind queue + effect ownership + the sink |
| `packages/mpd-tui-plugin/src/host.ts` (DELETED) | its logic MOVED into the adapter; consumers now import those primitives from the adapter |
| `packages/mpd-tui-plugin/src/types.ts` | every `*Like` seam interface re-exported from the adapter (byte-identical shapes, zero consumer churn) |
| `packages/mpd-tui-plugin/src/{status,renderers,shortcuts,scenes,command-trees,commands,dialogs,decisions,settings,watchdog}.ts` | each seam call replaced by an adapter call; no file names a `tui*` seam any more |
| `packages/mpd-tui-plugin/src/index.ts` | resolves the ONE adapter, registers through it, records handle outcomes, calls the adapter's aggregate line |
| `packages/mpd-tui-plugin/src/log.ts` | R5: the fallback is a FILE sink from the adapter, never stderr; no sink ⇒ the line is dropped |
| `packages/mpd-tui-plugin/dist/index.js` | rebuilt (pinned bun) |
| `packages/mpd-tui-plugin/test/{plugin,team-surface,watchdog-frontdoor}.test.ts` | migrated call sites; the `/mpd` child-list assertion made content-robust (captain's item 2) |
| this directory | the mounting boot, its logs, and every gate's raw output under `gates/` |

## 2. The row snippet Lane B must insert (above `mpd-tui`, host plane)

```yaml
    # DSH-TUI plane: the ONE seam adapter every mpd tui*/commands/settings touch goes through.
    - id: mpd-tui-adapter
      name: '@mpd-dsh/mpd/packages/mpd-tui-adapter-plugin/dist/index.js'
```

The boot in this directory applies exactly those lines through
`evidence/tui-adapter/lane-a/20261002T153657Z/mpd-tui-adapter.overlay.yml`, which is why the mount
proof does not depend on the committed patch. **Row order matters for one thing only**: the adapter
must apply BEFORE `mpd-tui`, or `mpd-tui` resolves no mounted `mpdTui` and falls back to its own
private adapter (the boot still works; the mounted service is simply not exercised, and the lazy
resolution warns once).

## 3. Binding discipline (measured, as the brief demands)

- ONE deferred `ctx.inject([id], scoped => …)` PER SEAM — 17 ids, one dependency each; a batch is
  all-or-nothing in cordis and one absent optional seam would suppress the rest.
- The PROBE is `ctx.get(id, false)` and never binds a seam — EXCEPT `pluginHost`, which follows the
  HOST's own rule (soft probe first, deferred inject as fallback), and only when the ctx has an
  inject channel at all. A probe-only host with no `inject` binds nothing (T4-INERT-1).
- A registration made before its seam binds is QUEUED and drained by the binding callback.
- Every host handle goes to `scoped.effect(() => release(), label)` on the INJECTED scope.
- The CONSUMER's ctx is passed as the host's trailing `identity` argument.
- A seam that never binds reports `absent` and contributes to ONE aggregate line; a web/headless
  composition stays inert (proven by the mount boot: `TUI_SEAMS=(none composed)`, boot exit 0).

## 4. Commands run and their observed results

| Command | Observed |
|---|---|
| `cd packages/mpd-tui-adapter-plugin && bun test` | **14 pass / 0 fail** (gate + host shapes) — `gates/tests-mpd-tui-adapter.txt` |
| `cd packages/mpd-tui-plugin && bun test` | **120 pass / 0 fail** — `gates/tests-mpd-tui-plugin.txt` |
| `bun run typecheck` | 4 errors, ALL in `skills/programming/scripts/typescript/check-no-excuse-rules.ts` (pre-existing, not this lane; zero errors under `packages/`) — `gates/typecheck.txt` |
| `bun run verify:comments` | **PASS** — "every declaration in the family carries a precise comment and a full signature" — `gates/verify-comments.txt` |
| `.toolchain/node_modules/.bin/bun build packages/mpd-tui-adapter-plugin/src/index.ts --target node --format esm --outfile packages/mpd-tui-adapter-plugin/dist/index.js` | 23.4 KB, one module |
| `.toolchain/node_modules/.bin/bun build packages/mpd-tui-plugin/src/index.ts --target node --format esm --outfile packages/mpd-tui-plugin/dist/index.js` | 226.6 KB, 24 modules (the adapter is INLINED — see §6) |
| `node scripts/verify-dist-fresh.ts` | **my two targets FRESH** (`mpd-tui-adapter-plugin` sha `0c7c288936d3…`, `mpd-tui-plugin` sha `23acd2570001…`, toolchain `bun 1.4.0 from the repository toolchain`); the gate exits 1 for **19 OTHER packages** (Lane D's 15 rows + Lane E's two, in-flight) — `gates/verify-dist-fresh.txt` |
| `bun run verify:docs` | **PASS** — pairs=44 failed=0 dead=0 (the new README pair included) — `gates/verify-docs.txt` |
| `bun packages/mpd-tui-adapter-plugin/test/no-direct-tui-access.test.ts --self-test` | **PASS 7/7** — `gates/gate-self-test.txt` |
| `bun packages/mpd-tui-adapter-plugin/test/no-direct-tui-access.test.ts` | **PASS (0 findings)** over the real band: 25 packages, 113 `.ts` files — `gates/gate-real-band.txt` |
| `bun skills/dsh-qa/scripts/tui-panels.ts --self-test` | **PASS** — "7 surfaces asserted, negative controls fail as required" — `gates/lane-tui-panels-selftest.txt` |
| `bun skills/dsh-qa/scripts/tui-team-surface.ts --self-test` | **FAIL (1 check)** — see §6, first blocker — `gates/lane-tui-team-surface-selftest.txt` |
| `bun evidence/tui-adapter/lane-a/20261002T153657Z/mount-boot.ts` | **PASS 10/10** — `result.json`, `output.log`, `dump-config.log` |

### The mounting boot (10 checks, all green)

```
ok   the boot produced a log
ok   the adapter row is COMPOSED (dump-config in the same sandbox)
ok   the migrated TUI row is COMPOSED beside it
ok   no apply-crash signature for a row this lane owns
ok   the adapter PROVIDED the mpdTui service (its own file diagnostic)
ok   the seam inventory line was written by apply
ok   a headless composition INVENTORIES every seam as absent
ok   the migrated TUI row's aggregate line is accounted for
ok   the adapter never wrote to a terminal fd
ok   no session landed outside the sandbox
[tui-adapter-mount-boot] PASS
```

Isolation: `DSH_HOME=<sandbox>`, `HOME=<sandbox>/home`, sandboxed workspace cwd, and
`assertSessionsSandboxed` held. The adapter's own diagnostic was read from the FILE it writes —
`<sandbox>/ws/.mpd/logs/mpd-tui.log`:

```
[mpd-tui-adapter] mpdTui provided (one deferred inject per seam, inject-free row)
TUI_SEAMS=(none composed)
```

## 5. Public surface (as landed, with the two deviations from the Architect's memo)

`name`, `inject: string[] = []`, `TUI_SEAMS`, `TUI_SEAM_KEYS`, `SERVICE_NAME = "mpdTui"`,
`createTuiAdapter`, `resolveTuiAdapter`, `createLazyTuiAdapter`, `apply`, `capabilities()`,
`seamOutcomes()`, `describeOutcome`, `reportOutcomes`, `createFileSink`, `defaultLogRoot`,
`readableService`/`serviceOf`/`onService`/`effectOn`, the moved host types, and the typed members
over the seventeen seams.

Two additions beyond the memo, both load-bearing:

1. **`whenBound(key, setup(service, scope, handle))`** — the escape hatch for consumer work that is a
   LOOP or an ASYNC precondition rather than one registration (the settings namespace's owner check,
   the settings section's catalog-derived options, the decision-event disclosure). Without it those
   three would have needed their own `ctx.inject`, which is exactly what this package removes.
2. **`skipped(key, detail)`** and **`diagnosticSink(options)`** — the first lets a consumer report a
   config-disabled seam without spelling its id; the second is why the TUI package's bundle carries no
   filesystem writer of its own (see §6).

`registerScene` returns a `SceneRegistrationHandle` carrying `outcome()`, `bound()`, `record()`,
`openScene(id)` and `closeScene(id)` — Lane C's frozen shape. `closeScene` reports `false` on this
host build, which exposes no close member (a scene leaves through its own props' `close()`); the
optional member is documented in `TuiScenesLike`.

## 6. Blockers and things I could NOT verify

1. **`skills/dsh-qa/scripts/tui-team-surface.ts:1899` reddens on requirement R5 — captain's call.**
   The check is `!/writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|cpSync|createWriteStream/.test(dist)`
   over `packages/mpd-tui-plugin/dist/index.js`. R5's sink lives in the adapter, and `bun build`
   INLINES the whole adapter module into the TUI bundle (measured: the primitives appear at
   `dist/index.js` lines 2307/2384/2388/2391), so the bytes now contain them. The minimal change I
   would need — the same one I applied to the package's own arm in
   `packages/mpd-tui-plugin/test/team-surface.test.ts` — is to assert the invariants that are still
   true and still falsifiable: (a) no file under `packages/mpd-tui-plugin/src/` uses a write
   primitive, and (b) the dist carries none of the WATCHDOG STORE writers (`writeHold(`,
   `appendIncident(`, `clearHold(`, `writeWatermarks(`). I did NOT touch `skills/**`.
2. **A real `tui-team-surface`/`tui-panels` run was not completed.** Both need a warm sandbox profile
   (`tui-mount.ts --sandbox-root <root> --install`, network). The install ran here and had not
   finished when this report was written (`lanes/tui-mount-install.log`); their `--self-test` arms ran,
   and the mounting boot above is this lane's own end-to-end proof.
3. **`bun run typecheck` exits 1 on a PRE-EXISTING error** in `skills/programming/scripts/typescript/`
   (`Cannot find module 'typescript/unstable/ast'` ×2, an implicit `any` ×2). Nothing under
   `packages/` errors. `skills/**` is the captain's single-writer band, so I left it.
4. **`node scripts/verify-dist-fresh.ts` exits 1 for 19 packages that are not mine** (Lane D's 15 rows
   and Lane E's two, plus their neighbours) — they must be rebuilt by their owners with the pinned
   toolchain before the wave's sweep.
5. **Not verified by a real dsh-TUI session**: that the migrated row registers the same scenes,
   shortcuts, renderers, dialogs, status key and command tree against the REAL host. The package's own
   120-test suite covers those paths against a host double, and the adapter's host-shape tests cover
   the binding mechanics; the TUI lanes are the remaining gap (see 2).

## 7. Top uncertainty

The `pluginHost` soft-probe-first rule is the ONE place where a probe can bind a seam, and it binds
it on the ADAPTER's ctx rather than inside an injected scope — so `scoped.effect` ownership for that
seam falls back to the adapter's own ctx. Measured in this harness the adapter's ctx does carry
`effect`, and the decision-event seam owns its disposers there; on a host whose root ctx refuses
`effect` from a plugin activation, the subscription would be registered but not owned. This is the
same residual the DSH adapter documents as R1 (adapter-mediated registrations belong to the adapter
row's fiber), and I did not find a way to close it without an injected scope for a service the host
exposes only through the probe.
