# Wave-2 decision record — B8 binary resolution + QA workspace isolation (t1, Architect, read-only)

## 0. Verdict

1. **B8** — stop pinning the binary path in the bundle patch. Resolve the binary **inside the two MCP packages' launcher entry (our code, bundle-relative)** and let the adopted resolver see it through its existing env tier. Precedence: `process.env` override → launcher candidates (`MPD_AST_GREP_BIN_DIR` → `createRequire(<optionalDep>)` → `<bundle>/.toolchain/node_modules/.bin/*`) → adopted chain (`~/.mpd/runtime/ast-grep/<slug>/` … for sg; `bundled`→`~/.mpd/codegraph`→PATH→download for codegraph) → the adopted code's own actionable error. Symmetrically: `mpd-codegraph-plugin` gains the same `.toolchain` candidate in its own resolver (mirroring `mpd-comment-checker-plugin`).
2. **QA isolation** — `DSH_HOME`/`HOME` isolation does **not** cover workspace state, because every workspace-scoped root follows `agent.session.header.cwd ?? process.cwd()`. The mechanism is therefore **"sandbox the WORKSPACE too"**: every QA dsh spawn gets an explicit sandbox `cwd`, every `session/create` uses a sandbox cwd, and each live case positively asserts (from the sandbox session store) that no session it created carries a real-workspace key. No adopted `lib/**` edit.
3. **O-1** (codegraph apply-time `process.cwd()`) — **out of scope for B8**, separate change.
4. No file was written by this task (`changedPaths: []`).

---

## 1. B8 — the measured failure, reproduced (acceptance 2)

All commands run read-only in this session (cwd `/root/dshProj/my-power-dsh`).

| # | command | observed |
|---|---|---|
| 1 | `ls -la /root/.dsh/profiles/web/node_modules/.bin/` | **no `sg`, no `ast-grep`, no `codegraph`** (only cloudflared, d3-dsv, dsh-doctor, js-yaml, katex, marked, tsgo …) — the patch fallback `<baseUrl>/node_modules/.bin/sg` does not exist |
| 2 | `ls -d /root/.dsh/profiles/web/node_modules/@ast-grep /…/@colbymchenry` | `No such file or directory` — a `link:` dependency's `optionalDependencies` are never installed (measured, not inferred) |
| 3 | `find /root/.dsh -name sg -maxdepth 6` | empty — no `.bin/sg` anywhere under the harness home |
| 4 | `env \| grep -i "MPD\|CODEX"` | empty — `MPD_AST_GREP_SG_PATH` / `MPD_CODEGRAPH_BIN` are **unset in the dsh process** (they exist only in `/root/.mpd/mcp.env`, whose own header says `# … source before dsh`) |
| 5 | `ls -la ~/.mpd/runtime/ast-grep/` | `No such file or directory` — the "MPD runtime" tier the error names is empty; nothing in this repo provisions it (`grep -rn "runtime/ast-grep" packages scripts` → only vendored resolver text) |
| 6 | `which sg` / `sg --version` | `/usr/bin/sg`; `exit=1`, prints `Usage: sg group [[-c] command]` — util-linux `newgrp`, fails the `--version` probe |
| 7 | `cat /root/.dsh/profiles/web/package.json` | `"@mpd-dsh/mpd": "link:/root/dshProj/my-power-dsh"` → the **link:** layout |
| 8 | `.toolchain/node_modules/.bin/sg --version` | **`exit=1`** — `WARNING: sg is deprecated. Use ast-grep instead.` + `Error: Os { code: 2, kind: NotFound … }`; `.toolchain/node_modules/.bin/ast-grep --version` → **`ast-grep 0.45.3`, exit=0** |
| 9 | `ls .toolchain/node_modules/@ast-grep/cli/` | ships **both** `ast-grep` (52 MB, real binary) and `sg` (439 KB, deprecated wrapper) → the correct candidate name is `ast-grep`, never `sg` |
| 10 | `.toolchain/node_modules/.bin/codegraph` → `../@colbymchenry/codegraph/npm-shim.js` | mode `755`, shebang `#!/usr/bin/env node` → executable; the plugin's `spawnSync(binary,["init"])` against this path is *measured working* (`evidence/plan-c/c1-team/*/output.log`: `[mpd-codegraph] init status=ok binary=…/.toolchain/node_modules/.bin/codegraph`) |
| 11 | `grep -n toolchain packages/mpd-bundle/cordis.patch.yml` | **no match** → the committed patch no longer contains a checkout toolchain path, so `scripts/pack-mpd.mjs:97-98` (`.toolchain` → `/node_modules/.bin/*` rewrites) are **dead code**, and `dist/mpd-package/cordis.patch.yml:44,80` carry the *same* `<baseUrl>/node_modules/.bin/*` expressions as the committed patch (packed == dev for this row) |
| 12 | `~/.mpd/runtime/…` never provisioned; upstream OMO provisioned it (`oh-my-openagent/packages/omo-codex/plugin/components/bootstrap/src/provision.ts` → `$CODEX_HOME/runtime/ast-grep/<slug>/sg`), but the port dropped that component — the vendored MCP only *reads* that tier |

**Root cause (one sentence):** the two MCP rows pin `MPD_AST_GREP_SG_PATH`/`MPD_CODEGRAPH_BIN` to a **packed-layout-only** path, and for a `link:` checkout that pin is a *wrong non-empty value*; for codegraph a wrong env pin is not merely ignored — it **disables** the child's entire fallback machinery (§3.2).

**Packed-layout nuance (measured, must be stated):** the packed expression is only valid because the harness writes `nodeLinker: hoisted` into every profile (`@deepseek-ai/dsh-app-boot/lib/index.js:365-370`), and `dsh plugin add` is a thin pnpm forwarder (`lib/plugin-Ddi42qoW.js:9,109`). So `<profile>/node_modules/.bin/sg` exists for the packed flow, and *only* because of that harness detail; a bare `--version`-style probe is still needed because the `sg` entry name itself fails (§1 row 8).

---

## 2. B8 — consumer inventory with exact resolution order (acceptance 1)

### 2.1 The pin that breaks everything — `packages/mpd-bundle/cordis.patch.yml`
- `:44` `mcp-astgrep` → `env.MPD_AST_GREP_SG_PATH = process.env.MPD_AST_GREP_SG_PATH || <baseUrl>/node_modules/.bin/sg`
- `:80` `mcp-codegraph` → `env.MPD_CODEGRAPH_BIN = process.env.MPD_CODEGRAPH_BIN || <baseUrl>/node_modules/.bin/codegraph`
- `:68-70` carries the stale rationale ("F10 closed … resolves via baseUrl to the node_modules/.bin/codegraph binary (optionalDependency…)") that made B8 look closed.
- The `!!js` expression sees only `process.env` + `baseUrl` (+ globals); `--dump-config` prints it **unevaluated** (`.qa-tmp/final-dump.yml:647,690`), so only a mounting boot can prove a resolution.

### 2.2 ast-grep MCP — `packages/mpd-mcp-astgrep/dist/cli.js` (adopted, VENDOR_LOCK-pinned)
- `envOverrideCandidates` `:427` → `mpdRuntimeCandidates` `:431` (`<runtimeDir>` | `$CODEX_HOME/runtime/ast-grep/<slug>` | `~/.mpd/runtime/ast-grep/<slug>`) → `skillBinCandidates` `:443` (`$MPD_AST_GREP_BIN_DIR/{ast-grep,sg}` | `<packageDir>/bin/{…}` — *packageDir is never passed*, so this tier is only the env var in practice) → **PATH** (`ast-grep`,`sg`) → `homebrewCandidates` `:453`.
- Acceptance = `fileExists` **and** `probePasses` (`--version` output contains `ast-grep`) — `:536`.
- `planSgCandidates` `:458`; `resolveSgBinarySync` `:583`; **called per tool call** via `resolveSgPath` `:2362` (cache invalidated when the file is missing) → *late boot provisioning would work for this consumer*; a wrong env pin does **not** block the chain (it just fails tier 1).

### 2.3 codegraph MCP — `packages/mpd-mcp-codegraph/dist/serve.js` (adopted, VENDOR_LOCK-pinned)
- `resolveCodegraphCommand` `:579`: `MPD_CODEGRAPH_BIN`|`CODEGRAPH_BIN` (**env source, returned even when `exists:false`**) → `bundled` = `createRequire(import.meta.url).resolve("@colbymchenry/codegraph/package.json")` → `bin/codegraph.js`|`npm-shim.js` → `provisioned` = `~/.mpd/codegraph` marker (`defaultProvisionedBin` `:558`, marker `{version,binPath}`) → `which("codegraph")`.
- Startup `runCodegraphServe` `:9733-9801`: `if (resolution.source !== "env" && managedBin) …` / and `if (!resolution.exists …) → provisionMissingCodegraph` — which **returns null when `source === "env"`** (`:9808-9810`) → `runUnavailableMcp(CODEGRAPH_SKIP_HINT)`. **A wrong env pin hard-blocks bundled/provisioned/PATH *and* the download fallback.**
- Resolved **once** at child start: the CLI entry is guarded by `isDirectInvocation(process.argv[1])` (tail of the file) and `runCodegraphServe` is exported.

### 2.4 `packages/mpd-codegraph-plugin/src/index.ts` (ours)
- `resolveBinary` `:26-38`: `config.binary` → `MPD_CODEGRAPH_BIN`|`MPD_DSH_CODEGRAPH_BIN` (exists-checked) → `packageCodegraphPath()` `:16` (`createRequire` of `@colbymchenry/codegraph`) → PATH.
- **No `.toolchain` candidate** → measured boot line `[mpd-codegraph] init status=no-binary binary=-` (e.g. `evidence/session-workspace-root/t8-verify/2026-09-11T03-51-20Z-proof/boot.log`).
- Apply-time `:76` `MPD_CODEGRAPH_PROJECT_CWD || process.cwd()` = **O-1, not touched by this change** (§4).

### 2.5 Established in-repo precedent — `packages/mpd-comment-checker-plugin/src/index.ts`
- `resolveBinary` `:60-72`: `config.binary` → `MPD_DSH_COMMENT_CHECKER_BIN` → `dependencyBinary()` `:50` (`createRequire`) → `repoRoot()` `:40` + `<repo>/.toolchain/node_modules/...` `:66-69`. **This is the chain shape to copy** — it is exactly "packed via require, checkout via bundle-relative `.toolchain`", and it already works in both layouts.

### 2.6 ast-grep skill helper — `skills/ast-grep/scripts/ast_grep_helper.py:160-256`
- `MPD_AST_GREP_SG_PATH` → `$CODEX_HOME|~/.mpd/runtime/ast-grep/<slug>/sg` → `<skill>/bin/{ast-grep,sg}` → PATH (with the Linux `sg` sanity check) → Homebrew. Runs in the agent's shell, so a row env never reaches it; today only `install.sh` (writes `<skill>/bin`, needs a writable bundle) or `MPD_AST_GREP_BIN_DIR` can satisfy it. **Out of the B8 change set** (optional follow-up, same skills re-pin), because the MCP is the reported defect.

### 2.7 QA / installer pinning (masking surfaces that must be kept in mind)
- `skills/dsh-qa/scripts/preset-register.mjs:37-46` and `rtl-verif.mjs:80-82` pin **both** `MPD_DSH_*_CLI` and the binary env → they bypass *both* halves of B8 (fine for them, but they can never be the B8 gate).
- `skills/dsh-qa/scripts/mcp-call.mjs:36-39` pins only the binary env when present → **it masked B8**, which is why the case passes while the deployed tools are broken.
- `scripts/install-profile.mjs:62-63,82,95,107` already does the right thing: `env: existsSync(astCli) ? { MPD_AST_GREP_SG_PATH: astCli } : undefined` — "pin only if it exists" is an in-repo idea, not an invention.

---

## 3. B8 — the ONE mechanism, precedence, both layouts, apply/execute split (acceptance 3, 4)

### 3.1 Mechanism (chosen)

**Binary resolution is owned by the MCP package launcher (our code) and is bundle-relative; the patch stops naming any binary path.**

Two new launcher entries (one per MCP package, launched through the same `<baseUrl>/node_modules/@mpd-dsh/mpd/packages/...` convention every other row already uses, which resolves in **both** layouts):

- `packages/mpd-mcp-astgrep/launch.mjs` → resolve `sg`; if resolved and `MPD_AST_GREP_SG_PATH` is unset, set it; then `await import("./dist/cli.js")` (the dist runs `main()` unconditionally on import — no entry guard to satisfy).
- `packages/mpd-mcp-codegraph/launch.mjs` → resolve `codegraph`; if resolved and `MPD_CODEGRAPH_BIN` is unset, set it; then `const m = await import("./dist/serve.js"); process.exitCode = await m.runCodegraphServe()` — **required** because `serve.js` only self-starts when `isDirectInvocation(process.argv[1])` (argv[1] is the launcher, not `serve.js`).

Shared resolver (one file, unit-testable, no side effects) — e.g. `packages/mpd-mcp-shared/bin-resolve.mjs` (add one copy line to `packages/pack`'s `cpAssets()`; the packed `files` list already carries `packages/**`). The resolvers must be **pure + never throw** (a launcher failure would take the MCP row's startup with it).

### 3.2 Precedence (explicit, one rule)

```
1. process.env already set (user, /root/.mpd/mcp.env sourced, legacy installer, QA/dev-flavor pin)  -> use as-is, launcher does nothing
2. $MPD_AST_GREP_BIN_DIR/{ast-grep,sg}                                    (upstream env contract, skill cache dir)
3. createRequire(<launcher>).resolve("@ast-grep/cli/package.json")   -> <pkg>/ast-grep | <pkg>/sg        [packed, any node-linker]
   createRequire(<launcher>).resolve("@colbymchenry/codegraph/package.json") -> <pkg>/bin/codegraph.js | <pkg>/npm-shim.js
4. <bundle>/.toolchain/node_modules/.bin/{ast-grep,sg} | .../codegraph    (checkout link: install; packed if the shipped installer ran)
5. nothing resolved -> leave the env UNSET and import the dist anyway, so the adopted code runs its own chain
   (ast-grep: ~/.mpd/runtime/ast-grep/<slug>/sg -> PATH -> Homebrew -> BINARY_NOT_FOUND + hints
    codegraph: bundled -> ~/.mpd/codegraph provisioned marker -> PATH -> auto-download -> "skipped" hint)
```
Acceptance rule for a candidate: `existsSync` **plus**, for ast-grep, a `--version` probe whose output contains `ast-grep` (this is what rejects `.bin/sg`, the deprecated wrapper that exits 1). `ast-grep` is tried before `sg`.

### 3.3 Both install layouts (stated answer)

| layout | where the binary is | which candidate resolves it |
|---|---|---|
| `link:` checkout (`dsh plugin add .` from the repo; `package.json` `"@mpd-dsh/mpd": "link:<repo>"`) | `<repo>/.toolchain/node_modules/.bin/{ast-grep,codegraph}` (created by the sanctioned `scripts/install-mcp.mjs` / `install-profile.mjs`; **not** created by pnpm, since a `link:` dep installs no deps) | **candidate 4**, reachable because the launcher derives `<bundle>` from its own `import.meta.url` and `<baseUrl>/node_modules/@mpd-dsh/mpd` is the repo symlink |
| packed (`dsh plugin add dist/mpd-package`, pnpm hoisted per `dsh-app-boot`) | `<profile>/node_modules/@ast-grep/cli/...`, `@colbymchenry/codegraph/...` (optionalDependencies of `@mpd-dsh/mpd`) | **candidate 3**, `createRequire` from inside the installed package — linker-agnostic (works for npm, pnpm-hoisted, and pnpm-isolated) |
| packed, installer also run (`<bundle>/.toolchain`) | as above + `.toolchain` | candidate 4 |
| neither installed | — | candidate 5: the adopted code's own hints (unchanged behaviour, no regression) |

Also required: the two patch rows **stop pinning** — delete both `env:` blocks (`packages/mpd-bundle/cordis.patch.yml:43-44`, `:79-80`). The user's `MPD_*` env still reaches the child because `buildChildEnv` is `{...scrubbedParentEnv(), ...row env}` (`@deepseek-ai/dsh-mcp-client/lib/index.js:28-33`) and the scrub only drops `/KEY|PASSWORD|SECRET|TOKEN/i` + `DSH_*` (`@deepseek-ai/dsh-subprocess/lib/index.js:32,50-52`) — `MPD_AST_GREP_SG_PATH` and `MPD_CODEGRAPH_BIN` survive. If the captain prefers an explicit key over deleting the block, use `!!js 'process.env.X || ""'` — `""` is equivalent to unset for both resolvers (`nonEmptyValue` / `.trim().length`) and satisfies `z.dict(String)` (an `undefined` value would fail row validation).

### 3.4 Apply-time vs execute-time split — why not `mpd-bootstrap`, why not "put it first in the patch"

- The MCP child is spawned **during the row's `apply`** (`dsh-mcp-client/lib/index.js:770` → `startConnection` → `StdioClientTransport`), and the child env is frozen at that moment. A later row mutating `process.env` can never influence it.
- Sibling loader entries are created **concurrently**: `cordis-plugin-loader/src/config/group.ts:71` = `await Promise.allSettled(config.map(options => this.create(options)))` → **list order is not a timing guarantee**; "insert a provisioning row first" is not a correctness argument.
- Consequence per consumer: ast-grep **re-resolves per tool call** (`cli.js:2362`) so it would tolerate late provisioning; codegraph **resolves once at child start** and then either runs or serves a permanent "skipped" stub. Therefore:
  - boot-time provisioning (`mpd-bootstrap` or a new row) is **rejected** as the mechanism (it cannot be ordered; it would also add boot-time writes and network risk);
  - the resolution must happen **inside the child process before the adopted code reads it** → the launcher does exactly that. The launcher runs before `import("./dist/…")`, so the env is set before the child's first resolution in the *same* boot, for both tools.

### 3.5 `mpd-codegraph-plugin` (our code) — second half of the same defect
Add the bundle-relative `.toolchain` candidate to `resolveBinary` (`packages/mpd-codegraph-plugin/src/index.ts:26-38`), placed after the env candidates and alongside the existing `packageCodegraphPath()` (`:31-32`), mirroring comment-checker `:60-72`; rebuild its `dist`. This removes the measured `status=no-binary` boot line in the checkout layout (the plugin's log is the *only* signal for the plugin path; the MCP tools are covered by the launcher).

### 3.6 Files that must NOT change in the B8 change
- `packages/mpd-mcp-astgrep/dist/cli.js`, `packages/mpd-mcp-codegraph/dist/serve.js` — VENDOR_LOCK-tracked (`VENDOR_LOCK.json:29,44`); the launcher approach deliberately needs **no** re-pin and no rebuild of adopted bytes.
- `mpd-dsh-adapter-plugin`, `mpd-comment-checker-plugin` logic, the QA `MPD_DSH_*_CLI` pins (still valid: they override the row `args` and remain the sanctioned QA escape hatch).
- O-1 line `mpd-codegraph-plugin/src/index.ts:76`.

---

## 4. O-1 scope answer (asked explicitly)

**Separate change, not this one.** O-1 = *which directory gets indexed*, B8 = *where the executable is*; they share a file but have independent proof obligations, and wave 1 already recorded O-1 as a listed follow-up (AGENTS.md §12). Keep the diff honest: touch `resolveBinary` only, leave line 76 untouched, and say so in the change's output.

---

## 5. B8 — gate design (must be falsifiable)

Discriminating gate (checkout layout, the layout that is broken today):
1. Boot the **dev-flavor patch** (`devPatch()` row rewrite, like `preset-register.mjs`) with `cwd` = sandbox workspace, `DSH_HOME`/`HOME` = sandbox, and **none** of `MPD_AST_GREP_SG_PATH`, `MPD_CODEGRAPH_BIN`, `MPD_AST_GREP_BIN_DIR`, `MPD_DSH_ASTGREP_CLI`, `MPD_DSH_CODEGRAPH_CLI` set (they mask the row `args`/launcher).
2. Assert a real `mcp__ast_grep__search` call returns match content (and, separately, a real `mcp__codegraph__*` tool call answers rather than the "CodeGraph MCP skipped" stub).
3. **Negative control** (proves falsifiability): same boot with `MPD_AST_GREP_SG_PATH=/nonexistent/sg` → the tool call must report `BINARY_NOT_FOUND`; and a boot with `MPD_CODEGRAPH_BIN=/nonexistent/codegraph` → the codegraph tools must report the skip/unavailable reason.
4. Packed-layout regression guard: the `relocate-smoke`-style npm-staged boot must still answer `mcp__ast_grep__search` **and** the staged package must contain the launcher file (`test -f dist/mpd-package/packages/mpd-mcp-astgrep/launch.mjs`) — the new failure mode to catch is "launcher not shipped".
Evidence: `evidence/<domain>/<slug>/<ts>/{result.json,output.log}` per AGENTS.md §7; the gate must be a real mount + real tool call (§4: `--dump-config` proves composition only).

---

## 6. QA isolation — inventory of workspace-scoped state (acceptance 5)

Workspace root resolution (the rule everything below follows):
- adopted agent-teams: `agent.session.header.cwd ?? process.cwd()` at **8 sites** — `lib/session-start.js:124`, `lib/tools.js:30`, `lib/capabilities.js:20`, `lib/index.js:246,303`, `lib/members.js:345,652`, `lib/scheduler.js:424`;
- our plugins: `dsh.workspaceRoot(exec)` (session header cwd → `DSH_WORKSPACE_ROOT` → cwd; `packages/mpd-dsh-adapter-plugin/src/index.ts:193-206`) — **the session cwd outranks `DSH_WORKSPACE_ROOT`**, and the harness never sets that var → setting it in QA does **not** isolate a session created with a real cwd.

Roots a QA boot can write outside `DSH_HOME`/`HOME`:

| root | writer | resolution site |
|---|---|---|
| `<ws>/.mpd/team/**` (+ `retired-members.json`) | agent-teams (row config `stateDir: .mpd/team`, `packages/mpd-bundle/cordis.patch.yml:203`) | `lib/session-start.js:124-125`, `lib/tools.js:30`, +6 |
| `<ws>/.mpd/memory/agents/<slug>/**` | mpd-memory-plugin | `packages/mpd-memory-plugin/src/index.ts:40-45` |
| `<ws>/.mpd/boulder.json` | mpd-boulder-plugin | `src/index.ts:42,65,97` |
| `<ws>/.mpd/hashline-files.json` | mpd-hashline-plugin | `src/index.ts:50` |
| `<ws>/.mpd/verif/**` | mpd-verif-plugin | `src/env.ts` `workDir` |
| `<ws>/.mpd/plans/**`, `<ws>/.mpd/ulw/**` | mpd-ulw-plugin | `src/index.ts:85,89` |
| `<ws>/.codegraph/**` (incl. a 201 MB `codegraph.db` here, `daemon.log`, `init.cooldown`) | mpd-codegraph-plugin **at apply time** | `src/index.ts:76` (`process.cwd()` unless `MPD_CODEGRAPH_PROJECT_CWD`) |
| `~/.mpd/workmate/**`, `~/.mpd/runtime/**`, `~/.mpd/codegraph/**` | HOME-scoped → already covered by sandbox `HOME` | — |

QA cases that boot `dsh` (inventory; the cwd decides the workspace):
- **polluters — stepped headless session, no `cwd` (inherits the invoking shell's cwd = the repo):** `skills/dsh-qa/scripts/mcp-call.mjs:50`, `dual-track-smoke.mjs:48`, `codegraph-smoke.mjs:50`, `preset-register.mjs:119`.
- **latent (boots/session created with `cwd: ROOT`, not stepped today, one prompt away from leaking):** `preset-conformance.mjs:327` (boot) + `:356` (`session/create` with `cwd: ROOT`), `web-client-adapt.mjs:122`, `agent-teams-sidebar.mjs:489`. Measured: the 2026-09-11 preset-conformance runs left **no** team record (session created but never stepped), while the session store key is the real repo: `…/home/sessions/--root-dshProj-my-power-dsh--/session-4e090970-…` (evidence `evidence/dsh-qa/preset-conformance/2026-09-11T04-26-47.314Z/result.json` `sessionHeader.log`).
- **already correct (`cwd` in a sandbox ws):** `bundle-lifecycle.mjs:119`, `session-start-team.mjs:139`, `agent-teams-adopt.mjs:123`, `agent-teams-dispatch.mjs:255`, `workmate-library.mjs:121`, `workmate-team-member.mjs:75`, `memory-smoke.mjs:41`, `plan-c-smoke.mjs:61`, `tool-output-validation.mjs:58`, `ultrawork-smoke.mjs:47`, `readonly-deny.mjs:313`, `relocate-smoke.mjs:65`, `skill-catalog-probe.mjs:67`, `team-route-rewire.mjs:102`.
- **no session (dump-only / plugin install):** `mount-assert.mjs:46`, `rtl-ip-profile.mjs:60`, `rtl-verif.mjs:182`, `relocate-smoke.mjs:50`, `bundle-lifecycle.mjs:88,106,169,183,185`, `agent-teams-adopt.mjs:118`.

Concrete evidence of the real pollution (acceptance 5):
`.mpd/team/mpd-default-e35e7807/team.json` — `"name":"MPD Default"`, `"phase":"staged"`, `"profile":{"name":"mpd"}`, 11 roster members (Architect…Junior Engineer), `captainSessionId = "session-7f0c5dea-475b-4175-b698-46fb55a0dc20"`, created `2026-09-11T03:51:32Z`. That session id is **verbatim** the one in `evidence/session-workspace-root/t8-verify/2026-09-11T03-51-20Z-proof/session-repo.jsonl`, whose `boot.log` shows the process cwd `/root/dshProj` and the session was created with the **real repo** as its workspace (wave-1 t8 proof). The real `.mpd/team` currently holds **19** `mpd-default-*` records plus archives — and each carries the 11 roster member names, so they are exactly what the `mpd_workmate_rename/delete` in-use gate scans (AGENTS.md §12 `in-use` row): stale QA records can block workmate mutations for roster-named workmates.

---

## 7. QA isolation — mechanism + file list (acceptance 6)

**Mechanism: "isolation covers the WORKSPACE, not just the homes"** — every QA boot and every session it creates must live under the sandbox; `DSH_HOME`/`HOME` alone are not isolation.

1. **Every dsh spawn gets an explicit `cwd`** = a sandbox workspace (`join(sandbox, "ws")`, `mkdtempSync`-created). This is the whole fix for the four polluters: the session header cwd (= the child's cwd), and the `process.cwd()` fallback, are then both inside the sandbox, so the session-start policy and every `workspaceRoot(exec)` root land there.
2. **Every `session/create` payload carries a sandbox cwd** (never `ROOT`). For proofs that need "a workspace different from the process cwd" (t8's purpose), use a **sandbox mirror** path, not the real repo.
3. **Positive, concurrency-safe assertion** (instead of a fragile "nothing in the repo changed" diff): after the run, assert that **every session-store key** under the sandbox (`<DSH_HOME>/sessions/<escaped-cwd>/<sessionId>/`) corresponds to a path under the sandbox — i.e. no session created by this case carries the real repo/user-dir key (`--<repo>--`). Deterministic, no zstd decompression, no false positive from a concurrently running real session. A shared helper (e.g. `skills/dsh-qa/scripts/lib/workspace-isolation.mjs`) exposes `sandboxWorkspace(sandbox)` + `assertSessionsSandboxed(dshHome, sandbox)`; live cases call it. Optional extra: report (not fail on) new `<repo>/.mpd/team/*` names in `result.json` for auditability.
4. **Docs**: `skills/dsh-qa/SKILL.md` Hard rule 1 (currently "every case creates a temp DSH_HOME … never read/write the real `~/.dsh`") gains the workspace clause + the root list; `AGENTS.md` §7 "Isolation" gains the same one-liner.

Files that change:
- `skills/dsh-qa/scripts/mcp-call.mjs` (`:33-39,50`), `dual-track-smoke.mjs` (`:46-48`), `codegraph-smoke.mjs` (`:44-50`), `preset-register.mjs` (`:119`) — sandbox `cwd` (and stop making the binary env pins unconditional; see §5).
- `skills/dsh-qa/scripts/preset-conformance.mjs` (`:327`, `:356`), `web-client-adapt.mjs` (`:122`), `agent-teams-sidebar.mjs` (`:489`) — sandbox cwd hardening (latent leak).
- new `skills/dsh-qa/scripts/lib/workspace-isolation.mjs` + calls from the live cases; `skills/dsh-qa/SKILL.md`; `AGENTS.md` §7.
- `VENDOR_LOCK.json` — `skills` treeSha re-pin **in the same commit** (the whole `skills/**` tree is locked: `VENDOR_LOCK.json` assets.skills `fileCount 365` + `treeSha`); derive it with `scripts/verify-vendor.mjs` (B2's derivation) rather than hand-editing. If t6 also touches `skills/**` (§5's gate), both edits share ONE re-pin in ONE commit — coordinate the order (t7 after t6, or one combined re-pin).
- The accumulated `mpd-default-*` records: **report, do not auto-delete** — they are real workspace state (user data) and `AGENTS.md` forbids QA writing `.mpd/team`; recommend the captain/user archive or retire them in the AgentTeams tab at integration time.

Files that deliberately do NOT change:
- `packages/mpd-agent-teams-plugin/lib/**` — **in particular `lib/session-start.js`**: `agent.session.header.cwd ?? process.cwd()` is the adopted upstream behaviour and is *correct*; the defect is the QA harness's cwd, not the plugin. An adopted-code divergence here would also need its own re-pin/vendoring evidence.
- `packages/mpd-dsh-adapter-plugin/src/index.ts` (precedence is right; `DSH_WORKSPACE_ROOT` must not be set from rows, and must not be used as the QA knob).
- The bundle row's `stateDir: .mpd/team` and the session-start policy config (they are the object under test for `session-start-team.mjs`).

---

## 8. Rejected alternatives (with the reason each is worse)

B8:
- **Acceptance probe inside the YAML row** (`process.getBuiltinModule("node:fs").existsSync` over two literal paths): no new files, but puts resolution logic in the patch (AGENTS.md §2.2 "no logic in profiles/scripts"), is provable **only** by a boot, cannot reach a packed `.pnpm/<hash>/node_modules` layout, and must be duplicated in two rows. Not chosen.
- **Row env = `<bundle>/.toolchain/...` only**: fixes the checkout and breaks the packed layout (a wrong env pin is fatal for codegraph, §2.3).
- **Row env = `""` + installer-side provisioning of `~/.mpd/runtime/ast-grep/<slug>/sg` + `~/.mpd/codegraph` marker**: works, but (a) requires an install-time step that the documented one-command flow does not have, (b) for codegraph it couples us to an upstream-internal marker format, (c) it does not fix the same-boot codegraph decision (no row ordering guarantee, §3.4). Kept as a *fallback* only if the launcher is rejected.
- **Documenting `source ~/.mpd/mcp.env`**: wave 1 already measured it as the fragile status quo (a GUI launch rarely sources it); it is a workaround, not a fix.
- **Editing the vendored MCP dists / overlaying an upstream source file** (LSP-overlay pattern): rebuild + VENDOR_LOCK re-pin + drift anchor for a 2-candidate addition; the launcher achieves the same with no re-pin.
- **Deferring binary provisioning to the ast-grep skill (`install.sh`)**: a skill runs only when an agent calls it, needs a writable bundle dir (packed installs live under `node_modules`), and the MCP's `skill-bin` tier is unreachable without `MPD_AST_GREP_BIN_DIR`.

QA isolation:
- **Disable `sessionTeamPolicy` in QA overlays**: fixes only `.mpd/team`, blinds every case to a bundle-policy regression, and cannot cover the other roots; `session-start-team.mjs` legitimately needs the policy on.
- **`DSH_WORKSPACE_ROOT=<sandbox>`**: does not protect (session header cwd outranks it; §6) and is documented as an operator/QA override, not a session isolator.
- **Cleanup after the fact (delete QA-created team records)**: writes real `.mpd/team` state from QA (AGENTS.md forbids), needs fragile "which record is mine" bookkeeping, and can race a live session.
- **Patching `lib/session-start.js` to honour a `DSH_HOME`-scoped root**: an adopted-code divergence that changes product behaviour for real users to solve a QA harness problem.

---

## 9. Acceptance checklist (self-check)

| # | criterion | where |
|---|---|---|
| 1 | consumer inventory file:line + resolution order | §2.1-§2.7 (patch rows; cli.js:427-470,2362; serve.js:483-600,9733-9810; plugin :16-38; comment-checker :39-72; skill helper :160-256; QA :37-46/:36-39; legacy installer :62-63) |
| 2 | measured failure reproduced | §1 rows 1-12 (raw commands + outputs) |
| 3 | ONE mechanism + precedence + both layouts | §3.1-§3.3 |
| 4 | apply/execute split; bootstrap vs row config | §3.4 (child spawn at apply; sibling concurrency; per-call vs once) |
| 5 | workspace-scoped root inventory + real pollution evidence | §6 (roots table + `mpd-default-e35e7807` ↔ t8 session id) |
| 6 | isolation mechanism + files that change / do not | §7 |
| 7 | no file written | `changedPaths: []` — read-only inspection only |

## 10. Handoff notes for the implementers

- **t6 (B8)**: §3 change set; keep launchers defensive (never throw; import the dist unconditionally); codegraph launcher must call `runCodegraphServe()`; rebuild `mpd-codegraph-plugin/dist` after the resolver change; update both bilingual README pairs of the two MCP packages + `mpd-codegraph-plugin` and the AGENTS.md §12 rows (`ast-grep BINARY_NOT_FOUND`, `codegraph provision crash`), plus the stale patch comments at `:43`/`:68-70`, and decide with the captain whether to delete the dead `pack/.toolchain` rewrites (`scripts/pack-mpd.mjs:97-98`).
- **t7 (QA isolation)**: §7; the four polluters are the fix, the leak assertion is the falsifiable evidence, and the `VENDOR_LOCK` skills re-pin must ride in the same commit (coordinate with t6 if it also edits `skills/**`).
- **t9 (verification)**: §5 + §7.3 gate designs, each with its negative control; the pre-existing `mcp-call.mjs` env pins and the `preset-register`/`rtl-verif` `MPD_DSH_*_CLI` pins must not be used as B8 evidence.
