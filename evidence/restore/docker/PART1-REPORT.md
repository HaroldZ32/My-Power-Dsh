# PART 1 — the Docker lane extended for `.mpd/plans/restore-three-capabilities.md` §7

Lane owner: the Senior Engineer of task T8. Write scope: `scripts/docker-e2e.ts`, `docker/**`,
`evidence/restore/docker/**`. Nothing outside it was touched (`git status` confirms: no `skills/**`, no
`LICENSE-NOTICES.md`, no `VENDOR_LOCK.json`, no stream package source).

Status: **PART 1 written and rehearsed offline. PART 2 (the `--require-docker` runs) NOT started** —
awaiting the captain's freeze.

## 1. What was added, and where

| File | What it now does |
|---|---|
| `docker/lib/owed-install.ts` (new) | §7 item 1 — grades the INSTALL CLOSURE: the install log is read for the unapproved-build-script error class and its warning, and the installed closure is walked for manifests that DECLARE `preinstall`/`install`/`postinstall`/`prepare`. Row: `install.buildScripts`. |
| `docker/lib/owed-pack.ts` (new) | §7 item 5 — grades the PACKED artifact: presence, licence carriers vs the tree it was cut from, self-declaration coherence, byte coherence with that tree (two DECLARED generated exceptions), and byte identity of every built entry with the container's OWN from-source rebuild. Rows: `pack.present`, `pack.licenceCoherence`, `pack.declarationCoherence`, `pack.staticCoherence`, `pack.distFreshRebuild`. |
| `docker/lib/owed-mcp.ts` (new) | §7 item 2 — grades the FULL registered `mcp__*` enumeration (shape + the EXACT enabled server set + no disabled-row leakage) and the live search with its control. Rows: `boot.mcpToolNaming`, `boot.mcpLiveSearch`. |
| `docker/lib/owed-cases.ts` (new) | §7 items 3 and 4 — a table-driven runner for the cases the wave owes, plus the LSP launcher control PAIR. Rows: `restore.reviewPanelSelfTest`, `restore.reviewPanelCase`, `restore.lspBootstrap`, `restore.hashlineRepair`, `qa.mcpCall`, `qa.readonlyDeny`. |
| `docker/probe.ts` (edit) | New probe lines `MCP_REGISTERED`, `MCP_SERVER_COUNTS`, `MCP_LIVE_SEARCH`, `MCP_LIVE_SEARCH_CONTROL`; the enumerator, the server-count helper, the match-count reader and the failure classifier; a REAL `mcp__ast_grep__search` (plus its negative control) driven through the mounted adapter. |
| `docker/entrypoint.sh` (edit) | Wires all of the above: the build-context rule for `dist/mpd-package`, step `09a-install-closure`, step `08c-pack`, step `09d-astgrep-engine`, step `11b-mcp-surface`, section 16 (`16-owed-lsp`, `16b-pack-refresh`, `16c-owed-cases`), the sandbox credential mirror for the two live cases, and new `obs.*` facts. |
| `docker/Dockerfile.dockerignore` (edit) | The ONE deliberate exception: `dist/*` then `!dist/mpd-package`, so the §7 pack arms have a subject. |
| `docker/lib/report.ts` (edit) | Sixteen new names added to `EXPECTED`, so an unreached owed assertion is reported as owed instead of vanishing. |
| `scripts/docker-e2e.ts` (edit) | Offline self-test arms for every wire above (the apparatus invocations, the engine step, the live-search dir, the ignore negation, and that the reporter declares each owed row). |
| `docker/README.md` + `docker/README.zh-CN.md` (edit) | The §7 arms documented in both languages, with the negative control of each. |

## 2. Negative control per assertion (how each one REDDENS)

All controls below were EXERCISED, not reasoned about. Raw row output: the `.ndjson` files beside this
note; raw command logs: `rehearsal/`.

| Assertion | Control, and the observed result |
|---|---|
| `install.buildScripts` | A log carrying a planted `ERR_PNPM_IGNORED_BUILDS` line + `Ignored build scripts:` + the `pnpm approve-builds` hint, with exit 1 → `false`, quoting all three lines. Clean log + exit 0 → `true`. (`rehearsal/inst-dirty.ndjson` vs `inst-clean.ndjson`) |
| `pack.present` + 4 pack rows | A MISSING artifact records all five `false` (never `null` — a missing deliverable is a statement about the wave). The artifact carried TODAY is a live control: `pack.staticCoherence=false` with 10 differing files, `pack.distFreshRebuild=false` with 2 — measured on this host, `rehearsal/` and the run below. |
| `boot.mcpToolNaming` | A synthetic boot log whose registry holds `mcp__git__run` + `mcp__shell__run` (rows shipped `disabled: true`) and only ONE ast-grep tool → `false`, naming `unexpectedServers=git,shell` and `missingAstGrepTools=rewrite,scan`. (`rehearsal/bad.ndjson`) |
| `boot.mcpLiveSearch` | A synthetic log with `MCP_LIVE_SEARCH=fail:BINARY_NOT_FOUND` and `MCP_LIVE_SEARCH_CONTROL=ok:3` → `false`. With `ok:4` and `ok:0` → `true`. (`rehearsal/bad.ndjson` vs `good.ndjson`) |
| `restore.lspBootstrap` | A tree without the launcher → `false`. The graded control is a PAIR: the positive half must GAIN `<root>/.mpd/lsp/cclsp.json`; the negative half carries the user's own `cclsp.json` and asserts it survives byte for byte AND that no generated file appears beside it. Rehearsed on this host: `true`, 2 well-formed servers, 1 TypeScript family, user config digest unchanged. |
| `restore.reviewPanel*`, `restore.hashlineRepair`, `qa.*` | A tree lacking the case the wave owes → `false` ("this wave owes … and the tree does not carry it"). A case that REFUSES to run (`[mcp-call] missing credentials`) → `null` WITH the marker quoted, never `true`. Both rehearsed. |

## 3. Live findings the arms ALREADY produce (measured while rehearsing)

These are not hypothetical reds — the arms fire on the tree as it stands, and PART 2 will carry them
into `result.json`:

- `pack.licenceCoherence=false`, `pack.staticCoherence=false` (10 differing files),
  `pack.distFreshRebuild=false` (2 differing) — **`dist/mpd-package` is STALE**: it was cut before the
  wave's `skills/**`, `LICENSE-NOTICES.md`, `packages/mpd-hashline-plugin/**` and
  `packages/mpd-mcp-lsp/**` moves. The arm's own raw names every differing path. **Consequence for the
  captain: a `node scripts/pack-mpd.ts` re-pack is owed before the acceptance run**, or these four rows
  are red in it — and they are red for a real, nameable reason.
- `pack.declarationCoherence=true` — the stale artifact still tells the truth about itself (its `files`
  allowlist resolves, its patch layers exist, all 27 row module paths its own patch names resolve inside
  it, no host tree travelled along). The two failures are staleness, not malformation.
- `restore.lspBootstrap=true` on this host with the CURRENT `dist/launch.js`: 2 well-formed servers, 1
  serving the TypeScript family, and a user's own `cclsp.json` left byte-identical.

## 4. The load-bearing assumption, proven
The whole pack arm depends on BuildKit honouring `!dist/mpd-package` after `dist/*`. Not assumed: a
throwaway `docker/Dockerfile.ctxprobe` + a COPY of the real ignore file built the real context, and the
resulting image holds `/src/dist/mpd-package` with **608 files** while `node_modules` and `evidence`
stay OUT. Log: `ctxprobe-build.log`. (The probe Dockerfile was deleted; the probe image was removed.)

## 4b. A oneclick-specific false red, closed before PART 2

The LSP arm drives the launcher, and the launcher resolves its `cclsp` dependency from ITS OWN location.
The one-click service deliberately runs NO `bun install` (its steps 07 and 08 are source-only), so an arm
run from the checkout there would report "no config generated" for a tree whose dependency chain was
simply never materialized — a FALSE red, not a finding. The entrypoint therefore prefers the INSTALLED
tree (`<profile>/node_modules/@mpd-dsh/mpd`) whenever the profile carries one: in source mode that is the
same checkout through the `link:`, and in one-click mode it is the only tree with its dependencies. The
choice is recorded as the `obs.lspTree` fact so no reader has to infer which tree was driven.

The other owed cases needed no such treatment: `review-panel.ts`, `readonly-deny.ts`, `mcp-call.ts`,
`install-profile.ts` and the hashline suite all import **node builtins and repo-relative modules only**
(checked, not assumed), so they run in both modes.

## 5. Rehearsal environment caveat, stated rather than implied

Every rehearsal above ran on the DEVELOPER HOST, and a host rehearsal is not the container run. What it
proves is that each arm's logic, wiring and control behave; what it does NOT prove is the container's
own toolchain (bun/pnpm/npm versions, network, the installed profile). PART 2 is what settles those.

Two host-measured facts worth carrying into PART 2:

- `@ast-grep/cli` is absent from this checkout, and `/usr/bin/sg` on this host is util-linux's
  `setgroups` helper (it fails the server's `--version` probe) — so the live search genuinely cannot be
  settled here, which is exactly why step `09d` stages the engine with `node scripts/install-mcp.ts`.
- Rehearsing that installer (into a scratch toolchain) showed `@ast-grep/cli@0.45.3` shipping a
  `postinstall`, with npm 11.19 printing `npm warn install-scripts 1 package has install scripts not yet
  covered by allowScripts`. The binary landed anyway (`ast-grep --version` → `0.45.3`). This is npm, not
  pnpm, and it is step `09d` rather than the client install — but it is the same CLASS as the clause
  `install.buildScripts` grades, and it is recorded here so nobody reads the closure clause as covering
  more than `dsh plugin --profile web add` does.
- `@cyanheads/git-mcp-server` declares `"prepare": "bunx husky"` and `mcp-server-commands` declares
  `"prepare": "npm run build"` — the two packages §7 item 1 names. `cclsp` declares no `prepare`.
