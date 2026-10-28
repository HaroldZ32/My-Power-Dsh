# D-3 — why the one-click lane lost `mcp__codegraph__codegraph_explore` (3/3 → 2/3)

**Verdict:** SETTLED — the mechanism is diagnosed, reproduced in both directions, and FIXED in our own
resolver. Task T3 of wave `fix/codegraph-reachability` (version under test 0.16.1).

Everything below is either a quote from a file in this repository, a quote from a recorded lane stamp,
or an arm in `arms/` that this evidence directory carries. Nothing is inferred from a model's prose.

---

## 1. Read the failing row correctly first (this overturns the wave plan's reading)

`.mpd/plans/restore-acceptance-pr-body.md:81` reads `boot.mcpTools` → `MCP_TOOLS=2/3
MISSING=mcp__codegraph__codegraph_explore` as though ONE codegraph server had published two of its
three tools. That reading is WRONG, and re-deriving it from the plan text will send the next reader
down a "renamed tool" or "version skew" path that the measurements below close.

`docker/probe.ts` (`MCP_TOOLS`) lists **three expected tool names, one per MOUNTED SERVER**:

```
mcp__ast_grep__search          <- the ast_grep server
mcp__lsp__get_diagnostics      <- the lsp server
mcp__codegraph__codegraph_explore <- the codegraph server
```

`2/3` therefore means *two of the three SERVERS answered*; the codegraph server answered nothing at
all. The red stamp says exactly that, twice:

- `evidence/docker/client-install-oneclick/2026-10-09T15-10-21Z/output.log` (line 2678 in that file):
  `MCP_REGISTERED=mcp__ast_grep__rewrite,mcp__ast_grep__scan,mcp__ast_grep__search,mcp__context7__query-docs,mcp__context7__resolve-library-id,mcp__lsp__find_definition,…`
  with **no `mcp__codegraph__*` name anywhere**, and `MCP_SERVER_COUNTS=ast_grep:3,context7:2,lsp:12`.
- The same stamp's `owed-mcp` row reports `silentLocalServers=codegraph` — the lane's own word for "a
  LOCAL row that did not come up".

**Consequence for the wave:** `boot.mcpTools` (a tool is missing) and `boot.mcpToolNaming` (the
registered surface is not the declared row set, flagging `silentLocalServers=codegraph`) are **ONE
defect, not two** — which is what `.mpd/plans/restore-acceptance-findings.md:343-344` warns about. The
mechanism in §2 is why: the child process never answered one MCP frame, so it contributed zero tool
names, and both rows read that same absence from opposite sides.

## 2. The mechanism (named, with the code that carries it)

`@colbymchenry/codegraph@1.5.0` does not ship an executable. Its manifest declares
`bin: { codegraph: "npm-shim.js" }` — a THIN SHIM — plus six per-platform **optionalDependencies**
(`@colbymchenry/codegraph-{linux,darwin,win32}-{x64,arm64}`). The matching one is materialized by `os`
/ `cpu` filtering and carries a bundled Node runtime and the app (281 MB on this host). The shim
`exec`s that bundle; if it cannot find it, it says so and exits: the fixture in `arms/armA` records the
shim's own words —

```
codegraph: no prebuilt bundle for linux-x64.
Expected the optional package @colbymchenry/codegraph-linux-x64 to be installed.
A registry mirror (e.g. npmmirror/cnpm) that did not mirror the per-platform
package is the usual cause.
```

**npm counts an UNFETCHABLE optional dependency as SUCCESS.** So a mirror that did not mirror that one
package leaves a *complete-looking* install — the shim file exists, `node_modules/.bin/codegraph`
exists, `added N packages` printed — in which the executable cannot start.

The chain that turned that into a lost capability:

1. The lane's staging step installs the npm toolchain INTO the tree the rows run from
   (`docker/entrypoint.sh`, step `09d-astgrep-engine`: `ENGINE_TREE="$PROFILE_DIR/node_modules/@mpd-dsh/mpd"`,
   then `node scripts/install-mcp.ts --toolchain "$ENGINE_TREE/.toolchain"`). That produces
   `<installed tree>/.toolchain/node_modules/.bin/codegraph`.
2. Our launcher asks `packages/mpd-mcp-shared/bin-resolve.ts` → `resolveCodegraphBinary(import.meta.url)`
   for a binary, and — before this change — accepted a candidate on **existence alone**
   (`.toolchain` tier: `join(bundleRoot, ".toolchain", "node_modules", ".bin", s)`), then set
   `MPD_CODEGRAPH_BIN` to it (`packages/mpd-mcp-codegraph/src/launch.ts`).
3. The adopted server honours that env pin **unconditionally**: `dist/serve.js` →
   `resolveCodegraphCommand` returns `{ source: "env" }` for any NON-EMPTY `MPD_CODEGRAPH_BIN`, and the
   only later guard, `shouldSkipResolvedCommand`, refuses a pin whose path does **not exist**. An
   existing-but-unusable shim passes both, so the whole fallback chain
   (`bundled → provisioned → PATH → download`) is bypassed.
4. The shim then exits without answering, the bridge has no child to forward, and the MCP client
   registers **zero** codegraph tools. `boot.mcpTools=false` (`MCP_TOOLS=2/3`) and
   `boot.mcpToolNaming=false` (`silentLocalServers=codegraph`) are the same event.

### The discriminator, measured across the recorded stamps

`boot.mcpTools` tracks the npm toolchain install's package count **exactly**, in both directions:

| one-click stamp | toolchain install (installed tree) | `MCP_TOOLS` |
|---|---|---|
| `2026-10-09T00-14-36Z` | `added 5 packages` | `3/3` |
| `2026-10-09T00-30-35Z` | (re-run: `added 2`) | `3/3` |
| `2026-10-09T00-37-00Z` | `added 5 packages` | `3/3` |
| `2026-10-09T14-22-26Z` | **`added 4 packages`** | **`2/3`** |
| `2026-10-09T14-41-54Z` | **`added 4 packages`** | **`2/3`** |
| `2026-10-09T15-10-21Z` | **`added 4 packages`** | **`2/3`** |
| `2026-10-14T14-56-53Z` | `added 5 packages` | `3/3` |

(Every one of those lines is quoted from `evidence/docker/client-install-oneclick/<stamp>/output.log`;
the installed-tree install is the one whose `--prefix` names
`/root/sandbox-dsh/profiles/web/node_modules/@mpd-dsh/mpd/.toolchain`.)

The five packages are `@ast-grep/cli`, `@ast-grep/cli-linux-x64-gnu`, `detect-libc`,
`@colbymchenry/codegraph`, `@colbymchenry/codegraph-linux-x64` — measured on this host today from BOTH
registries (`npm install --prefix … @ast-grep/cli @colbymchenry/codegraph@1.5.0`, mirror and default,
each reporting `added 5 packages`, with all five present under `node_modules`). Four means the codegraph
platform bundle was silently skipped; the other four packages were demonstrably present in the red
stamps, because the ast_grep row ran a REAL search in them
(`boot.mcpLiveSearch=true`, `MCP_LIVE_SEARCH=ok:1`), which requires its own platform leaf.

### Alternatives, refuted by measurement (so the bound stays narrow)

- **Tool renamed / version skew — REFUTED.** All three resolution paths pin 1.5.0: the root manifest
  declares `"@colbymchenry/codegraph": "1.5.0"`, `scripts/install-mcp.ts` (`NPM_TOOLCHAIN`) installs
  `@colbymchenry/codegraph@1.5.0`, and `packages/mpd-mcp-codegraph/dist/serve.js` carries
  `CODEGRAPH_PINNED_VERSION = "1.5.0"`. The served surface at 1.5.0 was measured directly in
  `arms/armB` and `arms/armC`: `tools/list` returns exactly one tool, named **`codegraph_explore`** —
  the name the probe expects. A rename therefore cannot produce this row, and the server contributed no
  names at all (so nothing was renamed to anything).
- **The degrade path "answering two of three" — REFUTED.** The launcher's unavailable fallback answers
  `initialize`/`tools/list` with **zero** tools and stays alive; the measured red state produced no MCP
  frame at all (`stdoutBytes=0`, `arms/armA`, `arms/armD0`). Two different shapes, and only the second
  matches the stamp.
- **The staging change alone (the plan's "hypothesis") — REFINED, not confirmed as stated.** Staging
  `.toolchain` into the installed tree is what CREATED the candidate, but the three `added 5` stamps of
  2026-10-09T00-xx already had that same `.toolchain` (`astgrepToolchain = ast-grep,codegraph,sg,` in
  all of them) and stayed green. The pin only costs the row when the shim it names is incomplete —
  which is why the mirror's delivery, not the staging, is the trigger.

## 3. The fix — and why it cannot reject a healthy install

`packages/mpd-mcp-shared/bin-resolve.ts`:

- `codegraphPlatformPackage(platform, arch)` — the per-platform package name, derived exactly as
  upstream's shim derives it (`"@colbymchenry/codegraph-" + platform + "-" + arch`).
- `hasCodegraphPlatformBundle(shimPath, opts)` — **how it decides:** it asks the shim's OWN question,
  from the shim's OWN location, with Node's resolver:
  `createRequire(<shimPath>).resolve("<pkg>/bin/codegraph")` on POSIX and
  `createRequire(<shimPath>).resolve("<pkg>/node.exe")` on win32. Those are the two specifiers
  upstream's `npm-shim.js` itself requires (`resolveInstalledBundle`), so the predicate and the shim
  cannot disagree about whether the bundle is there. It spawns nothing and downloads nothing.
- `resolveCodegraphBinary` now passes that predicate into `firstAccepted(...)` as the acceptance probe
  (the same shape the ast-grep resolver has always used for its `--version` probe), so an unusable
  candidate is **skipped and the next tier answers** — which is why the predicate belongs here and not
  in `packages/mpd-mcp-codegraph/src/launch.ts`. Measured: declining in the launcher instead drops the
  pin entirely and still loses a healthy later tier (`arms/armD0`-class state), so the launcher-side
  variant was rejected as wrong, not merely inelegant.

**Why it cannot false-positive (a resolver that skips a GOOD candidate would be worse than the bug):**

1. It is the shim's own acceptance test, not a new rule: a healthy install is exactly one whose
   `npm-shim.js` can `require.resolve` that same specifier. If the predicate fails, the shim would fail
   too — the two answers are the same computation.
2. The install shape it reads is the published one: `@colbymchenry/codegraph-linux-x64` publishes no
   `exports` map (measured from its manifest and from `require.resolve` under both node 24 and bun
   1.4.0), so a deep subpath resolves whenever the package is present. The name formula covers
   `linux/darwin/win32` × `x64/arm64`.
3. Both directions are measured on a real install: `arms/armB` (complete pin) and `arms/armC` (the
   repo's own checkout layout, where the require tier resolves the bun-store package and the toolchain
   tier is healthy) both answer `tools/list` with `codegraph_explore` AFTER the change; `arms/armA`
   (incomplete shim) answers nothing, before and after.
4. The skip is falsifiable and does not manufacture green: `arms/armE` is the same broken candidate
   with NO healthy tier behind it — nothing is pinned, and the row still serves 0 tools. The predicate
   only removes a WRONG pin; it never invents an engine.
5. Unit arms pin the rule and its grammar (`packages/mpd-mcp-shared/bin-resolve.test.ts`): the name
   formula, the win32-vs-POSIX specifier pair, the absent-shim answer (`false`, never a throw), the
   `added 4` state resolving to `null`, the `added 5` state resolving to the shim, and an unusable
   first candidate falling THROUGH to the next tier.

**Does the ast-grep tier share the new predicate?** No. `resolveAstGrepBinary` keeps its own
`--version` probe unchanged (`ResolverOptions.probe`); the new predicate is only ever installed by
`resolveCodegraphBinary` (`ResolverOptions.platformBundle`). ast-grep's behaviour is therefore
identical, and its test suite plus its REBUILT dists are part of this change only because `bun build`
inlines the shared module into them — see §4.

## 4. Fan-out (route (i), approved by the captain)

`bin-resolve.ts` is inlined into every launcher that imports it. Consumers, enumerated:
`packages/mpd-mcp-astgrep/src/launch.ts` → `dist/launch.js`,
`packages/mpd-mcp-astgrep/src/server.ts` → `dist/cli.js`,
`packages/mpd-mcp-codegraph/src/launch.ts` → `dist/launch.js`, and `scripts/mpd-doctor.ts` (run as
TypeScript, no dist). `packages/mpd-mcp-lsp` does NOT import it (its launcher imports `dependency-entry`
and `log-sink` only).

Rebuilt with the PINNED toolchain from the repo root
(`.toolchain/node_modules/.bin/bun build <src> --target node --format esm --outfile <dist>`):
`packages/mpd-mcp-astgrep/dist/launch.js`, `packages/mpd-mcp-astgrep/dist/cli.js`,
`packages/mpd-mcp-codegraph/dist/launch.js`.

**Measured blast radius on the emitted BYTES: ONE file.** The two ast-grep targets rebuild
BYTE-IDENTICALLY to their committed copies and to `HEAD` (sha256 prefix `3f02e8507b3503ae` for
`dist/launch.js`, `f11d1d0c501aba6e` for `dist/cli.js`, each compared fresh ↔ committed ↔ `HEAD`),
because bun tree-shakes the two exports ast-grep never imports — so ast-grep's shipped bytes and
behaviour are unchanged, not merely "rebuilt". Only `packages/mpd-mcp-codegraph/dist/launch.js` differs.
`node scripts/verify-dist-fresh.ts` → `ok: 34/34 targets fresh (each rebuilt twice, byte-identical)`,
toolchain `bun 1.4.0` from `.toolchain`, 1 declared NOT-COVERED file
(`mpd-mcp-codegraph/dist/serve.js`, the sha-pinned prebuilt).

## 5. Gates (logs in `gates/`, all exit 0)

| Gate | Observed |
|---|---|
| `bun test packages/mpd-mcp-shared` | exit 0 — 30 pass, 0 fail |
| `bun test packages/mpd-mcp-codegraph packages/mpd-mcp-astgrep` | exit 0 — 39 pass, 0 fail |
| `bun test packages/mpd-mcp-lsp packages/mpd-mcp-gitbash` | exit 0 — 33 pass, 0 fail |
| `bun test packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` | exit 0 — 2 pass, 0 fail (no new cross-package edge: the payload suite is reached through a package that already was a coupling) |
| `bun run typecheck` | exit 0 |
| `bun run verify:comments` | PASS — 479 files, 43586 declarations |
| `bun run verify:docs` | PASS — pairs=52 failed=0 violations=0 links=467 dead=0 (the two `packages/mpd-mcp-codegraph/README*.md` files were updated together) |
| `node scripts/verify-dist-fresh.ts` | `ok: 34/34 targets fresh` |

## 6. Bounds (what this evidence does NOT settle)

1. **The 2026-10-09 mirror state was not re-created inside a container.** It depended on
   `registry.npmmirror.com` failing to serve one optional package for a window; measured today, BOTH
   the mirror and the default registry deliver all five packages, and `npm ls` shows them. So the red
   state is reproduced here as a FILESYSTEM shape (the shim without its bundle), which is exactly what
   an incomplete install leaves, not as a live registry failure.
2. **No Docker lane was run for this task.** Two reasons, both measured rather than assumed:
   `--mode oneclick` installs `github:HaroldZ32/My-Power-Dsh`'s DEFAULT branch, so it cannot exercise an
   uncommitted fix; and no lane today can reproduce the mirror gap. After the merge the release sweep
   should run, in this order, `node scripts/docker-e2e.ts --mode source --require-docker --no-browser`
   (the checkout tree, i.e. this change) and then
   `node scripts/docker-e2e.ts --mode oneclick --require-docker --no-browser` (the published path;
   `--live` is not needed for `boot.*` rows, and `--no-browser` is the credential-free spelling). A
   SKIP is not a pass: this host's Docker is rootless, so the lane should RUN, and if it skips, the
   stamp must say so.
3. **The durable apparatus repair is NOT in this task.** The class is closed on our side (no wrong pin
   can be produced any more), but a partial toolchain install still leaves no usable engine, and the
   resolver then leaves the env unset so the adopted chain must provision. The recommended follow-up,
   outside T3's declared scope, is in `scripts/install-mcp.ts` → `ensureNpmToolchain`: after the npm
   install, assert that `@colbymchenry/codegraph-<platform>-<arch>` resolves; if it does not, retry
   THAT package from the official registry and, if it still fails, print an actionable failure instead
   of leaving an unusable `.bin/codegraph` behind. (Upstream's shim names the same remedy: "install
   from the official registry".)
4. **`boot.mcpToolNaming`'s one-click red is accounted for by the same cause**, but this evidence
   directory does not re-grade that row end to end — that is the release lane's job with the command
   in bound 2.

## 7. Files this task changed

| Path | Nature |
|---|---|
| `packages/mpd-mcp-shared/bin-resolve.ts` | + `codegraphPlatformPackage`, + `hasCodegraphPlatformBundle`, + `ResolverOptions.platformBundle`; `resolveCodegraphBinary` now probes acceptance and falls through |
| `packages/mpd-mcp-shared/bin-resolve.test.ts` | the two precedence arms pin the probe explicitly; + 4 new arms (the `added 4` / `added 5` states, fall-through, the name/specifier grammar) |
| `packages/mpd-mcp-codegraph/src/launch.ts` | header note only (the rule and its measurement live in the shared resolver) |
| `packages/mpd-mcp-codegraph/README.md` + `README.zh-CN.md` | the acceptance rule, measured, in both languages |
| `packages/mpd-mcp-codegraph/dist/launch.js`, `packages/mpd-mcp-astgrep/dist/{launch,cli}.js` | rebuilt with the pinned toolchain (inlined shared module) |

Not touched: `VENDOR_LOCK.json`, the `package.json` version, `packages/mpd-codegraph-plugin/**`,
`skills/**`, `dist/mpd-package/**`.

## 8. Reproducing the arms

`arms/probe.mjs` is a 60-line MCP stdio client (newline-delimited JSON; `initialize` then `tools/list`,
one verdict line per arm). Each `arms/arm*.txt` is a complete transcript: the command, the probe's
verdict, and the launcher's log sink (`MPD_MCP_LOG_DIR`). `arms/README.md` lists the exact commands.
