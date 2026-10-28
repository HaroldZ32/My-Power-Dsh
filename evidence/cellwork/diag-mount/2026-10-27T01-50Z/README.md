# `mpd-cellwork` does not mount in the installed `dsh-tui` profile — diagnostic evidence

**Verdict (proven):** the row never enters the composition. The loader resolves the BUNDLE LAYER from
the machine's **global `dsh` installation first**, and that installation carries a stale
`@mpd-dsh/mpd@0.15.5` whose `cordis.patch.yml` has no `mpd-cellwork` row. The profile's own 0.16.1 copy
(with the row at line 510) is never consulted for the bundle layer. No apply() error, no schema
rejection, no later-layer override, no broken module path.

Run date: 2026-10-27 (UTC 01:47–02:12). Nothing outside the workspace was written; the real `~/.dsh`
was read only.

## Sandbox

| Item | Path |
|---|---|
| Sandbox root (deleted after the run) | `<ws>/.tmp-mount-check/tui` |
| `DSH_HOME` | `<ws>/.tmp-mount-check/tui/dshhome` |
| `HOME` | `<ws>/.tmp-mount-check/tui/home` |
| session workspace | `<ws>/.tmp-mount-check/tui/ws` |

The profile was **copied** from `~/.dsh/profiles/dsh-tui` with `cp -a` because this session's file
policy is `workspace-write` (a boot writes into the profile directory: module fallback, plugin-manager
state, `cordis.yml` mtime). Copy fidelity (read-only comparison, `composition/row-diff.log`):

```
installed profile bundle (0.16.1)  cordis.patch.yml sha256 0ef73e7d775ea1eb81ef20c5f88ddb7b107f4a507289fff1bf97f84ca607dfca
sandbox copy of the same file      cordis.patch.yml sha256 0ef73e7d775ea1eb81ef20c5f88ddb7b107f4a507289fff1bf97f84ca607dfca
profile manifest (installed) sha256 7094cf610dd3d3dc9d8d3c78211036b3701089ef023ddbd02231232f0df8705f
profile manifest (copy)      sha256 7094cf610dd3d3dc9d8d3c78211036b3701089ef023ddbd02231232f0df8705f
```

## What was run

Every command was run from the workspace root.

1. **No-overlay mount boot** (decisive step, `scripts/phase1.ts`) — `dsh-tui` on a tmux PTY, `env -i`
   with `DSH_HOME` / `HOME` / `DSH_TUI_WORKSPACE_TARGET` all inside the sandbox, **no `--patch`**:

   ```
   bun .tmp-mount-check/phase1.ts <sandboxRoot> <outDir>    # exit 0
   ```

   Observations (`no-overlay-boot/phase1.log`):

   ```
   cellwork module exists=true bytes=277374
   cellwork row at cordis.patch.yml:510
     510:     - id: mpd-cellwork
     511:       name: '@mpd-dsh/mpd/packages/mpd-cellwork-plugin/dist/index.js'
   boot failures=[]
   crashSignatures=[]
   ```

   and the row log-sink directory `<ws>/.mpd/logs` holds a sink for every other mpd row
   (`mpd-bootstrap`, `mpd-codegraph`, `mpd-config`, `mpd-dsh-adapter`, `mpd-ext`, `mpd-goal`,
   `mpd-mcp-*`, `mpd-patch-guards`, `mpd-roles`, `mpd-roster`, `mpd-team-core`, `mpd-team-watchdog`,
   `mpd-tui`, `mpd-verify`) but **no `mpd-cellwork.log`** — its `apply()` never ran, so the mount line
   `[mpd-cellwork] mounted: …` that the module writes at the END of `apply` cannot exist.

   The TUI's own context line (`no-overlay-boot/boot.pane.txt:22`):

   ```
   ▶ （Ctrl+P 展开） 已加载上下文 · 系统提示词 18 段 · 运行时上下文 3 项 · 技能 20 · 工具 103
   ```

2. **Registration surface** (`scripts/phase2.ts`, `scripts/phase3.ts`) — same sandbox, same copied
   profile, plus ONE fixture in the PROFILE's own user layer (`<profile>/cordis.patch.yml`): an
   id-targeted `llm-deepseek` row pointing at a loopback stub. It adds no plugin row; the bundle layer
   is untouched. Exit 0.

   * Model-facing tool list, read from the harness's own `request/header` record
     (`registration-surface/phase2.log`):

     ```
     recordedToolNames 103 tools; cellwork_* = []
     cellwork log sink exists=false
     ```

     `registration-surface/phase2.log` carries the full 103-name list: `mpd_boulder_*`,
     `mpd_memory_*`, `mpd_goal_*`, `mpd_flow_*`, `mpd_ext_*`, `mpd_team_compact_*` are present; not one
     `cellwork_*` name is.
     Bound: the stub received **0** requests (`stub requests=0`) — the `request/header` is recorded
     before the outbound call, so the list is real, but the model turn itself completed no answer.
   * Command registry, with a positive control (`registration-surface/phase3.log`):

     ```
     === palette ===
     ╭─ 命令 · 共 94 项 ─╮            (empty query)
     === control-agent-teams ===
     ╭─ 命令 · 共 1 项 ─╮
     │ ❯ agent-teams     [what the team is for] Stage a team for the current goal: /agent-teams <what the team is for>
     === treatment-cellwork ===
     ⌸ ❯ /cellwork                   (no palette: no command matches)
     ```

     The control proves the probe discriminates: a registered command keeps the palette open and shows
     its description; `/cellwork` matches nothing.

3. **Composition** (`scripts/probe-anchor.mjs`, `composition/`) — calls the harness's OWN
   `loadProfileDirectory` + `composeEntries`; no plugin code runs.

   ```
   === install-anchor (global dsh CLI) ===
   resolveBundleDir-like pick=…/lib/node_modules/@mpd-dsh/mpd version=0.15.5
   layer @mpd-dsh/mpd packageDir=…/lib/node_modules/@mpd-dsh/mpd patchPaths=[…/lib/node_modules/@mpd-dsh/mpd/cordis.patch.yml,…]
   composed rows=152 mpd-cellwork present=false
   === profile-anchor ===
   resolveBundleDir-like pick=…/profiles/dsh-tui/node_modules/@mpd-dsh/mpd version=0.16.1
   composed rows=57 mpd-cellwork present=true        (this arm cannot resolve @deepseek-ai/dsh-base, so its total is lower)
   === arm 3: install anchor for in-box bundles, profile anchor for @mpd-dsh/mpd ===
   composed rows=153 mpd-cellwork present=true
   ```

   Arm 3 is the falsifier: the ONLY change is where the `@mpd-dsh/mpd` layer comes from, and it adds
   exactly the one missing row.

   `composition/row-diff.log` records the rest:

   ```
   row ids in the GLOBAL bundle patch: 35
   row ids in the PROFILE bundle patch: 36
   in PROFILE only: [{"line":510,"id":"mpd-cellwork"}]
   in GLOBAL only: []
   rows in the PROFILE bundle patch but ABSENT from the composed tree: [[510,"mpd-cellwork"]]
   ```

4. **The module itself is healthy** (`composition/module-load.log`):

   ```
   load OK, exports= apply,inject,name
   name= mpd-cellwork inject= ["tools","commands"] Config= undefined
   ```

   The installed `dist/index.js` holds 14 `dsh.registerTool({…})` calls (`cellwork_status`,
   `cellwork_start`, `cellwork_stop`, `cellwork_activate`, `cellwork_context`, `cellwork_dispatch`,
   `cellwork_handoff`, `cellwork_inbox`, `cellwork_recon`, `cellwork_requirements`,
   `cellwork_send`, `cellwork_split`, `cellwork_subteam`, `cellwork_supervise`) plus
   `dsh.registerCommand(command)` — 14 + 1, unconditional, no lazy gate.

## Mechanism (file:line)

1. `dsh-tui` (global launcher) spawns `dsh --profile dsh-tui` —
   `@deepseek-harness-tui/dsh-tui/bin/dsh-tui.js:857`
   (`spawn(...cmd('dsh', ['--profile', profile, ...dshArgs]))`).
2. That `dsh` computes its install anchor from ITS OWN package:
   `@deepseek-ai/dsh/lib/profile-boot-C14i-8IN.js:119`
   (`const INSTALL_ANCHOR = fileURLToPath(new URL("../package.json", import.meta.url));`),
   used at `:218` (`loadProfile(NAME, name, INSTALL_ANCHOR, void 0, { userLayer })`).
3. `@deepseek-ai/dsh-app-boot/lib/index.js:995-1001` — `resolveBundleDir` tries **`installAnchor` first**
   and only then `join(profileDir, "package.json")`:
   ```
   for (const anchor of [installAnchor, join(profileDir, "package.json")]) {
           const dir = packageDirFromAnchor(anchor, packageName);
           if (dir !== void 0) return dir;
   }
   ```
   `packageDirFromAnchor` (`:976-982`) walks `createRequire(anchor).resolve.paths(name)` — from the
   global `@deepseek-ai/dsh` that reaches `/…/lib/node_modules/@mpd-dsh/mpd` (0.15.5), which exists, so
   the profile copy is never reached.
4. `bundlePatchPaths(packageDir, bundle)` then reads that 0.15.5 `cordis.patch.yml`
   (35 rows; `packages/mpd-cellwork-plugin` does not even exist in that copy).
5. Row module specifiers are resolved through `mountRootInclude`'s `bareModuleBaseUrl`
   (`@deepseek-ai/dsh-app-boot/lib/index.js:4125-4135`, host-resolved `import()`), which is the profile —
   which is why the rows that DO exist still load 0.16.1 module bytes (the `mpd-bootstrap` sink reports
   `bundle 0.16.1`). That is a hybrid: **0.15.5 row LIST + 0.16.1 module bytes.**

## Ruled out (in the order the task asked)

* **(a) module path resolution** — `import.meta.resolve('@mpd-dsh/mpd/packages/mpd-cellwork-plugin/dist/index.js')`
  from the profile dir succeeds; the module imports and exports `apply/inject/name`
  (`composition/module-load.log`).
* **(b) apply() throwing / half-mount** — apply never runs: the row is absent from the composition
  before any plugin code executes. No `failed to apply loader entry`, no `Cannot find module`, no
  `ERR_MODULE_NOT_FOUND`, no crash signature anywhere in the raw terminal log (`boot-ansi.log`,
  `crashSignatures=[]`).
* **(c) a later layer overriding/disabling the same id** — neither the profile's `cordis.patch.yml` nor
  `presets/mpd.patch.yml` mentions `mpd-cellwork` (grep: zero hits); the only `disabled:` guards in the
  bundle patch target `mpd-better-sidebar` and `mpd-agent-team`.
* **(d) the row's Config rejecting `config: {}`** — the module exports no `Config` at all
  (`Config= undefined`), so there is no row schema to reject it; and the composer drops the row before
  any schema step.

## Reproduction

```sh
# 1. copy the installed profile into a writable sandbox (workspace-write policy)
mkdir -p .tmp-mount-check/tui/dshhome/profiles .tmp-mount-check/tui/home .tmp-mount-check/tui/ws
cp -a ~/.dsh/profiles/dsh-tui .tmp-mount-check/tui/dshhome/profiles/dsh-tui
# 2. real mount boot, NO --patch overlay
bun .tmp-mount-check/phase1.ts "$PWD/.tmp-mount-check/tui" "$PWD/out1"
# 3. composition arms (uses the harness's own loader functions)
node .tmp-mount-check/probe-anchor.mjs "$PWD/.tmp-mount-check/tui/dshhome/profiles/dsh-tui"
# 4. registration surface (needs tmux; adds only the `llm-deepseek` route fixture to the copy)
bun .tmp-mount-check/phase2.ts "$PWD/.tmp-mount-check/tui" "$PWD/out2" --append-route
bun .tmp-mount-check/phase3.ts "$PWD/.tmp-mount-check/tui" "$PWD/out3"
```

Copy `scripts/*` back into `<ws>/.tmp-mount-check/` before running them (they import
`../skills/dsh-qa/scripts/…` relative to their own location and take the sandbox path as argv). The
loader paths inside `probe-anchor.mjs` are absolute on purpose: they are the machine's installed
harness, which is the subject of the diagnosis.

## What this evidence does NOT prove

* It does not prove the real 14 sessions' history: the conclusion is drawn from a today-boot of the same
  profile bytes plus the captain's measured `request/header` tool counts (103 tools, 0 `cellwork_*`),
  which the sandbox reproduces exactly.
* It does not prove which `@mpd-dsh/mpd` version the module BYTES came from for every row; only
  `mpd-bootstrap` self-reports `bundle 0.16.1` (the profile path), which is enough to show the row list
  and the module bytes came from different copies.
* The recommended remedy (remove/upgrade the stale global `@mpd-dsh/mpd@0.15.5` so the per-bundle
  fallthrough reaches the profile) was NOT applied — it is outside this task's write scope. Arm 3 in
  `composition/probe-anchor.log` is the composition-level proof of what that remedy yields (153 rows,
  row present), not a live boot of the remedied machine.
