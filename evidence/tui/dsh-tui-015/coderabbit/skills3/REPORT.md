# skills3 — mcp-call lane: the boot collision (mechanism), the fix, and the cost

Author: Senior Engineer, wave `fix/coderabbit-pr42`. Scope: `skills/dsh-qa/**` (the case) — plus the
two docker-side files named by the task (`docker/lib/owed-cases.ts`, `docker/README{,.zh-CN}.md`),
whose evidence is in `../docker3/`.

No git writes. `VENDOR_LOCK.json` deliberately NOT re-pinned (the captain owns the wave's single
re-pin). No `packages/**` bytes written by this seat (the `packages/mpd-team-core-plugin/**` entries in
`git status` carry 10:53 mtimes, before this seat started at 13:14 local).

## Touched paths (sha256)

| Path | at hand-off (skills2 REPORT) | after this seat (FINAL) |
|---|---|---|
| `skills/dsh-qa/scripts/mcp-call.ts` | `b242f6645062ee926c602fddb32116537eef999a3971e90f19ccda04e55676d3` | `5aa5e92e08b994bc7c5b6df3198d51fd8aa32e3e103403f7b83a78b12fde9c60` |
| `docker/lib/owed-cases.ts` | — | `b614ace22c26899b6bb07670838e38e317c24a447eaf8f73d73d612944ccdfdc` |
| `docker/README.md` | — | `24829b05f33c26c170ebe113b9f898e0118611d229ce5baec27e0d80ee73a1b9` |
| `docker/README.zh-CN.md` | — | `39b81bc66d01d51d7763cc0a1243aee9424bd8b18df89560606861328e62aeb6` |

Hash discipline: the lane ran at 06:40:54Z on `mcp-call.ts` = `5aa5e92e…`, and that file is BYTE-IDENTICAL
now — the executed path did not move. AFTER that green run, PROSE-ONLY corrections landed in the three
`docker/**` files (the cited range became 70.8–113.1 s once the third green run landed, and the
owed-cases comment lists the three logs), so their hashes moved to the values above; the gates that
cover them (`bun run typecheck`, `bun run verify:comments`, `bun run verify:docs`) were re-run and are
green, `bun run test:qa` is green on the unchanged `skills/**` bytes, and the DOCKER files cannot affect
the lane (it never reads them). BOUND: the strict form — one hash set for lane + gates — holds for
`skills/**` only.

`mcp-call.ts` also carries the skills2 seat's pre-existing edits (`--install-links`,
`INSTALL_TIMEOUT_MS`), so `mcp-call.diff` (vs HEAD, in this directory) is MIXED provenance: this seat's
hunks are the peer/offline flags, the shared-cache runner and the rewritten rot-guard block.

## STEP 1 — the collision, diagnosed from artifacts and reproduced

**The brief's leading hypothesis is FALSIFIED.** It said the profile bundle's own `dsh.bundle.patch` and
the case's explicit `--patch <repoRoot>/cordis.patch.yml` are two paths a path-based loader dedupe no
longer collapses, so a row mounts twice. It does not:

* `collision/composition-colliding-tree.log` — `node scripts/dump-config.ts --profile headless --
  --patch <repo>/cordis.patch.yml` against the very tree that FAILS to boot: **130 rows, ZERO duplicate
  ids**, exactly ONE `mpd-tool-agent-team` (line 674) and one `mpd-agent-team` (line 634); the layer
  headers name only `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-headless` — the mpd rows come from the
  `--patch` overlay alone, and the profile's `dsh.profile.bundles` never names `@mpd-dsh/mpd`.
* `collision/e1-realcopy.log` — a hand-made profile whose `node_modules/@mpd-dsh/mpd` is a REAL COPY of
  `dist/mpd-package` (what `--install-links` produces, minus npm) **boots green** (exit 0, 25 s, the
  model lists the `mcp__*` tools) with that same `--patch`. Real copy vs symlink is NOT the variable.

**Reproduced** on this box (`collision/e2-npminstall.log`): the same profile built by the case's own
install command (`npm install --install-links`, default peer behaviour) dies in 14 s with

```
dsh: tool "send_message" is already registered (for a per-agent variant, register through that agent's `agent.ctx` instead)
```

**Bisect** (`collision/bisect.sh`, ~6 boots): with the installed profile's own
`@deepseek-ai/*` core copy removed, the boot passes (`collision/e3-no-harness-copy.log`); binary search
over its 40 packages converges on `@deepseek-ai/dsh-tools`, whose SINGLE removal makes the boot pass
(singleton re-test: collision-count 0, exit 0).

**The mechanism, read off the harness's own stack** (`collision/hook-stack-deep.log`, produced by
`collision/hook.mjs` preloaded with `NODE_OPTIONS=--import`, which makes the duplicate-error constructor
print its stack):

```
at NamedEntries.duplicateError   <profile>/node_modules/@deepseek-ai/dsh-tools/lib/index.js:2634
at NamedEntries.insert           <profile>/node_modules/@deepseek-ai/dsh-scope/lib/index.js:29
at ScopedLayers.effect           <profile>/node_modules/@deepseek-ai/dsh-scope/lib/index.js:192
at Proxy.register                <profile>/node_modules/@deepseek-ai/dsh-tools/lib/index.js:2886
at install                       @deepseek-ai/dsh-experimental-tool-agent-team/lib/index.js:295
at maybeInstall                  …/index.js:541        (for (const agent of ctx.agents.list()), :545)
```

1. The pack's manifest declares `dsh-better-sidebar` as a DEPENDENCY, and that package's
   `peerDependencies` name the harness core (`@deepseek-ai/dsh-agent`, `dsh-scope`, `dsh-tools`, …).
   npm's DEFAULT peer auto-install therefore materializes a **SECOND copy of the harness core** into
   `<profile>/node_modules` (measured: 249 top-level packages / 1.1 GB, `@deepseek-ai/*` = 40 entries).
2. `@deepseek-ai/dsh-scope` keys the calling context's scope by a **module-local symbol** —
   `const kScope = Symbol("dsh.scope")` (`dsh-scope/lib/index.js:229`), `scopeOf(ctx) { return
   ctx[kScope] }` (:312) — so a scope marker written by ONE loaded copy is invisible to another copy.
3. The `mpd-tool-agent-team` row's plugin (`@deepseek-ai/dsh-experimental-tool-agent-team`) registers
   `send_message` through `agent.ctx` for the ROOT agent (the official TeamService reports it as the
   implicit `lead`, `tryMembership` → `{role:"lead"}`, `lib/index.js:397-421`). With the marker
   invisible, `scopeOf(agentCtx)` is `undefined`, so the registration lands in the GLOBAL tool layer
   instead of the agent's.
4. The base row `tool-subagent-control` (`@deepseek-ai/dsh-tool-subagent-control/lib/index.js:23`) had
   already registered a GLOBAL `send_message` there → duplicate insertion → fatal boot.

So the two colliding REGISTRATIONS are `tool-subagent-control` (base bundle) and `mpd-tool-agent-team`
(this patch), and the identity they collide on is the tool NAME in the GLOBAL layer; the layer
ATTRIBUTION is decided by the module-local scope symbol — not by a patch path, a realpath or a row id.
With a single copy of the harness modules the registration goes to the agent scope and the composition
is fine (E1/E3).

**Fix chosen for the lane** (`collision/e4-legacy-peer-deps.log`): `--legacy-peer-deps`, i.e. npm does
not auto-install the pack's peer closure — the semantics a real dsh profile has (`dsh plugin add`
forwards to pnpm, which does not auto-install peers; the installation provides them). The pack's OWN
closure stays materialized and non-linked, which is what this arm exists to measure
(`collision/launcher-resolution.log`: in BOTH installs the pack is not a symlink and `@ast-grep/cli` +
`cclsp` resolve from INSIDE `<profile>/node_modules`).

**NOT a lane-only curiosity — reported, not fixed here** (the product-side form): the harness's
module-local scope symbol makes ANY composition whose profile carries a second harness copy boot-fatal
through an unrelated-looking duplicate tool. The repro is this directory. `packages/**` is outside this
task's scope, and the finding belongs to the host owner.

## STEP 2 — fix per scope (path + symbol)

* `skills/dsh-qa/scripts/mcp-call.ts` → `realRun`'s install spawn: `--legacy-peer-deps` and
  `--prefer-offline` added, `--cache` now receives the SHARED cache (the per-arm
  `<sandbox>/.npm-cache` is gone).
* `skills/dsh-qa/scripts/mcp-call.ts` → new `runArmsWithSharedCache()`: creates ONE cache outside both
  arm sandboxes, runs `realRun(ENUM_JOB, 600000, npmCache)` then `realRun(CALL_JOB, 600000, npmCache)`,
  and releases the cache in `finally` before the evidence pass reads the arms.
* `skills/dsh-qa/scripts/mcp-call.ts` → `realRun(job, timeoutMs, npmCache)`: the cache is a parameter,
  never created per arm.
* `skills/dsh-qa/scripts/mcp-call.ts` → `selfTest()`: the measured install argv, the shared-cache argv
  and the shared-cache runner are each asserted, and the per-arm cache call is asserted GONE. Every
  needle is ASSEMBLED from two pieces because a single literal also appears in the guard's own text —
  measured: the earlier spelling of this guard could never redden (`collision/guard-mutants.log`).
* `docker/lib/owed-cases.ts` → `LIVE_CASE_TIMEOUT_MS` 1800000 → 2400000 (see `../docker3/`).
* `docker/README.md` / `docker/README.zh-CN.md` → the step-budget row now carries the 16c budget story
  in both languages.

## STEP 3 — the measurements

| What | Command / artifact | Observed |
|---|---|---|
| OLD lane (two cold closure installs) | `../skills2/mcp-call-real.log` | **2647 s**, both arms dead on the collision, `recordedToolCount 0` |
| NEW lane, FINAL frozen bytes, selected registry route | `lane-final.log` + `lane-final-evidence/result.json` | **PASS, exit 0, 113.1 s** wall, 104 tools, `mcp__ast_grep__`+`mcp__lsp__` present, ast-grep call recorded with the fixture line |
| NEW lane, earlier green runs (same install/boot code) | `lane-frozen.log` (79.0 s, 106 tools), `lane-mirror.log` (70.8 s, 104 tools) | PASS, exit 0 — the four green runs on this route span **70.8–113.1 s** |
| one cold closure install | `collision/install-default-registry-time.log`, `install-mirror-legacy-peer-deps-time.log` | **1037 s** on the default registry (skills seat) / **25.4 s** on the mirror; the warm re-install **5.9 s** |
| registry latency, same packument | `collision/registry-probe.log` | `registry.npmjs.org` 18.8 s, mirror 0.095 s — the cold cost is the LINK, not the closure |
| slow path, end to end | `lane-slowpath-partial.log` | **NOT completed**: the default registry delivered 37 MB in 20 min and the first arm's install had not finished; killed. The slow-path total is therefore ARITHMETIC over measured components (1037 s cold + ~6 s warm + two boots), not one run |

Consequence for the budget chain: on this box the slow path is ~1100 s, i.e. inside the old 1800 s
per-case ceiling, and on the container's selected route the lane is 70.8–113.1 s. The ceiling was still
raised — for the OUTER/INNER reason recorded in `../docker3/`, not because today's total exceeds it.

## STEP 4 — gates (all run on the frozen bytes; logs in this directory)

| Gate | Command | Observed |
|---|---|---|
| Case self-test | `node skills/dsh-qa/scripts/mcp-call.ts --self-test` | `[mcp-call self-test] ok: …`, `EXIT=0` |
| Rot-guard falsifiability | `bash guard-mutants.sh` (in `collision/`) | control `exit=0`; m1 (flags dropped) `exit=1`; m2 (per-arm cache back) `exit=1`; m3 (shared runner bypassed) `exit=1`; m4 (runner renamed/deleted) `exit=1` — log `collision/guard-mutants.log` |
| QA self-tests | `bun run test:qa` | `[test:qa] all self-tests passed`, `EXIT=0`; 0 lines starting `FAIL `, 0 `self-test] FAIL`, 0 `SELF-TEST: FAIL`; 2 pre-existing `[mpd-qa] SKIP` (tui-distribution, tui-spec-conformance, `absent-fixture`) |
| Typecheck | `bun run typecheck` | `$ tsgo --noEmit`, `TYPECHECK_EXIT=0` |
| Declaration comments | `bun run verify:comments` | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.`, `EXIT=0` |
| Doc pair (touched) | `bun run verify:docs` | `pairs=47 failed=0 violations=0 … PASS` (log in `../docker3/`) |

## Honest bounds

* The **slow-registry end-to-end run was killed** after 20 min (see above): the slow-path figure is
  arithmetic, and the end-to-end numbers quoted are the mirror/selected route.
* The two green lane runs each recorded a slightly different total tool count (104 / 106) while the
  ASSERTED sets held in both; the total is not an assertion of this case and its drift is unexplained
  here (recorded, not diagnosed).
* `dsh plugin add` (the pnpm path) **cannot run in this sandbox** — pnpm's store is read-only here
  (`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`, and the case's own comment records the same limit). The
  claim that a real pnpm install does not materialize the peer closure rests on pnpm's documented peer
  semantics plus the pack manifest's shape, not on a run of that path.
* The lane was run on this host with the sandbox credential copy as the case designs; the credential's
  own validity is not this seat's claim (the boots reached the model and answered).
* The collision's product-side form is REPORTED, not fixed: `packages/**` bytes were not touched.
* `evidence/` (this directory and `evidence/dsh-qa/mcp-call/2026-10-15T06-34-34.077Z/`) and
  `.qa-mcp-repro/` (gitignored scratch) are the only non-scope paths this seat wrote.
