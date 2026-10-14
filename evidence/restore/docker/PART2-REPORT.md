# PART 2 — the Docker real-machine acceptance run (`.mpd/plans/restore-three-capabilities.md` §7)

Lane owner: the Senior Engineer of task T8. Ref under test:
`github:HaroldZ32/My-Power-Dsh#feature/restore-three-capabilities` (never a bare `github:owner/repo`,
which resolves the DEFAULT branch and installs OLD code).

Docker on this host: **available and rootless** (`unix:///run/user/1000/docker.sock`, Docker 29.8.2,
Compose v5.6.0) — so no run here could skip, and none did.

Both lanes ran with `--live` (a provider key was available in the operator's own credential store and
was forwarded BY NAME only, never by value, never echoed; the container staged it into a sandbox home
mode 0600 and deleted it before the report).

## 1. The stamps

| Lane | Evidence stamp | Verdict | Exit |
|---|---|---|---|
| **source (authoritative)** | `evidence/docker/client-install/2026-10-09T00-25-18Z` | 105 passed / 3 failed / 2 null | 1 |
| **oneclick (authoritative)** | `evidence/docker/client-install-oneclick/2026-10-09T00-37-00Z` | 107 passed / 2 failed / 5 null | 1 |

Superseded runs, kept as corroboration: `…/client-install/2026-10-09T00-08-26Z` (apparatus v1) and
`…/client-install-oneclick/2026-10-09T00-14-36Z` + `…/2026-10-09T00-30-35Z` (apparatus v2/v3). The
apparatus itself changed between them (§7), which is why the authoritative pair is the LAST one.

Measured container facts (from `result.json`'s `harness` block): ubuntu 24.04.5 LTS, harness
`0.2.0-rc.2` (exact pin), node v24.21.0 / npm 11.19.0, bun **1.4.2** (route=official-script),
pnpm 11.23.0, image 438 MiB.

## 2. The §7 items — per-assertion outcome

| §7 item | Assertion | source | oneclick |
|---|---|---|---|
| 1 — install closure, no unapproved build script | `install.buildScripts` | **PASS** | **PASS** |
| 2 — MCP rows register as `mcp__<server>__<tool>` | `boot.mcpToolNaming` | **PASS** | **PASS** |
| 5 — live ast-grep search over real source | `boot.mcpLiveSearch` | **PASS** (1 match, control 0) | **PASS** (1 match, control 0) |
| 5 — packed artifact licence coherence | `pack.licenceCoherence` | **PASS** | **PASS** |
| 5 — packed artifact declarations | `pack.declarationCoherence` | **PASS** | **PASS** |
| 5 — packed artifact byte coherence | `pack.staticCoherence` | **PASS** (607/607) | **PASS** |
| 5 — packed artifact freshness | `pack.distFreshRebuild` | **FAIL** — 24 differing, toolchain cause (§4) | `null` — mode runs no rebuild (by design) |
| 4 — review panel | `restore.reviewPanelSelfTest`, `restore.reviewPanelCase` | **PASS**, **PASS** | **PASS**, **PASS** |
| 4 — LSP bootstrap | `restore.lspBootstrap` | **PASS** | **PASS** |
| 4 — hashline repair | `restore.hashlineRepair` | **PASS** | **PASS** |
| 3 — the two live QA cases | `qa.mcpCall`, `qa.readonlyDeny` | **FAIL**, **FAIL** (§6) | **FAIL**, **FAIL** (§6) |

`install.buildScripts` (item 1, the captain's question (a)) is **GREEN in both lanes**, and the two
packages §7 named are confirmed in the published closure: `@cyanheads/git-mcp-server` declares
`"prepare": "bunx husky"` and `mcp-server-commands` declares `"prepare": "npm run build"`; `cclsp`
declares none. The source lane's closure walk found **0** manifests declaring
`preinstall/install/postinstall/prepare`; the oneclick lane found **11** (the published install
materializes the optional MCP dependency closure), and STILL no `ERR_PNPM_IGNORED_BUILDS` and no
`Ignored build scripts` warning.

**The installer-vs-client-install distinction, kept explicit**: step `09d` runs the repository's own
`scripts/install-mcp.ts`, i.e. an NPM install into `<bundle>/.toolchain`, and npm 11.19 prints
`npm warn install-scripts 1 package has install scripts not yet covered by allowScripts`
(`@ast-grep/cli@0.45.3`, `postinstall`). That is the **installer**, not `dsh plugin --profile web add`.
`install.buildScripts` grades ONLY the latter — the pnpm error class `ERR_PNPM_IGNORED_BUILDS` and its
warning — so the row must not be read as covering the npm installer's own script posture.

## 3. The explicit list of `null`s — owed, not passed

- **source (2)**: `tui.mergedPanelOpens`, `tui.mergedPanelOrder`.
- **oneclick (5)**: the same two, plus `build.bunInstall`, `build.dists` (inapplicable in a mode that
  runs no build — the lane's own declared reason), and `pack.distFreshRebuild` (§4).

Both TUI rows carry the lane's long-standing reason: with the 0.13.0 panel seam the merged view is a
sidebar panel whose bytes never reach a tmux capture; those surfaces are covered store-backed by the
sandbox lanes (`tui-panels`, `tui-deps-ctrla`). Recording them as passes would be a claim the pane does
not carry.

## 4. The one REAL red of the pack arm, and its cause

`pack.distFreshRebuild=false` in source mode: **24 of 31 built entries differ** from the container's
from-source rebuild. This is NOT staleness, and the row now says so itself, because the staleness
question is answered by a different row:

- `pack.staticCoherence=true` — 607 carried files byte-identical to the tree the artifact was cut from
  (2 declared generated exceptions). The artifact IS fresh with respect to its source.
- The 24 differences are a **toolchain** measurement: the artifact was cut under the declared pin
  `bun@1.4.0` (`package.json.buildToolchain`), while the container installs **bun 1.4.2** from
  `bun.sh` and its step-08 rebuild inlines a different helper preamble.

This was PROVEN on the host, not asserted: rebuilding one package from the SAME source gives bytes
identical to the committed dist under the pinned `bun 1.4.0` and DIFFERENT bytes under PATH `bun 1.4.2`.
It is the class AGENTS.md §6 records as T16, where the same canonical command left 24 of 30 targets
"stale" under 1.4.2 against a 1.4.0-built tree — the same number.

## 5. The oneclick lane's live search — RED in v3, GREEN after the fix

Apparatus v3 recorded `boot.mcpLiveSearch=fail:BINARY_NOT_FOUND`, and the classifier fix is what made that
legible (the version before it printed `unreadable-result` for the same state). The engine install step
had two defects, both fixed and both re-verified:

1. the engine was staged into the CHECKOUT while the one-click rows run from the INSTALLED tree in the
   profile — the launcher resolves its engine bundle-relatively, so it looked in a tree that had none;
2. after redirecting the toolchain, the INSTALLER SCRIPT itself was taken from that installed tree, and
   Node REFUSED it: `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` — a `node_modules` path may not be
   type-stripped, the same measured constraint AGENTS §6 records for this repository's remaining
   JavaScript. Step `09d` died in zero seconds with exactly that error, and `obs.astgrepToolchain` read
   `none`.

After the fix, the authoritative oneclick run shows the toolchain staged in the INSTALLED tree
(`obs.astgrepToolchain = ast-grep,codegraph,sg`), the installer script running from `/opt/mpd`, and
`boot.mcpLiveSearch=PASS`: a real call matched 1 site with the negative control at 0.

## 6. The two live QA cases — the captain's question (b)

Both are RED, in both container lanes, and the failures are now classified rather than inherited.

### `qa.readonlyDeny` — FAIL, and the container reproduces the host EXACTLY

The decisive predicate is `childRequests > 0`: the restricted child must issue its own request through
the case's local stub. In the container the trace shows `childRequests: 0, parentRequests: 1` and
`positive.exit: 1`, so no child request was ever traced.

MEASURED COMPARISON, not inference: the same case was run on the developer host, and it fails with the
same signature — `childRequests: 0`, `positive.exit: 1`, `mutationLoaded: false`, `stubCalls: 2`. One
container-specific extra appears in one-click mode only: `parentHasAllSeven: false` (the parent's tool
list carried 95 tools and only SIX of the eight write-capable names, the two `mcp__lsp__rename_symbol*`
ones missing), which is a second, weaker failure of the same arm.

So: `readonly-deny` is **not settled green by Docker, and Docker did not create the failure.** The
container's verdict equals the host's verdict.

### `qa.mcpCall` — FAIL, and the credential question is settled

The case RAN in both lanes (an earlier apparatus defect recorded `null` — "missing credentials" — from a
mirror placed after the credential's deletion; fixed, see §7). Both lanes print the case's own summary:

```
[mcp-call] ok=false (enum recorded tools=107, ast_grep call recorded)   <- source
[mcp-call] ok=false (enum recorded tools=95,  ast_grep call recorded)   <- oneclick
```

The HOST prints the IDENTICAL line with 107 tools, so this is pre-existing, not container-specific. The
host's own evidence (`evidence/dsh-qa/mcp-call/2026-10-09T00-37-23.996Z/result.json`) names the exact
failing predicate:

```
enum: {"exit":0,"recordedToolCount":107,"hasAstGrep":true,"hasLsp":true}          -> enumOk TRUE
call: {"exit":0,"called":true,"succeeded":true,"resultChars":0,
       "resultHasFixtureLine":false,"resultHasBinaryNotFound":false,
       "proseHasBinaryNotFound":true}                                            -> callOk FALSE
```

So: the model's tool list carried both MCP servers, the `mcp__ast_grep__search` call was made and
recorded, and its recorded RESULT TEXT was EMPTY (`resultChars: 0`), while the model's prose says
`BINARY_NOT_FOUND`. The one failing predicate is `callOk`, and the cause is that no `sg` engine resolved
on the case's real chain.

**Why the lane must NOT "fix" this, and did not.** `mcp-call`'s own header forbids pre-seeding the
engine: an earlier shape pinned `MPD_AST_GREP_SG_PATH` / `MPD_CODEGRAPH_BIN` to the checkout toolchain,
"which is exactly why it stayed green while the deployed MCP tools were dead — the case manufactured its
own pass. It must exercise the real resolution chain instead." Seeding an engine into the case's private
sandbox would repeat that defect. The honest reading is therefore a finding about the CLOSURE, not about
the lane: **on a fresh machine the installed bundle does not by itself resolve an ast-grep engine; the
repository's own `node scripts/install-mcp.ts` step is what provides it** — consistent with
`@ast-grep/cli` being absent from the root manifest's `optionalDependencies` and present only in the
packed manifest and the installer's toolchain list.

## 7. Apparatus defects found by RUNNING (all fixed, each re-verified)

Named so the next lane does not re-earn them. Every one produced a false or vacuous verdict that only a
real container run could expose; the exercised negative controls from PART 1 did not catch them because
those test the LOGIC, not the WIRING.

1. a credential MIRROR placed after the credential's deletion → `qa.mcpCall` recorded `null` while a
   working key was present. Fixed: the mirror is written where the credential is staged, and its
   presence is a fact (`obs.qaHomeMirrorPresent`).
2. an ENGINE staged into a tree the rows do not run from — the launcher resolves `sg` bundle-relatively,
   and oneclick rows run from the INSTALLED profile tree. Fixed: the toolchain is redirected to that tree
   (`obs.astgrepEngineTree`).
3. the installer SCRIPT then taken from that tree, where Node REFUSES it:
   `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Fixed: the script always runs from the checkout; only
   the toolchain is redirected. After this fix the oneclick live search went GREEN — from
   `fail:BINARY_NOT_FOUND` to `ok:1` with the control at 0.
4. a classifier that collapsed a CLASSIFIED MCP error into `unreadable-result` — and, while fixing it, an
   `isError` assumption that briefly REGRESSED a green row. The arm now accepts a readable match list
   FIRST (a match list is positive evidence, whatever a marker says) and prints `MCP_LIVE_SEARCH_SHAPE` —
   the measured envelope — beside every verdict, echoed into the row's `raw`.
5. a freshness arm that degenerated into a vacuous green in a mode that builds nothing. Fixed: that mode
   now records `null` with its reason instead of a green that measures nothing.
6. an ORPHANED container from a killed job kept running and competing for the network; it was removed and
   the affected pair re-run rather than reported.

Consequently the apparatus changed between the first and the last run. The authoritative stamps in §1 are
the ones produced by the FINAL apparatus; each fix names the run it changed.
