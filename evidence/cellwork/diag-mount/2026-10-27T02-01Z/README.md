# `mpd-cellwork` mounts on the real `dsh-tui` path after the global `@mpd-dsh/mpd` removal — re-verification

**Verdict: PASS on all three criteria.** The previous round proved the row never entered the
composition because a stale **global** `@mpd-dsh/mpd@0.15.5` won the loader's install-anchor lookup.
The captain removed that global package; this run re-verifies the **real user path** with **no
`--patch` overlay and no absolute module path anywhere**, and the row now mounts:

| # | Criterion | Observed | Previous round |
|---|---|---|---|
| 1 | composition rows = **153**, `mpd-cellwork` in the tree | **153** rows, `mpd-cellwork` at index 141 | 152 rows, row absent |
| 2 | the 14 `cellwork_*` names on the model-facing tool list | **117** tools, **14/14** `cellwork_*` (incl. `cellwork_status` / `cellwork_start` / `cellwork_stop`) | 103 tools, 0 |
| 3 | `cellwork` in the command palette, `/agent-teams` as control | palette **95** items; `/agent-teams` → 1 item; `/cellwork` → 1 item | 94 items; control hit, `/cellwork` no match |

Run date: **2026-10-27, UTC 02:01–02:20** (local 10:01–10:20 +08:00). Nothing outside the workspace
was written; the real `~/.dsh` was read only.

## What changed since the previous round

The captain ran `npm rm -g @mpd-dsh/mpd`. Observed in this run (`install-state/prep.log`):

```
$ npm ls -g --depth=0
/home/haroldzhao/.nvm/versions/node/v24.21.0/lib
├── @deepseek-ai/dsh@0.2.1-rc.3
├── @deepseek-harness-tui/dsh-tui@0.17.0
├── corepack@0.36.0
└── npm@11.19.0
```

and the loader's install anchor now resolves **nothing** for the bundle — 13 search paths, all `miss`
(`install-state/prep.log`, section 2). The empty directory `<npm root -g>/@mpd-dsh/` is left behind and
is inert (no `package.json`).

## Environment — the user's own path, isolated

| Item | Value |
|---|---|
| Launcher | `/home/haroldzhao/.nvm/versions/node/v24.21.0/bin/dsh-tui` (`@deepseek-harness-tui/dsh-tui 0.17.0`) |
| Harness CLI | `/home/haroldzhao/.nvm/versions/node/v24.21.0/bin/dsh` (0.2.1-rc.3) |
| `DSH_HOME` | `<ws>/.tmp-cellwork-reverify/dshhome` |
| `HOME` | `<ws>/.tmp-cellwork-reverify/home` |
| Session workspace | `<ws>/.tmp-cellwork-reverify/ws` |
| Profile | byte-identical copy of `~/.dsh/profiles/dsh-tui` at `<DSH_HOME>/profiles/dsh-tui` |

The boot command is the launcher **alone** — `env -i <sandbox vars> dsh-tui` — with no `--patch`, no
overlay file, and no module path in any patch (`boot/phase1.log`).

**Copy fidelity** (`install-state/`): the whole profile directory (18 721 files, 434 882 598 bytes) was
copied with `cp -a`, and a per-file `sha256` manifest of the copy is **identical** to the source's
(`MANIFEST IDENTICAL`, manifest sha256 `da43b6df8422c94b9c8433cc92e522ea303588afffb3c2f2ed68b41facb93746`).
Key bytes:

```
0ef73e7d775ea1eb81ef20c5f88ddb7b107f4a507289fff1bf97f84ca607dfca  node_modules/@mpd-dsh/mpd/cordis.patch.yml   (0.16.1, 36 rows)
019741abb302525c9eafb9ba641315f6db139ffe0ba3e501e6b265ad0628a8ff  node_modules/@mpd-dsh/mpd/package.json
c3f2358eb308837c761d5842d681fe2043bef0b2ca50eb974dee025ec1b0f98f  node_modules/@mpd-dsh/mpd/packages/mpd-cellwork-plugin/dist/index.js
7094cf610dd3d3dc9d8d3c78211036b3701089ef023ddbd02231232f0df8705f  package.json (bundles: dsh-base, dsh-tui, @mpd-dsh/mpd)
33155529ce3d7ff221aaa18fb5badc45c1236a1033723106e664f33bc5d54333  cordis.patch.yml (the profile's own user layer, copied verbatim)
```

After the two boots the same 18 721-file manifest is **byte-identical** to the copy-time manifest
(`MANIFEST IDENTICAL`, section 6 of `run.log`) — the boots changed no profile byte.

### Declared deviations from the literal user path

1. **The home/profile directories are a sandbox**, not `~/.dsh` (this session's file policy is
   `workspace-write`). The profile is a byte-identical copy at the same `profiles/dsh-tui` relative path,
   so the loader's inputs are the user's own bytes.
2. **`<HOME>/.dsh-tui/agent-preset.json`** is copied from the real `~/.dsh-tui/agent-preset.json`
   (`{"preset": "mpd"}`), and **`onboarding.json`** (`{"completed": true, "version": 1}`) is written by the
   lane: the real HOME has no onboarding file (the wizard was already completed), and without the skip
   flag the first-run wizard owns the keyboard and no chat screen is ever reached.
3. **Credentials**: `<DSH_HOME>/.credentials.yaml` is copied once into the sandbox (0600, 711 bytes);
   no value is printed, logged or written to evidence, and the only network endpoint used is the
   loopback model stub.
4. **Phase 2 adds exactly two env keys** — `DEEPSEEK_BASE_URL=http://127.0.0.1:<stub port>` and a dummy
   `DEEPSEEK_API_KEY` — so that one real model turn can be recorded without a live credential. The
   profile is not edited; the composition is untouched (`registration/phase2.log`, `boot failures=[]`).

## Commands and exit codes

`run.log` is the transcript; every `[exit=…]` is the command's own status.

| # | Command | Exit |
|---|---|---|
| 0 | `bash .tmp-cellwork-reverify/prep.sh` | 0 |
| 1 | `bun .tmp-cellwork-reverify/phase1.ts <sandbox> <ev>/boot` | 0 |
| 2 | `bun .tmp-cellwork-reverify/phase2-registration.ts <sandbox> <ev>/registration` | 0 |
| 3 | `node .tmp-cellwork-reverify/probe-composition.mjs <profileDir> <ev>/composition <dshhome>` | 0 |
| 4 | `DSH_HOME=<sb> HOME=<sb> node scripts/dump-config.ts --profile dsh-tui --json` | 0 (child 0) |
| 5 | `bun .tmp-cellwork-reverify/extract-header.ts <sandbox> <ev>/registration` | 0 |

## Criterion 1 — the composition the boot loads has 153 rows and contains `mpd-cellwork`

### 1a. The host's own profile load (the decisive measurement)

The 0.17.0 launcher prefers its in-package **host entry** (`bin/dsh-tui.js:1719-1729`); that host calls
`profileBoot.prepareProfile(profile, true, undefined)` (`lib/types/dsh-adapter/host-dsh.js:230`), whose
body is `loadProfile(NAME, name, INSTALL_ANCHOR, …)` (`lib/profile-boot-C14i-8IN.js:216-221`), which is
`loadProfileDirectory(bin, dir, installAnchor, …)` (`dsh-app-boot/lib/index.js:1065-1075`). The exact
quotes are in `install-state/boot-mechanism.txt`.

`probe-composition.mjs` replays **that call** — `appBoot.loadProfile("dsh", "dsh-tui", INSTALL_ANCHOR, <sandbox DSH_HOME>)` —
and composes the result with the harness's own `composeEntries`. `composition/probe-composition.log`:

```
INSTALL_ANCHOR=/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh/package.json
layer @deepseek-ai/dsh-base version=0.2.1-rc.3
  packageDir=…/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-base
layer @deepseek-harness-tui/dsh-tui version=0.17.0
  packageDir=…/lib/node_modules/@deepseek-harness-tui/dsh-tui
layer @mpd-dsh/mpd version=0.16.1
  packageDir=…/.tmp-cellwork-reverify/dshhome/profiles/dsh-tui/node_modules/@mpd-dsh/mpd
skippedBundles=[]
composed bundle-layer rows=153
mpd-cellwork present=true
mpd-cellwork at composed index 141 name="@mpd-dsh/mpd/packages/mpd-cellwork-plugin/dist/index.js" config={}
…
=== boot-call-path (appBoot.loadProfile, exactly what prepareProfile runs) ===
loadProfile+composeEntries rows=153 mpd-cellwork present=true
```

The `@mpd-dsh/mpd` layer now resolves to the **profile** copy (0.16.1); in the previous round the same
anchor resolved the global 0.15.5 (35 rows, no cellwork) and produced 152 rows.

### 1b. Independent second reading — `--dump-config` (COMPOSITION ONLY)

`composition/dump-config-envelope.json` + `dump-config-stdout.txt`, run with the same sandbox
`DSH_HOME`/`HOME` through the repo wrapper (`scripts/dump-config.ts`, which prints the COMPOSITION-ONLY
bound itself):

```
child exit=0 source=child stdoutBytes=62587 bannerEmitted=true
top-level `- id: ` rows=153
mpd-cellwork present=true (dump line 937)
```

This proves COMPOSITION only and never a plugin load (AGENTS.md §4); it is cited as the second reading
of the same row count, not as the mount proof.

### 1c. What the BOOT ITSELF shows (the load half)

`boot/phase1.log` — the plain no-overlay boot, no stub, no extra env:

```
boot failures=[]
crashSignatures=[]
▶ （Ctrl+P 展开） 已加载上下文 · 系统提示词 18 段 · 运行时上下文 3 项 · 技能 20 · 工具 117
sinks present (18): mpd-bootstrap.log, mpd-cellwork.log, mpd-codegraph.log, mpd-config.log, mpd-dsh-adapter.log,
  mpd-ext.log, mpd-goal.log, mpd-mcp-astgrep.log, mpd-mcp-codegraph.log, mpd-mcp-lsp.log, mpd-patch-guards.log,
  mpd-roles.log, mpd-roster.log, mpd-team-core.log, mpd-team-watchdog.log, mpd-tui-panels.json, mpd-tui.log, mpd-verify.log
--- mpd-cellwork.log ---
[2026-10-27T02:18:49.638Z] [mpd-cellwork] mounted: guard=on depthMax=3 checkpointRatio=0.5 windowFraction=0.25 windowOverride=none
```

The mount line is written at the **end** of the row's `apply()`, after the guard install, the tool
registrations and the command registration — a row that is not in the tree cannot produce it. Two
boot-level deltas versus the previous round: the sandbox workspace now holds **18** row log sinks
(`mpd-cellwork.log` among them, where the previous round listed every other mpd row and no such file), and
**117** model-facing tools instead of 103 (+14).

The live process tree (`boot/process-tree.txt`) shows the real chain, no `--patch` argument anywhere:

```
492  282  node /home/haroldzhao/.nvm/versions/node/v24.21.0/bin/dsh-tui
499  492  node <SB>/dshhome/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/bin/dsh-tui.js
507  499  node <SB>/dshhome/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/dsh-adapter/host-entry.js
```

**Bound, stated plainly:** a boot prints no row count. The exact **153** is measured at the loader layer
by replaying the boot's own `loadProfile`/`composeEntries` call (1a) and independently by the harness's
`--dump-config` (1b); the boot itself proves the row is *in and applied* (1c). Last round's "152" was
measured by the same method, so 152 → 153 is an apples-to-apples delta.

## Criterion 2 — the model-facing tool list carries all 14 `cellwork_*` names

`registration/phase2.log`, on a real boot of the same sandbox:

```
== model-facing tool list: the stub's wire view ==
stub requests=3
request 1 path=/v1/messages offered=0 decision=plain text (no tools offered)      ← session-title call
request 2 path=/v1/messages offered=117 decision=tool call cellwork_status        ← the main turn
request 3 path=/v1/messages offered=117 decision=final text
main request (request 2) offered 117 tools
main request cellwork_* (14): cellwork_activate, cellwork_context, cellwork_dispatch, cellwork_handoff,
  cellwork_inbox, cellwork_recon, cellwork_requirements, cellwork_send, cellwork_split, cellwork_start,
  cellwork_status, cellwork_stop, cellwork_subteam, cellwork_supervise

== model-facing tool list: the harness's own request/header ==
recordedToolNames 117 tools; cellwork_* = ["cellwork_activate","cellwork_context","cellwork_dispatch",
  "cellwork_handoff","cellwork_inbox","cellwork_recon","cellwork_requirements","cellwork_send",
  "cellwork_split","cellwork_start","cellwork_status","cellwork_stop","cellwork_subteam","cellwork_supervise"]

tool/call {"turn":1,"step":1,"callId":"call_cellwork-reverify_0","name":"cellwork_status","arguments":"{}"}
tool/result {"turn":1,"step":1,"message":{"role":"tool",…,"content":[{"type":"text","text":"cellwork refused:
  cellwork_status: no cell is active in this workspace — start one with `/cellwork <objective>`"}],"isError":false,…}}
```

Two independent surfaces agree: the harness's own `request/header` record
(`registration/request-header-record.json`, 117 names in `request-header-tool-names.txt`) and the wire
`tools[]` the loopback model actually received. The stub then called one of them, so the harness
recorded a real `tool/call` + `tool/result` for `cellwork_status` — the tool is **registered and
callable**, not merely listed. `--dump-config` is not used for this criterion.

## Criterion 3 — the command palette shows `cellwork`, with `/agent-teams` as the control

Same boot (`registration/{palette-open,control-agent-teams,treatment-cellwork}.pane.txt`):

```
--- palette-open ---
  ╭─ 命令 · 共 95 项 ─╮
  │ ❯ new                   新开会话
--- control-agent-teams ---
  ╭─ 命令 · 共 1 项 ─╮
  │ ❯ agent-teams     [what the team is for] Stage a team for the current goal: /agent-teams <what the team is for>
  ⌸ ❯ /agent-teams
--- treatment-cellwork ---
  ╭─ 命令 · 共 1 项 ─╮
  │ ❯ cellwork     [objective] Start cell-work for an objective: a dedicated planner interview, a measured task split, and a team that dispatche…
  ⌸ ❯ /cellwork
```

The control proves the probe discriminates (a registered command keeps the palette open and shows its
description); the treatment is now a hit, where the previous round's `/cellwork` matched nothing. The
empty-query count moved **94 → 95**, the one added command being `cellwork`.

## Full terminal logs

| File | Bytes | sha256 |
|---|---|---|
| `boot/tui-pane.log.gz` (phase 1, full raw ANSI) | 1 580 864 gz / 3 585 745 raw | gz `7880d1231cab713cf54ff0802ef98f767e56eae030ceca9f396c53c0cadbbc43`, raw `7ad373d3a628106bdd6db7d6e848cf950947125619a81ecbf57061c394fe58ed` |
| `registration/tui-pane.log.gz` (phase 2, full raw ANSI) | 4 079 516 gz / 9 248 445 raw | gz `8ea8c8b5494b2fc64ad3d0bd246c2cd32afdd67b07419b742519e955543b06c1`, raw `ac26116dd8d29caede954a11bca0cc1a9aee2dbe5e346d92610aeb4f563d585b` |

The readable frames are the `*.pane.txt` captures next to them; `zcat … | sha256sum` reproduces the
raw digests.

## What this evidence PROVES

1. With the global package gone, the loader's `resolveBundleDir` falls through to the profile copy, and
   the composition the boot loads is **153 rows** with `mpd-cellwork` present (harness's own
   `loadProfile` + `composeEntries`, and independently `--dump-config`).
2. A **real no-overlay `dsh-tui` boot** applies the row (`[mpd-cellwork] mounted: …`), registers its
   tools (**117** model-facing tools, **14/14** `cellwork_*` in the harness's `request/header`) and its
   command (`/cellwork` matches in the palette; empty palette **95** items).
3. The row is not just registered but **callable**: the stub issued `cellwork_status` and the harness
   recorded the tool result.
4. Isolation held: the sandbox `DSH_HOME`/`HOME`/workspace were used, no `--patch` and no absolute
   module path appear anywhere, and the profile copy is byte-identical to the installed one before and
   after the boots.

## What this evidence does NOT prove

1. **The exact row count is not printed by a boot.** 153 is a loader-layer measurement replayed through
   the boot's own call path (1a) and corroborated by `--dump-config` (1b, COMPOSITION ONLY). The boot
   proves presence + apply (1c).
2. The run is a byte-identical **copy** under an isolated `DSH_HOME`, not the real `~/.dsh`, and the
   global removal itself is the captain's machine change — this run observes it, it does not perform it.
3. The model is a **loopback stub**, not the live DeepSeek endpoint: the turn's shape (tools offered,
   one tool call, final text) is real, the model is not.
4. Only **one** of the 14 tools was exercised (`cellwork_status`); the other 13 are proven registered and
   offered, not proven callable.
5. The real 14 historical sessions are not re-read; this is a today-boot of the same profile bytes.

## Finding outside this task's scope

The harness's own `--dump-config` prints one pre-existing warning from the **dsh-tui host** layer:

```
dsh: [@deepseek-harness-tui/dsh-tui] patch: entry "tool-ralph" not found
```

It appears only in the composition dump (`composition/dump-config-banner.log`), not in either real
boot (`zcat boot/tui-pane.log.gz | grep -c tool-ralph` → 0), it is not from this bundle, and the boot
reports `failures=[] crashSignatures=[]`. Reported, not fixed — it is outside this task's scope.

## Reproduction

```sh
# 1. copy the installed profile into a writable sandbox (workspace-write policy), record install state
bash .tmp-cellwork-reverify/prep.sh
# 2. real no-overlay boot: launcher dsh-tui, isolated DSH_HOME/HOME/ws
bun  .tmp-cellwork-reverify/phase1.ts "$PWD/.tmp-cellwork-reverify" "$PWD/<ev>/boot"
# 3. registration surfaces: palette (control + treatment) then one stub-answered turn
bun  .tmp-cellwork-reverify/phase2-registration.ts "$PWD/.tmp-cellwork-reverify" "$PWD/<ev>/registration"
# 4. the composition the boot loads, through the host's own loadProfile call
node .tmp-cellwork-reverify/probe-composition.mjs "$PWD/.tmp-cellwork-reverify/dshhome/profiles/dsh-tui" "$PWD/<ev>/composition" "$PWD/.tmp-cellwork-reverify/dshhome"
# 5. independent composition reading (COMPOSITION ONLY)
DSH_HOME="$PWD/.tmp-cellwork-reverify/dshhome" HOME="$PWD/.tmp-cellwork-reverify/home" \
  node scripts/dump-config.ts --profile dsh-tui --json > "$PWD/<ev>/composition/dump-config-envelope.json"
# 6. the harness's own request/header record
bun  .tmp-cellwork-reverify/extract-header.ts "$PWD/.tmp-cellwork-reverify" "$PWD/<ev>/registration"
```

`scripts/run-all.sh` chains exactly these steps and records each exit code in `run.log`. **Copy
`scripts/*` back into `<ws>/.tmp-cellwork-reverify/` before running** — the scripts import
`../skills/dsh-qa/scripts/…` relative to their own location, so they must sit one level below the repo
root (the sandbox root does), and `prep.sh` recreates the sandbox itself. The sandbox (467 MB) is
deleted after the run; this directory is the only residue, and no file outside `evidence/` was changed.

## Files

```
run.log                         the transcript, with every [exit=…]
boot/                           phase 1: full terminal log (gz), pane captures, process tree, 18 log sinks
registration/                   phase 2: palette captures, stub trace + offered tools, request/header record, tool/call+result
composition/                    probe log/json, row id lists, dump-config envelope + stdout + banner
install-state/                  global npm state, 13-path resolution probe, profile sha256, manifests (gz), boot-mechanism quotes
scripts/                        prep.sh, phase1.ts, phase2-registration.ts, stub-server.ts, probe-composition.mjs, extract-header.ts, run-all.sh
```
